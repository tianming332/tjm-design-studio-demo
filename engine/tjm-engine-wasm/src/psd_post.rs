//! PSD post-processing applied by the bridge after PhotoCraft's PSD writer.
//!
//! PhotoCraft (v0.6.0) regenerates some image resources on export and does not write the
//! thumbnail (1036). Photoshop rebuilds it on its own save, but file browsers
//! (Finder/Explorer/Bridge) show no preview until then. This module inserts them into the image-resources section of the written
//! file, without touching anything else (layer records, pixel data stay byte-identical).

/// Builds a 1036 thumbnail resource body: 28-byte header + JFIF (PSD spec, "Thumbnail resource").
pub fn thumbnail_resource(width: u32, height: u32, jpeg: &[u8]) -> Vec<u8> {
    let width_bytes = (width.saturating_mul(24).saturating_add(31) / 32).saturating_mul(4);
    let total = width_bytes.saturating_mul(height);
    let mut v = Vec::with_capacity(28 + jpeg.len());
    v.extend_from_slice(&1u32.to_be_bytes()); // kJpegRGB
    v.extend_from_slice(&width.to_be_bytes());
    v.extend_from_slice(&height.to_be_bytes());
    v.extend_from_slice(&width_bytes.to_be_bytes());
    v.extend_from_slice(&total.to_be_bytes());
    v.extend_from_slice(&(jpeg.len() as u32).to_be_bytes());
    v.extend_from_slice(&24u16.to_be_bytes());
    v.extend_from_slice(&1u16.to_be_bytes());
    v.extend_from_slice(jpeg);
    v
}

fn be_u32(b: &[u8], at: usize) -> Option<u32> {
    b.get(at..at + 4).map(|s| u32::from_be_bytes([s[0], s[1], s[2], s[3]]))
}

/// Ids of the image resources present in a PSD/PSB file, with the section's bounds.
pub fn resource_ids(psd: &[u8]) -> Option<(usize, usize, Vec<u16>)> {
    if psd.get(0..4) != Some(b"8BPS") {
        return None;
    }
    let cm_len = be_u32(psd, 26)? as usize;
    let len_at = 30usize.checked_add(cm_len)?;
    let res_len = be_u32(psd, len_at)? as usize;
    let start = len_at + 4;
    let end = start.checked_add(res_len)?;
    if end > psd.len() {
        return None;
    }
    let mut ids = Vec::new();
    let mut o = start;
    while o + 12 <= end {
        if psd.get(o..o + 4) != Some(b"8BIM") {
            break;
        }
        let id = u16::from_be_bytes([*psd.get(o + 4)?, *psd.get(o + 5)?]);
        let name_len = usize::from(*psd.get(o + 6)?);
        let name_total = (name_len + 1 + 1) & !1; // pascal string padded to even
        let size_at = o + 6 + name_total;
        let size = be_u32(psd, size_at)? as usize;
        ids.push(id);
        o = size_at + 4 + size + (size & 1);
    }
    Some((start, end, ids))
}

/// Appends resources `(id, data)` that the file does not already have. Returns the new bytes,
/// or `None` if the file's resource section cannot be parsed (the caller keeps the original).
pub fn add_missing_resources(psd: &[u8], add: &[(u16, Vec<u8>)]) -> Option<Vec<u8>> {
    let (start, end, ids) = resource_ids(psd)?;
    let mut blocks = Vec::new();
    for (id, data) in add {
        if ids.contains(id) {
            continue;
        }
        blocks.extend_from_slice(b"8BIM");
        blocks.extend_from_slice(&id.to_be_bytes());
        blocks.extend_from_slice(&[0, 0]); // empty pascal name, padded
        blocks.extend_from_slice(&(data.len() as u32).to_be_bytes());
        blocks.extend_from_slice(data);
        if data.len() % 2 == 1 {
            blocks.push(0);
        }
    }
    if blocks.is_empty() {
        return Some(psd.to_vec());
    }
    let new_len = u32::try_from(end - start + blocks.len()).ok()?;
    let mut out = Vec::with_capacity(psd.len() + blocks.len());
    out.extend_from_slice(psd.get(..start - 4)?);
    out.extend_from_slice(&new_len.to_be_bytes());
    out.extend_from_slice(psd.get(start..end)?);
    out.extend_from_slice(&blocks);
    out.extend_from_slice(psd.get(end..)?);
    Some(out)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
    use super::*;

    #[test]
    fn thumbnail_header_matches_spec() {
        let r = thumbnail_resource(160, 100, &[0xFF, 0xD8, 0xFF, 0xD9]);
        assert_eq!(&r[0..4], &1u32.to_be_bytes());
        assert_eq!(be_u32(&r, 12), Some(480)); // (160*24+31)/32*4
        assert_eq!(be_u32(&r, 20), Some(4));
        assert_eq!(r.len(), 32);
    }

    #[test]
    fn rejects_non_psd_and_skips_existing_ids() {
        assert!(add_missing_resources(b"nope", &[]).is_none());
    }
}
