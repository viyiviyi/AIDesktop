import { Router, Request, Response } from 'express';
import { appLoader } from '../services/appLoader.js';
import type { AppSource } from '../types/index.js';
import { APPS_DATA_DIR } from '../utils/file.js';

const router = Router();

// Get all apps or filter by source
router.get('/', async (req: Request, res: Response) => {
  try {
    const { source } = req.query;
    let apps = appLoader.getAllApps();

    if (source && typeof source === 'string') {
      apps = apps.filter(a => a.meta.source === source);
    }

    res.json({
      apps: apps.map(a => {
        const merged = mergeConfig(a.meta, a.config);
        return {
          id: a.meta.id,
          name: a.meta.name,
          description: a.meta.description,
          source: a.meta.source,
          type: a.meta.type,
          icon: merged.icon || '/public_icons/assistant.svg',
          backgroundImage: merged.backgroundImage,
          enabled: merged.enabled,
          supportedInputs: merged.supportedInputs || ['text'],
        };
      })
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Get app details (合并 meta + config)
router.get('/:appId', async (req: Request, res: Response) => {
  try {
    const app = appLoader.getApp(req.params.appId);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    // 合并 meta 默认值 + config 运行时覆盖
    const merged = mergeConfig(app.meta, app.config);

    res.json({
      meta: merged,
      appMd: app.appMd,
      mcpServices: app.mcpServices,
      skills: app.skills,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * 将 meta 默认值与 config 运行时覆盖合并
 * config 中有定义的字段覆盖 meta，config 中没有的保留 meta 值
 */
export function mergeConfig(meta: any, config: any): any {
  const result = { ...meta };
  // enabled 特殊处理：config 有定义则用，否则默认 true
  result.enabled = config.enabled !== undefined ? config.enabled : true;

  for (const key of ['backgroundImage', 'icon', 'supportedInputs', 'inputDescription', 'outputDescription',
                     'visibleApps', 'visibleServices', 'tools', 'models']) {
    if (config[key] !== undefined) {
      result[key] = config[key];
    }
  }
  return result;
}

// Create new app (user source only)
router.post('/', async (req: Request, res: Response) => {
  try {
    const { meta, appMd, mcpServices, skills } = req.body;

    if (!meta?.name) {
      return res.status(400).json({ error: 'App name is required' });
    }

    const app = await appLoader.createApp(
      { meta, appMd, mcpServices, skills, config: {} },
      'user'
    );

    res.status(201).json(app);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Update app runtime config (写入 config.json，不修改 meta.json)
router.put('/:appId', async (req: Request, res: Response) => {
  try {
    const app = appLoader.getApp(req.params.appId);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    // 从请求体中提取用户可配置的字段
    const {
      models, enabled, icon, backgroundImage, supportedInputs,
      inputDescription, outputDescription,
      visibleApps, visibleServices, tools, skills,
      appMd,
    } = req.body;

    const configUpdates: Record<string, unknown> = {};
    if (enabled !== undefined) configUpdates.enabled = enabled;
    if (icon !== undefined) configUpdates.icon = icon;
    if (backgroundImage !== undefined) configUpdates.backgroundImage = backgroundImage;
    if (supportedInputs !== undefined) configUpdates.supportedInputs = supportedInputs;
    if (inputDescription !== undefined) configUpdates.inputDescription = inputDescription;
    if (outputDescription !== undefined) configUpdates.outputDescription = outputDescription;
    if (visibleApps !== undefined) configUpdates.visibleApps = visibleApps;
    if (visibleServices !== undefined) configUpdates.visibleServices = visibleServices;
    if (tools !== undefined) configUpdates.tools = tools;
    if (models !== undefined) configUpdates.models = models;
    if (skills !== undefined) configUpdates.skills = skills;

    // appMd 写入 app.md 文件（仅 user 源允许）
    if (appMd !== undefined) {
      const { writeFile } = await import('fs/promises');
      const path = await import('path');
      const sourceDir = app.meta.source === 'user' ? await import('../utils/file.js').then(m => m.USER_APPS_DIR)
        : app.meta.source === 'marketplace' ? await import('../utils/file.js').then(m => m.MARKETPLACE_APPS_DIR)
        : null;
      if (sourceDir) {
        await writeFile(path.join(sourceDir, app.meta.id, 'app.md'), appMd, 'utf-8');
      }
    }

    if (Object.keys(configUpdates).length === 0) {
      return res.status(400).json({ error: 'No configurable fields provided' });
    }

    const updated = await appLoader.updateApp(req.params.appId, configUpdates);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Delete app (user apps only)
router.delete('/:appId', async (req: Request, res: Response) => {
  try {
    const app = appLoader.getApp(req.params.appId);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    if (app.meta.source === 'system') {
      return res.status(403).json({ error: 'Cannot delete system apps' });
    }

    const deleted = await appLoader.deleteApp(req.params.appId);
    if (deleted) {
      res.json({ success: true });
    } else {
      res.status(500).json({ error: 'Failed to delete app' });
    }
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Enable app
router.put('/:appId/enable', async (req: Request, res: Response) => {
  try {
    const app = appLoader.getApp(req.params.appId);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }
    const updated = await appLoader.setAppEnabled(req.params.appId, true);
    res.json({ success: true, app: updated });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Disable app
router.put('/:appId/disable', async (req: Request, res: Response) => {
  try {
    const app = appLoader.getApp(req.params.appId);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }
    const updated = await appLoader.setAppEnabled(req.params.appId, false);
    res.json({ success: true, app: updated });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Reload all apps (useful when new apps are added)
router.post('/reload', async (req: Request, res: Response) => {
  try {
    await appLoader.reloadAll();
    const apps = appLoader.getAllApps();
    res.json({
      success: true,
      message: `Reloaded ${apps.length} apps`,
      apps: apps.map(a => {
        const merged = mergeConfig(a.meta, a.config);
        return {
          id: a.meta.id,
          name: a.meta.name,
          description: a.meta.description,
          source: a.meta.source,
          type: a.meta.type,
          icon: merged.icon || '/public_icons/assistant.svg',
          enabled: merged.enabled,
          supportedInputs: merged.supportedInputs || ['text'],
        };
      })
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
