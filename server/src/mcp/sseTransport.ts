/**
 * MCPSseTransport — MCP HTTP SSE 传输层
 *
 * 支持两种 MCP over HTTP 传输模式：
 * 1. SSE (传统模式): GET /sse 接收事件, POST /message 发送请求
 * 2. Streamable HTTP (新模式): POST 单端点，响应流式返回
 *
 * JSON-RPC over SSE 协议:
 *   - 服务器通过 SSE 发送事件（event: message, data: JSON-RPC）
 *   - 客户端通过 HTTP POST 发送 JSON-RPC 请求到指定端点
 */

import { logger } from '../utils/logger.js';

// JSON-RPC 消息类型
export interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** SSE 传输层接口（与 StdioTransport 一致） */
export interface SseTransport {
  send(message: JsonRpcMessage): Promise<void>;
  onMessage(handler: (message: JsonRpcMessage) => void): void;
  onError(handler: (error: Error) => void): void;
  close(): void;
  isConnected(): boolean;
}

/**
 * MCP SSE 传输层实现
 * 通过 HTTP SSE 与 MCP 服务器通信
 */
export class MCPSseTransport implements SseTransport {
  private messageHandler: ((message: JsonRpcMessage) => void) | null = null;
  private errorHandler: ((error: Error) => void) | null = null;
  private abortController: AbortController | null = null;
  private _isConnected = false;
  private connectionId: string;
  private sseUrl: string;
  private postUrl: string;

  constructor(
    sseUrl: string,
    connectionId: string = 'unknown',
    postUrl?: string,
  ) {
    this.connectionId = connectionId;
    // SSE URL: 如 http://localhost:3001/mcp
    this.sseUrl = sseUrl;
    // POST URL: 如果未指定，默认使用 SSE URL 的 /message 端点
    this.postUrl = postUrl || sseUrl.replace(/\/?$/, '/message');
  }

  /**
   * 开始 SSE 连接
   */
  async connect(): Promise<void> {
    logger.info('MCPSseTransport', `Connecting to SSE: ${this.sseUrl}`);

    this.abortController = new AbortController();

    try {
      const response = await fetch(this.sseUrl, {
        method: 'GET',
        headers: {
          'Accept': 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`SSE connection failed: ${response.status} ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error('Response body is null');
      }

      this._isConnected = true;

      // 解析 SSE 流
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = '';

      const pump = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();

              if (trimmed.startsWith('event: ')) {
                currentEvent = trimmed.slice(7);
              } else if (trimmed.startsWith('data: ')) {
                const data = trimmed.slice(6);

                if (currentEvent === 'message' || currentEvent === '') {
                  try {
                    const message = JSON.parse(data) as JsonRpcMessage;
                    if (this.messageHandler) {
                      this.messageHandler(message);
                    }
                  } catch (e) {
                    logger.warn('MCPSseTransport', `Failed to parse SSE data: ${data.slice(0, 100)}`);
                  }
                }
              }
            }
          }
        } catch (error: any) {
          if (error.name !== 'AbortError') {
            logger.error('MCPSseTransport', `SSE stream error: ${error.message}`);
            this._isConnected = false;
            this.errorHandler?.(error);
          }
        }
      };

      pump().catch((error) => {
        logger.error('MCPSseTransport', `SSE pump error: ${error.message}`);
        this._isConnected = false;
      });

    } catch (error: any) {
      this._isConnected = false;
      throw new Error(`SSE connection failed: ${error.message}`);
    }
  }

  /**
   * 发送 JSON-RPC 消息（通过 HTTP POST）
   */
  async send(message: JsonRpcMessage): Promise<void> {
    if (!this._isConnected) {
      throw new Error('SSE transport is not connected');
    }

    try {
      const response = await fetch(this.postUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
        signal: this.abortController?.signal,
      });

      if (!response.ok) {
        throw new Error(`POST failed: ${response.status} ${response.statusText}`);
      }

      // 处理响应（Streamable HTTP 响应可能包含 JSON-RPC 响应）
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const json = await response.json() as JsonRpcMessage;
        if (this.messageHandler) {
          this.messageHandler(json);
        }
      }

      logger.debug('MCPSseTransport', `[${this.connectionId} sent] ${message.method || message.id}`);
    } catch (error: any) {
      logger.error('MCPSseTransport', `Failed to send message: ${error.message}`);
      throw error;
    }
  }

  onMessage(handler: (message: JsonRpcMessage) => void): void {
    this.messageHandler = handler;
  }

  onError(handler: (error: Error) => void): void {
    this.errorHandler = handler;
  }

  close(): void {
    logger.info('MCPSseTransport', `Closing SSE transport for ${this.connectionId}`);
    this.messageHandler = null;
    this.errorHandler = null;
    this._isConnected = false;
    this.abortController?.abort();
    this.abortController = null;
  }

  isConnected(): boolean {
    return this._isConnected;
  }
}
