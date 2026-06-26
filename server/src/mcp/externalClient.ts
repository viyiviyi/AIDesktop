/**
 * MCPExternalClient — 外部 MCP 服务器客户端
 *
 * 使用 @modelcontextprotocol/sdk 官方 SDK 管理连接。
 * 支持 Stdio、Streamable HTTP、SSE、WebSocket 四种传输模式。
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { MCPConnection } from '../types/index.js';
import { logger } from '../utils/logger.js';

// MCP工具接口
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: object;
}

// MCP资源接口
export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

/**
 * 外部MCP服务器客户端
 * 连接到外部MCP服务器并与其通信
 */
export class MCPExternalClient {
  private client!: Client;
  private initialized = false;
  private connectionId: string;
  private serverInfo: { name: string; version: string } | null = null;
  private capabilities: Record<string, unknown> = {};
  private tools: MCPTool[] = [];
  private resources: MCPResource[] = [];

  constructor(private connection: MCPConnection) {
    this.connectionId = connection.id;
  }

  /**
   * 连接到MCP服务器
   */
  async connect(): Promise<void> {
    const transportType = this.connection.transportType || 'stdio';

    logger.info('MCPExternalClient', `Connecting to ${this.connection.name} via ${transportType}`);

    // 构建请求头（自定义 headers 中的认证信息）
    const headers: Record<string, string> = {};
    if (this.connection.headers) {
      for (const h of this.connection.headers) {
        if (h.key) headers[h.key] = h.value;
      }
    }

    let transport;

    if (transportType === 'sse' && this.connection.url) {
      // SSE 传输：使用官方 SSEClientTransport
      transport = new SSEClientTransport(new URL(this.connection.url), {
        requestInit: { headers },
      });
    } else if (transportType === 'http' && this.connection.url) {
      // Streamable HTTP 传输：使用官方 StreamableHTTPClientTransport
      transport = new StreamableHTTPClientTransport(new URL(this.connection.url), {
        requestInit: { headers },
      });
    } else {
      // Stdio 传输：使用官方 StdioClientTransport
      if (!this.connection.command) throw new Error('Stdio transport requires a command');
      transport = new StdioClientTransport({
        command: this.connection.command,
        args: this.connection.args || [],
        ...(this.connection.cwd ? { cwd: this.connection.cwd } : {}),
        env: { ...process.env, ...(this.connection.env || {}) } as Record<string, string>,
      });
    }

    this.client = new Client({
      name: 'ai-desktop',
      version: '1.0.0',
    });

    await this.client.connect(transport);

    // 获取服务器信息
    this.serverInfo = {
      name: this.client.getServerVersion()?.name || 'unknown',
      version: this.client.getServerVersion()?.version || '0.0.0',
    };

    logger.info('MCPExternalClient', `${this.connection.name} connected and initialized`);
  }

  /**
   * 初始化MCP服务器连接（SDK 的 connect 已包含初始化握手）
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    // SDK Client.connect() 已经完成了初始化握手
    // 需要列出工具和资源
    await this.listTools();
    await this.listResources();
    logger.info('MCPExternalClient', `${this.connection.name} initialized successfully`);
  }

  /**
   * 列出可用工具
   */
  async listTools(): Promise<MCPTool[]> {
    try {
      const result = await this.client.listTools();
      this.tools = (result.tools || []).map((tool: any) => ({
        name: tool.name,
        description: tool.description || '',
        inputSchema: tool.inputSchema || {},
      }));
      logger.info('MCPExternalClient', `${this.connection.name} has ${this.tools.length} tools`);
      return this.tools;
    } catch (error: any) {
      logger.warn('MCPExternalClient', `Failed to list tools: ${error.message}`);
      this.tools = [];
      return [];
    }
  }

  /**
   * 列出可用资源
   */
  async listResources(): Promise<MCPResource[]> {
    try {
      const result = await this.client.listResources();
      this.resources = (result.resources || []).map((resource: any) => ({
        uri: resource.uri,
        name: resource.name,
        description: resource.description,
        mimeType: resource.mimeType,
      }));
      return this.resources;
    } catch (error: any) {
      logger.warn('MCPExternalClient', `Failed to list resources: ${error.message}`);
      this.resources = [];
      return [];
    }
  }

  /**
   * 调用工具
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.initialized) {
      await this.initialize();
    }

    logger.info('MCPExternalClient', `Calling tool ${name} on ${this.connection.name}`);

    try {
      const result = await this.client.callTool({
        name,
        arguments: args,
      });
      return result.content || result;
    } catch (error: any) {
      logger.error('MCPExternalClient', `Tool call failed: ${error.message}`);
      throw error;
    }
  }

  getServerInfo(): { name: string; version: string } | null {
    return this.serverInfo;
  }

  getTools(): MCPTool[] {
    return this.tools;
  }

  getResources(): MCPResource[] {
    return this.resources;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  isConnected(): boolean {
    try {
      return this.client !== undefined;
    } catch {
      return false;
    }
  }

  getConnectionId(): string {
    return this.connectionId;
  }

  async close(): Promise<void> {
    logger.info('MCPExternalClient', `Closing connection to ${this.connection.name}`);

    try {
      await this.client.close();
    } catch {
      // 忽略关闭错误
    }

    this.initialized = false;
    logger.info('MCPExternalClient', `Connection to ${this.connection.name} closed`);
  }
}
