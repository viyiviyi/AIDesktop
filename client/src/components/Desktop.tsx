import React, { useState, useEffect } from 'react';
import { useDesktop } from '../contexts/DesktopContext';
import { Window, ChatApp, SettingsApp } from './Window';
import { AppManagerWindow } from './AppManagerWindow';
import { SettingsMainWindow } from './SettingsMainWindow';
import { AppDetailWindow } from './AppDetailWindow';
import { AppSettingsWindow } from './AppSettingsWindow';
import type { AppInfo } from '../types';

const DEFAULT_ICON = 'data:image/svg+xml,' + encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <rect width="100" height="100" rx="20" fill="#0078d4"/>
    <text x="50" y="65" font-size="50" fill="white" text-anchor="middle">A</text>
  </svg>
`);

export function Desktop() {
  const { state, openApp, closeStartMenu } = useDesktop();
  const [selectedIcon, setSelectedIcon] = useState<string | null>(null);
  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>(
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  );

  // Listen for system theme changes when using auto mode
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      setSystemTheme(e.matches ? 'dark' : 'light');
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  const desktopApps = state.installedApps.filter((app) => app.type === 'desktop');

  const handleDesktopClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      setSelectedIcon(null);
      closeStartMenu();
    }
  };

  const handleIconDoubleClick = (app: AppInfo) => {
    openApp(app);
  };

  const handleIconClick = (app: AppInfo) => {
    setSelectedIcon(app.id);
  };

  const renderAppContent = (windowState: typeof state.windows[0]) => {
    const appId = windowState.appId;

    // Handle app-detail:xxx format
    if (appId.startsWith('app-detail:')) {
      const targetAppId = appId.split(':')[1];
      return <AppDetailWindow appId={targetAppId} />;
    }

    // Handle app-settings:xxx format
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
      case 'desktop-assistant':
      case 'app-builder':
        return <ChatApp appId={windowState.appId} conversationId={windowState.conversationId} />;
      default:
        return <ChatApp appId={windowState.appId} conversationId={windowState.conversationId} />;
    }
  };

  const wallpaperStyle = state.settings.wallpaper
    ? { backgroundImage: `url(${state.settings.wallpaper})` }
    : { background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)' };

  const getThemeClass = () => {
    if (state.settings.theme === 'light') return 'theme-light';
    if (state.settings.theme === 'dark') return 'theme-dark';
    // auto: follow system preference
    return systemTheme === 'dark' ? 'theme-dark' : 'theme-light';
  };
  const themeClass = getThemeClass();

  return (
    <div className={`desktop ${themeClass}`} style={wallpaperStyle} onClick={handleDesktopClick}>
      <div className="desktop-area">
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
