# PMA 系统状态/条件判定分类

> 版本：v2026.06.10-beta6 | 最后更新：2026-06-11

本文档整理系统中所有状态、风险、告警的判定条件与逻辑。

---

## 一、项目级别（Project）

### 1.1 `_map_status()` — PMA 项目状态映射
`backend/services/project_service.py:574-592`

| 禅道原始值 | 条件 | PMA 状态 |
|-----------|------|----------|
| `wait` | — | `pending`（未开始） |
| `doing` | — | `active`（进行中） |
| `done` / `closed` | 文档齐套 AND 任务全完成 AND 阶段无异常 | `completed`（已完成） |
| `done` / `closed` | 文档不全 OR 任务未全完成 OR 阶段有异常 | `incomplete`（待完善） |
| `suspended` | — | `blocked`（已阻塞） |
| `canceled` | — | `canceled`（已取消） |

### 1.2 `_calc_risk_level()` — 项目风险等级
`backend/services/project_service.py:474-494`

| 条件 | 风险等级 |
|------|---------|
| `done/closed` + 文档齐全 + 任务全完成 + 阶段无异常 | `normal`（正常） |
| `done/closed` + 文档不全 OR 任务未全完成 OR 阶段有异常 | `incomplete`（资料不全） |
| 无 begin 或 end 日期 | `normal` |
| total_days ≤ 0 | `normal` |
| today > end 且 progress < 100 | `overdue`（已超期） |
| 进度差距 ≤ 0（领先或持平计划） | `normal`（正常） |
| 进度差距 1-15% | `low`（较低） |
| 进度差距 16-30% | `medium`（中等） |
| 进度差距 > 30% | `high`（高） |

**进度差距计算公式:** `elapsed_pct - progress`，其中 `elapsed_pct = min(100, (today - begin) / (end - begin) * 100)`

### 1.3 `_get_category_counts()` — Dashboard KPI 分类计数
`backend/services/dashboard_service.py:150-162`

| KPI | 统计条件 | 数据来源 |
|-----|---------|---------|
| `active` | `p.status in ("doing", "wait")` | CachedProject 原始 status |
| `completed` | `p.status in ("done", "closed")` | ⚠ CachedProject 原始 status，未用三条件判断 |
| `high_risk` | alerts severity = `red` 的项目数（去重） | 告警列表 |
| `incomplete_docs` | alerts severity = `yellow` 的项目数（去重） | 告警列表 |

### 1.4 项目进度显示
前端 `dashboard.js:147`

| 条件 | 进度条颜色 |
|------|-----------|
| status === `blocked` | 红色 |
| progress ≥ 100 | 绿色 |
| progress < 100 | 蓝色 |

---

## 二、阶段/执行级别（Execution/Stage）

### 2.1 `_map_status()` — 阶段状态
`backend/services/project_service.py` 多处调用

禅道执行状态 → PMA 状态（与项目共用映射函数，但不经过文档/任务/阶段校验）。

### 2.2 `getStageRisk()` — 阶段风险等级（前端）
`frontend/js/detail.js:715-745`

| 条件 | 风险标签 | 颜色 |
|------|---------|------|
| status = `completed` | 已完成 | `--success` 绿 |
| status = `blocked` | 阻塞 | `--danger` 红 |
| today > end 且 progress < 100 | 超期 N 天 | `--danger` 红 |
| today < start | 未开始 | `--muted` 灰 |
| 进度差距 ≤ 5% | 正常 | `--success` 绿 |
| 进度差距 6-20% | 滞后 | `--warn` 黄 |
| 进度差距 21-40% | 滞后 | 橙色 `#e67e22` |
| 进度差距 > 40% | 严重 | `--danger` 红 |
| 缺少计划日期 | 无计划 | `--muted` 灰 |

### 2.3 `match_status` — 阶段匹配状态
`backend/services/project_service.py:145,163,182,335,351,370`

| match_status | 含义 | 判定条件 |
|-------------|------|---------|
| `matched` | 已匹配 | 禅道执行名通过 `_match_stage_type()` 匹配到标准阶段 |
| `missing` | 阶段缺失 | 标准阶段在项目中无对应禅道执行 |
| `unmatched` | 未匹配 | 禅道执行名无法匹配到任何标准阶段 |

前端渲染 (`detail.js:779-783`):
- `missing`: 行半透明 + warn背景
- `unmatched`: warn背景
- `matched`: 正常

### 2.4 `match_kind` — 匹配精度
`backend/services/document_service.py:416-449`

