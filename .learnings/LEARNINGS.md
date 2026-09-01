## [LRN-20260901-001] task_review

**Priority**: medium
**Status**: resolved
**Area**: tools

### 内容
同一个外部接口在 Node 中返回 200 不代表前端可用；浏览器会额外执行 CORS 校验，重复的 `Access-Control-Allow-Origin` 头会让响应变成不可读。RSS 排查应同时验证浏览器网络事件和最终 UI，不要只验证服务端响应码。

### 建议修复
对本地静态/Vite 页面，优先使用现有开发服务器的同源代理；对部署版本则提供等价的服务端代理或确认源站返回合法的单一 CORS 头。

### 元数据
- Source: task_review
- See Also: none

---
