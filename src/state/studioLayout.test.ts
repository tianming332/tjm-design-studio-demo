import { describe, expect, it } from 'vitest';
import { fitToolWindow, parseStudioLayout } from './studioLayout';
describe('AI layout', () => {
  it('defaults to a stable split and rejects non-finite saved rectangles', () => {
    expect(parseStudioLayout(null)).toEqual({ agentShare: 43, propertiesShare: 42, showProperties: true, showLayers: true });
    expect(parseStudioLayout({ agentShare: 95, tools: { x: NaN, y: 1, width: 300, height: 500 } })).toEqual({ agentShare: 55, propertiesShare: 42, showProperties: true, showLayers: true });
    expect(parseStudioLayout({ showProperties: false })).toMatchObject({ showProperties: false, showLayers: true });
  });
  it('keeps floating canvas tools on screen when the viewport shrinks', () => {
    const r = fitToolWindow({ x: 900, y: 900, width: 300, height: 600 }, 250, 300);
    expect(r.x + r.width).toBeLessThanOrEqual(250);
    expect(r.y + r.height).toBeLessThanOrEqual(300);
  });
});
