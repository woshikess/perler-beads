/**
 * 源图持久化（IndexedDB）—— 架构决定 **R5**，KI-007 的根修。
 *
 * ## 病根（KI-007，用户本人踩到过）
 * 源图原来只活在内存里（`App.tsx` 的 `pendingFile: File | null`），**刷新页面必然丢失**；
 * 而图纸（格子数据）是从 localStorage 恢复的，界面看起来一切正常
 * ⇒ 用户改参数**什么都不发生、也没有任何提示**。
 *
 * 本模块把源图的**原始字节**存进 IndexedDB。刷新后能取回同一个 `File`，
 * 于是「改参数 → 真的重新出图」这条路恢复可用 ⇒ 既不需要「提示」，也不需要「重新上传」按钮。
 *
 * ## 设计决定（为什么这么做）
 * 1. **只保留最近一份源图**（固定槽位 `SOURCE_IMAGE_SLOT = 'current'`）。
 *    理由：这个应用**只有一个工程**（localStorage 里也只有一条草稿 `perler-beads-generator:draft`），
 *    而 `pendingFile` 本身就只有一个 —— 槽位与「源图」是 1:1。做多图历史会：
 *    ① 让「哪张才是这个工程的源图」出现歧义；② 成倍吃配额而界面上没有任何管理入口；
 *    ③ 让淘汰策略不可预测。历史里的 AI 图属于**派生数据**（要重生成得再花钱），
 *    不属于「改参数重算」的必需品，所以不入库。
 * 2. **零依赖、零 `../` 相对导入**：本仓库没有打包器，`scripts/post-build.cjs` 只重写 `./` 开头的导入，
 *    `scripts/dev-server.cjs` 没有扩展名回退 ⇒ 任何 `../` 导入 = 构建绿 + 浏览器白屏 404。
 *    所以本文件**不 import 任何东西**（连 `./types` 都不引）。
 * 3. **绝不静默失败**：所有公开 API 都返回结构化结果（`code` + 已渲染好的中/英文 `notice`），
 *    永不抛异常。调用方拿到 `persisted: false` 就必须把 `notice` 显示给用户 ——
 *    这正是 KI-007 的病根所在，不允许再出现"什么都没发生"。
 * 4. **绝不碰 localStorage**：源图的读写与既有工程数据（`perler-beads-generator:draft`、
 *    `perler-beads-generator:language`、`ark-api-key` 等）完全隔离，一个字节都不改。
 * 5. **命名空间 + 版本号**：库名 `perler-beads-generator:source-image`（与草稿键同前缀、不同键），
 *    库版本 `1`，记录里再带一个 `schema`（`SOURCE_IMAGE_SCHEMA_VERSION`），
 *    以后格式变了可以按 `schema` 迁移而不必依赖库版本升级。
 * 6. **缩略图**（最长边 256，WebP 优先 / PNG 兜底）单独放 `meta` 存储：
 *    启动时先读 `meta`（小）就能回答「有没有源图、叫什么名、长什么样」，
 *    不必先把几 MB 的原始字节读出来 ⇒ 用于消灭"看起来有图但还没加载完"的窗口期；
 *    同时它也是一根**损坏探针**（`meta` 在、原始字节读不出来 ⇒ 明确报 `corrupt`）。
 *    缩略图生成失败**不影响**主记录落库。
 *
 * ## 失败码一览
 * | code | 含义 | 用户可见后果 |
 * |---|---|---|
 * | `indexeddb-unavailable` | 浏览器没有 IndexedDB（或隐私模式禁用它） | 降级为内存模式：刷新会丢 |
 * | `open-failed` | 打不开库 | 同上 |
 * | `open-blocked` | 另一个标签页占着旧版本库 | 同上（关掉其它标签页可恢复） |
 * | `too-large` | 图 > `MAX_SOURCE_IMAGE_BYTES` | 不存，内存模式 |
 * | `quota-insufficient` | 写之前就看出空间不够（预检） | 不存，内存模式 |
 * | `quota-exceeded` | 写入时被配额拒绝 | 不存，内存模式 |
 * | `write-failed` | 其它写入错误 | 不存，内存模式 |
 * | `read-failed` | 读过源图时出错 | 用不了，请重新上传 |
 * | `corrupt` | 记录在、但字节不完整/解不开 | 已清除，请重新上传 |
 * | `not-found` | 库里根本没有（正常空状态 / 被清理） | 由调用方按工程元数据决定说不说 |
 * | `mismatch` | 库里那张不属于当前工程 | 忽略，请重新上传 |
 * | `clear-failed` | 清除时出错 | 下次可能看到旧图 |
 */
