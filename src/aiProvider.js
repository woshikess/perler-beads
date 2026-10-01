/**
 * 「自定义（OpenAI 兼容）图像接口」的**纯逻辑**：地址规范化、请求构造、响应解析。
 *
 * 为什么单独一个文件：门禁要在 Node 里 `require` 编译产物、直接断言**请求形状**，
 * 而不是在脚本里重抄一份产品逻辑（仓库 AGENTS.md §三.3）。所以本文件只用
 * Node 18+ 与浏览器**都有**的 `Blob` / `FormData` / `atob`，不碰 React、不碰 DOM 节点。
 *
 * 实测依据：`_审核\_暂存证据\第B49批-自定义AI接口\连通性实测.md`
 *   · `POST {base}/images/edits` + **multipart**（model / prompt / image / n）
 *     ⇒ 实测 HTTP 200、52.5 秒、1254×1254、`data[0].b64_json`
 *   · `POST {base}/images/generations` + JSON 里带 `image`（dataURL）
 *     —— 方舟与部分中转站是这个形状，作为**回退**尝试
 *   · **不发 `size`**（用户裁决 2026-09-26："先不发尺寸吧"）：交给服务决定默认值；
 *     实测该服务把非法尺寸（1x1）**静默忽略**，所以尺寸在那边本来也不是可靠旋钮
 *   · **不发 `watermark` / `response_format`**：前者是方舟私有字段；
 *     后者的默认值就是 b64，多传反而可能被 400
 */
/** 两种形状的**默认试探顺序**：实测 multipart `edits` 一次就成功，所以排第一 */
export const CUSTOM_SHAPE_ORDER = ['edits', 'generations'];
export function isCustomShape(value) {
    return value === 'edits' || value === 'generations';
}
/**
 * 上次成功的形状排到最前面（其余保持原顺序）。
 * 与 `arkEndpoints.orderArkTiers()` 同一个思路：省掉一次无用的失败往返。
 */
export function orderCustomShapes(preferred) {
    const all = [...CUSTOM_SHAPE_ORDER];
    if (!isCustomShape(preferred))
        return all;
    return [preferred, ...all.filter((s) => s !== preferred)];
}
/**
 * 规范化用户填的地址：去空白、去尾部斜杠、**允许他直接把完整的图片地址粘进来**
 * （`…/images/generations` / `…/images/edits` 会被剥掉，只留 base）。
 * 非法（不是 http/https、或空）返回 `''`，调用方据此提示。
 */
export function normalizeBaseUrl(input) {
    let url = String(input ?? '').trim();
    if (!url)
        return '';
    if (!/^https?:\/\//i.test(url))
        return '';
    url = url.replace(/\s+/g, '');
    url = url.replace(/\/+$/, '');
    // 允许直接粘「到某个端点」的地址：剥掉已认得的端点后缀
    url = url.replace(/\/images\/(generations|edits)$/i, '');
    url = url.replace(/\/images$/i, '');
    url = url.replace(/\/+$/, '');
    return url;
}
/** `GET {base}/models` —— 免费的读接口，用来做「测试连接」并顺便取模型列表 */
export function modelsUrl(baseUrl) {
    return `${normalizeBaseUrl(baseUrl)}/models`;
}
export function imagesUrl(baseUrl, shape) {
    return `${normalizeBaseUrl(baseUrl)}/images/${shape}`;
}
const MIME_EXT = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
};
/**
 * `data:image/png;base64,AAA…` → Blob（multipart 上传要用 Blob，不能直接塞 dataURL 字符串）。
 * 解析不出来返回 null。
 */
export function dataUrlToBlob(dataUrl) {
    const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(String(dataUrl ?? ''));
    if (!match)
        return null;
    const mime = (match[1] || 'image/png').toLowerCase();
    const isBase64 = Boolean(match[2]);
    const payload = match[3] ?? '';
    try {
        // ⚠️ **不要**写成 `let bytes: Uint8Array`：TS 5.7 起 Uint8Array 带 buffer 泛型，
        // 手写注解会退化成 `Uint8Array<ArrayBufferLike>`，而 `BlobPart` 只接受 `<ArrayBuffer>`
        // （报 TS2322、错误里出现 SharedArrayBuffer）。让两个分支各自 `new Uint8Array(n)` 推断即可。
        const bytes = isBase64
            ? (() => {
                const binary = atob(payload);
                const out = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i += 1)
                    out[i] = binary.charCodeAt(i);
                return out;
            })()
            : (() => {
                const text = decodeURIComponent(payload);
                const out = new Uint8Array(text.length);
                for (let i = 0; i < text.length; i += 1)
                    out[i] = text.charCodeAt(i);
                return out;
            })();
        return { blob: new Blob([bytes], { type: mime }), filename: `image.${MIME_EXT[mime] ?? 'png'}` };
    }
    catch (error) {
        return null;
    }
}
/**
 * 构造自定义接口的请求。**故意只发最小字段集**：
 *   · `edits`：multipart —— model / prompt / n / image(Blob)
 *   · `generations`：JSON —— { model, prompt, image(dataURL), n }
 * 两种形状都**不含** `size` / `watermark` / `response_format`（理由见文件头）。
 */