| match_kind | 条件 |
|-----------|------|
| `exact` | 执行名 == 标准阶段名 |
| `fuzzy` | 子串匹配（任一方向）或关键词映射 |
| `None` | 未匹配到任何标准阶段 |

**匹配优先级:**
1. 精确匹配 (`name == st`)
2. 子串: 标准阶段名 in 执行名 (`st in name`)
3. 子串: 执行名 in 标准阶段名 (`name in st`)
4. 关键词回退 (`_STAGE_KEYWORD_MAP`)

**关键词映射 (`_STAGE_KEYWORD_MAP`):**
`backend/services/document_service.py:399-413`

| 关键词 | 映射到 |
|--------|--------|
| 硬件 | 硬件开发 |
| BOM/物料/采购/贴片/焊接 | 硬件开发 |
| FPGA/FPGA/逻辑 | 硬件开发 |
| 软件/协议/接口/驱动/协议栈 | 软件开发 |
| 结构/模具/壳体/机箱/散热 | 结构设计 |
| 测试/调试/验收/检验 | 测试 |
| 发货/包装/物流/交付/出厂 | 产品发货 |
| 总结/归档/验收/结题 | 项目总结 |

### 2.5 阶段超期检测
`backend/services/dashboard_service.py:180-190`

```
execution.end < today AND execution.status NOT IN (done, closed)
    → 告警 severity=red
    → 消息: "阶段「{name}」计划结束日期已过，状态未完成"
    → 前端: status 列显示 "⚠ 超期" 红字
```

### 2.6 阶段异常检查（项目完成条件之一）
`backend/services/project_service.py`

一个阶段被判定为"异常"的条件（任一满足即为异常）:

| 异常类型 | 条件 |
|---------|------|
| 名称非精确匹配 | `_match_stage_type()` 返回 `fuzzy` 或 `None` |
| 阶段超期 | `execution.end < today` 且 `execution.status NOT IN (done, closed)` |

---

## 三、任务级别（Task）

### 3.1 `_get_incomplete_task_counts()` — 任务完成度
`backend/services/project_service.py:46-56`

```
task.status NOT IN (done, closed) → 未完成任务
```

### 3.2 `_find_blocker()` — 卡点检测
`backend/services/project_service.py:595-601`

| 条件 | 返回值 |
|------|--------|
| `is_blocker = true` + `blocker_note` 有值 | blocker_note 内容 |
| `is_blocker = true` + `blocker_note` 为空 | "任务被标记为卡点: {name}" |
| 无卡点任务 | None |

### 3.3 `_get_who()` — 责任人获取（三层兜底）
`backend/services/project_service.py:604-629`

```
任务指派人(name) → 执行openedBy → 项目PM → 空字符串
去重后用 "、" 连接
```

### 3.4 告警: 任务完成但无输出件
`backend/services/dashboard_service.py:199-208`

| 条件 | 级别 | 消息 |
|------|------|------|
| `task.done` + `!has_files` + `type in (devel, design, test)` | yellow | "任务已完成但无附件/输出件" |

### 3.5 告警: 审核任务缺少审批标记
`backend/services/dashboard_service.py:211-221`

| 条件 | 级别 | 消息 |
|------|------|------|
| `task.done` + 任务名含 `评审/确认/审核/审批` + 描述中无 `【同意】/同意` | yellow | "审核任务描述中缺少【同意】关键字" |

---

## 四、文档级别（Document）

### 4.1 `ProjectDocument.status`
`backend/models/document.py:20-37`

| status | 含义 |
|--------|------|
| `pending` | 未提交 |
| `submitted` | 已提交（可设置 `completed_at`） |

### 4.2 文档自动提交逻辑
`backend/services/document_service.py:492-496`

```
doc.status = pending
AND execution.status IN (done, closed)
AND execution 中有 done/closed 任务且 has_files = True
    → 自动标记 doc.status = "submitted"
```

### 4.3 文档告警 `warn`
`backend/services/document_service.py:497`

```
execution.status IN (done, closed) AND doc.status = pending
    → warn = True（前端显示警告标记）
```

### 4.4 `_get_pending_doc_counts()` — 已完成阶段未提交文档
`backend/services/project_service.py:26-43`

```
execution.status IN (done, closed)
AND execution_id > 0（排除占位文档）
AND ProjectDocument.status = pending
    → has_pending_docs = True
```

### 4.5 文档模板同步（`_sync_from_templates`）
`backend/services/document_service.py:269-394`

| 阶段 | 逻辑 |
|------|------|
| Phase 1 | 对已匹配执行: 按模板创建/更新/删除 ProjectDocument 行，保留用户已设置的 status |
| Phase 2 | 对未匹配标准阶段: 创建 execution_id=0 占位文档 |

