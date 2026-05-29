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
├── backend/          # Python 后端
│   ├── main.py       # FastAPI 入口
│   ├── config.py     # 配置
│   ├── database.py   # 数据库连接
│   ├── models/       # 数据模型
│   ├── schemas/      # 请求/响应模型
│   ├── routers/      # API 路由
│   ├── services/     # 业务逻辑
│   └── middleware/   # JWT 认证
├── frontend/         # 前端静态文件
│   ├── index.html    # 主页面
│   ├── login.html    # 登录页
│   ├── css/          # 样式
│   └── js/           # 脚本
├── data/             # SQLite 数据文件（自动生成）
│   ├── pma.db        # 主数据库
│   └── pma.log*      # 运行日志文件（滚动，.gitignore）
├── docker-compose.yml
├── Dockerfile
├── requirements.txt
└── .env              # 配置文件（不提交 git）
```
