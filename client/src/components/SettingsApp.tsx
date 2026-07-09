import { useState, useEffect } from 'react';
import { useDesktop } from '../contexts/DesktopContext';
import type { ModelProvider, MCPConnection, AppInfo, App, ProviderModel, ModelParam, FormSchema } from '../types';
import * as api from '../services/api';
import { AppIcon } from './AppIcon';
import { WorkspaceDirSelector } from './WorkspaceDirSelector';
import { MediaSelector } from './MediaSelector';
import { AppSettingsWindow } from './AppSettingsWindow';
import { AppDetailWindow } from './AppDetailWindow';
import { AppModelConfig } from './AppModelConfig';

// 设置应用属性接口
interface SettingsAppProps {
  appId?: string;
}

// 设置标签页类型
type SettingsTab = 'desktop' | 'model' | 'app' | 'mcp' | 'skill';

/**
 * 设置应用组件 - 提供系统设置界面
 * 支持桌面、模型、应用、MCP、技能等配置
 */
export function SettingsApp(_props: SettingsAppProps) {
  const { state, updateSettings, openSystemApp } = useDesktop();
  // 当前激活的标签页
  const [activeTab, setActiveTab] = useState<SettingsTab>('desktop');
  // 本地设置的副本（用于表单编辑）
  const [localSettings, setLocalSettings] = useState(state.settings);
  // 模型提供商列表
  const [modes, setModes] = useState<{ providers: ModelProvider[] }>({ providers: [] });
  // MCP连接列表
  const [mcpConnections, setMcpConnections] = useState<{ connections: MCPConnection[] }>({ connections: [] });
  // 已连接的运行时 MCP 列表（含工具信息）
  const [connectedMcps, setConnectedMcps] = useState<Array<{
    connectionId: string;
    serverInfo: { name: string; version: string } | null;
    isConnected: boolean;
    isInitialized: boolean;
    tools: Array<{ name: string; description: string; inputSchema: object }>;
    resources: Array<{ uri: string; name: string; description?: string; mimeType?: string }>;
  }>>([]);
  // 添加连接表单
  const [showAddForm, setShowAddForm] = useState(false);
  const [newConnForm, setNewConnForm] = useState({ name: '', transportType: 'stdio' as 'stdio' | 'sse' | 'http', command: '', args: '', url: '', cwd: '', headers: [] as Array<{ key: string; value: string }> });
  // 编辑连接表单
  const [editingConnId, setEditingConnId] = useState<string | null>(null);
  const [editConnForm, setEditConnForm] = useState({ name: '', transportType: 'stdio' as 'stdio' | 'sse' | 'http', command: '', args: '', url: '', cwd: '', headers: [] as Array<{ key: string; value: string }> });
  // 展开的工具区域
  const [expandedConnId, setExpandedConnId] = useState<string | null>(null);
  // 连接状态提示
  const [connMsg, setConnMsg] = useState<{ id: string; text: string; isError: boolean } | null>(null);
  // 工具启用状态（按连接ID存储）
  const [connEnabledTools, setConnEnabledTools] = useState<Record<string, string[]>>({});
  // 技能列表（旧系统，仅用于 loadSkillSettings 副作用）
  // skill state 暂未直接使用（使用 allSkills）
  // 新技能系统列表（从 public_data/skills/ 加载）
  const [allSkills, setAllSkills] = useState<any[]>([]);
  // 已安装的应用列表
  const [installedApps, setInstalledApps] = useState<AppInfo[]>([]);
  // 应用配置映射
  const [appConfigs, setAppConfigs] = useState<Record<string, App>>({});

  // 模型提供商管理状态
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

  // 编辑提供商状态
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
  const [editHeaderParams, setEditHeaderParams] = useState<ModelParam[]>([]);
  const [editBodyParams, setEditBodyParams] = useState<ModelParam[]>([]);
  const [editManualModel, setEditManualModel] = useState<{ id: string; name: string; maxTokens: number; supportsText: boolean; supportsImage: boolean }>({ id: '', name: '', maxTokens: 128000, supportsText: true, supportsImage: false });

  // 当全局设置变化时更新本地副本
  useEffect(() => {
    setLocalSettings(state.settings);
  }, [state.settings]);

  // 初始化加载数据
  useEffect(() => {
    loadModes();
    loadMcpSettings();
    loadConnectedMcps();
    loadSkillSettings();
    loadInstalledApps();
  }, []);

  // 加载模型提供商数据
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
    setEditHeaderParams(provider.models[0]?.headerParams || []);
    setEditBodyParams(provider.models[0]?.bodyParams || []);
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
      models: editFetchedModels.filter(m => editSelectedModels.has(m.id)).map(m => ({
        ...m,
        headerParams: editHeaderParams,
        bodyParams: editBodyParams,
      }))
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

  const loadConnectedMcps = async () => {
    try {
      const connections = await api.getMcpConnections();
      setConnectedMcps(connections);
      // 从运行时连接中加载已启用的工具列表
      const enabledMap: Record<string, string[]> = {};
      for (const conn of connections) {
        if (conn.isConnected) {
          enabledMap[conn.connectionId] = conn.tools.map(t => t.name);
        }
      }
      setConnEnabledTools(enabledMap);
    } catch (error) {
      console.error('Failed to load connected MCPs:', error);
    }
  };

  const loadSkillSettings = async () => {
    // 旧技能系统状态已移除，仅加载新技能系统
    try {
      const newSkills = await api.getAllSkills();
      setAllSkills(newSkills || []);
    } catch (error) {
      console.error('Failed to load new skill list:', error);
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
            appMd: '',
            mcpServices: [],
            skills: [],
            config: {},
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

  const handleThemeChange = async (theme: 'light' | 'dark' | 'auto') => {
    setLocalSettings({ ...localSettings, theme });
    await updateSettings({ theme });
  };

  const handleAddConnection = async () => {
    if (!newConnForm.name) return;
    try {
      let result;
      if (newConnForm.transportType === 'sse' || newConnForm.transportType === 'http') {
        if (!newConnForm.url) return;
        result = await api.connectMcp({
          name: newConnForm.name,
          transportType: newConnForm.transportType,
          command: '',
          args: [],
          url: newConnForm.url,
          headers: newConnForm.headers.filter(h => h.key),
          enabled: true,
          services: [],
        });
      } else {
        if (!newConnForm.command) return;
        const args = newConnForm.args ? newConnForm.args.split(' ').filter(Boolean) : [];
        result = await api.connectMcp({
          name: newConnForm.name,
          transportType: 'stdio',
          command: newConnForm.command,
          args,
          cwd: newConnForm.cwd || undefined,
          url: undefined,
          enabled: true,
          services: [],
        });
      }
      setMcpConnections(result);
      setNewConnForm({ name: '', transportType: 'stdio', command: '', args: '', url: '', cwd: '', headers: [] });
      setShowAddForm(false);
      // 刷新运行时连接
      loadConnectedMcps();
    } catch (error) {
      console.error('Failed to add MCP connection:', error);
      alert('添加 MCP 连接失败');
    }
  };

  const handleDeleteConnection = async (connId: string) => {
    if (!confirm('确定删除此 MCP 连接配置？')) return;
    try {
      await api.disconnectMcp(connId);
      setMcpConnections(prev => ({ connections: prev.connections.filter(c => c.id !== connId) }));
      loadConnectedMcps();
    } catch (error) {
      console.error('Failed to delete MCP connection:', error);
    }
  };

  const handleStartEditing = (conn: MCPConnection) => {
    setEditingConnId(conn.id);
    setEditConnForm({
      name: conn.name,
      transportType: conn.transportType || 'stdio',
      command: conn.command || '',
      args: conn.args ? conn.args.join(' ') : '',
      url: conn.url || '',
      cwd: conn.cwd || '',
      headers: conn.headers ? conn.headers.map(h => ({ ...h })) : [],
    });
  };

  const handleSaveEdit = async () => {
    if (!editingConnId) return;
    try {
      const conns = mcpConnections.connections.map(c =>
        c.id === editingConnId
          ? {
              ...c,
              name: editConnForm.name,
              transportType: editConnForm.transportType,
              command: editConnForm.transportType === 'sse' || editConnForm.transportType === 'http' ? '' : editConnForm.command,
              args: editConnForm.transportType === 'sse' || editConnForm.transportType === 'http' ? [] : editConnForm.args.split(' ').filter(Boolean),
              url: editConnForm.transportType === 'sse' || editConnForm.transportType === 'http' ? editConnForm.url : undefined,
              cwd: editConnForm.transportType === 'stdio' ? editConnForm.cwd || undefined : undefined,
              headers: editConnForm.headers.filter(h => h.key),
            }
          : c
      );
      await api.updateMcpSettings({ connections: conns });
      setMcpConnections({ connections: conns });
      setEditingConnId(null);
    } catch (error) {
      console.error('Failed to update MCP connection:', error);
      alert('更新失败');
    }
  };

  const handleToggleConnEnabled = async (connId: string, enabled: boolean) => {
    const newConnections = mcpConnections.connections.map(c =>
      c.id === connId ? { ...c, enabled } : c
    );
    const updated = await api.updateMcpSettings({ connections: newConnections });
    setMcpConnections(updated);
  };

  const handleConnectServer = async (conn: MCPConnection) => {
    setConnMsg({ id: conn.id, text: '连接中...', isError: false });
    try {
      const result = await api.connectMcpServer({ 
        id: conn.id, 
        name: conn.name, 
        transportType: conn.transportType, 
        command: conn.command, 
        args: conn.args, 
        url: conn.url, 
        headers: conn.headers, 
        enabled: conn.enabled !== false,
        services: conn.services || [],
      });
      setConnMsg({ id: conn.id, text: result.success ? '连接成功' : (result.connection as any)?.error || '连接失败', isError: !result.success });
      loadConnectedMcps();
    } catch (error) {
      setConnMsg({ id: conn.id, text: '连接出错: ' + ((error as Error).message), isError: true });
    }
  };

  const handleToggleTool = async (connectionId: string, toolName: string) => {
    const current = connEnabledTools[connectionId] || [];
    const next = current.includes(toolName)
      ? current.filter(t => t !== toolName)
      : [...current, toolName];
    const newMap = { ...connEnabledTools, [connectionId]: next };
    setConnEnabledTools(newMap);
    try {
      await api.updateMcpConnectionTools(connectionId, next);
    } catch (error) {
      console.error('Failed to update connection tools:', error);
      // 回滚
      setConnEnabledTools(prev => ({ ...prev, [connectionId]: current }));
    }
  };

  const getConnRuntimeInfo = (connId: string) => {
    return connectedMcps.find(c => c.connectionId === connId);
  };

  const getConnToolCount = (conn: MCPConnection) => {
    // 先从运行时获取
    const runtime = connectedMcps.find(c => c.connectionId === conn.id);
    if (runtime && runtime.isConnected && runtime.tools) return runtime.tools.length;
    return 0;
  };

  const renderMcpConnectionCard = (conn: MCPConnection) => {
    const runtimeInfo = getConnRuntimeInfo(conn.id);
    const isConnected = runtimeInfo?.isConnected ?? false;
    const isExpanded = expandedConnId === conn.id;
    const runtimeTools = runtimeInfo?.tools || [];
    const enabledTools = connEnabledTools[conn.id] || runtimeTools.map(t => t.name);
    const isEditing = editingConnId === conn.id;

    return (
      <div key={conn.id} style={{ marginBottom: 16, padding: 12, background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border-primary)' }}>
        {isEditing ? (
          <div>
            <div className="settings-item" style={{ marginBottom: 8 }}>
              <label>名称</label>
              <input type="text" value={editConnForm.name}
                onChange={e => setEditConnForm(p => ({ ...p, name: e.target.value }))}
                style={{ background: 'var(--input-bg)', border: '1px solid var(--border-primary)', borderRadius: 4, padding: '4px 8px', color: 'var(--text-primary)' }} />
            </div>
            <div className="settings-item" style={{ marginBottom: 8 }}>
              <label>传输类型</label>
              <select value={editConnForm.transportType}
                onChange={e => setEditConnForm(p => ({ ...p, transportType: e.target.value as 'stdio' | 'sse' }))}
                style={{ background: 'var(--input-bg)', border: '1px solid var(--border-primary)', borderRadius: 4, padding: '4px 8px', color: 'var(--text-primary)' }}>
                 <option value="stdio">Stdio (Shell 命令)</option>
                 <option value="sse">SSE (传统 SSE)</option>
                 <option value="http">HTTP (Streamable HTTP)</option>
               </select>
             </div>
            {editConnForm.transportType === 'stdio' ? (
              <>
                <div className="settings-item" style={{ marginBottom: 8 }}>
                  <label>命令</label>
                  <input type="text" value={editConnForm.command}
                    onChange={e => setEditConnForm(p => ({ ...p, command: e.target.value }))}
                    style={{ background: 'var(--input-bg)', border: '1px solid var(--border-primary)', borderRadius: 4, padding: '4px 8px', color: 'var(--text-primary)' }} />
                </div>
                <div className="settings-item" style={{ marginBottom: 8 }}>
                  <label>参数</label>
                  <input type="text" value={editConnForm.args}
                    onChange={e => setEditConnForm(p => ({ ...p, args: e.target.value }))}
                    placeholder="空格分隔的参数"
                    style={{ background: 'var(--input-bg)', border: '1px solid var(--border-primary)', borderRadius: 4, padding: '4px 8px', color: 'var(--text-primary)' }} />
                </div>
                <div className="settings-item" style={{ marginBottom: 8 }}>
                  <label>工作目录</label>
                  <input type="text" value={editConnForm.cwd}
                    onChange={e => setEditConnForm(p => ({ ...p, cwd: e.target.value }))}
                    placeholder="可选"
                    style={{ background: 'var(--input-bg)', border: '1px solid var(--border-primary)', borderRadius: 4, padding: '4px 8px', color: 'var(--text-primary)' }} />
                </div>
              </>
            ) : (
              <>
                <div className="settings-item" style={{ marginBottom: 8 }}>
                  <label>URL</label>
                  <input type="text" value={editConnForm.url}
                    onChange={e => setEditConnForm(p => ({ ...p, url: e.target.value }))}
                    placeholder="例如: http://localhost:3001/mcp"
                    style={{ background: 'var(--input-bg)', border: '1px solid var(--border-primary)', borderRadius: 4, padding: '4px 8px', color: 'var(--text-primary)' }} />
                </div>
                <div style={{ marginBottom: 8 }}>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 12, color: 'var(--text-secondary)' }}>请求头 (可选)</label>
                  {editConnForm.headers.map((h, i) => (
                    <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                      <input type="text" value={h.key}
                        onChange={e => {
                          const hdrs = [...editConnForm.headers];
                          hdrs[i] = { ...hdrs[i], key: e.target.value };
                          setEditConnForm(p => ({ ...p, headers: hdrs }));
                        }}
                        placeholder="Key"
                        style={{ width: '40%', background: 'var(--input-bg)', border: '1px solid var(--border-primary)', borderRadius: 4, padding: '4px 6px', color: 'var(--text-primary)', fontSize: 12 }} />
                      <input type="text" value={h.value}
                        onChange={e => {
                          const hdrs = [...editConnForm.headers];
                          hdrs[i] = { ...hdrs[i], value: e.target.value };
                          setEditConnForm(p => ({ ...p, headers: hdrs }));
                        }}
                        placeholder="Value"
                        style={{ flex: 1, background: 'var(--input-bg)', border: '1px solid var(--border-primary)', borderRadius: 4, padding: '4px 6px', color: 'var(--text-primary)', fontSize: 12 }} />
                      <button onClick={() => setEditConnForm(p => ({ ...p, headers: p.headers.filter((_, j) => j !== i) }))}
                        style={{ padding: '2px 6px', fontSize: 11, background: 'transparent', border: '1px solid var(--error-text)', borderRadius: 4, color: 'var(--error-text)', cursor: 'pointer' }}>×</button>
                    </div>
                  ))}
                  <button onClick={() => setEditConnForm(p => ({ ...p, headers: [...p.headers, { key: '', value: '' }] }))}
                    style={{ padding: '2px 8px', fontSize: 11, background: 'transparent', border: '1px dashed var(--border-primary)', borderRadius: 4, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                    + 添加请求头
                  </button>
                </div>
              </>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="btn-primary" onClick={handleSaveEdit} style={{ padding: '4px 12px', fontSize: 12 }}>保存</button>
              <button className="btn-secondary" onClick={() => setEditingConnId(null)} style={{ padding: '4px 12px', fontSize: 12 }}>取消</button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 14 }}>{conn.name}</div>
                {conn.transportType === 'sse' || conn.transportType === 'http' ? (
                  <div style={{ color: 'var(--text-secondary)', fontSize: 12, fontFamily: 'monospace' }}>
                    {conn.transportType === 'sse' ? 'SSE' : 'HTTP'}: {conn.url || '-'}
                  </div>
                ) : (
                  <div style={{ color: 'var(--text-secondary)', fontSize: 12, fontFamily: 'monospace' }}>
                    {conn.command} {conn.args.join(' ')}
                    {conn.cwd && <span style={{ marginLeft: 8, fontSize: 11, opacity: 0.7 }}>cwd: {conn.cwd}</span>}
                  </div>
                )}
              </div>
              <span style={{
                fontSize: 11, padding: '2px 8px', borderRadius: 10,
                background: isConnected ? 'var(--success-bg)' : 'var(--bg-primary)',
                color: isConnected ? 'var(--success-color)' : 'var(--text-secondary)',
                border: '1px solid ' + (isConnected ? 'var(--success-color)' : 'var(--border-primary)'),
              }}>
                {isConnected ? '已连接' : '未连接'}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                {getConnToolCount(conn)} 工具
              </span>
            </div>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              <label className="settings-item" style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', margin: 0, fontSize: 12 }}>
                <input type="checkbox" checked={conn.enabled}
                  onChange={e => handleToggleConnEnabled(conn.id, e.target.checked)} />
                启用
              </label>
              <button onClick={() => handleConnectServer(conn)}
                style={{ padding: '3px 10px', fontSize: 11, background: isConnected ? 'var(--error-text)' : 'var(--accent-color)', border: 'none', borderRadius: 4, color: '#fff', cursor: 'pointer' }}>
                {isConnected ? '重连' : '连接'}
              </button>
              <button onClick={() => handleStartEditing(conn)}
                style={{ padding: '3px 10px', fontSize: 11, background: 'var(--bg-primary)', border: '1px solid var(--border-primary)', borderRadius: 4, color: 'var(--text-primary)', cursor: 'pointer' }}>
                编辑
              </button>
              <button onClick={() => handleDeleteConnection(conn.id)}
                style={{ padding: '3px 10px', fontSize: 11, background: 'transparent', border: '1px solid var(--error-text)', borderRadius: 4, color: 'var(--error-text)', cursor: 'pointer' }}>
                删除
              </button>
              {connMsg && connMsg.id === conn.id && (
                <span style={{ fontSize: 11, color: connMsg.isError ? 'var(--error-text)' : 'var(--success-color)', marginLeft: 4 }}>
                  {connMsg.text}
                </span>
              )}
            </div>

            {/* 工具展开区 */}
            <div>
              <button onClick={() => setExpandedConnId(isExpanded ? null : conn.id)}
                style={{ padding: '2px 8px', fontSize: 11, background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                {isExpanded ? '▲ 收起工具' : '▼ 展开工具 (' + runtimeTools.length + ')'}
              </button>
              {isExpanded && (
                <div style={{ marginTop: 8, padding: 8, background: 'var(--bg-primary)', borderRadius: 6 }}>
                  {runtimeTools.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>暂无可用工具，请先连接</div>
                  ) : (
                    runtimeTools.map(tool => (
                      <label key={tool.name} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', cursor: 'pointer', fontSize: 12 }}>
                        <input type="checkbox" checked={enabledTools.includes(tool.name)}
                          onChange={() => handleToggleTool(conn.id, tool.name)} />
                        <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{tool.name}</span>
                        <span style={{ color: 'var(--text-secondary)', marginLeft: 4, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {tool.description}
                        </span>
                      </label>
                    ))
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    );
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
                <MediaSelector
                  appId="desktop"
                  type="background"
                  currentUrl={localSettings.wallpaper}
                  onSelect={(url) => {
                    setLocalSettings({ ...localSettings, wallpaper: url });
                    updateSettings({ wallpaper: url });
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
                <label>对齐</label>
                <select
                  value={localSettings.dock.align || 'center'}
                  onChange={(e) => {
                    const newDock = { ...localSettings.dock, align: e.target.value as 'start' | 'center' };
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
                  {localSettings.dock.position === 'bottom' ? (
                    <>
                      <option value="start">左侧</option>
                      <option value="center">居中</option>
                      <option value="end">右侧</option>
                    </>
                  ) : (
                    <>
                      <option value="start">顶部</option>
                      <option value="center">居中</option>
                      <option value="end">底部</option>
                    </>
                  )}
                </select>
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
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    className="btn-secondary"
                    style={{
                      padding: '4px 12px',
                      fontSize: 12,
                      background: state.settings.window.defaultSize.width === 800 && state.settings.window.defaultSize.height === 600
                        ? 'var(--accent-color)' : 'var(--bg-primary)',
                      color: state.settings.window.defaultSize.width === 800 && state.settings.window.defaultSize.height === 600
                        ? 'white' : 'var(--text-primary)',
                      border: 'none',
                      borderRadius: 6,
                      cursor: 'pointer',
                    }}
                    onClick={() => {
                      const size = { width: 800, height: 600 };
                      setLocalSettings({ ...localSettings, window: { ...localSettings.window, defaultSize: size } });
                      updateSettings({ window: { ...localSettings.window, defaultSize: size } });
                    }}
                  >
                    小 800×600
                  </button>
                  <button
                    className="btn-secondary"
                    style={{
                      padding: '4px 12px',
                      fontSize: 12,
                      background: state.settings.window.defaultSize.width === 1000 && state.settings.window.defaultSize.height === 700
                        ? 'var(--accent-color)' : 'var(--bg-primary)',
                      color: state.settings.window.defaultSize.width === 1000 && state.settings.window.defaultSize.height === 700
                        ? 'white' : 'var(--text-primary)',
                      border: 'none',
                      borderRadius: 6,
                      cursor: 'pointer',
                    }}
                    onClick={() => {
                      const size = { width: 1000, height: 700 };
                      setLocalSettings({ ...localSettings, window: { ...localSettings.window, defaultSize: size } });
                      updateSettings({ window: { ...localSettings.window, defaultSize: size } });
                    }}
                  >
                    中 1000×700
                  </button>
                  <button
                    className="btn-secondary"
                    style={{
                      padding: '4px 12px',
                      fontSize: 12,
                      background: state.settings.window.defaultSize.width === 1200 && state.settings.window.defaultSize.height === 800
                        ? 'var(--accent-color)' : 'var(--bg-primary)',
                      color: state.settings.window.defaultSize.width === 1200 && state.settings.window.defaultSize.height === 800
                        ? 'white' : 'var(--text-primary)',
                      border: 'none',
                      borderRadius: 6,
                      cursor: 'pointer',
                    }}
                    onClick={() => {
                      const size = { width: 1200, height: 800 };
                      setLocalSettings({ ...localSettings, window: { ...localSettings.window, defaultSize: size } });
                      updateSettings({ window: { ...localSettings.window, defaultSize: size } });
                    }}
                  >
                    大 1200×800
                  </button>
                  <span style={{ color: 'var(--text-secondary)', fontSize: 13, marginLeft: 4 }}>
                    {state.settings.window.defaultSize.width} x {state.settings.window.defaultSize.height}
                  </span>
                </div>
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
            <div className="settings-section">
              <h3>输入</h3>
              <div className="settings-item">
                <label>发送快捷键</label>
                <select
                  value={localSettings.sendKey}
                  onChange={(e) => {
                    const val = e.target.value as any;
                    setLocalSettings({ ...localSettings, sendKey: val });
                    updateSettings({ sendKey: val } as any);
                  }}
                  style={{
                    padding: '6px 12px',
                    background: 'var(--bg-primary)',
                    border: 'none',
                    borderRadius: 6,
                    color: 'var(--text-primary)',
                  }}
                >
                  <option value="alt+s">Alt + S</option>
                  <option value="enter">Enter</option>
                  <option value="ctrl+enter">Ctrl + Enter</option>
                  <option value="ctrl+s">Ctrl + S</option>
                </select>
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
                      {[...fetchedModels].sort((a, b) => a.name.localeCompare(b.name)).map((model) => (
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
            {[...modes.providers].sort((a, b) => a.name.localeCompare(b.name)).map((provider) => (
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
                          {[...editFetchedModels].sort((a, b) => a.name.localeCompare(b.name)).map((model) => (
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

                    {/* Extra Parameters Section */}
                    <div style={{ marginTop: 12, borderTop: '1px dashed var(--border-primary)', paddingTop: 12 }}>
                      <h4 style={{ margin: '0 0 8px 0', fontSize: 13, color: 'var(--text-primary)' }}>附加参数</h4>
                      <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8 }}>
                        可选的 HTTP Header 和请求体参数，通过勾选控制是否启用。
                      </p>

                      {/* Header Params */}
                      <div style={{ marginBottom: 10 }}>
                        <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>Header 参数</label>
                        {editHeaderParams.map((param, i) => (
                          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                            <input type="checkbox" checked={param.enabled} onChange={() => {
                              const next = [...editHeaderParams];
                              next[i] = { ...next[i], enabled: !next[i].enabled };
                              setEditHeaderParams(next);
                            }} />
                            <input type="text" value={param.key} placeholder="Key" onChange={(e) => {
                              const next = [...editHeaderParams];
                              next[i] = { ...next[i], key: e.target.value };
                              setEditHeaderParams(next);
                            }} style={{ flex: 1, padding: '4px 8px', background: 'var(--input-bg)', border: '1px solid var(--border-primary)', borderRadius: 4, color: 'var(--text-primary)', fontSize: 12 }} />
                            <input type="text" value={param.value} placeholder="Value" onChange={(e) => {
                              const next = [...editHeaderParams];
                              next[i] = { ...next[i], value: e.target.value };
                              setEditHeaderParams(next);
                            }} style={{ flex: 1, padding: '4px 8px', background: 'var(--input-bg)', border: '1px solid var(--border-primary)', borderRadius: 4, color: 'var(--text-primary)', fontSize: 12 }} />
                            <button onClick={() => setEditHeaderParams(editHeaderParams.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: 'var(--error-color)', cursor: 'pointer', fontSize: 14 }}>×</button>
                          </div>
                        ))}
                        <button onClick={() => setEditHeaderParams([...editHeaderParams, { key: '', value: '', enabled: true }])} style={{ padding: '4px 10px', background: 'var(--bg-secondary)', border: '1px dashed var(--border-secondary)', borderRadius: 4, color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 11 }}>
                          + 添加 Header 参数
                        </button>
                      </div>

                      {/* Body Params */}
                      <div>
                        <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>Body 参数</label>
                        {editBodyParams.map((param, i) => (
                          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                            <input type="checkbox" checked={param.enabled} onChange={() => {
                              const next = [...editBodyParams];
                              next[i] = { ...next[i], enabled: !next[i].enabled };
                              setEditBodyParams(next);
                            }} />
                            <input type="text" value={param.key} placeholder="Key" onChange={(e) => {
                              const next = [...editBodyParams];
                              next[i] = { ...next[i], key: e.target.value };
                              setEditBodyParams(next);
                            }} style={{ flex: 1, padding: '4px 8px', background: 'var(--input-bg)', border: '1px solid var(--border-primary)', borderRadius: 4, color: 'var(--text-primary)', fontSize: 12 }} />
                            <input type="text" value={param.value} placeholder="Value" onChange={(e) => {
                              const next = [...editBodyParams];
                              next[i] = { ...next[i], value: e.target.value };
                              setEditBodyParams(next);
                            }} style={{ flex: 1, padding: '4px 8px', background: 'var(--input-bg)', border: '1px solid var(--border-primary)', borderRadius: 4, color: 'var(--text-primary)', fontSize: 12 }} />
                            <button onClick={() => setEditBodyParams(editBodyParams.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: 'var(--error-color)', cursor: 'pointer', fontSize: 14 }}>×</button>
                          </div>
                        ))}
                        <button onClick={() => setEditBodyParams([...editBodyParams, { key: '', value: '', enabled: true }])} style={{ padding: '4px 10px', background: 'var(--bg-secondary)', border: '1px dashed var(--border-secondary)', borderRadius: 4, color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 11 }}>
                          + 添加 Body 参数
                        </button>
                      </div>
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
                          {[...provider.models].sort((a, b) => a.name.localeCompare(b.name)).map((model) => (
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
            <div className="app-manager-list" style={{ overflowY: 'auto' }}>
              {installedApps.map((app) => (
                <div key={app.id} className="app-manager-item" style={{ cursor: 'pointer' }} onClick={() => {
                  openSystemApp('app-settings:' + app.id, '应用设置: ' + app.name, app.icon);
                }}>
                  <AppIcon icon={app.icon} name={app.name} className="app-manager-item-icon" size={40} />
                  <div className="app-manager-item-info">
                    <div className="app-manager-item-name">{app.name}</div>
                    <div className="app-manager-item-meta">
                      {app.source === 'system' ? '系统' : app.source === 'user' ? '用户' : '市场'} •{' '}
                      {app.type === 'desktop' ? '桌面应用' : '后台服务'}
                      {app.enabled === false && ' • 已禁用'}
                    </div>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    {appConfigs[app.id]?.models?.[0]
                      ? `${modes.providers.find(p => p.id === appConfigs[app.id].models![0].provider)?.name || appConfigs[app.id].models![0].provider} / ${appConfigs[app.id].models![0].model}`
                      : '未配置模型'}
                  </span>
                </div>
              ))}
              {installedApps.length === 0 && (
                <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-secondary)' }}>
                  暂无应用
                </div>
              )}
            </div>
          </div>
        );

      case 'mcp':
        return (
          <div className="settings-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0 }}>MCP 服务连接</h3>
              <button onClick={() => setShowAddForm(!showAddForm)}
                style={{ padding: '6px 14px', background: 'var(--accent-color)', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', fontSize: 13 }}>
                {showAddForm ? '取消' : '+ 添加连接'}
              </button>
            </div>

            {/* 添加连接表单 */}
            {showAddForm && (
              <div style={{ marginBottom: 16, padding: 12, background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border-primary)' }}>
                <div className="settings-item" style={{ marginBottom: 8 }}>
                  <label>名称</label>
                  <input type="text" value={newConnForm.name}
                    onChange={e => setNewConnForm(p => ({ ...p, name: e.target.value }))}
                    placeholder="例如: PostgreSQL MCP"
                    style={{ flex: 1, background: 'var(--input-bg)', border: '1px solid var(--border-primary)', borderRadius: 4, padding: '6px 8px', color: 'var(--text-primary)' }} />
                </div>
                <div className="settings-item" style={{ marginBottom: 8 }}>
                  <label>传输类型</label>
                  <select value={newConnForm.transportType}
                    onChange={e => setNewConnForm(p => ({ ...p, transportType: e.target.value as 'stdio' | 'sse' }))}
                    style={{ background: 'var(--input-bg)', border: '1px solid var(--border-primary)', borderRadius: 4, padding: '6px 8px', color: 'var(--text-primary)' }}>
                    <option value="stdio">Stdio (Shell 命令)</option>
                    <option value="sse">SSE (传统 SSE)</option>
                    <option value="http">HTTP (Streamable HTTP)</option>
                  </select>
                </div>
                {newConnForm.transportType === 'stdio' ? (
                  <>
                    <div className="settings-item" style={{ marginBottom: 8 }}>
                      <label>命令</label>
                      <input type="text" value={newConnForm.command}
                        onChange={e => setNewConnForm(p => ({ ...p, command: e.target.value }))}
                        placeholder="例如: npx"
                        style={{ flex: 1, background: 'var(--input-bg)', border: '1px solid var(--border-primary)', borderRadius: 4, padding: '6px 8px', color: 'var(--text-primary)' }} />
                    </div>
                    <div className="settings-item" style={{ marginBottom: 12 }}>
                      <label>参数</label>
                      <input type="text" value={newConnForm.args}
                        onChange={e => setNewConnForm(p => ({ ...p, args: e.target.value }))}
                        placeholder="例如: -y @modelcontextprotocol/server-postgres ..."
                        style={{ flex: 1, background: 'var(--input-bg)', border: '1px solid var(--border-primary)', borderRadius: 4, padding: '6px 8px', color: 'var(--text-primary)' }} />
                    </div>
                    <div className="settings-item" style={{ marginBottom: 12 }}>
                      <label>工作目录</label>
                      <input type="text" value={newConnForm.cwd}
                        onChange={e => setNewConnForm(p => ({ ...p, cwd: e.target.value }))}
                        placeholder="例如: C:/aias-browser-mcp（可选）"
                        style={{ flex: 1, background: 'var(--input-bg)', border: '1px solid var(--border-primary)', borderRadius: 4, padding: '6px 8px', color: 'var(--text-primary)' }} />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="settings-item" style={{ marginBottom: 8 }}>
                      <label>URL</label>
                      <input type="text" value={newConnForm.url}
                        onChange={e => setNewConnForm(p => ({ ...p, url: e.target.value }))}
                        placeholder="例如: http://localhost:3001/mcp"
                        style={{ flex: 1, background: 'var(--input-bg)', border: '1px solid var(--border-primary)', borderRadius: 4, padding: '6px 8px', color: 'var(--text-primary)' }} />
                    </div>
                    <div style={{ marginBottom: 8 }}>
                      <label style={{ display: 'block', marginBottom: 4, fontSize: 12, color: 'var(--text-secondary)' }}>请求头 (可选)</label>
                      {newConnForm.headers.map((h, i) => (
                        <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                          <input type="text" value={h.key}
                            onChange={e => {
                              const hdrs = [...newConnForm.headers];
                              hdrs[i] = { ...hdrs[i], key: e.target.value };
                              setNewConnForm(p => ({ ...p, headers: hdrs }));
                            }}
                            placeholder="Key"
                            style={{ width: '40%', background: 'var(--input-bg)', border: '1px solid var(--border-primary)', borderRadius: 4, padding: '4px 6px', color: 'var(--text-primary)', fontSize: 12 }} />
                          <input type="text" value={h.value}
                            onChange={e => {
                              const hdrs = [...newConnForm.headers];
                              hdrs[i] = { ...hdrs[i], value: e.target.value };
                              setNewConnForm(p => ({ ...p, headers: hdrs }));
                            }}
                            placeholder="Value"
                            style={{ flex: 1, background: 'var(--input-bg)', border: '1px solid var(--border-primary)', borderRadius: 4, padding: '4px 6px', color: 'var(--text-primary)', fontSize: 12 }} />
                          <button onClick={() => setNewConnForm(p => ({ ...p, headers: p.headers.filter((_, j) => j !== i) }))}
                            style={{ padding: '2px 6px', fontSize: 11, background: 'transparent', border: '1px solid var(--error-text)', borderRadius: 4, color: 'var(--error-text)', cursor: 'pointer' }}>×</button>
                        </div>
                      ))}
                      <button onClick={() => setNewConnForm(p => ({ ...p, headers: [...p.headers, { key: '', value: '' }] }))}
                        style={{ padding: '2px 8px', fontSize: 11, background: 'transparent', border: '1px dashed var(--border-primary)', borderRadius: 4, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                        + 添加请求头
                      </button>
                    </div>
                  </>
                )}
                <button onClick={handleAddConnection}
                  disabled={!newConnForm.name || (newConnForm.transportType === 'stdio' ? !newConnForm.command : !newConnForm.url)}
                  style={{ padding: '6px 16px', background: 'var(--accent-color)', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', fontSize: 13, opacity: (!newConnForm.name || (newConnForm.transportType === 'stdio' ? !newConnForm.command : !newConnForm.url)) ? 0.5 : 1 }}>
                  添加
                </button>
              </div>
            )}

            {mcpConnections.connections.length === 0 ? (
              <div style={{ color: 'var(--text-secondary)', padding: 20, textAlign: 'center' }}>
                暂无 MCP 服务连接
              </div>
            ) : (
              mcpConnections.connections.map(conn => renderMcpConnectionCard(conn))
            )}
          </div>
        );

      case 'skill':
        return (
          <div className="settings-section">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>技能管理</h3>
              <button
                onClick={async () => {
                  try {
                    const data = await api.getAllSkills();
                    setAllSkills(data || []);
                  } catch (e) {
                    console.error('Failed to refresh skills', e);
                  }
                }}
                style={{
                  padding: '4px 12px',
                  fontSize: 12,
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-primary)',
                  borderRadius: 6,
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                }}
              >
                刷新
              </button>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: 12, marginBottom: 12 }}>
              技能存储在 <code>public_data/skills/</code> 目录下。启用后可在 应用设置 中为应用勾选。
            </p>
            {allSkills.length === 0 ? (
              <div style={{ color: 'var(--text-secondary)', padding: 20, textAlign: 'center' }}>
                暂无技能，请先在 skills 目录下创建。
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {allSkills.map((skill: any) => (
                  <div key={skill.id} style={{ padding: '10px 14px', background: 'var(--bg-secondary)', borderRadius: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: 14, flex: 1 }}>{skill.name}</span>
                      <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>v{skill.version}</span>
                      {skill.scripts?.length > 0 && (
                        <span style={{ color: 'var(--accent-color)', fontSize: 11, background: 'var(--bg-tertiary)', padding: '1px 6px', borderRadius: 4 }}>
                          {skill.scripts.length} 个脚本
                        </span>
                      )}
                      <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 12, color: 'var(--text-secondary)', userSelect: 'none' }}>
                        <input
                          type="checkbox"
                          checked={skill.enabled}
                          onChange={async (e) => {
                            try {
                              await api.toggleSkillEnabled(skill.id, e.target.checked);
                              const data = await api.getAllSkills();
                              setAllSkills(data || []);
                            } catch (err) {
                              console.error('Failed to toggle skill', err);
                            }
                          }}
                        />
                        启用
                      </label>
                    </div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginBottom: 4 }}>{skill.description}</div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: 11 }}>
                      文件: {skill.files?.length || 0} 个
                    </div>
                  </div>
                ))}
              </div>
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
