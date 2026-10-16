import { discardClaimedGroupValidationResults, popClaimedGroupValidationScopes, } from "./claim-validation.js";
import { claimedGroupNativeValidationError } from "./errors.js";
/**
 * Ends a render pass and maps native end-time failures back to raw group claims.
 *
 * Raw WebGPU validation scopes are device-global, so this abort helper drains
 * only scopes still open after a failing pass end and suppresses every collected
 * validation promise before rethrowing. Callers pass the fallback context they
 * already used before this extraction so end-failure diagnostics stay unchanged.
 *
 * @internal
 */
export function endRenderPassWithClaimValidation(device, pass, validations, fallbackContext) {
    try {
        pass.end();
    }
    catch (error) {
        const scopes = popClaimedGroupValidationScopes(device);
        discardClaimedGroupValidationResults(validations);
        discardClaimedGroupValidationResults(scopes);
        validations.length = 0;
        const context = scopes[0]?.context ?? fallbackContext;
        if (context)
            throw claimedGroupNativeValidationError(context.label, context.group, error);
        throw error;
    }
}
//# sourceMappingURL=claim-validation-encode.js.map