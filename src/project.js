import { BRAND_IDS, DEFAULT_BRAND } from './brands.js';
import { paletteVersion } from './palette.js';
export const autosaveKey = 'perler-beads-generator:draft';
/**
 * 把来路不明的 `sourceImage` 收敛成合法值（手改草稿、旧版本遗留、导入的 JSON 都算来路不明）。
 * 非法值一律返回 `null` ⇒ `normalizeProject()` 会把该字段**删掉**，不让脏数据留在状态里。
 */
export function normalizeSourceImageRef(value) {
    if (!value || typeof value !== 'object')
        return null;
    const raw = value;
    if (typeof raw.imageId !== 'string' || !raw.imageId)
        return null;
    if (typeof raw.name !== 'string')
        return null;
    if (typeof raw.size !== 'number' || !Number.isFinite(raw.size) || raw.size <= 0)
        return null;
    return {
        imageId: raw.imageId,
        name: raw.name,
        type: typeof raw.type === 'string' ? raw.type : '',
        size: raw.size,
        savedAt: typeof raw.savedAt === 'string' ? raw.savedAt : '',
    };
}
/** 读工程记住的源图关联信息。任何来路不明的值都当"没有"。 */
export function getSourceImageRef(project) {
    return normalizeSourceImageRef(project.sourceImage);
}
/**
 * 写入 / 清除工程记住的源图关联信息。`null` 会把字段**整个删掉**
 * （而不是留一个 `null`），这样没有源图的工程草稿字节与改动前一致。
 * 刻意**不动 `updatedAt`**：这只是关联元数据，不该让"每次启动恢复"都记成一次修改。
 */
export function withSourceImage(project, ref) {
    const next = { ...project };
    if (ref)
        next.sourceImage = ref;
    else
        delete next.sourceImage;
    return next;
}
/** 把 `imageStore` 取回的源图转成工程元数据。省得接线方手抄字段、抄漏一个。 */
export function sourceImageRefFromStored(image) {
    return {
        imageId: image.imageId,
        name: image.name,
        type: image.type,
        size: image.size,
        savedAt: new Date(image.savedAt || Date.now()).toISOString(),
    };
}
/**
 * 把一个来路不明的 `activeBrand` 收敛成合法的 `BrandId`。
 *
 * 为什么需要（KI-011）：`normalizeProject()` 原来把 `activeBrand` **硬写成 `'MARD'`**，
 * 于是「换到 Artkal → 刷新页面」之后：格子里的 id 仍是 `artkal-*`（`getColor` 能解析，画面正常），
 * 但 `project.activeBrand` 悄悄回到 `'MARD'` ⇒ 导出的「色号品牌」栏与 `mappedCode()` 用错品牌。
 *
 * 规则：**合法值原样保留；非法值（手改 draft、旧版本遗留、字段缺失/类型不对）一律回退 `DEFAULT_BRAND`（MARD），不抛异常。**
 * 白名单直接取 `brands.ts` 的 `BRAND_IDS`（与 `types.ts` 的 `BrandId` 有编译期断言绑定），
 * 所以以后新增品牌不需要再改这里。
 */
