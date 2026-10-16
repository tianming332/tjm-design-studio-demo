//! Strict parameter checks for the `tjm/0` protocol.
//!
//! PhotoCraft's commands are lenient by design (a wrong-typed optional param is ignored, an
//! out-of-range number is clamped, `"layer":"six"` falls back to the active layer). For an AI
//! caller that silently edits the wrong thing, so the bridge validates params against each
//! command's params doc (`CommandSpec::params`, e.g. `{"layer":id?,"opacity":0..1?,"name":str}`)
//! before dispatch. Only clear violations are rejected; anything the doc does not describe is
//! passed through unchanged.

use serde_json::Value;

#[derive(Debug, Clone, PartialEq)]
pub enum Kind {
    /// Integer id (`id`).
    Id,
    /// Number, optionally bounded (`0..1`, `-180..180=0`, `%`, `deg`).
    Number(Option<f64>, Option<f64>),
    Bool,
    Str,
    /// Closed set of string values (`"a|b|c"`); open sets (`"Multiply|…"`) become `Str`.
    Enum(Vec<String>),
    /// Anything (json, nested objects, unions the doc doesn't spell out).
    Any,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Field {
    pub name: String,
    pub kind: Kind,
}

/// Parses the top-level `"key":spec` pairs of a params doc. Nested objects are not descended.
pub fn parse(doc: &str) -> Vec<Field> {
    let chars: Vec<char> = doc.chars().collect();
    let mut fields = Vec::new();
    let mut depth = 0i32;
    let mut i = 0usize;
    // Positions of `"key":` at depth 1 (inside the outer braces).
    let mut starts: Vec<(usize, String, usize)> = Vec::new(); // (key start, key, spec start)
    while i < chars.len() {
        match chars.get(i) {
            Some('{') | Some('[') | Some('(') => depth += 1,
            Some('}') | Some(']') | Some(')') => depth -= 1,
            Some('"') if depth == 1 => {
                let mut j = i + 1;
                while j < chars.len() && chars.get(j).is_some_and(|c| c.is_ascii_alphanumeric() || *c == '_') {
                    j += 1;
                }
                if j > i + 1 && chars.get(j) == Some(&'"') && chars.get(j + 1) == Some(&':') {
                    let key: String = chars.get(i + 1..j).map(|s| s.iter().collect()).unwrap_or_default();
                    starts.push((i, key, j + 2));
                    i = j + 1;
                } else {
                    // Skip a quoted value such as "a|b".
                    let mut k = i + 1;
                    while k < chars.len() && chars.get(k) != Some(&'"') {
                        k += 1;
                    }
                    i = k;
                }
            }
            _ => {}
        }
        i += 1;
    }
    for (n, (_, key, spec_start)) in starts.iter().enumerate() {
        let end = starts.get(n + 1).map(|(k, _, _)| *k).unwrap_or(chars.len());
        let spec: String = chars.get(*spec_start..end).map(|s| s.iter().collect()).unwrap_or_default();
        fields.push(Field { name: key.clone(), kind: classify(spec.trim().trim_end_matches(',').trim_end_matches('}').trim()) });
    }
    fields
}

fn classify(spec: &str) -> Kind {
    let s = spec.trim();
    // Value part before a default (`=…`), optional marker or trailing prose.
    let head = s.split(['=', ' ', '(']).next().unwrap_or("").trim_end_matches('?');
    if head.starts_with('"') {
        let inner = head.trim_matches('"');
        if inner.contains('…') || inner.contains("...") || s.contains('{') || s.contains('[') {
            return Kind::Str;
        }
        let opts: Vec<String> = inner.split('|').map(|o| o.trim_matches('"').to_string()).filter(|o| !o.is_empty()).collect();
        // `"#rrggbb"`-style placeholders are not enums.
        if opts.len() >= 2 && opts.iter().all(|o| !o.starts_with('#')) { Kind::Enum(opts) } else { Kind::Str }
    } else if head == "id" {
        Kind::Id
    } else if head == "bool" {
        Kind::Bool
    } else if head == "str" || head == "text" {
        Kind::Str
    } else if let Some((lo, hi)) = head.split_once("..") {
        let num = |t: &str| t.trim_end_matches(|c: char| !c.is_ascii_digit() && c != '.').parse::<f64>().ok();
        match (num(lo), num(hi)) {
            (Some(a), Some(b)) if a <= b => Kind::Number(Some(a), Some(b)),
            _ => Kind::Any,
        }
    } else if head == "%" || head == "deg" || head == "px" || head == "number" {
        Kind::Number(None, None)
    } else {
        Kind::Any
    }
}

/// Returns a message for the first clear violation, or `None` when the params look valid.
pub fn check(fields: &[Field], params: &Value) -> Option<String> {
    let obj = params.as_object()?;
    for f in fields {
        let Some(v) = obj.get(&f.name) else { continue };
        if v.is_null() {
            continue;
        }
        let bad = match &f.kind {
            Kind::Id => !(v.as_u64().is_some()),
            Kind::Bool => !v.is_boolean(),
            Kind::Str => !v.is_string(),
            Kind::Enum(opts) => match v.as_str() {
                Some(s) => !opts.iter().any(|o| o.eq_ignore_ascii_case(s)),
                None => true,
            },
            Kind::Number(lo, hi) => match v.as_f64() {
                Some(x) => !x.is_finite() || lo.is_some_and(|l| x < l) || hi.is_some_and(|h| x > h),
                None => true,
            },
            Kind::Any => false,
        };
        if bad {
            return Some(format!("`{}` = {} does not match {:?}", f.name, v, f.kind));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_set_props_doc() {
        let doc = r#"{"layer":id?,"name":str?,"visible":bool?,"opacity":0..1?,"fill":0..1?,"blend":"Multiply|…"?,"clipped":bool?,"locked":bool?,"locks":{"transparency","pixels"}?}"#;
        let f = parse(doc);
        let kind = |n: &str| f.iter().find(|x| x.name == n).map(|x| x.kind.clone());
        assert_eq!(kind("layer"), Some(Kind::Id));
        assert_eq!(kind("opacity"), Some(Kind::Number(Some(0.0), Some(1.0))));
        assert_eq!(kind("visible"), Some(Kind::Bool));
        assert_eq!(kind("blend"), Some(Kind::Str));
        assert_eq!(kind("name"), Some(Kind::Str));
        assert_eq!(kind("locks"), Some(Kind::Any));
        assert!(check(&f, &json!({"layer":6,"opacity":0.5,"blend":"Multiply"})).is_none());
        assert!(check(&f, &json!({"layer":6,"opacity":"high"})).is_some());
        assert!(check(&f, &json!({"layer":6,"opacity":5})).is_some());
        assert!(check(&f, &json!({"layer":"six"})).is_some());
    }

    #[test]
    fn parses_ranges_defaults_and_enums() {
        let f = parse(r##"{"hue":-180..180=0,"colorize":bool=false,"method":"relative|absolute"="relative","color":"#rrggbb","radius":0.1..1000=1}"##);
        assert!(check(&f, &json!({"hue":-200})).is_some());
        assert!(check(&f, &json!({"hue":30,"colorize":true,"method":"Absolute","color":"#ff0000","radius":4})).is_none());
        assert!(check(&f, &json!({"method":"other"})).is_some());
        assert!(check(&f, &json!({"radius":-3})).is_some());
    }
}
