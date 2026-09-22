/**
 * 用量面板改色（D6）的**纯计算层**：候选 / 推荐 / 手填色号校验 / 渐变压平预判。
 *
 * W3.1 新增；W2-改色会话（R2）在这一层上加了"锚点"语义与给界面用的"事实"字段。
 * 全部是纯函数，不碰 DOM、不碰 React，也不改任何项目状态 ——
 * 真正的替换动作仍然走项目已有管线（`App.tsx` 的 `replaceColor(source, target)`，见右栏报告）。
 *
 * ⚠️ **改色会话的状态不在这里**：`{ sourceColorId, anchorColorId, targetColorId }` 在
 * `./recolorSession`（同样零 React）。本文件只做"给定一个色 → 算出东西"。
 *
 * ## 复用而非重造（D6 的硬要求）
 * - 颜色距离一律用 `palette.ts` 的 `colorDistance`（= `colorDistanceRgb`，全项目唯一距离），
 *   **本文件不自己写距离公式**；
 * - 最近色查找用 `palette.ts` 的 `nearestPaletteColor`（`nearestAlternative()`）；
 * - 「哪些格子会被改」用 `cellOperations.ts` 的 `collectRecolorIndices`（与 `replaceColor()`
 *   的筛选口径**逐条一致**：只算 `visible && !locked` 的层）。
 *
 * ## 关于"渐变被压平"的判据（D6 第 5 条）
 * 阈值 `RAMP_NEAR_DISTANCE = 60`（"同一档相近色"的半径）不是随手拍的，两处依据：
 *
 * 1) **管线自己用来判定"两个颜色太相近、不该同时留在图里"的距离**（`imageToBeads.ts:256-257`）：
 *      `const baseThreshold = luminance(color.rgb) < 48 || chroma > 58 ? 18 : 34;`
 *      `const threshold = (baseThreshold + level * (chroma > 58 ? 3 : 7)) * profile.candidateDistanceFactor;`
 *    默认出图（`cartoon` 画像 `candidateDistanceFactor = 1.35`；`speckleReduction` 默认 2，
 *    `speckleStrength = 2 + postStrengthBias(1) = 3` ⇒ `level = 3`）代入后是
 *      - 暗部 / 高饱和：`(18 + 3*3) * 1.35 = 36.45`
 *      - 其它：        `(34 + 3*7) * 1.35 = 74.25`
 *    ⇒ 管线自认的"相近"区间是 **36.45 ~ 74.25**，取 **60**（区间中部）。
 * 2) **实测相邻档间距**（用 `_equiv` 产出的 10 张图逐格数据算 291 色内的最近邻距离）：
 *    一张 52x52 / 20 色的风景渐变图，相邻档间距中位数 **53.5**、最小 **17.4**；
 *    10 张图的最近邻距离多数落在 **17 ~ 75**。半径取 34 时几乎找不到"源色 + ≥2 档"的色
 *    （管线本身就把 <34 的重复色剔除了），半径 60 才对得上人眼看到的"多档相近色"。
 *
 * "档"的定义：源色 + 距离 ≤60 的其它在用色 = N 档；`flattenRisk` 只在**这次替换真的会把档数变少**
 * 时才为真，见 `analyzeGradientFlatten` 注释。
 */
import { collectRecolorIndices } from './cellOperations.js';
import { basicPalette, colorDistance, completePalette, getColor, nearestPaletteColor } from './palette.js';
/** 判定"同一档相近色"的距离半径（依据见文件头：管线阈值区间 36.45~74.25 取中，实测相邻档 17~75）。 */
export const RAMP_NEAR_DISTANCE = 60;
/** 默认 221 色（`basicPalette`）的 id 集合 —— 用来给候选项打「也在默认 221 中」标记。 */
const BASIC_PALETTE_IDS = new Set(basicPalette.map((color) => color.id));
/** 这个色号是否也在默认 221 色里（D6：候选项要标注「也在默认 221 中」）。 */
export function isInDefaultPalette(colorId) {
    return BASIC_PALETTE_IDS.has(colorId);
}
/** 默认 221 的 id 集合副本（只读诊断用；不要改它）。 */
export function defaultPaletteIds() {
    return [...BASIC_PALETTE_IDS];
}
function compareCandidate(a, b) {
    if (a.distance !== b.distance)
        return a.distance - b.distance;
    // 距离完全相等时按 id 排，保证多次渲染/多次比对的顺序稳定（可复算）。
    return a.color.id < b.color.id ? -1 : a.color.id > b.color.id ? 1 : 0;
}
/**
 * **全量候选**：整块 `completePalette`（291 色）里除源色自己以外的每一色，
 * 带上与源色的距离 + 是否也在默认 221 中。按距离升序、id 次序稳定。
 */