function normalizeActiveBrand(value) {
    return typeof value === 'string' && BRAND_IDS.includes(value)
        ? value
        : DEFAULT_BRAND;
}
export function createProject(width = 52, height = 52, name = 'Untitled Pattern') {
    const now = new Date().toISOString();
    const cells = emptyCells(width, height);
    return {
        version: '1.0.0',
        name,
        width,
        height,
        activeBrand: DEFAULT_BRAND, // 新建工程仍是 MARD（不变）
        paletteVersion,
        cells,
        layers: [
            {
                id: 'base',
                name: 'Pattern',
                customName: false,
                visible: true,
                locked: false,
                includeInUsage: true,
                opacity: 1,
                cells,
            },
        ],
        activeLayerId: 'base',
        settings: {
            showGrid: true,
            showCoordinates: true,
            showPegboardBoundaries: true,
            showLayerOverlap: false,
            showActiveLayerOnly: false,
            showColorCodes: false,
            /*
             * B20（用户第 15 轮第 9 条）：「网站打开之后拼豆的形状**默认**要选择方形，而不是圆形」，
             * 并明确「默认方形是**全局默认**」⇒ 这里（`createProject` = 唯一的默认工程工厂）由
             * `'bead'`（圆形）改成 `'pixel'`（方形）。右栏那两个按钮、3D 预览的几何都跟着它走，
             * 没有第二处默认值。**这是本仓库 12 个纯逻辑模块之一**，本批是**专门为它开的一次解冻**，
             * 改完红线基线要重推（见 `_审核\_规划\_回退台账.md` §二十四）。
             */
            beadDisplayMode: 'pixel',
            beadsPerPack: 500,
            rightClickAction: 'pan',
        },
        boardSettings: {
            boardWidth: 52,
            boardHeight: 52,
            showBoardIds: true,
        },
        createdAt: now,
        updatedAt: now,
    };
}
export function withCells(project, cells, width = project.width, height = project.height) {
    const normalizedCells = normalizeCells(cells, width, height);
    const layers = normalizeLayers(project, width, height).map((layer) => layer.id === project.activeLayerId && !layer.locked ? { ...layer, cells: normalizedCells } : layer);
    return {
        ...project,
        width,
        height,
        cells: composeVisibleCells(layers, width, height),
        layers,
        updatedAt: new Date().toISOString(),
    };
}
export function createLayer(width, height, name) {
    return {
        id: `layer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name,
        customName: false,
        visible: true,
        locked: false,
        includeInUsage: true,
        opacity: 1,
        cells: emptyCells(width, height),
    };
}
export function withLayers(project, layers, activeLayerId = project.activeLayerId) {
    const normalizedLayers = normalizeLayers({ ...project, layers }, project.width, project.height);
    const nextActiveLayerId = normalizedLayers.some((layer) => layer.id === activeLayerId)
        ? activeLayerId
        : normalizedLayers[0]?.id ?? 'base';
    return {
        ...project,
        layers: normalizedLayers,
        activeLayerId: nextActiveLayerId,
        cells: composeVisibleCells(normalizedLayers, project.width, project.height),
        updatedAt: new Date().toISOString(),
    };
}
export function composeVisibleCells(layers, width, height) {
    const result = emptyCells(width, height);
    for (const layer of layers) {
        if (!layer.visible)
            continue;
        const cells = normalizeCells(layer.cells, width, height);
        cells.forEach((cell, index) => {
            if (cell)
                result[index] = cell;
        });
    }
    return result;
}
export function normalizeProject(project) {
    const width = Number.isFinite(project.width) ? project.width : 29;
    const height = Number.isFinite(project.height) ? project.height : 29;
    const fallback = createProject(width, height, project.name);
    const settings = {
        ...fallback.settings,
        ...project.settings,
        showColorCodes: Boolean(project.settings?.showColorCodes || project.settings?.beadDisplayMode === 'print'),
        /*
         * B20：**显式存过的值优先，缺字段/未知值跟默认走**。
         *   · `'bead'` / `'print'` ⇒ 维持改动前的口径（`'print'` 仍归一成 `'bead'`，那是渲染侧的老约定）；
         *   · 其余（缺字段、`'pixel'`、脏值）⇒ 用 `fallback.settings.beadDisplayMode`，也就是
         *     `createProject` 的默认值（B20 起 = `'pixel'` 方形）。
         *   ⇒ 老草稿里**明确存着** `'bead'` 的仍然是圆形（那是用户的数据，不是"默认"）；
         *     带 `'pixel'` 的仍然方形；**没有这个字段的**（手改过的 JSON、早期草稿）才跟着新默认变成方形。
         */
        beadDisplayMode: project.settings?.beadDisplayMode === 'bead' || project.settings?.beadDisplayMode === 'print'
            ? 'bead'
            : fallback.settings.beadDisplayMode,
    };
    const layers = normalizeLayers({
        ...fallback,
        ...project,
        settings,
        boardSettings: { ...fallback.boardSettings, ...project.boardSettings },
        layers: project.layers?.length ? project.layers : fallback.layers,
    }, width, height);
    const next = {
        ...fallback,
        ...project,
        width,
        height,
        // KI-011 修复：保留草稿里合法的 activeBrand（非法值回退 MARD）。见上方 normalizeActiveBrand 注释。
        activeBrand: normalizeActiveBrand(project.activeBrand),
        settings,
        boardSettings: { ...fallback.boardSettings, ...project.boardSettings },
        layers,
        activeLayerId: layers.some((layer) => layer.id === project.activeLayerId) ? project.activeLayerId : layers[0].id,
        cells: composeVisibleCells(layers, width, height),
    };
    // W4：源图关联信息也走同一套"来路不明就收敛"的规矩。合法值原样保留（含 imageId），
    // 非法值**整个删掉** —— 于是 `getSourceImageRef()` 永远只可能拿到合法值。
    const sourceImage = normalizeSourceImageRef(project.sourceImage);
    if (sourceImage)
        next.sourceImage = sourceImage;
    else
        delete next.sourceImage;
    return next;
}
function normalizeLayers(project, width, height) {
    const legacyCells = normalizeCells(project.cells, width, height);
    const sourceLayers = project.layers?.length ? project.layers : createProject(width, height).layers;
    return sourceLayers.map((layer, index) => ({
        ...layer,
        customName: Boolean(layer.customName),
        cells: normalizeCells(layer.cells ?? (index === 0 ? legacyCells : []), width, height),
    }));
}
function normalizeCells(cells, width, height) {
    const length = width * height;
    const next = Array.from({ length }, (_, index) => cells?.[index] ?? null);
    return next;
}
function emptyCells(width, height) {
    return Array.from({ length: width * height }, () => null);
}
export function saveDraft(project) {
    localStorage.setItem(autosaveKey, JSON.stringify(project));
}
export function loadDraft() {
    try {
        const raw = localStorage.getItem(autosaveKey);
        if (!raw)
            return null;
        const parsed = JSON.parse(raw);
        if (!parsed.width || !parsed.height || !Array.isArray(parsed.cells))
            return null;
        return normalizeProject(parsed);
    }
    catch {
        localStorage.removeItem(autosaveKey);
        return null;
    }
}
//# sourceMappingURL=project.js.map