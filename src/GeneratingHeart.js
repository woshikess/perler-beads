import { useEffect, useState } from 'react';
import { HEART_CELLS, HEART_OUTLINE_ORDER, HEART_SIZE } from './heartPixels.js';
/**
 * 「正在生成图案」的加载动画（B36）——把一颗心用豆一格格「画」出来，画完跳一下，再重画。
 *
 * 用户裁决（2026-09-23）：**采用这个方案**，用在「AI 生成 / 出图过程中」；
 * 打开网站时那 16.9 秒白屏用的是**同一份点阵**（见 `src/heartPixels.ts` 的说明）。
 *
 * 实测过两件事，决定了这里的做法：
 * 1. **AI 重绘的超时是 240 秒**（`AI_REDRAW_TIMEOUT_MS`）—— 动画必须**反复循环**，
 *    只播一遍然后定住，用户会对着静止画面等好几分钟（第一版就是这么写的，用户当场发现）。
 * 2. **纯 CSS 动画，不用 requestAnimationFrame** —— 生成期间主线程正在跑出图算法 / 等接口，
 *    用 JS 逐帧驱动会跟它抢主线程，反而更卡。循环靠「按周期重建一次 DOM」触发 CSS 重播，
 *    每 3.4 秒重建 70 个 span，代价可以忽略。
 *
 * 「减少动态效果」时不做逐格动画，直接静态显示完整心形 + 只有轻微呼吸。
 */
const HEART_BEAD_COLORS = ['#17656a', '#f0c84b', '#8fb9b6'];
const CELL_MS = 55; // 每格点亮间隔
const OUTLINE_MS = 70; // 外圈高光跑动间隔
const HOLD_MS = 1400; // 画完停留多久再重画
const CYCLE_MS = HEART_CELLS.length * CELL_MS + HEART_CELLS.length * OUTLINE_MS + HOLD_MS;
export default function GeneratingHeart({ label }) {
    // 自增的 key：变了就把心形整体重建一次，于是 CSS 动画从头再播（这是最省事的「重播」办法）
    const [cycle, setCycle] = useState(0);
    useEffect(() => {
        const timer = window.setInterval(() => setCycle((value) => value + 1), CYCLE_MS);
        return () => window.clearInterval(timer);
    }, []);
    const drawDone = HEART_CELLS.length * CELL_MS;
    return (React.createElement("div", { className: "generating-heart", role: "status", "aria-live": "polite" },
        React.createElement("div", { className: "generating-heart-beat" },
            React.createElement("div", { key: cycle, className: "generating-heart-grid", style: { gridTemplateColumns: `repeat(${HEART_SIZE}, var(--gh-cell))` } }, HEART_CELLS.map((cell, index) => {
                const outlineIndex = HEART_OUTLINE_ORDER.indexOf(index);
                return (React.createElement("span", { key: `${cell.row}-${cell.col}`, className: "generating-heart-bead", style: {
                        gridRow: cell.row + 1,
                        gridColumn: cell.col + 1,
                        background: HEART_BEAD_COLORS[index % 7 === 3 ? 1 : 0],
                        animationDelay: `${index * CELL_MS}ms, ${drawDone + outlineIndex * OUTLINE_MS}ms`,
                        // 整体重画的循环：单颗豆的动画周期 = 整个循环时长，于是「画完淡出 → 重画」自动接上
                        animationDuration: `260ms, ${OUTLINE_MS}ms, ${CYCLE_MS}ms`,
                    } }));
            }))),
        React.createElement("div", { className: "generating-heart-label" }, label)));
}
//# sourceMappingURL=GeneratingHeart.js.map