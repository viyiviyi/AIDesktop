# SQLite 会话存储方案

## 一、背景

当前会话使用 JSON 文件（`conversation.json`）存储，每次写入都需要**完整写回整个 JSON 文件**。随着消息增多（尤其是渲染引擎场景可能产生大量附件引用），性能瓶颈明显：

- 每次添加一条消息 → 完整写回数百 KB 甚至数 MB 的 JSON
- 无法增量更新
- 并发写入时有数据丢失风险

改用 SQLite 后，消息写入变为**单行 INSERT**，性能提升数个数量级。

## 二、存储架构

### 2.1 文件结构

```
{APPS_DATA_DIR}/{appId}/conversations/
  ├── {convFolder1}/          ← 会话文件夹（同现有）
  │   ├── conversation.db     ← SQLite 数据库（**新增**）
  │   └── attachments/        ← 附件目录（同现有）
  │       └── {uuid}.png
  ├── {convFolder2}/
  │   ├── conversation.db
  │   └── attachments/
  │       └── ...
  └── ...
```

**关键决策：**
- 每个应用使用独立的 SQLite 文件，放在该应用的 `conversations/` 目录下
- 不再使用 `conversation.json`
- 附件仍然是独立文件（同现有 `saveContentAttachments` 逻辑）
- 使用时才打开连接（`better-sqlite3` 或 `sql.js`），用完后关闭

### 2.2 为什么按应用分文件

- 管理方便：删除一个应用直接删整个目录
- 隔离性好：一个应用的数据损坏不影响其他应用
- 并发安全：不同的应用在不同的 DB 文件上操作，无锁竞争

---

## 三、数据库 Schema

```sql
-- 会话元数据表
CREATE TABLE conversations (
  id          TEXT PRIMARY KEY,           -- UUID
  title       TEXT NOT NULL DEFAULT '新会话',
  app_id      TEXT NOT NULL,              -- 应用 ID
  source      TEXT,                       -- 'user' | 'agent' | 'system'
  created_at  TEXT NOT NULL,              -- ISO 8601
  updated_at  TEXT NOT NULL,              -- ISO 8601
  status      TEXT DEFAULT 'active',      -- 'active' | 'form-pending'
  workspace_dir TEXT,                     -- 工作目录绝对路径
  -- call_chain 等复杂结构存为 JSON
  call_chain  TEXT,
  authorized_dirs TEXT,                   -- JSON array
  raw_data    TEXT                        -- 其他未来扩展字段（JSON object）
);

-- 消息表
CREATE TABLE messages (
  id          TEXT PRIMARY KEY,           -- UUID
  conv_id     TEXT NOT NULL,              -- 所属会话 ID
  role        TEXT NOT NULL,              -- 'user' | 'assistant' | 'system' | 'toolResult'
  content     TEXT NOT NULL,              -- JSON array: Content[]
  timestamp   TEXT NOT NULL,              -- ISO 8601
  reply_to    TEXT,                       -- 回复的消息 ID
  edited      INTEGER DEFAULT 0,          -- 0/1 是否已被编辑

  -- toolCall 相关
  tool_calls  TEXT,                       -- JSON array (toolCalls 字段)
  tool_call_id  TEXT,                     -- toolResult: 对应的 toolCall ID
  tool_name     TEXT,                     -- toolResult: 对应的 tool name
  is_error      INTEGER DEFAULT 0,        -- toolResult: 是否错误

  FOREIGN KEY (conv_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX idx_messages_conv_id ON messages(conv_id);
CREATE INDEX idx_messages_timestamp ON messages(conv_id, timestamp);

-- 附件表（记录附件与消息的关联）
CREATE TABLE attachments (
  id          TEXT PRIMARY KEY,           -- UUID
  conv_id     TEXT NOT NULL,              -- 所属会话
  message_id  TEXT,                       -- 所属消息（可为空）
  file_name   TEXT NOT NULL,              -- 存储在 attachments/ 中的文件名
  file_path   TEXT NOT NULL,              -- 相对路径（相对 conv 目录）
  mime_type   TEXT,
  file_size   INTEGER NOT NULL,           -- 文件大小（字节）
  original_name TEXT,                     -- 用户原始文件名
  created_at  TEXT NOT NULL,

  FOREIGN KEY (conv_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX idx_attachments_conv_id ON attachments(conv_id);
```

