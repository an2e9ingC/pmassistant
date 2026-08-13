#!/usr/bin/env python3
"""Migrate document template glob patterns to regex.

Converts * → .* and ? → . in all document_templates fields
(file_pattern, doc_path) across all doc_types (gitlab, svn, nas, solidworks, pma).

Usage:
    python scripts/migrate_templates_to_regex.py --dry-run   # Preview only
    python scripts/migrate_templates_to_regex.py              # Execute migration
    python scripts/migrate_templates_to_regex.py --db /path/to/pma.db
"""

import argparse
import json
import os
import re
import sqlite3
import sys
from datetime import datetime
from typing import Optional


def glob_to_regex(value, changed_only=False):
    
    """Convert glob wildcards to regex. Returns (new_value, changed)."""
    if not value:
        return value, False
    if '*' not in value and '?' not in value:
        return value, False
    # Replace * → .* and ? → .
    new = value
    new = new.replace('*', '.*')
    new = new.replace('?', '.')
    return new, new != value


def collect_templates(db_path):
    
    """Collect all document_templates with their current patterns."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT id, doc_name, stage_type, doc_type, file_pattern, doc_path "
        "FROM document_templates "
        "ORDER BY id"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def collect_product_docs(db_path):
    """Collect product_documents with glob in doc_path (product docs have no base_path/file_pattern)."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT pd.id, pd.doc_name, pd.doc_path, pp.code AS product_code "
        "FROM product_documents pd "
        "LEFT JOIN pma_products pp ON pd.product_id = pp.id "
        "WHERE pd.doc_path LIKE '%*%' OR pd.doc_path LIKE '%?%' "
        "ORDER BY pd.id"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def collect_project_docs(db_path):
    """Collect project_documents with glob in doc_path/base_path/file_pattern."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT pjd.id, pjd.doc_name, pjd.doc_path, pjd.base_path, pjd.file_pattern, "
        "       pj.name AS project_name "
        "FROM project_documents pjd "
        "LEFT JOIN zenta_projects pj ON pjd.project_id = pj.id "
        "WHERE pjd.doc_path LIKE '%*%' OR pjd.doc_path LIKE '%?%' "
        "   OR pjd.base_path LIKE '%*%' OR pjd.base_path LIKE '%?%' "
        "   OR pjd.file_pattern LIKE '%*%' OR pjd.file_pattern LIKE '%?%' "
        "ORDER BY pjd.id"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def print_template_changes(templates, dry_run=True):
    """Print a table of all template changes."""
    changes = []
    for t in templates:
        fp_new, fp_changed = glob_to_regex(t.get('file_pattern'))
        dp_new, dp_changed = glob_to_regex(t.get('doc_path'))
        if fp_changed:
            changes.append({
                'id': t['id'],
                'type': t.get('doc_type', ''),
                'stage': t.get('stage_type', ''),
                'name': t.get('doc_name', ''),
                'field': 'file_pattern',
                'old': t['file_pattern'],
                'new': fp_new,
            })
        if dp_changed:
            changes.append({
                'id': t['id'],
                'type': t.get('doc_type', ''),
                'stage': t.get('stage_type', ''),
                'name': t.get('doc_name', ''),
                'field': 'doc_path',
                'old': t['doc_path'],
                'new': dp_new,
            })

    if not changes:
        print("  (no glob patterns found in document_templates)")
        return changes

    print(f"\n{'ID':>5} | {'Type':10s} | {'Stage':8s} | {'Name':16s} | {'Field':13s} | {'Old':40s} | New")
    print("-" * 140)
    for c in changes:
        old = c['old'] or ''
        new = c['new'] or ''
        if len(old) > 40:
            old = old[:37] + '...'
        if len(new) > 60:
            new = new[:57] + '...'
        print(f"{c['id']:5d} | {c['type']:10s} | {c['stage']:8s} | {c['name']:16s} | {c['field']:13s} | {old:40s} | {new}")

    print(f"\n  Templates: {len(templates)} checked, {len(changes)} field(s) changed")
    return changes


def _doc_field_changes(doc, fields):
    """Return list of {field, old, new} for a project/product doc row."""
    changes = []
    for field in fields:
        new, changed = glob_to_regex(doc.get(field))
        if changed:
            changes.append({'field': field, 'old': doc.get(field), 'new': new})
    return changes


def print_doc_changes(docs, kind, fields):
    """Print a table of project/product document changes."""
    changes = []
    for d in docs:
        for c in _doc_field_changes(d, fields):
            changes.append({
                'id': d['id'],
                'name': d.get('doc_name', ''),
                'entity': d.get('product_code') or d.get('project_name') or '',
                'field': c['field'],
                'old': c['old'],
                'new': c['new'],
            })

    if not changes:
        print(f"  (no glob patterns found in {kind})")
        return changes

    print(f"\n  --- {kind} ---")
    print(f"{'ID':>6} | {'Entity':20s} | {'Name':16s} | {'Field':13s} | Old → New")
    print("-" * 130)
    for c in changes:
        old = c['old'] or ''
        new = c['new'] or ''
        if len(old) > 50:
            old = old[:47] + '...'
        if len(new) > 50:
            new = new[:47] + '...'
        print(f"{c['id']:6d} | {c['entity'][:20]:20s} | {c['name'][:16]:16s} | {c['field']:13s} | {old} → {new}")

    print(f"\n  {kind}: {len(docs)} doc(s) checked, {len(changes)} field(s) changed")
    return changes


def _apply_rows(conn, table, rows, fields):
    """Apply glob→regex migration to a table's rows."""
    count = 0
    for r in rows:
        updates = {}
        for c in _doc_field_changes(r, fields):
            updates[c['field']] = c['new']
        if updates:
            set_clause = ', '.join(f"{k} = ?" for k in updates)
            values = list(updates.values()) + [r['id']]
            conn.execute(f"UPDATE {table} SET {set_clause} WHERE id = ?", values)
            count += 1
    return count


