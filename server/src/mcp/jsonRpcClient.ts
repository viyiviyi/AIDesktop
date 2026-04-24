import { StdioTransport, JsonRpcMessage } from './stdioTransport.js';
import { logger } from '../utils/logger.js';

// JSON-RPC请求接口
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: unknown;
}

// JSON-RPC响应接口
export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: JsonRpcError;
}

// JSON-RPC错误接口
export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

// 待处理请求的解析器
interface Resolver {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/**
 * MCP JSON-RPC 2.0 客户端
 * 处理请求/响应模式和通知
 */
export class MCPJsonRpcClient {
  private requestId = 0;
  private pendingRequests: Map<number | string, Resolver> = new Map();
  private connectionId: string;

  constructor(private transport: StdioTransport, connectionId: string = 'unknown') {
    this.connectionId = connectionId;
    this.setupMessageHandler();
  }

  private setupMessageHandler(): void {
    this.transport.onMessage((message: JsonRpcMessage) => {
      this.handleMessage(message);
    });

    this.transport.onError((error: Error) => {
      logger.error('MCPJsonRpcClient', `Transport error: ${error.message}`);
      // 处理所有待处理的请求
      for (const [id, resolver] of this.pendingRequests.entries()) {
        resolver.reject(error);
        this.pendingRequests.delete(id);
      }
    });
  }

  private handleMessage(message: JsonRpcMessage): void {
    // 处理响应
    if ('id' in message && message.id !== undefined) {
      const resolver = this.pendingRequests.get(message.id);
      if (resolver) {
        if ('error' in message && message.error) {
          resolver.reject(new Error(`JSON-RPC error: ${message.error.message}`));
        } else if ('result' in message) {
          resolver.resolve(message.result);
        } else {
          resolver.resolve(undefined);
        }
        this.pendingRequests.delete(message.id);
      } else {
        logger.warn('MCPJsonRpcClient', `No pending request found for id: ${message.id}`);
      }
      return;
    }

    // 处理通知（没有id）
    if ('method' in message && message.method) {
      logger.debug('MCPJsonRpcClient', `[${this.connectionId} notification] ${message.method}`);
      // 通知暂时不处理，留给子类扩展
      return;
    }

    logger.warn('MCPJsonRpcClient', `Unknown message type: ${JSON.stringify(message)}`);
  }

  /**
   * 发送请求并等待响应
   */
  async request(method: string, params?: unknown): Promise<unknown> {
    const id = this.generateId();
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    logger.debug('MCPJsonRpcClient', `[${this.connectionId} request] ${method} (id: ${id})`);

    return new Promise((resolve, reject) => {
      // 设置超时
      const timeout = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request ${method} (id: ${id}) timed out`));
        }
      }, 60000); // 60秒超时

      // 保存解析器
      this.pendingRequests.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });

      // 发送请求
      this.transport.send(request).catch((error) => {
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        reject(error);
      });
    });
  }

  /**
   * 发送通知（无响应）
   */
  async notify(method: string, params?: unknown): Promise<void> {
    const notification: JsonRpcMessage = {
      jsonrpc: '2.0',
      method,
      params,
    };

    logger.debug('MCPJsonRpcClient', `[${this.connectionId} notify] ${method}`);
    await this.transport.send(notification);
  }

  /**
   * 生成唯一请求ID
   */
  private generateId(): number {
    return ++this.requestId;
  }

  /**
   * 检查是否连接
   */
  isConnected(): boolean {
    return this.transport.isConnected();
  }

  /**
   * 关闭客户端
   */
  close(): void {
    // 拒绝所有待处理的请求
    for (const [id, resolver] of this.pendingRequests.entries()) {
      resolver.reject(new Error('Connection closed'));
      this.pendingRequests.delete(id);
    }
    this.transport.close();
  }
}
