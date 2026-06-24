---
name: pma-version
description: PMA 版本号管理 — vYYYY.MM.DD-betaN 格式、dev-plan.md + index.html 同步更新
user-invocable: true
allowed-tools: Read, Write, Edit, Bash
---

# 版本号管理

## 格式

`vYYYY.MM.DD-betaN`（开发） / `vYYYY.MM.DD`（发布）

- 日期部分用**当天实际日期**
- 同一天内 beta 递增（beta1, beta2, ...）
- 跨天重置 beta 为 1

## Commit 前必须更新

1. `docs/dev-plan.md`：版本历史表追加新条目 + 页头版本号
2. `frontend/index.html`：`#app-version` 改为相同版本号

**先更新版本，再 commit，不可事后补。**

## 同步更新检查清单

| 文件 | 更新时机 |
|------|---------|
| `docs/dev-plan.md` | 每次 commit |
| `frontend/index.html#app-version` | 每次 commit |
| `docs/design-spec.md` | 新增 UI 组件/设计模式 |
| `docs/deploy-guide.md` | 新增路由/配置/运维操作 |
| `docs/db.md` | 数据层变更 |
