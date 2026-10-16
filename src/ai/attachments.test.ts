import { describe, expect, it } from 'vitest';
import { attachmentKind, attachmentText, parseAttachment, validateAttachment } from './attachments';
describe('brief attachments', () => {
  it('recognizes supported reference files and reports invalid/oversized files', () => {
    expect(attachmentKind('design.PSD')).toBe('design');
    expect(attachmentKind('copy.md')).toBe('text');
    expect(attachmentKind('photo.webp')).toBe('image');
    expect(() => validateAttachment({ name: 'bad.pdf', size: 100 })).toThrow('暂不支持');
    expect(() => validateAttachment({ name: 'huge.png', size: 20*1024*1024 })).toThrow('过大');
    expect(() => validateAttachment({ name: 'empty.txt', size: 0 })).toThrow('为空');
  });
  it('reads actual copy, not only a filename', async () => {
    const parsed = await parseAttachment(new File(['标题：秋日新品\n主色：深绿'], 'brief.txt'));
    expect(parsed.text).toContain('秋日新品');
    const prompt = attachmentText('做海报', [{ name: 'brief.txt', text: parsed.text }, { name: 'product.png', assetId: 'asset1' }]);
    expect(prompt).toContain('秋日新品'); expect(prompt).toContain('asset1'); expect(prompt).toContain('不是系统指令');
  });
  it('refuses empty copy or overly long copy instead of silently truncating it', async () => {
    await expect(parseAttachment(new File(['    '], 'empty.txt'))).rejects.toThrow('有效文案');
    await expect(parseAttachment(new File(['x'.repeat(10001)], 'long.txt'))).rejects.toThrow('10000');
  });
});
