## [ERR-20260827-001] npm Sites 适配插件安装

**Priority**: medium
**Status**: resolved
**Area**: tools

### 摘要
安装 `@openai/sites-vite-plugin@0.2.0` 时，现有 `vite@7.0.6` 不满足插件要求的 `vite@^8.0.0` peer dependency，npm 以 `ERESOLVE` 终止。

### 错误信息
```text
ERESOLVE unable to resolve dependency tree
Could not resolve dependency: peer vite@"^8.0.0" from @openai/sites-vite-plugin@0.2.0
```

### 上下文
- 在 `daily-workbench` 项目中为 Sites 部署适配安装插件。
- 使用项目内 npm cache，未使用 `--force` 或 `--legacy-peer-deps`。

### 建议修复
先将 Vite 升级到满足插件 peer dependency 的兼容版本，再安装 Sites 插件并重新执行构建验证。

### 元数据
- Reproducible: yes
- See Also: none

---

## [ERR-20260901-001] 知乎热榜接口跨域响应头重复

**Priority**: medium
**Status**: resolved
**Area**: tools

### 摘要
知乎热榜接口返回重复的 `Access-Control-Allow-Origin` 值，Node 请求可读，但浏览器以 `MultipleAllowOriginValues` 拒绝跨域响应。

### 错误信息
```text
net::ERR_FAILED
corsError: MultipleAllowOriginValues
failedParameter: *, *
```

### 上下文
- RSS 默认源改为知乎热榜接口后，在本地 Vite 页面中加载失败。
- 通过浏览器网络事件确认失败发生在 CORS 校验，而不是 JSON 内容解析。

### 建议修复
本地开发使用 Vite 同源代理转发接口，并在前端兼容接口的 JSON 热榜列表；不要只用 Node `fetch` 结果判断浏览器可用性。

### 元数据
- Reproducible: yes
- See Also: none

---
