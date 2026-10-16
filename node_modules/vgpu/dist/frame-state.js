/**
 * Per-frame clock, as a lazy kernel service.
 *
 * This is the small "frame state" the core deliberately does not carry as public fields:
 * a program that never opens a frame never creates it. Registered through a token so the
 * kernel keeps no static reference to it. The public face of this service is `clock(gpu)`.
 */
import { serviceToken } from "./kernel.js";
import { frameReentrantError } from "./errors.js";
export const frameStateToken = serviceToken("frame-state");
/** Lazily creates the frame state of this kernel; repeated calls return the same instance. */
export function frameState(kernel) {
    return kernel.service(frameStateToken, createFrameState);
}
function createFrameState() {
    const hooks = new Set();
    let lastTimeMs = nowMs();
    let ticking = false;
    // True while a manual advance() owns this frame's tick: one advance per frame, manual wins.
    let manualPending = false;
    const state = {
        time: 0,
        deltaTime: 0,
        frameCount: 0,
        advanceBy(dtSeconds) {
            state.deltaTime = dtSeconds;
            state.time += dtSeconds;
            manualPending = true;
        },
        tick() {
            if (ticking)
                throw frameReentrantError();
            ticking = true;
            try {
                const next = nowMs();
                if (manualPending) {
                    // The clock already moved this frame; only re-base the wall clock so the next
                    // auto-advanced frame measures from this tick, not from the last automatic one.
                    manualPending = false;
                }
                else {
                    state.deltaTime = Math.max(0, (next - lastTimeMs) / 1000);
                    state.time += state.deltaTime;
                }
                lastTimeMs = next;
                state.frameCount += 1;
                for (const hook of [...hooks])
                    hook();
            }
            finally {
                ticking = false;
            }
        },
        onAdvance(hook) {
            hooks.add(hook);
            return () => { hooks.delete(hook); };
        },
    };
    return state;
}
function nowMs() { return globalThis.performance?.now?.() ?? Date.now(); }
//# sourceMappingURL=frame-state.js.map