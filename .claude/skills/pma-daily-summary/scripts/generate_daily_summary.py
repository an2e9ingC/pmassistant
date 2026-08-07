#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PMA Daily System Update Summary Generator.

Fetches data from three sources:
  1. Git log (past 24 hours)
  2. GitLab closed issues (past 24 hours, with comments)
  3. Project version info (frontend/index.html meta tag)

Generates a structured markdown report summarizing:
  - Resolved bugs
  - New features
  - Affected pages/modules
  - Version changes
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple
from urllib.parse import quote

# ── Constants ──────────────────────────────────────────────────────────────

BEIJING_TZ = timezone(timedelta(hours=8))

# Git commit type → display label
COMMIT_TYPE_LABELS = {
    "feat": "✨ 新功能",
    "fix": "🐛 Bug 修复",
    "refactor": "🔧 重构",
    "docs": "📄 文档",
    "style": "🎨 样式",
    "chore": "🏗️ 杂项",
    "perf": "⚡ 性能优化",
    "test": "✅ 测试",
    "ci": "🔄 CI/CD",
    "build": "📦 构建",
}

# Affected page mapping: file path pattern → page name
PAGE_MAPPING = [
    (r"frontend/js/dashboard\.js", "Dashboard 仪表盘"),
    (r"frontend/js/detail\.js", "项目详情"),
    (r"frontend/js/product\.js", "产品管理"),
    (r"frontend/js/tasks\.js", "任务管理"),
    (r"frontend/js/bugs\.js", "Bug 管理"),
    (r"frontend/js/reports\.js", "项目报表"),
    (r"frontend/js/admin\.js", "数据源配置"),
    (r"frontend/js/admin_users\.js", "用户管理"),
    (r"frontend/js/permissions\.js", "权限管理"),
    (r"frontend/js/logs\.js", "系统日志"),
    (r"frontend/js/app\.js", "全局框架/导航"),
    (r"frontend/js/components\.js", "全局 UI 组件"),
    (r"frontend/js/utils\.js", "全局工具函数"),
    (r"frontend/js/auth\.js", "登录认证"),
    (r"frontend/js/customers\.js", "客户管理"),
    (r"frontend/js/topology\.js", "快速检索"),
    (r"frontend/js/gitlab-releases\.js", "GitLab 发布统计"),
    (r"frontend/js/db-manage\.js", "数据库管理"),
    (r"frontend/js/system-manage\.js", "系统管理"),
    (r"frontend/js/doc-templates\.js", "文档模板管理"),
    (r"frontend/js/user-center\.js", "个人中心"),
    (r"frontend/css/", "全局样式"),
    (r"frontend/index\.html", "主页面入口"),
    (r"frontend/login\.html", "登录页面"),
    (r"backend/routers/dashboard\.py", "Dashboard API"),
    (r"backend/routers/projects\.py", "项目 API"),
    (r"backend/routers/products\.py", "产品 API"),
    (r"backend/routers/tasks\.py", "任务 API"),
    (r"backend/routers/bugs\.py", "Bug API"),
    (r"backend/routers/reports\.py", "报表 API"),
    (r"backend/routers/config\.py", "配置 API"),
    (r"backend/routers/auth\.py", "认证 API"),
    (r"backend/routers/gitlab\.py", "GitLab API"),
    (r"backend/services/sync_service\.py", "数据同步服务"),
    (r"backend/services/gitlab_client\.py", "GitLab 客户端"),
    (r"backend/models/", "数据库模型"),
    (r"docs/", "文档"),
    (r"\.claude/skills/", "AI Skills"),
]


# ── Helpers ────────────────────────────────────────────────────────────────

def load_dotenv(repo_path: str) -> dict:
    """Load key-value pairs from .env file."""
    env = {}
    env_path = os.path.join(repo_path, ".env")
    if not os.path.exists(env_path):
        print(f"[WARN] .env not found at {env_path}", file=sys.stderr)
        return env

    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if key:
                env[key] = val
    return env


def beijing_now() -> datetime:
    """Current Beijing time."""
    return datetime.now(timezone.utc).astimezone(BEIJING_TZ)


def iso_str(dt: datetime) -> str:
    """Format datetime as ISO 8601 string."""
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso(s: str) -> Optional[datetime]:
    """Parse ISO 8601 string to datetime."""
    s = s.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(s)
    except (ValueError, TypeError):
        return None


# ── Data Sources ───────────────────────────────────────────────────────────

def get_version(repo_path: str) -> str:
    """Read app version from frontend/index.html meta tag."""
    html_path = os.path.join(repo_path, "frontend", "index.html")
    if not os.path.exists(html_path):
        return "未知"

    with open(html_path) as f:
        content = f.read()

    m = re.search(r'<meta\s+name="app-version"\s+content="([^"]+)"', content)
    if m:
        return m.group(1)
    return "未知"


def get_version_at(repo_path: str, dt: datetime) -> str:
    """Find the app version that was active at a given datetime.

    Parses docs/dev-plan.md version history (sorted newest-first) to find
    the first version whose date <= dt.
    """
    devplan_path = os.path.join(repo_path, "docs", "dev-plan.md")
    if not os.path.exists(devplan_path):
        return ""

    with open(devplan_path) as f:
        content = f.read()

    # Parse version history table: | YYYY-MM-DD | vX.Y.Z | desc |
    entries = []
    for m in re.finditer(r'\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*(v\d{4}\.\d{2}\.\d{2}-[^\s|]+)\s*\|', content):
        date_str = m.group(1)
        ver_str = m.group(2)
        try:
            entry_date = datetime.strptime(date_str, "%Y-%m-%d")
            entries.append((entry_date, ver_str))
        except ValueError:
            continue

    if not entries:
        return ""

    # Entries are newest-first. Find the first entry whose date <= dt.
    dt_date = dt.date()
    for entry_date, ver_str in entries:
        if entry_date.date() <= dt_date:
            return ver_str

    # All entries are after dt — return the oldest one
    return entries[-1][1] if entries else ""


