/**
 * AIDesktop 安装脚本
 * postinstall 时自动执行：
 *   1. 安装 server 依赖
 *   2. 安装 client 依赖
 *   3. 构建前端（client/dist）
 *   4. 初始化 desktop_data 目录（如果不存在）
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, copyFileSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function run(cmd, cwd = ROOT) {
  console.log(`[install] ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

function log(msg) {
  console.log(`[install] ${msg}`);
}

async function install() {
  log('AIDesktop 安装开始...');

  // 1. 安装 server 依赖
  const serverDir = join(ROOT, 'server');
  if (existsSync(join(serverDir, 'package.json'))) {
    log('安装 server 依赖...');
    run('npm install --legacy-peer-deps', serverDir);
  }

  // 2. 安装 client 依赖
  const clientDir = join(ROOT, 'client');
  if (existsSync(join(clientDir, 'package.json'))) {
    log('安装 client 依赖...');
    run('npm install --legacy-peer-deps', clientDir);
  }

  // 3. 构建前端
  if (existsSync(clientDir)) {
    const clientDist = join(clientDir, 'dist');
    if (!existsSync(clientDist) || readdirSync(clientDist).length === 0) {
      log('构建前端...');
      run('npx vite build', clientDir);
    } else {
      log('前端已构建，跳过');
    }
  }

  // 4. 初始化 desktop_data 目录
  const dataDir = join(ROOT, 'desktop_data');
  const dirs = [
    'apps/system',
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
    mkdirSync(join(dataDir, d), { recursive: true });
  }

  // 如果 source desktop_data 存在，复制系统应用和数据
  const sourceData = join(ROOT, 'server', 'desktop_data');
  const targetData = dataDir;

  if (existsSync(sourceData)) {
    // 复制系统应用
    const srcSystem = join(sourceData, 'apps', 'system');
    const dstSystem = join(targetData, 'apps', 'system');
    if (existsSync(srcSystem) && (!existsSync(dstSystem) || readdirSync(dstSystem).length === 0)) {
      copyRecursive(srcSystem, dstSystem);
      log('系统应用已复制');
    }

    // 复制公共图标
    const srcIcons = join(sourceData, 'public_icons');
    const dstIcons = join(targetData, 'public_icons');
    if (existsSync(srcIcons) && (!existsSync(dstIcons) || readdirSync(dstIcons).length === 0)) {
      copyRecursive(srcIcons, dstIcons);
      log('公共图标已复制');
    }

    // 复制壁纸
    const srcWallpapers = join(sourceData, 'wallpapers');
    const dstWallpapers = join(targetData, 'wallpapers');
    if (existsSync(srcWallpapers)) {
      copyRecursive(srcWallpapers, dstWallpapers);
    }

    // 复制 skills
    const srcSkills = join(sourceData, 'public_data');
    const dstSkills = join(targetData, 'public_data');
    if (existsSync(srcSkills)) {
      copyRecursive(srcSkills, dstSkills);
    }

    // 初始化 configs
    const srcConfigs = join(sourceData, 'configs');
    const dstConfigs = join(targetData, 'configs');
    if (existsSync(srcConfigs)) {
      copyRecursive(srcConfigs, dstConfigs);
    }
  }

  log('安装完成！运行 aidesktop 启动。');
}

function copyRecursive(src, dest) {
  try {
    const { copyFileSync, mkdirSync, readdirSync, statSync } = require('fs');
    const { join } = require('path');
    
    mkdirSync(dest, { recursive: true });
    const entries = readdirSync(src, { withFileTypes: true });
    
    for (const entry of entries) {
      const srcPath = join(src, entry.name);
      const destPath = join(dest, entry.name);
      
      if (entry.isDirectory()) {
        copyRecursive(srcPath, destPath);
      } else {
        copyFileSync(srcPath, destPath);
      }
    }
  } catch (e) {
    // 忽略复制错误
  }
}

install().catch(e => {
  console.error('[install] 安装失败:', e.message);
  process.exit(1);
});
