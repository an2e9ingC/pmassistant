#!/usr/bin/env python3
"""一次性脚本：将模板创建的任务的创建人批量迁移到 system 用户（id=99999）。

将所有 template_id IS NOT NULL 且 reporter_id != 99999 的任务的 reporter_id 更新为 99999。

用法：
    python3 scripts/migrate_template_task_creators.py [--dry-run] [--db /path/to/db]

    --dry-run  仅检测不修改
    --db       指定数据库路径（默认: data/pma-8000.db）
"""

import argparse
import sqlite3
import sys
from pathlib import Path

SYSTEM_USER_ID = 99999


def migrate(db_path: str, dry_run: bool = False) -> None:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    # 检查 system 用户是否存在
    sys_user = conn.execute(
        "SELECT id, username, display_name FROM local_users WHERE id = ?",
        (SYSTEM_USER_ID,)
    ).fetchone()

    if not sys_user:
        print(f"[错误] system 用户 (id={SYSTEM_USER_ID}) 不存在，请先启动服务器完成 init_db()")
        sys.exit(1)

    print(f"目标用户: #{sys_user['id']} {sys_user['username']} ({sys_user['display_name']})")

    # 查找需要迁移的任务，按旧 reporter_id 分组统计
    stats = conn.execute("""
        SELECT t.reporter_id, u.username, u.display_name, COUNT(*) as cnt
        FROM pma_tasks t
        LEFT JOIN local_users u ON u.id = t.reporter_id
        WHERE t.template_id IS NOT NULL AND t.reporter_id != ?
        GROUP BY t.reporter_id
        ORDER BY cnt DESC
    """, (SYSTEM_USER_ID,)).fetchall()

    total = sum(s["cnt"] for s in stats)

    if total == 0:
        print("没有需要迁移的任务（所有模板任务的创建人已经是 system 用户）")
        return

    print(f"\n待迁移任务: {total} 个，按旧创建人分组：")
    for s in stats:
        name = f"{s['display_name'] or s['username'] or '?'} (@{s['username'] or '?'})"
        print(f"  reporter_id={s['reporter_id']} {name}: {s['cnt']} 个")

    if dry_run:
        print("\n[dry-run] 以上为预览，未做任何修改")
        return

    # 确认
    answer = input(f"\n确认将这 {total} 个任务的创建人更新为 system 用户？[y/N] ")
    if answer.strip().lower() != "y":
        print("已取消")
        return

    # 执行更新
    conn.execute("""
        UPDATE pma_tasks
        SET reporter_id = ?
        WHERE template_id IS NOT NULL AND reporter_id != ?
    """, (SYSTEM_USER_ID, SYSTEM_USER_ID))
    conn.commit()

    updated = conn.total_changes
    print(f"\n完成：已更新 {updated} 个任务的创建人为 system 用户")
    conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="迁移模板任务的创建人到 system 用户")
    parser.add_argument("--dry-run", action="store_true", help="仅检测不修改")
    parser.add_argument("--db", default=None, help="数据库路径（默认: data/pma-8000.db）")
    args = parser.parse_args()

    db_path = args.db or str(Path(__file__).resolve().parent.parent / "data" / "pma-8000.db")
    if not Path(db_path).exists():
        print(f"[错误] 数据库不存在: {db_path}")
        sys.exit(1)

    migrate(db_path, args.dry_run)
