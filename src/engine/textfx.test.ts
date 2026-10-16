import { describe, expect, it } from 'vitest';
import { composeEffects, extrudePlan, extrudeText, shade, textFxBatch, textFxClearBatch, TEXT_FX_PRESETS } from './textfx';
import { DocSession } from './session';
// @ts-expect-error plain JS module outside this TS project
import { TEXT_FX_PRESETS as SERVER_PRESETS, validateCall } from '../local/backend/workbench/tools.js';

const title = { id: 2, name: '标题', kind: 'Type', blend: 'normal', fill: 1, bounds: [100, 100, 400, 80], text: { text: '春季', font: 'Noto', sizePt: 72 } };
const info = { width: 1000, height: 800, resolution: 72, layers: [title, { id: 1, name: '背景', kind: 'Pixel', blend: 'normal', fill: 1, bounds: [0, 0, 1000, 800] }] } as never;

describe('text effects', () => {
  it('editor presets match the Admin catalog', () => {
    expect(Object.keys(TEXT_FX_PRESETS).sort()).toEqual(Object.keys(SERVER_PRESETS).sort());
  });
  it('every preset yields engine effects scaled to the text size', () => {
    for (const [name, p] of Object.entries(TEXT_FX_PRESETS)) {
      const fx = p.build({ u: 100 });
      expect(fx.length, name).toBeGreaterThan(0);
      for (const e of fx) for (const k of ['size', 'distance'] as const) if (typeof e.params[k] === 'number') expect(e.params[k] as number, `${name}.${k}`).toBeLessThanOrEqual(40);
    }
  });
  it('explicit effects replace the preset effect of the same kind', () => {
    const fx = composeEffects({ preset: 'sticker', effects: [{ kind: 'stroke', size: 3, color: '#ff0000' }] }, 100);
    expect(fx.filter((e) => e.kind === 'stroke')).toEqual([{ kind: 'stroke', params: { size: 3, color: '#ff0000' } }]);
    expect(fx.some((e) => e.kind === 'dropShadow')).toBe(true);
  });
  it('builds one replace + warp batch and refuses warp on non-type layers', () => {
    const args = { layer: 2, preset: 'gold', warp: { style: 'arc', bend: 25 } };
    expect(validateCall('text_fx_apply', args).ok).toBe(true);
    expect(textFxBatch(info, args).map((c) => c.cmd)).toEqual(['layer.layerStyle.replace', 'layer.select', 'type.warpText']);
    expect(() => textFxBatch(info, { layer: 1, warp: { style: 'arc' } })).toThrow(/文字图层/);
    expect(() => textFxBatch(info, { layer: 2 })).toThrow();
    expect(textFxClearBatch(info, 2).map((c) => c.cmd)).toEqual(['layer.layerStyle.clear', 'layer.select', 'type.warpText']);
  });
  it('extrusion slices go further and darker', () => {
    const plan = extrudePlan({ layer: 2, depth: 40, angle: 90, sideColor: '#808080' }, 100);
    expect(plan.at(-1)).toMatchObject({ dx: 0, dy: 40 });
    expect(plan.every((p, i) => i === 0 || p.dy >= plan[i - 1].dy)).toBe(true);
    expect(parseInt(plan.at(-1)!.color.slice(1, 3), 16)).toBeLessThan(0x80);
    expect(shade('#808080', 1)).toBe('#ffffff');
    expect(validateCall('text_extrude', { layer: 2, depth: 40, sideColor: '#333333' }).ok).toBe(true);
  });
  it('extrudeText duplicates, stacks below the face and groups', async () => {
    const sent: any[] = [];
    let rev = 1, next = 10;
    const client = {
      request(env: any): Promise<any> {
        if (env.batch[0].cmd === 'doc.inspect') return Promise.resolve({ ok: true, data: { status: 'ok', revision: rev, results: [{ value: info }] } });
        sent.push(env.batch);
        rev += 1;
        const cmd = env.batch.at(-1).cmd;
        const value = cmd === 'layer.duplicate' || cmd === 'layer.groupLayers' ? { layer: next++ } : {};
        return Promise.resolve({ ok: true, data: { status: 'ok', revision: rev, results: env.batch.map(() => ({ value })) } });
      },
    };
    const s = new (DocSession as any)(client, 'doc-1', []) as DocSession;
    (s as any).revision = 1;
    const out = await extrudeText(s, { layer: 2, depth: 20 });
    expect(out.slices.length).toBeGreaterThanOrEqual(2);
    const stack = sent.find((b) => b.some((c: any) => c.cmd === 'layer.moveTo'));
    expect(stack.filter((c: any) => c.cmd === 'layer.moveTo')[0].params).toMatchObject({ target: 2, position: 'below' });
    expect(sent.at(-1).at(-1)).toMatchObject({ cmd: 'layer.groupLayers' });
    expect(out.group).toBe(next - 1);
  });
});
