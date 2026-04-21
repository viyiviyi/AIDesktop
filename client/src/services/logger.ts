export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  source: string;
  message: string;
  data?: unknown;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class Logger {
  private logs: LogEntry[] = [];
  private maxLogs = 1000;
  private minLevel: LogLevel = 'info';
  private listeners: Set<(entry: LogEntry) => void> = new Set();

  constructor() {
    // Capture console methods to route through logger
    this.setupConsoleCapture();
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

  debug(source: string, message: string, data?: unknown) {
    if (LOG_LEVEL_PRIORITY[this.minLevel] > LOG_LEVEL_PRIORITY.debug) return;
    const entry = this.createEntry('debug', source, message, data);
    this.emit(entry);
  }

  info(source: string, message: string, data?: unknown) {
    if (LOG_LEVEL_PRIORITY[this.minLevel] > LOG_LEVEL_PRIORITY.info) return;
    const entry = this.createEntry('info', source, message, data);
    this.emit(entry);
  }

  warn(source: string, message: string, data?: unknown) {
    if (LOG_LEVEL_PRIORITY[this.minLevel] > LOG_LEVEL_PRIORITY.warn) return;
    const entry = this.createEntry('warn', source, message, data);
    this.emit(entry);
  }

  error(source: string, message: string, data?: unknown) {
    const entry = this.createEntry('error', source, message, data);
    this.emit(entry);
  }

  getLogs(): LogEntry[] {
    return [...this.logs];
  }

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

  clear() {
    this.logs = [];
  }

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

export const logger = new Logger();

// Helper for API logging
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
