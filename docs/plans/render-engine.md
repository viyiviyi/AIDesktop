# 渲染引擎（Render Engine）设计方案

## 一、概述

### 1.1 目标

为 AI Agent 增加**视觉交互层**，使 AI 在对话之外，还可以通过 Canvas 渲染浮层的方式，向用户展示交互式视觉界面。对话是主交互方式（元层），视觉渲染作为辅助交互层，两者互补。

### 1.2 解决的问题

- 当前 AI 只能通过文字描述"界面上有什么"，用户需要在脑中想象
- 复杂信息（图表、布局、流程）用文字表达效率低、不直观
- AI 无法在对话中"画出来"供用户直接操作

### 1.3 核心原则

- **不改变现有架构** — 所有新增代码独立于现有功能，默认不启用
- **对话为主，渲染为辅** — 渲染层浮动在对话之上，输入框始终可见
- **渲染即用即弃** — 每次渲染独立，不污染对话历史
- **纯 Canvas 渲染** — 不依赖 DOM，所有 UI 元素在 Canvas 上绘制
- **⚡ 画面内容绝不进入会话历史** — 渲染定义、渲染状态文本化描述、用户交互记录，都**只存在于当前单次 AI 调用的 prompt 中**，写入 conversation.json 的 messages 数组、持久化缓存、历史加载等任何环节都不能包含渲染内容。这是为了**避免渲染数据（可能是大量坐标、文本、配置）长期占用 AI 上下文窗口**。

---

## 二、交互模型

### 2.1 会话流程

```
用户: "帮我查北京的天气"
AI:   "好的，我渲染一个天气面板给你"
  → AI 调用 mcp.render.render(uiDefinition)
  → 后端通过 WebSocket 推送渲染数据到前端
  → Canvas 浮层渲染出天气面板
  → 工具返回 _skip=true，AI 暂停等待
  → 用户在 Canvas 上点击"查看7天"按钮
  → 天气面板更新为7天预报
  → 用户点"继续"按钮 或 在聊天输入框发新消息
  → 渲染状态文本化描述注入到 AI prompt 末尾
  → AI 恢复，继续对话
```

### 2.2 渲染浮层层级

```
┌──────────────────────────────────────────┐
│  聊天窗口 (ChatApp)                       │
│  ┌────────────────────────────────────┐  │
│  │  消息列表                           │  │
│  │  用户: 帮我查北京的天气              │  │
│  │  AI:   好的，我渲染一个天气面板      │  │
│  └────────────────────────────────────┘  │
│  ┌────────────────────────────────────┐  │
│  │  Canvas 浮层 (透明背景)            │  │  ← z-index 高于消息区
│  │  ┌──────────────┐                 │  │
│  │  │  ☀️ 北京 25°C │                 │  │
│  │  │  晴  湿度40%  │                 │  │
│  │  │  [查看7天]    │                 │  │
│  │  │    [继续 ▼]   │                 │  │
│  │  └──────────────┘                 │  │
│  └────────────────────────────────────┘  │
│  ┌────────────────────────────────────┐  │
│  │  输入框 (位于 Canvas 之上)          │  │  ← z-index 最高
│  └────────────────────────────────────┘  │
└──────────────────────────────────────────┘
```

### 2.4 交互场景

| 场景 | 行为 |
|------|------|
| AI 调用 render() | Canvas 浮层显示渲染内容，AI 暂停 |
| 用户点击 Canvas 上元素 | 元素响应（如按钮高亮），触发定义的回调 |
| 用户点"继续"按钮 | 生成渲染状态文本 → 注入 prompt → 恢复 AI |
| 用户在输入框打字 + 发送 | 用户输入在前，渲染状态在后，一起注入 |
| 用户点"继续"后又调用 render() | 新的渲染覆盖旧的，重新进入等待 |
| 用户关闭浮层（X 按钮） | 不触发 AI 继续，仅清除渲染 |

### 2.5 复用现有"继续"按钮

不新增 Canvas 上的"继续"按钮。用户通过以下方式唤回 AI：

| 方式 | 说明 |
|------|------|
| 点击聊天输入框旁的**已有的"继续"按钮** | 生成渲染状态文本 → 注入 prompt → 恢复 AI |
| 在聊天输入框输入新消息并发送 | 用户输入在前，渲染状态在后，一起注入 |

> 现有的 `/api/apps/:appId/conversations/:convId/continue` 接口改造为**可选携带渲染状态文本**：如果当前有活跃渲染浮层，继续时自动附加 `[Render UI State]`。

### 2.6 多模态输入附带文件路径

当用户发送多模态内容（图片、音频、视频）时，AI 的 render 工具可能需要读取这些文件来渲染。

