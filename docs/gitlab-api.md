# GitLab API 开发手册

> **适用版本**: GitLab CE/EE 15.2
> **API 版本**: REST API v4
> **本地实例**: `http://192.168.0.100`
> **编写日期**: 2026-06-09
> **用途**: PMA 系统二次开发 — GitLab 数据集成

---

## 目录

1. [概述与认证](#1-概述与认证)
2. [Projects API — 项目仓库](#2-projects-api--项目仓库)
3. [Releases API — 版本发布](#3-releases-api--版本发布)
4. [Commits API — 提交记录](#4-commits-api--提交记录)
5. [Repository Files API — 仓库文件](#5-repository-files-api--仓库文件)
6. [Branches & Tags API — 分支与标签](#6-branches--tags-api--分支与标签)
7. [Merge Requests API — 合并请求](#7-merge-requests-api--合并请求)
8. [Statistics API — 统计信息](#8-statistics-api--统计信息)
9. [Users API — 用户信息](#9-users-api--用户信息)
10. [PMA 集成实现指南](#10-pma-集成实现指南)
11. [附录：错误码与常见问题](#11-附录错误码与常见问题)

---

## 1. 概述与认证

### 1.1 GitLab 版本确认

```bash
# 通过 API 获取版本信息
curl -H "PRIVATE-TOKEN: <token>" http://192.168.0.100/api/v4/version
```

返回示例:
```json
{
  "version": "15.2.0",
  "revision": "abc1234"
}
```

### 1.2 认证方式

GitLab API v4 支持以下认证方式，PMA 系统使用 **Personal Access Token (PAT)**：

| 方式 | Header | 适用场景 |
|------|--------|---------|
| Personal Access Token | `PRIVATE-TOKEN: <token>` | 服务端集成（PMA 使用此方式） |
| OAuth2 Token | `Authorization: Bearer <token>` | 第三方应用 |
| Session Cookie | `Cookie: _gitlab_session=<cookie>` | 浏览器端（不推荐） |

**生成 PAT** (GitLab 15.2):
1. 登录 GitLab → 右上角头像 → **Preferences**
2. 左侧菜单 → **Access Tokens**
3. 填写名称 (如 `pma-integration`)，勾选 scopes:
   - `read_api` — 只读 API 访问（PMA 推荐）
   - `read_repository` — 读取仓库内容
   - `read_user` — 读取用户信息
4. 点击 **Create personal access token**，复制生成的 token

**PMA 配置** (`.env`):
```bash
GITLAB_BASE_URL=http://192.168.0.100/api/v4
GITLAB_TOKEN=glpat-xxxxxxxxxxxx
```

### 1.3 通用请求格式

```
Base URL: http://192.168.0.100/api/v4
Content-Type: application/json
Authentication: PRIVATE-TOKEN: <token>
```

**分页参数** (所有列表类 API 通用):

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `page` | integer | 1 | 页码 |
| `per_page` | integer | 20 | 每页条数（最大 100） |

**Response Headers**（分页信息）:
```
X-Total: 150          # 总条数
X-Total-Pages: 8      # 总页数
X-Page: 1             # 当前页
X-Per-Page: 20        # 每页条数
X-Next-Page: 2        # 下一页
X-Prev-Page:          # 上一页（空=无上一页）
```

### 1.4 速率限制

GitLab 15.2 默认速率限制（管理员可在 Admin Area → Settings → Network → Rate Limits 调整）:

| 端点类型 | 限制 |
|---------|------|
| 认证接口 | 10 req/min (未认证) |
| 通用 API | 300 req/min (已认证) |
| 文件原始内容 | 30 req/min |

> **建议**: PMA 同步客户端每请求间隔 ≥ 200ms，使用信号量限制并发数 ≤ 10。

---

## 2. Projects API — 项目仓库

> **对应需求**: FR-007 (硬件交付资料 GitLab 仓库), FR-008 (软件交付资料源码链接)
> **官方文档**: https://docs.gitlab.com/ee/api/projects.html

### 2.1 获取项目列表

```
GET /api/v4/projects
```

**关键查询参数**:

| 参数 | 类型 | 说明 | PMA 用法 |
|------|------|------|---------|
| `search` | string | 按名称/路径模糊搜索 | 按项目编号 (PE0444) 或项目代号搜索 |
| `membership` | boolean | 仅返回当前用户为成员的项目 | — |
| `owned` | boolean | 仅返回当前用户拥有的项目 | — |
| `simple` | boolean | 简化返回（仅 id, name, path 等） | 首次同步时使用，减少数据量 |
| `order_by` | string | 排序字段: `id`, `name`, `path`, `created_at`, `updated_at`, `last_activity_at` | `last_activity_at` |
| `sort` | string | `asc` / `desc` | `desc` |
| `archived` | boolean | 是否包含归档项目 | `false`（排除归档） |
| `with_shared` | boolean | 包含共享项目 | `false` |

**请求示例**:
```bash
curl -H "PRIVATE-TOKEN: glpat-xxx" \
  "http://192.168.0.100/api/v4/projects?search=PE0444&per_page=100&simple=true"
```

**响应示例** (关键字段):
```json
[
  {
    "id": 42,
    "name": "PE0444_CDYA",
    "name_with_namespace": "R&D / PE0444_CDYA",
    "path": "pe0444_cdya",
    "path_with_namespace": "rd/pe0444_cdya",
    "description": "国产采集存储",
    "web_url": "http://192.168.0.100/rd/pe0444_cdya",
    "http_url_to_repo": "http://192.168.0.100/rd/pe0444_cdya.git",
    "ssh_url_to_repo": "git@192.168.0.100:rd/pe0444_cdya.git",
    "default_branch": "main",
    "created_at": "2024-01-15T08:00:00.000Z",
    "last_activity_at": "2026-06-08T14:30:00.000Z",
    "archived": false,
    "namespace": {
      "id": 5,
      "name": "R&D",
      "path": "rd",
      "kind": "group"
    },
    "star_count": 2,
    "forks_count": 0,
    "open_issues_count": 3
  }
]
```

### 2.2 获取单个项目

```
GET /api/v4/projects/:id
```

`:id` 可以是数字 ID 或 URL-encoded 路径（如 `rd%2Fpe0444_cdya`）。

### 2.3 获取项目用户/成员

```
GET /api/v4/projects/:id/users
GET /api/v4/projects/:id/members
```

**PMA 用途**: 获取项目成员列表，用于权限校验和人员统计。

### 2.4 PMA 数据模型建议

```python
# 对应 FR-007/FR-008 中的 GitLab 仓库信息
class GitLabProject:
    gitlab_id: int          # GitLab 项目 ID
    name: str               # 项目名称
    path_with_namespace: str # 完整路径 (如 rd/pe0444_cdya)
    web_url: str            # Web 访问链接
    default_branch: str     # 默认分支
    description: str        # 项目描述
    last_activity_at: datetime
    archived: bool
```

---

## 3. Releases API — 版本发布

> **对应需求**: FR-004 (风险通知 — GitLab 未发布告警), FR-008 (最新版本发布路径)
> **对应需求**: Section 4.2/4.3 — GitLab 发布检测、公司规范验证
> **官方文档**: https://docs.gitlab.com/ee/api/releases/

### 3.1 获取发布列表

```
GET /api/v4/projects/:id/releases
```

**查询参数**:

| 参数 | 类型 | 说明 |
|------|------|------|
| `order_by` | string | `released_at` (默认) / `created_at` |
| `sort` | string | `desc` (默认) / `asc` |
| `search` | string | 搜索 release 标题 |

**响应示例**:
```json
[
  {
    "tag_name": "v1.2.0",
    "name": "v1.2.0 — 2026-06-01 BSP固件发布",
    "description": "## Changelog\n- 修复xxx\n- 新增yyy",
    "created_at": "2026-06-01T10:00:00.000Z",
    "released_at": "2026-06-01T10:00:00.000Z",
    "author": {
      "id": 15,
      "name": "张三",
      "username": "zhangsan"
    },
    "commit": {
      "id": "a1b2c3d4e5f6...",
      "short_id": "a1b2c3d"
    },
    "milestones": [
      { "title": "v1.2.0", "state": "active" }
    ],
    "assets": {
      "count": 3,
      "sources": [
        { "format": "zip", "url": "http://..." },
        { "format": "tar.gz", "url": "http://..." }
      ],
      "links": [
        {
          "id": 1,
          "name": "BSP固件包",
          "url": "http://192.168.0.100/rd/pe0444/-/releases/v1.2.0/downloads/bsp.bin",
          "link_type": "other"
        }
      ]
    }
  }
]
```

### 3.2 获取单个发布（按 tag 名称）

```
GET /api/v4/projects/:id/releases/:tag_name
```

**PMA 用途**: 验证特定 tag 是否已有 release，对比公司规范。

### 3.3 创建发布

```
POST /api/v4/projects/:id/releases
```

```json
{
  "tag_name": "v1.3.0",
  "ref": "main",
  "name": "v1.3.0 — 2026-06-09 软件版本发布",
  "description": "## 更新内容\n- 新增xxx\n- 修复yyy",
  "milestones": ["v1.3.0"],
  "assets": {
    "links": [
      {
        "name": "软件安装包",
        "url": "http://192.168.0.100/rd/pe0444/-/releases/v1.3.0/downloads/app.tar.gz",
        "filepath": "/binaries/app.tar.gz",
        "link_type": "package"
      }
    ]
  }
}
```

### 3.4 公司发布规范验证

> **参考**: `http://192.168.0.100/standardization/rd/standard/git-rel`

PMA 系统需要校验的发布合规要素（可配置）:

| 检查项 | 规范要求 | API 字段 |
|--------|---------|---------|
| **Tag 命名** | 符合 `v{version}` 或自定义格式 | `tag_name` |
| **Release 标题** | 包含版本号 + 日期 | `name` |
| **Release 描述** | 非空，包含 Changelog | `description` |
| **附件/产物** | 至少包含 1 个 source/release 附件 | `assets.count > 0` |
| **里程碑** | 关联对应里程碑 | `milestones.length > 0` |

**验证逻辑伪代码**:
```python
async def validate_release(release: dict, rules: dict) -> list[str]:
    """验证 GitLab release 是否符合公司规范，返回告警列表"""
    alerts = []

    # 检查 tag 命名 (配置在 ProcessStandard: GitLab发布.tag_pattern)
    tag_pattern = rules.get("tag_pattern", r"^v\d+\.\d+\.\d+$")
    if not re.match(tag_pattern, release.get("tag_name", "")):
        alerts.append(f"Tag '{release['tag_name']}' 不符合命名规范 {tag_pattern}")

    # 检查 release 标题 (配置在 ProcessStandard: GitLab发布.title_pattern)
    title_pattern = rules.get("title_pattern", r"v\d+\.\d+\.\d+.*\d{4}-\d{2}-\d{2}")
    if not re.match(title_pattern, release.get("name", "")):
        alerts.append(f"Release 标题 '{release.get('name', '')}' 不符合规范")

    # 检查描述非空
    if not release.get("description", "").strip():
        alerts.append("Release 描述为空")

    # 检查附件
    assets = release.get("assets", {})
    if assets.get("count", 0) == 0:
        alerts.append("Release 无附件/产物")

    return alerts
```

---

## 4. Commits API — 提交记录

> **对应需求**: FR-014 (Gitlab 提交统计), FR-015 (项目报表 — 日报/周报/月报/季报/年报)
> **官方文档**: https://docs.gitlab.com/ee/api/commits.html

### 4.1 获取提交列表

```
GET /api/v4/projects/:id/repository/commits
```

**查询参数**:

| 参数 | 类型 | 说明 | PMA 用途 |
|------|------|------|---------|
| `ref_name` | string | 分支/tag 名称 | `main` 或 `master` |
| `since` | string | ISO 8601 日期 | 统计起始时间 |
| `until` | string | ISO 8601 日期 | 统计结束时间 |
| `path` | string | 文件路径过滤 | 按模块统计 |
| `author` | string | 作者用户名 | 按人员统计 |
| `all` | boolean | 所有提交（含未 ref） | `true` 获取完整历史 |
| `with_stats` | boolean | 返回 additions/deletions | `true` 用于统计 |
| `first_parent` | boolean | 仅主线提交（跳过 merge commit 分支历史） | `true` 避免重复计次 |

**请求示例（获取一周内所有提交）**:
```bash
curl -H "PRIVATE-TOKEN: glpat-xxx" \
  "http://192.168.0.100/api/v4/projects/42/repository/commits?ref_name=main&since=2026-06-02T00:00:00Z&until=2026-06-09T00:00:00Z&with_stats=true&first_parent=true&per_page=100"
```

**响应示例**:
```json
[
  {
    "id": "a1b2c3d4e5f6789abcdef0123456789abcdef01",
    "short_id": "a1b2c3d4",
    "title": "feat(gantt): 图例今日线呼吸动画与甘特图同步",
    "author_name": "张三",
    "author_email": "zhangsan@company.com",
    "authored_date": "2026-06-08T14:30:00.000+08:00",
    "committer_name": "张三",
    "committer_email": "zhangsan@company.com",
    "committed_date": "2026-06-08T14:30:00.000+08:00",
    "created_at": "2026-06-08T14:30:00.000+08:00",
    "message": "feat(gantt): 图例今日线呼吸动画与甘特图同步\n",
    "parent_ids": ["b2c3d4e5f6..."],
    "web_url": "http://192.168.0.100/rd/pe0444/-/commit/a1b2c3d4...",
    "stats": {
      "additions": 45,
      "deletions": 12,
      "total": 57
    }
  }
]
```

### 4.2 获取单个提交

```
GET /api/v4/projects/:id/repository/commits/:sha
```

### 4.3 获取提交 diff

```
GET /api/v4/projects/:id/repository/commits/:sha/diff
```

### 4.4 获取提交关联的 MR

```
GET /api/v4/projects/:id/repository/commits/:sha/merge_requests
```

**PMA 用途**: 追踪提交所属的 MR，关联需求/任务。

### 4.5 Commit 统计实现方案

**日报统计** (FR-015):
```python
from datetime import datetime, timedelta

async def get_daily_commit_stats(client, project_id: int, date: date):
    """获取指定项目某一天的提交统计"""
    since = f"{date.isoformat()}T00:00:00+08:00"
    until = f"{date.isoformat()}T23:59:59+08:00"

    commits = await client.get_commits(
        project_id,
        ref_name="main",
        since=since,
        until=until,
        with_stats=True,
        first_parent=True
    )
    authors = {}
    total_additions = 0
    total_deletions = 0
    for c in commits:
        author = c.get("author_name", "Unknown")
        if author not in authors:
            authors[author] = {"commits": 0, "additions": 0, "deletions": 0}
        authors[author]["commits"] += 1
        stats = c.get("stats", {})
        authors[author]["additions"] += stats.get("additions", 0)
        authors[author]["deletions"] += stats.get("deletions", 0)
        total_additions += stats.get("additions", 0)
        total_deletions += stats.get("deletions", 0)

    return {
        "date": date.isoformat(),
        "total_commits": len(commits),
        "total_additions": total_additions,
        "total_deletions": total_deletions,
        "by_author": authors
    }
```

**周报/月报/季报/年报**: 按同样逻辑扩展时间范围，聚合每日/每周数据。注意单次请求 `per_page=100` 可能不够，需要分页。

---

## 5. Repository Files API — 仓库文件

> **对应需求**: FR-007 (硬件交付资料), FR-008 (软件交付资料), FR-009 (链接快捷跳转), FR-010 (文档预览)
> **官方文档**: https://docs.gitlab.com/ee/api/repository_files.html

### 5.1 获取文件内容

```
GET /api/v4/projects/:id/repository/files/:file_path
```

**查询参数**:

| 参数 | 必填 | 说明 |
|------|------|------|
| `ref` | 是 | 分支名/tag/commit SHA |

> **注意**: `:file_path` 必须 URL-encoded。例如: `docs/交付资料/原理图.pdf` → `docs%2F%E4%BA%A4%E4%BB%98%E8%B5%84%E6%96%99%2F%E5%8E%9F%E7%90%86%E5%9B%BE%2Epdf`

**响应**: 返回文件元数据 + base64 编码内容:
```json
{
  "file_name": "原理图.pdf",
  "file_path": "docs/交付资料/原理图.pdf",
  "size": 2048576,
  "encoding": "base64",
  "content": "JVBERi0xLjQK...",
  "content_sha256": "abc123...",
  "ref": "main",
  "blob_id": "79f7bbd...",
  "commit_id": "d5a3ff1...",
  "last_commit_id": "570e7b2..."
}
```

### 5.2 获取原始文件内容

```
GET /api/v4/projects/:id/repository/files/:file_path/raw?ref=main
```

**PMA 用途**: 用于文件预览 (FR-010)，直接返回原始内容而非 base64。

### 5.3 获取文件元数据 (仅 HEAD)

```
HEAD /api/v4/projects/:id/repository/files/:file_path?ref=main
```

**PMA 用途**: 仅检查文件是否存在，不下载内容（节省带宽）。

### 5.4 获取文件 Blame

```
GET /api/v4/projects/:id/repository/files/:file_path/blame?ref=main
```

**PMA 用途**: 查看文件最后修改人/时间。

### 5.5 获取仓库目录树

```
GET /api/v4/projects/:id/repository/tree
```

**查询参数**:

| 参数 | 说明 |
|------|------|
| `path` | 子目录路径 |
| `ref` | 分支/tag |
| `recursive` | 是否递归 (`true`/`false`) |
| `per_page` | 每页数量 (最大 100) |

**请求示例（检查交付资料目录）**:
```bash
curl -H "PRIVATE-TOKEN: glpat-xxx" \
  "http://192.168.0.100/api/v4/projects/42/repository/tree?path=docs/交付资料&ref=main&recursive=true&per_page=100"
```

**PMA 用途**: 检查交付资料完整性 (FR-007/FR-008)，列出某项目仓库中所有文档文件。

---

## 6. Branches & Tags API — 分支与标签

> **官方文档**: https://docs.gitlab.com/ee/api/branches.html

### 6.1 获取分支列表

```
GET /api/v4/projects/:id/repository/branches
```

**查询参数**:

| 参数 | 说明 |
|------|------|
| `search` | 按分支名搜索 |
| `sort` | `asc` / `desc` (按名称) |

### 6.2 获取单个分支

```
GET /api/v4/projects/:id/repository/branches/:branch_name
```

### 6.3 获取 Tag 列表

```
GET /api/v4/projects/:id/repository/tags
```

**查询参数**:

| 参数 | 说明 |
|------|------|
| `search` | 按 tag 名搜索 |
| `order_by` | `name` / `updated` |
| `sort` | `asc` / `desc` |

**响应示例**:
```json
[
  {
    "name": "v1.2.0",
    "message": "BSP v1.2.0 release",
    "target": "a1b2c3d4e5f6...",
    "commit": {
      "id": "a1b2c3d4...",
      "short_id": "a1b2c3d",
      "created_at": "2026-06-01T10:00:00.000Z",
      "author_name": "张三"
    },
    "release": {
      "tag_name": "v1.2.0",
      "description": "BSP固件发布 v1.2.0"
    }
  }
]
```

**PMA 用途**: 验证禅道中的版本发布是否在 GitLab 中有对应的 tag/release（FR-004 告警规则）。

---

## 7. Merge Requests API — 合并请求

> **官方文档**: https://docs.gitlab.com/ee/api/merge_requests.html

### 7.1 获取 MR 列表

```
GET /api/v4/projects/:id/merge_requests
```

**查询参数**:

| 参数 | 类型 | 说明 |
|------|------|------|
| `state` | string | `opened` / `closed` / `locked` / `merged` / `all` |
| `order_by` | string | `created_at` / `updated_at` |
| `sort` | string | `asc` / `desc` |
| `created_after` | string | ISO 8601 |
| `created_before` | string | ISO 8601 |
| `author_id` | integer | 按作者筛选 |
| `assignee_id` | integer | 按指派人筛选 |
| `search` | string | 按标题/描述搜索 |

**PMA 用途**:
- 统计 MR 数量/趋势（日报/周报）
- 关联禅道任务（通过 MR 标题/描述中的关键词匹配）
- 检查 MR review 状态

### 7.2 获取单个 MR

```
GET /api/v4/projects/:id/merge_requests/:mr_iid
```

### 7.3 获取 MR 的 Commits

```
GET /api/v4/projects/:id/merge_requests/:mr_iid/commits
```

### 7.4 获取 MR 的 Changes (diff)

```
GET /api/v4/projects/:id/merge_requests/:mr_iid/changes
```

### 7.5 MR 统计（周报/月报用）

```python
async def get_mr_stats(client, project_id: int, since: str, until: str):
    """统计时间段内的 MR 数据"""
    mrs = await client.get_mrs(
        project_id,
        state="all",
        created_after=since,
        created_before=until,
        per_page=100
    )
    opened = sum(1 for m in mrs if m["state"] == "opened")
    merged = sum(1 for m in mrs if m["state"] == "merged")
    closed = sum(1 for m in mrs if m["state"] == "closed")

    return {
        "total": len(mrs),
        "opened": opened,
        "merged": merged,
        "closed": closed,
        "merge_rate": round(merged / len(mrs) * 100, 1) if mrs else 0
    }
```

---

## 8. Statistics API — 统计信息

> **对应需求**: FR-014 (Gitlab 提交统计)
> **官方文档**: https://docs.gitlab.com/ee/api/statistics.html

### 8.1 获取项目贡献者统计 (Premium/Ultimate)

> ⚠️ **GitLab 15.2 注意**: Contributors API 需要 GitLab Premium 及以上版本。如果是 CE 版，需要通过 Commits API 自行聚合统计。

```
GET /api/v4/projects/:id/repository/contributors
```

**响应**:
```json
[
  {
    "name": "张三",
    "email": "zhangsan@company.com",
    "commits": 156,
    "additions": 12340,
    "deletions": 5678
  }
]
```

### 8.2 自行聚合统计（CE 版兼容方案）

```python
async def get_contributor_stats(client, project_id: int, since: str, until: str):
    """通过 Commits API 聚合统计作者数据（兼容 CE 版本）"""
    all_commits = []
    page = 1
    while True:
        commits = await client.get_commits(
            project_id,
            ref_name="main",
            since=since, until=until,
            with_stats=True, first_parent=True,
            per_page=100, page=page
        )
        if not commits:
            break
        all_commits.extend(commits)
        page += 1

    contributors = {}
    for c in all_commits:
        author = c.get("author_name", "Unknown")
        if author not in contributors:
            contributors[author] = {"commits": 0, "additions": 0, "deletions": 0}
        contributors[author]["commits"] += 1
        stats = c.get("stats", {})
        contributors[author]["additions"] += stats.get("additions", 0)
        contributors[author]["deletions"] += stats.get("deletions", 0)

    return sorted(contributors.items(), key=lambda x: -x[1]["commits"])
```

### 8.3 全局统计 (Admin only)

```
GET /api/v4/application/statistics
```

需要管理员权限。返回实例级统计数据（项目总数、用户总数、MR 数等）。

---

## 9. Users API — 用户信息

> **官方文档**: https://docs.gitlab.com/ee/api/users.html

### 9.1 获取用户列表

```
GET /api/v4/users
```

### 9.2 获取当前用户

```
GET /api/v4/user
```

**PMA 用途**: 验证 token 有效性，获取 token 所有者的身份信息。

### 9.3 获取单个用户

```
GET /api/v4/users/:id
```

---

## 10. PMA 集成实现指南

### 10.1 客户端架构（参考 zentao_client.py）

```python
# backend/services/gitlab_client.py
from __future__ import annotations
import asyncio
import logging
from typing import Optional
from urllib.parse import quote

import httpx

from backend.config import settings

logger = logging.getLogger(__name__)


class GitLabClient:
    """GitLab API v4 异步客户端（只读操作，适配 GitLab 15.2）"""

    def __init__(self):
        self.base_url = settings.GITLAB_BASE_URL.rstrip("/")
        self._token = settings.GITLAB_TOKEN
        self._client: Optional[httpx.AsyncClient] = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=30.0,
                headers={"PRIVATE-TOKEN": self._token}
            )
        return self._client

    async def _request(self, method: str, path: str, **kwargs) -> dict | list | None:
        """发送 GitLab API 请求，自动处理分页和错误。"""
        client = await self._get_client()
        url = f"{self.base_url}{path}"

        for attempt in range(3):
            try:
                resp = await client.request(method, url, **kwargs)
                if resp.status_code == 204:  # No Content
                    return None
                if resp.status_code == 401:
                    raise RuntimeError("GitLab token 无效或已过期")
                if resp.status_code == 403:
                    raise RuntimeError("GitLab token 权限不足")
                if resp.status_code == 404:
                    logger.warning(f"GitLab 资源不存在: {url}")
                    return None
                if resp.status_code == 429:
                    retry_after = int(resp.headers.get("Retry-After", 5))
                    logger.warning(f"GitLab 速率限制，等待 {retry_after}s")
                    await asyncio.sleep(retry_after)
                    continue
                resp.raise_for_status()
                return resp.json()
            except httpx.RequestError as e:
                if attempt == 2:
                    raise RuntimeError(f"GitLab API 请求失败 (3次重试): {e}")
                logger.warning(f"GitLab 请求重试 {attempt + 1}/3: {e}")
                await asyncio.sleep(2 ** attempt)

        raise RuntimeError("GitLab API 请求失败")

    async def _get_all_pages(self, path: str, params: dict = None) -> list:
        """获取所有分页数据。"""
        if params is None:
            params = {}
        params.setdefault("per_page", 100)
        params.setdefault("page", 1)
        all_items = []

        while True:
            resp = await self._request("GET", path, params=params.copy())
            if not resp or not isinstance(resp, list) or len(resp) == 0:
                break
            all_items.extend(resp)
            if len(resp) < params["per_page"]:
                break
            params["page"] += 1

        return all_items

    # --- Projects ---
    async def get_projects(self, search: str = None, archived: bool = False) -> list:
        params = {"simple": True, "archived": str(archived).lower()}
        if search:
            params["search"] = search
        return await self._get_all_pages("/projects", params)

    async def get_project(self, project_id: int | str) -> dict:
        pid = quote(str(project_id), safe="")
        return await self._request("GET", f"/projects/{pid}")

    # --- Releases ---
    async def get_releases(self, project_id: int | str) -> list:
        pid = quote(str(project_id), safe="")
        return await self._get_all_pages(f"/projects/{pid}/releases")

    async def get_release(self, project_id: int | str, tag_name: str) -> dict:
        pid = quote(str(project_id), safe="")
        tag = quote(tag_name, safe="")
        return await self._request("GET", f"/projects/{pid}/releases/{tag}")

    # --- Commits ---
    async def get_commits(
        self, project_id: int | str,
        ref_name: str = "main",
        since: str = None, until: str = None,
        author: str = None, path: str = None,
        with_stats: bool = False, first_parent: bool = True,
        per_page: int = 100, page: int = 1
    ) -> list:
        pid = quote(str(project_id), safe="")
        params = {
            "ref_name": ref_name,
            "per_page": per_page,
            "page": page,
            "first_parent": str(first_parent).lower(),
        }
        if since:
            params["since"] = since
        if until:
            params["until"] = until
        if author:
            params["author"] = author
        if path:
            params["path"] = path
        if with_stats:
            params["with_stats"] = "true"
        return await self._request("GET", f"/projects/{pid}/repository/commits", params=params)

    async def get_all_commits(self, project_id: int | str, **kwargs) -> list:
        """获取所有提交（自动分页）。"""
        pid = quote(str(project_id), safe="")
        params = {
            "ref_name": kwargs.pop("ref_name", "main"),
            "per_page": 100,
            "first_parent": "true",
        }
        for k, v in kwargs.items():
            if v is not None:
                params[k] = v
        if kwargs.get("with_stats"):
            params["with_stats"] = "true"
        return await self._get_all_pages(f"/projects/{pid}/repository/commits", params)

    # --- Repository files ---
    async def get_file(self, project_id: int | str, file_path: str, ref: str = "main") -> dict:
        pid = quote(str(project_id), safe="")
        fp = quote(file_path, safe="")
        return await self._request("GET", f"/projects/{pid}/repository/files/{fp}", params={"ref": ref})

    async def get_raw_file(self, project_id: int | str, file_path: str, ref: str = "main") -> bytes:
        """获取原始文件内容（用于预览）。"""
        client = await self._get_client()
        pid = quote(str(project_id), safe="")
        fp = quote(file_path, safe="")
        url = f"{self.base_url}/projects/{pid}/repository/files/{fp}/raw"
        resp = await client.get(url, params={"ref": ref})
        resp.raise_for_status()
        return resp.content

    async def file_exists(self, project_id: int | str, file_path: str, ref: str = "main") -> bool:
        """检查文件是否存在（HEAD 请求，不下载内容）。"""
        client = await self._get_client()
        pid = quote(str(project_id), safe="")
        fp = quote(file_path, safe="")
        url = f"{self.base_url}/projects/{pid}/repository/files/{fp}"
        resp = await client.head(url, params={"ref": ref})
        return resp.status_code == 200

    async def get_tree(
        self, project_id: int | str,
        path: str = "", ref: str = "main", recursive: bool = False
    ) -> list:
        pid = quote(str(project_id), safe="")
        params = {"ref": ref, "recursive": str(recursive).lower()}
        if path:
            params["path"] = path
        return await self._get_all_pages(f"/projects/{pid}/repository/tree", params)

    # --- Tags ---
    async def get_tags(self, project_id: int | str, search: str = None) -> list:
        pid = quote(str(project_id), safe="")
        params = {}
        if search:
            params["search"] = search
        return await self._get_all_pages(f"/projects/{pid}/repository/tags", params)

    # --- Branches ---
    async def get_branches(self, project_id: int | str, search: str = None) -> list:
        pid = quote(str(project_id), safe="")
        params = {}
        if search:
            params["search"] = search
        return await self._get_all_pages(f"/projects/{pid}/repository/branches", params)

    # --- Merge Requests ---
    async def get_mrs(
        self, project_id: int | str,
        state: str = "all",
        created_after: str = None, created_before: str = None,
    ) -> list:
        pid = quote(str(project_id), safe="")
        params = {"state": state}
        if created_after:
            params["created_after"] = created_after
        if created_before:
            params["created_before"] = created_before
        return await self._get_all_pages(f"/projects/{pid}/merge_requests", params)

    # --- Users ---
    async def get_current_user(self) -> dict:
        return await self._request("GET", "/user")

    async def get_version(self) -> dict:
        return await self._request("GET", "/version")

    async def close(self):
        if self._client:
            await self._client.aclose()
            self._client = None
```

### 10.2 数据模型建议

```python
# backend/models/gitlab.py
from sqlalchemy import Column, Integer, String, DateTime, Text, Boolean, Float
from sqlalchemy.sql import func
from backend.database import Base


class CachedGitLabProject(Base):
    """GitLab 项目缓存"""
    __tablename__ = "gitlab_projects"

    id = Column(Integer, primary_key=True)  # GitLab project ID
    name = Column(String(255))
    name_with_namespace = Column(String(512))
    path_with_namespace = Column(String(512), index=True)
    web_url = Column(String(512))
    default_branch = Column(String(64))
    description = Column(Text)
    last_activity_at = Column(DateTime)
    archived = Column(Boolean, default=False)
    raw_json = Column(Text)
    synced_at = Column(DateTime, default=func.now())


class CachedGitLabRelease(Base):
    """GitLab Release 缓存"""
    __tablename__ = "gitlab_releases"

    id = Column(Integer, primary_key=True, autoincrement=True)
    project_id = Column(Integer, index=True)  # GitLab project ID
    tag_name = Column(String(255))
    name = Column(String(512))
    description = Column(Text)
    released_at = Column(DateTime)
    author_name = Column(String(255))
    is_compliant = Column(Boolean, nullable=True)  # 是否符合公司规范
    compliance_issues = Column(Text, nullable=True)  # JSON: 不合规项列表
    raw_json = Column(Text)
    synced_at = Column(DateTime, default=func.now())


class CachedGitLabCommit(Base):
    """GitLab Commit 缓存（用于统计）"""
    __tablename__ = "gitlab_commits"

    sha = Column(String(40), primary_key=True)
    project_id = Column(Integer, index=True)
    title = Column(String(512))
    author_name = Column(String(255), index=True)
    author_email = Column(String(255))
    committed_date = Column(DateTime, index=True)
    additions = Column(Integer, default=0)
    deletions = Column(Integer, default=0)
    raw_json = Column(Text)
    synced_at = Column(DateTime, default=func.now())
```

### 10.3 同步策略

| 数据类型 | 同步策略 | 频率 | 说明 |
|---------|---------|------|------|
| Projects | 全量 (全量少) | 每次全量同步 | 项目数量有限 (< 100) |
| Releases | 全量 | 每次全量同步 | 每个项目 release 数量有限 |
| Commits | 增量 | 首次全量 + 后续增量 | 首次同步历史数据，后续仅获取 `since=last_sync` |
| Repository Files | 按需 | 用户触发 | 仅在查看交付资料详情时实时获取 |

### 10.4 与禅道项目关联

PMA 需要将 GitLab 项目与禅道项目关联，用于交付资料检测和 commit 统计：

```python
# 关联方式 1: 按项目编号搜索 GitLab 项目
await client.get_projects(search="PE0444")

# 关联方式 2: 维护映射表
# gitlab_project_links: 禅道项目ID <-> GitLab 项目ID 的关联关系
```

### 10.5 前端集成

**跳转链接生成** (FR-009):
```javascript
// 生成 GitLab Web URL
function gitlabProjectUrl(pathWithNamespace) {
    return `http://192.168.0.100/${pathWithNamespace}`;
}

function gitlabCommitUrl(pathWithNamespace, sha) {
    return `http://192.168.0.100/${pathWithNamespace}/-/commit/${sha}`;
}

function gitlabReleaseUrl(pathWithNamespace, tagName) {
    return `http://192.168.0.100/${pathWithNamespace}/-/releases/${tagName}`;
}

function gitlabFileUrl(pathWithNamespace, filePath, ref) {
    return `http://192.168.0.100/${pathWithNamespace}/-/blob/${ref}/${filePath}`;
}
```

**数据源状态显示** (FR-024):
```javascript
// 通过 GET /api/v4/version 检查 GitLab 连接状态
async function checkGitLabStatus() {
    try {
        const resp = await fetch('/api/sync/sources');
        const data = await resp.json();
        const gitlab = data.data.find(s => s.key === 'gitlab');
        return {
            configured: gitlab.configured,
            status: gitlab.sync_status,
            lastSync: gitlab.last_sync,
        };
    } catch (e) {
        return { configured: false, status: 'error' };
    }
}
```

### 10.6 API 路由设计

```python
# backend/routers/gitlab.py
from fastapi import APIRouter

router = APIRouter(prefix="/api/gitlab", tags=["gitlab"])

# GET  /api/gitlab/projects          — 获取已缓存的 GitLab 项目列表
# GET  /api/gitlab/projects/:id      — 获取单个项目详情
# GET  /api/gitlab/projects/:id/releases — 获取项目的 releases
# GET  /api/gitlab/projects/:id/releases/:tag/validate — 验证 release 合规性
# GET  /api/gitlab/projects/:id/commits/stats — 获取提交统计 (支持 ?since=&until=&author=)
# GET  /api/gitlab/projects/:id/files?path= — 获取目录树/文件列表
# GET  /api/gitlab/projects/:id/files/preview?path=&ref= — 获取文件预览内容
# POST /api/gitlab/sync              — 触发 GitLab 数据同步
# GET  /api/gitlab/sync/status       — 获取同步状态
```

---

## 11. 附录：错误码与常见问题

### 11.1 HTTP 状态码

| 状态码 | 含义 | 处理方式 |
|--------|------|---------|
| 200 | 成功 | — |
| 201 | 创建成功 | — |
| 204 | 成功（无内容） | — |
| 400 | 请求参数错误 | 检查参数格式 |
| 401 | 未认证 | Token 无效或已过期，需要重新生成 |
| 403 | 无权限 | Token scope 不足，需要 `read_api` 权限 |
| 404 | 资源不存在 | 项目 ID 错误或已被删除 |
| 409 | 冲突 | 资源已存在（如创建重复 tag） |
| 422 | 参数校验失败 | 请求体参数不符合要求 |
| 429 | 请求过于频繁 | 等待 `Retry-After` 秒后重试 |
| 500 | 服务器错误 | 联系 GitLab 管理员 |

### 11.2 常见问题

**Q1: Token 配置正确但返回 401？**
- 检查 token 是否过期（PAT 默认有有效期）
- 在 GitLab 管理后台确认 token 状态正常
- 确认 token 格式：`glpat-` 前缀（GitLab 15.0+）

**Q2: CE 版本哪些 API 不可用？**
- Contributors API (`/projects/:id/repository/contributors`) — 需要 Premium
- Release Evidence (`/releases/:tag/evidence`) — 需要 Premium
- 通过 Commits API 手动聚合可替代 Contributors API

**Q3: 如何处理大文件预览（FR-010）？**
- Office 文件 (docx/xlsx/pptx): 通过 GitLab 内置的渲染器，URL 格式: `/-/blob/main/doc.docx?format=pdf`
- 大型二进制文件（固件包等）: 仅显示文件大小和下载链接，不预览内容
- 文本文件 (txt/md/yaml/json): 通过 repository files API 获取原始内容展示

**Q4: 获取大量 commits 数据太慢？**
- 使用 `first_parent=true` 仅跟踪主线，避免合并分支的重复提交
- 使用 `since`/`until` 缩小时间范围
- 首次同步获取全量 → 后续增量使用 `since=last_sync_time`
- 数据库按 `(project_id, committed_date)` 建联合索引加速查询

**Q5: 如何提高同步性能？**
- 使用 `simple=true` 获取项目列表（减少响应体积）
- 并发获取多个项目的 releases/commits（信号量限制 5-10 并发）
- 仅同步与禅道项目有关联的 GitLab 项目

---

## 参考资料

- [GitLab API 官方文档](https://docs.gitlab.com/ee/api/)
- [GitLab API Resources 列表](https://docs.gitlab.com/ee/api/api_resources.html)
- [GitLab 15.2 Releases API](https://docs.gitlab.com/15.2/ee/api/releases/)
- [GitLab 15.2 Commits API](https://docs.gitlab.com/15.2/ee/api/commits.html)
- [GitLab 15.2 Repository Files API](https://docs.gitlab.com/15.2/ee/api/repository_files.html)
- [GitLab 15.2 Merge Requests API](https://docs.gitlab.com/15.2/ee/api/merge_requests.html)
- [python-gitlab 库文档](https://python-gitlab.readthedocs.io/)
- [PMA 需求规格说明书](../docs/requirements-spec.md)
- [PMA 开发计划](../docs/dev-plan.md)
