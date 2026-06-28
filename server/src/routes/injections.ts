import { Router, Request, Response } from 'express';
import { appState } from '../services/appState.js';
import { memoryService } from '../services/memory.js';
import { skillService } from '../services/skillService.js';
import type { InjectionBlock } from '../types/index.js';

const router = Router({ mergeParams: true });

// 获取 App 实际可用的工具列表（合并 meta + config）
function getEffectiveTools(appId: string): string[] {
  const app = appState.getApp(appId);
  if (!app) return [];
  const merged = new Set([...(app.meta.tools || []), ...(app.config.tools || [])]);
  return [...merged].sort();
}

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

    // ── 第 1 位: 'app' — 应用状态（合并 app + agents + skills + prompt）──
    const appDetail = app.appMd
      ? app.appMd.slice(0, 200) + (app.appMd.length > 200 ? '...' : '')
      : '(无应用定义文档)';

    const visibleApps = app.meta.visibleApps || [];
    const agentNames = visibleApps.length > 0
      ? visibleApps.map(id => {
          const agent = appState.getApp(id);
          return agent ? `${agent.meta.name} (${id})` : id;
        }).join('、')
      : '无';

    const appSkillIds = app.skills || [];
    let skillText = '无';
    if (appSkillIds.length > 0) {
      const enabledSkills = await skillService.getEnabledSkillsForApp(appSkillIds);
      if (enabledSkills.length > 0) {
        skillText = enabledSkills.map(s => s.name).join('、');
      }
    }

    const modelConfig = await appState.getDefaultModel();
    const modelText = modelConfig.providerId && modelConfig.modelId
      ? `${modelConfig.providerId}/${modelConfig.modelId}`
      : '未配置';

    const appStatusDetail = [
      `【应用名称】${app.meta.name}`,
      `【系统提示】${appDetail}`,
      `【可用 Agent】${agentNames}`,
      `【已加载技能】${skillText}`,
      `【当前模型】${modelText}`,
    ].join('\n');

    blocks.push({
      source: 'app',
      label: '应用状态',
      title: app.meta.name,
      detail: appStatusDetail,
    });

    // ── 可使用工具（始终显示在第 2 位）──
    const effectiveTools = getEffectiveTools(appId);
    const toolsDetail = effectiveTools.length > 0
      ? effectiveTools.map(t => `- ${t}`).join('\n')
      : '该应用未配置任何工具。';
    blocks.push({
      source: 'tools',
      label: '可使用工具',
      title: `${effectiveTools.length} 个工具`,
      detail: toolsDetail,
    });

    // ── 第 3 位: 'memory' ──
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

    // ── 第 4 位: 'goal' ──
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

    res.json({ blocks });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
