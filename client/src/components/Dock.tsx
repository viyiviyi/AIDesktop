import React, { useState, useRef, useEffect } from 'react';
import { useDesktop } from '../contexts/DesktopContext';
import type { AppInfo, WindowState } from '../types';

// Default icons for apps without icons
const DEFAULT_ICON = 'data:image/svg+xml,' + encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <rect width="100" height="100" rx="20" fill="#0078d4"/>
    <text x="50" y="65" font-size="50" fill="white" text-anchor="middle">A</text>
  </svg>
`);

interface DockWindowMenuProps {
  windows: WindowState[];
  app: AppInfo;
  anchorEl: HTMLElement;
  onClose: () => void;
  onFocusWindow: (windowId: string) => void;
  onOpenNewWindow: (app: AppInfo) => void;
}

function DockWindowMenu({
  windows,
  app,
  anchorEl,
  onClose,
  onFocusWindow,
  onOpenNewWindow,
}: DockWindowMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (anchorEl) {
      const rect = anchorEl.getBoundingClientRect();
      setPosition({
        top: rect.top - 8,
        left: rect.left + rect.width / 2,
      });
    }
  }, [anchorEl]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="dock-window-menu"
      style={{ top: position.top, left: position.left }}
    >
      <div className="dock-window-menu-header">
        <img src={app.icon || DEFAULT_ICON} alt={app.name} />
        <span>{app.name}</span>
      </div>
      <div className="dock-window-menu-items">
        {windows.map((window) => (
          <div
            key={window.id}
            className="dock-window-menu-item"
            onClick={() => {
              onFocusWindow(window.id);
              onClose();
            }}
          >
            <span className="dock-window-title">{window.title}</span>
            <span className="dock-window-indicator" />
          </div>
        ))}
      </div>
      <div
        className="dock-window-menu-item new-window"
        onClick={() => {
          onOpenNewWindow(app);
          onClose();
        }}
      >
        <span>新建窗口</span>
      </div>
    </div>
  );
}

export function Dock() {
  const { state, openApp, toggleStartMenu, focusWindow } = useDesktop();
  const [windowMenu, setWindowMenu] = useState<{
    app: AppInfo;
    windows: WindowState[];
    anchorEl: HTMLElement;
  } | null>(null);

  const getWindowsForApp = (appId: string) => {
    return state.windows.filter((w) => w.appId === appId);
  };

  const handleAppMouseDown = (app: AppInfo, e: React.MouseEvent) => {
    if (e.button === 0) {
      // 左键：聚焦现有窗口或创建新窗口
      const windows = getWindowsForApp(app.id);
      if (windows.length === 0) {
        openApp(app, { forceNew: true });
      } else {
        const topWindow = windows.reduce((top, w) =>
          w.zIndex > top.zIndex ? w : top
        );
        focusWindow(topWindow.id);
      }
    } else if (e.button === 2) {
      // 右键：显示窗口菜单
      e.preventDefault();
      const windows = getWindowsForApp(app.id);
      setWindowMenu({ app, windows, anchorEl: e.currentTarget as HTMLElement });
    }
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
    <>
      <div className="dock bottom">
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
        <div className="dock-separator" />
        {state.taskbarApps.map((appId) => {
          const app = state.installedApps.find((a) => a.id === appId);
          if (!app) return null;
          return (
            <div
              key={app.id}
              className={`dock-item running`}
              onMouseDown={(e) => handleAppMouseDown(app, e)}
              onContextMenu={(e) => e.preventDefault()}
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
          );
        })}
      </div>
      {windowMenu && (
        <DockWindowMenu
          windows={windowMenu.windows}
          app={windowMenu.app}
          anchorEl={windowMenu.anchorEl}
          onClose={() => setWindowMenu(null)}
          onFocusWindow={focusWindow}
          onOpenNewWindow={(app) => openApp(app, { forceNew: true })}
        />
      )}
    </>
  );
}