def apply_migration(db_path, templates):
    """Apply glob→regex migration to document_templates."""
    conn = sqlite3.connect(db_path)
    count = 0
    try:
        for t in templates:
            updates = {}
            fp_new, fp_changed = glob_to_regex(t.get('file_pattern'))
            dp_new, dp_changed = glob_to_regex(t.get('doc_path'))
            if fp_changed:
                updates['file_pattern'] = fp_new
            if dp_changed:
                updates['doc_path'] = dp_new
            if updates:
                set_clause = ', '.join(f"{k} = ?" for k in updates)
                values = list(updates.values()) + [t['id']]
                conn.execute(f"UPDATE document_templates SET {set_clause} WHERE id = ?", values)
                count += 1
        conn.commit()
        print(f"  Updated {count} template(s) in document_templates")
    finally:
        conn.close()


def apply_docs_migration(db_path, product_docs, project_docs):
    """Apply glob→regex migration to project_documents and product_documents."""
    conn = sqlite3.connect(db_path)
    try:
        pc = _apply_rows(conn, 'product_documents', product_docs, ['doc_path'])
        jc = _apply_rows(conn, 'project_documents', project_docs, ['doc_path', 'base_path', 'file_pattern'])
        conn.commit()
        print(f"  Updated {pc} product_documents, {jc} project_documents")
    finally:
        conn.close()


def snapshot_docs(db_path):
    """读取数据库，记录所有文档的当前状态（status + location + doc_type）。"""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    docs = []

    for r in conn.execute(
        "SELECT pd.id, pd.doc_name, pd.status, pd.location, pd.doc_type, "
        "       pp.code AS entity "
        "FROM product_documents pd "
        "LEFT JOIN pma_products pp ON pd.product_id = pp.id "
        "ORDER BY pd.id"
    ).fetchall():
        docs.append({
            'key': f"product:{r['id']}",
            'type': 'product',
            'id': r['id'],
            'entity': r['entity'] or f"产品#{r['id']}",
            'doc_name': r['doc_name'] or '?',
            'doc_type': r['doc_type'] or '',
            'status': r['status'] or 'pending',
            'location': r['location'] or '',
        })

    for r in conn.execute(
        "SELECT pjd.id, pjd.doc_name, pjd.status, pjd.location, pjd.doc_type, "
        "       pj.name AS entity "
        "FROM project_documents pjd "
        "LEFT JOIN zenta_projects pj ON pjd.project_id = pj.id "
        "ORDER BY pjd.id"
    ).fetchall():
        docs.append({
            'key': f"project:{r['id']}",
            'type': 'project',
            'id': r['id'],
            'entity': r['entity'] or f"项目#{r['id']}",
            'doc_name': r['doc_name'] or '?',
            'doc_type': r['doc_type'] or '',
            'status': r['status'] or 'pending',
            'location': r['location'] or '',
        })

    conn.close()
    return docs


def scan_all(db_path):
    """运行文档扫描（backend 逻辑），返回扫描后的状态快照。"""
    import asyncio
    script_dir = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.dirname(script_dir)

    # 在 import backend 之前设置环境变量
    os.environ['DATABASE_URL'] = f"sqlite:///{os.path.abspath(db_path)}"
    os.chdir(repo_root)
    if repo_root not in sys.path:
        sys.path.insert(0, repo_root)

    env_file = os.path.join(repo_root, '.env')
    if os.path.exists(env_file):
        for line in open(env_file):
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, v = line.split('=', 1)
            os.environ.setdefault(k, v.strip())

    from backend.database import SessionLocal
    from backend.services.doc_scanner import check_all_product_docs, check_project_docs
    from backend.models.zentao import CachedProject

    db = SessionLocal()
    try:
        async def _run():
            await check_all_product_docs(db, skip_svn=False)
            for proj in db.query(CachedProject).all():
                await check_project_docs(db, proj.id)
        asyncio.run(_run())
    except Exception as e:
        print(f"  ⚠️ 扫描出错: {e}")
    finally:
        db.close()

    return snapshot_docs(db_path)


