/**
 * 像素心形（B36）——「正在生成图案」的两处加载动画**共用这一份点阵**。
 *
 * 两处消费方：
 * 1. **打开网站时**（React 还没启动、那 16.9 秒白屏）：写在 `scripts/write-html.cjs` 生成的
 *    `index.html` 壳里。壳是静态 HTML、不能 import 本模块，所以那边**抄了一份字面量点阵** ——
 *    改形状时**两处都要改**，且必须逐行一致（`scripts/write-html.cjs` 里有同样的注释提醒）。
 * 2. **AI 生成 / 出图过程中**：由 `src/GeneratingHeart.tsx` 渲染。
 *
 * 为什么不做成「动态从本模块注入壳」：壳必须在**任何模块加载之前**就能显示，
 * 一旦依赖模块，就重新掉进「等 JS 才有动画」的圈里 —— 那是这次要解决的正题。
 */
/** 11×11，'1' = 一颗豆。上两瓣、下收成尖。**改形状只改这里**（记得同步 write-html.cjs） */
export const HEART_PIXELS = [
    '00110001100',
    '01111011110',
    '11111111111',
    '11111111111',
    '11111111111',
    '01111111110',
    '00111111100',
    '00011111000',
    '00001110000',
    '00000100000',
    '00000000000',
];
/** 心形里所有「有豆」的位置（行优先），按从外到内的顺序排 —— 画的时候按这个顺序一格格点亮 */
export const HEART_CELLS = (() => {
    const cells = [];
    HEART_PIXELS.forEach((line, row) => {
        for (let col = 0; col < line.length; col += 1) {
            if (line[col] === '1')
                cells.push({ row, col });
        }
    });
    return cells;
})();
/** 外圈高光的顺序：按「到中心的曼哈顿距离」从远到近，于是高光像沿轮廓跑一圈 */
export const HEART_OUTLINE_ORDER = (() => {
    const centerRow = (HEART_PIXELS.length - 1) / 2;
    const centerCol = (HEART_PIXELS[0].length - 1) / 2;
    return HEART_CELLS.map((cell, index) => ({
        index,
        distance: Math.abs(cell.row - centerRow) + Math.abs(cell.col - centerCol),
    }))
        .sort((a, b) => b.distance - a.distance)
        .map((item) => item.index);
})();
export const HEART_SIZE = HEART_PIXELS.length;
//# sourceMappingURL=heartPixels.js.map