import { useState, useEffect, useRef } from 'react';
import { logger, type LogEntry, type LogLevel } from '../services/logger';

interface LogPanelProps {
  onClose?: () => void;
}

export function LogPanel({ onClose }: LogPanelProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<LogLevel | 'all'>('all');
  const [search, setSearch] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Load initial logs
    setLogs(logger.getLogs());

    // Subscribe to new logs
    const unsubscribe = logger.addListener((entry) => {
      setLogs((prev) => [...prev, entry]);
    });

    return () => { unsubscribe(); };
  }, []);

  useEffect(() => {
    if (autoScroll) {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const filteredLogs = logs.filter((log) => {
    if (filter !== 'all' && log.level !== filter) return false;
    if (search) {
      const s = search.toLowerCase();
      if (!log.message.toLowerCase().includes(s) &&
          !log.source.toLowerCase().includes(s)) {
        return false;
      }
    }
    return true;
  });

  const getLevelColor = (level: LogLevel) => {
    switch (level) {
      case 'debug': return 'var(--text-secondary)';
      case 'info': return 'var(--accent-color)';
      case 'warn': return 'var(--warning-color)';
      case 'error': return 'var(--error-color)';
    }
  };

  const getLevelBg = (level: LogLevel) => {
    switch (level) {
      case 'debug': return 'var(--bg-tertiary)';
      case 'info': return 'rgba(0, 120, 212, 0.1)';
      case 'warn': return 'rgba(255, 183, 77, 0.1)';
      case 'error': return 'rgba(248, 81, 73, 0.1)';
    }
  };

  const formatTime = (timestamp: string) => {
    const d = new Date(timestamp);
    return d.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    });
  };

  return (
    <div className="log-panel">
      <div className="log-panel-header">
        <h3>日志</h3>
        <div className="log-panel-controls">
          <input
            type="text"
            placeholder="搜索日志..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="log-panel-search"
          />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as LogLevel | 'all')}
            className="log-panel-filter"
          >
            <option value="all">全部</option>
            <option value="debug">调试</option>
            <option value="info">信息</option>
            <option value="warn">警告</option>
            <option value="error">错误</option>
          </select>
          <label className="log-panel-autoscroll">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />
            自动滚动
          </label>
          <button
            className="log-panel-clear-btn"
            onClick={() => logger.clear()}
            title="清除日志"
          >
            🗑️
          </button>
          {onClose && (
            <button
              className="log-panel-close-btn"
              onClick={onClose}
              title="关闭"
            >
              ×
            </button>
          )}
        </div>
      </div>

      <div className="log-panel-content">
        {filteredLogs.length === 0 ? (
          <div className="log-panel-empty">没有日志</div>
        ) : (
          filteredLogs.map((log) => (
            <div
              key={log.id}
              className="log-entry"
              style={{ borderLeftColor: getLevelColor(log.level) }}
            >
              <div className="log-entry-header">
                <span
                  className="log-entry-level"
                  style={{
                    color: getLevelColor(log.level),
                    background: getLevelBg(log.level),
                  }}
                >
                  {log.level.toUpperCase()}
                </span>
                <span className="log-entry-time">{formatTime(log.timestamp)}</span>
                <span className="log-entry-source">{log.source}</span>
              </div>
              <div className="log-entry-message">{log.message}</div>
              {log.data !== undefined && (
                <pre className="log-entry-data">
                  {typeof log.data === 'string'
                    ? log.data
                    : JSON.stringify(log.data, null, 2)}
                </pre>
              )}
            </div>
          ))
        )}
        <div ref={logsEndRef} />
      </div>
    </div>
  );
}
