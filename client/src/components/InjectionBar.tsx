import { useState, useEffect } from 'react';
import * as api from '../services/api';

const SOURCE_CONFIG: Record<string, { icon: string; color: string }> = {
  app:   { icon: '📋', color: '#3b82f6' },
  tools: { icon: '🔧', color: '#8b5cf6' },
  goal:  { icon: '🎯', color: '#f97316' },
  memory:{ icon: '🧠', color: '#06b6d4' },
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
        const config = SOURCE_CONFIG[block.source] || { icon: '📌', color: '#6b7280' };
        const isExpanded = expandedIdx === idx;

        return (
          <div key={`${block.source}-${idx}`} className="injection-tag-wrapper">
            <div
              className="injection-tag"
              style={{
                borderColor: config.color,
                color: config.color,
                background: isExpanded ? config.color + '20' : 'transparent',
              }}
              onClick={() => setExpandedIdx(isExpanded ? null : idx)}
            >
              <span className="injection-tag-icon">{config.icon}</span>
              <span className="injection-tag-label">{block.label}</span>
              <span className="injection-tag-title">{block.title}</span>
            </div>
            {isExpanded && (
              <div className="injection-detail" style={{ borderColor: config.color }}>
                <div className="injection-detail-header" style={{ color: config.color }}>
                  {config.icon} {block.label}
                </div>
                <pre className="injection-detail-content">{block.detail}</pre>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
