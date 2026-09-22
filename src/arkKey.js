/**
 * 判断一段文本像不像完整的火山方舟 API Key。
 *
 * W0.1 从 App.tsx 纯搬迁：L567–L571（`looksLikeArkKey`），内容一字未改。
 */
/** 看起来像不像一把完整的 Ark Key（粘贴完成才自动识别，避免边打字边打探针） */
export function looksLikeArkKey(value) {
    const key = value.trim();
    return key.startsWith('ark-') && key.length >= 24 && !/\s/.test(key);
}
//# sourceMappingURL=arkKey.js.map