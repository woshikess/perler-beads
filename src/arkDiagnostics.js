/**
 * 火山方舟「零费用探针」+ 错误分类 + 自动识别可用模型
 *
 * 设计要点：
 * 1. **纯函数、不依赖 React / DOM** —— 所以能直接单测，不需要真 Key。
 *    网络出口由调用方以 `fetchImpl` 注入，便于验证脚本抓请求体 / 数请求数。
 * 2. **只返回「状态」，不返回文案** —— 文案统一放在 App 的 i18n 表里按状态取，
 *    这样中英双语都能正确显示，而且「错误码 → 文案」的覆盖关系一眼可查。
 * 3. **零费用探针**：画布尺寸故意用 `1x1`，低于方舟要求的最小面积（921600）。
 *    方舟会在**参数校验阶段**就拒绝，不会生成图片、不扣费。
 *    错误消息本身就是证据（`image area must be at least`）。
 * 4. 方舟**先校验鉴权、再校验参数**，所以探针收到 400 一定意味着「Key 有效且模型已开通」。
 *
 * 本文件里的 `ARK_LINKS` / `probeBody` / `classifyAiProbe` / `formatRawBits` 等
 * 是 `e6b6976` 里那份 212 行实现的**逐字复用**（那版分类器 26/26 单测、30/30 验收通过）。
 * 新增的只有 `ARK_MODEL_CANDIDATES` / `detectActivatedModel` / `sawImageData`。
 */
/** 用户需要点进去的官方地址（URL 与语言无关，放这里） */
export const ARK_LINKS = {
    /** API Key 管理 */
    apiKey: 'https://ai.volcengine.com/console/apikey',
    /** 模型开通 */
    model: 'https://ai.volcengine.com/model',
    /** 控制台首页 */
    console: 'https://ai.volcengine.com/',
};
/** 方舟「图片生成」接口（与 arkDirect.ts 的 ARK_ENDPOINT 同一个地址，这里独立声明避免循环依赖） */
export const ARK_PROBE_ENDPOINT = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
/** 单次探针的网络超时。探针只做参数校验，方舟实测 < 2 秒；给 15 秒足够，失败也不该让界面干等 */
export const PROBE_TIMEOUT_MS = 15000;
/** 零费用探针的请求体。注意 size 固定 1x1，**不要改**，改了就会真的生成图片并扣费。 */
export function probeBody(modelId) {
    return { model: modelId, prompt: 'x', size: '1x1', watermark: false };
}
/** 把原始信息拼成一行。分类器不负责文案，这个只做「补充证据」的部分。 */
export function formatRawBits(raw) {
    return [
        raw.httpStatus !== null && raw.httpStatus !== undefined ? `HTTP ${raw.httpStatus}` : '',
        raw.code && `code=${raw.code}`,
        raw.requestId && `request_id=${raw.requestId}`,
        raw.message && raw.message.slice(0, 300),
    ].filter(Boolean).join('  ');
}
const LEVEL = {
    ok: 'ok',
    'model-not-open': 'warn',
    'model-not-found': 'error',
    'bad-key': 'error',
    timeout: 'warn',
    'rate-limited': 'warn',
    policy: 'warn',
    'server-error': 'warn',
    'bad-request': 'warn',
    unknown: 'error',
};
/** 有直达按钮的状态 */
const LINK = {
    'model-not-open': 'model',
    'model-not-found': 'model',
    'bad-key': 'apiKey',
    'rate-limited': 'console',
};
/**
 * 把「一次方舟请求的结果」分类成一个界面状态。
 *
 * ⚠️ 分支顺序有讲究：
 * - `SetLimitExceeded` 要在 `429` 之前判（它是更具体的原因，文案也更有用）
 * - 探针专用的 400 要在通用 400 之前判，且**必须带 `probe` 标记**（见下）
 * - 网络层失败（`httpStatus === null`）要最先判，因为方舟 401 读不到响应体
 */