**现有流程改造**：`saveContentAttachments()` 在保存附件到会话附件目录后，除了返回 URL，还需要**额外附带本地文件路径**：

```typescript
// 现有返回值
{ type: 'image', url: '/api/files/appId/conversations/20260709/uuid.png' }

// 新返回值（兼容现有 + 新增 path）
{ 
  type: 'image', 
  url: '/api/files/appId/conversations/20260709/uuid.png',
  path: '/mnt/c/apps/AIDesktop/server/desktop_data/apps_data/appId/conversations/20260709/attachments/uuid.png'
}
```

> `path` 字段提供给 Canvas 渲染引擎直接从本地文件系统读取文件，避免通过 HTTP 传输大文件。

### 2.7 附件存储规范

所有会话附件统一存储在会话附件目录：

```
{APPS_DATA_DIR}/{appId}/conversations/{convFolder}/attachments/
```

这个目录既是 HTTP 服务端静态文件的来源（通过 `/api/files/`），也是 Canvas 渲染引擎本地读取的来源。渲染引擎读取文件时通过 `path` 字段直接访问本地文件系统。

---

## 三、MCP 工具定义

### 3.1 服务注册

```typescript
// 在 mcp/service.ts 中的 builtInServices 新增
'mcp.render': {
  name: 'mcp.render',
  description: '渲染引擎 - 在用户界面上渲染交互式视觉浮层。支持图文、按钮、输入框、2D动画',
  methods: ['render', 'update', 'close'],
  category: 'feature',  // 需要用户在应用设置中勾选
}
```

### 3.2 工具方法

#### render(uiDefinition) → { _skip: true }

渲染一个交互界面到 Canvas 浮层。

**参数：uiDefinition**

```typescript
interface RenderDefinition {
  /** 渲染画布尺寸（相对窗口的百分比或 px） */
  width?: number | string;   // 默认 100%
  height?: number | string;  // 默认 auto
  /** 水平/垂直偏移（相对窗口左上角，px） */
  x?: number;  // 默认 0
  y?: number;  // 默认 0
  /** 背景透明度 0-1 */
  opacity?: number;  // 默认 0.9
  /** UI 元素列表 */
  elements: RenderElement[];
  /** 默认交互触发器（用户点击这些元素会触发继续，而不需要点"继续"按钮） */
  triggerEvents?: string[];
}

type RenderElementType = 
  | 'text'      // 文本标签
  | 'rect'      // 矩形/圆角矩形
  | 'circle'    // 圆形
  | 'image'     // 图片（URL/base64）
  | 'input'     // 文本输入框
  | 'button'    // 可点击按钮
  | 'progress'  // 进度条
  | 'divider'   // 分割线
  | 'list';     // 列表

interface RenderElement {
  id: string;           // 元素唯一 ID，用于交互回传和 update
  type: RenderElementType;
  /** 位置和尺寸（相对于画布左上角） */
  x: number;            // 中心 x 或左上角 x
  y: number;            // 中心 y 或左上角 y
  width?: number;       // 宽度
  height?: number;      // 高度
  /** 文本内容（text/button/input 等用到） */
  text?: string;
  /** 文本大小 */
  fontSize?: number;    // 默认 14
  /** 文本对齐 */
  textAlign?: 'left' | 'center' | 'right';
  /** 圆角（rect/button） */
  borderRadius?: number;
  /** 颜色 */
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  /** 字体颜色 */
  textColor?: string;
  
  // 输入框特有
  placeholder?: string;
  inputType?: 'text' | 'number' | 'password';
  
  // 图片特有
  imageUrl?: string;
  
  // 列表特有
  items?: string[];
  
  // 动画
  animation?: {
    type: 'fadeIn' | 'slideIn' | 'pulse' | 'bounce' | 'typewriter';
    duration: number;    // 毫秒
    delay?: number;      // 毫秒
    easing?: string;
  };
  
  // 子元素（用于分组/容器）
  children?: RenderElement[];
  
  // 交互触发器（点击此元素是否触发继续）
  triggerOnClick?: boolean;
}
```

**返回值：**
```json
{ "_skip": true }
```

#### update(uiId, diff) → { success: true }

增量更新已渲染的界面。用于动画状态变化或数据更新。

**参数：**

```typescript
interface RenderUpdate {
  uiId: string;              // render 返回的 uiId
  updates: Array<{
    id: string;               // 元素 ID
    text?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    fillColor?: string;
    textColor?: string;
    visible?: boolean;
    animation?: RenderElement['animation'];
  }>;
}
```

#### close(uiId) → { success: true }

