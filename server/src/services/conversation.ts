import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { Conversation, Message, Content } from '../types/index.js';
import {
  APPS_DIR,
  readJsonFile,
  writeJsonFile,
  readDir,
  ensureDir
} from '../utils/file.js';

class ConversationService {
  private cache: Map<string, Map<string, Conversation>> = new Map(); // appId -> convId -> conversation

  private getConversationsDir(appId: string): string {
    return path.join(APPS_DIR, appId, 'data', 'conversations');
  }

  async getConversations(appId: string): Promise<Conversation[]> {
    if (!this.cache.has(appId)) {
      await this.loadConversations(appId);
    }
    return Array.from(this.cache.get(appId)!.values());
  }

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
      // Directory might not exist
    }

    this.cache.set(appId, convs);
  }

  async getConversation(appId: string, convId: string): Promise<Conversation | null> {
    if (!this.cache.has(appId)) {
      await this.loadConversations(appId);
    }
    return this.cache.get(appId)!.get(convId) || null;
  }

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

  async addMessage(
    appId: string,
    convId: string,
    role: 'user' | 'assistant' | 'system',
    content: Content[],
    toolCalls?: { id: string; tool: string; method: string; args: Record<string, unknown> }[]
  ): Promise<Message | null> {
    const conv = await this.getConversation(appId, convId);
    if (!conv) return null;

    const message: Message = {
      id: uuidv4(),
      role,
      content,
      timestamp: new Date().toISOString(),
      toolCalls
    };

    conv.messages.push(message);
    conv.updatedAt = new Date().toISOString();

    const convDir = this.getConversationsDir(appId);
    await writeJsonFile(path.join(convDir, `${convId}.json`), conv);

    return message;
  }

  async updateConversationTitle(appId: string, convId: string, title: string): Promise<boolean> {
    const conv = await this.getConversation(appId, convId);
    if (!conv) return false;

    conv.title = title;
    conv.updatedAt = new Date().toISOString();

    const convDir = this.getConversationsDir(appId);
    await writeJsonFile(path.join(convDir, `${convId}.json`), conv);

    return true;
  }

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

  clearCache(appId?: string): void {
    if (appId) {
      this.cache.delete(appId);
    } else {
      this.cache.clear();
    }
  }
}

export const conversationService = new ConversationService();
