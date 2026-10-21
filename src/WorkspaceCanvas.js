import { getColor } from './palette.js';
import GeneratingHeart from './GeneratingHeart.js';
// （2026-10-21）原来这里有一段 `reactDomPortal` 收窄声明，只服务于"抽屉内关闭按钮"的 portal。
// 该按钮随用户反馈删除（点抽屉外即可关闭），portal 不再需要 ⇒ 声明一并移除。
// ⚠️ 若将来又要往抽屉里 portal 内容，`ReactDOM.createPortal` 需要按同样的方式收窄类型
//    （`react-dom` 没有 import-map 条目，`global.d.ts` 只声明了 `createRoot`）。
// W5-P3：单层快速路径下"空格子"复用的常量数组（drawBeadStack 只读它，不会修改）。
const EMPTY_BEAD_STACK = [];
/**
 * O1（全层面性能审计第一批）：**主画布 DPR 上限 = 2**。
 *
 * 为什么：主画布的位图像素数 = CSS 面积 × dpr²。
 *   · 桌面 dpr=1 → 856×934 = 80 万像素
 *   · 高分屏 dpr=2 → 1712×1868 = 320 万像素（4 倍）
 *   · 手机 dpr=3 → 1170×2055 = 240 万像素（但每帧要 clear+fill 两遍）
 * 每帧的 `clearRect` + `fillRect` + 逐格绘制都按位图像素算 ⇒ dpr=3 时成本约 9 倍。
 * 限到 2 之后：手机上每帧像素操作 **-55%**，肉眼几乎看不出差别（格子图本来就是硬边，
 * 不如照片那样依赖超采样）。
 *
 * ⚠️ 与 3D 预览保持同一口径（`ThreePreview.tsx` 用的是 `Math.min(dpr, 2.5)`，那是 WebGL 纹理，
 * 上限可以略高；这里是 2D 位图，2 已经够用）。
 */
const MAX_CANVAS_DPR = 2;
/**
 * P6（2026-10-20）：**色号在屏幕上至少要有这么大（CSS px）才绘制**。
 *
 * 背景：色号字体是 `cellSize * 0.3`（cellSize=18 时约 5.4 世界单位）。
 *   · 放大到 100%+ 时格子 18px 以上 ⇒ 色号约 5.4~10px，勉强可读 ✅
 *   · 缩小到 30% 时格子只有 5.4px，色号约 1.6px ⇒ **完全看不清，纯属浪费**
 *
 * 而 180×180 的大图在缩小后可见格数是 32,400 个 —— 每帧画 3 万多个看不见的文字，
 * 这就是「180 格 + 显示色号 + 缩小」卡顿的根因。
 *
 * 16 的取值：与旧代码 `cellSize >= 16` 的意图一致（当时把它当成"屏幕上 16px"来写，
 * 但 cellSize 是常量，条件永远成立）。改成 `cellSize * zoom >= 16` 后语义才真正对齐。
 */
const COLOR_CODE_MIN_SCREEN_CELL = 16;
// —— W0.2 纯搬迁后的导入（新模块都平铺在 src/ 下，不建子目录）——
import { collectShapeIndices, collectTextIndices, guideLineCenters, hexToRgba, isLightColor, linePoints, readableTextColor } from './shapeGeometry.js';
import { applyBrush, canShiftSelection, clampShiftDelta, collectBrushIndices, collectConnectedCellIndices, collectConnectedOccupiedIndices, collectFloodFillIndices, collectRecolorIndices, collectSameColorIndices, createClipboardPattern, floodFill, getActiveLayerCells, getTopVisibleColor, mirrorCells, pasteClipboardPattern, shiftCells, } from './cellOperations.js';
// —— W1 触屏手势层（新文件，平铺在 src/ 下）——
import { installTouchTitleTips, useTouchGestures } from './useTouchGestures.js';
// 第 4 批清理：原来这里 `import { PANEL_LAYOUT_QUERY } from './useMediaQuery.js'`。
// 第 3 批把 `panelLayout` 提升到 `App` 之后，本文件里它**只被注释引用**了
// （`git grep -n PANEL_LAYOUT_QUERY src/WorkspaceCanvas.tsx` ⇒ 1 处 import + 4 处注释）
// ⇒ 那是一条**死 import**（`tsconfig` 没开 `noUnusedLocals`，所以编译器不会提醒）。已删。
// 断点常量本身仍在 `useMediaQuery.ts` 里，`App.tsx` 是它唯一的运行时消费方。
const { useEffect, useMemo, useRef, useState } = React;
/**
 * B48-A1a：**只在尺寸/DPR 真的变了时**才重建绘制表面，返回本次生效的 `dpr`。
 *
 * 为什么要这样：给 `canvas.width` 赋值不是"设个数字"，而是**重置整个绘制表面**
 * （重建 backing store + 清空全部 2D 上下文状态）。而这个函数被主绘制 effect 调用，
 * 那个 effect 的依赖里含 `hoverPoint` ⇒ **每次鼠标移动都会重跑**，
 * 于是实测在以 50~70 次/秒 的频率重建整块位图（dpr=2 时约 6 Mpx/次）。
 *
 * 跳过赋值后，原来由"重置"顺带保证的三件事改由调用方**显式**保证（见两个调用点）：
 *   · 变换矩阵 `setTransform(dpr, …)`　· `globalAlpha = 1`　· `setLineDash([])`
 * 审计依据：主画布上其余状态改动都在 `save()/restore()` 内或成对复位
 * （`globalAlpha` 在 drawBeadStack 内成对、`setLineDash` 在笔刷光标与板缝里成对），
 * 不存在跨次泄漏 ⇒ 跳过重置是等价的。
 */
