import fs from 'fs/promises';
import path from 'path';

// 数据目录：默认 process.cwd()/desktop_data，可通过 --data 参数或 DATA_DIR 环境变量覆盖
// --data 指向 desktop_data 所在目录（即父目录）
export function getDataDir(): string {
  const idx = process.argv.findIndex(a => a === '--data');
  const base = idx !== -1 && process.argv[idx + 1] ? path.resolve(process.argv[idx + 1])
    : process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR)
    : process.cwd();
  return path.join(base, 'desktop_data');
}

// 系统应用目录：始终跟随程序位置
export function getSystemAppsDir(bundleDir: string): string {
  return path.join(bundleDir, 'apps', 'system');
}

export const DATA_DIR = getDataDir();
export const APPS_DIR = path.join(DATA_DIR, 'apps');
export const SYSTEM_APPS_DIR = path.join(APPS_DIR, 'system');
export const USER_APPS_DIR = path.join(APPS_DIR, 'user');
export const MARKETPLACE_APPS_DIR = path.join(APPS_DIR, 'marketplace');
export const APPS_DATA_DIR = path.join(DATA_DIR, 'apps_data');
export const PUBLIC_DATA_DIR = path.join(DATA_DIR, 'public_data');
export const CONFIGS_DIR = path.join(DATA_DIR, 'configs');

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
