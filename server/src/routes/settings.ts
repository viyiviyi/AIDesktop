import { Router, Request, Response } from 'express';
import { settingsService } from '../services/settings.js';
import { OpenAIAdapter } from '../models/openai.js';
import type { ApiCompatType } from '../types/index.js';

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

// Update single provider
router.put('/modes/providers/:providerId', async (req: Request, res: Response) => {
  try {
    const modes = await settingsService.updateProvider(req.params.providerId, req.body);
    res.json(modes);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Add new provider
router.post('/modes/providers', async (req: Request, res: Response) => {
  try {
    const modes = await settingsService.addProvider(req.body);
    res.json(modes);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Delete provider
router.delete('/modes/providers/:providerId', async (req: Request, res: Response) => {
  try {
    const modes = await settingsService.deleteProvider(req.params.providerId);
    res.json(modes);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Fetch available models from provider API
router.post('/modes/fetch-models', async (req: Request, res: Response) => {
  try {
    const { apiKey, baseUrl, apiType } = req.body;

    if (!apiKey || !baseUrl) {
      res.status(400).json({ error: 'API key and base URL are required' });
      return;
    }

    // Only OpenAI-compatible APIs are supported for now
    if (apiType !== 'openai' && apiType !== 'custom') {
      res.json({ models: [] });
      return;
    }

    const adapter = new OpenAIAdapter(apiKey, baseUrl);
    const models = await adapter.listModels();

    res.json({ models });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message, models: [] });
  }
});

// Get MCP settings
router.get('/mcp', async (req: Request, res: Response) => {
  try {
    const mcp = await settingsService.getMcp();
    res.json(mcp);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Update MCP settings
router.put('/mcp', async (req: Request, res: Response) => {
  try {
    const mcp = await settingsService.updateMcp(req.body);
    res.json(mcp);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Connect new MCP service
router.post('/mcp/connect', async (req: Request, res: Response) => {
  try {
    const mcp = await settingsService.connectMcp(req.body);
    res.json(mcp);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Disconnect MCP service
router.delete('/mcp/:connectionId', async (req: Request, res: Response) => {
  try {
    const mcp = await settingsService.disconnectMcp(req.params.connectionId);
    res.json(mcp);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Get skill settings
router.get('/skills', async (req: Request, res: Response) => {
  try {
    const skills = await settingsService.getSkills();
    res.json(skills);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Update skill settings
router.put('/skills', async (req: Request, res: Response) => {
  try {
    const skills = await settingsService.updateSkills(req.body);
    res.json(skills);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Add new skill
router.post('/skills', async (req: Request, res: Response) => {
  try {
    const skills = await settingsService.addSkill(req.body);
    res.json(skills);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Delete skill
router.delete('/skills/:skillId', async (req: Request, res: Response) => {
  try {
    const skills = await settingsService.deleteSkill(req.params.skillId);
    res.json(skills);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
