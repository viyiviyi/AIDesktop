import { useState, useEffect } from 'react';
import { useDesktop } from '../contexts/DesktopContext';
import type { App, ModelProvider, ModelConfig } from '../types';
import * as api from '../services/api';
import { AppModelConfig } from './AppModelConfig';

interface AppSettingsWindowProps {
  appId: string;
}

export function AppSettingsWindow({ appId }: AppSettingsWindowProps) {
  const { closeWindow, state } = useDesktop();
  const [app, setApp] = useState<App | null>(null);
  const [providers, setProviders] = useState<ModelProvider[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Find the window state for this app
  const windowState = state.windows.find(w => w.appId === 'app-settings:' + appId || w.appId === appId);

  useEffect(() => {
    loadData();
  }, [appId]);

  async function loadData() {
    setIsLoading(true);
    try {
      const [fullApp, modesData] = await Promise.all([
        api.getApp(appId),
        api.getModes(),
      ]);
      setApp(fullApp);
      setProviders(modesData.providers);
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

  function handleClose() {
    if (windowState) {
      closeWindow(windowState.id);
    }
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

      <div className="app-settings-body">
        <AppModelConfig app={app} providers={providers} onUpdate={handleUpdateModels} />
      </div>

      <div className="app-settings-footer">
        <button className="btn-primary" onClick={handleClose}>
          完成
        </button>
      </div>
    </div>
  );
}
