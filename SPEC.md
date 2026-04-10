# AI Desktop 桌面智能助手 - 产品设计规格书

## 1. 项目概述

### 1.1 项目愿景

打造一个**桌面化的智能助手平台**，用户看到的是一个仿macOS风格的桌面操作系统，但实际上是一个强大的多Agent协作系统。每个桌面"应用"都是一个AI Agent，可以独立运行，也可以互相调用、协同工作。

**核心理念**：
- **所见即所得**：像使用桌面操作系统一样使用AI
- **Agent即服务**：每个应用都是可编程的AI服务
- **本地优先**：数据存储在本地，支持离线使用

### 1.2 核心特性

| 特性 | 描述 |
|------|------|
| 桌面模拟界面 | 仿macOS风格，包含Dock栏、菜单栏、窗口管理 |
| 多Agent系统 | 支持多个独立Agent，每个有独立会话 |
| MCP协议支持 | 标准化接入外部工具和服务 |
| 模型无关架构 | 支持OpenAI、Anthropic等多模型提供商 |
| 本地数据存储 | 所有数据存储在本地desktop_data目录 |
| 前后端分离 | React SPA前端 + TypeScript HTTP/SSE后端 |

---

## 2. 技术架构

### 2.1 系统架构图

```
┌─────────────────────────────────────────────────────────────┐
│                      Client (Browser)                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                   React + Ant Design                  │   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐             │   │
│  │  │  Dock   │  │ Window  │  │ Start   │             │   │
│  │  │  Bar    │  │ Manager │  │ Menu    │             │   │
│  │  └─────────┘  └─────────┘  └─────────┘             │   │
│  └─────────────────────────────────────────────────────┘   │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTP / SSE
┌────────────────────────┴────────────────────────────────────┐
│                      Backend Server                           │
│  ┌─────────────────────────────────────────────────────┐     │
│  │              TypeScript HTTP Server                  │     │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐          │     │
│  │  │  Router  │  │  Agent   │  │   MCP    │          │     │
│  │  │          │  │  Engine  │  │  Loader  │          │     │
│  │  └──────────┘  └──────────┘  └──────────┘          │     │
│  └─────────────────────────────────────────────────────┘     │
│  ┌─────────────────────────────────────────────────────┐     │
│  │                  Model Adapter                       │     │
│  │   OpenAI Adapter  │  Anthropic Adapter  │  Others   │     │
│  └─────────────────────────────────────────────────────┘     │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────┴────────────────────────────────────┐
│                    Local File System                          │
│  ┌─────────────────────────────────────────────────────┐     │
│  │                  desktop_data/                        │     │
│  │   apps/  │  public_data/  │  configs/               │     │
│  └─────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 技术栈

#### 前端
- **框架**：React 18 + TypeScript
- **UI库**：Ant Design 5.x
- **状态管理**：React Context + useReducer
- **构建工具**：Vite
- **样式**：CSS Modules + Ant Design Tokens

#### 后端
- **运行时**：Node.js 18+
- **框架**：Express.js / Fastify
- **语言**：TypeScript
- **通信协议**：HTTP REST + Server-Sent Events (SSE)

### 2.3 项目目录结构

```
AIDesktop/
├── client/                    # 前端项目
│   ├── public/
│   │   └── icons/            # 应用图标
│   ├── src/
│   │   ├── components/       # React组件
│   │   │   ├── Desktop/      # 桌面组件
│   │   │   ├── Dock/         # Dock栏组件
│   │   │   ├── Taskbar/      # 任务栏组件
│   │   │   ├── StartMenu/    # 开始菜单组件
│   │   │   ├── Window/       # 窗口管理组件
│   │   │   └── App/          # 应用窗口内容
│   │   ├── contexts/         # React Context
│   │   ├── hooks/            # 自定义Hooks
│   │   ├── services/         # API服务调用
│   │   ├── types/            # TypeScript类型定义
│   │   ├── styles/           # 全局样式
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
│
├── server/                    # 后端项目
│   ├── src/
│   │   ├── routes/           # 路由
│   │   ├── agents/           # Agent核心
│   │   ├── mcp/              # MCP服务
│   │   ├── models/           # 模型适配器
│   │   ├── services/         # 业务服务
│   │   ├── types/            # 类型定义
│   │   ├── utils/            # 工具函数
│   │   └── index.ts          # 入口文件
│   ├── desktop_data/         # 数据目录
│   ├── package.json
│   └── tsconfig.json
│
└── desktop.md                 # 原始设计文档
```

---

## 3. 数据架构

### 3.1 数据目录结构

```
desktop_data/
├── apps/                              # 应用(Agent)目录
│   ├── system/                        # 系统内置应用
│   │   ├── desktop-assistant/         # 桌面助手
│   │   │   ├── meta.json              # 应用元数据
│   │   │   ├── mcp.json              # MCP服务列表
│   │   │   ├── skills/                # 技能目录
│   │   │   │   ├── include.json      # 引用的公共技能
│   │   │   │   ├── allow.json        # 授权配置
│   │   │   │   ├── skill1/
│   │   │   │   │   ├── prompt.md     # 技能定义
│   │   │   │   │   └── config.json   # 技能配置
│   │   │   │   └── skill2/
│   │   │   ├── data/                  # 应用数据
│   │   │   │   └── conversations/    # 会话历史
│   │   │   │       ├── conv1.json
│   │   │   │       └── conv2.json
│   │   │   └── app.md                # Agent定义文件
│   │   ├── file-manager/             # 文件管理器
│   │   ├── settings/                 # 系统设置
│   │   ├── app-builder/              # 创建应用的应用
│   │   └── trash/                    # 回收站
│   │
│   ├── user/                          # 用户创建的应用
│   │   └── user-app-1/
│   │       └── ...
│   │
│   └── marketplace/                   # 应用商店应用（预留）
│       └── ...
│
├── public_data/                       # 公共数据
│   ├── skills/                        # 公共技能库
│   │   ├── web-search/
│   │   └── code-interpreter/
│   └── shared/                        # 共享资源
│
└── configs/                           # 配置文件
    ├── setting.json                   # 桌面设置
    ├── mcp.json                       # 全局MCP配置
    └── modes.json                     # 模型配置
