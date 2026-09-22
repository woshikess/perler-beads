import { basicPalette as basicPaletteMard, colorDistance, completePalette as completePaletteMard, setExtraPaletteColors, } from './palette.js';
// ---------------------------------------------------------------------------
// 品牌注册表（W3.3b）
//
// 这个文件是**纯数据 + 纯映射能力**，不含任何 UI，也不改变任何既有行为：
// 默认色板仍然是 MARD（`./palette.ts` 的 `palette` / `basicPalette` / `completePalette`
// 一个字都没动，见 `_审核\_暂存证据\W3.3b\报告.md` 的逐格等价证据）。
//
// ## 许可证与署名（本仓库 LICENSE = MIT, (c) 2026 Jett-Wu）
//
// | 数据 | 来源 URL | 许可证 | 采集日期 | 采纳方式 |
// |---|---|---|---|---|
// | Artkal(优肯) M 系列 221 色，其中 220 色 | https://cdn.shopify.com/s/files/1/1323/8195/files/M_MINI_Beads_RGB_Color_Chart_2025.pdf?v=1760661747 | 品牌厂商官方发布的色值文件（引用出处） | 2026-09-19 | 逐字采纳官方 PDF 的 RGB |
// | Artkal(优肯) M 系列 221 色（数据集整理） | https://github.com/HansBug/pindou-color-data/tree/main/artkal-m-221-official | MIT (c) 2026 HansBug | 2026-09-19 | 官方 PDF 的机读转写版本，逐字采用 |
// | 仅 `MH1` 的显示基底 `#FFFFFF` | https://bitbead.pomodiary.com/zh/colors/artkal-mini/MH1 | **CC BY 4.0 —— 必须署名 Bitbead** | 2026-09-19 | 官方 PDF 只标 "Transparent"，此值来自第三方工具站，**非官方值** |
//
// 交叉校验（第三方、独立于上表）：https://github.com/maxcleme/beadcolors (`raw/artkal_m.csv`, MIT (c) 2020 maxcleme)
//   —— 与官方 PDF 抽取值 **219/219 逐字 100% 一致**（口径见下，本任务独立复算过）。
//   口径与复算（2026-09-19，脚本 `_审核\_暂存证据\W3.3c-fix\tools\_recount_maxcleme.cjs`，exit 0）：
//     · 该 CSV **共 220 行**，第 1 行 `MA1,MA1,255,246,212,surf00049` **本身就是数据（MA1）**、不是列名表头；
//     · 口径 A「220 行全是数据」⇒ 与官方 M221 共同色号 220、**逐字一致 220**，官方多出 `MH1`（透明、本无数值）；
//     · 口径 B「第 1 行当表头」⇒ 数据行 219、共同色号 219、**逐字一致 219**，官方多出 `MA1`、`MH1`。
//   两种口径**逐字不一致都是 0 条**。上文写 219/219 用的是口径 B（与调研归档一致），
//   审计报告写的 220/220 用的是口径 A —— 两个数字都对，差别只在 MA1 算不算数。**此处不改数据，只把口径写明。**
//
// ⚠️ MARD 侧另有两条需要注意的事实（只加注释，**不改数据**）：
//   1. `Q4` 与 `R11` 是完全同色 `#FFEBFA`（7 个可查来源里 `Q4` 全票、`R11` 只有 4 源一致）；
//      没有官方源可判定正确值 ⇒ **保持原样**，需要实物色卡确认。
//   2. MARD 厂商从未发布官方 RGB ⇒ 291 条**全部**是社区近似值（`BRAND_PROFILES.MARD.hasNonOfficialValues = true`）。
//
// ⛔ 未采纳：`beadpatternlab.com` / `pixel-beads.com` / `pindou.online`（**均未声明许可证**）、
//   任何经 `Zippland/perler-beads`（**AGPL-3.0**）派生的数据（漫漫那 5 条色号→HEX 映射）。
//    本文件**不含**上述任何来源的数据。
//
// ## 上游许可证全文（MIT 要求"保留版权声明与许可全文"，故逐字附在数据旁）
//
// ### HansBug/pindou-color-data —— MIT (c) 2026 HansBug
// ```
// MIT License
//
// Copyright (c) 2026 HansBug
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this data and associated documentation files (the "Data"), to deal
// in the Data without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Data, and to permit persons to whom the Data is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Data.
//
// THE DATA IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE DATA OR THE USE OR OTHER DEALINGS IN THE
// DATA.
// ```
// 本文件全文逐字复制自 https://github.com/HansBug/pindou-color-data/blob/main/LICENSE
// （本地副本 `_审核\多品牌色号调研_20260919\data\_LICENSE_hansbug.txt`，21 行 / 1028 B）。
//
// ### maxcleme/beadcolors —— MIT (c) 2020 maxcleme（**仅用于交叉校验，未采纳其数值**）
// ```
// MIT License
//
// Copyright (c) 2020 maxcleme
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
// ```
// 本文件全文逐字复制自 https://github.com/maxcleme/beadcolors/blob/master/LICENSE
// （本地副本 `_审核\多品牌色号调研_20260919\data\_LICENSE_maxcleme.txt`，21 行 / 1065 B）。
//
// ### Bitbead —— CC BY 4.0（**必须署名**，作者称附链接即可）
// 署名文案：`MH1 显示基底色 #FFFFFF 来自 Bitbead (CC BY 4.0)`
// 来源：https://bitbead.pomodiary.com/zh/colors/artkal-mini/MH1
// 许可证出处：https://github.com/pomodiary/bitbead.app/blob/main/data/README.md
// （该仓库根目录**没有** LICENSE 文件，许可证只在 `data/palettes.json` 的 `license` 字段与 data/README 里声明。）
// 许可证全文：https://creativecommons.org/licenses/by/4.0/legalcode
//
// ## ⚠️ 屏幕近似值，非官方标准
// 所有来源一致声明：RGB 是**屏幕近似值**，不是分光光度计读数；且**透明 / 夜光 / 闪粉等表面工艺未建模**
// （bitbead 原文："Hex values are approximations… not spectrophotometer readings"、"Finish is not modelled"）。
// 该事实的**用户可见文案**在 `i18n.tsx` 的 `brandDisclaimer`（zh/en）；
//
// ## ⚠️ 换品牌禁止按色号平移
// 同谱系下不同品牌的同名色号**指向不同颜色**（实测 COCO 与 MARD 的 132 个交集色号 100.00%（132/132）
// 指向不同颜色）。跨品牌**必须走 HEX / 欧氏距离**：本文件只提供 {@link nearestColorInBrand} /
// {@link recolorCellsToBrand} 这类映射能力，UI 与接线由 W3.3c 负责，本任务不做。
// ---------------------------------------------------------------------------
/** 所有已知品牌 id。`types.ts` 的 `BrandId` 必须与这里一致（有编译期断言，见文件末尾）。 */
export const BRAND_IDS = ['MARD', 'ARTKAL'];
/** 默认品牌 —— 与改动前完全一致，仍是 MARD。 */
export const DEFAULT_BRAND = 'MARD';
// ---------------------------------------------------------------- 色号归一化
/**
 * 色号归一化：**去掉前缀与数字之间的前导零**（`A01 → A1`、`mh01 → MH1`）。
 * 同时统一大写、去掉空格/下划线/连字符。调研校准时踩过前导零这个坑。
 */
