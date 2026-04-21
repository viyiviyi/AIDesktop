import React, { useState, useRef, useEffect } from 'react';
import { useDesktop } from '../contexts/DesktopContext';
import type { AppInfo, Message } from '../types';
import * as api from '../services/api';

// 默认图标（蓝色方块带字母A）
const DEFAULT_ICON = 'data:image/svg+xml,' + encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <rect width="100" height="100" rx="20" fill="#0078d4"/>
    <text x="50" y="65" font-size="50" fill="white" text-anchor="middle">A</text>
  </svg>
`);

/**
 * 开始菜单组件
 * 显示桌面应用列表、搜索功能、内置对话助手
 */
export function StartMenu() {
  const { state, openApp, openSystemApp, closeStartMenu, refreshApps } = useDesktop();
  // 搜索关键词
  const [searchQuery, setSearchQuery] = useState('');
  // 对话消息列表
  const [messages, setMessages] = useState<Message[]>([]);
  // 输入框内容
  const [input, setInput] = useState('');
  // 加载状态
  const [isLoading, setIsLoading] = useState(false);
  // 当前会话ID
  const [conversationId, setConversationId] = useState<string | null>(null);
  // 消息列表底部引用（用于自动滚动）
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 筛选桌面应用
  const desktopApps = state.installedApps.filter((app) => app.type === 'desktop');

  // 打开菜单时初始化会话
  useEffect(() => {
    if (state.startMenuOpen && !conversationId) {
      initConversation();
    }
  }, [state.startMenuOpen]);

  // 新消息时自动滚动
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 初始化对话
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

  // 发送消息
  const handleSend = async () => {
    if (!input.trim() || !conversationId || isLoading) return;

    const messageText = input.trim();
    const userMessage: Message = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: [{ type: 'text', text: messageText }],
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const { message } = await api.sendMessage('desktop-assistant', conversationId, [
        { type: 'text', text: messageText },
      ]);
      setMessages((prev) => [...prev.filter((m) => m.id !== userMessage.id), message]);
    } catch (error) {
      console.error('Failed to send message:', error);
      setMessages((prev) => prev.filter((m) => m.id !== userMessage.id));
    } finally {
      setIsLoading(false);
    }
  };

  // 键盘事件处理
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // 点击应用图标
  const handleAppClick = (app: AppInfo) => {
    openApp(app);
    closeStartMenu();
  };

  // 点击遮罩层关闭菜单
  const handleOverlayClick = () => {
    closeStartMenu();
  };

  // 提取消息文本
  const getMessageText = (msg: Message): string => {
    return msg.content
      .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
      .map((c) => c.text)
      .join('');
  };

  // 根据搜索过滤应用
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
            <button title="刷新应用" onClick={async () => {
              await refreshApps();
            }}>
              🔄
            </button>
            <button title="搜索">
              🔍
            </button>
            <button title="文件" onClick={() => {
              const fileManager = state.installedApps.find((a) => a.id === 'file-manager');
              if (fileManager) handleAppClick(fileManager);
            }}>
              📁
            </button>
            <button title="设置" onClick={() => {
              openSystemApp('settings', '设置');
              closeStartMenu();
            }}>
              ⚙️
            </button>
            <button title="应用管理" onClick={() => {
              openSystemApp('settings-main', '应用管理');
              closeStartMenu();
            }}>
              📦
            </button>
            <button title="回收站" onClick={() => {
              const trash = state.installedApps.find((a) => a.id === 'trash');
              if (trash) handleAppClick(trash);
            }}>
              🗑️
            </button>
            <button title="日志 (Ctrl+L)" onClick={() => {
              openSystemApp('logs', '日志');
              closeStartMenu();
            }}>
              📋
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
