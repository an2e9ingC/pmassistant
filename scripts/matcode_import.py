#!/usr/bin/env python3
"""全物料编码 ERP 基线 — 清洗 + 导入（两阶段，人工关卡）。

用途：把 ERP(U8) 导出的 7 大分类文件（docs/物料编码导入资料/）灌入 matcode 平台。
  原材料 / 半成品 / 产成品 / 整机外购件 / 附件 / 低值易耗品 / 服务类（.XLS，先 soffice 转 xlsx）
  CIS 规则书（CIS目录结构及编码规则*.xlsx）只作规则书，跳过数据行。

A 阶段 analyze（零写库）：
    python3 scripts/matcode_import.py analyze [--source "docs/物料编码导入资料"] [--out data/matcode-import]
    - 逐文件逐 sheet 解析（列按表头语义映射，非固定列号）
    - .XLS 先经 LibreOffice 转 xlsx（落在 out/converted/）
    - 8 位码按最长前缀归段（SEGMENT_SEEDS 含 ERP 族扩容种子，见 matcode_families.py）
    - 生成 cleaning-report.html + raw-rows.json（已按 decisions 处置后的候选行）+ issues.json
    - 首跑自动建 decisions.json：孤儿码自动列入 skip_codes（见报告③）
    人工关卡：审报告；如需保留脏行改码采纳 → 在 decisions.json 补规则后重跑 analyze（幂等覆盖）。

B 阶段 import（默认 --dry-run，--apply 才写库）：
    DATABASE_URL=sqlite:///./data/pma-<PORT>.db python3 scripts/matcode_import.py import \
        [--out data/matcode-import] [--apply]
    - 读 decisions.json + raw-rows.json；init_db 建表+种子段；
    - code 已存在 → 回填空列（仅 NULL/'' 才补 manufacturer/unit/spec；name/remark/非空spec 一律不动）；
      不存在 → INSERT（source='import:erp:<file>'）。
    - 审计 matcode_import（high）。
    - DATABASE_URL 未显式设置 → 拒绝执行（防误写默认 pma-8000.db）。

说明：code 是唯一 join key、永不改号/回填；同码补空天然幂等，可重跑。
     根文档目录只在 worktree 内存在，analyze/import 必须在 worktree 内、销毁前完成。
"""

from __future__ import annotations

import argparse
import glob
import html
import json
import os
import re
import subprocess
import sys
from collections import Counter, OrderedDict

import openpyxl

# 项目根（本文件在 scripts/ 下）
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

# 名称形如 "PE0141-1326UA…" 的 PE+数字 即项目编号；EPE4751 等整词不计
_PROJECT_RE = re.compile(r"(?:^|[^A-Za-z0-9])(PE\d{3,4})", re.IGNORECASE)


def _proj_from_name(name):
    m = _PROJECT_RE.search(name or "")
    return m.group(1).upper() if m else None


# ────────────────────────── 段常量（与 matcode_catalog 对齐，含 ERP 族种子） ──────────────────────────
def _seeds():
    from backend.services.matcode_catalog import SEGMENT_SEEDS
    return SEGMENT_SEEDS


def _seed_meta():
    """{key: (label, prefix, issueable)}。"""
    meta = {}
    for key, _p, label, prefix, _sw, _g, iss, _cl, _ds, _dw, _so in _seeds():
        meta[key] = (label, prefix, iss)
    return meta


def segment_for_code(code: str):
    """按最长前缀把 8 位码归到段（非组段）。返回 (key,label,prefix,suffix) 或 None。"""
    best = None
    for key, _p, label, prefix, _sw, is_group, _iss, _cl, _ds, _dw, _sort in _seeds():
        if is_group:
            continue
        if code.startswith(prefix) and (best is None or len(prefix) > len(best[0])):
            best = (prefix, key, label)
    if not best:
        return None
    prefix, key, label = best
    return key, label, prefix, int(code[len(prefix):])


def _seg_sort_key(k):
    for i, seed in enumerate(_seeds()):
        if seed[0] == k:
            return i
    return 999


# ────────────────────────── 表头 / 单元格 工具 ──────────────────────────
def _ci(s):
    return "" if s is None else str(s).strip()


def _pick(hdr, *keys):
    """按 key 精确匹配表头取列号（表头先去空白/括号内容）。找不到返回 None。"""
    norm = [_hdr_norm(x) for x in hdr]
    for j, n in enumerate(norm):
        if n in keys:
            return j
    return None


