# AIDesktop

> [中文版](./README.md)

An AI-powered desktop operating system running in the browser. Supports multiple AI agent applications, inter-agent communication, MCP tool extensions, and a skill system.

> **📖 Dev Guide**: `docs/开发维护指南.md` — Architecture, key workflows, common dev tasks.

---

> **⚠️ Important Notice**

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

## Project Structure

```
AIDesktop/
├── client/                 # Frontend (React + Vite)
│   ├── src/
│   │   ├── components/     # UI Components
│   │   ├── contexts/       # React Context (state management)
│   │   ├── services/       # API calls
│   │   └── styles/         # Styles
│   └── package.json
├── server/                 # Backend (Express)
│   ├── src/
│   │   ├── agents/         # AI Agent management
│   │   ├── mcp/            # MCP service registry and routing
│   │   ├── models/         # AI model adapters
│   │   ├── routes/         # API routes
│   │   ├── services/       # Business services
│   │   └── utils/          # Utilities
│   ├── desktop_data/       # Runtime data (apps, configs, conversations)
│   └── package.json
└── README.md
```

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
