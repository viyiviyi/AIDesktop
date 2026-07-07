import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useDesktop } from '../contexts/DesktopContext';
import { useToast } from '../contexts/ToastContext';
import type { Message, Content, FormSchema } from '../types';
import * as api from '../services/api';
import { useAgentEventStream } from '../services/useAgentEventStream';
import type { WsConvEvent } from '../services/useAgentEventStream';
import { FormComponent } from './FormComponent';
import { WorkspaceDirSelector } from './WorkspaceDirSelector';
import { PictureFilled } from '@ant-design/icons';
import { InjectionBar } from './InjectionBar';
import { MemoryPanel } from './MemoryPanel';
import { MessageList } from './MessageList';

interface PendingFormEntry {
  formId: string;
  schema: FormSchema;
  toolCallId: string;
  submittedData?: Record<string, unknown> | null;
  cancelled?: boolean;
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
  const { addToast, confirm } = useToast();
  const { state, setConversationTitle, updateWindow } = useDesktop();
  const [conversations, setConversations] = useState<{ id: string; title: string; preview?: string; createdAt?: string; workspaceDir?: string | null }[]>([]);
  const [currentConvId, setCurrentConvId] = useState<string | null>(
    conversationId && !conversationId.startsWith('conv-') ? conversationId : null
  );
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showConvList, setShowConvList] = useState(false);
  const [showConvSettings, setShowConvSettings] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState('');
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  // 输入框 ref，用于发送后重置高度和聚焦
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  // 流式消息累积状态（WebSocket 事件驱动）
  const [streamingText, setStreamingText] = useState<string>('');
  const [toolCalls, setToolCalls] = useState<Array<{ toolCallId: string; toolName: string; args: unknown; result?: unknown; isError?: boolean }>>([]);
  const [thinkingText, setThinkingText] = useState<string>('');
  // 回复 & 编辑 & 分支状态
  const [replyToId, setReplyToId] = useState<string | null>(null);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editInput, setEditInput] = useState('');
  // 跳转高亮消息 id
  const [highlightMsgId, setHighlightMsgId] = useState<string | undefined>(undefined);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const initRef = useRef(false);
  const currentConvIdRef = useRef(currentConvId);
  currentConvIdRef.current = currentConvId;
  // 多模态输入 — 附件列表
  const [attachments, setAttachments] = useState<{ id: string; type: 'image' | 'audio' | 'video' | 'file'; url: string; name: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 表单状态 — 等待用户填写的表单
  const [pendingForms, setPendingForms] = useState<Map<string, PendingFormEntry>>(new Map());
  // 待处理的工作目录授权请求
  const [workspaceRequest, setWorkspaceRequest] = useState<{ toolCallId: string; requestedPath?: string } | null>(null);
  // 工作目录修改弹窗
  const [workspaceEditOpen, setWorkspaceEditOpen] = useState(false);

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
      // 同步会话标题到全局 context（供 Dock 菜单使用）
      mapped.forEach(c => { if (c.id) setConversationTitle(c.id, c.title); });

      if (convs.length > 0) {
        // 有已有会话，用最新的有消息的会话
        const target = convs.find(c => c.messages.length > 0) || convs[0];
        setCurrentConvId(target.id);
        // 同步真实会话 ID 到 WindowState（供 Dock 菜单查找会话标题使用）
        updateWindow(windowId, { conversationId: target.id });
      } else {
        // 没有会话，创建一个
        return api.createConversation(appId, `窗口 ${Date.now()}`).then(conv => {
          setConversations([{ id: conv.id, title: conv.title, createdAt: conv.createdAt, workspaceDir: conv.workspaceDir }]);
          setConversationTitle(conv.id, conv.title);
          setCurrentConvId(conv.id);
          // 同步真实会话 ID 到 WindowState
          updateWindow(windowId, { conversationId: conv.id });
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
        // 同时更新 toolCalls（实时卡片）和 messages（消息内的 toolCall 块）
        setToolCalls(prev =>
          prev.map(tc =>
            tc.toolCallId === event.data.toolCallId
              ? { ...tc, result: event.data.result, isError: event.data.isError as boolean }
              : tc
          )
        );
        setMessages(prev =>
          prev.map(msg => {
            if (msg.role !== 'assistant') return msg;
            const hasMatch = msg.content.some(c =>
              (c as any).type === 'toolCall' && (c as any).id === event.data.toolCallId
            );
            if (!hasMatch) return msg;
            return {
              ...msg,
              content: msg.content.map(c =>
                (c as any).type === 'toolCall' && (c as any).id === event.data.toolCallId
                  ? { ...(c as any), result: event.data.result, isError: event.data.isError as boolean }
                  : c
              ),
            };
          })
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
          setThinkingText('');
          break;
        }
        // 构建完整消息 content，保留之前实时写入的 result
        const msgContent: any[] = [];
        if (text) msgContent.push({ type: 'text', text });
        for (const tc of toolCallBlocks) {
          const tcBlock: any = { type: 'toolCall', id: tc.id, name: tc.name, arguments: tc.arguments || {} };
          msgContent.push(tcBlock);
        }
        const finalMsg: Message = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role: 'assistant',
          content: msgContent.length > 0 ? msgContent : [{ type: 'text', text: text || '' }],
          timestamp: new Date().toISOString(),
        };
        setMessages(prev => {
          // 从现有 messages 中提取已实时写入的 toolCall result
          for (const tcBlock of msgContent) {
            if (tcBlock.type !== 'toolCall') continue;
            for (const msg of prev) {
              if (msg.role !== 'assistant') continue;
              const existing = (msg.content as any[]).find((c: any) => c.type === 'toolCall' && c.id === tcBlock.id);
              if (existing && existing.result !== undefined) {
                tcBlock.result = existing.result;
                tcBlock.isError = existing.isError;
                break;
              }
            }
          }
          finalMsg.content = msgContent;
          const last = prev[prev.length - 1];
          if (last && last.role === 'assistant' && !getMessageText(last) && !last.content.some(c => (c as any).type === 'toolCall' || (c as any).type === 'tool_result')) {
            return [...prev.slice(0, -1), finalMsg];
          }
          return [...prev, finalMsg];
        });
        setStreamingText('');
        // 不入 toolCalls，由 done 事件统一清理
        setThinkingText('');
        break;
      }
      case 'done':
        // 完成后重新加载当前会话消息同步
        setIsLoading(false);
        setToolCalls([]);
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
        const reqToolCallId = (event.data.toolCallId as string) || '';
        if (formId && schema) {
          // 用 form-${toolCallId} 作为统一 key，与 loadMessages 恢复时一致
          const unifiedKey = reqToolCallId ? `form-${reqToolCallId}` : formId;
          setPendingForms(prev => {
            const next = new Map(prev);
            next.set(unifiedKey, { formId: unifiedKey, schema, toolCallId: reqToolCallId });
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
        const respondToolCallId = (event.data as any).toolCallId as string;
        const submittedData = event.data.formData as Record<string, unknown> | undefined;
        const allDone = (event.data as any).allDone as boolean;
        // 用 toolCallId 派生统一 key（与 form_request handler 和 loadMessages 一致）
        const matchKey = respondToolCallId ? `form-${respondToolCallId}` : respondFormId;
        if (allDone) {
          // 所有表单都已完成，清除 pendingForms，等待 agent 回复
          setPendingForms(new Map());
          setIsLoading(true);
          setThinkingText('处理中...');
          setStreamingText('');
          setToolCalls([]);
        } else if (matchKey) {
          setPendingForms(prev => {
            const entry = prev.get(matchKey);
            if (!entry) return prev;
            const next = new Map(prev);
            if (event.type === 'form_cancelled') {
              next.set(matchKey, { ...entry, cancelled: true, submittedData: undefined });
            } else {
              next.set(matchKey, { ...entry, submittedData: submittedData || {}, cancelled: false });
            }
            return next;
          });
        }
        break;
      }
      case 'workspace_response': {
        setWorkspaceRequest(null);
        break;
      }
      case 'workspace_cancelled': {
        setWorkspaceRequest(null);
        addToast('error', '不允许访问此目录');
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
      // 同步会话标题到全局
      mapped.forEach(c => { if (c.id) setConversationTitle(c.id, c.title); });
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
      // 用 getConvTitle 逻辑更新会话标题（与开始菜单一致）
      const newTitle = (() => {
        const msgs = conv.messages;
        const firstUser = msgs.find(m => m.role === 'user');
        if (firstUser) {
          const text = firstUser.content
            .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
            .map(c => c.text).join('').trim();
          if (text.length >= 4) return text.slice(0, 150);
        }
        const firstAssistant = msgs.find(m => m.role === 'assistant');
        if (firstAssistant) {
          const text = firstAssistant.content
            .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
            .map(c => c.text).join('').trim();
          if (text.length > 0) return text.slice(0, 50);
        }
        return conv.title || '新会话';
      })();
      if (newTitle !== conv.title) {
        await api.updateConversationTitle(appId, convId, newTitle).catch(() => {});
        setConversations(prev => prev.map(c =>
          c.id === convId ? { ...c, title: newTitle } : c
        ));
        setConversationTitle(convId, newTitle);
      }
      // 从消息列表中推导表单状态：检查每个 assistant 消息是否有 form toolCall
      const restored = new Map<string, PendingFormEntry>();
      for (let i = 0; i < conv.messages.length; i++) {
        const msg = conv.messages[i];
        if (msg.role !== 'assistant') continue;
        // 收集这条消息中所有的 form toolCall
        const formToolCalls = (msg.content || []).filter((c: any) =>
          c.type === 'toolCall' && (c.name === 'mcp_form_requestInput' || c.name === 'mcp.form.requestInput')
        );
        if (formToolCalls.length === 0) continue;
        // 检查每个 form toolCall 是否有对应的 toolResult
        const results: { tc: any; hasResult: boolean; resultData: Record<string, unknown> | null; isCancelled: boolean }[] = [];
        let allHaveResults = true;
        for (const tc of formToolCalls) {
          let hasResult = false;
          let resultData: Record<string, unknown> | null = null;
          let isCancelled = false;
          for (let j = i + 1; j < conv.messages.length; j++) {
            const next = conv.messages[j];
            if (next.role === 'toolResult' && next.toolResultMeta?.toolCallId === tc.id) {
              const text = next.content.filter((x: any) => x.type === 'text').map((x: any) => x.text).join('');
              hasResult = true;
              try {
                const parsed = JSON.parse(text);
                if (parsed.status === 'cancelled') {
                  isCancelled = true;
                } else {
                  resultData = parsed;
                }
              } catch {
                resultData = { value: text };
              }
              break;
            }
          }
          results.push({ tc, hasResult, resultData, isCancelled });
          if (!hasResult) allHaveResults = false;
        }
        if (allHaveResults) {
          // 全部都有 toolResult → 不渲染表单，走常规 toolCall/toolResult 渲染
          continue;
        }
        // 存在缺少 toolResult 的 → 渲染为表单，已有结果的填充数据
        for (const r of results) {
          const formId = `form-${r.tc.id}`;
          const schema: FormSchema = {
            title: (r.tc.arguments as any)?.title || '请填写表单',
            description: (r.tc.arguments as any)?.description || '',
            fields: ((r.tc.arguments as any)?.fields || []).map((f: any) => ({
              name: f.name, label: f.label, type: f.type || 'text',
              required: f.required, options: f.options, placeholder: f.placeholder,
              accept: f.accept, description: f.description,
            })),
          };
          restored.set(formId, {
            formId,
            toolCallId: r.tc.id,
            schema,
            submittedData: r.hasResult && !r.isCancelled ? r.resultData : undefined,
            cancelled: r.hasResult && r.isCancelled ? true : undefined,
          });
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
      const title = input.trim() || `会话 ${conversations.length + 1}`;
      const conv = await api.createConversation(appId, title);
      setConversations([...conversations, { id: conv.id, title: conv.title, workspaceDir: conv.workspaceDir }]);
      setConversationTitle(conv.id, conv.title);
      setCurrentConvId(conv.id);
      setMessages([]);
      setShowConvList(false);
      // 如果有输入内容，自动发送并更新标题
      if (input.trim()) {
        const messageContent = input;
        const content: Content[] = [{ type: 'text', text: messageContent }];
        setInput('');
        // 重置输入框高度
        if (inputRef.current) {
          inputRef.current.style.height = '';
        }
        setIsLoading(true);
        try {
          await api.sendMessage(appId, conv.id, content);
          // 用第一条消息自动生成会话标题（与开始菜单逻辑一致）
          const title = (() => {
            const text = messageContent.trim();
            if (text.length >= 4) return text.slice(0, 150);
            return text.slice(0, 50) || '新会话';
          })();
          // 保存标题，后续 AI 回复后 loadMessages 时会用 getConvTitle 重新计算
          await api.updateConversationTitle(appId, conv.id, title);
          setConversations(prev => prev.map(c =>
            c.id === conv.id ? { ...c, title } : c
          ));
          setConversationTitle(conv.id, title);
        } catch {}
      }
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
          setConversationTitle(conv.id, conv.title);
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
      setConversationTitle(renamingId, renameTitle.trim());
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
    // 同步 WindowState.conversationId，让 Dock 菜单显示正确的会话标题
    updateWindow(windowId, { conversationId: convId });
    // 如果有缓存的会话标题，确保全局已同步
    const conv = conversations.find(c => c.id === convId);
    if (conv) {
      setConversationTitle(conv.id, conv.title);
    }
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
    // 重置输入框高度
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }
    // 发送后保持焦点在输入框（延迟到 React 批量更新后）
    setTimeout(() => { inputRef.current?.focus(); }, 0);
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

  // 跳转到消息
  const scrollToMsg = (msgId: string) => {
    const el = messageRefs.current.get(msgId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightMsgId(msgId);
      setTimeout(() => setHighlightMsgId(undefined), 2000);
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
    if (!currentConvId || !!workspaceRequest) return;
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

  // 判断是否可以继续（输入框为空时显示"继续"按钮的条件）
  // 1. 最后一条是 user → 该 user 消息需要 AI 回复（可继续）
  // 2. 最后一条是 assistant 且有 toolCall → 需要执行工具后再继续
  // 3. 最后一条是 assistant 且无 toolCall → 不可继续，必须用户输入
  const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
  const canContinue = lastMsg
    ? (lastMsg.role === 'user') ||
      (lastMsg.role === 'assistant' && lastMsg.content.some((c: any) => c.type === 'toolCall'))
    : false;

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
    // 内容清空时恢复初始高度
    if (!el.value.trim()) {
      el.style.height = '';
    } else {
      el.style.height = Math.min(el.scrollHeight, 120) + 'px';
    }
  };

  // 提取消息文本内容
  const getMessageText = (msg: Message): string => {
    return msg.content
      .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
      .map((c) => c.text)
      .join('');
  };

  const formatShortDateTime = (ts: string): string => {
    try {
      const d = new Date(ts);
      return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
        + ' ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
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
            <span
              className="chat-header-workspace"
              title={`工作目录: ${currentConv.workspaceDir}，点击更改`}
              onClick={() => setWorkspaceEditOpen(true)}
              style={{ cursor: 'pointer' }}
            >
              📁 {currentConv.workspaceDir}
            </span>
          ) : null;
        })()}
        <button className="chat-header-btn chat-header-btn-primary" onClick={createNewConversation} title="新建会话">
          +
        </button>
        {conversationId && (
          <button className="chat-header-btn" onClick={() => setShowConvSettings(true)} title="会话设置">
            ⚙️
          </button>
        )}
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

      {/* 注入标记栏 — 标题栏和消息列表之间 */}
      <InjectionBar appId={appId} convId={currentConvId} />

      {/* 会话设置弹窗 */}
      {showConvSettings && currentConvId && (
        <div className="conv-settings-overlay" onClick={() => setShowConvSettings(false)}>
          <div className="conv-settings-panel" onClick={e => e.stopPropagation()}>
            <div className="conv-settings-header">
              <h3>会话设置</h3>
              <button className="conv-settings-close" onClick={() => setShowConvSettings(false)}>×</button>
            </div>
            <div className="conv-settings-body">
              <MemoryPanel appId={appId} convId={currentConvId} scope="conversation" showGoals />
            </div>
          </div>
        </div>
      )}

      {/* 消息列表 */}
      <MessageList
        messages={messages}
        isLoading={isLoading}
        streamingText={streamingText}
        thinkingText={thinkingText}
        toolCalls={toolCalls}
        pendingForms={pendingForms}
        workspaceRequest={workspaceRequest}
        onReply={startReply}
        onEdit={startEdit}
        onDelete={deleteMsg}
        onReplyClick={handleReplyClick}
        highlightMsgId={highlightMsgId}
        renderPendingForm={(formId, schema, toolCallId) => {
          // 从 pendingForms 中获取完整的表单状态（如已提交数据）
          const entry = pendingForms.get(formId);
          return (
            <FormComponent
              appId={appId!}
              convId={currentConvId!}
              formId={formId}
              toolCallId={toolCallId}
              schema={schema}
              submittedData={entry?.submittedData}
              cancelled={entry?.cancelled}
              onSubmitted={() => {
                // 同步标记 pendingForms 中的该表单为已提交（不等 ws 事件）
                setPendingForms(prev => {
                  const entry = prev.get(formId);
                  if (!entry) return prev;
                  const next = new Map(prev);
                  next.set(formId, { ...entry, submittedData: entry.submittedData || {} });
                  return next;
                });
                // ws 的 form_response 事件会处理 UI 更新，这里不额外操作
              }}
              onCancelled={() => {
                setPendingForms(prev => {
                  const entry = prev.get(formId);
                  if (!entry) return prev;
                  const next = new Map(prev);
                  next.set(formId, { ...entry, cancelled: true, submittedData: undefined });
                  return next;
                });
              }}
            />
          );
        }}
        renderWorkspaceRequest={(toolCallId, requestedPath) => (
          <WorkspaceDirSelector
            appId={appId!}
            convId={currentConvId!}
            toolCallId={toolCallId}
            requestedPath={requestedPath}
            onSubmitted={() => {
              setWorkspaceRequest(null);
              loadMessages(currentConvId!).then(() => {
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
        )}
      />

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
      {/* 工作目录修改弹窗 */}
      {workspaceEditOpen && (() => {
        const currentConv = conversations.find(c => c.id === currentConvId);
        return (
          <div className="modal-overlay" onClick={() => setWorkspaceEditOpen(false)}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
              <WorkspaceDirSelector
                appId={appId!}
                convId={currentConvId!}
                toolCallId=""
                currentDir={currentConv?.workspaceDir || undefined}
                isEditMode={true}
                onSubmitted={(path) => {
                  setWorkspaceEditOpen(false);
                  fetch(`/api/apps/${appId}/conversations/${currentConvId}/workspace-response`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ toolCallId: '', path, cancelled: false }),
                  }).then(() => {
                    setConversations(prev => prev.map(c =>
                      c.id === currentConvId ? { ...c, workspaceDir: path } : c
                    ));
                  }).catch(() => {});
                }}
                onCancelled={() => setWorkspaceEditOpen(false)}
              />
            </div>
          </div>
        );
      })()}
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
                ref={inputRef}
                value={input}
                onChange={(e) => { setInput(e.target.value); autoResize(e); }}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder={workspaceRequest ? '请先完成授权...' : (pendingForms.size > 0 ? '请先填写表单...' : (replyToId ? '输入回复...' : '输入消息...'))}
                disabled={!currentConvId || isLoading || pendingForms.size > 0 || !!workspaceRequest}
                rows={1}
              />
              <button
                onClick={() => {
                  if (input.trim() || attachments.length > 0) {
                    sendMessage(replyToId || undefined);
                  } else if (currentConvId && !isLoading && pendingForms.size === 0 && canContinue) {
                    // 输入为空且可以继续时触发继续
                    handleContinue();
                  }
                }}
                disabled={!currentConvId || isLoading || pendingForms.size > 0 || !!workspaceRequest || (input.trim() || attachments.length > 0 ? false : messages.length === 0 || !canContinue)}
              >
                {(input.trim() || attachments.length > 0) ? '发送' : (canContinue ? '继续' : '发送')}
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
