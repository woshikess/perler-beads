// W0.3：601 亮度的定义收敛到 ./luminance（原先本文件与 exporters.ts 各有一份逐字相同的副本）
import { luminance601 as luminance } from './luminance.js';
import { colorDistance, nearestPaletteColor, palette } from './palette.js';
import { CELL_KEEP_RATIO } from './subjectGate.js';
const styleProfiles = {
    cartoon: {
        sampleSide: 7,
        backgroundThreshold: 0.72,
        dominanceThreshold: 0.34,
        candidateTargetRatio: 0.58,
        candidateDistanceFactor: 1.35,
        postStrengthBias: 1,
        useAverageFallback: false,
    },
    realistic: {
        sampleSide: 5,
        backgroundThreshold: 0.58,
        dominanceThreshold: 0.26,
        candidateTargetRatio: 0.95,
        candidateDistanceFactor: 0.65,
        postStrengthBias: -1,
        useAverageFallback: true,
    },
};
export async function imageFileToBeads(file, options) {
    const image = await loadImage(file);
    const sourceWidth = Math.max(1, image.naturalWidth);
    const sourceHeight = Math.max(1, image.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = sourceWidth;
    canvas.height = sourceHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context)
        throw new Error('Canvas is not available.');
    context.imageSmoothingEnabled = true;
    context.drawImage(image, 0, 0, sourceWidth, sourceHeight);
    const data = context.getImageData(0, 0, sourceWidth, sourceHeight).data;
    return imageDataToBeads(data, sourceWidth, sourceHeight, options);
}
/**
 * 出图管线的**纯逻辑主体**（不碰 DOM、不碰 canvas）。
 *
 * 从 `imageFileToBeads` 里抽出来的唯一目的是：验证脚本要在 Node 里
 * 用**同一条真实管线**跑（而不是另写一份算法），而 Node 里没有 `Image` / `canvas`。
 * 解码那一步留在 `imageFileToBeads`，这里只吃 RGBA 像素。
 *
 * 抽取是纯粹的搬移：`imageFileToBeads` 现在只负责解码 + 转发，行为与抽取前逐位一致。
 * （当年用来证明这件事的 A/B 脚本 `工具脚本/_verify_ab_refactor.cjs` 已随 A/B 实验一起删除。）
 *
 * 目前只有同文件的 `imageFileToBeads` 调用它，所以不再 export。
 */
function imageDataToBeads(data, sourceWidth, sourceHeight, options) {
    const width = Math.max(1, Math.round(options.width));
    const height = Math.max(1, Math.round((sourceHeight / sourceWidth) * width));
    const activePalette = options.palette ?? palette;
    const profile = styleProfiles[options.generationStyle ?? 'cartoon'];
    const requestedSpeckleStrength = options.speckleReduction ?? 0;
    const speckleStrength = requestedSpeckleStrength > 0 ? clampStrength(requestedSpeckleStrength + profile.postStrengthBias) : 0;
    const backgroundColor = estimateBackgroundColor(data, sourceWidth, sourceHeight);
    // 「去除背景」只抠掉与画面四边连通的背景色区域；被主体包围的同色像素（眼睛高光、衣服白条等）保留为拼豆。
    // 容差可以自动校准：白衣服贴白背景时，默认容差会把衣服一起当背景吞掉，这时会自动找一个能保住白色的值，
    // 并由调用方把结果写回界面滑条。用户手动拖过之后（calibrate: false）就完全按用户的值来。
    const shouldCalibrate = options.calibrateTolerance !== false && options.backgroundMode !== 'keep';
    const effectiveTolerance = shouldCalibrate
        ? calibrateTolerance(data, sourceWidth, sourceHeight, backgroundColor, options.tolerance)
        : options.tolerance;
    const backgroundMask = options.backgroundMode === 'keep'
        ? null
        : computeBackgroundMask(data, sourceWidth, sourceHeight, backgroundColor, effectiveTolerance);
    const sampledCells = sampleGridCells(data, sourceWidth, sourceHeight, width, height, backgroundMask, profile, speckleStrength);
    const ranked = rankPaletteColors(sampledCells, options, activePalette, profile);
    const candidates = selectCandidateColors(ranked, Math.max(2, options.maxColors), activePalette, speckleStrength, profile);
    const cells = sampledCells.map((cell) => chooseCellColor(cell, candidates, profile));
    const mergedCells = mergeSimilarColors(cells, speckleStrength, candidates);
    const compactCells = reduceTinyRegions(mergedCells, width, height, speckleStrength, candidates);
    const reducedCells = reduceSpeckles(compactCells, width, height, speckleStrength, candidates);
    // 眼睛高光保护：只对「AI 重绘出来的 Q 版像素画」开启（由调用方通过 preserveEyeHighlight 指定）。
    // 必须放在所有后处理之后，这样合并近似色 / 去零星 / 去小区域不会再把它当噪点擦掉。
    const protectedCells = options.preserveEyeHighlight
        ? protectEyeHighlights(reducedCells, data, sourceWidth, sourceHeight, width, height, candidates, activePalette)
        : reducedCells;
    // 主体掩膜（B36）：只做减法 —— 把模型判为「背景」的格清空。
    // 放在**最后**：这样合并近似色 / 去零星 / 去小区域 / 眼睛高光都不会把掩膜清掉的格又补回来。
    // 传了掩膜才走这一步；没传时 `maskedCells === protectedCells`，行为与改动前逐格一致。
    const maskedCells = options.subjectMask
        ? dropCellsOutsideSubject(protectedCells, options.subjectMask, {
            gridWidth: width,
            gridHeight: height,
            sourceWidth,
            sourceHeight,
            sampleSide: profile.sampleSide,
        })
        : protectedCells;
    const colorsUsed = new Set(maskedCells.filter(Boolean)).size;
    const totalBeads = maskedCells.filter(Boolean).length;
    return { width, height, cells: maskedCells, colorsUsed, totalBeads, effectiveTolerance };
}
/**
 * 把「主体之外」的格清空（B36）。**只做减法**：原本是空的格不会被填回豆，颜色也不会被改。
 *
 * 判定口径与产品取样器一致：每格取 `sampleSide × sampleSide` 个采样点，
 * 落在掩膜主体内的比例达到 `CELL_KEEP_RATIO` 才保留这一格。
 */
