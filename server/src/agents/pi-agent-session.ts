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
import type { App, Message as AdMsg, Content } from "../types/index.js";
import { appLoader } from "../services/appLoader.js";
import { settingsService } from "../services/settings.js";
import { findModel } from "../models/pi-adapter.js";
import { buildPiToolsForApp } from "./pi-tools.js";
import { serverLogger } from "../utils/logger.js";

function adMsgToPiMsg(m: AdMsg, appId: string, provider: string, modelId: string): PiMsg | null {
  const ts = new Date(m.timestamp).getTime();
  if (m.role === "user") {
    const text = m.content.filter((c): c is { type: "text"; text: string } => c.type === "text").map((c) => c.text).join("\n");
    return { role: "user", content: text || "", timestamp: ts } as any;
  }
  if (m.role === "assistant") {
    const text = m.content.filter((c): c is { type: "text"; text: string } => c.type === "text").map((c) => c.text).join("");
    return {
      role: "assistant", content: text ? [{ type: "text", text }] : [{ type: "text", text: "" }],
      api: "openai-responses", provider, model: modelId,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop", timestamp: ts,
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
        emit('message_start', { role: event.message.role, content: event.message.content, id: String(event.message.id) });
        break;
      case 'message_update':
        emit('message_update', { content: event.message.content });
        break;
      case 'message_end':
        emit('message_end', { id: String(event.message.id), content: event.message.content });
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

  // 保存 assistant 消息
  const lastMsg = session.agent.state.messages[session.agent.state.messages.length - 1] as any;
  if (lastMsg && lastMsg.role === 'assistant') {
    const text = (lastMsg.content || [])
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('');
    if (text) {
      await conversationService.addMessage(appId, convId, 'assistant', [{ type: 'text', text }]);
    }
  }

  eventBus.emit({ type: 'done', appId, convId, data: {} });
}
