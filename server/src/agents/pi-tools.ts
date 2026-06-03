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

/** 将 service.name.method 转为 LLM 兼容的 tool name（. → _） */
function safeToolName(serviceName: string, method: string): string {
  return `${serviceName.replace(/\./g, "_")}_${method}`;
}

/** 从 safeToolName 解析回 serviceName 和 method */
function parseToolName(toolName: string): { serviceName: string; method: string } {
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
 * 为指定 app 构建 AgentTool 列表
 */
export function buildPiToolsForApp(app: App): AgentTool[] {
  const allowedTools = new Set(app.meta.tools || []);
  const services = mcpServiceRegistry.getAllServices();
  const tools: AgentTool[] = [];

  for (const service of services) {
    if (allowedTools.size > 0 && !allowedTools.has(service.name)) continue;

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
            const result = await mcpServiceRegistry.callMethod(
              serviceName,
              m,
              (params as any) || {},
              { appId: app.meta.id },
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
