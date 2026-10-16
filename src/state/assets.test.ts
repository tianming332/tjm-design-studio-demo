import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  state: { activeDocId: 'doc-a' as string | undefined, error: undefined as string | undefined, placeImage: vi.fn() },
  api: { assets: vi.fn(), generate: vi.fn(), assetBlob: vi.fn() },
}));
vi.mock('./store', () => ({ useStore: { getState: () => fake.state }, flatten: (v: unknown) => v }));
vi.mock('./agent', () => ({ rid: () => 'request-1', blobToDataUrl: vi.fn() }));
vi.mock('../ai/api', () => ({ wbApi: fake.api }));
import { useAssets } from './assets';
import { holdAI, releaseAI, useAIControl } from './aiControl';

const result = { status: 'succeeded', assetIds: ['image-1'], sent: { mock: true } };
beforeEach(() => {
  vi.clearAllMocks();
  useAIControl.setState({ held: false, epoch: 0, writes: 0, docId: undefined });
  fake.state.activeDocId = 'doc-a';
  fake.state.error = undefined;
  fake.state.placeImage.mockResolvedValue(undefined);
  fake.api.assets.mockResolvedValue([{ id: 'image-1', name: 'Generated' }]);
  fake.api.generate.mockResolvedValue(result);
  fake.api.assetBlob.mockResolvedValue(new Blob(['image'], { type: 'image/png' }));
  useAssets.setState({ items: [], generating: false, error: undefined, notice: undefined });
});
describe('image output placement', () => {
  it('generates once, stores the asset and places it in the original document', async () => {
    const actual = await useAssets.getState().generate({ prompt: 'test', size: '1024x1024' });
    expect(actual).toEqual({ count: 1, placed: true });
    expect(fake.state.placeImage).toHaveBeenCalledOnce();
    expect(useAssets.getState().notice).toContain('新建图层');
  });
  it('keeps results in the library if the document changes during generation', async () => {
    fake.api.generate.mockImplementationOnce(async () => { fake.state.activeDocId = 'doc-b'; return result; });
    expect(await useAssets.getState().generate({ prompt: 'test', size: '1024x1024' })).toEqual({ count: 1, placed: false });
    expect(fake.state.placeImage).not.toHaveBeenCalled();
    expect(useAssets.getState().notice).toContain('放入画布');
  });
  it('checks the document again after downloading generated image bytes', async () => {
    fake.api.assetBlob.mockImplementationOnce(async () => { fake.state.activeDocId = 'doc-b'; return new Blob(); });
    expect(await useAssets.getState().generate({ prompt: 'test', size: '1024x1024' })).toEqual({ count: 1, placed: false });
    expect(fake.state.placeImage).not.toHaveBeenCalled();
  });
  it('does not place an in-flight result after manual takeover, even if AI was released again', async () => {
    fake.api.generate.mockImplementationOnce(async () => { holdAI('doc-a'); releaseAI('doc-a'); return result; });
    expect(await useAssets.getState().generate({ prompt: 'background', size: '1024x1024' })).toEqual({ count: 1, placed: false });
    expect(fake.state.placeImage).not.toHaveBeenCalled();
  });
  it('does not start duplicate calls or claim success when no image was returned', async () => {
    useAssets.setState({ generating: true });
    expect(await useAssets.getState().generate({ prompt: 'test', size: '1024x1024' })).toBeUndefined();
    expect(fake.api.generate).not.toHaveBeenCalled();
    useAssets.setState({ generating: false });
    fake.api.generate.mockResolvedValueOnce({ ...result, assetIds: [] });
    expect(await useAssets.getState().generate({ prompt: 'test', size: '1024x1024' })).toBeUndefined();
    expect(useAssets.getState().error).toContain('未返回图片');
    expect(useAssets.getState().generating).toBe(false);
  });
});
