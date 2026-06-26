import path from 'path';
import { randomUUID } from 'crypto';
import { PUBLIC_DATA_DIR, CONFIGS_DIR, readJsonFile, writeJsonFile, readDir, ensureDir, fileExists } from '../utils/file.js';

const SKILLS_DIR = path.join(PUBLIC_DATA_DIR, 'skills');
const ENABLED_SKILLS_FILE = path.join(CONFIGS_DIR, 'enabled_skills.json');

// 已启用的技能列表格式
interface EnabledSkillsConfig {
  skills: Array<{ id: string; dir: string }>;
}

// skill.json 格式
export interface SkillMeta {
  id: string;
  name: string;
  description: string;
  version: string;
  entry: string;           // 入口文档（如 roadmap.md）
}

// 技能完整信息（含文件列表）
export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  version: string;
  entry: string;
  files: string[];         // 所有文件的相对路径
  scripts: string[];       // scripts/ 下的可执行脚本名
}

class SkillService {
  private skillsCache: Map<string, SkillMeta> | null = null;
  private filesCache: Map<string, string[]> | null = null;

  clearCache(): void {
    this.skillsCache = null;
    this.filesCache = null;
  }

  // 递归列出目录下的所有文件
  private async listFilesRecursive(dir: string, relativeTo: string): Promise<string[]> {
    const files: string[] = [];
    const entries = await readDir(dir);
    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      const relPath = path.relative(relativeTo, fullPath);
      try {
        const fs = await import('fs/promises');
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory()) {
          const subFiles = await this.listFilesRecursive(fullPath, relativeTo);
          files.push(...subFiles);
        } else {
          files.push(relPath);
        }
      } catch {
        // skip
      }
    }
    return files;
  }

  async loadAllSkills(): Promise<Map<string, SkillMeta>> {
    if (this.skillsCache) return this.skillsCache;
    await ensureDir(SKILLS_DIR);
    const entries = await readDir(SKILLS_DIR);
    const skills = new Map<string, SkillMeta>();

    for (const entry of entries) {
      const skillDir = path.join(SKILLS_DIR, entry);
      // 只加载启用列表中的技能目录
      const enabledConfig = await this.getEnabledConfig();
      const isEnabled = enabledConfig.skills.some(s => s.dir === entry);
      if (!isEnabled) continue;

      const meta = await readJsonFile<SkillMeta>(path.join(skillDir, 'skill.json'));
      if (meta && meta.id) {
        skills.set(meta.id, meta);
      }
    }

    this.skillsCache = skills;
    return skills;
  }

  async getSkills(): Promise<SkillInfo[]> {
    const all = await this.loadAllSkills();
    const result: SkillInfo[] = [];

    for (const [id, meta] of all) {
      const skillDir = path.join(SKILLS_DIR, id);
      const allFiles = await this.listFilesRecursive(skillDir, skillDir);
      const scriptsDir = path.join(skillDir, 'scripts');
      const hasScriptsDir = await fileExists(scriptsDir);
      const scripts = hasScriptsDir
        ? (await readDir(scriptsDir)).filter(f => !f.startsWith('.'))
        : [];

      result.push({
        id,
        name: meta.name,
        description: meta.description,
        version: meta.version,
        entry: meta.entry,
        files: allFiles,
        scripts,
      });
    }

    return result;
  }

  // 获取所有技能目录（不论启用状态，供设置页面展示）
  async getAllSkillsRaw(): Promise<SkillInfo[]> {
    const allEntries = await readDir(SKILLS_DIR);
    const result: SkillInfo[] = [];
    for (const entry of allEntries) {
      const skillDir = path.join(SKILLS_DIR, entry);
      const meta = await readJsonFile<SkillMeta>(path.join(skillDir, 'skill.json'));
      if (!meta || !meta.id) continue;
      const allFiles = await this.listFilesRecursive(skillDir, skillDir);
      const scriptsDir = path.join(skillDir, 'scripts');
      const hasScriptsDir = await fileExists(scriptsDir);
      const scripts = hasScriptsDir
        ? (await readDir(scriptsDir)).filter((f: string) => !f.startsWith('.'))
        : [];
      result.push({
        id: meta.id,
        name: meta.name,
        description: meta.description,
        version: meta.version,
        entry: meta.entry,
        files: allFiles,
        scripts,
      });
    }
    return result;
  }

  // 读取已启用技能配置
  async getEnabledConfig(): Promise<EnabledSkillsConfig> {
    const config = await readJsonFile<EnabledSkillsConfig>(ENABLED_SKILLS_FILE);
    return config || { skills: [] };
  }

  // 保存已启用技能配置
  async saveEnabledConfig(config: EnabledSkillsConfig): Promise<void> {
    await ensureDir(CONFIGS_DIR);
    await writeJsonFile(ENABLED_SKILLS_FILE, config);
    this.clearCache(); // 清空缓存，下次重新加载
  }

  // 设置某个技能是否启用
  async setSkillEnabled(dir: string, enabled: boolean): Promise<EnabledSkillsConfig> {
    const config = await this.getEnabledConfig();
    const exists = config.skills.find(s => s.dir === dir);
    if (enabled) {
      if (!exists) {
        config.skills.push({ id: '', dir });
      }
    } else {
      config.skills = config.skills.filter(s => s.dir !== dir);
    }
    await this.saveEnabledConfig(config);
    return config;
  }

  // 获取已启用的技能列表（含完整信息）
  async getEnabledSkills(): Promise<{ enabled: Array<{ id: string; dir: string }>; skills: SkillInfo[] }> {
    const enabledConfig = await this.getEnabledConfig();
    const allRaw = await this.getAllSkillsRaw();
    // 只返回已启用的技能
    const enabledSkills = allRaw.filter(s => enabledConfig.skills.some(e => e.dir === s.id));
    // 补全 id
    const enabledList = enabledConfig.skills.map(e => {
      const found = allRaw.find(s => s.id === e.dir);
      return { id: found?.id || e.id, dir: e.dir };
    });
    return { enabled: enabledList, skills: enabledSkills };
  }

  async getSkill(skillId: string): Promise<SkillMeta | null> {
    const all = await this.loadAllSkills();
    return all.get(skillId) || null;
  }

  // 读取技能入口文档（roadmap.md）内容
  async getSkillEntry(skillId: string): Promise<string | null> {
    const skill = await this.getSkill(skillId);
    if (!skill) return null;
    const entryPath = path.join(SKILLS_DIR, skillId, skill.entry);
    try {
      const fs = await import('fs/promises');
      return await fs.readFile(entryPath, 'utf-8');
    } catch {
      return null;
    }
  }

  // 读取技能中的任意文件
  async readSkillFile(skillId: string, filePath: string): Promise<string | null> {
    const fullPath = path.join(SKILLS_DIR, skillId, filePath);
    // 安全检查：不能穿越到技能目录外
    if (path.relative(path.join(SKILLS_DIR, skillId), fullPath).startsWith('..')) {
      throw new Error('Path traversal denied');
    }
    try {
      const fs = await import('fs/promises');
      return await fs.readFile(fullPath, 'utf-8');
    } catch {
      return null;
    }
  }

  // 列出技能目录下的所有文件
  async listSkillFiles(skillId: string): Promise<string[]> {
    const skillDir = path.join(SKILLS_DIR, skillId);
    return this.listFilesRecursive(skillDir, skillDir);
  }

  // 执行技能 scripts/ 下的脚本
  async execSkillScript(skillId: string, scriptName: string, args: string[], cwd?: string): Promise<string> {
    const scriptPath = path.join(SKILLS_DIR, skillId, 'scripts', scriptName);
    // 安全检查：不能穿越到技能目录外
    if (path.relative(path.join(SKILLS_DIR, skillId), scriptPath).startsWith('..')) {
      throw new Error('Path traversal denied');
    }
    try {
      const fs = await import('fs/promises');
      await fs.access(scriptPath, fs.constants.X_OK);
    } catch {
      // 如果没有执行权限，尝试用 bash 执行
      try {
        const { execSync } = await import('child_process');
        const output = execSync(`bash '${scriptPath.replace(/'/g, "'\\''")}' ${args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ')}`, {
          encoding: 'utf-8',
          maxBuffer: 10 * 1024 * 1024,
          cwd: cwd || path.join(SKILLS_DIR, skillId),
        });
        return output.trim();
      } catch (err: any) {
        throw new Error(`Script execution failed: ${err.message}`);
      }
    }

    const { execSync } = await import('child_process');
    const output = execSync(`'${scriptPath.replace(/'/g, "'\\''")}' ${args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ')}`, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      cwd: cwd || path.join(SKILLS_DIR, skillId),
    });
    return output.trim();
  }

  // 列举技能可用的脚本
  async listSkillScripts(skillId: string): Promise<string[]> {
    const scriptsDir = path.join(SKILLS_DIR, skillId, 'scripts');
    if (!(await fileExists(scriptsDir))) return [];
    const entries = await readDir(scriptsDir);
    return entries.filter(f => !f.startsWith('.'));
  }

  // 创建技能（从 skill-maker 调用）
  async createSkill(params: {
    id?: string;
    name: string;
    description: string;
    roadmapMd: string;
    detailFiles?: Record<string, string>;  // 文件名 -> 内容
    scripts?: Record<string, string>;       // 脚本名 -> 内容
  }): Promise<{ id: string; files: string[] }> {
    const id = params.id || `skill-${randomUUID().slice(0, 8)}`;
    const skillDir = path.join(SKILLS_DIR, id);
    await ensureDir(skillDir);
    await ensureDir(path.join(skillDir, 'details'));
    await ensureDir(path.join(skillDir, 'scripts'));

    // 写入 skill.json
    const meta: SkillMeta = {
      id,
      name: params.name,
      description: params.description,
      version: '1.0.0',
      entry: 'roadmap.md',
    };
    await writeJsonFile(path.join(skillDir, 'skill.json'), meta);

    // 写入 roadmap.md
    const fs = await import('fs/promises');
    await fs.writeFile(path.join(skillDir, 'roadmap.md'), params.roadmapMd, 'utf-8');

    // 写入 details/ 文件
    if (params.detailFiles) {
      for (const [fileName, content] of Object.entries(params.detailFiles)) {
        const detailDir = path.dirname(path.join(skillDir, 'details', fileName));
        await ensureDir(detailDir);
        await fs.writeFile(path.join(skillDir, 'details', fileName), content, 'utf-8');
      }
    }

    // 写入 scripts/
    if (params.scripts) {
      for (const [scriptName, content] of Object.entries(params.scripts)) {
        const scriptPath = path.join(skillDir, 'scripts', scriptName);
        await fs.writeFile(scriptPath, content, 'utf-8');
        // 赋予执行权限
        try {
          await fs.chmod(scriptPath, 0o755);
        } catch {}
      }
    }

    this.clearCache();
    const createdFiles = await this.listSkillFiles(id);
    return { id, files: createdFiles };
  }

  // 获取应用授权的技能列表
  async getEnabledSkillsForApp(appSkillIds: string[]): Promise<SkillMeta[]> {
    if (!appSkillIds || appSkillIds.length === 0) return [];
    const all = await this.loadAllSkills();
    return appSkillIds
      .map(id => all.get(id))
      .filter((s): s is SkillMeta => s !== undefined);
  }
}

export const skillService = new SkillService();
