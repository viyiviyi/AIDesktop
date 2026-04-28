import { useState, useEffect } from 'react';
import { useDesktop } from '../contexts/DesktopContext';
import type { App, ModelProvider, ModelConfig, ContentType } from '../types';
import * as api from '../services/api';
import { AppModelConfig } from './AppModelConfig';

type SettingsTab = 'basic' | 'model' | 'io' | 'visibility' | 'tools';

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
  const { closeWindow, state } = useDesktop();
  const [app, setApp] = useState<App | null>(null);
  const [providers, setProviders] = useState<ModelProvider[]>([]);
  const [installedApps, setInstalledApps] = useState<App[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<SettingsTab>('basic');
  const [isSaving, setIsSaving] = useState(false);

  // Form state for basic settings
  const [formData, setFormData] = useState({
    backgroundImage: '',
    supportedInputs: ['text'] as ContentType[],
    inputDescription: '',
    outputDescription: '',
    visibleApps: [] as string[],
    visibleServices: [] as string[],
    tools: [] as string[],
  });

  // Find the window state for this app
  const windowState = state.windows.find(w => w.appId === 'app-settings:' + appId || w.appId === appId);

  useEffect(() => {
    loadData();
  }, [appId]);

  async function loadData() {
    setIsLoading(true);
    try {
      const [fullApp, modesData, appsData] = await Promise.all([
        api.getApp(appId),
        api.getModes(),
        api.getApps(),
      ]);
      setApp(fullApp);
      setProviders(modesData.providers);
      setInstalledApps(appsData);

      // Initialize form data from app
      setFormData({
        backgroundImage: fullApp.backgroundImage || '',
        supportedInputs: fullApp.supportedInputs || ['text'],
        inputDescription: fullApp.inputDescription || '',
        outputDescription: fullApp.outputDescription || '',
        visibleApps: fullApp.visibleApps || [],
        visibleServices: fullApp.visibleServices || [],
        tools: fullApp.tools || [],
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
      await api.updateApp(app.id, { models });
      setApp({ ...app, models });
    } catch (error) {
      console.error('Failed to update app models:', error);
    }
  }

  async function handleSaveBasic() {
    if (!app) return;
    setIsSaving(true);
    try {
      const updates = {
        backgroundImage: formData.backgroundImage,
      };
      await api.updateApp(app.id, updates);
      setApp({ ...app, ...updates });
    } catch (error) {
      console.error('Failed to save basic settings:', error);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSaveIO() {
    if (!app) return;
    setIsSaving(true);
    try {
      const updates = {
        supportedInputs: formData.supportedInputs,
        inputDescription: formData.inputDescription,
        outputDescription: formData.outputDescription,
      };
      await api.updateApp(app.id, updates);
      setApp({ ...app, ...updates });
    } catch (error) {
      console.error('Failed to save IO settings:', error);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSaveVisibility() {
    if (!app) return;
    setIsSaving(true);
    try {
      const updates = {
        visibleApps: formData.visibleApps,
        visibleServices: formData.visibleServices,
      };
      await api.updateApp(app.id, updates);
      setApp({ ...app, ...updates });
    } catch (error) {
      console.error('Failed to save visibility settings:', error);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSaveTools() {
    if (!app) return;
    setIsSaving(true);
    try {
      const updates = {
        tools: formData.tools,
      };
      await api.updateApp(app.id, updates);
      setApp({ ...app, ...updates });
    } catch (error) {
      console.error('Failed to save tools settings:', error);
    } finally {
      setIsSaving(false);
    }
  }

  function handleClose() {
    if (windowState) {
      closeWindow(windowState.id);
    }
  }

  function toggleContentType(type: ContentType) {
    setFormData(prev => ({
      ...prev,
      supportedInputs: prev.supportedInputs.includes(type)
        ? prev.supportedInputs.filter(t => t !== type)
        : [...prev.supportedInputs, type],
    }));
  }

  function toggleVisibleApp(appId: string) {
    setFormData(prev => ({
      ...prev,
      visibleApps: prev.visibleApps.includes(appId)
        ? prev.visibleApps.filter(id => id !== appId)
        : [...prev.visibleApps, appId],
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

  const renderTabContent = () => {
    switch (activeTab) {
      case 'basic':
        return (
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
            {isUserApp && (
              <div className="app-settings-field">
                <label>背景图片</label>
                <input
                  type="text"
                  value={formData.backgroundImage}
                  onChange={(e) => setFormData(prev => ({ ...prev, backgroundImage: e.target.value }))}
                  placeholder="输入背景图片路径..."
                />
              </div>
            )}
            {isUserApp && (
              <button className="btn-primary" onClick={handleSaveBasic} disabled={isSaving}>
                {isSaving ? '保存中...' : '保存'}
              </button>
            )}
          </div>
        );

      case 'model':
        return (
          <div className="app-settings-section">
            <h4>模型配置</h4>
            <AppModelConfig app={app} providers={providers} onUpdate={handleUpdateModels} />
          </div>
        );

      case 'io':
        return (
          <div className="app-settings-section">
            <h4>输入输出设置</h4>
            {isUserApp && (
              <>
                <div className="app-settings-field">
                  <label>支持的输入格式</label>
                  <div className="app-settings-checkboxes">
                    {CONTENT_TYPES.map(({ value, label }) => (
                      <label key={value} className="app-settings-checkbox">
                        <input
                          type="checkbox"
                          checked={formData.supportedInputs.includes(value)}
                          onChange={() => toggleContentType(value)}
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
                    placeholder="描述该应用接受的输入格式和使用方式..."
                    rows={3}
                  />
                </div>
                <div className="app-settings-field">
                  <label>输出说明</label>
                  <textarea
                    value={formData.outputDescription}
                    onChange={(e) => setFormData(prev => ({ ...prev, outputDescription: e.target.value }))}
                    placeholder="描述该应用产生输出的格式和内容..."
                    rows={3}
                  />
                </div>
                <button className="btn-primary" onClick={handleSaveIO} disabled={isSaving}>
                  {isSaving ? '保存中...' : '保存'}
                </button>
              </>
            )}
            {!isUserApp && (
              <div className="app-settings-readonly-notice">
                系统应用不支持修改输入输出设置
              </div>
            )}
          </div>
        );

      case 'visibility':
        return (
          <div className="app-settings-section">
            <h4>可见性设置</h4>
            {isUserApp && (
              <>
                <div className="app-settings-field">
                  <label>可见的应用程序</label>
                  <div className="app-settings-checklist">
                    {installedApps
                      .filter(a => a.id !== app.id && a.type === 'desktop')
                      .map(a => (
                        <label key={a.id} className="app-settings-checkbox">
                          <input
                            type="checkbox"
                            checked={formData.visibleApps.includes(a.id)}
                            onChange={() => toggleVisibleApp(a.id)}
                          />
                          {a.name}
                        </label>
                      ))}
                    {installedApps.filter(a => a.id !== app.id && a.type === 'desktop').length === 0 && (
                      <span className="app-settings-empty">暂无其他应用</span>
                    )}
                  </div>
                </div>
                <div className="app-settings-field">
                  <label>可见的后台服务</label>
                  <div className="app-settings-checklist">
                    {installedApps
                      .filter(a => a.id !== app.id && a.type === 'background')
                      .map(a => (
                        <label key={a.id} className="app-settings-checkbox">
                          <input
                            type="checkbox"
                            checked={formData.visibleServices.includes(a.id)}
                            onChange={() => setFormData(prev => ({
                              ...prev,
                              visibleServices: prev.visibleServices.includes(a.id)
                                ? prev.visibleServices.filter(id => id !== a.id)
                                : [...prev.visibleServices, a.id],
                            }))}
                          />
                          {a.name}
                        </label>
                      ))}
                    {installedApps.filter(a => a.id !== app.id && a.type === 'background').length === 0 && (
                      <span className="app-settings-empty">暂无后台服务</span>
                    )}
                  </div>
                </div>
                <button className="btn-primary" onClick={handleSaveVisibility} disabled={isSaving}>
                  {isSaving ? '保存中...' : '保存'}
                </button>
              </>
            )}
            {!isUserApp && (
              <div className="app-settings-readonly-notice">
                系统应用不支持修改可见性设置
              </div>
            )}
          </div>
        );

      case 'tools':
        return (
          <div className="app-settings-section">
            <h4>工具设置</h4>
            {isUserApp && (
              <>
                <div className="app-settings-field">
                  <label>可使用的MCP工具</label>
                  <div className="app-settings-checklist">
                    {formData.tools.length > 0 ? (
                      formData.tools.map(tool => (
                        <span key={tool} className="app-settings-tool-tag">{tool}</span>
                      ))
                    ) : (
                      <span className="app-settings-empty">暂无可用工具</span>
                    )}
                  </div>
                  <p className="app-settings-hint">
                    工具配置需要在MCP设置中连接外部服务后自动同步
                  </p>
                </div>
                <button className="btn-primary" onClick={handleSaveTools} disabled={isSaving}>
                  {isSaving ? '保存中...' : '保存'}
                </button>
              </>
            )}
            {!isUserApp && (
              <div className="app-settings-readonly-notice">
                系统应用不支持修改工具设置
              </div>
            )}
          </div>
        );

      default:
        return null;
    }
  };

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
        <span className="app-settings-title">{app.name}</span>
        <span className="app-settings-subtitle">应用设置</span>
      </div>

      <div className="app-settings-tabs">
        <button
          className={`app-settings-tab ${activeTab === 'basic' ? 'active' : ''}`}
          onClick={() => setActiveTab('basic')}
        >
          基本
        </button>
        <button
          className={`app-settings-tab ${activeTab === 'model' ? 'active' : ''}`}
          onClick={() => setActiveTab('model')}
        >
          模型
        </button>
        <button
          className={`app-settings-tab ${activeTab === 'io' ? 'active' : ''}`}
          onClick={() => setActiveTab('io')}
        >
          输入输出
        </button>
        <button
          className={`app-settings-tab ${activeTab === 'visibility' ? 'active' : ''}`}
          onClick={() => setActiveTab('visibility')}
        >
          可见性
        </button>
        <button
          className={`app-settings-tab ${activeTab === 'tools' ? 'active' : ''}`}
          onClick={() => setActiveTab('tools')}
        >
          工具
        </button>
      </div>

      <div className="app-settings-body">
        {renderTabContent()}
      </div>

      <div className="app-settings-footer">
        <button className="btn-primary" onClick={handleClose}>
          完成
        </button>
      </div>
    </div>
  );
}