// ────────────────────────────── 常量 / 命名空间 ──────────────────────────────
/** IndexedDB 库名。与草稿键 `perler-beads-generator:draft` 同前缀、不同键，互不影响。 */
export const SOURCE_IMAGE_DB_NAME = 'perler-beads-generator:source-image';
/** IndexedDB 库版本（结构升级用）。 */
export const SOURCE_IMAGE_DB_VERSION = 1;
/** 记录内的格式版本（数据迁移用，与库版本解耦）。 */
export const SOURCE_IMAGE_SCHEMA_VERSION = 1;
/** 源图槽位键。只保留最近一份 ⇒ 槽位固定。 */
export const SOURCE_IMAGE_SLOT = 'current';
/** 单张源图的大小上限（20 MiB）。超过就不入库 —— 只保留最近一份，没必要为一张巨图冒配额风险。 */
export const MAX_SOURCE_IMAGE_BYTES = 20 * 1024 * 1024;
/** `MAX_SOURCE_IMAGE_BYTES` 的 MB 数（给文案用，向上取整）。 */
export const MAX_SOURCE_IMAGE_MB = Math.ceil(MAX_SOURCE_IMAGE_BYTES / (1024 * 1024));
const STORE_RECORDS = 'records';
const STORE_META = 'meta';
const PROBE_SLOT = '__probe__';
const THUMBNAIL_MAX_EDGE = 256;
const THUMBNAIL_QUALITY = 0.72;
/** 预检余量：提交一份新记录时的瞬时峰值可能接近两份（旧值 + 新值），留 2× + 1MiB。 */
const WRITE_HEADROOM_FACTOR = 2;
const WRITE_HEADROOM_MIN_BYTES = 1024 * 1024;
const OPEN_TIMEOUT_MS = 4000;
// ────────────────────────────── 文案（唯一落点） ──────────────────────────────
// ⚠️ 这些是**用户可见文案**，措辞一律"用户视角"。W5 若要收进 i18n.tsx，
// 键名建议 `sourceImage*`（见交付报告里的清单），但删掉本表前必须保证每条都有落点。
const NOTICES = {
    'indexeddb-unavailable': {
        zh: '这个浏览器不让本页保存图片（无痕/隐私模式常见）。这张图只留在当前页面，刷新后会丢；换成普通窗口打开就能跨刷新保留。',
        en: 'This browser will not let this page store images (common in private/incognito windows). The image only lives in this tab and will be lost on refresh; open the app in a normal window to keep it.',
    },
    'open-failed': {
        zh: '浏览器存储打不开，这张图只留在当前页面，刷新后会丢。',
        en: 'The browser storage could not be opened. The image only lives in this tab and will be lost on refresh.',
    },
    'open-blocked': {
        zh: '另一个标签页正占着浏览器存储，这张图暂时存不进去：只留在当前页面，刷新后会丢。关掉本应用的其它标签页再上传一次即可。',
        en: 'Another tab is holding the browser storage, so the image could not be saved: it only lives in this tab and will be lost on refresh. Close the other tabs of this app and upload again.',
    },
    'too-large': {
        zh: `这张图超过 ${MAX_SOURCE_IMAGE_MB}MB，不保存到浏览器：它只留在当前页面，刷新后会丢。先用别的方式把图缩小一点再上传，就能跨刷新保留。`,
        en: `This image is over ${MAX_SOURCE_IMAGE_MB}MB, so it was not saved in the browser: it only lives in this tab and will be lost on refresh. Shrink it a little and upload again to keep it across refreshes.`,
    },
    'quota-insufficient': {
        zh: '浏览器可用空间不够，这张图没有保存：它只留在当前页面，刷新后会丢。清理一下浏览器存储，或换一张小一点的图。',
        en: 'There is not enough browser storage space, so the image was not saved: it only lives in this tab and will be lost on refresh. Free up browser storage or use a smaller image.',
    },
    'quota-exceeded': {
        zh: '浏览器存储已满，这张图没有保存：它只留在当前页面，刷新后会丢。清理一下浏览器存储，或换一张小一点的图。',
        en: 'Browser storage is full, so the image was not saved: it only lives in this tab and will be lost on refresh. Free up browser storage or use a smaller image.',
    },
    'write-failed': {
        zh: '保存这张图时出错，它只留在当前页面，刷新后会丢。',
        en: 'Saving the image failed, so it only lives in this tab and will be lost on refresh.',
    },
    'read-failed': {
        zh: '读取上次保存的图时出错，现在没有可用的源图：改参数不会重新出图。用左栏「上传图片」重新选一张就能继续。',
        en: 'Reading the previously saved image failed, so there is no usable source image: changing parameters will not rebuild the pattern. Pick the image again with “Upload image” on the left to continue.',
    },
    corrupt: {
        zh: '上次保存的图数据不完整，已经清掉了：用左栏「上传图片」重新选一张就能继续。',
        en: 'The saved image data was incomplete and has been cleared: pick the image again with “Upload image” on the left to continue.',
    },
    'not-found': {
        zh: '浏览器里没有保存的源图。',
        en: 'There is no source image saved in this browser.',
    },
    mismatch: {
        zh: '浏览器里保存的那张图不属于当前图纸，已忽略：改参数不会重新出图。用左栏「上传图片」重新选一张就能继续。',
        en: 'The image saved in this browser does not belong to the current pattern and was ignored: changing parameters will not rebuild the pattern. Pick the image again with “Upload image” on the left to continue.',
    },
    'clear-failed': {
        zh: '清除浏览器里保存的图时出错，下次打开可能会看到旧图。',
        en: 'Clearing the saved image from the browser failed, so an older image may still be there next time.',
    },
};
/**
 * 「工程记得有源图，但库里已经没有」时给用户的一句话（KI-007 的残余场景：
 * 用户清了浏览器数据 / 浏览器自己淘汰了存储）。
 * 用户裁决是"不要常驻提示、不要重新上传按钮"，所以这条只适合放进状态栏**一次性**提示。
 */
