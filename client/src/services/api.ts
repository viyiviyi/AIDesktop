import type { App, AppInfo, Conversation, DesktopSettings, Message, Content, ModelProvider, MCPConnection, Skill } from '../types';

const API_BASE = '/api';

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

// Apps
export async function getApps(source?: string): Promise<AppInfo[]> {
  const url = source ? `/apps?source=${source}` : '/apps';
  const data = await fetchJson<{ apps: AppInfo[] }>(url);
  return data.apps;
}

export async function getApp(appId: string): Promise<App> {
  return fetchJson<App>(`/apps/${appId}`);
}

export async function createApp(app: Partial<App>): Promise<App> {
  return fetchJson<App>('/apps', {
    method: 'POST',
    body: JSON.stringify(app),
  });
}

export async function updateApp(appId: string, updates: Partial<App>): Promise<App> {
  return fetchJson<App>(`/apps/${appId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

export async function deleteApp(appId: string): Promise<void> {
  await fetchJson(`/apps/${appId}`, { method: 'DELETE' });
}

// Conversations
export async function getConversations(appId: string): Promise<Conversation[]> {
  const data = await fetchJson<{ conversations: Conversation[] }>(`/apps/${appId}/conversations`);
  return data.conversations;
}

export async function getConversation(appId: string, convId: string): Promise<Conversation> {
  return fetchJson<Conversation>(`/apps/${appId}/conversations/${convId}`);
}

export async function createConversation(appId: string, title?: string): Promise<Conversation> {
  return fetchJson<Conversation>(`/apps/${appId}/conversations`, {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
}

export async function deleteConversation(appId: string, convId: string): Promise<void> {
  await fetchJson(`/apps/${appId}/conversations/${convId}`, { method: 'DELETE' });
}

export async function sendMessage(
  appId: string,
  convId: string,
  content: Content[]
): Promise<{ message: Message }> {
  return fetchJson<{ message: Message }>(`/apps/${appId}/conversations/${convId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
}

export async function* streamMessage(
  appId: string,
  convId: string,
  content: string
): AsyncGenerator<Message | { success: boolean }, void, unknown> {
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

        if (parsed.event === 'message') {
          yield parsed.data as Message;
        } else if (parsed.event === 'done') {
          return;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// Settings
export async function getSettings(): Promise<DesktopSettings> {
  return fetchJson<DesktopSettings>('/settings');
}

export async function updateSettings(settings: Partial<DesktopSettings>): Promise<DesktopSettings> {
  return fetchJson<DesktopSettings>('/settings', {
    method: 'PUT',
    body: JSON.stringify(settings),
  });
}

// Model Settings
export async function getModes(): Promise<{ providers: ModelProvider[] }> {
  return fetchJson<{ providers: ModelProvider[] }>('/settings/modes');
}

export async function updateModes(modes: { providers: ModelProvider[] }): Promise<{ providers: ModelProvider[] }> {
  return fetchJson<{ providers: ModelProvider[] }>('/settings/modes', {
    method: 'PUT',
    body: JSON.stringify(modes),
  });
}

export async function updateProvider(providerName: string, provider: ModelProvider): Promise<{ providers: ModelProvider[] }> {
  return fetchJson<{ providers: ModelProvider[] }>(`/settings/modes/providers/${providerName}`, {
    method: 'PUT',
    body: JSON.stringify(provider),
  });
}

export async function addProvider(provider: ModelProvider): Promise<{ providers: ModelProvider[] }> {
  return fetchJson<{ providers: ModelProvider[] }>('/settings/modes/providers', {
    method: 'POST',
    body: JSON.stringify(provider),
  });
}

export async function deleteProvider(providerName: string): Promise<{ providers: ModelProvider[] }> {
  return fetchJson<{ providers: ModelProvider[] }>(`/settings/modes/providers/${providerName}`, {
    method: 'DELETE',
  });
}

// MCP Settings
export async function getMcpSettings(): Promise<{ connections: MCPConnection[] }> {
  return fetchJson<{ connections: MCPConnection[] }>('/settings/mcp');
}

export async function updateMcpSettings(mcp: { connections: MCPConnection[] }): Promise<{ connections: MCPConnection[] }> {
  return fetchJson<{ connections: MCPConnection[] }>('/settings/mcp', {
    method: 'PUT',
    body: JSON.stringify(mcp),
  });
}

export async function connectMcp(connection: Omit<MCPConnection, 'id'>): Promise<{ connections: MCPConnection[] }> {
  return fetchJson<{ connections: MCPConnection[] }>('/settings/mcp/connect', {
    method: 'POST',
    body: JSON.stringify(connection),
  });
}

export async function disconnectMcp(connectionId: string): Promise<{ connections: MCPConnection[] }> {
  return fetchJson<{ connections: MCPConnection[] }>(`/settings/mcp/${connectionId}`, {
    method: 'DELETE',
  });
}

// Skill Settings
export async function getSkillSettings(): Promise<{ skills: Skill[]; globalEnabled: boolean }> {
  return fetchJson<{ skills: Skill[]; globalEnabled: boolean }>('/settings/skills');
}

export async function updateSkillSettings(skills: { skills: Skill[]; globalEnabled: boolean }): Promise<{ skills: Skill[]; globalEnabled: boolean }> {
  return fetchJson<{ skills: Skill[]; globalEnabled: boolean }>('/settings/skills', {
    method: 'PUT',
    body: JSON.stringify(skills),
  });
}

// Health check
export async function healthCheck(): Promise<{ status: string; timestamp: string }> {
  return fetchJson<{ status: string; timestamp: string }>('/health');
}
