import type { MCPService, Content } from '../types/index.js';
import type { FormSchema } from '../types/index.js';
import { mcpClientRegistry } from './clientRegistry.js';
import { logger } from '../utils/logger.js';
import { eventBus, type ConvEvent } from '../services/eventBus.js';
import { runAgentAsync } from '../agents/pi-agent-session.js';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'node:path';
import * as os from 'os';

/**
 * 内置MCP服务定义（2026-07 重构版）
 *
 * 按功能分为四层：
 *   系统维护工具 (admin) — 需要用户在应用设置中勾选
 *   系统通用工具 (builtin) — 需要用户在应用设置中勾选
 *   工作区工具 (workspace) — 需要勾选，且操作受工作目录+授权限制
 *   内置动态配置工具 — 不由 meta.tools 控制，条件满足时自动注入
 */
const builtInServices: Record<string, MCPService> = {
  // ===== 系统维护工具（admin）=====
  'mcp.filesystem': {
    name: 'mcp.filesystem',
    description: '文件系统 - 读取、写入、搜索、替换、移动、复制、列出、创建、删除文件（相对路径相对于 desktop_data 目录）',
    methods: ['read', 'write', 'patch', 'search', 'list', 'move', 'copy', 'mkdir', 'delete'],
    category: 'admin',
  },
  'mcp.settings': {
    name: 'mcp.settings',
    description: '系统设置 - 获取/更新系统设置、应用列表、应用设置、可用技能列表',
    methods: ['get', 'update', 'getApps', 'getAppSettings', 'setAppSettings', 'getSkillsList'],
    category: 'admin',
  },

  // ===== 系统通用工具（builtin）=====
  'mcp.form': {
    name: 'mcp.form',
    description: '表单交互 - 向用户展示结构化输入表单，收集用户填写的数据后返回',
    methods: ['requestInput'],
    category: 'feature',
  },
  'mcp.memory': {
    name: 'mcp.memory',
    description: '记忆服务 - 管理 AI 的长期记忆和目标树。支持保存、查询、删除记忆条目，以及设置和完成会话目标',
    methods: [
      'remember', 'recall', 'recallByPrefix', 'forget',
      'setGoal', 'completeGoal', 'getActiveGoals', 'getArchivedGoals',
      'list', 'listTags', 'stats',
    ],
    category: 'feature',
  },
  'mcp.browser': {
    name: 'mcp.browser',
    description: '浏览器控制 - 导航、点击、输入、截图、执行 JS',
    methods: ['navigate', 'snapshot', 'click', 'type', 'scroll', 'back', 'vision', 'console', 'press'],
    category: 'builtin',
  },
  'mcp.exec': {
    name: 'mcp.exec',
    description: '执行 shell 命令 - 运行一条命令并返回输出，支持设置超时时间和工作目录。当前系统: ' + os.platform() + ' ' + os.release(),
    methods: ['exec'],
    category: 'builtin',
  },
  'mcp.sleep': {
    name: 'mcp.sleep',
    description: '等待一段时间 - 暂停执行指定秒数（最长 600 秒/10 分钟），可用于等待外部操作完成或模拟延时',
    methods: ['sleep'],
    category: 'builtin',
  },
  'mcp.http': {
    name: 'mcp.http',
    description: 'HTTP 请求 - 发送 HTTP 请求，完全控制 URL、方法、请求头和请求体',
    methods: ['request'],
    category: 'builtin',
  },

  // ===== 工作区工具（workspace）=====
  'workspace.code': {
    name: 'workspace.code',
    description: '工作区文件编辑 - 读取、写入、替换、搜索、移动、复制、列出、创建、删除文件（路径相对于会话工作目录，支持绝对路径）',
    methods: ['read', 'write', 'patch', 'search', 'list', 'move', 'copy'],
    category: 'workspace',
    workspaceFields: {
      read: ['path'],
      write: ['path'],
      patch: ['path'],
      search: ['pattern'],
      list: ['path'],
      move: ['source', 'dest'],
      copy: ['source', 'dest'],
    },
  },
  'workspace.shell': {
    name: 'workspace.shell',
    description: '工作区命令行 - 在工作目录下执行 shell 命令，每次执行需用户授权',
    methods: ['exec'],
    category: 'workspace',
  },

  // ===== 内置动态配置服务（dynamic）=====
  // 不由 meta.tools 控制，有技能时自动注入 skill 工具到 AI 上下文
  'mcp.skill': {
    name: 'mcp.skill',
    description: '技能服务 - 列出可用的技能、读取技能文件、执行技能脚本',
    methods: ['list', 'read', 'exec'],
    category: 'dynamic',
  },
  // 有可见应用时自动注入 app 工具到 AI 上下文
  'mcp.app': {
    name: 'mcp.app',
    description: '应用访问 - 列出可调用的应用、调用应用完成任务',
    methods: ['list', 'call'],
    category: 'dynamic',
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
      case 'workspace.shell':
        return this.handleWorkspaceShellMethod(method, args, context);
      case 'mcp.skill':
        return this.handleSkillMethod(method, args, context);
      case 'mcp.app':
        return this.handleAppMethod(method, args, context);
      default:
        throw new Error(`Service ${serviceName} not implemented`);
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

    // mcp.filesystem 是通用文件工具，相对路径以 desktop_data 为基准，绝对路径直接使用
    const rawPath = args.path as string || '';
    const fullPath = path.isAbsolute(rawPath) ? rawPath : path.join(DATA_DIR, rawPath);

    switch (method) {
      case 'read':
        try {
          const content = await fs.readFile(fullPath, 'utf-8');
          const stat = await fs.stat(fullPath);
          const lines = content.split('\n');
          const offset = (args.offset as number) || 1;
          const limit = (args.limit as number) || lines.length;
          const startIdx = Math.max(0, offset - 1);
          const sliced = lines.slice(startIdx, startIdx + limit);
          return {
            content: sliced.join('\n'),
            total_lines: lines.length,
            size: stat.size,
            path: rawPath,
            offset,
            limit,
          };
        } catch (err: any) {
          throw new Error(`Failed to read file: ${err.message}`);
        }
      case 'write':
        try {
          await fs.mkdir(path.dirname(fullPath), { recursive: true });
          await fs.writeFile(fullPath, args.content as string, 'utf-8');
          return { success: true, path: rawPath };
        } catch (err: any) {
          throw new Error(`Failed to write file: ${err.message}`);
        }
      case 'patch': {
        if (!rawPath) throw new Error('path is required');
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
          return { success: true, path: rawPath, replacements: occurrences > 1 ? occurrences : 1 };
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
        // search 必须指定 baseDir，不允许默认搜索整个 desktop_data
        const rawBaseDir = args.baseDir as string | undefined;
        const searchDir = rawBaseDir && path.isAbsolute(rawBaseDir)
          ? rawBaseDir
          : (rawBaseDir ? path.join(DATA_DIR, rawBaseDir) : '');
        if (!searchDir) throw new Error('baseDir is required for search. Specify the directory to search in.');
        try {
          const { execSync } = await import('child_process');
          let cmd = `rg -n --no-heading -m 5 '${pattern.replace(/'/g, "'\\''")}'`;
          if (fileGlob) cmd += ` -g '${fileGlob.replace(/'/g, "'\\''")}'`;
          cmd += ` '${searchDir.replace(/'/g, "'\\''")}' 2>/dev/null | head -${maxResults}`;
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
          return { results, total: results.length, path: searchDir };
        } catch {
          return { results: [], total: 0, path: searchDir };
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
          return { items, path: rawPath || '.' };
        } catch (err: any) {
          throw new Error(`Failed to list directory: ${err.message}`);
        }
      case 'mkdir':
        try {
          await fs.mkdir(fullPath, { recursive: true });
          return { success: true, path: rawPath };
        } catch {
          throw new Error(`Failed to create directory: ${args.path}`);
        }
      case 'delete':
        try {
          await fs.rm(fullPath, { recursive: true });
          return { success: true, path: rawPath };
        } catch {
          throw new Error(`Failed to delete: ${args.path}`);
        }
      case 'move': {
        const src = args.source as string;
        const dst = args.dest as string;
        if (!src || !dst) throw new Error('source and dest are required');
        const srcPath = path.isAbsolute(src) ? src : path.join(DATA_DIR, src);
        const dstPath = path.isAbsolute(dst) ? dst : path.join(DATA_DIR, dst);
        await fs.mkdir(path.dirname(dstPath), { recursive: true });
        await fs.rename(srcPath, dstPath);
        return { success: true, source: src, dest: dst };
      }
      case 'copy': {
        const src = args.source as string;
        const dst = args.dest as string;
        if (!src || !dst) throw new Error('source and dest are required');
        const srcPath = path.isAbsolute(src) ? src : path.join(DATA_DIR, src);
        const dstPath = path.isAbsolute(dst) ? dst : path.join(DATA_DIR, dst);
        await fs.mkdir(path.dirname(dstPath), { recursive: true });
        await fs.cp(srcPath, dstPath, { recursive: true, errorOnExist: false });
        return { success: true, source: src, dest: dst };
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
        return { apps: apps.map(a => ({ id: a.meta.id, name: a.meta.name, type: a.meta.type, source: a.meta.source })) };
      }
      case 'getAppSettings': {
        const targetAppId = args.appId as string;
        if (!targetAppId) throw new Error('appId is required');
        const app = appState.getApp(targetAppId);
        if (!app) throw new Error(`App "${targetAppId}" not found`);
        return {
          id: app.meta.id,
          name: app.meta.name,
          description: app.meta.description,
          icon: app.meta.icon,
          enabled: app.config.enabled ?? true,
          models: app.config.models || app.meta.models,
          tools: [...new Set([...(app.config.tools || []), ...(app.meta.tools || [])])],
          skills: app.skills || [],
          visibleApps: app.config.visibleApps || app.meta.visibleApps,
          visibleServices: app.config.visibleServices || app.meta.visibleServices,
        };
      }
      case 'setAppSettings': {
        const targetAppId = args.appId as string;
        if (!targetAppId) throw new Error('appId is required');
        // 只更新 config 中允许覆盖的字段
        const updates: Record<string, unknown> = {};
        if (args.enabled !== undefined) updates.enabled = args.enabled;
        if (args.tools !== undefined) updates.tools = args.tools;
        if (args.visibleApps !== undefined) updates.visibleApps = args.visibleApps;
        if (args.visibleServices !== undefined) updates.visibleServices = args.visibleServices;
        if (args.models !== undefined) updates.models = args.models;
        await appState.updateApp(targetAppId, updates);
        return { success: true, appId: targetAppId };
      }
      case 'getSkillsList': {
        const { skillService } = await import('../services/skillService.js');
        const allSkills = await skillService.getSkills();
        return { skills: allSkills.map((s: any) => ({ id: s.id, name: s.name, description: s.description })) };
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
        const cwd = args.cwd as string | undefined;
        try {
          const execOptions: any = {
            timeout,
            encoding: 'utf-8',
            maxBuffer: 10 * 1024 * 1024,
            windowsHide: true,
          };
          if (cwd) execOptions.cwd = cwd;
          const output = execSync(command, execOptions);
          return { success: true, output, exitCode: 0, cwd: cwd || undefined };
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

        const toolCallId = args._toolCallId as string || '';

        // 不再等待 form_response —— 工具立即返回 pending 状态
        // toolResult 由 form-response route 直接保存到会话 JSON
        // agent 的继续由 form-response route 在检查所有表单都完成后触发
        if (context.appId && context.convId) {
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
          eventBus.emit({
            type: 'form_request',
            appId: context.appId,
            convId: context.convId,
            data: { toolCallId, schema, createdAt: new Date().toISOString() },
          });
        }

        // 工具立即返回空结果（不生成 toolResult），表单提交后由 form-response route 保存 toolResult
        return { _skip: true };
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
      const { WORKSPACES_DIR } = await import('../utils/file.js');
      const defaultWorkspace = pathModule.join(WORKSPACES_DIR, context.appId || '');

      // 相对路径：直接用 WORKSPACES_DIR/appId 作为工作目录
      if (requestedPath && !pathModule.isAbsolute(requestedPath)) {
        return this.handleWorkspaceCodeWithBase(method, args, defaultWorkspace);
      }
      // 绝对路径或空路径：弹出授权框，推荐使用 APPS_DATA_DIR/appId 作为默认工作目录
      const authResult = await this.requestWorkspaceAuthorization(context, '首次使用需要设置工作目录。推荐使用应用数据目录作为工作目录。', defaultWorkspace);
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
    const rawPath = args.path as string || '';
    const fullPath = pathModule.isAbsolute(rawPath) ? rawPath : pathModule.join(workspaceDirVal, rawPath);

    // 安全检查
    if (pathModule.relative(workspaceDirVal, fullPath).startsWith('..') && !authorizedDirs.some(a => !pathModule.relative(a, fullPath).startsWith('..'))) {
      throw new Error('Path traversal denied: path must be within workspace or authorized directory');
    }

    switch (method) {
      case 'read': {
        if (!rawPath) throw new Error('path is required');
        const content = await fs.readFile(fullPath, 'utf-8');
        const stat = await fs.stat(fullPath);
        return { content, size: stat.size, path: rawPath };
      }
      case 'write': {
        if (!rawPath) throw new Error('path is required');
        const content = args.content as string;
        if (content === undefined) throw new Error('content is required');
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, content, 'utf-8');
        return { success: true, path: rawPath };
      }
      case 'patch': {
        if (!rawPath) throw new Error('path is required');
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
        return { success: true, path: rawPath, replacements: occurrences > 1 ? occurrences : 1 };
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
        const dirPath = rawPath || '.';
        const entries = await fs.readdir(fullPath, { withFileTypes: true });
        const items = await Promise.all(entries.map(async e => {
          const stat = e.isFile() ? await fs.stat(path.join(fullPath, e.name)).catch(() => null) : null;
          return { name: e.name, type: e.isDirectory() ? 'directory' : 'file', size: stat?.size || 0, modified: stat?.mtime?.toISOString() || '' };
        }));
        return { items, path: dirPath, workspaceDir: workspaceDirVal };
      }
      case 'move': {
        const src = args.source as string;
        const dst = args.dest as string;
        if (!src || !dst) throw new Error('source and dest are required');
        const srcPath = pathModule.isAbsolute(src) ? src : pathModule.join(workspaceDirVal, src);
        const dstPath = pathModule.isAbsolute(dst) ? dst : pathModule.join(workspaceDirVal, dst);
        await fs.mkdir(path.dirname(dstPath), { recursive: true });
        await fs.rename(srcPath, dstPath);
        return { success: true, source: src, dest: dst, workspaceDir: workspaceDirVal };
      }
      case 'copy': {
        const src = args.source as string;
        const dst = args.dest as string;
        if (!src || !dst) throw new Error('source and dest are required');
        const srcPath = pathModule.isAbsolute(src) ? src : pathModule.join(workspaceDirVal, src);
        const dstPath = pathModule.isAbsolute(dst) ? dst : pathModule.join(workspaceDirVal, dst);
        await fs.mkdir(path.dirname(dstPath), { recursive: true });
        await fs.cp(srcPath, dstPath, { recursive: true, errorOnExist: false });
        return { success: true, source: src, dest: dst, workspaceDir: workspaceDirVal };
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
    const rawPath = args.path as string || '';
    const fullPath = path.isAbsolute(rawPath) ? rawPath : path.join(baseDir, rawPath);

    // 安全检查
    if (path.relative(baseDir, fullPath).startsWith('..')) {
      throw new Error('Path traversal denied: path must be within app data directory');
    }

    switch (method) {
      case 'read': {
        if (!rawPath) throw new Error('path is required');
        const content = await fs.readFile(fullPath, 'utf-8');
        const stat = await fs.stat(fullPath);
        return { content, size: stat.size, path: rawPath };
      }
      case 'write': {
        if (!rawPath) throw new Error('path is required');
        const content = args.content as string;
        if (content === undefined) throw new Error('content is required');
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, content, 'utf-8');
        return { success: true, path: rawPath };
      }
      case 'patch': {
        if (!rawPath) throw new Error('path is required');
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
        return { success: true, path: rawPath, replacements: occurrences > 1 ? occurrences : 1 };
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
        const dirPath = rawPath || '.';
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
      throw new Error('不允许访问此目录');
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

  private resolvePath(targetPath: string, baseDir: string): string | null {
    if (!targetPath || !targetPath.trim()) return null;
    return path.isAbsolute(targetPath) ? targetPath : path.join(baseDir, targetPath);
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

  private async handleWorkspaceShellMethod(
    method: string,
    args: Record<string, unknown>,
    context: { appId?: string; convId?: string }
  ): Promise<unknown> {
    switch (method) {
      case 'exec': {
        const command = args.command as string;
        if (!command) throw new Error('command is required');
        const timeout = (args.timeout as number) || 30000;
        const customCwd = args.cwd as string | undefined;

        // 从会话获取工作目录（优先使用用户传入的 cwd）
        let cwd: string | undefined = customCwd;
        if (!cwd && context.appId && context.convId) {
          const { conversationService } = await import('../services/conversation.js');
          const conv = await conversationService.getConversation(context.appId, context.convId);
          cwd = conv?.workspaceDir || undefined;
        }

        // 每次执行需要用户授权（通过表单确认）
        const toolCallId = (context as any)._toolCallId || 'direct';
        await this.handleFormMethod('requestInput', {
          title: '执行命令确认',
          description: `Agent 请求在工作目录执行命令，是否允许？`,
          fields: [
            {
              name: 'command',
              label: '即将执行的命令',
              type: 'text',
              placeholder: command,
              required: true,
              description: `${cwd ? '工作目录: ' + cwd : '工作目录未设置'}`,
            },
            {
              name: 'confirm',
              label: '允许执行',
              type: 'checkbox',
              required: true,
              options: ['我确认执行此命令'],
            },
          ],
          schema: {
            type: 'object',
            properties: {
              command: { type: 'string' },
              confirm: { type: 'array', items: { type: 'string' } },
            },
            required: ['command', 'confirm'],
          },
        } as any, { ...context, _toolCallId: toolCallId } as any);
        return { _skip: true };
      }
      default:
        throw new Error(`Unknown method: ${method}`);
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
        const { appState } = await import('../services/appState.js');
        const app = context.appId ? appState.getApp(context.appId) : null;
        const appSkillIds = app?.skills || [];
        const allSkills = await skillService.getSkills();
        const allowedSkills = allSkills.filter((s: any) => appSkillIds.includes(s.id));
        const skillsWithFiles = await Promise.all(allowedSkills.map(async (s: any) => {
          const files = await skillService.listSkillFiles(s.id).catch(() => []);
          const scripts = await skillService.listSkillScripts(s.id).catch(() => []);
          return { ...s, files, scripts };
        }));
        return { skills: skillsWithFiles };
      }
      case 'read': {
        const skillId = args.skillId as string;
        const filePath = args.path as string;
        if (!skillId || !filePath) throw new Error('skillId and path are required');
        const content = await skillService.readSkillFile(skillId, filePath);
        return { skillId, path: filePath, content };
      }
      case 'exec': {
        const skillId = args.skillId as string;
        const scriptName = args.script as string;
        const scriptArgs = (args.args as string[]) || [];
        if (!skillId || !scriptName) throw new Error('skillId and script are required');
        if (scriptName.includes('/') || scriptName.includes('\\') || scriptName.includes('..')) {
          throw new Error('Path traversal denied: script must be a filename within scripts/ directory');
        }
        const customCwd = args.cwd as string | undefined;
        let cwd: string | undefined = customCwd;
        if (!cwd && context.convId) {
          const { conversationService } = await import('../services/conversation.js');
          const conv = await conversationService.getConversation(context.appId || '', context.convId);
          if (conv?.workspaceDir) {
            cwd = conv.workspaceDir;
          } else if (context.appId) {
            const { APPS_DATA_DIR } = await import('../utils/file.js');
            const path_mod = await import('path');
            cwd = path_mod.join(APPS_DATA_DIR, context.appId || '');
          }
        }
        const output = await skillService.execSkillScript(skillId, scriptName, scriptArgs, cwd);
        return { skillId, script: scriptName, output, cwd };
      }
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }

  private async handleAppMethod(
    method: string,
    args: Record<string, unknown>,
    context: { appId?: string; convId?: string }
  ): Promise<unknown> {
    const { appState } = await import('../services/appState.js');
    const { conversationService } = await import('../services/conversation.js');

    switch (method) {
      case 'list': {
        const visibleApps = [...new Set([
          ...(context.appId ? (appState.getApp(context.appId)?.config.visibleApps || []) : []),
          ...(context.appId ? (appState.getApp(context.appId)?.meta.visibleApps || []) : []),
        ])];
        const apps = appState.getAllApps().filter(a => a.meta.id === context.appId || visibleApps.includes(a.meta.id));
        return {
          apps: apps.map(a => ({
            id: a.meta.id,
            name: a.meta.name,
            description: a.meta.description,
            type: a.meta.type,
            icon: a.meta.icon,
            supportedInputs: a.meta.supportedInputs,
          })),
        };
      }
      case 'call': {
        const targetId = args.appId as string;
        const message = args.message as string;
        const callerConvId = args.conversationId as string || context.convId;
        if (!targetId || !message) throw new Error('appId and message are required');

        const targetApp = appState.getApp(targetId);
        if (!targetApp) throw new Error(`App ${targetId} not found`);
        if (targetApp.meta.type !== 'desktop' && targetApp.meta.type !== 'background') {
          throw new Error(`App ${targetId} is not callable`);
        }

        const callId = uuidv4();
        const targetConvId = uuidv4();
        const callChain = context.appId ? [{ callerAppId: context.appId, callerConvId, callId, timestamp: new Date().toISOString() }] : undefined;

        // 继承调用者的工作目录
        let workspaceDir: string | undefined;
        if (context.appId && callerConvId) {
          const callerConv = await conversationService.getConversation(context.appId, callerConvId);
          workspaceDir = callerConv?.workspaceDir || undefined;
        }

        const newConv = await conversationService.createConversation(
          targetId, `来自 ${context.appId || '未知'} 的调用`, 'agent', callChain
        );
        if (workspaceDir) {
          await conversationService.updateConversation(targetId, newConv.id, { workspaceDir } as any);
        }

        eventBus.emit({ type: 'agent_call_start', appId: targetId, convId: targetConvId, data: {
          callerAppId: context.appId,
          callerConvId,
          callId,
          message,
          timestamp: new Date().toISOString(),
        }});

        const savedUserMsg = await conversationService.addMessage(
          targetId, newConv.id, 'user', [{ type: 'text', text: message }]
        );
        if (!savedUserMsg) throw new Error('Failed to save message');

        const { runAgentAsync } = await import('../agents/pi-agent-session.js');
        const callResult = await new Promise<string>((resolve, reject) => {
          const timeout = setTimeout(() => {
            unsubAgentEnd();
            unsubAgentError();
            reject(new Error('App call timed out'));
          }, 120000);

          const unsubAgentEnd = eventBus.subscribe(newConv.id, (event) => {
            if (event.type === 'agent_call_end_auto' && event.data.callId === callId) {
              clearTimeout(timeout);
              unsubAgentEnd();
              unsubAgentError();
              resolve(event.data.result as string || '(no output)');
            }
          });

          const unsubAgentError = eventBus.subscribe(newConv.id, (event) => {
            if (event.type === 'error') {
              clearTimeout(timeout);
              unsubAgentEnd();
              unsubAgentError();
              reject(new Error((event.data.message as string) || 'App error'));
            }
          });

          runAgentAsync(targetId, newConv.id, targetApp, [], [{ type: 'text', text: message } as any])
            .catch(err => {
              clearTimeout(timeout);
              unsubAgentEnd();
              unsubAgentError();
              reject(err);
            });
        });

        return { success: true, result: callResult, conversationId: newConv.id };
      }
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }
}

export const mcpServiceRegistry = new MCPServiceRegistry();
