/**
 * 共用的小工具：媒体查询钩子 + 平台断点常量（2026-09-20 第 2 批抽取）。
 *
 * ## 为什么要抽出来
 * 这个钩子原本**私藏在 `ExportPanel.tsx` 里**。第 2 批的「换色」工具浮层也需要
 * "当前是不是手机"来决定渲染精简形态还是完整形态，于是面临两个选择：
 * 复制一份（两份必然漂移）或抽成共用文件。
 * 抽出来同时还消掉了第二个隐患：**手机断点 `(max-width: 767px)` 原本只在 ExportPanel 里定义一次**，
 * 谁再写一遍就可能写成 `768`，于是"同一个手机"在两个功能里判出不同结果。现在只有这一份。
 *
 * ⚠️ 平台判据（**2026-09-20 第 5 批修订**，用户裁决）：
 * · 手机 `(max-width: 767px)`　· 触屏平板 = `(pointer: coarse)` 且宽度 **768–1400**　· 其余 = 桌面。
 *
 * **第 5 批加了宽度上限 1400**：宽度明显是电脑时（≥1401），**即使有触屏也走桌面版**。
 * 用户原话：「如果分辨率明显不是平板电脑而是电脑的大小 那么有触屏也触发桌面版」。
 * 起因：他用 1920×1080 的触屏电脑打开，看到的是平板/抽屉版（当时 Chrome 设备工具栏的触摸模拟
 * 也让 `(pointer: coarse)` 为真，见 KI-040），而按宽度它明显是电脑。
 * 为什么上限取 **1400**（**不是 1366**）：
 * · **1366 会漏掉 iPad Pro 13"(M4)** —— 它的视口是 **1376×1032**（DPR 2，物理 2752×2064）。
 *   独立验证子代理实测：1376 + 触屏在 1366 阈值下会走桌面版并出现「导出用量」，
 *   那等于**反转 D2 决策**（iPad 不提供 Excel）⇒ 上限必须 ≥1376。
 * · 1400 同时覆盖 12.4" 级安卓平板（横屏约 1400×876）。
 * · ≥1401 的触屏一律回桌面版：触屏笔记本 1536(1920@125%) / 1920，以及 1480 级的超大安卓平板。
 * · 已知代价：**1440 级二合一**（如 Surface Pro 类 2880×1920@2 = 1440×960，拆键盘纯触摸时）也走桌面版
 *   —— 这是"电脑尺寸即桌面"这条口径的必然取舍，用户要的就是这条。
 * ⇒ 旧口径的已知代价（"触屏 Windows 笔记本按平板处理"）由这次修订消除。
 * ⚠️ 与 `styles.css` 里 W1.3 段那个 `@media` **必须逐字一致**，否则"JS 判桌面、CSS 判平板"会撕裂。
 */
import { useEffect, useState } from 'react';
/** 手机断点。**这是全仓唯一一处定义**，改这里等于改所有以"手机"为条件的 UI。 */
export const PHONE_QUERY = '(max-width: 767px)';
/** 粗指针（触屏）。桌面细指针为 false。
 *  ⚠️ **不要单用它判"平板"**——那样宽屏触屏笔记本也会变平板（第 5 批修掉的问题）；
 *  判平板请用 `TOUCH_TABLET_QUERY`。 */
export const COARSE_POINTER_QUERY = '(pointer: coarse)';
/** 触屏平板的宽度上限（**含**）：1400。覆盖全部 iPad（最大 1376 = iPad Pro 13" M4）
 *  与 12.4" 级安卓平板（约 1400）。**≥1401 一律按电脑**（第 5 批）。
 *  ⚠️ 改这个数必须**同步改** `src/styles.css` 里 W1.3 那张 `@media` 的同一个数（门禁 C6c 会守住）。 */
export const TOUCH_TABLET_MAX_WIDTH = 1400;
/** 触屏平板 = 粗指针 **且** 宽度 768–1400。宽度明显是电脑时不再算平板（用户 2026-09-20 裁决）。 */
export const TOUCH_TABLET_QUERY = `${COARSE_POINTER_QUERY} and (min-width: 768px) and (max-width: ${TOUCH_TABLET_MAX_WIDTH}px)`;
/**
 * **面板布局断点**：命中时左右两个面板退化成**覆盖式抽屉**（点工具条上的面板入口打开）。
 * 它与 `styles.css` 里「W1.3 平板断点」与「W2.1 手机断点」两段 media query 的**并集等价**：
 *   `(max-width: 1180px)`                       ← 手机(<768) ∪ 窄窗(768–1180)，任意指针
 *   `(pointer: coarse) and (min-width: 768px) and (max-width: 1400px)` ← 触屏平板（≤ iPad Pro 13" 的 1376）
 * 桌面 1600×900（pointer: fine）两条都不命中 ⇒ 面板入口的节点根本不渲染，
 * 桌面 DOM 与像素因此能与改动前逐字节一致。
 * **第 5 批**：第二条的 `(pointer: coarse)` 换成 `TOUCH_TABLET_QUERY`（加了 1400 上限）
 * ⇒ 1920 这类"电脑尺寸 + 触屏"不再命中（修掉用户报的那个问题）。
 *
 * ⚠️ 第 3 批从 `WorkspaceCanvas.tsx` **搬到这里**（原本是那里的私有常量）：`App.tsx` 也要用它
 * 决定"工具条里有没有面板入口"（进而决定每个工具浮层的 `grid-row`），而这两处判据必须是**同一个**，
 * 否则窄屏下浮层会整体错行。搬动后全仓只有这一份定义。
 */
export const PANEL_LAYOUT_QUERY = `(max-width: 1180px), ${TOUCH_TABLET_QUERY}`;
export function useMediaQuery(query) {
    const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
    useEffect(() => {
        const list = window.matchMedia(query);
        const onChange = () => setMatches(list.matches);
        setMatches(list.matches);
        list.addEventListener('change', onChange);
        return () => list.removeEventListener('change', onChange);
    }, [query]);
    return matches;
}
//# sourceMappingURL=useMediaQuery.js.map