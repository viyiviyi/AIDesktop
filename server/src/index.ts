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
import { ensureDir, APPS_DIR, APPS_DATA_DIR, CONFIGS_DIR, DATA_DIR } from './utils/file.js';
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
const PORT = process.env.PORT || 27135;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Initialize directories and load data
async function init() {
  await ensureDir(APPS_DIR);
  await ensureDir(join(APPS_DIR, 'system'));
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

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve static files from client build in production
// 使用 utils/file.ts 中统一的 DATA_DIR（基于 process.cwd()）
// dev 模式: __dirname = server/src/ -> ../../client/dist
// bundle 模式: __dirname = build/aidesktop/ -> ./client/dist
const clientDistPath = (() => {
  // 优先检测 bundle 同目录下的 client/dist
  const localDist = join(__dirname, 'client', 'dist');
  try {
    require('fs').accessSync(localDist);
    return localDist;
  } catch {
    // dev 模式
    return join(__dirname, '..', '..', 'client', 'dist');
  }
})();
app.use('/public_icons', express.static(join(DATA_DIR, 'public_icons')));
app.use('/wallpapers', express.static(join(DATA_DIR, 'wallpapers')));
app.use('/api/files', express.static(join(DATA_DIR, 'apps_data')));
app.use(express.static(clientDistPath));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({ error: 'Not found' });
  } else {
    res.sendFile(join(clientDistPath, 'index.html'));
  }
});

// Start server
init().then(() => {
  const httpServer = app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    setupWebSocket(httpServer);
  });
}).catch((error) => {
  console.error('Failed to initialize:', error);
  process.exit(1);
});
