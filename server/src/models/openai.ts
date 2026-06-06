import type { ChatParams, ChatResponse, ChatStreamEvent, Content, Message, Tool, ProviderModel } from '../types/index.js';

// OpenAI API消息格式
interface OpenAIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | { type: string; text?: string; image_url?: { url: string } }[];
}

// OpenAI流式响应chunk格式
interface OpenAIStreamChunk {
  choices: Array<{
    delta?: { content?: string; role?: string };
    finish_reason?: string;
  }>;
}

/**
 * OpenAIAdapter - OpenAI API适配器
 * 封装与OpenAI兼容API的交互，支持聊天和流式响应
 */
export class OpenAIAdapter {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl: string = 'https://api.openai.com/v1') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  // 将内部消息格式转换为OpenAI格式
  private convertMessage(msg: Message): OpenAIMessage {
    const textContent = msg.content
      .filter(c => c.type === 'text')
      .map(c => (c as { type: 'text'; text: string }).text)
      .join('\n');

    // toolResult 消息不发送给模型
    if (msg.role === 'toolResult') return { role: 'user' as const, content: textContent };

    return {
      role: msg.role,
      content: textContent
    };
  }

  // 将工具定义转换为OpenAI格式
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

  // 非流式聊天
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

  /**
   * 流式聊天
   * 使用AsyncGenerator逐个yield内容片段
   */
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
            // 跳过无效JSON
          }
        }
      }

      yield { type: 'done' };
    } finally {
      reader.releaseLock();
    }
  }

  // 获取支持的输入类型
  supports(): ('text' | 'image' | 'audio' | 'video' | 'file')[] {
    return ['text', 'image'];
  }

  // 列出可用模型
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
