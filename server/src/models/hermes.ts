/**
 * HermesAdapter - Hermes Agent API 适配器（已废弃）
 *
 * 已被 @earendil-works/pi-ai 替代。
 * pi-ai 提供了统一的流式 LLM 接口 (streamSimple/completeSimple)，
 * 支持 40+ provider，包括 OpenAI、Anthropic、以及自定义 API。
 *
 * @deprecated 请使用 @earendil-works/pi-ai 的 streamSimple 替代
 */

import type { ChatParams, ChatResponse, ChatStreamEvent, Content, Message, ProviderModel } from '../types/index.js';

// Hermes API message format
interface HermesMessage {
  role: 'user' | 'assistant' | 'system' | 'developer';
  content: string | { type: string; text?: string; image_url?: { url: string } }[];
}

// Hermes stream chunk format
interface HermesStreamChunk {
  choices: Array<{
    delta?: { content?: string; role?: string };
    finish_reason?: string;
  }>;
}

/**
 * @deprecated 使用 @earendil-works/pi-ai 的 streamSimple 替代
 */
export class HermesAdapter {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl: string = 'http://127.0.0.1:8642') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  private convertMessage(msg: Message): HermesMessage {
    const textContent = msg.content
      .filter(c => c.type === 'text')
      .map(c => (c as { type: 'text'; text: string }).text)
      .join('\n');

    // toolResult 消息不发送给模型
    if (msg.role === 'toolResult') return { role: 'user' as const, content: textContent };

    const role = msg.role === 'system' ? 'developer' : msg.role;

    return {
      role,
      content: textContent
    };
  }

  private convertTools(tools?: import('../types/index.js').Tool[]): Array<{
    type: string;
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }> {
    if (!tools) return [];
    return tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters
      }
    }));
  }

  async chat(params: ChatParams): Promise<ChatResponse> {
    if (!this.apiKey) {
      throw new Error('Hermes API key not configured');
    }

    const messages = params.messages.map(m => this.convertMessage(m));
    const tools = this.convertTools(params.tools);

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: params.model,
        messages,
        temperature: params.temperature,
        top_p: params.top_p,
        max_tokens: params.max_tokens,
        tools: tools.length > 0 ? tools : undefined
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Hermes API error: ${response.status} ${error}`);
    }

    const data = await response.json() as {
      choices: Array<{
        message: { content: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> };
        finish_reason: string;
      }>;
    };

    const choice = data.choices[0];
    const content: Content[] = [];

    if (choice.message.content) {
      content.push({ type: 'text', text: choice.message.content });
    }

    const toolCalls = choice.message.tool_calls?.map(tc => ({
      id: tc.id,
      tool: 'mcp',
      method: tc.function.name,
      args: JSON.parse(tc.function.arguments)
    }));

    return { content, toolCalls };
  }

  async *chatStream(params: ChatParams): AsyncGenerator<ChatStreamEvent> {
    if (!this.apiKey) {
      throw new Error('Hermes API key not configured');
    }

    const messages = params.messages.map(m => this.convertMessage(m));
    const tools = this.convertTools(params.tools);

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: params.model,
        messages,
        temperature: params.temperature,
        top_p: params.top_p,
        max_tokens: params.max_tokens,
        stream: true,
        tools: tools.length > 0 ? tools : undefined
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Hermes API error: ${response.status} ${error}`);
    }

    if (!response.body) {
      throw new Error('Response body is null');
    }

    const reader = response.body.getReader();
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
          if (data === '[DONE]') {
            yield { type: 'done' };
            return;
          }

          try {
            const chunk = JSON.parse(data) as HermesStreamChunk;
            const delta = chunk.choices[0]?.delta;

            if (delta?.content) {
              yield {
                type: 'content',
                content: { type: 'text', text: delta.content }
              };
            }
          } catch {
            // skip invalid JSON
          }
        }
      }

      yield { type: 'done' };
    } finally {
      reader.releaseLock();
    }
  }

  supports(): ('text' | 'image' | 'audio' | 'video' | 'file')[] {
    return ['text', 'image'];
  }

  async listModels(): Promise<ProviderModel[]> {
    if (!this.apiKey) {
      throw new Error('API key not configured');
    }

    const response = await fetch(`${this.baseUrl}/v1/models`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to list models: ${response.status}`);
    }

    const data = await response.json() as {
      data: Array<{
        id: string;
        name?: string;
        context_window?: number;
        input_modalities?: string[];
      }>;
    };

    return data.data.map(model => ({
      id: model.id,
      name: model.name || model.id,
      maxTokens: model.context_window || 128000,
      supports: (model.input_modalities?.includes('text') ?? true) ? ['text', 'image'] : ['text'],
      params: { temperature: 0.7, top_p: 0.9 }
    }));
  }

  async healthCheck(): Promise<{ status: string; timestamp: string }> {
    const response = await fetch(`${this.baseUrl}/health`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`
      }
    });

    if (!response.ok) {
      throw new Error(`Hermes health check failed: ${response.status}`);
    }

    return (await response.json()) as { status: string; timestamp: string };
  }

  async getCapabilities(): Promise<Record<string, unknown>> {
    const response = await fetch(`${this.baseUrl}/v1/capabilities`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to get capabilities: ${response.status}`);
    }

    return (await response.json()) as Record<string, unknown>;
  }
}
