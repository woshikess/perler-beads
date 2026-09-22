/**
 * 色号品牌 / 版本控件（W3.3c / D10；B7 **合并成一个下拉框**）
 *
 * 职责边界（重要）：
 *   - 本组件**只负责展示与切换**：在**一个** `<select>` 里同时表达"哪个品牌"与"哪个色号版本"，
 *     **选即切换**（用户裁决【B7-5】：「不在加应用按钮直接切换，不好就利用撤销按钮即可」）。
 *   - 真正的状态写入（`updateProject` / `commitHistory` / 撤销栈）**不在本文件**，由调用方接线；
 *     本文件需要的 props 在顶部 `BrandSelectProps` 里逐个写明。
 *   - 重算算法全部来自 `./brands` 的纯函数 `analyzeBrandRecolor` / `applyBrandRecolor`，
 *     本文件不重抄任何选色逻辑（AGENTS.md 验证纪律 3）。
 *
 * B7 根修（用户第 5 条「两个品牌控件并成一个」）：
 *   ⛔ 改动前这里是**两个控件**，且标题都印「色号品牌」：
 *     ① `RightPanel` 的 `.readonly-brand-field`（`<select>`，值是 `paletteMode` = 221/291 档，
 *        只切**配色筛选**、不重算图）；
 *     ② 本文件的 `role="radiogroup"` 两张 `brand-option` 卡片（值是 `project.activeBrand`，
 *        选品牌会**整图重算色号**）。
 *   ✅ 现在合成**一个** `<select>`：选项按「同品牌的不同版本」与「不同品牌」**并列同级**：
 *        `MARD 基础版（221色）` / `MARD 完整版（291色）` / `优肯 / Artkal M221（221色）`。
 *      选到**同品牌另一个版本** ⇒ 只切筛选（`onPaletteModeChange`，与改动前的 ① 逐字同行为）；
 *      选到**另一个品牌** ⇒ 立刻 `analyzeBrandRecolor` + `onApply(plan)`（调用方先 `commitHistory()`，
 *      所以顶栏「撤销」本来就回到切换前那一刻）。
 *   ⛔ 随之删掉的三样东西（**不是藏起来，是真的不再渲染/不再存在**）：
 *      · 两张 `brand-option` 卡片与 `role="radiogroup"`（用户点名要去掉的）；
 *      · 「先预览、再确认」那一整套机制（`pendingBrand` state / `plan` useMemo /
 *        `.brand-recolor-preview` 卡 / 「确认换到 X」「取消」两个按钮）——「选即切换」之后
 *        "待确认的另一个品牌"这个状态**不可能存在**，留着就是永不渲染的死代码；
 *      · 每条源色变化清单（`changeList`）。切换后果改由**画布左下角的 notice** 报出
 *        （`色号 A → B：N/M 格已更新，可撤销。`，由 `App.applyBrandSwitch` 写入）。
 *   ✅ 「数据来源与许可证 / CC BY 署名」折叠块（`details.brand-source-details`）**一处不少**
 *      —— 用户要求「声明还是写到右边加个小问号缩到问号里面」，现在它就在下拉框**右侧**。
 *      ⚠️ 署名是**许可证义务**（`brands.ts` 头部注释）：内容仍在 DOM、仍可展开、链接仍可点。
 */
