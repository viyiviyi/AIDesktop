import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useDesktop } from '../contexts/DesktopContext';
import { AppIcon } from './AppIcon';
import type { AppInfo, WindowState } from '../types';

// Dock窗口菜单属性接口
interface DockWindowMenuProps {
  windows: WindowState[];
  app: AppInfo;
  anchorEl: HTMLElement;
  onClose: () => void;
  onCancelClose: () => void;
  onFocusWindow: (windowId: string) => void;
  onOpenNewWindow: (app: AppInfo) => void;
}

/**
 * Dock窗口菜单组件
 * 显示某个应用的所有窗口列表，支持聚焦窗口和新建窗口
 * hover 到图标显示菜单，点击菜单项关闭
 */
function DockWindowMenu({
  windows,
  app,
  anchorEl,
  onClose,
  onCancelClose,
  onFocusWindow,
  onOpenNewWindow,
}: DockWindowMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const { state } = useDesktop();

  // 根据锚点元素计算菜单位置
  useEffect(() => {
    if (anchorEl) {
      const rect = anchorEl.getBoundingClientRect();
      setPosition({
        top: rect.top,
        left: rect.left + rect.width / 2,
      });
    }
  }, [anchorEl]);

  // 提取前5个字作为标题显示
  const getShortTitle = (title: string): string => {
    const trimmed = title.trim();
    return trimmed.length > 5 ? trimmed.slice(0, 5) + '…' : trimmed;
  };

  // 获取窗口要显示的会话标题
  const getDisplayTitle = (w: WindowState): string => {
    if (w.conversationId && state.conversationTitles?.[w.conversationId]) {
      return state.conversationTitles[w.conversationId];
    }
    if (w.conversationTitle) {
      return w.conversationTitle;
    }
    return w.title;
  };

  return (
    <div
      ref={menuRef}
      className="dock-window-menu"
      style={{ top: position.top, left: position.left }}
      onMouseEnter={onCancelClose}
      onMouseLeave={onClose}
    >
      <div className="dock-window-menu-header">
        <AppIcon icon={app.icon} name={app.name} className="" size={48} />
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
            <span className="dock-window-title">{getShortTitle(getDisplayTitle(window))}</span>
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

/**
 * Dock组件（任务栏）
 * 显示开始按钮和正在运行的应用图标
 * 支持左键聚焦/新建窗口，右键显示窗口菜单
 */
export function Dock() {
  const { state, openApp, toggleStartMenu, focusWindow } = useDesktop();
  // 当前显示的窗口菜单
  const [windowMenu, setWindowMenu] = useState<{
    app: AppInfo;
    windows: WindowState[];
    anchorEl: HTMLElement;
  } | null>(null);
  // 本地控制自动隐藏显示状态
  const [visible, setVisible] = useState(!state.settings.dock.autoHide);
  const hideTimerRef = useRef<number | null>(null);
  // 窗口菜单延迟关闭
  const menuTimerRef = useRef<number | null>(null);

  // autoHide 开关变化时重置可见性
  useEffect(() => {
    setVisible(!state.settings.dock.autoHide);
  }, [state.settings.dock.autoHide]);

  // 显示 dock（取消隐藏计时器）
  const showDock = useCallback(() => {
    if (hideTimerRef.current !== null) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    setVisible(true);
  }, []);

  // 延迟隐藏 dock
  const hideDock = useCallback(() => {
    if (!state.settings.dock.autoHide) return;
    if (hideTimerRef.current !== null) {
      clearTimeout(hideTimerRef.current);
    }
    hideTimerRef.current = window.setTimeout(() => {
      setVisible(false);
      hideTimerRef.current = null;
    }, 300);
  }, [state.settings.dock.autoHide]);

  // 清理
  useEffect(() => {
    return () => {
      if (hideTimerRef.current !== null) {
        clearTimeout(hideTimerRef.current);
      }
    };
  }, []);

  // 获取指定应用的所有窗口
  const getWindowsForApp = (appId: string) => {
    return state.windows.filter((w) => w.appId === appId);
  };

  // 应用图标鼠标进入事件：延迟显示窗口菜单
  const handleAppMouseEnter = (app: AppInfo, e: React.MouseEvent) => {
    if (menuTimerRef.current !== null) {
      clearTimeout(menuTimerRef.current);
      menuTimerRef.current = null;
    }
    const windows = getWindowsForApp(app.id);
    if (windows.length > 0) {
      const anchorEl = e.currentTarget as HTMLElement;
      menuTimerRef.current = window.setTimeout(() => {
        setWindowMenu({ app, windows, anchorEl });
        menuTimerRef.current = null;
      }, 300);
    }
  };

  // 延迟关闭窗口菜单（给鼠标移入菜单的时间）
  const handleMenuClose = useCallback(() => {
    if (menuTimerRef.current !== null) {
      clearTimeout(menuTimerRef.current);
    }
    menuTimerRef.current = window.setTimeout(() => {
      setWindowMenu(null);
      menuTimerRef.current = null;
    }, 200);
  }, []);

  // 取消菜单关闭
  const cancelMenuClose = useCallback(() => {
    if (menuTimerRef.current !== null) {
      clearTimeout(menuTimerRef.current);
      menuTimerRef.current = null;
    }
  }, []);

  // 应用图标鼠标点击事件
  const handleAppMouseDown = (app: AppInfo, e: React.MouseEvent) => {
    if (e.button === 0) {
      const windows = getWindowsForApp(app.id);
      if (windows.length > 0) {
        // 有窗口时聚焦最上层的一个
        const topWindow = windows.reduce((top, w) =>
          w.zIndex > top.zIndex ? w : top
        );
        focusWindow(topWindow.id);
        if (topWindow.isMinimized) {
          // dispatch 中恢复最小化需要额外处理
        }
      } else {
        openApp(app, { forceNew: true });
      }
    } else if (e.button === 2) {
      e.preventDefault();
    }
  };

  // 开始按钮点击
  const handleStartClick = () => {
    toggleStartMenu('click');
  };

  // 双击开始按钮（额外处理）
  const handleDoubleClick = (e: React.MouseEvent) => {
    if (e.detail === 2) {
      handleStartClick();
    }
  };

  const pos = state.settings.dock.position;
  const align = state.settings.dock.align || 'center';
  const hiddenClass = state.settings.dock.autoHide && !visible ? 'hidden' : '';

  return (
    <>
      {/* 自动隐藏时的唤出条 —— 从屏幕边缘触发，hover 时唤出 dock */}
      {state.settings.dock.autoHide && (
        <div
          className={`dock-trigger ${pos}`}
          onMouseEnter={showDock}
        />
      )}
      <div
        className={`dock ${pos} ${align} ${hiddenClass}`}
        onMouseEnter={() => {
          showDock();
        }}
        onMouseLeave={(e) => {
          // 如果鼠标移到了唤出条或窗口菜单上，不隐藏
          const related = e.relatedTarget as HTMLElement | null;
          if (related?.classList?.contains('dock-trigger') || related?.classList?.contains('dock-window-menu') || related?.closest('.dock-window-menu')) return;
          hideDock();
        }}
      >
        <div
          className="dock-item"
          onClick={handleStartClick}
          onDoubleClick={handleDoubleClick}
          title="开始菜单"
        >
          <svg viewBox="0 0 100 100" width="52" height="52" style={{ display: 'block' }}>
            <rect width="100" height="100" rx="20" fill="rgba(255,255,255,0.9)"/>
            <rect x="20" y="20" width="25" height="25" rx="4" fill="#0078d4"/>
            <rect x="55" y="20" width="25" height="25" rx="4" fill="#28c840"/>
            <rect x="20" y="55" width="25" height="25" rx="4" fill="#febc2e"/>
            <rect x="55" y="55" width="25" height="25" rx="4" fill="#ff5f57"/>
          </svg>
        </div>
        {state.taskbarApps.filter(appId => state.installedApps.some(a => a.id === appId)).length > 0 && (
          <div className={`dock-separator ${pos === 'left' || pos === 'right' ? 'horizontal' : ''}`} />
        )}
        {state.taskbarApps.map((appId) => {
          const app = state.installedApps.find((a) => a.id === appId);
          if (!app) return null;
          return (
            <div
              key={app.id}
              className={`dock-item running`}
              onMouseEnter={(e) => handleAppMouseEnter(app, e)}
              onMouseLeave={handleMenuClose}
              onMouseDown={(e) => handleAppMouseDown(app, e)}
              onContextMenu={(e) => e.preventDefault()}
              title={app.name}
            >
              <AppIcon icon={app.icon} name={app.name} className="" size={48} />
            </div>
          );
        })}
      </div>
      {windowMenu && (
        <DockWindowMenu
          windows={windowMenu.windows}
          app={windowMenu.app}
          anchorEl={windowMenu.anchorEl}
          onClose={handleMenuClose}
          onCancelClose={cancelMenuClose}
          onFocusWindow={focusWindow}
          onOpenNewWindow={(app) => openApp(app, { forceNew: true })}
        />
      )}
    </>
  );
}
