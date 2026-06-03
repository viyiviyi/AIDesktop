// 日志级别类型
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// 日志分类
export type LogCategory = 'api' | 'ai' | 'system' | 'mcp' | 'agent' | 'app' | 'console' | 'other';

// 单条日志条目结构
export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  category: LogCategory;
  source: string;
  message: string;
  data?: unknown;
}

// 日志分类信息
export interface LogCategoryInfo {
  id: LogCategory;
  label: string;
  enabled: boolean;
}

// 默认分类启用状态
const DEFAULT_CATEGORIES: Record<LogCategory, boolean> = {
  api: true,
  ai: true,
  system: true,
  mcp: true,
  agent: true,
  app: true,
  console: true,
  other: true,
};

// 日志级别优先级
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Logger类 - 前端日志系统
 */
class Logger {
  private logs: LogEntry[] = [];
  private maxLogs = 2000;
  private minLevel: LogLevel = 'debug';
  private enabledCategories: Record<LogCategory, boolean> = { ...DEFAULT_CATEGORIES };
  private listeners: Set<(entry: LogEntry) => void> = new Set();

  constructor() {
    this.setupConsoleCapture();
    // 从 localStorage 恢复分类配置
    try {
      const saved = localStorage.getItem('hermes_log_categories');
      if (saved) {
        this.enabledCategories = { ...this.enabledCategories, ...JSON.parse(saved) };
      }
    } catch {}
  }

  // 获取所有分类及其启用状态
  getCategories(): LogCategoryInfo[] {
    return (Object.keys(this.enabledCategories) as LogCategory[]).map(id => ({
      id,
      label: this.getCategoryLabel(id),
      enabled: this.enabledCategories[id],
    }));
  }

  // 切换分类启用状态
  toggleCategory(id: LogCategory): void {
    this.enabledCategories[id] = !this.enabledCategories[id];
    try {
      localStorage.setItem('hermes_log_categories', JSON.stringify(this.enabledCategories));
    } catch {}
  }

  // 分类是否启用
  isCategoryEnabled(category: LogCategory): boolean {
    return this.enabledCategories[category] !== false;
  }

  private getCategoryLabel(category: LogCategory): string {
    const labels: Record<LogCategory, string> = {
      api: 'API',
      ai: 'AI 模型',
      system: '系统',
      mcp: 'MCP',
      agent: 'Agent',
      app: '应用',
      console: '控制台',
      other: '其他',
    };
    return labels[category] || category;
  }

  setMinLevel(level: LogLevel) {
    this.minLevel = level;
  }

  addListener(listener: (entry: LogEntry) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(entry: LogEntry) {
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
    this.listeners.forEach((listener) => listener(entry));
  }

  private createEntry(level: LogLevel, category: LogCategory, source: string, message: string, data?: unknown): LogEntry {
    return {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      level,
      category,
      source,
      message,
      data,
    };
  }

  private shouldLog(level: LogLevel, category: LogCategory): boolean {
    if (LOG_LEVEL_PRIORITY[this.minLevel] > LOG_LEVEL_PRIORITY[level]) return false;
    if (!this.isCategoryEnabled(category)) return false;
    return true;
  }

  debug(category: LogCategory, source: string, message: string, data?: unknown) {
    if (!this.shouldLog('debug', category)) return;
    const entry = this.createEntry('debug', category, source, message, data);
    this.emit(entry);
  }

  info(category: LogCategory, source: string, message: string, data?: unknown) {
    if (!this.shouldLog('info', category)) return;
    const entry = this.createEntry('info', category, source, message, data);
    this.emit(entry);
  }

  warn(category: LogCategory, source: string, message: string, data?: unknown) {
    if (!this.shouldLog('warn', category)) return;
    const entry = this.createEntry('warn', category, source, message, data);
    this.emit(entry);
  }

  error(category: LogCategory, source: string, message: string, data?: unknown) {
    const entry = this.createEntry('error', category, source, message, data);
    this.emit(entry);
  }

  /** AI 日志专用快捷方法 */
  ai(source: string, message: string, data?: unknown) {
    this.info('ai', source, message, data);
  }

  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  getFilteredLogs(options: {
    level?: LogLevel;
    category?: LogCategory;
    source?: string;
    search?: string;
  }): LogEntry[] {
    return this.logs.filter((log) => {
      if (options.level && log.level !== options.level) return false;
      if (options.category && log.category !== options.category) return false;
      if (options.source && log.source !== options.source) return false;
      if (options.search) {
        const s = options.search.toLowerCase();
        if (!log.message.toLowerCase().includes(s) && !log.source.toLowerCase().includes(s)) {
          return false;
        }
      }
      return true;
    });
  }

  clear() {
    this.logs = [];
  }

  private setupConsoleCapture() {
    const originalConsole = { ...console };

    console.debug = (message: string, ...args: unknown[]) => {
      originalConsole.debug(message, ...args);
      this.debug('console', 'console', message, args.length > 0 ? args : undefined);
    };

    console.log = (message: string, ...args: unknown[]) => {
      originalConsole.log(message, ...args);
      this.info('console', 'console', message, args.length > 0 ? args : undefined);
    };

    console.warn = (message: string, ...args: unknown[]) => {
      originalConsole.warn(message, ...args);
      this.warn('console', 'console', message, args.length > 0 ? args : undefined);
    };

    console.error = (message: string, ...args: unknown[]) => {
      originalConsole.error(message, ...args);
      this.error('console', 'console', message, args.length > 0 ? args : undefined);
    };
  }
}

export const logger = new Logger();

// API日志辅助
export function logApi(method: string, url: string, options?: {
  status?: number;
  duration?: number;
  error?: string;
}) {
  if (options?.error) {
    logger.error('api', `API ${method}`, `${url} - ${options.error}`, { status: options.status, duration: options.duration });
  } else {
    logger.info('api', `API ${method}`, `${url}`, { status: options?.status, duration: options?.duration });
  }
}
