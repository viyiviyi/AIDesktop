import { MCPConnection } from '../types/index.js';
import { MCPExternalClient, MCPTool, MCPResource } from './externalClient.js';
import { logger } from '../utils/logger.js';
import { settingsService } from '../services/settings.js';

/**
 * MCP客户端注册表
 * 管理所有外部MCP服务器客户端连接
 */
class MCPClientRegistry {
  private clients: Map<string, MCPExternalClient> = new Map();
  private initialized = false;

  /**
   * 从配置初始化所有MCP连接
   * 在服务器启动时调用
   */
  async initializeFromConfig(): Promise<void> {
    if (this.initialized) {
      logger.warn('MCPClientRegistry', 'Already initialized');
      return;
    }

    logger.info('MCPClientRegistry', 'Initializing MCP clients from config...');

    try {
      const mcp = await settingsService.getMcp();
      const connections = mcp.connections.filter((c) => c.enabled);

      for (const connection of connections) {
        try {
          await this.getOrCreateClient(connection);
          logger.info('MCPClientRegistry', `Connected to ${connection.name}`);
        } catch (error) {
          logger.error('MCPClientRegistry', `Failed to connect to ${connection.name}: ${(error as Error).message}`);
        }
      }

      this.initialized = true;
      logger.info('MCPClientRegistry', `Initialized ${connections.length} MCP clients`);
    } catch (error) {
      logger.error('MCPClientRegistry', `Failed to initialize MCP clients: ${(error as Error).message}`);
    }
  }

  /**
   * 获取或创建客户端
   */
  async getOrCreateClient(connection: MCPConnection): Promise<MCPExternalClient> {
    const existingClient = this.clients.get(connection.id);
    if (existingClient) {
      if (existingClient.isConnected()) {
        return existingClient;
      }
      // 如果连接断开，移除旧客户端
      this.clients.delete(connection.id);
    }

    logger.info('MCPClientRegistry', `Creating new client for ${connection.name}`);

    // 创建新客户端
    const client = new MCPExternalClient(connection);

    // 连接并初始化
    await client.connect();
    await client.initialize();

    // 注册客户端
    this.clients.set(connection.id, client);

    logger.info('MCPClientRegistry', `Client for ${connection.name} registered successfully`);
    return client;
  }

  /**
   * 获取客户端
   */
  getClient(connectionId: string): MCPExternalClient | undefined {
    return this.clients.get(connectionId);
  }

  /**
   * 获取所有客户端
   */
  listClients(): MCPExternalClient[] {
    return Array.from(this.clients.values());
  }

  /**
   * 获取已连接的客户端
   */
  getConnectedClients(): MCPExternalClient[] {
    return this.listClients().filter((client) => client.isConnected());
  }

  /**
   * 移除客户端
   */
  async removeClient(connectionId: string): Promise<void> {
    const client = this.clients.get(connectionId);
    if (client) {
      logger.info('MCPClientRegistry', `Removing client ${connectionId}`);
      await client.close();
      this.clients.delete(connectionId);
    }
  }

  /**
   * 调用工具
   */
  async callTool(
    connectionId: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const client = this.clients.get(connectionId);
    if (!client) {
      throw new Error(`MCP client ${connectionId} not found`);
    }
    if (!client.isConnected()) {
      throw new Error(`MCP client ${connectionId} is not connected`);
    }
    return client.callTool(toolName, args);
  }

  /**
   * 获取客户端工具列表
   */
  async listTools(connectionId: string): Promise<MCPTool[]> {
    const client = this.clients.get(connectionId);
    if (!client) {
      throw new Error(`MCP client ${connectionId} not found`);
    }
    return client.getTools();
  }

  /**
   * 获取客户端资源列表
   */
  async listResources(connectionId: string): Promise<MCPResource[]> {
    const client = this.clients.get(connectionId);
    if (!client) {
      throw new Error(`MCP client ${connectionId} not found`);
    }
    return client.getResources();
  }

  /**
   * 获取所有客户端的汇总工具列表
   */
  async listAllTools(): Promise<Array<{ connectionId: string; connectionName: string; tools: MCPTool[] }>> {
    const result: Array<{ connectionId: string; connectionName: string; tools: MCPTool[] }> = [];

    for (const client of this.clients.values()) {
      if (client.isConnected()) {
        result.push({
          connectionId: client.getConnectionId(),
          connectionName: client.getServerInfo()?.name || 'Unknown',
          tools: client.getTools(),
        });
      }
    }

    return result;
  }

  /**
   * 移除所有客户端
   */
  async removeAll(): Promise<void> {
    logger.info('MCPClientRegistry', 'Removing all clients');
    const connectionIds = Array.from(this.clients.keys());
    await Promise.all(connectionIds.map((id) => this.removeClient(id)));
  }
}

export const mcpClientRegistry = new MCPClientRegistry();
