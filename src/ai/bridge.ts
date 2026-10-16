// EditorBridge: executes one leased agent step against the *bound* document (by docId, never
// "the active tab"), with the revision the plan was made against checked inside the engine's
// request queue, and returns a structured receipt. Read tools return real document data and a
// real render of the current revision.
import type { DocSession } from '../engine/session';
import { EngineError } from '../engine/session';
import type { DocInspect, LayerNode } from '../engine/protocol';
import type { PreviewRef, Receipt, Step, TaskSummary, WbError } from './contract';
import { CLIENT_TOOLS, EDIT_BATCH, targetLayers } from './tools';
import { aiHeld } from '../state/aiControl';
import { assetPlacement, backgroundBaseCount, coversCanvas, type PlacementOptions } from '../engine/placement';
import { extrudeText, textFxBatch, textFxClearBatch, type ExtrudeArgs, type TextFxArgs } from '../engine/textfx';
import { captureRect, regionMaskBatch, selectionInfo } from '../engine/region';
import { fontLibrary } from '../engine/fonts';
import { fitText, lintDoc, relBox, type Box, type HAlign, type VAlign } from '../engine/layout';

export interface BridgeDeps {
  /** Session of the document with this engine docId, if it is still open. */
  session(docId: string): DocSession | undefined;
  /** Bring the UI (layers, history, canvas) in line after an AI edit of `docId`. */
  afterEdit(docId: string, damage: unknown): Promise<void>;
  assetBytes(assetId: string): Promise<{ bytes: ArrayBuffer; mime: string }>;
  /** RGBA → PNG data URL, downscaled so the longer side is ≤ maxSide. */
  encodePng(px: { width: number; height: number; pixels: ArrayBuffer }, maxSide: number): Promise<{ dataUrl: string; width: number; height: number }>;
  /** Stores a PNG data URL in the participant's asset library (region_capture). */
  uploadAsset?(dataUrl: string, name: string): Promise<{ id: string }>;
}

/** Compact, model-facing layer tree (ids are the engine's real ids). */
export function summarizeLayers(layers: LayerNode[]): unknown[] {
  return layers.map((l) => ({
    id: l.id, name: l.name, kind: l.kind,
    ...(l.visible === false ? { visible: false } : {}),
    ...(l.opacity != null && l.opacity !== 1 ? { opacity: l.opacity } : {}),
    ...(l.bounds ? { bounds: l.bounds } : {}),
    ...(l.text ? { text: l.text.text.slice(0, 500), font: l.text.font, sizePt: l.text.sizePt } : {}),
    ...(l.locks && (l.locks.all || l.locks.position || l.locks.pixels || l.locks.transparency) ? { locks: l.locks } : {}),
    ...(l.children?.length ? { children: summarizeLayers(l.children) } : {}),
  }));
}

function findLayer(layers: LayerNode[], id: number): LayerNode | undefined {
  for (const l of layers) {
    if (l.id === id) return l;
    const c = l.children && findLayer(l.children, id);
    if (c) return c;
  }
  return undefined;
}

/** Lock / existence check before touching the engine (the engine would refuse too; this gives a clear code). */
export function lockProblem(info: DocInspect, tool: string, ids: number[]): WbError | undefined {
  for (const id of ids) {
    const l = findLayer(info.layers ?? [], id);
    if (!l) return { code: 'NOT_FOUND', message: `图层 ${id} 不存在（请重新 doc_read）` };
    if (l.locks?.all) return { code: 'LOCKED', message: `图层「${l.name}」已全部锁定` };
    if (l.locks?.position && (tool === 'layer_move' || tool === 'layer_align' || tool === 'layer_fit')) return { code: 'LOCKED', message: `图层「${l.name}」锁定了位置` };
  }
  return undefined;
}

export class EditorBridge {
  private readonly deps: BridgeDeps;
  /** Engine idempotency key → input digest: a key reused with different input is refused. */
  private readonly keys = new Map<string, string>();
  constructor(deps: BridgeDeps) { this.deps = deps; }

