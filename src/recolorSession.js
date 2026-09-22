/**
 * 改色会话（R2）——**纯状态 + 纯派生逻辑**。零 React、零 DOM、零副作用。
 *
 * ## 为什么要有这个文件（本批的病根）
 * W3.1 的改色把「目标色」寄生在**全局画笔选中色** `selectedColorId` 上：
 * 打开改色后如果没点任何推荐就按「替换」，用的就是**上次画图时**选的颜色（用户实际报障：没选 A1 却换成 A1）。
 * 同时推荐恒取「当前源色」的最近色 ⇒ A→B 之后再改，推荐从 B 延伸，**越换越偏、回不到 A**。
 *
 * 本模块把会话拆成三个字段，语义各自独立、互不兼职：
 *
 * | 字段 | 含义 | 什么时候变 |
 * |---|---|---|
 * | `sourceColorId` | 这次要换掉的色（第一次是 A；A 换成 B 之后，同一批豆变成 B） | 每次打开编辑器时按点的那一行变 |
 * | `anchorColorId` | **本次改色链的起点**，**只用于生成推荐** | 新建会话时 = 源色；之后**一直不变** |
 * | `targetColorId` | 目标色，**本会话的本地状态**（`null` = 还没挑，用默认 = 第 1 条可用推荐） | 用户点推荐/候选/手填色号时变 |
 *
 * ## 用户裁决（2026-09-20 第四轮，原话）
 * > 「**要一直保持源色 A 延伸**，也就是说任何时候我去选择替换的时候，它都是推荐的由 A 颜色延伸的颜色；
 * >   否则越改颜色与原本的偏差越大…并且还找不回最初的颜色。**如果用户真的有自己确定的颜色修改想法的话，
 * >   在色号那里他可以自己填**。」
 *
 * 落成规则：
 * 1. 锚点 = 第一次开始改色时选的那个颜色，**之后一直不变**（"点了另一个源色行就重新锚定"已被用户否决）；
 * 2. 锚点活在调用方的组件状态里，**关掉改色面板不清除**；刷新页面（组件重挂）/ 新建工程（`project.createdAt` 变）才清空；
 * 3. **手填色号不受锚点限制**（`pickTarget()` 对任意色号都接受）—— 这是用户给的自定义出口；
 * 4. 想要"重新锚定"时用显式入口（面板里的「重设起点」→ `resetAnchor()`），不做隐式重锚。
 */
import { analyzeGradientFlatten, recommendFromAnchor } from './colorReplace.js';
import { getColor } from './palette.js';
/** 默认推荐条数（面板里的「和起点最像的 5 个」）。 */
export const DEFAULT_RECOMMENDATION_COUNT = 5;
/** 新建一个会话：锚点 = 源色（起点就是它自己）。 */
export function startSession(sourceColorId) {
    return { sourceColorId, anchorColorId: sourceColorId, targetColorId: null };
}
/**
 * 打开编辑器（点某一行 = 以该色为源色）。
 * - 还没有会话 ⇒ 新建（**锚点 = 这个源色**）；
 * - 已有会话 ⇒ **只换源色、清掉目标色，锚点一动不动**（用户裁决：一直由起点延伸）。
 */
export function openEditorFor(session, sourceColorId) {
    if (!session)
        return startSession(sourceColorId);
    return { ...session, sourceColorId, targetColorId: null };
}
/** 用户挑了目标色（点推荐/候选色块、或手填色号）——**不校验、不限制**，手填可以换到任意颜色。 */
export function pickTarget(session, targetColorId) {
    return { ...session, targetColorId };
}
/** 显式「重设起点」：把锚点改成当前源色（唯一的重锚路径）。 */
export function resetAnchor(session) {
    return { ...session, anchorColorId: session.sourceColorId, targetColorId: null };
}
/** 会话实际使用的锚点：锚点色已不在色板里（换品牌等）时退化为当前源色。 */
export function anchorOf(session) {
    return getColor(session.anchorColorId) ? session.anchorColorId : session.sourceColorId;
}
/**
 * **推荐**：永远由**锚点**生成（不是由当前源色）。
 * 这是"越换越偏"的根治点：A→B→C 的每一步，5 条推荐都是同一批（由 A 延伸）。
 */
export function recommendationsOf(session, count = DEFAULT_RECOMMENDATION_COUNT) {
    const anchorColorId = anchorOf(session);
    return {
        anchorColorId,
        anchorIsSessionAnchor: anchorColorId === session.anchorColorId,
        items: anchorColorId ? recommendFromAnchor(anchorColorId, count) : [],
    };
}
/**
 * **默认目标色** = 推荐里第 1 条**不是当前源色**的。
 *
 * 为什么要跳过"等于源色"的那条：锚点固定之后，刚刚换过去的那一支颜色本身就是"离起点最近"的一条；
 * 再打开编辑器时若把默认目标设成它，就变成"目标色 = 源色"（无事可做、按钮禁用）。
 * 跳过它 ⇒ 第 2 次打开时默认就指向下一档，链路自然往下走，同时仍然**完全由起点 A 延伸**。
 */
export function defaultTargetOf(session, recommendations) {
    const usable = recommendations.items.find((item) => item.color.id !== session.sourceColorId);
    return usable ? usable.color.id : (recommendations.items[0]?.color.id ?? null);
}
/** 会话**生效的**目标色：用户挑过就用挑的，没挑过就用默认。 */
export function targetOf(session, recommendations) {
    return session.targetColorId ?? defaultTargetOf(session, recommendations);
}
/** 界面上要展示的「源色 / 起点 / 目标色」三色（缺的给 undefined，界面自己兜底）。 */
export function sessionColors(session, recommendations) {
    const targetId = targetOf(session, recommendations);
    return {
        source: getColor(session.sourceColorId),
        anchor: getColor(recommendations.anchorColorId),
        target: targetId ? getColor(targetId) : undefined,
    };
}
/** 把 `analyzeGradientFlatten` 的判定翻成"给用户看的事实"（措辞留在界面层）。 */
export function flattenWarningOf(analysis) {
    if (!analysis.available || !analysis.flattenRisk)
        return { kind: 'none' };
    if (analysis.targetMergesWith.length > 0) {
        return {
            kind: 'merge',
            colorIds: analysis.targetMergesWith,
            levelsBefore: analysis.levelsBefore,
            levelsAfter: analysis.levelsAfter,
            distinctColorsBefore: analysis.distinctColorsBefore,
            distinctColorsAfter: analysis.distinctColorsAfter,
        };
    }
    return {
        kind: 'far',
        sourceColorId: analysis.sourceColorId,
        beads: analysis.sourceBeads,
        levelsBefore: analysis.levelsBefore,
        levelsAfter: analysis.levelsAfter,
        distinctColorsBefore: analysis.distinctColorsBefore,
        distinctColorsAfter: analysis.distinctColorsAfter,
    };
}
/**
 * 会话级的一次完整判定（给面板一行调用）：源色 / 目标色 / 起点 / 警告一锅端。
 * 面板里不需要自己拼 `analyzeGradientFlatten` 的入参。
 */
export function describeRecolor(session, usedColors, sourceBeads) {
    const recommendations = recommendationsOf(session);
    const targetColorId = targetOf(session, recommendations);
    const analysis = analyzeGradientFlatten(session.sourceColorId, targetColorId ?? '', usedColors, { sourceBeads });
    return { recommendations, targetColorId, analysis, warning: flattenWarningOf(analysis) };
}
//# sourceMappingURL=recolorSession.js.map