import type { App, ModelConfig, ModelProvider } from '../types';

interface AppModelConfigProps {
  app: App;
  providers: ModelProvider[];
  onUpdate: (models: ModelConfig[]) => void;
}

export function AppModelConfig({ app, providers, onUpdate }: AppModelConfigProps) {
  const currentModel = app.models?.[0];
  const currentProvider = currentModel
    ? providers.find((p) => p.id === currentModel.provider)
    : null;
  const enabledProviders = providers.filter((p) => p.enabled && p.apiKey && p.models.length > 0);

  function handleProviderChange(providerId: string) {
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
          <img
            src={app.icon}
            alt={app.name}
            className="app-model-config-icon"
            onError={(e) => {
              (e.target as HTMLImageElement).src =
                'data:image/svg+xml,' +
                encodeURIComponent(
                  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="20" fill="#0078d4"/><text x="50" y="65" font-size="50" fill="white" text-anchor="middle">A</text></svg>`
                );
            }}
          />
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
              value={currentModel?.provider || ''}
              onChange={(e) => {
                if (e.target.value) {
                  handleProviderChange(e.target.value);
                }
              }}
            >
              <option value="">选择提供商...</option>
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
              disabled={!currentProvider || !currentProvider.models?.length}
            >
              <option value="">
                {currentProvider ? '选择模型...' : '先选择提供商'}
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

        {currentModel && (
          <div className="app-model-config-current">
            当前:{' '}
            {currentProvider?.name} /{' '}
            {currentProvider?.models?.find((m) => m.id === currentModel.model)?.name ||
              currentModel.model}
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
  const enabledProviders = providers.filter((p) => p.enabled && p.apiKey && p.models.length > 0);

  return (
    <div className="app-model-config-list">
      {apps.map((app) => {
        const currentModel = app.models?.[0];
        const currentProvider = currentModel
          ? providers.find((p) => p.id === currentModel.provider)
          : null;

        return (
          <div key={app.id} className="app-model-config-item">
            <div className="app-model-config-header">
              <img
                src={app.icon}
                alt={app.name}
                className="app-model-config-icon"
                onError={(e) => {
                  (e.target as HTMLImageElement).src =
                    'data:image/svg+xml,' +
                    encodeURIComponent(
                      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="20" fill="#0078d4"/><text x="50" y="65" font-size="50" fill="white" text-anchor="middle">A</text></svg>`
                    );
                }}
              />
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
                  value={currentModel?.provider || ''}
                  onChange={(e) => {
                    if (e.target.value) {
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
                  }}
                >
                  <option value="">选择提供商...</option>
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
                  disabled={!currentProvider || !currentProvider.models?.length}
                >
                  <option value="">
                    {currentProvider ? '选择模型...' : '先选择提供商'}
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

            {currentModel && (
              <div className="app-model-config-current">
                当前:{' '}
                {currentProvider?.name} /{' '}
                {currentProvider?.models?.find((m) => m.id === currentModel.model)?.name ||
                  currentModel.model}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