```

**应用来源分类**：
- `system/`：系统内置应用，出厂自带，不可删除
- `user/`：用户自己创建的应用，可编辑和删除
- `marketplace/`：从应用商店安装的应用（预留）

### 3.2 数据模型

#### 3.2.1 应用元数据 (meta.json)

```json
{
  "id": "desktop-assistant",
  "name": "桌面助手",
  "description": "内置桌面助手，提供基础对话和系统操作功能",
  "source": "system",                  // "system" | "user" | "marketplace"
  "type": "desktop",                  // "desktop" | "background"
  "icon": "/icons/desktop-assistant.png",
  "backgroundImage": null,
  "models": [
    {
      "provider": "openai",
      "model": "gpt-4o",
      "priority": 1,
      "maxTokens": 128000,
      "supports": ["text", "image"],
      "params": {
        "temperature": 0.7,
        "top_p": 0.9
      }
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

#### 3.2.2 会话数据 (conversation)

```json
{
  "id": "conv-uuid",
  "appId": "desktop-assistant",
  "title": "会话标题",
  "createdAt": "2024-01-01T10:00:00Z",
  "updatedAt": "2024-01-01T10:30:00Z",
  "messages": [
    {
      "id": "msg-uuid",
      "role": "user",                  // "user" | "assistant" | "system"
      "content": [
        {
          "type": "text",
          "text": "用户输入内容"
        }
      ],
      "timestamp": "2024-01-01T10:00:00Z"
    },
    {
      "id": "msg-uuid-2",
      "role": "assistant",
      "content": [
        {
          "type": "text",
          "text": "助手回复内容"
        }
      ],
      "timestamp": "2024-01-01T10:00:05Z",
      "toolCalls": [
        {
          "id": "call-1",
          "tool": "mcp.filesystem",
          "method": "readFile",
          "args": { "path": "/test.txt" }
        }
      ]
    }
  ]
}
```

#### 3.2.3 桌面设置 (configs/setting.json)

```json
{
  "theme": "light",                    // "light" | "dark" | "auto"
  "wallpaper": "/wallpapers/default.jpg",
  "dock": {
    "position": "bottom",              // "bottom" | "left" | "right"
    "magnification": true,
    "autoHide": false
  },
  "window": {
    "defaultSize": { "width": 800, "height": 600 },
    "minSize": { "width": 400, "height": 300 },
    "maximized": false
  },
  "menuBar": {
    "autoHide": false
  },
  "startMenu": {
    "width": 600,
    "height": 500
  }
}
```

---

## 4. 前端详细设计

### 4.1 布局结构

```
┌──────────────────────────────────────────────────────────────┐
│                        Menu Bar (24px)                       │
│  Apple Logo │ 应用名  │        时间、电池、网络、通知         │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│                                                              │
│                     Desktop Area                             │
│                   (壁纸 + 图标网格)                           │
│                                                              │
│                                                              │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│                         Dock (48px)                          │
│  ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐     ┌──┐ ┌──┐ ┌──┐    │
│  │  │ │  │ │  │ │  │ │  │ │  │ │  │ ... │  │ │  │ │  │    │
│  └──┘ └──┘ └──┘ └──┘ └──┘ └──┘ └──┘     └──┘ └──┘ └──┘    │
└──────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                     Start Menu (悬浮)                        │
│  ┌──────────┬──────────────────────────────────────────────┐ │
│  │          │                                              │ │
│  │  应用列表  │              对话面板                        │ │
│  │  ┌────┐  │  ┌────────────────────────────────────────┐  │ │
│  │  │助手│  │  │                                        │  │ │
│  │  └────┘  │  │     你好，有什么可以帮助你的？           │  │ │
│  │  ┌────┐  │  │                                        │  │ │
│  │  │文件│  │  └────────────────────────────────────────┘  │ │
│  │  └────┘  │  ┌────────────────────────────────────────┐  │ │
│  │  ┌────┐  │  │                                        │  │ │
│  │  │设置│  │  │                                        │  │ │
│  │  └────┘  │  └────────────────────────────────────────┘  │ │
│  │  ┌────┐  │  ┌────────────────────────────────────────┐  │ │
│  │  │创建│  │  │ 输入框...                        [发送] │  │ │
│  │  └────┘  │  └────────────────────────────────────────┘  │ │
│  │          ├──────────────────────────────────────────────┤ │
│  │          │ [🔍搜索] [📁文件] [⚙️设置] [🗑️回收站]        │ │
│  └──────────┴──────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**开始菜单布局说明**：
- **左侧（120px固定宽度）**：应用列表，显示内置应用图标，点击启动
- **右侧（剩余宽度）**：完整的对话界面
- **底部（48px固定高度）**：横排快捷按钮，包括：搜索、文件、设置、回收站等

### 4.2 核心组件

#### 4.2.1 Desktop 桌面组件
- 管理桌面图标网格布局
- 处理桌面点击（空白区域取消选中）
- 支持壁纸设置
- 支持桌面图标拖拽排列

#### 4.2.2 Dock 停靠栏组件
- 显示已安装应用的图标
- 运行中的应用显示白点指示
- Hover时图标放大效果（magnification）
- 点击图标启动/聚焦应用
- 支持拖拽排序

#### 4.2.3 Taskbar 任务栏组件
- 显示当前打开的窗口
- 点击切换窗口焦点
- 显示窗口最小化/最大化/关闭按钮

#### 4.2.4 StartMenu 开始菜单组件
- 点击开始按钮滑出
- 长按开始按钮进入语音输入模式
- **左侧（120px）**：应用图标列表，点击启动对应应用
- **右侧**：完整对话界面，包括消息列表和输入框
- **底部**：快捷按钮栏，包含搜索、文件、设置等常用功能入口

#### 4.2.5 Window 窗口组件
- 支持拖拽移动
- 支持调整大小
- 支持最小化/最大化/关闭
- 支持层叠和平铺
- 支持双击标题栏最大化

#### 4.2.6 AppWindow 应用窗口内容
根据不同应用类型渲染不同内容：
- **对话型**：消息列表 + 输入框 + 技能调用面板
- **设置型**：表单 + 分组面板
- **文件管理型**：树形目录 + 文件列表

### 4.3 交互规范

| 交互 | 行为 |
|------|------|
| 单击桌面图标 | 选中图标（高亮边框） |
| 双击桌面图标 | 启动应用 |
| 拖拽桌面图标 | 移动图标位置 |
| 单击Dock图标 | 启动应用或聚焦已有窗口 |
| 双击窗口标题栏 | 最大化/还原窗口 |
| 拖拽窗口标题栏 | 移动窗口 |
| 拖拽窗口边缘 | 调整窗口大小 |
| 单击开始按钮 | 滑出开始菜单 |
| 长按开始按钮(500ms) | 进入语音输入模式 |
| 单击桌面空白 | 取消所有选中 |

### 4.4 状态管理

```typescript
// 全局桌面状态
interface DesktopState {
  // 桌面配置
  settings: DesktopSettings;

  // 已安装应用列表
  installedApps: App[];

  // 打开的窗口列表
  windows: Window[];

  // 焦点窗口ID
  focusedWindowId: string | null;

  // 开始菜单状态
  startMenuOpen: boolean;
  startMenuMode: 'click' | 'voice';

  // 任务栏
  taskbarApps: string[];  // 正在运行的应用ID列表

  // 剪贴板
  clipboard: ClipboardData;
}

// 窗口状态
interface Window {
  id: string;
  appId: string;
  title: string;
  icon: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  isMaximized: boolean;
  isMinimized: boolean;
  zIndex: number;
}
```

---

## 5. 后端详细设计

### 5.1 API 规范

#### 5.1.1 应用管理

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | /api/apps | 获取已安装应用列表（可按source过滤） |
| GET | /api/apps/:appId | 获取应用详情 |
| POST | /api/apps | 创建新应用（通过app-builder创建，写入user/目录） |
| PUT | /api/apps/:appId | 更新应用配置（仅user来源的应用可修改） |
| DELETE | /api/apps/:appId | 删除应用（仅user来源的应用可删除，system来源仅隐藏） |

#### 5.1.2 会话管理

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | /api/apps/:appId/conversations | 获取会话列表 |
| POST | /api/apps/:appId/conversations | 创建新会话 |
| GET | /api/apps/:appId/conversations/:convId | 获取会话详情 |
| DELETE | /api/apps/:appId/conversations/:convId | 删除会话 |

#### 5.1.3 消息交互

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | /api/apps/:appId/conversations/:convId/messages | 发送消息 |
| GET | /api/apps/:appId/conversations/:convId/stream | SSE流式响应 |

#### 5.1.4 MCP服务

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | /api/mcp/services | 获取可用MCP服务列表 |
| POST | /api/mcp/services | 动态注册MCP服务 |
| DELETE | /api/mcp/services/:serviceId | 注销MCP服务 |
| POST | /api/mcp/call | 调用MCP工具 |

#### 5.1.5 桌面设置

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | /api/settings | 获取桌面设置 |
| PUT | /api/settings | 更新桌面设置 |

### 5.2 请求/响应示例

#### 发送消息
```http
POST /api/apps/desktop-assistant/conversations/conv-123/messages
Content-Type: application/json

{
  "content": [
    {
      "type": "text",
      "text": "帮我写一个Hello World程序"
    }
  ],
  "stream": true
}
```

#### SSE流式响应
```http
GET /api/apps/desktop-assistant/conversations/conv-123/stream

HTTP/1.1 200 OK
Content-Type: text/event-stream

event: message
data: {"type": "content", "content": {"type": "text", "text": "好的"}

event: message
data: {"type": "content", "content": {"type": "text", "text": "我来帮你"}

event: tool_call
data: {"type": "tool_call", "tool": "mcp.code", "method": "create_file", "args": {...}}

event: done
data: {"type": "done"}
```

### 5.3 内置MCP服务

#### 5.3.1 Agent管理服务 (mcp.agent)

```typescript
// 获取Agent列表
interface GetAgentsRequest {
  type?: 'desktop' | 'background';  // 可选过滤
}

interface GetAgentsResponse {
  agents: AgentInfo[];
}

// 调用Agent
interface CallAgentRequest {
  agentId: string;
  message: Content[];
  conversationId?: string;  // 指定会话，不指定则创建新会话
}

interface CallAgentResponse {
  conversationId: string;
  messageId: string;
}
```

#### 5.3.2 窗口管理服务 (mcp.window)

```typescript
// 打开窗口
interface OpenWindowRequest {
  appId: string;
  conversationId?: string;
  position?: { x: number; y: number };
  size?: { width: number; height: number };
}

// 关闭窗口
interface CloseWindowRequest {
  windowId: string;
}

// 列出窗口
interface ListWindowsResponse {
  windows: WindowInfo[];
}
```

#### 5.3.3 文件系统服务 (mcp.filesystem)

```typescript
interface ReadFileRequest {
  path: string;  // 相对于desktop_data的路径
}

interface WriteFileRequest {
  path: string;
  content: string;
}

interface ListDirectoryRequest {
  path: string;
}
```

### 5.4 模型适配器

```typescript
interface ModelAdapter {
  provider: string;

  // 聊天完成
  chat(params: ChatParams): Promise<ChatResponse>;

  // 流式聊天
  chatStream(params: ChatParams): AsyncGenerator<ChatStreamEvent>;

  // 支持的内容类型
  supports: ('text' | 'image' | 'audio' | 'video' | 'file')[];
}

interface ChatParams {
  model: string;
  messages: Message[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  tools?: Tool[];
}

interface ChatStreamEvent {
  type: 'content' | 'tool_call' | 'done' | 'error';
  content?: Content;
  toolCall?: ToolCall;
  error?: string;
}
```

---

## 6. 安全与权限

### 6.1 技能授权 (allow.json)

```json
{
  "mode": "ask",                      // "allow_all" | "deny_all" | "ask"
  "allowedPaths": [                   // 文件访问授权
    "desktop_data/apps/*/data/**",
    "desktop_data/public_data/**"
  ],
  "deniedPaths": [
    "desktop_data/configs/*.json"
  ],
  "allowedApps": [                    // 允许调用的应用
    "desktop-assistant",
    "file-manager"
  ],
  "deniedApps": [],
  "allowedCommands": [                 // 允许执行的命令
    "git",
    "node"
  ],
  "deniedCommands": [
    "rm",
    "del",
    "format"
  ]
}
```

### 6.2 敏感操作确认

以下操作需要用户确认：
- 执行shell命令
- 访问受限文件路径
- 调用外部网络请求
- 删除应用或文件
- 修改系统设置

---

## 7. 内置应用设计

> 以下应用均为系统内置应用，位于 `apps/system/` 目录，不可删除。

### 7.1 桌面助手 (desktop-assistant)

**类型**: 桌面应用

**功能**:
- 基础对话能力
- 调用其他应用和服务
- 技能管理
- 文件操作

**系统提示**:
```
你是一个运行在AI桌面系统中的智能助手。你可以：
1. 与用户对话，回答问题
2. 调用桌面系统中的各种应用和服务
3. 帮助用户管理文件和执行任务

当你需要使用工具时，通过MCP协议调用相应的服务。
始终以帮助用户为目标，保持简洁和有建设性的回复。
```

### 7.2 文件管理器 (file-manager)

**类型**: 桌面应用

**功能**:
- 浏览desktop_data目录结构
- 预览文本/图片/音视频文件
- 创建/删除/重命名文件和文件夹
- 拖拽移动文件

### 7.3 系统设置 (settings)

**类型**: 桌面应用

**功能**:
- 主题切换（浅色/深色/自动）
- 壁纸设置
- Dock配置
- 模型配置
- MCP服务管理

### 7.4 剪贴板服务 (clipboard)

**类型**: 后台服务

**功能**:
- 记录剪贴板历史
- 提供给其他应用访问剪贴板

### 7.5 通知服务 (notification)

**类型**: 后台服务

**功能**:
- 发送系统通知
- 通知历史记录

### 7.6 创建应用 (app-builder)

**类型**: 桌面应用

**功能**:
- 通过对话方式创建新的Agent应用
- 用户描述应用需求，AI帮助生成应用配置
- 支持定义：应用名称、描述、图标、类型（桌面/后台）
- 支持配置：使用的模型、技能、MCP服务
- 支持编辑已创建的应用

**系统提示**:
```
你是一个应用创建助手。你可以帮助用户：
1. 创建一个新的桌面应用或后台服务
2. 完善应用的元数据（名称、描述、图标）
3. 配置应用使用的模型和参数
4. 绑定需要的技能和MCP服务
5. 编辑和修改已创建的应用

创建过程中，通过问答引导用户完成必要配置，生成完整的应用结构。
```

### 7.7 回收站 (trash)

**类型**: 桌面应用

**功能**:
- 查看已删除的文件和应用
- 恢复误删的文件
- 永久删除

---

## 8. 实现优先级

### Phase 1: 核心框架
1. 项目脚手架搭建（前端React + 后端TypeScript）
2. 数据目录结构和加载机制
3. 基础桌面UI组件
4. 窗口管理系统
5. 开始菜单和Dock栏

### Phase 2: Agent核心
1. 模型适配器（支持OpenAI）
2. Agent加载和执行
3. 会话管理
4. SSE流式响应
5. 基础MCP服务

### Phase 3: 完善功能
1. 内置应用开发（文件管理器、设置、创建应用、回收站）
2. MCP服务扩展
3. 技能系统
4. 文件系统MCP

### Phase 4: 优化体验
1. 主题和壁纸
2. 动画效果优化
3. 语音输入模式
4. 通知系统
5. 权限管理

---

## 9. 验收标准

### 9.1 功能验收

- [ ] 桌面显示壁纸和应用图标
- [ ] Dock栏显示已安装应用，hover有放大效果
- [ ] 点击开始按钮滑出开始菜单
- [ ] 可以通过开始菜单启动应用
- [ ] 窗口可以拖拽移动、调整大小、最小化/最大化/关闭
- [ ] 多个窗口可以层叠显示，点击聚焦
- [ ] 对话应用可以发送消息并获得AI回复
- [ ] 消息以SSE流式方式显示
- [ ] 设置应用可以修改桌面主题
- [ ] 数据持久化到desktop_data目录

### 9.2 视觉验收

- [ ] 整体风格接近macOS Big Sur
- [ ] 窗口有圆角和阴影效果
- [ ] Dock栏图标有毛玻璃背景
- [ ] 开始菜单有滑入/滑出动画
- [ ] 窗口最小化/最大化有流畅动画

---

## 10. 备注

本文档为产品设计规格书，具体实现可能根据技术评估结果调整。
