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
