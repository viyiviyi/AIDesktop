import { Router, Request, Response } from 'express';
import { memoryService } from '../services/memory.js';

const router = Router({ mergeParams: true });

// POST /:appId/memory — 记忆/目标操作（前端管理界面用）
router.post('/', async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;
    const { method, args } = req.body;
    const convId = req.query.convId as string | undefined;

    if (!method) {
      return res.status(400).json({ error: 'Method is required' });
    }

    const scope = args?.scope || 'app';
    const effectiveConvId = scope === 'conversation' ? (args?.convId || convId) : undefined;

    switch (method) {
      case 'list': {
        const entries = await memoryService.getAll(scope as any, appId, effectiveConvId);
        return res.json(entries);
      }
      case 'remember': {
        const entry = await memoryService.remember(scope as any, appId, {
          type: args.type || 'fact',
          key: args.key,
          value: args.value,
          content: args.content,
          tags: args.tags,
          importance: args.importance,
          source: args.source || 'user',
          ttl: args.ttl,
        }, effectiveConvId);
        return res.json(entry);
      }
      case 'forget': {
        if (args.tag) {
          await memoryService.forgetByTag(scope as any, appId, args.tag, effectiveConvId);
        } else {
          await memoryService.forget(scope as any, appId, args.id, effectiveConvId);
        }
        return res.json({ success: true });
      }
      case 'getActiveGoals':
        if (!effectiveConvId) return res.status(400).json({ error: 'convId required for goal operations' });
        try {
          const goals = await memoryService.getActiveGoals(appId, effectiveConvId);
          return res.json(goals);
        } catch {
          return res.json({});
        }
      case 'getArchivedGoals':
        if (!effectiveConvId) return res.status(400).json({ error: 'convId required for goal operations' });
        try {
          const archived = await memoryService.getArchivedGoals(appId, effectiveConvId);
          return res.json(archived);
        } catch {
          return res.json([]);
        }
      case 'setGoal':
        if (!effectiveConvId) return res.status(400).json({ error: 'convId required for goal operations' });
        if (args.level === 1) await memoryService.setLevel1Goal(appId, effectiveConvId, args.value, args.source || 'user');
        else if (args.level === 2) await memoryService.setLevel2Goal(appId, effectiveConvId, args.value, args.source || 'user');
        else if (args.level === 3) await memoryService.setLevel3Goal(appId, effectiveConvId, args.value, args.source || 'user');
        else return res.status(400).json({ error: 'level must be 1, 2, or 3' });
        return res.json({ success: true });
      case 'completeGoal':
        if (!effectiveConvId) return res.status(400).json({ error: 'convId required for goal operations' });
        await memoryService.completeGoal(appId, effectiveConvId, args.level as 1|2|3);
        return res.json({ success: true });
      default:
        return res.status(400).json({ error: `Unknown method: ${method}` });
    }
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