  async execute(task: TaskSummary, step: Step): Promise<Receipt> {
    const base = { taskId: task.id, runId: task.runId, stepId: step.stepId, callId: step.callId, leaseId: step.lease?.id ?? '', inputDigest: step.inputDigest, docId: task.target.docId };
    const session = this.deps.session(task.target.docId);
    const fail = (error: WbError, before = session?.currentRevision ?? 0): Receipt => ({ ...base, revisionBefore: before, revisionAfter: session?.currentRevision ?? before, status: 'error', error });
    if (!session) return fail({ code: 'TARGET_MISMATCH', message: '目标文档已关闭或已被重新打开，不会改写到其他文档' });
    if (aiHeld(task.target.docId)) return fail({ code: 'USER_TAKEOVER', message: '用户已暂停 AI 并请求手动接管，本步骤没有执行' });
    const key = `${task.id}:${step.stepId}`;
    const seen = this.keys.get(key);
    if (seen && seen !== step.inputDigest) return fail({ code: 'IDEMPOTENCY_MISMATCH', message: '同一步骤的输入发生变化' });
    this.keys.set(key, step.inputDigest);
    if (!CLIENT_TOOLS.includes(step.tool)) return fail({ code: 'INVALID_TOOL_CALL', message: `编辑器不执行 ${step.tool}` });
    const before = session.currentRevision;
    const observed = step.observedRevision ?? before;
    try {
      if (step.tool === 'doc_read') {
        const info = (await session.inspect()) as DocInspect & { mode?: string };
        return { ...base, revisionBefore: before, revisionAfter: session.currentRevision, status: 'ok', result: { width: info.width, height: info.height, resolution: info.resolution, mode: info.mode, revision: session.currentRevision, selection: await selectionInfo(session), layers: summarizeLayers(info.layers ?? []) } };
      }
      if (step.tool === 'doc_preview') {
        const preview = await this.preview(session, step.args as { region?: { x: number; y: number; w: number; h: number }; maxSide?: number });
        return { ...base, revisionBefore: before, revisionAfter: session.currentRevision, status: 'ok', result: { revision: preview.revision, width: preview.width, height: preview.height, region: preview.region, scale: preview.scale }, preview };
      }
      if (step.tool === 'doc_lint') {
        const info = await session.inspect();
        const r = await session.client.render(session.docId, 1024);
        const issues = lintDoc(info, r.ok ? { px: r.data, scale: r.data.width / info.width } : undefined);
        return { ...base, revisionBefore: before, revisionAfter: session.currentRevision, status: 'ok', result: { revision: session.currentRevision, ok: !issues.some((i) => i.severity === 'error'), issues } };
      }
      if (step.tool === 'font_list') {
        const a = step.args as { script?: string; tag?: string };
        const library = (await fontLibrary()).filter((f) => (!a.script || f.script === a.script) && (!a.tag || f.tags.some((t) => t.includes(a.tag!))));
        const engine = await session.typeFonts().catch(() => [] as string[]);
        return { ...base, revisionBefore: before, revisionAfter: session.currentRevision, status: 'ok', result: { library: library.map(({ family, label, script, tags }) => ({ family, label, script, tags })), loaded: engine } };
      }
      if (step.tool === 'region_capture') {
        const result = await this.capture(session, step.args.pad as number | undefined);
        return { ...base, revisionBefore: before, revisionAfter: session.currentRevision, status: 'ok', result, assets: [result.assetId] };
      }
      // Edits: the plan's revision must still be current. Checked by the engine inside the queue.
      if (session.currentRevision !== observed) return fail({ code: 'REVISION_CONFLICT', message: `文档已从修订 ${observed} 变为 ${session.currentRevision}` }, before);
      const info = await session.inspect();
      const problem = lockProblem(info, step.tool, targetLayers(step.args));
      if (problem) return fail(problem, before);
      if (step.tool === 'asset_import') return await this.importAsset(session, base, step, key, before, observed, info);
      if (aiHeld(task.target.docId)) return fail({ code: 'USER_TAKEOVER', message: '用户已接管，停止后续写入' });
      if (step.tool === 'layer_fit') {
        const result = await this.fitAsset(session, step.args.layer as number, step.args as PlacementOptions, key, observed);
        await this.deps.afterEdit(task.target.docId, null);
        return { ...base, revisionBefore: before, revisionAfter: session.currentRevision, status: 'ok', result, affectedLayers: [step.args.layer as number] };
      }
      if (step.tool === 'text_extrude') {
        let result;
        try { result = await extrudeText(session, step.args as unknown as ExtrudeArgs, { key, baseRevision: observed }); }
        finally { await this.deps.afterEdit(task.target.docId, null); }
        return { ...base, revisionBefore: before, revisionAfter: session.currentRevision, status: 'ok', result, affectedLayers: [result.face, ...result.slices, ...(result.group != null ? [result.group] : [])] };
      }
      if (step.tool === 'text_fit' || step.tool === 'layout_apply') {
        let result;
        try { result = await this.layout(session, step.tool, step.args, key, observed, info); }
        finally { await this.deps.afterEdit(task.target.docId, null); }
        return { ...base, revisionBefore: before, revisionAfter: session.currentRevision, status: 'ok', result, affectedLayers: targetLayers(step.args) };
      }
      if (step.tool === 'region_apply' && !(await selectionInfo(session))) return fail({ code: 'NO_SELECTION', message: '没有选区（选择主体可能没有识别到主体）：先用 region_select 建立选区，或改用 method=object/rect' }, before);
      const batch = step.tool === 'text_fx_apply' ? textFxBatch(info, step.args as unknown as TextFxArgs)
        : step.tool === 'text_fx_clear' ? textFxClearBatch(info, step.args.layer as number)
        // Placing an asset (paste) drops the selection; bring the last one back for the mask.
        : step.tool === 'region_mask' ? [...(await selectionInfo(session) ? [] : [{ cmd: 'select.reselect' }]), ...regionMaskBatch(step.args as { layer: number })]
        : EDIT_BATCH[step.tool](step.args);
      const reply = await session.request(batch, key, { baseRevision: observed });
      const created = reply.results.map((r) => (r.value as { layer?: number } | undefined)?.layer).filter((x): x is number => typeof x === 'number');
      await this.deps.afterEdit(task.target.docId, reply.damage);
      return { ...base, revisionBefore: before, revisionAfter: session.currentRevision, status: 'ok', result: { layers: created }, affectedLayers: [...new Set([...targetLayers(step.args), ...created])] };
    } catch (e) {
      if (e instanceof EngineError && e.code === 'CONFLICT') return fail({ code: 'REVISION_CONFLICT', message: '执行时文档修订已变化（可能有人工修改）' }, before);
      if (e instanceof EngineError && e.code === 'USER_TAKEOVER') return fail({ code: 'USER_TAKEOVER', message: e.message }, before);
      const msg = e instanceof Error ? e.message : String(e);
      return fail({ code: /locked/i.test(msg) ? 'LOCKED' : 'ENGINE_ERROR', message: msg.slice(0, 300) }, before);
    }
  }

