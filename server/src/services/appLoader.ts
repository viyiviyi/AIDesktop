import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { App, AppMeta, AppSource } from '../types/index.js';
import {
  APPS_DIR,
  SYSTEM_APPS_DIR,
  USER_APPS_DIR,
  MARKETPLACE_APPS_DIR,
  readJsonFile,
  writeJsonFile,
  readDir,
  isDirectory,
  ensureDir
} from '../utils/file.js';

class AppLoader {
  private apps: Map<string, App> = new Map();

  async loadAll(): Promise<void> {
    await this.loadFromDirectory(SYSTEM_APPS_DIR, 'system');
    await this.loadFromDirectory(USER_APPS_DIR, 'user');
    await this.loadFromDirectory(MARKETPLACE_APPS_DIR, 'marketplace');
  }

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
      // Directory might not exist yet
    }
  }

  private async loadApp(appDir: string, source: AppSource): Promise<App | null> {
    const metaPath = path.join(appDir, 'meta.json');
    const appMdPath = path.join(appDir, 'app.md');
    const mcpPath = path.join(appDir, 'mcp.json');
    const skillsDir = path.join(appDir, 'skills');

    const meta = await readJsonFile<AppMeta>(metaPath);
    if (!meta) return null;

    // Override source from file system location
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
      // Skills directory might not exist
    }

    return {
      meta,
      appMd,
      mcpServices,
      skills
    };
  }

  getApp(id: string): App | undefined {
    return this.apps.get(id);
  }

  getAllApps(): App[] {
    return Array.from(this.apps.values());
  }

  getAppsBySource(source: AppSource): App[] {
    return this.getAllApps().filter(app => app.meta.source === source);
  }

  getDesktopApps(): App[] {
    return this.getAllApps().filter(app => app.meta.type === 'desktop');
  }

  // Reload all apps from disk (useful when apps are added/removed without restart)
  async reloadAll(): Promise<void> {
    this.apps.clear();
    await this.loadAll();
  }

  async createApp(app: Omit<App, 'meta'> & { meta: Partial<AppMeta> }, source: AppSource): Promise<App> {
    const id = app.meta.id || uuidv4();
    const now = new Date().toISOString();

    const fullMeta: AppMeta = {
      id,
      name: app.meta.name || '新应用',
      description: app.meta.description || '',
      source,
      type: app.meta.type || 'desktop',
      icon: app.meta.icon || '/icons/default.png',
      backgroundImage: app.meta.backgroundImage,
      models: app.meta.models || [],
      supportedInputs: app.meta.supportedInputs || ['text'],
      inputDescription: app.meta.inputDescription || '',
      outputDescription: app.meta.outputDescription || '',
      visibleApps: app.meta.visibleApps || [],
      visibleServices: app.meta.visibleServices || [],
      tools: app.meta.tools || [],
      enabled: app.meta.enabled !== undefined ? app.meta.enabled : true
    };

    const sourceDir = source === 'system' ? SYSTEM_APPS_DIR :
                      source === 'user' ? USER_APPS_DIR :
                      MARKETPLACE_APPS_DIR;

    const appDir = path.join(sourceDir, id);
    await ensureDir(appDir);
    await ensureDir(path.join(appDir, 'data'));
    await ensureDir(path.join(appDir, 'data', 'conversations'));
    await ensureDir(path.join(appDir, 'skills'));

    await writeJsonFile(path.join(appDir, 'meta.json'), fullMeta);
    await writeJsonFile(path.join(appDir, 'app.md'), app.appMd || '');
    await writeJsonFile(path.join(appDir, 'mcp.json'), app.mcpServices || []);

    const newApp: App = {
      meta: fullMeta,
      appMd: app.appMd || '',
      mcpServices: app.mcpServices || [],
      skills: app.skills || []
    };

    this.apps.set(id, newApp);
    return newApp;
  }

  async updateApp(id: string, updates: Partial<AppMeta>): Promise<App | null> {
    const app = this.apps.get(id);
    if (!app) return null;
    if (app.meta.source === 'system') return null; // Cannot modify system apps

    const updatedMeta = { ...app.meta, ...updates };
    const sourceDir = app.meta.source === 'user' ? USER_APPS_DIR : MARKETPLACE_APPS_DIR;
    const appDir = path.join(sourceDir, id);

    await writeJsonFile(path.join(appDir, 'meta.json'), updatedMeta);

    const updatedApp = { ...app, meta: updatedMeta };
    this.apps.set(id, updatedApp);
    return updatedApp;
  }

  async deleteApp(id: string): Promise<boolean> {
    const app = this.apps.get(id);
    if (!app) return false;
    if (app.meta.source === 'system') return false; // Cannot delete system apps

    const { rm } = await import('fs/promises');
    const sourceDir = app.meta.source === 'user' ? USER_APPS_DIR : MARKETPLACE_APPS_DIR;
    const appDir = path.join(sourceDir, id);

    try {
      await rm(appDir, { recursive: true });
      this.apps.delete(id);
      return true;
    } catch {
      return false;
    }
  }

  async setAppEnabled(id: string, enabled: boolean): Promise<App | null> {
    const app = this.apps.get(id);
    if (!app) return null;

    const updatedMeta = { ...app.meta, enabled };

    // Persist to meta.json for all app sources
    const sourceDir = app.meta.source === 'system' ? SYSTEM_APPS_DIR :
                      app.meta.source === 'user' ? USER_APPS_DIR :
                      MARKETPLACE_APPS_DIR;
    const appDir = path.join(sourceDir, id);

    try {
      await writeJsonFile(path.join(appDir, 'meta.json'), updatedMeta);
    } catch {
      // If write fails (e.g., read-only system apps), only update in-memory
    }

    const updatedApp = { ...app, meta: updatedMeta };
    this.apps.set(id, updatedApp);
    return updatedApp;
  }
}

export const appLoader = new AppLoader();
