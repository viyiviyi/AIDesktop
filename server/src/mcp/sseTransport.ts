/**
 * MCPSseTransport — MCP HTTP SSE 传输层
 *
 * 支持两种 MCP over HTTP 传输模式：
 * 1. SSE (传统模式): GET /sse 接收事件, POST /message 发送请求
 *    服务器通过 SSE 推送 endpoint 事件告知 POST URL
 * 2. Streamable HTTP (新模式): POST 单端点，响应流式返回
 *
 * JSON-RPC over SSE 协议:
 *   - 服务器通过 SSE 发送事件
 *   - endpoint 事件: 告知后续 POST 请求的 URL
 *   - message 事件: JSON-RPC 请求/响应/通知
 *   - 客户端通过 HTTP POST 发送 JSON-RPC 请求到 endpoint URL
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
  private customHeaders: Record<string, string>;

  constructor(
    sseUrl: string,
    connectionId: string = 'unknown',
    postUrl?: string,
    headers?: Record<string, string>,
  ) {
    this.connectionId = connectionId;
    this.sseUrl = sseUrl;
    this.postUrl = postUrl || sseUrl.replace(/\/?$/, '/message');
    this.customHeaders = headers || {};
  }

  /**
   * 开始 SSE 连接
   */
  async connect(): Promise<void> {
    logger.info('MCPSseTransport', `Connecting to SSE: ${this.sseUrl}`);

    this.abortController = new AbortController();

    // 先尝试 SSE GET 连接（标准 MCP SSE 协议）
    // 如果失败（如 400），回退到 Streamable HTTP 模式（纯 POST）
    let sseConnected = false;
    try {
      const response = await fetch(this.sseUrl, {
        method: 'GET',
        headers: {
          'Accept': 'text/event-stream',
          'Cache-Control': 'no-cache',
          ...this.customHeaders,
        },
        signal: this.abortController.signal,
      });

      if (response.ok && response.body) {
        sseConnected = true;
        this._isConnected = true;
        this.postUrl = this.sseUrl; // Streamable HTTP 模式：POST 到同一 URL

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

                  if (currentEvent === 'endpoint') {
                    const newPostUrl = data.trim();
                    if (newPostUrl) {
                      this.postUrl = newPostUrl.startsWith('http')
                        ? newPostUrl
                        : new URL(newPostUrl, this.sseUrl).href;
                      logger.info('MCPSseTransport', `Received endpoint: ${this.postUrl}`);
                    }
                  } else if (currentEvent === 'message' || currentEvent === '') {
                    try {
                      const message = JSON.parse(data) as JsonRpcMessage;
                      if (this.messageHandler) {
                        this.messageHandler(message);
                      }
                    } catch (e) {
                      logger.warn('MCPSseTransport', `Failed to parse SSE data: ${data.slice(0, 100)}`);
                    }
                  }
                  currentEvent = '';
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
      } else {
        logger.info('MCPSseTransport', `SSE GET returned ${response.status}, falling back to Streamable HTTP`);
      }
    } catch (error: any) {
      logger.info('MCPSseTransport', `SSE GET failed: ${error.message}, falling back to Streamable HTTP`);
    }

    if (!sseConnected) {
      // Streamable HTTP 模式：不使用 SSE 流，直接通过 POST 请求/响应
      this.postUrl = this.sseUrl;
      this._isConnected = true;
      logger.info('MCPSseTransport', `Using Streamable HTTP: ${this.postUrl}`);
    }
  }

  /**
   * 发送 JSON-RPC 消息（通过 HTTP POST）
   * 只负责发送，响应通过 SSE onMessage 渠道异步返回
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
          'Accept': 'application/json, text/event-stream',
          ...this.customHeaders,
        },
        body: JSON.stringify(message),
        signal: this.abortController?.signal,
      });

      if (!response.ok) {
        throw new Error(`POST failed: ${response.status} ${response.statusText}`);
      }

      // 对于 Streamable HTTP: 响应 body 可能直接包含 JSON-RPC 响应
      // 有 id 的请求（request）：通过 onMessage 异步处理
      // 无 id 的消息（notification）：直接返回
      if (message.id !== undefined) {
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          try {
            const json = await response.json() as JsonRpcMessage;
            if (this.messageHandler) {
              this.messageHandler(json);
            }
          } catch {
            // JSON 解析失败，忽略——响应会通过 SSE 回来
          }
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
