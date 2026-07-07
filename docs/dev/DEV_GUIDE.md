# AIDesktop 开发维护指南

> 基于项目当前代码结构与运行状态编写的完整开发参考手册。
> 本文档将逐步替代项目初期编写的旧版 [`开发维护指南.md`](../开发维护指南.md)。

---

## 目录

1. [项目概述](#1-项目概述)
2. [项目结构总览](#2-项目结构总览)
3. [数据架构](#3-数据架构)
4. [启动与开发](#4-启动与开发)
5. [Agent 系统](#5-agent-系统)
6. [MCP 系统](#6-mcp-系统)
7. [工具系统](#7-工具系统)
8. [前端架构](#8-前端架构)
9. [主题系统](#9-主题系统)
10. [API 后端](#10-api-后端)
11. [外部 MCP 工具命名规范](#11-外部-mcp-工具命名规范)
12. [构建与部署](#12-构建与部署)
13. [Git 提交规范](#13-git-提交规范)
14. [常见问题与排错](#14-常见问题与排错)

---

## 1. 项目概述

### 1.1 项目定位

AIDesktop 是一个**桌面化的多 Agent 协作系统**。用户看到的是仿 macOS 风格的桌面操作系统，每个桌面"应用"都是一个 AI Agent，可以独立运行、互相调用。

**核心理念**：
- **所见即所得**：像使用桌面操作系统一样使用 AI
- **Agent 即服务**：每个应用都是可编程的 AI 服务
- **本地优先**：数据存储在本地 `desktop_data`，支持离线

### 1.2 技术栈

| 层 | 技术 |
|----|------|
| 前端框架 | React 19 + TypeScript |
| UI 组件库 | Ant Design 6 |
| 构建工具 (前端) | Vite 8 |
| 后端框架 | Express 4 + TypeScript |
| 构建工具 (后端) | esbuild + Node.js SEA |
| Agent 引擎 | pi-agent-core (自研，streamFn 模式) |
| 模型协议 | pi-ai (自研，支持 OpenAI/Anthropic 兼容) |
| 外部工具协议 | MCP (Model Context Protocol) |
| 样式方案 | 纯 CSS + CSS 变量双主题（dark/light） |

### 1.3 当前开发阶段

项目已进入 Phase 4（优化体验），部分 Phase 5（应用级技能系统）的前置工作已开始。

- **Phase 1**: 核心框架 ✅
- **Phase 2**: Agent 核心 ✅
- **Phase 3**: 完善功能 ✅
- **Phase 4**: 优化体验（**当前**）— 主题/壁纸、语音输入、通知、权限
- **Phase 5**: 应用级技能系统（规划）— skills/ 目录、include.json、allow.json、应用商店

---

## 2. 项目结构总览

```
AIDesktop/
│
├── client/                          # 前端 (React SPA)
│   └── src/
│       ├── components/              # 20+ React 组件
│       │   ├── 桌面核心: Desktop, Dock, MenuBar, Window, StartMenu
│       │   ├── 功能组件: InjectionBar, MarkdownView, MemoryPanel
│       │   ├── 应用管理: AppSettingsWindow, AppManagerWindow, AppDetailWindow
│       │   ├── 配置: AppModelConfig, MediaSelector, FormComponent
│       │   └── 通用: LogPanel, LogWindow, ToastContainer, WorkspaceDirSelector
│       ├── contexts/                # DesktopContext, ToastContext
│       ├── services/                # api.ts, logger.ts, useAgentEventStream
│       ├── types/index.ts           # 前端类型定义
│       └── styles/global.css        # 全局样式 + CSS 变量双主题
│
├── server/                          # 后端 (Express + TypeScript)
│   ├── desktop_data/                # 本地数据存储
│   │   ├── apps/                    # 应用定义目录
│   │   │   ├── system/              # 系统内置应用（desktop-assistant, browser, app-builder, skill-maker）
│   │   │   ├── user/                # 用户创建的应用
│   │   │   └── marketplace/         # 应用商店（预留）
│   │   ├── apps_data/{appId}/       # 应用运行时数据
│   │   │   ├── config.json          # 用户运行时配置
│   │   │   ├── memories.json        # 应用级记忆
│   │   │   ├── conversations/       # 会话数据
│   │   │   └── data/                # 应用专用数据
│   │   ├── configs/                 # 配置文件
│   │   │   ├── setting.json         # 桌面设置
│   │   │   ├── modes.json           # 模型提供商配置
│   │   │   ├── setting.json         # 桌面外观设置
│   │   │   └── window-positions.json# 窗口位置
│   │   ├── workspaces/              # 会话工作区文件
│   │   ├── wallpapers/              # 壁纸
│   │   └── public_icons/            # 应用图标
│   │
│   └── src/
│       ├── index.ts                 # 服务入口
│       ├── routes/                  # 10 个路由模块
│       │   ├── apps.ts              # 应用 CRUD
│       │   ├── conversations.ts     # 会话管理 + SSE 流式
│       │   ├── settings.ts          # 系统设置
│       │   ├── mcp.ts               # MCP 外部服务管理
│       │   ├── memory.ts            # 记忆管理
│       │   ├── injections.ts        # 注入状态查询
│       │   ├── logs.ts              # 日志
│       │   ├── workspace.ts         # 工作区校验
│       │   ├── hermes.ts            # Hermes Agent 集成
│       │   └── media.ts             # 媒体文件管理
│       ├── agents/                  # Agent 核心
│       │   ├── pi-agent-session.ts  # Agent 会话封装（925 行 - 核心文件）
│       │   └── pi-tools.ts          # 工具构建（447 行）
│       ├── mcp/                     # MCP 系统
│       │   ├── service.ts           # 内置服务注册 + 方法分发（1683 行 - 核心文件）
│       │   ├── clientRegistry.ts    # 外部 MCP 客户端注册表
│       │   ├── externalClient.ts    # 外部 MCP 客户端封装
│       │   ├── processManager.ts    # 子进程管理
│       │   ├── jsonRpcClient.ts     # JSON-RPC 通信
│       │   ├── sseTransport.ts      # SSE 传输层
│       │   └── stdioTransport.ts    # stdio 传输层
│       ├── models/                  # 模型适配
│       │   ├── pi-adapter.ts        # pi-ai 桥接层
│       │   ├── openai.ts            # OpenAI 兼容适配器
│       │   └── index.ts
│       ├── services/                # 业务服务
│       │   ├── appLoader.ts         # 应用加载器
│       │   ├── appState.ts          # 应用状态管理
│       │   ├── conversation.ts      # 会话服务
│       │   ├── memory.ts            # 记忆服务
│       │   ├── settings.ts          # 设置服务
│       │   ├── skillService.ts      # 技能管理
│       │   ├── eventBus.ts          # 事件总线
│       │   └── wsServer.ts          # WebSocket/SSE 推送
│       ├── types/index.ts           # 后端类型定义（433 行）
│       ├── utils/
│       │   ├── logger.ts            # 日志工具
│       │   └── file.ts              # 文件工具
│       └── hermes/                  # Hermes Agent 集成
│
├── docs/                            # 文档
│   ├── SPEC.md                      # 产品设计规格书
│   ├── api-spec.md                  # API 接口文档
│   ├── data-model.md                # 数据模型定义
│   ├── component-guide.md           # 前端组件指南
│   ├── implementation-details.md    # 实现细节
│   ├── 开发维护指南.md               # 旧版开发指南
│   └── dev/                         # 新版开发文档
│       ├── DEV_GUIDE.md             # 本文件
│       └── 重构系统内置工具.md        # 工具重构规划
│
└── .hermes/                         # Hermes Agent 配置
    └── plans/
```

---

## 3. 数据架构

### 3.1 目录分离原则

项目将**应用定义**与**运行时数据**分离在两个根目录下：

| 目录 | 用途 | 示例 |
|------|------|------|
| `desktop_data/apps/` | 应用定义（meta.json + app.md + skills/） | 系统内置、用户创建 |
| `desktop_data/apps_data/{appId}/` | 运行时数据（config.json + conversations/） | 用户配置、会话历史 |

**关键规则**：
- `apps/{source}/{id}/meta.json` — 应用定义。仅在创建时由 `createApp` 写入
- `apps_data/{id}/config.json` — 用户运行时配置。纯 UI 修改时写入
- 运行时 **config 覆盖 meta**，未配置的字段使用 meta 默认值
- `system` 来源的应用不可删除

### 3.2 系统内置应用

当前四个内置应用：

| 应用 ID | 名称 | 类型 | 目录 |
|---------|------|------|------|
| `desktop-assistant` | 桌面助手 | desktop | `apps/system/desktop-assistant/` |
| `browser` | 浏览器 | desktop | `apps/system/browser/` |
| `app-builder` | 创建应用 | desktop | `apps/system/app-builder/` |
| `skill-maker` | 技能制作 | desktop | `apps/system/skill-maker/` |

### 3.3 应用目录结构（当前实现）

```
apps/{source}/{id}/
├── meta.json         # 应用元数据
├── app.md            # Agent 系统提示
├── mcp.json          # MCP 服务列表（可选）
├── skills/           # 私有技能目录（可选）
└── data/             # 应用专用数据（可选）
```

### 3.4 meta.json 字段说明

```json
{
  "id": "desktop-assistant",          // 唯一标识
  "name": "桌面助手",                  // 显示名称
  "description": "内置桌面助手",       // 描述
  "source": "system",                  // system | user | marketplace
  "type": "desktop",                   // desktop | background
  "models": [{ ... }],                 // 模型配置列表
  "supportedInputs": ["text","image"], // 支持输入类型
  "inputDescription": "支持文本和图片输入",
  "outputDescription": "返回文本回复",
  "visibleApps": ["settings","file-manager"],      // 对其他 desktop 应用可见
  "visibleServices": ["clipboard","notification"], // 对 background 服务可见
  "tools": ["mcp.filesystem","mcp.settings","mcp.browser","mcp.memory"...]  // 可用的 MCP 工具
}
```

---

## 4. 启动与开发

### 4.1 环境要求

- Node.js 18+（推荐 20+）
- npm（推荐 10+）

### 4.2 启动命令

```bash
# 前端开发服务器（端口 5173，自动代理 /api → localhost:3001）
cd client && npm install && npm run dev

# 后端开发服务器（端口 3001，tsx watch 模式自动重载）
cd server && npm install && npm run dev
```

### 4.3 数据目录位置

数据目录在 `server/desktop_data/`，由代码中 `DATA_DIR` 常量定义。调试时可修改位置。

### 4.4 调试手段

- **日志应用**：打开"日志"应用可查看实时日志（支持级别/分类过滤）
- **InjectionBar**：窗口标题栏下方显示应用状态/记忆/目标摘要
- **后端日志**：所有工具调用、AI 请求/响应自动记录 `serverLogger`

---

## 5. Agent 系统

### 5.1 核心架构

Agent 系统使用自研的 `pi-agent-core` 引擎（非 LangChain），核心模式是 `streamFn(model, context, options)` 流式调用 LLM。

**文件**：`server/src/agents/pi-agent-session.ts`（925 行 — 项目中最大、最核心的文件之一）

### 5.2 消息流

```
用户发送消息
  → POST /api/apps/{appId}/conversations/{convId}/messages
    → conversationService.addMessage()    // 保存 user 消息
    → runAgentAsync()                     // 异步启动 Agent
      → getOrCreateSession()              // 获取或新建 PiAgentSession
      → syncHistory()                     // 同步历史消息
      → injectWorkspaceTools()            // 注入工作区工具
      → buildSystemPrompt()               // 构建 system prompt
      → session.prompt()                  // 调用 LLM（streamFn）
        → 通过 eventBus 发射 SSE 事件
          → text_chunk → SSE → 前端渲染
          → tool_call → SSE → toolCall 卡片
          → tool_result → SSE → toolResult
          → message_end → SSE → 保存最终消息
```

**关键文件**：`server/src/agents/pi-agent-session.ts` 中的 `runAgentAsync()` 函数。

### 5.3 System Prompt 构建顺序

`buildSystemPrompt()` 在每次 Agent 执行时构建，顺序如下：

1. `app.md`（Agent 系统提示）
2. 可调用的 Agent 列表（visibleApps 中配置的）
3. 已加载技能列表（名称 + 描述 + mcp.skill 工具使用提示）
4. 长期记忆（应用级 + 会话级 + 目标树）
5. 记忆工具使用提示（mcp.memory 已启用时）

### 5.4 事件驱动

Agent 通过 `eventBus` 发射事件，由 `wsServer.ts` 转发为 SSE：

| 事件 | 触发时机 | 前端处理 |
|------|----------|----------|
| `text_chunk` | 流式文本块 | 追加到 streamingText |
| `tool_call` | 工具执行开始 | 显示 toolCall 卡片 |
| `tool_result` | 工具执行结束 | 显示 toolResult |
| `message_end` | 完整消息结束 | 追加到 messages |
| `agent_call_start` | Agent 调用另一个 Agent | 前端显示调用提示 |
| `user_input_request` | 等待用户表单输入 | 显示表单 |

### 5.5 Agent 间互调

Agent 可以通过 `mcp.agent.call` 调用其他 Agent。流程：

1. 调用方通过 `mcp.agent.call({ agentId, message })` 发起调用
2. 被调用 Agent 创建（或复用）会话，继承调用者的工作目录
3. 异步执行，通过 eventBus 监听 `agent_call_end_auto` 事件获取结果
4. 一个调用的默认超时是 2 分钟

工作目录继承：被调用 Agent 的会话继承调用方的工作目录，保持上下文一致。

---

## 6. MCP 系统

### 6.1 两层架构

MCP 系统分为两层：

1. **内置 MCP 服务** — 由 `mcpServiceRegistry` 管理，在 `service.ts` 中注册
2. **外部 MCP 服务** — 由 `mcpClientRegistry` 管理，通过 stdio/SSE/HTTP 连接

**核心文件**：`server/src/mcp/service.ts`（1683 行 — 项目中最大的文件）

### 6.2 内置 MCP 服务注册

注册于 `service.ts` 的 `builtInServices` 对象，按 category 分三类：

#### admin 类（系统管理工具）
需要在应用 meta.json 的 tools 数组中显式声明才能使用：

| 服务名 | 方法 |
|--------|------|
| `mcp.filesystem` | read, write, patch, search, list, mkdir, delete |
| `mcp.settings` | get, update, getApps, getAppSettings, setAppSettings, getSkillsList |

#### builtin 类（系统通用工具）
同样是需要显式声明才能使用：

| 服务名 | 方法 |
|--------|------|
| `mcp.form` | requestInput |
| `mcp.memory` | remember, recall, recallByPrefix, forget, setGoal, completeGoal, getActiveGoals, getArchivedGoals, list, listTags, stats |
| `mcp.browser` | navigate, snapshot, click, type, scroll, back, vision, console, press |
| `mcp.exec` | exec |
| `mcp.sleep` | sleep（最长 600 秒，可用于等待外部操作完成或模拟延时） |
| `mcp.http` | request |

#### workspace 类（工作区工具）
由 `buildWorkspaceTools()` 单独注入，同时 `workspace.shell` 也会在 workspace 分类注入：

| 服务名 | 方法 |
|--------|------|
| `workspace.code` | read, write, patch, search, list |
| `workspace.shell` | exec |

#### 内置动态配置工具
不由 `meta.tools` 控制，条件满足时自动注入：

| 工具名 | 触发条件 | 说明 |
|--------|----------|------|
| `mcp_skill_list` | app 配置有技能时 | 获取当前应用已授权的技能列表 |
| `mcp_agent_list` | app 有可见应用/服务时 | 获取当前应用可见的 Agent 列表 |

`workspace.code` 有 `workspaceFields` 配置，标记哪些字段名是路径参数（相对路径拼接工作目录）。

### 6.3 方法分发机制

`mcpServiceRegistry.callMethod(serviceName, method, args, context)` 通过 switch-case 将调用分发到对应的 `handleXxxMethod` 函数。每个 handle 函数根据 method 再次 switch。

特殊处理：
- `mcp.form.requestInput`：通过 `eventBus` 发射 `user_input_request` 事件，等待用户通过表单提交
- `mcp.agent.call`：创建被调 Agent 的会话，通过 eventBus 监听结果（2 分钟超时）
- `mcp.filesystem.search`：必须指定 `baseDir`，使用 `rg` (ripgrep) 搜索
- `mcp.skill.*`：转发到 `skillService`

### 6.4 外部 MCP 客户端

支持三种传输协议：

| 传输类型 | 说明 | 配置 |
|----------|------|------|
| stdio | 通过子进程启动 | command + args |
| SSE | 传统 Server-Sent Events | url + headers |
| HTTP | Streamable HTTP 传输 | url |

连接管理流程：
1. `mcpClientRegistry.connect()` → 创建 ExternalClient
2. ExternalClient 初始化（initialize + listTools）
3. 工具列表暴露，应用可在设置中勾选启用
4. 断开时调用 `disconnect()`，断开的工具自动从 Agent 工具列表中移除

**关键规则**：禁止在工具 key 中使用 UUID 作为连接标识符，使用连接名代替。

---

## 7. 工具系统

### 7.1 架构

工具构建分为三个入口函数，都在 `server/src/agents/pi-tools.ts`：

```typescript
buildPiToolsForApp(app: App): AgentTool[]     // 为指定 app 构建内置工具
buildWorkspaceTools(app, convId): AgentTool[]  // 构建工作区工具
buildPiTools(): AgentTool[]                     // 全局工具（未启用）
```

### 7.2 权限控制

工具的可见性通过两层控制：

1. **应用声明**：`meta.json` / `config.json` 中的 `tools` 数组列出可用服务
2. **运行时合并**：`new Set([...app.config.tools, ...app.meta.tools])` 取并集
3. **外部工具**：格式 `external:{safeConnName}:{toolName}`，勾选 `mcp.external` 则允许所有

### 7.3 工具分类

| 分类 | 注入函数 | 控制方式 |
|------|----------|----------|
| 系统维护工具 (admin) | `buildPiToolsForApp()` | 需在 meta.tools 中声明 |
| 系统通用工具 (builtin) | `buildPiToolsForApp()` | 需在 meta.tools 中声明 |
| 工作区工具 (workspace) | `buildWorkspaceTools()` | 需在 meta.tools 中声明，受工作目录+授权限制 |
| 外部 MCP 工具 | `buildPiToolsForApp()` → `buildExternalMcpAgentTools()` | 需勾选具体工具或 `mcp.external` |
| 动态配置工具 | `buildDynamicConfigTools()` → `injectDynamicConfigTools()` | 条件触发，自动注入 |

### 7.4 工具构建流程

每次 Agent 执行时，`runAgentAsync` 中的调用顺序：

1. `buildPiToolsForApp(app)` — 注入 admin + builtin + 外部 MCP 工具
2. `injectWorkspaceTools(app, convId)` — 注入 workspace 工具（含工作目录上下文）
3. `injectDynamicConfigTools(app)` — 注入 skill_list / agent_list（条件触发）

### 7.3 工具名称规范

```
内置工具：    mcp_filesystem_read     (service.method → service_method)
外部工具：    mcp_Browser_browser_navigate  (mcp_{连接名}_{工具名})
```

工具名中不能包含 `.`，因为某些 LLM（如 DeepSeek）的 function name 只允许 `^[a-zA-Z0-9_-]+$`。

### 7.4 Schema 定义

有两套独立的参数 schema：
- `_w` 后缀：工作区工具（路径支持绝对路径或相对工作目录）
- 无后缀：`apps_data` 工具（路径相对 `desktop_data` 目录）

例如 `codeReadSchema` vs `codeReadSchema_w`，`codeSearchSchema` vs `codeSearchSchema_w`。

### 7.5 工作区工具

`buildWorkspaceTools()` 在 Agent 执行时由 `runAgentAsync()` 调用，需要传入当前的 `convId`。工作区工具自动绑定当前会话的工作目录。

### 7.6 工具重构规划

详见 [重构系统内置工具.md](重构系统内置工具.md)。当前工具分类将重构为以下层次：

| 层次 | 说明 | 鉴权 |
|------|------|------|
| 系统维护工具 | 文件系统、设置 | 管理员权限 |
| 系统通用工具 | 表单、记忆、浏览器、命令行、等待、HTTP | 管理员权限 |
| 工作区工具 | 文件系统、命令行 | 需鉴权 + 用户授权 |
| 内置动态配置工具 | skill、应用访问 | 条件触发加载 |

---

## 8. 前端架构

### 8.1 组件结构

前端采用 React + Ant Design，共 20+ 组件。核心组件：

| 组件 | 文件 | 职责 |
|------|------|------|
| Desktop | `Desktop.tsx` | 桌面背景、图标网格、应用启动入口 |
| Dock | `Dock.tsx` | 底部应用停靠栏，hover 放大效果 |
| MenuBar | `MenuBar.tsx` | 顶部菜单栏，时间/状态显示 |
| StartMenu | `StartMenu.tsx` | 开始菜单，应用列表+最近对话 |
| Window | `Window.tsx` | 通用窗口容器，标题栏+内容区+拖拽/缩放 |
| InjectionBar | `InjectionBar.tsx` | 状态摘要栏（标题栏下方） |
| MarkdownView | `MarkdownView.tsx` | Markdown 渲染（GFM+代码高亮） |
| MemoryPanel | `MemoryPanel.tsx` | 记忆/目标管理面板 |
| LogPanel | `LogPanel.tsx` | 日志查看器 |
| AppSettingsWindow | `AppSettingsWindow.tsx` | 应用设置（多标签页） |

### 8.2 状态管理

使用 React Context + `useReducer`：

```typescript
const { state, openApp, closeWindow, focusWindow, ... } = useDesktop();

// 关键状态
state.settings          // 桌面设置（主题、壁纸、Dock 等）
state.installedApps     // 已安装应用列表
state.windows           // 打开的窗口
state.focusedWindowId   // 焦点窗口 ID
state.startMenuOpen     // 开始菜单状态
```

### 8.3 窗口布局规范

所有窗口类组件统一布局：

```css
.xxx-window { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-height: 0; }
.xxx-body   { flex: 1; overflow-y: auto; min-height: 0; }
.xxx-header { /* 固定高度 */ }
.xxx-footer { /* 固定高度 */ }
```

**关键规则**：中间所有 flex container 必须有 `min-height: 0`，防止 flex 子项溢出导致双滚动条。

### 8.4 流式消息渲染

使用 `useAgentEventStream` hook 处理 SSE 流，事件通过 `DesktopContext` 分发给各个窗口：
- `text_chunk` → 追加到当前会话的 `streamingText`
- `tool_call` + `tool_result` → 更新 `toolCalls` 数组
- `message_end` → 追加到 `messages`，停止 stream
- 消息渲染统一使用 `MarkdownView` 组件

### 8.5 应用设置标签页

`AppSettingsWindow` 包含多个标签页，依次为：
1. 基本（basic）— 名称、描述、图标、启用状态
2. 模型（model）— 模型选择 + 参数覆盖
3. 工具（tools）— 内置/外部 MCP 工具勾选
4. 技能（skills）— 已启用的公共技能勾选
5. 权限（visibility）— 可见的 Agent/服务设置
6. 提示（prompt）— app.md 编辑
7. 记忆（memory）— 应用级记忆管理

---

## 9. 主题系统

### 9.1 核心规范

**所有 UI 组件必须通过 CSS 变量引用颜色，禁止硬编码颜色值。** 这是项目最严格的样式规范。

### 9.2 CSS 变量体系

定义于 `client/src/styles/global.css`，通过 `.theme-dark` / `.theme-light` class 在 `<body>` 上切换。

#### 文本色
```css
--text-primary       /* 主文本 (dark:#fff, light:#1f2937) */
--text-secondary     /* 次要文本 */
--text-tertiary      /* 第三级文本 */
```

#### 背景色
```css
--desktop-bg, --window-bg, --window-title-bg, --menu-bar-bg, --dock-bg
--bg-primary, --bg-secondary, --bg-tertiary, --msg-bg, --header-bg
```

#### 表单与状态
```css
--input-bg, --input-border, --input-text, --input-placeholder
--accent-color (#0078d4), --success-*, --error-*, --warning-*
```

### 9.3 ✅ 正确做法 / ❌ 禁止做法

```css
/* ✅ 正确 */
.my-component {
  color: var(--text-primary);
  background: var(--window-bg);
  border: 1px solid var(--border-primary);
}

/* ❌ 禁止 */
.my-component {
  color: #ffffff;               /* 亮色主题下不适用 */
  background: #1e1e2e;          /* 不跟随主题 */
}
```

### 9.4 新组件主题兼容检查清单

- [ ] 文字颜色使用 `var(--text-primary/secondary/tertiary)`
- [ ] 背景使用 `var(--bg-*)` 或 `var(--window-bg)`
- [ ] 边框使用 `var(--border-primary/secondary)`
- [ ] 输入框使用 `var(--input-*)`
- [ ] 状态提示使用 `var(--success-*)` / `var(--error-*)` / `var(--warning-*)`
- [ ] 无 `#xxx`、`rgb()`、`rgba()` 硬编码
- [ ] 弹窗背景使用 `var(--window-bg)`，覆盖层使用 `rgba(0,0,0,0.4)`

---

## 10. API 后端

### 10.1 路由总览

| 基础路径 | 模块 | 说明 |
|----------|------|------|
| `/api/apps` | 应用管理 | CRUD + reload + enable/disable |
| `/api/apps/:appId/conversations` | 会话管理 | CRUD + 消息发送/编辑/删除 + SSE 流 |
| `/api/settings` | 系统设置 | 桌面设置、模型、MCP、技能 |
| `/api/mcp` | MCP 服务 | 连接管理、工具调用 |
| `/api/apps/:appId/memory` | 记忆管理 | 读写记忆、目标管理 |
| `/api/apps/:appId/injections` | 注入状态 | InjectionBar 数据 |
| `/api/logs` | 日志 | 读写 + SSE 实时推送 |
| `/api/workspace` | 工作区 | 目录校验 |
| `/api/apps/:appId/media` | 媒体 | 上传/获取图标、壁纸、图片 |
| `/api/hermes` | Hermes Agent | 模式、技能、聊天 |

### 10.2 SSE 流式协议

发送消息后，前端连接 SSE 获取实时响应：

```
POST /api/apps/{appId}/conversations/{convId}/messages
→ 返回 { userMessage: Message }

前端连接 SSE：
GET /api/apps/{appId}/conversations/{convId}/events
→ 实时接收事件流
```

SSE 事件类型（详见 `client/src/services/api.ts` 的 SSEEvent 联合类型）：
- `message_start`, `thinking`, `text_chunk`, `tool_call`, `tool_result`
- `message_update`, `message_end`, `done`, `error`

### 10.3 日志规范

使用 `serverLogger` 记录日志，分为四个级别和六个分类：

| 级别 | 方法 |
|------|------|
| debug | `serverLogger.debug(category, message, data?)` |
| info | `serverLogger.info(category, message, data?)` |
| warn | `serverLogger.warn(category, message, data?)` |
| error | `serverLogger.error(category, message, data?)` |

**强制记录点**：工具调用、AI 请求/响应

专用便捷方法：
```typescript
serverLogger.ai(source, '>>> 请求', { messages: count });
serverLogger.ai(source, '<<< 响应', { stopReason, toolCalls });
serverLogger.api(method, url, status, duration?);
```

日志数据限制 2000 字符，data 区域 max-height 120px 防止撑爆面板。

---

## 11. 外部 MCP 工具命名规范

### 11.1 Key 格式

```typescript
// 配置存储（前后端统一）
const appToolKey = `external:${safeConnName}:${tool.name}`;
// 例: external:Browser:browser_navigate

// AI Agent 工具名
const agentToolName = `mcp_${safeConnName}_${safeToolName}`;
// 例: mcp_Browser_browser_navigate
```

`safeConnName` = `connName.replace(/[^a-zA-Z0-9_-]/g, '_')`
`connName` = `client.serverInfo?.name || connectionId`

### 11.2 禁止行为

**禁止在工具 key 中使用 UUID 作为连接标识符。** 使用连接名替换。

### 11.3 前端渲染

```typescript
// AppSettingsWindow.tsx — 外部 MCP 工具 checkbox key
const safeConnName = connName.replace(/[^a-zA-Z0-9_-]/g, '_');
const toolKey = `external:${safeConnName}:${tool.name}`;
```

---

## 12. 构建与部署

### 12.1 构建步骤

```bash
# 前端构建
cd client && npm run build      # tsc -b && vite build → client/dist/

# 后端构建
cd server && npm run build      # esbuild 打包 → server/dist/

# 独立可执行文件（Node.js SEA）
cd server && npm run sea        # esbuild → 单 .mjs → 注入 Node 可执行文件
```

### 12.2 启动参数

```
--port       端口（默认 3001）
--host       主机（默认 0.0.0.0）
--static     静态文件目录（默认 client/dist）
--data       数据目录（默认 server/desktop_data）
--auto-open  启动后自动打开浏览器
--no-open    不自动打开浏览器
```

### 12.3 环境配置

数据目录下的 `env.json` 可配置：
- `OPENAI_API_KEY` — OpenAI 兼容 API Key
- `OPENAI_BASE_URL` — OpenAI 兼容 Base URL

---

## 13. Git 提交规范

- **按功能拆分提交**，多个不相干功能不要混在一个 commit 中
- commit message 简明扼要，说明改了什么
- **绝不自动提交**，所有改动必须先让用户验证，确认没问题后才由用户决定是否提交
- 提交要按功能拆分，多个不相干的功能分成多次提交，不要混在一起

---

## 14. 常见问题与排错

### 14.1 记忆不生效

1. 检查应用设置 → 工具标签页中是否已勾选 `mcp.memory`
2. 检查应用设置 → 记忆标签页中是否有数据
3. 检查日志中是否有 `[memory]` 标签的条目
4. 重新发送消息触发 system prompt 重建

### 14.2 开始菜单上次对话不还原

- 关闭菜单时组件被 unmount，重新打开通过 `loadConversations()` 重新加载
- `sessionStorage.getItem('startmenu_last_conv')` 记录上次会话 ID
- 检查后端 `/api/apps/{appId}/conversations` 接口是否正常

### 14.3 窗口内容双滚动条

检查 CSS 链路，确保中间所有 flex container 有 `min-height: 0`：
```css
.window-content { flex: 1; overflow: hidden; min-height: 0; }
.xxx-window { flex: 1; min-height: 0; }
.xxx-body { flex: 1; overflow-y: auto; min-height: 0; }
```

### 14.4 工具名称带 UUID

- 旧格式 `external:UUID:toolName` 在新代码下自动失效
- 需在应用设置 → 工具标签页重新勾选对应 MCP 工具并保存
- 新格式：`external:连接名:工具名`

### 14.5 Agent 调用超时

- `mcp.agent.call` 默认 2 分钟超时
- 被调 Agent 如果会话太多历史消息，可能在 syncHistory 阶段耗时过长
- 检查日志中 `agent_call_start` 和 `agent_call_end_auto` 的时间差
- 如确认超时，尝试清空被调 Agent 的旧会话

### 14.6 工具搜索卡死

- `mcp.filesystem.search` 必须指定 `baseDir`，否则搜索整个 `desktop_data` 会导致卡死
- 使用工作区搜索工具时同样需要指定目录

### 14.7 LLM 调用失败

1. 检查 `modes.json` 中 provider 的 API Key 是否配置正确
2. 检查网络连通性
3. 检查日志中 AI 请求/响应记录
4. 尝试在应用设置中切换模型
