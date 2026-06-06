/**
 * PiAgentSession - 基于 pi-agent-core 的 Agent 会话封装
 */

import {
  type AgentMessage as PiMsg,
  Agent,
} from "@earendil-works/pi-agent-core";
import {
  type Api,
  type Model,
  streamSimple,
} from "@earendil-works/pi-ai";
import type { App, Message as AdMsg, Content, ToolResultMeta } from "../types/index.js";
import { appLoader } from "../services/appLoader.js";
import { settingsService } from "../services/settings.js";
import { findModel } from "../models/pi-adapter.js";
import { buildPiToolsForApp } from "./pi-tools.js";
import { serverLogger } from "../utils/logger.js";
import { DATA_DIR } from "../utils/file.js";
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

function adMsgToPiMsg(m: AdMsg, appId: string, provider: string, modelId: string): PiMsg | null {
  const ts = new Date(m.timestamp).getTime();
  if (m.role === "user") {
    const text = m.content.filter((c): c is { type: "text"; text: string } => c.type === "text").map((c) => c.text).join("\n");
    return { role: "user", content: text || "", timestamp: ts } as any;
  }
  if (m.role === "assistant") {
    const textBlocks = m.content.filter((c): c is { type: "text"; text: string } => c.type === "text").map((c) => c.text);
    const toolCallBlocks = m.content.filter((c): c is any => (c as any).type === "toolCall");

    // 构建 pi assistant 消息的 content
    const content: any[] = [];
    if (textBlocks.length) content.push({ type: "text", text: textBlocks.join("") });
    for (const tc of toolCallBlocks) {
      content.push({
        type: "toolCall",
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments as Record<string, any>,
      });
    }
    // 保证 content 不为空，避免 pi-agent-core 内部行为异常
    if (content.length === 0) content.push({ type: "text", text: "" });

    return {
      role: "assistant", content,
      api: "openai-responses", provider, model: modelId,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop", timestamp: ts,
    } as any;
  }
  if (m.role === "toolResult") {
    // 从存储格式重建 pi 的 toolResult 消息
    const meta = m.toolResultMeta;
    if (!meta) return null;

    const text = m.content.filter((c): c is { type: "text"; text: string } => c.type === "text").map((c) => c.text).join("");

    return {
      role: "toolResult",
      toolCallId: meta.toolCallId,
      toolName: meta.toolName,
      content: text || "",
      isError: meta.isError,
      timestamp: ts,
    } as any;
  }
  return null;
}

function buildSystemPrompt(app: App): string {
  let prompt = app.appMd || "";
  if (app.meta.visibleApps && app.meta.visibleApps.length > 0) {
    const names = app.meta.visibleApps.map((id) => {
      const a = appLoader.getApp(id);
      return a ? `${a.meta.name} (${id})` : id;
    });
    prompt += `\n\n## 可调用的 Agent\n你可以通过 mcp.agent.call 调用以下 Agent：${names.join("、")}`;
  }
  return prompt;
}

export type TextStreamCallback = (text: string) => void;

export class PiAgentSession {
  readonly appId: string;
  agent!: Agent;
  model!: Model<Api>;
  private apiKey: string | undefined;
  private textStreamCbs: TextStreamCallback[] = [];

  constructor(appId: string) {
    this.appId = appId;
  }

  /** 注册逐 token 文本回调（用于 SSE） */
  onText(cb: TextStreamCallback): () => void {
    this.textStreamCbs.push(cb);
    return () => {
      this.textStreamCbs = this.textStreamCbs.filter(c => c !== cb);
    };
  }

