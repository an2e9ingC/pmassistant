#!/usr/bin/env python3
"""Migrate existing worklogs from hours to percentage.

Usage:
    python3 scripts/migrate_worklog_percentage.py --dry-run   # Preview changes
    python3 scripts/migrate_worklog_percentage.py             # Execute migration
    python3 scripts/migrate_worklog_percentage.py --db-path /path/to/custom.db

For each WorkLog and BugWorkLog where percentage IS NULL:
  - Look up day_checkin_hours from WeComCheckin → WeComSchedule → default 8h
  - percentage = ROUND(hours / day_checkin_hours * 100)
  - calculated_hours = hours (initial value; WeCom sync will recalculate later)
"""
import argparse
import os
import sys
from datetime import date

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def get_day_checkin_hours(cursor, local_user_id: int, d: str) -> float:
    """Find expected hours for a user on a specific date.
    Priority: WeComCheckin.work_hours → WeComSchedule → default 8h
    """
    default_hours = 8.0

    # Step 1: Find LocalUser → wecom_userid
    cursor.execute("SELECT wecom_userid FROM local_users WHERE id = ?", (local_user_id,))
    row = cursor.fetchone()
    if not row or not row[0]:
        return default_hours

    wecom_userid = row[0]

    # Step 2: Look up WeCom checkin hours for that date
    cursor.execute(
        "SELECT work_hours FROM pma_wecom_checkins WHERE user_id = ? AND date = ? LIMIT 1",
        (wecom_userid, d),
    )
    row = cursor.fetchone()
    if row and row[0] and row[0] > 0:
        return float(row[0])

    # Step 3: Look up WeCom schedule for that month
    try:
        dt = date.fromisoformat(d)
        year, month = dt.year, dt.month
        cursor.execute(
            "SELECT work_hours, work_days FROM pma_wecom_schedule WHERE year = ? AND month = ? LIMIT 1",
            (year, month),
        )
        row = cursor.fetchone()
        if row and row[0] and row[1] and row[1] > 0:
            return float(row[0]) / int(row[1])  # daily avg
    except (ValueError, TypeError):
        pass

    return default_hours


def migrate(db_path: str, dry_run: bool = False) -> dict:
    """Run the migration. Returns stats dict.

    For each (user_id, date), calculates percentage as:
        worklog_hours / total_hours_for_that_user_date * 100

    This ensures all worklogs on the same day sum to 100%,
    regardless of WeCom checkin data. When WeCom data is later
    synced, calculated_hours will be recalibrated as:
        percentage × checkin_hours
    """
    import sqlite3
    from collections import defaultdict

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    stats = {"total": 0, "migrated": 0, "skipped": 0, "errors": 0}

    # Step 1: Collect all unmigrated records
    unmigrated_rows = []  # (table, id, user_id, hours, date)
    for table in ("pma_worklogs", "pma_bug_worklogs"):
        cursor.execute(
            f"SELECT id, user_id, hours, date FROM {table} WHERE percentage IS NULL AND hours > 0"
        )
        for wl_id, user_id, hours, d in cursor.fetchall():
            unmigrated_rows.append((table, wl_id, user_id, hours, d))

    if not unmigrated_rows:
        conn.close()
        return stats

    stats["total"] = len(unmigrated_rows)

    # Step 2: Compute day totals using ALL records (migrated + unmigrated)
    #         Denominator = max(total hours, 8h standard) so a single short record
    #         does NOT become 100% (which would block further time logging).
    affected_dates = set((uid, d) for _, _, uid, _, d in unmigrated_rows)
    day_denominators = defaultdict(float)  # (user_id, date) -> denominator hours
    for (uid, d) in affected_dates:
        total = 0.0
        for table in ("pma_worklogs", "pma_bug_worklogs"):
            cursor.execute(
                f"SELECT COALESCE(SUM(hours), 0) FROM {table} WHERE user_id = ? AND date = ?",
                (uid, d),
            )
            total += cursor.fetchone()[0]
        day_denominators[(uid, d)] = max(total, 8.0)

    # Step 3: Compute percentage for each unmigrated record
    # updates: list of [table, percentage, calculated_hours, worklog_id]
    updates = []
    for table, wl_id, user_id, hours, d in unmigrated_rows:
        denom = day_denominators[(user_id, d)]
        pct = round(hours / denom * 100) if denom > 0 else 0
        pct = max(5, min(100, pct))
        calc_hours = hours  # initial = original hours; WeCom sync will recalibrate
        updates.append([table, pct, calc_hours, wl_id])

    # Step 5: Apply updates
    if not dry_run:
        for item in updates:
            table, pct, calc_hours, wl_id = item[0], item[1], item[2], item[3]
            cursor.execute(
                f"UPDATE {table} SET percentage = ?, calculated_hours = ? WHERE id = ?",
                (pct, calc_hours, wl_id),
            )
            stats["migrated"] += 1
        conn.commit()
    else:
        stats["migrated"] = len(updates)

    if dry_run:
        _print_dry_run_report(conn, unmigrated_rows, updates)

    conn.close()
    return stats


