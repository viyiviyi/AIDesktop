# 前端组件指南

> 本文档描述前端各核心组件的职责、布局规范和交互说明。
> 对应实现：`client/src/components/`

---

## 1. 组件总览

| 组件 | 文件 | 职责 |
|------|------|------|
| Desktop | `Desktop.tsx` | 桌面背景、图标网格、应用启动入口 |
| Dock | `Dock.tsx` | 底部应用停靠栏，图标放大效果 |
| MenuBar | `MenuBar.tsx` | 顶部菜单栏，时间/状态显示 |
| StartMenu | `StartMenu.tsx` | 开始菜单，应用列表+对话面板 |
| Window | `Window.tsx` | 窗口管理，标题栏+内容区 |
| InjectionBar | `InjectionBar.tsx` | 状态标记栏（标题栏下方） |
| MarkdownView | `MarkdownView.tsx` | Markdown 渲染（GFM+代码高亮） |
| MemoryPanel | `MemoryPanel.tsx` | 记忆/目标管理面板 |
| LogPanel | `LogPanel.tsx` | 日志查看器 |
| AppSettingsWindow | `AppSettingsWindow.tsx` | 应用设置（多标签页） |
| SettingsMainWindow | `SettingsMainWindow.tsx` | 设置主页（应用列表） |
| AppManagerWindow | `AppManagerWindow.tsx` | 应用管理（查看详情/设置入口） |
| AppDetailWindow | `AppDetailWindow.tsx` | 应用详情展示 |
| AppModelConfig | `AppModelConfig.tsx` | 模型配置表单 |
| MediaSelector | `MediaSelector.tsx` | 媒体文件选择器 |
| FormComponent | `FormComponent.tsx` | 表单交互组件 |

---

## 2. 窗口布局规范

所有窗口类组件遵循统一布局：

```tsx
<div className="xxx-window">          // flex column, flex:1, overflow:hidden
  <div className="xxx-header">        // 标题栏，固定高度
  <div className="xxx-tabs">          // 标签页（可选）
  <div className="xxx-body">          // flex:1, overflow-y:auto, min-height:0
  <div className="xxx-footer">        // 底部按钮（可选）
```

### 应用设置窗口（AppSettingsWindow）标签页

| 标签页 | ID | 内容 |
|--------|----|------|
| 基本 | `basic` | 名称、描述、图标、启用状态 |
| 模型 | `model` | 模型选择 + 参数覆盖 |
| 工具 | `tools` | 内置/外部 MCP 工具勾选 |
| 技能 | `skills` | 已启用的公共技能勾选 |
| 权限 | `visibility` | 可见的 Agent/服务设置 |
| 提示 | `prompt` | app.md 编辑 |
| 记忆 | `memory` | 应用级记忆管理 |

### 会话标题栏按钮（从左到右）

`☰` 会话列表 | 会话标题 | 创建时间 | 工作目录 | `+` 新建 | `⚙️` 会话设置

---

## 3. InjectionBar 规范

- 位于标题栏和消息列表之间
- 每个 block 点击展开详情，详情内容使用 `MarkdownView` 渲染
- 颜色由 CSS class（`inj-app`/`inj-goal`/`inj-memory`）的 `--inj-color` 变量控制
- block 顺序：应用状态 → 记忆 → 会话目标
- 详情内容使用 Markdown 格式

---

## 4. 状态管理

使用 React Context + `useReducer`：

```typescript
// DesktopContext 提供
const { state, openApp, openSystemApp, closeWindow, focusWindow, ... } = useDesktop();

// 关键状态
state.settings          // 桌面设置
state.installedApps    // 已安装应用列表
state.windows          // 打开的窗口
state.focusedWindowId  // 焦点窗口 ID
state.startMenuOpen    // 开始菜单状态
```

---

## 5. 主题系统

见 `DEV_GUIDE.md` 第5章「主题系统与配色规范」。

关键点：
- 通过 `.theme-dark` / `.theme-light` class 切换
- 所有颜色使用 CSS 变量，禁止硬编码
- 变量定义在 `client/src/styles/global.css`

---

## 6. 关键交互

| 操作 | 行为 |
|------|------|
| 单击桌面图标 | 选中（高亮边框） |
| 双击桌面图标 | 启动应用 |
| 拖拽桌面图标 | 移动位置 |
| 单击 Dock 图标 | 启动/聚焦窗口 |
| 双击窗口标题栏 | 最大化/还原 |
| 拖拽窗口标题栏 | 移动窗口 |
| 拖拽窗口边缘 | 调整大小 |
| 单击开始按钮 | 滑出开始菜单 |
| 长按开始按钮(500ms) | 语音输入模式 |