  async init(app: App): Promise<void> {
    const modes = await settingsService.getModes();
    const defaultModelConfig = await settingsService.getDefaultModel();

    let providerId = defaultModelConfig.providerId;
    let modelId = defaultModelConfig.modelId;
    if (app.meta.models && app.meta.models.length > 0) {
      const appProvider = modes.providers.find(p => p.id === app.meta.models![0].provider);
      if (appProvider && appProvider.enabled !== false) {
        providerId = app.meta.models[0].provider;
        modelId = app.meta.models[0].model;
      }
    }
    if (!providerId || !modelId) throw new Error(`No model configured for app "${app.meta.id}".`);

    const providerConfig = modes.providers.find((p) => p.id === providerId);
    if (!providerConfig) throw new Error(`Provider "${providerId}" not found.`);
    const modelObj = findModel(modes.providers, providerId, modelId);
    if (!modelObj) throw new Error(`Model "${modelId}" not found.`);

    this.model = modelObj;
    this.apiKey = providerConfig.apiKey;
    if (providerConfig.baseUrl) this.model = { ...this.model, baseUrl: providerConfig.baseUrl };

    const tools = buildPiToolsForApp(app);
    const systemPrompt = buildSystemPrompt(app);

    this.agent = new Agent({
      initialState: { model: this.model as any, systemPrompt },
      streamFn: (model, context, options) => {
        const textPreview = context.messages.filter((m: any) => m.role === "user").slice(-1).map((m: any) => typeof m.content === "string" ? m.content.slice(0, 100) : "").join("");
        serverLogger.ai(`${model.provider}/${model.id}`, `>>> ${textPreview}`, { messages: context.messages.length });
        const start = Date.now();
        const stream = streamSimple(model, context, { ...options, apiKey: this.apiKey });
        stream.result().then((result: any) => {
          const text = (result?.content ?? []).filter((c: any) => c?.type === "text").map((c: any) => c.text).join("").slice(0, 200);
          serverLogger.ai(`${model.provider}/${model.id}`, `<<< (${Date.now() - start}ms, ${result?.stopReason || "?"})`, { stopReason: result?.stopReason, errorMessage: result?.errorMessage, text: text.slice(0, 300) });
        }).catch((err: any) => {
          serverLogger.error('ai', `${model.provider}/${model.id}`, `FAILED: ${err?.message || err}`);
        });
        return stream;
      },
    });

    if (tools.length > 0) this.agent.state.tools = tools as any;
  }

  syncHistory(msgs: AdMsg[]): void {
    const history = msgs.length > 0 && msgs[msgs.length - 1]?.role === "user" ? msgs.slice(0, -1) : msgs;
    const piMsgs: PiMsg[] = [];
    for (const m of history) {
      const c = adMsgToPiMsg(m, this.appId, this.model.provider, this.model.id);
      if (c) piMsgs.push(c);
    }
    this.agent.state.messages = piMsgs as any;
  }

  async sendMessage(convId: string, conversationMessages: AdMsg[], userContent: Content[]): Promise<AdMsg> {
    this.syncHistory(conversationMessages);
    const userText = userContent.filter((c): c is { type: "text"; text: string } => c.type === "text").map((c) => c.text).join("\n");
    if (!userText.trim()) throw new Error("No text in user message");
    await this.agent.prompt(userText);
    const msgs = this.agent.state.messages as any[];
    const lastAssistant = [...msgs].reverse().find((m: any) => m.role === "assistant");
    const finalText = lastAssistant?.content?.filter((c: any) => c?.type === "text" && c.text).map((c: any) => c.text).join("") || "(empty)";
    return { id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, role: "assistant", content: [{ type: "text", text: finalText }], timestamp: new Date().toISOString() };
  }

  async *streamMessage(convId: string, conversationMessages: AdMsg[], userText: string): AsyncGenerator<string, void, unknown> {
    this.syncHistory(conversationMessages);
    if (!userText.trim()) throw new Error("No text in user message");
    let fullText = "";
    const unsub = this.agent.subscribe((event) => {
      if (event.type === "message_update") {
        const m = (event as any).message;
        const texts = (m?.content ?? []).filter((c: any) => c?.type === "text" && c.text).map((c: any) => c.text);
        if (texts.length) fullText = texts.join("");
      }
    });
    try {
      await this.agent.prompt(userText);
      if (fullText) { const lines = fullText.split(/(?<=\n)/); for (const l of lines) yield l; }
    } finally { unsub(); }
  }
}

