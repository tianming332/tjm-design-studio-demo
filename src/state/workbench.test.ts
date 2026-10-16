import { beforeEach, describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ verifyCode: vi.fn(), capabilities: vi.fn(), session: vi.fn() }));
vi.mock('../ai/api', () => ({ wbApi: api }));
import { useWb } from './workbench';
beforeEach(() => {
  vi.resetAllMocks();
  useWb.setState({ verifying: false, codeError: undefined, offline: undefined, quota: { used: 5, limit: 5, remaining: 0, exhausted: true } });
  api.capabilities.mockResolvedValue({ aiEnabled: true });
  api.session.mockResolvedValue({ quota: { used: 0, limit: 10, remaining: 10, exhausted: false } });
});
describe('experience code replacement', () => {
  it('replaces an exhausted code and refreshes quota', async () => {
    api.verifyCode.mockResolvedValue({ valid: true });
    expect(await useWb.getState().verifyCode('new')).toBe(true);
    expect(useWb.getState().quota?.remaining).toBe(10);
    expect(useWb.getState().verifying).toBe(false);
  });
  it('preserves old quota and reports invalid new code', async () => {
    api.verifyCode.mockResolvedValue({ valid: false, message: '无效体验码' });
    expect(await useWb.getState().verifyCode('bad')).toBe(false);
    expect(useWb.getState().quota?.remaining).toBe(0);
    expect(useWb.getState().codeError).toBe('无效体验码');
  });
  it('does not report refreshed balance after a session refresh failure', async () => {
    api.verifyCode.mockResolvedValue({ valid: true }); api.session.mockRejectedValue(new Error('offline'));
    expect(await useWb.getState().verifyCode('new')).toBe(false);
    expect(useWb.getState().codeError).toContain('余额刷新失败');
  });
});
