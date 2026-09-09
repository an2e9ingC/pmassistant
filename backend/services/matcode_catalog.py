"""物料编码段树（全物料 ERP 8 位）— 种子常量 + 校验/解析辅助。

编码规则（CIS目录结构及编码规则2023705-何蓉.xlsx）：
    8 位料号 = 前缀 + 补零序号。前缀 4 位（如 1171）→ 序号 4 位；前缀 5 位（如 11761）→ 序号 3 位。
    段 = 前缀 + 该段可用序号区间。1176/1177/1178/501 为组，子段各占一段；118 预留不发；
    11723 为历史冻结前缀（条/卡条旧码，closed 只读）。

注意：图号系列已按源表实测锁定：
    LM_LJ.030→座块  .035→腔体  .038→条卡(含旧11723)  .040→盖板  .041→面板
    LM_BJ.010→螺柱/支柱-块(共享系列)  .015→屏蔽罩  .020→中间件  .022→导销
    图号 = series + '.' + 补零4位(与码序号同值)。图号跨段可重复（支柱-块/螺柱共用 010），
    因此图号不做全局唯一约束 —— 唯一 join key 永远是 code。
"""

# (key, parent_key, label, prefix, suffix_width, is_group, issueable, closed,
#  drawing_series, drawing_width, sort_order)
SEGMENT_SEEDS = [
    # ── 独立家族段（直接发放）────────────────────────────────────
    ("1170", None, "装配图", "1170", 4, 0, 1, 0, None, 0, 10),
    ("1171", None, "座/块", "1171", 4, 0, 1, 0, "LM_LJ.030", 4, 20),
    ("1172", None, "腔体/箱体", "1172", 4, 0, 1, 0, "LM_LJ.035", 4, 30),
    ("1173", None, "条/卡条", "1173", 4, 0, 1, 0, "LM_LJ.038", 4, 40),
    ("legacy11723", "1173", "条/卡条(旧前缀·冻结)", "11723", 3, 0, 0, 1, "LM_LJ.038", 4, 41),
    ("1174", None, "盖板/端盖", "1174", 4, 0, 1, 0, "LM_LJ.040", 4, 50),
    ("1175", None, "面板/板", "1175", 4, 0, 1, 0, "LM_LJ.041", 4, 60),
    ("1179", None, "铭牌/标签", "1179", 4, 0, 1, 0, None, 0, 70),
    # ── 组节点（不可发放）──────────────────────────────────────
    ("1176", None, "标件", "1176", 0, 1, 0, 0, None, 0, 80),
    ("1177", None, "外购件", "1177", 0, 1, 0, 0, None, 0, 90),
    ("1178", None, "连接器类", "1178", 0, 1, 0, 0, None, 0, 100),
    ("501", None, "结构耗材", "501", 0, 1, 0, 0, None, 0, 110),
    ("118", None, "预留段(不可发放)", "118", 5, 1, 0, 1, None, 0, 120),
    # ── 1176 标件 子段 ─────────────────────────────────────────
    ("11761", "1176", "螺柱", "11761", 3, 0, 1, 0, "LM_BJ.010", 4, 81),
    ("11762", "1176", "屏蔽罩", "11762", 3, 0, 1, 0, "LM_BJ.015", 4, 82),
    ("11763", "1176", "中间件", "11763", 3, 0, 1, 0, "LM_BJ.020", 4, 83),
    ("11764", "1176", "导销", "11764", 3, 0, 1, 0, "LM_BJ.022", 4, 84),
    ("11765", "1176", "支柱/块", "11765", 3, 0, 1, 0, "LM_BJ.010", 4, 85),
    # ── 1177 外购件 子段 ───────────────────────────────────────
    ("11770", "1177", "通用类", "11770", 3, 0, 1, 0, None, 0, 91),
    ("11771", "1177", "灯", "11771", 3, 0, 1, 0, None, 0, 92),
    ("11772", "1177", "滤波器", "11772", 3, 0, 1, 0, None, 0, 93),
    ("11773", "1177", "开关", "11773", 3, 0, 1, 0, None, 0, 94),
    ("11774", "1177", "电源模块", "11774", 3, 0, 1, 0, None, 0, 95),
    ("11775", "1177", "防尘网", "11775", 3, 0, 1, 0, None, 0, 96),
    ("11776", "1177", "风扇", "11776", 3, 0, 1, 0, None, 0, 97),
    ("11777", "1177", "导热垫", "11777", 3, 0, 1, 0, None, 0, 98),
    ("11778", "1177", "锁紧条", "11778", 3, 0, 1, 0, None, 0, 99),
    ("11779", "1177", "助拔器", "11779", 3, 0, 1, 0, None, 0, 100),
    # ── 1178 连接器类 子段（11783 外购设备整机，独立表文件）─────────
    ("11781", "1178", "连接器", "11781", 3, 0, 1, 0, None, 0, 101),
    ("11782", "1178", "连接器(带线)", "11782", 3, 0, 1, 0, None, 0, 102),
    ("11783", "1178", "外购设备整机", "11783", 3, 0, 1, 0, None, 0, 103),
    # ── 501 结构耗材 子段 ──────────────────────────────────────
    ("50110", "501", "沉头", "50110", 3, 0, 1, 0, None, 0, 111),
    ("50111", "501", "组合", "50111", 3, 0, 1, 0, None, 0, 112),
    ("50112", "501", "盘头", "50112", 3, 0, 1, 0, None, 0, 113),
    ("50113", "501", "垫圈", "50113", 3, 0, 1, 0, None, 0, 114),
    ("50114", "501", "平头", "50114", 3, 0, 1, 0, None, 0, 115),
    ("50115", "501", "螺母", "50115", 3, 0, 1, 0, None, 0, 116),
    ("50116", "501", "六角铜柱", "50116", 3, 0, 1, 0, None, 0, 117),
]

