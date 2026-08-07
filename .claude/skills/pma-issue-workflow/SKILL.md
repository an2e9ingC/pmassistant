---
name: pma-issue-workflow
description: GitLab Issue 自动解决流程 — 获取详情→定位→诊断→设计→实现→迭代→commit。触发词：issue#N
user-invocable: true
allowed-tools: Read, Write, Edit, Bash, LSP, Agent, WebFetch
---

# GitLab Issue 自动解决流程

## 核心原则

> **1. 找到根因，从根本上解决问题。禁止 patch、临时修复、局部片面修复。**
> **2. 每个诊断至少追问 2 层"为什么"，直到触及系统设计层面的矛盾。**
> **3. 修复后主动扫描全量代码，确认无同类问题残留。**
> **4. 所有 Issue 修复必须在 git worktree 隔离环境中进行，禁止直接在 trunk 上修改代码。**

---

## 触发条件

- `issue#N: <描述>` — 含描述，可跳过 GitLab API 调用
- `issue#N` — 仅编号，**必须**先调用 API 获取详情
- `#N` — 仅编号，**必须**先调用 API 获取详情

## 标准步骤

### 0. 获取 Issue 详情（仅 `issue#N` 或 `#N` 无描述时）

**单个 Issue：**

```bash
python3 << 'PYEOF'
import urllib.request, json

# 1. 登录获取 token
login_data = json.dumps({"username": "admin", "password": "admin123"}).encode()
req = urllib.request.Request("http://localhost:8000/api/auth/login", data=login_data,
    headers={"Content-Type": "application/json"})
resp = urllib.request.urlopen(req)
token = json.loads(resp.read())["data"]["access_token"]

# 2. 获取单个 Issue
IID = {N}  # 替换为实际 issue 编号
req = urllib.request.Request(f"http://localhost:8000/api/gitlab/issues/{IID}",
    headers={"Authorization": f"Bearer {token}"})
resp = urllib.request.urlopen(req)
issue = json.loads(resp.read())
data = issue.get("data", issue)
print(f"=== #{IID}: {data.get('title','?')} [{data.get('state','?')}] ===")
desc = data.get("description", "")
if desc: print(desc[:400])
print()
PYEOF
```

**批量获取多个 Issue：**

```bash
python3 << 'PYEOF'
import urllib.request, json

login_data = json.dumps({"username": "admin", "password": "admin123"}).encode()
req = urllib.request.Request("http://localhost:8000/api/auth/login", data=login_data,
    headers={"Content-Type": "application/json"})
resp = urllib.request.urlopen(req)
token = json.loads(resp.read())["data"]["access_token"]

for iid in [62, 63, 65, 67]:  # 替换为实际 issue 编号列表
    req = urllib.request.Request(f"http://localhost:8000/api/gitlab/issues/{iid}",
        headers={"Authorization": f"Bearer {token}"})
    resp = urllib.request.urlopen(req)
    issue = json.loads(resp.read())
    data = issue.get("data", issue)
    print(f"=== #{iid}: {data.get('title','?')} [{data.get('state','?')}] ===")
    desc = data.get("description", "")
    if desc: print(desc[:400])
    print()
PYEOF
```

### 1. 进入 Worktree 隔离环境（硬性要求 — 禁止跳过）

> **所有 Issue 修复必须在 git worktree 中完成，禁止直接在 trunk 修改任何代码。**
> 详细规则见 `pma-worktree` skill。

**操作步骤：**

1. **确定分支名**：根据 Issue 类型和编号生成分支名
   - Bug 修复：`fix/issue-<N>`
   - 功能开发：`feat/issue-<N>`
   - 改进优化：`refactor/issue-<N>`

2. **创建并进入 worktree**：
   ```
   EnterWorktree(name: "fix/issue-<N>")
   ```
   - 分支必须从 `origin/trunk` 最新提交创建
   - 如果 `EnterWorktree` 返回错误，按 `pma-worktree` skill 中的手动补救步骤处理