export function classifyAiProbe(input) {
    const make = (status, charged = false) => ({
        status,
        level: LEVEL[status],
        linkKind: LINK[status],
        charged,
    });
    const code = String(input.code ?? '');
    const message = String(input.message ?? '');
    const both = `${code} ${message}`.toLowerCase();
    const netErr = String(input.networkError ?? '').toLowerCase();
    const has = (...needles) => needles.some((n) => both.includes(n.toLowerCase()));
    const netHas = (...needles) => needles.some((n) => netErr.includes(n.toLowerCase()));
    // ① 主动超时
    if (netHas('aborterror', 'the operation was aborted', 'timeout'))
        return make('timeout');
    // ② 网络层失败。方舟在 Key 无效时返回的 401 不带跨域头，浏览器读不到响应体，
    //    所以「Key 不对」在这里只能表现成 TypeError / Failed to fetch。
    if (input.httpStatus === null)
        return make('bad-key');
    // ③ 模型没开通（最具体，优先）
    if (has('modelnotopen', 'has not activated the model'))
        return make('model-not-open');
    // ④ 模型 ID 写错 / 不存在 / 无权限
    if (has('invalidendpointormodel', 'does not exist or you do not have access', 'modelnotfound')) {
        return make('model-not-found');
    }
    // ⑤ 调用上限被触发（免费额度用完 / 控制台设了用量上限）。这一类**没有生成图片**。
    if (has('setlimitexceeded'))
        return make('rate-limited');
    // ⑥ 频率或额度
    if (input.httpStatus === 429 || has('ratelimit', 'rate limit', 'quota', 'toomanyrequests')) {
        return make('rate-limited');
    }
    // ⑦ 内容审核
    if (has('policyviolation', 'sensitive', 'contentpolicy', 'risk'))
        return make('policy');
    // ⑧ 鉴权（能读到响应体的情况）
    if (input.httpStatus === 401 || has('authenticationerror', 'invalid api key', 'unauthorized')) {
        return make('bad-key');
    }
    // ⑨ 服务端错误
    if (input.httpStatus !== null && input.httpStatus >= 500)
        return make('server-error');
    // ⑩ 探针专用：参数校验被拒 = Key 与模型都通过了。必须排在通用 400 之前。
    //    注意条件是 `probe` 标记 —— 方舟会先校验鉴权再校验参数（假 Key 实测走的是 ② 的
    //    网络层失败，不是 400），所以探针收到的 400 一定意味着「认证和模型都过了」。
    //    真实重绘没有这个标记，它的 400 会落到 ⑪，不会被误判成成功。
    if (input.probe === true && input.httpStatus === 400)
        return make('ok');
    // ⑪ 其它 400
    if (input.httpStatus === 400)
        return make('bad-request');
    return make('unknown');
}
/** 从一次探针 fetch 的结果里抽出分类需要的字段（放在这里便于单测）。
 *  一定会带上 `probe: true` —— 见 `AiProbeInput.probe` 的说明。 */
export function probeInputFromResponse(httpStatus, rawBody) {
    let code = '';
    let message = '';
    try {
        const json = JSON.parse(rawBody);
        code = json?.error?.code ?? json?.code ?? '';
        message = json?.error?.message ?? json?.message ?? '';
    }
    catch {
        message = rawBody.slice(0, 200);
    }
    return { httpStatus, code, message, probe: true };
}
/** 响应体里有没有真的图片数据（`b64_json` / `data[].url`）。
 *  这是「本次探针**没有扣费**」的判据：没有图片 ⇒ 方舟没走到生成那一步。 */
export function sawImageData(rawBody) {
    let json = null;
    try {
        json = JSON.parse(rawBody);
    }
    catch {
        return { hasImage: false, urlCount: 0, b64: false };
    }
    const arr = Array.isArray(json?.data) ? json.data : [];
    const b64 = arr.some((d) => !!d?.b64_json);
    const urlCount = arr.filter((d) => !!d?.url).length;
    return { hasImage: b64 || urlCount > 0, urlCount, b64 };
}
/** 从响应体里抠出 code / message / request_id（分类器只需要 code+message，另两个给诊断用） */
function readBodyFields(rawBody) {
    try {
        const json = JSON.parse(rawBody);
        return {
            code: String(json?.error?.code ?? json?.code ?? ''),
            message: String(json?.error?.message ?? json?.message ?? ''),
            requestId: String(json?.error?.request_id ?? json?.request_id ?? ''),
        };
    }
    catch {
        return { code: '', message: String(rawBody ?? '').slice(0, 200), requestId: '' };
    }
}
/**
 * 候选模型 ID（**最新优先**）。
 *
 * 界面上的 `datalist` 与本列表共用这一份常量 —— 加/删模型只改这里一行。
 * 顺序即探测顺序：排在前面的先试，命中就停。
 */
export const ARK_MODEL_CANDIDATES = [
    'doubao-seedream-5-0-pro-260628',
    'doubao-seedream-4-0-250828',
    'doubao-seedream-3-0-t2i-250628',
];
/**
 * 发一次零费用探针，并把结果分类好。
 *
 * ⚠️ 请求体**只能**来自 `probeBody()`（size 固定 1x1）。
 *    这里没有任何让调用方传 size / 传 image 的口子。
 */
