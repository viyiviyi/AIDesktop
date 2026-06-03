/**
 * PiAdapter - Pi AI and Agent Core 桥接层
 *
 * 将 AIDesktop 的模型提供商/模型配置转换为 pi-ai 和 pi-agent-core 的格式。
 * 支持将 modes.json 中的 provider 配置映射到 pi-ai 的 Model<Api> 对象。
 *
 * API 类型映射:
 *   openai   -> openai-responses
 *   anthropic -> anthropic-messages
 *   custom   -> openai-responses (通常兼容 OpenAI)
 *   hermes   -> openai-responses (Hermes 兼容 OpenAI)
 */

import type { Api, Model, Provider } from "@earendil-works/pi-ai";
import type { ApiCompatType, ModelProvider } from "../types/index.js";

/**
 * 将 AIDesktop 的 apiType 映射到 pi-ai 的 Api
 */
export function convertApiType(apiType: ApiCompatType): Api {
  switch (apiType) {
    case "openai":
      return "openai-completions";
    case "anthropic":
      return "anthropic-messages";
    case "custom":
      return "openai-completions";
    default:
      return "openai-completions";
  }
}

/**
 * 将 AIDesktop 的 ModelProvider 配置转为 pi-ai 的 Model 对象。
 * 每个模型生成一个 Model 实例。
 */
export function convertProviderToModels(
  providerConfig: ModelProvider,
): Model<Api>[] {
  const api = convertApiType(providerConfig.apiType);
  const provider = providerConfig.id as Provider;

  return (providerConfig.models || []).map((m) => {
    const baseUrl = providerConfig.baseUrl || getDefaultBaseUrl(api);
    const maxTokens = m.maxTokens || 128000;

    const model: Model<Api> = {
      id: m.id,
      name: m.name || m.id,
      api,
      provider,
      baseUrl,
      contextWindow: maxTokens,
      maxTokens,
      reasoning: false,
      input: [],
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
      },
    };

    return model;
  });
}

/**
 * 从 provider 配置中找到指定 modelId 的 Model 对象
 */
export function findModel(
  providers: ModelProvider[],
  providerId: string,
  modelId: string,
): Model<Api> | null {
  const provider = providers.find((p) => p.id === providerId);
  if (!provider) return null;
  const models = convertProviderToModels(provider);
  return models.find((m) => m.id === modelId) || models[0] || null;
}

/**
 * 获取默认的 baseUrl
 */
function getDefaultBaseUrl(api: Api): string {
  switch (api) {
    case "openai-responses":
      return "https://api.openai.com/v1";
    case "anthropic-messages":
      return "https://api.anthropic.com/v1";
    default:
      return "https://api.openai.com/v1";
  }
}

/**
 * 将 AIDesktop 消息格式转换为 pi-ai Message 格式
 */
export function convertMessage(
  msg: import("../types/index.js").Message,
): import("@earendil-works/pi-ai").Message {
  const timestamp = new Date(msg.timestamp).getTime();

  if (msg.role === "system") {
    // pi-ai 使用 user role + system prompt 或 assistant role
    // system 消息当作 user 消息处理
    const text = msg.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("\n");

    return {
      role: "user",
      content: text,
      timestamp,
    } as import("@earendil-works/pi-ai").UserMessage;
  }

  if (msg.role === "user") {
    const textContent = msg.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text);

    const imageContents = msg.content
      .filter(
        (c): c is { type: "image"; url: string } => c.type === "image",
      )
      .map((c) => ({
        type: "image" as const,
        data: c.url.startsWith("data:")
          ? c.url.split(",")[1] || c.url
          : c.url,
        mimeType: c.url.startsWith("data:image/")
          ? c.url.split(";")[0].replace("data:", "")
          : "image/png",
      }));

    const content: (
      | import("@earendil-works/pi-ai").TextContent
      | import("@earendil-works/pi-ai").ImageContent
    )[] = [
      ...textContent.map((t) => ({
        type: "text" as const,
        text: t,
      })),
      ...imageContents,
    ];

    return {
      role: "user",
      content: content.length === 1 && content[0]?.type === "text"
        ? content[0].text
        : content,
      timestamp,
    } as import("@earendil-works/pi-ai").UserMessage;
  }

  if (msg.role === "assistant") {
    const text = msg.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("");

    const content: import("@earendil-works/pi-ai").TextContent[] = text
      ? [{ type: "text", text }]
      : [];

    // 如果有 tool calls，添加到 content
    if (msg.toolCalls && msg.toolCalls.length > 0) {
      for (const tc of msg.toolCalls) {
        content.push({
          type: "toolCall" as any,
          id: tc.id,
          name: tc.method || tc.tool,
          arguments: tc.args as Record<string, any>,
        } as any);
      }
    }

    return {
      role: "assistant",
      content: content.length === 0
        ? [{ type: "text", text: "" }]
        : content,
      api: "openai-responses",
      provider: "unknown",
      model: "unknown",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0,
        },
      },
      stopReason: "stop",
      timestamp,
    } as import("@earendil-works/pi-ai").AssistantMessage;
  }

  // fallback: 当作 user message
  const text = msg.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");

  return {
    role: "user",
    content: text,
    timestamp,
  } as import("@earendil-works/pi-ai").UserMessage;
}
