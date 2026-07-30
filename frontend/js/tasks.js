/* ═══════════════════════════════════════════════════
   PMA NATIVE TASKS — table/board/calendar views
   ═══════════════════════════════════════════════════ */

var _taskViewMode = 'table';  // 'table' | 'board' | 'calendar'

function _hasProjectEditPerm() {
  if (typeof getCurrentUser !== 'function') return false;
  var user = getCurrentUser();
  var perms = (user && user.permissions) ? user.permissions.split(',') : [];
  return perms.indexOf('project_edit') !== -1 || perms.indexOf('admin') >= 0;
}

function _hasTaskEditPerm() {
  if (typeof getCurrentUser !== 'function') return false;
  var user = getCurrentUser();
  var perms = (user && user.permissions) ? user.permissions.split(',') : [];
  return perms.indexOf('task_edit') !== -1 || perms.indexOf('admin') >= 0;
}

// ── Inline Edit Engine ──

var _STATUS_OPTS = [{v:'todo',l:'待办'},{v:'in_progress',l:'进行中'},{v:'review',l:'评审中'},{v:'done',l:'已完成'},{v:'closed',l:'已关闭'}];
var _PRIORITY_OPTS = [{v:'low',l:'低'},{v:'medium',l:'中'},{v:'high',l:'高'},{v:'critical',l:'紧急'}];

function _buildEditableField(taskId, field, inputType, displayHtml, currentVal, opts, extraAttrs) {
  if (!_hasTaskEditPerm()) return '<span>' + displayHtml + '</span>';
  var optsJson = opts ? encodeURIComponent(JSON.stringify(opts)) : '';
  var attrs = extraAttrs || '';
  if (inputType === 'number') {
    attrs += ' data-min="' + (opts && opts.min !== undefined ? opts.min : '') + '"';
    attrs += ' data-max="' + (opts && opts.max !== undefined ? opts.max : '') + '"';
    attrs += ' data-step="' + (opts && opts.step || '1') + '"';
  }
  return '<div class="editable-field" data-task-id="' + taskId + '" data-field="' + field + '" data-input-type="' + inputType + '" data-current-value="' + escHtml(String(currentVal || '')) + '"' + (optsJson ? ' data-opts="' + optsJson + '"' : '') + attrs + ' onclick="event.stopPropagation();_startInlineEdit(this)">' +
    '<span class="ef-display">' + displayHtml + '</span>' +
  '</div>';
}

function _startInlineEdit(el) {
  if (!_hasTaskEditPerm()) return;
  var field = el.closest('.editable-field') || el;
  if (!field || !field.classList.contains('editable-field') || field.classList.contains('editing')) return;

  var taskId = field.dataset.taskId;
  var fieldName = field.dataset.field;
  var inputType = field.dataset.inputType;
  var currentVal = field.dataset.currentValue || '';
  field._originalHTML = field.innerHTML;
  field.classList.add('editing');

  if (inputType === 'select') {
    var optsJson = field.dataset.opts ? decodeURIComponent(field.dataset.opts) : '[]';
    var opts = JSON.parse(optsJson);
    var html = '<select class="search-inp ef-input" style="width:100%;box-sizing:border-box;font-size:13px;margin-top:1px">';
    opts.forEach(function(o) {
      html += '<option value="' + escHtml(String(o.v)) + '"' + (String(o.v) === String(currentVal) ? ' selected' : '') + '>' + escHtml(o.l) + '</option>';
    });
    html += '</select>';
    html += '<div style="display:flex;gap:10px;margin-top:6px"><button class="btn-xs ef-save-btn" onclick="event.stopPropagation();_saveInlineEdit(this)">✓</button><button class="btn-xs ef-cancel-btn" onclick="event.stopPropagation();_cancelInlineEdit(this)">✕</button></div>';
    field.innerHTML = html;
    var sel = field.querySelector('.ef-input');
    if (sel) { setTimeout(function() { sel.focus(); }, 50); }
  } else if (inputType === 'user-select') {
    if (!window._allUsers || !window._allUsers.length) {
      field.innerHTML = '<span style="font-size:12px;color:var(--muted)">加载用户列表...</span>';
      (typeof loadAllUsers === 'function' ? loadAllUsers() : Promise.resolve()).then(function() {
        _renderUserSelect(field, currentVal);
      });
      return;
    }
    _renderUserSelect(field, currentVal);
  } else if (inputType === 'stage-select') {
    var projId = field.dataset.projectId || '';
    if (!projId) { _cancelInlineEdit(btn); return; }
    field.innerHTML = '<span style="font-size:12px;color:var(--muted)">加载阶段列表...</span>';
    var identifier = field.dataset.projectCode || projId;
    API.get('/projects/' + identifier + '/gantt').then(function(data) {
      var stages = (data && data.stages) ? data.stages : [];
      var opts = stages.map(function(s) {
        return {v: s.name || s.standard_stage || '', l: s.name || s.standard_stage || ''};
      });
      field.dataset.opts = encodeURIComponent(JSON.stringify(opts));
      field.dataset.inputType = 'select';
      _renderSelectField(field, currentVal, opts);
    }).catch(function() { _cancelInlineEdit(btn); });
  } else if (inputType === 'date') {
    field.innerHTML = '<input type="date" class="search-inp ef-input" value="' + escHtml(currentVal) + '" style="width:100%;box-sizing:border-box;font-size:13px;margin-top:1px">' +
      '<div style="display:flex;gap:10px;margin-top:6px"><button class="btn-xs ef-save-btn" onclick="event.stopPropagation();_saveInlineEdit(this)">✓</button><button class="btn-xs ef-cancel-btn" onclick="event.stopPropagation();_cancelInlineEdit(this)">✕</button></div>';
    var inp = field.querySelector('.ef-input');
    if (inp) { setTimeout(function() { inp.focus(); }, 50); }
    if (inp) { inp.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); _saveInlineEdit(inp); } if (e.key === 'Escape') { e.preventDefault(); _cancelInlineEdit(inp); } }); }
  } else if (inputType === 'number') {
    var min = field.dataset.min || '';
    var max = field.dataset.max || '';
    var step = field.dataset.step || '1';
    field.innerHTML = '<input type="number" class="search-inp ef-input" value="' + escHtml(currentVal) + '" min="' + min + '" max="' + max + '" step="' + step + '" style="width:100%;box-sizing:border-box;font-size:13px;margin-top:1px">' +
      '<div style="display:flex;gap:10px;margin-top:6px"><button class="btn-xs ef-save-btn" onclick="event.stopPropagation();_saveInlineEdit(this)">✓</button><button class="btn-xs ef-cancel-btn" onclick="event.stopPropagation();_cancelInlineEdit(this)">✕</button></div>';
    var inp = field.querySelector('.ef-input');
    if (inp) { setTimeout(function() { inp.focus(); inp.select(); }, 50); }
    if (inp) { inp.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); _saveInlineEdit(inp); } if (e.key === 'Escape') { e.preventDefault(); _cancelInlineEdit(inp); } }); }
  } else if (inputType === 'text') {
    field.innerHTML = '<input type="text" class="search-inp ef-input" value="' + escHtml(currentVal) + '" style="width:100%;box-sizing:border-box;font-size:13px;margin-top:1px">' +
      '<div style="display:flex;gap:10px;margin-top:6px"><button class="btn-xs ef-save-btn" onclick="event.stopPropagation();_saveInlineEdit(this)">✓</button><button class="btn-xs ef-cancel-btn" onclick="event.stopPropagation();_cancelInlineEdit(this)">✕</button></div>';
    var inp = field.querySelector('.ef-input');
    if (inp) { setTimeout(function() { inp.focus(); inp.select(); }, 50); }
    if (inp) { inp.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); _saveInlineEdit(inp); } if (e.key === 'Escape') { e.preventDefault(); _cancelInlineEdit(inp); } }); }
  } else if (inputType === 'textarea') {
    field.innerHTML = '<textarea class="search-inp ef-input" rows="4" style="width:100%;box-sizing:border-box;font-size:13px;margin-top:1px;resize:vertical">' + escHtml(currentVal) + '</textarea>' +
      '<div style="display:flex;gap:10px;margin-top:6px"><button class="btn-xs ef-save-btn" onclick="event.stopPropagation();_saveInlineEdit(this)">✓</button><button class="btn-xs ef-cancel-btn" onclick="event.stopPropagation();_cancelInlineEdit(this)">✕</button></div>';
    var inp = field.querySelector('.ef-input');
    if (inp) { setTimeout(function() { inp.focus(); }, 50); }
  }
}

function _renderSelectField(field, currentVal, opts) {
  field.classList.add('editing');
  var html = '<select class="search-inp ef-input" style="width:100%;box-sizing:border-box;font-size:13px;margin-top:1px">';
  opts.forEach(function(o) {
    html += '<option value="' + escHtml(String(o.v)) + '"' + (String(o.v) === String(currentVal) ? ' selected' : '') + '>' + escHtml(o.l) + '</option>';
  });
  html += '</select>';
  html += '<div style="display:flex;gap:10px;margin-top:6px"><button class="btn-xs ef-save-btn" onclick="event.stopPropagation();_saveInlineEdit(this)">✓</button><button class="btn-xs ef-cancel-btn" onclick="event.stopPropagation();_cancelInlineEdit(this)">✕</button></div>';
  field.innerHTML = html;
  var sel = field.querySelector('.ef-input');
  if (sel) { setTimeout(function() { sel.focus(); }, 50); }
}

function _renderUserSelect(field, currentVal) {
  var users = window._allUsers || [];
  var opts = users.map(function(u) { return {v: u.id, l: u.display_name || u.name || u.username}; });
  opts.unshift({v: '', l: '— 未分配 —'});
  field.dataset.opts = encodeURIComponent(JSON.stringify(opts));
  field.dataset.inputType = 'select';
  _renderSelectField(field, currentVal, opts);
}

function _saveInlineEdit(el) {
  var field = el.closest('.editable-field');
  if (!field) return;
  var taskId = field.dataset.taskId;
  var fieldName = field.dataset.field;
  var inputType = field.dataset.inputType;
  var input = field.querySelector('.ef-input');
  if (!input) return;
  var newVal = input.value;
  var currentVal = field.dataset.currentValue || '';

  if (newVal === currentVal && inputType !== 'textarea') {
    _cancelInlineEdit(el);
    return;
  }

  var data = {};
  if (inputType === 'number') {
    data[fieldName] = newVal === '' ? null : (parseInt(newVal) || 0);
  } else if (fieldName === 'assignee_id' || fieldName === 'reviewer_id') {
    data[fieldName] = newVal === '' ? null : parseInt(newVal);
  } else if (fieldName === 'estimate_hours') {
    data[fieldName] = newVal === '' ? null : (parseFloat(newVal) || 0);
  } else if (fieldName === 'start_date' || fieldName === 'due_date') {
    data[fieldName] = newVal || null;
  } else if (fieldName === 'execution_id') {
    data[fieldName] = parseInt(newVal) || null;
    data.stage_name = newVal && newVal.startsWith && newVal.startsWith('_') ? newVal.slice(1) : null;
  } else if (fieldName === 'stage_name') {
    var selId = field.dataset.executionId || '';
    if (selId && selId.startsWith('_')) {
      data.execution_id = null;
      data.stage_name = newVal;
    }
    data[fieldName] = newVal;
  } else {
    data[fieldName] = newVal;
  }

  // Bidirectional sync: progress <-> status
  if (fieldName === 'progress' || fieldName === 'status') {
    var progressEl = document.querySelector('.editable-field[data-field="progress"]');
    var statusEl = document.querySelector('.editable-field[data-field="status"]');
    var progress = fieldName === 'progress' ? parseInt(newVal) || 0 : parseInt(progressEl ? progressEl.dataset.currentValue : 0) || 0;
    var status = fieldName === 'status' ? newVal : (statusEl ? statusEl.dataset.currentValue : 'todo');
    if (progress >= 100 && status !== 'review' && status !== 'done') {
      status = window._approvalEnabled ? 'review' : 'done';
      data.status = status;
    }
    if (status === 'done' && progress < 100) {
      progress = 100;
      data.progress = 100;
    }
    if (progress >= 100 && status === 'review' && fieldName === 'progress') {
      var titleEl = document.querySelector('.note-dialog-title');
      var taskTitle = titleEl ? titleEl.textContent : '';
      _pendingConfirmField = { el: field, taskId: taskId, data: data, taskTitle: taskTitle };
      openDialog('确认提交评审',
        '<div style="font-size:13px;margin-bottom:8px">进度 <b>100%</b>，任务将进入<b>评审中</b>状态，等待审批人确认。</div>' +
        '<div style="font-size:11px;color:var(--muted)">任务: ' + escHtml(taskTitle) + '</div>',
        [
          {text: '取消', onclick: "var d=document.querySelector('.shared-dialog-overlay');if(d)d.remove();_pendingConfirmField=null;"},
          {text: '确认', cls: 'btn-primary', onclick: "_confirmSaveField()"},
        ],
        {hideClose: true}
      );
      return;
    }
  }

  _doSaveFieldEdit(taskId, data, field);
}

var _pendingConfirmField = null;
function _confirmSaveField() {
  var d = document.querySelector('.shared-dialog-overlay'); if (d) d.remove();
  if (!_pendingConfirmField) return;
  var p = _pendingConfirmField;
  _pendingConfirmField = null;
  _doSaveFieldEdit(p.taskId, p.data, p.el);
}

function _doSaveFieldEdit(taskId, data, field) {
  field.style.opacity = '0.6';
  API.put('/tasks/' + taskId, data).then(function(res) {
    field.style.opacity = '';
    showToast('已更新', 'success');
    if (res && res.auto_messages && res.auto_messages.length) {
      res.auto_messages.forEach(function(msg) { showToast(msg, 'success'); });
    }
    var body = document.querySelector('.task-detail-body');
    if (body) {
      // Re-fetch and re-render
      API.get('/tasks/' + taskId).then(function(data) {
        body.innerHTML = _renderTaskDetailBody(data);
        _refreshTaskWorklogs(taskId);
        _loadDetailComments(taskId);
        setTimeout(function() {
          initNoteImagePaste('ef-desc');
        }, 100);
      }).catch(function() {});
    }
    if (typeof loadTaskData === 'function') { loadTaskData(); }
  }).catch(function(e) {
    field.style.opacity = '';
    showToast('保存失败: ' + (e.message || '未知错误'), 'error');
    _cancelInlineEdit(field);
  });
}

