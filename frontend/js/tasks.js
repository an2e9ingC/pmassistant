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
    '<div id="task-content" style="flex:1;overflow:auto;padding:16px">加载中...</div>' +
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

  var html = '<table class="proj-table"><thead><tr>' +
    '<th style="width:22px"><input type="checkbox" id="task-select-all" onchange="_toggleSelectAllTasks(this)" title="全选/取消全选"></th>' +
    '<th style="width:7%">任务编号</th>' +
    '<th style="width:8%">项目编号</th>' +
    '<th style="width:10%;text-align:left">项目名称</th>' +
    '<th style="width:18%;text-align:left">标题</th>' +
    '<th style="width:9%">阶段</th>' +
    '<th style="width:6%">状态</th>' +
    '<th style="width:5%">优先级</th>' +
    '<th style="width:6%">进度</th>' +
    '<th style="width:6%">截止日期</th>' +
    '<th>操作</th>' +
    '</tr></thead><tbody>';

  _selectedTasks = new Set();
  tasks.forEach(function(t) { html += _renderTaskRow(t, stageMap); });
  html += '</tbody></table>';
  html += _renderBatchToolbar();
  content.innerHTML = html;
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

  _selectedTasks = new Set();
  var html = '<div class="table-scroll" style="max-height:calc(100vh - 340px)"><table class="stage-table"><thead><tr>' +
    '<th style="width:10%">阶段</th>' +
    '<th style="width:15%">任务标题</th>' +
    '<th style="width:6%">状态</th>' +
    '<th style="width:5%">优先级</th>' +
    '<th style="width:7%">负责人</th>' +
    '<th style="width:7%">进度</th>' +
    '<th style="width:7%">计划开始</th>' +
    '<th style="width:7%">截止日期</th>' +
    '<th style="width:7%">完成日期</th>' +
    '<th style="width:10%">最新动态</th>' +
    '<th style="width:6%">时间</th>' +
    '<th style="width:22px"><input type="checkbox" id="task-select-all" onchange="_toggleSelectAllTasks(this)" title="全选/取消全选"></th>' +
    '<th style="width:1%;white-space:nowrap">操作</th>' +
    '</tr></thead><tbody>';

  stageKeys.forEach(function(stageName) {
    var stageTasks = grouped[stageName] || [];
    var rowCount = stageTasks.length || 1;
    for (var i = 0; i < rowCount; i++) {
      var t = stageTasks[i];
      html += '<tr class="task-stage-row" data-stage="' + escHtml(stageName) + '"' + (t ? ' data-task-id="' + t.id + '"' : '') + ' id="' + (i === 0 ? 'task-stage-' + escHtml(stageName) : '') + '">';
      if (i === 0) {
        var stageId = stageIdMap[stageName] || null;
        var stageCellContent = stageId
          ? '<button class="gs-btn" onclick="openStageDialog(' + stageId + ');event.stopPropagation()" title="查看/编辑阶段信息">' + escHtml(stageName) + '</button>'
          : escHtml(stageName);
        html += '<td rowspan="' + rowCount + '" data-stage-cell="' + escHtml(stageName) + '" style="vertical-align:middle;background:var(--bg);border-right:2px solid var(--border);text-align:center">' +
          '<div>' + stageCellContent + ' <sup style="font-size:9px;color:var(--accent);background:var(--accent-lt);padding:1px 4px;border-radius:8px">' + stageTasks.length + '</sup></div>' +
          '</td>';
      }
      if (t) {
        html += _renderTaskRowCompact(t, stageStartMap[stageName] || null);
      } else {
        html += '<td style="color:var(--muted);font-size:12px">—</td>' +
          '<td style="color:var(--muted);font-size:12px">—</td>' +
          '<td style="color:var(--muted);font-size:12px">—</td>' +
          '<td style="color:var(--muted);font-size:12px">—</td>' +
          '<td style="color:var(--muted);font-size:12px">—</td>' +
          '<td style="color:var(--muted);font-size:12px">—</td>' +
          '<td style="color:var(--muted);font-size:12px">—</td>' +
          '<td style="color:var(--muted);font-size:12px">—</td>' +
          '<td style="color:var(--muted);font-size:12px">—</td>' +
          '<td style="color:var(--muted);font-size:12px">—</td>' +
          '<td style="width:22px"></td>' +
          '<td style="color:var(--muted);font-size:12px">—</td>';
      }
      html += '</tr>';
    }
  });

  html += '</tbody></table></div>';
  html += _renderBatchToolbar();
  content.innerHTML = html;

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
  return '<td style="text-align:left;cursor:pointer" onclick="openTaskViewDialog(' + t.id + ')" title="查看任务详情">' + escHtml(t.title) + '</td>' +
    '<td style="text-align:center">' + renderPill(t.status || 'todo') + '</td>' +
    '<td style="text-align:center">' + (typeof renderPriority === 'function' ? renderPriority(t.priority) : escHtml(t.priority || 'medium')) + '</td>' +
    '<td style="font-size:12px;cursor:pointer;color:var(--accent)" onclick="event.stopPropagation();openAssignDialog(' + t.id + ')" title="指派任务">' + escHtml(assigneeName) + '</td>' +
    '<td style="text-align:center">' + progressHtml + '</td>' +
    '<td style="font-size:12px;color:' + (t.start_date ? 'var(--fg)' : 'var(--muted)') + '" title="' + startTitle + '">' + escHtml(startDateStr) + '</td>' +
    '<td style="font-size:12px">' + (t.due_date ? t.due_date : '—') + '</td>' +
    '<td style="font-size:12px">' + (t.completed_at ? formatDate(t.completed_at) : '—') + '</td>' +
    _renderLatestActivity(t) +
    '<td style="text-align:center;width:22px" onclick="event.stopPropagation();if(event.target!==this.firstElementChild){var cb=this.firstElementChild;if(cb){cb.checked=!cb.checked;cb.onchange()}}"><input type="checkbox" value="' + t.id + '" onchange="_onTaskCheckbox(this)" class="task-checkbox"></td>' +
    '<td style="white-space:nowrap" onclick="event.stopPropagation()">' + iconEdit('openTaskDialog(' + t.id + ')') + iconDelete('deleteTask(' + t.id + ')') + '</td>';
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
    '<td style="text-align:center;width:22px" onclick="event.stopPropagation();if(event.target!==this.firstElementChild){var cb=this.firstElementChild;if(cb){cb.checked=!cb.checked;cb.onchange()}}"><input type="checkbox" value="' + t.id + '" onchange="_onTaskCheckbox(this)" class="task-checkbox"></td>' +
    '<td style="font-size:11px;font-family:var(--mono);color:var(--muted)">#' + t.id + '</td>' +
    '<td>' + (projCode ? projCodeTag(projCode, 'openProject(\'' + escHtml(projCode).replace(/'/g, "\\'") + '\')', t.project_name) : '-') + '</td>' +
    '<td style="text-align:left;font-size:12px">' + escHtml(t.project_name || '-') + '</td>' +
    '<td style="text-align:left"><a href="javascript:void(0)" onclick="openTaskViewDialog(' + t.id + ')" style="color:var(--accent)">' + escHtml(t.title) + '</a></td>' +
    '<td>' + (stageName ? '<span style="font-size:11px;color:var(--muted)">' + escHtml(stageName) + '</span>' : '-') + '</td>' +
    '<td>' + renderPill(t.status || 'todo') + '</td>' +
    '<td>' + _renderPriority(t.priority) + '</td>' +
    '<td>' + renderProgressCircle(progressPct, 26, {label:''}) + '</td>' +
    '<td style="color:' + (overdue ? 'var(--danger)' : '') + '">' + (t.due_date || '-') + '</td>' +
    '<td>' +
      iconEdit('openTaskDialog(' + t.id + ')', '编辑任务') +
      iconCopy('openCopyTaskDialog(' + t.id + ')', '复制任务') +
      iconDelete('deleteTask(' + t.id + ')', '删除任务') +
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

function _closeTaskDialog() {
  var overlay = document.querySelector('.note-dialog-overlay');
  if (overlay) overlay.remove();
}

function openTaskViewDialog(taskId) {
  API.get('/tasks/' + taskId).then(function(data) {
    _showTaskView(data);
  }).catch(function(e) {
    showToast('加载失败: ' + (e.message || ''), 'error');
  });
}

var _card = 'background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px 14px;margin-bottom:10px';
var _cardHd = 'font-size:11px;font-weight:600;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.03em';
var _grid2 = 'display:grid;grid-template-columns:1fr 1fr;gap:6px 20px';
var _grid4 = 'display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px 14px';
var _lbl = 'font-size:11px;color:var(--muted)';
var _val = 'font-size:13px;margin-top:1px';

function _daysLeft(dueDate) {
  if (!dueDate) return '';
  var due = new Date(dueDate + 'T00:00:00');
  var today = new Date(fmtLocalDate() + 'T00:00:00');
  var diff = Math.ceil((due - today) / 86400000);
  if (diff > 0) return ' (还剩' + diff + '天)';
  if (diff === 0) return ' (今天截止)';
  return ' (已过期' + Math.abs(diff) + '天)';
}

function _showTaskView(t) {
  var labels = {todo:'待办', in_progress:'进行中', review:'评审中', done:'已完成', closed:'已关闭'};
  var overdue = t.due_date && t.status !== 'done' && t.status !== 'closed' && t.due_date < fmtLocalDate();
  var daysInfo = _daysLeft(t.due_date);
  var projHtml = t.project_code ? projCodeTag(t.project_code, t.project_id, t.project_name) + ' ' + escHtml(t.project_name || '') : escHtml(t.project_name || '-');

  var row2 = 'display:grid;grid-template-columns:1fr 1fr;gap:10px';
  var html = '';

  // ── Row 1: 基本信息 + 状态与进度 side by side ──
  html += '<div style="' + row2 + '">' +
    // ── 基本信息 ──
    '<div style="' + _card + '">' +
      '<div style="' + _cardHd + '">基本信息</div>' +
      '<div style="' + _grid2 + '">' +
        '<div><span style="' + _lbl + '">项目</span><div style="' + _val + '">' + projHtml + '</div></div>' +
        '<div><span style="' + _lbl + '">阶段</span><div style="' + _val + '">' + escHtml(t.stage_name || t.execution_name || '-') + '</div></div>' +
        '<div><span style="' + _lbl + '">创建人 → 负责人</span><div style="' + _val + '">' + escHtml(t.reporter_name || '-') + ' → ' + escHtml(t.assignee_name || t.assignee_username || '-') + '</div></div>' +
        '<div><span style="' + _lbl + '">截止日期</span><div style="' + _val + ';color:' + (overdue ? 'var(--danger)' : '') + '">' + (t.due_date || '-') + '<span style="font-size:11px;color:' + (overdue ? 'var(--danger)' : 'var(--muted)') + '">' + daysInfo + '</span></div></div>' +
      '</div>' +
    '</div>' +
    // ── 状态与进度 ──
    '<div style="' + _card + '">' +
      '<div style="' + _cardHd + '">状态与进度</div>' +
      '<div style="' + _grid2 + '">' +
        '<div><span style="' + _lbl + '">状态</span><div style="margin-top:3px">' + renderPill(t.status || 'todo') + '</div></div>' +
        '<div><span style="' + _lbl + '">优先级</span><div style="margin-top:3px">' + _renderPriority(t.priority || 'medium') + '</div></div>' +
        '<div><span style="' + _lbl + '">进度</span><div style="margin-top:2px">' + renderProgressCircle(t.progress || 0, 30, {label:''}) + '</div></div>' +
        (function() {
        var orig = t.original_estimate_hours || t.estimate_hours || 0;
        var est = t.estimate_hours || 0;
        var cons = t.consumed_hours || 0;
        var overtime = cons - orig;
        var h = '<div><span style="' + _lbl + '">工时</span><div style="' + _val + '">';
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
  if (t.description) {
    html += '<div style="' + _card + '">' +
      '<div style="' + _cardHd + '">描述</div>' +
      '<div style="font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-word">' + escHtml(t.description) + '</div>' +
    '</div>';
  }

  // ── Section 4: 产出物 ──
  if (t.output_items && t.output_items.length) {
    html += '<div style="' + _card + '">' +
      '<div style="' + _cardHd + '">产出物</div>' +
      t.output_items.map(function(o) {
        return '<div style="margin-bottom:4px"><a href="' + escHtml(o.url) + '" target="_blank" style="color:var(--accent);font-size:13px">' + escHtml(o.name) + '</a></div>';
      }).join('') +
    '</div>';
  }

  // ── Section 5: 工时日志 ──
  html += '<div style="' + _card + '">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
      '<span style="' + _cardHd + ';margin-bottom:0">工时日志 (' + (t.consumed_hours || 0).toFixed(1) + 'h)</span>' +
      '<button class="btn btn-primary" style="font-size:11px;padding:3px 10px;flex-shrink:0" onclick="openWorklogDialog(' + t.id + ')">+ 记录工时</button>' +
    '</div>' +
    '<div id="tv-worklogs">加载中...</div>' +
  '</div>';

  // ── Section 6: 评论 ──
  html += '<div style="' + _card + '">' +
    '<div style="' + _cardHd + '">评论</div>' +
    '<div id="tv-comments" style="margin-bottom:8px">加载中...</div>' +
    '<div style="display:flex;gap:8px">' +
      '<input class="search-inp" id="tv-comment-input" placeholder="添加评论..." style="flex:1">' +
      '<button class="btn-sm btn-primary" onclick="_submitViewComment(' + t.id + ')">发送</button>' +
    '</div>' +
  '</div>';

  openDialog(escHtml(t.title), html, [
    {text: '编辑', cls: 'btn-primary', onclick: '_closeTaskDialog();openTaskDialog(' + t.id + ')'},
    {text: '关闭', onclick: '_closeTaskDialog()'}
  ], {maxWidth: '60%'});

  // Async load worklogs and comments (DOM exists after openDialog)
  _refreshTaskWorklogs(t.id);
  _loadViewComments(t.id);
}

function _loadViewComments(taskId) {
  API.get('/task-comments?task_id=' + taskId).then(function(comments) {
    var el = document.getElementById('tv-comments');
    if (!el) return;
    if (!comments || !comments.length) { el.innerHTML = '<div style="color:var(--muted);font-size:12px">暂无评论</div>'; return; }
    el.innerHTML = comments.map(function(c) {
      return '<div style="padding:4px 0;border-bottom:1px solid var(--border)">' +
        '<span style="font-size:10px;color:var(--muted)">' + escHtml(c.display_name || c.username) + ' · ' + (fmtISODateTime(c.created_at) || '') + '</span>' +
        '<div style="font-size:13px">' + escHtml(c.content) + '</div></div>';
    }).join('');
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
  var isEdit = !!taskId;
  var title = isEdit ? '编辑任务' : '新建任务';
  _tfProjectId = _taskProjectId || window._taskProjectId; _tfProjectCode = _taskProjectCode || window._taskProjectCode || _taskProjectId; // default to page context
  _tfAssigneeId = null;
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
  openDialog(title, bodyHtml, buttons, {maxWidth: '80vw', maxHeight: '90vh'});
  _clearNoteImagePreviews('tf-desc-img-preview');
  setTimeout(function() {
    initNoteImagePaste('tf-desc');
    if (t.description) { _loadExistingNoteImages(t.description, 'tf-desc-img-preview'); }
  }, 150);

  // Pre-fill project, assignee, and stage from task data (edit mode)
  _tfProjectId = t.project_id || _taskProjectId;
  _tfAssigneeId = t.assignee_id || null;
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
      if (el) el.innerHTML = _renderWorklogTable(logs || [], t.id);
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
  if (data.progress >= 100 && data.status !== 'done') {
    data.status = 'done';
    document.getElementById('tf-status').value = 'done';
    showToast('进度100%，状态已自动设为已完成', 'success');
  }
  if (data.status === 'done' && data.progress < 100) {
    data.status = 'in_progress';
    document.getElementById('tf-status').value = 'in_progress';
    showToast('进度 <100%，状态已自动设为进行中', 'success');
  }
  // When progress reaches 100%, confirm
  if (data.progress >= 100) {
    _pendingTaskConfirm = { isEdit: !!taskId, data: data, taskId: taskId };
    openDialog('确认任务完成',
      '<div style="font-size:13px;margin-bottom:8px">进度 <b>100%</b>，任务状态将设置为<b>已完成</b>。</div>' +
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
  return '<select class="search-inp" id="' + selId + '" style="flex:1.5"><option value="">选择阶段</option>' +
    _batchExecutions.map(function(s) {
      return '<option value="' + (s.execution_id || s.id || '') + '">' + escHtml(s.name || s.standard_stage || '') + '</option>';
    }).join('') + '</select>';
}

function _batchRowHTML(i, r) {
  r = r || {};
  return '<div style="display:flex;gap:3px;margin-bottom:4px;align-items:center;font-size:12px">' +
    _batchExecOptions('bt-exec-' + i) +
    '<input class="search-inp" id="bt-title-' + i + '" value="' + escHtml(r.title || '') + '" placeholder="标题 *" style="flex:2;min-width:120px">' +
    '<select class="search-inp" id="bt-status-' + i + '" style="flex:0.8;min-width:70px"><option value="todo">待办</option><option value="in_progress">进行中</option><option value="review">评审中</option><option value="done">已完成</option><option value="closed">已关闭</option></select>' +
    '<select class="search-inp" id="bt-priority-' + i + '" style="flex:0.7;min-width:55px"><option value="medium">中</option><option value="low">低</option><option value="high">高</option><option value="critical">紧急</option></select>' +
    '<select class="search-inp" id="bt-assignee-' + i + '" style="flex:0.9;min-width:120px"><option value="">负责人</option></select>' +
    '<input class="search-inp" id="bt-estimate-' + i + '" value="' + escHtml(r.estimate || '') + '" placeholder="工时(h)" style="flex:0.6;min-width:55px" type="number" step="0.5">' +
    '<input class="search-inp" id="bt-due-' + i + '" value="' + escHtml(r.due_date || '') + '" type="date" style="flex:1;min-width:110px">' +
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

  var html = projHtml + '<div id="batch-rows" style="max-height:400px;overflow:auto;min-width:900px">';
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
  var opts = '<option value="">选择阶段</option>' +
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
  var rows = container.children;
  for (var i = 0; i < rows.length; i++) {
    var titleEl = rows[i].querySelector('[id^="bt-title-"]');
    var execEl = rows[i].querySelector('[id^="bt-exec-"]');
    var statusEl = rows[i].querySelector('[id^="bt-status-"]');
    var priorityEl = rows[i].querySelector('[id^="bt-priority-"]');
    var assigneeEl = rows[i].querySelector('[id^="bt-assignee-"]');
    var estEl = rows[i].querySelector('[id^="bt-estimate-"]');
    var dueEl = rows[i].querySelector('[id^="bt-due-"]');
    var descEl = rows[i].querySelector('[id^="bt-desc-"]');
    var title = titleEl ? titleEl.value.trim() : '';
    if (!title) continue;
    var execVal = execEl ? execEl.value : '';
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
  if (!tasks.length) { showToast('请至少填写一个任务标题', 'error'); return; }

  try {
    await API.post('/tasks/batch', {project_id: _batchProjectId, tasks: tasks});
    showToast('已创建 ' + tasks.length + ' 个任务', 'success');
    _closeTaskDialog();
    loadTaskData();
  } catch(e) {
    showToast('批量创建失败: ' + (e.message || '未知错误'), 'error');
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
  var html = '<div style="overflow-x:auto;max-width:100%"><table class="proj-table" style="font-size:12px;width:100%"><thead><tr>' +
    '<th>日期</th><th>用户</th><th>工时(h)</th><th>描述</th><th>操作</th></tr></thead><tbody>';
  logs.forEach(function(w) {
    html += '<tr>' +
      '<td>' + (w.date || '?') + '</td>' +
      '<td style="font-size:11px">' + escHtml(w.display_name || w.username || '?') + '</td>' +
      '<td>' + w.hours.toFixed(1) + '</td>' +
      '<td style="text-align:left;white-space:normal;word-break:break-word">' + escHtml(w.description || '') + '</td>' +
      '<td>' + iconEdit('openWorklogEditDialog(' + w.id + ',' + taskId + ')', '编辑') +
        iconDelete('deleteWorklogById(' + w.id + ',' + taskId + ')', '删除') + '</td>' +
    '</tr>';
  });
  return html + '</tbody></table></div>';
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
      {text:'取消',onclick:'_closeTaskDialog()'},
      {text:'提交',cls:'btn-primary',onclick:'submitWorklog('+taskId+')'}
    ], {maxWidth:450});
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
  try {
    await API.post('/worklogs', {task_id:taskId, hours:hours, date:date, description:desc});
    await API.put('/tasks/'+taskId, {progress:progress});
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
    _closeTaskDialog();
    _refreshTaskWorklogs(taskId);
    loadTaskData();
  } catch(e) { showToast('记录失败: '+(e.message||'未知错误'), 'error'); }
}

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
  try {
    await API.put('/worklogs/'+wlId, {hours:hours, date:date, description:desc});
    await API.put('/tasks/'+taskId, {progress:progress});
    showToast('工时已更新', 'success');
    _closeTaskDialog();
    _refreshTaskWorklogs(taskId);
    loadTaskData();
  } catch(e) { showToast('更新失败: '+(e.message||'未知错误'), 'error'); }
}

function deleteWorklogById(wlId, taskId) {
  if (!confirm('确认删除此工时记录？')) return;
  API.del('/worklogs/' + wlId).then(function() {
    showToast('已删除', 'success');
    _refreshTaskWorklogs(taskId);
    loadTaskData();
  }).catch(function(e) { showToast('删除失败: ' + (e.message || ''), 'error'); });
}

function _refreshTaskWorklogs(taskId) {
  API.get('/worklogs?task_id=' + taskId).then(function(logs) {
    var el = document.getElementById('tv-worklogs');
    if (!el) el = document.getElementById('tf-worklogs');
    if (el) el.innerHTML = _renderWorklogTable(logs || [], taskId);
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

async function deleteTask(taskId) {
  // Find task title for confirmation
  var taskTitle = '';
  var taskEl = document.querySelector('#task-content tr[data-task-id="' + taskId + '"] td:nth-child(2)');
  if (!taskEl) taskEl = document.querySelector('#pma-tasks-content tr[data-task-id="' + taskId + '"] td:nth-child(2)');
  if (taskEl) taskTitle = taskEl.textContent.trim();
  openDialog('删除任务',
    '<div class="confirm-dlg">确认删除任务 <b>' + escHtml(taskTitle || '#' + taskId) + '</b>？<br><br>相关工时记录和评论也会被删除。</div>',
    [{text: '取消', onclick: 'closeSharedDialog()'},
     {text: '确认删除', cls: 'btn-danger', onclick: 'closeSharedDialog();doDeleteTask(' + taskId + ',\'' + escHtml(taskTitle || '').replace(/'/g, "\\'") + '\')'}],
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

