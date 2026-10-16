// Local edition: the Admin's AI settings, moved into the editor. Keys, models and the model
// library are stored in this browser only (src/local/server.js); nothing goes to a TJM server.
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { localAdmin } from '../local/server.js';
import { useWb } from '../state/workbench';
import { Modal } from './Modal';

export const useAISettings = create<{ open: boolean }>(() => ({ open: false }));
export const openAISettings = () => useAISettings.setState({ open: true });

type Vendor = 'gemini' | 'openai' | 'anthropic';
interface VendorState { keySaved: boolean; keyMasked: string; baseUrl: string }
interface Model { provider: Vendor; id: string; label: string; uses: string[]; enabled: boolean }
interface State {
  config: { models: { agent: string; agentProvider: Vendor; imageProvider: 'gemini' | 'openai'; openaiImage: string }; verified: { agent?: { model: string; provider?: string } } };
  vendors: Record<Vendor, VendorState>;
  models: Model[];
  gemini: { textModel: string; editModel: string };
}

const LABEL: Record<Vendor, string> = { gemini: 'Google Gemini', openai: 'OpenAI（GPT）', anthropic: 'Anthropic（Claude）' };
const KEY_HINT: Record<Vendor, string> = { gemini: 'aistudio.google.com 申请', openai: 'platform.openai.com 申请', anthropic: 'console.anthropic.com 申请' };

function VendorRow({ id, v, onSaved }: { id: Vendor; v: VendorState; onSaved: (s: State) => void }) {
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<void>) => { setBusy(true); setMsg(''); try { await fn(); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); } };
  return <div className="ai-vendor-row">
    <div><strong>{LABEL[id]}</strong><small>{v.keySaved ? `已保存 ${v.keyMasked}` : `未填写 · ${KEY_HINT[id]}`}</small></div>
    <input type="password" autoComplete="off" aria-label={`${LABEL[id]} API Key`} placeholder={v.keySaved ? '粘贴新 Key 以替换' : '粘贴 API Key'} value={key} onChange={(e) => setKey(e.target.value)} />
    <div className="ai-vendor-actions">
      <button className="primary" disabled={busy || !key.trim()} onClick={() => void act(async () => { onSaved(await localAdmin('providers/' + id, 'PUT', { apiKey: key.trim() })); setKey(''); setMsg('已保存'); })}>保存</button>
      <button disabled={busy || !v.keySaved} onClick={() => void act(async () => { const r = await localAdmin<{ models: unknown[]; latencyMs: number }>(`providers/${id}/models`, 'POST', {}); setMsg(`Key 可用，官方模型 ${r.models.length} 个（${r.latencyMs} ms）`); })}>测试</button>
      <button className="text-button" disabled={busy || !v.keySaved} onClick={() => void act(async () => { onSaved(await localAdmin('providers/' + id, 'PUT', { clearKey: true })); setMsg('已清除'); })}>清除</button>
    </div>
    {msg && <p className="muted ai-vendor-msg" role="status">{msg}</p>}
  </div>;
}

