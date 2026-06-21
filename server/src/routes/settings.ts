import { Router, Request, Response } from 'express';
import { settingsService } from '../services/settings.js';
import { OpenAIAdapter } from '../models/openai.js';
import type { ApiCompatType } from '../types/index.js';
import { randomUUID } from 'crypto';
import { streamSimple } from '@earendil-works/pi-ai';
import { findModel } from '../models/pi-adapter.js';
import { serverLogger } from '../utils/logger.js';

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

    // Try to fetch models for OpenAI-compatible and custom APIs
    // Custom APIs are usually OpenAI-compatible but self-hosted
    if (apiType !== 'openai' && apiType !== 'custom') {
      res.json({ models: [] });
      return;
    }

    // For custom APIs, still try OpenAI adapter since most custom APIs are OpenAI-compatible
    // The distinction is that custom APIs might need different endpoints

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

// Get skills list from public_data/skills/ (带启用状态)
router.get('/skills/list', async (req: Request, res: Response) => {
  try {
    const { skillService } = await import('../services/skillService.js');
    // 返回所有技能 + 启用状态
    const allRaw = await skillService.getAllSkillsRaw();
    const enabledConfig = await skillService.getEnabledConfig();
    const skillsWithStatus = allRaw.map(s => ({
      ...s,
      enabled: enabledConfig.skills.some(e => e.dir === s.id),
    }));
    res.json({ skills: skillsWithStatus, enabled: enabledConfig.skills });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Toggle skill enabled/disabled
router.put('/skills/:dir/toggle', async (req: Request, res: Response) => {
  try {
    const { skillService } = await import('../services/skillService.js');
    const { dir } = req.params;
    const { enabled } = req.body;
    const config = await skillService.setSkillEnabled(dir, enabled);
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Get default model config
router.get('/default-model', async (req: Request, res: Response) => {
  try {
    const config = await settingsService.getDefaultModel();
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Update default model config
router.put('/default-model', async (req: Request, res: Response) => {
  try {
    const config = await settingsService.updateDefaultModel(req.body);
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Get window positions
router.get('/window-positions', async (req: Request, res: Response) => {
  try {
    const positions = await settingsService.getWindowPositions();
    res.json(positions);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Save window position
router.put('/window-positions/:appId', async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;
    const position = req.body;
    await settingsService.saveWindowPosition(appId, position);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Generate skill from conversations
router.post('/skills/generate', async (req: Request, res: Response) => {
  try {
    const { conversations } = req.body;
    if (!conversations || !Array.isArray(conversations) || conversations.length === 0) {
      res.status(400).json({ error: 'conversations array is required' });
      return;
    }

    // 1. 获取默认模型
    const modes = await settingsService.getModes();
    const defaultModelConfig = await settingsService.getDefaultModel();
    let providerId = defaultModelConfig.providerId;
    let modelId = defaultModelConfig.modelId;
    if (!providerId || !modelId) {
      res.status(400).json({ error: 'No default model configured. Please set a default model in settings.' });
      return;
    }
    const providerConfig = modes.providers.find((p: any) => p.id === providerId);
    if (!providerConfig) {
      res.status(400).json({ error: `Provider \"${providerId}\" not found.` });
      return;
    }
    const modelObj = findModel(modes.providers, providerId, modelId);
    if (!modelObj) {
      res.status(400).json({ error: `Model \"${modelId}\" not found.` });
      return;
    }

    // 2. 构建 AI 消息：将多轮对话拼接为系统提示 + 用户消息
    const conversationText = conversations.map((conv: any, i: number) => {
      const msgs = (conv.messages || []).map((m: any) =>
        `[${m.role}] ${m.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join(' ')}`
      ).join('\n');
      return `=== 会话 ${i + 1}: ${conv.title || conv.conversationId} ===\n${msgs}`;
    }).join('\n\n');

    const systemPrompt = `你是一个技能制作助手。你的任务是根据用户提供的AI助手与用户的对话记录，提炼出一个可复用的"技能"。

技能是一个markdown格式的提示词，当AI助手加载该技能后，会按照技能中描述的工作流程来帮助用户完成特定任务。

请遵循以下原则：
1. 分析对话中的任务类型、用户需求、AI助手的响应模式和工作流程
2. 提炼出通用的步骤和规则，形成一个完整的技能提示词
3. 技能提示词需要清晰描述：技能的目的、触发条件、执行步骤、注意事项
4. 只输出技能内容本身，不要额外解释
5. 技能需要用中文描述
6. 给技能起一个简短的名字（不超过10个字）
7. 给技能写一句简短描述（不超过30个字）

输出格式：
---skill-name
技能名称
---skill-description
技能描述
---skill-prompt
技能提示词内容`;

    const userMessage = `请根据以下对话记录制作一个技能：\n\n${conversationText}`;

    const aiContext: any[] = [
      { role: 'system', content: [{ type: 'text', text: systemPrompt }] },
      { role: 'user', content: [{ type: 'text', text: userMessage }] },
    ];

    const streamOptions: any = {};
    if (providerConfig.baseUrl) streamOptions.baseUrl = providerConfig.baseUrl;
    if (providerConfig.apiKey) streamOptions.apiKey = providerConfig.apiKey;
    // pi-ai 的 streamSimple 需要 headers 传 apiKey
    const headers: Record<string, string> = {};
    if (providerConfig.apiKey) {
      if (providerConfig.apiType === 'anthropic') {
        headers['x-api-key'] = providerConfig.apiKey;
      } else {
        headers['authorization'] = `Bearer ${providerConfig.apiKey}`;
      }
    }
    streamOptions.headers = headers;

    let fullText = '';
    const stream = streamSimple(modelObj, aiContext as any, streamOptions);
    for await (const chunk of stream as any) {
      if (chunk.type === 'text_delta' && chunk.text) {
        fullText += chunk.text;
      }
    }

    // 3. 解析 AI 输出
    const nameMatch = fullText.match(/---skill-name\s*\n([\s\S]*?)(?:\n---|$)/);
    const descMatch = fullText.match(/---skill-description\s*\n([\s\S]*?)(?:\n---|$)/);
    const promptMatch = fullText.match(/---skill-prompt\s*\n([\s\S]*)$/);

    const skillName = nameMatch ? nameMatch[1].trim() : '未命名技能';
    const skillDesc = descMatch ? descMatch[1].trim() : '';
    const skillPrompt = promptMatch ? promptMatch[1].trim() : fullText;

    // 4. 自动保存技能
    const newSkill = {
      id: randomUUID(),
      name: skillName,
      description: skillDesc,
      prompt: skillPrompt,
      enabled: true,
      config: {},
    };

    const currentSkills = await settingsService.getSkills();
    currentSkills.skills.push(newSkill);
    await settingsService.updateSkills({ skills: currentSkills.skills });

    serverLogger.info('skill-maker', `Generated skill: ${skillName}`);

    res.json({
      skill: newSkill,
      allSkills: currentSkills.skills,
    });
  } catch (error) {
    serverLogger.error('skill-maker', 'Failed to generate skill', error as Error);
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
