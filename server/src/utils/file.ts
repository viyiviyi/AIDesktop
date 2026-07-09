import fs from 'fs/promises';
import path from 'path';

// ── 基础目录 ──
// BASE_DIR: 通过 --data 参数或 DATA_DIR 环境变量指定，默认 process.cwd()
// DATA_DIR: 始终为 BASE_DIR/desktop_data（所有数据的根目录）
function resolveBaseDir(): string {
  const idx = process.argv.findIndex(a => a === '--data');
  if (idx !== -1 && process.argv[idx + 1]) return path.resolve(process.argv[idx + 1]);
  if (process.env.DATA_DIR) return path.resolve(process.env.DATA_DIR);
  return process.cwd();
}

export const BASE_DIR = resolveBaseDir();
export const DATA_DIR = path.join(BASE_DIR, 'desktop_data');

// ── 数据子目录（全部基于 DATA_DIR，启动时静态定义） ──
export const APPS_DIR = path.join(DATA_DIR, 'apps');
export const USER_APPS_DIR = path.join(APPS_DIR, 'user');
export const MARKETPLACE_APPS_DIR = path.join(APPS_DIR, 'marketplace');
export const APPS_DATA_DIR = path.join(DATA_DIR, 'apps_data');
export const WORKSPACES_DIR = path.join(DATA_DIR, 'workspaces');
export const PUBLIC_DATA_DIR = path.join(DATA_DIR, 'public_data');
export const CONFIGS_DIR = path.join(DATA_DIR, 'configs');

// ── 工具函数 ──
export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

export async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readDir(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

export async function isDirectory(dir: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dir);
    return stat.isDirectory();
  } catch {
    return false;
  }
}
