import { CloseIcon, ExportIcon } from './icons.js';
const { useEffect, useState } = React;
/* ── W3.2 平台裁切（D2 / D4）─────────────────────────────────────────────────
   为什么不用 App.tsx 的 language/平台状态：本文件不许依赖 App.tsx，自己用 matchMedia 判。

   ⚠️ 教训（不要重犯）：**布局断点 ≠ 平台判据**。
   这里曾经用过 `(min-width: 768px) and (max-width: 1180px)` 把"窄视口"也当成平板，
   结果一个 1000px 宽、细指针（鼠标）的**桌面窗口**被判成平板 ⇒ 「导出用量 Excel」被隐藏，
   与用户明确拍板的 D1/D2（桌面端 Excel 不许砍）冲突。
   布局断点（要不要抽屉/单列）交给 CSS 与 WorkspaceCanvas 的 PANEL_LAYOUT_QUERY；
   本文件的职责只是**平台能力**：手机 / 触屏平板 / 桌面。

   平台判据（2026-09-20 第 5 批修订，用户裁决）：
     · 手机        = (max-width: 767px)              → 无 Excel、无 PDF
     · 触屏平板    = 粗指针 **且宽度 768–1400**        → 无 Excel、有 PDF
     · 桌面（含任意窄窗、细指针，以及 **≥1367 的宽屏触屏**）= 其余 → 有 Excel、有 PDF
   **第 5 批**：触屏平板加了 1400 宽度上限 ⇒ 1920 的触屏电脑不再被当成平板（"有触屏也触发桌面版"）。
   旧口径的已知代价（触屏 Windows 笔记本按平板处理、没有 Excel）由这次修订消除。
   判据与 `useMediaQuery.ts` 的 `TOUCH_TABLET_QUERY` **同源**，不再自己写 media query。 */
