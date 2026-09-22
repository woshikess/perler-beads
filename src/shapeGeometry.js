/**
 * 纯几何 / 光栅化计算：形状点集、文字光栅化、多边形判定、坐标辅助线、亮度取色。
 *
 * W0.2 从 `WorkspaceCanvas.tsx` **纯搬迁**（只加 `export` 与 import，未改一字）：
 *   L1029–1047 `collectShapeIndices`
 *   L1049–1056 `uniqueInBounds`
 *   L1058–1191 `TextGlyph` + `textPatternCache`/`textGlyphCache` + `collectTextIndices` /
 *               `rasterizeTextPoints` / `rasterizeTextGlyph` / `glyphVisibleHeight`
 *   L1193–1609 图形点集族（`linePoints` … `pointInPolygon`）
 *   L1611–1617 `hexToRgba`
 *   L2274–2287 `guideLineCenters`
 *   L2314–2317 `isLightColor`
 *   L2435–2438 `readableTextColor`
 *
 * ⚠️ 下面两个亮度函数用的是**两套不同公式**，各自的阈值是按各自公式标定的：
 *   `isLightColor`      = **Rec.709**（0.2126/0.7152/0.0722），阈值 `> 218`
 *   `readableTextColor` = **Rec.601**（0.299/0.587/0.114），阈值 `< 130`
 *   **禁止合并、禁止互换**（总任务书 W0.3 红线）。
 *
 * W0.3：两个函数**内部**的亮度表达式改成调用 `./luminance` 的 `luminance709` / `luminance601`
 * （原先 `isLightColor` 的那条 709 与 `layerAdjustments.ts` 的 `rgbLuminance` 是同一个公式的
 * 两份写法）。**只换了取值的来源，两个函数签名、阈值、阈值单位一律未动。**
 */