关闭渲染浮层。

---

## 四、前端 Canvas 渲染引擎

### 4.1 组件架构

```
client/src/components/
├── RenderOverlay.tsx          ← Canvas 浮层入口组件
├── RenderCanvas.tsx           ← 纯 Canvas 渲染核心
├── RenderInteraction.tsx      ← 交互事件处理（点击检测、键盘输入）
└── RenderStateManager.ts      ← 渲染状态管理（文本化描述生成）
```

### 4.2 Canvas 绘制流程

```
1. 接收 WebSocket 推送的 RenderDefinition
2. 创建/调整 Canvas 尺寸和位置（根据 width/height/x/y）
3. 遍历 elements 树，按层绘制：
   - 先绘制容器/背景层（rect, circle, divider）
   - 再绘制内容层（text, image, progress, list）
   - 最后绘制交互层（button, input）— 交互层在最上
4. 注册元素热区（用于点击检测）
5. 启动动画循环（requestAnimationFrame）
6. 在 Canvas 右下角/左下角绘制"继续"按钮（始终在最上层）
```

### 4.3 点击检测算法

```
1. 监听 Canvas 的 click 事件
2. 获取点击坐标 (clientX, clientY)
3. 从 elements 数组中从后往前遍历（上层优先）
4. 对每个 button / triggerOnClick 元素：
   - 检测坐标是否在元素的矩形区域内
   - 如果在，触发对应的交互回调
5. 如果点击在"继续"按钮区域 → 触发生成状态文本 + 恢复 AI
6. 如果点击在输入框区域 → 聚焦输入框，启动键盘捕获
```

### 4.4 键盘输入处理

```
1. 用户点击 Canvas 上的 input 元素 → 聚焦
2. 组件监听键盘事件（keydown/keyup）
3. 文本在 Canvas 上实时绘制（闪烁光标）
4. Enter 键 → 提交输入（触发 input 的提交回调）
5. 点击其他区域 → 失焦
```

### 4.5 动画实现

```typescript
// requestAnimationFrame 循环
function animate(timestamp: number) {
  for (const el of elements) {
    if (el.animation) {
      const progress = (timestamp - el.animation.startTime) / el.animation.duration;
      if (progress >= 1) {
        el._animComplete = true;
        continue;
      }
      switch (el.animation.type) {
        case 'fadeIn':
          ctx.globalAlpha = easeInOut(progress);
          break;
        case 'slideIn':
          const offset = (1 - easeOut(progress)) * 100;
          // 从右侧滑入
          break;
        // ...
      }
    }
  }
  renderFrame();
  requestAnimationFrame(animate);
}
```

---

## 五、上下文注入逻辑

### 5.1 文本化描述生成

当用户点"继续"或发送新消息时，前端/后端生成以下格式的文本：

```
[Render UI State]
- [容器] 天气面板 (x:100,y:50,w:300,h:400)
  - [文本] 标题: "北京天气" (x:150,y:80)
  - [文本] 温度: "25°C" (x:150,y:120)
  - [按钮] "查看7天" (x:150,y:300) [未点击]
  - [输入框] 城市输入: (x:100,y:350) [用户输入: "上海"]
  - [按钮] "搜索" (x:250,y:350) [已点击]
- 用户操作: 点击了"搜索"按钮, 输入了"上海"
```

**生成逻辑**：遍历当前 Canvas 上的所有元素，输出每个元素的位置、文本内容和用户操作记录。

### 5.2 注入位置

```
用户输入（如有）
---
[Render UI State]
...
---
// AI 继续生成回复
```

- 如果用户在聊天输入框发了新消息 → 用户消息在前，渲染状态在后
- 如果用户只点了"继续"按钮 → 仅注入渲染状态

### 5.3 不保存到会话历史

渲染状态文本 **只存在于单次 AI 调用的 prompt 中**，写入 conversation.json 的 messages 数组、持久化缓存、历史加载等任何环节都不能包含渲染内容。

### 5.4 安全保障：代码层面防止误保存

以下这些地方都需加防护逻辑，防止渲染内容意外混入：

| 环节 | 防护措施 |
|------|----------|
| `conversationService.addMessage()` | 如果 content 中包含 `_renderContext` 标记，拒绝写入 |
| `conversationService.getConversation()` | 返回前过滤掉所有 `_renderContext` 标记内容 |
| `runAgentAsync()` | 渲染状态文本通过独立参数传递，不入 messages 数组 |
| WebSocket 推送 | 渲染事件和消息事件分离，前端分别处理 |
| 前端 `loadMessages()` | 加载消息时过滤掉渲染相关的临时数据 |

