import { splitGeneric, normalizeAccess } from "./reflect-utils.js";
import { findNext } from "./reflect-token-utils.js";
export function parseVarTemplate(tokens, index) {
    if (tokens[index]?.text !== "<")
        return { after: index };
    const close = findNext(tokens, index, ">");
    const parts = splitGeneric(tokens.slice(index + 1, close)).map((part) => part.map((t) => t.text).join(""));
    return { addressSpace: parts[0], access: normalizeAccess(parts[1]), after: close + 1 };
}
//# sourceMappingURL=reflect-vars.js.map