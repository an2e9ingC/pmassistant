/* ═══════════════════════════════════════════════════
   PMA NATIVE TASKS — table/board/calendar views
   ═══════════════════════════════════════════════════ */

var _taskViewMode = 'table';  // 'table' | 'board' | 'calendar'
var _taskProjectId = null;   // null = show project selector
var _taskProjectName = '';
var _taskFilterStatus = '';
var _taskFilterExecution = '';
var _taskFilterAssignee = '';

/* ── Entry Point ── */

function initTasks() {
  // Called from VIEW_REGISTRY (lazy-loaded)
  _taskProjectId = null;
  _taskFilterStatus = '';
  _taskFilterExecution = '';
  _taskFilterAssignee = '';
  renderTasksPage();
}

function initProjectTasks(projectId, projectName) {
  // Called from project detail tab — no project selector
  _taskProjectId = projectId;
  _taskProjectName = projectName || '';
  _taskFilterStatus = '';
  _taskFilterExecution = '';
  _taskFilterAssignee = '';
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

  var html = '<div style="display:flex;height:100%">' +
    // Left sidebar (only in standalone mode)
    (!isEmbedded ? '<div id="task-leftbar" style="width:240px;border-right:1px solid var(--border);padding:16px 12px;overflow-y:auto;flex-shrink:0">' +
      _renderTaskFilters() + '</div>' : '') +
    // Right content
    '<div style="flex:1;display:flex;flex-direction:column;min-width:0">' +
      (showToolbar ? '<div class="section-hd" style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--border)">' +
        '<div style="display:flex;align-items:center;gap:12px">' +
          '<span style="font-weight:600;font-size:15px">任务管理</span>' +
          '<span style="display:flex;gap:4px">' +
            '<button class="btn-sm" id="task-view-table" onclick="switchTaskView(\'table\')" style="background:var(--accent);color:#fff">列表</button>' +
            '<button class="btn-sm" id="task-view-board" onclick="switchTaskView(\'board\')">看板</button>' +
            '<button class="btn-sm" id="task-view-cal" onclick="switchTaskView(\'calendar\')">日历</button>' +
          '</span>' +
        '</div>' +
        '<div style="display:flex;gap:8px">' +
          '<button class="btn-sm" onclick="openBatchCreateDialog()" title="批量创建">+批量</button>' +
          '<button class="btn-sm" onclick="openImportTasksDialog()" title="从其他项目导入">导入</button>' +
          '<button class="btn-sm btn-primary" onclick="openTaskDialog()">+ 新建任务</button>' +
        '</div>' +
      '</div>' : '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 16px;border-bottom:1px solid var(--border)">' +
        '<span style="font-weight:600;font-size:13px">任务列表</span>' +
        '<span style="display:flex;gap:4px">' +
          '<button class="btn-xs" id="task-view-table" onclick="switchTaskView(\'table\')" style="background:var(--accent);color:#fff">列表</button>' +
          '<button class="btn-xs" id="task-view-board" onclick="switchTaskView(\'board\')">看板</button>' +
        '</span>' +
        '<div style="display:flex;gap:4px">' +
          '<button class="btn-xs" onclick="openBatchCreateDialog()">+批量</button>' +
          '<button class="btn-xs btn-primary" onclick="openTaskDialog()">+新建</button>' +
        '</div>' +
      '</div>') +
      '<div id="task-content" style="flex:1;overflow:auto;padding:16px">加载中...</div>' +
    '</div>' +
  '</div>';

  container.innerHTML = html;
  switchTaskView(_taskViewMode);
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
        onSelect: function(p) { _taskProjectId = p.id; _taskProjectName = p.name; loadTaskData(); }
      }) +
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
        '<option value="me">我负责的</option></select>' +
    '</div>';
}

/* ── View Switching ── */

function switchTaskView(mode) {
  _taskViewMode = mode;
  ['table','board','calendar'].forEach(function(m) {
    var btn = document.getElementById('task-view-' + m);
    if (btn) { btn.style.background = m === mode ? 'var(--accent)' : ''; btn.style.color = m === mode ? '#fff' : ''; /* white text on accent — universal */ }
  });
  loadTaskData();
}

