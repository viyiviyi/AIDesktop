import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { Conversation, Message, Content } from '../types/index.js';
import {
  APPS_DATA_DIR,
  readJsonFile,
  writeJsonFile,
  readDir,
  ensureDir
} from '../utils/file.js';

/**
 * ConversationService - 会话服务
 * 管理应用会话的创建、消息存储、获取
 * 使用两级缓存：appId -> convId -> conversation
 */
class ConversationService {
  // 两级缓存：appId -> Map<convId, Conversation>
  private cache: Map<string, Map<string, Conversation>> = new Map();

  // 获取会话目录路径
  private getConversationsDir(appId: string): string {
    return path.join(APPS_DATA_DIR, appId, 'conversations');
  }

  // 获取应用的所有会话
  async getConversations(appId: string): Promise<Conversation[]> {
    if (!this.cache.has(appId)) {
      await this.loadConversations(appId);
    }
    return Array.from(this.cache.get(appId)!.values());
  }

  // 从磁盘加载会话到缓存
  private async loadConversations(appId: string): Promise<void> {
    const convDir = this.getConversationsDir(appId);
    const convs = new Map<string, Conversation>();

    try {
      const files = await readDir(convDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const conv = await readJsonFile<Conversation>(path.join(convDir, file));
          if (conv) {
            convs.set(conv.id, conv);
          }
        }
      }
    } catch {
      // 目录可能不存在
    }

    this.cache.set(appId, convs);
  }

  // 获取单个会话
  async getConversation(appId: string, convId: string): Promise<Conversation | null> {
    if (!this.cache.has(appId)) {
      await this.loadConversations(appId);
    }
    return this.cache.get(appId)!.get(convId) || null;
  }

  // 创建新会话
  async createConversation(appId: string, title?: string): Promise<Conversation> {
    const convDir = this.getConversationsDir(appId);
    await ensureDir(convDir);

    const now = new Date().toISOString();
    const conv: Conversation = {
      id: uuidv4(),
      appId,
      title: title || '新会话',
      createdAt: now,
      updatedAt: now,
      messages: []
    };

    await writeJsonFile(path.join(convDir, `${conv.id}.json`), conv);

    if (!this.cache.has(appId)) {
      this.cache.set(appId, new Map());
    }
    this.cache.get(appId)!.set(conv.id, conv);

    return conv;
  }

  // 添加消息到会话
  async addMessage(
    appId: string,
    convId: string,
    role: 'user' | 'assistant' | 'system',
    content: Content[],
    toolCalls?: { id: string; tool: string; method: string; args: Record<string, unknown> }[],
    replyTo?: string,
  ): Promise<Message | null> {
    const conv = await this.getConversation(appId, convId);
    if (!conv) return null;

    const message: Message = {
      id: uuidv4(),
      role,
      content,
      timestamp: new Date().toISOString(),
      toolCalls,
      replyTo,
    };

    conv.messages.push(message);
    conv.updatedAt = new Date().toISOString();

    const convDir = this.getConversationsDir(appId);
    await writeJsonFile(path.join(convDir, `${convId}.json`), conv);

    return message;
  }

  // 编辑指定消息的内容
  async editMessage(
    appId: string,
    convId: string,
    msgId: string,
    content: Content[],
  ): Promise<Message | null> {
    const conv = await this.getConversation(appId, convId);
    if (!conv) return null;

    const idx = conv.messages.findIndex(m => m.id === msgId);
    if (idx === -1) return null;

    const oldMsg = conv.messages[idx];

    // 标记原消息为已编辑
    oldMsg.edited = true;

    // 在原消息之后创建一个新的 user 消息作为新分支
    const branchMsg: Message = {
      id: uuidv4(),
      role: oldMsg.role,
      content,
      timestamp: new Date().toISOString(),
      replyTo: oldMsg.replyTo, // 保持同样的回复链
    };

    // 插入到原消息之后
    conv.messages.splice(idx + 1, 0, branchMsg);
    conv.updatedAt = new Date().toISOString();

    const convDir = this.getConversationsDir(appId);
    await writeJsonFile(path.join(convDir, `${convId}.json`), conv);

    return branchMsg;
  }

  // 更新会话标题
  async updateConversationTitle(appId: string, convId: string, title: string): Promise<boolean> {
    const conv = await this.getConversation(appId, convId);
    if (!conv) return false;

    conv.title = title;
    conv.updatedAt = new Date().toISOString();

    const convDir = this.getConversationsDir(appId);
    await writeJsonFile(path.join(convDir, `${convId}.json`), conv);

    return true;
  }

  // 删除会话
  async deleteConversation(appId: string, convId: string): Promise<boolean> {
    const conv = await this.getConversation(appId, convId);
    if (!conv) return false;

    const { rm } = await import('fs/promises');
    const filePath = path.join(this.getConversationsDir(appId), `${convId}.json`);

    try {
      await rm(filePath);
      this.cache.get(appId)?.delete(convId);
      return true;
    } catch {
      return false;
    }
  }

  // 清空缓存
  clearCache(appId?: string): void {
    if (appId) {
      this.cache.delete(appId);
    } else {
      this.cache.clear();
    }
  }
}

export const conversationService = new ConversationService();
