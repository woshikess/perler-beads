/**
 * 主体分割的**判据**（B36）—— 全部是纯函数，不碰 DOM 之外的东西，方便单测。
 *
 * 三条判据（**严格互斥**：每张图只用一种算法，绝不叠加）：
 *   ① 这张图是**照片**吗？—— 把图缩到 256×256，算相邻像素色差（RGB 三通道绝对差之和）的**中位数**。
 *      相机传感器一定有噪点，照片的这个值 ≥ 1；画 / 像素画 / 截图是像素级干净的，实测恒为 0。
 *      实测分离度：照片 7/3/3/3，画与像素画全是 0。
 *   ② 模型**找到的是一块够大的东西**吗？—— 前景格占比 ≥ 10% 且最大连通块 ≥ 前景格的 50%。
 *      模型只认人与宠物；风景会掉到 1~5%，复杂城市几乎 0%，像素画会出现「一整块假主体」。
 *   ③ 模型找到的东西**像个人**吗？—— 「头发 + 身体皮肤 + 面部皮肤」这三类非衣服部分
 *      合计要占像素的 **≥ 2%**。这一条专门用来识别「一整块被模型当成衣服的假主体」。
 *
 * 三条都满足 ⇒ 用模型抠；**任一条不满足 ⇒ 完全走老算法，一格都不动**。
 *
 * ⚠️ 判据③ 是 B37 补的，原因是真出过一次事故：**AI 重绘出来、且带背景的 Q 版像素画**
 *    （实测素材 `保留背景_旧/新.jpg`）同时通过①②，但模型给的是「一整块被当成衣服的假主体」：
 *    头发 0.0% / 身体皮肤 0.4% / 面部皮肤 0.2% / 衣服 40.1% —— 三样非衣服部分合计只有 **0.6%**。
 *    那张掩膜只盖住头发和手，会把脸、衣服、猫全部删掉，出图直接烂掉。
 *
 * ⚠️⚠️ 判据③ 用过两版门槛，**第一版是错的，别退回去**：
 *    - 第一版要求「四类里至少 3 类各 ≥1%」。它对真照片和有害素材都分得开，但**副作用是
 *      把 AI 重绘图也一起拦了**（AI 图的掩膜常常只被标成「衣服」一类）。而把 AI 画出来的那层
 *      背景抠干净的**正是模型**（容差去背做不到：方舟画的「纯白背景」有渐变细纹），
 *      于是「去掉背景」下满屏留下近乎白色的碎豆 —— 用户实测直接报"效果大不如前"。
 *    - 现在这版只要求「非衣服的人体部分合计 ≥2%」，比第一版**宽松**，仍然把两张有害素材
 *      （0.6% / 0.3%）挡在外面，同时放行掩膜有效的 AI 图。实测分离度 **25 倍以上**。
 *
 *    实测（落格 52 宽，`_审核\...\B37`）：真照片 5/5 通过（发+身+脸 = 28.8 / 15.0 / 21.5 / 43.5 / 34.0），
 *    猫 21.5%，两张有害素材 0.6% / 0.3% 被拦；10 张测试素材的分流结论**一格没变**。
 */
/** 判定为「照片」所需的最小噪点中位数（≥1 即认为有传感器噪点） */
export const PHOTO_MEDIAN_MIN = 1;
/** 模型判为前景的格占比下限 */
export const GATE_FG_MIN = 0.1;
/** 最大连通块占前景格的比例下限 */
export const GATE_BIG_MIN = 0.5;
/** 格内「模型认为属于主体」的采样点占比达到多少才算这一格是主体 */
export const CELL_KEEP_RATIO = 0.5;
/** 判据③：「头发 + 身体皮肤 + 面部皮肤」合计占像素的比例下限（衣服不算，见文件头注释） */
export const PERSON_PARTS_MIN_SHARE = 0.02;
/** 报告里用的参考门槛：单类「出现」的占比（**不参与门禁判定**，只给人看类数） */
export const PERSON_CATEGORY_MIN_SHARE = 0.01;
/** 模型类别掩膜里代表人体部位的编号（0=背景、5=其它/配饰，都不算） */
export const PERSON_CATEGORY_IDS = [1, 2, 3, 4];
/** 上面前三个（头发/身体皮肤/面部皮肤）的位置 —— 判据③只看这三个 */
const NON_CLOTHES_INDEXES = [0, 1, 2];
/**
 * 相邻像素色差的中位数。
 * `data` 是 RGBA 像素（长度 = width*height*4）；调用方负责先缩到分析尺寸（256×256）。
 */
