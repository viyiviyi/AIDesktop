import { useState, useEffect, useRef } from 'react';
import { logger, type LogEntry, type LogLevel } from '../services/logger';

interface LogPanelProps {
  onClose?: () => void;
}

// 后端日志条目格式
interface ServerLogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  category: string;
  message: string;
  data?: unknown;
}

// 分类颜色
const CATEGORY_COLORS: Record<string, string> = {
  ai: '#8b5cf6',
  api: '#06b6d4',
  mcp: '#f59e0b',
  agent: '#22c55e',
  app: '#ec4899',
  system: '#64748b',
  other: '#94a3b8',
};

const CATEGORY_LABELS: Record<string, string> = {
  api: 'API', ai: 'AI', system: '系统', mcp: 'MCP',
  agent: 'Agent', app: '应用', other: '其他',
};

export function LogPanel({ onClose }: LogPanelProps) {
  const [localLogs, setLocalLogs] = useState<LogEntry[]>([]);
  const [serverLogs, setServerLogs] = useState<ServerLogEntry[]>([]);
  const [mode, setMode] = useState<'local' | 'server'>('server');
  const [filterLevel, setFilterLevel] = useState<LogLevel | 'all'>('all');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [connected, setConnected] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // 连接后端日志 SSE
  useEffect(() => {
    let eventSource: EventSource | null = null;
    let mounted = true;

    async function connect() {
      // 先拉取现有日志
      try {
        const res = await fetch('/api/logs?limit=500');
        const data = await res.json();
        if (mounted && data.logs) {
          setServerLogs(data.logs.reverse()); // 最新的在前面
        }
      } catch {}

      // SSE 实时推送
      try {
        eventSource = new EventSource('/api/logs/stream');
        eventSource.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'batch' && mounted) {
              setServerLogs(msg.logs.reverse());
              setConnected(true);
            } else if (msg.type === 'entry' && mounted) {
              setServerLogs(prev => [msg.entry, ...prev].slice(0, 2000));
            }
          } catch {}
        };
        eventSource.onopen = () => { if (mounted) setConnected(true); };
        eventSource.onerror = () => { if (mounted) setConnected(false); };
      } catch {}
    }

    connect();

    return () => {
      mounted = false;
      eventSource?.close();
    };
  }, []);

  // 订阅前端日志
  useEffect(() => {
    setLocalLogs(logger.getLogs());
    const unsubscribe = logger.addListener((entry) => {
      setLocalLogs((prev) => [entry, ...prev].slice(0, 2000));
    });
    return () => { unsubscribe(); };
  }, []);

  useEffect(() => {
    if (autoScroll) {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [localLogs, serverLogs, autoScroll]);

  const activeLogs = mode === 'server' ? serverLogs : localLogs;

  const filteredLogs = activeLogs.filter((log: any) => {
    if (filterLevel !== 'all' && log.level !== filterLevel) return false;
    if (filterCategory !== 'all' && log.category !== filterCategory) return false;
    if (search) {
      const s = search.toLowerCase();
      if (!log.message.toLowerCase().includes(s) &&
          !(log.category || '').toLowerCase().includes(s)) {
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

  const formatTime = (timestamp: string) => {
    const d = new Date(timestamp);
    return d.toLocaleTimeString('zh-CN', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3,
    });
  };

  return (
    <div className="log-panel">
      <div className="log-panel-header">
        <h3>日志 {connected && <span style={{ color: '#22c55e', fontSize: 11 }}>● 已连接</span>}</h3>
        <div className="log-panel-controls">
          <input type="text" placeholder="搜索..." value={search}
            onChange={(e) => setSearch(e.target.value)} className="log-panel-search"
          />
          <select value={filterLevel}
            onChange={(e) => setFilterLevel(e.target.value as LogLevel | 'all')}
            className="log-panel-filter"
          >
            <option value="all">全部级别</option>
            <option value="debug">调试</option>
            <option value="info">信息</option>
            <option value="warn">警告</option>
            <option value="error">错误</option>
          </select>
          <select value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="log-panel-filter"
          >
            <option value="all">全部分类</option>
            {Object.entries(CATEGORY_LABELS).map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
          <select value={mode} onChange={(e) => setMode(e.target.value as 'local' | 'server')} className="log-panel-filter">
            <option value="server">服务端日志</option>
            <option value="local">客户端日志</option>
          </select>
          <label className="log-panel-autoscroll">
            <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
            自动滚动
          </label>
          <button className="log-panel-clear-btn" onClick={async () => {
            if (mode === 'server') {
              await fetch('/api/logs/clear', { method: 'POST' });
              setServerLogs([]);
            } else {
              logger.clear();
              setLocalLogs([]);
            }
          }} title="清除">🗑️</button>
          {onClose && <button className="log-panel-close-btn" onClick={onClose}>×</button>}
        </div>
      </div>

      <div className="log-panel-content">
        {filteredLogs.length === 0 ? (
          <div className="log-panel-empty">没有日志</div>
        ) : (
          filteredLogs.map((log: any) => (
            <div key={log.id} className="log-entry" style={{ borderLeftColor: getLevelColor(log.level) }}>
              <div className="log-entry-header">
                <span className="log-entry-level" style={{ color: getLevelColor(log.level), background: `${getLevelColor(log.level)}15` }}>
                  {log.level.toUpperCase()}
                </span>
                {log.category && (
                  <span className="log-entry-category" style={{
                    color: CATEGORY_COLORS[log.category] || '#94a3b8',
                    background: `${CATEGORY_COLORS[log.category] || '#94a3b8'}15`,
                    fontSize: 10, padding: '1px 5px', borderRadius: 3, marginLeft: 4,
                  }}>
                    {CATEGORY_LABELS[log.category] || log.category}
                  </span>
                )}
                <span className="log-entry-time">{formatTime(log.timestamp)}</span>
              </div>
              <div className="log-entry-message">{log.message}</div>
              {log.data !== undefined && (
                <pre className="log-entry-data">
                  {typeof log.data === 'string' ? log.data : JSON.stringify(log.data, null, 2)}
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
