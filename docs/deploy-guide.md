# PMA 部署运行指南

## 环境要求

| 依赖 | 最低版本 |
|------|---------|
| Python | 3.9+（直接运行）或 Docker 24+（容器运行） |
| 磁盘 | 100MB（SQLite 数据 + 依赖） |
| 网络 | 可访问禅道服务器 `192.168.0.124:8800` |

---

## 一、配置

### 1.1 创建 `.env` 文件

```bash
cp .env.example .env
```

编辑 `.env`，填写禅道账号：

```ini
DATABASE_URL=sqlite:///./data/pma.db
ZENTAO_BASE_URL=http://192.168.0.124:8800/api.php/v1
ZENTAO_AUTH_ACCOUNT=你的禅道账号
ZENTAO_AUTH_PASSWORD=你的禅道密码
JWT_SECRET_KEY=随机字符串-请修改
LOG_LEVEL=INFO
SYNC_INTERVAL_MINUTES=30
```

> JWT_SECRET_KEY 建议用 `python3 -c "import secrets; print(secrets.token_hex(32))"` 生成

### 1.2 确定禅道 API 地址

禅道 REST API 与 Web UI 运行在同一端口，路径为 `/api.php/v1/`。

**如何确定完整地址：**

1. 浏览器访问禅道 Web UI，记录地址格式：
   - 如果访问 `http://192.168.0.124:8800/`，则 API 为 `http://192.168.0.124:8800/api.php/v1`
   - 如果访问 `http://192.168.3.22/`，且页面跳转到 `http://192.168.3.22/zentao/`，则 API 为 `http://192.168.3.22/zentao/api.php/v1`

2. 验证：`curl http://<地址>/api.php/v1/users` 应返回 JSON（不是 404 HTML）

> 禅道 REST API 无需额外开启，内置于禅道系统。如果返回 404，说明路径前缀不正确（如漏了 `/zentao/`），或者 Nginx/Apache 未正确转发 `/api.php` 请求。

### 1.3 禅道账号要求

需要一个有 API 访问权限的禅道账号（推荐创建专用只读账号）。最低权限：
- 查看项目、任务、Bug、用户、产品

### 1.4 GitLab OAuth 用户认证（可选）

PMA 支持通过 GitLab OAuth 2.0 登录，用户无需创建本地密码。

#### 前置条件

- 已部署 GitLab 实例（`http://192.168.0.128`）
- 拥有 GitLab 管理员权限（用于注册 OAuth Application）

#### 步骤 1：注册 GitLab OAuth Application

1. 登录 GitLab → **Admin Area** → **Applications**（或 User Settings → Applications）
2. 填写：
   - **Name**: `PMA`
   - **Redirect URI**: `http://<PMA-服务器地址>:8000/api/auth/gitlab/callback`
   - **Scopes**: 勾选 `read_user`（最小权限，仅读取用户基本信息）
3. 点击 **Save application**，记录 **Application ID** 和 **Secret**

#### 步骤 2：配置 PMA

**方式 A：通过数据源配置页面**（推荐）

1. 以 admin 用户登录 PMA
2. 进入「管理 → 数据源配置」
3. 在 GitLab 区域填写：
   - **OAuth Application ID**: 步骤 1 获取的 Application ID
   - **OAuth Application Secret**: 步骤 1 获取的 Secret
   - **启用 GitLab OAuth 登录**: 勾选
   - **OAuth 回调地址**: `http://<PMA-服务器地址>:8000/api/auth/gitlab/callback`
4. 保存配置

**方式 B：通过 .env 文件**

```ini
GITLAB_APP_ID=<Application ID>
GITLAB_APP_SECRET=<Secret>
GITLAB_OAUTH_ENABLED=true
GITLAB_OAUTH_REDIRECT_URI=http://<PMA-服务器地址>:8000/api/auth/gitlab/callback
```

#### 用户体验

- 配置完成后，用户访问登录页将看到「使用 GitLab 登录」按钮
- 首次登录：点击按钮 → 跳转 GitLab 授权 → 自动创建 PMA 账户 → 进入系统
- 后续登录：直接点击「使用 GitLab 登录」即可
- 管理员仍可通过「管理员登录」入口使用用户名+密码登录
- **注意**：admin 用户必须使用本地密码登录，不能通过 GitLab OAuth 登录

#### 验证

1. 访问 PMA 登录页 `/login`，确认「使用 GitLab 登录」按钮可见
2. 点击按钮，检查是否正确跳转到 GitLab 授权页
3. 完成授权，检查是否正确返回 PMA 并登录成功
4. 进入「管理 → 用户管理」，确认新用户显示「GitLab」认证来源

---

## 二、运行

### 方式一：Docker（推荐）

