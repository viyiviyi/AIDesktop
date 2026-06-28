# AI Desktop 桌面智能助手 - 产品设计规格书

> 本文档为产品核心设计。详细 API 接口、数据模型、组件指南、实现细节见对应子文档：
> - [API 接口文档](api-spec.md)
> - [数据模型定义](data-model.md)
> - [前端组件指南](component-guide.md)
> - [实现细节](implementation-details.md)
> - [开发维护指南](DEV_GUIDE.md)

---

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

### 2.1 系统架构

```
┌──────────────────────┐     HTTP / SSE     ┌──────────────────────┐
│   Client (Browser)    │ ◄────────────────► │   Backend Server     │
│   React + TypeScript  │                    │   Express + TS      │
│   ┌────────────────┐  │                    │  ┌────────────────┐ │
│   │ Desktop / Dock  │  │                    │  │  Router       │ │
│   │ Window / Start  │  │                    │  │  Agent Engine │ │
│   │ InjectionBar    │  │                    │  │  MCP Loader   │ │
│   │ MarkdownView    │  │                    │  └────────────────┘ │
│   └────────────────┘  │                    │  ┌────────────────┐ │
│   CSS 变量多主题       │                    │  │ Model Adapter │ │
└──────────────────────┘                    │  │ OpenAI/其他   │ │
                                             │  └────────────────┘ │
                                             └─────────┬────────────┘
                                                       │
                                             ┌─────────┴────────────┐
                                             │  Local File System   │
                                             │  desktop_data/       │
                                             └──────────────────────┘
```

### 2.2 技术栈

**前端**：React 19 + TypeScript, Ant Design 6, Vite 8
**后端**：Node.js 18+, Express 4, TypeScript, esbuild
**通信**：HTTP REST + SSE (WebSocket)
**Agent引擎**：Pi（自研，streamFn模式）
**样式**：纯CSS + CSS变量双主题（dark/light）

---

## 3. 数据架构（概要）

> 详细数据模型见 [`data-model.md`](data-model.md)

### 3.1 目录结构

```
desktop_data/
├── apps/                          # 应用目录
│   ├── system/                    # 系统内置应用
│   │   └── desktop-assistant/
│   │       ├── meta.json          # 应用元数据
│   │       ├── app.md             # Agent 系统提示
│   │       ├── mcp.json           # MCP 服务列表
│   │       ├── include.json       # 引用的公共技能（v2）
│   │       ├── allow.json         # 对外暴露权限（v2）
│   │       ├── skills/            # 私有技能目录（v2）
│   │       └── data/              # 应用专用数据
│   ├── user/                      # 用户创建的应用
│   └── marketplace/               # 应用商店（预留）
│
├── public_data/                   # 公共数据
│   └── skills/                    # 公共技能市场
│
├── wallpapers/                    # 壁纸目录
│
└── configs/                       # 配置文件
    ├── setting.json               # 桌面设置
    ├── modes.json                 # 模型提供商配置
    ├── mcp.json                   # MCP 服务配置
    └── window-positions.json      # 窗口位置
```

### 3.2 应用来源分类

- `system/` — 系统内置，不可删除
- `user/` — 用户创建，可编辑和删除
- `marketplace/` — 应用商店安装（预留）

### 3.3 配置合并策略

用户配置（`config.json`）覆盖应用定义（`meta.json`），运行时合并。未配置的字段使用 meta 默认值。

---

## 4. 前端设计（概要）

> 详细组件指南见 [`component-guide.md`](component-guide.md)
> API 定义见 [`api-spec.md`](api-spec.md)

### 4.1 布局

```
┌──────────────────────────────────────┐
│  Menu Bar (28px)                      │
├──────────────────────────────────────┤
│                                      │
│   Desktop Area（壁纸 + 图标网格）      │
│                                      │
├──────────────────────────────────────┤
│  Dock (64px)                         │
└──────────────────────────────────────┘
```

### 4.2 窗口布局规范

所有窗口类组件统一结构：header → (tabs) → body(flex:1, overflow-y:auto, min-height:0) → (footer)

中间内容区必须用 `flex: 1; overflow-y: auto; min-height: 0`，防止双滚动条。

### 4.3 InjectionBar

位于标题栏和消息列表之间，显示应用状态/记忆/目标摘要，点击展开 Markdown 详情。

---

## 5. 后端设计（概要）

> 完整 API 定义见 [`api-spec.md`](api-spec.md)

### 5.1 路由结构

| 基础路径 | 模块 |
|----------|------|
| `/api/apps` | 应用管理 |
| `/api/apps/:appId/conversations` | 会话管理 |
| `/api/apps/:appId/injections` | 注入状态 |
| `/api/apps/:appId/memory` | 记忆管理 |
| `/api/settings` | 系统设置 |
| `/api/mcp` | MCP 服务 |
| `/api/hermes` | Hermes Agent |
| `/api/logs` | 日志 |
| `/api/workspace` | 工作区 |

### 5.2 日志规范