function dropCellsOutsideSubject(cells, subjectMask, box) {
    const { gridWidth, gridHeight, sourceWidth, sourceHeight, sampleSide } = box;
    if (subjectMask.length !== sourceWidth * sourceHeight)
        return cells;
    const total = sampleSide * sampleSide;
    return cells.map((colorId, index) => {
        if (!colorId)
            return null;
        const x = index % gridWidth;
        const y = (index - x) / gridWidth;
        let hit = 0;
        for (let sy = 0; sy < sampleSide; sy += 1) {
            for (let sx = 0; sx < sampleSide; sx += 1) {
                const sourceX = Math.min(sourceWidth - 1, Math.max(0, Math.floor(((x + (sx + 0.5) / sampleSide) / gridWidth) * sourceWidth)));
                const sourceY = Math.min(sourceHeight - 1, Math.max(0, Math.floor(((y + (sy + 0.5) / sampleSide) / gridHeight) * sourceHeight)));
                if (subjectMask[sourceY * sourceWidth + sourceX] === 1)
                    hit += 1;
            }
        }
        return hit / total >= CELL_KEEP_RATIO ? colorId : null;
    });
}
function loadImage(file) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        const url = URL.createObjectURL(file);
        image.onload = () => {
            URL.revokeObjectURL(url);
            resolve(image);
        };
        image.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Could not load this image.'));
        };
        image.src = url;
    });
}
function sampleGridCells(data, sourceWidth, sourceHeight, width, height, backgroundMask, profile, speckleStrength) {
    const cells = [];
    const totalSamples = profile.sampleSide * profile.sampleSide;
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const samples = [];
            let backgroundCount = 0;
            let r = 0;
            let g = 0;
            let b = 0;
            for (let sy = 0; sy < profile.sampleSide; sy += 1) {
                for (let sx = 0; sx < profile.sampleSide; sx += 1) {
                    const sourceX = Math.min(sourceWidth - 1, Math.max(0, Math.floor(((x + (sx + 0.5) / profile.sampleSide) / width) * sourceWidth)));
                    const sourceY = Math.min(sourceHeight - 1, Math.max(0, Math.floor(((y + (sy + 0.5) / profile.sampleSide) / height) * sourceHeight)));
                    const index = (sourceY * sourceWidth + sourceX) * 4;
                    const alpha = data[index + 3];
                    const rgb = [data[index], data[index + 1], data[index + 2]];
                    const isBackground = alpha < 24 || (backgroundMask !== null && backgroundMask[sourceY * sourceWidth + sourceX] === 1);
                    if (isBackground) {
                        backgroundCount += 1;
                        continue;
                    }
                    const simplified = simplifySourceRgb(rgb, speckleStrength);
                    samples.push(simplified);
                    r += simplified[0];
                    g += simplified[1];
                    b += simplified[2];
                }
            }
            cells.push({
                samples,
                average: samples.length > 0
                    ? [Math.round(r / samples.length), Math.round(g / samples.length), Math.round(b / samples.length)]
                    : null,
                backgroundShare: backgroundCount / totalSamples,
            });
        }
    }
    return cells;
}
function rankPaletteColors(sampledCells, options, activePalette, profile) {
    const counts = new Map();
    let total = 0;
    sampledCells.forEach((cell) => {
        if (cell.backgroundShare >= profile.backgroundThreshold || cell.samples.length === 0)
            return;
        cell.samples.forEach((rgb) => {
            total += 1;
            const color = nearestPaletteColor(rgb, activePalette);
            const bucket = counts.get(color.id) ?? { color, count: 0 };
            bucket.count += 1;
            counts.set(color.id, bucket);
        });
    });
    const rows = [...counts.values()]
        .map((entry) => {
        const chroma = colorChroma(entry.color.rgb);
        const share = total > 0 ? entry.count / total : 0;
        const lightness = luminance(entry.color.rgb);
        const accentBoost = chroma > 48 ? 2.25 : chroma > 28 ? 1.4 : 1;
        const minorityAccentBoost = chroma > 58 && share < 0.018 ? 2.45 : 1;
        const darkLineBoost = lightness < 48 ? 1.55 : 1;
        const lightNeutralPenalty = lightness > 210 && chroma < 22 ? 0.82 : 1;
        return {
            ...entry,
            score: entry.count * accentBoost * minorityAccentBoost * darkLineBoost * lightNeutralPenalty,
        };
    })
        .sort((a, b) => b.score - a.score || b.count - a.count);
    return rows.length > 0
        ? rows
        : activePalette.slice(0, options.maxColors).map((color) => ({ color, count: 1, score: 1 }));
}
function selectCandidateColors(ranked, maxColors, activePalette, strength, profile) {
    const level = Math.max(0, Math.min(4, Math.round(strength)));
    const selected = [];
    const selectedIds = new Set();
    const add = (color, allowSimilar = false) => {
        if (selectedIds.has(color.id) || selected.length >= maxColors)
            return false;
        if (!allowSimilar && selected.length > 0) {
            const chroma = colorChroma(color.rgb);
            const baseThreshold = luminance(color.rgb) < 48 || chroma > 58 ? 18 : 34;
            const threshold = (baseThreshold + level * (chroma > 58 ? 3 : 7)) * profile.candidateDistanceFactor;
            const nearestDistance = Math.min(...selected.map((item) => colorDistance(color.rgb, item.rgb)));
            if (nearestDistance < threshold)
                return false;
        }
        selected.push(color);
        selectedIds.add(color.id);
        return true;
    };
    const chooseDiverseUntil = (targetCount) => {
        while (selected.length < Math.min(maxColors, targetCount)) {
            const choices = ranked
                .filter((entry) => !selectedIds.has(entry.color.id))
                .map((entry) => ({
                entry,
                diversityScore: candidateDiversityScore(entry, selected),
            }))
                .sort((a, b) => b.diversityScore - a.diversityScore);
            const added = choices.some((choice) => add(choice.entry.color));
            if (!added)
                break;
        }
    };
    const sortedByCount = [...ranked].sort((a, b) => b.count - a.count);
    sortedByCount.forEach((entry) => {
        if (selected.length < Math.ceil(maxColors * 0.28))
            add(entry.color);
    });
    const protectedFeatureSlots = Math.max(2, Math.ceil(maxColors * (profile.useAverageFallback ? 0.28 : 0.22)));
    const featureCandidates = ranked
        .filter((entry) => isFeatureColor(entry.color, entry.count, ranked))
        .map((entry) => ({
        entry,
        featureScore: featureColorScore(entry, selected),
    }))
        .sort((a, b) => b.featureScore - a.featureScore);
    featureCandidates.forEach((choice) => {
        if (selected.length < maxColors && selected.filter((color) => isFeaturePaletteColor(color)).length < protectedFeatureSlots) {
            add(choice.entry.color, shouldAllowFeatureSimilarity(choice.entry.color, selected));
        }
    });
    ranked
        .filter((entry) => isFeaturePaletteColor(entry.color))
        .forEach((entry) => add(entry.color, shouldAllowFeatureSimilarity(entry.color, selected)));
    chooseDiverseUntil(Math.ceil(maxColors * profile.candidateTargetRatio));
    ranked.forEach((entry) => add(entry.color));
    if (profile.useAverageFallback || selected.length < Math.min(6, maxColors)) {
        ranked.forEach((entry) => add(entry.color, true));
    }
    return selected.length > 0 ? selected : activePalette.slice(0, maxColors);
}
function isFeatureColor(color, count, ranked) {
    const maxCount = Math.max(1, ranked[0]?.count ?? 1);
    const shareOfLargest = count / maxCount;
    const chroma = colorChroma(color.rgb);
    const lightness = luminance(color.rgb);
    if (chroma > 70 && shareOfLargest > 0.002)
        return true;
    if (chroma > 52 && shareOfLargest > 0.006)
        return true;
    if (lightness < 36 && shareOfLargest > 0.003)
        return true;
    return false;
}
function isFeaturePaletteColor(color) {
    return colorChroma(color.rgb) > 48 || luminance(color.rgb) < 45;
}
function shouldAllowFeatureSimilarity(color, selected) {
    if (selected.length === 0)
        return false;
    const nearestDistance = Math.min(...selected.map((item) => colorDistance(color.rgb, item.rgb)));
    const chroma = colorChroma(color.rgb);
    return chroma > 68 && nearestDistance > 14;
}
function featureColorScore(entry, selected) {
    const chroma = colorChroma(entry.color.rgb);
    const lightness = luminance(entry.color.rgb);
    const selectedDistance = selected.length > 0 ? Math.min(...selected.map((color) => colorDistance(entry.color.rgb, color.rgb))) : 90;
    const saturationBoost = 1 + Math.min(3.2, chroma / 34);
    const contrastBoost = lightness < 42 ? 1.8 : 1;
    const differenceBoost = Math.max(0.8, Math.min(4.5, selectedDistance / 22));
    return Math.sqrt(Math.max(1, entry.count)) * saturationBoost * contrastBoost * differenceBoost;
}
function candidateDiversityScore(entry, selected) {
    if (selected.length === 0)
        return entry.score;
    const distance = Math.min(...selected.map((color) => colorDistance(entry.color.rgb, color.rgb)));
    const chroma = colorChroma(entry.color.rgb);
    const lightness = luminance(entry.color.rgb);
    const distinctBoost = Math.max(0.35, Math.min(5.4, (distance / 26) ** 1.55));
    const featureBoost = chroma > 58 || lightness < 48 ? 2.15 : chroma > 34 ? 1.36 : 1;
    const countSignal = Math.sqrt(Math.max(1, entry.count));
    return countSignal * distinctBoost * featureBoost;
}
function chooseCellColor(cell, candidates, profile) {
    if (cell.backgroundShare >= profile.backgroundThreshold || cell.samples.length === 0)
        return null;
    const counts = new Map();
    cell.samples.forEach((rgb) => {
        const color = nearestPaletteColor(rgb, candidates);
        const bucket = counts.get(color.id) ?? { color, count: 0 };
        bucket.count += 1;
        counts.set(color.id, bucket);
    });
    const ranked = [...counts.values()].sort((a, b) => b.count - a.count);
    const primary = ranked[0];
    if (!primary)
        return null;
    const primaryShare = primary.count / cell.samples.length;
    if (primaryShare >= profile.dominanceThreshold || !profile.useAverageFallback || !cell.average) {
        return primary.color.id;
    }
    return nearestPaletteColor(cell.average, candidates).id;
}
function reduceSpeckles(cells, width, height, strength, candidates) {
    const iterations = Math.max(0, Math.min(4, Math.round(strength)));
    if (iterations === 0)
        return cells;
    const colorMap = new Map(candidates.map((color) => [color.id, color]));
    let next = cells.slice();
    for (let pass = 0; pass < iterations; pass += 1) {
        const current = next;
        next = current.slice();
        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                const index = y * width + x;
                const colorId = current[index];
                if (!colorId)
                    continue;
                const neighbors = neighborColorIds(current, width, height, x, y);
                const sameCount = neighbors.filter((item) => item === colorId).length;
                const majority = majorityColor(neighbors);
                if (!majority.colorId)
                    continue;
                if (!areSimilarColors(colorMap.get(colorId), colorMap.get(majority.colorId), strength, false))
                    continue;
                const requiredMajority = iterations >= 4 ? (pass === 0 ? 3 : 4) : pass === 0 ? 4 : 5;
                const sameLimit = iterations >= 4 ? (pass === 0 ? 2 : 1) : pass === 0 ? 1 : 0;
                if (sameCount <= sameLimit && majority.count >= requiredMajority) {
                    next[index] = majority.colorId;
                }
            }
        }
    }
    return next;
}
function reduceTinyRegions(cells, width, height, strength, candidates) {
    const level = Math.max(0, Math.min(4, Math.round(strength)));
    const maxRegionSize = [0, 1, 2, 5, 9][level];
    if (maxRegionSize <= 0)
        return cells;
    const colorMap = new Map(candidates.map((color) => [color.id, color]));
    const next = cells.slice();
    const visited = new Uint8Array(cells.length);
    const offsets = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
    ];
    for (let start = 0; start < cells.length; start += 1) {
        const colorId = cells[start];
        if (!colorId || visited[start])
            continue;
        const region = [];
        const borderCounts = new Map();
        const queue = [start];
        visited[start] = 1;
        for (let cursor = 0; cursor < queue.length; cursor += 1) {
            const index = queue[cursor];
            region.push(index);
            const x = index % width;
            const y = Math.floor(index / width);
            offsets.forEach(([dx, dy]) => {
                const nx = x + dx;
                const ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= width || ny >= height)
                    return;
                const neighborIndex = ny * width + nx;
                const neighborColorId = cells[neighborIndex];
                if (neighborColorId === colorId && !visited[neighborIndex]) {
                    visited[neighborIndex] = 1;
                    queue.push(neighborIndex);
                    return;
                }
                if (neighborColorId && neighborColorId !== colorId) {
                    borderCounts.set(neighborColorId, (borderCounts.get(neighborColorId) ?? 0) + 1);
                }
            });
        }
        if (region.length > maxRegionSize || borderCounts.size === 0)
            continue;
        const replacement = [...borderCounts.entries()]
            .sort((a, b) => b[1] - a[1])
            .find(([neighborColorId]) => areSimilarColors(colorMap.get(colorId), colorMap.get(neighborColorId), strength, true))?.[0];
        if (!replacement)
            continue;
        region.forEach((index) => {
            next[index] = replacement;
        });
    }
    return next;
}
function mergeSimilarColors(cells, strength, candidates) {
    const level = Math.max(0, Math.min(4, Math.round(strength)));
    if (level === 0)
        return cells;
    const colorMap = new Map(candidates.map((color) => [color.id, color]));
    const counts = new Map();
    cells.forEach((colorId) => {
        if (!colorId)
            return;
        counts.set(colorId, (counts.get(colorId) ?? 0) + 1);
    });
    const rows = [...counts.entries()]
        .flatMap(([colorId, count]) => {
        const color = colorMap.get(colorId);
        return color ? [{ colorId, color, count }] : [];
    })
        .sort((a, b) => b.count - a.count);
    const total = rows.reduce((sum, row) => sum + row.count, 0);
    const replacements = new Map();
    rows.forEach((row, index) => {
        const rare = row.count <= Math.max(3, total * (0.006 + level * 0.003));
        const target = rows.slice(0, index).find((candidate) => areSimilarColors(row.color, candidate.color, level, rare));
        if (target)
            replacements.set(row.colorId, replacements.get(target.colorId) ?? target.colorId);
    });
    if (replacements.size === 0)
        return cells;
    return cells.map((colorId) => (colorId ? replacements.get(colorId) ?? colorId : null));
}
function areSimilarColors(from, to, strength, rare) {
    if (!from || !to || from.id === to.id)
        return false;
    const level = Math.max(0, Math.min(4, Math.round(strength)));
    const baseThreshold = [0, 26, 42, 62, 84][level];
    if (baseThreshold <= 0)
        return false;
    const fromChroma = colorChroma(from.rgb);
    const toChroma = colorChroma(to.rgb);
    const fromLuminance = luminance(from.rgb);
    const toLuminance = luminance(to.rgb);
    const distance = colorDistance(from.rgb, to.rgb);
    const saturationMismatch = Math.abs(fromChroma - toChroma);
    const luminanceMismatch = Math.abs(fromLuminance - toLuminance);
    const bothDark = fromLuminance < 84 && toLuminance < 84;
    const bothLightNeutral = fromLuminance > 188 && toLuminance > 188 && fromChroma < 46 && toChroma < 46;
    const bothMuted = fromLuminance > 96 && toLuminance > 96 && fromChroma < 82 && toChroma < 82;
    let threshold = baseThreshold * (rare ? 1.45 : 1);
    if (bothDark || bothLightNeutral || bothMuted)
        threshold *= 1.15;
    if (fromChroma > 78 || toChroma > 78)
        threshold *= 0.7;
    if (saturationMismatch > 56)
        threshold *= 0.58;
    if (luminanceMismatch > 86 && !bothDark)
        threshold *= 0.55;
    return distance <= threshold;
}
function neighborColorIds(cells, width, height, x, y) {
    const result = [];
    for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0)
                continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height)
                continue;
            result.push(cells[ny * width + nx]);
        }
    }
    return result;
}
function majorityColor(colors) {
    const counts = new Map();
    colors.forEach((colorId) => {
        if (!colorId)
            return;
        counts.set(colorId, (counts.get(colorId) ?? 0) + 1);
    });
    return [...counts.entries()]
        .map(([colorId, count]) => ({ colorId, count }))
        .sort((a, b) => b.count - a.count)[0] ?? { colorId: null, count: 0 };
}
// 「去除背景」的背景判定：从图像四边向内做 flood fill（四连通），
// 只有与边缘连通、且颜色接近背景色（容差内）的区域才算背景。
// 这样被主体颜色包住的白色/近白色像素（眼睛高光、衣服白条等）不会被误判成空。
function computeBackgroundMask(data, width, height, backgroundColor, tolerance) {
    const total = width * height;
    // 0 = 未访问（主体），1 = 与边缘连通的背景，2 = 已访问但不是背景色
    const mask = new Uint8Array(total);
    const queue = new Int32Array(total);
    let head = 0;
    let tail = 0;
    const pushIfBackground = (x, y) => {
        const index = y * width + x;
        if (mask[index] !== 0)
            return;
        const offset = index * 4;
        if (data[offset + 3] >= 24 && !isColorWithinTolerance(data, offset, backgroundColor, tolerance)) {
            mask[index] = 2;
            return;
        }
        mask[index] = 1;
        queue[tail] = index;
        tail += 1;
    };
    for (let x = 0; x < width; x += 1) {
        pushIfBackground(x, 0);
        pushIfBackground(x, height - 1);
    }
    for (let y = 0; y < height; y += 1) {
        pushIfBackground(0, y);
        pushIfBackground(width - 1, y);
    }
    while (head < tail) {
        const index = queue[head];
        head += 1;
        const x = index % width;
        const y = (index - x) / width;
        if (x > 0)
            pushIfBackground(x - 1, y);
        if (x < width - 1)
            pushIfBackground(x + 1, y);
        if (y > 0)
            pushIfBackground(x, y - 1);
        if (y < height - 1)
            pushIfBackground(x, y + 1);
    }
    return mask;
}
function isColorWithinTolerance(data, offset, backgroundColor, tolerance) {
    return (Math.sqrt((data[offset] - backgroundColor[0]) ** 2 +
        (data[offset + 1] - backgroundColor[1]) ** 2 +
        (data[offset + 2] - backgroundColor[2]) ** 2) <= tolerance);
}
/** 自动容差：扫描候选值，取「背景面积已经基本涨到位」的最小一档 */
const AUTO_TOLERANCE_CANDIDATES = [4, 8, 12, 16, 20, 24, 28, 32];
/** 背景占比超过这个比例，说明已经抠过头（正常图背景不该占这么多），必须收紧 */
const AUTO_TOLERANCE_MAX_COVERAGE = 0.8;
/** 容差再往上加、背景面积也只涨这么一点点，就认为已经「涨到位」了 */
const AUTO_TOLERANCE_PLATEAU = 0.02;
/** 校准用降采样后的最长边（够判断连通性，又足够快） */
const AUTO_TOLERANCE_SAMPLE_SIDE = 320;
/**
 * 自动挑一个「不会把主体内部的白色也当背景」的容差。
 *
 * 原理：容差从 0 往上加，背景面积会平稳增长；一旦容差大到能穿过主体与背景之间的
 * 软过渡边缘（AI 图里白衣服贴白背景、没有深色描边时很常见），背景就会「泄漏」进主体，
 * 面积突然暴涨。取暴涨之前最大的一档，就能既抠干净背景、又不吃掉主体白色。
 *
 * 这个结果会直接写回界面上的滑条，也就是「滑条 = 实际生效值」。
 * 用户手动拖过之后就不再自动校准（由调用方通过 calibrate 开关控制）。
 */