export function listRecolorCandidates(sourceColorId, palette = completePalette) {
    const source = getColor(sourceColorId);
    if (!source)
        return [];
    return palette
        .filter((color) => color.id !== source.id)
        .map((color) => ({
        color,
        distance: colorDistance(source.rgb, color.rgb),
        inBasic221: BASIC_PALETTE_IDS.has(color.id),
    }))
        .sort(compareCandidate);
}
/**
 * **5 条推荐** = 全量候选里距离最小的前 N 条（默认 5，附原始距离值）。
 *
 * ## ⚠️ 名字里为什么是 `Anchor`（R2 的红线）
 * 传进来的**必须是"本次改色链的起点"**（`RecolorSession.anchorColorId`），**不是"当前源色"**。
 * W3.1 当初传的是 `sourceColor.id`，于是 A→B 之后再改，推荐从 B 延伸，**越换越偏**（用户报障）。
 * 起点由 `./recolorSession` 管理；这里只负责"给定一个色，返回和它最像的 N 个"。
 */
export function recommendFromAnchor(anchorColorId, count = 5, palette = completePalette) {
    const limit = Math.max(0, Math.floor(count));
    return listRecolorCandidates(anchorColorId, palette).slice(0, limit);
}
/**
 * 用 `nearestPaletteColor` 独立求一次"锚点之外最近的色"——
 * 用于交叉验证 `recommendFromAnchor(...)[0]`（两者必须同色）。
 */
export function nearestAlternative(anchorColorId, palette = completePalette) {
    const source = getColor(anchorColorId);
    if (!source)
        return undefined;
    const rest = palette.filter((color) => color.id !== source.id);
    if (rest.length === 0)
        return undefined;
    return nearestPaletteColor(source.rgb, rest);
}
/**
 * 手填色号校验（D6 第 4 条）。
 * - 归一化：去空白、去前导 `#`、转大写；
 * - 命中 `primaryCode` 或 `codes` 里任一品牌色号即通过；
 * - 额外容忍前导零（`A01` → `A1`，总任务书「色号必须归一化前导零」那条）；
 * - 空串 → `empty`；其它 → `not-found`（调用方必须拒绝并给提示）。
 */
