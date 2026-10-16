import { wgslError } from "./errors.js";
export const ARRAY_LENGTH_FIXIT = "literal length required for auto layout; use draw.group(n, bg) manual binding";
export const BOOL_HOST_SHAREABLE_FIXIT = "VGPUError: `bool` is not host-shareable in uniform/storage. Fix: use `u32` (0 | 1) → struct Params { enabled: u32 }";
export const MANUAL_GROUP_FIXIT = "use a manual group claim (`draw.group(n, bg)`)";
export function arrayLengthError(line = 1, column = 1) {
    return wgslError("VGPU-WGSL-REFLECT-ARRAY-LENGTH", ARRAY_LENGTH_FIXIT, line, column);
}
export function boolHostShareableError(line = 1, column = 1) {
    return wgslError("VGPU-WGSL-REFLECT-BOOL-HOST-SHAREABLE", BOOL_HOST_SHAREABLE_FIXIT, line, column);
}
export function unknownTypeError(name, file, line = 1, column = 1) {
    return wgslError("VGPU-WGSL-REFLECT-UNKNOWN-TYPE", `type '${name}' is unknown in ${file}; ${MANUAL_GROUP_FIXIT}`, line, column);
}
export function namespaceTypeError(name, file, line = 1, column = 1) {
    return wgslError("VGPU-WGSL-REFLECT-NS-TYPE", `type '${name}' is a namespace-member import; use a named import or manual @group(1+) binding`, line, column);
}
export function unsupportedTypeError(name, line = 1, column = 1) {
    return wgslError("VGPU-WGSL-REFLECT-NON-HOST-SHAREABLE", `Type ${name} is not host-shareable; ${MANUAL_GROUP_FIXIT}`, line, column);
}
//# sourceMappingURL=diagnostics.js.map