import { useRef, useEffect, useCallback, useState } from 'react';

export interface WsConvEvent {
  type: string;
  appId: string;
  convId: string;
  data: Record<string, unknown>;
}

type EventListener = (event: WsConvEvent) => void;

// 开发模式下 Vite 代理 API 到 27135，但 WebSocket 需要直连 27135
// 打包后页面和 WebSocket 同端口（使用当前页面的端口）
const WS_URL = import.meta.env.DEV
  ? `ws://${window.location.hostname}:27135/api/ws`
  : `ws://${window.location.hostname}:${window.location.port}/api/ws`;

/**
 * 订阅指定会话的事件流（WebSocket）
 *
 * 支持多窗口：同一 conv 的多个窗口同时收到事件。
 * 组件卸载时自动取消订阅。
 */
export function useAgentEventStream(
  appId: string | undefined,
  convId: string | undefined,
  listener: EventListener,
) {
  const wsRef = useRef<WebSocket | null>(null);
  const listenerRef = useRef<EventListener>(listener);
  const subscribedRef = useRef(false);
  const [connected, setConnected] = useState(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  listenerRef.current = listener;

  const doSubscribe = useCallback((ws: WebSocket, cId: string) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'subscribe', convId: cId }));
      subscribedRef.current = true;
    }
  }, []);

  const doUnsubscribe = useCallback((ws: WebSocket, cId: string) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'unsubscribe', convId: cId }));
      subscribedRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!appId || !convId) return;

    let ws: WebSocket | null = null;
    let mounted = true;

    function connect() {
      if (!mounted) return;
      ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mounted) { ws?.close(); return; }
        setConnected(true);
        doSubscribe(ws!, convId!);
      };

      ws.onmessage = (event) => {
        if (!mounted) return;
        try {
          const parsed: WsConvEvent = JSON.parse(event.data);
          // 只处理当前 app 和 conv 的事件
          if (parsed.appId === appId && parsed.convId === convId) {
            listenerRef.current(parsed);
          }
        } catch { /* ignore */ }
      };

      ws.onclose = () => {
        setConnected(false);
        subscribedRef.current = false;
        if (mounted) {
          // 自动重连
          reconnectTimerRef.current = setTimeout(connect, 3000);
        }
      };

      ws.onerror = () => {
        ws?.close();
      };
    }

    connect();

    return () => {
      mounted = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (ws) {
        if (subscribedRef.current && convId) doUnsubscribe(ws, convId);
        ws.close();
      }
      wsRef.current = null;
      setConnected(false);
    };
  }, [appId, convId, doSubscribe, doUnsubscribe]);

  return { connected };
}
