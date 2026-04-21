// 日志级别类型
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// 单条日志条目结构
export interface LogEntry {
  id: string;           // 唯一标识
  timestamp: string;    // ISO时间戳
  level: LogLevel;      // 日志级别
  source: string;       // 来源模块
  message: string;      // 日志消息
  data?: unknown;       // 附加数据（可选）
}

// 日志级别优先级（数值越小级别越低）
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Logger类 - 前端日志系统
 * 支持日志记录、过滤、订阅、日志条数限制（最多1000条）
 * 自动捕获console输出
 */
class Logger {
  // 日志存储数组
  private logs: LogEntry[] = [];
  // 最大日志条数
  private maxLogs = 1000;
  // 最小日志级别（低于此级别的日志被忽略）
  private minLevel: LogLevel = 'info';
  // 日志监听器集合
  private listeners: Set<(entry: LogEntry) => void> = new Set();

  constructor() {
    // 捕获console方法，将日志路由到Logger
    this.setupConsoleCapture();
  }

  // 设置最小日志级别
  setMinLevel(level: LogLevel) {
    this.minLevel = level;
  }

  // 添加日志监听器，返回取消订阅函数
  addListener(listener: (entry: LogEntry) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // 发送日志（添加并通知监听器）
  private emit(entry: LogEntry) {
    this.logs.push(entry);
    // 超过最大条数时移除最早的日志
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
    // 通知所有监听器
    this.listeners.forEach((listener) => listener(entry));
  }

  // 创建日志条目
  private createEntry(level: LogLevel, source: string, message: string, data?: unknown): LogEntry {
    return {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      level,
      source,
      message,
      data,
    };
  }

  // 记录debug级别日志
  debug(source: string, message: string, data?: unknown) {
    if (LOG_LEVEL_PRIORITY[this.minLevel] > LOG_LEVEL_PRIORITY.debug) return;
    const entry = this.createEntry('debug', source, message, data);
    this.emit(entry);
  }

  // 记录info级别日志
  info(source: string, message: string, data?: unknown) {
    if (LOG_LEVEL_PRIORITY[this.minLevel] > LOG_LEVEL_PRIORITY.info) return;
    const entry = this.createEntry('info', source, message, data);
    this.emit(entry);
  }

  // 记录warn级别日志
  warn(source: string, message: string, data?: unknown) {
    if (LOG_LEVEL_PRIORITY[this.minLevel] > LOG_LEVEL_PRIORITY.warn) return;
    const entry = this.createEntry('warn', source, message, data);
    this.emit(entry);
  }

  // 记录error级别日志（始终记录，不受minLevel限制）
  error(source: string, message: string, data?: unknown) {
    const entry = this.createEntry('error', source, message, data);
    this.emit(entry);
  }

  // 获取所有日志
  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  // 获取过滤后的日志
  getFilteredLogs(options: {
    level?: LogLevel;
    source?: string;
    search?: string;
  }): LogEntry[] {
    return this.logs.filter((log) => {
      if (options.level && log.level !== options.level) return false;
      if (options.source && log.source !== options.source) return false;
      if (options.search) {
        const search = options.search.toLowerCase();
        if (!log.message.toLowerCase().includes(search) &&
            !log.source.toLowerCase().includes(search)) {
          return false;
        }
      }
      return true;
    });
  }

  // 清空所有日志
  clear() {
    this.logs = [];
  }

  // 设置console捕获 - 将console方法重定向到Logger
  private setupConsoleCapture() {
    const originalConsole = { ...console };

    console.debug = (message: string, ...args: unknown[]) => {
      originalConsole.debug(message, ...args);
      this.debug('console', message, args.length > 0 ? args : undefined);
    };

    console.log = (message: string, ...args: unknown[]) => {
      originalConsole.log(message, ...args);
      this.info('console', message, args.length > 0 ? args : undefined);
    };

    console.warn = (message: string, ...args: unknown[]) => {
      originalConsole.warn(message, ...args);
      this.warn('console', message, args.length > 0 ? args : undefined);
    };

    console.error = (message: string, ...args: unknown[]) => {
      originalConsole.error(message, ...args);
      this.error('console', message, args.length > 0 ? args : undefined);
    };
  }
}

// 单例导出
export const logger = new Logger();

// API日志辅助函数
export function logApi(method: string, url: string, options?: {
  status?: number;
  duration?: number;
  error?: string;
}) {
  if (options?.error) {
    logger.error(`API ${method}`, `${url} - ${options.error}`, {
      status: options.status,
      duration: options.duration,
    });
  } else {
    logger.info(`API ${method}`, `${url}`, {
      status: options?.status,
      duration: options?.duration,
    });
  }
}
