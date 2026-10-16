// Types for the upstream JS module (kept unmodified).
import type { Gpu } from 'vgpu';
export declare const NOISE_VOLUME_SIZE: number;
export declare function createNoiseVolume(gpu: Gpu, size?: number, label?: string): ReturnType<Gpu['device']['createTexture']>;
export declare function noiseVolumeSampler(vgpu: typeof import('vgpu'), gpu: Gpu): GPUSampler;
