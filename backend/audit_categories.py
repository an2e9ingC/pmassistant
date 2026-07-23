"""Audit log category constants — single source of truth for log_audit() calls."""

AUDIT_CAT_PRODUCT  = "产品"
AUDIT_CAT_PROJECT  = "项目"
AUDIT_CAT_TASK     = "任务"
AUDIT_CAT_BUG      = "Bug"
AUDIT_CAT_USER     = "用户"
AUDIT_CAT_CUSTOMER = "客户"
AUDIT_CAT_TEMPLATE = "模板规范"
AUDIT_CAT_SYSTEM   = "系统"

# NOTE: 后续新增 log_audit() detail 中的英文字段名时必须同步在此增加映射
FIELD_LABEL = {
    # Task fields
    "title": "标题",
    "description": "描述",
    "status": "状态",
    "priority": "优先级",
    "type": "类型",
    "execution_id": "迭代",
    "stage_name": "阶段名称",
    "assignee_id": "负责人",
    "reviewer_id": "审批人",
    "parent_id": "父任务",
    "blocked_by_id": "阻塞任务",
    "start_date": "开始日期",
    "due_date": "截止日期",
    "sort_order": "排序",
    "progress": "进度",
    "estimate_hours": "预估工时",
    # Project fields
    "name": "名称",
    "code": "编号",
    "project_type": "项目类型",
    "customer_name": "客户名称",
    "pm_name": "项目经理",
    "begin": "开始日期",
    "end": "结束日期",
    "real_began": "实际开始",
    "real_end": "实际结束",
    "estimate": "预估工时",
    "consumed": "已消耗工时",
    "program_name": "项目集",
    "planned_delivery_qty": "计划交付数量",
    "delivery_note": "交付备注",
    "background": "项目背景",
    "tags": "标签",
    "linked_project_ids": "关联项目ID",
    "is_local": "是否本地",
    "owner_id": "负责人",
    # Product fields
    "category": "分类",
    "nas_path": "NAS路径",
    "git_url": "Git地址",
    "pma_customer": "PMA客户",
    "alias_name": "别名",
    # Detail key-value patterns
    "project": "项目",
    "product": "产品",
    "doc": "文档",
    "location": "位置",
    "stage": "阶段",
    "content": "内容",
    "note_id": "笔记ID",
    "project_id": "项目ID",
    "doc_name": "文档名称",
    "filename": "文件名",
    "role": "角色",
    "active": "激活",
    "permissions": "权限",
    "wecom_userid": "企微用户ID",
    "matched": "匹配数",
    "created": "创建数",
    "deleted": "删除数",
    "linked_tasks": "关联任务数",
    "products": "产品数",
    "changes": "变更",
    "password_changed": "密码已修改",
}
