import type { MCPService, Content } from '../types/index.js';

// Built-in MCP services
const builtInServices: Record<string, MCPService> = {
  'mcp.agent': {
    name: 'mcp.agent',
    description: 'Agent management service - list and call agents',
    methods: ['list', 'call', 'getInfo']
  },
  'mcp.window': {
    name: 'mcp.window',
    description: 'Window management service - open, close, list windows',
    methods: ['open', 'close', 'list', 'focus', 'minimize', 'maximize']
  },
  'mcp.filesystem': {
    name: 'mcp.filesystem',
    description: 'File system service - read, write, list files',
    methods: ['read', 'write', 'list', 'mkdir', 'delete']
  },
  'mcp.settings': {
    name: 'mcp.settings',
    description: 'Settings service - get and update desktop settings',
    methods: ['get', 'update']
  },
  'mcp.browser': {
    name: 'mcp.browser',
    description: 'Browser service - navigate, interact with web pages, get content',
    methods: ['navigate', 'getContent', 'interact', 'close', 'listSessions']
  }
};

class MCPServiceRegistry {
  private services: Map<string, MCPService> = new Map();

  constructor() {
    // Register built-in services
    for (const [name, service] of Object.entries(builtInServices)) {
      this.services.set(name, service);
    }
  }

  getService(name: string): MCPService | undefined {
    return this.services.get(name);
  }

  getAllServices(): MCPService[] {
    return Array.from(this.services.values());
  }

  registerService(service: MCPService): void {
    this.services.set(service.name, service);
  }

  unregisterService(name: string): boolean {
    // Cannot unregister built-in services
    if (builtInServices[name]) {
      return false;
    }
    return this.services.delete(name);
  }

  async callMethod(
    serviceName: string,
    method: string,
    args: Record<string, unknown>,
    context: { appId?: string; userId?: string }
  ): Promise<unknown> {
    const service = this.services.get(serviceName);
    if (!service) {
      throw new Error(`Service ${serviceName} not found`);
    }

    if (!service.methods.includes(method)) {
      throw new Error(`Method ${method} not found on service ${serviceName}`);
    }

    // Route to built-in handlers
    switch (serviceName) {
      case 'mcp.agent':
        return this.handleAgentMethod(method, args, context);
      case 'mcp.window':
        return this.handleWindowMethod(method, args, context);
      case 'mcp.filesystem':
        return this.handleFilesystemMethod(method, args, context);
      case 'mcp.settings':
        return this.handleSettingsMethod(method, args, context);
      case 'mcp.browser':
        return this.handleBrowserMethod(method, args, context);
      default:
        throw new Error(`Service ${serviceName} not implemented`);
    }
  }

