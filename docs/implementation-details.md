# 实现细节

> 本文档包含 Agent、MCP、记忆、构建等系统的具体实现细节。
> 适合需要深入理解或修改代码时查阅。

---

## 1. Agent 系统

### 1.1 Agent 会话流程

```
用户发送消息
  → runAgentAsync(appId, convId, userContent)
    → getOrCreateSession()          // 获取或新建 PiAgentSession
    → syncHistory()                 // 同步历史消息
    → injectWorkspaceTools()        // 注入工作区工具
    → buildSystemPrompt()           // 构建 system prompt
    → session.prompt()              // 调用 LLM
      → streamFn()                  // 流式返回
        → text_chunk → SSE → 前端
        → tool_execution_start → SSE
        → tool_execution_end → SSE
        → message_end → SSE
```

### 1.2 System Prompt 构建顺序

```
1. app.md（Agent 系统提示）
2. 可调用 Agent 列表
3. 已加载技能列表（名称+描述）
4. 长期记忆（应用级 + 会话级 + 目标树）
5. 记忆工具使用提示（mcp.memory 已启用时）
```

### 1.3 事件驱动

Agent 通过 `eventBus` 发射事件，`wsServer.ts` 转发为 SSE：

| 事件 | 触发时机 | 前端处理 |
|------|----------|----------|
| `text_chunk` | 流式文本 | 追加到 streamingText |
| `tool_call` | tool_execution_start | 显示 toolCall 卡片 |
| `tool_result` | tool_execution_end | 显示 toolResult |
| `message_end` | 完整消息结束 | 追加到 messages |
| `thinking` | LLM 思考中 | 显示思考状态 |

### 1.4 工具构建

```typescript
buildPiToolsForApp(app) → AgentTool[]
```

流程：
1. 遍历 `mcpServiceRegistry` 中所有注册的服务
2. 只注入 `allowedTools`（config + meta 合并）中明确列出的服务
3. 调用 `buildExternalMcpAgentTools()` 构建外部 MCP 工具（已连接才出现）
4. 如有技能授权，注入 `mcp_skill_list`/`mcp_skill_read`/`mcp_skill_exec`

### 1.5 工具名称转换

```
内置服务：  mcp_filesystem_read     (mcp.{service}.{method})
外部 MCP： mcp_Browser_browser_navigate  (mcp_{连接名}_{工具名})
```

---

## 2. MCP 系统

### 2.1 内置 MCP 服务

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

### 2.2 外部 MCP 工具命名

```typescript
// 配置 Key（前后端统一格式）
const appToolKey = `external:${safeConnName}:${tool.name}`;
// 例: external:Browser:browser_navigate

// AI Agent 看到的工具名
const agentToolName = `mcp_${safeConnName}_${safeToolName}`;
// 例: mcp_Browser_browser_navigate
```

重要规则：
- **禁止在 key 中使用 UUID**，用连接名代替
- `safeConnName` = `(client.serverInfo?.name || connectionId).replace(/[^a-zA-Z0-9_-]/g, '_')`
- 仅遍历已连接的客户端，断开的工具自动消失

---

## 3. 记忆系统

### 3.1 存储位置

| 级别 | 路径 |
|------|------|
| 应用级 | `desktop_data/apps_data/{appId}/memories.json` |
| 会话级 | `desktop_data/apps_data/{appId}/conversations/{convId}/memories.json` |

### 3.2 MCP 记忆工具方法

需在应用设置中勾选 `mcp.memory` 才能使用：

| 方法 | 用途 |
|------|------|
| `remember` | 保存记忆（scope, key, value, importance, tags） |
| `recall` | 查询记忆（key, keyPrefix, type, tags, search, limit） |
| `recallByPrefix` | 按前缀查询 |
| `forget` | 删除记忆（按 ID 或 tag） |
| `setGoal` | 设置目标（level: 1/2/3, value） |
| `completeGoal` | 标记目标完成 |
| `getActiveGoals` | 获取活跃目标 |
| `getArchivedGoals` | 获取已完成目标 |
| `list` | 列出所有记忆 |
| `listTags` | 列出所有标签 |
| `stats` | 获取统计 |

### 3.3 记忆注入

每次 `buildSystemPrompt` 时自动将记忆注入到 system prompt：

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

### 3.4 日志记录

```typescript
serverLogger.info('agent', `工具调用: ${toolName}`, { toolCallId, toolName, args });
serverLogger.info('agent', `工具返回: ${toolName}`, { toolCallId, toolName, isError });
serverLogger.ai(modelKey, '>>> 请求', { messages: count });
serverLogger.ai(modelKey, '<<< 响应', { stopReason, toolCalls });
serverLogger.debug('memory', `[Memory] saved ${entry.type}:${entry.key}`);
```

---

## 4. 日志级别与分类

```typescript
// 日志级别
'debug' | 'info' | 'warn' | 'error'

// 分类
'api' | 'ai' | 'system' | 'mcp' | 'agent' | 'app' | 'other'

// 便捷方法
serverLogger.ai(source, message, data?)     // AI 请求/响应日志
serverLogger.api(method, url, status, dur?)  // API 调用日志
```

日志数据限制 2000 字符，data 区域 max-height 120px 防止撑爆面板。

---

## 5. 构建与部署

### 5.1 独立可执行文件（SEA）

```bash
# 1. esbuild 打包
cd server && npm run build

# 2. 生成 SEA
cd server && npm run sea

# 流程：
# esbuild → 单 .mjs → node --experimental-sea-config → blob → 注入 Node 可执行文件
```

### 5.2 启动参数

```
--port       端口（默认 3001）
--host       主机（默认 0.0.0.0）
--static     静态文件目录（默认 client/dist）
--data       数据目录（默认 server/desktop_data）
--auto-open  启动后自动打开浏览器
--no-open    不自动打开浏览器
```

### 5.3 环境配置

数据目录下的 `env.json` 可配置：
- `OPENAI_API_KEY` — OpenAI 兼容 API Key
- `OPENAI_BASE_URL` — OpenAI 兼容 Base URL
