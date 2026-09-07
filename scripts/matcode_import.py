#!/usr/bin/env python3
"""结构件物料编码基线 — 清洗 + 导入（两阶段，人工关卡）。

A 阶段 analyze（零写库）：
    python3 scripts/matcode_import.py analyze --source "docs/结构编码规范及最新编码情况" \
        --out data/matcode-import
    - 逐文件逐子表解析（跳过汇总 sheet：06-标件 / 07-外购件 / 08-连接器类 / 结构耗材）
    - .XLS 先经 LibreOffice 转 xlsx（转换结果落在 out/converted/）
    - 生成 cleaning-report.html（人工可读）+ raw-rows.json（归一化候选行）+ decisions.json（默认空）
    人工关卡：审报告；如需剔除/改码在 decisions.json 里补规则后重跑 analyze（幂等覆盖）。

B 阶段 import（默认 --dry-run，--apply 才写库）：
    python3 scripts/matcode_import.py import --source "docs/结构编码规范及最新编码情况" \
        --out data/matcode-import [--apply]
    - 读 decisions.json + raw-rows.json；init_db 建表+种子段；按最长前缀把码归到段；
    - 已存在 code 幂等跳过；按 earliest-first 去重；写 audit（high）
    - --apply 前请 ./server.sh stop -p <PORT>，apply 后重启。

未来 ERP 缝：code 是唯一 join key、永不改号/回填；后续接 API/表格/爬虫时以
source='erp:<file>/<sheet>' 另建关联，本脚本不导入 PE375 出库单。
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
import tempfile
from collections import Counter, OrderedDict

import openpyxl

# 项目根（本文件在 scripts/ 下）
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

# 汇总 sheet（与子表内容重叠，跳过防重复）
AGGREGATE_SHEETS = {"06-标件", "07-外购件", "08-连接器类", "结构耗材"}
# 需先转 xlsx 的旧 .XLS
XLS_CONVERT = {"结构耗材.XLS": "结构耗材.xlsx"}

# 名称形如 "PE0141-1326UA…" 的 PE+数字 即项目编号；EPE4751 等整词不计
_PROJECT_RE = re.compile(r"(?:^|[^A-Za-z0-9])(PE\d{3,4})", re.IGNORECASE)


def _proj_from_name(name):
    m = _PROJECT_RE.search(name or "")
    return m.group(1).upper() if m else None


# ────────────────────────── 段常量（与 matcode_catalog 对齐） ──────────────────────────
def _seeds():
    from backend.services.matcode_catalog import SEGMENT_SEEDS
    return SEGMENT_SEEDS


def segment_for_code(code: str):
    """按最长前缀把 8 位码归到段（非组段）。返回 (key,label,prefix,suffix) 或 (None,...)。"""
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


def code_col_header(h):
    for j, x in enumerate(h):
        if x and ("物料编码" in x or "存货编码" in x):
            return j
    return None


def _hdr_norm(x):
    """表头规范化：去空白 + 去掉括号内容，避免「图号（型号）」被误认成名称/型号。"""
    s = re.sub(r"\s+", "", x or "")
    s = re.sub(r"[（(][^）)]*[）)]", "", s)
    return s


def _pick(hdr, *keys):
    """按 key 优先级 + 表头精确匹配选列（键优先于列序，防 contains 跨列误配）。"""
    norm = [_hdr_norm(x) for x in hdr]
    for k in keys:
        for j, n in enumerate(norm):
            if n == k:
                return j
    return None


def _ci(s):
    return "" if s is None else str(s).strip()


def _to8(v):
    """excel 数值/字符串 → 8 位码字符串；非 8 位数字返回 None。"""
    s = _ci(v)
    if not s:
        return None
    if re.fullmatch(r"\d{8}", s):
        return s
    if re.fullmatch(r"\d+\.0", s):
        s = s[:-2]
    if re.fullmatch(r"\d{8}", s):
        return s
    return None


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


# ────────────────────────── analyze ──────────────────────────

def analyze(source, out):
    os.makedirs(out, exist_ok=True)
    conv_dir = os.path.join(out, "converted")
    os.makedirs(conv_dir, exist_ok=True)

    rows = []          # 归一化候选行（跨文件按读取顺序编号 row_id）
    issues = []        # {level, file, sheet, row(序号), msg}
    seen_code = OrderedDict()

    def add_row(rd):
        rows.append(rd)
        seen_code.setdefault(rd["code"], rd["row_id"])

    files = sorted(glob.glob(os.path.join(source, "*")))
    file_seq = 0
    for fpath in files:
        base = os.path.basename(fpath)
        # 跳过规则文档与 ERP 出库单（非基线编码表）；~$ 开头 = Office 临时/锁文件，非真实工作簿
        if "CIS目录" in base or "出库单" in base or base.startswith("~$"):
            continue
        wbpath = fpath
        extra = ""
        if base.lower().endswith((".xls", ".xlsx")):
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
        else:
            continue

        file_label = base + extra
        for ws in wb.worksheets:
            title = ws.title
            if title in AGGREGATE_SHEETS:
                continue
            for (ri, hdr, cells) in sheet_rows(ws):
                ci = code_col_header(hdr)
                if ci is None or ci >= len(cells):
                    continue
                code = _to8(cells[ci])
                if code is None:
                    # 仅当编码格疑似「不完整料号」（纯数字且位数非 8）才提醒；
                    # 空 / 含文字 的整行视为非物料行（表尾说明、空行），静默跳过
                    raw = _ci(cells[ci])
                    if raw and re.fullmatch(r"\d{1,9}(\.0)?", raw):
                        issues.append({"level": "warn", "file": base, "sheet": title,
                                       "row": ri, "msg": "编码列疑似料号位数异常（非 8 位）",
                                       "value": raw[:30]})
                    continue
                file_seq += 1
                seg = segment_for_code(code)
                # 铭牌-标签：型号列存名称（PE0311_xxx_铭牌）非图号，故名称键顺序需覆盖型号场景
                ni = _pick(hdr, "名称", "存货名称", "型号")
                spec_i = _pick(hdr, "规格型号", "厂家规格型号")
                if spec_i is None:  # 兼容「厂家规格型号/描述」类复合表头
                    for _j, _x in enumerate(hdr):
                        if "规格型号" in _hdr_norm(_x):
                            spec_i = _j
                            break
                draw_i = _pick(hdr, "图号")
                if "铭牌" in base:
                    draw_i = None  # 铭牌无图号；型号列已被 ni 用作名称
                remark_i = _pick(hdr, "备注/使用项目", "器件描述", "描述", "备注")
                vendor_i = _pick(hdr, "厂家")  # 外购件生产厂家（并入备注保留溯源）
                name = _ci(cells[ni]) if ni is not None and ni < len(cells) else ""
                spec = _ci(cells[spec_i]) if spec_i is not None and spec_i < len(cells) else ""
                drawing = _ci(cells[draw_i]) if draw_i is not None and draw_i < len(cells) else ""
                remark = _ci(cells[remark_i]) if remark_i is not None and remark_i < len(cells) else ""
                if vendor_i is not None and vendor_i < len(cells):
                    vendor = _ci(cells[vendor_i])
                    if vendor:
                        remark = (f"厂家:{vendor}" + ("；" + remark if remark else ""))
                if not name:
                    # 名称缺失兜底，按实际来源分流（报告如实标注「用了什么当名称」）
                    if spec:
                        name = spec
                        fb = "名称缺失，用「厂家规格型号」填名"
                    elif drawing:
                        name = drawing
                        fb = "名称缺失，用「图号」填名"
                    else:
                        name = code
                        fb = "名称缺失，且规格型号/图号/描述均空，暂用料号作名称（疑似占位行）"
                    issues.append({"level": "warn", "file": base, "sheet": title,
                                   "row": ri, "msg": fb, "value": name[:40]})

                add_row({
                    "row_id": file_seq, "file": base, "sheet": title, "row": ri,
                    "code": code, "name": name, "spec": spec,
                    "drawing": drawing, "remark": remark,
                    "seg_key": seg[0] if seg else None,
                    "seg_label": seg[1] if seg else None,
                })

                # ── 异常检查 ──
                if seg is None:
                    issues.append({"level": "error", "file": base, "sheet": title,
                                   "row": ri, "msg": "码前缀不在已知段树",
                                   "value": f"code={code}"})
                    continue
                # 重复 code（跨 sheet，earliest-first 保留）
                if seen_code[code] != file_seq:
                    issues.append({"level": "error", "file": base, "sheet": title,
                                   "row": ri, "msg": f"重复码，已保留 row={seen_code[code]}",
                                   "value": f"code={code}"})
                # drawing 与段期望系列不符
                exp_series = None
                for k, _p, _l, _pre, _sw, _g, _iss, _cl, ds, _dw, _so in _seeds():
                    if k == seg[1]:
                        exp_series = ds
                if drawing and exp_series and not drawing.startswith(exp_series + "."):
                    issues.append({"level": "warn", "file": base, "sheet": title,
                                   "row": ri, "msg": f"图号与段系列不符(期望{exp_series})",
                                   "value": drawing[:40]})

    # 重复 (name,spec) 统计（同 file/sheet 内真实重复才报）
    # 按段统计
    seg_count = Counter(r["seg_key"] for r in rows)

    # 重复 (段+名称+规格) 分类：真重码(组内备注一致=同物料重复编码) vs 伪重复(备注不同=靠表面处理/材质区分的不同料)
    nskey = Counter((r["seg_key"], r["name"], r["spec"]) for r in rows)
    name_dup = {k: c for k, c in nskey.items() if c > 1}

    def _rm_norm(s):
        return re.sub(r"\s+", "", s or "")

    dup_groups = []
    for key in name_dup:
        members = [r for r in rows if (r["seg_key"], r["name"], r["spec"]) == key]
        remarks = {_rm_norm(m["remark"]) for m in members}
        if len(remarks) <= 1:
            cls, reason = "真重码", "组内备注一致（含均为空），疑为同一物料重复编码，多余号建议后续作废收敛"
        else:
            cls, reason = "伪重复", "组内备注不同（如表面处理/材质差异），按不同物料保留；若确为同一物料请按真重码处理"
        for m in members:
            m["dup_flag"] = "true" if cls == "真重码" else "false"
        dup_groups.append({
            "key": list(key), "seg_key": key[0], "name": key[1], "spec": key[2],
            "count": len(members), "class": cls, "reason": reason, "members": members,
        })
    dup_groups.sort(key=lambda g: (g["class"] != "真重码", -g["count"]))

    # decisions.json（默认空模板，幂等保留已有人工编辑）
    dec_path = os.path.join(out, "decisions.json")
    if not os.path.exists(dec_path):
        with open(dec_path, "w", encoding="utf-8") as f:
            json.dump({"skip_rows": [], "rename_code": {}, "_说明": "见 cleaning-report.html 底部"},
                      f, ensure_ascii=False, indent=2)

    raw_path = os.path.join(out, "raw-rows.json")
    with open(raw_path, "w", encoding="utf-8") as f:
        json.dump({"rows": rows}, f, ensure_ascii=False, indent=1)

    with open(os.path.join(out, "issues.json"), "w", encoding="utf-8") as f:
        json.dump(issues, f, ensure_ascii=False, indent=1)

    # 重复组 sidecar（供后续作废/补名决策，非导入依赖）
    with open(os.path.join(out, "dup-groups.json"), "w", encoding="utf-8") as f:
        json.dump(dup_groups, f, ensure_ascii=False, indent=1)

    _write_report(out, rows, issues, seg_count, dup_groups)

    print("=" * 70)
    print(f"解析文件目录: {source}")
    print(f"候选行总数: {len(rows)}")
    print("各段行数:")
    for k in sorted(seg_count, key=lambda x: _seg_sort(x)):
        print(f"  {str(k):12s} {seg_count[k]:5d}")
    print("issues:", len(issues), "error:", sum(1 for i in issues if i["level"] == "error"),
          "warn:", sum(1 for i in issues if i["level"] == "warn"))
    print("name+spec 重复组:", len(name_dup),
          "| 真重码:", sum(1 for g in dup_groups if g["class"] == "真重码"),
          "| 伪重复:", sum(1 for g in dup_groups if g["class"] == "伪重复"))
    print(f"报告: {os.path.join(out, 'cleaning-report.html')}")


def _seg_sort(k):
    order = list(_seeds())
    for i, seed in enumerate(order):
        if seed[0] == k:
            return i
    return 999


def _write_report(out, rows, issues, seg_count, dup_groups):
    rep = ["""<!doctype html><html lang=zh><head><meta charset=utf-8>
