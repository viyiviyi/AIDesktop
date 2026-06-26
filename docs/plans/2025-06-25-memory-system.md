# AIDesktop 2.0 记忆系统设计文档

> 本文档定义 AIDesktop 的记忆系统架构、数据模型、分级策略、标签体系和加载机制。开发者应完全理解本文档后再开始实施。

---

## 1. 设计目标

### 1.1 核心需求

- Agent 能在会话间记住用户偏好、事实和上下文
- 长期记忆与当前会话上下文分离，防止 token 膨胀
- 记忆支持多级结构（应用级 → 会话级 → 条目级）
- 支持按标签分类、按层级加载、按条件查找
- 纯文件系统存储，不引入外部数据库/向量引擎
- 会话级拥有特殊的目标树结构，驱动 AI 的任务管理

### 1.2 应用场景

| 场景 | 描述 | 对应记忆级别 |
|------|------|-------------|
| 用户说"叫我小王" | Agent 记住用户名 | 应用级 fact |
| 用户说"我一般用中文提问" | Agent 记住语言偏好 | 应用级 preference |
| 用户说"这个项目用 React" | Agent 记住项目技术栈 | 应用级 context |
| 用户说"我们的目标是把页面做漂亮" | Agent 设置一级目标 | 会话级 goal |
| 用户说"先完成登录页面" | Agent 设置二级目标 | 会话级 goal |
| 用户说"当前在做表单验证" | Agent 更新三级目标 | 会话级 goal |
| 用户说"登录页面做好了" | Agent 归档二级目标 | 会话级 goal → archived |
| Agent 正在处理一个多步骤任务 | Agent 记录中间状态 | 会话级 context |

---

## 2. 数据模型

### 2.1 记忆条目 (MemoryEntry)

```typescript
interface MemoryEntry {
  // === 标识 ===
  id: string;                    // UUID
  type: 'fact' | 'preference' | 'context' | 'goal';  // 记忆类型（新增 goal）

  // === 多级键名 ===
  key: string;                   // 支持 dot notation

  // === 值 ===
  value: string;                 // 结构化值
  content: string;               // 自然语言描述（用于全文检索）

  // === 标签体系 ===
  tags: string[];                // 标签也支持层级：category/subcategory

  // === 元数据 ===
  createdAt: string;             // ISO 时间戳
  updatedAt: string;
  source: 'user' | 'agent' | 'system';
  scope: 'app' | 'conversation';
  conversationId?: string;
  ttl?: number;                  // 可选过期时间（秒）
}
```

### 2.2 目标条目 (GoalEntry) — 会话级专用

目标条目与会话级记忆共存在同一个 `memories.json` 中，通过 `type: 'goal'` 区分。
目标条目有特殊的嵌套结构和状态流转，由 `type: 'goal'` + 特定 key 前缀 `goal/` 标识。

```typescript
// GoalEntry 是 MemoryEntry 的一个具象化，type='goal'，
// key 固定为 'goal/level1' / 'goal/level2' / 'goal/level3'
// tags 标记状态：'goal/active'（活跃）、'goal/archived'（已归档）

// 示例：活跃的一级目标
{
  "id": "uuid-g1",
  "type": "goal",
  "key": "goal/level1",
  "value": "打造一个美观易用的桌面应用",
  "content": "",
  "tags": ["goal/active", "importance/high"],
  "createdAt": "...",
  "updatedAt": "...",
  "source": "user",
  "scope": "conversation"
}

// 示例：活跃的二级目标（归属于一级目标）
{
  "id": "uuid-g2",
  "type": "goal",
  "key": "goal/level2",
  "value": "完成用户登录页面",
  "content": "",
  "tags": ["goal/active", "importance/high"],
  "createdAt": "...",
  "updatedAt": "...",
  "source": "agent",
  "scope": "conversation"
}

// 示例：活跃的三级目标（当前待办）
{
  "id": "uuid-g3",
  "type": "goal",
  "key": "goal/level3",
  "value": "实现表单验证逻辑",
  "content": "",
  "tags": ["goal/active", "importance/high"],
  "createdAt": "...",
  "updatedAt": "...",
  "source": "agent",
  "scope": "conversation"
}

// 示例：已归档的二级目标（上一轮的）
{
  "id": "uuid-g4",
  "type": "goal",
  "key": "goal/level2",
  "value": "完成项目初始化",
  "content": "",
  "tags": ["goal/archived", "importance/normal"],
  "createdAt": "...",
  "updatedAt": "...",
  "source": "agent",
  "scope": "conversation"
}
```

