export { createCoreGpu as createGpu } from "./kernel.js";
export { initFromDevice } from "./init-from-device.js";
import { createCoreGpu } from "./kernel.js";
export function initWithAdapter(entry, adapterFactory, options) {
    return createCoreGpu(entry, options, adapterFactory);
}
//# sourceMappingURL=init.js.map