import React, { useState, useRef, useCallback, useEffect } from 'react';
import { MarkdownView } from './MarkdownView';
import type { Message, FormSchema } from '../types';

// ── 类型 ──

export interface MessageListProps {
  messages: Message[];
  isLoading: boolean;
  streamingText: string;
  thinkingText: string;
  toolCalls: Array<{ toolCallId: string; toolName: string; args?: unknown; result?: unknown; isError?: boolean }>;
  /** 待填表单 */
  pendingForms?: Map<string, { formId: string; schema: FormSchema; toolCallId: string }>;
  /** 工作区路径确认请求 */
  workspaceRequest?: { toolCallId: string; requestedPath?: string } | null;

  /** 回复消息 */
  onReply?: (msgId: string) => void;
  /** 编辑消息 */
  onEdit?: (msg: Message) => void;
  /** 删除消息 */
  onDelete?: (msgId: string) => void;
  /** 跳转到被回复的消息 */
  onReplyClick?: (msgId: string) => void;
  /** 自定义渲染消息内容（缺省使用 renderMessageContent） */
  renderMessageContent: (msg: Message, expandedSet: Set<string>, toggleExpand: (msgId: string, toolCallId: string) => void, allMessages?: Message[], idx?: number) => React.ReactNode;
  /** 高亮的消息 ID */
  highlightMsgId?: string | null;
  /** 流式 tool call 展开状态 */
  toolExpandStore?: Map<string, boolean>;
}

// ── 工具 ──

