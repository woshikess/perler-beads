/**
 * 右栏面板：状态条 + 「调色盘」/「用量」两个 tab 的正文 + 「视图」/「单元格」两块。
 *
 * W0.1b 从 App.tsx 纯搬迁（原 L2334–L2660），块内容逐字保留，只统一重排了缩进。
 * 图标改为从 ./icons 导入、getColor 从 ./palette 导入；其余全部由 props 传入。
 *
 * 说明（与派工口径的差异，已在报告里写明）：派工建议再拆出 PalettePanel / UsagePanel
 * 两个文件；本次**按派工允许的"可按实际内容合并/命名"，把两个 tab 正文合并在本文件内**，
 * 以免为一次纯搬迁把约 20 个 props 再透传一层。两个 tab 正文仍各自成段、边界清晰。
 *
 * ⚠️ W0.5 已把「图层」「调整」两个 tab 从渲染里砍掉；本文件**不含**它们，
 * 也不得顺手恢复（数据模型与 includeInUsage 语义仍保留在 App 侧）。
 *
 * ⚠️ B6（2026-09-21，用户裁决「已经没有图层的概念了，就一层即可」）：**「用量」tab 里的
 *   图层板块（"用量统计图层"标题 / 全部图层·当前图层按钮 / 图层 chip / 没有图层计入用量）
 *   整块删除**，只把与之无关的 `.usage-notes`（颜色较多 / 孤立颗数）搬进 `.usage-notes-card` 保留。
 *   详见下面那段 B6 注释与 `报告.md`。
 *
 * ⚠️ W3.1（D6）在「用量」tab 内加入**改色编辑器**（`UsageRecolorEditor`）；
 *    **W2-改色会话（R2）把它的状态模型换掉了**（不是打补丁）：
 * - 入口（**可见、触屏可用**，不依赖 hover）：用量 tab 里、用量列表上方一行提示文字
 *   + 一个真 `<button>改色</button>`（`data-recolor-open="1"`，点它用「用量最多的颜色」开编辑器）；
 *   同时**点用量列表里的任意一行**也能开（该行 = 源色）。
 *   ⚠️ 这一行提示 + 按钮是默认态 DOM 里唯一预期内的差异（`_cmp31.cjs` 做定向断言；本批未改这段 UI）。
 * - **会话状态搬到 `./recolorSession`**（纯逻辑）：`{ sourceColorId, anchorColorId, targetColorId }`。
 *   ① 目标色是**会话本地状态**，默认 = 第 1 条可用推荐，**不再寄生在全局 `selectedColorId`**（修用户报的 A1 bug）；
 *   ② 推荐由**锚点（起点 A）**生成且**永不重锚**，A→B→C 每一步都还是由 A 延伸（修"越换越偏"）；
 *   ③ 锚点活在组件状态里：关掉面板不清除，**刷新页面 / 新建工程**（`project.createdAt` 变）才清；
 *      另有显式「重设起点」按钮；
 *   ④ **手填色号不受锚点限制**（可换任意色，用户给的出口）。
 * - 候选 = 全量 291 色（`completePalette`），带「221」角标的表示**也在默认 221 中**；
 * - 文案只讲用户看得见的结果（几层→几层、多少颗、跟哪几个色号长得一样）：
 *   **不出现**「距离 / 相近范围 / 档 / 阈值 / RGB / paletteVersion」这些机制词；
 *   数量预览（"本页将替换 N 颗"）已按用户要求删除，出错提示保留。
 * - 真正执行替换**复用项目已有管线**：调 `onReplaceColor(sourceColorId, targetColorId)`
 *   （= App 的 `replaceColor()`，内部 `commitHistory()` + `withLayers()`），因此**天然可撤销**，
 *   且只改「等于源色」的格子。
 */
import { listRecolorCandidates, lookupColorCode } from './colorReplace.js';
import { flattenWarningOf, pickTarget, resetAnchor } from './recolorSession.js';
import { EyeIcon } from './icons.js';
import { getColor } from './palette.js';
const { useEffect, useState } = React;
/**
 * 改色编辑器的文案（zh/en）。
 *
 * ⚠️ **本批按要求留在原位**（不搬去 `i18n.tsx` —— 那是 W5 的独占文件，本批为避免抢文件，
 * 改色文案先在 `RightPanel.tsx` 收口；W5 再整表上提）。
 * 语言按 `text.palette` 判别（zh = 「调色盘」、en = 「Palette」，两种语言里都必然存在）。
 *
 * ⚠️ **用户可见文案的禁用词**（本批用户裁决）：`距离`、`相近范围`、`档`、`阈值`、`RGB`、`paletteVersion`。
 * 一律改成用户看得见的东西：具体色号、具体颗数、几级深浅、结果会变成什么样、一句可执行建议。
 * （`tools\_recolor_session_e2e.cjs` 会扫描面板可见文本 + 所有 title，禁用词出现即判失败。）
 */
