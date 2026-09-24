import WorkspaceCanvas from './WorkspaceCanvas.js';
import ThreePreview from './ThreePreview.js';
import { AI_REDRAW_TIMEOUT_MS, ARK_ENDPOINT, buildPrompt, calcSize } from './arkDirect.js';
import { ARK_LINKS, ARK_MODEL_CANDIDATES, detectActivatedModel, formatRawBits } from './arkDiagnostics.js';
import { downloadPrintPdf, downloadPrintPng, downloadProjectJson, downloadUsageWorkbook } from './exporters.js';
import { imageFileToBeads } from './imageToBeads.js';
// B36：主体分割模型（MediaPipe Selfie Multiclass）。打开页面就开始后台加载，失败则静默走老算法。
import { ensureSegmenter, isModelReady, segmentSubject } from './segmentModel.js';
import { evaluateSubjectGate, upscaleSubjectMask } from './subjectGate.js';
import ParamNumberField from './ParamNumberField.js';
import { getColor } from './palette.js';
// KI-012（W3.4 接线）：色板必须跟着 `project.activeBrand` 走。
// `paletteForBrand` = 该品牌默认（basic 档）色板；`completePaletteForBrand` = 该品牌全量（complete 档）。
// 默认品牌仍是 MARD，且 MARD 两个分支返回的就是 `basicPalette` / `completePalette` 本身，
// 所以默认态与改动前逐字一致（见 W3.4 报告 §默认态等价）。
import { applyBrandRecolor, completePaletteForBrand, getBrandProfile, paletteForBrand } from './brands.js';
import BrandSelect from './BrandSelect.js';
import { 
// B6：`createLayer` 从这条 import 里删掉了 —— 它唯一的消费方是 `addLayer()`（本批删除），
//     删除后它就成了死 import（`tsc --noUnusedLocals` 实测报 TS6133）。
//     ⚠️ `project.ts` 里的 `createLayer` 本身**保留**（数据模型不动，启动时仍由 `createProject()` 建一层）。
composeVisibleCells, createProject, getSourceImageRef, loadDraft, normalizeProject, saveDraft, sourceImageRefFromStored, withCells, withLayers, withSourceImage, } from './project.js';
// W6 接线（R5 / KI-007 根修）：源图持久化。
// 两条硬约束见 W4 交付报告 §8 与 V-W4 §7：
//   (A) 源图关联**只能有一个写者**（`sourceImageRef` 状态 + 唯一持久化点合并），
//       否则 `generateFromImage()` 的整份写回会把它冲成 null；
//   (B) 恢复出来的源图必须**抑制第一轮自动重算**，否则刷新会把恢复的图纸覆盖掉。
import { SOURCE_IMAGE_LOST_NOTICE, clearSourceImage, loadSourceImage, probeSourceImage, saveSourceImage, } from './imageStore.js';
import { findIsolatedBeads, summarizeUsage } from './usage.js';
const { useEffect, useMemo, useRef, useState } = React;
// —— W0.1 纯搬迁后的导入（模块都在 src/ 下平铺，不建子目录）——
import { languageKey, ui } from './i18n.js';
import { looksLikeArkKey } from './arkKey.js';
import { resizeCells } from './cells.js';
import { GitHubIcon, ResetIcon, ClipboardPreview, ToolIcon, PanelEntryIcon, ShapeOptionIcon, ArrowOptionIcon, UndoIcon, RedoIcon } from './icons.js';
import { adjustLayerCells, mergeCloseLayerColors, limitLayerColors, applyEffectToLayer, clampInteger } from './layerAdjustments.js';
import ExportPanel from './ExportPanel.js';
import RightPanel from './RightPanel.js';
import { PaletteBody } from './RightPanel.js';
import { useRecolorSession } from './useRecolorSession.js';
import { PHONE_QUERY, PANEL_LAYOUT_QUERY, useMediaQuery } from './useMediaQuery.js';
/**
 * 工具条上的工具（**10 个**，2026-09-20 用户裁决从 13 精简而来）。
 * 合并/删除都不是删能力，是换入口 —— 详见 `types.ts` 的 `ToolId`。
 */
const tools = [
    { id: 'pencil' },
    { id: 'eraser' },
    { id: 'fill' },
    { id: 'recolor' },
    { id: 'eyedropper' },
    { id: 'move' },
    { id: 'clipboard' },
    { id: 'mirror' },
    { id: 'shape' },
    { id: 'text' },
];
/**
 * 工具条顶部的「面板条目」（2026-09-20 第 3 批）。
 *
 * 桌面（`PANEL_LAYOUT_QUERY` 不命中）两个面板是常显的网格列 ⇒ 这些条目**一个节点都不渲染**，
 * 桌面 DOM 与像素因此不变。窄屏 / 触屏下面板退化成覆盖式抽屉，这里是**唯一**的打开入口
 * —— 顶栏那两个 `.panel-toggle` 已随本批删除。
 *
 * ⚠️ 它们**不是工具**：不进 `tools`（`tool ===` 判定、`ToolId` 类型、`tools.length === 10` 的
 * 门禁全部不受影响），只是"打开某个面板的某一段"。
 * 分组按用户裁决 B1：素材 = 3D 预览 + 上传 + AI + 参数；参考 = 参考图；颜色 = 右抽屉。
 */
const PANEL_ENTRIES = [
    { id: 'material', panel: 'left', section: 'material' },
    { id: 'reference', panel: 'left', section: 'reference' },
    // B27（用户 2026-09-22）：右抽屉**拆成两个条目** —— 「图纸」= 视图/格子/参数调节；「改色」= 用量与改色。
    //   两个都开同一个右抽屉，靠 `rightTab` 决定抽屉里显示哪一段（`isOpen` 也要一起比，否则两个条目会同时高亮）。
    { id: 'palette', panel: 'right', section: null, rightTab: 'palette' },
    { id: 'recolor', panel: 'right', section: null, rightTab: 'usage' },
];
/*
 * ⚠️ 这里原来有一个 `railRowOf(id, panelLayout)`：它算"这个工具在 `.tool-rail` 的第几行"，
 * 供 8 个 `.tool-options` 浮层写 `grid-row` —— 浮层当时是**工具条（`display:grid`）的绝对定位子项**，
 * 按 CSS Grid 规范，绝对定位的网格子项只要设了 `grid-row`，包含块就是那一行的网格区域，
 * 于是 `top:0` 正好贴住按钮上沿（第 3 批 KI-034 的修法）。
 *
 * **2026-09-21 已整体删除**（根修，不是补丁）：那套机制成立的前提是
 * "浮层的父容器不裁剪"，而第 3 批同一次改动给 `.tool-rail` 加了 `overflow-x: hidden`
 * ⇒ 浮层被**整块裁掉**（桌面 1600 实测 `rect.x=391` 而 `.tool-rail` 右边界 `384`，
 * `elementFromPoint(浮层中心)` 落在画布上；iPad 1024 同理）。裁掉的浮层看不见也点不到，
 * 而且点击**穿透到画布**（换色工具下会真的改图）。
 *
 * 现在浮层挂在 `.app-shell` 的专用覆盖层 `.tool-options-layer` 上（`.tool-rail` 的**兄弟**），
 * 位置由触发按钮的 `getBoundingClientRect()` 一次性算出（见下面
 * `placeToolOptions()` 与那段 `useLayoutEffect`）⇒ 与"容器裁不裁剪"彻底解耦，
 * 也不再需要任何"第几行"的算术。**没有第二套定位并存。**
 */
const sizePresets = [
    { label: '52 * 52', width: 52, height: 52 },
    { label: '78 * 78', width: 78, height: 78 },
    { label: '104 * 104', width: 104, height: 104 },
    { label: '156 * 156', width: 156, height: 156 },
];
const defaultImportSettings = {
    width: 52,
    maxColors: 24,
    generationStyle: 'cartoon',
    // 默认「去除背景」：AI 重绘默认抠出纯白底，主体干净；
    // 图纸阶段也默认把白底去成空格（保留背景会让边缘多出一圈碎色）
    backgroundMode: 'remove-white',
    tolerance: 32,
    speckleReduction: 0,
};
/** AI 重绘一次的费用不低，但也不该无限堆，历史最多留这么多张
 *  注意：界面上一行只放得下 5 个缩略图，所以不要超过 5，否则左栏会变高 */
const AI_HISTORY_LIMIT = 5;
/** B36 判据用的分析尺寸：把图缩到 256×256 后算噪点中位数（与模型输入同尺寸，省一次缩放） */
const SUBJECT_GATE_ANALYSIS_SIDE = 256;
/** 把 File 解码成 HTMLImageElement（只用于算主体掩膜；出图那边自己还会解码一次） */
function decodeImageFile(file) {
    return new Promise((resolve) => {
        const url = URL.createObjectURL(file);
        const image = new Image();
        image.onload = () => {
            URL.revokeObjectURL(url);
            resolve(image);
        };
        image.onerror = () => {
            URL.revokeObjectURL(url);
            resolve(null);
        };
        image.src = url;
    });
}
/**
 * 算「主体掩膜」（B36）。**返回 null 表示这次不要用模型**，调用方原样走老算法。
 *
 * 四步，任何一步不满足都返回 null：
 * 1. 模型没就绪（没加载完 / 加载失败）⇒ null。**不等待、不重试**：不能让出图等模型。
 * 2. 解码图片 ⇒ 缩到 256×256 算噪点中位数，判断「这是不是照片」；
 * 3. 跑模型得类别掩膜，算「前景格占比 / 最大连通块」，判断「模型认不认识主体」；
 * 4. 两条都过 ⇒ 把掩膜放大到原图尺寸返回；否则 null。
 *
 * 实测分离度（10 张素材）：照片噪点中位数 7/3/3/3，画与像素画恒为 0；
 * 风景前景格 1~5%、复杂城市 0%，人像/猫 37~66% —— 判据分得很开。
 */
