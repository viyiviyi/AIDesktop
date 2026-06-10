import { useState, useEffect } from 'react';
import { useDesktop } from '../contexts/DesktopContext';
import type { App, ModelProvider, ModelConfig, ContentType } from '../types';
import * as api from '../services/api';
import { AppModelConfig } from './AppModelConfig';

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
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<SettingsTab>('basic');
  const [isSaving, setIsSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  // Form state
  const [formData, setFormData] = useState({
    enabled: true,
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
    w.appId === 'app-settings:' + appId || w.appId === appId
  );

  useEffect(() => {
    loadData();
  }, [appId]);

  async function loadData() {
    setIsLoading(true);
    try {
      const [fullApp, modesData, appsData, servicesRes] = await Promise.all([
        api.getApp(appId),
        api.getModes(),
        api.getApps(),
        api.getMcpServices ? api.getMcpServices() : fetch('/api/mcp/services').then(r => r.json()).catch(() => ({ services: [] })),
      ]);

      setApp(fullApp);
      setProviders(modesData.providers);
      setInstalledApps(appsData as any);
      setAvailableTools((servicesRes as any)?.services || []);

      setFormData({
        enabled: fullApp.enabled !== false,
        backgroundImage: fullApp.backgroundImage || '',
        supportedInputs: fullApp.supportedInputs || ['text'],
        inputDescription: fullApp.inputDescription || '',
        outputDescription: fullApp.outputDescription || '',
        visibleApps: fullApp.visibleApps || [],
        visibleServices: fullApp.visibleServices || [],
        tools: fullApp.tools || [],
        replySchema: fullApp.replySchema || undefined,
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
        backgroundImage: formData.backgroundImage,
        supportedInputs: formData.supportedInputs,
        inputDescription: formData.inputDescription,
        outputDescription: formData.outputDescription,
        visibleApps: formData.visibleApps,
        visibleServices: formData.visibleServices,
        tools: formData.tools,
        replySchema: formData.replySchema || undefined,
        // headerParams/bodyParams 写入 models[0]，不在顶层
        models: app.models?.length ? [{
          ...app.models[0],
          overrideParams: formData.headerParams.length > 0 || formData.bodyParams.length > 0,
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
    if (app.source === 'system') {
      showSaveMsg('系统应用不支持修改 app.md', true);
      return;
    }
    // app.md 暂未开放 API 后端修改
    showSaveMsg('修改 app.md 功能暂时仅支持手动编辑文件', true);
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
          <label>背景图片 URL</label>
          <input
            type="text"
            value={formData.backgroundImage}
            onChange={(e) => setFormData(prev => ({ ...prev, backgroundImage: e.target.value }))}
            placeholder="输入背景图片路径..."
          />
        </div>
      )}
    </div>
  );

  const renderTools = () => {
    const builtinServices = availableTools.length > 0 ? availableTools : [
      { name: 'mcp.filesystem', description: '文件系统服务' },
      { name: 'mcp.window', description: '窗口管理服务' },
      { name: 'mcp.settings', description: '设置服务' },
      { name: 'mcp.agent', description: 'Agent 管理服务' },
      { name: 'mcp.browser', description: '浏览器服务' },
    ];

    // 加上外部 MCP 连接的工具
    const allToolNames = [...new Set([
      ...builtinServices.map(s => s.name),
      ...formData.tools,
    ])];

    return (
      <div className="app-settings-section">
        <h4>MCP 工具 / 技能</h4>
        <p className="app-settings-hint">选择该应用可调用的 MCP 服务。后台服务应用默认拥有所有可见工具的调用权限。</p>
        <div className="app-settings-checklist">
          {allToolNames.map(name => {
            const service = builtinServices.find(s => s.name === name);
            return (
              <label key={name} className="app-settings-checkbox">
                <input
                  type="checkbox"
                  checked={formData.tools.includes(name)}
                  onChange={() => canModifyAll && toggleTool(name)}
                  disabled={!canModifyAll}
                />
                <span style={{ flex: 1 }}>{name}</span>
                {service && (
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginLeft: 6 }}>
                    {service.description}
                  </span>
                )}
              </label>
            );
          })}
        </div>
        {allToolNames.length === 0 && (
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
                  onChange={() => canModifyAll && a.replySchema && toggleVisibleApp(a.id)}
                  disabled={!canModifyAll || !a.replySchema}
                />
                {a.name}
                {!a.replySchema && (
                  <span style={{ fontSize: 11, color: 'var(--danger)', marginLeft: 8 }}>
                    未定义返回数据格式
                  </span>
                )}
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
                  onChange={() => canModifyAll && a.replySchema && toggleVisibleService(a.id)}
                  disabled={!canModifyAll || !a.replySchema}
                />
                {a.name}
                {!a.replySchema && (
                  <span style={{ fontSize: 11, color: 'var(--danger)', marginLeft: 8 }}>
                    未定义返回数据格式
                  </span>
                )}
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
        <label>输入输出设置</label>
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
        <label>输出说明</label>
        <textarea
          value={formData.outputDescription}
          onChange={(e) => setFormData(prev => ({ ...prev, outputDescription: e.target.value }))}
          placeholder="描述该应用产生输出的格式..."
          rows={2}
        />
      </div>
      <div className="app-settings-field">
        <label>返回数据格式 (replySchema)</label>
        <p className="app-settings-hint" style={{ fontSize: 11, marginBottom: 4 }}>
          JSON Schema 定义被调用时返回的数据格式。定义了此字段的应用才能被其他 Agent 调用。
          如果不支持被调用，留空即可。
        </p>
        <textarea
          value={formData.replySchema ? JSON.stringify(formData.replySchema, null, 2) : ''}
          onChange={(e) => {
            try {
              const parsed = JSON.parse(e.target.value);
              setFormData(prev => ({ ...prev, replySchema: parsed }));
            } catch {
              // JSON 不完整时不更新
            }
          }}
          placeholder={'{\n  "type": "object",\n  "properties": {\n    "success": { "type": "boolean" },\n    "data": { "type": "object" },\n    "error": { "type": "string" }\n  }\n}'}
          rows={6}
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
          readOnly={!isUserApp}
        />
      </div>
      {isUserApp && (
        <button className="btn-primary" onClick={handleSaveAppMd} disabled={isSaving}>
          {isSaving ? '保存中...' : '保存 app.md'}
        </button>
      )}
      {!isUserApp && (
        <p className="app-settings-hint">系统应用不可修改 app.md，如需修改请直接编辑文件</p>
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
