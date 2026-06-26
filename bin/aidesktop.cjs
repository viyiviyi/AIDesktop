#!/usr/bin/env node

/**
 * AIDesktop CLI 入口
 *
 * CJS wrapper → 动态导入 ESM 主入口
 * 这样 npm 全局 bin 也能正常工作（bin 文件必须用 CJS）
 *
 * 用法：
 *   aidesktop                 启动服务器（默认端口 27135）
 *   aidesktop --port 3000     指定端口
 *   aidesktop --help          显示帮助
 */

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');

// 确认我们找到了正确的包根目录
const pkgPath = path.join(ROOT, 'package.json');
if (!fs.existsSync(pkgPath)) {
  console.error('Error: Cannot find AIDesktop package. Reinstall with: npm install -g aidesktop');
  process.exit(1);
}

// Node >= 18 supports dynamic import() in CJS
import(path.join(ROOT, 'bin', 'cli.mjs'))
  .then(mod => mod.main(ROOT))
  .catch(err => {
    console.error('Failed to start AIDesktop:', err.message);
    process.exit(1);
  });
