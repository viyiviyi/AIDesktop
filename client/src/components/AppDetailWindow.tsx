import { useState, useEffect } from 'react';
import { useDesktop } from '../contexts/DesktopContext';
import { AppIcon } from './AppIcon';
import type { App, AppInfo } from '../types';
import * as api from '../services/api';

interface AppDetailWindowProps {
  appId: string;
}

export function AppDetailWindow({ appId }: AppDetailWindowProps) {
  const { openSystemApp, closeWindow, state } = useDesktop();
  const [app, setApp] = useState<App | null>(null);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Find the window state for this app
  const windowState = state.windows.find(w => w.appId === 'app-detail:' + appId);

  useEffect(() => {
    loadData();
  }, [appId]);

  async function loadData() {
    setIsLoading(true);
    try {
      const fullApp = await api.getApp(appId);
      setApp(fullApp);
      setAppInfo({
        id: fullApp.id,
        name: fullApp.name,
        description: fullApp.description,
        source: fullApp.source,
        type: fullApp.type,
        icon: fullApp.icon,
        enabled: fullApp.enabled,
        models: fullApp.models,
        supportedInputs: fullApp.supportedInputs,
        inputDescription: fullApp.inputDescription,
        outputDescription: fullApp.outputDescription,
        visibleApps: fullApp.visibleApps,
        visibleServices: fullApp.visibleServices,
        tools: fullApp.tools,
      });
    } catch (error) {
      console.error('Failed to load app details:', error);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleToggleEnabled() {
    if (!app) return;
    setIsLoading(true);
    try {
      if (app.enabled === false) {
        await api.enableApp(app.id);
        setApp({ ...app, enabled: true });
        setAppInfo(prev => prev ? { ...prev, enabled: true } : null);
      } else {
        await api.disableApp(app.id);
        setApp({ ...app, enabled: false });
        setAppInfo(prev => prev ? { ...prev, enabled: false } : null);
      }
    } catch (error) {
      console.error('Failed to toggle app enabled:', error);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSaveEdit(name: string, description: string, icon: string) {
    if (!app) return;
    setIsLoading(true);
    try {
      const updated = await api.updateApp(app.id, { name, description, icon });
      setApp(updated);
      setAppInfo(prev => prev ? { ...prev, name: updated.name, description: updated.description, icon: updated.icon } : null);
      setIsEditing(false);
    } catch (error) {
      console.error('Failed to update app:', error);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDelete() {
    if (!app || !confirm(`确定要删除应用"${app.name}"吗？此操作不可撤销。`)) return;
    setIsLoading(true);
    try {
      await api.deleteApp(app.id);
      if (windowState) {
        closeWindow(windowState.id);
      }
    } catch (error) {
      console.error('Failed to delete app:', error);
      alert('删除失败：' + (error as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  function handleOpenSettings() {
    if (app) {
      openSystemApp('app-settings:' + app.id, '应用设置: ' + app.name, app.icon);
    }
  }

  function handleClose() {
    if (windowState) {
      closeWindow(windowState.id);
    }
  }

  if (isLoading && !app) {
    return (
      <div className="app-detail-window-loading">
        <div className="loading-spinner">加载中...</div>
      </div>
    );
  }

  if (!app || !appInfo) {
    return (
      <div className="app-detail-window-error">
        <div>应用加载失败</div>
        <button className="btn-secondary" onClick={handleClose}>关闭</button>
      </div>
    );
  }

  const sourceLabel = {
    system: { text: '系统', color: 'var(--accent-color)' },
    user: { text: '用户', color: 'var(--success-color)' },
    marketplace: { text: '市场', color: 'var(--warning-color)' },
  }[app.source] || { text: '未知', color: 'var(--text-secondary)' };

  const typeLabel = {
    desktop: '桌面应用',
    background: '后台服务',
  }[app.type] || '未知';

  return (
    <div className="app-detail-window">
      <div className="app-detail-header">
        <AppIcon icon={app.icon || ''} name={app.name} className="app-detail-icon" size={56} />
        <div className="app-detail-title">
          <h2>{app.name}</h2>
          <div className="app-detail-badges">
            <span className="app-badge" style={{ background: sourceLabel.color }}>
              {sourceLabel.text}
            </span>
            <span className="app-badge" style={{ background: 'var(--bg-tertiary)' }}>
              {typeLabel}
            </span>
            <span className={`app-badge ${app.enabled !== false ? 'enabled' : 'disabled'}`}>
              {app.enabled !== false ? '已启用' : '已禁用'}
            </span>
          </div>
        </div>
        <button className="app-detail-close" onClick={handleClose}>×</button>
      </div>

      <div className="app-detail-content">
        {isEditing ? (
          <AppEditForm
            initialName={app.name}
            initialDescription={app.description}
            initialIcon={app.icon}
            onSave={handleSaveEdit}
            onCancel={() => setIsEditing(false)}
            isLoading={isLoading}
          />
        ) : (
          <>
            <div className="app-detail-section">
              <p className="app-detail-description">{app.description || '暂无描述'}</p>
            </div>

            <div className="app-detail-section">
              <h4>可见应用</h4>
              <div className="app-detail-tags">
                {app.visibleApps.length > 0 ? (
                  app.visibleApps.map((id) => (
                    <span key={id} className="app-tag">{id}</span>
                  ))
                ) : (
                  <span className="app-detail-empty">无限制</span>
                )}
              </div>
            </div>

            <div className="app-detail-section">
              <h4>可见服务</h4>
              <div className="app-detail-tags">
                {app.visibleServices.length > 0 ? (
                  app.visibleServices.map((id) => (
                    <span key={id} className="app-tag">{id}</span>
                  ))
                ) : (
                  <span className="app-detail-empty">无限制</span>
                )}
              </div>
            </div>

            <div className="app-detail-section">
              <h4>工具</h4>
              <div className="app-detail-tags">
                {app.tools.length > 0 ? (
                  app.tools.map((tool) => (
                    <span key={tool} className="app-tag">{tool}</span>
                  ))
                ) : (
                  <span className="app-detail-empty">无</span>
                )}
              </div>
            </div>

            {app.appMd && (
              <div className="app-detail-section">
                <h4>应用说明</h4>
                <div className="app-detail-appmd">{app.appMd}</div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="app-detail-footer">
        <button className="btn-secondary" onClick={handleOpenSettings}>
          打开设置
        </button>
        {app.source !== 'system' && (
          <>
            <button
              className="btn-secondary"
              onClick={handleToggleEnabled}
              disabled={isLoading}
            >
              {app.enabled === false ? '启用应用' : '禁用应用'}
            </button>
            {!isEditing && (
              <button
                className="btn-secondary"
                onClick={() => setIsEditing(true)}
                disabled={isLoading}
              >
                编辑
              </button>
            )}
            <button
              className="btn-danger"
              onClick={handleDelete}
              disabled={isLoading}
            >
              删除
            </button>
          </>
        )}
        {app.source === 'system' && (
          <button
            className="btn-secondary"
            onClick={handleToggleEnabled}
            disabled={isLoading}
          >
            {app.enabled === false ? '启用应用' : '禁用应用'}
          </button>
        )}
      </div>
    </div>
  );
}

interface AppEditFormProps {
  initialName: string;
  initialDescription: string;
  initialIcon: string;
  onSave: (name: string, description: string, icon: string) => void;
  onCancel: () => void;
  isLoading: boolean;
}

function AppEditForm({ initialName, initialDescription, initialIcon, onSave, onCancel, isLoading }: AppEditFormProps) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [icon, setIcon] = useState(initialIcon);

  useEffect(() => {
    setName(initialName);
    setDescription(initialDescription);
    setIcon(initialIcon);
  }, [initialName, initialDescription, initialIcon]);

  return (
    <div className="app-detail-edit">
      <div className="app-detail-field">
        <label>名称</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="app-detail-field">
        <label>描述</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
        />
      </div>
      <div className="app-detail-field">
        <label>图标 URL</label>
        <input
          type="text"
          value={icon}
          onChange={(e) => setIcon(e.target.value)}
        />
      </div>
      <div className="app-detail-actions">
        <button className="btn-secondary" onClick={onCancel} disabled={isLoading}>
          取消
        </button>
        <button className="btn-primary" onClick={() => onSave(name, description, icon)} disabled={isLoading}>
          保存
        </button>
      </div>
    </div>
  );
}