```bash
# 构建并启动
docker compose up -d

# 查看日志
docker compose logs -f

# 停止
docker compose down
```

服务在 `http://<服务器IP>:8080` 访问。

数据持久化在 `./data/` 目录（SQLite 文件）。

### 方式二：直接运行

```bash
# 1. 安装依赖
pip install -r requirements.txt

# 2. 启动服务
python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 8000

# 或后台运行
nohup python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 > pma.log 2>&1 &
```

服务在 `http://<服务器IP>:8000` 访问。

---

## 三、首次使用

### 3.1 登录

默认管理员账号：`admin` / `admin123`

> 首次启动时自动创建。登录后建议修改密码或创建新管理员账号。

### 3.2 同步数据

1. 登录后进入 Dashboard
2. 点击左侧边栏「同步数据」按钮
3. 等待同步完成（根据禅道数据量，约 30 秒 ~ 2 分钟）

也可以命令行触发：

```bash
# 先登录获取 token
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['access_token'])")

# 触发全量同步
curl -s -X POST http://localhost:8000/api/sync/trigger \
  -H "Authorization: Bearer $TOKEN"
```

### 3.3 验证

同步完成后，Dashboard 应该显示：
- KPI 卡片：进行中项目数、告警数
- 项目列表：来自禅道的真实项目
- 告警列表：自动检测的超期/缺失告警

点击项目可查看甘特图、阶段详情、文档齐套表。

---

## 四、常用操作

| 操作 | 说明 |
|------|------|
| 同步数据 | 侧边栏「同步数据」按钮，全量从禅道拉取 |
| 搜索项目 | Dashboard 搜索框支持按代号/名称/客户/PM/阶段搜索 |
| 筛选类型 | 全部/研发项目/生产项目 Tab |
| 主题切换 | 侧边栏底部浅色/深色切换 |
| 查看详情 | 点击项目行 → 甘特图/阶段/文档/交付/资料 5 个 Tab |

---

## 五、API 端点

### 认证
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/login` | 登录，返回 JWT |
| GET | `/api/auth/me` | 当前用户信息 |

### 数据
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/dashboard/kpi` | KPI 卡片数据 |
| GET | `/api/dashboard/projects` | 项目列表（?search=&type=RD&page=1&limit=50） |
| GET | `/api/dashboard/alerts` | 告警列表 |
| GET | `/api/projects` | 所有项目（简要） |
| GET | `/api/projects/{id}` | 项目详情 |
| GET | `/api/projects/{id}/gantt` | 甘特图数据 |
| GET | `/api/projects/{id}/stages` | 阶段详情 |
| GET | `/api/projects/{id}/documents` | 文档齐套表 |
| GET | `/api/projects/{id}/delivery` | 交付状态 |
| GET | `/api/projects/{id}/resources` | 资料链接 |

### 同步
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/sync/trigger` | 手动触发全量同步（需 admin） |
| GET | `/api/sync/status` | 各实体最后同步状态（需 admin） |
| GET | `/api/sync/progress` | 同步进度（需登录） |
| POST | `/api/sync/pause` | 暂停同步 |
| POST | `/api/sync/resume` | 恢复同步 |
| POST | `/api/sync/cancel` | 取消同步 |

### 管理
| 方法 | 路径 | 说明 |
|------|------|------|
| GET/PUT | `/api/admin/config` | 数据源配置（需 admin） |
| GET/POST | `/api/admin/users` | 用户列表/创建（需 admin） |
| PUT/DELETE | `/api/admin/users/{id}` | 更新/删除用户（需 admin） |
| GET/PUT | `/api/admin/users/{id}/roles` | 用户角色组（需 admin） |
| GET | `/api/admin/users/roles` | 角色组列表（需 admin） |
| PUT | `/api/admin/users/roles/{id}` | 更新角色权限（需 admin） |
| GET | `/api/admin/users/permissions` | 权限元数据（需 admin） |
| POST | `/api/admin/clear-db` | 清除缓存数据（需 admin） |
| GET | `/api/logs` | 系统日志（需 admin） |
| POST | `/api/logs/clear` | 清除日志（需 admin） |

---

## 六、故障排查

### 禅道连接失败

```
Zentao API unreachable
```

- 检查 `.env` 中 `ZENTAO_BASE_URL` 是否正确
- 从服务器 ping 禅道地址：`curl http://192.168.0.124:8800`
- 检查防火墙规则

### 禅道认证失败

```
Zentao auth failed
```

- 确认 `.env` 中账号密码正确
- 确认该账号有 API 访问权限
- 确认账号未被锁定

### 同步后无数据

- 查看同步日志：`GET /api/sync/status` 查看各实体同步状态
- 确认禅道中确实有项目数据
- 尝试手动重新同步

