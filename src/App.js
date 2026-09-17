import WorkspaceCanvas from './WorkspaceCanvas.js';
import ThreePreview from './ThreePreview.js';
import { AI_PROBE_TIMEOUT_MS, AI_REDRAW_TIMEOUT_MS, ARK_ENDPOINT, buildPrompt, calcSize } from './arkDirect.js';
import { ARK_LINKS, classifyAiProbe, formatRawBits, probeBody, probeInputFromResponse } from './arkDiagnostics.js';
import { downloadPrintPdf, downloadPrintPng, downloadProjectJson, downloadUsageWorkbook } from './exporters.js';
import { imageFileToBeads } from './imageToBeads.js';
import { basicPalette, colorDistance, completePalette, getColor, nearestPaletteColor } from './palette.js';
import { composeVisibleCells, createLayer, createProject, loadDraft, normalizeProject, saveDraft, withCells, withLayers } from './project.js';
import { findIsolatedBeads, summarizeUsage } from './usage.js';
const { useEffect, useMemo, useRef, useState } = React;
const languageKey = 'perler-beads-generator:language';
const ui = {
    zh: {
        appName: '克斯拼豆图纸生成器',
        board: '拼豆板',
        apply: '应用',
        commonSizes: '常用尺寸',
        rightClick: '右键',
        rightClickHint: '右键平移用于拖动画布；右键擦除只清除落点格子，不受橡皮大小影响。',
        pan: '平移',
        erase: '擦除',
        new: '新建',
        clear: '清空',
        undo: '撤销',
        redo: '重做',
        exportPatternFull: '导出图纸',
        exportUsageFull: '导出用量',
        exportRecordFull: '导出编辑',
        importRecordFull: '导入编辑',
        exportPatternTitle: '导出图纸',
        exportUsageTitle: '导出用量清单 Excel',
        exportRecordTitle: '导出编辑记录 JSON',
        importRecordTitle: '导入历史记录 JSON',
        usageExported: '用量清单 Excel 已导出。',
        recordExported: '编辑记录 JSON 已导出。',
        recordImported: '编辑记录已导入，可继续编辑。',
        invalidRecord: '这个文件不是有效的拼豆编辑记录。',
        unreadableRecord: '无法读取这个编辑记录 JSON。',
        printExportSettings: '图纸设置',
        showColorCodes: '显示色号',
        showGuideLines: '辅助线',
        projectNickname: '作品昵称',
        authorNickname: '作者昵称',
        exportFormat: '导出格式',
        exportBounds: '导出范围',
        exportPatternBounds: '图案尺寸',
        exportCanvasBounds: '画布尺寸',
        optional: '可选',
        exportNow: '导出',
        preview3d: '3D 预览',
        liveBoard: '实时画板视图',
        previewEmpty: '暂无 3D 预览',
        imageToPattern: '导入图片生成',
        aiRedrawTitle: 'AI 生成',
        aiRedrawCost: '约 0.3-0.6 元/张',
        aiRedrawStart: '开始生成',
        aiRedrawRegenerate: '重新生成',
        aiHistoryLabel: '图源历史',
        aiHistoryTitle: 'AI 图',
        aiHistoryOriginal: '原图',
        aiHistoryOriginalShort: '原',
        aiBackground: 'AI 图的背景',
        aiModelLabel: '模型',
        aiModelHint: '默认 doubao-seedream-5-0-pro-260628。若报「模型未开通（ModelNotOpen）」，去火山方舟控制台开通该模型，或在这里换成你已开通的模型 ID。',
        aiRedrawHint: '用 AI 把原图重绘成 Q 版像素画，再生成拼豆图纸。适合真人照片；扁平色块插画不建议开启。每次点击都会产生费用。',
        patternParams: '参数调节',
        paramsLocalNote: '改动后自动更新',
        autoRefreshConfirm: '检测到图纸已被手动修改。改参数会自动重新生成图纸，手动修改的部分将会丢失。确定继续吗？',
        copyError: '复制详情',
        aiRedrawNeedKey: '请先填写 API Key',
        aiRedrawRunning: 'AI 正在重绘，约需 60-90 秒…',
        aiRedrawKeyLabel: 'API Key',
        aiRedrawKeyPlaceholder: '粘贴你的 Ark API Key（ark- 开头）',
        aiRedrawKeySaved: 'Key 已保存在本机浏览器，下次自动填充',
        // ── 降低 AI 门槛：可选说明 / 检查清单 / 测试连接 ──
        aiOptionalLine1: 'AI 是可选的 —— 不填 Key 也能用全部核心能力：图片转图纸、编辑、用量清单、导出。',
        aiOptionalLine2: '想用 AI 重绘？需要自己的火山方舟 Key：需实名认证，约 0.3–0.6 元/张（充 10 元大约能玩 20–30 张）。',
        aiChecklistTitle: '不知道怎么弄？点开检查清单',
        aiChecklist: [
            { text: '有火山引擎账号', hint: '打开后是控制台首页；还没账号就在这一页注册（手机号即可）。', link: 'console', linkLabel: '去注册 / 登录' },
            { text: '完成实名认证（大陆生成式 AI 服务强制）', hint: '在控制台右上角头像菜单里找「实名认证」；需要身份证 + 人脸核验，一般几分钟就过。', link: 'console', linkLabel: '去实名认证' },
            { text: '开通 doubao-seedream 模型', hint: '页面是一排模型卡片，卡片上有「开通」按钮，点它即可。', link: 'model', linkLabel: '去开通模型' },
            { text: '创建并复制 API Key', hint: '页面上有「创建 API Key」；建好后会显示一串 ark- 开头的字符，点复制。', link: 'apiKey', linkLabel: '去创建 Key' },
            { text: '把 Key 粘到下面的输入框，再点「测试连接」', hint: 'Key 只存在你自己的浏览器里，不会上传到任何服务器。', link: null, linkLabel: '' },
        ],
        aiProbeButton: '测试连接（不花钱）',
        aiProbeRunning: '正在检测…',
        aiProbeRetest: '重新检测',
        aiProbeNeedKey: '请先在上面填好 API Key，再点测试。',
        aiProbeText: {
            ok: { title: '✅ 通道正常，可以开始生成了', steps: ['直接点下面的「AI 重绘」就行，约 0.3–0.6 元/张。'] },
            'model-not-open': { title: '⚠️ 还差一步：这个模型还没开通', steps: ['点下面的「去开通模型」打开开通页', '找到 {model}，点「开通」', '回来再点一次「测试连接」'], link: 'model' },
            'model-not-found': { title: '❌ 模型 ID 不对', steps: ['展开下面的「模型设置」', '确认那里的 ID 与你在控制台开通的完全一致', '再点一次「测试连接」'], link: 'model' },
            'bad-key': { title: '❌ 连不上：最可能是 Key 不对', steps: ['点下面的「去复制 API Key」，重新复制一次（ark- 开头）', '粘回上面的输入框（前后不要有空格）', '再点一次「测试连接」', '换了新 Key 还是不行，就确认网络能访问 ark.cn-beijing.volces.com（公司网络 / 代理有时会挡）'], link: 'apiKey' },
            timeout: { title: '⚠️ 检测超时', steps: ['方舟服务可能繁忙，或网络不稳', '等十几秒，再点一次「测试连接」'] },
            'rate-limited': { title: '⚠️ 调用上限或额度不足', steps: ['去控制台看这个模型的用量与额度，需要就调整上限或充值', '这次请求没有生成图片，不扣费', '调整后回来再点一次「测试连接」'], link: 'console' },
            policy: { title: '⚠️ 被内容审核拦下', steps: ['动漫 / 影视版权角色最容易被拦（迪士尼、宝可梦这类）', '换一张图，或把「AI 图的背景」改成「保留背景」再试'] },
            'server-error': { title: '⚠️ 方舟服务端出错', steps: ['这是对方的问题，不是你配置错了', '等一两分钟，再点一次「测试连接」'] },
            'bad-request': { title: '⚠️ 请求参数被拒', steps: ['通常是图片尺寸不合规', '换一张图片，或把「AI 图的背景」改成「保留背景」再试'] },
            unknown: { title: '❌ 没见过的错误', steps: ['把下面的原始信息发给开发者'] },
        },
        aiExamplesTitle: '先看看 AI 重绘值不值这道门槛',
        aiExamplesCaption: '每组从左到右：原图 → AI 重绘 → 拼豆图纸（52 格）',
        aiExampleCaptions: ['真人照片', '动漫设定图', '纯色背景人像'],
        aiLinkApiKey: '去复制 API Key',
        aiLinkModel: '去开通模型',
        aiLinkConsole: '去打开控制台',
        aiRedrawFailed: 'AI 重绘失败',
        referenceImage: '参考图',
        uploadReferenceImage: '上传参考图',
        showReferenceImage: '显示参考图',
        referenceOpacity: '透明度',
        referenceAdjust: '拖动/缩放',
        referenceAdjustHint: '正在拖动/缩放参考图',
        resetReferenceTransform: '重置位置',
        referencePlacement: '显示位置',
        referenceBelow: '拼豆下方',
        referenceAbove: '拼豆上方',
        referenceHint: '作为临摹底稿',
        ready: '已选择',
        noImage: '未选择图片',
        uploadImage: '上传图片',
        width: '宽度',
        colors: '色数上限',
        colorsHint: '生成时使用的拼豆颜色数量上限；数值越低越简洁，越高越细腻。',
        generationStyle: '生成风格',
        generationStyleCartoon: '卡通',
        generationStyleRealistic: '写实',
        tolerance: '容差',
        toleranceAutoNote: '当前 {v} 是工具自动算出来的最合适值（既能抠干净背景，又不会吃掉主体上的白色）。觉得不合适可以直接拖。',
        toleranceManualNote: '已手动设置，工具不再自动校准。',
        toleranceHint: '容差越大，越多接近背景色的像素会被去除；容差越小，边缘保留越多。第一次出图纸时工具会自动算一个合适值，之后你可以自己拖。',
        background: '背景',
        keepBackground: '保留背景',
        removeWhite: '去除背景',
        preparingPattern: '正在生成图案',
        autoGenerateHint: '调整参数后会自动更新画布。',
        autoRefreshHint: '改动参数后会自动重新生成图纸。若图纸已被手动绘制修改，会先弹出确认再重算。',
        palette: '调色盘',
        adjustments: '调整',
        adjustmentTitle: '当前图层调整',
        brightness: '亮度',
        contrast: '对比度',
        saturation: '饱和度',
        temperature: '色温',
        hue: '色相',
        resetAdjustments: '重置调整',
        adjustmentHint: '滑动会直接调整当前图层，可用撤销恢复。',
        adjustmentLocked: '当前图层已锁定，无法应用调整。',
        colorCleanup: '颜色整理',
        colorCleanupHint: '合并相近色，减少碎色。',
        applyColorCleanup: '整理相近颜色',
        colorLimit: '色数上限',
        colorLimitHint: '限制当前图层颜色数。',
        applyColorLimit: '应用色数上限',
        layerColorsCleaned: (count) => (count > 0 ? `已整理 ${count} 颗拼豆。` : '当前图层没有需要整理的相近颜色。'),
        layerColorsLimited: (count, limit) => (count > 0 ? `已将当前图层限制到最多 ${limit} 色。` : `当前图层已经不超过 ${limit} 色。`),
        effects: '效果',
        invertEffect: '反色',
        grayscaleEffect: '灰阶',
        blackWhiteEffect: '黑白',
        effectApplied: (name, count) => `已应用${name}，影响 ${count} 颗拼豆。`,
        mardBasic: 'MARD 基础版（221色）',
        mardComplete: 'MARD 完整版（291色）',
        recentColors: '最近使用',
        layers: '图层',
        addLayer: '新建图层',
        deleteLayer: '删除',
        duplicateLayer: '复制图层',
        renameLayer: '重命名图层',
        reorderLayer: '拖动调整图层顺序',
        activeLayer: '当前图层',
        hiddenLayer: '已隐藏',
        lockedLayer: '已锁定',
        layerBeadCount: (count) => `${count} 颗`,
        usage: '用量',
        totalBeadsLabel: '总颗数',
        colorTypes: '颜色数',
        estimatedPacks: '预计包数',
        beadsPerPack: '每包数量',
        perPackUnit: '颗/包',
        countedLayerTitle: '计入图层',
        countAllLayers: '全部图层',
        countCurrentLayer: '当前图层',
        packUnit: '包',
        noUsage: '暂无用量',
        brandCodes: '色号品牌',
        view: '视图',
        beadShape: '豆子形状',
        roundBeads: '圆形',
        squareBeads: '方形',
        layerOverlap: '重叠格子',
        showActiveLayerOnly: '只看当前图层',
        grid: '网格',
        coordinates: '坐标',
        countLayer: '计入用量',
        eye: '显示',
        lock: '锁定',
        unlock: '解锁',
        lockHint: '锁定后无法在这一层绘制或擦除',
        unlockHint: '解锁后可以继续编辑这一层',
        lockedCanvasHint: '当前图层已锁定',
        manyColors: '颜色较多，可以降低颜色数量。',
        countedLayers: (count) => `已计入 ${count} 个图层`,
        noCountedLayers: '没有图层计入用量。',
        cell: '格子',
        hoverBoard: '移动到画布上',
        empty: '空',
        language: '语言',
        fit: '适配',
        close: '关闭',
        expandPreview: '放大 3D 预览',
        workspaceReady: '工作区已就绪。',
        heightFromRatio: '高度将按图片比例计算。',
        status: (width, height, beads, colors) => `${width} * ${height} - ${beads} 颗 - ${colors} 色`,
        panelStatus: (width, height, colors, beads, boards) => `${width} * ${height} - ${colors} 色 - ${beads} 颗 - ${boards} 块板`,
        isolatedBeads: (count) => (count > 0 ? `${count} 颗拼豆无相邻，熨烫时留意。` : '没有无相邻拼豆。'),
        showIsolatedBeads: '显示无相邻拼豆',
        hideIsolatedBeads: '隐藏无相邻拼豆',
        eraserSize: '橡皮大小',
        removeScope: '消除范围',
        removeSameConnected: '同色连续',
        removeAllSameColor: '所有同色',
        removeConnected: '连续块',
        moveScope: '选中范围',
        moveLayer: '全图层',
        movePartial: '局部',
        panToolHint: '提示：使用其他工具时，右键默认用于拖动画布',
        mirrorDirection: '镜像方向',
        mirrorHorizontal: '左右',
        mirrorVertical: '上下',
        shapeType: '形状',
        shapeStyle: '样式',
        shapeOutline: '空心',
        shapeFilled: '实心',
        shapeLine: '直线',
        shapeRectangle: '矩形',
        shapeSquare: '正方',
        shapeEllipse: '椭圆',
        shapeCircle: '正圆',
        shapeTriangle: '三角',
        shapeArrow: '箭头',
        arrowStyle: '箭头',
        arrowSingle: '单向',
        arrowDouble: '双向',
        arrowBlock: '粗箭头',
        textContent: '文字内容',
        textDirection: '排列方向',
        textHorizontal: '横排',
        textVertical: '竖排',
        textSize: '文字高度',
        textSpacing: '文字间距',
        textPlaceholder: '文字 / 数字 / 字母 / 符号',
        clipboardPreview: '剪贴预览',
        clipboardEmpty: React.createElement(React.Fragment, null,
            "\u5148\u7528\u590D\u5236\u5DE5\u5177\u9009\u62E9",
            React.createElement("br", null),
            "\u590D\u5236\u8303\u56F4"),
        clipboardSize: (width, height, beads) => `${width} * ${height} - ${beads} 颗`,
        resetClipboard: '重置剪贴预览',
        copyScope: '复制范围',
        copyConnected: '连续块',
        copySelection: '多选拼豆',
        copySelectionHint: '左键选择或取消要复制的拼豆',
        copiedPattern: (width, height, beads) => `已复制 ${width} * ${height} 图案，${beads} 颗。`,
        copySelectionUpdated: (beads) => `已选择 ${beads} 颗拼豆。`,
        clipboardReset: '剪贴预览已重置。',
        pastedPattern: '已粘贴图案。',
        recoloredBeads: (count) => `已替换 ${count} 颗同色拼豆。`,
        brushCells: (count) => `${formatBrushSize(count)} 格`,
        tools: {
            pencil: { title: '画笔', hint: '绘制拼豆' },
            eraser: { title: '橡皮', hint: '清除格子' },
            fill: { title: '填充', hint: '填充区域' },
            remove: { title: '消除', hint: '清除连续区域' },
            recolor: { title: '换色', hint: '替换同色拼豆' },
            eyedropper: { title: '吸管', hint: '拾取颜色' },
            move: { title: '移动', hint: '移动当前图层图案' },
            copy: { title: '复制', hint: '复制连续图案' },
            paste: { title: '粘贴', hint: '粘贴已复制图案' },
            mirror: { title: '镜像', hint: '翻转当前图层图案' },
            shape: { title: '形状', hint: '绘制基础几何图形' },
            text: { title: '文字', hint: '插入点阵文字' },
            pan: { title: '拖动', hint: '拖动画布' },
        },
    },
    en: {
        appName: "Kesi's Perler Beads Generator",
        board: 'Pegboard',
        apply: 'Apply',
        commonSizes: 'Common sizes',
        rightClick: 'Right click',
        rightClickHint: 'Right-click pan drags the canvas; right-click erase clears only the pointed cell and ignores eraser size.',
        pan: 'Pan',
        erase: 'Erase',
        new: 'New',
        clear: 'Clear',
        undo: 'Undo',
        redo: 'Redo',
        exportPatternFull: 'Export pattern',
        exportUsageFull: 'Export usage',
        exportRecordFull: 'Export edit',
        importRecordFull: 'Import edit',
        exportPatternTitle: 'Export pattern',
        exportUsageTitle: 'Export usage workbook',
        exportRecordTitle: 'Export edit record JSON',
        importRecordTitle: 'Import edit history JSON',
        usageExported: 'Usage workbook exported.',
        recordExported: 'Edit record JSON exported.',
        recordImported: 'Edit record imported. You can keep editing.',
        invalidRecord: 'This file is not a valid edit record.',
        unreadableRecord: 'Could not read this edit record JSON.',
        printExportSettings: 'Pattern settings',
        showColorCodes: 'Color codes',
        showGuideLines: 'Guide lines',
        projectNickname: 'Pattern name',
        authorNickname: 'Author name',
        exportFormat: 'Export format',
        exportBounds: 'Export bounds',
        exportPatternBounds: 'Pattern size',
        exportCanvasBounds: 'Canvas size',
        optional: 'Optional',
        exportNow: 'Export',
        preview3d: '3D Preview',
        liveBoard: 'Live board view',
        previewEmpty: 'No 3D preview yet',
        imageToPattern: 'Import Image',
        aiRedrawTitle: 'AI Generate',
        aiRedrawCost: '~¥0.3-0.6 / image',
        aiRedrawStart: 'Start',
        aiRedrawRegenerate: 'Regenerate',
        aiBackground: 'AI art background',
        aiModelLabel: 'Model',
        aiModelHint: 'Default is doubao-seedream-5-0-pro-260628. If you get "ModelNotOpen", activate that model in the Ark console, or type a model ID your account has activated.',
        aiHistoryLabel: 'Source history',
        aiHistoryTitle: 'AI art',
        aiHistoryOriginal: 'Original',
        aiHistoryOriginalShort: 'ORIG',
        aiRedrawHint: 'Uses AI to redraw the photo as chibi pixel art before generating the bead pattern. Good for real photos; not recommended for flat-color illustrations. Every click costs money.',
        patternParams: 'Parameters',
        paramsLocalNote: 'Auto-updates on change',
        autoRefreshConfirm: 'The pattern has been manually edited. Changing parameters will regenerate it and your manual edits will be lost. Continue?',
        copyError: 'Copy details',
        aiRedrawNeedKey: 'Please enter your API Key first',
        aiRedrawRunning: 'AI is redrawing, about 60-90 seconds…',
        aiRedrawKeyLabel: 'API Key',
        aiRedrawKeyPlaceholder: 'Paste your Ark API Key (starts with ark-)',
        aiRedrawKeySaved: 'Key saved in this browser, filled automatically next time',
        // ── Lowering the AI barrier: optional notice / checklist / connection test ──
        aiOptionalLine1: 'AI is optional — every core feature works without a key: image to pattern, editing, usage list, exports.',
        aiOptionalLine2: 'Want AI redraw? You need your own Volcengine Ark key: real-name verification required, about ¥0.3–0.6 per image (¥10 gets you roughly 20–30).',
        aiChecklistTitle: "Not sure how? Open the checklist",
        aiChecklist: [
            { text: 'A Volcengine account', hint: 'Opening it lands on the console home; register right there if you have no account (phone number is enough).', link: 'console', linkLabel: 'Sign up / sign in' },
            { text: 'Real-name verification (required for mainland GenAI services)', hint: 'Look for "Real-name verification" under the avatar menu at the top right; ID plus a face check, usually a few minutes.', link: 'console', linkLabel: 'Verify identity' },
            { text: 'Activate a doubao-seedream model', hint: 'The page shows a row of model cards; each has an "Activate" button — click it.', link: 'model', linkLabel: 'Activate model' },
            { text: 'Create and copy an API key', hint: 'There is a "Create API key" button; the key starts with ark- — click copy.', link: 'apiKey', linkLabel: 'Create key' },
            { text: 'Paste the key below, then click "Test connection"', hint: 'The key stays in your own browser and is never uploaded to any server.', link: null, linkLabel: '' },
        ],
        aiProbeButton: 'Test connection (free)',
        aiProbeRunning: 'Checking…',
        aiProbeRetest: 'Check again',
        aiProbeNeedKey: 'Fill in the API key above first, then run the test.',
        aiProbeText: {
            ok: { title: '✅ All good — you can generate now', steps: ['Just click "AI redraw" below; about ¥0.3–0.6 per image.'] },
            'model-not-open': { title: '⚠️ One step left: this model is not activated', steps: ['Click "Activate model" below', 'Find {model} and click "Activate"', 'Come back and click "Test connection" again'], link: 'model' },
            'model-not-found': { title: '❌ Wrong model ID', steps: ['Open "Model settings" below', 'Make sure the ID matches what you activated in the console', 'Click "Test connection" again'], link: 'model' },
            'bad-key': { title: '❌ Cannot reach Ark — most likely a bad key', steps: ['Click "Copy API key" below and copy it again (starts with ark-)', 'Paste it back above (no leading or trailing spaces)', 'Click "Test connection" again', 'If a new key still fails, check that your network can reach ark.cn-beijing.volces.com (office networks and proxies sometimes block it)'], link: 'apiKey' },
            timeout: { title: '⚠️ The check timed out', steps: ['Ark may be busy, or the network is unstable', 'Wait a few seconds and click "Test connection" again'] },
            'rate-limited': { title: '⚠️ Call limit or quota reached', steps: ['Check this model’s usage and quota in the console; raise the limit or top up if needed', 'No image was generated, so this request was not charged', 'Come back and click "Test connection" again'], link: 'console' },
            policy: { title: '⚠️ Blocked by content moderation', steps: ['Anime and film characters are blocked most often (Disney, Pokémon and the like)', 'Try another image, or switch "AI background" to "Keep background"'] },
            'server-error': { title: '⚠️ Ark server error', steps: ['This is on their side, not a mistake in your setup', 'Wait a minute or two and click "Test connection" again'] },
            'bad-request': { title: '⚠️ Request rejected', steps: ['Usually an image size problem', 'Try another image, or switch "AI background" to "Keep background"'] },
            unknown: { title: '❌ Unrecognised error', steps: ['Send the raw details below to the developer'] },
        },
        aiExamplesTitle: 'See whether AI redraw is worth the setup',
        aiExamplesCaption: 'In each row: original → AI redraw → bead pattern (52 cells)',
        aiExampleCaptions: ['Real photo', 'Anime character', 'Studio portrait'],
        aiLinkApiKey: 'Copy API key',
        aiLinkModel: 'Activate model',
        aiLinkConsole: 'Open console',
        aiRedrawFailed: 'AI redraw failed',
        referenceImage: 'Reference Image',
        uploadReferenceImage: 'Upload reference',
        showReferenceImage: 'Show reference',
        referenceOpacity: 'Opacity',
        referenceAdjust: 'Move/scale',
        referenceAdjustHint: 'Moving/scaling reference image',
        resetReferenceTransform: 'Reset position',
        referencePlacement: 'Display position',
        referenceBelow: 'Below beads',
        referenceAbove: 'Above beads',
        referenceHint: 'Tracing guide',
        ready: 'Ready',
        noImage: 'No image',
        uploadImage: 'Upload image',
        width: 'Width',
        colors: 'Color limit',
        colorsHint: 'Maximum bead colors used in generation; lower is simpler, higher keeps more detail.',
        generationStyle: 'Style',
        generationStyleCartoon: 'Cartoon',
        generationStyleRealistic: 'Realistic',
        tolerance: 'Tolerance',
        toleranceAutoNote: 'The current {v} was auto-calculated by the tool (cleans the background without eating white areas inside the subject). Drag it if you disagree.',
        toleranceManualNote: 'Manually set — the tool will not auto-calibrate any more.',
        toleranceHint: 'Higher tolerance removes more pixels close to the background color; lower tolerance keeps more edge detail. The tool calculates a sensible value on the first run; after that you can drag it yourself.',
        background: 'Background',
        keepBackground: 'Keep background',
        removeWhite: 'Remove background',
        preparingPattern: 'Generating pattern',
        autoGenerateHint: 'Changes update the canvas automatically.',
        autoRefreshHint: 'Changing a parameter rebuilds the pattern automatically. If you already painted on it by hand, a confirmation appears first.',
        palette: 'Palette',
        adjustments: 'Adjust',
        adjustmentTitle: 'Active layer adjustment',
        brightness: 'Brightness',
        contrast: 'Contrast',
        saturation: 'Saturation',
        temperature: 'Temperature',
        hue: 'Hue',
        resetAdjustments: 'Reset adjustments',
        adjustmentHint: 'Sliders adjust the active layer directly; Undo can restore it.',
        adjustmentLocked: 'The active layer is locked.',
        colorCleanup: 'Color cleanup',
        colorCleanupHint: 'Merge close colors and reduce speckles.',
        applyColorCleanup: 'Merge close colors',
        colorLimit: 'Color limit',
        colorLimitHint: 'Limit colors in the active layer.',
        applyColorLimit: 'Apply color limit',
        layerColorsCleaned: (count) => (count > 0 ? `${count} beads cleaned up.` : 'No close colors need cleanup in the active layer.'),
        layerColorsLimited: (count, limit) => (count > 0 ? `Active layer limited to ${limit} colors.` : `Active layer already has ${limit} colors or fewer.`),
        effects: 'Effects',
        invertEffect: 'Invert',
        grayscaleEffect: 'Grayscale',
        blackWhiteEffect: 'B/W',
        effectApplied: (name, count) => `${name} applied to ${count} beads.`,
        mardBasic: 'MARD Basic (221 colors)',
        mardComplete: 'MARD Complete (291 colors)',
        recentColors: 'Recent',
        layers: 'Layers',
        addLayer: 'New layer',
        deleteLayer: 'Delete',
        duplicateLayer: 'Duplicate layer',
        renameLayer: 'Rename layer',
        reorderLayer: 'Drag to reorder layer',
        activeLayer: 'Active layer',
        hiddenLayer: 'Hidden',
        lockedLayer: 'Locked',
        layerBeadCount: (count) => `${count} beads`,
        usage: 'Usage',
        totalBeadsLabel: 'Total beads',
        colorTypes: 'Colors',
        estimatedPacks: 'Est. packs',
        beadsPerPack: 'Beads per pack',
        perPackUnit: 'beads/pack',
        countedLayerTitle: 'Counted layers',
        countAllLayers: 'All layers',
        countCurrentLayer: 'Current layer',
        packUnit: 'packs',
        noUsage: 'No usage yet',
        brandCodes: 'Brand codes',
        view: 'View',
        beadShape: 'Bead shape',
        roundBeads: 'Round',
        squareBeads: 'Square',
        layerOverlap: 'Overlap cells',
        showActiveLayerOnly: 'Current layer only',
        grid: 'Grid',
        coordinates: 'Coordinates',
        countLayer: 'Count this layer in usage',
        eye: 'Eye',
        lock: 'Lock',
        unlock: 'Unlock',
        lockHint: 'Lock this layer to prevent drawing or erasing on it',
        unlockHint: 'Unlock this layer to edit it again',
        lockedCanvasHint: 'Current layer is locked',
        manyColors: 'Many colors; consider lowering max colors.',
        countedLayers: (count) => `${count} layers counted`,
        noCountedLayers: 'No layers counted in usage.',
        cell: 'Cell',
        hoverBoard: 'Hover the board',
        empty: 'empty',
        language: 'Language',
        fit: 'Fit',
        close: 'Close',
        expandPreview: 'Expand 3D preview',
        workspaceReady: 'Workspace ready.',
        heightFromRatio: 'Height is calculated from the image ratio.',
        status: (width, height, beads, colors) => `${width} * ${height} - ${beads} beads - ${colors} colors`,
        panelStatus: (width, height, colors, beads, boards) => `${width} * ${height} - ${colors} colors - ${beads} beads - ${boards} boards`,
        isolatedBeads: (count) => (count > 0 ? `${count} beads have no neighbors; watch when fusing.` : 'No beads without neighbors.'),
        showIsolatedBeads: 'Show beads without neighbors',
        hideIsolatedBeads: 'Hide beads without neighbors',
        eraserSize: 'Eraser size',
        removeScope: 'Clear range',
        removeSameConnected: 'Same area',
        removeAllSameColor: 'All same',
        removeConnected: 'Connected',
        moveScope: 'Selection',
        moveLayer: 'Layer',
        movePartial: 'Partial',
        panToolHint: 'Tip: when using other tools, right-click drags the canvas by default.',
        mirrorDirection: 'Mirror',
        mirrorHorizontal: 'Left-right',
        mirrorVertical: 'Up-down',
        shapeType: 'Shape',
        shapeStyle: 'Style',
        shapeOutline: 'Outline',
        shapeFilled: 'Filled',
        shapeLine: 'Line',
        shapeRectangle: 'Rect',
        shapeSquare: 'Square',
        shapeEllipse: 'Oval',
        shapeCircle: 'Circle',
        shapeTriangle: 'Triangle',
        shapeArrow: 'Arrow',
        arrowStyle: 'Arrow',
        arrowSingle: 'Single',
        arrowDouble: 'Double',
        arrowBlock: 'Block',
        textContent: 'Text',
        textDirection: 'Direction',
        textHorizontal: 'Horizontal',
        textVertical: 'Vertical',
        textSize: 'Text height',
        textSpacing: 'Spacing',
        textPlaceholder: 'Text / numbers / letters / symbols',
        clipboardPreview: 'Clipboard',
        clipboardEmpty: 'Copy a pattern first',
        clipboardSize: (width, height, beads) => `${width} * ${height} - ${beads} beads`,
        resetClipboard: 'Reset clipboard preview',
        copyScope: 'Copy range',
        copyConnected: 'Connected',
        copySelection: 'Select beads',
        copySelectionHint: 'Left-click to select or deselect individual beads.',
        copiedPattern: (width, height, beads) => `Copied ${width} x ${height}, ${beads} beads.`,
        copySelectionUpdated: (beads) => `${beads} beads selected.`,
        clipboardReset: 'Clipboard preview reset.',
        pastedPattern: 'Pattern pasted.',
        recoloredBeads: (count) => `${count} matching beads recolored.`,
        brushCells: (count) => `${formatBrushSize(count)} cells`,
        tools: {
            pencil: { title: 'Pencil', hint: 'Paint beads' },
            eraser: { title: 'Eraser', hint: 'Clear cells' },
            fill: { title: 'Fill', hint: 'Fill an area' },
            remove: { title: 'Clear', hint: 'Clear connected area' },
            recolor: { title: 'Recolor', hint: 'Replace matching beads' },
            eyedropper: { title: 'Dropper', hint: 'Pick color' },
            move: { title: 'Move', hint: 'Move active layer artwork' },
            copy: { title: 'Copy', hint: 'Copy connected pattern' },
            paste: { title: 'Paste', hint: 'Paste copied pattern' },
            mirror: { title: 'Mirror', hint: 'Flip active layer artwork' },
            shape: { title: 'Shape', hint: 'Draw basic geometry' },
            text: { title: 'Text', hint: 'Insert dot text' },
            pan: { title: 'Drag', hint: 'Drag canvas' },
        },
    },
};
const tools = [
    { id: 'pencil' },
    { id: 'eraser' },
    { id: 'fill' },
    { id: 'remove' },
    { id: 'recolor' },
    { id: 'eyedropper' },
    { id: 'move' },
    { id: 'copy' },
    { id: 'paste' },
    { id: 'mirror' },
    { id: 'shape' },
    { id: 'text' },
    { id: 'pan' },
];
function formatBrushSize(value) {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
const sizePresets = [
    { label: '52 * 52', width: 52, height: 52 },
    { label: '78 * 78', width: 78, height: 78 },
    { label: '104 * 104', width: 104, height: 104 },
    { label: '156 * 156', width: 156, height: 156 },
];
const defaultImportSettings = {
    width: 52,
    maxColors: 24,
    generationStyle: 'cartoon',
    // 默认「去除背景」：AI 重绘默认抠出纯白底，主体干净；
    // 图纸阶段也默认把白底去成空格（保留背景会让边缘多出一圈碎色）
    backgroundMode: 'remove-white',
    tolerance: 32,
    speckleReduction: 0,
};
/** AI 重绘一次的费用不低，但也不该无限堆，历史最多留这么多张
 *  注意：界面上一行只放得下 5 个缩略图，所以不要超过 5，否则左栏会变高 */
const AI_HISTORY_LIMIT = 5;
/** 默认用的火山方舟模型。不同账号开通的模型不一样，用户可以在「模型设置」里改 */
const DEFAULT_AI_MODEL = 'doubao-seedream-5-0-pro-260628';
/** 下拉里的常用候选（第一个是默认值）。Ark 的模型 ID 更新很快，所以下面的输入框可以随便填 */
const AI_MODEL_PRESETS = [
    'doubao-seedream-5-0-pro-260628',
    'doubao-seedream-4-0-250828',
    'doubao-seedream-3-0-t2i-250628',
];
const defaultColorId = 'mard-h7';
const defaultRecentColorIds = ['mard-h7', 'mard-h2'];
const defaultAdjustments = {
    brightness: 0,
    contrast: 0,
    saturation: 0,
    temperature: 0,
    hue: 0,
};
export default function App() {
    const fileInputRef = useRef(null);
    const referenceInputRef = useRef(null);
    const jsonInputRef = useRef(null);
    const autoGenerateShouldCommitRef = useRef(false);
    const generationRequestRef = useRef(0);
    const adjustmentSessionRef = useRef({ layerId: null, baseCells: [] });
    const soloVisibilitySnapshotRef = useRef(null);
    const [language, setLanguage] = useState(() => (localStorage.getItem(languageKey) === 'en' ? 'en' : 'zh'));
    const text = ui[language];
    const [project, setProject] = useState(() => loadDraft() ?? createProject());
    const [selectedColorId, setSelectedColorId] = useState(defaultColorId);
    const [recentColorIds, setRecentColorIds] = useState(defaultRecentColorIds);
    const [tool, setTool] = useState('pencil');
    const [eraserSize, setEraserSize] = useState(0);
    const [removeMode, setRemoveMode] = useState('same-connected');
    const [moveMode, setMoveMode] = useState('layer');
    const [mirrorMode, setMirrorMode] = useState('layer');
    const [mirrorDirection, setMirrorDirection] = useState('horizontal');
    const [shapeKind, setShapeKind] = useState('line');
    const [shapeFillMode, setShapeFillMode] = useState('outline');
    const [arrowKind, setArrowKind] = useState('single');
    const [textToolValue, setTextToolValue] = useState('ABC');
    const [textToolDirection, setTextToolDirection] = useState('horizontal');
    const [textToolSize, setTextToolSize] = useState(17);
    const [textToolSpacing, setTextToolSpacing] = useState(1);
    const [showPrintExportPanel, setShowPrintExportPanel] = useState(false);
    const [printExportOptions, setPrintExportOptions] = useState({
        format: 'png',
        exportBounds: 'pattern',
        showColorCodes: true,
        showGuideLines: true,
        projectName: '',
        authorName: '',
    });
    const [showPencilOptions, setShowPencilOptions] = useState(false);
    const [showEraserOptions, setShowEraserOptions] = useState(false);
    const [showRemoveOptions, setShowRemoveOptions] = useState(false);
    const [showMoveOptions, setShowMoveOptions] = useState(false);
    const [showMirrorOptions, setShowMirrorOptions] = useState(false);
    const [showShapeOptions, setShowShapeOptions] = useState(false);
    const [showTextOptions, setShowTextOptions] = useState(false);
    const [showClipboardOptions, setShowClipboardOptions] = useState(false);
    const [showPanOptions, setShowPanOptions] = useState(false);
    const [clipboardPattern, setClipboardPattern] = useState(null);
    const [copyMode, setCopyMode] = useState('connected');
    const [copySelectionIndices, setCopySelectionIndices] = useState([]);
    const [pendingFile, setPendingFile] = useState(null);
    const [pendingImageUrl, setPendingImageUrl] = useState(null);
    // AI 重绘：API Key + 是否正在生成
    const [aiApiKey, setAiApiKey] = useState(() => localStorage.getItem('ark-api-key') ?? '');
    // 模型 ID：不同账号开通的模型可能不一样，报 ModelNotOpen 时用户可以在这里换
    const [aiModel, setAiModel] = useState(() => localStorage.getItem('ark-model') ?? DEFAULT_AI_MODEL);
    // 模型设置默认收起，需要时点开
    const [aiModelOpen, setAiModelOpen] = useState(false);
    const [aiRedrawing, setAiRedrawing] = useState(false);
    /** 「测试连接」探针。分类逻辑在 src/arkDiagnostics.ts（纯函数，有独立单测）。
     *  probe 用 1x1 画布，方舟在参数校验阶段就拒绝 → 不生成图片、不扣费。 */
    const [aiProbeRunning, setAiProbeRunning] = useState(false);
    const [aiProbeResult, setAiProbeResult] = useState(null);
    /** 检查清单的勾选状态（纯本地，存 localStorage，data: 页面下不可用时静默降级） */
    const [checklistDone, setChecklistDone] = useState(() => {
        try {
            const saved = JSON.parse(localStorage.getItem('ark-checklist') ?? '[]');
            return Array.isArray(saved) ? saved : [];
        }
        catch {
            return [];
        }
    });
    // AI 结果缩略图（data URL，直接给 <img> 用，省掉 blob 回收的麻烦）
    const [aiResultUrl, setAiResultUrl] = useState(null);
    /**
     * 「图源历史」：第 0 条永远是上传的原图，之后每点一次「生成 AI 图」追加一条。
     * 有了它就不需要「勾选 AI」这种模式开关 —— 当前用哪张图，就是历史里选中的那条。
     */
    const [aiHistory, setAiHistory] = useState([]);
    const [aiHistoryIndex, setAiHistoryIndex] = useState(-1); // 当前选中的历史下标，-1 = 未选
    // 当前 AI 结果是哪张素材生成的（换素材后要重置，避免拿旧图的 AI 结果）
    const [aiResultSourceFile, setAiResultSourceFile] = useState(null);
    // 图纸生成之后是否被手动绘制修改过（用于自动刷新前决定要不要弹提示）
    const [patternHandEdited, setPatternHandEdited] = useState(false);
    const [referenceFile, setReferenceFile] = useState(null);
    const [referenceImageUrl, setReferenceImageUrl] = useState(null);
    const [referenceVisible, setReferenceVisible] = useState(false);
    const [referenceOpacity, setReferenceOpacity] = useState(0.35);
    const [referenceScale, setReferenceScale] = useState(1);
    const [referenceOffset, setReferenceOffset] = useState({ x: 0, y: 0 });
    const [referenceAdjusting, setReferenceAdjusting] = useState(false);
    const [referencePlacement, setReferencePlacement] = useState('below');
    const [canvasWidth, setCanvasWidth] = useState(project.width);
    const [canvasHeight, setCanvasHeight] = useState(project.height);
    const [convertWidth, setConvertWidth] = useState(defaultImportSettings.width);
    // 宽度输入框的原始文本。不能直接用 number 绑：删空时 Number('') 会变成 0，
    // 导致输入框里永远留个 0、再输入就变成 "0xx"。允许临时为空，失焦/合法时才夹到范围内。
    const [widthInput, setWidthInput] = useState(String(defaultImportSettings.width));
    const [maxColors, setMaxColors] = useState(defaultImportSettings.maxColors);
    const [generationStyle, setGenerationStyle] = useState(defaultImportSettings.generationStyle);
    const [backgroundMode, setBackgroundMode] = useState(defaultImportSettings.backgroundMode);
    const [tolerance, setTolerance] = useState(defaultImportSettings.tolerance);
    // 用户是否手动拖过容差滑条。注意：这个标记只对「当前这张素材」有效 ——
    // 换新图时会重置，因为每张图合适的容差不一样，必须按新图重新自动计算。
    const [toleranceManual, setToleranceManual] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [notice, setNotice] = useState(text.workspaceReady);
    // 当前提示是不是「失败」。失败时状态栏变红，避免像以前那样悄无声息
    const [noticeIsError, setNoticeIsError] = useState(false);
    const [floatingHelp, setFloatingHelp] = useState(null);
    const [hoverCell, setHoverCell] = useState(null);
    const [highlightedColorId, setHighlightedColorId] = useState(null);
    const [showIsolatedBeads, setShowIsolatedBeads] = useState(false);
    const [rightTab, setRightTab] = useState('palette');
    const [editingLayerId, setEditingLayerId] = useState(null);
    const [editingLayerName, setEditingLayerName] = useState('');
    const [draggingLayerId, setDraggingLayerId] = useState(null);
    const [dragTarget, setDragTarget] = useState(null);
    const [paletteMode, setPaletteMode] = useState('basic');
    const [paletteGroup, setPaletteGroup] = useState('all');
    const [adjustments, setAdjustments] = useState(defaultAdjustments);
    const [colorCleanupStrength, setColorCleanupStrength] = useState(2);
    const [layerColorLimit, setLayerColorLimit] = useState(16);
    const [past, setPast] = useState([]);
    const [future, setFuture] = useState([]);
    const usage = useMemo(() => summarizeUsage(project), [project]);
    const totalBeads = usage.reduce((sum, row) => sum + row.count, 0);
    const totalPacks = usage.reduce((sum, row) => sum + row.packs, 0);
    const boardCount = Math.ceil(project.width / project.boardSettings.boardWidth) *
        Math.ceil(project.height / project.boardSettings.boardHeight);
    const isolatedBeadRefs = useMemo(() => findIsolatedBeads(project), [project]);
    const isolatedBeads = isolatedBeadRefs.length;
    const isolatedCellIndices = useMemo(() => (showIsolatedBeads ? [...new Set(isolatedBeadRefs.map((item) => item.index))] : []), [isolatedBeadRefs, showIsolatedBeads]);
    const selectedColor = getColor(selectedColorId);
    const activePalette = paletteMode === 'basic' ? basicPalette : completePalette;
    const recentColors = recentColorIds.flatMap((id) => {
        const color = activePalette.find((item) => item.id === id);
        return color ? [color] : [];
    });
    const paletteGroups = useMemo(() => [
        { id: 'all', label: 'All' },
        ...[...new Set(activePalette.map((color) => color.group))].map((group) => ({ id: group, label: group })),
    ], [activePalette]);
    const visiblePalette = useMemo(() => (paletteGroup === 'all' ? activePalette : activePalette.filter((color) => color.group === paletteGroup)), [activePalette, paletteGroup]);
    function displayCode(color) {
        return color.primaryCode;
    }
    function displayName(color) {
        return color.name;
    }
    function showFloatingHelp(anchor, tooltip) {
        const rect = anchor.getBoundingClientRect();
        const tooltipWidth = 172;
        const left = Math.min(rect.right + 8, window.innerWidth - tooltipWidth - 10);
        setFloatingHelp({
            text: tooltip,
            left,
            top: rect.top + rect.height / 2,
        });
    }
    function imageHelpProps(tooltip) {
        return {
            'data-tooltip': tooltip,
            'aria-label': tooltip,
            tabIndex: 0,
            onMouseEnter: (event) => showFloatingHelp(event.currentTarget, tooltip),
            onMouseLeave: () => setFloatingHelp(null),
            onFocus: (event) => showFloatingHelp(event.currentTarget, tooltip),
            onBlur: () => setFloatingHelp(null),
        };
    }
    function displayCodeById(colorId) {
        const color = getColor(colorId);
        return color ? displayCode(color) : '';
    }
    function layerDisplayName(layer, index) {
        if (layer.customName)
            return layer.name;
        const match = layer.name.match(/^(?:Layer|图层)\s+(\d+)$/);
        if (match)
            return language === 'zh' ? `图层 ${match[1]}` : `Layer ${match[1]}`;
        if (layer.id === 'base' || layer.name === 'Pattern' || layer.name === 'Base bead layer' || layer.name === '基础珠子层') {
            return systemLayerName(index);
        }
        if (!layer.name.trim())
            return language === 'zh' ? `图层 ${index + 1}` : `Layer ${index + 1}`;
        return layer.name;
    }
    function systemLayerName(index) {
        return language === 'zh' ? `图层 ${index + 1}` : `Layer ${index + 1}`;
    }
    function startEditingLayer(layer, index) {
        setEditingLayerId(layer.id);
        setEditingLayerName(layerDisplayName(layer, index));
    }
    function saveEditingLayer(layer, index) {
        const nextName = editingLayerName.trim();
        setEditingLayerId(null);
        if (!nextName)
            return;
        const isSystemName = nextName === `图层 ${index + 1}` || nextName === `Layer ${index + 1}`;
        if (isSystemName && !layer.customName)
            return;
        if (nextName === layer.name && layer.customName)
            return;
        updateLayer(layer.id, { name: nextName, customName: !isSystemName });
    }
    function layerMetaText(isActive, isVisible, isLocked, beadCount) {
        const countText = text.layerBeadCount(beadCount);
        const states = [];
        if (isActive)
            states.push(text.activeLayer);
        if (!isVisible)
            states.push(text.hiddenLayer);
        if (isLocked)
            states.push(text.lockedLayer);
        states.push(countText);
        return states.join(' - ');
    }
    useEffect(() => {
        saveDraft(project);
    }, [project]);
    useEffect(() => {
        localStorage.setItem(languageKey, language);
    }, [language]);
    useEffect(() => {
        return () => {
            if (pendingImageUrl)
                URL.revokeObjectURL(pendingImageUrl);
        };
    }, [pendingImageUrl]);
    useEffect(() => {
        return () => {
            if (referenceImageUrl)
                URL.revokeObjectURL(referenceImageUrl);
        };
    }, [referenceImageUrl]);
    useEffect(() => {
        setCanvasWidth(project.width);
        setCanvasHeight(project.height);
    }, [project.width, project.height]);
    useEffect(() => {
        setNotice((current) => {
            if (current === ui.zh.workspaceReady || current === ui.en.workspaceReady)
                return text.workspaceReady;
            const zhGenerated = current.match(/^(\d+) 色 - (\d+) 颗 - 可编辑图案已生成。$/);
            if (zhGenerated)
                return `${zhGenerated[1]} colors - ${zhGenerated[2]} beads - editable pattern ready.`;
            const enGenerated = current.match(/^(\d+) colors - (\d+) beads - editable pattern ready\.$/);
            if (enGenerated)
                return `${enGenerated[1]} 色 - ${enGenerated[2]} 颗 - 可编辑图案已生成。`;
            return current;
        });
    }, [language, text.workspaceReady]);
    useEffect(() => {
        if (!activePalette.some((color) => color.id === selectedColorId)) {
            setSelectedColorId(activePalette[0].id);
        }
        if (!paletteGroups.some((group) => group.id === paletteGroup)) {
            setPaletteGroup('all');
        }
    }, [activePalette, paletteGroups, paletteGroup, selectedColorId]);
    useEffect(() => {
        function onPaste(event) {
            const file = [...(event.clipboardData?.files ?? [])].find((item) => item.type.startsWith('image/'));
            if (file)
                handleImageFile(file);
        }
        window.addEventListener('paste', onPaste);
        return () => window.removeEventListener('paste', onPaste);
    }, []);
    useEffect(() => {
        if (!pendingFile)
            return;
        // 当前图纸是 AI 图生成的、且用户又切回了原图之外的情况都交给历史选择处理，
        // 这里只管「换了素材 / 改了参数」时自动重算一次。
        // automatic 的调用永远走本地出图纸（免费），不会偷偷调 AI。
        const timer = window.setTimeout(() => {
            const shouldCommit = autoGenerateShouldCommitRef.current;
            autoGenerateShouldCommitRef.current = false;
            void generateFromImage({ recordHistory: shouldCommit, automatic: true });
        }, 420);
        return () => window.clearTimeout(timer);
    }, [pendingFile, convertWidth, maxColors, generationStyle, backgroundMode, tolerance, paletteMode, aiHistoryIndex, aiHistory.length, toleranceManual]);
    function commitHistory() {
        setPast((items) => [...items.slice(-39), project]);
        setFuture([]);
        // 只有「图纸已存在时的操作」才算手动修改。
        // 生成图纸本身也会调用 commitHistory（recordHistory），此时 isGenerating 为真，要排除。
        if (!isGenerating && project.cells.some((cell) => cell !== null)) {
            setPatternHandEdited(true);
        }
    }
    function updateProject(next) {
        setProject({ ...next, updatedAt: new Date().toISOString() });
    }
    function selectColor(colorId, options = {}) {
        setSelectedColorId(colorId);
        if (options.updateRecent === false)
            return;
        setRecentColorIds((current) => [colorId, ...current.filter((id) => id !== colorId)].slice(0, 7));
    }
    function activateTool(nextTool) {
        const closingTextOptions = nextTool === 'text' && tool === 'text' && showTextOptions;
        setTool(nextTool);
        setShowPencilOptions(nextTool === 'pencil');
        setShowEraserOptions(nextTool === 'eraser');
        setShowRemoveOptions(nextTool === 'remove');
        setShowMoveOptions(nextTool === 'move');
        setShowMirrorOptions(nextTool === 'mirror');
        setShowShapeOptions(nextTool === 'shape');
        setShowTextOptions(nextTool === 'text' && !closingTextOptions);
        setShowClipboardOptions(nextTool === 'copy' || nextTool === 'paste');
        setShowPanOptions(nextTool === 'pan');
    }
    function updateCells(cells) {
        updateProject(withCells(project, cells));
    }
    function resetImportSettings() {
        setConvertWidth(defaultImportSettings.width);
        setWidthInput(String(defaultImportSettings.width));
        setMaxColors(defaultImportSettings.maxColors);
        setGenerationStyle(defaultImportSettings.generationStyle);
        setBackgroundMode(defaultImportSettings.backgroundMode);
        setTolerance(defaultImportSettings.tolerance);
        // 恢复默认时也让容差回到「自动校准」状态
        setToleranceManual(false);
    }
    function resetReferenceTransform() {
        setReferenceScale(1);
        setReferenceOffset({ x: 0, y: 0 });
        setReferenceAdjusting(false);
    }
    function resetAdjustments() {
        const session = adjustmentSessionRef.current;
        if (session.layerId === activeLayer.id && session.baseCells.length === activeLayer.cells.length) {
            updateProject(withLayers(project, layers.map((layer) => (layer.id === activeLayer.id ? { ...layer, cells: session.baseCells.slice() } : layer))));
        }
        setAdjustments(defaultAdjustments);
        adjustmentSessionRef.current = { layerId: null, baseCells: [] };
    }
    function updateAdjustment(key, value) {
        if (activeLayer.locked) {
            setNotice(text.adjustmentLocked);
            return;
        }
        const nextAdjustments = { ...adjustments, [key]: value };
        if (adjustmentSessionRef.current.layerId !== activeLayer.id) {
            adjustmentSessionRef.current = { layerId: activeLayer.id, baseCells: activeLayer.cells.slice() };
            commitHistory();
        }
        const baseCells = adjustmentSessionRef.current.baseCells.length > 0 ? adjustmentSessionRef.current.baseCells : activeLayer.cells;
        const adjustedCells = adjustLayerCells(baseCells, nextAdjustments, activePalette);
        setAdjustments(nextAdjustments);
        updateProject(withLayers(project, layers.map((layer) => (layer.id === activeLayer.id ? { ...layer, cells: adjustedCells } : layer))));
    }
    function applyColorCleanup() {
        if (activeLayer.locked) {
            setNotice(text.adjustmentLocked);
            return;
        }
        const { cells, changed } = mergeCloseLayerColors(activeLayer.cells, activePalette, colorCleanupStrength);
        if (changed > 0) {
            commitHistory();
            updateProject(withLayers(project, layers.map((layer) => (layer.id === activeLayer.id ? { ...layer, cells } : layer))));
        }
        setNotice(text.layerColorsCleaned(changed));
    }
    function applyLayerColorLimit() {
        if (activeLayer.locked) {
            setNotice(text.adjustmentLocked);
            return;
        }
        const { cells, changed } = limitLayerColors(activeLayer.cells, activePalette, layerColorLimit);
        if (changed > 0) {
            commitHistory();
            updateProject(withLayers(project, layers.map((layer) => (layer.id === activeLayer.id ? { ...layer, cells } : layer))));
        }
        setNotice(text.layerColorsLimited(changed, layerColorLimit));
    }
    function applyLayerEffect(effect, label) {
        if (activeLayer.locked) {
            setNotice(text.adjustmentLocked);
            return;
        }
        const { cells, changed } = applyEffectToLayer(activeLayer.cells, activePalette, effect);
        if (changed > 0) {
            commitHistory();
            updateProject(withLayers(project, layers.map((layer) => (layer.id === activeLayer.id ? { ...layer, cells } : layer))));
        }
        setNotice(text.effectApplied(label, changed));
    }
    function replaceColor(sourceColorId) {
        if (!sourceColorId || sourceColorId === selectedColorId)
            return;
        let changed = 0;
        const visibleLayerIds = new Set(displayProject.layers.filter((layer) => layer.visible).map((layer) => layer.id));
        const nextLayers = layers.map((layer) => {
            if (layer.locked || !visibleLayerIds.has(layer.id))
                return layer;
            let layerChanged = false;
            const cells = layer.cells.map((cell) => {
                if (cell !== sourceColorId)
                    return cell;
                changed += 1;
                layerChanged = true;
                return selectedColorId;
            });
            return layerChanged ? { ...layer, cells } : layer;
        });
        if (changed === 0)
            return;
        commitHistory();
        updateProject(withLayers(project, nextLayers, project.activeLayerId));
        setNotice(text.recoloredBeads(changed));
    }
    function undo() {
        const previous = past[past.length - 1];
        if (!previous)
            return;
        setPast((items) => items.slice(0, -1));
        setFuture((items) => [...items, project]);
        updateProject(previous);
    }
    function redo() {
        const next = future[future.length - 1];
        if (!next)
            return;
        setFuture((items) => items.slice(0, -1));
        setPast((items) => [...items, project]);
        updateProject(next);
    }
    function startBlank(width = 52, height = 52) {
        soloVisibilitySnapshotRef.current = null;
        setProject(createProject(width, height));
        setPast([]);
        setFuture([]);
        setClipboardPattern(null);
        setCopySelectionIndices([]);
        resetAdjustments();
        resetImportSettings();
        setSelectedColorId(defaultColorId);
        setRecentColorIds(defaultRecentColorIds);
        setPaletteGroup('all');
        setPendingFile(null);
        setPendingImageUrl((current) => {
            if (current)
                URL.revokeObjectURL(current);
            return null;
        });
        setReferenceFile(null);
        setReferenceImageUrl((current) => {
            if (current)
                URL.revokeObjectURL(current);
            return null;
        });
        setReferenceVisible(false);
        resetReferenceTransform();
        setNotice(language === 'zh' ? `已创建 ${width} * ${height} 空白画布。` : `Blank ${width} x ${height} canvas created.`);
    }
    function clearCanvas() {
        if (activeLayer.locked)
            return;
        if (activeLayer.cells.every((cell) => cell === null))
            return;
        commitHistory();
        updateProject(withCells(project, Array.from({ length: project.width * project.height }, () => null)));
        setNotice(language === 'zh' ? '画布已清空。' : 'Canvas cleared.');
    }
    function resizeCanvas() {
        const width = clampInteger(canvasWidth, 8, 180);
        const height = clampInteger(canvasHeight, 8, 180);
        if (width === project.width && height === project.height)
            return;
        commitHistory();
        const nextLayers = layers.map((layer) => ({
            ...layer,
            cells: resizeCells(layer.cells, project.width, project.height, width, height),
        }));
        updateProject({
            ...project,
            width,
            height,
            layers: nextLayers,
            cells: composeVisibleCells(nextLayers, width, height),
        });
        setNotice(language === 'zh' ? `画布已调整为 ${width} * ${height}。` : `Canvas resized to ${width} x ${height}.`);
    }
    function applyPreset(value) {
        const preset = sizePresets.find((item) => item.label === value);
        if (!preset)
            return;
        setCanvasWidth(preset.width);
        setCanvasHeight(preset.height);
    }
    function handleImageFile(file) {
        if (!file.type.match(/^image\/(png|jpeg|jpg|webp)$/)) {
            setNotice(language === 'zh' ? '请使用 PNG、JPG、JPEG 或 WebP 图片。' : 'Use a PNG, JPG, JPEG, or WebP image.');
            return;
        }
        setPendingFile(file);
        setPendingImageUrl((current) => {
            if (current)
                URL.revokeObjectURL(current);
            return URL.createObjectURL(file);
        });
        setReferenceFile(file);
        setReferenceImageUrl((current) => {
            if (current)
                URL.revokeObjectURL(current);
            return URL.createObjectURL(file);
        });
        resetReferenceTransform();
        autoGenerateShouldCommitRef.current = true;
        // 换了新素材 → 容差回到「自动」状态：每张图合适的容差不一样，必须按新图重新算。
        // 用户之前手动调过的那张图，其设置不再适用于新图。
        setToleranceManual(false);
        setTolerance(defaultImportSettings.tolerance);
        // 图源历史重置成「只有原图」这一条。
        // 第 0 条永远是原图，之后每点一次「生成 AI 图」追加一条，靠历史选中项来切换图纸。
        const originalUrl = URL.createObjectURL(file);
        setAiHistory([{ file, url: originalUrl, bg: 'keep', isOriginal: true }]);
        setAiHistoryIndex(0);
        setAiResultUrl(null);
        setAiResultSourceFile(null);
        setPatternHandEdited(false);
        setNotice(language === 'zh' ? `正在生成 ${file.name}...` : `Generating ${file.name}...`);
    }
    function handleReferenceImageFile(file) {
        if (!file.type.match(/^image\/(png|jpeg|jpg|webp)$/)) {
            setNotice(language === 'zh' ? '请使用 PNG、JPG、JPEG 或 WebP 图片。' : 'Use a PNG, JPG, JPEG, or WebP image.');
            return;
        }
        setReferenceFile(file);
        setReferenceImageUrl((current) => {
            if (current)
                URL.revokeObjectURL(current);
            return URL.createObjectURL(file);
        });
        resetReferenceTransform();
        setReferenceVisible(true);
        setNotice(language === 'zh' ? `${file.name} 已设为参考图。` : `${file.name} set as reference image.`);
    }
    /** 把 File 读成 dataURL（浏览器端） */
    function readFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(new Error('读取图片失败'));
            reader.readAsDataURL(file);
        });
    }
    /** 把 dataURL 还原成 File，供后续拼豆管线使用 */
    function dataUrlToFile(dataUrl, fileName) {
        const [head, body] = dataUrl.split(',');
        const mime = /:(.*?);/.exec(head)?.[1] ?? 'image/jpeg';
        const bin = atob(body);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1)
            bytes[i] = bin.charCodeAt(i);
        return new File([bytes], fileName, { type: mime });
    }
    /** 直达按钮的文案（URL 在 arkDiagnostics 里，与语言无关） */
    function arkLinkLabel(kind) {
        if (kind === 'apiKey')
            return text.aiLinkApiKey;
        if (kind === 'model')
            return text.aiLinkModel;
        return text.aiLinkConsole;
    }
    /** 把分类结果拼成给用户看的多行文案。
     *  文案统一从 i18n 按状态取，`{model}` 占位替换成当前模型 ID —— 这样中英一致、
     *  而且「错误码 → 文案」的覆盖关系集中在一处，便于核对有没有漏。
     *
     *  末尾附上「原始信息」（HTTP 状态码 + code + request_id + 服务端消息）：
     *  - `unknown`：完全没见过，必须给全，否则没法排查
     *  - `bad-key`：网络层失败时这里就是「原始错误」（旧版网络失败文案也带了这一句），
     *    而且「HTTP 401」和「TypeError: Failed to fetch」能帮用户区分「Key 错」和「网不通」 */
    function formatAiError(verdict, raw) {
        const entry = text.aiProbeText[verdict.status] ?? text.aiProbeText.unknown;
        const modelId = (aiModel || DEFAULT_AI_MODEL).trim();
        const lines = [String(entry.title).replace('{model}', modelId)];
        for (const step of entry.steps ?? [])
            lines.push(`· ${String(step).replace('{model}', modelId)}`);
        if (verdict.status === 'timeout') {
            lines.push(`（已等待 ${Math.round(AI_REDRAW_TIMEOUT_MS / 1000)} 秒）`);
        }
        if (verdict.status === 'unknown' || verdict.status === 'bad-key') {
            const bits = formatRawBits(raw);
            if (bits)
                lines.push(bits);
        }
        return lines.join('\n');
    }
    /** 零费用「测试连接」探针。
     *  画布故意用 1x1（低于方舟要求的最小面积 921600），方舟在**参数校验阶段**就拒绝，
     *  不会生成图片、不扣费 —— 错误消息本身就是证据。 */
    async function runAiProbe() {
        if (aiProbeRunning)
            return;
        const key = aiApiKey.trim();
        if (!key)
            return;
        const modelId = (aiModel || DEFAULT_AI_MODEL).trim();
        setAiProbeRunning(true);
        setAiProbeResult(null);
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), AI_PROBE_TIMEOUT_MS);
        try {
            const resp = await fetch(ARK_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
                body: JSON.stringify(probeBody(modelId)),
                signal: controller.signal,
            });
            const bodyText = await resp.text();
            const input = probeInputFromResponse(resp.status, bodyText);
            let requestId = '';
            try {
                const parsed = JSON.parse(bodyText);
                requestId = parsed?.error?.request_id ?? parsed?.request_id ?? '';
            }
            catch {
                /* 非 JSON 响应：保持空 */
            }
            setAiProbeResult({
                verdict: classifyAiProbe(input),
                raw: { code: input.code ?? '', requestId, message: input.message ?? '', httpStatus: resp.status },
            });
        }
        catch (error) {
            const name = error instanceof Error ? error.name : String(error);
            setAiProbeResult({
                verdict: classifyAiProbe({ httpStatus: null, networkError: name }),
                raw: {
                    code: '',
                    requestId: '',
                    message: error instanceof Error ? error.message : String(error),
                    httpStatus: null,
                },
            });
        }
        finally {
            window.clearTimeout(timer);
            setAiProbeRunning(false);
        }
    }
    function toggleChecklist(index) {
        setChecklistDone((current) => {
            const next = [...current];
            next[index] = !next[index];
            try {
                localStorage.setItem('ark-checklist', JSON.stringify(next));
            }
            catch {
                /* 存不了不影响使用 */
            }
            return next;
        });
    }
    /** 直连火山方舟，得到 Q 版像素画（返回新的 File 和缩略图 data URL）
     *  纯静态部署（GitHub Pages）下没有本地代理，所以浏览器直接调方舟：
     *  方舟对任意 Origin 都回跨域头，预检允许 authorization,content-type。 */
    async function runAiRedraw(file, modelId) {
        const dataUrl = await readFileAsDataUrl(file);
        const dims = await new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
            img.onerror = () => resolve({ w: 1024, h: 1024 });
            img.src = dataUrl;
        });
        const { W, H } = calcSize(Number(dims.w) || 1024, Number(dims.h) || 1024);
        // 方舟一次生成要 27~107 秒，所以给足超时；超时要能主动中断，不能让界面一直转
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), AI_REDRAW_TIMEOUT_MS);
        let resp;
        try {
            resp = await fetch(ARK_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${aiApiKey.trim()}`,
                },
                body: JSON.stringify({
                    model: modelId,
                    prompt: buildPrompt(backgroundMode),
                    image: dataUrl,
                    size: `${W}x${H}`,
                    watermark: false,
                    response_format: 'b64_json',
                }),
                signal: controller.signal,
            });
        }
        catch (error) {
            // 网络层失败。⚠️ 关键：方舟在 Key 无效时返回的 401 **不带跨域头**，浏览器读不到响应体，
            // 所以「Key 不对」在这里只能表现成 TypeError。分类器会把这种情况判成 bad-key，
            // 文案里**同时**说明「最可能是 Key 不对」，而不是只说成网络问题。
            const name = error instanceof Error ? error.name : String(error);
            throw new Error(formatAiError(classifyAiProbe({ httpStatus: null, networkError: name }), {
                code: '',
                requestId: '',
                message: error instanceof Error ? error.message : String(error),
                httpStatus: null,
            }));
        }
        finally {
            window.clearTimeout(timer);
        }
        const text = await resp.text();
        let json = null;
        try {
            json = JSON.parse(text);
        }
        catch (error) {
            throw new Error(`AI 服务返回了无法解析的内容（HTTP ${resp.status}）：${text.slice(0, 300)}`);
        }
        if (!resp.ok || json.error) {
            // 分类逻辑统一在 src/arkDiagnostics.ts（纯函数、有单测），文案统一从 i18n 按状态取。
            // 这样「测试连接」和「真实生成失败」给的是同一套说法，不会两处不一致。
            const code = json?.error?.code ?? '';
            const message = json?.error?.message || json?.message || `HTTP ${resp.status}`;
            const requestId = json?.error?.request_id ?? json?.request_id ?? '';
            throw new Error(formatAiError(classifyAiProbe({ httpStatus: resp.status, code, message }), {
                code,
                requestId,
                message,
                httpStatus: resp.status,
            }));
        }
        const item = (json.data ?? []).find((d) => d.b64_json);
        if (!item) {
            throw new Error(`AI 返回里没有图片数据。返回内容：${text.slice(0, 300)}`);
        }
        const base = file.name.replace(/\.[^.]+$/, '');
        const url = 'data:image/png;base64,' + item.b64_json;
        return { file: dataUrlToFile(url, `${base}_ai.png`), url };
    }
    /** 把 AI 生成的图设为参考图（便于临摹/核对），原参考图不再是原照片 */
    function useAsReference(file) {
        setReferenceFile(file);
        setReferenceImageUrl((current) => {
            if (current)
                URL.revokeObjectURL(current);
            return URL.createObjectURL(file);
        });
        setReferenceVisible(true);
    }
    /**
     * 从历史里挑一条当作当前图源：第 0 条是原图，其余是 AI 图。
     * 选中后立刻重算图纸 —— 纯本地，不调用 AI、不花钱。
     */
    function selectHistoryEntry(index) {
        const item = aiHistory[index];
        if (!item)
            return;
        setAiHistoryIndex(index);
        setAiResultSourceFile(item.isOriginal ? null : pendingFile);
        if (!item.isOriginal) {
            setAiResultUrl(item.url);
            useAsReference(item.file);
        }
        setNotice(item.isOriginal
            ? (language === 'zh' ? '已切回原图，正在出图纸…' : 'Switched back to the original image, rebuilding…')
            : (language === 'zh'
                ? `已选中第 ${index} 张 AI 图${item.bg === 'keep' ? '（保留背景）' : '（去除背景）'}，正在出图纸…`
                : `AI result #${index} selected, rebuilding…`));
        void generateFromImage({ automatic: true, sourceFile: item.file });
    }
    /** 当前图纸区是否已有内容 */
    const hasPatternContent = project.cells.some((cell) => cell !== null);
    async function generateFromImage(options = {}) {
        if (!pendingFile)
            return;
        if (activeLayer.locked) {
            setNotice(text.lockedCanvasHint);
            return;
        }
        // 自动刷新前，若图纸被手动绘制修改过，先征求确认，避免丢失手改内容
        if (options.automatic && patternHandEdited) {
            const ok = window.confirm(text.autoRefreshConfirm);
            if (!ok)
                return;
        }
        const requestId = generationRequestRef.current + 1;
        generationRequestRef.current = requestId;
        const targetLayerId = activeLayer.id;
        const sourceProject = project;
        const sourceLayers = layers;
        setIsGenerating(true);
        try {
            // 图源由「历史选中项」决定：第 0 条是原图，之后每条是一次 AI 重绘结果。
            // 只有点了「生成 AI 图」才会真的调用 AI，其它情况（改参数、切历史）都是本地重算，免费。
            const selectedEntry = aiHistory[aiHistoryIndex];
            let sourceFile = options.sourceFile ?? selectedEntry?.file ?? pendingFile;
            let fromAi = !!(options.sourceFile ?? selectedEntry?.file) && !selectedEntry?.isOriginal;
            if (options.forceAiRedraw) {
                if (!aiApiKey.trim()) {
                    setIsGenerating(false);
                    setNoticeIsError(true);
                    setNotice(language === 'zh' ? '生成失败：请先填写 API Key' : 'Failed: please enter your API Key first');
                    return;
                }
                setAiRedrawing(true);
                setNotice(text.aiRedrawRunning);
                setNoticeIsError(false);
                try {
                    const redrawn = await runAiRedraw(pendingFile, (options.model ?? aiModel).trim() || DEFAULT_AI_MODEL);
                    sourceFile = redrawn.file;
                    fromAi = true;
                    setAiResultUrl(redrawn.url);
                    setAiResultSourceFile(pendingFile);
                    // 追加进历史，成为新的「当前图源」，同时把 AI 图设为参考图
                    setAiHistory((items) => {
                        const next = [...items, { file: redrawn.file, url: redrawn.url, bg: backgroundMode }];
                        return next.slice(-AI_HISTORY_LIMIT);
                    });
                    setAiHistoryIndex((current) => {
                        const nextIndex = Math.min(aiHistory.length, AI_HISTORY_LIMIT - 1);
                        return nextIndex >= 0 ? nextIndex : current;
                    });
                    useAsReference(redrawn.file);
                }
                finally {
                    setAiRedrawing(false);
                }
                if (requestId !== generationRequestRef.current)
                    return;
                setNotice(language === 'zh' ? 'AI 重绘完成，正在生成拼豆图案…' : 'AI redraw done, generating pattern…');
            }
            else if (fromAi) {
                setNotice(language === 'zh' ? '用选中的 AI 图出图纸（未调用 AI，不产生费用）…' : 'Rebuilding from the selected AI image (no AI call, no cost)…');
            }
            else {
                setNotice(language === 'zh' ? '正在本地更新拼豆图案...' : 'Updating bead pattern locally...');
            }
            const result = await imageFileToBeads(sourceFile, {
                width: convertWidth,
                maxColors,
                palette: activePalette,
                generationStyle,
                backgroundMode,
                backgroundColor: [255, 255, 255],
                tolerance,
                speckleReduction: defaultImportSettings.speckleReduction,
                // 用户手动拖过容差之后就不再自动校准；否则让工具自己算一个合适值
                calibrateTolerance: !toleranceManual,
                // 只有「AI 图 → 图纸」这一步才保护眼睛高光：
                // 低格数下高光容易被降采样吃掉，把它补回来；照片直接转图纸时不做，避免误判。
                preserveEyeHighlight: fromAi,
            });
            if (requestId !== generationRequestRef.current)
                return;
            if (options.recordHistory)
                commitHistory();
            const nextWidth = Math.max(sourceProject.width, result.width);
            const nextHeight = Math.max(sourceProject.height, result.height);
            const nextLayers = sourceLayers.map((layer) => {
                if (layer.id === targetLayerId) {
                    return {
                        ...layer,
                        cells: resizeCells(result.cells, result.width, result.height, nextWidth, nextHeight),
                    };
                }
                return {
                    ...layer,
                    cells: resizeCells(layer.cells, sourceProject.width, sourceProject.height, nextWidth, nextHeight),
                };
            });
            const nextProject = {
                ...sourceProject,
                width: nextWidth,
                height: nextHeight,
                activeLayerId: targetLayerId,
                layers: nextLayers,
                cells: composeVisibleCells(nextLayers, nextWidth, nextHeight),
            };
            updateProject(nextProject);
            // 滑条 = 实际值：把自动校准的结果写回滑条，用户看到的就是真正在用的数
            if (!toleranceManual && result.effectiveTolerance !== undefined && result.effectiveTolerance !== tolerance) {
                setTolerance(result.effectiveTolerance);
            }
            // 图纸刚重算过，手改标记清零
            setPatternHandEdited(false);
            setNoticeIsError(false);
            setNotice(language === 'zh'
                ? `${result.colorsUsed} 色 - ${result.totalBeads} 颗 - 可编辑图案已生成。`
                : `${result.colorsUsed} colors - ${result.totalBeads} beads - editable pattern ready.`);
        }
        catch (error) {
            if (requestId !== generationRequestRef.current)
                return;
            // 失败要显眼：以前只往右侧状态栏写一行灰字，等于没有反馈
            setNoticeIsError(true);
            setNotice((language === 'zh' ? '生成失败：' : 'Failed: ')
                + (error instanceof Error ? error.message : String(error)));
        }
        finally {
            if (requestId === generationRequestRef.current)
                setIsGenerating(false);
        }
    }
    async function importJson(file) {
        let imported;
        try {
            const text = await file.text();
            imported = JSON.parse(text);
        }
        catch {
            throw new Error(text.unreadableRecord);
        }
        if (!imported.width || !imported.height || !Array.isArray(imported.cells)) {
            throw new Error(text.invalidRecord);
        }
        soloVisibilitySnapshotRef.current = null;
        setProject(normalizeProject(imported));
        setPast([]);
        setFuture([]);
        setPendingFile(null);
        setPendingImageUrl((current) => {
            if (current)
                URL.revokeObjectURL(current);
            return null;
        });
        setNotice(text.recordImported);
    }
    function exportUsageList() {
        downloadUsageWorkbook(project);
        setNotice(text.usageExported);
    }
    function exportEditRecord() {
        downloadProjectJson(project);
        setNotice(text.recordExported);
    }
    function resetClipboard() {
        setClipboardPattern(null);
        setCopySelectionIndices([]);
        setNotice(text.clipboardReset);
    }
    function addLayer() {
        commitHistory();
        const nextLayer = createLayer(project.width, project.height, `${text.layers} ${layers.length + 1}`);
        updateProject(withLayers(project, [...layers, nextLayer], nextLayer.id));
    }
    function duplicateLayer(layerId) {
        const sourceIndex = layers.findIndex((layer) => layer.id === layerId);
        const source = layers[sourceIndex];
        if (!source)
            return;
        commitHistory();
        const displayName = layerDisplayName(source, sourceIndex);
        const nextLayer = {
            ...source,
            id: `layer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            name: uniqueDuplicateLayerName(displayName),
            customName: true,
            locked: false,
            cells: source.cells.slice(),
        };
        const nextLayers = layers.slice();
        nextLayers.splice(sourceIndex + 1, 0, nextLayer);
        updateProject(withLayers(project, nextLayers, nextLayer.id));
    }
    function uniqueDuplicateLayerName(baseName) {
        const suffix = language === 'zh' ? '复制' : 'copy ';
        const existingNames = new Set(layers.map((layer, index) => layerDisplayName(layer, index)));
        for (let index = 1; index < 1000; index += 1) {
            const candidate = language === 'zh' ? `${baseName}-${suffix}${index}` : `${baseName}-${suffix}${index}`;
            if (!existingNames.has(candidate))
                return candidate;
        }
        return language === 'zh' ? `${baseName}-${suffix}${Date.now()}` : `${baseName}-${suffix}${Date.now()}`;
    }
    function updateLayer(layerId, changes) {
        commitHistory();
        updateProject(withLayers(project, layers.map((layer) => (layer.id === layerId ? { ...layer, ...changes } : layer))));
    }
    function updateUsageLayerSelection(includedLayerIds) {
        const nextLayers = layers.map((layer) => ({
            ...layer,
            includeInUsage: includedLayerIds.has(layer.id),
        }));
        const changed = nextLayers.some((layer, index) => layer.includeInUsage !== layers[index].includeInUsage);
        if (!changed)
            return;
        commitHistory();
        updateProject(withLayers(project, nextLayers, project.activeLayerId));
    }
    function toggleUsageLayer(layerId) {
        const includedLayerIds = new Set(countedLayers.map((layer) => layer.id));
        if (includedLayerIds.has(layerId)) {
            includedLayerIds.delete(layerId);
        }
        else {
            includedLayerIds.add(layerId);
        }
        updateUsageLayerSelection(includedLayerIds);
    }
    function toggleActiveLayerOnly() {
        const shouldEnable = !project.settings.showActiveLayerOnly;
        if (shouldEnable) {
            soloVisibilitySnapshotRef.current = Object.fromEntries(layers.map((layer) => [layer.id, layer.visible]));
            const soloLayers = layers.map((layer) => ({
                ...layer,
                visible: layer.id === activeLayer.id,
            }));
            updateProject({
                ...project,
                settings: { ...project.settings, showActiveLayerOnly: true },
                layers: soloLayers,
                cells: composeVisibleCells(soloLayers, project.width, project.height),
            });
            return;
        }
        const snapshot = soloVisibilitySnapshotRef.current;
        soloVisibilitySnapshotRef.current = null;
        const restoredLayers = layers.map((layer) => ({
            ...layer,
            visible: snapshot?.[layer.id] ?? layer.visible,
        }));
        updateProject({
            ...project,
            settings: { ...project.settings, showActiveLayerOnly: false },
            layers: restoredLayers,
            cells: composeVisibleCells(restoredLayers, project.width, project.height),
        });
    }
    function deleteLayer(layerId) {
        if (layers.length <= 1)
            return;
        commitHistory();
        updateProject(withLayers(project, layers.filter((layer) => layer.id !== layerId)));
    }
    function moveLayer(sourceId, target) {
        if (sourceId === target.id)
            return;
        const originalDisplayLayers = [...layers].reverse();
        const nextDisplayLayers = originalDisplayLayers.slice();
        const sourceIndex = nextDisplayLayers.findIndex((layer) => layer.id === sourceId);
        if (sourceIndex < 0)
            return;
        const [movedLayer] = nextDisplayLayers.splice(sourceIndex, 1);
        const targetIndex = nextDisplayLayers.findIndex((layer) => layer.id === target.id);
        if (targetIndex < 0)
            return;
        const insertIndex = target.edge === 'after' ? targetIndex + 1 : targetIndex;
        nextDisplayLayers.splice(insertIndex, 0, movedLayer);
        const originalOrder = originalDisplayLayers.map((layer) => layer.id).join('|');
        const nextOrder = nextDisplayLayers.map((layer) => layer.id).join('|');
        if (originalOrder === nextOrder)
            return;
        commitHistory();
        updateProject(withLayers(project, nextDisplayLayers.reverse(), project.activeLayerId));
    }
    function dragTargetFromEvent(event, layerId) {
        const rect = event.currentTarget.getBoundingClientRect();
        return {
            id: layerId,
            edge: event.clientY < rect.top + rect.height / 2 ? 'before' : 'after',
        };
    }
    function selectLayer(layerId) {
        if (!project.settings.showActiveLayerOnly) {
            updateProject({ ...project, activeLayerId: layerId });
            return;
        }
        const soloLayers = layers.map((layer) => ({
            ...layer,
            visible: layer.id === layerId,
        }));
        updateProject({
            ...project,
            activeLayerId: layerId,
            layers: soloLayers,
            cells: composeVisibleCells(soloLayers, project.width, project.height),
        });
    }
    function setBeadsPerPack(value) {
        updateProject({
            ...project,
            settings: {
                ...project.settings,
                beadsPerPack: clampInteger(value, 1, 10000),
            },
        });
    }
    function stepBeadsPerPack(direction) {
        const current = project.settings.beadsPerPack;
        const step = 500;
        const next = direction > 0
            ? current % step === 0
                ? current + step
                : Math.ceil(current / step) * step
            : current % step === 0
                ? current - step
                : Math.floor(current / step) * step;
        setBeadsPerPack(Math.max(step, next));
    }
    const layers = project.layers?.length ? project.layers : createProject(project.width, project.height).layers;
    const activeLayer = layers.find((layer) => layer.id === project.activeLayerId) ?? layers[0];
    const countedLayers = layers.filter((layer) => layer.includeInUsage);
    useEffect(() => {
        setCopySelectionIndices([]);
        setAdjustments(defaultAdjustments);
        adjustmentSessionRef.current = { layerId: null, baseCells: [] };
    }, [activeLayer.id, project.width, project.height]);
    const displayProject = useMemo(() => {
        if (!project.settings.showActiveLayerOnly) {
            return project;
        }
        const displayLayers = layers.map((layer) => ({
            ...layer,
            visible: layer.id === activeLayer.id,
        }));
        return {
            ...project,
            layers: displayLayers,
            cells: composeVisibleCells(displayLayers, project.width, project.height),
        };
    }, [activeLayer.id, layers, project]);
    const shapeLabel = {
        line: text.shapeLine,
        rectangle: text.shapeRectangle,
        square: text.shapeSquare,
        ellipse: text.shapeEllipse,
        circle: text.shapeCircle,
        triangle: text.shapeTriangle,
        arrow: text.shapeArrow,
    };
    const arrowLabel = {
        single: text.arrowSingle,
        double: text.arrowDouble,
        block: text.arrowBlock,
    };
    const selectedSizePreset = sizePresets.find((item) => item.width === canvasWidth && item.height === canvasHeight)?.label ?? '';
    const defaultPrintNickname = useMemo(() => {
        const date = new Date();
        const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}`;
        return language === 'zh' ? `拼豆图纸_${stamp}` : `Perler_Beads_${stamp}`;
    }, [language]);
    function exportPrintPattern() {
        const exportOptions = {
            ...printExportOptions,
            projectName: printExportOptions.projectName?.trim() || defaultPrintNickname,
            layerLabelPrefix: language === 'en' ? 'Layer' : '图层',
        };
        if (printExportOptions.format === 'pdf') {
            downloadPrintPdf(project, exportOptions);
        }
        else {
            downloadPrintPng(project, exportOptions);
        }
        setShowPrintExportPanel(false);
    }
    return (React.createElement("main", { className: "app-shell", onDragOver: (event) => event.preventDefault(), onDrop: (event) => {
            event.preventDefault();
            const file = [...event.dataTransfer.files].find((item) => item.type.startsWith('image/'));
            if (file)
                handleImageFile(file);
        } },
        React.createElement("input", { ref: fileInputRef, className: "hidden-input", type: "file", accept: "image/png,image/jpeg,image/webp", onChange: (event) => {
                const file = event.currentTarget.files?.[0];
                if (file)
                    handleImageFile(file);
                event.currentTarget.value = '';
            } }),
        React.createElement("input", { ref: referenceInputRef, className: "hidden-input", type: "file", accept: "image/png,image/jpeg,image/webp", onChange: (event) => {
                const file = event.currentTarget.files?.[0];
                if (file)
                    handleReferenceImageFile(file);
                event.currentTarget.value = '';
            } }),
        React.createElement("input", { ref: jsonInputRef, className: "hidden-input", type: "file", accept: "application/json,.json", onChange: (event) => {
                const file = event.currentTarget.files?.[0];
                if (file)
                    importJson(file).catch((error) => setNotice(error.message));
                event.currentTarget.value = '';
            } }),
        React.createElement("header", { className: "topbar" },
            React.createElement("div", { className: "brand-lockup", "aria-label": text.appName },
                React.createElement("img", { className: "logo-mark", src: "./assets/logo.png", alt: "", "aria-hidden": "true" }),
                React.createElement("div", null,
                    React.createElement("strong", null, text.appName),
                    React.createElement("small", null, text.status(project.width, project.height, totalBeads, usage.length)))),
            React.createElement("div", { className: "topbar-workspace" },
                React.createElement("div", { className: "topbar-params canvas-params", "aria-label": "Canvas controls" },
                    React.createElement("span", { className: "topbar-control-label" }, text.board),
                    React.createElement("div", { className: "topbar-dimension-group" },
                        React.createElement("input", { "aria-label": "Canvas width", type: "number", min: 8, max: 180, value: canvasWidth, onChange: (event) => setCanvasWidth(Number(event.target.value)) }),
                        React.createElement("span", { className: "size-times" }, "\u00D7"),
                        React.createElement("input", { "aria-label": "Canvas height", type: "number", min: 8, max: 180, value: canvasHeight, onChange: (event) => setCanvasHeight(Number(event.target.value)) })),
                    React.createElement("select", { className: "canvas-preset-select", "aria-label": "Canvas preset", value: selectedSizePreset || '', onChange: (event) => applyPreset(event.target.value) },
                        React.createElement("option", { value: "", disabled: true, hidden: true }, text.commonSizes),
                        sizePresets.map((preset) => (React.createElement("option", { key: preset.label, value: preset.label }, preset.label)))),
                    React.createElement("button", { className: "canvas-apply-button", onClick: resizeCanvas }, text.apply)),
                React.createElement("div", { className: "topbar-command-zone" },
                    React.createElement("div", { className: "topbar-actions project-actions" },
                        React.createElement("button", { className: "project-action-button primary-action", onClick: () => startBlank(52, 52) }, text.new),
                        React.createElement("button", { className: "project-action-button", onClick: clearCanvas }, text.clear),
                        React.createElement("span", { className: "project-action-divider", "aria-hidden": "true" }),
                        React.createElement("button", { className: "project-action-button history-action", onClick: undo, disabled: past.length === 0 }, text.undo),
                        React.createElement("button", { className: "project-action-button history-action", onClick: redo, disabled: future.length === 0 }, text.redo)),
                    React.createElement("div", { className: "topbar-actions export-actions" },
                        React.createElement("div", { className: "print-export-menu" },
                            React.createElement("button", { className: "export-action-button primary-action print-export-button", title: `${text.exportPatternTitle} PNG`, "aria-expanded": showPrintExportPanel, onClick: () => setShowPrintExportPanel((value) => !value) },
                                React.createElement(ExportIcon, null),
                                React.createElement("span", null, text.exportPatternFull)),
                            showPrintExportPanel && (React.createElement("div", { className: "print-export-popover" },
                                React.createElement("div", { className: "print-export-popover-header" },
                                    React.createElement("strong", null, text.printExportSettings),
                                    React.createElement("button", { className: "print-export-close", type: "button", "aria-label": text.close, title: text.close, onClick: () => setShowPrintExportPanel(false) },
                                        React.createElement(CloseIcon, null))),
                                React.createElement("label", { className: "export-text-field" },
                                    React.createElement("span", null, text.exportFormat),
                                    React.createElement("select", { className: "export-format-select", value: printExportOptions.format ?? 'png', onChange: (event) => setPrintExportOptions((current) => ({ ...current, format: event.target.value })) },
                                        React.createElement("option", { value: "png" }, "PNG"),
                                        React.createElement("option", { value: "pdf" }, "PDF"))),
                                React.createElement("label", { className: "export-text-field" },
                                    React.createElement("span", null, text.exportBounds),
                                    React.createElement("select", { className: "export-format-select", value: printExportOptions.exportBounds ?? 'pattern', onChange: (event) => setPrintExportOptions((current) => ({ ...current, exportBounds: event.target.value })) },
                                        React.createElement("option", { value: "pattern" }, text.exportPatternBounds),
                                        React.createElement("option", { value: "canvas" }, text.exportCanvasBounds))),
                                React.createElement("label", { className: "export-text-field" },
                                    React.createElement("span", null, text.projectNickname),
                                    React.createElement("input", { value: printExportOptions.projectName ?? '', placeholder: defaultPrintNickname, onChange: (event) => setPrintExportOptions((current) => ({ ...current, projectName: event.target.value })) })),
                                React.createElement("label", { className: "export-text-field" },
                                    React.createElement("span", null, text.authorNickname),
                                    React.createElement("input", { value: printExportOptions.authorName ?? '', placeholder: text.optional, onChange: (event) => setPrintExportOptions((current) => ({ ...current, authorName: event.target.value })) })),
                                React.createElement("label", { className: "switch-row" },
                                    React.createElement("span", null, text.showColorCodes),
                                    React.createElement("input", { type: "checkbox", checked: printExportOptions.showColorCodes, onChange: (event) => setPrintExportOptions((current) => ({ ...current, showColorCodes: event.target.checked })) })),
                                React.createElement("label", { className: "switch-row" },
                                    React.createElement("span", null, text.showGuideLines),
                                    React.createElement("input", { type: "checkbox", checked: printExportOptions.showGuideLines, onChange: (event) => setPrintExportOptions((current) => ({ ...current, showGuideLines: event.target.checked })) })),
                                React.createElement("button", { className: "export-submit-button", onClick: exportPrintPattern },
                                    text.exportNow,
                                    " ",
                                    (printExportOptions.format ?? 'png').toUpperCase())))),
                        React.createElement("button", { className: "export-action-button", title: text.exportUsageTitle, onClick: exportUsageList }, text.exportUsageFull),
                        React.createElement("button", { className: "export-action-button", title: text.exportRecordTitle, onClick: exportEditRecord }, text.exportRecordFull),
                        React.createElement("button", { className: "export-action-button", title: text.importRecordTitle, onClick: () => jsonInputRef.current?.click() }, text.importRecordFull)))),
            React.createElement("div", { className: "topbar-right" },
                React.createElement("a", { className: "github-link", href: "https://github.com/Jett-Wu/Perler_Beads_Generator", target: "_blank", rel: "noreferrer", "aria-label": "GitHub", title: "GitHub" },
                    React.createElement(GitHubIcon, null),
                    React.createElement("span", null, "GitHub")),
                React.createElement("div", { className: "language-toggle", "aria-label": text.language },
                    React.createElement("button", { className: language === 'zh' ? 'active' : '', onClick: () => setLanguage('zh') }, "\u4E2D"),
                    React.createElement("button", { className: language === 'en' ? 'active' : '', onClick: () => setLanguage('en') }, "EN")))),
        React.createElement("aside", { className: "left-panel" },
            React.createElement("section", { className: "left-card preview-card" },
                React.createElement("div", { className: "left-card-header" },
                    React.createElement("div", null,
                        React.createElement("strong", null, text.preview3d),
                        React.createElement("span", null, text.liveBoard)),
                    React.createElement("small", null,
                        totalBeads,
                        " ",
                        language === 'zh' ? '颗' : 'beads')),
                React.createElement(ThreePreview, { project: displayProject, title: text.preview3d, emptyLabel: text.previewEmpty, closeLabel: text.close, expandLabel: text.expandPreview })),
            React.createElement("section", { className: "left-card image-card upload-card" },
                React.createElement("div", { className: "left-card-header" },
                    React.createElement("div", null,
                        React.createElement("strong", { className: "field-label-with-help" },
                            text.imageToPattern,
                            React.createElement("span", { className: "help-dot image-help-dot", ...imageHelpProps(text.autoGenerateHint) }, "?"))),
                    React.createElement("small", null, pendingFile ? text.ready : text.noImage)),
                React.createElement("button", { className: pendingImageUrl ? `upload-zone has-image${isGenerating ? ' is-generating' : ''}` : `upload-zone${isGenerating ? ' is-generating' : ''}`, onClick: () => fileInputRef.current?.click() },
                    pendingImageUrl && React.createElement("img", { src: pendingImageUrl, alt: "" }),
                    React.createElement("span", { className: "upload-zone-text" },
                        React.createElement("strong", null, isGenerating ? text.preparingPattern : pendingFile ? pendingFile.name : text.uploadImage),
                        React.createElement("span", null, isGenerating ? pendingFile?.name : pendingFile ? 'PNG / JPG / WebP' : 'PNG, JPG, WebP')))),
            React.createElement("section", { className: "left-card ai-card" },
                React.createElement("div", { className: "left-card-header" },
                    React.createElement("div", null,
                        React.createElement("strong", { className: "field-label-with-help" },
                            text.aiRedrawTitle,
                            React.createElement("span", { className: "help-dot image-help-dot", ...imageHelpProps(text.aiRedrawHint) }, "?"))),
                    React.createElement("small", { className: "ai-redraw-cost" }, text.aiRedrawCost)),
                React.createElement("div", { className: "ai-optional-notice" },
                    React.createElement("strong", null, text.aiOptionalLine1),
                    React.createElement("span", null, text.aiOptionalLine2)),
                React.createElement("details", { className: "ai-checklist" },
                    React.createElement("summary", null, text.aiChecklistTitle),
                    React.createElement("ol", { className: "ai-checklist-list" }, text.aiChecklist.map((item, index) => (React.createElement("li", { key: index, className: checklistDone[index] ? 'is-done' : '' },
                        React.createElement("label", { className: "ai-check-item" },
                            React.createElement("input", { type: "checkbox", checked: !!checklistDone[index], onChange: () => toggleChecklist(index) }),
                            React.createElement("span", { className: "ai-check-text" }, item.text)),
                        React.createElement("small", { className: "ai-check-hint" }, item.hint),
                        item.link && (React.createElement("a", { className: "ai-direct-link", href: ARK_LINKS[item.link], target: "_blank", rel: "noreferrer" }, item.linkLabel))))))),
                React.createElement("div", { className: "ai-examples" },
                    React.createElement("div", { className: "ai-examples-head" },
                        React.createElement("strong", null, text.aiExamplesTitle),
                        React.createElement("small", null, text.aiExamplesCaption)),
                    ['ex1', 'ex2', 'ex3'].map((key, index) => (React.createElement("figure", { className: "ai-example-row", key: key },
                        React.createElement("figcaption", { className: "ai-example-caption" }, text.aiExampleCaptions[index]),
                        React.createElement("div", { className: "ai-example-cells" },
                            React.createElement("img", { src: `./assets/examples/${key}-original.jpg`, alt: "", loading: "lazy" }),
                            React.createElement("img", { src: `./assets/examples/${key}-ai.jpg`, alt: "", loading: "lazy" }),
                            React.createElement("img", { src: `./assets/examples/${key}-pattern.png`, alt: "", loading: "lazy" })))))),
                React.createElement("div", { className: "ai-redraw-row" },
                    aiResultUrl ? (React.createElement("img", { className: "ai-redraw-thumb", src: aiResultUrl, alt: "" })) : (React.createElement("span", { className: "ai-redraw-thumb is-empty", "aria-hidden": "true" })),
                    React.createElement("label", { className: "stacked-field ai-redraw-bg-field" },
                        React.createElement("span", null, text.aiBackground),
                        React.createElement("select", { "aria-label": "AI background handling", value: backgroundMode, onChange: (event) => setBackgroundMode(event.target.value) },
                            React.createElement("option", { value: "keep" }, text.keepBackground),
                            React.createElement("option", { value: "remove-white" }, text.removeWhite))),
                    React.createElement("label", { className: "stacked-field ai-redraw-key" },
                        React.createElement("span", null, text.aiRedrawKeyLabel),
                        React.createElement("input", { type: "password", value: aiApiKey, placeholder: text.aiRedrawKeyPlaceholder, onChange: (event) => {
                                const value = event.target.value;
                                setAiApiKey(value);
                                localStorage.setItem('ark-api-key', value);
                            } }))),
                React.createElement("div", { className: "ai-probe" },
                    React.createElement("div", { className: "ai-probe-actions" },
                        React.createElement("button", { type: "button", className: "ai-probe-button", disabled: aiProbeRunning || !aiApiKey.trim(), onClick: () => void runAiProbe() }, aiProbeRunning ? text.aiProbeRunning : text.aiProbeButton)),
                    !aiApiKey.trim() && React.createElement("small", { className: "ai-probe-hint" }, text.aiProbeNeedKey),
                    aiProbeResult && (() => {
                        const verdict = aiProbeResult.verdict;
                        const entry = text.aiProbeText[verdict.status] ?? text.aiProbeText.unknown;
                        const modelId = (aiModel || DEFAULT_AI_MODEL).trim();
                        // 原始信息（HTTP + code + request_id + 服务端消息）：
                        // unknown 必须给全，bad-key 给出来才能区分「Key 错（401）」和「网不通（TypeError）」
                        const rawBits = formatRawBits(aiProbeResult.raw);
                        const showRaw = (verdict.status === 'unknown' || verdict.status === 'bad-key') && !!rawBits;
                        return (React.createElement("div", { className: `ai-probe-result is-${verdict.level}`, role: "status" },
                            React.createElement("strong", null, String(entry.title).replace('{model}', modelId)),
                            React.createElement("ol", { className: "ai-probe-steps" }, (entry.steps ?? []).map((step, index) => (React.createElement("li", { key: index }, String(step).replace('{model}', modelId))))),
                            React.createElement("div", { className: "ai-probe-result-actions" },
                                verdict.linkKind && (React.createElement("a", { className: "ai-direct-link is-primary", href: ARK_LINKS[verdict.linkKind], target: "_blank", rel: "noreferrer" }, arkLinkLabel(verdict.linkKind))),
                                React.createElement("button", { type: "button", className: "ai-probe-retest", disabled: aiProbeRunning, onClick: () => void runAiProbe() }, text.aiProbeRetest)),
                            showRaw && React.createElement("small", { className: "ai-probe-raw" }, rawBits)));
                    })()),
                React.createElement("div", { className: "ai-model-block" },
                    React.createElement("button", { type: "button", className: "ai-model-toggle", "aria-expanded": aiModelOpen, onClick: () => setAiModelOpen((v) => !v) },
                        React.createElement("span", null, text.aiModelLabel),
                        React.createElement("em", null, aiModel || DEFAULT_AI_MODEL),
                        React.createElement("span", { className: "ai-model-caret" }, aiModelOpen ? '▴' : '▾')),
                    aiModelOpen && (React.createElement("div", { className: "ai-model-body" },
                        React.createElement("datalist", { id: "ark-model-presets" }, AI_MODEL_PRESETS.map((m) => React.createElement("option", { key: m, value: m }))),
                        React.createElement("input", { "aria-label": "Ark model id", list: "ark-model-presets", value: aiModel, placeholder: DEFAULT_AI_MODEL, onChange: (event) => {
                                const value = event.target.value;
                                setAiModel(value);
                                localStorage.setItem('ark-model', value);
                            } }),
                        React.createElement("small", null, text.aiModelHint)))),
                aiHistory.length > 0 && (React.createElement("div", { className: "ai-history" },
                    React.createElement("span", { className: "ai-history-label" },
                        React.createElement("em", null, aiHistory.length),
                        text.aiHistoryLabel),
                    React.createElement("div", { className: "ai-history-strip" }, aiHistory.map((item, index) => (React.createElement("button", { key: index, type: "button", className: `ai-history-item${index === aiHistoryIndex ? ' active' : ''}${item.isOriginal ? ' is-original' : ''}`, title: item.isOriginal
                            ? text.aiHistoryOriginal
                            : `${text.aiHistoryTitle} ${index} · ${item.bg === 'keep' ? text.keepBackground : text.removeWhite}`, disabled: aiRedrawing || isGenerating, onClick: () => selectHistoryEntry(index) },
                        React.createElement("img", { src: item.url, alt: item.isOriginal ? text.aiHistoryOriginal : `${index}` }),
                        React.createElement("span", { className: "ai-history-no" }, item.isOriginal ? text.aiHistoryOriginalShort : index))))))),
                aiRedrawing && (React.createElement("div", { className: "ai-redraw-progress" },
                    React.createElement("span", { className: "ai-redraw-spinner" }),
                    React.createElement("strong", null, text.aiRedrawRunning))),
                React.createElement("div", { className: "ai-redraw-actions" },
                    React.createElement("button", { type: "button", className: "ai-redraw-start", disabled: !pendingFile || aiRedrawing || isGenerating, onClick: () => void generateFromImage({ recordHistory: true, forceAiRedraw: true }), title: text.aiRedrawCost }, aiRedrawing
                        ? text.aiRedrawRunning
                        : aiHistory.length > 1
                            ? text.aiRedrawRegenerate
                            : text.aiRedrawStart))),
            React.createElement("section", { className: "left-card params-card" },
                React.createElement("div", { className: "left-card-header" },
                    React.createElement("div", null,
                        React.createElement("strong", { className: "field-label-with-help" },
                            text.patternParams,
                            React.createElement("span", { className: "help-dot image-help-dot", ...imageHelpProps(text.autoRefreshHint) }, "?"))),
                    React.createElement("small", null, text.paramsLocalNote)),
                React.createElement("div", { className: "param-rows" },
                    React.createElement("label", { className: "param-row" },
                        React.createElement("span", { className: "field-label-with-help" },
                            text.width,
                            React.createElement("span", { className: "help-dot image-help-dot", ...imageHelpProps(text.heightFromRatio) }, "?")),
                        React.createElement("input", { "aria-label": "Output width", type: "number", min: 8, max: 180, value: widthInput, onChange: (event) => {
                                const raw = event.target.value;
                                // 允许中间态为空（用户正在删），但立刻把上一档有效值记下来，
                                // 这样输入框里永远不会留下一个孤零零的 0，也不会出现 "0xx"
                                if (raw === '') {
                                    setWidthInput('');
                                    return;
                                }
                                const n = Number(raw);
                                if (!Number.isFinite(n)) {
                                    setWidthInput(String(convertWidth));
                                    return;
                                }
                                // 去掉多余前导零（例如 "052" → "52"）
                                const normalized = String(Math.floor(n)).replace(/^0+(?=\d)/, '');
                                setWidthInput(normalized);
                                if (n >= 1)
                                    setConvertWidth(Math.min(400, Math.floor(n)));
                            }, onFocus: () => setWidthInput(String(convertWidth)), onBlur: () => {
                                // 失焦时把空值/非法值纠正成一个真实可用的宽度
                                const fallback = Number.isFinite(convertWidth) && convertWidth >= 1
                                    ? convertWidth
                                    : defaultImportSettings.width;
                                const n = Number(widthInput);
                                const final = (widthInput === '' || !Number.isFinite(n) || n < 1)
                                    ? fallback
                                    : Math.max(8, Math.min(180, Math.floor(n)));
                                setConvertWidth(final);
                                setWidthInput(String(final));
                            } })),
                    React.createElement("label", { className: "param-row" },
                        React.createElement("span", { className: "field-label-with-help" },
                            text.colors,
                            React.createElement("span", { className: "help-dot image-help-dot", ...imageHelpProps(text.colorsHint) }, "?")),
                        React.createElement("input", { "aria-label": "Color limit", type: "range", min: 6, max: 48, step: 1, value: maxColors, onChange: (event) => setMaxColors(Number(event.target.value)) }),
                        React.createElement("strong", null, maxColors)),
                    React.createElement("label", { className: "param-row" },
                        React.createElement("span", { className: "field-label-with-help" },
                            text.tolerance,
                            React.createElement("span", { className: "help-dot image-help-dot", ...imageHelpProps(text.toleranceHint) }, "?")),
                        React.createElement("input", { "aria-label": "Background tolerance", type: "range", min: 0, max: 120, step: 1, value: tolerance, onChange: (event) => {
                                const next = Number(event.target.value);
                                setTolerance(next);
                                // 用户手动调过之后不再自动校准，滑条值就是实际值
                                setToleranceManual(true);
                            } }),
                        React.createElement("strong", null, tolerance)),
                    React.createElement("p", { className: "param-note" }, toleranceManual
                        ? text.toleranceManualNote
                        : text.toleranceAutoNote.replace('{v}', String(tolerance))),
                    React.createElement("label", { className: "param-row" },
                        React.createElement("span", null, text.background),
                        React.createElement("select", { "aria-label": "Background handling", value: backgroundMode, onChange: (event) => setBackgroundMode(event.target.value) },
                            React.createElement("option", { value: "keep" }, text.keepBackground),
                            React.createElement("option", { value: "remove-white" }, text.removeWhite))))),
            React.createElement("section", { className: "left-card reference-card" },
                React.createElement("div", { className: "left-card-header" },
                    React.createElement("div", null,
                        React.createElement("strong", null, text.referenceImage),
                        React.createElement("span", null, text.referenceHint)),
                    React.createElement("small", null, referenceImageUrl ? text.ready : text.noImage)),
                React.createElement("button", { className: referenceImageUrl ? 'upload-zone reference-upload-zone has-image' : 'upload-zone reference-upload-zone', onClick: () => referenceInputRef.current?.click() },
                    referenceImageUrl && React.createElement("img", { src: referenceImageUrl, alt: "" }),
                    React.createElement("span", { className: "upload-zone-text" },
                        React.createElement("strong", null, referenceFile ? referenceFile.name : text.uploadReferenceImage),
                        React.createElement("span", null, referenceFile ? 'PNG / JPG / WebP' : 'PNG, JPG, WebP'))),
                React.createElement("label", { className: "ref-row ref-row-switch" },
                    React.createElement("span", null, text.showReferenceImage),
                    React.createElement("input", { type: "checkbox", checked: referenceVisible, disabled: !referenceImageUrl, onChange: (event) => setReferenceVisible(event.target.checked) })),
                React.createElement("label", { className: "ref-row" },
                    React.createElement("span", null, text.referenceOpacity),
                    React.createElement("input", { "aria-label": "Reference opacity", type: "range", min: 0.1, max: 0.95, step: 0.05, value: 1 - referenceOpacity, disabled: !referenceImageUrl || !referenceVisible, onChange: (event) => setReferenceOpacity(1 - Number(event.target.value)) }),
                    React.createElement("strong", null,
                        Math.round((1 - referenceOpacity) * 100),
                        "%")),
                React.createElement("label", { className: "ref-row ref-row-switch" },
                    React.createElement("span", null, text.referenceAdjust),
                    React.createElement("input", { type: "checkbox", checked: referenceAdjusting, disabled: !referenceImageUrl || !referenceVisible, onChange: (event) => setReferenceAdjusting(event.target.checked) })),
                React.createElement("div", { className: "ref-row ref-row-actions" },
                    React.createElement("span", null, text.referencePlacement),
                    React.createElement("div", { className: "reference-placement-toggle", "aria-label": text.referencePlacement },
                        React.createElement("button", { type: "button", className: referencePlacement === 'below' ? 'active' : '', disabled: !referenceImageUrl, "aria-pressed": referencePlacement === 'below', onClick: () => setReferencePlacement('below') }, text.referenceBelow),
                        React.createElement("button", { type: "button", className: referencePlacement === 'above' ? 'active' : '', disabled: !referenceImageUrl, "aria-pressed": referencePlacement === 'above', onClick: () => setReferencePlacement('above') }, text.referenceAbove)),
                    React.createElement("button", { type: "button", className: "reference-reset-button", disabled: !referenceImageUrl, onClick: resetReferenceTransform }, text.resetReferenceTransform)))),
        React.createElement("aside", { className: "tool-rail" },
            tools.map((item) => (React.createElement("button", { key: item.id, className: tool === item.id ? 'tool-button active' : 'tool-button', "aria-label": text.tools[item.id].title, "aria-pressed": tool === item.id, type: "button", onPointerDown: (event) => {
                    if (event.pointerType === 'mouse')
                        return;
                    event.preventDefault();
                    activateTool(item.id);
                }, onClick: () => activateTool(item.id) },
                React.createElement(ToolIcon, { tool: item.id }),
                React.createElement("span", null, text.tools[item.id].title)))),
            tool === 'pencil' && showPencilOptions && (React.createElement("div", { className: "tool-options pencil-options", onMouseLeave: () => setShowPencilOptions(false) },
                React.createElement("div", { className: "right-click-toggle compact", "aria-label": text.rightClick },
                    React.createElement("span", { className: "field-label-with-help" },
                        text.rightClick,
                        React.createElement("span", { className: "help-dot mini", "data-tooltip": text.rightClickHint, "aria-label": text.rightClickHint, tabIndex: 0 }, "?")),
                    React.createElement("div", null, ['pan', 'erase'].map((action) => (React.createElement("button", { key: action, className: project.settings.rightClickAction === action ? 'active' : '', type: "button", "aria-pressed": project.settings.rightClickAction === action, onClick: () => updateProject({
                            ...project,
                            settings: { ...project.settings, rightClickAction: action },
                        }) }, action === 'pan' ? text.pan : text.erase))))))),
            tool === 'eraser' && showEraserOptions && (React.createElement("div", { className: "tool-options eraser-options", onMouseLeave: () => setShowEraserOptions(false) },
                React.createElement("div", { className: "tool-options-header" },
                    React.createElement("span", null, text.eraserSize),
                    React.createElement("strong", null, text.brushCells(eraserSize))),
                React.createElement("div", { className: "brush-preview", "aria-hidden": "true" }, eraserSize > 0 ? (React.createElement("span", { style: { width: `${10 + eraserSize * 3}px`, height: `${10 + eraserSize * 3}px` } })) : (React.createElement("span", { className: "brush-preview-dot" }))),
                React.createElement("input", { "aria-label": text.eraserSize, type: "range", min: 0, max: 9, step: 0.5, value: eraserSize, onChange: (event) => setEraserSize(Number(event.target.value)) }))),
            tool === 'remove' && showRemoveOptions && (React.createElement("div", { className: "tool-options remove-options", onMouseLeave: () => setShowRemoveOptions(false) },
                React.createElement("div", { className: "right-click-toggle compact remove-scope-toggle", "aria-label": text.removeScope },
                    React.createElement("span", null, text.removeScope),
                    React.createElement("div", null, ['same-connected', 'all-same-color', 'connected'].map((mode) => (React.createElement("button", { key: mode, className: removeMode === mode ? 'active' : '', type: "button", "aria-pressed": removeMode === mode, onClick: () => setRemoveMode(mode) }, mode === 'same-connected'
                        ? text.removeSameConnected
                        : mode === 'all-same-color'
                            ? text.removeAllSameColor
                            : text.removeConnected))))))),
            tool === 'move' && showMoveOptions && (React.createElement("div", { className: "tool-options move-options", onMouseLeave: () => setShowMoveOptions(false) },
                React.createElement("div", { className: "right-click-toggle compact", "aria-label": text.moveScope },
                    React.createElement("span", null, text.moveScope),
                    React.createElement("div", null, ['layer', 'partial'].map((mode) => (React.createElement("button", { key: mode, className: moveMode === mode ? 'active' : '', type: "button", "aria-pressed": moveMode === mode, onClick: () => setMoveMode(mode) }, mode === 'layer' ? text.moveLayer : text.movePartial))))))),
            (tool === 'copy' || tool === 'paste') && showClipboardOptions && (React.createElement("div", { className: `tool-options clipboard-options ${tool === 'copy' ? 'copy-options' : 'paste-options'}`, onMouseLeave: () => setShowClipboardOptions(false) },
                tool === 'copy' && (React.createElement("div", { className: "right-click-toggle compact clipboard-mode-toggle", "aria-label": text.copyScope },
                    React.createElement("span", null, text.copyScope),
                    React.createElement("div", null, ['connected', 'selection'].map((mode) => (React.createElement("button", { key: mode, className: copyMode === mode ? 'active' : '', type: "button", "aria-pressed": copyMode === mode, onClick: () => {
                            setCopyMode(mode);
                            setCopySelectionIndices([]);
                        } }, mode === 'connected' ? text.copyConnected : text.copySelection)))),
                    copyMode === 'selection' && React.createElement("p", { className: "tool-hint compact-hint" }, text.copySelectionHint))),
                React.createElement("div", { className: "clipboard-tool-header" },
                    React.createElement("div", null,
                        React.createElement("strong", null, text.clipboardPreview),
                        clipboardPattern && (React.createElement("span", null, text.clipboardSize(clipboardPattern.width, clipboardPattern.height, clipboardPattern.cells.filter(Boolean).length)))),
                    React.createElement("button", { className: "clipboard-reset-button", type: "button", "aria-label": text.resetClipboard, title: text.resetClipboard, disabled: !clipboardPattern && copySelectionIndices.length === 0, onClick: resetClipboard },
                        React.createElement(ResetIcon, null))),
                clipboardPattern ? (React.createElement(ClipboardPreview, { pattern: clipboardPattern })) : (React.createElement("div", { className: "clipboard-empty" }, text.clipboardEmpty)))),
            tool === 'mirror' && showMirrorOptions && (React.createElement("div", { className: "tool-options mirror-options", onMouseLeave: () => setShowMirrorOptions(false) },
                React.createElement("div", { className: "right-click-toggle compact", "aria-label": text.moveScope },
                    React.createElement("span", null, text.moveScope),
                    React.createElement("div", null, ['layer', 'partial'].map((mode) => (React.createElement("button", { key: mode, className: mirrorMode === mode ? 'active' : '', type: "button", "aria-pressed": mirrorMode === mode, onClick: () => setMirrorMode(mode) }, mode === 'layer' ? text.moveLayer : text.movePartial))))),
                React.createElement("div", { className: "right-click-toggle compact", "aria-label": text.mirrorDirection },
                    React.createElement("span", null, text.mirrorDirection),
                    React.createElement("div", null, ['horizontal', 'vertical'].map((direction) => (React.createElement("button", { key: direction, className: mirrorDirection === direction ? 'active' : '', type: "button", "aria-pressed": mirrorDirection === direction, onClick: () => setMirrorDirection(direction) }, direction === 'horizontal' ? text.mirrorHorizontal : text.mirrorVertical))))))),
            tool === 'shape' && showShapeOptions && (React.createElement("div", { className: "tool-options shape-options", onMouseLeave: () => setShowShapeOptions(false) },
                React.createElement("div", { className: "right-click-toggle compact", "aria-label": text.shapeStyle },
                    React.createElement("span", null, text.shapeStyle),
                    React.createElement("div", null, ['outline', 'filled'].map((mode) => (React.createElement("button", { key: mode, className: shapeFillMode === mode ? 'active' : '', type: "button", "aria-pressed": shapeFillMode === mode, disabled: shapeKind === 'line' || shapeKind === 'arrow', onClick: () => setShapeFillMode(mode) }, mode === 'outline' ? text.shapeOutline : text.shapeFilled))))),
                React.createElement("div", { className: "shape-picker", "aria-label": text.shapeType },
                    React.createElement("span", null, text.shapeType),
                    React.createElement("div", null, ['line', 'rectangle', 'square', 'ellipse', 'circle', 'triangle', 'arrow'].map((kind) => (React.createElement("button", { key: kind, className: shapeKind === kind ? 'active' : '', type: "button", "aria-pressed": shapeKind === kind, onClick: () => setShapeKind(kind) },
                        React.createElement(ShapeOptionIcon, { shape: kind }),
                        React.createElement("span", null, shapeLabel[kind])))))),
                shapeKind === 'arrow' && (React.createElement("div", { className: "shape-picker arrow-picker", "aria-label": text.arrowStyle },
                    React.createElement("span", null, text.arrowStyle),
                    React.createElement("div", null, ['single', 'double', 'block'].map((kind) => (React.createElement("button", { key: kind, className: arrowKind === kind ? 'active' : '', type: "button", "aria-pressed": arrowKind === kind, onClick: () => setArrowKind(kind) },
                        React.createElement(ArrowOptionIcon, { arrow: kind }),
                        React.createElement("span", null, arrowLabel[kind]))))))))),
            tool === 'text' && showTextOptions && (React.createElement("div", { className: "tool-options text-options" },
                React.createElement("label", { className: "text-tool-field" },
                    React.createElement("span", { className: "text-field-title" },
                        text.textContent,
                        React.createElement("button", { className: "tool-options-close", type: "button", "aria-label": text.close, title: text.close, onClick: () => setShowTextOptions(false) },
                            React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
                                React.createElement("path", { d: "M7 7l10 10" }),
                                React.createElement("path", { d: "M17 7L7 17" })))),
                    React.createElement("input", { type: "text", maxLength: 32, value: textToolValue, placeholder: text.textPlaceholder, onChange: (event) => setTextToolValue(event.target.value) })),
                React.createElement("div", { className: "right-click-toggle compact", "aria-label": text.textDirection },
                    React.createElement("span", null, text.textDirection),
                    React.createElement("div", null, ['horizontal', 'vertical'].map((direction) => (React.createElement("button", { key: direction, className: textToolDirection === direction ? 'active' : '', type: "button", "aria-pressed": textToolDirection === direction, onClick: () => setTextToolDirection(direction) }, direction === 'horizontal' ? text.textHorizontal : text.textVertical))))),
                React.createElement("div", { className: "tool-options-header" },
                    React.createElement("span", null, text.textSize),
                    React.createElement("label", { className: "tool-number-field", "aria-label": text.textSize },
                        React.createElement("input", { type: "number", min: 5, max: 72, step: 1, value: textToolSize, onChange: (event) => setTextToolSize(Math.min(72, Math.max(5, Number(event.target.value) || 5))) }),
                        React.createElement("span", null, language === 'zh' ? '格' : 'cells'))),
                React.createElement("input", { "aria-label": text.textSize, type: "range", min: 5, max: 72, step: 1, value: textToolSize, onChange: (event) => setTextToolSize(Number(event.target.value)) }),
                React.createElement("div", { className: "tool-options-header" },
                    React.createElement("span", null, text.textSpacing),
                    React.createElement("label", { className: "tool-number-field", "aria-label": text.textSpacing },
                        React.createElement("input", { type: "number", min: 0, max: 24, step: 1, value: textToolSpacing, onChange: (event) => setTextToolSpacing(Math.min(24, Math.max(0, Number(event.target.value) || 0))) }),
                        React.createElement("span", null, language === 'zh' ? '格' : 'cells'))),
                React.createElement("input", { "aria-label": text.textSpacing, type: "range", min: 0, max: 24, step: 1, value: textToolSpacing, onChange: (event) => setTextToolSpacing(Number(event.target.value)) }))),
            tool === 'pan' && showPanOptions && (React.createElement("div", { className: "tool-options pan-options", onMouseLeave: () => setShowPanOptions(false) },
                React.createElement("div", { className: "tool-options-header" },
                    React.createElement("strong", null, text.tools.pan.title)),
                React.createElement("p", { className: "tool-hint" }, text.panToolHint)))),
        React.createElement(WorkspaceCanvas, { project: displayProject, selectedColorId: selectedColorId, highlightedColorId: highlightedColorId, highlightedCellIndices: isolatedCellIndices, formatColorCode: displayCodeById, tool: tool, eraserSize: eraserSize, moveMode: moveMode, removeMode: removeMode, mirrorMode: mirrorMode, mirrorDirection: mirrorDirection, shapeKind: shapeKind, shapeFillMode: shapeFillMode, arrowKind: arrowKind, textToolValue: textToolValue, textToolDirection: textToolDirection, textToolSize: textToolSize, textToolSpacing: textToolSpacing, onTextToolSizeChange: setTextToolSize, referenceImageUrl: referenceImageUrl, referenceImageVisible: referenceVisible && !isGenerating, referenceImageOpacity: referenceOpacity, referenceImageScale: referenceScale, referenceImageOffset: referenceOffset, referenceImageAdjusting: referenceAdjusting && referenceVisible && !isGenerating, referenceImagePlacement: referencePlacement, referenceAdjustHint: text.referenceAdjustHint, onReferenceOffsetChange: setReferenceOffset, onReferenceScaleChange: setReferenceScale, onCommitStart: () => {
                setShowPencilOptions(false);
                setShowEraserOptions(false);
                setShowRemoveOptions(false);
                setShowMoveOptions(false);
                setShowMirrorOptions(false);
                setShowShapeOptions(false);
                setShowTextOptions(tool === 'text');
                setShowClipboardOptions(false);
                setShowPanOptions(false);
                commitHistory();
            }, onCellsChange: updateCells, onReplaceColor: replaceColor, clipboardPattern: clipboardPattern, copyMode: copyMode, copySelectionIndices: copySelectionIndices, onCopyPattern: (pattern, switchToPaste = true) => {
                const beads = pattern.cells.filter(Boolean).length;
                setClipboardPattern(pattern);
                if (switchToPaste)
                    setTool('paste');
                setShowPencilOptions(false);
                setShowEraserOptions(false);
                setShowRemoveOptions(false);
                setShowMoveOptions(false);
                setShowMirrorOptions(false);
                setShowShapeOptions(false);
                setShowTextOptions(false);
                setShowClipboardOptions(false);
                setShowPanOptions(false);
                setNotice(text.copiedPattern(pattern.width, pattern.height, beads));
            }, onCopySelectionChange: (indices, pattern) => {
                setCopySelectionIndices(indices);
                setClipboardPattern(pattern);
                setNotice(pattern ? text.copySelectionUpdated(pattern.cells.filter(Boolean).length) : text.clipboardReset);
            }, onPastePattern: () => setNotice(text.pastedPattern), onPickColor: (colorId) => {
                selectColor(colorId);
                setTool('pencil');
                setShowPencilOptions(false);
                setShowEraserOptions(false);
                setShowRemoveOptions(false);
                setShowMoveOptions(false);
                setShowMirrorOptions(false);
                setShowShapeOptions(false);
                setShowTextOptions(false);
                setShowClipboardOptions(false);
                setShowPanOptions(false);
                setNotice(language === 'zh' ? '已从画布拾取颜色。' : 'Color picked from canvas.');
            }, onHover: setHoverCell, fitLabel: text.fit, canEdit: !activeLayer.locked, lockedHint: text.lockedCanvasHint }),
        React.createElement("aside", { className: "right-panel" },
            React.createElement("div", { className: "right-tabs", role: "tablist", "aria-label": "Right panel" },
                React.createElement("button", { className: rightTab === 'palette' ? 'active' : '', role: "tab", "aria-selected": rightTab === 'palette', onClick: () => setRightTab('palette') }, text.palette),
                React.createElement("button", { className: rightTab === 'layers' ? 'active' : '', role: "tab", "aria-selected": rightTab === 'layers', onClick: () => setRightTab('layers') }, text.layers),
                React.createElement("button", { className: rightTab === 'usage' ? 'active' : '', role: "tab", "aria-selected": rightTab === 'usage', onClick: () => setRightTab('usage') }, text.usage),
                React.createElement("button", { className: rightTab === 'adjustments' ? 'active' : '', role: "tab", "aria-selected": rightTab === 'adjustments', onClick: () => setRightTab('adjustments') }, text.adjustments)),
            React.createElement("section", { className: `panel-section status-section${noticeIsError ? ' is-error' : ''}`, role: noticeIsError ? 'alert' : undefined },
                React.createElement("div", null,
                    React.createElement("strong", null, notice),
                    React.createElement("span", null, text.panelStatus(project.width, project.height, usage.length, totalBeads, boardCount))),
                noticeIsError ? (React.createElement("button", { type: "button", className: "status-copy-button", onClick: () => {
                        navigator.clipboard?.writeText(notice).then(() => setNotice(`${notice}\n（已复制到剪贴板）`), () => undefined);
                    } }, text.copyError)) : (React.createElement("span", { className: "status-pill" }, text.tools[tool].title))),
            rightTab === 'palette' && (React.createElement("section", { className: "panel-section panel-tab-body palette-section" },
                React.createElement("h2", null, text.palette),
                React.createElement("div", { className: "palette-selected-card" },
                    React.createElement("span", { style: { backgroundColor: selectedColor?.hex } }),
                    React.createElement("div", { className: "palette-selected-main" },
                        React.createElement("strong", null, selectedColor ? displayCode(selectedColor) : ''),
                        React.createElement("small", null, selectedColor ? displayName(selectedColor) : '')),
                    React.createElement("div", { className: "palette-selected-hex" },
                        React.createElement("small", null, selectedColor?.hex))),
                React.createElement("div", { className: "recent-colors-field" },
                    React.createElement("span", null, text.recentColors),
                    React.createElement("div", { className: "recent-color-row" }, recentColors.map((color) => (React.createElement("button", { key: color.id, type: "button", className: selectedColorId === color.id ? 'active' : '', title: `${displayCode(color)} ${displayName(color)}`, "aria-label": `${text.recentColors} ${displayCode(color)}`, onClick: () => selectColor(color.id, { updateRecent: false }) },
                        React.createElement("span", { style: { backgroundColor: color.hex } }),
                        React.createElement("small", null, displayCode(color))))))),
                React.createElement("div", { className: "readonly-brand-field" },
                    text.brandCodes,
                    React.createElement("select", { value: paletteMode, onChange: (event) => setPaletteMode(event.target.value) },
                        React.createElement("option", { value: "basic" }, text.mardBasic),
                        React.createElement("option", { value: "complete" }, text.mardComplete))),
                React.createElement("div", { className: "palette-filter", "aria-label": "Palette groups" }, paletteGroups.map((group) => (React.createElement("button", { key: group.id, className: paletteGroup === group.id ? 'active' : '', onClick: () => setPaletteGroup(group.id) }, group.label)))),
                React.createElement("div", { className: "palette-grid" }, visiblePalette.map((color) => (React.createElement("button", { key: color.id, className: selectedColorId === color.id ? 'swatch active' : 'swatch', title: `${displayCode(color)} ${displayName(color)}`, onClick: () => {
                        selectColor(color.id);
                    } },
                    React.createElement("span", { style: { backgroundColor: color.hex } }),
                    React.createElement("small", null, displayCode(color)))))))),
            rightTab === 'layers' && (React.createElement("section", { className: "panel-section panel-tab-body layers-section" },
                React.createElement("div", { className: "layers-header" },
                    React.createElement("h2", null, text.layers),
                    React.createElement("button", { onClick: addLayer }, text.addLayer)),
                React.createElement("button", { className: project.settings.showActiveLayerOnly ? 'layer-solo-toggle active' : 'layer-solo-toggle', type: "button", "aria-pressed": project.settings.showActiveLayerOnly, onClick: toggleActiveLayerOnly },
                    React.createElement(EyeIcon, { visible: project.settings.showActiveLayerOnly }),
                    React.createElement("span", null, text.showActiveLayerOnly)),
                React.createElement("div", { className: "layer-list", onDragLeave: (event) => {
                        if (!event.currentTarget.contains(event.relatedTarget))
                            setDragTarget(null);
                    } }, [...layers].reverse().map((layer) => {
                    const layerIndex = layers.findIndex((item) => item.id === layer.id);
                    const isActive = layer.id === activeLayer.id;
                    const beadCount = layer.cells.filter(Boolean).length;
                    const displayName = layerDisplayName(layer, layerIndex);
                    const rowClassName = [
                        'layer-row',
                        isActive ? 'active' : '',
                        draggingLayerId === layer.id ? 'dragging' : '',
                        dragTarget?.id === layer.id && draggingLayerId !== layer.id ? `drag-over-${dragTarget.edge}` : '',
                    ].filter(Boolean).join(' ');
                    return (React.createElement("div", { key: layer.id, className: rowClassName, onDragOver: (event) => {
                            if (!draggingLayerId || draggingLayerId === layer.id)
                                return;
                            event.preventDefault();
                            event.dataTransfer.dropEffect = 'move';
                            const nextTarget = dragTargetFromEvent(event, layer.id);
                            setDragTarget((current) => current?.id === nextTarget.id && current.edge === nextTarget.edge ? current : nextTarget);
                        }, onDrop: (event) => {
                            event.preventDefault();
                            const sourceId = event.dataTransfer.getData('text/plain') || draggingLayerId;
                            const nextTarget = dragTargetFromEvent(event, layer.id);
                            setDraggingLayerId(null);
                            setDragTarget(null);
                            if (sourceId)
                                moveLayer(sourceId, nextTarget);
                        } },
                        React.createElement("button", { className: "layer-drag-handle", draggable: true, title: text.reorderLayer, "aria-label": text.reorderLayer, onDragStart: (event) => {
                                event.dataTransfer.effectAllowed = 'move';
                                event.dataTransfer.setData('text/plain', layer.id);
                                const dragImage = document.createElement('canvas');
                                dragImage.width = 1;
                                dragImage.height = 1;
                                event.dataTransfer.setDragImage(dragImage, 0, 0);
                                setDraggingLayerId(layer.id);
                            }, onDragEnd: () => {
                                setDraggingLayerId(null);
                                setDragTarget(null);
                            } },
                            React.createElement(DragHandleIcon, null)),
                        React.createElement("button", { className: layer.visible ? 'mini-icon-toggle visibility-toggle active' : 'mini-icon-toggle visibility-toggle', title: layer.visible ? text.eye : text.hiddenLayer, "aria-label": layer.visible ? text.eye : text.hiddenLayer, onClick: (event) => {
                                event.stopPropagation();
                                updateLayer(layer.id, { visible: !layer.visible });
                            } },
                            React.createElement(EyeIcon, { visible: layer.visible })),
                        editingLayerId === layer.id ? (React.createElement("form", { className: "layer-main layer-name-editor", onSubmit: (event) => {
                                event.preventDefault();
                                saveEditingLayer(layer, layerIndex);
                            } },
                            React.createElement("input", { value: editingLayerName, "aria-label": text.renameLayer, autoFocus: true, onChange: (event) => setEditingLayerName(event.target.value), onBlur: () => saveEditingLayer(layer, layerIndex), onFocus: (event) => event.currentTarget.select(), onKeyDown: (event) => {
                                    if (event.key === 'Escape') {
                                        event.preventDefault();
                                        setEditingLayerId(null);
                                    }
                                } }),
                            React.createElement("span", { className: "layer-meta" }, layerMetaText(isActive, layer.visible, layer.locked, beadCount)),
                            React.createElement("label", { className: "checkline layer-count" },
                                React.createElement("input", { type: "checkbox", checked: layer.includeInUsage, onChange: (event) => updateLayer(layer.id, { includeInUsage: event.target.checked }) }),
                                text.countLayer))) : (React.createElement("div", { className: "layer-main layer-main-static", onClick: () => selectLayer(layer.id) },
                            React.createElement("div", { className: "layer-title-row" },
                                React.createElement("strong", null,
                                    React.createElement("span", null, displayName),
                                    React.createElement("button", { className: "layer-rename-button", type: "button", title: text.renameLayer, "aria-label": text.renameLayer, onClick: (event) => {
                                            event.stopPropagation();
                                            startEditingLayer(layer, layerIndex);
                                        } },
                                        React.createElement(PencilIcon, null)))),
                            React.createElement("span", { className: "layer-meta" }, layerMetaText(isActive, layer.visible, layer.locked, beadCount)),
                            React.createElement("label", { className: "checkline layer-count" },
                                React.createElement("input", { type: "checkbox", checked: layer.includeInUsage, onChange: (event) => updateLayer(layer.id, { includeInUsage: event.target.checked }) }),
                                text.countLayer))),
                        React.createElement("div", { className: "layer-actions" },
                            React.createElement("button", { className: layer.locked ? 'mini-icon-toggle active' : 'mini-icon-toggle', "aria-label": layer.locked ? text.unlock : text.lock, title: layer.locked ? text.unlockHint : text.lockHint, onClick: () => updateLayer(layer.id, { locked: !layer.locked }) },
                                React.createElement(LockIcon, { locked: layer.locked })),
                            React.createElement("button", { className: "mini-icon-toggle", "aria-label": text.duplicateLayer, title: text.duplicateLayer, onClick: () => duplicateLayer(layer.id) },
                                React.createElement(DuplicateIcon, null)),
                            React.createElement("button", { className: "mini-icon-toggle danger", disabled: layers.length <= 1, "aria-label": text.deleteLayer, title: text.deleteLayer, onClick: () => deleteLayer(layer.id) },
                                React.createElement(TrashIcon, null)))));
                })))),
            rightTab === 'usage' && (React.createElement("section", { className: "panel-section panel-tab-body usage-section" },
                React.createElement("h2", null, text.usage),
                React.createElement("div", { className: "usage-overview" },
                    React.createElement("div", null,
                        React.createElement("span", null, text.totalBeadsLabel),
                        React.createElement("strong", null, totalBeads)),
                    React.createElement("div", null,
                        React.createElement("span", null, text.colorTypes),
                        React.createElement("strong", null, usage.length)),
                    React.createElement("div", null,
                        React.createElement("span", null, text.estimatedPacks),
                        React.createElement("strong", null, totalPacks))),
                React.createElement("label", { className: "usage-pack-setting" },
                    React.createElement("span", null, text.beadsPerPack),
                    React.createElement("div", { className: "usage-pack-control" },
                        React.createElement("div", { className: "usage-pack-stepper" },
                            React.createElement("button", { type: "button", onClick: () => stepBeadsPerPack(-1) }, "-"),
                            React.createElement("input", { type: "number", min: 1, max: 10000, step: 500, value: project.settings.beadsPerPack, onChange: (event) => setBeadsPerPack(Number(event.target.value)) }),
                            React.createElement("button", { type: "button", onClick: () => stepBeadsPerPack(1) }, "+")),
                        React.createElement("small", null, text.perPackUnit))),
                React.createElement("div", { className: "usage-summary-card" },
                    React.createElement("div", { className: "usage-summary-head" },
                        React.createElement("strong", null, text.countedLayerTitle),
                        React.createElement("span", null, text.countedLayers(countedLayers.length))),
                    React.createElement("div", { className: "usage-layer-actions" },
                        React.createElement("button", { type: "button", className: countedLayers.length === layers.length ? 'active' : '', onClick: () => updateUsageLayerSelection(new Set(layers.map((layer) => layer.id))) }, text.countAllLayers),
                        React.createElement("button", { type: "button", className: countedLayers.length === 1 && countedLayers[0]?.id === activeLayer.id ? 'active' : '', onClick: () => updateUsageLayerSelection(new Set([activeLayer.id])) }, text.countCurrentLayer)),
                    React.createElement("div", { className: "usage-layer-chips" }, layers.map((layer) => {
                        const isIncluded = layer.includeInUsage;
                        return (React.createElement("button", { key: layer.id, type: "button", className: isIncluded ? 'active' : '', "aria-pressed": isIncluded, onClick: () => toggleUsageLayer(layer.id) }, layerDisplayName(layer, layers.findIndex((item) => item.id === layer.id))));
                    })),
                    countedLayers.length === 0 && React.createElement("div", { className: "usage-no-layers" }, text.noCountedLayers),
                    (usage.length > 32 || isolatedBeads > 0) && (React.createElement("div", { className: "usage-notes" },
                        usage.length > 32 && React.createElement("span", null, text.manyColors),
                        isolatedBeads > 0 && (React.createElement("span", { className: "usage-note-line" },
                            React.createElement("span", null, text.isolatedBeads(isolatedBeads)),
                            React.createElement("button", { className: showIsolatedBeads ? 'usage-note-eye active' : 'usage-note-eye', type: "button", title: showIsolatedBeads ? text.hideIsolatedBeads : text.showIsolatedBeads, "aria-label": showIsolatedBeads ? text.hideIsolatedBeads : text.showIsolatedBeads, "aria-pressed": showIsolatedBeads, onClick: () => setShowIsolatedBeads((current) => !current) },
                                React.createElement(EyeIcon, { visible: showIsolatedBeads }))))))),
                React.createElement("div", { className: "usage-list" },
                    usage.map((row) => (React.createElement("button", { key: row.color.id, onMouseEnter: () => setHighlightedColorId(row.color.id), onMouseLeave: () => setHighlightedColorId(null) },
                        React.createElement("span", { className: "usage-chip", style: { backgroundColor: row.color.hex } }),
                        React.createElement("span", { className: "usage-color-info" },
                            React.createElement("strong", null, displayCode(row.color)),
                            React.createElement("small", null, displayName(row.color))),
                        React.createElement("span", { className: "usage-count" },
                            React.createElement("strong", null, row.count),
                            React.createElement("small", null,
                                row.packs,
                                " ",
                                text.packUnit))))),
                    usage.length === 0 && React.createElement("div", { className: "usage-empty" }, text.noUsage)))),
            rightTab === 'adjustments' && (React.createElement("section", { className: "panel-section panel-tab-body adjustment-section" },
                React.createElement("div", { className: "adjustment-header" },
                    React.createElement("h2", null, text.adjustmentTitle),
                    React.createElement("span", null, layerDisplayName(activeLayer, layers.findIndex((item) => item.id === activeLayer.id)))),
                React.createElement("div", { className: "adjustment-help" }, text.adjustmentHint),
                [
                    ['brightness', text.brightness, -50, 50, '%'],
                    ['contrast', text.contrast, -50, 50, '%'],
                    ['saturation', text.saturation, -50, 50, '%'],
                    ['temperature', text.temperature, -50, 50, '%'],
                    ['hue', text.hue, -180, 180, 'deg'],
                ].map(([key, label, min, max, unit]) => (React.createElement("label", { className: "adjustment-range", key: key },
                    React.createElement("span", null,
                        React.createElement("span", null, label),
                        React.createElement("strong", null,
                            adjustments[key],
                            unit)),
                    React.createElement("input", { type: "range", min: min, max: max, step: key === 'hue' ? 5 : 1, value: adjustments[key], onChange: (event) => updateAdjustment(key, Number(event.target.value)) })))),
                React.createElement("div", { className: "adjustment-actions" },
                    React.createElement("button", { type: "button", onClick: resetAdjustments, disabled: !hasAdjustments(adjustments) }, text.resetAdjustments)),
                React.createElement("div", { className: "adjustment-effect-card" },
                    React.createElement("strong", null, text.effects),
                    React.createElement("div", { className: "adjustment-effect-grid" },
                        React.createElement("button", { type: "button", onClick: () => applyLayerEffect('invert', text.invertEffect), disabled: activeLayer.locked }, text.invertEffect),
                        React.createElement("button", { type: "button", onClick: () => applyLayerEffect('grayscale', text.grayscaleEffect), disabled: activeLayer.locked }, text.grayscaleEffect),
                        React.createElement("button", { type: "button", onClick: () => applyLayerEffect('blackWhite', text.blackWhiteEffect), disabled: activeLayer.locked }, text.blackWhiteEffect))),
                React.createElement("div", { className: "adjustment-tool-card" },
                    React.createElement("div", { className: "adjustment-tool-heading" },
                        React.createElement("strong", null, text.colorCleanup),
                        React.createElement("b", null, colorCleanupStrength)),
                    React.createElement("span", null, text.colorCleanupHint),
                    React.createElement("input", { "aria-label": "Color cleanup strength", type: "range", min: 1, max: 4, step: 1, value: colorCleanupStrength, onChange: (event) => setColorCleanupStrength(Number(event.target.value)) }),
                    React.createElement("button", { type: "button", onClick: applyColorCleanup, disabled: activeLayer.locked }, text.applyColorCleanup)),
                React.createElement("div", { className: "adjustment-tool-card" },
                    React.createElement("div", { className: "adjustment-tool-heading" },
                        React.createElement("strong", null, text.colorLimit),
                        React.createElement("b", null, layerColorLimit)),
                    React.createElement("span", null, text.colorLimitHint),
                    React.createElement("input", { "aria-label": "Layer color limit", type: "range", min: 2, max: 48, step: 1, value: layerColorLimit, onChange: (event) => setLayerColorLimit(Number(event.target.value)) }),
                    React.createElement("button", { type: "button", onClick: applyLayerColorLimit, disabled: activeLayer.locked }, text.applyColorLimit)))),
            rightTab === 'palette' && (React.createElement(React.Fragment, null,
                React.createElement("section", { className: "panel-section view-section" },
                    React.createElement("h2", null, text.view),
                    React.createElement("div", { className: "view-toggle-grid" },
                        React.createElement("div", { className: "view-shape-toggle", "aria-label": text.beadShape },
                            React.createElement("span", null, text.beadShape),
                            React.createElement("div", null,
                                React.createElement("button", { type: "button", className: project.settings.beadDisplayMode === 'bead' ? 'active' : '', "aria-pressed": project.settings.beadDisplayMode === 'bead', onClick: () => updateProject({ ...project, settings: { ...project.settings, beadDisplayMode: 'bead' } }) },
                                    React.createElement("span", { className: "shape-choice-icon shape-choice-icon-round", "aria-hidden": "true" }),
                                    React.createElement("span", null, text.roundBeads)),
                                React.createElement("button", { type: "button", className: project.settings.beadDisplayMode === 'pixel' ? 'active' : '', "aria-pressed": project.settings.beadDisplayMode === 'pixel', onClick: () => updateProject({ ...project, settings: { ...project.settings, beadDisplayMode: 'pixel' } }) },
                                    React.createElement("span", { className: "shape-choice-icon shape-choice-icon-square", "aria-hidden": "true" }),
                                    React.createElement("span", null, text.squareBeads)))),
                        React.createElement("div", { className: "view-row" },
                            React.createElement("label", { className: "checkline" },
                                React.createElement("input", { type: "checkbox", checked: project.settings.showGrid, onChange: (event) => updateProject({ ...project, settings: { ...project.settings, showGrid: event.target.checked } }) }),
                                text.grid),
                            React.createElement("label", { className: "checkline" },
                                React.createElement("input", { type: "checkbox", checked: project.settings.showCoordinates, onChange: (event) => updateProject({ ...project, settings: { ...project.settings, showCoordinates: event.target.checked } }) }),
                                text.coordinates)),
                        React.createElement("div", { className: "view-row" },
                            React.createElement("label", { className: "checkline" },
                                React.createElement("input", { type: "checkbox", checked: project.settings.showColorCodes, onChange: (event) => updateProject({ ...project, settings: { ...project.settings, showColorCodes: event.target.checked } }) }),
                                text.showColorCodes),
                            React.createElement("label", { className: "checkline" },
                                React.createElement("input", { type: "checkbox", checked: project.settings.showLayerOverlap, onChange: (event) => updateProject({ ...project, settings: { ...project.settings, showLayerOverlap: event.target.checked } }) }),
                                text.layerOverlap)))),
                React.createElement("section", { className: "panel-section hover-section" },
                    React.createElement("h2", null, text.cell),
                    hoverCell ? (React.createElement("span", null,
                        "R",
                        hoverCell.y + 1,
                        " C",
                        hoverCell.x + 1,
                        " - ",
                        getColor(hoverCell.colorId)?.primaryCode ?? text.empty)) : (React.createElement("span", null, text.hoverBoard)))))),
        noticeIsError && (React.createElement("div", { className: "error-banner", role: "alert" },
            React.createElement("span", { className: "error-banner-icon", "aria-hidden": "true" }, "!"),
            React.createElement("div", { className: "error-banner-body" },
                React.createElement("strong", null, notice)),
            React.createElement("button", { type: "button", className: "error-banner-action", onClick: () => {
                    navigator.clipboard?.writeText(notice).catch(() => undefined);
                } }, text.copyError),
            React.createElement("button", { type: "button", className: "error-banner-close", "aria-label": text.close, onClick: () => setNoticeIsError(false) }, "\u00D7"))),
        floatingHelp && (React.createElement("div", { className: "floating-help-tooltip", style: { left: floatingHelp.left, top: floatingHelp.top } }, floatingHelp.text))));
}
function hasAdjustments(adjustments) {
    return (adjustments.brightness !== 0 ||
        adjustments.contrast !== 0 ||
        adjustments.saturation !== 0 ||
        adjustments.temperature !== 0 ||
        adjustments.hue !== 0);
}
function adjustLayerCells(cells, adjustments, activePalette) {
    if (!hasAdjustments(adjustments))
        return cells;
    const cache = new Map();
    return cells.map((colorId) => {
        if (!colorId)
            return null;
        const cached = cache.get(colorId);
        if (cached)
            return cached;
        const color = getColor(colorId);
        if (!color)
            return colorId;
        const adjustedRgb = adjustRgb(color.rgb, adjustments);
        const mapped = nearestPaletteColor(adjustedRgb, activePalette);
        cache.set(colorId, mapped.id);
        return mapped.id;
    });
}
function adjustRgb(rgb, adjustments) {
    const contrastValue = adjustments.contrast * 2.55;
    const contrastFactor = (259 * (contrastValue + 255)) / (255 * (259 - contrastValue));
    const warmed = [
        clampByte(rgb[0] + adjustments.temperature * 1.35),
        clampByte(rgb[1] + adjustments.temperature * 0.28),
        clampByte(rgb[2] - adjustments.temperature * 1.35),
    ];
    const contrasted = warmed.map((channel) => clampByte(contrastFactor * (channel - 128) + 128 + adjustments.brightness * 2.55));
    const hsl = rgbToHsl(contrasted);
    hsl.h = (hsl.h + adjustments.hue + 360) % 360;
    hsl.s = Math.max(0, Math.min(1, hsl.s * (1 + adjustments.saturation / 100)));
    return hslToRgb(hsl.h, hsl.s, hsl.l);
}
function mergeCloseLayerColors(cells, activePalette, strength) {
    const stats = collectLayerColorStats(cells, activePalette);
    if (stats.length < 2)
        return { cells, changed: 0 };
    const level = Math.max(1, Math.min(4, Math.round(strength)));
    const replacements = new Map();
    const sorted = [...stats].sort((a, b) => a.count - b.count);
    sorted.forEach((source) => {
        const target = stats
            .filter((candidate) => candidate.id !== source.id && candidate.count >= source.count)
            .map((candidate) => ({
            candidate,
            distance: colorDistance(source.color.rgb, candidate.color.rgb),
        }))
            .filter((item) => areLayerColorsClose(source.color, item.candidate.color, level))
            .sort((a, b) => {
            const aScore = a.distance - Math.min(18, Math.log2(a.candidate.count + 1) * 2.2);
            const bScore = b.distance - Math.min(18, Math.log2(b.candidate.count + 1) * 2.2);
            return aScore - bScore;
        })[0]?.candidate;
        if (target)
            replacements.set(source.id, replacements.get(target.id) ?? target.id);
    });
    if (replacements.size === 0)
        return { cells, changed: 0 };
    let changed = 0;
    const next = cells.map((colorId) => {
        if (!colorId)
            return null;
        const replacement = replacements.get(colorId);
        if (!replacement || replacement === colorId)
            return colorId;
        changed += 1;
        return replacement;
    });
    return { cells: next, changed };
}
function areLayerColorsClose(from, to, strength) {
    const level = Math.max(1, Math.min(4, Math.round(strength)));
    const fromChroma = rgbChroma(from.rgb);
    const toChroma = rgbChroma(to.rgb);
    const fromLum = rgbLuminance(from.rgb);
    const toLum = rgbLuminance(to.rgb);
    const fromHsl = rgbToHsl(from.rgb);
    const toHsl = rgbToHsl(to.rgb);
    const neutral = fromChroma < 34 && toChroma < 34;
    const vivid = fromChroma > 72 || toChroma > 72;
    const luminanceGap = Math.abs(fromLum - toLum);
    const chromaGap = Math.abs(fromChroma - toChroma);
    const hueGap = Math.min(Math.abs(fromHsl.h - toHsl.h), 360 - Math.abs(fromHsl.h - toHsl.h));
    const distance = colorDistance(from.rgb, to.rgb);
    if (neutral) {
        return distance <= [0, 48, 68, 88, 108][level] && luminanceGap <= [0, 30, 44, 60, 76][level];
    }
    if (vivid && hueGap > [0, 12, 18, 28, 38][level])
        return false;
    if (chromaGap > [0, 30, 44, 60, 76][level])
        return false;
    if (luminanceGap > [0, 34, 50, 68, 84][level])
        return false;
    const distanceLimit = vivid ? [0, 34, 50, 66, 82][level] : [0, 44, 64, 84, 104][level];
    if (distance <= distanceLimit)
        return true;
    return hueGap <= [0, 14, 24, 36, 48][level] && distance <= distanceLimit * 1.18;
}
function limitLayerColors(cells, activePalette, limit) {
    const targetLimit = Math.max(2, Math.min(48, Math.round(limit)));
    const stats = collectLayerColorStats(cells, activePalette);
    if (stats.length <= targetLimit)
        return { cells, changed: 0 };
    const kept = selectLayerColorRepresentatives(stats, targetLimit);
    const keptIds = new Set(kept.map((row) => row.id));
    const keptColors = kept.map((row) => row.color);
    let changed = 0;
    const next = cells.map((colorId) => {
        if (!colorId || keptIds.has(colorId))
            return colorId;
        const color = getColor(colorId);
        if (!color)
            return colorId;
        const replacement = nearestPaletteColor(color.rgb, keptColors).id;
        if (replacement !== colorId)
            changed += 1;
        return replacement;
    });
    return { cells: next, changed };
}
function applyEffectToLayer(cells, activePalette, effect) {
    const cache = new Map();
    let changed = 0;
    const next = cells.map((colorId) => {
        if (!colorId)
            return null;
        const cached = cache.get(colorId);
        if (cached) {
            if (cached !== colorId)
                changed += 1;
            return cached;
        }
        const color = getColor(colorId);
        if (!color)
            return colorId;
        const mapped = nearestPaletteColor(effectRgb(color.rgb, effect), activePalette).id;
        cache.set(colorId, mapped);
        if (mapped !== colorId)
            changed += 1;
        return mapped;
    });
    return { cells: next, changed };
}
function effectRgb(rgb, effect) {
    const luminance = clampByte(rgbLuminance(rgb));
    if (effect === 'invert')
        return [255 - rgb[0], 255 - rgb[1], 255 - rgb[2]];
    if (effect === 'blackWhite') {
        const value = luminance >= 150 ? 255 : 0;
        return [value, value, value];
    }
    return [luminance, luminance, luminance];
}
function collectLayerColorStats(cells, activePalette) {
    const paletteIds = new Set(activePalette.map((color) => color.id));
    const counts = new Map();
    cells.forEach((colorId) => {
        if (!colorId)
            return;
        counts.set(colorId, (counts.get(colorId) ?? 0) + 1);
    });
    return [...counts.entries()]
        .flatMap(([id, count]) => {
        const color = getColor(id);
        if (!color)
            return [];
        const normalized = paletteIds.has(id) ? color : nearestPaletteColor(color.rgb, activePalette);
        return [{ id, color: normalized, count }];
    })
        .sort((a, b) => b.count - a.count);
}
function selectLayerColorRepresentatives(stats, limit) {
    const kept = [stats[0]];
    const keptIds = new Set([stats[0].id]);
    while (kept.length < limit) {
        const next = stats
            .filter((row) => !keptIds.has(row.id))
            .map((row) => {
            const nearestDistance = Math.min(...kept.map((item) => colorDistance(row.color.rgb, item.color.rgb)));
            const chroma = rgbChroma(row.color.rgb);
            const luminance = rgbLuminance(row.color.rgb);
            const accentBoost = chroma > 70 || luminance < 42 ? 1.8 : chroma > 45 ? 1.25 : 1;
            const score = Math.sqrt(row.count) * Math.max(0.4, nearestDistance / 18) * accentBoost;
            return { row, score };
        })
            .sort((a, b) => b.score - a.score)[0]?.row;
        if (!next)
            break;
        kept.push(next);
        keptIds.add(next.id);
    }
    return kept;
}
function rgbChroma(rgb) {
    return Math.max(rgb[0], rgb[1], rgb[2]) - Math.min(rgb[0], rgb[1], rgb[2]);
}
function rgbLuminance(rgb) {
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function clampByte(value) {
    return Math.max(0, Math.min(255, Math.round(value)));
}
function rgbToHsl([r, g, b]) {
    const red = r / 255;
    const green = g / 255;
    const blue = b / 255;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const lightness = (max + min) / 2;
    if (max === min)
        return { h: 0, s: 0, l: lightness };
    const delta = max - min;
    const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    let hue = 0;
    if (max === red)
        hue = (green - blue) / delta + (green < blue ? 6 : 0);
    else if (max === green)
        hue = (blue - red) / delta + 2;
    else
        hue = (red - green) / delta + 4;
    return { h: hue * 60, s: saturation, l: lightness };
}
function hslToRgb(hue, saturation, lightness) {
    if (saturation === 0) {
        const value = clampByte(lightness * 255);
        return [value, value, value];
    }
    const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
    const p = 2 * lightness - q;
    const hk = hue / 360;
    const convert = (t) => {
        let value = t;
        if (value < 0)
            value += 1;
        if (value > 1)
            value -= 1;
        if (value < 1 / 6)
            return p + (q - p) * 6 * value;
        if (value < 1 / 2)
            return q;
        if (value < 2 / 3)
            return p + (q - p) * (2 / 3 - value) * 6;
        return p;
    };
    return [clampByte(convert(hk + 1 / 3) * 255), clampByte(convert(hk) * 255), clampByte(convert(hk - 1 / 3) * 255)];
}
function clampInteger(value, min, max) {
    if (Number.isNaN(value))
        return min;
    return Math.min(max, Math.max(min, Math.round(value)));
}
function ExportIcon() {
    return (React.createElement("svg", { viewBox: "0 0 20 20", "aria-hidden": "true" },
        React.createElement("path", { d: "M10 3v9" }),
        React.createElement("path", { d: "m6.8 8.8 3.2 3.2 3.2-3.2" }),
        React.createElement("path", { d: "M4 13.2v2.6c0 .7.5 1.2 1.2 1.2h9.6c.7 0 1.2-.5 1.2-1.2v-2.6" })));
}
function GitHubIcon() {
    return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
        React.createElement("path", { d: "M12 2.5a9.5 9.5 0 0 0-3 18.5c.48.08.66-.2.66-.46v-1.7c-2.68.58-3.25-1.14-3.25-1.14-.44-1.1-1.07-1.4-1.07-1.4-.88-.6.07-.58.07-.58.97.07 1.48 1 1.48 1 .86 1.47 2.25 1.04 2.8.8.09-.62.34-1.04.61-1.28-2.14-.24-4.39-1.07-4.39-4.76 0-1.05.38-1.91 1-2.58-.1-.25-.43-1.24.1-2.55 0 0 .81-.26 2.66.99a9.16 9.16 0 0 1 4.84 0c1.85-1.25 2.66-.99 2.66-.99.53 1.31.2 2.3.1 2.55.62.67 1 1.53 1 2.58 0 3.7-2.26 4.51-4.4 4.75.35.3.66.9.66 1.81v2.5c0 .26.17.55.67.46A9.5 9.5 0 0 0 12 2.5z" })));
}
function CloseIcon() {
    return (React.createElement("svg", { viewBox: "0 0 20 20", "aria-hidden": "true" },
        React.createElement("path", { d: "M6 6l8 8" }),
        React.createElement("path", { d: "M14 6l-8 8" })));
}
function resizeCells(cells, oldWidth, oldHeight, newWidth, newHeight) {
    const next = Array.from({ length: newWidth * newHeight }, () => null);
    const copyWidth = Math.min(oldWidth, newWidth);
    const copyHeight = Math.min(oldHeight, newHeight);
    for (let y = 0; y < copyHeight; y += 1) {
        for (let x = 0; x < copyWidth; x += 1) {
            next[y * newWidth + x] = cells[y * oldWidth + x] ?? null;
        }
    }
    return next;
}
function LockIcon({ locked }) {
    return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
        React.createElement("rect", { x: "5.5", y: "10", width: "13", height: "10", rx: "2" }),
        React.createElement("path", { d: locked ? 'M8.5 10V7.7a3.5 3.5 0 017 0V10' : 'M8.5 10V7.7a3.5 3.5 0 016.4-2' })));
}
function PencilIcon() {
    return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
        React.createElement("path", { d: "M4 20l4.6-1 9.8-9.8-3.6-3.6L5 15.4 4 20z" }),
        React.createElement("path", { d: "M13.8 4.6l1.5-1.5c.7-.7 1.8-.7 2.5 0l1.1 1.1c.7.7.7 1.8 0 2.5l-1.5 1.5" })));
}
function DuplicateIcon() {
    return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
        React.createElement("rect", { x: "8", y: "8", width: "11", height: "11", rx: "2" }),
        React.createElement("path", { d: "M5 16V6.8C5 5.8 5.8 5 6.8 5H16" })));
}
function DragHandleIcon() {
    return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
        React.createElement("path", { d: "M9 5h.1M15 5h.1M9 12h.1M15 12h.1M9 19h.1M15 19h.1" })));
}
function EyeIcon({ visible }) {
    return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
        React.createElement("path", { d: "M2.8 12s3.3-5.5 9.2-5.5 9.2 5.5 9.2 5.5-3.3 5.5-9.2 5.5S2.8 12 2.8 12z" }),
        React.createElement("circle", { cx: "12", cy: "12", r: "2.5" }),
        !visible && React.createElement("path", { d: "M4 4l16 16" })));
}
function TrashIcon() {
    return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
        React.createElement("path", { d: "M4 7h16" }),
        React.createElement("path", { d: "M9 7V4.8h6V7" }),
        React.createElement("path", { d: "M7 7l.8 13h8.4L17 7" }),
        React.createElement("path", { d: "M10 11v5M14 11v5" })));
}
function ResetIcon() {
    return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
        React.createElement("path", { d: "M4.5 11a7.5 7.5 0 1 1 2.2 5.3" }),
        React.createElement("path", { d: "M4.5 5.5V11h5.5" })));
}
function ClipboardPreview({ pattern }) {
    const maxSide = Math.max(pattern.width, pattern.height, 1);
    const beadSize = Math.max(3, Math.min(10, Math.floor(76 / maxSide)));
    return (React.createElement("div", { className: "clipboard-preview", style: {
            gridTemplateColumns: `repeat(${pattern.width}, ${beadSize}px)`,
            gridAutoRows: `${beadSize}px`,
        }, "aria-hidden": "true" }, pattern.cells.map((colorId, index) => {
        const color = colorId ? getColor(colorId) : null;
        return React.createElement("span", { key: index, style: { background: color?.hex ?? 'transparent' } });
    })));
}
function ToolIcon({ tool }) {
    if (tool === 'pencil') {
        return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
            React.createElement("path", { d: "M4 20l4.7-1 9.8-9.8-3.7-3.7L5 15.3 4 20z" }),
            React.createElement("path", { d: "M13.8 4.5l1.7-1.7c.7-.7 1.8-.7 2.5 0l1.2 1.2c.7.7.7 1.8 0 2.5l-1.7 1.7" })));
    }
    if (tool === 'eraser') {
        return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
            React.createElement("path", { d: "M4.3 14.6l7.9-7.9c.8-.8 2-.8 2.8 0l4.3 4.3c.8.8.8 2 0 2.8l-5.9 5.9H8.6l-4.3-4.3c-.2-.2-.2-.6 0-.8z" }),
            React.createElement("path", { d: "M9.8 19.7h10" })));
    }
    if (tool === 'fill') {
        return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
            React.createElement("path", { d: "M5 12.5l6.5-6.5 7 7-6 6c-.8.8-2 .8-2.8 0L5 14.3c-.5-.5-.5-1.3 0-1.8z" }),
            React.createElement("path", { d: "M8.5 8.5l-2-2" }),
            React.createElement("path", { d: "M17.5 17.2c.8 1.1 1.2 1.9 1.2 2.4 0 1-.7 1.6-1.6 1.6s-1.6-.6-1.6-1.6c0-.5.4-1.3 1.2-2.4.2-.3.6-.3.8 0z" })));
    }
    if (tool === 'remove') {
        return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
            React.createElement("path", { d: "M5 12.5l6.5-6.5 7 7-6 6c-.8.8-2 .8-2.8 0L5 14.3c-.5-.5-.5-1.3 0-1.8z" }),
            React.createElement("path", { d: "M8.5 8.5l-2-2" }),
            React.createElement("path", { d: "M15.5 17.5l4 4M19.5 17.5l-4 4" })));
    }
    if (tool === 'recolor') {
        return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
            React.createElement("path", { d: "M6 7.5h7.2c2.2 0 4 1.8 4 4v.3" }),
            React.createElement("path", { d: "M9 4.5 6 7.5l3 3" }),
            React.createElement("path", { d: "M18 16.5h-7.2c-2.2 0-4-1.8-4-4v-.3" }),
            React.createElement("path", { d: "M15 19.5l3-3-3-3" }),
            React.createElement("path", { d: "M8 16.2c.9 1.2 1.3 2 1.3 2.6 0 1-.7 1.7-1.7 1.7S6 19.8 6 18.8c0-.6.4-1.4 1.3-2.6.2-.3.5-.3.7 0z" })));
    }
    if (tool === 'eyedropper') {
        return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
            React.createElement("path", { d: "M14.8 4.3l4.9 4.9-3.1 3.1-1.5-1.5-7.9 7.9H4.8v-2.4l7.9-7.9-1.1-1.1 3.2-3z" }),
            React.createElement("path", { d: "M5 20h6" })));
    }
    if (tool === 'move') {
        return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
            React.createElement("path", { d: "M12 3v18" }),
            React.createElement("path", { d: "M8.5 6.5 12 3l3.5 3.5" }),
            React.createElement("path", { d: "M8.5 17.5 12 21l3.5-3.5" }),
            React.createElement("path", { d: "M3 12h18" }),
            React.createElement("path", { d: "M6.5 8.5 3 12l3.5 3.5" }),
            React.createElement("path", { d: "M17.5 8.5 21 12l-3.5 3.5" })));
    }
    if (tool === 'copy') {
        return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
            React.createElement("rect", { x: "8", y: "8", width: "11", height: "11", rx: "2" }),
            React.createElement("path", { d: "M5 16V6.8C5 5.8 5.8 5 6.8 5H16" }),
            React.createElement("path", { d: "M11 12h5M13.5 9.5v5" })));
    }
    if (tool === 'paste') {
        return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
            React.createElement("path", { d: "M9 5h6l1 2h2.2c.9 0 1.8.8 1.8 1.8v9.4c0 1-.8 1.8-1.8 1.8H5.8c-1 0-1.8-.8-1.8-1.8V8.8C4 7.8 4.8 7 5.8 7H8z" }),
            React.createElement("path", { d: "M9 5c0-1.1.8-2 2-2h2c1.2 0 2 .9 2 2" }),
            React.createElement("path", { d: "M8 12h8M8 16h5" })));
    }
    if (tool === 'mirror') {
        return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
            React.createElement("path", { d: "M12 4v16" }),
            React.createElement("path", { d: "M5 7.5h4v9H5z" }),
            React.createElement("path", { d: "M19 7.5h-4v9h4z" }),
            React.createElement("path", { d: "M9 12h6" }),
            React.createElement("path", { d: "M7 5.5 5 7.5l2 2" }),
            React.createElement("path", { d: "M17 5.5l2 2-2 2" })));
    }
    if (tool === 'shape') {
        return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
            React.createElement("path", { d: "M4.5 16.5 9 8.5l4 7.5z" }),
            React.createElement("path", { d: "M13.8 5.2h5v5h-5z" }),
            React.createElement("path", { d: "M14.8 17.4a2.8 2.8 0 1 0 5.6 0 2.8 2.8 0 0 0-5.6 0z" })));
    }
    if (tool === 'text') {
        return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
            React.createElement("path", { d: "M5 6h14" }),
            React.createElement("path", { d: "M12 6v12" }),
            React.createElement("path", { d: "M8.5 18h7" })));
    }
    return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
        React.createElement("path", { d: "M8.5 11.5V6.8a2 2 0 0 1 4 0v4.5" }),
        React.createElement("path", { d: "M12.5 11V5.5a2 2 0 0 1 4 0V12" }),
        React.createElement("path", { d: "M16.5 12V8.2a2 2 0 0 1 4 0v6.3c0 3.8-2.7 6.5-6.7 6.5h-1.5c-2.1 0-3.6-.8-4.9-2.4L4.6 15c-.6-.8-.4-1.9.4-2.4.6-.4 1.4-.3 1.9.2l1.6 1.7v-3z" })));
}
function ShapeOptionIcon({ shape }) {
    if (shape === 'line') {
        return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
            React.createElement("path", { d: "M5 19 19 5" })));
    }
    if (shape === 'rectangle') {
        return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
            React.createElement("path", { d: "M5 7h14v10H5z" })));
    }
    if (shape === 'square') {
        return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
            React.createElement("path", { d: "M6.5 6.5h11v11h-11z" })));
    }
    if (shape === 'ellipse') {
        return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
            React.createElement("path", { d: "M4.5 12a7.5 5.2 0 1 0 15 0 7.5 5.2 0 0 0-15 0z" })));
    }
    if (shape === 'circle') {
        return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
            React.createElement("path", { d: "M5.5 12a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0z" })));
    }
    if (shape === 'triangle') {
        return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
            React.createElement("path", { d: "M12 5 19 18H5z" })));
    }
    return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
        React.createElement("path", { d: "M5 12h12" }),
        React.createElement("path", { d: "M13 8l4 4-4 4" })));
}
function ArrowOptionIcon({ arrow }) {
    if (arrow === 'double') {
        return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
            React.createElement("path", { d: "M6 12h12" }),
            React.createElement("path", { d: "M10 8 6 12l4 4" }),
            React.createElement("path", { d: "M14 8l4 4-4 4" })));
    }
    if (arrow === 'block') {
        return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
            React.createElement("path", { d: "M5 9h8V6l6 6-6 6v-3H5z" })));
    }
    return (React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
        React.createElement("path", { d: "M5 12h12" }),
        React.createElement("path", { d: "M13 8l4 4-4 4" })));
}
//# sourceMappingURL=App.js.map