import type { App, Message, Content, ChatParams, ToolCall, Tool } from '../types/index.js';
import { appLoader } from '../services/appLoader.js';
import { conversationService } from '../services/conversation.js';
import { settingsService } from '../services/settings.js';
import { OpenAIAdapter } from '../models/openai.js';
import { mcpServiceRegistry } from '../mcp/service.js';

/**
 * AgentEngine - AI消息处理引擎
 * 负责处理用户消息、调用AI模型、执行工具、返回响应
 */
class AgentEngine {
  // 模型适配器缓存
  private modelAdapters: Map<string, OpenAIAdapter> = new Map();

  /**
   * 获取模型适配器（带缓存）
   * 根据provider ID获取或创建对应的OpenAI适配器
   */
  private async getModelAdapter(provider: string): Promise<OpenAIAdapter | null> {
    // 优先从缓存获取
    if (this.modelAdapters.has(provider)) {
      return this.modelAdapters.get(provider)!;
    }

    // 从设置中获取提供商配置
    const modes = await settingsService.getModes();
    const providerConfig = modes.providers.find(p => p.id === provider);

    if (!providerConfig || !providerConfig.apiKey) {
      return null;
    }

    // 创建新的适配器并缓存
    const adapter = new OpenAIAdapter(providerConfig.apiKey, providerConfig.baseUrl);
    this.modelAdapters.set(provider, adapter);
    return adapter;
  }

  /**
   * 处理用户消息
   * 核心流程：获取配置 -> 构建消息 -> 调用模型 -> 处理工具调用 -> 保存响应
   */
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

    // 获取模型配置：优先使用应用配置的模型，否则使用默认模型
    let modelConfig = app.meta.models[0];
    if (!modelConfig) {
      // 回退到默认模型
      const defaultModel = await settingsService.getDefaultModel();
      if (defaultModel.providerId && defaultModel.modelId) {
        const modes = await settingsService.getModes();
        const provider = modes.providers.find(p => p.id === defaultModel.providerId);
        if (provider) {
          const model = provider.models.find(m => m.id === defaultModel.modelId);
          if (model) {
            modelConfig = {
              provider: defaultModel.providerId,
              model: defaultModel.modelId,
              priority: 0,
              maxTokens: model.maxTokens,
              supports: model.supports,
              params: model.params
            };
          }
        }
      }
    }
    if (!modelConfig) {
      throw new Error(`No model configured for app ${appId}`);
    }

    const adapter = await this.getModelAdapter(modelConfig.provider);
    if (!adapter) {
      throw new Error(`Model provider ${modelConfig.provider} not configured`);
    }

    // 构建消息数组
    const messages: Message[] = [];

    // 添加系统消息（应用定义）
    if (app.appMd) {
      messages.push({
        id: 'system',
        role: 'system',
        content: [{ type: 'text', text: app.appMd }],
        timestamp: new Date().toISOString()
      });
    }

    // 添加对话历史
    messages.push(...conversation.messages);

    // 添加用户消息
    messages.push({
      id: 'temp-user',
      role: 'user',
      content: userMessage,
      timestamp: new Date().toISOString()
    });

    // 从MCP服务构建工具定义
    const tools = this.buildToolDefinitions(app);

    // 构建聊天参数
    const chatParams: ChatParams = {
      model: modelConfig.model,
      messages,
      temperature: modelConfig.params.temperature,
      top_p: modelConfig.params.top_p,
      max_tokens: modelConfig.maxTokens,
      tools
    };

    // 收集响应内容
    let fullContent: Content[] = [];
    const toolCalls: ToolCall[] = [];

    try {
      // 调用模型流式接口
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
            // 完成
            break;
          case 'error':
            throw new Error(event.error);
        }
      }
    } catch (error) {
      // API调用失败时返回友好错误消息
      fullContent = [{
        type: 'text',
        text: `抱歉，发生了错误：${error instanceof Error ? error.message : '未知错误'}`
      }];
    }

    // 执行工具调用（如有）
    for (const toolCall of toolCalls) {
      try {
        const [serviceName, method] = toolCall.method.split('.');
        const result = await mcpServiceRegistry.callMethod(
          `${serviceName}.${method.split('_')[0] || method}`,
          method,
          toolCall.args,
          { appId }
        );
        // 添加工具结果到消息（用于后续可能的追问）
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

    // 保存助手消息
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

  /**
   * 从应用配置构建工具定义列表
   * 将MCP服务方法转换为AI模型可识别的工具格式
   */
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