### SQLite 锁文件

```
database is locked
```

- 确保只有一个 uvicorn worker 在运行（不要在启动时用 `--workers > 1`）

### 系统日志查看

PMA 自动记录日志到两个位置：

| 存储位置 | 路径/表 | 说明 |
|---------|---------|------|
| 文件日志 | `data/pma.log`（+ `pma.log.1/2/3` 滚动备份） | RotatingFileHandler，单文件 5MB |
| 数据库日志 | `log_entries` 表 | 每次请求自动写入，按时间戳+级别索引，持久保留 |

**前端日志查看器**（管理员专用）：
1. 侧边栏「管理」→「系统日志」
2. 下拉选择日志级别（INFO/DEBUG/WARNING/ERROR/CRITICAL）
3. 下拉选择显示条数（100/200/500/1000）
4. 支持关键词搜索
5. 默认 15 秒自动刷新（错误级别越高刷新越快：ERROR=5s, CRITICAL=3s）

**数据库直接查询**：
```sql
sqlite3 data/pma.db "SELECT timestamp, level, logger, message FROM log_entries ORDER BY timestamp DESC LIMIT 50;"
```

### 端口被占用

```
Address already in use
```

- 更换端口：`--port 8081`
- 查找占用进程：`lsof -i :8000`

---

## 七、目录结构

```
pma/
├── backend/              # Python 后端
│   ├── main.py           # FastAPI 入口 + 自动同步后台任务
│   ├── config.py         # 配置管理（.env + Settings.reload）
│   ├── database.py       # 数据库连接 + 表创建 + seed 用户
│   ├── models/           # 数据模型（zentao.py / local.py / bug.py / delivery.py）
│   ├── schemas/          # Pydantic 请求/响应模型
│   ├── routers/          # API 路由（14 个模块）
│   │   ├── auth.py       # 登录/修改密码
│   │   ├── admin_users.py # 用户管理 CRUD
│   │   ├── config.py     # 数据源配置
│   │   ├── dashboard.py  # KPI + 项目列表 + 告警
│   │   ├── projects.py   # 项目详情 + 甘特图 + 阶段 + 笔记
│   │   ├── products.py   # 产品管理
│   │   ├── topology.py   # 产品拓扑（快速检索）
│   │   ├── sync.py       # 同步触发/暂停/取消/进度
│   │   ├── delivery.py   # 交付记录
│   │   ├── reports.py    # 项目报表
│   │   ├── logs.py       # 系统日志
│   │   └── ...
│   ├── services/         # 业务逻辑
│   │   ├── sync_service.py    # 同步引擎（并发 + 增量 + 自动）
│   │   ├── zentao_client.py   # 禅道 REST API 客户端
│   │   ├── project_service.py # 项目/甘特图/阶段/笔记
│   │   ├── product_service.py # 产品管理
│   │   ├── dashboard_service.py # Dashboard + 告警检测
│   │   └── ...
│   └── middleware/       # JWT 认证中间件
├── frontend/             # 前端静态文件
│   ├── index.html        # SPA 主页面（所有视图）
│   ├── login.html        # 登录页
│   ├── favicon.svg       # 网站图标
│   ├── logo/             # Logo 资源（light/dark）
│   ├── css/              # 样式（6 个文件）
│   │   ├── tokens.css    # CSS 变量（深浅主题）
│   │   ├── reset.css     # 重置样式
│   │   ├── layout.css    # 侧边栏 + 顶栏
│   │   ├── components.css # 通用组件 + Dashboard + 产品
│   │   ├── gantt.css     # 甘特图
│   │   └── detail.css    # 项目详情 + 日志 + 弹窗
│   └── js/               # 脚本（13 个模块）
│       ├── app.js        # 主入口 + 视图路由 + 自动同步 UI
│       ├── api.js        # API 封装
│       ├── auth.js       # 登录/认证
│       ├── utils.js      # 工具函数
│       ├── dashboard.js  # Dashboard 渲染
│       ├── detail.js     # 项目详情 + 甘特图
│       ├── product.js    # 产品管理
│       ├── topology.js   # 快速检索
│       ├── reports.js    # 报表
│       ├── logs.js       # 系统日志
│       ├── admin.js      # 管理（配置 + 用户）
│       └── components.js # 通用组件
├── data/                 # SQLite 数据文件（自动生成）
│   ├── pma.db            # 主数据库
│   ├── pma.log*          # 运行日志（滚动，.gitignore）
│   └── source_config.json # 数据源配置持久化
├── server.sh             # 运维脚本（start/stop/restart/logs）
├── docker-compose.yml
├── Dockerfile
├── requirements.txt
└── .env                  # 环境变量配置（不提交 git）
```