export const SOURCE_IMAGE_LOST_NOTICE = {
    zh: '上次用的源图已经不在浏览器存储里了（被清理掉了）。改参数不会重新出图 —— 用左栏「上传图片」重新选一张就能继续。',
    en: 'The source image from last time is no longer in browser storage (it was cleared). Changing parameters will not rebuild the pattern — pick the image again with “Upload image” on the left to continue.',
};
/** 把失败码渲染成用户可见文案。`not-found` 是否该说，由调用方按工程元数据决定。 */
export function describeSourceImageCode(code, language = 'zh') {
    return NOTICES[code][language] ?? NOTICES[code].zh;
}
// ────────────────────────────── 内部工具 ──────────────────────────────
class SourceImageStoreError extends Error {
    constructor(code, message) {
        super(message);
        Object.defineProperty(this, "code", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        this.name = 'SourceImageStoreError';
        this.code = code;
    }
}
function describeError(error) {
    if (error instanceof Error)
        return `${error.name}: ${error.message}`;
    try {
        return String(error);
    }
    catch {
        return 'unknown error';
    }
}
function codeFromError(error, fallback) {
    const code = error?.code;
    return typeof code === 'string' && code in NOTICES ? code : fallback;
}
/** 配额类错误在不同浏览器里的名字不一样（`QuotaExceededError` / `NS_ERROR_DOM_QUOTA_REACHED` / code 22）。 */
function isQuotaError(error) {
    const name = String(error?.name ?? '');
    const code = error?.code;
    if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED')
        return true;
    if (code === 22)
        return true;
    return /quota|storage is full|超出配额/i.test(describeError(error));
}
function generateImageId() {
    const random = Math.random().toString(36).slice(2, 10);
    return `img-${Date.now().toString(36)}-${random}`;
}
function idbFactory() {
    try {
        if (typeof indexedDB === 'undefined' || indexedDB === null)
            return null;
        return indexedDB;
    }
    catch {
        // 某些隐私模式实现里，光是**访问** indexedDB 就会抛。
        return null;
    }
}
let cachedDb = null;
let cachedOpen = null;
/** 打开（必要时建）库。失败不缓存，下次调用可以重试。 */
function openDatabase() {
    if (cachedDb)
        return Promise.resolve(cachedDb);
    if (cachedOpen)
        return cachedOpen;
    const factory = idbFactory();
    if (!factory) {
        return Promise.reject(new SourceImageStoreError('indexeddb-unavailable', 'indexedDB is not available'));
    }
    cachedOpen = new Promise((resolve, reject) => {
        let settled = false;
        let timer = null;
        const settle = (fn) => {
            if (settled)
                return;
            settled = true;
            if (timer !== null)
                clearTimeout(timer);
            fn();
        };
        timer = setTimeout(() => {
            settle(() => reject(new SourceImageStoreError('open-blocked', `open timed out after ${OPEN_TIMEOUT_MS}ms`)));
        }, OPEN_TIMEOUT_MS);
        let request;
        try {
            request = factory.open(SOURCE_IMAGE_DB_NAME, SOURCE_IMAGE_DB_VERSION);
        }
        catch (error) {
            settle(() => reject(new SourceImageStoreError('open-failed', describeError(error))));
            return;
        }
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_RECORDS))
                db.createObjectStore(STORE_RECORDS);
            if (!db.objectStoreNames.contains(STORE_META))
                db.createObjectStore(STORE_META);
        };
        request.onblocked = () => {
            settle(() => reject(new SourceImageStoreError('open-blocked', 'another connection is holding an older version')));
        };
        request.onsuccess = () => {
            const db = request.result;
            // 别的标签页要升级/删库时，主动让路（否则 deleteDatabase 会被我们挂住）。
            db.onversionchange = () => {
                try {
                    db.close();
                }
                catch {
                    /* 关不掉就算了，别影响主流程 */
                }
                if (cachedDb === db)
                    cachedDb = null;
                cachedOpen = null;
            };
            db.onclose = () => {
                if (cachedDb === db)
                    cachedDb = null;
                cachedOpen = null;
            };
            cachedDb = db;
            settle(() => resolve(db));
        };
        request.onerror = () => {
            settle(() => reject(new SourceImageStoreError('open-failed', describeError(request.error))));
        };
    });
    cachedOpen.catch(() => {
        cachedOpen = null;
    });
    return cachedOpen;
}
function requestToPromise(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
    });
}
function transactionDone(tx) {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    });
}
function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
        reader.readAsDataURL(blob);
    });
}
/**
 * 把图缩到最长边 256 并编码。**任何失败都返回 null**（缩略图不是必需品，不许拖垮主记录）。
 * 同时顺手回报原图尺寸 —— 它是 `createImageBitmap` 白送的。
 */
