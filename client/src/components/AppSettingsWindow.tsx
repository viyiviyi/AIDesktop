import { useState, useEffect } from 'react';
import { useDesktop } from '../contexts/DesktopContext';
import type { App, ModelProvider, ModelConfig, ContentType } from '../types';
import * as api from '../services/api';
import { AppModelConfig } from './AppModelConfig';
import { MediaSelector } from './MediaSelector';

type SettingsTab = 'basic' | 'model' | 'tools' | 'visibility' | 'prompt';

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
  const [installedApps, setInstalledApps] = useState<App[]>([]);
  const [availableTools, setAvailableTools] = useState<{ name: string; description: string }[]>([]);
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
  const [showToolDescs, setShowToolDescs] = useState<Record<string, boolean>>({});

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
    appMd: '',
    headerParams: [] as { key: string; value: string; enabled: boolean }[],
    bodyParams: [] as { key: string; value: string; enabled: boolean }[],
  });

  const windowState = state.windows.find(w =>
    w.appId === 'app-settings:' + appId
  );

  useEffect(() => {
    loadData();
  }, [appId]);

  async function loadData() {
    setIsLoading(true);
    try {
      const [fullApp, modesData, appsData, servicesRes, mcpConnectionsRes] = await Promise.all([
        api.getApp(appId),
        api.getModes(),
        api.getApps(),
        api.getMcpServices ? api.getMcpServices() : fetch('/api/mcp/services').then(r => r.json()).catch(() => ({ services: [] })),
        api.getMcpConnections().catch(() => []),
      ]);

      setApp(fullApp);
      setProviders(modesData.providers);
      setInstalledApps(appsData as any);
      setAvailableTools((servicesRes as any)?.services || []);

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
        appMd: fullApp.appMd || '',
        headerParams: fullApp.models?.[0]?.headerParams || [],
        bodyParams: fullApp.models?.[0]?.bodyParams || [],
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
        appMd: formData.appMd,
        // headerParams/bodyParams 写入 models[0]，不在顶层
        models: app.models?.length ? [{
          ...app.models[0],
          headerParams: formData.headerParams,
          bodyParams: formData.bodyParams,
        }] : [],
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
    const builtinServices = allServices.filter((s: any) => s.category === 'builtin');
    const workspaceServices = allServices.filter((s: any) => s.category === 'workspace');
    const fallbackServices = allServices.length === 0 ? [
      { name: 'mcp.filesystem', description: '文件系统服务', category: 'admin' },
      { name: 'mcp.window', description: '窗口管理服务', category: 'admin' },
      { name: 'mcp.settings', description: '设置服务', category: 'admin' },
      { name: 'mcp.agent', description: 'Agent 管理服务', category: 'builtin' },
      { name: 'mcp.sleep', description: '等待一段时间（最多600秒）', category: 'builtin' },
      { name: 'mcp.exec', description: '执行 shell 命令', category: 'builtin' },
      { name: 'mcp.http', description: '发送 HTTP 请求', category: 'builtin' },
      { name: 'mcp.browser', description: '浏览器控制', category: 'builtin' },
      { name: 'mcp.form', description: '表单交互', category: 'builtin' },
    ] : [];

    const adminList = adminServices.length > 0 ? adminServices : fallbackServices.filter(s => s.category === 'admin');
    const builtinList = builtinServices.length > 0 ? builtinServices : fallbackServices.filter(s => s.category === 'builtin');
    const workspaceList = workspaceServices.length > 0 ? workspaceServices : [];

    // checkbox + 名称 + 说明同一行
    const renderServiceItem = (s: any) => {
      return (
        <div key={s.name} className="app-settings-checkbox" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0' }}>
          <input
            type="checkbox"
            checked={formData.tools.includes(s.name)}
            onChange={() => canModifyAll && toggleTool(s.name)}
            disabled={!canModifyAll}
          />
          <label style={{ cursor: 'pointer', fontWeight: 500, fontSize: 12, userSelect: 'none' }}
            onClick={() => canModifyAll && toggleTool(s.name)}>
            {s.name}
          </label>
          <span style={{ flex: 1, textAlign: 'right', color: 'var(--text-secondary)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', userSelect: 'text', cursor: 'default' }}>
            {s.description || ''}
          </span>
        </div>
      );
    };

    return (
      <div className="app-settings-section">
        <h4>内置管理工具</h4>
        <p className="app-settings-hint">系统管理和维护工具，用于控制桌面环境。</p>
        <div className="app-settings-checklist" style={{ marginBottom: 16 }}>
          {adminList.map(renderServiceItem)}
        </div>

        <h4>内置通用工具</h4>
        <p className="app-settings-hint">通用的辅助工具，可供所有应用调用。</p>
        <div className="app-settings-checklist" style={{ marginBottom: 16 }}>
          {builtinList.map(renderServiceItem)}
        </div>

        <h4>工作工具</h4>
        <p className="app-settings-hint">需要授权的工作区工具，首次使用时会弹出确认。</p>
        <div className="app-settings-checklist" style={{ marginBottom: 16 }}>
          {workspaceList.map(renderServiceItem)}
        </div>

        {(mcpExternals || []).filter(c => c.isConnected).length > 0 && (
          <>
            <h4>外部 MCP 服务</h4>
            <p className="app-settings-hint">已连接的 MCP 服务器提供的工具，可单独勾选。</p>
            {mcpExternals.filter(c => c.isConnected).map(conn => {
              const connName = conn.serverInfo?.name || conn.connectionId;
              const tools = conn.tools || [];
              const checkedCount = tools.filter(t => formData.tools.includes(`external:${conn.connectionId}:${t.name}`)).length;
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
                        const keys = tools.map(t => `external:${conn.connectionId}:${t.name}`);
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
                        const toolKey = `external:${conn.connectionId}:${tool.name}`;
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

        {(mcpExternals || []).filter(c => c.isConnected).length === 0 && builtinServices.length === 0 && (
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
        <img
          src={app.icon || ''}
          alt={app.name}
          className="app-settings-icon"
          onError={(e) => {
            (e.target as HTMLImageElement).src = 'data:image/svg+xml,' + encodeURIComponent(`
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
                <rect width="100" height="100" rx="20" fill="#0078d4"/>
                <text x="50" y="65" font-size="50" fill="white" text-anchor="middle">A</text>
              </svg>
            `);
          }}
        />
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
        <button className={`app-settings-tab ${activeTab === 'visibility' ? 'active' : ''}`} onClick={() => setActiveTab('visibility')}>权限</button>
        <button className={`app-settings-tab ${activeTab === 'prompt' ? 'active' : ''}`} onClick={() => setActiveTab('prompt')}>提示</button>
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
        {activeTab === 'visibility' && renderVisibility()}
        {activeTab === 'prompt' && renderPrompt()}
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
