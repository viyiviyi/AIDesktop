/**
 * PiTools - MCP 服务适配为 pi-agent-core 的 AgentTool
 *
 * 将 AIDesktop 的 MCP 服务注册表转换为 pi-agent-core 的 AgentTool 格式。
 * 每个 MCP 服务方法转换为一个 AgentTool，按 app 可见性过滤。
 *
 * 注意：tool name 不能包含 '.'，因为某些 LLM（如 deepseek）的 function name
 * 只允许 `^[a-zA-Z0-9_-]+$` 模式。
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type { App } from "../types/index.js";
import { mcpServiceRegistry } from "../mcp/service.js";
import { mcpClientRegistry } from "../mcp/clientRegistry.js";

/** 当前正在运行的 convId，由 pi-agent-session 在执行前设置 */
let _currentConvId = '';
export function setCurrentConvId(convId: string) { _currentConvId = convId; }

/** mcp.form.requestInput 的参数 schema */
const formRequestSchema = Type.Object({
  title: Type.String({ description: '表单标题' }),
  description: Type.Optional(Type.String({ description: '表单描述说明' })),
  fields: Type.Array(Type.Object({
    name: Type.String({ description: '字段名（英文，用于数据键）' }),
    label: Type.String({ description: '字段标签（中文显示名）' }),
    type: Type.Optional(Type.Union([
      Type.Literal('text'),
      Type.Literal('textarea'),
      Type.Literal('number'),
      Type.Literal('tags'),
      Type.Literal('radio'),
      Type.Literal('checkbox'),
    ], { description: '字段类型：text(单行文本), textarea(多行文本), number(数字), tags(标签输入), radio(单选), checkbox(多选)' })),
    required: Type.Optional(Type.Boolean({ description: '是否必填' })),
    options: Type.Optional(Type.Array(Type.String(), { description: 'select/radio/checkbox 的选项列表' })),
    placeholder: Type.Optional(Type.String({ description: '输入提示文字' })),
    description: Type.Optional(Type.String({ description: '字段说明文字' })),
  }, { additionalProperties: false }), { minItems: 1, description: '表单项列表' }),
}, { additionalProperties: false, description: '向用户展示一个表单收集结构化信息' });

/** mcp.filesystem 各方法的参数 schema（仅限 apps_data 目录） */
const codeReadSchema = Type.Object({
  path: Type.String({ description: '文件路径（相对 apps_data 目录），如 server/src/types/index.ts 或 config.json；不能用于项目文件目录' }),
  offset: Type.Optional(Type.Number({ description: '从第几行开始读取（1-indexed），用于分页' })),
  limit: Type.Optional(Type.Number({ description: '最多读取多少行，用于分页' })),
  baseDir: Type.Optional(Type.String({ description: '基础目录（相对 apps_data），默认为空' })),
}, { additionalProperties: false, description: '[apps_data] 读取应用数据文件（仅限 apps_data 目录，不适用于项目代码）' });

const codeWriteSchema = Type.Object({
  path: Type.String({ description: '文件路径（相对 apps_data 目录）' }),
  content: Type.String({ description: '写入的内容' }),
  baseDir: Type.Optional(Type.String({ description: '基础目录（相对 apps_data），默认为空' })),
}, { additionalProperties: false, description: '[apps_data] 写入应用数据文件（仅限 apps_data 目录）' });

const codePatchSchema = Type.Object({
  path: Type.String({ description: '文件路径（相对 apps_data 目录）' }),
  old_string: Type.String({ description: '要替换的旧文本（必须完全匹配原始文件，含缩进和换行；使用 replace_all=true 替换所有出现）' }),
  new_string: Type.String({ description: '替换的新文本' }),
  replace_all: Type.Optional(Type.Boolean({ description: '替换所有匹配项而非仅第一个' })),
  baseDir: Type.Optional(Type.String({ description: '基础目录（相对 apps_data），默认为空' })),
}, { additionalProperties: false, description: '[apps_data] 在应用数据文件中查找替换文本' });

const codeSearchSchema = Type.Object({
  pattern: Type.String({ description: '搜索的正则表达式' }),
  file_glob: Type.Optional(Type.String({ description: '文件过滤 glob，如 "*.ts"' })),
  max_results: Type.Optional(Type.Number({ description: '最大结果数，默认 50' })),
  baseDir: Type.String({ description: '【必填】搜索的基础目录（绝对路径或相对 apps_data 的路径）' }),
}, { additionalProperties: false, description: '[apps_data] 在指定目录中搜索文本' });

