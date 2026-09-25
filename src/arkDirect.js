/**
 * 火山方舟（Ark）直连 —— 桌面版部署到 GitHub Pages 后是**纯静态应用**，
 * 不能再依赖本地 Node 代理（scripts/ai-proxy.cjs），所以把代理里那两段逻辑搬到前端：
 *
 *   - buildPrompt(backgroundMode)：Q 版像素画提示词（实测调出来的第五版）
 *   - calcSize(w, h)：按图片宽高算一个合规的最小画布（面积 >= MIN_AREA 且为 32 的倍数）
 *
 * ⚠️ 这两个函数是从 scripts/ai-proxy.cjs **逐字搬过来**的，包括那段很长的英文提示词。
 *    提示词是实测调出来的，改之前请先跑 `node 工具脚本/_verify_ark_prompt.cjs`：
 *    它会拿 scripts/ai-proxy.cjs 作为基准，逐字比对两边的输出，不一致会直接失败。
 *
 * 跨域：方舟对任意 Origin（含 null）都回 Access-Control-Allow-Origin，
 * 预检允许 authorization,content-type，所以浏览器可以直连，不需要任何代理。
 * 唯一例外：401（Key 缺失/无效）的响应**不带**跨域头 → 浏览器拿到的是 TypeError 而不是 401，
 * 因此 App.tsx 里的错误提示会把「网络错误」映射成「可能 Key 不对」。
 */
import { ARK_ENDPOINT as ARK_ENDPOINT_DEFAULT } from './arkEndpoints.js';
/** 方舟「图片生成」接口（按量档）。真正发请求请用 `arkImagesEndpoint(档位)`，见 `arkEndpoints.ts` */
export const ARK_ENDPOINT = ARK_ENDPOINT_DEFAULT;
/** Ark 要求的最小面积（约 960x960） */
export const MIN_AREA = 921600;
/** 直连超时：原本地代理是 240 秒；方舟实测 27~107 秒（典型 58~85 秒） */
export const AI_REDRAW_TIMEOUT_MS = 240000;
/** 「Q 版像素风」的像素块描述（＝改动前那一版，逐字节冻结） */
const PIXEL_Q = [
    'BIG CHUNKY PIXELS:',
    'Make the pixels BIG and CHUNKY, as if the whole picture is made of only a few hundred squares.',
    'Each square must be clearly visible as a distinct block.',
    'Do NOT draw fine details. Do NOT use small pixels.',
];
/** 「Q 版像素风」的颜色与描边描述 */
const COLOR_Q = [
    'Colors and outline:',
    'Flat solid colors only, no gradients, no anti-aliasing, no soft edges.',
    'At most 2 or 3 flat shading tones. Use at most 12 colors total.',
    'Give the subject a clean complete dark outline, one block thick, with no gaps.',
];
/** 「Q 版像素风」的脸部描述（脸部是细节最容易堆起来的地方） */
const FACE_Q = [
    'FACE - keep it clear and simple:',
    'Large simplified eyes with dark pupils and white highlights.',
    'A simple mouth, and a simple nose or no nose at all.',
];
/** 「Q 版像素风」的开场句（"低分辨率"这句只对这一档成立） */
const OPENING_Q = 'Convert this image into a low-resolution retro pixel art sprite, like a character portrait from an old 16-bit video game.';
/**
 * Q 版提示词 —— 实测有效的版本（第五版）
 * 核心：强制「Q版半身像」构图，头部占画面 2/3，禁止画全身
 * 因为头大 → 特征大 → 同样的画布下色块自然更粗 → 低分辨率下可读
 *
 * 背景部分按 backgroundMode 切换：
 *   keep          保留背景（原图的场景/环境一并简化绘制）
 *   remove-white  抠除背景（纯白背景，主体单独分离）
 *
 * `tier` 见 `AiStyleTier`：**不传 = `'q-chibi'`**，与改动前逐字节一致
 * （所以默认这条路径的代码**不要重构**，改一个字都会让门禁 `_verify_ark_prompt.cjs` 失败）。
 */
