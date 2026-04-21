import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { BrowserSession, BrowserConfig, DEFAULT_CONFIG } from './types.js';
import * as path from 'path';
import * as fs from 'fs';

/**
 * BrowserManager - 浏览器生命周期管理器
 * 使用Playwright控制浏览器，实现多会话管理、页面导航、内容获取、用户交互
 * 采用单例模式，确保全局只有一个浏览器实例
 */
export class BrowserManager {
  private static instance: BrowserManager;
  // 会话映射表（sessionId -> BrowserSession）
  private sessions: Map<string, BrowserSession> = new Map();
  // 主浏览器实例
  private mainBrowser: Browser | null = null;
  // 浏览器配置
  private config: BrowserConfig = DEFAULT_CONFIG;

  // 私有构造函数（单例模式）
  private constructor() {
    // 设置 Playwright 浏览器路径
    const browsersPath = path.join(process.cwd(), 'playwright-browsers');
    if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
      process.env.PLAYWRIGHT_BROWSERS_PATH = browsersPath;
    }
  }

  // 获取单例实例
  public static getInstance(): BrowserManager {
    if (!BrowserManager.instance) {
      BrowserManager.instance = new BrowserManager();
    }
    return BrowserManager.instance;
  }

  // 获取当前配置
  public getConfig(): BrowserConfig {
    return this.config;
  }

  // 更新配置
  public updateConfig(newConfig: Partial<BrowserConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * 创建新会话
   * 如果已存在同名会话，先关闭再创建
   */
  public async createSession(sessionId: string = 'default'): Promise<BrowserSession> {
    // 如果会话已存在，先关闭
    if (this.sessions.has(sessionId)) {
      await this.closeSession(sessionId);
    }

    // 如果主浏览器不存在，创建它
    if (!this.mainBrowser) {
      this.mainBrowser = await chromium.launch({
        headless: this.config.headless,
        args: ['--window-size=1920,1080']
      });
    }

    // 创建新上下文和新页面
    const context = await this.mainBrowser.newContext({
      viewport: this.config.viewport,
      userAgent: this.config.userAgent
    });

    const page = await context.newPage();

    const session: BrowserSession = {
      id: sessionId,
      page,
      context,
      browser: this.mainBrowser,
      createdAt: new Date(),
      lastUsed: new Date(),
      url: '',
      title: ''
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * 获取会话（如果不存在则返回undefined）
   * 自动更新最后使用时间
   */
  public getSession(sessionId: string = 'default'): BrowserSession | undefined {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastUsed = new Date();
    }
    return session;
  }

  /**
   * 导航到指定URL
   */
  public async navigateTo(sessionId: string, url: string, timeout: number = 30000): Promise<{ title: string; url: string }> {
    let session = this.getSession(sessionId);
    if (!session) {
      session = await this.createSession(sessionId);
    }

    await session.page.goto(url, { timeout, waitUntil: 'domcontentloaded' });
    session.url = session.page.url();
    session.title = await session.page.title();

    return { title: session.title, url: session.url };
  }

  /**
   * 获取页面内容
   * @param contentType - 内容类型：dom（纯文本）、accessibility（可访问性树）、screenshot（截图）
   */
  public async getPageContent(
    sessionId: string = 'default',
    contentType?: 'dom' | 'accessibility' | 'screenshot'
  ): Promise<{ content: string; title: string; url: string }> {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`浏览器会话 ${sessionId} 不存在`);
    }

    // 更新最后使用时间
    session.lastUsed = new Date();

    const title = await session.page.title();
    const url = session.page.url();

    if (contentType === 'screenshot') {
      const screenshot = await session.page.screenshot({ type: 'png' });
      const base64 = screenshot.toString('base64');
      return {
        content: `![页面截图](data:image/png;base64,${base64})`,
        title,
        url
      };
    }

    // 获取 accessibility 树（可交互元素树）
    if (contentType === 'accessibility') {
      // @ts-ignore - accessibility.snapshot() 在 Playwright 类型中存在
      const snapshot = await session.page.accessibility.snapshot();
      const content = this.formatAccessibilityTree(snapshot);
      return { content, title, url };
    }

    // 获取 DOM 纯文本内容
    const domContent = await session.page.evaluate(() => {
      return document.body.innerText.substring(0, 5000);
    });

    return { content: domContent, title, url };
  }

  /**
   * 格式化可访问性树为可读文本
   */
  private formatAccessibilityTree(node: any, depth: number = 0): string {
    if (!node) return '';

    const indent = '  '.repeat(depth);
    let result = '';

    if (node.name) {
      result += `${indent}${node.role}: ${node.name}\n`;
    } else {
      result += `${indent}${node.role}\n`;
    }

    if (node.children) {
      for (const child of node.children) {
        result += this.formatAccessibilityTree(child, depth + 1);
      }
    }

    return result;
  }

  /**
   * 与页面交互
   * 支持：click、fill（填充文本）、press（按键）、hover、select、check、uncheck、goBack、goForward、reload
   */
  public async interact(
    sessionId: string,
    action: 'click' | 'fill' | 'press' | 'hover' | 'select' | 'check' | 'uncheck' | 'goBack' | 'goForward' | 'reload',
    params: { selector?: string; text?: string; key?: string; value?: string; x?: number; y?: number }
  ): Promise<{ success: boolean; message: string }> {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`浏览器会话 ${sessionId} 不存在`);
    }

    try {
      switch (action) {
        case 'click':
          if (!params.selector) throw new Error('click 操作需要 selector 参数');
          await session.page.click(params.selector, { timeout: 30000 });
          return { success: true, message: `已点击元素: ${params.selector}` };

        case 'fill':
          if (!params.selector || !params.text) throw new Error('fill 操作需要 selector 和 text 参数');
          await session.page.fill(params.selector, params.text);
          return { success: true, message: `已填充文本到: ${params.selector}` };

        case 'press':
          if (params.selector) {
            await session.page.press(params.selector, params.key || 'Enter');
          } else {
            await session.page.keyboard.press(params.key || 'Enter');
          }
          return { success: true, message: `已按下: ${params.key}` };

        case 'hover':
          if (!params.selector) throw new Error('hover 操作需要 selector 参数');
          await session.page.hover(params.selector);
          return { success: true, message: `已悬停在: ${params.selector}` };

        case 'select':
          if (!params.selector || !params.value) throw new Error('select 操作需要 selector 和 value 参数');
          await session.page.selectOption(params.selector, params.value);
          return { success: true, message: `已选择: ${params.value}` };

        case 'check':
          if (!params.selector) throw new Error('check 操作需要 selector 参数');
          await session.page.check(params.selector);
          return { success: true, message: `已勾选: ${params.selector}` };

        case 'uncheck':
          if (!params.selector) throw new Error('uncheck 操作需要 selector 参数');
          await session.page.uncheck(params.selector);
          return { success: true, message: `已取消勾选: ${params.selector}` };

        case 'goBack':
          await session.page.goBack();
          return { success: true, message: '已返回上一页' };

        case 'goForward':
          await session.page.goForward();
          return { success: true, message: '已前进到下一页' };

        case 'reload':
          await session.page.reload();
          return { success: true, message: '已重新加载页面' };

        default:
          throw new Error(`不支持的操作: ${action}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      throw new Error(`交互操作失败: ${message}`);
    }
  }

  /**
   * 关闭指定会话
   * 如果关闭后没有更多会话，同时关闭浏览器
   */
  public async closeSession(sessionId: string = 'default'): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    try {
      await session.page.close();
      await session.context.close();
    } catch {
      // 忽略关闭错误
    }

    this.sessions.delete(sessionId);

    // 如果没有更多会话，关闭浏览器
    if (this.sessions.size === 0 && this.mainBrowser) {
      try {
        await this.mainBrowser.close();
        this.mainBrowser = null;
      } catch {
        // 忽略关闭错误
      }
    }

    return true;
  }

  // 关闭所有会话
  public async closeAllSessions(): Promise<void> {
    const sessionIds = Array.from(this.sessions.keys());
    for (const id of sessionIds) {
      await this.closeSession(id);
    }
  }

  // 列出所有会话信息
  public listSessions(): Array<{ id: string; url: string; title: string; createdAt: Date }> {
    return Array.from(this.sessions.values()).map(s => ({
      id: s.id,
      url: s.url,
      title: s.title,
      createdAt: s.createdAt
    }));
  }
}

// 导出单例实例
export const browserManager = BrowserManager.getInstance();
