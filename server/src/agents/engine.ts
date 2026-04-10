import type { App, Message, Content, ChatParams, ToolCall, Tool } from '../types/index.js';
import { appLoader } from '../services/appLoader.js';
import { conversationService } from '../services/conversation.js';
import { settingsService } from '../services/settings.js';
import { OpenAIAdapter } from '../models/openai.js';
import { mcpServiceRegistry } from '../mcp/service.js';

class AgentEngine {
  private modelAdapters: Map<string, OpenAIAdapter> = new Map();

  private async getModelAdapter(provider: string): Promise<OpenAIAdapter | null> {
    if (this.modelAdapters.has(provider)) {
      return this.modelAdapters.get(provider)!;
    }

    const modes = await settingsService.getModes();
    const providerConfig = modes.providers.find(p => p.name === provider);

    if (!providerConfig || !providerConfig.apiKey) {
      return null;
    }

    const adapter = new OpenAIAdapter(providerConfig.apiKey, providerConfig.baseUrl);
    this.modelAdapters.set(provider, adapter);
    return adapter;
  }

  async processMessage(
    appId: string,
    convId: string,
    userMessage: Content[]
  ): Promise<{ assistantMessage: Message }> {
    const app = appLoader.getApp(appId);
    if (!app) {
      throw new Error(`App ${appId} not found`);
    }

    const conversation = await conversationService.getConversation(appId, convId);
    if (!conversation) {
      throw new Error(`Conversation ${convId} not found`);
    }

    // Get model config - use first available
    const modelConfig = app.meta.models[0];
    if (!modelConfig) {
      throw new Error(`No model configured for app ${appId}`);
    }

    const adapter = await this.getModelAdapter(modelConfig.provider);
    if (!adapter) {
      throw new Error(`Model provider ${modelConfig.provider} not configured`);
    }

    // Build messages array
    const messages: Message[] = [];

    // System message with app definition
    if (app.appMd) {
      messages.push({
        id: 'system',
        role: 'system',
        content: [{ type: 'text', text: app.appMd }],
        timestamp: new Date().toISOString()
      });
    }

    // Add conversation history
    messages.push(...conversation.messages);

    // Add user message
    messages.push({
      id: 'temp-user',
      role: 'user',
      content: userMessage,
      timestamp: new Date().toISOString()
    });

    // Build tool definitions from MCP services
    const tools = this.buildToolDefinitions(app);

    // Call model
    const chatParams: ChatParams = {
      model: modelConfig.model,
      messages,
      temperature: modelConfig.params.temperature,
      top_p: modelConfig.params.top_p,
      max_tokens: modelConfig.maxTokens,
      tools
    };

    // Collect response
    let fullContent: Content[] = [];
    const toolCalls: ToolCall[] = [];

    try {
      for await (const event of adapter.chatStream(chatParams)) {
        switch (event.type) {
          case 'content':
            fullContent.push(event.content);
            break;
          case 'tool_call':
            if (event.toolCall) {
              toolCalls.push(event.toolCall);
            }
            break;
          case 'done':
            // Finished
            break;
          case 'error':
            throw new Error(event.error);
        }
      }
    } catch (error) {
      // If API fails, return a helpful error message
      fullContent = [{
        type: 'text',
        text: `抱歉，发生了错误：${error instanceof Error ? error.message : '未知错误'}`
      }];
    }

    // Execute tool calls if any
    for (const toolCall of toolCalls) {
      try {
        const [serviceName, method] = toolCall.method.split('.');
        const result = await mcpServiceRegistry.callMethod(
          `${serviceName}.${method.split('_')[0] || method}`,
          method,
          toolCall.args,
          { appId }
        );
        // Add tool result to messages for potential follow-up
        messages.push({
          id: `tool-${toolCall.id}`,
          role: 'system',
          content: [{
            type: 'text',
            text: `Tool result: ${JSON.stringify(result)}`
          }],
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        messages.push({
          id: `tool-error-${toolCall.id}`,
          role: 'system',
          content: [{
            type: 'text',
            text: `Tool error: ${error instanceof Error ? error.message : 'Unknown error'}`
          }],
          timestamp: new Date().toISOString()
        });
      }
    }

    // Save assistant message
    const assistantMessage = await conversationService.addMessage(
      appId,
      convId,
      'assistant',
      fullContent.length > 0 ? fullContent : [{ type: 'text', text: '' }],
      toolCalls.length > 0 ? toolCalls : undefined
    );

    if (!assistantMessage) {
      throw new Error('Failed to save assistant message');
    }

    return { assistantMessage };
  }

  private buildToolDefinitions(app: App): Tool[] {
    const tools: Tool[] = [];

    for (const toolName of app.meta.tools) {
      const service = mcpServiceRegistry.getService(toolName);
      if (service) {
        for (const method of service.methods) {
          tools.push({
            type: 'function',
            function: {
              name: `${service.name}.${method}`,
              description: `${method} - ${service.description}`,
              parameters: {
                type: 'object',
                properties: {
                  args: { type: 'object', description: 'Method arguments' }
                }
              }
            }
          });
        }
      }
    }

    return tools;
  }
}

export const agentEngine = new AgentEngine();
