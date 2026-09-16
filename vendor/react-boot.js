// 本地适配：先把 UMD 版 react-dom 的 client 入口注册为 ESM 模块，再引导应用。
// 顺序很重要：必须先 import shim，浏览器才会解析并实例化它。
import './react-dom-client.esm.js';
import '../src/main.js';
