export function isMockGPUBuffer(buffer) {
    return "__vgpuMockBytes" in buffer;
}
export function isMockGPUTexture(texture) {
    return "__vgpuMockBytes" in texture;
}
//# sourceMappingURL=mock-gpu-storage.js.map