# Hermes Agent 集成指南

## 概述

AIDesktop 已集成 Hermes Agent 作为后端 AI 引擎。Hermes Agent 是一个本地运行的 AI 代理服务，提供 OpenAI 兼容的 API 接口，支持多子代理架构。

---

## 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                    AIDesktop 前端                        │
└─────────────────────────┬───────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────┐
│                  AIDesktop 后端 (Port 3001)               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐   │
│  │ AgentEngine │  │ HermesAdapter│  │  Hermes Routes  │   │
│  └──────┬──────┘  └──────┬──────┘  └────────┬────────┘   │
└─────────┼────────────────┼─────────────────┼────────────┘
          │                │                 │
┌─────────▼────────────────▼─────────────────▼────────────┐
│              Hermes Agent (Port 8642)                   │
│  ┌─────────────────────────────────────────────────┐   │
│  │              API Server                           │   │
│  │  • /v1/chat/completions (OpenAI兼容)            │   │
│  │  • /v1/responses (有状态对话)                   │   │
│  │  • /v1/models                                   │   │
│  │  • /v1/capabilities                             │   │
│  │  • /health                                       │   │
│  └─────────────────────────────────────────────────┘   │
│                                                          │
│  ┌─────────────────────────────────────────────────┐   │
│  │           子代理 (Subagents)                     │   │
│  │  每个 AIDesktop 应用对应一个 Hermes 子代理         │   │
│  │  • app.md 作为系统提示                           │   │
│  │  • visibleApps 控制代理委托                      │   │
│  └─────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

---

## 快速开始

### 1. 配置 Hermes Agent

编辑 `~/.hermes/.env` 文件：

```bash
API_SERVER_ENABLED=true
API_SERVER_KEY=change-me-local-dev
API_SERVER_PORT=8642
API_SERVER_HOST=127.0.0.1
API_SERVER_CORS_ORIGINS=*
```

### 2. 启动 Hermes Agent

```bash
hermes gateway
```

### 3. 启动 AIDesktop 后端

```bash
cd server
npm run dev
```

### 4. 验证集成

```bash
# 检查 Hermes 健康状态
curl http://127.0.0.1:3001/api/hermes/health

# 获取完整状态
curl http://127.0.0.1:3001/api/hermes/status
```

---

## API 端点

### Hermes 管理接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/hermes/health` | 检查 Hermes Agent 健康状态 |
| GET | `/api/hermes/status` | 获取完整状态（健康+能力+模型） |
| GET | `/api/hermes/capabilities` | 获取 API 能力列表 |

### 响应示例

**健康检查** (`/api/hermes/health`):
```json
{
  "status": "ok",
  "hermes": {
    "status": "healthy",
    "timestamp": "2024-01-01T00:00:00.000Z"
  },
  "provider": {
    "id": "hermes",
    "name": "Hermes Agent",
    "baseUrl": "http://127.0.0.1:8642"
  }
}
```

**状态查询** (`/api/hermes/status`):
```json
{
  "configured": true,
  "provider": {
    "id": "hermes",
    "name": "Hermes Agent",
    "baseUrl": "http://127.0.0.1:8642",
    "modelsCount": 1
  },
  "health": {
    "status": "healthy",
    "timestamp": "2024-01-01T00:00:00.000Z"
  },
  "capabilities": { ... },
  "models": [
    { "id": "hermes-default", "name": "Hermes Default" }
  ]
}
```

---

## 配置说明

### 模型提供商配置

文件：`server/desktop_data/configs/modes.json`

```json
{
  "providers": [
    {
      "id": "hermes",
      "name": "Hermes Agent",
      "apiType": "openai",
      "apiKey": "change-me-local-dev",
      "baseUrl": "http://127.0.0.1:8642",
      "enabled": true,
      "models": [
        {
          "id": "hermes-default",
          "name": "Hermes Default",
          "maxTokens": 128000,
          "supports": ["text", "image"],
          "params": {
            "temperature": 0.7,
            "top_p": 0.9
          }
        }
      ]
    }
  ]
}
```

