#!/usr/bin/env python3
"""一次性脚本：将混在评论表里的操作记录迁移到新的 action 表（pma_entity_actions）。

背景：任务/Bug 的操作记录（字段变更）此前作为普通评论写入 pma_task_comments /
pma_bug_comments。本脚本识别这些变更记录，迁移到 pma_entity_actions +
pma_entity_action_changes（结构化 old/new），纯评论保持不变。

识别规则：
- 任务评论：content 形如 "状态: review -> done; 负责人: 张三 -> 李四"（多字段用 "; " 分隔）
- Bug 评论：is_system=1 的是系统日志，整体迁移为 updated 操作

用法：
    python3 scripts/migrate_comments_to_actions.py [--dry-run] [--db /path/to/db]

    --dry-run  仅检测不修改
    --db       指定数据库路径（默认: data/pma-8000.db）
"""

import argparse
import re
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

# 中文 label → 英文字段名（反向映射 FIELD_LABEL）
LABEL_TO_FIELD = {
    "标题": "title", "描述": "description", "状态": "status", "优先级": "priority",
    "类型": "type", "迭代": "execution_id", "阶段名称": "stage_name", "阶段": "stage_name",
    "负责人": "assignee_id", "审批人": "reviewer_id", "父任务": "parent_id",
    "阻塞任务": "blocked_by_id", "抄送人": "cc_user_ids", "开始日期": "start_date",
    "截止日期": "due_date", "排序": "sort_order", "进度": "progress", "预估工时": "estimate_hours",
}

# 匹配单条字段变更 "label: old -> new"
CHANGE_RE = re.compile(r"^([^:;]+):\s*(.*?)\s*->\s*(.*?)$", re.DOTALL)


def _parse_task_changes(content: str):
    """解析任务变更记录字符串，返回 changes 列表。无法解析返回 None。"""
    if "->" not in content and "→" not in content:
        return None
    # 归一化箭头
    content = content.replace("→", "->")
    parts = [p.strip() for p in content.split(";") if p.strip()]
    changes = []
    for part in parts:
        m = CHANGE_RE.match(part)
        if not m:
            return None  # 有片段不是变更格式 → 视为混合内容，不迁移
        label, old, new = m.group(1).strip(), m.group(2).strip(), m.group(3).strip()
        field = LABEL_TO_FIELD.get(label, label)
        changes.append({"field": field, "old_value": old, "new_value": new})
    return changes if changes else None


def migrate(db_path: str, dry_run: bool = False) -> None:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # 检查 action 表是否已存在
    tbl = cur.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='pma_entity_actions'"
    ).fetchone()
    if not tbl:
        print("[错误] pma_entity_actions 表不存在，请先启动服务器完成 init_db()")
        sys.exit(1)

    task_migrated = 0
    task_skipped = 0
    bug_migrated = 0

    # ── 任务评论 ──
    task_comments = cur.execute(
        "SELECT id, task_id, user_id, content, created_at FROM pma_task_comments ORDER BY id"
    ).fetchall()
    for c in task_comments:
        changes = _parse_task_changes(c["content"])
        if changes is None:
            task_skipped += 1
            continue
        if dry_run:
            task_migrated += 1
            print(f"[dry-run] task_comment #{c['id']} → updated ({len(changes)} changes)")
            continue
        # 创建 action
        cur.execute(
            "INSERT INTO pma_entity_actions (entity_type, entity_id, user_id, action, comment, created_at) "
            "VALUES ('task', ?, ?, 'updated', NULL, ?)",
            (c["task_id"], c["user_id"], c["created_at"]),
        )
        action_id = cur.lastrowid
        for ch in changes:
            cur.execute(
                "INSERT INTO pma_entity_action_changes (action_id, field, old_value, new_value) "
                "VALUES (?, ?, ?, ?)",
                (action_id, ch["field"], ch["old_value"], ch["new_value"]),
            )
        # 删除旧评论（已迁移）
        cur.execute("DELETE FROM pma_task_comments WHERE id = ?", (c["id"],))
        task_migrated += 1

    # ── Bug 评论（is_system=1 → 迁移为 updated 操作）──
    bug_comments = cur.execute(
        "SELECT id, bug_id, user_id, content, created_at FROM pma_bug_comments WHERE is_system = 1 ORDER BY id"
    ).fetchall()
    for c in bug_comments:
        if dry_run:
            bug_migrated += 1
            print(f"[dry-run] bug_comment #{c['id']} (system) → updated")
            continue
        cur.execute(
            "INSERT INTO pma_entity_actions (entity_type, entity_id, user_id, action, comment, created_at) "
            "VALUES ('bug', ?, ?, 'updated', ?, ?)",
            (c["bug_id"], c["user_id"], c["content"], c["created_at"]),
        )
        cur.execute("DELETE FROM pma_bug_comments WHERE id = ?", (c["id"],))
        bug_migrated += 1

    if dry_run:
        print(f"\n[dry-run] 任务变更迁移 {task_migrated} 条，跳过 {task_skipped} 条；Bug 系统日志迁移 {bug_migrated} 条。未做任何修改。")
    else:
        conn.commit()
        print(f"任务变更迁移 {task_migrated} 条（跳过纯评论 {task_skipped} 条）；Bug 系统日志迁移 {bug_migrated} 条。")
    conn.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="仅检测不修改")
    parser.add_argument("--db", default="data/pma-8000.db", help="数据库路径")
    args = parser.parse_args()

    db_path = args.db
    if not Path(db_path).exists():
        print(f"[错误] 数据库不存在: {db_path}")
        sys.exit(1)

    if not args.dry_run:
        backup = db_path + ".bak-" + datetime.now().strftime("%Y%m%d-%H%M%S")
        shutil.copy2(db_path, backup)
        print(f"已备份数据库到: {backup}")

    migrate(db_path, args.dry_run)


if __name__ == "__main__":
    main()
