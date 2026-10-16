import { describe, expect, it } from 'vitest';
import { colorToHex, parseTypeInfo, styleParams, DEFAULT_TEXT_STYLE } from './typeinfo';

// Shape copied from a real PhotoCraft 0.6.0 `type.setStyle` reply.
const INFO = {
  orientation: 'Horizontal',
  text: 'Hi 你好',
  runs: [{
    start: 0, end: 5,
    style: {
      font_family: 'Inter', size_pt: 28, leading_pt: 34, tracking: 80,
      horizontal_scale: 0.9, vertical_scale: 1, baseline_shift_pt: 2,
      faux_bold: true, faux_italic: false, underline: true, strikethrough: false,
      caps: 'Normal', color: { c: [1, 0.5, 0, 0], mode: 'Rgb', alpha: 1 },
    },
  }],
  paragraphs: [{
    start: 0, end: 5,
    style: { align: 'Center', first_line_indent_pt: 6, space_before_pt: 0, space_after_pt: 4, hyphenate: true },
  }],
};

describe('parseTypeInfo', () => {
  it('maps engine read-back to UI values with unit conversion', () => {
    const ui = parseTypeInfo(INFO);
    expect(ui.font).toBe('Inter');
    expect(ui.size).toBe(28);
    expect(ui.leading).toBe(34);
    expect(ui.tracking).toBe(80);
    expect(ui.hScale).toBe(90); // 0.9 -> 90%
    expect(ui.vScale).toBe(100);
    expect(ui.baselineShift).toBe(2);
    expect(ui.fauxBold).toBe(true);
    expect(ui.underline).toBe(true);
    expect(ui.strikethrough).toBe(false);
    expect(ui.caps).toBe('normal');
    expect(ui.align).toBe('center'); // "Center" -> lowercase
    expect(ui.firstLineIndent).toBe(6);
    expect(ui.spaceAfter).toBe(4);
    expect(ui.hyphenate).toBe(true);
    expect(ui.orientation).toBe('horizontal');
    expect(ui.text).toBe('Hi 你好');
  });

  it('falls back to defaults for empty or malformed payloads', () => {
    expect(parseTypeInfo(undefined)).toEqual(DEFAULT_TEXT_STYLE);
    expect(parseTypeInfo({ runs: 'nope', paragraphs: 1 }).size).toBe(DEFAULT_TEXT_STYLE.size);
  });

  it('reads vertical orientation', () => {
    expect(parseTypeInfo({ ...INFO, orientation: 'Vertical' }).orientation).toBe('vertical');
  });
});

describe('colorToHex', () => {
  it('converts 0..1 components', () => {
    expect(colorToHex({ c: [1, 0.5, 0, 0] })).toBe('#ff8000');
    expect(colorToHex({ c: [0, 0, 0, 0] })).toBe('#000000');
  });
  it('falls back when the payload is unusable', () => {
    expect(colorToHex(undefined)).toBe('#000000');
    expect(colorToHex({ c: [1] }, '#123456')).toBe('#123456');
  });
});

describe('styleParams', () => {
  it('round-trips UI values back to command params', () => {
    const ui = parseTypeInfo(INFO);
    const p = styleParams(ui);
    expect(p.size).toBe(28);
    expect(p.tracking).toBe(80);
    expect(p.horizontalScale).toBe(90); // percent, not 0..1
    expect(p.align).toBe('center');
    expect(p.leading).toBe(34);
    expect(p.font).toBe('Inter');
    expect(p.underline).toBe(true);
  });

  it('omits auto leading and empty font', () => {
    const p = styleParams({ ...DEFAULT_TEXT_STYLE, leading: 0, font: '' });
    expect('leading' in p).toBe(false);
    expect('font' in p).toBe(false);
  });
});
