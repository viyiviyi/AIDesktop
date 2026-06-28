import { useState, useEffect } from 'react';
import { useDesktop } from '../contexts/DesktopContext';
import { AppIcon } from './AppIcon';
import type { AppInfo } from '../types';
import * as api from '../services/api';

export function AppManagerWindow() {
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
      <div className="app-manager-loading">
        <div className="loading-spinner">加载中...</div>
      </div>
    );
  }

  return (
    <div className="app-manager">
      <div className="app-manager-header">
        <h2>应用管理</h2>
        <p>选择要管理的应用</p>
      </div>

      <div className="app-manager-list">
        {apps.map((app) => (
          <div key={app.id} className="app-manager-item">
            <AppIcon icon={app.icon} name={app.name} className="app-manager-item-icon" size={40} />
            <div className="app-manager-item-info">
              <div className="app-manager-item-name">{app.name}</div>
              <div className="app-manager-item-meta">
                {app.source === 'system' ? '系统' : app.source === 'user' ? '用户' : '市场'} •{' '}
                {app.type === 'desktop' ? '桌面应用' : '后台服务'}
                {app.enabled === false && ' • 已禁用'}
              </div>
            </div>
            <button
              className="app-manager-item-btn"
              onClick={(e) => {
                e.stopPropagation();
                handleOpenDetail(app);
              }}
            >
              查看详情
            </button>
            <button
              className="app-manager-item-settings-btn"
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
        <div className="app-manager-empty">没有找到应用</div>
      )}
    </div>
  );
}