function formatTime(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function getMessageText(msg: Message): string {
  return msg.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('');
}

// ── 组件 ──

export function MessageList({
  messages,
  isLoading,
  streamingText,
  thinkingText,
  toolCalls,
  pendingForms,
  workspaceRequest,
  onReply,
  onEdit,
  onDelete,
  onReplyClick,
  renderMessageContent,
  highlightMsgId,
}: MessageListProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // toolCall 展开状态
  const [expandedByMsg, setExpandedByMsg] = useState<Record<string, Set<string>>>({});
  const toggleToolExpand = useCallback((msgId: string, toolCallId: string) => {
    setExpandedByMsg(prev => {
      const next = { ...prev };
      const set = new Set(next[msgId] || []);
      if (set.has(toolCallId)) set.delete(toolCallId);
      else set.add(toolCallId);
      next[msgId] = set;
      return next;
    });
  }, []);

  // 分支折叠
  const [collapsedBranches, setCollapsedBranches] = useState<Set<string>>(new Set());
  const toggleBranch = useCallback((key: string) => {
    setCollapsedBranches(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // 自动滚动
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  // 分支折叠计算
  const msgMap = new Map(messages.map(m => [m.id, m]));
  const branchRanges: Array<{ start: number; end: number; key: string }> = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.replyTo && msgMap.has(msg.replyTo!)) {
      const repliedIdx = messages.findIndex(m => m.id === msg.replyTo);
      if (repliedIdx >= 0 && repliedIdx + 1 <= i - 1) {
        branchRanges.push({ start: repliedIdx + 1, end: i - 1, key: `branch-${msg.id}` });
      }
    }
  }

  const isInCollapsedRange = (idx: number): string | null => {
    for (const range of branchRanges) {
      if (collapsedBranches.has(range.key) && idx >= range.start && idx <= range.end) return range.key;
    }
    return null;
  };

  const renderedRanges = new Set<string>();

  return (
    <div className="chat-messages">
      {messages.map((msg, idx) => {
        const rangeKey = isInCollapsedRange(idx);
        if (rangeKey) return null;
        if (msg.role === 'toolResult') return null;

        const replyToMsg = msg.replyTo ? msgMap.get(msg.replyTo) : undefined;
        const isHighlight = highlightMsgId === msg.id;

        // 折叠按钮
        const foldButton = (() => {
          for (const range of branchRanges) {
            if (range.end === idx - 1 && !renderedRanges.has(range.key)) {
              renderedRanges.add(range.key);
              const count = range.end - range.start + 1;
              const isCollapsed = collapsedBranches.has(range.key);
              return (
                <div className="branch-header" key={`fold-${range.key}`}>
                  <button className="branch-toggle" onClick={() => toggleBranch(range.key)}
                    title={isCollapsed ? '展开历史分支' : '折叠历史分支'}>
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

            {/* 引用条 */}
            {replyToMsg && (
              <div className="reply-reference" onClick={() => onReplyClick?.(msg.replyTo!)} title="点击跳转到被回复的消息">
                <span className="reply-ref-icon">↩</span>
                <span className="reply-ref-text">
                  回复了 {replyToMsg.role === 'user' ? 'user' : 'assistant'}: {getMessageText(replyToMsg).slice(0, 50)}
                </span>
              </div>
            )}

            {/* 消息主体 */}
            <div className={`chat-message ${msg.role} ${isHighlight ? 'highlight' : ''} ${(msg as any).edited ? 'edited' : ''}`}>
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
                {renderMessageContent(msg, expandedByMsg[msg.id] || new Set(), toggleToolExpand, messages, idx)}
                {(msg as any).edited && <span className="edited-badge"> (已编辑)</span>}
              </div>

              <div className="chat-message-footer">
                {msg.timestamp && <span className="chat-message-timestamp">{formatTime(msg.timestamp)}</span>}
                <span style={{ flex: 1 }} />
                {onReply && <button className="msg-action-btn" onClick={() => onReply(msg.id)} title="回复此消息">↩</button>}
                {msg.role === 'user' && !(msg as any).edited && onEdit && (
                  <button className="msg-action-btn" onClick={() => onEdit(msg)} title="编辑消息">✎</button>
                )}
                {onDelete && <button className="msg-action-btn msg-action-delete" onClick={() => onDelete(msg.id)} title="删除此消息">🗑</button>}
              </div>
            </div>
          </React.Fragment>
        );
      })}

      {/* 流式加载 */}
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
                {toolCalls.map(tc => (
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

      {/* 内嵌表单 */}
      {pendingForms && pendingForms.size > 0 && (
        <div className="chat-pending-forms">
          {Array.from(pendingForms.entries()).map(([formId, pf]) => (
            <div key={formId} className="chat-message assistant">
              <div className="chat-message-content">
                <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>表单: {pf.schema?.title || formId}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 工作区确认 */}
      {workspaceRequest && (
        <div className="chat-message assistant">
          <div className="chat-message-content">
            <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              允许访问路径: {workspaceRequest.requestedPath || '当前工作目录'}?
            </p>
          </div>
        </div>
      )}

      <div ref={messagesEndRef} />
    </div>
  );
}

// ── 流式 ToolCall 组件 ──

function LiveToolCallItem({ tc }: { tc: { toolCallId: string; toolName: string; args?: unknown; result?: unknown; isError?: boolean } }) {
  const [expanded, setExpanded] = useState(false);

  const argsStr = tc.args ? JSON.stringify(tc.args) : '';
  const resultStr = tc.result !== undefined ? String(tc.result) : '';
  const hasDetail = argsStr.length > 0 || resultStr.length > 0;
  const icon = tc.isError ? '✗' : (tc.result !== undefined ? '✓' : '→');

  return (
    <div className={`tool-call-item${tc.isError ? ' tool-error' : ''}`}>
      <div className="tool-call-header" onClick={() => setExpanded(!expanded)}>
        <span className="tool-call-icon">{icon}</span>
        <span className="tool-call-name">{tc.toolName}</span>
        {hasDetail && <span className="tool-call-expand">{expanded ? '▲' : '▼'}</span>}
      </div>
      {expanded && (
        <div className="tool-call-detail">
          {argsStr.length > 0 && (
            <div className="tool-call-section">
              <div className="tool-call-section-label">参数</div>
              <pre className="tool-call-section-content">{argsStr}</pre>
            </div>
          )}
          {resultStr.length > 0 && (
            <div className="tool-call-section">
              <div className="tool-call-section-label">结果 {tc.isError ? '(错误)' : ''}</div>
              <pre className="tool-call-section-content">{resultStr}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
