/**
 * AppState — 统一状态管理层
 *
 * 所有运行时设置和配置的统一存取入口。
 * 读写都走内存缓存 + 持久化文件同步。
 * 任何组件都通过 appState.get() / appState.set() 访问配置，
 * 保证每次读取都是最新值，不需关心数据来源和缓存一致性。
 *
 * 设计原则：
 * - 单一真相来源：所有设置都在这里读和写
 * - 写后即读一致：set() 立即更新内存缓存
 * - 按需持久化：只在 set() 时写磁盘
 * - 零外部依赖：不依赖其他 service
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { CONFIGS_DIR, APPS_DATA_DIR, SYSTEM_APPS_DIR, USER_APPS_DIR, MARKETPLACE_APPS_DIR, ensureDir } from '../utils/file.js';
import type { DesktopSettings, ModelProvider, MCPConnection, App, AppMeta, AppConfig, AppSource } from '../types/index.js';
import { serverLogger } from '../utils/logger.js';

// ============================================================
// 类型定义
// ============================================================

/** 默认模型配置 */
export interface DefaultModelConfig {
  providerId: string;
  modelId: string;
}

// ============================================================
// 默认值
// ============================================================

const DEFAULT_SETTINGS: DesktopSettings = {
  theme: 'light',
  wallpaper: '/wallpapers/default.jpg',
  dock: { position: 'bottom', magnification: true, autoHide: false },
  window: { defaultSize: { width: 800, height: 600 }, minSize: { width: 400, height: 300 }, maximized: false },
  menuBar: { autoHide: false },
  startMenu: { width: 700, height: 700 },
};

const DEFAULT_MODES: { providers: ModelProvider[] } = {
  providers: [
    { id: 'openai', name: 'OpenAI', apiType: 'openai', apiKey: '', baseUrl: 'https://api.openai.com/v1', enabled: true, models: [
      { id: 'gpt-4o', name: 'GPT-4o', maxTokens: 128000, supports: ['text', 'image'], params: { temperature: 0.7, top_p: 0.9 } },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', maxTokens: 128000, supports: ['text'], params: { temperature: 0.7, top_p: 0.9 } },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', maxTokens: 128000, supports: ['text', 'image'], params: { temperature: 0.7, top_p: 0.9 } },
    ]},
    { id: 'anthropic', name: 'Anthropic', apiType: 'anthropic', apiKey: '', baseUrl: 'https://api.anthropic.com/v1', enabled: true, models: [
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', maxTokens: 200000, supports: ['text', 'image'], params: { temperature: 0.7, top_p: 0.9 } },
      { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', maxTokens: 200000, supports: ['text'], params: { temperature: 0.7, top_p: 0.9 } },
    ]},
  ],
};

const DEFAULT_MODEL_CONFIG: DefaultModelConfig = { providerId: '', modelId: '' };
const DEFAULT_MCP: { connections: MCPConnection[] } = { connections: [] };

// ============================================================
// AppState
// ============================================================

class AppState {
  // ---- 内存缓存 ----
  private settings: DesktopSettings | null = null;
  private modes: { providers: ModelProvider[] } | null = null;
  private mcp: { connections: MCPConnection[] } | null = null;
  private modelConfig: DefaultModelConfig | null = null;
  private windowPositions: Record<string, { x: number; y: number }> | null = null;

  // App 缓存（id → App）
  private apps: Map<string, App> = new Map();

  // ---- 初始化 ----
  async init(): Promise<void> {
    await ensureDir(CONFIGS_DIR);
    await this.loadSettings();
    await this.loadModes();
    await this.loadMcp();
    await this.loadModelConfig();
    await this.loadWindowPositions();
    await this.loadAllApps();
    serverLogger.info('appState', 'AppState initialized');
  }

  // ==========================================================
  // 持久化辅助
  // ==========================================================

  private configPath(filename: string): string {
    return path.join(CONFIGS_DIR, filename);
  }

