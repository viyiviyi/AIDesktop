import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { appLoader } from './services/appLoader.js';
import { settingsService } from './services/settings.js';
import appsRouter from './routes/apps.js';
import conversationsRouter from './routes/conversations.js';
import settingsRouter from './routes/settings.js';
import mcpRouter from './routes/mcp.js';
import { mcpClientRegistry } from './mcp/clientRegistry.js';
import hermesRouter from './routes/hermes.js';
import logsRouter from './routes/logs.js';
import workspaceRouter from './routes/workspace.js';
import mediaRouter from './routes/media.js';
import { ensureDir, APPS_DIR, APPS_DATA_DIR, CONFIGS_DIR } from './utils/file.js';
import { setupWebSocket } from './services/wsServer.js';

// __dirname / __filename — 兼容 tsx (ESM) 和 esbuild (CJS)
// tsx 下由 fileURLToPath 获得，esbuild CJS bundle 下通过 --inject 注入 polyfill
declare const __filename: string;
declare const __dirname: string;

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

  await appLoader.loadAll();
  await settingsService.getSettings();

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

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve static files from client build in production
// 优先检测运行目录下是否有 client/dist（bundle直接运行）
// 否则从项目根推算（dev模式或cli.mjs启动）
function resolveProjectRoot(): string {
  // cli.mjs 会设置 AIDESKTOP_ROOT
  if (process.env.AIDESKTOP_ROOT) return process.env.AIDESKTOP_ROOT;
  // 检测运行目录下的 client/dist（node server.cjs 直接运行）
  if (require('fs').existsSync(join(process.cwd(), 'client', 'dist'))) {
    return process.cwd();
  }
  // dev 模式：从 __dirname 推算（server/src/ -> 项目根）
  return join(__dirname, '..', '..');
}
const projectRoot = resolveProjectRoot();
const clientDistPath = join(projectRoot, 'client', 'dist');
const dataDir = join(projectRoot, 'desktop_data');
app.use('/public_icons', express.static(join(dataDir, 'public_icons')));
app.use('/wallpapers', express.static(join(dataDir, 'wallpapers')));
app.use('/api/files', express.static(join(dataDir, 'apps_data')));
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
