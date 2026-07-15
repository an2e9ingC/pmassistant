---
name: pma-bug-analysis
description: Bug 分析流程 — 优先查日志定位，日志不足则完善日志再修复。触发词：分析/看看/bug/报错/异常/错误/问题
user-invocable: true
allowed-tools: Read, Write, Edit, Bash, LSP
---

# Bug 分析流程

## 标准流程（按顺序执行）

1. **查系统日志** — `tail -50 data/pma-$PORT.log`
2. **有堆栈 → 分析修复**
3. **日志不足 → 加日志**（`logger.exception` / `logger.error`）→ 复现 → 修复
4. 外部 API 调用记录：URL + 状态码 + 响应预览（出错时）
5. 不在日志中记录密码/Token

## 扫描同类问题

修复 bug 时，用 `search_code(pattern="...")` 或 `trace_path` 扫描同类问题。列出同类问题并询问是否一并修复。

## 日志完善原则

- 外部 API 调用：记录请求 URL + 响应状态码 + 响应体预览（出错时）
- 关键业务逻辑：记录输入参数 + 中间状态 + 结果
- 异常捕获：必须使用 `logger.exception()` 带完整堆栈