> ⚠️ 这一条是硬性约束：如果实现后发现渲染内容出现在了会话 JSON 文件里，视为实现错误，需要立即修复。

---

## 六、后端实现

### 6.1 MCP Service 新增

**文件：** `server/src/mcp/renderService.ts`

```typescript
class RenderService {
  private activeRenders = new Map<string, RenderSession>();
  
  async handleRender(
    args: RenderDefinition,
    context: { appId?: string; convId?: string }
  ): Promise<{ _skip: true }> {
    const uiId = uuidv4();
    const session: RenderSession = {
      uiId,
      definition: args,
      createdAt: Date.now(),
      interactions: [],
    };
    this.activeRenders.set(`${context.appId}:${context.convId}`, session);
    
    // 通过 EventBus 推送到前端
    eventBus.emit({
      type: 'render_ui',
      appId: context.appId!,
      convId: context.convId!,
      data: { uiId, definition: args },
    });
    
    return { _skip: true };
  }
}
```

### 6.2 EventBus 新增事件类型

```typescript
// eventBus.ts 新增
type ConvEventType = 
  // ... 现有 ...
  | 'render_ui'         // AI 渲染界面
  | 'render_update'     // 增量更新
  | 'render_close'      // 关闭渲染
  | 'render_interaction' // 用户交互（点继续/点击元素）
  | 'render_state';     // 渲染状态文本化描述
```

### 6.3 路由新增

**`POST /:convId/render-continue`** — 渲染层"继续"按钮触发

与现有的 `/continue` 类似，但额外携带渲染状态文本：
- 生成 `[Render UI State]` 文本块
- 如果是用户新消息 + 渲染继续 → 组合注入
- 调用 `runAgentAsync` 恢复 AI

---

## 七、配置开关

### 7.1 应用 meta 配置

在应用的 `app.md` 或 `meta.tools` 中新增 `mcp.render`：

```json
{
  "tools": ["mcp.render"]
}
```

### 7.2 应用设置 UI

在 `AppSettingsWindow.tsx` 中的工具列表里，`mcp.render` 作为一个可勾选的工具：
- 勾选后，AI 才可以使用 render 工具
- 默认不勾选

### 7.3 实现方式

在 `pi-tools.ts` 中 `buildPiToolsForApp` 会检查应用配置中的 tools 列表，如果包含 `mcp.render`，才在 tool definition 中包含 render 工具。与现有工具（如 `mcp.browser`、`mcp.form`）的条件注入机制完全一致。

---

## 八、实现计划

### Phase 1：基础架构
- [ ] 新建 `renderService.ts` — MCP 服务注册
- [ ] 新增 EventBus 事件类型
- [ ] `RenderOverlay.tsx` — Canvas 浮层组件骨架
- [ ] `RenderCanvas.tsx` — 基础元素渲染（text, rect, circle, divider）
- [ ] 工具开关配置

### Phase 2：交互能力
- [ ] `RenderInteraction.tsx` — 点击检测和事件处理
- [ ] Canvas 内输入框支持（键盘捕获、光标绘制）
- [ ] "继续"按钮常驻渲染

### Phase 3：高级能力
- [ ] 2D 动画系统（fadeIn, slideIn, pulse, typewriter）
- [ ] `update()` 增量更新
- [ ] 图片渲染（URL/base64）
- [ ] 列表、进度条等复杂元素

### Phase 4：上下文注入
- [ ] 文本化描述生成器
- [ ] 注入逻辑（prompt 末尾、用户输入前后）
- [ ] render-continue 路由
- [ ] 不保存到会话历史的保障

### Phase 5：完善
- [ ] 多个渲染窗口管理
- [ ] 渲染性能优化
- [ ] 动画性能调优
- [ ] 错误处理

---

## 九、注意事项

### 9.1 不与现有功能冲突
- Canvas 浮层使用独立的 React portal，不侵入 ChatApp 现有组件
- Canvas 的 z-index 高于消息区但低于输入框
- 渲染只影响视觉，不影响对话状态机

### 9.2 安全性
- 渲染引擎不执行任意 JavaScript
- 所有渲染内容由 AI 通过 MCP 工具定义，经过服务端校验
- 图片 URL 限制为安全来源

### 9.3 性能
- Canvas 只重新绘制变化的区域（脏矩形）
- 动画帧率自适应（60fps / 30fps 根据性能降级）
- 大文本渲染限制长度

### 9.4 用户控制
- 用户可以随时关闭渲染浮层（× 按钮或 Canvas 外点击）
- 用户可以在输入框打字并发送，覆盖渲染继续
- "继续"按钮永远存在，不会被其他元素遮挡