async function makeThumbnail(blob) {
    try {
        if (typeof createImageBitmap !== 'function')
            return null;
        const bitmap = await createImageBitmap(blob);
        const width = bitmap.width;
        const height = bitmap.height;
        if (!width || !height) {
            bitmap.close?.();
            return null;
        }
        const scale = Math.min(1, THUMBNAIL_MAX_EDGE / Math.max(width, height));
        const outWidth = Math.max(1, Math.round(width * scale));
        const outHeight = Math.max(1, Math.round(height * scale));
        const canvas = createCanvas(outWidth, outHeight);
        if (!canvas) {
            bitmap.close?.();
            return null;
        }
        canvas.context.drawImage(bitmap, 0, 0, outWidth, outHeight);
        bitmap.close?.();
        const encoded = await encodeCanvas(canvas, pickThumbnailType());
        if (!encoded)
            return null;
        return { blob: encoded, width, height };
    }
    catch {
        return null;
    }
}
function createCanvas(width, height) {
    try {
        if (typeof OffscreenCanvas === 'function') {
            const canvas = new OffscreenCanvas(width, height);
            const context = canvas.getContext('2d');
            if (context) {
                return { context, encode: (type, quality) => canvas.convertToBlob({ type, quality }) };
            }
        }
        if (typeof document === 'undefined')
            return null;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context)
            return null;
        return {
            context,
            encode: (type, quality) => new Promise((resolve) => {
                canvas.toBlob((result) => resolve(result), type, quality);
            }),
        };
    }
    catch {
        return null;
    }
}
let thumbnailType = null;
/** WebP 优先（保透明、体积小），不支持就 PNG。 */
function pickThumbnailType() {
    if (thumbnailType)
        return thumbnailType;
    thumbnailType = 'image/png';
    try {
        if (typeof document !== 'undefined') {
            const probe = document.createElement('canvas');
            probe.width = 1;
            probe.height = 1;
            if (probe.toDataURL('image/webp').startsWith('data:image/webp'))
                thumbnailType = 'image/webp';
        }
        else if (typeof OffscreenCanvas === 'function') {
            thumbnailType = 'image/webp';
        }
    }
    catch {
        thumbnailType = 'image/png';
    }
    return thumbnailType;
}
async function encodeCanvas(surface, type) {
    try {
        return await surface.encode(type, THUMBNAIL_QUALITY);
    }
    catch {
        try {
            return await surface.encode('image/png', 1);
        }
        catch {
            return null;
        }
    }
}
/** 能不能解码。没有解码器时**放行**（别把好图判成坏图）。 */
async function canDecode(blob) {
    if (typeof createImageBitmap !== 'function')
        return true;
    try {
        const bitmap = await createImageBitmap(blob);
        bitmap.close?.();
        return true;
    }
    catch {
        return false;
    }
}
let persistRequest = null;
function requestPersistentStorage() {
    if (persistRequest)
        return persistRequest;
    try {
        const manager = typeof navigator !== 'undefined' ? navigator.storage : undefined;
        if (!manager || typeof manager.persist !== 'function') {
            persistRequest = Promise.resolve(null);
            return persistRequest;
        }
        persistRequest = manager
            .persist()
            .then((value) => Boolean(value))
            .catch(() => null);
    }
    catch {
        persistRequest = Promise.resolve(null);
    }
    return persistRequest;
}
function noticeFor(code, language) {
    return code ? describeSourceImageCode(code, language) : null;
}
function failure(code, language, detail, bytes = 0, quota = null) {
    return {
        persisted: false,
        mode: 'memory',
        imageId: null,
        code,
        notice: noticeFor(code, language),
        detail,
        bytes,
        quota,
    };
}
// ────────────────────────────── 公开 API ──────────────────────────────
/**
 * 探测存储能不能用。**真的写一条再删掉**——隐私模式下常见"库能打开、写入才失败"，
 * 只 `open` 会给出假阳性，而降级策略全靠这个判断。
 */
