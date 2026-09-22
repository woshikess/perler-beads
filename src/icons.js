/**
 * 全部图标组件（纯 SVG，无状态）。
 *
 * W0.1 从 App.tsx 纯搬迁：L3727–L3753 与 L3772–L4054，内容一字未改。
 * （中间的 L3754–L3770 `resizeCells` 不是图标，已单独搬到 `src/cells.ts`。）
 */
import { getColor } from './palette.js';
export function ExportIcon() {
    return (React.createElement("svg", { viewBox: "0 0 20 20", "aria-hidden": "true" },
        React.createElement("path", { d: "M10 3v9" }),
        React.createElement("path", { d: "m6.8 8.8 3.2 3.2 3.2-3.2" }),
        React.createElement("path", { d: "M4 13.2v2.6c0 .7.5 1.2 1.2 1.2h9.6c.7 0 1.2-.5 1.2-1.2v-2.6" })));
}
export function GitHubIcon() {
    return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
        React.createElement("path", { d: "M12 2.5a9.5 9.5 0 0 0-3 18.5c.48.08.66-.2.66-.46v-1.7c-2.68.58-3.25-1.14-3.25-1.14-.44-1.1-1.07-1.4-1.07-1.4-.88-.6.07-.58.07-.58.97.07 1.48 1 1.48 1 .86 1.47 2.25 1.04 2.8.8.09-.62.34-1.04.61-1.28-2.14-.24-4.39-1.07-4.39-4.76 0-1.05.38-1.91 1-2.58-.1-.25-.43-1.24.1-2.55 0 0 .81-.26 2.66.99a9.16 9.16 0 0 1 4.84 0c1.85-1.25 2.66-.99 2.66-.99.53 1.31.2 2.3.1 2.55.62.67 1 1.53 1 2.58 0 3.7-2.26 4.51-4.4 4.75.35.3.66.9.66 1.81v2.5c0 .26.17.55.67.46A9.5 9.5 0 0 0 12 2.5z" })));
}
export function CloseIcon() {
    return (React.createElement("svg", { viewBox: "0 0 20 20", "aria-hidden": "true" },
        React.createElement("path", { d: "M6 6l8 8" }),
        React.createElement("path", { d: "M14 6l-8 8" })));
}
/**
 * W1：撤销 / 重做箭头（等价官方符号 `arrow.uturn.backward` / `arrow.uturn.forward`）。
 *
 * 语义**只在形状里**：这两个组件不带 `aria-label` / `title`（图标本身是装饰，
 * `aria-hidden="true"`）——可访问名由调用方（顶栏按钮）负责，缺了就等同于没有名字。
 * 描边样式在 styles.css 里给（`.document-actions .history-action svg`）。
 */
