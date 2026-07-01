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
  /** 高亮消息 ID */
  highlightMsgId?: string;
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
  /** 自定义渲染待填表单 */
  renderPendingForm?: (formId: string, schema: FormSchema, toolCallId: string) => React.ReactNode;
  /** 自定义渲染工作区确认 */
  renderWorkspaceRequest?: (toolCallId: string, requestedPath?: string) => React.ReactNode;
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

/** 格式化未知类型值用于显示 */
function fmt(v: unknown): string {
  if (v === undefined || v === null) return '(空)';
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

/** 渲染消息中的 text、thinking、toolCall 块，并合并后续 toolResult */
function renderMsgContent(
  msg: Message,
  expandedSet: Set<string>,
  toggleExpand: (msgId: string, toolCallId: string) => void,
  allMessages?: Message[],
  idx?: number,
): React.ReactNode {
  if (msg.role === 'toolResult') return null;

  // 提取附件
  const imageBlocks = msg.content.filter((c): c is any => c.type === 'image');
  const fileBlocks = msg.content.filter((c): c is any => c.type === 'file');

  // 提取 text、thinking、toolCall（含实时 result）
  const textParts: string[] = [];
  const thinkingParts: string[] = [];
  const toolCallMap = new Map<string, { id: string; name: string; args?: unknown; result?: unknown; isError?: boolean }>();
  for (const c of msg.content) {
    if (c.type === 'text') {
      textParts.push(c.text);
    } else if (c.type === 'thinking') {
      thinkingParts.push(c.text);
    } else if (c.type === 'toolCall') {
      toolCallMap.set(c.id, { id: c.id, name: c.name, args: c.arguments, result: (c as any).result, isError: (c as any).isError });
    }
  }

  // 从后续消息中收集 toolResult：在遇到下一个 assistant 前停止
  const toolResults = new Map<string, { toolCallId: string; toolName: string; result?: unknown; isError: boolean; timestamp?: string }>();
  if (allMessages && idx !== undefined) {
    for (let i = idx + 1; i < allMessages.length; i++) {
      const next = allMessages[i];
      if (next.role === 'assistant') break;  // 遇到下一个 assistant 停止
      if (next.role !== 'toolResult') continue;
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

  // 合并：优先用 toolCall 自带的 result（实时），fallback 到 toolResult 消息
  const mergedItems: Array<{ id: string; name: string; args?: unknown; result?: unknown; isError: boolean; callTime?: string; resTime?: string }> = [];
  for (const [id, tc] of toolCallMap) {
    const tr = toolResults.get(id);
    mergedItems.push({
      id,
      name: tc.name,
      args: tc.args,
      result: tc.result ?? tr?.result,
      isError: tc.isError ?? tr?.isError ?? false,
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
        {thinkingParts.length > 0 && (
          <div className="thinking-block">
            {thinkingParts.map((t, i) => <pre key={i} className="thinking-text">{t}</pre>)}
          </div>
        )}
        <MarkdownView content={textParts.join('')} />
      </>
    );
  }

  // 混合内容
  return (
    <>
      {hasAttachments && renderAttachments(imageBlocks, fileBlocks)}
      {textParts.length > 0 && <div className="tool-call-text-block"><MarkdownView content={textParts.join('')} /></div>}
      {thinkingParts.length > 0 && (
        <div className="thinking-block">
          {thinkingParts.map((t, i) => <pre key={i} className="thinking-text">{t}</pre>)}
        </div>
      )}
      <div className="tool-log-list">
        {mergedItems.map((tp) => {
          const isExpanded = expandedSet.has(tp.id);
          const argsStr = tp.args ? JSON.stringify(tp.args) : '';
          const resultStr = tp.result !== undefined ? fmt(tp.result) : '';
          const hasDetail = argsStr.length > 0 || !!tp.result;

          return (
            <div key={tp.id} className={`tool-call-item ${tp.isError ? 'tool-error' : ''}`}>
              <div className="tool-call-header" onClick={hasDetail ? () => toggleExpand(msg.id, tp.id) : undefined}>
                <span className="tool-call-icon">{tp.isError ? '✗' : (tp.result !== undefined ? '✓' : '◌')}</span>
                <span className="tool-call-name">{tp.name}</span>
                {hasDetail && <span className="tool-call-expand">{isExpanded ? '▲' : '▼'}</span>}
              </div>
              {isExpanded && (
                <div className="tool-call-detail">
                  {!!tp.args && (
                    <div className="tool-call-section">
                      <div className="tool-call-section-label">参数</div>
                      <pre className="tool-call-section-content">{fmt(tp.args)}</pre>
                    </div>
                  )}
                  {tp.result !== undefined && (
                    <div className="tool-call-section">
                      <div className="tool-call-section-label">结果 {tp.isError ? '(错误)' : ''}</div>
                      <pre className="tool-call-section-content">{resultStr}</pre>
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
}

/** 渲染附件（图片+文件） */
function renderAttachments(imageBlocks: any[], fileBlocks: any[]): React.ReactNode {
  return (
    <>
      {imageBlocks.length > 0 && (
        <div className="msg-attachments">
          {imageBlocks.map((img, i) => (
            <img key={i} src={img.url} alt={img.alt || ''} className="msg-attachment-image" />
          ))}
        </div>
      )}
      {fileBlocks.length > 0 && (
        <div className="msg-attachments">
          {fileBlocks.map((file, i) => (
            <div key={i} className="msg-attachment-file">
              <span className="msg-attachment-file-icon">📎</span>
              <a href={file.url} target="_blank" rel="noopener noreferrer">{file.name || file.url}</a>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ── 流式 ToolCall 组件（实时加载中用） ──

function LiveToolCallItem({ tc }: { tc: { toolCallId: string; toolName: string; args?: unknown; result?: unknown; isError?: boolean } }) {
  const [expanded, setExpanded] = useState(false);

  const icon = tc.isError ? '✗' : tc.result ? '✓' : '→';
  const hasDetail = !!tc.args || !!tc.result;

  return (
    <div className={`tool-call-item${tc.isError ? ' tool-error' : ''}`}>
      <div className="tool-call-header" onClick={() => setExpanded(!expanded)}>
        <span className="tool-call-icon">{icon}</span>
        <span className="tool-call-name">{tc.toolName}</span>
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

// ── 组件 ──

export function MessageList({
  messages,
  isLoading,
  streamingText,
  thinkingText,
  toolCalls,
  highlightMsgId,
  pendingForms,
  workspaceRequest,
  onReply,
  onEdit,
  onDelete,
  onReplyClick,
  renderPendingForm,
  renderWorkspaceRequest,
}: MessageListProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

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

  // 自动滚动
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

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
            {replyToMsg && (
              <div className="reply-reference" onClick={() => onReplyClick?.(msg.replyTo!)} title="点击跳转到被回复的消息">
                <span className="reply-ref-icon">↩</span>
                <span className="reply-ref-text">
                  回复了 {replyToMsg.role === 'user' ? 'user' : 'assistant'}: {getMessageText(replyToMsg).slice(0, 50)}
                </span>
              </div>
            )}
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
                {renderMsgContent(msg, expandedByMsg[msg.id] || new Set(), toggleToolExpand, messages, idx)}
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
                {renderPendingForm
                  ? renderPendingForm(formId, pf.schema, pf.toolCallId)
                  : <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>表单: {pf.schema?.title || formId}</p>
                }
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 工作区确认 */}
      {workspaceRequest && (
        <div className="chat-message assistant">
          <div className="chat-message-content">
            {renderWorkspaceRequest
              ? renderWorkspaceRequest(workspaceRequest.toolCallId, workspaceRequest.requestedPath)
              : <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>允许访问路径: {workspaceRequest.requestedPath || '当前工作目录'}?</p>
            }
          </div>
        </div>
      )}

      <div ref={messagesEndRef} />
    </div>
  );
}