const RECOLOR_TEXT = {
    zh: {
        editorTitle: '改色',
        entryHint: '点下面任意一行即可改色（换色号 / 从全量 291 色里挑）',
        entryButton: '改色',
        entryTitle: '用用量最多的颜色开始改色',
        sourceLabel: '源色',
        targetLabel: '目标色',
        startLabel: '起点',
        beadsUnit: '颗',
        targetHint: '选一个颜色当目标色，再点「替换」。',
        sameTarget: '目标色与源色相同，请另选一个色号。',
        // B6：原文「源色只出现在隐藏或锁定的图层里」在单层模型下是**可达但措辞过时**的
        //     （单层时它实际只在"源色已不在画布上"时出现，例如刚把该色全换掉/擦掉）。
        //     改成单层语义，不引入任何新概念。
        noCells: '没有可替换的格子（源色已经不在画布上了）。',
        recommendTitle: (anchorCode, count) => `和起点 ${anchorCode} 最像的 ${count} 个颜色`,
        recommendHint: '它们一直围着起点转：连换几次也不会越走越偏。想重新定起点，点「重设起点」。',
        closestTag: '最像',
        reanchorButton: '重设起点',
        reanchorTitle: '把推荐起点改成当前源色',
        candidateTitle: (count) => `全部候选 ${count} 色（想自己挑就在这里找）`,
        candidateHint: '带「221」角标的色号也在默认 221 中。',
        inBasicTag: '221',
        inBasicTitle: '也在默认 221 中',
        filterLabel: '按色号或名称筛选',
        filterNone: '没有匹配的色号。',
        manualLabel: '手动输入色号',
        manualPlaceholder: '例如 A1 / ZG4',
        manualHint: '自己想换哪个就填哪个色号，不受上面的起点限制。',
        manualSubmit: '使用该色号',
        manualEmpty: '请先输入色号。',
        manualNotFound: (code) => `色号不存在：${code}（已拒绝，未做任何修改）`,
        manualOk: (code) => `已选中色号 ${code}`,
        apply: '替换',
        applyRisky: '仍要替换',
        cancel: '取消',
        flattenMerge: (codes, levelsBefore, levelsAfter) => `⚠️ 换完之后，你选的颜色和图上的 ${codes} 看起来会是一模一样的同一种颜色 —— 这组颜色的深浅层次会从 ${levelsBefore} 级变成 ${levelsAfter} 级，整张图的颜色数也会变少。`,
        flattenFar: (sourceCode, beads, levelsBefore, levelsAfter) => `⚠️ 你选的颜色和原来的 ${sourceCode} 差别比较大。换完之后，原来那 ${beads} 颗会直接变成新颜色、这一级深浅就没了 —— 会从 ${levelsBefore} 级过渡变成 ${levelsAfter} 级，看上去更平。如果只是想微调，从上面的推荐里挑一个就行。`,
        unwired: '改色还没有接线（缺少 onReplaceColor(source, target)），「替换」暂不可用。',
    },
    en: {
        editorTitle: 'Recolor',
        entryHint: 'Click any row below to recolor (change the code / pick from all 291 colors)',
        entryButton: 'Recolor',
        entryTitle: 'Start recoloring with the most used color',
        sourceLabel: 'From',
        targetLabel: 'To',
        startLabel: 'Start',
        beadsUnit: 'beads',
        targetHint: 'Pick a color as the target, then press Replace.',
        sameTarget: 'Target color is the same as the source. Pick another code.',
        noCells: 'No cells to replace (the source color is no longer on the canvas).',
        recommendTitle: (anchorCode, count) => `Closest ${count} colors to the starting color ${anchorCode}`,
        recommendHint: 'They stay anchored to the color you started from, so repeated swaps do not drift. Use "Reset start" to re-anchor.',
        closestTag: 'Closest',
        reanchorButton: 'Reset start',
        reanchorTitle: 'Make the current source color the new starting point',
        candidateTitle: (count) => `All ${count} candidates (pick your own here)`,
        candidateHint: 'Codes tagged "221" are also in the default 221 palette.',
        inBasicTag: '221',
        inBasicTitle: 'also in default 221',
        filterLabel: 'Filter by code or name',
        filterNone: 'No matching color code.',
        manualLabel: 'Type a color code',
        manualPlaceholder: 'e.g. A1 / ZG4',
        manualHint: 'Type any code — this path ignores the starting color above.',
        manualSubmit: 'Use this code',
        manualEmpty: 'Enter a color code first.',
        manualNotFound: (code) => `Unknown color code: ${code} (rejected, nothing changed)`,
        manualOk: (code) => `Selected code ${code}`,
        apply: 'Replace',
        applyRisky: 'Replace anyway',
        cancel: 'Cancel',
        flattenMerge: (codes, levelsBefore, levelsAfter) => `⚠️ After the swap, the color you picked and ${codes} on the picture will look like exactly the same color — this group of shades goes from ${levelsBefore} levels to ${levelsAfter}, and the picture will use fewer colors overall.`,
        flattenFar: (sourceCode, beads, levelsBefore, levelsAfter) => `⚠️ The color you picked is quite different from the original ${sourceCode}. After the swap those ${beads} beads become the new color and this shade disappears — the transition goes from ${levelsBefore} levels to ${levelsAfter} and looks flatter. If you only wanted a small tweak, pick one from the suggestions above.`,
        unwired: 'Recolor is not wired yet (missing onReplaceColor(source, target)); Replace is disabled.',
    },
};
function recolorLangOf(text) {
    return text?.palette === 'Palette' ? 'en' : 'zh';
}
/**
 * 用量面板内的改色编辑器（W3.1 / D6；W2-改色会话 R2 换状态模型）。
 *
 * 这是个**纯展示组件**：会话状态、推荐、压平判定都在 `./recolorSession` 里算好，
 * 「替换」只把**会话里的目标色**交给 `onApply()`（外面再调 `onReplaceColor(source, target)`）。
 * ⚠️ 它**不再读全局 `selectedColorId`**，也不再自己调 `recommendFromAnchor(source)` ——
 * 那两处正是"没选 A1 却换成 A1"与"越换越偏"的病根。
 *
 * 2026-09-20 第 2 批：**导出**给「换色」工具浮层复用（两个挂载点、同一个组件），并加 `compact` 精简形态。
 */