const codeListSchema = Type.Object({
  path: Type.Optional(Type.String({ description: '目录路径（相对 apps_data），默认为根目录' })),
  baseDir: Type.Optional(Type.String({ description: '基础目录（相对 apps_data），默认为空' })),
}, { additionalProperties: false, description: '[apps_data] 列出应用数据目录内容' });

const codeReadSchema_w = Type.Object({
  path: Type.String({ description: '文件路径（相对工作目录或绝对路径如 /mnt/c/apps/...）' }),
  offset: Type.Optional(Type.Number({ description: '从第几行开始读取（1-indexed），用于分页' })),
  limit: Type.Optional(Type.Number({ description: '最多读取多少行，用于分页' })),
  baseDir: Type.Optional(Type.String({ description: '基础目录（相对工作目录），默认为空' })),
}, { additionalProperties: false, description: '[必需参数: path] [工作目录] 读取项目文件内容（支持 offset/limit）。path是文件路径，baseDir可选' });

const codeWriteSchema_w = Type.Object({
  path: Type.String({ description: '文件路径（相对工作目录或绝对路径如 /mnt/c/apps/...）' }),
  content: Type.String({ description: '写入的内容' }),
  baseDir: Type.Optional(Type.String({ description: '基础目录（相对工作目录），默认为空' })),
}, { additionalProperties: false, description: '[必需参数: path, content] [工作目录] 写入项目文件（自动创建父目录）。path是文件路径' });

const codePatchSchema_w = Type.Object({
  path: Type.String({ description: '文件路径（相对工作目录或绝对路径如 /mnt/c/apps/...）' }),
  old_string: Type.String({ description: '要替换的旧文本（必须完全匹配原始文件，含缩进和换行；使用 replace_all=true 替换所有出现）' }),
  new_string: Type.String({ description: '替换的新文本' }),
  replace_all: Type.Optional(Type.Boolean({ description: '替换所有匹配项而非仅第一个' })),
  baseDir: Type.Optional(Type.String({ description: '基础目录（相对工作目录），默认为空' })),
}, { additionalProperties: false, description: '[必需参数: path, old_string, new_string] [工作目录] 在项目文件中查找替换文本' });

const codeSearchSchema_w = Type.Object({
  pattern: Type.String({ description: '搜索的正则表达式' }),
  file_glob: Type.Optional(Type.String({ description: '文件过滤 glob，如 "*.ts"' })),
  max_results: Type.Optional(Type.Number({ description: '最大结果数，默认 50' })),
  baseDir: Type.String({ description: '【必填】搜索的基础目录（绝对路径或相对工作目录的路径）' }),
}, { additionalProperties: false, description: '[必需参数: pattern, baseDir] [工作目录] 在指定目录中搜索文本。baseDir是搜索目录路径' });

const codeListSchema_w = Type.Object({
  path: Type.Optional(Type.String({ description: '目录路径（相对工作目录或绝对路径如 /mnt/c/apps/...），默认为工作目录根' })),
  baseDir: Type.Optional(Type.String({ description: '基础目录（相对工作目录），默认为空' })),
}, { additionalProperties: false, description: '[可选参数: path] [工作目录] 列出项目目录内容。不传path则列出工作目录根' });