### 默认模型配置

文件：`server/desktop_data/configs/models.json`

```json
{
  "providerId": "hermes",
  "modelId": "hermes-default"
}
```

---

## 多代理集成

### 应用到子代理的映射

每个 AIDesktop 应用（拥有独立 `app.md`）对应一个 Hermes 子代理：

| AIDesktop 概念 | Hermes 子代理概念 |
|---------------|------------------|
| `app.md` | 子代理系统提示 (System Prompt) |
| `visibleApps` | 代理委托列表 (Delegation) |
| 应用 ID | `agent_id` |

### 消息流

1. 用户在 AIDesktop 中发送消息
2. `AgentEngine` 处理消息，构建消息数组
3. `HermesAdapter` 调用 Hermes Agent API
4. Hermes 根据 `app.md` 决定子代理处理
5. 响应返回 AIDesktop 前端

### 系统提示转换

Hermes 使用 `developer` 角色代替 `system` 角色：

```typescript
// 转换前 (AIDesktop)
{ role: 'system', content: [...] }

// 转换后 (Hermes)
{ role: 'developer', content: [...] }
```

---

## 故障排查

### Hermes Agent 未运行

```
错误：Hermes health check failed: 503
```

**解决方案：**
```bash
# 1. 检查 Hermes 进程
ps aux | grep hermes

# 2. 启动 Hermes Agent
hermes gateway

# 3. 确认端口监听
netstat -an | grep 8642
```

### API 密钥不匹配

```
错误：Hermes API error: 401 Unauthorized
```

**解决方案：**
确保 `~/.hermes/.env` 中的 `API_SERVER_KEY` 与 `modes.json` 中的 `apiKey` 一致：
```bash
# .env 文件
API_SERVER_KEY=change-me-local-dev

# modes.json
"apiKey": "change-me-local-dev"
```

### 连接被拒绝

```
错误：fetch failed: Connection refused
```

**解决方案：**
1. 确认 Hermes 运行在正确端口：`http://127.0.0.1:8642`
2. 检查防火墙设置
3. 验证 CORS 配置

---

## 开发指南

### 添加新的 Hermes 端点

编辑 `server/src/routes/hermes.ts`：

```typescript
router.get('/custom-endpoint', async (req: Request, res: Response) => {
  try {
    const adapter = new HermesAdapter(apiKey, baseUrl);
    // 处理请求
    res.json({ result: ... });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});
```

### 扩展 HermesAdapter

如需支持 Hermes 特有的 `/v1/responses` 有状态端点，可在 `server/src/models/hermes.ts` 中添加：

```typescript
// 有状态对话 (使用 Hermes /v1/responses)
async chatWithMemory(params: ChatParams, conversationId?: string): Promise<ChatResponse> {
  const response = await fetch(`${this.baseUrl}/v1/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`
    },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages.map(m => this.convertMessage(m)),
      conversation_id: conversationId
    })
  });
  // 处理响应...
}
```

---

## 文件清单

| 文件路径 | 说明 |
|---------|------|
| `server/src/models/hermes.ts` | Hermes API 适配器 |
| `server/src/models/index.ts` | 模型适配器导出 |
| `server/src/agents/engine.ts` | 使用 HermesAdapter 的代理引擎 |
| `server/src/services/settings.ts` | 设置服务（含 getHermesConfig） |
| `server/src/routes/hermes.ts` | Hermes 管理路由 |
| `server/src/index.ts` | 服务入口（已挂载路由） |
| `server/desktop_data/configs/modes.json` | 提供商配置 |
| `server/desktop_data/configs/models.json` | 默认模型配置 |

---

## 参考链接

- [Hermes Agent 官方文档](https://github.com/example/hermes-agent)
- [OpenAI API 兼容接口](https://platform.openai.com/docs/api-reference/chat)
