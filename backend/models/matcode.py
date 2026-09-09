"""物料编码平台（全物料 ERP 8 位料号）— 数据模型。

- MatcodeSegment : 编码段树（段 = 前缀 + 补零序号，总长 8 位）。启动时幂等种子，非用户数据。
- MatcodeMaterial: 每个已发放/已导入的 8 位料号一行，永久保留（无 UI 硬删除）。

关键不变量：
- code 全局唯一（UNIQUE 约束 = 并发兜底）。
- suffix = int(code[len(segment.prefix):]) 反规范化计数；autonext = MAX(suffix)+1。
  → 用「段FK + 整数序号」而非 `LIKE '前缀%'` 计数，天然免疫历史旧前缀
    （如 11723xxx 字面以 1172 开头，若按前缀 LIKE 会污染腔体 1172 段的统计）。
- 作废/人工跳号产生的空号永不回填（code 跨 status 唯一）。
- name + spec 不建唯一约束（查重走「精确命中 → 需管理员特批放行」业务规则）。
"""

from datetime import datetime

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from backend.database import Base


class MatcodeSegment(Base):
    """编码段。8 位码 = prefix + 补零 suffix（prefix 长 4 → suffix 4 位；长 5 → suffix 3 位）。

    组节点（is_group=1，如 1176/1177/1178/5011）不可发放；closed 节点（如 legacy11723、118）
    冻结只读。drawing_series 非空表示该段发放时可按需自动联号出图号。
    """

    __tablename__ = "matcode_segments"
    __table_args__ = (
        UniqueConstraint("key", name="uq_matcode_segments_key"),
        UniqueConstraint("prefix", name="uq_matcode_segments_prefix"),
    )

    id = Column(Integer, primary_key=True)
    key = Column(String(24), nullable=False)            # 稳定键：1171 / 11761 / legacy11723 ...
    parent_key = Column(String(24), nullable=True)      # 所属组 key（standalone 段为 NULL）
    label = Column(String(64), nullable=False)          # 中文名：座/块、标件...
    prefix = Column(String(8), nullable=False)          # 数字前缀，如 '1171' / '11761'
    suffix_width = Column(Integer, default=4, nullable=False)  # 码序号补零宽度（8-len(prefix)）
    is_group = Column(Integer, default=0, nullable=False)      # 组节点（仅聚合子段，不可发放）
    issueable = Column(Integer, default=0, nullable=False)     # 是否可发放（非组非 closed）
    closed = Column(Integer, default=0, nullable=False)        # 冻结段（只读历史，如 11723/118）
    drawing_series = Column(String(64), nullable=True)  # 图号联号系列，如 'LM_LJ.030'
    drawing_width = Column(Integer, default=0)          # 图号序号补零宽度（0 = 该段无图号联号）
    sort_order = Column(Integer, default=0)             # 展示顺序
    created_at = Column(DateTime, default=func.now())

    # 运行时属性（/tree 计算返回，非 DB 列）
    materials = relationship("MatcodeMaterial", back_populates="segment")


class MatcodeMaterial(Base):
    """每个 8 位料号一行，永久保留。

    source 溯源: manual:<username> / import:<file>/<sheet> / erp:...（为未来 ERP 接入预留）。
    status: active 在用 / stopped 停用 / void 作废。作废后号码不回填、不可改号复用。
    """

    __tablename__ = "matcode_materials"
    __table_args__ = (
        UniqueConstraint("code", name="uq_matcode_materials_code"),
        Index("ix_matcode_segment_suffix", "segment_id", "suffix"),
        Index("ix_matcode_segment_drawing", "segment_id", "drawing"),
    )

    id = Column(Integer, primary_key=True)
    code = Column(String(8), nullable=False, index=True)        # 8 位料号，全局唯一
    segment_id = Column(Integer, ForeignKey("matcode_segments.id"), nullable=False, index=True)
    legacy_prefix = Column(String(8), nullable=True)            # 旧前缀（仅历史导入码：11723）
    name = Column(String(256), nullable=False)                  # 物料名称（必填）
    spec = Column(String(256), nullable=True)                   # 规格型号 / 厂家规格型号
    manufacturer = Column(String(256), nullable=True)           # 生产厂商（元器件/外购件查看必需）
    drawing = Column(String(128), nullable=True)                # 图号（如 LM_LJ.030.0001，可空）
    project = Column(String(128), nullable=True)                # 使用项目
    unit = Column(String(32), nullable=True)                    # 单位
    remark = Column(Text, nullable=True)
    source = Column(String(128), nullable=True)                 # manual:<u> / import:<f>/<s>
    status = Column(String(16), default="active", nullable=False, index=True)
    suffix = Column(Integer, nullable=False)                    # int(code[len(prefix):])
    created_by = Column(String(64), nullable=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    segment = relationship("MatcodeSegment", back_populates="materials")
