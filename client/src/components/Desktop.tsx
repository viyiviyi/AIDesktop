import React, { useState, useEffect } from 'react';
import { useDesktop } from '../contexts/DesktopContext';
import { Window, ChatApp, SettingsApp } from './Window';
import { AppManagerWindow } from './AppManagerWindow';
import { SettingsMainWindow } from './SettingsMainWindow';
import { AppDetailWindow } from './AppDetailWindow';
import { AppSettingsWindow } from './AppSettingsWindow';
import { LogWindow } from './LogWindow';
import type { AppInfo } from '../types';

// 默认图标（蓝色方块带字母A）
const DEFAULT_ICON = 'data:image/svg+xml,' + encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <rect width="100" height="100" rx="20" fill="#0078d4"/>
    <text x="50" y="65" font-size="50" fill="white" text-anchor="middle">A</text>
  </svg>
`);

/**
 * 桌面组件 - 应用的主容器
 * 负责渲染桌面图标、窗口、系统主题、快捷键
 */
export function Desktop() {
  const { state, openApp, openSystemApp, closeStartMenu } = useDesktop();
  // 选中的桌面图标
  const [selectedIcon, setSelectedIcon] = useState<string | null>(null);
  // 系统主题（用于auto模式）
  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>(
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  );

  // 监听系统主题变化（用于auto模式）
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      setSystemTheme(e.matches ? 'dark' : 'light');
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  // 键盘快捷键处理
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+L 打开日志窗口
      if (e.ctrlKey && e.key === 'l') {
        e.preventDefault();
        const hasLogsOpen = state.windows.some((w) => w.appId === 'logs');
        if (!hasLogsOpen) {
          openSystemApp('logs', '日志');
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state.windows, openSystemApp]);

  // 筛选桌面应用
  const desktopApps = state.installedApps.filter((app) => app.type === 'desktop');

  // 点击桌面空白区域
  const handleDesktopClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      setSelectedIcon(null);
      closeStartMenu();
    }
  };

  // 双击图标打开应用（多开：每次双击新开窗口）
  const handleIconDoubleClick = (app: AppInfo) => {
    openApp(app, { forceNew: true });
  };

  // 单击图标选中
  const handleIconClick = (app: AppInfo) => {
    setSelectedIcon(app.id);
  };

  // 根据窗口appId渲染对应内容
  const renderAppContent = (windowState: typeof state.windows[0]) => {
    const appId = windowState.appId;

    // 处理 app-detail:xxx 格式（应用详情窗口）
    if (appId.startsWith('app-detail:')) {
      const targetAppId = appId.split(':')[1];
      return <AppDetailWindow appId={targetAppId} />;
    }

    // 处理 app-settings:xxx 格式（应用设置窗口）
    if (appId.startsWith('app-settings:')) {
      const targetAppId = appId.split(':')[1];
      return <AppSettingsWindow appId={targetAppId} />;
    }

    switch (appId) {
      case 'settings':
        return <SettingsApp appId={windowState.appId} />;
      case 'settings-main':
        return <SettingsMainWindow />;
      case 'app-manager':
        return <AppManagerWindow />;
      case 'logs':
        return <LogWindow />;
      case 'desktop-assistant':
      case 'app-builder':
      default:
        return <ChatApp appId={windowState.appId} windowId={windowState.id} conversationId={windowState.conversationId} />;
    }
  };

  // 壁纸样式
  const wallpaperStyle = state.settings.wallpaper
    ? {
        backgroundImage: `url(${state.settings.wallpaper})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }
    : { background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)' };

  // 获取主题CSS类
  const getThemeClass = () => {
    if (state.settings.theme === 'light') return 'theme-light';
    if (state.settings.theme === 'dark') return 'theme-dark';
    // auto: 跟随系统主题
    return systemTheme === 'dark' ? 'theme-dark' : 'theme-light';
  };
  const themeClass = getThemeClass();

  // 根据 dock 位置调整桌面区域 padding 和图标偏移，防止内容与 dock 重叠
  const getDesktopAreaStyle = (): React.CSSProperties => {
    const dockSize = 72;
    if (!state.settings.dock.autoHide) {
      switch (state.settings.dock.position) {
        case 'left':
          return { paddingLeft: dockSize, '--dock-offset-left': `${dockSize}px` } as React.CSSProperties;
        case 'right':
          return { paddingRight: dockSize };
        case 'bottom':
          return { paddingBottom: dockSize };
      }
    }
    return { '--dock-offset-left': '0px' } as React.CSSProperties;
  };

  return (
    <div className={`desktop ${themeClass}`} style={wallpaperStyle} onClick={handleDesktopClick}>
      <div className="desktop-area" style={getDesktopAreaStyle()}>
        <div className="desktop-icons">
          {desktopApps.map((app) => (
            <div
              key={app.id}
              className={`desktop-icon ${selectedIcon === app.id ? 'selected' : ''}`}
              onClick={() => handleIconClick(app)}
              onDoubleClick={() => handleIconDoubleClick(app)}
            >
              <img
                src={app.icon || DEFAULT_ICON}
                alt={app.name}
                onError={(e) => {
                  (e.target as HTMLImageElement).src = DEFAULT_ICON;
                }}
              />
              <span>{app.name}</span>
            </div>
          ))}
        </div>

        {state.windows.map((windowState) => (
          <Window
            key={windowState.id}
            windowState={windowState}
          >
            {renderAppContent(windowState)}
          </Window>
        ))}
      </div>
    </div>
  );
}
