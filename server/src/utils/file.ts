import fs from 'fs/promises';
import path from 'path';

export const DATA_DIR = path.join(process.cwd(), 'desktop_data');
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
