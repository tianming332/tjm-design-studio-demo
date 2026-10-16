import { attachBindGroupLayoutMetadata, attachBindGroupMetadata } from "./bind-group-metadata.js";
import { Buffer } from "./buffer.js";
import { Device } from "./device.js";
import { ValidationError } from "./errors.js";
import { Texture } from "./texture.js";
export function createBindGroupLayout(device, opts) {
    const layout = unwrapDevice(device).createBindGroupLayout({ label: opts.label, entries: [...opts.entries] });
    return attachBindGroupLayoutMetadata(layout, { entries: opts.entries });
}
export function createPipelineLayout(device, opts) {
    return unwrapDevice(device).createPipelineLayout({ label: opts.label, bindGroupLayouts: [...opts.bindGroups] });
}
export function createBindGroup(device, opts) {
    if (!opts.layout) {
        throw new ValidationError({
            code: "VGPU-CORE-BIND-GROUP-LAYOUT-REQUIRED",
            message: "createBindGroup requires an explicit layout. vgpu does not use layout: \"auto\" for bind groups.",
            where: "createBindGroup",
        });
    }
    const bindGroup = unwrapDevice(device).createBindGroup({ label: opts.label, layout: opts.layout, entries: [...opts.entries] });
    return attachBindGroupMetadata(bindGroup, opts.layout);
}
/**
 * Creates a WebGPU sampler from a raw `GPUSamplerDescriptor` plus vgpu sampler sugar.
 *
 * `filter` expands to `magFilter` and `minFilter` only; it does not set
 * `mipmapFilter`. `wrap` expands to `addressModeU`, `addressModeV`, and
 * `addressModeW` using vgpu shorthand values (`"clamp"`, `"repeat"`, `"mirror"`).
 *
 * Sugar expands first, then explicit raw WebGPU fields win per key. For example,
 * `{ filter: "linear", magFilter: "nearest" }` keeps `magFilter: "nearest"`
 * while using `minFilter: "linear"`; raw address mode fields similarly override
 * individual `wrap` axes. The sugar keys are stripped before calling WebGPU.
 *
 * Throws `ValidationError` when `filter` sugar is used with `maxAnisotropy > 1`
 * and the resulting descriptor does not explicitly set `magFilter`, `minFilter`,
 * and `mipmapFilter` to `"linear"`.
 */
export function createSampler(device, descriptor = {}) {
    return unwrapDevice(device).createSampler(expandSamplerDescriptor(descriptor));
}
const samplerWrapModes = {
    clamp: "clamp-to-edge",
    repeat: "repeat",
    mirror: "mirror-repeat",
};
function expandSamplerDescriptor(descriptor) {
    const { filter, wrap, ...raw } = descriptor;
    const expanded = {
        ...(filter ? { magFilter: filter, minFilter: filter } : {}),
        ...(wrap
            ? {
                addressModeU: samplerWrapModes[wrap],
                addressModeV: samplerWrapModes[wrap],
                addressModeW: samplerWrapModes[wrap],
            }
            : {}),
        ...raw,
    };
    if (filter !== undefined && expanded.maxAnisotropy !== undefined && expanded.maxAnisotropy > 1 && !samplerDescriptorHasAllLinearFilters(expanded)) {
        throw new ValidationError({
            code: "VGPU-CORE-SAMPLER-ANISOTROPY-FILTERS",
            message: 'createSampler requires magFilter, minFilter, and mipmapFilter to all be "linear" when maxAnisotropy > 1. The filter sugar only sets magFilter and minFilter; add mipmapFilter: "linear" explicitly for anisotropic sampling.',
            where: "createSampler",
        });
    }
    return expanded;
}
function samplerDescriptorHasAllLinearFilters(descriptor) {
    return descriptor.magFilter === "linear" && descriptor.minFilter === "linear" && descriptor.mipmapFilter === "linear";
}
export const bind = {
    uniform,
    storage,
    readonlyStorage,
    texture,
    storageTexture,
    sampler,
    resource,
};
function uniform(binding, visibility, opts = {}) {
    return { binding: explicitBinding(binding), visibility: visibilityFlags(visibility), buffer: { ...opts, type: "uniform" } };
}
function storage(binding, visibility, opts = {}) {
    return { binding: explicitBinding(binding), visibility: visibilityFlags(visibility), buffer: { ...opts, type: "storage" } };
}
function readonlyStorage(binding, visibility, opts = {}) {
    return { binding: explicitBinding(binding), visibility: visibilityFlags(visibility), buffer: { ...opts, type: "read-only-storage" } };
}
function texture(binding, visibility, opts = {}) {
    return { binding: explicitBinding(binding), visibility: visibilityFlags(visibility), texture: opts };
}
function storageTexture(binding, visibility, opts) {
    return { binding: explicitBinding(binding), visibility: visibilityFlags(visibility), storageTexture: opts };
}
function sampler(binding, visibility, opts = {}) {
    return { binding: explicitBinding(binding), visibility: visibilityFlags(visibility), sampler: opts };
}
function resource(binding, value) {
    return { binding: explicitBinding(binding), resource: unwrapBindingResource(value) };
}
function unwrapDevice(device) {
    return device instanceof Device ? device.gpu : "gpu" in device ? device.gpu : device;
}
function unwrapBindingResource(value) {
    if (value instanceof Buffer)
        return { buffer: value.gpu };
    if (value instanceof Texture)
        return value.createView();
    if (isVGPUTextureLike(value))
        return value.createView();
    if (isVGPUBufferLike(value))
        return { buffer: value.gpu };
    if (isGPUBufferBinding(value))
        return value;
    if (isRawGPUBuffer(value))
        return { buffer: value };
    return value;
}
function isGPUBufferBinding(value) {
    return isObject(value) && "buffer" in value;
}
function isRawGPUBuffer(value) {
    return isObject(value) && "size" in value && "usage" in value && typeof value.destroy === "function";
}
function isVGPUBufferLike(value) {
    return isObject(value) && isRawGPUBuffer(value.gpu);
}
function isVGPUTextureLike(value) {
    return isObject(value) && typeof value.createView === "function" && "gpu" in value;
}
function explicitBinding(binding) {
    if (!Number.isInteger(binding) || binding < 0) {
        throw new ValidationError({
            code: "VGPU-CORE-BINDING-INVALID",
            message: "Binding entries require an explicit non-negative integer binding number.",
            where: "bind",
        });
    }
    return binding;
}
function visibilityFlags(visibility) {
    if (typeof visibility === "number")
        return visibility;
    const names = typeof visibility === "string" ? visibility.split(/[|,\s]+/) : visibility;
    return names.reduce((flags, name) => flags | shaderStageFlag(name), 0);
}
function shaderStageFlag(name) {
    const key = name.trim().toLowerCase();
    const constants = globalThis.GPUShaderStage;
    const flags = { vertex: constants?.VERTEX ?? 1, fragment: constants?.FRAGMENT ?? 2, compute: constants?.COMPUTE ?? 4 };
    const flag = flags[key];
    if (!flag)
        throw new ValidationError({ code: "VGPU-CORE-VISIBILITY-INVALID", message: `Unknown shader stage visibility '${name}'.`, where: "bind" });
    return flag;
}
function isObject(value) {
    return typeof value === "object" && value !== null;
}
//# sourceMappingURL=bind.js.map