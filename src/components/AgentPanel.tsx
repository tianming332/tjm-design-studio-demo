// 设计 Agent panel: one task on the active document, shown as the workflow phases
// 分析需求 → 检查素材 → 匹配 Skill → 执行 → 检查. All AI settings live in the Admin backend.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useStore } from '../state/store';
import { useAgent } from '../state/agent';
import { hasAccess, useWb } from '../state/workbench';
import { TERMINAL } from '../ai/contract';
import { phaseRows } from '../ai/progress';
import { Icon } from './Icon';
import { AccessGate } from './AccessGate';
import { openPanel, useNavigation, setAIOutput } from '../state/navigation';
import { useAssets } from '../state/assets';
import { AI_ASPECTS, creationPrompt, creationSize, type AIAspect } from '../ai/creation';
import { ATTACHMENT_ACCEPT } from '../ai/attachments';
import { useBriefAttachments } from '../state/briefAttachments';
import { BriefAttachments } from './BriefAttachments';
import { useDesignActivity } from '../state/designActivity';
import { aiHeld, releaseAI, useAIControl } from '../state/aiControl';
import { availableModels } from '../ai/models';
import { ModelPicker } from './ModelPicker';
import { AgentStarfield } from './AgentStarfield';
import { AgentBlackHole } from './AgentBlackHole';

// Agent / AI 生图统一用 TJM AI 标志（品牌规范见 docs 视觉规范）
const AGENT_LOGO = `${import.meta.env.BASE_URL}brand/tjm-ai-logo.png`;

const STATE_LABEL: Record<string, string> = {
  created: '已创建', planning: '思考中', waiting_model: '思考中', waiting_asset: '生成素材中', waiting_confirmation: '待确认',
  waiting_client: '等待编辑器', executing: '编辑器执行中', reviewing: '检查中', paused: '已暂停', reconciling: '待核对',
  completed: '完成', failed: '失败', cancelled: '已取消',
};

const TOOL_LABEL: Record<string, string> = {
  report_analysis: '分析需求', assets_list: '检查素材库', skill_list: '查找 Skill', skill_load: '读取 Skill', doc_read: '读取文档', doc_preview: '检查预览',
  text_create: '新建文字', text_edit: '改文字', text_style: '改文字样式', layer_move: '移动图层', layer_props: '图层属性', layer_arrange: '调整顺序',
  layer_align: '对齐', shape_create: '新建形状', fill_solid: '纯色填充', layer_group: '编组', layer_delete: '删除图层', image_generate: '生成素材', asset_import: '导入素材',
};

