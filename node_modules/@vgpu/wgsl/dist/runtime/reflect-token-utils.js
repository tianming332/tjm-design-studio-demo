import { wgslError } from "./errors.js";
export function expectIdent(token) {
    if (token?.kind !== "ident" && token?.kind !== "keyword") {
        throw wgslError("VGPU-WGSL-REFLECT-PARSE", "Expected identifier", token?.line, token?.column);
    }
    return token.text;
}
export function findNext(tokens, start, text) {
    for (let i = start; i < tokens.length; i++) {
        if (tokens[i].text === text)
            return i;
    }
    throw wgslError("VGPU-WGSL-REFLECT-PARSE", `Expected ${text}`, tokens[start]?.line, tokens[start]?.column);
}
export function findToken(tokens, start, end, text) {
    for (let i = start; i < end; i++) {
        if (tokens[i].text === text)
            return i;
    }
    return undefined;
}
export function skipUntil(tokens, start, text) {
    let depth = 0;
    for (let i = start; i < tokens.length; i++) {
        if (tokens[i].text === "{" || tokens[i].text === "(")
            depth++;
        if (tokens[i].text === "}" || tokens[i].text === ")")
            depth = Math.max(0, depth - 1);
        if (depth === 0 && tokens[i].text === text)
            return i;
    }
    return tokens.length;
}
export function matching(tokens, open) {
    const start = tokens[open].text;
    const end = start === "(" ? ")" : start === "{" ? "}" : ">";
    let depth = 0;
    for (let i = open; i < tokens.length; i++) {
        if (tokens[i].text === start)
            depth++;
        if (tokens[i].text === end) {
            depth--;
            if (depth === 0)
                return i;
        }
    }
    throw wgslError("VGPU-WGSL-REFLECT-PARSE", `Unclosed ${start}`, tokens[open]?.line, tokens[open]?.column);
}
export function readAttrs(tokens, start) {
    const attrs = [];
    let i = start;
    while (tokens[i]?.text === "@") {
        const token = tokens[i];
        const name = expectIdent(tokens[i + 1]);
        i += 2;
        let args = [];
        if (tokens[i]?.text === "(") {
            const close = matching(tokens, i);
            args = tokens.slice(i + 1, close);
            i = close + 1;
        }
        attrs.push({ name, args, token });
    }
    return [attrs, i];
}
export function typeName(type) {
    switch (type.kind) {
        case "scalar":
            return type.name;
        case "identifier":
            return type.name;
        case "vector":
            return `vec${type.width}<${typeName(type.element)}>`;
        case "matrix":
            return `mat${type.columns}x${type.rows}<${typeName(type.element)}>`;
        case "array":
            return `array<${typeName(type.element)}${type.count === undefined ? "" : `,${type.count}`}>`;
        default:
            return type.kind;
    }
}
//# sourceMappingURL=reflect-token-utils.js.map