### 2.3 存储结构

```
desktop_data/
└── apps_data/
    └── {appId}/
        ├── memories.json              # 应用级记忆
        ├── config.json
        └── conversations/
            └── {convId}/
                ├── conversation.json
                └── memories.json       # 会话级记忆（含目标树）
```

#### 会话级 memories.json 完整示例

```json
{
  "version": 1,
  "entries": [
    // 普通会话级记忆
    {
      "id": "uuid-m1",
      "type": "context",
      "key": "temp.reference.file",
      "value": "src/index.ts",
      "content": "本次会话引用的主要文件是入口文件",
      "tags": ["temporary"],
      "createdAt": "2025-06-25T10:00:00Z",
      "updatedAt": "2025-06-25T10:00:00Z",
      "source": "agent",
      "scope": "conversation"
    },
    // 目标树（活跃）
    {
      "id": "uuid-g1",
      "type": "goal",
      "key": "goal/level1",
      "value": "打造一个美观易用的桌面应用",
      "content": "",
      "tags": ["goal/active", "importance/high"],
      "createdAt": "2025-06-25T10:00:00Z",
      "updatedAt": "2025-06-25T10:00:00Z",
      "source": "user",
      "scope": "conversation"
    },
    {
      "id": "uuid-g2",
      "type": "goal",
      "key": "goal/level2",
      "value": "完成用户登录页面",
      "content": "",
      "tags": ["goal/active", "importance/high"],
      "createdAt": "2025-06-25T10:00:00Z",
      "updatedAt": "2025-06-25T10:00:00Z",
      "source": "agent",
      "scope": "conversation"
    },
    {
      "id": "uuid-g3",
      "type": "goal",
      "key": "goal/level3",
      "value": "实现表单验证逻辑",
      "content": "",
      "tags": ["goal/active", "importance/high"],
      "createdAt": "2025-06-25T10:00:00Z",
      "updatedAt": "2025-06-25T10:00:00Z",
      "source": "agent",
      "scope": "conversation"
    },
    // 目标树（已归档）
    {
      "id": "uuid-g4",
      "type": "goal",
      "key": "goal/level2",
      "value": "完成项目初始化",
      "content": "",
      "tags": ["goal/archived", "importance/normal"],
      "createdAt": "2025-06-24T10:00:00Z",
      "updatedAt": "2025-06-24T11:00:00Z",
      "source": "agent",
      "scope": "conversation"
    }
  ]
}
```

---

## 3. 核心架构

### 3.1 记忆层级结构

```
应用级 (app scope)
├── user/                 # 用户相关信息
│   ├── name              # 用户名
│   └── language           # 用户语言偏好
├── project/              # 项目相关信息
│   ├── tech               # 技术栈
│   └── rules              # 项目规范
└── preferences/          # 用户偏好
    ├── theme              # 主题偏好
    └── format             # 输出格式偏好

会话级 (conversation scope)
├── goal/                 # 目标树（type='goal'，特殊结构）
│   ├── level1            # 一级目标（唯一活跃）
│   ├── level2            # 二级目标（唯一活跃）
│   └── level3            # 三级目标——当前待办（唯一活跃）
│   // 已归档的 goal 也在这里，tags=["goal/archived"]
├── temp/                 # 临时上下文
│   ├── current_task      # 当前任务描述
│   └── last_reference    # 上次引用
└── working/              # 工作中间状态
    ├── files_referenced  # 本次会话引用的文件
    └── pending_decisions # 待定决策
```

### 3.2 目标树规则

