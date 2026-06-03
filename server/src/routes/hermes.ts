import { Router, Request, Response } from 'express';
import { settingsService } from '../services/settings.js';
import { logger } from '../utils/logger.js';
import { getProviders, getModels } from '@earendil-works/pi-ai';

const router = Router();

/**
 * GET /api/hermes/health
 * 返回后端 AI provider 的健康状态
 * 现在支持任意已配置的 provider，不需要特定 Hermes
 */
router.get('/health', async (_req: Request, res: Response) => {
  try {
    const modes = await settingsService.getModes();
    const enabledProviders = modes.providers.filter(p => p.enabled !== false);

    const configured = enabledProviders.length > 0;
    const activeProvider = enabledProviders[0] || null;

    res.json({
      status: configured ? 'ok' : 'warning',
      ai: {
        configured,
        providersCount: modes.providers.length,
        enabledCount: enabledProviders.length,
      },
      activeProvider: activeProvider ? {
        id: activeProvider.id,
        name: activeProvider.name,
        baseUrl: activeProvider.baseUrl || '(default)',
        modelsCount: activeProvider.models.length,
      } : null,
    });
  } catch (error) {
    logger.error('AIHealth', `Health check failed: ${(error as Error).message}`);
    res.status(503).json({
      status: 'error',
      error: (error as Error).message,
    });
  }
});

/**
 * GET /api/hermes/status
 * 返回完整的 AI provider 信息，包括可用模型
 */
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const modes = await settingsService.getModes();
    const defaultModel = await settingsService.getDefaultModel();
    const enabledProviders = modes.providers.filter(p => p.enabled !== false);

    res.json({
      configured: enabledProviders.length > 0,
      providers: modes.providers.map(p => ({
        id: p.id,
        name: p.name,
        apiType: p.apiType,
        baseUrl: p.baseUrl,
        enabled: p.enabled !== false,
        models: p.models.map(m => ({
          id: m.id,
          name: m.name,
          maxTokens: m.maxTokens,
          supports: m.supports,
        })),
      })),
      defaultModel: defaultModel.providerId ? {
        providerId: defaultModel.providerId,
        modelId: defaultModel.modelId,
      } : null,
      // pi-ai 内置的已知 providers
      builtinProviders: getProviders(),
    });
  } catch (error) {
    logger.error('AIStatus', `Status check failed: ${(error as Error).message}`);
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
