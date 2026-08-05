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
| 启动/停止 worktree 服务 | `cd $PMA_WORKTREE_DIR && ./server.sh ...` | `cd $PMA_WORKTREE_DIR && ./server.sh restart -p $PORT` |
| 读取 trunk 配置文件（只读） | `$PMA_TRUNK_DIR/...` | `cp $PMA_TRUNK_DIR/.env $PMA_WORKTREE_DIR/.env` |
| 操作 trunk 服务（启动/停止） | `cd $PMA_TRUNK_DIR && ./server.sh ...` | `cd $PMA_TRUNK_DIR && ./server.sh stop -p 8000` |

### 禁止事项

- ❌ **禁止**在 worktree session 中 Write / Edit 到 `$PMA_TRUNK_DIR` 下的文件
- ❌ **禁止**在 Bash 中对 `$PMA_TRUNK_DIR` 下的文件执行写操作（`rm`、`cp` 覆盖、`mv`、`>` 重定向等）
- ❌ **禁止**使用裸路径（如 `/home/xuchuan/workspace/pma/frontend/...`），必须用环境变量
- ❌ **禁止**使用相对路径（如 `frontend/js/app.js`），必须拼接环境变量

### 允许对 trunk 的操作

- ✅ **只读**：`cat`、`cp <trunk> <worktree>`（从 trunk 拷贝到 worktree）、`ls`、`git log` 等
- ✅ **git 读写**：`git fetch`、`git push`、`git merge` 等（git 操作的是仓库元数据，不直接修改 trunk 文件）
- ✅ **服务管理**：`cd $PMA_TRUNK_DIR && ./server.sh stop -p 8000/start/restart`

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

   **验证 CWD**（`EnterWorktree` 返回后立即执行）：
   ```bash
   # 验证当前工作目录确实在 worktree 中
   CWD=$(pwd)
   if [ "$CWD" != "$PMA_WORKTREE_DIR" ]; then
       echo "WARNING: CWD=$CWD, expected $PMA_WORKTREE_DIR — switching to worktree"
       cd "$PMA_WORKTREE_DIR"
   fi
   # 验证 git 分支
   BRANCH=$(git rev-parse --abbrev-ref HEAD)
   echo "Working on branch: $BRANCH in $(pwd)"
   ```
   > **硬性规则：Edit / Write 工具的所有 `file_path` 必须使用 `$PMA_WORKTREE_DIR/...` 绝对路径，禁止使用相对路径。**
   > 因为 Edit/Write 不解析 shell 环境变量，必须写成 `/home/xuchuan/workspace/pma/.claude/worktrees/<name>/frontend/js/app.js` 这样的绝对路径。
   > **每轮对话开始编辑前，先用 `pwd` 确认 CWD 在 worktree 中。** 如果 `EnterWorktree` 返回错误或异常，不要跳过验证直接编辑。

   **EnterWorktree 失败时的手动补救**：
   如果 `EnterWorktree` 报错 "Cannot enter" 或超时，不要假设已进入 worktree。按以下步骤手动处理：
   ```bash
   # 1. 确认 worktree 路径存在
   ls $PMA_WORKTREE_DIR/.git
   # 2. 手动 cd 进入
   cd $PMA_WORKTREE_DIR
   # 3. 确认分支
   git rev-parse --abbrev-ref HEAD
   # 4. 之后所有 Edit/Write 的 file_path 使用绝对路径拼接
   ```

