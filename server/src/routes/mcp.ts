import { Router, Request, Response } from 'express';
import { mcpServiceRegistry } from '../mcp/service.js';
import { mcpClientRegistry } from '../mcp/clientRegistry.js';
import { settingsService } from '../services/settings.js';
import { logger } from '../utils/logger.js';

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

// Get all connected MCP servers
router.get('/connections', async (req: Request, res: Response) => {
  try {
    const clients = mcpClientRegistry.listClients();
    const connections = clients.map((client) => ({
      connectionId: client.getConnectionId(),
      serverInfo: client.getServerInfo(),
      isConnected: client.isConnected(),
      isInitialized: client.isInitialized(),
      tools: client.getTools(),
      resources: client.getResources(),
    }));
    res.json({ connections });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Connect to an external MCP server
router.post('/connect', async (req: Request, res: Response) => {
  try {
    const { connection } = req.body;

    if (!connection || !connection.name) {
      return res.status(400).json({ error: 'Connection name is required' });
    }

    if (connection.transportType === 'sse' && !connection.url) {
      return res.status(400).json({ error: 'SSE transport requires a url' });
    }

    if ((!connection.transportType || connection.transportType === 'stdio') && !connection.command) {
      return res.status(400).json({ error: 'Stdio transport requires a command' });
    }

    logger.info('MCPRoutes', `Connecting to external MCP server: ${connection.name}`);

    // Create or update connection in settings
    const mcp = await settingsService.getMcp();
    const existingIndex = mcp.connections.findIndex((c) => c.id === connection.id);

    let updatedConnection;
    if (existingIndex >= 0) {
      mcp.connections[existingIndex] = { ...mcp.connections[existingIndex], ...connection };
      updatedConnection = mcp.connections[existingIndex];
    } else {
      // Generate new ID
      updatedConnection = {
        ...connection,
        id: connection.id || `mcp-${Date.now()}`,
        enabled: true,
        services: [],
      };
      mcp.connections.push(updatedConnection);
    }

    await settingsService.updateMcp({ connections: mcp.connections });

    // Connect to the MCP server
    try {
      const client = await mcpClientRegistry.getOrCreateClient(updatedConnection);
      res.json({
        success: true,
        connection: {
          ...updatedConnection,
          connected: client.isConnected(),
          initialized: client.isInitialized(),
          tools: client.getTools(),
          resources: client.getResources(),
        },
      });
    } catch (connectError) {
      // If connection fails, still return the connection config but mark as not connected
      logger.error('MCPRoutes', `Failed to connect: ${(connectError as Error).message}`);
      res.json({
        success: false,
        connection: {
          ...updatedConnection,
          connected: false,
          initialized: false,
          error: (connectError as Error).message,
        },
      });
    }
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Disconnect from an external MCP server
router.delete('/connect/:connectionId', async (req: Request, res: Response) => {
  try {
    const { connectionId } = req.params;

    logger.info('MCPRoutes', `Disconnecting from MCP server: ${connectionId}`);

    // Remove client from registry
    await mcpClientRegistry.removeClient(connectionId);

    // Update settings to mark as disconnected
    const mcp = await settingsService.getMcp();
    const connection = mcp.connections.find((c) => c.id === connectionId);
    if (connection) {
      connection.enabled = false;
      await settingsService.updateMcp({ connections: mcp.connections });
    }

    res.json({ success: true, connectionId });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Get tools from a specific connection
router.get('/connections/:connectionId/tools', async (req: Request, res: Response) => {
  try {
    const { connectionId } = req.params;

    const client = mcpClientRegistry.getClient(connectionId);
    if (!client) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    res.json({ tools: client.getTools() });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Get a single connection with tool enable status
router.get('/connections/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Get connection config from settings
    const mcp = await settingsService.getMcp();
    const connectionConfig = mcp.connections.find(c => c.id === id);
    if (!connectionConfig) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    // Get client tools if connected
    const client = mcpClientRegistry.getClient(id);
    const tools = client ? client.getTools() : [];
    const enabledTools = connectionConfig.enabledTools || [];

    // Mark each tool's enabled status
    const toolsWithStatus = tools.map((tool: any) => ({
      name: tool.name,
      description: tool.description || '',
      inputSchema: tool.inputSchema || {},
      enabled: enabledTools.length === 0 || enabledTools.includes(tool.name),
    }));

    res.json({
      connection: {
        id: connectionConfig.id,
        name: connectionConfig.name,
        command: connectionConfig.command,
        args: connectionConfig.args,
        enabled: connectionConfig.enabled,
        enabledTools: connectionConfig.enabledTools,
        tools: toolsWithStatus,
      },
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Update enabled tools for a connection
router.put('/connections/:id/tools', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { enabledTools } = req.body;

    if (!Array.isArray(enabledTools)) {
      return res.status(400).json({ error: 'enabledTools must be an array of tool name strings' });
    }

    const result = await settingsService.updateMcpConnection(id, { enabledTools });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Call a tool on a specific connection
router.post('/connections/:connectionId/call', async (req: Request, res: Response) => {
  try {
    const { connectionId } = req.params;
    const { tool, args } = req.body;

    if (!tool) {
      return res.status(400).json({ error: 'Tool name is required' });
    }

    logger.info('MCPRoutes', `Calling tool ${tool} on connection ${connectionId}`);

    const result = await mcpClientRegistry.callTool(connectionId, tool, args || {});

    res.json({ result });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
