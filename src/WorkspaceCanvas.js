import { getColor } from './palette.js';
import { CloseIcon } from './icons.js';
// 本仓库**没有打包器**：`react-dom` 没有 import-map 条目（只有 `react-dom/client`），
// `ReactDOM` 是 `vendor/react-dom.production.min.js` 挂上的 UMD 全局；`src/global.d.ts`
// 里只声明了 `createRoot`。portal 需要 `createPortal` ⇒ 就地收窄类型，
// **不去改 `global.d.ts`**（它不在本轮允许改动的文件清单里）。
const reactDomPortal = ReactDOM;
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
export default function WorkspaceCanvas({ project, selectedColorId, highlightedColorId, highlightedCellIndices, formatColorCode, tool, eraserSize, eraserScope, moveMode, mirrorMode, mirrorDirection, shapeKind, shapeFillMode, arrowKind, textToolValue, textToolDirection, textToolSize, textToolSpacing, onTextToolSizeChange, referenceImageUrl, referenceImageVisible, referenceImageOpacity, referenceImageScale, referenceImageOffset, referenceImageAdjusting, referenceImagePlacement, referenceAdjustHint, onReferenceOffsetChange, onReferenceScaleChange, clipboardPattern, clipboardPhase, copyMode, copySelectionIndices, onCommitStart, onCellsChange, onReplaceColor, onCopyPattern, onCopySelectionChange, onPastePattern, onPickColor, onHover, fitLabel, canEdit, lockedHint, totalBeads, beadUnit, statusFacts, notice, noticeIsError, openPanel, setOpenPanel, panelLayout, paletteDotOpen, onPaletteDotClick, onPaletteDotCanvasPointerDown, paletteDotRef, paletteDotLabel, }) {
    const canvasRef = useRef(null);
    const wrapperRef = useRef(null);
    const draftCellsRef = useRef(getActiveLayerCells(project));
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isSpaceDown, setIsSpaceDown] = useState(false);
    const [hoverPoint, setHoverPoint] = useState(null);
    const [shapeDraft, setShapeDraft] = useState(null);
    const [referenceImage, setReferenceImage] = useState(null);
    const [activePointerMode, setActivePointerMode] = useState(null);
    // W3：`openPanel` / `panelLayout` 已提升到 `App`（见 `Props` 里的注释）。
    // W1/W2：**抽屉内可见关闭按钮的挂载点**。抽屉的 DOM 属于 `App.tsx` 的两个 `<aside>`，
    // 这里不该为它大改 ⇒ 仍用 portal 挂进去。宿主必须**挂载之后**才查得到 ⇒ 存在 state 里（首帧为 null）。
    // ⚠️ 顶栏那个 `toggles` 宿主**第 3 批已删除**：开关不再放在顶栏，改成工具条上的 3 个面板入口。
    const [panelHosts, setPanelHosts] = useState({ left: null, right: null });
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
    // portal 宿主：左右抽屉本身（顶栏那个 `toggles` 宿主第 3 批已随开关一起删除）。
    useEffect(() => {
        setPanelHosts({
            left: document.querySelector('.left-panel'),
            right: document.querySelector('.right-panel'),
        });
    }, []);
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
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.floor(wrapper.clientWidth * dpr);
        canvas.height = Math.floor(wrapper.clientHeight * dpr);
        canvas.style.width = `${wrapper.clientWidth}px`;
        canvas.style.height = `${wrapper.clientHeight}px`;
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawPattern(context, project, cellSize, zoom, pan, highlightedColorId, highlightedCellIndices, tool, clipboardPhase, selectedColorId, eraserSize, eraserScope, moveMode, mirrorMode, clipboardPattern, copyMode, copySelectionIndices, shapeDraft, hoverPoint, canEdit, referenceImageOptions, textToolValue, textToolDirection, textToolSize, textToolSpacing, formatColorCode);
    }, [project, cellSize, zoom, pan, highlightedColorId, highlightedCellIndices, tool, clipboardPhase, selectedColorId, eraserSize, eraserScope, moveMode, mirrorMode, clipboardPattern, copyMode, copySelectionIndices, shapeKind, shapeDraft, hoverPoint, canEdit, referenceImageOptions, textToolValue, textToolDirection, textToolSize, textToolSpacing, formatColorCode]);
    useEffect(() => {
        const observer = new ResizeObserver(() => {
            const canvas = canvasRef.current;
            const wrapper = wrapperRef.current;
            if (!canvas || !wrapper)
                return;
            const dpr = window.devicePixelRatio || 1;
            canvas.width = Math.floor(wrapper.clientWidth * dpr);
            canvas.height = Math.floor(wrapper.clientHeight * dpr);
            canvas.style.width = `${wrapper.clientWidth}px`;
            canvas.style.height = `${wrapper.clientHeight}px`;
            const context = canvas.getContext('2d');
            if (context) {
                context.setTransform(dpr, 0, 0, dpr, 0, 0);
                drawPattern(context, project, cellSize, zoom, pan, highlightedColorId, highlightedCellIndices, tool, clipboardPhase, selectedColorId, eraserSize, eraserScope, moveMode, mirrorMode, clipboardPattern, copyMode, copySelectionIndices, shapeDraft, hoverPoint, canEdit, referenceImageOptions, textToolValue, textToolDirection, textToolSize, textToolSpacing, formatColorCode);
            }
            setPan((current) => {
                const next = constrainPan(current, zoom);
                return almostSamePoint(current, next) ? current : next;
            });
        });
        if (wrapperRef.current)
            observer.observe(wrapperRef.current);
        return () => observer.disconnect();
    }, [project, cellSize, zoom, pan, highlightedColorId, highlightedCellIndices, tool, clipboardPhase, selectedColorId, eraserSize, eraserScope, moveMode, mirrorMode, clipboardPattern, copyMode, copySelectionIndices, shapeKind, shapeDraft, hoverPoint, canEdit, referenceImageOptions, textToolValue, textToolDirection, textToolSize, textToolSpacing, formatColorCode]);
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
            onHover(cell ? { ...cell, colorId: getTopVisibleColor(project, cell.y * project.width + cell.x) } : null);
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
        panelLayout && openPanel === 'left' && panelHosts.left && reactDomPortal.createPortal(React.createElement("div", { className: "panel-close-row" },
            React.createElement("button", { type: "button", className: "panel-close-button", "aria-label": "\u5173\u95ED\u9762\u677F / Close panel", title: "\u5173\u95ED\u9762\u677F / Close panel", onClick: () => setOpenPanel(null) },
                React.createElement(CloseIcon, null))), panelHosts.left),
        panelLayout && openPanel === 'right' && panelHosts.right && reactDomPortal.createPortal(React.createElement("div", { className: "panel-close-row" },
            React.createElement("button", { type: "button", className: "panel-close-button", "aria-label": "\u5173\u95ED\u53F3\u4FA7\u9762\u677F / Close right panel", title: "\u5173\u95ED\u53F3\u4FA7\u9762\u677F / Close right panel", onClick: () => setOpenPanel(null) },
                React.createElement(CloseIcon, null))), panelHosts.right),
        panelLayout && openPanel && React.createElement("div", { className: "panel-scrim", "aria-hidden": "true", onClick: () => setOpenPanel(null) })));
}
function drawPattern(context, project, cellSize, zoom, pan, highlightedColorId, highlightedCellIndices, tool, clipboardPhase, selectedColorId, eraserSize, eraserScope, moveMode, mirrorMode, clipboardPattern, copyMode, copySelectionIndices, shapeDraft, hoverPoint, canEdit, referenceImage, textToolValue, textToolDirection, textToolSize, textToolSpacing, formatColorCode) {
    const canvasWidth = context.canvas.width / (window.devicePixelRatio || 1);
    const canvasHeight = context.canvas.height / (window.devicePixelRatio || 1);
    context.clearRect(0, 0, canvasWidth, canvasHeight);
    context.fillStyle = '#f3f0e8';
    context.fillRect(0, 0, canvasWidth, canvasHeight);
    context.save();
    context.translate(pan.x, pan.y);
    context.scale(zoom, zoom);
    context.fillStyle = '#fffdf7';
    context.fillRect(0, 0, project.width * cellSize, project.height * cellSize);
    const visibleLayers = (project.layers ?? []).filter((layer) => layer.visible);
    const highlightedCells = highlightedCellIndices.length > 0 ? new Set(highlightedCellIndices) : null;
    if (referenceImage.visible && referenceImage.placement === 'below') {
        drawReferenceImage(context, project, cellSize, referenceImage);
    }
    for (let y = 0; y < project.height; y += 1) {
        for (let x = 0; x < project.width; x += 1) {
            const index = y * project.width + x;
            const stack = visibleLayers
                .map((layer) => ({ layer, colorId: layer.cells?.[index] }))
                .filter((item) => Boolean(item.colorId));
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
            if (project.settings.showColorCodes && topColor && cellSize >= 16) {
                context.fillStyle = readableTextColor(topColor.rgb);
                context.font = `${Math.max(7, cellSize * 0.3)}px Arial`;
                context.textAlign = 'center';
                context.textBaseline = 'middle';
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
        drawGrid(context, project, cellSize);
    if (project.settings.showPegboardBoundaries)
        drawPegboardBoundaries(context, project, cellSize);
    if (project.settings.showCoordinates && cellSize * zoom > 10)
        drawCoordinates(context, project, cellSize);
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
function drawGrid(context, project, cellSize) {
    context.strokeStyle = '#d6d3cc';
    context.lineWidth = 1;
    for (let x = 0; x <= project.width; x += 1) {
        context.beginPath();
        context.moveTo(x * cellSize, 0);
        context.lineTo(x * cellSize, project.height * cellSize);
        context.stroke();
    }
    for (let y = 0; y <= project.height; y += 1) {
        context.beginPath();
        context.moveTo(0, y * cellSize);
        context.lineTo(project.width * cellSize, y * cellSize);
        context.stroke();
    }
}
function drawCoordinates(context, project, cellSize) {
    context.fillStyle = 'rgba(17,24,39,0.45)';
    context.font = '8px Arial';
    context.textAlign = 'left';
    context.textBaseline = 'top';
    for (let x = 0; x < project.width; x += 5) {
        context.fillText(String(x + 1), x * cellSize + 2, 2);
    }
    for (let y = 0; y < project.height; y += 5) {
        context.fillText(String(y + 1), 2, y * cellSize + 2);
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