  private async readJson<T>(filePath: string): Promise<T | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content) as T;
    } catch { return null; }
  }

  private async writeJson(filePath: string, data: unknown): Promise<void> {
    await ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  // ==========================================================
  // 系统设置 (settings)
  // ==========================================================

  private async loadSettings(): Promise<void> {
    this.settings = await this.readJson<DesktopSettings>(this.configPath('setting.json'))
      || { ...DEFAULT_SETTINGS };
  }

  getSettings(): DesktopSettings {
    return { ...this.settings! };
  }

  async updateSettings(updates: Partial<DesktopSettings>): Promise<DesktopSettings> {
    this.settings = { ...this.settings!, ...updates };
    await this.writeJson(this.configPath('setting.json'), this.settings);
    return { ...this.settings };
  }

  // ==========================================================
  // 模型提供商 (modes)
  // ==========================================================

  private async loadModes(): Promise<void> {
    this.modes = await this.readJson<{ providers: ModelProvider[] }>(this.configPath('modes.json'))
      || { ...DEFAULT_MODES };
  }

  getModes(): { providers: ModelProvider[] } {
    return { ...this.modes! };
  }

  async updateModes(updates: Partial<{ providers: ModelProvider[] }>): Promise<{ providers: ModelProvider[] }> {
    this.modes = { ...this.modes!, ...updates };
    await this.writeJson(this.configPath('modes.json'), this.modes);
    return { ...this.modes };
  }

  async updateProvider(providerId: string, provider: ModelProvider): Promise<{ providers: ModelProvider[] }> {
    if (!this.modes) await this.loadModes();
    const idx = this.modes!.providers.findIndex(p => p.id === providerId);
    if (idx >= 0) this.modes!.providers[idx] = provider;
    await this.writeJson(this.configPath('modes.json'), this.modes);
    return { providers: this.modes!.providers };
  }

  async addProvider(provider: ModelProvider): Promise<{ providers: ModelProvider[] }> {
    if (!this.modes) await this.loadModes();
    if (this.modes!.providers.find(p => p.id === provider.id)) throw new Error(`Provider ${provider.id} already exists`);
    this.modes!.providers.push(provider);
    await this.writeJson(this.configPath('modes.json'), this.modes);
    return { providers: this.modes!.providers };
  }

  async deleteProvider(providerId: string): Promise<{ providers: ModelProvider[] }> {
    if (!this.modes) await this.loadModes();
    this.modes!.providers = this.modes!.providers.filter(p => p.id !== providerId);
    await this.writeJson(this.configPath('modes.json'), this.modes);
    return { providers: this.modes!.providers };
  }

  // ==========================================================
  // MCP 连接
  // ==========================================================

  private async loadMcp(): Promise<void> {
    this.mcp = await this.readJson<{ connections: MCPConnection[] }>(this.configPath('mcp.json'))
      || { ...DEFAULT_MCP };
  }

  getMcp(): { connections: MCPConnection[] } {
    return { ...this.mcp! };
  }

  async updateMcp(updates: Partial<{ connections: MCPConnection[] }>): Promise<{ connections: MCPConnection[] }> {
    this.mcp = { ...this.mcp!, ...updates };
    await this.writeJson(this.configPath('mcp.json'), this.mcp);
    return { ...this.mcp };
  }

  async updateMcpConnection(connectionId: string, updates: Partial<MCPConnection>): Promise<{ connections: MCPConnection[] }> {
    if (!this.mcp) await this.loadMcp();
    const idx = this.mcp!.connections.findIndex(c => c.id === connectionId);
    if (idx < 0) throw new Error(`MCP connection ${connectionId} not found`);
    this.mcp!.connections[idx] = { ...this.mcp!.connections[idx], ...updates };
    await this.writeJson(this.configPath('mcp.json'), this.mcp);
    return { connections: this.mcp!.connections };
  }

  async connectMcp(connection: Omit<MCPConnection, 'id'>): Promise<{ connections: MCPConnection[] }> {
    if (!this.mcp) await this.loadMcp();
    const newConn = { ...connection, id: crypto.randomUUID() };
    this.mcp!.connections.push(newConn);
    await this.writeJson(this.configPath('mcp.json'), this.mcp);
    return { connections: this.mcp!.connections };
  }

  async disconnectMcp(connectionId: string): Promise<{ connections: MCPConnection[] }> {
    if (!this.mcp) await this.loadMcp();
    this.mcp!.connections = this.mcp!.connections.filter(c => c.id !== connectionId);
    await this.writeJson(this.configPath('mcp.json'), this.mcp);
    return { connections: this.mcp!.connections };
  }

  // ==========================================================
  // 默认模型配置
  // ==========================================================

  private async loadModelConfig(): Promise<void> {
    this.modelConfig = await this.readJson<DefaultModelConfig>(this.configPath('models.json'))
      || { ...DEFAULT_MODEL_CONFIG };
  }

  getDefaultModel(): DefaultModelConfig {
    return { ...this.modelConfig! };
  }

  async updateDefaultModel(config: DefaultModelConfig): Promise<DefaultModelConfig> {
    this.modelConfig = { ...config };
    await this.writeJson(this.configPath('models.json'), this.modelConfig);
    return { ...this.modelConfig };
  }

  // ==========================================================
  // 窗口位置
  // ==========================================================

  private async loadWindowPositions(): Promise<void> {
    this.windowPositions = await this.readJson<Record<string, { x: number; y: number }>>(this.configPath('window-positions.json'))
      || {};
  }

  getWindowPositions(): Record<string, { x: number; y: number }> {
    return { ...this.windowPositions! };
  }

  async saveWindowPosition(appId: string, position: { x: number; y: number }): Promise<void> {
    if (!this.windowPositions) await this.loadWindowPositions();
    this.windowPositions![appId] = position;
    await this.writeJson(this.configPath('window-positions.json'), this.windowPositions);
  }

  // ==========================================================
  // Hermes 配置
  // ==========================================================

  getHermesConfig(): ModelProvider | null {
    return this.modes?.providers.find(p => p.id === 'hermes') || null;
  }

  // ==========================================================
  // App 管理
  // ==========================================================

  /** 加载所有应用（从三个目录） */
  private async loadAllApps(): Promise<void> {
    await this.loadAppsFromDir(SYSTEM_APPS_DIR, 'system');
    await this.loadAppsFromDir(USER_APPS_DIR, 'user');
    await this.loadAppsFromDir(MARKETPLACE_APPS_DIR, 'marketplace');
  }

  private getAppConfigPath(id: string): string {
    return path.join(APPS_DATA_DIR, id, 'config.json');
  }

  private async readAppConfig(id: string): Promise<AppConfig> {
    return (await this.readJson<AppConfig>(this.getAppConfigPath(id))) || {};
  }

  private async writeAppConfig(id: string, config: AppConfig): Promise<void> {
    await ensureDir(path.dirname(this.getAppConfigPath(id)));
    await this.writeJson(this.getAppConfigPath(id), config);
  }

  private async loadAppsFromDir(dir: string, source: AppSource): Promise<void> {
    try {
      const entries = await fs.readdir(dir);
      for (const entry of entries) {
        const entryPath = path.join(dir, entry);
        try { await fs.access(entryPath); } catch { continue; }
        const stat = await fs.stat(entryPath);
        if (!stat.isDirectory()) continue;
        const app = await this.loadSingleApp(entryPath, source);
        if (app && !this.apps.has(app.meta.id)) {
          this.apps.set(app.meta.id, app);
        }
      }
    } catch { /* dir may not exist */ }
  }

  private async loadSingleApp(appDir: string, source: AppSource): Promise<App | null> {
    const metaPath = path.join(appDir, 'meta.json');
    const appMdPath = path.join(appDir, 'app.md');
    const mcpPath = path.join(appDir, 'mcp.json');

    const meta = await this.readJson<AppMeta>(metaPath);
    if (!meta) return null;
    meta.source = source;

    let appMd = '';
    try { appMd = await fs.readFile(appMdPath, 'utf-8'); } catch { appMd = ''; }
    // 用户自定义 app.md 覆盖
    const userAppMdPath = path.join(APPS_DATA_DIR, meta.id, 'app.md');
    try {
      const userAppMd = await fs.readFile(userAppMdPath, 'utf-8');
      if (userAppMd) appMd = userAppMd;
    } catch { /* use default */ }

    let mcpServices: string[] = [];
    const mcpData = await this.readJson<string[]>(mcpPath);
    if (mcpData) mcpServices = mcpData;

    let skills: string[] = [];
    const config = await this.readAppConfig(meta.id);
    if (config.skills) skills = config.skills;

    return { meta, appMd, mcpServices, skills, config };
  }

  getApp(id: string): App | undefined {
    return this.apps.get(id);
  }

  getAllApps(): App[] {
    return Array.from(this.apps.values());
  }

  getAppsBySource(source: AppSource): App[] {
    return this.getAllApps().filter(a => a.meta.source === source);
  }

  getDesktopApps(): App[] {
    return this.getAllApps().filter(a => a.meta.type === 'desktop');
  }

  async updateApp(id: string, updates: Partial<AppConfig> & { appMd?: string }): Promise<App | null> {
    const app = this.apps.get(id);
    if (!app) return null;

    const currentConfig = await this.readAppConfig(id);
    const { appMd, ...configUpdates } = updates;
    const newConfig = { ...currentConfig, ...configUpdates };

    await this.writeAppConfig(id, newConfig);

    if (appMd !== undefined) {
      const sourceDir = app.meta.source === 'system' ? SYSTEM_APPS_DIR
        : app.meta.source === 'user' ? USER_APPS_DIR : MARKETPLACE_APPS_DIR;
      await fs.writeFile(path.join(sourceDir, id, 'app.md'), appMd, 'utf-8');
    }

    const updatedApp = { ...app, config: newConfig, appMd: appMd ?? app.appMd };
    this.apps.set(id, updatedApp);
    return updatedApp;
  }

  async setAppEnabled(id: string, enabled: boolean): Promise<App | null> {
    const app = this.apps.get(id);
    if (!app) return null;
    const currentConfig = await this.readAppConfig(id);
    const newConfig = { ...currentConfig, enabled };
    await this.writeAppConfig(id, newConfig);
    const updatedApp = { ...app, config: newConfig };
    this.apps.set(id, updatedApp);
    return updatedApp;
  }

  async createApp(app: Omit<App, 'meta'> & { meta: Partial<AppMeta> }, source: AppSource): Promise<App> {
    const id = app.meta.id || crypto.randomUUID();
    const fullMeta: AppMeta = {
      id, name: app.meta.name || '新应用', description: app.meta.description || '',
      source, type: app.meta.type || 'desktop', icon: app.meta.icon || '/icons/default.png',
      models: app.meta.models || [], supportedInputs: app.meta.supportedInputs || ['text'],
      inputDescription: app.meta.inputDescription || '', outputDescription: app.meta.outputDescription || '',
      visibleApps: app.meta.visibleApps || [], visibleServices: app.meta.visibleServices || [],
      tools: app.meta.tools || [],
    };

    const sourceDir = source === 'system' ? SYSTEM_APPS_DIR : source === 'user' ? USER_APPS_DIR : MARKETPLACE_APPS_DIR;
    const appDir = path.join(sourceDir, id);
    await ensureDir(appDir);
    await ensureDir(path.join(APPS_DATA_DIR, id, 'conversations'));
    await ensureDir(path.join(appDir, 'skills'));

    await this.writeJson(path.join(appDir, 'meta.json'), fullMeta);
    await this.writeJson(path.join(appDir, 'app.md'), app.appMd || '');
    await this.writeJson(path.join(appDir, 'mcp.json'), app.mcpServices || []);
    await this.writeAppConfig(id, {});

    const newApp: App = { meta: fullMeta, appMd: app.appMd || '', mcpServices: app.mcpServices || [], skills: app.skills || [], config: {} };
    this.apps.set(id, newApp);
    return newApp;
  }

  async deleteApp(id: string): Promise<boolean> {
    const app = this.apps.get(id);
    if (!app) return false;
    if (app.meta.source === 'system') return false;

    const sourceDir = app.meta.source === 'user' ? USER_APPS_DIR : MARKETPLACE_APPS_DIR;
    try {
      await fs.rm(path.join(sourceDir, id), { recursive: true });
      await fs.rm(path.join(APPS_DATA_DIR, id), { recursive: true, force: true });
      this.apps.delete(id);
      return true;
    } catch { return false; }
  }

  /** 重新加载所有应用 */
  async reloadAllApps(): Promise<void> {
    this.apps.clear();
    await this.loadAllApps();
  }
}

// 引入 crypto 用于 randomUUID
import * as crypto from 'node:crypto';

export const appState = new AppState();
