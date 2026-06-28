# API 接口文档

> 本文档是 `SPEC.md` 第5章的完整展开，包含所有 API 路由定义。
> 对应后端实现：`server/src/routes/`

---

## 1. 应用管理

**基础路径**：`/api/apps`

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/apps` | 获取已安装应用列表（可按 source 过滤） |
| GET | `/api/apps/:appId` | 获取应用详情 |
| POST | `/api/apps` | 创建新应用 |
| PUT | `/api/apps/:appId` | 更新应用配置 |
| DELETE | `/api/apps/:appId` | 删除应用 |
| POST | `/api/apps/:appId/refresh` | 刷新应用状态 |

### 响应示例

```json
// GET /api/apps
[
  {
    "id": "desktop-assistant",
    "name": "桌面助手",
    "source": "system",
    "type": "desktop",
    "icon": "/icons/desktop-assistant.png",
    "description": "内置桌面助手"
  }
]

// GET /api/apps/desktop-assistant
{
  "id": "desktop-assistant",
  "name": "桌面助手",
  "source": "system",
  "type": "desktop",
  "icon": "/icons/desktop-assistant.png",
  "tabs": ["conversation", "settings"],
  "enabled": true,
  "supportedInputs": ["text", "image"],
  "inputDescription": "支持文本和图片输入",
  "outputDescription": "返回文本回复",
  "visibleApps": ["file-manager"],
  "visibleServices": [],
  "tools": ["mcp.filesystem"],
  "models": [],
  "appMd": "...Agent 系统提示...",
  "allowConfig": null
}
```

---

## 2. 会话管理

**基础路径**：`/api/apps/:appId/conversations`

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/apps/:appId/conversations` | 获取所有会话列表 |
| GET | `/api/apps/:appId/conversations/:convId` | 获取单个会话详情（含消息） |
| POST | `/api/apps/:appId/conversations` | 创建新会话 |
| DELETE | `/api/apps/:appId/conversations/:convId` | 删除会话 |
| POST | `/api/apps/:appId/conversations/:convId/messages` | 发送消息 |
| PUT | `/api/apps/:appId/conversations/:convId/title` | 更新会话标题 |
| GET | `/api/apps/:appId/conversations/:convId/stream` | SSE 流式获取消息 |

### 消息格式

```typescript
interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'toolResult';
  content: Content[];
  timestamp: string;
  replyTo?: string;           // 回复的目标消息 ID
  toolCallId?: string;        // toolResult 的消息关联的 toolCall
  toolName?: string;
  isError?: boolean;
}

interface TextContent { type: 'text'; text: string; }
interface ImageContent { type: 'image'; url: string; }
interface AudioContent { type: 'audio'; url: string; }
interface ToolCallContent { type: 'toolCall'; id: string; name: string; arguments: object; }
interface ToolResultContent { type: 'toolResult'; toolCallId: string; content: string; isError?: boolean; }
```

---

## 3. 系统设置

**基础路径**：`/api/settings`

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/settings` | 获取系统设置 |
| PUT | `/api/settings` | 更新系统设置 |
| GET | `/api/settings/modes` | 获取模型提供商配置 |
| PUT | `/api/settings/modes` | 更新模型提供商配置 |
| GET | `/api/settings/mcp` | 获取 MCP 服务配置 |
| PUT | `/api/settings/mcp` | 更新 MCP 服务配置 |
| POST | `/api/settings/mcp/connect` | 连接新的 MCP 服务 |
| DELETE | `/api/settings/mcp/:connectionId` | 断开 MCP 服务连接 |
| GET | `/api/settings/skills` | 获取全局技能配置 |
| PUT | `/api/settings/skills` | 更新全局技能配置 |
| POST | `/api/settings/skills` | 添加新技能 |
| DELETE | `/api/settings/skills/:skillId` | 删除技能 |

---

## 4. MCP 服务

**基础路径**：`/api/mcp`

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/mcp/services` | 获取所有可用 MCP 服务 |
| POST | `/api/mcp/call` | 调用 MCP 方法 |
| GET | `/api/mcp/connections` | 获取所有已连接的外部 MCP 服务器 |
| POST | `/api/mcp/connect` | 连接外部 MCP 服务器 |
| DELETE | `/api/mcp/connect/:connectionId` | 断开外部 MCP 连接 |
| GET | `/api/mcp/connections/:connectionId/tools` | 获取连接的可用工具 |
| GET | `/api/mcp/connections/:id` | 获取单个连接详情（含工具启用状态） |
| PUT | `/api/mcp/connections/:id/tools` | 更新连接的启用工具 |
| POST | `/api/mcp/connections/:connectionId/call` | 在指定连接上调用工具 |

---

## 5. 记忆管理

**基础路径**：`/api/apps/:appId/memory`

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/api/apps/:appId/memory` | 记忆操作（list/remember/forget/setGoal/completeGoal 等） |

**请求体**：
```json
{
  "method": "list",                    // list | remember | forget | getActiveGoals | getArchivedGoals | setGoal | completeGoal
  "args": {
    "scope": "app",                    // "app" | "conversation"
    "key": "user.name",                // remember 时需要
    "value": "小明",                   // remember 时需要
    "importance": "normal",            // remember 时可选
    "id": "mem-xxx",                   // forget 时需要
    "level": 3,                        // setGoal/completeGoal 时需要
    "source": "user"                   // 来源标记
  }
}
```

---

## 6. 注入状态

**基础路径**：`/api/apps/:appId/injections`

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/apps/:appId/injections?convId=xxx` | 获取注入状态摘要 blocks |

**返回**：`{ blocks: InjectionBlock[] }`

```typescript
interface InjectionBlock {
  source: 'app' | 'memory' | 'goal';
  label: string;     // 标签名（如 "应用状态"）
  title: string;     // 标题（如应用名称）
  detail: string;    // Markdown 格式的详情
}
```

---

## 7. 日志

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/logs?limit=500` | 获取日志 |
| GET | `/api/logs/stream` | SSE 实时日志推送 |
| POST | `/api/logs/clear` | 清除日志 |

---

## 8. 工作区

**基础路径**：`/api/workspace`

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/api/workspace/list` | 列出工作区文件 |
| POST | `/api/workspace/read` | 读取工作区文件 |
| POST | `/api/workspace/write` | 写入工作区文件 |
| POST | `/api/workspace/cwd` | 获取/设置工作目录 |

---

## 9. 媒体

**基础路径**：`/api/apps/:appId/media`

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/api/apps/:appId/media/upload` | 上传媒体文件（图标/背景/图片） |
| GET | `/api/apps/:appId/media/:type/:filename` | 获取媒体文件 |

---

## 10. Hermes Agent

**基础路径**：`/api/hermes`

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/hermes/modes` | 获取可用模式列表 |
| GET | `/api/hermes/skills` | 获取技能列表 |
| POST | `/api/hermes/chat` | Hermes 聊天接口 |
