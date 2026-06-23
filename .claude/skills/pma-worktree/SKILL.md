---
name: pma-worktree
description: PMA 并行开发模式 — 用 git worktree 隔离多分支开发环境。触发词：worktree:
user-invocable: true
allowed-tools: Read, Write, Edit, Bash, LSP, Agent
context: fork
---

# PMA 并行开发模式

## 核心理念

每个 worktree session = 一个"独立开发者"，拥有独立的分支、工作目录、服务端口、数据库和日志文件。

## 触发方式

- `worktree:` 前缀的 prompt → 创建独立 worktree
- 其他 prompt → 在当前分支直接操作

## 创建 Worktree 流程

1. 从 prompt 提取简短描述，生成分支名：
   - 新功能：`feat/<short-desc>`
   - Bug 修复：`fix/<short-desc>`
   - 英文小写 + 连字符，不超过 50 字符

2. `EnterWorktree(name: "...")` 创建隔离工作区
   - 分支必须从 `origin/trunk` 最新提交创建
   - 验证：`git merge-base <new-branch> origin/trunk` 应等于 `origin/trunk` 最新 commit

3. 准备开发环境：
   - 启动服务：`./server.sh -p <PORT> restart`
   - 拷贝数据库：`cp data/pma.db data/pma-$PORT.db`

## 资源隔离

```
主 session (trunk):  ./server.sh -p 8000 restart
Worktree A:         ./server.sh -p 8001 restart
Worktree B:         ./server.sh -p 8002 restart
```

| 文件 | 说明 |
|------|------|
| `data/pma-$PORT.db` | SQLite 数据库 |
| `data/pma-$PORT.log` | 应用日志 |
| `data/server-$PORT.log` | 服务器日志 |
| `.pma-server-$PORT.pid` | 进程 PID 文件 |

## 合并流程（用户说 "merge" 时执行）

**阶段一：在 worktree 中**
1. `git fetch origin`
2. `git rebase origin/trunk`
3. `git diff origin/trunk...HEAD`（Code Review）

**阶段二：返回主 session**
4. `ExitWorktree(action: "keep")`
5. `git merge --no-ff <feature-branch>`

**阶段三：用户确认后**
6. 用户说 "push" → `git push origin trunk`
7. 用户确认清理 → `ExitWorktree(action: "remove")`

## 安全原则

- 用户不主动说 merge，绝不合并
- Merge 后不自动 push
- Push 前不做清理（保留回滚能力）

## 清理

- 正常：merge + push 成功后 `ExitWorktree(action: "remove")`
- 异常：`git worktree remove .claude/worktrees/<name>` + `git branch -D <branch>`