async function computeSubjectMask(file, convertWidth) {
    if (!isModelReady())
        return null;
    try {
        const image = await decodeImageFile(file);
        if (!image)
            return null;
        const sourceWidth = Math.max(1, image.naturalWidth);
        const sourceHeight = Math.max(1, image.naturalHeight);
        const side = SUBJECT_GATE_ANALYSIS_SIDE;
        const canvas = document.createElement('canvas');
        canvas.width = side;
        canvas.height = side;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context)
            return null;
        context.imageSmoothingEnabled = true;
        context.drawImage(image, 0, 0, side, side);
        const analysis = context.getImageData(0, 0, side, side).data;
        const mask = await segmentSubject(image);
        const gridWidth = Math.max(1, Math.round(convertWidth));
        const gridHeight = Math.max(1, Math.round((sourceHeight / sourceWidth) * gridWidth));
        const gate = evaluateSubjectGate(analysis, side, side, mask, {
            gridWidth,
            gridHeight,
            sourceWidth,
            sourceHeight,
        }, 7);
        if (!mask || !gate.usable)
            return null;
        return upscaleSubjectMask(mask, sourceWidth, sourceHeight);
    }
    catch {
        return null;
    }
}
/** 默认用的火山方舟模型。不同账号开通的模型不一样，程序会自动识别出可用的那个 */
const DEFAULT_AI_MODEL = 'doubao-seedream-5-0-pro-260628';
const defaultColorId = 'mard-h7';
const defaultRecentColorIds = ['mard-h7', 'mard-h2'];
const defaultAdjustments = {
    brightness: 0,
    contrast: 0,
    saturation: 0,
    temperature: 0,
    hue: 0,
};
export default function App() {
    const fileInputRef = useRef(null);
    const referenceInputRef = useRef(null);
    const jsonInputRef = useRef(null);
    const autoGenerateShouldCommitRef = useRef(false);
    const generationRequestRef = useRef(0);
    const adjustmentSessionRef = useRef({ layerId: null, baseCells: [] });
    const [language, setLanguage] = useState(() => (localStorage.getItem(languageKey) === 'en' ? 'en' : 'zh'));
    const text = ui[language];
    /**
     * W6 接线（W4 §8.2）：草稿只读一次，并且让 `sourceImageRef` 与最初的 project 出自**同一份**草稿。
     * 为什么不能直接 `useState(() => loadDraft() ?? createProject())`：下面 8.4 的 `sourceImageRef`
     * 初值必须来自**同一份**草稿（`getSourceImageRef(...)`）。分两次调用 `loadDraft()` 会读两份对象，
     * 且若 `sourceImageRef` 初值给 `null`，唯一持久化点会立刻把草稿里已有的 `imageId` **删掉**
     * （`withSourceImage(p, null)` 是删键 —— W4 §8.2 与 V-W4 §7②）。
     */
    const initialProjectRef = useRef(null);
    /**
     * B12（KI-042）：旧草稿 / 导入 JSON 里可能带着 `settings.showActiveLayerOnly === true`
     * （B6 之前的「只看当前图层」solo）。界面已改成单层 ⇒ 该位**不再影响任何可见格子**
     * （B6 删掉恒等的 `displayProject` memo 时就是这么设计的），但此前是**静默**失效。
     * 这里显式处理，**不动数据模型**（`types.ts` / `project.ts` / `normalizeProject` 一字未改）：
     *   · 命中 ⇒ 一次性提示（落点 = 既有 `.error-banner`，文案 = i18n `retiredLayerVisibilityNotice`）；
     *   · 并在**内存里**把这一位清成 false。草稿的唯一持久化点随后会把 false 写回草稿 ⇒
     *     下次启动不再提示，这正是"一次性"。
     */
    const initialSoloIgnoredRef = useRef(false);
    if (initialProjectRef.current === null) {
        const loaded = loadDraft() ?? createProject();
        initialSoloIgnoredRef.current = loaded.settings?.showActiveLayerOnly === true;
        initialProjectRef.current = initialSoloIgnoredRef.current
            ? { ...loaded, settings: { ...loaded.settings, showActiveLayerOnly: false } }
            : loaded;
    }
    const [project, setProject] = useState(initialProjectRef.current);
    const [sourceImageRef, setSourceImageRef] = useState(() => getSourceImageRef(initialProjectRef.current));
    const [selectedColorId, setSelectedColorId] = useState(defaultColorId);
    const [recentColorIds, setRecentColorIds] = useState(defaultRecentColorIds);
    const [tool, setTool] = useState('pencil');
    const [eraserSize, setEraserSize] = useState(0);
    /** 橡皮范围：'brush' = 现有笔刷；其余三档 = 整片删除（原「消除」工具，2026-09-20 合并进来）。 */
    const [eraserScope, setEraserScope] = useState('brush');
    const [moveMode, setMoveMode] = useState('layer');
    const [mirrorMode, setMirrorMode] = useState('layer');
    const [mirrorDirection, setMirrorDirection] = useState('horizontal');
    const [shapeKind, setShapeKind] = useState('line');
    const [shapeFillMode, setShapeFillMode] = useState('outline');
    const [arrowKind, setArrowKind] = useState('single');
    const [textToolValue, setTextToolValue] = useState('ABC');
    const [textToolDirection, setTextToolDirection] = useState('horizontal');
    const [textToolSize, setTextToolSize] = useState(17);
    const [textToolSpacing, setTextToolSpacing] = useState(1);
    const [showPrintExportPanel, setShowPrintExportPanel] = useState(false);
    const [printExportOptions, setPrintExportOptions] = useState({
        format: 'png',
        exportBounds: 'pattern',
        showColorCodes: true,
        showGuideLines: true,
        projectName: '',
        authorName: '',
    });
    const [showPencilOptions, setShowPencilOptions] = useState(false);
    const [showEraserOptions, setShowEraserOptions] = useState(false);
    const [showMoveOptions, setShowMoveOptions] = useState(false);
    const [showMirrorOptions, setShowMirrorOptions] = useState(false);
    const [showShapeOptions, setShowShapeOptions] = useState(false);
    const [showTextOptions, setShowTextOptions] = useState(false);
    const [showClipboardOptions, setShowClipboardOptions] = useState(false);
    const [clipboardPattern, setClipboardPattern] = useState(null);
    const [copyMode, setCopyMode] = useState('connected');
    /**
     * 「复制」工具的两个相位（见 `types.ts` 的 `ClipboardPhase`）。
     *
     * ⚠️ **必须是状态**：剪贴板里有内容时，用户仍要能"重新选一块" —— 从 `clipboardPattern` 派生不出来。
     * 与合并前的行为一一对应：`'copy'` = 旧的 `copy` 工具，`'paste'` = 旧的 `paste` 工具。
     */
    const [clipboardPhase, setClipboardPhase] = useState('copy');
    const [copySelectionIndices, setCopySelectionIndices] = useState([]);
    const [pendingFile, setPendingFile] = useState(null);
    const [pendingImageUrl, setPendingImageUrl] = useState(null);
    // ——— W6 接线（W4 §8.4）：源图持久化的状态与 ref ———
    /** 启动时正在从 IndexedDB 读回上次的源图（加载窗口期不能让卡片显示"未选择图片"）。 */
    const [sourceImageLoading, setSourceImageLoading] = useState(true);
    /** `unknown` = 还没探过；`persistent` = 已落库；`memory` = 只在内存（刷新会丢，必须常驻告知）。 */
    const [persistMode, setPersistMode] = useState('unknown');
    /** 降级解释的**常驻**落点（浮条会被出图状态顶掉，实测可见窗口只有 ~400ms ⇒ 光弹浮条不算告知）。 */
    const [persistNotice, setPersistNotice] = useState(null);
    /** 只在上传换图时 +1：让"重新上传同一张图"照样触发重算（只比参数签名会漏掉这种情况）。 */
    const sourceTokenRef = useRef(0);
    const autoGenerateSignatureRef = useRef(null);
    /** 从 IndexedDB 恢复出来的那个 `File` 对象；用来识别"第一轮不该重算"。 */
    const restoredFileRef = useRef(null);
    /** 恢复途中用户自己传了图 ⇒ 恢复结果作废（竞态护栏）。 */
    const userUploadedRef = useRef(false);
    // AI 重绘：API Key + 是否正在生成
    const [aiApiKey, setAiApiKey] = useState(() => localStorage.getItem('ark-api-key') ?? '');
    // 模型 ID：不同账号开通的模型可能不一样，粘贴 Key 后程序会自动识别并填好
    const [aiModel, setAiModel] = useState(() => localStorage.getItem('ark-model') ?? DEFAULT_AI_MODEL);
    // 模型设置默认收起，需要时点开
    const [aiModelOpen, setAiModelOpen] = useState(false);
    // 自动识别模型：状态 + 「当前这个模型 ID 是不是自动识别填进去的」
    const [arkDetect, setArkDetect] = useState({ phase: 'idle' });
    const [aiModelAuto, setAiModelAuto] = useState(false);
    const [aiRedrawing, setAiRedrawing] = useState(false);
    // AI 结果缩略图（data URL，直接给 <img> 用，省掉 blob 回收的麻烦）
    const [aiResultUrl, setAiResultUrl] = useState(null);
    /**
     * 「图源历史」：第 0 条永远是上传的原图，之后每点一次「生成 AI 图」追加一条。
     * 有了它就不需要「勾选 AI」这种模式开关 —— 当前用哪张图，就是历史里选中的那条。
     */
    const [aiHistory, setAiHistory] = useState([]);
    const [aiHistoryIndex, setAiHistoryIndex] = useState(-1); // 当前选中的历史下标，-1 = 未选
    // 当前 AI 结果是哪张素材生成的（换素材后要重置，避免拿旧图的 AI 结果）
    const [aiResultSourceFile, setAiResultSourceFile] = useState(null);
    // 图纸生成之后是否被手动绘制修改过（用于自动刷新前决定要不要弹提示）
    const [patternHandEdited, setPatternHandEdited] = useState(false);
    const [referenceFile, setReferenceFile] = useState(null);
    const [referenceImageUrl, setReferenceImageUrl] = useState(null);
    const [referenceVisible, setReferenceVisible] = useState(false);
    const [referenceOpacity, setReferenceOpacity] = useState(0.35);
    const [referenceScale, setReferenceScale] = useState(1);
    const [referenceOffset, setReferenceOffset] = useState({ x: 0, y: 0 });
    const [referenceAdjusting, setReferenceAdjusting] = useState(false);
    const [referencePlacement, setReferencePlacement] = useState('below');
    const [canvasWidth, setCanvasWidth] = useState(project.width);
    const [canvasHeight, setCanvasHeight] = useState(project.height);
    const [convertWidth, setConvertWidth] = useState(defaultImportSettings.width);
    // 宽度输入框的原始文本。不能直接用 number 绑：删空时 Number('') 会变成 0，
    // 导致输入框里永远留个 0、再输入就变成 "0xx"。允许临时为空，失焦/合法时才夹到范围内。
    const [widthInput, setWidthInput] = useState(String(defaultImportSettings.width));
    const [maxColors, setMaxColors] = useState(defaultImportSettings.maxColors);
    const [generationStyle, setGenerationStyle] = useState(defaultImportSettings.generationStyle);
    const [backgroundMode, setBackgroundMode] = useState(defaultImportSettings.backgroundMode);
    const [tolerance, setTolerance] = useState(defaultImportSettings.tolerance);
    // 用户是否手动拖过容差滑条。注意：这个标记只对「当前这张素材」有效 ——
    // 换新图时会重置，因为每张图合适的容差不一样，必须按新图重新自动计算。
    const [toleranceManual, setToleranceManual] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    // B12（KI-042）：从草稿恢复时命中了已停用的可见性设置 ⇒ 初始就把它顶成提示（见 initialSoloIgnoredRef）。
    const [notice, setNotice] = useState(initialSoloIgnoredRef.current ? text.retiredLayerVisibilityNotice : text.workspaceReady);
    // 当前提示是不是「失败」。失败时状态栏变红，避免像以前那样悄无声息
    const [noticeIsError, setNoticeIsError] = useState(initialSoloIgnoredRef.current);
    const [floatingHelp, setFloatingHelp] = useState(null);
    const [hoverCell, setHoverCell] = useState(null);
    const [highlightedColorId, setHighlightedColorId] = useState(null);
    const [showIsolatedBeads, setShowIsolatedBeads] = useState(false);
    const [rightTab, setRightTab] = useState('palette');
    /**
     * 面板（抽屉）开合 + 左抽屉的分区。**第 3 批从 `WorkspaceCanvas` 提升到这里**：
     * 打开入口现在是工具条上的 3 个面板条目（`.tool-rail` 在 `App` 里），
     * 而"抽屉外一切 inert"的 effect 需要同时看见顶栏、工具条与两个抽屉 —— 只有 `App` 能。
     */
    const [openPanel, setOpenPanel] = useState(null);
    const [leftSection, setLeftSection] = useState('material');
    /**
     * B9（用户第 8 条，**分段第一步：只做入口**）：画布右上角那个「当前色圆点」是否展开 = 是否已把
     * 右抽屉切到「调色盘」。**只在抽屉档**真正渲染（`WorkspaceCanvas` 里由 `panelLayout` 把关），
     * 桌面档一个节点都不渲染 ⇒ 桌面 DOM/几何/像素 Δ=0（门禁里有反向断言）。
     *
     * 与 `openPanel` 不冗余：`openPanel` 还管左抽屉，「圆点已打开」只是它的一个子状态，
     * 这条 state 专门用来把「点圆点再点一次 = 收起」写清楚（`openPanel` 单独一个量表达不了
     * "是哪一次打开"）。
     */
    const [paletteDotOpen, setPaletteDotOpen] = useState(false);
    /** 面板布局断点（窄屏 / 触屏）：命中时面板入口才渲染、抽屉才是覆盖式的。 */
    const panelLayout = useMediaQuery(PANEL_LAYOUT_QUERY);
    const shellRef = useRef(null);
    const railRef = useRef(null);
    /**
     * 工具浮层的**专用覆盖层**（`.app-shell` 的网格子项，盖在画布之上、抽屉/遮罩之下）。
     * 8 个 `.tool-options` 全部挂在这里，**不再住在 `.tool-rail` 里**
     * —— 那里 `overflow-x: hidden` 会把浮层整块裁掉（见文件上方那段说明）。
     */
    const toolOptionsLayerRef = useRef(null);
    const placeToolOptionsRef = useRef(() => undefined);
    /**
     * 触屏上"上一次 pointerdown 激活的是哪个工具、什么时候"——用来丢掉浏览器随后补发的那个 click。
     * 见工具按钮 `onPointerDown` 处的说明（不这样做，「文字」浮层在触屏上会被成对触发、打不开）。
     * 用 800ms 时间窗而不是"记住 pointerType"：混合设备上"刚用触摸屏、再用键盘 Tab/Enter"
     * 的 click 不会被误吞。
     */
    const touchActivationRef = useRef(null);
    const [paletteMode, setPaletteMode] = useState('basic');
    const [paletteGroup, setPaletteGroup] = useState('all');
    // W6：`lastBrandPlan` 状态已删除（用户裁决【2】：品牌撤销并入全局撤销/重做，
    // 不再有独立的「↩︎ 撤销换品牌」按钮，也不再需要把 plan 留到下一次渲染）。
    const [adjustments, setAdjustments] = useState(defaultAdjustments);
    const [colorCleanupStrength, setColorCleanupStrength] = useState(2);
    const [layerColorLimit, setLayerColorLimit] = useState(16);
    const [past, setPast] = useState([]);
    const [future, setFuture] = useState([]);
    /**
     * B10 ②（用户第 15 轮裁决）：**「221 / 291」视图档也要随撤销/重做回退**。
     *
     * ── 病根（B7 残留 ②，独立复核量化过）────────────────────────────────────────────
     * `paletteMode` 是 UI 局部 state，**不随 `project` 历史快照走** ⇒ 撤销之后图纸颜色
     * 回到了切换前、而那个下拉框仍停在切换后的值，两者自相矛盾。
     *
     * ── 为什么是在 `App.tsx` 里加一条平行栈（根修，不是补丁）──────────────────────────
     * 红线冻结了 `project.ts` 等 12 个纯逻辑文件 ⇒ **不能**把视图档塞进 `BeadProject`
     * （那本来也是最干净的做法：视图档属于"那一刻的编辑器状态"）。所以维护一条
     * **与 `past`/`future` 一一对应**的平行栈，压/弹的时机与 `commitHistory()`/`undo()`/`redo()`
     * 完全同构 —— 长度永远相等，不存在"两个栈各自漂移"的可能。
     *
     * ── 语义（这一条与派工书那句话的差别，必须写明）────────────────────────────────
     * 派工书写的是"每次 commitHistory() 时把**当前** paletteMode 一起压栈"。**直接那样做会
     * 在用户点名的真事件序列上失效**：`basic → 切 complete → 换品牌 → 撤销` 时，提交那一刻
     * 的"当前档"已经是 `complete` ⇒ 弹回来还是 `complete`，**下拉框一动不动**，
     * 与用户要的"回到 basic(221)"正好相反。
     * ⇒ 正确的口径是：**视图档随它所属的那一帧走**。
     *   `pastModes[i]` = 撤销到 `past[i]` 时应还原的档位 = `past[i]` 这一帧**成为 present 时**的档位。
     *   实现上：`commitHistory()` 把 `presentPaletteModeRef.current`（**即将退位的那一帧的档位**）
     *   压进 `pastModes`，然后把当前 `paletteMode` 记为**新 present 帧**的档位。
     *   ⚠️ 于是"改视图档"这件事**本身不产生历史**（`BrandSelect` 直接调 `setPaletteMode`，
     *      从不碰 `commitHistory()`）；但下一次撤销会把这个未提交的视图改变**一并回退**
     *      —— 这正是用户要的"撤销回到切换前"。
     *
     * ── 逐帧演算（就是门禁里那条真事件）────────────────────────────────────────────
     *   ① 初始：present = (P0, basic)                      ref='basic'
     *   ② 切到 complete：paletteMode='complete'，ref 仍是 'basic'（P0 这帧没变）
     *   ③ 换品牌：commitHistory 压 pastModes += 'basic'，ref := 'complete'，project := P1
     *   ④ 撤销：弹 'basic' ⇒ 下拉回 basic、图纸回 P0；futureModes += 'complete'
     *   ⑤ 重做：弹 'complete' ⇒ 下拉回 complete、图纸回 P1
     */
    const [pastModes, setPastModes] = useState([]);
    const [futureModes, setFutureModes] = useState([]);
    /** 当前 present 帧（= `project`）所属的视图档。见上面那段"逐帧演算"。 */
    const presentPaletteModeRef = useRef(paletteMode);
    const usage = useMemo(() => summarizeUsage(project), [project]);
    /**
     * 改色会话（2026-09-20 第 2 批「换色融合」）：**一处状态，两个挂载点**。
     * 右抽屉的「用量 → 改色」与「换色」工具浮层共享它 ⇒ 源色 / 起点 / 已挑的目标色永远一致。
     * 见 `./useRecolorSession` 的文件头（含"目标色两个默认值为何刻意分开"）。
     */
    const recolor = useRecolorSession(project, usage);
    /**
     * 当前是不是手机（**断点只有一处定义**：`./useMediaQuery` 的 `PHONE_QUERY`）。
     * 只用来决定「换色」工具浮层渲染**精简形态**还是完整形态 —— 完整编辑器在手机上高约 470px，
     * 会把画布挤没（用户裁决 B5）。⚠️ 必须**无条件**调用（钩子不能放进 if / &&）。
     */
    const isPhoneViewport = useMediaQuery(PHONE_QUERY);
    const totalBeads = usage.reduce((sum, row) => sum + row.count, 0);
    const totalPacks = usage.reduce((sum, row) => sum + row.packs, 0);
    const boardCount = Math.ceil(project.width / project.boardSettings.boardWidth) *
        Math.ceil(project.height / project.boardSettings.boardHeight);
    const isolatedBeadRefs = useMemo(() => findIsolatedBeads(project), [project]);
    const isolatedBeads = isolatedBeadRefs.length;
    const isolatedCellIndices = useMemo(() => (showIsolatedBeads ? [...new Set(isolatedBeadRefs.map((item) => item.index))] : []), [isolatedBeadRefs, showIsolatedBeads]);
    const selectedColor = getColor(selectedColorId);
    // KI-012：两档色板都必须按**当前品牌**取，不能写死 MARD 的 basicPalette/completePalette
    // （否则切到 Artkal 后参数面板/调色盘/用量表拿到的仍是 MARD 色名，自相矛盾）。
    // `paletteMode` 的 basic/complete 语义原样保留，只是色板来源换成当前品牌。
    const activePalette = paletteMode === 'basic'
        ? paletteForBrand(project.activeBrand)
        : completePaletteForBrand(project.activeBrand);
    const recentColors = recentColorIds.flatMap((id) => {
        const color = activePalette.find((item) => item.id === id);
        return color ? [color] : [];
    });
    const paletteGroups = useMemo(() => [
        { id: 'all', label: 'All' },
        ...[...new Set(activePalette.map((color) => color.group))].map((group) => ({ id: group, label: group })),
    ], [activePalette]);
    const visiblePalette = useMemo(() => (paletteGroup === 'all' ? activePalette : activePalette.filter((color) => color.group === paletteGroup)), [activePalette, paletteGroup]);
    /**
     * （W6 已删除）KI-007 的旧判据 `importParamsAtDefault` / `sourceImageMissing`。
     * 那是"源图只活在内存"时代的**临时缓解**：刷新后没有源图 ⇒ 改参数静默无效，只能靠一条常驻提示兜底。
     * 现在源图会从 IndexedDB 恢复（R5 根修）⇒ 刷新后改参数会**真的重算**，提示与「重新上传」按钮都不再需要。
     */
    function displayCode(color) {
        return color.primaryCode;
    }
    /**
     * B9：圆点的**无障碍名 / title**。当前色理论上恒有（`defaultColorId = 'mard-h7'`），
     * 但 `getColor()` 的返回类型是可选 ⇒ 这里显式兜一个占位，不让 `undefined` 变成字符串
     * `"undefined"` 出现在 aria-label 里。
     */
    const paletteDotLabel = text.paletteDotAria(selectedColor ? displayCode(selectedColor) : '—');
    /**
     * B10（用户第 8 条第二步）：「色号品牌与版本」那个合并下拉框（`BrandSelect`，**含 CC BY 署名折叠块**）。
     *
     * 它原来只挂在右栏「调色盘」tab 里（B7 起）。这一步色盘本体搬去画布浮层之后，
     * 抽屉档的右抽屉只剩「用量」⇒ 这个控件**必须有个新家**，按用户裁决并进左抽屉
     * `material` 分区那张 `.params-card`（**只并入，不新造第三处**）。
     * 两条挂载**按档位互斥**，同一时刻 DOM 里只有一个：
     *   · 桌面档（`panelLayout === false`）⇒ 由 `RightPanel` 的「调色盘」tab 渲染（DOM 逐字不变）；
     *   · 抽屉档（`panelLayout === true`） ⇒ 由下面 `.params-card` 里那个
     *     `.params-brand-slot` 渲染。
     * ⚠️ 声明放在 `return` 之前：`.params-card` 的 JSX 在 `RightPanel` 之前，必须先用后传。
     * ⚠️ CC BY 署名是**许可证义务**：它就在 `BrandSelect` 的 `details.brand-source-details` 里，
     *    搬家只会让它换个抽屉，内容/可展开/链接可点三条都不变（门禁硬断言展开可见）。
     */
    const brandSelect = (React.createElement(BrandSelect, { activeBrand: project.activeBrand, layers: project.layers, onApply: applyBrandSwitch, language: language, 
        // B7（用户第 5 条）：品牌与版本合成**一个**下拉框 ⇒
        // `paletteMode` 的两个出口从 `RightPanel` 挪到这里，不再经过中间那层透传。
        paletteMode: paletteMode, onPaletteModeChange: setPaletteMode }));
    function displayName(color) {
        return color.name;
    }
    function showFloatingHelp(anchor, tooltip) {
        const rect = anchor.getBoundingClientRect();
        const tooltipWidth = 172;
        const left = Math.min(rect.right + 8, window.innerWidth - tooltipWidth - 10);
        setFloatingHelp({
            text: tooltip,
            left,
            top: rect.top + rect.height / 2,
        });
    }
    function imageHelpProps(tooltip) {
        return {
            'data-tooltip': tooltip,
            'aria-label': tooltip,
            tabIndex: 0,
            onMouseEnter: (event) => showFloatingHelp(event.currentTarget, tooltip),
            onMouseLeave: () => setFloatingHelp(null),
            onFocus: (event) => showFloatingHelp(event.currentTarget, tooltip),
            onBlur: () => setFloatingHelp(null),
        };
    }
    function displayCodeById(colorId) {
        const color = getColor(colorId);
        return color ? displayCode(color) : '';
    }
    useEffect(() => {
        // W6 接线（W4 §8.3）：这是草稿的**唯一**持久化点，源图关联在这里合并。
        // 合并而不是"存图成功后 setProject(withSourceImage(...))"：`generateFromImage()` 会在开头
        // 抓 `sourceProject` 快照、结束整份写回，后者写进去的关联会在约 400ms 后被冲成 null
        // （V-W4 §7① 实测 403ms、`logs/c9_atime_5475_E1naive.json`）。
        saveDraft(withSourceImage(project, sourceImageRef));
    }, [project, sourceImageRef]);
    useEffect(() => {
        localStorage.setItem(languageKey, language);
    }, [language]);
    /**
     * B36：**打开页面就开始后台加载主体分割模型**（用户口径：一次可能传多张图，第一张不是人像、后面可能是，
     * 所以不等到判定再加载）。
     *
     * 三条性质：
     * - **不阻塞**：`void` 掉，首屏与上传、出图都不等它；
     * - **失败无所谓**：`ensureSegmenter()` 内部吞掉所有异常并返回 `null`，出图会原样走老算法；
     * - **只在挂载时跑一次**：模块内部用同一个 Promise 做幂等，重复调用不会再下载。
     */
    useEffect(() => {
        void ensureSegmenter();
    }, []);
    /**
     * W6 接线（W4 §8.5）：启动时从 IndexedDB 恢复上次的源图 —— 这是 KI-007 的**根修**。
     *
     * 顺序固定：先 `probeSourceImage`（只读 meta，很快）→ 有才 `loadSourceImage`（含解码校验）。
     * 三条分支都要给用户明确告知，不许静默：
     *   · 探到且读回成功 ⇒ `persistMode='persistent'`，把 `File` 塞回 `pendingFile`；
     *   · `not-found` 而草稿里**记着**关联 ⇒ 一次性告知 `SOURCE_IMAGE_LOST_NOTICE`（曾有、现在没了）；
     *   · 探不到/报错（隐私模式、配额、大图）⇒ `persistMode='memory'` + **常驻** `persistNotice`。
     * `userUploadedRef` 是竞态护栏：恢复途中用户自己传了图，恢复结果直接作废（别覆盖用户的选择）。
     */
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const mountLanguage = localStorage.getItem(languageKey) === 'en' ? 'en' : 'zh';
            const expected = getSourceImageRef(project); // 挂载时的草稿关联（✅ 就是我们要的那份）
            try {
                const probe = await probeSourceImage({ language: mountLanguage });
                if (cancelled)
                    return;
                if (probe.present) {
                    const loaded = await loadSourceImage({
                        language: mountLanguage,
                        expectedImageId: expected?.imageId ?? null,
                    });
                    if (cancelled || userUploadedRef.current)
                        return;
                    if (loaded.found && loaded.image) {
                        const file = loaded.image.file;
                        restoredFileRef.current = file; // ← 见自动重算 effect 的"抑制第一轮"
                        setPendingFile(file);
                        setPendingImageUrl((current) => {
                            if (current)
                                URL.revokeObjectURL(current);
                            return URL.createObjectURL(file);
                        });
                        // 图源历史第 0 条 = 原图（与上传路径保持一致）
                        setAiHistory([{ file, url: URL.createObjectURL(file), bg: 'keep', isOriginal: true }]);
                        setAiHistoryIndex(0);
                        setPatternHandEdited(false);
                        setPersistMode('persistent');
                        setPersistNotice(null);
                        if (!expected)
                            setSourceImageRef(sourceImageRefFromStored(loaded.image)); // 老草稿：补上关联
                    }
                    else if (loaded.notice) {
                        setNoticeIsError(true);
                        setNotice(loaded.notice);
                    }
                }
                else if (probe.code === 'not-found') {
                    if (expected) {
                        setNoticeIsError(true);
                        setNotice(SOURCE_IMAGE_LOST_NOTICE[mountLanguage]);
                    }
                }
                else if (probe.notice) {
                    setPersistMode('memory');
                    setPersistNotice(probe.notice);
                    if (expected) {
                        setNoticeIsError(true);
                        setNotice(probe.notice);
                    }
                }
            }
            finally {
                if (!cancelled)
                    setSourceImageLoading(false);
            }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    useEffect(() => {
        return () => {
            if (pendingImageUrl)
                URL.revokeObjectURL(pendingImageUrl);
        };
    }, [pendingImageUrl]);
    useEffect(() => {
        return () => {
            if (referenceImageUrl)
                URL.revokeObjectURL(referenceImageUrl);
        };
    }, [referenceImageUrl]);
    /**
     * 自动识别「这个账号开通了哪个模型」：
     * 粘贴完 Key（看起来完整）后 debounce 900ms 打一轮**零费用探针**（size 固定 1x1，
     * 方舟在参数校验阶段就拒绝，不生成图片、不扣费），命中第一个可用的就停下并自动填好模型。
     * 手动「重新识别」也是走这里。
     */
    async function runArkDetect(keyInput) {
        const key = keyInput.trim();
        if (!looksLikeArkKey(key))
            return;
        setArkDetect((current) => (current.phase === 'running' ? current : { phase: 'running' }));
        const result = await detectActivatedModel(key);
        setArkDetect({ phase: 'done', key, result });
        if (result.kind === 'found') {
            setAiModel(result.modelId);
            setAiModelAuto(true);
            localStorage.setItem('ark-model', result.modelId);
        }
    }
    useEffect(() => {
        // 这里**故意**不依赖 language / aiModel：换语言和自动填模型都不该重新打探针
        if (!looksLikeArkKey(aiApiKey)) {
            setArkDetect((current) => (current.phase === 'idle' ? current : { phase: 'idle' }));
            return;
        }
        const key = aiApiKey.trim();
        // 同一把 Key 已经识别过就不再重复（手动「重新识别」会显式再跑一次）
        if (arkDetect.phase === 'done' && arkDetect.key === key
            || arkDetect.phase === 'running')
            return;
        const timer = window.setTimeout(() => { void runArkDetect(key); }, 900);
        return () => window.clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [aiApiKey]);
    useEffect(() => {
        setCanvasWidth(project.width);
        setCanvasHeight(project.height);
    }, [project.width, project.height]);
    useEffect(() => {
        setNotice((current) => {
            if (current === ui.zh.workspaceReady || current === ui.en.workspaceReady)
                return text.workspaceReady;
            const zhGenerated = current.match(/^(\d+) 色 - (\d+) 颗 - 可编辑图案已生成。$/);
            if (zhGenerated)
                return `${zhGenerated[1]} colors - ${zhGenerated[2]} beads - editable pattern ready.`;
            const enGenerated = current.match(/^(\d+) colors - (\d+) beads - editable pattern ready\.$/);
            if (enGenerated)
                return `${enGenerated[1]} 色 - ${enGenerated[2]} 颗 - 可编辑图案已生成。`;
            return current;
        });
    }, [language, text.workspaceReady]);
    useEffect(() => {
        if (!activePalette.some((color) => color.id === selectedColorId)) {
            setSelectedColorId(activePalette[0].id);
        }
        if (!paletteGroups.some((group) => group.id === paletteGroup)) {
            setPaletteGroup('all');
        }
    }, [activePalette, paletteGroups, paletteGroup, selectedColorId]);
    useEffect(() => {
        function onPaste(event) {
            const file = [...(event.clipboardData?.files ?? [])].find((item) => item.type.startsWith('image/'));
            if (file)
                handleImageFile(file);
        }
        window.addEventListener('paste', onPaste);
        return () => window.removeEventListener('paste', onPaste);
    }, []);
    useEffect(() => {
        if (!pendingFile) {
            autoGenerateSignatureRef.current = null;
            return;
        }
        /**
         * W6 接线（W4 §8.6）：这个 effect 只要依赖变化就会算一次，而恢复源图会改 `pendingFile`
         * ⇒ 不抑制的话，刷新时会把从 localStorage 恢复的图纸（**含手画格子**）立刻覆盖掉
         * （V-W4 §7③ 实测去掉抑制后 changed=10/2704、手画 3 格全变 null）。
         *
         * 判据 = "参数签名 + 只在上传时 +1 的 sourceTokenRef"：
         *   · `previous === null && restoredFileRef.current === pendingFile` ⇒ 这一轮是"刚恢复出来的
         *     源图"，图纸已经在了，**直接 return**（不重算）；
         *   · `previous !== null && previous === signature` ⇒ 图源与参数都没变，**不重算**；
         *   · 其余（换图 / 改参数）照旧 420ms 防抖重算。
         * `sourceTokenRef` 让"重新上传同一张图"照样重算 —— 只比参数签名会漏掉这种情况。
         */
        const signature = [
            sourceTokenRef.current, convertWidth, maxColors, generationStyle, backgroundMode,
            tolerance, paletteMode, aiHistoryIndex, aiHistory.length, toleranceManual,
        ].join('|');
        const previous = autoGenerateSignatureRef.current;
        autoGenerateSignatureRef.current = signature;
        if (previous === null && restoredFileRef.current === pendingFile) {
            restoredFileRef.current = null; // 恢复来的源图：第一轮不重算（图纸已经在了）
            return;
        }
        if (previous !== null && previous === signature)
            return; // 图源与参数都没变 ⇒ 不重算
        // automatic 的调用永远走本地出图纸（免费），不会偷偷调 AI。
        const timer = window.setTimeout(() => {
            const shouldCommit = autoGenerateShouldCommitRef.current;
            autoGenerateShouldCommitRef.current = false;
            void generateFromImage({ recordHistory: shouldCommit, automatic: true });
        }, 420);
        return () => window.clearTimeout(timer);
    }, [pendingFile, convertWidth, maxColors, generationStyle, backgroundMode, tolerance, paletteMode, aiHistoryIndex, aiHistory.length, toleranceManual]);
    function commitHistory() {
        setPast((items) => [...items.slice(-39), project]);
        /*
          B10 ②：视图档与 `past` **同步压栈**（两条栈的长度永远相等，见 `pastModes` 的说明）。
          压进去的是**即将成为过去的那一帧**的档位（`presentPaletteModeRef.current`），
          然后把"当前 paletteMode"记为**新的 present 帧**的档位 —— 于是"改了档位但还没提交"
          这件事会在下一次撤销时被一并回退，正是用户要的"撤销回到切换前"。
          裁剪口径与 `past` 逐字一致（`slice(-39)` + 1 = 上限 40 帧）。
    
          🔴 `outgoingMode` **必须先取出来存成局部量**：React 的 `setState(updater)` 里那个
             updater 是**懒执行**的（真正跑在 render 阶段）。若直接在里面读 ref，
             等它执行时 `presentPaletteModeRef.current` **已经被下一行改成了新的档位** ——
             压进去的就成了"切换后"的档位，撤销弹回来等于没变。
             （第一版就是这么写的，被门禁 F4 实测抓到：撤销后下拉仍停在 complete。）
        */
        const outgoingMode = presentPaletteModeRef.current;
        setPastModes((items) => [...items.slice(-39), outgoingMode]);
        presentPaletteModeRef.current = paletteMode;
        setFuture([]);
        setFutureModes([]);
        // 只有「图纸已存在时的操作」才算手动修改。
        // 生成图纸本身也会调用 commitHistory（recordHistory），此时 isGenerating 为真，要排除。
        if (!isGenerating && project.cells.some((cell) => cell !== null)) {
            setPatternHandEdited(true);
        }
    }
    function updateProject(next) {
        setProject({ ...next, updatedAt: new Date().toISOString() });
    }
    function selectColor(colorId, options = {}) {
        setSelectedColorId(colorId);
        // B9 关闭路径①（用户裁决「选中即关」）：**这里是全仓唯一的选色入口**（调色盘 swatch、
        // 最近使用、画布拾色 `onPickColor`、用量面板改色都走它）⇒ 在这一处关一次就够，
        // 不需要在色盘内部到处挂 onClick（那才是补丁）。圆点没展开时这次调用是空操作。
        setPaletteDotOpen(false);
        if (options.updateRecent === false)
            return;
        setRecentColorIds((current) => [colorId, ...current.filter((id) => id !== colorId)].slice(0, 7));
    }
    /**
     * 激活工具。**工具条上每一次点击都必须经过这里**（键盘不切工具，所以这里是唯一入口）。
     *
     * 「复制」是双态按钮，相位规则（与合并前的两格行为一一对应）：
     * - 已经在这一格、且当前是「粘贴」⇒ 点一下 = **重新选一块**（回到 `'copy'`）；
     * - 其它情况 ⇒ 有剪贴板内容就进 `'paste'`，否则 `'copy'`。
     * 合并前"点「复制」"就是这两种语义，只是当时分散在两个格子上。
     */
    function activateTool(nextTool) {
        const closingTextOptions = nextTool === 'text' && tool === 'text' && showTextOptions;
        // B10：色盘浮层与工具浮层**互斥**（同一个覆盖层、同一片画布）。
        // 反过来那一路（点圆点 ⇒ `closeAllToolOptions()`）在 `onPaletteDotClick` 里。
        setPaletteDotOpen(false);
        /*
         * B15（用户第 8b 条）：**点画笔/橡皮这类"工具"时，已打开的抽屉要收起来。**
         * 用户的原话是「素材/参考/颜色 与 画笔/橡皮 属于同一层级」——同一层级的入口应当互斥：
         * 抽屉开着时又点一个画布工具，说明用户已经切到"画"这件事上了，抽屉该让位。
         * （反方向"开抽屉 ⇒ 收工具浮层"由面板条目自己的 onClick 调 `closeAllToolOptions()` 负责。）
         * ⚠️ 只在**抽屉档**有意义：桌面档 `openPanel` 恒为 `null`，这行是空操作 ⇒ 桌面 Δ=0。
         */
        setOpenPanel(null);
        setTool(nextTool);
        /*
         * B15（用户第 6 条）：**抽屉档（iPad）不再弹「画笔」浮层**。
         * 这个浮层里**只有一行「右键 平移 / 擦除」**（`styles.css` / 本文件 2982 行那一段），
         * 而"右键"只可能来自鼠标（`WorkspaceCanvas` 判的是 `event.button === 2`，触摸永远不是 2）
         * ⇒ 在 iPad 上它是**一行点了没有任何作用的死控件**，还顺带把"右键"这个词摆给用户看。
         * 桌面档照旧（`panelLayout` 为假时条件成立）⇒ 桌面行为一字不变。
         */
        setShowPencilOptions(nextTool === 'pencil' && !panelLayout);
        setShowEraserOptions(nextTool === 'eraser');
        setShowMoveOptions(nextTool === 'move');
        setShowMirrorOptions(nextTool === 'mirror');
        setShowShapeOptions(nextTool === 'shape');
        setShowTextOptions(nextTool === 'text' && !closingTextOptions);
        setShowClipboardOptions(nextTool === 'clipboard');
        // B19：`recolor` 不再有工具浮层（见下方浮层区顶部的注释）。
        if (nextTool === 'clipboard') {
            setClipboardPhase((current) => tool === 'clipboard' && current === 'paste' ? 'copy' : clipboardPattern ? 'paste' : 'copy');
        }
    }
    /** 工具条按钮的显示名 / 无障碍名。只有「复制」是双态，需要看相位。 */
    function toolLabel(id) {
        if (id === 'clipboard' && clipboardPhase === 'paste')
            return text.tools.clipboard.titleWhenPaste;
        return text.tools[id].title;
    }
    /**
     * 把**所有**工具浮层收起来（8 个开合状态一个不落）。
     *
     * 为什么值得抽成一个函数：这份清单原来在 `onPickColor`（画布吸管）里手抄过一遍，
     * 第 3 批又要用一次（点面板条目打开抽屉时）。**抄两遍必然漏**——漏掉的那个浮层会留在屏幕上，
     * 而它在手机档的 `z-index` 是 46、比抽屉（41）还高 ⇒ 会**压在抽屉上面**（实测可见）。
     */
    function closeAllToolOptions() {
        setShowPencilOptions(false);
        setShowEraserOptions(false);
        setShowMoveOptions(false);
        setShowMirrorOptions(false);
        setShowShapeOptions(false);
        setShowTextOptions(false);
        setShowClipboardOptions(false);
    }
    /**
     * 有没有任何一个工具浮层处于"打开"状态 —— 决定**覆盖层要不要挂载**。
     *
     * 为什么按需挂载而不是常驻一个空层：桌面档（浮层一律不打开时）的 DOM 与改动前
     * **一个节点都不差**，A/B 的"元素数 / class 直方图"因此能逐项相同（见交付报告的 A/B 数字）。
     */
    const anyToolOptionsOpen = showPencilOptions || showEraserOptions || showMoveOptions
        || showMirrorOptions || showShapeOptions || showTextOptions
        || showClipboardOptions;
    // ————————————— B9（用户第 8 条）圆点入口：DOM 引用 + 打开/关闭出口 —————————————
    /** 圆点按钮本体（关闭路径② 用 `composedPath()` 判"点的是不是它自己"）。 */
    const paletteDotRef = useRef(null);
    /**
     * B10（用户第 8 条**第二步**）：色盘浮层本体。
     * 同样被关闭路径②用 `composedPath()` 判"点的是不是浮层里面"
     * —— 少了这一条，**点浮层里的分组筛选就会把浮层自己关掉**（那才是最容易被漏掉的回归）。
     */
    const palettePopoverRef = useRef(null);
    /**
     * 圆点入口的**唯一出口**（`WorkspaceCanvas` 里那个按钮的 onClick）。
     * 再点一次 = 收起（与工具条上「颜色」面板条目同一个"点哪个出哪个"口径）。
     *
     * ⚠️ B10 改掉了它的后半段：**不再打开右抽屉、也不再把右栏切到「调色盘」**
     *    —— 用户第 8 条第二步要的是"点开圆点 ⇒ 在画布右上角**下方**展开色盘浮层"，
     *    而抽屉档的右抽屉里已经**没有**「调色盘」tab 了（只剩「用量」，见 `RightPanel` 的
     *    `drawerMode`）。留着那两句会变成"点圆点顺手弹出一个用量列表"，纯属干扰。
     */
    function onPaletteDotClick() {
        if (paletteDotOpen) {
            setPaletteDotOpen(false);
            return;
        }
        // 两者都住在画布之上的浮层体系里 ⇒ 互斥（同一时刻只允许一个浮层占着画布）。
        closeAllToolOptions();
        /*
         * B14（修 KI-045，独立复核实测的真缺陷）：**任意**已打开的抽屉都要让位，不只是右抽屉。
         *
         * 复核证据（`_审核\_暂存证据\第B9B10批-补复核\报告.md` §二 发现 1，构建 `0a51d81`）：
         *   抽屉档下**先开左抽屉**（素材/参数）再点圆点 ⇒ 浮层确实渲染了（221 个 swatch 在 DOM 里），
         *   但整块落在左抽屉底下：逐 swatch `elementFromPoint` 自命中 **iPad 0/24、手机 0/24、窄窗 0/18**；
         *   点那些"看起来在浮层里"的色块，命中的其实是抽屉/遮罩 ⇒ 走关闭路径②，**颜色没选中、浮层还关了**。
         * 根因不是"浮层 z-index 写小了"：`.palette-popover` 住在 `.tool-options-layer`（`z-index:6`）里，
         *   该层自建**层叠上下文** ⇒ 子元素再高的 z-index 也出不了这一层，而抽屉是 `z-index:41`（遮罩 40）。
         *   ⇒ 所以修法只能落在"两者不同时开"上（而不是抬 z-index）。
         * 为什么选"抽屉让位"而不是"让圆点在这场合里不可点"：用户第 14 轮裁决
         *   「抽屉打开时挡住圆点即可，因为**打开抽屉时不用色盘**」——色盘与抽屉本就是两个上下文，
         *   点圆点 = 明确要色盘 ⇒ 让抽屉收起最符合这句话，也让 KI-047（手机档点圆点会顺手关掉右抽屉）
         *   从"一次点击两个后果"变成**有意设计**。
         */
        if (openPanel)
            setOpenPanel(null);
        setPaletteDotOpen(true);
    }
    /**
     * 把工具浮层贴到**触发按钮**旁边（根修 KI-034 之后的新机制，2026-09-21）。
     *
     * ── 为什么是这个机制 ──────────────────────────────────────────────────────────
     * 旧机制（第 3 批）：浮层是 `.tool-rail` 的绝对定位**网格子项**，靠 `grid-row` 贴住按钮行。
     * 它的隐含前提是"父容器不裁剪"，而同一次改动给 `.tool-rail` 加了 `overflow-x:hidden`
     * ⇒ 浮层被裁掉（桌面实测 `x=391` vs 工具条右边界 `384`）。**位置与"容器裁不裁剪"耦合**，
     * 这就是根因。现在只用一个真值来源：**触发按钮的 `getBoundingClientRect()`**，
     * 换算到覆盖层的坐标系里 ⇒ 容器怎么裁、工具条怎么滚、视口多窄都不影响正确性。
     *
     * ── 定位规则（写死，无第二套） ────────────────────────────────────────────────
     * 可用带（`band`）= 上：顶栏下边缘（**实测** `topbarRef`）；下：手机档 = 工具条上边缘
     * （`railRef`）、其余档 = 壳的下内边距；左右：壳的左右内边距。
     * ① 高度：若自然高 > 带高 − 16，就把 `max-height` 收到"带高 − 16"（自己滚）。
     * ② 横向：首选「按钮右边缘 + 8px」；右边放不下 ⇒ 翻到按钮左侧（按钮左边缘 − 8 − 宽）；
     *    左侧也放不下 ⇒ 夹住（贴住带右侧内边距）。三种情况各给一个类，
     *    箭头（`::before`）只在**水平相邻**时显示，翻到左边时箭头换到浮层右侧。
     * ③ 纵向：首选「按钮上边缘」；超出带下边界 ⇒ 上移到"下边界 − 高"；仍不够 ⇒ 贴带顶。
     * ④ 箭头纵向位置写进 `--tool-options-arrow-top`，让它始终指向**触发按钮的垂直中心**
     *    （旧写法是写死的 `top: calc((44px - 9px)/2)`，只在"浮层与按钮上下对齐"时才成立）。
     *
     * 手机档因此**不再需要 `position: fixed` 那套**：底部工具条上的按钮"右边放不下 + 下边放不下"
     * ⇒ 被夹到 `left = 带左 + 8`、`top = 带下 − 8 − 高`。与旧的
     * `left: 8px; right: 8px; bottom: calc(--rail-height + 8px)` **几乎一致，但不是逐像素**：
     * 旧手机档对 `.tool-options.recolor-options` 单独用 `+12px`（其余 7 个 +8px），新实现统一 −8px
     * ⇒ 换色浮层底边 730.0 → 734.3（下移约 4px，独立验证子代理 `7e02e602` 实测）。
     * 这是**有意的统一**（一条规则取代一处 per-tool 例外）。
     * ────────────────────────────────────────────────────────────────────────────
     */
    function placeToolOptions() {
        const layer = toolOptionsLayerRef.current;
        const rail = railRef.current;
        if (!layer || !rail)
            return;
        // 8 个开合状态互斥（`activateTool` 每次都把其余 7 个置 false）⇒ 覆盖层里最多一个浮层。
        const pop = layer.querySelector('.tool-options');
        if (!pop)
            return;
        const toolId = pop.dataset.toolOptions;
        const trigger = toolId ? rail.querySelector(`.tool-button[data-tool-id="${toolId}"]`) : null;
        if (!trigger)
            return;
        const pad = 8;
        // 量"自然尺寸"之前先把上一轮写进去的夹紧清掉，否则会一轮比一轮小。
        if (pop.style.maxHeight !== '')
            pop.style.maxHeight = '';
        const natural = pop.getBoundingClientRect();
        const layerRect = layer.getBoundingClientRect();
        const btn = trigger.getBoundingClientRect();
        if (!layerRect.height || !natural.width)
            return;
        // 可用带：顶栏之下、工具条之上（手机档），左右不出壳。
        const topbar = topbarRef.current?.getBoundingClientRect();
        const band = {
            left: layerRect.left,
            right: layerRect.right,
            top: topbar ? topbar.bottom : layerRect.top,
            bottom: isPhoneViewport ? rail.getBoundingClientRect().top : layerRect.bottom,
        };
        // ① 高度
        const maxH = Math.max(96, band.bottom - band.top - pad * 2);
        const height = Math.min(natural.height, maxH);
        if (natural.height > maxH)
            pop.style.maxHeight = `${Math.round(maxH)}px`;
        // ② 横向
        const minLeft = band.left + pad;
        const maxLeft = Math.max(minLeft, band.right - pad - natural.width);
        let left = btn.right + pad;
        let side = 'right';
        if (left > maxLeft) {
            const flippedLeft = btn.left - pad - natural.width;
            if (flippedLeft >= minLeft) {
                left = flippedLeft;
                side = 'left';
            }
            else {
                left = maxLeft;
                side = 'clamped';
            }
        }
        // ③ 纵向
        const minTop = band.top + pad;
        const maxTop = Math.max(minTop, band.bottom - pad - height);
        const top = Math.min(Math.max(btn.top, minTop), maxTop);
        // ④ 写回（值没变就不写：这些写操作会进 style 属性，幂等才不会自激 ResizeObserver）
        const leftPx = `${Math.round(left - layerRect.left)}px`;
        const topPx = `${Math.round(top - layerRect.top)}px`;
        if (pop.style.left !== leftPx)
            pop.style.left = leftPx;
        if (pop.style.top !== topPx)
            pop.style.top = topPx;
        if (pop.classList.contains('is-left-of-trigger') !== (side === 'left')) {
            pop.classList.toggle('is-left-of-trigger', side === 'left');
        }
        if (pop.classList.contains('is-detached') !== (side === 'clamped')) {
            pop.classList.toggle('is-detached', side === 'clamped');
        }
        const arrowTop = `${Math.round(Math.max(10, Math.min(height - 19, btn.top + btn.height / 2 - top)))}px`;
        if (pop.style.getPropertyValue('--tool-options-arrow-top') !== arrowTop) {
            pop.style.setProperty('--tool-options-arrow-top', arrowTop);
        }
    }
    /**
     * B10（用户第 8 条第二步）：把**色盘浮层**贴到画布右上角那个圆点的**正下方**。
     *
     * ── 它住在哪、为什么这样就不会被裁 ────────────────────────────────────────────────
     * 它和 8 个工具浮层**同一个覆盖层**（`.tool-options-layer`：`.app-shell` 的绝对定位子元素、
     * `inset: 0`、**没有任何 `overflow`**）。这是本批最容易踩的坑：第 3 批把浮层放进
     * `.tool-rail`（`overflow-x: hidden`）时被**整块裁掉**，而"一个轴写 `overflow:auto/scroll`
     * 会让另一个轴的计算值从 `visible` 变成 `auto`" ⇒ 只要祖先里任何一个盒子在某一个轴上
     * 会滚，浮层就会被裁。所以：**一层不裁剪的覆盖层 + JS 按实测 rect 定位**，
     * 没有任何"容器裁不裁剪"的隐含前提（与第 6 批工具浮层同一套机制、同一个真值来源）。
     *
     * ── 定位规则（写死，无第二套）────────────────────────────────────────────────────
     * 可用带（band）：上 = 实测顶栏下边缘；下 = 手机档工具条上边缘、其余档 = 覆盖层下边缘，
     * **并再让开画布上已有的两个浮动控件**（`.canvas-status` / `.zoom-controls`，
     * **实测它们的 rect**，不写死数字）—— 手机档的浮层是底部浮层，天然会伸进画布底部那一条；
     * 平板/窄窗档这两个控件离浮层很远，这条夹紧对它们**实测零影响**（数字见报告）。
     * ① 横向（平板/窄窗）：右边缘对齐圆点右边缘（`dot.right − 宽`），再夹进带内；
     *    手机档：**底部浮层**（用户第 3 条裁决）⇒ 左边缘贴带左内边距，宽度由 CSS
     *    `calc(100% - 16px)` 给（与手机档 `.tool-options` 同一手法，百分比以覆盖层为包含块）。
     * ② 纵向（平板/窄窗）：**先定 `top` = 圆点下边缘 + 8px，再按"圆点下方还剩多少"收高度**。
     *    ⚠️ 这个方向不能反：第一版是"先按自然高算 top、再夹进带内"，于是一旦带的下边界
     *    （手机档工具条 / 画布上那些浮动控件）把可用高度压到比浮层自然高还小，浮层就会
     *    **整体往上滑、压住圆点**（iPad 1024×768 实测 `pop.y = 131` 而圆点 `y = 131..175`
     *    ⇒ 与圆点重叠）。空间不够时正确的行为是**变矮**（网格自己滚），不是往上爬。
     * ③ 高度：`max-height = min(带高, 圆点下方可用高) − 16`；手机档 = 带内全高（bottom sheet）。
     */
    function placePalettePopover() {
        const layer = toolOptionsLayerRef.current;
        const pop = palettePopoverRef.current;
        const dot = paletteDotRef.current;
        if (!layer || !pop || !dot)
            return;
        const pad = 8;
        // 量"自然尺寸"之前先把上一轮写进去的夹紧清掉，否则会一轮比一轮小。
        if (pop.style.maxHeight !== '')
            pop.style.maxHeight = '';
        const natural = pop.getBoundingClientRect();
        const layerRect = layer.getBoundingClientRect();
        const btn = dot.getBoundingClientRect();
        if (!layerRect.height || !natural.width)
            return;
        const topbar = topbarRef.current?.getBoundingClientRect();
        const bandTop = topbar ? topbar.bottom : layerRect.top;
        let bandBottom = isPhoneViewport
            ? (railRef.current?.getBoundingClientRect().top ?? layerRect.bottom)
            : layerRect.bottom;
        // 让开画布上已有的浮动控件（实测 rect）。⚠️ 只让开**有面积**的那些；
        // 手机档的 `.canvas-status` 被抬到 `.zoom-controls` 之上，取两者顶边的较小值即可。
        ['.canvas-status', '.zoom-controls'].forEach((selector) => {
            const el = document.querySelector(selector);
            if (!el)
                return;
            const rect = el.getBoundingClientRect();
            if (rect.height > 0)
                bandBottom = Math.min(bandBottom, rect.top - pad);
        });
        let left = layerRect.left + pad;
        let top = bandTop + pad;
        let maxH = Math.max(160, bandBottom - bandTop - pad * 2);
        if (isPhoneViewport) {
            // 底部浮层：贴带的下内边距，高度受带高限制。
            top = bandBottom - pad - Math.min(natural.height, maxH);
        }
        else {
            // 圆点**下方**展开：top 先定死，再按剩余空间收高度（②）。
            top = Math.max(btn.bottom + pad, bandTop + pad);
            maxH = Math.max(160, bandBottom - pad - top);
            const minLeft = layerRect.left + pad;
            const maxLeft = Math.max(minLeft, layerRect.right - pad - natural.width);
            left = Math.min(Math.max(btn.right - natural.width, minLeft), maxLeft);
        }
        if (natural.height > maxH)
            pop.style.maxHeight = `${Math.round(maxH)}px`;
        const leftPx = `${Math.round(left - layerRect.left)}px`;
        const topPx = `${Math.round(top - layerRect.top)}px`;
        if (pop.style.left !== leftPx)
            pop.style.left = leftPx;
        if (pop.style.top !== topPx)
            pop.style.top = topPx;
    }
    // 每次渲染之后重贴一次（浮层内容会随状态变高变矮：形状选到"箭头"会多一行、橡皮切到"整片删除"
    // 会少一组控件…）。这里**刻意不加依赖数组**：靠 render 驱动，写进去的都是内联样式、
    // 不会反过来触发 render ⇒ 没有环。
    React.useLayoutEffect(() => {
        placeToolOptionsRef.current = () => {
            placeToolOptions();
            placePalettePopover();
        };
        placeToolOptionsRef.current();
    });
    // 不经过 render 的环境变化：视口 resize、工具条滚动（`overflow-y:auto`）、覆盖层/工具条尺寸变化。
    // 依赖里带上"覆盖层是否存在"，这样它挂载/卸载时观察器跟着重建。
    React.useEffect(() => {
        const place = () => placeToolOptionsRef.current();
        const layer = toolOptionsLayerRef.current;
        const rail = railRef.current;
        window.addEventListener('resize', place);
        rail?.addEventListener('scroll', place, { passive: true });
        const observer = new ResizeObserver(place);
        if (layer)
            observer.observe(layer);
        if (rail)
            observer.observe(rail);
        return () => {
            window.removeEventListener('resize', place);
            rail?.removeEventListener('scroll', place);
            observer.disconnect();
        };
    }, [anyToolOptionsOpen, panelLayout, paletteDotOpen]);
    // ——————————— Bug B 根修：`highlightedColorId` 的生命周期由**明确事件**决定 ———————————
    //
    // 它是什么：右栏「用量」列表里 hover 某一行 ⇒ 画布上**只有这一种颜色的豆**保持原样、
    // 其余格子被刷白（"单独显示某色"，`WorkspaceCanvas` 的 `highlightedColorId`）。
    //
    // 旧实现：只有那两行按钮自己的 `onMouseEnter/onMouseLeave` 会写它。而"点一行打开改色编辑器"
    // 会把整个用量列表换成编辑器 ⇒ 被 hover 的行**被卸载**，`onMouseLeave` **永不触发**
    // ⇒ 高亮永久残留（触屏更明显：连 hover 都没有；基线实测退出后画布 71.63% 像素与未 solo 基线不同，
    // 而且"点画布"也不自愈）。**只在"点行时先清一次"是补丁** —— 高亮还会被"换工具 / 切 tab /
    // 换工程 / 在画布上乱画"这些路径留下同样无人清。所以这里把它写成一份**显式清除清单**：
    //   · 换工具（`tool`）
    //   · 切右栏 tab（`rightTab`）
    //   · 换/改工程（`project` 换代）
    //   · 在画布上按下指针（`pointerdown` 落进 `.workspace`）
    //   · 打开改色编辑器 + 用量列表容器 leave + 组件卸载 —— 这三条在 `RightPanel.tsx` 里
    React.useEffect(() => {
        setHighlightedColorId(null);
    }, [tool, rightTab, project]);
    React.useEffect(() => {
        const shell = shellRef.current;
        if (!shell)
            return undefined;
        const onCanvasPointerDown = (event) => {
            const target = event.target;
            if (target && typeof target.closest === 'function' && target.closest('.workspace')) {
                setHighlightedColorId(null);
            }
        };
        // 捕获阶段：不管画布内部的哪个 handler 先跑，高亮都在本次交互一开始就归零。
        shell.addEventListener('pointerdown', onCanvasPointerDown, true);
        return () => shell.removeEventListener('pointerdown', onCanvasPointerDown, true);
    }, []);
    function updateCells(cells) {
        updateProject(withCells(project, cells));
    }
    function resetImportSettings() {
        setConvertWidth(defaultImportSettings.width);
        setWidthInput(String(defaultImportSettings.width));
        setMaxColors(defaultImportSettings.maxColors);
        setGenerationStyle(defaultImportSettings.generationStyle);
        setBackgroundMode(defaultImportSettings.backgroundMode);
        setTolerance(defaultImportSettings.tolerance);
        // 恢复默认时也让容差回到「自动校准」状态
        setToleranceManual(false);
    }
    function resetReferenceTransform() {
        setReferenceScale(1);
        setReferenceOffset({ x: 0, y: 0 });
        setReferenceAdjusting(false);
    }
    function resetAdjustments() {
        const session = adjustmentSessionRef.current;
        if (session.layerId === activeLayer.id && session.baseCells.length === activeLayer.cells.length) {
            updateProject(withLayers(project, layers.map((layer) => (layer.id === activeLayer.id ? { ...layer, cells: session.baseCells.slice() } : layer))));
        }
        setAdjustments(defaultAdjustments);
        adjustmentSessionRef.current = { layerId: null, baseCells: [] };
    }
    function updateAdjustment(key, value) {
        if (activeLayer.locked) {
            setNotice(text.adjustmentLocked);
            return;
        }
        const nextAdjustments = { ...adjustments, [key]: value };
        if (adjustmentSessionRef.current.layerId !== activeLayer.id) {
            adjustmentSessionRef.current = { layerId: activeLayer.id, baseCells: activeLayer.cells.slice() };
            commitHistory();
        }
        const baseCells = adjustmentSessionRef.current.baseCells.length > 0 ? adjustmentSessionRef.current.baseCells : activeLayer.cells;
        const adjustedCells = adjustLayerCells(baseCells, nextAdjustments, activePalette);
        setAdjustments(nextAdjustments);
        updateProject(withLayers(project, layers.map((layer) => (layer.id === activeLayer.id ? { ...layer, cells: adjustedCells } : layer))));
    }
    function applyColorCleanup() {
        if (activeLayer.locked) {
            setNotice(text.adjustmentLocked);
            return;
        }
        const { cells, changed } = mergeCloseLayerColors(activeLayer.cells, activePalette, colorCleanupStrength);
        if (changed > 0) {
            commitHistory();
            updateProject(withLayers(project, layers.map((layer) => (layer.id === activeLayer.id ? { ...layer, cells } : layer))));
        }
        setNotice(text.layerColorsCleaned(changed));
    }
    function applyLayerColorLimit() {
        if (activeLayer.locked) {
            setNotice(text.adjustmentLocked);
            return;
        }
        const { cells, changed } = limitLayerColors(activeLayer.cells, activePalette, layerColorLimit);
        if (changed > 0) {
            commitHistory();
            updateProject(withLayers(project, layers.map((layer) => (layer.id === activeLayer.id ? { ...layer, cells } : layer))));
        }
        setNotice(text.layerColorsLimited(changed, layerColorLimit));
    }
    function applyLayerEffect(effect, label) {
        if (activeLayer.locked) {
            setNotice(text.adjustmentLocked);
            return;
        }
        const { cells, changed } = applyEffectToLayer(activeLayer.cells, activePalette, effect);
        if (changed > 0) {
            commitHistory();
            updateProject(withLayers(project, layers.map((layer) => (layer.id === activeLayer.id ? { ...layer, cells } : layer))));
        }
        setNotice(text.effectApplied(label, changed));
    }
    /**
     * 画布上点一颗豆（`tool === 'recolor'`）的语义 —— **B19 退回上游原始语义**（`84f1b99`）。
     *
     * 第 2 批「换色融合」曾经在这里插了一层"工具侧生效目标色"（用户显式挑过就用挑的、没挑过才用画笔色），
     * 并与「用量 → 改色」共享一个会话 + 一个编辑器 ⇒ 用户看到两个入口在做同一件事（第 15 轮第 5 条）。
     * 现在画布只把**源色**交给 `replaceColor`，目标色由它的默认参数（= 当前画笔色）决定 ⇒ 与原始语义一致：
     * 「先在色盘选好目标色 → 再点画布上的源色」。会话与推荐只服务「用量 → 改色」那一处。
     */
    /**
     * 改色：把 `sourceColorId` 的格子换成 `targetColorId`。
     *
     * ⚠️ 目标色**必须显式传入**（W2 / 架构决定 R2）：以前它恒取全局 `selectedColorId`，
     * 造成「没选 A1 却换成 A1」，且改色面板里那条"会变成什么颜色"的警告描述的
     * 是**另一个**颜色（面板算的是它自己的目标色）⇒ 提示与实际结果分叉。
     * 默认值 `= selectedColorId` 是**刻意保留**的：画布右键改色（`WorkspaceCanvas`）
     * 只传一个参数，靠它继续走"换成当前画笔色"的老语义 ⇒ `WorkspaceCanvas.tsx` 零改动。
     */
    function replaceColor(sourceColorId, targetColorId = selectedColorId) {
        if (!sourceColorId)
            return;
        // 源色 = 目标色：直接返回。
        // ⚠️ 这里**不是**"以前静默、现在有提示"：面板侧同色时「替换」按钮本来就 disabled
        //   （RightPanel 有 sameTarget 行内提示 + disabled），`WorkspaceCanvas` 侧也会抢先 return，
        //   所以这条分支在任何可达 UI 路径上都到不了（KI-027 / V-W2 三重证据）。
        //   提示能力由面板的 disabled + 行内提示承担；此守卫保留作**防御**（replaceColor 是变更入口）。
        if (sourceColorId === targetColorId)
            return;
        let changed = 0;
        const visibleLayerIds = new Set(project.layers.filter((layer) => layer.visible).map((layer) => layer.id));
        const nextLayers = layers.map((layer) => {
            if (layer.locked || !visibleLayerIds.has(layer.id))
                return layer;
            let layerChanged = false;
            const cells = layer.cells.map((cell) => {
                if (cell !== sourceColorId)
                    return cell;
                changed += 1;
                layerChanged = true;
                return targetColorId;
            });
            return layerChanged ? { ...layer, cells } : layer;
        });
        if (changed === 0)
            return;
        commitHistory();
        updateProject(withLayers(project, nextLayers, project.activeLayerId));
        setNotice(text.recoloredBeads(changed));
    }
    /**
     * W3.3c 接线：确认换品牌。
     *
     * 撤销语义（关键）：必须走 App 既有的撤销栈，而不是直接改格子 ——
     *   `commitHistory()` 先把「切换前这一刻」的 project 压进 past 栈
     *   ⇒ 之后点顶栏「撤销」会回到切换前那一刻，**不会**退到"出图前"把整张图清掉；
     *   而顶栏「重做」会回到切换后（W6 真鼠标实测过两向）。
     *
     * 重算结果全部来自 `BrandSelect` 交过来的 `plan`（内部 = `brands.analyzeBrandRecolor`，
     * 以每格当前 RGB 在目标品牌色板里找最近色），本函数不重抄任何选色逻辑。
     */
    function applyBrandSwitch(plan) {
        const nextLayers = applyBrandRecolor(project.layers, plan);
        commitHistory();
        updateProject({ ...withLayers(project, nextLayers, project.activeLayerId), activeBrand: plan.toBrand });
        // 换品牌会整图重算色，当前选中色很可能已不在新色板里；顺手收敛到新品牌色板的第一个色。
        const brandPalette = paletteForBrand(plan.toBrand);
        setSelectedColorId((current) => (brandPalette.some((color) => color.id === current) ? current : brandPalette[0].id));
        /**
         * B7（用户第 5 条「选即切换，不加应用按钮」）：换品牌不再有"先预览、再确认"那一步，
         * 所以原来**事前**那张 `.brand-recolor-preview`（含"新色板里没有足够接近的颜色…可能会变差"
         * 的 `role="alert"` 警告）不存在了。这会丢掉一条**用户看得见**的信息 ⇒ 就地补到回执里：
         *   · 判定式与 `BrandSelect.tsx` 里原来那条**逐字相同**（`over16 > 0 || mean > 8`，
         *     口径来自 `brands.ts` 的 `plan.quality.changed`）；
         *   · 「看起来一样 / 颜色会变」两个计数也沿用原口径：
         *     `exact` = 换了色号但 RGB 完全相同的格数，`changedCells - exact` = 看得出差别的格数。
         * ⚠️ 文案是**新**键 `brandSwitchRough`（中英各一条）：原来那条 `brandPreviewWarn` 写着
         *    "确认后可以随时一键撤销"、`brandPreviewQuality` 说着"差别大的排在清单前面"，
         *    而"确认"与那份清单都已不存在 ⇒ 直接复用会指向不存在的东西。
         */
        const rough = plan.quality.changed.over16 > 0 || plan.quality.changed.mean > 8;
        const sameLookCells = plan.quality.changed.exact;
        const differentLookCells = plan.changedCells - sameLookCells;
        const switched = text.brandSwitched(getBrandProfile(plan.fromBrand).name, getBrandProfile(plan.toBrand).name, plan.changedCells, plan.totalCells);
        setNotice(rough ? `${switched} ${text.brandSwitchRough(sameLookCells, differentLookCells)}` : switched);
    }
    /**
     * W3.3c 接线：上次换品牌的方案 —— W6 已删除（用户裁决【2】：只保留全局撤销/重做）。
     * 原先它同时驱动「↩︎ 撤销换品牌」独立按钮与 `undoBrandSwitch`；两者一起删掉了，
     * 因为换品牌走的就是 App 既有的撤销栈，顶栏「撤销 / 重做」本来就覆盖它。
     */
    function undo() {
        const previous = past[past.length - 1];
        if (!previous)
            return;
        /*
          B10 ②：四条栈操作**同一次**做完（`past`/`future` 与 `pastModes`/`futureModes`），
          保证两条栈永远同长。`restoredMode` 有可能就是当前档位（那时 `setPaletteMode` 会被
          React bail out），这**不是**异常：它表示"这一帧本来就是这个档"。
          ⚠️ `outgoingMode` 同样必须**先取成局部量**再进 `setFutureModes` 的 updater
             （updater 懒执行，见 `commitHistory()` 里那段说明）。
        */
        const restoredMode = pastModes[pastModes.length - 1];
        const outgoingMode = presentPaletteModeRef.current;
        setPast((items) => items.slice(0, -1));
        setPastModes((items) => items.slice(0, -1));
        setFuture((items) => [...items, project]);
        setFutureModes((items) => [...items, outgoingMode]);
        if (restoredMode !== undefined) {
            presentPaletteModeRef.current = restoredMode;
            setPaletteMode(restoredMode);
        }
        updateProject(previous);
    }
    function redo() {
        const next = future[future.length - 1];
        if (!next)
            return;
        const restoredMode = futureModes[futureModes.length - 1];
        const outgoingMode = presentPaletteModeRef.current;
        setFuture((items) => items.slice(0, -1));
        setFutureModes((items) => items.slice(0, -1));
        setPast((items) => [...items, project]);
        setPastModes((items) => [...items, outgoingMode]);
        if (restoredMode !== undefined) {
            presentPaletteModeRef.current = restoredMode;
            setPaletteMode(restoredMode);
        }
        updateProject(next);
    }
    // W1 顶栏重构：`startBlank` / `clearCanvas` 已随「新建 / 清空」两个按钮一起删除
    // （grep 确认过：这两个函数在改动前各自只有顶栏那一个调用点）。
    // i18n key `new` / `clear` 本身**没有删**（本轮不许动 i18n.tsx），现在成了孤儿 key，
    // 由 W5 统一清理 —— 清单见交付说明。
    function resizeCanvas() {
        resizeCanvasTo(clampInteger(canvasWidth, 8, 180), clampInteger(canvasHeight, 8, 180));
    }
    /**
     * 按**显式尺寸**改画布。抽出来是因为手机档的预设下拉要"选了就生效"（见 `applyPreset`）：
     * 那条路径里 `canvasWidth/canvasHeight` 的 state 还没提交，直接调 `resizeCanvas()` 会读到旧值。
     */
    function resizeCanvasTo(width, height) {
        if (width === project.width && height === project.height)
            return;
        commitHistory();
        const nextLayers = layers.map((layer) => ({
            ...layer,
            cells: resizeCells(layer.cells, project.width, project.height, width, height),
        }));
        updateProject({
            ...project,
            width,
            height,
            layers: nextLayers,
            cells: composeVisibleCells(nextLayers, width, height),
        });
        setNotice(language === 'zh' ? `画布已调整为 ${width} * ${height}。` : `Canvas resized to ${width} x ${height}.`);
    }
    function applyPreset(value) {
        const preset = sizePresets.find((item) => item.label === value);
        if (!preset)
            return;
        setCanvasWidth(preset.width);
        setCanvasHeight(preset.height);
        // 手机档顶栏只剩这个预设下拉（用户裁决 D11）—— 「应用」按钮与两个数字框都被 CSS 藏了。
        // ⇒ 必须"选了就生效"，否则手机上这个下拉框是个**死控件**（点完什么都不发生）。
        // 桌面/平板仍有「应用」按钮，行为与改动前逐字一致。
        if (isPhoneViewport)
            resizeCanvasTo(preset.width, preset.height);
    }
    function handleImageFile(file) {
        if (!file.type.match(/^image\/(png|jpeg|jpg|webp)$/)) {
            // W6 任务 D 补：这是**失败**，必须把状态栏标成错误 ⇒ 才会渲染成 role="alert"。
            // 原来只 setNotice，于是这条"请使用 PNG…"被当成普通状态播报（role="status"），
            // 与 `Task D` 的口径（错误 = alert）不符 —— 探针实测到的：status/alert 的落点不完整。
            setNoticeIsError(true);
            setNotice(language === 'zh' ? '请使用 PNG、JPG、JPEG 或 WebP 图片。' : 'Use a PNG, JPG, JPEG, or WebP image.');
            return;
        }
        // W6 接线（W4 §8.7）：上传 = 用户主动换图 ⇒ 作废"恢复途中"的竞态、并让签名变一次。
        userUploadedRef.current = true;
        sourceTokenRef.current += 1;
        setSourceImageLoading(false);
        setPendingFile(file);
        setPendingImageUrl((current) => {
            if (current)
                URL.revokeObjectURL(current);
            return URL.createObjectURL(file);
        });
        setReferenceFile(file);
        setReferenceImageUrl((current) => {
            if (current)
                URL.revokeObjectURL(current);
            return URL.createObjectURL(file);
        });
        resetReferenceTransform();
        autoGenerateShouldCommitRef.current = true;
        // 换了新素材 → 容差回到「自动」状态：每张图合适的容差不一样，必须按新图重新算。
        // 用户之前手动调过的那张图，其设置不再适用于新图。
        setToleranceManual(false);
        setTolerance(defaultImportSettings.tolerance);
        // 图源历史重置成「只有原图」这一条。
        // 第 0 条永远是原图，之后每点一次「生成 AI 图」追加一条，靠历史选中项来切换图纸。
        const originalUrl = URL.createObjectURL(file);
        setAiHistory([{ file, url: originalUrl, bg: 'keep', isOriginal: true }]);
        setAiHistoryIndex(0);
        setAiResultUrl(null);
        setAiResultSourceFile(null);
        setPatternHandEdited(false);
        setNotice(language === 'zh' ? `正在生成 ${file.name}...` : `Generating ${file.name}...`);
        // W6 接线（W4 §8.7）：写入 IndexedDB。
        // ⚠️ 成功/失败都**只改 `sourceImageRef` 这一个状态**，绝不 `setProject(withSourceImage(...))` ——
        //    `generateFromImage()` 的整份写回会把它冲成 null（硬约束 A）。
        void saveSourceImage(file, { language }).then((result) => {
            if (result.persisted && result.imageId) {
                setPersistMode('persistent');
                setPersistNotice(null);
                setSourceImageRef({
                    imageId: result.imageId,
                    name: file.name,
                    type: file.type,
                    size: file.size,
                    savedAt: new Date().toISOString(),
                });
            }
            else {
                // 存不下（隐私模式 / 配额 / 大图）⇒ 保持内存模式 + **常驻**告知 + 一次浮条。
                setPersistMode('memory');
                setSourceImageRef(null); // 不留下"假关联"（否则下次启动会按不存在的 id 去恢复）
                if (result.notice) {
                    setPersistNotice(result.notice);
                    setNoticeIsError(true);
                    setNotice(result.notice);
                }
            }
        });
    }
    /**
     * KI-007 的出路：用户重新选一张图后，既有那条 `.hidden-input` 的 `onChange` → `handleImageFile()`
     * 会把 `autoGenerateShouldCommitRef` 置真，随后自动重算 effect 就按**当前参数**重新出一次图。
     * 所以这里只需要把点击转发给既有的 file input，**不需要**再写一条生成路径。
     */
    function handleReferenceImageFile(file) {
        if (!file.type.match(/^image\/(png|jpeg|jpg|webp)$/)) {
            // W6 阶段 B：同 `handleImageFile` —— 这是**失败**，必须标成错误才会渲染 `role="alert"`。
            // 原来只 setNotice ⇒ 失败被当成普通状态播报（阶段 A 报告 §3.3 记的 2 处缺口之一）。
            setNoticeIsError(true);
            setNotice(language === 'zh' ? '请使用 PNG、JPG、JPEG 或 WebP 图片。' : 'Use a PNG, JPG, JPEG, or WebP image.');
            return;
        }
        setReferenceFile(file);
        setReferenceImageUrl((current) => {
            if (current)
                URL.revokeObjectURL(current);
            return URL.createObjectURL(file);
        });
        resetReferenceTransform();
        setReferenceVisible(true);
        setNotice(language === 'zh' ? `${file.name} 已设为参考图。` : `${file.name} set as reference image.`);
    }
    /** 把 File 读成 dataURL（浏览器端） */
    function readFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(new Error('读取图片失败'));
            reader.readAsDataURL(file);
        });
    }
    /** 把 dataURL 还原成 File，供后续拼豆管线使用 */
    function dataUrlToFile(dataUrl, fileName) {
        const [head, body] = dataUrl.split(',');
        const mime = /:(.*?);/.exec(head)?.[1] ?? 'image/jpeg';
        const bin = atob(body);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1)
            bytes[i] = bin.charCodeAt(i);
        return new File([bytes], fileName, { type: mime });
    }
    /** 直连火山方舟，得到 Q 版像素画（返回新的 File 和缩略图 data URL）
     *  纯静态部署（GitHub Pages）下没有本地代理，所以浏览器直接调方舟：
     *  方舟对任意 Origin 都回跨域头，预检允许 authorization,content-type。 */
    async function runAiRedraw(file, modelId) {
        const dataUrl = await readFileAsDataUrl(file);
        const dims = await new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
            img.onerror = () => resolve({ w: 1024, h: 1024 });
            img.src = dataUrl;
        });
        const { W, H } = calcSize(Number(dims.w) || 1024, Number(dims.h) || 1024);
        // 方舟一次生成要 27~107 秒，所以给足超时；超时要能主动中断，不能让界面一直转
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), AI_REDRAW_TIMEOUT_MS);
        let resp;
        try {
            resp = await fetch(ARK_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${aiApiKey.trim()}`,
                },
                body: JSON.stringify({
                    model: modelId,
                    prompt: buildPrompt(backgroundMode),
                    image: dataUrl,
                    size: `${W}x${H}`,
                    watermark: false,
                    response_format: 'b64_json',
                }),
                signal: controller.signal,
            });
        }
        catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
                throw new Error(`AI 重绘超时（已等待 ${Math.round(AI_REDRAW_TIMEOUT_MS / 1000)} 秒）。`
                    + '方舟一次生成通常 30~110 秒，超时说明网络太慢或服务繁忙，稍后重试即可（这次没有拿到图片）。');
            }
            // 网络层就失败了。注意：方舟在 Key 无效时返回的 401 不带跨域头，
            // 浏览器读不到响应，同样只能报成网络错误 —— 所以这里必须提醒检查 Key。
            const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
            throw new Error('连不上火山方舟；如果 Key 填错也会表现成这样，请检查 Key（ark- 开头，控制台重新复制一个）。'
                + `另外确认网络能访问 ark.cn-beijing.volces.com。原始错误：${raw}`);
        }
        finally {
            window.clearTimeout(timer);
        }
        const text = await resp.text();
        let json = null;
        try {
            json = JSON.parse(text);
        }
        catch (error) {
            throw new Error(`AI 服务返回了无法解析的内容（HTTP ${resp.status}）：${text.slice(0, 300)}`);
        }
        if (!resp.ok || json.error) {
            const message = json?.error?.message || json?.message || `AI 服务返回 HTTP ${resp.status}`;
            const code = json?.error?.code ?? '';
            const requestId = json?.error?.request_id ?? json?.request_id ?? '';
            // 把常见原因翻译成人话，省得只知道一个报错码
            let hint = '';
            const lowered = String(message).toLowerCase() + String(code).toLowerCase();
            if (lowered.includes('modelnotopen') || lowered.includes('has not activated the model')) {
                hint = '原因：你火山方舟账号里**这个模型还没开通**。'
                    + '去火山方舟控制台 →「开通管理」里开通对应模型；或者在这里展开「模型设置」，换成一个你已开通的模型 ID 再试。';
            }
            else if (lowered.includes('setlimitexceeded')) {
                hint = '原因：**这个模型的调用上限被触发了**（通常是免费额度用完了，或你在控制台给模型设了用量上限）。'
                    + '去火山方舟控制台 →「开通管理」，看该模型的用量/额度，需要的话调整上限或升级套餐；'
                    + '也可以在这里展开「模型设置」换一个模型试试。'
                    + '（这次请求没有生成图片，不扣费）';
            }
            else if (resp.status === 429 || lowered.includes('ratelimit') || lowered.includes('quota')) {
                hint = '原因：调用太频繁或额度不足。等一两分钟再点；如果反复出现，去控制台确认余额和用量限制。'
                    + '（这类失败通常不扣费）';
            }
            else if (lowered.includes('policyviolation') || lowered.includes('sensitive')) {
                hint = '原因：这张图被火山方舟的内容审核拦下了（动漫/影视的版权角色很常见，比如迪士尼、宝可梦等）。'
                    + '可以换成不涉及版权角色的图片，或者改用「保留背景」再试。';
            }
            else if (resp.status === 401 || lowered.includes('authentication') || lowered.includes('invalid api key')) {
                hint = '原因：API Key 不对或已失效。到火山方舟控制台重新复制一个（ark- 开头）填进来。';
            }
            else if (resp.status === 429 || lowered.includes('ratelimit') || lowered.includes('quota')) {
                hint = '原因：调用频率超限或余额不足。等一会儿再试，或去控制台确认余额。';
            }
            else if (resp.status >= 500) {
                hint = '原因：火山方舟服务端出错。稍等一会儿重试即可。';
            }
            else if (resp.status === 400) {
                hint = '原因：请求参数被拒绝（图片尺寸不合规，或图片内容被拦）。换一张图或改用「保留背景」再试。';
            }
            const detail = [code && `code=${code}`, requestId && `request_id=${requestId}`].filter(Boolean).join('  ');
            throw new Error(`${hint || 'AI 重绘失败。'}${hint ? '' : message}（HTTP ${resp.status}${detail ? '  ' + detail : ''}）`);
        }
        const item = (json.data ?? []).find((d) => d.b64_json);
        if (!item) {
            throw new Error(`AI 返回里没有图片数据。返回内容：${text.slice(0, 300)}`);
        }
        const base = file.name.replace(/\.[^.]+$/, '');
        const url = 'data:image/png;base64,' + item.b64_json;
        return { file: dataUrlToFile(url, `${base}_ai.png`), url };
    }
    /** 把 AI 生成的图设为参考图（便于临摹/核对），原参考图不再是原照片 */
    function useAsReference(file) {
        setReferenceFile(file);
        setReferenceImageUrl((current) => {
            if (current)
                URL.revokeObjectURL(current);
            return URL.createObjectURL(file);
        });
        setReferenceVisible(true);
    }
    /**
     * 从历史里挑一条当作当前图源：第 0 条是原图，其余是 AI 图。
     * 选中后立刻重算图纸 —— 纯本地，不调用 AI、不花钱。
     */
    function selectHistoryEntry(index) {
        const item = aiHistory[index];
        if (!item)
            return;
        setAiHistoryIndex(index);
        setAiResultSourceFile(item.isOriginal ? null : pendingFile);
        if (!item.isOriginal) {
            setAiResultUrl(item.url);
            useAsReference(item.file);
        }
        setNotice(item.isOriginal
            ? (language === 'zh' ? '已切回原图，正在出图纸…' : 'Switched back to the original image, rebuilding…')
            : (language === 'zh'
                ? `已选中第 ${index} 张 AI 图${item.bg === 'keep' ? '（保留背景）' : '（去除背景）'}，正在出图纸…`
                : `AI result #${index} selected, rebuilding…`));
        void generateFromImage({ automatic: true, sourceFile: item.file });
    }
    /** 当前图纸区是否已有内容 */
    const hasPatternContent = project.cells.some((cell) => cell !== null);
    async function generateFromImage(options = {}) {
        if (!pendingFile)
            return;
        if (activeLayer.locked) {
            setNotice(text.lockedCanvasHint);
            return;
        }
        // 自动刷新前，若图纸被手动绘制修改过，先征求确认，避免丢失手改内容
        if (options.automatic && patternHandEdited) {
            const ok = window.confirm(text.autoRefreshConfirm);
            if (!ok)
                return;
        }
        const requestId = generationRequestRef.current + 1;
        generationRequestRef.current = requestId;
        const targetLayerId = activeLayer.id;
        const sourceProject = project;
        const sourceLayers = layers;
        setIsGenerating(true);
        try {
            // 图源由「历史选中项」决定：第 0 条是原图，之后每条是一次 AI 重绘结果。
            // 只有点了「生成 AI 图」才会真的调用 AI，其它情况（改参数、切历史）都是本地重算，免费。
            const selectedEntry = aiHistory[aiHistoryIndex];
            let sourceFile = options.sourceFile ?? selectedEntry?.file ?? pendingFile;
            let fromAi = !!(options.sourceFile ?? selectedEntry?.file) && !selectedEntry?.isOriginal;
            if (options.forceAiRedraw) {
                if (!aiApiKey.trim()) {
                    setIsGenerating(false);
                    setNoticeIsError(true);
                    setNotice(language === 'zh' ? '生成失败：请先填写 API Key' : 'Failed: please enter your API Key first');
                    return;
                }
                setAiRedrawing(true);
                setNotice(text.aiRedrawRunning);
                setNoticeIsError(false);
                try {
                    const redrawn = await runAiRedraw(pendingFile, (options.model ?? aiModel).trim() || DEFAULT_AI_MODEL);
                    sourceFile = redrawn.file;
                    fromAi = true;
                    setAiResultUrl(redrawn.url);
                    setAiResultSourceFile(pendingFile);
                    // 追加进历史，成为新的「当前图源」，同时把 AI 图设为参考图
                    setAiHistory((items) => {
                        const next = [...items, { file: redrawn.file, url: redrawn.url, bg: backgroundMode }];
                        return next.slice(-AI_HISTORY_LIMIT);
                    });
                    setAiHistoryIndex((current) => {
                        const nextIndex = Math.min(aiHistory.length, AI_HISTORY_LIMIT - 1);
                        return nextIndex >= 0 ? nextIndex : current;
                    });
                    useAsReference(redrawn.file);
                }
                finally {
                    setAiRedrawing(false);
                }
                if (requestId !== generationRequestRef.current)
                    return;
                setNotice(language === 'zh' ? 'AI 重绘完成，正在生成拼豆图案…' : 'AI redraw done, generating pattern…');
            }
            else if (fromAi) {
                setNotice(language === 'zh' ? '用选中的 AI 图出图纸（未调用 AI，不产生费用）…' : 'Rebuilding from the selected AI image (no AI call, no cost)…');
            }
            else {
                setNotice(language === 'zh' ? '正在本地更新拼豆图案...' : 'Updating bead pattern locally...');
            }
            // B36：主体掩膜。只有「去背景」模式、且模型已就绪时才试着算；
            // 判断程序（是不是照片 + 模型认不认识主体）任一不通过就返回 null ⇒ 原样走老算法。
            const subjectMask = backgroundMode === 'keep' ? null : await computeSubjectMask(sourceFile, convertWidth);
            if (requestId !== generationRequestRef.current)
                return;
            const result = await imageFileToBeads(sourceFile, {
                width: convertWidth,
                maxColors,
                palette: activePalette,
                generationStyle,
                backgroundMode,
                backgroundColor: [255, 255, 255],
                tolerance,
                speckleReduction: defaultImportSettings.speckleReduction,
                // 用户手动拖过容差之后就不再自动校准；否则让工具自己算一个合适值
                calibrateTolerance: !toleranceManual,
                // 只有「AI 图 → 图纸」这一步才保护眼睛高光：
                // 低格数下高光容易被降采样吃掉，把它补回来；照片直接转图纸时不做，避免误判。
                preserveEyeHighlight: fromAi,
                // B36：主体掩膜（null = 这次不用模型，逐格与改动前一致）
                subjectMask,
            });
            if (requestId !== generationRequestRef.current)
                return;
            if (options.recordHistory)
                commitHistory();
            const nextWidth = Math.max(sourceProject.width, result.width);
            const nextHeight = Math.max(sourceProject.height, result.height);
            const nextLayers = sourceLayers.map((layer) => {
                if (layer.id === targetLayerId) {
                    return {
                        ...layer,
                        cells: resizeCells(result.cells, result.width, result.height, nextWidth, nextHeight),
                    };
                }
                return {
                    ...layer,
                    cells: resizeCells(layer.cells, sourceProject.width, sourceProject.height, nextWidth, nextHeight),
                };
            });
            const nextProject = {
                ...sourceProject,
                width: nextWidth,
                height: nextHeight,
                activeLayerId: targetLayerId,
                layers: nextLayers,
                cells: composeVisibleCells(nextLayers, nextWidth, nextHeight),
            };
            updateProject(nextProject);
            // 滑条 = 实际值：把自动校准的结果写回滑条，用户看到的就是真正在用的数
            if (!toleranceManual && result.effectiveTolerance !== undefined && result.effectiveTolerance !== tolerance) {
                setTolerance(result.effectiveTolerance);
            }
            // 图纸刚重算过，手改标记清零
            setPatternHandEdited(false);
            setNoticeIsError(false);
            setNotice(language === 'zh'
                ? `${result.colorsUsed} 色 - ${result.totalBeads} 颗 - 可编辑图案已生成。`
                : `${result.colorsUsed} colors - ${result.totalBeads} beads - editable pattern ready.`);
        }
        catch (error) {
            if (requestId !== generationRequestRef.current)
                return;
            // 失败要显眼：以前只往右侧状态栏写一行灰字，等于没有反馈
            setNoticeIsError(true);
            setNotice((language === 'zh' ? '生成失败：' : 'Failed: ')
                + (error instanceof Error ? error.message : String(error)));
        }
        finally {
            if (requestId === generationRequestRef.current)
                setIsGenerating(false);
        }
    }
    async function importJson(file) {
        let imported;
        try {
            const text = await file.text();
            imported = JSON.parse(text);
        }
        catch {
            throw new Error(text.unreadableRecord);
        }
        if (!imported.width || !imported.height || !Array.isArray(imported.cells)) {
            throw new Error(text.invalidRecord);
        }
        // W6 接线（W4 §8.7 / V-W4 §7⑤）：导入 JSON = 换成另一个工程 ⇒ 必须清关联 + **清库**。
        // 不清库的话，下次启动会按"库里有一张图"去恢复，把上一张图错当成这个工程的源图。
        // 同时把导入 JSON 自带的关联剥掉（`withSourceImage(..., null)` 是删键）—— 那份关联属于别的工程。
        // B12（KI-042）：导入的旧编辑记录也可能带 `settings.showActiveLayerOnly` ⇒ 与草稿恢复同一条处理
        // （一次性提示 + 内存态清零；数据模型不动）。
        const normalizedImport = normalizeProject(imported);
        const soloIgnored = normalizedImport.settings?.showActiveLayerOnly === true;
        setProject(withSourceImage(soloIgnored
            ? { ...normalizedImport, settings: { ...normalizedImport.settings, showActiveLayerOnly: false } }
            : normalizedImport, null));
        setPast([]);
        setFuture([]);
        setSourceImageRef(null);
        setPersistNotice(null);
        setPersistMode('unknown');
        setSourceImageLoading(false);
        restoredFileRef.current = null;
        userUploadedRef.current = false;
        setPendingFile(null);
        setPendingImageUrl((current) => {
            if (current)
                URL.revokeObjectURL(current);
            return null;
        });
        void clearSourceImage({ language }); // 库也清掉（见上：不清会把上一张图错当成这个工程的源图）
        setNotice(soloIgnored ? text.retiredLayerVisibilityNotice : text.recordImported);
        setNoticeIsError(soloIgnored);
    }
    function exportUsageList() {
        downloadUsageWorkbook(project);
        setNotice(text.usageExported);
    }
    function exportEditRecord() {
        downloadProjectJson(project);
        setNotice(text.recordExported);
    }
    function resetClipboard() {
        setClipboardPattern(null);
        setCopySelectionIndices([]);
        // 剪贴板清空 ⇒ 回到"拖选范围"相位（否则会停在一个没有内容可落的「粘贴」上）。
        setClipboardPhase('copy');
        setNotice(text.clipboardReset);
    }
    /*
      ════════════════════════════════════════════════════════════════════════════
      B6（用户裁决「已经没有图层的概念了，就一层即可」）：**图层管理的交互代码整块删除**。
      ────────────────────────────────────────────────────────────────────────────
      删掉的（全部只被"图层管理 UI"消费，UI 没了 ⇒ 都是死代码）：
        addLayer / duplicateLayer / uniqueDuplicateLayerName / updateLayer /
        updateUsageLayerSelection / toggleUsageLayer / toggleActiveLayerOnly /
        deleteLayer / moveLayer（这个 moveLayer 是**图层重排**，与「移动」工具的
        `moveMode` 无关）/ dragTargetFromEvent / selectLayer，
        以及 `layerDisplayName` / `systemLayerName` / `startEditingLayer` /
        `saveEditingLayer` / `layerMetaText`（后者供图层行元信息文案）。
      同批删掉的状态：`editingLayerId` / `editingLayerName` / `draggingLayerId` /
        `dragTarget` / `DragTarget` 类型 / `soloVisibilitySnapshotRef`
        （它只服务 `toggleActiveLayerOnly` 的"取消 solo 时还原 visible"快照）。
  
      ▓ 为什么这是**根修**而不是打补丁：删除的是"图层管理"这一整条交互链
        （增删改名重排 / solo 只看当前层 / 计入用量选择），而不是把按钮藏起来 ——
        于是不存在"看不见但能通过别处触发"的残留入口。`dragTargetFromEvent` 此前
        连调用点都没有，`selectLayer`/`toggleActiveLayerOnly` 同样零调用点。
  
      ▓ **保留**（本批硬约束：不动数据模型、不动导出格式）：
        `project.layers`（启动时仍由 `createProject()` 建**一层**）、`createLayer`、
        `withLayers`、`composeVisibleCells`、`BeadLayer.includeInUsage` 全部原样保留 ——
        12 个纯逻辑源文件与导出产物因此零改动。
        `project.settings.showActiveLayerOnly` 是 `types.ts` 的数据模型字段（本批不可改文件），
        恒为 `false`（`createProject` 的默认值），于是原来那个 `displayProject` memo 恒等返回 `project`
        —— 该 memo 已整块删除，消费点直接用 `project`（见下方同名注释）。
      ════════════════════════════════════════════════════════════════════════════
    */
    function setBeadsPerPack(value) {
        updateProject({
            ...project,
            settings: {
                ...project.settings,
                beadsPerPack: clampInteger(value, 1, 10000),
            },
        });
    }
    function stepBeadsPerPack(direction) {
        const current = project.settings.beadsPerPack;
        const step = 500;
        const next = direction > 0
            ? current % step === 0
                ? current + step
                : Math.ceil(current / step) * step
            : current % step === 0
                ? current - step
                : Math.floor(current / step) * step;
        setBeadsPerPack(Math.max(step, next));
    }
    const layers = project.layers?.length ? project.layers : createProject(project.width, project.height).layers;
    const activeLayer = layers.find((layer) => layer.id === project.activeLayerId) ?? layers[0];
    /*
      B6：原来这里还有一行 `const countedLayers = layers.filter((layer) => layer.includeInUsage);`
      —— 它的消费方是 `toggleUsageLayer()`（图层卡的 chip 点击）与传给 `RightPanel` 的 prop，
      两者本批都删了 ⇒ 这行成了死局部变量（`tsc --noUnusedLocals` 实测报 TS6133），删除。
      ⚠️ **`BeadLayer.includeInUsage` 这个字段本身保留**：`usage.ts` / `exporters.ts` 仍在读它
         （那是 12 个纯逻辑文件里的两个，本批禁改），单层下它恒为 true ⇒ 用量统计口径不变。
    */
    useEffect(() => {
        setCopySelectionIndices([]);
        setAdjustments(defaultAdjustments);
        adjustmentSessionRef.current = { layerId: null, baseCells: [] };
    }, [activeLayer.id, project.width, project.height]);
    /*
      B6：原来这里有一个 `displayProject` memo，用 `project.settings.showActiveLayerOnly`（「只看当前图层」solo）
      把非当前层的 `visible` 置 false 再 `composeVisibleCells` 出一份"显示用"工程。
      solo 的唯一开关 `toggleActiveLayerOnly()` 已随图层管理 UI 一起删除 ⇒ 该字段恒为 false
      （`project.ts` 的 `createProject` 默认值），memo 恒等返回 `project`。
      **根修做法**：把这个"恒等的中间层"整个删掉，三处消费点直接用 `project`
      —— 留着它就是留一个"看起来还能有别的显示态"的假接口。
      注意 `adjustmentSessionRef` / `activeLayer` 仍在使用（调整/效果/换色仍作用于"当前层"，
      只是现在恒为那唯一一层），**数据模型保留**是本批硬约束。
    */
    const shapeLabel = {
        line: text.shapeLine,
        rectangle: text.shapeRectangle,
        square: text.shapeSquare,
        ellipse: text.shapeEllipse,
        circle: text.shapeCircle,
        triangle: text.shapeTriangle,
        arrow: text.shapeArrow,
    };
    const arrowLabel = {
        single: text.arrowSingle,
        double: text.arrowDouble,
        block: text.arrowBlock,
    };
    const selectedSizePreset = sizePresets.find((item) => item.width === canvasWidth && item.height === canvasHeight)?.label ?? '';
    const defaultPrintNickname = useMemo(() => {
        const date = new Date();
        const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}`;
        return language === 'zh' ? `拼豆图纸_${stamp}` : `Perler_Beads_${stamp}`;
    }, [language]);
    function exportPrintPattern() {
        const exportOptions = {
            ...printExportOptions,
            projectName: printExportOptions.projectName?.trim() || defaultPrintNickname,
            /*
              B12（KI-041）：前缀由「图层」/`'Layer'` 改为「第」/`'Pattern'` —— 与 `exporters.ts`
              的 `printLayerName()` 配套（中文得「第1张」，英文得 `Pattern 1`）。
              消费链不变：`layerLabelPrefix` 只被 `printLayerName()` 消费，而它的调用点
              `printLayerProjects()` 开头的 `if (nonEmptyLayers.length <= 1) return [{ project }]`
              决定了**单层工程（界面唯一可达形态）走不到拼层名这一步** ⇒ 这一行不影响单层产物字节，
              只影响多层草稿 / 导入 JSON 导出的 PNG/PDF 文件名与图纸标题里的层名。
            */
            layerLabelPrefix: language === 'en' ? 'Pattern' : '第',
        };
        if (printExportOptions.format === 'pdf') {
            downloadPrintPdf(project, exportOptions);
        }
        else {
            downloadPrintPng(project, exportOptions);
        }
        setShowPrintExportPanel(false);
    }
    // 「自动识别模型」状态行要显示的内容（纯展示用的派生值，不影响任何请求）
    const arkStatusLink = arkDetect.phase === 'running'
        ? undefined
        : arkDetect.phase === 'done'
            ? (arkDetect.result.kind === 'found' ? undefined : arkDetect.result.probes[arkDetect.result.probes.length - 1]?.linkKind)
            : looksLikeArkKey(aiApiKey) ? undefined : 'apiKey';
    const arkSuggestLine = arkDetect.phase === 'done' && arkDetect.result.kind === 'none'
        ? `${text.arkDetectSuggest}${arkDetect.result.probes
            .map((p) => `${p.modelId}: HTTP ${p.httpStatus ?? '-'}${p.code ? ` ${p.code}` : ''}`)
            .join(' | ')}`
        : '';
    // ——————————— 第 3 批：把手机档底部工具条的高度写成 CSS 变量 ———————————
    // 为什么必须**实测**而不是写死：手机档 `.tool-rail` 是 `flex-wrap`，行数由
    // "13 个条目 × 实宽 + 间隙 ↔ 视口宽" 决定 ⇒ 条目数/字号一变，写死的像素就会静默压住浮层
    // （第 2 批的 `.tool-options.recolor-options{bottom:120px}` 就是这个坑：它注释里自己承认
    //   "工具条行数若变化，这个值要跟着改"）。
    // 现在只有一个真值：把实测高度写成 `.app-shell` 上的 `--rail-height`，CSS 那边全部 `var()` 引用它。
    // 涉及的规则：底部抽屉的 `bottom`、遮罩的 `bottom`、工具浮层的 `bottom`（手机档全部上移到工具条之上）。
    // ⚠️ 只在手机档写：平板档的工具条是**左侧竖列**，它的高度是"整屏高"，写成变量会误导下游规则。
    useEffect(() => {
        if (!isPhoneViewport)
            return undefined;
        const rail = railRef.current;
        const shell = shellRef.current;
        if (!rail || !shell)
            return undefined;
        const apply = () => {
            const next = `${Math.round(rail.getBoundingClientRect().height)}px`;
            if (shell.style.getPropertyValue('--rail-height') !== next)
                shell.style.setProperty('--rail-height', next);
        };
        apply();
        const observer = new ResizeObserver(apply);
        observer.observe(rail);
        return () => observer.disconnect();
    }, [isPhoneViewport, panelLayout]);
    // ——————————— 第 3 批：抽屉开合的「外壳」副作用（从 `WorkspaceCanvas` 搬来）———————————
    // ① `.app-shell` 上的 `is-left-open/is-right-open` 决定 CSS 里抽屉是否滑出；
    // ② APG Dialog(Modal)：抽屉打开 ⇒ **抽屉外的一切 inert**（键盘 Tab 与读屏都进不去）。
    //    关闭时只清自己加过的（`data-panel-inert` 标记），绝不误伤别人设的属性。
    // ⚠️ 三处例外，都在下面：
    //    · `.workspace` **不能整体 inert** —— "点一下关闭"的**遮罩**就在它里面
    //      ⇒ 逐个子元素处理，跳过 `.panel-scrim`；
    //    · `.palette-dot`（B9 的圆点）**也要跳过** —— `inert` 连命中测试一起摘掉，
    //      被 inert 的圆点在任何抽屉打开时都点不动了。用户裁决后（圆点与右抽屉同层、
    //      抽屉打开时由抽屉盖住它）这一条例外**对右抽屉不再是必需的**（被盖住本来就点不到），
    //      但它对**手机档的底部浮层**仍然必需：手机档两个浮层都贴底（顶边 y=122）、
    //      盖不到右上角的圆点，被 inert 就成了"看得见、点不动"。
    //      ⚠️ B11（用户第 1 条）之后平板 / 窄窗的**两个抽屉都贴右边缘** ⇒ 那两档的圆点
    //      都被抽屉盖住，这一条例外对它们也已不是必需的（保留只为手机档）。
    //      实测证据在 `%TEMP%\b9_impl\_dbg_B9_z.cjs`。
    //    · `.tool-rail` **必须保持可交互** —— 它现在是抽屉的分区切换器（"点哪个出哪个"），
    //      被 inert 掉就再也切不了分区、也关不掉（第 3 批新加的面板条目全在它里面）。
    //      这是把 `openPanel` 提升到 `App` 的**主要原因**：在 `WorkspaceCanvas` 里看不到工具条。
    useEffect(() => {
        const shell = shellRef.current;
        if (!shell)
            return undefined;
        if (!panelLayout) {
            // 从窄档拉宽到桌面档：面板重新变回常显列 ⇒ 关掉抽屉，别让它"下次变窄时自己弹出来"。
            if (openPanel)
                setOpenPanel(null);
            shell.classList.remove('is-left-open', 'is-right-open');
            shell.querySelectorAll('[data-panel-inert]').forEach((el) => {
                el.removeAttribute('inert');
                el.removeAttribute('data-panel-inert');
            });
            return undefined;
        }
        shell.classList.toggle('is-left-open', openPanel === 'left');
        shell.classList.toggle('is-right-open', openPanel === 'right');
        if (openPanel) {
            /*
              ⚠️ B11（用户第 1 条）：**先把上一轮留下的 inert 全部摘掉，再按本次 `openPanel` 重新挂**。
              病根（**在 c721cfa 基线上同样存在**，不是本批引入；取证脚本
              `%TEMP%\b11_impl\_probe_inert.cjs`，基线/本批读数逐项相同）：
              「素材 → 颜色」这种**左→右直切**时，新打开的那个抽屉恰好是上一轮被 inert 的那个
              （上一轮它是"抽屉之外"），而本轮它是 `openPanelEl`、在下面的循环里被 `return` 跳过
              ⇒ **它身上那枚 inert 永远摘不掉**。实测（iPad 1024×768）：
              `.right-panel` 的 `inert` 仍为真、`elementFromPoint(抽屉内部)` 命中的是遮罩、
              抽屉里那枚关闭按钮 `self=false` —— 抽屉**看得见、点不动**（键盘与读屏同样进不去）。
              B11 把「素材 / 参考 / 颜色」三个条目统一成右侧抽屉之后，"开着这一个直接点那一个"
              成了主路径 ⇒ 必须根修。清一遍再挂是**幂等**的：非切换场景（先关再开）的 inert 集合
              与改前逐项相同（探针里 `afterCleanOpen` 两构建同为 9 个 inert、`rInert=false`）。
            */
            shell.querySelectorAll('[data-panel-inert]').forEach((el) => {
                el.removeAttribute('inert');
                el.removeAttribute('data-panel-inert');
            });
            const openPanelEl = shell.querySelector(openPanel === 'left' ? '.left-panel' : '.right-panel');
            const targets = [];
            Array.from(shell.children).forEach((child) => {
                if (child === openPanelEl)
                    return;
                if (child === railRef.current)
                    return;
                if (child.classList.contains('workspace')) {
                    Array.from(child.children).forEach((inner) => {
                        if (inner.classList.contains('panel-scrim'))
                            return;
                        /*
                          B9（用户第 8 条）：**圆点必须排除在 inert 之外**。它与 `.panel-scrim` 同属
                          "抽屉之外但在画布上"的那一类例外。
            
                          🔴 `inert` **不只是**"键盘/读屏进不去"，按规范它还会让元素**不参与命中测试**
                             （`elementFromPoint` 直接跳过它）。实测（`%TEMP%\b9_impl\_dbg_B9_z.cjs`，
                             iPad 1024×768、抽屉打开）：被 inert 的圆点，`elementFromPoint(圆心)` 命中的
                             是抽屉里的 `.palette-selected-card`，圆点自命中 = false —— 这是"层级明明更高
                             却没生效"的真因（不是层叠问题，是命中测试被 inert 摘掉了）。
            
                          ⚠️ 用户 2026-09-21 裁决后，圆点与右抽屉同层、**抽屉打开时由抽屉盖住圆点**
                             （见 `styles.css` 的 `.palette-dot`）⇒ 这一条例外对**右抽屉**已不是必需
                             （被盖住本来就点不到）。保留它是因为**手机档**那两种抽屉没盖住圆点：
                             · **手机档的左 / 右抽屉**：它们都贴底（`bottom: var(--rail-height)`、
                               `max-height: min(78dvh, 620px)` ⇒ 顶边 y=122），盖不到圆点（y 75..119）；
                             · ⚠️ B11（用户第 1 条）之后**平板 / 窄窗的左抽屉也贴右边缘**、与右抽屉一样
                               会盖住圆点 —— 这一条例外对那两档同样不再是必需的，留着只为手机档。
                             被 inert 就变成"看得见、点不动"，而圆点此时确实是个可用按钮。
                             代价：键盘 Tab 顺序里多一站 —— 这是**预期的**。
                        */
                        if (inner === paletteDotRef.current)
                            return;
                        targets.push(inner);
                    });
                    return;
                }
                targets.push(child);
            });
            targets.forEach((el) => {
                el.setAttribute('inert', '');
                el.setAttribute('data-panel-inert', '');
            });
        }
        else {
            shell.querySelectorAll('[data-panel-inert]').forEach((el) => {
                el.removeAttribute('inert');
                el.removeAttribute('data-panel-inert');
            });
        }
        return undefined;
    }, [openPanel, panelLayout]);
    // ————————— B9（用户第 8 条）：圆点入口的三条**关闭路径**（全部写死在这里）—————————
    //
    // 用户裁决：手机上圆点展开会挡住大半画布，但「选色时不绘制、选完即关」可接受
    // ⇒ **真风险是关闭路径漏一条**。所以三条各有一段可独立验证的代码，不靠"用户会自己关"：
    //   ① 真事件选中一个颜色 ⇒ `selectColor()` 里关（见下，全仓唯一的选色入口就是它）；
    //   ② 点抽屉/圆点**之外** ⇒ 本 effect 的 document `pointerdown` 监听（冒泡阶段）；
    //   ③ 画布上 `pointerdown` ⇒ 同一条监听即可命中：`.canvas` 在 `.workspace` 里，
    //      既不是圆点、也不是抽屉 ⇒ 落到 `setPaletteDotOpen(false)`。
    //      ② 与 ③ 共用一个监听是**结构上的正确**而不是偷懒：画布就是"外面"的一种，
    //      拆成两个监听只会让"外面"的定义出现两份、迟早漂移。门禁里两条**分别**断言
    //      （② 用顶栏空白处、③ 用 `.canvas` 中心），并各自记录关闭前后的可见性读数。
    //
    // ⚠️ 打开/关闭的**唯一出口**是圆点自己（`onPaletteDotClick`）。外面这三条只关**圆点**，
    //    **不动 `openPanel`**：右抽屉本来就有一个「颜色」面板条目负责开合，两条路各管各的，
    //    不互相打架（在画布上落笔只是想放下色盘，不是想把抽屉也收掉）。
    React.useEffect(() => {
        if (!paletteDotOpen)
            return undefined;
        const onPointerDown = (event) => {
            const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
            const insideDot = path.includes(paletteDotRef.current);
            // ⚠️ B10：**浮层本体也必须算"里面"**。它现在承载整块色盘（分组筛选 / 最近使用 /
            //    网格），漏掉这一条 ⇒ 点一下分组筛选，浮层就在 pointerdown 阶段被关掉，
            //    筛选按钮的 click 永远不会发生（"点开就关"这种回归最难在肉眼上归因）。
            const insidePopover = path.includes(palettePopoverRef.current);
            // 抽屉本体**现查**（`RightPanel` 不接受 ref，且它在 `.app-shell` 里恒定存在）：
            // 点抽屉里的色块 = 路径①，不能在这里先关掉（否则 `elementFromPoint` 那一步会扑空）。
            const panel = document.querySelector('.right-panel');
            const insidePanel = panel ? path.includes(panel) : false;
            if (insideDot || insidePopover || insidePanel)
                return;
            setPaletteDotOpen(false);
        };
        document.addEventListener('pointerdown', onPointerDown);
        return () => document.removeEventListener('pointerdown', onPointerDown);
    }, [paletteDotOpen]);
    /**
     * B15（用户第 7 条）：**点浮层之外 ⇒ 关掉工具浮层**（触屏也要能关）。
     *
     * 为什么必须有这一条：8 个工具浮层一直只有 `onMouseLeave` 与"换工具/开面板"三条关法，
     * 而 `onMouseLeave` 在触屏上**永远不会触发**（手指没有 hover 语义）⇒ iPad 上除了"再点别的工具"，
     * 关不掉浮层。用户体验上正确的关法是「点窗口之外」——所以先把这条路修好，
     * **再把「文字」浮层里那个突兀的 ✕ 删掉**（同一批，见用户第 7 条）。
     *
     * 判据（三条都排除）：
     *   · 点在 `.tool-options-layer` 里 ⇒ 是在浮层内部操作（浮层就挂在这一层里）；
     *   · 点在 `.tool-rail` 里 ⇒ 是工具条/面板条目自己（它们各有各的语义：换工具、开合抽屉），
     *     不能在这里抢先关掉——否则"点当前工具想收起浮层"会变成"关了又开"；
     *   · 点在**画布区（`.workspace`）**里 ⇒ 画布上的那一下有它自己的语义（落笔 / 放文字 /
     *     吸管取色 / 拖框），而且「文字」工具**故意**在画布落字后保持编辑器开着（`onCommitStart`
     *     里 `setShowTextOptions(tool === 'text')`）⇒ 在这里抢先关掉只会被立刻重新打开，
     *     表现成"点了没反应"，比不关更糟。
     * 其余任何地方（顶栏、参数条、抽屉、圆点）按下即收起。
     *
     * ⚠️ 只在**有浮层开着**时才挂监听（`anyToolOptionsOpen`）；否则每次点画布都要跑一遍判断。
     * ⚠️ 桌面档照旧可用（鼠标点空白处也会关，与 `onMouseLeave` 同向，不冲突）。
     */
    React.useEffect(() => {
        if (!anyToolOptionsOpen)
            return undefined;
        const onPointerDown = (event) => {
            const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
            const inAny = (cls) => path.some((n) => n instanceof Element && n.classList.contains(cls));
            if (inAny('tool-options-layer') || inAny('tool-rail') || inAny('workspace'))
                return;
            closeAllToolOptions();
        };
        document.addEventListener('pointerdown', onPointerDown);
        return () => document.removeEventListener('pointerdown', onPointerDown);
    }, [anyToolOptionsOpen]);
    /**
     * 圆点入口与抽屉的**单向同步**：抽屉被别的出口打开（遮罩下点不到、抽屉内关闭按钮、
     * 工具条上的「素材 / 参考 / 颜色」条目）⇒ 色盘浮层必须跟着收起，否则它会显示成"打开着"
     * 而屏幕上被抽屉压着（抽屉档的抽屉是整高/整宽的，正好盖住浮层所在的那块）。
     *
     * ⚠️ B10 改过判据（旧版是 `openPanel !== 'right' || rightTab !== 'palette'`）：
     *    抽屉档的右抽屉里**已经没有「调色盘」tab**（只剩「用量」，见 `RightPanel.drawerMode`），
     *    `rightTab` 会一直停在缺省值 ⇒ 旧判据**永不触发**，等于这条同步整条失效。
     *    改成只看 `openPanel === 'right'`：右抽屉一开，色盘浮层必收。
     * ⚠️ **B14 修 KI-045：判据从"只认右抽屉"扩到"任意抽屉"**。理由与 `onPaletteDotClick()`
     *    里那段相同（层叠上下文决定浮层出不了 `.tool-options-layer`，必然被抽屉盖住）：
     *    只要还有**任何一个**抽屉开着，浮层就是"看得见点不动"的死角 ⇒ 这条同步必须管全部抽屉。
     *    反方向（点圆点 ⇒ 抽屉让位）在 `onPaletteDotClick()` 里，两处合起来才是不变量：
     *    **「色盘浮层开着」与「有抽屉开着」永远不同时成立**。
     * ⚠️ 桌面档 `openPanel` 恒为 `null`（面板入口只在抽屉档渲染）⇒ 这条在桌面是空操作，
     *    桌面 DOM/像素 Δ=0 不受影响。
     * ⚠️ 依赖里**没有** `paletteDotOpen`：本条只读 `openPanel`，
     *    写 `setPaletteDotOpen(false)` 在值不变时 React 会 bail out，不会成环。
     */
    React.useEffect(() => {
        if (openPanel)
            setPaletteDotOpen(false);
    }, [openPanel]);
    /*
     * B9：**这里原来有一段「右抽屉占宽」的 effect**（把面板实测宽度写进 `.app-shell` 的
     * `--right-drawer-w`，好让 `styles.css` 在抽屉打开时把圆点**左移到抽屉左边缘之外**）。
     * 2026-09-21 按**用户最新裁决**删除：
     *
     *   > 「抽屉打开时挡住圆点即可，因为打开抽屉时不用色盘」
     *
     * ⇒ 圆点**始终停在画布右上角原位**（`right: 14px` / 手机 8px），不做任何让位。
     *   抽屉打开时圆点被抽屉盖住是**用户明确接受的**（那时不需要色盘）。
     *   连带删掉的还有 `styles.css` 里那条 `@media (min-width: 768px){ .app-shell.is-right-open
     *   .palette-dot { left: calc(...) } }` 与手机块里为它配的 `left: auto`。
     *
     * ⚠️ 上一轮那条注释里写的"圆心落在「调色盘」tab 命中区里"**经本轮复测不成立**：
     *   iPad 1024×768 抽屉打开时，圆点 rect `x=966..1010`，而两个 tab 在 `x=677..841.5`
     *   （左对齐、不出抽屉内容区）⇒ 与 tab **零重叠**。让位逻辑是照着一句没有实测支撑的判断写的。
     *   圆点唯一真正压住的是**色盘网格右上角那一小块**，见 `styles.css` 里 `.palette-dot` 的
     *   `z-index` 段与门禁 `_verify_B9b.cjs` 的 C7/C9（逐 swatch 命中统计 + `elementsFromPoint` 叠层）。
     */
    // ————————————————— W1 顶栏槽位：ifRoom 溢出（决策16 / Material `ifRoom`）—————————————————
    // 规则：`document`（撤销/重做）**永不降级**；`actions`（导出组）放不下时进「更多」；
    // **桌面不主动藏** —— 判据是**实测**（导出组的自然宽度 vs 该槽位实得宽度），不是断点。
    //
    // ⚠️ 为什么是「槽位级 ifRoom」而不是逐个按钮从右往左收：
    //    `.export-actions` 是 `ExportPanel.tsx` 自己的根节点，该文件本轮**不许改**、也不接受
    //    className/ref ⇒ App 既没法把「更多」按钮插到那个组内部，也没法知道组内每个按钮的
    //    实得宽度。所以只做到「整个导出组放不下 ⇒ 整体进更多」，逐个按钮的顺序溢出**没做到**，
    //    如实记在交付说明里。
    const topbarRef = useRef(null);
    const actionsSlotRef = useRef(null);
    const actionsWrapRef = useRef(null);
    const [actionsCollapsed, setActionsCollapsed] = useState(false);
    const [moreOpen, setMoreOpen] = useState(false);
    // 「更多」的文案：本轮**不许动 i18n.tsx**（新增 key 不是我的权限范围）⇒ 用
    // 与 `.panel-toggle` 同一个先例（中英并排/三元）就地取词；补 key 的事记在交付说明里给 W5。
    const moreLabel = language === 'zh' ? '更多操作' : 'More actions';
    React.useLayoutEffect(() => {
        const measure = () => {
            const header = topbarRef.current;
            const slot = actionsSlotRef.current;
            const wrap = actionsWrapRef.current;
            if (!header || !slot || !wrap)
                return;
            // 折叠态下（关着「更多」时）CSS 把导出组 `display:none` 了，量不到自然宽度 ⇒
            // 先摘掉折叠类再量，量完立刻恢复。整段都在**本帧绘制之前**完成，不会闪。
            const wasCollapsed = header.classList.contains('is-actions-collapsed');
            if (wasCollapsed)
                header.classList.remove('is-actions-collapsed');
            const natural = wrap.getBoundingClientRect().width;
            const available = slot.clientWidth;
            if (wasCollapsed)
                header.classList.add('is-actions-collapsed');
            const overflow = natural - available > 1;
            setActionsCollapsed((prev) => (prev === overflow ? prev : overflow));
            if (!overflow)
                setMoreOpen((prev) => (prev ? false : prev));
        };
        measure();
        const raf = window.requestAnimationFrame(measure);
        const observer = new ResizeObserver(measure);
        const header = topbarRef.current;
        if (header) {
            Array.from(header.children).forEach((child) => observer.observe(child));
            observer.observe(header);
        }
        window.addEventListener('resize', measure);
        if (document.fonts?.ready)
            document.fonts.ready.then(measure).catch(() => undefined);
        return () => {
            window.cancelAnimationFrame(raf);
            observer.disconnect();
            window.removeEventListener('resize', measure);
        };
        // `text` 换语言即变（中/英按钮宽度不同）⇒ 必须重量。
    }, [language, text]);
    useEffect(() => {
        if (!moreOpen)
            return undefined;
        const onKeyDown = (event) => {
            if (event.key === 'Escape') {
                // Esc 一起关掉**内层**的导出设置浮层：折叠态下它是从「更多」里点开的，
                // 只关外层会留下一个悬空的内层浮层。桌面端「更多」不出现 ⇒ 这段不生效，
                // 内层浮层的开合仍由它自己的关闭按钮决定（与改动前一致）。
                setMoreOpen(false);
                setShowPrintExportPanel(false);
            }
        };
        const onPointerDown = (event) => {
            const slot = actionsSlotRef.current;
            if (slot && event.target instanceof Node && !slot.contains(event.target))
                setMoreOpen(false);
        };
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('pointerdown', onPointerDown);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('pointerdown', onPointerDown);
        };
    }, [moreOpen]);
    /**
     * B16（用户第 15 轮第 2 条）：「参数调节」卡片抽成一块。
     *   · 桌面档（`panelLayout === false`）⇒ 仍在左栏原位渲染（`{!panelLayout && paramsCardNode}`），位置与内容一字不动；
     *   · 抽屉档（iPad）⇒ 整块交给右抽屉渲染（`<RightPanel paramsCard={paramsCardNode} />` 的 `.params-drawer-slot`），
     *     用户要求"参数调节跟颜色工具合并、不要挤在上传卡里"。
     * ⚠️ 卡片只此一份（不是复制两份）⇒ 改参数的行为了只有一处。
     */
    const paramsCardNode = (React.createElement("section", { className: "left-card params-card" },
        React.createElement("div", { className: "left-card-header" },
            React.createElement("div", null,
                React.createElement("strong", { className: "field-label-with-help" },
                    text.patternParams,
                    React.createElement("span", { className: "help-dot image-help-dot", ...imageHelpProps(text.autoRefreshHint) }, "?"))),
            React.createElement("small", null, text.paramsLocalNote)),
        React.createElement("div", { className: "param-rows" },
            React.createElement("label", { className: "param-row" },
                React.createElement("span", { className: "field-label-with-help" }, text.width),
                React.createElement("input", { "aria-label": "Output width", type: "range", min: 8, max: 180, step: 1, value: convertWidth, onChange: (event) => {
                        // 拖滑条：数字跟着走（widthInput 只是编辑态的文本缓冲，这里同步给它）
                        const next = Number(event.target.value);
                        setConvertWidth(next);
                        setWidthInput(String(next));
                    } }),
                React.createElement(ParamNumberField, { ariaLabel: "Output width", value: convertWidth, min: 8, max: 180, text: widthInput, onTextChange: (raw) => {
                        // 保留下来的「宽度文本态」逻辑：允许中间态为空（用户正在删），
                        // 非法值立刻退回上一档有效值，去掉多余前导零（"052" → "52"）。
                        // 注意：这里不再像以前那样边打字边改 convertWidth —— 现在滑条和数字
                        // 都只在提交（回车/失焦）时生效，Esc 才能真的还原成原值。
                        if (raw === '') {
                            setWidthInput('');
                            return;
                        }
                        const n = Number(raw);
                        if (!Number.isFinite(n)) {
                            setWidthInput(String(convertWidth));
                            return;
                        }
                        setWidthInput(String(Math.floor(n)).replace(/^0+(?=\d)/, ''));
                    }, onCommit: (next) => {
                        // 失焦/回车时把空值、非法值纠正成一个真实可用的宽度（绝不会是 0）
                        const fallback = Number.isFinite(convertWidth) && convertWidth >= 1
                            ? convertWidth
                            : defaultImportSettings.width;
                        const final = Number.isFinite(next) && next >= 8
                            ? Math.max(8, Math.min(180, Math.floor(next)))
                            : fallback;
                        setConvertWidth(final);
                        setWidthInput(String(final));
                    } })),
            React.createElement("label", { className: "param-row" },
                React.createElement("span", { className: "field-label-with-help" }, text.colors),
                React.createElement("input", { "aria-label": "Color limit", type: "range", min: 6, max: 48, step: 1, value: maxColors, onChange: (event) => setMaxColors(Number(event.target.value)) }),
                React.createElement(ParamNumberField, { ariaLabel: "Color limit", value: maxColors, min: 6, max: 48, onCommit: setMaxColors })),
            React.createElement("label", { className: "param-row" },
                React.createElement("span", { className: "field-label-with-help" },
                    text.tolerance,
                    React.createElement("span", { className: "help-dot image-help-dot", ...imageHelpProps(text.toleranceHint) }, "?")),
                React.createElement("input", { "aria-label": "Background tolerance", type: "range", min: 0, max: 120, step: 1, value: tolerance, onChange: (event) => {
                        const next = Number(event.target.value);
                        setTolerance(next);
                        // 用户手动调过之后不再自动校准，滑条值就是实际值
                        setToleranceManual(true);
                    } }),
                React.createElement(ParamNumberField, { ariaLabel: "Background tolerance", value: tolerance, min: 0, max: 120, onCommit: (next) => {
                        setTolerance(next);
                        // 用数字编辑和拖滑条一样算「手动设置」：否则自动校准会把这个值覆盖掉
                        setToleranceManual(true);
                    } })),
            React.createElement("p", { className: "param-note" }, toleranceManual
                ? text.toleranceManualNote
                : text.toleranceAutoNote.replace('{v}', String(tolerance))),
            React.createElement("label", { className: "param-row" },
                React.createElement("span", null, text.background),
                React.createElement("select", { "aria-label": "Background handling", value: backgroundMode, onChange: (event) => setBackgroundMode(event.target.value) },
                    React.createElement("option", { value: "keep" }, text.keepBackground),
                    React.createElement("option", { value: "remove-white" }, text.removeWhite))),
            panelLayout && (React.createElement("div", { className: "params-brand-slot", "data-params-brand": "1" }, brandSelect)))));
    return (React.createElement("main", { ref: shellRef, className: "app-shell", onDragOver: (event) => event.preventDefault(), onDrop: (event) => {
            event.preventDefault();
            const file = [...event.dataTransfer.files].find((item) => item.type.startsWith('image/'));
            if (file)
                handleImageFile(file);
        } },
        React.createElement("input", { ref: fileInputRef, className: "hidden-input", type: "file", accept: "image/png,image/jpeg,image/webp", onChange: (event) => {
                const file = event.currentTarget.files?.[0];
                if (file)
                    handleImageFile(file);
                event.currentTarget.value = '';
            } }),
        React.createElement("input", { ref: referenceInputRef, className: "hidden-input", type: "file", accept: "image/png,image/jpeg,image/webp", onChange: (event) => {
                const file = event.currentTarget.files?.[0];
                if (file)
                    handleReferenceImageFile(file);
                event.currentTarget.value = '';
            } }),
        React.createElement("input", { ref: jsonInputRef, className: "hidden-input", type: "file", accept: "application/json,.json", onChange: (event) => {
                const file = event.currentTarget.files?.[0];
                // W6 阶段 B：导入 JSON 失败（unreadableRecord / invalidRecord）是**失败**，
                // 必须一起标错误，否则会渲染成 `role="status"`（阶段 A 报告 §3.3 记的第 2 处缺口）。
                if (file) {
                    importJson(file).catch((error) => {
                        setNoticeIsError(true);
                        setNotice(error.message);
                    });
                }
                event.currentTarget.value = '';
            } }),
        React.createElement("header", { ref: topbarRef, className: `topbar${actionsCollapsed ? ' is-actions-collapsed' : ''}${moreOpen ? ' is-more-open' : ''}` },
            React.createElement("div", { className: "topbar-slot topbar-slot--title", "data-slot": "title" },
                React.createElement("div", { className: "brand-lockup", "aria-label": text.appName },
                    React.createElement("img", { className: "logo-mark", src: "./assets/logo.png", alt: "", "aria-hidden": "true" }),
                    React.createElement("div", null,
                        React.createElement("strong", null, text.appName),
                        React.createElement("small", null, text.status(project.width, project.height, totalBeads, usage.length))))),
            React.createElement("div", { className: "topbar-slot topbar-slot--params", "data-slot": "params" },
                React.createElement("div", { className: "topbar-params canvas-params", "aria-label": "Canvas controls", title: text.canvasSizeHelp },
                    React.createElement("span", { className: "topbar-control-label" }, text.board),
                    React.createElement("div", { className: "topbar-dimension-group" },
                        React.createElement("input", { "aria-label": "Canvas width", type: "number", min: 8, max: 180, value: canvasWidth, onChange: (event) => setCanvasWidth(Number(event.target.value)) }),
                        React.createElement("span", { className: "size-times" }, "\u00D7"),
                        React.createElement("input", { "aria-label": "Canvas height", type: "number", min: 8, max: 180, value: canvasHeight, onChange: (event) => setCanvasHeight(Number(event.target.value)) })),
                    React.createElement("select", { className: "canvas-preset-select", "aria-label": "Canvas preset", value: selectedSizePreset || '', onChange: (event) => applyPreset(event.target.value) },
                        React.createElement("option", { value: "", disabled: true, hidden: true }, text.commonSizes),
                        sizePresets.map((preset) => (React.createElement("option", { key: preset.label, value: preset.label }, preset.label)))),
                    React.createElement("button", { className: "canvas-apply-button", onClick: resizeCanvas }, text.apply))),
            React.createElement("div", { className: "topbar-slot topbar-slot--document", "data-slot": "document" },
                React.createElement("div", { className: "topbar-actions document-actions" },
                    React.createElement("button", { type: "button", className: "project-action-button history-action", onClick: undo, disabled: past.length === 0, "aria-label": text.undo, title: text.undo },
                        React.createElement(UndoIcon, null)),
                    React.createElement("button", { type: "button", className: "project-action-button history-action", onClick: redo, disabled: future.length === 0, "aria-label": text.redo, title: text.redo },
                        React.createElement(RedoIcon, null)))),
            React.createElement("div", { className: "topbar-slot topbar-slot--actions", "data-slot": "actions", ref: actionsSlotRef },
                React.createElement("button", { type: "button", className: "topbar-more-button", "aria-haspopup": "true", "aria-expanded": moreOpen, "aria-label": moreLabel, title: moreLabel, onClick: () => setMoreOpen((value) => !value) },
                    React.createElement("span", null, language === 'zh' ? '更多' : 'More'),
                    React.createElement("span", { className: "topbar-more-caret", "aria-hidden": "true" }, "\u25BE")),
                React.createElement("div", { className: "topbar-actions-wrap", ref: actionsWrapRef },
                    React.createElement(ExportPanel, { text: text, showPrintExportPanel: showPrintExportPanel, setShowPrintExportPanel: setShowPrintExportPanel, printExportOptions: printExportOptions, setPrintExportOptions: setPrintExportOptions, defaultPrintNickname: defaultPrintNickname, exportPrintPattern: exportPrintPattern, exportUsageList: exportUsageList, exportEditRecord: exportEditRecord, jsonInputRef: jsonInputRef }))),
            React.createElement("div", { className: "topbar-slot topbar-slot--trailing", "data-slot": "trailing" },
                React.createElement("div", { className: "topbar-right" },
                    React.createElement("a", { className: "github-link", href: "https://github.com/Jett-Wu/Perler_Beads_Generator", target: "_blank", rel: "noreferrer", "aria-label": "GitHub", title: "GitHub" },
                        React.createElement(GitHubIcon, null),
                        React.createElement("span", null, "GitHub")),
                    React.createElement("div", { className: "language-toggle", "aria-label": text.language },
                        React.createElement("button", { className: language === 'zh' ? 'active' : '', onClick: () => setLanguage('zh') }, "\u4E2D"),
                        React.createElement("button", { className: language === 'en' ? 'active' : '', onClick: () => setLanguage('en') }, "EN"))))),
        React.createElement("aside", { className: "left-panel", "data-left-section": panelLayout ? leftSection : 'all' },
            (!panelLayout || leftSection === 'material') && (React.createElement(React.Fragment, null,
                !panelLayout && (React.createElement("section", { className: "left-card preview-card" },
                    React.createElement("div", { className: "left-card-header" },
                        React.createElement("div", null,
                            React.createElement("strong", null, text.preview3d),
                            React.createElement("span", null, text.liveBoard)),
                        React.createElement("small", null,
                            totalBeads,
                            " ",
                            language === 'zh' ? '颗' : 'beads')),
                    React.createElement(ThreePreview, { project: project, title: text.preview3d, emptyLabel: text.previewEmpty, closeLabel: text.close, expandLabel: text.expandPreview }))),
                React.createElement("section", { className: "left-card image-card upload-card" },
                    React.createElement("div", { className: "left-card-header" },
                        React.createElement("div", null,
                            React.createElement("strong", { className: "field-label-with-help" },
                                text.imageToPattern,
                                React.createElement("span", { className: "help-dot image-help-dot", ...imageHelpProps(text.autoGenerateHintArmed) }, "?"))),
                        React.createElement("small", { "data-source-image-state": sourceImageLoading ? 'loading' : pendingFile ? 'ready' : 'empty', "data-source-image-persist": persistMode, title: persistNotice ?? undefined }, sourceImageLoading
                            ? text.restoringImage
                            : persistMode === 'memory' && pendingFile
                                ? text.sourceImageSessionOnly
                                : pendingFile ? text.ready : text.noImage)),
                    React.createElement("button", { className: pendingImageUrl ? `upload-zone has-image${isGenerating ? ' is-generating' : ''}` : `upload-zone${isGenerating ? ' is-generating' : ''}`, onClick: () => fileInputRef.current?.click() },
                        pendingImageUrl && React.createElement("img", { src: pendingImageUrl, alt: "" }),
                        React.createElement("span", { className: "upload-zone-text" },
                            React.createElement("strong", null, isGenerating ? text.preparingPattern : pendingFile ? pendingFile.name : text.uploadImage),
                            React.createElement("span", null, isGenerating ? pendingFile?.name : pendingFile ? 'PNG / JPG / WebP' : 'PNG, JPG, WebP')))),
                React.createElement("section", { className: "left-card ai-card" },
                    React.createElement("div", { className: "left-card-header" },
                        React.createElement("div", null,
                            React.createElement("strong", { className: "field-label-with-help" },
                                text.aiRedrawTitle,
                                React.createElement("span", { className: "help-dot image-help-dot", ...imageHelpProps(text.aiRedrawHint) }, "?"))),
                        React.createElement("small", { className: "ai-redraw-cost" }, text.aiRedrawCost)),
                    React.createElement("div", { className: "ai-redraw-row" },
                        aiResultUrl ? (React.createElement("img", { className: "ai-redraw-thumb", src: aiResultUrl, alt: "" })) : (React.createElement("span", { className: "ai-redraw-thumb is-empty", "aria-hidden": "true" })),
                        React.createElement("label", { className: "stacked-field ai-redraw-bg-field" },
                            React.createElement("span", null, text.aiBackground),
                            React.createElement("select", { "aria-label": "AI background handling", value: backgroundMode, onChange: (event) => setBackgroundMode(event.target.value) },
                                React.createElement("option", { value: "keep" }, text.keepBackground),
                                React.createElement("option", { value: "remove-white" }, text.removeWhite))),
                        React.createElement("label", { className: "stacked-field ai-redraw-key" },
                            React.createElement("span", null, text.aiRedrawKeyLabel),
                            React.createElement("input", { type: "password", value: aiApiKey, placeholder: text.aiRedrawKeyPlaceholder, onChange: (event) => {
                                    const value = event.target.value;
                                    setAiApiKey(value);
                                    localStorage.setItem('ark-api-key', value);
                                } }))),
                    React.createElement("div", { className: `ai-detect is-${arkDetect.phase === 'running' ? 'running' : arkDetect.phase === 'done' && arkDetect.result.kind === 'found' ? 'ok' : 'warn'}` },
                        React.createElement("p", { className: "ai-detect-status" },
                            arkDetect.phase === 'running' && text.arkDetectRunning,
                            arkDetect.phase === 'done' && arkDetect.result.kind === 'found'
                                && `${text.arkDetectFound}${arkDetect.result.modelId}${text.arkDetectFoundTail}`,
                            arkDetect.phase === 'done' && arkDetect.result.kind !== 'found'
                                && arkDetect.result.probes[arkDetect.result.probes.length - 1]?.status === 'model-not-found'
                                && text.arkDetectNotFound,
                            arkDetect.phase === 'done' && arkDetect.result.kind !== 'found'
                                && arkDetect.result.probes[arkDetect.result.probes.length - 1]?.status === 'model-not-open'
                                && text.arkDetectNotOpen,
                            arkDetect.phase === 'done' && arkDetect.result.kind !== 'found'
                                && !['model-not-found', 'model-not-open'].includes(String(arkDetect.result.probes[arkDetect.result.probes.length - 1]?.status))
                                && text.arkDetectBadKey,
                            arkDetect.phase === 'idle' && (looksLikeArkKey(aiApiKey) ? text.arkDetectHint : text.arkDetectNeedKey)),
                        React.createElement("div", { className: "ai-detect-row" },
                            React.createElement("button", { type: "button", className: "ai-detect-retry", disabled: arkDetect.phase === 'running' || !looksLikeArkKey(aiApiKey), onClick: () => { void runArkDetect(aiApiKey); } }, text.arkDetectRetry),
                            arkStatusLink && (React.createElement("a", { className: "ai-detect-link", href: ARK_LINKS[arkStatusLink], target: "_blank", rel: "noreferrer" }, arkStatusLink === 'apiKey' ? text.arkDetectGetKey : text.arkDetectGetModel))),
                        arkDetect.phase === 'done' && arkDetect.result.kind === 'error' && (React.createElement("small", { className: "ai-detect-raw" }, formatRawBits(arkDetect.result.probes[arkDetect.result.probes.length - 1].raw))),
                        arkSuggestLine && React.createElement("small", { className: "ai-detect-raw" }, arkSuggestLine)),
                    React.createElement("div", { className: "ai-model-block is-always" },
                        React.createElement("div", { className: "ai-model-head" },
                            React.createElement("span", { className: "ai-model-head-label" }, text.aiModelLabel),
                            aiModelAuto && React.createElement("em", { className: "ai-model-auto" }, text.arkDetectAuto),
                            React.createElement("button", { type: "button", className: "ai-model-more", "aria-expanded": aiModelOpen, onClick: () => setAiModelOpen((v) => !v) },
                                text.aiModelMore,
                                " ",
                                aiModelOpen ? '▴' : '▾')),
                        React.createElement("input", { "aria-label": "Ark model id", list: "ark-model-presets", value: aiModel, placeholder: DEFAULT_AI_MODEL, onChange: (event) => {
                                const value = event.target.value;
                                setAiModel(value);
                                setAiModelAuto(false);
                                localStorage.setItem('ark-model', value);
                            } }),
                        React.createElement("datalist", { id: "ark-model-presets" }, ARK_MODEL_CANDIDATES.map((m) => React.createElement("option", { key: m, value: m }))),
                        aiModelOpen && React.createElement("small", null, text.aiModelHint)),
                    aiHistory.length > 0 && (React.createElement("div", { className: "ai-history" },
                        React.createElement("span", { className: "ai-history-label" },
                            React.createElement("em", null, aiHistory.length),
                            text.aiHistoryLabel),
                        React.createElement("div", { className: "ai-history-strip" }, aiHistory.map((item, index) => (React.createElement("button", { key: index, type: "button", className: `ai-history-item${index === aiHistoryIndex ? ' active' : ''}${item.isOriginal ? ' is-original' : ''}`, title: item.isOriginal
                                ? text.aiHistoryOriginal
                                : `${text.aiHistoryTitle} ${index} · ${item.bg === 'keep' ? text.keepBackground : text.removeWhite}`, disabled: aiRedrawing || isGenerating, onClick: () => selectHistoryEntry(index) },
                            React.createElement("img", { src: item.url, alt: item.isOriginal ? text.aiHistoryOriginal : `${index}` }),
                            React.createElement("span", { className: "ai-history-no" }, item.isOriginal ? text.aiHistoryOriginalShort : index))))))),
                    aiRedrawing && (React.createElement("div", { className: "ai-redraw-progress" },
                        React.createElement("span", { className: "ai-redraw-spinner" }),
                        React.createElement("strong", null, text.aiRedrawRunning))),
                    React.createElement("div", { className: "ai-redraw-actions" },
                        React.createElement("button", { type: "button", className: "ai-redraw-start", disabled: !pendingFile || aiRedrawing || isGenerating, onClick: () => void generateFromImage({ recordHistory: true, forceAiRedraw: true }), title: text.aiRedrawCost }, aiRedrawing
                            ? text.aiRedrawRunning
                            : aiHistory.length > 1
                                ? text.aiRedrawRegenerate
                                : text.aiRedrawStart))),
                !panelLayout && paramsCardNode)),
            (!panelLayout || leftSection === 'reference') && (React.createElement("section", { className: "left-card reference-card" },
                React.createElement("div", { className: "left-card-header" },
                    React.createElement("div", null,
                        React.createElement("strong", null, text.referenceImage),
                        React.createElement("span", null, text.referenceHint)),
                    React.createElement("small", null, referenceImageUrl ? text.ready : text.noImage)),
                React.createElement("button", { className: referenceImageUrl ? 'upload-zone reference-upload-zone has-image' : 'upload-zone reference-upload-zone', onClick: () => referenceInputRef.current?.click() },
                    referenceImageUrl && React.createElement("img", { src: referenceImageUrl, alt: "" }),
                    React.createElement("span", { className: "upload-zone-text" },
                        React.createElement("strong", null, referenceFile ? referenceFile.name : text.uploadReferenceImage),
                        React.createElement("span", null, referenceFile ? 'PNG / JPG / WebP' : 'PNG, JPG, WebP'))),
                React.createElement("label", { className: "ref-row ref-row-switch" },
                    React.createElement("span", null, text.showReferenceImage),
                    React.createElement("input", { type: "checkbox", checked: referenceVisible, disabled: !referenceImageUrl, onChange: (event) => setReferenceVisible(event.target.checked) })),
                React.createElement("label", { className: "ref-row" },
                    React.createElement("span", null, text.referenceOpacity),
                    React.createElement("input", { "aria-label": "Reference opacity", type: "range", min: 0.1, max: 0.95, step: 0.05, value: 1 - referenceOpacity, disabled: !referenceImageUrl || !referenceVisible, onChange: (event) => setReferenceOpacity(1 - Number(event.target.value)) }),
                    React.createElement("strong", null,
                        Math.round((1 - referenceOpacity) * 100),
                        "%")),
                React.createElement("label", { className: "ref-row ref-row-switch" },
                    React.createElement("span", null, text.referenceAdjust),
                    React.createElement("input", { type: "checkbox", checked: referenceAdjusting, disabled: !referenceImageUrl || !referenceVisible, onChange: (event) => setReferenceAdjusting(event.target.checked) })),
                React.createElement("div", { className: "ref-row ref-row-actions" },
                    React.createElement("span", null, text.referencePlacement),
                    React.createElement("div", { className: "reference-placement-toggle", "aria-label": text.referencePlacement },
                        React.createElement("button", { type: "button", className: referencePlacement === 'below' ? 'active' : '', disabled: !referenceImageUrl, "aria-pressed": referencePlacement === 'below', onClick: () => setReferencePlacement('below') }, text.referenceBelow),
                        React.createElement("button", { type: "button", className: referencePlacement === 'above' ? 'active' : '', disabled: !referenceImageUrl, "aria-pressed": referencePlacement === 'above', onClick: () => setReferencePlacement('above') }, text.referenceAbove)),
                    React.createElement("button", { type: "button", className: "reference-reset-button", disabled: !referenceImageUrl, onClick: resetReferenceTransform }, text.resetReferenceTransform))))),
        React.createElement("aside", { className: "tool-rail", ref: railRef },
            panelLayout && PANEL_ENTRIES.map((entry) => {
                const isOpen = openPanel === entry.panel
                    && (entry.section === null || leftSection === entry.section)
                    && (entry.rightTab === undefined || rightTab === entry.rightTab);
                return (React.createElement("button", { key: entry.id, className: isOpen ? 'tool-button panel-entry active' : 'tool-button panel-entry', "data-panel-entry": entry.id, "aria-label": text.panelEntries[entry.id], title: text.panelEntries[entry.id], "aria-expanded": isOpen, type: "button", onClick: () => {
                        // 「点哪个出哪个」：同一条目再点一次 = 收起；否则打开目标面板并切到那一段。
                        if (isOpen) {
                            setOpenPanel(null);
                            return;
                        }
                        // 先把工具浮层收掉：开着抽屉时它们本该不可用，留着也会压在抽屉边上。
                        // （第 6 批之后浮层在 `.tool-options-layer` 里、z-index 已**低于**抽屉，
                        //   所以"浮层压住抽屉"这个具体的坏结果不会再发生；这条调用仍保留语义：
                        //   打开面板 = 收起工具浮层。见 `closeAllToolOptions()`。）
                        closeAllToolOptions();
                        if (entry.section !== null)
                            setLeftSection(entry.section);
                        // B27：右抽屉的两个条目靠 `rightTab` 选段（图纸=palette / 改色=usage）
                        if (entry.rightTab)
                            setRightTab(entry.rightTab);
                        setOpenPanel(entry.panel);
                    } },
                    React.createElement(PanelEntryIcon, { id: entry.id }),
                    React.createElement("span", null, text.panelEntries[entry.id])));
            }),
            panelLayout && React.createElement("div", { className: "tool-rail-divider", "aria-hidden": "true" }),
            tools.map((item) => (React.createElement("button", { key: item.id, className: tool === item.id ? 'tool-button active' : 'tool-button', "data-tool-id": item.id, "aria-label": toolLabel(item.id), "aria-pressed": tool === item.id, type: "button", onPointerDown: (event) => {
                    if (event.pointerType === 'mouse')
                        return;
                    event.preventDefault();
                    // 触屏：pointerdown 已经激活过一次，浏览器随后还会补一个 click（同一次手势）。
                    // 「文字」的激活是**开关**语义（再点一次 = 收起，「`closingTextOptions`」），
                    // 成对触发 = 打开又立刻关掉 ⇒ 实测（真触摸事件）「文字」浮层在手机上**根本打不开**
                    // （基线 5198 同样如此，是既有缺陷，本批顺手修掉）。这里记一次手势，让那次 click 失效。
                    touchActivationRef.current = { id: item.id, at: Date.now() };
                    activateTool(item.id);
                }, onClick: () => {
                    const last = touchActivationRef.current;
                    if (last && last.id === item.id && Date.now() - last.at < 800)
                        return;
                    activateTool(item.id);
                } },
                React.createElement(ToolIcon, { tool: item.id, clipboardPhase: clipboardPhase }),
                React.createElement("span", null, toolLabel(item.id)))))),
        (anyToolOptionsOpen || paletteDotOpen) && (React.createElement("div", { className: "tool-options-layer", ref: toolOptionsLayerRef },
            tool === 'pencil' && showPencilOptions && (React.createElement("div", { className: "tool-options pencil-options", "data-tool-options": "pencil", onMouseLeave: () => setShowPencilOptions(false) },
                React.createElement("div", { className: "right-click-toggle compact", "aria-label": text.rightClick },
                    React.createElement("span", { className: "field-label-with-help" },
                        text.rightClick,
                        React.createElement("span", { className: "help-dot mini", "data-tooltip": text.rightClickHint, "aria-label": text.rightClickHint, tabIndex: 0 }, "?")),
                    React.createElement("div", null, ['pan', 'erase'].map((action) => (React.createElement("button", { key: action, className: project.settings.rightClickAction === action ? 'active' : '', type: "button", "aria-pressed": project.settings.rightClickAction === action, onClick: () => updateProject({
                            ...project,
                            settings: { ...project.settings, rightClickAction: action },
                        }) }, action === 'pan' ? text.pan : text.erase))))))),
            tool === 'eraser' && showEraserOptions && (React.createElement("div", { className: "tool-options eraser-options", "data-tool-options": "eraser", onMouseLeave: () => setShowEraserOptions(false) },
                React.createElement("div", { className: "right-click-toggle compact remove-scope-toggle", "aria-label": text.eraserScope },
                    React.createElement("span", null, text.eraserScope),
                    React.createElement("div", null, ['brush', 'same-connected', 'all-same-color', 'connected'].map((scope) => (React.createElement("button", { key: scope, className: eraserScope === scope ? 'active' : '', type: "button", "aria-pressed": eraserScope === scope, onClick: () => setEraserScope(scope) }, scope === 'brush'
                        ? text.eraserScopeBrush
                        : scope === 'same-connected'
                            ? text.eraserScopeSameConnected
                            : scope === 'all-same-color'
                                ? text.eraserScopeAllSameColor
                                : text.eraserScopeConnected))))),
                eraserScope === 'brush' && (React.createElement(React.Fragment, null,
                    React.createElement("div", { className: "tool-options-header" },
                        React.createElement("span", null, text.eraserSize),
                        React.createElement("strong", null, text.brushCells(eraserSize))),
                    React.createElement("div", { className: "brush-preview", "aria-hidden": "true" }, eraserSize > 0 ? (React.createElement("span", { style: { width: `${10 + eraserSize * 3}px`, height: `${10 + eraserSize * 3}px` } })) : (React.createElement("span", { className: "brush-preview-dot" }))),
                    React.createElement("input", { "aria-label": text.eraserSize, type: "range", min: 0, max: 9, step: 0.5, value: eraserSize, onChange: (event) => setEraserSize(Number(event.target.value)) }))))),
            tool === 'move' && showMoveOptions && (React.createElement("div", { className: "tool-options move-options", "data-tool-options": "move", onMouseLeave: () => setShowMoveOptions(false) },
                React.createElement("div", { className: "right-click-toggle compact", "aria-label": text.moveScope },
                    React.createElement("span", null, text.moveScope),
                    React.createElement("div", null, ['layer', 'partial'].map((mode) => (React.createElement("button", { key: mode, className: moveMode === mode ? 'active' : '', type: "button", "aria-pressed": moveMode === mode, onClick: () => setMoveMode(mode) }, mode === 'layer' ? text.scopeWholePattern : text.movePartial))))))),
            tool === 'clipboard' && showClipboardOptions && (React.createElement("div", { 
                /* 「复制」是一个工具两个相位，浮层容器只有 `clipboard-options` 一个类
                   （第 1 批留下的 `copy-options`/`paste-options` 已随"两条写死 top"一起并掉）。 */
                className: "tool-options clipboard-options", "data-tool-options": "clipboard", onMouseLeave: () => setShowClipboardOptions(false) },
                clipboardPhase === 'copy' && (React.createElement("div", { className: "right-click-toggle compact clipboard-mode-toggle", "aria-label": text.copyScope },
                    React.createElement("span", null, text.copyScope),
                    React.createElement("div", null, ['connected', 'selection'].map((mode) => (React.createElement("button", { key: mode, className: copyMode === mode ? 'active' : '', type: "button", "aria-pressed": copyMode === mode, onClick: () => {
                            setCopyMode(mode);
                            setCopySelectionIndices([]);
                        } }, mode === 'connected' ? text.copyConnected : text.copySelection)))),
                    copyMode === 'selection' && React.createElement("p", { className: "tool-hint compact-hint" }, text.copySelectionHint))),
                React.createElement("div", { className: "clipboard-tool-header" },
                    React.createElement("div", null,
                        React.createElement("strong", null, text.clipboardPreview),
                        clipboardPattern && (React.createElement("span", null, text.clipboardSize(clipboardPattern.width, clipboardPattern.height, clipboardPattern.cells.filter(Boolean).length)))),
                    React.createElement("button", { className: "clipboard-reset-button", type: "button", "aria-label": text.resetClipboard, title: text.resetClipboard, disabled: !clipboardPattern && copySelectionIndices.length === 0, onClick: resetClipboard },
                        React.createElement(ResetIcon, null))),
                clipboardPattern ? (React.createElement(ClipboardPreview, { pattern: clipboardPattern })) : (React.createElement("div", { className: "clipboard-empty" }, text.clipboardEmpty)))),
            tool === 'mirror' && showMirrorOptions && (React.createElement("div", { className: "tool-options mirror-options", "data-tool-options": "mirror", onMouseLeave: () => setShowMirrorOptions(false) },
                React.createElement("div", { className: "right-click-toggle compact", "aria-label": text.moveScope },
                    React.createElement("span", null, text.moveScope),
                    React.createElement("div", null, ['layer', 'partial'].map((mode) => (React.createElement("button", { key: mode, className: mirrorMode === mode ? 'active' : '', type: "button", "aria-pressed": mirrorMode === mode, onClick: () => setMirrorMode(mode) }, mode === 'layer' ? text.scopeWholePattern : text.movePartial))))),
                React.createElement("div", { className: "right-click-toggle compact", "aria-label": text.mirrorDirection },
                    React.createElement("span", null, text.mirrorDirection),
                    React.createElement("div", null, ['horizontal', 'vertical'].map((direction) => (React.createElement("button", { key: direction, className: mirrorDirection === direction ? 'active' : '', type: "button", "aria-pressed": mirrorDirection === direction, onClick: () => setMirrorDirection(direction) }, direction === 'horizontal' ? text.mirrorHorizontal : text.mirrorVertical))))))),
            tool === 'shape' && showShapeOptions && (React.createElement("div", { className: "tool-options shape-options", "data-tool-options": "shape", onMouseLeave: () => setShowShapeOptions(false) },
                React.createElement("div", { className: "right-click-toggle compact", "aria-label": text.shapeStyle },
                    React.createElement("span", null, text.shapeStyle),
                    React.createElement("div", null, ['outline', 'filled'].map((mode) => (React.createElement("button", { key: mode, className: shapeFillMode === mode ? 'active' : '', type: "button", "aria-pressed": shapeFillMode === mode, disabled: shapeKind === 'line' || shapeKind === 'arrow', onClick: () => setShapeFillMode(mode) }, mode === 'outline' ? text.shapeOutline : text.shapeFilled))))),
                React.createElement("div", { className: "shape-picker", "aria-label": text.shapeType },
                    React.createElement("span", null, text.shapeType),
                    React.createElement("div", null, ['line', 'rectangle', 'square', 'ellipse', 'circle', 'triangle', 'arrow'].map((kind) => (React.createElement("button", { key: kind, className: shapeKind === kind ? 'active' : '', type: "button", "aria-pressed": shapeKind === kind, onClick: () => setShapeKind(kind) },
                        React.createElement(ShapeOptionIcon, { shape: kind }),
                        React.createElement("span", null, shapeLabel[kind])))))),
                shapeKind === 'arrow' && (React.createElement("div", { className: "shape-picker arrow-picker", "aria-label": text.arrowStyle },
                    React.createElement("span", null, text.arrowStyle),
                    React.createElement("div", null, ['single', 'double', 'block'].map((kind) => (React.createElement("button", { key: kind, className: arrowKind === kind ? 'active' : '', type: "button", "aria-pressed": arrowKind === kind, onClick: () => setArrowKind(kind) },
                        React.createElement(ArrowOptionIcon, { arrow: kind }),
                        React.createElement("span", null, arrowLabel[kind]))))))))),
            tool === 'text' && showTextOptions && (React.createElement("div", { className: "tool-options text-options", "data-tool-options": "text" },
                React.createElement("label", { className: "text-tool-field" },
                    React.createElement("span", { className: "text-field-title" }, text.textContent),
                    React.createElement("input", { type: "text", maxLength: 32, value: textToolValue, placeholder: text.textPlaceholder, onChange: (event) => setTextToolValue(event.target.value) })),
                React.createElement("div", { className: "right-click-toggle compact", "aria-label": text.textDirection },
                    React.createElement("span", null, text.textDirection),
                    React.createElement("div", null, ['horizontal', 'vertical'].map((direction) => (React.createElement("button", { key: direction, className: textToolDirection === direction ? 'active' : '', type: "button", "aria-pressed": textToolDirection === direction, onClick: () => setTextToolDirection(direction) }, direction === 'horizontal' ? text.textHorizontal : text.textVertical))))),
                React.createElement("div", { className: "tool-options-header" },
                    React.createElement("span", null, text.textSize),
                    React.createElement("label", { className: "tool-number-field", "aria-label": text.textSize },
                        React.createElement("input", { type: "number", min: 5, max: 72, step: 1, value: textToolSize, onChange: (event) => setTextToolSize(Math.min(72, Math.max(5, Number(event.target.value) || 5))) }),
                        React.createElement("span", null, language === 'zh' ? '格' : 'cells'))),
                React.createElement("input", { "aria-label": text.textSize, type: "range", min: 5, max: 72, step: 1, value: textToolSize, onChange: (event) => setTextToolSize(Number(event.target.value)) }),
                React.createElement("div", { className: "tool-options-header" },
                    React.createElement("span", null, text.textSpacing),
                    React.createElement("label", { className: "tool-number-field", "aria-label": text.textSpacing },
                        React.createElement("input", { type: "number", min: 0, max: 24, step: 1, value: textToolSpacing, onChange: (event) => setTextToolSpacing(Math.min(24, Math.max(0, Number(event.target.value) || 0))) }),
                        React.createElement("span", null, language === 'zh' ? '格' : 'cells'))),
                React.createElement("input", { "aria-label": text.textSpacing, type: "range", min: 0, max: 24, step: 1, value: textToolSpacing, onChange: (event) => setTextToolSpacing(Number(event.target.value)) }))),
            paletteDotOpen && (React.createElement("div", { className: "palette-popover", "data-palette-popover": "1", ref: palettePopoverRef, role: "dialog", "aria-label": text.palette },
                React.createElement(PaletteBody, { text: text, selectedColor: selectedColor, selectedColorId: selectedColorId, displayCode: displayCode, displayName: displayName, recentColors: recentColors, selectColor: selectColor, paletteGroups: paletteGroups, paletteGroup: paletteGroup, setPaletteGroup: setPaletteGroup, visiblePalette: visiblePalette, 
                    /* 品牌/版本下拉**不跟着浮层**（已并进左抽屉 `.params-card`，抽屉档里由那里渲染）。 */
                    showHeading: false }))))),
        React.createElement(WorkspaceCanvas, { project: project, selectedColorId: selectedColorId, highlightedColorId: highlightedColorId, highlightedCellIndices: isolatedCellIndices, formatColorCode: displayCodeById, tool: tool, eraserSize: eraserSize, 
            // 「换色」画布点豆时用的目标色（工具侧口径：挑过用挑的，没挑过用当前画笔色）。
            /* B19：画布只报源色，目标色 = `replaceColor` 的默认参数（当前画笔色）—— 与原始语义一致。 */
            onReplaceColor: replaceColor, moveMode: moveMode, eraserScope: eraserScope, mirrorMode: mirrorMode, mirrorDirection: mirrorDirection, shapeKind: shapeKind, shapeFillMode: shapeFillMode, arrowKind: arrowKind, textToolValue: textToolValue, textToolDirection: textToolDirection, textToolSize: textToolSize, textToolSpacing: textToolSpacing, onTextToolSizeChange: setTextToolSize, referenceImageUrl: referenceImageUrl, referenceImageVisible: referenceVisible && !isGenerating, referenceImageOpacity: referenceOpacity, referenceImageScale: referenceScale, referenceImageOffset: referenceOffset, referenceImageAdjusting: referenceAdjusting && referenceVisible && !isGenerating, referenceImagePlacement: referencePlacement, referenceAdjustHint: text.referenceAdjustHint, onReferenceOffsetChange: setReferenceOffset, onReferenceScaleChange: setReferenceScale, onCommitStart: () => {
                setShowPencilOptions(false);
                setShowEraserOptions(false);
                setShowMoveOptions(false);
                setShowMirrorOptions(false);
                setShowShapeOptions(false);
                setShowTextOptions(tool === 'text');
                setShowClipboardOptions(false);
                commitHistory();
            }, onCellsChange: updateCells, clipboardPattern: clipboardPattern, clipboardPhase: clipboardPhase, copyMode: copyMode, copySelectionIndices: copySelectionIndices, onCopyPattern: (pattern, switchToPaste = true) => {
                const beads = pattern.cells.filter(Boolean).length;
                setClipboardPattern(pattern);
                // 合并前这里是 `setTool('paste')`：选好范围就自动进入"可以落图"的相位。
                if (switchToPaste)
                    setClipboardPhase('paste');
                setShowPencilOptions(false);
                setShowEraserOptions(false);
                setShowMoveOptions(false);
                setShowMirrorOptions(false);
                setShowShapeOptions(false);
                setShowTextOptions(false);
                setShowClipboardOptions(false);
                setNotice(text.copiedPattern(pattern.width, pattern.height, beads));
            }, onCopySelectionChange: (indices, pattern) => {
                setCopySelectionIndices(indices);
                setClipboardPattern(pattern);
                setNotice(pattern ? text.copySelectionUpdated(pattern.cells.filter(Boolean).length) : text.clipboardReset);
            }, onPastePattern: () => setNotice(text.pastedPattern), onPickColor: (colorId) => {
                selectColor(colorId);
                setTool('pencil');
                closeAllToolOptions();
                setNotice(language === 'zh' ? '已从画布拾取颜色。' : 'Color picked from canvas.');
            }, onHover: setHoverCell, fitLabel: text.fit, canEdit: !activeLayer.locked, lockedHint: text.lockedCanvasHint, 
            // 第 3 批：画布尺寸徽标顺带报总颗数；面板开合也改成受控（状态在本文件里）。
            totalBeads: totalBeads, beadUnit: language === 'zh' ? '颗' : 'beads', openPanel: openPanel, setOpenPanel: setOpenPanel, panelLayout: panelLayout, 
            // ── B9（用户第 8 条）：画布右上角的「当前色圆点」入口。
            //    圆点只在抽屉档渲染（`WorkspaceCanvas` 里由 `panelLayout` 把关），桌面档真值传下去也没人消费。
            paletteDotOpen: paletteDotOpen, onPaletteDotClick: onPaletteDotClick, onPaletteDotCanvasPointerDown: () => setPaletteDotOpen(false), paletteDotRef: paletteDotRef, 
            /** 无障碍名带上当前色号 —— 读屏用户要能听出"这颗豆是什么颜色"。 */
            paletteDotLabel: paletteDotLabel, 
            // ── B7（用户第 6 条）：原来住在右栏顶部那块 `.status-section` 里的三样东西，
            //    现在挂在画布的**左下角**（`WorkspaceCanvas` 的 `.canvas-status`）：
            //      · `notice` / `noticeIsError`：操作回执与错误态（原样搬，role 也一起搬）；
            //      · `statusFacts`：**互补**于左上角 `.board-chip`（那写的是「52 * 52 · 319 颗」）
            //        ⇒ 这里只报「N 色 · M 块板」（i18n `canvasStatusFacts`，中英各一条）。
            //    ⛔ 工具名那个 `status-pill` 不再搬：工具条里每个按钮本来就写着同一个名字。
            notice: notice, noticeIsError: noticeIsError, statusFacts: text.canvasStatusFacts(usage.length, boardCount) }),
        React.createElement(RightPanel, { text: text, rightTab: rightTab, setRightTab: setRightTab, 
            // B7：`notice` / `noticeIsError` / `tool` / `boardCount` 四个传参已删除 ——
            //     它们只被那块搬去画布左下角的 `.status-section` 消费（见上面 WorkspaceCanvas 的注释）。
            setNotice: setNotice, project: project, usage: usage, 
            // B19：「换色」工具浮层已删 ⇒ 会话与编辑器只服务这一处（`hideRecolorEditor` 也不再传）。
            recolor: recolor, totalBeads: totalBeads, totalPacks: totalPacks, selectedColor: selectedColor, selectedColorId: selectedColorId, displayCode: displayCode, displayName: displayName, recentColors: recentColors, selectColor: selectColor, 
            // B7：`paletteMode` / `setPaletteMode` 两个传参已删除 —— 它们只服务那块
            //     "221 / 291 档"下拉框，而它已并进下面 `brandSelect` 里那一个合并下拉框。
            //     （`boardCount` / `tool` 两个传参见上面 RightPanel 的注释，随状态行一起删除。）
            paletteGroups: paletteGroups, paletteGroup: paletteGroup, setPaletteGroup: setPaletteGroup, visiblePalette: visiblePalette, stepBeadsPerPack: stepBeadsPerPack, setBeadsPerPack: setBeadsPerPack, 
            // B6：countedLayers / layers / activeLayer / updateUsageLayerSelection / toggleUsageLayer /
            //     layerDisplayName 这 6 个 prop 已随「用量」tab 的图层板块一起删除（明细见 RightPanel.tsx）。
            isolatedBeads: isolatedBeads, showIsolatedBeads: showIsolatedBeads, setShowIsolatedBeads: setShowIsolatedBeads, setHighlightedColorId: setHighlightedColorId, updateProject: updateProject, hoverCell: hoverCell, 
            // W3.4 接线①（D6）：用量面板改色入口。
            // 必须传 App 既有的 replaceColor()（内部 commitHistory() + withLayers()），这样「撤销」
            // 回到替换前那一刻；若直接 updateProject 改格子则不提交历史，点撤销会退到"出图前"清空整图。
            // ⚠️ 这个 prop 原来只传给了 <WorkspaceCanvas>（画布右键改色），<RightPanel> 一直没收到
            //   ⇒ 用量面板的「替换」永远 disabled 并显示"改色还没有接线（缺少 onReplaceColor）"。
            onReplaceColor: replaceColor, 
            /*
              B10：`brandSelect` 这个元素现在**声明在 return 之前**（`brandSelect` 变量），
              因为它有两个挂载点：桌面档 = 本组件的「调色盘」tab；抽屉档 = 左抽屉 `.params-card`
              （见那里的 `.params-brand-slot`）。两条按 `panelLayout` 互斥 ⇒ DOM 里永远只有一份
              （`BrandSelect` 内部有 `useState`，两份会各自持有一份展开状态，那才是真问题）。
            */
            brandSelect: brandSelect, 
            /* B10：抽屉档的右抽屉只剩「用量」（无 tab 栏、无色盘正文），色盘改挂画布浮层。 */
            drawerMode: panelLayout, 
            /*
              B16（用户第 15 轮第 2 条）：抽屉档把**「参数调节」整块**渲染进这个抽屉
              （位置在「用量 → 视图 → 参数调节」，见 `RightPanel` 末尾的 `.params-drawer-slot`）。
              桌面档 `drawerMode === false` ⇒ 面板不渲染它，桌面那份仍在左栏常驻列（`{!panelLayout && paramsCardNode}`）
              ⇒ 桌面 DOM/几何 Δ=0。卡片只有这一份实例。
            */
            paramsCard: paramsCardNode }),
        noticeIsError && (React.createElement("div", { className: "error-banner", role: "alert" },
            React.createElement("span", { className: "error-banner-icon", "aria-hidden": "true" }, "!"),
            React.createElement("div", { className: "error-banner-body" },
                React.createElement("strong", null, notice)),
            React.createElement("button", { type: "button", className: "error-banner-action", onClick: () => {
                    navigator.clipboard?.writeText(notice).catch(() => undefined);
                } }, text.copyError),
            React.createElement("button", { type: "button", className: "error-banner-close", "aria-label": text.close, onClick: () => setNoticeIsError(false) }, "\u00D7"))),
        floatingHelp && (React.createElement("div", { className: "floating-help-tooltip", style: { left: floatingHelp.left, top: floatingHelp.top } }, floatingHelp.text))));
}
//# sourceMappingURL=App.js.map