  private async importAsset(session: DocSession, base: Omit<Receipt, 'revisionBefore' | 'revisionAfter' | 'status'>, step: Step, key: string, before: number, observed: number, info: DocInspect): Promise<Receipt> {
    const a: PlacementOptions & { assetId: string } = { ...step.args as PlacementOptions, assetId: String(step.args.assetId) };
    const { bytes, mime } = await this.deps.assetBytes(a.assetId);
    if (aiHeld(base.docId)) throw new EngineError('用户已接管，停止导入素材', 'USER_TAKEOVER');
    const ext = mime === 'image/jpeg' ? 'jpg' : 'png';
    // Engine clipboard route (same as Place / system paste): a scratch document, copy, paste.
    await session.loadImageToClipboard(`${a.assetId}.${ext}`, bytes);
    if (aiHeld(base.docId)) throw new EngineError('用户已接管，停止导入素材', 'USER_TAKEOVER');
    const center: [number, number] = [Math.round(a.centerX ?? info.width / 2), Math.round(a.centerY ?? info.height / 2)];
    const pasted = await session.request([{ cmd: 'edit.paste', params: { center } }], key, { baseRevision: observed });
    const layer = pasted.results.map((r) => (r.value as { layer?: number } | undefined)?.layer).find((x) => typeof x === 'number');
    if (layer == null) throw new EngineError('素材导入没有返回图层 ID');
    let layout;
    try {
      if (aiHeld(base.docId)) throw new EngineError('用户已接管，停止后续布局', 'USER_TAKEOVER');
      layout = await this.fitAsset(session, layer, { ...a, name: a.name ?? `AI 素材 ${a.assetId.slice(-6)}` }, key, session.currentRevision, true);
    } finally { await this.deps.afterEdit(base.docId, null); }
    return { ...base, revisionBefore: before, revisionAfter: session.currentRevision, status: 'ok', result: { ...layout, assetId: a.assetId, center }, affectedLayers: [layer], assets: [a.assetId] };
  }

  private async fitAsset(session: DocSession, layer: number, options: PlacementOptions, key: string, observed: number, newlyImported = false) {
    const info = await session.inspect(), item = findLayer(info.layers ?? [], layer);
    if (!item?.bounds || /type|group/i.test(item.kind)) throw new EngineError('铺放工具需要有边界的图片或形状图层');
    const placement = assetPlacement(options, info, item.bounds);
    if (placement.bounds[2] * placement.bounds[3] > 64_000_000) throw new EngineError('铺放后的素材超过 6400 万像素，请裁剪参考图或缩小目标区域');
    const commands = [];
    if (options.name) commands.push({ cmd: 'layer.setProps', params: { layer, name: options.name } });
    if (placement.matrix.some((v, i) => Math.abs(v - [1, 0, 0, 1, 0, 0][i]) > .0001)) commands.push({ cmd: 'edit.transform', params: { layer, matrix: placement.matrix } });
    if (placement.role === 'background') {
      if (info.layers?.at(-1)?.id !== layer) commands.push({ cmd: 'layer.arrange.sendToBack', params: { layer } });
      for (let i = 0; i < backgroundBaseCount(info.layers ?? [], layer, info.width, info.height); i++) commands.push({ cmd: 'layer.arrange.bringForward', params: { layer } });
    } else if (newlyImported && info.layers?.[0]?.id !== layer) commands.push({ cmd: 'layer.arrange.bringToFront', params: { layer } });
    if (aiHeld(session.docId)) throw new EngineError('用户已接管，停止后续布局', 'USER_TAKEOVER');
    if (commands.length) await session.request(commands, `${key}:layout`, { baseRevision: observed });
    const after = await session.inspect(), bounds = findLayer(after.layers ?? [], layer)?.bounds;
    const coveredCanvas = !!bounds && coversCanvas(bounds, after.width, after.height);
    if (placement.role === 'background' && placement.fit === 'cover' && !options.rect && !coveredCanvas) throw new EngineError('背景导入后未覆盖完整画布，请重新读取边界并调整');
    return { layer, bounds, role: placement.role, fit: placement.fit, coveredCanvas };
  }