def get_git_log(repo_path: str, since: datetime) -> List[dict]:
    """Get git log since given time."""
    try:
        result = subprocess.run(
            [
                "git", "-C", repo_path, "log",
                f"--since={since.strftime('%Y-%m-%d %H:%M:%S')}",
                "--format=%H||%an||%ai||%s",
                "--no-merges",
            ],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode != 0:
            print(f"[WARN] git log failed: {result.stderr}", file=sys.stderr)
            return []
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        print(f"[WARN] git log error: {e}", file=sys.stderr)
        return []

    commits = []
    for line in result.stdout.strip().split("\n"):
        if not line:
            continue
        parts = line.split("||", 3)
        if len(parts) < 4:
            continue
        hash_short = parts[0][:8]
        author = parts[1]
        date_str = parts[2]
        subject = parts[3]

        # Parse commit type and scope
        ctype, scope, desc = parse_commit_subject(subject)

        full_hash = parts[0]
        commits.append({
            "hash": hash_short,
            "full_hash": full_hash,
            "author": author,
            "date": date_str,
            "subject": subject,
            "type": ctype,
            "scope": scope,
            "description": desc,
        })

    return commits


def get_per_commit_files(repo_path: str, commits: List[dict]) -> Dict[str, List[str]]:
    """Get changed files for each commit using git show --name-only.
    Returns {full_hash: [file_path, ...]}.
    """
    result_map: Dict[str, List[str]] = {}
    for c in commits:
        try:
            r = subprocess.run(
                ["git", "-C", repo_path, "show", "--name-only", "--format=", c["full_hash"]],
                capture_output=True, text=True, timeout=10,
            )
            files = [f.strip() for f in r.stdout.strip().split("\n") if f.strip()]
            result_map[c["full_hash"]] = files
        except Exception:
            result_map[c["full_hash"]] = []
    return result_map


def parse_commit_subject(subject: str) -> Tuple[str, str, str]:
    """Parse conventional commit subject into (type, scope, description)."""
    m = re.match(r"^(\w+)(?:\(([^)]+)\))?:\s*(.*)", subject)
    if m:
        return m.group(1), m.group(2) or "", m.group(3)
    # Fallback: try to classify from keywords
    subject_lower = subject.lower()
    if subject_lower.startswith("fix") or "修复" in subject:
        return "fix", "", subject
    if any(kw in subject_lower for kw in ("feat", "新增", "添加", "增加")):
        return "feat", "", subject
    return "chore", "", subject


def get_closed_issues(repo_path: str, since: datetime) -> List[dict]:
    """Fetch closed GitLab issues updated since given time, with comments."""
    env = load_dotenv(repo_path)
    base_url = env.get("GITLAB_BASE_URL", "").rstrip("/")
    token = env.get("GITLAB_TOKEN", "")
    project_path = env.get("GITLAB_PROJECT_PATH", "")

    if not base_url or not token or not project_path:
        print("[WARN] GitLab config incomplete, skipping issues", file=sys.stderr)
        return []

    pid = quote(project_path, safe="")
    headers = {"PRIVATE-TOKEN": token}
    since_iso = since.strftime("%Y-%m-%dT%H:%M:%SZ")

    # Step 1: List closed issues updated after `since`
    issues = _gitlab_get_all(
        base_url, headers,
        f"/projects/{pid}/issues",
        params={"state": "closed", "updated_after": since_iso, "per_page": 100},
    )

    if not issues:
        print("[INFO] No closed issues found in the past 24 hours")
        return []

    # Step 2: Fetch notes for each issue (concurrent would be better, but keep it simple)
    results = []
    for issue in issues:
        iid = issue.get("iid")
        title = issue.get("title", "")
        web_url = issue.get("web_url", "")
        closed_at = issue.get("closed_at", "")
        labels = issue.get("labels", [])

        notes = _gitlab_get_all(
            base_url, headers,
            f"/projects/{pid}/issues/{iid}/notes",
            params={"per_page": 100},
        )

        # Only include notes from the past 24 hours
        recent_notes = []
        for note in notes:
            note_created = parse_iso(note.get("created_at", ""))
            if note_created and note_created >= since:
                recent_notes.append({
                    "author": note.get("author", {}).get("name", "Unknown"),
                    "body": note.get("body", "")[:500],  # truncate long comments
                    "created_at": note.get("created_at", ""),
                })

        author_name = (issue.get("author") or {}).get("name", "")
        author_username = (issue.get("author") or {}).get("username", "")
        results.append({
            "iid": iid,
            "title": title,
            "web_url": web_url,
            "closed_at": closed_at,
            "labels": labels,
            "author": author_name or author_username or "",
            "notes": recent_notes,
        })

    return results


def _gitlab_get_all(base_url: str, headers: dict, path: str, params: dict = None) -> List:
    """Fetch all pages from a GitLab list endpoint."""
    import json
    import urllib.request

    if params is None:
        params = {}
    params.setdefault("per_page", 100)
    params.setdefault("page", 1)

    all_items = []
    max_pages = 10  # safety limit

    while params["page"] <= max_pages:
        qs = "&".join(f"{k}={quote(str(v), safe='')}" for k, v in params.items())
        url = f"{base_url}{path}?{qs}"
        req = urllib.request.Request(url, headers=headers)

        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode())
            if not isinstance(data, list) or len(data) == 0:
                break
            all_items.extend(data)
            if len(data) < params["per_page"]:
                break
            params["page"] += 1
        except Exception as e:
            print(f"[WARN] GitLab API error: {e}", file=sys.stderr)
            break

    return all_items


# ── Issue-Commit Cross-Reference ────────────────────────────────────────────

def extract_issue_refs(text: str) -> List[int]:
    """Extract issue IID references from commit subject/body.

    Matches patterns like: #123, issue#123, close #123, closes #123, fix #123
    """
    refs = set()
    for m in re.finditer(r'(?:issue|close|closes|fix|fixes|resolve|resolves)?\s*#(\d+)', text, re.IGNORECASE):
        refs.add(int(m.group(1)))
    return sorted(refs)


