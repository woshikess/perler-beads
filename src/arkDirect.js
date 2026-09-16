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
/** 方舟「图片生成」接口 */
export const ARK_ENDPOINT = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
/** Ark 要求的最小面积（约 960x960） */
export const MIN_AREA = 921600;
/** 直连超时：原本地代理是 240 秒；方舟实测 27~107 秒（典型 58~85 秒） */
export const AI_REDRAW_TIMEOUT_MS = 240000;
/**
 * Q 版提示词 —— 实测有效的版本（第五版）
 * 核心：强制「Q版半身像」构图，头部占画面 2/3，禁止画全身
 * 因为头大 → 特征大 → 同样的画布下色块自然更粗 → 低分辨率下可读
 *
 * 背景部分按 backgroundMode 切换：
 *   keep          保留背景（原图的场景/环境一并简化绘制）
 *   remove-white  抠除背景（纯白背景，主体单独分离）
 */
export function buildPrompt(backgroundMode) {
    const keepBackground = backgroundMode !== 'remove-white';
    const backgroundLines = keepBackground
        ? [
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
        ]
        : [
            'BACKGROUND - REMOVE the background:',
            'Use a pure flat white background with absolutely nothing else in it.',
            'Do not draw any background scenery, objects or patterns at all.',
            'Only the subject itself is drawn, cleanly separated on the white background.',
        ];
    return [
        'Convert this image into a low-resolution retro pixel art sprite, like a character portrait from an old 16-bit video game.',
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
        'BIG CHUNKY PIXELS:',
        'Make the pixels BIG and CHUNKY, as if the whole picture is made of only a few hundred squares.',
        'Each square must be clearly visible as a distinct block.',
        'Do NOT draw fine details. Do NOT use small pixels.',
        '',
        'FACE - keep it clear and simple:',
        'Large simplified eyes with dark pupils and white highlights.',
        'A simple mouth, and a simple nose or no nose at all.',
        '',
        'Keep it recognizable:',
        'Keep the same hair color, same outfit main colors and same overall color scheme,',
        'so people can still tell it is the same character.',
        '',
        'Colors and outline:',
        'Flat solid colors only, no gradients, no anti-aliasing, no soft edges.',
        'At most 2 or 3 flat shading tones. Use at most 12 colors total.',
        'Give the subject a clean complete dark outline, one block thick, with no gaps.',
        '',
        ...backgroundLines,
        '',
        'FRAMING:',
        'Centered, front view, not tilted.',
        'Do NOT add grid lines, coordinates, color charts, color code labels, titles, watermarks or borders.',
    ].join('\n');
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