export function AISettings() {
  const [s, setS] = useState<State>();
  const [error, setError] = useState('');
  const [probe, setProbe] = useState('');
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<{ provider: Vendor; models: { id: string; label: string }[] }>();
  const [form, setForm] = useState({ agentProvider: 'gemini' as Vendor, agent: '', imageProvider: 'gemini' as 'gemini' | 'openai', openaiImage: '', textModel: '', editModel: '' });
  const load = async () => {
    const st = await localAdmin<State>('state');
    const g = await localAdmin<{ textModel: string; editModel: string }>('gemini');
    const full = { ...st, gemini: g };
    setS(full);
    setForm({ agentProvider: st.config.models.agentProvider, agent: st.config.models.agent, imageProvider: st.config.models.imageProvider, openaiImage: st.config.models.openaiImage, textModel: g.textModel, editModel: g.editModel });
  };
  useEffect(() => { load().catch((e) => setError((e as Error).message)); }, []);
  const close = () => { useAISettings.setState({ open: false }); void useWb.getState().load(); };
  const options = (provider: Vendor, use: string) => (s?.models ?? []).filter((m) => m.enabled && m.provider === provider && m.uses.includes(use));
  const save = async () => {
    setBusy(true); setError('');
    try {
      await localAdmin('config', 'PUT', { models: { agentProvider: form.agentProvider, agent: form.agent.trim(), imageProvider: form.imageProvider, openaiImage: form.openaiImage.trim() } });
      await localAdmin('gemini', 'PUT', { textModel: form.textModel.trim(), editModel: form.editModel.trim() });
      await load();
      void useWb.getState().load();
      setProbe('已保存');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const runProbe = async () => {
    setBusy(true); setProbe('探测中…（真实调用 2 次）');
    try {
      const r = await localAdmin<{ ok: boolean; checks: { name: string; ok: boolean; detail: string }[] }>('probe', 'POST', {});
      setProbe(`${r.ok ? '通过' : '未通过'}\n${r.checks.map((c) => `${c.ok ? '✓' : '✗'} ${c.name}：${c.detail}`).join('\n')}`);
      await load(); void useWb.getState().load();
    } catch (e) { setProbe((e as Error).message); } finally { setBusy(false); }
  };
  const discover = async (provider: Vendor) => {
    setError('');
    try { setFound({ provider, ...(await localAdmin<{ models: { id: string; label: string }[] }>(`providers/${provider}/models`, 'POST', {})) }); }
    catch (e) { setError((e as Error).message); }
  };
  const addModel = async (provider: Vendor, id: string, label: string) => {
    const uses = /image|imagen|dall-e/i.test(id) ? ['image'] : provider === 'gemini' ? ['agent', 'text'] : ['agent'];
    const next = [...(s?.models ?? []), { provider, id, label, uses, enabled: true }];
    try { const st = await localAdmin<State>('models', 'PUT', { models: next }); setS((old) => old && { ...old, models: st.models }); }
    catch (e) { setError((e as Error).message); }
  };
  const verified = s?.config.verified.agent && s.config.verified.agent.model === s.config.models.agent && (s.config.verified.agent.provider || 'gemini') === s.config.models.agentProvider;
  const datalist = (id: string, list: Model[]) => <datalist id={id}>{list.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</datalist>;
  return (
    <Modal title="设置 · AI" onClose={close} className="appearance-modal ai-settings-modal" dismissDisabled={busy}>
      <div className="modal-body">
        {!s ? <p className="muted">{error || '读取本地设置…'}</p> : <>
          <section className="settings-section">
            <div className="section-title"><h3>服务商 Key</h3><span className="subtle-badge">仅保存在此浏览器</span></div>
            <p className="muted">浏览器直接连接官方接口，不经过任何中转服务器。体验时建议使用可随时删除的临时 Key，并在服务商后台设置用量上限；用完可在这里清除。</p>
            {(['gemini', 'openai', 'anthropic'] as const).map((id) => <VendorRow key={id} id={id} v={s.vendors[id]} onSaved={(st) => setS((old) => old && { ...old, vendors: st.vendors })} />)}
          </section>
          <section className="settings-section">
            <div className="section-title"><h3>设计 Agent</h3><span className="subtle-badge">{verified ? '已验证' : '未探测'}</span></div>
            <div className="ai-form-grid">
              <label>Agent 服务商<select value={form.agentProvider} onChange={(e) => setForm({ ...form, agentProvider: e.target.value as Vendor })}><option value="gemini">Gemini</option><option value="openai">OpenAI（GPT）</option><option value="anthropic">Anthropic（Claude）</option></select></label>
              <label>Agent 模型<input list="ai-dl-agent" value={form.agent} placeholder="从模型库选择或直接填写" onChange={(e) => setForm({ ...form, agent: e.target.value })} />{datalist('ai-dl-agent', options(form.agentProvider, 'agent'))}</label>
              <label>AI 生图服务商<select value={form.imageProvider} onChange={(e) => setForm({ ...form, imageProvider: e.target.value as 'gemini' | 'openai' })}><option value="gemini">Gemini</option><option value="openai">OpenAI（GPT Image）</option></select></label>
              {form.imageProvider === 'openai'
                ? <label>OpenAI 生图模型<input list="ai-dl-oimg" value={form.openaiImage} onChange={(e) => setForm({ ...form, openaiImage: e.target.value })} />{datalist('ai-dl-oimg', options('openai', 'image'))}</label>
                : <><label>Gemini 文生图模型<input list="ai-dl-gimg" value={form.textModel} onChange={(e) => setForm({ ...form, textModel: e.target.value })} /></label>
                  <label>Gemini 图生图／编辑模型<input list="ai-dl-gimg" value={form.editModel} onChange={(e) => setForm({ ...form, editModel: e.target.value })} />{datalist('ai-dl-gimg', options('gemini', 'image'))}</label></>}
            </div>
            <p className="muted">Claude 不能生图；用 Claude 做 Agent 时，生图仍走上面选的生图服务商。</p>
            <div className="settings-row"><button className="primary" disabled={busy} onClick={() => void save()}>保存模型设置</button><button disabled={busy || !form.agent} onClick={() => void runProbe()}>能力探测</button></div>
            {probe && <pre className="ai-probe" role="status">{probe}</pre>}
          </section>
          <section className="settings-section">
            <div className="section-title"><h3>模型库</h3><span className="subtle-badge">{s.models.length} 个</span></div>
            <p className="muted">用已保存的 Key 获取官方模型列表，加入后会出现在上方模型框的候选里。</p>
            <div className="settings-row">{(['gemini', 'openai', 'anthropic'] as const).map((p) => <button key={p} disabled={!s.vendors[p].keySaved} onClick={() => void discover(p)}>获取 {p === 'gemini' ? 'Gemini' : p === 'openai' ? 'GPT' : 'Claude'} 模型</button>)}</div>
            <div className="ai-model-chips">{s.models.map((m) => <span key={`${m.provider}:${m.id}`} className="subtle-badge" title={m.uses.join(' / ')}>{m.id}</span>)}</div>
            {found && <div className="ai-discover">{found.models.map((m) => {
              const has = s.models.some((x) => x.provider === found.provider && x.id === m.id);
              return <div key={m.id}><code>{m.id}</code><small>{m.label}</small>{has ? <span className="muted">已添加</span> : <button className="text-button" onClick={() => void addModel(found.provider, m.id, m.label)}>＋ 添加</button>}</div>;
            })}</div>}
          </section>
        </>}
        {error && s && <p role="alert" className="inline-error">{error}</p>}
      </div>
      <footer className="modal-footer"><span className="muted">设置与作品只保存在此浏览器（清除浏览器数据会一并删除）</span><button className="primary" disabled={busy} onClick={close}>完成</button></footer>
    </Modal>
  );
}
