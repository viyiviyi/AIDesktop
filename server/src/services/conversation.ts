import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { readFileSync } from 'fs';
import type { Conversation, Message, Content, ConversationSource, FileRef } from '../types/index.js';
import {
  APPS_DATA_DIR,
  readJsonFile,
  writeJsonFile,
  readDir,
  ensureDir
} from '../utils/file.js';
import { rm } from 'fs/promises';

const SERVER_VERSION: string = (() => {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

/** 根据时间戳生成会话文件夹名：yyyyMMddHHmmss-SSS */
function convDirName(ts: string): string {
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/**
 * ConversationService - 会话服务
 * 管理应用会话的创建、消息存储、获取
 * 每个会话一个文件夹：conversations/{yyyyMMddHHmmss}/
 *   - conversation.json  -> 会话数据
 *   - {uuid}.png 等      -> 附件
 */
class ConversationService {
  // 两级缓存：appId -> Map<convId, Conversation>
  private cache: Map<string, Map<string, Conversation>> = new Map();

  // 获取会话目录路径
  private getConversationsDir(appId: string): string {
    return path.join(APPS_DATA_DIR, appId, 'conversations');
  }

  // 获取单会话文件夹路径
  async getConvFolder(appId: string, convId: string): Promise<string | null> {
    const convDir = this.getConversationsDir(appId);
    // 先从缓存中找
    const cacheEntry = this.cache.get(appId);
    if (cacheEntry) {
      for (const [savedId, conv] of cacheEntry) {
        if (savedId === convId) {
          return path.join(convDir, convDirName(conv.createdAt));
        }
      }
    }
    // 缓存中没有，扫描文件夹
    try {
      const folders = await readDir(convDir);
      for (const folder of folders) {
        const jsonPath = path.join(convDir, folder, 'conversation.json');
        try {
          const data = JSON.parse(require('fs').readFileSync(jsonPath, 'utf-8'));
          if (data.id === convId) {
            return path.join(convDir, folder);
          }
        } catch {}
      }
    } catch {}
    return null;
  }

  // 获取应用的所有会话
  async getConversations(appId: string): Promise<Conversation[]> {
    await this.loadConversations(appId);
    return Array.from(this.cache.get(appId)!.values());
  }

  // 从磁盘加载会话到缓存
  private async loadConversations(appId: string): Promise<void> {
    const convDir = this.getConversationsDir(appId);
    const convs = new Map<string, Conversation>();

    try {
      const entries = await readDir(convDir);
      // 按文件名/文件夹名排序（时间戳倒序），最新的在前
      entries.sort().reverse();
      for (const entry of entries) {
        const entryPath = path.join(convDir, entry);
        let conv: Conversation | null = null;
        // 新格式：{dateTime}/conversation.json
        const jsonPath = path.join(entryPath, 'conversation.json');
        conv = await readJsonFile<Conversation>(jsonPath);
        // 旧格式：{uuid}.json（向后兼容）
        if (!conv && entry.endsWith('.json')) {
          conv = await readJsonFile<Conversation>(entryPath);
          if (conv) {
            // 自动迁移到新格式
            const folderName = convDirName(conv.createdAt);
            const folderPath = path.join(convDir, folderName);
            await ensureDir(folderPath);
            await writeJsonFile(path.join(folderPath, 'conversation.json'), conv);
            try { await rm(entryPath); } catch {}
          }
        }
        if (conv) {
          convs.set(conv.id, conv);
        }
      }
    } catch {
      // 目录可能不存在
    }

    this.cache.set(appId, convs);
  }

  /**
   * 内部：获取缓存中的原始会话引用（供写操作使用）
   * 不深拷贝、不解引用，直接操作缓存对象
   */
  private async getCachedConversation(appId: string, convId: string): Promise<Conversation | null> {
    if (!this.cache.has(appId)) {
      await this.loadConversations(appId);
    }
    if (!this.cache.get(appId)!.has(convId)) {
      await this.loadConversations(appId);
    }
    return this.cache.get(appId)!.get(convId) || null;
  }

  /** 写操作完成后，将修改后的 conv 同步到缓存 */
  private syncToCache(conv: Conversation): void {
    const appId = conv.appId;
    if (!this.cache.has(appId)) {
      this.cache.set(appId, new Map());
    }
    this.cache.get(appId)!.set(conv.id, conv);
  }

  /**
   * 获取单个会话（公开的读接口）
   * 返回深拷贝 + 已解引 _fileRef 的数据，不污染缓存
   */
  async getConversation(appId: string, convId: string): Promise<Conversation | null> {
    const conv = await this.getCachedConversation(appId, convId);
    if (!conv) return null;

    // 深拷贝，避免污染缓存
    const resolved = JSON.parse(JSON.stringify(conv)) as Conversation;
    await this.resolveFileRefs(resolved.messages, appId);
    return resolved;
  }

  /**
   * 递归扫描消息中的 _fileRef 对象，读取实际文件内容替换。
   * _fileRef 格式: 'appId/convFolderName/uuid.txt'
   * 物理路径: APPS_DATA_DIR/appId/conversations/convFolderName/attachments/uuid.txt
   */
  private async resolveFileRefs(messages: Message[], appId: string): Promise<void> {
    const fs = await import('fs/promises');
    const resolveDir = path.join(APPS_DATA_DIR, appId, 'conversations');

    async function walk(value: unknown): Promise<unknown> {
      if (!value || typeof value !== 'object') return value;
      if (Array.isArray(value)) {
        return Promise.all(value.map(v => walk(v)));
      }
      const obj = value as Record<string, unknown>;
      // 检测 _fileRef 对象
      if (typeof obj._fileRef === 'string' && typeof obj._originalSize === 'number') {
        const ref = obj as unknown as FileRef;
        // _fileRef 格式: appId/convFolderName/uuid.txt
        const parts = ref._fileRef.split('/');
        if (parts.length === 3) {
          const [_appId, convFolder, fileName] = parts;
          const filePath = path.join(resolveDir, convFolder, 'attachments', fileName);
          try {
            const content = await fs.readFile(filePath, 'utf-8');
            return content;
          } catch {
            // 文件不存在或无法读取，保持原样
            return value;
          }
        }
        return value;
      }
      // 普通对象，递归处理
      for (const key of Object.keys(obj)) {
        obj[key] = await walk(obj[key]);
      }
      return obj;
    }

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      // 递归处理 content 数组中的每个 block
      if (Array.isArray(msg.content)) {
        msg.content = await walk(msg.content) as Content[];
      }
    }
  }

  // 创建新会话
  async createConversation(appId: string, title?: string, source?: ConversationSource, callChain?: Conversation['callChain']): Promise<Conversation> {
    const convDir = this.getConversationsDir(appId);

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

    const folderName = convDirName(now);
    const convFolder = path.join(convDir, folderName);
    await ensureDir(convFolder);
    await writeJsonFile(path.join(convFolder, 'conversation.json'), conv);

    this.syncToCache(conv);

    return conv;
  }

  // 添加消息到会话
  async addMessage(
    appId: string,
    convId: string,
    role: 'user' | 'assistant' | 'system' | 'toolResult',
    content: Content[],
    toolCalls?: { id: string; tool: string; method: string; args: Record<string, unknown> }[],
    replyTo?: string,
  ): Promise<Message | null> {
    const conv = await this.getCachedConversation(appId, convId);
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

    const convFolder = await this.getConvFolder(appId, convId);
    if (convFolder) await writeJsonFile(path.join(convFolder, 'conversation.json'), conv);

    // 缓存已通过引用更新
    return message;
  }

  // 编辑指定消息的内容
  async editMessage(
    appId: string,
    convId: string,
    msgId: string,
    content: Content[],
  ): Promise<Message | null> {
    const conv = await this.getCachedConversation(appId, convId);
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

    const convFolder = await this.getConvFolder(appId, convId);
    if (convFolder) await writeJsonFile(path.join(convFolder, 'conversation.json'), conv);

    return branchMsg;
  }

  // 更新会话标题
  async updateConversationTitle(appId: string, convId: string, title: string): Promise<boolean> {
    const conv = await this.getCachedConversation(appId, convId);
    if (!conv) return false;

    conv.title = title;
    conv.updatedAt = new Date().toISOString();

    const convFolder = await this.getConvFolder(appId, convId);
    if (convFolder) await writeJsonFile(path.join(convFolder, 'conversation.json'), conv);

    return true;
  }

  // 删除会话
  async deleteConversation(appId: string, convId: string): Promise<boolean> {
    const conv = await this.getCachedConversation(appId, convId);
    if (!conv) return false;

    const convDir = this.getConversationsDir(appId);
    const convFolder = path.join(convDir, convDirName(conv.createdAt));

    try {
      await rm(convFolder, { recursive: true, force: true });
      this.cache.get(appId)?.delete(convId);
      return true;
    } catch {
      return false;
    }
  }

  // 更新会话（全量替换）
  async updateConversation(appId: string, convId: string, updates: Partial<Conversation>): Promise<boolean> {
    const conv = await this.getCachedConversation(appId, convId);
    if (!conv) return false;

    Object.assign(conv, updates);
    conv.updatedAt = new Date().toISOString();

    const convFolder = await this.getConvFolder(appId, convId);
    if (convFolder) await writeJsonFile(path.join(convFolder, 'conversation.json'), conv);

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