export function normalizeBrandCode(raw) {
    const base = String(raw).trim().toUpperCase().replace(/[\s_-]+/g, '');
    const m = /^([A-Z]+)0*(\d+)$/.exec(base);
    if (!m)
        return base;
    return m[1] + m[2];
}
/**
 * 跨品牌取码：**不通用的品牌返回 `undefined`**，不做任何"按色号平移"的猜测
 * （同谱系不同品牌的同名色号指向不同颜色 —— 见文件头红线）。
 * 注意：`palette.ts` 里既有的 `mappedCode()` 行为**未改动**（它保留"取不到就回落到
 * `primaryCode`"的旧语义，以免影响既有调用方）。跨品牌映射请用本函数或
 * {@link nearestColorInBrand}（走 HEX / 距离）。
 */
export function brandCodeOf(color, brand) {
    return color.codes[brand];
}
// ---------------------------------------------------------------- Artkal M221
/**
 * Artkal / 优肯 M 系列 221 色。
 * 列：`色号,HEX,RGB(r/g/b),组,标记,来源id`
 * 标记：`transparent` 官方标透明 · `alpha128` 源数据 alpha=128 · `display-hex` 该行 HEX 来自第三方显示基底（非官方值）
 */
const rawArtkalM221Csv = `
MA1,#FFF6D4,255/246/212,MA,,src1
MA2,#F6F9E5,246/249/229,MA,,src1
MA3,#FFFBAA,255/251/170,MA,,src1
MA4,#FFDF58,255/223/88,MA,,src1
MA5,#FECF4D,254/207/77,MA,,src1
MA6,#FFA80C,255/168/12,MA,,src1
MA7,#FF8837,255/136/55,MA,,src1
MA8,#EAC431,234/196/49,MA,,src1
MA9,#F1AA8F,241/170/143,MA,,src1
MA10,#FF8F42,255/143/66,MA,,src1
MA11,#FFE1A1,255/225/161,MA,,src1
MA12,#F4B39C,244/179/156,MA,,src1
MA13,#FFB100,255/177/0,MA,,src1
MA14,#FF6510,255/101/16,MA,,src1
MA15,#DAF05C,218/240/92,MA,,src1
MA16,#F9FBBE,249/251/190,MA,,src1
MA17,#FFD976,255/217/118,MA,,src1
MA18,#FFCA9A,255/202/154,MA,,src1
MA19,#EC7A92,236/122/146,MA,,src1
MA20,#E5BE55,229/190/85,MA,,src1
MA21,#FFE596,255/229/150,MA,,src1
MA22,#F7E898,247/232/152,MA,,src1
MA23,#F0CBB1,240/203/177,MA,,src1
MA24,#F5FCD1,245/252/209,MA,,src1
MA25,#F6D487,246/212/135,MA,,src1
MA26,#FFCB4B,255/203/75,MA,,src1
MB1,#D2E318,210/227/24,MB,,src1
MB2,#79CD41,121/205/65,MB,,src1
MB3,#82D7A1,130/215/161,MB,,src1
MB4,#65DF4F,101/223/79,MB,,src1
MB5,#5FC873,95/200/115,MB,,src1
MB6,#49D1AE,73/209/174,MB,,src1
MB7,#009696,0/150/150,MB,,src1
MB8,#08774F,8/119/79,MB,,src1
MB9,#183823,24/56/35,MB,,src1
MB10,#83CFC3,131/207/195,MB,,src1
MB11,#5A6A27,90/106/39,MB,,src1
MB12,#045F45,4/95/69,MB,,src1
MB13,#E2FFB3,226/255/179,MB,,src1
MB14,#9DD12E,157/209/46,MB,,src1
MB15,#254B3C,37/75/60,MB,,src1
MB16,#D0FCAD,208/252/173,MB,,src1
MB17,#8CA12A,140/161/42,MB,,src1
MB18,#D2D958,210/217/88,MB,,src1
MB19,#49BCA9,73/188/169,MB,,src1
MB20,#E8FDEC,232/253/236,MB,,src1
MB21,#188B81,24/139/129,MB,,src1
MB22,#0C5C5B,12/92/91,MB,,src1
MB23,#3D461B,61/70/27,MB,,src1
MB24,#EAFCB6,234/252/182,MB,,src1
MB25,#538771,83/135/113,MB,,src1
MB26,#8A7A40,138/122/64,MB,,src1
MB27,#D2DEB6,210/222/182,MB,,src1
MB28,#9FF4C2,159/244/194,MB,,src1
MB29,#BBD747,187/215/71,MB,,src1
MB30,#F5FFE6,245/255/230,MB,,src1
MB31,#BFE1C2,191/225/194,MB,,src1
MB32,#9FBA5C,159/186/92,MB,,src1
MC1,#D5E3DE,213/227/222,MC,,src1
MC2,#BBF1F4,187/241/244,MC,,src1
MC3,#73C0DF,115/192/223,MC,,src1
MC4,#33B3E1,51/179/225,MC,,src1
MC5,#00A3CA,0/163/202,MC,,src1
MC6,#58A0D9,88/160/217,MC,,src1
MC7,#0588CC,5/136/204,MC,,src1
MC8,#005F9E,0/95/158,MC,,src1
MC9,#086FB9,8/111/185,MC,,src1
MC10,#52B4E0,82/180/224,MC,,src1
MC11,#00A9B9,0/169/185,MC,,src1
MC12,#1C375A,28/55/90,MC,,src1
MC13,#CEE0F0,206/224/240,MC,,src1
MC14,#EBF5F4,235/245/244,MC,,src1
MC15,#00AAAD,0/170/173,MC,,src1
MC16,#004C7D,0/76/125,MC,,src1
MC17,#5BD4F6,91/212/246,MC,,src1
MC18,#36515C,54/81/92,MC,,src1
MC19,#0F909D,15/144/157,MC,,src1
MC20,#0084B7,0/132/183,MC,,src1
MC21,#DDECFA,221/236/250,MC,,src1
MC22,#84BAC2,132/186/194,MC,,src1
MC23,#CBDBDB,203/219/219,MC,,src1
MC24,#88BDE2,136/189/226,MC,,src1
MC25,#B3ECE0,179/236/224,MC,,src1
MC26,#3E9EBF,62/158/191,MC,,src1
MC27,#E9F0F3,233/240/243,MC,,src1
MC28,#C2CDE3,194/205/227,MC,,src1
MC29,#586B8F,88/107/143,MC,,src1
MD1,#7292E2,114/146/226,MD,,src1
MD2,#6E8CCC,110/140/204,MD,,src1
MD3,#13419A,19/65/154,MD,,src1
MD4,#1E3175,30/49/117,MD,,src1
MD5,#B850B2,184/80/178,MD,,src1
MD6,#AD92E9,173/146/233,MD,,src1
MD7,#5F2D91,95/45/145,MD,,src1
MD8,#D7CDF1,215/205/241,MD,,src1
MD9,#BDB2E6,189/178/230,MD,,src1
MD10,#251B58,37/27/88,MD,,src1
MD11,#A2BBE7,162/187/231,MD,,src1
MD12,#CF8BBE,207/139/190,MD,,src1
MD13,#B80096,184/0/150,MD,,src1
MD14,#A137A7,161/55/167,MD,,src1
MD15,#4A388A,74/56/138,MD,,src1
MD16,#DCE8F6,220/232/246,MD,,src1
MD17,#AECEF0,174/206/240,MD,,src1
MD18,#B38EDB,179/142/219,MD,,src1
MD19,#E8D2EA,232/210/234,MD,,src1
MD20,#B460C3,180/96/195,MD,,src1
MD21,#842A94,132/42/148,MD,,src1
MD22,#4B5E9E,75/94/158,MD,,src1
MD23,#D6D2E2,214/210/226,MD,,src1
MD24,#7776D1,119/118/209,MD,,src1
MD25,#3837A8,56/55/168,MD,,src1
MD26,#DDC8DD,221/200/221,MD,,src1
ME1,#FDD6C9,253/214/201,ME,,src1
ME2,#FFD8F4,255/216/244,ME,,src1
ME3,#FFA0C3,255/160/195,ME,,src1
ME4,#F67AAB,246/122/171,ME,,src1
ME5,#DA5B95,218/91/149,ME,,src1
ME6,#FF4B78,255/75/120,ME,,src1
ME7,#9E156B,158/21/107,ME,,src1
ME8,#FFE1E6,255/225/230,ME,,src1
ME9,#F378CA,243/120/202,ME,,src1
ME10,#BE316D,190/49/109,ME,,src1
ME11,#FFE8DA,255/232/218,ME,,src1
ME12,#FFA5C6,255/165/198,ME,,src1
ME13,#B53883,181/56/131,ME,,src1
ME14,#FFDDC7,255/221/199,ME,,src1
ME15,#E5C6D0,229/198/208,ME,,src1
ME16,#F9F2EB,249/242/235,ME,,src1
ME17,#E7DCE6,231/220/230,ME,,src1
ME18,#FFD3E6,255/211/230,ME,,src1
ME19,#FFD5EC,255/213/236,ME,,src1
ME20,#F3DCE8,243/220/232,ME,,src1
ME21,#BD9CA3,189/156/163,ME,,src1
ME22,#C578A5,197/120/165,ME,,src1
ME23,#A37A9B,163/122/155,ME,,src1
ME24,#F4E8FF,244/232/255,ME,,src1
MF1,#FF7F67,255/127/103,MF,,src1
MF2,#FF5D46,255/93/70,MF,,src1
MF3,#E3564A,227/86/74,MF,,src1
MF4,#C7270D,199/39/13,MF,,src1
MF5,#BE0A27,190/10/39,MF,,src1
MF6,#83411E,131/65/30,MF,,src1
MF7,#730037,115/0/55,MF,,src1
MF8,#AB0022,171/0/34,MF,,src1
MF9,#DE7995,222/121/149,MF,,src1
MF10,#AB613C,171/97/60,MF,,src1
MF11,#5C2929,92/41/41,MF,,src1
MF12,#F34461,243/68/97,MF,,src1
MF13,#C64239,198/66/57,MF,,src1
MF14,#FFA5BB,255/165/187,MF,,src1
MF15,#BC0018,188/0/24,MF,,src1
MF16,#FFD7CB,255/215/203,MF,,src1
MF17,#F19D8A,241/157/138,MF,,src1
MF18,#DC7B45,220/123/69,MF,,src1
MF19,#C74651,199/70/81,MF,,src1
MF20,#D8A89E,216/168/158,MF,,src1
MF21,#EB9DB9,235/157/185,MF,,src1
MF22,#FFD4D4,255/212/212,MF,,src1
MF23,#EA8474,234/132/116,MF,,src1
MF24,#F7C1C5,247/193/197,MF,,src1
MF25,#FC5768,252/87/104,MF,,src1
MG1,#FFE7C8,255/231/200,MG,,src1
MG2,#FFD6C3,255/214/195,MG,,src1
MG3,#EEB694,238/182/148,MG,,src1
MG4,#D9A58C,217/165/140,MG,,src1
MG5,#F49630,244/150/48,MG,,src1
MG6,#F19937,241/153/55,MG,,src1
MG7,#AC745B,172/116/91,MG,,src1
MG8,#694A42,105/74/66,MG,,src1
MG9,#F7CC9D,247/204/157,MG,,src1
MG10,#C7832F,199/131/47,MG,,src1
MG11,#D3C391,211/195/145,MG,,src1
MG12,#E6B986,230/185/134,MG,,src1
MG13,#C67B4F,198/123/79,MG,,src1
MG14,#8D6242,141/98/66,MG,,src1
MG15,#F6F7E2,246/247/226,MG,,src1
MG16,#F2E7D7,242/231/215,MG,,src1
MG17,#786562,120/101/98,MG,,src1
MG18,#FEF5EB,254/245/235,MG,,src1
MG19,#F0AB47,240/171/71,MG,,src1
MG20,#AE6949,174/105/73,MG,,src1
MG21,#BF8C6E,191/140/110,MG,,src1
MH1,#FFFFFF,255/255/255,MH,transparent+alpha0+display-hex,src2
MH2,#FFFFFF,255/255/255,MH,,src1
MH3,#9B9B9B,155/155/155,MH,,src1
MH4,#6D6D6D,109/109/109,MH,,src1
MH5,#4D4D4D,77/77/77,MH,,src1
MH6,#3A3A3A,58/58/58,MH,,src1
MH7,#000000,0/0/0,MH,,src1
MH8,#FFF0F1,255/240/241,MH,,src1
MH9,#E3E6DF,227/230/223,MH,,src1
MH10,#E2E0E7,226/224/231,MH,,src1
MH11,#BCB8B5,188/184/181,MH,,src1
MH12,#F7F3E1,247/243/225,MH,,src1
MH13,#EADDC8,234/221/200,MH,,src1
MH14,#B8C8C5,184/200/197,MH,,src1
MH15,#99ABAC,153/171/172,MH,,src1
MH16,#444236,68/66/54,MH,,src1
MH17,#FAFBF5,250/251/245,MH,,src1
MH18,#FEFEEE,254/254/238,MH,,src1
MH19,#FBF2E4,251/242/228,MH,,src1
MH20,#9EAEAD,158/174/173,MH,,src1
MH21,#FDFFF2,253/255/242,MH,,src1
MH22,#EDEDE7,237/237/231,MH,,src1
MH23,#B4B8A7,180/184/167,MH,,src1
MM1,#AEBBA8,174/187/168,MM,,src1
MM2,#729376,114/147/118,MM,,src1
MM3,#6A8890,106/136/144,MM,,src1
MM4,#BEB39D,190/179/157,MM,,src1
MM5,#B8B78C,184/183/140,MM,,src1
MM6,#B2AC93,178/172/147,MM,,src1
MM7,#BC9F94,188/159/148,MM,,src1
MM8,#968381,150/131/129,MM,,src1
MM9,#B39D88,179/157/136,MM,,src1
MM10,#B796A3,183/150/163,MM,,src1
MM11,#B096B9,176/150/185,MM,,src1
MM12,#685951,104/89/81,MM,,src1
MM13,#C79582,199/149/130,MM,,src1
MM14,#CA694F,202/105/79,MM,,src1
MM15,#929FA9,146/159/169,MM,,src1
`;
function parseArtkalCsv(csv) {
    return csv
        .trim()
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => {
        const [rawCode, hex, rgbText, group, flags, sourceId] = line.split(',');
        const [r, g, b] = rgbText.split('/').map((v) => Number(v));
        const alphaMatch = /(?:^|\+)alpha(\d+)/.exec(flags);
        const alpha = alphaMatch ? Number(alphaMatch[1]) : 255;
        const flagSet = flags ? flags.split('+') : [];
        const code = normalizeBrandCode(rawCode);
        return {
            code,
            hex,
            rgb: [r, g, b],
            alpha,
            group,
            flags,
            nonOfficial: flagSet.includes('display-hex'),
            transparent: flagSet.includes('transparent') || alpha < 255,
            sourceId,
            rawCode: code === rawCode ? undefined : rawCode,
        };
    });
}
export const ARTKAL_M221_ROWS = parseArtkalCsv(rawArtkalM221Csv);
export const ARTKAL_SOURCES = [
    {
        id: 'artkal-official-rgb-pdf-2025',
        upstreamIds: ['src1'],
        url: 'https://cdn.shopify.com/s/files/1/1323/8195/files/M_MINI_Beads_RGB_Color_Chart_2025.pdf?v=1760661747',
        collectedAt: '2026-09-19',
        license: 'vendor_official_publication',
        attributionRequired: false,
        official: true,
        screenApproximation: true,
        colorCount: 220,
        note: 'Artkal/优肯 M 系列 2.6mm 官方 RGB 色卡 PDF（厂商发布，全数据集内唯一官方 RGB 文件）。官方 PDF 只标 MH1 = "Transparent"、无数值。',
    },
    {
        id: 'hansbug-pindou-color-data-artkal-m221',
        upstreamIds: [],
        url: 'https://github.com/HansBug/pindou-color-data/tree/main/artkal-m-221-official',
        collectedAt: '2026-09-19',
        license: 'MIT',
        attributionRequired: true,
        attributionText: 'Artkal M221 色值转写自 HansBug/pindou-color-data (MIT, (c) 2026 HansBug)',
        official: false,
        screenApproximation: true,
        colorCount: 221,
        note: '上条官方 PDF 的机读转写（数据集生成日期 2026-05-19）。与官方 PDF 抽取结果逐字一致；与 maxcleme/beadcolors 的 artkal_m.csv (MIT, (c) 2020 maxcleme) 有 219/219 逐字一致。',
    },
    {
        id: 'bitbead-artkal-mini-mh1',
        upstreamIds: ['src2'],
        url: 'https://bitbead.pomodiary.com/zh/colors/artkal-mini/MH1',
        collectedAt: '2026-09-19',
        license: 'CC BY 4.0',
        attributionRequired: true,
        attributionText: 'MH1 显示基底色 #FFFFFF 来自 Bitbead (CC BY 4.0)',
        official: false,
        screenApproximation: true,
        colorCount: 1,
        note: '仅 MH1 一行。官方 PDF 只标 "Transparent"，此 #FFFFFF 是第三方工具站的显示基底，**不是官方物理色值**，本文件按 display-hex 显式标注。',
    },
];
export const ARTKAL_M221_GROUPS = (() => {
    const normal = [
        { id: 'MA', zh: 'MA 系', en: 'MA', kind: 'normal', count: 0 },
        { id: 'MB', zh: 'MB 系', en: 'MB', kind: 'normal', count: 0 },
        { id: 'MC', zh: 'MC 系', en: 'MC', kind: 'normal', count: 0 },
        { id: 'MD', zh: 'MD 系', en: 'MD', kind: 'normal', count: 0 },
        { id: 'ME', zh: 'ME 系', en: 'ME', kind: 'normal', count: 0 },
        { id: 'MF', zh: 'MF 系', en: 'MF', kind: 'normal', count: 0 },
        { id: 'MG', zh: 'MG 系', en: 'MG', kind: 'normal', count: 0 },
        { id: 'MM', zh: 'MM 系', en: 'MM', kind: 'normal', count: 0 },
    ];
    for (const g of normal)
        g.count = ARTKAL_M221_ROWS.filter((r) => r.group === g.id).length;
    const special = {
        id: 'MH-transparent',
        zh: 'MH 透明/特殊材质',
        en: 'MH transparent / special',
        kind: 'special',
        count: ARTKAL_M221_ROWS.filter((r) => r.transparent).length,
        note: '官方 PDF 把 MH1 标为 Transparent（无数值）；本组含全部透明项。**必须与普通色分开渲染/计数，不得混进普通色板。**',
    };
    return [...normal, special];
})();
export const ARTKAL_M221_PROFILE = {
    id: 'ARTKAL',
    name: '优肯 / Artkal M221',
    nameEn: 'Artkal M series (221)',
    paletteVersion: 'artkal-m221-v1',
    codeNormalization: '大写 + 去掉空格/下划线/连字符 + 去掉前缀与数字之间的前导零（A01→A1）',
    colorCount: ARTKAL_M221_ROWS.length,
    normalColorCount: ARTKAL_M221_ROWS.filter((r) => !r.transparent).length,
    specialColorCount: ARTKAL_M221_ROWS.filter((r) => r.transparent).length,
    sources: ARTKAL_SOURCES,
    groups: ARTKAL_M221_GROUPS,
    hasNonOfficialValues: ARTKAL_M221_ROWS.some((r) => r.nonOfficial),
    nonOfficialCodes: ARTKAL_M221_ROWS.filter((r) => r.nonOfficial).map((r) => r.code),
};
// ---------------------------------------------------------------- 品牌色板构造
/**
 * 把一行色值变成 `PaletteColor`。
 * ⚠️ Artkal 的 id 前缀是 `artkal-`（MARD 是 `mard-`），**两个品牌的 id 空间不重叠**；
 * 默认色板仍然只含 MARD，Artkal 必须显式取 `artkalMPalette`（W3.3c 的接线）。
 */