export function buildPrompt(backgroundMode, tier = 'q-chibi') {
    if (tier === 'detail')
        return buildDetailPrompt(backgroundMode, backgroundLinesFor(backgroundMode, false));
    // 未知档位**直接抛错**，绝不静默降级成 Q 版（门禁会断言这一点：写错档位必须立刻暴露）
    if (tier !== 'q-chibi')
        throw new Error(`未知的出图风格：${String(tier)}`);
    // ⚠️ 下面的组装**一个字都不要动**：默认路径必须与改动前逐字节一致（门禁冻结了 length + SHA-256）
    const backgroundLines = backgroundLinesFor(backgroundMode, true);
    return [
        OPENING_Q,
        '',
        'COMPOSITION - this is the most important requirement:',
        'Draw a close-up head-and-shoulders BUST PORTRAIT, not a full body figure.',
        'The head must fill most of the frame, roughly two thirds of the picture height.',
        'Do NOT draw the full body. Do NOT draw legs, skirt or feet. Crop at the chest.',
        'The large head is required so the whole picture stays readable at very low resolution.',
        '',
        'CHIBI PROPORTIONS:',
        'Use cute chibi style with an oversized head and a small simple body.',
        'Simplify the clothing into just a few big flat blocks of color.',
        'Do not keep complex patterns, folds, trims or ornaments - merge them away.',
        '',
        ...PIXEL_Q,
        '',
        ...FACE_Q,
        '',
        'Keep it recognizable:',
        'Keep the same hair color, same outfit main colors and same overall color scheme,',
        'so people can still tell it is the same character.',
        '',
        ...COLOR_Q,
        '',
        ...backgroundLines,
        '',
        'FRAMING:',
        'Centered, front view, not tilted.',
        'Do NOT add grid lines, coordinates, color charts, color code labels, titles, watermarks or borders.',
    ].join('\n');
}
/**
 * 「精致写实风」的提示词 —— 第 B45 批实测出来的「hi-bit 精细像素插画」那一版
 * （在 104 / 156 格上明显比 Q 版更精致、也更像照片本人；但在 52 / 78 上会碎）。
 *
 * ⚠️ 它**故意不写** `realistic / photorealistic` 这类词 —— 三份独立的像素画配方里这些词都是**负面词**，
 *    会把模型推向"平滑插画 + 像素滤镜"。这里的"精致"是靠**缩略语法的向上展开**表达的：
 *    更多色阶（4 档）、更大的眼睛像素预算（3×3 带瞳孔）、选择性更强的结构（下颌/发绺/衣褶）。
 * ⚠️ 构图仍然**保持半身、不变** —— 第 B41 批的教训：构图一放宽，模型就把人画成另一个人。
 */