/** 将 service.name.method 转为 LLM 兼容的 tool name（. → _） */
function safeToolName(serviceName: string, method: string): string {
  return `${serviceName.replace(/\./g, "_")}_${method}`.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/** 从 safeToolName 解析回 serviceName 和 method */
export function parseToolName(toolName: string): { serviceName: string; method: string } {
  // 格式: mcp_filesystem_read
  // 需要找到最后一个 _ 作为 method 分隔符
  const lastUnderscore = toolName.lastIndexOf("_");
  if (lastUnderscore === -1) {
    // fallback: 尝试按 . 解析
    const dot = toolName.lastIndexOf(".");
    if (dot === -1) throw new Error(`Invalid tool name: ${toolName}`);
    return { serviceName: toolName.substring(0, dot), method: toolName.substring(dot + 1) };
  }
  const method = toolName.substring(lastUnderscore + 1);
  const serviceKey = toolName.substring(0, lastUnderscore); // mcp_filesystem
  // 把 _ 转回 .
  const serviceName = serviceKey.replace(/_/g, ".");
  return { serviceName, method };
}

/**
 * 为指定 app 构建 AgentTool 列表（2026-07 重构）
 *
 * 注入以下三类工具：
 *   系统维护工具 (admin) — 从 allowedTools 过滤
 *   系统通用工具 (builtin) — 从 allowedTools 过滤
 *   外部 MCP 工具 — 从 allowedTools 过滤
 *
 * workspace 工具和动态配置工具由独立的函数注入。
 */
export function buildPiToolsForApp(app: App): AgentTool[] {
  const allowedTools = new Set([...(app.config.tools || []), ...(app.meta.tools || [])]);
  const services = mcpServiceRegistry.getAllServices();
  const tools: AgentTool[] = [];

  // 如果 allowedTools 为空，不注入任何工具
  if (allowedTools.size === 0) return tools;

  for (const service of services) {
    // 只注入 admin 和 builtin 类型的服务
    if (service.category !== 'admin' && service.category !== 'builtin') continue;
    if (!allowedTools.has(service.name)) continue;

    for (const method of service.methods) {
      const name = safeToolName(service.name, method);

      // mcp.form.requestInput 需要完整的参数 schema
      // mcp.filesystem 的 patch/search 需要完整参数 schema
      let parameters = Type.Object({}, { additionalProperties: true });
      if (service.name === 'mcp.form' && method === 'requestInput') {
        parameters = formRequestSchema;
      } else if (service.name === 'mcp.filesystem') {
        const schemaMap: Record<string, any> = {
          read: codeReadSchema,
          write: codeWriteSchema,
          patch: codePatchSchema,
          search: codeSearchSchema,
          list: codeListSchema,
        };
        if (schemaMap[method]) parameters = schemaMap[method];
      }

      tools.push({
        name,
        label: `${service.name} - ${method}`,
        description: `${method} - ${service.description}`,
        parameters,
        execute: async (toolCallId, params, signal, onUpdate) => {
          try {
            const { serviceName, method: m } = parseToolName(name);
            const enrichedParams = {
              ...(params as any) || {},
              _toolCallId: toolCallId,
            };
            const result = await mcpServiceRegistry.callMethod(
              serviceName,
              m,
              enrichedParams,
              { appId: app.meta.id, convId: _currentConvId },
            );
            return {
              content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
              details: result,
            };
          } catch (error) {
            return {
              content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
              details: null,
            };
          }
        },
      });
    }
  }

  // 为外部 MCP 工具的每个启用的工具生成独立的 AgentTool
  const externalTools = buildExternalMcpAgentTools(allowedTools);
  tools.push(...externalTools);

  return tools;
}

/**
 * 构建外部 MCP 工具的 AgentTool
 * 只生成在 allowedTools 中的工具
 */
function buildExternalMcpAgentTools(allowedTools: Set<string>): AgentTool[] {
  const tools: AgentTool[] = [];

  // 如果 allowedTools 为空（未配置任何工具），不允许任何外部工具
  // 只有显式勾选了 mcp.external 或具体的外部工具才放行
  if (allowedTools.size === 0) return tools;
  const hasExternalAccess = allowedTools.has('mcp.external');
  if (!hasExternalAccess && ![...allowedTools].some(k => k.startsWith('external:'))) return tools;

  const clients = mcpClientRegistry.listClients();
  for (const client of clients) {
    if (!client.isConnected()) continue;

    const connectionId = client.getConnectionId();
    const connName = client.getServerInfo()?.name || connectionId;
    const safeConnName = connName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const connTools = client.getTools();

    for (const tool of connTools) {
      // 给 AI Agent 的名字：mcp_连接名_工具名
      const safeToolName = (tool.name || tool.name).replace(/[^a-zA-Z0-9_-]/g, '_');
      const agentToolName = `mcp_${safeConnName}_${safeToolName}`;

      // 在 app config 中存储的格式也用连接名，不用 UUID
      const appToolKey = `external:${safeConnName}:${tool.name}`;
      if (allowedTools.size > 0 && !allowedTools.has(appToolKey) && !allowedTools.has('mcp.external') && !allowedTools.has('*')) continue;

      tools.push({
        name: agentToolName,
        label: `${connName} - ${tool.name}`,
        description: tool.description || `${connName} tool: ${tool.name}`,
        parameters: tool.inputSchema && typeof tool.inputSchema === 'object' && Object.keys(tool.inputSchema).length > 0
          ? Type.Object({}, { additionalProperties: true }) // 使用宽松 schema 避免验证失败
          : Type.Object({}, { additionalProperties: true }),
        execute: async (toolCallId, params, signal, onUpdate) => {
          try {
            const result = await mcpClientRegistry.callTool(connectionId, tool.name, (params as any) || {});
            const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
            return {
              content: [{ type: "text" as const, text }],
              details: result,
            };
          } catch (error) {
            return {
              content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
              details: null,
            };
          }
        },
      });
    }
  }

  return tools;
}

/**
 * 所有 app 可用的工具
 */
export function buildPiTools(): AgentTool[] {
  const services = mcpServiceRegistry.getAllServices();
  const tools: AgentTool[] = [];

  for (const service of services) {
    for (const method of service.methods) {
      const name = safeToolName(service.name, method);
      tools.push({
        name,
        label: `${service.name} - ${method}`,
        description: `${method} - ${service.description}`,
        parameters: Type.Object({}, { additionalProperties: true }),
        execute: async (toolCallId, params, signal, onUpdate) => {
          try {
            const { serviceName, method: m } = parseToolName(name);
            const result = await mcpServiceRegistry.callMethod(serviceName, m, (params as any) || {}, { appId: undefined });
            return {
              content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
              details: result,
            };
          } catch (error) {
            return {
              content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
              details: null,
            };
          }
        },
      });
    }
  }

  return tools;
}

/**
 * 执行 MCP 工具调用并返回文本结果
 */
export async function executePiTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const { serviceName, method } = parseToolName(toolName);
  const result = await mcpServiceRegistry.callMethod(serviceName, method, args, {});
  return JSON.stringify(result, null, 2);
}

