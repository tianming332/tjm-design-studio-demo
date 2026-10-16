// Trajectory → Skill draft (§19.10 练 skill): turns a finished task's tool calls into a reusable
// recipe. Concrete content becomes slots ({文案1}, {素材:subject}), pixels become canvas-relative
// (W/H), layer ids become the role they played. Deterministic; a human reviews the draft in the
// Skill library before publishing.
import { WORKFLOW_PHASES, TOOL_BY_NAME } from './tools.js';

const READS = new Set(['doc_read', 'doc_preview', 'doc_lint']);
const XKEYS = new Set(['x', 'dx', 'centerX']);
const YKEYS = new Set(['y', 'dy', 'centerY', 'size', 'depth', 'outline']);
const r3 = v => Math.round(v * 1000) / 1000;
/** Tools whose result layer is new (the rest only report the layers they touched). */
const CREATES = new Set(['text_create', 'asset_import', 'shape_create', 'fill_solid', 'text_extrude', 'region_apply', 'adjust_apply', 'layer_group']);

function flatLayers(layers = [], out = new Map()) {
  for (const l of layers) { out.set(l.id, l.text ? `文字「${String(l.text).slice(0, 12)}」` : `${l.kind}「${l.name}」`); if (l.children) flatLayers(l.children, out); }
  return out;
}

export function distillTask(task, { slug, name, category = 'workflow' } = {}) {
  const done = task.steps.filter(s => s.status === 'done' && (s.where !== 'client' || s.receipt?.status === 'ok'));
  const read = done.find(s => s.tool === 'doc_read')?.receipt?.result ?? {};
  const W = read.width || 1000, H = read.height || 1000;
  const labels = flatLayers(read.layers);
  const slots = [];
  const slot = (kind, value) => {
    let s = slots.find(x => x.kind === kind && x.value === value);
    if (!s) { s = { kind, value, name: kind === 'text' ? `{文案${slots.filter(x => x.kind === 'text').length + 1}}` : `{素材${slots.filter(x => x.kind === 'asset').length + 1}}` }; slots.push(s); }
    return s.name;
  };
  const rel = (key, v) => typeof v !== 'number' ? v : XKEYS.has(key) ? `${r3(v / W)}W` : YKEYS.has(key) ? `${r3(v / H)}H` : v;
  const relBox = b => b.length === 4 && b.every(n => n > 1.0001 || n < 0) ? [`${r3(b[0] / W)}W`, `${r3(b[1] / H)}H`, `${r3(b[2] / W)}W`, `${r3(b[3] / H)}H`] : b;
  const arg = (key, v) => {
    if (key === 'layer' && typeof v === 'number') return `<${labels.get(v) ?? `图层${v}`}>`;
    if (key === 'layers' && Array.isArray(v)) return v.map(id => `<${labels.get(id) ?? `图层${id}`}>`);
    if (key === 'text') return slot('text', v);
    if (key === 'assetId') return slot('asset', v);
    if (key === 'referenceAssetIds') return v.map(id => slot('asset', id));
    if ((key === 'rect' || key === 'box') && Array.isArray(v)) return relBox(v);
    if (key === 'items' && Array.isArray(v)) return v.map(it => Object.fromEntries(Object.entries(it).map(([k, x]) => [k, arg(k, x)])));
    return rel(key, v);
  };
  const lines = [];
  const used = new Set(['doc_read', 'doc_preview', 'doc_lint']);
  for (const s of done) {
    const tool = TOOL_BY_NAME.get(s.tool);
    if (!tool || WORKFLOW_PHASES.includes(tool.phase) || READS.has(s.tool)) continue;
    used.add(s.tool);
    const a = Object.entries(s.args || {}).map(([k, v]) => `${k}=${JSON.stringify(arg(k, v))}`).join(', ');
    lines.push(`${s.tool}(${a})`);
    // Name what this step created so later steps can refer to it by role.
    const made = s.receipt?.result?.layers?.[0] ?? s.receipt?.result?.layer ?? s.receipt?.result?.group;
    if (typeof made === 'number' && CREATES.has(s.tool)) labels.set(made, s.tool === 'text_create' ? `新建文字 ${arg('text', s.args.text)}` : s.tool === 'asset_import' ? `新建素材层 ${arg('assetId', s.args.assetId)}` : `${s.tool} 结果`);
  }
  if (!lines.length) throw Object.assign(new Error('任务没有成功的编辑步骤，无法提炼'), { wb: { code: 'BAD_REQUEST', message: '任务没有成功的编辑步骤，无法提炼' } });
  const goal = task.analysis?.goal || task.prompt.slice(0, 120);
  const body = [
    `# ${name || goal.slice(0, 30)}`,
    '',
    `来源：任务 ${task.id}（${new Date(task.createdAt).toISOString().slice(0, 10)}）的成功轨迹，自动提炼，发布前请人工审阅。`,
    `原需求：${task.prompt.split('用户需求：').pop().trim().slice(0, 300)}`,
    '',
    '## 参数槽位',
    ...(slots.length ? slots.map(s => `- ${s.name}：${s.kind === 'text' ? `文案（示例：${String(s.value).slice(0, 30)}）` : '素材（从 assets_list 选择或先生成）'}`) : ['- 无']),
    '',
    `## 步骤（坐标相对画布：W=宽，H=高；示例画布 ${W}×${H}）`,
    ...lines.map((l, i) => `${i + 1}. ${l}`),
    '',
    '## 检查',
    '- 每步之后用 doc_read 取真实图层 id，不要沿用示例里的 id。',
    '- 完成后 doc_lint 无 error，doc_preview 检查遮挡、越界与文案；不满意最多修正两轮。',
  ].join('\n');
  return {
    slug: slug || `distilled-${task.id.slice(-8).toLowerCase().replace(/[^a-z0-9]/g, '')}`,
    name: (name || `提炼：${goal}`).slice(0, 80),
    category,
    description: `由任务 ${task.id} 提炼：${goal}`.slice(0, 500),
    triggers: '',
    body,
    tools: [...used].filter(t => TOOL_BY_NAME.has(t)),
  };
}
