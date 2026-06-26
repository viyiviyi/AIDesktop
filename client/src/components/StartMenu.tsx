import { useState, useRef, useEffect, useCallback } from 'react';
import { useDesktop } from '../contexts/DesktopContext';
import type { AppInfo, Message } from '../types';
import * as api from '../services/api';
import { InjectionBar } from './InjectionBar';
import { useAgentEventStream, type WsConvEvent } from '../services/useAgentEventStream';

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
  // 流式消息状态
  const [streamingText, setStreamingText] = useState('');
  const [thinkingText, setThinkingText] = useState('');
  const currentConvIdRef = useRef<string | null>(null);
  // 保持 convId ref 同步
  currentConvIdRef.current = conversationId;

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
        // 还原上次会话，如果没有则取最新（convs[0]）
        const savedId = sessionStorage.getItem('startmenu_last_conv');
        const target = savedId && convs.find(c => c.id === savedId) ? savedId : convs[0].id;
        setConversationId(target);
        await loadMessages(target);
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
      // 更新会话标题（根据消息自动计算）
      setConversations(prev => prev.map(c =>
        c.id === convId ? { ...c, title: getConvTitle({ id: convId, title: c.title, messages: conv.messages }) } : c
      ));
    } catch (error) {
      console.error('Failed to load messages:', error);
    }
  };

  // 切换会话
  const switchConversation = async (convId: string) => {
    sessionStorage.setItem('startmenu_last_conv', convId);
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

  // 发送消息 — WebSocket 事件驱动模式
  const handleSend = async () => {
    if (!input.trim() || !conversationId || isLoading) return;

    const messageText = input.trim();
    setInput('');
    setIsLoading(true);
    setStreamingText('');
    setThinkingText('');

    try {
      const { userMessage } = await api.sendMessage(APP_ID, conversationId, [
        { type: 'text', text: messageText },
      ]);
      setMessages(prev => [...prev, userMessage]);
      setThinkingText('思考中...');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '发送消息失败';
      setInput(messageText);
      console.error('Failed to send message:', errorMsg);
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

  // WebSocket 事件处理器 — 流式回复
  const handleAgentEvent = useCallback((event: WsConvEvent) => {
    switch (event.type) {
      case 'thinking':
        setThinkingText((event.data.text as string) || '思考中...');
        break;
      case 'message_start':
        setThinkingText('');
        setStreamingText('');
        break;
      case 'text_chunk':
        setStreamingText(prev => prev + (event.data.text as string));
        setThinkingText('');
        break;
      case 'message_update': {
        const content = event.data.content as any[] || [];
        const texts = content.filter((c: any) => c.type === 'text').map((c: any) => c.text || '').join('');
        if (texts) {
          setStreamingText(texts);
          setThinkingText('');
        }
        break;
      }
      case 'message_end': {
        const content = (event.data.content || []) as any[];
        const text = content.filter((c: any) => c.type === 'text').map((c: any) => c.text || '').join('');
        const toolCallBlocks = content.filter((c: any) => c.type === 'toolCall');
        if (!text && toolCallBlocks.length === 0) {
          setStreamingText('');
          break;
        }
        const msgContent: any[] = [];
        if (text) msgContent.push({ type: 'text', text });
        for (const tc of toolCallBlocks) {
          msgContent.push({ type: 'toolCall', id: tc.id, name: tc.name, arguments: tc.arguments || {} });
        }
        const finalMsg: Message = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role: 'assistant',
          content: msgContent.length > 0 ? msgContent : [{ type: 'text', text: text || '' }],
          timestamp: new Date().toISOString(),
        };
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last && last.role === 'assistant' && !getMessageText(last)) {
            return [...prev.slice(0, -1), finalMsg];
          }
          return [...prev, finalMsg];
        });
        setStreamingText('');
        setThinkingText('');
        break;
      }
      case 'done': {
        setIsLoading(false);
        // 流式已通过事件累积了完整消息，done 后不再重新加载以避免布局抖动
        const cId = currentConvIdRef.current;
        if (cId) {
          // 只更新会话标题（异步，不阻塞渲染）
          api.getConversation(APP_ID, cId).then(conv => {
            if (conv) {
              setConversations(prev => prev.map(c =>
                c.id === cId ? { ...c, title: getConvTitle({ id: cId, title: c.title, messages: conv.messages }) } : c
              ));
            }
          }).catch(() => {});
        }
        break;
      }
      case 'error':
        setStreamingText('');
        setThinkingText('');
        setIsLoading(false);
        break;
    }
  }, []);

  // 连接 WebSocket 事件流
  useAgentEventStream(APP_ID, conversationId ?? undefined, handleAgentEvent);

  // 从消息中自动计算会话标题
  const getConvTitle = (conv: { id: string; title: string; messages?: Message[] }) => {
    if (!conv.messages || conv.messages.length === 0) return conv.title || '新会话';
    const msgs = conv.messages;
    // 找第一条 user 消息
    const firstUser = msgs.find(m => m.role === 'user');
    if (firstUser) {
      const text = getMessageText(firstUser).trim();
      if (text.length >= 4) return text.slice(0, 150);
    }
    // user 消息不够长，找第一条 assistant 消息
    const firstAssistant = msgs.find(m => m.role === 'assistant');
    if (firstAssistant) {
      const text = getMessageText(firstAssistant).trim();
      if (text.length > 0) return text.slice(0, 50);
    }
    return conv.title || '新会话';
  };

  // 获取当前会话标题
  const currentConvTitle = (() => {
    const conv = conversations.find(c => c.id === conversationId);
    if (!conv) return '选择会话';
    // 如果已经 loadMessages 了，就基于当前 messages 重新计算
    return getConvTitle({ id: conv.id, title: conv.title, messages });
  })();

  // 当前会话的下拉展开状态
  const [showConvDropdown, setShowConvDropdown] = useState(false);
  const convDropdownRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭下拉
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (convDropdownRef.current && !convDropdownRef.current.contains(e.target as Node)) {
        setShowConvDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

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
          {displayedApps.length > 0 && (
            <>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', padding: '4px 12px 8px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                应用
              </div>
              {displayedApps.slice(0, 12).map((app) => (
                <div
                  key={app.id}
                  className="start-menu-app-item"
                  onClick={() => handleAppClick(app)}
                >
                  <img
                    src={app.icon || DEFAULT_ICON}
                    alt={app.name}
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = DEFAULT_ICON;
                    }}
                  />
                  <div className="app-item-info">
                    <span className="app-item-name">{app.name}</span>
                    <span className="app-item-desc">{app.description}</span>
                  </div>
                </div>
              ))}
            </>
          )}
          {displayedApps.length === 0 && searchQuery && (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center', padding: 20 }}>
              未找到匹配的应用
            </div>
          )}
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
          {/* 会话标题栏 — 点击弹出下拉选择 */}
          <div className="start-menu-conv-title" ref={convDropdownRef}>
            <div
              className="start-menu-conv-title-bar"
              onClick={() => setShowConvDropdown(!showConvDropdown)}
            >
              <span className="start-menu-conv-title-text">{currentConvTitle}</span>
              <span className="start-menu-conv-title-arrow">{showConvDropdown ? '▲' : '▼'}</span>
            </div>
            {showConvDropdown && (
              <div className="start-menu-conv-dropdown">
                <div className="start-menu-conv-item new" onClick={() => { createNewConversation(); setShowConvDropdown(false); }}>
                  + 新会话
                </div>
                {conversations.map((conv) => (
                  <div
                    key={conv.id}
                    className={`start-menu-conv-item ${conv.id === conversationId ? 'active' : ''}`}
                    onClick={() => {
                      switchConversation(conv.id);
                      setShowConvDropdown(false);
                    }}
                  >
                    {conv.title}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="start-menu-conversation">
            {messages.map((msg) => (
              <div key={msg.id} className={`chat-message ${msg.role}`}>
                <div className="chat-message-content">
                  {getMessageText(msg)}
                </div>
              </div>
            ))}
            {/* 流式加载中 */}
            {isLoading && (
              <div className="chat-message assistant">
                {thinkingText && (
                  <div className="chat-message-thinking">
                    <span className="thinking-icon">◇</span>
                    {thinkingText}
                  </div>
                )}
                {streamingText && (
                  <div className="chat-message-content">
                    {streamingText}
                    <span className="streaming-cursor">|</span>
                  </div>
                )}
                {!streamingText && !thinkingText && (
                  <div className="chat-message-content">
                    <span className="thinking-dots">思考中<span>.</span><span>.</span><span>.</span></span>
                  </div>
                )}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
          <InjectionBar appId={APP_ID} convId={conversationId} />
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