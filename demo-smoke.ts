// Local-edition smoke: the in-page backend (no server). ?mock=1 runs the simulated model for the
// full agent workflow; a real-vendor probe runs against intercepted official endpoints.
import { createServer } from 'vite';
import { chromium, type Page } from 'playwright';

type W = any;
const server = await createServer({ server: { port: 5192, strictPort: true, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const BASE = 'http://127.0.0.1:5192/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const r: Record<string, any> = {};
const errors: string[] = [];
// tsx keeps function names via a `__name` helper that page.evaluate bodies do not have.
const watch = (p: Page) => { p.on('pageerror', (e) => errors.push(e.message)); void p.addInitScript('window.__name = (f) => f'); };

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage(); watch(page);
  await page.goto(`${BASE}?mock=1`);
  await page.waitForFunction(() => !!(window as W).__tjmWb.getState().caps, null, { timeout: 30_000 });
  r.noExperienceCode = (await page.locator('[data-testid=ai-code]').count()) === 0;
  r.caps = await page.evaluate(() => { const c = (window as W).__tjmWb.getState().caps; return { aiEnabled: c.aiEnabled, mock: c.mock }; });

  // 设置 · AI: save a key, it survives a reload (IndexedDB), the page never shows it in clear.
  await page.getByRole('button', { name: 'AI 制图', exact: true }).click();
  await page.locator('[data-testid=agent-panel] [data-testid=ai-settings]').click();
  await page.locator('.ai-settings-modal input[aria-label="Google Gemini API Key"]').fill('AIza-local-test-0001');
  await page.locator('.ai-settings-modal .ai-vendor-row').first().getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForFunction(() => /已保存 ••••/.test(document.querySelector('.ai-settings-modal .ai-vendor-row small')?.textContent ?? ''));
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.waitForTimeout(400);
  await page.reload();
  await page.waitForFunction(() => !!(window as W).__tjmWb.getState().caps, null, { timeout: 30_000 });
  r.keyPersisted = await page.evaluate(async () => (await (await fetch('/admin/api/workbench/state')).json()).data.vendors.gemini.keyMasked);
  r.keyNotInDom = !(await page.content()).includes('AIza-local-test-0001');

  // Agent workflow on the simulated model, entirely in the page.
  await page.getByRole('button', { name: 'AI 制图', exact: true }).click();
  await page.locator('[data-testid=ai-prompt]').fill('做一张海报，标题「春季新品」');
  await page.locator('[data-testid=ai-start]').click();
  await page.waitForFunction(() => ['completed', 'failed'].includes((window as W).__tjmAgent.getState().task?.state), null, { timeout: 90_000 });
  r.task = await page.evaluate(() => {
    const t = (window as W).__tjmAgent.getState().task;
    const flat = (ls: any[]): any[] => ls.flatMap((l) => [l, ...flat(l.children ?? [])]);
    const layers = flat((window as W).__tjm.getState().layers);
    return { state: t.state, error: t.error, skill: t.skill?.slug, steps: t.steps.length, title: !!layers.find((l: any) => l.kind === 'Type' && l.text?.text === '春季新品') };
  });
  r.generation = await page.evaluate(async () => {
    const g = (await (await fetch('/api/workbench/generations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: 'demo-gen-0001', prompt: '海边', aspectRatio: '16:9' }) })).json()).data;
    const blob = await (await fetch(`/api/workbench/assets/${g.assetIds[0]}/content`)).blob();
    return { status: g.status, bytes: blob.size, type: blob.type };
  });

  // Real-vendor path (no mock): Claude probe against an intercepted official endpoint.
  const real = await ctx.newPage(); watch(real);
  const sent: any[] = [];
  await real.route('https://api.anthropic.com/v1/messages', async (route) => {
    const req = route.request();
    sent.push({ headers: req.headers(), body: req.postDataJSON() });
    const n = sent.length;
    const content = n === 1 ? [{ type: 'tool_use', id: 'tu_1', name: 'probe_echo', input: { value: 'tjm-b0' } }] : [{ type: 'text', text: n === 2 ? '收到' : '红色' }];
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ id: `m${n}`, content, usage: { input_tokens: 1, output_tokens: 1 } }) });
  });
  await real.goto(BASE);
  await real.waitForFunction(() => !!(window as W).__tjmWb.getState().caps, null, { timeout: 30_000 });
  r.probe = await real.evaluate(async () => {
    const call = async (p: string, m: string, b?: unknown) => (await (await fetch(`/admin/api/workbench/${p}`, { method: m, headers: { 'content-type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) })).json()).data;
    await call('providers/anthropic', 'PUT', { apiKey: 'sk-ant-local-test-01' });
    await call('config', 'PUT', { models: { agentProvider: 'anthropic', agent: 'claude-sonnet-4-5' } });
    const p = await call('probe', 'POST', {});
    return { ok: p.ok, provider: p.provider, checks: p.checks.map((c: any) => `${c.ok ? '✓' : '✗'} ${c.detail}`) };
  });
  r.claudeHeaders = sent[0] && { key: sent[0].headers['x-api-key'], browser: sent[0].headers['anthropic-dangerous-direct-browser-access'] };
  await real.screenshot({ path: '/tmp/demo-smoke.png' });
} finally {
  await browser.close();
  await server.close();
}
r.errors = errors;
console.log(JSON.stringify(r, null, 2));
const ok = r.noExperienceCode && r.caps.aiEnabled && r.caps.mock && r.keyPersisted === '••••••••0001' && r.keyNotInDom
  && r.task.state === 'completed' && r.task.title && r.generation.status === 'succeeded' && r.generation.bytes > 0
  && r.probe.ok && r.probe.provider === 'anthropic' && r.claudeHeaders?.browser === 'true' && !errors.length;
console.log(ok ? 'DEMO SMOKE OK' : 'DEMO SMOKE FAILED');
process.exit(ok ? 0 : 1);
