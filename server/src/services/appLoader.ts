import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { App, AppMeta, AppConfig, AppSource } from '../types/index.js';
import {
  APPS_DIR,
  APPS_DATA_DIR,
  SYSTEM_APPS_DIR,
  USER_APPS_DIR,
  MARKETPLACE_APPS_DIR,
  readJsonFile,
  writeJsonFile,
  readDir,
  isDirectory,
  ensureDir
} from '../utils/file.js';

/**
 * AppLoader - 应用加载器
 * 负责从磁盘加载应用、管理应用的创建、更新、删除
 *
 * 数据分离:
 *   apps/{source}/{id}/meta.json    — app 定义/默认配置（仅创建时写入）
 *   apps_data/{id}/config.json      — 用户运行时配置（设置 UI 修改时写入）
 */
class AppLoader {
  // 应用内存缓存
  private apps: Map<string, App> = new Map();

  // 加载所有应用（从三个目录）
  async loadAll(): Promise<void> {
    await this.loadFromDirectory(SYSTEM_APPS_DIR, 'system');
    await this.loadFromDirectory(USER_APPS_DIR, 'user');
    await this.loadFromDirectory(MARKETPLACE_APPS_DIR, 'marketplace');
  }

  // 从指定目录加载应用
  private async loadFromDirectory(dir: string, source: AppSource): Promise<void> {
    try {
      const entries = await readDir(dir);
      for (const entry of entries) {
        const entryPath = path.join(dir, entry);
        if (await isDirectory(entryPath)) {
          const app = await this.loadApp(entryPath, source);
          if (app) {
            this.apps.set(app.meta.id, app);
          }
        }
      }
    } catch {
      // 目录可能不存在
    }
  }

  /** 获取应用运行时配置路径: apps_data/{id}/config.json */
  private getConfigPath(id: string): string {
    return path.join(APPS_DATA_DIR, id, 'config.json');
  }

  /** 读取应用运行时配置，不存在返回空对象 */
  private async readConfig(id: string): Promise<AppConfig> {
    return (await readJsonFile<AppConfig>(this.getConfigPath(id))) || {};
  }

  /** 写入应用运行时配置 */
  async writeConfig(id: string, config: AppConfig): Promise<void> {
    const configPath = this.getConfigPath(id);
    await ensureDir(path.dirname(configPath));
    await writeJsonFile(configPath, config);
  }

  // 加载单个应用（读取meta.json、app.md、mcp.json、skills、config.json）
  private async loadApp(appDir: string, source: AppSource): Promise<App | null> {
    const metaPath = path.join(appDir, 'meta.json');
    const appMdPath = path.join(appDir, 'app.md');
    const mcpPath = path.join(appDir, 'mcp.json');
    const skillsDir = path.join(appDir, 'skills');

    const meta = await readJsonFile<AppMeta>(metaPath);
    if (!meta) return null;

    // 覆盖source为文件系统位置
    meta.source = source;

    let appMd = '';
    try {
      const { readFile } = await import('fs/promises');
      appMd = await readFile(appMdPath, 'utf-8');
    } catch {
      appMd = '';
    }

    let mcpServices: string[] = [];
    const mcpData = await readJsonFile<string[]>(mcpPath);
    if (mcpData) {
      mcpServices = mcpData;
    }

    let skills: string[] = [];
    try {
      const { readFile } = await import('fs/promises');
      const includePath = path.join(skillsDir, 'include.json');
      const includeData = await readJsonFile<{ skills: string[] }>(includePath);
      if (includeData) {
        skills = includeData.skills;
      }
    } catch {
      // Skills目录可能不存在
    }

    // 读取用户运行时配置（覆盖 meta 默认值）
    const config = await this.readConfig(meta.id);

    return {
      meta,
      appMd,
      mcpServices,
      skills,
      config
    };
  }

  // 获取单个应用
  getApp(id: string): App | undefined {
    return this.apps.get(id);
  }

  // 获取所有应用
  getAllApps(): App[] {
    return Array.from(this.apps.values());
  }

  // 按来源获取应用
  getAppsBySource(source: AppSource): App[] {
    return this.getAllApps().filter(app => app.meta.source === source);
  }

