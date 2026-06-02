/**
 * AgentEngine - AI 消息处理引擎
 */

import type { Content, Message } from "../types/index.js";
import { appLoader } from "../services/appLoader.js";
import { conversationService } from "../services/conversation.js";
import { piAgentManager } from "./pi-agent-session.js";

class AgentEngine {
  async processMessage(
    appId: string,
    convId: string,
    userContent: Content[],
  ): Promise<{ assistantMessage: Message }> {
    const app = appLoader.getApp(appId);
    if (!app) throw new Error(`App ${appId} not found`);

    const conversation = await conversationService.getConversation(appId, convId);
    if (!conversation) throw new Error(`Conversation ${convId} not found`);

    // 1. 保存用户消息
    const savedUserMsg = await conversationService.addMessage(appId, convId, "user", userContent);
    if (!savedUserMsg) throw new Error("Failed to save user message");

    // 2. 完整历史（含刚加的 user）
    const updatedMessages = [...conversation.messages, savedUserMsg];

    try {
      const session = await piAgentManager.getOrCreate(appId, app);
      // 3. syncHistory 会去掉最后一条 user，prompt 自动创建它
      const assistantMsg = await session.sendMessage(convId, updatedMessages, userContent);

      const text = assistantMsg.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("");

      // 如果返回空内容，说明 LLM 调用失败但没有抛异常
      if (!text || text === "(empty)") {
        throw new Error("AI 模型调用返回空内容，请检查 API Key 和模型配置是否正确。");
      }

      // 4. 保存 assistant 回复
      const saved = await conversationService.addMessage(appId, convId, "assistant", assistantMsg.content);
      return { assistantMessage: saved || assistantMsg };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error";
      const saved = await conversationService.addMessage(appId, convId, "assistant", [
        { type: "text", text: `Error: ${errMsg}` },
      ]);
      return {
        assistantMessage: saved || {
          id: `err-${Date.now()}`,
          role: "assistant",
          content: [{ type: "text", text: `Error: ${errMsg}` }],
          timestamp: new Date().toISOString(),
        },
      };
    }
  }

  async *streamMessage(
    appId: string,
    convId: string,
    userText: string,
  ): AsyncGenerator<string, void, unknown> {
    const app = appLoader.getApp(appId);
    if (!app) throw new Error(`App ${appId} not found`);

    const conversation = await conversationService.getConversation(appId, convId);
    if (!conversation) throw new Error(`Conversation ${convId} not found`);

    const savedUserMsg = await conversationService.addMessage(appId, convId, "user", [
      { type: "text", text: userText },
    ]);
    if (!savedUserMsg) throw new Error("Failed to save user message");

    const updatedMessages = [...conversation.messages, savedUserMsg];
    const session = await piAgentManager.getOrCreate(appId, app);

    let fullText = "";
    try {
      for await (const chunk of session.streamMessage(convId, updatedMessages, userText)) {
        fullText += chunk;
        yield chunk;
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error";
      yield `Error: ${errMsg}`;
      fullText = `Error: ${errMsg}`;
    }

    if (fullText) {
      await conversationService.addMessage(appId, convId, "assistant", [
        { type: "text", text: fullText },
      ]);
    }
  }
}

export const agentEngine = new AgentEngine();
