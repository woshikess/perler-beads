// 本地适配：让裸模块名 'react' 与 'react-dom/client' 在浏览器里可解析。
// vendor/ 里放的是 UMD 版 react / react-dom（挂到全局），这里加一层 ESM 包装。
// 仅本地副本新增，上游无此文件。
const React = globalThis.React;

if (!React) {
  throw new Error('react shim: globalThis.React 未加载，请确认 index.html 里 vendor/react.production.min.js 在 shim 之前');
}

export default React;

export const {
  Children,
  Component,
  Fragment,
  Profiler,
  PureComponent,
  StrictMode,
  Suspense,
  cloneElement,
  createContext,
  createElement,
  createFactory,
  createRef,
  forwardRef,
  isValidElement,
  lazy,
  memo,
  startTransition,
  useCallback,
  useContext,
  useDebugValue,
  useDeferredValue,
  useEffect,
  useId,
  useImperativeHandle,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  version,
} = React;
