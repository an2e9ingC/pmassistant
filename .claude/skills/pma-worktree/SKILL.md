---
name: pma-worktree
description: PMA 并行开发模式 — 用 git worktree 隔离多分支开发环境。触发词：worktree: / 上线
user-invocable: true
allowed-tools: Read, Write, Edit, Bash, LSP, Agent
context: fork
---

# PMA 并行开发模式

## 核心理念

每个 worktree session = 一个"独立开发者"，拥有独立的分支、工作目录、服务端口、数据库和日志文件。

## 触发命令

| 命令 | 用途 |
|------|------|
| `worktree: <描述>` | 创建新 worktree 并切到 worktree 开发环境 |
| `上线` | 自动完成：fetch → rebase → review → 二次rebase → merge → push → cleanup |
| 其他 prompt | 在当前分支直接操作，不创建 worktree |

## 创建 Worktree 流程

1. 从 prompt 提取简短描述，生成分支名：
   - 新功能：`feat/<short-desc>`
   - Bug 修复：`fix/<short-desc>`
   - 英文小写 + 连字符，不超过 50 字符

2. `EnterWorktree(name: "...")` 创建隔离工作区
   - 分支必须从 `origin/trunk` 最新提交创建
   - 验证：`git merge-base <new-branch> origin/trunk` 应等于 `origin/trunk` 最新 commit

3. 准备开发环境（**严格按以下顺序**）：

   a. **停止主服务器**（SQLite 独占锁，必须停服才能安全拷贝）：
   ```bash
   ./server.sh -p 8000 stop
   ```
   b. **拷贝主数据库和配置文件到 worktree**：
   ```bash
   cp /home/xuchuan/workspace/pma/data/pma-8000.db data/pma-$PORT.db
   cp /home/xuchuan/workspace/pma/.env .env
   ```
   > - 主 session DB 路径为 `pma-8000.db`（不是 `data/pma.db`）
   > - `.env` 等 gitignore 文件 worktree 不会自动包含，必须手动拷贝
   > - GitLab OAuth 只支持主 session 端口（8000），worktree 请使用管理员账号密码登录
   
   c. **重启主服务器**：
   ```bash
   (cd /home/xuchuan/workspace/pma && ./server.sh -p 8000 start)
   ```
   d. **启动 worktree 服务**：
   ```bash
   ./server.sh -p $PORT restart
   ```

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

## 上线流程（用户说 "上线" 时自动执行）

> 一键完成从 worktree 到远程 trunk 的完整发布链路。

0. **自动 commit（如有未提交改动）**
   ```bash
   if git status --porcelain | grep -q .; then
       /pma-commit   # 按 pma-commit 规范自动提交
   fi
   ```

1. **rebase + review**
   ```bash
   git fetch origin
   git rebase origin/trunk           # 冲突在这里解决
   git diff origin/trunk...HEAD      # Code Review
   git fetch origin                  # 二次 fetch（防止其他 worktree 抢先合入）
   git rebase origin/trunk           # 二次 rebase（通常快进）
   ```

2. **merge**
   ```bash
   ExitWorktree(action: "keep")      # 回到主 session trunk
   git pull origin trunk --ff-only   # 确保 trunk 最新
   git merge --no-ff <branch>        # --no-ff 保留分支痕迹
   ```

3. **push + cleanup**
   ```bash
   git push origin trunk
   ExitWorktree(action: "remove")    # 删除 worktree 目录和分支
   ```

### 冲突处理
- rebase 有冲突 → 手动解决 → `git rebase --continue`
- 无法解决 → `git rebase --abort`，通知用户中止
- 二次 rebase 有冲突 → 说明和其他 worktree 同时改到同一区域，需人工介入

### 多 worktree 并行
```
Worktree A 上线 → push trunk
Worktree B 上线 → fetch 拉到 A 的改动 → 二次 rebase → push trunk
```

## 清理

- 正常：`上线` 命令最后一步自动 `ExitWorktree(action: "remove")`
- 异常：`git worktree remove .claude/worktrees/<name>` + `git branch -D <branch>`
