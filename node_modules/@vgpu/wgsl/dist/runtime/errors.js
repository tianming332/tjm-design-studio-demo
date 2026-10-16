export class VGPUError extends Error {
    code;
    line;
    column;
    severity;
    metadata;
    relatedDiagnostics;
    /** Actionable remediation text. Forwarded verbatim from the underlying error when there is one. */
    fix;
    /** Coarse origin of the failure (e.g. `"resolveShader"`), mirroring `@vgpu/core`'s `VGPUError`. */
    where;
    cause;
    constructor(code, message, line = 1, column = 1, severity = "error") {
        super(message);
        this.name = "VGPUError";
        this.code = code;
        this.line = line;
        this.column = column;
        this.severity = severity;
    }
}
/**
 * Builds a `WGSLError` carrying remediation metadata (`fix`/`where`/`cause`). Kept separate from
 * `wgslError` so the ~15 existing positional call sites stay untouched.
 */
export function wgslErrorWithFix(code, message, data = {}) {
    const error = new VGPUError(code, message, data.line ?? 1, data.column ?? 1, data.severity ?? "error");
    if (data.fix !== undefined)
        error.fix = data.fix;
    if (data.where !== undefined)
        error.where = data.where;
    if (data.cause !== undefined)
        error.cause = data.cause;
    if (data.metadata !== undefined)
        error.metadata = data.metadata;
    return error;
}
export function wgslError(code, message, line = 1, column = 1) { return new VGPUError(code, message, line, column); }
export function wgslWarning(code, message, line = 1, column = 1) { return new VGPUError(code, message, line, column, "warning"); }
//# sourceMappingURL=errors.js.map