/* ── Data Loading ── */

async function loadTaskData() {
  var content = document.getElementById('task-content');
  if (!content) return;
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
    else if (_taskViewMode === 'board') renderTaskBoard(data || []);
    else renderTaskCalendar();

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
  var content = document.getElementById('task-content');
  if (!content) return;

  if (!tasks || !tasks.length) {
    content.innerHTML = '<div class="empty-state" style="text-align:center;padding:40px">暂无任务，点击右上角 "新建任务" 开始</div>';
    return;
  }

  // Build stage lookup
  var stageMap = {};
  if (execs) {
    execs.forEach(function(s) {
      stageMap[s.execution_id || s.id || ''] = s.name || s.standard_stage || '未分类';
    });
  }

  // Group by execution
  var groups = {};
  var ungrouped = [];
  tasks.forEach(function(t) {
    var eid = t.execution_id ? String(t.execution_id) : '_none';
    if (t.execution_id && stageMap[eid]) {
      if (!groups[eid]) groups[eid] = { name: stageMap[eid], tasks: [] };
      groups[eid].tasks.push(t);
    } else {
      ungrouped.push(t);
    }
  });

  var html = '<table class="proj-table"><thead><tr>' +
    '<th style="width:35%">标题</th>' +
    '<th style="width:10%">阶段</th>' +
    '<th style="width:8%">状态</th>' +
    '<th style="width:6%">优先级</th>' +
    '<th style="width:8%">负责人</th>' +
    '<th style="width:8%">预估工时</th>' +
    '<th style="width:12%">实际工时</th>' +
    '<th style="width:8%">截止日期</th>' +
    '<th style="width:5%"></th>' +
    '</tr></thead><tbody>';

  // Render grouped tasks
  var groupKeys = Object.keys(groups);
  groupKeys.forEach(function(eid) {
    var g = groups[eid];
    var doneCount = g.tasks.filter(function(t) { return t.status === 'done' || t.status === 'closed'; }).length;
    var totalConsumed = g.tasks.reduce(function(s, t) { return s + (t.consumed_hours || 0); }, 0);
    var totalEstimate = g.tasks.reduce(function(s, t) { return s + (t.estimate_hours || 0); }, 0);
    html += '<tr class="stage-group-row" style="background:var(--bg-secondary)">' +
      '<td colspan="9" style="font-weight:600;font-size:12px;padding:6px 12px">' +
        escHtml(g.name) + ' <span style="color:var(--muted);font-weight:400">(' + g.tasks.length + '个任务, ' + doneCount + '完成, ' +
        totalConsumed.toFixed(1) + '/' + totalEstimate.toFixed(1) + 'h)</span>' +
      '</td></tr>';
    g.tasks.forEach(function(t) { html += _renderTaskRow(t, stageMap); });
  });

  // Unrouped
  if (ungrouped.length) {
    html += '<tr class="stage-group-row" style="background:var(--bg-secondary)">' +
      '<td colspan="9" style="font-weight:600;font-size:12px;padding:6px 12px">未分类 <span style="color:var(--muted);font-weight:400">(' + ungrouped.length + '个任务)</span></td></tr>';
    ungrouped.forEach(function(t) { html += _renderTaskRow(t, stageMap); });
  }

  html += '</tbody></table>';
  content.innerHTML = html;
}

