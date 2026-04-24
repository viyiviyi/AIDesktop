/**
 * 简单日志工具
 * 提供带时间戳和分类的日志输出
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  category: string;
  message: string;
  data?: unknown;
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

function formatMessage(entry: LogEntry): string {
  const parts = [
    `[${entry.timestamp}]`,
    `[${entry.level.toUpperCase()}]`,
    `[${entry.category}]`,
    entry.message,
  ];

  if (entry.data !== undefined) {
    parts.push(JSON.stringify(entry.data));
  }

  return parts.join(' ');
}

function log(level: LogLevel, category: string, message: string, data?: unknown): void {
  const entry: LogEntry = {
    timestamp: formatTimestamp(),
    level,
    category,
    message,
    data,
  };

  const formatted = formatMessage(entry);

  switch (level) {
    case 'debug':
      console.debug(formatted);
      break;
    case 'info':
      console.info(formatted);
      break;
    case 'warn':
      console.warn(formatted);
      break;
    case 'error':
      console.error(formatted);
      break;
  }
}

export const logger = {
  debug(category: string, message: string, data?: unknown): void {
    log('debug', category, message, data);
  },
  info(category: string, message: string, data?: unknown): void {
    log('info', category, message, data);
  },
  warn(category: string, message: string, data?: unknown): void {
    log('warn', category, message, data);
  },
  error(category: string, message: string, data?: unknown): void {
    log('error', category, message, data);
  },
};