使用 `serverLogger`，分级分类记录。工具调用和 AI 请求/响应是强制记录点。

---

## 6. 安全与权限

### 6.1 敏感操作确认

以下操作需要用户确认：
- 执行 shell 命令
- 访问受限文件路径
- 调用外部网络请求
- 删除应用或文件
- 修改系统设置

---

## 7. 内置应用设计

> 所有系统内置应用位于 `apps/system/`，不可删除。

| 应用 | 类型 | 功能 |
|------|------|------|
| 桌面助手 | 桌面 | 基础对话、调用其他应用、技能管理 |
| 文件管理器 | 桌面 | 浏览目录、文件预览、CRUD |
| 系统设置 | 桌面 | 桌面/模型/MCP/技能设置 |
| 创建应用 | 桌面 | 通过对话创建新 Agent 应用 |
| 回收站 | 桌面 | 查看/恢复/永久删除 |
| 剪贴板 | 后台 | 剪贴板历史 |
| 通知服务 | 后台 | 系统通知 |

---

## 8. 应用级技能系统（v2 设计）

> 这是对当前简化实现的升级设计，当前系统使用全局技能池 + `app.config.skills`，
> 后续将迁移至此方案。

### 8.1 设计目标

| 需求 | 说明 |
|------|------|
| 技能跟随应用 | 每个应用拥有自己的 `skills/` 目录，技能随应用分发/卸载 |
| 公共技能市场 | `public_data/skills/` 作为公共仓库，应用可按需引用 |
| 权限控制 | 应用声明哪些技能/工具对外可见 |
| 依赖管理 | `meta.json` 中的 `dependsOn` 声明应用依赖 |
| 应用商店友好 | 下载的安装包包含完整技能目录，开箱即用 |

### 8.2 应用目录结构（v2）

```
apps/{appId}/
├── meta.json              # 应用元数据（含 dependsOn）
├── app.md                 # Agent 系统提示
├── include.json           # 引用的公共/外部技能
├── allow.json             # 对外暴露权限
└── skills/                # 私有技能目录
    ├── skill-1/
    │   ├── prompt.md      # 技能定义（markdown）
    │   ├── config.json    # 技能元数据
    │   └── scripts/       # 可执行脚本
    └── skill-2/
```

### 8.3 include.json — 引用外部技能

```json
{
  "includes": [
    { "source": "public", "id": "web-search" },      // 公共技能市场
    { "source": "app", "id": "desktop-assistant" }    // 其他应用暴露的技能
  ],
  "mode": "ask"              // "allow_all" | "deny_all" | "ask"
}
```

### 8.4 allow.json — 对外权限

```json
{
  "mode": "deny_all",
  "exposeSkills": ["cat-mode"],        // 对外暴露的技能
  "exposeTools": ["mcp.agent.call"],   // 对外暴露的工具
  "exposeTo": ["desktop-assistant"]    // 白名单（空 = 不限制）
}
```

### 8.5 加载规则

```
1. 检查 dependsOn，递归加载依赖（防止循环，最大10层）
2. 读取 include.json 引用外部技能
3. 读取 allow.json 权限
4. 扫描 skills/ 目录加载私有技能
5. 合并到 system prompt
```

### 8.6 Prompt 注入顺序

```
1. app.md（主提示）
2. 私有技能（skills/ 目录）
3. 引用的公共技能（public_data/skills）
4. 引用的外部应用技能
5. 工具列表
6. 长期记忆
```

### 8.7 应用商店分发

安装包结构：
```
code-reviewer.app/
├── meta.json, app.md, include.json, allow.json
└── skills/{skill-id}/{prompt.md, config.json, scripts/}
```

安装时检查引用的公共技能和依赖应用是否已安装。

### 8.8 迁移策略

```
Phase 1：应用级 skills/ 目录 + include.json 实现，与旧 config.skills 并存
Phase 2：淘汰 config.skills，自动转换为 include.json
Phase 3：移除全局 skills.json，仅保留 public_data/skills/ 市场
```

---

## 9. 实现优先级

### Phase 1: 核心框架
项目脚手架、数据目录、基础桌面UI、窗口管理、开始菜单和Dock

### Phase 2: Agent核心
模型适配器、Agent执行、会话管理、SSE流式、基础MCP服务

### Phase 3: 完善功能
内置应用、MCP扩展、技能系统（当前）

### Phase 4: 优化体验
主题和壁纸、动画、语音输入、通知、权限（当前）

### Phase 5: 应用级技能系统（规划）
skills/ 目录、include.json、allow.json、应用商店支持

---

## 10. 验收标准

- [ ] 桌面显示壁纸和应用图标
- [ ] Dock栏 hover 放大效果
- [ ] 窗口可拖拽/缩放/最小化/最大化/关闭
- [ ] 对话应用可发送消息并流式获得 AI 回复
- [ ] 设置应用可修改主题
- [ ] 数据持久化到 desktop_data
- [ ] 多主题适配，无硬编码颜色（见 DEV_GUIDE 第5章）
