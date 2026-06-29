import path from 'path';
import { randomUUID } from 'crypto';
import type { DesktopSettings, ModelProvider, MCPConnection, Skill } from '../types/index.js';
import { CONFIGS_DIR, readJsonFile, writeJsonFile, ensureDir } from '../utils/file.js';

// 默认桌面设置
const DEFAULT_SETTINGS: DesktopSettings = {
  theme: 'light',
  wallpaper: '',
  dock: {
    position: 'bottom',
    magnification: true,
    autoHide: false
  },
  window: {
    defaultSize: { width: 800, height: 600 },
    minSize: { width: 400, height: 300 },
    maximized: false
  },
  menuBar: {
    autoHide: false
  },
  startMenu: {
    width: 700,
    height: 500
  }
};

// 默认模型提供商配置
const DEFAULT_MODES: { providers: ModelProvider[] } = {
  providers: [
    {
      id: 'openai',
      name: 'OpenAI',
      apiType: 'openai',
      apiKey: '',
      baseUrl: 'https://api.openai.com/v1',
      enabled: true,
      models: [
        { id: 'gpt-4o', name: 'GPT-4o', maxTokens: 128000, supports: ['text', 'image'], params: { temperature: 0.7, top_p: 0.9 } },
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini', maxTokens: 128000, supports: ['text'], params: { temperature: 0.7, top_p: 0.9 } },
        { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', maxTokens: 128000, supports: ['text', 'image'], params: { temperature: 0.7, top_p: 0.9 } }
      ]
    },
    {
      id: 'anthropic',
      name: 'Anthropic',
      apiType: 'anthropic',
      apiKey: '',
      baseUrl: 'https://api.anthropic.com/v1',
      enabled: true,
      models: [
        { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', maxTokens: 200000, supports: ['text', 'image'], params: { temperature: 0.7, top_p: 0.9 } },
        { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', maxTokens: 200000, supports: ['text'], params: { temperature: 0.7, top_p: 0.9 } }
      ]
    }
  ]
};

// 默认MCP连接配置
const DEFAULT_MCP: { connections: MCPConnection[] } = {
  connections: []
};

// 默认技能配置
const DEFAULT_SKILLS: { skills: Skill[]; globalEnabled: boolean } = {
  skills: [],
  globalEnabled: true
};

// 默认模型配置接口
interface DefaultModelConfig {
  providerId: string;
  modelId: string;
}

const DEFAULT_MODEL_CONFIG: DefaultModelConfig = {
  providerId: '',
  modelId: ''
};

/**
 * SettingsService - 设置服务
 * 管理桌面设置、模型提供商、MCP连接、技能等配置的持久化
 * 使用内存缓存+磁盘存储模式
 */
class SettingsService {
  private settings: DesktopSettings | null = null;
  private modes: { providers: ModelProvider[] } | null = null;
  private mcp: { connections: MCPConnection[] } | null = null;
  private skills: { skills: Skill[]; globalEnabled: boolean } | null = null;
  private modelConfig: DefaultModelConfig | null = null;
  private windowPositions: Record<string, { x: number; y: number }> | null = null;

  // 获取桌面设置
  async getSettings(): Promise<DesktopSettings> {
    if (!this.settings) {
      await this.loadSettings();
    }
    return { ...this.settings! };
  }

  // 加载桌面设置（从磁盘读取）
  private async loadSettings(): Promise<void> {
    await ensureDir(CONFIGS_DIR);
    const settings = await readJsonFile<DesktopSettings>(path.join(CONFIGS_DIR, 'setting.json'));
    this.settings = settings || { ...DEFAULT_SETTINGS };
  }

  // 更新桌面设置
  async updateSettings(updates: Partial<DesktopSettings>): Promise<DesktopSettings> {
    await ensureDir(CONFIGS_DIR);
    this.settings = { ...this.settings!, ...updates };
    await writeJsonFile(path.join(CONFIGS_DIR, 'setting.json'), this.settings);
    return { ...this.settings };
  }

  // 获取模型提供商列表
  async getModes(): Promise<{ providers: ModelProvider[] }> {
    if (!this.modes) {
      await this.loadModes();
    }
    return { ...this.modes! };
  }

  // 加载模型配置
  private async loadModes(): Promise<void> {
    await ensureDir(CONFIGS_DIR);
    const modes = await readJsonFile<{ providers: ModelProvider[] }>(path.join(CONFIGS_DIR, 'modes.json'));
    this.modes = modes || { ...DEFAULT_MODES };
  }

  // 更新模型提供商列表
  async updateModes(updates: Partial<{ providers: ModelProvider[] }>): Promise<{ providers: ModelProvider[] }> {
    await ensureDir(CONFIGS_DIR);
    this.modes = { ...this.modes!, ...updates };
    await writeJsonFile(path.join(CONFIGS_DIR, 'modes.json'), this.modes);
    return { ...this.modes };
  }

  // 更新单个提供商
  async updateProvider(providerId: string, provider: ModelProvider): Promise<{ providers: ModelProvider[] }> {
    await ensureDir(CONFIGS_DIR);
    if (!this.modes) {
      await this.loadModes();
    }
    const index = this.modes!.providers.findIndex(p => p.id === providerId);
    if (index >= 0) {
      this.modes!.providers[index] = provider;
    }
    await writeJsonFile(path.join(CONFIGS_DIR, 'modes.json'), this.modes);
    return { providers: this.modes!.providers };
  }

  // 添加新提供商
  async addProvider(provider: ModelProvider): Promise<{ providers: ModelProvider[] }> {
    await ensureDir(CONFIGS_DIR);
    if (!this.modes) {
      await this.loadModes();
    }
    const existing = this.modes!.providers.find(p => p.id === provider.id);
    if (existing) {
      throw new Error(`Provider ${provider.id} already exists`);
    }
    this.modes!.providers.push(provider);
    await writeJsonFile(path.join(CONFIGS_DIR, 'modes.json'), this.modes);
    return { providers: this.modes!.providers };
  }

  // 删除提供商
  async deleteProvider(providerId: string): Promise<{ providers: ModelProvider[] }> {
    await ensureDir(CONFIGS_DIR);
    if (!this.modes) {
      await this.loadModes();
    }
    this.modes!.providers = this.modes!.providers.filter(p => p.id !== providerId);
    await writeJsonFile(path.join(CONFIGS_DIR, 'modes.json'), this.modes);
    return { providers: this.modes!.providers };
  }

  // 获取Hermes Agent配置
  async getHermesConfig(): Promise<ModelProvider | null> {
    const modes = await this.getModes();
    return modes.providers.find(p => p.id === 'hermes') || null;
  }

  // 获取MCP连接配置
  async getMcp(): Promise<{ connections: MCPConnection[] }> {
    if (!this.mcp) {
      await this.loadMcp();
    }
    return { ...this.mcp! };
  }

  // 加载MCP配置
  private async loadMcp(): Promise<void> {
    await ensureDir(CONFIGS_DIR);
    const mcp = await readJsonFile<{ connections: MCPConnection[] }>(path.join(CONFIGS_DIR, 'mcp.json'));
    this.mcp = mcp || { ...DEFAULT_MCP };
  }

  // 更新MCP配置
  async updateMcp(updates: Partial<{ connections: MCPConnection[] }>): Promise<{ connections: MCPConnection[] }> {
    await ensureDir(CONFIGS_DIR);
    this.mcp = { ...this.mcp!, ...updates };
    await writeJsonFile(path.join(CONFIGS_DIR, 'mcp.json'), this.mcp);
    return { ...this.mcp };
  }

  // 更新单个MCP连接
  async updateMcpConnection(connectionId: string, updates: Partial<MCPConnection>): Promise<{ connections: MCPConnection[] }> {
    await ensureDir(CONFIGS_DIR);
    if (!this.mcp) {
      await this.loadMcp();
    }
    const index = this.mcp!.connections.findIndex(c => c.id === connectionId);
    if (index < 0) {
      throw new Error(`MCP connection ${connectionId} not found`);
    }
    this.mcp!.connections[index] = { ...this.mcp!.connections[index], ...updates };
    await writeJsonFile(path.join(CONFIGS_DIR, 'mcp.json'), this.mcp);
    return { connections: this.mcp!.connections };
  }

  // 连接新MCP服务
  async connectMcp(connection: Omit<MCPConnection, 'id'>): Promise<{ connections: MCPConnection[] }> {
    await ensureDir(CONFIGS_DIR);
    if (!this.mcp) {
      await this.loadMcp();
    }
    const newConnection: MCPConnection = {
      ...connection,
      id: randomUUID()
    };
    this.mcp!.connections.push(newConnection);
    await writeJsonFile(path.join(CONFIGS_DIR, 'mcp.json'), this.mcp);
    return { connections: this.mcp!.connections };
  }

  // 断开MCP连接
  async disconnectMcp(connectionId: string): Promise<{ connections: MCPConnection[] }> {
    await ensureDir(CONFIGS_DIR);
    if (!this.mcp) {
      await this.loadMcp();
    }
    this.mcp!.connections = this.mcp!.connections.filter(c => c.id !== connectionId);
    await writeJsonFile(path.join(CONFIGS_DIR, 'mcp.json'), this.mcp);
    return { connections: this.mcp!.connections };
  }

  // 获取技能配置
  async getSkills(): Promise<{ skills: Skill[]; globalEnabled: boolean }> {
    if (!this.skills) {
      await this.loadSkills();
    }
    return { ...this.skills! };
  }

  // 加载技能配置
  private async loadSkills(): Promise<void> {
    await ensureDir(CONFIGS_DIR);
    const skills = await readJsonFile<{ skills: Skill[]; globalEnabled: boolean }>(path.join(CONFIGS_DIR, 'skills.json'));
    this.skills = skills || { ...DEFAULT_SKILLS };
  }

  // 更新技能配置
  async updateSkills(updates: Partial<{ skills: Skill[]; globalEnabled: boolean }>): Promise<{ skills: Skill[]; globalEnabled: boolean }> {
    await ensureDir(CONFIGS_DIR);
    this.skills = { ...this.skills!, ...updates };
    await writeJsonFile(path.join(CONFIGS_DIR, 'skills.json'), this.skills);
    return { ...this.skills };
  }

  // 添加技能
  async addSkill(skill: Omit<Skill, 'id'>): Promise<{ skills: Skill[]; globalEnabled: boolean }> {
    await ensureDir(CONFIGS_DIR);
    if (!this.skills) {
      await this.loadSkills();
    }
    const newSkill: Skill = {
      ...skill,
      id: randomUUID()
    };
    this.skills!.skills.push(newSkill);
    await writeJsonFile(path.join(CONFIGS_DIR, 'skills.json'), this.skills);
    return { skills: this.skills!.skills, globalEnabled: this.skills!.globalEnabled };
  }

  // 删除技能
  async deleteSkill(skillId: string): Promise<{ skills: Skill[]; globalEnabled: boolean }> {
    await ensureDir(CONFIGS_DIR);
    if (!this.skills) {
      await this.loadSkills();
    }
    this.skills!.skills = this.skills!.skills.filter(s => s.id !== skillId);
    await writeJsonFile(path.join(CONFIGS_DIR, 'skills.json'), this.skills);
    return { skills: this.skills!.skills, globalEnabled: this.skills!.globalEnabled };
  }

  // 获取默认模型配置
  async getDefaultModel(): Promise<DefaultModelConfig> {
    if (!this.modelConfig) {
      await this.loadModelConfig();
    }
    return { ...this.modelConfig! };
  }

  // 同步获取默认模型配置（用于 streamFn 中，必须有缓存）
  getDefaultModelSync(): DefaultModelConfig {
    return { ...(this.modelConfig || DEFAULT_MODEL_CONFIG) };
  }

  // 同步获取模型提供商列表（用于 streamFn 中，必须有缓存）
  getModesSync(): { providers: ModelProvider[] } {
    return { ...(this.modes || DEFAULT_MODES) };
  }

  // 加载默认模型配置
  private async loadModelConfig(): Promise<void> {
    await ensureDir(CONFIGS_DIR);
    const config = await readJsonFile<DefaultModelConfig>(path.join(CONFIGS_DIR, 'models.json'));
    this.modelConfig = config || { ...DEFAULT_MODEL_CONFIG };
  }

  // 更新默认模型配置
  async updateDefaultModel(config: DefaultModelConfig): Promise<DefaultModelConfig> {
    await ensureDir(CONFIGS_DIR);
    this.modelConfig = { ...config };
    await writeJsonFile(path.join(CONFIGS_DIR, 'models.json'), this.modelConfig);
    return { ...this.modelConfig };
  }

  // 获取窗口位置记录
  async getWindowPositions(): Promise<Record<string, { x: number; y: number }>> {
    if (!this.windowPositions) {
      await this.loadWindowPositions();
    }
    return { ...this.windowPositions! };
  }

  // 加载窗口位置
  private async loadWindowPositions(): Promise<void> {
    await ensureDir(CONFIGS_DIR);
    const positions = await readJsonFile<Record<string, { x: number; y: number }>>(path.join(CONFIGS_DIR, 'window-positions.json'));
    this.windowPositions = positions || {};
  }

  // 保存窗口位置
  async saveWindowPosition(appId: string, position: { x: number; y: number }): Promise<void> {
    await ensureDir(CONFIGS_DIR);
    if (!this.windowPositions) {
      await this.loadWindowPositions();
    }
    this.windowPositions![appId] = position;
    await writeJsonFile(path.join(CONFIGS_DIR, 'window-positions.json'), this.windowPositions);
  }
}

export const settingsService = new SettingsService();
