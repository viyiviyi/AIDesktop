import type { App, AppInfo, AppSource, AppType, Conversation, DesktopSettings, Message, Content, ModelProvider, MCPConnection, Skill, ProviderModel, ModelConfig, ContentType } from '../types';
import { logger } from './logger';

// ============ SSE 事件类型 ============
export interface SSEStreamEvent {
  /** 消息开始（AI 开始回复） */
  type: 'message_start';
  role: 'user' | 'assistant';
  content: Content[];
  id: string;
}

export interface SSEThinkingEvent {
  type: 'thinking';
  text: string;
}

export interface SSEToolCallEvent {
  type: 'tool_call';
  toolCallId: string;
  toolName: string;
  args: unknown;
}

export interface SSEToolResultEvent {
  type: 'tool_result';
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError: boolean;
}

export interface SSETextChunkEvent {
  type: 'text_chunk';
  text: string;
}

export interface SSEMessageUpdateEvent {
  type: 'message_update';
  content: Content[];
}

export interface SSEMessageEndEvent {
  type: 'message_end';
  id: string;
  content: Content[];
}

export interface SSEDoneEvent {
  type: 'done';
}

export interface SSEErrorEvent {
  type: 'error';
  message: string;
}

/** 发消息接口返回（新流式协议） */
export interface SendMessageResult {
  userMessage: Message;
  streamUrl: string;
}

export type SSEEvent =
  | SSEStreamEvent
  | SSEThinkingEvent
  | SSEToolCallEvent
  | SSEToolResultEvent
  | SSETextChunkEvent
  | SSEMessageUpdateEvent
  | SSEMessageEndEvent
  | SSEDoneEvent
  | SSEErrorEvent;

// API基础URL
const API_BASE = '/api';

/**
 * 通用JSON请求封装
 * 自动处理请求/响应日志、错误处理
 */