```
┌─────────────────────────────────────┐
│        一级目标（goal/level1）        │
│  唯一活跃，是整个会话的大方向          │
│  例如："打造一个美观易用的桌面应用"     │
└────────────────┬────────────────────┘
                 │ 当 level1 更新时，level2 和 level3 的旧值归档
                 ▼
┌─────────────────────────────────────┐
│        二级目标（goal/level2）        │
│  唯一活跃，是当前阶段的具体方向         │
│  例如："完成用户登录页面"              │
└────────────────┬────────────────────┘
                 │ 当 level2 更新时，level3 的旧值归档
                 ▼
┌─────────────────────────────────────┐
│     三级目标（goal/level3）           │
│  唯一活跃，是当前的待办事项            │
│  例如："实现表单验证逻辑"              │
└─────────────────────────────────────┘
```

**变更规则：**
| 操作 | 效果 |
|------|------|
| 设置/更新 level1 | 旧 level1 归档，level2 和 level3 的旧值**全部归档** |
| 设置/更新 level2 | 旧 level2 归档，level3 的旧值归档 |
| 设置/更新 level3 | 旧 level3 归档 |
| 完成 level3 | level3 归档，清空（等待设置新 level3） |
| 完成 level2 | level2 归档，level3 归档 |
| 完成 level1 | level1 归档，level2 和 level3 归档 |

**归档规则：**
- 归档不删除，仅将 tags 中的 `goal/active` 改为 `goal/archived`
- 已归档的目标不在 system prompt 中注入
- 可通过 MCP 工具 `recallArchivedGoals` 单独查询

### 3.3 标签体系

| 标签 | 含义 | 示例 |
|------|------|------|
| `importance/low` | 低重要性 | 临时偏好 |
| `importance/normal` | 普通重要性 | 一般事实 |
| `importance/high` | 高重要性 | 关键约束、目标 |
| `user/info` | 用户个人信息 | 名字、年龄 |
| `user/preference` | 用户偏好 | 主题、语言 |
| `project/tech` | 项目技术栈 | 框架、语言 |
| `project/rule` | 项目规范 | 命名规范 |
| `project/constraint` | 项目约束 | 必须遵守的规则 |
| `temporary` | 临时记忆 | 会话中间状态 |
| `goal/active` | 活跃目标 | 当前目标 |
| `goal/archived` | 已归档目标 | 已完成/被替代的目标 |

### 3.4 系统默认标签规则

- Agent 每次 `remember` 时自动添加 `source/agent` 标签
- 用户通过 mcp.memory 保存的添加 `source/user` 标签
- 重要性高的自动加 `importance/high` 标签
- 会话级记忆自动加 `scope/conversation` 标签
- 目标条目自动加 `goal/` 类标签

---

## 4. MemoryService API

### 4.1 通用记忆方法

```typescript
class MemoryService {
  // === 通用 CRUD ===

  async remember(scope, appId, entry, convId?): Promise<MemoryEntry>;
  async recall(scope, appId, query, convId?): Promise<MemoryEntry[]>;
  async recallByPrefix(scope, appId, keyPrefix, convId?): Promise<MemoryEntry[]>;
  async update(scope, appId, entryId, updates, convId?): Promise<MemoryEntry | null>;
  async forget(scope, appId, entryId, convId?): Promise<boolean>;
  async forgetByTag(scope, appId, tag, convId?): Promise<number>;
  async listTags(scope, appId, convId?): Promise<string[]>;

  // === 目标树专用方法 ===

  /** 获取当前活跃的目标树（level1 + level2 + level3） */
  async getActiveGoals(appId: string, convId: string): Promise<{
    level1: MemoryEntry | null;
    level2: MemoryEntry | null;
    level3: MemoryEntry | null;
  }>;

  /** 设置一级目标（旧 level1 归档，level2/level3 全部归档） */
  async setLevel1Goal(appId: string, convId: string, value: string, source: string): Promise<MemoryEntry>;

  /** 设置二级目标（旧 level2 归档，level3 归档） */
  async setLevel2Goal(appId: string, convId: string, value: string, source: string): Promise<MemoryEntry>;

  /** 设置三级目标/当前待办（旧 level3 归档） */
  async setLevel3Goal(appId: string, convId: string, value: string, source: string): Promise<MemoryEntry>;

  /** 完成当前 active 的三级/二级/一级目标 */
  async completeGoal(appId: string, convId: string, level: 1 | 2 | 3): Promise<void>;

  /** 查询已归档的目标 */
  async getArchivedGoals(appId: string, convId: string): Promise<MemoryEntry[]>;

  /** 构建用于 system prompt 注入的记忆块 */
  async buildMemoryBlock(appId: string, options?: {
    convId?: string;
    keyPrefix?: string;
    maxEntries?: number;
    minImportance?: 'low' | 'normal' | 'high';
  }): Promise<string>;

  /** 获取记忆统计 */
  async stats(scope, appId, convId?): Promise<{ total: number; byType: Record<string, number>; byTag: Record<string, number> }>;
}
```

