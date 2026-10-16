const fallbackUsage = {
    map_read: 1,
    map_write: 2,
    copy_src: 4,
    copy_dst: 8,
    index: 16,
    vertex: 32,
    uniform: 64,
    storage: 128,
    indirect: 256,
    query_resolve: 512,
};
export function bufferUsageFlags(usages) {
    // WebGPU constants are numeric dictionaries when present; fallback values cover headless/mock runtimes.
    const constants = globalThis.GPUBufferUsage;
    return usages.reduce((flags, usage) => flags | usageFlag(usage, constants), 0);
}
function usageFlag(usage, constants) {
    const key = usage.toUpperCase();
    return constants?.[key] ?? fallbackUsage[usage];
}
export function mapReadMode() {
    return (globalThis.GPUMapMode?.READ ?? 1);
}
const fallbackTextureUsage = {
    copy_src: 1,
    copy_dst: 2,
    texture_binding: 4,
    storage_binding: 8,
    render_attachment: 16,
};
export function textureUsageFlags(usages) {
    // WebGPU constants are numeric dictionaries when present; fallback values cover headless/mock runtimes.
    const constants = globalThis.GPUTextureUsage;
    return usages.reduce((flags, usage) => flags | textureUsageFlag(usage, constants), 0);
}
function textureUsageFlag(usage, constants) {
    const key = usage.toUpperCase();
    return constants?.[key] ?? fallbackTextureUsage[usage];
}
//# sourceMappingURL=gpu-constants.js.map