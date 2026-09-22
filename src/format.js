/**
 * 数值格式化小工具。
 *
 * W0.1 从 App.tsx 纯搬迁：L532–L534（`formatBrushSize`），内容一字未改。
 */
export function formatBrushSize(value) {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
//# sourceMappingURL=format.js.map