import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { appState } from './services/appState.js';
import appsRouter from './routes/apps.js';
import conversationsRouter from './routes/conversations.js';
import settingsRouter from './routes/settings.js';
import mcpRouter from './routes/mcp.js';
import { mcpClientRegistry } from './mcp/clientRegistry.js';
import hermesRouter from './routes/hermes.js';
import logsRouter from './routes/logs.js';
import workspaceRouter from './routes/workspace.js';
import mediaRouter from './routes/media.js';
import injectionsRouter from './routes/injections.js';
import memoryRouter from './routes/memory.js';
import { ensureDir, APPS_DIR, APPS_DATA_DIR, CONFIGS_DIR, DATA_DIR, getSystemAppsDir } from './utils/file.js';
import { appLoader } from './services/appLoader.js';
import { setupWebSocket } from './services/wsServer.js';

// __filename / __dirname — 兼容 ESM (tsx) 和 CJS (esbuild bundle)
// ESM 下通过 import.meta.url 计算，CJS 下 __dirname/__filename 是原生全局变量
let __filename = '';
let __dirname = '';
try {
  __filename = fileURLToPath(import.meta.url);
  __dirname = dirname(__filename);
} catch {
  // CJS bundle: esbuild 的 CJS 模板中 __dirname/__filename 可直接使用
  __filename = typeof __filename !== 'undefined' ? __filename : '';
  __dirname = typeof __dirname !== 'undefined' ? __dirname : '';
}

const app = express();
const PORT = process.env.PORT || (() => {
  const idx = process.argv.findIndex(a => a === '--port');
  return idx !== -1 && process.argv[idx + 1] ? parseInt(process.argv[idx + 1]) : 27135;
})();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Initialize directories and load data
async function init() {
  // 确定 bundle 目录（用于定位系统应用）
  const bundleDir = (() => {
    const candidates = [
      __dirname,
      join(__dirname, '..'),
      join(__dirname, '..', '..'),
      process.cwd(),
    ];
    for (const dir of candidates) {
      try {
        require('fs').accessSync(join(dir, 'apps', 'system'));
        return dir;
      } catch {}
    }
    return __dirname;
  })();
  const systemAppsDir = getSystemAppsDir(bundleDir);
  appLoader.setSystemAppsDir(systemAppsDir);

  await ensureDir(systemAppsDir);
  await ensureDir(join(APPS_DIR, 'user'));
  await ensureDir(join(APPS_DIR, 'marketplace'));
  await ensureDir(APPS_DATA_DIR);
  await ensureDir(CONFIGS_DIR);
  await ensureDir(join(CONFIGS_DIR, '..', 'public_data', 'skills'));

  // 统一状态管理初始化（加载所有配置和 App）
  await appState.init();

  // Initialize MCP clients from config
  await mcpClientRegistry.initializeFromConfig();

  console.log('Server initialized');
}

// API Routes
app.use('/api/apps', appsRouter);
app.use('/api/apps/:appId/conversations', conversationsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/mcp', mcpRouter);
app.use('/api/hermes', hermesRouter);
app.use('/api/logs', logsRouter);
app.use('/api/workspace', workspaceRouter);
app.use('/api/apps', mediaRouter);

// Injections (memory 2.0 injection blocks)
app.use('/api/apps/:appId/injections', injectionsRouter);
app.use('/api/apps/:appId/memory', memoryRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve static files from client build in production
// 使用 utils/file.ts 中统一的 DATA_DIR（基于 process.cwd()）
// dev 模式: __dirname = server/src/ -> ../../client/dist
// bundle 模式: __dirname = build/aidesktop/ -> ./client/dist
const clientDistPath = (() => {
  // 可能的位置列表
  const candidates = [
    join(__dirname, 'client', 'dist'),                    // bundle 同目录
    join(__dirname, '..', 'client', 'dist'),              // 上级目录
    join(__dirname, '..', '..', 'client', 'dist'),        // dev 模式
    join(process.cwd(), 'client', 'dist'),                // cwd
  ];
  for (const dir of candidates) {
    try {
      const testPath = join(dir, 'index.html');
      require('fs').accessSync(testPath);
      return dir;
    } catch {}
  }
  // 最后的 fallback
  return join(__dirname, 'client', 'dist');
})();
// 静态文件 — wallpapers 从 bundle 同级的 client/dist/wallpapers 加载
const wallpapersDir = join(clientDistPath, 'wallpapers');
app.use('/wallpapers', express.static(wallpapersDir));
app.use('/api/files', express.static(join(DATA_DIR, 'apps_data')));
app.use(express.static(clientDistPath));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({ error: 'Not found' });
  } else {
    try {
      res.sendFile('index.html', { root: clientDistPath });
    } catch {
      res.sendFile('index.html', { root: process.cwd() });
    }
  }
});

// Start server
init().then(() => {
  const httpServer = app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Data directory: ${DATA_DIR}`);
    console.log(`System apps: ${join(__dirname, 'apps', 'system')}`);
    setupWebSocket(httpServer);
  });
}).catch((error) => {
  console.error('Failed to initialize:', error);
  process.exit(1);
});
