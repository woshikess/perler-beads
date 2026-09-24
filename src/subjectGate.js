/**
 * 主体分割的**判据**（B36）—— 全部是纯函数，不碰 DOM 之外的东西，方便单测。
 *
 * 两条判据（**严格互斥**：每张图只用一种算法，绝不叠加）：
 *   ① 这张图是**照片**吗？—— 把图缩到 256×256，算相邻像素色差（RGB 三通道绝对差之和）的**中位数**。
 *      相机传感器一定有噪点，照片的这个值 ≥ 1；画 / 像素画 / 截图是像素级干净的，实测恒为 0。
 *      实测分离度：照片 7/3/3/3，画与像素画全是 0。
 *   ② 模型**认识主体**吗？—— 前景格占比 ≥ 10% 且最大连通块 ≥ 前景格的 50%。
 *      模型只认人与宠物；风景会掉到 1~5%，复杂城市几乎 0%，像素画会出现「一整块假主体」。
 *
 * 两条都满足 ⇒ 用模型抠；**任一条不满足 ⇒ 完全走老算法，一格都不动**。
 */
/** 判定为「照片」所需的最小噪点中位数（≥1 即认为有传感器噪点） */
export const PHOTO_MEDIAN_MIN = 1;
/** 模型判为前景的格占比下限 */
export const GATE_FG_MIN = 0.1;
/** 最大连通块占前景格的比例下限 */
export const GATE_BIG_MIN = 0.5;
/** 格内「模型认为属于主体」的采样点占比达到多少才算这一格是主体 */
export const CELL_KEEP_RATIO = 0.5;
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
/** 两条判据合起来：给定分析像素与模型掩膜，判断这张图能不能用模型 */
export function evaluateSubjectGate(analysisPixels, analysisWidth, analysisHeight, mask, box, sampleSide) {
    const median = medianNeighbourDiff(analysisPixels, analysisWidth, analysisHeight);
    const isPhoto = median >= PHOTO_MEDIAN_MIN;
    if (!mask) {
        return { medianNeighbourDiff: median, isPhoto, foregroundCellShare: 0, largestBlobShare: 0, usable: false };
    }
    const { foregroundCellShare, largestBlobShare } = maskGridStats(mask, box, sampleSide);
    const usable = isPhoto && foregroundCellShare >= GATE_FG_MIN && largestBlobShare >= GATE_BIG_MIN;
    return { medianNeighbourDiff: median, isPhoto, foregroundCellShare, largestBlobShare, usable };
}
//# sourceMappingURL=subjectGate.js.map