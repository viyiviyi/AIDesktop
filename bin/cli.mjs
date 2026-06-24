/**
 * AIDesktop CLI 主入口（ESM）
 * 由 bin/aidesktop.js（CJS wrapper）动态导入
 */

import { spawn, execSync } from 'child_process';
import { existsSync, readdirSync, mkdirSync, cpSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

export async function main(ROOT) {
  // ===== 解析 CLI 参数 =====
  const args = process.argv.slice(2);
  let port = process.env.PORT || '27135';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      port = args[i + 1];
      i++;
    }
    if (args[i] === '--help' || args[i] === '-h') {
      console.log(getHelpText());
      process.exit(0);
    }
  }

  // ===== 确保依赖已安装 =====
  ensureDeps(join(ROOT, 'server'), 'server');
  ensureDeps(join(ROOT, 'client'), 'client');

  // ===== 确保前端已构建 =====
  const clientDist = join(ROOT, 'client', 'dist');
  if (!existsSync(clientDist) || readdirSync(clientDist).length === 0) {
    console.log('[aidesktop] Building frontend...');
    execSync('npx vite build', { cwd: join(ROOT, 'client'), stdio: 'inherit' });
  }

  // ===== 确保 desktop_data 存在 =====
  await ensureDataDir(ROOT);

  // ===== 启动服务器 =====
  printBanner(port);

  const server = spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: join(ROOT, 'server'),
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      PORT: port,
      AIDESKTOP_ROOT: ROOT,
    },
  });

  // 自动打开浏览器
  setTimeout(() => {
    const url = `http://localhost:${port}`;
    try {
      const platform = process.platform;
      if (platform === 'darwin') spawn('open', [url]);
      else if (platform === 'win32') spawn('start', [url], { shell: true });
      else spawn('xdg-open', [url]);
    } catch {}
  }, 2000);

  server.on('close', (code) => {
    process.exit(code ?? 0);
  });

  process.on('SIGINT', () => { server.kill('SIGINT'); process.exit(0); });
  process.on('SIGTERM', () => { server.kill('SIGTERM'); process.exit(0); });
}

// ===== 辅助函数 =====

function ensureDeps(dir, name) {
  if (!existsSync(join(dir, 'node_modules'))) {
    console.log(`[aidesktop] Installing ${name} dependencies...`);
    execSync('npm install --legacy-peer-deps', { cwd: dir, stdio: 'inherit' });
  }
}

async function ensureDataDir(ROOT) {
  const dataDir = join(ROOT, 'desktop_data');
  if (existsSync(join(dataDir, 'apps', 'system'))) return;

  console.log('[aidesktop] Initializing data directory...');

  const dirs = [
    'apps/system', 'apps/user', 'apps/marketplace',
    'apps_data', 'configs', 'public_data', 'public_icons', 'wallpapers', 'logs',
  ];
  for (const d of dirs) mkdirSync(join(dataDir, d), { recursive: true });

  const srcData = join(ROOT, 'server', 'desktop_data');

  const copyIfExists = (sub) => {
    const src = join(srcData, sub);
    const dst = join(dataDir, sub);
    if (existsSync(src)) cpSync(src, dst, { recursive: true });
  };

  copyIfExists('apps/system');
  copyIfExists('public_icons');
  copyIfExists('public_data');
  copyIfExists('wallpapers');
  copyIfExists('configs');

  // 初始 modes.json（空模板）
  const modesPath = join(dataDir, 'configs', 'modes.json');
  if (!existsSync(modesPath)) {
    writeFileSync(modesPath, JSON.stringify({ providers: [] }, null, 2));
  }
}

function printBanner(port) {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║          AIDesktop                       ║
  ║  http://localhost:${String(port).padEnd(7)}           ║
  ╚══════════════════════════════════════════╝
  `);
}

function getHelpText() {
  return `

  AIDesktop — AI Desktop Environment

  USAGE
    aidesktop                  Start server (default port 27135)
    aidesktop --port 3000      Start on a specific port
    aidesktop --help           Show this help

  The browser will open automatically at http://localhost:<port>

  First run will install dependencies and build the frontend automatically.
  `;
}
