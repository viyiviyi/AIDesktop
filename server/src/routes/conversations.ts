import { Router, Request, Response } from 'express';
import { conversationService } from '../services/conversation.js';
import { appLoader } from '../services/appLoader.js';
import { agentEngine } from '../agents/engine.js';
import { piAgentManager, runAgentAsync } from '../agents/pi-agent-session.js';
import { mcpServiceRegistry } from '../mcp/service.js';
import { parseToolName } from '../agents/pi-tools.js';
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

// POST /:convId/continue — 让 agent 继续输出（不带用户新输入）
router.post('/:convId/continue', async (req: Request, res: Response) => {
  try {
    const { appId, convId } = req.params;

    const app = appLoader.getApp(appId);
    if (!app) return res.status(404).json({ error: 'App not found' });

    const conversation = await conversationService.getConversation(appId, convId);
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });

    // 检查是否已经有 agent 在运行
    const session = piAgentManager.get(appId);
    if (session && session.agent.signal !== undefined) {
      return res.status(409).json({ error: 'Agent is already processing' });
    }

    const messages = conversation.messages;

    // 检测最后一条是否为未完成的 toolCall（无对应 toolResult）
    const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
    let needsToolRetry = false;
    let toolCallId = '';
    let toolName = '';
    let toolArgs: Record<string, unknown> = {};

    if (lastMsg && lastMsg.role === 'assistant') {
      for (const c of lastMsg.content) {
        const tc = c as any;
        if (tc.type === 'toolCall' && tc.id && tc.name) {
          // 检查是否有对应的 toolResult
          let hasResult = false;
          for (let j = messages.length - 2; j >= 0; j--) {
            const prev = messages[j];
            if (prev.role === 'toolResult' && (prev as any).toolResultMeta?.toolCallId === tc.id) {
              hasResult = true;
              break;
            }
          }
          if (!hasResult) {
            needsToolRetry = true;
            toolCallId = tc.id;
            toolName = tc.name;
            toolArgs = (tc.arguments || {}) as Record<string, unknown>;
          }
        }
      }
    }

    res.json({ success: true });

    const { runAgentAsync } = await import('../agents/pi-agent-session.js');

    if (needsToolRetry) {
      // 重新执行工具调用，保存结果
      serverLogger.info('agent', `Continue: retrying tool call ${toolName} for ${appId}/${convId}`);
      try {
        const { serviceName, method: parsedMethod } = parseToolName(toolName);
        const result = await mcpServiceRegistry.callMethod(
          serviceName,
          parsedMethod,
          toolArgs,
          { appId, convId }
        );
        const resultStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
        await conversationService.addMessage(appId, convId, 'toolResult', [
          { type: 'text', text: resultStr },
        ]);
        // 发送 tool_result 事件到前端
        eventBus.emit({
          type: 'tool_result' as any,
          appId,
          convId,
          data: { toolCallId, toolName, result, isError: false },
        });
        // 工具执行完成后，重新启动 agent 继续处理
        const updatedConv = await conversationService.getConversation(appId, convId);
        runAgentAsync(appId, convId, app, updatedConv?.messages || messages, [{ type: 'text', text: '(continue)' }])
          .catch((err: any) => serverLogger.error('agent', `Continue after retry error: ${err.message}`));
      } catch (err: any) {
        serverLogger.error('agent', `Continue tool retry failed: ${err.message}`);
        // 失败时也插入错误结果，然后启动 agent
        await conversationService.addMessage(appId, convId, 'toolResult', [
          { type: 'text', text: JSON.stringify({ error: err.message }) },
        ]);
        eventBus.emit({
          type: 'tool_result' as any,
          appId,
          convId,
          data: { toolCallId, toolName, result: { error: err.message }, isError: true },
        });
        const updatedConv = await conversationService.getConversation(appId, convId);
        runAgentAsync(appId, convId, app, updatedConv?.messages || messages, [{ type: 'text', text: '(continue)' }])
          .catch((err2: any) => serverLogger.error('agent', `Continue after retry error: ${err2.message}`));
      }
    } else {
      // 正常继续——用已有消息历史 + (continue) 提示
      runAgentAsync(appId, convId, app, messages, [{ type: 'text', text: '(continue)' }])
        .catch((err: any) => serverLogger.error('agent', `Continue error: ${err.message}`));
    }

  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// DELETE /:convId/messages/:msgId — 删除单条消息（同时删除关联的 toolResult）
router.delete('/:convId/messages/:msgId', async (req: Request, res: Response) => {
  try {
    const { appId, convId, msgId } = req.params;
    const conversation = await conversationService.getConversation(appId, convId);
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });

    const idx = conversation.messages.findIndex(m => m.id === msgId);
    if (idx === -1) return res.status(404).json({ error: 'Message not found' });

    const msg = conversation.messages[idx];

    // 收集需要删除的消息 id 列表
    const idsToDelete = new Set<string>([msgId]);

    // 如果是 assistant 消息并且有 toolCall blocks，删除后续关联的 toolResult 消息
    if (msg.role === 'assistant') {
      const toolCallIds: string[] = [];
      for (const c of msg.content) {
        if ((c as any).type === 'toolCall') {
          toolCallIds.push((c as any).id);
        }
      }
      if (toolCallIds.length > 0) {
        for (let i = idx + 1; i < conversation.messages.length; i++) {
          const nextMsg = conversation.messages[i];
          if (nextMsg.role === 'toolResult' && nextMsg.toolResultMeta && toolCallIds.includes(nextMsg.toolResultMeta.toolCallId)) {
            idsToDelete.add(nextMsg.id);
          } else {
            break;
          }
        }
      }
    }

    // 过滤掉所有需要删除的消息
    conversation.messages = conversation.messages.filter(m => !idsToDelete.has(m.id));
    conversation.updatedAt = new Date().toISOString();

    // 使用 updateConversation 持久化（内部处理文件夹路径）
    await conversationService.updateConversation(appId, convId, { messages: conversation.messages } as any);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// POST /:convId/form-response — 提交/取消表单
router.post('/:convId/form-response', async (req: Request, res: Response) => {
  try {
    const { appId, convId } = req.params;
    const { formId, toolCallId, data, cancelled } = req.body;

    if (!formId) return res.status(400).json({ error: 'formId is required' });

    const conversation = await conversationService.getConversation(appId, convId);
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });

    const tcid = toolCallId || '';

    // 保存 toolResult 到消息列表
    if (cancelled) {
      const toolResultMeta = { toolCallId: tcid, toolName: 'mcp_form_requestInput', isError: false };
      const saveMsg = await conversationService.addMessage(appId, convId, 'toolResult' as any, [
        { type: 'text', text: JSON.stringify({ status: 'cancelled', message: '用户取消了表单填写' }) },
      ]);
      if (saveMsg) {
        const conv = await conversationService.getConversation(appId, convId);
        if (conv) {
          const saved = conv.messages.find((m: any) => m.id === saveMsg.id);
          if (saved) {
            saved.toolResultMeta = toolResultMeta;
            await conversationService.updateConversation(appId, convId, { messages: conv.messages } as any);
          }
        }
      }
      serverLogger.info('system', `Form ${formId} cancelled for ${appId}/${convId}`);
    } else {
      const toolResultMeta = { toolCallId: tcid, toolName: 'mcp_form_requestInput', isError: false };
      const formDataStr = JSON.stringify(data || {});
      const saveMsg = await conversationService.addMessage(appId, convId, 'toolResult' as any, [
        { type: 'text', text: formDataStr },
      ]);
      if (saveMsg) {
        const conv = await conversationService.getConversation(appId, convId);
        if (conv) {
          const saved = conv.messages.find((m: any) => m.id === saveMsg.id);
          if (saved) {
            saved.toolResultMeta = toolResultMeta;
            await conversationService.updateConversation(appId, convId, { messages: conv.messages } as any);
          }
        }
      }
      serverLogger.info('system', `Form ${formId} submitted for ${appId}/${convId}: ${JSON.stringify(data)}`);
    }

    // 通过 eventBus 通知等待中的 agent
    eventBus.emit({
      type: cancelled ? 'form_cancelled' : 'form_response',
      appId,
      convId,
      data: {
        formId,
        toolCallId: tcid,
        formData: data || {},
        cancelled: !!cancelled,
      },
    });

    // 检查是否还有其他未提交的表单
    const updatedConv = await conversationService.getConversation(appId, convId);
    let hasMorePendingForms = false;
    if (updatedConv && updatedConv.messages) {
      for (let i = 0; i < updatedConv.messages.length; i++) {
        const msg = updatedConv.messages[i];
        if (msg.role !== 'assistant') continue;
        for (const c of msg.content) {
          const tc = c as any;
          if (tc.type === 'toolCall' && (tc.name === 'mcp_form_requestInput' || tc.name === 'mcp.form.requestInput')) {
            let hasResult = false;
            for (let j = i + 1; j < updatedConv.messages.length; j++) {
              const next = updatedConv.messages[j];
              if (next.role === 'toolResult' && next.toolResultMeta?.toolCallId === tc.id) {
                const text = (next.content as any[])
                  .filter((x: any) => x.type === 'text').map((x: any) => x.text).join('');
                if (text.includes('"status":"pending"') || text.includes('"status": "pending"')) continue;
                hasResult = true;
                break;
              }
            }
            if (!hasResult) {
              hasMorePendingForms = true;
              break;
            }
          }
        }
        if (hasMorePendingForms) break;
      }
    }

    // 如果没有更多待填表单，恢复 agent 继续处理
    if (!hasMorePendingForms && !cancelled) {
      try {
        const appLoader = (await import('../services/appLoader.js')).appLoader;
        const app = appLoader.getApp(appId);
        if (!app) {
          serverLogger.error('system', `Cannot resume: app ${appId} not found`);
        } else {
          const { runAgentAsync } = await import('../agents/pi-agent-session.js');
          serverLogger.info('system', `Form submitted, resuming agent for ${appId}/${convId}`);
          setImmediate(() => {
            runAgentAsync(appId, convId, app, updatedConv?.messages || [], [{ type: 'text', text: '(continue)' }])
              .catch((err: any) => serverLogger.error('agent', `Form submit resume error: ${err.message}`));
          });
        }
      } catch (err: any) {
        serverLogger.error('system', `Failed to resume agent after form submit: ${err.message}`);
      }
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// POST /:convId/workspace-response — 提交/取消工作目录选择
router.post('/:convId/workspace-response', async (req: Request, res: Response) => {
  try {
    const { appId, convId } = req.params;
    const { toolCallId, path, cancelled } = req.body;

    serverLogger.info('system', `Workspace response for ${appId}/${convId}: ${cancelled ? 'CANCELLED' : `path=${path}`}`);

    // 保存用户选择（如果确认）
    if (!cancelled && path) {
      const fs = await import('fs');
      const p = await import('path');
      const absDir = p.resolve(path);
      if (!fs.existsSync(absDir)) {
        return res.status(400).json({ error: `目录不存在: ${absDir}` });
      }
      if (!fs.statSync(absDir).isDirectory()) {
        return res.status(400).json({ error: `不是目录: ${absDir}` });
      }
      await conversationService.updateConversation(appId, convId, { workspaceDir: absDir } as any);
    }

    // 通知等待中的 handleWorkspaceCodeMethod
    eventBus.emit({
      type: cancelled ? 'workspace_cancelled' : 'workspace_response',
      appId,
      convId,
      data: {
        toolCallId,
        path: cancelled ? undefined : path,
        cancelled: !!cancelled,
      },
    });

    serverLogger.info('system', `Workspace response sent to eventBus for ${appId}/${convId}`);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