export async function probeModel(modelId, apiKey, options = {}) {
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
    const body = probeBody(modelId);
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    const started = Date.now();
    const base = {
        modelId,
        attempt: options.attempt ?? 1,
        httpStatus: null,
        code: '',
        requestId: '',
        message: '',
        sentBody: body,
        ms: 0,
    };
    const emptyImage = { hasImage: false, urlCount: 0, b64: false };
    try {
        const resp = await fetchImpl(ARK_PROBE_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${String(apiKey ?? '').trim()}`,
            },
            body: JSON.stringify(body),
            ...(controller ? { signal: controller.signal } : {}),
        });
        const rawBody = await resp.text();
        const fields = readBodyFields(rawBody);
        const input = { httpStatus: resp.status, code: fields.code, message: fields.message, probe: true };
        const verdict = classifyAiProbe(input);
        return {
            ...base,
            ...fields,
            httpStatus: resp.status,
            status: verdict.status,
            level: verdict.level,
            linkKind: verdict.linkKind,
            charged: verdict.charged,
            raw: {
                code: fields.code,
                requestId: fields.requestId,
                message: fields.message,
                httpStatus: resp.status,
            },
            imageData: sawImageData(rawBody),
            ms: Date.now() - started,
        };
    }
    catch (error) {
        if (timer)
            clearTimeout(timer);
        const name = String(error?.name ?? 'Error');
        const message = String(error?.message ?? error ?? '');
        const input = { httpStatus: null, networkError: `${name}: ${message}`, probe: true };
        const verdict = classifyAiProbe(input);
        return {
            ...base,
            status: verdict.status,
            level: verdict.level,
            linkKind: verdict.linkKind,
            charged: verdict.charged,
            message,
            raw: { code: '', requestId: '', message, httpStatus: null },
            imageData: emptyImage,
            ms: Date.now() - started,
        };
    }
    finally {
        if (timer)
            clearTimeout(timer);
    }
}
/**
 * **自动识别这个账号到底开通了哪个模型** —— 用户完全不需要知道版本号。
 *
 * 依次拿候选模型 ID 打零费用探针（`size:1x1`，不生成图片、不扣费）：
 * - 探针返回「参数校验被拒」(`ok`) → **立即停止**并返回该模型 ID；
 * - `model-not-open` / `model-not-found` → 模型这条路走不通，继续试下一个；
 * - Key / 网络 / 超时 / 服务端 / 额度 → **立即中止**（继续试没有意义），返回对应分类；
 * - 全部试完都没命中 → `none`，并区分「全是未开通」/「全是 ID 不存在」（后者 = 候选列表过时了）。
 *
 * 返回结构里永远带上**试了几个、每个的 HTTP 状态与错误码**，便于诊断与展示。
 */
export async function detectActivatedModel(apiKey, candidates = ARK_MODEL_CANDIDATES, options = {}) {
    const probes = [];
    for (let index = 0; index < candidates.length; index += 1) {
        const modelId = candidates[index];
        const probe = await probeModel(modelId, apiKey, {
            fetchImpl: options.fetchImpl,
            timeoutMs: options.timeoutMs,
            attempt: index + 1,
        });
        probes.push(probe);
        // ✅ 命中：Key 有效 + 这个模型已开通可用。**立即停止**，不再打后面的候选。
        if (probe.status === 'ok') {
            return { kind: 'found', modelId, attempts: probes.length, probes };
        }
        // 模型这条路走不通（没开通 / ID 不存在）→ 试下一个
        if (probe.status === 'model-not-open' || probe.status === 'model-not-found')
            continue;
        // 其它一律是「跟这个模型无关的坏消息」：Key 不对、网络不通、超时、额度、服务端…
        // 继续拿同一个 Key 去试别的模型只会重复失败，所以立刻中止。
        return {
            kind: 'error',
            reason: probe.status,
            probes,
            detail: formatRawBits(probe.raw),
        };
    }
    const statuses = probes.map((p) => p.status);
    const reason = statuses.every((s) => s === 'model-not-open')
        ? 'all-not-open'
        : statuses.every((s) => s === 'model-not-found')
            ? 'all-not-found'
            : 'mixed';
    return { kind: 'none', reason, probes };
}
//# sourceMappingURL=arkDiagnostics.js.map