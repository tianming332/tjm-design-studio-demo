// Design-workbench tool catalog: the single source of truth for what the agent may call.
// The editor keeps only the engine-batch mapping for client tools and is tested against this list.

const COLOR = { type: 'string', pattern: '^#[0-9a-fA-F]{6}$', description: '#RRGGBB' };
const LAYER = { type: 'integer', minimum: 0, description: '图层 id（来自 doc_read，不能凭预览猜测）' };
const COORD = { type: 'number', minimum: -100000, maximum: 100000 };
const RECT4 = { type: 'array', items: { type: 'number', minimum: -100000, maximum: 100000 }, minItems: 4, maxItems: 4, description: '[x, y, w, h] 文档像素' };
const LAYERS = { type: 'array', items: LAYER, minItems: 1, maxItems: 50 };
const TEXTS = { type: 'array', items: { type: 'string', maxLength: 300 }, maxItems: 20 };
const ID = { type: 'string', maxLength: 80, pattern: '^[A-Za-z0-9_-]+$' };
const obj = (properties, required = []) => ({ type: 'object', properties, required });
const PLACEMENT = {
  role: { type: 'string', enum: ['background', 'subject', 'decoration'], description: '背景必须标 background；商品主体 subject；Logo/装饰 decoration' },
  fit: { type: 'string', enum: ['cover', 'contain', 'native'], description: 'cover 等比铺满允许裁边；contain 完整适配目标框；native 保留原尺寸。背景默认 cover' },
  rect: { ...RECT4, description: '目标框 [x,y,w,h]，背景不传则使用整张画布；主体和Logo请给出符合版式的目标框' },
};

const ALIGN_EDGES = ['leftEdges', 'horizontalCenters', 'rightEdges', 'topEdges', 'verticalCenters', 'bottomEdges'];
const ARRANGE = ['bringForward', 'sendBackward', 'bringToFront', 'sendToBack'];
const BLENDS = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'softLight', 'hardLight', 'difference', 'color', 'luminosity'];

