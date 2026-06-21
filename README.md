# AIDesktop

智能桌面操作系统 —— 一个基于 AI Agent 的桌面环境，支持多应用并行运行、Agent 间互相调用、MCP 工具扩展和技能系统。

> **⚠️ 重要声明**  
> 本项目**仅限个人学习和非商业用途**，严禁用于任何商业目的。详情见 LICENSE 文件。

---

## 简介

AIDesktop 是一个运行在浏览器中的 AI 桌面环境。你可以像操作真实桌面系统一样打开多个应用窗口、与 AI 助手对话、让不同 Agent 协同完成任务。

**核心特性：**
- 🖥️ **桌面环境** — 多窗口管理、开始菜单、任务栏、Dock
- 🤖 **AI Agent** — 每个应用是一个独立的 AI Agent，具有自己的提示词和工具
- 🔗 **Agent 间调用** — Agent 可以互相调用，协同完成任务
- 🔧 **MCP 工具** — 支持 Stdio/SSE/HTTP 三种传输协议的 MCP 工具扩展
- 📚 **技能系统** — 可插拔的技能模块，为 Agent 提供专业知识
- 🎨 **自定义应用** — 通过对话方式创建新的 AI 应用

---

## 快速开始

### 环境要求

- Node.js >= 22
- npm 或 pnpm

### 安装

```bash
# 克隆项目
git clone <repo-url>
cd AIDesktop

# 安装依赖
cd server && npm install
cd ../client && npm install
```

### 启动

```bash
# 启动服务端（在 server 目录）
npm run dev

# 启动前端（在 client 目录，新终端）
npm run dev
```

打开浏览器访问 `http://localhost:5173`（默认端口）。

---

## 技术栈

- **前端**: React + TypeScript + Vite
- **后端**: Express + TypeScript
- **AI 引擎**: pi-agent-core / pi-ai
- **MCP SDK**: @modelcontextprotocol/sdk
- **存储**: 文件系统（JSON）

---

## 项目结构

```
AIDesktop/
├── client/                 # 前端（React + Vite）
│   ├── src/
│   │   ├── components/     # UI 组件
│   │   ├── contexts/       # React Context（状态管理）
│   │   ├── services/       # API 调用
│   │   └── styles/         # 样式
│   └── package.json
├── server/                 # 后端（Express）
│   ├── src/
│   │   ├── agents/         # AI Agent 管理
│   │   ├── mcp/            # MCP 服务注册与调用
│   │   ├── models/         # AI 模型适配
│   │   ├── routes/         # API 路由
│   │   ├── services/       # 业务服务
│   │   └── utils/          # 工具函数
│   ├── desktop_data/       # 运行时数据（应用、配置、会话）
│   └── package.json
└── README.md
```

---

## MCP 工具配置

### 支持的传输类型

| 类型 | 说明 | 示例 |
|------|------|------|
| `stdio` | 通过标准输入/输出启动子进程 | `npx -y @playwright/mcp@latest` |
| `sse` | 传统 SSE 协议，分 SSE 端点和 POST 端点 | `http://localhost:3001/sse` |
| `http` | Streamable HTTP，单端点 POST | `https://dashscope.aliyuncs.com/.../mcp` |

### 认证支持

SSE/HTTP 类型支持自定义请求头，可用于 Bearer Token、API-Key 等认证方式。

---

## License

本项目使用 **CC BY-NC-SA 4.0**（知识共享-非商业性使用-相同方式共享 4.0 国际许可协议）。

这意味着：
- ✅ **你可以** — 复制、分发、修改本软件
- ❌ **你不可以** — 将本软件用于商业目的
- 📌 **你必须** — 注明原作者，并以相同许可方式分发

完整许可见 [LICENSE](./LICENSE) 文件。

---

## AIDesktop

An AI-powered desktop operating system running in the browser. Supports multiple AI agent applications, inter-agent communication, MCP tool extensions, and a skill system.

> **⚠️ Important Notice**  
> This project is **for personal learning and non-commercial use only**. Any commercial use is strictly prohibited. See the LICENSE file for details.

---

## Introduction

AIDesktop is an AI desktop environment that runs in your browser. You can open multiple application windows, chat with AI assistants, and have different agents collaborate on tasks, just like a real desktop operating system.

**Key Features:**
- 🖥️ **Desktop Environment** — Multi-window management, start menu, taskbar, dock
- 🤖 **AI Agents** — Each app is an independent AI agent with its own prompt and tools
- 🔗 **Agent Collaboration** — Agents can call each other to complete tasks together
- 🔧 **MCP Extensions** — Supports Stdio, SSE, and HTTP MCP transport protocols
- 📚 **Skill System** — Plugable skill modules providing domain knowledge to agents
- 🎨 **Custom Apps** — Create new AI applications through conversation

---

## Quick Start

### Prerequisites

- Node.js >= 22
- npm or pnpm

### Installation

```bash
git clone <repo-url>
cd AIDesktop
cd server && npm install
cd ../client && npm install
```

### Start

```bash
# Terminal 1: start server
cd server && npm run dev

# Terminal 2: start client
cd client && npm run dev
```

Open `http://localhost:5173` in your browser.

---

## Tech Stack

- **Frontend**: React + TypeScript + Vite  
- **Backend**: Express + TypeScript  
- **AI Engine**: pi-agent-core / pi-ai  
- **MCP SDK**: @modelcontextprotocol/sdk  
- **Storage**: Filesystem (JSON)

---

## MCP Tool Configuration

### Supported Transports

| Type | Description | Example |
|------|-------------|---------|
| `stdio` | Spawn subprocess via stdin/stdout | `npx -y @playwright/mcp@latest` |
| `sse` | Traditional SSE: separate SSE endpoint + POST endpoint | `http://localhost:3001/sse` |
| `http` | Streamable HTTP: single POST endpoint | `https://dashscope.aliyuncs.com/.../mcp` |

### Authentication

SSE/HTTP transports support custom request headers for Bearer Token, API-Key, etc.

---

## License

This project is licensed under **CC BY-NC-SA 4.0** (Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International).

- ✅ **You may** — copy, distribute, and modify the software
- ❌ **You may not** — use the software for commercial purposes
- 📌 **You must** — give appropriate credit and share under the same license

Full license text is available in the [LICENSE](./LICENSE) file.
