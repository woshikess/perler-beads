// 本地适配：'react-dom/client' 的 ESM 包装（见 react.esm.js 说明）。
const ReactDOM = globalThis.ReactDOM;

if (!ReactDOM) {
  throw new Error('react-dom shim: globalThis.ReactDOM 未加载');
}

export const createRoot = ReactDOM.createRoot;
export const hydrateRoot = ReactDOM.hydrateRoot;

export default ReactDOM;