4. 准备开发环境（**严格按以下顺序，所有路径使用环境变量**）：

   a. **从最新备份拷贝数据库**（避免停 trunk 服务）：
   ```bash
   # 优先使用最新备份，无备份时才停服拷贝
   LATEST_BACKUP=$(find $PMA_TRUNK_DIR/data/backups -name "pma-backup-*.db" ! -name "*-before-*" -print 2>/dev/null | xargs ls -t 2>/dev/null | head -1)
   if [ -n "$LATEST_BACKUP" ]; then
       cp "$LATEST_BACKUP" $PMA_WORKTREE_DIR/data/pma-$PORT.db
       echo "使用备份数据库: $(basename $LATEST_BACKUP)"
   else
       echo "无备份可用，停服拷贝..."
       cd $PMA_TRUNK_DIR && ./server.sh stop -p 8000
       cp $PMA_TRUNK_DIR/data/pma-8000.db $PMA_WORKTREE_DIR/data/pma-$PORT.db
       cd $PMA_TRUNK_DIR && ./server.sh start -p 8000
   fi
   ```
   > - 备份文件位于 `data/backups/hotback/YYYYMMDD-HHMMSS/db/pma-backup-YYYYMMDD-HHMMSS.db`（树形结构）
   > - 使用最新备份可避免停服，且数据足够用于开发测试
   > - 无备份时（首次创建/备份被清理）降级为停服拷贝

   b. **同步 uploads 目录**（附件/图片文件）：
   ```bash
   rsync -a $PMA_TRUNK_DIR/data/uploads/ $PMA_WORKTREE_DIR/data/uploads/
   ```
   > - 数据库备份不包含附件文件，必须单独同步
   > - `rsync -a` 增量同步，首次全量拷贝后后续几乎无开销
   > - 如 rsync 不可用则降级为 `cp -r $PMA_TRUNK_DIR/data/uploads/* $PMA_WORKTREE_DIR/data/uploads/`

   c. **拷贝配置文件到 worktree**：
   ```bash
   cp $PMA_TRUNK_DIR/.env $PMA_WORKTREE_DIR/.env
   ```
   > - `.env` 等 gitignore 文件 worktree 不会自动包含，必须手动拷贝
   > - GitLab OAuth 只支持主 session 端口（8000），worktree 请使用管理员账号密码登录

   d. **启动 worktree 服务**：
   ```bash
   cd $PMA_WORKTREE_DIR && ./server.sh restart -p $PORT
   ```

### 完成后强制输出（fork 返回前必须显示）

> **这是 worktree session 最重要的信息，必须醒目输出。**

环境准备完成后，在返回给主会话的输出中，**必须**包含以下内容（用表格展示，确保醒目）：

```markdown
## ⚠️ 路径隔离提醒

**本 session 在 worktree 中运行，所有文件编辑必须使用 worktree 绝对路径。**

| 正确 ✅ | 错误 ❌ |
|---------|--------|
| `/home/xuchuan/workspace/pma/.claude/worktrees/<name>/frontend/js/app.js` | `/home/xuchuan/workspace/pma/frontend/js/app.js` |

> 使用 trunk 路径会污染主分支代码！
```

如果该提醒未出现在返回结果中，视为 worktree 创建不完整。

## 资源隔离

```
主 session (trunk):  cd $PMA_TRUNK_DIR && ./server.sh restart -p 8000
Worktree A:         cd $PMA_WORKTREE_DIR && ./server.sh restart -p 8001
Worktree B:         cd $PMA_WORKTREE_DIR && ./server.sh restart -p 8002
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

### 3. push + backup + cleanup

```bash
cd $PMA_TRUNK_DIR
git push origin trunk

# 备份 trunk 数据库（与定时备份同一目录和命名规则，树形结构）
TIMESTAMP=$(TZ=Asia/Shanghai date +%Y%m%d-%H%M%S)
BACKUP_DIR="data/backups/hotback/$TIMESTAMP/db"
mkdir -p "$BACKUP_DIR"
BACKUP_FILE="$BACKUP_DIR/pma-backup-$TIMESTAMP.db"
cp data/pma-8000.db "$BACKUP_FILE"
echo "数据库已备份: $BACKUP_FILE"

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
- **退出后清理残留**：每次 worktree session 退出后，检查 `.claude/worktrees/` 下是否有 `git worktree list` 中不存在的残留目录，将其删除：
  ```bash
  # 列出当前活跃的 worktree 路径
  git worktree list --porcelain | grep '^worktree ' | cut -d' ' -f2- > /tmp/active_worktrees.txt
  # 删除 .claude/worktrees/ 下不在活跃列表中的目录
  for d in .claude/worktrees/*/; do
    d=$(realpath "$d")
    if ! grep -qxF "$d" /tmp/active_worktrees.txt; then
      echo "清理残留 worktree: $d"
      rm -rf "$d"
    fi
  done
  ```