export function UsageRecolorEditor(props) {
    const { text, session, recolorRecommendations, targetColorId, warning, sourceColor, anchorColor, targetColor, sourceCount, sourcePacks, packUnit, compact, affectedCells, displayCode, displayName, onSelectTarget, onApply, onReanchor, onClose, setNotice, canApply, } = props;
    const [filter, setFilter] = useState('');
    const [manual, setManual] = useState('');
    const [manualError, setManualError] = useState('');
    const [manualOk, setManualOk] = useState('');
    const lang = recolorLangOf(text);
    const t = RECOLOR_TEXT[lang];
    const recommendations = recolorRecommendations.items;
    const candidates = listRecolorCandidates(sourceColor.id);
    const closestId = recommendations[0]?.color.id ?? null;
    const keyword = filter.trim().toLowerCase();
    const filtered = keyword
        ? candidates.filter((candidate) => [displayCode(candidate.color), displayName(candidate.color), candidate.color.hex, candidate.color.id]
            .join(' ')
            .toLowerCase()
            .includes(keyword))
        : candidates;
    const anchorCode = anchorColor ? displayCode(anchorColor) : recolorRecommendations.anchorColorId;
    const joinCodes = (ids) => ids
        .map((id) => {
        const color = getColor(id);
        return color ? displayCode(color) : id;
    })
        .join(lang === 'zh' ? '、' : ', ');
    // 两条"用户视角"的警告（措辞在 RECOLOR_TEXT；这里只负责把事实填进去）
    const warningText = warning.kind === 'merge'
        ? t.flattenMerge(joinCodes(warning.colorIds), warning.levelsBefore, warning.levelsAfter, warning.distinctColorsAfter < warning.distinctColorsBefore)
        : warning.kind === 'far'
            ? t.flattenFar(joinCodes([warning.sourceColorId]) || displayCode(sourceColor), warning.beads, warning.levelsBefore, warning.levelsAfter)
            : '';
    const sameTarget = targetColorId === sourceColor.id;
    const applyDisabled = !canApply || affectedCells === 0 || sameTarget || !targetColorId || !targetColor;
    const renderChip = (candidate, options) => (React.createElement("button", { key: candidate.color.id, type: "button", className: targetColorId === candidate.color.id ? 'swatch active' : 'swatch', title: `${displayCode(candidate.color)} ${displayName(candidate.color)}${options.rank === 0 ? ` · ${t.closestTag}` : ''}${candidate.inBasic221 ? ` · ${t.inBasicTitle}` : ''}`, "data-recolor-target": candidate.color.id, "data-recolor-distance": candidate.distance, "data-recolor-in-basic": candidate.inBasic221 ? '1' : '0', "data-recolor-rank": options.rank ?? '', "data-recolor-closest": options.rank === 0 ? '1' : '0', onClick: () => onSelectTarget(candidate.color.id) },
        React.createElement("span", { style: { backgroundColor: candidate.color.hex } }),
        React.createElement("small", null, displayCode(candidate.color)),
        options.showNumber ? (React.createElement("small", { style: { color: '#6b7280', fontWeight: 500 } }, candidate.distance.toFixed(2))) : null,
        options.rank === 0 ? React.createElement("small", { style: { color: '#17656a' } }, t.closestTag) : null,
        candidate.inBasic221 ? React.createElement("small", { style: { color: '#17656a' } }, t.inBasicTag) : null));
    const submitManual = () => {
        const result = lookupColorCode(manual);
        if (!result.ok) {
            const message = result.reason === 'empty' ? t.manualEmpty : t.manualNotFound(result.normalized);
            setManualError(message);
            setManualOk('');
            setNotice(message);
            return;
        }
        const message = t.manualOk(displayCode(result.color));
        setManualError('');
        setManualOk(message);
        onSelectTarget(result.color.id);
        setNotice(message);
    };
    return (React.createElement("div", { "data-recolor-editor": "1", "data-recolor-source": sourceColor.id, "data-recolor-anchor": recolorRecommendations.anchorColorId, "data-recolor-anchor-from-session": recolorRecommendations.anchorIsSessionAnchor ? '1' : '0', "data-recolor-target": targetColorId ?? '', 
        /* 版式搬到 CSS 类里（原来是一串内联样式）：Bug C 的根修要在**手机档**改
           `flex` / `min-height`，而内联样式 CSS 覆盖不掉（只能靠 `!important`，那是补丁）。
           类里的声明与原来的内联值逐条相同。 */
        className: "recolor-editor-body" },
        React.createElement("div", { className: "usage-summary-card" },
            React.createElement("div", { className: "usage-summary-head" },
                React.createElement("strong", null, t.editorTitle),
                React.createElement("span", null,
                    t.sourceLabel,
                    " ",
                    displayCode(sourceColor),
                    " \u00B7 ",
                    sourceCount,
                    t.beadsUnit,
                    " / ",
                    sourcePacks,
                    packUnit)),
            React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
                React.createElement("span", { className: "usage-chip", style: { backgroundColor: sourceColor.hex } }),
                React.createElement("span", { className: "usage-color-info" },
                    React.createElement("strong", null, displayCode(sourceColor)),
                    React.createElement("small", null, displayName(sourceColor))),
                React.createElement("span", { "aria-hidden": "true" }, "\u2192"),
                React.createElement("span", { className: "usage-chip", "data-recolor-target-chip": "1", style: { backgroundColor: targetColor?.hex } }),
                React.createElement("span", { className: "usage-color-info", "data-recolor-target-info": "1" },
                    React.createElement("strong", null, targetColor ? displayCode(targetColor) : '—'),
                    React.createElement("small", null, targetColor ? displayName(targetColor) : '')),
                React.createElement("span", { className: "usage-color-info", "data-recolor-anchor-info": "1", style: { marginLeft: 'auto', textAlign: 'right' } },
                    React.createElement("small", null,
                        t.startLabel,
                        " ",
                        anchorCode))),
            React.createElement("div", { className: "usage-notes" },
                React.createElement("span", null, t.targetHint),
                affectedCells === 0 && React.createElement("span", { "data-recolor-no-cells": "1" }, t.noCells),
                sameTarget && targetColorId && React.createElement("span", { "data-recolor-same": "1", style: { color: '#b93a32' } }, t.sameTarget),
                !canApply && React.createElement("span", { "data-recolor-unwired": "1" }, t.unwired),
                React.createElement("span", { "data-recolor-flatten": warning.kind === 'none' ? '0' : '1', "data-recolor-warning": warning.kind, style: warning.kind === 'none' ? undefined : { color: '#b93a32', fontWeight: 600 } }, warningText)),
            React.createElement("div", { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
                React.createElement("button", { type: "button", "data-recolor-apply": "1", "data-recolor-flatten-risk": warning.kind === 'none' ? '0' : '1', "data-recolor-apply-risky": warning.kind === 'none' ? '0' : '1', disabled: applyDisabled, title: sameTarget ? t.sameTarget : t.apply, onClick: onApply }, warning.kind === 'none' ? t.apply : t.applyRisky),
                React.createElement("button", { type: "button", "data-recolor-close": "1", onClick: onClose }, t.cancel))),
        !compact && (React.createElement(React.Fragment, null,
            React.createElement("div", null,
                React.createElement("div", { style: { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' } },
                    React.createElement("strong", { style: { fontSize: 'var(--font-size-small)', color: '#4b5563' } }, t.recommendTitle(anchorCode, recommendations.length)),
                    React.createElement("button", { type: "button", "data-recolor-reanchor": "1", title: t.reanchorTitle, style: { marginLeft: 'auto', whiteSpace: 'nowrap' }, onClick: onReanchor }, t.reanchorButton)),
                React.createElement("small", { style: { display: 'block', color: 'var(--text-muted)', fontSize: 'var(--font-size-small)' } }, t.recommendHint),
                React.createElement("div", { className: "palette-grid", "data-recolor-recommend": "1", "data-recolor-recommend-anchor": recolorRecommendations.anchorColorId, style: { flex: '0 0 auto', maxHeight: 'none', marginTop: 6 } }, recommendations.map((candidate, index) => renderChip(candidate, { showNumber: true, rank: index })))),
            React.createElement("div", { className: "stacked-field" },
                React.createElement("span", null, t.manualLabel),
                React.createElement("div", { style: { display: 'flex', gap: 8 } },
                    React.createElement("input", { "data-recolor-manual": "1", value: manual, placeholder: t.manualPlaceholder, onChange: (event) => {
                            setManual(event.target.value);
                            setManualError('');
                            setManualOk('');
                        }, onKeyDown: (event) => {
                            if (event.key === 'Enter')
                                submitManual();
                        } }),
                    React.createElement("button", { type: "button", "data-recolor-manual-submit": "1", style: { whiteSpace: 'nowrap' }, onClick: submitManual }, t.manualSubmit)),
                React.createElement("small", { style: { color: 'var(--text-muted)', fontSize: 'var(--font-size-small)' } }, t.manualHint),
                manualError && (React.createElement("small", { "data-recolor-manual-error": "1", style: { color: '#b93a32' } }, manualError)),
                !manualError && manualOk && (React.createElement("small", { "data-recolor-manual-ok": "1", style: { color: '#17656a' } }, manualOk))),
            React.createElement("div", null,
                React.createElement("strong", { style: { display: 'block', fontSize: 'var(--font-size-small)', color: '#4b5563' } }, t.candidateTitle(candidates.length)),
                React.createElement("small", { style: { display: 'block', color: 'var(--text-muted)', fontSize: 'var(--font-size-small)' } }, t.candidateHint),
                React.createElement("input", { "data-recolor-filter": "1", value: filter, placeholder: t.filterLabel, style: { margin: '6px 0' }, onChange: (event) => setFilter(event.target.value) }),
                React.createElement("div", { className: "palette-grid", "data-recolor-candidates": "1", style: { flex: '0 0 auto', maxHeight: 'clamp(220px, 32dvh, 360px)' } }, filtered.map((candidate) => renderChip(candidate, { showNumber: false }))),
                filtered.length === 0 && React.createElement("small", { "data-recolor-filter-empty": "1" }, t.filterNone))))));
}
/**
 * 「调色盘」正文（B10 抽取）：**一处实现、两个挂载点**。
 *
 * 抽取理由（根修，不是补丁）：
 *   B10 要求"色盘本体搬进画布右上角的浮层"，而**桌面档必须逐像素 Δ=0** ⇒ 桌面那一路
 *   必须继续渲染**同一套** markup。若为浮层另写一份色盘，两份必然漂移（这正是 AGENTS.md
 *   验证纪律 3 说的"不要在验证/第二实现里重抄产品逻辑"的同构问题）。
 *   所以这里把正文抽成一个组件，`rightTab === 'palette'`（桌面）与 `.palette-popover`
 *   （抽屉档）各自挂载**同一个** `PaletteBody`，同一时刻只有一处挂载
 *   （抽屉档不渲染 `rightTab === 'palette'` 分支，见 `RightPanel` 里的 `drawerMode`）。
 *
 * 内容的划分（"选色必需 vs 可放参数"）：
 *   ✅ 留在这里（跟着色盘走，缺一个都不能选色）：
 *      `.palette-selected-card`（当前色：不看它不知道手上是什么）、
 *      `.recent-colors-field`（最近使用：最常用的一次点击）、
 *      `.palette-filter`（分组筛选：221/291 色没有分组在浮层里没法用）、
 *      `.palette-grid`（网格本体）。
 *   ➡️ 不在这里（搬去左抽屉 `.params-card`，仅抽屉档）：`brandSelect`
 *      （品牌 + 221/291 版本档）—— 它是**工程级设置**、不是"挑一个颜色"，
 *      而且它带着 CC BY 署名折叠块（合规义务），挂在参数卡里语义更顺。
 *      ⚠️ 桌面档它仍由本组件在下面 `{brandSelect}` 处渲染（DOM 与改动前逐字相同）。
 */
export function PaletteBody(props) {
    const { text, selectedColor, selectedColorId, displayCode, displayName, recentColors, selectColor, paletteGroups, paletteGroup, setPaletteGroup, visiblePalette, brandSelect, showHeading = true, } = props;
    return (React.createElement("section", { className: "panel-section panel-tab-body palette-section" },
        showHeading && React.createElement("h2", null, text.palette),
        React.createElement("div", { className: "palette-selected-card" },
            React.createElement("span", { style: { backgroundColor: selectedColor?.hex } }),
            React.createElement("div", { className: "palette-selected-main" },
                React.createElement("strong", null, selectedColor ? displayCode(selectedColor) : ''),
                React.createElement("small", null, selectedColor ? displayName(selectedColor) : '')),
            React.createElement("div", { className: "palette-selected-hex" },
                React.createElement("small", null, selectedColor?.hex))),
        React.createElement("div", { className: "recent-colors-field" },
            React.createElement("span", null, text.recentColors),
            React.createElement("div", { className: "recent-color-row" }, recentColors.map((color) => (React.createElement("button", { key: color.id, type: "button", className: selectedColorId === color.id ? 'active' : '', title: `${displayCode(color)} ${displayName(color)}`, "aria-label": `${text.recentColors} ${displayCode(color)}`, onClick: () => selectColor(color.id, { updateRecent: false }) },
                React.createElement("span", { style: { backgroundColor: color.hex } }),
                React.createElement("small", null, displayCode(color))))))),
        brandSelect,
        React.createElement("div", { className: "palette-filter", "aria-label": "Palette groups" }, paletteGroups.map((group) => (React.createElement("button", { key: group.id, className: paletteGroup === group.id ? 'active' : '', onClick: () => setPaletteGroup(group.id) }, group.label)))),
        React.createElement("div", { className: "palette-grid" }, visiblePalette.map((color) => (React.createElement("button", { key: color.id, className: selectedColorId === color.id ? 'swatch active' : 'swatch', title: `${displayCode(color)} ${displayName(color)}`, onClick: () => {
                selectColor(color.id);
            } },
            React.createElement("span", { style: { backgroundColor: color.hex } }),
            React.createElement("small", null, displayCode(color))))))));
}
export default function RightPanel(props) {
    const { text, rightTab, setRightTab, setNotice, project, usage, totalBeads, totalPacks, selectedColor, selectedColorId, displayCode, displayName, recentColors, selectColor, paletteGroups, paletteGroup, setPaletteGroup, visiblePalette, stepBeadsPerPack, setBeadsPerPack, isolatedBeads, showIsolatedBeads, setShowIsolatedBeads, setHighlightedColorId, updateProject, hoverCell, onReplaceColor, brandSelect, recolor, hideRecolorEditor, drawerMode = false, paramsCard, } = props;
    // ── R2 改色会话（2026-09-20 第 2 批：状态与派生都搬到 `App` 的 `useRecolorSession`）──────
    // 会话本身 + 推荐 + 派生事实都在钩子里算好（**同一口径、一处实现**），面板与
    // 「换色」工具浮层共享同一份 ⇒ 两边永不打架。
    const recolorSession = recolor.session;
    const recolorOpen = recolor.open;
    /**
     * 打开改色编辑器（= 融合前的 `RightPanel.openRecolorEditor`）。
     *
     * ⚠️ 这里必须**先清掉 hover 高亮**（Bug B 根修）：打开编辑器会把整个用量列表换成编辑器，
     * 被 hover 的那一行随之卸载 —— 若不在这一刻清，"离开"事件永远不会来（旧实现就是如此）。
     */
    const openRecolorEditor = (sourceColorId) => {
        setHighlightedColorId(null);
        recolor.openFor(sourceColorId);
    };
    const setRecolorOpen = (next) => { if (!next)
        recolor.close(); };
    const recolorSourceColor = recolor.sourceColor;
    const recolorSourceRow = recolor.sourceRow;
    const recolorRecommendations = recolor.recommendations;
    // 面板这一侧的生效目标色 = 会话口径（用户挑过用挑的，没挑过用**推荐第 1 条**）。
    const recolorTargetId = recolor.sessionTargetId;
    const recolorFacts = recolor.facts(recolorTargetId);
    const recolorAffectedCells = recolorFacts.affectedCells;
    const recolorAnalysis = recolorFacts.analysis;
    /**
     * Bug B 根修（最后一道保险）：**本组件卸载 = 用量列表不存在了**，高亮必须归零。
     * 卸载时不会派发 `pointerleave`（列表是被整体换掉的，不是"指针移开了"），
     * 所以不能只靠容器的 `onPointerLeave`。
     */
    useEffect(() => () => setHighlightedColorId(null), [setHighlightedColorId]);
    return (React.createElement("aside", { className: "right-panel" },
        !drawerMode && (React.createElement("div", { className: "right-tabs", role: "tablist", "aria-label": "Right panel" },
            React.createElement("button", { className: rightTab === 'palette' ? 'active' : '', role: "tab", "aria-selected": rightTab === 'palette', onClick: () => setRightTab('palette') }, text.palette),
            React.createElement("button", { className: rightTab === 'usage' ? 'active' : '', role: "tab", "aria-selected": rightTab === 'usage', onClick: () => setRightTab('usage') }, text.usage))),
        !drawerMode && rightTab === 'palette' && (React.createElement(PaletteBody, { text: text, selectedColor: selectedColor, selectedColorId: selectedColorId, displayCode: displayCode, displayName: displayName, recentColors: recentColors, selectColor: selectColor, paletteGroups: paletteGroups, paletteGroup: paletteGroup, setPaletteGroup: setPaletteGroup, visiblePalette: visiblePalette, brandSelect: brandSelect })),
        (drawerMode || rightTab === 'usage') && (React.createElement("section", { className: "panel-section panel-tab-body usage-section" },
            React.createElement("h2", null, text.usage),
            React.createElement("div", { className: "usage-overview" },
                React.createElement("div", null,
                    React.createElement("span", null, text.totalBeadsLabel),
                    React.createElement("strong", null, totalBeads)),
                React.createElement("div", null,
                    React.createElement("span", null, text.colorTypes),
                    React.createElement("strong", null, usage.length)),
                React.createElement("div", null,
                    React.createElement("span", null, text.estimatedPacks),
                    React.createElement("strong", null, totalPacks))),
            React.createElement("label", { className: "usage-pack-setting" },
                React.createElement("span", null, text.beadsPerPack),
                React.createElement("div", { className: "usage-pack-control" },
                    React.createElement("div", { className: "usage-pack-stepper" },
                        React.createElement("button", { type: "button", onClick: () => stepBeadsPerPack(-1) }, "-"),
                        React.createElement("input", { type: "number", min: 1, max: 10000, step: 500, value: project.settings.beadsPerPack, onChange: (event) => setBeadsPerPack(Number(event.target.value)) }),
                        React.createElement("button", { type: "button", onClick: () => stepBeadsPerPack(1) }, "+")),
                    React.createElement("small", null, text.perPackUnit))),
            (usage.length > 32 || isolatedBeads > 0) && (React.createElement("div", { className: "usage-notes-card" },
                React.createElement("div", { className: "usage-notes" },
                    usage.length > 32 && React.createElement("span", null, text.manyColors),
                    isolatedBeads > 0 && (React.createElement("span", { className: "usage-note-line" },
                        React.createElement("span", null, text.isolatedBeads(isolatedBeads)),
                        React.createElement("button", { className: showIsolatedBeads ? 'usage-note-eye active' : 'usage-note-eye', type: "button", title: showIsolatedBeads ? text.hideIsolatedBeads : text.showIsolatedBeads, "aria-label": showIsolatedBeads ? text.hideIsolatedBeads : text.showIsolatedBeads, "aria-pressed": showIsolatedBeads, onClick: () => setShowIsolatedBeads((current) => !current) },
                            React.createElement(EyeIcon, { visible: showIsolatedBeads }))))))),
            React.createElement("div", { "data-recolor-entry": "1", style: { flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
                React.createElement("span", { style: { color: 'var(--text-muted)', fontSize: 'var(--font-size-small)' } }, RECOLOR_TEXT[recolorLangOf(text)].entryHint),
                React.createElement("button", { type: "button", "data-recolor-open": "1", title: RECOLOR_TEXT[recolorLangOf(text)].entryTitle, onClick: () => {
                        const first = usage[0];
                        if (first)
                            openRecolorEditor(first.color.id);
                    } }, RECOLOR_TEXT[recolorLangOf(text)].entryButton)),
            recolorOpen && recolorSession && recolorSourceColor && recolorRecommendations && recolorAnalysis && !hideRecolorEditor ? (React.createElement(UsageRecolorEditor, { text: text, session: recolorSession, recolorRecommendations: recolorRecommendations, targetColorId: recolorTargetId, warning: flattenWarningOf(recolorAnalysis), sourceColor: recolorSourceColor, anchorColor: getColor(recolorRecommendations.anchorColorId), targetColor: recolorTargetId ? getColor(recolorTargetId) : undefined, sourceCount: recolorSourceRow?.count ?? 0, sourcePacks: recolorSourceRow?.packs ?? 0, packUnit: text.packUnit, affectedCells: recolorAffectedCells, displayCode: displayCode, displayName: displayName, onSelectTarget: (colorId) => recolor.setSession((current) => (current ? pickTarget(current, colorId) : current)), onApply: () => {
                    if (!onReplaceColor || !recolorTargetId)
                        return;
                    // ⚠️ 显式把目标色交给 App（不再依赖全局 selectedColorId）；替换后**只关编辑器**
                    //    （`setRecolorOpen(false)`），**会话保留** ⇒ 锚点不丢，下次从别的源色打开仍由起点延伸。
                    onReplaceColor(recolorSession.sourceColorId, recolorTargetId);
                    setRecolorOpen(false);
                }, onReanchor: () => recolor.setSession((current) => (current ? resetAnchor(current) : current)), onClose: () => setRecolorOpen(false), setNotice: setNotice, canApply: Boolean(onReplaceColor) })) : (
            /*
              🔴 **"离开"的判定放在容器上，不逐行**（Bug B 根修，2026-09-21）。

              旧写法把 `onMouseLeave={() => setHighlightedColorId(null)}` 放在**每一行**上，
              而"点某一行 = 打开改色编辑器"会把**整个用量列表换掉**（本三元分支）
              ⇒ 被 hover 的那一行**被卸载**，`onMouseLeave` **永远不会触发**，
              而全仓只有那两处会清它 ⇒ 高亮（画布上把非该色的格子刷白）**永久残留**；
              触屏连 hover 语义都没有，更明显（基线实测：退出后画布 71.63% 像素与未 solo 基线不同）。

              现在：进入哪一行仍由行自己报（行内 `onPointerEnter` + `pointerType === 'mouse'`），
              **离开一律由容器报**（`onPointerLeave` 是 `mouseleave` 的超集，手指抬起也会触发）。
              另有"显式清除清单"（换工具 / 切 tab / 换工程 / 画布交互 / 打开编辑器 / 本组件卸载），
              见 `App.tsx` 里的同名注释与下面 `openRecolorEditor`。
            */
            React.createElement("div", { className: "usage-list", onPointerLeave: () => setHighlightedColorId(null) },
                usage.map((row) => (React.createElement("button", { key: row.color.id, onPointerEnter: (event) => { if (event.pointerType === 'mouse')
                        setHighlightedColorId(row.color.id); }, onClick: () => openRecolorEditor(row.color.id) },
                    React.createElement("span", { className: "usage-chip", style: { backgroundColor: row.color.hex } }),
                    React.createElement("span", { className: "usage-color-info" },
                        React.createElement("strong", null, displayCode(row.color)),
                        React.createElement("small", null, displayName(row.color))),
                    React.createElement("span", { className: "usage-count" },
                        React.createElement("strong", null, row.count),
                        React.createElement("small", null,
                            row.packs,
                            " ",
                            text.packUnit))))),
                usage.length === 0 && React.createElement("div", { className: "usage-empty" }, text.noUsage))))),
        rightTab === 'palette' && (React.createElement(React.Fragment, null,
            React.createElement("section", { className: "panel-section view-section" },
                React.createElement("h2", null, text.view),
                React.createElement("div", { className: "view-toggle-grid" },
                    React.createElement("div", { className: "view-shape-toggle", "aria-label": text.beadShape },
                        React.createElement("span", null, text.beadShape),
                        React.createElement("div", null,
                            React.createElement("button", { type: "button", className: project.settings.beadDisplayMode === 'bead' ? 'active' : '', "aria-pressed": project.settings.beadDisplayMode === 'bead', onClick: () => updateProject({ ...project, settings: { ...project.settings, beadDisplayMode: 'bead' } }) },
                                React.createElement("span", { className: "shape-choice-icon shape-choice-icon-round", "aria-hidden": "true" }),
                                React.createElement("span", null, text.roundBeads)),
                            React.createElement("button", { type: "button", className: project.settings.beadDisplayMode === 'pixel' ? 'active' : '', "aria-pressed": project.settings.beadDisplayMode === 'pixel', onClick: () => updateProject({ ...project, settings: { ...project.settings, beadDisplayMode: 'pixel' } }) },
                                React.createElement("span", { className: "shape-choice-icon shape-choice-icon-square", "aria-hidden": "true" }),
                                React.createElement("span", null, text.squareBeads)))),
                    React.createElement("div", { className: "view-row" },
                        React.createElement("label", { className: "checkline" },
                            React.createElement("input", { type: "checkbox", checked: project.settings.showGrid, onChange: (event) => updateProject({ ...project, settings: { ...project.settings, showGrid: event.target.checked } }) }),
                            text.grid),
                        React.createElement("label", { className: "checkline" },
                            React.createElement("input", { type: "checkbox", checked: project.settings.showCoordinates, onChange: (event) => updateProject({ ...project, settings: { ...project.settings, showCoordinates: event.target.checked } }) }),
                            text.coordinates)),
                    React.createElement("div", { className: "view-row" },
                        React.createElement("label", { className: "checkline" },
                            React.createElement("input", { type: "checkbox", checked: project.settings.showColorCodes, onChange: (event) => updateProject({ ...project, settings: { ...project.settings, showColorCodes: event.target.checked } }) }),
                            text.showColorCodes),
                        React.createElement("label", { className: "checkline" },
                            React.createElement("input", { type: "checkbox", checked: project.settings.showLayerOverlap, onChange: (event) => updateProject({ ...project, settings: { ...project.settings, showLayerOverlap: event.target.checked } }) }),
                            text.layerOverlap)))),
            React.createElement("section", { className: "panel-section hover-section" },
                React.createElement("h2", null, text.cell),
                hoverCell ? (React.createElement("span", null,
                    "R",
                    hoverCell.y + 1,
                    " C",
                    hoverCell.x + 1,
                    " - ",
                    getColor(hoverCell.colorId)?.primaryCode ?? text.empty)) : (React.createElement("span", null, text.hoverBoard))))),
        drawerMode && paramsCard && React.createElement("div", { className: "params-drawer-slot" }, paramsCard)));
}
//# sourceMappingURL=RightPanel.js.map