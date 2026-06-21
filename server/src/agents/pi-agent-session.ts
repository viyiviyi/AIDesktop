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
import { buildPiToolsForApp, buildWorkspaceTools, setCurrentConvId } from "./pi-tools.js";
import { serverLogger } from "../utils/logger.js";
import { DATA_DIR, APPS_DATA_DIR } from "../utils/file.js";
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

function adMsgToPiMsg(m: AdMsg, appId: string, provider: string, modelId: string): PiMsg | null {
  const ts = new Date(m.timestamp).getTime();
  if (m.role === "user") {
    const textBlocks = m.content.filter((c): c is { type: "text"; text: string } => c.type === "text").map((c) => c.text);
    const content: any[] = [];
    if (textBlocks.length) content.push({ type: "text", text: textBlocks.join("\n") });
    for (const c of m.content) {
      if (c.type === "image") {
        const img = c as any;
        if (typeof img.url === 'string' && img.url.startsWith('data:')) {
          const mimeType = img.url.split(';')[0].replace('data:', '');
          const data = img.url.split(',')[1];
          content.push({ type: "image", mimeType, data });
        } else if (typeof img.url === 'string' && img.url.startsWith('/api/files/')) {
          // 从文件读取
          try {
            const syncFs = require('fs');
            const filePath = path.join(process.cwd(), 'desktop_data', 'apps_data', img.url.replace('/api/files/', ''));
            const fileBuffer = syncFs.readFileSync(filePath);
            const ext = filePath.split('.').pop() || 'png';
            const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
            content.push({ type: "image", mimeType, data: fileBuffer.toString('base64') });
          } catch {
            content.push({ type: "text", text: "(image file not found)" });
          }
        } else {
          content.push({ type: "text", text: "(image unavailable)" });
        }
      }
    }
    if (content.length === 0) content.push({ type: "text", text: "" });
    return { role: "user", content, timestamp: ts } as any;
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
      content: [{ type: "text", text: text || "" }],
      isError: meta.isError,
      timestamp: ts,
    } as any;
  }
  return null;
}

