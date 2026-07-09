import { useState, useEffect } from 'react';
import { useDesktop } from '../contexts/DesktopContext';
import type { App, AppInfo, ModelProvider, ModelConfig, ContentType } from '../types';
import * as api from '../services/api';
import { AppModelConfig } from './AppModelConfig';
import { MediaSelector } from './MediaSelector';
import { MemoryPanel } from './MemoryPanel';
import { AppIcon } from './AppIcon';

type SettingsTab = 'basic' | 'model' | 'tools' | 'skills' | 'visibility' | 'prompt' | 'memory';

interface AppSettingsWindowProps {
  appId: string;
}

const CONTENT_TYPES: { value: ContentType; label: string }[] = [
  { value: 'text', label: '文本' },
  { value: 'image', label: '图片' },
  { value: 'audio', label: '音频' },
  { value: 'video', label: '视频' },
  { value: 'file', label: '文件' },
];

export function AppSettingsWindow({ appId }: AppSettingsWindowProps) {
  const { closeWindow, state, refreshApp } = useDesktop();
  const [app, setApp] = useState<App | null>(null);
  const [providers, setProviders] = useState<ModelProvider[]>([]);
  const [installedApps, setInstalledApps] = useState<AppInfo[]>([]);
  const [availableTools, setAvailableTools] = useState<any[]>([]);
  // 技能列表
  const [allSkills, setAllSkills] = useState<Array<{ id: string; name: string; description: string }>>([]);
  // 已连接的外部 MCP 服务器信息，用于在工具列表中显示 "mcp.external"
  const [mcpExternals, setMcpExternals] = useState<Array<{
    connectionId: string;
    serverInfo: { name: string; version: string } | null;
    isConnected: boolean;
    isInitialized: boolean;
    tools: Array<{ name: string; description: string; inputSchema: object }>;
    resources: Array<{ uri: string; name: string; description?: string; mimeType?: string }>;
  }>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<SettingsTab>('basic');
  const [isSaving, setIsSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  // 外部 MCP 展开状态
  const [expandedMcpConns, setExpandedMcpConns] = useState<Record<string, boolean>>({});
  // 描述文本展开状态：{ 服务名: true/false }
  // showToolDescs/setShowToolDescs 暂未使用

  // Form state
  const [formData, setFormData] = useState({
    enabled: true,
    icon: '',
    backgroundImage: '',
    supportedInputs: ['text'] as ContentType[],
    inputDescription: '',
    outputDescription: '',
    visibleApps: [] as string[],
    visibleServices: [] as string[],
    tools: [] as string[],
    skills: [] as string[],
    appMd: '',
    headerParams: [] as { key: string; value: string; enabled: boolean }[],
    bodyParams: [] as { key: string; value: string; enabled: boolean }[],
  });

  // 内置工具的展开状态：按服务名展开方法列表，再按方法名展开参数 schema
  const [expandedServices, setExpandedServices] = useState<Record<string, boolean>>({});
  const [expandedMethods, setExpandedMethods] = useState<Record<string, boolean>>({});

  const windowState = state.windows.find(w =>
    w.appId === 'app-settings:' + appId
  );

  useEffect(() => {
    loadData();
  }, [appId]);

  async function loadData() {
    setIsLoading(true);
    try {
      const [fullApp, modesData, appsData, servicesRes, mcpConnectionsRes, mcpSettingsRes, skillsData] = await Promise.all([
        api.getApp(appId),
        api.getModes(),
        api.getApps(),
        api.getMcpServices ? api.getMcpServices() : fetch('/api/mcp/services').then(r => r.json()).catch(() => ({ services: [] })),
        api.getMcpConnections().catch(() => []),
        api.getMcpSettings().catch(() => ({ connections: [] })),
        api.getAllSkills().catch(() => []),
      ]);

      setApp(fullApp);
      setProviders(modesData.providers);
      setInstalledApps(appsData as any);
      setAvailableTools((servicesRes as any)?.services || []);
      setAllSkills(skillsData || []);

      // 处理已连接的外部 MCP
      const connectedList = (mcpConnectionsRes as any[] || []).filter((c: any) => c.isConnected);
      setMcpExternals(connectedList.map((c: any) => ({
        connectionId: c.connectionId,
        serverInfo: c.serverInfo || null,
        isConnected: c.isConnected,
        isInitialized: c.isInitialized || false,
        tools: c.tools || [],
        resources: c.resources || [],
      })));

      setFormData({
        enabled: fullApp.enabled !== false,
        icon: fullApp.icon || '',
        backgroundImage: fullApp.backgroundImage || '',
        supportedInputs: fullApp.supportedInputs || ['text'],
        inputDescription: fullApp.inputDescription || '',
        outputDescription: fullApp.outputDescription || '',
        visibleApps: fullApp.visibleApps || [],
        visibleServices: fullApp.visibleServices || [],
        tools: fullApp.tools || [],
        skills: fullApp.skills || [],
        appMd: fullApp.appMd || '',
        headerParams: (fullApp as any).paramOverrides?.headerParams || [],
        bodyParams: (fullApp as any).paramOverrides?.bodyParams || [],
      });
    } catch (error) {
      console.error('Failed to load app settings:', error);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleUpdateModels(models: ModelConfig[]) {
    if (!app) return;
    try {
      await api.updateApp(app.id, { models } as any);
      setApp({ ...app, models });
      showSaveMsg('模型已更新');
    } catch (error) {
      showSaveMsg('模型更新失败', true);
    }
  }

  async function handleSaveAll() {
    if (!app) return;
    setIsSaving(true);
    try {
      const updates: Record<string, unknown> = {
        enabled: formData.enabled,
        icon: formData.icon,
        backgroundImage: formData.backgroundImage,
        supportedInputs: formData.supportedInputs,
        inputDescription: formData.inputDescription,
        outputDescription: formData.outputDescription,
        visibleApps: formData.visibleApps,
        visibleServices: formData.visibleServices,
        tools: formData.tools,
        skills: formData.skills,
        appMd: formData.appMd,
        // headerParams/bodyParams 存为 paramOverrides（只存 key + enabled，不从 provider 复制 value）
        paramOverrides: {
          headerParams: formData.headerParams.map(p => ({ key: p.key, enabled: p.enabled })),
          bodyParams: formData.bodyParams.map(p => ({ key: p.key, enabled: p.enabled })),
        },
      };

      await api.updateApp(app.id, updates as any);
      setApp({ ...app, ...updates } as App);
      await refreshApp(appId);
      showSaveMsg('设置已保存');
    } catch (error) {
      showSaveMsg('保存失败', true);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSaveAppMd() {
    if (!app) return;
    setIsSaving(true);
    try {
      await api.updateApp(app.id, { appMd: formData.appMd } as any);
      setApp({ ...app, appMd: formData.appMd } as App);
      await refreshApp(appId);
      showSaveMsg('提示已保存');
    } catch (error) {
      showSaveMsg('保存失败', true);
    } finally {
      setIsSaving(false);
    }
  }

  function showSaveMsg(msg: string, _isError = false) {
    setSaveMsg(msg);
    setTimeout(() => setSaveMsg(''), 3000);
  }

  function handleClose() {
    if (windowState) closeWindow(windowState.id);
  }

  function toggleContentType(type: ContentType) {
    setFormData(prev => ({
      ...prev,
      supportedInputs: prev.supportedInputs.includes(type)
        ? prev.supportedInputs.filter(t => t !== type)
        : [...prev.supportedInputs, type],
    }));
  }

  function toggleVisibleApp(id: string) {
    setFormData(prev => ({
      ...prev,
      visibleApps: prev.visibleApps.includes(id)
        ? prev.visibleApps.filter(v => v !== id)
        : [...prev.visibleApps, id],
    }));
  }

  function toggleVisibleService(id: string) {
    setFormData(prev => ({
      ...prev,
      visibleServices: prev.visibleServices.includes(id)
        ? prev.visibleServices.filter(s => s !== id)
        : [...prev.visibleServices, id],
    }));
  }

  function toggleTool(name: string) {
    setFormData(prev => ({
      ...prev,
      tools: prev.tools.includes(name)
        ? prev.tools.filter(t => t !== name)
        : [...prev.tools, name],
    }));
  }

  function toggleSkill(skillId: string) {
    setFormData(prev => ({
      ...prev,
      skills: prev.skills.includes(skillId)
        ? prev.skills.filter(s => s !== skillId)
        : [...prev.skills, skillId],
    }));
  }

  if (isLoading && !app) {
    return (
      <div className="app-settings-window-loading">
        <div className="loading-spinner">加载中...</div>
      </div>
    );
  }

  if (!app) {
    return (
      <div className="app-settings-window-error">
        <div>应用加载失败</div>
        <button className="btn-secondary" onClick={handleClose}>关闭</button>
      </div>
    );
  }

  const isUserApp = app.source === 'user';
  // 系统应用基本信息只读，但工具/可见性/模型可选
  const canModifyAll = true;

  const renderBasic = () => (
    <div className="app-settings-section">
      <h4>基本信息</h4>
      <div className="app-settings-field">
        <label>名称</label>
        <input type="text" value={app.name} disabled />
      </div>
      <div className="app-settings-field">
        <label>描述</label>
        <textarea value={app.description} disabled rows={3} />
      </div>
      <div className="app-settings-field">
        <label>类型</label>
        <input type="text" value={app.type === 'desktop' ? '桌面应用' : '后台服务'} disabled />
      </div>
      <div className="app-settings-field">
        <label>来源</label>
        <input type="text" value={app.source === 'system' ? '系统' : app.source === 'user' ? '用户' : '市场'} disabled />
      </div>
      <div className="app-settings-field">
        <label>启用状态</label>
        <label className="app-settings-checkbox">
          <input
            type="checkbox"
            checked={formData.enabled}
            onChange={(e) => setFormData(prev => ({ ...prev, enabled: e.target.checked }))}
          />
          已启用
        </label>
      </div>
      {canModifyAll && (
        <div className="app-settings-field">
          <MediaSelector
            appId={appId}
            type="icon"
            currentUrl={formData.icon}
            onSelect={(url) => setFormData(prev => ({ ...prev, icon: url }))}
          />
        </div>
      )}
      {canModifyAll && (
        <div className="app-settings-field">
          <MediaSelector
            appId={appId}
            type="background"
            currentUrl={formData.backgroundImage}
            onSelect={(url) => setFormData(prev => ({ ...prev, backgroundImage: url }))}
          />
        </div>
      )}
    </div>
  );

  const renderTools = () => {
    const allServices = availableTools.length > 0 ? availableTools : [];

    // 按分类分组
    const adminServices = allServices.filter((s: any) => s.category === 'admin');
    const featureServices = allServices.filter((s: any) => s.category === 'feature');
    const builtinServices = allServices.filter((s: any) => s.category === 'builtin');
    const workspaceServices = allServices.filter((s: any) => s.category === 'workspace');
    const fallbackServices = allServices.length === 0 ? [
      { name: 'mcp.filesystem', description: '系统维护 - 文件系统', category: 'admin' },
      { name: 'mcp.settings', description: '系统维护 - 设置', category: 'admin' },
      { name: 'mcp.sleep', description: '通用 - 等待', category: 'builtin' },
      { name: 'mcp.exec', description: '通用 - 执行命令', category: 'builtin' },
      { name: 'mcp.http', description: '通用 - HTTP 请求', category: 'builtin' },
      { name: 'mcp.browser', description: '通用 - 浏览器控制', category: 'builtin' },
      { name: 'mcp.form', description: '功能 - 表单交互', category: 'feature' },
      { name: 'mcp.memory', description: '功能 - 记忆', category: 'feature' },
    ] : [];

    const adminList = adminServices.length > 0 ? adminServices : fallbackServices.filter(s => s.category === 'admin');
    const builtinList = builtinServices.length > 0 ? builtinServices : fallbackServices.filter(s => s.category === 'builtin');
    const featureList = featureServices.length > 0 ? featureServices : fallbackServices.filter(s => s.category === 'feature');
    const workspaceList = workspaceServices.length > 0 ? workspaceServices : [];

    // 内置服务：checkbox + 展开列表，再点展开方法参数 def
    const renderServiceItem = (s: any) => {
      const methods = s.methods || [];
      const isExpanded = expandedServices[s.name] ?? false;

      return (
        <div key={s.name} style={{ marginBottom: 8, border: '1px solid var(--border-primary)', borderRadius: 6, overflow: 'hidden' }}>
          {/* 服务名行 */}
          <div
            onClick={() => setExpandedServices(prev => ({ ...prev, [s.name]: !isExpanded }))}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
              cursor: 'pointer', userSelect: 'none', fontSize: 13,
              background: 'var(--bg-secondary)',
            }}
          >
            <input
              type="checkbox"
              checked={formData.tools.includes(s.name)}
              onChange={(e) => { e.stopPropagation(); canModifyAll && toggleTool(s.name); }}
              disabled={!canModifyAll}
              style={{ width: 16, height: 16, cursor: 'pointer', flexShrink: 0 }}
              // 动态工具不显示 checkbox
              {...(s.category === 'dynamic' ? { type: 'hidden' as any, style: { display: 'none' } } : {})}
            />
            <span style={{ fontSize: 11, color: 'var(--text-secondary)', width: 14, textAlign: 'center' }}>
              {isExpanded ? '▼' : '▶'}
            </span>
            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{s.name}</span>
            <span style={{ flex: 1, textAlign: 'right', color: 'var(--text-secondary)', fontSize: 12 }}>
              {s.description || ''}
            </span>
          </div>

          {/* 方法列表 */}
          {isExpanded && (
            <div style={{ padding: '6px 12px 8px 42px', background: 'var(--bg-primary)' }}>
              {methods.length === 0 && (
                <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>无方法</span>
              )}
              {methods.map((method: string) => {
                const methodKey = `${s.name}:${method}`;
                const isMethodExpanded = expandedMethods[methodKey] ?? false;
                return (
                  <div key={method} style={{ marginBottom: 4 }}>
                    <div
                      onClick={() => setExpandedMethods(prev => ({ ...prev, [methodKey]: !isMethodExpanded }))}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px',
                        cursor: 'pointer', userSelect: 'none', borderRadius: 4, fontSize: 13,
                      }}
                    >
                      <span style={{ fontSize: 10, color: 'var(--text-tertiary)', width: 12, textAlign: 'center' }}>
                        {isMethodExpanded ? '▼' : '▶'}
                      </span>
                      <code style={{ fontSize: 13, color: 'var(--accent-color)' }}>{method}</code>
                    </div>
                    {/* 方法参数 schema（第二级展开） */}
                    {isMethodExpanded && (
                      <div style={{
                        padding: '10px 12px', margin: '4px 0 4px 16px',
                        background: 'var(--bg-tertiary)', borderRadius: 4,
                        fontSize: 13, color: 'var(--text-secondary)',
                        fontFamily: 'monospace', whiteSpace: 'pre-wrap', lineHeight: 1.6,
                        maxHeight: 220, overflowY: 'auto',
                      }}>
                        {renderMethodParams(s, method)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    };

    // 渲染方法参数 def（根据服务名和方法名生成对应参数描述）
    function renderMethodParams(service: any, method: string): string {
      // 从内置的 schema 映射生成参数说明
      const paramHints: Record<string, Record<string, string>> = {
        'mcp.form': {
          requestInput: 'title: 表单标题 (字符串)\ndescription: 表单描述 (字符串)\nfields: 表单项数组，每项包含 name(字段名), label(标签), type(类型: text/textarea/number/tags/radio/checkbox), required(是否必填), options(选项列表)',
        },
        'mcp.filesystem': {
          read: 'path: 文件路径 (相对 apps_data 目录)\noffset: 起始行号 (数字，1-indexed)\nlimit: 最大读取行数 (数字)\nbaseDir: 基础目录 (字符串)',
          write: 'path: 文件路径\ncontent: 写入内容 (字符串)\nbaseDir: 基础目录 (字符串)',
          patch: 'path: 文件路径\nold_string: 要替换的旧文本\nnew_string: 替换的新文本\nreplace_all: 是否替换所有 (布尔)\nbaseDir: 基础目录 (字符串)',
          search: 'pattern: 正则表达式 (字符串)\nfile_glob: 文件过滤 glob (字符串)\nmax_results: 最大结果数 (数字)\nbaseDir: 基础目录 (字符串，必填)',
          list: 'path: 目录路径 (字符串)\nbaseDir: 基础目录 (字符串)',
          mkdir: 'path: 目录路径 (字符串)',
          delete: 'path: 文件/目录路径 (字符串)',
          move: 'source: 源文件路径 (字符串)\ndest: 目标文件路径 (字符串)',
          copy: 'source: 源文件路径 (字符串)\ndest: 目标文件路径 (字符串)',
        },
        'mcp.settings': {
          get: '无参数 — 返回系统设置',
          update: '…settings: 要更新的设置字段',
          getApps: '无参数 — 返回所有应用列表',
          getAppSettings: 'appId: 应用 ID (字符串，必填)',
          setAppSettings: 'appId: 应用 ID (字符串，必填)\nenabled: 启用状态 (布尔)\ntools: 工具列表 (数组)\nvisibleApps: 可见应用列表 (数组)\nvisibleServices: 可见服务列表 (数组)\nmodels: 模型配置 (数组)',
          getSkillsList: '无参数 — 返回所有可用技能列表',
        },
        'mcp.memory': {
          remember: 'scope: "app"|"conversation"\nkey: 记忆键名 (字符串)\nvalue: 记忆值 (字符串)\nimportance: "low"|"normal"|"high"\ntags: 标签数组',
          recall: 'key: 键名 (字符串)\nkeyPrefix: 键名前缀 (字符串)\ntype: 记忆类型\nsearch: 搜索文本\nlimit: 最大条数',
          recallByPrefix: 'keyPrefix: 键名前缀 (字符串)',
          forget: 'id: 记忆条目 ID\n 或 tag: 标签值',
          setGoal: 'level: 1|2|3\nvalue: 目标描述 (字符串)',
          completeGoal: 'level: 1|2|3',
          getActiveGoals: '无参数',
          getArchivedGoals: '无参数',
          list: '无参数',
          listTags: '无参数',
          stats: '无参数',
        },
        'mcp.browser': {
          navigate: 'url: 页面 URL (字符串，必填)',
          snapshot: 'full: 是否完整快照 (布尔)',
          click: 'ref: 元素引用 ID (字符串)',
          type: 'ref: 元素引用 ID (字符串)\ntext: 要输入的文字 (字符串)',
          scroll: 'direction: "up"|"down" (字符串)',
          back: '无参数 — 返回上一页',
          vision: 'question: 视觉问题 (字符串)\nannotate: 是否标注元素 (布尔)',
          console: 'clear: 是否清空 (布尔)\nexpression: JS 表达式 (字符串)',
          press: 'key: 按键名 (字符串)',
        },
        'mcp.exec': {
          exec: 'command: shell 命令 (字符串，必填)\ntimeout: 超时毫秒数 (数字，默认 30000)\ncwd: 工作目录 (字符串)',
        },
        'mcp.sleep': {
          sleep: 'seconds: 等待秒数 (数字，最长 600)',
        },
        'mcp.http': {
          request: 'url: 请求 URL (字符串，必填)\nmethod: HTTP 方法 (字符串)\nheaders: 请求头 (对象)\nbody: 请求体 (字符串)\ntimeout: 超时毫秒数 (数字)',
        },
        'workspace.code': {
          read: 'path: 文件路径 (相对工作目录或绝对路径)\noffset: 起始行号 (数字)\nlimit: 最大读取行数 (数字)',
          write: 'path: 文件路径\ncontent: 写入内容 (字符串)',
          patch: 'path: 文件路径\nold_string: 要替换的旧文本\nnew_string: 替换的新文本\nreplace_all: 是否替换所有 (布尔)',
          search: 'pattern: 正则表达式 (字符串，必填)\nfile_glob: 文件过滤 glob\nmax_results: 最大结果数 (数字)\nbaseDir: 基础目录 (字符串，必填)',
          list: 'path: 目录路径 (字符串)\nbaseDir: 基础目录 (字符串)',
          move: 'source: 源文件路径 (字符串)\ndest: 目标文件路径 (字符串)',
          copy: 'source: 源文件路径 (字符串)\ndest: 目标文件路径 (字符串)',
        },
        'workspace.shell': {
          exec: 'command: shell 命令 (字符串，必填)\ntimeout: 超时毫秒数 (数字，默认 30000)\ncwd: 工作目录 (字符串，默认使用会话工作目录)\n每次执行需要用户授权',
        },
      };
      return paramHints[service.name]?.[method] || '(无详细参数定义)';
    }

    // 内置动态工具：分组展示，和服务一样
    const dynamicSkillService = { name: 'mcp.skill', description: '技能服务 — 列出可用的技能、读取技能文件、执行技能脚本', category: 'dynamic', methods: ['list', 'read', 'exec'], condition: '应用配置有技能时自动注入' };
    const dynamicAppService = { name: 'mcp.app', description: '应用访问 — 列出可调用的应用、调用应用完成任务', category: 'dynamic', methods: ['list', 'call'], condition: '应用配置有可见应用时自动注入' };

    return (
      <div className="app-settings-section">
        <h4>系统维护工具</h4>
        <p className="app-settings-hint">文件系统和系统设置管理。需要勾选才能使用。</p>
        <div className="app-settings-checklist" style={{ marginBottom: 16 }}>
          {adminList.map(renderServiceItem)}
        </div>

        <h4>功能工具</h4>
        <p className="app-settings-hint">记忆和表单功能。启用对应工具后功能生效，并在应用对话界面显示相关内容。</p>
        <div className="app-settings-checklist" style={{ marginBottom: 16 }}>
          {featureList.map(renderServiceItem)}
        </div>

        <h4>系统通用工具</h4>
        <p className="app-settings-hint">浏览器、命令行、等待、HTTP 等通用辅助工具。需要勾选才能使用。</p>
        <div className="app-settings-checklist" style={{ marginBottom: 16 }}>
          {builtinList.map(renderServiceItem)}
        </div>

        <h4>工作区工具</h4>
        <p className="app-settings-hint">在工作目录下操作文件和执行命令，需要先设置工作目录，操作受权限控制。</p>
        <div className="app-settings-checklist">
          {workspaceList.map(renderServiceItem)}
        </div>

        <h4>内置动态工具</h4>
        <p className="app-settings-hint">当满足对应条件时系统会自动注入到 AI 的工具上下文。</p>
        <div className="app-settings-checklist" style={{ marginBottom: 16 }}>
          {renderServiceItem({ ...dynamicSkillService, description: '技能服务 — 列出可用的技能、读取技能文件、执行技能脚本。应用配置有技能时自动生效' })}
          {renderServiceItem({ ...dynamicAppService, description: '应用访问 — 列出可调用的应用、调用应用完成任务。应用配置有可见应用时自动生效' })}
        </div>

        {(mcpExternals || []).length > 0 && (
          <>
            <h4>外部 MCP 服务</h4>
             <p className="app-settings-hint">外部 MCP 服务器提供的工具，可单独勾选。未连接的服务器请先在 MCP 设置中配置。</p>
            {mcpExternals.map(conn => {
              const connName = conn.serverInfo?.name || conn.connectionId;
              const safeConnName = connName.replace(/[^a-zA-Z0-9_-]/g, '_');
              const tools = conn.tools || [];
              const checkedCount = tools.filter(t => formData.tools.includes(`external:${safeConnName}:${t.name}`)).length;
              const allChecked = checkedCount === tools.length && tools.length > 0;
              const partialChecked = checkedCount > 0 && !allChecked;
              const isExpanded = expandedMcpConns[conn.connectionId] ?? false;

              return (
                <div key={conn.connectionId} style={{
                  marginBottom: 12, padding: 0, background: 'var(--bg-secondary)',
                  borderRadius: 8, border: '1px solid var(--border-primary)', overflow: 'hidden'
                }}>
                  <div
                    onClick={() => setExpandedMcpConns(prev => ({ ...prev, [conn.connectionId]: !isExpanded }))}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
                      cursor: 'pointer', userSelect: 'none', fontSize: 13, fontWeight: 600,
                      color: 'var(--text-primary)'
                    }}
                  >
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{isExpanded ? '▼' : '▶'}</span>
                    <input
                      type="checkbox"
                      ref={el => { if (el) el.indeterminate = partialChecked; }}
                      checked={allChecked}
                      onClick={e => e.stopPropagation()}
                      onChange={() => {
                        const keys = tools.map(t => `external:${safeConnName}:${t.name}`);
                        if (allChecked) {
                          keys.forEach(k => { if (formData.tools.includes(k)) toggleTool(k); });
                        } else {
                          keys.forEach(k => { if (!formData.tools.includes(k)) toggleTool(k); });
                        }
                      }}
                      disabled={!canModifyAll}
                      style={{ width: 16, height: 16, cursor: 'pointer', flexShrink: 0 }}
                    />
                    <span style={{ flex: 1 }}>{connName}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                      {checkedCount}/{tools.length}
                    </span>
                  </div>
                  {isExpanded && (
                    <div style={{ padding: '0 12px 10px 32px' }}>
                      {tools.map(tool => {
                        const toolKey = `external:${safeConnName}:${tool.name}`;
                        return (
                          <label key={toolKey} className="app-settings-checkbox" style={{ marginBottom: 3, alignItems: 'flex-start' }}>
                            <input
                              type="checkbox"
                              checked={formData.tools.includes(toolKey)}
                              onChange={() => canModifyAll && toggleTool(toolKey)}
                              disabled={!canModifyAll}
                              style={{ marginTop: 2, flexShrink: 0 }}
                            />
                            <span style={{ flex: 1, fontSize: 13 }}>{tool.name}</span>
                            <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginLeft: 6 }}>
                              {tool.description || ''}
                            </span>
                          </label>
                        );
                      })}
                      {tools.length === 0 && (
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>无可用工具</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}

        {(mcpExternals || []).length === 0 && builtinServices.length === 0 && (
          <span className="app-settings-empty">暂无可用工具，请先在 MCP 设置中配置</span>
        )}
      </div>
    );
  };

  const renderVisibility = () => (
    <div className="app-settings-section">
      <h4>可见的 Agent</h4>
      <p className="app-settings-hint">选择该应用可以通过 mcp.agent.call 调用的其他 Agent（桌面应用和后台服务）。</p>
      <div className="app-settings-field">
        <label>桌面应用</label>
        <div className="app-settings-checklist">
          {installedApps
            .filter(a => a.id !== app.id && a.type === 'desktop')
            .map(a => (
              <label key={a.id} className="app-settings-checkbox">
                <input
                  type="checkbox"
                  checked={formData.visibleApps.includes(a.id)}
                  onChange={() => canModifyAll && toggleVisibleApp(a.id)}
                  disabled={!canModifyAll}
                />
                {a.name}
                <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginLeft: 'auto' }}>
                  {a.source === 'system' ? '系统' : '用户'}
                </span>
              </label>
            ))}
          {installedApps.filter(a => a.id !== app.id && a.type === 'desktop').length === 0 && (
            <span className="app-settings-empty">暂无其他桌面应用</span>
          )}
        </div>
      </div>
      <div className="app-settings-field">
        <label>后台服务</label>
        <div className="app-settings-checklist">
          {installedApps
            .filter(a => a.id !== app.id && a.type === 'background')
            .map(a => (
              <label key={a.id} className="app-settings-checkbox">
                <input
                  type="checkbox"
                  checked={formData.visibleServices.includes(a.id)}
                  onChange={() => canModifyAll && toggleVisibleService(a.id)}
                  disabled={!canModifyAll}
                />
                {a.name}
                <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginLeft: 'auto' }}>
                  {a.source === 'system' ? '系统' : '用户'}
                </span>
              </label>
            ))}
          {installedApps.filter(a => a.id !== app.id && a.type === 'background').length === 0 && (
            <span className="app-settings-empty">暂无后台服务</span>
          )}
        </div>
      </div>
      <div className="app-settings-field">
        <label>输入类型</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {CONTENT_TYPES.map(({ value, label }) => (
            <label key={value} className="app-settings-checkbox">
              <input
                type="checkbox"
                checked={formData.supportedInputs.includes(value)}
                onChange={() => canModifyAll && toggleContentType(value)}
                disabled={!canModifyAll}
              />
              {label}
            </label>
          ))}
        </div>
      </div>
      <div className="app-settings-field">
        <label>输入说明</label>
        <textarea
          value={formData.inputDescription}
          onChange={(e) => setFormData(prev => ({ ...prev, inputDescription: e.target.value }))}
          placeholder="描述该应用接受的输入格式..."
          rows={2}
        />
      </div>
      <div className="app-settings-field">
        <label>输出类型</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <label className="app-settings-checkbox">
            <input type="checkbox" checked={true} disabled />
            文本
          </label>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)', alignSelf: 'center' }}>（目前仅支持文本输出）</span>
        </div>
      </div>
      <div className="app-settings-field">
        <label>输出说明</label>
        <textarea
          value={formData.outputDescription}
          onChange={(e) => setFormData(prev => ({ ...prev, outputDescription: e.target.value }))}
          placeholder="描述该应用产生输出的格式..."
          rows={2}
        />
      </div>
    </div>
  );

  const renderPrompt = () => (
    <div className="app-settings-section">
      <h4>Agent 提示 (app.md)</h4>
      <p className="app-settings-hint">
        该文件定义了 Agent 的行为准则、可调用工具说明、以及和其他 Agent 协作的方式。
        系统应用的建议以只读方式参考。
      </p>
      <div className="app-settings-field">
        <textarea
          value={formData.appMd}
          onChange={(e) => setFormData(prev => ({ ...prev, appMd: e.target.value }))}
          placeholder="app.md 内容..."
          rows={15}
          style={{
            width: '100%',
            fontFamily: 'monospace',
            fontSize: 12,
            padding: 8,
            background: 'var(--input-bg)',
            border: '1px solid var(--border-primary)',
            borderRadius: 4,
            color: 'var(--text-primary)',
            resize: 'vertical',
          }}
          readOnly={false}
        />
      </div>
      {isUserApp && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn-primary" onClick={handleSaveAppMd} disabled={isSaving}>
            {isSaving ? '保存中...' : '保存 app.md'}
          </button>
          <button className="btn-secondary" onClick={async () => {
            if (!app) return;
            setIsSaving(true);
            try {
              // 发送 __reset__ 标记让服务端删除数据目录的 app.md
              await api.updateApp(app.id, { appMd: '__reset__' } as any);
              await refreshApp(appId);
              // 重新加载后 appMd 会变成安装目录的默认值
              setFormData(prev => ({ ...prev, appMd: app?.appMd || '' }));
              showSaveMsg('已还原为默认提示');
            } catch (error) {
              showSaveMsg('还原失败', true);
            } finally {
              setIsSaving(false);
            }
          }} disabled={isSaving}>
            还原默认值
          </button>
        </div>
      )}
      {!isUserApp && (
        <p className="app-settings-hint">系统应用的提示词会被保存到数据目录，不会修改原始安装文件。</p>
      )}
    </div>
  );

  return (
    <div className="app-settings-window">
      <div className="app-settings-header">
        <AppIcon icon={app.icon || ''} name={app.name} className="app-settings-icon" size={40} />
        <div style={{ flex: 1 }}>
          <span className="app-settings-title">{app.name}</span>
          <span className="app-settings-subtitle">应用设置</span>
        </div>
        {saveMsg && (
          <span style={{
            fontSize: 12,
            padding: '4px 8px',
            borderRadius: 4,
            color: saveMsg.includes('失败') ? 'var(--error-color)' : 'var(--success-color)',
            background: saveMsg.includes('失败') ? 'var(--error-bg)' : 'var(--success-bg)',
          }}>
            {saveMsg}
          </span>
        )}
      </div>

      <div className="app-settings-tabs">
        <button className={`app-settings-tab ${activeTab === 'basic' ? 'active' : ''}`} onClick={() => setActiveTab('basic')}>基本</button>
        <button className={`app-settings-tab ${activeTab === 'model' ? 'active' : ''}`} onClick={() => setActiveTab('model')}>模型</button>
        <button className={`app-settings-tab ${activeTab === 'tools' ? 'active' : ''}`} onClick={() => setActiveTab('tools')}>工具</button>
        <button className={`app-settings-tab ${activeTab === 'skills' ? 'active' : ''}`} onClick={() => setActiveTab('skills')}>技能</button>
        <button className={`app-settings-tab ${activeTab === 'visibility' ? 'active' : ''}`} onClick={() => setActiveTab('visibility')}>权限</button>
        <button className={`app-settings-tab ${activeTab === 'prompt' ? 'active' : ''}`} onClick={() => setActiveTab('prompt')}>提示</button>
        <button className={`app-settings-tab ${activeTab === 'memory' ? 'active' : ''}`} onClick={() => setActiveTab('memory')}>记忆</button>
      </div>

      <div className="app-settings-body">
        {activeTab === 'basic' && renderBasic()}
        {activeTab === 'model' && (
          <div className="app-settings-section">
            <h4>模型配置</h4>
            <AppModelConfig app={app} providers={providers} onUpdate={handleUpdateModels} />

            {/* 参数覆盖 */}
            <div style={{ marginTop: 16, borderTop: '1px dashed var(--border-primary)', paddingTop: 12 }}>
              <h4 style={{ marginBottom: 8, fontSize: 14, color: 'var(--text-primary)' }}>参数覆盖</h4>
              <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8 }}>
                从模型供应商的配置中选择要应用到当前应用的参数。
              </p>

              {/* 获取当前选中的供应商配置中的参数 */}
              {(() => {
                const currentModel = app.models?.[0];
                const currentProvider = currentModel
                  ? providers.find(p => p.id === currentModel.provider)
                  : null;
                const providerHeaderParams = currentProvider?.models?.find(m => m.id === currentModel?.model)?.headerParams || [];
                const providerBodyParams = currentProvider?.models?.find(m => m.id === currentModel?.model)?.bodyParams || [];

                if (!currentProvider) {
                  return <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>请先在"模型"标签页选择供应商和模型。</p>;
                }

                if (providerHeaderParams.length === 0 && providerBodyParams.length === 0) {
                  return <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>该模型供应商没有配置附加参数。请在全局设置的模型编辑中添加参数。</p>;
                }

                return (
                  <>
                    {providerHeaderParams.length > 0 && (
                      <div style={{ marginBottom: 12 }}>
                        <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>Header 参数</label>
                        {providerHeaderParams.map((p, i) => {
                          const appParam = formData.headerParams.find(ap => ap.key === p.key);
                          const isEnabled = appParam?.enabled ?? p.enabled;
                          return (
                            <label key={i} className="app-settings-checkbox" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0' }}>
                              <input type="checkbox" checked={isEnabled} onChange={() => {
                                const next = [...formData.headerParams];
                                const existing = next.findIndex(ap => ap.key === p.key);
                                if (existing >= 0) {
                                  next[existing] = { ...next[existing], enabled: !next[existing].enabled };
                                } else {
                                  next.push({ ...p, enabled: !isEnabled });
                                }
                                setFormData(prev => ({ ...prev, headerParams: next }));
                              }} />
                              <span style={{ fontSize: 12, color: 'var(--text-primary)', fontFamily: 'monospace', fontWeight: 500 }}>{p.key}</span>
                              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>: {p.value}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}

                    {providerBodyParams.length > 0 && (
                      <div>
                        <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>Body 参数</label>
                        {providerBodyParams.map((p, i) => {
                          const appParam = formData.bodyParams.find(ap => ap.key === p.key);
                          const isEnabled = appParam?.enabled ?? p.enabled;
                          return (
                            <label key={i} className="app-settings-checkbox" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0' }}>
                              <input type="checkbox" checked={isEnabled} onChange={() => {
                                const next = [...formData.bodyParams];
                                const existing = next.findIndex(ap => ap.key === p.key);
                                if (existing >= 0) {
                                  next[existing] = { ...next[existing], enabled: !next[existing].enabled };
                                } else {
                                  next.push({ ...p, enabled: !isEnabled });
                                }
                                setFormData(prev => ({ ...prev, bodyParams: next }));
                              }} />
                              <span style={{ fontSize: 12, color: 'var(--text-primary)', fontFamily: 'monospace', fontWeight: 500 }}>{p.key}</span>
                              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>: {p.value}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        )}
        {activeTab === 'tools' && renderTools()}
        {activeTab === 'skills' && (
          <div className="app-settings-section">
            <h4>可用技能</h4>
            <p className="app-settings-hint">只显示已在系统设置中启用的技能。勾选的技能会在 AI 对话时自动加载其入口文档。（如需管理技能启用，请前往 设置 → 技能）</p>
            <div className="app-settings-checklist">
              {allSkills.filter((s: any) => s.enabled).length === 0 && (
                <span className="app-settings-empty">暂无已启用的技能，请先在 系统设置 → 技能 中启用。</span>
              )}
              {allSkills.filter((s: any) => s.enabled).map((skill: any) => (
                <div key={skill.id} className="app-settings-checkbox" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0' }}>
                  <input
                    type="checkbox"
                    checked={formData.skills.includes(skill.id)}
                    onChange={() => canModifyAll && toggleSkill(skill.id)}
                    disabled={!canModifyAll}
                  />
                  <label style={{ cursor: 'pointer', fontWeight: 500, fontSize: 12, userSelect: 'none' }}
                    onClick={() => canModifyAll && toggleSkill(skill.id)}>
                    {skill.name}
                  </label>
                  <span style={{ flex: 1, textAlign: 'right', color: 'var(--text-secondary)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {skill.description || ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {activeTab === 'visibility' && renderVisibility()}
        {activeTab === 'prompt' && renderPrompt()}
        {activeTab === 'memory' && (
          <div className="app-settings-section">
            <MemoryPanel appId={appId} scope="app" />
          </div>
        )}
      </div>

      <div className="app-settings-footer">
        {canModifyAll && (
          <button className="btn-primary" onClick={handleSaveAll} disabled={isSaving}>
            {isSaving ? '保存中...' : '保存所有设置'}
          </button>
        )}
        <button className="btn-secondary" onClick={handleClose}>关闭</button>
      </div>
    </div>
  );
}