function _cancelInlineEdit(el) {
  var field = el.closest('.editable-field');
  if (!field) return;
  if (field._originalHTML) {
    field.innerHTML = field._originalHTML;
  }
  field.classList.remove('editing');
}

function _loadDetailComments(taskId) {
  API.get('/task-comments?task_id=' + taskId).then(function(comments) {
    var el = document.querySelector('.task-detail-comments');
    if (!el) return;
    if (!comments || !comments.length) { el.innerHTML = '<div style="color:var(--muted);font-size:12px">暂无评论</div>'; return; }
    el.innerHTML = '<div id="task-comments-table"></div>';
    new DataTable({
      container: document.getElementById('task-comments-table'),
      columns: [
        { key: 'created_at', title: '时间', width: '130px', render: function(v) { return '<span style="font-size:10px;color:var(--muted);white-space:nowrap">'+(fmtISODateTime(v)||'')+'</span>'; } },
        { key: 'display_name', title: '用户', width: '80px', render: function(v, row) { return '<span style="font-size:12px">'+escHtml(v||row.username)+'</span>'; } },
        { key: 'content', title: '内容', align: 'left', render: function(v) { return '<span style="font-size:13px">'+escHtml(v||'')+'</span>'; } }
      ],
      data: comments,
      resizable: false
    });
  }).catch(function() {});
}

function _submitDetailComment(taskId) {
  var input = document.querySelector('.task-detail-comment-input');
  if (!input || !input.value.trim()) return;
  API.post('/task-comments', {task_id: taskId, content: input.value.trim()}).then(function() {
    input.value = '';
    _loadDetailComments(taskId);
  }).catch(function(e) { showToast('评论失败: ' + (e.message || ''), 'error'); });
}

var _taskProjectId = null;   // null = show project selector
var _taskProjectCode = null;  // project code (e.g. PE0450) for API calls
var _taskProjectName = '';
var _taskFilterStatus = '';
var _taskFilterExecution = '';
var _taskFilterAssignee = '';
var _taskFilterStage = '';    // stage_name filter (set from Gantt click)

/* ── Entry Point ── */

function initTasks() {
  _taskProjectId = null;
  _taskFilterStatus = '';
  _taskFilterExecution = '';
  _taskFilterAssignee = 'me';  // default: show current user's tasks
  _calChangeCallback = loadTaskData;
  renderTasksPage();
}

function initProjectTasks(projectId, projectName) {
  // Called from project detail tab — no project selector
  // projectId is the project code (e.g. IT0001), also used as code
  _taskProjectId = projectId;
  _taskProjectCode = projectId;
  _taskProjectName = projectName || '';
  _taskFilterStatus = '';
  _taskFilterExecution = '';
  _taskFilterAssignee = '';
  window._ganttStageFilter = '';  // consume once
  renderTasksPage();
}

/* ── Page Layout ── */

function _taskContainer() {
  // When called from project detail tab, render into the detail section; otherwise full-page view
  if (_taskProjectId) {
    var c = document.getElementById('pma-tasks-content');
    if (c) return c;
  }
  return document.getElementById('view-tasks');
}

function renderTasksPage() {
  var container = _taskContainer();
  if (!container) return;

  var isEmbedded = !!_taskProjectId;
  var showToolbar = !isEmbedded; // full toolbar only in standalone view

  // Standalone filter toolbar row
  var filterRow = '';
  if (showToolbar) {
    filterRow = '<div style="display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid var(--border);flex-wrap:wrap">' +
      _renderTaskFiltersInline() +
    '</div>';
  }

  var html = '<div style="display:flex;flex-direction:column;height:100%">' +
    (showToolbar ? '<div class="section-hd" style="display:flex;align-items:center;justify-content:space-between;padding:10px 16px;border-bottom:1px solid var(--border)">' +
      '<div style="display:flex;align-items:center;gap:12px">' +
        '<span style="font-weight:600;font-size:15px">任务管理</span>' +
        '<span style="display:flex;gap:4px">' +
          '<button class="btn-sm" id="task-view-table" onclick="switchTaskView(\'table\')" style="background:var(--accent);color:#fff">列表</button>' +
        '</span>' +
      '</div>' +
      '<div style="display:flex;gap:8px">' +
        '<button class="btn btn-primary" style="font-size:11px;padding:3px 10px" onclick="openBatchCreateDialog()" title="批量创建">+批量</button>' +
        '<button class="btn-sm" onclick="openImportTasksDialog()" title="从其他项目导入">导入</button>' +
        '<button class="btn btn-primary" style="font-size:11px;padding:3px 10px" onclick="openTaskDialog()">+ 新建任务</button>' +
      '</div>' +
    '</div>' + filterRow : '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 16px;border-bottom:1px solid var(--border)">' +
      '<span style="font-weight:600;font-size:13px">任务列表</span>' +
      '<div style="display:flex;gap:8px">' +
        (_hasProjectEditPerm() ?
        '<button class="btn" onclick="initProjectStages()" style="font-size:12px;padding:5px 14px;color:var(--success);border-color:var(--success)" title="为项目初始化阶段数据（已有阶段则跳过）">⚙ 初始化阶段</button>' +
        '<button class="btn" onclick="importTasksFromTemplates()" style="font-size:12px;padding:5px 14px;color:var(--accent);border-color:var(--accent)" title="按项目模板为所有阶段创建任务">📋 导入模板任务</button>' +
        '<button class="btn" onclick="clearAllTasks()" style="font-size:12px;padding:5px 14px;color:var(--danger);border-color:var(--danger)" title="删除本项目所有PMA任务">🗑 清空所有任务</button>' : '') +
        '<button class="btn" onclick="openBatchCreateDialog()" style="font-size:12px;padding:5px 14px;color:var(--success);border-color:var(--success)" title="批量创建任务">📝 批量创建</button>' +
        '<button class="btn btn-primary" onclick="openTaskDialog()" style="font-size:12px;padding:5px 14px">＋ 新建任务</button>' +
      '</div>' +
    '</div>') +
    '<div id="task-content" style="flex:1;overflow:hidden;padding:16px">加载中...</div>' +
  '</div>';

  container.innerHTML = html;
  switchTaskView(_taskViewMode);
}

function _renderTaskFiltersInline() {
  var html = '';
  // Project selector
  html += '<span style="font-size:11px;color:var(--muted);white-space:nowrap">项目</span>' +
    createProjectCombo({
      comboId: 'task-proj-combo',
      inputId: 'task-proj-input',
      dropdownId: 'task-proj-dropdown',
      onSelect: function(p) { _taskProjectId = p.id; _taskProjectCode = p.code; _taskProjectName = p.name; loadTaskData(); }
    }) + '<style>#task-proj-combo{min-width:0!important;width:160px}</style>';
  // Stage filter
  html += '<span style="font-size:11px;color:var(--muted);white-space:nowrap;margin-left:4px">阶段</span>' +
    '<select class="search-inp" id="task-exec-filter" onchange="_taskFilterExecution=this.value;loadTaskData()" style="width:120px">' +
      '<option value="">全部阶段</option></select>';
  // Status filter
  html += '<span style="font-size:11px;color:var(--muted);white-space:nowrap;margin-left:4px">状态</span>' +
    '<select class="search-inp" id="task-status-filter" onchange="_taskFilterStatus=this.value;loadTaskData()" style="width:100px">' +
      '<option value="">全部状态</option>' +
      '<option value="todo">待办</option>' +
      '<option value="in_progress">进行中</option>' +
      '<option value="review">评审中</option>' +
      '<option value="done">已完成</option>' +
      '<option value="closed">已关闭</option></select>';
  // Assignee filter
  html += '<span style="font-size:11px;color:var(--muted);white-space:nowrap;margin-left:4px">负责人</span>' +
    '<select class="search-inp" id="task-assignee-filter" onchange="_taskFilterAssignee=this.value;loadTaskData()" style="width:100px">' +
      '<option value="">全部</option>' +
      '<option value="me"' + (_taskFilterAssignee==='me'?' selected':'') + '>我负责的</option></select>';
  return html;
}

function _renderTaskFilters() {
  var projectSel = '';
  if (_taskProjectId) {
    var name = _taskProjectName || '项目 #' + _taskProjectId;
    projectSel = '<div style="font-size:12px;color:var(--muted);margin-bottom:4px">当前项目</div>' +
      '<div style="font-weight:600;margin-bottom:16px">' + escHtml(name) + '</div>';
  } else {
    projectSel = '<div style="margin-bottom:16px">' +
      '<label style="font-size:11px;color:var(--muted)">项目</label>' +
      createProjectCombo({
        comboId: 'task-proj-combo',
        inputId: 'task-proj-input',
        dropdownId: 'task-proj-dropdown',
        onSelect: function(p) { _taskProjectId = p.id; _taskProjectCode = p.code; _taskProjectName = p.name; loadTaskData(); }
      }) + '<style>#task-proj-combo{min-width:0!important}</style>' +
    '</div>';
  }

  return projectSel +
    '<div style="margin-bottom:16px">' +
      '<label style="font-size:11px;color:var(--muted)">阶段</label>' +
      '<select class="search-inp" id="task-exec-filter" onchange="_taskFilterExecution=this.value;loadTaskData()" style="width:100%;margin-top:4px">' +
        '<option value="">全部阶段</option></select>' +
    '</div>' +
    '<div style="margin-bottom:16px">' +
      '<label style="font-size:11px;color:var(--muted)">状态</label>' +
      '<select class="search-inp" id="task-status-filter" onchange="_taskFilterStatus=this.value;loadTaskData()" style="width:100%;margin-top:4px">' +
        '<option value="">全部状态</option>' +
        '<option value="todo">待办</option>' +
        '<option value="in_progress">进行中</option>' +
        '<option value="review">评审中</option>' +
        '<option value="done">已完成</option>' +
        '<option value="closed">已关闭</option></select>' +
    '</div>' +
    '<div style="margin-bottom:16px">' +
      '<label style="font-size:11px;color:var(--muted)">负责人</label>' +
      '<select class="search-inp" id="task-assignee-filter" onchange="_taskFilterAssignee=this.value;loadTaskData()" style="width:100%;margin-top:4px">' +
        '<option value="">全部</option>' +
        '<option value="me"' + (_taskFilterAssignee==='me'?' selected':'') + '>我负责的</option></select>' +
    '</div>';
}

/* ── View Switching ── */

function switchTaskView(mode) {
  _taskViewMode = mode;
  ['table','board'].forEach(function(m) {
    var btn = document.getElementById('task-view-' + m);
    if (btn) { btn.style.background = m === mode ? 'var(--accent)' : ''; btn.style.color = m === mode ? '#fff' : ''; }
  });
  loadTaskData();
}

/* ── Data Loading ── */

async function loadTaskData() {
  var container = _taskContainer();
  if (!container) return;
  var content = container.querySelector('#task-content') || container.querySelector('#pma-tasks-content') || container;
  content.innerHTML = '<div class="loading-spinner">加载中...</div>';

  try {
    var projId = _taskProjectId;

    var params = [];
    if (projId) params.push('project_id=' + projId);
    if (_taskFilterStatus) params.push('status=' + _taskFilterStatus);
    if (_taskFilterExecution) params.push('execution_id=' + _taskFilterExecution);
    var assigneeId = '';
    if (_taskFilterAssignee === 'me') {
      var user = getCurrentUser();
      if (user) assigneeId = 'assignee_id=' + user.id;
    }
    if (assigneeId) params.push(assigneeId);
    var qs = params.length ? '?' + params.join('&') : '';

    var data = await API.get('/tasks' + qs);

    // Load executions for stage grouping
    var execs = [];
    if (projId) {
      try {
        var execRes = await API.get('/projects/' + projId + '/gantt');
        execs = (execRes && execRes.stages) ? execRes.stages : [];
      } catch(e) { /* gantt endpoint may fail for local projects */ }
    }

    // Populate filter dropdowns
    populateTaskFilters(data || [], execs);

    if (_taskViewMode === 'table') renderTaskTable(data || [], execs);
    else renderTaskCalendar(); // combined board + calendar view

  } catch(e) {
    content.innerHTML = '<div class="error-state">加载失败: ' + escHtml(e.message || '未知错误') + '</div>';
  }
}

function populateTaskFilters(tasks, execs) {
  // Execution filter
  var execSel = document.getElementById('task-exec-filter');
  if (execSel && execSel.options.length <= 1 && execs.length) {
    execs.forEach(function(s) {
      var opt = document.createElement('option');
      opt.value = s.execution_id || '';
      opt.textContent = s.name || s.standard_stage || '';
      execSel.appendChild(opt);
    });
  }
}

/* ── Table View ── */

