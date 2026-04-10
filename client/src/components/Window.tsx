import React, { useRef, useState, useEffect } from 'react';
import { useDesktop } from '../contexts/DesktopContext';
import type { WindowState, Message } from '../types';
import * as api from '../services/api';

const DEFAULT_ICON = 'data:image/svg+xml,' + encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <rect width="100" height="100" rx="20" fill="#0078d4"/>
    <text x="50" y="65" font-size="50" fill="white" text-anchor="middle">A</text>
  </svg>
`);

interface WindowProps {
  windowState: WindowState;
  children: React.ReactNode;
}

export function Window({ windowState, children }: WindowProps) {
  const { state, focusWindow, updateWindow } = useDesktop();
  const windowRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [resizeDirection, setResizeDirection] = useState('');

  const isFocused = state.focusedWindowId === windowState.id;

  useEffect(() => {
    if (isFocused && windowRef.current) {
      windowRef.current.style.zIndex = '9999';
    }
  }, [isFocused]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.target instanceof HTMLElement && e.target.closest('.window-control')) {
      return;
    }
    focusWindow(windowState.id);
  };

  const handleHeaderMouseDown = (e: React.MouseEvent) => {
    if (e.target instanceof HTMLElement && e.target.closest('.window-control')) {
      return;
    }
    e.preventDefault();
    setIsDragging(true);
    setDragOffset({
      x: e.clientX - windowState.position.x,
      y: e.clientY - windowState.position.y,
    });
    focusWindow(windowState.id);
  };

  const handleResizeMouseDown = (e: React.MouseEvent, direction: string) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    setResizeDirection(direction);
    focusWindow(windowState.id);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        updateWindow(windowState.id, {
          position: {
            x: e.clientX - dragOffset.x,
            y: e.clientY - dragOffset.y,
          },
        });
      }
      if (isResizing && resizeDirection) {
        const deltaX = e.clientX - (windowState.position.x + windowState.size.width);
        const deltaY = e.clientY - (windowState.position.y + windowState.size.height);

        let newWidth = windowState.size.width;
        let newHeight = windowState.size.height;

        if (resizeDirection.includes('e')) newWidth += deltaX;
        if (resizeDirection.includes('s')) newHeight += deltaY;
        if (resizeDirection.includes('w')) {
          newWidth -= deltaX;
        }
        if (resizeDirection.includes('n')) {
          newHeight -= deltaY;
        }

        newWidth = Math.max(state.settings.window.minSize.width, newWidth);
        newHeight = Math.max(state.settings.window.minSize.height, newHeight);

        updateWindow(windowState.id, {
          size: { width: newWidth, height: newHeight },
        });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizing(false);
      setResizeDirection('');
    };

    if (isDragging || isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, isResizing, dragOffset, resizeDirection, windowState, updateWindow, state.settings.window.minSize]);

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
        opacity: isFocused ? 1 : 0.9,
      }}
      onMouseDown={handleMouseDown}
    >
      <div className="window-header" onMouseDown={handleHeaderMouseDown}>
        <div className="window-controls">
          <div className="window-control close" onClick={() => useDesktop().closeWindow(windowState.id)} />
          <div className="window-control minimize" onClick={() => useDesktop().minimizeWindow(windowState.id)} />
          <div className="window-control maximize" onClick={() => useDesktop().maximizeWindow(windowState.id)} />
        </div>
        <div className="window-title">
          <img src={windowState.icon || DEFAULT_ICON} alt="" className="window-title-icon" />
          {windowState.title}
        </div>
        <div style={{ width: 52 }} />
      </div>
      <div className="window-content">
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

// App content components
interface ChatAppProps {
  appId: string;
  conversationId?: string;
}

export function ChatApp({ appId, conversationId }: ChatAppProps) {
  const [conversations, setConversations] = useState<{ id: string; title: string }[]>([]);
  const [currentConvId, setCurrentConvId] = useState<string | null>(conversationId || null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadConversations();
  }, [appId]);

  useEffect(() => {
    if (currentConvId) {
      loadMessages(currentConvId);
    }
  }, [currentConvId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadConversations = async () => {
    try {
      const convs = await api.getConversations(appId);
      setConversations(convs);
      if (convs.length > 0 && !currentConvId) {
        setCurrentConvId(convs[0].id);
      }
    } catch (error) {
      console.error('Failed to load conversations:', error);
    }
  };

  const loadMessages = async (convId: string) => {
    try {
      const conv = await api.getConversation(appId, convId);
      setMessages(conv.messages);
    } catch (error) {
      console.error('Failed to load messages:', error);
    }
  };

  const createNewConversation = async () => {
    try {
      const conv = await api.createConversation(appId, `会话 ${conversations.length + 1}`);
      setConversations([...conversations, { id: conv.id, title: conv.title }]);
      setCurrentConvId(conv.id);
      setMessages([]);
    } catch (error) {
      console.error('Failed to create conversation:', error);
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || !currentConvId || isLoading) return;

    const userMessage: Message = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: [{ type: 'text', text: input }],
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const { message } = await api.sendMessage(appId, currentConvId, [
        { type: 'text', text: input },
      ]);
      setMessages((prev) => [...prev.filter((m) => m.id !== userMessage.id), message]);
    } catch (error) {
      console.error('Failed to send message:', error);
      setMessages((prev) => prev.filter((m) => m.id !== userMessage.id));
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const getMessageText = (msg: Message): string => {
    return msg.content
      .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
      .map((c) => c.text)
      .join('');
  };

  return (
    <div className="app-chat">
      <div style={{ display: 'flex', gap: 8, padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        <button
          onClick={createNewConversation}
          style={{
            padding: '4px 12px',
            background: 'rgba(255,255,255,0.1)',
            border: 'none',
            borderRadius: 4,
            color: 'white',
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          新建会话
        </button>
        <select
          value={currentConvId || ''}
          onChange={(e) => setCurrentConvId(e.target.value || null)}
          style={{
            flex: 1,
            padding: '4px 8px',
            background: 'rgba(255,255,255,0.1)',
            border: 'none',
            borderRadius: 4,
            color: 'white',
            fontSize: 12,
          }}
        >
          {conversations.map((conv) => (
            <option key={conv.id} value={conv.id}>
              {conv.title}
            </option>
          ))}
        </select>
      </div>
      <div className="chat-messages">
        {messages.map((msg) => (
          <div key={msg.id} className={`chat-message ${msg.role}`}>
            <div className="chat-message-content">
              {getMessageText(msg)}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="chat-message assistant">
            <div className="chat-message-content">思考中...</div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      <div className="chat-input-area">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入消息..."
          disabled={!currentConvId || isLoading}
        />
        <button onClick={sendMessage} disabled={!currentConvId || isLoading || !input.trim()}>
          发送
        </button>
      </div>
    </div>
  );
}

interface SettingsAppProps {
  appId?: string;
}

export function SettingsApp(_props: SettingsAppProps) {
  const { state, updateSettings } = useDesktop();
  const [localSettings, setLocalSettings] = useState(state.settings);

  useEffect(() => {
    setLocalSettings(state.settings);
  }, [state.settings]);

  const handleThemeChange = async (theme: 'light' | 'dark' | 'auto') => {
    setLocalSettings({ ...localSettings, theme });
    await updateSettings({ theme });
  };

  return (
    <div className="settings-app">
      <div className="settings-section">
        <h3>外观</h3>
        <div className="settings-item">
          <label>主题</label>
          <select
            value={localSettings.theme}
            onChange={(e) => handleThemeChange(e.target.value as 'light' | 'dark' | 'auto')}
            style={{
              padding: '6px 12px',
              background: 'rgba(255,255,255,0.1)',
              border: 'none',
              borderRadius: 6,
              color: 'white',
            }}
          >
            <option value="light">浅色</option>
            <option value="dark">深色</option>
            <option value="auto">自动</option>
          </select>
        </div>
        <div className="settings-item">
          <label>Dock 放大效果</label>
          <input
            type="checkbox"
            checked={localSettings.dock.magnification}
            onChange={(e) => {
              const newDock = { ...localSettings.dock, magnification: e.target.checked };
              setLocalSettings({ ...localSettings, dock: newDock });
              updateSettings({ dock: newDock });
            }}
          />
        </div>
      </div>
      <div className="settings-section">
        <h3>窗口</h3>
        <div className="settings-item">
          <label>默认大小</label>
          <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
            {state.settings.window.defaultSize.width} x {state.settings.window.defaultSize.height}
          </span>
        </div>
      </div>
    </div>
  );
}
