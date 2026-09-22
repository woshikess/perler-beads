/**
 * 亮度（加权和）公式的**唯一落点** —— W0.3 颜色工具去重。
 *
 * 这个模块存在的唯一目的：项目里原先散着好几份**同名同公式**的亮度实现
 * （`imageToBeads.ts` 与 `exporters.ts` 各一份 `luminance`；`layerAdjustments.ts` 的
 * `rgbLuminance` 与 `shapeGeometry.ts` 的 `isLightColor` 各写一遍 Rec.709）。
 * 重复副本的坏处不是多打几个字，而是**改一处忘一处**：谁动了一边的系数，
 * 另一边的阈值就静默失配。W0.3 只做一件事——把「同名同公式」的合并成一份，
 * **一个系数都不许动、一个阈值都不许动**。
 *
 * ⚠️ 这里的两套公式是**两套**，不是一套，也**永远不许统一**：
 *
 *   `luminance601` = 0.299·R + 0.587·G + 0.114·B   （Rec.601，量纲 0~255）
 *   `luminance709` = 0.2126·R + 0.7152·G + 0.0722·B （Rec.709，量纲 0~255）
 *
 * 两套公式的**阈值都是按各自公式单独标定的**，换公式 = 静默改行为：
 *   - `exporters.ts`      `luminance601(rgb) < 130`  → 图纸上色号的字色（白/深灰）
 *   - `shapeGeometry.ts`  `luminance601(rgb) < 130`  → `readableTextColor`
 *   - `shapeGeometry.ts`  `luminance709(rgb) > 218`  → `isLightColor`（亮度描边的触发线）
 *   - `layerAdjustments.ts` 用 `luminance709` 的 `>= 150` 做黑白二值化
 *   - `imageToBeads.ts`   `luminance601(rgb) < 48`、`< 84`、`> 188` 等阈值
 *
 * 另有几个**看起来像、其实不是一回事**的量，**不在本模块、也不许合并进来**：
 *   - `imageToBeads.ts` 的 `relativeLuminance(rgb) = luminance601(rgb) / 255`：
 *     它是 **0~1 归一化口径**，阈值 `0.7 / 0.85`（`LIGHT_BEAD_LUMA_RATIO` 那族常数）
 *     是按这个口径标定的；`isLightColor` 是 **0~255 口径、阈值 218**。两者换用即改行为。
 *   - `detectEyeHighlights` 里对整幅像素的那条内联 601 表达式：它跑在**每个源像素**上，
 *     内联是刻意的（那一层循环里不放函数调用），且它与 RGB 三通道就地取值绑定，
 *     不是「同名函数副本」，所以本模块**不含**它。
 *
 * 依赖：无。本模块只做纯算术，不 import 任何东西 —— 因此它既可以被 `src/` 下的
 * 平铺模块引用，也不会把 `shapeGeometry` / `imageToBeads` 拖成环。
 */
/**
 * Rec.601 亮度（0.299/0.587/0.114），量纲 0~255。
 *
 * 原先两处**逐字相同**的实现：
 *   - `src/imageToBeads.ts`（改前 L1094–L1096，`function luminance`）
 *   - `src/exporters.ts`（改前 L801–L803，`function luminance`）
 * 调用点的字面量一行未改，只把定义收敛到这里。
 */
export function luminance601(rgb) {
    return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
}
/**
 * Rec.709 亮度（0.2126/0.7152/0.0722），量纲 0~255。
 *
 * 原先两处**公式相同、写法不同**的实现：
 *   - `src/layerAdjustments.ts`（改前 L247–L249，`rgbLuminance`，系数后置写法）
 *   - `src/shapeGeometry.ts`（改前 L628，`isLightColor` 内联，系数前置写法）
 * 两者在 IEEE754 下逐位等值（a·x + b·y + c·z 是同一个表达式，只是书写顺序不同），
 * 合并后调用点读到的仍是同一个双精度值。
 */
export function luminance709(rgb) {
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
//# sourceMappingURL=luminance.js.map