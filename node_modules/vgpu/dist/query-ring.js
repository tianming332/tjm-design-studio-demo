import { queryReadbackError } from "./errors.js";
/**
 * Bytes each resolved query occupies: WebGPU resolveQuerySet writes each result
 * "into a GPUBuffer ... as a 64-bit unsigned integer" (8 bytes per query).
 *
 * @internal
 */
export const QUERY_RESULT_BYTES = 8;
/** GPUMapMode.READ; numeric fallback covers headless/mock runtimes without the global. */
const MAP_READ = (globalThis.GPUMapMode?.READ ?? 1);
/** @internal */
export function createQueryRing(device, options) {
    return new InternalQueryRing(device, options);
}
class InternalQueryRing {
    querySet;
    capacity;
    #label;
    #resolve;
    #stagings;
    #trackSettled;
    #errorSink;
    #cursor = 0;
    #nextSeq = 0;
    #appliedSeq = -1;
    #pendingEncode;
    #inFlight = 0;
    /** Frames that bound querySet into a pass descriptor and have not been submitted/abandoned yet. */
    #retained = 0;
    #disposed = false;
    #destroyed = false;
    constructor(device, options) {
        this.capacity = options.capacity;
        const label = options.label ?? "vgpu.query-ring";
        this.#label = label;
        const byteSize = options.capacity * QUERY_RESULT_BYTES;
        this.querySet = device.gpu.createQuerySet({ type: options.type, count: options.capacity, label });
        // Mirrors WebGPU resolveQuerySet requirements: "destination.usage contains QUERY_RESOLVE" and
        // "destinationOffset + 8 × queryCount ≤ destination.size" (we always resolve at offset 0, a multiple of 256).
        this.#resolve = device.createBuffer({ size: byteSize, usage: ["query_resolve", "copy_src"], label: `${label}.resolve` });
        this.#stagings = Array.from({ length: options.depth ?? 3 }, (_, index) => ({
            buffer: device.createBuffer({ size: byteSize, usage: ["map_read", "copy_dst"], label: `${label}.staging${index}` }),
            mapPending: false,
            retired: false,
        }));
        this.#trackSettled = options.trackSettled;
        this.#errorSink = options.errorSink;
    }
    encodeResolve(encoder, usedCount) {
        this.#pendingEncode = undefined;
        if (this.#disposed || usedCount <= 0)
            return false;
        const staging = this.#claimStaging();
        // Drop, never block: when readbacks lag frames-in-flight past the ring depth, skip this frame's resolve entirely.
        if (!staging)
            return false;
        const count = Math.min(usedCount, this.capacity);
        encoder.resolveQuerySet(this.querySet, 0, count, this.#resolve.gpu, 0);
        encoder.copyBufferToBuffer(this.#resolve.gpu, 0, staging.buffer.gpu, 0, count * QUERY_RESULT_BYTES);
        this.#pendingEncode = { staging, usedCount: count, seq: this.#nextSeq };
        this.#nextSeq += 1;
        this.#cursor += 1;
        return true;
    }
    onSubmitted(apply) {
        const pending = this.#pendingEncode;
        this.#pendingEncode = undefined;
        if (!pending)
            return;
        pending.staging.mapPending = true;
        this.#inFlight += 1;
        const readback = pending.staging.buffer.gpu.mapAsync(MAP_READ)
            .then(() => {
            // The buffer is mapped from here on: it must be unmapped before the slot rotates back into
            // use, even if decoding throws — resolving into a mapped buffer is a validation error.
            const values = this.#decodeMapped(pending);
            // Ordered application: a stale readback that lands after a newer one already applied is discarded.
            if (pending.seq <= this.#appliedSeq)
                return;
            this.#appliedSeq = pending.seq;
            apply(values);
        })
            // Non-throwing by contract, but never silent: a dropped readback is reported on gpu.onError.
            .catch((cause) => { this.#reportDroppedReadback(cause); })
            .finally(() => {
            pending.staging.mapPending = false;
            this.#inFlight -= 1;
            this.#destroyWhenIdle();
        });
        this.#trackSettled?.(readback);
    }
    /**
     * Next staging buffer in rotation, skipping retired slots. Undefined means "drop this resolve":
     * the slot is still map-pending (readbacks lag the ring depth) or every slot is retired.
     */
    #claimStaging() {
        for (let checked = 0; checked < this.#stagings.length; checked += 1) {
            const slot = this.#stagings[this.#cursor % this.#stagings.length];
            if (!slot.retired)
                return slot.mapPending ? undefined : slot;
            // Permanently unusable: rotate past it so the remaining buffers keep serving readbacks.
            this.#cursor += 1;
        }
        return undefined;
    }
    /**
     * Copies the mapped range out and unmaps, keeping the slot reusable. A failure here (a lost device
     * mid-map) still unmaps best-effort; if that fails too the buffer may stay mapped forever, so the
     * slot is retired instead of being handed back to encodeResolve. Throws so the readback is dropped
     * and reported like any other failure.
     */
    #decodeMapped(pending) {
        let values;
        try {
            values = new BigUint64Array(pending.staging.buffer.gpu.getMappedRange().slice(0, pending.usedCount * QUERY_RESULT_BYTES));
        }
        catch (error) {
            this.#unmapOrRetire(pending.staging);
            throw error;
        }
        try {
            pending.staging.buffer.gpu.unmap();
        }
        catch (error) {
            pending.staging.retired = true;
            throw error;
        }
        return values;
    }
    #unmapOrRetire(staging) {
        try {
            staging.buffer.gpu.unmap();
        }
        catch {
            staging.retired = true;
        }
    }
    retain() {
        this.#retained += 1;
    }
    release() {
        if (this.#retained > 0)
            this.#retained -= 1;
        this.#destroyWhenIdle();
    }
    dispose() {
        if (this.#disposed)
            return;
        this.#disposed = true;
        this.#pendingEncode = undefined;
        this.#destroyWhenIdle();
    }
    /** Destroys once disposed and idle: no in-flight map and no frame still referencing the query set. */
    #destroyWhenIdle() {
        if (!this.#disposed || this.#destroyed || this.#inFlight > 0 || this.#retained > 0)
            return;
        this.#destroyed = true;
        this.querySet.destroy();
        this.#resolve.dispose();
        for (const staging of this.#stagings)
            staging.buffer.dispose();
    }
    #reportDroppedReadback(cause) {
        const error = queryReadbackError(this.#label, cause);
        const sink = this.#errorSink;
        if (!sink) {
            console.error(error);
            return;
        }
        try {
            void Promise.resolve(sink(error)).catch((sinkError) => { console.error(sinkError); });
        }
        catch (sinkError) {
            console.error(sinkError);
        }
    }
}
//# sourceMappingURL=query-ring.js.map