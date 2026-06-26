/**
 * WebSocket 服务 — 前端通过 WebSocket 订阅 Agent 事件
 *
 * 不再使用 SSE stream 路由。前端连接后按 convId 订阅事件，
 * 支持多窗口：同一 conv 的事件会广播给所有订阅该 conv 的前端窗口。
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { eventBus } from '../services/eventBus.js';
import { serverLogger } from '../utils/logger.js';

interface WsClient {
  ws: WebSocket;
  subscribedConvs: Set<string>;
}

const clients = new Set<WsClient>();

export function setupWebSocket(httpServer: Server): void {
  const wss = new WebSocketServer({ server: httpServer, path: '/api/ws' });

  wss.on('connection', (ws: WebSocket) => {
    const client: WsClient = { ws, subscribedConvs: new Set() };
    clients.add(client);

    serverLogger.info('system', 'WebSocket client connected');

    ws.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (msg.type === 'subscribe' && msg.convId) {
          client.subscribedConvs.add(msg.convId);
          serverLogger.debug('system', `WS subscribed to conv ${msg.convId}`);
        } else if (msg.type === 'unsubscribe' && msg.convId) {
          client.subscribedConvs.delete(msg.convId);
        }
      } catch { /* invalid message */ }
    });

    ws.on('close', () => {
      clients.delete(client);
      serverLogger.info('system', 'WebSocket client disconnected');
    });

    ws.on('error', () => {
      clients.delete(client);
    });
  });

  // 订阅事件总线，广播给匹配的 WebSocket 客户端
  eventBus.subscribeAll((event) => {
    for (const client of clients) {
      if (client.ws.readyState === WebSocket.OPEN && client.subscribedConvs.has(event.convId)) {
        try {
          client.ws.send(JSON.stringify({
            type: event.type,
            appId: event.appId,
            convId: event.convId,
            data: event.data,
          }));
        } catch { /* ignore */ }
      }
    }
  });

  serverLogger.info('system', 'WebSocket server mounted at /api/ws');
}

/** 向指定会话的所有订阅者发送事件 */
export function emitToConv(
  appId: string,
  convId: string,
  type: string,
  data: Record<string, unknown>,
): void {
  eventBus.emit({ type: type as any, appId, convId, data });
}