function toPaletteColor(row) {
    return {
        id: 'artkal-' + row.code.toLowerCase(),
        primaryBrand: 'ARTKAL',
        primaryCode: row.code,
        hex: row.hex,
        rgb: row.rgb,
        group: row.group,
        name: 'Artkal ' + row.code,
        codes: { ARTKAL: row.code },
    };
}
/** Artkal M221 普通色板（220 色，**不含**透明/特殊材质）。 */
export const artkalMPalette = ARTKAL_M221_ROWS.filter((r) => !r.transparent).map(toPaletteColor);
/** Artkal 特殊材质分组（透明等，1 色：MH1）—— 单独成组，**不得混进普通色板**。 */
export const artkalMSpecialPalette = ARTKAL_M221_ROWS.filter((r) => r.transparent).map(toPaletteColor);
/** 含特殊材质的完整 Artkal 色板（221 色）；给普通配色请用 {@link artkalMPalette}。 */
export const artkalMCompletePalette = ARTKAL_M221_ROWS.map(toPaletteColor);
export const BRAND_PROFILES = {
    MARD: {
        id: 'MARD',
        name: 'MARD',
        nameEn: 'MARD',
        // ⚠️ 必须与 `palette.ts` 的 `paletteVersion` 完全一致：MARD 数据本次**零变更**，故不升版。
        paletteVersion: 'mard-291-v1',
        codeNormalization: '保持原样（既有 MARD 数据已无前导零）',
        colorCount: 291,
        normalColorCount: 291,
        specialColorCount: 0,
        sources: [
            {
                id: 'upstream-import-v0.1.0',
                upstreamIds: [],
                // ⚠️ 出处是**上游项目**，不是 `woshikess/perler-beads`（那是本项目的**已上线站点仓库**，
                //    我们被明令不许碰；而且它 2026-09-16 才创建，比数据导入晚 2 天，不可能是出处）。
                url: 'https://github.com/Jett-Wu/Perler_Beads_Generator',
                collectedAt: '2026-09-19',
                license: 'MIT',
                attributionRequired: false,
                official: false,
                screenApproximation: true,
                colorCount: 291,
                note: '出处依据：本仓库导入上游 Perler Beads Generator v0.1.0（本仓库提交 84f1b99，2026-09-14 10:34:58 +08:00「Import upstream: Perler Beads Generator v0.1.0」），src/palette.ts 内嵌的 MARD 221 色 + 扩展 70 色就是那次一起进来的；本仓库 LICENSE = MIT（(c) 2026 Jett-Wu，21 行）亦随该次导入带入。⚠️ 但**色值本身是社区整理的近似值**：MARD 厂商从未发布官方 RGB（调研三次中英文检索均无果），这 291 条全部属"屏幕近似值"级，不能称作官方色卡。',
            },
            {
                id: 'bitbead-mard-291',
                upstreamIds: [],
                url: 'https://bitbead.pomodiary.com/zh/colors/mard',
                collectedAt: '2026-09-19',
                license: 'CC BY 4.0',
                attributionRequired: true,
                attributionText: 'MARD 291 色值与 Bitbead（CC BY 4.0）的 MARD-291 色板 291/291 逐字一致；谱系同源、方向不可确证，保守按 CC BY 4.0 署名 Bitbead。',
                official: false,
                screenApproximation: true,
                colorCount: 291,
                note: '独立审计（_审核\\_暂存证据\\V-BrandData\\报告.md）实测：Bitbead MARD-291 与本仓库 291 色 291/291 逐字 100% 一致（含 Q4/R11 同色那一对）。两者**谱系同源、谁先谁后不可确证**，故按"需要署名"的保守口径处理。⛔ 未采纳的同类来源：beadpatternlab.com / pixel-beads.com / pindou.online（均未声明许可证）—— 本文件不含它们的数据。',
            },
        ],
        groups: [],
        // ⚠️ 修正（W3.3c-fix）：原来是 false，与同一份 profile 里的 `screenApproximation: true` 自相矛盾。
        //    MARD 厂商未发布任何官方 RGB ⇒ 291 条**全部**是非官方近似值，UI 必须提示。
        hasNonOfficialValues: true,
        // 语义见上面 BrandProfile.nonOfficialCodes 的注释：非空 = 逐个列出；空数组 + flag 为 true = 该品牌**全部**色号都缺官方值。
        // 这里选后者（291 条逐条列举没有信息量，只会把 UI 撑爆）。
        nonOfficialCodes: [],
    },
    ARTKAL: ARTKAL_M221_PROFILE,
};
export function getBrandProfile(brand) {
    return BRAND_PROFILES[brand];
}
/** 该品牌的默认（默认色板口径）色板：MARD = basicPalette（221），其他品牌 = 自己的普通色板。 */
export function paletteForBrand(brand) {
    return brand === 'MARD' ? basicPaletteMard : artkalMPalette;
}
/**
 * 该品牌的**全量**色板（对应 `paletteMode === 'complete'`）：
 * MARD = `completePalette`（291）、Artkal = `artkalMCompletePalette`（221，含 MH1 透明）。
 * 与 {@link paletteForBrand} 成对：调色盘那两档（basic / complete）在**同一个品牌内**切换。
 *
 * 纯加法、不改任何既有导出：MARD 分支直接返回 `palette.ts` 的 `completePalette`
 * 同一个数组对象（引用相等），因此默认品牌 MARD 的行为与 `paletteMode === 'complete'
 * ? completePalette : …` 逐字相同（W3.4 报告里有逐格/逐 DOM 证据）。
 */
