# AIDesktop 文档索引

> 项目根文档：[`README.md`](../README.md)

本目录包含 AIDesktop 项目的全部技术文档。按用途分为以下类别：

---

## 📖 文档目录

### 🧭 阅读指引

| 角色 | 推荐阅读路径 |
|------|-------------|
| **新开发者** | 产品规格 → 开发指南 → API 文档 → 数据模型 |
| **日常维护** | 开发指南 → 实现细节 → MCP 开发指南 |
| **扩展功能** | 实现细节 → 组件指南 → MCP 开发指南 |

---

### 1. 产品与架构

| 文件名 | 状态 | 行数 | 简介 |
|--------|------|------|------|
| [`SPEC.md`](SPEC.md) | ✅ 当前 | 323 | 产品设计规格书：架构图、技术栈、路由总览、安全权限、内置应用、v2 技能系统设计 |
| [`api-spec.md`](api-spec.md) | ✅ 当前 | 224 | API 接口完整定义：10 大模块、所有路由方法、请求/响应示例 |
| [`data-model.md`](data-model.md) | ✅ 当前 | 274 | 数据模型定义：meta.json、config.json、消息类型、记忆条目全部 TypeScript 接口 |
| [`component-guide.md`](component-guide.md) | ✅ 当前 | 112 | 前端组件职责表、窗口布局规范、状态管理、主题系统、交互行为 |
| [`implementation-details.md`](implementation-details.md) | ✅ 当前 | 215 | 实现细节：Agent 会话流程、System Prompt 构建、MCP 工具列表、记忆系统、构建与部署 |

### 2. 开发维护

| 文件名 | 状态 | 行数 | 简介 |
|--------|------|------|------|
| [`dev/DEV_GUIDE.md`](dev/DEV_GUIDE.md) | ✅ **当前** | 776 | **主开发指南**：项目结构、数据架构、Agent/MCP/工具系统详解、前端架构、主题、构建部署、常见问题 |
| [`MCP-开发指南.md`](MCP-开发指南.md) | ✅ 当前 | 332 | MCP 服务开发：内置/外部服务注册、传输协议配置、工具命名规范、认证支持 |
| [`dev/重构系统内置工具.md`](dev/重构系统内置工具.md) | 🟡 规划 | 71 | 系统内置工具重构规划：四层工具分类、权限模型 |

### 3. 规划与设计

| 文件名 | 状态 | 行数 | 简介 |
|--------|------|------|------|
| [`plans/agent-auth-persistence.md`](plans/agent-auth-persistence.md) | 🟡 规划 | 70 | Agent 授权中断与消息持久化方案 |
| [`plans/workspace-auth-system.md`](plans/workspace-auth-system.md) | 🟡 规划 | 60 | 工作目录授权系统方案 |

### 4. 服务器端设计文档

以下文档位于 `server/docs/` 目录，涉及服务端内部设计细节：

| 文件名 | 行数 | 简介 |
|--------|------|------|
| [`../server/docs/表单设计.md`](../server/docs/表单设计.md) | 254 | 表单交互详细设计：5 种方案对比、EventBus 事件、前端渲染 |
| [`../server/docs/媒体管理设计.md`](../server/docs/媒体管理设计.md) | 80 | 应用图标/背景图管理：存储路径、API、前端交互 |
| [`../server/docs/工作目录设计.md`](../server/docs/工作目录设计.md) | 100 | 工作目录与会话工作工具设计 |
| [`../server/docs/表单.md`](../server/docs/表单.md) | 80 | 表单交互需求文档 |

---

## 📊 文档覆盖度

| 领域 | 覆盖状态 | 说明 |
|------|---------|------|
| 产品设计规格 | ⭐⭐⭐⭐⭐ | SPEC.md 完整覆盖 |
| API 接口定义 | ⭐⭐⭐⭐⭐ | api-spec.md 10 模块完整 |
| 数据模型 | ⭐⭐⭐⭐⭐ | data-model.md 所有类型 |
| 开发维护 | ⭐⭐⭐⭐⭐ | dev/DEV_GUIDE.md（776 行最完善） |
| 前端组件 | ⭐⭐⭐⭐ | component-guide.md 完整 |
| MCP 开发 | ⭐⭐⭐⭐ | MCP-开发指南.md 已补充 |
| 贡献指南 | ❌ 缺失 | — |
| 架构决策记录 (ADR) | ❌ 缺失 | — |
| 用户使用手册 | ❌ 缺失 | — |
| 安全指南 | ❌ 缺失 | — |

---

## 🔗 快捷链接

- [项目首页](../README.md)
- [产品规格书](SPEC.md)
- [开发指南（新版）](dev/DEV_GUIDE.md)
- [API 文档](api-spec.md)
- [MCP 开发指南](MCP-开发指南.md)
- [前端组件指南](component-guide.md)
- [数据模型](data-model.md)
- [实现细节](implementation-details.md)
