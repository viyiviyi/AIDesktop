import React from 'react';

// 统一蓝色背景，不用 canvas/SVG，直接渲染 DOM 元素
const BG_COLOR = '#0078d4';

interface AppIconProps {
  icon?: string;
  name: string;
  className?: string;
  alt?: string;
  style?: React.CSSProperties;
  /** 图标尺寸（宽高一致），默认 48px */
  size?: number;
}

/**
 * 应用图标组件
 * - 有 icon 属性时：渲染 <img>，加载失败则 fallback 到首字 DOM 元素
 * - 无 icon 属性时：直接渲染首字 DOM 元素（完美支持 emoji）
 */
export function AppIcon({ icon, name, className, alt, style, size = 48 }: AppIconProps) {
  // 用 Array.from 正确处理 surrogate pair（如 emoji: 👍🏻 是 2 个码点）
  // 取前两个字，中文和 emoji 都刚刚好
  const chars = Array.from(name.trim());
  const firstTwo = chars.slice(0, 2).join('') || 'A';

  // 首字 DOM 元素（共享的渲染结果）
  const fallbackEl = (
    <div
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: '20%',
        backgroundColor: BG_COLOR,
        color: '#fff',
        fontWeight: 600,
        userSelect: 'none',
        overflow: 'hidden',
        lineHeight: 1,
        fontSize: size * 0.38,
        boxSizing: 'border-box',
        ...style,
      }}
      title={alt || name}
    >
      {firstTwo}
    </div>
  );

  if (!icon) {
    return fallbackEl;
  }

  return (
    <img
      src={icon}
      alt={alt || name}
      className={className}
      style={style}
      onError={(e) => {
        // 图片加载失败 -> 替换为首字 DOM 元素
        const target = e.currentTarget;
        const parent = target.parentElement;
        if (parent) {
          const div = document.createElement('div');
          // 复制 className
          div.className = target.className || '';
          // 内联样式
          div.style.cssText = [
            'display:inline-flex',
            'align-items:center',
            'justify-content:center',
            `width:${size}px`,
            `height:${size}px`,
            'border-radius:20%',
            `background-color:${BG_COLOR}`,
            'color:#fff',
            'font-weight:600',
            'user-select:none',
            'overflow:hidden',
            'line-height:1',
            `font-size:${size * 0.38}px`,
            'box-sizing:border-box',
          ].join(';');
          if (target.style.cssText) {
            div.style.cssText += ';' + target.style.cssText;
          }
          div.textContent = firstTwo;
          div.title = alt || name;
          target.replaceWith(div);
        }
      }}
    />
  );
}
