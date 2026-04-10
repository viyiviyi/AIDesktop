import React from 'react';
import { useDesktop } from '../contexts/DesktopContext';
import type { AppInfo } from '../types';

// Default icons for apps without icons
const DEFAULT_ICON = 'data:image/svg+xml,' + encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <rect width="100" height="100" rx="20" fill="#0078d4"/>
    <text x="50" y="65" font-size="50" fill="white" text-anchor="middle">A</text>
  </svg>
`);

export function Dock() {
  const { state, openApp, toggleStartMenu } = useDesktop();

  const desktopApps = state.installedApps.filter((app) => app.type === 'desktop');

  const handleAppClick = (app: AppInfo) => {
    openApp(app);
  };

  const handleStartClick = () => {
    toggleStartMenu('click');
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (e.detail === 2) {
      handleStartClick();
    }
  };

  return (
    <div className="dock bottom">
      {desktopApps.map((app) => (
        <div
          key={app.id}
          className={`dock-item ${state.taskbarApps.includes(app.id) ? 'running' : ''}`}
          onClick={() => handleAppClick(app)}
          title={app.name}
        >
          <img
            src={app.icon || DEFAULT_ICON}
            alt={app.name}
            onError={(e) => {
              (e.target as HTMLImageElement).src = DEFAULT_ICON;
            }}
          />
        </div>
      ))}
      <div className="dock-separator" />
      <div
        className="dock-item"
        onClick={handleStartClick}
        onDoubleClick={handleDoubleClick}
        title="开始菜单"
      >
        <svg viewBox="0 0 100 100" width="48" height="48">
          <rect width="100" height="100" rx="20" fill="rgba(255,255,255,0.9)"/>
          <rect x="20" y="20" width="25" height="25" rx="4" fill="#0078d4"/>
          <rect x="55" y="20" width="25" height="25" rx="4" fill="#28c840"/>
          <rect x="20" y="55" width="25" height="25" rx="4" fill="#febc2e"/>
          <rect x="55" y="55" width="25" height="25" rx="4" fill="#ff5f57"/>
        </svg>
      </div>
    </div>
  );
}