import { useMemo, useState } from 'react';
import { analyzeBrandRecolor, BRAND_PROFILES, DEFAULT_BRAND, getBrandProfile, paletteForBrand, } from './brands.js';
import { ui } from './i18n.js';
import { getColor } from './palette.js';
export default function BrandSelect(props) {
    const { activeBrand, layers, resolveRgb, onApply, language = 'zh', includeSpecial = false, paletteMode, onPaletteModeChange, } = props;
    const zh = language !== 'en';
    // R4：本组件的用户可见文案一律从 `i18n.tsx` 取。
    // 免责文案按用户裁决 6 降级到「数据来源与许可证」折叠块内，文案来自 `i18n.tsx` 的 `brandDisclaimer`。
    const text = ui[zh ? 'zh' : 'en'];
    const resolve = useMemo(() => resolveRgb ?? ((colorId) => getColor(colorId)?.rgb), [resolveRgb]);
    /**
     * 下拉框的选项 = **品牌 × 版本** 的扁平列表（用户要的"两级信息并列同级"）。
     *
     * 版本档的**唯一**来源是 `paletteMode` 的 basic/complete 语义；两家品牌的差异由
     * `brands.ts` 的 `paletteForBrand` / `completePaletteForBrand` 决定：
     *   · MARD：basic = 221 色（`basicPalette`）、complete = 291 色（`completePalette`）
     *     ⇒ **两条**选项，文案直接用既有的 `mardBasic` / `mardComplete`（与前一个控件逐字相同）。
     *   · 其它品牌（优肯 / Artkal M221）：只有一套色号体系（`artkalMPalette` 220 普通色
     *     + 1 个特殊材质 MH1）⇒ **一条**选项，数量取 `BRAND_PROFILES[brand].colorCount`
     *     （= 该品牌共 221 色，与改动前那张品牌卡上的「共 221 色 · 含 1 个特殊材质」同一口径；
     *     "含 1 个特殊材质、默认不参与选色"由下面的 `SpecialMaterialNotice` 继续说明）。
     */
    const options = useMemo(() => {
        const list = [];
        Object.keys(BRAND_PROFILES).forEach((brand) => {
            const profile = BRAND_PROFILES[brand];
            if (brand === 'MARD') {
                list.push({ value: 'MARD:basic', brand, mode: 'basic', label: text.mardBasic });
                list.push({ value: 'MARD:complete', brand, mode: 'complete', label: text.mardComplete });
            }
            else {
                list.push({ value: brand, brand, mode: null, label: text.brandVersion(profile.name, profile.colorCount) });
            }
        });
        return list;
    }, [text]);
    /** 当前档位 = 品牌 + （MARD 才有）版本；其它品牌只由品牌决定。 */
    const selectValue = activeBrand === 'MARD' ? `MARD:${paletteMode}` : activeBrand;
    const handleChange = (value) => {
        const option = options.find((item) => item.value === value);
        if (!option)
            return;
        // ① 版本档：同品牌内的切换（或"切到 MARD 的某一档"）只改筛选，不重算图。
        if (option.mode && option.mode !== paletteMode)
            onPaletteModeChange(option.mode);
        // ② 品牌没变 ⇒ 到此为止（与改动前 `.readonly-brand-field` 的行为逐字一致）。
        if (option.brand === activeBrand)
            return;
        // ③ 换品牌 ⇒ 立即重算并落库（调用方 `applyBrandSwitch` 内部先 `commitHistory()`）。
        //    这里不保留任何"待确认"状态：用户裁决是「选即切换，不好就按撤销」。
        onApply(analyzeBrandRecolor(layers, option.brand, resolve, {
            includeSpecial,
            fromBrand: activeBrand,
            // 原 id 属于目标色板时无需改写（对 MARD→Artkal 恒为 false，因为两品牌 id 空间不重叠）
            isAlreadyTarget: (colorId) => paletteForBrand(option.brand).some((color) => color.id === colorId),
        }));
    };
    return (React.createElement("section", { className: "panel-section brand-select-section" },
        React.createElement("div", { className: "brand-combined-field" },
            React.createElement("span", { className: "brand-combined-label", id: "brand-combined-label" }, text.brandAndVersion),
            React.createElement("select", { className: "brand-combined-select", "aria-labelledby": "brand-combined-label", value: selectValue, onChange: (event) => handleChange(event.target.value) }, options.map((option) => (React.createElement("option", { key: option.value, value: option.value }, option.label)))),
            React.createElement(BrandSourceDetails, { brand: activeBrand, zh: zh, disclaimer: text.brandDisclaimer })),
        React.createElement(SpecialMaterialNotice, { brand: activeBrand, zh: zh })));
}
/**
 * 数据出处（含许可证与采集日期）—— 让"非官方值"这件事在界面上看得见。
 *
 * **第 4 批（用户裁决 A5 / 小确认 2）**：`<summary>` 的可见文字整块换成一个 **`?` 小圆点**，
 * 界面不再常驻「数据来源与许可证（含非官方值）」这行字。点开 `?` 后**内容一字未减**：
 * 来源清单（含链接、许可证、采集日期）+ 非官方色号警告 + 免责文案全在里面。
 *
 * **B7**：本块从"品牌卡片列表的下方"搬到**下拉框右侧**（内容、`summary`、`aria-label` 全部不变），
 * 只多了一层 `.brand-source-body` 包裹 —— 展开内容靠它整体浮出，
 * **不参与**下拉框那一行的网格尺寸（否则展开时会把 `<select>` 挤窄）。
 *
 * ⚠️ **署名不能删**：`profile.sources` 里带有 `attributionRequired` 的条目（Bitbead CC BY 4.0）
 * 是本仓库的**许可证义务**，"收进折叠块"满足义务（内容仍在、可展开、链接可点），
 * 但**删掉署名行就违约**了。这条也写在 `brands.ts` 头部注释里。
 * ⚠️ 无障碍名仍写全「数据来源与许可证（含非官方值）」：可见文字只剩一个问号，
 * 读屏用户与鼠标悬停要有等价信息，否则等于把这块内容藏成"看不见也不知道"。
 */