export function medianNeighbourDiff(data, width, height) {
    const diffs = [];
    for (let y = 0; y < height; y += 1) {
        const row = y * width;
        for (let x = 0; x + 1 < width; x += 1) {
            const i = (row + x) * 4;
            const j = i + 4;
            diffs.push(Math.abs(data[i] - data[j]) + Math.abs(data[i + 1] - data[j + 1]) + Math.abs(data[i + 2] - data[j + 2]));
        }
    }
    if (diffs.length === 0)
        return 0;
    diffs.sort((a, b) => a - b);
    return diffs[Math.floor(diffs.length / 2)];
}
/** 判据①：这张图是不是照片 */
export function isPhotoByNoise(data, width, height) {
    return medianNeighbourDiff(data, width, height) >= PHOTO_MEDIAN_MIN;
}
/**
 * 把模型掩膜放大成与原图同尺寸的 `Uint8Array`（最近邻；1 = 主体，0 = 背景）。
 * `imageToBeads` 的取样器要按原图像素逐个读，所以需要这个尺寸。
 */
export function upscaleSubjectMask(mask, sourceWidth, sourceHeight) {
    const out = new Uint8Array(sourceWidth * sourceHeight);
    for (let y = 0; y < sourceHeight; y += 1) {
        const my = Math.min(mask.height - 1, Math.max(0, Math.floor((y / sourceHeight) * mask.height)));
        const row = my * mask.width;
        const outRow = y * sourceWidth;
        for (let x = 0; x < sourceWidth; x += 1) {
            const mx = Math.min(mask.width - 1, Math.max(0, Math.floor((x / sourceWidth) * mask.width)));
            out[outRow + x] = mask.category[row + mx] !== 0 ? 1 : 0;
        }
    }
    return out;
}
/** 掩膜盖住的那一格 —— 与 `imageToBeads` 的取样网格保持同一套坐标换算 */
function maskForegroundRatio(mask, box, x, y, sampleSide) {
    let hit = 0;
    let total = 0;
    for (let sy = 0; sy < sampleSide; sy += 1) {
        for (let sx = 0; sx < sampleSide; sx += 1) {
            const sourceX = Math.min(box.sourceWidth - 1, Math.max(0, Math.floor(((x + (sx + 0.5) / sampleSide) / box.gridWidth) * box.sourceWidth)));
            const sourceY = Math.min(box.sourceHeight - 1, Math.max(0, Math.floor(((y + (sy + 0.5) / sampleSide) / box.gridHeight) * box.sourceHeight)));
            const mx = Math.min(mask.width - 1, Math.max(0, Math.floor((sourceX / box.sourceWidth) * mask.width)));
            const my = Math.min(mask.height - 1, Math.max(0, Math.floor((sourceY / box.sourceHeight) * mask.height)));
            total += 1;
            if (mask.category[my * mask.width + mx] !== 0)
                hit += 1;
        }
    }
    return total > 0 ? hit / total : 0;
}
/** 判据②用：掩膜在落格层面上的形态统计 */
export function maskGridStats(mask, box, sampleSide) {
    const { gridWidth, gridHeight } = box;
    const isForeground = new Uint8Array(gridWidth * gridHeight);
    let foreground = 0;
    for (let y = 0; y < gridHeight; y += 1) {
        for (let x = 0; x < gridWidth; x += 1) {
            if (maskForegroundRatio(mask, box, x, y, sampleSide) >= CELL_KEEP_RATIO) {
                isForeground[y * gridWidth + x] = 1;
                foreground += 1;
            }
        }
    }
    if (foreground === 0)
        return { foregroundCellShare: 0, largestBlobShare: 0 };
    // 4-邻接找最大连通块
    const seen = new Uint8Array(gridWidth * gridHeight);
    let largest = 0;
    const stack = [];
    for (let start = 0; start < isForeground.length; start += 1) {
        if (!isForeground[start] || seen[start])
            continue;
        let size = 0;
        stack.length = 0;
        stack.push(start);
        seen[start] = 1;
        while (stack.length > 0) {
            const current = stack.pop();
            size += 1;
            const cx = current % gridWidth;
            const cy = (current - cx) / gridWidth;
            if (cx > 0) {
                const q = current - 1;
                if (isForeground[q] && !seen[q]) {
                    seen[q] = 1;
                    stack.push(q);
                }
            }
            if (cx < gridWidth - 1) {
                const q = current + 1;
                if (isForeground[q] && !seen[q]) {
                    seen[q] = 1;
                    stack.push(q);
                }
            }
            if (cy > 0) {
                const q = current - gridWidth;
                if (isForeground[q] && !seen[q]) {
                    seen[q] = 1;
                    stack.push(q);
                }
            }
            if (cy < gridHeight - 1) {
                const q = current + gridWidth;
                if (isForeground[q] && !seen[q]) {
                    seen[q] = 1;
                    stack.push(q);
                }
            }
        }
        if (size > largest)
            largest = size;
    }
    return { foregroundCellShare: foreground / (gridWidth * gridHeight), largestBlobShare: largest / foreground };
}
/**
 * 判据③用：人体四类各自占**全图**像素的比例（顺序 = 头发 / 身体皮肤 / 面部皮肤 / 衣服）。
 * 用「占全图」而不是「占前景」——因为像素画那种假主体的前景本身就只由一类构成，
 * 用占比看的是「这张图的像素分布像不像一个被分割出来的人」。
 */