export async function isAvailable(options = {}) {
    const language = options.language ?? 'zh';
    let db;
    try {
        db = await openDatabase();
    }
    catch (error) {
        const code = codeFromError(error, 'open-failed');
        return { available: false, code, notice: noticeFor(code, language), detail: describeError(error) };
    }
    try {
        const writeTx = db.transaction([STORE_META], 'readwrite');
        writeTx.objectStore(STORE_META).put({ schema: SOURCE_IMAGE_SCHEMA_VERSION, imageId: PROBE_SLOT }, PROBE_SLOT);
        await transactionDone(writeTx);
        const cleanTx = db.transaction([STORE_META], 'readwrite');
        cleanTx.objectStore(STORE_META).delete(PROBE_SLOT);
        await transactionDone(cleanTx);
        return { available: true, code: null, notice: null, detail: null };
    }
    catch (error) {
        const code = isQuotaError(error) ? 'quota-exceeded' : 'write-failed';
        return { available: false, code, notice: noticeFor(code, language), detail: describeError(error) };
    }
}
/**
 * 保存源图（只保留最近一份）。
 *
 * 落库顺序刻意是「**先清旧、再写新**」：① 只保留最近一份；② 先把旧值占的配额还回去，
 * 让小配额环境更容易成功；③ 万一新图写失败，库里是**空**的而不是**旧图** ——
 * 这样启动时绝不会把上一张图错当成这一张（"陈旧采用"是比"没有图"更坏的结果）。
 * 调用方只有在 `persisted === true` 时才应该把 `imageId` 写进工程元数据。
 */
