# 工作目录授权系统实现方案

## 需求

1. 工具标记需要工作目录 + 标记哪些参数字段访问工作目录
2. 首次使用时，路径不在工作目录内或无工作目录时，弹出授权框
3. 用户取消 → 中断调用（无返回内容）
4. 用户设置工作目录 → 继续执行
5. 路径在工作目录内 → 直接执行
6. 路径不在工作目录内 → 弹出授权请求，拒绝时返回"拒绝"结果且不停止 agent 流程
7. 会话标题栏显示工作目录，可点击更改
8. 支持授权多个访问目录，但只有一个工作目录

## 涉及文件

- `server/src/types/index.ts` — MCPService 加 `workspaceFields` 属性
- `server/src/mcp/service.ts` — 添加目录校验 + 授权逻辑
- `server/src/agents/pi-tools.ts` — workspace 工具区分拒绝式/中断式
- `server/src/routes/conversations.ts` — workspace 授权路由
- `client/src/components/Window.tsx` — 工作目录显示/点击更改
