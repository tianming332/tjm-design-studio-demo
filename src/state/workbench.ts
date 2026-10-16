// Shared backend state for the 设计 Agent and 素材 panels: capabilities and experience-code access.
import { create } from 'zustand';
import type { Capabilities } from '../ai/contract';
import { wbApi } from '../ai/api';

interface WbState {
  caps?: Capabilities;
  quota?: { used: number; limit: number; remaining: number; exhausted: boolean };
  offline?: string;
  codeError?: string;
  verifying: boolean;
  /** Set when an experience code was just verified: plays the AI 需求分解框 opening once. */
  introAt?: number;
  load(): Promise<void>;
  verifyCode(code: string): Promise<boolean>;
}

let loadVersion = 0;
export const useWb = create<WbState>((set, get) => ({
  verifying: false,
  async load() {
    const version = ++loadVersion;
    try {
      const [caps, session] = await Promise.all([wbApi.capabilities(), wbApi.session()]);
      if (version === loadVersion) set({ caps, quota: session.quota, offline: undefined });
    } catch (e) { if (version === loadVersion) set({ offline: (e as Error).message }); }
  },
  async verifyCode(code) {
    if (get().verifying) return false;
    ++loadVersion;
    set({ codeError: undefined, verifying: true });
    try {
      const result = await wbApi.verifyCode(code);
      if (!result.valid) throw new Error(result.message || '体验码无效');
      await get().load();
      if (get().offline) { set({ codeError: '体验码已验证，但余额刷新失败。请重新连接后查看。' }); return false; }
      set({ introAt: Date.now() });
      return true;
    } catch (e) { set({ codeError: (e as Error).message }); return false; }
    finally { set({ verifying: false }); }
  },
}));

/** True when this browser has a valid experience code (participant identity exists). */
export const hasAccess = (s: WbState) => !!s.quota && s.quota.limit > 0;
