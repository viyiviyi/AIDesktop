import React, { useRef, useState, useEffect } from 'react';
import { useDesktop } from '../contexts/DesktopContext';
import type { WindowState, Message, ModelProvider, MCPConnection, Skill, AppInfo, App, ProviderModel, ContentType } from '../types';
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

    const handleMouseUp = async () => {
      setIsDragging(false);
      setIsResizing(false);

      // Save window position after dragging
      if (windowStateRef.current) {
        try {
          await api.saveWindowPosition(windowStateRef.current.appId, windowStateRef.current.position);
        } catch (error) {
          console.error('Failed to save window position:', error);
        }
      }
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
        <div style={{ width: 84 }} />
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
      <div style={{ display: 'flex', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--border-primary)' }}>
        <button
          onClick={createNewConversation}
          style={{
            padding: '4px 12px',
            background: 'var(--bg-primary)',
            border: 'none',
            borderRadius: 4,
            color: 'var(--text-primary)',
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
            background: 'var(--bg-primary)',
            border: 'none',
            borderRadius: 4,
            color: 'var(--text-primary)',
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
  const [appConfigs, setAppConfigs] = useState<Record<string, App>>({});

  // Model provider management
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [newProvider, setNewProvider] = useState<{
    id: string;
    name: string;
    apiType: 'openai' | 'anthropic' | 'custom';
    apiKey: string;
    baseUrl: string;
  }>({ id: '', name: '', apiType: 'openai', apiKey: '', baseUrl: '' });
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<ProviderModel[]>([]);
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const [defaultModel, setDefaultModel] = useState<{ providerId: string; modelId: string } | null>(null);
  const [showManualAddModel, setShowManualAddModel] = useState(false);
  const [manualModel, setManualModel] = useState<{ id: string; name: string; maxTokens: number; supportsText: boolean; supportsImage: boolean }>({ id: '', name: '', maxTokens: 128000, supportsText: true, supportsImage: false });

  // Edit provider state
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    apiKey: string;
    baseUrl: string;
    enabled: boolean;
  }>({ apiKey: '', baseUrl: '', enabled: true });
  const [editFetchedModels, setEditFetchedModels] = useState<ProviderModel[]>([]);
  const [editSelectedModels, setEditSelectedModels] = useState<Set<string>>(new Set());
  const [editFetching, setEditFetching] = useState(false);
  const [editShowManualAddModel, setEditShowManualAddModel] = useState(false);
  const [editManualModel, setEditManualModel] = useState<{ id: string; name: string; maxTokens: number; supportsText: boolean; supportsImage: boolean }>({ id: '', name: '', maxTokens: 128000, supportsText: true, supportsImage: false });

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
      const [data, defaultModelConfig] = await Promise.all([
        api.getModes(),
        api.getDefaultModel()
      ]);
      setModes(data);
      setDefaultModel(defaultModelConfig);
    } catch (error) {
      console.error('Failed to load modes:', error);
    }
  };

  const handleSetDefaultModel = async (providerId: string, modelId: string) => {
    try {
      const updated = await api.updateDefaultModel({ providerId, modelId });
      setDefaultModel(updated);
    } catch (error) {
      console.error('Failed to set default model:', error);
    }
  };

  const handleFetchModels = async () => {
    if (!newProvider.apiKey || !newProvider.baseUrl) {
      alert('请先填写API Key和Base URL');
      return;
    }
    setFetchingModels(true);
    try {
      const result = await api.fetchModels(newProvider.apiKey, newProvider.baseUrl, newProvider.apiType);
      setFetchedModels(result.models);
    } catch (error) {
      console.error('Failed to fetch models:', error);
      alert('获取模型列表失败，请检查API配置');
    } finally {
      setFetchingModels(false);
    }
  };

  const handleToggleModel = (modelId: string) => {
    const newSelected = new Set(selectedModels);
    if (newSelected.has(modelId)) {
      newSelected.delete(modelId);
    } else {
      newSelected.add(modelId);
    }
    setSelectedModels(newSelected);
  };

  const handleAddManualModel = () => {
    if (!manualModel.id || !manualModel.name) {
      alert('请填写模型ID和名称');
      return;
    }
    const supports: ('text' | 'image')[] = [];
    if (manualModel.supportsText) supports.push('text');
    if (manualModel.supportsImage) supports.push('image');
    const newModel: ProviderModel = {
      id: manualModel.id,
      name: manualModel.name,
      maxTokens: manualModel.maxTokens,
      supports,
      params: { temperature: 0.7, top_p: 0.9 }
    };
    setFetchedModels([...fetchedModels, newModel]);
    setSelectedModels(new Set([...selectedModels, newModel.id]));
    setManualModel({ id: '', name: '', maxTokens: 128000, supportsText: true, supportsImage: false });
    setShowManualAddModel(false);
  };

  const handleAddProvider = async () => {
    if (!newProvider.id || !newProvider.name) {
      alert('请填写提供商ID和名称');
      return;
    }

    const provider: ModelProvider = {
      id: newProvider.id,
      name: newProvider.name,
      apiType: newProvider.apiType,
      apiKey: newProvider.apiKey || '',
      baseUrl: newProvider.baseUrl || '',
      enabled: true,
      models: fetchedModels.filter(m => selectedModels.has(m.id))
    };

    try {
      const updated = await api.addProvider(provider);
      setModes(updated);
      setShowAddProvider(false);
      setNewProvider({ id: '', name: '', apiType: 'openai', apiKey: '', baseUrl: '' });
      setFetchedModels([]);
      setSelectedModels(new Set());
    } catch (error) {
      console.error('Failed to add provider:', error);
      alert('添加提供商失败');
    }
  };

  const handleUpdateProvider = async (providerId: string, updates: Partial<ModelProvider>) => {
    const provider = modes.providers.find(p => p.id === providerId);
    if (!provider) return;
    const updated = { ...provider, ...updates };
    try {
      const result = await api.updateProvider(providerId, updated);
      setModes(result);
    } catch (error) {
      console.error('Failed to update provider:', error);
    }
  };

  const handleDeleteProvider = async (providerId: string) => {
    if (!confirm('确定要删除这个提供商吗？')) return;
    try {
      const result = await api.deleteProvider(providerId);
      setModes(result);
    } catch (error) {
      console.error('Failed to delete provider:', error);
    }
  };

  const handleStartEditProvider = (provider: ModelProvider) => {
    setEditingProvider(provider.id);
    setEditForm({
      apiKey: provider.apiKey || '',
      baseUrl: provider.baseUrl || '',
      enabled: provider.enabled
    });
    setEditFetchedModels(provider.models);
    setEditSelectedModels(new Set(provider.models.map(m => m.id)));
  };

  const handleCancelEditProvider = () => {
    setEditingProvider(null);
    setEditForm({ apiKey: '', baseUrl: '', enabled: true });
    setEditFetchedModels([]);
    setEditSelectedModels(new Set());
  };

  const handleFetchEditModels = async () => {
    if (!editForm.apiKey || !editForm.baseUrl) {
      alert('请先填写API Key和Base URL');
      return;
    }
    const provider = modes.providers.find(p => p.id === editingProvider);
    if (!provider) return;

    setEditFetching(true);
    try {
      const result = await api.fetchModels(editForm.apiKey, editForm.baseUrl, provider.apiType);
      setEditFetchedModels(result.models);
    } catch (error) {
      console.error('Failed to fetch models:', error);
      alert('获取模型列表失败，请检查API配置');
    } finally {
      setEditFetching(false);
    }
  };

  const handleToggleEditModel = (modelId: string) => {
    const newSelected = new Set(editSelectedModels);
    if (newSelected.has(modelId)) {
      newSelected.delete(modelId);
    } else {
      newSelected.add(modelId);
    }
    setEditSelectedModels(newSelected);
  };

  const handleEditAddManualModel = () => {
    if (!editManualModel.id || !editManualModel.name) {
      alert('请填写模型ID和名称');
      return;
    }
    const supports: ('text' | 'image')[] = [];
    if (editManualModel.supportsText) supports.push('text');
    if (editManualModel.supportsImage) supports.push('image');
    const newModel: ProviderModel = {
      id: editManualModel.id,
      name: editManualModel.name,
      maxTokens: editManualModel.maxTokens,
      supports,
      params: { temperature: 0.7, top_p: 0.9 }
    };
    setEditFetchedModels([...editFetchedModels, newModel]);
    setEditSelectedModels(new Set([...editSelectedModels, newModel.id]));
    setEditManualModel({ id: '', name: '', maxTokens: 128000, supportsText: true, supportsImage: false });
    setEditShowManualAddModel(false);
  };

  const handleSaveEditProvider = async () => {
    if (!editingProvider) return;
    const provider = modes.providers.find(p => p.id === editingProvider);
    if (!provider) return;

    const updatedProvider: ModelProvider = {
      ...provider,
      apiKey: editForm.apiKey,
      baseUrl: editForm.baseUrl,
      enabled: editForm.enabled,
      models: editFetchedModels.filter(m => editSelectedModels.has(m.id))
    };

    try {
      const result = await api.updateProvider(editingProvider, updatedProvider);
      setModes(result);
      handleCancelEditProvider();
    } catch (error) {
      console.error('Failed to update provider:', error);
      alert('更新提供商失败');
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

      // Load full config for each app to get model settings
      const configs: Record<string, App> = {};
      for (const app of apps) {
        try {
          const fullApp = await api.getApp(app.id);
          configs[app.id] = fullApp;
        } catch {
          // Create a minimal App object if getApp fails
          configs[app.id] = {
            ...app,
            models: [],
            supportedInputs: ['text'],
            inputDescription: '',
            outputDescription: '',
            visibleApps: [],
            visibleServices: [],
            tools: []
          };
        }
      }
      setAppConfigs(configs);
    } catch (error) {
      console.error('Failed to load apps:', error);
    }
  };

  const handleAppModelUpdate = async (appId: string, providerId: string, modelId: string) => {
    const app = appConfigs[appId];
    if (!app) return;

    const provider = modes.providers.find(p => p.id === providerId);
    if (!provider) return;

    // If modelId is provided, get model details
    let maxTokens = 128000;
    let supports: ContentType[] = ['text'];
    let params: { temperature?: number; top_p?: number } = { temperature: 0.7, top_p: 0.9 };

    if (modelId) {
      const model = provider.models.find(m => m.id === modelId);
      if (model) {
        maxTokens = model.maxTokens;
        supports = model.supports;
        params = model.params || { temperature: 0.7, top_p: 0.9 };
      }
    }

    const newModelConfig = {
      provider: providerId,
      model: modelId,
      priority: 1,
      maxTokens,
      supports,
      params
    };

    try {
      const updated = await api.updateApp(appId, {
        models: [newModelConfig]
      });
      setAppConfigs({ ...appConfigs, [appId]: updated });
    } catch (error) {
      console.error('Failed to update app model:', error);
    }
  };

  const handleThemeChange = async (theme: 'light' | 'dark' | 'auto') => {
    setLocalSettings({ ...localSettings, theme });
    await updateSettings({ theme });
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
                    background: 'var(--bg-primary)',
                    border: 'none',
                    borderRadius: 6,
                    color: 'var(--text-primary)',
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
                    background: 'var(--bg-primary)',
                    border: 'none',
                    borderRadius: 6,
                    color: 'var(--text-primary)',
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
                    background: 'var(--bg-primary)',
                    border: 'none',
                    borderRadius: 6,
                    color: 'var(--text-primary)',
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
            {/* Default Model Configuration */}
            <div style={{ marginBottom: 20, padding: 16, background: 'var(--bg-tertiary)', borderRadius: 8, border: '1px solid var(--border-primary)' }}>
              <h4 style={{ margin: '0 0 12px 0', color: 'var(--text-primary)' }}>默认模型</h4>
              <p style={{ color: 'var(--text-secondary)', fontSize: 12, margin: '0 0 12px 0' }}>
                设置系统默认使用的模型，可被应用设置中的模型配置覆盖
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>提供商</label>
                  <select
                    value={defaultModel?.providerId || ''}
                    onChange={(e) => {
                      const providerId = e.target.value;
                      const provider = modes.providers.find(p => p.id === providerId);
                      if (provider && provider.models.length > 0) {
                        handleSetDefaultModel(providerId, provider.models[0].id);
                      } else {
                        handleSetDefaultModel(providerId, '');
                      }
                    }}
                    style={{
                      padding: '8px 12px',
                      background: 'var(--bg-primary)',
                      border: '1px solid var(--border-secondary)',
                      borderRadius: 6,
                      color: 'var(--text-primary)',
                      width: '100%',
                      boxSizing: 'border-box',
                    }}
                  >
                    <option value="">选择提供商...</option>
                    {modes.providers.filter(p => p.enabled && p.models.length > 0).map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>模型</label>
                  <select
                    value={defaultModel?.modelId || ''}
                    onChange={(e) => {
                      if (defaultModel?.providerId) {
                        handleSetDefaultModel(defaultModel.providerId, e.target.value);
                      }
                    }}
                    disabled={!defaultModel?.providerId}
                    style={{
                      padding: '8px 12px',
                      background: 'var(--bg-primary)',
                      border: '1px solid var(--border-secondary)',
                      borderRadius: 6,
                      color: 'var(--text-primary)',
                      width: '100%',
                      boxSizing: 'border-box',
                      opacity: defaultModel?.providerId ? 1 : 0.5,
                    }}
                  >
                    <option value="">选择模型...</option>
                    {defaultModel?.providerId && (
                      modes.providers.find(p => p.id === defaultModel.providerId)?.models.map((m) => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))
                    )}
                  </select>
                </div>
              </div>
              {defaultModel?.providerId && defaultModel?.modelId && (
                <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
                  当前默认: {modes.providers.find(p => p.id === defaultModel.providerId)?.name} / {modes.providers.find(p => p.id === defaultModel.providerId)?.models.find(m => m.id === defaultModel.modelId)?.name}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0 }}>模型提供商</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: 12, margin: '4px 0 0 0' }}>
                  添加API兼容的模型服务商，配置API Key后获取可用模型
                </p>
              </div>
              <button
                onClick={() => setShowAddProvider(!showAddProvider)}
                style={{
                  padding: '8px 16px',
                  background: 'var(--accent-color)',
                  border: 'none',
                  borderRadius: 6,
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                {showAddProvider ? '取消添加' : '+ 添加提供商'}
              </button>
            </div>

            {/* Add Provider Form */}
            {showAddProvider && (
              <div style={{ marginBottom: 20, padding: 16, background: 'var(--bg-tertiary)', borderRadius: 8, border: '1px solid var(--border-primary)' }}>
                <h4 style={{ margin: '0 0 12px 0', color: 'var(--text-primary)' }}>添加新提供商</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <div>
                    <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>ID (英文唯一标识)</label>
                    <input
                      type="text"
                      value={newProvider.id}
                      onChange={(e) => setNewProvider({ ...newProvider, id: e.target.value.toLowerCase().replace(/\s/g, '-') })}
                      placeholder="e.g., my-provider"
                      style={{
                        padding: '8px 12px',
                        background: 'var(--bg-primary)',
                        border: '1px solid var(--border-secondary)',
                        borderRadius: 6,
                        color: 'var(--text-primary)',
                        width: '100%',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>名称 (显示名)</label>
                    <input
                      type="text"
                      value={newProvider.name}
                      onChange={(e) => setNewProvider({ ...newProvider, name: e.target.value })}
                      placeholder="e.g., 我的API"
                      style={{
                        padding: '8px 12px',
                        background: 'var(--bg-primary)',
                        border: '1px solid var(--border-secondary)',
                        borderRadius: 6,
                        color: 'var(--text-primary)',
                        width: '100%',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <div>
                    <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>API类型</label>
                    <select
                      value={newProvider.apiType}
                      onChange={(e) => setNewProvider({ ...newProvider, apiType: e.target.value as 'openai' | 'anthropic' | 'custom' })}
                      style={{
                        padding: '8px 12px',
                        background: 'var(--bg-primary)',
                        border: '1px solid var(--border-secondary)',
                        borderRadius: 6,
                        color: 'var(--text-primary)',
                        width: '100%',
                        boxSizing: 'border-box',
                      }}
                    >
                      <option value="openai">OpenAI兼容</option>
                      <option value="anthropic">Anthropic兼容</option>
                      <option value="custom">自定义</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>API Key</label>
                    <input
                      type="password"
                      value={newProvider.apiKey}
                      onChange={(e) => setNewProvider({ ...newProvider, apiKey: e.target.value })}
                      placeholder="sk-..."
                      style={{
                        padding: '8px 12px',
                        background: 'var(--bg-primary)',
                        border: '1px solid var(--border-secondary)',
                        borderRadius: 6,
                        color: 'var(--text-primary)',
                        width: '100%',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>Base URL</label>
                    <input
                      type="text"
                      value={newProvider.baseUrl}
                      onChange={(e) => setNewProvider({ ...newProvider, baseUrl: e.target.value })}
                      placeholder="https://api.example.com/v1"
                      style={{
                        padding: '8px 12px',
                        background: 'var(--bg-primary)',
                        border: '1px solid var(--border-secondary)',
                        borderRadius: 6,
                        color: 'var(--text-primary)',
                        width: '100%',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <button
                    onClick={handleFetchModels}
                    disabled={fetchingModels || !newProvider.apiKey || !newProvider.baseUrl}
                    style={{
                      padding: '8px 16px',
                      background: fetchingModels ? 'var(--bg-secondary)' : 'var(--bg-primary)',
                      border: 'none',
                      borderRadius: 6,
                      color: 'var(--text-primary)',
                      cursor: fetchingModels ? 'not-allowed' : 'pointer',
                      fontSize: 13,
                    }}
                  >
                    {fetchingModels ? '获取中...' : '获取可用模型'}
                  </button>
                  {fetchedModels.length > 0 && (
                    <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                      获取到 {fetchedModels.length} 个模型，请勾选要启用的模型
                    </span>
                  )}
                </div>

                {fetchedModels.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8, display: 'block' }}>选择要启用的模型：</label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, maxHeight: 150, overflowY: 'auto' }}>
                      {fetchedModels.map((model) => (
                        <label
                          key={model.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '6px 12px',
                            background: selectedModels.has(model.id) ? 'var(--success-bg)' : 'var(--bg-secondary)',
                            borderRadius: 4,
                            cursor: 'pointer',
                            fontSize: 12,
                            color: selectedModels.has(model.id) ? 'var(--success-color)' : 'var(--text-secondary)',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={selectedModels.has(model.id)}
                            onChange={() => handleToggleModel(model.id)}
                            style={{ display: 'none' }}
                          />
                          {model.name}
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {/* Manual Model Addition */}
                <div style={{ marginTop: 12, borderTop: '1px dashed var(--border-primary)', paddingTop: 12 }}>
                  {!showManualAddModel ? (
                    <button
                      onClick={() => setShowManualAddModel(true)}
                      style={{
                        padding: '6px 12px',
                        background: 'var(--bg-secondary)',
                        border: '1px dashed var(--border-secondary)',
                        borderRadius: 6,
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                        fontSize: 12,
                      }}
                    >
                      + 手动添加模型
                    </button>
                  ) : (
                    <div style={{ padding: 12, background: 'var(--bg-secondary)', borderRadius: 6 }}>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>手动添加模型</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 100px', gap: 8, marginBottom: 8 }}>
                        <input
                          type="text"
                          value={manualModel.id}
                          onChange={(e) => setManualModel({ ...manualModel, id: e.target.value })}
                          placeholder="模型ID (如 gpt-4)"
                          style={{
                            padding: '6px 10px',
                            background: 'var(--bg-primary)',
                            border: '1px solid var(--border-secondary)',
                            borderRadius: 4,
                            color: 'var(--text-primary)',
                            fontSize: 12,
                          }}
                        />
                        <input
                          type="text"
                          value={manualModel.name}
                          onChange={(e) => setManualModel({ ...manualModel, name: e.target.value })}
                          placeholder="显示名称"
                          style={{
                            padding: '6px 10px',
                            background: 'var(--bg-primary)',
                            border: '1px solid var(--border-secondary)',
                            borderRadius: 4,
                            color: 'var(--text-primary)',
                            fontSize: 12,
                          }}
                        />
                        <input
                          type="number"
                          value={manualModel.maxTokens}
                          onChange={(e) => setManualModel({ ...manualModel, maxTokens: parseInt(e.target.value) || 128000 })}
                          placeholder="最大Token"
                          style={{
                            padding: '6px 10px',
                            background: 'var(--bg-primary)',
                            border: '1px solid var(--border-secondary)',
                            borderRadius: 4,
                            color: 'var(--text-primary)',
                            fontSize: 12,
                          }}
                        />
                      </div>
                      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={manualModel.supportsText}
                            onChange={(e) => setManualModel({ ...manualModel, supportsText: e.target.checked })}
                          />
                          文本
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={manualModel.supportsImage}
                            onChange={(e) => setManualModel({ ...manualModel, supportsImage: e.target.checked })}
                          />
                          图像
                        </label>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          onClick={handleAddManualModel}
                          style={{
                            padding: '6px 12px',
                            background: 'var(--accent-color)',
                            border: 'none',
                            borderRadius: 4,
                            color: 'var(--text-primary)',
                            cursor: 'pointer',
                            fontSize: 12,
                          }}
                        >
                          添加
                        </button>
                        <button
                          onClick={() => {
                            setShowManualAddModel(false);
                            setManualModel({ id: '', name: '', maxTokens: 128000, supportsText: true, supportsImage: false });
                          }}
                          style={{
                            padding: '6px 12px',
                            background: 'var(--bg-primary)',
                            border: 'none',
                            borderRadius: 4,
                            color: 'var(--text-primary)',
                            cursor: 'pointer',
                            fontSize: 12,
                          }}
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button
                    onClick={() => {
                      setShowAddProvider(false);
                      setFetchedModels([]);
                      setSelectedModels(new Set());
                    }}
                    style={{
                      padding: '8px 16px',
                      background: 'var(--bg-primary)',
                      border: 'none',
                      borderRadius: 6,
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                      fontSize: 13,
                    }}
                  >
                    取消
                  </button>
                  <button
                    onClick={handleAddProvider}
                    disabled={!newProvider.id || !newProvider.name}
                    style={{
                      padding: '8px 16px',
                      background: newProvider.id && newProvider.name ? 'var(--accent-color)' : 'var(--bg-primary)',
                      border: 'none',
                      borderRadius: 6,
                      color: 'var(--text-primary)',
                      cursor: newProvider.id && newProvider.name ? 'pointer' : 'not-allowed',
                      fontSize: 13,
                    }}
                  >
                    {selectedModels.size === 0 ? '添加（稍后配置模型）' : '添加'}
                  </button>
                </div>
              </div>
            )}

            {/* Provider List */}
            {modes.providers.map((provider) => (
              <div key={provider.id} style={{ marginBottom: 20, padding: 16, background: editingProvider === provider.id ? 'var(--bg-primary)' : 'var(--bg-secondary)', borderRadius: 8, border: editingProvider === provider.id ? '1px solid var(--accent-color)' : '1px solid transparent' }}>
                {editingProvider === provider.id ? (
                  // Edit Mode
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <span style={{ color: 'var(--text-primary)', fontWeight: 500, fontSize: 15 }}>
                        编辑: {provider.name}
                      </span>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          onClick={handleCancelEditProvider}
                          style={{
                            padding: '6px 12px',
                            background: 'var(--bg-primary)',
                            border: 'none',
                            borderRadius: 4,
                            color: 'var(--text-primary)',
                            cursor: 'pointer',
                            fontSize: 12,
                          }}
                        >
                          取消
                        </button>
                        <button
                          onClick={handleSaveEditProvider}
                          style={{
                            padding: '6px 12px',
                            background: 'var(--accent-color)',
                            border: 'none',
                            borderRadius: 4,
                            color: 'var(--text-primary)',
                            cursor: 'pointer',
                            fontSize: 12,
                          }}
                        >
                          保存
                        </button>
                      </div>
                    </div>

                    <div style={{ marginBottom: 12 }}>
                      <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input
                          type="checkbox"
                          checked={editForm.enabled}
                          onChange={(e) => setEditForm({ ...editForm, enabled: e.target.checked })}
                        />
                        <span>启用此提供商</span>
                      </label>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                      <div>
                        <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>API Key</label>
                        <input
                          type="password"
                          value={editForm.apiKey}
                          onChange={(e) => setEditForm({ ...editForm, apiKey: e.target.value })}
                          placeholder="sk-..."
                          style={{
                            padding: '8px 12px',
                            background: 'var(--bg-primary)',
                            border: '1px solid var(--border-secondary)',
                            borderRadius: 6,
                            color: 'var(--text-primary)',
                            width: '100%',
                            boxSizing: 'border-box',
                          }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>Base URL</label>
                        <input
                          type="text"
                          value={editForm.baseUrl}
                          onChange={(e) => setEditForm({ ...editForm, baseUrl: e.target.value })}
                          placeholder="https://api.openai.com/v1"
                          style={{
                            padding: '8px 12px',
                            background: 'var(--bg-primary)',
                            border: '1px solid var(--border-secondary)',
                            borderRadius: 6,
                            color: 'var(--text-primary)',
                            width: '100%',
                            boxSizing: 'border-box',
                          }}
                        />
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
                      <button
                        onClick={handleFetchEditModels}
                        disabled={editFetching || !editForm.apiKey || !editForm.baseUrl}
                        style={{
                          padding: '8px 16px',
                          background: editFetching ? 'var(--bg-secondary)' : 'var(--bg-primary)',
                          border: 'none',
                          borderRadius: 6,
                          color: 'var(--text-primary)',
                          cursor: editFetching ? 'not-allowed' : 'pointer',
                          fontSize: 12,
                        }}
                      >
                        {editFetching ? '获取中...' : '重新获取模型列表'}
                      </button>
                      {editFetchedModels.length > 0 && (
                        <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                          已获取 {editFetchedModels.length} 个模型，请勾选要启用的
                        </span>
                      )}
                    </div>

                    {editFetchedModels.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8, display: 'block' }}>
                          选择要启用的模型：
                        </label>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, maxHeight: 150, overflowY: 'auto' }}>
                          {editFetchedModels.map((model) => (
                            <label
                              key={model.id}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                padding: '6px 12px',
                                background: editSelectedModels.has(model.id) ? 'var(--success-bg)' : 'var(--bg-secondary)',
                                borderRadius: 4,
                                cursor: 'pointer',
                                fontSize: 12,
                                color: editSelectedModels.has(model.id) ? 'var(--success-color)' : 'var(--text-secondary)',
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={editSelectedModels.has(model.id)}
                                onChange={() => handleToggleEditModel(model.id)}
                                style={{ display: 'none' }}
                              />
                              {model.name}
                            </label>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Manual Model Addition for Edit */}
                    <div style={{ marginTop: 12, borderTop: '1px dashed var(--border-primary)', paddingTop: 12 }}>
                      {!editShowManualAddModel ? (
                        <button
                          onClick={() => setEditShowManualAddModel(true)}
                          style={{
                            padding: '6px 12px',
                            background: 'var(--bg-secondary)',
                            border: '1px dashed var(--border-secondary)',
                            borderRadius: 6,
                            color: 'var(--text-secondary)',
                            cursor: 'pointer',
                            fontSize: 12,
                          }}
                        >
                          + 手动添加模型
                        </button>
                      ) : (
                        <div style={{ padding: 12, background: 'var(--bg-secondary)', borderRadius: 6 }}>
                          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>手动添加模型</div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 100px', gap: 8, marginBottom: 8 }}>
                            <input
                              type="text"
                              value={editManualModel.id}
                              onChange={(e) => setEditManualModel({ ...editManualModel, id: e.target.value })}
                              placeholder="模型ID (如 gpt-4)"
                              style={{
                                padding: '6px 10px',
                                background: 'var(--bg-primary)',
                                border: '1px solid var(--border-secondary)',
                                borderRadius: 4,
                                color: 'var(--text-primary)',
                                fontSize: 12,
                              }}
                            />
                            <input
                              type="text"
                              value={editManualModel.name}
                              onChange={(e) => setEditManualModel({ ...editManualModel, name: e.target.value })}
                              placeholder="显示名称"
                              style={{
                                padding: '6px 10px',
                                background: 'var(--bg-primary)',
                                border: '1px solid var(--border-secondary)',
                                borderRadius: 4,
                                color: 'var(--text-primary)',
                                fontSize: 12,
                              }}
                            />
                            <input
                              type="number"
                              value={editManualModel.maxTokens}
                              onChange={(e) => setEditManualModel({ ...editManualModel, maxTokens: parseInt(e.target.value) || 128000 })}
                              placeholder="最大Token"
                              style={{
                                padding: '6px 10px',
                                background: 'var(--bg-primary)',
                                border: '1px solid var(--border-secondary)',
                                borderRadius: 4,
                                color: 'var(--text-primary)',
                                fontSize: 12,
                              }}
                            />
                          </div>
                          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={editManualModel.supportsText}
                                onChange={(e) => setEditManualModel({ ...editManualModel, supportsText: e.target.checked })}
                              />
                              文本
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={editManualModel.supportsImage}
                                onChange={(e) => setEditManualModel({ ...editManualModel, supportsImage: e.target.checked })}
                              />
                              图像
                            </label>
                          </div>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button
                              onClick={handleEditAddManualModel}
                              style={{
                                padding: '6px 12px',
                                background: 'var(--accent-color)',
                                border: 'none',
                                borderRadius: 4,
                                color: 'var(--text-primary)',
                                cursor: 'pointer',
                                fontSize: 12,
                              }}
                            >
                              添加
                            </button>
                            <button
                              onClick={() => {
                                setEditShowManualAddModel(false);
                                setEditManualModel({ id: '', name: '', maxTokens: 128000, supportsText: true, supportsImage: false });
                              }}
                              style={{
                                padding: '6px 12px',
                                background: 'var(--bg-primary)',
                                border: 'none',
                                borderRadius: 4,
                                color: 'var(--text-primary)',
                                cursor: 'pointer',
                                fontSize: 12,
                              }}
                            >
                              取消
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  // View Mode
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ color: 'var(--text-primary)', fontWeight: 500, fontSize: 15 }}>{provider.name}</span>
                          <span style={{ fontSize: 11, color: 'var(--text-secondary)', background: 'var(--bg-primary)', padding: '2px 6px', borderRadius: 4 }}>
                            {provider.apiType}
                          </span>
                          {provider.apiKey && (
                            <span style={{ background: 'var(--success-color)', color: 'var(--text-primary)', padding: '2px 8px', borderRadius: 10, fontSize: 11 }}>
                              已配置
                            </span>
                          )}
                          {!provider.enabled && (
                            <span style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', padding: '2px 8px', borderRadius: 10, fontSize: 11 }}>
                              已禁用
                            </span>
                          )}
                        </div>
                        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{provider.baseUrl}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          onClick={() => handleStartEditProvider(provider)}
                          style={{
                            padding: '4px 10px',
                            background: 'var(--bg-primary)',
                            border: 'none',
                            borderRadius: 4,
                            color: 'var(--text-primary)',
                            cursor: 'pointer',
                            fontSize: 11,
                          }}
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => handleDeleteProvider(provider.id)}
                          style={{
                            padding: '4px 10px',
                            background: 'var(--error-bg)',
                            border: 'none',
                            borderRadius: 4,
                            color: 'var(--error-color)',
                            cursor: 'pointer',
                            fontSize: 11,
                          }}
                        >
                          删除
                        </button>
                      </div>
                    </div>

                    <div style={{ marginBottom: 8 }}>
                      <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span>启用状态</span>
                        <input
                          type="checkbox"
                          checked={provider.enabled}
                          onChange={(e) => handleUpdateProvider(provider.id, { enabled: e.target.checked })}
                        />
                      </label>
                    </div>

                    <div>
                      <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8, display: 'block' }}>
                        已启用模型 ({provider.models?.length || 0})
                      </label>
                      {provider.models?.length > 0 ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {provider.models.map((model) => (
                            <span
                              key={model.id}
                              style={{
                                padding: '4px 10px',
                                background: 'var(--bg-tertiary)',
                                borderRadius: 4,
                                fontSize: 12,
                                color: 'var(--text-secondary)',
                              }}
                            >
                              {model.name}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>暂无可用模型，点击编辑重新获取</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {modes.providers.length === 0 && !showAddProvider && (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>
                <p>暂无模型提供商</p>
                <button
                  onClick={() => setShowAddProvider(true)}
                  style={{
                    padding: '8px 16px',
                    background: 'var(--accent-color)',
                    border: 'none',
                    borderRadius: 6,
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                >
                  添加第一个提供商
                </button>
              </div>
            )}
          </div>
        );

      case 'app':
        return (
          <div className="settings-section">
            <h3>应用配置</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: 12, marginBottom: 16 }}>
              为每个应用选择使用的AI模型。模型需要在"模型"标签页中配置API Key并启用。
            </p>
            <div style={{ maxHeight: 400, overflowY: 'auto' }}>
              {installedApps.map((app) => {
                const appConfig = appConfigs[app.id];
                const currentModel = appConfig?.models?.[0];
                const currentProvider = currentModel ? modes.providers.find(p => p.id === currentModel.provider) : null;
                const enabledProviders = modes.providers.filter(p => p.enabled && p.apiKey && p.models.length > 0);

                return (
                  <div key={app.id} style={{ marginBottom: 16, padding: 12, background: 'var(--bg-secondary)', borderRadius: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <div>
                        <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{app.name}</span>
                        <span style={{ color: 'var(--text-secondary)', fontSize: 11, marginLeft: 8 }}>
                          {app.source} • {app.type}
                        </span>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <div>
                        <label style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>提供商</label>
                        <select
                          value={currentModel?.provider || ''}
                          onChange={(e) => {
                            if (e.target.value) {
                              handleAppModelUpdate(app.id, e.target.value, '');
                            }
                          }}
                          style={{
                            padding: '6px 10px',
                            background: 'var(--bg-primary)',
                            border: '1px solid var(--border-primary)',
                            borderRadius: 4,
                            color: 'var(--text-primary)',
                            width: '100%',
                            boxSizing: 'border-box',
                          }}
                        >
                          <option value="">选择提供商...</option>
                          {enabledProviders.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>模型</label>
                        <select
                          value={currentModel?.model || ''}
                          onChange={(e) => {
                            if (e.target.value && currentProvider) {
                              handleAppModelUpdate(app.id, currentProvider.id, e.target.value);
                            }
                          }}
                          disabled={!currentProvider || !currentProvider.models?.length}
                          style={{
                            padding: '6px 10px',
                            background: 'var(--bg-primary)',
                            border: '1px solid var(--border-primary)',
                            borderRadius: 4,
                            color: currentModel?.model ? 'var(--text-primary)' : 'var(--text-secondary)',
                            width: '100%',
                            boxSizing: 'border-box',
                          }}
                        >
                          <option value="">{currentProvider ? '选择模型...' : '先选择提供商'}</option>
                          {currentProvider?.models?.map((m) => (
                            <option key={m.id} value={m.id}>{m.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {!currentModel && enabledProviders.length === 0 && (
                      <div style={{ marginTop: 8, fontSize: 11, color: 'var(--warning-color)' }}>
                        请先在"模型"标签页配置并启用一个提供商
                      </div>
                    )}

                    {currentModel && (
                      <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-secondary)' }}>
                        当前: {currentProvider?.name} / {currentProvider?.models?.find(m => m.id === currentModel.model)?.name || currentModel.model}
                      </div>
                    )}
                  </div>
                );
              })}
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
                <div key={conn.id} style={{ marginBottom: 16, padding: 12, background: 'var(--bg-secondary)', borderRadius: 8 }}>
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
                <div key={skill.id} style={{ marginBottom: 16, padding: 12, background: 'var(--bg-secondary)', borderRadius: 8 }}>
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
      <div style={{ display: 'flex', gap: 4, padding: '8px 12px', borderBottom: '1px solid var(--border-primary)' }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '6px 16px',
              background: activeTab === tab.id ? 'var(--accent-color)' : 'var(--bg-primary)',
              border: 'none',
              borderRadius: 6,
              color: 'var(--text-primary)',
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
