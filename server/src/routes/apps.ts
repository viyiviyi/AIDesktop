import { Router, Request, Response } from 'express';
import { appLoader } from '../services/appLoader.js';
import type { AppSource } from '../types/index.js';

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
      apps: apps.map(a => ({
        id: a.meta.id,
        name: a.meta.name,
        description: a.meta.description,
        source: a.meta.source,
        type: a.meta.type,
        icon: a.meta.icon,
        enabled: a.meta.enabled !== false,
        replySchema: a.meta.replySchema
      }))
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Get app details
router.get('/:appId', async (req: Request, res: Response) => {
  try {
    const app = appLoader.getApp(req.params.appId);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }
    // Return flat structure: merge meta with app-level fields
    res.json({
      meta: app.meta,
      appMd: app.appMd,
      mcpServices: app.mcpServices,
      skills: app.skills,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Create new app (user source only)
router.post('/', async (req: Request, res: Response) => {
  try {
    const { meta, appMd, mcpServices, skills } = req.body;

    if (!meta?.name) {
      return res.status(400).json({ error: 'App name is required' });
    }

    const app = await appLoader.createApp(
      { meta, appMd, mcpServices, skills },
      'user'
    );

    res.status(201).json(app);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Update app (user apps only)
router.put('/:appId', async (req: Request, res: Response) => {
  try {
    const app = appLoader.getApp(req.params.appId);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    if (app.meta.source === 'system') {
      // 系统应用只允许更新工具/可见性/模型等运行时配置
      const { models, visibleApps, visibleServices, tools, replySchema } = req.body;
      const updates: Partial<typeof app.meta> = {};
      if (models !== undefined) updates.models = models;
      if (visibleApps !== undefined) updates.visibleApps = visibleApps;
      if (visibleServices !== undefined) updates.visibleServices = visibleServices;
      if (tools !== undefined) updates.tools = tools;
      if (replySchema !== undefined) updates.replySchema = replySchema;

      if (Object.keys(updates).length === 0) {
        return res.status(403).json({ error: 'Cannot modify system app settings' });
      }

      const updated = await appLoader.updateApp(req.params.appId, updates);
      return res.json(updated);
    }

    // Handle flat structure from client - extract known meta fields
    const { models, enabled, backgroundImage, supportedInputs, inputDescription, outputDescription, visibleApps, visibleServices, tools, replySchema, headerParams, bodyParams, ...rest } = req.body;
    const updates: Partial<typeof app.meta> = { ...rest };
    if (models !== undefined) updates.models = models;
    if (enabled !== undefined) updates.enabled = enabled;
    if (backgroundImage !== undefined) updates.backgroundImage = backgroundImage;
    if (supportedInputs !== undefined) updates.supportedInputs = supportedInputs;
    if (inputDescription !== undefined) updates.inputDescription = inputDescription;
    if (outputDescription !== undefined) updates.outputDescription = outputDescription;
    if (visibleApps !== undefined) updates.visibleApps = visibleApps;
    if (visibleServices !== undefined) updates.visibleServices = visibleServices;
    if (tools !== undefined) updates.tools = tools;
    if (replySchema !== undefined) updates.replySchema = replySchema;

    const updated = await appLoader.updateApp(req.params.appId, updates);
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
      apps: apps.map(a => ({
        id: a.meta.id,
        name: a.meta.name,
        description: a.meta.description,
        source: a.meta.source,
        type: a.meta.type,
        icon: a.meta.icon,
        enabled: a.meta.enabled !== false,
        replySchema: a.meta.replySchema
      }))
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
