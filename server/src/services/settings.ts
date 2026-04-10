import path from 'path';
import type { DesktopSettings, ModelProvider } from '../types/index.js';
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

class SettingsService {
  private settings: DesktopSettings | null = null;
  private modes: { providers: ModelProvider[] } | null = null;

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
}

export const settingsService = new SettingsService();
