/* ═══════════════════════════════════════════════════
   EVENTS — EventBus event-name constants (single source of truth)
   Loaded BEFORE components.js (which defines EventBus).

   Emit:     EventBus.emit(EVENTS.USER_SAVED, { id: 42 })
   Subscribe: EventBus.on(EVENTS.USER_SAVED, function(e) { ... })

   Naming convention: '{entity}:{action}'  (e.g. 'user:saved', 'doc-template:deleted')
   ═══════════════════════════════════════════════════ */
var EVENTS = {
  /* ── Tasks / Bugs / Worklogs / Favorites (existing, kept as-is) ── */
  TASK_SAVED: 'task:saved',
  TASK_DELETED: 'task:deleted',
  TASK_FIELD_CHANGED: 'task:field-changed',
  TASK_BEFORE_SAVE: 'task:before-save',
  BUG_SAVED: 'bug:saved',
  BUG_DELETED: 'bug:deleted',
  BUG_FIELD_CHANGED: 'bug:field-changed',
  BUG_BEFORE_SAVE: 'bug:before-save',
  WORKLOG_SAVED: 'worklog:saved',
  WORKLOG_DELETED: 'worklog:deleted',
  FAV_TOGGLED: 'fav:toggled',

  /* ── Users / Roles / WeCom ── */
  USER_SAVED: 'user:saved',
  USER_DELETED: 'user:deleted',
  ROLE_SAVED: 'role:saved',
  ROLE_DELETED: 'role:deleted',
  WECOM_LINKED: 'wecom:linked',

  /* ── Customers ── */
  CUSTOMER_SAVED: 'customer:saved',
  CUSTOMER_DELETED: 'customer:deleted',

  /* ── Products / Product lines ── */
  PRODUCT_SAVED: 'product:saved',
  PRODUCT_DELETED: 'product:deleted',
  PRODUCT_LINE_SAVED: 'product-line:saved',
  PRODUCT_LINE_DELETED: 'product-line:deleted',

  /* ── Projects ── */
  PROJECT_SAVED: 'project:saved',
  PROJECT_DELETED: 'project:deleted',

  /* ── Standards ── */
  STANDARD_SAVED: 'standard:saved',
  STANDARD_DELETED: 'standard:deleted',

  /* ── DB backups ── */
  BACKUP_SAVED: 'backup:saved',
  BACKUP_DELETED: 'backup:deleted',

  /* ── Settings / data-source config ── */
  SETTING_SAVED: 'setting:saved',

  /* ── Doc templates family ── */
  PROJECT_TYPE_SAVED: 'project-type:saved',
  PROJECT_TYPE_DELETED: 'project-type:deleted',
  STAGE_TYPE_SAVED: 'stage-type:saved',
  STAGE_TYPE_DELETED: 'stage-type:deleted',
  DOC_TEMPLATE_SAVED: 'doc-template:saved',
  DOC_TEMPLATE_DELETED: 'doc-template:deleted',
  TEMPLATE_TAG_SAVED: 'template-tag:saved',
  TEMPLATE_TAG_DELETED: 'template-tag:deleted',
  NAMING_OPTION_SAVED: 'naming-option:saved',
  NAMING_OPTION_DELETED: 'naming-option:deleted',
  BUG_TEMPLATE_SAVED: 'bug-template:saved',
  BUG_TEMPLATE_DELETED: 'bug-template:deleted',

  /* ── Detail-page sub-resources (fine-grained) ── */
  PROJECT_DOC_SAVED: 'project-doc:saved',
  PROJECT_DOC_DELETED: 'project-doc:deleted',
  PRODUCT_DOC_SAVED: 'product-doc:saved',
  PRODUCT_DOC_DELETED: 'product-doc:deleted',
  NOTE_SAVED: 'note:saved',
  NOTE_DELETED: 'note:deleted',
  DELIVERY_SAVED: 'delivery:saved',
  DELIVERY_DELETED: 'delivery:deleted',
  DIAGRAM_SAVED: 'diagram:saved',
  DIAGRAM_DELETED: 'diagram:deleted',
  MAINT_SAVED: 'maint:saved',
  STAGE_SAVED: 'stage:saved',
  STAGE_DELETED: 'stage:deleted',
  PROJECT_BG_SAVED: 'project-bg:saved'
};