export function UndoIcon() {
    return (React.createElement("svg", { viewBox: "0 0 20 20", "aria-hidden": "true" },
        React.createElement("path", { d: "M7.6 5.2 4.2 8.6l3.4 3.4" }),
        React.createElement("path", { d: "M4.2 8.6h7.1a4.1 4.1 0 0 1 0 8.2H8.6" })));
}
export function RedoIcon() {
    return (React.createElement("svg", { viewBox: "0 0 20 20", "aria-hidden": "true" },
        React.createElement("path", { d: "M12.4 5.2l3.4 3.4-3.4 3.4" }),
        React.createElement("path", { d: "M15.8 8.6H8.7a4.1 4.1 0 0 0 0 8.2h2.7" })));
}
export function LockIcon({ locked }) {
    return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
        React.createElement("rect", { x: "5.5", y: "10", width: "13", height: "10", rx: "2" }),
        React.createElement("path", { d: locked ? 'M8.5 10V7.7a3.5 3.5 0 017 0V10' : 'M8.5 10V7.7a3.5 3.5 0 016.4-2' })));
}
export function PencilIcon() {
    return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
        React.createElement("path", { d: "M4 20l4.6-1 9.8-9.8-3.6-3.6L5 15.4 4 20z" }),
        React.createElement("path", { d: "M13.8 4.6l1.5-1.5c.7-.7 1.8-.7 2.5 0l1.1 1.1c.7.7.7 1.8 0 2.5l-1.5 1.5" })));
}
export function EyeIcon({ visible }) {
    return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
        React.createElement("path", { d: "M2.8 12s3.3-5.5 9.2-5.5 9.2 5.5 9.2 5.5-3.3 5.5-9.2 5.5S2.8 12 2.8 12z" }),
        React.createElement("circle", { cx: "12", cy: "12", r: "2.5" }),
        !visible && React.createElement("path", { d: "M4 4l16 16" })));
}
export function ResetIcon() {
    return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
        React.createElement("path", { d: "M4.5 11a7.5 7.5 0 1 1 2.2 5.3" }),
        React.createElement("path", { d: "M4.5 5.5V11h5.5" })));
}
export function ClipboardPreview({ pattern }) {
    const maxSide = Math.max(pattern.width, pattern.height, 1);
    const beadSize = Math.max(3, Math.min(10, Math.floor(76 / maxSide)));
    return (React.createElement("div", { className: "clipboard-preview", style: {
            gridTemplateColumns: `repeat(${pattern.width}, ${beadSize}px)`,
            gridAutoRows: `${beadSize}px`,
        }, "aria-hidden": "true" }, pattern.cells.map((colorId, index) => {
        const color = colorId ? getColor(colorId) : null;
        return React.createElement("span", { key: index, style: { background: color?.hex ?? 'transparent' } });
    })));
}
/**
 * 工具图标。
 *
 * `clipboardPhase` 只有「复制」这一个工具用得上 —— 它是**双态按钮**：
 * 拖选范围时显示「复制」图标，可以落图时显示「粘贴」图标。
 */
