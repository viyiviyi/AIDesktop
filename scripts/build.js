/**
 * AIDesktop 构建脚本（发布前执行）
 * 1. 构建前端 (client/dist)
 * 2. 用 esbuild 把 server 打包成单个 .cjs 文件（含所有依赖）
 * 3. 将 desktop_data 中需要发布的静态资源复制到包根目录
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, cpSync, readdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function run(cmd, cwd = ROOT) {
  console.log(`[build] ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

function log(msg) {
  console.log(`[build] ${msg}`);
}

async function build() {
  log('AIDesktop 构建开始...');

  // 1. 构建前端
  const clientDir = join(ROOT, 'client');
  if (existsSync(clientDir)) {
    log('构建前端...');
    run('npx vite build', clientDir);
  }

  // 2. 构建后端（单文件 bundle）
  const serverDir = join(ROOT, 'server');
  const vendorAliases = [
    '--alias:@earendil-works/pi-ai=../vendor/pi/packages/ai/src',
    '--alias:@earendil-works/pi-agent-core=../vendor/pi/packages/agent/src',
  ].join(' ');

  const outputFile = join(ROOT, 'server.cjs');
  log('构建后端 bundle...');
  run(
    `npx esbuild src/index.ts ` +
    `--bundle --platform=node --format=cjs --target=node20 ` +
    `--outfile="${outputFile}" ` +
    `--external:playwright ` +
    `--external:@playwright/mcp ` +
    vendorAliases,
    serverDir
  );

  log(`后端 bundle: ${outputFile}`);

  // 3. 复制 desktop_data 中需要的系统应用和数据
  const sourceData = join(ROOT, 'server', 'desktop_data');
  const targetData = join(ROOT, 'desktop_data');

  // 如果已经存在则跳过（install.js 已经做了）
  if (!existsSync(join(targetData, 'apps', 'system'))) {
    mkdirSync(join(targetData, 'apps', 'system'), { recursive: true });
    if (existsSync(join(sourceData, 'apps', 'system'))) {
      cpSync(join(sourceData, 'apps', 'system'), join(targetData, 'apps', 'system'), { recursive: true });
    }
  }

  // 确保目录结构
  const dirs = [
    'apps/user',
    'apps/marketplace',
    'apps_data',
    'configs',
    'public_data',
    'public_icons',
    'wallpapers',
    'logs',
  ];
  for (const d of dirs) {
    mkdirSync(join(targetData, d), { recursive: true });
  }

  log('构建完成！');
}

build().catch(e => {
  console.error('[build] 构建失败:', e.message);
  process.exit(1);
});
