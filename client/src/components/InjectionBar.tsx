import { useState, useEffect } from 'react';
import * as api from '../services/api';
import { MarkdownView } from './MarkdownView';

// 无硬编码颜色，全部由 CSS class 控制
const SOURCE_CLASS: Record<string, string> = {
  app:   'inj-app',
  goal:  'inj-goal',
  memory:'inj-memory',
};

interface InjectionBarProps {
  appId: string;
  convId?: string | null;
}

export function InjectionBar({ appId, convId }: InjectionBarProps) {
  const [blocks, setBlocks] = useState<api.InjectionBlock[]>([]);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getInjections(appId, convId ?? undefined).then((data) => {
      if (!cancelled) {
        setBlocks(data.blocks || []);
        setExpandedIdx(null);
      }
    }).catch(() => {
      if (!cancelled) setBlocks([]);
    });
    return () => { cancelled = true; };
  }, [appId, convId]);

  if (blocks.length === 0) return null;

  return (
    <div className="injection-bar">
      {blocks.map((block, idx) => {
        const cls = SOURCE_CLASS[block.source] || 'inj-default';
        const isExpanded = expandedIdx === idx;

        return (
          <div key={`${block.source}-${idx}`} className="injection-tag-wrapper">
            <div
              className={`injection-tag ${cls}${isExpanded ? ' expanded' : ''}`}
              onClick={() => setExpandedIdx(isExpanded ? null : idx)}
            >
              <span className="injection-tag-label">{block.label}</span>
              <span className="injection-tag-title">{block.title}</span>
            </div>
            {isExpanded && (
              <div className={`injection-detail ${cls}`}>
                <div className="injection-detail-header">
                  {block.label}
                </div>
                <div className="injection-detail-md">
                  <MarkdownView content={block.detail} />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