export function AgentPanel() {
  const ag = useAgent();
  const wb = useWb();
  const assets = useAssets();
  const output = useNavigation((s) => s.output);
  const layered = output === 'layered';
  const docName = useStore((s) => s.tabs.find((t) => t.docId === s.activeDocId)?.name);
  const activeDocId = useStore((s) => s.activeDocId);
  const selected = useStore((s) => s.selectedIds.length);
  const [prompt, setPrompt] = useState('');
  const [onlySel, setOnlySel] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [aspect, setAspect] = useState<AIAspect>('portrait');
  const [ratio, setRatio] = useState('3:4');
  const [resolution, setResolution] = useState('1K');
  const [styleId, setStyleId] = useState<number>();
  const [settings, setSettings] = useState(false);
  const [modelChoice, setModelChoice] = useState<string>();
  const [newTask, setNewTask] = useState(false);
  const [lastPrompt, setLastPrompt] = useState('');
  const [imageResult, setImageResult] = useState<{ label: string; brief: string; notice: string }>();
  const [imageError, setImageError] = useState<string>();
  const attachments = useBriefAttachments();
  const fileInput = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const dropDepth = useRef(0);
  const busy = useStore((s) => s.busy);
  const modelOptions = availableModels(wb.caps, layered ? 'agent' : 'image', attachments.files.some((f) => !!f.image));
  const chosenModel = modelOptions.find((m) => m.id === modelChoice)?.id;
  const t = ag.task;
  const done = !t || TERMINAL.includes(t.state);
  const working = !done || assets.generating || submitting || attachments.preparing;
  useEffect(() => {
    if (!layered && hasAccess(wb)) {
      void useAssets.getState().loadStyles();
      void useAssets.getState().refresh();
    }
  }, [layered, wb.quota?.limit]);
  const pending = t?.steps.find((s) => s.where === 'client' && s.needsConfirmation && !s.confirmed && s.status === 'pending');
  const canStart = !!(layered ? wb.caps?.aiEnabled : wb.caps?.imageEnabled ?? wb.caps?.aiEnabled) && hasAccess(wb) && !wb.quota?.exhausted && (wb.quota?.remaining ?? 0) > 0 && !wb.offline && !!prompt.trim() && attachments.files.every((f) => f.status === 'ready') && (!layered || !onlySel || selected > 0) && !busy && !working;
  const submit = async () => {
    const feedback = layered && !!t && t.state === 'completed' && activeDocId === t.target.docId && !newTask;
    if (!canStart) return;
    const userBrief = prompt.trim();
    const targetDocId = useStore.getState().activeDocId;
    releaseAI(targetDocId);
    const controlEpoch = useAIControl.getState().epoch;
    const activity = useDesignActivity.getState().begin(targetDocId);
    setSubmitting(true);
    setImageError(undefined);
    try {
      const imageOutput = /海报|封面|poster|cover/i.test(userBrief) ? 'poster' : 'asset';
      const intent = layered ? 'layered' : imageOutput;
      const prefix = feedback ? '' : creationPrompt(intent, '');
      // In 生图 the images the user dropped / attached are the reference; there is no separate picker.
      const prepared = await attachments.prepare(userBrief, 4000 - prefix.length, !layered);
      if (useAIControl.getState().epoch !== controlEpoch || aiHeld(targetDocId)) throw new Error('用户已接管，任务未继续提交');
      if (useStore.getState().activeDocId !== targetDocId) throw new Error('准备附件时目标文档已切换。请确认画布后重新提交。');
      const brief = prepared.brief;
      if (!layered) {
        const size = creationSize(output, aspect).join('x');
        const background = imageOutput === 'asset' && /背景|底图|底纹|background|\bbg\b/i.test(userBrief);
        const result = await assets.generate({ prompt: creationPrompt(imageOutput, brief), size, styleId, ...(chosenModel ? {model: chosenModel} : {}), aspectRatio: ratio, imageSize: resolution, name: userBrief,
          placement: imageOutput === 'poster' ? { role: 'subject', fit: 'cover' } : background ? { role: 'background', fit: 'cover' } : { role: 'subject', fit: 'contain' },
          ...(prepared.referenceId ? { referenceAssetId: prepared.referenceId } : {}) });
        if (result) {
          setImageResult({ label: imageOutput === 'poster' ? '海报' : '图片', brief: userBrief, notice: useAssets.getState().notice ?? `已生成 ${result.count} 张` });
          setPrompt('');
          useDesignActivity.getState().update(activity, { docId: targetDocId ?? useStore.getState().activeDocId, phase: aiHeld(targetDocId) ? 'paused' : 'complete', message: result.placed ? undefined : '结果已保存到素材库，未放入画布' });
        } else throw new Error(useAssets.getState().error ?? '图片生成未完成，请稍后重试。');
        return;
      }
      if (!docName && !feedback) {
        const [w, h] = creationSize(output, aspect);
        await useStore.getState().newDocument(w, h);
        if (!useStore.getState().session || useStore.getState().error) throw new Error(useStore.getState().error || '画布创建失败');
        useDesignActivity.getState().update(activity, { docId: useStore.getState().activeDocId });
      }
      if (feedback) await ag.feedback(brief, chosenModel); else await ag.start(creationPrompt('layered', brief), onlySel, chosenModel);
      if (useAgent.getState().error) throw new Error(useAgent.getState().error);
      useDesignActivity.getState().update(activity, { taskId: useAgent.getState().task?.id });
      setLastPrompt(userBrief);
      setPrompt('');
    } catch (e) {
      const message = (e as Error).message;
      setImageError(message);
      useDesignActivity.getState().update(activity, { phase: aiHeld(targetDocId) ? 'paused' : 'error', message });
    } finally { setSubmitting(false); void useWb.getState().load(); }
  };
  // Before the first conversation the Design Agent shows the starfield backdrop (off in 低开销模式).
  const prelude = layered && !t && !imageResult;
  // Opening right after the experience code is accepted (CSS skips it in 低开销模式).
  const introAt = useWb((s) => s.introAt);
  const [intro, setIntro] = useState(false);
  useEffect(() => { if (!introAt || Date.now() - introAt > 4000) return; setIntro(true); const id = setTimeout(() => setIntro(false), 3600); return () => clearTimeout(id); }, [introAt]);
  const composerRef = useRef<HTMLDivElement>(null);
  const orbitRef = useRef<HTMLDivElement>(null);
  return (
    <div className={`ai-panel agent-experience ${layered ? 'agent-design' : 'agent-image'}${t || imageResult ? ' has-task' : ' agent-idle'}${working ? ' is-working' : ''}${prelude ? ' has-starfield' : ''}${intro ? ' agent-intro' : ''}`} data-testid="agent-panel">
      {prelude && <AgentBlackHole />}
      {prelude && <AgentStarfield anchor={composerRef} burstAt={intro ? introAt : undefined} />}
      <div className="agent-scroll">
        {!t && !imageResult && <div className="agent-welcome">
          <div ref={orbitRef} className="agent-orbit" aria-hidden="true"><span/><span/><img className="agent-logo" style={{ '--logo-size': '26px' } as CSSProperties} src={AGENT_LOGO} alt="" /></div>
          <h1>TJM—DESIGN AGENT</h1>
          <p>描述你的想法，先分析需求，再完成设计。</p>
        </div>}
        {t && <>
          {lastPrompt && <div className="agent-user-message"><span>你的需求</span><p>{lastPrompt}</p></div>}
          <div className="ai-task" data-testid="ai-task" data-state={t.state}>
            <div className="agent-task-heading"><div className="task-orb"><img className="agent-logo" style={{ '--logo-size': '20px' } as CSSProperties} src={AGENT_LOGO} alt="" /></div><div><strong>{STATE_LABEL[t.state] ?? t.state}</strong><small>{t.target.name}</small></div></div>
            <ol className="ai-phases" data-testid="ai-phases">{phaseRows(t).map((p, i) => <li key={p.label} data-ok={p.state === 'done'} data-phase-state={p.state}>
              <span className={`phase-index ${p.state}`}>{p.state === 'done' ? <Icon name="check" size={12} /> : p.state === 'running' ? <span className="phase-spinner" /> : p.state === 'error' ? '!' : p.state === 'paused' ? 'Ⅱ' : `0${i + 1}`}</span>
              <div><span>{p.label}</span><em className="phase-state-label">{({ done:'已完成', running:'进行中', pending:'待执行', error:'未完成', paused:'已暂停' })[p.state]}</em>{p.detail ? <small>{p.detail}</small> : null}</div>
            </li>)}</ol>
            {t.error && <p className="ai-error">{t.error.message}</p>}
            {pending && <div className="ai-confirm">待确认：{TOOL_LABEL[pending.tool] ?? pending.tool} <code>{JSON.stringify(pending.args)}</code>
              <div className="ai-row"><button className="primary" onClick={() => void ag.act('approve')}>批准</button><button onClick={() => void ag.act('reject')}>拒绝</button></div></div>}
            <div className="ai-row">
              {!done && t.state !== 'paused' && t.state !== 'reconciling' && <button onClick={() => void ag.act('pause')}>暂停</button>}
              {t.state === 'paused' && <button onClick={() => void ag.act('resume')}>继续</button>}
              {t.state === 'reconciling' && <><button onClick={() => void ag.act('resume')}>核对后继续</button><button title="上次调用结果不确定，重发可能再次计费" onClick={() => void ag.act('retry')}>重发不确定的调用</button></>}
              {!done && <button data-testid="ai-cancel" onClick={() => void ag.act('cancel')}>停止</button>}
            </div>
            {t.resultText && <p className="ai-result" data-testid="ai-result">{t.resultText}</p>}
            <details className="agent-log"><summary>查看执行详情 · {t.steps.length} 步</summary><small>模型调用 {t.budget.modelCallsUsed}/{t.budget.modelCalls}</small><ol className="ai-steps">{t.steps.map((s) => <li key={s.stepId} data-status={s.status}>{TOOL_LABEL[s.tool] ?? s.tool} <small>{s.status}{(s.receipt?.error ?? s.error) ? `：${(s.receipt?.error ?? s.error)!.message}` : ''}</small></li>)}</ol>
              <ol className="ai-events">{ag.events.slice(-40).map((e) => <li key={e.seq}>{e.message}</li>)}</ol></details>
          </div>
        </>}
        {imageResult && <div className="ai-image-result" data-testid="image-result">
          <div className="agent-user-message"><span>{imageResult.label} · 你的需求</span><p>{imageResult.brief}</p></div>
          <div className="agent-task-heading"><div className="task-orb"><Icon name="check" size={18} /></div><strong>{imageResult.label}已生成</strong></div>
          <p className="ai-result" data-testid="assets-notice" role="status">{imageResult.notice}</p>
          <button className="quiet-button" onClick={() => openPanel('assets')}>查看生成结果 <Icon name="arrow" size={14} /></button>
        </div>}
        {assets.generating && <div className="ai-generation-progress" role="status"><span className="task-orb"><img className="agent-logo" style={{ '--logo-size': '19px' } as CSSProperties} src={AGENT_LOGO} alt="" /></span><div><strong>正在生成图片…</strong><p>结果会保存在素材库，完成后显示在画布中。</p></div></div>}
      </div>
      <div className="agent-compose-area">
        {ag.error && <p className="ai-error" role="alert">{ag.error}</p>}
        {imageError && imageError !== ag.error && imageError !== attachments.error && <p className="ai-error" role="alert">{imageError}</p>}
        {layered && wb.caps && !wb.caps.aiEnabled && hasAccess(wb) && <p className="ai-status">{wb.caps.reason}</p>}
        {done && <div ref={composerRef} className={`agent-composer${over ? ' attachment-drop-over' : ''}`} aria-busy={working}
          onDragEnter={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.stopPropagation(); dropDepth.current++; setOver(true); } }}
          onDragOver={(e) => { if (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes('text/plain')) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = working ? 'none' : 'copy'; } }}
          onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); dropDepth.current = Math.max(0, dropDepth.current - 1); if (!dropDepth.current) setOver(false); }}
          onDrop={(e) => {
            e.preventDefault(); e.stopPropagation(); setOver(false); dropDepth.current = 0;
            if (working) return;
            const files = Array.from(e.dataTransfer.files);
            if (files.length) void attachments.add(files);
            else { const text = e.dataTransfer.getData('text/plain'); if (text.trim()) setPrompt((p) => p ? `${p}\n${text}` : text); }
          }}>
          {over && <div className="brief-drop-label">{working ? '任务进行中，请稍后添加' : '松开添加设计附件'}</div>}

          <textarea id="agent-brief" aria-label="设计需求" data-testid="ai-prompt" disabled={working} rows={t || imageResult ? 2 : 4} value={prompt}
            placeholder={layered ? (t ? '继续描述需要调整的地方…' : '描述你想做的设计，也可以拖入图片、PSD 或文案…') : '描述要生成的画面；拖入的图片会作为参考图…'} onChange={(e) => setPrompt(e.target.value)}
            onPaste={(e) => { const files = Array.from(e.clipboardData.files); if (files.length && !working) { e.preventDefault(); e.stopPropagation(); void attachments.add(files); } }} />
          <BriefAttachments disabled={working} />
          {settings && layered && <div className="composer-settings">
            <label>画布尺寸<select aria-label="AI 输出尺寸" disabled={working} value={aspect} onChange={(e) => setAspect(e.target.value as AIAspect)}>{AI_ASPECTS.map((a) => <option key={a.id} value={a.id}>{a.label} · {creationSize(output, a.id).join(' × ')}</option>)}</select></label>
            {selected > 0 && <label className="ai-check"><input type="checkbox" checked={onlySel} disabled={working} onChange={(e)=>setOnlySel(e.target.checked)}/>仅修改选中图层</label>}
            {t && <label className="ai-check"><input type="checkbox" checked={newTask} onChange={(e)=>setNewTask(e.target.checked)}/>作为新任务，不沿用上一任务</label>}
          </div>}
          <input ref={fileInput} type="file" hidden multiple accept={ATTACHMENT_ACCEPT} onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ''; void attachments.add(files); }} />
          <div className="brief-actions">
            <button className="composer-attach" aria-label="添加文件" disabled={working} onClick={()=>fileInput.current?.click()} title="添加图片、PSD 或文案"><Icon name="plus" size={17}/></button>
            <div className="composer-modes" role="radiogroup" aria-label="AI 工作方式">
              {([['agent', 'Design Agent', 'sparkles'], ['image', '生图', 'image']] as const).map(([id, label, icon]) => (
                <button key={id} type="button" role="radio" aria-checked={(id === 'agent') === layered} data-testid={`mode-${id}`} disabled={working}
                  onClick={() => { setAIOutput(id === 'agent' ? 'layered' : 'asset'); setModelChoice(undefined); setSettings(false); }}><Icon name={icon} size={12}/>{label}</button>))}
            </div>
            {!layered && <>
              <select className="composer-chip" aria-label="分辨率" disabled={working} value={resolution} onChange={(e)=>setResolution(e.target.value)}>{(wb.caps?.imageOptions?.imageSizes ?? ['1K','2K','4K']).map((v)=><option key={v} value={v}>{v}</option>)}</select>
              <select className="composer-chip" aria-label="图片比例" disabled={working} value={ratio} onChange={(e)=>setRatio(e.target.value)}>{(wb.caps?.imageOptions?.aspectRatios ?? ['1:1','3:4','4:3','9:16','16:9']).map((v)=><option key={v} value={v}>{v}</option>)}</select>
              {assets.styles.length > 0 && <select className="composer-chip" aria-label="官方画风" title="画风" disabled={working} value={assets.styles.some((st)=>st.id===styleId) ? styleId : ''} onFocus={()=>void assets.loadStyles()} onChange={(e)=>setStyleId(e.target.value?Number(e.target.value):undefined)}><option value="">官方画风</option>{assets.styles.map((st)=><option key={st.id} value={st.id}>{st.name}</option>)}</select>}
            </>}
            {layered && <button className="composer-settings-trigger" aria-label="生成选项" title="画布尺寸与修改范围" aria-expanded={settings} onClick={()=>setSettings(!settings)}><Icon name="sliders" size={14}/></button>}
            <span className="composer-action-space"/>
            <ModelPicker models={modelOptions} selected={chosenModel} disabled={working} onSelect={setModelChoice}/>
            <button className="primary agent-start" data-testid="ai-start" aria-label={layered?'发送设计需求':'生成图片'} disabled={!canStart} title={!wb.caps?.aiEnabled?'请先在「设置 · AI」中配置 Key 与模型':layered?'分析需求并执行':'生成图片'} onClick={()=>void submit()}><Icon name="arrow" size={17} style={{transform:'rotate(-90deg)'}}/></button>
          </div>
        </div>}
        <div className="agent-access">{docName && <span className="brief-target" data-testid="ai-target" title={docName}><Icon name="file" size={11}/>{docName}</span>}<AccessGate />{wb.caps?.mock && <span className="mock-badge">模拟模式</span>}</div>
      </div>
    </div>
  );
}