# 表文件(去汇总子表) → 段 key 的映射（供基线导入/清洗使用；装配图文件按码前缀归段）
# 子表为权威数据源；汇总 sheet（06-标件/07-外购件/08-连接器类/结构耗材）跳过防重复。
SOURCE_SHEET_TO_SEGMENT = {
    "01-座-块": "1171",
    "02-腔体": "1172",
    "03-条-卡条": "1173",          # 内含 11723 旧码 → 解析时落到 legacy11723
    "04-盖板": "1174",
    "05-面板": "1175",
    "螺柱": "11761",
    "屏蔽罩": "11762",
    "中间件": "11763",
    "导销": "11764",
    "支柱-块": "11765",
    "通用类": "11770",
    "灯": "11771",
    "滤波器": "11772",
    "开关": "11773",
    "电源模块": "11774",
    "防尘网": "11775",
    "风扇": "11776",
    "导热垫": "11777",
    "锁紧条": "11778",
    "助拔器": "11779",
    "连接器": "11781",
    "连接器带线": "11782",
    "09-外购设备整机": "11783",
    "10-铭牌-标签": "1179",
    "沉头": "50110",
    "组合": "50111",
    "盘头": "50112",
    "垫圈": "50113",
    "平头": "50114",
    "螺母": "50115",
    "六角铜柱": "50116",
}

# 装配图文件内 sheet 名错位（实为 03-条-卡条 标题，码却是 11700），按文件级映射特判
SOURCE_FILE_TO_SEGMENT = {
    "装配图": "1170",
}


def seed_segments(db):
    """幂等写入段树种子。返回新建行数。"""
    from backend.models.matcode import MatcodeSegment
    created = 0
    for (key, parent_key, label, prefix, sw, is_group, issueable, closed,
         dseries, dwidth, sort) in SEGMENT_SEEDS:
        existing = db.query(MatcodeSegment).filter(MatcodeSegment.key == key).first()
        if existing:
            continue
        db.add(MatcodeSegment(
            key=key, parent_key=parent_key, label=label, prefix=prefix,
            suffix_width=sw, is_group=is_group, issueable=issueable, closed=closed,
            drawing_series=dseries, drawing_width=dwidth, sort_order=sort,
        ))
        created += 1
    if created:
        db.commit()
    return created


def get_segment(db, key: str):
    from backend.models.matcode import MatcodeSegment
    return db.query(MatcodeSegment).filter(MatcodeSegment.key == key).first()


def segments_by_key(db):
    """{key: MatcodeSegment} 全量缓存。"""
    from backend.models.matcode import MatcodeSegment
    return {s.key: s for s in db.query(MatcodeSegment).all()}


def resolve_segment_for_code(db, code: str):
    """按最长前缀匹配 8 位码 → 归属段（issueable 或 closed 历史段）。

    返回 (segment, suffix)。匹配不到返回 (None, None)。组节点不参与匹配。
    """
    from backend.models.matcode import MatcodeSegment
    segs = db.query(MatcodeSegment).filter(MatcodeSegment.is_group == 0).all()
    best = None
    for s in segs:
        if code.startswith(s.prefix):
            if best is None or len(s.prefix) > len(best.prefix):
                best = s
    if best is None:
        return None, None
    return best, int(code[len(best.prefix):])


def code_from_suffix(segment, suffix: int) -> str:
    """段内序号 → 8 位码（补零）。"""
    return f"{segment.prefix}{suffix:0{segment.suffix_width}d}"


def drawing_from_suffix(segment, suffix: int):
    """码序号 → 联号图号（series + '.' + 补零4位，与码序号同值）。无 series 返回 None。"""
    if not segment.drawing_series or not segment.drawing_width:
        return None
    return f"{segment.drawing_series}.{suffix:0{segment.drawing_width}d}"


def max_suffix_of_segment(db, segment, exclude_statuses=()) -> int:
    """段内最大序号（跨 status 含作废；永不回填，故作废码也占位）。"""
    from backend.models.matcode import MatcodeMaterial
    q = db.query(MatcodeMaterial).filter(MatcodeMaterial.segment_id == segment.id)
    if exclude_statuses:
        q = q.filter(~MatcodeMaterial.status.in_(list(exclude_statuses)))
    row = q.order_by(MatcodeMaterial.suffix.desc()).first()
    return row.suffix if row else 0


def is_admin_user(user) -> bool:
    """管理员级能力判定：role=admin 或权限含 admin（与前端 isAdmin / require_admin 同口径）。"""
    if getattr(user, "role", None) == "admin":
        return True
    from backend.middleware.auth import has_perm
    return has_perm(user, "admin")


# ERP 全量族扩容种子：只增不改既有 38 段（append-only，保证现有归属零破坏）。
# 依据 7 个 ERP 导出文件的 8 位码实测派生 + CIS 规则书空族；seed_segments 幂等跳过已存在 key。
# 定义在 matcode_families.py（与分类树常量同源），此处合并进唯一种子权威列表。
from backend.services.matcode_families import FAMILY_SEGMENT_SEEDS  # noqa: E402

SEGMENT_SEEDS = SEGMENT_SEEDS + FAMILY_SEGMENT_SEEDS