def _print_dry_run_report(conn, unmigrated_rows, updates):
    """Print a human-readable dry-run report grouped by user + date."""
    # Build pct lookup: (table, wl_id) -> percentage
    pct_map = {}
    for item in updates:
        pct_map[(item[0], item[3])] = item[1]

    # Fetch user names, task titles, bug titles in bulk
    user_names = {}
    for (uid,) in conn.execute("SELECT id FROM local_users"):
        row = conn.execute("SELECT display_name, username FROM local_users WHERE id = ?", (uid,)).fetchone()
        user_names[uid] = (row[0] or row[1]) if row else "?"
    task_titles = {}
    for (tid, title) in conn.execute("SELECT id, title FROM pma_tasks"):
        task_titles[tid] = title or "?"
    bug_titles = {}
    for (bid, title) in conn.execute("SELECT id, title FROM pma_bugs"):
        bug_titles[bid] = title or "?"

    # Group by (user_id, date)
    from collections import defaultdict
    groups = defaultdict(list)  # (user_id, date) -> list of entries
    for table, wl_id, user_id, hours, d in unmigrated_rows:
        pct = pct_map.get((table, wl_id), 0)
        if table == "pma_worklogs":
            task_id = conn.execute("SELECT task_id FROM pma_worklogs WHERE id = ?", (wl_id,)).fetchone()
            task_id = task_id[0] if task_id else None
            title = task_titles.get(task_id, "?") if task_id else "?"
            source = "任务"
        else:
            bug_id = conn.execute("SELECT bug_id FROM pma_bug_worklogs WHERE id = ?", (wl_id,)).fetchone()
            bug_id = bug_id[0] if bug_id else None
            title = bug_titles.get(bug_id, "?") if bug_id else "?"
            source = "Bug"
        groups[(user_id, d)].append((source, title, hours, pct))

    # Sort groups by user then date
    sorted_groups = sorted(groups.items(), key=lambda kv: (user_names.get(kv[0][0], "?"), kv[0][1]))

    print("\n" + "=" * 70)
    print("  迁移预览（DRY RUN — 不会写入数据库）")
    print("=" * 70)
    for (user_id, d), entries in sorted_groups:
        name = user_names.get(user_id, "?")
        total_h = sum(e[2] for e in entries)
        total_pct = sum(e[3] for e in entries)
        print(f"\n▎ {name}  {d}   共 {total_h:.1f}h  →  合计 {total_pct}%")
        for source, title, hours, pct in entries:
            title_disp = title[:24] if len(str(title)) > 24 else title
            print(f"     · {source}: {title_disp}")
            print(f"        {hours:.1f}h → {pct}%")
    print("\n" + "=" * 70)
    print(f"  共 {len(unmigrated_rows)} 条记录待迁移")
    print("=" * 70)


def main():
    parser = argparse.ArgumentParser(description="Migrate worklogs from hours to percentage")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview changes without writing to database",
    )
    parser.add_argument(
        "--db-path",
        default=None,
        help="Path to SQLite database (default: auto-detect from pma-*.db in data/)",
    )
    args = parser.parse_args()

    db_path = args.db_path
    if not db_path:
        # Auto-detect: find pma-*.db in data/
        data_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
        candidates = sorted(
            [f for f in os.listdir(data_dir) if f.startswith("pma-") and f.endswith(".db")],
            reverse=True,
        )
        if not candidates:
            print("ERROR: No pma-*.db found in data/ directory. Specify --db-path.")
            sys.exit(1)
        # Pick the most recently modified one (most likely the active database)
        db_path = os.path.join(data_dir, max(candidates, key=lambda f: os.path.getmtime(os.path.join(data_dir, f))))

    if not os.path.exists(db_path):
        print(f"ERROR: Database not found: {db_path}")
        sys.exit(1)

    print(f"Database: {db_path}")
    print(f"Mode: {'DRY RUN (no changes will be made)' if args.dry_run else 'LIVE MIGRATION'}")
    print()

    stats = migrate(db_path, dry_run=args.dry_run)

    print(f"Total unmigrated records: {stats['total']}")
    print(f"Migrated: {stats['migrated']}")
    print(f"Skipped:   {stats['skipped']}")
    print(f"Errors:    {stats['errors']}")

    if args.dry_run:
        print()
        print("This was a DRY RUN. Run without --dry-run to execute the migration.")


if __name__ == "__main__":
    main()