// 2026-09-20 第 2 批：媒体查询钩子与**手机断点常量**抽到 `./useMediaQuery`
//（「换色」工具浮层也要判"是不是手机"，全仓只保留一处断点定义）。
// 第 5 批：`COARSE_POINTER_QUERY` → `TOUCH_TABLET_QUERY`（加了 1400 宽度上限）。
import { PHONE_QUERY, TOUCH_TABLET_QUERY, useMediaQuery } from './useMediaQuery.js';
/** D5 复选框文案。优先用 i18n 里的 key（W3.4 接上后自动生效），没有就按界面语言兜一个。 */
const USAGE_TABLE_LABEL = { zh: '导出时附用量表', en: 'Include usage table' };
export default function ExportPanel(props) {
    const { text, showPrintExportPanel, setShowPrintExportPanel, printExportOptions, setPrintExportOptions, defaultPrintNickname, exportPrintPattern, exportUsageList, exportEditRecord, jsonInputRef, } = props;
    // D2 / D4：平台矩阵（桌面 = Excel + PDF；触屏平板 = 只有 PDF；手机 = 只有 PNG）
    // ⚠️ 所有 useMediaQuery 必须**无条件**调用：写成 `!isPhone && useMediaQuery(...)` 会短路，
    //    窗口从桌面拖到手机宽度时 hook 数量变化 → React 崩「reading 'length'」（实测踩到，手机端整个白屏）。
    const phoneMedia = useMediaQuery(PHONE_QUERY);
    const touchTabletMedia = useMediaQuery(TOUCH_TABLET_QUERY);
    const isPhone = phoneMedia;
    // 平台 = 手机 / 触屏平板 / 桌面。**第 5 批**：触屏平板带 1400 宽度上限 ⇒ 宽屏触屏电脑算桌面。
    // `TOUCH_TABLET_QUERY` 自带 `(min-width:768px)`，`!phoneMedia` 是冗余保险（口径仍写全）。
    const isTouchTablet = !phoneMedia && touchTabletMedia;
    const showUsageExport = !isPhone && !isTouchTablet;
    const showPdfOption = !isPhone;
    // 渲染用的有效格式：手机端一律按 png 显示/提交
    const effectiveFormat = showPdfOption ? (printExportOptions.format ?? 'png') : 'png';
    const usageTableLabel = text.includeUsageTable ?? (/[\u4e00-\u9fff]/.test(String(text.exportFormat ?? '')) ? USAGE_TABLE_LABEL.zh : USAGE_TABLE_LABEL.en);
    // D4 兜底：手机端必须把 format **写回 state** 归一到 png。
    // 只在渲染时替换显示是不够的 —— App.tsx 的 exportPrintPattern() 读的就是这份 state
    // （`printExportOptions.format === 'pdf'` ⇒ downloadPrintPdf），
    // 否则「桌面选过 PDF → 换到手机/旋转窗口」仍会导出 PDF。
    useEffect(() => {
        if (showPdfOption || printExportOptions.format !== 'pdf')
            return;
        setPrintExportOptions((current) => (current.format === 'pdf' ? { ...current, format: 'png' } : current));
    }, [showPdfOption, printExportOptions.format, setPrintExportOptions]);
    return (React.createElement("div", { className: "topbar-actions export-actions" },
        React.createElement("div", { className: "print-export-menu" },
            React.createElement("button", { className: "export-action-button primary-action print-export-button", title: `${text.exportPatternTitle} PNG`, "aria-expanded": showPrintExportPanel, onClick: () => setShowPrintExportPanel((value) => !value) },
                React.createElement(ExportIcon, null),
                React.createElement("span", null, text.exportPatternFull)),
            showPrintExportPanel && (React.createElement("div", { className: "print-export-popover" },
                React.createElement("div", { className: "print-export-popover-header" },
                    React.createElement("strong", null, text.printExportSettings),
                    React.createElement("button", { className: "print-export-close", type: "button", "aria-label": text.close, title: text.close, onClick: () => setShowPrintExportPanel(false) },
                        React.createElement(CloseIcon, null))),
                React.createElement("label", { className: "export-text-field" },
                    React.createElement("span", null, text.exportFormat),
                    React.createElement("select", { className: "export-format-select", value: effectiveFormat, onChange: (event) => setPrintExportOptions((current) => ({ ...current, format: event.target.value })) },
                        React.createElement("option", { value: "png" }, "PNG"),
                        showPdfOption && React.createElement("option", { value: "pdf" }, "PDF"))),
                React.createElement("label", { className: "export-text-field" },
                    React.createElement("span", null, text.exportBounds),
                    React.createElement("select", { className: "export-format-select", value: printExportOptions.exportBounds ?? 'pattern', onChange: (event) => setPrintExportOptions((current) => ({ ...current, exportBounds: event.target.value })) },
                        React.createElement("option", { value: "pattern" }, text.exportPatternBounds),
                        React.createElement("option", { value: "canvas" }, text.exportCanvasBounds))),
                React.createElement("label", { className: "export-text-field" },
                    React.createElement("span", null, text.projectNickname),
                    React.createElement("input", { value: printExportOptions.projectName ?? '', placeholder: defaultPrintNickname, onChange: (event) => setPrintExportOptions((current) => ({ ...current, projectName: event.target.value })) })),
                React.createElement("label", { className: "export-text-field" },
                    React.createElement("span", null, text.authorNickname),
                    React.createElement("input", { value: printExportOptions.authorName ?? '', placeholder: text.optional, onChange: (event) => setPrintExportOptions((current) => ({ ...current, authorName: event.target.value })) })),
                React.createElement("label", { className: "switch-row" },
                    React.createElement("span", null, text.showColorCodes),
                    React.createElement("input", { type: "checkbox", checked: printExportOptions.showColorCodes, onChange: (event) => setPrintExportOptions((current) => ({ ...current, showColorCodes: event.target.checked })) })),
                React.createElement("label", { className: "switch-row" },
                    React.createElement("span", null, text.showGuideLines),
                    React.createElement("input", { type: "checkbox", checked: printExportOptions.showGuideLines, onChange: (event) => setPrintExportOptions((current) => ({ ...current, showGuideLines: event.target.checked })) })),
                React.createElement("label", { className: "switch-row" },
                    React.createElement("span", null, usageTableLabel),
                    React.createElement("input", { type: "checkbox", checked: printExportOptions.includeUsageTable === true, onChange: (event) => setPrintExportOptions((current) => ({ ...current, includeUsageTable: event.target.checked })) })),
                React.createElement("button", { className: "export-submit-button", onClick: exportPrintPattern },
                    text.exportNow,
                    " ",
                    effectiveFormat.toUpperCase())))),
        showUsageExport && (React.createElement("button", { className: "export-action-button", title: text.exportUsageTitle, onClick: exportUsageList }, text.exportUsageFull))));
}
//# sourceMappingURL=ExportPanel.js.map