### 4.2 注入逻辑 (buildMemoryBlock)

`buildMemoryBlock` 在构建 system prompt 时按层级注入记忆：

**分级加载策略：**

| 条件 | 注入内容 |
|------|----------|
| 首次对话 | 全部 high 重要性 + normal 重要性 |
| 已有历史 | 仅 high 重要性 + 最近更新的 normal |
| 用户明确提及标签/前缀 | 按需加载指定前缀下的所有 |
| 会话级（非 goal） | 全部（通常很少） |
| 目标树（活跃） | **始终注入**，显示在记忆块最顶部 |

**记忆块输出格式：**

```
## 当前目标
【一级目标】打造一个美观易用的桌面应用
  【二级目标】完成用户登录页面
    【三级目标】实现表单验证逻辑 ← 当前待办

---

## 长期记忆

### 用户信息
- user.name: 小王 — 用户希望我称呼他为小王

### 项目规范  
- project.tech: React + TypeScript — 项目使用 React 和 TypeScript
```

---

## 5. MCP 工具设计 (mcp.memory)

### 5.1 方法列表

| 方法 | 功能 | 适用场景 |
|------|------|----------|
| `remember` | 保存一条通用记忆 | 事实、偏好、上下文 |
| `recall` | 按条件查询记忆 | 查找特定信息 |
| `recallByPrefix` | 按前缀查询（层级加载） | 加载某类别下所有记忆 |
| `forget` | 删除一条记忆 | 删除错误记忆 |
| `forgetByTag` | 按标签删除 | 批量清理 |
| `list` | 列出所有记忆 | 浏览全部 |
| `listTags` | 列出所有标签 | 查看分类 |
| `search` | 全文检索 | 模糊搜索 |
| `setGoal` | 设置目标（level 1/2/3） | 管理目标树 |
| `completeGoal` | 完成当前目标 | 推进目标进展 |
| `getActiveGoals` | 获取活跃目标树 | 查看当前目标 |
| `getArchivedGoals` | 获取已归档目标 | 回顾已完成目标 |
| `stats` | 记忆统计 | 查看概览 |

### 5.2 setGoal 参数

```
mcp.memory.setGoal
  level: 1 | 2 | 3        // 目标层级
  value: string            // 目标描述
  source?: "user" | "agent"  // 来源，默认 "agent"
```

### 5.3 Agent 使用示例

```
用户："我们的目标是把界面做漂亮"

Agent 调用：mcp.memory.setGoal
  level: 1
  value: "打造美观的用户界面"
  source: "user"

→ 旧 level1 归档，level2/level3 全部归档

---

用户："先做好登录页面"

Agent 调用：mcp.memory.setGoal
  level: 2
  value: "完成用户登录页面"
  source: "user"

→ 旧 level2 归档，level3 归档

---

用户："当前在弄表单验证"

Agent 调用：mcp.memory.setGoal
  level: 3
  value: "实现表单验证逻辑"
  source: "user"

→ 旧 level3 归档

---

用户："表单验证写完了"

Agent 调用：mcp.memory.completeGoal
  level: 3

→ level3 归档，等待新的 level3
```

---

