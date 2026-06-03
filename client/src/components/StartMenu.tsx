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

const APP_ID = 'desktop-assistant';

/**
 * 开始菜单组件
 * - 每次打开时加载最新会话
 * - 发送消息后更新会话列表
 * - 点击应用图标启动应用
 */
export function StartMenu() {
  const { state, openApp, openSystemApp, closeStartMenu, refreshApps } = useDesktop();
  const [searchQuery, setSearchQuery] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<{ id: string; title: string }[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const desktopApps = state.installedApps.filter((app) => app.type === 'desktop');

  // 每次打开菜单时加载会话数据
  useEffect(() => {
    if (state.startMenuOpen) {
      loadConversations();
    }
  }, [state.startMenuOpen]);

  // 消息变更时自动滚动
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 加载会话列表并打开最新会话
  const loadConversations = async () => {
    try {
      const convs = await api.getConversations(APP_ID);
      setConversations(convs);
      if (convs.length > 0) {
        // 加载最新会话
        const latest = convs[convs.length - 1];
        setConversationId(latest.id);
        await loadMessages(latest.id);
      } else {
        // 无会话时创建新会话并显示欢迎语
        const conv = await api.createConversation(APP_ID, '开始菜单对话');
        setConversationId(conv.id);
        setConversations([{ id: conv.id, title: conv.title }]);
        setMessages([
          {
            id: 'welcome',
            role: 'assistant',
            content: [{ type: 'text', text: '你好！我是桌面助手。有什么可以帮助你的吗？' }],
            timestamp: new Date().toISOString(),
          },
        ]);
      }
    } catch (error) {
      console.error('Failed to load conversations:', error);
    }
  };

  // 加载指定会话的消息
  const loadMessages = async (convId: string) => {
    try {
      const conv = await api.getConversation(APP_ID, convId);
      setMessages(conv.messages);
    } catch (error) {
      console.error('Failed to load messages:', error);
    }
  };

  // 切换会话
  const switchConversation = async (convId: string) => {
    setConversationId(convId);
    setIsLoading(true);
    await loadMessages(convId);
    setIsLoading(false);
  };

  // 创建新会话
  const createNewConversation = async () => {
    try {
      const conv = await api.createConversation(APP_ID, `会话 ${conversations.length + 1}`);
      setConversations([...conversations, { id: conv.id, title: conv.title }]);
      setConversationId(conv.id);
      setMessages([]);
    } catch (error) {
      console.error('Failed to create conversation:', error);
    }
  };

  // 发送消息（非流式）
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
      await api.sendMessage(APP_ID, conversationId, [
        { type: 'text', text: messageText },
      ]);
      // 重新加载消息列表以确保同步
      await loadMessages(conversationId);
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
    openApp(app, { forceNew: true });
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
          {/* 会话切换栏 */}
          <div className="start-menu-conv-bar">
            <select
              value={conversationId || ''}
              onChange={(e) => switchConversation(e.target.value)}
              style={{
                flex: 1,
                padding: '2px 6px',
                background: 'var(--bg-primary)',
                border: '1px solid var(--border-primary)',
                borderRadius: 4,
                color: 'var(--text-primary)',
                fontSize: 11,
              }}
            >
              {conversations.map((conv) => (
                <option key={conv.id} value={conv.id}>
                  {conv.title}
                </option>
              ))}
            </select>
            <button
              onClick={createNewConversation}
              style={{
                padding: '2px 8px',
                background: 'var(--bg-primary)',
                border: '1px solid var(--border-primary)',
                borderRadius: 4,
                color: 'var(--text-primary)',
                cursor: 'pointer',
                fontSize: 11,
              }}
              title="新会话"
            >
              +
            </button>
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
            <button title="刷新应用" onClick={async () => { await refreshApps(); }}>
              🔄
            </button>
            <button title="搜索">🔍</button>
            <button title="文件" onClick={() => {
              const fm = state.installedApps.find((a) => a.id === 'file-manager');
              if (fm) handleAppClick(fm);
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
            <button title="日志" onClick={() => {
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