/** Text-effect presets (parameters live in the editor's engine/textfx.ts; a test keeps both in step). */
export const TEXT_FX_PRESETS = {
  outline: '粗描边：文字外一圈描边（accent=描边色，默认白），适合压在图片上的标题',
  'double-outline': '双层描边：内白外深两圈（accent=内圈色，color=外圈色），促销/综艺感',
  shadow: '柔和投影：提升可读性，几乎适配所有场景',
  'long-shadow': '硬投影：无模糊的偏移投影，复古/波普感',
  neon: '霓虹：发光字（accent=光色），需要深色背景',
  glow: '外发光：柔和光晕（accent=光色）',
  metal: '金属：银色渐变＋斜面浮雕',
  gold: '金色：金色渐变＋斜面浮雕，节庆/高端',
  emboss: '浮雕：压印质感，适合与背景同色系的文字',
  candy: '糖果：亮色渐变＋白描边（color=主色），可爱/儿童',
  sticker: '贴纸：粗白边＋投影，像贴在画面上',
  gradient: '渐变：color→accent 纵向渐变填充',
};
const FX_KINDS = ['dropShadow', 'innerShadow', 'outerGlow', 'innerGlow', 'stroke', 'colorOverlay', 'gradientOverlay', 'satin', 'bevelEmboss'];
const WARP_STYLES = ['none', 'arc', 'arcLower', 'arcUpper', 'arch', 'bulge', 'shellLower', 'shellUpper', 'flag', 'wave', 'fish', 'rise', 'fisheye', 'inflate', 'squeeze', 'twist'];
const PX = { type: 'number', minimum: 0, maximum: 2000 };
const PCT = { type: 'number', minimum: 0, maximum: 100 };
const DEG = { type: 'number', minimum: -360, maximum: 360 };
const TONE = { type: 'array', items: { type: 'number', minimum: -100, maximum: 100 }, minItems: 3, maxItems: 3 };
/** Filters the agent may run (parameters and ranges live in the editor's engine/filters.ts; a test keeps both in step). */
export const FILTER_IDS = {"filter.blur.gaussianBlur":"高斯模糊（radius 0.1..250）","filter.blur.boxBlur":"方框模糊（radius 1..500）","filter.blur.motionBlur":"动感模糊（angle -360..360，distance 1..500）","filter.blur.surfaceBlur":"表面模糊（radius 1..100，threshold 2..255）","filter.blur.radialBlur#spin":"径向模糊（旋转）（amount 1..100）","filter.blur.radialBlur#zoom":"径向模糊（缩放）（amount 1..100）","filter.blur.lensBlur":"镜头模糊（radius 0..100）","filter.blur.average":"平均","filter.blur.blur":"模糊","filter.blur.blurMore":"进一步模糊","filter.sharpen.unsharpMask":"USM 锐化（amount 1..500，radius 0.1..250，threshold 0..255）","filter.sharpen.smartSharpen":"智能锐化（amount 1..500，radius 0.1..64，reduceNoise 0..100）","filter.sharpen.sharpen":"锐化","filter.sharpen.sharpenMore":"进一步锐化","filter.sharpen.sharpenEdges":"锐化边缘","filter.noise.addNoise":"添加杂色（amount 0.1..400，seed 0..9999）","filter.noise.reduceNoise":"减少杂色（strength 0..10，preserveDetails 0..100，reduceColorNoise 0..100，sharpenDetails 0..100）","filter.noise.dustAndScratches":"蒙尘与划痕（radius 1..100，threshold 0..255）","filter.noise.median":"中间值（radius 1..100）","filter.noise.despeckle":"去斑","filter.other.highPass":"高反差保留（radius 0.1..250）","filter.other.offset":"位移（horizontal -2000..2000，vertical -2000..2000）","filter.other.maximum":"最大值（radius 0.2..100）","filter.other.minimum":"最小值（radius 0.2..100）","filter.other.custom#sharpen":"自定（锐化核）","filter.other.custom#emboss":"自定（浮雕核）","filter.stylize.findEdges":"查找边缘","filter.stylize.emboss":"浮雕（angle -180..180，height 1..100，amount 1..500）","filter.pixelate.mosaic":"马赛克（cellSize 2..200）"};
const FILTER_VALUES = obj(Object.fromEntries(['radius', 'angle', 'distance', 'threshold', 'amount', 'reduceNoise', 'seed', 'strength', 'preserveDetails', 'reduceColorNoise', 'sharpenDetails', 'horizontal', 'vertical', 'height', 'cellSize'].map(k => [k, { type: 'number', minimum: -10000, maximum: 10000 }])));
const REL = { type: 'array', items: { type: 'number', minimum: 0, maximum: 1 }, minItems: 4, maxItems: 4, description: '[x, y, w, h]，以画布宽高为 1 的相对坐标' };
const HALIGN = { type: 'string', enum: ['left', 'center', 'right'] };
const VALIGN = { type: 'string', enum: ['top', 'middle', 'bottom'] };
const FX_EFFECT = obj({
  kind: { type: 'string', enum: FX_KINDS }, color: COLOR, from: COLOR, to: COLOR, size: PX, distance: PX, spread: PCT, choke: PCT, opacity: PCT, angle: DEG,
  position: { type: 'string', enum: ['outside', 'inside', 'center'] }, technique: { type: 'string', enum: ['softer', 'precise', 'smooth', 'chiselHard', 'chiselSoft'] },
  style: { type: 'string', enum: ['linear', 'radial', 'angle', 'reflected', 'diamond', 'inner', 'outer', 'emboss', 'pillow'] }, depth: { type: 'number', minimum: 1, maximum: 1000 },
  blend: { type: 'string', enum: ['normal', 'multiply', 'screen', 'overlay'] },
}, ['kind']);
const WARP = obj({ style: { type: 'string', enum: WARP_STYLES }, bend: { type: 'number', minimum: -100, maximum: 100 }, horizontalDistortion: { type: 'number', minimum: -100, maximum: 100 }, verticalDistortion: { type: 'number', minimum: -100, maximum: 100 } }, ['style']);