/** workspace 类型服务的参数 schema 映射 */
const workspaceSchemaMap: Record<string, Record<string, any>> = {
  'workspace.code': {
    read: codeReadSchema_w,
    write: codeWriteSchema_w,
    patch: codePatchSchema_w,
    search: codeSearchSchema_w,
    list: codeListSchema_w,
  },
};

/**
 * 为指定 app 和会话构建 workspace 类型工具的 AgentTool 列表
 * workspace 工具需要会话上下文（工作目录、convId）
 */
export function buildWorkspaceTools(app: App, convId: string): AgentTool[] {
  const allowedTools = new Set([...(app.config.tools || []), ...(app.meta.tools || [])]);
  const services = mcpServiceRegistry.getAllServices();
  const tools: AgentTool[] = [];

  // 没有配置任何工具时，不注入任何 workspace 工具
  if (allowedTools.size === 0) return tools;

  for (const service of services) {
    if (service.category !== 'workspace') continue;
    // 检查 workspace 工具是否在允许列表中
    if (!allowedTools.has(service.name)) continue;

    for (const method of service.methods) {
      const name = safeToolName(service.name, method);
      let parameters = Type.Object({}, { additionalProperties: true });
      if (workspaceSchemaMap[service.name]?.[method]) {
        parameters = workspaceSchemaMap[service.name][method];
      }

      tools.push({
        name,
        label: `${service.name} - ${method}`,
        description: `${method} - ${service.description}`,
        parameters,
        execute: async (toolCallId, params, signal, onUpdate) => {
          try {
            const { serviceName, method: m } = parseToolName(name);
            const enrichedParams = {
              ...(params as any) || {},
              _toolCallId: toolCallId,
            };
            const result = await mcpServiceRegistry.callMethod(
              serviceName, m, enrichedParams,
              { appId: app.meta.id, convId },
            );
            return {
              content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
              details: result,
            };
          } catch (error) {
            return {
              content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
              details: null,
            };
          }
        },
      });
    }
  }

  return tools;
}
/**
 * 构建动态配置工具列表（2026-07 新增）
 *
 * 这些工具不由 meta.tools 控制，而是条件满足时自动注入到 AI 工具列表：
 *   技能工具 — 当 app 配置有技能时注入 mcp_skill_list/read/exec
 *   应用访问工具 — 当 app 配置有可见应用时注入 mcp_app_list/call
 */