<title>物料编码基线清洗报告</title>
<style>
body{font:13px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;margin:24px;color:#222}
h1{font-size:20px} h2{font-size:15px;border-bottom:1px solid #eee;padding-bottom:4px;margin-top:28px}
table{border-collapse:collapse;margin:8px 0;width:100%}
th,td{border:1px solid #e3e3e3;padding:3px 8px;text-align:left;font-size:12px}
th{background:#f6f8fa}
.err{color:#c0392b}.warn{color:#b9770e} .ok{color:#27ae60}
code{background:#f4f4f4;padding:0 3px;border-radius:3px}
.sum td:nth-child(2){text-align:right}
</style></head><body>"""]
    # 段 key → (label,prefix) 供展示
    label_of = {s[0]: (s[2], s[3]) for s in _seeds()}

    def seg_disp(k):
        lab, pre = label_of.get(k, (None, None))
        return f"{lab}·{pre}" if lab else str(k)

    def esc(v):
        return html.escape(str(v or ""))

    def src(r):
        return f"{r['file']} › {r['sheet']} › 第{r['row']}行"

    warn = sum(1 for i in issues if i["level"] == "warn")
    err = len(issues) - warn
    rep.append(f"<h1>物料编码基线清洗报告</h1>"
               f"<p class=meta>候选行 <b>{len(rows)}</b> ｜ 异常 <b class={'err' if err else 'ok'}>{err}</b> "
               f"warn <b class=warn>{warn}</b> ｜ 名称+规格重复组 <b>{len(dup_groups)}</b></p>")
    # 出处约定说明
    rep.append("""<h2>阅读约定</h2>
<p>三部分均逐行标注<b>出处</b>：<code>源文件 › 子表名 › 第N行</code>，N 与 Excel 打开该子表后左侧可见的行号一致，可直接定位。
<b>段</b>一列写作「分类名·前缀」如 座/块·1171（前缀 = 8 位料号开头）。row_id 是程序生成的跨文件连续编号，
仅供 decisions.json 剔除/改码引用，与 Excel 无关。段 key 为系统内部编码（1171/11761/50110…）。</p>""")
    # ① 按段统计
    rep.append("<h2>① 按段统计（该段拟入库条数）</h2><table class=sum><tr><th>段（key）</th><th>前缀</th><th>行数</th></tr>")
    for k in sorted(seg_count, key=_seg_sort):
        lab, pre = label_of.get(k, (k, ""))
        rep.append(f"<tr><td>{esc(lab)}（{esc(k)}）</td><td><code>{esc(pre)}</code></td>"
                   f"<td>{seg_count[k]}</td></tr>")
    rep.append("</table>")
    # ② 问题清单（含出处）
    rep.append("""<h2>② 问题清单（异常明细，含出处）</h2>
<p><span class=err>error</span> = 需处理（重复料号默认保留首现，见③重复表人工裁决）；
<span class=warn>warn</span> = 提示，通常可原样保留。</p>
<table><tr><th>级别</th><th>出处（文件›子表›行）</th><th>说明</th><th>取值/料号</th></tr>""")
    if not issues:
        rep.append("<tr><td class=ok colspan=4>无异常</td></tr>")
    for i in issues:
        rep.append(f"<tr><td class={i['level']}>{i['level']}</td>"
                   f"<td>{esc(i['file'])} › {esc(i['sheet'])} › 第{i['row']}行</td>"
                   f"<td>{esc(i['msg'])}</td><td><code>{esc(i.get('value',''))}</code></td></tr>")
    rep.append("</table>")
    # ③ 重复组明细（每一成员一行，含出处，供人工裁决）
    if dup_groups:
        n_true = sum(1 for g in dup_groups if g["class"] == "真重码")
        rep.append(f"""<h2>③ 重复组（同一段下 名称+规格 完全相同）—— 共 {len(dup_groups)} 组，其中 <span class=err>真重码 {n_true}</span>、<span class=warn>伪重复 {len(dup_groups) - n_true}</span></h2>
<table class=leg><tr><th>标记</th><th>判定依据</th><th>建议</th></tr>
<tr><td><b class=err>真重码</b></td><td>组内成员<b>备注一致</b>（含均空）→ 同一物料重复编了多个料号</td><td>导入后对多余号<b>作废收敛</b>（本阶段仍全保留，不剔除）</td></tr>
<tr><td><b class=warn>伪重复</b></td><td>组内成员<b>备注不同</b>（如表面处理 304/黑色/达克罗、材质差异）→ 按不同库存料</td><td>正常保留；建议把区分补进 名称/规格，避免日后发行被查重拦截</td></tr></table>
<p>下表每组成员一行，均已标注出处。组号与标记仅用于指认，<b>导入默认全保留</b>。</p>
<table><tr><th>组</th><th>判定</th><th>料号</th><th>段</th><th>名称</th><th>规格</th><th>出处（文件›子表›行）</th><th>备注</th></tr>""")
        gi = 0
        for g in dup_groups:
            gi += 1
            first = True
            for r in g["members"]:
                cls = "err" if g["class"] == "真重码" else "warn"
                td0 = f'<td rowspan={len(g["members"])}>{gi}</td><td rowspan={len(g["members"])} class={cls}><b>{g["class"]}</b></td>' if first else ""
                rep.append(f"<tr>{td0}<td><code>{esc(r['code'])}</code></td><td>{esc(seg_disp(r['seg_key']))}</td>"
                           f"<td>{esc(r['name'][:50])}</td><td>{esc(r['spec'][:30])}</td>"
                           f"<td>{esc(src(r))}</td><td>{esc(r['remark'][:50])}</td></tr>")
                first = False
        rep.append("</table>")
    else:
        rep.append("<h2>③ 重复组</h2><p class=ok>无（同一段下 名称+规格 均唯一）</p>")
    # decisions 说明
    rep.append("""<h2>decisions.json 规则说明</h2>
<table><tr><th>键</th><th>含义</th></tr>
<tr><td><code>skip_rows</code></td><td>要剔除的 row_id 数组（见下方候选清单第一列）</td></tr>
<tr><td><code>rename_code</code></td><td>改码映射 {原8位码: 新8位码}（极少用，仅当码本身录错）</td></tr></table>
<h2>候选清单（全量，row_id 对应 decisions 用）</h2>
<table><tr><th>row_id</th><th>料号</th><th>段</th><th>名称</th><th>规格</th><th>图号</th><th>出处（文件›子表›行）</th><th>备注</th></tr>""")
    for r in rows:
        rep.append(f"<tr><td>{r['row_id']}</td><td><code>{esc(r['code'])}</code></td>"
                   f"<td>{esc(seg_disp(r['seg_key']))}</td><td>{esc(r['name'][:60])}</td>"
                   f"<td>{esc(r['spec'][:40])}</td><td>{esc(r['drawing'][:30])}</td>"
                   f"<td>{esc(src(r))}</td><td>{esc(r['remark'][:60])}</td></tr>")
    rep.append("</table></body></html>")
    with open(os.path.join(out, "cleaning-report.html"), "w", encoding="utf-8") as f:
        f.write("\n".join(rep))


# ────────────────────────── import ──────────────────────────

def import_rows(out, source, apply_):
    dec_path = os.path.join(out, "decisions.json")
    raw_path = os.path.join(out, "raw-rows.json")
    if not os.path.exists(dec_path) or not os.path.exists(raw_path):
        raise SystemExit("请先运行 analyze 生成报告/raw-rows.json，再 import")
    with open(dec_path, encoding="utf-8") as f:
        dec = json.load(f)
    with open(raw_path, encoding="utf-8") as f:
        rows = json.load(f)["rows"]

    skip = set(dec.get("skip_rows", []))
    rename = dec.get("rename_code", {})

    # DB 连接（DATABASE_URL 由外部 env 决定，默认 pma-8000.db）
    from backend.database import SessionLocal, init_db
    from backend.models.local import AuditLog
    from backend.models.matcode import MatcodeSegment, MatcodeMaterial
    from backend.services.matcode_catalog import seed_segments

    init_db()
    db = SessionLocal()
    try:
        seed_segments(db)
        seg_by_key = {s.key: s for s in db.query(MatcodeSegment).all()}
        existing = set(x[0] for x in db.query(MatcodeMaterial.code).all())

        planned = []   # (seg, suffix, code, name, spec, drawing, remark, file, sheet)
        drop, skip_nofile = [], 0
        for r in rows:
            rid = r["row_id"]
            if rid in skip:
                drop.append(rid)
                continue
            code = rename.get(r["code"], r["code"])
            if code in existing:
                skip_nofile += 1
                continue
            seg = seg_by_key.get(r["seg_key"])
            if seg is None:
                raise SystemExit(f"row {rid}: 段 {r['seg_key']} 不存在（先跑 analyze）")
            suffix = int(code[len(seg.prefix):])
            planned.append((seg, suffix, code, r["name"], r["spec"], r["drawing"],
                            r["remark"], r["file"], r["sheet"]))

        if not apply_:
            print("── import dry-run（未写库；--apply 才落库）──")
            print("计划写入:", len(planned), "| 跳过(已存在/已剔除):", skip_nofile, "| decisions剔除:", len(drop))
            cnt = Counter(p[0].key for p in planned)
            for k in sorted(cnt, key=_seg_sort):
                print(f"  {str(k):12s} +{cnt[k]:5d}")
            return

        # apply
        created = 0
        for seg, suffix, code, name, spec, drawing, remark, fname, sheet in planned:
            legacy = "11723" if seg.key == "legacy11723" else None
            db.add(MatcodeMaterial(
                code=code, segment_id=seg.id, legacy_prefix=legacy,
                name=name or code, spec=spec or None, drawing=drawing or None,
                remark=remark or None, project=_proj_from_name(name) or None, unit=None,
                source=f"import:{fname}/{sheet}", status="active",
                suffix=suffix, created_by="system",
            ))
            created += 1
        db.commit()
        # 审计（脚本无会话用户，记 system）
        db.add(AuditLog(username="system", action="matcode_import",
                        detail=f"基线导入 共{created}条（文件目录 {source}）",
                        category="物料编码", level="high"))
        db.commit()
        print(f"导入完成: {created} 条。已写库 {out}")
        cnt = Counter(p[0].key for p in planned)
        for k in sorted(cnt, key=_seg_sort):
            print(f"  {str(k):12s} +{cnt[k]:5d}")
    finally:
        db.close()


def main():
    ap = argparse.ArgumentParser(description="物料编码基线 清洗+导入")
    sub = ap.add_subparsers(dest="cmd", required=True)

    pa = sub.add_parser("analyze", help="清洗分析：产出报告+raw-rows+decisions（零写库）")
    pa.add_argument("--source", required=True, help="Excel 源目录")
    pa.add_argument("--out", default="data/matcode-import", help="输出目录")

    pi = sub.add_parser("import", help="导入：默认 dry-run")
    pi.add_argument("--source", required=True, help="仅用于审计 detail 展示")
    pi.add_argument("--out", default="data/matcode-import")
    pi.add_argument("--apply", action="store_true", help="真正写库")

    args = ap.parse_args()
    if args.cmd == "analyze":
        analyze(args.source, args.out)
    else:
        import_rows(args.out, args.source, args.apply)


if __name__ == "__main__":
    main()