/** phase: workflow tools that must run before any edit (分析需求 → 检查素材 → 匹配 Skill). */
export const TOOLS = [
  { name: 'report_analysis', kind: 'workflow', risk: 'low', where: 'server', phase: 'analyze',
    description: '第一步：写下对用户需求的分析——目标、交付物、必须保留不改的内容、需要哪些素材。',
    params: obj({ goal: { type: 'string', maxLength: 500 }, deliverable: { type: 'string', maxLength: 300 }, constraints: TEXTS, keepUnchanged: TEXTS, neededAssets: TEXTS }, ['goal']) },
  { name: 'assets_list', kind: 'workflow', risk: 'low', where: 'server', phase: 'assets',
    description: '第二步：列出用户素材库里已有的素材（用户拖入／上传、之前生成、互联网导入）。优先使用这些素材。',
    params: obj({}) },
  { name: 'skill_list', kind: 'workflow', risk: 'low', where: 'server', phase: 'skills',
    description: '第三步：列出后台已发布的设计 Skill。category：workflow 完整工作流；capability 通用能力（特效字、选区处理、拆层…）；style 风格（一种视觉风格的品味与手法）；purpose 用途约束（渠道尺寸、安全区、信息层级）。选择最匹配的一个用 skill_load 读取；没有合适的就按通用流程继续。',
    params: obj({ query: { type: 'string', maxLength: 200 }, category: { type: 'string', enum: ['workflow', 'capability', 'style', 'purpose'] } }) },
  { name: 'skill_load', kind: 'workflow', risk: 'low', where: 'server', phase: 'skills',
    description: '读取一个 Skill 的完整步骤和允许的工具。读取后按其步骤执行。',
    params: obj({ slug: { type: 'string', maxLength: 60, pattern: '^[a-z0-9][a-z0-9-]+$' } }, ['slug']) },
  { name: 'doc_read', kind: 'read', risk: 'low', where: 'client',
    description: '读取目标文档：尺寸、修订号、图层树（id、类型、名称、文字、边界、锁定、可见）。',
    params: obj({}) },
  { name: 'doc_preview', kind: 'read', risk: 'low', where: 'client',
    description: '取得当前修订的真实渲染预览（PNG），可指定局部区域；返回 region 与 scale 用于换算回文档像素。',
    params: obj({ region: obj({ x: COORD, y: COORD, w: { type: 'number', minimum: 1, maximum: 100000 }, h: { type: 'number', minimum: 1, maximum: 100000 } }, ['x', 'y', 'w', 'h']), maxSide: { type: 'integer', minimum: 64, maximum: 1024 } }) },
  { name: 'font_list', kind: 'read', risk: 'low', where: 'client',
    description: '列出可用字体：字体库（可商用开源字体，带风格标签：黑体、宋体、圆体、手写、书法、衬线、展示…，首次使用时自动加载）和已加载字体。text_create／text_style 的 font 填返回的 family。可按 script（zh 中文、ja 日文、en 西文）或 tag 筛选。',
    params: obj({ script: { type: 'string', enum: ['zh', 'ja', 'en'] }, tag: { type: 'string', maxLength: 20 } }) },
  { name: 'text_create', kind: 'edit', risk: 'low', where: 'client',
    description: '新建可编辑文字图层。x/y 为文字锚点（文档像素）；给 box 则为段落文字框。font 用 font_list 的 family（默认 Noto Sans SC）。',
    params: obj({ text: { type: 'string', maxLength: 2000 }, x: COORD, y: COORD, size: { type: 'number', minimum: 1, maximum: 2000 }, color: COLOR, font: { type: 'string', maxLength: 120 }, box: RECT4, align: { type: 'string', enum: ['left', 'center', 'right'] } }, ['text', 'x', 'y']) },
  { name: 'text_edit', kind: 'edit', risk: 'low', where: 'client', description: '替换文字图层的全部文字。',
    params: obj({ layer: LAYER, text: { type: 'string', maxLength: 2000 } }, ['layer', 'text']) },
  { name: 'text_style', kind: 'edit', risk: 'low', where: 'client', description: '修改文字图层字号、颜色、字体、对齐、字距或行距（只改给出的字段）。',
    params: obj({ layer: LAYER, size: { type: 'number', minimum: 1, maximum: 2000 }, color: COLOR, font: { type: 'string', maxLength: 120 }, align: { type: 'string', enum: ['left', 'center', 'right', 'justify'] }, tracking: { type: 'number', minimum: -1000, maximum: 10000 }, leading: { type: 'number', minimum: 0, maximum: 5000 } }, ['layer']) },
  { name: 'layer_move', kind: 'edit', risk: 'low', where: 'client', description: '按像素位移移动图层（dx/dy 相对量，按 doc_read 的边界计算）。',
    params: obj({ layer: LAYER, dx: COORD, dy: COORD }, ['layer', 'dx', 'dy']) },
  { name: 'layer_fit', kind: 'edit', risk: 'low', where: 'client',
    description: '缩放并定位已有图片/形状图层。修复过小背景用 role=background,fit=cover（自动铺满并置底）；商品主体用 role=subject,fit=contain,rect=[x,y,w,h]。不拉伸。返回实际边界与覆盖检查。',
    params: obj({ layer: LAYER, ...PLACEMENT, centerX: COORD, centerY: COORD }, ['layer']) },
  { name: 'layer_props', kind: 'edit', risk: 'low', where: 'client', description: '设置图层显隐、不透明度（0..1）、名称或混合模式。',
    params: obj({ layer: LAYER, visible: { type: 'boolean' }, opacity: { type: 'number', minimum: 0, maximum: 1 }, name: { type: 'string', maxLength: 120 }, blend: { type: 'string', enum: BLENDS } }, ['layer']) },
  { name: 'layer_arrange', kind: 'edit', risk: 'low', where: 'client', description: '调整图层叠放顺序。',
    params: obj({ layer: LAYER, direction: { type: 'string', enum: ARRANGE } }, ['layer', 'direction']) },
  { name: 'layer_align', kind: 'edit', risk: 'low', where: 'client', description: '对齐图层；to=canvas 对齐画布。',
    params: obj({ layers: LAYERS, edge: { type: 'string', enum: ALIGN_EDGES }, to: { type: 'string', enum: ['layers', 'canvas'] } }, ['layers', 'edge']) },
  { name: 'shape_create', kind: 'edit', risk: 'low', where: 'client', description: '新建矩形或椭圆形状图层（rect 为 [x, y, w, h]）。',
    params: obj({ kind: { type: 'string', enum: ['rect', 'ellipse'] }, rect: RECT4, fill: COLOR, name: { type: 'string', maxLength: 120 } }, ['kind', 'rect', 'fill']) },
  { name: 'fill_solid', kind: 'edit', risk: 'low', where: 'client', description: '新建纯色填充图层（可再用 layer_arrange 置底）。',
    params: obj({ color: COLOR }, ['color']) },
  { name: 'layer_group', kind: 'edit', risk: 'low', where: 'client', description: '把多个图层编为一组。',
    params: obj({ layers: LAYERS, name: { type: 'string', maxLength: 120 } }, ['layers']) },
  { name: 'layer_delete', kind: 'edit', risk: 'confirm', where: 'client', description: '删除图层（需要用户确认）。',
    params: obj({ layer: LAYER }, ['layer']) },
  { name: 'text_fx_apply', kind: 'edit', risk: 'low', where: 'client',
    description: `给图层（通常是文字）加特效，可编辑、改字后效果自动跟随。按 preset 选预设（尺寸按字号自动换算），可用 effects 逐项覆盖同类效果，warp 给文字图层加变形（arc 扇形、arch 拱形、wave 波浪、flag 旗帜、rise 上升等）。会替换该图层原有的全部样式。预设：${Object.entries(TEXT_FX_PRESETS).map(([k, v]) => `${k}=${v}`).join('；')}`,
    params: obj({ layer: LAYER, preset: { type: 'string', enum: Object.keys(TEXT_FX_PRESETS) }, color: COLOR, accent: COLOR, effects: { type: 'array', items: FX_EFFECT, maxItems: 9 }, warp: WARP }, ['layer']) },
  { name: 'text_extrude', kind: 'edit', risk: 'low', where: 'client',
    description: '把文字做成立体字：在文字下方叠出带厚度的侧面（逐层偏移、颜色渐深），与正面编为「立体字」组。正面保持可编辑，可先用 text_fx_apply 做正面效果；正面有描边时把描边粗细填进 outline。改文字或参数后再调用一次即重建厚度。',
    params: obj({ layer: LAYER, depth: { type: 'number', minimum: 2, maximum: 600, description: '厚度（文档像素），默认字号的 15%' }, angle: { ...DEG, description: '厚度方向：0 向右，90 向下，默认 45（右下）' }, sideColor: { ...COLOR, description: '侧面颜色，默认深灰；一般取正面颜色的深色' }, outline: PX, shadow: { type: 'boolean', description: '最底层加投影，默认 true' } }, ['layer']) },
  { name: 'text_fx_clear', kind: 'edit', risk: 'low', where: 'client', description: '清除图层的全部样式与文字变形。',
    params: obj({ layer: LAYER }, ['layer']) },
  { name: 'region_select', kind: 'edit', risk: 'low', where: 'client',
    description: '建立选区来限定修改范围（doc_read 的 selection 字段显示当前选区；用户可能已经框选好，先读再决定）。method：subject 选择主体；object 在 rect 框内识别物体并精确选中；focus 焦点区域；rect/ellipse 矩形/椭圆；all 全选；none 取消选择；inverse 反选（例如改背景）。给 layer 则只按该图层识别。',
    params: obj({ method: { type: 'string', enum: ['subject', 'object', 'focus', 'rect', 'ellipse', 'all', 'none', 'inverse'] }, rect: RECT4, layer: LAYER, mode: { type: 'string', enum: ['replace', 'add', 'subtract', 'intersect'] }, feather: PX }, ['method']) },
  { name: 'region_refine', kind: 'edit', risk: 'low', where: 'client', description: '调整当前选区边缘：radius 边缘检测半径、smooth 平滑、feather 羽化、contrast 对比度、shiftEdge 收缩(-)/扩展(+)。',
    params: obj({ radius: { type: 'number', minimum: 0, maximum: 250 }, smooth: PCT, feather: { type: 'number', minimum: 0, maximum: 250 }, contrast: PCT, shiftEdge: { type: 'number', minimum: -100, maximum: 100 } }) },
  { name: 'region_apply', kind: 'edit', risk: 'low', where: 'client',
    description: '在当前选区内对 layer 执行操作，结果是新图层，原图层不变：cutout 抠出为带蒙版的新图层；remove 用内容识别填充把选区内容抹掉（补底放在新图层）。需要先有选区。',
    params: obj({ op: { type: 'string', enum: ['cutout', 'remove'] }, layer: LAYER, edge: { type: 'number', minimum: 0, maximum: 50 } }, ['op', 'layer']) },
  { name: 'adjust_apply', kind: 'edit', risk: 'low', where: 'client',
    description: '新建调整图层（非破坏，可删除）。有选区时只作用于选区（选区成为蒙版），没有选区时作用于下方全部图层。kind：brightnessContrast(brightness,contrast)；hueSaturation(hue,saturation,lightness,colorize)；vibrance(vibrance,saturation)；exposure(exposure,gamma)；colorBalance(shadows/midtones/highlights=[青红,洋红绿,黄蓝] -100..100)；photoFilter(filter 或 color, density)；blackWhite；colorLookup(lut)；gradientMap(gradient)；invert。',
    params: obj({
      kind: { type: 'string', enum: ['brightnessContrast', 'hueSaturation', 'vibrance', 'exposure', 'colorBalance', 'photoFilter', 'blackWhite', 'colorLookup', 'gradientMap', 'invert'] },
      brightness: { type: 'number', minimum: -150, maximum: 150 }, contrast: { type: 'number', minimum: -50, maximum: 100 },
      hue: { type: 'number', minimum: -180, maximum: 360 }, saturation: { type: 'number', minimum: -100, maximum: 100 }, lightness: { type: 'number', minimum: -100, maximum: 100 }, colorize: { type: 'boolean' },
      vibrance: { type: 'number', minimum: -100, maximum: 100 }, exposure: { type: 'number', minimum: -20, maximum: 20 }, gamma: { type: 'number', minimum: 0.01, maximum: 9.99 },
      shadows: TONE, midtones: TONE, highlights: TONE,
      filter: { type: 'string', enum: ['warming85', 'warming81', 'cooling80', 'cooling82', 'red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'violet', 'magenta', 'sepia', 'underwater'] }, color: COLOR, density: PCT,
      lut: { type: 'string', enum: ['warm', 'cool', 'tealOrange', 'bleachBypass', 'fadedFilm', 'dayForNight', 'monoContrast', 'crossProcess'] },
      gradient: obj({ from: COLOR, to: COLOR }, ['from', 'to']),
    }, ['kind']) },
  { name: 'region_capture', kind: 'asset', risk: 'low', where: 'client',
    description: '生成式局部修改的第一步：把当前选区（四周外扩约 25% 作为上下文）的画面截成素材，返回 assetId、rect 和 aspectRatio。随后 image_generate(referenceAssetIds=[assetId], aspectRatio) 描述要替换成的内容（只改原选区那部分、其余与参考图一致），再 asset_import(rect=返回的 rect, fit=cover) 放回原位，最后 region_mask 把新图层限制在选区内。原图层不变。',
    params: obj({ pad: { type: 'number', minimum: 0, maximum: 1, description: '上下文外扩比例，默认 0.25' } }) },
  { name: 'region_mask', kind: 'edit', risk: 'low', where: 'client', description: '用当前选区给图层加蒙版（只显示选区内）。用于把生成的补丁限制在原选区。',
    params: obj({ layer: LAYER }, ['layer']) },
  { name: 'filter_apply', kind: 'edit', risk: 'low', where: 'client',
    description: `对像素图层执行滤镜（直接改像素，可撤销；有选区时只作用于选区）。values 只填该滤镜列出的参数，超出范围会被截断。滤镜：${Object.entries(FILTER_IDS).map(([k, v]) => `${k}=${v}`).join('；')}`,
    params: obj({ filter: { type: 'string', enum: Object.keys(FILTER_IDS) }, layer: LAYER, values: FILTER_VALUES }, ['filter', 'layer']) },
  { name: 'doc_lint', kind: 'read', risk: 'low', where: 'client',
    description: '确定性排版检查（不依赖模型）：文字越出画布、贴边、重叠、字太小、与背景对比度不足、空文字。交付前与 doc_preview 一起使用，按 issues 逐条修正。',
    params: obj({}) },
  { name: 'layout_apply', kind: 'edit', risk: 'low', where: 'client',
    description: '按版式一次摆放多个图层：box 用相对画布的 [x,y,w,h]（0..1）。文字图层会缩小字号到放得下并按 align/valign 对齐（grow=true 时也会放大填满）；图片/形状图层按 fit 等比放进框内（contain 完整显示，cover 铺满裁边）。先规划版式再调用，避免逐个像素移动。',
    params: obj({ items: { type: 'array', minItems: 1, maxItems: 20, items: obj({ layer: LAYER, box: REL, fit: { type: 'string', enum: ['contain', 'cover'] }, align: HALIGN, valign: VALIGN, grow: { type: 'boolean' } }, ['layer', 'box']) } }, ['items']) },
  { name: 'text_fit', kind: 'edit', risk: 'low', where: 'client', description: '把文字图层缩放进像素框 box=[x,y,w,h] 并对齐（grow=true 时允许放大）。返回实际边界与是否放得下。',
    params: obj({ layer: LAYER, box: RECT4, align: HALIGN, valign: VALIGN, grow: { type: 'boolean' } }, ['layer', 'box']) },
  { name: 'image_generate', kind: 'asset', risk: 'low', where: 'server',
    description: '生成一张素材图片，存入用户素材库（不修改文档）。可选 styleId 使用后台画风；返回 assetId，再用 asset_import 放入文档。',
    params: obj({ prompt: { type: 'string', maxLength: 4000 }, role: PLACEMENT.role, styleId: { type: 'integer', minimum: 1 }, referenceAssetIds: { type: 'array', items: ID, maxItems: 3 }, size: { type: 'string', enum: ['1024x1024', '1024x1536', '1536x1024'] }, aspectRatio: { type: 'string', enum: ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9'], description: '局部替换时用 region_capture 返回的 aspectRatio' } }, ['prompt']) },
  { name: 'asset_import', kind: 'asset', risk: 'low', where: 'client',
    description: '导入素材并完成缩放定位。背景必须 role=background（默认等比 cover 铺满画布并置底）；主体/Logo用 role=subject/decoration,fit=contain,rect=[x,y,w,h]，不要只设置中心让素材原尺寸悬在画布中。返回实际 bounds/coveredCanvas。',
    params: obj({ assetId: ID, name: { type: 'string', maxLength: 120 }, centerX: COORD, centerY: COORD, ...PLACEMENT }, ['assetId']) },
];

export const TOOL_BY_NAME = new Map(TOOLS.map(tool => [tool.name, tool]));
export const WORKFLOW_PHASES = ['analyze', 'assets', 'skills'];

export function checkSchema(schema, value, path = '参数') {
  switch (schema.type) {
    case 'string':
      if (typeof value !== 'string') return `${path} 应为字符串`;
      if (schema.maxLength != null && value.length > schema.maxLength) return `${path} 超过 ${schema.maxLength} 字符`;
      if (schema.enum && !schema.enum.includes(value)) return `${path} 只能是 ${schema.enum.join(' / ')}`;
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) return `${path} 格式不正确`;
      return undefined;
    case 'number':
    case 'integer':
      if (typeof value !== 'number' || !Number.isFinite(value)) return `${path} 应为数字`;
      if (schema.type === 'integer' && !Number.isInteger(value)) return `${path} 应为整数`;
      if (schema.minimum != null && value < schema.minimum) return `${path} 不能小于 ${schema.minimum}`;
      if (schema.maximum != null && value > schema.maximum) return `${path} 不能大于 ${schema.maximum}`;
      return undefined;
    case 'boolean':
      return typeof value === 'boolean' ? undefined : `${path} 应为布尔值`;
    case 'array':
      if (!Array.isArray(value)) return `${path} 应为数组`;
      if (schema.minItems != null && value.length < schema.minItems) return `${path} 至少 ${schema.minItems} 项`;
      if (schema.maxItems != null && value.length > schema.maxItems) return `${path} 最多 ${schema.maxItems} 项`;
      for (let i = 0; i < value.length; i++) { const e = checkSchema(schema.items, value[i], `${path}[${i}]`); if (e) return e; }
      return undefined;
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return `${path} 应为对象`;
      for (const key of Object.keys(value)) if (!(key in schema.properties)) return `${path} 含未知字段 ${key}`;
      for (const key of schema.required || []) if (value[key] === undefined) return `${path} 缺少 ${key}`;
      for (const [key, sub] of Object.entries(schema.properties)) {
        if (value[key] === undefined) continue;
        const e = checkSchema(sub, value[key], key);
        if (e) return e;
      }
      return undefined;
    }
    default:
      return `${path} 的 schema 无效`;
  }
}

export function validateCall(name, args) {
  const tool = TOOL_BY_NAME.get(name);
  if (!tool) return { ok: false, error: { code: 'INVALID_TOOL_CALL', message: `未知或未开放的工具：${name}` } };
  const value = args ?? {};
  const problem = checkSchema(tool.params, value);
  if (problem) return { ok: false, error: { code: 'INVALID_TOOL_CALL', message: `${name}：${problem}` } };
  return { ok: true, tool, args: value };
}

export function targetLayers(args) {
  const ids = [];
  if (typeof args.layer === 'number') ids.push(args.layer);
  if (Array.isArray(args.layers)) for (const id of args.layers) if (typeof id === 'number') ids.push(id);
  if (Array.isArray(args.items)) for (const it of args.items) if (typeof it?.layer === 'number') ids.push(it.layer);
  return ids;
}

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}

export async function digest(text) {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export const stepDigest = (tool, args) => digest(canonical({ tool, args }));

/** Plain JSON-Schema subset for function declarations (no `pattern`). */
export function declarationSchema(schema) {
  const out = { type: schema.type };
  if (schema.description) out.description = schema.description;
  if (schema.type === 'string' && schema.enum) out.enum = schema.enum;
  if (schema.type === 'number' || schema.type === 'integer') {
    if (schema.minimum != null) out.minimum = schema.minimum;
    if (schema.maximum != null) out.maximum = schema.maximum;
  }
  if (schema.type === 'array') {
    out.items = declarationSchema(schema.items);
    if (schema.minItems != null) out.minItems = schema.minItems;
    if (schema.maxItems != null) out.maxItems = schema.maxItems;
  }
  if (schema.type === 'object') {
    out.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, sub]) => [key, declarationSchema(sub)]));
    if (schema.required?.length) out.required = schema.required;
  }
  return out;
}
