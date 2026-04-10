import { Router, Request, Response } from 'express';
import { settingsService } from '../services/settings.js';

const router = Router();

// Get desktop settings
router.get('/', async (req: Request, res: Response) => {
  try {
    const settings = await settingsService.getSettings();
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Update desktop settings
router.put('/', async (req: Request, res: Response) => {
  try {
    const settings = await settingsService.updateSettings(req.body);
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Get model providers
router.get('/modes', async (req: Request, res: Response) => {
  try {
    const modes = await settingsService.getModes();
    res.json(modes);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Update model providers
router.put('/modes', async (req: Request, res: Response) => {
  try {
    const modes = await settingsService.updateModes(req.body);
    res.json(modes);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