export async function saveSourceImage(input, options = {}) {
    const language = options.language ?? 'zh';
    const bytes = Number(input?.size ?? 0);
    try {
        if (!input || typeof input.size !== 'number' || bytes <= 0) {
            await clearSourceImage({ language });
            return failure('write-failed', language, 'empty or non-blob input');
        }
        if (bytes > MAX_SOURCE_IMAGE_BYTES) {
            await clearSourceImage({ language });
            return failure('too-large', language, `${bytes} bytes > ${MAX_SOURCE_IMAGE_BYTES}`, bytes);
        }
        let db;
        try {
            db = await openDatabase();
        }
        catch (error) {
            const code = codeFromError(error, 'open-failed');
            return failure(code, language, describeError(error), bytes);
        }
        const quota = await estimateQuota();
        if (quota.remaining !== null && quota.remaining < bytes * WRITE_HEADROOM_FACTOR + WRITE_HEADROOM_MIN_BYTES) {
            await clearSourceImage({ language });
            return failure('quota-insufficient', language, `remaining=${quota.remaining} needed≈${bytes * WRITE_HEADROOM_FACTOR + WRITE_HEADROOM_MIN_BYTES}`, bytes, quota);
        }
        // 尽量拿到"持久存储"（避免浏览器在压力下清掉它）。拿不到也可继续。
        await requestPersistentStorage();
        const thumbnail = await makeThumbnail(input);
        const imageId = options.imageId && options.imageId.trim() ? options.imageId.trim() : generateImageId();
        const savedAt = Date.now();
        const name = typeof options === 'object' && input instanceof File && input.name ? input.name : 'source-image';
        const type = input.type || 'image/png';
        const lastModified = input instanceof File ? input.lastModified : savedAt;
        // 先清旧（见函数头注释）。清不掉不阻断：槽位写入本身就是覆盖。
        await clearSourceImage({ language });
        const record = {
            schema: SOURCE_IMAGE_SCHEMA_VERSION,
            imageId,
            name,
            type,
            size: bytes,
            lastModified,
            width: thumbnail?.width ?? 0,
            height: thumbnail?.height ?? 0,
            savedAt,
            blob: input,
        };
        const meta = {
            schema: SOURCE_IMAGE_SCHEMA_VERSION,
            imageId,
            name,
            type,
            size: bytes,
            width: thumbnail?.width ?? 0,
            height: thumbnail?.height ?? 0,
            savedAt,
            thumbnail: thumbnail?.blob ?? null,
        };
        try {
            const tx = db.transaction([STORE_RECORDS, STORE_META], 'readwrite');
            tx.objectStore(STORE_RECORDS).put(record, SOURCE_IMAGE_SLOT);
            tx.objectStore(STORE_META).put(meta, SOURCE_IMAGE_SLOT);
            await transactionDone(tx);
        }
        catch (error) {
            const code = isQuotaError(error)
                ? 'quota-exceeded'
                : codeFromError(error, 'write-failed');
            await clearSourceImage({ language });
            return failure(code, language, describeError(error), bytes, quota);
        }
        return {
            persisted: true,
            mode: 'persistent',
            imageId,
            code: null,
            notice: null,
            detail: thumbnail ? null : 'thumbnail unavailable (record saved anyway)',
            bytes,
            quota,
        };
    }
    catch (error) {
        // 兜底：本函数**永不抛**（API 契约）。
        return failure(codeFromError(error, 'write-failed'), language, describeError(error), bytes);
    }
}
/**
 * 快速探测「有没有源图」——只读 `meta`（小），不读原始字节。
 * 用于启动时立刻回答"要不要显示成有源图"，避免"看起来有图但还没加载完"的窗口期。
 */
export async function probeSourceImage(options = {}) {
    const language = options.language ?? 'zh';
    const empty = {
        present: false,
        imageId: null,
        name: null,
        size: null,
        savedAt: null,
        thumbnailDataUrl: null,
        code: null,
        notice: null,
        detail: null,
    };
    try {
        let db;
        try {
            db = await openDatabase();
        }
        catch (error) {
            const code = codeFromError(error, 'open-failed');
            return { ...empty, code, notice: noticeFor(code, language), detail: describeError(error) };
        }
        let meta;
        try {
            const tx = db.transaction([STORE_META], 'readonly');
            meta = (await requestToPromise(tx.objectStore(STORE_META).get(SOURCE_IMAGE_SLOT)));
        }
        catch (error) {
            return { ...empty, code: 'read-failed', notice: noticeFor('read-failed', language), detail: describeError(error) };
        }
        if (!meta || typeof meta.imageId !== 'string') {
            // 正常空状态：不打扰用户（该不该说由调用方按工程元数据决定）。
            return { ...empty, code: 'not-found' };
        }
        let thumbnailDataUrl = null;
        if (meta.thumbnail instanceof Blob) {
            try {
                thumbnailDataUrl = await blobToDataUrl(meta.thumbnail);
            }
            catch {
                thumbnailDataUrl = null;
            }
        }
        return {
            present: true,
            imageId: meta.imageId,
            name: typeof meta.name === 'string' ? meta.name : null,
            size: typeof meta.size === 'number' ? meta.size : null,
            savedAt: typeof meta.savedAt === 'number' ? meta.savedAt : null,
            thumbnailDataUrl,
            code: null,
            notice: null,
            detail: null,
        };
    }
    catch (error) {
        return { ...empty, code: 'read-failed', notice: noticeFor('read-failed', language), detail: describeError(error) };
    }
}
/**
 * 取回源图（原始字节 → 可重建 `File`）。
 *
 * 校验：记录里的 `size` 必须与字节数一致；默认还会真解码一次
 * （解码失败 ⇒ `corrupt`，并**清库**，免得下次又拿一堆坏字节去跑出图管线而静默失败）。
 */