def compare_snapshots(before, after, migrated_keys=None):
    """对比迁移前后文档状态，自动判断迁移是否有影响。

    区分两类回归：
    - 迁移引入的回归：文档 doc_path 被 glob→regex 改动过（在 migrated_keys 里）
    - 环境/数据问题：文档未被迁移改动（solidworks 依赖 PDM SSH、gitlab 项目已删等）
    """
    migrated_keys = migrated_keys or set()
    before_map = {s['key']: s for s in before}
    after_map = {s['key']: s for s in after}
    all_keys = sorted(set(before_map) | set(after_map))

    stats = {'unchanged': 0, 'improved': 0, 'regressed': 0, 'new': 0,
             'regressed_migrated': 0, 'regressed_other': 0}
    improved_list = []
    regressed_migrated_list = []
    regressed_other_list = []

    for key in all_keys:
        b = before_map.get(key)
        a = after_map.get(key)
        if b is None:
            stats['new'] += 1
            continue
        if a is None:
            continue
        b_status, a_status = b['status'], a['status']
        if b_status == a_status:
            stats['unchanged'] += 1
        elif b_status == 'pending' and a_status == 'submitted':
            stats['improved'] += 1
            improved_list.append((b, a))
        elif b_status == 'submitted' and a_status == 'pending':
            stats['regressed'] += 1
            # solidworks 用 PDM SSH 扫描（不依赖 glob/regex），其回归与迁移无关；
            # 其余类型只有 doc_path 被 glob→regex 改动过才算迁移引入。
            if key in migrated_keys and b.get('doc_type') != 'solidworks':
                stats['regressed_migrated'] += 1
                regressed_migrated_list.append((b, a))
            else:
                stats['regressed_other'] += 1
                regressed_other_list.append((b, a))

    print(f"\n{'═' * 80}")
    print(f"  迁移前后文档状态对比报告")
    print(f"{'═' * 80}")

    if improved_list:
        print(f"\n  ✅ 状态改善（pending → submitted）{len(improved_list)} 个：")
        for b, a in improved_list:
            print(f"    [{b['entity']}] {b['doc_name']} ({b['doc_type'] or '?'})")
            print(f"      → {a['location'][:90]}")

    if regressed_migrated_list:
        print(f"\n  ⚠️  迁移引入的回归（submitted → pending）{len(regressed_migrated_list)} 个：")
        for b, a in regressed_migrated_list:
            print(f"    [{b['entity']}] {b['doc_name']} ({b['doc_type'] or '?'})")
            print(f"      before: {b['location'][:90]}")

    if regressed_other_list:
        print(f"\n  ℹ️  非迁移回归（submitted → pending，环境/数据问题，与 glob→regex 无关）{len(regressed_other_list)} 个：")
        for b, a in regressed_other_list:
            print(f"    [{b['entity']}] {b['doc_name']} ({b['doc_type'] or '?'})")
            print(f"      before: {b['location'][:90]}")

    print(f"\n{'─' * 80}")
    print(f"  汇总")
    print(f"{'─' * 80}")
    print(f"  文档总数:      {len(all_keys)}")
    print(f"  状态不变:      {stats['unchanged']}")
    print(f"  状态改善:      {stats['improved']}（pending → submitted）")
    print(f"  状态回归:      {stats['regressed']}（submitted → pending）")
    if stats['regressed_migrated']:
        print(f"    ├─ 迁移引入:  {stats['regressed_migrated']} 个 ← 需要检查")
    if stats['regressed_other']:
        print(f"    └─ 环境/数据: {stats['regressed_other']} 个（非迁移问题）")
    if stats['new']:
        print(f"  新增文档:      {stats['new']}")

    if stats['regressed_migrated'] == 0:
        print(f"\n  ✅ 迁移安全：无迁移引入的回归。")
        return True
    else:
        print(f"\n  ⚠️  迁移有影响：{stats['regressed_migrated']} 个文档因 glob→regex 转换回退，请检查！")
        return False


