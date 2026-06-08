import type { MCPService, Content } from '../types/index.js';
import { mcpClientRegistry } from './clientRegistry.js';
import { logger } from '../utils/logger.js';
import { eventBus } from '../services/eventBus.js';
import { runAgentAsync } from '../agents/pi-agent-session.js';

// 内置MCP服务定义
const builtInServices: Record<string, MCPService> = {
  'mcp.agent': {
    name: 'mcp.agent',
    description: 'Agent management service - list, call, and return results from agents',
    methods: ['list', 'call', 'getInfo', 'reply']
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

/**
 * MCP服务注册表
 * 管理和路由所有MCP服务的调用
 * 支持内置服务和自定义服务的注册
 */
class MCPServiceRegistry {
  // 服务映射表
  private services: Map<string, MCPService> = new Map();

  constructor() {
    // 构造函数中注册所有内置服务
    for (const [name, service] of Object.entries(builtInServices)) {
      this.services.set(name, service);
    }
  }

  // 获取指定服务
  getService(name: string): MCPService | undefined {
    return this.services.get(name);
  }

  // 获取所有服务
  getAllServices(): MCPService[] {
    return Array.from(this.services.values());
  }

  // 注册新服务
  registerService(service: MCPService): void {
    this.services.set(service.name, service);
  }

  // 注销服务（内置服务不可注销）
  unregisterService(name: string): boolean {
    if (builtInServices[name]) {
      return false;
    }
    return this.services.delete(name);
  }

  /**
   * 调用服务方法
   * 核心路由方法，根据服务名和方法名分发到具体处理函数
   */
  async callMethod(
    serviceName: string,
    method: string,
    args: Record<string, unknown>,
    context: { appId?: string; userId?: string; convId?: string }
  ): Promise<unknown> {
    const service = this.services.get(serviceName);
    if (!service) {
      throw new Error(`Service ${serviceName} not found`);
    }

    if (!service.methods.includes(method)) {
      throw new Error(`Method ${method} not found on service ${serviceName}`);
    }

    // 根据服务名路由到对应的处理函数
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
      case 'mcp.external':
        return this.handleExternalMethod(method, args, context);
      default:
        throw new Error(`Service ${serviceName} not implemented`);
    }
  }

  private async handleAgentMethod(
    method: string,
    args: Record<string, unknown>,
    context: { appId?: string; convId?: string }
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
        // args: { agentId: string, message: Content[] | string, convId?: string, callerConvId?: string }
        const agentId = args.agentId as string;
        let message = args.message as Content[] | string;
        const convId = args.convId as string | undefined;
        const callerConvId = args.callerConvId as string | undefined;

        if (!agentId) throw new Error('agentId is required');
        if (!message) throw new Error('message is required');

        // 兼容字符串 message → 自动转为 Content[]
        if (typeof message === 'string') {
          message = [{ type: 'text', text: message }];
        }
        if (!Array.isArray(message) || message.length === 0) throw new Error('message is required');
        if (agentId === context.appId) throw new Error('Cannot call yourself');

        const targetApp = appLoader.getApp(agentId);
        if (!targetApp) throw new Error(`Agent ${agentId} not found`);
        if (targetApp.meta.type !== 'desktop' && targetApp.meta.type !== 'background') {
          throw new Error(`Agent ${agentId} is not callable`);
        }
        // 检查是否有返回结果能力
        if (!targetApp.meta.hasReply) {
          throw new Error(`Agent ${agentId} 未实现返回结果工具，无法被调用`);
        }

        // 可见性检查
        if (context.appId) {
          const callerApp = appLoader.getApp(context.appId);
          if (callerApp && callerApp.meta.visibleApps.length > 0 && !callerApp.meta.visibleApps.includes(agentId)) {
            throw new Error(`Agent ${agentId} is not visible`);
          }
        }

        // 获取或创建会话（标记 source=agent + 记录调用链）
        let targetConvId = convId;
        let conversation;
        if (!targetConvId) {
          const callChain = context.appId ? [{ callerAppId: context.appId, callerConvId: callerConvId, timestamp: new Date().toISOString() }] : undefined;
          const newConv = await conversationService.createConversation(agentId, `来自 ${context.appId || '未知'} 的调用`, 'agent', callChain);
          targetConvId = newConv.id;
          conversation = newConv;
        } else {
          conversation = await conversationService.getConversation(agentId, targetConvId);
          if (!conversation) throw new Error(`Conversation ${targetConvId} not found`);
        }

        // 通知前端：agent 调用开始
        eventBus.emit({ type: 'agent_call_start', appId: agentId, convId: targetConvId, data: {
          callerAppId: context.appId,
          callerConvId,
          message: JSON.stringify(message),
          timestamp: new Date().toISOString(),
        }});

        // 保存 user 消息（标记来源为调用方）
        const savedUserMsg = await conversationService.addMessage(agentId, targetConvId, 'user', message);
        if (!savedUserMsg) throw new Error('Failed to save message');

        // 异步处理 agent（不阻塞返回）
        runAgentAsync(agentId, targetConvId, targetApp, conversation.messages, message)
          .catch(err => logger.error('MCPServiceRegistry', `Agent async call error: ${err.message}`));

        return {
          success: true,
          conversationId: targetConvId,
          message: 'Agent 已开始处理，结果将通过 EventBus 推送',
        };
      }

      case 'reply': {
        // 被调 agent 返回结果给调用方
        // args: { result: string, _convId?: string }
        const replyResult = args.result as string;
        const replyConvId = (args._convId as string) || context.convId || '';
        if (!replyResult) throw new Error('result is required');

        // 从当前会话的 callChain 找到调用方
        const currentConv = await conversationService.getConversation(context.appId || '', replyConvId);
        if (!currentConv) throw new Error(`Conversation ${replyConvId} not found`);
        if (!currentConv.callChain || currentConv.callChain.length === 0) {
          throw new Error('No caller found in call chain');
        }

        const callerInfo = currentConv.callChain[currentConv.callChain.length - 1];
        const callerConv = await conversationService.getConversation(callerInfo.callerAppId, callerInfo.callerConvId || '');
        if (!callerConv) throw new Error(`Caller conversation not found`);

        // 将结果保存到被调 agent 的会话
        await conversationService.addMessage(context.appId || '', replyConvId, 'assistant', [{ type: 'text', text: replyResult }]);

        // 将结果推送给调用方会话
        await conversationService.addMessage(callerInfo.callerAppId, callerInfo.callerConvId || '', 'assistant', [{ type: 'text', text: `来自 ${context.appId} 的回复：${replyResult}` }]);

        // 通过 EventBus 通知调用方
        eventBus.emit({ type: 'agent_call_end', appId: callerInfo.callerAppId, convId: callerInfo.callerConvId || '', data: {
          result: replyResult,
          fromAppId: context.appId,
          timestamp: new Date().toISOString(),
        }});
        // 通知被调 agent 会话结束
        eventBus.emit({ type: 'done', appId: context.appId || '', convId: replyConvId, data: { replySent: true } });

        return { success: true };
      }

      case 'requestInput': {
        // args: { prompt: string, inputType: 'text'|'choice'|'confirm'|'file', choices?: string[] }
        const prompt = args.prompt as string;
        const inputType = (args.inputType as string) || 'text';
        const choices = args.choices as string[] | undefined;
        const requestConvId = args.conversationId as string || context.appId;

        if (!prompt) throw new Error('prompt is required');

        const requestId = `input-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        // 更新会话状态为等待输入
        if (context.appId && requestConvId) {
          try {
            const conv = await conversationService.getConversation(context.appId, requestConvId);
            if (conv) {
              (conv as any).pendingUserInput = requestId;
            }
          } catch {}
        }

        eventBus.emit({ type: 'user_input_request', appId: context.appId || '', convId: requestConvId || '', data: {
          requestId,
          prompt,
          inputType,
          choices,
        }});

        return { success: true, requestId, message: '等待用户输入...' };
      }
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }

  private async handleWindowMethod(
    method: string,
    args: Record<string, unknown>,
    context: { appId?: string; convId?: string }
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
    context: { appId?: string; convId?: string }
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
    context: { appId?: string; convId?: string }
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
    context: { appId?: string; convId?: string }
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

  /**
   * 处理外部MCP服务方法
   * 通过MCPClientRegistry转发到外部MCP服务器
   */
  private async handleExternalMethod(
    method: string,
    args: Record<string, unknown>,
    context: { appId?: string; userId?: string }
  ): Promise<unknown> {
    const { connectionId, tool, toolArgs } = args as {
      connectionId: string;
      tool: string;
      toolArgs: Record<string, unknown>;
    };

    if (!connectionId) {
      throw new Error('connectionId is required for external MCP calls');
    }

    if (!tool) {
      throw new Error('tool name is required for external MCP calls');
    }

    logger.info('MCPServiceRegistry', `External MCP call: ${tool} on connection ${connectionId}`);

    try {
      const result = await mcpClientRegistry.callTool(connectionId, tool, toolArgs || {});
      return result;
    } catch (error) {
      logger.error('MCPServiceRegistry', `External MCP call failed: ${(error as Error).message}`);
      throw error;
    }
  }
}

export const mcpServiceRegistry = new MCPServiceRegistry();
