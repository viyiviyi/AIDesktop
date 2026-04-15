import React, { useState, useRef, useEffect } from 'react';
import { useDesktop } from '../contexts/DesktopContext';
import type { AppInfo, Message } from '../types';
import * as api from '../services/api';

const DEFAULT_ICON = 'data:image/svg+xml,' + encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <rect width="100" height="100" rx="20" fill="#0078d4"/>
    <text x="50" y="65" font-size="50" fill="white" text-anchor="middle">A</text>
  </svg>
`);

export function StartMenu() {
  const { state, openApp, closeStartMenu } = useDesktop();
  const [searchQuery, setSearchQuery] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const desktopApps = state.installedApps.filter((app) => app.type === 'desktop');

  useEffect(() => {
    if (state.startMenuOpen && !conversationId) {
      initConversation();
    }
  }, [state.startMenuOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const initConversation = async () => {
    try {
      const conv = await api.createConversation('desktop-assistant', '开始菜单对话');
      setConversationId(conv.id);
      setMessages([
        {
          id: '1',
          role: 'assistant',
          content: [{ type: 'text', text: '你好！我是桌面助手。有什么可以帮助你的吗？' }],
          timestamp: new Date().toISOString(),
        },
      ]);
    } catch (error) {
      console.error('Failed to init conversation:', error);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || !conversationId || isLoading) return;

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
      const { message } = await api.sendMessage('desktop-assistant', conversationId, [
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
      handleSend();
    }
  };

  const handleAppClick = (app: AppInfo) => {
    openApp(app);
    closeStartMenu();
  };

  const handleOverlayClick = () => {
    closeStartMenu();
  };

  const getMessageText = (msg: Message): string => {
    return msg.content
      .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
      .map((c) => c.text)
      .join('');
  };

  const displayedApps = searchQuery
    ? desktopApps.filter((app) =>
        app.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        app.description.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : desktopApps;

  return (
    <>
      {state.startMenuOpen && <div className="start-menu-overlay" onClick={handleOverlayClick} />}
      <div className={`start-menu ${state.startMenuOpen ? 'visible' : ''}`}>
        <div className="start-menu-left">
          {displayedApps.slice(0, 6).map((app) => (
            <div
              key={app.id}
              className="start-menu-app-item"
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
              <span>{app.name}</span>
            </div>
          ))}
        </div>
        <div className="start-menu-right">
          <div className="start-menu-search">
            <input
              type="text"
              placeholder="搜索..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
          </div>
          <div className="start-menu-conversation">
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
          <div className="start-menu-input-area">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入消息..."
              disabled={isLoading}
            />
            <button onClick={handleSend} disabled={isLoading || !input.trim()}>
              发送
            </button>
          </div>
          <div className="start-menu-footer">
            <button title="搜索">
              <span>🔍</span> 搜索
            </button>
            <button title="文件" onClick={() => {
              const fileManager = state.installedApps.find((a) => a.id === 'file-manager');
              if (fileManager) handleAppClick(fileManager);
            }}>
              <span>📁</span> 文件
            </button>
            <button title="设置" onClick={() => {
              const settings = state.installedApps.find((a) => a.id === 'settings');
              if (settings) handleAppClick(settings);
            }}>
              <span>⚙️</span> 设置
            </button>
            <button title="回收站" onClick={() => {
              const trash = state.installedApps.find((a) => a.id === 'trash');
              if (trash) handleAppClick(trash);
            }}>
              <span>🗑️</span> 回收站
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