export function completePaletteForBrand(brand) {
    return brand === 'MARD' ? completePaletteMard : artkalMCompletePalette;
}
// ---------------------------------------------------------------- 跨品牌映射（HEX / 距离）
/**
 * 在目标品牌色板里找**与给定 RGB 最近**的颜色 —— 跨品牌换算**唯一**允许的路径。
 * 直接复用 `palette.ts` 的距离公式（`colorDistance` = 既有的带红均值加权 RGB 欧氏距离，本项目唯一距离），
 * 不另写一份、不引入 ΔE（阈值口径未重标定前禁止换距离，见 palette.ts 顶部历史）。
 *
 * @param rgb 源颜色（0-255 整数三元组）
 * @param brand 目标品牌
 * @param includeSpecial 是否把透明/特殊材质并入候选（默认 false）
 */
export function nearestColorInBrand(rgb, brand, includeSpecial = false) {
    const candidates = brand === 'MARD'
        ? basicPaletteMard
        : (includeSpecial ? artkalMCompletePalette : artkalMPalette);
    let best;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const color of candidates) {
        const d = colorDistance(rgb, color.rgb);
        if (d < bestDistance) {
            best = color;
            bestDistance = d;
        }
    }
    return best;
}
/**
 * 把一批格子的颜色**按 RGB 距离**换到目标品牌。
 * 只依赖调用方注入的 `resolveRgb`（既能是"色板查色"，也能是"取图层当前像素"），
 * 因此不需要动 App / 画布代码 —— 接线由 W3.3c 负责。
 *
 * @returns 新的 cells 数组与统计（不含任何 UI 副作用）
 */
