import { useState, useEffect } from 'react';
import { useDesktop } from '../contexts/DesktopContext';
import { AppIcon } from './AppIcon';
import type { AppInfo } from '../types';
import * as api from '../services/api';

export function SettingsMainWindow() {
  const { openSystemApp } = useDesktop();
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadApps();
  }, []);

  async function loadApps() {
    setIsLoading(true);
    try {
      const appsData = await api.getApps();
      setApps(appsData);
    } catch (error) {
      console.error('Failed to load apps:', error);
    } finally {
      setIsLoading(false);
    }
  }

  function handleOpenDetail(app: AppInfo) {
    openSystemApp('app-detail:' + app.id, '应用详情: ' + app.name, app.icon);
  }

  function handleOpenSettings(app: AppInfo) {
    openSystemApp('app-settings:' + app.id, '应用设置: ' + app.name, app.icon);
  }

  if (isLoading) {
    return (
      <div className="settings-main-loading">
        <div className="loading-spinner">加载中...</div>
      </div>
    );
  }

  return (
    <div className="settings-main">
      <div className="settings-main-header">
        <h2>应用设置</h2>
        <p>选择要配置的应用 AI 模型</p>
      </div>

      <div className="settings-main-list">
        {apps.map((app) => (
          <div
            key={app.id}
            className="settings-main-item"
          >
            <AppIcon icon={app.icon} name={app.name} className="settings-main-item-icon" size={40} />
            <div className="settings-main-item-info">
              <div className="settings-main-item-name">{app.name}</div>
              <div className="settings-main-item-meta">
                {app.source === 'system' ? '系统' : app.source === 'user' ? '用户' : '市场'} •{' '}
                {app.type === 'desktop' ? '桌面应用' : '后台服务'}
                {app.enabled === false && ' • 已禁用'}
              </div>
            </div>
            <button
              className="settings-main-item-btn"
              onClick={(e) => {
                e.stopPropagation();
                handleOpenDetail(app);
              }}
            >
              查看详情
            </button>
            <button
              className="settings-main-item-settings-btn"
              onClick={(e) => {
                e.stopPropagation();
                handleOpenSettings(app);
              }}
              title="应用设置"
            >
              ⚙️
            </button>
          </div>
        ))}
      </div>

      {apps.length === 0 && !isLoading && (
        <div className="settings-main-empty">没有找到应用</div>
      )}
    </div>
  );
}
