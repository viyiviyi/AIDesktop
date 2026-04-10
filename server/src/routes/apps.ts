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
        icon: a.meta.icon
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
    res.json(app);
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
      return res.status(403).json({ error: 'Cannot modify system apps' });
    }

    const updated = await appLoader.updateApp(req.params.appId, req.body);
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

export default router;
