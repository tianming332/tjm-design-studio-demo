import { wgslError } from "./errors.js";
import { splitGeneric, trim, literalArrayCount, normalizeAccess, suffixScalar, scalarName } from "./reflect-utils.js";
export function parseType(tokens) {
    const trimmed = trim(tokens);
    if (trimmed.length === 0)
        throw wgslError("VGPU-WGSL-REFLECT-TYPE", "Expected WGSL type");
    const text = trimmed.map((token) => token.text).join("");
    const scalar = parseScalarOrShorthandType(text);
    if (scalar)
        return scalar;
    if (trimmed[1]?.text === "<") {
        const head = trimmed[0].text;
        const inner = splitGeneric(trimmed.slice(2, -1));
        const generic = parseGenericType(head, inner);
        if (generic)
            return generic;
    }
    const texture = parseTextureIdentifier(text);
    if (texture)
        return texture;
    return parseIdentifierType(text);
}
function parseScalarOrShorthandType(text) {
    const scalar = scalarName(text);
    if (scalar)
        return { kind: "scalar", name: scalar };
    const vec = text.match(/^vec([234])([fiuh])$/);
    if (vec)
        return { kind: "vector", width: Number(vec[1]), element: suffixScalar(vec[2]) };
    const mat = text.match(/^mat([234])x([234])([fh])$/);
    if (mat) {
        const element = mat[3] === "h" ? { kind: "scalar", name: "f16" } : { kind: "scalar", name: "f32" };
        return { kind: "matrix", columns: Number(mat[1]), rows: Number(mat[2]), element };
    }
    return undefined;
}
function parseGenericType(head, inner) {
    if (head === "array") {
        const countExpression = inner[1]?.map((t) => t.text).join("");
        const count = countExpression === undefined ? undefined : literalArrayCount(countExpression);
        return { kind: "array", element: parseType(inner[0] ?? []), count, countExpression };
    }
    if (head === "atomic")
        return { kind: "atomic", element: parseType(inner[0] ?? []) };
    if (head === "vec2" || head === "vec3" || head === "vec4")
        return { kind: "vector", width: Number(head.slice(3)), element: parseType(inner[0] ?? []) };
    if (/^mat[234]x[234]$/.test(head))
        return { kind: "matrix", columns: Number(head[3]), rows: Number(head[5]), element: parseType(inner[0] ?? []) };
    if (head === "ptr")
        return { kind: "ptr", addressSpace: inner[0]?.map((t) => t.text).join("") ?? "", element: parseType(inner[1] ?? []), access: inner[2]?.map((t) => t.text).join("") };
    if (head === "sampler")
        return { kind: "sampler", comparison: false };
    if (head.startsWith("texture_storage_")) {
        return { kind: "texture", textureKind: head, dimension: head.slice("texture_storage_".length), texelFormat: inner[0]?.map((t) => t.text).join(""), access: normalizeAccess(inner[1]?.map((t) => t.text).join("")) };
    }
    if (head.startsWith("texture_")) {
        return { kind: "texture", textureKind: head, dimension: head.slice("texture_".length), sampleType: inner[0] ? parseType(inner[0]) : undefined };
    }
    return undefined;
}
function parseTextureIdentifier(text) {
    if (text === "sampler" || text === "sampler_comparison")
        return { kind: "sampler", comparison: text === "sampler_comparison" };
    if (text === "texture_external")
        return { kind: "texture", textureKind: text };
    if (text.startsWith("texture_depth_"))
        return { kind: "texture", textureKind: text, dimension: text.slice("texture_".length) };
    if (text.startsWith("texture_"))
        return { kind: "texture", textureKind: text, dimension: text.slice("texture_".length) };
    return undefined;
}
function parseIdentifierType(text) {
    return { kind: "identifier", name: text };
}
//# sourceMappingURL=reflect-type-parser.js.map