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
  _taskProjectId = null;
  _taskFilterStatus = '';
  _taskFilterExecution = '';
  _taskFilterAssignee = 'me';  // default: show current user's tasks
  _calChangeCallback = loadTaskData;
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
          '</span>' +
        '</div>' +
        '<div style="display:flex;gap:8px">' +
          '<button class="btn btn-primary" style="font-size:11px;padding:3px 10px" onclick="openBatchCreateDialog()" title="批量创建">+批量</button>' +
          '<button class="btn-sm" onclick="openImportTasksDialog()" title="从其他项目导入">导入</button>' +
          '<button class="btn btn-primary" style="font-size:11px;padding:3px 10px" onclick="openTaskDialog()">+ 新建任务</button>' +
        '</div>' +
      '</div>' : '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 16px;border-bottom:1px solid var(--border)">' +
        '<span style="font-weight:600;font-size:13px">任务列表</span>' +
        '<div style="display:flex;gap:8px">' +
          '<button class="btn" onclick="openBatchCreateDialog()" style="font-size:12px;padding:5px 14px">+ 批量</button>' +
          '<button class="btn btn-primary" onclick="openTaskDialog()" style="font-size:12px;padding:5px 14px">+ 新建</button>' +
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

  var html = '<table class="proj-table"><thead><tr>' +
    '<th style="width:12%">项目</th>' +
    '<th style="width:24%;text-align:left">标题</th>' +
    '<th style="width:9%">阶段</th>' +
    '<th style="width:6%">状态</th>' +
    '<th style="width:5%">优先级</th>' +
    '<th style="width:7%">负责人</th>' +
    '<th style="width:6%">预估工时</th>' +
    '<th style="width:7%">实际工时</th>' +
    '<th style="width:6%">进度</th>' +
    '<th style="width:7%">截止日期</th>' +
    '<th>操作</th>' +
    '</tr></thead><tbody>';

  // Flat list — stage grouping moved to board pie chart
  tasks.forEach(function(t) { html += _renderTaskRow(t, stageMap); });

  html += '</tbody></table>';
  content.innerHTML = html;
}

