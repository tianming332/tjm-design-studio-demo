import { splitGeneric } from "./reflect-utils.js";
export function parseWorkgroupSize(attrs) {
    const attr = attrs.find((item) => item.name === "workgroup_size");
    if (!attr)
        return undefined;
    const values = splitGeneric(attr.args).map((part) => Number(part.map((token) => token.text).join("")));
    return [values[0] ?? 1, values[1] ?? 1, values[2] ?? 1];
}
//# sourceMappingURL=reflect-entry-points.js.map