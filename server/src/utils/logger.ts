/**
 * 后端日志系统
 * 支持内存缓存、分类、分级，提供 API 接口供前端查询和 SSE 实时推送。
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogCategory = 'api' | 'ai' | 'system' | 'mcp' | 'agent' | 'app' | 'other';

// 日志条目中 category 可以是任意字符串，方便兼容旧代码
const CATEGORY_LABELS: Record<string, string> = {
  api: 'API',
  ai: 'AI',
  system: '系统',
  mcp: 'MCP',
  agent: 'Agent',
  app: '应用',
  other: '其他',
};

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  category: string;
  message: string;
  data?: unknown;
}

// 日志监听器（用于 SSE 推送）
type LogListener = (entry: LogEntry) => void;

class ServerLogger {
  private logs: LogEntry[] = [];
  private maxLogs = 5000;
  private listeners = new Set<LogListener>();

  private createId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  private makeEntry(level: LogLevel, category: string, message: string, data?: unknown): LogEntry {
    return {
      id: this.createId(),
      timestamp: new Date().toISOString(),
      level,
      category,
      message,
      data,
    };
  }

  private emit(entry: LogEntry): void {
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) this.logs.shift();
    // 同时输出到 console
    const prefix = `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${CATEGORY_LABELS[entry.category] || entry.category}]`;
    const line = `${prefix} ${entry.message}${entry.data !== undefined ? ' ' + JSON.stringify(entry.data) : ''}`;
    switch (entry.level) {
      case 'debug': console.debug(line); break;
      case 'info':  console.info(line);  break;
      case 'warn':  console.warn(line);  break;
      case 'error': console.error(line); break;
    }
    // 通知 SSE 监听器
    for (const listener of this.listeners) {
      try { listener(entry); } catch {}
    }
  }

  // 订阅日志（SSE 使用）
  subscribe(listener: LogListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // 获取日志（支持过滤）
  getLogs(options?: {
    level?: LogLevel | LogLevel[];
    category?: LogCategory | LogCategory[];
    search?: string;
    limit?: number;
    offset?: number;
  }): LogEntry[] {
    let filtered = this.logs;
    if (options?.level) {
      const levels = Array.isArray(options.level) ? options.level : [options.level];
      filtered = filtered.filter(e => levels.includes(e.level));
    }
    if (options?.category) {
      const cats = Array.isArray(options.category) ? options.category : [options.category];
      filtered = filtered.filter(e => cats.includes(e.category as any));
    }
    if (options?.search) {
      const s = options.search.toLowerCase();
      filtered = filtered.filter(e =>
        e.message.toLowerCase().includes(s) ||
        e.category.toLowerCase().includes(s)
      );
    }
    const limit = options?.limit ?? 500;
    const offset = options?.offset ?? 0;
    return filtered.slice(-limit - offset, -offset || undefined);
  }

  clear(): void {
    this.logs = [];
  }

  // 便捷方法
  debug(category: string, message: string, data?: unknown): void {
    this.emit(this.makeEntry('debug', category, message, data));
  }
  info(category: string, message: string, data?: unknown): void {
    this.emit(this.makeEntry('info', category, message, data));
  }
  warn(category: string, message: string, data?: unknown): void {
    this.emit(this.makeEntry('warn', category, message, data));
  }
  error(category: string, message: string, data?: unknown): void {
    this.emit(this.makeEntry('error', category, message, data));
  }
  // AI 日志专用
  ai(source: string, message: string, data?: unknown): void {
    this.info('ai', `[${source}] ${message}`, data);
  }
  // API 日志专用
  api(method: string, url: string, status?: number, duration?: number): void {
    this.info('api', `${method} ${url}`, { status, duration });
  }
  apiError(method: string, url: string, status: number, err: string, duration?: number): void {
    this.error('api', `${method} ${url} - ${status}`, { status, duration, error: err });
  }
}

export const serverLogger = new ServerLogger();

// 向后兼容旧 import
export const logger = serverLogger;
