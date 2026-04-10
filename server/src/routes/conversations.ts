import { Router, Request, Response } from 'express';
import { conversationService } from '../services/conversation.js';
import { appLoader } from '../services/appLoader.js';
import { agentEngine } from '../agents/engine.js';

const router = Router({ mergeParams: true });

// Get all conversations for an app
router.get('/', async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;
    const app = appLoader.getApp(appId);

    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    const conversations = await conversationService.getConversations(appId);
    res.json({ conversations });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Get single conversation
router.get('/:convId', async (req: Request, res: Response) => {
  try {
    const { appId, convId } = req.params;
    const conversation = await conversationService.getConversation(appId, convId);

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    res.json(conversation);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Create new conversation
router.post('/', async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;
    const { title } = req.body;

    const app = appLoader.getApp(appId);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    const conversation = await conversationService.createConversation(appId, title);
    res.status(201).json(conversation);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Delete conversation
router.delete('/:convId', async (req: Request, res: Response) => {
  try {
    const { appId, convId } = req.params;
    const deleted = await conversationService.deleteConversation(appId, convId);

    if (!deleted) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Send message (non-streaming)
router.post('/:convId/messages', async (req: Request, res: Response) => {
  try {
    const { appId, convId } = req.params;
    const { content } = req.body;

    if (!content || !Array.isArray(content)) {
      return res.status(400).json({ error: 'Content is required and must be an array' });
    }

    const app = appLoader.getApp(appId);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    const conversation = await conversationService.getConversation(appId, convId);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Add user message
    await conversationService.addMessage(appId, convId, 'user', content);

    // Process with AI
    const { assistantMessage } = await agentEngine.processMessage(appId, convId, content);

    res.json({ message: assistantMessage });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Send message (streaming via SSE)
router.get('/:convId/stream', async (req: Request, res: Response) => {
  try {
    const { appId, convId } = req.params;
    const { content } = req.query;

    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'Content query parameter is required' });
    }

    const app = appLoader.getApp(appId);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    const conversation = await conversationService.getConversation(appId, convId);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Add user message
    await conversationService.addMessage(appId, convId, 'user', [{ type: 'text', text: content }]);

    // Process with AI and stream response
    const { assistantMessage } = await agentEngine.processMessage(
      appId,
      convId,
      [{ type: 'text', text: content }]
    );

    // Send the complete response
    res.write(`event: message\ndata: ${JSON.stringify(assistantMessage)}\n\n`);
    res.write(`event: done\ndata: ${JSON.stringify({ success: true })}\n\n`);
    res.end();
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Update conversation title
router.put('/:convId', async (req: Request, res: Response) => {
  try {
    const { appId, convId } = req.params;
    const { title } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const updated = await conversationService.updateConversationTitle(appId, convId, title);
    if (!updated) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