function _renderTaskRow(t, stageMap) {
  var stageName = t.stage_name || '';
  if (!stageName && t.execution_id && stageMap[String(t.execution_id)]) {
    stageName = stageMap[String(t.execution_id)];
  }
  if (!stageName && t.execution_name) {
    stageName = t.execution_name;
  }
  var progressPct = t.progress || 0;
  var overdue = t.due_date && t.status !== 'done' && t.status !== 'closed' && t.due_date < fmtLocalDate();
  var assigneeName = t.assignee_name || t.assignee_username || (t.assignee_id || '-');
  var projCode = t.project_code || '';
  return '<tr class="clickable">' +
    '<td>' + (projCode ? projCodeTag(projCode, t.project_id) : '<span style="font-size:11px;color:var(--muted)">' + escHtml(t.project_name||'') + '</span>') + '</td>' +
    '<td style="text-align:left"><a href="javascript:void(0)" onclick="openTaskViewDialog(' + t.id + ')" style="color:var(--accent)">' + escHtml(t.title) + '</a></td>' +
    '<td>' + (stageName ? '<span style="font-size:11px;color:var(--muted)">' + escHtml(stageName) + '</span>' : '-') + '</td>' +
    '<td>' + renderPill(t.status || 'todo') + '</td>' +
    '<td>' + _renderPriority(t.priority) + '</td>' +
    '<td style="font-size:12px">' + escHtml(assigneeName) + '</td>' +
    '<td>' + (t.estimate_hours || 0).toFixed(1) + 'h</td>' +
    '<td style="font-size:12px">' + (t.consumed_hours || 0).toFixed(1) + 'h</td>' +
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

var _tfProjectId = null; // project ID selected in the task form
var _tfAssigneeId = null; // assignee ID selected in the task form

function _tfStageName() {
  var sel = document.getElementById('tf-execution');
  if (!sel) return null;
  var val = sel.value;
  if (val && val[0] === '_') return val.substring(1); // synthetic key
  return null;
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
  var projHtml = t.project_code ? projCodeTag(t.project_code, t.project_id) + ' ' + escHtml(t.project_name || '') : escHtml(t.project_name || '-');

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
        '<div><span style="' + _lbl + '">负责人</span><div style="' + _val + '">' + escHtml(t.assignee_name || t.assignee_username || '-') + '</div></div>' +
        '<div><span style="' + _lbl + '">截止日期</span><div style="' + _val + ';color:' + (overdue ? 'var(--danger)' : '') + '">' + (t.due_date || '-') + '<span style="font-size:11px;color:' + (overdue ? 'var(--danger)' : 'var(--muted)') + '">' + daysInfo + '</span></div></div>' +
      '</div>' +
    '</div>' +
    // ── 状态与进度 ──
    '<div style="' + _card + '">' +
      '<div style="' + _cardHd + '">状态与进度</div>' +
      '<div style="' + _grid2 + '">' +
        '<div><span style="' + _lbl + '">状态</span><div style="margin-top:3px">' + renderPill(t.status || 'todo') + ' <span style="font-size:11px;color:var(--muted)">' + (labels[t.status] || t.status) + '</span></div></div>' +
        '<div><span style="' + _lbl + '">优先级</span><div style="margin-top:3px">' + _renderPriority(t.priority || 'medium') + '</div></div>' +
        '<div><span style="' + _lbl + '">进度</span><div style="margin-top:2px">' + renderProgressCircle(t.progress || 0, 30, {label:''}) + '</div></div>' +
        '<div><span style="' + _lbl + '">工时</span><div style="' + _val + '">预估 ' + (t.estimate_hours || 0).toFixed(1) + 'h / 实际 ' + (t.consumed_hours || 0).toFixed(1) + 'h</div></div>' +
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
        '<span style="font-size:10px;color:var(--muted)">' + escHtml(c.display_name || c.username) + ' · ' + (c.created_at || '') + '</span>' +
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
  _tfProjectId = _taskProjectId; // default to page context
  _tfAssigneeId = null;

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

  var execOpts = '';
  if (_taskProjectId) {
    execOpts = '<option value="">加载中...</option>';
  }

  var inp = 'width:100%;box-sizing:border-box;margin-top:1px';
  var bodyHtml = '';

  // ── Section 1: 基本信息 ──
  bodyHtml += '<div style="' + _card + '">' +
    '<div style="' + _cardHd + '">基本信息</div>' +
    '<div style="margin-bottom:6px"><label style="' + _lbl + '">所属项目 *</label>' +
      '<div style="margin-top:2px">' + createProjectCombo({
        comboId: 'tf-proj-combo', inputId: 'tf-project-input', dropdownId: 'tf-proj-dropdown',
        selectedIdFn: function() { return _tfProjectId; },
        onSelect: function(p) { _tfProjectId = p.id; _loadTfExecutions(p.id); }
      }) + '</div></div>' +
    '<div style="' + _grid2 + '">' +
      '<div><label style="' + _lbl + '">标题 *</label><input class="search-inp" id="tf-title" value="' + escHtml(t.title || '') + '" style="' + inp + '"></div>' +
      '<div><label style="' + _lbl + '">阶段</label><select class="search-inp" id="tf-execution" style="' + inp + '"><option value="">选择阶段...</option>' + execOpts + '</select></div>' +
      '<div><label style="' + _lbl + '">负责人</label><div style="margin-top:2px">' + createUserCombo({
        comboId: 'tf-assignee-combo', inputId: 'tf-assignee-input', dropdownId: 'tf-assignee-dropdown',
        selectedIdFn: function() { return _tfAssigneeId; },
        onSelect: function(u) { _tfAssigneeId = u.id; }
      }) + '</div></div>' +
      '<div><label style="' + _lbl + '">截止日期</label><input class="search-inp" id="tf-due" type="date" value="' + (t.due_date || '') + '" style="' + inp + '"></div>' +
    '</div>' +
  '</div>';

  // ── Section 2: 状态与进度 ──
  bodyHtml += '<div style="' + _card + '">' +
    '<div style="' + _cardHd + '">状态与进度</div>' +
    '<div style="' + _grid2 + '">' +
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
  '</div>';

  // ── Section 3: 描述 ──
  bodyHtml += '<div style="' + _card + '">' +
    '<div style="' + _cardHd + '">描述</div>' +
    '<textarea class="search-inp" id="tf-desc" rows="3" style="width:100%;box-sizing:border-box;resize:vertical">' + escHtml(t.description || '') + '</textarea>' +
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

  openDialog(title, bodyHtml, buttons, {maxWidth: '60%'});

  // Pre-fill project and assignee
  _tfProjectId = _taskProjectId;
  _tfAssigneeId = t.assignee_id || null;
  setTimeout(function() {
    var tfInput = document.getElementById('tf-project-input');
    if (tfInput && _taskProjectName) tfInput.value = _taskProjectName;
    if (_tfAssigneeId) {
      // Pre-fill assignee name (loaded async by combo)
      loadAllUsers().then(function() {
        var u = _allUsers.find(function(x) { return x.id == _tfAssigneeId; });
        if (u) { var inp = document.getElementById('tf-assignee-input'); if (inp) inp.value = u.name; }
      });
    }
  }, 100);

function _loadTfExecutions(projectId, selectedId) {
  API.get('/projects/' + projectId + '/gantt').then(function(data) {
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

  // Async: load executions for project with task's current stage pre-selected
  if (_taskProjectId) {
    var curExecVal = t.execution_id ? String(t.execution_id) : (t.stage_name ? '_' + t.stage_name : '');
    _loadTfExecutions(_taskProjectId, curExecVal);
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
  var data = {
    title: document.getElementById('tf-title').value.trim(),
    description: document.getElementById('tf-desc').value.trim(),
    status: document.getElementById('tf-status').value,
    priority: document.getElementById('tf-priority').value,
    assignee_id: _tfAssigneeId,
    progress: parseInt(document.getElementById('tf-progress').value) || 0,
    estimate_hours: parseFloat(document.getElementById('tf-estimate').value) || 0,
    due_date: document.getElementById('tf-due').value || null,
    execution_id: parseInt(document.getElementById('tf-execution').value) || null,
    stage_name: _tfStageName(),
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
    '<th>日期</th><th>工时(h)</th><th>描述</th><th>操作</th></tr></thead><tbody>';
  logs.forEach(function(w) {
    html += '<tr>' +
      '<td>' + (w.date || '?') + '</td>' +
      '<td>' + w.hours.toFixed(1) + '</td>' +
      '<td style="text-align:left;white-space:normal;word-break:break-word">' + escHtml(w.description || '') + '</td>' +
      '<td>' + iconEdit('openWorklogEditDialog(' + w.id + ',' + taskId + ')', '编辑') +
        iconDelete('deleteWorklogById(' + w.id + ',' + taskId + ')', '删除') + '</td>' +
    '</tr>';
  });
  return html + '</tbody></table></div>';
}

function openWorklogDialog(taskId) {
  // Load current progress
  API.get('/tasks/'+taskId).then(function(task) {
    var today = fmtLocalDate();
    var html = '<div>' +
      '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">日期 *</label>' +
        '<input class="search-inp" id="wl-date" type="date" required value="'+today+'" style="width:100%;box-sizing:border-box;margin-top:2px"></div>' +
      '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">工时(h) *</label>' +
        '<input class="search-inp" id="wl-hours" type="number" step="0.5" min="0.5" required value="1" style="width:100%;box-sizing:border-box;margin-top:2px"></div>' +
      '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">进度(%) * 当前: '+(task.progress||0)+'%</label>' +
        '<input class="search-inp" id="wl-progress" type="number" min="0" max="100" step="5" required value="'+(task.progress||0)+'" style="width:100%;box-sizing:border-box;margin-top:2px"></div>' +
      '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">工作描述 *</label>' +
        '<textarea class="search-inp" id="wl-desc" rows="2" required style="width:100%;box-sizing:border-box;margin-top:2px;resize:vertical"></textarea></div>' +
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
    var html = '<div>' +
      '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">日期 *</label>' +
        '<input class="search-inp" id="wl-date" type="date" required value="'+(w.date||'')+'" style="width:100%;box-sizing:border-box;margin-top:2px"></div>' +
      '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">工时(h) *</label>' +
        '<input class="search-inp" id="wl-hours" type="number" step="0.5" min="0.5" required value="'+w.hours+'" style="width:100%;box-sizing:border-box;margin-top:2px"></div>' +
      '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">进度(%) * 当前: '+(task.progress||0)+'%</label>' +
        '<input class="search-inp" id="wl-progress" type="number" min="0" max="100" step="5" required value="'+(task.progress||0)+'" style="width:100%;box-sizing:border-box;margin-top:2px"></div>' +
      '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">工作描述 *</label>' +
        '<textarea class="search-inp" id="wl-desc" rows="2" required style="width:100%;box-sizing:border-box;margin-top:2px;resize:vertical">'+escHtml(w.description||'')+'</textarea></div>' +
    '</div>';
    openDialog('编辑工时', html, [
      {text:'取消',onclick:'_closeTaskDialog()'},
      {text:'保存',cls:'btn-primary',onclick:'_submitWorklogEdit('+wlId+','+taskId+')'}
    ], {maxWidth:450});
  }).catch(function(e){showToast('加载失败: '+(e.message||''),'error');});
}

async function submitWorklog(taskId) {
  var hours = parseFloat(document.getElementById('wl-hours').value);
  var progress = parseInt(document.getElementById('wl-progress').value);
  var desc = document.getElementById('wl-desc').value.trim();
  var date = document.getElementById('wl-date').value;
  if (!date) { showToast('请选择日期', 'error'); return; }
  if (!hours || hours <= 0) { showToast('请输入有效的工时数', 'error'); return; }
  if (isNaN(progress) || progress < 0 || progress > 100) { showToast('请输入有效的进度(0-100)', 'error'); return; }
  if (!desc) { showToast('请填写工作描述', 'error'); return; }
  try {
    await API.post('/worklogs', {task_id:taskId, hours:hours, date:date, description:desc});
    await API.put('/tasks/'+taskId, {progress:progress});
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
  if (!date) { showToast('请选择日期', 'error'); return; }
  if (!hours || hours <= 0) { showToast('请输入有效的工时数', 'error'); return; }
  if (isNaN(progress) || progress < 0 || progress > 100) { showToast('请输入有效的进度(0-100)', 'error'); return; }
  if (!desc) { showToast('请填写工作描述', 'error'); return; }
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
        '<div style="font-size:10px;color:var(--muted);margin-bottom:2px">' + escHtml(c.display_name || c.username) + ' · ' + (c.created_at || '') + '</div>' +
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