export class PiAgentManager {
  private sessions = new Map<string, PiAgentSession>();

  async getOrCreate(appId: string, app: App): Promise<PiAgentSession> {
    let s = this.sessions.get(appId);
    if (!s) { s = new PiAgentSession(appId); await s.init(app); this.sessions.set(appId, s); }
    return s;
  }
  get(appId: string): PiAgentSession | undefined { return this.sessions.get(appId); }
  destroy(appId: string): void { this.sessions.delete(appId); }
  destroyAll(): void { this.sessions.clear(); }
}

export const piAgentManager = new PiAgentManager();

/**
 * 后台异步运行 agent，所有事件推送到 EventBus
 * 供 conversations.ts 和 mcp/service.ts 共享使用
 */
export async function runAgentAsync(
  appId: string,
  convId: string,
  app: any,
  existingMessages: any[],
  userContent: any[],
): Promise<void> {
  const { eventBus } = await import('../services/eventBus.js');
  const { conversationService } = await import('../services/conversation.js');

  const fullHistory = [...existingMessages, { role: 'user', content: userContent }];
  const session = await piAgentManager.getOrCreate(appId, app);

  const unsub = session.agent.subscribe((event: any) => {
    const emit = (type: string, data: Record<string, unknown>) => {
      eventBus.emit({ type: type as any, appId, convId, data });
    };

    switch (event.type) {
      case 'turn_start':
        emit('thinking', { text: '思考中...' });
        break;
      case 'message_start':
        if (event.message.role === 'assistant') {
          emit('message_start', { role: event.message.role, content: event.message.content, id: String(event.message.id) });
        }
        break;
      case 'message_update':
        if (event.message.role === 'assistant') {
          emit('message_update', { content: event.message.content });
        }
        break;
      case 'message_end':
        if (event.message.role === 'assistant') {
          emit('message_end', { id: String(event.message.id), content: event.message.content });
        }
        break;
      case 'tool_execution_start':
        emit('tool_call', { toolCallId: event.toolCallId, toolName: event.toolName, args: event.args });
        break;
      case 'tool_execution_end':
        emit('tool_result', { toolCallId: event.toolCallId, toolName: event.toolName, result: event.result, isError: event.isError });
        break;
    }
  });

  const unsub2 = session.onText((text: string) => {
    eventBus.emit({ type: 'text_chunk', appId, convId, data: { text } });
  });

  try {
    session.syncHistory(fullHistory);
    const userText = userContent
      .filter((c: any): c is { type: 'text'; text: string } => c.type === 'text')
      .map((c: any) => c.text)
      .join('\n');
    if (!userText.trim()) throw new Error('No text in user message');

    await session.agent.prompt(userText);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    eventBus.emit({ type: 'error', appId, convId, data: { message: msg } });
  } finally {
    unsub();
    unsub2();
  }

  // 将 pi 的新消息转换为持久化消息保存
  const piMessages = session.agent.state.messages;
  const existingCount = fullHistory.length - 1; // 减去我们加的 user
  const newPiMessages = piMessages.slice(existingCount);

  await saveNewMessages(appId, convId, newPiMessages, conversationService);

  eventBus.emit({ type: 'done', appId, convId, data: {} });
}

/**
 * 将 pi 新产生的消息转换为持久化格式保存。
 *
 * pi 的消息顺序：一条 assistant → N 条 toolResult → 下一条 assistant
 * 我们按 pi 原始序列分开保存：
 *   - assistant 消息：content 中只含 text + toolCall blocks；role='assistant'
 *   - toolResult 消息：role='toolResult'，content 中只含 text；meta 信息在 toolResultMeta 中
 *
 * 前端渲染时按顺序逐个消息渲染即可，toolResult 消息渲染为 tool result 卡片。
 */
