/**
 * 格子数组的等比缩放（改画布尺寸时保留左上角已有内容）。
 *
 * W0.1 从 App.tsx 纯搬迁：L3754–L3770（`resizeCells`），内容一字未改。
 * 它原先混在图标组件中间，搬出来时未改任何逻辑。
 */
export function resizeCells(cells, oldWidth, oldHeight, newWidth, newHeight) {
    const next = Array.from({ length: newWidth * newHeight }, () => null);
    const copyWidth = Math.min(oldWidth, newWidth);
    const copyHeight = Math.min(oldHeight, newHeight);
    for (let y = 0; y < copyHeight; y += 1) {
        for (let x = 0; x < copyWidth; x += 1) {
            next[y * newWidth + x] = cells[y * oldWidth + x] ?? null;
        }
    }
    return next;
}
//# sourceMappingURL=cells.js.map