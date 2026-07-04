---
name: pma-issue-workflow
description: GitLab Issue 自动解决流程 — 获取详情→定位→诊断→设计→实现→迭代→commit。触发词：issue#N
user-invocable: true
allowed-tools: Read, Write, Edit, Bash, LSP, Agent, WebFetch
---

# GitLab Issue 自动解决流程

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
login_data = json.dumps({"username": "admin", "password": "123456"}).encode()
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

login_data = json.dumps({"username": "admin", "password": "123456"}).encode()
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

### 1. 理解问题
- 从 title/description 提取关键词，确定功能模块

### 2. 定位代码（必须优先使用 MCP）

> **规则：必须遵循 CLAUDE.md §0 Code Discovery Protocol。先用 MCP，再用 grep/Read。**

```
1. search_graph(query="关键词") → 定位相关函数/类/路由
2. trace_path(function_name, mode="calls") → 理解调用链和权限依赖
3. get_code_snippet(qualified_name) → 获取精确源码
4. （仅当 MCP 无法满足时）→ grep/Read
```

- 特别注意：调用相似功能的端点，查看其权限装饰器模式（`require_perm` vs `get_current_user`）

### 3. 诊断根因
- 对比当前实现 vs 预期行为
- 识别问题类型：硬编码 / 静态内容 / 权限

### 4. 设计方案
- **动态优于静态**：从 DOM/API/DB 提取而非硬编码
- **权限感知**：尊重现有权限控制，参考已有端点的权限模式
- **最少改动**

### 5. 实现
- 修改代码
- JS 语法检查：`node --check <file>`
- Python 语法检查：`python3 -m py_compile <file>`
- grep 检查无旧引用残留
- 后端 `.py` 修改后 `./server.sh -p <PORT> restart`

### 6. 用户反馈迭代
- 告知用户改了什么
- 等待用户确认

### 7. Commit
- 遵循 pma-commit 规范
- 必须包含 `Closes #X`
- 更新版本号
