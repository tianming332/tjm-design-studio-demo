import { describe, expect, it } from 'vitest';
import { assetPlacement, backgroundBaseCount, coversCanvas, placementRole } from './placement';
describe('asset placement', () => {
  it('covers a portrait/landscape canvas without stretching', () => {
    for (const canvas of [{width:2480,height:3508},{width:1920,height:1080}]) {
      const p = assetPlacement({role:'background'},canvas,[400,800,1024,1024]);
      expect(p.matrix[0]).toBe(p.matrix[3]); expect(coversCanvas(p.bounds,canvas.width,canvas.height)).toBe(true);
    }
  });
  it('contains a subject inside a specified layout frame', () => {
    const p=assetPlacement({role:'subject',fit:'contain',rect:[300,400,1000,800]},{width:2480,height:3508},[40,60,200,400]);
    expect(p.bounds).toEqual([600,400,400,800]);
    expect(p.matrix).toEqual([2,0,0,2,520,280]);
  });
  it('does not mistake a product image for a background', () => {
    expect(placementRole({name:'Product_Visual'})).toBe('subject');
    expect(placementRole({name:'AI 背景（模拟）'})).toBe('background');
    expect(placementRole({name:'background',role:'subject'})).toBe('subject');
  });
  it('places generated backgrounds above the immutable base, not behind it', () => {
    expect(backgroundBaseCount([{id:2,name:'标题',kind:'Type'},{id:1,name:'Background',kind:'Pixel'}],3,800,600)).toBe(1);
    expect(backgroundBaseCount([{id:4,name:'标题',kind:'Type'},{id:2,name:'Color Fill 1',kind:'Fill',bounds:[0,0,800,600]},{id:1,name:'Background',kind:'Pixel'}],3,800,600)).toBe(2);
  });
  it('rejects degenerate dimensions', () => {
    expect(()=>assetPlacement({role:'background'},{width:100,height:100},[0,0,0,50])).toThrow();
  });
});
