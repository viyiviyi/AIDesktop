import { ChildProcess } from 'child_process';
import { MCPConnection } from '../types/index.js';
import { MCPStdioTransport, StdioTransport } from './stdioTransport.js';
import { MCPSseTransport, SseTransport } from './sseTransport.js';
import { MCPJsonRpcClient } from './jsonRpcClient.js';
import { mcpProcessManager } from './processManager.js';
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

// MCP服务器能力
interface MCPServerCapabilities {
  tools?: Record<string, unknown>;
  resources?: Record<string, unknown>;
  prompts?: Record<string, unknown>;
}

// MCP初始化结果
interface MCPInitializeResult {
  protocolVersion: string;
  capabilities: MCPServerCapabilities;
  serverInfo: {
    name: string;
    version: string;
  };
}

// 工具列表结果
interface MCToolsListResult {
  tools: Array<{
    name: string;
    description?: string;
    inputSchema: object;
  }>;
}

// 资源列表结果
interface MCPResourcesListResult {
  resources: Array<{
    uri: string;
    name: string;
    description?: string;
    mimeType?: string;
  }>;
}

// 工具调用结果
interface MCToolCallResult {
  content: Array<{
    type: string;
    text?: string;
  }>;
  isError?: boolean;
}

/**
 * 外部MCP服务器客户端
 * 连接到外部MCP服务器并与其通信
 */
export class MCPExternalClient {
  private transport!: MCPJsonRpcClient;
  private initialized = false;
  private connectionId: string;
  private serverInfo: { name: string; version: string } | null = null;
  private capabilities: MCPServerCapabilities = {};
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

    if (transportType === 'sse') {
      // SSE 传输：通过 HTTP SSE 连接
      const url = this.connection.url;
      if (!url) throw new Error('SSE transport requires a url');
      logger.info('MCPExternalClient', `Connecting to ${this.connection.name} via SSE: ${url}`);

      const sseTransport = new MCPSseTransport(url, this.connectionId);
      await sseTransport.connect();
      this.transport = new MCPJsonRpcClient(sseTransport as any, this.connectionId);
    } else {
      // Stdio 传输：启动进程并通过 stdin/stdout 通信
      logger.info('MCPExternalClient', `Connecting to ${this.connection.name} via stdio: ${this.connection.command}`);

      await mcpProcessManager.startProcess(
        this.connectionId,
        this.connection.command,
        this.connection.args
      );

      const mcpProcess = mcpProcessManager.getProcess(this.connectionId);
      if (!mcpProcess) {
        throw new Error('Failed to start MCP process');
      }

      const stdioTransport = new MCPStdioTransport(mcpProcess.process, this.connectionId);
      this.transport = new MCPJsonRpcClient(stdioTransport, this.connectionId);
    }
  }

  /**
   * 初始化MCP服务器连接
   * 执行MCP协议握手
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    logger.info('MCPExternalClient', `Initializing ${this.connection.name}`);

    try {
      // 发送初始化请求
      const result = await this.transport.request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
          resources: {},
        },
        clientInfo: {
          name: 'ai-desktop',
          version: '1.0.0',
        },
      }) as MCPInitializeResult;

      this.serverInfo = result.serverInfo;
      this.capabilities = result.capabilities;

      // 发送初始化完成通知
      await this.transport.notify('initialized', {});

      // 获取工具列表
      await this.listTools();

      // 获取资源列表
      await this.listResources();

      this.initialized = true;
      logger.info('MCPExternalClient', `${this.connection.name} initialized successfully`);
    } catch (error) {
      logger.error('MCPExternalClient', `Failed to initialize ${this.connection.name}: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * 列出可用工具
   */
  async listTools(): Promise<MCPTool[]> {
    // 注意：不检查 initialized，因为这个方法只在 initialize 中调用
    try {
      const result = await this.transport.request('tools/list', {}) as MCToolsListResult;
      this.tools = result.tools.map((tool) => ({
        name: tool.name,
        description: tool.description || '',
        inputSchema: tool.inputSchema,
      }));
      logger.info('MCPExternalClient', `${this.connection.name} has ${this.tools.length} tools`);
      return this.tools;
    } catch (error) {
      logger.warn('MCPExternalClient', `Failed to list tools: ${(error as Error).message}`);
      this.tools = [];
      return [];
    }
  }

  /**
   * 列出可用资源
   */
  async listResources(): Promise<MCPResource[]> {
    // 注意：不检查 initialized，因为这个方法只在 initialize 中调用
    try {
      const result = await this.transport.request('resources/list', {}) as MCPResourcesListResult;
      this.resources = result.resources.map((resource) => ({
        uri: resource.uri,
        name: resource.name,
        description: resource.description,
        mimeType: resource.mimeType,
      }));
      logger.info('MCPExternalClient', `${this.connection.name} has ${this.resources.length} resources`);
      return this.resources;
    } catch (error) {
      logger.warn('MCPExternalClient', `Failed to list resources: ${(error as Error).message}`);
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
      const result = await this.transport.request('tools/call', {
        name,
        arguments: args,
      }) as MCToolCallResult;

      return result;
    } catch (error) {
      logger.error('MCPExternalClient', `Tool call failed: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * 读取资源
   */
  async readResource(uri: string): Promise<unknown> {
    if (!this.initialized) {
      await this.initialize();
    }

    logger.info('MCPExternalClient', `Reading resource ${uri} from ${this.connection.name}`);

    try {
      const result = await this.transport.request('resources/read', { uri });
      return result;
    } catch (error) {
      logger.error('MCPExternalClient', `Resource read failed: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * 获取服务器信息
   */
  getServerInfo(): { name: string; version: string } | null {
    return this.serverInfo;
  }

  /**
   * 获取工具列表
   */
  getTools(): MCPTool[] {
    return this.tools;
  }

  /**
   * 获取资源列表
   */
  getResources(): MCPResource[] {
    return this.resources;
  }

  /**
   * 检查是否已初始化
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * 检查是否连接
   */
  isConnected(): boolean {
    return mcpProcessManager.isRunning(this.connectionId);
  }

  /**
   * 获取连接ID
   */
  getConnectionId(): string {
    return this.connectionId;
  }

  /**
   * 关闭连接
   */
  async close(): Promise<void> {
    logger.info('MCPExternalClient', `Closing connection to ${this.connection.name}`);

    try {
      // 尝试发送关闭通知
      if (this.initialized) {
        await this.transport.notify('shutdown', {});
      }
    } catch {
      // 忽略关闭通知的错误
    }

    // 关闭传输层
    this.transport.close();

    // 停止进程
    await mcpProcessManager.stopProcess(this.connectionId);

    this.initialized = false;
    logger.info('MCPExternalClient', `Connection to ${this.connection.name} closed`);
  }
}
