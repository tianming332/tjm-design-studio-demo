import { liveKernel } from "./live-kernel.js";
import { renderService } from "./render-service.js";
/**
 * Cached `GPUSampler` for this gpu: identical descriptors return the identical sampler, so bind
 * groups keyed on resource identity stay stable across frames.
 *
 * The cache lives in the gpu's render service — the same one `draw()` and `effect()` use — and is
 * created on first use, not at `init()`.
 */
export function sampler(gpu, desc) {
    return renderService(liveKernel(gpu, "sampler")).sampler(desc);
}
let nextSamplerId = 1;
export function createSamplerCache(device) {
    const byKey = new Map();
    const ids = new WeakMap();
    return {
        sampler(desc = {}) {
            const key = stableKey(desc);
            let sampler = byKey.get(key);
            if (!sampler) {
                sampler = device.gpu.createSampler(desc);
                byKey.set(key, sampler);
                ids.set(sampler, { kind: "sampler", id: nextSamplerId++ });
            }
            return sampler;
        },
        identity(sampler) {
            let id = ids.get(sampler);
            if (!id) {
                id = { kind: "sampler", id: nextSamplerId++ };
                ids.set(sampler, id);
            }
            return id;
        },
    };
}
function stableKey(value) {
    if (value === null || typeof value !== "object")
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(stableKey).join(",")}]`;
    const record = value;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableKey(record[key])}`).join(",")}}`;
}
//# sourceMappingURL=sampler.js.map