export function recolorCellsToBrand(cells, targetBrand, resolveRgb, options = {}) {
    const seen = new Map();
    const out = new Array(cells.length);
    let changed = 0;
    let unresolved = 0;
    for (let i = 0; i < cells.length; i++) {
        const id = cells[i];
        if (!id) {
            out[i] = null;
            continue;
        }
        let mapped = seen.get(id);
        if (mapped === undefined) {
            const rgb = resolveRgb(id);
            if (!rgb) {
                mapped = id;
                unresolved += 1;
            }
            else {
                const target = nearestColorInBrand(rgb, targetBrand, options.includeSpecial);
                mapped = target ? target.id : id;
            }
            seen.set(id, mapped);
        }
        if (mapped !== id)
            changed += 1;
        out[i] = mapped;
    }
    return { cells: out, changed, unresolved, mapping: seen };
}
/** MARD 完整色板（291）转发，供 W3.3c 的 UI 取全量候选。 */
export const mardCompletePalette = completePaletteMard;
/** 与 `layerAdjustments` 无关的独立哈希：只用于"撤销后是否逐格回到原值"的对照。 */
export function hashCellArrays(layerCells) {
    let h = 0x811c9dc5;
    const feed = (s) => {
        for (let i = 0; i < s.length; i += 1) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 0x01000193) >>> 0;
        }
    };
    feed('#layers:' + layerCells.length);
    layerCells.forEach((cells, index) => {
        feed('|' + index + ':');
        for (const cell of cells)
            feed(cell === null ? '\u0000' : cell + ',');
    });
    return ('00000000' + h.toString(16)).slice(-8);
}
function snapshotOf(layerCells) {
    const counts = new Map();
    let nonNull = 0;
    for (const cells of layerCells) {
        for (const cell of cells) {
            if (cell === null)
                continue;
            nonNull += 1;
            counts.set(cell, (counts.get(cell) ?? 0) + 1);
        }
    }
    const key = [...counts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .map(([id, n]) => id + '=' + n).join(';');
    return { nonNull, usedColors: counts.size, colorCountsKey: key, layerCellsHash: hashCellArrays(layerCells) };
}
function quantile(sorted, q) {
    if (sorted.length === 0)
        return 0;
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    if (lo === hi)
        return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
function statsOf(distances) {
    const sorted = [...distances].sort((a, b) => a - b);
    const sum = sorted.reduce((acc, v) => acc + v, 0);
    return {
        cells: sorted.length,
        mean: sorted.length ? sum / sorted.length : 0,
        median: quantile(sorted, 0.5),
        p90: quantile(sorted, 0.9),
        max: sorted.length ? sorted[sorted.length - 1] : 0,
        exact: sorted.filter((v) => v < 1e-9).length,
        within2: sorted.filter((v) => v <= 2).length,
        within4: sorted.filter((v) => v <= 4).length,
        within8: sorted.filter((v) => v <= 8).length,
        over16: sorted.filter((v) => v > 16).length,
    };
}
function candidatesFor(brand, includeSpecial) {
    if (brand === 'MARD')
        return basicPaletteMard;
    return includeSpecial ? artkalMCompletePalette : artkalMPalette;
}
/**
 * 换品牌重算的**唯一入口**：给定图层与"颜色 id → 当前 RGB"的解析器，
 * 算出"要变成什么"，但**不写任何状态**。
 */
export function analyzeBrandRecolor(layers, toBrand, resolveRgb, options = {}) {
    const fromBrand = options.fromBrand ?? 'MARD';
    const includeSpecial = options.includeSpecial ?? false;
    const candidates = candidatesFor(toBrand, includeSpecial);
    const targetIds = new Set(candidates.map((color) => color.id));
    const fromPalette = candidatesFor(fromBrand, true);
    const fromById = new Map();
    for (const color of fromPalette)
        fromById.set(color.id, color);
    const targetById = new Map();
    for (const color of candidates)
        targetById.set(color.id, color);
    const changedDistances = [];
    const allDistances = [];
    const mapping = new Map();
    // 每个源色的 RGB / 目标色 / 距离只算一次（一张 52×52 的图有上千格，重复解析会白白翻几倍时间）
    const resolvedRgb = new Map();
    const colorStat = new Map();
    const layerPlans = [];
    const skippedLayerIds = [];
    const beforeCells = [];
    const afterCells = [];
    let changedCells = 0;
    let totalCells = 0;
    let resolvedCells = 0;
    let unresolvedCells = 0;
    for (const layer of layers) {
        const before = layer.cells.slice();
        beforeCells.push(before);
        if (layer.locked) {
            skippedLayerIds.push(layer.id);
            afterCells.push(before);
            layerPlans.push({ layerId: layer.id, before, after: before, changedCells: 0 });
            continue;
        }
        const after = new Array(before.length);
        let layerChanged = 0;
        for (let i = 0; i < before.length; i += 1) {
            const id = before[i];
            if (id === null || id === undefined) {
                after[i] = null;
                continue;
            }
            totalCells += 1;
            let mapped = mapping.get(id);
            if (mapped === undefined) {
                let rgb = resolvedRgb.get(id);
                if (rgb === undefined) {
                    rgb = resolveRgb(id) ?? null;
                    resolvedRgb.set(id, rgb);
                }
                if (!rgb) {
                    mapped = id;
                    unresolvedCells += 1;
                }
                else {
                    resolvedCells += 1;
                    const target = nearestColorInBrand(rgb, toBrand, includeSpecial);
                    mapped = target ? target.id : id;
                    const fromColor = fromById.get(id) ?? targetById.get(id);
                    const distance = target ? colorDistance(rgb, target.rgb) : 0;
                    allDistances.push(distance);
                    const stat = colorStat.get(id) ?? { from: fromColor, to: target, distance, count: 0 };
                    stat.count += 1;
                    colorStat.set(id, stat);
                }
                mapping.set(id, mapped);
            }
            if (mapped !== id) {
                layerChanged += 1;
                const target = targetById.get(mapped);
                const sourceRgb = resolvedRgb.get(id);
                if (target && sourceRgb)
                    changedDistances.push(colorDistance(sourceRgb, target.rgb));
            }
            after[i] = mapped;
        }
        changedCells += layerChanged;
        afterCells.push(after);
        layerPlans.push({ layerId: layer.id, before, after, changedCells: layerChanged });
    }
    const afterMapping = new Map();
    for (const cells of afterCells)
        for (const cell of cells)
            if (cell !== null)
                afterMapping.set(cell, (afterMapping.get(cell) ?? 0) + 1);
    const colorChanges = [...colorStat.entries()]
        .filter(([id, stat]) => stat.to !== undefined && stat.to.id !== id)
        .map(([id, stat]) => ({
        fromId: id,
        fromCode: stat.from ? stat.from.primaryCode : id,
        fromHex: stat.from ? stat.from.hex : '#000000',
        toId: stat.to.id,
        toCode: stat.to.primaryCode,
        toHex: stat.to.hex,
        distance: stat.distance,
        count: stat.count,
    }))
        .sort((a, b) => b.count - a.count);
    const isAlreadyTarget = options.isAlreadyTarget;
    const isIdealTarget = totalCells > 0 && unresolvedCells === 0 && [...mapping.entries()].every(([from, to]) => {
        if (from === to)
            return true;
        return isAlreadyTarget ? isAlreadyTarget(from) : targetIds.has(from);
    });
    return {
        fromBrand,
        toBrand,
        includeSpecial,
        layers: layerPlans,
        skippedLayerIds,
        changedCells,
        totalCells,
        resolvedCells,
        unresolvedCells,
        mapping: Object.fromEntries(mapping),
        mergedColorCount: [...mapping.entries()].filter(([from, to]) => from !== to).length,
        targetColorCount: afterMapping.size,
        quality: { changed: statsOf(changedDistances), all: statsOf(allDistances) },
        isIdealTarget,
        beforeSnapshot: snapshotOf(beforeCells),
        afterSnapshot: snapshotOf(afterCells),
        colorChanges,
    };
}
/** 把方案落到图层数组上（返回新数组；调用方拿它去 `withLayers` / `updateProject`）。 */
export function applyBrandRecolor(layers, plan) {
    const byId = new Map(plan.layers.map((entry) => [entry.layerId, entry]));
    return layers.map((layer) => {
        const entry = byId.get(layer.id);
        if (!entry)
            return layer;
        if (entry.after === layer.cells)
            return layer;
        return { ...layer, cells: entry.after.slice() };
    });
}
// ---------------------------------------------------------------------------
// 把品牌色板注册进 `palette.getColor`
//
// ⚠️ 必须在**模块求值期**执行：`getColor` 是画布/用量/导出/3D 预览共用的查色入口，
// 换品牌后格子里的 id 属于新品牌，`palette.ts` 自己的 291 色表查不到。
// 这里只做"加法"——MARD 的那 291 色仍在 `completePalette` 里、优先级也仍然最高。
// ---------------------------------------------------------------------------
setExtraPaletteColors([...artkalMCompletePalette]);
const brandIdsMatch = true;
void brandIdsMatch;
/** 默认品牌必须仍在联合类型里。 */
const defaultBrandIsBrandId = DEFAULT_BRAND;
void defaultBrandIsBrandId;
//# sourceMappingURL=brands.js.map