import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import { Typography } from 'antd';
import 'highlight.js/styles/atom-one-dark.css';

export interface MarkdownViewProps {
  content: string;
  className?: string;
}

/**
 * 轻量级 Markdown 渲染组件
 * 支持：GFM（表格/任务列表）、代码高亮、行内 HTML、链接在新窗口打开
 */
export function MarkdownView({ content, className }: MarkdownViewProps) {
  const rendered = useMemo(() => {
    if (!content) return null;

    return (
      <div className={`markdown-body ${className || ''}`}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw, rehypeHighlight as any]}
          components={{
            a: ({ href, children, ...props }) => (
              <Typography.Link
                {...(props as any)}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
              >
                {children}
              </Typography.Link>
            ),
            code: ({ className, children, ...props }) => {
              const match = /language-(\w+)/.exec(className || '');
              // 如果是代码块（有语言标记），用 pre 包装
              if (match) {
                return (
                  <code className={className} {...props}>
                    {children}
                  </code>
                );
              }
              // 行内代码
              return (
                <code className="inline-code" {...props}>
                  {children}
                </code>
              );
            },
            pre: ({ children, ...props }) => (
              <div className="code-block-wrapper">
                <pre {...props}>{children}</pre>
                <button
                  className="code-copy-btn"
                  onClick={() => {
                    const text = extractText(children);
                    if (text) navigator.clipboard?.writeText(text);
                  }}
                  title="复制代码"
                >
                  📋
                </button>
              </div>
            ),
            table: ({ children, ...props }) => (
              <div className="table-wrapper">
                <table {...props}>{children}</table>
              </div>
            ),
            img: ({ src, alt, ...props }) => (
              <img
                src={src}
                alt={alt || ''}
                loading="lazy"
                className="markdown-image"
                onClick={() => {
                  if (src) window.open(src, '_blank');
                }}
                {...props}
              />
            ),
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    );
  }, [content, className]);

  return rendered;
}

function extractText(node: React.ReactNode): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (node && typeof node === 'object' && 'props' in node) {
    return extractText((node as any).props.children);
  }
  return '';
}
