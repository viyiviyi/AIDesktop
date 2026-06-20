import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useDesktop } from '../contexts/DesktopContext';
import { useToast } from '../contexts/ToastContext';
import type { WindowState, Message, ModelProvider, MCPConnection, Skill, AppInfo, App, ProviderModel, Content, Conversation, FormSchema, FormField } from '../types';
import * as api from '../services/api';
import { useAgentEventStream } from '../services/useAgentEventStream';
import type { WsConvEvent } from '../services/useAgentEventStream';
import { MarkdownView } from './MarkdownView';
import { FormComponent } from './FormComponent';
import { WorkspaceDirSelector } from './WorkspaceDirSelector';
import { PictureFilled } from '@ant-design/icons';

// 流式 tool call 的展开状态管理（独立于 Window 内部展开状态，因为 toolCalls 不是 msg.content）
const toolExpandStore = new Map<string, boolean>();
function useToolExpand(id: string): [boolean, () => void] {
  const [expanded, setExpanded] = useState(() => toolExpandStore.get(id) ?? false);
  const toggle = useCallback(() => {
    setExpanded(prev => {
      const next = !prev;
      toolExpandStore.set(id, next);
      return next;
    });
  }, [id]);
  return [expanded, toggle];
}

// 实时的 tool call item（流式加载中使用）
function LiveToolCallItem({ tc }: { tc: { toolCallId: string; toolName: string; args?: unknown; result?: unknown; isError?: boolean } }) {
  const [expanded, toggle] = useToolExpand(tc.toolCallId);
  const icon = tc.isError ? '✗' : tc.result ? '✓' : '◌';
  const argsStr = tc.args ? JSON.stringify(tc.args) : '';
  const resultStr = tc.result ? JSON.stringify(tc.result) : '';
  const hasDetail = argsStr.length > 60 || !!resultStr;
  const argsPreview = argsStr.length > 60 ? argsStr.slice(0, 60) + '...' : argsStr;

  const fmt = (v: unknown): string => {
    if (v === undefined || v === null) return '(空)';
    if (typeof v === 'string') return v;
    try { return JSON.stringify(v, null, 2); } catch { return String(v); }
  };

  return (
    <div className={`tool-call-item live ${tc.isError ? 'tool-error' : ''}`}>
      <div className="tool-call-header" onClick={hasDetail ? toggle : undefined}>
        <span className="tool-call-icon">{icon}</span>
        <span className="tool-call-name">{tc.toolName}</span>
        {argsPreview && <span className="tool-call-args-preview">{argsPreview}</span>}
        {hasDetail && <span className="tool-call-expand">{expanded ? '▲' : '▼'}</span>}
      </div>
      {expanded && (
        <div className="tool-call-detail">
          {!!tc.args && (
            <div className="tool-call-section">
              <div className="tool-call-section-label">参数</div>
              <pre className="tool-call-section-content">{fmt(tc.args)}</pre>
            </div>
          )}
          {!!tc.result && (
            <div className="tool-call-section">
              <div className="tool-call-section-label">结果 {tc.isError ? '(错误)' : ''}</div>
              <pre className="tool-call-section-content">{fmt(tc.result)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

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
        opacity: isFocused ? 1 : 1,
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
  const { addToast, confirm } = useToast();
  const { state } = useDesktop();
  const [conversations, setConversations] = useState<{ id: string; title: string; preview?: string; createdAt?: string; workspaceDir?: string | null }[]>([]);
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
  const initRef = useRef(false);
  const currentConvIdRef = useRef(currentConvId);
  currentConvIdRef.current = currentConvId;
  // 多模态输入 — 附件列表
  const [attachments, setAttachments] = useState<{ id: string; type: 'image' | 'audio' | 'video' | 'file'; url: string; name: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 表单状态 — 等待用户填写的表单
  const [pendingForms, setPendingForms] = useState<Map<string, { formId: string; schema: FormSchema; toolCallId: string }>>(new Map());
  // 待处理的工作目录授权请求
  const [workspaceRequest, setWorkspaceRequest] = useState<{ toolCallId: string; requestedPath?: string } | null>(null);

  // 判断当前应用是否支持图片输入
  const currentAppInfo = state.installedApps.find(a => a.id === appId);
  const appSupportsImage = currentAppInfo?.supportedInputs?.includes('image') ?? false;

  // 压缩图片到指定最大尺寸
  const compressImage = (dataUrl: string, maxDimension: number): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width <= maxDimension && height <= maxDimension) {
          resolve(dataUrl);
          return;
        }
        // 等比例缩放
        if (width > height) {
          if (width > maxDimension) { height = height * maxDimension / width; width = maxDimension; }
        } else {
          if (height > maxDimension) { width = width * maxDimension / height; height = maxDimension; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = dataUrl;
    });
  };

  // 选择附件
  const handleAttachFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    for (const file of Array.from(files)) {
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = (ev) => resolve(ev.target?.result as string);
        reader.readAsDataURL(file);
      });
      const type = file.type.startsWith('image/') ? 'image' : 'file';
      // 图片压缩：1080p以内保持原样，8k及以上压到2k
      let finalUrl = dataUrl;
      if (type === 'image') {
        const img = new Image();
        await new Promise((resolve) => { img.onload = resolve; img.src = dataUrl; });
        const maxDim = Math.max(img.width, img.height);
        if (maxDim >= 7680) {
          finalUrl = await compressImage(dataUrl, 2048);
        } else if (maxDim > 1080) {
          finalUrl = await compressImage(dataUrl, 1080);
        }
      }
      setAttachments(prev => [...prev, { id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, type: type as any, url: finalUrl, name: file.name }]);
    }
    e.target.value = '';
  };

  // 粘贴图片
  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    if (!appSupportsImage) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        const dataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = (ev) => resolve(ev.target?.result as string);
          reader.readAsDataURL(file);
        });
        const img = new Image();
        await new Promise((resolve) => { img.onload = resolve; img.src = dataUrl; });
        const maxDim = Math.max(img.width, img.height);
        let finalUrl = dataUrl;
        if (maxDim >= 7680) {
          finalUrl = await compressImage(dataUrl, 2048);
        } else if (maxDim > 1080) {
          finalUrl = await compressImage(dataUrl, 1080);
        }
        setAttachments(prev => [...prev, { id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, type: 'image', url: finalUrl, name: file.name }]);
      }
    }
  }, [appSupportsImage]);

  // 移除附件
  const removeAttachment = (id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  };

  // 初始化：加载会话列表，如果有已有会话则用最新的，否则创建新会话
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    api.getConversations(appId).then(convs => {
      const mapped = convs.map(c => ({
        id: c.id,
        title: c.title,
        preview: undefined as string | undefined,
        createdAt: c.createdAt,
        workspaceDir: c.workspaceDir,
      }));
      setConversations(mapped);

      if (convs.length > 0) {
        // 有已有会话，用最新的有消息的会话
        const target = convs.find(c => c.messages.length > 0) || convs[0];
        setCurrentConvId(target.id);
      } else {
        // 没有会话，创建一个
        return api.createConversation(appId, `窗口 ${Date.now()}`).then(conv => {
          setConversations([{ id: conv.id, title: conv.title, createdAt: conv.createdAt, workspaceDir: conv.workspaceDir }]);
          setCurrentConvId(conv.id);
        });
      }
    }).catch(() => {});
  }, []);

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
      case 'message_start': {
        // 开始新消息，重置累积状态
        setThinkingText('');
        setStreamingText('');
        // 不在这里压入 toolCalls（message_end 会包含完整的 content）
        setToolCalls([]);
        break;
      }
      case 'message_end': {
        const content = (event.data.content || []) as any[];
        // 提取 text 块
        const text = content.filter((c: any) => c.type === 'text').map((c: any) => c.text || '').join('');
        // 提取 toolCall 块
        const toolCallBlocks = content.filter((c: any) => c.type === 'toolCall');
        // 如果没有任何实际内容，跳过（后面 done 事件会 loadMessages）
        if (!text && toolCallBlocks.length === 0) {
          setStreamingText('');
          setToolCalls([]);
          setThinkingText('');
          break;
        }
        // 构建完整消息 content
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
          if (last && last.role === 'assistant' && !getMessageText(last) && !last.content.some(c => (c as any).type === 'toolCall' || (c as any).type === 'tool_result')) {
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
        // 完成后重新加载当前会话消息同步
        setIsLoading(false);
        const cId = currentConvIdRef.current;
        if (cId) loadMessages(cId);
        // 刷新会话列表以更新 workspaceDir
        api.getConversations(appId).then(convs => {
          const updated = convs.map(c => ({
            id: c.id,
            title: c.title,
            preview: c.messages.length > 0
              ? c.messages.filter(m => m.role === 'user')
                .map(m => m.content.filter((x: any) => x.type === 'text').map((x: any) => x.text).join(''))
                .pop()?.slice(0, 100)
              : undefined,
            createdAt: c.createdAt,
            workspaceDir: c.workspaceDir,
          }));
          setConversations(updated);
        });
        break;
      case 'form_request': {
        const formId = event.data.formId as string;
        const schema = event.data.schema as FormSchema;
        if (formId && schema) {
          setPendingForms(prev => {
            const next = new Map(prev);
            next.set(formId, { formId, schema, toolCallId: '' });
            return next;
          });
          // 表单已出现，关闭 loading 状态让用户填写
          setIsLoading(false);
          setThinkingText('');
          setStreamingText('');
          setToolCalls([]);
        }
        break;
      }
      case 'form_response':
      case 'form_cancelled': {
        const respondFormId = event.data.formId as string;
        if (respondFormId) {
          setPendingForms(prev => {
            const next = new Map(prev);
            next.delete(respondFormId);
            return next;
          });
          // 表单已提交/取消，重新进入 loading 等待 AI 回复
          setIsLoading(true);
          setThinkingText('处理中...');
          setStreamingText('');
          setToolCalls([]);
        }
        break;
      }
      case 'workspace_request': {
        const wsData = event.data as any;
        setWorkspaceRequest({
          toolCallId: wsData.toolCallId as string || '',
          requestedPath: wsData.requestedPath as string || undefined,
        });
        // 关闭 loading，显示授权选择器
        setIsLoading(false);
        setThinkingText('');
        // 保留 toolCalls，授权选择器会叠加在已有的 tool call 卡片下面
        break;
      }
      case 'error':
        const errorMsg = event.data.message as string;
        console.error('[AI Error]', errorMsg);
        addToast('error', `AI 回复失败: ${errorMsg}`);
        setIsLoading(false);
        break;
    }
  }, [addToast]);

  // 连接 WebSocket 事件流
  useAgentEventStream(appId ?? undefined, currentConvId ?? undefined, handleAgentEvent);

  // 加载当前会话的消息（currentConvId 变化时重新加载）
  useEffect(() => {
    if (currentConvId) {
      loadMessages(currentConvId);
      // 同时也加载会话列表（保持会话列表同步）
      loadConversations(currentConvId);
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
        return { id: c.id, title: c.title, preview, createdAt: c.createdAt, workspaceDir: c.workspaceDir };
      });
      setConversations(mapped);
      // 自动设置当前会话：优先用传入的 preserveConvId，否则用最新的有消息的，否则用最新的
      const curId = preserveConvId !== undefined ? preserveConvId : currentConvId;
      if (!curId || !mapped.find(c => c.id === curId)) {
        const target = convs.find(c => c.messages.length > 0) || convs[0];
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
      // 从消息列表中推导待填表单：检查每个 assistant 消息是否有 form toolCall 且无对应 toolResult
      const restored = new Map<string, { formId: string; schema: FormSchema; toolCallId: string }>();
      for (let i = 0; i < conv.messages.length; i++) {
        const msg = conv.messages[i];
        if (msg.role !== 'assistant') continue;
        for (const c of msg.content) {
          const tc = c as any;
          if (tc.type === 'toolCall' && (tc.name === 'mcp_form_requestInput' || tc.name === 'mcp.form.requestInput')) {
            // 检查后面是否有对应的 toolResult
            let hasResult = false;
            for (let j = i + 1; j < conv.messages.length; j++) {
              const next = conv.messages[j];
              if (next.role === 'toolResult' && next.toolResultMeta?.toolCallId === tc.id) {
                // 排除 pending 状态的 toolResult（这只表示表单已发送，还没填写）
                const text = next.content.filter((x: any) => x.type === 'text').map((x: any) => x.text).join('');
                if (text.includes('"status":"pending"') || text.includes('"status": "pending"')) continue;
                hasResult = true;
                break;
              }
            }
            if (!hasResult) {
              const formId = `form-${tc.id}`;
              restored.set(formId, {
                formId,
                toolCallId: tc.id,
                schema: {
                  title: (tc.arguments as any)?.title || '请填写表单',
                  description: (tc.arguments as any)?.description || '',
                  fields: ((tc.arguments as any)?.fields || []).map((f: any) => ({
                    name: f.name, label: f.label, type: f.type || 'text',
                    required: f.required, options: f.options, placeholder: f.placeholder,
                    accept: f.accept, description: f.description,
                  })),
                },
              });
            }
          }
        }
      }
      setPendingForms(restored);
    } catch (error) {
      console.error('Failed to load messages:', error);
    }
  };

  // 创建新会话
  const createNewConversation = async () => {
    try {
      const conv = await api.createConversation(appId, `会话 ${conversations.length + 1}`);
      setConversations([...conversations, { id: conv.id, title: conv.title, workspaceDir: conv.workspaceDir }]);
      setCurrentConvId(conv.id);
      setMessages([]);
      setShowConvList(false);
    } catch (error) {
      console.error('Failed to create conversation:', error);
    }
  };

  // 删除会话
  const deleteConversation = async (convId: string) => {
    const ok = await confirm('确定要删除这个会话吗？');
    if (!ok) return;
    try {
      await api.deleteConversation(appId, convId);
      const updated = conversations.filter((c) => c.id !== convId);
      setConversations(updated);
      // 如果删除的是当前会话，切换到最新的会话
      if (convId === currentConvId) {
        if (updated.length > 0) {
          setCurrentConvId(updated[updated.length - 1].id);
        } else {
          // 没有会话了，创建一个新的
          const conv = await api.createConversation(appId, `会话 1`);
          setConversations([{ id: conv.id, title: conv.title, workspaceDir: conv.workspaceDir }]);
          setCurrentConvId(conv.id);
        }
      }
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
    if ((!input.trim() && attachments.length === 0) || !currentConvId || isLoading) return;

    const messageContent = input;
    const content: Content[] = [];
    if (messageContent.trim()) content.push({ type: 'text', text: messageContent });
    for (const att of attachments) {
      if (att.type === 'image') content.push({ type: 'image', url: att.url, alt: att.name } as any);
      else content.push({ type: 'file', path: att.url, name: att.name, size: 0 } as any);
    }

    setInput('');
    setAttachments([]);
    setIsLoading(true);
    setStreamingText('');
    setToolCalls([]);
    setThinkingText('');
    setReplyToId(null);

    try {
      const { userMessage } = await api.sendMessage(appId, currentConvId, content, replyTo);

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

  // 删除消息
  const deleteMsg = async (msgId: string) => {
    if (!currentConvId) return;
    const ok = await confirm('确定要删除这条消息吗？');
    if (!ok) return;
    try {
      await api.deleteMessage(appId, currentConvId, msgId);
      // 重新加载消息确保前后端一致（后端已处理 toolResult 连带删除）
      loadMessages(currentConvId);
      addToast('success', '消息已删除');
    } catch {
      addToast('error', '删除失败');
    }
  };

  // 终止 AI 回复
  const handleAbort = async () => {
    if (!currentConvId) return;
    try {
      await api.abortConversation(appId, currentConvId);
      setIsLoading(false);
      setThinkingText('');
      setStreamingText('');
      addToast('info', '已终止');
    } catch {
      addToast('error', '终止失败');
    }
  };

  // 继续 AI 输出（不带新用户输入）
  const handleContinue = async () => {
    if (!currentConvId) return;
    setIsLoading(true);
    setThinkingText('继续中...');
    setStreamingText('');
    setToolCalls([]);
    try {
      await api.continueConversation(appId, currentConvId);
    } catch {
      addToast('error', '继续失败');
      setIsLoading(false);
    }
  };

  // 判断最后一条 assistant 消息是否可以继续（没有在加载且会话有 assistant 消息）
  const canContinue = !isLoading && messages.length > 0 && messages[messages.length - 1]?.role === 'assistant';

  // 键盘事件处理 - 按配置的快捷键发送消息
  const handleKeyDown = (e: React.KeyboardEvent) => {
    const sendKey = state.settings.sendKey || 'alt+s';
    let shouldSend = false;
    if (sendKey === 'enter') {
      shouldSend = e.key === 'Enter' && !e.shiftKey;
    } else if (sendKey === 'ctrl+enter') {
      shouldSend = e.key === 'Enter' && (e.ctrlKey || e.metaKey);
    } else if (sendKey === 'alt+s') {
      shouldSend = (e.key === 's' || e.key === 'S') && e.altKey;
    } else if (sendKey === 'ctrl+s') {
      shouldSend = (e.key === 's' || e.key === 'S') && (e.ctrlKey || e.metaKey);
    }
    if (shouldSend) {
      e.preventDefault();
      if (editingMsgId) {
        submitEdit();
      } else {
        sendMessage(replyToId || undefined);
      }
    }
  };

  // textarea 自适应高度
  const autoResize = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  };

  // 提取消息文本内容
  const getMessageText = (msg: Message): string => {
    return msg.content
      .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
      .map((c) => c.text)
      .join('');
  };

  // 格式化时间为 HH:mm:ss
  const formatTime = (ts: string): string => {
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return '';
    }
  };

  // 格式化时间为 MM-dd HH:mm
  const formatShortDateTime = (ts: string): string => {
    try {
      const d = new Date(ts);
      return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
        + ' ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  // 展开/收起 tool call 详情 — 按 {msgId: Set<toolCallId>} 独立
  const [expandedByMsg, setExpandedByMsg] = useState<Record<string, Set<string>>>({});
  const toggleToolExpand = useCallback((msgId: string, toolId: string) => {
    setExpandedByMsg(prev => {
      const next = { ...prev };
      const s = new Set(next[msgId] || []);
      if (s.has(toolId)) s.delete(toolId); else s.add(toolId);
      next[msgId] = s;
      return next;
    });
  }, []);

  // 格式化未知类型的值用于显示
  const fmt = (v: unknown): string => {
    if (v === undefined || v === null) return '(空)';
    if (v && typeof v === 'object' && '_fileRef' in (v as object)) {
      const ref = v as { _fileRef: string; _originalSize: number };
      return `[文件引用: ${ref._fileRef} (${ref._originalSize} 字节)]`;
    }
    if (typeof v === 'string') return v;
    try { return JSON.stringify(v, null, 2); } catch { return String(v); }
  };

  // 渲染消息内容。toolResult 消息不独立渲染，而是合并到前面的 assistant 消息中。
  const renderMessageContent = useCallback((msg: Message, allMessages?: Message[], idx?: number): React.ReactNode => {
    // toolResult 由 assistant 消息合并渲染，独立不渲染
    if (msg.role === 'toolResult') return null;

    const expandedSet = expandedByMsg[msg.id] || new Set();

    // 提取附件（图片、文件）
    const imageBlocks = msg.content.filter((c): c is any => c.type === 'image');
    const fileBlocks = msg.content.filter((c): c is any => c.type === 'file');

    // assistant 消息：提取 text、thinking 和 toolCall blocks
    const textParts: string[] = [];
    const thinkingParts: string[] = [];
    const toolCallMap = new Map<string, { id: string; name: string; args?: unknown }>();
    for (const c of msg.content) {
      if (c.type === 'text') {
        textParts.push(c.text);
      } else if (c.type === 'thinking') {
        thinkingParts.push(c.text);
      } else if (c.type === 'toolCall') {
        toolCallMap.set(c.id, { id: c.id, name: c.name, args: c.arguments });
      }
    }

    // 收集后续 toolResult 消息
    const toolResults = new Map<string, { toolCallId: string; toolName: string; result?: unknown; isError: boolean; timestamp?: string }>();
    if (allMessages && idx !== undefined) {
      for (let i = idx + 1; i < allMessages.length; i++) {
        const next = allMessages[i];
        if (next.role !== 'toolResult') break;
        const meta = next.toolResultMeta;
        if (meta) {
          const text = next.content.filter(c => c.type === 'text').map(c => c.text).join('');
          toolResults.set(meta.toolCallId, {
            toolCallId: meta.toolCallId,
            toolName: meta.toolName,
            result: text || undefined,
            isError: meta.isError,
            timestamp: next.timestamp,
          });
        }
      }
    }

    // 合并：toolCall 有 result 的合并显示，只有 toolCall 没有 result 的显示为"等待中"
    const mergedItems: Array<{ id: string; name: string; args?: unknown; result?: unknown; isError: boolean; callTime?: string; resTime?: string }> = [];
    for (const [id, tc] of toolCallMap) {
      const tr = toolResults.get(id);
      mergedItems.push({
        id,
        name: tc.name,
        args: tc.args,
        result: tr?.result,
        isError: tr?.isError || false,
        callTime: msg.timestamp,
        resTime: tr?.timestamp,
      });
    }
    // 只有 result 没有 toolCall 的也加上（异常情况）
    for (const [id, tr] of toolResults) {
      if (!toolCallMap.has(id)) {
        mergedItems.push({
          id,
          name: tr.toolName,
          result: tr.result,
          isError: tr.isError,
          resTime: tr.timestamp,
        });
      }
    }

    // 纯文本（或附件+文本）
    const hasAttachments = imageBlocks.length > 0 || fileBlocks.length > 0;
    if (mergedItems.length === 0) {
      return (
        <>
          {hasAttachments && renderAttachments(imageBlocks, fileBlocks)}
          <MarkdownView content={textParts.join('')} />
        </>
      );
    }

    // 混合内容：附件 + 文本(用 Markdown 渲染) + 工具调用结果块
    return (
      <>
        {hasAttachments && renderAttachments(imageBlocks, fileBlocks)}
        {textParts.length > 0 && <div className="tool-call-text-block"><MarkdownView content={textParts.join('')} /></div>}
        <div className="tool-log-list">
          {mergedItems.map((tp) => {
            const isExpanded = expandedSet.has(tp.id);
            const argsStr = tp.args ? JSON.stringify(tp.args) : '';
            const resultStr = tp.result !== undefined ? String(tp.result) : '';
            const hasDetail = argsStr.length > 0 || resultStr.length > 0;
            const argsPreview = argsStr.length > 60 ? argsStr.slice(0, 60) + '...' : argsStr;
            const icon = tp.isError ? '✗' : (tp.result !== undefined ? '✓' : '→');
            return (
              <div key={tp.id} className={'tool-call-item' + (tp.isError ? ' tool-error' : '')}>
                <div className="tool-call-header" onClick={() => toggleToolExpand(msg.id, tp.id)}>
                  <span className="tool-call-icon">{icon}</span>
                  <span className="tool-call-name">{tp.name}</span>
                  {argsPreview && <span className="tool-call-args-preview">{argsPreview}</span>}
                  <span className="tool-call-times">
                    {tp.callTime && <span className="tool-call-time">调用 {formatTime(tp.callTime)}</span>}
                    {tp.resTime && <span className="tool-call-time">响应 {formatTime(tp.resTime)}</span>}
                  </span>
                  {hasDetail && <span className="tool-call-expand">{isExpanded ? '▲' : '▼'}</span>}
                </div>
                {isExpanded && (
                  <div className="tool-call-detail">
                    {argsStr.length > 0 && (
                      <div className="tool-call-section">
                        <div className="tool-call-section-label">参数</div>
                        <pre className="tool-call-section-content">{fmt(tp.args)}</pre>
                      </div>
                    )}
                    {resultStr.length > 0 && (
                      <div className="tool-call-section">
                        <div className="tool-call-section-label">结果 {tp.isError ? '(错误)' : ''}</div>
                        <pre className="tool-call-section-content">{fmt(tp.result)}</pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </>
    );
  }, [expandedByMsg, toggleToolExpand]);

  // 渲染消息中的附件（图片预览 + 文件列表）
  const renderAttachments = (images: any[], files: any[]) => {
    return (
      <div className="chat-msg-attachments">
        {images.map((img, i) => (
          <div key={i} className="chat-msg-image-wrapper">
            <img
              src={img.url}
              alt={img.alt || ''}
              className="chat-msg-image"
              onClick={() => window.open(img.url, '_blank')}
              style={{ cursor: 'pointer', maxWidth: '100%', maxHeight: 300, borderRadius: 8, objectFit: 'contain' }}
            />
          </div>
        ))}
        {files.map((f, i) => (
          <div key={i} className="chat-msg-file">
            📎 {f.name || f.path?.split('/').pop() || '附件'}
          </div>
        ))}
      </div>
    );
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
        {(() => {
          const currentConv = conversations.find((c) => c.id === currentConvId);
          return currentConv?.createdAt ? (
            <span className="chat-header-time">{formatShortDateTime(currentConv.createdAt)}</span>
          ) : null;
        })()}
        {(() => {
          const currentConv = conversations.find((c) => c.id === currentConvId);
          return currentConv?.workspaceDir ? (
            <span className="chat-header-workspace" title={`工作目录: ${currentConv.workspaceDir}`}>
              📁 {currentConv.workspaceDir}
            </span>
          ) : null;
        })()}
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
          // 分支折叠逻辑：
          // 消息列表 [A, B, C, D]，如果 D 回复了 A，那么 B~C 是历史分支可折叠
          // 折叠范围 = (被回复消息的下一条, 回复消息的上一条)
          // 如果有多个回复链，每条回复链的历史分支独立折叠

          const msgMap = new Map(messages.map(m => [m.id, m]));

          // 对于每条有 replyTo 的消息，计算其历史分支的范围 [startIdx, endIdx]
          // startIdx = 被回复消息的 index + 1
          // endIdx = 本条回复消息的 index - 1
          // 如果 startIdx <= endIdx，就是可折叠的历史分支
          const branchRanges: Array<{ start: number; end: number; key: string }> = [];
          for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];
            if (msg.replyTo && msgMap.has(msg.replyTo!)) {
              const repliedIdx = messages.findIndex(m => m.id === msg.replyTo);
              if (repliedIdx >= 0 && repliedIdx + 1 <= i - 1) {
                branchRanges.push({
                  start: repliedIdx + 1,
                  end: i - 1,
                  key: `branch-${msg.id}`,
                });
              }
            }
          }

          // 判断某条消息是否在某个折叠的范围内
          const isInCollapsedRange = (idx: number): string | null => {
            for (const range of branchRanges) {
              if (collapsedBranches.has(range.key) && idx >= range.start && idx <= range.end) {
                return range.key;
              }
            }
            return null;
          };

          // 检查某个 range 是否应该显示折叠/展开按钮（至少有一个折叠的）
          const renderedRanges = new Set<string>();

          return messages.map((msg, idx) => {
            const refCallback = (el: HTMLDivElement | null) => {
              if (el) messageRefs.current.set(msg.id, el);
              else messageRefs.current.delete(msg.id);
            };

            // 如果在折叠范围内，跳过
            const rangeKey = isInCollapsedRange(idx);
            if (rangeKey) return null;

            // toolResult 消息不独立显示，合并到前面的 assistant 消息中
            if (msg.role === 'toolResult') return null;

            const replyToMsg = msg.replyTo ? msgMap.get(msg.replyTo) : undefined;
            const isHighlight = highlightMsgId === msg.id;

            // 检查当前 idx 是否是一个折叠范围的结束位置+1（需要在之前显示折叠按钮）
            const foldButton = (() => {
              for (const range of branchRanges) {
                if (range.end === idx - 1 && !renderedRanges.has(range.key)) {
                  renderedRanges.add(range.key);
                  const count = range.end - range.start + 1;
                  const isCollapsed = collapsedBranches.has(range.key);
                  return (
                    <div className="branch-header" key={`fold-${range.key}`}>
                      <button
                        className="branch-toggle"
                        onClick={() => toggleBranch(range.key)}
                        title={isCollapsed ? '展开历史分支' : '折叠历史分支'}
                      >
                        {isCollapsed ? '↕' : '↑'}
                        <span className="branch-label">历史分支 ({count} 条消息)</span>
                      </button>
                    </div>
                  );
                }
              }
              return null;
            })();

            return (
              <React.Fragment key={msg.id}>
                {foldButton}

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
                  {msg.role === 'assistant' && msg.content.some(c => (c as any).type === 'thinking') && (
                    <div className="thinking-block">
                      <div className="thinking-header" onClick={() => toggleToolExpand(msg.id, '_thinking')}>
                        <span className="thinking-label">已思考</span>
                      </div>
                      {(expandedByMsg[msg.id] || new Set()).has('_thinking') && (
                        <div className="thinking-content">
                          {msg.content.filter(c => (c as any).type === 'thinking').map((c, i) => (
                            <pre key={i} className="thinking-text">{(c as any).text}</pre>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <div className="chat-message-content">
                    {renderMessageContent(msg, messages, idx)}
                    {msg.edited && <span className="edited-badge"> (已编辑)</span>}
                  </div>

                  {/* 时间戳 + 操作按钮 */}
                  <div className="chat-message-footer">
                    {msg.timestamp && (
                      <span className="chat-message-timestamp">{formatTime(msg.timestamp)}</span>
                    )}
                    <span style={{ flex: 1 }} />
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
                    <button
                      className="msg-action-btn msg-action-delete"
                      onClick={() => deleteMsg(msg.id)}
                      title="删除此消息"
                    >🗑</button>
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
                    <LiveToolCallItem key={tc.toolCallId} tc={tc} />
                  ))}
                </div>
              </div>
            )}
            {streamingText && (
              <div className="chat-message assistant">
                <div className="chat-message-content streaming">
                  <MarkdownView content={streamingText} />
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
        {/* 内嵌表单 — 在消息列表中渲染 pending 表单 */}
        {pendingForms.size > 0 && (
          <div className="chat-pending-forms">
            {Array.from(pendingForms.entries()).map(([formId, pf]) => (
              <div key={formId} className="chat-message assistant">
                <div className="chat-message-content">
                  <FormComponent
                    appId={appId}
                    convId={currentConvId!}
                    formId={formId}
                    toolCallId={pf.toolCallId}
                    schema={pf.schema}
                    onSubmitted={() => {
                      setPendingForms(prev => { const n = new Map(prev); n.delete(formId); return n; });
                      // 延迟一下再重新加载，等服务端处理好
                      setTimeout(() => loadMessages(currentConvId!), 500);
                    }}
                    onCancelled={() => {
                      setPendingForms(prev => { const n = new Map(prev); n.delete(formId); return n; });
                      setTimeout(() => loadMessages(currentConvId!), 500);
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
        {/* 工作目录授权选择器 */}
        {workspaceRequest && (
          <div className="chat-message assistant">
            <div className="chat-message-content">
              <WorkspaceDirSelector
                appId={appId!}
                convId={currentConvId!}
                toolCallId={workspaceRequest.toolCallId}
                requestedPath={workspaceRequest.requestedPath}
                onSubmitted={() => {
                  setWorkspaceRequest(null);
                  // 先加载消息让授权结果显示出来
                  loadMessages(currentConvId!).then(() => {
                    // 再进入 loading 等待 agent 继续
                    setIsLoading(true);
                    setThinkingText('处理中...');
                  }).catch(() => {
                    setIsLoading(true);
                    setThinkingText('处理中...');
                  });
                }}
                onCancelled={() => {
                  setWorkspaceRequest(null);
                  setTimeout(() => loadMessages(currentConvId!), 500);
                }}
              />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 输入区 */}
      {/* 停止按钮 — loading 时浮动显示 */}
      {isLoading && (
        <div className="stop-bar">
          <button className="stop-btn" onClick={handleAbort}>
            ■ 停止
          </button>
        </div>
      )}
      {/* 回复/编辑提示条 — 放在输入框上面 */}
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
      {editingMsgId && (
        <div className="reply-bar">
          <span className="reply-bar-icon">✎ 编辑消息</span>
          <button className="reply-bar-cancel" onClick={cancelEdit}>取消</button>
        </div>
      )}
      {/* 表单锁定提示条 — 有待填表单时锁定输入区 */}
      {pendingForms.size > 0 && (
        <div className="reply-bar form-lock-bar">
          <span className="reply-bar-icon">📋 待填表单</span>
          <span className="reply-bar-text">请先填写并提交上方的表单</span>
        </div>
      )}
      <div className="chat-input-area">
        {editingMsgId ? (
          <>
            <textarea
              value={editInput}
              onChange={(e) => { setEditInput(e.target.value); autoResize(e); }}
              onKeyDown={handleKeyDown}
              placeholder="编辑消息..."
              autoFocus
              rows={1}
            />
            <button onClick={submitEdit} disabled={!editInput.trim()}>保存</button>
          </>
        ) : (
          <>
            {/* 附件预览 */}
            {attachments.length > 0 && (
              <div className="chat-attachments">
                {attachments.map(att => (
                  <div key={att.id} className="chat-attachment-item">
                    {att.type === 'image' ? (
                      <img src={att.url} alt={att.name} className="chat-attachment-thumb" />
                    ) : (
                      <div className="chat-attachment-file">📎 {att.name}</div>
                    )}
                    <button className="chat-attachment-remove" onClick={() => removeAttachment(att.id)}>×</button>
                  </div>
                ))}
              </div>
            )}
            <div className="chat-input-row">
              {appSupportsImage && (
                <>
                  <button
                    className="chat-attach-btn"
                    onClick={() => fileInputRef.current?.click()}
                    title="选择图片"
                    disabled={!currentConvId || isLoading}
                  >
                    <PictureFilled style={{ fontSize: 16 }} />
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    style={{ display: 'none' }}
                    onChange={handleAttachFile}
                  />
                </>
              )}
              <textarea
                value={input}
                onChange={(e) => { setInput(e.target.value); autoResize(e); }}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder={replyToId ? '输入回复...' : '输入消息...'}
                disabled={!currentConvId || isLoading || pendingForms.size > 0}
                rows={1}
              />
              <button
                onClick={() => {
                  if (input.trim() || attachments.length > 0) {
                    sendMessage(replyToId || undefined);
                  } else if (currentConvId && !isLoading && pendingForms.size === 0) {
                    // 输入为空时当作"继续"按钮，用当前上下文继续
                    handleContinue();
                  }
                }}
                disabled={!currentConvId || isLoading || pendingForms.size > 0 || (input.trim() || attachments.length > 0 ? false : messages.length === 0)}
              >
                {(input.trim() || attachments.length > 0) ? '发送' : (messages.length > 0 ? '继续' : '发送')}
              </button>
            </div>
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
  // 已连接的运行时 MCP 列表（含工具信息）
  const [connectedMcps, setConnectedMcps] = useState<Array<{
    connectionId: string;
    serverInfo: { name: string; version: string } | null;
    isConnected: boolean;
    isInitialized: boolean;
    tools: Array<{ name: string; description: string; inputSchema: object }>;
    resources: Array<{ uri: string; name: string; description?: string; mimeType?: string }>;
  }>>([]);
  // 添加连接表单
  const [showAddForm, setShowAddForm] = useState(false);
  const [newConnForm, setNewConnForm] = useState({ name: '', transportType: 'stdio' as 'stdio' | 'sse' | 'http', command: '', args: '', url: '', cwd: '', headers: [] as Array<{ key: string; value: string }> });
  // 编辑连接表单
  const [editingConnId, setEditingConnId] = useState<string | null>(null);
  const [editConnForm, setEditConnForm] = useState({ name: '', transportType: 'stdio' as 'stdio' | 'sse' | 'http', command: '', args: '', url: '', cwd: '', headers: [] as Array<{ key: string; value: string }> });
  // 展开的工具区域
  const [expandedConnId, setExpandedConnId] = useState<string | null>(null);
  // 连接状态提示
  const [connMsg, setConnMsg] = useState<{ id: string; text: string; isError: boolean } | null>(null);
  // 工具启用状态（按连接ID存储）
  const [connEnabledTools, setConnEnabledTools] = useState<Record<string, string[]>>({});
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
    loadConnectedMcps();
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

  const loadConnectedMcps = async () => {
    try {
      const connections = await api.getMcpConnections();
      setConnectedMcps(connections);
      // 从运行时连接中加载已启用的工具列表
      const enabledMap: Record<string, string[]> = {};
      for (const conn of connections) {
        if (conn.isConnected) {
          enabledMap[conn.connectionId] = conn.tools.map(t => t.name);
        }
      }
      setConnEnabledTools(enabledMap);
    } catch (error) {
      console.error('Failed to load connected MCPs:', error);
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

  const handleAddConnection = async () => {
    if (!newConnForm.name) return;
    try {
      let result;
      if (newConnForm.transportType === 'sse' || newConnForm.transportType === 'http') {
        if (!newConnForm.url) return;
        result = await api.connectMcp({
          name: newConnForm.name,
          transportType: newConnForm.transportType,
          command: '',
          args: [],
          url: newConnForm.url,
          headers: newConnForm.headers.filter(h => h.key),
        });
      } else {
        if (!newConnForm.command) return;
        const args = newConnForm.args ? newConnForm.args.split(' ').filter(Boolean) : [];
        result = await api.connectMcp({
          name: newConnForm.name,
          transportType: 'stdio',
          command: newConnForm.command,
          args,
          cwd: newConnForm.cwd || undefined,
          url: undefined,
        });
      }
      setMcpConnections(result);
      setNewConnForm({ name: '', transportType: 'stdio', command: '', args: '', url: '', cwd: '', headers: [] });
      setShowAddForm(false);
      // 刷新运行时连接
      loadConnectedMcps();
    } catch (error) {
      console.error('Failed to add MCP connection:', error);
      alert('添加 MCP 连接失败');
    }
  };

  const handleDeleteConnection = async (connId: string) => {
    if (!confirm('确定删除此 MCP 连接配置？')) return;
    try {
      await api.disconnectMcp(connId);
      setMcpConnections(prev => ({ connections: prev.connections.filter(c => c.id !== connId) }));
      loadConnectedMcps();
    } catch (error) {
      console.error('Failed to delete MCP connection:', error);
    }
  };

  const handleStartEditing = (conn: MCPConnection) => {
    setEditingConnId(conn.id);
    setEditConnForm({
      name: conn.name,
      transportType: conn.transportType || 'stdio',
      command: conn.command || '',
      args: conn.args ? conn.args.join(' ') : '',
      url: conn.url || '',
      cwd: conn.cwd || '',
      headers: conn.headers ? conn.headers.map(h => ({ ...h })) : [],
    });
  };

  const handleSaveEdit = async () => {
    if (!editingConnId) return;
    try {
      const conns = mcpConnections.connections.map(c =>
        c.id === editingConnId
          ? {
              ...c,
              name: editConnForm.name,
              transportType: editConnForm.transportType,
              command: editConnForm.transportType === 'sse' || editConnForm.transportType === 'http' ? '' : editConnForm.command,
              args: editConnForm.transportType === 'sse' || editConnForm.transportType === 'http' ? [] : editConnForm.args.split(' ').filter(Boolean),
              url: editConnForm.transportType === 'sse' || editConnForm.transportType === 'http' ? editConnForm.url : undefined,
              cwd: editConnForm.transportType === 'stdio' ? editConnForm.cwd || undefined : undefined,
              headers: editConnForm.headers.filter(h => h.key),
            }
          : c
      );
      await api.updateMcpSettings({ connections: conns });
      setMcpConnections({ connections: conns });
      setEditingConnId(null);
    } catch (error) {
      console.error('Failed to update MCP connection:', error);
      alert('更新失败');
    }
  };

  const handleToggleConnEnabled = async (connId: string, enabled: boolean) => {
    const newConnections = mcpConnections.connections.map(c =>
      c.id === connId ? { ...c, enabled } : c
    );
    const updated = await api.updateMcpSettings({ connections: newConnections });
    setMcpConnections(updated);
  };

  const handleConnectServer = async (conn: MCPConnection) => {
    setConnMsg({ id: conn.id, text: '连接中...', isError: false });
    try {
      const result = await api.connectMcpServer({ 
        id: conn.id, 
        name: conn.name, 
        transportType: conn.transportType, 
        command: conn.command, 
        args: conn.args, 
        url: conn.url, 
        headers: conn.headers, 
        enabled: conn.enabled !== false 
      });
      setConnMsg({ id: conn.id, text: result.success ? '连接成功' : (result.connection as any)?.error || '连接失败', isError: !result.success });
      loadConnectedMcps();
    } catch (error) {
      setConnMsg({ id: conn.id, text: '连接出错: ' + ((error as Error).message), isError: true });
    }
  };

  const handleToggleTool = async (connectionId: string, toolName: string) => {
    const current = connEnabledTools[connectionId] || [];
    const next = current.includes(toolName)
      ? current.filter(t => t !== toolName)
      : [...current, toolName];
    const newMap = { ...connEnabledTools, [connectionId]: next };
    setConnEnabledTools(newMap);
    try {
      await api.updateMcpConnectionTools(connectionId, next);
    } catch (error) {
      console.error('Failed to update connection tools:', error);
      // 回滚
      setConnEnabledTools(prev => ({ ...prev, [connectionId]: current }));
    }
  };

  const getConnRuntimeInfo = (connId: string) => {
    return connectedMcps.find(c => c.connectionId === connId);
  };

  const getConnToolCount = (conn: MCPConnection) => {
    // 先从运行时获取
    const runtime = connectedMcps.find(c => c.connectionId === conn.id);
    if (runtime && runtime.isConnected && runtime.tools) return runtime.tools.length;
    return 0;
  };

  const renderMcpConnectionCard = (conn: MCPConnection) => {
    const runtimeInfo = getConnRuntimeInfo(conn.id);
    const isConnected = runtimeInfo?.isConnected ?? false;
    const isExpanded = expandedConnId === conn.id;
    const runtimeTools = runtimeInfo?.tools || [];
    const enabledTools = connEnabledTools[conn.id] || runtimeTools.map(t => t.name);
    const isEditing = editingConnId === conn.id;

    return (
      <div key={conn.id} style={{ marginBottom: 16, padding: 12, background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border-primary)' }}>
        {isEditing ? (
          <div>
            <div className="settings-item" style={{ marginBottom: 8 }}>
              <label>名称</label>
              <input type="text" value={editConnForm.name}
                onChange={e => setEditConnForm(p => ({ ...p, name: e.target.value }))}
                style={{ background: 'var(--input-bg)', border: '1px solid var(--border-primary)', borderRadius: 4, padding: '4px 8px', color: 'var(--text-primary)' }} />
            </div>
            <div className="settings-item" style={{ marginBottom: 8 }}>
              <label>传输类型</label>
              <select value={editConnForm.transportType}
                onChange={e => setEditConnForm(p => ({ ...p, transportType: e.target.value as 'stdio' | 'sse' }))}
                style={{ background: 'var(--input-bg)', border: '1px solid var(--border-primary)', borderRadius: 4, padding: '4px 8px', color: 'var(--text-primary)' }}>
                 <option value="stdio">Stdio (Shell 命令)</option>
                 <option value="sse">SSE (传统 SSE)</option>
                 <option value="http">HTTP (Streamable HTTP)</option>
               </select>
             </div>
            {editConnForm.transportType === 'stdio' ? (
              <>
                <div className="settings-item" style={{ marginBottom: 8 }}>
                  <label>命令</label>
                  <input type="text" value={editConnForm.command}
                    onChange={e => setEditConnForm(p => ({ ...p, command: e.target.value }))}
                    style={{ background: 'var(--input-bg)', border: '1px solid var(--border-primary)', borderRadius: 4, padding: '4px 8px', color: 'var(--text-primary)' }} />
                </div>
                <div className="settings-item" style={{ marginBottom: 8 }}>
                  <label>参数</label>
                  <input type="text" value={editConnForm.args}
                    onChange={e => setEditConnForm(p => ({ ...p, args: e.target.value }))}
                    placeholder="空格分隔的参数"
                    style={{ background: 'var(--input-bg)', border: '1px solid var(--border-primary)', borderRadius: 4, padding: '4px 8px', color: 'var(--text-primary)' }} />
                </div>
                <div className="settings-item" style={{ marginBottom: 8 }}>
                  <label>工作目录</label>
                  <input type="text" value={editConnForm.cwd}
                    onChange={e => setEditConnForm(p => ({ ...p, cwd: e.target.value }))}
                    placeholder="可选"
                    style={{ background: 'var(--input-bg)', border: '1px solid var(--border-primary)', borderRadius: 4, padding: '4px 8px', color: 'var(--text-primary)' }} />
                </div>
              </>
            ) : (
              <>
                <div className="settings-item" style={{ marginBottom: 8 }}>
                  <label>URL</label>
                  <input type="text" value={editConnForm.url}
                    onChange={e => setEditConnForm(p => ({ ...p, url: e.target.value }))}
                    placeholder="例如: http://localhost:3001/mcp"
                    style={{ background: 'var(--input-bg)', border: '1px solid var(--border-primary)', borderRadius: 4, padding: '4px 8px', color: 'var(--text-primary)' }} />
                </div>
                <div style={{ marginBottom: 8 }}>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 12, color: 'var(--text-secondary)' }}>请求头 (可选)</label>
                  {editConnForm.headers.map((h, i) => (
                    <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                      <input type="text" value={h.key}
                        onChange={e => {
                          const hdrs = [...editConnForm.headers];
                          hdrs[i] = { ...hdrs[i], key: e.target.value };
                          setEditConnForm(p => ({ ...p, headers: hdrs }));
                        }}
                        placeholder="Key"
                        style={{ width: '40%', background: 'var(--input-bg)', border: '1px solid var(--border-primary)', borderRadius: 4, padding: '4px 6px', color: 'var(--text-primary)', fontSize: 12 }} />
                      <input type="text" value={h.value}
                        onChange={e => {
                          const hdrs = [...editConnForm.headers];
                          hdrs[i] = { ...hdrs[i], value: e.target.value };
                          setEditConnForm(p => ({ ...p, headers: hdrs }));
                        }}
                        placeholder="Value"
                        style={{ flex: 1, background: 'var(--input-bg)', border: '1px solid var(--border-primary)', borderRadius: 4, padding: '4px 6px', color: 'var(--text-primary)', fontSize: 12 }} />
                      <button onClick={() => setEditConnForm(p => ({ ...p, headers: p.headers.filter((_, j) => j !== i) }))}
                        style={{ padding: '2px 6px', fontSize: 11, background: 'transparent', border: '1px solid var(--danger)', borderRadius: 4, color: 'var(--danger)', cursor: 'pointer' }}>×</button>
                    </div>
                  ))}
                  <button onClick={() => setEditConnForm(p => ({ ...p, headers: [...p.headers, { key: '', value: '' }] }))}
                    style={{ padding: '2px 8px', fontSize: 11, background: 'transparent', border: '1px dashed var(--border-primary)', borderRadius: 4, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                    + 添加请求头
                  </button>
                </div>
              </>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="btn-primary" onClick={handleSaveEdit} style={{ padding: '4px 12px', fontSize: 12 }}>保存</button>
              <button className="btn-secondary" onClick={() => setEditingConnId(null)} style={{ padding: '4px 12px', fontSize: 12 }}>取消</button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 14 }}>{conn.name}</div>
                {conn.transportType === 'sse' || conn.transportType === 'http' ? (
                  <div style={{ color: 'var(--text-secondary)', fontSize: 12, fontFamily: 'monospace' }}>
                    {conn.transportType === 'sse' ? 'SSE' : 'HTTP'}: {conn.url || '-'}
                  </div>
                ) : (
                  <div style={{ color: 'var(--text-secondary)', fontSize: 12, fontFamily: 'monospace' }}>
                    {conn.command} {conn.args.join(' ')}
                    {conn.cwd && <span style={{ marginLeft: 8, fontSize: 11, opacity: 0.7 }}>cwd: {conn.cwd}</span>}
                  </div>
                )}
              </div>
              <span style={{
                fontSize: 11, padding: '2px 8px', borderRadius: 10,
                background: isConnected ? 'var(--success-bg)' : 'var(--bg-primary)',
                color: isConnected ? 'var(--success-color)' : 'var(--text-secondary)',
                border: '1px solid ' + (isConnected ? 'var(--success-color)' : 'var(--border-primary)'),
              }}>
                {isConnected ? '已连接' : '未连接'}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                {getConnToolCount(conn)} 工具
              </span>
            </div>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              <label className="settings-item" style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', margin: 0, fontSize: 12 }}>
                <input type="checkbox" checked={conn.enabled}
                  onChange={e => handleToggleConnEnabled(conn.id, e.target.checked)} />
                启用
              </label>
              <button onClick={() => handleConnectServer(conn)}
                style={{ padding: '3px 10px', fontSize: 11, background: isConnected ? 'var(--danger)' : 'var(--accent-color)', border: 'none', borderRadius: 4, color: '#fff', cursor: 'pointer' }}>
                {isConnected ? '重连' : '连接'}
              </button>
              <button onClick={() => handleStartEditing(conn)}
                style={{ padding: '3px 10px', fontSize: 11, background: 'var(--bg-primary)', border: '1px solid var(--border-primary)', borderRadius: 4, color: 'var(--text-primary)', cursor: 'pointer' }}>
                编辑
              </button>
              <button onClick={() => handleDeleteConnection(conn.id)}
                style={{ padding: '3px 10px', fontSize: 11, background: 'transparent', border: '1px solid var(--danger)', borderRadius: 4, color: 'var(--danger)', cursor: 'pointer' }}>
                删除
              </button>
              {connMsg && connMsg.id === conn.id && (
                <span style={{ fontSize: 11, color: connMsg.isError ? 'var(--danger)' : 'var(--success-color)', marginLeft: 4 }}>
                  {connMsg.text}
                </span>
              )}
            </div>

            {/* 工具展开区 */}
            <div>
              <button onClick={() => setExpandedConnId(isExpanded ? null : conn.id)}
                style={{ padding: '2px 8px', fontSize: 11, background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                {isExpanded ? '▲ 收起工具' : '▼ 展开工具 (' + runtimeTools.length + ')'}
              </button>
              {isExpanded && (
                <div style={{ marginTop: 8, padding: 8, background: 'var(--bg-primary)', borderRadius: 6 }}>
                  {runtimeTools.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>暂无可用工具，请先连接</div>
                  ) : (
                    runtimeTools.map(tool => (
                      <label key={tool.name} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', cursor: 'pointer', fontSize: 12 }}>
                        <input type="checkbox" checked={enabledTools.includes(tool.name)}
                          onChange={() => handleToggleTool(conn.id, tool.name)} />
                        <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{tool.name}</span>
                        <span style={{ color: 'var(--text-secondary)', marginLeft: 4, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {tool.description}
                        </span>
                      </label>
                    ))
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    );
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
            <div className="settings-section">
              <h3>输入</h3>
              <div className="settings-item">
                <label>发送快捷键</label>
                <select
                  value={localSettings.sendKey}
                  onChange={(e) => {
                    const val = e.target.value as any;
                    setLocalSettings({ ...localSettings, sendKey: val });
                    updateSettings({ sendKey: val } as any);
                  }}
                  style={{
                    padding: '6px 12px',
                    background: 'var(--bg-primary)',
                    border: 'none',
                    borderRadius: 6,
                    color: 'var(--text-primary)',
                  }}
                >
                  <option value="alt+s">Alt + S</option>
                  <option value="enter">Enter</option>
                  <option value="ctrl+enter">Ctrl + Enter</option>
                  <option value="ctrl+s">Ctrl + S</option>
                </select>
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0 }}>MCP 服务连接</h3>
              <button onClick={() => setShowAddForm(!showAddForm)}
                style={{ padding: '6px 14px', background: 'var(--accent-color)', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', fontSize: 13 }}>
                {showAddForm ? '取消' : '+ 添加连接'}
              </button>
            </div>

            {/* 添加连接表单 */}
            {showAddForm && (
              <div style={{ marginBottom: 16, padding: 12, background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border-primary)' }}>
                <div className="settings-item" style={{ marginBottom: 8 }}>
                  <label>名称</label>
                  <input type="text" value={newConnForm.name}
                    onChange={e => setNewConnForm(p => ({ ...p, name: e.target.value }))}
                    placeholder="例如: PostgreSQL MCP"
                    style={{ flex: 1, background: 'var(--input-bg)', border: '1px solid var(--border-primary)', borderRadius: 4, padding: '6px 8px', color: 'var(--text-primary)' }} />
                </div>
                <div className="settings-item" style={{ marginBottom: 8 }}>
                  <label>传输类型</label>
                  <select value={newConnForm.transportType}
                    onChange={e => setNewConnForm(p => ({ ...p, transportType: e.target.value as 'stdio' | 'sse' }))}
                    style={{ background: 'var(--input-bg)', border: '1px solid var(--border-primary)', borderRadius: 4, padding: '6px 8px', color: 'var(--text-primary)' }}>
                    <option value="stdio">Stdio (Shell 命令)</option>
                    <option value="sse">SSE (传统 SSE)</option>
                    <option value="http">HTTP (Streamable HTTP)</option>
                  </select>
                </div>
                {newConnForm.transportType === 'stdio' ? (
                  <>
                    <div className="settings-item" style={{ marginBottom: 8 }}>
                      <label>命令</label>
                      <input type="text" value={newConnForm.command}
                        onChange={e => setNewConnForm(p => ({ ...p, command: e.target.value }))}
                        placeholder="例如: npx"
                        style={{ flex: 1, background: 'var(--input-bg)', border: '1px solid var(--border-primary)', borderRadius: 4, padding: '6px 8px', color: 'var(--text-primary)' }} />
                    </div>
                    <div className="settings-item" style={{ marginBottom: 12 }}>
                      <label>参数</label>
                      <input type="text" value={newConnForm.args}
                        onChange={e => setNewConnForm(p => ({ ...p, args: e.target.value }))}
                        placeholder="例如: -y @modelcontextprotocol/server-postgres ..."
                        style={{ flex: 1, background: 'var(--input-bg)', border: '1px solid var(--border-primary)', borderRadius: 4, padding: '6px 8px', color: 'var(--text-primary)' }} />
                    </div>
                    <div className="settings-item" style={{ marginBottom: 12 }}>
                      <label>工作目录</label>
                      <input type="text" value={newConnForm.cwd}
                        onChange={e => setNewConnForm(p => ({ ...p, cwd: e.target.value }))}
                        placeholder="例如: C:/aias-browser-mcp（可选）"
                        style={{ flex: 1, background: 'var(--input-bg)', border: '1px solid var(--border-primary)', borderRadius: 4, padding: '6px 8px', color: 'var(--text-primary)' }} />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="settings-item" style={{ marginBottom: 8 }}>
                      <label>URL</label>
                      <input type="text" value={newConnForm.url}
                        onChange={e => setNewConnForm(p => ({ ...p, url: e.target.value }))}
                        placeholder="例如: http://localhost:3001/mcp"
                        style={{ flex: 1, background: 'var(--input-bg)', border: '1px solid var(--border-primary)', borderRadius: 4, padding: '6px 8px', color: 'var(--text-primary)' }} />
                    </div>
                    <div style={{ marginBottom: 8 }}>
                      <label style={{ display: 'block', marginBottom: 4, fontSize: 12, color: 'var(--text-secondary)' }}>请求头 (可选)</label>
                      {newConnForm.headers.map((h, i) => (
                        <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                          <input type="text" value={h.key}
                            onChange={e => {
                              const hdrs = [...newConnForm.headers];
                              hdrs[i] = { ...hdrs[i], key: e.target.value };
                              setNewConnForm(p => ({ ...p, headers: hdrs }));
                            }}
                            placeholder="Key"
                            style={{ width: '40%', background: 'var(--input-bg)', border: '1px solid var(--border-primary)', borderRadius: 4, padding: '4px 6px', color: 'var(--text-primary)', fontSize: 12 }} />
                          <input type="text" value={h.value}
                            onChange={e => {
                              const hdrs = [...newConnForm.headers];
                              hdrs[i] = { ...hdrs[i], value: e.target.value };
                              setNewConnForm(p => ({ ...p, headers: hdrs }));
                            }}
                            placeholder="Value"
                            style={{ flex: 1, background: 'var(--input-bg)', border: '1px solid var(--border-primary)', borderRadius: 4, padding: '4px 6px', color: 'var(--text-primary)', fontSize: 12 }} />
                          <button onClick={() => setNewConnForm(p => ({ ...p, headers: p.headers.filter((_, j) => j !== i) }))}
                            style={{ padding: '2px 6px', fontSize: 11, background: 'transparent', border: '1px solid var(--danger)', borderRadius: 4, color: 'var(--danger)', cursor: 'pointer' }}>×</button>
                        </div>
                      ))}
                      <button onClick={() => setNewConnForm(p => ({ ...p, headers: [...p.headers, { key: '', value: '' }] }))}
                        style={{ padding: '2px 8px', fontSize: 11, background: 'transparent', border: '1px dashed var(--border-primary)', borderRadius: 4, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                        + 添加请求头
                      </button>
                    </div>
                  </>
                )}
                <button onClick={handleAddConnection}
                  disabled={!newConnForm.name || (newConnForm.transportType === 'stdio' ? !newConnForm.command : !newConnForm.url)}
                  style={{ padding: '6px 16px', background: 'var(--accent-color)', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', fontSize: 13, opacity: (!newConnForm.name || (newConnForm.transportType === 'stdio' ? !newConnForm.command : !newConnForm.url)) ? 0.5 : 1 }}>
                  添加
                </button>
              </div>
            )}

            {mcpConnections.connections.length === 0 ? (
              <div style={{ color: 'var(--text-secondary)', padding: 20, textAlign: 'center' }}>
                暂无 MCP 服务连接
              </div>
            ) : (
              mcpConnections.connections.map(conn => renderMcpConnectionCard(conn))
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
