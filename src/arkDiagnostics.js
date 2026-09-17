/**
 * 火山方舟「测试连接」探针 + 错误分类
 *
 * 设计要点：
 * 1. **纯函数、不依赖 React / DOM / 网络** —— 所以能直接单测，不需要真 Key。
 * 2. **只返回「状态」，不返回文案** —— 文案统一放在 App 的 i18n 表里按状态取，
 *    这样中英双语都能正确显示，而且「错误码 → 文案」的覆盖关系一眼可查。
 * 3. **零费用探针**：画布尺寸故意用 `1x1`，低于方舟要求的最小面积（921600）。
 *    方舟会在**参数校验阶段**就拒绝，不会生成图片、不扣费。
 *    错误消息本身就是证据（`image area must be at least`）。
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
//# sourceMappingURL=arkDiagnostics.js.map