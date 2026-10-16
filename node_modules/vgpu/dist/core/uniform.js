import { bind, createBindGroup, createBindGroupLayout } from "@vgpu/core";
const defaultVisibility = ((globalThis.GPUShaderStage?.VERTEX ?? 1) | (globalThis.GPUShaderStage?.FRAGMENT ?? 2));
/**
 * A single stable uniform buffer for one render pass, rewritten per frame.
 *
 * @remarks
 * Unlike {@link UniformPool} (a dynamic-offset ring allocator built for many
 * per-draw uniforms), `Uniform` owns exactly one uniform buffer at binding 0 with
 * a fixed (non-dynamic) offset. The caller decides when to {@link Uniform.write}
 * — typically gating on real changes — and the bind group never moves. This fits
 * the "one camera/globals buffer per pass" case where a dynamic-offset binding
 * would needlessly mark the layout `hasDynamicOffset` and re-upload every frame.
 *
 * @example
 * ```ts
 * const uniform = new Uniform(device, { size: 64, label: "globals" });
 * // per frame, only when inputs changed:
 * uniform.write(globalsBytes);
 * pass.setBindGroup(0, uniform.bindGroup);
 * ```
 */
export class Uniform {
    device;
    size;
    buffer;
    bindGroupLayout;
    bindGroup;
    #destroyed = false;
    constructor(device, opts) {
        this.device = device;
        this.size = opts.size;
        this.buffer = device.createBuffer({ size: opts.size, usage: ["uniform", "copy_dst"], label: opts.label });
        this.bindGroupLayout = opts.bindGroupLayout ?? createBindGroupLayout(device, {
            label: opts.label ? `${opts.label}.bgl` : undefined,
            entries: [bind.uniform(0, opts.visibility ?? defaultVisibility, { minBindingSize: opts.size })],
        });
        this.bindGroup = createBindGroup(device, {
            label: opts.label ? `${opts.label}.bg` : undefined,
            layout: this.bindGroupLayout,
            entries: [bind.resource(0, this.buffer)],
        });
    }
    /** The underlying uniform `GPUBuffer`. */
    get gpu() {
        return this.buffer.gpu;
    }
    /**
     * Upload `data` to the buffer via `queue.writeBuffer`. No dynamic offset; the
     * bind group is unchanged. Call only when the uniform contents actually change.
     */
    write(data, offset = 0) {
        this.buffer.write(data, offset);
    }
    destroy() {
        if (this.#destroyed)
            return;
        this.#destroyed = true;
        this.buffer.destroy();
    }
    dispose() {
        this.destroy();
    }
}
//# sourceMappingURL=uniform.js.map