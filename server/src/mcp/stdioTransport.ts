import { ChildProcess } from 'child_process';
import { logger } from '../utils/logger.js';

// JSON-RPC消息类型
export interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

/**
 * Stdio传输层接口
 */
export interface StdioTransport {
  send(message: JsonRpcMessage): Promise<void>;
  onMessage(handler: (message: JsonRpcMessage) => void): void;
  onError(handler: (error: Error) => void): void;
  onStderr(handler: (data: string) => void): void;
  close(): void;
  isConnected(): boolean;
}

/**
 * MCP Stdio传输层实现
 * 通过标准输入输出与MCP服务器进程通信
 */
export class MCPStdioTransport implements StdioTransport {
  private messageHandler: ((message: JsonRpcMessage) => void) | null = null;
  private errorHandler: ((error: Error) => void) | null = null;
  private stderrHandler: ((data: string) => void) | null = null;
  private buffer: string = '';
  private connectionId: string;

  constructor(private process: ChildProcess, connectionId: string = 'unknown') {
    this.connectionId = connectionId;
    this.setupListeners();
  }

  private setupListeners(): void {
    // 处理stdout输出
    this.process.stdout?.on('data', (data: Buffer) => {
      this.handleData(data);
    });

    // 处理stderr输出
    this.process.stderr?.on('data', (data: Buffer) => {
      const message = data.toString().trim();
      if (message && this.stderrHandler) {
        this.stderrHandler(message);
      }
      logger.debug('MCPStdioTransport', `[${this.connectionId} stderr] ${message}`);
    });

    // 处理进程错误
    this.process.on('error', (error) => {
      logger.error('MCPStdioTransport', `Process error: ${error.message}`);
      if (this.errorHandler) {
        this.errorHandler(error);
      }
    });

    // 处理进程退出
    this.process.on('exit', (code, signal) => {
      logger.info('MCPStdioTransport', `Process exited with code ${code}, signal ${signal}`);
      if (this.errorHandler) {
        this.errorHandler(new Error(`Process exited with code ${code}, signal ${signal}`));
      }
    });
  }

  private handleData(data: Buffer): void {
    const text = data.toString();
    this.buffer += text;

    // 处理行协议 (JSON Lines)
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const message = JSON.parse(trimmed) as JsonRpcMessage;
        if (this.messageHandler) {
          this.messageHandler(message);
        }
      } catch (error) {
        logger.warn('MCPStdioTransport', `Failed to parse JSON message: ${trimmed}`);
      }
    }
  }

  /**
   * 发送JSON-RPC消息
   */
  async send(message: JsonRpcMessage): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.process.stdin) {
        reject(new Error('Process stdin is not available'));
        return;
      }

      if (this.process.exitCode !== null) {
        reject(new Error('Process has exited'));
        return;
      }

      const json = JSON.stringify(message) + '\n';
      const written = this.process.stdin.write(json, (error) => {
        if (error) {
          logger.error('MCPStdioTransport', `Failed to write message: ${error.message}`);
          reject(error);
        } else {
          logger.debug('MCPStdioTransport', `[${this.connectionId} sent] ${message.method || message.id}`);
          resolve();
        }
      });

      if (!written) {
        // 如果缓冲区已满，等待 drain 事件
        this.process.stdin.once('drain', resolve);
      }
    });
  }

  /**
   * 注册消息处理器
   */
  onMessage(handler: (message: JsonRpcMessage) => void): void {
    this.messageHandler = handler;
  }

  /**
   * 注册错误处理器
   */
  onError(handler: (error: Error) => void): void {
    this.errorHandler = handler;
  }

  /**
   * 注册stderr处理器
   */
  onStderr(handler: (data: string) => void): void {
    this.stderrHandler = handler;
  }

  /**
   * 关闭传输层
   */
  close(): void {
    logger.info('MCPStdioTransport', `Closing transport for ${this.connectionId}`);
    this.messageHandler = null;
    this.errorHandler = null;
    this.stderrHandler = null;
    this.buffer = '';

    // 关闭stdin
    if (this.process.stdin && !this.process.stdin.destroyed) {
      this.process.stdin.end();
    }
  }

  /**
   * 检查连接状态
   */
  isConnected(): boolean {
    return this.process.exitCode === null;
  }
}