export function personCategoryShares(mask) {
    const counts = PERSON_CATEGORY_IDS.map(() => 0);
    const total = mask.category.length;
    if (total === 0)
        return counts;
    for (let i = 0; i < total; i += 1) {
        const index = PERSON_CATEGORY_IDS.indexOf(mask.category[i]);
        if (index >= 0)
            counts[index] += 1;
    }
    return counts.map((n) => n / total);
}
/** 判据③：只给人看的参考值 —— 达到门槛的人体类别数 */
export function personKindCount(shares, minShare = PERSON_CATEGORY_MIN_SHARE) {
    return shares.filter((share) => share >= minShare).length;
}
/** 判据③：非衣服的人体部分（头发 + 身体皮肤 + 面部皮肤）合计占比 */
export function personPartsShare(shares) {
    return NON_CLOTHES_INDEXES.reduce((sum, index) => sum + (shares[index] || 0), 0);
}
/** 三条判据合起来：给定分析像素与模型掩膜，判断这张图能不能用模型 */
export function evaluateSubjectGate(analysisPixels, analysisWidth, analysisHeight, mask, box, sampleSide) {
    const median = medianNeighbourDiff(analysisPixels, analysisWidth, analysisHeight);
    const isPhoto = median >= PHOTO_MEDIAN_MIN;
    if (!mask) {
        return { medianNeighbourDiff: median, isPhoto, foregroundCellShare: 0, largestBlobShare: 0, personCategoryShares: [0, 0, 0, 0], personPartsShare: 0, personKinds: 0, usable: false };
    }
    const { foregroundCellShare, largestBlobShare } = maskGridStats(mask, box, sampleSide);
    const personCategorySharesValue = personCategoryShares(mask);
    const personParts = personPartsShare(personCategorySharesValue);
    const personKinds = personKindCount(personCategorySharesValue);
    const usable = isPhoto
        && foregroundCellShare >= GATE_FG_MIN
        && largestBlobShare >= GATE_BIG_MIN
        && personParts >= PERSON_PARTS_MIN_SHARE;
    return {
        medianNeighbourDiff: median,
        isPhoto,
        foregroundCellShare,
        largestBlobShare,
        personCategoryShares: personCategorySharesValue,
        personPartsShare: personParts,
        personKinds,
        usable,
    };
}
//# sourceMappingURL=subjectGate.js.map