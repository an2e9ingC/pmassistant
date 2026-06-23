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

## 标准步骤

### 0. 获取 Issue 详情（仅 `issue#N` 无描述时）

```bash
curl -s "http://localhost:8000/api/gitlab/issues/{N}" \
  -H "Authorization: Bearer $(curl -s -X POST http://localhost:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"徐川","password":"123456"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['access_token'])")"
```

### 1. 理解问题
- 从 title/description 提取关键词，确定功能模块

### 2. 定位代码
- `grep` 搜索关键词 → 找到相关文件和行号
- Read 上下文代码，理解当前实现逻辑

### 3. 诊断根因
- 对比当前实现 vs 预期行为
- 识别问题类型：硬编码 / 静态内容 / 权限

### 4. 设计方案
- **动态优于静态**：从 DOM/API/DB 提取而非硬编码
- **权限感知**：尊重现有权限控制
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
