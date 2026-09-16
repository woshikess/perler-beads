import { paletteVersion } from './palette.js';
export const autosaveKey = 'perler-beads-generator:draft';
export function createProject(width = 52, height = 52, name = 'Untitled Pattern') {
    const now = new Date().toISOString();
    const cells = emptyCells(width, height);
    return {
        version: '1.0.0',
        name,
        width,
        height,
        activeBrand: 'MARD',
        paletteVersion,
        cells,
        layers: [
            {
                id: 'base',
                name: 'Pattern',
                customName: false,
                visible: true,
                locked: false,
                includeInUsage: true,
                opacity: 1,
                cells,
            },
        ],
        activeLayerId: 'base',
        settings: {
            showGrid: true,
            showCoordinates: true,
            showPegboardBoundaries: true,
            showLayerOverlap: false,
            showActiveLayerOnly: false,
            showColorCodes: false,
            beadDisplayMode: 'bead',
            beadsPerPack: 500,
            rightClickAction: 'pan',
        },
        boardSettings: {
            boardWidth: 52,
            boardHeight: 52,
            showBoardIds: true,
        },
        createdAt: now,
        updatedAt: now,
    };
}
export function withCells(project, cells, width = project.width, height = project.height) {
    const normalizedCells = normalizeCells(cells, width, height);
    const layers = normalizeLayers(project, width, height).map((layer) => layer.id === project.activeLayerId && !layer.locked ? { ...layer, cells: normalizedCells } : layer);
    return {
        ...project,
        width,
        height,
        cells: composeVisibleCells(layers, width, height),
        layers,
        updatedAt: new Date().toISOString(),
    };
}
export function createLayer(width, height, name) {
    return {
        id: `layer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name,
        customName: false,
        visible: true,
        locked: false,
        includeInUsage: true,
        opacity: 1,
        cells: emptyCells(width, height),
    };
}
export function withLayers(project, layers, activeLayerId = project.activeLayerId) {
    const normalizedLayers = normalizeLayers({ ...project, layers }, project.width, project.height);
    const nextActiveLayerId = normalizedLayers.some((layer) => layer.id === activeLayerId)
        ? activeLayerId
        : normalizedLayers[0]?.id ?? 'base';
    return {
        ...project,
        layers: normalizedLayers,
        activeLayerId: nextActiveLayerId,
        cells: composeVisibleCells(normalizedLayers, project.width, project.height),
        updatedAt: new Date().toISOString(),
    };
}
export function composeVisibleCells(layers, width, height) {
    const result = emptyCells(width, height);
    for (const layer of layers) {
        if (!layer.visible)
            continue;
        const cells = normalizeCells(layer.cells, width, height);
        cells.forEach((cell, index) => {
            if (cell)
                result[index] = cell;
        });
    }
    return result;
}
export function normalizeProject(project) {
    const width = Number.isFinite(project.width) ? project.width : 29;
    const height = Number.isFinite(project.height) ? project.height : 29;
    const fallback = createProject(width, height, project.name);
    const settings = {
        ...fallback.settings,
        ...project.settings,
        showColorCodes: Boolean(project.settings?.showColorCodes || project.settings?.beadDisplayMode === 'print'),
        beadDisplayMode: project.settings?.beadDisplayMode === 'pixel' ? 'pixel' : 'bead',
    };
    const layers = normalizeLayers({
        ...fallback,
        ...project,
        settings,
        boardSettings: { ...fallback.boardSettings, ...project.boardSettings },
        layers: project.layers?.length ? project.layers : fallback.layers,
    }, width, height);
    return {
        ...fallback,
        ...project,
        width,
        height,
        activeBrand: 'MARD',
        settings,
        boardSettings: { ...fallback.boardSettings, ...project.boardSettings },
        layers,
        activeLayerId: layers.some((layer) => layer.id === project.activeLayerId) ? project.activeLayerId : layers[0].id,
        cells: composeVisibleCells(layers, width, height),
    };
}
function normalizeLayers(project, width, height) {
    const legacyCells = normalizeCells(project.cells, width, height);
    const sourceLayers = project.layers?.length ? project.layers : createProject(width, height).layers;
    return sourceLayers.map((layer, index) => ({
        ...layer,
        customName: Boolean(layer.customName),
        cells: normalizeCells(layer.cells ?? (index === 0 ? legacyCells : []), width, height),
    }));
}
function normalizeCells(cells, width, height) {
    const length = width * height;
    const next = Array.from({ length }, (_, index) => cells?.[index] ?? null);
    return next;
}
function emptyCells(width, height) {
    return Array.from({ length: width * height }, () => null);
}
export function saveDraft(project) {
    localStorage.setItem(autosaveKey, JSON.stringify(project));
}
export function loadDraft() {
    try {
        const raw = localStorage.getItem(autosaveKey);
        if (!raw)
            return null;
        const parsed = JSON.parse(raw);
        if (!parsed.width || !parsed.height || !Array.isArray(parsed.cells))
            return null;
        return normalizeProject(parsed);
    }
    catch {
        localStorage.removeItem(autosaveKey);
        return null;
    }
}
//# sourceMappingURL=project.js.map