function buildDetailPrompt(backgroundMode, backgroundLines) {
    return [
        'Convert this photo into a modern hi-bit pixel art portrait - refined, richly shaded pixel illustration, well beyond the old console look.',
        '',
        'STYLE - modern hi-bit pixel illustration:',
        'hi-bit pixel art, the polished modern indie look: many flat color steps, deliberate pixel clusters, no rendering noise.',
        'Think of a high-quality hand-made pixel portrait, not a filtered photograph and not a smooth digital painting.',
        'The grid must still be obvious: every shape is built from visible square blocks of one flat color.',
        '',
        'PROPORTIONS - this is a bust, so describe what is actually visible:',
        'A softly stylised portrait: the head is a little larger than life, but the shoulders, chest and neck',
        "keep close to the person's real proportions - about two and a half head-widths across the shoulders.",
        'The face keeps the real structure of this person: the same jaw line, chin, cheek shape and forehead height.',
        'Charming and slightly stylised, but this should look like this specific person, not a generic doll.',
        '',
        'FACE - the most refined part:',
        'Eyes about three by three pixels with a dark pupil, a visible iris and one or two white highlight pixels.',
        'Both eyes identical. Eyebrows two or three pixels each, following the photo.',
        'A small nose built from one shadow pixel and one light pixel. A clear mouth with a subtle shadow under the lip.',
        'You may draw eyelashes as one or two deliberate pixels - but keep them as solid blocks, never as thin broken lines.',
        '',
        'HAIR - grouped, not noisy:',
        'Build the hair from several distinct clumps with clean stepped edges and one or two interior highlight bands.',
        'Use four flat tones in the hair: deep shadow, shadow, base and light. Never draw single-pixel flyaway strands.',
        '',
        'MATERIALS:',
        'Skin: four flat tones, the shadow tone leaning slightly warm.',
        "Cloth: three or four flat tones with two or three clean fold lines, following the photo's clothing.",
        'Use 24 to 32 flat colors in total.',
        '',
        'SHADING AND OUTLINE:',
        'Every block is one solid flat color with hard pixel edges: no gradients, no anti-aliasing, no soft edges, no dithering, no texture.',
        'Move the shadow tones slightly toward cool colors and the light tones slightly toward warm colors - never a straight darker copy of the base.',
        "Give the subject a complete fine outline, one pixel thick, in a darker shade of each area's own color (not pure black), with no gaps.",
        'Keep large readable color clusters; avoid single isolated pixels except the eye highlights.',
        '',
        'COMPOSITION - this is the most important requirement:',
        'Draw a close-up head-and-shoulders BUST PORTRAIT, not a full body figure.',
        'The head must fill most of the frame, roughly two thirds of the picture height.',
        'Do NOT draw the full body. Do NOT draw legs, skirt or feet. Crop at the chest.',
        '',
        'KEEP IT RECOGNIZABLE:',
        'Keep the same hairstyle silhouette, the same hair color, the same outfit main colors and the same overall color scheme,',
        'so people can still tell it is the same person.',
        'Keep any identifying feature from the photo (glasses, hat, collar, accessory, distinctive hair).',
        '',
        ...backgroundLines,
        '',
        'FRAMING:',
        'Centered, front view, not tilted.',
        'Do NOT add grid lines, coordinates, color charts, color code labels, titles, watermarks or borders.',
        'Do NOT draw any text, signature or logo.',
    ].join('\n');
}
/**
 * 背景段。两种风格**共用同一段**，保证"背景选择"这个变量在两条风格路径上完全一致。
 * `chibi=true` 时额外强调"加了背景也不许把角色画得更写实"（Q 版那档特有的顾虑）。
 */
function backgroundLinesFor(backgroundMode, chibi) {
    const keepBackground = backgroundMode !== 'remove-white';
    if (!keepBackground) {
        return [
            'BACKGROUND - REMOVE the background:',
            'Use a pure flat white background with absolutely nothing else in it.',
            'Do not draw any background scenery, objects or patterns at all.',
            'Only the subject itself is drawn, cleanly separated on the white background.',
        ];
    }
    if (chibi) {
        return [
            'BACKGROUND - the original background is ALSO drawn, but it must NOT weaken the chibi style:',
            'Very important: the character MUST stay exactly as chibi as described above -',
            'same oversized head filling most of the frame, same big simple face, same chunky pixels.',
            'Do NOT make the character more realistic, more detailed or more proportionally correct',
            'just because the background is present.',
            'Draw the background only as a few large flat blocks of color, clearly simplified,',
            'filling the area AROUND the character and never competing with the character for attention.',
            'Use fewer detail and lower contrast in the background than in the character.',
            'Keep it recognizable as the same place, but do not draw fine background details.',
            'The character must still be clearly separated from the background by a dark outline.',
        ];
    }
    return [
        'BACKGROUND - the original background is ALSO drawn, but it must stay clearly simplified:',
        'Draw the background only as a few large flat blocks of color, with no fine detail and low contrast,',
        'filling the area AROUND the character and never competing with the character for attention.',
        'Keep it recognizable as the same place, but simplify it heavily.',
        'The character must still be clearly separated from the background by a clean outline.',
    ];
}
/** 按图片宽高算一个合规的最小画布尺寸（面积 >= MIN_AREA，且为 32 的倍数） */
export function calcSize(w, h) {
    const ar = w / h;
    let W;
    let H;
    if (ar >= 1) {
        H = Math.ceil(Math.sqrt(MIN_AREA / ar) / 32) * 32;
        W = Math.ceil((H * ar) / 32) * 32;
    }
    else {
        W = Math.ceil(Math.sqrt(MIN_AREA * ar) / 32) * 32;
        H = Math.ceil((W / ar) / 32) * 32;
    }
    while (W * H < MIN_AREA)
        H += 32;
    return { W, H };
}
//# sourceMappingURL=arkDirect.js.map