import { luminance601, luminance709 } from './luminance.js';
export function collectShapeIndices(kind, fillMode, arrowKind, start, end, width, height) {
    const add = (points) => uniqueInBounds(points, width, height);
    const squareEnd = constrainToSquare(start, end);
    if (kind === 'line')
        return add(linePoints(start.x, start.y, end.x, end.y));
    if (kind === 'rectangle')
        return add(fillMode === 'filled' ? filledRectanglePoints(start.x, start.y, end.x, end.y) : rectanglePoints(start.x, start.y, end.x, end.y));
    if (kind === 'square')
        return add(fillMode === 'filled' ? filledRectanglePoints(start.x, start.y, squareEnd.x, squareEnd.y) : rectanglePoints(start.x, start.y, squareEnd.x, squareEnd.y));
    if (kind === 'ellipse')
        return add(fillMode === 'filled' ? filledEllipsePoints(start.x, start.y, end.x, end.y) : ellipsePoints(start.x, start.y, end.x, end.y));
    if (kind === 'circle')
        return add(fillMode === 'filled' ? filledCirclePoints(start.x, start.y, squareEnd.x, squareEnd.y) : circlePoints(start.x, start.y, squareEnd.x, squareEnd.y));
    if (kind === 'triangle')
        return add(fillMode === 'filled' ? filledTrianglePoints(start.x, start.y, end.x, end.y) : trianglePoints(start.x, start.y, end.x, end.y));
    return add(arrowPoints(start.x, start.y, end.x, end.y, arrowKind));
}
export function uniqueInBounds(points, width, height) {
    const seen = new Set();
    points.forEach(({ x, y }) => {
        if (x < 0 || y < 0 || x >= width || y >= height)
            return;
        seen.add(y * width + x);
    });
    return [...seen];
}
export const textPatternCache = new Map();
export const textGlyphCache = new Map();
export function collectTextIndices(value, direction, size, spacing, startX, startY, width, height) {
    const points = rasterizeTextPoints(value, direction, size, spacing).map((point) => ({
        x: startX + point.x,
        y: startY + point.y,
    }));
    return uniqueInBounds(points, width, height);
}
export function rasterizeTextPoints(value, direction, size, spacing) {
    const text = value.trim().length > 0 ? value : 'ABC';
    const normalizedText = text.replace(/\r/g, '');
    const normalizedSpacing = Math.max(0, Math.round(spacing));
    const key = `${direction}:${size}:${normalizedSpacing}:${normalizedText}`;
    const cached = textPatternCache.get(key);
    if (cached)
        return cached;
    const points = [];
    if (direction === 'vertical') {
        let yCursor = 0;
        Array.from(normalizedText.replace(/\n/g, '')).forEach((char) => {
            const glyph = rasterizeTextGlyph(char, size);
            glyph.points.forEach((point) => points.push({ x: point.x, y: yCursor + point.y }));
            yCursor += glyphVisibleHeight(glyph) + normalizedSpacing;
        });
    }
    else {
        let yCursor = 0;
        normalizedText.split('\n').forEach((line) => {
            let xCursor = 0;
            let lineHeight = size;
            Array.from(line.length > 0 ? line : ' ').forEach((char) => {
                const glyph = rasterizeTextGlyph(char, size);
                glyph.points.forEach((point) => points.push({ x: xCursor + point.x, y: yCursor + point.y }));
                xCursor += glyph.width + normalizedSpacing;
                lineHeight = Math.max(lineHeight, glyph.height);
            });
            yCursor += lineHeight + normalizedSpacing;
        });
    }
    if (textPatternCache.size > 80)
        textPatternCache.clear();
    textPatternCache.set(key, points);
    return points;
}
export function rasterizeTextGlyph(char, size) {
    const normalizedSize = Math.max(5, Math.round(size));
    if (char === ' ') {
        return { points: [], width: Math.max(2, Math.round(normalizedSize * 0.45)), height: normalizedSize };
    }
    const key = `${normalizedSize}:${char}`;
    const cached = textGlyphCache.get(key);
    if (cached)
        return cached;
    const cellPixel = 5;
    const fontSize = Math.max(16, Math.round(normalizedSize * cellPixel));
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context)
        return { points: [], width: normalizedSize, height: normalizedSize };
    const font = `500 ${fontSize}px Arial, "Microsoft YaHei", "PingFang SC", sans-serif`;
    context.font = font;
    const metrics = context.measureText(char);
    const padding = cellPixel * 3;
    canvas.width = Math.max(cellPixel * 2, Math.ceil(metrics.width + padding * 2));
    canvas.height = Math.max(cellPixel * 2, Math.ceil(fontSize * 1.32 + padding * 2));
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.font = font;
    context.fillStyle = '#ffffff';
    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    context.fillText(char, padding, padding + fontSize);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const cols = Math.ceil(canvas.width / cellPixel);
    const rows = Math.ceil(canvas.height / cellPixel);
    const raw = [];
    for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
            let alphaTotal = 0;
            let samples = 0;
            const fromX = col * cellPixel;
            const fromY = row * cellPixel;
            const toX = Math.min(canvas.width, fromX + cellPixel);
            const toY = Math.min(canvas.height, fromY + cellPixel);
            for (let y = fromY; y < toY; y += 1) {
                for (let x = fromX; x < toX; x += 1) {
                    alphaTotal += data[(y * canvas.width + x) * 4 + 3];
                    samples += 1;
                }
            }
            if (samples > 0 && alphaTotal / (samples * 255) > 0.3)
                raw.push({ x: col, y: row });
        }
    }
    if (raw.length === 0) {
        return { points: [], width: Math.max(1, Math.ceil(metrics.width / cellPixel)), height: normalizedSize };
    }
    const minX = Math.min(...raw.map((point) => point.x));
    const maxX = Math.max(...raw.map((point) => point.x));
    const lineTop = Math.max(0, Math.floor(padding / cellPixel));
    const points = raw
        .map((point) => ({ x: point.x - minX, y: point.y - lineTop }))
        .filter((point) => point.y >= 0);
    const glyphHeight = Math.max(normalizedSize + 2, ...points.map((point) => point.y + 1));
    const glyph = { points, width: maxX - minX + 1, height: glyphHeight };
    if (textGlyphCache.size > 160)
        textGlyphCache.clear();
    textGlyphCache.set(key, glyph);
    return glyph;
}
export function glyphVisibleHeight(glyph) {
    if (glyph.points.length === 0)
        return glyph.height;
    const minY = Math.min(...glyph.points.map((point) => point.y));
    const maxY = Math.max(...glyph.points.map((point) => point.y));
    return Math.max(1, maxY - minY + 1);
}
export function linePoints(x0, y0, x1, y1) {
    const points = [];
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const steps = Math.max(dx, dy, 1);
    for (let step = 0; step <= steps; step += 1) {
        points.push({
            x: Math.round(x0 + ((x1 - x0) * step) / steps),
            y: Math.round(y0 + ((y1 - y0) * step) / steps),
        });
    }
    return points;
}
export function rectanglePoints(x0, y0, x1, y1) {
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);
    const points = [];
    for (let x = minX; x <= maxX; x += 1) {
        points.push({ x, y: minY }, { x, y: maxY });
    }
    for (let y = minY + 1; y < maxY; y += 1) {
        points.push({ x: minX, y }, { x: maxX, y });
    }
    return points;
}
export function filledRectanglePoints(x0, y0, x1, y1) {
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);
    const points = [];
    for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1)
            points.push({ x, y });
    }
    return points;
}
export function constrainToSquare(start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const size = Math.max(0, Math.min(Math.abs(dx), Math.abs(dy)));
    return {
        x: start.x + Math.sign(dx || 1) * size,
        y: start.y + Math.sign(dy || 1) * size,
    };
}
export function ellipsePoints(x0, y0, x1, y1) {
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);
    const width = maxX - minX;
    const height = maxY - minY;
    if (width <= 1 || height <= 1)
        return rectanglePoints(x0, y0, x1, y1);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const rx = Math.max(1, Math.round(width / 2));
    const ry = Math.max(1, Math.round(height / 2));
    return midpointEllipsePoints(cx, cy, rx, ry);
}
export function circlePoints(x0, y0, x1, y1) {
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);
    const size = Math.min(maxX - minX, maxY - minY);
    if (size <= 1)
        return rectanglePoints(x0, y0, x1, y1);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const radius = Math.max(1, Math.round(size / 2));
    return midpointCirclePoints(cx, cy, radius);
}
export function midpointCirclePoints(cx, cy, radius) {
    const points = [];
    let x = radius;
    let y = 0;
    let decision = 1 - radius;
    while (x >= y) {
        pushSymmetricCirclePoints(points, cx, cy, x, y);
        y += 1;
        if (decision < 0) {
            decision += 2 * y + 1;
        }
        else {
            x -= 1;
            decision += 2 * (y - x) + 1;
        }
    }
    return points;
}
export function midpointEllipsePoints(cx, cy, rx, ry) {
    const points = [];
    const rx2 = rx * rx;
    const ry2 = ry * ry;
    let x = 0;
    let y = ry;
    let px = 0;
    let py = 2 * rx2 * y;
    let p = ry2 - rx2 * ry + 0.25 * rx2;
    while (px < py) {
        pushSymmetricEllipsePoints(points, cx, cy, x, y);
        x += 1;
        px += 2 * ry2;
        if (p < 0) {
            p += ry2 + px;
        }
        else {
            y -= 1;
            py -= 2 * rx2;
            p += ry2 + px - py;
        }
    }
    p = ry2 * (x + 0.5) * (x + 0.5) + rx2 * (y - 1) * (y - 1) - rx2 * ry2;
    while (y >= 0) {
        pushSymmetricEllipsePoints(points, cx, cy, x, y);
        y -= 1;
        py -= 2 * rx2;
        if (p > 0) {
            p += rx2 - py;
        }
        else {
            x += 1;
            px += 2 * ry2;
            p += rx2 - py + px;
        }
    }
    return points;
}
export function pushSymmetricCirclePoints(points, cx, cy, x, y) {
    points.push({ x: Math.round(cx + x), y: Math.round(cy + y) }, { x: Math.round(cx + y), y: Math.round(cy + x) }, { x: Math.round(cx - y), y: Math.round(cy + x) }, { x: Math.round(cx - x), y: Math.round(cy + y) }, { x: Math.round(cx - x), y: Math.round(cy - y) }, { x: Math.round(cx - y), y: Math.round(cy - x) }, { x: Math.round(cx + y), y: Math.round(cy - x) }, { x: Math.round(cx + x), y: Math.round(cy - y) });
}
export function pushSymmetricEllipsePoints(points, cx, cy, x, y) {
    points.push({ x: Math.round(cx + x), y: Math.round(cy + y) }, { x: Math.round(cx - x), y: Math.round(cy + y) }, { x: Math.round(cx + x), y: Math.round(cy - y) }, { x: Math.round(cx - x), y: Math.round(cy - y) });
}
export function filledEllipsePoints(x0, y0, x1, y1) {
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);
    const width = maxX - minX;
    const height = maxY - minY;
    if (width <= 1 || height <= 1)
        return filledRectanglePoints(x0, y0, x1, y1);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const rx = Math.max(0.5, width / 2);
    const ry = Math.max(0.5, height / 2);
    const points = [];
    const edgeBias = 1.02;
    for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
            const nx = (x - cx) / rx;
            const ny = (y - cy) / ry;
            if (nx * nx + ny * ny <= edgeBias)
                points.push({ x, y });
        }
    }
    return points;
}
export function filledCirclePoints(x0, y0, x1, y1) {
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);
    const size = Math.min(maxX - minX, maxY - minY);
    if (size <= 1)
        return filledRectanglePoints(x0, y0, x1, y1);
    const cx = Math.round((minX + maxX) / 2);
    const cy = Math.round((minY + maxY) / 2);
    const radius = Math.max(1, Math.round(size / 2));
    const points = [];
    const limit = (radius + 0.2) * (radius + 0.2);
    for (let y = cy - radius; y <= cy + radius; y += 1) {
        for (let x = cx - radius; x <= cx + radius; x += 1) {
            const dx = x - cx;
            const dy = y - cy;
            if (dx * dx + dy * dy <= limit)
                points.push({ x, y });
        }
    }
    return points;
}
export function trianglePoints(x0, y0, x1, y1) {
    const vertices = triangleVertices(x0, y0, x1, y1);
    return [...linePoints(vertices.apex.x, vertices.apex.y, vertices.left.x, vertices.left.y), ...linePoints(vertices.left.x, vertices.left.y, vertices.right.x, vertices.right.y), ...linePoints(vertices.right.x, vertices.right.y, vertices.apex.x, vertices.apex.y)];
}
export function filledTrianglePoints(x0, y0, x1, y1) {
    const vertices = triangleVertices(x0, y0, x1, y1);
    return [...filledPolygonPoints([vertices.apex, vertices.left, vertices.right]), ...polygonEdgePoints([vertices.apex, vertices.left, vertices.right])];
}
export function triangleVertices(x0, y0, x1, y1) {
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);
    const width = maxX - minX;
    const centerX = minX + Math.round(width / 2);
    return {
        apex: { x: centerX, y: minY },
        left: { x: minX, y: maxY },
        right: { x: maxX, y: maxY },
    };
}
export function arrowPoints(x0, y0, x1, y1, arrowKind) {
    if (arrowKind === 'block')
        return blockArrowPoints(x0, y0, x1, y1);
    const stair = stairArrowPoints(x0, y0, x1, y1, arrowKind);
    if (stair)
        return stair;
    const shaft = linePoints(x0, y0, x1, y1);
    const dx = x1 - x0;
    const dy = y1 - y0;
    const length = Math.max(1, Math.hypot(dx, dy));
    const ux = dx / length;
    const uy = dy / length;
    const headLength = Math.max(2, Math.min(6, Math.round(length * 0.32)));
    const wing = Math.max(1, Math.round(headLength * 0.65));
    const baseX = Math.round(x1 - ux * headLength);
    const baseY = Math.round(y1 - uy * headLength);
    const perpX = -uy;
    const perpY = ux;
    return [
        ...shaft,
        ...linePoints(x1, y1, Math.round(baseX + perpX * wing), Math.round(baseY + perpY * wing)),
        ...linePoints(x1, y1, Math.round(baseX - perpX * wing), Math.round(baseY - perpY * wing)),
        ...(arrowKind === 'double'
            ? [
                ...linePoints(x0, y0, Math.round(x0 + ux * headLength + perpX * wing), Math.round(y0 + uy * headLength + perpY * wing)),
                ...linePoints(x0, y0, Math.round(x0 + ux * headLength - perpX * wing), Math.round(y0 + uy * headLength - perpY * wing)),
            ]
            : []),
    ];
}
export function stairArrowPoints(x0, y0, x1, y1, arrowKind) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const length = Math.max(Math.abs(dx), Math.abs(dy));
    if (length < 3)
        return null;
    const headSize = Math.max(2, Math.min(7, Math.round(length * 0.28)));
    if (Math.abs(dx) >= Math.abs(dy) * 2) {
        const dir = Math.sign(dx || 1);
        const centerY = Math.round((y0 + y1) / 2);
        const tipX = x1;
        const shaftStart = arrowKind === 'double' ? x0 + dir * headSize : x0;
        const shaftEnd = x1;
        const points = linePoints(shaftStart, centerY, shaftEnd, centerY);
        points.push(...stairArrowHeadPoints(tipX, centerY, dir, 0, headSize));
        if (arrowKind === 'double')
            points.push(...stairArrowHeadPoints(x0, centerY, -dir, 0, headSize));
        return points;
    }
    if (Math.abs(dy) >= Math.abs(dx) * 2) {
        const dir = Math.sign(dy || 1);
        const centerX = Math.round((x0 + x1) / 2);
        const tipY = y1;
        const shaftStart = arrowKind === 'double' ? y0 + dir * headSize : y0;
        const shaftEnd = y1;
        const points = linePoints(centerX, shaftStart, centerX, shaftEnd);
        points.push(...stairArrowHeadPoints(centerX, tipY, 0, dir, headSize));
        if (arrowKind === 'double')
            points.push(...stairArrowHeadPoints(centerX, y0, 0, -dir, headSize));
        return points;
    }
    return null;
}
export function stairArrowHeadPoints(tipX, tipY, dirX, dirY, size) {
    const points = [];
    for (let step = 0; step <= size; step += 1) {
        if (dirX !== 0) {
            points.push({ x: tipX - dirX * step, y: tipY - step }, { x: tipX - dirX * step, y: tipY + step });
        }
        else {
            points.push({ x: tipX - step, y: tipY - dirY * step }, { x: tipX + step, y: tipY - dirY * step });
        }
    }
    return points;
}
export function blockArrowPoints(x0, y0, x1, y1) {
    const cardinal = cardinalBlockArrowPoints(x0, y0, x1, y1);
    if (cardinal)
        return cardinal;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const length = Math.max(1, Math.hypot(dx, dy));
    const ux = dx / length;
    const uy = dy / length;
    const perpX = -uy;
    const perpY = ux;
    const thickness = Math.max(1, Math.round(length * 0.12));
    const headLength = Math.max(2, Math.min(8, Math.round(length * 0.34)));
    const headWidth = Math.max(thickness + 1, Math.round(length * 0.26));
    const shaftEnd = {
        x: x1 - ux * headLength,
        y: y1 - uy * headLength,
    };
    const shaft = [
        { x: x0 + perpX * thickness, y: y0 + perpY * thickness },
        { x: shaftEnd.x + perpX * thickness, y: shaftEnd.y + perpY * thickness },
        { x: shaftEnd.x - perpX * thickness, y: shaftEnd.y - perpY * thickness },
        { x: x0 - perpX * thickness, y: y0 - perpY * thickness },
    ];
    const head = [
        { x: x1, y: y1 },
        { x: shaftEnd.x + perpX * headWidth, y: shaftEnd.y + perpY * headWidth },
        { x: shaftEnd.x - perpX * headWidth, y: shaftEnd.y - perpY * headWidth },
    ];
    return [...filledPolygonPoints(shaft), ...filledPolygonPoints(head), ...polygonEdgePoints(shaft), ...polygonEdgePoints(head)];
}
export function cardinalBlockArrowPoints(x0, y0, x1, y1) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const length = Math.max(Math.abs(dx), Math.abs(dy));
    if (length < 4)
        return null;
    const thickness = Math.max(1, Math.round(length * 0.12));
    const headSize = Math.max(thickness + 2, Math.min(9, Math.round(length * 0.28)));
    const points = [];
    if (Math.abs(dx) >= Math.abs(dy) * 2) {
        const dir = Math.sign(dx || 1);
        const centerY = Math.round((y0 + y1) / 2);
        const shaftEnd = x1 - dir * headSize;
        for (let y = centerY - thickness; y <= centerY + thickness; y += 1) {
            const from = Math.min(x0, shaftEnd);
            const to = Math.max(x0, shaftEnd);
            for (let x = from; x <= to; x += 1)
                points.push({ x, y });
        }
        for (let offset = -headSize; offset <= headSize; offset += 1) {
            const baseX = x1 - dir * headSize;
            const edgeX = x1 - dir * Math.abs(offset);
            const from = Math.min(baseX, edgeX);
            const to = Math.max(baseX, edgeX);
            for (let x = from; x <= to; x += 1)
                points.push({ x, y: centerY + offset });
        }
        return points;
    }
    if (Math.abs(dy) >= Math.abs(dx) * 2) {
        const dir = Math.sign(dy || 1);
        const centerX = Math.round((x0 + x1) / 2);
        const shaftEnd = y1 - dir * headSize;
        for (let x = centerX - thickness; x <= centerX + thickness; x += 1) {
            const from = Math.min(y0, shaftEnd);
            const to = Math.max(y0, shaftEnd);
            for (let y = from; y <= to; y += 1)
                points.push({ x, y });
        }
        for (let offset = -headSize; offset <= headSize; offset += 1) {
            const baseY = y1 - dir * headSize;
            const edgeY = y1 - dir * Math.abs(offset);
            const from = Math.min(baseY, edgeY);
            const to = Math.max(baseY, edgeY);
            for (let y = from; y <= to; y += 1)
                points.push({ x: centerX + offset, y });
        }
        return points;
    }
    return null;
}
export function filledPolygonPoints(vertices) {
    const minX = Math.floor(Math.min(...vertices.map((point) => point.x)));
    const maxX = Math.ceil(Math.max(...vertices.map((point) => point.x)));
    const minY = Math.floor(Math.min(...vertices.map((point) => point.y)));
    const maxY = Math.ceil(Math.max(...vertices.map((point) => point.y)));
    const points = [];
    for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
            if (pointInPolygon(x, y, vertices))
                points.push({ x, y });
        }
    }
    return points;
}
export function polygonEdgePoints(vertices) {
    const points = [];
    vertices.forEach((point, index) => {
        const next = vertices[(index + 1) % vertices.length];
        points.push(...linePoints(Math.round(point.x), Math.round(point.y), Math.round(next.x), Math.round(next.y)));
    });
    return points;
}
export function pointInPolygon(x, y, vertices) {
    let inside = false;
    for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i, i += 1) {
        const a = vertices[i];
        const b = vertices[j];
        const intersects = a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y || 1) + a.x;
        if (intersects)
            inside = !inside;
    }
    return inside;
}
export function hexToRgba(hex, alpha) {
    const value = hex.replace('#', '');
    const r = Number.parseInt(value.slice(0, 2), 16);
    const g = Number.parseInt(value.slice(2, 4), 16);
    const b = Number.parseInt(value.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
export function guideLineCenters(totalCells, boardCells, cellSize) {
    const centers = new Set();
    const boardSize = Math.max(1, boardCells);
    for (let boardStart = 0; boardStart < totalCells; boardStart += boardSize) {
        const segmentLength = Math.min(boardSize, totalCells - boardStart);
        for (let offset = 1; offset < segmentLength; offset += 5) {
            centers.add((boardStart + offset) * cellSize);
        }
        if (segmentLength > 1) {
            centers.add((boardStart + segmentLength - 1) * cellSize);
        }
    }
    return [...centers].sort((a, b) => a - b);
}
export function isLightColor(rgb) {
    const luminance = luminance709(rgb);
    return luminance > 218;
}
export function readableTextColor(rgb) {
    const luminance = luminance601(rgb);
    return luminance < 130 ? '#ffffff' : '#111827';
}
//# sourceMappingURL=shapeGeometry.js.map