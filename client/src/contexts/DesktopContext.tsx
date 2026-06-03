import React, { createContext, useContext, useReducer, useEffect, useCallback } from 'react';
import type { DesktopState, WindowState, AppInfo, DesktopSettings } from '../types';
import * as api from '../services/api';

// 默认桌面设置配置
const DEFAULT_SETTINGS: DesktopSettings = {
  theme: 'light',
  wallpaper: '/wallpapers/default.jpg',
  dock: {
    position: 'bottom',
    magnification: true,
    autoHide: false,
  },
  window: {
    defaultSize: { width: 800, height: 600 },
    minSize: { width: 400, height: 300 },
    maximized: false,
  },
  menuBar: {
    autoHide: false,
  },
  startMenu: {
    width: 700,
    height: 500,
  },
};

// Action类型定义 - 描述所有可能的桌面状态更新操作
type Action =
  | { type: 'SET_SETTINGS'; payload: DesktopSettings }
  | { type: 'SET_APPS'; payload: AppInfo[] }
  | { type: 'SET_WINDOW_POSITIONS'; payload: Record<string, { x: number; y: number }> }
  | { type: 'ADD_WINDOW'; payload: WindowState }
  | { type: 'REMOVE_WINDOW'; payload: string }
  | { type: 'UPDATE_WINDOW'; payload: { id: string; updates: Partial<WindowState> } }
  | { type: 'FOCUS_WINDOW'; payload: string | null }
  | { type: 'TOGGLE_START_MENU'; payload?: 'click' | 'voice' }
  | { type: 'CLOSE_START_MENU' };

// 初始桌面状态
const initialState: DesktopState = {
  settings: DEFAULT_SETTINGS,
  installedApps: [],
  windows: [],
  focusedWindowId: null,
  startMenuOpen: false,
  startMenuMode: 'click',
  taskbarApps: [],
  appLastPositions: {},
};

// 状态更新reducer - 根据action更新桌面状态
function reducer(state: DesktopState, action: Action): DesktopState {
  switch (action.type) {
    case 'SET_SETTINGS':
      return { ...state, settings: action.payload };

    case 'SET_APPS':
      return { ...state, installedApps: action.payload };

    case 'SET_WINDOW_POSITIONS':
      return { ...state, appLastPositions: action.payload };

    // 添加新窗口
    case 'ADD_WINDOW': {
      const newWindows = [...state.windows, action.payload];
      // 维护taskbar上显示的应用列表（去重）
      const taskbarApps = [...new Set([...state.taskbarApps, action.payload.appId])];
      return {
        ...state,
        windows: newWindows,
        focusedWindowId: action.payload.id,
        taskbarApps,
      };
    }

    // 移除窗口
    case 'REMOVE_WINDOW': {
      const newWindows = state.windows.filter((w) => w.id !== action.payload);
      // 如果没有窗口了，清空taskbar
      const taskbarApps = newWindows.length > 0
        ? [...new Set(newWindows.map((w) => w.appId))]
        : [];
      // 如果移除的是当前聚焦窗口，聚焦到最后一个窗口
      const focusedWindowId = state.focusedWindowId === action.payload
        ? (newWindows.length > 0 ? newWindows[newWindows.length - 1].id : null)
        : state.focusedWindowId;
      return {
        ...state,
        windows: newWindows,
        focusedWindowId,
        taskbarApps,
      };
    }

    case 'UPDATE_WINDOW':
      return {
        ...state,
        windows: state.windows.map((w) =>
          w.id === action.payload.id ? { ...w, ...action.payload.updates } : w
        ),
      };

    // 聚焦窗口（同时提升其zIndex）
    case 'FOCUS_WINDOW':
      return {
        ...state,
        focusedWindowId: action.payload,
        windows: state.windows.map((w) => ({
          ...w,
          zIndex: w.id === action.payload ? Math.max(...state.windows.map((x) => x.zIndex), 0) + 1 : w.zIndex,
        })),
      };

    case 'TOGGLE_START_MENU':
      return {
        ...state,
        startMenuOpen: !state.startMenuOpen,
        startMenuMode: action.payload || 'click',
      };

    case 'CLOSE_START_MENU':
      return { ...state, startMenuOpen: false };

    default:
      return state;
  }
}

// 打开应用时的可选参数
interface OpenAppOptions {
  conversationId?: string;
  forceNew?: boolean;
}

