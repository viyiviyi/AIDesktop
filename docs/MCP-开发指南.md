# MCP 开发指南

> 本文档面向需要扩展或维护 AIDesktop MCP 系统的开发者。
> 对应后端实现：`server/src/mcp/`

---

## 1. MCP 概述

MCP（Model Context Protocol）是 AI Desktop 的工具扩展协议。系统内置两层 MCP 架构：

```
┌──────────────────────────────────────────────────────────┐
│                   AIDesktop Agent                         │
│  (通过 meta.tools + config.tools 决定可用工具)            │
└────────────────────┬─────────────────────────────────────┘
                     │
         ┌───────────┴───────────┐
         ▼                       ▼
┌─────────────────┐   ┌─────────────────────────┐
│  内置 MCP 服务    │   │   外部 MCP 客户端注册表    │
│  mcpServiceRegistry│  │   mcpClientRegistry      │
│  (service.ts)     │   │   (clientRegistry.ts)    │
├─────────────────┤   ├─────────────────────────┤
│ filesystem      │   │  stdio → 子进程          │
│ settings        │   │  SSE   → HTTP 长连接      │
│ browser         │   │  HTTP  → Streamable HTTP │
│ memory          │   │                          │
│ form, exec      │   └─────────────────────────┘
│ sleep, http     │
│ window, agent   │
│ skill, workspace│
└─────────────────┘
```

| 层 | 管理组件 | 注册方式 |
|----|---------|---------|
| **内置 MCP** | `mcpServiceRegistry`（`service.ts`） | 代码静态注册 |
| **外部 MCP** | `mcpClientRegistry`（`clientRegistry.ts`） | 配置文件动态加载，支持运行时连接/断开 |

---

## 2. 内置 MCP 服务一览

内置服务定义于 `server/src/mcp/service.ts`，按功能分为四类：

### 2.1 系统维护工具（admin）

| 服务名 | 方法 | 用途 |
|--------|------|------|
| `mcp.filesystem` | read, write, patch, search, list, move, copy, mkdir, delete | 文件系统操作（相对路径相对于 `desktop_data/`） |
| `mcp.settings` | get, update, getApps, getAppSettings, setAppSettings, getSkillsList | 系统设置读写 |

### 2.2 系统通用工具（builtin）

| 服务名 | 方法 | 用途 |
|--------|------|------|
| `mcp.form` | requestInput | 向用户展示结构化输入表单 |
| `mcp.memory` | remember, recall, recallByPrefix, forget, setGoal, completeGoal, getActiveGoals, getArchivedGoals, list, listTags, stats | 长期记忆管理 |
| `mcp.browser` | navigate, snapshot, click, type, scroll, back, vision, console, press | 浏览器控制（基于 Playwright） |
| `mcp.exec` | exec | 执行 shell 命令（自动注入当前操作系统信息） |
| `mcp.sleep` | sleep | 等待指定秒数（最长 600 秒） |
| `mcp.http` | request | HTTP 请求 |

### 2.3 工作区工具（workspace）

| 服务名 | 方法 | 用途 |
|--------|------|------|
| `workspace.code` | read, write, patch, search, list, move, copy, mkdir, delete | 工作区文件编辑（路径相对于会话工作目录） |
| `workspace.shell` | exec | 工作区 shell 命令执行（需用户授权） |

### 2.4 内置动态配置工具

以下工具不由 `meta.tools` 控制，满足条件时自动注入：

| 服务名 | 触发条件 | 方法 |
|--------|---------|------|
| `mcp.skill` | 应用配置了可用技能时自动添加 | list, read, readEntry, listFiles, listScripts, exec |
| `mcp.agent` | 应用配置了可见应用时自动添加 | list, call |
| `mcp.injection` | `mcp.memory` 启用时自动注入 | getContext |

> **注意**：`mcp.window`（窗口管理）、`mcp.agent` 等部分服务在旧版文档中列出，当前代码中可能已合并或重构，以 `service.ts` 为准。

---

## 3. 外部 MCP 接入

外部 MCP 服务器通过 `desktop_data/configs/setting.json` 的 `mcp.connections` 配置，或运行时通过 API 连接。

### 3.1 支持的传输协议

#### stdio — 子进程模式

通过标准输入/输出启动子进程通信。

```json
{
  "name": "playwright",
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "@playwright/mcp@latest"],
  "env": {
    "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD": "1"
  }
}
```

**特点**：
- 子进程由 `MCPProcessManager` 管理（`processManager.ts`）
- 30 秒心跳保活，5 秒优雅关闭超时
- 进程崩溃后不自动重启

#### SSE — 传统 SSE 协议

分 SSE 端点和 POST 端点：

```json
{
  "name": "my-service",
  "transport": "sse",
  "url": "http://localhost:3001/sse",
  "headers": {
    "Authorization": "Bearer sk-xxx"
  }
}
```

**通信模式**：
- GET `{url}` — SSE 事件流（服务端 → 客户端推送）
- POST `{url}/message` — JSON-RPC 请求（客户端 → 服务端）

#### HTTP — Streamable HTTP（MCP 新规范）

单端点 POST：

```json
{
  "name": "aliyun-mcp",
  "transport": "http",
  "url": "https://dashscope.aliyuncs.com/api/v2/mcp",
  "headers": {
    "Authorization": "Bearer sk-xxx",
    "Content-Type": "application/json"
  }
}
```

**特点**：
- 响应可能为 JSON（立即完成）或 SSE 流式（异步完成）
- 客户端根据 `Content-Type` 自动判断

### 3.2 认证配置

SSE/HTTP 类型通过自定义请求头支持认证：

