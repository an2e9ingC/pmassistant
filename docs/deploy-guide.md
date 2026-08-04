# PMA 部署运行指南

## 环境要求

| 依赖 | 最低版本 |
|------|---------|
| Python（直接运行） | 3.9+ |
| Docker（容器运行） | 24+ |
| 磁盘 | 100MB（SQLite 数据 + 依赖） |
| 网络 | 可访问禅道服务器 `192.168.0.124:8800` |

---

## 一、Docker 部署

PMA 支持三种部署方式。Docker 镜像自带 Python 运行时 + 所有依赖，目标服务器只需 Docker。

### 1.0 场景速览

```
联网构建机                          目标服务器
┌──────────┐    tar.gz + scp        ┌──────────┐
│ 方式A:   │ ──────────────────────►│ 离线安装  │ ← 目标完全无外网
│ 离线包   │   pma-docker-*.tar.gz  │ install.sh│
│          │                        └──────────┘
│ 方式B:   │    docker push         ┌──────────┐
│ Registry │ ──────────────────────►│ pull + run│ ← 目标可访问 GitLab
│          │                        └──────────┘
│ 方式C:   │         —              ┌──────────┐
│ 直接运行 │                        │ server.sh │ ← 开发/测试
└──────────┘                        └──────────┘
```

| 方式 | 目标服务器要求 | sudo 操作 |
|------|--------------|----------|
| A — 离线包 | Docker，无需网络 | `bash install.sh`（含 docker load/compose up） |
| B — Registry pull | Docker + 可访问 GitLab | `docker login`、`docker pull`、`docker compose up` |
| C — 直接运行 | Python 3.9+，pip | （无需 sudo，pip install 可用 `--user`） |

---

### 1.1 构建镜像包

> **在有源码的联网机器上执行。** 需 sudo 权限（Docker 操作）。

```bash
cd pma/

# 查看帮助
bash scripts/docker-build.sh --help

# 完整构建：镜像 + tar.gz + GitLab Registry push
sudo bash scripts/docker-build.sh

# 仅构建本地 tar.gz（不 push Registry）
sudo bash scripts/docker-build.sh --skip-upload

# 指定版本标签和目标发服务器的python，默认python 3.10
sudo bash scripts/docker-build.sh --python 3.12 --tag pma:v2.0
```

**产出**：

| 产物 | 路径 | 说明 |
|------|------|------|
| `pma-docker-py<ver>-<version>.tar.gz` | 项目根目录 | 离线部署包，内含镜像+docker-compose+install.sh |
| Docker 镜像 | GitLab Registry | `docker pull` 直接拉取 |

---

### 1.2 方式A — 离线包部署

> **在目标服务器上执行。** install.sh 内含 sudo 操作（docker load/compose up）。

#### 部署前确认

```bash
# 确认 Docker 版本 >= 20.10
docker --version 2>/dev/null || echo "Docker 未安装"

# 确认 Docker daemon 运行中
sudo docker info > /dev/null 2>&1 && echo "Docker: OK" || echo "Docker: 未运行或无权限"

# 确认磁盘空间 >= 1GB
df -h /opt | tail -1
```