function _renderTaskRow(t, stageMap) {
  var stageName = '';
  if (t.execution_id && stageMap[String(t.execution_id)]) {
    stageName = stageMap[String(t.execution_id)];
  }
  var progressPct = t.estimate_hours > 0 ? Math.round((t.consumed_hours || 0) / t.estimate_hours * 100) : 0;
  var overdue = t.due_date && t.status !== 'done' && t.status !== 'closed' && t.due_date < new Date().toISOString().slice(0,10);
  return '<tr class="clickable">' +
    '<td><a href="javascript:void(0)" onclick="openTaskDialog(' + t.id + ')" style="color:var(--accent)">' + escHtml(t.title) + '</a></td>' +
    '<td>' + (stageName ? '<span style="font-size:11px;color:var(--muted)">' + escHtml(stageName) + '</span>' : '-') + '</td>' +
    '<td>' + renderPill(t.status || 'todo') + '</td>' +
    '<td>' + _renderPriority(t.priority) + '</td>' +
    '<td style="font-size:12px">' + (t.assignee_id || '-') + '</td>' +
    '<td>' + (t.estimate_hours || 0).toFixed(1) + 'h</td>' +
    '<td>' +
      '<span style="font-size:12px">' + (t.consumed_hours || 0).toFixed(1) + 'h</span>' +
      '<div style="margin-top:2px">' + renderProgressBar(progressPct) + '</div>' +
    '</td>' +
    '<td style="color:' + (overdue ? 'var(--red)' : '') + '">' + (t.due_date || '-') + '</td>' +
    '<td>' +
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

function renderTaskBoard(tasks) {
  var content = document.getElementById('task-content');
  if (!content) return;

  var columns = [
    {key: 'todo', label: '待办', color: 'var(--muted)'},
    {key: 'in_progress', label: '进行中', color: 'var(--accent)'},
    {key: 'review', label: '评审中', color: 'var(--warn)'},
    {key: 'done', label: '已完成', color: 'var(--success)'},
  ];

  var byStatus = {};
  columns.forEach(function(c) { byStatus[c.key] = []; });
  if (tasks) {
    tasks.forEach(function(t) {
      var s = t.status || 'todo';
      if (!byStatus[s]) s = 'todo';
      if (byStatus[s]) byStatus[s].push(t);
    });
  }

  var html = '<div style="display:flex;gap:12px;height:100%">';
  columns.forEach(function(col) {
    var items = byStatus[col.key];
    html += '<div style="flex:1;background:var(--bg-secondary);border-radius:6px;padding:12px;display:flex;flex-direction:column">' +
      '<div style="font-weight:600;font-size:13px;margin-bottom:8px;display:flex;align-items:center;gap:6px">' +
        '<span style="width:8px;height:8px;border-radius:50%;background:' + col.color + ';display:inline-block"></span>' +
        col.label + ' <span style="color:var(--muted);font-weight:400;font-size:11px">(' + items.length + ')</span>' +
      '</div>' +
      '<div style="flex:1;overflow-y:auto">';
    items.forEach(function(t) {
      html += '<div class="card-pad" style="margin-bottom:8px;cursor:pointer;font-size:12px" onclick="openTaskDialog(' + t.id + ')">' +
        '<div style="font-weight:500;margin-bottom:4px">' + escHtml(t.title) + '</div>' +
        '<div style="display:flex;gap:4px;align-items:center;font-size:10px;color:var(--muted)">' +
          _renderPriority(t.priority) +
          '<span>' + (t.consumed_hours || 0).toFixed(1) + '/' + (t.estimate_hours || 0).toFixed(1) + 'h</span>' +
          (t.due_date ? '<span>' + t.due_date + '</span>' : '') +
        '</div>' +
      '</div>';
    });
    html += '</div></div>';
  });
  html += '</div>';
  content.innerHTML = html;
}

/* ── Calendar View ── */

async function renderTaskCalendar() {
  var content = document.getElementById('task-content');
  if (!content) return;

  var now = new Date();
  var weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay() + 1); // Monday
  var weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);

  var dateFrom = weekStart.toISOString().slice(0,10);
  var dateTo = weekEnd.toISOString().slice(0,10);

  try {
    var user = getCurrentUser();
    var calData = await API.get('/worklogs/calendar?user_id=' + (user ? user.id : '') + '&date_from=' + dateFrom + '&date_to=' + dateTo);

    var dailyMap = {};
    if (calData && calData.daily) {
      calData.daily.forEach(function(d) { dailyMap[d.date] = d; });
    }

    var html = '<div style="padding:16px">';
    var weekTotal = calData ? (calData.total || 0) : 0;
    html += '<div style="font-weight:600;font-size:15px;margin-bottom:4px">本周工时: ' + weekTotal.toFixed(1) + 'h</div>';
    html += '<div style="font-size:11px;color:var(--muted);margin-bottom:16px">工作强度: 日标准 8h</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:8px">';

    var dayLabels = ['一','二','三','四','五','六','日'];
    for (var i = 0; i < 7; i++) {
      var d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      var dStr = d.toISOString().slice(0,10);
      var dayData = dailyMap[dStr];
      var hours = dayData ? dayData.total_hours : 0;
      var intensity = _getIntensityStyle(hours);

      html += '<div onclick="openDayDetail(\'' + dStr + '\',' + hours + ')" style="border:1px solid var(--border);border-radius:6px;padding:8px;text-align:center;cursor:pointer;' + intensity.bg + '">' +
        '<div style="font-size:11px;color:var(--muted)">' + dayLabels[i] + '</div>' +
        '<div style="font-size:18px;font-weight:700;margin:4px 0;color:' + intensity.text + '">' + d.getDate() + '</div>' +
        '<div style="font-size:13px;font-weight:600;color:' + intensity.text + '">' + hours.toFixed(1) + 'h</div>' +
        '<div style="font-size:10px;color:' + intensity.text + ';opacity:0.7">' + intensity.label + '</div>' +
      '</div>';
    }
    html += '</div></div>';
    content.innerHTML = html;
  } catch(e) {
    content.innerHTML = '<div class="error-state">加载日历失败: ' + escHtml(e.message || '') + '</div>';
  }
}

