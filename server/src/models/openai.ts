import type { ChatParams, ChatResponse, ChatStreamEvent, Content, Message, Tool, ProviderModel } from '../types/index.js';

interface OpenAIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | { type: string; text?: string; image_url?: { url: string } }[];
}

interface OpenAIStreamChunk {
  choices: Array<{
    delta?: { content?: string; role?: string };
    finish_reason?: string;
  }>;
}

export class OpenAIAdapter {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl: string = 'https://api.openai.com/v1') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  private convertMessage(msg: Message): OpenAIMessage {
    const textContent = msg.content
      .filter(c => c.type === 'text')
      .map(c => (c as { type: 'text'; text: string }).text)
      .join('\n');

    return {
      role: msg.role,
      content: textContent
    };
  }

  private convertTools(tools?: Tool[]): Array<{
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
      throw new Error('OpenAI API key not configured');
    }

    const messages = params.messages.map(m => this.convertMessage(m));
    const tools = this.convertTools(params.tools);

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
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
      throw new Error(`OpenAI API error: ${response.status} ${error}`);
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
      throw new Error('OpenAI API key not configured');
    }

    const messages = params.messages.map(m => this.convertMessage(m));
    const tools = this.convertTools(params.tools);

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
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
      throw new Error(`OpenAI API error: ${response.status} ${error}`);
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
            const chunk = JSON.parse(data) as OpenAIStreamChunk;
            const delta = chunk.choices[0]?.delta;

            if (delta?.content) {
              yield {
                type: 'content',
                content: { type: 'text', text: delta.content }
              };
            }
          } catch {
            // Skip invalid JSON
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

    const response = await fetch(`${this.baseUrl}/models`, {
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
}
