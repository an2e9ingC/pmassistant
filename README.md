# PMA — Project Management Assistant

集成禅道 & GitLab 的项目管理助手，提供项目进度视图、甘特图、产品拓扑、交付管理等功能。

## 特性

- **项目总览**：Dashboard KPI + 分类筛选（项目集/状态/类型）+ 告警通知
- **甘特图**：多层时间轴、Ctrl+滚轮缩放、拖拽平移、双层进度条、今日定位
- **项目详情**：阶段详情、文档齐套、交付管理、项目笔记
- **产品总览**：产品线 KPI + 状态过滤 + 标签提取
- **快速检索**：项目/产品/客户三维 AND 搜索
- **数据同步**：禅道 REST API 全量/增量同步 + 自动定时同步 + 进度显示
- **用户管理**：多角色（admin/manager/viewer）+ JWT 认证
- **深浅主题**：CSS 变量令牌体系，一键切换

## 技术栈

| 层 | 技术 |
|---|------|
| 后端 | Python 3.9+ · FastAPI · SQLAlchemy 2.0 · SQLite |
| 前端 | Vanilla JS SPA · CSS Grid/Flexbox · SVG |
| 部署 | Docker · Docker Compose |

## 快速开始

### 1. 环境变量

```bash
cp .env.example .env
# 编辑 .env，填写禅道账号和 JWT 密钥
```

关键配置：

| 变量 | 说明 |
|------|------|
| `ZENTAO_BASE_URL` | 禅道 REST API 地址（如 `http://192.168.0.124:8800/api.php/v1`） |
| `ZENTAO_AUTH_ACCOUNT` | 禅道账号（只读权限即可） |
| `ZENTAO_AUTH_PASSWORD` | 禅道密码 |
| `JWT_SECRET_KEY` | 随机密钥，建议 `python3 -c "import secrets; print(secrets.token_hex(32))"` 生成 |
| `SYNC_INTERVAL_MINUTES` | 自动同步间隔（分钟），0=禁用 |
| `ZENTAO_PROJECT_FILTER` | 项目编号前缀过滤（逗号分隔），如 `PE04,PE0362` |

### 2. 直接运行

```bash
pip install -r requirements.txt
./server.sh start
# 访问 http://localhost:8000
# 默认管理员: admin / admin123
```

### 3. Docker 部署

```bash
# 设置环境变量
export ZENTAO_AUTH_ACCOUNT=your_account
export ZENTAO_AUTH_PASSWORD=your_password
export JWT_SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_hex(32))")

docker compose up -d
# 访问 http://localhost:8080
```

### 4. 首次使用

1. 登录（默认 admin/admin123，请立即修改密码）
2. 进入「数据源配置」配置禅道连接信息
3. 点击右上角「数据源同步」按钮触发首次同步
4. 同步完成后在「项目总览」查看项目数据

## 项目结构

```
pma/
├── backend/              # Python 后端
│   ├── main.py           # FastAPI 入口 + 自动同步
│   ├── config.py         # 配置管理
│   ├── database.py       # 数据库 + 自动迁移
│   ├── models/           # 数据模型
│   ├── routers/          # API 路由
│   ├── services/         # 业务逻辑
│   └── middleware/       # JWT 认证
├── frontend/             # 前端
│   ├── index.html        # SPA 主页面
│   ├── login.html        # 登录页
│   ├── css/              # 样式
│   └── js/               # 脚本
├── docs/                 # 文档
│   ├── dev-plan.md       # 开发计划
│   ├── design-spec.md    # 设计规范
│   ├── deploy-guide.md   # 部署指南
│   └── requirements-spec.md  # 需求规格
├── docker-compose.yml
├── Dockerfile
├── requirements.txt
└── server.sh             # 运维脚本
```

## 文档

- [开发计划](docs/dev-plan.md)
- [设计规范](docs/design-spec.md)
- [部署指南](docs/deploy-guide.md)
- [需求规格](docs/requirements-spec.md)