  private async handleAgentMethod(
    method: string,
    args: Record<string, unknown>,
    context: { appId?: string }
  ): Promise<unknown> {
    const { appLoader } = await import('../services/appLoader.js');
    const { conversationService } = await import('../services/conversation.js');
    const { agentEngine } = await import('../agents/engine.js');

    switch (method) {
      case 'list': {
        // 获取调用者的信息，用于过滤可见的agent列表
        const callerApp = context.appId ? appLoader.getApp(context.appId) : null;
        const visibleApps = callerApp?.meta.visibleApps || [];

        return {
          agents: appLoader.getAllApps()
            .filter(a => {
              // 过滤掉自己
              if (a.meta.id === context.appId) return false;
              // 只返回 desktop 和 background 类型的应用
              if (a.meta.type !== 'desktop' && a.meta.type !== 'background') return false;
              // 如果调用者配置了 visibleApps，则只返回在列表中的
              if (visibleApps.length > 0 && !visibleApps.includes(a.meta.id)) return false;
              return true;
            })
            .map(a => ({
              id: a.meta.id,
              name: a.meta.name,
              description: a.meta.description,
              type: a.meta.type,
              icon: a.meta.icon,
              supportedInputs: a.meta.supportedInputs
            }))
        };
      }
      case 'getInfo': {
        const app = appLoader.getApp(args.id as string);
        if (!app) {
          return { error: 'Agent not found' };
        }
        return {
          id: app.meta.id,
          name: app.meta.name,
          description: app.meta.description,
          type: app.meta.type,
          icon: app.meta.icon,
          supportedInputs: app.meta.supportedInputs,
          tools: app.meta.tools
        };
      }
      case 'call': {
        // args: { agentId: string, message: Content[], convId?: string }
        const agentId = args.agentId as string;
        const message = args.message as Content[];
        const convId = args.convId as string | undefined;

        if (!agentId) {
          throw new Error('agentId is required');
        }
        if (!message || !Array.isArray(message) || message.length === 0) {
          throw new Error('message is required and must be a non-empty array');
        }

        // 不能调用自己
        if (agentId === context.appId) {
          throw new Error('Cannot call yourself');
        }

        // Validate target agent exists
        const targetApp = appLoader.getApp(agentId);
        if (!targetApp) {
          throw new Error(`Agent ${agentId} not found`);
        }
        if (targetApp.meta.type !== 'desktop' && targetApp.meta.type !== 'background') {
          throw new Error(`Agent ${agentId} is not a callable agent`);
        }

        // 检查可见性：调用者的 visibleApps 控制可以调用哪些 agent
        if (context.appId) {
          const callerApp = appLoader.getApp(context.appId);
          if (callerApp && callerApp.meta.visibleApps.length > 0) {
            if (!callerApp.meta.visibleApps.includes(agentId)) {
              throw new Error(`Agent ${agentId} is not visible to ${context.appId}`);
            }
          }
        }

        // Get or create conversation
        let targetConvId = convId;
        if (!targetConvId) {
          // Create new conversation for target agent
          const conversations = await conversationService.getConversations(agentId);
          if (conversations.length > 0) {
            // Use most recent conversation
            targetConvId = conversations[conversations.length - 1].id;
          } else {
            const newConv = await conversationService.createConversation(agentId, '新会话');
            targetConvId = newConv.id;
          }
        }

        // Validate conversation exists
        const conversation = await conversationService.getConversation(agentId, targetConvId);
        if (!conversation) {
          throw new Error(`Conversation ${targetConvId} not found`);
        }

        // Add user message to target conversation
        await conversationService.addMessage(agentId, targetConvId, 'user', message);

        // Process message with target agent
        const { assistantMessage } = await agentEngine.processMessage(agentId, targetConvId, message);

        return {
          success: true,
          conversationId: targetConvId,
          message: assistantMessage
        };
      }
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }

  private async handleWindowMethod(
    method: string,
    args: Record<string, unknown>,
    context: { appId?: string }
  ): Promise<unknown> {
    // Window management is primarily client-side
    // Server just validates the request
    switch (method) {
      case 'list':
        // This would need to be extended with actual window state
        return { windows: [] };
      case 'open':
      case 'close':
      case 'focus':
      case 'minimize':
      case 'maximize':
        return { success: true };
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }

  private async handleFilesystemMethod(
    method: string,
    args: Record<string, unknown>,
    context: { appId?: string }
  ): Promise<unknown> {
    const fs = await import('fs/promises');
    const path = await import('path');
    const { DATA_DIR } = await import('../utils/file.js');

    const basePath = args.basePath as string || '';
    const fullPath = path.join(DATA_DIR, basePath, args.path as string || '');

    switch (method) {
      case 'read':
        try {
          const content = await fs.readFile(fullPath, 'utf-8');
          return { content };
        } catch {
          throw new Error(`Failed to read file: ${args.path}`);
        }
      case 'write':
        try {
          await fs.writeFile(fullPath, args.content as string, 'utf-8');
          return { success: true };
        } catch {
          throw new Error(`Failed to write file: ${args.path}`);
        }
      case 'list':
        try {
          const entries = await fs.readdir(fullPath, { withFileTypes: true });
          return {
            entries: entries.map(e => ({
              name: e.name,
              isDirectory: e.isDirectory(),
              isFile: e.isFile()
            }))
          };
        } catch {
          throw new Error(`Failed to list directory: ${args.path}`);
        }
      case 'mkdir':
        try {
          await fs.mkdir(fullPath, { recursive: true });
          return { success: true };
        } catch {
          throw new Error(`Failed to create directory: ${args.path}`);
        }
      case 'delete':
        try {
          await fs.rm(fullPath, { recursive: true });
          return { success: true };
        } catch {
          throw new Error(`Failed to delete: ${args.path}`);
        }
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }

  private async handleSettingsMethod(
    method: string,
    args: Record<string, unknown>,
    context: { appId?: string }
  ): Promise<unknown> {
    const { settingsService } = await import('../services/settings.js');

    switch (method) {
      case 'get':
        return settingsService.getSettings();
      case 'update':
        return settingsService.updateSettings(args as Record<string, unknown>);
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }

  private async handleBrowserMethod(
    method: string,
    args: Record<string, unknown>,
    context: { appId?: string }
  ): Promise<unknown> {
    const { browserManager } = await import('./browser/manager.js');

    switch (method) {
      case 'navigate': {
        // args: { url: string, tabId?: string, timeout?: number }
        const url = args.url as string;
        const tabId = (args.tabId as string) || 'default';
        const timeout = (args.timeout as number) || 30;

        if (!url) {
          throw new Error('url is required');
        }

        // 验证 URL 格式
        try {
          new URL(url);
        } catch {
          throw new Error(`Invalid URL format: ${url}`);
        }

        const result = await browserManager.navigateTo(tabId, url, timeout * 1000);
        return {
          success: true,
          tabId,
          pageInfo: {
            title: result.title,
            url: result.url
          },
          message: `已导航到 ${url}`
        };
      }

      case 'getContent': {
        // args: { tabId?: string, contentType?: 'dom' | 'accessibility' | 'screenshot' }
        const tabId = (args.tabId as string) || 'default';
        const contentType = (args.contentType as 'dom' | 'accessibility' | 'screenshot') || 'accessibility';

        const result = await browserManager.getPageContent(tabId, contentType);

        // 关键：返回页面内容，但通过调用者确保不在上下文中保留历史
        return {
          success: true,
          tabId,
          pageInfo: {
            title: result.title,
            url: result.url
          },
          content: result.content,
          contentType,
          // 重要提示：当前页面内容会替换之前的上下文
          // 调用者应该及时提取并记录需要的信息
          _hint: 'Only the latest page content is visible in context. Extract important information immediately.'
        };
      }

      case 'interact': {
        // args: { tabId?: string, action: string, selector?: string, text?: string, key?: string, value?: string }
        const tabId = (args.tabId as string) || 'default';
        const action = args.action as 'click' | 'fill' | 'press' | 'hover' | 'select' | 'check' | 'uncheck' | 'goBack' | 'goForward' | 'reload';
        const selector = args.selector as string | undefined;
        const text = args.text as string | undefined;
        const key = args.key as string | undefined;
        const value = args.value as string | undefined;

        if (!action) {
          throw new Error('action is required');
        }

        const result = await browserManager.interact(tabId, action, { selector, text, key, value });
        return {
          success: result.success,
          tabId,
          action,
          message: result.message
        };
      }

      case 'close': {
        // args: { tabId?: string }
        const tabId = (args.tabId as string) || 'default';

        const closed = await browserManager.closeSession(tabId);
        return {
          success: closed,
          tabId,
          message: closed ? `已关闭浏览器会话: ${tabId}` : `会话 ${tabId} 不存在`
        };
      }

      case 'listSessions': {
        const sessions = browserManager.listSessions();
        return {
          sessions: sessions.map(s => ({
            id: s.id,
            url: s.url,
            title: s.title,
            createdAt: s.createdAt.toISOString()
          })),
          count: sessions.length
        };
      }

      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }
}

export const mcpServiceRegistry = new MCPServiceRegistry();
