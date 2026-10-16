import { describe, expect, it } from 'vitest';
import { AI_OUTPUTS, AI_ASPECTS, creationPrompt, creationSize } from './creation';

describe('unified AI creation', () => {
  it('uses image-supported dimensions for flat posters and material assets', () => {
    for (const aspect of AI_ASPECTS) {
      for (const output of ['poster', 'asset'] as const) {
        expect(['1024x1536', '1024x1024', '1536x1024']).toContain(creationSize(output, aspect.id).join('x'));
      }
    }
    expect(creationSize('layered', 'portrait')).toEqual([1080, 1440]);
  });
  it('distinguishes flat image output from editable layered construction without altering the user brief', () => {
    const brief = '标题「春季新品」，保留原素材';
    expect(creationPrompt('poster', brief)).toContain('同一张图片');
    expect(creationPrompt('asset', brief)).toContain('不额外添加海报标题');
    expect(creationPrompt('layered', brief)).toContain('独立可编辑图层');
    for (const output of AI_OUTPUTS) expect(creationPrompt(output.id, brief)).toContain(brief);
  });
});