def extract_solution_from_notes(notes: List[dict]) -> Tuple[str, str]:
    """Try to extract problem-analysis summary and solution from issue notes.

    Returns (solution_summary, actual_effect).  Each is '' if not found.
    Looks for PMA issue-workflow analysis patterns:
      ## 分析处理摘要
      ### 问题分析
      ### 解决方案
    """
    solution_parts = []
    effect_parts = []

    for note in notes:
        body = note.get("body", "")
        if not body:
            continue

        # Try PMA structured format first
        # Match both "### 问题分析\n..." and "问题分析：..." formats
        problem_m = re.search(r'(?:###\s*)?(?:问题分析|根因)(?:[：:]|\n)\s*(.*?)(?=\n###\s|\n##\s|---|\Z)', body, re.DOTALL)
        if problem_m:
            problem_text = problem_m.group(1).strip()[:400]
            if problem_text and problem_text not in solution_parts:
                solution_parts.append(problem_text)

        # Extract "解决方案" section — match "### 解决方案\n..." and "解决方案：..."
        solution_m = re.search(r'(?:###\s*)?(?:解决方案|修复方案|修改方案)(?:[：:]|\n)\s*(.*?)(?=\n###\s|\n##\s|---|\Z)', body, re.DOTALL)
        if solution_m:
            solution_text = solution_m.group(1).strip()[:400]
            if solution_text and solution_text not in effect_parts:
                effect_parts.append(solution_text)

        # Extract "修改文件" section as additional effect detail
        files_m = re.search(r'(?:###\s*)?修改文件(?:[：:]|\n)\s*(.*?)(?=\n###\s|\n##\s|---|\Z)', body, re.DOTALL)
        if files_m:
            files_text = files_m.group(1).strip()[:200]
            if files_text and files_text not in effect_parts:
                effect_parts.insert(0, files_text)

        # Fallback: look for bullet-list items that describe the fix
        if not solution_parts:
            for line in body.split("\n"):
                line = line.strip()
                if re.match(r'^[-*]\s*(修复|解决|处理|改为|移除|增加|重构)', line):
                    solution_parts.append(line[:200])

    solution_summary = "；".join(solution_parts[:3]) if solution_parts else ""
    actual_effect = "；".join(effect_parts[:3]) if effect_parts else ""

    # Truncate to reasonable lengths
    if len(solution_summary) > 400:
        solution_summary = solution_summary[:397] + "..."
    if len(actual_effect) > 400:
        actual_effect = actual_effect[:397] + "..."

    return solution_summary, actual_effect


def match_commits_to_issues(commits: List[dict], issues: List[dict]) -> dict:
    """Build a mapping of issue_iid -> list of related commits.

    A commit is related to an issue if the commit subject contains #IID.
    """
    # Build issue lookup by iid
    issue_map: Dict[int, dict] = {}
    for iss in issues:
        issue_map[iss["iid"]] = iss

    # Map: issue_iid -> [commit, ...]
    linked: Dict[int, List[dict]] = {}
    for c in commits:
        refs = extract_issue_refs(c["subject"])
        for iid in refs:
            if iid in issue_map:
                linked.setdefault(iid, []).append(c)

    return linked


# ── Analysis ────────────────────────────────────────────────────────────────

def infer_affected_pages(files_changed: List[str]) -> List[str]:
    """Infer affected page names from file paths using git diff --stat data.

    This is a separate call because commit-level analysis needs per-commit files.
    For the summary, we use the overall file list from git diff --stat.
    """
    pages = set()
    for f in files_changed:
        for pattern, page_name in PAGE_MAPPING:
            if re.search(pattern, f):
                pages.add(page_name)
                break
    return sorted(pages)


def get_changed_files(repo_path: str, since: datetime) -> Tuple[List[str], List[str]]:
    """Get list of changed files and infer pages. Returns (files, pages).

    Uses git-log --name-only (which correctly supports --since), then deduplicates.
    """
    files = []
    try:
        result = subprocess.run(
            [
                "git", "-C", repo_path, "log",
                f"--since={since.strftime('%Y-%m-%d %H:%M:%S')}",
                "--name-only", "--format=", "--no-merges",
            ],
            capture_output=True, text=True, timeout=30,
        )
        files = list(set(f for f in result.stdout.strip().split("\n") if f))
    except Exception:
        pass

    pages = infer_affected_pages(files)
    return files, pages


# ── HTML Report Generation ──────────────────────────────────────────────────