### 3.1 Schema 版本管理

```sql
CREATE TABLE _meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO _meta (key, value) VALUES ('schema_version', '1');
```

每个 DB 文件首次创建时写入 schema 版本，后续升级通过版本号做迁移。

---

## 四、附件存储规则

### 4.1 物理存储

```
{convFolder}/
  ├── conversation.db
  └── attachments/
      ├── {uuid}.png          ← 原始文件
      ├── {uuid}_thumb.png    ← 压缩后的缩略图（图片 > 10MB 时生成）
      └── ...
```

### 4.2 读取策略

| 文件大小 | 读取方式 |
|----------|----------|
| ≤ 10MB | 启动时读入内存缓存，后续从缓存返回 |
| > 10MB | 永远直接读取文件，不进内存缓存 |
| > 10MB 且为图片 | 生成压缩版（`_thumb`），缓存压缩版 |

### 4.3 压缩规则

- 图片 > 10MB → 压缩到最接近的 2MB 以下（保持宽高比）
- 压缩后的文件以 `_thumb` 后缀命名，存放在 `attachments/` 同一目录
- 压缩操作在附件保存时同步完成
- 非图片格式 > 10MB 的直接读取文件，不压缩

### 4.4 缓存生命周期

- 附件缓存与应用会话缓存生命周期一致
- 应用被卸载或会话被删除时，同时清除附件缓存
- 单个附件缓存占用 > 50MB 时，从缓存中驱逐

---

## 五、API 设计（兼容现有接口）

所有现有 `conversationService` 的方法签名**保持不变**，只改内部实现：

```typescript
class ConversationService {
  // 不变的方法签名
  async getConversations(appId: string): Promise<Conversation[]>
  async getConversation(appId: string, convId: string): Promise<Conversation | null>
  async createConversation(appId: string, title?: string, source?: ConversationSource, callChain?: any): Promise<Conversation>
  async addMessage(appId: string, convId: string, role: string, content: Content[], toolCalls?: any[], replyTo?: string): Promise<Message | null>
  async editMessage(appId: string, convId: string, msgId: string, content: Content[]): Promise<Message | null>
  async updateConversationTitle(appId: string, convId: string, title: string): Promise<boolean>
  async deleteConversation(appId: string, convId: string): Promise<boolean>
  async updateConversation(appId: string, convId: string, updates: Partial<Conversation>): Promise<boolean>
  async clearCache(appId?: string): void
  
  // 新增方法
  async addAttachment(appId: string, convId: string, fileInfo: AttachmentInfo): Promise<void>
  async getAttachment(appId: string, convId: string, attachmentId: string): Promise<AttachmentData | null>
}
```

### 5.1 关键转换逻辑

从数据库行到 `Conversation` / `Message` 对象的转换：

```typescript
function rowToConversation(row: any): Conversation {
  return {
    id: row.id,
    appId: row.app_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    source: row.source,
    status: row.status,
    workspaceDir: row.workspace_dir,
    callChain: row.call_chain ? JSON.parse(row.call_chain) : undefined,
    authorizedDirs: row.authorized_dirs ? JSON.parse(row.authorized_dirs) : undefined,
    // messages 单独从 messages 表查询
    messages: [],
  };
}

function rowToMessage(row: any): Message {
  return {
    id: row.id,
    role: row.role,
    content: JSON.parse(row.content),
    timestamp: row.timestamp,
    replyTo: row.reply_to,
    edited: !!row.edited,
    toolCalls: row.tool_calls ? JSON.parse(row.tool_calls) : undefined,
    toolResultMeta: row.tool_call_id ? {
      toolCallId: row.tool_call_id,
      toolName: row.tool_name,
      isError: !!row.is_error,
    } : undefined,
  };
}
```

---

## 六、缓存策略

### 6.1 两级缓存