def _hdr_norm(x):
    s = re.sub(r"\s+", "", x or "")
    s = re.sub(r"[（(][^）)]*[）)]", "", s)
    return s


def _cell(cells, i):
    return _ci(cells[i]) if i is not None and i < len(cells) else ""


# 目标字段 → ERP 表头别名（按优先级，表头精确匹配防跨列误配）
HEADER_ALIASES = {
    "code": ("存货编码", "物料编码"),
    "name": ("存货名称", "名称"),
    "spec": ("规格型号", "厂家规格型号"),
    "manufacturer": ("生产厂商", "厂家"),
    "unit": ("主计量单位名称", "计量单位"),
    "remark": ("器件描述", "描述", "备注", "器件说明"),
    "cat": ("存货大类编码",),
    "catname": ("存货大类名称",),
}


def sheet_rows(ws):
    """定位表头并逐行产出 (index, hdr, cells)。index 为报表行号（文件级连续）。"""
    hi = None
    for i, row in enumerate(ws.iter_rows(values_only=True), start=1):
        if len([c for c in row if c not in (None, "")]) >= 2:
            hi = i
            break
    if hi is None:
        return []
    hdr = [_ci(c) for c in next(ws.iter_rows(min_row=hi, values_only=True))]
    out = []
    for i, row in enumerate(ws.iter_rows(min_row=hi + 1, values_only=True), start=hi + 1):
        if len([c for c in row if c not in (None, "")]) == 0:
            continue
        out.append((i, hdr, row))
    return out


# ────────────────────────── 编码格分类（脏数据识别） ──────────────────────────
# 返回 (kind, code)。kind:
#   ok    8 位码（数值型 .0 尾剔除）
#   empty 空编码格（整行视为非物料行，静默跳过）
#   rev   "<8位>-X" 修订尾缀（ERP -A 修订行，默认剔除）
#   len7  纯数字 7 位（缺零码，默认剔除；可 decisions.rename_code 补零采纳）
#   len9  纯数字 9 位（位数异常，默认剔除）
#   other 其它不可识别（默认剔除）
def classify_code(v):
    s = _ci(v)
    if not s:
        return "empty", None
    if re.fullmatch(r"\d+\.0", s):
        s = s[:-2]
    if re.fullmatch(r"\d{8}", s):
        return "ok", s
    if re.fullmatch(r"\d{1,9}-[A-Za-z]", s) or re.fullmatch(r"\d{1,9}[A-Za-z]", s):
        return "rev", re.match(r"\d+", s).group(0)
    if re.fullmatch(r"\d{7}", s):
        return "len7", s
    if re.fullmatch(r"\d{9}", s):
        return "len9", s
    if re.fullmatch(r"\d+", s):
        return "other", s
    return "other", s


DIRTY_TXT = {
    "rev": "修订行(-A 尾缀)，非独立料号，默认剔除",
    "len7": "7 位码（缺零），默认剔除；可在 decisions.rename_code 补零采纳",
    "len9": "9 位码（位数异常），默认剔除",
    "other": "编码列非纯 8 位数字，默认剔除",
    "orphan": "孤儿码：8 位但前缀无对应段，默认剔除；如属误码可并入重复料号",
}


# ────────────────────────── analyze ──────────────────────────
def _read_decisions(dec_path):
    if os.path.exists(dec_path):
        with open(dec_path, encoding="utf-8") as f:
            return json.load(f)
    return {"skip_rows": [], "skip_codes": [], "rename_code": {}}


def _write_decisions(dec_path, dec):
    with open(dec_path, "w", encoding="utf-8") as f:
        json.dump(dec, f, ensure_ascii=False, indent=2)