function _getIntensityStyle(hours) {
  if (hours <= 0) return {bg: '', text: 'var(--muted)', label: '休息'};
  var pct = hours / 8;
  if (pct <= 0.25) return {bg: 'background:var(--success-lt)', text: 'var(--success)', label: '轻松'};
  if (pct <= 0.5)  return {bg: 'background:var(--accent-lt)', text: 'var(--accent)', label: '适中'};
  if (pct <= 0.75) return {bg: 'background:var(--warn-lt)', text: 'var(--warn)', label: '饱和'};
  if (pct <= 1.0)  return {bg: 'background:var(--danger-lt)', text: 'var(--danger)', label: '满负荷'};
  return {bg: 'background:var(--danger);color:#fff', text: '#fff', label: '超时'};
}

function openDayDetail(dateStr, totalHours) {
  API.get('/worklogs/calendar?date_from=' + dateStr + '&date_to=' + dateStr).then(function(data) {
    var daily = (data && data.daily) ? data.daily : [];
    var dayData = daily.length ? daily[0] : null;
    var tasksHtml = '';
    if (dayData && dayData.tasks) {
      dayData.tasks.forEach(function(t) {
        var pct = totalHours > 0 ? Math.round(t.hours / totalHours * 100) : 0;
        tasksHtml += '<div style="padding:6px 0;border-bottom:1px solid var(--border)">' +
          '<div style="font-weight:500">' + escHtml(t.title) + '</div>' +
          '<div style="font-size:11px;color:var(--muted)">' + t.hours.toFixed(1) + 'h (' + pct + '%)' + (t.description ? ' — ' + escHtml(t.description) : '') + '</div>' +
        '</div>';
      });
    }
    openDialog(dateStr + ' 工时详情 (' + totalHours.toFixed(1) + 'h)',
      '<div style="max-height:400px;overflow-y:auto">' + (tasksHtml || '<div style="color:var(--muted)">当日无工时记录</div>') + '</div>',
      [{text: '关闭', onclick: 'document.querySelector(\".note-dialog-overlay\").remove()'}]);

  }).catch(function(e) {
    showToast('加载详情失败: ' + (e.message || '未知错误'), 'error');
  });
}

/* ── Task Dialog ── */

var _tfProjectId = null; // project ID selected in the task form

function _closeTaskDialog() {
  var overlay = document.querySelector('.note-dialog-overlay');
  if (overlay) overlay.remove();
}

