import React, { createContext, useContext, useReducer, useEffect, useCallback } from 'react';
import type { DesktopState, WindowState, AppInfo, DesktopSettings } from '../types';
import * as api from '../services/api';

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

type Action =
  | { type: 'SET_SETTINGS'; payload: DesktopSettings }
  | { type: 'SET_APPS'; payload: AppInfo[] }
  | { type: 'ADD_WINDOW'; payload: WindowState }
  | { type: 'REMOVE_WINDOW'; payload: string }
  | { type: 'UPDATE_WINDOW'; payload: { id: string; updates: Partial<WindowState> } }
  | { type: 'FOCUS_WINDOW'; payload: string | null }
  | { type: 'TOGGLE_START_MENU'; payload?: 'click' | 'voice' }
  | { type: 'CLOSE_START_MENU' };

const initialState: DesktopState = {
  settings: DEFAULT_SETTINGS,
  installedApps: [],
  windows: [],
  focusedWindowId: null,
  startMenuOpen: false,
  startMenuMode: 'click',
  taskbarApps: [],
};

function reducer(state: DesktopState, action: Action): DesktopState {
  switch (action.type) {
    case 'SET_SETTINGS':
      return { ...state, settings: action.payload };

    case 'SET_APPS':
      return { ...state, installedApps: action.payload };

    case 'ADD_WINDOW': {
      const newWindows = [...state.windows, action.payload];
      const taskbarApps = [...new Set([...state.taskbarApps, action.payload.appId])];
      return {
        ...state,
        windows: newWindows,
        focusedWindowId: action.payload.id,
        taskbarApps,
      };
    }

    case 'REMOVE_WINDOW': {
      const newWindows = state.windows.filter((w) => w.id !== action.payload);
      const taskbarApps = newWindows.length > 0
        ? [...new Set(newWindows.map((w) => w.appId))]
        : [];
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

interface DesktopContextValue {
  state: DesktopState;
  openApp: (app: AppInfo, conversationId?: string) => void;
  closeWindow: (windowId: string) => void;
  focusWindow: (windowId: string) => void;
  updateWindow: (windowId: string, updates: Partial<WindowState>) => void;
  toggleStartMenu: (mode?: 'click' | 'voice') => void;
  closeStartMenu: () => void;
  updateSettings: (settings: Partial<DesktopSettings>) => Promise<void>;
  refreshApps: () => Promise<void>;
  minimizeWindow: (windowId: string) => void;
  maximizeWindow: (windowId: string) => void;
}

const DesktopContext = createContext<DesktopContextValue | null>(null);

let windowIdCounter = 0;

export function DesktopProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const loadInitialData = useCallback(async () => {
    try {
      const [settings, apps] = await Promise.all([
        api.getSettings(),
        api.getApps(),
      ]);
      dispatch({ type: 'SET_SETTINGS', payload: settings });
      dispatch({ type: 'SET_APPS', payload: apps });
    } catch (error) {
      console.error('Failed to load initial data:', error);
    }
  }, []);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  const openApp = useCallback((app: AppInfo, conversationId?: string) => {
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

    const id = `window-${++windowIdCounter}`;
    const { defaultSize } = state.settings.window;
    const offset = state.windows.length * 30;

    const newWindow: WindowState = {
      id,
      appId: app.id,
      title: app.name,
      icon: app.icon,
      position: {
        x: 100 + offset,
        y: 50 + offset,
      },
      size: { ...defaultSize },
      isMaximized: false,
      isMinimized: false,
      zIndex: offset,
      conversationId,
    };

    dispatch({ type: 'ADD_WINDOW', payload: newWindow });
  }, [state.windows, state.settings.window]);

  const closeWindow = useCallback((windowId: string) => {
    dispatch({ type: 'REMOVE_WINDOW', payload: windowId });
  }, []);

  const focusWindow = useCallback((windowId: string) => {
    dispatch({ type: 'FOCUS_WINDOW', payload: windowId });
  }, []);

  const updateWindow = useCallback((windowId: string, updates: Partial<WindowState>) => {
    dispatch({ type: 'UPDATE_WINDOW', payload: { id: windowId, updates } });
  }, []);

  const toggleStartMenu = useCallback((mode?: 'click' | 'voice') => {
    dispatch({ type: 'TOGGLE_START_MENU', payload: mode });
  }, []);

  const closeStartMenu = useCallback(() => {
    dispatch({ type: 'CLOSE_START_MENU' });
  }, []);

  const updateSettingsAction = useCallback(async (settings: Partial<DesktopSettings>) => {
    const updated = await api.updateSettings(settings);
    dispatch({ type: 'SET_SETTINGS', payload: updated });
  }, []);

  const refreshApps = useCallback(async () => {
    const apps = await api.getApps();
    dispatch({ type: 'SET_APPS', payload: apps });
  }, []);

  const minimizeWindow = useCallback((windowId: string) => {
    dispatch({
      type: 'UPDATE_WINDOW',
      payload: { id: windowId, updates: { isMinimized: true } },
    });
  }, []);

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
        closeWindow,
        focusWindow,
        updateWindow,
        toggleStartMenu,
        closeStartMenu,
        updateSettings: updateSettingsAction,
        refreshApps,
        minimizeWindow,
        maximizeWindow,
      }}
    >
      {children}
    </DesktopContext.Provider>
  );
}

export function useDesktop() {
  const context = useContext(DesktopContext);
  if (!context) {
    throw new Error('useDesktop must be used within DesktopProvider');
  }
  return context;
}