## 6. REST API

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/apps/:appId/memories` | 获取应用级记忆列表 |
| GET | `/api/apps/:appId/memories?keyPrefix=user` | 按前缀过滤 |
| GET | `/api/apps/:appId/memories?tag=importance/high` | 按标签过滤 |
| DELETE | `/api/apps/:appId/memories/:entryId` | 删除一条记忆 |
| DELETE | `/api/apps/:appId/memories?tag=xxx` | 按标签批量删除 |
| GET | `/api/apps/:appId/memories/tags` | 获取所有标签 |
| GET | `/api/apps/:appId/memories/stats` | 获取统计 |
| GET | `/api/apps/:appId/conversations/:convId/memories` | 获取会话级记忆 |
| DELETE | `/api/apps/:appId/conversations/:convId/memories/:entryId` | 删除会话记忆 |
| GET | `/api/apps/:appId/conversations/:convId/goals` | 获取活跃目标树 |
| GET | `/api/apps/:appId/conversations/:convId/goals/archived` | 获取已归档目标 |

---

## 7. System Prompt 注入策略

### 7.1 注入位置

在 `buildSystemPrompt` 函数中，技能注入之后、返回之前注入记忆块。
目标树始终注入在记忆块最顶部，使用独立的格式化方法。

### 7.2 分级加载算法

```typescript
async buildMemoryBlock(appId: string, options?: {
  convId?: string;
  keyPrefix?: string;
  maxEntries?: number;
  minImportance?: 'low' | 'normal' | 'high';
}): Promise<string> {
  const maxEntries = options?.maxEntries ?? 30;
  let blocks: string[] = [];

  // 1. 始终注入活跃目标树（如果存在 convId）
  if (options?.convId) {
    const goals = await this.getActiveGoals(appId, options.convId);
    if (goals.level1 || goals.level2 || goals.level3) {
      let goalBlock = '\n## 当前目标\n';
      if (goals.level1) {
        goalBlock += `【一级目标】${goals.level1.value}\n`;
        if (goals.level2) {
          goalBlock += `  【二级目标】${goals.level2.value}\n`;
          if (goals.level3) {
            goalBlock += `    【三级目标】${goals.level3.value} ← 当前待办\n`;
          }
        }
      }
      blocks.push(goalBlock);
    }
  }

  // 2. 加载应用级记忆（按重要性排序）
  const allApp = await this.getAll('app', appId);
  const sorted = allApp
    .filter(e => {
      if (options?.keyPrefix && !e.key.startsWith(options.keyPrefix)) return false;
      if (options?.minImportance) {
        const levels = ['high', 'normal', 'low'];
        const minIdx = levels.indexOf(options.minImportance);
        const entryIdx = this.getImportanceLevel(e);
        if (entryIdx > minIdx) return false;
      }
      return true;
    })
    .sort((a, b) => this.getImportanceLevel(a) - this.getImportanceLevel(b)
      || b.updatedAt.localeCompare(a.updatedAt));

  const selected = sorted.slice(0, maxEntries);
  if (selected.length > 0) {
    blocks.push(formatMemoryBlock(selected));
  }

  // 3. 加载会话级记忆（不含 goal，goal 已在步骤 1 处理）
  if (options?.convId) {
    const allConv = await this.getAll('conversation', appId, options.convId);
    const convNonGoal = allConv
      .filter(e => e.type !== 'goal')
      .slice(0, 10);
    if (convNonGoal.length > 0) {
      blocks.push('\n## 会话上下文\n');
      for (const m of convNonGoal) {
        blocks.push(`- ${m.key}: ${m.value}${m.content ? ` — ${m.content}` : ''}\n`);
      }
    }
  }

  return blocks.join('\n') + '\n';
}
```

---

## 8. 注入可视化

### 8.1 注入标记系统

所有注入到 system prompt 的内容都需要在前端**对话界面的输入框上方**显示标记，标明当前 AI 拥有哪些上下文信息。

设计已在后端 `pi-agent-session.ts` 中实现了 `buildInjectionSummary` 函数和 `InjectionBlock` 接口：

```typescript
// pi-agent-session.ts 中已存在的接口
export interface InjectionBlock {
  source: 'app' | 'agents' | 'skills' | 'memory' | 'goal' | 'prompt';
  label: string;       // 显示标签，如"记忆"、"技能"、"目标"
  title: string;       // 标题，如"共 3 个技能"
  detail: string;      // 详细内容（供展开查看）
}
```

当前 `buildInjectionSummary` 已覆盖的来源：
| source | label | 说明 |
|--------|-------|------|
| `app` | 应用定义 | app.md 的内容 |
| `agents` | 可调用的 Agent | visibleApps 列表 |
| `skills` | 已加载的技能 | 用户勾选的技能 |
| `memory` | 记忆 | 应用级 + 会话级记忆 |

需要补充的来源：
| source | label | 说明 |
|--------|-------|------|
| `goal` | 当前目标 | 会话目标树（活跃） |
| `prompt` | 系统提示词 | 当前使用的 model + provider 信息 |

### 8.2 InjectionBlock 补充 goal 来源

在 `buildInjectionSummary` 中添加 goal 块：

```typescript
// 5. 当前目标（在 buildInjectionSummary 中添加）
if (convId) {
  try {
    const { memoryService } = await import('../services/memory.js');
    const goals = await memoryService.getActiveGoals(app.meta.id, convId);
    if (goals.level1 || goals.level2 || goals.level3) {
      let detail = '';
      if (goals.level1) detail += `【一级】${goals.level1.value}\n`;
      if (goals.level2) detail += `【二级】${goals.level2.value}\n`;
      if (goals.level3) detail += `【三级】${goals.level3.value}`;
      blocks.push({
        source: 'goal',
        label: '当前目标',
        title: goals.level3 ? '有活跃待办' : '有活跃目标',
        detail: detail.trim(),
      });
    }
  } catch {}
}
```

### 8.3 REST API 端点

需要添加一个 API 端点供前端查询注入摘要：

```
GET /api/apps/:appId/injections?convId=xxx
```

返回：
```json
{
  "blocks": [
    { "source": "app", "label": "应用定义", "title": "桌面助手", "detail": "..." },
    { "source": "skills", "label": "已加载的技能", "title": "共 2 个", "detail": "..." },
    { "source": "goal", "label": "当前目标", "title": "有活跃待办", "detail": "..." },
    { "source": "memory", "label": "记忆", "title": "应用级 5 条", "detail": "..." }
  ]
}
```

### 8.4 前端显示

#### 注入标记栏位置

在对话窗口的**输入框上方**，显示一排注入来源标记。每个标记是一个可点击的标签，点击展开查看详情。

```
┌────────────────────────────────────────┐
│  消息列表                              │
│  ...                                   │
├────────────────────────────────────────┤
│  📋 应用定义  🤖 可调用 Agent 2个       │  ← 注入标记栏
│  📚 技能 3个  🎯 有活跃待办  🧠 记忆5条  │
│  ┌─ 记忆详情 ─────────────────────┐    │
│  │ ## 长期记忆                    │    │  ← 展开详情浮层
│  │ - user.name: 小王              │    │
│  │ - project.tech: React          │    │
│  └────────────────────────────────┘    │
├────────────────────────────────────────┤
│  [输入框...]                   [发送]  │
└────────────────────────────────────────┘
```

#### 交互设计

1. **默认收起**：只显示一排小标签，每个标签显示图标 + 名称 + 数量
2. **点击标签**：在当前标签下方或侧边展开详情浮层，显示该来源的具体注入内容
3. **标签颜色**：不同 source 用不同颜色区分
   - `app` → 蓝色
   - `agents` → 紫色
   - `skills` → 绿色
   - `goal` → 橙色
   - `memory` → 青色
   - `prompt` → 灰色

#### 标签图标映射

```typescript
const SOURCE_ICONS: Record<string, string> = {
  app: '📋',
  agents: '🤖',
  skills: '📚',
  goal: '🎯',
  memory: '🧠',
  prompt: '⚙️',
};
```

#### 前端 API + 组件

在 `client/src/services/api.ts` 中添加：

```typescript
export interface InjectionBlock {
  source: string;
  label: string;
  title: string;
  detail: string;
}

