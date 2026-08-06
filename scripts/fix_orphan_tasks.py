#!/usr/bin/env python3
"""一次性脚本：清理引用已删除模板的悬空任务。

将 template_id 指向不存在模板行的任务的 template_id 置为 NULL、is_diverged = 1，
并通过 stage_name 匹配 ProjectStage 重新关联 stage_id。

用法：
    python3 scripts/fix_orphan_tasks.py [--dry-run] [--db /path/to/db]

    --dry-run  仅检测不修改
    --db       指定数据库路径（默认: data/pma-8000.db）
"""

import argparse
import sys
import sqlite3
from pathlib import Path


def fix_orphan_tasks(db_path: str, dry_run: bool = False) -> None:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    # 1. 查找悬空任务（template_id 指向不存在的模板）
    dangling = conn.execute("""
        SELECT t.id, t.project_id, t.stage_name, t.title, t.status, t.template_id,
               p.code as project_code
        FROM pma_tasks t
        JOIN zenta_projects p ON p.id = t.project_id
        WHERE t.template_id IS NOT NULL
          AND t.template_id NOT IN (SELECT id FROM task_templates)
        ORDER BY t.project_id, t.id
    """).fetchall()

    print(f"发现 {len(dangling)} 个悬空任务（template_id 指向不存在的模板）：")
    for d in dangling:
        print(f"  #{d['id']} project={d['project_code']}({d['project_id']}) "
              f"stage='{d['stage_name']}' title='{d['title']}' "
              f"status={d['status']} template_id={d['template_id']}")

    # 2. 查找 stage_name 与模板不一致的任务
    mismatched = conn.execute("""
        SELECT t.id, t.project_id, t.stage_name, t.title, t.status, t.template_id,
               tt.stage_type as tpl_stage_type,
               p.code as project_code
        FROM pma_tasks t
        JOIN task_templates tt ON tt.id = t.template_id
        JOIN zenta_projects p ON p.id = t.project_id
        WHERE t.stage_name != tt.stage_type
        ORDER BY t.project_id, t.id
    """).fetchall()

    print(f"\n发现 {len(mismatched)} 个 stage_name 与模板不一致的任务：")
    for m in mismatched:
        print(f"  #{m['id']} project={m['project_code']}({m['project_id']}) "
              f"task_stage='{m['stage_name']}' tpl_stage='{m['tpl_stage_type']}' "
              f"title='{m['title']}' status={m['status']}")

    if dry_run:
        print("\n[DRY RUN] 不执行修改。")
        conn.close()
        return

    if not dangling and not mismatched:
        print("\n无需修复。")
        conn.close()
        return

    confirm = input(f"\n确认修复以上 {len(dangling) + len(mismatched)} 个任务？[y/N] ")
    if confirm.lower() != 'y':
        print("已取消。")
        conn.close()
        return

    # 3. 为所有项目确保存在"未知" ProjectStage
    print("\n=== 确保所有项目存在「未知」阶段 ===")
    projects = conn.execute("SELECT id, code FROM zenta_projects ORDER BY id").fetchall()
    unknown_created = 0
    for p in projects:
        existing = conn.execute(
            "SELECT id FROM pma_project_stages WHERE project_id = ? AND name = '未知'",
            (p['id'],)
        ).fetchone()
        if not existing:
            max_sort = conn.execute(
                "SELECT MAX(sort_order) as m FROM pma_project_stages WHERE project_id = ?",
                (p['id'],)
            ).fetchone()
            next_sort = (max_sort['m'] + 1) if max_sort['m'] else 999
            conn.execute(
                "INSERT INTO pma_project_stages (project_id, name, sort_order, status) VALUES (?, '未知', ?, 'active')",
                (p['id'], next_sort)
            )
            unknown_created += 1
    if unknown_created:
        conn.commit()
        print(f"  已为 {unknown_created} 个项目创建「未知」阶段")

    # 4. stage_name='None' 或 NULL → '未知'，并关联未知 ProjectStage
    none_tasks = conn.execute("""
        SELECT t.id, t.project_id, t.title, p.code
        FROM pma_tasks t
        JOIN zenta_projects p ON p.id = t.project_id
        WHERE t.stage_name IS NULL OR t.stage_name = 'None'
    """).fetchall()
    if none_tasks:
        print(f"\n发现 {len(none_tasks)} 个 stage_name 为 None/NULL 的任务：")
        for nt in none_tasks:
            print(f"  #{nt['id']} project={nt['code']} title='{nt['title']}'")
        if not dry_run:
            for nt in none_tasks:
                unknown_stage = conn.execute(
                    "SELECT id FROM pma_project_stages WHERE project_id = ? AND name = '未知'",
                    (nt['project_id'],)
                ).fetchone()
                if unknown_stage:
                    conn.execute(
                        "UPDATE pma_tasks SET stage_name = '未知', stage_id = ? WHERE id = ?",
                        (unknown_stage['id'], nt['id'])
                    )
            print(f"  已迁移 {len(none_tasks)} 个任务至「未知」阶段")

    # 5. 修复悬空任务：template_id = NULL
        dangling_ids = [d['id'] for d in dangling]
        conn.execute(f"""
            UPDATE pma_tasks SET template_id = NULL
            WHERE id IN ({','.join('?' for _ in dangling_ids)})
        """, dangling_ids)
        print(f"已修复 {len(dangling)} 个悬空任务（template_id → NULL，任务保持可见）")

    # 4. 修复 stage_name 不一致：更新为正确的模板 stage_type
    if mismatched:
        for m in mismatched:
            conn.execute("""
                UPDATE pma_tasks SET stage_name = ? WHERE id = ?
            """, (m['tpl_stage_type'], m['id']))
        print(f"已修复 {len(mismatched)} 个 stage_name 不一致的任务")

    # 5. 重新关联 stage_id：对 stage_name 不为 NULL/None 且 stage_id 为空的任务
    relinked = 0
    tasks_no_stage_id = conn.execute("""
        SELECT t.id, t.project_id, t.stage_name
        FROM pma_tasks t
        WHERE t.stage_name IS NOT NULL AND t.stage_name != 'None'
          AND t.stage_id IS NULL
    """).fetchall()

    for t in tasks_no_stage_id:
        stage = conn.execute("""
            SELECT id FROM pma_project_stages
            WHERE project_id = ? AND name = ?
        """, (t['project_id'], t['stage_name'])).fetchone()
        if stage:
            conn.execute("UPDATE pma_tasks SET stage_id = ? WHERE id = ?",
                         (stage['id'], t['id']))
            relinked += 1

    if relinked:
        print(f"已重新关联 {relinked} 个任务的 stage_id")

    conn.commit()
    conn.close()
    print("\n修复完成。")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="清理引用已删除模板的悬空任务")
    parser.add_argument("--dry-run", action="store_true", help="仅检测不修改")
    parser.add_argument("--db", default=None, help="数据库路径")
    args = parser.parse_args()

    if args.db:
        db_path = args.db
    else:
        # 默认：当前目录下的 data/pma-8000.db
        script_dir = Path(__file__).resolve().parent
        project_dir = script_dir.parent
        db_path = str(project_dir / "data" / "pma-8000.db")

    if not Path(db_path).exists():
        print(f"错误: 数据库文件不存在: {db_path}")
        sys.exit(1)

    fix_orphan_tasks(db_path, args.dry_run)
