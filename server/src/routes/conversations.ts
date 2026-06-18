import { Router, Request, Response } from 'express';
import { conversationService } from '../services/conversation.js';
import { appLoader } from '../services/appLoader.js';
import { agentEngine } from '../agents/engine.js';
import { piAgentManager, runAgentAsync } from '../agents/pi-agent-session.js';
import { eventBus } from '../services/eventBus.js';
import { serverLogger } from '../utils/logger.js';
import path from 'path';
import fs from 'fs/promises';
import * as crypto from 'node:crypto';
import { APPS_DATA_DIR, ensureDir, readDir } from '../utils/file.js';

const router = Router({ mergeParams: true });

// 存储活跃的 agent 流（convId -> abort）
const activeStreams = new Map<string, () => void>();

/** 将会话中的 dataURL 提取为附件文件，替换为文件路径引用 */
async function saveContentAttachments(
  appId: string,
  convId: string,
  content: any[],
): Promise<any[]> {
  const result: any[] = [];
  for (const block of content) {
    if (block.type === 'image' && typeof block.url === 'string' && block.url.startsWith('data:')) {
      const ext = block.url.split(';')[0].split('/')[1] || 'png';
      const fileName = `${crypto.randomUUID()}.${ext}`;
      // 获取会话文件夹路径
      const conv = await conversationService.getConversation(appId, convId);
      if (!conv) {
        result.push({ ...block, url: '' });
        continue;
      }
      const convDir = path.join(APPS_DATA_DIR, appId, 'conversations');
      const folders = await readDir(convDir);
      const dirName = folders.find(f => {
        const jsonPath = path.join(convDir, f, 'conversation.json');
        try { const data = JSON.parse(require('fs').readFileSync(jsonPath, 'utf-8')); return data.id === convId; } catch { return false; }
      });
      if (!dirName) {
        result.push(block);
        continue;
      }
      const convFolder = path.join(convDir, dirName);
      const base64Data = block.url.split(',')[1];
      await fs.writeFile(path.join(convFolder, fileName), base64Data, 'base64');
      result.push({ ...block, url: `/api/files/${appId}/conversations/${dirName}/${fileName}` });
    } else {
      result.push(block);
    }
  }
  return result;
}

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
    const { content, replyTo } = req.body;

    if (!content || !Array.isArray(content)) {
      return res.status(400).json({ error: 'Content is required and must be an array' });
    }

    const app = appLoader.getApp(appId);
    if (!app) return res.status(404).json({ error: 'App not found' });

    const conversation = await conversationService.getConversation(appId, convId);
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });

    // 1. 保存 user 消息（图片 dataURL 提取为附件文件）
    const processedContent = await saveContentAttachments(appId, convId, content);
    const savedUserMsg = await conversationService.addMessage(appId, convId, 'user', processedContent, undefined, replyTo);
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

// PUT /:convId/messages/:msgId — 编辑消息（产生新分支）
router.put('/:convId/messages/:msgId', async (req: Request, res: Response) => {
  try {
    const { appId, convId, msgId } = req.params;
    const { content } = req.body;

    if (!content || !Array.isArray(content)) {
      return res.status(400).json({ error: 'Content is required and must be an array' });
    }

    const branchMsg = await conversationService.editMessage(appId, convId, msgId, content);
    if (!branchMsg) return res.status(404).json({ error: 'Message not found' });

    res.json({ message: branchMsg });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// POST /:convId/abort — 终止 agent 处理
router.post('/:convId/abort', async (req: Request, res: Response) => {
  const { appId, convId } = req.params;
  const session = piAgentManager.get(appId);
  if (session && session.agent) {
    session.agent.abort();
    eventBus.emit({ type: 'done', appId, convId, data: { aborted: true } });
    res.json({ success: true, message: 'Agent 已终止' });
  } else {
    res.json({ success: false, message: '没有活跃的 agent 处理' });
  }
});

// DELETE /:convId/messages/:msgId — 删除单条消息
router.delete('/:convId/messages/:msgId', async (req: Request, res: Response) => {
  try {
    const { appId, convId, msgId } = req.params;
    const conversation = await conversationService.getConversation(appId, convId);
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });

    const idx = conversation.messages.findIndex(m => m.id === msgId);
    if (idx === -1) return res.status(404).json({ error: 'Message not found' });

    conversation.messages.splice(idx, 1);
    conversation.updatedAt = new Date().toISOString();

    const { writeJsonFile } = await import('../utils/file.js');
    const path = await import('path');
    const { APPS_DATA_DIR } = await import('../utils/file.js');
    await writeJsonFile(path.join(APPS_DATA_DIR, appId, 'conversations', `${convId}.json`), conversation);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
