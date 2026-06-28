# AIDesktop 开发维护指南

> 基于项目当前代码结构（2025年）编写的开发与维护参考手册。
> 配套文档：`docs/SPEC.md` — 产品设计规格书

---

## 目录

1. [项目概览](#1-项目概览)
2. [项目结构](#2-项目结构)
3. [启动与开发](#3-启动与开发)
4. [关键技术决策](#4-关键技术决策)
5. [主题系统与配色规范](#5-主题系统与配色规范)
6. [前端开发规范](#6-前端开发规范)
7. [后端开发规范](#7-后端开发规范)
8. [Agent 系统](#8-agent-系统)
9. [记忆系统](#9-记忆系统)
10. [MCP 工具系统](#10-mcp-工具系统)
11. [外部 MCP 工具命名规范](#11-外部-mcp-工具命名规范)
12. [构建与部署](#12-构建与部署)
13. [常见问题](#13-常见问题)

---

## 1. 项目概览

AIDesktop 是一个桌面化的智能助手平台，前端呈现仿 macOS 风格的桌面操作系统界面，后端是支持多 Agent 协作、MCP 协议、多模型供应商的 AI 服务平台。

### 1.1 核心流程

```
用户输入 → WebSocket SSE → Agent Session → LLM API
                                                ↓
                                       工具调用 → MCP Service
                                                ↓
                                       MCP Client(外部)/内置服务
                                                ↓
                                          返回结果
                                                ↓
                                 流式返回 → SSE → 前端渲染
```

### 1.2 关键依赖

| 层 | 技术 | 说明 |
|----|------|------|
| 前端框架 | React 19 + TypeScript | Vite 构建 |
| UI 库 | Ant Design 6 | 仅少量使用 (Typography, Modal) |
| 样式方案 | 纯 CSS (`global.css`) | CSS 变量驱动的多主题系统 |
| 后端框架 | Express 4 + TypeScript | esbuild 编译 |
| 通信 | HTTP REST + SSE | 消息流通过 WebSocket SSE |
| Agent 引擎 | Pi (内部引擎) | streamFn 模式，支持工具调用 |
| 模型适配 | OpenAI 兼容 / 自定义 | 支持动态 header/body 参数 |

---

## 2. 项目结构

```
AIDesktop/
├── client/                        # 前端 (React SPA)
│   └── src/
│       ├── components/            # React 组件
│       │   ├── Desktop.tsx        # 桌面（壁纸 + 图标）
│       │   ├── Dock.tsx           # Dock 栏
│       │   ├── MenuBar.tsx        # 菜单栏
│       │   ├── Window.tsx         # 窗口管理（含聊天面板）
│       │   ├── StartMenu.tsx      # 开始菜单
│       │   ├── InjectionBar.tsx   # 注入状态标记栏
│       │   ├── MarkdownView.tsx   # Markdown 渲染
│       │   ├── MemoryPanel.tsx    # 记忆管理面板
│       │   ├── LogPanel.tsx       # 日志面板
│       │   ├── AppSettingsWindow.tsx  # 应用设置
│       │   ├── SettingsMainWindow.tsx # 设置主页（应用列表）
│       │   ├── AppManagerWindow.tsx   # 应用管理
│       │   ├── AppDetailWindow.tsx    # 应用详情
│       │   ├── AppModelConfig.tsx     # 模型配置
│       │   ├── MediaSelector.tsx      # 媒体选择器
│       │   ├── FormComponent.tsx      # 表单组件
│       │   └── WorkspaceDirSelector.tsx # 工作目录选择
│       ├── contexts/
│       │   ├── DesktopContext.tsx # 桌面状态管理 (useReducer)
│       │   └── ToastContext.tsx   # Toast 通知
│       ├── services/
│       │   ├── api.ts            # API 调用封装
│       │   ├── logger.ts         # 前端日志
│       │   └── useAgentEventStream.ts # WebSocket SSE Hook
│       ├── types/index.ts        # 类型定义
│       ├── styles/global.css     # 全局样式 + 主题变量
│       ├── App.tsx / App.css
│       └── main.tsx
│
├── server/                        # 后端
│   └── src/
│       ├── routes/               # HTTP 路由
│       │   ├── apps.ts           # 应用 CRUD
│       │   ├── conversations.ts  # 会话 CRUD
│       │   ├── settings.ts       # 设置管理
│       │   ├── mcp.ts            # MCP 连接/工具管理
│       │   ├── logs.ts           # 日志 SSE
│       │   ├── media.ts          # 媒体上传
│       │   ├── hermes.ts         # Hermes Agent 接口
│       │   ├── workspace.ts      # 工作区
│       │   ├── injections.ts     # 注入状态摘要
│       │   └── memory.ts         # 记忆管理 API
│       ├── agents/
│       │   ├── pi-agent-session.ts # Agent 会话管理
│       │   ├── pi-tools.ts       # 工具构建
│       │   └── engine.ts         # (旧) 引擎
│       ├── mcp/
│       │   ├── service.ts        # 内置 MCP 服务注册
│       │   ├── clientRegistry.ts # 外部 MCP 客户端管理
│       │   ├── externalClient.ts # 外部 MCP 客户端
│       │   ├── jsonRpcClient.ts  # JSON-RPC 客户端实现
│       │   ├── processManager.ts # 子进程管理
│       │   ├── stdioTransport.ts # stdio 传输
│       │   ├── sseTransport.ts   # SSE 传输
│       │   └── browser/          # 浏览器工具
│       ├── models/               # 模型适配器
│       │   ├── openai.ts         # OpenAI 兼容
│       │   ├── pi-adapter.ts     # Pi 适配
│       │   └── hermes.ts         # Hermes 适配
│       ├── services/
│       │   ├── appState.ts       # 应用状态管理
│       │   ├── appLoader.ts      # 应用加载
│       │   ├── conversation.ts   # 会话服务
│       │   ├── memory.ts         # 记忆与目标管理
│       │   ├── settings.ts       # 设置服务
│       │   ├── skillService.ts   # 技能服务
│       │   ├── eventBus.ts       # 事件总线
│       │   └── wsServer.ts       # WebSocket SSE 服务
│       ├── types/index.ts
│       ├── utils/
│       │   ├── logger.ts         # 后端日志系统
│       │   └── file.ts           # 文件工具
│       └── index.ts              # 入口
│
├── docs/SPEC.md                   # 产品设计规格书
└── docs/DEV_GUIDE.md              # 本文件
```

---

## 3. 启动与开发

### 3.1 环境要求

- Node.js 18+
- 推荐使用 pnpm、yarn 或 npm

### 3.2 启动命令

```bash
# 1. 安装依赖
cd client && npm install
cd ../server && npm install

# 2. 启动后端 (端口 3001)
cd server && npm run dev

# 3. 启动前端 (端口 5173)
cd client && npm run dev
```

前端 Vite 配置了代理：`/api` → `localhost:3001`

### 3.3 构建

```bash
# 后端构建（esbuild 打包成单文件）
cd server && npm run build

# 前端构建
cd client && npm run build

# 构建独立可执行文件
cd server && npm run sea
```

### 3.4 调试技巧

- **日志面板**：打开"日志"应用查看实时日志（支持级别/分类过滤、搜索）
- **Injections**：窗口标题栏下方显示应用状态（工具、Agent、记忆统计等），可直接点击展开
- **SSE 消息流**：通过 WebSocket 事件驱动，`useAgentEventStream` Hook 处理

---

## 4. 关键技术决策

### 4.1 为什么用纯 CSS 而非 CSS-in-JS？

项目采用纯 CSS + CSS 变量实现多主题方案。原因是：
- Ant Design Token 系统与 macOS 风格不兼容
- CSS 变量方案性能最优，主题切换无闪烁
- 所有颜色通过 50+ CSS 变量控制，双主题（dark/light）切换只需切换一个 class

### 4.2 为什么 Agent 不用 LangChain？

项目使用自研 Pi Agent 引擎，核心是 `streamFn` 模式：
- `streamFn(model, context, options)` — 接收 model 配置、上下文消息、流式选项
- 返回流式结果，支持 `tool_execution_start` / `tool_execution_end` 事件
- 每次请求从最新 app 配置读取 bodyParams/headerParams，支持运行时修改

### 4.3 MCP vs 外部 MCP

- **内置 MCP 服务** (`mcp.*`)：由 `mcpServiceRegistry` 管理，在 `service.ts` 中注册
- **外部 MCP 服务** (`external:*`)：由 `mcpClientRegistry` 管理，通过 stdio/SSE 连接
- 外部工具名称格式：`mcp_${连接名}_${工具名}`（如 `mcp_Browser_browser_navigate`）
- 配置 key 格式：`external:${连接名安全名}:${工具名}`（如 `external:Browser:browser_navigate`）

### 4.4 配置合并策略

app 的 meta（应用定义）和 config（用户设置）在运行时合并，config 优先覆盖 meta：
```typescript
// 参考 pi-tools.ts buildPiToolsForApp
const allowedTools = new Set([...(app.config.tools || []), ...(app.meta.tools || [])]);
```

---

## 5. 主题系统与配色规范

### 5.1 核心规范

**所有 UI 组件必须通过 CSS 变量引用颜色，禁止硬编码颜色值。**

### 5.2 CSS 变量体系

项目在 `client/src/styles/global.css` 中定义了双主题（dark/light），通过 `.theme-dark` / `.theme-light` class 切换。

#### 可用 CSS 变量

```css
/* 文本 */
--text-primary       /* 主文本色 (dark: #fff, light: #1f2937) */
--text-secondary     /* 次要文本 (dark: #b0b0b0, light: #6b7280) */
--text-tertiary      /* 第三级文本 (dark: #7e7e8a, light: #9ca3af) */

/* 背景 */
--desktop-bg         /* 桌面壁纸底色 */
--window-bg          /* 窗口背景 */
--window-title-bg    /* 窗口标题栏背景 */
--menu-bar-bg        /* 菜单栏背景 */
--dock-bg            /* Dock 栏背景 */
--bg-primary         /* 通用背景 (rgba) */
--bg-secondary       /* 次级背景 (rgba) */
--bg-tertiary        /* 第三级背景 (rgba) */
--msg-bg             /* 消息气泡背景 */
--header-bg          /* 头部背景 */

/* 表单 */
--input-bg           /* 输入框背景 */
--input-border       /* 输入框边框 */
--input-text         /* 输入框文字 */
--input-placeholder  /* 输入框占位符 */
--select-bg          /* 选择器背景 */
--select-text        /* 选择器文字 */

/* 边框 */
--border-primary     /* 主边框色 */
--border-secondary   /* 次级边框色 */

/* 状态色 */
--accent-color       /* 强调色 (始终 #0078d4) */
--success-color      /* 成功 */
--success-bg         /* 成功背景 */
--success-text       /* 成功文字 */
--error-color        /* 错误 */
--error-bg           /* 错误背景 */
--error-text         /* 错误文字 */
--warning-color      /* 警告 */
--warning-bg         /* 警告背景 */
--warning-text       /* 警告文字 */

/* 布局常量 */
--dock-height: 64px
--menu-bar-height: 28px
--border-radius: 10px
```

### 5.3 开发规范

#### ✅ 正确做法

```css
/* 使用 CSS 变量 */
.my-component {
  color: var(--text-primary);
  background: var(--window-bg);
  border: 1px solid var(--border-primary);
}

/* 子元素颜色继承，只在必要时覆盖 */
.my-component-title {
  color: var(--text-primary);   /* 必须显式设置 */
  font-weight: 600;
}
.my-component-desc {
  color: var(--text-secondary); /* 次级文字用 secondary */
}
```

#### ❌ 禁止做法

```css
/* 禁止硬编码颜色值 */
.my-component {
  color: #ffffff;               /* 错误！亮色主题下应该用深色 */
  background: #1e1e2e;          /* 错误！亮色主题下应该用浅色 */
  border-color: rgba(255,255,255,0.1); /* 错误！亮色主题下边框应该是深色半透明 */
}
```

#### 组件内联样式规范

```typescript
// ✅ 正确：通过 CSS 变量引用
<div style={{ color: 'var(--text-primary)', background: 'var(--bg-secondary)' }}>

// ❌ 错误：硬编码颜色
<div style={{ color: '#ffffff', background: 'rgba(255,255,255,0.05)' }}>
```

### 5.4 主题切换机制

主题通过 `DesktopContext` 中的 `settings.theme` 控制，顶层 DOM 切换 class：

```typescript
// Desktop.tsx
<div className={`theme-${state.settings.theme}`}>
  {/* 所有子组件自动适配主题 */}
</div>
```

**开发新组件时，无需关心当前主题是 dark 还是 light，只需使用 CSS 变量即可自动适配。**

### 5.5 新组件主题兼容检查清单

开发新 UI 组件时逐项检查：

- [ ] 文字颜色使用 `var(--text-primary/secondary/tertiary)`
- [ ] 背景使用 `var(--bg-*)` 或 `var(--window-bg)`
- [ ] 边框使用 `var(--border-primary/secondary)`
- [ ] 输入框使用 `var(--input-*)`
- [ ] 状态提示使用 `var(--success-*)` / `var(--error-*)` / `var(--warning-*)`
- [ ] 无 `#xxx`、`rgb()`、`rgba()` 硬编码（特殊动画/装饰除外）
- [ ] 弹窗/浮层的背景使用 `var(--window-bg)`，覆盖层使用 `rgba(0,0,0,0.4)`

---

## 6. 前端开发规范

### 6.1 组件架构

所有窗口类组件遵循统一的布局模式：

```typescript
<div className="xxx-window">          // height: 100%, flex column
  <div className="xxx-header">        // 标题栏，固定高度
  <div className="xxx-tabs">          // 标签页（可选）
  <div className="xxx-body">          // flex: 1, overflow-y: auto
  <div className="xxx-footer">        // 底部按钮（可选）
```

**关键：中间内容区域始终用 `flex: 1; overflow-y: auto; min-height: 0` 确保滚动条只在内容区出现。**

### 6.2 窗口高度自适应

```css
/* ✅ 正确：内容高度自适应 */
.xxx-window { height: 100%; display: flex; flex-direction: column; overflow: hidden; min-height: 0; }
.xxx-body   { flex: 1; overflow-y: auto; min-height: 0; }

/* ❌ 错误：固定或 max-height */
.xxx-list   { max-height: 200px; }  /* 页面缩放时内容溢出或留白 */
```

### 6.3 InjectionBar 规范

注入状态标记栏 (`InjectionBar`) 位于标题栏和消息列表之间。每个 block 的展开详情使用 `MarkdownView` 渲染，支持 Markdown 格式。

```typescript
// 后端返回的 block 结构
interface InjectionBlock {
  source: string;  // 'app' | 'memory' | 'goal'
  label: string;   // 标签名
  title: string;   // 标题
  detail: string;  // Markdown 格式的详情
}
```

注意：
- **detail 内容使用 Markdown 格式**（`**粗体**: 值`、`- 列表`）
- **无硬编码颜色**，通过 CSS class 的 `--inj-color` 变量控制
- **重新获取**：通过组件 `key` 的变更触发重新挂载和请求

### 6.4 流式消息渲染

- 使用 `MarkdownView` 组件渲染所有消息内容
- 支持 GFM（表格、任务列表）、代码高亮、链接新窗口打开
- 流式消息同样通过 `MarkdownView` 渲染

### 6.5 Window 组件关键状态

```typescript
// 会话标题栏右侧按钮（按顺序）：
// ☰ 会话列表 | 会话标题 | 创建时间 | 工作目录 | + 新建 | ⚙️ 会话设置
```

---

## 7. 后端开发规范

### 7.1 路由结构

```typescript
// 路由注册 (server/src/index.ts)
app.use('/api/apps', appsRouter);
app.use('/api/apps/:appId/conversations', conversationsRouter);
app.use('/api/apps/:appId/injections', injectionsRouter);
app.use('/api/apps/:appId/memory', memoryRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/mcp', mcpRouter);
app.use('/api/hermes', hermesRouter);
app.use('/api/logs', logsRouter);
app.use('/api/workspace', workspaceRouter);
```

### 7.2 日志规范

使用 `serverLogger`（`server/src/utils/logger.ts`）记录日志：

```typescript
import { serverLogger } from '../utils/logger.js';

// 级别与分类
serverLogger.debug('category', 'message', data?);   // 调试
serverLogger.info('category', 'message', data?);     // 信息
serverLogger.warn('category', 'message', data?);     // 警告
serverLogger.error('category', 'message', data?);    // 错误
serverLogger.ai(source, '>>> 请求预览', data?);      // AI 请求
serverLogger.ai(source, '<<< 响应', data?);          // AI 响应
serverLogger.api(method, url, status, duration?);    // API 调用

// 分类标签
'api' | 'ai' | 'system' | 'mcp' | 'agent' | 'app' | 'other'
```

**工具调用必须记录日志：**
```typescript
// 在 tool_execution_start 时
serverLogger.info('agent', `工具调用: ${toolName}`, { toolCallId, toolName, args });

// 在 tool_execution_end 时
serverLogger.info('agent', `工具返回: ${toolName}`, { toolCallId, toolName, isError });
```

### 7.3 事件驱动

Agent 会话通过事件总线 (`eventBus`) 驱动：
- `text_chunk` — 流式文本块
- `tool_call` — 工具调用开始
- `tool_result` — 工具调用返回
- `message_end` — 完整消息结束

---

## 8. Agent 系统

### 8.1 架构

Agent 系统位于 `server/src/agents/`，核心文件：

| 文件 | 职责 |
|------|------|
| `pi-agent-session.ts` | 会话生命周期管理、流式处理、工具调度、记忆注入 |
| `pi-tools.ts` | 工具构建（内置 MCP + 外部 MCP + 技能工具） |

### 8.2 Agent 会话流程

```
用户发送消息
  → runAgentAsync(appId, convId, userContent)
    → getOrCreateSession() — 获取或新建 PiAgentSession
    → syncHistory() — 同步历史消息
    → injectWorkspaceTools() — 注入工作区工具
    → buildSystemPrompt() — 构建 system prompt（含记忆注入）
    → session.prompt() — 调用 LLM
      → streamFn() 流式返回
        → text_chunk → emit → SSE → 前端
        → tool_execution_start → emit tool_call → SSE
        → tool_execution_end → emit tool_result → SSE
        → message_end → emit → SSE
```

### 8.3 System Prompt 构建

```typescript
buildSystemPrompt(app) → string
// 1. appMd 内容
// 2. 可调用 Agent 列表
// 3. 已加载技能列表
// 4. 长期记忆注入（应用级 + 会话级 + 目标）
// 5. 记忆工具使用提示（如 mcp.memory 已启用）
```

### 8.4 工具构建

```typescript
buildPiToolsForApp(app) → AgentTool[]
// 1. 遍历 mcpServiceRegistry 中的服务
// 2. 只注入 allowedTools 中存在的服务
// 3. 调用 buildExternalMcpAgentTools() 构建外部 MCP 工具
// 4. 如有技能授权，注入 mcp.skill 的三个工具
```

---

## 9. 记忆系统

### 9.1 架构

记忆系统 (`server/src/services/memory.ts`) 分两级：

| 级别 | 存储位置 | 管理入口 |
|------|----------|----------|
| 应用级 | `desktop_data/apps_data/{appId}/memories.json` | 应用设置 → 记忆标签页 |
| 会话级 | `desktop_data/apps_data/{appId}/conversations/{convId}/memories.json` | 会话标题栏 ⚙️ 按钮 |
| 目标 | 与会话级同文件 | 会话设置面板 |

### 9.2 记忆工具

AI 通过 `mcp.memory` 服务操作记忆，需在应用设置的"工具"标签页中勾选 `mcp.memory`。

可用方法：
- `remember` — 保存记忆（scope: app/conversation, key, value, importance）
- `recall` — 查询记忆
- `recallByPrefix` — 按前缀查询
- `forget` — 删除记忆（按 ID 或 tag）
- `setGoal` / `completeGoal` / `getActiveGoals` / `getArchivedGoals`
- `list` / `listTags` / `stats`

### 9.3 记忆注入

每次 `buildSystemPrompt` 时自动注入记忆块：
```
## 长期记忆
### User
- user.name: 小明

## 会话上下文
- preference: 喜欢简洁回答

## 当前目标
【一级目标】完成项目
  【二级目标】开发记忆系统
    【三级目标】实现 UI ← 当前待办
```

---

## 10. MCP 工具系统

### 10.1 内置 MCP 服务

注册于 `server/src/mcp/service.ts`：

| 服务名 | 方法 | 分类 |
|--------|------|------|
| `mcp.window` | open, close, list, focus, minimize, maximize | admin |
| `mcp.filesystem` | read, write, patch, search, list, mkdir, delete | admin |
| `mcp.settings` | get, update, generateSkill, addSkillToApp, getApps, getConversations, getConversation | admin |
| `mcp.agent` | list, call, getInfo | builtin |
| `mcp.sleep` | sleep | builtin |
| `mcp.exec` | exec | builtin |
| `mcp.http` | request | builtin |
| `mcp.browser` | navigate, snapshot, click, type, scroll, back, vision, console, press | builtin |
| `mcp.form` | requestInput | builtin |
| `mcp.memory` | remember, recall, recallByPrefix, forget, setGoal, completeGoal, getActiveGoals, getArchivedGoals, list, listTags, stats | builtin |
| `mcp.skill` | list, read, readEntry, listFiles, listScripts, exec | admin |
| `workspace.code` | read, write, patch, search, list | workspace |

### 10.2 工具名称转换

```typescript
// 内置服务: mcp_服务名_方法名
// 例: mcp.filesystem.read → mcp_filesystem_read

// 外部 MCP: mcp_连接名_工具名
// 例: external Browser.browser_navigate → mcp_Browser_browser_navigate
```

### 10.3 工具可见性

```typescript
// pi-tools.ts — 工具过滤逻辑
const allowedTools = new Set([...(app.config.tools || []), ...(app.meta.tools || [])]);

// 只注入 allowedTools 中存在的服务
// 外部 MCP 需要显式勾选，不匹配的 key 自动跳过
// 连接断开的 MCP 客户端不会出现在 clientRegistry.listClients() 中
```

---

## 11. 外部 MCP 工具命名规范

### 11.1 Key 格式

```typescript
// 配置存储格式（前端勾选时的 key）
const appToolKey = `external:${safeConnName}:${tool.name}`;
// 例: external:Browser:browser_navigate

// AI Agent 看到的工具名
const agentToolName = `mcp_${safeConnName}_${safeToolName}`;
// 例: mcp_Browser_browser_navigate
```

其中 `safeConnName` 由 `connName.replace(/[^a-zA-Z0-9_-]/g, '_')` 生成，
`connName` 为 `client.getServerInfo()?.name || connectionId`。

### 11.2 重要规则

**禁止在工具 key 中使用 UUID 作为连接标识符。** 连接名已经能唯一标识 MCP 服务，使用 UUID 会导致：
- 配置迁移困难（UUID 变化后旧配置失效）
- 前端显示不友好（`external:8010e301...:xxx` 不可读）
- 排查问题困难（无法知道是哪个连接的工具）

### 11.3 前端渲染规范

前端 `AppSettingsWindow.tsx` 渲染外部 MCP 工具的 checkbox 列表时，key 格式必须与后端一致：

```typescript
const safeConnName = connName.replace(/[^a-zA-Z0-9_-]/g, '_');
const toolKey = `external:${safeConnName}:${tool.name}`;
```

---

## 12. 构建与部署

### 12.1 独立可执行文件

```bash
# 完整构建流程
cd server && npm run build     # esbuild 打包 TypeScript
cd server && npm run sea      # Node.js SEA 生成单文件可执行文件

# SEA 流程：
# 1. esbuild 打包 server 和 client 的 dist 到一个 .mjs
# 2. node --experimental-sea-config 生成 blob
# 3. 注入到 Node.js 可执行文件
```

### 12.2 启动参数

```
--port       端口 (默认 3001)
--host       主机 (默认 0.0.0.0)
--static     静态文件目录 (默认 client/dist)
--data       数据目录 (默认 server/desktop_data)
--auto-open  启动后自动打开浏览器
--no-open    不自动打开浏览器
```

### 12.3 环境文件

数据目录下的 `env.json` 可配置：
- `OPENAI_API_KEY` — OpenAI 兼容 API Key
- `OPENAI_BASE_URL` — OpenAI 兼容 Base URL

---

## 13. 常见问题

### 13.1 记忆不生效

1. 检查应用设置 → 工具标签页中是否已勾选 `mcp.memory`
2. 检查应用设置 → 记忆标签页中是否有数据
3. 检查日志中是否有 `[memory]` 标签的条目
4. 重新发送消息触发 system prompt 重建

### 13.2 开始菜单上次对话不还原

- 开始菜单关闭时组件被 unmount，重新打开通过 `loadConversations()` 重新加载
- `sessionStorage.getItem('startmenu_last_conv')` 记录上次会话 ID
- 如持续异常，检查后端 `/api/apps/{appId}/conversations` 接口是否正常

### 13.3 窗口内容双滚动条

检查 CSS 链路，确保中间所有 flex container 都有 `min-height: 0`：
```css
.window-content { flex: 1; overflow: hidden; min-height: 0; }
.xxx-window { height: 100%; display: flex; flex-direction: column; overflow: hidden; min-height: 0; }
.xxx-body { flex: 1; overflow-y: auto; min-height: 0; }
```

### 13.4 工具名称带 UUID

如果配置中仍然存在 `external:UUID:toolName` 格式的 key：
1. 代码升级后，旧的 UUID 格式 key 自动失效（不会匹配新格式）
2. 需在应用设置 → 工具标签页中重新勾选对应 MCP 工具并保存
3. 新保存的 key 格式为 `external:连接名:工具名`

### 13.5 日志看不到工具调用

检查 `pi-agent-session.ts` 中 `tool_execution_start` 和 `tool_execution_end` 事件处理是否有 `serverLogger.info(...)` 调用。这是必需的标准日志记录点。