function calibrateTolerance(data, width, height, backgroundColor, requestedTolerance) {
    if (requestedTolerance <= AUTO_TOLERANCE_CANDIDATES[0])
        return requestedTolerance;
    // 降采样，加速。
    // 注意：不能简单取一个像素代表整块 —— 那会把「主体与背景之间的软过渡边缘」洗淡，
    // 导致校准图上的连通性和全分辨率不一致。这里每块取「离背景色最远的那个像素」，
    // 相当于保留最硬的边缘，让校准结果与真实处理一致。
    const scale = Math.min(1, AUTO_TOLERANCE_SAMPLE_SIDE / Math.max(width, height));
    const sw = Math.max(8, Math.round(width * scale));
    const sh = Math.max(8, Math.round(height * scale));
    const small = new Uint8ClampedArray(sw * sh * 3);
    const blockW = Math.max(1, Math.floor(width / sw));
    const blockH = Math.max(1, Math.floor(height / sh));
    const dist2 = (r, g, b) => ((r - backgroundColor[0]) ** 2 + (g - backgroundColor[1]) ** 2 + (b - backgroundColor[2]) ** 2);
    for (let y = 0; y < sh; y += 1) {
        for (let x = 0; x < sw; x += 1) {
            const x0 = Math.min(width - 1, x * blockW);
            const y0 = Math.min(height - 1, y * blockH);
            let bestDist = -1;
            let bestR = backgroundColor[0];
            let bestG = backgroundColor[1];
            let bestB = backgroundColor[2];
            for (let yy = y0; yy < Math.min(height, y0 + blockH); yy += 1) {
                for (let xx = x0; xx < Math.min(width, x0 + blockW); xx += 1) {
                    const s = (yy * width + xx) * 4;
                    const dd = dist2(data[s], data[s + 1], data[s + 2]);
                    if (dd > bestDist) {
                        bestDist = dd;
                        bestR = data[s];
                        bestG = data[s + 1];
                        bestB = data[s + 2];
                    }
                }
            }
            const dst = (y * sw + x) * 3;
            small[dst] = bestR;
            small[dst + 1] = bestG;
            small[dst + 2] = bestB;
        }
    }
    /** 在降采样图上做一次 flood fill，返回背景占比 */
    const coverageAt = (tolerance) => {
        const total = sw * sh;
        const mask = new Uint8Array(total);
        const queue = new Int32Array(total);
        let head = 0;
        let tail = 0;
        const within = (index) => {
            const o = index * 3;
            return (Math.sqrt((small[o] - backgroundColor[0]) ** 2 +
                (small[o + 1] - backgroundColor[1]) ** 2 +
                (small[o + 2] - backgroundColor[2]) ** 2) <= tolerance);
        };
        const push = (x, y) => {
            const index = y * sw + x;
            if (mask[index] !== 0)
                return;
            if (!within(index)) {
                mask[index] = 2;
                return;
            }
            mask[index] = 1;
            queue[tail] = index;
            tail += 1;
        };
        for (let x = 0; x < sw; x += 1) {
            push(x, 0);
            push(x, sh - 1);
        }
        for (let y = 0; y < sh; y += 1) {
            push(0, y);
            push(sw - 1, y);
        }
        while (head < tail) {
            const index = queue[head];
            head += 1;
            const x = index % sw;
            const y = (index - x) / sw;
            if (x > 0)
                push(x - 1, y);
            if (x < sw - 1)
                push(x + 1, y);
            if (y > 0)
                push(x, y - 1);
            if (y < sh - 1)
                push(x, y + 1);
        }
        let count = 0;
        for (let i = 0; i < total; i += 1)
            if (mask[i] === 1)
                count += 1;
        return count / total;
    };
    let best = AUTO_TOLERANCE_CANDIDATES[0];
    let prev = 0;
    for (const candidate of AUTO_TOLERANCE_CANDIDATES) {
        if (candidate > requestedTolerance)
            break;
        const coverage = coverageAt(candidate);
        // 抠过头了（背景占了画面绝大部分）→ 这一档不能要，退回上一档
        if (coverage > AUTO_TOLERANCE_MAX_COVERAGE)
            return best;
        // 这一档比上一档没多抠出多少 → 说明已经涨到位，上一档就是最小够用的容差
        if (candidate !== AUTO_TOLERANCE_CANDIDATES[0] && coverage - prev <= AUTO_TOLERANCE_PLATEAU) {
            return best;
        }
        best = candidate;
        prev = coverage;
    }
    return best;
}
const HIGHLIGHT_CORE_LUMA = 205; // 高光核心像素的亮度下限（真高光基本是过曝白点）
const HIGHLIGHT_BRIGHT_LUMA = 150; // 连通判定用的「亮像素」亮度下限
const HIGHLIGHT_SURROUND_LUMA = 150; // 紧邻一圈平均亮度超过它 → 身处大面积亮区，直接淘汰
const HIGHLIGHT_DARK_LUMA = 120; // 环状邻域里算「暗」的亮度上限
const HIGHLIGHT_MIN_DARK_SHARE = 0.6; // 环状邻域中暗像素的最低占比
const HIGHLIGHT_MAX_RING_LUMA = 110; // 环状邻域平均亮度上限
const HIGHLIGHT_MIN_CONTRAST = 85; // 高光与环状邻域的最小亮度差
const HIGHLIGHT_MIN_QUADRANT_SHARE = 0.5; // 四个象限各自也要够暗，挡住「暗区边缘的亮点」
const LIGHT_BEAD_LUMA_RATIO = 0.75; // 「浅色拼豆」的相对亮度下限（0~1）
const DARK_BEAD_LUMA_RATIO = 0.35; // 「暗色拼豆」的相对亮度上限，用来确认邻域真的在眼睛里
function protectEyeHighlights(cells, data, sourceWidth, sourceHeight, width, height, candidates, activePalette) {
    const highlightColor = pickHighlightColor(candidates, activePalette);
    if (!highlightColor)
        return cells;
    const points = detectEyeHighlights(data, sourceWidth, sourceHeight);
    if (points.length === 0)
        return cells;
    const colorMap = new Map(candidates.map((color) => [color.id, color]));
    const maxKeep = Math.max(2, Math.min(8, Math.ceil((width * height) / 500)));
    // 按原图比例映射到网格；同一只眼睛（网格上相邻）里的多个亮点只保留最强的一个，
    // 免得把一整块眼睛点成一排白豆
    const accepted = [];
    [...points]
        .sort((a, b) => b.score - a.score)
        .forEach((point) => {
        if (accepted.length >= maxKeep)
            return;
        const gx = Math.min(width - 1, Math.max(0, Math.floor((point.x / sourceWidth) * width)));
        const gy = Math.min(height - 1, Math.max(0, Math.floor((point.y / sourceHeight) * height)));
        if (accepted.some((item) => Math.abs(item.gx - gx) <= 1 && Math.abs(item.gy - gy) <= 1))
            return;
        accepted.push({ gx, gy });
    });
    const placements = [];
    accepted.forEach(({ gx, gy }) => {
        // 3×3 邻域里已经有浅色拼豆 → 这只眼睛已经有亮点了，不再重复加白
        if (hasLightBeadNearby(cells, width, height, gx, gy, colorMap))
            return;
        const target = highlightTargetIndex(cells, width, height, gx, gy, colorMap);
        // 该处是空格（背景 / 已被抠除）时不补豆，避免凭空造出一颗漂浮的白点
        if (target !== null)
            placements.push(target);
    });
    if (placements.length === 0)
        return cells;
    const next = cells.slice();
    placements.forEach((index) => {
        next[index] = highlightColor.id;
    });
    return next;
}
// 在原图全分辨率像素上找高光：亮度接近白、被一圈明显更暗的像素包围、面积很小。
// 面积上限 + 暗环判定一起把「白衣服 / 白背景 / 大片亮区」挡在高光之外。
function detectEyeHighlights(data, sourceWidth, sourceHeight) {
    const total = sourceWidth * sourceHeight;
    const luma = new Uint8Array(total);
    for (let index = 0; index < total; index += 1) {
        const offset = index * 4;
        // 透明像素按「暗」处理，与 backgroundMask 里的 alpha < 24 判定保持一致
        luma[index] =
            data[offset + 3] < 24
                ? 0
                : Math.round(0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2]);
    }
    const points = [];
    const visited = new Uint8Array(total);
    const maxArea = Math.max(24, Math.min(400, Math.round(total * 0.0005)));
    const windowHalf = Math.ceil(Math.sqrt(maxArea)) + 4;
    const radii = highlightRingRadii(sourceWidth, sourceHeight);
    const queue = [];
    for (let start = 0; start < total; start += 1) {
        if (visited[start] || luma[start] < HIGHLIGHT_CORE_LUMA)
            continue;
        const startX = start % sourceWidth;
        const startY = (start - startX) / sourceWidth;
        // 快筛：紧邻一圈就已经很亮 → 这是大面积亮区的内部，不是高光点
        if (surroundLuma(luma, sourceWidth, sourceHeight, startX, startY) > HIGHLIGHT_SURROUND_LUMA) {
            visited[start] = 1;
            continue;
        }
        // 有界涨水：只在小窗口内聚合亮像素，超出面积上限或贴到窗口边界都判为「大亮区」
        queue.length = 0;
        queue.push(start);
        visited[start] = 1;
        let area = 0;
        let sumX = 0;
        let sumY = 0;
        let peak = 0;
        let tooBig = false;
        for (let cursor = 0; cursor < queue.length; cursor += 1) {
            const index = queue[cursor];
            const x = index % sourceWidth;
            const y = (index - x) / sourceWidth;
            area += 1;
            sumX += x;
            sumY += y;
            if (luma[index] > peak)
                peak = luma[index];
            if (area > maxArea) {
                tooBig = true;
                break;
            }
            for (let dy = -1; dy <= 1 && !tooBig; dy += 1) {
                for (let dx = -1; dx <= 1; dx += 1) {
                    if (dx === 0 && dy === 0)
                        continue;
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx < 0 || ny < 0 || nx >= sourceWidth || ny >= sourceHeight)
                        continue;
                    const neighbor = ny * sourceWidth + nx;
                    if (visited[neighbor] || luma[neighbor] < HIGHLIGHT_BRIGHT_LUMA)
                        continue;
                    if (Math.abs(nx - startX) > windowHalf || Math.abs(ny - startY) > windowHalf) {
                        tooBig = true;
                        break;
                    }
                    visited[neighbor] = 1;
                    queue.push(neighbor);
                }
            }
        }
        if (tooBig || area === 0)
            continue;
        const centerX = Math.round(sumX / area);
        const centerY = Math.round(sumY / area);
        const ring = firstDarkRing(luma, data, sourceWidth, sourceHeight, centerX, centerY, radii);
        if (ring === null)
            continue;
        points.push({ x: centerX, y: centerY, score: (peak - ring.mean) * Math.sqrt(area) });
    }
    return points;
}
// 高光有大有小，按原图尺寸取几档环半径，从最紧的一圈开始试（最紧那圈就暗，说明确实是暗底上的亮点）
function highlightRingRadii(sourceWidth, sourceHeight) {
    const base = Math.max(2, Math.round(Math.min(sourceWidth, sourceHeight) / 256));
    return [base, base + 1, base + 3];
}
// 高光种子周围（切比雪夫距离 2 的 8 个点）的平均亮度
function surroundLuma(luma, sourceWidth, sourceHeight, x, y) {
    let count = 0;
    let sum = 0;
    const offsets = [
        [-2, 0],
        [2, 0],
        [0, -2],
        [0, 2],
        [-2, -2],
        [2, -2],
        [-2, 2],
        [2, 2],
    ];
    offsets.forEach(([dx, dy]) => {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= sourceWidth || ny >= sourceHeight)
            return;
        sum += luma[ny * sourceWidth + nx];
        count += 1;
    });
    return count > 0 ? sum / count : 255;
}
// 环状邻域统计：返回第一个满足「足够暗 + 与高光对比足够大」的半径，都不满足则为 null
function firstDarkRing(luma, data, sourceWidth, sourceHeight, centerX, centerY, radii) {
    const centerLuma = luma[centerY * sourceWidth + centerX];
    for (const radius of radii) {
        const inner = Math.max(2, radius - 1);
        let count = 0;
        let sum = 0;
        let dark = 0;
        // 四个象限各自统计：高光必须被暗色「围住」，而不是只挨着一片暗区
        const quadrantTotal = [0, 0, 0, 0];
        const quadrantDark = [0, 0, 0, 0];
        for (let dy = -radius; dy <= radius; dy += 1) {
            for (let dx = -radius; dx <= radius; dx += 1) {
                const ring = Math.max(Math.abs(dx), Math.abs(dy));
                if (ring < inner || ring > radius)
                    continue;
                const nx = centerX + dx;
                const ny = centerY + dy;
                if (nx < 0 || ny < 0 || nx >= sourceWidth || ny >= sourceHeight)
                    continue;
                const index = ny * sourceWidth + nx;
                if (data[index * 4 + 3] < 24)
                    continue; // 透明像素不算暗环
                const quadrant = (dx >= 0 ? 1 : 0) + (dy >= 0 ? 2 : 0);
                const isDark = luma[index] <= HIGHLIGHT_DARK_LUMA;
                count += 1;
                sum += luma[index];
                quadrantTotal[quadrant] += 1;
                if (isDark) {
                    dark += 1;
                    quadrantDark[quadrant] += 1;
                }
            }
        }
        if (count < 8)
            continue;
        const mean = sum / count;
        const darkShare = dark / count;
        if (darkShare < HIGHLIGHT_MIN_DARK_SHARE)
            continue;
        if (mean > HIGHLIGHT_MAX_RING_LUMA)
            continue;
        if (centerLuma - mean < HIGHLIGHT_MIN_CONTRAST)
            continue;
        // 至少要覆盖 3 个象限，且每个有样本的象限都得有一半以上是暗的
        const coveredQuadrants = quadrantTotal.filter((value) => value > 0).length;
        if (coveredQuadrants < 3)
            continue;
        const allQuadrantsDark = quadrantTotal.every((value, quadrant) => value === 0 || quadrantDark[quadrant] / value >= HIGHLIGHT_MIN_QUADRANT_SHARE);
        if (!allQuadrantsDark)
            continue;
        return { mean, darkShare, radius };
    }
    return null;
}
/**
 * 判断「这只眼睛是不是已经有亮点了」。
 * 注意：不能只看邻域里有没有浅色豆 —— 眼睛外面就是浅色皮肤，
 * 那样会导致高光被误判为「已经有了」而跳过，结果眼睛依旧是黑的。
 * 所以这里要求：既有浅色豆，邻域里又确实存在足够暗的豆（也就是真的在眼睛里）。
 */