export async function getInjections(appId: string, convId?: string): Promise<{ blocks: InjectionBlock[] }> {
  const params = convId ? `?convId=${convId}` : '';
  return fetchJson(`/apps/${appId}/injections${params}`);
}
```

创建新组件 `client/src/components/InjectionBar.tsx`：

```tsx
interface InjectionBarProps {
  appId: string;
  convId: string | null;
}

export function InjectionBar({ appId, convId }: InjectionBarProps) {
  const [blocks, setBlocks] = useState<InjectionBlock[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (!appId || !convId) return;
    api.getInjections(appId, convId).then(data => {
      setBlocks(data.blocks || []);
    }).catch(() => {});
  }, [appId, convId]);

  // 监听 agent 事件，完成后刷新
  // ...

  return (
    <div className="injection-bar">
      {blocks.map(block => (
        <div key={block.source} className="injection-tag">
          <span className="injection-icon">{SOURCE_ICONS[block.source] || '📎'}</span>
          <span className="injection-label">{block.label}</span>
          <span className="injection-count">{block.title}</span>
        </div>
      ))}
      {expanded && (
        <div className="injection-detail">
          <pre>{blocks.find(b => b.source === expanded)?.detail}</pre>
        </div>
      )}
    </div>
  );
}
```

在 `Window.tsx` 和 `StartMenu.tsx` 的输入框上方插入 `<InjectionBar>` 组件。

---

## 9. 实施计划

### Phase 1: 数据层（1-2 天）
- **任务 1**: 添加类型定义（MemoryEntry、GoalEntry 相关类型）
- **任务 2**: 创建 MemoryService（通用 CRUD + 标签/前缀/全文检索）
- **任务 3**: 实现 GoalService（目标树专用：setLevel1/2/3、complete、getActive、getArchived、归档级联）

### Phase 2: 工具层（1 天）
- **任务 4**: 注册 mcp.memory MCP 工具（含 setGoal/completeGoal/getActiveGoals/getArchivedGoals）
- **任务 5**: 在 system prompt 中注入记忆块和目标树

### Phase 3: 管理面（1 天）
- **任务 6**: REST API 路由
- **任务 7**: 前端记忆管理面板（含目标树可视化）
- **任务 8**: 为内置应用启用记忆工具

---

## 9. 边界情况与约束

### 9.1 记忆数量控制
- 应用级记忆上限：500 条（超出时裁剪最旧的 normal/low）
- 会话级记忆（非 goal）上限：100 条
- 目标树活跃条目始终 3 条（level1 + level2 + level3，各最多一条）
- 已归档目标无数量上限
- System prompt 注入上限：30 条应用级 + 10 条会话级 + 目标树（固定）
- 单条 value/content 长度上限：1000 字符

### 9.2 标签规范
- 标签格式：`category/subcategory`（小写英文，连字符分隔）
- 系统保留标签前缀：`importance/`、`source/`、`scope/`、`goal/`
- 用户自定义标签建议使用应用名作为前缀：`myapp/tagname`

### 9.3 并发安全
- 每次 save 增加 version 字段
- 写操作时比较 version，不匹配则重新加载（简单乐观锁）
- 单用户场景，不做复杂锁机制

### 9.4 过期清理
- 每次加载记忆时检查 ttl
- 过期的记忆在加载时自动删除

### 9.5 与其他系统的关系
- **Skill 系统**：技能是静态知识，记忆是动态上下文。技能在 prompt 头部，记忆在尾部。
- **Conversation 系统**：会话记录原始对话，记忆是提炼的精华摘要。
- **Workspace 系统**：工作目录是文件级上下文，记忆是语义级上下文。

---

## 10. 验证清单

- [ ] 应用级记忆跨会话持久化
- [ ] 会话级记忆仅在当前会话内
- [ ] 按 key 前缀分级加载（`user.` 加载所有用户相关）
- [ ] 标签过滤（AND 和 OR）
- [ ] 全文检索
- [ ] 重要性分级注入
- [ ] 自动过期清理
- [ ] **设置 level1 时 level2/level3 自动归档**
- [ ] **设置 level2 时 level3 自动归档**
- [ ] **已归档目标不在 prompt 中显示**
- [ ] **getArchivedGoals 能查询已归档目标**
- [ ] **完成目标后正确归档**
- [ ] 记忆数量上限控制
- [ ] REST API 正常工作
- [ ] 前端面板可查看和删除记忆
- [ ] Agent 能正确使用 mcp.memory 工具
