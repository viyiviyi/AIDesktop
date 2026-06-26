import React from 'react';
import { useDesktop } from '../contexts/DesktopContext';

export function MenuBar() {
  const { state } = useDesktop();
  const [time, setTime] = React.useState(new Date());

  React.useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const timeString = time.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const dateString = time.toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
    weekday: 'short',
  });

  return (
    <div className="menu-bar"
      style={{
        transition: 'transform 0.3s, opacity 0.3s',
        transform: state.settings.menuBar.autoHide ? 'translateY(-100%)' : 'none',
        opacity: state.settings.menuBar.autoHide ? 0 : 1,
      }}
      onMouseEnter={(e) => {
        if (state.settings.menuBar.autoHide) {
          e.currentTarget.style.transform = 'none';
          e.currentTarget.style.opacity = '1';
        }
      }}
      onMouseLeave={(e) => {
        if (state.settings.menuBar.autoHide) {
          e.currentTarget.style.transform = 'translateY(-100%)';
          e.currentTarget.style.opacity = '0';
        }
      }}
    >
      <div className="menu-bar-left">
        <span style={{ fontSize: 13, fontWeight: 600 }}>AI Desktop</span>
      </div>
      <div className="menu-bar-right">
        <span>{dateString}</span>
        <span>{timeString}</span>
      </div>
    </div>
  );
}
