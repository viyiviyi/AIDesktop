import type { Page, BrowserContext, Browser } from 'playwright';

export interface BrowserSession {
  id: string;
  page: Page;
  context: BrowserContext;
  browser: Browser;
  createdAt: Date;
  lastUsed: Date;
  url: string;
  title: string;
  // 存储的页面内容，用于上下文
  storedContent?: {
    type: 'dom' | 'accessibility' | 'screenshot';
    content: string;
    timestamp: Date;
  };
}

export interface BrowserConfig {
  headless: boolean;
  viewport: { width: number; height: number };
  userAgent: string;
}

export const DEFAULT_CONFIG: BrowserConfig = {
  headless: false,
  viewport: { width: 1920, height: 1080 },
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};
