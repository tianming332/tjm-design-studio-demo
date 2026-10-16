/**
 * The frame clock of a gpu, as a free function over the lazy frame-state service.
 *
 * `clock(gpu)` is the only public clock: `Frame` does not duplicate it. Reading it never creates
 * anything a frame would not have created anyway, and a program that never opens a frame and never
 * calls `clock()` never allocates the service.
 */
import { frameState } from "./frame-state.js";
import { assertDeviceUsable } from "./lifecycle.js";
import { gpuDisposedError, liveKernel } from "./live-kernel.js";
import { clockDeltaInvalidError } from "./errors.js";
import { serviceToken } from "./kernel.js";
/** One clock facade per gpu, so `clock(gpu) === clock(gpu)`. */
const clockToken = serviceToken("clock");
/**
 * The frame clock of `gpu`.
 *
 * Without `advance()`, every `frame()` moves `time` forward by the wall-clock delta since the last
 * frame — the default 0.1.x behavior. With `advance(dt)`, you own the clock for that frame.
 *
 * Throws `VGPU-GPU-DISPOSED` after `gpu.dispose()`.
 */
export function clock(gpu) {
    return createClock(liveKernel(gpu, "clock"));
}
function createClock(kernel) {
    return kernel.service(clockToken, (self) => {
        const state = frameState(self);
        const assertLive = (where) => {
            if (self.disposed)
                throw gpuDisposedError(where);
            // The clock is the frame-state entry point, and a retained external device can be lost or
            // destroyed by its owner while this gpu still looks alive. Reading or advancing then reports
            // state that can no longer reach a device, so re-check the device itself.
            assertDeviceUsable(self.device, where);
        };
        return {
            get time() { assertLive("clock.time"); return state.time; },
            get deltaTime() { assertLive("clock.deltaTime"); return state.deltaTime; },
            get frameCount() { assertLive("clock.frameCount"); return state.frameCount; },
            advance(dtSeconds) {
                assertLive("clock.advance");
                if (typeof dtSeconds !== "number" || !Number.isFinite(dtSeconds) || dtSeconds < 0)
                    throw clockDeltaInvalidError(dtSeconds);
                state.advanceBy(dtSeconds);
            },
        };
    });
}
//# sourceMappingURL=clock.js.map