export function ToolIcon({ tool, clipboardPhase = 'copy' }) {
    if (tool === 'pencil') {
        return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
            React.createElement("path", { d: "M4 20l4.7-1 9.8-9.8-3.7-3.7L5 15.3 4 20z" }),
            React.createElement("path", { d: "M14.8 5.5l1.7-1.7c.7-.7 1.8-.7 2.5 0l1.2 1.2c.7.7.7 1.8 0 2.5l-1.7 1.7" })));
    }
    if (tool === 'eraser') {
        return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
            React.createElement("path", { d: "M4.3 14.6l7.9-7.9c.8-.8 2-.8 2.8 0l4.3 4.3c.8.8.8 2 0 2.8l-5.9 5.9H8.6l-4.3-4.3c-.2-.2-.2-.6 0-.8z" }),
            React.createElement("path", { d: "M9.8 19.7h10" })));
    }
    if (tool === 'fill') {
        return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
            React.createElement("path", { d: "M5 12.5l6.5-6.5 7 7-6 6c-.8.8-2 .8-2.8 0L5 14.3c-.5-.5-.5-1.3 0-1.8z" }),
            React.createElement("path", { d: "M8.5 8.5l-2-2" }),
            React.createElement("path", { d: "M17.5 17.2c.8 1.1 1.2 1.9 1.2 2.4 0 1-.7 1.6-1.6 1.6s-1.6-.6-1.6-1.6c0-.5.4-1.3 1.2-2.4.2-.3.6-.3.8 0z" })));
    }
    if (tool === 'recolor') {
        return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
            React.createElement("path", { d: "M6 7.5h7.2c2.2 0 4 1.8 4 4v.3" }),
            React.createElement("path", { d: "M9 4.5 6 7.5l3 3" }),
            React.createElement("path", { d: "M18 16.5h-7.2c-2.2 0-4-1.8-4-4v-.3" }),
            React.createElement("path", { d: "M15 19.5l3-3-3-3" }),
            React.createElement("path", { d: "M8 16.2c.9 1.2 1.3 2 1.3 2.6 0 1-.7 1.7-1.7 1.7S6 19.8 6 18.8c0-.6.4-1.4 1.3-2.6.2-.3.5-.3.7 0z" })));
    }
    if (tool === 'eyedropper') {
        return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
            React.createElement("path", { d: "M14.8 4.3l4.9 4.9-3.1 3.1-1.5-1.5-7.9 7.9H4.8v-2.4l7.9-7.9-1.1-1.1 3.2-3z" }),
            React.createElement("path", { d: "M5 20h6" })));
    }
    if (tool === 'move') {
        return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
            React.createElement("path", { d: "M12 3v18" }),
            React.createElement("path", { d: "M8.5 6.5 12 3l3.5 3.5" }),
            React.createElement("path", { d: "M8.5 17.5 12 21l3.5-3.5" }),
            React.createElement("path", { d: "M3 12h18" }),
            React.createElement("path", { d: "M6.5 8.5 3 12l3.5 3.5" }),
            React.createElement("path", { d: "M17.5 8.5 21 12l-3.5 3.5" })));
    }
    // 双态：拖选范围时是「复制」，可以落图时是「粘贴」（相位由 App 的 clipboardPhase 决定）
    if (tool === 'clipboard') {
        return clipboardPhase === 'paste' ? (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
            React.createElement("path", { d: "M9 5h6l1 2h2.2c.9 0 1.8.8 1.8 1.8v9.4c0 1-.8 1.8-1.8 1.8H5.8c-1 0-1.8-.8-1.8-1.8V8.8C4 7.8 4.8 7 5.8 7H8z" }),
            React.createElement("path", { d: "M9 5c0-1.1.8-2 2-2h2c1.2 0 2 .9 2 2" }),
            React.createElement("path", { d: "M8 12h8M8 16h5" }))) : (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
            React.createElement("rect", { x: "8", y: "8", width: "11", height: "11", rx: "2" }),
            React.createElement("path", { d: "M5 16V6.8C5 5.8 5.8 5 6.8 5H16" }),
            React.createElement("path", { d: "M11 12h5M13.5 9.5v5" })));
    }
    if (tool === 'mirror') {
        return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
            React.createElement("path", { d: "M12 4v16" }),
            React.createElement("path", { d: "M5 7.5h4v9H5z" }),
            React.createElement("path", { d: "M19 7.5h-4v9h4z" }),
            React.createElement("path", { d: "M9 12h6" }),
            React.createElement("path", { d: "M7 5.5 5 7.5l2 2" }),
            React.createElement("path", { d: "M17 5.5l2 2-2 2" })));
    }
    if (tool === 'shape') {
        return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
            React.createElement("path", { d: "M4.5 16.5 9 8.5l4 7.5z" }),
            React.createElement("path", { d: "M13.8 5.2h5v5h-5z" }),
            React.createElement("path", { d: "M14.8 17.4a2.8 2.8 0 1 0 5.6 0 2.8 2.8 0 0 0-5.6 0z" })));
    }
    if (tool === 'text') {
        return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
            React.createElement("path", { d: "M5 6h14" }),
            React.createElement("path", { d: "M12 6v12" }),
            React.createElement("path", { d: "M8.5 18h7" })));
    }
    // 10 个工具都在上面各自覆盖了。**不再保留"抓手"兜底分支** —— 以前 `pan` 走的就是兜底，
    // 结果是"将来新增工具会静默抢到抓手图标"；现在未匹配直接返回空，问题会立刻暴露。
    return null;
}
export function ShapeOptionIcon({ shape }) {
    if (shape === 'line') {
        return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
            React.createElement("path", { d: "M5 19 19 5" })));
    }
    if (shape === 'rectangle') {
        return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
            React.createElement("path", { d: "M5 7h14v10H5z" })));
    }
    if (shape === 'square') {
        return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
            React.createElement("path", { d: "M6.5 6.5h11v11h-11z" })));
    }
    if (shape === 'ellipse') {
        return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
            React.createElement("path", { d: "M4.5 12a7.5 5.2 0 1 0 15 0 7.5 5.2 0 0 0-15 0z" })));
    }
    if (shape === 'circle') {
        return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
            React.createElement("path", { d: "M5.5 12a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0z" })));
    }
    if (shape === 'triangle') {
        return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
            React.createElement("path", { d: "M12 5 19 18H5z" })));
    }
    return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
        React.createElement("path", { d: "M5 12h12" }),
        React.createElement("path", { d: "M13 8l4 4-4 4" })));
}
export function ArrowOptionIcon({ arrow }) {
    if (arrow === 'double') {
        return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
            React.createElement("path", { d: "M6 12h12" }),
            React.createElement("path", { d: "M10 8 6 12l4 4" }),
            React.createElement("path", { d: "M14 8l4 4-4 4" })));
    }
    if (arrow === 'block') {
        return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
            React.createElement("path", { d: "M5 9h8V6l6 6-6 6v-3H5z" })));
    }
    return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
        React.createElement("path", { d: "M5 12h12" }),
        React.createElement("path", { d: "M13 8l4 4-4 4" })));
}
/**
 * 工具条顶部三个「面板条目」的图标（2026-09-20 第 3 批）。
 *
 * 与 `ToolIcon` 同一个约定：纯装饰、`aria-hidden`，可访问名由调用方（面板条目按钮）负责。
 * 三个图形刻意互不相同，且都**不是任何工具的图标**——面板条目和工具挤在同一列里，
 * 图形撞车会被读成"同一个东西的两种状态"。
 */
