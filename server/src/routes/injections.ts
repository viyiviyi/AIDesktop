import { Router, Request, Response } from 'express';
import { appState } from '../services/appState.js';
import { memoryService } from '../services/memory.js';
import { skillService } from '../services/skillService.js';
import type { InjectionBlock } from '../types/index.js';

const router = Router();

// GET /:appId/injections — 构建注入摘要块列表
router.get('/', async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;
    const convId = req.query.convId as string | undefined;

    const app = appState.getApp(appId);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    const blocks: InjectionBlock[] = [];

    // ── source: 'app' ──────────────────────────────
    const appDetail = app.appMd
      ? app.appMd.slice(0, 200) + (app.appMd.length > 200 ? '...' : '')
      : '(无应用定义文档)';
    blocks.push({
      source: 'app',
      label: '应用定义',
      title: app.meta.name,
      detail: appDetail,
    });

    // ── source: 'agents' ───────────────────────────
    const visibleApps = app.meta.visibleApps || [];
    if (visibleApps.length > 0) {
      const agentNames = visibleApps
        .map(id => {
          const agent = appState.getApp(id);
          return agent ? `${agent.meta.name} (${id})` : id;
        })
        .join('\n');
      blocks.push({
        source: 'agents',
        label: '可调用的其他 Agent',
        title: `${visibleApps.length} 个 Agent`,
        detail: agentNames,
      });
    } else {
      blocks.push({
        source: 'agents',
        label: '可调用的其他 Agent',
        title: '无可用 Agent',
        detail: '该应用未配置可调用的其他 Agent。',
      });
    }

    // ── source: 'skills' ───────────────────────────
    const appSkillIds = app.skills || [];
    if (appSkillIds.length > 0) {
      const enabledSkills = await skillService.getEnabledSkillsForApp(appSkillIds);
      if (enabledSkills.length > 0) {
        const skillLines = enabledSkills
          .map(s => `- ${s.name} (${s.id}): ${s.description}`)
          .join('\n');
        blocks.push({
          source: 'skills',
          label: '已加载的技能',
          title: `${enabledSkills.length} 个技能`,
          detail: skillLines,
        });
      } else {
        blocks.push({
          source: 'skills',
          label: '已加载的技能',
          title: '0 个技能',
          detail: '应用配置了技能但未找到已启用的技能，请先在技能管理中启用。',
        });
      }
    } else {
      blocks.push({
        source: 'skills',
        label: '已加载的技能',
        title: '无技能',
        detail: '该应用未配置技能。',
      });
    }

    // ── source: 'memory' ───────────────────────────
    const appStats = await memoryService.stats('app', appId);
    let memoryDetail = `【应用级记忆】总数: ${appStats.total}`;
    const typeSummary = Object.entries(appStats.byType)
      .map(([t, c]) => `${t}: ${c}`)
      .join(', ');
    if (typeSummary) memoryDetail += ` | ${typeSummary}`;

    if (convId) {
      const convStats = await memoryService.stats('conversation', appId, convId);
      memoryDetail += `\n【会话级记忆】总数: ${convStats.total}`;
      const convTypeSummary = Object.entries(convStats.byType)
        .map(([t, c]) => `${t}: ${c}`)
        .join(', ');
      if (convTypeSummary) memoryDetail += ` | ${convTypeSummary}`;
    }

    blocks.push({
      source: 'memory',
      label: '记忆',
      title: `共 ${appStats.total} 条${convId ? ' (含会话)' : ''}`,
      detail: memoryDetail,
    });

    // ── source: 'goal' ─────────────────────────────
    if (convId) {
      const goals = await memoryService.getActiveGoals(appId, convId);
      const goalParts: string[] = [];
      if (goals.level1) goalParts.push(`【一级目标】${goals.level1.value}`);
      if (goals.level2) goalParts.push(`【二级目标】${goals.level2.value}`);
      if (goals.level3) goalParts.push(`【三级目标】${goals.level3.value} ← 当前待办`);
      const goalDetail = goalParts.length > 0 ? goalParts.join('\n') : '当前会话无活跃目标。';
      blocks.push({
        source: 'goal',
        label: '会话目标',
        title: goalParts.length > 0 ? `${goalParts.length} 级目标` : '无活跃目标',
        detail: goalDetail,
      });
    } else {
      blocks.push({
        source: 'goal',
        label: '会话目标',
        title: '无会话',
        detail: '未指定会话 ID，无法获取目标。',
      });
    }

    // ── source: 'prompt' ───────────────────────────
    const modelConfig = await appState.getDefaultModel();
    const promptDetail = modelConfig.providerId && modelConfig.modelId
      ? `当前模型: ${modelConfig.providerId}/${modelConfig.modelId}`
      : '未配置默认模型';
    blocks.push({
      source: 'prompt',
      label: '系统提示词',
      title: modelConfig.providerId || '未配置',
      detail: promptDetail,
    });

    res.json({ blocks });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