  // 获取桌面应用
  getDesktopApps(): App[] {
    return this.getAllApps().filter(app => app.meta.type === 'desktop');
  }

  // 重新加载所有应用（用于不重启添删应用）
  async reloadAll(): Promise<void> {
    this.apps.clear();
    await this.loadAll();
  }

  // 创建新应用
  async createApp(app: Omit<App, 'meta'> & { meta: Partial<AppMeta> }, source: AppSource): Promise<App> {
    const id = app.meta.id || uuidv4();
    const now = new Date().toISOString();

    // 构建完整的meta（仅包含 app 定义/默认值）
    const fullMeta: AppMeta = {
      id,
      name: app.meta.name || '新应用',
      description: app.meta.description || '',
      source,
      type: app.meta.type || 'desktop',
      icon: app.meta.icon || '/icons/default.png',
      models: app.meta.models || [],
      supportedInputs: app.meta.supportedInputs || ['text'],
      inputDescription: app.meta.inputDescription || '',
      outputDescription: app.meta.outputDescription || '',
      visibleApps: app.meta.visibleApps || [],
      visibleServices: app.meta.visibleServices || [],
      tools: app.meta.tools || [],
      replySchema: app.meta.replySchema,
    };

    // 根据来源确定目录
    const sourceDir = source === 'system' ? SYSTEM_APPS_DIR :
                      source === 'user' ? USER_APPS_DIR :
                      MARKETPLACE_APPS_DIR;

    // 创建目录结构
    const appDir = path.join(sourceDir, id);
    await ensureDir(appDir);
    await ensureDir(path.join(APPS_DATA_DIR, id, 'conversations'));
    await ensureDir(path.join(appDir, 'skills'));

    // meta.json 写入 app 定义（仅创建时写入，后续不修改）
    await writeJsonFile(path.join(appDir, 'meta.json'), fullMeta);
    await writeJsonFile(path.join(appDir, 'app.md'), app.appMd || '');
    await writeJsonFile(path.join(appDir, 'mcp.json'), app.mcpServices || []);

    // 初始 config.json（空，用户设置修改时会写入）
    await this.writeConfig(id, {});

    const newApp: App = {
      meta: fullMeta,
      appMd: app.appMd || '',
      mcpServices: app.mcpServices || [],
      skills: app.skills || [],
      config: {}
    };

    this.apps.set(id, newApp);
    return newApp;
  }

  // 更新应用运行时配置（不修改 meta.json）
  async updateApp(id: string, updates: Partial<AppConfig>): Promise<App | null> {
    const app = this.apps.get(id);
    if (!app) return null;

    const currentConfig = await this.readConfig(id);
    const newConfig = { ...currentConfig, ...updates };

    // 写入 config.json
    await this.writeConfig(id, newConfig);

    const updatedApp = { ...app, config: newConfig };
    this.apps.set(id, updatedApp);
    return updatedApp;
  }

  // 删除应用（系统应用不可删除）
  async deleteApp(id: string): Promise<boolean> {
    const app = this.apps.get(id);
    if (!app) return false;
    if (app.meta.source === 'system') return false; // 系统应用不可删除

    const { rm } = await import('fs/promises');
    const sourceDir = app.meta.source === 'user' ? USER_APPS_DIR : MARKETPLACE_APPS_DIR;

    try {
      // 删除 app 目录
      await rm(path.join(sourceDir, id), { recursive: true });
      // 删除 apps_data 目录
      await rm(path.join(APPS_DATA_DIR, id), { recursive: true, force: true });
      this.apps.delete(id);
      return true;
    } catch {
      return false;
    }
  }

  // 设置应用启用/禁用状态（写入 config.json）
  async setAppEnabled(id: string, enabled: boolean): Promise<App | null> {
    const app = this.apps.get(id);
    if (!app) return null;

    const currentConfig = await this.readConfig(id);
    const newConfig = { ...currentConfig, enabled };

    await this.writeConfig(id, newConfig);

    const updatedApp = { ...app, config: newConfig };
    this.apps.set(id, updatedApp);
    return updatedApp;
  }
}

export const appLoader = new AppLoader();
