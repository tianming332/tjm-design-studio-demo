export function bindingKind(type, addressSpace) {
    if (addressSpace === "uniform" || addressSpace === "storage")
        return "buffer";
    if (type.kind === "sampler")
        return "sampler";
    if (type.kind === "texture")
        return type.textureKind === "texture_external" ? "externalTexture" : "texture";
    return "unknown";
}
export function reflectedBindingLayout(kind, addressSpace, access, type, layout) {
    if (kind === "buffer")
        return reflectedBufferLayout(addressSpace, access, layout);
    if (type.kind === "sampler")
        return reflectedSamplerLayout(type);
    if (type.kind !== "texture")
        return undefined;
    if (type.textureKind === "texture_external")
        return { kind: "externalTexture", externalTexture: {} };
    if (type.textureKind.startsWith("texture_storage_"))
        return reflectedStorageTextureLayout(type);
    return reflectedSampledTextureLayout(type);
}
function reflectedBufferLayout(addressSpace, access, layout) {
    const bufferType = addressSpace === "uniform" ? "uniform" : access === "read" ? "read-only-storage" : "storage";
    return { kind: "buffer", buffer: { type: bufferType, hasDynamicOffset: false, minBindingSize: layout?.size } };
}
function reflectedSamplerLayout(type) {
    return { kind: "sampler", sampler: { type: type.comparison ? "comparison" : "filtering" } };
}
function reflectedStorageTextureLayout(type) {
    return {
        kind: "storageTexture",
        storageTexture: {
            access: storageTextureAccess(type.access),
            format: type.texelFormat ?? "rgba8unorm",
            viewDimension: textureViewDimension(type.dimension),
        },
    };
}
function reflectedSampledTextureLayout(type) {
    return {
        kind: "texture",
        texture: {
            sampleType: textureSampleType(type),
            viewDimension: textureViewDimension(type.dimension),
            multisampled: type.dimension === "multisampled_2d" || type.dimension === "depth_multisampled_2d",
        },
    };
}
function textureSampleType(type) {
    if (type.textureKind.startsWith("texture_depth_"))
        return "depth";
    const sample = type.sampleType;
    if (sample?.kind === "scalar" && sample.name === "i32")
        return "sint";
    if (sample?.kind === "scalar" && sample.name === "u32")
        return "uint";
    return "unfilterable-float";
}
function textureViewDimension(dimension) {
    switch (dimension) {
        case "1d":
            return "1d";
        case "2d_array":
        case "depth_2d_array":
            return "2d-array";
        case "cube":
        case "depth_cube":
            return "cube";
        case "cube_array":
        case "depth_cube_array":
            return "cube-array";
        case "3d":
            return "3d";
        default:
            return "2d";
    }
}
function storageTextureAccess(access) {
    if (access === "read")
        return "read-only";
    if (access === "read_write")
        return "read-write";
    return "write-only";
}
//# sourceMappingURL=reflect-bind-layout.js.map