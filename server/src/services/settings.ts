import path from 'path';
import { randomUUID } from 'crypto';
import type { DesktopSettings, ModelProvider, MCPConnection, Skill } from '../types/index.js';
import { CONFIGS_DIR, readJsonFile, writeJsonFile, ensureDir } from '../utils/file.js';

const DEFAULT_SETTINGS: DesktopSettings = {
  theme: 'light',
  wallpaper: '/wallpapers/default.jpg',
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

const DEFAULT_MODES: { providers: ModelProvider[] } = {
  providers: [
    {
      name: 'openai',
      apiKey: '',
      baseUrl: 'https://api.openai.com/v1'
    },
    {
      name: 'anthropic',
      apiKey: '',
      baseUrl: 'https://api.anthropic.com/v1'
    }
  ]
};

const DEFAULT_MCP: { connections: MCPConnection[] } = {
  connections: []
};

const DEFAULT_SKILLS: { skills: Skill[]; globalEnabled: boolean } = {
  skills: [],
  globalEnabled: true
};

class SettingsService {
  private settings: DesktopSettings | null = null;
  private modes: { providers: ModelProvider[] } | null = null;
  private mcp: { connections: MCPConnection[] } | null = null;
  private skills: { skills: Skill[]; globalEnabled: boolean } | null = null;

  async getSettings(): Promise<DesktopSettings> {
    if (!this.settings) {
      await this.loadSettings();
    }
    return { ...this.settings! };
  }

  private async loadSettings(): Promise<void> {
    await ensureDir(CONFIGS_DIR);
    const settings = await readJsonFile<DesktopSettings>(path.join(CONFIGS_DIR, 'setting.json'));
    this.settings = settings || { ...DEFAULT_SETTINGS };
  }

  async updateSettings(updates: Partial<DesktopSettings>): Promise<DesktopSettings> {
    await ensureDir(CONFIGS_DIR);
    this.settings = { ...this.settings!, ...updates };
    await writeJsonFile(path.join(CONFIGS_DIR, 'setting.json'), this.settings);
    return { ...this.settings };
  }

  async getModes(): Promise<{ providers: ModelProvider[] }> {
    if (!this.modes) {
      await this.loadModes();
    }
    return { ...this.modes! };
  }

  private async loadModes(): Promise<void> {
    await ensureDir(CONFIGS_DIR);
    const modes = await readJsonFile<{ providers: ModelProvider[] }>(path.join(CONFIGS_DIR, 'modes.json'));
    this.modes = modes || { ...DEFAULT_MODES };
  }

  async updateModes(updates: Partial<{ providers: ModelProvider[] }>): Promise<{ providers: ModelProvider[] }> {
    await ensureDir(CONFIGS_DIR);
    this.modes = { ...this.modes!, ...updates };
    await writeJsonFile(path.join(CONFIGS_DIR, 'modes.json'), this.modes);
    return { ...this.modes };
  }

  async getMcp(): Promise<{ connections: MCPConnection[] }> {
    if (!this.mcp) {
      await this.loadMcp();
    }
    return { ...this.mcp! };
  }

  private async loadMcp(): Promise<void> {
    await ensureDir(CONFIGS_DIR);
    const mcp = await readJsonFile<{ connections: MCPConnection[] }>(path.join(CONFIGS_DIR, 'mcp.json'));
    this.mcp = mcp || { ...DEFAULT_MCP };
  }

  async updateMcp(updates: Partial<{ connections: MCPConnection[] }>): Promise<{ connections: MCPConnection[] }> {
    await ensureDir(CONFIGS_DIR);
    this.mcp = { ...this.mcp!, ...updates };
    await writeJsonFile(path.join(CONFIGS_DIR, 'mcp.json'), this.mcp);
    return { ...this.mcp };
  }

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

  async disconnectMcp(connectionId: string): Promise<{ connections: MCPConnection[] }> {
    await ensureDir(CONFIGS_DIR);
    if (!this.mcp) {
      await this.loadMcp();
    }
    this.mcp!.connections = this.mcp!.connections.filter(c => c.id !== connectionId);
    await writeJsonFile(path.join(CONFIGS_DIR, 'mcp.json'), this.mcp);
    return { connections: this.mcp!.connections };
  }

  async getSkills(): Promise<{ skills: Skill[]; globalEnabled: boolean }> {
    if (!this.skills) {
      await this.loadSkills();
    }
    return { ...this.skills! };
  }

  private async loadSkills(): Promise<void> {
    await ensureDir(CONFIGS_DIR);
    const skills = await readJsonFile<{ skills: Skill[]; globalEnabled: boolean }>(path.join(CONFIGS_DIR, 'skills.json'));
    this.skills = skills || { ...DEFAULT_SKILLS };
  }

  async updateSkills(updates: Partial<{ skills: Skill[]; globalEnabled: boolean }>): Promise<{ skills: Skill[]; globalEnabled: boolean }> {
    await ensureDir(CONFIGS_DIR);
    this.skills = { ...this.skills!, ...updates };
    await writeJsonFile(path.join(CONFIGS_DIR, 'skills.json'), this.skills);
    return { ...this.skills };
  }

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

  async deleteSkill(skillId: string): Promise<{ skills: Skill[]; globalEnabled: boolean }> {
    await ensureDir(CONFIGS_DIR);
    if (!this.skills) {
      await this.loadSkills();
    }
    this.skills!.skills = this.skills!.skills.filter(s => s.id !== skillId);
    await writeJsonFile(path.join(CONFIGS_DIR, 'skills.json'), this.skills);
    return { skills: this.skills!.skills, globalEnabled: this.skills!.globalEnabled };
  }
}

export const settingsService = new SettingsService();