3. **准备开发环境**（严格按顺序）：

   > **PORT 分配**：`EnterWorktree` 返回后，通过 `./server.sh status` 查看已占用端口，选择一个未被使用的端口（主 session 固定 8000，worktree 从 8001 起递增）。以下命令中的 `$PORT` 替换为实际分配的端口号。
   
   ```bash
   # a. 拷贝数据库（优先使用最新备份，避免停 trunk 服务）
   LATEST_BACKUP=$(find $PMA_TRUNK_DIR/data/backups -name "pma-backup-*.db" ! -name "*-before-*" -print 2>/dev/null | xargs ls -t 2>/dev/null | head -1)
   if [ -n "$LATEST_BACKUP" ]; then
       cp "$LATEST_BACKUP" $PMA_WORKTREE_DIR/data/pma-$PORT.db
   else
       cd $PMA_TRUNK_DIR && ./server.sh stop -p 8000
       cp $PMA_TRUNK_DIR/data/pma-8000.db $PMA_WORKTREE_DIR/data/pma-$PORT.db
       cd $PMA_TRUNK_DIR && ./server.sh start -p 8000
   fi

   # b. 同步 uploads 目录（附件/图片文件，db备份不包含）
   rsync -a $PMA_TRUNK_DIR/data/uploads/ $PMA_WORKTREE_DIR/data/uploads/

   # c. 拷贝配置文件
   cp $PMA_TRUNK_DIR/.env $PMA_WORKTREE_DIR/.env

   # c2. 关闭远端同步（避免 worktree 临时数据库污染远端数据源）
   sed -i 's/^SYNC_INTERVAL_MINUTES=.*/SYNC_INTERVAL_MINUTES=0/' $PMA_WORKTREE_DIR/.env
   sed -i 's/^WECOM_SYNC_INTERVAL=.*/WECOM_SYNC_INTERVAL=0/' $PMA_WORKTREE_DIR/.env
   sed -i 's/^ZENTAO_SYNC_RELEASES=.*/ZENTAO_SYNC_RELEASES=false/' $PMA_WORKTREE_DIR/.env

   # d. 启动 worktree 服务
   cd $PMA_WORKTREE_DIR && ./server.sh restart -p $PORT
   ```

4. **路径隔离提醒**（必须向用户展示）：
   ```markdown
   ## ⚠️ 路径隔离提醒

   本 Issue 修复在 worktree 中完成，所有文件编辑必须使用 worktree 绝对路径。

   | 正确 ✅ | 错误 ❌ |
   |---------|--------|
   | `$PMA_WORKTREE_DIR/frontend/js/app.js` | `$PMA_TRUNK_DIR/frontend/js/app.js` |
   ```

**后续所有步骤（定位、修改、测试、commit）均在 worktree 中完成。** 直到用户确认修复无误后，通过 `pma-worktree` skill 的上线流程合入 trunk。

### 2. 理解问题
- 从 title/description 提取关键词，确定功能模块

### 3. 定位代码（硬性 MCP 检查点 — 禁止跳过）

> **此步骤为硬性门槛：必须先输出 MCP 查询结果，才能进入 step 4。不得直接 grep/Read。**

**必须执行（至少有 1 和 2）：**

1. `search_graph(query="关键词")` → 定位相关函数/类/路由
2. `trace_path(function_name, mode="calls")` → 理解上下游调用链和权限依赖
3. `get_code_snippet(qualified_name)` → 获取精确源码（需要时）

**仅当 MCP 返回空结果或索引未覆盖时**，才允许 fallback 到 grep/Read。

**输出要求**：向用户展示 MCP 追踪到的调用链路和数据流，然后基于这些信息进入 step 4 诊断。

- 特别注意：调用相似功能的端点，查看其权限装饰器模式（`require_perm` vs `get_current_user`）

### 4. 诊断根因（最重要步骤 — 禁止停留在表面修复）

> **核心原则：必须找到问题的根本原因，从根本上解决问题。禁止只修复表面症状、做临时 patch、或只解决局部片面问题。**

**诊断方法（逐层深入，至少追问 2 次"为什么"）：**

1. **表面现象** → 用户看到了什么？（如：页面闪烁、提示未登录）
2. **直接原因** → 什么代码逻辑导致了这个现象？（如：HTML 硬编码了 `active` class）
3. **根本原因** → 为什么代码要这样写？深层矛盾是什么？（如：HTML 静态声明 vs JS 动态路由之间的时序冲突）
4. **系统性问题** → 同类问题是否在其他地方也存在？设计层面是否有缺陷？

**根因判定标准：**

| 标准 | 说明 |
|------|------|
| **如果移除触发条件，问题是否彻底消失？** | 只移除症状 → 不是根因；解决深层矛盾 → 是根因 |
| **修复后，同类问题是否还会以其他形式重现？** | 会 → 不是根因；不会 → 是根因 |
| **修复是否具有系统性？** | 只改一处 → 可能片面；模式和架构层面的修正 → 系统解决 |

**典型错误示例：**

| 问题 | 片面修复 | 根本修复 |
|------|---------|---------|
| 页面先闪 dashboard 再跳 user-center | 只去掉 HTML 的 `active` → 闪空白 | 去掉 `active` + 把 `gotoView` 从所有 async 操作之后移到 `refreshCurrentUser` 之后，消除时序延迟 |
| API 返回 401 导致页面空白 | 加 `catch` 忽略错误 | 排查为什么 token 过期/未传递，修复认证时序 |
| 弹框嵌套时子弹框取消导致父弹框消失 | 取消按钮特殊处理 | `_closeTaskDialog` 改 removeAll + 新增 `_closeWorklogDialog` 仅关顶层，提交和取消都用 |

