import { Router, Request, Response } from 'express';
import { conversationService } from '../services/conversation.js';
import { appLoader } from '../services/appLoader.js';
import { agentEngine } from '../agents/engine.js';
import { piAgentManager } from '../agents/pi-agent-session.js';
import { eventBus } from '../services/eventBus.js';
import { serverLogger } from '../utils/logger.js';

const router = Router({ mergeParams: true });

// 存储活跃的 agent 流（convId -> abort）
const activeStreams = new Map<string, () => void>();

// Get all conversations for an app
router.get('/', async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;
    const app = appLoader.getApp(appId);
    if (!app) return res.status(404).json({ error: 'App not found' });

    const conversations = await conversationService.getConversations(appId);
    res.json({ conversations });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Get single conversation
router.get('/:convId', async (req: Request, res: Response) => {
  try {
    const { appId, convId } = req.params;
    const conversation = await conversationService.getConversation(appId, convId);
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
    res.json(conversation);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Create new conversation
router.post('/', async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;
    const { title } = req.body;
    const app = appLoader.getApp(appId);
    if (!app) return res.status(404).json({ error: 'App not found' });
    const conversation = await conversationService.createConversation(appId, title);
    res.status(201).json(conversation);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Delete conversation
router.delete('/:convId', async (req: Request, res: Response) => {
  try {
    const { appId, convId } = req.params;
    const abort = activeStreams.get(convId);
    if (abort) { abort(); activeStreams.delete(convId); }
    const deleted = await conversationService.deleteConversation(appId, convId);
    if (!deleted) return res.status(404).json({ error: 'Conversation not found' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * POST /:convId/messages — 发送消息（事件驱动）
 *
 * 1. 保存 user 消息到持久化
 * 2. 立即返回 userMessage
 * 3. 后台异步启动 agent，所有事件通过 EventBus → WebSocket 推送给前端
 */
router.post('/:convId/messages', async (req: Request, res: Response) => {
  try {
    const { appId, convId } = req.params;
    const { content } = req.body;

    if (!content || !Array.isArray(content)) {
      return res.status(400).json({ error: 'Content is required and must be an array' });
    }

    const app = appLoader.getApp(appId);
    if (!app) return res.status(404).json({ error: 'App not found' });

    const conversation = await conversationService.getConversation(appId, convId);
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });

    // 1. 保存 user 消息
    const savedUserMsg = await conversationService.addMessage(appId, convId, 'user', content);
    if (!savedUserMsg) throw new Error('Failed to save user message');

    // 2. 立即返回
    res.json({ userMessage: savedUserMsg });

    // 3. 后台异步启动 agent 处理（不阻塞响应）
    runAgentAsync(appId, convId, app, conversation.messages, content)
      .catch(err => serverLogger.error('system', `Agent async error: ${err.message}`));

  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/** 后台异步运行 agent，所有事件推送到 EventBus */
async function runAgentAsync(
  appId: string,
  convId: string,
  app: any,
  existingMessages: any[],
  userContent: any[],
): Promise<void> {
  const fullHistory = [...existingMessages, { role: 'user', content: userContent }];
  const session = await piAgentManager.getOrCreate(appId, app);

  // 订阅 agent 事件 → 推送到 EventBus
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
      case 'agent_end':
        // agent 结束 — 保存 assistant 消息
        break;
    }
  });

  // 逐 token 文本回调 → EventBus
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

// Update conversation title
router.put('/:convId', async (req: Request, res: Response) => {
  try {
    const { appId, convId } = req.params;
    const { title } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });
    const updated = await conversationService.updateConversationTitle(appId, convId, title);
    if (!updated) return res.status(404).json({ error: 'Conversation not found' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
