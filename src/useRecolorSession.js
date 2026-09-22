/**
 * 改色会话的**共享钩子**（2026-09-20，第 2 批「换色融合」新增）。
 *
 * ## 为什么要有这个文件
 * 融合之前，「换色」有两张脸、各管一摊：
 * - **工具条「换色」**：在画布上点一颗豆 ⇒ 换成**当前画笔色**。它**没有会话**，
 *   所以既不记得"这次改色链的起点"，也没有"目标色"这个概念。
 * - **右抽屉「用量 → 改色」**：有一整套会话（源色 / 起点 / 目标色）+ 推荐 + 压平警告，
 *   但这些状态是 `RightPanel` 的**局部** `useState`，工具那侧拿不到。
 *
 * 于是同一个动作在两处表现不一致，用户也说不清"我挑的目标色到底生效没有"。
 * 本文件把会话**上移**成一处，两个挂载点（右抽屉 / 工具浮层）共享同一份。
 *
 * ## 搬了什么
 * - `recolorSession` / `recolorOpen` 两个 state
 * - `project.createdAt` 变化的清空副作用
 * - "打开编辑器"这个动作（原 `RightPanel.openRecolorEditor`）
 * - **派生事实工厂 `facts()`** —— 两个挂载点共用同一份口径，避免各写一份将来漂移
 *
 * ## ⚠️ 唯一新增的语义：`setSource` 保留已挑的目标色
 * 会话模块的 `openEditorFor()` 会顺手把 `targetColorId` 清成 `null`
 * （`recolorSession.ts` 的注释写明那是"点另一行 = 重新开始"的语义）。
 * 但**画布上点豆是"换一个源色接着改"**，不是"重新开始" —— 用它会让用户每点一颗豆就丢掉
 * 刚挑好的目标色。所以这里另给一个只换源色、**保留目标色**的动作。
 *
 * **不改 `recolorSession.ts`**（它保持逐字节不变），新语义只活在本文件里。
 *
 * ## 目标色的两个默认值（刻意分开，别"统一"掉）
 * | 表面 | 默认口径 | 依据 |
 * |---|---|---|
 * | 右抽屉的「替换」 | `sessionTargetId` = **推荐第 1 条** | 用户第四轮裁决「一直保持源色 A 延伸」 |
 * | 画布点豆 / 工具浮层 | **当前画笔色** | 本轮 B4「立刻换」+ 已批准的「1 步 = 换画笔色」 |
 * **显式挑过的目标色两边共用**（同一个 `session.targetColorId`）—— 这才是融合的实质收益。
 * 调用方用 `facts(effectiveTargetId)` 各取所需。
 */
import { useEffect, useState } from 'react';
import { analyzeGradientFlatten, collectRecolorScopeColors, countRecolorCells } from './colorReplace.js';
import { getColor } from './palette.js';
import { flattenWarningOf, openEditorFor, recommendationsOf, startSession, targetOf, } from './recolorSession.js';
export function useRecolorSession(project, usage) {
    const [session, setSession] = useState(null);
    // ⚠️ `open` 与 `session` **刻意分开**（融合前就是这么分的）：
    // 关掉编辑器只清 open、不清会话 ⇒ 锚点活着。清空条件只有两个：
    // 页面刷新（组件重挂）或**新建 / 导入工程**（`project.createdAt` 变）。
    const [open, setOpen] = useState(false);
    useEffect(() => {
        // 新建工程 / 导入工程 会换掉 project.createdAt ⇒ 锚点归零（用户的"刷新页面 / 新建工程"口径）。
        // 注意：上传新图**不**改 createdAt（同一工程内重算），锚点会保留 —— 与融合前一致。
        setSession(null);
        setOpen(false);
    }, [project.createdAt]);
    const sourceColor = session ? getColor(session.sourceColorId) : undefined;
    const sourceRow = session ? usage.find((row) => row.color.id === session.sourceColorId) : undefined;
    const recommendations = session ? recommendationsOf(session) : null;
    const sessionTargetId = session && recommendations ? targetOf(session, recommendations) : null;
    const facts = (effectiveTargetId) => {
        const scopeColors = session ? collectRecolorScopeColors(project) : [];
        const affectedCells = session ? countRecolorCells(project, session.sourceColorId) : 0;
        const analysis = session
            ? analyzeGradientFlatten(session.sourceColorId, effectiveTargetId ?? '', scopeColors, {
                sourceBeads: affectedCells,
            })
            : null;
        return {
            scopeColors,
            affectedCells,
            analysis,
            warning: analysis ? flattenWarningOf(analysis) : { kind: 'none' },
        };
    };
    const openFor = (sourceColorId) => {
        setSession((current) => openEditorFor(current, sourceColorId));
        setOpen(true);
    };
    /** 只换源色，**保留 `targetColorId`**（见文件头说明）。没有会话时按 `startSession` 新建。 */
    const setSource = (sourceColorId) => {
        setSession((current) => (current ? { ...current, sourceColorId } : startSession(sourceColorId)));
    };
    const close = () => setOpen(false);
    return {
        session, open, sourceColor, sourceRow,
        recommendations, sessionTargetId, facts,
        openFor, setSource, close, setSession,
    };
}
//# sourceMappingURL=useRecolorSession.js.map