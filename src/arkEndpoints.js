/**
 * 火山方舟的**订阅档位**与各自的接口地址。
 *
 * 为什么需要这张表：方舟现在把订阅分成三档，**每一档基础地址不同、Key 也不通用**
 * （跨档使用一律 401 AuthenticationError）：
 *
 *   - `标准（按量）`   https://ark.cn-beijing.volces.com/api/v3
 *   - `Agent Plan`    https://ark.cn-beijing.volces.com/api/plan/v3
 *   - `Coding Plan`   https://ark.cn-beijing.volces.com/api/coding/v3
 *
 * 用户只粘贴一把 `ark-…` 的 Key，**Key 的字符串本身分不出档位**（三档格式完全一样），
 * 所以只能"打一发零费用探针"去问。探针用 `size: 1x1`：方舟在参数校验阶段就拒绝，
 * 不生成图片、不扣费，但**能区分**"这个地址不认这把 Key"和"认了、只是模型不行"。
 *
 * ⚠️ 三档都走同一个路径 `/images/generations`。Coding Plan 是给编程模型用的，
 *    实测它对图片模型返回 404 `UnsupportedModel`（"does not support the agent plan feature"）
 *    —— 识别得出、但用不了，界面会如实说明。
 *
 * 外部佐证（三档基础地址）：https://github.com/holon-run/holon/pull/2137
 * 本仓库实测记录：`_审核\_暂存证据\第B44批-提示词分档调研与第一段对比\调研与第一段对比.md` 第 5 节
 */
export const ARK_HOST = 'https://ark.cn-beijing.volces.com';
/** 图片生成在三档里是同一个路径 */
export const ARK_IMAGES_PATH = '/images/generations';
/**
 * 档位表。**顺序 = 默认探测顺序**：
 * 先试最常用的按量，再试 Agent Plan，最后 Coding Plan（后者基本用不了图片模型）。
 * 调用方可以用 `orderArkTiers(preferred)` 把"上次成功的档位"提到最前面，省掉无用往返。
 */
export const ARK_BASES = [
    { tier: 'standard', baseUrl: ARK_HOST + '/api/v3' },
    { tier: 'agent-plan', baseUrl: ARK_HOST + '/api/plan/v3' },
    { tier: 'coding-plan', baseUrl: ARK_HOST + '/api/coding/v3' },
];
export const DEFAULT_ARK_TIER = 'standard';
export function isArkTier(value) {
    return ARK_BASES.some((b) => b.tier === value);
}
/** 某个档位的图片生成地址 */
export function arkImagesEndpoint(tier) {
    const found = ARK_BASES.find((b) => b.tier === tier) ?? ARK_BASES[0];
    return found.baseUrl + ARK_IMAGES_PATH;
}
/** 把偏好的档位排到最前面（其余保持原顺序），"上次成功的那档"先用 */
export function orderArkTiers(preferred) {
    const all = ARK_BASES.map((b) => b.tier);
    if (!preferred || !all.includes(preferred))
        return all;
    return [preferred, ...all.filter((t) => t !== preferred)];
}
/**
 * 按量（标准）档的图片生成地址 —— **保底常量**。
 *
 * 真正的请求应该用 `arkImagesEndpoint(识别出来的档位)`；这个常量留着是为了
 * 兼容旧引用与门禁（`工具脚本\_verify_ark_prompt.cjs` 会断言它是方舟端点）。
 */
export const ARK_ENDPOINT = arkImagesEndpoint(DEFAULT_ARK_TIER);
//# sourceMappingURL=arkEndpoints.js.map