import type { App, ModelConfig, ModelProvider } from '../types';
import { AppIcon } from './AppIcon';

interface AppModelConfigProps {
  app: App;
  providers: ModelProvider[];
  onUpdate: (models: ModelConfig[]) => void;
}

export function AppModelConfig({ app, providers, onUpdate }: AppModelConfigProps) {
  const currentModel = app.models?.[0];
  const useDefault = !app.models || app.models.length === 0;
  const currentProvider = currentModel
    ? providers.find((p) => p.id === currentModel.provider)
    : null;
  const enabledProviders = providers.filter((p) => p.models.length > 0);

  function handleProviderChange(providerId: string) {
    if (providerId === '__default__') {
      onUpdate([]);
      return;
    }
    const newModels: ModelConfig[] = [
      {
        provider: providerId,
        model: '',
        priority: 1,
        maxTokens: 4096,
        supports: ['text'],
        params: {},
      },
    ];
    onUpdate(newModels);
  }

  function handleModelChange(providerId: string, modelId: string) {
    const newModels: ModelConfig[] = [
      {
        provider: providerId,
        model: modelId,
        priority: 1,
        maxTokens: 4096,
        supports: ['text'],
        params: {},
      },
    ];
    onUpdate(newModels);
  }

  return (
    <div className="app-model-config">
      <div className="app-model-config-item">
        <div className="app-model-config-header">
          <AppIcon icon={app.icon} name={app.name} className="app-model-config-icon" />
          <div className="app-model-config-info">
            <span className="app-model-config-name">{app.name}</span>
            <span className="app-model-config-meta">
              {app.source} • {app.type}
            </span>
          </div>
        </div>

        <div className="app-model-config-selects">
          <div className="app-model-config-field">
            <label>提供商</label>
            <select
              value={useDefault ? '__default__' : currentModel?.provider || ''}
              onChange={(e) => {
                if (e.target.value) {
                  handleProviderChange(e.target.value);
                }
              }}
            >
              <option value="__default__">默认供应商</option>
              {enabledProviders.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="app-model-config-field">
            <label>模型</label>
            <select
              value={currentModel?.model || ''}
              onChange={(e) => {
                if (e.target.value && currentProvider) {
                  handleModelChange(currentProvider.id, e.target.value);
                }
              }}
              disabled={useDefault || !currentProvider || !currentProvider.models?.length}
            >
              <option value="">
                {useDefault ? '使用默认模型' : currentProvider ? '选择模型...' : '先选择提供商'}
              </option>
              {currentProvider?.models?.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {!currentModel && enabledProviders.length === 0 && (
          <div className="app-model-config-warning">
            请先在"模型"标签页配置并启用一个提供商
          </div>
        )}

        {currentModel && !useDefault && (
          <div className="app-model-config-current">
            当前:{' '}
            {currentProvider?.name} /{' '}
            {currentProvider?.models?.find((m) => m.id === currentModel.model)?.name ||
              currentModel.model}
          </div>
        )}

        {useDefault && (
          <div className="app-model-config-current">
            当前: 使用默认模型
          </div>
        )}
      </div>
    </div>
  );
}

interface AppModelConfigListProps {
  apps: App[];
  providers: ModelProvider[];
  onUpdate: (appId: string, models: ModelConfig[]) => void;
}

export function AppModelConfigList({ apps, providers, onUpdate }: AppModelConfigListProps) {
  const enabledProviders = providers.filter((p) => p.models.length > 0);

  return (
    <div className="app-model-config-list">
      {apps.map((app) => {
        const currentModel = app.models?.[0];
        const useDefault = !app.models || app.models.length === 0;
        const currentProvider = currentModel
          ? providers.find((p) => p.id === currentModel.provider)
          : null;

        return (
          <div key={app.id} className="app-model-config-item">
            <div className="app-model-config-header">
              <AppIcon icon={app.icon} name={app.name} className="app-model-config-icon" />
              <div className="app-model-config-info">
                <span className="app-model-config-name">{app.name}</span>
                <span className="app-model-config-meta">
                  {app.source} • {app.type}
                </span>
              </div>
            </div>

            <div className="app-model-config-selects">
              <div className="app-model-config-field">
                <label>提供商</label>
                <select
                  value={useDefault ? '__default__' : currentModel?.provider || ''}
                  onChange={(e) => {
                    if (e.target.value) {
                      if (e.target.value === '__default__') {
                        onUpdate(app.id, []);
                      } else {
                        onUpdate(app.id, [
                          {
                            provider: e.target.value,
                            model: '',
                            priority: 1,
                            maxTokens: 4096,
                            supports: ['text'],
                            params: {},
                          },
                        ]);
                      }
                    }
                  }}
                >
                  <option value="__default__">默认供应商</option>
                  {enabledProviders.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="app-model-config-field">
                <label>模型</label>
                <select
                  value={currentModel?.model || ''}
                  onChange={(e) => {
                    if (e.target.value && currentProvider) {
                      onUpdate(app.id, [
                        {
                          provider: currentProvider.id,
                          model: e.target.value,
                          priority: 1,
                          maxTokens: 4096,
                          supports: ['text'],
                          params: {},
                        },
                      ]);
                    }
                  }}
                  disabled={useDefault || !currentProvider || !currentProvider.models?.length}
                >
                  <option value="">
                    {useDefault ? '使用默认模型' : currentProvider ? '选择模型...' : '先选择提供商'}
                  </option>
                  {currentProvider?.models?.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {!currentModel && enabledProviders.length === 0 && (
              <div className="app-model-config-warning">
                请先在"模型"标签页配置并启用一个提供商
              </div>
            )}

            {currentModel && !useDefault && (
              <div className="app-model-config-current">
                当前:{' '}
                {currentProvider?.name} /{' '}
                {currentProvider?.models?.find((m) => m.id === currentModel.model)?.name ||
                  currentModel.model}
              </div>
            )}

            {useDefault && (
              <div className="app-model-config-current">
                当前: 使用默认模型
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
