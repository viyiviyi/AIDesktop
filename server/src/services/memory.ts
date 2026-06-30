/**
 * MemoryService — AIDesktop 2.0 记忆与目标管理系统
 *
 * 纯文件系统存储，不依赖外部数据库/向量引擎。
 *
 * 存储结构:
 *   desktop_data/apps_data/{appId}/memories.json         — 应用级记忆
 *   desktop_data/apps_data/{appId}/conversations/{convId}/memories.json — 会话级记忆
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { APPS_DATA_DIR } from '../utils/file.js';
import { serverLogger } from '../utils/logger.js';
import type {
  MemoryEntry,
  MemoryType,
  MemoryScope,
  MemorySource,
  MemoryQuery,
  MemoryStore,
  GoalTree,
  MemoryStats,
} from '../types/index.js';

const IMPORTANCE_ORDER: Record<string, number> = {
  high: 0,
  normal: 1,
  low: 2,
};

class MemoryService {
  // =====================================================
  // 路径辅助
  // =====================================================

  private storePath(appId: string, convId?: string): string {
    if (convId) {
      return path.join(APPS_DATA_DIR, appId, 'conversations', convId, 'memories.json');
    }
    return path.join(APPS_DATA_DIR, appId, 'memories.json');
  }

  // =====================================================
  // 读写持久化
  // =====================================================

  private async loadStore(scope: MemoryScope, appId: string, convId?: string): Promise<MemoryStore> {
    const fp = this.storePath(appId, scope === 'conversation' ? convId : undefined);
    try {
      const raw = await fs.readFile(fp, 'utf-8');
      return JSON.parse(raw) as MemoryStore;
    } catch {
      return { entries: [] };
    }
  }

  private async saveStore(scope: MemoryScope, appId: string, store: MemoryStore, convId?: string): Promise<void> {
    const fp = this.storePath(appId, scope === 'conversation' ? convId : undefined);
    await fs.mkdir(path.dirname(fp), { recursive: true });
    await fs.writeFile(fp, JSON.stringify(store, null, 2), 'utf-8');
  }

  // =====================================================
  // 工具方法
  // =====================================================

  private generateId(): string {
    return crypto.randomUUID();
  }

  private now(): string {
    return new Date().toISOString();
  }

  private getImportanceLevel(entry: MemoryEntry): number {
    for (const tag of entry.tags) {
      const match = tag.match(/^importance\/(.+)$/);
      if (match) {
        return IMPORTANCE_ORDER[match[1]] ?? 99;
      }
    }
    return 99; // 默认最低优先级
  }

  private defaultTags(type: MemoryType, source: MemorySource, tags?: string[]): string[] {
    const result: string[] = [...(tags || [])];
    if (!result.some(t => t.startsWith('source/'))) {
      result.push(`source/${source}`);
    }
    if (type === 'goal') {
      if (!result.some(t => t.startsWith('goal/'))) {
        result.push('goal/active');
      }
    }
    return result;
  }

  private matchQuery(entry: MemoryEntry, query: MemoryQuery): boolean {
    // 精确 key 匹配
    if (query.key !== undefined && entry.key !== query.key) return false;

    // key 前缀匹配
    if (query.keyPrefix !== undefined && !entry.key.startsWith(query.keyPrefix)) return false;

    // type 匹配
    if (query.type !== undefined && entry.type !== query.type) return false;

    // tags AND 过滤
    if (query.tags !== undefined && query.tags.length > 0) {
      for (const tag of query.tags) {
        if (!entry.tags.includes(tag)) return false;
      }
    }

    // tagsAny OR 过滤
    if (query.tagsAny !== undefined && query.tagsAny.length > 0) {
      const matched = query.tagsAny.some(tag => entry.tags.includes(tag));
      if (!matched) return false;
    }

    // 全文检索
    if (query.search !== undefined && query.search.length > 0) {
      const s = query.search.toLowerCase();
      const haystack = `${entry.key} ${entry.value} ${entry.content}`.toLowerCase();
      if (!haystack.includes(s)) return false;
    }

    return true;
  }

  // =====================================================
  // 过期清理
  // =====================================================

  private async cleanExpired(scope: MemoryScope, appId: string, store: MemoryStore, convId?: string): Promise<number> {
    const now = Date.now();
    const before = store.entries.length;
    store.entries = store.entries.filter(e => {
      if (!e.ttl) return true;
      const createdAt = new Date(e.createdAt).getTime();
      return (now - createdAt) < e.ttl * 1000;
    });
    const removed = before - store.entries.length;
    if (removed > 0) {
      await this.saveStore(scope, appId, store, convId);
    }
    return removed;
  }

  // =====================================================
  // 通用 CRUD
  // =====================================================

  /** 添加一条记忆 */
  async remember(
    scope: MemoryScope,
    appId: string,
    entry: {
      type: MemoryType;
      key: string;
      value: string;
      content?: string;
      tags?: string[];
      source?: MemorySource;
      importance?: 'low' | 'normal' | 'high';
      ttl?: number;
    },
    convId?: string,
  ): Promise<MemoryEntry> {
    const now = this.now();
    const source: MemorySource = entry.source || 'agent';
    const newEntry: MemoryEntry = {
      id: this.generateId(),
      type: entry.type || 'fact',
      key: entry.key,
      value: entry.value,
      content: entry.content || '',
      tags: this.defaultTags(entry.type, source, entry.tags),
      createdAt: now,
      updatedAt: now,
      source,
      scope,
      conversationId: scope === 'conversation' ? convId : undefined,
      ttl: entry.ttl,
      version: 1,
    };

    const store = await this.loadStore(scope, appId, scope === 'conversation' ? convId : undefined);
    await this.cleanExpired(scope, appId, store, convId);

    // 数量上限控制
    const maxEntries = scope === 'app' ? 500 : 100;
    if (store.entries.length >= maxEntries) {
      // 裁剪最旧的 normal/low
      store.entries.sort((a, b) => {
        const impA = this.getImportanceLevel(a);
        const impB = this.getImportanceLevel(b);
        if (impA !== impB) return impA - impB;
        return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
      });
      store.entries = store.entries.slice(0, maxEntries - 1);
    }

    store.entries.push(newEntry);
    await this.saveStore(scope, appId, store, convId);

    serverLogger.debug('memory', `[Memory] saved ${newEntry.type}:${newEntry.key} (${scope})`);
    return newEntry;
  }

  /** 查询记忆（支持多级过滤） */
  async recall(scope: MemoryScope, appId: string, query: MemoryQuery, convId?: string): Promise<MemoryEntry[]> {
    const store = await this.loadStore(scope, appId, scope === 'conversation' ? convId : undefined);
    await this.cleanExpired(scope, appId, store, convId);

    let results = store.entries.filter(e => this.matchQuery(e, query));

    // 按重要性 + 更新时间排序
    results.sort((a, b) => {
      const impA = this.getImportanceLevel(a);
      const impB = this.getImportanceLevel(b);
      if (impA !== impB) return impA - impB;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

    if (query.offset) results = results.slice(query.offset);
    if (query.limit) results = results.slice(0, query.limit);

    return results;
  }

  /** 按前缀查询 */
  async recallByPrefix(scope: MemoryScope, appId: string, keyPrefix: string, convId?: string): Promise<MemoryEntry[]> {
    return this.recall(scope, appId, { keyPrefix }, convId);
  }

  /** 更新记忆 */
  async update(
    scope: MemoryScope,
    appId: string,
    entryId: string,
    updates: Partial<Pick<MemoryEntry, 'value' | 'content' | 'tags' | 'key' | 'type'>>,
    convId?: string,
  ): Promise<MemoryEntry | null> {
    const store = await this.loadStore(scope, appId, scope === 'conversation' ? convId : undefined);
    const idx = store.entries.findIndex(e => e.id === entryId);
    if (idx === -1) return null;

    const entry = store.entries[idx];
    if (updates.value !== undefined) entry.value = updates.value;
    if (updates.content !== undefined) entry.content = updates.content;
    if (updates.tags !== undefined) entry.tags = updates.tags;
    if (updates.key !== undefined) entry.key = updates.key;
    if (updates.type !== undefined) entry.type = updates.type;
    entry.updatedAt = this.now();
    entry.version++;

    store.entries[idx] = entry;
    await this.saveStore(scope, appId, store, convId);
    return entry;
  }

  /** 删除一条记忆 */
  async forget(scope: MemoryScope, appId: string, entryId: string, convId?: string): Promise<boolean> {
    const store = await this.loadStore(scope, appId, scope === 'conversation' ? convId : undefined);
    const before = store.entries.length;
    store.entries = store.entries.filter(e => e.id !== entryId);
    if (store.entries.length === before) return false;
    await this.saveStore(scope, appId, store, convId);
    return true;
  }

  /** 按标签批量删除 */
  async forgetByTag(scope: MemoryScope, appId: string, tag: string, convId?: string): Promise<number> {
    const store = await this.loadStore(scope, appId, scope === 'conversation' ? convId : undefined);
    const before = store.entries.length;
    store.entries = store.entries.filter(e => !e.tags.includes(tag));
    const removed = before - store.entries.length;
    if (removed > 0) {
      await this.saveStore(scope, appId, store, convId);
    }
    return removed;
  }

  /** 列出所有标签 */
  async listTags(scope: MemoryScope, appId: string, convId?: string): Promise<string[]> {
    const store = await this.loadStore(scope, appId, scope === 'conversation' ? convId : undefined);
    const tagSet = new Set<string>();
    for (const e of store.entries) {
      for (const t of e.tags) tagSet.add(t);
    }
    return [...tagSet].sort();
  }

  /** 获取统计 */
  async stats(scope: MemoryScope, appId: string, convId?: string): Promise<MemoryStats> {
    const store = await this.loadStore(scope, appId, scope === 'conversation' ? convId : undefined);
    const byType: Record<string, number> = {};
    const byTag: Record<string, number> = {};
    for (const e of store.entries) {
      byType[e.type] = (byType[e.type] || 0) + 1;
      for (const t of e.tags) {
        byTag[t] = (byTag[t] || 0) + 1;
      }
    }
    return {
      total: store.entries.length,
      byType,
      byTag,
    };
  }

  /** 获取所有记忆 */
  async getAll(scope: MemoryScope, appId: string, convId?: string): Promise<MemoryEntry[]> {
    return this.recall(scope, appId, {}, convId);
  }

  // =====================================================
  // 目标树专用方法
  // =====================================================

  /** 获取当前活跃的目标树 */
  async getActiveGoals(appId: string, convId: string): Promise<GoalTree> {
    const store = await this.loadStore('conversation', appId, convId);
    const active = store.entries.filter(e => e.type === 'goal' && e.tags.includes('goal/active'));
    return {
      level1: active.find(e => e.key === 'goal/level1') || null,
      level2: active.find(e => e.key === 'goal/level2') || null,
      level3: active.find(e => e.key === 'goal/level3') || null,
    };
  }

  /** 设置一级目标（旧 level1 归档，level2/level3 全部归档） */
  async setLevel1Goal(appId: string, convId: string, value: string, source: MemorySource = 'agent'): Promise<MemoryEntry> {
    const store = await this.loadStore('conversation', appId, convId);
    // 归档旧的 level1/2/3
    for (const entry of store.entries) {
      if (entry.type === 'goal' && entry.tags.includes('goal/active')) {
        entry.tags = entry.tags.filter(t => t !== 'goal/active');
        entry.tags.push('goal/archived');
        entry.updatedAt = this.now();
      }
    }
    // 创建新 level1
    const newEntry: MemoryEntry = {
      id: this.generateId(),
      type: 'goal',
      key: 'goal/level1',
      value,
      content: '',
      tags: ['goal/active', 'importance/high', `source/${source}`],
      createdAt: this.now(),
      updatedAt: this.now(),
      source,
      scope: 'conversation',
      conversationId: convId,
      version: 1,
    };
    store.entries.push(newEntry);
    await this.saveStore('conversation', appId, store, convId);
    return newEntry;
  }

  /** 设置二级目标（旧 level2 归档，level3 归档） */
  async setLevel2Goal(appId: string, convId: string, value: string, source: MemorySource = 'agent'): Promise<MemoryEntry> {
    const store = await this.loadStore('conversation', appId, convId);
    // 归档旧的 level2/3
    for (const entry of store.entries) {
      if (entry.type === 'goal' && entry.tags.includes('goal/active')) {
        if (entry.key === 'goal/level2' || entry.key === 'goal/level3') {
          entry.tags = entry.tags.filter(t => t !== 'goal/active');
          entry.tags.push('goal/archived');
          entry.updatedAt = this.now();
        }
      }
    }
    const newEntry: MemoryEntry = {
      id: this.generateId(),
      type: 'goal',
      key: 'goal/level2',
      value,
      content: '',
      tags: ['goal/active', 'importance/high', `source/${source}`],
      createdAt: this.now(),
      updatedAt: this.now(),
      source,
      scope: 'conversation',
      conversationId: convId,
      version: 1,
    };
    store.entries.push(newEntry);
    await this.saveStore('conversation', appId, store, convId);
    return newEntry;
  }

  /** 设置三级目标/当前待办（旧 level3 归档） */
  async setLevel3Goal(appId: string, convId: string, value: string, source: MemorySource = 'agent'): Promise<MemoryEntry> {
    const store = await this.loadStore('conversation', appId, convId);
    // 归档旧的 level3
    for (const entry of store.entries) {
      if (entry.type === 'goal' && entry.tags.includes('goal/active') && entry.key === 'goal/level3') {
        entry.tags = entry.tags.filter(t => t !== 'goal/active');
        entry.tags.push('goal/archived');
        entry.updatedAt = this.now();
      }
    }
    const newEntry: MemoryEntry = {
      id: this.generateId(),
      type: 'goal',
      key: 'goal/level3',
      value,
      content: '',
      tags: ['goal/active', 'importance/high', `source/${source}`],
      createdAt: this.now(),
      updatedAt: this.now(),
      source,
      scope: 'conversation',
      conversationId: convId,
      version: 1,
    };
    store.entries.push(newEntry);
    await this.saveStore('conversation', appId, store, convId);
    return newEntry;
  }

  /** 完成当前活跃的目标 */
  async completeGoal(appId: string, convId: string, level: 1 | 2 | 3): Promise<void> {
    const store = await this.loadStore('conversation', appId, convId);
    // 归档指定 level 及以下
    const levelsToArchive = ['goal/level1', 'goal/level2', 'goal/level3'].filter(k => {
      const num = parseInt(k.replace('goal/level', ''), 10);
      return num >= level;
    });
    for (const entry of store.entries) {
      if (entry.type === 'goal' && entry.tags.includes('goal/active') && levelsToArchive.includes(entry.key)) {
        entry.tags = entry.tags.filter(t => t !== 'goal/active');
        entry.tags.push('goal/archived');
        entry.updatedAt = this.now();
      }
    }
    await this.saveStore('conversation', appId, store, convId);
  }

  /** 查询已归档的目标 */
  async getArchivedGoals(appId: string, convId: string): Promise<MemoryEntry[]> {
    const store = await this.loadStore('conversation', appId, convId);
    return store.entries.filter(e => e.type === 'goal' && e.tags.includes('goal/archived'));
  }

  // =====================================================
  // System Prompt 注入
  // =====================================================

  /** 构建用于 system prompt 注入的记忆块 */
  async buildMemoryBlock(appId: string, options?: {
    convId?: string;
    keyPrefix?: string;
    maxEntries?: number;
    minImportance?: 'low' | 'normal' | 'high';
  }): Promise<string> {
    const maxEntries = options?.maxEntries ?? 30;
    const blocks: string[] = [];

    // 1. 始终注入活跃目标树
    if (options?.convId) {
      const goals = await this.getActiveGoals(appId, options.convId);
      if (goals.level1 || goals.level2 || goals.level3) {
        let goalBlock = '\n## 当前目标\n';
        if (goals.level1) {
          goalBlock += `【一级目标】${goals.level1.value}\n`;
          if (goals.level2) {
            goalBlock += `  【二级目标】${goals.level2.value}\n`;
            if (goals.level3) {
              goalBlock += `    【三级目标】${goals.level3.value} ← 当前待办\n`;
            }
          }
        }
        blocks.push(goalBlock);
      }
    }

    // 2. 加载应用级记忆（按重要性排序）
    const allApp = await this.getAll('app', appId);
    const sorted = allApp
      .filter(e => {
        if (options?.keyPrefix && !e.key.startsWith(options.keyPrefix)) return false;
        if (options?.minImportance) {
          const levels = ['high', 'normal', 'low'];
          const minIdx = levels.indexOf(options.minImportance);
          const entryIdx = this.getImportanceLevel(e);
          if (entryIdx > minIdx) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const impA = this.getImportanceLevel(a);
        const impB = this.getImportanceLevel(b);
        if (impA !== impB) return impA - impB;
        return b.updatedAt.localeCompare(a.updatedAt);
      });

    const selected = sorted.slice(0, maxEntries);
    if (selected.length > 0) {
      // 按 key 分组
      const groups = new Map<string, MemoryEntry[]>();
      for (const m of selected) {
        const prefix = m.key.split('.').slice(0, -1).join('.') || m.key;
        if (!groups.has(prefix)) groups.set(prefix, []);
        groups.get(prefix)!.push(m);
      }
      let block = '\n## 长期记忆\n';
      for (const [group, entries] of groups) {
        const label = group.charAt(0).toUpperCase() + group.slice(1);
        block += `\n### ${label}\n`;
        for (const m of entries) {
          block += `- ${m.key}: ${m.value}${m.content ? ` — ${m.content}` : ''}\n`;
        }
      }
      blocks.push(block);
    }

    // 3. 加载会话级记忆（不含 goal）
    if (options?.convId) {
      const allConv = await this.getAll('conversation', appId, options.convId);
      const convNonGoal = allConv
        .filter(e => e.type !== 'goal')
        .slice(0, 10);
      if (convNonGoal.length > 0) {
        let block = '\n## 会话上下文\n';
        for (const m of convNonGoal) {
          block += `- ${m.key}: ${m.value}${m.content ? ` — ${m.content}` : ''}\n`;
        }
        blocks.push(block);
      }
    }

    return blocks.join('\n') + '\n';
  }
}

export const memoryService = new MemoryService();
