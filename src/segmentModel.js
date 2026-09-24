/**
 * 「主体分割模型」加载器（B36）。
 *
 * 干什么：用 Google MediaPipe 的 **Selfie Multiclass 256×256** 模型算一张「每个像素属于哪一类」的图
 * （0=背景 / 1=头发 / 2=身体皮肤 / 3=面部皮肤 / 4=衣服 / 5=其它），交给 `subjectGate` 去判断
 * 「这张图适不适合用模型抠」。模型只认**人（和宠物）**，风景 / 卡通 / 像素画它一概不认 —— 那不是缺陷，
 * 判断程序会把那些图分流回原本的算法（改前的那套）。
 *
 * 为什么这样做（而不是把模型塞进仓库）：
 * - 模型 + WebAssembly 运行时合计约 **24.7 MB**，放进仓库会让发布产物翻好几倍；
 * - 所以从 CDN 取，**只按顺序试**，任一成功即可；
 * - **任何一步失败都返回 `null`**，调用方原样走老算法 —— 功能绝不会因为模型不可用而坏掉。
 *
 * ⚠️ 许可：MediaPipe（`@mediapipe/tasks-vision`）与模型都是 **Apache-2.0**（包内 `package.json` 声明）。
 * 上线页脚已放出处与许可链接，见 `src/App.tsx` 的 `MODEL_CREDIT` 区块。
 *
 * ⚠️ 体积的真相：模型 `.tflite` 只有 15.6 MB 的**权重**，真正干活的是 9.0 MB 的 `vision_wasm_internal.wasm`。
 * 单说「模型 15.6 MB」会让人以为整套就这么大，实际首次传输约 24.7 MB。
 */
const PACKAGE_VERSION = '0.10.14';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite';
/**
 * 同源（JS 封装 + WASM 运行时）的候选取源，**按顺序试，首个成功即用**。
 * - 第 1 个是国内镜像（实测 24.7 MB ≈ 3.6 秒，jsdelivr 要 1.1 分钟，所以镜像排前面）；
 * - 第 2 个是官方 CDN，作为镜像站不可用时的退路；
 * - 要改成「自己托管」，只需在数组末尾加一个本地路径（例如 `/vendor/mediapipe/wasm`），代码不用动。
 */
const WASM_SOURCES = [
    `https://registry.npmmirror.com/@mediapipe/tasks-vision/${PACKAGE_VERSION}/files`,
    `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${PACKAGE_VERSION}`,
];
let loadPromise = null;
let loaded = false;
/** 载入进度（0~1）；`null` 表示还没开始或已结束。给界面显示「模型准备中」用，失败时不报错。 */
let progress = null;
export function getModelLoadProgress() {
    return progress;
}
export function isModelReady() {
    return loaded;
}
/** 用 fetch 探测某个候选取源是否真的能拿到 bundle（`import()` 失败时不一定给得出原因，先探一次更好定位） */
async function probe(url) {
    try {
        const response = await fetch(url, { method: 'HEAD' });
        return response.ok;
    }
    catch {
        return false;
    }
}
async function loadSegmenter() {
    for (let index = 0; index < WASM_SOURCES.length; index += 1) {
        const base = WASM_SOURCES[index];
        const bundleUrl = `${base}/vision_bundle.mjs`;
        progress = (index + 0.5) / (WASM_SOURCES.length + 1);
        // 先探测再 import：镜像站404/被墙时，import 的报错信息很难读，探测一次能把原因说清楚
        if (!(await probe(bundleUrl)))
            continue;
        try {
            const vision = (await import(/* @vite-ignore */ bundleUrl));
            const fileset = await vision.FilesetResolver.forVisionTasks(`${base}/wasm`);
            progress = (index + 0.9) / (WASM_SOURCES.length + 1);
            const segmenter = await vision.ImageSegmenter.createFromOptions(fileset, {
                baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
                runningMode: 'IMAGE',
                outputCategoryMask: true,
                outputConfidenceMasks: false,
            });
            progress = null;
            loaded = true;
            return segmenter;
        }
        catch {
            // 换下一个源；全都失败就返回 null（调用方走老算法）
            continue;
        }
    }
    progress = null;
    return null;
}
/** 幂等：多次调用只会真正加载一次（并发调用共享同一个 Promise） */
export function ensureSegmenter() {
    if (!loadPromise)
        loadPromise = loadSegmenter();
    return loadPromise;
}
/**
 * 算主体掩膜。**任何失败都返回 `null`**，调用方必须把 `null` 当成「这次不用模型」，
 * 而不是当成错误 —— 出图绝不能因为模型不可用而失败。
 */
export async function segmentSubject(image) {
    try {
        const segmenter = await ensureSegmenter();
        if (!segmenter)
            return null;
        const result = segmenter.segment(image);
        const mask = result.categoryMask;
        if (!mask)
            return null;
        const category = mask.getAsUint8Array();
        if (!category || category.length !== mask.width * mask.height)
            return null;
        return { width: mask.width, height: mask.height, category: new Uint8Array(category) };
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=segmentModel.js.map