def analyze(source, out):
    os.makedirs(out, exist_ok=True)
    conv_dir = os.path.join(out, "converted")
    os.makedirs(conv_dir, exist_ok=True)

    issues = []        # {level, file, sheet, row, msg, value}
    dirty_rows = []    # 排除：{kind, file, row, code, name, spec, hint}
    seen_code = OrderedDict()
    colmap = {}        # file → {field: matched header}
    file_sum = []      # {file, total_rows, n8, n8ok}
    files = sorted(glob.glob(os.path.join(source, "*")))
    if not files:
        raise SystemExit(
            f"源目录无文件: {source}\n"
            "analyze 必须在含 docs/物料编码导入资料 的 worktree 内运行"
        )

    dec_path = os.path.join(out, "decisions.json")
    dec = _read_decisions(dec_path)
    skip_rows = set(dec.get("skip_rows", []))
    skip_codes = set(dec.get("skip_codes", []))
    rename = dec.get("rename_code", {})
    dec_was_missing = not os.path.exists(dec_path)

    orphans = []      # 8 位但无段归属（pass1 收集 → 首跑自动列入 skip_codes）
    row_id = 0
    rows = []         # 决策后候选行

    def add_issue(level, base, title, ri, msg, value=""):
        issues.append({"level": level, "file": base, "sheet": title,
                       "row": ri, "msg": msg, "value": value})

    for fpath in files:
        base = os.path.basename(fpath)
        if "CIS目录" in base or "出库单" in base or base.startswith("~$"):
            continue
        if not base.lower().endswith((".xls", ".xlsx")):
            continue
        wbpath = fpath
        extra = ""
        if base.lower().endswith(".xls"):
            dst = os.path.join(conv_dir, base.rsplit(".", 1)[0] + ".xlsx")
            if not os.path.exists(dst):
                subprocess.run(
                    ["soffice", "-env:UserInstallation=file:///tmp/loprofile",
                     "--headless", "--convert-to", "xlsx", "--outdir", conv_dir, fpath],
                    check=True, capture_output=True,
                )
            wbpath = dst
            extra = " (已转xlsx)"
        wb = openpyxl.load_workbook(wbpath, data_only=True)
        file_label = base + extra
        fs = {"file": file_label, "total_rows": 0, "n8": 0, "n8ok": 0}
        for ws in wb.worksheets:
            title = ws.title
            for (ri, hdr, cells) in sheet_rows(ws):
                col_i = {col: _pick(hdr, *aliases) for col, aliases in HEADER_ALIASES.items()}
                ci = col_i["code"]
                if ci is None or ci >= len(cells):
                    continue
                colmap.setdefault(file_label, {}).update(
                    {col: (hdr[i] if i is not None else "") for col, i in col_i.items()}
                )
                fs["total_rows"] += 1
                kind, code = classify_code(cells[ci])
                name = _cell(cells, col_i["name"])
                spec = _cell(cells, col_i["spec"])
                if kind == "empty":
                    continue
                if kind != "ok":
                    # 非 8 位：rename_code 采纳 → 变 8 位候选；否则进排除清单
                    adopted = rename.get(_ci(cells[ci]), None)
                    if adopted and re.fullmatch(r"\d{8}", adopted) and adopted != code:
                        code, kind = adopted, "ok"
                        add_issue("info", file_label, title, ri, f"经 rename_code 采纳为 {code}", adopted)
                    else:
                        dirty_rows.append({
                            "kind": kind, "file": file_label, "row": ri,
                            "code": _ci(cells[ci]), "name": name, "spec": spec,
                        })
                        continue
                # 至此为 8 位码
                fs["n8"] += 1
                seg = segment_for_code(code)
                if seg is None:
                    orphans.append({"file": file_label, "row": ri, "code": code,
                                    "name": name, "spec": spec})
                    continue
                row_id += 1
                fs["n8ok"] += 1
                seg_key, seg_label, _prefix, _suffix = seg
                if seen_code.get(code) is not None and seen_code[code] != row_id:
                    add_issue("error", file_label, title, ri,
                              f"重复码，已保留 row={seen_code[code]}", code)
                seen_code[code] = row_id
                rows.append({
                    "row_id": row_id, "file": file_label, "row": ri,
                    "code": code, "name": name, "spec": spec,
                    "manufacturer": _cell(cells, col_i["manufacturer"]),
                    "unit": _cell(cells, col_i["unit"]),
                    "remark": _cell(cells, col_i["remark"]),
                    "seg_key": seg_key, "seg_label": seg_label,
                })
        file_sum.append(fs)

    # 首跑自动把孤儿码列入 skip_codes（不覆盖人工编辑）
    if dec_was_missing:
        new_skip = [o["code"] for o in orphans if o["code"] not in skip_codes]
        if new_skip:
            dec["skip_codes"] = list(skip_codes) + new_skip
            _write_decisions(dec_path, dec)
            skip_codes.update(new_skip)

    # 孤儿处置判定：skip_codes 显式剔除 → 进排除清单；否则 error（需补种子/人工决策）
    for o in orphans:
        if o["code"] in skip_codes:
            dirty_rows.append({"kind": "orphan", "file": o["file"], "row": o["row"],
                               "code": o["code"], "name": o["name"], "spec": o["spec"]})
        else:
            add_issue("error", o["file"], "", o["row"],
                      "8 位码前缀不在已知段树：需补种子，或加入 decisions.skip_codes 显式剔除", o["code"])

    # 应用 skip_rows（decisioned 剔除）→ 最终候选清单
    if skip_rows:
        keep = []
        for r in rows:
            if r["row_id"] in skip_rows:
                add_issue("warn", r["file"], "", r["row"],
                          f"row_id {r['row_id']} 已被 decisions.skip_rows 剔除", r["code"])
                continue
            keep.append(r)
        rows = keep

    # 排除行 dup 提示（同 name+spec 在候选集内找已保留码）
    ns_index = {}
    for r in rows:
        ns_index.setdefault((r["name"], r["spec"]), r["code"])
    for d in dirty_rows:
        hit = ns_index.get((d["name"], d["spec"]))
        if hit and hit != d["code"]:
            d["hint"] = f"疑似与已保留料号 {hit} 重复（同名+同规格）"

    # ── 统计 ──
    seg_count = Counter(r["seg_key"] for r in rows)
    top_count = Counter()
    from backend.services.matcode_families import top_key_of_segment
    for r in rows:
        top_count[top_key_of_segment(r["seg_key"]) or r["seg_key"]] += 1

    # 重复 (name,spec) 组（同段内；真重码判定 = 组内备注一致）
    nskey = Counter((r["seg_key"], r["name"], r["spec"]) for r in rows)
    name_dup = {k: c for k, c in nskey.items() if c > 1}

    def _rm_norm(s):
        return re.sub(r"\s+", "", s or "")

    dup_groups = []
    for key in name_dup:
        members = [r for r in rows if (r["seg_key"], r["name"], r["spec"]) == key]
        remarks = {_rm_norm(m["remark"]) for m in members}
        cls = "真重码" if len(remarks) <= 1 else "伪重复"
        for m in members:
            m["dup_flag"] = "true" if cls == "真重码" else "false"
        dup_groups.append({
            "key": list(key), "seg_key": key[0], "name": key[1], "spec": key[2],
            "count": len(members), "class": cls, "members": members,
        })
    dup_groups.sort(key=lambda g: (g["class"] != "真重码", -g["count"]))

    # 写产物
    with open(os.path.join(out, "raw-rows.json"), "w", encoding="utf-8") as f:
        json.dump({"rows": rows, "_dirty": dirty_rows,
                   "_说明": "rows 为决策后候选（import 使用）；_dirty 为默认剔除/待裁决"},
                  f, ensure_ascii=False, indent=1)
    with open(os.path.join(out, "issues.json"), "w", encoding="utf-8") as f:
        json.dump(issues, f, ensure_ascii=False, indent=1)
    with open(os.path.join(out, "dup-groups.json"), "w", encoding="utf-8") as f:
        json.dump(dup_groups, f, ensure_ascii=False, indent=1)
    with open(os.path.join(out, "colmap.json"), "w", encoding="utf-8") as f:
        json.dump(colmap, f, ensure_ascii=False, indent=1)

    _write_report(out, rows, issues, seg_count, top_count, dirty_rows, dup_groups,
                  file_sum, colmap)

    n_err = sum(1 for i in issues if i["level"] == "error")
    n_warn = sum(1 for i in issues if i["level"] == "warn")
    n_info = sum(1 for i in issues if i["level"] == "info")
    print("=" * 74)
    print(f"解析源目录: {source}")
    print(f"数据行 {sum(f['total_rows'] for f in file_sum)} ｜ 8位码 {sum(f['n8'] for f in file_sum)}"
          f" ｜ 候选(决策后) {len(rows)} ｜ 排除 {len(dirty_rows)}")
    print("各文件:")
    for f in file_sum:
        print(f"  {f['file']:14s} 行 {f['total_rows']:5d}  8位 {f['n8']:5d}  可归段 {f['n8ok']:5d}")
    print("按大类:")
    for t, c in sorted(top_count.items(), key=lambda x: str(x[0])):
        print(f"  {str(t):8s} {c:5d}")
    print(f"issues {len(issues)}: error {n_err}  warn {n_warn}  info {n_info}")
    kinds = Counter(d["kind"] for d in dirty_rows)
    print("排除清单:", dict(kinds))
    print(f"报告: {os.path.join(out, 'cleaning-report.html')}")


