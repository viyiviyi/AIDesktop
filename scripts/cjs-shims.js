/**
 * esbuild --inject shim for CJS bundle
 *
 * CJS 模式下 __dirname 和 __filename 是全局变量。
 * 通过 globalThis 定义，让 esbuild 能找到它们作为 export。
 */
const cjs_filename = globalThis.__filename;
const cjs_dirname = globalThis.__dirname;
export { cjs_filename as __filename, cjs_dirname as __dirname };
