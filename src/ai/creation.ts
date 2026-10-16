/** Output choices within one AI workspace, not separate application modes. */
export type AIOutput = 'poster' | 'asset' | 'layered';
export type AIAspect = 'portrait' | 'square' | 'landscape';
export const AI_OUTPUTS: { id: AIOutput; label: string; icon: string; hint: string; action: string }[] = [
  { id: 'poster', label: '整张海报', icon: 'image', hint: '直接生成完整海报图片，文字与画面合为一张图。', action: '生成海报' },
  { id: 'asset', label: '生成素材', icon: 'shape', hint: '生成背景、主体或装饰素材，存入素材库并放入画布。', action: '生成素材' },
  { id: 'layered', label: '分层海报', icon: 'layers', hint: '由 Agent 组织图片、文字与形状，保留可继续编辑的图层。', action: '生成分层海报' },
];
export const AI_ASPECTS: { id: AIAspect; label: string }[] = [
  { id: 'portrait', label: '竖版' }, { id: 'square', label: '方形' }, { id: 'landscape', label: '横版' },
];
export function creationSize(output: AIOutput, aspect: AIAspect): [number, number] {
  if (output === 'layered') return aspect === 'square' ? [1080, 1080] : aspect === 'landscape' ? [1920, 1080] : [1080, 1440];
  return aspect === 'square' ? [1024, 1024] : aspect === 'landscape' ? [1536, 1024] : [1024, 1536];
}
export function creationPrompt(output: AIOutput, brief: string): string {
  const instruction = output === 'poster'
    ? '请直接生成一张完整的海报图片，将画面、文案和排版统一设计在同一张图片中。输出为完整平面图，不要求分层。'
    : output === 'asset'
      ? '请生成用于设计的图片素材，围绕用户指定的主体、背景或装饰内容，不额外添加海报标题或排版，除非用户明确要求。'
      : '先分析用户的设计需求、文案、参考素材和当前文档，再确定交付物与执行步骤；不要预设所有需求都是海报。根据用户需求操作目标文档，图片、文字与形状分别组织为独立可编辑图层；需要生成视觉素材时使用生图工具，再按版式放入文档。文字保持可编辑，最后核对真实预览。';
  return `${instruction}\n\n用户需求：\n${brief.trim()}`;
}
