---
name: pma-daily-summary
description: Generate daily PMA system update summary report — fetches git log, closed GitLab issues, and version info from the past 24 hours, then produces a beautiful self-contained HTML summary showing resolved bugs, new features, affected pages. Use this whenever the user asks for daily update, daily summary, 每日更新, 每日汇总, 系统更新动态, or wants to know what changed in PMA today/yesterday.
user-invocable: true
allowed-tools: Read, Write, Edit, Bash
---

# PMA 每日系统更新汇总

## 概述

从多个数据源抓取过去 24 小时的系统变更信息，生成一份结构化的 markdown 汇总报告，帮助用户快速了解 PMA 系统的最新动态。

## 数据来源

1. **Git Log** — `git log --since="24 hours ago"` 获取所有 commit
2. **GitLab Issues** — 通过 GitLab API 获取过去 24 小时内关闭的 issues（标题 + 评论）
3. **版本信息** — 读取 `frontend/index.html` 中的 `#app-version` meta 标签

## 执行步骤

### 1. 运行数据抓取脚本

```bash
python3 .claude/skills/pma-daily-summary/scripts/generate_daily_summary.py \
  --repo-path /home/xuchuan/workspace/pma \
  --output ~/tmp/daily-summary-$(date +%Y%m%d).html
```

脚本会自动：
- 读取项目 `.env` 获取 GitLab 配置（`GITLAB_BASE_URL`、`GITLAB_TOKEN`、`GITLAB_PROJECT_PATH`）
- 执行 `git log` 获取 24 小时内的提交
- 调用 GitLab API 获取已关闭的 issues 及其评论
- 读取 `frontend/index.html` 获取当前版本号
- 生成自包含的精美 HTML 报告（内嵌 CSS，无需外部依赖）

### 2. 查看报告

用浏览器打开生成的 HTML 文件，或直接在 IDE 中预览。报告为自包含单文件，可直接分享。

### 3. 报告结构

生成的 HTML 报告包含以下章节：

- **顶部概览** — KPI 卡片（提交数、新功能数、Bug 修复数、关闭 Issue 数、影响页面数）
- **版本信息** — 当前版本号、报告周期、变更文件数
- **Git 提交记录** — 按类型分组（feat/fix/refactor/docs）的提交列表
- **已关闭的 GitLab Issues** — 卡片式展示，含标题、创建人、关闭时间、标签、评论内容
- **新增功能特性** — 表格：Issue ID、标题、创建人、关联提交、解决方案简述、实际效果
- **Bug 修复** — 同上格式，从 issue 分析摘要中提取问题分析和解决方案
- **影响的页面/模块** — chip 标签展示
- **变更文件清单** — 按目录分组

## 重要说明

- 脚本依赖项目 `.env` 文件中的 GitLab 配置，确保 `.env` 存在且包含有效的 `GITLAB_TOKEN`
- 时间范围为**过去 24 小时**（从现在到昨天的同一时刻）
- 如果 GitLab API 不可达（如在内网环境外），脚本会跳过 GitLab Issues 部分并给出提示
- 生成的 HTML 报告位于 `~/tmp/` 目录，文件名包含日期，为自包含单文件（内嵌 CSS），可直接在浏览器中打开或分享给其他人
