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

## 搜索所有调用方（硬性规则）

**分析一个函数的行为前，必须先搜索所有调用方。** 同一功能可能有多条调用路径（如 `create_issue` 被 `bugs.py` 和 `gitlab.py` 两处调用，实现方式不同）。只分析一处会遗漏关键差异。

```bash
grep -rn 'function_name' backend/ --include='*.py' | grep -v __pycache__
```

## 修复后自检（Code Review）

**修复完成后、重启服务器或交付验证前**，必须对 `git diff` 改动进行快速自检：

1. **语法检查**：`node --check <file>`（JS）/ `python3 -m py_compile <file>`（Python）
2. **Div 配对检查**（前端改动时）：`grep -c '<div ' <file>` vs `grep -c '</div>' <file>` 数量必须一致
3. **残留引用**：删除的 id/class/函数名，用 `grep -rn 'name' frontend/` 确认无残留引用
4. **后端改动**：增删改操作是否已调用 `log_audit`、DateTime 是否通过 `to_iso_str` 序列化

## 修复后提供测试链接

修复完成后：
1. 执行 `./server.sh status` 获取当前服务地址和端口
2. 向用户提供可直接点击的验证 URL，使用标准 markdown 链接格式（如 `http://192.168.0.100:8000/#/detail/PE0445/docs` — [项目详情](http://192.168.0.100:8000/#/detail/PE0445/docs)），说明需要查看哪个页面/功能来验证修复效果。**禁止对链接使用粗体或其他修饰。**
3. 当前会话未使用默认端口时，URL 需使用实际端口（如 `http://192.168.0.100:8001/...`）

## 日志完善原则

- 外部 API 调用：记录请求 URL + 响应状态码 + 响应体预览（出错时）
- 关键业务逻辑：记录输入参数 + 中间状态 + 结果
- 异常捕获：必须使用 `logger.exception()` 带完整堆栈
