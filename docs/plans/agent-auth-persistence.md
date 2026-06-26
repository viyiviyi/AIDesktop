# Agent 授权中断与消息持久化方案

## 问题分析

1. **消息消失**：agent 执行期间消息只存在内存中，工具调用中断（workspace 授权/表单）后不保存，直到整个 agent loop 结束才批量保存。

2. **继续逻辑不完整**：`continue` 时只检查了最后一条 assistant 消息有无未完成的 toolCall，但 syncHistory + agent.prompt 的同步方式导致 agent 内部状态不一致。

3. **只有中断式授权**：workspace 授权是"用户不授权就 abort"，没有"拒绝但继续"的模式。

## 方案设计

### 核心改动

#### 1. agent-loop.ts：新增实时持久化钩子

在 agent-loop 的 `runLoop` 函数中，每轮关键事件后调用一个可选的 `onMessagesChanged(messages)` 钩子：

- `message_end`（assistant 消息完成）→ 回调
- `tool_execution_end`（每个工具执行完成）→ 回调
- `turn_end`（一轮结束）→ 回调

这个钩子不在 pi-agent-core 中新增，而是通过 AgentLoopConfig 传入 `onMessagesChanged` 回调。

#### 2. pi-agent-session.ts：runAgentAsync 重写

- 在 `subscribe` 的 `message_end` / `tool_execution_end` 事件中，实时调用 `saveNewMessages` 增量保存
- 去掉 `hasMoreToolCalls` 判断代理循环的依赖，改用 pi-agent-core 的 abort + continue 模式
- workspace 授权中断：用 `agent.steer()` 注入 toolResult，而不是 abort + 重新 prompt

#### 3. workspace 授权：支持拒绝式

- `handleWorkspaceCodeMethod` 中，当用户拒绝时返回一个明确的 tool result（非 error），内容为"用户拒绝了工作目录授权"
- agent 收到这个结果后会判断"哦，用户没给权限，那换个方式"

### 文件改动清单

- `vendor/pi/packages/agent/src/types.ts` — AgentLoopConfig 新增 onMessagesChanged 可选回调
- `vendor/pi/packages/agent/src/agent-loop.ts` — runLoop 中关键点调用 onMessagesChanged
- `server/src/agents/pi-agent-session.ts` — runAgentAsync 重写持久化策略
- `server/src/agents/pi-tools.ts` — workspace 工具区分中断/拒绝模式
- `server/src/mcp/service.ts` — workspace.code 方法的授权处理逻辑
- `server/src/routes/conversations.ts` — continue 路由重写

### 改造后的流程

```
用户输入 → 保存 user 消息 → agent.prompt()
  → AI 流式输出 → message_end → 保存 assistant 消息
  → 工具调用 → tool_execution_start
     → 如果是 workspace 授权
        → 发射授权事件到前端
        → agent.abort() + 标记 hasPendingAuth
     → 工具执行完成 → tool_execution_end → 保存 toolResult 消息
  → agent.prompt() 完成 → turn_end
  → 如果 hasPendingAuth
     → 等待用户授权响应
     → 用户确认 → steer(toolResult) → agent.continue()
     → 用户拒绝（拒绝式） → steer(toolResult{拒绝}) → agent.continue()
     → 用户拒绝（中断式） → 标记 terminate → agent_end
  → 结束 → agent_end → 触发 done 事件
```

### continue 路由改动

检测逻辑：
1. 最后一条是 assistant + 有 toolCall → 重新执行该工具 → 保存结果 → 继续
2. 最后一条是 assistant + 无 toolCall（continue 请求 AI 继续）→ agent.continue()
3. 最后一条是 toolResult → 已有回执，没完成，继续 agent.continue()
4. 最后一条是 user → agent.prompt()