function BrandSourceDetails({ brand, zh, disclaimer }) {
    const profile = getBrandProfile(brand);
    const [open, setOpen] = useState(false);
    const label = `${zh ? '数据来源与许可证' : 'Sources & licences'}${profile.hasNonOfficialValues ? (zh ? '（含非官方值）' : ' (has non-official values)') : ''}`;
    return (React.createElement("details", { className: "brand-source-details", open: open, onToggle: (event) => setOpen(event.currentTarget.open) },
        React.createElement("summary", { className: "brand-source-toggle", "aria-label": label, title: label },
            React.createElement("span", { "aria-hidden": "true" }, "?")),
        React.createElement("div", { className: "brand-source-body" },
            React.createElement("ul", { style: { margin: '6px 0 0', paddingInlineStart: 18, lineHeight: 1.5 } }, profile.sources.map((source) => (React.createElement("li", { key: source.id },
                React.createElement("a", { href: source.url, target: "_blank", rel: "noreferrer noopener" }, source.url),
                React.createElement("br", null),
                React.createElement("span", { style: { opacity: 0.85 } },
                    source.license,
                    source.attributionRequired ? (zh ? ' · 需署名' : ' · attribution required') : '',
                    ' · ',
                    source.collectedAt,
                    source.official ? (zh ? ' · 厂商官方' : ' · vendor official') : ''),
                source.attributionText ? (React.createElement("span", { style: { display: 'block', marginTop: 2, opacity: 0.85 } }, source.attributionText)) : null)))),
            profile.nonOfficialCodes.length > 0 && (React.createElement("div", { style: { marginTop: 4 } }, zh
                ? `⚠️ 以下色号的颜色不是官方数值：${profile.nonOfficialCodes.join('、')}`
                : `⚠️ Not official values: ${profile.nonOfficialCodes.join(', ')}`)),
            React.createElement("div", { style: { marginTop: 4, opacity: 0.85, lineHeight: 1.5 } }, disclaimer))));
}
/**
 * 特殊材质（透明等）单独成组提示。
 * 默认**不**把它们并入普通配色候选 —— 否则"透明"会被当成一个颜色参与选色，
 * 把画面里的浅色吸到透明的白色基底上。
 */
function SpecialMaterialNotice({ brand, zh }) {
    const profile = getBrandProfile(brand);
    const special = profile.groups.filter((group) => group.kind === 'special');
    if (special.length === 0)
        return null;
    const specialColorCount = special.reduce((sum, group) => sum + group.count, 0);
    // W5（用户裁决 6）：原来那两行"已与普通色分开 / 默认不参与换品牌选色 + 含哪些色号（非官方值）"
    // 压成一句；色号清单与"非官方值"提示由上面的「数据来源与许可证」折叠块承担，不再重复。
    return (React.createElement("div", { className: "brand-special-notice" }, zh
        ? `${special.map((group) => group.zh).join(' / ')}（共 ${specialColorCount} 色）默认不参与换品牌选色。`
        : `${special.map((group) => group.en).join(' / ')} (${specialColorCount}) — not used when switching brands.`));
}
/** 供 W3.4 直接取用的"默认品牌"常量（避免 W3.4 再 import 一次 brands）。 */
export const BRAND_SELECT_DEFAULT = DEFAULT_BRAND;
//# sourceMappingURL=BrandSelect.js.map