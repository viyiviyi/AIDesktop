import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { readFileSync } from 'fs';
import type { Conversation, Message, Content, ConversationSource } from '../types/index.js';
import {
  APPS_DATA_DIR,
  readJsonFile,
  writeJsonFile,
  readDir,
  ensureDir
} from '../utils/file.js';

const SERVER_VERSION: string = (() => {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

/** 根据会话对象生成文件名：yyyyMMddHHmmss-serverVersion.json */
function convFileName(conv: Conversation): string {
  const d = new Date(conv.createdAt);
  const pad = (n: number) => n.toString().padStart(2, '0');
  const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `${ts}-${SERVER_VERSION}.json`;
}

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
  async createConversation(appId: string, title?: string, source?: ConversationSource, callChain?: Conversation['callChain']): Promise<Conversation> {
    const convDir = this.getConversationsDir(appId);
    await ensureDir(convDir);

    const now = new Date().toISOString();
    const conv: Conversation = {
      id: uuidv4(),
      appId,
      title: title || '新会话',
      createdAt: now,
      updatedAt: now,
      messages: [],
      source,
      callChain,
    };

    await writeJsonFile(path.join(convDir, convFileName(conv)), conv);

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
    await writeJsonFile(path.join(convDir, `convFileName(conv)`), conv);

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
    await writeJsonFile(path.join(convDir, `convFileName(conv)`), conv);

    return branchMsg;
  }

  // 更新会话标题
  async updateConversationTitle(appId: string, convId: string, title: string): Promise<boolean> {
    const conv = await this.getConversation(appId, convId);
    if (!conv) return false;

    conv.title = title;
    conv.updatedAt = new Date().toISOString();

    const convDir = this.getConversationsDir(appId);
    await writeJsonFile(path.join(convDir, `convFileName(conv)`), conv);

    return true;
  }

  // 删除会话
  async deleteConversation(appId: string, convId: string): Promise<boolean> {
    const conv = await this.getConversation(appId, convId);
    if (!conv) return false;

    const { rm } = await import('fs/promises');
    const filePath = path.join(this.getConversationsDir(appId), convFileName(conv));

    try {
      await rm(filePath);
      this.cache.get(appId)?.delete(convId);
      return true;
    } catch {
      return false;
    }
  }

  // 更新会话（全量替换，用于更新 messages 等复杂字段）
  async updateConversation(appId: string, convId: string, updates: Partial<Conversation>): Promise<boolean> {
    const conv = await this.getConversation(appId, convId);
    if (!conv) return false;

    Object.assign(conv, updates);
    conv.updatedAt = new Date().toISOString();

    const convDir = this.getConversationsDir(appId);
    await writeJsonFile(path.join(convDir, `convFileName(conv)`), conv);

    return true;
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
