import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useDesktop } from '../contexts/DesktopContext';
import { useToast } from '../contexts/ToastContext';
import type { WindowState, Message, ModelProvider, MCPConnection, Skill, AppInfo, App, ProviderModel } from '../types';
import * as api from '../services/api';
import { useAgentEventStream } from '../services/useAgentEventStream';
import type { WsConvEvent } from '../services/useAgentEventStream';

// 默认窗口图标（SVG格式的蓝色方块带字母A）
const DEFAULT_ICON = 'data:image/svg+xml,' + encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <rect width="100" height="100" rx="20" fill="#0078d4"/>
    <text x="50" y="65" font-size="50" fill="white" text-anchor="middle">A</text>
  </svg>
`);

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
        opacity: isFocused ? 1 : 0.9,
      }}
      onMouseDown={handleMouseDown}
    >
      <div className="window-header" onMouseDown={handleHeaderMouseDown}>
        <div style={{ width: 84 }} />
        <div className="window-title">
          <img src={windowState.icon || DEFAULT_ICON} alt="" className="window-title-icon" />
          {windowState.title}
        </div>
        <div className="window-controls">
          <div className="window-control minimize" onClick={() => minimizeWindow(windowState.id)} />
          <div className="window-control maximize" onClick={() => maximizeWindow(windowState.id)} />
          <div className="window-control close" onClick={() => closeWindow(windowState.id)} />
        </div>
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

// 应用内容组件 - 聊天应用
interface ChatAppProps {
  appId: string;
  conversationId?: string;
}

/**
 * 聊天应用组件 - 完整的会话管理
 * 支持：多会话切换、新建、删除、重命名、消息发送与接收
 */
export function ChatApp({ appId, conversationId }: ChatAppProps) {
  const { addToast } = useToast();
  const [conversations, setConversations] = useState<{ id: string; title: string; preview?: string }[]>([]);
  const [currentConvId, setCurrentConvId] = useState<string | null>(
    conversationId && !conversationId.startsWith('conv-') ? conversationId : null
  );
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showConvList, setShowConvList] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState('');
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  // 流式消息累积状态（WebSocket 事件驱动）
  const [streamingText, setStreamingText] = useState<string>('');
  const [toolCalls, setToolCalls] = useState<Array<{ toolCallId: string; toolName: string; args: unknown; result?: unknown; isError?: boolean }>>([]);
  const [thinkingText, setThinkingText] = useState<string>('');
  // 回复 & 编辑 & 分支状态
  const [replyToId, setReplyToId] = useState<string | null>(null);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editInput, setEditInput] = useState('');
  const [collapsedBranches, setCollapsedBranches] = useState<Set<string>>(new Set());
  // 跳转高亮消息 id
  const [highlightMsgId, setHighlightMsgId] = useState<string | null>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // WebSocket 事件处理器
  const handleAgentEvent = useCallback((event: WsConvEvent) => {
    switch (event.type) {
      case 'thinking':
        setThinkingText((event.data.text as string) || '思考中...');
        break;
      case 'message_start':
        // 开始新消息，重置累积
        setThinkingText('');
        setStreamingText('');
        setToolCalls([]);
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
      case 'tool_call':
        setToolCalls(prev => [...prev, {
          toolCallId: event.data.toolCallId as string,
          toolName: event.data.toolName as string,
          args: event.data.args,
        }]);
        break;
      case 'tool_result':
        setToolCalls(prev =>
          prev.map(tc =>
            tc.toolCallId === event.data.toolCallId
              ? { ...tc, result: event.data.result, isError: event.data.isError as boolean }
              : tc
          )
        );
        break;
      case 'message_end': {
        const content = event.data.content as any[] || [];
        const text = content.filter((c: any) => c.type === 'text').map((c: any) => c.text || '').join('');
        const finalMsg: Message = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role: 'assistant',
          content: [{ type: 'text', text: text || (event.data.text as string) || '' }],
          timestamp: new Date().toISOString(),
        };
        setMessages(prev => {
          // 如果最后一条是空 assistant，替换它
          const last = prev[prev.length - 1];
          if (last && last.role === 'assistant' && !getMessageText(last)) {
            return [...prev.slice(0, -1), finalMsg];
          }
          return [...prev, finalMsg];
        });
        setStreamingText('');
        setToolCalls([]);
        setThinkingText('');
        break;
      }
      case 'done':
        // 完成后重新加载同步
        setIsLoading(false);
        loadConversations(currentConvId);
        if (currentConvId) loadMessages(currentConvId);
        break;
      case 'error':
        addToast('error', `AI 回复失败: ${event.data.message as string}`);
        setIsLoading(false);
        break;
    }
  }, [addToast]);

  // 连接 WebSocket 事件流
  useAgentEventStream(appId ?? undefined, currentConvId ?? undefined, handleAgentEvent);

  // 加载会话列表
  useEffect(() => {
    loadConversations();
  }, [appId]);

  // 加载当前会话的消息
  useEffect(() => {
    if (currentConvId) {
      loadMessages(currentConvId);
    }
  }, [currentConvId]);

  // 新消息时自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 加载会话列表
  const loadConversations = async (preserveConvId?: string | null) => {
    try {
      const convs = await api.getConversations(appId);
      // 提取每个会话的最后一条用户消息作为预览（前100字）
      const mapped = convs.map(c => {
        const lastUserMsg = [...c.messages].reverse().find(m => m.role === 'user');
        const preview = lastUserMsg
          ? lastUserMsg.content
            .filter((x): x is { type: 'text'; text: string } => x.type === 'text')
            .map(x => x.text)
            .join('')
            .slice(0, 100)
          : undefined;
        return { id: c.id, title: c.title, preview };
      });
      setConversations(mapped);
      // 自动设置当前会话：优先用传入的 preserveConvId，否则用最后一个有消息的，否则用第一个
      const curId = preserveConvId !== undefined ? preserveConvId : currentConvId;
      if (!curId || !mapped.find(c => c.id === curId)) {
        const convsWithMsgs = convs.filter(c => c.messages.length > 0);
        const target = convsWithMsgs.length > 0 ? convsWithMsgs[convsWithMsgs.length - 1] : convs[0];
        if (target) {
          setCurrentConvId(target.id);
        }
      }
    } catch (error) {
      console.error('Failed to load conversations:', error);
    }
  };

  // 加载指定会话的消息
  const loadMessages = async (convId: string) => {
    try {
      const conv = await api.getConversation(appId, convId);
      setMessages(conv.messages);
    } catch (error) {
      console.error('Failed to load messages:', error);
    }
  };

  // 创建新会话
  const createNewConversation = async () => {
    try {
      const conv = await api.createConversation(appId, `会话 ${conversations.length + 1}`);
      setConversations([...conversations, { id: conv.id, title: conv.title }]);
      setCurrentConvId(conv.id);
      setMessages([]);
      setShowConvList(false);
    } catch (error) {
      console.error('Failed to create conversation:', error);
    }
  };

  // 删除会话
  const deleteConversation = async (convId: string) => {
    if (convId === currentConvId) {
      addToast('warning', '不能删除当前活跃的会话');
      return;
    }
    if (!confirm('确定要删除这个会话吗？')) return;
    try {
      await api.deleteConversation(appId, convId);
      const updated = conversations.filter((c) => c.id !== convId);
      setConversations(updated);
      setShowConvList(false);
      addToast('success', '会话已删除');
    } catch (error) {
      addToast('error', '删除会话失败');
    }
  };

  // 开始重命名
  const startRename = (convId: string, title: string) => {
    setRenamingId(convId);
    setRenameTitle(title);
  };

  // 提交重命名
  const submitRename = async () => {
    if (!renamingId || !renameTitle.trim()) {
      setRenamingId(null);
      return;
    }
    try {
      await api.updateConversationTitle(appId, renamingId, renameTitle.trim());
      setConversations(conversations.map((c) =>
        c.id === renamingId ? { ...c, title: renameTitle.trim() } : c
      ));
      setRenamingId(null);
      addToast('success', '会话已重命名');
    } catch (error) {
      addToast('error', '重命名失败');
    }
  };

  // 切换到指定会话
  const switchConversation = (convId: string) => {
    // WebSocket 自动切换订阅（useAgentEventStream 依赖 currentConvId）
    setCurrentConvId(convId);
    setShowConvList(false);
  };

  // 发送消息 — WebSocket 事件驱动模式
  const sendMessage = async (replyTo?: string) => {
    if (!input.trim() || !currentConvId || isLoading) return;

    const messageContent = input;
    setInput('');
    setIsLoading(true);
    setStreamingText('');
    setToolCalls([]);
    setThinkingText('');
    setReplyToId(null);

    try {
      const { userMessage } = await api.sendMessage(appId, currentConvId, [
        { type: 'text', text: messageContent },
      ], replyTo);

      setMessages(prev => [...prev, userMessage]);
      setThinkingText('思考中...');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '发送消息失败';
      setInput(messageContent);
      addToast('error', `发送失败: ${errorMsg}`);
      setIsLoading(false);
    }
  };

  // 回复
  const startReply = (msgId: string) => {
    setReplyToId(msgId);
    setEditingMsgId(null);
  };
  const cancelReply = () => setReplyToId(null);

  // 编辑
  const startEdit = (msg: Message) => {
    setEditingMsgId(msg.id);
    setEditInput(getMessageText(msg));
    setReplyToId(null);
  };
  const submitEdit = async () => {
    if (!editingMsgId || !currentConvId || !editInput.trim()) return;
    try {
      await api.editMessage(appId, currentConvId, editingMsgId, [{ type: 'text', text: editInput }]);
      setEditingMsgId(null);
      setEditInput('');
      if (currentConvId) loadMessages(currentConvId);
      addToast('success', '消息已编辑，生成了新分支');
    } catch (error) {
      addToast('error', '编辑失败');
    }
  };
  const cancelEdit = () => { setEditingMsgId(null); setEditInput(''); };

  // 分支折叠
  const toggleBranch = (branchRootId: string) => {
    setCollapsedBranches(prev => {
      const next = new Set(prev);
      if (next.has(branchRootId)) next.delete(branchRootId); else next.add(branchRootId);
      return next;
    });
  };

  // 跳转到消息
  const scrollToMsg = (msgId: string) => {
    const el = messageRefs.current.get(msgId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightMsgId(msgId);
      setTimeout(() => setHighlightMsgId(null), 2000);
    }
  };

  // 跳转引用
  const handleReplyClick = (replyTo: string) => scrollToMsg(replyTo);

  // 键盘事件处理 - Enter发送消息
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (editingMsgId) {
        submitEdit();
      } else {
        sendMessage(replyToId || undefined);
      }
    }
  };

  // 提取消息文本内容
  const getMessageText = (msg: Message): string => {
    return msg.content
      .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
      .map((c) => c.text)
      .join('');
  };

  const currentConvTitle = conversations.find((c) => c.id === currentConvId)?.title || '会话';

  return (
    <div className="app-chat">
      {/* 顶部标题栏 */}
      <div className="chat-header">
        <button className="chat-header-btn" onClick={() => setShowConvList(!showConvList)} title="会话列表">
          ☰
        </button>
        <span className="chat-header-title">{currentConvTitle}</span>
        <button className="chat-header-btn chat-header-btn-primary" onClick={createNewConversation} title="新建会话">
          +
        </button>
      </div>

      {/* 会话列表下拉面板 */}
      {showConvList && (
        <div className="chat-conv-list">
          {conversations.map((conv) => (
            <div
              key={conv.id}
              className={`chat-conv-item ${conv.id === currentConvId ? 'active' : ''}`}
              onClick={() => switchConversation(conv.id)}
            >
              {renamingId === conv.id ? (
                <input
                  className="chat-conv-rename-input"
                  value={renameTitle}
                  onChange={(e) => setRenameTitle(e.target.value)}
                  onBlur={submitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitRename();
                    if (e.key === 'Escape') setRenamingId(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  autoFocus
                />
              ) : (
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <div className="chat-conv-title">{conv.title}</div>
                  {conv.preview && (
                    <div className="chat-conv-preview">{conv.preview}</div>
                  )}
                </div>
              )}
              <div className="chat-conv-actions">
                {conv.id !== currentConvId && (
                  <button
                    className="chat-conv-action-btn"
                    onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id); }}
                    title="删除会话"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6"/>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                      <line x1="10" y1="11" x2="10" y2="17"/>
                      <line x1="14" y1="11" x2="14" y2="17"/>
                    </svg>
                  </button>
                )}
                <button
                  className="chat-conv-action-btn"
                  onClick={(e) => { e.stopPropagation(); startRename(conv.id, conv.title); }}
                  title="重命名"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </button>
              </div>
            </div>
          ))}
          {conversations.length === 0 && (
            <div className="chat-conv-empty">暂无会话，点击 + 新建</div>
          )}
        </div>
      )}

      {/* 消息列表 */}
      <div className="chat-messages">
        {(() => {
          // 计算分支信息：根据 replyTo 构建链
          // 找到被回复的消息（replyTo 指向的消息）之后的所有消息，按 replyTo 链分组
          // 主分支 = 没有 replyTo 或 replyTo 不在当前消息列表中的消息 + 从第一条回复链开始的最新链
          // 逻辑：消息按顺序排列，replyTo 链形成分支。如果某个消息的 replyTo 指向列表中的某条消息，
          // 它属于该消息的回复分支。分支起点是第一条有 replyTo 且指向列表中更早消息的消息。
          // 折叠逻辑：从某条消息之后的 reply 链可以折叠。

          const msgMap = new Map(messages.map(m => [m.id, m]));
          // 构建分支：对于每条有 replyTo 的消息，找到它指向的消息
          // 分支根节点 = 有 replyTo 且指向的消息也在列表中
          let firstBranchIdx = -1;
          for (let i = 0; i < messages.length; i++) {
            if (messages[i].replyTo && msgMap.has(messages[i].replyTo!)) {
              firstBranchIdx = i;
              break;
            }
          }

          return messages.map((msg, idx) => {
            const isBranch = firstBranchIdx >= 0 && idx >= firstBranchIdx;
            const isCollapsed = isBranch && collapsedBranches.has(messages[firstBranchIdx]?.id);
            const isBranchStart = idx === firstBranchIdx;
            const refCallback = (el: HTMLDivElement | null) => {
              if (el) messageRefs.current.set(msg.id, el);
              else messageRefs.current.delete(msg.id);
            };

            // 如果属于折叠分支，只显示分支的头部（第一条回复消息）
            if (isCollapsed && !isBranchStart) return null;

            const replyToMsg = msg.replyTo ? msgMap.get(msg.replyTo) : undefined;
            const isHighlight = highlightMsgId === msg.id;

            return (
              <React.Fragment key={msg.id}>
                {/* 分支折叠/展开按钮 */}
                {isBranchStart && (
                  <div className="branch-header">
                    <button
                      className="branch-toggle"
                      onClick={() => toggleBranch(messages[firstBranchIdx].id)}
                      title={collapsedBranches.has(messages[firstBranchIdx].id) ? '展开历史分支' : '折叠历史分支'}
                    >
                      {collapsedBranches.has(messages[firstBranchIdx].id) ? '↕' : '↑'}
                      <span className="branch-label">历史分支 ({messages.length - firstBranchIdx} 条消息)</span>
                    </button>
                  </div>
                )}

                {/* 引用条（回复了 xxx） */}
                {replyToMsg && (
                  <div
                    className="reply-reference"
                    onClick={() => handleReplyClick(msg.replyTo!)}
                    title="点击跳转到被回复的消息"
                  >
                    <span className="reply-ref-icon">↩</span>
                    <span className="reply-ref-text">
                      回复了 {replyToMsg.role === 'user' ? 'user' : 'assistant'}
                      : {getMessageText(replyToMsg).slice(0, 50)}
                    </span>
                  </div>
                )}

                {/* 消息主体 */}
                <div
                  ref={refCallback}
                  className={`chat-message ${msg.role} ${isHighlight ? 'highlight' : ''} ${msg.edited ? 'edited' : ''}`}
                >
                  <div className="chat-message-content">
                    {getMessageText(msg)}
                    {msg.edited && <span className="edited-badge"> (已编辑)</span>}
                  </div>

                  {/* 操作按钮 */}
                  <div className="chat-message-actions">
                    <button
                      className="msg-action-btn"
                      onClick={() => startReply(msg.id)}
                      title="回复此消息"
                    >↩</button>
                    {msg.role === 'user' && !msg.edited && (
                      <button
                        className="msg-action-btn"
                        onClick={() => startEdit(msg)}
                        title="编辑消息"
                      >✎</button>
                    )}
                  </div>
                </div>
              </React.Fragment>
            );
          });
        })()}

        {/* 流式加载中 — 显示 thinking / tool_call / tool_result / 流式文本 */}
        {isLoading && (
          <>
            {thinkingText && (
              <div className="chat-message assistant">
                <div className="chat-message-thinking">
                  <span className="thinking-icon">◇</span>
                  {thinkingText}
                </div>
              </div>
            )}
            {toolCalls.length > 0 && (
              <div className="chat-message assistant">
                <div className="chat-message-toolcalls">
                  {toolCalls.map((tc) => (
                    <div key={tc.toolCallId} className={`tool-call-item ${tc.isError ? 'tool-error' : ''}`}>
                      <div className="tool-call-header">
                        <span className="tool-call-icon">{tc.isError ? '✗' : tc.result ? '✓' : '◌'}</span>
                        <span className="tool-call-name">{tc.toolName}</span>
                      </div>
                      {!!tc.args && (
                        <pre className="tool-call-args">{String(JSON.stringify(tc.args, null, 2) || '')}</pre>
                      )}
                      {!!tc.result && (
                        <pre className="tool-call-result">
                          {String(typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result, null, 2))}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {streamingText && (
              <div className="chat-message assistant">
                <div className="chat-message-content streaming">
                  {streamingText}
                  <span className="streaming-cursor">|</span>
                </div>
              </div>
            )}
            {!streamingText && !thinkingText && toolCalls.length === 0 && (
              <div className="chat-message assistant">
                <div className="chat-message-content">
                  <span className="thinking-dots">思考中<span>.</span><span>.</span><span>.</span></span>
                </div>
              </div>
            )}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 输入区 */}
      <div className="chat-input-area">
        {/* 回复提示条 */}
        {replyToId && (() => {
          const replyMsg = messages.find(m => m.id === replyToId);
          return (
            <div className="reply-bar">
              <span className="reply-bar-icon">↩ 回复</span>
              <span className="reply-bar-text">{replyMsg ? getMessageText(replyMsg).slice(0, 60) : ''}</span>
              <button className="reply-bar-cancel" onClick={cancelReply}>✕</button>
            </div>
          );
        })()}

        {/* 编辑提示条 */}
        {editingMsgId && (
          <div className="reply-bar">
            <span className="reply-bar-icon">✎ 编辑消息</span>
            <button className="reply-bar-cancel" onClick={cancelEdit}>取消</button>
          </div>
        )}

        {editingMsgId ? (
          <>
            <input
              type="text"
              value={editInput}
              onChange={(e) => setEditInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="编辑消息..."
              autoFocus
            />
            <button onClick={submitEdit} disabled={!editInput.trim()}>保存</button>
          </>
        ) : (
          <>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={replyToId ? '输入回复...' : '输入消息...'}
              disabled={!currentConvId || isLoading}
            />
            <button onClick={() => sendMessage(replyToId || undefined)} disabled={!currentConvId || isLoading || !input.trim()}>
              发送
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// 设置应用属性接口
interface SettingsAppProps {
  appId?: string;
}

// 设置标签页类型
type SettingsTab = 'desktop' | 'model' | 'app' | 'mcp' | 'skill';

/**
 * 设置应用组件 - 提供系统设置界面
 * 支持桌面、模型、应用、MCP、技能等配置
 */
export function SettingsApp(_props: SettingsAppProps) {
  const { state, updateSettings, openSystemApp } = useDesktop();
  // 当前激活的标签页
  const [activeTab, setActiveTab] = useState<SettingsTab>('desktop');
  // 本地设置的副本（用于表单编辑）
  const [localSettings, setLocalSettings] = useState(state.settings);
  // 模型提供商列表
  const [modes, setModes] = useState<{ providers: ModelProvider[] }>({ providers: [] });
  // MCP连接列表
  const [mcpConnections, setMcpConnections] = useState<{ connections: MCPConnection[] }>({ connections: [] });
  // 技能列表
  const [skills, setSkills] = useState<{ skills: Skill[]; globalEnabled: boolean }>({ skills: [], globalEnabled: true });
  // 已安装的应用列表
  const [installedApps, setInstalledApps] = useState<AppInfo[]>([]);
  // 应用配置映射
  const [appConfigs, setAppConfigs] = useState<Record<string, App>>({});

  // 模型提供商管理状态
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [newProvider, setNewProvider] = useState<{
    id: string;
    name: string;
    apiType: 'openai' | 'anthropic' | 'custom';
    apiKey: string;
    baseUrl: string;
  }>({ id: '', name: '', apiType: 'openai', apiKey: '', baseUrl: '' });
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<ProviderModel[]>([]);
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const [defaultModel, setDefaultModel] = useState<{ providerId: string; modelId: string } | null>(null);
  const [showManualAddModel, setShowManualAddModel] = useState(false);
  const [manualModel, setManualModel] = useState<{ id: string; name: string; maxTokens: number; supportsText: boolean; supportsImage: boolean }>({ id: '', name: '', maxTokens: 128000, supportsText: true, supportsImage: false });

  // 编辑提供商状态
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    apiKey: string;
    baseUrl: string;
    enabled: boolean;
  }>({ apiKey: '', baseUrl: '', enabled: true });
  const [editFetchedModels, setEditFetchedModels] = useState<ProviderModel[]>([]);
  const [editSelectedModels, setEditSelectedModels] = useState<Set<string>>(new Set());
  const [editFetching, setEditFetching] = useState(false);
  const [editShowManualAddModel, setEditShowManualAddModel] = useState(false);
  const [editHeaderParams, setEditHeaderParams] = useState<import('../types').ModelParam[]>([]);
  const [editBodyParams, setEditBodyParams] = useState<import('../types').ModelParam[]>([]);
  const [editManualModel, setEditManualModel] = useState<{ id: string; name: string; maxTokens: number; supportsText: boolean; supportsImage: boolean }>({ id: '', name: '', maxTokens: 128000, supportsText: true, supportsImage: false });

  // 当全局设置变化时更新本地副本
  useEffect(() => {
    setLocalSettings(state.settings);
  }, [state.settings]);

  // 初始化加载数据
  useEffect(() => {
    loadModes();
    loadMcpSettings();
    loadSkillSettings();
    loadInstalledApps();
  }, []);

  // 加载模型提供商数据
  const loadModes = async () => {
    try {
      const [data, defaultModelConfig] = await Promise.all([
        api.getModes(),
        api.getDefaultModel()
      ]);
      setModes(data);
      setDefaultModel(defaultModelConfig);
    } catch (error) {
      console.error('Failed to load modes:', error);
    }
  };

  const handleSetDefaultModel = async (providerId: string, modelId: string) => {
    try {
      const updated = await api.updateDefaultModel({ providerId, modelId });
      setDefaultModel(updated);
    } catch (error) {
      console.error('Failed to set default model:', error);
    }
  };

  const handleFetchModels = async () => {
    if (!newProvider.apiKey || !newProvider.baseUrl) {
      alert('请先填写API Key和Base URL');
      return;
    }
    setFetchingModels(true);
    try {
      const result = await api.fetchModels(newProvider.apiKey, newProvider.baseUrl, newProvider.apiType);
      setFetchedModels(result.models);
    } catch (error) {
      console.error('Failed to fetch models:', error);
      alert('获取模型列表失败，请检查API配置');
    } finally {
      setFetchingModels(false);
    }
  };

  const handleToggleModel = (modelId: string) => {
    const newSelected = new Set(selectedModels);
    if (newSelected.has(modelId)) {
      newSelected.delete(modelId);
    } else {
      newSelected.add(modelId);
    }
    setSelectedModels(newSelected);
  };

  const handleAddManualModel = () => {
    if (!manualModel.id || !manualModel.name) {
      alert('请填写模型ID和名称');
      return;
    }
    const supports: ('text' | 'image')[] = [];
    if (manualModel.supportsText) supports.push('text');
    if (manualModel.supportsImage) supports.push('image');
    const newModel: ProviderModel = {
      id: manualModel.id,
      name: manualModel.name,
      maxTokens: manualModel.maxTokens,
      supports,
      params: { temperature: 0.7, top_p: 0.9 }
    };
    setFetchedModels([...fetchedModels, newModel]);
    setSelectedModels(new Set([...selectedModels, newModel.id]));
    setManualModel({ id: '', name: '', maxTokens: 128000, supportsText: true, supportsImage: false });
    setShowManualAddModel(false);
  };

  const handleAddProvider = async () => {
    if (!newProvider.id || !newProvider.name) {
      alert('请填写提供商ID和名称');
      return;
    }

    const provider: ModelProvider = {
      id: newProvider.id,
      name: newProvider.name,
      apiType: newProvider.apiType,
      apiKey: newProvider.apiKey || '',
      baseUrl: newProvider.baseUrl || '',
      enabled: true,
      models: fetchedModels.filter(m => selectedModels.has(m.id))
    };

    try {
      const updated = await api.addProvider(provider);
      setModes(updated);
      setShowAddProvider(false);
      setNewProvider({ id: '', name: '', apiType: 'openai', apiKey: '', baseUrl: '' });
      setFetchedModels([]);
      setSelectedModels(new Set());
    } catch (error) {
      console.error('Failed to add provider:', error);
      alert('添加提供商失败');
    }
  };

  const handleUpdateProvider = async (providerId: string, updates: Partial<ModelProvider>) => {
    const provider = modes.providers.find(p => p.id === providerId);
    if (!provider) return;
    const updated = { ...provider, ...updates };
    try {
      const result = await api.updateProvider(providerId, updated);
      setModes(result);
    } catch (error) {
      console.error('Failed to update provider:', error);
    }
  };

  const handleDeleteProvider = async (providerId: string) => {
    if (!confirm('确定要删除这个提供商吗？')) return;
    try {
      const result = await api.deleteProvider(providerId);
      setModes(result);
    } catch (error) {
      console.error('Failed to delete provider:', error);
    }
  };

  const handleStartEditProvider = (provider: ModelProvider) => {
    setEditingProvider(provider.id);
    setEditForm({
      apiKey: provider.apiKey || '',
      baseUrl: provider.baseUrl || '',
      enabled: provider.enabled
    });
    setEditFetchedModels(provider.models);
    setEditSelectedModels(new Set(provider.models.map(m => m.id)));
    setEditHeaderParams(provider.models[0]?.headerParams || []);
    setEditBodyParams(provider.models[0]?.bodyParams || []);
  };

  const handleCancelEditProvider = () => {
    setEditingProvider(null);
    setEditForm({ apiKey: '', baseUrl: '', enabled: true });
    setEditFetchedModels([]);
    setEditSelectedModels(new Set());
  };

  const handleFetchEditModels = async () => {
    if (!editForm.apiKey || !editForm.baseUrl) {
      alert('请先填写API Key和Base URL');
      return;
    }
    const provider = modes.providers.find(p => p.id === editingProvider);
    if (!provider) return;

    setEditFetching(true);
    try {
      const result = await api.fetchModels(editForm.apiKey, editForm.baseUrl, provider.apiType);
      setEditFetchedModels(result.models);
    } catch (error) {
      console.error('Failed to fetch models:', error);
      alert('获取模型列表失败，请检查API配置');
    } finally {
      setEditFetching(false);
    }
  };

  const handleToggleEditModel = (modelId: string) => {
    const newSelected = new Set(editSelectedModels);
    if (newSelected.has(modelId)) {
      newSelected.delete(modelId);
    } else {
      newSelected.add(modelId);
    }
    setEditSelectedModels(newSelected);
  };

  const handleEditAddManualModel = () => {
    if (!editManualModel.id || !editManualModel.name) {
      alert('请填写模型ID和名称');
      return;
    }
    const supports: ('text' | 'image')[] = [];
    if (editManualModel.supportsText) supports.push('text');
    if (editManualModel.supportsImage) supports.push('image');
    const newModel: ProviderModel = {
      id: editManualModel.id,
      name: editManualModel.name,
      maxTokens: editManualModel.maxTokens,
      supports,
      params: { temperature: 0.7, top_p: 0.9 }
    };
    setEditFetchedModels([...editFetchedModels, newModel]);
    setEditSelectedModels(new Set([...editSelectedModels, newModel.id]));
    setEditManualModel({ id: '', name: '', maxTokens: 128000, supportsText: true, supportsImage: false });
    setEditShowManualAddModel(false);
  };

  const handleSaveEditProvider = async () => {
    if (!editingProvider) return;
    const provider = modes.providers.find(p => p.id === editingProvider);
    if (!provider) return;

    const updatedProvider: ModelProvider = {
      ...provider,
      apiKey: editForm.apiKey,
      baseUrl: editForm.baseUrl,
      enabled: editForm.enabled,
      models: editFetchedModels.filter(m => editSelectedModels.has(m.id)).map(m => ({
        ...m,
        headerParams: editHeaderParams,
        bodyParams: editBodyParams,
      }))
    };

    try {
      const result = await api.updateProvider(editingProvider, updatedProvider);
      setModes(result);
      handleCancelEditProvider();
    } catch (error) {
      console.error('Failed to update provider:', error);
      alert('更新提供商失败');
    }
  };

  const loadMcpSettings = async () => {
    try {
      const data = await api.getMcpSettings();
      setMcpConnections(data);
    } catch (error) {
      console.error('Failed to load MCP settings:', error);
    }
  };

  const loadSkillSettings = async () => {
    try {
      const data = await api.getSkillSettings();
      setSkills(data);
    } catch (error) {
      console.error('Failed to load skill settings:', error);
    }
  };

  const loadInstalledApps = async () => {
    try {
      const apps = await api.getApps();
      setInstalledApps(apps);

      // Load full config for each app to get model settings
      const configs: Record<string, App> = {};
      for (const app of apps) {
        try {
          const fullApp = await api.getApp(app.id);
          configs[app.id] = fullApp;
        } catch {
          // Create a minimal App object if getApp fails
          configs[app.id] = {
            ...app,
            models: [],
            supportedInputs: ['text'],
            inputDescription: '',
            outputDescription: '',
            visibleApps: [],
            visibleServices: [],
            tools: []
          };
        }
      }
      setAppConfigs(configs);
    } catch (error) {
      console.error('Failed to load apps:', error);
    }
  };

  const handleThemeChange = async (theme: 'light' | 'dark' | 'auto') => {
    setLocalSettings({ ...localSettings, theme });
    await updateSettings({ theme });
  };

  const handleMcpUpdate = async (newMcp: typeof mcpConnections) => {
    try {
      const updated = await api.updateMcpSettings(newMcp);
      setMcpConnections(updated);
    } catch (error) {
      console.error('Failed to update MCP settings:', error);
    }
  };

  const handleSkillUpdate = async (newSkills: typeof skills) => {
    try {
      const updated = await api.updateSkillSettings(newSkills);
      setSkills(updated);
    } catch (error) {
      console.error('Failed to update skill settings:', error);
    }
  };

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: 'desktop', label: '桌面' },
    { id: 'model', label: '模型' },
    { id: 'app', label: '应用' },
    { id: 'mcp', label: 'MCP' },
    { id: 'skill', label: '技能' },
  ];

  const renderTabContent = () => {
    switch (activeTab) {
      case 'desktop':
        return (
          <>
            <div className="settings-section">
              <h3>外观</h3>
              <div className="settings-item">
                <label>主题</label>
                <select
                  value={localSettings.theme}
                  onChange={(e) => handleThemeChange(e.target.value as 'light' | 'dark' | 'auto')}
                  style={{
                    padding: '6px 12px',
                    background: 'var(--bg-primary)',
                    border: 'none',
                    borderRadius: 6,
                    color: 'var(--text-primary)',
                  }}
                >
                  <option value="light">浅色</option>
                  <option value="dark">深色</option>
                  <option value="auto">自动</option>
                </select>
              </div>
              <div className="settings-item">
                <label>壁纸</label>
                <input
                  type="text"
                  value={localSettings.wallpaper}
                  onChange={(e) => setLocalSettings({ ...localSettings, wallpaper: e.target.value })}
                  onBlur={() => updateSettings({ wallpaper: localSettings.wallpaper })}
                  style={{
                    padding: '6px 12px',
                    background: 'var(--bg-primary)',
                    border: 'none',
                    borderRadius: 6,
                    color: 'var(--text-primary)',
                    width: 200,
                  }}
                />
              </div>
            </div>
            <div className="settings-section">
              <h3>Dock</h3>
              <div className="settings-item">
                <label>位置</label>
                <select
                  value={localSettings.dock.position}
                  onChange={(e) => {
                    const newDock = { ...localSettings.dock, position: e.target.value as 'bottom' | 'left' | 'right' };
                    setLocalSettings({ ...localSettings, dock: newDock });
                    updateSettings({ dock: newDock });
                  }}
                  style={{
                    padding: '6px 12px',
                    background: 'var(--bg-primary)',
                    border: 'none',
                    borderRadius: 6,
                    color: 'var(--text-primary)',
                  }}
                >
                  <option value="bottom">底部</option>
                  <option value="left">左侧</option>
                  <option value="right">右侧</option>
                </select>
              </div>
              <div className="settings-item">
                <label>放大效果</label>
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
              <div className="settings-item">
                <label>自动隐藏</label>
                <input
                  type="checkbox"
                  checked={localSettings.dock.autoHide}
                  onChange={(e) => {
                    const newDock = { ...localSettings.dock, autoHide: e.target.checked };
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
            <div className="settings-section">
              <h3>菜单栏</h3>
              <div className="settings-item">
                <label>自动隐藏</label>
                <input
                  type="checkbox"
                  checked={localSettings.menuBar.autoHide}
                  onChange={(e) => {
                    const newMenuBar = { ...localSettings.menuBar, autoHide: e.target.checked };
                    setLocalSettings({ ...localSettings, menuBar: newMenuBar });
                    updateSettings({ menuBar: newMenuBar });
                  }}
                />
              </div>
            </div>
          </>
        );

      case 'model':
        return (
          <div className="settings-section">
            {/* Default Model Configuration */}
            <div style={{ marginBottom: 20, padding: 16, background: 'var(--bg-tertiary)', borderRadius: 8, border: '1px solid var(--border-primary)' }}>
              <h4 style={{ margin: '0 0 12px 0', color: 'var(--text-primary)' }}>默认模型</h4>
              <p style={{ color: 'var(--text-secondary)', fontSize: 12, margin: '0 0 12px 0' }}>
                设置系统默认使用的模型，可被应用设置中的模型配置覆盖
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>提供商</label>
                  <select
                    value={defaultModel?.providerId || ''}
                    onChange={(e) => {
                      const providerId = e.target.value;
                      const provider = modes.providers.find(p => p.id === providerId);
                      if (provider && provider.models.length > 0) {
                        handleSetDefaultModel(providerId, provider.models[0].id);
                      } else {
                        handleSetDefaultModel(providerId, '');
                      }
                    }}
                    style={{
                      padding: '8px 12px',
                      background: 'var(--bg-primary)',
                      border: '1px solid var(--border-secondary)',
                      borderRadius: 6,
                      color: 'var(--text-primary)',
                      width: '100%',
                      boxSizing: 'border-box',
                    }}
                  >
                    <option value="">选择提供商...</option>
                    {modes.providers.filter(p => p.enabled && p.models.length > 0).map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>模型</label>
                  <select
                    value={defaultModel?.modelId || ''}
                    onChange={(e) => {
                      if (defaultModel?.providerId) {
                        handleSetDefaultModel(defaultModel.providerId, e.target.value);
                      }
                    }}
                    disabled={!defaultModel?.providerId}
                    style={{
                      padding: '8px 12px',
                      background: 'var(--bg-primary)',
                      border: '1px solid var(--border-secondary)',
                      borderRadius: 6,
                      color: 'var(--text-primary)',
                      width: '100%',
                      boxSizing: 'border-box',
                      opacity: defaultModel?.providerId ? 1 : 0.5,
                    }}
                  >
                    <option value="">选择模型...</option>
                    {defaultModel?.providerId && (
                      modes.providers.find(p => p.id === defaultModel.providerId)?.models.map((m) => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))
                    )}
                  </select>
                </div>
              </div>
              {defaultModel?.providerId && defaultModel?.modelId && (
                <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
                  当前默认: {modes.providers.find(p => p.id === defaultModel.providerId)?.name} / {modes.providers.find(p => p.id === defaultModel.providerId)?.models.find(m => m.id === defaultModel.modelId)?.name}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0 }}>模型提供商</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: 12, margin: '4px 0 0 0' }}>
                  添加API兼容的模型服务商，配置API Key后获取可用模型
                </p>
              </div>
              <button
                onClick={() => setShowAddProvider(!showAddProvider)}
                style={{
                  padding: '8px 16px',
                  background: 'var(--accent-color)',
                  border: 'none',
                  borderRadius: 6,
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                {showAddProvider ? '取消添加' : '+ 添加提供商'}
              </button>
            </div>

            {/* Add Provider Form */}
            {showAddProvider && (
              <div style={{ marginBottom: 20, padding: 16, background: 'var(--bg-tertiary)', borderRadius: 8, border: '1px solid var(--border-primary)' }}>
                <h4 style={{ margin: '0 0 12px 0', color: 'var(--text-primary)' }}>添加新提供商</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <div>
                    <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>ID (英文唯一标识)</label>
                    <input
                      type="text"
                      value={newProvider.id}
                      onChange={(e) => setNewProvider({ ...newProvider, id: e.target.value.toLowerCase().replace(/\s/g, '-') })}
                      placeholder="e.g., my-provider"
                      style={{
                        padding: '8px 12px',
                        background: 'var(--bg-primary)',
                        border: '1px solid var(--border-secondary)',
                        borderRadius: 6,
                        color: 'var(--text-primary)',
                        width: '100%',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>名称 (显示名)</label>
                    <input
                      type="text"
                      value={newProvider.name}
                      onChange={(e) => setNewProvider({ ...newProvider, name: e.target.value })}
                      placeholder="e.g., 我的API"
                      style={{
                        padding: '8px 12px',
                        background: 'var(--bg-primary)',
                        border: '1px solid var(--border-secondary)',
                        borderRadius: 6,
                        color: 'var(--text-primary)',
                        width: '100%',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <div>
                    <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>API类型</label>
                    <select
                      value={newProvider.apiType}
                      onChange={(e) => setNewProvider({ ...newProvider, apiType: e.target.value as 'openai' | 'anthropic' | 'custom' })}
                      style={{
                        padding: '8px 12px',
                        background: 'var(--bg-primary)',
                        border: '1px solid var(--border-secondary)',
                        borderRadius: 6,
                        color: 'var(--text-primary)',
                        width: '100%',
                        boxSizing: 'border-box',
                      }}
                    >
                      <option value="openai">OpenAI兼容</option>
                      <option value="anthropic">Anthropic兼容</option>
                      <option value="custom">自定义</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>API Key</label>
                    <input
                      type="password"
                      value={newProvider.apiKey}
                      onChange={(e) => setNewProvider({ ...newProvider, apiKey: e.target.value })}
                      placeholder="sk-..."
                      style={{
                        padding: '8px 12px',
                        background: 'var(--bg-primary)',
                        border: '1px solid var(--border-secondary)',
                        borderRadius: 6,
                        color: 'var(--text-primary)',
                        width: '100%',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>Base URL</label>
                    <input
                      type="text"
                      value={newProvider.baseUrl}
                      onChange={(e) => setNewProvider({ ...newProvider, baseUrl: e.target.value })}
                      placeholder="https://api.example.com/v1"
                      style={{
                        padding: '8px 12px',
                        background: 'var(--bg-primary)',
                        border: '1px solid var(--border-secondary)',
                        borderRadius: 6,
                        color: 'var(--text-primary)',
                        width: '100%',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <button
                    onClick={handleFetchModels}
                    disabled={fetchingModels || !newProvider.apiKey || !newProvider.baseUrl}
                    style={{
                      padding: '8px 16px',
                      background: fetchingModels ? 'var(--bg-secondary)' : 'var(--bg-primary)',
                      border: 'none',
                      borderRadius: 6,
                      color: 'var(--text-primary)',
                      cursor: fetchingModels ? 'not-allowed' : 'pointer',
                      fontSize: 13,
                    }}
                  >
                    {fetchingModels ? '获取中...' : '获取可用模型'}
                  </button>
                  {fetchedModels.length > 0 && (
                    <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                      获取到 {fetchedModels.length} 个模型，请勾选要启用的模型
                    </span>
                  )}
                </div>

                {fetchedModels.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8, display: 'block' }}>选择要启用的模型：</label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, maxHeight: 150, overflowY: 'auto' }}>
                      {fetchedModels.map((model) => (
                        <label
                          key={model.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '6px 12px',
                            background: selectedModels.has(model.id) ? 'var(--success-bg)' : 'var(--bg-secondary)',
                            borderRadius: 4,
                            cursor: 'pointer',
                            fontSize: 12,
                            color: selectedModels.has(model.id) ? 'var(--success-color)' : 'var(--text-secondary)',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={selectedModels.has(model.id)}
                            onChange={() => handleToggleModel(model.id)}
                            style={{ display: 'none' }}
                          />
                          {model.name}
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {/* Manual Model Addition */}
                <div style={{ marginTop: 12, borderTop: '1px dashed var(--border-primary)', paddingTop: 12 }}>
                  {!showManualAddModel ? (
                    <button
                      onClick={() => setShowManualAddModel(true)}
                      style={{
                        padding: '6px 12px',
                        background: 'var(--bg-secondary)',
                        border: '1px dashed var(--border-secondary)',
                        borderRadius: 6,
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                        fontSize: 12,
                      }}
                    >
                      + 手动添加模型
                    </button>
                  ) : (
                    <div style={{ padding: 12, background: 'var(--bg-secondary)', borderRadius: 6 }}>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>手动添加模型</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 100px', gap: 8, marginBottom: 8 }}>
                        <input
                          type="text"
                          value={manualModel.id}
                          onChange={(e) => setManualModel({ ...manualModel, id: e.target.value })}
                          placeholder="模型ID (如 gpt-4)"
                          style={{
                            padding: '6px 10px',
                            background: 'var(--bg-primary)',
                            border: '1px solid var(--border-secondary)',
                            borderRadius: 4,
                            color: 'var(--text-primary)',
                            fontSize: 12,
                          }}
                        />
                        <input
                          type="text"
                          value={manualModel.name}
                          onChange={(e) => setManualModel({ ...manualModel, name: e.target.value })}
                          placeholder="显示名称"
                          style={{
                            padding: '6px 10px',
                            background: 'var(--bg-primary)',
                            border: '1px solid var(--border-secondary)',
                            borderRadius: 4,
                            color: 'var(--text-primary)',
                            fontSize: 12,
                          }}
                        />
                        <input
                          type="number"
                          value={manualModel.maxTokens}
                          onChange={(e) => setManualModel({ ...manualModel, maxTokens: parseInt(e.target.value) || 128000 })}
                          placeholder="最大Token"
                          style={{
                            padding: '6px 10px',
                            background: 'var(--bg-primary)',
                            border: '1px solid var(--border-secondary)',
                            borderRadius: 4,
                            color: 'var(--text-primary)',
                            fontSize: 12,
                          }}
                        />
                      </div>
                      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={manualModel.supportsText}
                            onChange={(e) => setManualModel({ ...manualModel, supportsText: e.target.checked })}
                          />
                          文本
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={manualModel.supportsImage}
                            onChange={(e) => setManualModel({ ...manualModel, supportsImage: e.target.checked })}
                          />
                          图像
                        </label>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          onClick={handleAddManualModel}
                          style={{
                            padding: '6px 12px',
                            background: 'var(--accent-color)',
                            border: 'none',
                            borderRadius: 4,
                            color: 'var(--text-primary)',
                            cursor: 'pointer',
                            fontSize: 12,
                          }}
                        >
                          添加
                        </button>
                        <button
                          onClick={() => {
                            setShowManualAddModel(false);
                            setManualModel({ id: '', name: '', maxTokens: 128000, supportsText: true, supportsImage: false });
                          }}
                          style={{
                            padding: '6px 12px',
                            background: 'var(--bg-primary)',
                            border: 'none',
                            borderRadius: 4,
                            color: 'var(--text-primary)',
                            cursor: 'pointer',
                            fontSize: 12,
                          }}
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button
                    onClick={() => {
                      setShowAddProvider(false);
                      setFetchedModels([]);
                      setSelectedModels(new Set());
                    }}
                    style={{
                      padding: '8px 16px',
                      background: 'var(--bg-primary)',
                      border: 'none',
                      borderRadius: 6,
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                      fontSize: 13,
                    }}
                  >
                    取消
                  </button>
                  <button
                    onClick={handleAddProvider}
                    disabled={!newProvider.id || !newProvider.name}
                    style={{
                      padding: '8px 16px',
                      background: newProvider.id && newProvider.name ? 'var(--accent-color)' : 'var(--bg-primary)',
                      border: 'none',
                      borderRadius: 6,
                      color: 'var(--text-primary)',
                      cursor: newProvider.id && newProvider.name ? 'pointer' : 'not-allowed',
                      fontSize: 13,
                    }}
                  >
                    {selectedModels.size === 0 ? '添加（稍后配置模型）' : '添加'}
                  </button>
                </div>
              </div>
            )}

            {/* Provider List */}
            {modes.providers.map((provider) => (
              <div key={provider.id} style={{ marginBottom: 20, padding: 16, background: editingProvider === provider.id ? 'var(--bg-primary)' : 'var(--bg-secondary)', borderRadius: 8, border: editingProvider === provider.id ? '1px solid var(--accent-color)' : '1px solid transparent' }}>
                {editingProvider === provider.id ? (
                  // Edit Mode
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <span style={{ color: 'var(--text-primary)', fontWeight: 500, fontSize: 15 }}>
                        编辑: {provider.name}
                      </span>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          onClick={handleCancelEditProvider}
                          style={{
                            padding: '6px 12px',
                            background: 'var(--bg-primary)',
                            border: 'none',
                            borderRadius: 4,
                            color: 'var(--text-primary)',
                            cursor: 'pointer',
                            fontSize: 12,
                          }}
                        >
                          取消
                        </button>
                        <button
                          onClick={handleSaveEditProvider}
                          style={{
                            padding: '6px 12px',
                            background: 'var(--accent-color)',
                            border: 'none',
                            borderRadius: 4,
                            color: 'var(--text-primary)',
                            cursor: 'pointer',
                            fontSize: 12,
                          }}
                        >
                          保存
                        </button>
                      </div>
                    </div>

                    <div style={{ marginBottom: 12 }}>
                      <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input
                          type="checkbox"
                          checked={editForm.enabled}
                          onChange={(e) => setEditForm({ ...editForm, enabled: e.target.checked })}
                        />
                        <span>启用此提供商</span>
                      </label>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                      <div>
                        <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>API Key</label>
                        <input
                          type="password"
                          value={editForm.apiKey}
                          onChange={(e) => setEditForm({ ...editForm, apiKey: e.target.value })}
                          placeholder="sk-..."
                          style={{
                            padding: '8px 12px',
                            background: 'var(--bg-primary)',
                            border: '1px solid var(--border-secondary)',
                            borderRadius: 6,
                            color: 'var(--text-primary)',
                            width: '100%',
                            boxSizing: 'border-box',
                          }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>Base URL</label>
                        <input
                          type="text"
                          value={editForm.baseUrl}
                          onChange={(e) => setEditForm({ ...editForm, baseUrl: e.target.value })}
                          placeholder="https://api.openai.com/v1"
                          style={{
                            padding: '8px 12px',
                            background: 'var(--bg-primary)',
                            border: '1px solid var(--border-secondary)',
                            borderRadius: 6,
                            color: 'var(--text-primary)',
                            width: '100%',
                            boxSizing: 'border-box',
                          }}
                        />
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
                      <button
                        onClick={handleFetchEditModels}
                        disabled={editFetching || !editForm.apiKey || !editForm.baseUrl}
                        style={{
                          padding: '8px 16px',
                          background: editFetching ? 'var(--bg-secondary)' : 'var(--bg-primary)',
                          border: 'none',
                          borderRadius: 6,
                          color: 'var(--text-primary)',
                          cursor: editFetching ? 'not-allowed' : 'pointer',
                          fontSize: 12,
                        }}
                      >
                        {editFetching ? '获取中...' : '重新获取模型列表'}
                      </button>
                      {editFetchedModels.length > 0 && (
                        <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                          已获取 {editFetchedModels.length} 个模型，请勾选要启用的
                        </span>
                      )}
                    </div>

                    {editFetchedModels.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8, display: 'block' }}>
                          选择要启用的模型：
                        </label>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, maxHeight: 150, overflowY: 'auto' }}>
                          {editFetchedModels.map((model) => (
                            <label
                              key={model.id}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                padding: '6px 12px',
                                background: editSelectedModels.has(model.id) ? 'var(--success-bg)' : 'var(--bg-secondary)',
                                borderRadius: 4,
                                cursor: 'pointer',
                                fontSize: 12,
                                color: editSelectedModels.has(model.id) ? 'var(--success-color)' : 'var(--text-secondary)',
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={editSelectedModels.has(model.id)}
                                onChange={() => handleToggleEditModel(model.id)}
                                style={{ display: 'none' }}
                              />
                              {model.name}
                            </label>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Manual Model Addition for Edit */}
                    <div style={{ marginTop: 12, borderTop: '1px dashed var(--border-primary)', paddingTop: 12 }}>
                      {!editShowManualAddModel ? (
                        <button
                          onClick={() => setEditShowManualAddModel(true)}
                          style={{
                            padding: '6px 12px',
                            background: 'var(--bg-secondary)',
                            border: '1px dashed var(--border-secondary)',
                            borderRadius: 6,
                            color: 'var(--text-secondary)',
                            cursor: 'pointer',
                            fontSize: 12,
                          }}
                        >
                          + 手动添加模型
                        </button>
                      ) : (
                        <div style={{ padding: 12, background: 'var(--bg-secondary)', borderRadius: 6 }}>
                          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>手动添加模型</div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 100px', gap: 8, marginBottom: 8 }}>
                            <input
                              type="text"
                              value={editManualModel.id}
                              onChange={(e) => setEditManualModel({ ...editManualModel, id: e.target.value })}
                              placeholder="模型ID (如 gpt-4)"
                              style={{
                                padding: '6px 10px',
                                background: 'var(--bg-primary)',
                                border: '1px solid var(--border-secondary)',
                                borderRadius: 4,
                                color: 'var(--text-primary)',
                                fontSize: 12,
                              }}
                            />
                            <input
                              type="text"
                              value={editManualModel.name}
                              onChange={(e) => setEditManualModel({ ...editManualModel, name: e.target.value })}
                              placeholder="显示名称"
                              style={{
                                padding: '6px 10px',
                                background: 'var(--bg-primary)',
                                border: '1px solid var(--border-secondary)',
                                borderRadius: 4,
                                color: 'var(--text-primary)',
                                fontSize: 12,
                              }}
                            />
                            <input
                              type="number"
                              value={editManualModel.maxTokens}
                              onChange={(e) => setEditManualModel({ ...editManualModel, maxTokens: parseInt(e.target.value) || 128000 })}
                              placeholder="最大Token"
                              style={{
                                padding: '6px 10px',
                                background: 'var(--bg-primary)',
                                border: '1px solid var(--border-secondary)',
                                borderRadius: 4,
                                color: 'var(--text-primary)',
                                fontSize: 12,
                              }}
                            />
                          </div>
                          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={editManualModel.supportsText}
                                onChange={(e) => setEditManualModel({ ...editManualModel, supportsText: e.target.checked })}
                              />
                              文本
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={editManualModel.supportsImage}
                                onChange={(e) => setEditManualModel({ ...editManualModel, supportsImage: e.target.checked })}
                              />
                              图像
                            </label>
                          </div>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button
                              onClick={handleEditAddManualModel}
                              style={{
                                padding: '6px 12px',
                                background: 'var(--accent-color)',
                                border: 'none',
                                borderRadius: 4,
                                color: 'var(--text-primary)',
                                cursor: 'pointer',
                                fontSize: 12,
                              }}
                            >
                              添加
                            </button>
                            <button
                              onClick={() => {
                                setEditShowManualAddModel(false);
                                setEditManualModel({ id: '', name: '', maxTokens: 128000, supportsText: true, supportsImage: false });
                              }}
                              style={{
                                padding: '6px 12px',
                                background: 'var(--bg-primary)',
                                border: 'none',
                                borderRadius: 4,
                                color: 'var(--text-primary)',
                                cursor: 'pointer',
                                fontSize: 12,
                              }}
                            >
                              取消
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Extra Parameters Section */}
                    <div style={{ marginTop: 12, borderTop: '1px dashed var(--border-primary)', paddingTop: 12 }}>
                      <h4 style={{ margin: '0 0 8px 0', fontSize: 13, color: 'var(--text-primary)' }}>附加参数</h4>
                      <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8 }}>
                        可选的 HTTP Header 和请求体参数，通过勾选控制是否启用。
                      </p>

                      {/* Header Params */}
                      <div style={{ marginBottom: 10 }}>
                        <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>Header 参数</label>
                        {editHeaderParams.map((param, i) => (
                          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                            <input type="checkbox" checked={param.enabled} onChange={() => {
                              const next = [...editHeaderParams];
                              next[i] = { ...next[i], enabled: !next[i].enabled };
                              setEditHeaderParams(next);
                            }} />
                            <input type="text" value={param.key} placeholder="Key" onChange={(e) => {
                              const next = [...editHeaderParams];
                              next[i] = { ...next[i], key: e.target.value };
                              setEditHeaderParams(next);
                            }} style={{ flex: 1, padding: '4px 8px', background: 'var(--input-bg)', border: '1px solid var(--border-primary)', borderRadius: 4, color: 'var(--text-primary)', fontSize: 12 }} />
                            <input type="text" value={param.value} placeholder="Value" onChange={(e) => {
                              const next = [...editHeaderParams];
                              next[i] = { ...next[i], value: e.target.value };
                              setEditHeaderParams(next);
                            }} style={{ flex: 1, padding: '4px 8px', background: 'var(--input-bg)', border: '1px solid var(--border-primary)', borderRadius: 4, color: 'var(--text-primary)', fontSize: 12 }} />
                            <button onClick={() => setEditHeaderParams(editHeaderParams.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: 'var(--error-color)', cursor: 'pointer', fontSize: 14 }}>×</button>
                          </div>
                        ))}
                        <button onClick={() => setEditHeaderParams([...editHeaderParams, { key: '', value: '', enabled: true }])} style={{ padding: '4px 10px', background: 'var(--bg-secondary)', border: '1px dashed var(--border-secondary)', borderRadius: 4, color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 11 }}>
                          + 添加 Header 参数
                        </button>
                      </div>

                      {/* Body Params */}
                      <div>
                        <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>Body 参数</label>
                        {editBodyParams.map((param, i) => (
                          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                            <input type="checkbox" checked={param.enabled} onChange={() => {
                              const next = [...editBodyParams];
                              next[i] = { ...next[i], enabled: !next[i].enabled };
                              setEditBodyParams(next);
                            }} />
                            <input type="text" value={param.key} placeholder="Key" onChange={(e) => {
                              const next = [...editBodyParams];
                              next[i] = { ...next[i], key: e.target.value };
                              setEditBodyParams(next);
                            }} style={{ flex: 1, padding: '4px 8px', background: 'var(--input-bg)', border: '1px solid var(--border-primary)', borderRadius: 4, color: 'var(--text-primary)', fontSize: 12 }} />
                            <input type="text" value={param.value} placeholder="Value" onChange={(e) => {
                              const next = [...editBodyParams];
                              next[i] = { ...next[i], value: e.target.value };
                              setEditBodyParams(next);
                            }} style={{ flex: 1, padding: '4px 8px', background: 'var(--input-bg)', border: '1px solid var(--border-primary)', borderRadius: 4, color: 'var(--text-primary)', fontSize: 12 }} />
                            <button onClick={() => setEditBodyParams(editBodyParams.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: 'var(--error-color)', cursor: 'pointer', fontSize: 14 }}>×</button>
                          </div>
                        ))}
                        <button onClick={() => setEditBodyParams([...editBodyParams, { key: '', value: '', enabled: true }])} style={{ padding: '4px 10px', background: 'var(--bg-secondary)', border: '1px dashed var(--border-secondary)', borderRadius: 4, color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 11 }}>
                          + 添加 Body 参数
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  // View Mode
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ color: 'var(--text-primary)', fontWeight: 500, fontSize: 15 }}>{provider.name}</span>
                          <span style={{ fontSize: 11, color: 'var(--text-secondary)', background: 'var(--bg-primary)', padding: '2px 6px', borderRadius: 4 }}>
                            {provider.apiType}
                          </span>
                          {provider.apiKey && (
                            <span style={{ background: 'var(--success-color)', color: 'var(--text-primary)', padding: '2px 8px', borderRadius: 10, fontSize: 11 }}>
                              已配置
                            </span>
                          )}
                          {!provider.enabled && (
                            <span style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', padding: '2px 8px', borderRadius: 10, fontSize: 11 }}>
                              已禁用
                            </span>
                          )}
                        </div>
                        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{provider.baseUrl}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          onClick={() => handleStartEditProvider(provider)}
                          style={{
                            padding: '4px 10px',
                            background: 'var(--bg-primary)',
                            border: 'none',
                            borderRadius: 4,
                            color: 'var(--text-primary)',
                            cursor: 'pointer',
                            fontSize: 11,
                          }}
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => handleDeleteProvider(provider.id)}
                          style={{
                            padding: '4px 10px',
                            background: 'var(--error-bg)',
                            border: 'none',
                            borderRadius: 4,
                            color: 'var(--error-color)',
                            cursor: 'pointer',
                            fontSize: 11,
                          }}
                        >
                          删除
                        </button>
                      </div>
                    </div>

                    <div style={{ marginBottom: 8 }}>
                      <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span>启用状态</span>
                        <input
                          type="checkbox"
                          checked={provider.enabled}
                          onChange={(e) => handleUpdateProvider(provider.id, { enabled: e.target.checked })}
                        />
                      </label>
                    </div>

                    <div>
                      <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8, display: 'block' }}>
                        已启用模型 ({provider.models?.length || 0})
                      </label>
                      {provider.models?.length > 0 ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {provider.models.map((model) => (
                            <span
                              key={model.id}
                              style={{
                                padding: '4px 10px',
                                background: 'var(--bg-tertiary)',
                                borderRadius: 4,
                                fontSize: 12,
                                color: 'var(--text-secondary)',
                              }}
                            >
                              {model.name}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>暂无可用模型，点击编辑重新获取</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {modes.providers.length === 0 && !showAddProvider && (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>
                <p>暂无模型提供商</p>
                <button
                  onClick={() => setShowAddProvider(true)}
                  style={{
                    padding: '8px 16px',
                    background: 'var(--accent-color)',
                    border: 'none',
                    borderRadius: 6,
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                >
                  添加第一个提供商
                </button>
              </div>
            )}
          </div>
        );

      case 'app':
        return (
          <div className="settings-section">
            <h3>应用配置</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: 12, marginBottom: 16 }}>
              点击应用名称进入详细设置页面，配置模型、工具、可见性和提示词。
            </p>
            <div className="app-manager-list" style={{ maxHeight: 400, overflowY: 'auto' }}>
              {installedApps.map((app) => (
                <div key={app.id} className="app-manager-item" style={{ cursor: 'pointer' }} onClick={() => {
                  openSystemApp('app-settings:' + app.id, '应用设置: ' + app.name, app.icon);
                }}>
                  <img
                    src={app.icon}
                    alt={app.name}
                    className="app-manager-item-icon"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = DEFAULT_ICON;
                    }}
                  />
                  <div className="app-manager-item-info">
                    <div className="app-manager-item-name">{app.name}</div>
                    <div className="app-manager-item-meta">
                      {app.source === 'system' ? '系统' : app.source === 'user' ? '用户' : '市场'} •{' '}
                      {app.type === 'desktop' ? '桌面应用' : '后台服务'}
                      {app.enabled === false && ' • 已禁用'}
                    </div>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    {appConfigs[app.id]?.models?.[0]
                      ? `${modes.providers.find(p => p.id === appConfigs[app.id].models![0].provider)?.name || appConfigs[app.id].models![0].provider} / ${appConfigs[app.id].models![0].model}`
                      : '未配置模型'}
                  </span>
                </div>
              ))}
              {installedApps.length === 0 && (
                <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-secondary)' }}>
                  暂无应用
                </div>
              )}
            </div>
          </div>
        );

      case 'mcp':
        return (
          <div className="settings-section">
            <h3>MCP 服务连接</h3>
            {mcpConnections.connections.length === 0 ? (
              <div style={{ color: 'var(--text-secondary)', padding: 20, textAlign: 'center' }}>
                暂无 MCP 服务连接
              </div>
            ) : (
              mcpConnections.connections.map((conn) => (
                <div key={conn.id} style={{ marginBottom: 16, padding: 12, background: 'var(--bg-secondary)', borderRadius: 8 }}>
                  <div className="settings-item" style={{ marginBottom: 8 }}>
                    <label>名称</label>
                    <span style={{ color: 'var(--text-primary)' }}>{conn.name}</span>
                  </div>
                  <div className="settings-item" style={{ marginBottom: 8 }}>
                    <label>命令</label>
                    <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{conn.command}</span>
                  </div>
                  <div className="settings-item">
                    <label>启用</label>
                    <input
                      type="checkbox"
                      checked={conn.enabled}
                      onChange={(e) => {
                        const newConnections = mcpConnections.connections.map(c =>
                          c.id === conn.id ? { ...c, enabled: e.target.checked } : c
                        );
                        handleMcpUpdate({ connections: newConnections });
                      }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        );

      case 'skill':
        return (
          <div className="settings-section">
            <h3>技能设置</h3>
            <div className="settings-item" style={{ marginBottom: 16 }}>
              <label>全局启用</label>
              <input
                type="checkbox"
                checked={skills.globalEnabled}
                onChange={(e) => handleSkillUpdate({ ...skills, globalEnabled: e.target.checked })}
              />
            </div>
            {skills.skills.length === 0 ? (
              <div style={{ color: 'var(--text-secondary)', padding: 20, textAlign: 'center' }}>
                暂无技能配置
              </div>
            ) : (
              skills.skills.map((skill) => (
                <div key={skill.id} style={{ marginBottom: 16, padding: 12, background: 'var(--bg-secondary)', borderRadius: 8 }}>
                  <div className="settings-item" style={{ marginBottom: 8 }}>
                    <label>名称</label>
                    <span style={{ color: 'var(--text-primary)' }}>{skill.name}</span>
                  </div>
                  <div className="settings-item" style={{ marginBottom: 8 }}>
                    <label>描述</label>
                    <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{skill.description}</span>
                  </div>
                  <div className="settings-item">
                    <label>启用</label>
                    <input
                      type="checkbox"
                      checked={skill.enabled}
                      onChange={(e) => {
                        const newSkills = skills.skills.map(s =>
                          s.id === skill.id ? { ...s, enabled: e.target.checked } : s
                        );
                        handleSkillUpdate({ ...skills, skills: newSkills });
                      }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        );
    }
  };

  return (
    <div className="settings-app" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', gap: 4, padding: '8px 12px', borderBottom: '1px solid var(--border-primary)' }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '6px 16px',
              background: activeTab === tab.id ? 'var(--accent-color)' : 'var(--bg-primary)',
              border: 'none',
              borderRadius: 6,
              color: 'var(--text-primary)',
              cursor: 'pointer',
              fontSize: 13,
              transition: 'background 0.15s',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {renderTabContent()}
      </div>
    </div>
  );
}
