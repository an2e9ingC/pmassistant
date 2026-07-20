---
name: pma-frontend-verify
description: >
  PMA 前端/后端自验证工作流。触发词：自验证、自检查、检查前端、verify frontend。
  用于：UI 改动后逐项验证需求点、调试前端 JS 运行时行为、排查 API 返回与预期不符、
  Chrome DevTools MCP 环境修复。适合复杂问题或长时间未解决的 issue 的端到端验证。
---

# PMA 自验证工作流

> 基于 Chrome DevTools MCP + API + 日志的端到端验证流程。

## 0. Chrome DevTools MCP 环境初始化

首次使用或 MCP 工具不可用时，阅读 [mcp-env-setup.md](mcp-env-setup.md) 按步骤修复环境。核心步骤：
1. 安装 Google Chrome deb 版（**不要 snap**）
2. 安装并启动 xvfb
3. 在 `~/.claude/settings.json` 中配置 `DISPLAY` + `pluginConfigs`
4. `pkill -f "chrome-devtools-mcp"` 重启 MCP 进程

## 1. 验证流程（前端）

### 1.1 登录

```
navigate_page → http://localhost:8000
take_snapshot → 检查是否已登录（看 sidebar 是否有导航菜单）
如果未登录:
  click → "管理员登录"
  fill → 用户名 / 密码
  click → "登录"
```

### 1.2 导航到目标页面

使用 hash 路由直接导航（比点击侧边栏更可靠）：
```
navigate_page → http://localhost:8000/#/<view-name>
```
常用路由：`/product-management`、`/product-detail`、`/detail`、`/dashboard`

### 1.3 清理干扰弹窗

系统更新日志等弹窗会遮挡目标 UI。snapshot 中如发现干扰弹窗，用脚本关闭：
```js
() => { var d = document.querySelector('.shared-dialog-overlay') || document.querySelector('.note-dialog-overlay'); if (d) d.remove(); return 'closed'; }
```

### 1.4 触发目标功能

从 snapshot 中找到目标按钮的 `uid`，`click` 触发。如果对话框未出现：
- 检查是否有 JS 报错：`list_console_messages`
- 检查异步依赖是否加载完成：`evaluate_script` 检查关键变量

### 1.5 逐项验证

对每个需求点：
1. `take_snapshot` 查看 UI 文本/元素
2. 对照需求确认：
   - 文本/标签是否正确
   - 元素是否存在/不存在
   - input 是否 editable/disabled
   - 交互行为是否符合预期

### 1.6 深度调试（当 UI 不符合预期时）

**不要直接猜测根因**，用 `evaluate_script` 逐步排查：

**检查 DOM 状态：**
```js
() => ({ hasDialog: !!document.querySelector('.shared-dialog-overlay'), elementText: document.getElementById('xxx')?.textContent, elementDisabled: document.getElementById('xxx')?.disabled })
```

**检查 API 返回格式：**
```js
async () => { var res = await API.get('/path'); return res; }
```
关键：注意 `API.get()` 返回的是解包后的 `data` 对象（不含 `code`/`message` 外层），不是完整响应。

**检查全局变量：**
```js
() => ({ hasFn: typeof window.someFunction, val: window.someVariable })
```

### 1.7 修复 + 重验

定位到根因后：
1. `Read` → 确认问题代码
2. `Edit` → 修复
3. `navigate_page` 刷新 → 重新触发功能 → 再次 `evaluate_script` 确认修复
4. 语法检查：`node --check <file>` 或 `python3 -m py_compile <file>`

## 2. 验证流程（后端 API）

当需要验证 API 行为时：

```python
python3 << 'PYEOF'
import urllib.request, json

# 登录
login_data = json.dumps({"username": "admin", "password": "admin123"}).encode()
req = urllib.request.Request("http://localhost:8000/api/auth/login", data=login_data,
    headers={"Content-Type": "application/json"})
resp = urllib.request.urlopen(req)
token = json.loads(resp.read())["data"]["access_token"]

# 调用目标 API
req = urllib.request.Request("http://localhost:8000/api/<path>",
    headers={"Authorization": f"Bearer {token}"})
resp = urllib.request.urlopen(req)
print(json.dumps(json.loads(resp.read()), indent=2, ensure_ascii=False))
PYEOF
```

对于 POST/PUT/DELETE，使用 `method=` 参数和 `data=` 发送 JSON body。

## 3. 验证流程（日志）

当需要排查后端运行时行为时：

```bash
tail -100 data/pma-8000.log | grep -i "<关键词>"
```

## 4. 常见问题速查

| 现象 | 可能原因 | 排查方法 |
|------|---------|---------|
| MCP 工具不可用 | Chrome/xvfb 未安装或配置 | 执行 §0 初始化流程 |
| 对话框不出现 | JS 异步加载未完成、弹窗遮挡 | `evaluate_script` 查 DOM；关掉 `.shared-dialog-overlay` |
| API 数据未渲染 | `API.get()` 返回格式理解错误 | `evaluate_script` 直接调 API 看返回值结构 |
| 修改后页面未更新 | 浏览器缓存（JS 带 `?v=` 缓存版本） | 确认 `index.html` 中 `<meta name="app-version">` 已更新 |
| DOM 元素 ID 找不到 | dialog 异步重建、ID 冲突 | `evaluate_script` 列所有相关元素 |

## 5. 交付检查清单

验证完成后，确认：
- [ ] 所有需求点逐一通过 snapshot 或 evaluate_script 验证
- [ ] JS 语法 `node --check` 通过
- [ ] Python 语法 `python3 -m py_compile` 通过
- [ ] Chrome DevTools 验证过程中创建的测试数据已清理