  /** text_fit: one text layer into a pixel box. layout_apply: many layers into relative boxes. */
  private async layout(session: DocSession, tool: string, a: Record<string, any>, key: string, observed: number, info: DocInspect) {
    if (tool === 'text_fit') return fitText(session, a.layer, a.box, { align: a.align, valign: a.valign, grow: a.grow, key, baseRevision: observed });
    const placed = [];
    for (const [i, it] of (a.items as { layer: number; box: Box; fit?: 'contain' | 'cover'; align?: HAlign; valign?: VAlign; grow?: boolean }[]).entries()) {
      const rect = relBox(it.box, info.width, info.height);
      const l = findLayer(info.layers ?? [], it.layer);
      if (!l) throw new EngineError(`图层 ${it.layer} 不存在（请重新 doc_read）`);
      placed.push(l.kind === 'Type'
        ? await fitText(session, it.layer, rect, { align: it.align, valign: it.valign, grow: it.grow, key: `${key}:${i}`, baseRevision: session.currentRevision })
        : await this.fitAsset(session, it.layer, { role: 'subject', fit: it.fit ?? 'contain', rect }, `${key}:${i}`, session.currentRevision));
    }
    return { placed };
  }

  /** Selection + context → a library asset at a ratio the image model accepts. */
  private async capture(session: DocSession, pad?: number) {
    if (!this.deps.uploadAsset) throw new EngineError('当前环境不能上传截取的素材');
    const sel = await selectionInfo(session);
    if (!sel) throw new EngineError('没有选区：先用 region_select 或让用户框选要修改的地方');
    const info = await session.inspect();
    const { rect, aspectRatio } = captureRect(sel, info.width, info.height, pad ?? 0.25);
    const r = await session.client.renderRegion(session.docId, ...rect);
    if (!r.ok) throw new EngineError(r.error ?? 'render failed');
    const png = await this.deps.encodePng(r.data, 1024);
    const asset = await this.deps.uploadAsset(png.dataUrl, `选区截取 ${rect.join(',')}`);
    return { assetId: asset.id, rect, aspectRatio, selection: sel };
  }

  /** Renders the current revision (whole canvas or a region) and maps it back to document pixels. */
  async preview(session: DocSession, a: { region?: { x: number; y: number; w: number; h: number }; maxSide?: number }): Promise<PreviewRef> {
    const maxSide = a.maxSide ?? 768;
    for (let attempt = 0; attempt < 2; attempt++) {
      const revision = session.currentRevision;
      const info = await session.inspect();
      const region = a.region
        ? clampRegion(a.region, info.width, info.height)
        : { x: 0, y: 0, w: info.width, h: info.height };
      const r = a.region
        ? await session.client.renderRegion(session.docId, region.x, region.y, region.w, region.h)
        : await session.client.render(session.docId, maxSide);
      if (!r.ok) throw new EngineError(r.error ?? 'render failed');
      if (session.currentRevision !== revision) continue; // an edit landed meanwhile: render again
      const png = await this.deps.encodePng(r.data, maxSide);
      return { revision, dataUrl: png.dataUrl, width: png.width, height: png.height, region, scale: png.width / region.w };
    }
    throw new EngineError('文档在预览期间持续变化');
  }
}

export function clampRegion(r: { x: number; y: number; w: number; h: number }, W: number, H: number) {
  const x = Math.max(0, Math.min(W - 1, Math.floor(r.x)));
  const y = Math.max(0, Math.min(H - 1, Math.floor(r.y)));
  return { x, y, w: Math.max(1, Math.min(W - x, Math.ceil(r.w))), h: Math.max(1, Math.min(H - y, Math.ceil(r.h))) };
}