```json
{
  "headers": {
    "Authorization": "Bearer YOUR_API_KEY",
    "X-Custom-Auth": "token"
  }
}
```

常用认证方式：
- **Bearer Token**：`Authorization: Bearer sk-xxx`
- **API Key**：`X-API-Key: your-key`
- **自定义头**：按需添加

### 3.3 运行时动态连接

```bash
# 通过 API 连接
POST /api/mcp/connect
{
  "name": "playwright",
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "@playwright/mcp@latest"]
}

# 断开连接
DELETE /api/mcp/connect/:connectionId
```

---

## 4. 工具命名规范

### 4.1 内置服务

```
格式：mcp_{service}_{method}
示例：mcp_filesystem_read, mcp_browser_navigate, mcp_memory_remember
```

### 4.2 外部 MCP 工具

```
格式：mcp_{连接名}_{工具名}
示例：mcp_Browser_browser_navigate, mcp_playwright_browser_navigate
```

**⚠️ 关键规则**：
- **禁止在 key 中使用 UUID**，用连接名代替
- `safeConnName` = `(client.serverInfo?.name || connectionId).replace(/[^a-zA-Z0-9_-]/g, '_')`
- 仅遍历已连接的客户端，断开的工具自动消失
- 前端 `AppSettingsWindow` 中 checkbox 的 key 格式：`external:${safeConnName}:${tool.name}`

### 4.3 工具配置存储

```typescript
// 配置 Key（前后端格式）
const appToolKey = `external:${safeConnName}:${tool.name}`;
// 例: external:Browser:browser_navigate

// AI Agent 看到的工具名
const agentToolName = `mcp_${safeConnName}_${safeToolName}`;
// 例: mcp_Browser_browser_navigate
```

---

## 5. 应用工具配置

每个应用通过 `meta.json` 中的 `tools` 字段声明可用的 MCP 服务列表：

```json
{
  "tools": [
    "mcp.filesystem",
    "mcp.settings",
    "mcp.browser",
    "mcp.memory",
    "mcp.form",
    "workspace.code"
  ]
}
```

**合并规则**：
1. `meta.json` 中的 `tools` 定义默认值
2. `apps_data/{appId}/config.json` 中的 `tools` 覆盖默认值
3. 用户可在应用设置 → 工具标签页中勾选/取消
4. 运行时 `meta.tools` + `config.tools` 合并 → 取并集

---

## 6. 开发新内置 MCP 服务

### 6.1 注册服务

编辑 `server/src/mcp/service.ts`，在 `builtInServices` 对象中添加：

```typescript
const builtInServices: Record<string, MCPService> = {
  // ... 已有服务
  
  'mcp.myservice': {
    name: 'mcp.myservice',
    description: '我的自定义服务 - 功能说明',
    methods: ['doSomething', 'doAnother'],
    category: 'builtin', // admin | builtin | workspace
  },
};
```

### 6.2 实现方法处理

在 `callMethod` 中找到对应 `serviceName` 的分支，添加 handler：

```typescript
case 'mcp.myservice': {
  switch (method) {
    case 'doSomething':
      return await handleMyServiceDoSomething(args, app);
    case 'doAnother':
      return await handleMyServiceDoAnother(args, app);
    default:
      throw new Error(`Unknown method: ${method}`);
  }
}
```

### 6.3 在应用 meta 中启用

应用需要在其 `meta.json` 的 `tools` 数组中添加 `"mcp.myservice"`。

---

## 7. 关键源码文件

| 文件 | 行数 | 职责 |
|------|------|------|
| `server/src/mcp/service.ts` | 1310 | 内置服务注册 + 方法分发处理 |
| `server/src/mcp/clientRegistry.ts` | — | 外部 MCP 客户端注册表 |
| `server/src/mcp/externalClient.ts` | 216 | 外部 MCP 客户端封装（SDK 适配） |
| `server/src/mcp/processManager.ts` | 208 | 子进程管理（Windows 兼容） |
| `server/src/mcp/stdioTransport.ts` | — | stdio 传输层实现 |
| `server/src/mcp/sseTransport.ts` | 233 | SSE + Streamable HTTP 传输层 |
| `server/src/mcp/jsonRpcClient.ts` | — | JSON-RPC 客户端（请求/通知） |
| `server/src/mcp/browser/` | — | 浏览器控制相关模块 |
| `server/src/agents/pi-tools.ts` | 447 | 工具构建 + 名称转换 + 过滤 |

---

## 8. 常见问题

### 8.1 外部 MCP 连接失败

1. 检查网络连通性（自建服务确保端口可达）
2. 检查认证配置（`headers` 中的 Token 是否正确）
3. 检查服务端日志（`/api/logs` 查看 `[mcp]` 分类日志）
4. SSE 模式确保服务端同时支持 `GET /sse` 和 `POST /message`
5. stdio 模式确认命令和参数正确、可执行文件在 PATH 中

### 8.2 外部工具在应用设置中不显示

1. 确认 MCP 连接已成功建立（`/api/mcp/connections` 返回正常）
2. 检查服务端是否成功调用 `listTools()`
3. 检查应用设置 → 工具标签页，外部工具应有 checkbox
4. 排查工具 key 格式是否含 UUID（旧格式失效）

### 8.3 提示"工具不存在"

1. 检查前端应用设置中该工具是否已勾选
2. 外部 MCP 断开连接后工具自动消失，需要重新连接
3. 内置服务需要确保 `meta.tools` 或 `config.tools` 中已包含

### 8.4 工具名称带 UUID

旧格式 `external:UUID:toolName` 在新代码下自动失效。需在应用设置 → 工具标签页重新勾选对应 MCP 工具并保存。新格式：`external:连接名:工具名`。
