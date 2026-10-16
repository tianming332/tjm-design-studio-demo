export class Shader {
    gpu;
    resolved;
    constructor(gpu, resolved) {
        this.gpu = gpu;
        this.resolved = resolved;
    }
    dispose() { }
    get kind() {
        return this.resolved.kind;
    }
    get source() {
        return this.resolved.source;
    }
    get code() {
        return this.resolved.wgsl;
    }
    get entryPoints() {
        return this.resolved.entryPoints;
    }
    get stats() {
        return this.resolved.stats;
    }
}
//# sourceMappingURL=shader.js.map