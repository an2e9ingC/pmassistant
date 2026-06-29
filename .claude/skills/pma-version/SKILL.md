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

## 开发调试阶段

**每次修改代码前**，先更新 `frontend/index.html` 中 `#app-version` 的版本号。文档中的版本号在调试阶段不更新。

## Commit 前

1. `docs/dev-plan.md`：版本历史表追加新条目 + 页头版本号**同步为 `#app-version` 的当前值**
2. `frontend/index.html`：已在调试阶段更新，commit 时如果本轮有多次修改可能已经是最新

**重要**：commit 时 `docs/dev-plan.md` 直接取 `#app-version` 的值，**无需再 +1**。因此文档版本记录可以是**非连续的**（跳过的 beta 号对应中间调试版本）。

```
修改代码前：  index.html    v2026.06.29-beta1 → v2026.06.29-beta2
             dev-plan.md   不变

commit 时：   dev-plan.md   同步为 v2026.06.29-beta2（不再 +1）
```

## 同步更新检查清单

| 文件 | 更新时机 |
|------|---------|
| `frontend/index.html#app-version` | **每次修改代码前** |
| `docs/dev-plan.md` | commit 时同步（取 #app-version 值，不额外 +1） |
| `docs/design-spec.md` | 新增 UI 组件/设计模式 |
| `docs/deploy-guide.md` | 新增路由/配置/运维操作 |
| `docs/db.md` | 数据层变更 |