CSS = r"""
:root {
  --bg: #f5f6fa; --card-bg: #fff; --text: #2c3e50; --muted: #7f8c8d;
  --border: #e8ecf1; --accent: #3498db; --accent2: #2980b9;
  --success: #27ae60; --warn: #f39c12; --danger: #e74c3c;
  --feat: #27ae60; --fix: #e67e22; --docs: #3498db; --chore: #95a5a6;
  --refactor: #9b59b6; --style: #e91e63; --perf: #1abc9c;
  --shadow: 0 1px 3px rgba(0,0,0,.08); --radius: 10px;
  --sidebar-w: 200px;
}
* { margin:0; padding:0; box-sizing:border-box; }
html { scroll-behavior:smooth; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans SC", sans-serif; background: var(--bg); color: var(--text); line-height:1.6; }

/* ── Sidebar ── */
.sidebar { position:fixed; left:0; top:0; bottom:0; width:var(--sidebar-w); background:#1e2a3a; color:#c8d6e5; z-index:100; overflow-y:auto; padding:24px 0; }
.sidebar .sb-title { font-size:13px; font-weight:700; color:#fff; padding:8px 20px 16px; letter-spacing:.5px; border-bottom:1px solid rgba(255,255,255,.08); margin-bottom:8px; }
.sidebar .sb-title small { display:block; font-weight:400; font-size:10px; color:#6b7d95; margin-top:2px; }
.sidebar a { display:flex; align-items:center; gap:8px; color:#a0b4c8; text-decoration:none; font-size:12.5px; padding:8px 20px; transition:all .15s; border-left:3px solid transparent; }
.sidebar a:hover { color:#fff; background:rgba(255,255,255,.05); border-left-color:var(--accent); }
.sidebar a .sb-icon { font-size:14px; width:20px; text-align:center; flex-shrink:0; }
.sidebar a .sb-badge { margin-left:auto; background:rgba(255,255,255,.1); font-size:10px; padding:1px 7px; border-radius:10px; min-width:20px; text-align:center; }
/* Main content offset */
.main-wrap { margin-left:var(--sidebar-w); padding:24px 32px; }
.container { max-width:1100px; margin:0 auto; }

/* Header */
.header { background: linear-gradient(135deg, #1a2a6c, #2c3e50, #3498db); color:#fff; border-radius:var(--radius); padding:32px 40px; margin-bottom:24px; box-shadow:0 4px 20px rgba(26,42,108,.25); }
.header h1 { font-size:26px; font-weight:700; letter-spacing:-0.3px; margin-bottom:8px; }
.header .meta { font-size:14px; opacity:.85; display:flex; flex-wrap:wrap; gap:6px 24px; }
.header .meta span { white-space:nowrap; }
.header .version-badge { display:inline-block; background:rgba(255,255,255,.18); padding:2px 10px; border-radius:20px; font-family:"SF Mono","Fira Code",monospace; font-size:13px; }

/* KPI cards — clickable */
.kpi-row { display:grid; grid-template-columns:repeat(5,1fr); gap:16px; margin-bottom:24px; }
.kpi-row.kpi-4col { grid-template-columns:repeat(4,1fr); }
.kpi-card { background:var(--card-bg); border-radius:var(--radius); padding:20px 24px; box-shadow:var(--shadow); text-align:center; border:1px solid var(--border); transition:transform .15s,box-shadow .15s; cursor:pointer; text-decoration:none; display:block; color:inherit; }
.kpi-card:hover { transform:translateY(-2px); box-shadow:0 4px 12px rgba(0,0,0,.12); }
.kpi-card .kpi-num { font-size:36px; font-weight:800; line-height:1.1; transition:color .15s; }
.kpi-card .kpi-label { font-size:13px; color:var(--muted); margin-top:4px; }
.kpi-card.accent .kpi-num { color:var(--accent); }
.kpi-card.feat .kpi-num { color:var(--feat); }
.kpi-card.fix .kpi-num { color:var(--fix); }
.kpi-card.warn .kpi-num { color:var(--warn); }

/* Sections */
.section { background:var(--card-bg); border-radius:var(--radius); box-shadow:var(--shadow); border:1px solid var(--border); margin-bottom:20px; overflow:hidden; scroll-margin-top:20px; }
.section-header { display:flex; align-items:center; gap:10px; padding:18px 24px; border-bottom:1px solid var(--border); background:#fafbfc; cursor:pointer; user-select:none; }
.section-header:hover { background:#f3f5f7; }
.section-header h2 { font-size:17px; font-weight:650; flex:1; }
.section-header .icon { font-size:20px; }
.section-header .count { background:var(--accent); color:#fff; font-size:12px; font-weight:700; padding:2px 10px; border-radius:12px; min-width:24px; text-align:center; }
.section-body { padding:20px 24px; }
.section-body .empty { text-align:center; color:var(--muted); padding:24px; font-size:14px; }
/* Collapsible — toggled on .section */
.section.collapsed .section-body { display:none; }
.section-header .arrow { transition:transform .2s; font-size:12px; color:var(--muted); }
.section.collapsed .arrow { transform:rotate(-90deg); }

/* Tables */
table { width:100%; border-collapse:collapse; font-size:13.5px; }
thead th { background:#f8f9fb; font-weight:650; color:var(--muted); text-transform:uppercase; font-size:10.5px; letter-spacing:.5px; padding:10px 10px; text-align:left; border-bottom:2px solid var(--border); white-space:nowrap; }
tbody td { padding:10px 10px; border-bottom:1px solid var(--border); vertical-align:top; }
tbody tr:hover { background:#f8fafd; }
tbody tr:last-child td { border-bottom:none; }
td.mono { font-family:"SF Mono","Fira Code","Consolas",monospace; font-size:12px; }
td.num { text-align:center; color:var(--muted); font-size:12px; width:36px; }

/* Issue link */
.issue-link { font-family:"SF Mono","Fira Code",monospace; font-size:12px; color:var(--accent); text-decoration:none; white-space:nowrap; }
.issue-link:hover { text-decoration:underline; }

/* Labels / tags */
.tag { display:inline-block; font-size:11px; padding:1px 7px; border-radius:3px; margin:1px 2px; font-weight:600; }
.tag-bug { background:#fdeaea; color:#c0392b; }
.tag-enhancement { background:#e8f8f0; color:#1e8449; }
.tag-feedback { background:#eaf2f8; color:#2471a3; }
.tag-other { background:#f4f4f4; color:#666; }

/* File listing */
.file-group { margin-bottom:16px; }
.file-group h4 { font-size:13px; font-weight:650; color:var(--accent2); margin-bottom:6px; }
.file-group ul { list-style:none; display:flex; flex-wrap:wrap; gap:4px 8px; }
.file-group li { font-family:"SF Mono","Fira Code",monospace; font-size:11.5px; color:var(--muted); background:#f7f8fa; padding:2px 8px; border-radius:4px; border:1px solid var(--border); }

/* Issue detail card */
.issue-card { border:1px solid var(--border); border-radius:8px; margin-bottom:16px; overflow:hidden; transition:box-shadow .15s; }
.issue-card:hover { box-shadow:0 2px 8px rgba(0,0,0,.06); }
.issue-card-header { display:flex; align-items:flex-start; gap:12px; padding:14px 18px; background:#fafbfc; border-bottom:1px solid var(--border); }
.issue-card-header .issue-num { font-family:"SF Mono","Fira Code",monospace; font-size:13px; font-weight:700; color:var(--accent); white-space:nowrap; }
.issue-card-header .issue-num a { color:inherit; text-decoration:none; }
.issue-card-header .issue-num a:hover { text-decoration:underline; }
.issue-card-header .issue-info { flex:1; min-width:0; }
.issue-card-header .issue-title { font-weight:600; font-size:14px; line-height:1.4; }
.issue-card-header .issue-meta { font-size:12px; color:var(--muted); margin-top:3px; display:flex; flex-wrap:wrap; gap:4px 16px; }
.issue-card-body { padding:14px 18px; font-size:13px; line-height:1.7; }
.issue-card-body .field { margin-bottom:10px; }
.issue-card-body .field-label { font-weight:650; font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.5px; margin-bottom:3px; }
.issue-card-body .field-value { color:var(--text); }

/* Commit type badges */
.commit-type { display:inline-block; font-size:10.5px; font-weight:700; padding:2px 8px; border-radius:3px; white-space:nowrap; }
.ctype-feat { background:#e8f8f0; color:#1e8449; }
.ctype-fix { background:#fef5e7; color:#b9770e; }
.ctype-docs { background:#eaf2f8; color:#2471a3; }
.ctype-chore { background:#f4f4f4; color:#666; }
.ctype-refactor { background:#f3eafa; color:#7d3c98; }
.ctype-style { background:#fdeaf2; color:#c0392b; }
.ctype-perf { background:#e8faf3; color:#117a65; }

/* Back-to-top */
.back-to-top { position:fixed; right:24px; bottom:24px; width:40px; height:40px; background:var(--accent); color:#fff; border:none; border-radius:50%; cursor:pointer; font-size:18px; box-shadow:0 2px 8px rgba(0,0,0,.2); display:flex; align-items:center; justify-content:center; z-index:99; transition:opacity .2s; }
.back-to-top:hover { background:var(--accent2); }

/* Footer */
.footer { text-align:center; padding:20px; font-size:12px; color:var(--muted); }
.footer a { color:var(--accent); text-decoration:none; }

/* Affected pages chips */
.page-chips { display:flex; flex-wrap:wrap; gap:6px; }
.page-chip { display:inline-block; font-size:12px; padding:4px 12px; background:#eaf2f8; color:#2471a3; border-radius:20px; border:1px solid #d4e6f1; }

/* Responsive */
@media(max-width:900px) {
  .sidebar { display:none; }
  .main-wrap { margin-left:0; }
  .kpi-row { grid-template-columns:repeat(3,1fr); }
}
@media(max-width:600px) {
  .kpi-row { grid-template-columns:repeat(2,1fr); }
  .main-wrap { padding:12px; }
  .header { padding:20px; }
}
"""


