import type { MCPService, Content } from '../types/index.js';
import type { FormSchema } from '../types/index.js';
import { mcpClientRegistry } from './clientRegistry.js';
import { logger } from '../utils/logger.js';
import { eventBus, type ConvEvent } from '../services/eventBus.js';
import { runAgentAsync } from '../agents/pi-agent-session.js';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'node:path';
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
    description: '文件系统服务 - 读取、写入、搜索、替换、列出、创建、删除文件（相对路径相对于 desktop_data 目录）',
    methods: ['read', 'write', 'patch', 'search', 'list', 'mkdir', 'delete'],
    category: 'admin',
  },
  'mcp.settings': {
    name: 'mcp.settings',
    description: '系统设置与技能管理服务 - 获取更新设置、从会话生成技能、管理应用技能配置',
    methods: ['get', 'update', 'generateSkill', 'addSkillToApp', 'getApps', 'getConversations', 'getConversation'],
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
  'mcp.memory': {
    name: 'mcp.memory',
    description: '记忆服务 - 管理 AI 的长期记忆和目标树。支持保存、查询、删除记忆条目，以及设置和完成会话目标',
    methods: [
      'remember', 'recall', 'recallByPrefix', 'forget',
      'setGoal', 'completeGoal', 'getActiveGoals', 'getArchivedGoals',
      'list', 'listTags', 'stats',
    ],
    category: 'builtin',
  },

  // ===== 工作工具（workspace）=====
  'workspace.code': {
    name: 'workspace.code',
    description: '工作区文件编辑 - 读取、写入、替换、搜索、列出文件（路径相对于会话工作目录，支持绝对路径）',
    methods: ['read', 'write', 'patch', 'search', 'list'],
    category: 'workspace',
    workspaceFields: {
      read: ['path'],
      write: ['path'],
      patch: ['path'],
      search: ['pattern'],
      list: ['path'],
    },
  },
  'mcp.skill': {
    name: 'mcp.skill',
    description: '技能服务 - 列出可用技能、读取技能文档（入口/详情文件）、列出和执行脚本',
    methods: ['list', 'read', 'readEntry', 'listFiles', 'listScripts', 'exec'],
    category: 'admin',
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
      case 'mcp.memory':
        return this.handleMemoryMethod(method, args, context);
      case 'workspace.code':
        return this.handleWorkspaceCodeMethod(method, args, context);
      case 'workspace.dir':
        return this.handleWorkspaceDirMethod(method, args, context);
      case 'mcp.skill':
        return this.handleSkillMethod(method, args, context);
      default:
        throw new Error(`Service ${serviceName} not implemented`);
    }
  }

  private async handleAgentMethod(
    method: string,
    args: Record<string, unknown>,
    context: { appId?: string; convId?: string }
  ): Promise<unknown> {
    const { appState } = await import('../services/appState.js');
    const { conversationService } = await import('../services/conversation.js');
    const { agentEngine } = await import('../agents/engine.js');

    switch (method) {
      case 'list': {
        // 获取调用者的信息，用于过滤可见的agent列表
        const callerApp = context.appId ? appState.getApp(context.appId) : null;
        const visibleApps = [...new Set([
          ...(callerApp?.config.visibleApps || []),
          ...(callerApp?.meta.visibleApps || [])
        ])];
        const visibleServices = [...new Set([
          ...(callerApp?.config.visibleServices || []),
          ...(callerApp?.meta.visibleServices || [])
        ])];

        return {
          agents: appState.getAllApps()
            .filter(a => {
              // 只返回 desktop 和 background 类型的应用
              if (a.meta.type !== 'desktop' && a.meta.type !== 'background') return false;
              if (a.meta.type === 'desktop') {
                // 桌面应用：用 visibleApps 控制
                if (visibleApps.length > 0) {
                  if (!visibleApps.includes(a.meta.id) && a.meta.id !== context.appId) return false;
                } else {
                  // 没有配置可见应用，只返回自己
                  if (a.meta.id !== context.appId) return false;
                }
              } else if (a.meta.type === 'background') {
                // 后台服务：用 visibleServices 控制
                if (visibleServices.length > 0) {
                  if (!visibleServices.includes(a.meta.id)) return false;
                } else {
                  // 没有配置可见后台服务，不返回任何后台服务
                  return false;
                }
              }
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
        const app = appState.getApp(args.id as string);
        if (!app) {
          return { error: 'Agent not found' };
        }
        // 可见性检查
        if (context.appId && args.id !== context.appId) {
          const callerApp = appState.getApp(context.appId);
          if (app.meta.type === 'desktop') {
            const callerVisibleApps = [...new Set([
              ...(callerApp?.config.visibleApps || []),
              ...(callerApp?.meta.visibleApps || [])
            ])];
            if (callerVisibleApps.length > 0 && !callerVisibleApps.includes(args.id as string)) {
              return { error: 'Agent not visible' };
            } else if (callerVisibleApps.length === 0) {
              return { error: 'Agent not visible' };
            }
          } else if (app.meta.type === 'background') {
            const callerVisibleServices = [...new Set([
              ...(callerApp?.config.visibleServices || []),
              ...(callerApp?.meta.visibleServices || [])
            ])];
            if (callerVisibleServices.length > 0 && !callerVisibleServices.includes(args.id as string)) {
              return { error: 'Agent not visible' };
            } else if (callerVisibleServices.length === 0) {
              return { error: 'Agent not visible' };
            }
          }
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

        const targetApp = appState.getApp(agentId);
        if (!targetApp) throw new Error(`Agent ${agentId} not found`);
        if (targetApp.meta.type !== 'desktop' && targetApp.meta.type !== 'background') {
          throw new Error(`Agent ${agentId} is not callable`);
        }
        // 可见性检查
        if (context.appId) {
          const callerApp = appState.getApp(context.appId);
          const targetApp_check = appState.getApp(agentId);
          if (!targetApp_check) throw new Error(`Agent ${agentId} not found`);

          if (targetApp_check.meta.type === 'desktop') {
            const callerVisibleApps = [...new Set([
              ...(callerApp?.config.visibleApps || []),
              ...(callerApp?.meta.visibleApps || [])
            ])];
            if (callerVisibleApps.length > 0) {
              if (!callerVisibleApps.includes(agentId)) {
                throw new Error(`Agent ${agentId} is not visible`);
              }
            } else {
              // 没有配置可见应用，只能调用自己
              if (agentId !== context.appId) {
                throw new Error(`Agent ${agentId} is not visible`);
              }
            }
          } else if (targetApp_check.meta.type === 'background') {
            const callerVisibleServices = [...new Set([
              ...(callerApp?.config.visibleServices || []),
              ...(callerApp?.meta.visibleServices || [])
            ])];
            if (callerVisibleServices.length > 0) {
              if (!callerVisibleServices.includes(agentId)) {
                throw new Error(`Agent ${agentId} is not visible`);
              }
            } else {
              throw new Error(`Agent ${agentId} is not visible`);
            }
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

    // 相对路径以 desktop_data 为基准，绝对路径直接使用
    const filePath = args.path as string || '';
    let baseDir: string;
    if (path.isAbsolute(filePath)) {
      baseDir = '';
    } else {
      baseDir = DATA_DIR;
    }
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(DATA_DIR, filePath);

    // 安全检查：防止相对路径穿越到 desktop_data 之外
    if (!path.isAbsolute(filePath)) {
      if (path.relative(DATA_DIR, fullPath).startsWith('..')) {
        throw new Error('Path traversal denied: path must be within desktop_data directory');
      }
    }

    switch (method) {
      case 'read':
        try {
          const content = await fs.readFile(fullPath, 'utf-8');
          const stat = await fs.stat(fullPath);
          return { content, size: stat.size, path: filePath };
        } catch (err: any) {
          throw new Error(`Failed to read file: ${err.message}`);
        }
      case 'write':
        try {
          await fs.mkdir(path.dirname(fullPath), { recursive: true });
          await fs.writeFile(fullPath, args.content as string, 'utf-8');
          return { success: true, path: filePath };
        } catch (err: any) {
          throw new Error(`Failed to write file: ${err.message}`);
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
          if (occurrences === 0) throw new Error('String not found in file');
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
          const { execSync } = await import('child_process');
          let cmd = `rg -n --no-heading -m 5 '${pattern.replace(/'/g, "'\\''")}'`;
          if (fileGlob) cmd += ` -g '${fileGlob.replace(/'/g, "'\\''")}'`;
          cmd += ` '${baseDir.replace(/'/g, "'\\''")}' 2>/dev/null | head -${maxResults}`;
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
      case 'list':
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
          return { items, path: filePath || '.' };
        } catch (err: any) {
          throw new Error(`Failed to list directory: ${err.message}`);
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
    const { appState } = await import('../services/appState.js');

    switch (method) {
      case 'get':
        return appState.getSettings();
      case 'update':
        return appState.updateSettings(args as Record<string, unknown>);
      case 'getApps': {
        const apps = appState.getAllApps();
        return { apps: apps.map(a => ({ id: a.meta.id, name: a.meta.name, skills: a.skills || [] })) };
      }
      case 'getConversations': {
        // args: { appId: string }
        const { conversationService } = await import('../services/conversation.js');
        const targetAppId = args.appId as string;
        if (!targetAppId) throw new Error('appId is required');
        const convs = await conversationService.getConversations(targetAppId);
        return { conversations: convs.map((c: any) => ({ id: c.id, title: c.title, messageCount: c.messages?.length || 0 })) };
      }
      case 'getConversation': {
        // args: { appId: string, conversationId: string }
        const { conversationService: convSvc } = await import('../services/conversation.js');
        const appId = args.appId as string;
        const convId = args.conversationId as string;
        if (!appId || !convId) throw new Error('appId and conversationId are required');
        const conv = await convSvc.getConversation(appId, convId);
        if (!conv) throw new Error('Conversation not found');
        return {
          id: conv.id,
          title: conv.title,
          messages: conv.messages?.map((m: any) => ({
            role: m.role,
            content: m.content?.filter((c: any) => c.type === 'text').map((c: any) => c.text).join(' '),
            timestamp: m.timestamp,
          })) || [],
        };
      }
      case 'generateSkill': {
        // args: { conversations: [{ appId, conversationId, title, messages }] }
        const conversations = args.conversations as any[];
        if (!conversations || !Array.isArray(conversations) || conversations.length === 0) {
          throw new Error('conversations array is required');
        }
        // 调用 POST /settings/skills/generate 的相同逻辑
        const modes = await appState.getModes();
        const defaultModelConfig = await appState.getDefaultModel();
        let providerId = defaultModelConfig.providerId;
        let modelId = defaultModelConfig.modelId;
        if (!providerId || !modelId) throw new Error('No default model configured');

        const { randomUUID } = await import('crypto');
        const { streamSimple } = await import('@earendil-works/pi-ai');
        const { findModel } = await import('../models/pi-adapter.js');
        const providerConfig = modes.providers.find((p: any) => p.id === providerId);
        if (!providerConfig) throw new Error(`Provider "${providerId}" not found.`);
        const modelObj = findModel(modes.providers, providerId, modelId);
        if (!modelObj) throw new Error(`Model "${modelId}" not found.`);

        const conversationText = conversations.map((conv: any, i: number) => {
          const msgs = (conv.messages || []).map((m: any) =>
            `[${m.role}] ${m.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join(' ')}`
          ).join('\n');
          return `=== 会话 ${i + 1}: ${conv.title || conv.conversationId} ===\n${msgs}`;
        }).join('\n\n');

        const systemPrompt = `你是一个技能制作助手。...`;
        const userMessage = `请根据以下对话记录制作一个技能：\n\n${conversationText}`;

        const aiContext: any[] = [
          { role: 'system', content: [{ type: 'text', text: systemPrompt + `\n\n输出格式：\n---skill-name\n技能名称\n---skill-description\n技能描述\n---skill-prompt\n技能提示词内容` }] },
          { role: 'user', content: [{ type: 'text', text: userMessage }] },
        ];

        const streamOptions: any = {};
        if (providerConfig.baseUrl) streamOptions.baseUrl = providerConfig.baseUrl;
        const headers: Record<string, string> = {};
        if (providerConfig.apiKey) {
          if (providerConfig.apiType === 'anthropic') headers['x-api-key'] = providerConfig.apiKey;
          else headers['authorization'] = `Bearer ${providerConfig.apiKey}`;
        }
        streamOptions.headers = headers;

        let fullText = '';
        const stream = streamSimple(modelObj, aiContext as any, streamOptions);
        for await (const chunk of stream as any) {
          if (chunk.type === 'text_delta' && chunk.text) fullText += chunk.text;
        }

        const nameMatch = fullText.match(/---skill-name\s*\n([\s\S]*?)(?:\n---|$)/);
        const descMatch = fullText.match(/---skill-description\s*\n([\s\S]*?)(?:\n---|$)/);
        const promptMatch = fullText.match(/---skill-prompt\s*\n([\s\S]*)$/);

        const skillName = nameMatch ? nameMatch[1].trim() : '未命名技能';
        const skillDesc = descMatch ? descMatch[1].trim() : '';
        const skillPrompt = promptMatch ? promptMatch[1].trim() : fullText;

        const newSkill = { name: skillName, description: skillDesc, prompt: skillPrompt };
        const { skillService } = await import('../services/skillService.js');
        const result = await skillService.saveGeneratedSkill(newSkill);
        return { skill: newSkill, id: result.id };
      }
      case 'addSkillToApp': {
        // args: { appId: string, skillId: string }
        const targetAppId = args.appId as string;
        const skillId = args.skillId as string;
        if (!targetAppId || !skillId) throw new Error('appId and skillId are required');
        const app = appState.getApp(targetAppId);
        if (!app) throw new Error(`App "${targetAppId}" not found`);
        const currentSkills = app.skills || [];
        if (!currentSkills.includes(skillId)) {
          currentSkills.push(skillId);
        }
        // 写回磁盘
        const path = await import('path');
        const { writeJsonFile, APPS_DIR } = await import('../utils/file.js');
        const includePath = path.default.join(APPS_DIR, app.meta.source, targetAppId, 'skills', 'include.json');
        await writeJsonFile(includePath, { skills: currentSkills });
        // 刷新内存中该应用的 skills
        const apps = appState.getAllApps();
        const target = apps.find((a: any) => a.meta.id === targetAppId);
        if (target) {
          try {
            const { readJsonFile } = await import('../utils/file.js');
            const includeData = await readJsonFile<{ skills: string[] }>(path.default.join(APPS_DIR, app.meta.source, targetAppId, 'skills', 'include.json'));
            if (includeData) {
              target.skills = includeData.skills;
            }
          } catch {}
        }
        return { success: true, appId: targetAppId, skills: currentSkills };
      }
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

        const toolCallId = args._toolCallId as string || '';

        // 直接 emit form_request 到前端
        if (context.appId && context.convId) {
          eventBus.emit({
            type: 'form_request',
            appId: context.appId,
            convId: context.convId,
            data: formInfo,
          });
        }

        // 等待用户提交/取消表单——会在 form_response 或 form_cancelled 任一触发时结束
        const formResult = await new Promise<ConvEvent>((resolve) => {
          const done = (event: ConvEvent) => {
            // 用 toolCallId 匹配（兼容 workspace 授权场景没有 formId 的情况），或 fallback 到 formId
            const match = event.data?.formId === formId
              || (event.data?.toolCallId && event.data?.toolCallId === toolCallId);
            if (match) {
              cleanup();
              resolve(event);
            }
          };
          const cleanup = () => {
            eventBus.ee.off('form_response', done);
            eventBus.ee.off('form_cancelled', done);
          };
          eventBus.ee.on('form_response', done);
          eventBus.ee.on('form_cancelled', done);
        });

        if (formResult.type === 'form_cancelled' || formResult.data?.cancelled) {
          return { status: 'cancelled', message: '用户取消了表单填写' };
        }

        return formResult.data?.formData || {};
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
    const { conversationService } = await import('../services/conversation.js');
    const conv = context.appId && context.convId ? await conversationService.getConversation(context.appId, context.convId) : null;
    const authorizedDirs: string[] = [...(conv?.authorizedDirs || [])];
    const workspaceDirVal = conv?.workspaceDir;
    const pathModule = await import('path');
    const requestedPath = (args.path as string) || '';

    // 没有工作目录时，根据路径类型决定行为
    if (!workspaceDirVal) {
      // 相对路径：直接用 APPS_DATA_DIR/appId 作为基础目录
      if (requestedPath && !pathModule.isAbsolute(requestedPath)) {
        const { APPS_DATA_DIR } = await import('../utils/file.js');
        const dataDir = pathModule.join(APPS_DATA_DIR, context.appId || '');
        return this.handleWorkspaceCodeWithBase(method, args, dataDir);
      }
      // 绝对路径或空路径：弹出授权框要求用户设置工作目录
      const authResult = await this.requestWorkspaceAuthorization(context, '首次使用需要设置工作目录', requestedPath);
      // 授权成功后，重新获取会话（包含了新设置的工作目录）
      const updatedConv = context.appId && context.convId ? await conversationService.getConversation(context.appId, context.convId) : null;
      if (!updatedConv?.workspaceDir) {
        throw new Error('工作目录设置失败');
      }
      // 重新执行实际的方法
      return this.handleWorkspaceCodeMethod(method, args, context);
    }

    // 获取该方法的路径参数列表
    const service = this.services.get('workspace.code');
    const pathFields = service?.workspaceFields?.[method] || ['path'];
    const accessedPaths: string[] = [];

    // 提取所有路径参数并解析为绝对路径
    for (const field of pathFields) {
      const val = args[field];
      if (typeof val === 'string' && val.trim()) {
        const absPath = this.resolvePath(val, workspaceDirVal);
        if (absPath) accessedPaths.push(absPath);
      }
    }

    // 如果访问了任何外部路径，检查授权
    const unauthorizedPaths: string[] = [];
    for (const ap of accessedPaths) {
      const isInWorkspace = pathModule.relative(workspaceDirVal, ap).startsWith('..') === false;
      const isAuthorized = authorizedDirs.some(a => !pathModule.relative(a, ap).startsWith('..'));
      if (!isInWorkspace && !isAuthorized) {
        unauthorizedPaths.push(ap);
      }
    }

    if (unauthorizedPaths.length > 0) {
      // 有未授权的目录，弹出授权请求（拒绝式：用户拒绝后 agent 继续）
      return this.requestDirectoryAccess(context, unauthorizedPaths[0]);
    }

    // 权限通过，继续执行
    const fs = await import('fs/promises');
    const filePath = args.path as string || '';
    const fullPath = pathModule.isAbsolute(filePath) ? filePath : pathModule.join(workspaceDirVal, filePath);

    // 安全检查
    if (pathModule.relative(workspaceDirVal, fullPath).startsWith('..') && !authorizedDirs.some(a => !pathModule.relative(a, fullPath).startsWith('..'))) {
      throw new Error('Path traversal denied: path must be within workspace or authorized directory');
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

  /**
   * 使用指定基础目录执行 workspace.code 操作（跳过工作目录检查和授权）
   * 用于没有设置工作目录时的默认行为（直接用 APPS_DATA_DIR/appId）
   */
  private async handleWorkspaceCodeWithBase(
    method: string,
    args: Record<string, unknown>,
    baseDir: string,
  ): Promise<unknown> {
    const fs = await import('fs/promises');
    const path = await import('path');
    const filePath = args.path as string || '';
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(baseDir, filePath);

    // 安全检查
    if (path.relative(baseDir, fullPath).startsWith('..')) {
      throw new Error('Path traversal denied: path must be within app data directory');
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
        if (newStr === undefined) throw new Error('new_string is required');
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
        let cmd = `rg -n --max-count ${maxResults}`;
        if (fileGlob) cmd += ` -g '${fileGlob}'`;
        cmd += ` '${pattern}' '${fullPath}'`;
        try {
          const output = execSync(cmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
          const lines = output.trim().split('\n').filter(Boolean);
          const results = lines.map((line: string) => {
            const sepIdx = line.indexOf(':');
            const lineSep = sepIdx > 0 ? line.indexOf(':', sepIdx + 1) : -1;
            if (sepIdx < 0 || lineSep < 0) return { file: line, line: 0, content: '' };
            return { file: line.slice(0, sepIdx), line: parseInt(line.slice(sepIdx + 1, lineSep), 10) || 0, content: line.slice(lineSep + 1) };
          });
          return { results, total: results.length };
        } catch { return { results: [], total: 0 }; }
      }
      case 'list': {
        const dirPath = filePath || '.';
        const entries = await fs.readdir(fullPath, { withFileTypes: true });
        const items = await Promise.all(entries.map(async e => {
          const stat = e.isFile() ? await fs.stat(path.join(fullPath, e.name)).catch(() => null) : null;
          return { name: e.name, type: e.isDirectory() ? 'directory' : 'file', size: stat?.size || 0, modified: stat?.mtime?.toISOString() || '' };
        }));
        return { items, path: dirPath };
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
        return { status: 'pending', form: formResult };
      }
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }

  private resolvePath(targetPath: string, baseDir: string): string | null {
    if (!targetPath || !targetPath.trim()) return null;
    return path.isAbsolute(targetPath) ? targetPath : path.join(baseDir, targetPath);
  }

  /**
   * 请求设置工作目录（中断式：用户取消后不执行）
   * 首次使用 workspace 工具时调用
   */
  private async requestWorkspaceAuthorization(
    context: { appId?: string; convId?: string },
    message: string,
    requestedPath: string = '',
  ): Promise<unknown> {
    const toolCallId = (context as any)._toolCallId || 'direct';

    // emit workspace_request 让前端用专用选择器
    if (context.appId && context.convId) {
      eventBus.emit({
        type: 'workspace_request',
        appId: context.appId,
        convId: context.convId,
        data: { toolCallId, message, requestedPath },
      });
    }

    // 等待 workspace-response 路由的响应
    const result = await new Promise<ConvEvent>((resolve) => {
      const done = (event: ConvEvent) => {
        if (event.data?.toolCallId === toolCallId) {
          cleanup();
          resolve(event);
        }
      };
      const cleanup = () => {
        eventBus.ee.off('workspace_response', done);
        eventBus.ee.off('workspace_cancelled', done);
      };
      eventBus.ee.on('workspace_response', done);
      eventBus.ee.on('workspace_cancelled', done);
    });

    if (result.type === 'workspace_cancelled' || result.data?.cancelled) {
      throw new Error('用户取消了工作目录设置');
    }

    // 授权成功，workspace-response 路由已经保存了 workspaceDir，不需要返回任何内容
    return;
  }

  /**
   * 请求授权访问外部目录（拒绝式：用户拒绝后 agent 可继续）
   * workspace 工具访问工作目录之外的目录时调用
   */
  private async requestDirectoryAccess(
    context: { appId?: string; convId?: string },
    requestedPath: string,
  ): Promise<unknown> {
    const toolCallId = (context as any)._toolCallId || 'direct';
    const args: Record<string, unknown> = {
      title: '授权访问目录',
      description: `Agent 需要访问目录：${requestedPath}，是否授权？`,
      fields: [
        {
          id: 'confirm',
          label: `授权访问 ${requestedPath}`,
          type: 'confirm',
          required: true,
        },
      ],
      schema: {
        type: 'object',
        properties: {
          confirm: { type: 'boolean', description: '是否授权' },
        },
        required: ['confirm'],
      },
    };
    return this.handleFormMethod('requestInput', args as any, { ...context, _toolCallId: toolCallId } as any);
  }

  private async handleMemoryMethod(
    method: string,
    args: Record<string, unknown>,
    context: { appId?: string; userId?: string; convId?: string },
  ): Promise<unknown> {
    const { memoryService } = await import('../services/memory.js');
    const appId = context.appId;
    if (!appId) throw new Error('appId is required');

    switch (method) {
      case 'remember': {
        const scope = (args.scope as string) || 'app';
        const convId = scope === 'conversation' ? (args.convId as string || context.convId) : undefined;
        return memoryService.remember(scope as any, appId, {
          type: args.type as any,
          key: args.key as string,
          value: args.value as string,
          content: args.content as string,
          tags: args.tags as string[],
          source: (args.source as any) || 'agent',
          ttl: args.ttl as number,
        }, convId);
      }
      case 'recall': {
        const scope = (args.scope as string) || 'app';
        const convId = scope === 'conversation' ? (args.convId as string || context.convId) : undefined;
        return memoryService.recall(scope as any, appId, {
          key: args.key as string,
          keyPrefix: args.keyPrefix as string,
          type: args.type as any,
          tags: args.tags as string[],
          tagsAny: args.tagsAny as string[],
          search: args.search as string,
          limit: args.limit as number,
          offset: args.offset as number,
        }, convId);
      }
      case 'recallByPrefix': {
        const scope = (args.scope as string) || 'app';
        const convId = scope === 'conversation' ? (args.convId as string || context.convId) : undefined;
        return memoryService.recallByPrefix(scope as any, appId, args.keyPrefix as string, convId);
      }
      case 'forget': {
        const scope = (args.scope as string) || 'app';
        const convId = scope === 'conversation' ? (args.convId as string || context.convId) : undefined;
        if (args.tag) return memoryService.forgetByTag(scope as any, appId, args.tag as string, convId);
        return memoryService.forget(scope as any, appId, args.id as string, convId);
      }
      case 'setGoal': {
        const level = args.level as number;
        const value = args.value as string;
        const source = (args.source as any) || 'agent';
        if (!context.convId) throw new Error('convId is required for goal operations');
        if (level === 1) return memoryService.setLevel1Goal(appId, context.convId, value, source);
        if (level === 2) return memoryService.setLevel2Goal(appId, context.convId, value, source);
        if (level === 3) return memoryService.setLevel3Goal(appId, context.convId, value, source);
        throw new Error('level must be 1, 2, or 3');
      }
      case 'completeGoal': {
        if (!context.convId) throw new Error('convId is required for goal operations');
        await memoryService.completeGoal(appId, context.convId, args.level as 1|2|3);
        return { success: true };
      }
      case 'getActiveGoals': {
        if (!context.convId) throw new Error('convId is required for goal operations');
        return memoryService.getActiveGoals(appId, context.convId);
      }
      case 'getArchivedGoals': {
        if (!context.convId) throw new Error('convId is required for goal operations');
        return memoryService.getArchivedGoals(appId, context.convId);
      }
      case 'list': {
        const scope = (args.scope as string) || 'app';
        const convId = scope === 'conversation' ? (args.convId as string || context.convId) : undefined;
        return memoryService.getAll(scope as any, appId, convId);
      }
      case 'listTags': {
        const scope = (args.scope as string) || 'app';
        const convId = scope === 'conversation' ? (args.convId as string || context.convId) : undefined;
        return memoryService.listTags(scope as any, appId, convId);
      }
      case 'stats': {
        const scope = (args.scope as string) || 'app';
        const convId = scope === 'conversation' ? (args.convId as string || context.convId) : undefined;
        return memoryService.stats(scope as any, appId, convId);
      }
      default:
        throw new Error(`Method ${method} not supported on mcp.memory`);
    }
  }

  private async handleSkillMethod(
    method: string,
    args: Record<string, unknown>,
    context: { appId?: string; convId?: string }
  ): Promise<unknown> {
    const { skillService } = await import('../services/skillService.js');

    switch (method) {
      case 'list': {
        // 只返回当前应用被授权的技能（含文件列表）
        const { appState } = await import('../services/appState.js');
        const app = context.appId ? appState.getApp(context.appId) : null;
        const appSkillIds = app?.skills || [];
        const skills = await skillService.getEnabledSkillsForApp(appSkillIds);
        // 获取完整信息（含文件列表）
        const allSkills = await skillService.getSkills();
        const filtered = allSkills.filter(s => appSkillIds.includes(s.id));
        return { skills: filtered };
      }
      case 'read': {
        // 读取技能中的任意文件
        const skillId = args.skillId as string;
        const filePath = args.path as string;
        if (!skillId || !filePath) throw new Error('skillId and path are required');
        const content = await skillService.readSkillFile(skillId, filePath);
        if (content === null) throw new Error(`File "${filePath}" not found in skill "${skillId}"`);
        return { skillId, path: filePath, content };
      }
      case 'readEntry': {
        // 读取技能入口文档（roadmap.md）
        const skillId = args.skillId as string;
        if (!skillId) throw new Error('skillId is required');
        const content = await skillService.getSkillEntry(skillId);
        if (content === null) throw new Error(`Skill "${skillId}" not found or has no entry document`);
        return { skillId, content };
      }
      case 'listFiles': {
        // 列出技能目录下的所有文件
        const skillId = args.skillId as string;
        if (!skillId) throw new Error('skillId is required');
        const files = await skillService.listSkillFiles(skillId);
        return { skillId, files };
      }
      case 'listScripts': {
        // 列出技能可用的脚本
        const skillId = args.skillId as string;
        if (!skillId) throw new Error('skillId is required');
        const scripts = await skillService.listSkillScripts(skillId);
        return { skillId, scripts };
      }
      case 'exec': {
        const skillId = args.skillId as string;
        const scriptName = args.script as string;
        const scriptArgs = (args.args as string[]) || [];
        if (!skillId || !scriptName) throw new Error('skillId and script are required');

        // 安全检查：只允许纯文件名（不能包含路径分隔符）
        if (scriptName.includes('/') || scriptName.includes('\\') || scriptName.includes('..')) {
          throw new Error('Path traversal denied: script must be a filename within scripts/ directory');
        }

        const path_mod = await import('path');

        // 确定工作目录
        let cwd: string | undefined;
        if (context.convId) {
          const { conversationService } = await import('../services/conversation.js');
          const conv = await conversationService.getConversation(context.appId || '', context.convId);
          if (conv?.workspaceDir) {
            cwd = conv.workspaceDir;
          } else if (context.appId) {
            // 没有 workspaceDir，在 desktop_data/workspaces/{appId}/{convId}/ 创建
            const { DATA_DIR } = await import('../utils/file.js');
            const workspaceRoot = path_mod.join(DATA_DIR, 'workspaces', context.appId, context.convId);
            const fs_mod = await import('fs/promises');
            await fs_mod.mkdir(workspaceRoot, { recursive: true });
            cwd = workspaceRoot;
            // 保存到会话
            await conversationService.updateConversation(context.appId, context.convId, { workspaceDir: cwd } as any);
          }
        }

        const output = await skillService.execSkillScript(skillId, scriptName, scriptArgs, cwd);
        return { skillId, script: scriptName, output, cwd };
      }
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }
}

export const mcpServiceRegistry = new MCPServiceRegistry();
