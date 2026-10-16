import { Buffer } from "@vgpu/core";
export class RenderBundleRecorder {
    gpu;
    constructor(gpu) {
        this.gpu = gpu;
    }
    setPipeline(pipeline) {
        this.gpu.setPipeline(pipeline);
    }
    setBindGroup(index, group, dynamicOffsets) {
        this.gpu.setBindGroup(index, group, dynamicOffsets);
    }
    setVertexBuffer(slot, buffer, offset = 0, size) {
        this.gpu.setVertexBuffer(slot, gpuBuffer(buffer), offset, size);
    }
    draw(optionsOrVertexCount, instanceCount = 1, firstVertex = 0, firstInstance = 0) {
        if (typeof optionsOrVertexCount === "number") {
            this.gpu.draw(optionsOrVertexCount, instanceCount, firstVertex, firstInstance);
            return;
        }
        this.gpu.draw(optionsOrVertexCount.vertexCount, optionsOrVertexCount.instanceCount ?? 1, optionsOrVertexCount.firstVertex ?? 0, optionsOrVertexCount.firstInstance ?? 0);
    }
}
export function createRenderBundle(device, opts) {
    const encoder = device.gpu.createRenderBundleEncoder({
        label: opts.label,
        colorFormats: opts.colorFormats,
        depthStencilFormat: opts.depthStencilFormat,
        sampleCount: opts.sampleCount,
        depthReadOnly: opts.depthReadOnly,
        stencilReadOnly: opts.stencilReadOnly,
    });
    opts.record(new RenderBundleRecorder(encoder));
    return encoder.finish({ label: opts.label });
}
function gpuBuffer(buffer) {
    return buffer instanceof Buffer ? buffer.gpu : buffer;
}
//# sourceMappingURL=render-bundle.js.map