export function lookupColorCode(raw, palette = completePalette) {
    const normalized = String(raw ?? '')
        .trim()
        .replace(/^#/, '')
        .replace(/\s+/g, '')
        .toUpperCase();
    if (!normalized)
        return { ok: false, reason: 'empty', normalized };
    const match = (needle) => palette.find((color) => {
        if (color.primaryCode.toUpperCase() === needle)
            return true;
        return Object.values(color.codes).some((code) => String(code ?? '').toUpperCase() === needle);
    });
    const direct = match(normalized);
    if (direct)
        return { ok: true, color: direct };
    const stripped = normalized.replace(/^([A-Z]+)0+(\d)/, '$1$2');
    if (stripped !== normalized) {
        const alt = match(stripped);
        if (alt)
            return { ok: true, color: alt };
    }
    return { ok: false, reason: 'not-found', normalized };
}
/**
 * 改色**会碰到的**格子里到底有哪几种颜色（`visible && !locked` 的层，与
 * `collectRecolorIndices` / `replaceColor()` 同一口径）。
 */
export function collectRecolorScopeColors(project) {
    const ids = new Set();
    (project.layers ?? []).forEach((layer) => {
        if (!layer.visible || layer.locked)
            return;
        layer.cells.forEach((colorId) => {
            if (colorId)
                ids.add(colorId);
        });
    });
    return [...ids]
        .map((id) => getColor(id))
        .filter((color) => Boolean(color))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
/** 这次改色会改掉多少格 —— 直接复用 `collectRecolorIndices`（不重造筛选逻辑）。 */
export function countRecolorCells(project, sourceColorId) {
    return collectRecolorIndices(project, sourceColorId).length;
}
/**
 * 渐变压平预判（D6 第 5 条）。
 *
 * 定义：
 * - 层 = 一种在（会被改的）图里真实出现的颜色；
 * - `ramp` = 除源色外、与源色距离 ≤ `RAMP_NEAR_DISTANCE` 的在用色；
 *   `levelsBefore = 1 + ramp.length` —— 源色自己算一层。
 * - **只有 `levelsBefore >= 3`（源色确实处在多层次里）才可能提示**；
 * - 在这个前提下，只要发生下面任一件事，层数就会变少 ⇒ 判为「会把渐变拉平」：
 *   1. 目标色落进已有的某一层（距离 ≤ 阈值）⇒ 两层并成一层（`targetMergesWith.length > 0`）；
 *   2. 目标色离源色超出阈值 ⇒ 源色那一层被抽走、层数 -1（`!targetInsideRamp`）。
 * - 反之（源色本身在渐变里，新色仍是紧邻的新一层）不提示 —— 那是正常的「微调」。
 *
 * ## 给界面用的"事实"字段（R2：文案要讲结果，不许暴露机制）
 * `levelsBefore/After`、`sourceBeads`、`distinctColorsBefore/After`、`targetMergesWith`、`targetInsideRamp`
 * 都是为了让面板直接说出用户看得见的东西（**几层 → 几层、多少颗、跟哪几个色号长得一样**），
 * 不必在界面里再解释距离/阈值是什么。
 */
export function analyzeGradientFlatten(sourceColorId, targetColorId, usedColors, options = {}) {
    const distinctColorsBefore = usedColors.length;
    const empty = (reason) => ({
        available: false,
        sourceColorId,
        rampColorIds: [],
        rampDistances: [],
        levelsBefore: 1,
        levelsAfter: 1,
        targetDistance: 0,
        targetMergesWith: [],
        targetInsideRamp: true,
        flattenRisk: false,
        sourceBeads: Math.max(0, Math.floor(options.sourceBeads ?? 0)),
        distinctColorsBefore,
        distinctColorsAfter: distinctColorsBefore,
        reason,
    });
    const source = getColor(sourceColorId);
    const target = getColor(targetColorId);
    if (!source)
        return empty('source-not-found');
    if (!target)
        return empty('target-not-found');
    const ramp = usedColors
        .filter((color) => color.id !== source.id)
        .map((color) => ({ id: color.id, rgb: color.rgb, distance: colorDistance(source.rgb, color.rgb) }))
        .filter((entry) => entry.distance <= RAMP_NEAR_DISTANCE)
        .sort((a, b) => (a.distance !== b.distance ? a.distance - b.distance : a.id < b.id ? -1 : 1));
    const targetDistance = colorDistance(source.rgb, target.rgb);
    const targetInsideRamp = targetDistance <= RAMP_NEAR_DISTANCE;
    // 目标色本身就是某一层时距离为 0，自然命中（也就是「并进那一层」）。
    const targetMergesWith = ramp
        .filter((entry) => colorDistance(target.rgb, entry.rgb) <= RAMP_NEAR_DISTANCE)
        .map((entry) => entry.id);
    const levelsBefore = 1 + ramp.length;
    const multiLevel = levelsBefore >= 3;
    const flattenRisk = multiLevel && (targetMergesWith.length > 0 || !targetInsideRamp);
    const targetAlreadyUsed = usedColors.some((color) => color.id === target.id);
    const sourceBeads = Math.max(0, Math.floor(options.sourceBeads ?? 0));
    // 源色整支被换掉 ⇒ 少一种颜色；目标色本来就在图里 ⇒ 不会补回来（种数 -1）；是新色 ⇒ 种数不变。
    const distinctColorsAfter = targetAlreadyUsed ? Math.max(1, distinctColorsBefore - 1) : distinctColorsBefore;
    const reason = !multiLevel
        ? `levels=${levelsBefore} <3`
        : flattenRisk
            ? targetMergesWith.length > 0
                ? `merges-with=${targetMergesWith.join(',')}`
                : `target-outside-ramp=${targetDistance.toFixed(3)}`
            : 'level-preserved';
    return {
        available: true,
        sourceColorId,
        rampColorIds: ramp.map((entry) => entry.id),
        rampDistances: ramp.map((entry) => entry.distance),
        levelsBefore,
        levelsAfter: flattenRisk ? levelsBefore - 1 : levelsBefore,
        targetDistance,
        targetMergesWith,
        targetInsideRamp,
        flattenRisk,
        sourceBeads,
        distinctColorsBefore,
        distinctColorsAfter,
        reason,
    };
}
//# sourceMappingURL=colorReplace.js.map