function hasLightBeadNearby(cells, width, height, gx, gy, colorMap) {
    let light = 0;
    let dark = 0;
    let present = 0;
    for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
            const x = gx + dx;
            const y = gy + dy;
            if (x < 0 || y < 0 || x >= width || y >= height)
                continue;
            const color = colorMap.get(cells[y * width + x] ?? '');
            if (!color)
                continue;
            present += 1;
            const ratio = relativeLuminance(color.rgb);
            if (ratio > LIGHT_BEAD_LUMA_RATIO)
                light += 1;
            else if (ratio < DARK_BEAD_LUMA_RATIO)
                dark += 1;
        }
    }
    if (light === 0)
        return false;
    // 邻域几乎全是浅色（典型情况：眼睛只占半格，映射落到脸颊皮肤上）→ 认为还没亮点，需要补
    return dark >= 1 && dark / present >= 0.25;
}
// 高光补在哪一格：优先中心格；中心格是空格时退到邻格里最暗的那颗（黑虹膜），没有非空格就放弃
function highlightTargetIndex(cells, width, height, gx, gy, colorMap) {
    const center = gy * width + gx;
    if (cells[center])
        return center;
    let best = null;
    let bestLuma = Number.POSITIVE_INFINITY;
    for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
            const x = gx + dx;
            const y = gy + dy;
            if (x < 0 || y < 0 || x >= width || y >= height)
                continue;
            const index = y * width + x;
            const colorId = cells[index];
            if (!colorId)
                continue;
            const color = colorMap.get(colorId);
            const value = color ? luminance(color.rgb) : 255;
            if (value < bestLuma) {
                bestLuma = value;
                best = index;
            }
        }
    }
    return best;
}
// 挑一枚浅色拼豆：优先当前候选色里最亮的那枚（通常是白）；候选色里没有足够浅的颜色时，
// 再从配色表里补一枚真正的高光色（例如 MARD T1 纯白），都拿不到就放弃保护
function pickHighlightColor(candidates, activePalette) {
    const brightest = (pool) => pool.reduce((best, color) => (luminance(color.rgb) > luminance(best.rgb) ? color : best), pool[0]);
    if (candidates.length > 0 && relativeLuminance(brightest(candidates).rgb) >= 0.7)
        return brightest(candidates);
    const lightColors = activePalette.filter((color) => relativeLuminance(color.rgb) >= 0.85);
    return lightColors.length > 0 ? brightest(lightColors) : null;
}
function relativeLuminance(rgb) {
    return luminance(rgb) / 255;
}
// W0.3：`function luminance` 已搬到 ./luminance（导出名 luminance601）。
// 本文件里的调用点一个字未改，靠上面的 `luminance601 as luminance` 别名接住。
function colorChroma(rgb) {
    return Math.max(...rgb) - Math.min(...rgb);
}
function simplifySourceRgb(rgb, strength) {
    const level = Math.max(0, Math.min(4, Math.round(strength)));
    if (level === 0)
        return rgb;
    const channelStep = [1, 5, 9, 14, 20][level];
    const neutralThreshold = [0, 8, 14, 20, 28][level];
    const chroma = colorChroma(rgb);
    if (chroma <= neutralThreshold) {
        const value = quantizeChannel(luminance(rgb), channelStep);
        return [value, value, value];
    }
    return [
        quantizeChannel(rgb[0], channelStep),
        quantizeChannel(rgb[1], channelStep),
        quantizeChannel(rgb[2], channelStep),
    ];
}
function quantizeChannel(value, step) {
    return Math.max(0, Math.min(255, Math.round(value / step) * step));
}
function clampStrength(value) {
    return Math.max(0, Math.min(4, Math.round(value)));
}
function estimateBackgroundColor(data, width, height) {
    const samples = [];
    const maxSamplesPerEdge = 80;
    const xStep = Math.max(1, Math.floor(width / maxSamplesPerEdge));
    const yStep = Math.max(1, Math.floor(height / maxSamplesPerEdge));
    for (let x = 0; x < width; x += xStep) {
        pushOpaqueSample(samples, data, width, x, 0);
        pushOpaqueSample(samples, data, width, x, height - 1);
    }
    for (let y = 0; y < height; y += yStep) {
        pushOpaqueSample(samples, data, width, 0, y);
        pushOpaqueSample(samples, data, width, width - 1, y);
    }
    if (samples.length === 0)
        return [255, 255, 255];
    const buckets = new Map();
    samples.forEach((rgb) => {
        const key = rgb.map((channel) => Math.round(channel / 16) * 16).join(',');
        const bucket = buckets.get(key) ?? { rgb: [0, 0, 0], count: 0 };
        bucket.rgb[0] += rgb[0];
        bucket.rgb[1] += rgb[1];
        bucket.rgb[2] += rgb[2];
        bucket.count += 1;
        buckets.set(key, bucket);
    });
    const best = [...buckets.values()].sort((a, b) => b.count - a.count)[0];
    return [
        Math.round(best.rgb[0] / best.count),
        Math.round(best.rgb[1] / best.count),
        Math.round(best.rgb[2] / best.count),
    ];
}
function pushOpaqueSample(samples, data, width, x, y) {
    const index = (y * width + x) * 4;
    if (data[index + 3] < 24)
        return;
    samples.push([data[index], data[index + 1], data[index + 2]]);
}
//# sourceMappingURL=imageToBeads.js.map