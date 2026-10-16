export class VGPUError extends Error {
    code;
    severity;
    fix;
    where;
    cause;
    detail;
    constructor(data) {
        super(data.message, { cause: data.cause });
        this.name = "VGPUError";
        this.code = data.code;
        this.severity = data.severity ?? "error";
        this.fix = data.fix;
        this.where = data.where;
        this.cause = data.cause;
        this.detail = data.detail;
    }
}
export class ValidationError extends VGPUError {
    constructor(data) {
        super({ ...data, severity: "error" });
        this.name = "ValidationError";
    }
}
export function unsupportedFeaturesError(missing) {
    return new VGPUError({
        code: "VGPU-FEATURE-UNSUPPORTED",
        message: `Adapter does not support requested feature(s): ${missing.map((name) => `"${name}"`).join(", ")}.`,
        fix: "Remove the unsupported name(s) from init({ requiredFeatures: [...] }) or run on an adapter that supports them; gate optional code paths on device.features after init.",
        where: "init",
    });
}
/** Adapters call this before requestDevice so an unsupported requiredFeatures entry fails init with VGPU-FEATURE-UNSUPPORTED instead of a native rejection. An adapter that reports no feature set cannot be pre-checked; native requestDevice validation still applies. */
export function validateRequiredFeatures(supported, required) {
    if (!supported)
        return;
    const missing = (required ?? []).filter((feature) => !supported.has(feature));
    if (missing.length)
        throw unsupportedFeaturesError(missing);
}
//# sourceMappingURL=errors.js.map