### 5. 设计方案

- **根本解决 > 局部修补**：修复深层矛盾而非表面症状，避免后续同类问题反复出现
- **动态优于静态**：从 DOM/API/DB 提取而非硬编码
- **时序正确**：关注代码执行顺序，async/await 之间的间隙是常见根因
- **权限感知**：尊重现有权限控制，参考已有端点的权限模式
- **系统性修复**：发现一处问题后，扫描全量代码确认无同类问题

### 6. 实现
- 修改代码
- **简易 Code Review**（重启/交付前必须执行）：
  - JS 语法检查：`node --check <file>`
  - Python 语法检查：`python3 -m py_compile <file>`
  - Div 配对检查（前端改动时）：`grep -c '<div ' <file>` vs `grep -c '</div>' <file>`
  - 残留引用检查：删除的 id/class/函数名用 grep 确认无残留
  - 后端改动：确认 audit log + `to_iso_str` 规范
- 后端 `.py` 修改后 `./server.sh restart -p <PORT>`

### 7. 用户反馈迭代
- 告知问题原因
- 告知用户改了什么
- **提供测试链接**：通过 `./server.sh status` 获取当前服务地址和端口，给出可直接点击的验证 URL，使用标准 markdown 链接格式（如 [项目详情](http://192.168.100.100:8000/#/detail/PE0445/docs)），说明需要查看哪个页面/功能来验证修复效果。**禁止对链接使用粗体或其他修饰。**
- 等待用户确认

### 8. 提交并上线（用户说 "上线" 即可）

> **验证通过后，用户只需说 "上线" 即可完成全流程。不要拆分说 "commit" 再 "上线"。**

**执行链（根据当前环境分两路）**：

```
用户说 "上线"
  │
  ├── 已在 worktree 中（CWD 包含 .claude/worktrees/）
  │     ├── ⚠️ 不调用 pma-worktree skill（否则会重复创建 worktree）
  │     ├── 直接 invoke Skill("pma-commit")  → 版本号 + review + commit + GitLab 评论
  │     ├── git fetch origin trunk
  │     ├── git rebase origin/trunk
  │     ├── git diff origin/trunk...HEAD（review）
  │     ├── git fetch origin（二次 fetch 防并发）
  │     ├── git rebase origin/trunk（二次 rebase）
  │     ├── ⚠️ 版本号自检：检查 docs/dev-plan.md 今天是否已有同beta号记录，有则递增 → amend commit
  │     ├── 停 worktree 服务：./server.sh stop -p <PORT>
  │     ├── 切换到 trunk 目录：cd $PMA_TRUNK_DIR
  │     ├── git merge --no-ff <worktree-branch>
  │     ├── git push origin trunk
  │     ├── git push origin --delete <worktree-branch>（如远程存在）
  │     ├── ExitWorktree(action: "remove", discard_changes: true)
  │     └── MCP 重索引 trunk：index_repository(repo_path="$PMA_TRUNK_DIR", mode="moderate")
  │
  └── 不在 worktree 中（CWD 不含 .claude/worktrees/）
        └── Skill("pma-worktree")  → 自动 commit → rebase → merge → push → cleanup
```

> **关键规则**：`pwd` 输出包含 `.claude/worktrees/` 时，说明已在 worktree 中，直接执行上线流程，**绝不调用 `Skill("pma-worktree")`**，否则会创建第二个 worktree。

**各 skill 职责边界**：

| Skill | 触发词 | 职责 |
|-------|--------|------|
| `pma-issue-workflow` | `issue#N` | 获取 issue → worktree → 诊断 → 实现 → 验证。**验证完后告知用户说 "上线"** |
| `pma-commit` | `commit` | 版本号 + review + 停服 + git commit + 重启 + MCP 重索引 + GitLab 评论 |
| `pma-worktree` | `上线` | 自动 commit（调 pma-commit）→ rebase → merge → push → cleanup |

**关键规则**：

- `pma-worktree` 的上线流程内置了自动 commit（`git status --porcelain` 有改动时调 pma-commit），**不需要用户先单独说 "commit"**
- `pma-commit` 内部已包含 GitLab Issue 评论发布（使用 `scripts/gitlab_issue_comment.py`，模板含分析摘要），**issue-workflow 不重复实现**
- 如果用户只想 commit 暂存改动（不上线），可以说 "commit" 单独触发 `pma-commit`