```
请求 → 内存缓存 (Map<convId, Conversation>)
        ↓ 缓存未命中
      SQLite 查询
        ↓
      拼装 Conversation 对象（含消息列表）
        ↓
      写入缓存 ← 返回
```

### 6.2 写操作策略

```
addMessage / editMessage / updateConversation
  ↓
1. 修改内存缓存中的对象
2. INSERT/UPDATE SQLite（增量操作，不写全量）
  ↓
返回
```

内存缓存和数据库始终通过写操作保持同步。重启后缓存重建（从 SQLite 读取）。

### 6.3 缓存预热

- 启动时：按需加载（访问哪个会话才加载哪个）
- `getConversations(appId)`：仅加载会话列表（元数据，不含 messages），消息按需加载
- `getConversation(appId, convId)`：加载完整会话（元数据 + 消息列表）

---

## 七、迁移方案

### 7.1 从 JSON 迁移到 SQLite

```typescript
async function migrateApp(appId: string): Promise<void> {
  const convDir = getConversationsDir(appId);
  const entries = await readDir(convDir);
  
  for (const entry of entries) {
    const jsonPath = path.join(convDir, entry, 'conversation.json');
    try {
      const jsonData = JSON.parse(await fs.readFile(jsonPath, 'utf-8'));
      
      // 1. 打开该应用的 SQLite（如不存在则创建）
      const db = openAppDatabase(appId);
      
      // 2. 插入 conversation
      db.run(`INSERT OR IGNORE INTO conversations (...) VALUES (...)`, ...);
      
      // 3. 逐条插入 messages
      for (const msg of jsonData.messages) {
        db.run(`INSERT INTO messages (...) VALUES (...)`, ...);
      }
      
      // 4. 扫描 attachments 目录，插入 attachment 记录
      // ...
      
      // 5. 迁移完成后重命名 conversation.json -> conversation.json.bak
      await fs.rename(jsonPath, jsonPath + '.bak');
      
    } catch { /* 跳过无法解析的 */ }
  }
}
```

### 7.2 兼容旧格式

- 启动时检测：如果 `{APPS_DATA_DIR}/{appId}/conversations/` 下存在 `conversation.json` 格式的旧数据，触发迁移
- 整个迁移过程在启动时异步完成，不阻塞服务启动
- 迁移完成后，旧文件重命名为 `.bak` 后缀，用户可以手动删除

---

## 八、性能预期

| 操作 | JSON 方案 | SQLite 方案 | 提升 |
|------|-----------|-------------|------|
| 添加一条消息 | 完整写回文件 (O(n)) | INSERT 一行 (O(1)) | 10-100x |
| 加载会话 (100条消息) | 完整读文件解析 | SELECT 100 rows | 相当 |
| 加载会话 (10000条消息) | 完整读文件解析 ~5MB | SELECT + 按需加载 | 5-10x |
| 编辑单条消息 | 完整写回文件 | UPDATE 一行 | 100x+ |
| 并发写入 | 有竞争风险 | SQLite WAL 模式安全 | 可靠 |
| 批量删除消息 | 完整写回文件 | DELETE + VACUUM | 100x+ |

---

## 九、注意事项

### 9.1 SQLite 配置
- 使用 **WAL 模式**（Write-Ahead Logging）提升并发读性能
- 同步模式设为 NORMAL（平衡性能与安全性）
- 每个应用的数据库连接在使用时打开，用完后关闭（`better-sqlite3` 支持同步操作，适合非高频场景）

### 9.2 数据安全
- 每条写入后执行 `PRAGMA wal_checkpoint` 确保数据落盘（可选）
- 数据库文件损坏时可从 WAL 文件恢复
- 附件文件独立存储，不依赖数据库完整性

### 9.3 会话文件夹名
同现有规则：`{yyyyMMddHHmmss}` 格式，根据 `createdAt` 生成。迁移时沿用已有文件夹名。

### 9.4 与现有路由的兼容性
所有引用 `conversationService` 的路由和 MCP 服务完全不需要修改——接口签名不变，内部实现替换。

涉及的文件（只需改内部实现）：
- `server/src/services/conversation.ts` ← 主要修改文件
- 其他所有 `conversationService.xxx()` 调用方 ← **不需要改**