async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const startTime = Date.now();
  const method = options?.method || 'GET';

  logger.info('api', `API ${method}`, `→ ${url}`);

  try {
    const response = await fetch(`${API_BASE}${url}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    const duration = Date.now() - startTime;

    // 错误处理
    if (!response.ok) {
      let errorBody: unknown;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = response.statusText;
      }

      logger.error('api', `API ${method}`, `✗ ${url} - ${response.status} ${response.statusText}`, {
        status: response.status,
        duration,
        error: errorBody,
      });

      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    logger.info('api', `API ${method}`, `✓ ${url}`, { status: response.status, duration });
    return data;
  } catch (error) {
    const duration = Date.now() - startTime;
    if ((error as Error).message.startsWith('API error:')) {
      throw error;
    }
    logger.error('api', `API ${method}`, `✗ ${url} - ${(error as Error).message}`, {
      duration,
      error: (error as Error).message,
    });
    throw error;
  }
}

// ============ 应用相关API ============

// 获取已安装的应用列表
export async function getApps(source?: string): Promise<AppInfo[]> {
  const url = source ? `/apps?source=${source}` : '/apps';
  const data = await fetchJson<{ apps: AppInfo[] }>(url);
  return data.apps;
}

// 获取单个应用的完整信息
export async function getApp(appId: string): Promise<App> {
  const data = await fetchJson<{
    meta: {
      id: string;
      name: string;
      description: string;
      source: AppSource;
      type: AppType;
      icon: string;
      enabled?: boolean;
      backgroundImage?: string;
      models?: ModelConfig[];
      supportedInputs?: ContentType[];
      inputDescription?: string;
      outputDescription?: string;
      visibleApps?: string[];
      visibleServices?: string[];
      tools?: string[];
    };
    appMd: string;
    mcpServices: string[];
    skills: string[];
  }>(`/apps/${appId}`);
  // 将服务器返回的App格式（包含meta字段）转换为客户端App格式（扁平结构）
  return {
    id: data.meta.id,
    name: data.meta.name,
    description: data.meta.description,
    source: data.meta.source,
    type: data.meta.type,
    icon: data.meta.icon,
    enabled: data.meta.enabled,
    backgroundImage: data.meta.backgroundImage,
    models: data.meta.models || [],
    supportedInputs: data.meta.supportedInputs || ['text'],
    inputDescription: data.meta.inputDescription || '',
    outputDescription: data.meta.outputDescription || '',
    visibleApps: data.meta.visibleApps || [],
    visibleServices: data.meta.visibleServices || [],
    tools: data.meta.tools || [],
    appMd: data.appMd,
  };
}

// 创建新应用
export async function createApp(app: Partial<App>): Promise<App> {
  return fetchJson<App>('/apps', {
    method: 'POST',
    body: JSON.stringify(app),
  });
}

// 更新应用信息
export async function updateApp(appId: string, updates: Partial<App>): Promise<App> {
  return fetchJson<App>(`/apps/${appId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

// 删除应用
export async function deleteApp(appId: string): Promise<void> {
  await fetchJson(`/apps/${appId}`, { method: 'DELETE' });
}

// 启用应用
export async function enableApp(appId: string): Promise<void> {
  await fetchJson(`/apps/${appId}/enable`, { method: 'PUT' });
}

// 禁用应用
export async function disableApp(appId: string): Promise<void> {
  await fetchJson(`/apps/${appId}/disable`, { method: 'PUT' });
}

// 重新加载应用（从磁盘扫描，用于添加新应用后刷新）
export async function reloadApps(): Promise<{ success: boolean; message: string; apps: AppInfo[] }> {
  return fetchJson<{ success: boolean; message: string; apps: AppInfo[] }>('/apps/reload', {
    method: 'POST',
  });
}

// ============ 会话相关API ============

// 获取应用的所有会话
export async function getConversations(appId: string): Promise<Conversation[]> {
  const data = await fetchJson<{ conversations: Conversation[] }>(`/apps/${appId}/conversations`);
  return data.conversations;
}

// 获取单个会话详情
export async function getConversation(appId: string, convId: string): Promise<Conversation> {
  return fetchJson<Conversation>(`/apps/${appId}/conversations/${convId}`);
}

// 创建新会话
export async function createConversation(appId: string, title?: string): Promise<Conversation> {
  return fetchJson<Conversation>(`/apps/${appId}/conversations`, {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
}

// 删除会话
export async function deleteConversation(appId: string, convId: string): Promise<void> {
  await fetchJson(`/apps/${appId}/conversations/${convId}`, { method: 'DELETE' });
}

// 更新会话标题
export async function updateConversationTitle(appId: string, convId: string, title: string): Promise<void> {
  await fetchJson(`/apps/${appId}/conversations/${convId}`, {
    method: 'PUT',
    body: JSON.stringify({ title }),
  });
}

// 发送消息（事件驱动 — 只保存 user 消息并返回，agent 通过 WebSocket 推送事件）
export async function sendMessage(
  appId: string,
  convId: string,
  content: Content[],
  replyTo?: string,
): Promise<{ userMessage: Message }> {
  return fetchJson<{ userMessage: Message }>(`/apps/${appId}/conversations/${convId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content, replyTo }),
  });
}

// 编辑消息（产生新分支）
export async function editMessage(
  appId: string,
  convId: string,
  msgId: string,
  content: Content[],
): Promise<{ message: Message }> {
  return fetchJson<{ message: Message }>(`/apps/${appId}/conversations/${convId}/messages/${msgId}`, {
    method: 'PUT',
    body: JSON.stringify({ content }),
  });
}

/**
 * 流式发送消息
 * 使用SSE（Server-Sent Events）接收实时响应
 * yield每个消息片段，最终返回完成状态
 */
export async function* streamMessage(
  appId: string,
  convId: string,
  content: string
): AsyncGenerator<string, void, unknown> {
  const response = await fetch(
    `${API_BASE}/apps/${appId}/conversations/${convId}/stream?content=${encodeURIComponent(content)}`
  );

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Response body is null');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;

        const data = trimmed.slice(6);
        const parsed = JSON.parse(data);

        if (parsed.type === 'text') {
          yield parsed.text as string;
        } else if (parsed.type === 'done') {
          return;
        } else if (parsed.type === 'error') {
          throw new Error(parsed.text);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ============ 设置相关API ============

// 获取桌面设置
export async function getSettings(): Promise<DesktopSettings> {
  return fetchJson<DesktopSettings>('/settings');
}

// 更新桌面设置（部分更新）
export async function updateSettings(settings: Partial<DesktopSettings>): Promise<DesktopSettings> {
  return fetchJson<DesktopSettings>('/settings', {
    method: 'PUT',
    body: JSON.stringify(settings),
  });
}

// ============ 模型相关API ============

// 获取模型提供商列表
export async function getModes(): Promise<{ providers: ModelProvider[] }> {
  return fetchJson<{ providers: ModelProvider[] }>('/settings/modes');
}

// 更新模型提供商列表
export async function updateModes(modes: { providers: ModelProvider[] }): Promise<{ providers: ModelProvider[] }> {
  return fetchJson<{ providers: ModelProvider[] }>('/settings/modes', {
    method: 'PUT',
    body: JSON.stringify(modes),
  });
}

// 更新单个提供商
export async function updateProvider(providerId: string, provider: ModelProvider): Promise<{ providers: ModelProvider[] }> {
  return fetchJson<{ providers: ModelProvider[] }>(`/settings/modes/providers/${providerId}`, {
    method: 'PUT',
    body: JSON.stringify(provider),
  });
}

// 添加新提供商
export async function addProvider(provider: ModelProvider): Promise<{ providers: ModelProvider[] }> {
  return fetchJson<{ providers: ModelProvider[] }>('/settings/modes/providers', {
    method: 'POST',
    body: JSON.stringify(provider),
  });
}

// 删除提供商
export async function deleteProvider(providerId: string): Promise<{ providers: ModelProvider[] }> {
  return fetchJson<{ providers: ModelProvider[] }>(`/settings/modes/providers/${providerId}`, {
    method: 'DELETE',
  });
}

// 从提供商API获取模型列表
export async function fetchModels(apiKey: string, baseUrl: string, apiType: string): Promise<{ models: ProviderModel[] }> {
  return fetchJson<{ models: ProviderModel[] }>('/settings/modes/fetch-models', {
    method: 'POST',
    body: JSON.stringify({ apiKey, baseUrl, apiType }),
  });
}

// 获取默认模型配置
export async function getDefaultModel(): Promise<{ providerId: string; modelId: string }> {
  return fetchJson<{ providerId: string; modelId: string }>('/settings/default-model');
}

// 更新默认模型配置
export async function updateDefaultModel(config: { providerId: string; modelId: string }): Promise<{ providerId: string; modelId: string }> {
  return fetchJson<{ providerId: string; modelId: string }>('/settings/default-model', {
    method: 'PUT',
    body: JSON.stringify(config),
  });
}

// ============ MCP相关API ============

// 获取MCP连接配置
export async function getMcpSettings(): Promise<{ connections: MCPConnection[] }> {
  return fetchJson<{ connections: MCPConnection[] }>('/settings/mcp');
}

// 更新MCP连接配置
export async function updateMcpSettings(mcp: { connections: MCPConnection[] }): Promise<{ connections: MCPConnection[] }> {
  return fetchJson<{ connections: MCPConnection[] }>('/settings/mcp', {
    method: 'PUT',
    body: JSON.stringify(mcp),
  });
}

// 连接新的MCP服务
export async function connectMcp(connection: Omit<MCPConnection, 'id'>): Promise<{ connections: MCPConnection[] }> {
  return fetchJson<{ connections: MCPConnection[] }>('/settings/mcp/connect', {
    method: 'POST',
    body: JSON.stringify(connection),
  });
}

// 断开MCP连接
export async function disconnectMcp(connectionId: string): Promise<{ connections: MCPConnection[] }> {
  return fetchJson<{ connections: MCPConnection[] }>(`/settings/mcp/${connectionId}`, {
    method: 'DELETE',
  });
}

// ============ MCP服务器连接API ============

// 获取已连接的MCP服务器
export async function getMcpConnections(): Promise<Array<{
  connectionId: string;
  serverInfo: { name: string; version: string } | null;
  isConnected: boolean;
  isInitialized: boolean;
  tools: Array<{ name: string; description: string; inputSchema: object }>;
  resources: Array<{ uri: string; name: string; description?: string; mimeType?: string }>;
}>> {
  const data = await fetchJson<{ connections: Array<{
    connectionId: string;
    serverInfo: { name: string; version: string } | null;
    isConnected: boolean;
    isInitialized: boolean;
    tools: Array<{ name: string; description: string; inputSchema: object }>;
    resources: Array<{ uri: string; name: string; description?: string; mimeType?: string }>;
  }> }>('/mcp/connections');
  return data.connections;
}

// 连接到外部MCP服务器
export async function connectMcpServer(connection: Omit<MCPConnection, 'id'> & { id?: string }): Promise<{
  success: boolean;
  connection: MCPConnection & {
    connected: boolean;
    initialized: boolean;
    tools?: Array<{ name: string; description: string; inputSchema: object }>;
    resources?: Array<{ uri: string; name: string; description?: string; mimeType?: string }>;
    error?: string;
  };
}> {
  return fetchJson<{
    success: boolean;
    connection: MCPConnection & {
      connected: boolean;
      initialized: boolean;
      tools?: Array<{ name: string; description: string; inputSchema: object }>;
      resources?: Array<{ uri: string; name: string; description?: string; mimeType?: string }>;
      error?: string;
    };
  }>('/mcp/connect', {
    method: 'POST',
    body: JSON.stringify({ connection }),
  });
}

// 断开MCP服务器连接
export async function disconnectMcpServer(connectionId: string): Promise<{ success: boolean; connectionId: string }> {
  return fetchJson<{ success: boolean; connectionId: string }>(`/mcp/connect/${connectionId}`, {
    method: 'DELETE',
  });
}

// 获取MCP服务器工具列表
export async function listMcpTools(connectionId: string): Promise<Array<{ name: string; description: string; inputSchema: object }>> {
  const data = await fetchJson<{ tools: Array<{ name: string; description: string; inputSchema: object }> }>(`/mcp/connections/${connectionId}/tools`);
  return data.tools;
}

// 调用MCP工具
export async function callMcpTool(connectionId: string, tool: string, args: object): Promise<unknown> {
  const data = await fetchJson<{ result: unknown }>(`/mcp/connections/${connectionId}/call`, {
    method: 'POST',
    body: JSON.stringify({ tool, args }),
  });
  return data.result;
}

// ============ 技能相关API ============

// 获取技能设置
export async function getSkillSettings(): Promise<{ skills: Skill[]; globalEnabled: boolean }> {
  return fetchJson<{ skills: Skill[]; globalEnabled: boolean }>('/settings/skills');
}

// 更新技能设置
export async function updateSkillSettings(skills: { skills: Skill[]; globalEnabled: boolean }): Promise<{ skills: Skill[]; globalEnabled: boolean }> {
  return fetchJson<{ skills: Skill[]; globalEnabled: boolean }>('/settings/skills', {
    method: 'PUT',
    body: JSON.stringify(skills),
  });
}

// ============ 其他API ============

// 获取 MCP 服务列表
export async function getMcpServices(): Promise<{ services: Array<{ name: string; description: string; methods: string[] }> }> {
  return fetchJson('/mcp/services');
}

// 获取后端日志
export async function getLogs(params?: { level?: string; category?: string; search?: string; limit?: number }): Promise<{ logs: Array<{id: string; timestamp: string; level: string; category: string; message: string; data?: unknown}>; total: number }> {
  const query = new URLSearchParams();
  if (params?.level) query.set('level', params.level);
  if (params?.category) query.set('category', params.category);
  if (params?.search) query.set('search', params.search);
  if (params?.limit) query.set('limit', String(params.limit));
  const qs = query.toString();
  return fetchJson(`/logs${qs ? '?' + qs : ''}`);
}

// 清空后端日志
export async function clearLogs(): Promise<void> {
  await fetchJson('/logs/clear', { method: 'POST' });
}

// 健康检查
export async function healthCheck(): Promise<{ status: string; timestamp: string }> {
  return fetchJson<{ status: string; timestamp: string }>('/health');
}

// 获取窗口位置记录
export async function getWindowPositions(): Promise<Record<string, { x: number; y: number }>> {
  return fetchJson<Record<string, { x: number; y: number }>>('/settings/window-positions');
}

// 保存单个窗口位置
export async function saveWindowPosition(appId: string, position: { x: number; y: number }): Promise<void> {
  await fetchJson(`/settings/window-positions/${appId}`, {
    method: 'PUT',
    body: JSON.stringify(position),
  });
}