function openTaskDialog(taskId) {
  var isEdit = !!taskId;
  var title = isEdit ? '编辑任务' : '新建任务';
  _tfProjectId = _taskProjectId; // default to page context

  if (isEdit) {
    API.get('/tasks/' + taskId).then(function(data) {
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

  // Build execution dropdown options
  var execOpts = '';
  if (_taskProjectId) {
    // Will be populated asynchronously; show a placeholder
    execOpts = '<option value="">加载中...</option>';
  }

  var bodyHtml =
    // Project selector (pre-filled from context)
    '<div style="margin-bottom:12px">' +
      '<label style="font-size:11px;color:var(--muted)">所属项目 *</label>' +
      '<div style="margin-top:2px">' + createProjectCombo({
        comboId: 'tf-proj-combo',
        inputId: 'tf-project-input',
        dropdownId: 'tf-proj-dropdown',
        selectedIdFn: function() { return _tfProjectId; },
        onSelect: function(p) { _tfProjectId = p.id; }
      }) + '</div>' +
    '</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
      '<div><label style="font-size:11px;color:var(--muted)">标题 *</label>' +
        '<input class="search-inp" id="tf-title" value="' + escHtml(t.title || '') + '" style="width:100%;box-sizing:border-box;margin-top:2px"></div>' +
      '<div><label style="font-size:11px;color:var(--muted)">阶段</label>' +
        '<select class="search-inp" id="tf-execution" style="width:100%;box-sizing:border-box;margin-top:2px"><option value="">选择阶段...</option>' + execOpts + '</select></div>' +
      '<div><label style="font-size:11px;color:var(--muted)">状态</label>' +
        '<select class="search-inp" id="tf-status" style="width:100%;box-sizing:border-box;margin-top:2px">' +
          '<option value="todo"' + (t.status==='todo'?' selected':'') + '>待办</option>' +
          '<option value="in_progress"' + (t.status==='in_progress'?' selected':'') + '>进行中</option>' +
          '<option value="review"' + (t.status==='review'?' selected':'') + '>评审中</option>' +
          '<option value="done"' + (t.status==='done'?' selected':'') + '>已完成</option>' +
          '<option value="closed"' + (t.status==='closed'?' selected':'') + '>已关闭</option>' +
        '</select></div>' +
      '<div><label style="font-size:11px;color:var(--muted)">优先级</label>' +
        '<select class="search-inp" id="tf-priority" style="width:100%;box-sizing:border-box;margin-top:2px">' +
          '<option value="low"' + (t.priority==='low'?' selected':'') + '>低</option>' +
          '<option value="medium"' + (t.priority==='medium'?' selected':'') + '>中</option>' +
          '<option value="high"' + (t.priority==='high'?' selected':'') + '>高</option>' +
          '<option value="critical"' + (t.priority==='critical'?' selected':'') + '>紧急</option>' +
        '</select></div>' +
      '<div><label style="font-size:11px;color:var(--muted)">预估工时(h)</label>' +
        '<input class="search-inp" id="tf-estimate" type="number" step="0.5" min="0" value="' + (t.estimate_hours || '') + '" style="width:100%;box-sizing:border-box;margin-top:2px"></div>' +
      '<div><label style="font-size:11px;color:var(--muted)">截止日期</label>' +
        '<input class="search-inp" id="tf-due" type="date" value="' + (t.due_date || '') + '" style="width:100%;box-sizing:border-box;margin-top:2px"></div>' +
    '</div>' +
    '<div style="margin-top:12px"><label style="font-size:11px;color:var(--muted)">描述</label>' +
      '<textarea class="search-inp" id="tf-desc" rows="3" style="width:100%;box-sizing:border-box;margin-top:2px;resize:vertical">' + escHtml(t.description || '') + '</textarea></div>';

  // Output items
  var outputs = t.output_items || [];
  bodyHtml += '<div style="margin-top:12px"><label style="font-size:11px;color:var(--muted)">产出物</label>' +
    '<div id="tf-outputs">';
  outputs.forEach(function(o, i) {
    bodyHtml += _renderOutputRow(i, o);
  });
  bodyHtml += '</div>' +
    '<button class="btn-xs" onclick="addOutputRow()" style="margin-top:4px">+ 添加产出物</button></div>';

  // Worklog section (edit only)
  if (isEdit) {
    bodyHtml += '<div style="margin-top:16px;border-top:1px solid var(--border);padding-top:12px">' +
      '<div style="font-weight:600;font-size:13px;margin-bottom:8px">工时日志 (' + (t.consumed_hours || 0).toFixed(1) + 'h)</div>' +
      '<div id="tf-worklogs">加载中...</div>' +
      '<button class="btn-sm" onclick="openWorklogDialog(' + t.id + ')" style="margin-top:8px">+ 记录工时</button>' +
    '</div>';

    // Comments
    bodyHtml += '<div style="margin-top:16px;border-top:1px solid var(--border);padding-top:12px">' +
      '<div style="font-weight:600;font-size:13px;margin-bottom:8px">评论</div>' +
      '<div id="tf-comments">加载中...</div>' +
      '<div style="display:flex;gap:8px;margin-top:8px">' +
        '<input class="search-inp" id="tf-comment-input" placeholder="添加评论..." style="flex:1">' +
        '<button class="btn-sm btn-primary" onclick="submitComment(' + t.id + ')">发送</button>' +
      '</div></div>';
  }

  var buttons = [
    {text: '取消', onclick: '_closeTaskDialog()'},
    {text: (isEdit ? '保存' : '创建'), cls: 'btn-primary', onclick: 'submitTask(' + (t.id || 'null') + ')'}
  ];

  openDialog(title, bodyHtml, buttons, {maxWidth: 700});

  // Pre-fill project in form
  _tfProjectId = _taskProjectId;
  setTimeout(function() {
    var tfInput = document.getElementById('tf-project-input');
    if (tfInput && _taskProjectName) tfInput.value = _taskProjectName;
  }, 100);

  // Async: load executions for project (pre-fill from detail tab)
  if (_taskProjectId) {
    API.get('/projects/' + _taskProjectId + '/gantt').then(function(data) {
      var sel = document.getElementById('tf-execution');
      if (!sel) return;
      sel.innerHTML = '<option value="">选择阶段...</option>';
      if (data && data.stages) {
        data.stages.forEach(function(s) {
          var eid = s.execution_id || s.id || '';
          var opt = document.createElement('option');
          opt.value = eid;
          opt.textContent = s.name || s.standard_stage || '';
          if (t.execution_id && String(t.execution_id) === String(eid)) opt.selected = true;
          sel.appendChild(opt);
        });
      }
    }).catch(function() {});
  }

  // Async: load worklogs and comments (edit mode)
  if (isEdit) {
    _loadWorklogs(t.id);
    _loadComments(t.id);
  }
}

function _renderOutputRow(idx, o) {
  return '<div style="display:flex;gap:6px;margin-bottom:4px;align-items:center">' +
    '<input class="search-inp" id="tf-out-name-' + idx + '" value="' + escHtml(o.name || '') + '" placeholder="名称" style="flex:2">' +
    '<input class="search-inp" id="tf-out-url-' + idx + '" value="' + escHtml(o.url || '') + '" placeholder="链接" style="flex:3">' +
    '<button class="btn-xs" onclick="this.parentElement.remove()" style="color:var(--red)">×</button>' +
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
  var data = {
    title: document.getElementById('tf-title').value.trim(),
    description: document.getElementById('tf-desc').value.trim(),
    status: document.getElementById('tf-status').value,
    priority: document.getElementById('tf-priority').value,
    estimate_hours: parseFloat(document.getElementById('tf-estimate').value) || 0,
    due_date: document.getElementById('tf-due').value || null,
    execution_id: parseInt(document.getElementById('tf-execution').value) || null,
    project_id: _tfProjectId || _taskProjectId,
  };

  if (!data.title) { showToast('标题不能为空', 'error'); return; }
  if (!data.project_id) { showToast('请在对话框中选择所属项目', 'error'); return; }

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

  try {
    if (taskId) {
      await API.put('/tasks/' + taskId, data);
      showToast('任务已更新', 'success');
    } else {
      await API.post('/tasks', data);
      showToast('任务已创建', 'success');
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
  if (!_taskProjectId) { showToast('请先选择项目', 'error'); return; }

  var rows = [{title: '', execution: '', assignee: '', estimate: ''}];
  _renderBatchForm(rows);
}

function _renderBatchForm(rows) {
  var html = '<div id="batch-rows" style="max-height:400px;overflow-y:auto">';
  rows.forEach(function(r, i) {
    html += '<div style="display:flex;gap:6px;margin-bottom:6px;align-items:center">' +
      '<input class="search-inp" id="bt-title-' + i + '" value="' + escHtml(r.title) + '" placeholder="任务标题" style="flex:4">' +
      '<input class="search-inp" id="bt-exec-' + i + '" value="' + escHtml(r.execution) + '" placeholder="阶段ID" style="flex:1">' +
      '<input class="search-inp" id="bt-assignee-' + i + '" value="' + escHtml(r.assignee) + '" placeholder="负责人ID" style="flex:1">' +
      '<input class="search-inp" id="bt-estimate-' + i + '" value="' + escHtml(r.estimate) + '" placeholder="工时" style="flex:1" type="number" step="0.5">' +
      '<button class="btn-xs" onclick="this.parentElement.remove()" style="color:var(--red)">×</button>' +
    '</div>';
  });
  html += '</div>' +
    '<button class="btn-xs" onclick="_batchAddRow()" style="margin-top:4px">+ 添加行</button>';

  openDialog('批量创建任务', html, [
    {text: '取消', onclick: '_closeTaskDialog()'},
    {text: '创建', cls: 'btn-primary', onclick: '_submitBatchCreate()'}
  ], {maxWidth: 700});
}

function _batchAddRow() {
  var container = document.getElementById('batch-rows');
  if (!container) return;
  var i = container.children.length;
  container.insertAdjacentHTML('beforeend',
    '<div style="display:flex;gap:6px;margin-bottom:6px;align-items:center">' +
      '<input class="search-inp" id="bt-title-' + i + '" placeholder="任务标题" style="flex:4">' +
      '<input class="search-inp" id="bt-exec-' + i + '" placeholder="阶段ID" style="flex:1">' +
      '<input class="search-inp" id="bt-assignee-' + i + '" placeholder="负责人ID" style="flex:1">' +
      '<input class="search-inp" id="bt-estimate-' + i + '" placeholder="工时" style="flex:1" type="number" step="0.5">' +
      '<button class="btn-xs" onclick="this.parentElement.remove()" style="color:var(--red)">×</button>' +
    '</div>');
}

async function _submitBatchCreate() {
  var tasks = [];
  var container = document.getElementById('batch-rows');
  if (!container) return;
  var rows = container.children;
  for (var i = 0; i < rows.length; i++) {
    var titleEl = rows[i].querySelector('[id^="bt-title-"]');
    var execEl = rows[i].querySelector('[id^="bt-exec-"]');
    var assigneeEl = rows[i].querySelector('[id^="bt-assignee-"]');
    var estEl = rows[i].querySelector('[id^="bt-estimate-"]');
    var title = titleEl ? titleEl.value.trim() : '';
    if (!title) continue;
    tasks.push({
      title: title,
      execution_id: execEl ? (parseInt(execEl.value) || null) : null,
      assignee_id: assigneeEl ? (parseInt(assigneeEl.value) || null) : null,
      estimate_hours: estEl ? (parseFloat(estEl.value) || 0) : 0,
    });
  }
  if (!tasks.length) { showToast('请至少填写一个任务标题', 'error'); return; }

  try {
    await API.post('/tasks/batch', {project_id: _taskProjectId, tasks: tasks});
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

function openWorklogDialog(taskId) {
  var today = new Date().toISOString().slice(0,10);
  var html = '<div>' +
    '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">日期</label>' +
      '<input class="search-inp" id="wl-date" type="date" value="' + today + '" style="width:100%;box-sizing:border-box;margin-top:2px"></div>' +
    '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">工时(h)</label>' +
      '<input class="search-inp" id="wl-hours" type="number" step="0.5" min="0.5" value="1" style="width:100%;box-sizing:border-box;margin-top:2px"></div>' +
    '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">工作描述</label>' +
      '<textarea class="search-inp" id="wl-desc" rows="2" style="width:100%;box-sizing:border-box;margin-top:2px;resize:vertical"></textarea></div>' +
    '<div id="wl-history" style="max-height:200px;overflow-y:auto;margin-top:12px;border-top:1px solid var(--border);padding-top:8px"></div>' +
  '</div>';

  openDialog('记录工时', html, [
    {text: '取消', onclick: '_closeTaskDialog()'},
    {text: '提交', cls: 'btn-primary', onclick: 'submitWorklog(' + taskId + ')'}
  ], {maxWidth: 450});

  // Load history
  _loadWorklogHistory(taskId);
}

async function submitWorklog(taskId) {
  var hours = parseFloat(document.getElementById('wl-hours').value);
  if (!hours || hours <= 0) { showToast('请输入有效的工时数', 'error'); return; }
  try {
    await API.post('/worklogs', {
      task_id: taskId,
      hours: hours,
      date: document.getElementById('wl-date').value,
      description: document.getElementById('wl-desc').value.trim(),
    });
    showToast('工时已记录', 'success');
    _closeTaskDialog();
    loadTaskData();
  } catch(e) {
    showToast('记录失败: ' + (e.message || '未知错误'), 'error');
  }
}

async function _loadWorklogHistory(taskId) {
  var el = document.getElementById('wl-history');
  if (!el) return;
  try {
    var logs = await API.get('/worklogs?task_id=' + taskId);
    if (!logs || !logs.length) {
      el.innerHTML = '<div style="color:var(--muted);font-size:12px">暂无工时记录</div>';
      return;
    }
    var html = '<div style="font-size:11px;font-weight:600;margin-bottom:4px">历史记录</div>';
    logs.forEach(function(w) {
      html += '<div style="font-size:11px;padding:3px 0;border-bottom:1px solid var(--border)">' +
        (w.date || '?') + ' | ' + w.hours.toFixed(1) + 'h' +
        (w.description ? ' | ' + escHtml(w.description) : '') +
        ' <a href="javascript:void(0)" onclick="deleteWorklogConfirm(' + w.id + ',' + taskId + ')" style="color:var(--red);font-size:10px">删除</a>' +
      '</div>';
    });
    el.innerHTML = html;
  } catch(e) { el.innerHTML = ''; }
}

function deleteWorklogConfirm(wlId, taskId) {
  if (!confirm('确认删除此工时记录？')) return;
  API.del('/worklogs/' + wlId).then(function() {
    showToast('已删除', 'success');
    _loadWorklogHistory(taskId);
    loadTaskData();
  }).catch(function(e) {
    showToast('删除失败: ' + (e.message || ''), 'error');
  });
}

/* ── Worklogs (in task dialog) ── */

async function _loadWorklogs(taskId) {
  var el = document.getElementById('tf-worklogs');
  if (!el) return;
  try {
    var logs = await API.get('/worklogs?task_id=' + taskId);
    if (!logs || !logs.length) {
      el.innerHTML = '<div style="color:var(--muted);font-size:12px">暂无工时记录</div>';
      return;
    }
    var html = '';
    logs.forEach(function(w) {
      html += '<div style="font-size:11px;padding:3px 0;border-bottom:1px solid var(--border)">' +
        (w.date || '?') + ' | ' + w.hours.toFixed(1) + 'h' +
        (w.description ? ' | ' + escHtml(w.description) : '') +
      '</div>';
    });
    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<div style="color:var(--red)">加载失败</div>'; }
}

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
        '<div style="font-size:10px;color:var(--muted);margin-bottom:2px">' + escHtml(c.display_name || c.username) + ' · ' + (c.created_at || '') + '</div>' +
        '<div style="font-size:13px">' + escHtml(c.content) + '</div>' +
      '</div>';
    });
    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<div style="color:var(--red)">加载失败</div>'; }
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
  if (!confirm('确认删除此任务？相关工时记录和评论也会被删除。')) return;
  try {
    await verifyPassword('删除任务', 'skip_task_delete');
    await API.del('/tasks/' + taskId);
    showToast('任务已删除', 'success');
    loadTaskData();
  } catch(e) {
    if (e.message !== 'cancel') showToast('删除失败: ' + (e.message || ''), 'error');
  }
}