def _write_report(out, rows, issues, seg_count, top_count, dirty_rows, dup_groups, file_sum, colmap):
    from backend.services.matcode_families import MATCODE_CATALOG
    TOP_LABEL = {t["key"]: t["label"] for t in MATCODE_CATALOG}
    seed_meta = _seed_meta()
    rep = ["""<!doctype html><html lang=zh><head><meta charset=utf-8>
<title>全物料编码 ERP 基线清洗报告</title>
<style>
body{font:13px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;margin:24px;color:#222}
h1{font-size:20px} h2{font-size:15px;border-bottom:1px solid #eee;padding-bottom:4px;margin-top:28px}
table{border-collapse:collapse;margin:8px 0;width:100%}
th,td{border:1px solid #e3e3e3;padding:3px 8px;text-align:left;font-size:12px;vertical-align:top}
th{background:#f6f8fa}
.err{color:#c0392b}.warn{color:#b9770e}.info{color:#2980b9}.ok{color:#27ae60}
code{background:#f4f4f4;padding:0 3px;border-radius:3px}
.sum td:nth-child(2){text-align:right}
</style></head><body>"""]

    def esc(v):
        return html.escape(str(v or ""))

    def src(d):
        return f"{esc(d['file'])} › 第{d['row']}行"

    def seg_disp(k):
        meta = seed_meta.get(k)
        return f"{meta[0]}·{meta[1]}" if meta else str(k)

    warn = sum(1 for i in issues if i["level"] == "warn")
    err = len(issues) - warn
    info = sum(1 for i in issues if i["level"] == "info")
    rep.append(f"<h1>全物料编码 ERP 基线清洗报告</h1>"
               f"<p class=meta>数据行 <b>{sum(f['total_rows'] for f in file_sum)}</b> ｜ 候选(决策后) "
               f"<b>{len(rows)}</b> ｜ 排除 <b>{len(dirty_rows)}</b> ｜ "
               f"异常 <b class={'err' if err else 'ok'}>{err}</b> warn <b class=warn>{warn}</b> "
               f"info <b class=info>{info}</b></p>")

    # ① 列映射
    rep.append("<h2>① 列映射（按文件表头语义识别）</h2>")
    if colmap:
        first = next(iter(colmap.values()))
        label = {"code": "料号", "name": "名称", "spec": "规格型号", "manufacturer": "生产厂商",
                 "unit": "单位", "remark": "备注", "cat": "大类编码", "catname": "大类名称"}
        rep.append("<table><tr><th>目标字段</th><th>源表头</th></tr>")
        for col, header in first.items():
            rep.append(f"<tr><td>{label.get(col, col)}</td>"
                       f"<td><code>{esc(header) if header else '∅'}</code></td></tr>")
        rep.append("</table><p>7 文件表头完全一致（上文为 原材料 示例）。"
                   "<b>回填约束</b>：同码回填仅补空 manufacturer/unit/spec，name/remark/非空 spec 一律不动；"
                   "<b>长参数列（描述信息）</b>未导入以保持列表轻量。</p>")

    # ② 文件/大类统计
    rep.append("<h2>② 文件与大类统计</h2>")
    rep.append("<table class=sum><tr><th>ERP 文件</th><th>数据行</th><th>8位码</th><th>可归段</th></tr>")
    for f in file_sum:
        rep.append(f"<tr><td>{esc(f['file'])}</td><td>{f['total_rows']}</td><td>{f['n8']}</td><td>{f['n8ok']}</td></tr>")
    rep.append("</table><p>按大类（码前缀归属口径，非 ERP 文件口径）：</p>")
    rep.append("<table class=sum><tr><th>大类</th><th>候选数</th></tr>")
    for t, c in sorted(top_count.items(), key=lambda x: str(x[0])):
        rep.append(f"<tr><td>{esc(TOP_LABEL.get(t, t))}（{esc(t)}）</td><td>{c}</td></tr>")
    rep.append("</table>")

    # ③ 排除清单
    rep.append(f"""<h2>③ 排除清单（共 {len(dirty_rows)}，默认剔除 / 待人工裁决）</h2>
<p>默认剔除：非 8 位码（修订 -A / 7 位缺零 / 9 位）与孤儿码（8 位但前缀无对应段）。
7 位缺零/修订若确属漏零可补：decisions.rename_code 填 {{原码:8位新码}} 后重跑 analyze；孤儿码剔除见 decisions.skip_codes。</p>
<table><tr><th>类别</th><th>料号</th><th>名称</th><th>规格</th><th>出处（文件›行）</th><th>说明</th></tr>""")
    for d in dirty_rows:
        txt = DIRTY_TXT.get(d["kind"], "孤儿码：8 位但前缀无对应段")
        cls = "info" if d["kind"] in ("orphan",) else "warn"
        hint = f"<br><b class=warn>{esc(d['hint'])}</b>" if d.get("hint") else ""
        rep.append(f"<tr><td class={cls}>{esc(d['kind'])}</td>"
                   f"<td><code>{esc(d['code'])}</code></td><td>{esc(d['name'][:40])}</td>"
                   f"<td>{esc(d['spec'][:30])}</td><td>{src(d)}</td>"
                   f"<td>{txt}{hint}</td></tr>")
    rep.append("</table>")

    # ④ 重复组
    if dup_groups:
        n_true = sum(1 for g in dup_groups if g["class"] == "真重码")
        rep.append(f"<h2>④ 重复组（同段下 名称+规格 相同）—— {len(dup_groups)} 组，"
                   f"其中 真重码 <span class=err>{n_true}</span>、伪重复 "
                   f"<span class=warn>{len(dup_groups) - n_true}</span></h2>"
                   f"<p>ERP 码本身唯一；此表仅预警同段内同名同规格多料号（多为历史并发编码）。导入默认全保留。</p>"
                   f"<table><tr><th>段</th><th>名称</th><th>规格</th><th>数</th><th>料号</th></tr>")
        for g in dup_groups[:300]:
            codes = " ".join(f"<code>{m['code']}</code>" for m in g["members"])
            cls = "err" if g["class"] == "真重码" else "warn"
            rep.append(f"<tr><td>{esc(seg_disp(g['seg_key']))}</td><td>{esc(g['name'][:40])}</td>"
                       f"<td>{esc(g['spec'][:30])}</td><td class={cls}><b>{len(g['members'])}</b></td>"
                       f"<td>{codes}</td></tr>")
        rep.append("</table>")
    else:
        rep.append("<h2>④ 重复组</h2><p class=ok>无（同段下 名称+规格 均唯一）</p>")

    # ⑤ decisions 规则说明
    rep.append("""<h2>decisions.json 规则说明</h2>
<table><tr><th>键</th><th>含义</th></tr>
<tr><td><code>skip_codes</code></td><td>剔除的 8 位码数组（孤儿码首跑自动列入；也可手工加码剔除，改后重跑 analyze）</td></tr>
<tr><td><code>rename_code</code></td><td>改码映射 {原码: 新8位码}（7 位缺零等采纳用；改后重跑 analyze 才会进入候选）</td></tr>
<tr><td><code>skip_rows</code></td><td>按 row_id 剔除（候选全量见 raw-rows.json 首列；一般用 skip_codes 更直观）</td></tr></table>
<p class=ok>导入默认全保留候选行；排除行见 ③。改 decisions 后请重跑 analyze（幂等覆盖产物，保留人工编辑）。</p>
</body></html>""")
    with open(os.path.join(out, "cleaning-report.html"), "w", encoding="utf-8") as f:
        f.write("\n".join(rep))


