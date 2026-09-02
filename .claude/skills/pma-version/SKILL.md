---
name: pma-version
description: PMA 版本号管理 — vYYYY.MM.DD-betaN 格式、dev-plan.md + index.html 同步更新
user-invocable: true
allowed-tools: Read, Write, Edit, Bash
---

# 版本号管理

## 格式

`vYYYY.MM.DD-betaN`（开发） / `vYYYY.MM.DD`（发布）

- 日期部分用**当天实际日期** —— 必须用**实时**获取：`TODAY=$(TZ=Asia/Shanghai date '+%Y-%m-%d')`。**严禁用上下文 / 记忆 / 上一次记录里的日期**（系统时间可能漂移，如曾出现 08-19 → 08-21 → 08-24 错用）。
- 同一天内 beta 递增（beta1, beta2, ...）
- 跨天重置 beta 为 1

## 开发调试阶段

**每次修改代码前**，先更新 `frontend/index.html` 中 `#app-version` 的版本号。文档中的版本号在调试阶段不更新。

## Commit 前

1. `docs/dev-plan.md`：版本历史表追加新条目 + 页头版本号**同步为 `#app-version` 的当前值**
   > **新条目说明列 = 一句话用户可见描述**（版本历史会提供给用户），只写「解决了什么问题/新增了什么功能」，禁止 ①②③ 罗列与实现细节。详见 pma-commit 规范。
2. `frontend/index.html`：已在调试阶段更新，commit 时如果本轮有多次修改可能已经是最新

**重要**：commit 时 `docs/dev-plan.md` 直接取 `#app-version` 的值，**无需再 +1**。因此文档版本记录可以是**非连续的**（跳过的 beta 号对应中间调试版本）。

```
修改代码前：  index.html    v2026.06.29-beta1 → v2026.06.29-beta2
             dev-plan.md   不变

commit 时：   dev-plan.md   同步为 v2026.06.29-beta2（不再 +1）
```

## JS/CSS 缓存版本

版本号由 `<meta name="app-version" content="v2026.07.01-beta2">` 统一定义，`window.APP_VERSION` 读取后动态拼接，**无需手动更新每一处 `?v=`**：

- `index.html` / `login.html`：CSS/JS 通过 `document.write` 自动带 `?v=APP_VERSION`
- `app.js` VIEW_REGISTRY：`js: '/js/tasks.js?v=' + APP_VERSION`（自动跟随）

更新版本号只需改两个 meta 标签：

```bash
sed -i 's/<meta name="app-version" content="[^"]*"/<meta name="app-version" content="新版本号"/' frontend/index.html frontend/login.html
```

## 同步更新检查清单

| 文件 | 更新时机 |
|------|---------|
| `frontend/index.html` `<meta name="app-version">` | **每次修改代码前** |
| `frontend/login.html` `<meta name="app-version">` | **每次修改代码前** |
| `docs/dev-plan.md` | commit 时同步（取 meta 值，不额外 +1） |
| `docs/design-spec.md` | 新增 UI 组件/设计模式 |
| `docs/deploy-guide.md` | 新增路由/配置/运维操作 |
| `docs/db.md` | 数据层变更 |