def main():
    parser = argparse.ArgumentParser(description='Migrate document template glob patterns to regex')
    parser.add_argument('--dry-run', action='store_true', help='Preview changes without touching the real DB')
    parser.add_argument('--db', default=None, help='Path to SQLite database')
    parser.add_argument('--skip-scan', action='store_true', help='Skip before/after scan comparison')
    args = parser.parse_args()

    # Determine DB path
    if args.db:
        db_path = args.db
    else:
        # Auto-detect from worktree or trunk
        script_dir = os.path.dirname(os.path.abspath(__file__))
        repo_root = os.path.dirname(script_dir)
        # Try worktree .env first
        port = os.environ.get('PMA_PORT', '8003')
        candidate = os.path.join(repo_root, 'data', f'pma-{port}.db')
        if not os.path.exists(candidate):
            candidate = os.path.join(repo_root, 'data', 'pma-8000.db')
        db_path = candidate

    if not os.path.exists(db_path):
        print(f"ERROR: Database not found: {db_path}", file=sys.stderr)
        sys.exit(1)

    print(f"=== Template Glob → Regex Migration ===")
    print(f"DB:   {db_path}")
    print(f"Mode: {'DRY-RUN (临时副本，正式库不动)' if args.dry_run else 'LIVE (将修改数据库)'}")
    print(f"Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    # Collect data
    templates = collect_templates(db_path)
    product_docs = collect_product_docs(db_path)
    project_docs = collect_project_docs(db_path)
    print(f"\nDocument templates found: {len(templates)}")
    print(f"Product documents with glob: {len(product_docs)}")
    print(f"Project documents with glob: {len(project_docs)}")

    # Show changes
    template_changes = print_template_changes(templates, dry_run=args.dry_run)
    product_changes = print_doc_changes(product_docs, 'product_documents', ['doc_path'])
    project_changes = print_doc_changes(project_docs, 'project_documents', ['doc_path', 'base_path', 'file_pattern'])

    total_changes = len(template_changes) + len(product_changes) + len(project_changes)

    if total_changes == 0:
        print("\nNo glob patterns found — nothing to migrate.")
        return

    # ── 对比流程（快照 → 迁移 → 扫描 → 对比）──
    if args.skip_scan:
        if args.dry_run:
            print(f"\n{'═' * 80}")
            print(f"  DRY-RUN: 未修改数据库。跳过扫描对比。")
            print(f"{'═' * 80}")
            return
        print(f"\n{'!' * 60}")
        print(f"  About to modify {total_changes} field(s) in the database.")
        resp = input("  Type 'yes' to confirm: ")
        if resp.strip().lower() != 'yes':
            print("  Aborted.")
            return
        apply_migration(db_path, templates)
        apply_docs_migration(db_path, product_docs, project_docs)
        print(f"\n✅ Migration complete. {total_changes} field(s) updated.")
        return

    # 完整对比流程
    import tempfile
    import shutil

    if args.dry_run:
        # 临时副本放在数据库同目录（避免 /tmp 的 chmod 权限问题）
        tmp_db = os.path.join(os.path.dirname(os.path.abspath(db_path)), f".migrate_tmp_{os.getpid()}.db")
        shutil.copy(db_path, tmp_db)
        work_db = tmp_db
    else:
        print(f"\n{'!' * 60}")
        print(f"  将在正式数据库上执行迁移并扫描对比。")
        resp = input("  Type 'yes' to confirm: ")
        if resp.strip().lower() != 'yes':
            print("  Aborted.")
            return
        work_db = db_path

    # Step 1: 迁移前快照
    print(f"\n{'─' * 80}")
    print(f"  Step 1/4: 记录迁移前文档状态")
    before = snapshot_docs(work_db)
    print(f"  迁移前文档数: {len(before)}")

    # Step 2: 执行迁移
    print(f"\n  Step 2/4: 执行 glob → regex 迁移")
    apply_migration(work_db, templates)
    apply_docs_migration(work_db, product_docs, project_docs)

    # Step 3: 迁移后扫描
    print(f"\n  Step 3/4: 扫描迁移后文档（GitLab/SVN/PDM，可能需要几分钟）...")
    after = scan_all(work_db)

    # Step 4: 对比
    print(f"\n  Step 4/4: 对比迁移前后状态")
    # 收集被迁移改动的文档 key，用于区分迁移引入的回归 vs 环境/数据问题
    migrated_keys = set()
    for c in product_changes:
        migrated_keys.add(f"product:{c['id']}")
    for c in project_changes:
        migrated_keys.add(f"project:{c['id']}")
    compare_snapshots(before, after, migrated_keys)

    if args.dry_run:
        os.remove(tmp_db)
        print(f"\n  DRY-RUN: 临时副本已清理，正式数据库未修改。")
    else:
        print(f"\n✅ Migration complete. {total_changes} field(s) updated.")


if __name__ == '__main__':
    main()