export async function loadSourceImage(options = {}) {
    const language = options.language ?? 'zh';
    try {
        let db;
        try {
            db = await openDatabase();
        }
        catch (error) {
            const code = codeFromError(error, 'open-failed');
            return { found: false, image: null, code, notice: noticeFor(code, language), detail: describeError(error) };
        }
        let record;
        let meta;
        try {
            const tx = db.transaction([STORE_RECORDS, STORE_META], 'readonly');
            const [rawRecord, rawMeta] = await Promise.all([
                requestToPromise(tx.objectStore(STORE_RECORDS).get(SOURCE_IMAGE_SLOT)),
                requestToPromise(tx.objectStore(STORE_META).get(SOURCE_IMAGE_SLOT)),
            ]);
            record = rawRecord;
            meta = rawMeta;
        }
        catch (error) {
            return {
                found: false,
                image: null,
                code: 'read-failed',
                notice: noticeFor('read-failed', language),
                detail: describeError(error),
            };
        }
        const blob = record?.blob;
        if (!record || !(blob instanceof Blob)) {
            if (record && !(blob instanceof Blob)) {
                await clearSourceImage({ language });
                return { found: false, image: null, code: 'corrupt', notice: noticeFor('corrupt', language), detail: 'record has no blob' };
            }
            return { found: false, image: null, code: 'not-found', notice: null, detail: null };
        }
        const imageId = typeof record.imageId === 'string' ? record.imageId : (typeof meta?.imageId === 'string' ? meta.imageId : '');
        const expected = options.expectedImageId ?? null;
        if (expected && imageId && expected !== imageId) {
            // 不属于当前工程：不动库，交给调用方处理。
            return {
                found: false,
                image: null,
                code: 'mismatch',
                notice: noticeFor('mismatch', language),
                detail: `expected ${expected} but stored ${imageId}`,
            };
        }
        const declaredSize = typeof record.size === 'number' ? record.size : null;
        if (declaredSize !== null && blob.size !== declaredSize) {
            await clearSourceImage({ language });
            return {
                found: false,
                image: null,
                code: 'corrupt',
                notice: noticeFor('corrupt', language),
                detail: `size mismatch: record=${declaredSize} blob=${blob.size}`,
            };
        }
        if (options.validate !== false) {
            const decodable = await canDecode(blob);
            if (!decodable) {
                await clearSourceImage({ language });
                return {
                    found: false,
                    image: null,
                    code: 'corrupt',
                    notice: noticeFor('corrupt', language),
                    detail: 'stored bytes could not be decoded',
                };
            }
        }
        const name = typeof record.name === 'string' && record.name ? record.name : 'source-image';
        const type = typeof record.type === 'string' && record.type ? record.type : blob.type || 'image/png';
        const file = new File([blob], name, {
            type,
            lastModified: typeof record.lastModified === 'number' ? record.lastModified : Date.now(),
        });
        let thumbnailDataUrl = null;
        if (meta?.thumbnail instanceof Blob) {
            try {
                thumbnailDataUrl = await blobToDataUrl(meta.thumbnail);
            }
            catch {
                thumbnailDataUrl = null;
            }
        }
        return {
            found: true,
            image: {
                imageId,
                file,
                name,
                type,
                size: blob.size,
                width: typeof record.width === 'number' ? record.width : 0,
                height: typeof record.height === 'number' ? record.height : 0,
                savedAt: typeof record.savedAt === 'number' ? record.savedAt : 0,
                schema: typeof record.schema === 'number' ? record.schema : SOURCE_IMAGE_SCHEMA_VERSION,
                thumbnailDataUrl,
            },
            code: null,
            notice: null,
            detail: null,
        };
    }
    catch (error) {
        return {
            found: false,
            image: null,
            code: 'read-failed',
            notice: noticeFor('read-failed', language),
            detail: describeError(error),
        };
    }
}
/** 清掉保存的源图（幂等，永不抛）。 */
export async function clearSourceImage(options = {}) {
    const language = options.language ?? 'zh';
    try {
        const factory = idbFactory();
        if (!factory)
            return { cleared: false, code: 'indexeddb-unavailable', notice: noticeFor('indexeddb-unavailable', language), detail: null };
        const db = await openDatabase();
        const tx = db.transaction([STORE_RECORDS, STORE_META], 'readwrite');
        tx.objectStore(STORE_RECORDS).delete(SOURCE_IMAGE_SLOT);
        tx.objectStore(STORE_META).delete(SOURCE_IMAGE_SLOT);
        await transactionDone(tx);
        return { cleared: true, code: null, notice: null, detail: null };
    }
    catch (error) {
        return {
            cleared: false,
            code: codeFromError(error, 'clear-failed'),
            notice: noticeFor('clear-failed', language),
            detail: describeError(error),
        };
    }
}
/**
 * 配额体检。`remaining === null` 表示浏览器不给这个数（于是保存路径不做预检、直接试写）。
 * `storedBytes` 来自 `meta`，很轻。
 */
