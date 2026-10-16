export const EDITOR_READS = new Set(['doc_read', 'doc_preview']);
export function needsFinalPreview(task) {
  const edited = task.steps.reduce((last, s, i) => s.where === 'client' && !EDITOR_READS.has(s.tool) && s.status === 'done' && s.receipt?.status === 'ok' ? i : last, -1);
  if (edited < 0) return false;
  return !task.steps.some((s, i) => i > edited && s.tool === 'doc_preview' && s.status === 'done' && !s.args.region
    && s.receipt?.status === 'ok' && s.receipt?.preview?.revision === task.observedRevision && s.receipt.revisionAfter === task.observedRevision);
}
/** Always appended even when a custom admin prompt or old published Skill is loaded. */
export const DESIGN_EXECUTION_RULES = [
  '【画布执行规则】以 doc_read 的实际画布像素为坐标基准，不能把缩小预览上的坐标直接当作原图像素。',
  '先确定背景、主体、标题、副标题和信息区的矩形区域与留白，再创建图层。背景用 asset_import(role=background,fit=cover)，自动等比铺满整张画布并置底。',
  '商品/主视觉用 role=subject,fit=contain,rect=[x,y,w,h] 放到足够大的主体区，Logo和装饰用各自的小目标框。不要保持小素材原始尺寸导致主体只占画布中央一小块。',
  '修复已导入尺寸错误的图片用 layer_fit；不要重新生图代替几何修正。返回 coveredCanvas=false 的背景不算完成。',
  '文字保持可编辑、与底图有足够对比。不要用无内容矩形假装信息区完成；装饰块不得遮挡文字。通过真实预览检查文字、主视觉和背景的相对占比。',
  '字体要配合风格：先 font_list 按 script／tag 选 family（中文标题可用书法、手写、圆体、展示类，正文用黑体或宋体），不要编造字体名。',
  '特效字用 text_fx_apply（预设＋覆盖），立体字用 text_extrude；不要手工复制多个文字图层模拟描边、投影或厚度。',
  '用户已框选（doc_read 有 selection）或要求只改某处时，先用选区限定范围，再用 adjust_apply／region_apply；选区外不改。',
  '生成式局部替换前先 report_region 分析原主体（光源、透视、接触投影），放回后用 region_mask(feather) 羽化融合并局部预览检查接缝。拆层前先 report_layers 规划元素分类与外框，再执行拆分。',
  '任何编辑之后旧预览都作废。最后一次修改后必须 doc_preview 获取完整画布，再检查遮挡、越界、未铺满背景、缺失文案及空白占位块；必要时修改并再次预览。只在最后检查通过后报告完成。',
].join('\n');