如果 Docker 未安装（参考 [附录F — 安装 Docker](#附录f--安装-docker)）：

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker
```

#### 安装路径

所有文件放在你指定的安装目录下，推荐 `/opt/pma`。`data/` 由 install.sh 自动创建在安装目录内。

```
/opt/pma/                       ← 你创建的安装目录（可任意选择）
├── docker-compose.yml          ← install.sh 从离线包解出
├── .env                        ← install.sh 从 .env.example 复制生成
├── data/                       ← install.sh 自动创建
│   ├── pma.db                  ← 首次启动自动生成
│   ├── pma.log                 ← 运行日志
│   └── uploads/                ← 上传文件
└── install.log                 ← 安装日志
```

#### 部署

```bash
# 1. 从构建机传输到目标服务器
scp pma-docker-py310-*.tar.gz root@<目标IP>:/opt/

# 2. 解压 + 一键安装
ssh root@<目标IP>
mkdir -p /opt/pma && cd /opt/pma             # ← 安装目录，可改为其他路径
tar xzf /opt/pma-docker-py310-*.tar.gz
cd docker-package
sudo bash install.sh                          # data/ 创建在当前目录
```

install.sh 自动完成：Docker 检查 → `docker load` 加载镜像 → 创建 `.env` → 创建 `data/` → `docker compose up -d` → 健康检查。

**离线包内容**：

```
docker-package/
├── pma-image.tar.gz        # Docker 镜像
├── docker-compose.yml      # 生产 compose 配置
├── .env.example            # 环境变量模板
└── install.sh              # 一键安装脚本
```
**升级**（不会丢失数据）：

> **升级原理**：数据库、配置、上传文件均在宿主机 `data/` 和 `.env` 中，Docker volume 挂载到容器内。升级只替换 Docker 镜像，不动宿主机文件。

| 文件/目录 | 位置 | 升级后 |
|-----------|------|--------|
| 数据库（项目、用户、配置） | `data/pma.db` | ✅ 保留 |
| 上传文件（图片、Bug 附件等） | `data/uploads/` | ✅ 保留 |
| 运行日志 | `data/pma-8000.log` | ✅ 保留 |
| 环境配置 | `.env` | ✅ 保留 |

```bash
# 用新包升级（数据安全，不动 data/ 和 .env）
tar xzf pma-docker-新版本.tar.gz
cd docker-package && sudo bash install.sh
```

---

### 1.3 方式B — Registry Pull 部署

> **在目标服务器上执行。** 需要 sudo（Docker 操作）。

#### 安装路径

所有文件统一放在一个目录下，推荐 `~/pma`。

```
~/pma/                              ← 你创建的部署目录（可任意选择）
├── docker-compose.yml              ← 从镜像内提取
├── .env                            ← 从镜像内提取
├── data/                           ← 手动 mkdir 创建，volume 挂载
│   ├── pma.db                      ← 首次启动自动生成
│   ├── pma.log                     ← 运行日志
│   └── uploads/                    ← 上传文件（图片、Bug 附件）
└── install.log                     ← 安装日志
```

> **`data/` 是唯一需要备份的目录** — 含数据库、上传文件、日志。`.env` 可由镜像重新提取。即使 `docker-compose.yml` 丢失，`data/pma.db` 尚在数据就完好。详见 [2.3 从已有部署导入](#23-方式三--从已有部署导入)。

#### 查看可用版本

```bash
# Registry API（不需要登录）
curl -s http://192.168.0.128:5050/v2/bsp_dev/fake_it/pma/pma/tags/list | python3 -m json.tool
```

返回示例：

```json
{
    "name": "bsp_dev/fake_it/pma/pma",
    "tags": [
        "v2026.08.02-beta14",
        "v2026.08.04-beta1"
    ]
}
```

> 也可以在浏览器查看：`http://192.168.0.128/bsp_dev/fake_it/pma/container_registry`

**获取版本后，在后续部署步骤中替换 `<version>`**：

```bash
# 假设要部署 v2026.08.04-beta1
VERSION="v2026.08.04-beta1"

sudo docker pull 192.168.0.128:5050/bsp_dev/fake_it/pma/pma:${VERSION}
sudo docker tag 192.168.0.128:5050/bsp_dev/fake_it/pma/pma:${VERSION} pma:latest
```

#### 首次部署

```bash
# 0. 环境确认
docker --version          # 需要 >= 20.10
sudo docker info > /dev/null 2>&1 && echo "Docker OK"
df -h . | tail -1         # 确认磁盘空间 >= 1GB
curl -s -o /dev/null -w "%{http_code}" http://192.168.0.128:5050/v2/  # 确认 Registry 可达（返回 401 为正常）

# 1. 创建部署目录（可改为任意路径）
mkdir -p ~/pma && cd ~/pma

# 2. 配置 Docker（仅首次）—— 允许 HTTP Registry
# snap 版: /var/snap/docker/current/config/daemon.json
# apt 版:  /etc/docker/daemon.json
sudo tee /var/snap/docker/current/config/daemon.json << 'EOF'
{"insecure-registries":["192.168.0.128:5050"]}
EOF
sudo snap restart docker           # snap 版
# sudo systemctl restart docker    # apt 版

# 3. 登录 GitLab Registry（仅首次）
sudo docker login 192.168.0.128:5050 -u <GitLab用户名>
# 输入密码

# 3. 拉取镜像（路径 = GitLab仓库地址 + /pma + :版本号）
sudo docker pull 192.168.0.128:5050/bsp_dev/fake_it/pma/pma:<version>
# 镜像路径说明: <GitLab地址>:5050/<group>/<project>/<repo>/pma:<version>

# 4. 打短标签
sudo docker tag 192.168.0.128:5050/bsp_dev/fake_it/pma/pma:<version> pma:latest
sudo docker run --rm pma:latest cat /app/deploy/docker-compose.prod.yml > docker-compose.yml
sudo docker run --rm pma:latest cat /app/deploy/.env.example > .env

# 6. 创建数据目录
mkdir -p data

# 7. 启动
sudo docker compose up -d
```

**升级**（不会丢失数据）：

> 升级只替换镜像，`data/`（数据库+上传文件+日志）和 `.env`（配置）保留不变。

```bash
# 1. 拉取新镜像
sudo docker pull 192.168.0.128:5050/bsp_dev/fake_it/pma/pma:<新版本>

# 2. 更新标签 + 重启（data/ 和 .env 不受影响）
sudo docker tag <新镜像> pma:latest
sudo docker compose down && sudo docker compose up -d
```

---

### 1.4 方式C — 直接运行

> **在目标服务器上执行。** 无需 sudo。

```bash
# 1. 安装依赖
pip install -r requirements.txt

# 2. 创建配置
cp .env.example .env
vi .env                              # 填写禅道连接信息

# 3. 启动
./server.sh start -p 8000

# 4. 管理
./server.sh status                   # 查看状态
./server.sh restart -p 8000          # 重启
./server.sh logs                     # 查看日志
./server.sh stop                     # 停止
```

---

## 二、部署后配置

PMA 支持两种配置方式，可单独使用也可混合使用。配置修改后需重启服务生效。

### 2.1 方式一 — .env 文件

适用场景：首次部署、批量部署、自动化运维。

```bash
vi .env

# 必填：
#   ZENTAO_BASE_URL       禅道 API 地址（见 附录A）
#   ZENTAO_AUTH_ACCOUNT    禅道账号
#   ZENTAO_AUTH_PASSWORD   禅道密码
#
# 建议修改：
#   JWT_SECRET_KEY         登录密钥
#   生成: python3 -c "import secrets; print(secrets.token_hex(32))"
#
# 可选：
#   GITLAB_*               GitLab OAuth / Issue 集成（见 附录B）
#   NAS_*                  NAS 文件预览（见 附录C）
#   WECOM_*                企业微信打卡（见 附录D）
#   PMA_PORT               服务端口
#   LOG_LEVEL              日志级别
#   SYNC_INTERVAL_MINUTES   自动同步间隔
#   SQLCIPHER_KEY          数据库加密密钥

# 修改后重启（Docker）
docker compose restart

# 修改后重启（直接运行）
./server.sh restart -p 8000
```

### 2.2 方式二 — Web 管理后台

适用场景：部署后日常运维、不熟悉命令行的用户。

1. 浏览器访问 `http://<服务器IP>:8000`
2. 登录 `admin / admin123`（首次登录后建议改密码）
3. 点击右上角`数据源配置`->`数据源配置`进入配置页面；
4. 填写禅道、GitLab、NAS、企业微信等配置
5. 点击「保存配置」→ 配置自动持久化到数据库

> Web 后台配置优先级**高于** `.env` 文件，两者同时配置时以后台为准。

### 2.3 方式三 — 从已有部署导入

适用场景：已有运行中的 PMA，数据迁移到新服务器。

```bash
# 1. 从旧服务器导出
scp root@<旧服务器>:/opt/pma/data/pma.db /tmp/
scp root@<旧服务器>:/opt/pma/.env /tmp/

# 2. 导入到新服务器（Docker）
sudo docker cp /tmp/pma.db pma:/app/data/pma.db
cp /tmp/.env .env
sudo docker compose restart

# 2. 导入到新服务器（直接运行）
cp /tmp/pma.db data/pma.db
cp /tmp/.env .env
./server.sh restart -p 8000
```

### 2.4 默认管理员

| 属性 | 值 |
|------|-----|
| 用户名 | `admin` |
| 密码 | `admin123`（首次启动自动创建，**登录后请修改**） |

---

## 三、配置参考

以下配置章节按需查阅，通过 Web 管理后台或 `.env` 文件均可配置。

| 配置项 | 章节 | 说明 |
|--------|------|------|
| 禅道连接 | [附录A](#附录a--禅道-api-配置) | API 地址、账号密码 |
| GitLab OAuth 登录 | [附录B](#附录b--gitlab-oauth-用户认证可选) | SSO 单点登录 |
| GitLab Issue 集成 | `.env` 中 `GITLAB_TOKEN` / `GITLAB_PROJECT_PATH` | 创建/评论 Issue |
| NAS 文件访问 | [附录C](#附录c--nassmb-文件访问可选文档预览需要) | PDF/图片/Office 预览 |
| 远端备份同步 | [附录D](#附录d--远端备份同步可选数据安全推荐开启) | 数据库自动备份到 NAS |
| 企业微信 | [附录E](#附录e--企业微信打卡数据接入可选) | 打卡工时数据接入 |

---

## 四、首次使用

### 4.1 登录

默认管理员账号：`admin` / `admin123`

### 4.2 同步数据

1. 登录后进入 Dashboard
2. 点击左侧边栏「同步数据」按钮
3. 等待同步完成（根据数据量，约 30 秒 ~ 2 分钟）

也可命令行触发：

```bash
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['access_token'])")

curl -s -X POST http://localhost:8000/api/sync/trigger \
  -H "Authorization: Bearer $TOKEN"
```

### 4.3 验证

同步完成后 Dashboard 应显示：KPI 卡片、项目列表、告警列表。

---

## 五、运维管理

### 5.1 服务管理（Docker）

```bash
# 所有操作在 docker-compose.yml 所在目录执行
docker compose logs -f               # 实时日志
docker compose restart               # 重启
docker compose stop                  # 停止
docker compose start                 # 启动
docker compose down                  # 停止并删除容器
docker compose up -d                 # 重新创建并启动
docker compose exec pma bash         # 进入容器内部
```

### 5.2 服务管理（直接运行）

```bash
./server.sh status                   # 查看状态
./server.sh start -p 8000            # 启动
./server.sh restart -p 8000          # 重启
./server.sh stop                     # 停止所有
./server.sh stop -p 8000             # 停止指定端口
./server.sh logs                     # 查看日志
./server.sh tail                     # 实时日志
```

### 5.3 常用操作

| 操作 | 说明 |
|------|------|
| 同步数据 | 侧边栏「同步数据」按钮，全量从禅道拉取 |
| 搜索项目 | Dashboard 搜索框支持按代号/名称/客户/PM/阶段搜索 |
| 筛选类型 | 全部 / 研发项目 / 生产项目 Tab |
| 主题切换 | 侧边栏底部浅色 / 深色切换 |
| 查看详情 | 点击项目行 → 甘特图 / 阶段 / 文档 / 交付 / 资料 5 个 Tab |

---

## 六、故障排查

### 6.1 Registry pull 失败（HTTPS/HTTP）

```
http: server gave HTTP response to HTTPS client
```

配置 `insecure-registries`：

```bash
# snap 版 Docker
sudo tee /var/snap/docker/current/config/daemon.json << 'EOF'
{"insecure-registries":["192.168.0.128:5050"]}
EOF
sudo snap restart docker

# apt 版 Docker
sudo tee /etc/docker/daemon.json << 'EOF'
{"insecure-registries":["192.168.0.128:5050"]}
EOF
sudo systemctl restart docker
```

### 6.2 Registry 访问被拒

```
access forbidden
```

先登录：`sudo docker login 192.168.0.128:5050 -u <用户名>`

### 6.3 Docker 权限不足

```
permission denied while trying to connect to the Docker daemon
```

```bash
sudo usermod -aG docker $USER        # 将用户加入 docker 组
newgrp docker                         # 当前会话生效
# 或所有 docker 命令前加 sudo
```

### 6.4 禅道连接失败

```
Zentao API unreachable
```

- 检查 `ZENTAO_BASE_URL` 配置是否正确
- 从服务器测试：`curl http://192.168.0.124:8800`
- 确认禅道 API 路径前缀（详见 [附录A](#附录a--禅道-api-配置)）

### 6.5 端口被占用

```bash
# Docker: 修改 .env 中 PMA_PORT
echo "PMA_PORT=8001" >> .env
sudo docker compose down && sudo docker compose up -d

# 直接运行: ./server.sh start -p 8001
```

### 6.6 系统日志查看

| 存储位置 | 路径 | 说明 |
|---------|------|------|
| 文件日志 | `data/pma-8000.log` | 滚动备份 .1/.2/.3，单文件 5MB |
| 数据库日志 | `log_entries` 表 | 每次请求自动写入 |
| Docker 日志 | `docker compose logs` | 容器标准输出 |

---

## 七、卸载

### Docker 部署

```bash
# 1. 停止并删除容器、网络
sudo docker compose down

# 2. 删除镜像（可选，释放磁盘空间）
sudo docker rmi pma:latest

# 3. 删除数据（⚠ 不可恢复！含数据库、上传文件、日志）
rm -rf data/
rm -f .env docker-compose.yml install.log

# 4. 清理 Docker 构建缓存（可选）
sudo docker builder prune
```

### 直接运行

```bash
# 1. 停服
./server.sh stop

# 2. 删除数据（⚠ 不可恢复！）
rm -rf data/
rm -f .env

# 3. 卸载 Python 依赖（可选）
pip uninstall -y -r requirements.txt
```

---

## 八、目录结构

```
pma/
├── backend/              # Python 后端
├── frontend/             # 前端静态文件
├── data/                 # 持久化数据（运行时生成，volume 挂载，升级不丢失）
│   ├── pma.db            # 主数据库（用户、项目、配置等全部数据）
│   ├── pma.log*          # 运行日志
│   └── uploads/          # 上传文件（图片、Bug 附件等）
├── scripts/              # 辅助脚本
│   ├── docker-build.sh   # Docker 离线包构建
│   └── install.sh.template  # 离线安装脚本模板
├── server.sh             # 运维脚本（start/stop/restart/logs）
├── docker-compose.yml    # 开发环境（bind-mount 源码）
├── docker-compose.prod.yml  # 生产环境（镜像自包含）
├── Dockerfile
├── requirements.txt
└── .env                  # 环境变量配置（不提交 git）
```

---

## 附录A — 禅道 API 配置

禅道 REST API 与 Web UI 运行在同一端口，路径为 `/api.php/v1/`。

**确定 API 地址**：

- 如果禅道访问地址为 `http://192.168.0.124:8800/`，则 API 为 `http://192.168.0.124:8800/api.php/v1`
- 如果禅道访问地址为 `http://192.168.3.22/zentao/`，则 API 为 `http://192.168.3.22/zentao/api.php/v1`

验证：`curl http://<API地址>/users` 应返回 JSON（不是 404 HTML）。

**账号要求**：需有 API 访问权限的禅道账号（推荐创建专用只读账号），最低权限：查看项目、任务、Bug、用户、产品。

---

## 附录B — GitLab OAuth 用户认证（可选）

### 步骤 1：注册 GitLab OAuth Application

1. 登录 GitLab → **Admin Area** → **Applications**
2. 填写：
   - **Name**: `PMA_system`
   - **Redirect URI**: `http://<PMA地址>:8000/api/auth/gitlab/callback`
   - **Scopes**: 勾选 `read_user` + `api`
   - **Trusted**: ✅ 勾选（跳过用户授权确认页）
   - **Confidential**: ✅ 勾选（必须，支持 token 自动刷新）
3. 保存，记录 **Application ID** 和 **Secret**

### 步骤 2：配置 PMA

**方式 A（推荐）**：PMA 管理后台 → 数据源配置 → GitLab 区域填写。

**方式 B**：`.env` 中添加：

```ini
GITLAB_APP_ID=<Application ID>
GITLAB_APP_SECRET=<Secret>
GITLAB_OAUTH_ENABLED=true
GITLAB_OAUTH_REDIRECT_URI=http://<PMA地址>:8000/api/auth/gitlab/callback
```

---

## 附录C — NAS/SMB 文件访问（可选，文档预览需要）

Docker 镜像已内置 `pysmb`。直接运行需手动安装：

```bash
pip install pysmb
```

配置路径：PMA 管理后台 → 数据源配置 → NAS 存储，填写主机地址、用户名、密码。

文档 URL 格式：`\\192.168.0.180\共享名\路径\文件.pdf`，无需额外挂载。

---

## 附录D — 远端备份同步（可选，数据安全推荐开启）

PMA 支持将数据库 + `.env` 备份自动同步到远端 NAS。

- **Docker 部署**：镜像已内置 `smbclient`，无需额外安装
- **直接运行**：需 `sudo apt install smbclient`

配置路径：管理后台 → 数据库管理 → 远端备份配置。

---

## 附录E — 企业微信打卡数据接入（可选）

1. 拥有企业微信管理员权限
2. 创建自建应用，记录 CorpID 和 Secret
3. 配置应用权限（打卡、审批、通讯录）和可信 IP
4. PMA 管理后台 → 数据源配置 → 企业微信填写配置
5. 用户管理 → 编辑用户 → 设置 `wecom_userid`

---

## API 端点参考

### 认证

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/login` | 登录，返回 JWT |
| GET | `/api/auth/me` | 当前用户信息 |

### 数据

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/dashboard/kpi` | KPI 卡片数据 |
| GET | `/api/dashboard/projects` | 项目列表 |
| GET | `/api/dashboard/alerts` | 告警列表 |
| GET | `/api/projects/{id}` | 项目详情 |
| GET | `/api/projects/{id}/gantt` | 甘特图数据 |
| GET | `/api/projects/{id}/documents` | 文档齐套表 |

### 同步

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/sync/trigger` | 手动触发全量同步（需 admin） |
| GET | `/api/sync/status` | 同步状态（需 admin） |
| GET | `/api/sync/progress` | 同步进度（需登录） |

### 管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET/PUT | `/api/admin/config` | 数据源配置（需 admin） |
| GET/POST | `/api/admin/users` | 用户管理（需 admin） |
| GET | `/api/logs` | 系统日志（需 admin） |

---

## 附录F — 安装 Docker

### 联网安装（推荐）

```bash
# 首选 snap（Ubuntu 16.04+，推荐）
sudo snap install docker

# 或官方一键脚本（需外网）
curl -fsSL https://get.docker.com | sudo sh

# 或系统包管理器
sudo apt install -y docker.io          # Ubuntu/Debian

# 将当前用户加入 docker 组（之后无需 sudo 运行 docker 命令）
sudo usermod -aG docker $USER
newgrp docker

# 验证
docker --version
docker run hello-world
```

> **Ubuntu 20.04 (focal) 用户**：安装过程中会提示 "This Linux distribution reached end-of-life"，可安全忽略，Docker 仍能正常安装和运行。

> **如果 `get.docker.com` 不可达**（被墙或无法出外网），首选 snap：
> ```bash
> sudo snap install docker               # 版本最新
> ```
> 或系统包管理器：
> ```bash
> sudo apt install -y docker.io          # 版本 20.10.x，满足要求
> sudo systemctl enable docker --now
# snap 版已自动启用，无需此步骤
> sudo usermod -aG docker $USER
> newgrp docker
> ```

### 离线安装（无外网服务器）

在联网机器上下载 Docker 离线包，然后传输到目标服务器。

```bash
# === 在联网机器上执行 ===

# 下载 Docker 二进制包（以 Ubuntu 22.04 / x86_64 为例）
wget https://download.docker.com/linux/static/stable/x86_64/docker-26.1.0.tgz
wget https://download.docker.com/linux/static/stable/x86_64/docker-26.1.0.tgz.sha256

# 校验
sha256sum -c docker-26.1.0.tgz.sha256

# === 传输到目标服务器 ===
scp docker-26.1.0.tgz root@<目标IP>:/tmp/

# === 在目标服务器上执行 ===
cd /tmp
tar xzf docker-26.1.0.tgz
sudo cp docker/* /usr/bin/
rm -rf docker/

# 创建 docker 用户组
sudo groupadd docker 2>/dev/null || true
sudo usermod -aG docker $USER

# 创建 systemd 服务文件
sudo tee /etc/systemd/system/docker.service << 'EOF'
[Unit]
Description=Docker Daemon
After=network.target

[Service]
Type=notify
ExecStart=/usr/bin/dockerd -H fd://
ExecReload=/bin/kill -s HUP $MAINPID
LimitNOFILE=1048576
LimitNPROC=infinity
TasksMax=infinity
TimeoutStartSec=0
Restart=always

[Install]
WantedBy=multi-user.target
EOF

# 启动 Docker
sudo systemctl daemon-reload
sudo systemctl enable docker
sudo systemctl start docker

# 验证
docker --version
newgrp docker
```

> **Ubuntu/Debian 也可用 deb 包离线安装**：从 `https://download.docker.com/linux/ubuntu/dists/` 下载 `containerd.io`、`docker-ce`、`docker-ce-cli` 三个 deb 包，`sudo dpkg -i *.deb` 安装。