### 4.6 标准阶段定义
`backend/services/document_service.py:16-39`

**研发项目 (RD):** 售前、项目立项、需求分解、硬件开发、结构设计、BSP开发、软件开发、测试、产品发货、项目总结（10 阶段）

**生产项目 (SC):** 售前、项目立项、需求分解、硬件开发、结构设计、测试、产品发货、项目总结（8 阶段）

---

## 五、告警系统（Dashboard Alerts）

`backend/services/dashboard_service.py:165-330`

### 5.1 告警汇总

| 级别 | ID | 条件 | 消息 |
|------|----|------|------|
| 🔴 red | 1 | execution.end < today 且 status ≠ done/closed | "阶段计划结束日期已过，状态未完成" |
| 🟡 yellow | 2 | task.done + !has_files + type in (devel,design,test) | "任务已完成但无附件/输出件" |
| 🟡 yellow | 3 | task.done + 名称含审批关键字 + 描述无【同意】 | "审核任务缺少【同意】关键字" |
| 🟡 yellow | 4 | 执行名无法匹配标准阶段 | "阶段名不匹配: {name}" |
| 🟡 yellow | 5 | execution.done/closed + ProjectDocument.pending | "已完成阶段文档未提交" |
| 🟡 yellow | 6 | gitlab_url_valid = False | "GitLab 发布链接无效" |
| 🟡 yellow | 7 | gitlab_url IS NULL / "" | "未填写 GitLab 发布链接" |
| 🟡 yellow | 8 | GITLAB_TOKEN 为空 | "GitLab 数据源未配置" |
| 🟡 yellow | 9 | NAS_HOST 为空 | "NAS 数据源未配置" |

### 5.2 告警展示位置

| 位置 | 显示 |
|------|------|
| Dashboard 告警列表 | 按项目过滤，5 行固定高度局部滚动 |
| Dashboard KPI 卡片 | `incomplete_docs_count`（按 yellow severity 去重项目数） |
| 项目详情 - 甘特图 | 超期阶段红色底部边框 (`.gantt-overdue`) |
| 项目详情 - 阶段列表 | 风险列显示告警标记 |

---

## 六、交付记录（Delivery）

`backend/services/project_service.py:154-177`

| 状态 | 条件 |
|------|------|
| `planned` | `DeliveryRecord.actual_delivery_date IS NULL` |
| `actual` | `DeliveryRecord.actual_delivery_date IS NOT NULL`（实际交付日期已填写） |

---

## 七、GitLab 集成

### 7.1 Release URL 校验状态
`backend/models/zentao.py` — `CachedRelease`

| gitlab_url_valid | 含义 |
|-----------------|------|
| `True` | URL 可访问 GitLab API，Release 存在 |
| `False` | URL 无效/404/网络错误 |
| `NULL` | 尚未校验 |

### 7.2 GitLab Release 统计页
前端 `gitlab-releases.js`

| KPI 卡片 | 含义 |
|---------|------|
| 全部发布 | `CachedRelease` 总数 |
| 链接有效 | `gitlab_url_valid = True` |
| 链接无效 | `gitlab_url_valid = False` |
| 未填写 | `gitlab_url IS NULL OR ''` |
| 待校验 | `gitlab_url_valid IS NULL AND gitlab_url IS NOT NULL` |

---

## 八、Bug 统计

无独立状态映射，使用禅道原始状态值：`active` / `resolved` / `closed`

---

## 九、同步状态

### 9.1 SyncLog.status
`backend/models/local.py`

| status | 含义 |
|--------|------|
| `running` | 同步进行中 |
| `success` | 同步成功 |
| `failed` | 同步失败 |

### 9.2 数据源状态标签（顶栏）
`backend/routers/sync.py:119-203`

| 数据源 | 配置条件 | 同步状态来源 |
|--------|---------|------------|
| 禅道 | 始终 configured | SyncLog entity_type="projects" |
| GitLab | GITLAB_TOKEN 非空 | SyncLog entity_type="releases" |
| NAS | NAS_HOST 非空 | pending（未实现同步） |

---

## 十、已知不一致项

| 位置 | 问题 | 严重程度 |
|------|------|---------|
| `_get_category_counts` completed_count | 用 `p.status in ("done","closed")` 原始值，未调用 `_map_status` 三条件判断 | 中 |
| `_project_detail` line 556 | 调用 `_map_status(p.status)` 不传 pending/task/stage 参数 | 高 |
| `dashboard.py:10` `_STATUS_MAP` | 冗余映射表，已被 `_map_status()` 替代，但部分代码仍引用 | 低 |
