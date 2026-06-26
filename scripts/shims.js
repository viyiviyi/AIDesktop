/**
 * esbuild inject shim — 为 CJS bundle 提供 import.meta 兼容
 * esbuild 的 CJS 格式不支持 import.meta.url，这个 shim 注入替代实现。
 */
export const __filename = require('path').resolve(__dirname);
export const __dirname = require('path').dirname(require('path').resolve(__dirname));
export const import_meta = { url: 'file:///' + require('path').resolve(__dirname).replace(/\\/g, '/') };
