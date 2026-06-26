/**
 * 日志 API 路由
 * GET  /api/logs          — 获取日志（支持过滤）
 * GET  /api/logs/stream   — SSE 实时推送日志
 * POST /api/logs/clear    — 清空日志
 */

import { Router, Request, Response } from 'express';
import { serverLogger, type LogCategory, type LogLevel } from '../utils/logger.js';

const router = Router();

// GET /api/logs — 获取日志
router.get('/', (req: Request, res: Response) => {
  try {
    const { level, category, search, limit, offset } = req.query;

    const options: {
      level?: LogLevel | LogLevel[];
      category?: LogCategory | LogCategory[];
      search?: string;
      limit?: number;
      offset?: number;
    } = {};

    if (level && typeof level === 'string') {
      const parts = level.split(',');
      options.level = parts.length === 1 ? parts[0] as LogLevel : parts as LogLevel[];
    }
    if (category && typeof category === 'string') {
      const parts = category.split(',');
      options.category = parts.length === 1 ? parts[0] as LogCategory : parts as LogCategory[];
    }
    if (search && typeof search === 'string') options.search = search;
    if (limit) options.limit = parseInt(limit as string, 10);
    if (offset) options.offset = parseInt(offset as string, 10);

    const logs = serverLogger.getLogs(options);
    res.json({ logs, total: logs.length });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// GET /api/logs/stream — SSE 实时推送
router.get('/stream', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // 发送已缓存的日志
  const existing = serverLogger.getLogs({ limit: 200 });
  res.write(`data: ${JSON.stringify({ type: 'batch', logs: existing })}\n\n`);

  // 订阅新日志
  const unsubscribe = serverLogger.subscribe((entry) => {
    try {
      res.write(`data: ${JSON.stringify({ type: 'entry', entry })}\n\n`);
    } catch {
      unsubscribe();
    }
  });

  // 心跳
  const heartbeat = setInterval(() => {
    try {
      res.write(`: heartbeat\n\n`);
    } catch {
      clearInterval(heartbeat);
      unsubscribe();
    }
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

// POST /api/logs/clear
router.post('/clear', (_req: Request, res: Response) => {
  serverLogger.clear();
  res.json({ success: true });
});

export default router;
