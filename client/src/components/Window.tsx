import React, { useRef, useState, useEffect } from 'react';
import { useDesktop } from '../contexts/DesktopContext';
import type { WindowState, Message, ModelProvider, MCPConnection, Skill, AppInfo } from '../types';
import * as api from '../services/api';

const DEFAULT_ICON = 'data:image/svg+xml,' + encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <rect width="100" height="100" rx="20" fill="#0078d4"/>
    <text x="50" y="65" font-size="50" fill="white" text-anchor="middle">A</text>
  </svg>
`);

interface WindowProps {
  windowState: WindowState;
  children: React.ReactNode;
}

export function Window({ windowState, children }: WindowProps) {
  const { state, focusWindow, updateWindow, closeWindow, minimizeWindow, maximizeWindow } = useDesktop();
  const windowRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const resizeDirectionRef = useRef('');
  const windowStateRef = useRef(windowState);

  // Keep windowStateRef in sync with latest windowState
  windowStateRef.current = windowState;

  const isFocused = state.focusedWindowId === windowState.id;

  useEffect(() => {
    if (isFocused && windowRef.current) {
      windowRef.current.style.zIndex = '9999';
    }
  }, [isFocused]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.target instanceof HTMLElement && e.target.closest('.window-control')) {
      return;
    }
    focusWindow(windowState.id);
  };

  const handleHeaderMouseDown = (e: React.MouseEvent) => {
    if (e.target instanceof HTMLElement && e.target.closest('.window-control')) {
      return;
    }
    e.preventDefault();
    setIsDragging(true);
    dragOffsetRef.current = {
      x: e.clientX - windowState.position.x,
      y: e.clientY - windowState.position.y,
    };
    focusWindow(windowState.id);
  };

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

      if (isDragging) {
        updateWindow(currentWindowState.id, {
          position: {
            x: e.clientX - dragOffsetRef.current.x,
            y: e.clientY - dragOffsetRef.current.y,
          },
        });
      }
      if (isResizing && resizeDirectionRef.current) {
        const deltaX = e.clientX - (currentWindowState.position.x + currentWindowState.size.width);
        const deltaY = e.clientY - (currentWindowState.position.y + currentWindowState.size.height);

        let newWidth = currentWindowState.size.width;
        let newHeight = currentWindowState.size.height;
        const dir = resizeDirectionRef.current;

        if (dir.includes('e')) newWidth += deltaX;
        if (dir.includes('s')) newHeight += deltaY;
        if (dir.includes('w')) {
          newWidth -= deltaX;
        }
        if (dir.includes('n')) {
          newHeight -= deltaY;
        }

        newWidth = Math.max(state.settings.window.minSize.width, newWidth);
        newHeight = Math.max(state.settings.window.minSize.height, newHeight);

        updateWindow(currentWindowState.id, {
          size: { width: newWidth, height: newHeight },
        });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizing(false);
    };

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
        opacity: isFocused ? 1 : 0.9,
      }}
      onMouseDown={handleMouseDown}
    >
      <div className="window-header" onMouseDown={handleHeaderMouseDown}>
        <div style={{ width: 52 }} />
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

// App content components
interface ChatAppProps {
  appId: string;
  conversationId?: string;
}

export function ChatApp({ appId, conversationId }: ChatAppProps) {
  const [conversations, setConversations] = useState<{ id: string; title: string }[]>([]);
  const [currentConvId, setCurrentConvId] = useState<string | null>(conversationId || null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadConversations();
  }, [appId]);

  useEffect(() => {
    if (currentConvId) {
      loadMessages(currentConvId);
    }
  }, [currentConvId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadConversations = async () => {
    try {
      const convs = await api.getConversations(appId);
      setConversations(convs);
      if (convs.length > 0 && !currentConvId) {
        setCurrentConvId(convs[0].id);
      }
    } catch (error) {
      console.error('Failed to load conversations:', error);
    }
  };

  const loadMessages = async (convId: string) => {
    try {
      const conv = await api.getConversation(appId, convId);
      setMessages(conv.messages);
    } catch (error) {
      console.error('Failed to load messages:', error);
    }
  };

  const createNewConversation = async () => {
    try {
      const conv = await api.createConversation(appId, `会话 ${conversations.length + 1}`);
      setConversations([...conversations, { id: conv.id, title: conv.title }]);
      setCurrentConvId(conv.id);
      setMessages([]);
    } catch (error) {
      console.error('Failed to create conversation:', error);
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || !currentConvId || isLoading) return;

    const userMessage: Message = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: [{ type: 'text', text: input }],
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const { message } = await api.sendMessage(appId, currentConvId, [
        { type: 'text', text: input },
      ]);
      setMessages((prev) => [...prev.filter((m) => m.id !== userMessage.id), message]);
    } catch (error) {
      console.error('Failed to send message:', error);
      setMessages((prev) => prev.filter((m) => m.id !== userMessage.id));
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const getMessageText = (msg: Message): string => {
    return msg.content
      .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
      .map((c) => c.text)
      .join('');
  };

  return (
    <div className="app-chat">
      <div style={{ display: 'flex', gap: 8, padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        <button
          onClick={createNewConversation}
          style={{
            padding: '4px 12px',
            background: 'rgba(255,255,255,0.1)',
            border: 'none',
            borderRadius: 4,
            color: 'white',
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          新建会话
        </button>
        <select
          value={currentConvId || ''}
          onChange={(e) => setCurrentConvId(e.target.value || null)}
          style={{
            flex: 1,
            padding: '4px 8px',
            background: 'rgba(255,255,255,0.1)',
            border: 'none',
            borderRadius: 4,
            color: 'white',
            fontSize: 12,
          }}
        >
          {conversations.map((conv) => (
            <option key={conv.id} value={conv.id}>
              {conv.title}
            </option>
          ))}
        </select>
      </div>
      <div className="chat-messages">
        {messages.map((msg) => (
          <div key={msg.id} className={`chat-message ${msg.role}`}>
            <div className="chat-message-content">
              {getMessageText(msg)}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="chat-message assistant">
            <div className="chat-message-content">思考中...</div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      <div className="chat-input-area">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入消息..."
          disabled={!currentConvId || isLoading}
        />
        <button onClick={sendMessage} disabled={!currentConvId || isLoading || !input.trim()}>
          发送
        </button>
      </div>
    </div>
  );
}

interface SettingsAppProps {
  appId?: string;
}

type SettingsTab = 'desktop' | 'model' | 'app' | 'mcp' | 'skill';

export function SettingsApp(_props: SettingsAppProps) {
  const { state, updateSettings } = useDesktop();
  const [activeTab, setActiveTab] = useState<SettingsTab>('desktop');
  const [localSettings, setLocalSettings] = useState(state.settings);
  const [modes, setModes] = useState<{ providers: ModelProvider[] }>({ providers: [] });
  const [mcpConnections, setMcpConnections] = useState<{ connections: MCPConnection[] }>({ connections: [] });
  const [skills, setSkills] = useState<{ skills: Skill[]; globalEnabled: boolean }>({ skills: [], globalEnabled: true });
  const [installedApps, setInstalledApps] = useState<AppInfo[]>([]);

  useEffect(() => {
    setLocalSettings(state.settings);
  }, [state.settings]);

  useEffect(() => {
    loadModes();
    loadMcpSettings();
    loadSkillSettings();
    loadInstalledApps();
  }, []);

  const loadModes = async () => {
    try {
      const data = await api.getModes();
      setModes(data);
    } catch (error) {
      console.error('Failed to load modes:', error);
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
    } catch (error) {
      console.error('Failed to load apps:', error);
    }
  };

  const handleThemeChange = async (theme: 'light' | 'dark' | 'auto') => {
    setLocalSettings({ ...localSettings, theme });
    await updateSettings({ theme });
  };

  const handleModesUpdate = async (newModes: typeof modes) => {
    try {
      const updated = await api.updateModes(newModes);
      setModes(updated);
    } catch (error) {
      console.error('Failed to update modes:', error);
    }
  };

  const handleMcpUpdate = async (newMcp: typeof mcpConnections) => {
    try {
      const updated = await api.updateMcpSettings(newMcp);
      setMcpConnections(updated);
    } catch (error) {
      console.error('Failed to update MCP settings:', error);
    }
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
                    background: 'rgba(255,255,255,0.1)',
                    border: 'none',
                    borderRadius: 6,
                    color: 'white',
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
                    background: 'rgba(255,255,255,0.1)',
                    border: 'none',
                    borderRadius: 6,
                    color: 'white',
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
                    background: 'rgba(255,255,255,0.1)',
                    border: 'none',
                    borderRadius: 6,
                    color: 'white',
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
          </>
        );

      case 'model':
        return (
          <div className="settings-section">
            <h3>模型提供商</h3>
            {modes.providers.map((provider, index) => (
              <div key={provider.name} style={{ marginBottom: 16, padding: 12, background: 'rgba(255,255,255,0.05)', borderRadius: 8 }}>
                <div className="settings-item" style={{ marginBottom: 8 }}>
                  <label>提供商</label>
                  <span style={{ color: 'var(--text-secondary)' }}>{provider.name}</span>
                </div>
                <div className="settings-item" style={{ marginBottom: 8 }}>
                  <label>API Key</label>
                  <input
                    type="password"
                    value={provider.apiKey || ''}
                    onChange={(e) => {
                      const newProviders = [...modes.providers];
                      newProviders[index] = { ...provider, apiKey: e.target.value };
                      setModes({ providers: newProviders });
                    }}
                    onBlur={() => handleModesUpdate(modes)}
                    placeholder="输入 API Key"
                    style={{
                      padding: '6px 12px',
                      background: 'rgba(255,255,255,0.1)',
                      border: 'none',
                      borderRadius: 6,
                      color: 'white',
                      width: 200,
                    }}
                  />
                </div>
                <div className="settings-item">
                  <label>Base URL</label>
                  <input
                    type="text"
                    value={provider.baseUrl || ''}
                    onChange={(e) => {
                      const newProviders = [...modes.providers];
                      newProviders[index] = { ...provider, baseUrl: e.target.value };
                      setModes({ providers: newProviders });
                    }}
                    onBlur={() => handleModesUpdate(modes)}
                    placeholder="https://api.openai.com/v1"
                    style={{
                      padding: '6px 12px',
                      background: 'rgba(255,255,255,0.1)',
                      border: 'none',
                      borderRadius: 6,
                      color: 'white',
                      width: 250,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        );

      case 'app':
        return (
          <div className="settings-section">
            <h3>已安装应用</h3>
            <div style={{ maxHeight: 400, overflowY: 'auto' }}>
              {installedApps.map((app) => (
                <div key={app.id} className="settings-item">
                  <div>
                    <span style={{ color: 'var(--text-primary)' }}>{app.name}</span>
                    <span style={{ color: 'var(--text-secondary)', fontSize: 11, marginLeft: 8 }}>
                      {app.source} • {app.type}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );

      case 'mcp':
        return (
          <div className="settings-section">
            <h3>MCP 服务连接</h3>
            {mcpConnections.connections.length === 0 ? (
              <div style={{ color: 'var(--text-secondary)', padding: 20, textAlign: 'center' }}>
                暂无 MCP 服务连接
              </div>
            ) : (
              mcpConnections.connections.map((conn) => (
                <div key={conn.id} style={{ marginBottom: 16, padding: 12, background: 'rgba(255,255,255,0.05)', borderRadius: 8 }}>
                  <div className="settings-item" style={{ marginBottom: 8 }}>
                    <label>名称</label>
                    <span style={{ color: 'var(--text-primary)' }}>{conn.name}</span>
                  </div>
                  <div className="settings-item" style={{ marginBottom: 8 }}>
                    <label>命令</label>
                    <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{conn.command}</span>
                  </div>
                  <div className="settings-item">
                    <label>启用</label>
                    <input
                      type="checkbox"
                      checked={conn.enabled}
                      onChange={(e) => {
                        const newConnections = mcpConnections.connections.map(c =>
                          c.id === conn.id ? { ...c, enabled: e.target.checked } : c
                        );
                        handleMcpUpdate({ connections: newConnections });
                      }}
                    />
                  </div>
                </div>
              ))
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
                <div key={skill.id} style={{ marginBottom: 16, padding: 12, background: 'rgba(255,255,255,0.05)', borderRadius: 8 }}>
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
      <div style={{ display: 'flex', gap: 4, padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '6px 16px',
              background: activeTab === tab.id ? 'var(--accent-color)' : 'rgba(255,255,255,0.1)',
              border: 'none',
              borderRadius: 6,
              color: 'white',
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
