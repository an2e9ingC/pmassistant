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

## 路径隔离规则（最高优先级 — 防止误改 trunk）

> **硬性规则：worktree session 内所有文件操作必须通过以下环境变量引用路径，禁止直接使用硬编码的绝对路径或相对路径。**

### 环境变量

`EnterWorktree` 创建 worktree 后，立即设置两个环境变量：

```bash
export PMA_TRUNK_DIR="/home/xuchuan/workspace/pma"
export PMA_WORKTREE_DIR="<EnterWorktree 返回的实际路径>"
```

| 变量 | 含义 | 用途 |
|------|------|------|
| `$PMA_TRUNK_DIR` | trunk 主工作区路径 | **只读**：读取配置、拷贝数据库、git 操作 |
| `$PMA_WORKTREE_DIR` | worktree 临时路径 | **读写**：所有代码修改、文件写入、服务运行 |

### 路径使用规则

| 操作类型 | 必须使用的路径 | 示例 |
|---------|--------------|------|
| Read / Write / Edit 代码文件 | `$PMA_WORKTREE_DIR/path/to/file` | `Write(file_path="$PMA_WORKTREE_DIR/frontend/js/app.js")` |
| Bash 中修改/创建/删除文件 | `$PMA_WORKTREE_DIR/...` | `rm $PMA_WORKTREE_DIR/data/temp.txt` |
| Bash 中执行 git 命令 | `cd $PMA_WORKTREE_DIR && git ...` | `cd $PMA_WORKTREE_DIR && git status` |
| 启动/停止 worktree 服务 | `cd $PMA_WORKTREE_DIR && ./server.sh ...` | `cd $PMA_WORKTREE_DIR && ./server.sh -p $PORT restart` |
| 读取 trunk 配置文件（只读） | `$PMA_TRUNK_DIR/...` | `cp $PMA_TRUNK_DIR/.env $PMA_WORKTREE_DIR/.env` |
| 操作 trunk 服务（启动/停止） | `cd $PMA_TRUNK_DIR && ./server.sh ...` | `cd $PMA_TRUNK_DIR && ./server.sh -p 8000 stop` |

### 禁止事项

- ❌ **禁止**在 worktree session 中 Write / Edit 到 `$PMA_TRUNK_DIR` 下的文件
- ❌ **禁止**在 Bash 中对 `$PMA_TRUNK_DIR` 下的文件执行写操作（`rm`、`cp` 覆盖、`mv`、`>` 重定向等）
- ❌ **禁止**使用裸路径（如 `/home/xuchuan/workspace/pma/frontend/...`），必须用环境变量
- ❌ **禁止**使用相对路径（如 `frontend/js/app.js`），必须拼接环境变量

### 允许对 trunk 的操作

- ✅ **只读**：`cat`、`cp <trunk> <worktree>`（从 trunk 拷贝到 worktree）、`ls`、`git log` 等
- ✅ **git 读写**：`git fetch`、`git push`、`git merge` 等（git 操作的是仓库元数据，不直接修改 trunk 文件）
- ✅ **服务管理**：`cd $PMA_TRUNK_DIR && ./server.sh -p 8000 stop/start/restart`

---

## 创建 Worktree 流程

1. 从 prompt 提取简短描述，生成分支名：
   - 新功能：`feat/<short-desc>`
   - Bug 修复：`fix/<short-desc>`
   - 英文小写 + 连字符，不超过 50 字符

2. `EnterWorktree(name: "...")` 创建隔离工作区
   - 创建前先在 trunk 分支上拉取服务器最新代码
   - 分支必须从 `origin/trunk` 最新提交创建
   - 验证：`git merge-base <new-branch> origin/trunk` 应等于 `origin/trunk` 最新 commit

3. **设置路径隔离环境变量**（`EnterWorktree` 返回后立即执行）：
   ```bash
   export PMA_TRUNK_DIR="/home/xuchuan/workspace/pma"
   export PMA_WORKTREE_DIR="<EnterWorktree 返回的实际 worktree 路径>"
   ```
   > 之后所有文件操作必须使用这两个变量，禁止硬编码路径。

