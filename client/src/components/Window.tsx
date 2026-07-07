import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useDesktop } from '../contexts/DesktopContext';
import { useToast } from '../contexts/ToastContext';
import type { WindowState, Message, ModelProvider, MCPConnection, AppInfo, App, ProviderModel, Content, FormSchema } from '../types';
import * as api from '../services/api';
import { useAgentEventStream } from '../services/useAgentEventStream';
import type { WsConvEvent } from '../services/useAgentEventStream';
import { FormComponent } from './FormComponent';
import { WorkspaceDirSelector } from './WorkspaceDirSelector';
import { MediaSelector } from './MediaSelector';
import { PictureFilled } from '@ant-design/icons';
import { InjectionBar } from './InjectionBar';
import { MemoryPanel } from './MemoryPanel';
import { MessageList } from './MessageList';

import { AppIcon } from './AppIcon';

import { ChatApp } from './ChatApp';
import { SettingsApp } from './SettingsApp';

// 窗口组件属性接口
interface WindowProps {
  windowState: WindowState;
  children: React.ReactNode;
}

/**
 * 窗口组件 - 负责渲染可拖拽、可调整大小的窗口
 * 支持窗口最大化、最小化、关闭等操作
 */
export function Window({ windowState, children }: WindowProps) {
  const { state, focusWindow, updateWindow, closeWindow, minimizeWindow, maximizeWindow } = useDesktop();
  const windowRef = useRef<HTMLDivElement>(null);
  // 拖拽状态
  const [isDragging, setIsDragging] = useState(false);
  // 调整大小状态
  const [isResizing, setIsResizing] = useState(false);
  // 拖拽偏移量（鼠标按下时记录）
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  // 调整大小方向（e东、s南、w西、n北的组合）
  const resizeDirectionRef = useRef('');
  // 使用ref保持windowState引用最新（避免闭包问题）
  const windowStateRef = useRef(windowState);

  // 保持windowStateRef与最新windowState同步
  windowStateRef.current = windowState;

  // 判断当前窗口是否被聚焦
  const isFocused = state.focusedWindowId === windowState.id;

  // 聚焦时提升窗口层级
  useEffect(() => {
    if (isFocused && windowRef.current) {
      windowRef.current.style.zIndex = String(windowState.zIndex);
    }
  }, [isFocused, windowState.zIndex]);

  // 点击窗口时聚焦（但点击控制按钮、输入框、按钮等交互元素时不触发）
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.target instanceof HTMLElement) {
      // 不拦截交互元素的点击事件
      if (e.target.closest('.window-control')) {
        return;
      }
      if (e.target.closest('input, textarea, select, button, label[for]')) {
        return;
      }
      // 不拦截 select option 点击
      if (e.target.tagName === 'OPTION') {
        return;
      }
    }
    focusWindow(windowState.id);
  };

  // 标题栏鼠标按下 - 开始拖拽移动
  const handleHeaderMouseDown = (e: React.MouseEvent) => {
    if (e.target instanceof HTMLElement && e.target.closest('.window-control')) {
      return;
    }
    e.preventDefault();
    setIsDragging(true);
    // 计算鼠标相对窗口左上角的偏移
    dragOffsetRef.current = {
      x: e.clientX - windowState.position.x,
      y: e.clientY - windowState.position.y,
    };
    focusWindow(windowState.id);
  };

  // 调整大小把手鼠标按下 - 开始调整窗口大小
  const handleResizeMouseDown = (e: React.MouseEvent, direction: string) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    resizeDirectionRef.current = direction;
    focusWindow(windowState.id);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const currentWindowState = windowStateRef.current;

      // 拖拽移动
      if (isDragging) {
        updateWindow(currentWindowState.id, {
          position: {
            x: e.clientX - dragOffsetRef.current.x,
            y: e.clientY - dragOffsetRef.current.y,
          },
        });
      }
      // 调整大小
      if (isResizing && resizeDirectionRef.current) {
        const deltaX = e.clientX - (currentWindowState.position.x + currentWindowState.size.width);
        const deltaY = e.clientY - (currentWindowState.position.y + currentWindowState.size.height);

        let newWidth = currentWindowState.size.width;
        let newHeight = currentWindowState.size.height;
        const dir = resizeDirectionRef.current;

        // 根据方向计算新尺寸
        if (dir.includes('e')) newWidth += deltaX;
        if (dir.includes('s')) newHeight += deltaY;
        if (dir.includes('w')) {
          newWidth -= deltaX;
        }
        if (dir.includes('n')) {
          newHeight -= deltaY;
        }

        // 限制最小尺寸
        newWidth = Math.max(state.settings.window.minSize.width, newWidth);
        newHeight = Math.max(state.settings.window.minSize.height, newHeight);

        updateWindow(currentWindowState.id, {
          size: { width: newWidth, height: newHeight },
        });
      }
    };

    // 鼠标松开 - 结束拖拽或调整大小
    const handleMouseUp = async () => {
      setIsDragging(false);
      setIsResizing(false);

      // 拖拽结束后保存窗口位置
      if (windowStateRef.current) {
        try {
          await api.saveWindowPosition(windowStateRef.current.appId, windowStateRef.current.position);
        } catch (error) {
          console.error('Failed to save window position:', error);
        }
      }
    };

    // 拖拽或调整大小时添加全局事件监听
    if (isDragging || isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, isResizing, updateWindow, state.settings.window.minSize]);

  return (
    <div
      ref={windowRef}
      className={`window ${windowState.isMaximized ? 'maximized' : ''} ${windowState.isMinimized ? 'minimized' : ''}`}
      style={{
        left: windowState.position.x,
        top: windowState.position.y,
        width: windowState.size.width,
        height: windowState.size.height,
        zIndex: windowState.zIndex,
        opacity: isFocused ? 1 : 1,
      }}
      onMouseDown={handleMouseDown}
    >
      <div className="window-header" onMouseDown={handleHeaderMouseDown}>
        <div style={{ width: 84 }} />
        <div className="window-title">
          <AppIcon icon={windowState.icon} name={windowState.title} className="window-title-icon" size={16} />
          {windowState.title}
        </div>
        <div className="window-controls">
          <div className="window-control minimize" onClick={() => minimizeWindow(windowState.id)} />
          <div className="window-control maximize" onClick={() => maximizeWindow(windowState.id)} />
          <div className="window-control close" onClick={() => closeWindow(windowState.id)} />
        </div>
      </div>
      <div className="window-content" style={{
        ...((state.installedApps.find(a => a.id === windowState.appId)?.backgroundImage || windowState.app?.backgroundImage)
        ? {
          backgroundImage: `url(${state.installedApps.find(a => a.id === windowState.appId)?.backgroundImage || windowState.app?.backgroundImage})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        } : {}),
        '--chat-max-width': windowState.size.width <= 800 ? '75%'
          : windowState.size.width >= 1200 ? '85%'
          : '80%',
      } as React.CSSProperties}>
        {children}
      </div>
      {!windowState.isMaximized && (
        <>
          <div
            className="resize-handle resize-e"
            style={{
              position: 'absolute',
              right: 0,
              top: 36,
              bottom: 0,
              width: 6,
              cursor: 'e-resize',
            }}
            onMouseDown={(e) => handleResizeMouseDown(e, 'e')}
          />
          <div
            className="resize-handle resize-s"
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: 6,
              cursor: 's-resize',
            }}
            onMouseDown={(e) => handleResizeMouseDown(e, 's')}
          />
          <div
            className="resize-handle resize-se"
            style={{
              position: 'absolute',
              right: 0,
              bottom: 0,
              width: 12,
              height: 12,
              cursor: 'se-resize',
            }}
            onMouseDown={(e) => handleResizeMouseDown(e, 'se')}
          />
        </>
      )}
    </div>
  );
}

// 应用内容组件 - 聊天应用
interface ChatAppProps {
  appId: string;
  windowId: string;
  conversationId?: string;
}

/**
 * 聊天应用组件 - 完整的会话管理
 * 支持：多会话切换、新建、删除、重命名、消息发送与接收
 */
export function ChatApp({ appId, windowId, conversationId }: ChatAppProps) {