def _html_escape(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def _render_markdown(text: str) -> str:
    """Convert basic markdown to HTML. Handles headings, bold, code, lists, paragraphs."""
    lines = text.split("\n")
    out = []
    in_list = False
    in_paragraph = False

    def _flush_paragraph():
        nonlocal in_paragraph
        if in_paragraph:
            out.append("</p>")
            in_paragraph = False

    def _flush_list():
        nonlocal in_list
        if in_list:
            out.append("</ul>")
            in_list = False

    for line in lines:
        # Heading
        m = re.match(r'^(#{1,4})\s+(.+)', line)
        if m:
            _flush_paragraph()
            _flush_list()
            hashes = len(m.group(1))
            level = min(hashes + 2, 6)  # ##→h4, ###→h5, ####→h6
            sizes = {4: 15, 5: 13, 6: 12}
            out.append(f'<h{level} style="font-size:{sizes.get(level,13)}px;margin:10px 0 4px;font-weight:650;color:#2c3e50">{_html_escape(m.group(2))}</h{level}>')
            continue

        # Horizontal rule
        if re.match(r'^[-*_]{3,}\s*$', line):
            _flush_paragraph()
            _flush_list()
            out.append('<hr style="border:none;border-top:1px solid var(--border);margin:8px 0">')
            continue

        # Unordered list item
        m = re.match(r'^[-*]\s+(.+)', line)
        if m:
            _flush_paragraph()
            if not in_list:
                out.append('<ul style="margin:4px 0;padding-left:20px">')
                in_list = True
            out.append(f'<li style="margin:2px 0">{_render_inline(m.group(1))}</li>')
            continue
        else:
            _flush_list()

        # Empty line — paragraph break
        if not line.strip():
            _flush_paragraph()
            continue

        # Regular paragraph text
        if not in_paragraph:
            out.append('<p style="margin:4px 0">')
            in_paragraph = True
        else:
            out.append('<br>')
        out.append(_render_inline(line))

    _flush_list()
    _flush_paragraph()
    return "".join(out)


def _render_inline(text: str) -> str:
    """Render inline markdown: **bold**, *italic*, `code`, [link](url)."""
    t = _html_escape(text)
    t = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', t)
    t = re.sub(r'\*(.+?)\*', r'<em>\1</em>', t)
    t = re.sub(r'`([^`]+)`', r'<code style="background:#f0f0f0;padding:1px 5px;border-radius:3px;font-size:12px">\1</code>', t)
    t = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2" target="_blank" style="color:var(--accent)">\1</a>', t)
    return t


def _commit_type_class(ctype: str) -> str:
    return f"ctype-{ctype}" if ctype in ("feat","fix","docs","chore","refactor","style","perf") else "ctype-chore"


# Issue-component prefix → page name mapping (extracted from [xxx] in issue titles)
ISSUE_COMPONENT_MAP = {
    "项目详情": "项目详情",
    "任务管理": "任务管理",
    "Bug 管理": "Bug 管理",
    "bug 管理": "Bug 管理",
    "产品管理": "产品管理",
    "模板管理": "文档模板管理",
    "系统管理": "系统管理",
    "个人中心": "个人中心",
    "Dashboard": "Dashboard 仪表盘",
    "仪表盘": "Dashboard 仪表盘",
    "客户管理": "客户管理",
    "快速检索": "快速检索",
    "数据同步": "数据同步服务",
    "用户管理": "用户管理",
    "权限管理": "权限管理",
    "GitLab": "GitLab 发布统计",
    "数据源": "数据源配置",
    "日志": "系统日志",
    "文档": "文档模板管理",
    "甘特图": "项目详情",
    "报表": "项目报表",
    "SVN": "数据同步服务",
    "部署": "全局框架/导航",
    "worktree": "AI Skills",
    "skill": "AI Skills",
    "CI": "AI Skills",
}


def _pages_from_issue(issue: dict) -> List[str]:
    """Infer affected pages from issue title prefix [xxx] and labels."""
    pages = set()
    title = issue.get("title", "")

    # Match [组件名] prefix in title
    m = re.match(r'\[([^\]]+)\]', title)
    if m:
        components = m.group(1).split("][")
        for comp in components:
            comp = comp.strip()
            if comp in ISSUE_COMPONENT_MAP:
                pages.add(ISSUE_COMPONENT_MAP[comp])

    # Match labels
    for lb in issue.get("labels", []):
        lb_lower = lb.lower()
        if lb_lower in ("detail", "project"):
            pages.add("项目详情")
        elif lb_lower in ("tasks", "task"):
            pages.add("任务管理")
        elif lb_lower in ("bugs", "bug"):
            pages.add("Bug 管理")
        elif lb_lower in ("products", "product"):
            pages.add("产品管理")
        elif lb_lower == "doc-templates":
            pages.add("文档模板管理")
        elif lb_lower == "system-manage":
            pages.add("系统管理")
        elif lb_lower in ("profile", "user-center"):
            pages.add("个人中心")
        elif lb_lower == "dashboard":
            pages.add("Dashboard 仪表盘")
        elif lb_lower == "customers":
            pages.add("客户管理")
        elif lb_lower == "topology":
            pages.add("快速检索")
        elif lb_lower == "reports":
            pages.add("项目报表")
        elif lb_lower == "logs":
            pages.add("系统日志")
        elif lb_lower == "admin":
            pages.add("用户管理")
        elif lb_lower == "auth":
            pages.add("登录认证")
        elif lb_lower == "gitlab":
            pages.add("GitLab 发布统计")
        elif lb_lower == "feedback":
            pages.add("全局 UI 组件")

    return sorted(pages)


def _pages_for_row(related_commits: List[dict], issue: dict, commit_files: Dict[str, List[str]]) -> List[str]:
    """Get affected pages for a table row — combines commit-based and issue-based inference."""
    pages = set()

    # From commits
    all_files = set()
    for c in related_commits:
        all_files.update(commit_files.get(c["full_hash"], []))
    pages.update(infer_affected_pages(list(all_files)))

    # From issue (title prefix + labels)
    if issue:
        pages.update(_pages_from_issue(issue))

    return sorted(pages)


def _render_page_chips(pages: List[str]) -> str:
    """Render affected pages as small inline chips."""
    if not pages:
        return '<span style="color:var(--muted);font-size:11px">—</span>'
    chips = " ".join(f'<span class="page-chip" style="font-size:10px;padding:1px 7px;margin:1px 2px">{_html_escape(p)}</span>' for p in pages)
    return chips


def _render_kpi(num: int, label: str, css_class: str = "accent", target: str = "") -> str:
    onclick = f' onclick="scrollToSection(\'{target}\')"' if target else ""
    return f'<a class="kpi-card {css_class}" href="#{target}"{onclick}><div class="kpi-num">{num}</div><div class="kpi-label">{label}</div></a>'


def _render_section_header(icon: str, title: str, count: int, section_id: str) -> str:
    return (
        f'<div class="section-header" onclick="this.parentElement.classList.toggle(\'collapsed\')">'
        f'<span class="icon">{icon}</span>'
        f'<h2>{title}</h2>'
        f'<span class="count">{count}</span>'
        f'<span class="arrow">▼</span>'
        f'</div>'
    )


def generate_report(
    since: datetime,
    until: datetime,
    version: str,
    commits: List[dict],
    issues: List[dict],
    changed_files: List[str],
    affected_pages: List[str],
    linked: Dict[int, List[dict]] = None,
    commit_files: Dict[str, List[str]] = None,
    repo_path: str = "",
) -> str:
    """Generate the daily summary HTML report."""
    if linked is None:
        linked = {}
    if commit_files is None:
        commit_files = {}

    feat_commits = [c for c in commits if c["type"] == "feat"]
    fix_commits = [c for c in commits if c["type"] == "fix"]
    feat_issues = [i for i in issues if "enhancement" in i.get("labels", []) or "feature" in i.get("labels", [])]
    fix_issues = [i for i in issues if "bug" in i.get("labels", [])]
    feat_linked_iids = set()
    for c in feat_commits:
        feat_linked_iids.update(extract_issue_refs(c["subject"]))
    fix_linked_iids = set()
    for c in fix_commits:
        fix_linked_iids.update(extract_issue_refs(c["subject"]))

    H = _html_escape
    parts = []

    # ── Build sidebar nav items (order: version → features → fixes → issues → commits) ──
    nav_items = [
        ("sec-version", "ℹ️", "版本信息", 0),
        ("sec-features", "✨", "新增功能特性", len(feat_commits) + len(feat_issues)),
        ("sec-fixes", "🐛", "Bug 修复", len(fix_commits) + len(fix_issues)),
        ("sec-issues", "🎯", "已关闭 Issues", len(issues)),
        ("sec-commits", "📝", "Git 提交记录", len(commits)),
    ]

    # ── Adaptive title based on time span ──
    span_days = (until - since).total_seconds() / 86400
    is_multi_day = span_days > 1.5  # more than ~36 hours
    if is_multi_day:
        page_title = f"PMA 系统更新汇总 — {since.strftime('%Y-%m-%d')} ~ {until.strftime('%Y-%m-%d')}"
        sidebar_label = "PMA 更新报告"
        sidebar_date = f"{since.strftime('%m-%d')} ~ {until.strftime('%m-%d')}"
        header_title = "📊 PMA 系统更新汇总"
    else:
        page_title = f"PMA 每日更新汇总 — {since.strftime('%Y-%m-%d')}"
        sidebar_label = "PMA 日报"
        sidebar_date = since.strftime("%Y-%m-%d")
        header_title = "📊 PMA 系统每日更新汇总"

    # ── HTML skeleton ──
    parts.append('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">')
    parts.append('<meta name="viewport" content="width=device-width,initial-scale=1">')
    parts.append(f'<title>{page_title}</title>')
    parts.append(f'<style>{CSS}</style></head><body>')

    # ── Sidebar ──
    parts.append('<nav class="sidebar">')
    parts.append(f'<div class="sb-title">📊 {sidebar_label}<small>{sidebar_date}</small></div>')
    for sec_id, icon, title, count in nav_items:
        badge = f'<span class="sb-badge">{count}</span>' if count > 0 else ""
        parts.append(f'<a href="#{sec_id}" onclick="scrollToSection(\'{sec_id}\');return false"><span class="sb-icon">{icon}</span>{title}{badge}</a>')
    parts.append('</nav>')

    # ── Main content ──
    parts.append('<div class="main-wrap"><div class="container">')

    # ── Version range ──
    start_version = get_version_at(repo_path, since) if repo_path else ""
    version_range = f"{start_version} → {version}" if start_version and start_version != version else version

    # ── Header ──
    parts.append('<div class="header">')
    parts.append(f'<h1>{header_title}</h1>')
    parts.append('<div class="meta">')
    parts.append(f'<span>📅 {since.strftime("%Y-%m-%d %H:%M")} → {until.strftime("%Y-%m-%d %H:%M")}（北京时间）</span>')
    parts.append(f'<span class="version-badge">{H(version_range)}</span>')
    parts.append('</div></div>')

    # ── KPI row (order matches sections: features → fixes → issues → commits) ──
    parts.append('<div class="kpi-row kpi-4col">')
    parts.append(_render_kpi(len(feat_commits), "✨ 新功能", "feat", "sec-features"))
    parts.append(_render_kpi(len(fix_commits), "🐛 Bug 修复", "fix", "sec-fixes"))
    parts.append(_render_kpi(len(issues), "已关闭 Issue", "warn", "sec-issues"))
    parts.append(_render_kpi(len(commits), "Git 提交", "accent", "sec-commits"))
    parts.append('</div>')

    # ── Section 1: Version Info ──
    parts.append('<div class="section">')
    parts.append(_render_section_header("ℹ️", "版本信息", 0, "sec-version"))
    parts.append('<div class="section-body" id="sec-version">')
    parts.append('<table><thead><tr><th>项目</th><th>值</th></tr></thead><tbody>')
    parts.append(f'<tr><td>当前版本</td><td class="mono">{H(version)}</td></tr>')
    parts.append(f'<tr><td>报告生成时间</td><td>{until.strftime("%Y-%m-%d %H:%M:%S")} (UTC+8)</td></tr>')
    parts.append(f'<tr><td>Git 仓库</td><td class="mono">bsp_dev/fake_it/pma</td></tr>')
    parts.append(f'<tr><td>报告周期</td><td>{since.strftime("%Y-%m-%d %H:%M")} → {until.strftime("%Y-%m-%d %H:%M")}</td></tr>')
    parts.append(f'<tr><td>变更文件数</td><td>{len(changed_files)} 个文件</td></tr>')
    parts.append('</tbody></table></div></div>')

    # ── Section 2: Features ──
    parts.append('<div class="section">')
    parts.append(_render_section_header("✨", "新增功能特性", len(feat_commits) + len(feat_issues), "sec-features"))
    parts.append('<div class="section-body" id="sec-features">')
    if not feat_commits and not feat_issues:
        parts.append('<div class="empty">过去 24 小时内无新增功能特性</div>')
    else:
        parts.append('<table><thead><tr><th style="width:85px">Issue</th><th>标题</th><th style="width:75px">创建人</th><th style="width:180px">影响页面</th><th style="width:28%">解决方案简述</th><th style="width:28%">实际效果</th></tr></thead><tbody>')
        for i in feat_issues:
            sol, effect = extract_solution_from_notes(i.get("notes", []))
            related = linked.get(i["iid"], [])
            pages = _pages_for_row(related, i, commit_files)
            parts.append('<tr>')
            parts.append(f'<td><a class="issue-link" href="{H(i["web_url"])}" target="_blank">#{i["iid"]}</a></td>')
            parts.append(f'<td><strong>{H(i["title"])}</strong></td>')
            parts.append(f'<td>{H(i.get("author",""))}</td>')
            parts.append(f'<td>{_render_page_chips(pages)}</td>')
            parts.append(f'<td style="font-size:12px">{H(sol) if sol else "—"}</td>')
            parts.append(f'<td style="font-size:12px">{H(effect) if effect else "—"}</td>')
            parts.append('</tr>')
        for c in feat_commits:
            refs = extract_issue_refs(c["subject"])
            if not any(r in feat_linked_iids for r in refs):
                pages = _pages_for_row([c], None, commit_files)
                parts.append('<tr>')
                parts.append('<td style="color:var(--muted)">—</td>')
                parts.append(f'<td><strong>{H(c["description"])}</strong></td>')
                parts.append(f'<td>{H(c["author"])}</td>')
                parts.append(f'<td>{_render_page_chips(pages)}</td>')
                parts.append('<td style="color:var(--muted);font-size:12px">—</td>')
                parts.append('<td style="color:var(--muted);font-size:12px">—</td>')
                parts.append('</tr>')
        parts.append('</tbody></table>')
    parts.append('</div></div>')

    # ── Section 3: Bug Fixes ──
    parts.append('<div class="section">')
    parts.append(_render_section_header("🐛", "Bug 修复", len(fix_commits) + len(fix_issues), "sec-fixes"))
    parts.append('<div class="section-body" id="sec-fixes">')
    if not fix_commits and not fix_issues:
        parts.append('<div class="empty">过去 24 小时内无 Bug 修复</div>')
    else:
        parts.append('<table><thead><tr><th style="width:85px">Issue</th><th>标题</th><th style="width:75px">创建人</th><th style="width:180px">影响页面</th><th style="width:28%">解决方案简述</th><th style="width:28%">实际效果</th></tr></thead><tbody>')
        for i in fix_issues:
            sol, effect = extract_solution_from_notes(i.get("notes", []))
            related = linked.get(i["iid"], [])
            pages = _pages_for_row(related, i, commit_files)
            parts.append('<tr>')
            parts.append(f'<td><a class="issue-link" href="{H(i["web_url"])}" target="_blank">#{i["iid"]}</a></td>')
            parts.append(f'<td><strong>{H(i["title"])}</strong></td>')
            parts.append(f'<td>{H(i.get("author",""))}</td>')
            parts.append(f'<td>{_render_page_chips(pages)}</td>')
            parts.append(f'<td style="font-size:12px">{H(sol) if sol else "—"}</td>')
            parts.append(f'<td style="font-size:12px">{H(effect) if effect else "—"}</td>')
            parts.append('</tr>')
        for c in fix_commits:
            refs = extract_issue_refs(c["subject"])
            if not any(r in fix_linked_iids for r in refs):
                pages = _pages_for_row([c], None, commit_files)
                parts.append('<tr>')
                parts.append('<td style="color:var(--muted)">—</td>')
                parts.append(f'<td><strong>{H(c["description"])}</strong></td>')
                parts.append(f'<td>{H(c["author"])}</td>')
                parts.append(f'<td>{_render_page_chips(pages)}</td>')
                parts.append('<td style="color:var(--muted);font-size:12px">—</td>')
                parts.append('<td style="color:var(--muted);font-size:12px">—</td>')
                parts.append('</tr>')
        parts.append('</tbody></table>')
    parts.append('</div></div>')

    # ── Section 4: Closed Issues (detailed cards) ──
    parts.append('<div class="section">')
    parts.append(_render_section_header("🎯", "已关闭的 GitLab Issues", len(issues), "sec-issues"))
    parts.append('<div class="section-body" id="sec-issues">')
    if not issues:
        parts.append('<div class="empty">过去 24 小时内无已关闭的 Issue</div>')
    else:
        for issue in issues:
            closed_display = issue["closed_at"]
            if closed_display:
                closed_dt = parse_iso(closed_display)
                if closed_dt:
                    closed_display = closed_dt.astimezone(BEIJING_TZ).strftime("%Y-%m-%d %H:%M")
            labels_html = ""
            for lb in issue.get("labels", []):
                lb_lower = lb.lower()
                if "bug" in lb_lower:
                    labels_html += f'<span class="tag tag-bug">{H(lb)}</span> '
                elif "enhancement" in lb_lower or "feature" in lb_lower:
                    labels_html += f'<span class="tag tag-enhancement">{H(lb)}</span> '
                elif "feedback" in lb_lower:
                    labels_html += f'<span class="tag tag-feedback">{H(lb)}</span> '
                else:
                    labels_html += f'<span class="tag tag-other">{H(lb)}</span> '

            parts.append('<div class="issue-card">')
            parts.append('<div class="issue-card-header">')
            parts.append(f'<span class="issue-num"><a href="{H(issue["web_url"])}" target="_blank">#{issue["iid"]}</a></span>')
            parts.append('<div class="issue-info">')
            parts.append(f'<div class="issue-title">{H(issue["title"])}</div>')
            parts.append(f'<div class="issue-meta"><span>👤 创建者: {H(issue.get("author",""))}</span><span>🕐 关闭于 {closed_display}</span></div>')
            parts.append(f'<div style="margin-top:4px">{labels_html}</div>')
            parts.append('</div></div>')

            # Notes
            if issue.get("notes"):
                parts.append('<div class="issue-card-body">')
                for note in issue["notes"][:5]:
                    note_time = ""
                    note_dt = parse_iso(note.get("created_at", ""))
                    if note_dt:
                        note_time = note_dt.astimezone(BEIJING_TZ).strftime("%m-%d %H:%M")
                    body_clean = _render_markdown(note.get("body", "")[:2000])
                    parts.append(f'<div class="field"><div class="field-label">💬 {H(note.get("author",""))} · {note_time}</div>')
                    parts.append(f'<div class="field-value" style="font-size:12.5px;color:#555">{body_clean}</div></div>')
                parts.append('</div>')
            parts.append('</div>')
    parts.append('</div></div>')

    # ── Section 5: Git Commits ──
    parts.append('<div class="section">')
    parts.append(_render_section_header("📝", "Git 提交记录", len(commits), "sec-commits"))
    parts.append('<div class="section-body" id="sec-commits">')
    if not commits:
        parts.append('<div class="empty">过去 24 小时内无新提交</div>')
    else:
        by_type: Dict[str, List[dict]] = {}
        for c in commits:
            by_type.setdefault(c["type"], []).append(c)
        parts.append('<table><thead><tr><th style="width:40px">#</th><th style="width:110px">类型</th><th style="width:90px">Hash</th><th style="width:90px">作者</th><th>描述</th></tr></thead><tbody>')
        row_num = 0
        for ctype in sorted(by_type.keys()):
            label = COMMIT_TYPE_LABELS.get(ctype, f"📌 {ctype}")
            css_cls = _commit_type_class(ctype)
            for c in by_type[ctype]:
                row_num += 1
                desc = H(c["description"])
                if c["scope"]:
                    desc = f'<strong>({H(c["scope"])})</strong> {desc}'
                parts.append(f'<tr><td class="num">{row_num}</td><td><span class="commit-type {css_cls}">{label}</span></td>')
                parts.append(f'<td class="mono">{H(c["hash"])}</td><td>{H(c["author"])}</td><td>{desc}</td></tr>')
        parts.append('</tbody></table>')
    parts.append('</div></div>')

    # ── Footer ──
    parts.append('<div class="footer">')
    parts.append(f'本报告由 <strong>PMA Daily Summary Skill</strong> 自动生成于 {until.strftime("%Y-%m-%d %H:%M:%S")} (UTC+8)')
    parts.append('</div>')

    parts.append('</div></div>')  # close .container and .main-wrap

    # ── Back to top button ──
    parts.append('<button class="back-to-top" onclick="window.scrollTo({top:0,behavior:\'smooth\'})" title="回到顶部">⬆</button>')

    # ── JavaScript ──
    parts.append('<script>')
    parts.append('function scrollToSection(id){var el=document.getElementById(id);if(el){el.scrollIntoView({behavior:"smooth",block:"start"});}}')
    parts.append('</script>')

    parts.append('</body></html>')
    return "\n".join(parts)


# ── Main ────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="PMA Daily System Update Summary Generator")
    parser.add_argument("--repo-path", required=True, help="Path to PMA repository")
    parser.add_argument("--output", required=True, help="Output HTML file path")
    parser.add_argument("--hours", type=int, default=24, help="Hours to look back (default: 24)")
    parser.add_argument("--since", default=None,
        help="Start datetime in ISO 8601 format (e.g. 2026-08-01T00:00:00+08:00). Overrides --hours if provided.")
    args = parser.parse_args()

    repo_path = os.path.abspath(args.repo_path)
    if not os.path.isdir(repo_path):
        print(f"[ERROR] Repo path does not exist: {repo_path}", file=sys.stderr)
        sys.exit(1)

    now = beijing_now()
    if args.since:
        since = parse_iso(args.since)
        if since is None:
            print(f"[ERROR] Invalid --since format: {args.since}", file=sys.stderr)
            sys.exit(1)
    else:
        since = now - timedelta(hours=args.hours)

    print(f"[INFO] Report period: {since.strftime('%Y-%m-%d %H:%M')} → {now.strftime('%Y-%m-%d %H:%M')} (UTC+8)")
    print(f"[INFO] Repo path: {repo_path}")

    # 1. Version
    print("[INFO] Fetching version...")
    version = get_version(repo_path)
    print(f"[INFO] Version: {version}")

    # 2. Git log
    print("[INFO] Fetching git log...")
    commits = get_git_log(repo_path, since)
    print(f"[INFO] Found {len(commits)} commits")

    # 3. GitLab issues
    print("[INFO] Fetching closed GitLab issues...")
    issues = get_closed_issues(repo_path, since)
    print(f"[INFO] Found {len(issues)} closed issues")

    # 4. Per-commit files (for page-level impact analysis)
    print("[INFO] Analyzing per-commit file changes...")
    commit_files = get_per_commit_files(repo_path, commits)

    # 5. Changed files overview
    print("[INFO] Analyzing changed files...")
    changed_files, affected_pages = get_changed_files(repo_path, since)
    print(f"[INFO] {len(changed_files)} files changed, {len(affected_pages)} pages affected")

    # 6. Generate report
    print("[INFO] Generating report...")
    linked = match_commits_to_issues(commits, issues)
    report = generate_report(
        since=since,
        until=now,
        version=version,
        commits=commits,
        issues=issues,
        changed_files=changed_files,
        affected_pages=affected_pages,
        linked=linked,
        commit_files=commit_files,
        repo_path=repo_path,
    )

    # 7. Write output
    os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as f:
        f.write(report)

    print(f"[INFO] Report written to {args.output}")
    print(f"[INFO] Done. Report size: {len(report)} chars, {len(report.splitlines())} lines")


if __name__ == "__main__":
    main()
