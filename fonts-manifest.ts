// Builds public/fonts/manifest.json from public/fonts/lib/*: asks the real engine which family
// each file registers (the name the font menu, PSDs and the agent must use) and adds the curated
// label, script and style tags. Re-run after adding a font folder:  npx tsx fonts-manifest.ts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.join(DIR, 'public/fonts/lib');
// Folder → display name, script and the style words the agent filters by. All SIL OFL 1.1.
const META: Record<string, { label: string; script: 'zh' | 'ja' | 'en'; tags: string[] }> = {
  notoserifsc: { label: '思源宋体', script: 'zh', tags: ['宋体', '衬线', '正文', '标题', '文艺', '高端'] },
  zcoolxiaowei: { label: '站酷小薇', script: 'zh', tags: ['宋体', '衬线', '文艺', '标题'] },
  zcoolkuaile: { label: '站酷快乐体', script: 'zh', tags: ['圆体', '可爱', '童趣', '手写', '展示'] },
  zcoolqingkehuangyou: { label: '站酷庆科黄油体', script: 'zh', tags: ['展示', '粗体', '促销', '潮流', '标题'] },
  mashanzheng: { label: '马善政毛笔楷书', script: 'zh', tags: ['书法', '毛笔', '国风', '楷书', '标题'] },
  longcang: { label: '龙藏体', script: 'zh', tags: ['手写', '行书', '国风', '文艺'] },
  notosansjp: { label: 'Noto Sans JP（思源黑体 日文）', script: 'ja', tags: ['黑体', '无衬线', '正文', '标题'] },
  mplusrounded1c: { label: 'M PLUS Rounded 1c', script: 'ja', tags: ['圆体', '可爱', '正文'] },
  zenmarugothic: { label: 'Zen Maru Gothic', script: 'ja', tags: ['圆体', '柔和', '正文'] },
  delagothicone: { label: 'Dela Gothic One', script: 'ja', tags: ['展示', '粗体', '标题', '潮流'] },
  montserrat: { label: 'Montserrat', script: 'en', tags: ['无衬线', '几何', '标题', '正文'] },
  playfairdisplay: { label: 'Playfair Display', script: 'en', tags: ['衬线', '高端', '杂志', '标题'] },
  oswald: { label: 'Oswald', script: 'en', tags: ['无衬线', '窄体', '标题', '海报'] },
  bebasneue: { label: 'Bebas Neue', script: 'en', tags: ['展示', '窄体', '大写', '海报', '标题'] },
  anton: { label: 'Anton', script: 'en', tags: ['展示', '粗体', '窄体', '海报'] },
  pacifico: { label: 'Pacifico', script: 'en', tags: ['手写', '复古', '可爱'] },
  lobster: { label: 'Lobster', script: 'en', tags: ['手写', '复古', '展示'] },
  caveat: { label: 'Caveat', script: 'en', tags: ['手写', '随意', '笔记'] },
};

const files = Object.keys(META).flatMap((dir) => {
  const d = path.join(LIB, dir);
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter((f) => /\.(ttf|otf)$/i.test(f)).map((f) => ({ dir, file: `lib/${dir}/${f}`, bytes: fs.statSync(path.join(d, f)).size, license: fs.existsSync(path.join(d, 'OFL.txt')) ? `lib/${dir}/OFL.txt` : '' }));
});
const unlicensed = files.filter((f) => !f.license);
if (unlicensed.length) throw new Error(`没有许可证文件：${unlicensed.map((f) => f.file).join(', ')}`);

const server = await createServer({ root: DIR, server: { host: '127.0.0.1', port: 5199, strictPort: true }, logLevel: 'warn' });
await server.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await (await browser.newContext()).newPage();
  await page.addInitScript(() => { (window as any).__name = (f: unknown) => f; });
  await page.route('**/api/**', (r) => r.fulfill({ json: { data: {} } }));
  await page.goto('http://127.0.0.1:5199');
  await page.evaluate(() => (window as any).__tjm.getState().newDocument(100, 100));
  await page.waitForFunction(() => !!(window as any).__tjm.getState().session);
  const families: string[][] = await page.evaluate(async (list) => {
    const client = (window as any).__tjm.getState().session.client;
    const out: string[][] = [];
    for (const f of list) {
      const b = await (await fetch(`/fonts/${encodeURI(f.file)}`)).arrayBuffer();
      const r = await client.addFont(b);
      const fams = r?.data?.families ?? r?.data?.added ?? r?.data ?? [];
      out.push(Array.isArray(fams) ? fams.map(String) : [JSON.stringify(r?.data)]);
    }
    return out;
  }, files);
  const fonts = files.map((f, i) => ({ family: families[i][0], label: META[f.dir].label, file: f.file, script: META[f.dir].script, tags: META[f.dir].tags, license: 'SIL OFL 1.1', licenseFile: f.license, bytes: f.bytes, ...(/\[wght\]/.test(f.file) ? { variable: true } : {}) }));
  // One entry per family: a family with several files (Regular/Bold) keeps the regular one.
  const byFamily = new Map<string, typeof fonts[number]>();
  for (const f of fonts) if (!byFamily.has(f.family) || /Regular/.test(f.file)) byFamily.set(f.family, f);
  // The default face is preloaded by every engine (engine/fonts.ts); listed so the agent sees it.
  const preloaded = { family: 'Noto Sans SC', label: '思源黑体（默认）', file: 'NotoSansSC-Regular.otf', script: 'zh' as const, tags: ['黑体', '无衬线', '正文', '标题', '默认'], license: 'SIL OFL 1.1', licenseFile: 'NotoSansSC-LICENSE.txt', bytes: fs.statSync(path.join(DIR, 'public/fonts/NotoSansSC-Regular.otf')).size };
  const out = { version: 1, note: '可商用开源字体（SIL OFL 1.1），许可证在各字体目录 OFL.txt；首次使用时按需下载。', fonts: [preloaded, ...byFamily.values()] };
  fs.writeFileSync(path.join(DIR, 'public/fonts/manifest.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(out.fonts.map((f) => `${f.script} ${f.family} ← ${f.file} (${(f.bytes / 1048576).toFixed(1)} MB)`).join('\n'));
  if (out.fonts.some((f) => !f.family || f.family.startsWith('{'))) throw new Error(`引擎没有返回字体名：${JSON.stringify(families)}`);
} finally { await browser.close(); await server.close(); }