export function buildCustomRequest(options) {
    const { baseUrl, apiKey, model, prompt, imageDataUrl, shape } = options;
    const url = imagesUrl(baseUrl, shape);
    const auth = { Authorization: `Bearer ${String(apiKey ?? '').trim()}` };
    if (shape === 'edits') {
        const parsed = dataUrlToBlob(imageDataUrl);
        const form = new FormData();
        form.append('model', model);
        form.append('prompt', prompt);
        form.append('n', '1');
        if (parsed)
            form.append('image', parsed.blob, parsed.filename);
        // ⚠️ 不要自己设 Content-Type：必须让运行时带上 multipart 的 boundary
        return { url, init: { method: 'POST', headers: { ...auth }, body: form } };
    }
    return {
        url,
        init: {
            method: 'POST',
            headers: { ...auth, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, prompt, image: imageDataUrl, n: 1 }),
        },
    };
}
function errorMessageFrom(json, fallback) {
    if (json && typeof json === 'object') {
        const anyJson = json;
        const err = anyJson.error;
        if (typeof err === 'string' && err.trim())
            return err.trim();
        if (err && typeof err === 'object') {
            const msg = err.message;
            if (typeof msg === 'string' && msg.trim())
                return msg.trim();
        }
        for (const key of ['message', 'msg', 'detail', 'error_msg']) {
            const value = anyJson[key];
            if (typeof value === 'string' && value.trim())
                return value.trim();
        }
    }
    return fallback;
}
/**
 * 解析自定义接口的响应。**优先 b64**（免去跨域抓图），拿不到再看 `data[0].url`。
 * 出错时**原样带出服务返回的 message** —— 方舟那条路径踩过"笼统说 Key 不对"的坑
 * （实测：模型不在白名单是 403 `model not allowed for this api key`，
 *   缺文件是 400 `image is required`，这两个都比"Key 不对"精确得多）。
 */
export function parseImageResponse(httpStatus, bodyText) {
    const text = String(bodyText ?? '');
    let json = null;
    try {
        json = JSON.parse(text);
    }
    catch (error) {
        return {
            kind: 'error',
            httpStatus,
            message: `服务没返回 JSON（HTTP ${httpStatus}）：${text.slice(0, 200) || '(空响应)'}`,
        };
    }
    const record = (json ?? {});
    const data = Array.isArray(record.data) ? record.data : [];
    const first = (data[0] ?? {});
    if (typeof first.b64_json === 'string' && first.b64_json)
        return { kind: 'b64', b64: first.b64_json };
    if (typeof first.url === 'string' && first.url)
        return { kind: 'url', url: first.url };
    if (record.error || httpStatus >= 400) {
        return {
            kind: 'error',
            httpStatus,
            message: errorMessageFrom(json, `HTTP ${httpStatus}：响应里既没有 b64_json 也没有 url`),
        };
    }
    return {
        kind: 'error',
        httpStatus,
        message: '响应里既没有 b64_json 也没有 url（服务可能只支持纯文字生成）',
    };
}
/**
 * 把服务返回的 message 归到上面那几个码。**不认识就返回 `null`**（调用方原样显示服务原文，不二次加工）。
 */