export async function estimateQuota() {
    const result = {
        supported: false,
        usage: null,
        quota: null,
        remaining: null,
        persisted: null,
        storedBytes: null,
        detail: null,
    };
    try {
        const manager = typeof navigator !== 'undefined' ? navigator.storage : undefined;
        if (manager && typeof manager.estimate === 'function') {
            try {
                const estimate = await manager.estimate();
                if (typeof estimate.usage === 'number')
                    result.usage = estimate.usage;
                if (typeof estimate.quota === 'number')
                    result.quota = estimate.quota;
                result.supported = result.usage !== null || result.quota !== null;
                if (result.usage !== null && result.quota !== null) {
                    result.remaining = Math.max(0, result.quota - result.usage);
                }
            }
            catch (error) {
                result.detail = describeError(error);
            }
        }
        else {
            result.detail = 'navigator.storage.estimate is not available';
        }
        if (manager && typeof manager.persisted === 'function') {
            try {
                result.persisted = Boolean(await manager.persisted());
            }
            catch {
                result.persisted = null;
            }
        }
    }
    catch (error) {
        result.detail = describeError(error);
    }
    try {
        const probe = await readStoredSize();
        result.storedBytes = probe;
    }
    catch {
        result.storedBytes = null;
    }
    return result;
}
async function readStoredSize() {
    const db = await openDatabase();
    const tx = db.transaction([STORE_META], 'readonly');
    const meta = (await requestToPromise(tx.objectStore(STORE_META).get(SOURCE_IMAGE_SLOT)));
    return typeof meta?.size === 'number' ? meta.size : null;
}
/** 关掉库连接（测试与"清除本地数据"用）。 */
export function closeSourceImageDatabase() {
    if (cachedDb) {
        try {
            cachedDb.close();
        }
        catch {
            /* 已经关了就算了 */
        }
    }
    cachedDb = null;
    cachedOpen = null;
}
/**
 * 连库一起删掉（测试与"彻底清除本地数据"用）。
 * 删之前先关自己的连接，否则 `deleteDatabase` 会被自己挂住。
 */
export function deleteSourceImageDatabase() {
    return new Promise((resolve) => {
        const factory = idbFactory();
        if (!factory) {
            resolve(false);
            return;
        }
        closeSourceImageDatabase();
        try {
            const request = factory.deleteDatabase(SOURCE_IMAGE_DB_NAME);
            request.onsuccess = () => resolve(true);
            request.onerror = () => resolve(false);
            request.onblocked = () => resolve(false);
        }
        catch {
            resolve(false);
        }
    });
}
//# sourceMappingURL=imageStore.js.map