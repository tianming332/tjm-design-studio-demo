import { wgslError } from "./errors.js";
import { parseModule } from "./parser.js";
import { reflect } from "./reflect.js";
import { scan } from "./scanner.js";
/**
 * Reflects one raw WGSL string through the same scanner/parser/ReflectionFacade path as resolveShader().
 * This intentionally rejects WGSL import graphs; use resolveShader() when imports must be loaded/mangled.
 */
export function reflectSource(wgsl, path = "<runtime>") {
    const tokens = scan(wgsl, path);
    const parsed = parseModule(tokens);
    if (parsed.imports.length > 0) {
        throw wgslError("VGPU-WGSL-REFLECT-SOURCE-IMPORT", "reflectSource() accepts a single raw WGSL string; use resolveShader() for WGSL import graphs.");
    }
    return reflect([{ path, source: wgsl, tokens, parsed }]);
}
//# sourceMappingURL=reflect-source.js.map