export function PanelEntryIcon({ id }) {
    if (id === 'material') {
        // 「图片」（B21 前叫「素材」）= 一叠图（导入图片 / AI 生成那两块）
        return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
            React.createElement("rect", { x: "3.5", y: "6.5", width: "14", height: "11", rx: "1.8" }),
            React.createElement("path", { d: "M6.5 14.5l3-3 2.5 2.5 2-2 3 3" }),
            React.createElement("circle", { cx: "8", cy: "10", r: "1.1" }),
            React.createElement("path", { d: "M19.5 9v8.5c0 .8-.7 1.5-1.5 1.5H7.5" })));
    }
    if (id === 'reference') {
        // 「参考」= 一张图压在画布上（参考图是叠在拼豆图下面的底图）
        return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
            React.createElement("rect", { x: "3.5", y: "4.5", width: "17", height: "12", rx: "1.8" }),
            React.createElement("path", { d: "M4 13l3.5-3.5L10 12l3-3 4 4" }),
            React.createElement("circle", { cx: "8.5", cy: "8", r: "1.1" }),
            React.createElement("path", { d: "M6 20h12" })));
    }
    if (id === 'recolor') {
        // 「改色」（B27）= 调色盘 —— B21 把这个图标腾出来了（「图纸」那条改用了格子纸）
        return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
            React.createElement("path", { d: "M12 3.5c4.7 0 8.5 3.3 8.5 7.4 0 2.6-2 4.3-4.6 4.3h-1.6c-.9 0-1.6.7-1.6 1.6 0 .5.2.9.5 1.3.2.3.3.6.3 1 0 .8-.7 1.4-1.5 1.4-4.7 0-8.5-3.8-8.5-8.5S7.3 3.5 12 3.5z" }),
            React.createElement("circle", { cx: "8.6", cy: "10", r: "1.2" }),
            React.createElement("circle", { cx: "12", cy: "7.6", r: "1.2" }),
            React.createElement("circle", { cx: "15.4", cy: "10", r: "1.2" })));
    }
    /*
     * 「图纸」（B21 前叫「颜色」）= **格子纸**。
     *
     * 为什么必须换掉原来的调色盘：这个条目早就不再打开调色盘了 —— 色盘在 B10 就搬到了画布右上角
     * 那个圆点的浮层里，而本抽屉现在装的是「用量（色号清单）+ 视图 + 参数调节（尺寸 / 品牌 / 版本）」。
     * 用户第 3 条的原话正是「还叫颜色已经不合适了」⇒ 名字与图形一起换成"图纸/格子纸"。
     * 图形刻意与另外两个不同（那两张都是"图片"），这里用**格网 + 中间一颗豆**表达"拼豆图纸"。
     */
    return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
        React.createElement("rect", { x: "3.5", y: "3.5", width: "17", height: "17", rx: "1.8" }),
        React.createElement("path", { d: "M3.5 9.2h17M3.5 14.8h17M9.2 3.5v17M14.8 3.5v17" }),
        React.createElement("circle", { cx: "12", cy: "12", r: "1.8" })));
}
//# sourceMappingURL=icons.js.map