export function explainProviderError(message, httpStatus) {
    const text = String(message ?? '');
    // ⚠️ 顺序有意义：`No available compatible accounts` 也带 503，必须先被下面这条抓走
    if (/model[_ ]?not[_ ]?allowed|not allowed for this (api )?key|model not permitted/i.test(text))
        return 'model-not-allowed';
    if (/no available compatible accounts|no available channel|no available accounts|无可用渠道|无可用账号/i.test(text))
        return 'no-accounts';
    if (/quota|insufficient|balance|billing|余额|欠费|额度/i.test(text))
        return 'quota';
    if (httpStatus === 401 || /unauthorized|invalid api key|incorrect api key/i.test(text))
        return 'bad-key';
    if (/service temporarily unavailable|bad gateway|gateway time-?out/i.test(text))
        return 'service-down';
    if (httpStatus >= 502 && httpStatus <= 504)
        return 'service-down';
    return null;
}
/**
 * 拿到 `url` 形状的响应时，把它抓成 dataURL 才能进拼豆管线。
 * 抓不到（图床不允许跨域）就抛错，由调用方给出**明确**提示，而不是笼统说"失败"。
 */
export async function fetchImageAsDataUrl(url, fetchImpl = fetch) {
    const resp = await fetchImpl(url, { method: 'GET' });
    if (!resp.ok)
        throw new Error(`抓取图片失败：HTTP ${resp.status}`);
    const blob = await resp.blob();
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    const mime = blob.type && blob.type.startsWith('image/') ? blob.type : 'image/png';
    return `data:${mime};base64,${btoa(binary)}`;
}
/** 看起来像不像"这个模型是画图的"：给模型下拉做过滤用 */
export function looksLikeImageModel(modelId) {
    return /image|dall|dalle|flux|seedream|banana|imagen|stable|sd[-_]?[0-9x]|kolors|hunyuan|draw|paint/i.test(String(modelId ?? ''));
}
/**
 * B52-b（用户复核后的口径）：模型下拉**只列"能图生图"的那几个**。
 *
 * 只能靠名字启发式判断：`/models` 里那个 `supported_endpoint_types` **不能**用来判图像能力 ——
 * 实测同一家中转站里，纯文本模型与图像模型都写着 `["openai"]`。
 *
 * ⚠️ **一个都没匹配上时退回全量列表**：宁可让用户看到全部名字，也不能给他一个空下拉
 * （有些站把图像模型起成别的名字，多列几个总比选不了强）。
 */
export function imageCapableModelIds(modelIds) {
    const all = [...modelIds];
    const image = all.filter(looksLikeImageModel);
    return image.length ? image : all;
}
/**
 * 免费测试连接：`GET {base}/models`。
 *
 * ⚠️ **不要**用方舟那套"`size: 1x1` 零费用探针"来测自定义地址：那是方舟**参数校验阶段**
 * 才有的行为；实测这个中转站把非法尺寸**静默忽略、照样生成了一张图**（真的花了钱）。
 */
export async function probeCustomEndpoint(baseUrl, apiKey, options = {}) {
    const base = normalizeBaseUrl(baseUrl);
    if (!base)
        return { kind: 'bad-url' };
    const fetchImpl = options.fetchImpl ?? fetch;
    const timeoutMs = options.timeoutMs ?? 15000;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
        const resp = await fetchImpl(modelsUrl(base), {
            method: 'GET',
            headers: { Authorization: `Bearer ${String(apiKey ?? '').trim()}` },
            ...(controller ? { signal: controller.signal } : {}),
        });
        const text = await resp.text();
        if (!resp.ok) {
            let parsed = null;
            try {
                parsed = JSON.parse(text);
            }
            catch (error) { /* 非 JSON 就用原文 */ }
            return {
                kind: 'error',
                httpStatus: resp.status,
                message: errorMessageFrom(parsed, text.slice(0, 200) || `HTTP ${resp.status}`),
            };
        }
        let parsed = null;
        try {
            parsed = JSON.parse(text);
        }
        catch (error) { /* 见下 */ }
        const record = (parsed ?? {});
        const list = Array.isArray(record.data) ? record.data : (Array.isArray(parsed) ? parsed : []);
        const modelIds = list
            .map((item) => (item && typeof item === 'object' ? item.id : item))
            .filter((id) => typeof id === 'string' && id.length > 0);
        return modelIds.length ? { kind: 'ok', modelIds } : { kind: 'no-models', modelIds: [] };
    }
    catch (error) {
        if (timer)
            clearTimeout(timer);
        const name = String(error?.name ?? 'Error');
        const message = String(error?.message ?? error ?? '');
        return { kind: 'error', httpStatus: null, message: name === 'AbortError' ? '连接超时' : `${name}: ${message}` };
    }
    finally {
        if (timer)
            clearTimeout(timer);
    }
}
//# sourceMappingURL=aiProvider.js.map