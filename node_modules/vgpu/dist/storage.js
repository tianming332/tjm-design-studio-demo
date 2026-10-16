import { liveKernel, ownResource } from "./live-kernel.js";
/**
 * Storage buffer owned by this gpu: `read()`/`write()` from the host, bindable from any shader.
 *
 * `access` accepts the shorthand string or the options bag; `{ indirect: true }` adds the "indirect"
 * usage so the buffer can supply GPU-read draw/dispatch arguments. The buffer is destroyed by
 * `gpu.dispose()` — or earlier, by hand, through the internal handle.
 */
export function storage(gpu, bytes, access = "read-write") {
    const kernel = liveKernel(gpu, "storage");
    const opts = typeof access === "string" ? { access } : access;
    const buffer = createStorageBuffer(kernel.device, bytes, opts.access ?? "read-write", undefined, opts.indirect ?? false);
    return ownResource(kernel, buffer, (owned) => owned.destroy(), (cb) => { buffer.onDestroy(cb); });
}
/**
 * Ring-1 StorageBuffer facade backed by a core Buffer.
 *
 * @internal
 */
export class RingStorageBuffer {
    size;
    access;
    buffer;
    constructor(buffer, access) {
        this.buffer = buffer;
        this.access = access;
        this.size = buffer.options.size;
    }
    static create(device, bytes, access, label, indirect = false) {
        const usage = indirect ? ["storage", "copy_dst", "copy_src", "indirect"] : ["storage", "copy_dst", "copy_src"];
        const buffer = device.createBuffer({
            size: bytes,
            usage,
            label,
        });
        return new RingStorageBuffer(buffer, access);
    }
    read() {
        return this.buffer.read(this.size);
    }
    write(data, offset = 0) {
        this.buffer.write(asWriteData(data), offset);
    }
    get gpu() {
        return this.buffer.gpu;
    }
    get resourceIdentity() {
        return this.buffer.resourceIdentity;
    }
    onDestroy(cb) {
        return this.buffer.onDestroy(cb);
    }
    /** Frees the GPU allocation. Idempotent; bind groups holding it are invalidated through the buffer's destroy signal. */
    destroy() {
        this.buffer.destroy();
    }
}
export function createStorageBuffer(device, bytes, access, label, indirect = false) {
    return RingStorageBuffer.create(device, bytes, access, label, indirect);
}
/**
 * Wraps an existing core buffer as an internal StorageBuffer facade.
 *
 * @internal
 */
export function wrapStorageBuffer(buffer, access) {
    return new RingStorageBuffer(buffer, access);
}
function asWriteData(data) {
    if (data instanceof ArrayBuffer)
        return data;
    if (ArrayBuffer.isView(data))
        return data;
    throw new TypeError("StorageBuffer.write() requires ArrayBuffer or ArrayBufferView.");
}
//# sourceMappingURL=storage.js.map