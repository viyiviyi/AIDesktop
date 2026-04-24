import { spawn, ChildProcess } from 'child_process';
import { logger } from '../utils/logger.js';
import os from 'os';

export interface MCPProcess {
  connectionId: string;
  process: ChildProcess;
  connected: boolean;
  startedAt: Date;
}

/**
 * MCP进程管理器
 * 负责启动、停止和管理外部MCP服务器进程
 */
class MCPProcessManager {
  private processes: Map<string, MCPProcess> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private isWindows = os.platform() === 'win32';

  constructor() {
    // 启动心跳检测
    this.startHeartbeat();
  }

  /**
   * 启动一个MCP服务器进程
   */
  async startProcess(connectionId: string, command: string, args: string[]): Promise<void> {
    if (this.processes.has(connectionId)) {
      logger.warn('MCPProcessManager', `Process already exists for connection ${connectionId}`);
      return;
    }

    logger.info('MCPProcessManager', `Starting process: ${command} ${args.join(' ')}`);

    return new Promise((resolve, reject) => {
      try {
        // Windows需要使用cmd.exe来执行npx等命令
        let cmd = command;
        let cmdArgs = args;

        if (this.isWindows) {
          // 将命令和参数组合成 cmd /c "command args..."
          const combinedCommand = `${command} ${args.join(' ')}`;
          cmd = 'cmd.exe';
          cmdArgs = ['/c', combinedCommand];
          logger.debug('MCPProcessManager', `Windows detected, running: ${combinedCommand}`);
        }

        const child = spawn(cmd, cmdArgs, {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env },
          // Windows下需要shell选项来查找命令
          shell: this.isWindows,
        });

        const mcpProcess: MCPProcess = {
          connectionId,
          process: child,
          connected: true,
          startedAt: new Date(),
        };

        this.processes.set(connectionId, mcpProcess);

        // 处理进程退出
        child.on('exit', (code, signal) => {
          logger.info('MCPProcessManager', `Process ${connectionId} exited with code ${code}, signal ${signal}`);
          mcpProcess.connected = false;
          this.processes.delete(connectionId);
        });

        // 处理进程错误
        child.on('error', (error) => {
          logger.error('MCPProcessManager', `Process ${connectionId} error: ${error.message}`);
          mcpProcess.connected = false;
          this.processes.delete(connectionId);
          reject(error);
        });

        // 处理stderr输出
        child.stderr?.on('data', (data) => {
          const message = data.toString().trim();
          if (message) {
            logger.debug('MCPProcessManager', `[${connectionId} stderr] ${message}`);
          }
        });

        // 进程已启动
        logger.info('MCPProcessManager', `Process ${connectionId} started successfully`);
        resolve();
      } catch (error) {
        logger.error('MCPProcessManager', `Failed to start process: ${(error as Error).message}`);
        reject(error);
      }
    });
  }

  /**
   * 停止一个MCP服务器进程
   */
  async stopProcess(connectionId: string): Promise<void> {
    const mcpProcess = this.processes.get(connectionId);
    if (!mcpProcess) {
      logger.warn('MCPProcessManager', `No process found for connection ${connectionId}`);
      return;
    }

    logger.info('MCPProcessManager', `Stopping process ${connectionId}`);

    return new Promise((resolve) => {
      const { process: child } = mcpProcess;

      // 优雅关闭
      child.once('exit', () => {
        logger.info('MCPProcessManager', `Process ${connectionId} stopped gracefully`);
        this.processes.delete(connectionId);
        resolve();
      });

      if (this.isWindows) {
        // Windows下使用taskkill
        child.kill('SIGTERM');
      } else {
        child.kill('SIGTERM');
      }

      // 5秒后强制终止
      setTimeout(() => {
        if (this.processes.has(connectionId)) {
          logger.warn('MCPProcessManager', `Process ${connectionId} did not exit gracefully, forcing kill`);
          if (this.isWindows) {
            // Windows下强制终止
            child.kill('SIGKILL');
          } else {
            child.kill('SIGKILL');
          }
          this.processes.delete(connectionId);
          resolve();
        }
      }, 5000);
    });
  }

  /**
   * 获取进程
   */
  getProcess(connectionId: string): MCPProcess | undefined {
    return this.processes.get(connectionId);
  }

  /**
   * 检查进程是否运行
   */
  isRunning(connectionId: string): boolean {
    const mcpProcess = this.processes.get(connectionId);
    return mcpProcess?.connected ?? false;
  }

  /**
   * 获取所有进程
   */
  listProcesses(): MCPProcess[] {
    return Array.from(this.processes.values());
  }

  /**
   * 停止所有进程
   */
  async stopAll(): Promise<void> {
    logger.info('MCPProcessManager', 'Stopping all MCP processes');
    const connectionIds = Array.from(this.processes.keys());
    await Promise.all(connectionIds.map((id) => this.stopProcess(id)));
  }

  /**
   * 启动心跳检测
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      for (const [connectionId, mcpProcess] of this.processes.entries()) {
        if (!mcpProcess.connected) {
          continue;
        }
        // 检查进程是否还在运行
        if (mcpProcess.process.exitCode !== null) {
          logger.warn('MCPProcessManager', `Process ${connectionId} heartbeat failed: process not running`);
          mcpProcess.connected = false;
          this.processes.delete(connectionId);
        }
      }
    }, 30000); // 每30秒检查一次
  }

  /**
   * 清理心跳检测
   */
  destroy(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    this.stopAll();
  }
}

export const mcpProcessManager = new MCPProcessManager();