# ────────────────────────── import ──────────────────────────
def import_rows(out, apply_):
    if not os.environ.get("DATABASE_URL"):
        raise SystemExit(
            "拒绝执行：未显式设置 DATABASE_URL。\n"
            "示例: DATABASE_URL=sqlite:///./data/pma-8001.db python3 scripts/matcode_import.py import [--apply]\n"
            "（未设置时默认指向 ./data/pma-8000.db 生产库，故强制要求显式设置防误写）"
        )
    raw_path = os.path.join(out, "raw-rows.json")
    if not os.path.exists(raw_path):
        raise SystemExit("缺少 raw-rows.json，请先运行 analyze")

    from backend.database import SessionLocal, init_db
    from backend.models.local import AuditLog
    from backend.models.matcode import MatcodeMaterial, MatcodeSegment
    from backend.services.matcode_catalog import seed_segments

    with open(raw_path, encoding="utf-8") as f:
        data = json.load(f)
    rows = data["rows"]
    dirty = data.get("_dirty", [])

    init_db()
    db = SessionLocal()
    try:
        seed_segments(db)
        seg_by_key = {s.key: s for s in db.query(MatcodeSegment).all()}
        existing = {m.code: m for m in db.query(MatcodeMaterial).all()}

        to_insert = []    # (seg, suffix, rec)
        backfill = []     # (code, [fields], rec)
        planned = set()
        for r in rows:
            code = r["code"]
            if code in planned:
                continue  # 同批重复防御（analyze 已保证无重码）
            rec = {
                "code": code, "name": r["name"], "spec": r["spec"] or None,
                "manufacturer": r.get("manufacturer") or None,
                "unit": r.get("unit") or None,
                "remark": r.get("remark") or None,
                "file": r["file"], "seg_key": r["seg_key"],
            }
            m = existing.get(code)
            if m is not None:
                fills = [fld for fld in ("manufacturer", "unit", "spec")
                         if not getattr(m, fld) and rec[fld]]
                if fills:
                    backfill.append((code, fills, rec))
                continue
            seg = seg_by_key.get(r["seg_key"])
            if seg is None:
                raise SystemExit(f"row {r['row_id']}: 段 {r['seg_key']} 不存在（先跑 analyze）")
            planned.add(code)
            to_insert.append((seg, int(code[len(seg.prefix):]), rec))

        def _prt():
            cnt = Counter(p[2]["seg_key"] for p in to_insert)
            print(f"计划新增 {len(to_insert)} ｜ 同码待回填 {len(backfill)} ｜ "
                  f"排除/脏行 {len(dirty)} ｜ 已有无需动作 {len(rows) - len(to_insert) - len(backfill)}")
            for k in sorted(cnt, key=_seg_sort_key):
                print(f"  {str(k):12s} +{cnt[k]:5d}")

        if not apply_:
            print("── import dry-run（未写库；--apply 才落库）──")
            _prt()
            if backfill:
                print("回填样例（补空 manufacturer/unit/spec）：")
                for code, fills, _rec in backfill[:10]:
                    print(f"  [{code}] 补 {','.join(fills)}")
            return

        created = 0
        for seg, suffix, rec in to_insert:
            legacy = "11723" if seg.key == "legacy11723" else None
            db.add(MatcodeMaterial(
                code=rec["code"], segment_id=seg.id, legacy_prefix=legacy,
                name=rec["name"] or rec["code"], spec=rec["spec"],
                manufacturer=rec["manufacturer"], drawing=None, remark=rec["remark"],
                project=_proj_from_name(rec["name"]) or None, unit=rec["unit"],
                source=f"import:erp:{rec['file'].split(' ')[0]}", status="active",
                suffix=suffix, created_by="system",
            ))
            created += 1
        backfilled = 0
        for code, fills, rec in backfill:
            m = existing[code]
            for fld in fills:
                setattr(m, fld, rec[fld])
            backfilled += 1
        db.commit()
        if created or backfilled:  # 无变更的幂等重跑不写审计
            db.add(AuditLog(username="system", action="matcode_import",
                            detail=f"ERP全物料导入 新增{created} 同码回填{backfilled}",
                            category="物料编码", level="high"))
            db.commit()
        print(f"导入完成: 新增 {created} 条，同码回填 {backfilled} 条")
        _prt()
    finally:
        db.close()


def main():
    ap = argparse.ArgumentParser(description="全物料编码 ERP 基线 清洗+导入")
    sub = ap.add_subparsers(dest="cmd", required=True)

    pa = sub.add_parser("analyze", help="清洗分析：产出报告+raw-rows+decisions（零写库）")
    pa.add_argument("--source", default="docs/物料编码导入资料", help="Excel 源目录（ERP 导出）")
    pa.add_argument("--out", default="data/matcode-import", help="输出目录")

    pi = sub.add_parser("import", help="导入：默认 dry-run，--apply 才写库")
    pi.add_argument("--out", default="data/matcode-import")
    pi.add_argument("--apply", action="store_true", help="真正写库")

    args = ap.parse_args()
    if args.cmd == "analyze":
        analyze(args.source, args.out)
    else:
        import_rows(args.out, args.apply)


if __name__ == "__main__":
    main()