function renderTaskTable(tasks, execs) {
  var content = _taskContainer();
  if (!content) return;
  content = content.querySelector('#task-content') || content.querySelector('#pma-tasks-content') || content;

  if (!tasks || !tasks.length) {
    var emptyMsg = _taskProjectId ? '暂无任务，点击 "导入模板任务" 从模板创建，或者单独、批量创建其他任务' : '暂无任务，点击右上角 "新建任务" 开始';
    content.innerHTML = '<div class="empty-state" style="text-align:center;padding:40px">' + emptyMsg + '</div>';
    return;
  }

  // Embedded view (project detail): stage-grouped compact table
  if (_taskProjectId) {
    renderTaskTableCompact(tasks, execs);
    return;
  }

  // Standalone view: full table with project info
  var stageMap = {};
  if (execs) {
    execs.forEach(function(s) {
      stageMap[s.execution_id || s.id || ''] = s.name || s.standard_stage || '未分类';
    });
  }

  _selectedTasks = new Set();
  content.innerHTML = '<div id="task-full-table"></div>';
  var dt = new DataTable({
    container: document.getElementById('task-full-table'),
    columns: [
      { key: 'id', title: '任务编号', width: '7%', render: function(v) { return '<span style="font-size:11px;font-family:var(--mono);color:var(--muted)">#' + v + '</span>'; } },
      { key: 'project_code', title: '项目编号', width: '8%', render: function(v, row) { return v ? projCodeTag(v, 'openProject(\''+escHtml(v).replace(/'/g,"\\'")+'\')', row.project_name) : '-'; } },
      { key: 'project_name', title: '项目名称', width: '10%', align: 'left', render: function(v) { return '<span style="font-size:12px">'+escHtml(v||'-')+'</span>'; } },
      { key: 'title', title: '标题', align: 'left', className: 'dt-wrap', render: function(v, row) { return '<a href="javascript:void(0)" onclick="openTaskDetail('+row.id+')" style="color:var(--accent)">'+escHtml(v||'')+'</a>'; } },
      { key: 'stage_name', title: '阶段', width: '9%', render: function(v) { return v ? '<span style="font-size:11px;color:var(--muted)">'+escHtml(v)+'</span>' : '-'; } },
      { key: 'status', title: '状态', width: '6%', render: function(v, row) {
        var h = renderPill(v||'todo');
        if (window._approvalEnabled) h = '<span style="cursor:pointer" onclick="event.stopPropagation();openReviewerDialog('+row.id+')" title="'+(row.reviewer_name?'审批人: '+escHtml(row.reviewer_name)+' — 点击修改':'点击设置审批人')+'">'+h+'</span>';
        return h;
      }},
      { key: 'priority', title: '优先级', width: '5%', render: function(v) { return _renderPriority(v); } },
      { key: 'progress', title: '进度', width: '6%', render: function(v) { return renderProgressCircle(v||0, 26, {label:''}); } },
      { key: 'due_date', title: '截止日期', width: '6%', render: function(v, row) { return '<span style="color:'+(v&&row.status!=='done'&&row.status!=='closed'&&v<fmtLocalDate()?'var(--danger)':'')+'">'+(v||'-')+'</span>'; } },
      { key: 'actions', title: '操作', render: function(v, row) { return iconEdit('openTaskDialog('+row.id+')','编辑任务')+iconCopy('openCopyTaskDialog('+row.id+')','复制任务')+iconDelete('deleteTask('+row.id+',\''+escJs(row.title)+'\')','删除任务'); } }
    ],
    data: tasks,
    maxHeight: 'calc(100vh - 220px)',
    resizable: false,
    selectable: true,
    checkboxPosition: 3,
    onSelectChange: function(rows) {
      _selectedTasks = new Set(rows.map(function(r) { return r.id; }));
      _ensureBatchToolbar();
    }
  });
  // Wire up existing select-all / checkbox handlers for batch toolbar compat
  window._taskFullDt = dt;
  _ensureBatchToolbar();
}

function renderTaskTableCompact(tasks, execs) {
  var content = _taskContainer();
  if (!content) return;
  content = content.querySelector('#task-content') || content.querySelector('#pma-tasks-content') || content;

  // Build ordered stage list from gantt data (ensures all template stages appear)
  var allStages = [];
  if (execs && execs.length) {
    execs.forEach(function(s) { allStages.push(s.standard_stage || s.name); });
  }
  // Fallback: derive from tasks
  if (!allStages.length) {
    tasks.forEach(function(t) { var sn = t.stage_name; if (sn && allStages.indexOf(sn) < 0) allStages.push(sn); });
  }

  // Group tasks by stage_name and build stage→start map
  var grouped = {};
  var stageStartMap = {};  // stage_name → estimated start date
  allStages.forEach(function(sn) { grouped[sn] = []; });
  tasks.forEach(function(t) {
    var sn = t.stage_name || '未分类';
    if (!grouped[sn]) grouped[sn] = [];
    grouped[sn].push(t);
  });
  // Build stage name → stage id map for clickable stage cells
  var stageIdMap = {};
  if (execs && execs.length) {
    execs.forEach(function(s) {
      var sn = s.standard_stage || s.name;
      if (s.start) stageStartMap[sn] = s.start;
      if (s.id) stageIdMap[sn] = s.id;
    });
  }
  var stageKeys = allStages.filter(function(sn) { return grouped[sn] !== undefined; });

  // Flatten into DataTable rows
  var flatRows = [];
  stageKeys.forEach(function(stageName) {
    var stageTasks = grouped[stageName] || [];
    if (!stageTasks.length) {
      flatRows.push({ _stage: stageName, _empty: true, id: 0 });
    } else {
      stageTasks.forEach(function(t, i) {
        t._stage = stageName;
        t._stageId = stageIdMap[stageName] || null;
        t._stageCount = stageTasks.length;
        t._isFirstInStage = i === 0;
        t._stageStart = stageStartMap[stageName] || null;
        flatRows.push(t);
      });
    }
  });

  _selectedTasks = new Set();
  content.innerHTML = '<div id="task-compact-table"></div>';
  new DataTable({
    container: document.getElementById('task-compact-table'),
    columns: [
      { key: '_stage', title: '阶段', width: '10%', rowspan: true, render: function(v, row, idx, count) {
        if (row._empty) return escHtml(v||'');
        var stageId = row._stageId;
        var cell = stageId
          ? '<button class="gs-btn" onclick="openStageDialog(' + stageId + ');event.stopPropagation()" title="查看/编辑阶段信息">' + escHtml(v||'') + '</button>'
          : escHtml(v||'');
        return '<div>' + cell + ' <sup style="font-size:9px;color:var(--accent);background:var(--accent-lt);padding:1px 4px;border-radius:8px">' + (count||row._stageCount||1) + '</sup></div>';
      }},
      { key: 'title', title: '任务标题', align: 'left', className: 'dt-wrap', render: function(v, row) { return row._empty?'—':'<span style="cursor:pointer" onclick="openTaskDetail('+row.id+')" title="查看任务详情">'+escHtml(v||'')+'</span>'; } },
      { key: 'status', title: '状态', width: '6%', render: function(v, row) { return row._empty?'—':renderPill(v||'todo'); } },
      { key: 'priority', title: '优先级', width: '5%', render: function(v, row) { return row._empty?'—':(typeof _renderPriority==='function'?_renderPriority(v):escHtml(v||'medium')); } },
      { key: 'assignee_name', title: '负责人', width: '7%', render: function(v, row) { return row._empty?'—':'<span style="font-size:12px;cursor:pointer;color:var(--accent)" onclick="event.stopPropagation();openAssignDialog('+row.id+')" title="指派任务">'+escHtml(v||'—')+'</span>'; } },
      { key: 'progress', title: '进度', width: '7%', render: function(v, row) { return row._empty?'—':(typeof renderProgressRing==='function'?'<div style="display:inline-block;vertical-align:middle">'+renderProgressRing(v||0)+'</div>':'<span>'+(v||0)+'%</span>'); } },
      { key: 'start_date', title: '计划开始', width: '7%', render: function(v, row) {
        if (row._empty) return '—';
        var s = v || row._stageStart || null;
        return '<span style="font-size:12px;color:'+(s?'var(--fg)':'var(--muted)')+'" title="'+(s?escHtml(s):'默认取阶段开始时间')+'">'+escHtml(s||'—')+'</span>';
      }},
      { key: 'due_date', title: '截止日期', width: '7%', render: function(v, row) { return row._empty?'—':'<span style="font-size:12px">'+(v||'—')+'</span>'; } },
      { key: 'completed_at', title: '完成日期', width: '7%', render: function(v, row) { return row._empty?'—':'<span style="font-size:12px">'+(v?formatDate(v):'—')+'</span>'; } },
      { key: 'latest_activity', title: '最新动态', width: '10%', render: function(v, row) { return row._empty?'—':(typeof _renderLatestActivity==='function'?_renderLatestActivity(row):'<span style="font-size:11px;color:var(--muted)">—</span>'); } },
      { key: 'latest_time', title: '时间', width: '6%', render: function(v, row) { return row._empty?'—':''; } },
      { key: 'actions', title: '操作', render: function(v, row) { return row._empty?'<span style="color:var(--muted);font-size:12px">—</span>':'<span style="white-space:nowrap" onclick="event.stopPropagation()">'+iconEdit('openTaskDialog('+row.id+')')+iconDelete('deleteTask('+row.id+',\''+escJs(row.title)+'\')')+'</span>'; } }
    ],
    data: flatRows,
    maxHeight: 'calc(100vh - 340px)',
    resizable: false,
    selectable: true,
    checkboxPosition: 11,
    onSelectChange: function(rows) { _selectedTasks = new Set(rows.map(function(r) { return r.id; })); _ensureBatchToolbar(); }
  });
  _ensureBatchToolbar();
  _ensureBatchToolbar();

  // Group hover: hovering the stage-name cell highlights all rows of that stage
  var tbody = content.querySelector('.stage-table tbody');
  if (tbody) {
    // Hover on the stage-name cell (rowspan td) → highlight all sibling rows
    tbody.addEventListener('mouseenter', function(e) {
      var cell = e.target.closest('td[data-stage-cell]');
      if (!cell) return;
      var stage = cell.getAttribute('data-stage-cell');
      if (!stage) return;
      var allRows = tbody.querySelectorAll('.task-stage-row[data-stage="' + CSS.escape(stage) + '"]');
      allRows.forEach(function(r) { r.classList.add('stage-hover'); });
    }, true);
    tbody.addEventListener('mouseleave', function(e) {
      var cell = e.target.closest('td[data-stage-cell]');
      if (!cell) return;
      var stage = cell.getAttribute('data-stage-cell');
      if (!stage) return;
      var allRows = tbody.querySelectorAll('.task-stage-row[data-stage="' + CSS.escape(stage) + '"]');
      allRows.forEach(function(r) { r.classList.remove('stage-hover'); });
    }, true);
    // Individual row hover (already covered by CSS tr:hover, but remove group highlight on non-stage cells)
    tbody.addEventListener('mouseenter', function(e) {
      var row = e.target.closest('.task-stage-row');
      if (!row) return;
      // If not entering via the stage cell, ensure only this row shows hover via CSS
      var cell = e.target.closest('td[data-stage-cell]');
      if (!cell) {
        // Clear any stale group highlights
        tbody.querySelectorAll('.task-stage-row.stage-hover').forEach(function(r) { r.classList.remove('stage-hover'); });
        row.classList.add('row-hover');
      }
    }, true);
    tbody.addEventListener('mouseleave', function(e) {
      var row = e.target.closest('.task-stage-row');
      if (!row) return;
      var cell = e.target.closest('td[data-stage-cell]');
      if (!cell) {
        row.classList.remove('row-hover');
      }
    }, true);
  }
}

function _renderLatestActivity(t) {
  var act = t.latest_activity;
  if (!act || !act.content) return '<td style="font-size:11px;color:var(--muted)">—</td><td style="font-size:11px;color:var(--muted)">—</td>';
  var user = act.username || '?';
  var fullContent = '@' + user + ': ' + act.content;
  var text = fullContent.length > 40 ? fullContent.substring(0, 40) + '...' : fullContent;
  var time = act.created_at ? fmtISODateTime(act.created_at) : '';
  return '<td style="font-size:11px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left" title="' + escHtml(fullContent) + '">' +
    '<span style="color:var(--fg)">' + escHtml(text) + '</span>' +
    '</td>' +
    '<td style="font-size:11px;color:var(--muted);white-space:nowrap" title="' + escHtml(time) + '">' + escHtml(time) + '</td>';
}

function _renderTaskRowCompact(t, stageStart) {
  var progressHtml = typeof renderProgressRing === 'function'
    ? '<div style="display:inline-block;vertical-align:middle">' + renderProgressRing(t.progress || 0) + '</div>'
    : '<span>' + (t.progress || 0) + '%</span>';
  var assigneeName = t.assignee_name || t.assignee_username || '—';
  var effectiveStart = t.start_date || stageStart || null;
  var startDateStr = effectiveStart || '—';
  var startTitle = effectiveStart ? escHtml(effectiveStart) : (stageStart ? '默认取阶段开始时间' : '未设置');
  return '<td style="text-align:left;cursor:pointer" onclick="openTaskDetail(' + t.id + ')" title="查看任务详情">' + escHtml(t.title) + '</td>' +
    '<td style="text-align:center' + (window._approvalEnabled ? ';cursor:pointer' : '') + '"' + (window._approvalEnabled ? ' onclick="event.stopPropagation();openReviewerDialog(' + t.id + ')" title="' + (t.status === 'review' && t.reviewer_name ? '审批人: ' + escHtml(t.reviewer_name) + ' — 点击修改' : '点击修改审批人') + '"' : '') + '>' + renderPill(t.status || 'todo') + '</td>' +
    '<td style="text-align:center">' + (typeof renderPriority === 'function' ? renderPriority(t.priority) : escHtml(t.priority || 'medium')) + '</td>' +
    '<td style="font-size:12px;cursor:pointer;color:var(--accent)" onclick="event.stopPropagation();openAssignDialog(' + t.id + ')" title="指派任务">' + escHtml(assigneeName) + '</td>' +
    '<td style="text-align:center">' + progressHtml + '</td>' +
    '<td style="font-size:12px;color:' + (t.start_date ? 'var(--fg)' : 'var(--muted)') + '" title="' + startTitle + '">' + escHtml(startDateStr) + '</td>' +
    '<td style="font-size:12px">' + (t.due_date ? t.due_date : '—') + '</td>' +
    '<td style="font-size:12px">' + (t.completed_at ? formatDate(t.completed_at) : '—') + '</td>' +
    _renderLatestActivity(t) +
    '<td style="text-align:center;width:22px" onclick="event.stopPropagation();if(event.target!==this.firstElementChild){var cb=this.firstElementChild;if(cb){cb.checked=!cb.checked;cb.onchange()}}"><input type="checkbox" value="' + t.id + '" onchange="_onTaskCheckbox(this)" class="task-checkbox"></td>' +
    '<td style="white-space:nowrap" onclick="event.stopPropagation()">' + iconEdit('openTaskDialog(' + t.id + ')') + iconDelete('deleteTask(' + t.id + ',\'' + escJs(t.title) + '\')') + '</td>';
}

/* ── Import / Clear Tasks ── */

function importTasksFromTemplates() {
  if (!_taskProjectId) { showToast('请先选择项目', 'error'); return; }
  var projLabel = _taskProjectName || _taskProjectId;
  openDialog('导入模板任务',
    '<div class="confirm-dlg">将按项目模板为 <b>' + escHtml(projLabel) + '</b> 的所有阶段创建任务。<br><br>已有任务不会重复创建。</div>',
    [{text: '取消', onclick: 'closeSharedDialog()'},
     {text: '确定导入', cls: 'btn-primary', onclick: 'closeSharedDialog();doImportTasksFromTemplates()'}],
    {hideClose: true});
}
function doImportTasksFromTemplates() {
  API.post('/tasks/import-from-templates?project_id=' + encodeURIComponent(_taskProjectId), {}).then(function(data) {
    showToast(data.message || '导入完成', 'success');
    loadTaskData();
  }).catch(function(e) { showToast('导入失败: ' + (e.message || ''), 'error'); });
}

async function clearAllTasks() {
  if (!_taskProjectId) { showToast('请先选择项目', 'error'); return; }
  var projLabel = _taskProjectName || _taskProjectId;
  openDialog('清空所有任务',
    '<div class="confirm-dlg">将删除 <b>' + escHtml(projLabel) + '</b> 的 <b style="color:var(--danger)">所有任务</b>。<br><br>此操作不可撤销！</div>',
    [{text: '取消', onclick: 'closeSharedDialog()'},
     {text: '确认清空', cls: 'btn-danger', onclick: 'closeSharedDialog();doClearAllTasks()'}],
    {hideClose: true});
}
async function doClearAllTasks() {
  var projLabel = _taskProjectName || _taskProjectId;
  var ok = await verifyPassword('清空项目任务: ' + projLabel, 'pw_verify_clear_tasks');
  if (!ok) return;
  try {
    var data = await API.del('/tasks?project_id=' + encodeURIComponent(_taskProjectId));
    showToast(data.message || '已清空', 'success');
    loadTaskData();
  } catch(e) { showToast('清空失败: ' + (e.message || ''), 'error'); }
}

/* ── Stage Management ── */

async function initProjectStages() {
  if (!_taskProjectId) { showToast('请先选择项目', 'error'); return; }
  try {
    var data = await API.post('/tasks/init-stages?project_id=' + encodeURIComponent(_taskProjectId), {});
    if (data.existed) {
      showToast('已有 ' + data.existed + ' 个阶段，无需初始化', 'info');
    } else {
      showToast('已创建 ' + data.created + ' 个阶段', 'success');
    }
    loadTaskData();
  } catch(e) { showToast('初始化失败: ' + (e.message || ''), 'error'); }
}

function _renderTaskRow(t, stageMap) {
  var stageName = t.stage_name || t.execution_name || '';
  var progressPct = t.progress || 0;
  var overdue = t.due_date && t.status !== 'done' && t.status !== 'closed' && t.due_date < fmtLocalDate();
  var projCode = t.project_code || '';
  return '<tr class="clickable">' +
    '<td style="font-size:11px;font-family:var(--mono);color:var(--muted)">#' + t.id + '</td>' +
    '<td>' + (projCode ? projCodeTag(projCode, 'openProject(\'' + escHtml(projCode).replace(/'/g, "\\'") + '\')', t.project_name) : '-') + '</td>' +
    '<td style="text-align:left;font-size:12px">' + escHtml(t.project_name || '-') + '</td>' +
    '<td style="text-align:center;width:22px" onclick="event.stopPropagation();if(event.target!==this.firstElementChild){var cb=this.firstElementChild;if(cb){cb.checked=!cb.checked;cb.onchange()}}"><input type="checkbox" value="' + t.id + '" onchange="_onTaskCheckbox(this)" class="task-checkbox"></td>' +
    '<td style="text-align:left"><a href="javascript:void(0)" onclick="openTaskDetail(' + t.id + ')" style="color:var(--accent)">' + escHtml(t.title) + '</a></td>' +
    '<td>' + (stageName ? '<span style="font-size:11px;color:var(--muted)">' + escHtml(stageName) + '</span>' : '-') + '</td>' +
    '<td style="' + (window._approvalEnabled ? 'cursor:pointer' : '') + '"' + (window._approvalEnabled ? ' onclick="event.stopPropagation();openReviewerDialog(' + t.id + ')" title="' + (t.reviewer_name ? '审批人: ' + escHtml(t.reviewer_name) + ' — 点击修改' : '点击设置审批人') + '"' : '') + '>' + renderPill(t.status || 'todo') + '</td>' +
    '<td>' + _renderPriority(t.priority) + '</td>' +
    '<td>' + renderProgressCircle(progressPct, 26, {label:''}) + '</td>' +
    '<td style="color:' + (overdue ? 'var(--danger)' : '') + '">' + (t.due_date || '-') + '</td>' +
    '<td>' +
      iconEdit('openTaskDialog(' + t.id + ')', '编辑任务') +
      iconCopy('openCopyTaskDialog(' + t.id + ')', '复制任务') +
      iconDelete('deleteTask(' + t.id + ',\'' + escJs(t.title) + '\')', '删除任务') +
    '</td>' +
  '</tr>';
}

function _renderPriority(p) {
  var colors = {low: 'var(--success)', medium: 'var(--warn)', high: '#f97316', critical: 'var(--danger)'};
  var labels = {low: '低', medium: '中', high: '高', critical: '紧急'};
  return '<span style="display:inline-block;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600;color:#fff;background:' + (colors[p] || 'var(--muted)') + '">' + (labels[p] || p) + '</span>';
}

/* ── Board View (simplified — drag-and-drop in later iteration) ── */

/* Pie charts & calendar moved to components.js */

/* ── Task Dialog ── */

var _tfProjectId = null; // project numeric ID selected in the task form
var _tfProjectCode = null; // project code (e.g. PE0450) for API calls to /projects/{code}/...
var _tfAssigneeId = null; // assignee ID selected in the task form
var _tfReviewerId = null; // reviewer ID selected in the task form
var _tfOriginalStatus = null; // original status when editing

function _tfStageName() {
  var sel = document.getElementById('tf-execution');
  if (!sel) return null;
  var val = sel.value;
  if (val && val[0] === '_') return val.substring(1); // synthetic key
  return null;
}

function _resolveProjectId() {
  // Resolve numeric project ID from either code or ID
  var raw = _tfProjectId || _taskProjectId;
  if (!raw) return null;
  // Already numeric
  if (typeof raw === 'number' || /^\d+$/.test(String(raw))) return parseInt(raw);
  // Look up by code from cached project list
  var p = (_allProjects || []).find(function(x) { return x.code == raw; });
  return p ? p.id : null;
}

async function _refreshTaskDetailContent(taskId) {
  try {
    var freshTask = await API.get('/tasks/' + taskId);
    var bodyEl = document.querySelector('.task-detail-body');
    if (bodyEl) {
      bodyEl.innerHTML = _renderTaskDetailBody(freshTask);
    }
    // Re-refresh worklogs (updates worklog table and consumed-hours header)
    _refreshTaskWorklogs(taskId);
    // Re-load comments
    _loadDetailComments(taskId);
    // Re-init image paste for description
    setTimeout(function() {
      var descField = document.querySelector('.editable-field[data-field="description"]');
      if (descField && freshTask.description) {
        initNoteImagePaste('ef-desc');
      }
    }, 200);
  } catch(e) {
    // Fallback: still refresh worklogs
    _refreshTaskWorklogs(taskId);
  }
}

function _closeTaskDialog() {
  document.querySelectorAll('.note-dialog-overlay').forEach(function(ov) { ov.remove(); });
}

function _closeWorklogDialog() {
  var overlays = document.querySelectorAll('.note-dialog-overlay');
  if (overlays.length > 0) {
    overlays[overlays.length - 1].remove(); // Remove only the topmost (worklog) dialog
  }
}

function openTaskDetail(taskId) {
  API.get('/tasks/' + taskId).then(function(data) {
    _showTaskDetail(data);
  }).catch(function(e) {
    showToast('加载失败: ' + (e.message || ''), 'error');
  });
}

var _card = 'background:var(--surface);border:1px solid var(--border);border-radius:var(--r-lg);padding:16px;margin-bottom:12px';
var _cardHd = 'font-size:14px;font-weight:620;letter-spacing:-0.01em;margin-bottom:10px';
var _grid2 = 'display:grid;grid-template-columns:1fr 1fr;gap:8px 16px';
var _grid4 = 'display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px 12px';
var _lbl = 'display:block;font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:2px';
var _val = 'font-size:13px';

function _daysLeft(dueDate) {
  if (!dueDate) return '';
  var due = new Date(dueDate + 'T00:00:00');
  var today = new Date(fmtLocalDate() + 'T00:00:00');
  var diff = Math.ceil((due - today) / 86400000);
  if (diff > 0) return ' (还剩' + diff + '天)';
  if (diff === 0) return ' (今天截止)';
  return ' (已过期' + Math.abs(diff) + '天)';
}

function _renderTaskDetailBody(t) {
  var overdue = t.due_date && t.status !== 'done' && t.status !== 'closed' && t.due_date < fmtLocalDate();
  var daysInfo = _daysLeft(t.due_date);
  var projHtml = t.project_code ? projCodeTag(t.project_code, null, t.project_name) + ' ' + escHtml(t.project_name || '') : escHtml(t.project_name || '-');
  var stageName = escHtml(t.stage_name || t.execution_name || '-');

  var html = '';

  // ── CSS for inline editing ──
  html += '<style>' +
    '.task-detail-body .dkpi-val{font-size:14px;font-weight:510}' +
    '.task-detail-body .dkpi-lbl{font-size:11px}' +
    '.editable-field{cursor:pointer;display:inline-block;border-radius:5px;padding:2px 8px;margin:-2px -8px;transition:background 0.15s,border-color 0.15s;border:2px solid transparent}' +
    '.editable-field:hover{background:var(--accent-lt);border-color:var(--accent)}' +
    '.editable-field.editing{cursor:default;padding:0;margin:0;border:none;display:block}' +
    '.editable-field.editing:hover{background:transparent;border-color:transparent}' +
    '.ef-display{display:inline-block;min-width:8px}' +
    '.ef-save-btn{background:var(--accent-lt);border-color:var(--accent);color:var(--accent);transition:background 0.15s,color 0.15s,border-color 0.15s}' +
    '.ef-save-btn:hover{background:var(--accent);color:#fff;border-color:var(--accent)}' +
    '.ef-cancel-btn{background:var(--warn-lt);border-color:var(--warn);color:var(--warn);transition:background 0.15s,color 0.15s,border-color 0.15s}' +
    '.ef-cancel-btn:hover{background:var(--warn);color:#fff;border-color:var(--warn)}' +
    '</style>';

  // ── Row 1: 基本信息 + 状态与进度 side by side ──
  html += '<div style="display:flex;gap:16px">' +
    // ── 基本信息 ──
    '<div class="card info-glass-card" style="flex:1;min-width:0;padding:20px">' +
      '<div class="section-hd"><span class="section-title">基本信息</span></div>' +
      '<div class="delivery-kpi" style="grid-template-columns:1fr 1fr">' +
        // Title
        '<div class="dkpi"><div class="dkpi-lbl">标题</div>' +
          _buildEditableField(t.id, 'title', 'text', '<span class="dkpi-val">' + escHtml(t.title || '—') + '</span>', t.title || '') + '</div>' +
        // Project (read-only)
        '<div class="dkpi"><div class="dkpi-lbl">项目</div><div class="dkpi-val">' + projHtml + '</div></div>' +
        // Stage (editable)
        '<div class="dkpi"><div class="dkpi-lbl">阶段</div>' +
          _buildEditableField(t.id, 'stage_name', 'stage-select', '<span class="dkpi-val">' + stageName + '</span>', t.stage_name || t.execution_name || '', {v:'',l:''}, ' data-project-id="' + (t.project_id || '') + '" data-project-code="' + escHtml(t.project_code || '') + '"') + '</div>' +
        // Reporter (read-only)
        '<div class="dkpi"><div class="dkpi-lbl">创建人</div><div class="dkpi-val">' + escHtml(t.reporter_name || '—') + '</div></div>' +
        // Assignee (editable)
        '<div class="dkpi"><div class="dkpi-lbl">负责人</div>' +
          _buildEditableField(t.id, 'assignee_id', 'user-select', '<span class="dkpi-val">' + escHtml(t.assignee_name || t.assignee_username || '—') + '</span>', t.assignee_id || '') + '</div>' +
        // Reviewer (editable, only if approval enabled)
        (window._approvalEnabled ?
          '<div class="dkpi"><div class="dkpi-lbl">审批人</div>' +
            _buildEditableField(t.id, 'reviewer_id', 'user-select', '<span class="dkpi-val">' + escHtml(t.reviewer_name || '—') + '</span>', t.reviewer_id || '') + '</div>'
          : '') +
        // Start date (editable)
        '<div class="dkpi"><div class="dkpi-lbl">计划开始</div>' +
          _buildEditableField(t.id, 'start_date', 'date', '<span class="dkpi-val">' + (t.start_date || '—') + '</span>', t.start_date || '') + '</div>' +
        // Due date (editable)
        '<div class="dkpi"><div class="dkpi-lbl">截止日期</div>' +
          _buildEditableField(t.id, 'due_date', 'date', '<span class="dkpi-val" style="color:' + (overdue ? 'var(--danger)' : '') + '">' + (t.due_date || '—') + '<span style="font-size:11px;color:' + (overdue ? 'var(--danger)' : 'var(--muted)') + '">' + daysInfo + '</span></span>', t.due_date || '') + '</div>' +
      '</div>' +
    '</div>' +
    // ── 状态与进度 ──
    '<div class="card info-glass-card" style="flex:1;min-width:0;padding:20px">' +
      '<div class="section-hd"><span class="section-title">状态与进度</span></div>' +
      '<div class="delivery-kpi" style="grid-template-columns:1fr 1fr">' +
        // Status (editable)
        '<div class="dkpi"><div class="dkpi-lbl">状态</div>' + _buildEditableField(t.id, 'status', 'select',
          '<div style="margin-top:6px">' + renderPill(t.status || 'todo') +
          (t.status === 'review' && t.reviewer_name ? '<div style="font-size:10px;color:var(--muted);margin-top:2px">审批人: ' + escHtml(t.reviewer_name) + '</div>' : '') + '</div>',
          t.status || 'todo', _STATUS_OPTS) + '</div>' +
        // Priority (editable)
        '<div class="dkpi"><div class="dkpi-lbl">优先级</div><div style="margin-top:6px">' + _buildEditableField(t.id, 'priority', 'select', _renderPriority(t.priority || 'medium'), t.priority || 'medium', _PRIORITY_OPTS) + '</div></div>' +
        // Progress (editable)
        '<div class="dkpi"><div class="dkpi-lbl">进度(%)</div>' + _buildEditableField(t.id, 'progress', 'number', '<div style="margin-top:6px">' + renderProgressCircle(t.progress || 0, 30, {label:''}) + '</div>', String(t.progress || 0), {min:0,max:100,step:5}) + '</div>' +
        // Estimate hours (editable)
        '<div class="dkpi"><div class="dkpi-lbl">预估工时(h)</div>' + _buildEditableField(t.id, 'estimate_hours', 'number', '<span class="dkpi-val">' + (t.estimate_hours || 0).toFixed(1) + 'h</span>', String(t.estimate_hours || 0), {min:0,step:0.5}) + '</div>' +
        // Hours display (read-only)
        (function() {
          var orig = t.original_estimate_hours || t.estimate_hours || 0;
          var est = t.estimate_hours || 0;
          var cons = t.consumed_hours || 0;
          var overtime = cons - orig;
          var h = '<div class="dkpi"><div class="dkpi-lbl">工时</div><div class="dkpi-val">';
          h += '预估 ' + est.toFixed(1) + 'h / 实际 ' + cons.toFixed(1) + 'h';
          if (overtime > 0 && t.status !== 'done' && t.status !== 'closed') {
            h += '<br><span style="color:var(--warn);font-size:11px">超时 ' + overtime.toFixed(1) + 'h (原计划 ' + orig.toFixed(1) + 'h)</span>';
          }
          h += '</div></div>';
          return h;
        })() +
      '</div>' +
    '</div>' +
  '</div>';

  // ── Section 3: 描述 ──
  html += '<div class="card info-glass-card" style="margin-top:16px;padding:20px">' +
    '<div class="section-hd"><span class="section-title">描述</span></div>' +
    _buildEditableField(t.id, 'description', 'textarea',
      '<div style="font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-word;min-height:20px">' + (t.description ? escHtml(t.description) : '<span style="color:var(--muted)">暂无描述，点击编辑</span>') + '</div>',
      t.description || '') +
    '<div id="ef-desc-img-preview" style="margin-top:4px;min-height:0;max-height:50vh;overflow-y:auto"></div>' +
  '</div>';

  // ── Section 4: 产出物 ──
  if (t.output_items && t.output_items.length) {
    html += '<div class="card info-glass-card" style="margin-top:16px;padding:20px">' +
      '<div class="section-hd"><span class="section-title">产出物</span></div>' +
      t.output_items.map(function(o) {
        return '<div style="margin-bottom:4px"><a href="' + escHtml(o.url) + '" target="_blank" style="color:var(--accent);font-size:13px">' + escHtml(o.name) + '</a></div>';
      }).join('') +
    '</div>';
  }

  // ── Section 5: 工时日志 ──
  html += '<div class="card info-glass-card" style="margin-top:16px;padding:20px">' +
    '<div class="section-hd"><span class="section-title">工时日志 (' + (t.consumed_hours || 0).toFixed(1) + 'h)</span>' +
      '<button class="btn btn-primary" style="font-size:11px;padding:3px 10px" onclick="openWorklogDialog(' + t.id + ')">+ 记录工时</button></div>' +
    '<div id="tv-worklogs">加载中...</div>' +
  '</div>';

  // ── Section 6: 评论 ──
  html += '<div class="card info-glass-card" style="margin-top:16px;padding:20px">' +
    '<div class="section-hd"><span class="section-title">评论</span></div>' +
    '<div class="task-detail-comments" style="margin-bottom:8px">加载中...</div>' +
    '<div style="display:flex;gap:8px">' +
      '<input class="search-inp task-detail-comment-input" placeholder="添加评论..." style="flex:1">' +
      '<button class="btn-sm btn-primary" onclick="_submitDetailComment(' + t.id + ')">发送</button>' +
    '</div>' +
  '</div>';

  return html;
}

function _showTaskDetail(t) {
  var html = '<div class="task-detail-body" style="max-height:75vh;overflow-y:auto;padding-right:4px">' +
    _renderTaskDetailBody(t) +
    '</div>';

  openDialog(escHtml(t.title), html, [
    {text: '关闭', onclick: '_closeTaskDialog()'}
  ], {maxWidth: '60%'});

  // Async load worklogs and comments (DOM exists after openDialog)
  _refreshTaskWorklogs(t.id);
  _loadDetailComments(t.id);

  // Init image paste for description if available
  setTimeout(function() {
    var descField = document.querySelector('.editable-field[data-field="description"]');
    if (descField && t.description) {
      initNoteImagePaste('ef-desc');
    }
  }, 200);
}

function _loadViewComments(taskId) {
  API.get('/task-comments?task_id=' + taskId).then(function(comments) {
    var el = document.getElementById('tv-comments');
    if (!el) return;
    if (!comments || !comments.length) { el.innerHTML = '<div style="color:var(--muted);font-size:12px">暂无评论</div>'; return; }
    el.innerHTML = '<table class="stage-table" style="width:100%;font-size:12px"><thead><tr>' +
      '<th style="width:130px">时间</th><th style="width:80px">用户</th><th>内容</th></tr></thead><tbody>' +
      comments.map(function(c) {
        return '<tr>' +
          '<td style="font-size:10px;color:var(--muted);white-space:nowrap">' + (fmtISODateTime(c.created_at) || '') + '</td>' +
          '<td style="font-size:12px">' + escHtml(c.display_name || c.username) + '</td>' +
          '<td style="font-size:13px">' + escHtml(c.content) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }).catch(function() {});
}

function _submitViewComment(taskId) {
  var input = document.getElementById('tv-comment-input');
  if (!input || !input.value.trim()) return;
  API.post('/task-comments', {task_id: taskId, content: input.value.trim()}).then(function() {
    input.value = '';
    _loadViewComments(taskId);
  }).catch(function(e) { showToast('评论失败: ' + (e.message || ''), 'error'); });
}

function openTaskDialog(taskId) {
  if (taskId) { openTaskDetail(taskId); return; } // route edit to unified detail view
  var isEdit = !!taskId;
  var title = isEdit ? '编辑任务' : '新建任务';
  _tfProjectId = _taskProjectId || window._taskProjectId; _tfProjectCode = _taskProjectCode || window._taskProjectCode || _taskProjectId; // default to page context
  _tfAssigneeId = null;
  _tfReviewerId = null;
  _tfOriginalStatus = null;

  if (isEdit) {
    API.get('/tasks/' + taskId).then(function(data) {
      _tfOriginalStatus = data.status;
      _showTaskForm(title, data);
    }).catch(function(e) {
      showToast('加载任务失败: ' + (e.message || ''), 'error');
    });
  } else {
    _showTaskForm(title, null);
  }
}

function _showTaskForm(title, task) {
  var isEdit = !!task;
  var t = task || {};

  var execOpts = '';
  if (_taskProjectId) {
    execOpts = '<option value="">加载中...</option>';
  }

  var inp = 'width:100%;box-sizing:border-box;margin-top:1px';
  var row2 = 'display:grid;grid-template-columns:1fr 1fr;gap:10px';
  var bodyHtml = '';

  // ── Row 1: 基本信息 + 状态与进度 side by side ──
  bodyHtml += '<div style="' + row2 + '">' +
    // ── 基本信息 ──
    '<div style="' + _card + '">' +
      '<div style="' + _cardHd + '">基本信息</div>' +
      '<div style="margin-bottom:6px"><label style="' + _lbl + '">标题 *</label><input class="search-inp" id="tf-title" value="' + escHtml(t.title || '') + '" placeholder="请填入任务标题" style="' + inp + '"></div>' +
      '<div id="tf-title-hint" style="display:none;font-size:10px;color:var(--danger);margin-top:1px">请填入任务标题</div>' +
      '<div style="' + _grid2 + '">' +
        '<div><label style="' + _lbl + '">所属项目 *</label>' +
          '<div style="margin-top:2px">' + createProjectCombo({
            comboId: 'tf-proj-combo', inputId: 'tf-project-input', dropdownId: 'tf-proj-dropdown',
            selectedIdFn: function() { return _tfProjectId; },
            onSelect: function(p) { _tfProjectId = p.id; _tfProjectCode = p.code; _loadTfExecutions(p.code); }
          }) + '<div id="tf-project-hint" style="display:none;font-size:10px;color:var(--danger);margin-top:1px">请选择所属项目</div></div></div>' +
        '<div><label style="' + _lbl + '">阶段 *</label><select class="search-inp" id="tf-execution" style="' + inp + '"><option value="">请选择阶段...</option>' + execOpts + '</select><div id="tf-execution-hint" style="display:none;font-size:10px;color:var(--danger);margin-top:1px">请选择阶段</div></div>' +
      '</div>' +
      '<div style="' + _grid2 + '">' +
        '<div><label style="' + _lbl + '">创建人</label><div style="' + inp + ';padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;font-size:13px;color:var(--fg)">' + escHtml(t.reporter_name || '—') + '</div></div>' +
        '<div><label style="' + _lbl + '">负责人 *</label><div style="margin-top:2px">' + createUserCombo({
          comboId: 'tf-assignee-combo', inputId: 'tf-assignee-input', dropdownId: 'tf-assignee-dropdown',
          selectedIdFn: function() { return _tfAssigneeId; },
          onSelect: function(u) { _tfAssigneeId = u.id; }
        }) + '<div id="tf-assignee-hint" style="display:none;font-size:10px;color:var(--danger);margin-top:1px">请选择负责人</div></div></div>' +
        (window._approvalEnabled ? '<div><label style="' + _lbl + '">审批人</label><div style="margin-top:2px">' + createUserCombo({
          comboId: 'tf-reviewer-combo', inputId: 'tf-reviewer-input', dropdownId: 'tf-reviewer-dropdown',
          selectedIdFn: function() { return _tfReviewerId; },
          onSelect: function(u) { _tfReviewerId = u.id; }
        }) + '</div></div>' : '') +
      '</div>' +
    '</div>' +
    // ── 状态与进度 ──
    '<div style="' + _card + '">' +
      '<div style="' + _cardHd + '">状态与进度</div>' +
      '<div style="' + _grid2 + '">' +
        '<div><label style="' + _lbl + '">计划开始</label><input class="search-inp" id="tf-start-date" type="date" value="' + (t.start_date || fmtLocalDate()) + '" style="' + inp + '"></div>' +
        '<div><label style="' + _lbl + '">截止日期 *</label><input class="search-inp" id="tf-due" type="date" value="' + (t.due_date || '') + '" style="' + inp + '" required><div id="tf-due-hint" style="display:none;font-size:10px;color:var(--danger);margin-top:1px">请填写截止日期</div></div>' +
        '<div><label style="' + _lbl + '">状态</label><select class="search-inp" id="tf-status" style="' + inp + '">' +
          '<option value="todo"' + (t.status==='todo'?' selected':'') + '>待办</option>' +
          '<option value="in_progress"' + (t.status==='in_progress'?' selected':'') + '>进行中</option>' +
          '<option value="review"' + (t.status==='review'?' selected':'') + '>评审中</option>' +
          '<option value="done"' + (t.status==='done'?' selected':'') + '>已完成</option>' +
          '<option value="closed"' + (t.status==='closed'?' selected':'') + '>已关闭</option>' +
        '</select></div>' +
        '<div><label style="' + _lbl + '">优先级</label><select class="search-inp" id="tf-priority" style="' + inp + '">' +
          '<option value="low"' + (t.priority==='low'?' selected':'') + '>低</option>' +
          '<option value="medium"' + (t.priority==='medium'?' selected':'') + '>中</option>' +
          '<option value="high"' + (t.priority==='high'?' selected':'') + '>高</option>' +
          '<option value="critical"' + (t.priority==='critical'?' selected':'') + '>紧急</option>' +
        '</select></div>' +
        '<div><label style="' + _lbl + '">进度(%)</label><input class="search-inp" id="tf-progress" type="number" min="0" max="100" step="5" value="' + (t.progress || 0) + '" style="' + inp + '"></div>' +
        '<div><label style="' + _lbl + '">预估工时(h)</label><input class="search-inp" id="tf-estimate" type="number" step="0.5" min="0" value="' + (t.estimate_hours || '') + '" style="' + inp + '"></div>' +
      '</div>' +
    '</div>' +
  '</div>';

  // ── Section 3: 描述 ──
  bodyHtml += '<div style="' + _card + '">' +
    '<div style="' + _cardHd + '">描述</div>' +
    '<textarea class="search-inp" id="tf-desc" rows="3" style="width:100%;min-height:60px;height:auto;max-height:30vh;box-sizing:border-box;resize:vertical">' + escHtml(t.description || '') + '</textarea>' +
    '<div style="font-size:10px;color:var(--muted);margin-top:2px">支持粘贴图片 (Ctrl+V)</div>' +
    '<div id="tf-desc-img-preview" style="margin-top:4px;min-height:0;max-height:50vh;overflow-y:auto"></div>' +
  '</div>';

  // ── Section 4: 产出物 ──
  var outputs = t.output_items || [];
  bodyHtml += '<div style="' + _card + '">' +
    '<div style="' + _cardHd + '">产出物</div>' +
    '<div id="tf-outputs">';
  outputs.forEach(function(o, i) { bodyHtml += _renderOutputRow(i, o); });
  bodyHtml += '</div>' +
    '<button class="btn-xs" onclick="addOutputRow()" style="margin-top:4px">+ 添加产出物</button>' +
  '</div>';

  // ── Section 5 & 6: 工时日志 + 评论 (edit only) ──
  if (isEdit) {
    bodyHtml += '<div style="' + _card + '">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
        '<span style="' + _cardHd + ';margin-bottom:0">工时日志 (' + (t.consumed_hours || 0).toFixed(1) + 'h)</span>' +
        '<button class="btn btn-primary" style="font-size:11px;padding:3px 10px;flex-shrink:0" onclick="openWorklogDialog(' + t.id + ')">+ 记录工时</button>' +
      '</div>' +
      '<div id="tf-worklogs">加载中...</div>' +
    '</div>';

    bodyHtml += '<div style="' + _card + '">' +
      '<div style="' + _cardHd + '">评论</div>' +
      '<div id="tf-comments" style="margin-bottom:8px">加载中...</div>' +
      '<div style="display:flex;gap:8px">' +
        '<input class="search-inp" id="tf-comment-input" placeholder="添加评论..." style="flex:1">' +
        '<button class="btn-sm btn-primary" onclick="submitComment(' + t.id + ')">发送</button>' +
      '</div></div>';
  }

  var buttons = [
    {text: '取消', onclick: '_closeTaskDialog()'},
    {text: (isEdit ? '保存' : '创建'), cls: 'btn-primary', onclick: 'submitTask(' + (t.id || 'null') + ')'}
  ];

  bodyHtml = '<div style="max-height:75vh;overflow-y:auto;padding-right:4px">' + bodyHtml + '</div>';
  var headerExtra = isEdit ? '' : '<button class="btn btn-xs" style="font-size:11px;white-space:nowrap" onclick="_closeTaskDialog();openBatchCreateDialog()">📝 批量创建</button>';
  openDialog(title, bodyHtml, buttons, {maxWidth: '80vw', maxHeight: '90vh', headerExtra: headerExtra});
  _clearNoteImagePreviews('tf-desc-img-preview');
  setTimeout(function() {
    initNoteImagePaste('tf-desc');
    if (t.description) { _loadExistingNoteImages(t.description, 'tf-desc-img-preview'); }
  }, 150);

  // Pre-fill project, assignee, reviewer, and stage from task data (edit mode)
  _tfProjectId = t.project_id || _taskProjectId;
  _tfAssigneeId = t.assignee_id || null;
  _tfReviewerId = t.reviewer_id || null;
  if (isEdit && t.project_id) {
    // Set project name from task data
    var projName = (t.project_code ? '[' + t.project_code + '] ' : '') + (t.project_name || '');
    setTimeout(function() {
      var pi = document.getElementById('tf-project-input');
      if (pi) pi.value = projName;
      // Pre-fill assignee name
      if (_tfAssigneeId && t.assignee_name) {
        var ai = document.getElementById('tf-assignee-input');
        if (ai) ai.value = t.assignee_name;
      }
      // Pre-fill reviewer name
      if (window._approvalEnabled && _tfReviewerId && t.reviewer_name) {
        var ri = document.getElementById('tf-reviewer-input');
        if (ri) ri.value = t.reviewer_name;
      }
    }, 50);
  }

function _loadTfExecutions(projectId, selectedId) {
  // Use project code (e.g. PE0450) for the /projects/{identifier}/... API
  var identifier = _tfProjectCode || projectId;
  API.get('/projects/' + identifier + '/gantt').then(function(data) {
    var sel = document.getElementById('tf-execution');
    if (!sel) return;
    var prevVal = selectedId || sel.value;
    sel.innerHTML = '<option value="">选择阶段...</option>';
    if (data && data.stages) {
      data.stages.forEach(function(s) {
        var eid = s.execution_id || '';
        var label = s.name || s.standard_stage || '';
        if (!eid && label) eid = '_' + label;
        var opt = document.createElement('option');
        opt.value = eid;
        opt.textContent = label;
        if (eid === prevVal) opt.selected = true;
        sel.appendChild(opt);
      });
    }
  }).catch(function() {});
}

  // Async: load stages for project with task's current stage pre-selected
  var projId = _taskProjectId || t.project_id;
  if (projId) {
    var curExecVal = t.stage_name ? '_' + t.stage_name : '';
    _loadTfExecutions(projId, curExecVal);
  }

  // Pre-fill project name if context is set (new task from project detail page)
  if (!isEdit && _tfProjectId) {
    setTimeout(function() {
      loadAllProjects().then(function() {
        var p = _allProjects.find(function(x) { return x.id == _tfProjectId || x.code == _tfProjectId; });
        if (p) document.getElementById('tf-project-input').value = (p.code ? p.code + ' ' : '') + p.name;
      });
    }, 80);
  }

  // Async: load worklogs and comments (edit mode)
  if (isEdit) {
    API.get('/worklogs?task_id=' + t.id).then(function(logs) {
      var el = document.getElementById('tf-worklogs');
      if (el) { el.innerHTML = _renderWorklogTable(logs || [], t.id); _initWorklogDt(logs || [], t.id); }
    }).catch(function() {});
    _loadComments(t.id);
  }
}

function _renderOutputRow(idx, o) {
  return '<div style="display:flex;gap:6px;margin-bottom:4px;align-items:center">' +
    '<input class="search-inp" id="tf-out-name-' + idx + '" value="' + escHtml(o.name || '') + '" placeholder="名称" style="flex:2">' +
    '<input class="search-inp" id="tf-out-url-' + idx + '" value="' + escHtml(o.url || '') + '" placeholder="链接" style="flex:3">' +
    '<button class="btn-xs" onclick="this.parentElement.remove()" style="color:var(--danger)">×</button>' +
    '</div>';
}

var _outputCounter = 0;
function addOutputRow() {
  var container = document.getElementById('tf-outputs');
  if (!container) return;
  var idx = _outputCounter++;
  container.insertAdjacentHTML('beforeend', _renderOutputRow(idx, {}));
}

/* ── Submit Task ── */

async function submitTask(taskId) {
  var desc = document.getElementById('tf-desc').value.trim();
  desc = await _uploadNoteImages(desc);
  var data = {
    title: document.getElementById('tf-title').value.trim(),
    description: desc,
    status: document.getElementById('tf-status').value,
    priority: document.getElementById('tf-priority').value,
    assignee_id: _tfAssigneeId,
    reviewer_id: window._approvalEnabled ? _tfReviewerId : null,
    progress: parseInt(document.getElementById('tf-progress').value) || 0,
    estimate_hours: parseFloat(document.getElementById('tf-estimate').value) || 0,
    start_date: document.getElementById('tf-start-date').value || null,
    due_date: document.getElementById('tf-due').value || null,
    execution_id: parseInt(document.getElementById('tf-execution').value) || null,
    stage_name: _tfStageName(),
    project_id: _resolveProjectId(),
  };

  // Clear all hints first
  ['tf-title-hint','tf-project-hint','tf-execution-hint','tf-assignee-hint','tf-due-hint'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.style.display = 'none';
  });
  var valid = true;
  if (!data.title) { var h = document.getElementById('tf-title-hint'); if (h) h.style.display = ''; valid = false; }
  if (!data.project_id) { var h = document.getElementById('tf-project-hint'); if (h) h.style.display = ''; valid = false; }
  if (!data.execution_id && !data.stage_name) { var h = document.getElementById('tf-execution-hint'); if (h) h.style.display = ''; valid = false; }
  if (!data.assignee_id) { var h = document.getElementById('tf-assignee-hint'); if (h) h.style.display = ''; valid = false; }
  if (!data.due_date) { var h = document.getElementById('tf-due-hint'); if (h) h.style.display = ''; valid = false; }
  if (!valid) return;

  // Collect output items
  var outputs = [];
  var outContainer = document.getElementById('tf-outputs');
  if (outContainer) {
    var rows = outContainer.children;
    for (var i = 0; i < rows.length; i++) {
      var nameEl = rows[i].querySelector('[id^="tf-out-name-"]');
      var urlEl = rows[i].querySelector('[id^="tf-out-url-"]');
      if (nameEl && nameEl.value.trim()) {
        outputs.push({name: nameEl.value.trim(), url: urlEl ? urlEl.value.trim() : '', type: 'link'});
      }
    }
  }
  data.output_items = outputs;

  // Bidirectional sync: progress ↔ status
  if (data.progress >= 100 && data.status !== 'review' && data.status !== 'done') {
    data.status = window._approvalEnabled ? 'review' : 'done';
    document.getElementById('tf-status').value = data.status;
  }
  if (data.status === 'done' && data.progress < 100) {
    data.progress = 100;
    document.getElementById('tf-progress').value = 100;
    showToast('状态设为已完成，进度已自动设为100%', 'warn');
  }
  // When progress reaches 100%, confirm
  if (data.progress >= 100 && data.status === 'review') {
    _pendingTaskConfirm = { isEdit: !!taskId, data: data, taskId: taskId };
    openDialog('确认提交评审',
      '<div style="font-size:13px;margin-bottom:8px">进度 <b>100%</b>，任务将进入<b>评审中</b>状态，等待审批人确认。</div>' +
      '<div style="font-size:11px;color:var(--muted)">任务: ' + escHtml(data.title || '') + '</div>',
      [
        {text: '取消', onclick: "var d=document.querySelector('.shared-dialog-overlay');if(d)d.remove();"},
        {text: '确认', cls: 'btn-primary', onclick: "_doSubmitTaskConfirm()"},
      ],
      {hideClose: true}
    );
    return;
  }

  _doSaveTask(taskId, data);
}

async function _doSubmitTaskConfirm() {
  var d = document.querySelector('.shared-dialog-overlay'); if (d) d.remove();
  if (!_pendingTaskConfirm) return;
  var p = _pendingTaskConfirm;
  _pendingTaskConfirm = null;
  _doSaveTask(p.taskId, p.data);
}

async function _doSaveTask(taskId, data) {
  try {
    var res;
    if (taskId) {
      res = await API.put('/tasks/' + taskId, data);
      showToast('任务已更新', 'success');
    } else {
      res = await API.post('/tasks', data);
      showToast('任务已创建', 'success');
    }
    // Show auto-update messages from backend (stage/project status changes)
    if (res && res.auto_messages && res.auto_messages.length) {
      res.auto_messages.forEach(function(msg) { showToast(msg, 'success'); });
    }
    _closeTaskDialog();
    loadTaskData();
  } catch(e) {
    showToast('操作失败: ' + (e.message || '未知错误'), 'error');
  }
}

/* ── Copy Task ── */

function openCopyTaskDialog(taskId) {
  API.get('/tasks/' + taskId).then(function(data) {
    data.title = (data.title || '') + ' (副本)';
    delete data.id;
    _showTaskForm('复制任务', data);
  }).catch(function(e) {
    showToast('加载任务失败: ' + (e.message || ''), 'error');
  });
}

/* ── Batch Create ── */

function openBatchCreateDialog() {
  // Default 2 rows; project combo loads list on demand
  _renderBatchForm([{}, {}]);
  // Pre-load executions
  if (_taskProjectId) {
    API.get('/projects/' + _taskProjectId + '/gantt').then(function(data) {
      _batchExecutions = (data && data.stages) ? data.stages : [];
    }).catch(function() { _batchExecutions = []; });
  }
}

var _batchExecutions = [];
var _batchProjectId = null;

function _batchExecOptions(selId) {
  return '<select class="search-inp" id="' + selId + '" style="flex:1.5"><option value="">选择阶段 *</option>' +
    _batchExecutions.map(function(s) {
      return '<option value="' + (s.execution_id || s.id || '') + '">' + escHtml(s.name || s.standard_stage || '') + '</option>';
    }).join('') + '</select>';
}

function _batchRowHTML(i, r) {
  r = r || {};
  return '<div style="display:flex;gap:3px;margin-bottom:4px;align-items:center;font-size:12px">' +
    '<span style="width:22px;text-align:center;font-family:var(--mono);font-size:11px;color:var(--muted);flex-shrink:0">' + (i + 1) + '</span>' +
    _batchExecOptions('bt-exec-' + i) +
    '<input class="search-inp" id="bt-title-' + i + '" value="' + escHtml(r.title || '') + '" placeholder="标题 *" style="flex:2;min-width:120px">' +
    '<select class="search-inp" id="bt-status-' + i + '" style="flex:0.8;min-width:70px"><option value="todo">待办</option><option value="in_progress">进行中</option><option value="review">评审中</option><option value="done">已完成</option><option value="closed">已关闭</option></select>' +
    '<select class="search-inp" id="bt-priority-' + i + '" style="flex:0.7;min-width:55px"><option value="medium">中</option><option value="low">低</option><option value="high">高</option><option value="critical">紧急</option></select>' +
    '<select class="search-inp" id="bt-assignee-' + i + '" style="flex:0.9;min-width:120px"><option value="">负责人 *</option></select>' +
    '<input class="search-inp" id="bt-estimate-' + i + '" value="' + escHtml(r.estimate || '') + '" placeholder="工时(h) *" style="flex:0.6;min-width:55px" type="number" step="0.5">' +
    '<span style="font-size:11px;color:var(--muted);white-space:nowrap;flex:1;min-width:110px;display:flex;align-items:center;gap:2px">截止 * <input class="search-inp" id="bt-due-' + i + '" value="' + escHtml(r.due_date || '') + '" type="date" style="flex:1;min-width:0"></span>' +
    '<input class="search-inp" id="bt-desc-' + i + '" value="' + escHtml(r.desc || '') + '" placeholder="描述" style="flex:1.5;min-width:100px">' +
    '<button class="btn-xs" onclick="_batchCopyRow(' + i + ')" title="同上" style="color:var(--accent)">同上</button>' +
    '<button class="btn-xs" onclick="this.parentElement.remove()" style="color:var(--danger)">×</button>' +
  '</div>';
}

function _batchCopyRow(i) {
  if (i <= 0) return;
  var prev = document.getElementById('batch-rows').children[i - 1];
  ['exec','title','status','priority','assignee','estimate','due','desc'].forEach(function(field) {
    var src = prev.querySelector('[id^="bt-' + field + '-"]');
    var dst = document.getElementById('bt-' + field + '-' + i);
    if (src && dst) { if (dst.tagName === 'SELECT') dst.selectedIndex = src.selectedIndex; else dst.value = src.value; }
  });
}

function _renderBatchForm(rows) {
  _batchProjectId = _taskProjectId;
  var projHtml = '<div style="margin-bottom:12px"><label style="font-size:11px;color:var(--muted)">所属项目 *</label><div style="margin-top:2px">' +
    createProjectCombo({
      comboId: 'batch-proj-combo',
      inputId: 'batch-proj-input',
      dropdownId: 'batch-proj-dropdown',
      selectedIdFn: function() { return _batchProjectId; },
      onSelect: function(p) { _batchProjectId = p.id; _loadBatchExecs(p.id); }
    }) + '</div></div>';

  var html = projHtml + '<div id="batch-hint" style="display:none;font-size:10px;color:var(--danger);margin-bottom:4px"></div>' +
    '<div id="batch-rows" style="max-height:400px;overflow:auto;min-width:900px">';
  rows.forEach(function(r, i) { html += _batchRowHTML(i, r); });
  html += '</div><button class="btn-xs" onclick="_batchAddRow()" style="margin-top:4px">+ 添加行</button>';

  openDialog('批量创建任务', html, [
    {text: '取消', onclick: '_closeTaskDialog()'},
    {text: '创建', cls: 'btn-primary', onclick: '_submitBatchCreate()'}
  ], {maxWidth: '95vw'});

  // Load users for assignee selects (reuse global user cache)
  loadAllUsers().then(function() {
    document.querySelectorAll('[id^="bt-assignee-"]').forEach(function(sel) {
      _allUsers.forEach(function(u) {
        var opt = document.createElement('option');
        opt.value = u.id; opt.textContent = u.name;
        sel.appendChild(opt);
      });
    });
  });

  // Pre-fill project and load executions if set
  _batchProjectId = _taskProjectId;
  if (_taskProjectId && _taskProjectName) {
    _loadBatchExecs(_taskProjectId);
    setTimeout(function() {
      var inp = document.getElementById('batch-proj-input');
      if (inp) inp.value = _taskProjectName;
    }, 200);
  }
}

function _loadBatchExecs(projectId) {
  API.get('/projects/' + projectId + '/gantt').then(function(data) {
    _batchExecutions = (data && data.stages) ? data.stages : [];
    // Refresh all existing stage dropdowns
    _refreshBatchExecSelects();
  }).catch(function() { _batchExecutions = []; _refreshBatchExecSelects(); });
}

function _refreshBatchExecSelects() {
  var opts = '<option value="">选择阶段 *</option>' +
    _batchExecutions.map(function(s) {
      var eid = s.execution_id || '';
      var label = s.name || s.standard_stage || '';
      if (!eid && label) eid = '_' + label;
      return '<option value="' + eid + '">' + escHtml(label) + '</option>';
    }).join('');
  document.querySelectorAll('[id^="bt-exec-"]').forEach(function(sel) {
    sel.innerHTML = opts;
  });
}

function _batchStageName(val) {
  if (val && val[0] === '_') return val.substring(1);
  return null;
}

function _batchAddRow() {
  var container = document.getElementById('batch-rows');
  if (!container) return;
  var i = container.children.length;
  container.insertAdjacentHTML('beforeend', _batchRowHTML(i));
  // Populate user select for new row (reuse global cache)
  var sel = document.getElementById('bt-assignee-' + i);
  if (sel) {
    loadAllUsers().then(function() {
      _allUsers.forEach(function(u) {
        var opt = document.createElement('option');
        opt.value = u.id; opt.textContent = u.name;
        if (!sel.querySelector('option[value="'+u.id+'"]')) sel.appendChild(opt);
      });
    });
  }
}

async function _submitBatchCreate() {
  var tasks = [];
  var container = document.getElementById('batch-rows');
  if (!container) return;
  if (!_batchProjectId) { showToast('请选择项目', 'error'); return; }
  // Clear previous hints and error styles
  var hintEl = document.getElementById('batch-hint');
  if (hintEl) hintEl.style.display = 'none';
  var rows = container.children;
  var errors = [];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var titleEl = document.getElementById('bt-title-' + i);
    var execEl = document.getElementById('bt-exec-' + i);
    var statusEl = document.getElementById('bt-status-' + i);
    var priorityEl = document.getElementById('bt-priority-' + i);
    var assigneeEl = document.getElementById('bt-assignee-' + i);
    var estEl = document.getElementById('bt-estimate-' + i);
    var dueEl = document.getElementById('bt-due-' + i);
    var descEl = document.getElementById('bt-desc-' + i);
    // Clear error borders
    [execEl, assigneeEl, estEl, dueEl].forEach(function(el) { if (el) el.style.borderColor = ''; });
    var title = titleEl ? titleEl.value.trim() : '';
    if (!title) continue;
    var rowLabel = '第' + (i + 1) + '行';
    var execVal = execEl ? execEl.value : '';
    if (!execVal) { if (execEl) execEl.style.borderColor = 'var(--danger)'; errors.push(rowLabel + '未选择阶段'); }
    var assigneeVal = assigneeEl ? assigneeEl.value : '';
    if (!assigneeVal) { if (assigneeEl) assigneeEl.style.borderColor = 'var(--danger)'; errors.push(rowLabel + '未选择负责人'); }
    var estVal = estEl ? estEl.value.trim() : '';
    if (!estVal) { if (estEl) estEl.style.borderColor = 'var(--danger)'; errors.push(rowLabel + '未填写工时'); }
    var dueVal = dueEl ? dueEl.value : '';
    if (!dueVal) { if (dueEl) dueEl.style.borderColor = 'var(--danger)'; errors.push(rowLabel + '未填写截止日期'); }
    if (!execVal || !assigneeVal || !estVal || !dueVal) continue;
    tasks.push({
      title: title,
      execution_id: execVal && execVal[0] !== '_' ? (parseInt(execVal) || null) : null,
      stage_name: _batchStageName(execVal),
      status: statusEl ? statusEl.value : 'todo',
      priority: priorityEl ? priorityEl.value : 'medium',
      assignee_id: assigneeEl ? (parseInt(assigneeEl.value) || null) : null,
      estimate_hours: estEl ? (parseFloat(estEl.value) || 0) : 0,
      due_date: dueEl ? (dueEl.value || null) : null,
      description: descEl ? (descEl.value.trim() || null) : null,
    });
  }
  if (errors.length) {
    if (hintEl) { hintEl.textContent = errors.join('；'); hintEl.style.display = ''; }
    return;
  }
  if (!tasks.length) { showToast('请至少填写一个任务标题', 'error'); return; }

  try {
    await API.post('/tasks/batch', {project_id: String(_batchProjectId), tasks: tasks});
    showToast('已创建 ' + tasks.length + ' 个任务', 'success');
    _closeTaskDialog();
    loadTaskData();
  } catch(e) {
    var msg = '未知错误';
    if (typeof e === 'string') { msg = e; }
    else if (e && e.message && typeof e.message === 'string') { msg = e.message; }
    else if (e && e.detail) { msg = e.detail; }
    showToast('批量创建失败: ' + msg, 'error');
  }
}

/* ── Import Tasks ── */

function openImportTasksDialog() {
  if (!_taskProjectId) { showToast('请先选择项目', 'error'); return; }

  var html = '<div style="margin-bottom:12px"><label style="font-size:11px;color:var(--muted)">从哪个项目导入？</label>' +
    '<select class="search-inp" id="import-src-project" onchange="_loadImportTaskList()" style="width:100%;box-sizing:border-box;margin-top:4px">' +
      '<option value="">选择项目...</option></select></div>' +
    '<div id="import-task-list" style="max-height:300px;overflow-y:auto"></div>';

  openDialog('从其他项目导入任务', html, [
    {text: '取消', onclick: '_closeTaskDialog()'},
    {text: '导入选中', cls: 'btn-primary', onclick: '_submitImportTasks()'}
  ], {maxWidth: 600});

  // Load project list
  API.get('/dashboard/projects').then(function(data) {
    var sel = document.getElementById('import-src-project');
    if (!sel) return;
    if (data && data.items) {
      data.items.forEach(function(p) {
        if (p.id === _taskProjectId) return; // skip current project
        var opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        sel.appendChild(opt);
      });
    }
  }).catch(function(e) {
    showToast('加载项目列表失败', 'error');
  });
}

async function _loadImportTaskList() {
  var sel = document.getElementById('import-src-project');
  var listEl = document.getElementById('import-task-list');
  if (!sel || !sel.value || !listEl) return;

  listEl.innerHTML = '<div class="loading-spinner">加载中...</div>';
  try {
    var data = await API.get('/tasks?project_id=' + sel.value);
    if (!data || !data.length) {
      listEl.innerHTML = '<div style="color:var(--muted)">该项目无任务</div>';
      return;
    }
    var html = '';
    data.forEach(function(t) {
      html += '<label style="display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer">' +
        '<input type="checkbox" class="import-cb" value="' + t.id + '">' +
        '<span>' + escHtml(t.title) + '</span>' +
        '<span style="font-size:10px;color:var(--muted)">' + (t.estimate_hours || 0).toFixed(1) + 'h</span>' +
      '</label>';
    });
    listEl.innerHTML = html;
  } catch(e) {
    listEl.innerHTML = '<div class="error-state">加载失败</div>';
  }
}

async function _submitImportTasks() {
  var cbs = document.querySelectorAll('.import-cb:checked');
  var taskIds = [];
  cbs.forEach(function(cb) { taskIds.push(parseInt(cb.value)); });
  if (!taskIds.length) { showToast('请选择要导入的任务', 'error'); return; }

  try {
    await API.post('/tasks/import', {task_ids: taskIds, target_project_id: _taskProjectId, execution_mapping: {}});
    showToast('已导入 ' + taskIds.length + ' 个任务', 'success');
    _closeTaskDialog();
    loadTaskData();
  } catch(e) {
    showToast('导入失败: ' + (e.message || '未知错误'), 'error');
  }
}

/* ── Worklog Dialog ── */

function _renderWorklogTable(logs, taskId) {
  if (!logs || !logs.length) return '<div style="color:var(--muted);font-size:12px">暂无工时记录</div>';
  return '<div id="worklog-table-' + taskId + '"></div>';
}

function _initWorklogDt(logs, taskId) {
  new DataTable({
    container: document.getElementById('worklog-table-' + taskId),
    columns: [
      { key: 'date', title: '日期', render: function(v) { return v||'?'; } },
      { key: 'user', title: '用户', render: function(v, row) { return '<span style="font-size:11px">'+escHtml(v||row.username||'?')+'</span>'; } },
      { key: 'hours', title: '工时(h)', render: function(v) { return (v||0).toFixed(1); } },
      { key: 'description', title: '描述', align: 'left', render: function(v) { return '<span style="white-space:normal;word-break:break-word">'+escHtml(v||'')+'</span>'; } },
      { key: 'actions', title: '操作', render: function(v, row) { return iconEdit('openWorklogEditDialog('+row.id+','+taskId+')','编辑')+iconDelete('deleteWorklogById('+row.id+','+taskId+')','删除'); } }
    ],
    data: logs,
    resizable: false
  });
}

function openWorklogDialog(taskId) {
  API.get('/tasks/'+taskId).then(function(task) {
    var today = fmtLocalDate();
    var est = task.estimate_hours || 0;
    var cons = task.consumed_hours || 0;
    var showOver = est > 0 && cons >= est;
    var overBudgetHint = '<div id="wl-over-budget" style="margin-bottom:8px;padding:8px;background:var(--warn-lt);border-radius:6px;border:1px solid var(--warn);' + (showOver ? '' : 'display:none') + '">' +
      '<div style="font-size:11px;color:var(--warn);margin-bottom:4px">已超预估工时 (已耗时 ' + cons.toFixed(1) + 'h / 预估 ' + est.toFixed(1) + 'h)</div>' +
      '<label style="font-size:11px;color:var(--muted)">预计还需要 (h) <span style="color:var(--danger)">*必填</span></label>' +
      '<input class="search-inp" id="wl-remaining" type="number" step="0.5" min="0" style="width:100%;box-sizing:border-box;margin-top:2px" placeholder="还需多少小时完成？">' +
    '</div>';
    var html = '<div>' +
      '<input type="hidden" id="wl-reviewer-name" value="' + escHtml(task.reviewer_name || '') + '">' +
      '<input type="hidden" id="wl-reviewer-id" value="' + (task.reviewer_id || '') + '">' +
      overBudgetHint +
      '<div style="margin-bottom:4px;font-size:11px;color:var(--muted)">项目: <span style="color:var(--fg);font-weight:500">' + escHtml(task.project_code||'？') + '</span> ' + escHtml(task.project_name||'') + '</div>' +
      '<div style="margin-bottom:8px;font-size:11px;color:var(--muted)">任务: <span style="color:var(--fg);font-weight:500">' + escHtml(task.name||task.title||'？') + '</span></div>' +
      '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">日期 *</label>' +
        '<input class="search-inp" id="wl-date" type="date" required value="'+today+'" style="width:100%;box-sizing:border-box;margin-top:2px"><div id="wl-date-hint" style="display:none;font-size:10px;color:var(--danger);margin-top:1px">请选择日期</div></div>' +
      '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">工时(h) *</label>' +
        '<input class="search-inp" id="wl-hours" type="number" step="0.5" min="0.5" required value="1" style="width:100%;box-sizing:border-box;margin-top:2px" oninput="_wlCheckOverBudget(' + taskId + ')"><div id="wl-hours-hint" style="display:none;font-size:10px;color:var(--danger);margin-top:1px">请输入有效工时(≥0.5h)</div></div>' +
      '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">进度(%) * 当前: '+(task.progress||0)+'%</label>' +
        '<input class="search-inp" id="wl-progress" type="number" min="0" max="100" step="5" required value="'+(task.progress||0)+'" style="width:100%;box-sizing:border-box;margin-top:2px"><div id="wl-progress-hint" style="display:none;font-size:10px;color:var(--danger);margin-top:1px">请输入进度(0-100)</div></div>' +
      '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">工作描述 *</label>' +
        '<textarea class="search-inp" id="wl-desc" rows="2" required style="width:100%;box-sizing:border-box;margin-top:2px;resize:vertical" placeholder="请填写工作内容描述"></textarea><div id="wl-desc-hint" style="display:none;font-size:10px;color:var(--danger);margin-top:1px">请填写工作描述</div></div>' +
    '</div>';
    openDialog('记录工时', html, [
      {text:'取消',onclick:'_closeWorklogDialog()'},
      {text:'提交',cls:'btn-primary',onclick:'submitWorklog('+taskId+')'}
    ], {maxWidth:450, keepExisting: true});
  }).catch(function() {
    showToast('加载任务信息失败', 'error');
  });
}

function openWorklogEditDialog(wlId, taskId) {
  Promise.all([
    API.get('/worklogs?task_id='+taskId),
    API.get('/tasks/'+taskId)
  ]).then(function(results) {
    var logs = results[0]||[];
    var task = results[1]||{};
    var w = logs.find(function(l){return l.id===wlId;});
    if(!w){showToast('未找到工时记录','error');return;}
    editWorklogEntry({
      id: w.id, task_id: w.task_id,
      project_id: task.project_id, project_code: task.project_code, project_name: task.project_name,
      stage_name: task.stage_name, title: task.title || task.name,
      hours: w.hours, description: w.description, progress: task.progress,
      reviewer_name: task.reviewer_name, reviewer_id: task.reviewer_id,
      source: 'task'
    }, w.date || '');
  }).catch(function(e){showToast('加载失败: '+(e.message||''),'error');});
}

function _wlCheckOverBudget(taskId) {
  var hoursEl = document.getElementById('wl-hours');
  var obEl = document.getElementById('wl-over-budget');
  if (!hoursEl || !obEl) return;
  var h = parseFloat(hoursEl.value) || 0;
  // Fetch current consumed to check if new hours exceed estimate
  API.get('/tasks/'+taskId).then(function(task) {
    var cons = (task.consumed_hours || 0);
    var est = task.estimate_hours || 0;
    if (est > 0 && cons + h > est) {
      obEl.style.display = '';
    }
  }).catch(function(){});
}

var _wlPendingSubmit = null;

async function submitWorklog(taskId) {
  var hours = parseFloat(document.getElementById('wl-hours').value);
  var progress = parseInt(document.getElementById('wl-progress').value);
  var desc = document.getElementById('wl-desc').value.trim();
  var date = document.getElementById('wl-date').value;
  var remainingEl = document.getElementById('wl-remaining');
  // Clear all hints
  ['wl-date-hint','wl-hours-hint','wl-progress-hint','wl-desc-hint'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.style.display = 'none';
  });
  var valid = true;
  if (!date) { var h = document.getElementById('wl-date-hint'); if (h) h.style.display = ''; valid = false; }
  if (!hours || hours <= 0) { var h = document.getElementById('wl-hours-hint'); if (h) h.style.display = ''; valid = false; }
  if (isNaN(progress) || progress < 0 || progress > 100) { var h = document.getElementById('wl-progress-hint'); if (h) h.style.display = ''; valid = false; }
  if (!desc) { var h = document.getElementById('wl-desc-hint'); if (h) h.style.display = ''; valid = false; }
  if (!valid) return;

  // If progress >= 100, show confirmation before saving
  if (progress >= 100) {
    _wlPendingSubmit = { taskId: taskId, hours: hours, progress: progress, desc: desc, date: date };
    var approvalEnabled = window._approvalEnabled;
    var reviewerName = document.getElementById('wl-reviewer-name');
    var rname = reviewerName ? reviewerName.value.trim() : '';
    if (approvalEnabled) {
      var reviewMsg = rname ? '，评审人: <b>' + escHtml(rname) + '</b>' : '，评审人: <b>待分配</b>';
      openDialog('确认提交工时',
        '<div style="font-size:13px;margin-bottom:8px">进度 <b>100%</b>，任务将进入<b>评审中</b>状态' + reviewMsg + '。</div>' +
        '<div style="font-size:11px;color:var(--muted)">确认后工时记录将保存，任务状态将自动更新。</div>',
        [
          {text: '取消', onclick: '_wlCancelSubmit()'},
          {text: '确认', cls: 'btn-primary', onclick: '_wlConfirmSubmit()'},
        ],
        {hideClose: true, overlayClass: 'wl-submit-confirm-overlay', keepExisting: true}
      );
    } else {
      openDialog('确认提交工时',
        '<div style="font-size:13px;margin-bottom:8px">进度 <b>100%</b>，任务将自动切换为<b>已完成</b>状态。</div>' +
        '<div style="font-size:11px;color:var(--muted)">确认后工时记录将保存，任务状态将自动更新。</div>',
        [
          {text: '取消', onclick: '_wlCancelSubmit()'},
          {text: '确认', cls: 'btn-primary', onclick: '_wlConfirmSubmit()'},
        ],
        {hideClose: true, overlayClass: 'wl-submit-confirm-overlay', keepExisting: true}
      );
    }
    return;
  }

  await _doSubmitWorklog(taskId, hours, progress, desc, date);
}

function _wlCancelSubmit() {
  var d = document.querySelector('.wl-submit-confirm-overlay'); if (d) d.remove();
  _wlPendingSubmit = null;
  // Worklog dialog stays open with data preserved
}

async function _wlConfirmSubmit() {
  var d = document.querySelector('.wl-submit-confirm-overlay'); if (d) d.remove();
  if (!_wlPendingSubmit) return;
  var p = _wlPendingSubmit;
  _wlPendingSubmit = null;
  await _doSubmitWorklog(p.taskId, p.hours, p.progress, p.desc, p.date);
}

async function _doSubmitWorklog(taskId, hours, progress, desc, date) {
  var remainingEl = document.getElementById('wl-remaining');
  try {
    await API.post('/worklogs', {task_id:taskId, hours:hours, date:date, description:desc});
    var taskRes = await API.put('/tasks/'+taskId, {progress:progress});
    // Show auto-status-change hints (e.g. "进度已达100%，任务已自动完成")
    if (taskRes && taskRes.auto_messages && taskRes.auto_messages.length) {
      taskRes.auto_messages.forEach(function(msg) { showToast(msg, 'success'); });
    }
    // If over budget and remaining hours specified, extend estimate
    if (remainingEl && remainingEl.value) {
      var remaining = parseFloat(remainingEl.value);
      if (remaining > 0) {
        var task = await API.get('/tasks/'+taskId);
        var newConsumed = (task.consumed_hours || 0) + hours;
        var total = newConsumed + remaining;
        await API.post('/tasks/'+taskId+'/extend-estimate', {additional_hours: total - (task.estimate_hours || 0)});
      }
    }
    showToast('工时已记录', 'success');
    _closeWorklogDialog();
    _refreshTaskDetailContent(taskId);
    loadTaskData();
  } catch(e) { showToast('记录失败: '+(e.message||'未知错误'), 'error'); }
}

var _wlEditPendingSubmit = null;

async function _submitWorklogEdit(wlId, taskId) {
  var hours = parseFloat(document.getElementById('wl-hours').value);
  var progress = parseInt(document.getElementById('wl-progress').value);
  var desc = document.getElementById('wl-desc').value.trim();
  var date = document.getElementById('wl-date').value;
  // Clear all hints
  ['wl-date-hint','wl-hours-hint','wl-progress-hint','wl-desc-hint'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.style.display = 'none';
  });
  var valid = true;
  if (!date) { var h = document.getElementById('wl-date-hint'); if (h) h.style.display = ''; valid = false; }
  if (!hours || hours <= 0) { var h = document.getElementById('wl-hours-hint'); if (h) h.style.display = ''; valid = false; }
  if (isNaN(progress) || progress < 0 || progress > 100) { var h = document.getElementById('wl-progress-hint'); if (h) h.style.display = ''; valid = false; }
  if (!desc) { var h = document.getElementById('wl-desc-hint'); if (h) h.style.display = ''; valid = false; }
  if (!valid) return;

  // If progress >= 100, show confirmation before saving
  if (progress >= 100) {
    _wlEditPendingSubmit = { wlId: wlId, taskId: taskId, hours: hours, progress: progress, desc: desc, date: date };
    var approvalEnabled = window._approvalEnabled;
    var reviewerName = document.getElementById('wl-reviewer-name');
    var rname = reviewerName ? reviewerName.value.trim() : '';
    if (approvalEnabled) {
      var reviewMsg = rname ? '，评审人: <b>' + escHtml(rname) + '</b>' : '，评审人: <b>待分配</b>';
      openDialog('确认提交工时',
        '<div style="font-size:13px;margin-bottom:8px">进度 <b>100%</b>，任务将进入<b>评审中</b>状态' + reviewMsg + '。</div>' +
        '<div style="font-size:11px;color:var(--muted)">确认后工时记录将保存，任务状态将自动更新。</div>',
        [
          {text: '取消', onclick: '_wlEditCancelSubmit()'},
          {text: '确认', cls: 'btn-primary', onclick: '_wlEditConfirmSubmit()'},
        ],
        {hideClose: true, overlayClass: 'wl-edit-confirm-overlay', keepExisting: true}
      );
    } else {
      openDialog('确认提交工时',
        '<div style="font-size:13px;margin-bottom:8px">进度 <b>100%</b>，任务将自动切换为<b>已完成</b>状态。</div>' +
        '<div style="font-size:11px;color:var(--muted)">确认后工时记录将保存，任务状态将自动更新。</div>',
        [
          {text: '取消', onclick: '_wlEditCancelSubmit()'},
          {text: '确认', cls: 'btn-primary', onclick: '_wlEditConfirmSubmit()'},
        ],
        {hideClose: true, overlayClass: 'wl-edit-confirm-overlay', keepExisting: true}
      );
    }
    return;
  }

  await _doSubmitWorklogEdit(wlId, taskId, hours, progress, desc, date);
}

function _wlEditCancelSubmit() {
  var d = document.querySelector('.wl-edit-confirm-overlay'); if (d) d.remove();
  _wlEditPendingSubmit = null;
  // Worklog edit dialog stays open with data preserved
}

async function _wlEditConfirmSubmit() {
  var d = document.querySelector('.wl-edit-confirm-overlay'); if (d) d.remove();
  if (!_wlEditPendingSubmit) return;
  var p = _wlEditPendingSubmit;
  _wlEditPendingSubmit = null;
  await _doSubmitWorklogEdit(p.wlId, p.taskId, p.hours, p.progress, p.desc, p.date);
}

async function _doSubmitWorklogEdit(wlId, taskId, hours, progress, desc, date) {
  try {
    await API.put('/worklogs/'+wlId, {hours:hours, date:date, description:desc});
    var taskRes = await API.put('/tasks/'+taskId, {progress:progress});
    // Show auto-status-change hints (e.g. "进度已达100%，任务已自动完成")
    if (taskRes && taskRes.auto_messages && taskRes.auto_messages.length) {
      taskRes.auto_messages.forEach(function(msg) { showToast(msg, 'success'); });
    }
    showToast('工时已更新', 'success');
    _closeWorklogDialog();
    _refreshTaskDetailContent(taskId);
    loadTaskData();
  } catch(e) { showToast('更新失败: '+(e.message||'未知错误'), 'error'); }
}

function deleteWorklogById(wlId, taskId) {
  if (!confirm('确认删除此工时记录？')) return;
  API.del('/worklogs/' + wlId).then(function() {
    showToast('已删除', 'success');
    _refreshTaskDetailContent(taskId);
    loadTaskData();
  }).catch(function(e) { showToast('删除失败: ' + (e.message || ''), 'error'); });
}

function _refreshTaskWorklogs(taskId) {
  API.get('/worklogs?task_id=' + taskId).then(function(logs) {
    var el = document.getElementById('tv-worklogs');
    if (!el) el = document.getElementById('tf-worklogs');
    if (el) { el.innerHTML = _renderWorklogTable(logs || [], taskId); _initWorklogDt(logs || [], taskId); }
    // Update consumed hours in section header (both detail and edit dialogs)
    var totalHours = (logs || []).reduce(function(sum, l) { return sum + (l.hours || 0); }, 0);
    var headers = document.querySelectorAll('.section-title');
    headers.forEach(function(h) {
      if (h.textContent.indexOf('工时日志') === 0) {
        h.textContent = '工时日志 (' + totalHours.toFixed(1) + 'h)';
      }
    });
  }).catch(function() {});
}

/* ── Worklogs (in task dialog) ── */

/* ── Comments ── */

async function _loadComments(taskId) {
  var el = document.getElementById('tf-comments');
  if (!el) return;
  try {
    var comments = await API.get('/task-comments?task_id=' + taskId);
    if (!comments || !comments.length) {
      el.innerHTML = '<div style="color:var(--muted);font-size:12px">暂无评论</div>';
      return;
    }
    var html = '';
    comments.forEach(function(c) {
      html += '<div style="padding:6px 0;border-bottom:1px solid var(--border)">' +
        '<div style="font-size:10px;color:var(--muted);margin-bottom:2px">' + escHtml(c.display_name || c.username) + ' · ' + (fmtISODateTime(c.created_at) || '') + '</div>' +
        '<div style="font-size:13px">' + escHtml(c.content) + '</div>' +
      '</div>';
    });
    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<div style="color:var(--danger)">加载失败</div>'; }
}

async function submitComment(taskId) {
  var input = document.getElementById('tf-comment-input');
  if (!input || !input.value.trim()) return;
  try {
    await API.post('/task-comments', {task_id: taskId, content: input.value.trim()});
    input.value = '';
    _loadComments(taskId);
  } catch(e) {
    showToast('评论失败: ' + (e.message || ''), 'error');
  }
}

/* ── Delete Task ── */

async function deleteTask(taskId, taskName) {
  var taskTitle = taskName || '';
  if (!taskTitle) {
    // Fallback DOM search if title not passed
    var rows = document.querySelectorAll('#task-content tr[data-task-id="' + taskId + '"]:not(.task-stage-row), #pma-tasks-content tr[data-task-id="' + taskId + '"]:not(.task-stage-row)');
    for (var i = 0; i < rows.length; i++) {
      var link = rows[i].querySelector('[onclick*="openTaskViewDialog"],[onclick*="openTaskDetail"]');
      if (link) { taskTitle = link.textContent.trim(); break; }
    }
  }
  var label = '#' + taskId + (taskTitle ? ': ' + taskTitle : '');
  openDialog('删除任务',
    '<div class="confirm-dlg">确认删除任务 <b>' + escHtml(label) + '</b>？<br><br>相关工时记录和评论也会被删除。</div>',
    [{text: '取消', onclick: 'closeSharedDialog()'},
     {text: '确认删除', cls: 'btn-danger', onclick: 'closeSharedDialog();doDeleteTask(' + taskId + ',\'' + escHtml(label).replace(/'/g, "\\'") + '\')'}],
    {hideClose: true});
}
async function doDeleteTask(taskId, taskTitle) {
  var ok = await verifyPassword('删除任务: ' + (taskTitle || '#' + taskId), 'skip_task_delete');
  if (!ok) return;
  try {
    await API.del('/tasks/' + taskId);
    showToast('任务已删除', 'success');
    loadTaskData();
  } catch(e) {
    showToast('删除失败: ' + (e.message || ''), 'error');
  }
}

