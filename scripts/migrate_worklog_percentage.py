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
    #         for each (user_id, date) that has unmigrated records
    affected_dates = set((uid, d) for _, _, uid, _, d in unmigrated_rows)
    day_totals = defaultdict(float)  # (user_id, date) -> total hours from ALL records
    for (uid, d) in affected_dates:
        total = 0.0
        for table in ("pma_worklogs", "pma_bug_worklogs"):
            cursor.execute(
                f"SELECT COALESCE(SUM(hours), 0) FROM {table} WHERE user_id = ? AND date = ?",
                (uid, d),
            )
            total += cursor.fetchone()[0]
        day_totals[(uid, d)] = total

    # Step 3: Compute percentage for each unmigrated record
    # updates: list of [table, percentage, calculated_hours, worklog_id]
    updates = []
    for table, wl_id, user_id, hours, d in unmigrated_rows:
        total = day_totals[(user_id, d)]
        if total > 0:
            pct = round(hours / total * 100)
        else:
            pct = 100
        pct = max(5, min(100, pct))
        calc_hours = hours  # initial = original hours; WeCom sync will recalibrate
        updates.append([table, pct, calc_hours, wl_id])

    # Step 4: Adjust unmigrated records so the date's TOTAL (migrated + unmigrated) sums to 100
    # First, compute already-migrated percentage total per (user_id, date)
    migrated_pct = defaultdict(float)
    for (uid, d) in affected_dates:
        for table in ("pma_worklogs", "pma_bug_worklogs"):
            cursor.execute(
                f"SELECT COALESCE(SUM(percentage), 0) FROM {table} WHERE user_id = ? AND date = ? AND percentage IS NOT NULL",
                (uid, d),
            )
            migrated_pct[(uid, d)] += cursor.fetchone()[0]

    # Group unmigrated updates by (user_id, date)
    # updates elements: [table, percentage, calculated_hours, worklog_id]
    group_updates = defaultdict(list)
    for idx, item in enumerate(updates):
        tbl = item[0]; wl_id = item[3]
        for t, wid, uid, h, d in unmigrated_rows:
            if t == tbl and wid == wl_id:
                group_updates[(uid, d)].append(idx)
                break

    for (uid, d), indices in group_updates.items():
        already = migrated_pct[(uid, d)]
        remaining = max(0, 100 - already)
        # sum hours from unmigrated_rows for these indices
        group_hours = []
        total_h = 0.0
        for j in indices:
            tbl = updates[j][0]; wl_id = updates[j][3]
            for t, wid, u, h, dt in unmigrated_rows:
                if t == tbl and wid == wl_id:
                    group_hours.append((j, h))
                    total_h += h
                    break
        if total_h > 0 and remaining > 0:
            for j, h in group_hours:
                new_pct = round(h / total_h * remaining)
                new_pct = max(5, min(100, new_pct))
                # updates[j] = [table, percentage, calculated_hours, worklog_id]
                updates[j][1] = new_pct

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
        print("\nPreview (--dry-run):")
        for item in updates:
            print(f"  {item[0]} id={item[3]}: percentage={item[1]}%, calculated_hours={item[2]}")

    conn.close()
    return stats


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
        # Pick the largest one (most likely the active database)
        db_path = os.path.join(data_dir, max(candidates, key=lambda f: os.path.getsize(os.path.join(data_dir, f))))

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