4. 准备开发环境（**严格按以下顺序，所有路径使用环境变量**）：

   a. **停止主服务器**（SQLite 独占锁，必须停服才能安全拷贝）：
   ```bash
   cd $PMA_TRUNK_DIR && ./server.sh -p 8000 stop
   ```

   b. **拷贝主数据库和配置文件到 worktree**：
   ```bash
   cp $PMA_TRUNK_DIR/data/pma-8000.db $PMA_WORKTREE_DIR/data/pma-$PORT.db
   cp $PMA_TRUNK_DIR/.env $PMA_WORKTREE_DIR/.env
   ```
   > - 主 session DB 路径为 `pma-8000.db`（不是 `data/pma.db`）
   > - `.env` 等 gitignore 文件 worktree 不会自动包含，必须手动拷贝
   > - GitLab OAuth 只支持主 session 端口（8000），worktree 请使用管理员账号密码登录

   c. **重启主服务器**：
   ```bash
   cd $PMA_TRUNK_DIR && ./server.sh -p 8000 start
   ```

   d. **启动 worktree 服务**：
   ```bash
   cd $PMA_WORKTREE_DIR && ./server.sh -p $PORT restart
   ```

## 资源隔离

```
主 session (trunk):  cd $PMA_TRUNK_DIR && ./server.sh -p 8000 restart
Worktree A:         cd $PMA_WORKTREE_DIR && ./server.sh -p 8001 restart
Worktree B:         cd $PMA_WORKTREE_DIR && ./server.sh -p 8002 restart
```

| 文件 | 说明 |
|------|------|
| `data/pma-$PORT.db` | SQLite 数据库 |
| `data/pma-$PORT.log` | 应用日志 |
| `data/server-$PORT.log` | 服务器日志 |
| `.pma-server-$PORT.pid` | 进程 PID 文件 |

## 上线流程（用户说 "上线" 时自动执行）

> 一键完成从 worktree 到远程 trunk 的完整发布链路。
> 上线过程中所有操作均在 worktree 内完成，仅 merge 阶段需要切换到 trunk。

### 0. 自动 commit（如有未提交改动）

```bash
cd $PMA_WORKTREE_DIR
if git status --porcelain | grep -q .; then
    /pma-commit   # 按 pma-commit 规范自动提交
fi
```

### 1. rebase + review

```bash
cd $PMA_WORKTREE_DIR
git fetch origin
git rebase origin/trunk           # 冲突在这里解决
git diff origin/trunk...HEAD      # Code Review
git fetch origin                  # 二次 fetch（防止其他 worktree 抢先合入）
git rebase origin/trunk           # 二次 rebase（通常快进）
```

### 2. merge

```bash
ExitWorktree(action: "keep")      # 回到主 session trunk
cd $PMA_TRUNK_DIR
git status --porcelain            # 检查 trunk 是否有未提交改动
# 如果有未提交改动（非 worktree 产生的）→ 先 stash 保存
git stash push -u -m "上线前自动保存"
git pull origin trunk --ff-only   # 确保 trunk 最新
git merge --no-ff <branch>        # --no-ff 保留分支痕迹
git stash pop                     # 恢复 stash（有冲突则用 trunk 版本）
# 如果 pop 有冲突 → git checkout --theirs <files> → git add <files> → git stash drop
```

### 2.5 Schema 检查（merge 后、重启前）

> **禁止自动执行 DB 迁移。** Worktree 测试可能污染数据库，只做只读检查。

```bash
cd $PMA_TRUNK_DIR
python3 -c "
from backend.database import engine
from sqlalchemy import inspect
inspector = inspect(engine)
# 只检查本次修改涉及的表
for table in ['pma_tasks', 'product_documents', 'product_doc_templates', 'document_templates', 'task_templates']:
    if not inspector.has_table(table):
        continue
    cols = {c['name'] for c in inspector.get_columns(table)}
    # 从 git diff 中提取新增的 Column 定义
    # 如果代码中有新列但 DB 没有 → 报告给用户
"
```

如果发现缺失列 → 告知用户手动执行 `ALTER TABLE ... ADD COLUMN ...`，**不自动执行**。

### 3. push + cleanup

```bash
cd $PMA_TRUNK_DIR
git push origin trunk
git push origin --delete <worktree-branch>  # 删除远程临时分支
git status --short                         # 确认无残留 staged 文件
# 有残留 → git reset HEAD <files> # 取消 stage
# 无意义的 diff → git checkout -- <files> # 回退
ExitWorktree(action: "remove")            # 删除 worktree 目录和本地分支
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

- 正常：`上线` 命令最后一步自动 `ExitWorktree(action: "remove")` + 删除远程临时分支
- 远程分支：`git push origin --delete <branch>`（上线后自动执行）
- 异常：`git worktree remove .claude/worktrees/<name>` + `git branch -D <branch>`
