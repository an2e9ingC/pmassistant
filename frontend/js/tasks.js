/* ═══════════════════════════════════════════════════
   PMA NATIVE TASKS — table/board/calendar views
   ═══════════════════════════════════════════════════ */

// ── task:before-save — progress/status bidirectional sync ──
EventBus.on('task:before-save', function(e) {
  var p = e.progress, s = e.status;
  // progress > 0 and status is todo → in_progress
  if (p > 0 && p < 100 && s === 'todo') { e.data.status = 'in_progress'; e.status = 'in_progress'; }
  // progress >= 100 → review (with approval) or done
  if (p >= 100 && s !== 'review' && s !== 'done') { e.data.status = window._approvalEnabled ? 'review' : 'done'; e.status = e.data.status; }
  // done + progress drops below 100 → back to in_progress
  if (s === 'done' && p < 100) { e.data.status = 'in_progress'; e.status = 'in_progress'; }
  // 仍为 todo 却有进度 → 不一致，回退为 0（用 e.status 而非原始 s，避免误覆盖上面已推进的状态）
  if (e.status === 'todo' && p > 0) { e.data.progress = 0; e.progress = 0; }
  // review + progress drops below 100 → back to in_progress
  if (s === 'review' && p < 100) { e.data.status = 'in_progress'; e.status = 'in_progress'; }
});

var _taskViewMode = 'table';  // 'table' | 'board' | 'calendar'

// _hasProjectEditPerm moved to utils.js

function _hasTaskEditPerm() {
  if (typeof getCurrentUser !== 'function') return false;
  var user = getCurrentUser();
  var perms = (user && user.permissions) ? user.permissions.split(',') : [];
  return perms.indexOf('task_edit') !== -1 || perms.indexOf('admin') >= 0;
}

// ── Inline Edit Engine ──

var _STATUS_OPTS = [{v:'todo',l:'待办'},{v:'in_progress',l:'进行中'},{v:'review',l:'评审中'},{v:'done',l:'已完成'}];
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
  if (field.dataset.readonly === '1') { showToast('该字段由模板控制，不可修改', 'error'); return; }

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
    if (fieldName === 'assignee_id') {
      // Multi-assignee: open dialog with multi-user selector
      _cancelInlineEdit(field.querySelector('.ef-cancel-btn') || field);
      _openMultiAssignDialog(field);
      return;
    }
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
    if (fieldName === 'progress') {
      // Open slider dialog for progress editing
      _cancelInlineEdit(el);
      _openProgressInlineEdit(field);
      return;
    }
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
    var taId = 'ef-ta-' + taskId + '-' + fieldName;
    field.innerHTML = '<textarea class="search-inp ef-input" id="' + taId + '" rows="4" style="width:100%;box-sizing:border-box;font-size:13px;margin-top:1px;resize:vertical">' + escHtml(currentVal) + '</textarea>' +
      '<div id="' + taId + '-img-preview" style="margin-top:4px;min-height:0;max-height:30vh;overflow-y:auto"></div>' +
      '<div style="display:flex;gap:10px;margin-top:6px"><button class="btn-xs ef-save-btn" onclick="event.stopPropagation();_saveInlineEdit(this)">✓</button><button class="btn-xs ef-cancel-btn" onclick="event.stopPropagation();_cancelInlineEdit(this)">✕</button></div>';
    var inp = field.querySelector('.ef-input');
    if (inp) { setTimeout(function() { inp.focus(); }, 50); }
    // Init rich text editor for description
    setTimeout(function() { initRichEditor(taId, {height: 300}); }, 100);
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

function _openProgressInlineEdit(field) {
  var taskId = field.dataset.taskId;
  var currentPct = parseInt(field.dataset.currentValue) || 0;
  var html = _renderProgressSlider('ef-p', currentPct);
  openDialog('修改进度', html, [
    {text: '取消', onclick: 'closeSharedDialog()'},
    {text: '保存', cls: 'btn-primary', onclick: '_saveProgressInline(' + taskId + ')'}
  ], {maxWidth: 360});
}

async function _saveProgressInline(taskId) {
  var val = parseInt(document.getElementById('ef-p-slider').value) || 0;
  try {
    // 进度驱动状态自动更新（状态不可手动改，只能由进度自动更新）
    var statusEl = document.getElementById('task-status-' + taskId);
    var data = {progress: val};
    var evt = {data: data, progress: val, status: statusEl ? statusEl.getAttribute('data-status') : 'todo'};
    EventBus.emit('task:before-save', evt);
    await API.put('/tasks/' + taskId, data);
    closeSharedDialog();
    showToast('进度已更新: ' + val + '%', 'success');
    // 发出事件，由注册的监听刷新页面（原位更新，避免整页重渲染）
    EventBus.emit('task:field-changed', {taskId: taskId, payload: data});
  } catch(e) { showToast('更新失败: ' + (e.message || ''), 'error'); }
}

/** 详情页进度/状态原位更新（事件驱动，不整页重渲染） */
async function _refreshTaskProgressField(taskId) {
  if (!document.querySelector('.task-detail-page')) return;
  try {
    var t = await API.get('/tasks/' + taskId);
    var progField = document.querySelector('.editable-field[data-field="progress"]');
    if (progField) {
      progField.dataset.currentValue = String(t.progress || 0);
      var wrap = progField.querySelector('.ring-wrap');
      if (wrap) wrap.outerHTML = renderProgressCircle(t.progress || 0, 30, {label:''});
    }
    var statusEl = document.getElementById('task-status-' + taskId);
    if (statusEl) {
      statusEl.setAttribute('data-status', t.status || 'todo');
      var reviewerLine = (t.status === 'review' && t.reviewer_name)
        ? '<div style="font-size:10px;color:var(--muted);margin-top:2px">审批人: ' + escHtml(t.reviewer_name) + '</div>'
        : '';
      statusEl.innerHTML = renderPill(t.status || 'todo') + reviewerLine;
    }
  } catch(e) { /* non-critical */ }
}

function _renderUserSelect(field, currentVal) {
  var users = window._allUsers || [];
  var opts = users.map(function(u) { return {v: u.id, l: u.display_name || u.name || u.username}; });
  opts.unshift({v: '', l: '— 未分配 —'});
  field.dataset.opts = encodeURIComponent(JSON.stringify(opts));
  field.dataset.inputType = 'select';
  _renderSelectField(field, currentVal, opts);
}

/* ── Inline Multi-Assignee Dialog ── */
function _openMultiAssignDialog(field) {
  var taskId = field.dataset.taskId;
  // Fetch task to get current assignee IDs
  API.get('/tasks/' + taskId).then(function(task) {
    var currentIds = task.assignee_ids || (task.assignee_id ? [task.assignee_id] : []);
    window._mu_im_assignee = currentIds.slice();
    var html = '<div>' +
      '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">负责人</label>' +
        '<div id="im-assignee-wrap"></div></div>' +
      '</div>';
    openDialog('编辑负责人', html, [
      {text: '取消', onclick: 'closeSharedDialog()'},
      {text: '保存', cls: 'btn-primary', onclick: '_saveMultiAssignInline(' + taskId + ')'}
    ], {maxWidth: 420});
    loadAllUsers().then(function() {
      var wrap = document.getElementById('im-assignee-wrap');
      if (wrap) {
        wrap.innerHTML = createMultiUserSelector({
          containerId: 'im-assignee',
          selectedIds: currentIds.slice(),
          placeholder: '搜索并添加负责人...'
        });
        _muRenderTags('im-assignee');
      }
    });
  }).catch(function(e) { showToast('加载失败: ' + (e.message || ''), 'error'); });
}

async function _saveMultiAssignInline(taskId) {
  var ids = window._mu_im_assignee || [];
  try {
    await API.put('/tasks/' + taskId, { assignee_id: ids.length ? ids[0] : null, assignee_ids: ids.length ? ids : null });
    closeSharedDialog();
    showToast('已更新', 'success');
    EventBus.emit('task:saved', { taskId: taskId });
  } catch(e) { showToast('更新失败: ' + (e.message || ''), 'error'); }
}

async function _saveInlineEdit(el) {
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

  // HugeRTE editor syncs content to textarea automatically; no upload needed

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

  // 进度驱动状态自动更新（状态不可手动改，只能由进度自动更新）
  if (fieldName === 'progress') {
    var statusEl = document.getElementById('task-status-' + taskId);
    var evt = {data: data, progress: parseInt(newVal) || 0, status: statusEl ? statusEl.getAttribute('data-status') : 'todo'};
    EventBus.emit('task:before-save', evt);
    // Confirm dialog when progress reaches 100 in review mode
    if (evt.progress >= 100 && evt.status === 'review') {
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
          // (editor init moved to dynamic textarea creation)
        }, 100);
      }).catch(function() {});
    }
    EventBus.emit('task:saved', {taskId: taskId});
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
  renderTimeline('task', taskId, 'task-detail-comments');
}

// DEPRECATED: replaced by openCommentDialog() (rich-text dialog)
function _submitDetailComment(taskId) {
  openCommentDialog('task', taskId);
}

var _taskProjectId = null;   // null = show project selector
var _taskProjectCode = null;  // project code (e.g. PE0450) for API calls
var _taskProjectName = '';
var _taskFilterStatus = '';
var _taskFilterExecution = '';
var _taskFilterAssignee = '';
var _taskFilterStage = '';    // stage_name filter (set from Gantt click)

/* ── Entry Point ── */

