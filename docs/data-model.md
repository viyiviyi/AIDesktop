# 数据模型定义

> 本文档详细定义所有数据模型和存储格式。
> 对应后端实现：`server/src/types/index.ts`

---

## 1. 应用元数据 (meta.json)

每个应用目录下的 `meta.json`：

```json
{
  "id": "desktop-assistant",
  "name": "桌面助手",
  "description": "内置桌面助手",
  "source": "system",             // "system" | "user" | "marketplace"
  "type": "desktop",              // "desktop" | "background"
  "icon": "/icons/app.png",
  "backgroundImage": null,
  "dependsOn": ["file-manager"],  // 依赖的其他应用 ID（v2）
  "models": [
    {
      "provider": "openai",
      "model": "gpt-4o",
      "priority": 1,
      "maxTokens": 128000,
      "supports": ["text", "image"],
      "params": { "temperature": 0.7 }
    }
  ],
  "supportedInputs": ["text", "image", "audio"],
  "inputDescription": "支持文本、图片、语音输入",
  "outputDescription": "返回文本、图片、语音回复",
  "visibleApps": ["file-manager", "settings"],
  "visibleServices": ["clipboard", "notification"],
  "tools": ["mcp.filesystem", "mcp.shell"]
}
```

### App 运行时类型定义

```typescript
interface AppMeta {
  id: string;
  name: string;
  description: string;
  source: 'system' | 'user' | 'marketplace';
  type: 'desktop' | 'background';
  icon: string;
  backgroundImage?: string | null;
  dependsOn?: string[];          // v2 新增
  visibleApps?: string[];
  visibleServices?: string[];
  tools?: string[];
  skills?: string[];             // 已废弃，v2 改用 skills/ 目录
  models?: ModelConfig[];
  supportedInputs?: ContentType[];
  inputDescription?: string;
  outputDescription?: string;
}

interface App {
  meta: AppMeta;
  appMd: string;                 // Agent 系统提示
  mcpServices: string[];
  skills: string[];              // 已废弃
  config: AppConfig;             // 用户运行时配置
  allowConfig?: AllowConfig;
  appDir: string;
}
```

---

## 2. AppConfig (config.json)

用户配置覆盖，存于 `apps_data/{appId}/config.json`：

```typescript
interface AppConfig {
  enabled?: boolean;
  icon?: string;
  backgroundImage?: string;
  supportedInputs?: ContentType[];
  inputDescription?: string;
  outputDescription?: string;
  visibleApps?: string[];
  visibleServices?: string[];
  tools?: string[];
  skills?: string[];             // 已废弃，见 SPEC 第11章迁移策略
  models?: ModelConfig[];
  appMd?: string;
  headerParams?: ParamOverride[];
  bodyParams?: ParamOverride[];
}
```

**合并规则**：运行时 config 覆盖 meta，未配置的字段使用 meta 默认值。

---

## 3. 模型配置

```typescript
interface ModelConfig {
  provider: string;
  model: string;
  priority?: number;
  maxTokens?: number;
  supports?: string[];
  params?: Record<string, unknown>;
  headerParams?: ParamOverride[];
  bodyParams?: ParamOverride[];
}

interface ParamOverride {
  key: string;
  value: string;
  enabled: boolean;
}
```

---

## 4. 会话数据

存于 `apps_data/{appId}/conversations/{convId}.json`：

```typescript
interface Conversation {
  id: string;
  appId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
  workspaceDir?: string;         // 会话工作目录
}
```

### 消息类型

```typescript
type MessageRole = 'user' | 'assistant' | 'system' | 'toolResult';
type ContentType = 'text' | 'image' | 'audio' | 'video' | 'file';

interface Message {
  id: string;
  role: MessageRole;
  content: ContentBlock[];
  timestamp: string;
  replyTo?: string;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
}

type ContentBlock =
  | { type: 'text'; text: string; }
  | { type: 'image'; url: string; }
  | { type: 'audio'; url: string; }
  | { type: 'toolCall'; id: string; name: string; arguments: object; }
  | { type: 'toolResult'; toolCallId: string; content: string; isError?: boolean; };
```

---

## 5. 记忆数据

存于 `apps_data/{appId}/memories.json` 或 `apps_data/{appId}/conversations/{convId}/memories.json`：

```typescript
interface MemoryEntry {
  id: string;
  type: 'fact' | 'preference' | 'goal' | 'event' | 'custom';
  key: string;                   // 如 "user.name"
  value: string;                 // 如 "小明"
  content?: string;              // 详细描述
  tags?: string[];
  source?: 'agent' | 'user' | 'system';
  importance?: 'low' | 'normal' | 'high';
  ttl?: number;                  // 过期时间（秒）
  createdAt: string;
  updatedAt: string;
}
```

### 目标数据结构

```typescript
interface Goal {
  level: 1 | 2 | 3;
  value: string;
  source: 'agent' | 'user';
  status: 'active' | 'completed';
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}
```

---

## 6. 桌面设置

存于 `configs/setting.json`：

```typescript
interface DesktopSettings {
  theme: 'light' | 'dark' | 'auto';
  wallpaper: string;
  dock: {
    position: 'bottom' | 'left' | 'right';
    align: 'center' | 'left' | 'right';
    magnification: boolean;
    autoHide: boolean;
  };
  window: {
    defaultSize: { width: number; height: number };
    minSize: { width: number; height: number };
    maximized: boolean;
  };
  menuBar: { autoHide: boolean; };
  startMenu: { width: number; height: number; };
  sendKey: string;
}
```

---

## 7. 窗口状态（前端）

```typescript
interface WindowState {
  id: string;
  appId: string;
  title: string;
  icon?: string;
  app?: AppInfo;
  position: { x: number; y: number };
  size: { width: number; height: number };
  minSize: { width: number; height: number };
  isMaximized: boolean;
  isMinimized: boolean;
  zIndex: number;
  conversationId?: string;
  conversationTitle?: string;
}
```

---

## 8. MCP 配置

存于 `configs/mcp.json`：

```typescript
interface MCPConfig {
  connections: MCPConnection[];
}

interface MCPConnection {
  id: string;
  name: string;
  command?: string;
  args?: string[];
  transportType?: 'stdio' | 'sse' | 'http';
  url?: string;
  env?: Record<string, string>;
  enabled: boolean;
  enabledTools?: string[];
}
```