// Context值接口定义
interface DesktopContextValue {
  state: DesktopState;
  openApp: (app: AppInfo, options?: OpenAppOptions) => void;
  openSystemApp: (appId: string, title: string, icon?: string) => void;
  closeWindow: (windowId: string) => void;
  focusWindow: (windowId: string) => void;
  updateWindow: (windowId: string, updates: Partial<WindowState>) => void;
  toggleStartMenu: (mode?: 'click' | 'voice') => void;
  closeStartMenu: () => void;
  updateSettings: (settings: Partial<DesktopSettings>) => Promise<void>;
  refreshApps: () => Promise<void>;
  minimizeWindow: (windowId: string) => void;
  maximizeWindow: (windowId: string) => void;
  /** 刷新单个 app 的数据（如设置变更后） */
  refreshApp: (appId: string) => Promise<AppInfo | null>;
}

// 创建Context（初始值为null）
const DesktopContext = createContext<DesktopContextValue | null>(null);

// 窗口ID计数器（用于生成唯一窗口ID）
let windowIdCounter = 0;

/**
 * 桌面Provider组件 - 提供桌面状态管理和操作接口
 * 包裹整个应用，提供窗口管理、设置更新等功能
 */
export function DesktopProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  // 加载初始数据（设置、应用列表、窗口位置）
  const loadInitialData = useCallback(async () => {
    try {
      const [settings, apps, windowPositions] = await Promise.all([
        api.getSettings(),
        api.getApps(),
        api.getWindowPositions().catch(() => ({})),
      ]);
      dispatch({ type: 'SET_SETTINGS', payload: settings });
      dispatch({ type: 'SET_APPS', payload: apps });
      if (Object.keys(windowPositions).length > 0) {
        dispatch({ type: 'SET_WINDOW_POSITIONS', payload: windowPositions });
      }
    } catch (error) {
      console.error('Failed to load initial data:', error);
    }
  }, []);

  // 组件挂载时加载初始数据
  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  // 打开应用（默认新开窗口）
  const openApp = useCallback((app: AppInfo, options?: OpenAppOptions) => {
    const { forceNew, conversationId } = options || {};

    // 如果不是强制新窗口，检查是否有已存在的窗口，聚焦之
    if (!forceNew) {
      const existingWindow = state.windows.find((w) => w.appId === app.id);
      if (existingWindow) {
        dispatch({ type: 'FOCUS_WINDOW', payload: existingWindow.id });
        if (existingWindow.isMinimized) {
          dispatch({
            type: 'UPDATE_WINDOW',
            payload: { id: existingWindow.id, updates: { isMinimized: false } },
          });
        }
        return;
      }
    }

    // 生成新窗口ID和会话ID
    const id = `window-${++windowIdCounter}`;
    const { defaultSize } = state.settings.window;
    const newConversationId = conversationId || `conv-${++windowIdCounter}`;

    // 计算窗口位置
    const lastPos = state.appLastPositions?.[app.id];
    let basePosition = lastPos || {
      x: (window.innerWidth - defaultSize.width) / 2,
      y: (window.innerHeight - defaultSize.height) / 2,
    };

    // 同个应用每多开一个窗口，偏移增加 30px 错开
    const sameAppCount = state.windows.filter(w => w.appId === app.id).length;
    const offset = 30 * sameAppCount;
    const newPosition = {
      x: basePosition.x + offset,
      y: basePosition.y + offset,
    };

    // 计算实例编号
    const instanceNum = sameAppCount + 1;
    const title = instanceNum > 1 ? `${app.name} #${instanceNum}` : app.name;

    // 创建新窗口状态
    const newWindow: WindowState = {
      id,
      appId: app.id,
      title,
      icon: app.icon,
      position: newPosition,
      size: { ...defaultSize },
      isMaximized: false,
      isMinimized: false,
      zIndex: state.windows.length > 0
        ? Math.max(...state.windows.map(w => w.zIndex)) + 1
        : 0,
      conversationId: newConversationId,
    };

    dispatch({ type: 'ADD_WINDOW', payload: newWindow });
  }, [state.windows, state.settings.window, state.appLastPositions]);

  // 打开系统应用（如设置窗口）
  const openSystemApp = useCallback((appId: string, title: string, icon?: string) => {
    // 系统应用也检查是否存在
    const existingWindow = state.windows.find((w) => w.appId === appId);
    if (existingWindow) {
      dispatch({ type: 'FOCUS_WINDOW', payload: existingWindow.id });
      if (existingWindow.isMinimized) {
        dispatch({
          type: 'UPDATE_WINDOW',
          payload: { id: existingWindow.id, updates: { isMinimized: false } },
        });
      }
      return;
    }

    const id = `window-${++windowIdCounter}`;
    const { defaultSize } = state.settings.window;
    const lastPos = state.appLastPositions?.[appId];
    const basePosition = lastPos || {
      x: (window.innerWidth - defaultSize.width) / 2,
      y: (window.innerHeight - defaultSize.height) / 2,
    };

    const maxZ = state.windows.reduce((max, w) => Math.max(max, w.zIndex), 0);

    const newWindow: WindowState = {
      id,
      appId,
      title,
      icon: icon || '',
      position: basePosition,
      size: { ...defaultSize },
      isMaximized: false,
      isMinimized: false,
      zIndex: maxZ + 1,
    };

    dispatch({ type: 'ADD_WINDOW', payload: newWindow });
  }, [state.windows, state.settings.window, state.appLastPositions]);

  // 关闭窗口
  const closeWindow = useCallback((windowId: string) => {
    dispatch({ type: 'REMOVE_WINDOW', payload: windowId });
  }, []);

  // 聚焦窗口
  const focusWindow = useCallback((windowId: string) => {
    dispatch({ type: 'FOCUS_WINDOW', payload: windowId });
  }, []);

  // 更新窗口属性
  const updateWindow = useCallback((windowId: string, updates: Partial<WindowState>) => {
    dispatch({ type: 'UPDATE_WINDOW', payload: { id: windowId, updates } });
  }, []);

  // 切换开始菜单
  const toggleStartMenu = useCallback((mode?: 'click' | 'voice') => {
    dispatch({ type: 'TOGGLE_START_MENU', payload: mode });
  }, []);

  // 关闭开始菜单
  const closeStartMenu = useCallback(() => {
    dispatch({ type: 'CLOSE_START_MENU' });
  }, []);

  // 更新设置
  const updateSettingsAction = useCallback(async (settings: Partial<DesktopSettings>) => {
    const updated = await api.updateSettings(settings);
    dispatch({ type: 'SET_SETTINGS', payload: updated });
  }, []);

  // 刷新应用列表
  // 刷新应用列表
  const refreshApps = useCallback(async () => {
    const result = await api.reloadApps();
    dispatch({ type: 'SET_APPS', payload: result.apps });
  }, []);

  // 刷新单个应用
  const refreshApp = useCallback(async (appId: string): Promise<AppInfo | null> => {
    try {
      const app = await api.getApp(appId);
      const info: AppInfo = {
        id: app.id,
        name: app.name,
        description: app.description,
        source: app.source,
        type: app.type,
        icon: app.icon,
        enabled: app.enabled,
      };
      // 更新 installedApps 中对应的条目
      dispatch({
        type: 'SET_APPS',
        payload: state.installedApps.map((a) => (a.id === appId ? info : a)),
      });
      return info;
    } catch {
      return null;
    }
  }, [state.installedApps]);

  // 最小化窗口
  const minimizeWindow = useCallback((windowId: string) => {
    dispatch({
      type: 'UPDATE_WINDOW',
      payload: { id: windowId, updates: { isMinimized: true } },
    });
  }, []);

  // 最大化/还原窗口
  const maximizeWindow = useCallback((windowId: string) => {
    const window = state.windows.find((w) => w.id === windowId);
    if (window) {
      dispatch({
        type: 'UPDATE_WINDOW',
        payload: { id: windowId, updates: { isMaximized: !window.isMaximized } },
      });
    }
  }, [state.windows]);

  return (
    <DesktopContext.Provider
      value={{
        state,
        openApp,
        openSystemApp,
        closeWindow,
        focusWindow,
        updateWindow,
        toggleStartMenu,
        closeStartMenu,
        updateSettings: updateSettingsAction,
        refreshApps,
        refreshApp,
        minimizeWindow,
        maximizeWindow,
      }}
    >
      {children}
    </DesktopContext.Provider>
  );
}

// 使用桌面Context的hook
export function useDesktop() {
  const context = useContext(DesktopContext);
  if (!context) {
    throw new Error('useDesktop must be used within DesktopProvider');
  }
  return context;
}
