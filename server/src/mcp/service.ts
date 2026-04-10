import type { MCPService } from '../types/index.js';

// Built-in MCP services
const builtInServices: Record<string, MCPService> = {
  'mcp.agent': {
    name: 'mcp.agent',
    description: 'Agent management service - list and call agents',
    methods: ['list', 'call', 'getInfo']
  },
  'mcp.window': {
    name: 'mcp.window',
    description: 'Window management service - open, close, list windows',
    methods: ['open', 'close', 'list', 'focus', 'minimize', 'maximize']
  },
  'mcp.filesystem': {
    name: 'mcp.filesystem',
    description: 'File system service - read, write, list files',
    methods: ['read', 'write', 'list', 'mkdir', 'delete']
  },
  'mcp.settings': {
    name: 'mcp.settings',
    description: 'Settings service - get and update desktop settings',
    methods: ['get', 'update']
  }
};

class MCPServiceRegistry {
  private services: Map<string, MCPService> = new Map();

  constructor() {
    // Register built-in services
    for (const [name, service] of Object.entries(builtInServices)) {
      this.services.set(name, service);
    }
  }

  getService(name: string): MCPService | undefined {
    return this.services.get(name);
  }

  getAllServices(): MCPService[] {
    return Array.from(this.services.values());
  }

  registerService(service: MCPService): void {
    this.services.set(service.name, service);
  }

  unregisterService(name: string): boolean {
    // Cannot unregister built-in services
    if (builtInServices[name]) {
      return false;
    }
    return this.services.delete(name);
  }

  async callMethod(
    serviceName: string,
    method: string,
    args: Record<string, unknown>,
    context: { appId?: string; userId?: string }
  ): Promise<unknown> {
    const service = this.services.get(serviceName);
    if (!service) {
      throw new Error(`Service ${serviceName} not found`);
    }

    if (!service.methods.includes(method)) {
      throw new Error(`Method ${method} not found on service ${serviceName}`);
    }

    // Route to built-in handlers
    switch (serviceName) {
      case 'mcp.agent':
        return this.handleAgentMethod(method, args, context);
      case 'mcp.window':
        return this.handleWindowMethod(method, args, context);
      case 'mcp.filesystem':
        return this.handleFilesystemMethod(method, args, context);
      case 'mcp.settings':
        return this.handleSettingsMethod(method, args, context);
      default:
        throw new Error(`Service ${serviceName} not implemented`);
    }
  }

  private async handleAgentMethod(
    method: string,
    args: Record<string, unknown>,
    context: { appId?: string }
  ): Promise<unknown> {
    const { appLoader } = await import('../services/appLoader.js');

    switch (method) {
      case 'list':
        return {
          agents: appLoader.getAllApps()
            .filter(a => a.meta.type === 'desktop')
            .map(a => ({
              id: a.meta.id,
              name: a.meta.name,
              description: a.meta.description,
              type: a.meta.type
            }))
        };
      case 'getInfo':
        const app = appLoader.getApp(args.id as string);
        return app ? { id: app.meta.id, name: app.meta.name, ...app } : null;
      case 'call':
        // This would trigger another agent - simplified for now
        return { success: true, message: 'Agent call initiated' };
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }

  private async handleWindowMethod(
    method: string,
    args: Record<string, unknown>,
    context: { appId?: string }
  ): Promise<unknown> {
    // Window management is primarily client-side
    // Server just validates the request
    switch (method) {
      case 'list':
        // This would need to be extended with actual window state
        return { windows: [] };
      case 'open':
      case 'close':
      case 'focus':
      case 'minimize':
      case 'maximize':
        return { success: true };
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }

  private async handleFilesystemMethod(
    method: string,
    args: Record<string, unknown>,
    context: { appId?: string }
  ): Promise<unknown> {
    const fs = await import('fs/promises');
    const path = await import('path');
    const { DATA_DIR } = await import('../utils/file.js');

    const basePath = args.basePath as string || '';
    const fullPath = path.join(DATA_DIR, basePath, args.path as string || '');

    switch (method) {
      case 'read':
        try {
          const content = await fs.readFile(fullPath, 'utf-8');
          return { content };
        } catch {
          throw new Error(`Failed to read file: ${args.path}`);
        }
      case 'write':
        try {
          await fs.writeFile(fullPath, args.content as string, 'utf-8');
          return { success: true };
        } catch {
          throw new Error(`Failed to write file: ${args.path}`);
        }
      case 'list':
        try {
          const entries = await fs.readdir(fullPath, { withFileTypes: true });
          return {
            entries: entries.map(e => ({
              name: e.name,
              isDirectory: e.isDirectory(),
              isFile: e.isFile()
            }))
          };
        } catch {
          throw new Error(`Failed to list directory: ${args.path}`);
        }
      case 'mkdir':
        try {
          await fs.mkdir(fullPath, { recursive: true });
          return { success: true };
        } catch {
          throw new Error(`Failed to create directory: ${args.path}`);
        }
      case 'delete':
        try {
          await fs.rm(fullPath, { recursive: true });
          return { success: true };
        } catch {
          throw new Error(`Failed to delete: ${args.path}`);
        }
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }

  private async handleSettingsMethod(
    method: string,
    args: Record<string, unknown>,
    context: { appId?: string }
  ): Promise<unknown> {
    const { settingsService } = await import('../services/settings.js');

    switch (method) {
      case 'get':
        return settingsService.getSettings();
      case 'update':
        return settingsService.updateSettings(args as Record<string, unknown>);
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }
}

export const mcpServiceRegistry = new MCPServiceRegistry();