function ensureCanvasSize(canvas, wrapper, last) {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_CANVAS_DPR);
    const cssW = wrapper.clientWidth;
    const cssH = wrapper.clientHeight;
    const w = Math.floor(cssW * dpr);
    const h = Math.floor(cssH * dpr);
    if (last.w !== w || last.h !== h || last.dpr !== dpr) {
        canvas.width = w;
        canvas.height = h;
        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${cssH}px`;
        last.w = w;
        last.h = h;
        last.dpr = dpr;
    }
    return dpr;
}
export default function WorkspaceCanvas({ project, selectedColorId, highlightedColorId, highlightedCellIndices, formatColorCode, tool, eraserSize, eraserScope, moveMode, mirrorMode, mirrorDirection, shapeKind, shapeFillMode, arrowKind, textToolValue, textToolDirection, textToolSize, textToolSpacing, onTextToolSizeChange, referenceImageUrl, referenceImageVisible, referenceImageOpacity, referenceImageScale, referenceImageOffset, referenceImageAdjusting, referenceImagePlacement, referenceAdjustHint, onReferenceOffsetChange, onReferenceScaleChange, clipboardPattern, clipboardPhase, copyMode, copySelectionIndices, onCommitStart, onCellsChange, onReplaceColor, onCopyPattern, onCopySelectionChange, onPastePattern, onPickColor, onHover, fitLabel, canEdit, isGenerating = false, generatingLabel, lockedHint, totalBeads, beadUnit, statusFacts, notice, noticeIsError, openPanel, setOpenPanel, panelLayout, paletteDotOpen, onPaletteDotClick, onPaletteDotCanvasPointerDown, paletteDotRef, paletteDotLabel, }) {
    const canvasRef = useRef(null);
    const wrapperRef = useRef(null);
    /** B48-A1a：上一次真正写进 canvas 的位图尺寸（见 `ensureCanvasSize`）。0 = 还没写过。 */
    const canvasSizeRef = useRef({ w: 0, h: 0, dpr: 0 });
    /** W5-P2：绘制 rAF 句柄。同一帧内的多次请求合并成一次真实重绘（鼠标移动/拖动时收益最大）。 */
    const drawRafRef = useRef(0);
    /** W5-P6b：最近一次上报给 App 的 hover 格子键（"x,y"）。同一格内移动不重复上报，
     *  避免鼠标每动一次就让 App 全量重渲染（App 无 memo，hoverCell 提升到顶层）。 */
    const lastHoverRef = useRef(null);
    /** W5-P6a：最新绘制参数快照。ResizeObserver effect 只建一次（依赖 []），
     *  回调从这里读最新值，避免它随 hoverPoint/pan 等变化重跑导致 drawPattern 画两遍。 */
    const drawParamsRef = useRef(null);
    const draftCellsRef = useRef(getActiveLayerCells(project));
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isSpaceDown, setIsSpaceDown] = useState(false);
    const [hoverPoint, setHoverPoint] = useState(null);
    const [shapeDraft, setShapeDraft] = useState(null);
    const [referenceImage, setReferenceImage] = useState(null);
    const [activePointerMode, setActivePointerMode] = useState(null);
    // W3：`openPanel` / `panelLayout` 已提升到 `App`（见 `Props` 里的注释）。
    // ⚠️ 抽屉内可见关闭按钮已于 2026-10-21 删除（用户：点抽屉外就能关，叉号纯占位），
    //    它原来用的 portal 宿主 state（`panelHosts`）随之整块移除。
    /*
     * B18（用户第 15 轮第 8a 条）：**吸管长按放大镜**。
     *
     * 用户裁决（2026-09-21，第二轮修正）：
     *   · **短按 = 保持现在的吸色逻辑**（不出镜子）；
     *   · **长按 = 出放大镜**：跟着手指移动、放大显示当前指向的那一格，**松手才吸取**。
     * 只作用于**触摸**；鼠标路径一字不动（仍是按下即吸）。
     *
     * ⚠️ 为什么触摸路径必须"按下先不吸"：`onPickColor` 的既有行为是**取完色把工具切回画笔**
     *   ⇒ 若按下就吸，长按还没触发，工具已经变了、后续计时与镜子全乱。
     *   （短按的"手感"不变：抬起时立刻吸，且吸的是**按下那一格**，与改动前一致。）
     */
    const LONG_PRESS_MS = 200; // 加上手势层 `deferTouchStart` 的 140ms 前摇 ≈ 340ms 总时长
    const LONG_PRESS_MOVE_TOL = 12; // 位移超过它就视为"拖动"，不触发长按
    const LOUPE_SIZE = 124; // 桌面/iPad 的镜子边长（手机档在渲染处按画布可用宽缩到 96，见 B26）
    const LOUPE_ZOOM = 4;
    const [loupe, setLoupe] = useState(null);
    const loupeCanvasRef = useRef(null);
    const loupePressRef = useRef({
        timer: null,
        startX: 0,
        startY: 0,
        cell: null,
        pointerId: 0,
        active: false,
        fired: false,
    });
    /** 清掉"长按计时"这一份状态（不碰镜子的显示，调用方决定）。 */
    const clearLoupePress = () => {
        if (loupePressRef.current.timer !== null) {
            clearTimeout(loupePressRef.current.timer);
            loupePressRef.current.timer = null;
        }
        loupePressRef.current.active = false;
        loupePressRef.current.fired = false;
        loupePressRef.current.cell = null;
    };
    /**
     * B25（用户 2026-09-22）：**粘贴（触摸）的长按落位预览**。
     * 与 B18 吸管镜子共用同一套参数（`LONG_PRESS_MS` / `LONG_PRESS_MOVE_TOL`）⇒ 两个工具的手感一致：
     * 短按 = 老手感（按下即落）、长按 = 先预览、松手才落。
     */
    const pastePressRef = useRef({
        timer: null,
        startX: 0,
        startY: 0,
        cell: null,
        pointerId: -1,
        active: false,
        fired: false,
    });
    const clearPastePress = () => {
        if (pastePressRef.current.timer !== null) {
            clearTimeout(pastePressRef.current.timer);
            pastePressRef.current.timer = null;
        }
        pastePressRef.current.active = false;
        pastePressRef.current.fired = false;
        pastePressRef.current.cell = null;
    };
    const pointerRef = useRef({
        drawing: false,
        panning: false,
        erasing: false,
        singleCellErasing: false,
        movingPattern: false,
        draggingReference: false,
        copySelecting: false,
        shaping: false, pointerId: 0,
        lastX: 0,
        lastY: 0,
        lastCellX: -1,
        lastCellY: -1,
        lastGridX: 0,
        lastGridY: 0,
        moveStartCellX: 0,
        moveStartCellY: 0,
        moveLastDx: 0,
        moveLastDy: 0,
        moveOriginCells: [],
        moveSelectionIndices: [],
        referenceOffsetX: 0,
        referenceOffsetY: 0,
        copySelectionAction: 'add',
        copySelectionSet: new Set(),
        shapeStartCellX: 0,
        shapeStartCellY: 0,
        shapeLastCellX: 0,
        shapeLastCellY: 0,
    });
    const cellSize = 18;
    // ————————————————————————— W1：触屏手势（双指缩放 / 平移） —————————————————————————
    // 只跟踪 pointerType === 'touch' ⇒ 鼠标与触控笔路径完全不变（桌面像素不受影响）。
    // getTransform 每次渲染都会被 hook 用最新闭包覆盖，所以读到的 zoom/pan 一定是当前值。
    const gestures = useTouchGestures(canvasRef, {
        getTransform: () => ({ zoom, panX: pan.x, panY: pan.y }),
        onTransform: (next) => {
            setZoom(next.zoom);
            setPan(constrainPan({ x: next.panX, y: next.panY }, next.zoom));
        },
        onGestureStart: () => {
            // 第二根手指落下 ⇒ 立刻停掉可能已经开始的单指绘制，并清掉形状草稿
            cancelPointerForGesture();
        },
        minZoom: 0.12,
        maxZoom: 5,
    });
    // 触屏上 title 没有 hover 出口 ⇒ 点一下显示提示（只对 touch 生效）
    useEffect(() => installTouchTitleTips(), []);
    // 面板断点是否命中 ⇒ 第 3 批起由 `App`（`useMediaQuery(PANEL_LAYOUT_QUERY)`）算好后当 prop 传下来，
    // 这里不再自己 matchMedia（两处各判一次迟早会漂移）。
    // `PANEL_LAYOUT_QUERY` 仍从 `useMediaQuery.ts` 引入，供下面的注释与宿主查询引用同一处口径。
    // 面板开合：`.app-shell` 上的 `is-left-open/is-right-open` 类与"抽屉外一切 inert"的 effect
    // **第 3 批搬到了 `App.tsx`**（在那里才能同时看到顶栏、`.tool-rail` 与两个抽屉，
    // 而 `.tool-rail` 必须**排除在 inert 之外** —— 它现在是抽屉的分区切换器）。
    // 这里只留"Esc 关闭"这半条键盘出口。
    useEffect(() => {
        if (!openPanel)
            return undefined;
        const onKeyDown = (event) => {
            if (event.key === 'Escape')
                setOpenPanel(null);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [openPanel, setOpenPanel]);
    const referenceImageOptions = useMemo(() => ({
        image: referenceImage,
        visible: referenceImageVisible,
        opacity: referenceImageOpacity,
        scale: referenceImageScale,
        offset: referenceImageOffset,
        placement: referenceImagePlacement,
    }), [referenceImage, referenceImageVisible, referenceImageOpacity, referenceImageScale, referenceImageOffset, referenceImagePlacement]);
    // W5-P6a：每次渲染更新最新绘制参数（供只建一次的 ResizeObserver 回调读取，避免重复绘制）
    drawParamsRef.current = {
        project,
        cellSize,
        zoom,
        pan,
        highlightedColorId,
        highlightedCellIndices,
        tool,
        clipboardPhase,
        selectedColorId,
        eraserSize,
        eraserScope,
        moveMode,
        mirrorMode,
        clipboardPattern,
        copyMode,
        copySelectionIndices,
        shapeDraft,
        hoverPoint,
        canEdit,
        referenceImageOptions,
        textToolValue,
        textToolDirection,
        textToolSize,
        textToolSpacing,
        formatColorCode,
    };
    useEffect(() => {
        const onKeyDown = (event) => {
            if (event.code === 'Space')
                setIsSpaceDown(true);
        };
        const onKeyUp = (event) => {
            if (event.code === 'Space')
                setIsSpaceDown(false);
        };
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
        };
    }, []);
    useEffect(() => {
        if (!referenceImageUrl) {
            setReferenceImage(null);
            return;
        }
        let cancelled = false;
        const image = new Image();
        image.onload = () => {
            if (!cancelled)
                setReferenceImage(image);
        };
        image.onerror = () => {
            if (!cancelled)
                setReferenceImage(null);
        };
        image.src = referenceImageUrl;
        return () => {
            cancelled = true;
        };
    }, [referenceImageUrl]);
    useEffect(() => {
        const wrapper = wrapperRef.current;
        if (!wrapper)
            return;
        fitToWindow();
    }, [project.width, project.height, cellSize]);
    useEffect(() => {
        draftCellsRef.current = getActiveLayerCells(project);
        const canvas = canvasRef.current;
        const wrapper = wrapperRef.current;
        if (!canvas || !wrapper)
            return;
        const context = canvas.getContext('2d');
        if (!context)
            return;
        // W5-P2：**绘制合并到下一帧**。原来 effect 一跑就同步全量重绘，
        // 而 `hoverPoint`（鼠标每移一格就 setState）在这个依赖里 ⇒ 高频鼠标移动＝高频全量重绘。
        // 改成 rAF 合并后：同一帧内无论触发多少次，只真正重绘一次。
        if (drawRafRef.current)
            window.cancelAnimationFrame(drawRafRef.current);
        drawRafRef.current = window.requestAnimationFrame(() => {
            drawRafRef.current = 0;
            const dpr = ensureCanvasSize(canvas, wrapper, canvasSizeRef.current);
            context.setTransform(dpr, 0, 0, dpr, 0, 0);
            // B48-A1a：跳过一次 canvas.width 赋值后，这两个状态不再被"重置"顺带清掉 ⇒ 显式复位
            //（主画布上其余状态改动都在 save()/restore() 内或成对复位，见 ensureCanvasSize 注释）
            context.globalAlpha = 1;
            context.setLineDash([]);
            drawPattern(context, project, cellSize, zoom, pan, highlightedColorId, highlightedCellIndices, tool, clipboardPhase, selectedColorId, eraserSize, eraserScope, moveMode, mirrorMode, clipboardPattern, copyMode, copySelectionIndices, shapeDraft, hoverPoint, canEdit, referenceImageOptions, textToolValue, textToolDirection, textToolSize, textToolSpacing, formatColorCode);
        });
        return () => {
            if (drawRafRef.current) {
                window.cancelAnimationFrame(drawRafRef.current);
                drawRafRef.current = 0;
            }
        };
    }, [project, cellSize, zoom, pan, highlightedColorId, highlightedCellIndices, tool, clipboardPhase, selectedColorId, eraserSize, eraserScope, moveMode, mirrorMode, clipboardPattern, copyMode, copySelectionIndices, shapeKind, shapeDraft, hoverPoint, canEdit, referenceImageOptions, textToolValue, textToolDirection, textToolSize, textToolSpacing, formatColorCode]);
    useEffect(() => {
        // W5-P6a：ResizeObserver **只建一次**（依赖 []）。原来它的依赖数组与主绘制 effect 完全
        // 相同（30 项），导致每次 hoverPoint/pan 等变化时本 effect 也重跑：先 disconnect 旧
        // observer 再新建 → 新建后的首次回调立即触发一次 drawPattern → 每次变化重复绘制一遍。
        // 现在回调从 drawParamsRef 读最新参数，只负责"窗口尺寸变化时重绘"，不再随状态变化重跑。
        const startObserve = () => {
            const wrapper = wrapperRef.current;
            if (!wrapper)
                return null;
            const observer = new ResizeObserver(() => {
                const canvas = canvasRef.current;
                if (!canvas || !wrapper)
                    return;
                const context = canvas.getContext('2d');
                if (context) {
                    const p = drawParamsRef.current;
                    const dpr = ensureCanvasSize(canvas, wrapper, canvasSizeRef.current);
                    context.setTransform(dpr, 0, 0, dpr, 0, 0);
                    context.globalAlpha = 1;
                    context.setLineDash([]);
                    drawPattern(context, p.project, p.cellSize, p.zoom, p.pan, p.highlightedColorId, p.highlightedCellIndices, p.tool, p.clipboardPhase, p.selectedColorId, p.eraserSize, p.eraserScope, p.moveMode, p.mirrorMode, p.clipboardPattern, p.copyMode, p.copySelectionIndices, p.shapeDraft, p.hoverPoint, p.canEdit, p.referenceImageOptions, p.textToolValue, p.textToolDirection, p.textToolSize, p.textToolSpacing, p.formatColorCode);
                }
                const p = drawParamsRef.current;
                setPan((current) => {
                    const next = constrainPan(current, p.zoom);
                    return almostSamePoint(current, next) ? current : next;
                });
            });
            observer.observe(wrapper);
            return observer;
        };
        let observer = startObserve();
        if (!observer) {
            // wrapper 首帧未就绪：下一帧重试一次
            const raf = window.requestAnimationFrame(() => {
                const retry = startObserve();
                if (retry)
                    observer = retry;
            });
            return () => {
                window.cancelAnimationFrame(raf);
                if (observer)
                    observer.disconnect();
            };
        }
        const obs = observer; // 窄化为非 null（闭包内 TS 不做此推断）
        return () => obs.disconnect();
    }, []);
    // W1：触摸前摇被双指手势打断时，把「已经开始/即将开始」的单指操作整段丢弃。
    // 注意：只清 pointerRef 与 shapeDraft，**不碰格子数组、不写撤销历史**（所以双指缩放不会留脏点）。
    function cancelPointerForGesture() {
        const pointer = pointerRef.current;
        pointer.drawing = false;
        pointer.panning = false;
        pointer.erasing = false;
        pointer.singleCellErasing = false;
        pointer.movingPattern = false;
        pointer.draggingReference = false;
        pointer.copySelecting = false;
        pointer.shaping = false;
        pointer.moveOriginCells = [];
        pointer.moveSelectionIndices = [];
        pointer.copySelectionSet = new Set();
        setShapeDraft(null);
        setActivePointerMode(null);
    }
    function handlePointerDown(event) {
        /*
          B9 关闭路径③（用户裁决「画布 `pointerdown` 即关」）：**在画布自己的落笔入口**再关一次。
          `App` 的 document 级监听（路径②）其实已经覆盖它（`.canvas` 既不是圆点也不是抽屉），
          但那条是"外面"的通用规则；这里显式写一次，是为了让"画布上按一下就把色盘放下"
          这条**用户点名要求**在它自己的组件里读得出来，而且**不依赖事件冒泡顺序**。
          幂等：`onPaletteDotCanvasPointerDown()` 最终是 `setPaletteDotOpen(false)`，已经关着时
          React 对同一值 bail out ⇒ 不会有额外渲染。
          ⚠️ 它**不关抽屉**（不碰 `openPanel`）：落下画笔不是"把调色盘收起来"。
        */
        if (paletteDotOpen)
            onPaletteDotCanvasPointerDown();
        const isTouch = event.pointerType === 'touch';
        if (isTouch) {
            // 第二根及以后的手指只服务手势层，不参与绘制（防串指）
            if (!event.isPrimary)
                return;
            if (gestures.isGesturing())
                return;
            // 触摸前摇：140ms 内若出现第二根手指（= 双指手势），这一次落笔整体作废
            const { clientX, clientY, button, pointerId } = event;
            gestures.deferTouchStart(pointerId, () => runPointerDown(clientX, clientY, button, pointerId, true));
            return;
        }
        runPointerDown(event.clientX, event.clientY, event.button, event.pointerId);
    }
    // 落笔主体。触摸路径由 gestures 托管，所以这里**不能**用 React 合成事件的 currentTarget
    //（延迟执行时它已被置空），一律用 canvasRef 与传进来的原始数值。
    function runPointerDown(clientX, clientY, button, pointerId, isTouch = false) {
        const point = canvasToGridPoint(clientX, clientY);
        const cell = point?.cell ?? null;
        const rightClickAction = tool === 'pencil' ? project.settings.rightClickAction : 'pan';
        pointerRef.current.pointerId = pointerId;
        pointerRef.current.lastX = clientX;
        pointerRef.current.lastY = clientY;
        pointerRef.current.erasing = false;
        pointerRef.current.singleCellErasing = false;
        pointerRef.current.movingPattern = false;
        pointerRef.current.draggingReference = false;
        pointerRef.current.copySelecting = false;
        pointerRef.current.shaping = false;
        try {
            canvasRef.current?.setPointerCapture(pointerId);
        }
        catch {
            /* 指针已失效时忽略 */
        }
        if (referenceImageAdjusting && referenceImageVisible && button === 0) {
            pointerRef.current.draggingReference = true;
            pointerRef.current.referenceOffsetX = referenceImageOffset.x;
            pointerRef.current.referenceOffsetY = referenceImageOffset.y;
            setActivePointerMode('reference');
            return;
        }
        // 平移的入口（「拖动」工具已于 2026-09-20 删除）：
        // 鼠标中键 / 按住空格 / 画笔的右键（`rightClickAction === 'pan'`）；触屏双指由手势层接管。
        if (button === 1 || isSpaceDown || (button === 2 && rightClickAction === 'pan')) {
            pointerRef.current.panning = true;
            setActivePointerMode('pan');
            return;
        }
        if (!cell)
            return;
        if (button === 2 && rightClickAction === 'erase') {
            if (!canEdit)
                return;
            setActivePointerMode('rightErase');
            onCommitStart();
            draftCellsRef.current = getActiveLayerCells(project).slice();
            pointerRef.current.drawing = true;
            pointerRef.current.erasing = true;
            pointerRef.current.singleCellErasing = true;
            pointerRef.current.lastCellX = cell.x;
            pointerRef.current.lastCellY = cell.y;
            pointerRef.current.lastGridX = point?.gridX ?? cell.x + 0.5;
            pointerRef.current.lastGridY = point?.gridY ?? cell.y + 0.5;
            applyTool(cell.x, cell.y, pointerRef.current.lastGridX, pointerRef.current.lastGridY);
            return;
        }
        if (tool === 'eyedropper') {
            /*
             * B18：触摸路径**先不吸**——按下只起一个长按计时器：
             *   · 计时器到点（且手指没怎么动）⇒ 出放大镜，此后跟手，**松手才吸**；
             *   · 不到点就松手（短按）⇒ 在 `handlePointerUp` 里立刻吸**按下那一格**（= 改动前的手感）。
             * 鼠标路径不变：按下即吸。
             */
            if (isTouch) {
                clearLoupePress();
                loupePressRef.current.startX = clientX;
                loupePressRef.current.startY = clientY;
                loupePressRef.current.cell = cell ? { x: cell.x, y: cell.y } : null;
                loupePressRef.current.pointerId = pointerId;
                loupePressRef.current.active = true;
                loupePressRef.current.fired = false;
                loupePressRef.current.timer = setTimeout(() => {
                    loupePressRef.current.timer = null;
                    const target = loupePressRef.current.cell;
                    if (!loupePressRef.current.active || !target)
                        return;
                    loupePressRef.current.fired = true;
                    setLoupe({ cell: target, clientX: loupePressRef.current.startX, clientY: loupePressRef.current.startY });
                }, LONG_PRESS_MS);
                return;
            }
            const colorId = getTopVisibleColor(project, cell.y * project.width + cell.x);
            if (colorId)
                onPickColor(colorId);
            return;
        }
        // 「复制」工具的两个相位（原 `copy` / `paste` 两个工具，2026-09-20 合并）。
        if (tool === 'clipboard' && clipboardPhase === 'copy') {
            const activeCells = getActiveLayerCells(project);
            const startIndex = cell.y * project.width + cell.x;
            if (!activeCells[startIndex])
                return;
            if (copyMode === 'selection') {
                const selected = new Set(copySelectionIndices);
                pointerRef.current.drawing = true;
                pointerRef.current.copySelecting = true;
                pointerRef.current.copySelectionAction = selected.has(startIndex) ? 'remove' : 'add';
                pointerRef.current.copySelectionSet = selected;
                pointerRef.current.lastCellX = cell.x;
                pointerRef.current.lastCellY = cell.y;
                applyCopySelection([{ x: cell.x, y: cell.y }]);
                return;
            }
            const indices = collectConnectedOccupiedIndices(activeCells, project.width, project.height, cell.x, cell.y);
            const pattern = createClipboardPattern(activeCells, project.width, indices);
            if (pattern.cells.some(Boolean))
                onCopyPattern(pattern);
            return;
        }
        if (tool === 'recolor') {
            const sourceColorId = getTopVisibleColor(project, cell.y * project.width + cell.x);
            if (!sourceColorId || sourceColorId === selectedColorId)
                return;
            // B19：只上报源色，目标色 = 当前画笔色（由 `App.replaceColor` 的默认参数决定）。
            onReplaceColor(sourceColorId);
            return;
        }
        if (!canEdit)
            return;
        if (tool === 'clipboard' && clipboardPhase === 'paste') {
            if (!clipboardPattern)
                return;
            /*
             * B25（用户 2026-09-22）：「iPad 端的粘贴逻辑应该为 **长按后预览显示放置位置、松手后再确定放到哪**，
             * 现在是一点它就直接放下了 ⇒ 位置容易错」。
             * 触摸：按下**先不落图**，只起长按计时器（叠加手势层 140ms 前摇 ⇒ 手感约 0.34s，与 B18 吸管镜子同一套）；
             *   到点且没怎么动 ⇒ 打开落位预览（复用 `drawClipboardPatternPreview`，由 `hoverPoint` 驱动）并跟手；
             *   松手才落图，落在**最后指向**的那一格；短按仍按老手感落在**按下**那一格。
             * 鼠标：**一个字没改**（按下即落）。
             */
            if (isTouch) {
                clearPastePress();
                pastePressRef.current.startX = clientX;
                pastePressRef.current.startY = clientY;
                pastePressRef.current.cell = { x: cell.x, y: cell.y };
                pastePressRef.current.pointerId = pointerId;
                pastePressRef.current.active = true;
                pastePressRef.current.fired = false;
                pastePressRef.current.timer = window.setTimeout(() => {
                    pastePressRef.current.timer = null;
                    if (!pastePressRef.current.active)
                        return;
                    pastePressRef.current.fired = true;
                    const p = canvasToGridPoint(pastePressRef.current.startX, pastePressRef.current.startY, false);
                    if (p)
                        setHoverPoint(p);
                }, LONG_PRESS_MS);
                return;
            }
            const next = pasteClipboardPattern(getActiveLayerCells(project), project.width, project.height, clipboardPattern, cell.x, cell.y);
            onCommitStart();
            onCellsChange(next);
            onPastePattern();
            return;
        }
        if (tool === 'move') {
            const activeCells = getActiveLayerCells(project);
            const startIndex = cell.y * project.width + cell.x;
            if (!activeCells[startIndex])
                return;
            const selectionIndices = moveMode === 'partial'
                ? collectConnectedOccupiedIndices(activeCells, project.width, project.height, cell.x, cell.y)
                : [];
            onCommitStart();
            draftCellsRef.current = activeCells.slice();
            pointerRef.current.drawing = true;
            pointerRef.current.movingPattern = true;
            pointerRef.current.lastGridX = point?.gridX ?? cell.x + 0.5;
            pointerRef.current.lastGridY = point?.gridY ?? cell.y + 0.5;
            pointerRef.current.moveStartCellX = Math.floor(point?.gridX ?? cell.x);
            pointerRef.current.moveStartCellY = Math.floor(point?.gridY ?? cell.y);
            pointerRef.current.moveLastDx = 0;
            pointerRef.current.moveLastDy = 0;
            pointerRef.current.moveOriginCells = activeCells.slice();
            pointerRef.current.moveSelectionIndices = selectionIndices;
            setActivePointerMode('move');
            return;
        }
        if (tool === 'mirror') {
            const activeCells = getActiveLayerCells(project);
            const startIndex = cell.y * project.width + cell.x;
            if (!activeCells[startIndex])
                return;
            const selectionIndices = mirrorMode === 'partial'
                ? collectConnectedOccupiedIndices(activeCells, project.width, project.height, cell.x, cell.y)
                : [];
            const next = mirrorCells(activeCells, project.width, project.height, mirrorDirection, selectionIndices);
            if (next === activeCells)
                return;
            onCommitStart();
            onCellsChange(next);
            return;
        }
        if (tool === 'shape') {
            onCommitStart();
            draftCellsRef.current = getActiveLayerCells(project).slice();
            pointerRef.current.drawing = true;
            pointerRef.current.shaping = true;
            pointerRef.current.shapeStartCellX = cell.x;
            pointerRef.current.shapeStartCellY = cell.y;
            pointerRef.current.shapeLastCellX = cell.x;
            pointerRef.current.shapeLastCellY = cell.y;
            setShapeDraft({
                kind: shapeKind,
                fillMode: shapeFillMode,
                arrowKind,
                start: { x: cell.x, y: cell.y },
                end: { x: cell.x, y: cell.y },
            });
            setActivePointerMode('shape');
            return;
        }
        if (tool === 'text') {
            const indices = collectTextIndices(textToolValue, textToolDirection, textToolSize, textToolSpacing, cell.x, cell.y, project.width, project.height);
            if (indices.length === 0)
                return;
            const next = getActiveLayerCells(project).slice();
            indices.forEach((index) => {
                next[index] = selectedColorId;
            });
            onCommitStart();
            onCellsChange(next);
            return;
        }
        onCommitStart();
        draftCellsRef.current = getActiveLayerCells(project).slice();
        if (tool === 'fill') {
            onCellsChange(floodFill(getActiveLayerCells(project), project.width, project.height, cell.x, cell.y, selectedColorId));
            return;
        }
        // 整片删除（原「消除」工具的三档，2026-09-20 并进橡皮的「范围」）。
        // 函数体与合并前逐字相同 —— 只是入口从"另一个工具"变成"同一个工具的另一档范围"。
        if (tool === 'eraser' && eraserScope !== 'brush') {
            const activeCells = getActiveLayerCells(project);
            const startIndex = cell.y * project.width + cell.x;
            if (!activeCells[startIndex])
                return;
            const next = activeCells.slice();
            const indices = eraserScope === 'same-connected'
                ? collectConnectedCellIndices(activeCells, project.width, project.height, cell.x, cell.y)
                : eraserScope === 'all-same-color'
                    ? collectSameColorIndices(activeCells, cell.x, cell.y, project.width)
                    : collectConnectedOccupiedIndices(activeCells, project.width, project.height, cell.x, cell.y);
            indices.forEach((index) => {
                next[index] = null;
            });
            onCellsChange(next);
            return;
        }
        pointerRef.current.drawing = true;
        pointerRef.current.lastCellX = cell.x;
        pointerRef.current.lastCellY = cell.y;
        pointerRef.current.lastGridX = point?.gridX ?? cell.x + 0.5;
        pointerRef.current.lastGridY = point?.gridY ?? cell.y + 0.5;
        applyTool(cell.x, cell.y, pointerRef.current.lastGridX, pointerRef.current.lastGridY);
    }
    function handlePointerMove(event) {
        const isTouch = event.pointerType === 'touch';
        // W1：触摸路径的三道闸 —— ①双指手势进行中不画 ②非本次操作的那根手指不画 ③触摸不产生 hover
        if (isTouch) {
            if (gestures.isGesturing())
                return;
            if (event.pointerId !== pointerRef.current.pointerId)
                return;
        }
        /*
         * B18：吸管长按放大镜的两条分支（都必须在其它工具逻辑之前短路，否则按住拖动会误触落笔）。
         *   ① 已经在放大预览 ⇒ 只更新镜子的位置与"指向哪一格"，什么都不画；
         *   ② 还在长按计时中，但手指移动超过容差 ⇒ 判定为拖动，取消这次长按
         *      （松手时按"短按"处理：吸按下那一格，与改动前一致）。
         */
        if (loupePressRef.current.fired) {
            const p = canvasToGridPoint(event.clientX, event.clientY, true);
            setLoupe((current) => ({
                cell: p?.cell ?? current?.cell ?? { x: 0, y: 0 },
                clientX: event.clientX,
                clientY: event.clientY,
            }));
            return;
        }
        /*
         * B25：粘贴的长按落位预览 —— 已进入预览态就**只跟手**（更新 `hoverPoint` 让落位预览跟着走），
         * 绝不能落到下面的落笔/平移逻辑里去；还没到点时移动超过容差 ⇒ 判为拖动、取消这次长按
         * （松手按短按处理 = 落在按下那一格，与改动前一致）。
         */
        if (pastePressRef.current.fired) {
            const p = canvasToGridPoint(event.clientX, event.clientY, false);
            if (p)
                setHoverPoint(p);
            return;
        }
        if (pastePressRef.current.timer !== null
            && (Math.abs(event.clientX - pastePressRef.current.startX) > LONG_PRESS_MOVE_TOL
                || Math.abs(event.clientY - pastePressRef.current.startY) > LONG_PRESS_MOVE_TOL)) {
            clearTimeout(pastePressRef.current.timer);
            pastePressRef.current.timer = null;
        }
        if (loupePressRef.current.timer !== null
            && (Math.abs(event.clientX - loupePressRef.current.startX) > LONG_PRESS_MOVE_TOL
                || Math.abs(event.clientY - loupePressRef.current.startY) > LONG_PRESS_MOVE_TOL)) {
            clearTimeout(loupePressRef.current.timer);
            loupePressRef.current.timer = null;
        }
        if (pointerRef.current.draggingReference) {
            const dx = (event.clientX - pointerRef.current.lastX) / (cellSize * zoom);
            const dy = (event.clientY - pointerRef.current.lastY) / (cellSize * zoom);
            pointerRef.current.lastX = event.clientX;
            pointerRef.current.lastY = event.clientY;
            pointerRef.current.referenceOffsetX += dx;
            pointerRef.current.referenceOffsetY += dy;
            onReferenceOffsetChange({
                x: pointerRef.current.referenceOffsetX,
                y: pointerRef.current.referenceOffsetY,
            });
            return;
        }
        if (pointerRef.current.panning) {
            const dx = event.clientX - pointerRef.current.lastX;
            const dy = event.clientY - pointerRef.current.lastY;
            pointerRef.current.lastX = event.clientX;
            pointerRef.current.lastY = event.clientY;
            setPan((current) => constrainPan({ x: current.x + dx, y: current.y + dy }, zoom));
            return;
        }
        const point = canvasToGridPoint(event.clientX, event.clientY, pointerRef.current.movingPattern);
        const cell = point?.cell ?? null;
        // W1：触摸不写 hover（触摸没有「悬停」语义；工具影响预览在触摸下由 shapeDraft / 格子本身表达）
        if (!isTouch) {
            setHoverPoint(point);
            // W5-P6b：hover 上报节流 —— 同一格内移动（x/y 不变）不上报 App，
            // 避免 setHoverCell → App 全量重渲染（4590 行组件树无 memo）。
            const hoverKey = cell ? `${cell.x},${cell.y}` : '';
            if (hoverKey !== lastHoverRef.current) {
                lastHoverRef.current = hoverKey;
                onHover(cell ? { ...cell, colorId: getTopVisibleColor(project, cell.y * project.width + cell.x) } : null);
            }
        }
        if (pointerRef.current.copySelecting) {
            if (cell) {
                applyCopySelection(linePoints(pointerRef.current.lastCellX, pointerRef.current.lastCellY, cell.x, cell.y));
                pointerRef.current.lastCellX = cell.x;
                pointerRef.current.lastCellY = cell.y;
            }
            return;
        }
        if (pointerRef.current.drawing && point) {
            if (pointerRef.current.shaping && cell) {
                if (cell.x !== pointerRef.current.shapeLastCellX || cell.y !== pointerRef.current.shapeLastCellY) {
                    pointerRef.current.shapeLastCellX = cell.x;
                    pointerRef.current.shapeLastCellY = cell.y;
                    setShapeDraft({
                        kind: shapeKind,
                        fillMode: shapeFillMode,
                        arrowKind,
                        start: { x: pointerRef.current.shapeStartCellX, y: pointerRef.current.shapeStartCellY },
                        end: { x: cell.x, y: cell.y },
                    });
                }
                return;
            }
            if (pointerRef.current.movingPattern) {
                const proposedDx = Math.floor(point.gridX) - pointerRef.current.moveStartCellX;
                const proposedDy = Math.floor(point.gridY) - pointerRef.current.moveStartCellY;
                const originCells = pointerRef.current.moveOriginCells.length > 0 ? pointerRef.current.moveOriginCells : draftCellsRef.current;
                const { dx, dy } = clampShiftDelta(originCells, project.width, project.height, proposedDx, proposedDy, pointerRef.current.moveSelectionIndices);
                if (pointerRef.current.moveSelectionIndices.length > 0 &&
                    !canShiftSelection(originCells, project.width, project.height, dx, dy, pointerRef.current.moveSelectionIndices)) {
                    return;
                }
                if (dx !== pointerRef.current.moveLastDx || dy !== pointerRef.current.moveLastDy) {
                    pointerRef.current.moveLastDx = dx;
                    pointerRef.current.moveLastDy = dy;
                    onCellsChange(shiftCells(originCells, project.width, project.height, dx, dy, pointerRef.current.moveSelectionIndices));
                }
                return;
            }
            if (tool === 'eraser' && !pointerRef.current.singleCellErasing) {
                drawBrushLine(pointerRef.current.lastGridX, pointerRef.current.lastGridY, point.gridX, point.gridY);
                pointerRef.current.lastGridX = point.gridX;
                pointerRef.current.lastGridY = point.gridY;
                if (cell) {
                    pointerRef.current.lastCellX = cell.x;
                    pointerRef.current.lastCellY = cell.y;
                }
                return;
            }
            if (cell) {
                drawLine(pointerRef.current.lastCellX, pointerRef.current.lastCellY, cell.x, cell.y, pointerRef.current.lastGridX, pointerRef.current.lastGridY, point.gridX, point.gridY);
                pointerRef.current.lastCellX = cell.x;
                pointerRef.current.lastCellY = cell.y;
                pointerRef.current.lastGridX = point.gridX;
                pointerRef.current.lastGridY = point.gridY;
            }
        }
    }
    function handlePointerUp(event, cancelled = false) {
        const isTouch = event.pointerType === 'touch';
        // W1：多指时抬起的那根手指不是本次操作的主指针 ⇒ 不结束主指针的绘制/平移
        if (isTouch && event.pointerId !== pointerRef.current.pointerId)
            return;
        /*
         * B18：吸管（触摸）的"到底吸哪一格"在这里决定：
         *   · 长按预览过（`fired`）⇒ 吸**松手时最后指向的那一格**（拿不到格子就退回按下那一格）；
         *   · 短按（没到长按时长就松手）⇒ 吸**按下那一格**，与改动前的手感完全一致。
         * `cancelled`（`pointercancel`，例如双指手势介入）⇒ 只收镜子、**不吸色**。
         * ⚠️ 手势进行中也不吸：那一次触摸已经属于画布手势（缩放/平移），不是"点一下取色"。
         */
        if (isTouch && tool === 'eyedropper' && loupePressRef.current.active) {
            const fired = loupePressRef.current.fired;
            const downCell = loupePressRef.current.cell;
            clearLoupePress();
            setLoupe(null);
            if (!cancelled && !gestures.isGesturing()) {
                const released = canvasToGridPoint(event.clientX, event.clientY, false)?.cell ?? null;
                const cell = (fired ? (released ?? downCell) : downCell);
                if (cell) {
                    const colorId = getTopVisibleColor(project, cell.y * project.width + cell.x);
                    if (colorId)
                        onPickColor(colorId);
                }
            }
        }
        /*
         * B25：粘贴（触摸）的"到底落在哪一格"在这里决定 ——
         *   长按预览过（`fired`）⇒ 落在**松手时最后指向**的那一格（拿不到格子就退回按下那一格）；
         *   短按 ⇒ 落在**按下那一格**，与改动前的手感完全一致；
         *   `cancelled`（`pointercancel`，双指手势介入等）⇒ 只收预览、**不落图**。
         */
        if (isTouch && tool === 'clipboard' && clipboardPhase === 'paste' && pastePressRef.current.active) {
            const fired = pastePressRef.current.fired;
            const downCell = pastePressRef.current.cell;
            clearPastePress();
            setHoverPoint(null);
            if (!cancelled && !gestures.isGesturing() && clipboardPattern && canEdit) {
                const released = canvasToGridPoint(event.clientX, event.clientY, false)?.cell ?? null;
                const cell = (fired ? (released ?? downCell) : downCell);
                if (cell) {
                    const next = pasteClipboardPattern(getActiveLayerCells(project), project.width, project.height, clipboardPattern, cell.x, cell.y);
                    onCommitStart();
                    onCellsChange(next);
                    onPastePattern();
                }
            }
        }
        if (pointerRef.current.shaping) {
            const draft = shapeDraft ?? {
                kind: shapeKind,
                fillMode: shapeFillMode,
                arrowKind,
                start: { x: pointerRef.current.shapeStartCellX, y: pointerRef.current.shapeStartCellY },
                end: { x: pointerRef.current.shapeLastCellX, y: pointerRef.current.shapeLastCellY },
            };
            const next = draftCellsRef.current.slice();
            collectShapeIndices(draft.kind, draft.fillMode, draft.arrowKind, draft.start, draft.end, project.width, project.height).forEach((index) => {
                next[index] = selectedColorId;
            });
            draftCellsRef.current = next;
            onCellsChange(next);
        }
        pointerRef.current.drawing = false;
        pointerRef.current.panning = false;
        pointerRef.current.erasing = false;
        pointerRef.current.singleCellErasing = false;
        pointerRef.current.movingPattern = false;
        pointerRef.current.draggingReference = false;
        pointerRef.current.copySelecting = false;
        pointerRef.current.shaping = false;
        pointerRef.current.moveOriginCells = [];
        pointerRef.current.moveSelectionIndices = [];
        pointerRef.current.copySelectionSet = new Set();
        setShapeDraft(null);
        setActivePointerMode(null);
        if (isTouch) {
            // 触摸抬起后不留 hover 预览
            setHoverPoint(null);
            lastHoverRef.current = null;
            onHover(null);
        }
        try {
            canvasRef.current?.releasePointerCapture(pointerRef.current.pointerId);
        }
        catch {
            /* 未持有捕获时忽略（触摸前摇被手势取消就会出现这种情况） */
        }
    }
    function handlePointerLeave() {
        setHoverPoint(null);
        lastHoverRef.current = null;
        onHover(null);
    }
    function handleWheel(event) {
        event.preventDefault();
        if (tool === 'text') {
            const nextSize = Math.min(72, Math.max(5, textToolSize + (event.deltaY > 0 ? -1 : 1)));
            if (nextSize !== textToolSize)
                onTextToolSizeChange(nextSize);
            return;
        }
        if (referenceImageAdjusting && referenceImageVisible) {
            const nextScale = Math.min(3, Math.max(0.25, referenceImageScale * (event.deltaY > 0 ? 0.94 : 1.06)));
            onReferenceScaleChange(nextScale);
            return;
        }
        const rect = event.currentTarget.getBoundingClientRect();
        const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        const before = screenToWorld(point.x, point.y);
        const nextZoom = Math.min(5, Math.max(0.12, zoom * (event.deltaY > 0 ? 0.9 : 1.1)));
        setZoom(nextZoom);
        setPan(constrainPan({
            x: point.x - before.x * nextZoom,
            y: point.y - before.y * nextZoom,
        }, nextZoom));
    }
    function fitToWindow() {
        const wrapper = wrapperRef.current;
        if (!wrapper)
            return;
        const availableWidth = wrapper.clientWidth - 88;
        const availableHeight = wrapper.clientHeight - 88;
        const patternWidth = project.width * cellSize;
        const patternHeight = project.height * cellSize;
        const nextZoom = Math.min(2.4, Math.max(0.12, Math.min(availableWidth / patternWidth, availableHeight / patternHeight)));
        setZoom(nextZoom);
        setPan({
            x: (wrapper.clientWidth - patternWidth * nextZoom) / 2,
            y: (wrapper.clientHeight - patternHeight * nextZoom) / 2,
        });
    }
    function stepZoom(multiplier) {
        const wrapper = wrapperRef.current;
        if (!wrapper)
            return;
        const point = { x: wrapper.clientWidth / 2, y: wrapper.clientHeight / 2 };
        const before = screenToWorld(point.x, point.y);
        const nextZoom = Math.min(5, Math.max(0.12, zoom * multiplier));
        setZoom(nextZoom);
        setPan(constrainPan({
            x: point.x - before.x * nextZoom,
            y: point.y - before.y * nextZoom,
        }, nextZoom));
    }
    function constrainPan(nextPan, nextZoom) {
        const wrapper = wrapperRef.current;
        if (!wrapper)
            return nextPan;
        const boardWidth = project.width * cellSize * nextZoom;
        const boardHeight = project.height * cellSize * nextZoom;
        const clampAxis = (value, viewportSize, contentSize) => {
            const visibleGuard = Math.max(32, Math.min(120, viewportSize * 0.36, contentSize * 0.55));
            const min = visibleGuard - contentSize;
            const max = viewportSize - visibleGuard;
            if (min > max)
                return (viewportSize - contentSize) / 2;
            return Math.min(max, Math.max(min, value));
        };
        return {
            x: clampAxis(nextPan.x, wrapper.clientWidth, boardWidth),
            y: clampAxis(nextPan.y, wrapper.clientHeight, boardHeight),
        };
    }
    function almostSamePoint(a, b) {
        return Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;
    }
    function applyTool(x, y, gridX = x + 0.5, gridY = y + 0.5) {
        const next = draftCellsRef.current.slice();
        const value = pointerRef.current.erasing || tool === 'eraser' ? null : selectedColorId;
        if (value === null && !pointerRef.current.singleCellErasing) {
            applyBrush(next, gridX, gridY, eraserSize, null, project.width, project.height);
        }
        else {
            next[y * project.width + x] = value;
        }
        draftCellsRef.current = next;
        onCellsChange(next);
    }
    function applyCopySelection(points) {
        const activeCells = getActiveLayerCells(project);
        const selected = pointerRef.current.copySelectionSet;
        let changed = false;
        points.forEach(({ x, y }) => {
            if (x < 0 || y < 0 || x >= project.width || y >= project.height)
                return;
            const index = y * project.width + x;
            if (!activeCells[index])
                return;
            if (pointerRef.current.copySelectionAction === 'add') {
                if (!selected.has(index)) {
                    selected.add(index);
                    changed = true;
                }
            }
            else if (selected.delete(index)) {
                changed = true;
            }
        });
        if (!changed)
            return;
        const indices = [...selected].filter((index) => Boolean(activeCells[index]));
        const pattern = indices.length > 0 ? createClipboardPattern(activeCells, project.width, indices) : null;
        onCopySelectionChange(indices, pattern);
    }
    function drawLine(fromX, fromY, toX, toY, fromGridX = fromX + 0.5, fromGridY = fromY + 0.5, toGridX = toX + 0.5, toGridY = toY + 0.5) {
        const dx = Math.abs(toX - fromX);
        const dy = Math.abs(toY - fromY);
        const gridDx = Math.abs(toGridX - fromGridX);
        const gridDy = Math.abs(toGridY - fromGridY);
        const steps = Math.max(dx, dy, Math.ceil(Math.max(gridDx, gridDy) * 2), 1);
        let next = draftCellsRef.current.slice();
        const value = pointerRef.current.erasing || tool === 'eraser' ? null : selectedColorId;
        for (let step = 0; step <= steps; step += 1) {
            const x = Math.round(fromX + ((toX - fromX) * step) / steps);
            const y = Math.round(fromY + ((toY - fromY) * step) / steps);
            if (value === null && !pointerRef.current.singleCellErasing) {
                const gridX = fromGridX + ((toGridX - fromGridX) * step) / steps;
                const gridY = fromGridY + ((toGridY - fromGridY) * step) / steps;
                applyBrush(next, gridX, gridY, eraserSize, null, project.width, project.height);
            }
            else {
                next[y * project.width + x] = value;
            }
        }
        draftCellsRef.current = next;
        onCellsChange(next);
    }
    function drawBrushLine(fromGridX, fromGridY, toGridX, toGridY) {
        const dx = Math.abs(toGridX - fromGridX);
        const dy = Math.abs(toGridY - fromGridY);
        const steps = Math.max(Math.ceil(Math.max(dx, dy) * 3), 1);
        const next = draftCellsRef.current.slice();
        for (let step = 0; step <= steps; step += 1) {
            const gridX = fromGridX + ((toGridX - fromGridX) * step) / steps;
            const gridY = fromGridY + ((toGridY - fromGridY) * step) / steps;
            applyBrush(next, gridX, gridY, eraserSize, null, project.width, project.height);
        }
        draftCellsRef.current = next;
        onCellsChange(next);
    }
    function canvasToGridPoint(clientX, clientY, allowOutside = false) {
        const canvas = canvasRef.current;
        if (!canvas)
            return null;
        const rect = canvas.getBoundingClientRect();
        const world = screenToWorld(clientX - rect.left, clientY - rect.top);
        const gridX = world.x / cellSize;
        const gridY = world.y / cellSize;
        const x = Math.floor(gridX);
        const y = Math.floor(gridY);
        const cell = x < 0 || y < 0 || x >= project.width || y >= project.height ? null : { x, y };
        if (!allowOutside && !cell && (gridX < -eraserSize || gridY < -eraserSize || gridX > project.width + eraserSize || gridY > project.height + eraserSize)) {
            return null;
        }
        return { cell, gridX, gridY };
    }
    function screenToWorld(x, y) {
        return {
            x: (x - pan.x) / zoom,
            y: (y - pan.y) / zoom,
        };
    }
    const canvasTool = activePointerMode === 'rightErase' ? 'eraser' : activePointerMode === 'pan' || activePointerMode === 'reference' || isSpaceDown ? 'pan' : activePointerMode === 'move' ? 'move' : activePointerMode === 'shape' ? 'shape' : tool;
    // 「橡皮」有两套语义（笔刷 / 整片删除），光标不同 ⇒ 单靠 `data-tool` 表达不了，再给一个范围属性。
    const canvasEraserScope = tool === 'eraser' || activePointerMode === 'rightErase' ? eraserScope : 'brush';
    const canvasClassName = [
        'canvas',
        activePointerMode === 'pan' ? 'is-panning' : '',
        referenceImageAdjusting && referenceImageVisible ? 'is-reference-adjusting' : '',
        activePointerMode === 'move' ? 'is-moving' : '',
        isSpaceDown ? 'can-pan' : '',
    ].filter(Boolean).join(' ');
    /*
     * B18：把**主画布自己的位图**放大画进镜子。
     * 为什么用 `drawImage(mainCanvas, …)` 而不是另写一套绘制：画布上已经有网格/坐标/单独显示高亮等
     * 好几层东西，重画必然与真实画面分叉；直接取那块像素 ⇒ 用户看到的就是"真实的那一格"。
     * `imageSmoothingEnabled = false`：像素画放大要"方块感"，不要模糊。
     * 再叠：目标格描边（一眼看出"要吸的是这一格"）+ 十字准星。
     */
    React.useEffect(() => {
        if (!loupe)
            return;
        const src = canvasRef.current;
        const dst = loupeCanvasRef.current;
        if (!src || !dst)
            return;
        const ctx = dst.getContext('2d');
        if (!ctx)
            return;
        const scale = cellSize * zoom;
        const cx = (loupe.cell.x + 0.5) * scale + pan.x;
        const cy = (loupe.cell.y + 0.5) * scale + pan.y;
        const srcW = dst.width / LOUPE_ZOOM;
        const srcH = dst.height / LOUPE_ZOOM;
        /*
         * B23（用户 2026-09-22 反馈截图：镜子里有色号、但放大画面是空的）：
         * **源矩形必须按 devicePixelRatio 换算成"位图像素"**。
         * 主画布是 `canvas.width = cssW × dpr` + `context.setTransform(dpr,0,0,dpr,0,0)`
         * ⇒ 画布**内容**用 CSS 像素坐标（`pan` / `cellSize*zoom` 都是 CSS 像素），
         * 而 `drawImage` 的**源矩形是位图像素**。dpr ≠ 1 时不换算 ⇒ 取样点偏到 dpr 倍远处，
         * 取到的是空白区域（实测 dpr=2：镜子里画笔色像素 **0** 个；dpr=1：**1156** 个）。
         * ⚠️ B18 的门禁把 dpr 钉死成 1，所以当时漏了；现在的门禁**必须**跑 dpr=2。
         * 目标画布（镜子自己那块 124×124）没有按 dpr 放大 ⇒ 目标坐标仍是 1:1，不换算。
         */
        const kx = src.width / (src.clientWidth || src.width || 1);
        const ky = src.height / (src.clientHeight || src.height || 1);
        ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = '#fffdf8';
        ctx.fillRect(0, 0, dst.width, dst.height);
        ctx.drawImage(src, (cx - srcW / 2) * kx, (cy - srcH / 2) * ky, srcW * kx, srcH * ky, 0, 0, dst.width, dst.height);
        const cellPx = scale * LOUPE_ZOOM;
        ctx.strokeStyle = 'rgba(23, 101, 106, 0.95)';
        ctx.lineWidth = 2;
        ctx.strokeRect(dst.width / 2 - cellPx / 2 + 1, dst.height / 2 - cellPx / 2 + 1, cellPx - 2, cellPx - 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.72)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, dst.height / 2);
        ctx.lineTo(dst.width, dst.height / 2);
        ctx.moveTo(dst.width / 2, 0);
        ctx.lineTo(dst.width / 2, dst.height);
        ctx.stroke();
    }, [loupe, cellSize, zoom, pan]);
    /* B18：换工具（或离开吸管）时把镜子收掉，别让它留在屏幕上。 */
    React.useEffect(() => {
        if (tool !== 'eyedropper') {
            clearLoupePress();
            setLoupe(null);
        }
    }, [tool]);
    /* B18：镜子里那行色号（与画布/用量同一口径 —— `formatColorCode` 由 App 给）。 */
    const loupeColorId = loupe ? getTopVisibleColor(project, loupe.cell.y * project.width + loupe.cell.x) : null;
    const loupeCode = loupeColorId ? (formatColorCode?.(loupeColorId) ?? '') : '';
    return (React.createElement("div", { className: "workspace", ref: wrapperRef },
        isGenerating && (React.createElement("div", { className: "workspace-generating" },
            React.createElement("div", { className: "workspace-busy-wrap" },
                React.createElement("div", { className: "workspace-busy", role: "status", "aria-live": "polite" },
                    React.createElement("span", { className: "workspace-spinner", "aria-hidden": "true" }),
                    React.createElement("span", null, generatingLabel)),
                React.createElement(GeneratingHeart, { label: "" })))),
        React.createElement("canvas", { ref: canvasRef, className: canvasClassName, "data-tool": canvasTool, "data-eraser-scope": canvasEraserScope, onContextMenu: (event) => event.preventDefault(), onPointerDown: handlePointerDown, onPointerMove: handlePointerMove, onPointerUp: handlePointerUp, onPointerCancel: (event) => handlePointerUp(event, true), onPointerLeave: handlePointerLeave, onWheel: handleWheel }),
        loupe && (() => {
            const wrap = wrapperRef.current;
            const w = wrap?.clientWidth ?? 0;
            const h = wrap?.clientHeight ?? 0;
            /*
             * B26（用户 2026-09-22 反馈的手机端 P1 之一）：**镜子边长按可用宽度缩**。
             * 124px 在 390 宽的手机上占 **32%** 视口宽（实测），偏大、挡视野；
             * 判据用**画布可用宽**而不是媒体查询：与"这是谁的设备"无关，窄抽屉/窄窗口一样受益。
             * iPad（画布 940）仍是 124 —— B18 门禁对 iPad 断言了 124，这条不破坏它。
             */
            const loupeSize = w > 0 && w < 520 ? 96 : 124;
            const x = loupe.clientX - (wrap?.getBoundingClientRect().left ?? 0);
            const y = loupe.clientY - (wrap?.getBoundingClientRect().top ?? 0);
            const left = Math.min(Math.max(8, x - loupeSize / 2), Math.max(8, w - loupeSize - 8));
            const above = y - loupeSize - 24;
            const top = above >= 8 ? above : Math.min(Math.max(8, y + 28), Math.max(8, h - loupeSize - 8));
            return (React.createElement("div", { className: "eyedropper-loupe", style: { left: `${Math.round(left)}px`, top: `${Math.round(top)}px`, width: loupeSize, height: loupeSize } },
                React.createElement("canvas", { ref: loupeCanvasRef, width: loupeSize, height: loupeSize }),
                React.createElement("span", { className: "eyedropper-loupe-code" }, loupeCode)));
        })(),
        React.createElement("div", { className: "board-chip" },
            project.width,
            " * ",
            project.height,
            React.createElement("span", { className: "board-chip-beads" },
                " \u00B7 ",
                totalBeads,
                " ",
                beadUnit)),
        panelLayout && (React.createElement("button", { type: "button", ref: paletteDotRef, className: paletteDotOpen ? 'palette-dot is-open' : 'palette-dot', "data-palette-dot": "1", "aria-label": paletteDotLabel, "aria-expanded": paletteDotOpen, title: paletteDotLabel, onClick: onPaletteDotClick },
            React.createElement("span", { className: "palette-dot-color", style: { backgroundColor: getColor(selectedColorId)?.hex } }))),
        React.createElement("div", { className: `canvas-status${noticeIsError ? ' is-error' : ''}`, role: noticeIsError ? 'alert' : 'status' },
            React.createElement("span", { className: "canvas-status-facts" }, statusFacts),
            React.createElement("strong", { className: "canvas-status-notice" }, notice)),
        !canEdit && React.createElement("div", { className: "canvas-lock-hint" }, lockedHint),
        referenceImageAdjusting && referenceImageVisible && (React.createElement("div", { className: "reference-adjust-hint" }, referenceAdjustHint)),
        React.createElement("div", { className: "zoom-controls", "aria-label": "Canvas zoom controls" },
            React.createElement("button", { onClick: () => stepZoom(0.9) }, "-"),
            React.createElement("span", null,
                Math.round(zoom * 100),
                "%"),
            React.createElement("button", { onClick: () => stepZoom(1.1) }, "+"),
            React.createElement("button", { onClick: fitToWindow }, fitLabel)),
        panelLayout && openPanel && React.createElement("div", { className: "panel-scrim", "aria-hidden": "true", onClick: () => setOpenPanel(null) })));
}
function drawPattern(context, project, cellSize, zoom, pan, highlightedColorId, highlightedCellIndices, tool, clipboardPhase, selectedColorId, eraserSize, eraserScope, moveMode, mirrorMode, clipboardPattern, copyMode, copySelectionIndices, shapeDraft, hoverPoint, canEdit, referenceImage, textToolValue, textToolDirection, textToolSize, textToolSpacing, formatColorCode) {
    // ⚠️ **必须 clearRect**（2026-10-20 事故回滚）：
    // 曾为省一半整屏像素操作把它删掉，理由是"紧接着的 fillRect 不透明、clear 多余"。
    // **这个理由是错的**：那个 fillRect 在 `translate(pan)` / `scale(zoom)` 之后，
    // 只覆盖"图纸矩形在屏幕上的投影"，**不是整块 canvas** ⇒ 图纸没盖住的区域保留上一帧
    // ⇒ 拖动时强残影、网格叠加错位。
    // 结论：**这一行不能省**。要省成本请走离屏缓存（O4），不要动这里。
    //
    // ⚠️⚠️ 2026-10-20 第二次事故（立体堆叠残影）根因：
    // 曾把这里改成 `canvas.width / canvas.clientWidth`（想"反推 dpr"），
    // **算错了方向** —— 得到的是 dpr（1.25）而不是 CSS 宽（1176），
    // 于是 `clearRect(0,0,1.25,1.25)` 只清了左上角一个点，其余全残留 ⇒ 拖动时旧帧堆成立体。
    //
    // **正确写法**：调用方已经 `context.setTransform(dpr,0,0,dpr,0,0)`，
    // 这个坐标系下的"画布宽高"**就是 CSS 像素尺寸**，直接取 `canvas.clientWidth/Height`。
    // 不要再用 `canvas.width / xxx` 反推任何东西——那是位图像素，不是这个坐标系的单位。
    const canvasWidth = context.canvas.clientWidth || context.canvas.width;
    const canvasHeight = context.canvas.clientHeight || context.canvas.height;
    context.clearRect(0, 0, canvasWidth, canvasHeight);
    context.fillStyle = '#f3f0e8';
    context.fillRect(0, 0, canvasWidth, canvasHeight);
    context.save();
    context.translate(pan.x, pan.y);
    context.scale(zoom, zoom);
    context.fillStyle = '#fffdf7';
    context.fillRect(0, 0, project.width * cellSize, project.height * cellSize);
    // W5-P5：**视口裁剪** —— 只画屏幕可见的格子区间。
    // 坐标系说明：`clearRect` 之后已 `translate(pan)` + `scale(zoom)`，
    // 此后的世界坐标 → 屏幕坐标 = `world * zoom + pan`；
    // `canvasWidth/Height` 是 CSS 像素（= clientWidth，已在上方修正），与这个坐标系一致。
    // 反解：world = (screen - pan) / zoom。
    // ⚠️ 依赖 `canvasWidth` 正确 —— 2026-10-20 的立体残影事故就是因为这个值算成了 dpr。
    const worldX0 = -pan.x / zoom;
    const worldY0 = -pan.y / zoom;
    const worldX1 = (canvasWidth - pan.x) / zoom;
    const worldY1 = (canvasHeight - pan.y) / zoom;
    const col0 = Math.max(0, Math.floor(worldX0 / cellSize));
    const row0 = Math.max(0, Math.floor(worldY0 / cellSize));
    const col1 = Math.min(project.width, Math.ceil(worldX1 / cellSize));
    const row1 = Math.min(project.height, Math.ceil(worldY1 / cellSize));
    const visibleLayers = (project.layers ?? []).filter((layer) => layer.visible);
    // W5-P3：单层快速路径。注释（见下方 drawBeadStack 附近）说明正常路径恒为 1 层，
    // 此时无需每格 map().filter() 分配两个数组 + N 个对象。
    const singleLayer = visibleLayers.length === 1 ? visibleLayers[0] : null;
    const highlightedCells = highlightedCellIndices.length > 0 ? new Set(highlightedCellIndices) : null;
    // W5-P1：色号字体/对齐在循环外设一次（原来每格都设一遍，2704 次 font setter）。
    //
    // 2026-10-20 P6：**色号显示门槛改成按「屏幕上的实际大小」判断**。
    // 原来写的是 `cellSize >= 16` —— 但 `cellSize` 是常量 18，这个条件**永远成立**，
    // 于是缩小到能看全 180×180 时仍然每帧画 32,400 个色号（屏幕上每格才 3.6px，根本看不清）。
    // 现在要求 `cellSize * zoom >= 16`（屏幕像素）：缩放到格子小于 16px 就不画色号，
    // 放大回去自动恢复。这是「180 格 + 色号 + 缩小」卡顿的直接原因。
    //
    // ⚠️ 注意坐标系：此处已经在 `scale(zoom)` 之后，`cellSize` 是**世界单位**，
    // 屏幕尺寸 = `cellSize * zoom`。而下面的 `context.font` 也必须用世界单位
    // （`cellSize * 0.3`），它会随 zoom 一起放大 —— 两者不能混。
    const codeCellScreenSize = cellSize * zoom;
    const showColorCodes = Boolean(project.settings.showColorCodes) && codeCellScreenSize >= COLOR_CODE_MIN_SCREEN_CELL;
    if (showColorCodes) {
        context.font = `${Math.max(7, cellSize * 0.3)}px Arial`;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
    }
    if (referenceImage.visible && referenceImage.placement === 'below') {
        drawReferenceImage(context, project, cellSize, referenceImage);
    }
    for (let y = row0; y < row1; y += 1) {
        for (let x = col0; x < col1; x += 1) {
            const index = y * project.width + x;
            let stack;
            if (singleLayer) {
                const colorId = singleLayer.cells?.[index];
                stack = colorId ? [{ layer: singleLayer, colorId }] : EMPTY_BEAD_STACK;
            }
            else {
                stack = visibleLayers
                    .map((layer) => ({ layer, colorId: layer.cells?.[index] }))
                    .filter((item) => Boolean(item.colorId));
            }
            const topColorId = stack.length > 0 ? stack[stack.length - 1].colorId : null;
            const topColor = getColor(topColorId);
            const left = x * cellSize;
            const top = y * cellSize;
            if (project.settings.beadDisplayMode === 'bead') {
                drawBeadStack(context, stack, left, top, cellSize);
            }
            else if (topColor) {
                context.fillStyle = topColor.hex;
                context.fillRect(left, top, cellSize, cellSize);
            }
            // B33：这里原来还有一段「重叠格子」叠加（`drawStackOverlay`）——
            //      只在 `stack.length > 1`（同一格有 ≥2 个可见图层都放了豆）时才画徽章/色带。
            //      B6 之后正常路径上恒为 1 层 ⇒ 永远不触发；用户 2026-09-22 决定连同视图开关一起去掉。
            //      （多图层的**渲染**本身不变：上面的 `drawBeadStack` 仍按图层栈画。数据模型字段保留。）
            if (highlightedColorId && topColorId !== highlightedColorId) {
                context.fillStyle = 'rgba(255, 255, 255, 0.72)';
                context.fillRect(left, top, cellSize, cellSize);
            }
            if (highlightedCells?.has(index) && topColorId) {
                drawCellAlert(context, left, top, cellSize);
            }
            if (showColorCodes && topColor) {
                // W5-P1：font/textAlign/textBaseline 已在循环外设过一次，这里只改随格变化的颜色。
                context.fillStyle = readableTextColor(topColor.rgb);
                context.fillText(formatColorCode?.(topColor.id) ?? topColor.primaryCode, left + cellSize / 2, top + cellSize / 2);
            }
        }
    }
    if (referenceImage.visible && referenceImage.placement === 'above') {
        drawReferenceImage(context, project, cellSize, referenceImage);
    }
    if (tool === 'clipboard' && clipboardPhase === 'copy' && copyMode === 'selection' && copySelectionIndices.length > 0) {
        drawCopySelectionSet(context, copySelectionIndices, project.width, cellSize);
    }
    if (hoverPoint && (canEdit || tool === 'eyedropper' || tool === 'clipboard')) {
        drawToolImpactPreview(context, project, tool, clipboardPhase, selectedColorId, hoverPoint, eraserSize, eraserScope, moveMode, mirrorMode, clipboardPattern, copyMode, copySelectionIndices, textToolValue, textToolDirection, textToolSize, textToolSpacing, cellSize);
    }
    if (shapeDraft && canEdit) {
        const indices = collectShapeIndices(shapeDraft.kind, shapeDraft.fillMode, shapeDraft.arrowKind, shapeDraft.start, shapeDraft.end, project.width, project.height);
        drawShapePreview(context, indices, project.width, cellSize, selectedColorId);
    }
    else if (tool === 'shape' && hoverPoint?.cell && canEdit) {
        const index = hoverPoint.cell.y * project.width + hoverPoint.cell.x;
        drawShapePreview(context, [index], project.width, cellSize, selectedColorId);
    }
    if (project.settings.showGrid)
        drawGrid(context, project, cellSize, col0, row0, col1, row1);
    if (project.settings.showPegboardBoundaries)
        drawPegboardBoundaries(context, project, cellSize);
    if (project.settings.showCoordinates && cellSize * zoom > 10)
        drawCoordinates(context, project, cellSize, col0, row0, col1, row1);
    // 笔刷光标只在「笔刷」档下画；整片删除没有半径概念。
    if (tool === 'eraser' && eraserScope === 'brush' && hoverPoint && canEdit && eraserSize > 0) {
        drawBrushCursor(context, hoverPoint.gridX, hoverPoint.gridY, eraserSize, cellSize);
    }
    context.restore();
}
function drawBrushCursor(context, centerX, centerY, size, cellSize) {
    const diameter = Math.max(0.25, size);
    const radius = (diameter * cellSize) / 2;
    const x = centerX * cellSize;
    const y = centerY * cellSize;
    const visibleRadius = Math.max(2, radius);
    context.save();
    context.beginPath();
    context.arc(x, y, visibleRadius, 0, Math.PI * 2);
    context.fillStyle = 'rgba(255, 255, 255, 0.12)';
    context.fill();
    context.lineWidth = Math.max(1, cellSize * 0.055);
    context.strokeStyle = 'rgba(17, 24, 39, 0.48)';
    context.setLineDash([cellSize * 0.22, cellSize * 0.18]);
    context.stroke();
    context.beginPath();
    context.arc(x, y, visibleRadius, 0, Math.PI * 2);
    context.strokeStyle = 'rgba(255, 255, 255, 0.68)';
    context.lineWidth = Math.max(0.6, cellSize * 0.025);
    context.setLineDash([]);
    context.stroke();
    context.restore();
}
function drawShapePreview(context, indices, width, cellSize, selectedColorId) {
    if (indices.length === 0)
        return;
    const color = getColor(selectedColorId);
    context.save();
    if (color) {
        context.fillStyle = hexToRgba(color.hex, 0.32);
        indices.forEach((index) => {
            const x = index % width;
            const y = Math.floor(index / width);
            context.fillRect(x * cellSize + 2, y * cellSize + 2, cellSize - 4, cellSize - 4);
        });
    }
    drawCellBoundarySet(context, indices, width, cellSize);
    context.restore();
}
function drawClipboardPatternPreview(context, pattern, startX, startY, boardWidth, boardHeight, cellSize) {
    const indices = [];
    context.save();
    pattern.cells.forEach((colorId, index) => {
        if (!colorId)
            return;
        const x = startX + (index % pattern.width);
        const y = startY + Math.floor(index / pattern.width);
        if (x < 0 || y < 0 || x >= boardWidth || y >= boardHeight)
            return;
        const color = getColor(colorId);
        if (color) {
            context.fillStyle = hexToRgba(color.hex, 0.34);
            context.fillRect(x * cellSize + 2, y * cellSize + 2, cellSize - 4, cellSize - 4);
        }
        indices.push(y * boardWidth + x);
    });
    drawCellBoundarySet(context, indices, boardWidth, cellSize);
    context.restore();
}
function drawToolImpactPreview(context, project, tool, clipboardPhase, selectedColorId, hoverPoint, eraserSize, eraserScope, moveMode, mirrorMode, clipboardPattern, copyMode, copySelectionIndices, textToolValue, textToolDirection, textToolSize, textToolSpacing, cellSize) {
    if (tool === 'eraser' && eraserScope === 'brush') {
        if (eraserSize <= 0)
            return;
        const indices = collectBrushIndices(hoverPoint.gridX, hoverPoint.gridY, eraserSize, project.width, project.height);
        drawCellSet(context, indices, project.width, cellSize, {
            fill: 'rgba(185, 58, 50, 0.08)',
            stroke: 'rgba(185, 58, 50, 0.42)',
            lineWidth: 1,
        });
        return;
    }
    if (tool === 'fill') {
        if (!hoverPoint.cell)
            return;
        const indices = collectFloodFillIndices(getActiveLayerCells(project), project.width, project.height, hoverPoint.cell.x, hoverPoint.cell.y, selectedColorId);
        drawCellSet(context, indices, project.width, cellSize, {
            fill: 'rgba(23, 101, 106, 0.06)',
            stroke: 'rgba(23, 101, 106, 0.34)',
            lineWidth: 1,
        });
        return;
    }
    // 整片删除的悬停预览（原「消除」工具；现在挂在橡皮的整片档上）。
    if (tool === 'eraser' && eraserScope !== 'brush') {
        if (!hoverPoint.cell)
            return;
        const cells = getActiveLayerCells(project);
        const startIndex = hoverPoint.cell.y * project.width + hoverPoint.cell.x;
        if (!cells[startIndex])
            return;
        const indices = eraserScope === 'same-connected'
            ? collectConnectedCellIndices(cells, project.width, project.height, hoverPoint.cell.x, hoverPoint.cell.y)
            : eraserScope === 'all-same-color'
                ? collectSameColorIndices(cells, hoverPoint.cell.x, hoverPoint.cell.y, project.width)
                : collectConnectedOccupiedIndices(cells, project.width, project.height, hoverPoint.cell.x, hoverPoint.cell.y);
        drawCellSet(context, indices, project.width, cellSize, {
            fill: 'rgba(185, 58, 50, 0.065)',
            stroke: 'rgba(185, 58, 50, 0.34)',
            lineWidth: 1,
        });
        return;
    }
    if (tool === 'move') {
        if (!hoverPoint.cell)
            return;
        const cells = getActiveLayerCells(project);
        const startIndex = hoverPoint.cell.y * project.width + hoverPoint.cell.x;
        if (!cells[startIndex])
            return;
        const indices = moveMode === 'partial'
            ? collectConnectedOccupiedIndices(cells, project.width, project.height, hoverPoint.cell.x, hoverPoint.cell.y)
            : cells.flatMap((colorId, index) => (colorId ? [index] : []));
        drawCellBoundarySet(context, indices, project.width, cellSize);
        return;
    }
    if (tool === 'clipboard' && clipboardPhase === 'copy') {
        if (!hoverPoint.cell)
            return;
        const cells = getActiveLayerCells(project);
        const startIndex = hoverPoint.cell.y * project.width + hoverPoint.cell.x;
        if (!cells[startIndex])
            return;
        if (copyMode === 'selection') {
            if (copySelectionIndices.includes(startIndex))
                return;
            drawCopySelectionSet(context, [startIndex], project.width, cellSize, 0.7);
            return;
        }
        const indices = collectConnectedOccupiedIndices(cells, project.width, project.height, hoverPoint.cell.x, hoverPoint.cell.y);
        drawCellBoundarySet(context, indices, project.width, cellSize);
        return;
    }
    if (tool === 'clipboard' && clipboardPhase === 'paste') {
        if (!hoverPoint.cell || !clipboardPattern)
            return;
        drawClipboardPatternPreview(context, clipboardPattern, hoverPoint.cell.x, hoverPoint.cell.y, project.width, project.height, cellSize);
        return;
    }
    if (tool === 'mirror') {
        if (!hoverPoint.cell)
            return;
        const cells = getActiveLayerCells(project);
        const startIndex = hoverPoint.cell.y * project.width + hoverPoint.cell.x;
        if (!cells[startIndex])
            return;
        const indices = mirrorMode === 'partial'
            ? collectConnectedOccupiedIndices(cells, project.width, project.height, hoverPoint.cell.x, hoverPoint.cell.y)
            : cells.flatMap((colorId, index) => (colorId ? [index] : []));
        drawCellBoundarySet(context, indices, project.width, cellSize);
        return;
    }
    if (tool === 'recolor') {
        if (!hoverPoint.cell)
            return;
        const sourceColorId = getTopVisibleColor(project, hoverPoint.cell.y * project.width + hoverPoint.cell.x);
        // 与 `handlePointerDown` 同口径：和后端真正会用的**目标色**比（可能不是画笔色）。
        if (!sourceColorId || sourceColorId === selectedColorId)
            return;
        const indices = collectRecolorIndices(project, sourceColorId);
        drawCellSet(context, indices, project.width, cellSize, {
            fill: 'rgba(240, 200, 75, 0.18)',
            stroke: 'rgba(23, 101, 106, 0.74)',
            lineWidth: 1.55,
        });
        return;
    }
    if (tool === 'text') {
        if (!hoverPoint.cell)
            return;
        const indices = collectTextIndices(textToolValue, textToolDirection, textToolSize, textToolSpacing, hoverPoint.cell.x, hoverPoint.cell.y, project.width, project.height);
        drawShapePreview(context, indices, project.width, cellSize, selectedColorId);
        return;
    }
    if (tool === 'pencil')
        return;
    if (tool !== 'eyedropper' || !hoverPoint.cell)
        return;
    drawCellSet(context, [hoverPoint.cell.y * project.width + hoverPoint.cell.x], project.width, cellSize, {
        stroke: 'rgba(90, 78, 38, 0.62)',
        lineWidth: 1.2,
    });
}
function drawCellBoundarySet(context, indices, width, cellSize) {
    if (indices.length === 0)
        return;
    const selected = new Set(indices);
    context.save();
    context.fillStyle = 'rgba(23, 101, 106, 0.045)';
    indices.forEach((index) => {
        const x = index % width;
        const y = Math.floor(index / width);
        context.fillRect(x * cellSize + 1, y * cellSize + 1, cellSize - 2, cellSize - 2);
    });
    context.strokeStyle = 'rgba(255, 255, 255, 0.92)';
    context.lineWidth = Math.max(2.4, cellSize * 0.16);
    context.lineCap = 'square';
    context.lineJoin = 'miter';
    strokeCellBoundary(context, indices, selected, width, cellSize);
    context.strokeStyle = 'rgba(23, 101, 106, 0.92)';
    context.lineWidth = Math.max(1.2, cellSize * 0.075);
    strokeCellBoundary(context, indices, selected, width, cellSize);
    context.restore();
}
function drawCopySelectionSet(context, indices, width, cellSize, alpha = 1) {
    if (indices.length === 0)
        return;
    context.save();
    indices.forEach((index) => {
        const x = index % width;
        const y = Math.floor(index / width);
        const centerX = x * cellSize + cellSize / 2;
        const centerY = y * cellSize + cellSize / 2;
        const radius = cellSize * 0.39;
        context.beginPath();
        context.arc(centerX, centerY, radius, 0, Math.PI * 2);
        context.fillStyle = `rgba(23, 101, 106, ${0.16 * alpha})`;
        context.fill();
        context.lineWidth = Math.max(2.2, cellSize * 0.13);
        context.strokeStyle = `rgba(255, 255, 255, ${0.92 * alpha})`;
        context.stroke();
        context.beginPath();
        context.arc(centerX, centerY, radius, 0, Math.PI * 2);
        context.lineWidth = Math.max(1.25, cellSize * 0.075);
        context.strokeStyle = `rgba(23, 101, 106, ${0.96 * alpha})`;
        context.stroke();
        context.beginPath();
        context.arc(centerX, centerY, Math.max(1.8, cellSize * 0.12), 0, Math.PI * 2);
        context.fillStyle = `rgba(23, 101, 106, ${0.9 * alpha})`;
        context.fill();
    });
    context.restore();
}
function strokeCellBoundary(context, indices, selected, width, cellSize) {
    indices.forEach((index) => {
        const x = index % width;
        const y = Math.floor(index / width);
        const left = x * cellSize;
        const top = y * cellSize;
        const right = left + cellSize;
        const bottom = top + cellSize;
        const topNeighbor = index - width;
        const bottomNeighbor = index + width;
        const leftNeighbor = x > 0 ? index - 1 : -1;
        const rightNeighbor = x < width - 1 ? index + 1 : -1;
        if (!selected.has(topNeighbor)) {
            context.beginPath();
            context.moveTo(left, top);
            context.lineTo(right, top);
            context.stroke();
        }
        if (!selected.has(rightNeighbor)) {
            context.beginPath();
            context.moveTo(right, top);
            context.lineTo(right, bottom);
            context.stroke();
        }
        if (!selected.has(bottomNeighbor)) {
            context.beginPath();
            context.moveTo(left, bottom);
            context.lineTo(right, bottom);
            context.stroke();
        }
        if (!selected.has(leftNeighbor)) {
            context.beginPath();
            context.moveTo(left, top);
            context.lineTo(left, bottom);
            context.stroke();
        }
    });
}
function drawCellSet(context, indices, width, cellSize, style) {
    if (indices.length === 0)
        return;
    context.save();
    if (style.fill)
        context.fillStyle = style.fill;
    context.strokeStyle = style.stroke;
    context.lineWidth = style.lineWidth;
    indices.forEach((index) => {
        const x = index % width;
        const y = Math.floor(index / width);
        const left = x * cellSize;
        const top = y * cellSize;
        if (style.fill)
            context.fillRect(left + 1, top + 1, cellSize - 2, cellSize - 2);
        context.strokeRect(left + 1.5, top + 1.5, cellSize - 3, cellSize - 3);
    });
    context.restore();
}
function drawReferenceImage(context, project, cellSize, reference) {
    if (!reference.image)
        return;
    const bounds = { x: 0, y: 0, width: project.width, height: project.height };
    if (bounds.width <= 0 || bounds.height <= 0)
        return;
    context.save();
    context.globalAlpha = Math.max(0.05, Math.min(0.9, reference.opacity));
    context.imageSmoothingEnabled = true;
    const scale = Math.max(0.25, Math.min(3, reference.scale));
    const imageWidth = reference.image.naturalWidth || reference.image.width;
    const imageHeight = reference.image.naturalHeight || reference.image.height;
    const imageRatio = imageWidth > 0 && imageHeight > 0 ? imageWidth / imageHeight : bounds.width / bounds.height;
    const boundsRatio = bounds.width / bounds.height;
    const fitWidth = imageRatio >= boundsRatio ? bounds.width : bounds.height * imageRatio;
    const fitHeight = imageRatio >= boundsRatio ? bounds.width / imageRatio : bounds.height;
    const drawWidth = fitWidth * scale;
    const drawHeight = fitHeight * scale;
    const drawX = bounds.x + (bounds.width - drawWidth) / 2 + reference.offset.x;
    const drawY = bounds.y + (bounds.height - drawHeight) / 2 + reference.offset.y;
    context.drawImage(reference.image, drawX * cellSize, drawY * cellSize, drawWidth * cellSize, drawHeight * cellSize);
    context.restore();
}
function drawGrid(context, project, cellSize, col0, row0, col1, row1) {
    context.strokeStyle = '#d6d3cc';
    context.lineWidth = 1;
    // W5-P5：只画可见区间的网格线（大图 156×156 时从 314 条降到几十条）。
    // 线段端点也收缩到可见范围，避免画到屏幕外的长线段。
    for (let x = col0; x <= col1; x += 1) {
        context.beginPath();
        context.moveTo(x * cellSize, row0 * cellSize);
        context.lineTo(x * cellSize, row1 * cellSize);
        context.stroke();
    }
    for (let y = row0; y <= row1; y += 1) {
        context.beginPath();
        context.moveTo(col0 * cellSize, y * cellSize);
        context.lineTo(col1 * cellSize, y * cellSize);
        context.stroke();
    }
}
function drawCoordinates(context, project, cellSize, col0, row0, col1, row1) {
    context.fillStyle = 'rgba(17,24,39,0.45)';
    context.font = '8px Arial';
    context.textAlign = 'left';
    context.textBaseline = 'top';
    // W5-P5：坐标数字跟着**可见区域**走 —— 原来固定画在图纸左上角，
    // 平移/放大后那两块早就跑到屏幕外了，数字也跟着消失。
    // 现在钉在可见区间的起始格上（与滚动表格的"行号跟随"同理），任何位置都看得到。
    const anchorX = col0 * cellSize + 2;
    const anchorY = row0 * cellSize + 2;
    // 从"可见起点所在的那条 5 的倍数"开始，保证数字位置稳定（不会随平移抖动）。
    const startX = Math.ceil(col0 / 5) * 5;
    const startY = Math.ceil(row0 / 5) * 5;
    for (let x = startX; x < col1; x += 5) {
        context.fillText(String(x + 1), x * cellSize + 2, anchorY);
    }
    for (let y = startY; y < row1; y += 5) {
        context.fillText(String(y + 1), anchorX, y * cellSize + 2);
    }
}
function drawPegboardBoundaries(context, project, cellSize) {
    const verticalGuides = guideLineCenters(project.width, project.boardSettings.boardWidth, cellSize);
    const horizontalGuides = guideLineCenters(project.height, project.boardSettings.boardHeight, cellSize);
    context.save();
    context.strokeStyle = 'rgba(54, 102, 108, 0.32)';
    context.lineWidth = 1.25;
    context.setLineDash([4, 6]);
    verticalGuides.forEach((x) => {
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, project.height * cellSize);
        context.stroke();
    });
    horizontalGuides.forEach((y) => {
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(project.width * cellSize, y);
        context.stroke();
    });
    context.setLineDash([]);
    context.restore();
}
function drawBeadStack(context, stack, left, top, cellSize) {
    if (stack.length === 0)
        return;
    const topItem = stack[stack.length - 1];
    const color = getColor(topItem.colorId);
    if (!color)
        return;
    context.globalAlpha = Number.isFinite(topItem.layer.opacity) ? topItem.layer.opacity : 1;
    context.beginPath();
    context.fillStyle = color.hex;
    context.arc(left + cellSize / 2, top + cellSize / 2, cellSize * 0.42, 0, Math.PI * 2);
    context.fill();
    if (isLightColor(color.rgb)) {
        context.strokeStyle = 'rgba(17, 24, 39, 0.22)';
        context.lineWidth = Math.max(1, cellSize * 0.055);
        context.stroke();
    }
    context.globalAlpha = 1;
}
function drawCellAlert(context, left, top, cellSize) {
    const centerX = left + cellSize / 2;
    const centerY = top + cellSize / 2;
    const radius = cellSize * 0.43;
    const badgeRadius = Math.max(4.2, cellSize * 0.23);
    const badgeX = left + cellSize - badgeRadius - 1.4;
    const badgeY = top + badgeRadius + 1.4;
    context.save();
    context.beginPath();
    context.fillStyle = 'rgba(255, 193, 7, 0.28)';
    context.arc(centerX, centerY, radius, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = 'rgba(185, 58, 50, 0.95)';
    context.lineWidth = Math.max(1.6, cellSize * 0.11);
    context.stroke();
    context.beginPath();
    context.fillStyle = '#b93a32';
    context.arc(badgeX, badgeY, badgeRadius, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#ffffff';
    context.font = `${Math.max(8, badgeRadius * 1.65)}px Arial`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('!', badgeX, badgeY + 0.3);
    context.restore();
}
//# sourceMappingURL=WorkspaceCanvas.js.map