function initTasks(firstArg) {
  // Route to detail/edit if first arg is a numeric task ID
  var taskId = parseInt(firstArg);
  if (!isNaN(taskId) && taskId > 0) {
    var isEdit = arguments[1] === 'edit';
    if (isEdit) { initTaskEdit(taskId); } else { initTaskDetail(taskId); }
    return;
  }
  // Default: render task list
  _taskProjectId = null;
  _taskFilterStatus = '';
  _taskFilterExecution = '';
  _taskFilterAssignee = 'me';
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
      '</select>';
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
        '</select>' +
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
      { key: 'id', title: '任务编号', width: '7%', minWidth: 75, render: function(v) { return '<span style="font-size:11px;font-family:var(--mono);color:var(--muted)">#' + v + '</span>'; } },
      { key: 'project_code', title: '项目编号', width: '8%', minWidth: 90, render: function(v, row) { return v ? projCodeTag(v, 'openProject(\''+escHtml(v).replace(/'/g,"\\'")+'\')', row.project_name) : '-'; } },
      { key: 'project_name', title: '项目名称', width: '10%', minWidth: 100, align: 'left', render: function(v) { return '<span style="font-size:12px">'+escHtml(v||'-')+'</span>'; } },
      { key: 'fav', title: '', width: '28px', minWidth: 28, render: function(v, row) { return favStar('task', row.id, {stopPropagation: true}); } },
      { key: 'title', title: '标题', minWidth: 100, align: 'left', className: 'dt-wrap', render: function(v, row) { return '<a href="javascript:void(0)" onclick="openTaskDetail('+row.id+')" style="color:var(--accent)">'+escHtml(v||'')+'</a>'; } },
      { key: 'stage_name', title: '阶段', width: '9%', minWidth: 100, render: function(v) { return v ? '<span style="font-size:11px;color:var(--muted)">'+escHtml(v)+'</span>' : '-'; } },
      { key: 'status', title: '状态', width: '6%', minWidth: 80, render: function(v, row) {
        var h = renderPill(v||'todo');
        if (window._approvalEnabled) h = '<span style="cursor:pointer" onclick="event.stopPropagation();openReviewerDialog('+row.id+')" title="'+(row.reviewer_name?'审批人: '+escHtml(row.reviewer_name)+' — 点击修改':'点击设置审批人')+'">'+h+'</span>';
        return h;
      }},
      { key: 'priority', title: '优先级', width: '5%', minWidth: 65, render: function(v) { return renderPriorityBadge(v); } },
      { key: 'progress', title: '进度', width: '6%', minWidth: 60, render: function(v) { return renderProgressCircle(v||0, 26, {label:''}); } },
      { key: 'due_date', title: '截止日期', width: '6%', minWidth: 100, render: function(v, row) { return '<span style="color:'+(v&&row.status!=='done'&&row.status!=='done'&&v<fmtLocalDate()?'var(--danger)':'')+'">'+(v||'-')+'</span>'; } },
      { key: 'actions', title: '操作', width: actionColWidth(3) + 'px', minWidth: actionColWidth(3), render: function(v, row) { return iconEdit('openTaskDialog('+row.id+')','编辑任务')+iconCopy('openCopyTaskDialog('+row.id+')','复制任务')+iconDelete('deleteTask('+row.id+',\''+escJs(row.title)+'\')','删除任务'); } }
    ],
    data: tasks,
    maxHeight: 'calc(100vh - 220px)',
    selectable: true,
    checkboxPosition: 3,
    onSelectChange: function(rows) {
      _selectedTasks = new Set(rows.map(function(r) { return r.id; }));
      _ensureBatchToolbar();
      if (typeof _updateBatchToolbar === 'function') _updateBatchToolbar();
    }
  });
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
      { key: '_stage', title: '阶段', width: '10%', minWidth: 100, rowspan: true, render: function(v, row, idx, count) {
        if (row._empty) return escHtml(v||'');
        var stageId = row._stageId;
        var cell = stageId
          ? '<button class="gs-btn" onclick="openStageDialog(' + stageId + ');event.stopPropagation()" title="查看/编辑阶段信息">' + escHtml(v||'') + '</button>'
          : escHtml(v||'');
        return '<div>' + cell + ' <sup style="font-size:9px;color:var(--accent);background:var(--accent-lt);padding:1px 4px;border-radius:8px">' + (count||row._stageCount||1) + '</sup></div>';
      }},
      { key: 'title', title: '任务标题', minWidth: 100, align: 'left', render: function(v, row) { return row._empty?'—':'<span style="cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" onclick="openTaskDetail('+row.id+')" title="查看任务详情">'+escHtml(v||'')+'</span>'; } },
      { key: 'fav', title: '', width: '28px', minWidth: 28, render: function(v, row) { return row._empty ? '' : favStar('task', row.id, {stopPropagation: true}); } },
      { key: 'status', title: '状态', width: '6%', minWidth: 80, render: function(v, row) { return row._empty?'—':renderPill(v||'todo'); } },
      { key: 'priority', title: '优先级', width: '5%', minWidth: 65, render: function(v, row) { return row._empty?'—':(typeof renderPriorityBadge==='function'?renderPriorityBadge(v):escHtml(v||'medium')); } },
      { key: 'assignee_name', title: '负责人', width: '13%', minWidth: 160, render: function(v, row) { return row._empty?'—':'<span style="font-size:12px;cursor:pointer;color:var(--accent)" onclick="event.stopPropagation();openAssignDialog('+row.id+')" title="指派任务">'+_renderAssigneeDisplay(row.assignee_names||[], row.id, {fallback: v||'—'})+'</span>'; } },
      { key: 'progress', title: '进度', width: '7%', minWidth: 60, render: function(v, row) { return row._empty?'—':(typeof renderProgressRing==='function'?'<div style="display:inline-block;vertical-align:middle">'+renderProgressRing(v||0)+'</div>':'<span>'+(v||0)+'%</span>'); } },
      { key: 'start_date', title: '计划开始', width: '7%', minWidth: 100, render: function(v, row) {
        if (row._empty) return '—';
        var s = v || row._stageStart || null;
        return '<span style="font-size:12px;color:'+(s?'var(--fg)':'var(--muted)')+'" title="'+(s?escHtml(s):'默认取阶段开始时间')+'">'+escHtml(s||'—')+'</span>';
      }},
      { key: 'due_date', title: '截止日期', width: '7%', minWidth: 100, render: function(v, row) { return row._empty?'—':'<span style="font-size:12px">'+(v||'—')+'</span>'; } },
      { key: 'completed_at', title: '完成日期', width: '7%', minWidth: 100, render: function(v, row) { return row._empty?'—':'<span style="font-size:12px">'+(v?formatDate(v):'—')+'</span>'; } },
      { key: 'latest_activity', title: '最新动态', width: '10%', minWidth: 120, align: 'left', render: function(v, row) { return row._empty?'—':(typeof _renderLatestActivity==='function'?_renderLatestActivity(row):'<span style="font-size:11px;color:var(--muted)">—</span>'); } },
      { key: 'latest_time', title: '时间', width: '6%', render: function(v, row) { return row._empty?'—':''; } },
      { key: 'actions', title: '操作', width: actionColWidth(2) + 'px', minWidth: actionColWidth(2), render: function(v, row) { return row._empty?'<span style="color:var(--muted);font-size:12px">—</span>':'<span style="white-space:nowrap" onclick="event.stopPropagation()">'+iconEdit('openTaskDialog('+row.id+')')+iconDelete('deleteTask('+row.id+',\''+escJs(row.title)+'\')')+'</span>'; } }
    ],
    data: flatRows,
    maxHeight: 'calc(100vh - 340px)',
    selectable: true,
    checkboxPosition: 1,
    onSelectChange: function(rows) { _selectedTasks = new Set(rows.map(function(r) { return r.id; })); _ensureBatchToolbar(); if (typeof _updateBatchToolbar === 'function') _updateBatchToolbar(); }
  });
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
  var assigneeName = _renderAssigneeDisplay(t.assignee_names || [], t.id, {fallback: t.assignee_name || t.assignee_username || '—'});
  var effectiveStart = t.start_date || stageStart || null;
  var startDateStr = effectiveStart || '—';
  var startTitle = effectiveStart ? escHtml(effectiveStart) : (stageStart ? '默认取阶段开始时间' : '未设置');
  return '<td style="text-align:left;cursor:pointer" onclick="openTaskDetail(' + t.id + ')" title="查看任务详情">' + escHtml(t.title) + '</td>' +
    '<td style="text-align:center' + (window._approvalEnabled ? ';cursor:pointer' : '') + '"' + (window._approvalEnabled ? ' onclick="event.stopPropagation();openReviewerDialog(' + t.id + ')" title="' + (t.status === 'review' && t.reviewer_name ? '审批人: ' + escHtml(t.reviewer_name) + ' — 点击修改' : '点击修改审批人') + '"' : '') + '>' + renderPill(t.status || 'todo') + '</td>' +
    '<td style="text-align:center">' + (typeof renderPriority === 'function' ? renderPriority(t.priority) : escHtml(t.priority || 'medium')) + '</td>' +
    '<td style="font-size:12px;cursor:pointer;color:var(--accent)" onclick="event.stopPropagation();openAssignDialog(' + t.id + ')" title="指派任务">' + assigneeName + '</td>' +
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

  API.get('/tasks/template-preview?project_id=' + encodeURIComponent(_taskProjectId)).then(function(data) {
    var stages = (data && data.stages) ? data.stages : [];
    var hasDeleted = false;
    var rows = '';

    stages.forEach(function(stage) {
      var tasks = stage.tasks || [];
      tasks.forEach(function(t) {
        var status = t.status;
        var disabled = '';
        var checked = '';
        var statusText = '';
        var statusColor = '';
        var checkbox = '';

        switch (status) {
          case 'missing':
            checked = ' checked';
            statusText = '缺失';
            statusColor = 'var(--warn)';
            checkbox = '<input type="checkbox" value="' + t.template_id + '" data-status="' + status + '"' + checked + disabled + '>';
            break;
          case 'exists_active':
            checked = ' checked';
            disabled = ' disabled';
            statusText = '已导入';
            statusColor = 'var(--muted)';
            checkbox = '<input type="checkbox" value="' + t.template_id + '" data-status="' + status + '"' + checked + disabled + '>';
            break;
          case 'exists_deleted':
            hasDeleted = true;
            statusText = '已删除';
            statusColor = 'var(--danger)';
            checkbox = '<input type="checkbox" value="' + t.template_id + '" data-status="' + status + '"' + checked + disabled + '>';
            break;
          case 'exists_diverged':
            disabled = ' disabled';
            statusText = '已修改';
            statusColor = 'var(--warn)';
            checkbox = '<input type="checkbox" value="' + t.template_id + '" data-status="' + status + '"' + checked + disabled + '>';
            break;
          case 'exists_manual':
            statusText = '手动';
            statusColor = 'var(--muted)';
            checkbox = '<span style="font-size:10px;color:var(--muted)">—</span>';
            break;
        }

        rows += '<tr>' +
          '<td>' + checkbox + '</td>' +
          '<td style="font-size:11px;color:var(--muted)">' + escHtml(stage.stage_name || '') + '</td>' +
          '<td>' + escHtml(t.task_name) + '</td>' +
          '<td><span style="color:' + statusColor + '">' + statusText + '</span></td>' +
          '</tr>';
      });
    });

    var html = '<div style="max-height:400px;overflow-y:auto"><table class="proj-table" style="width:100%;table-layout:auto"><thead><tr><th style="width:30px">选</th><th style="width:90px">阶段</th><th>任务名</th><th style="width:55px">状态</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    if (hasDeleted) {
      html += '<div style="margin-top:8px;font-size:11px;color:var(--warn)">已删除的任务可勾选后强制重新导入</div>';
    }

    openDialog('导入模板任务', html, [
      {text: '取消', onclick: 'closeSharedDialog()'},
      {text: '确认导入', cls: 'btn-primary', onclick: 'doImportTasksFromTemplates()'}
    ], {maxWidth: '85vw'});
  }).catch(function(e) { showToast('加载失败: ' + (e.message || ''), 'error'); });
}
function doImportTasksFromTemplates() {
  var cbs = document.querySelectorAll('.shared-dialog-overlay input[type=checkbox]:checked');
  var templateIds = [];
  cbs.forEach(function(cb) { templateIds.push(parseInt(cb.value)); });
  if (!templateIds.length) { showToast('请选择要导入的模板任务', 'error'); return; }

  API.post('/tasks/import-from-templates?project_id=' + encodeURIComponent(_taskProjectId), {template_ids: templateIds}).then(function(data) {
    showToast(data.message || '导入完成', 'success');
    closeSharedDialog();
    EventBus.emit('task:saved', {});
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
    EventBus.emit('task:deleted', {});
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
    EventBus.emit('task:saved', {});
  } catch(e) { showToast('初始化失败: ' + (e.message || ''), 'error'); }
}

function _renderTaskRow(t, stageMap) {
  var stageName = t.stage_name || t.execution_name || '';
  var progressPct = t.progress || 0;
  var overdue = t.due_date && t.status !== 'done' && t.status !== 'done' && t.due_date < fmtLocalDate();
  var projCode = t.project_code || '';
  return '<tr class="clickable">' +
    '<td style="font-size:11px;font-family:var(--mono);color:var(--muted)">#' + t.id + '</td>' +
    '<td>' + (projCode ? projCodeTag(projCode, 'openProject(\'' + escHtml(projCode).replace(/'/g, "\\'") + '\')', t.project_name) : '-') + '</td>' +
    '<td style="text-align:left;font-size:12px">' + escHtml(t.project_name || '-') + '</td>' +
    '<td style="text-align:center;width:22px" onclick="event.stopPropagation();if(event.target!==this.firstElementChild){var cb=this.firstElementChild;if(cb){cb.checked=!cb.checked;cb.onchange()}}"><input type="checkbox" value="' + t.id + '" onchange="_onTaskCheckbox(this)" class="task-checkbox"></td>' +
    '<td style="text-align:left"><a href="javascript:void(0)" onclick="openTaskDetail(' + t.id + ')" style="color:var(--accent)">' + escHtml(t.title) + '</a></td>' +
    '<td>' + (stageName ? '<span style="font-size:11px;color:var(--muted)">' + escHtml(stageName) + '</span>' : '-') + '</td>' +
    '<td style="' + (window._approvalEnabled ? 'cursor:pointer' : '') + '"' + (window._approvalEnabled ? ' onclick="event.stopPropagation();openReviewerDialog(' + t.id + ')" title="' + (t.reviewer_name ? '审批人: ' + escHtml(t.reviewer_name) + ' — 点击修改' : '点击设置审批人') + '"' : '') + '>' + renderPill(t.status || 'todo') + '</td>' +
    '<td>' + renderPriorityBadge(t.priority) + '</td>' +
    '<td>' + renderProgressCircle(progressPct, 26, {label:''}) + '</td>' +
    '<td style="color:' + (overdue ? 'var(--danger)' : '') + '">' + (t.due_date || '-') + '</td>' +
    '<td>' +
      iconEdit('openTaskDialog(' + t.id + ')', '编辑任务') +
      iconCopy('openCopyTaskDialog(' + t.id + ')', '复制任务') +
      iconDelete('deleteTask(' + t.id + ',\'' + escJs(t.title) + '\')', '删除任务') +
    '</td>' +
  '</tr>';
}

/* ── Board View (simplified — drag-and-drop in later iteration) ── */

/* Pie charts & calendar moved to components.js */

/* ── Task Dialog ── */

var _tfProjectId = null; // project numeric ID selected in the task form
var _tfProjectCode = null; // project code (e.g. PE0450) for API calls to /projects/{code}/...
var _tfAssigneeIds = []; // assignee IDs selected in the task form (multi-select)
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
    // 快捷跳转侧栏（区块 id 可能变化，重建链接）
    if (typeof updateDetailToc === 'function') updateDetailToc();
    // Re-init image paste for description
    setTimeout(function() {
      var descField = document.querySelector('.editable-field[data-field="description"]');
      if (descField && freshTask.description) {
        // (editor init moved to dynamic textarea creation)
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

/* ── Full-page Task Detail / Edit / Create ── */

function initTaskDetail(taskId) {
  taskId = parseInt(taskId);
  var viewEl = document.getElementById('view-tasks');
  if (!viewEl) return;
  viewEl.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted)">加载中...</div>';
  document.getElementById('topbar-title').textContent = '任务 #' + taskId;

  // 先加载收藏列表再渲染，确保标题栏星星在直接访问/刷新时状态正确
  Promise.all([
    API.get('/tasks/' + taskId),
    (typeof loadFavorites === 'function' ? loadFavorites() : Promise.resolve())
  ]).then(function(results) {
    var t = results[0];
    var html = '<div class="task-detail-page" style="max-width:1200px;margin:0 auto;padding:20px">' +
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">' +
        favStar('task', t.id, {size: '20px'}) +
        '<span style="font-size:15px;font-weight:620">任务 #' + t.id + ' · ' + escHtml(t.title) + '</span>' +
        '<span style="flex:1"></span>' +
        iconEdit('gotoView(\'tasks\', {params: [String(' + t.id + '), \'edit\']})', '编辑') +
      '</div>' +
      '<div class="task-detail-body">' +
        _renderTaskDetailBody(t) +
      '</div>' +
    '</div>';
    viewEl.innerHTML = html;
    document.getElementById('topbar-title').textContent = '任务 #' + t.id + ' · ' + (t.title || '');

    // Async load worklogs and comments
    _refreshTaskWorklogs(taskId);
    _loadDetailComments(taskId);
    // 快捷跳转侧栏
    if (typeof updateDetailToc === 'function') updateDetailToc();
  }).catch(function(e) {
    viewEl.innerHTML = '<div style="text-align:center;padding:40px;color:var(--danger)">加载失败: ' + escHtml(e.message || '') + '</div>';
  });
}

function initTaskEdit(taskId) {
  taskId = parseInt(taskId);
  var viewEl = document.getElementById('view-tasks');
  if (!viewEl) return;
  viewEl.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted)">加载中...</div>';
  document.getElementById('topbar-title').textContent = '编辑任务 #' + taskId;

  API.get('/tasks/' + taskId).then(function(data) {
    var t = data;

    var formHtml = _buildTaskForm(t, true); // true = edit mode
    var html = '<div class="task-edit-page" style="max-width:1200px;margin:0 auto;padding:20px">' +
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">' +
        '<button class="btn btn-sm" onclick="history.back()">← 返回</button>' +
        '<span style="font-size:15px;font-weight:620">编辑任务 #' + t.id + ' · ' + escHtml(t.title) + '</span>' +
        '<span style="flex:1"></span>' +
        '<button class="btn btn-sm btn-primary" onclick="_submitTaskFullPage(' + t.id + ')">保存</button>' +
      '</div>' +
      formHtml +
    '</div>';
    viewEl.innerHTML = html;
    document.getElementById('topbar-title').textContent = '编辑任务 #' + t.id + ' · ' + (t.title || '');

    setTimeout(function() { initRichEditor('tf-desc', {height: 360}); }, 100);
    _initTaskFormSelectors(t, true);
  }).catch(function(e) {
    viewEl.innerHTML = '<div style="text-align:center;padding:40px;color:var(--danger)">加载失败: ' + escHtml(e.message || '') + '</div>';
  });
}

function initTaskCreate() {
  var viewEl = document.getElementById('view-tasks');
  if (!viewEl) return;

  var formHtml = _buildTaskForm(null, false); // null = create mode
  var html = '<div class="task-create-page" style="max-width:1200px;margin:0 auto;padding:20px">' +
    '<div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">' +
      '<span style="font-size:15px;font-weight:620">新建任务</span>' +
      '<span style="flex:1"></span>' +
      '<button class="btn btn-sm btn-primary" onclick="_submitTaskFullPage(null)">创建</button>' +
    '</div>' +
    formHtml +
  '</div>';
  viewEl.innerHTML = html;
  document.getElementById('topbar-title').textContent = '新建任务';

  setTimeout(function() { initRichEditor('tf-desc', {height: 360}); }, 100);
  _initTaskFormSelectors(null, false);
}

/** Submit task from full-page create/edit form */
async function _submitTaskFullPage(taskId) {
  var desc = document.getElementById('tf-desc').value.trim();
  var title = (document.getElementById('tf-title') || {}).value || '';
  if (!title) { showToast('请输入任务标题', 'error'); return; }

  var data = {
    title: title,
    description: desc,
    project_id: _tfProjectId || null,
    execution_id: parseInt((document.getElementById('tf-execution') || {}).value) || null,
    assignee_ids: _tfAssigneeIds || [],
    reviewer_id: _tfReviewerId || null,
    estimate_hours: parseFloat((document.getElementById('tf-estimate') || {}).value) || null,
    start_date: (document.getElementById('tf-start-date') || {}).value || null,
    due_date: (document.getElementById('tf-due') || {}).value || null,
    priority: (document.getElementById('tf-priority') || {}).value || 'medium',
    status: (document.getElementById('tf-status') || {}).value || 'todo',
    progress: parseInt((document.getElementById('tf-progress') || {}).value) || 0,
  };

  if (!data.project_id) { showToast('请选择所属项目', 'error'); return; }
  if (!data.execution_id) { showToast('请选择阶段', 'error'); return; }
  if (!data.assignee_ids.length) { showToast('请选择负责人', 'error'); return; }
  if (!data.due_date) { showToast('请填写截止日期', 'error'); return; }

  try {
    if (taskId) {
      await API.put('/tasks/' + taskId, data);
      showToast('保存成功', 'success');
    } else {
      var result = await API.post('/tasks', data);
      showToast('创建成功', 'success');
      taskId = result.id || result.task_id;
    }
    setTimeout(function() { history.back(); }, 500);
  } catch(e) {
    showToast('操作失败: ' + (e.message || ''), 'error');
  }
}

function openTaskDetail(taskId) {
  gotoView('tasks', { params: [String(taskId)] });
}

var _card = 'background:var(--surface);border:1px solid var(--border);border-radius:var(--r-lg);padding:16px;margin-bottom:12px';
var _cardHd = 'font-size:14px;font-weight:620;letter-spacing:-0.01em;margin-bottom:10px';
var _grid2 = 'display:grid;grid-template-columns:1fr 1fr;gap:8px 16px';
var _grid4 = 'display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px 12px';
var _lbl = 'display:block;font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:2px';
var _val = 'font-size:13px';

function _renderTeamProgress(t) {
  var ids = t.assignee_ids || [];
  if (ids.length <= 1) return ''; // single assignee, no team progress needed

  var progressMap = t.assignee_progress || {};
  var names = t.assignee_names || [];
  var curUser = (typeof getCurrentUser === 'function' && getCurrentUser()) || {};
  var curUid = curUser ? (curUser.id || null) : null;
  var isMyTask = curUid && ids.indexOf(curUid) >= 0;

  var rows = '';
  ids.forEach(function(aid, i) {
    var pct = parseInt(progressMap[String(aid)] || progressMap[aid] || 0);
    var name = names[i] || ('#' + aid);
    var icon = pct >= 100 ? '&#9989;' : (pct > 0 ? '&#9203;' : '&#8987;'); // ✅, ⏳, ⌛
    rows += '<div style="display:flex;align-items:center;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--border);font-size:12px">' +
      '<span>' + icon + ' ' + escHtml(name) + '</span>' +
      '<span style="color:' + (pct >= 100 ? 'var(--success)' : (pct > 0 ? 'var(--accent)' : 'var(--muted)')) + ';font-weight:510">' + pct + '%</span>' +
      '</div>';
  });

  var myBtn = '';
  if (isMyTask) {
    var myPct = parseInt(progressMap[String(curUid)] || progressMap[curUid] || 0);
    myBtn = '<div style="margin-top:6px">' +
      '<button class="btn-xs" onclick="event.stopPropagation();_openMyProgressDialog(' + t.id + ',' + myPct + ')" style="background:var(--accent-lt);border-color:var(--accent);color:var(--accent)">&#9998; 更新我的进度</button>' +
      '</div>';
  }

  return '<div class="dkpi"><div class="dkpi-lbl">团队进度</div>' +
    '<div style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:6px 10px;margin-top:2px">' +
    rows + myBtn + '</div></div>';
}

function _openMyProgressDialog(taskId, currentPct) {
  var html = _renderProgressSlider('mp', currentPct, '更新你在该任务中的个人进度');
  openDialog('更新我的进度', html, [
    {text: '取消', onclick: 'closeSharedDialog()'},
    {text: '更新', cls: 'btn-primary', onclick: '_submitMyProgress(' + taskId + ')'}
  ], {maxWidth: 360});
}

async function _submitMyProgress(taskId) {
  var val = parseInt(document.getElementById('mp-slider').value) || 0;
  try {
    var res = await API.put('/tasks/' + taskId + '/my-progress', {progress: val});
    closeSharedDialog();
    if (res.auto_messages && res.auto_messages.length) {
      res.auto_messages.forEach(function(msg) { showToast(msg, 'success'); });
    } else {
      showToast('进度已更新: ' + val + '%', 'success');
    }
    EventBus.emit('task:saved', {taskId: taskId});
  } catch(e) { showToast('更新失败: ' + (e.message || ''), 'error'); }
}

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
  var overdue = t.due_date && t.status !== 'done' && t.status !== 'done' && t.due_date < fmtLocalDate();
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
  html += '<div style="display:flex;gap:16px;align-items:stretch">' +
    // ── 基本信息 ──
    '<div class="card info-glass-card" style="flex:1;min-width:0;padding:20px;display:flex;flex-direction:column">' +
      '<div class="section-hd"><span class="section-title">基本信息</span></div>' +
      '<div class="delivery-kpi" style="grid-template-columns:1fr 1fr;flex:1;grid-auto-rows:1fr;align-content:start">' +
        // Product (read-only)
        '<div class="dkpi"><div class="dkpi-lbl">产品</div><div class="dkpi-val">' + (t.product_code ? '<span class="proj-code-btn" onclick="openProductDetail(\'' + escHtml(t.product_code) + '\')" title="' + escHtml(t.product_name || '') + '">' + escHtml(t.product_code) + '</span> ' + escHtml(t.product_name || '') : escHtml(t.product_name || '-')) + '</div></div>' +
        // Project (read-only)
        '<div class="dkpi"><div class="dkpi-lbl">项目</div><div class="dkpi-val">' + projHtml + '</div></div>' +
        // Reporter (read-only)
        '<div class="dkpi"><div class="dkpi-lbl">创建人</div><div class="dkpi-val">' + escHtml(t.reporter_name || '—') + '</div></div>' +
        // Assignee (editable)
        '<div class="dkpi"><div class="dkpi-lbl">负责人</div>' +
          _buildEditableField(t.id, 'assignee_id', 'user-select', '<span class="dkpi-val">' + _renderAssigneeDisplay(t.assignee_names || [], t.id, {fallback: t.assignee_name || t.assignee_username || '—'}) + '</span>', (t.assignee_ids || []).join(',') || (t.assignee_id || '')) + '</div>' +
        // Stage (editable unless template task)
        '<div class="dkpi"><div class="dkpi-lbl">阶段' + (t.template_id ? ' <span style="color:var(--accent);font-size:10px" title="由模板控制">🔒</span>' : '') + '</div>' +
          (t.template_id
            ? '<span class="dkpi-val" style="color:var(--muted)">' + stageName + '</span>'
            : _buildEditableField(t.id, 'stage_name', 'stage-select', '<span class="dkpi-val">' + stageName + '</span>', t.stage_name || t.execution_name || '', {v:'',l:''}, ' data-project-id="' + (t.project_id || '') + '" data-project-code="' + escHtml(t.project_code || '') + '"')) + '</div>' +
        // Per-person progress (team tasks only)
        _renderTeamProgress(t) +
        // Reviewer (editable, only if approval enabled)
        (window._approvalEnabled ?
          '<div class="dkpi"><div class="dkpi-lbl">审批人</div>' +
            _buildEditableField(t.id, 'reviewer_id', 'user-select', '<span class="dkpi-val">' + escHtml(t.reviewer_name || '—') + '</span>', t.reviewer_id || '') + '</div>'
          : '') +
      '</div>' +
    '</div>' +
    // ── 状态与进度 ──
    '<div class="card info-glass-card" style="flex:1;min-width:0;padding:20px;display:flex;flex-direction:column">' +
      '<div class="section-hd"><span class="section-title">状态与进度</span></div>' +
      '<div class="delivery-kpi" style="grid-template-columns:1fr 1fr;flex:1;grid-auto-rows:1fr;align-content:start">' +
        // Status (read-only — 只能由进度自动更新)
        '<div class="dkpi"><div class="dkpi-lbl">状态 <span style="font-size:10px;color:var(--accent)">(自动)</span></div><div id="task-status-' + t.id + '" data-status="' + (t.status || 'todo') + '">' + renderPill(t.status || 'todo') +
          (t.status === 'review' && t.reviewer_name ? '<div style="font-size:10px;color:var(--muted);margin-top:2px">审批人: ' + escHtml(t.reviewer_name) + '</div>' : '') +
        '</div></div>' +
        // Priority (editable)
        '<div class="dkpi"><div class="dkpi-lbl">优先级</div>' + _buildEditableField(t.id, 'priority', 'select', renderPriorityBadge(t.priority || 'medium'), t.priority || 'medium', _PRIORITY_OPTS) + '</div>' +
        // Start date (editable)
        '<div class="dkpi"><div class="dkpi-lbl">计划开始</div>' +
          _buildEditableField(t.id, 'start_date', 'date', '<span class="dkpi-val">' + (t.start_date || '—') + '</span>', t.start_date || '') + '</div>' +
        // Due date (editable)
        '<div class="dkpi"><div class="dkpi-lbl">截止日期</div>' +
          _buildEditableField(t.id, 'due_date', 'date', '<span class="dkpi-val" style="color:' + (overdue ? 'var(--danger)' : '') + '">' + (t.due_date || '—') + '<span style="font-size:11px;color:' + (overdue ? 'var(--danger)' : 'var(--muted)') + '">' + daysInfo + '</span></span>', t.due_date || '') + '</div>' +
        // Progress: auto-calculated for team tasks
        ((t.assignee_ids && t.assignee_ids.length > 1)
          ? '<div class="dkpi"><div class="dkpi-lbl">团队进度 <span style="font-size:10px;color:var(--accent)">(自动)</span></div>' + renderProgressCircle(t.progress || 0, 30, {label:''}) + '</div>'
          : '<div class="dkpi"><div class="dkpi-lbl">进度(%)</div>' + _buildEditableField(t.id, 'progress', 'number', renderProgressCircle(t.progress || 0, 30, {label:''}), String(t.progress || 0), {min:0,max:100,step:5}) + '</div>') +
        // Hours info (read-only — 实际/预估，与 Bug 页一致)
        '<div class="dkpi"><div class="dkpi-lbl">工时信息</div><div class="dkpi-val">实际 ' + (t.consumed_hours || 0).toFixed(1) + 'h / 预估 ' + (t.estimate_hours || 0).toFixed(1) + 'h</div></div>' +
      '</div>' +
    '</div>' +
  '</div>';

  // ── Section 3: 描述 ──
  html += '<div class="card info-glass-card" style="margin-top:16px;padding:20px">' +
    '<div class="section-hd"><span class="section-title">描述</span>' +
      (_hasTaskEditPerm() ? iconEdit('_editDescription(\'task\', ' + t.id + ')', '编辑描述') : '') +
    '</div>' +
    '<div id="task-desc-' + t.id + '" data-desc="' + escHtml(t.description || '') + '" style="font-size:13px;line-height:1.6;min-height:20px">' +
      (t.description ? renderMarkdown(t.description) : '<span style="color:var(--muted)">暂无描述</span>') +
    '</div>' +
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

  // ── Section 6: 历史记录 ──
  html += '<div class="card info-glass-card" style="margin-top:16px;padding:20px">' +
    '<div class="section-hd" style="display:flex;align-items:center;justify-content:space-between">' +
      '<span class="section-title">历史记录</span>' +
      '<div style="display:flex;gap:6px;align-items:center">' +
        _timelineOrderBtn('task', t.id, 'task-detail-comments') +
        '<button class="btn btn-primary" style="font-size:11px;padding:3px 10px" onclick="openCommentDialog(\'task\', ' + t.id + ')">添加评论</button>' +
      '</div>' +
    '</div>' +
    '<div class="task-detail-comments" id="task-detail-comments" style="margin-bottom:8px">加载中...</div>' +
  '</div>';

  return html;
}

function _showTaskDetail(t) {
  var html = '<div class="task-detail-body" style="max-height:75vh;overflow-y:auto;padding-right:4px">' +
    _renderTaskDetailBody(t) +
    '</div>';

  openDialog(favStar('task', t.id, {size: '18px'}) + ' #' + t.id + ' ' + escHtml(t.title), html, [
    {text: '关闭', onclick: '_closeTaskDialog()'}
  ], {maxWidth: '60%'});
  // Scroll to top when dialog opens
  setTimeout(function() {
    var body = document.querySelector('.task-detail-body');
    if (body) body.scrollTop = 0;
  }, 50);

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
          '<td style="font-size:13px">' + renderMarkdown(c.content) + '</td></tr>';
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
  gotoView('task-create'); // full-page create form
}

/** Build task form HTML (used by both dialog and full-page modes) */
function _buildTaskForm(t, isEdit) {
  t = t || {};
  var execOpts = _taskProjectId ? '<option value="">加载中...</option>' : '';
  var inp = 'width:100%;box-sizing:border-box;margin-top:1px';
  var row2 = 'display:grid;grid-template-columns:1fr 1fr;gap:10px';
  var html = '';

  // ── Row 1: 基本信息 + 状态与进度 ──
  html += '<div style="' + row2 + '">' +
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
        '<div><label style="' + _lbl + '">创建人</label><div style="' + inp + ';padding:7px 11px;background:var(--bg);border:1px solid var(--border);border-radius:7px;font-size:13px;color:var(--fg);line-height:1.4">' + escHtml(t.reporter_name || (function(){var u=getCurrentUser();return u?u.display_name||u.username:'—';})()) + '</div></div>' +
        '<div><label style="' + _lbl + '">负责人 *</label><div style="margin-top:2px"><div id="tf-assignee-wrap"></div>' +
        '<div id="tf-assignee-hint" style="display:none;font-size:10px;color:var(--danger);margin-top:1px">请选择负责人</div></div></div>' +
        (window._approvalEnabled ? '<div><label style="' + _lbl + '">审批人</label><div style="margin-top:2px">' + createUserCombo({
          comboId: 'tf-reviewer-combo', inputId: 'tf-reviewer-input', dropdownId: 'tf-reviewer-dropdown',
          selectedIdFn: function() { return _tfReviewerId; },
          onSelect: function(u) { _tfReviewerId = u.id; }
        }) + '</div></div>' : '') +
        '<div><label style="' + _lbl + '">抄送给</label><div style="margin-top:2px" id="tf-cc-wrap"></div></div>' +
      '</div>' +
    '</div>' +
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
        '<div><label style="' + _lbl + '">进度(%)</label>' + _renderProgressSlider('tf', t.progress || 0) + '</div>' +
        '<div><label style="' + _lbl + '">预估工时(h)</label><input class="search-inp" id="tf-estimate" type="number" step="0.5" min="0" value="' + (t.estimate_hours || '') + '" style="' + inp + '"></div>' +
      '</div>' +
    '</div>' +
  '</div>';

  // ── Section 3: 描述 ──
  html += '<div style="' + _card + '">' +
    '<div style="' + _cardHd + '">描述</div>' +
    '<textarea class="search-inp" id="tf-desc" rows="3" style="width:100%;min-height:60px;height:auto;max-height:30vh;box-sizing:border-box;resize:vertical">' + escHtml(t.description || '') + '</textarea>' +
  '</div>';

  // ── Section 5 & 6: 工时日志 + 评论 (edit only) ──
  if (isEdit) {
    html += '<div style="' + _card + '">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
        '<span style="' + _cardHd + ';margin-bottom:0">工时日志 (' + (t.consumed_hours || 0).toFixed(1) + 'h)</span>' +
        '<button class="btn btn-primary" style="font-size:11px;padding:3px 10px;flex-shrink:0" onclick="openWorklogDialog(' + t.id + ')">+ 记录工时</button>' +
      '</div>' +
      '<div id="tf-worklogs">加载中...</div>' +
    '</div>';

    html += '<div style="' + _card + '">' +
      '<div style="' + _cardHd + '">评论</div>' +
      '<div id="tf-comments" style="margin-bottom:8px">加载中...</div>' +
      '<div style="display:flex;gap:8px">' +
        '<input class="search-inp" id="tf-comment-input" placeholder="添加评论..." style="flex:1">' +
        '<button class="btn-sm btn-primary" onclick="submitComment(' + t.id + ')">发送</button>' +
      '</div></div>';
  }

  return html;
}

/** Initialize task form selectors (assignee/cc/stage/project-name/worklogs) after form is in DOM */
function _initTaskFormSelectors(t, isEdit) {
  t = t || {};
  // Set form-scope state
  _tfProjectId = t.project_id || _taskProjectId || null;
  _tfProjectCode = t.project_code || _taskProjectCode || _tfProjectId;
  _tfAssigneeIds = (t.assignee_ids && t.assignee_ids.length) ? t.assignee_ids.slice() : (t.assignee_id ? [t.assignee_id] : []);
  _tfReviewerId = t.reviewer_id || null;
  window._tfCcIds = (t.cc_user_ids || []).slice();

  // Project name pre-fill + assignee/cc/reviewer selectors
  setTimeout(function() {
    // Pre-fill project name
    var projName = (t.project_code ? '[' + t.project_code + '] ' : '') + (t.project_name || '');
    if (projName.trim()) {
      var pi = document.getElementById('tf-project-input');
      if (pi) pi.value = projName;
    } else if (!isEdit && _tfProjectId) {
      loadAllProjects().then(function() {
        var p = (_allProjects || []).find(function(x) { return x.id == _tfProjectId || x.code == _tfProjectId; });
        if (p) {
          var el = document.getElementById('tf-project-input');
          if (el) el.value = (p.code ? p.code + ' ' : '') + p.name;
        }
      });
    }
    // Pre-fill reviewer name
    if (window._approvalEnabled && _tfReviewerId && t.reviewer_name) {
      var ri = document.getElementById('tf-reviewer-input');
      if (ri) ri.value = t.reviewer_name;
    }
    // Init assignee multi-selector
    var asgnWrap = document.getElementById('tf-assignee-wrap');
    if (asgnWrap && !asgnWrap.innerHTML.trim()) {
      asgnWrap.innerHTML = createMultiUserSelector({
        containerId: 'tf-assignee',
        selectedIds: _tfAssigneeIds.slice(),
        placeholder: '搜索并添加负责人...',
        onChange: function(ids) { _tfAssigneeIds = ids; }
      });
      _muRenderTags('tf-assignee');
    }
    // Init CC selector
    var ccWrap = document.getElementById('tf-cc-wrap');
    if (ccWrap && !ccWrap.innerHTML.trim()) {
      ccWrap.innerHTML = createCcSelector({
        containerId: 'tf-cc',
        selectedIds: (t.cc_user_ids || []).slice(),
        placeholder: '搜索抄送人...',
        onChange: function(ids) { window._tfCcIds = ids; }
      });
      setTimeout(function() { _renderCcTags('tf-cc'); }, 180);
    }
  }, 50);

  // Load stages for project with task's current stage pre-selected
  var projId = _tfProjectId || t.project_id;
  if (projId) {
    var curExecVal = t.stage_name ? '_' + t.stage_name : '';
    _loadTfExecutions(projId, curExecVal);
  }

  // Load worklogs and comments (edit mode)
  if (isEdit) {
    API.get('/worklogs?task_id=' + t.id).then(function(logs) {
      var el = document.getElementById('tf-worklogs');
      if (el) { el.innerHTML = _renderTaskWorklogTable(logs || [], t.id); _initWorklogDt(logs || [], t.id); }
    }).catch(function() {});
    _loadComments(t.id);
  }
}

function _showTaskForm(title, task) {
  var isEdit = !!task;
  var t = task || {};

  var bodyHtml = _buildTaskForm(t, isEdit);

  var buttons = [
    {text: '取消', onclick: '_closeTaskDialog()'},
    {text: (isEdit ? '保存' : '创建'), cls: 'btn-primary', onclick: 'submitTask(' + (t.id || 'null') + ')'}
  ];

  bodyHtml = '<div style="max-height:75vh;overflow-y:auto;padding-right:4px">' + bodyHtml + '</div>';
  var headerExtra = isEdit ? '' : '<button class="btn btn-xs" style="font-size:11px;white-space:nowrap" onclick="_closeTaskDialog();openBatchCreateDialog()">📝 批量创建</button>';
  openDialog(title, bodyHtml, buttons, {maxWidth: '80vw', maxHeight: '90vh', headerExtra: headerExtra});
  setTimeout(function() {
    initRichEditor('tf-desc', {height: 360});
  }, 150);

  _initTaskFormSelectors(t, isEdit);
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
  var data = {
    title: document.getElementById('tf-title').value.trim(),
    description: desc,
    status: document.getElementById('tf-status').value,
    priority: document.getElementById('tf-priority').value,
    assignee_id: _tfAssigneeIds.length ? _tfAssigneeIds[0] : null,
    assignee_ids: _tfAssigneeIds.length ? _tfAssigneeIds : null,
    reviewer_id: window._approvalEnabled ? _tfReviewerId : null,
    progress: parseInt(document.getElementById('tf-slider').value) || 0,
    estimate_hours: parseFloat(document.getElementById('tf-estimate').value) || 0,
    start_date: document.getElementById('tf-start-date').value || null,
    due_date: document.getElementById('tf-due').value || null,
    execution_id: parseInt(document.getElementById('tf-execution').value) || null,
    stage_name: _tfStageName(),
    project_id: _resolveProjectId(),
    cc_user_ids: (window._tfCcIds && window._tfCcIds.length) ? window._tfCcIds : null,
  };

  // Clear all hints first
  ['tf-title-hint','tf-project-hint','tf-execution-hint','tf-assignee-hint','tf-due-hint'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.style.display = 'none';
  });
  var valid = true;
  if (!data.title) { var h = document.getElementById('tf-title-hint'); if (h) h.style.display = ''; valid = false; }
  if (!data.project_id) { var h = document.getElementById('tf-project-hint'); if (h) h.style.display = ''; valid = false; }
  if (!data.execution_id && !data.stage_name) { var h = document.getElementById('tf-execution-hint'); if (h) h.style.display = ''; valid = false; }
  if (!data.assignee_ids || !data.assignee_ids.length) { var h = document.getElementById('tf-assignee-hint'); if (h) h.style.display = ''; valid = false; }
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

  // Bidirectional sync: progress ↔ status (via EventBus)
  var origProgress = data.progress, origStatus = data.status;
  var evt = {data: data, progress: data.progress || 0, status: data.status || 'todo'};
  EventBus.emit('task:before-save', evt);
  // Sync DOM with possibly-modified data
  document.getElementById('tf-status').value = data.status || 'todo';
  document.getElementById('tf-slider').value = data.progress || 0;
  if (origStatus === 'done' && origProgress < 100 && data.progress === 100) {
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
    EventBus.emit('task:saved', {taskId: taskId || (res && res.id)});
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
    '<select class="search-inp" id="bt-status-' + i + '" style="flex:0.8;min-width:70px"><option value="todo">待办</option><option value="in_progress">进行中</option><option value="review">评审中</option><option value="done">已完成</option></select>' +
    '<select class="search-inp" id="bt-priority-' + i + '" style="flex:0.7;min-width:55px"><option value="medium">中</option><option value="low">低</option><option value="high">高</option><option value="critical">紧急</option></select>' +
    '<select class="search-inp" id="bt-assignee-' + i + '" style="flex:0.9;min-width:120px"><option value="">负责人 *</option></select>' +
    '<button class="btn-xs" onclick="event.stopPropagation();_batchOpenMultiAssign(' + i + ')" title="添加多个负责人" style="flex-shrink:0;color:var(--accent);padding:1px 4px;font-size:10px">+</button>' +
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

// Per-row multi-assignee state for batch create
function _batchOpenMultiAssign(rowIdx) {
  var key = '_ba' + rowIdx;
  var sel = document.getElementById('bt-assignee-' + rowIdx);
  var primaryId = sel ? (parseInt(sel.value) || null) : null;
  var existingIds = window[key] || [];
  // Combine primary select value with existing extra IDs
  var allIds = existingIds.slice();
  if (primaryId && allIds.indexOf(primaryId) < 0) allIds.unshift(primaryId);
  window._mu_ba_dlg = allIds.slice();

  var html = '<div>' +
    '<div style="margin-bottom:8px;font-size:11px;color:var(--muted)">第' + (rowIdx + 1) + '行 — 选择负责人（可多选）</div>' +
    '<div id="ba-dlg-wrap"></div></div>';
  openDialog('多选负责人', html, [
    {text: '取消', onclick: 'closeSharedDialog()'},
    {text: '确定', cls: 'btn-primary', onclick: '_batchSaveMultiAssign(' + rowIdx + ')'}
  ], {maxWidth: 420});
  loadAllUsers().then(function() {
    var wrap = document.getElementById('ba-dlg-wrap');
    if (wrap) {
      wrap.innerHTML = createMultiUserSelector({ containerId: 'ba-dlg', selectedIds: allIds.slice(), placeholder: '搜索并添加负责人...' });
      _muRenderTags('ba-dlg');
    }
  });
}

function _batchSaveMultiAssign(rowIdx) {
  var ids = window._mu_ba_dlg || [];
  window['_ba' + rowIdx] = ids.slice();
  // Update the select to show the first assignee
  var sel = document.getElementById('bt-assignee-' + rowIdx);
  if (sel && ids.length) sel.value = ids[0];
  closeSharedDialog();
  showToast('第' + (rowIdx + 1) + '行已选 ' + ids.length + ' 人', 'success');
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
    // Collect assignee IDs: use per-row multi-select state if set, otherwise single select value
    var extraIds = window['_ba' + i] || [];
    var selectVal = assigneeEl ? (parseInt(assigneeEl.value) || null) : null;
    var assigneeIds = extraIds.length ? extraIds.slice() : [];
    if (selectVal && assigneeIds.indexOf(selectVal) < 0) assigneeIds.unshift(selectVal);
    if (!assigneeIds.length && selectVal) assigneeIds = [selectVal];
    if (!assigneeIds.length) { if (assigneeEl) assigneeEl.style.borderColor = 'var(--danger)'; errors.push(rowLabel + '未选择负责人'); }
    var estVal = estEl ? estEl.value.trim() : '';
    if (!estVal) { if (estEl) estEl.style.borderColor = 'var(--danger)'; errors.push(rowLabel + '未填写工时'); }
    var dueVal = dueEl ? dueEl.value : '';
    if (!dueVal) { if (dueEl) dueEl.style.borderColor = 'var(--danger)'; errors.push(rowLabel + '未填写截止日期'); }
    if (!execVal || !assigneeIds.length || !estVal || !dueVal) continue;
    tasks.push({
      title: title,
      execution_id: execVal && execVal[0] !== '_' ? (parseInt(execVal) || null) : null,
      stage_name: _batchStageName(execVal),
      status: statusEl ? statusEl.value : 'todo',
      priority: priorityEl ? priorityEl.value : 'medium',
      assignee_id: assigneeIds[0],
      assignee_ids: assigneeIds,
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
    EventBus.emit('task:saved', {});
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
    EventBus.emit('task:saved', {});
  } catch(e) {
    showToast('导入失败: ' + (e.message || '未知错误'), 'error');
  }
}

/* ── Worklog Dialog ── */

function _renderTaskWorklogTable(logs, taskId) {
  if (!logs || !logs.length) return '<div style="color:var(--muted);font-size:12px">暂无工时记录</div>';
  return '<div id="worklog-table-' + taskId + '"></div>';
}

function _initWorklogDt(logs, taskId) {
  new DataTable({
    container: document.getElementById('worklog-table-' + taskId),
    columns: [
      { key: 'date', title: '日期', minWidth: 100, render: function(v) { return v||'?'; } },
      { key: 'user', title: '用户', minWidth: 90, render: function(v, row) { return '<span style="font-size:11px">'+escHtml(v||row.username||'?')+'</span>'; } },
      { key: 'percentage', title: '占比', minWidth: 42, render: function(v) { return v ? '<span style="font-weight:600;color:var(--accent)">'+v+'%</span>' : '<span style="color:var(--muted)">—</span>'; } },
      { key: 'calculated_hours', title: '工时(h)', minWidth: 52, render: function(v, row) { var h = v || row.hours || 0; return (h||0).toFixed(1); } },
      { key: 'description', title: '描述', align: 'left', render: function(v) { return '<span style="white-space:normal;word-break:break-word">'+renderMarkdown(v||'')+'</span>'; } },
      { key: 'actions', title: '操作', width: actionColWidth(2) + 'px', minWidth: actionColWidth(2), render: function(v, row) { return iconEdit('openWorklogEditDialog('+row.id+','+taskId+')','编辑')+iconDelete('deleteWorklogById('+row.id+','+taskId+')','删除'); } }
    ],
    data: logs,
  });
}

function _buildTeamProgressField(task) {
  // For team tasks: show personal progress slider instead of task progress input
  var curUser = (typeof getCurrentUser === 'function' && getCurrentUser()) || {};
  var curUid = curUser ? (curUser.id || null) : null;
  var progressMap = task.assignee_progress || {};
  var myPct = parseInt(progressMap[String(curUid)] || progressMap[curUid] || 0);
  window._wlTeamTaskId = task.id; // flag for submitWorklog to also update personal progress
  return '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">我的进度(%) * <span style="color:var(--accent);font-size:10px">(团队任务·仅更新个人进度)</span></label>' +
    _renderProgressSlider('wl', myPct) +
    '<div id="wl-progress-hint" style="display:none;font-size:10px;color:var(--danger);margin-top:1px">请设置进度</div>' +
    '</div>';
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

    // Default: 1 row with today's date
    var rowHtml = _wlBuildRow(0, today, task.progress || 0);

    var isTeamTask = task.assignee_ids && task.assignee_ids.length > 1;
    var html = '<div>' +
      '<input type="hidden" id="wl-reviewer-name" value="' + escHtml(task.reviewer_name || '') + '">' +
      '<input type="hidden" id="wl-reviewer-id" value="' + (task.reviewer_id || '') + '">' +
      '<input type="hidden" id="wl-task-estimate" value="' + est + '">' +
      '<input type="hidden" id="wl-task-consumed" value="' + cons + '">' +
      overBudgetHint +
      '<div style="margin-bottom:8px;font-size:15px;color:var(--muted)">项目: <span style="color:var(--fg);font-weight:600">' + escHtml(task.project_code||'？') + '</span> ' + escHtml(task.project_name||'') + '</div>' +
      '<div style="margin-bottom:4px;font-size:15px;color:var(--muted)">任务: <span style="color:var(--fg);font-weight:600">' + escHtml(task.name||task.title||'？') + '</span></div>' +
      (isTeamTask ? '<div style="margin-bottom:8px;font-size:13px;color:var(--muted)">多人任务 — 进度将更新你的个人进度</div>' : '') +
      '<div style="display:flex;gap:10px;align-items:center;border:1px solid transparent;padding:0 10px;margin-bottom:4px;font-size:13px;color:var(--muted);font-weight:600;text-align:center">' +
        '<span style="width:155px;flex-shrink:0">日期</span>' +
        '<span style="flex:1;min-width:120px">工作内容</span>' +
        '<span style="width:60px;flex-shrink:0">工时</span>' +
        '<span style="width:80px;flex-shrink:0">占比</span>' +
        '<span style="width:80px;flex-shrink:0">进度</span>' +
        '<span style="width:80px;flex-shrink:0">可用剩余</span>' +
        '<span style="width:32px;flex-shrink:0"></span>' +
      '</div>' +
      '<div id="wl-rows">' + rowHtml + '</div>' +
      '<div style="text-align:center;margin-top:8px">' +
        '<button class="btn btn-sm" onclick="_wlAddRow(' + taskId + ',' + (task.progress||0) + ')">+ 添加一行</button>' +
      '</div>' +
      '<input type="hidden" id="wl-row-count" value="1">' +
    '</div>';
    
    openDialog('记录工时', html, [
      {text:'取消',onclick:'_closeWorklogDialog()'},
      {text:'提交',cls:'btn-primary',onclick:'submitBatchWorklog('+taskId+','+(isTeamTask?'true':'false')+')'}
    ], {maxWidth: '80vw', keepExisting: true});

    // Auto-load available percentage for default rows
    setTimeout(function() { _wlOnDateChange(0); }, 100);
  }).catch(function() {
    showToast('加载任务信息失败', 'error');
  });
}

function _wlBuildRow(idx, defaultDate, progress) {
  var dId = 'wl-date-' + idx, aId = 'wl-avail-' + idx, hId = 'wl-hours-' + idx;
  var pId = 'wl-pct-' + idx, tId = 'wl-desc-' + idx, gId = 'wl-prog-' + idx;
  return '<div class="wl-row" data-idx="' + idx + '" style="border:1px solid var(--border);border-radius:8px;padding:8px 10px;margin-bottom:6px">' +
    '<div style="display:flex;gap:10px;align-items:center">' +
      '<input class="search-inp" id="' + dId + '" type="date" value="' + defaultDate + '" style="width:155px;box-sizing:border-box;font-size:15px;flex-shrink:0" onchange="_wlOnDateChange(' + idx + ')">' +
      '<input class="search-inp" id="' + tId + '" placeholder="工作内容" style="flex:1;min-width:120px;box-sizing:border-box;font-size:15px">' +
      '<div style="width:60px;flex-shrink:0;text-align:center;font-size:16px;font-weight:600;color:var(--fg)"><span id="' + hId + '">2.0</span><span style="font-size:14px;color:var(--muted);font-weight:400">h</span></div>' +
      // Percentage: ring by default, click to show inline slider
      '<div id="wl-pct-ring-' + idx + '" style="width:80px;flex-shrink:0;cursor:pointer;text-align:center" onclick="_wlShowPctSlider(' + idx + ')" title="点击调整占比">' +
        _wlProgressRing(25, 38, 'var(--accent)') +
      '</div>' +
      '<div id="wl-pct-slider-' + idx + '" style="display:none;flex-shrink:0;align-items:center;gap:4px;width:130px">' +
        '<input type="range" id="' + pId + '" min="5" max="100" step="1" value="25" style="flex:1" oninput="_wlPctSliderInput(' + idx + ')" onblur="_wlHidePctSlider(' + idx + ')">' +
        '<span id="wl-pct-slider-val-' + idx + '" style="font-size:13px;font-weight:600;color:var(--accent);min-width:38px;text-align:right">25%</span>' +
      '</div>' +
      // Progress: ring by default, click to show inline slider
      '<div id="wl-prog-ring-' + idx + '" style="width:80px;flex-shrink:0;cursor:pointer;text-align:center" onclick="_wlShowProgSlider(' + idx + ')" title="点击调整进度">' +
        _wlProgressRing(progress, 38, 'var(--success)') +
      '</div>' +
      '<div id="wl-prog-slider-' + idx + '" style="display:none;flex-shrink:0;align-items:center;gap:4px;width:130px">' +
        '<input type="range" id="' + gId + '" min="0" max="100" step="5" value="' + progress + '" style="flex:1" oninput="_wlProgSliderInput(' + idx + ')" onblur="_wlHideProgSlider(' + idx + ')">' +
        '<span id="wl-prog-slider-val-' + idx + '" style="font-size:13px;font-weight:600;color:var(--success);min-width:38px;text-align:right">' + progress + '%</span>' +
      '</div>' +
      '<span id="' + aId + '" style="width:80px;flex-shrink:0;font-size:14px;color:var(--success);text-align:center">可用 100%</span>' +
      '<span style="width:32px;flex-shrink:0;text-align:center">' + iconDelete('_wlRemoveRow(' + idx + ')', '删除此行') + '</span>' +
    '</div>' +
  '</div>';
}

function _wlAddRow(taskId, progress) {
  var cntEl = document.getElementById('wl-row-count');
  var cnt = parseInt(cntEl.value) || 1;
  // Find the last row's date
  var lastDate = fmtLocalDate();
  var rows = document.querySelectorAll('#wl-rows .wl-row');
  if (rows.length > 0) {
    var lastIdx = rows[rows.length - 1].getAttribute('data-idx');
    var lastDateEl = document.getElementById('wl-date-' + lastIdx);
    if (lastDateEl && lastDateEl.value) {
      var d = new Date(lastDateEl.value + 'T00:00:00');
      d.setDate(d.getDate() - 1); // day before last row's date
      lastDate = fmtLocalDate(d);
    }
  }
  var row = _wlBuildRow(cnt, lastDate, progress);
  var rowsEl = document.getElementById('wl-rows');
  rowsEl.insertAdjacentHTML('beforeend', row);
  cntEl.value = cnt + 1;
  // Initialize date change for the new row
  setTimeout(function() { _wlOnDateChange(cnt); }, 50);
}

function _wlRemoveRow(idx) {
  var cntEl = document.getElementById('wl-row-count');
  var cnt = parseInt(cntEl.value) || 1;
  var rowsEl = document.getElementById('wl-rows');
  var rows = rowsEl.querySelectorAll('.wl-row');
  if (rows.length <= 1) { showToast('至少保留1行','warn'); return; }
  var target = rowsEl.querySelector('.wl-row[data-idx="' + idx + '"]');
  if (target) target.remove();
  cntEl.value = rows.length - 1;
  _wlCheckOverPct();
}

// ── Ring SVG helper ──
function _wlProgressRing(pct, size, color) {
  var r = (size - 4) / 2;
  var circ = 2 * Math.PI * r;
  var dash = circ * pct / 100;
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
    '<circle cx="' + (size/2) + '" cy="' + (size/2) + '" r="' + r + '" fill="none" stroke="var(--border)" stroke-width="3"/>' +
    '<circle cx="' + (size/2) + '" cy="' + (size/2) + '" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="3"' +
    ' stroke-dasharray="' + dash + ' ' + (circ - dash) + '" stroke-linecap="round" transform="rotate(-90 ' + (size/2) + ' ' + (size/2) + ')"/>' +
    '<text x="' + (size/2) + '" y="' + (size/2) + '" text-anchor="middle" dominant-baseline="central" font-size="' + (size*0.32) + '" font-weight="600" fill="var(--fg)">' + pct + '%</text></svg>';
}

// Track checkin hours and saved percentage per date
var _wlCheckinHours = {};
var _wlSavedPct = {};

function _wlOnDateChange(idx) {
  var d = document.getElementById('wl-date-' + idx).value;
  if (!d) return;
  var user = getCurrentUser(); var uid = user ? user.id : '';
  Promise.all([
    API.get('/worklogs/daily-usage?date=' + d),
    API.get('/wecom/calendar?user_id=' + uid + '&date_from=' + d + '&date_to=' + d)
  ]).then(function(results) {
    var usage = results[0] || {}, wecom = results[1] || {};
    var remaining = usage.remaining_percentage !== undefined ? usage.remaining_percentage : 100;
    var checkinH = (wecom.daily && wecom.daily[0]) ? wecom.daily[0].total_hours : 0;
    _wlSavedPct[d] = usage.total_percentage_used || 0;
    _wlCheckinHours[d] = checkinH;
    var av = document.getElementById('wl-avail-' + idx);
    if (av) { av.textContent = '可用 ' + remaining + '%'; av.style.color = remaining > 0 ? 'var(--success)' : 'var(--danger)'; }
    var pctEl = document.getElementById('wl-pct-' + idx);
    if (remaining <= 0) {
      // 剩余可用为 0%：占比圆环和工时显示 '-'
      var ringEl = document.getElementById('wl-pct-ring-' + idx);
      if (ringEl) ringEl.innerHTML = '<span style="font-size:15px;color:var(--muted)">-</span>';
      var hoursEl = document.getElementById('wl-hours-' + idx);
      if (hoursEl) hoursEl.textContent = '-';
    } else if (pctEl) {
      pctEl.max = Math.max(5, remaining);
      if (parseInt(pctEl.value) > remaining) pctEl.value = Math.max(5, remaining);
      _wlUpdatePctRing(idx);
    }
    _wlCheckOverPct();
  }).catch(function(){});
}

// ── Inline ring ↔ slider toggle ──
function _wlShowPctSlider(idx) {
  document.getElementById('wl-pct-ring-' + idx).style.display = 'none';
  var sl = document.getElementById('wl-pct-slider-' + idx); sl.style.display = '';
  var inp = sl.querySelector('input'); if (inp) { inp.focus(); _wlPctSliderInput(idx); }
}
function _wlHidePctSlider(idx) { setTimeout(function() {
  document.getElementById('wl-pct-slider-' + idx).style.display = 'none';
  document.getElementById('wl-pct-ring-' + idx).style.display = '';
}, 150); }
function _wlShowProgSlider(idx) {
  document.getElementById('wl-prog-ring-' + idx).style.display = 'none';
  var sl = document.getElementById('wl-prog-slider-' + idx); sl.style.display = '';
  var inp = sl.querySelector('input'); if (inp) inp.focus();
}
function _wlHideProgSlider(idx) { setTimeout(function() {
  document.getElementById('wl-prog-slider-' + idx).style.display = 'none';
  document.getElementById('wl-prog-ring-' + idx).style.display = '';
}, 150); }

// ── Percentage → hours sync (hours is readonly, driven by pct) ──
function _wlPctSliderInput(idx) {
  var pct = parseInt(document.getElementById('wl-pct-' + idx).value) || 25;
  var d = document.getElementById('wl-date-' + idx).value;
  var checkinH = _wlCheckinHours[d] || 8;
  document.getElementById('wl-hours-' + idx).textContent = (pct / 100 * checkinH).toFixed(1);
  var valEl = document.getElementById('wl-pct-slider-val-' + idx);
  if (valEl) valEl.textContent = pct + '%';
  _wlUpdatePctRing(idx);
  _wlCheckOverPct();
}
function _wlUpdatePctRing(idx) {
  var pct = parseInt(document.getElementById('wl-pct-' + idx).value) || 25;
  document.getElementById('wl-pct-ring-' + idx).innerHTML = _wlProgressRing(pct, 32, 'var(--accent)');
}
function _wlProgSliderInput(idx) {
  var prog = parseInt(document.getElementById('wl-prog-' + idx).value) || 0;
  var valEl = document.getElementById('wl-prog-slider-val-' + idx);
  if (valEl) valEl.textContent = prog + '%';
  document.getElementById('wl-prog-ring-' + idx).innerHTML = _wlProgressRing(prog, 32, 'var(--success)');
}

function _wlCheckOverPct() {
  var rowsEl = document.getElementById('wl-rows');
  if (!rowsEl) return;
  // Sum dialog-row percentages per date
  var dialogPcts = {};
  var rows = rowsEl.querySelectorAll('.wl-row');
  rows.forEach(function(row) {
    var idx = row.getAttribute('data-idx');
    var dateEl = document.getElementById('wl-date-' + idx);
    var pctEl = document.getElementById('wl-pct-' + idx);
    if (dateEl && pctEl) {
      var d = dateEl.value; var p = parseInt(pctEl.value) || 0;
      dialogPcts[d] = (dialogPcts[d] || 0) + p;
    }
  });
  // Check against already-saved + dialog total > 100
  var hasOverflow = false;
  rows.forEach(function(row) {
    var idx = row.getAttribute('data-idx');
    var dateEl = document.getElementById('wl-date-' + idx);
    var pctEl = document.getElementById('wl-pct-' + idx);
    var avEl = document.getElementById('wl-avail-' + idx);
    if (dateEl && pctEl && avEl) {
      var d = dateEl.value;
      var saved = _wlSavedPct[d] || 0;
      var total = saved + (dialogPcts[d] || 0);
      if (total > 100) {
        pctEl.style.outline = '2px solid var(--danger)';
        avEl.textContent = '超 ' + (total - 100).toFixed(0) + '%';
        avEl.style.color = 'var(--danger)';
        avEl.style.fontWeight = '600';
        hasOverflow = true;
      } else {
        pctEl.style.outline = '';
      }
    }
  });
  var submitBtn = document.querySelector('.dialog-actions .btn-primary');
  if (submitBtn) submitBtn.disabled = hasOverflow;
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

// ── Batch worklog submit ──

var _wlBatchPendingSubmit = null;

async function submitBatchWorklog(taskId, isTeam) {
  var rowsEl = document.getElementById('wl-rows');
  if (!rowsEl) return;
  var rows = rowsEl.querySelectorAll('.wl-row');
  var entries = [];
  var maxProgress = -1;
  var hasError = false;

  rows.forEach(function(row) {
    var idx = row.getAttribute('data-idx');
    var dateEl = document.getElementById('wl-date-' + idx);
    var pctEl = document.getElementById('wl-pct-' + idx);
    var descEl = document.getElementById('wl-desc-' + idx);
    var progEl = document.getElementById('wl-prog-' + idx);

    var d = dateEl ? dateEl.value : '';
    var pct = pctEl ? parseInt(pctEl.value) || 0 : 0;
    var desc = descEl ? descEl.value.trim() : '';
    var prog = progEl ? parseInt(progEl.value) || 0 : 0;

    if (!d) { if (dateEl) dateEl.style.outline = '2px solid var(--danger)'; hasError = true; }
    else { if (dateEl) dateEl.style.outline = ''; }
    if (!desc) { if (descEl) descEl.style.outline = '2px solid var(--danger)'; hasError = true; }
    else { if (descEl) descEl.style.outline = ''; }

    if (d && pct >= 5 && desc) {
      entries.push({date: d, percentage: pct, description: desc, progress: prog});
    }
    if (prog > maxProgress) maxProgress = prog;
  });

  if (hasError) { showToast('请填写所有行的日期和描述', 'warn'); return; }
  if (entries.length === 0) { showToast('至少需要一行有效记录', 'warn'); return; }

  // Check percentage overflow across rows
  _wlCheckOverPct();
  var submitBtn = document.querySelector('.dialog-actions .btn-primary');
  if (submitBtn && submitBtn.disabled) { showToast('日期工时占比超过100%，请调整', 'error'); return; }

  // 100% progress confirmation
  if (maxProgress >= 100) {
    _wlBatchPendingSubmit = { taskId: taskId, entries: entries, maxProgress: maxProgress, isTeam: isTeam };
    var approvalEnabled = window._approvalEnabled;
    var reviewerName = document.getElementById('wl-reviewer-name');
    var rname = reviewerName ? reviewerName.value.trim() : '';
    if (approvalEnabled) {
      var reviewMsg = rname ? '，评审人: <b>' + escHtml(rname) + '</b>' : '，评审人: <b>待分配</b>';
      openDialog('确认提交工时',
        '<div style="font-size:13px;margin-bottom:8px">进度 <b>100%</b>，任务将进入<b>评审中</b>状态' + reviewMsg + '。</div>' +
        '<div style="font-size:11px;color:var(--muted)">确认后将保存 ' + entries.length + ' 条工时记录。</div>',
        [{text: '取消', onclick: '_wlBatchCancelSubmit()'}, {text: '确认', cls: 'btn-primary', onclick: '_wlBatchConfirmSubmit()'}],
        {hideClose: true, overlayClass: 'wl-submit-confirm-overlay', keepExisting: true});
    } else {
      openDialog('确认提交工时',
        '<div style="font-size:13px;margin-bottom:8px">进度 <b>100%</b>，任务将自动切换为<b>已完成</b>状态。</div>' +
        '<div style="font-size:11px;color:var(--muted)">确认后将保存 ' + entries.length + ' 条工时记录。</div>',
        [{text: '取消', onclick: '_wlBatchCancelSubmit()'}, {text: '确认', cls: 'btn-primary', onclick: '_wlBatchConfirmSubmit()'}],
        {hideClose: true, overlayClass: 'wl-submit-confirm-overlay', keepExisting: true});
    }
    return;
  }

  await _doSubmitBatchWorklog(taskId, entries, maxProgress, isTeam);
}

function _wlBatchCancelSubmit() {
  var d = document.querySelector('.wl-submit-confirm-overlay'); if (d) d.remove();
  _wlBatchPendingSubmit = null;
}

async function _wlBatchConfirmSubmit() {
  var d = document.querySelector('.wl-submit-confirm-overlay'); if (d) d.remove();
  if (!_wlBatchPendingSubmit) return;
  var p = _wlBatchPendingSubmit;
  _wlBatchPendingSubmit = null;
  await _doSubmitBatchWorklog(p.taskId, p.entries, p.maxProgress, p.isTeam);
}

async function _doSubmitBatchWorklog(taskId, entries, maxProgress, isTeam) {
  try {
    // Batch create worklogs
    await API.post('/worklogs/batch', {task_id: taskId, entries: entries});

    // Update task progress (only-up-not-down)
    if (maxProgress >= 0) {
      var task = await API.get('/tasks/' + taskId);
      var currentP = task.progress || 0;
      if (maxProgress > currentP) {
        if (isTeam) {
          await API.put('/tasks/' + taskId + '/my-progress', {progress: maxProgress});
        } else {
          var taskRes = await API.put('/tasks/' + taskId, {progress: maxProgress});
          if (taskRes && taskRes.auto_messages && taskRes.auto_messages.length) {
            taskRes.auto_messages.forEach(function(msg) { showToast(msg, 'success'); });
          }
        }
      }
    }

    showToast('已记录 ' + entries.length + ' 条工时', 'success');
    _closeWorklogDialog();
    EventBus.emit('worklog:saved', {taskId: taskId});
  } catch(e) { showToast('记录失败: ' + (e.message || '未知错误'), 'error'); }
}

// ── Single worklog edit (kept for per-row editing) ──

var _wlEditPendingSubmit = null;

async function _submitWorklogEdit(wlId, taskId) {
  var pct = parseInt(document.getElementById('wl-pct').value) || 0;
  var progress = parseInt(document.getElementById('wl-slider').value);
  var desc = document.getElementById('wl-desc').value.trim();
  var date = document.getElementById('wl-date').value;
  if (!date) { showToast('请选择日期', 'warn'); return; }
  if (pct < 5) { showToast('工时占比至少5%', 'warn'); return; }
  if (!desc) { showToast('请填写工作描述', 'warn'); return; }

  if (progress >= 100) {
    _wlEditPendingSubmit = { wlId: wlId, taskId: taskId, percentage: pct, progress: progress, desc: desc, date: date };
    var approvalEnabled = window._approvalEnabled;
    var reviewerName = document.getElementById('wl-reviewer-name');
    var rname = reviewerName ? reviewerName.value.trim() : '';
    if (approvalEnabled) {
      var reviewMsg = rname ? '，评审人: <b>' + escHtml(rname) + '</b>' : '，评审人: <b>待分配</b>';
      openDialog('确认提交工时',
        '<div style="font-size:13px;margin-bottom:8px">进度 <b>100%</b>，任务将进入<b>评审中</b>状态' + reviewMsg + '。</div>',
        [{text: '取消', onclick: '_wlEditCancelSubmit()'}, {text: '确认', cls: 'btn-primary', onclick: '_wlEditConfirmSubmit()'}],
        {hideClose: true, overlayClass: 'wl-edit-confirm-overlay', keepExisting: true});
    } else {
      openDialog('确认提交工时',
        '<div style="font-size:13px;margin-bottom:8px">进度 <b>100%</b>，任务将自动切换为<b>已完成</b>状态。</div>',
        [{text: '取消', onclick: '_wlEditCancelSubmit()'}, {text: '确认', cls: 'btn-primary', onclick: '_wlEditConfirmSubmit()'}],
        {hideClose: true, overlayClass: 'wl-edit-confirm-overlay', keepExisting: true});
    }
    return;
  }
  await _doSubmitWorklogEdit(wlId, taskId, pct, progress, desc, date);
}

function _wlEditCancelSubmit() {
  var d = document.querySelector('.wl-edit-confirm-overlay'); if (d) d.remove();
  _wlEditPendingSubmit = null;
}

async function _wlEditConfirmSubmit() {
  var d = document.querySelector('.wl-edit-confirm-overlay'); if (d) d.remove();
  if (!_wlEditPendingSubmit) return;
  var p = _wlEditPendingSubmit;
  _wlEditPendingSubmit = null;
  await _doSubmitWorklogEdit(p.wlId, p.taskId, p.percentage, p.progress, p.desc, p.date);
}

async function _doSubmitWorklogEdit(wlId, taskId, percentage, progress, desc, date) {
  try {
    await API.put('/worklogs/' + wlId, {percentage: percentage, date: date, description: desc});
    var taskRes = await API.put('/tasks/' + taskId, {progress: progress});
    if (taskRes && taskRes.auto_messages && taskRes.auto_messages.length) {
      taskRes.auto_messages.forEach(function(msg) { showToast(msg, 'success'); });
    }
    showToast('工时已更新', 'success');
    _closeWorklogDialog();
    EventBus.emit('worklog:saved', {taskId: taskId});
  } catch(e) { showToast('更新失败: ' + (e.message || '未知错误'), 'error'); }
}

function deleteWorklogById(wlId, taskId) {
  if (!confirm('确认删除此工时记录？')) return;
  API.del('/worklogs/' + wlId).then(function() {
    showToast('已删除', 'success');
    EventBus.emit('worklog:deleted', {taskId: taskId});
  }).catch(function(e) { showToast('删除失败: ' + (e.message || ''), 'error'); });
}

function _refreshTaskWorklogs(taskId) {
  API.get('/worklogs?task_id=' + taskId).then(function(logs) {
    var el = document.getElementById('tv-worklogs');
    if (!el) el = document.getElementById('tf-worklogs');
    if (el) { el.innerHTML = _renderTaskWorklogTable(logs || [], taskId); _initWorklogDt(logs || [], taskId); }
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
  renderTimeline('task', taskId, 'tf-comments');
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
    EventBus.emit('task:deleted', {});
  } catch(e) {
    showToast('删除失败: ' + (e.message || ''), 'error');
  }
}

