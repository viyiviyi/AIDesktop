import { Router, Request, Response } from 'express';
import { mcpServiceRegistry } from '../mcp/service.js';

const router = Router();

// Get all available MCP services
router.get('/services', async (req: Request, res: Response) => {
  try {
    const services = mcpServiceRegistry.getAllServices();
    res.json({ services });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Call MCP method
router.post('/call', async (req: Request, res: Response) => {
  try {
    const { service, method, args } = req.body;

    if (!service || !method) {
      return res.status(400).json({ error: 'Service and method are required' });
    }

    const result = await mcpServiceRegistry.callMethod(
      service,
      method,
      args || {},
      {}
    );

    res.json({ result });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
