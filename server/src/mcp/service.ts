import type { MCPService, Content } from '../types/index.js';
import type { FormSchema } from '../types/index.js';
import { mcpClientRegistry } from './clientRegistry.js';
import { logger } from '../utils/logger.js';
import { eventBus } from '../services/eventBus.js';
import { runAgentAsync } from '../agents/pi-agent-session.js';
import { v4 as uuidv4 } from 'uuid';
import * as os from 'os';

// 内置MCP服务定义
const builtInServices: Record<string, MCPService> = {
  // ===== 内置管理工具（admin）=====
  'mcp.window': {
    name: 'mcp.window',
    description: '窗口管理服务 - 打开、关闭、列出、聚焦、最小化、最大化窗口',
    methods: ['open', 'close', 'list', 'focus', 'minimize', 'maximize'],
    category: 'admin',
  },
  'mcp.filesystem': {
    name: 'mcp.filesystem',
    description: '文件系统服务 - 读取、写入、列出、创建目录、删除文件',
    methods: ['read', 'write', 'list', 'mkdir', 'delete'],
    category: 'admin',
  },
  'mcp.settings': {
    name: 'mcp.settings',
    description: '系统设置服务 - 获取和更新桌面设置（主题、字体、背景等）',
    methods: ['get', 'update'],
    category: 'admin',
  },

  // ===== 内置通用工具（builtin）=====
  'mcp.agent': {
    name: 'mcp.agent',
    description: 'Agent 管理服务 - 列出、调用、获取其他 Agent 的信息',
    methods: ['list', 'call', 'getInfo'],
    category: 'builtin',
  },
  'mcp.sleep': {
    name: 'mcp.sleep',
    description: '等待一段时间 - 暂停执行指定秒数（最长 600 秒/10 分钟）',
    methods: ['sleep'],
    category: 'builtin',
  },
  'mcp.exec': {
    name: 'mcp.exec',
    description: `执行 shell 命令 - 运行一条命令并返回输出。当前系统: ${os.platform()} ${os.release()}`,
    methods: ['exec'],
    category: 'builtin',
  },
  'mcp.http': {
    name: 'mcp.http',
    description: 'HTTP 请求 - 发送 HTTP 请求，完全控制 URL、方法、请求头和请求体',
    methods: ['request'],
    category: 'builtin',
  },
  'mcp.browser': {
    name: 'mcp.browser',
    description: '浏览器控制 - 导航、点击、输入、截图、执行 JS',
    methods: ['navigate', 'snapshot', 'click', 'type', 'scroll', 'back', 'vision', 'console', 'press'],
    category: 'builtin',
  },
  'mcp.form': {
    name: 'mcp.form',
    description: '表单交互 - 向用户展示结构化输入表单，收集用户填写的数据后返回',
    methods: ['requestInput'],
    category: 'builtin',
  },
  'mcp.code': {
    name: 'mcp.code',
    description: '代码与文档编辑 - 读取、写入、替换、搜索、列出文件（路径相对于应用数据目录）',
    methods: ['read', 'write', 'patch', 'search', 'list'],
    category: 'admin',
  },

  // ===== 工作工具（workspace）=====
  'workspace.code': {
    name: 'workspace.code',
    description: '工作区文件编辑 - 读取、写入、替换、搜索、列出文件（路径相对于会话工作目录，支持绝对路径）',
    methods: ['read', 'write', 'patch', 'search', 'list'],
    category: 'workspace',
  },
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
      case 'mcp.sleep':
        return this.handleSleepMethod(method, args, context);
      case 'mcp.exec':
        return this.handleExecMethod(method, args, context);
      case 'mcp.http':
        return this.handleHttpMethod(method, args, context);
      case 'mcp.browser':
        return this.handleBrowserMethod(method, args, context);
      case 'mcp.form':
        return this.handleFormMethod(method, args, context);
      case 'mcp.code':
        return this.handleCodeMethod(method, args, context);
      case 'workspace.code':
        return this.handleWorkspaceCodeMethod(method, args, context);
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
        const visibleApps = [...new Set([
          ...(callerApp?.config.visibleApps || []),
          ...(callerApp?.meta.visibleApps || [])
        ])];

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
          supportedInputs: (app.config.supportedInputs || app.meta.supportedInputs),
          tools: (app.config.tools || app.meta.tools)
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
        // 可见性检查
        if (context.appId) {
          const callerApp = appLoader.getApp(context.appId);
          const callerVisibleApps = [...new Set([
            ...(callerApp?.config.visibleApps || []),
            ...(callerApp?.meta.visibleApps || [])
          ])];
          if (callerVisibleApps.length > 0 && !callerVisibleApps.includes(agentId)) {
            throw new Error(`Agent ${agentId} is not visible`);
          }
        }

        // 获取或创建会话（标记 source=agent + 记录调用链）
        let targetConvId = convId;
        let conversation;
        const callId = uuidv4();
        if (!targetConvId) {
          const callChain = context.appId ? [{ callerAppId: context.appId, callerConvId: callerConvId, callId, timestamp: new Date().toISOString() }] : undefined;
          // 继承调用者的工作目录
          let workspaceDir: string | undefined;
          if (context.appId && callerConvId) {
            const callerConv = await conversationService.getConversation(context.appId, callerConvId);
            workspaceDir = callerConv?.workspaceDir || undefined;
          }
          const newConv = await conversationService.createConversation(agentId, `来自 ${context.appId || '未知'} 的调用`, 'agent', callChain);
          if (workspaceDir) {
            await conversationService.updateConversation(agentId, newConv.id, { workspaceDir } as any);
            newConv.workspaceDir = workspaceDir;
          }
          targetConvId = newConv.id;
          conversation = newConv;
        } else {
          conversation = await conversationService.getConversation(agentId, targetConvId);
          if (!conversation) throw new Error(`Conversation ${targetConvId} not found`);
          // 追加调用链
          if (context.appId) {
            const callChainEntry = { callerAppId: context.appId, callerConvId: callerConvId, callId, timestamp: new Date().toISOString() };
            conversation.callChain = [...(conversation.callChain || []), callChainEntry];
            await conversationService.updateConversation(agentId, targetConvId, { callChain: conversation.callChain } as any);
          }
        }

        // 通知前端：agent 调用开始
        eventBus.emit({ type: 'agent_call_start', appId: agentId, convId: targetConvId, data: {
          callerAppId: context.appId,
          callerConvId,
          callId,
          message: JSON.stringify(message),
          timestamp: new Date().toISOString(),
        }});

        // 保存 user 消息（标记来源为调用方）
        const savedUserMsg = await conversationService.addMessage(agentId, targetConvId, 'user', message);
        if (!savedUserMsg) throw new Error('Failed to save message');

        // 等待被调 agent 完成并返回最终结果
        const callResult = await new Promise<string>((resolve, reject) => {
          const timeout = setTimeout(() => {
            unsubAgentEnd();
            unsubAgentError();
            reject(new Error('Agent call timed out'));
          }, 120000); // 2 分钟超时

          const unsubAgentEnd = eventBus.subscribe(targetConvId, (event) => {
            if (event.type === 'agent_call_end_auto' && event.data.callId === callId) {
              clearTimeout(timeout);
              unsubAgentEnd();
              unsubAgentError();
              resolve(event.data.result as string || '(no output)');
            }
          });

          const unsubAgentError = eventBus.subscribe(targetConvId, (event) => {
            if (event.type === 'error') {
              clearTimeout(timeout);
              unsubAgentEnd();
              unsubAgentError();
              reject(new Error((event.data.message as string) || 'Agent error'));
            }
          });

          // 异步处理 agent
          runAgentAsync(agentId, targetConvId, targetApp, conversation.messages, message)
            .catch(err => {
              clearTimeout(timeout);
              unsubAgentEnd();
              unsubAgentError();
              reject(err);
            });
        });

        return {
          success: true,
          result: callResult,
          conversationId: targetConvId,
        };
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

  private async handleSleepMethod(
    method: string,
    args: Record<string, unknown>,
    context: { appId?: string; convId?: string }
  ): Promise<unknown> {
    switch (method) {
      case 'sleep': {
        const seconds = args.seconds as number || 0;
        const clamped = Math.max(1, Math.min(600, seconds));
        await new Promise(resolve => setTimeout(resolve, clamped * 1000));
        return { success: true, slept: clamped, unit: 'seconds' };
      }
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }

  private async handleExecMethod(
    method: string,
    args: Record<string, unknown>,
    context: { appId?: string; convId?: string }
  ): Promise<unknown> {
    switch (method) {
      case 'exec': {
        const command = args.command as string;
        if (!command) throw new Error('command is required');
        const { execSync } = await import('child_process');
        const timeout = (args.timeout as number) || 30000;
        try {
          const output = execSync(command, {
            timeout,
            encoding: 'utf-8',
            maxBuffer: 10 * 1024 * 1024,
            windowsHide: true,
          });
          return { success: true, output, exitCode: 0 };
        } catch (error: any) {
          return {
            success: false,
            output: error.stdout || '',
            stderr: error.stderr || '',
            exitCode: error.status ?? -1,
            error: error.message,
          };
        }
      }
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }

  private async handleHttpMethod(
    method: string,
    args: Record<string, unknown>,
    context: { appId?: string; convId?: string }
  ): Promise<unknown> {
    switch (method) {
      case 'request': {
        const url = args.url as string;
        if (!url) throw new Error('url is required');

        const fetchArgs: RequestInit = {
          method: (args.method as string) || 'GET',
          headers: (args.headers as Record<string, string>) || {},
        };
        if (args.body) {
          fetchArgs.body = typeof args.body === 'string' ? args.body : JSON.stringify(args.body);
        }
        const timeout = (args.timeout as number) || 30000;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        try {
          const response = await fetch(url, { ...fetchArgs, signal: controller.signal });
          const contentType = response.headers.get('content-type') || '';
          let body: unknown;
          if (contentType.includes('application/json')) {
            body = await response.json();
          } else {
            body = await response.text();
          }
          return {
            success: true,
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            body,
          };
        } finally {
          clearTimeout(timer);
        }
      }
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

  private async handleFormMethod(
    method: string,
    args: Record<string, unknown>,
    context: { appId?: string; convId?: string }
  ): Promise<unknown> {
    switch (method) {
      case 'requestInput': {
        const title = args.title as string;
        const description = args.description as string | undefined;
        const fields = args.fields as Array<Record<string, unknown>> | undefined;

        if (!title) throw new Error('title is required');
        if (!fields || !Array.isArray(fields) || fields.length === 0) throw new Error('fields is required');

        const schema: FormSchema = {
          title,
          description,
          fields: fields.map(f => ({
            name: f.name as string,
            label: f.label as string,
            type: (f.type as any) || 'text',
            required: f.required as boolean | undefined,
            options: f.options as string[] | undefined,
            placeholder: f.placeholder as string | undefined,
            accept: f.accept as string | undefined,
            description: f.description as string | undefined,
          })),
        };

        const formId = `form-${uuidv4()}`;
        const formInfo = {
          formId,
          toolCallId: args._toolCallId as string || '',
          schema,
          createdAt: new Date().toISOString(),
        };

        // 如果提供了 appId/convId，推送 form_request 事件给前端
        if (context.appId && context.convId) {
          eventBus.emit({
            type: 'form_request',
            appId: context.appId,
            convId: context.convId,
            data: { formId, schema, conversationId: context.convId, appId: context.appId, createdAt: formInfo.createdAt },
          });
        }

        return {
          status: 'pending',
          formId,
          message: `表单"${title}"已发送给用户，等待用户填写...`,
        };
      }
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }

  private async handleCodeMethod(
    method: string,
    args: Record<string, unknown>,
    context: { appId?: string; convId?: string }
  ): Promise<unknown> {
    const fs = await import('fs/promises');
    const path = await import('path');
    const { APPS_DATA_DIR } = await import('../utils/file.js');

    // 路径安全：限制在 apps_data 目录下
    const baseDir = args.baseDir as string || '';
    const filePath = args.path as string || '';
    const fullDir = path.join(APPS_DATA_DIR, baseDir);
    const fullPath = path.join(APPS_DATA_DIR, baseDir, filePath);

    // 安全检查：防止路径穿越
    if (path.relative(APPS_DATA_DIR, fullPath).startsWith('..') || path.relative(APPS_DATA_DIR, fullDir).startsWith('..')) {
      throw new Error('Path traversal denied');
    }

    switch (method) {
      case 'read': {
        if (!filePath) throw new Error('path is required');
        try {
          const content = await fs.readFile(fullPath, 'utf-8');
          const stat = await fs.stat(fullPath);
          return { content, size: stat.size, path: filePath };
        } catch (err: any) {
          throw new Error(`Failed to read file: ${err.message}`);
        }
      }

      case 'write': {
        if (!filePath) throw new Error('path is required');
        const content = args.content as string;
        if (content === undefined) throw new Error('content is required');
        try {
          await fs.mkdir(path.dirname(fullPath), { recursive: true });
          await fs.writeFile(fullPath, content, 'utf-8');
          return { success: true, path: filePath };
        } catch (err: any) {
          throw new Error(`Failed to write file: ${err.message}`);
        }
      }

      case 'patch': {
        if (!filePath) throw new Error('path is required');
        const oldStr = args.old_string as string;
        const newStr = args.new_string as string;
        if (!oldStr) throw new Error('old_string is required');
        if (newStr === undefined) throw new Error('new_string is required');
        const replaceAll = !!args.replace_all;
        try {
          let content = await fs.readFile(fullPath, 'utf-8');
          const occurrences = content.split(oldStr).length - 1;
          if (occurrences === 0) throw new Error(`String not found in file`);
          if (occurrences > 1 && !replaceAll) throw new Error(`Found ${occurrences} occurrences; use replace_all=true to replace all`);
          content = replaceAll ? content.replaceAll(oldStr, newStr) : content.replace(oldStr, newStr);
          await fs.writeFile(fullPath, content, 'utf-8');
          return { success: true, path: filePath, replacements: occurrences > 1 ? occurrences : 1 };
        } catch (err: any) {
          if (err.message.startsWith('String not found') || err.message.startsWith('Found')) throw err;
          throw new Error(`Failed to patch file: ${err.message}`);
        }
      }

      case 'search': {
        const pattern = args.pattern as string;
        if (!pattern) throw new Error('pattern is required');
        const fileGlob = args.file_glob as string | undefined;
        const maxResults = (args.max_results as number) || 50;
        try {
          // 用 ripgrep 搜索文件内容
          const { execSync } = await import('child_process');
          let cmd = `rg -n --no-heading -m 5 '${pattern.replace(/'/g, "'\\''")}'`;
          if (fileGlob) cmd += ` -g '${fileGlob.replace(/'/g, "'\\''")}'`;
          cmd += ` '${fullDir.replace(/'/g, "'\\''")}' 2>/dev/null | head -${maxResults}`;
          const output = execSync(cmd, { encoding: 'utf-8', maxBuffer: 1024 * 1024 });
          const lines = output.trim().split('\n').filter(Boolean);
          const results = lines.map(line => {
            const sepIdx = line.indexOf(':');
            const lineSep = line.indexOf(':', sepIdx + 1);
            return {
              file: line.slice(0, sepIdx),
              line: parseInt(line.slice(sepIdx + 1, lineSep), 10) || 0,
              content: line.slice(lineSep + 1),
            };
          });
          return { results, total: results.length, path: baseDir || '.' };
        } catch {
          return { results: [], total: 0, path: baseDir || '.' };
        }
      }

      case 'list': {
        const dirPath = filePath || '.';
        try {
          const entries = await fs.readdir(fullPath, { withFileTypes: true });
          const items = await Promise.all(entries.map(async e => {
            const stat = e.isFile() ? await fs.stat(path.join(fullPath, e.name)).catch(() => null) : null;
            return {
              name: e.name,
              type: e.isDirectory() ? 'directory' : 'file',
              size: stat?.size || 0,
              modified: stat?.mtime?.toISOString() || '',
            };
          }));
          return { items, path: dirPath };
        } catch (err: any) {
          throw new Error(`Failed to list directory: ${err.message}`);
        }
      }

      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }

  private async handleWorkspaceCodeMethod(
    method: string,
    args: Record<string, unknown>,
    context: { appId?: string; convId?: string }
  ): Promise<unknown> {
    // 获取会话工作目录
    const { conversationService } = await import('../services/conversation.js');
    const conv = context.appId && context.convId ? await conversationService.getConversation(context.appId, context.convId) : null;
    let workspaceDirVal = conv?.workspaceDir;
    if (!workspaceDirVal) {
      // 无工作目录——直接在工具内部触发授权流程
      // 与 mcp.form 类似，但这是完全阻塞的：授权不通过就不继续
      if (!context.appId || !context.convId) {
        throw new Error('Workspace directory not set and no conversation context available to prompt the user.');
      }
      const { eventBus } = await import('../services/eventBus.js');

      // 发送授权请求到前端
      const toolCallId = args._toolCallId as string || 'direct';
      const displayPath = (args.baseDir as string) || (args.path as string) || '';
      eventBus.emit({
        type: 'workspace_request',
        appId: context.appId,
        convId: context.convId,
        data: { toolCallId, requestedPath: displayPath },
      });

      // 阻塞等待用户授权或取消
      const response = await new Promise<{ type: 'workspace_response' | 'workspace_cancelled'; data: any }>((resolve) => {
        const unsub = eventBus.subscribe(context.convId || '', (event) => {
          if (event.type === 'workspace_response' || event.type === 'workspace_cancelled') {
            if (event.data?.toolCallId && event.data.toolCallId !== toolCallId) return;
            unsub();
            resolve({ type: event.type, data: event.data });
          }
        });
        setTimeout(() => { unsub(); resolve({ type: 'workspace_cancelled' as any, data: { reason: '超时' } }); }, 300000);
      });

      if (response.type === 'workspace_cancelled') {
        throw new Error('用户拒绝了工作目录授权，操作已取消');
      }

      const chosenPath = response.data?.path as string;
      if (!chosenPath) throw new Error('未提供目录路径');

      // 验证并保存工作目录
      const fs = await import('fs');
      const p = await import('path');
      const absDir = p.resolve(chosenPath);
      if (!fs.existsSync(absDir)) throw new Error(`目录不存在: ${absDir}`);
      if (!fs.statSync(absDir).isDirectory()) throw new Error(`不是目录: ${absDir}`);
      await conversationService.updateConversation(context.appId, context.convId, { workspaceDir: absDir } as any);
      workspaceDirVal = absDir;
    }

    // 将所有路径参数解析为相对于工作目录的绝对路径
    const path = await import('path');
    const fs = await import('fs/promises');
    const filePath = args.path as string || '';
    // 如果 filePath 是绝对路径，直接用
    let targetPath = filePath;
    if (path.isAbsolute(targetPath)) {
      // 绝对路径，直接用
    } else {
      // 相对路径，拼接工作目录
      const testPath = path.join(workspaceDirVal, targetPath);
      // 检查拼接后的路径是否真实存在
      try {
        await fs.access(testPath);
      } catch {
        // 路径不存在，可能是授权前后路径含义变化了
        // 此时用工作目录自身代替
        targetPath = '.';
      }
    }
    const fullPath = path.isAbsolute(targetPath) ? targetPath : path.join(workspaceDirVal, targetPath);

    // 安全检查
    if (path.relative(workspaceDirVal, fullPath).startsWith('..')) {
      throw new Error('Path traversal denied: path must be within workspace directory');
    }

    switch (method) {
      case 'read': {
        if (!filePath) throw new Error('path is required');
        const content = await fs.readFile(fullPath, 'utf-8');
        const stat = await fs.stat(fullPath);
        return { content, size: stat.size, path: filePath };
      }
      case 'write': {
        if (!filePath) throw new Error('path is required');
        const content = args.content as string;
        if (content === undefined) throw new Error('content is required');
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, content, 'utf-8');
        return { success: true, path: filePath };
      }
      case 'patch': {
        if (!filePath) throw new Error('path is required');
        const oldStr = args.old_string as string;
        const newStr = args.new_string as string;
        if (!oldStr) throw new Error('old_string is required');
        const replaceAll = !!args.replace_all;
        let content = await fs.readFile(fullPath, 'utf-8');
        const occurrences = content.split(oldStr).length - 1;
        if (occurrences === 0) throw new Error('String not found in file');
        if (occurrences > 1 && !replaceAll) throw new Error(`Found ${occurrences} occurrences; use replace_all=true to replace all`);
        content = replaceAll ? content.replaceAll(oldStr, newStr) : content.replace(oldStr, newStr);
        await fs.writeFile(fullPath, content, 'utf-8');
        return { success: true, path: filePath, replacements: occurrences > 1 ? occurrences : 1 };
      }
      case 'search': {
        const pattern = args.pattern as string;
        if (!pattern) throw new Error('pattern is required');
        const fileGlob = args.file_glob as string | undefined;
        const maxResults = (args.max_results as number) || 50;
        const { execSync } = await import('child_process');
        let cmd = `rg -n --no-heading -m 5 '${pattern.replace(/'/g, "'\\''")}'`;
        if (fileGlob) cmd += ` -g '${fileGlob.replace(/'/g, "'\\''")}'`;
        cmd += ` '${workspaceDirVal!.replace(/'/g, "'\\''")}' 2>/dev/null | head -${maxResults}`;
        try {
          const output = execSync(cmd, { encoding: 'utf-8', maxBuffer: 1024 * 1024 });
          const lines = output.trim().split('\n').filter(Boolean);
          const results = lines.map(line => {
            const sepIdx = line.indexOf(':');
            const lineSep = line.indexOf(':', sepIdx + 1);
            return { file: line.slice(0, sepIdx), line: parseInt(line.slice(sepIdx + 1, lineSep), 10) || 0, content: line.slice(lineSep + 1) };
          });
          return { results, total: results.length, workspaceDir: workspaceDirVal };
        } catch { return { results: [], total: 0, workspaceDir: workspaceDirVal }; }
      }
      case 'list': {
        const dirPath = filePath || '.';
        const entries = await fs.readdir(fullPath, { withFileTypes: true });
        const items = await Promise.all(entries.map(async e => {
          const stat = e.isFile() ? await fs.stat(path.join(fullPath, e.name)).catch(() => null) : null;
          return { name: e.name, type: e.isDirectory() ? 'directory' : 'file', size: stat?.size || 0, modified: stat?.mtime?.toISOString() || '' };
        }));
        return { items, path: dirPath, workspaceDir: workspaceDirVal };
      }
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }

  private async handleWorkspaceFormMethod(
    method: string,
    args: Record<string, unknown>,
    context: { appId?: string; convId?: string }
  ): Promise<unknown> {
    // workspace.form 复用 mcp.form 的逻辑，但检查工作目录
    const { conversationService } = await import('../services/conversation.js');
    const conv = context.appId && context.convId ? await conversationService.getConversation(context.appId, context.convId) : null;
    if (conv && !conv.workspaceDir) {
      throw new Error('Workspace directory not set. Use workspace.dir.set first.');
    }
    return this.handleFormMethod(method, args, context);
  }

  private async handleWorkspaceDirMethod(
    method: string,
    args: Record<string, unknown>,
    context: { appId?: string; convId?: string }
  ): Promise<unknown> {
    const { conversationService } = await import('../services/conversation.js');
    const fs = await import('fs');
    const path = await import('path');

    switch (method) {
      case 'get': {
        if (!context.appId || !context.convId) return { workspaceDir: null };
        const conv = await conversationService.getConversation(context.appId, context.convId);
        return { workspaceDir: conv?.workspaceDir || null };
      }
      case 'set': {
        if (!context.appId || !context.convId) throw new Error('Conversation context required');
        const dir = args.path as string;
        if (!dir) throw new Error('path is required');
        // 解析为绝对路径
        const absDir = path.resolve(dir);
        // 验证目录存在
        if (!fs.existsSync(absDir)) throw new Error(`Directory does not exist: ${absDir}`);
        if (!fs.statSync(absDir).isDirectory()) throw new Error(`Not a directory: ${absDir}`);
        await conversationService.updateConversation(context.appId, context.convId, { workspaceDir: absDir } as any);
        return { success: true, workspaceDir: absDir };
      }
      case 'requestAccess': {
        // 弹出目录选择表单（通过 mcp.form 机制）
        const toolCallId = args._toolCallId as string || 'direct';
        const formResult = await this.handleFormMethod('requestInput', {
          title: '工作目录选择',
          description: '请选择一个会话工作目录。该目录下的所有文件操作将不再受限。',
          fields: [
            {
              id: 'path',
              label: '目录路径',
              type: 'text',
              placeholder: '例如: /mnt/c/apps/my-project',
              required: true,
              description: '工作目录的绝对路径',
            },
          ],
          schema: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '工作目录的绝对路径' },
            },
            required: ['path'],
          },
        } as any, { ...context as any, _toolCallId: toolCallId });
        return { status: 'pending', form: formResult, message: 'Please select a workspace directory.' };
      }
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }
}

export const mcpServiceRegistry = new MCPServiceRegistry();