async function saveNewMessages(
  appId: string,
  convId: string,
  piMessages: any[],
  convService: any,
): Promise<void> {
  for (const msg of piMessages) {
    if (msg.role === "user") continue;

    if (msg.role === "assistant") {
      const content: Content[] = [];

      for (const block of (msg.content || [])) {
        if (block.type === "text") {
          content.push({ type: "text", text: block.text });
        } else if (block.type === "thinking") {
          content.push({ type: "thinking", text: block.thinking || block.text || "" });
        } else if (block.type === "toolCall") {
          const processedArgs = await replaceLargeContentWithFileRef(block.arguments, appId, convId);
          content.push({
            type: "toolCall",
            id: block.id,
            name: block.name,
            arguments: processedArgs as Record<string, unknown>,
          } as any);
        }
      }

      if (content.length > 0) {
        await convService.addMessage(appId, convId, "assistant", content);
      }
    } else if (msg.role === "toolResult") {
      // toolResult 存为独立消息，role='toolResult'
      const processedResult = await replaceLargeContentWithFileRef(
        { content: msg.content, details: msg.details },
        appId, convId,
      );
      const toolResultMeta: ToolResultMeta = {
        toolCallId: msg.toolCallId,
        toolName: msg.toolName || "",
        isError: msg.isError || false,
      };

      // 以 toolResult 角色保存，content 中的文本转为 text block（如果需要）
      const resultContent: Content[] = [];
      if (msg.content) {
        const text = typeof msg.content === 'string' ? msg.content
          : Array.isArray(msg.content) ? msg.content.filter((c: any) => c?.type === 'text').map((c: any) => c.text).join('')
          : JSON.stringify(msg.content);
        if (text) {
          resultContent.push({ type: "text", text: text });
        }
      }

      // 保存 toolResult 消息（带 toolResultMeta）
      const saveMsg = await convService.addMessage(appId, convId, "toolResult" as any, resultContent);
      if (saveMsg) {
        // 追加 toolResultMeta
        const conv = await convService.getConversation(appId, convId);
        if (conv) {
          const savedMsg = conv.messages.find((m: any) => m.id === saveMsg.id);
          if (savedMsg) {
            savedMsg.toolResultMeta = toolResultMeta;
            await convService.updateConversation(appId, convId, { messages: conv.messages } as any);
          }
        }
      }
    }
  }
}

/**
 * 将大文件内容替换为文件路径引用，以便后续加载。
 * 如果 data 中某字段值是长字符串（含换行或超过 threshold），
 * 将其存储为 { _fileRef: '<appId>/<convId>/<uuid>.txt', _originalSize: N }，
 * 并在目标路径写入实际内容。
 */
async function replaceLargeContentWithFileRef(
  data: unknown,
  appId: string,
  convId: string,
  threshold: number = 500,
): Promise<unknown> {
  if (!data) return data;
  const raw = JSON.stringify(data);
  if (raw.length <= threshold) return data;

  const obj = typeof data === 'object' && data !== null && !Array.isArray(data)
    ? data as Record<string, unknown>
    : { value: data };

  async function processValue(v: unknown, key: string): Promise<unknown> {
    if (typeof v === 'string' && (v.length > threshold || v.includes('\n'))) {
      const uuid = crypto.randomUUID();
      const relPath = `${appId}/${convId}/${uuid}.txt`;
      const absDir = path.join(DATA_DIR, 'apps_data', appId, 'conversations', 'attachments');
      const absPath = path.join(absDir, `${uuid}.txt`);
      try {
        await fs.mkdir(absDir, { recursive: true });
        await fs.writeFile(absPath, v, 'utf-8');
        return { _fileRef: relPath, _originalSize: v.length };
      } catch {
        return v;
      }
    }
    if (Array.isArray(v)) {
      return Promise.all(v.map((item, i) => processValue(item, `${key}[${i}]`)));
    }
    if (typeof v === 'object' && v !== null) {
      const result: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        result[k] = await processValue(val, `${key}.${k}`);
      }
      return result;
    }
    return v;
  }

  const processed: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    processed[key] = await processValue(val, key);
  }
  return processed;
}
