# PMA — Project Management Assistant

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Python](https://img.shields.io/badge/Python-3.9%2B-blue.svg)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115%2B-009688.svg)](https://fastapi.tiangolo.com/)

PMA 是一个**只读聚合项目管理仪表盘**，从禅道（Zentao）、GitLab、NAS 文件系统拉取数据，统一展示项目进度、甘特图、产品拓扑、任务与 Bug 管理、交付管理等。核心定位是「只读聚合展示，绝不回写外部系统」。

## ✨ 特性

- **项目总览**：Dashboard KPI 卡片 + 分类筛选（项目集/状态/类型）+ 告警联动 + Bug 环形图
- **甘特图**：多层时间轴、Ctrl+滚轮缩放、拖拽平移、双层进度条、今日定位
- **项目详情**：阶段详情、文档齐套、交付状态、SVN 同步、项目笔记、文档模板
- **产品管理**：产品总览 + 三级节点 + 框图 + 文档分类进度圆环 + 产品拓扑三维搜索
- **任务管理**：PMA 本地任务 CRUD + 工时填报 + 批量导入 + 团队任务个人进度
- **Bug 管理**：本地 Bug CRUD + 禅道导入 + GitLab Issue 联动 + 看板/报表视图
- **客户管理**：客户 CRUD + 项目/产品关联
- **统计报表**：周报/月报/季报/年报 + 人力工时报表 + 企微打卡统计
- **权限体系**：角色 + 细粒度权限（9 种）+ JWT 认证 + GitLab OAuth
- **数据同步**：禅道/GitLab/NAS 三源全量同步 + 后台定时 + 前端实时进度
- **主题切换**：浅色/深色 CSS 变量令牌体系

## 🛠 技术栈

| 层 | 技术 |
|---|------|
| 后端 | Python 3.9+ · FastAPI · SQLAlchemy 2.0 · SQLite（可选 SQLCipher 加密） |
| 前端 | Vanilla JS SPA（无框架）· CSS Grid/Flexbox · SVG |
| 部署 | Docker · Docker Compose |

> 设计约束：前端**不引入 React/Vue/Node 构建链**，后端**不引入 PostgreSQL**，保持轻量单容器部署。

## 🚀 快速开始

### 方式一：本地直接运行

```bash
# 1. 安装依赖
pip install -r requirements.txt

# 2. 准备配置
cp .env.example .env
#    编辑 .env，填写禅道/GitLab/NAS 连接信息与 JWT_SECRET_KEY

# 3. 启动
./server.sh start
# 访问 http://localhost:8000
```

### 方式二：Docker Compose

```bash
cp .env.example .env
#    填写 ZENTAO_AUTH_ACCOUNT / ZENTAO_AUTH_PASSWORD / JWT_SECRET_KEY 等

docker compose up -d
# 访问 http://localhost:8080
```

首次登录使用默认管理员账号（`admin` / `admin123`），**请立即修改密码**。

## ⚙️ 环境变量

| 变量 | 说明 |
|------|------|
| `ZENTAO_BASE_URL` | 禅道 REST API 地址（如 `http://<禅道服务器>:<端口>/api.php/v1`） |
| `ZENTAO_AUTH_ACCOUNT` | 禅道账号（只读权限即可） |
| `ZENTAO_AUTH_PASSWORD` | 禅道密码 |
| `JWT_SECRET_KEY` | 随机密钥，`python3 -c "import secrets; print(secrets.token_hex(32))"` 生成 |
| `GITLAB_BASE_URL` / `GITLAB_TOKEN` | GitLab API 地址与访问令牌 |
| `NAS_HOST` / `NAS_USERNAME` / `NAS_PASSWORD` | NAS 文件系统连接 |
| `SYNC_INTERVAL_MINUTES` | 自动同步间隔（分钟），0 = 禁用 |
| `ZENTAO_PROJECT_FILTER` | 项目编号前缀过滤（逗号分隔） |
| `SQLCIPHER_KEY_FILE` | （可选）SQLCipher 密钥文件路径，启用数据库加密 |

完整配置说明见 [docs/deploy-guide.md](docs/deploy-guide.md)。

## 📁 项目结构

```
pma/
├── backend/              # Python 后端
│   ├── main.py           # FastAPI 入口 + 自动同步
│   ├── config.py         # 配置管理
│   ├── database.py       # 数据库 + 自动迁移
│   ├── models/           # 数据模型（SQLAlchemy）
│   ├── routers/          # API 路由
│   ├── services/         # 业务逻辑 + 外部数据源同步
│   └── middleware/       # JWT 认证
├── frontend/             # 前端 SPA（Vanilla JS）
│   ├── index.html        # 主页面
│   ├── login.html        # 登录页
│   ├── css/              # 样式（CSS 变量令牌体系）
│   └── js/               # 脚本
├── docs/                 # 文档（开发计划/设计规范/部署/数据库/审计日志）
├── scripts/              # 运维脚本
├── docker-compose.yml    # Docker 编排
├── Dockerfile
├── requirements.txt
└── server.sh             # 本地运维脚本（start/stop/restart/status）
```

## 📚 文档

- [部署指南](docs/deploy-guide.md)
- [数据库设计](docs/db.md)
- [UI 设计规范](docs/design-spec.md)
- [开发计划与版本历史](docs/dev-plan.md)
- [审计日志说明](docs/audit-log.md)

## 🔒 安全声明

- **请勿提交敏感文件**：`.env`、`data/*.db`、`secrets/`、`data/source_config-*.json`、日志文件均已加入 `.gitignore`，请勿用 `git add -f` 强制提交。
- **只读原则**：PMA 只从外部系统读取数据，绝不回写禅道/GitLab/NAS。
- **默认密码**：初始管理员账号 `admin/admin123` 仅用于首次登录，务必立即修改。
- **SQLCipher 加密**（可选）：用 `gen-sqlcipher-key.py` 生成密钥并 rekey 数据库，密钥文件不要纳入版本控制。

## 📄 许可证（双许可）

本项目采用**双许可**：

- **开源版**：遵循 [GNU Affero General Public License v3.0](LICENSE)（AGPL-3.0）—— 免费用于开源/内部用途；若通过网络提供服务（SaaS），同样需以 AGPL-3.0 开源派生代码。
- **商业授权**：如需闭源、商用或 SaaS 部署但不愿履行 AGPL 义务，可联系获取商业授权，详见 [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md)。

## 🤝 贡献

欢迎提交 Issue 与 Pull Request。贡献前请阅读 [CLAUDE.md](CLAUDE.md)（开发指南）了解代码结构与开发规范。