export function buildDynamicConfigTools(app: App): AgentTool[] {
  const tools: AgentTool[] = [];
  const appSkillIds = [...(app.config.skills || [])];

  // 技能工具：当 app 有授权的技能时自动注入
  if (appSkillIds.length > 0) {
    tools.push({
      name: 'mcp_skill_list',
      label: 'mcp.skill - list',
      description: 'list - 获取当前应用已授权的技能列表，包括技能中的文件列表和可执行脚本',
      parameters: Type.Object({}, { additionalProperties: false, description: '获取可用的技能列表' }),
      execute: async (toolCallId, params, signal, onUpdate) => {
        try {
          const result = await mcpServiceRegistry.callMethod('mcp.skill', 'list', {}, { appId: app.meta.id });
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }], details: result };
        } catch (error) {
          return { content: [{ type: 'text' as const, text: 'Error: ' + (error instanceof Error ? error.message : String(error)) }], details: null };
        }
      },
    });
    tools.push({
      name: 'mcp_skill_read',
      label: 'mcp.skill - read',
      description: 'read - 读取技能中的任意文件内容，需要指定技能 ID 和文件路径',
      parameters: Type.Object({
        skillId: Type.String({ description: '技能 ID' }),
        path: Type.String({ description: '文件相对于技能目录的路径' }),
      }, { additionalProperties: false }),
      execute: async (toolCallId, params, signal, onUpdate) => {
        try {
          const result = await mcpServiceRegistry.callMethod('mcp.skill', 'read', (params as any) || {}, { appId: app.meta.id });
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }], details: result };
        } catch (error) {
          return { content: [{ type: 'text' as const, text: 'Error: ' + (error instanceof Error ? error.message : String(error)) }], details: null };
        }
      },
    });
    tools.push({
      name: 'mcp_skill_exec',
      label: 'mcp.skill - exec',
      description: 'exec - 执行技能中的脚本，可指定 cwd 工作目录（默认使用会话工作目录或 apps_data 目录）',
      parameters: Type.Object({
        skillId: Type.String({ description: '技能 ID' }),
        script: Type.String({ description: '脚本文件名（必须在 scripts/ 目录下）' }),
        args: Type.Optional(Type.Array(Type.String(), { description: '脚本参数列表' })),
        cwd: Type.Optional(Type.String({ description: '脚本工作目录（绝对路径），默认使用会话工作目录或 apps_data/appId 目录' })),
      }, { additionalProperties: false }),
      execute: async (toolCallId, params, signal, onUpdate) => {
        try {
          const result = await mcpServiceRegistry.callMethod('mcp.skill', 'exec', (params as any) || {}, { appId: app.meta.id, convId: _currentConvId });
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }], details: result };
        } catch (error) {
          return { content: [{ type: 'text' as const, text: 'Error: ' + (error instanceof Error ? error.message : String(error)) }], details: null };
        }
      },
    });
  }

  // 应用访问工具：当 app 有可见应用时自动注入
  const visibleApps = [...new Set([...(app.config.visibleApps || []), ...(app.meta.visibleApps || [])])];
  if (visibleApps.length > 0) {
    tools.push({
      name: 'mcp_app_list',
      label: 'mcp.app - list',
      description: 'list - 获取当前应用可见的应用列表（可调用的其他应用）',
      parameters: Type.Object({}, { additionalProperties: false, description: '获取可用的应用列表' }),
      execute: async (toolCallId, params, signal, onUpdate) => {
        try {
          const result = await mcpServiceRegistry.callMethod('mcp.app', 'list', {}, { appId: app.meta.id });
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }], details: result };
        } catch (error) {
          return { content: [{ type: 'text' as const, text: 'Error: ' + (error instanceof Error ? error.message : String(error)) }], details: null };
        }
      },
    });
    tools.push({
      name: 'mcp_app_call',
      label: 'mcp.app - call',
      description: 'call - 调用另一个应用完成任务，需要指定目标应用 ID 和消息内容。被调用应用会继承调用方的工作目录',
      parameters: Type.Object({
        appId: Type.String({ description: '目标应用 ID' }),
        message: Type.String({ description: '发送给应用的文本消息' }),
        conversationId: Type.Optional(Type.String({ description: '调用方的会话 ID（可选）' })),
      }, { additionalProperties: false }),
      execute: async (toolCallId, params, signal, onUpdate) => {
        try {
          const result = await mcpServiceRegistry.callMethod('mcp.app', 'call', (params as any) || {}, { appId: app.meta.id, convId: _currentConvId });
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }], details: result };
        } catch (error) {
          return { content: [{ type: 'text' as const, text: 'Error: ' + (error instanceof Error ? error.message : String(error)) }], details: null };
        }
      },
    });
  }

  return tools;
}
