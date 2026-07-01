import React from 'react';
import { MarkdownView } from './MarkdownView';
import type { Message } from '../types';

/** 格式化时间（HH:mm:ss） */
function formatTime(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** 格式化 JSON（带缩进、截断） */
function fmt(val: unknown): string {
  if (val === undefined || val === null) return '';
  const str = typeof val === 'string' ? val : JSON.stringify(val, null, 2);
  return str.length > 2000 ? str.slice(0, 2000) + '\n... (截断)' : str;
}

/**
 * 渲染单条消息的内容（含 text、thinking、toolCall、image、file）
 * 与应用窗口（Window.tsx）中的 renderMessageContent 保持一致的渲染逻辑。
 *
 * @param msg         消息
 * @param expandedSet 当前展开的 toolCall ID 集合
 * @param toggleExpand 切换展开的回调
 * @param allMessages 所有消息（用于查找 toolResult）
 * @param idx         当前消息在 allMessages 中的索引
 */
export function renderMessageContent(
  msg: Message,
  expandedSet: Set<string>,
  toggleExpand: (msgId: string, toolCallId: string) => void,
  allMessages?: Message[],
  idx?: number,
): React.ReactNode {
  // toolResult 由 assistant 消息合并渲染，独立不渲染
  if (msg.role === 'toolResult') return null;

  // 提取附件（图片、文件）
  const imageBlocks = msg.content.filter((c): c is any => c.type === 'image');
  const fileBlocks = msg.content.filter((c): c is any => c.type === 'file');

  // assistant 消息：提取 text、thinking 和 toolCall blocks
  const textParts: string[] = [];
  const thinkingParts: string[] = [];
  const toolCallMap = new Map<string, { id: string; name: string; args?: unknown; result?: unknown; isError?: boolean }>();
  for (const c of msg.content) {
    if (c.type === 'text') {
      textParts.push(c.text);
    } else if (c.type === 'thinking') {
      thinkingParts.push(c.text);
    } else if (c.type === 'toolCall') {
      // 注意：运行时 Window.tsx 的 tool_result 事件会把 result 写入 toolCall block
      // 所以这里需要同时读取 result，而不只是从后续 toolResult 消息中获取
      toolCallMap.set(c.id, {
        id: c.id,
        name: c.name,
        args: c.arguments,
        result: (c as any).result,
        isError: (c as any).isError,
      });
    }
  }

  // 从后续消息中收集 toolResult：在遇到下一个 assistant 前停止
  const toolResults = new Map<string, { toolCallId: string; toolName: string; result?: unknown; isError: boolean; timestamp?: string }>();
  if (allMessages && idx !== undefined) {
    for (let i = idx + 1; i < allMessages.length; i++) {
      const next = allMessages[i];
      if (next.role === 'assistant') break;
      if (next.role !== 'toolResult') continue;
      const meta = (next as any).toolResultMeta;
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

  // 合并：toolCall 有 result 的合并显示
  const mergedItems: Array<{ id: string; name: string; args?: unknown; result?: unknown; isError: boolean; callTime?: string; resTime?: string }> = [];
  for (const [id, tc] of toolCallMap) {
    const tr = toolResults.get(id);
    mergedItems.push({
      id,
      name: tc.name,
      args: tc.args,
      // 优先用 toolCall block 上实时写入的 result，再退回到 toolResult 消息
      result: tc.result !== undefined ? tc.result : tr?.result,
      isError: tc.isError ?? tr?.isError ?? false,
      callTime: msg.timestamp,
      resTime: tr?.timestamp,
    });
  }
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

  // 渲染附件
  const hasAttachments = imageBlocks.length > 0 || fileBlocks.length > 0;
  const renderAttachments = () => (
    <div className="chat-msg-attachments">
      {imageBlocks.map((img: any, i: number) => (
        <div key={i} className="chat-msg-image-wrapper">
          <img
            src={img.url} alt={img.alt || ''}
            className="chat-msg-image"
            onClick={() => window.open(img.url, '_blank')}
            style={{ cursor: 'pointer', maxWidth: '100%', maxHeight: 300, borderRadius: 8, objectFit: 'contain' }}
          />
        </div>
      ))}
      {fileBlocks.map((f: any, i: number) => (
        <div key={i} className="chat-msg-file">
          📎 {f.name || f.path?.split('/').pop() || '附件'}
        </div>
      ))}
    </div>
  );

  // 纯文本（或附件+文本）
  if (mergedItems.length === 0) {
    return (
      <>
        {hasAttachments && renderAttachments()}
        {thinkingParts.length > 0 && (
          <div className="chat-message-thinking">
            <span className="thinking-icon">◇</span>
            {thinkingParts.join('')}
          </div>
        )}
        <MarkdownView content={textParts.join('')} />
      </>
    );
  }

  // 混合内容：附件 + 文本(Markdown) + 工具调用结果块
  return (
    <>
      {hasAttachments && renderAttachments()}
      {thinkingParts.length > 0 && (
        <div className="chat-message-thinking">
          <span className="thinking-icon">◇</span>
          {thinkingParts.join('')}
        </div>
      )}
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
              <div className="tool-call-header" onClick={() => toggleExpand(msg.id, tp.id)}>
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
}