function buildSystemPrompt(app: App): string {
  let prompt = app.appMd || "";
  const visibleApps = app.config.visibleApps || app.meta.visibleApps || [];
  if (visibleApps.length > 0) {
    const names = visibleApps.map((id: string) => {
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
  /** 当前运行的会话 ID，由 runAgentAsync 设置 */
  currentConvId: string = '';

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
    // 优先使用 app config 中配置的模型（用户通过设置界面修改的），其次 meta 默认值
    const appModelConfig = (app.config.models && app.config.models.length > 0) ? app.config.models[0]
      : (app.meta.models && app.meta.models.length > 0) ? app.meta.models[0]
      : null;
    if (appModelConfig) {
      const appProvider = modes.providers.find(p => p.id === appModelConfig.provider);
      if (appProvider && appProvider.enabled !== false) {
        providerId = appModelConfig.provider;
        modelId = appModelConfig.model;
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

    // bodyParams 和 headerParams 在每次 streamFn 调用时动态读取，不在 init 时固定
    // 这样设置修改后立即生效，无需重启

    this.agent = new Agent({
      initialState: { model: this.model as any, systemPrompt },
      streamFn: (model, context, options) => {
        const textPreview = context.messages.filter((m: any) => m.role === "user").slice(-1).map((m: any) => typeof m.content === "string" ? m.content.slice(0, 100) : "").join("");
        serverLogger.ai(`${model.provider}/${model.id}`, `>>> ${textPreview}`, { messages: context.messages.length });
        const start = Date.now();

        // 每次流式调用时从当前 app 配置读取 bodyParams（支持运行时修改）
        const currentApp = appLoader.getApp(app.meta.id);
        serverLogger.debug('PiAgentSession', `currentApp config.models: ${JSON.stringify(currentApp?.config.models)}`);
        const currentModelConfig = (currentApp?.config.models?.[0]) || currentApp?.meta.models?.[0];
        const bodyParams: Record<string, unknown> = {};
        if (currentModelConfig?.bodyParams) {
          for (const p of currentModelConfig.bodyParams) {
            if (p.enabled) {
              try { bodyParams[p.key] = JSON.parse(p.value); } catch { bodyParams[p.key] = p.value; }
            }
          }
        }
        serverLogger.debug('PiAgentSession', `Dynamic bodyParams: ${JSON.stringify(bodyParams)} from ${app.meta.id}`);

        // 注入 body 参数（如 thinking: { type: "disabled" }）
        let streamOptions = { ...options, apiKey: this.apiKey };
        if (Object.keys(bodyParams).length > 0) {
          streamOptions = {
            ...streamOptions,
            onPayload: (payload: any, m: any) => {
              // 先调用已有的 onPayload
              let p = options?.onPayload ? options.onPayload(payload, m) : undefined;
              if (p === undefined) p = { ...payload };
              // 注入 body 参数
              Object.assign(p, bodyParams);
              return p;
            },
          };
        }

        // 记录原始请求 payload
        const originalOnPayload = streamOptions.onPayload;
        streamOptions.onPayload = (payload: any, m: any) => {
          let p = originalOnPayload ? originalOnPayload(payload, m) : { ...payload };
          // 记录请求体（截断大字段）
          const logged = { ...p };
          if (logged.messages) {
            logged.messages = logged.messages.map((msg: any) => {
              if (typeof msg.content === 'string') return { ...msg, content: msg.content.slice(0, 200) };
              if (Array.isArray(msg.content)) {
                return { ...msg, content: msg.content.map((c: any) =>
                  c.type === 'image' ? { ...c, url: c.url?.slice(0, 80) + '...' } :
                  c.type === 'text' ? { ...c, text: c.text?.slice(0, 200) } : c
                ) };
              }
              return msg;
            });
          }
          serverLogger.debug('ai', `Request payload: ${JSON.stringify(logged).slice(0, 3000)}`);
          return p;
        };

        // 注入 header 参数
        if (currentModelConfig?.headerParams) {
          const headers: Record<string, string> = {};
          for (const hp of currentModelConfig.headerParams) {
            if (hp.enabled) headers[hp.key] = hp.value;
          }
          if (Object.keys(headers).length > 0) {
            streamOptions = {
              ...streamOptions,
              headers: { ...(streamOptions.headers || {}), ...headers },
            };
          }
        }

        const stream = streamSimple(model, context, streamOptions);
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

  /** 注入 workspace 工具（需要会话上下文） */
  injectWorkspaceTools(app: App, convId: string): void {
    const wsTools = buildWorkspaceTools(app, convId);
    const existingTools = this.agent.state.tools || [];
    // 避免重复注入——检查是否已有 workspace 工具
    const wsNames = new Set(wsTools.map((t: any) => t.name));
    const filtered = existingTools.filter((t: any) => !wsNames.has(t.name));
    this.agent.state.tools = [...filtered, ...wsTools] as any;
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
 * 处理表单暂停：保存消息，等待用户提交/取消，恢复 agent
 */
async function handleFormPendingInternal(
  appId: string,
  convId: string,
  session: PiAgentSession,
  app: any,
): Promise<void> {
  const { conversationService } = await import('../services/conversation.js');
  const { eventBus: evBus } = await import('../services/eventBus.js');

  // 保存 agent 本轮产生的所有消息（跳过 pending toolResult，只保留 assistant）
  const piMsgs = session.agent.state.messages as any[];
  const newAssistantMsgs = piMsgs.filter((m: any) => m.role === 'assistant');
  for (const msg of newAssistantMsgs) {
    const content: Content[] = [];
    for (const block of (msg.content || [])) {
      if (block.type === 'text') content.push({ type: 'text', text: block.text });
      else if (block.type === 'thinking') content.push({ type: 'thinking', text: block.thinking || block.text || '' });
      else if (block.type === 'toolCall') {
        content.push({ type: 'toolCall', id: block.id, name: block.name, arguments: block.arguments } as any);
      }
    }
    if (content.length > 0) {
      await conversationService.addMessage(appId, convId, 'assistant', content);
    }
  }

  serverLogger.info('agent', `Agent paused for ${appId}/${convId}, waiting for form response...`);

  // 等待表单响应
  const formResponse = await new Promise<{ type: 'form_response' | 'form_cancelled'; data: Record<string, unknown> }>((resolve) => {
    const unsub = evBus.subscribe(convId, (event) => {
      if (event.type === 'form_response' || event.type === 'form_cancelled') {
        unsub();
        resolve({ type: event.type, data: event.data });
      }
    });
  });

  serverLogger.info('agent', `Agent resuming for ${appId}/${convId}, form response received`);

  // 插入 toolResult 到 agent state
  if (formResponse.type === 'form_cancelled') {
    const toolCallId = formResponse.data.toolCallId as string || '';
    session.agent.state.messages.push({
      role: 'toolResult',
      toolCallId,
      toolName: 'mcp.form.requestInput',
      content: JSON.stringify({ status: 'cancelled', message: '用户取消了表单填写' }),
    } as any);
    await saveAppendedToolResult(appId, convId, conversationService, {
      role: 'toolResult',
      toolCallId,
      toolName: 'mcp.form.requestInput',
      content: JSON.stringify({ status: 'cancelled', message: '用户取消了表单填写' }),
      isError: false,
    });
  } else {
    const toolCallId = formResponse.data.toolCallId as string || '';
    const formData = formResponse.data.formData as Record<string, unknown> || {};
    session.agent.state.messages.push({
      role: 'toolResult',
      toolCallId,
      toolName: 'mcp.form.requestInput',
      content: JSON.stringify(formData),
    } as any);
    await saveAppendedToolResult(appId, convId, conversationService, {
      role: 'toolResult',
      toolCallId,
      toolName: 'mcp.form.requestInput',
      content: JSON.stringify(formData),
      isError: false,
    });
  }

  // 不再在这里恢复 agent，由 form-response 路由统一负责
  // runAgentAsync 会在 form-response 路由中被调用
  serverLogger.info('agent', `Form resume data prepared for ${appId}/${convId}, agent will be resumed by form-response route`);
}

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

  // 过滤掉 pending 状态的 toolResult（避免发给模型时产生冲突）
  const filteredMessages = existingMessages.filter((m: any) => {
    if (m.role === 'toolResult' && m.content) {
      const text = (m.content as any[]).filter((x: any) => x.type === 'text').map((x: any) => x.text).join('');
      if (text.includes('"status":"pending"') || text.includes('"status": "pending"')) return false;
    }
    return true;
  });

  const fullHistory = [...filteredMessages, { role: 'user', content: userContent }];
  serverLogger.info('agent', `runAgentAsync getOrCreate for ${appId}/${convId}`);
  const session = await piAgentManager.getOrCreate(appId, app);
  serverLogger.info('agent', `runAgentAsync got session for ${appId}/${convId}, activeRun: ${!!session.agent.activeRun}`);

  session.currentConvId = convId;

  // 如果 agent 正在处理，忽略本次请求
  if (session.agent.activeRun) {
    serverLogger.warn('agent', `Agent already processing for ${appId}/${convId}, skipping`);
    return;
  }

  // 标记是否因 workspace 授权被中止（非错误）
  let workspaceAuthAbort = false;

  serverLogger.info('agent', `runAgentAsync starting for ${appId}/${convId}, existingMsgs: ${existingMessages.length}, userContent: ${JSON.stringify(userContent).slice(0, 100)}`);

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
        if ((event.toolName?.includes('requestInput') || event.toolName?.includes('mcp.form'))
            && !event.isError) {
          // 表单工具执行成功（非错误），停止 agent 后续思考
          (session as any)._formPending = true;
          try { session.agent.abort(); } catch {}
          break;
        }
        emit('tool_result', { toolCallId: event.toolCallId, toolName: event.toolName, result: event.result, isError: event.isError });
        break;
    }
  });

  const unsub2 = session.onText((text: string) => {
    eventBus.emit({ type: 'text_chunk', appId, convId, data: { text } });
  });

  try {
    session.syncHistory(fullHistory);
    setCurrentConvId(convId);
    // 注入 workspace 工具（需要 convId 上下文）
    session.injectWorkspaceTools(app, convId);
    // 每次 prompt 前从最新 app 配置刷新 system prompt（支持 appMd 运行时修改）
    try {
      const fs = await import('fs/promises');
      const p = await import('path');
      const userAppMdPath = p.join(APPS_DATA_DIR, appId, 'app.md');
      let latestAppMd: string;
      try {
        latestAppMd = await fs.readFile(userAppMdPath, 'utf-8');
      } catch {
        latestAppMd = app.appMd || '';
      }
      const updatedPrompt = buildSystemPrompt({ ...app, appMd: latestAppMd } as any);
      if (session.agent.state.systemPrompt !== updatedPrompt) {
        session.agent.state.systemPrompt = updatedPrompt;
      }
    } catch {}
    const userText = userContent
      .filter((c: any): c is { type: 'text'; text: string } => c.type === 'text')
      .map((c: any) => c.text)
      .join('\n');
    // 提取图片内容传给 prompt
    const userImages = userContent
      .filter((c: any): c is { type: 'image'; url: string } => c.type === 'image')
      .map((c: any) => {
        if (c.url.startsWith('data:')) {
          return { type: 'image' as const, mimeType: c.url.split(';')[0].replace('data:', ''), data: c.url.split(',')[1] };
        }
        // 文件路径引用，读取文件
        try {
          const syncFs = require('fs');
          const filePath = path.join(DATA_DIR, 'apps_data', c.url.replace('/api/files/', ''));
          const fileBuffer = syncFs.readFileSync(filePath);
          const ext = filePath.split('.').pop() || 'png';
          return { type: 'image' as const, mimeType: ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`, data: fileBuffer.toString('base64') };
        } catch {
          return { type: 'text' as const, text: '(image unavailable)' };
        }
      });
    // 如果没有文本也没有图片，报错
    if (!userText.trim() && userImages.length === 0) throw new Error('No text in user message');

    serverLogger.info('agent', `Calling agent.prompt for ${appId}/${convId}, text: "${userText.slice(0, 50)}"`);
    await session.agent.prompt(userText || '(image input)', userImages.length > 0 ? userImages : undefined);
    serverLogger.info('agent', `agent.prompt completed for ${appId}/${convId}`);

    // === 检测是否存在 pending 表单 ===
    const convAfterPrompt = await conversationService.getConversation(appId, convId);
    if (convAfterPrompt?.pendingForms && convAfterPrompt.pendingForms.length > 0) {
      await handleFormPendingInternal(appId, convId, session, app);
      unsub();
      unsub2();
      return;
    }
  } catch (error: any) {
    // 表单暂停：agent 被 abort 了，检查是否有 pendingForms
    const convAfterCatch = await conversationService.getConversation(appId, convId);
    if (convAfterCatch?.pendingForms && convAfterCatch.pendingForms.length > 0) {
      await handleFormPendingInternal(appId, convId, session, app);
      unsub();
      unsub2();
      return;
    }
    // 其他错误正常处理
    if (workspaceAuthAbort || (session as any)._workspaceAuthAbort) {
      // 因 workspace 授权而中止，不发送 error
      serverLogger.info('agent', `Agent aborted for workspace auth ${appId}/${convId}`);
    } else {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      serverLogger.error('agent', `Agent error for ${appId}/${convId}: ${msg}`);
      eventBus.emit({ type: 'error', appId, convId, data: { message: msg } });
    }
    unsub();
    unsub2();
    eventBus.emit({ type: 'done', appId, convId, data: {} });
    return;
  }
  unsub();
  unsub2();

  // 将 pi 的新消息转换为持久化消息保存
  const piMessages = session.agent.state.messages;
  const existingCount = fullHistory.length - 1; // 减去我们加的 user
  const newPiMessages = piMessages.slice(existingCount);

  await saveNewMessages(appId, convId, newPiMessages, conversationService);

  // 自动将最终结果返回给调用方
  const conversation = await conversationService.getConversation(appId, convId);
  if (conversation?.source === 'agent' && conversation.callChain && conversation.callChain.length > 0) {
    const lastCaller = conversation.callChain[conversation.callChain.length - 1];
    // 跳过 _injected_ 这种内部标记
    if (lastCaller.callerAppId && lastCaller.callerAppId !== '_injected_') {
      // 提取最后一次 assistant 消息的文本作为最终结果
      const finalText = extractFinalText(piMessages, newPiMessages);
      if (finalText) {
        const callId = lastCaller.callId || '';

        // 通知等待中的 mcp.agent.call（通过 agent_call_end_auto 事件）
        // 注意：使用被调 agent 的 convId 作为事件 target，因为 call 方法订阅了它
        eventBus.emit({ type: 'agent_call_end_auto' as any, appId, convId, data: {
          callId,
          result: finalText,
          fromAppId: appId,
          timestamp: new Date().toISOString(),
        }});
      }
    }
  }

  eventBus.emit({ type: 'done', appId, convId, data: {} });
}

/**
 * 从 agent 输出的消息中提取最终文本结果。
 * 优先使用最新轮次的 assistant 消息。
 */
function extractFinalText(piMessages: any[], newPiMessages: any[]): string {
  // 从新消息中倒序查找最后一个 assistant 消息
  for (let i = newPiMessages.length - 1; i >= 0; i--) {
    const msg = newPiMessages[i];
    if (msg.role === 'assistant') {
      const texts = (msg.content || [])
        .filter((c: any) => c?.type === 'text' && c.text)
        .map((c: any) => c.text);
      if (texts.length > 0) return texts.join('');
    }
  }
  // 回退：从全量消息中查找
  for (let i = piMessages.length - 1; i >= 0; i--) {
    const msg = piMessages[i];
    if (msg.role === 'assistant') {
      const texts = (msg.content || [])
        .filter((c: any) => c?.type === 'text' && c.text)
        .map((c: any) => c.text);
      if (texts.length > 0) return texts.join('');
    }
  }
  return '';
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
export async function replaceLargeContentWithFileRef(
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

/**
 * 在现有会话末尾追加一条 toolResult 消息（带 toolResultMeta）。
 * 与 saveNewMessages 中的 toolResult 保存逻辑保持一致。
 */
async function saveAppendedToolResult(
  appId: string,
  convId: string,
  convService: any,
  piMsg: { role: string; toolCallId: string; toolName: string; content: string; isError: boolean },
): Promise<void> {
  const toolResultMeta: ToolResultMeta = {
    toolCallId: piMsg.toolCallId,
    toolName: piMsg.toolName,
    isError: piMsg.isError,
  };
  const resultContent: Content[] = [{ type: 'text', text: piMsg.content }];
  const saveMsg = await convService.addMessage(appId, convId, 'toolResult', resultContent);
  if (saveMsg) {
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
