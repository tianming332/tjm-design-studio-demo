export class Queue {
    gpu;
    guard;
    constructor(gpu, guard = () => undefined) {
        this.gpu = gpu;
        this.guard = guard;
    }
    writeBuffer(buffer, offset, data) {
        this.guard("Queue.writeBuffer");
        this.gpu.writeBuffer(buffer, offset, data);
    }
    async flush() {
        this.guard("Queue.flush");
        await this.gpu.onSubmittedWorkDone?.();
        this.guard("Queue.flush");
    }
}
//# sourceMappingURL=queue.js.map