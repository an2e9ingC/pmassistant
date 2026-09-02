/* PMA Bug Tracking System */
var _bugFilterProduct = '';

// ── bug:before-save — progress/status bidirectional sync ──
EventBus.on('bug:before-save', function(e) {
  var p = e.progress, s = e.status;
  // progress > 0 on open → auto in_progress
  if (p > 0 && p < 100 && s === 'open') { e.data.status = 'in_progress'; e.status = 'in_progress'; }
  // progress >= 100 on non-resolved/closed → auto resolved
  if (p >= 100 && s !== 'resolved' && s !== 'closed') { e.data.status = 'resolved'; e.status = 'resolved'; }
  // resolved + progress drops below 100 → back to in_progress
  if (s === 'resolved' && p < 100) { e.data.status = 'in_progress'; e.status = 'in_progress'; }
  // (removed: open + progress > 0 no longer resets progress — line 8 above already auto-transitions to in_progress)
});
var _bugFilterStatus = '';
var _bugFilterSearch = '';
var _bugFilterProject = '';
var _bugFilterSeverity = '';
var _bugFilterPriority = '';
var _bugFilterType = '';
var _bugFilterAssignee = '';   // '' | 'me' | numeric user id
var _bugFilterReporter = '';
var _bugFilterDateFrom = '';
var _bugFilterDateTo = '';
var _bugRecent30d = false;     // KPI「近30天新增」卡激活态
var _bugSearchTimer = null;
var _bugViewMode = 'list';     // list | kanban | report
var _bfProjId = null;
var _selectedBugs = new Set();
var _currentBugs = [];
var _bugUserOptions = [];      // cache /users/options for quick-assign/status
var _bugReportF = { product:'', project:'', status:'', severity:'', created_from:'', created_to:'' };  // 报表 tab 独立筛选

/* ── Init & Render ── */

function initBugs(firstArg) {
  // Route to detail/edit if first arg is a numeric bug ID
  var bugId = parseInt(firstArg);
  if (!isNaN(bugId) && bugId > 0) {
    var isEdit = arguments[1] === 'edit';
    if (isEdit) { initBugEdit(bugId); } else { initBugDetail(bugId); }
    return;
  }
  var c = document.getElementById('view-bugs');
  if (!c) return;
  _bugFilterSearch = '';
  _bugViewMode = 'list';
  _selectedBugs = new Set();
  c.innerHTML = '<div style="display:flex;height:100%">' +
    '<div style="width:270px;flex-shrink:0;padding:16px;border-right:1px solid var(--border);overflow-y:auto" id="bug-sidebar"></div>' +
    '<div style="flex:1;display:flex;flex-direction:column;min-width:0">' +
      '<div class="section-hd" style="padding:12px 16px;border-bottom:1px solid var(--border);flex-wrap:wrap;gap:10px">' +
        '<span style="font-weight:600;font-size:15px">Bug 管理</span>' +
        '<span class="tabs">' +
          '<span class="tab active" id="bug-view-list" onclick="switchBugView(\'list\')">列表</span>' +
          '<span class="tab" id="bug-view-kanban" onclick="switchBugView(\'kanban\')">看板</span>' +
          '<span class="tab" id="bug-view-report" onclick="switchBugView(\'report\')">报表</span>' +
        '</span>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-left:auto">' +
          '<button class="btn" style="font-size:11px;padding:3px 10px;color:var(--success);border-color:var(--success)" onclick="exportBugsCsv()" title="导出当前筛选结果为CSV">导出CSV</button>' +
        '</div>' +
      '</div>' +
      '<div id="bug-content" style="flex:1;overflow:auto;padding:16px">加载中...</div>' +
    '</div>' +
  '</div>';
  if (!_bugUserOptions.length) {
    API.get('/users/options').catch(function() { return []; }).then(function(u) { _bugUserOptions = u || []; });
  }
  _renderBugSidebar();
  loadBugs();
}

function switchBugView(mode) {
  _bugViewMode = mode;
  if (mode === 'kanban') _bugDt = null;
  ['list','kanban','report'].forEach(function(m) {
    var tab = document.getElementById('bug-view-' + m);
    if (tab) tab.classList.toggle('active', m === mode);
  });
  // 报表 tab 使用独立筛选，隐藏列表侧边栏
  var sb = document.getElementById('bug-sidebar');
  if (sb) sb.style.display = (mode === 'report') ? 'none' : '';
  loadBugs();
}

/* ── Sidebar Filters ── */

function _bugSelOption(selId, onChange, opts, current) {
  var html = '<select class="search-inp" id="' + selId + '" onchange="' + onChange + '" style="width:100%;margin-bottom:12px">' +
    '<option value="">全部</option>';
  opts.forEach(function(o) {
    var sel = String(o.v) === String(current || '') ? ' selected' : '';
    html += '<option value="' + o.v + '"' + sel + '>' + escHtml(o.l) + '</option>';
  });
  return html + '</select>';
}

async function _renderBugSidebar() {
  var el = document.getElementById('bug-sidebar');
  if (!el) return;
  var html = '';
  // 关键字
  html += '<div style="font-size:11px;color:var(--muted);margin-bottom:4px">关键字</div>' +
    '<div class="search-wrap" style="margin-bottom:12px">' +
    '<svg class="search-ico" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="6.5" cy="6.5" r="5"/><line x1="10.5" y1="10.5" x2="14" y2="14"/></svg>' +
    '<input class="search-inp" id="bug-search" placeholder="标题 / 编号..." value="' + escHtml(_bugFilterSearch) + '" oninput="_onBugSearchInput()" style="width:100%">' +
    '<button class="search-clear" onclick="clearSearch(\'bug-search\',_onBugSearchInput)" title="清除">&times;</button>' +
    '</div>';

  // 产品
  html += '<div style="font-size:11px;color:var(--muted);margin-bottom:4px">产品</div>' +
    '<select class="search-inp" id="bug-filter-prod" onchange="_bugFilterProduct=this.value;loadBugs()" style="width:100%;margin-bottom:12px">' +
    '<option value="">全部产品</option></select>';

  // 项目
  html += '<div style="font-size:11px;color:var(--muted);margin-bottom:4px">项目</div>' +
    '<select class="search-inp" id="bug-filter-proj" onchange="_bugFilterProject=this.value;loadBugs()" style="width:100%;margin-bottom:12px">' +
    '<option value="">全部项目</option></select>';

  // 严重度
  html += '<div style="font-size:11px;color:var(--muted);margin-bottom:4px">严重度</div>' +
    _bugSelOption('bug-filter-sev', '_bugFilterSeverity=this.value;loadBugs()',
      [{v:'1',l:'1-致命'},{v:'2',l:'2-严重'},{v:'3',l:'3-一般'},{v:'4',l:'4-建议'}], _bugFilterSeverity);

  // 优先级
  html += '<div style="font-size:11px;color:var(--muted);margin-bottom:4px">优先级</div>' +
    _bugSelOption('bug-filter-prio', '_bugFilterPriority=this.value;loadBugs()',
      [{v:'low',l:'低'},{v:'medium',l:'中'},{v:'high',l:'高'},{v:'critical',l:'紧急'}], _bugFilterPriority);

  // 类型
  html += '<div style="font-size:11px;color:var(--muted);margin-bottom:4px">类型</div>' +
    _bugSelOption('bug-filter-type', '_bugFilterType=this.value;loadBugs()',
      [{v:'codeerror',l:'代码错误'},{v:'design',l:'设计缺陷'},{v:'security',l:'安全问题'},{v:'performance',l:'性能问题'},{v:'compatibility',l:'兼容性'},{v:'standard',l:'规范'},{v:'repair',l:'维修'},{v:'other',l:'其他'}], _bugFilterType);

  // 负责人
  html += '<div style="font-size:11px;color:var(--muted);margin-bottom:4px">负责人</div>' +
    '<select class="search-inp" id="bug-filter-assignee" onchange="_bugFilterAssignee=this.value;loadBugs()" style="width:100%;margin-bottom:12px">' +
    '<option value="">全部</option></select>';

  // 创建人
  html += '<div style="font-size:11px;color:var(--muted);margin-bottom:4px">创建人</div>' +
    '<select class="search-inp" id="bug-filter-reporter" onchange="_bugFilterReporter=this.value;loadBugs()" style="width:100%;margin-bottom:12px">' +
    '<option value="">全部</option></select>';

  // 日期范围
  html += '<div style="font-size:11px;color:var(--muted);margin-bottom:4px">创建日期</div>' +
    '<div style="display:flex;gap:6px;margin-bottom:12px">' +
    '<input class="search-inp" type="date" id="bug-filter-dfrom" value="' + _bugFilterDateFrom + '" onchange="_bugFilterDateFrom=this.value;_bugRecent30d=false;loadBugs()" style="width:50%;font-size:11px">' +
    '<input class="search-inp" type="date" id="bug-filter-dto" value="' + _bugFilterDateTo + '" onchange="_bugFilterDateTo=this.value;_bugRecent30d=false;loadBugs()" style="width:50%;font-size:11px">' +
    '</div>';

  el.innerHTML = html;

  // 填充产品下拉
  try {
    var prods = await API.get('/products?limit=200');
    var items = (prods && prods.items) ? prods.items : (prods || []);
    var sel = document.getElementById('bug-filter-prod');
    items.forEach(function(p) { sel.insertAdjacentHTML('beforeend', '<option value="' + p.id + '">' + escHtml(p.code || p.name) + '</option>'); });
    if (_bugFilterProduct) sel.value = _bugFilterProduct;
  } catch(e) { /* ignore */ }
  // 填充项目下拉
  try {
    var projs = await API.get('/users/project-options');
    var psel = document.getElementById('bug-filter-proj');
    (projs || []).forEach(function(p) { psel.insertAdjacentHTML('beforeend', '<option value="' + p.id + '">' + escHtml(p.code || p.name) + '</option>'); });
    if (_bugFilterProject) psel.value = _bugFilterProject;
  } catch(e) { /* ignore */ }
  // 填充用户下拉（负责人/创建人）
  try {
    if (!_bugUserOptions.length) _bugUserOptions = (await API.get('/users/options')) || [];
    var asel = document.getElementById('bug-filter-assignee');
    _bugUserOptions.forEach(function(u) { asel.insertAdjacentHTML('beforeend', '<option value="' + u.id + '">' + escHtml(u.name || u.code) + '</option>'); });
    if (_bugFilterAssignee && _bugFilterAssignee !== 'me') asel.value = _bugFilterAssignee;
    var rsel = document.getElementById('bug-filter-reporter');
    _bugUserOptions.forEach(function(u) { rsel.insertAdjacentHTML('beforeend', '<option value="' + u.id + '">' + escHtml(u.name || u.code) + '</option>'); });
    if (_bugFilterReporter) rsel.value = _bugFilterReporter;
  } catch(e) { /* ignore */ }
}

/* ── Load & Render Bugs ── */

function _onBugSearchInput() {
  clearTimeout(_bugSearchTimer);
  _bugSearchTimer = setTimeout(function() {
    var el = document.getElementById('bug-search');
    _bugFilterSearch = (el ? el.value : '').trim();
    loadBugs();
  }, 300);
}

function _bugEnsureUserOptions() {
  if (_bugUserOptions.length) return Promise.resolve(_bugUserOptions);
  return API.get('/users/options').catch(function() { return []; }).then(function(u) {
    _bugUserOptions = u || [];
    return _bugUserOptions;
  });
}

function _bugQueryParams() {
  var p = {};
  if (_bugFilterSearch) p.search = _bugFilterSearch;
  if (_bugFilterProduct) p.product_id = _bugFilterProduct;
  if (_bugFilterProject) p.project_id = _bugFilterProject;
  if (_bugFilterStatus) p.status = _bugFilterStatus;
  if (_bugFilterSeverity) p.severity = _bugFilterSeverity;
  if (_bugFilterPriority) p.priority = _bugFilterPriority;
  if (_bugFilterType) p.type = _bugFilterType;
  if (_bugFilterAssignee) p.assignee_id = _bugFilterAssignee;
  if (_bugFilterReporter) p.reporter_id = _bugFilterReporter;
  if (_bugFilterDateFrom) p.created_from = _bugFilterDateFrom;
  if (_bugFilterDateTo) p.created_to = _bugFilterDateTo;
  return p;
}

function _bugReportQueryParams() {
  var p = {};
  if (_bugReportF.product) p.product_id = _bugReportF.product;
  if (_bugReportF.project) p.project_id = _bugReportF.project;
  if (_bugReportF.status) p.status = _bugReportF.status;
  if (_bugReportF.severity) p.severity = _bugReportF.severity;
  if (_bugReportF.created_from) p.created_from = _bugReportF.created_from;
  if (_bugReportF.created_to) p.created_to = _bugReportF.created_to;
  return p;
}

function _bugFilterByStatus(status) {
  if (_bugFilterStatus === status) return;  // dashboard style: clicking same card = no-op
  _bugFilterStatus = status;
  loadBugs();
}

function _bugSetRecent30d(on) {
  if (_bugRecent30d === !!on) return;  // no-op when state unchanged
  _bugRecent30d = !!on;
  if (on) {
    var d = new Date();
    d.setDate(d.getDate() - 30);
    _bugFilterDateFrom = fmtLocalDate(d);
    _bugFilterDateTo = '';
  } else {
    _bugFilterDateFrom = '';
    _bugFilterDateTo = '';
  }
  var dFrom = document.getElementById('bug-filter-dfrom');
  if (dFrom) dFrom.value = _bugFilterDateFrom;
  var dTo = document.getElementById('bug-filter-dto');
  if (dTo) dTo.value = _bugFilterDateTo;
  loadBugs();
}

function _bugFilterAll() {
  if (_bugFilterStatus === '' && !_bugRecent30d) return;  // already all
  _bugFilterStatus = '';
  _bugSetRecent30d(false);
  loadBugs();
}

var _bugStatusLt = {open:'var(--warn-lt)', confirmed:'var(--accent-lt)', in_progress:'var(--accent-lt)', gitlab_submitted:'var(--purple-lt)', resolved:'var(--success-lt)', closed:'var(--surface2)'};

function _bugKpiCard(label, count, color, ltColor, active, onclickStr) {
  var style = 'padding:10px 14px;cursor:pointer;border-left:4px solid ' + color + ';';
  if (active) style += 'border-color:' + color + ';background:' + (ltColor || 'var(--surface2)') + ';box-shadow:var(--sh-md);transform:scale(1.02);';
  return '<div class="kpi-card" style="' + style + '" onclick="' + onclickStr + '" title="点击过滤该状态">' +
    '<div class="kpi-label">' + label + '</div>' +
    '<div class="kpi-value" style="font-size:22px;color:' + color + '">' + count + '</div>' +
  '</div>';
}

function _renderBugKpiBar(el, stats) {
  if (!el) return;
  if (!stats) { el.innerHTML = ''; return; }
  var statusLabels = {open:'待确认', confirmed:'已确认', in_progress:'处理中', gitlab_submitted:'GitLab已提交', resolved:'已解决', closed:'已关闭'};
  var statusColors = {open:'var(--warn)', confirmed:'var(--accent)', in_progress:'var(--accent)', gitlab_submitted:'var(--purple)', resolved:'var(--success)', closed:'var(--muted)'};
  var statusKeys = ['open','confirmed','in_progress','gitlab_submitted','resolved','closed'];
  var sevLabels = {1:'致命',2:'严重',3:'一般',4:'建议'};
  var sevColors = {1:'var(--danger)',2:'var(--warn)',3:'var(--accent)',4:'var(--muted)'};

  var cards = _bugKpiCard('全部', stats.total, 'var(--fg)', 'var(--surface2)', _bugFilterStatus === '' && !_bugRecent30d, '_bugFilterAll()');
  statusKeys.forEach(function(k) {
    var cnt = (stats.by_status && stats.by_status[k]) || 0;
    var active = _bugFilterStatus === k;
    cards += _bugKpiCard(statusLabels[k], cnt, statusColors[k], _bugStatusLt[k], active, "_bugFilterByStatus('" + k + "')");
  });
  cards += _bugKpiCard('近30天新增', stats.recent_30d, 'var(--success)', 'var(--success-lt)', _bugRecent30d, '_bugSetRecent30d(!_bugRecent30d)');

  var sevCards = Object.keys(stats.by_severity || {}).map(function(k) {
    var c = sevColors[k] || 'var(--fg)';
    return '<div class="kpi-card" style="padding:8px 12px;cursor:default"><div class="kpi-label">S' + k + ' ' + (sevLabels[k] || k) + '</div><div class="kpi-value" style="font-size:18px;color:' + c + '">' + stats.by_severity[k] + '</div></div>';
  }).join('');
  var sevCount = Object.keys(stats.by_severity || {}).length;

  el.innerHTML =
    '<div class="kpi-grid" style="grid-template-columns:repeat(8,1fr);margin-bottom:8px">' + cards + '</div>' +
    (sevCount ? '<div class="kpi-grid" style="grid-template-columns:repeat(' + sevCount + ',1fr)">' + sevCards + '</div>' : '');
}

async function loadBugs() {
  var el = document.getElementById('bug-content');
  if (!el) return;
  if (_bugViewMode === 'report') { _renderBugReport(); return; }
  el.innerHTML = '<div class="loading-spinner">加载中...</div>';
  try {
    var params = _bugQueryParams();
    var qs = new URLSearchParams(params).toString();
    // KPI 卡片之间互不影响：统计不携带状态过滤（状态卡只过滤列表，不改动其他卡的数值）
    var statsParams = _bugQueryParams();
    delete statsParams.status;
    var statsQs = new URLSearchParams(statsParams).toString();
    await _bugEnsureUserOptions();
    var bugs = await API.get('/bugs' + (qs ? '?' + qs : ''));
    _currentBugs = bugs || [];
    el.innerHTML = '<div id="bug-kpi-bar" style="margin-bottom:14px"></div>' +
      '<div id="bug-list-wrap"></div>';
    var listWrap = document.getElementById('bug-list-wrap');
    API.get('/bugs/stats' + (statsQs ? '?' + statsQs : '')).then(function(stats) {
      _renderBugKpiBar(document.getElementById('bug-kpi-bar'), stats);
    }).catch(function() {});
    if (_bugViewMode === 'kanban') _renderKanban(listWrap, _currentBugs);
    else _renderBugTable(listWrap, _currentBugs);
  } catch(e) {
    el.innerHTML = '<div class="error-state">加载失败: ' + escHtml(e.message) + '</div>';
  }
}

var _bugDt = null;

var _bugStatusOpts = [
  {v:'open',l:'待确认'},{v:'confirmed',l:'已确认'},{v:'in_progress',l:'处理中'},
  {v:'gitlab_submitted',l:'GitLab已提交'},{v:'resolved',l:'已解决'},{v:'closed',l:'已关闭'}
];
var _bugTypeLabels = {codeerror:'代码错误',design:'设计缺陷',security:'安全问题',performance:'性能问题',compatibility:'兼容性',standard:'规范',repair:'维修',other:'其他'};

function _renderBugTable(container, bugs) {
  if (!bugs.length) { container.innerHTML = '<div class="empty-state">暂无Bug</div>'; _bugDt = null; return; }
  var sevs = {1:'致命',2:'严重',3:'一般',4:'建议'};
  container.innerHTML = '<div id="bug-table"></div>';
  _bugDt = new DataTable({
    container: document.getElementById('bug-table'),
    selectable: _hasBugEditPerm(),
    checkboxPosition: 0,
    onSelectChange: function(rows) {
      _selectedBugs = new Set((rows || []).map(function(r) { return r.id; }));
      _ensureBugBatchToolbar();
      _updateBugBatchToolbar();
    },
    clickable: true,
    onRowClick: function(row) { openBugDetail(row.id); },
    columns: [
      { key: 'fav', title: '', width: '24px', minWidth: 24, className: 'dt-fav-cell', render: function(v, row) { return favStar('bug', row.id, {stopPropagation: true}); } },
      { key: 'id', title: '编号', width: '6%', minWidth: 70, sortable: true, render: function(v) { return '<span style="font-family:var(--mono);font-size:11px">#' + v + '</span>'; } },
      { key: 'title', title: '标题', align: 'left', minWidth: 130, sortable: true, render: function(v) { return '<span style="font-weight:530">'+escHtml(v||'')+'</span>'; } },
      { key: 'product_code', title: '产品', width: '8%', minWidth: 90, sortable: true, render: function(v, row) { return v ? projCodeTag(v, 'openProductDetail(\'' + escHtml(v).replace(/'/g, "\\'") + '\')', row.product_name) : '<span style="font-size:12px;color:var(--muted)">-</span>'; } },
      { key: 'project_code', title: '项目', width: '7%', minWidth: 80, sortable: true, render: function(v, row) { return v ? projCodeTag(v, 'openProject(\'' + escHtml(v).replace(/'/g, "\\'") + '\')', row.project_name) : '<span style="font-size:12px;color:var(--muted)">-</span>'; } },
      { key: 'severity', title: '严重', width: '5%', minWidth: 60, sortable: true, render: function(v) { return _renderSev(sevs[v]||'一般', v); } },
      { key: 'priority', title: '优先级', width: '6%', minWidth: 65, sortable: true, render: function(v) { return renderPriorityBadge(v); } },
      { key: 'status', title: '状态', width: '10%', minWidth: 100, sortable: true, render: function(v) { return renderPill(v || 'open'); } },
      { key: 'assignee_name', title: '负责人', width: '60px', minWidth: 60, sortable: true, render: function(v, row) {
          if (!_bugCanEdit(row)) return '<span style="font-size:12px">'+escHtml(v||'-')+'</span>';
          var opts = '<option value="">未分配</option>' + (_bugUserOptions||[]).map(function(u) { return '<option value="'+u.id+'"'+(String(u.id)===String(row.assignee_id||'')?' selected':'')+'>'+escHtml(u.name||u.code)+'</option>'; }).join('');
          return '<span onclick="event.stopPropagation()"><select data-id="'+row.id+'" onchange="_bugQuickAssign('+row.id+', this.value)" style="font-size:11px;padding:1px 4px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--fg);max-width:100px">'+opts+'</select></span>';
        } },
      { key: 'type', title: '类型', width: '7%', minWidth: 70, sortable: true, render: function(v) {
          if (v === 'repair') return '<span class="pill bd-repairing">维修</span>';
          return '<span style="font-size:11px">'+escHtml(_bugTypeLabels[v]||v||'-')+'</span>';
        } },
      { key: 'created_at', title: '创建时间', width: '9%', minWidth: 95, sortable: true, render: function(v) { return '<span style="font-size:11px;color:var(--muted)">'+formatDate(v)+'</span>'; } },
      { key: 'actions', title: '操作', width: actionColWidth(2) + 'px', minWidth: actionColWidth(2), render: function(v, row) {
          var html = '';
          if (_bugCanEdit(row)) html += iconEdit('gotoView(\'bugs\', {params: [String('+row.id+'), \'edit\']})','编辑');
          if (_bugCanEdit(row)) html += _iconTransfer(row.id);
          return '<span style="white-space:nowrap" onclick="event.stopPropagation()">' + html + '</span>';
        } }
    ],
    data: bugs,
    maxHeight: 'calc(100vh - 320px)',
  });
}

function _iconTransfer(bugId) {
  var svg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3l5 5-5 5"/><path d="M22 8H8a4 4 0 0 0-4 4v0"/><path d="M7 21l-5-5 5-5"/><path d="M2 16h14a4 4 0 0 0 4-4v0"/></svg>';
  return iconBtn(svg, '转移项目', 'openBugTransferDialog(' + bugId + ')');
}

async function _bugQuickAssign(bugId, assigneeId) {
  var aid = assigneeId ? parseInt(assigneeId) : null;
  try {
    await API.put('/bugs/' + bugId, {assignee_id: aid});
    showToast('已更新负责人', 'success');
    loadBugs();
  } catch(e) { showToast('更新负责人失败: ' + (e.message || ''), 'error'); }
}

/* ── Batch Operations ── */

function _renderBugBatchToolbar() {
  return '<div id="bug-batch-toolbar" style="display:none;position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:1000;' +
    'background:var(--accent);color:#fff;padding:8px 16px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.2);' +
    'align-items:center;gap:12px">' +
    '<span id="bug-batch-count">已选 0 个Bug</span>' +
    '<button onclick="batchStatusBugs()" style="padding:4px 12px;border:1px solid #fff;border-radius:4px;background:transparent;color:#fff;cursor:pointer;font-size:12px">改状态</button>' +
    '<button onclick="batchAssignBugs()" style="padding:4px 12px;border:1px solid #fff;border-radius:4px;background:transparent;color:#fff;cursor:pointer;font-size:12px">指派</button>' +
    '<button onclick="batchTransferBugs()" style="padding:4px 12px;border:1px solid #fff;border-radius:4px;background:transparent;color:#fff;cursor:pointer;font-size:12px">转移</button>' +
    '<button onclick="batchDeleteBugs()" style="padding:4px 12px;border:1px solid #fff;border-radius:4px;background:transparent;color:#fff;cursor:pointer;font-size:12px">删除</button>' +
    '<button onclick="_clearBugSelection()" style="padding:4px 12px;border:none;border-radius:4px;background:rgba(255,255,255,0.2);color:#fff;cursor:pointer;font-size:12px">取消</button>' +
    '</div>';
}
function _ensureBugBatchToolbar() {
  if (document.getElementById('bug-batch-toolbar')) return;
  document.body.insertAdjacentHTML('beforeend', _renderBugBatchToolbar());
}
function _updateBugBatchToolbar() {
  var bar = document.getElementById('bug-batch-toolbar');
  if (!bar) return;
  if (_selectedBugs.size) { bar.style.display = 'flex'; document.getElementById('bug-batch-count').textContent = '已选 ' + _selectedBugs.size + ' 个Bug'; }
  else bar.style.display = 'none';
}
function _clearBugSelection() {
  _selectedBugs = new Set();
  if (_bugDt) { try { _bugDt.setData(_currentBugs); } catch(e){} }
  _updateBugBatchToolbar();
}

function batchStatusBugs() {
  if (!_selectedBugs.size) { showToast('请先选择Bug', 'error'); return; }
  openDialog('批量改状态',
    '<div class="confirm-dlg">将 <b>' + _selectedBugs.size + '</b> 个Bug的状态改为：<br><br>' +
    '<select class="search-inp" id="batch-status-sel" style="width:100%">' +
      _bugStatusOpts.map(function(o) { return '<option value="'+o.v+'">'+o.l+'</option>'; }).join('') +
    '</select></div>',
    [{text:'取消', onclick:'closeSharedDialog()'},{text:'确定', cls:'btn-primary', onclick:'closeSharedDialog();_doBatchStatus()'}]);
}
async function _doBatchStatus() {
  var status = document.getElementById('batch-status-sel').value;
  try {
    var r = await API.post('/bugs/batch-status', {bug_ids: Array.from(_selectedBugs), status: status});
    showToast('已更新 ' + (r.updated || 0) + ' 个Bug', 'success');
    _clearBugSelection(); loadBugs();
  } catch(e) { showToast('批量改状态失败: ' + (e.message || ''), 'error'); }
}

function batchAssignBugs() {
  if (!_selectedBugs.size) { showToast('请先选择Bug', 'error'); return; }
  openDialog('批量指派',
    '<div class="confirm-dlg">将 <b>' + _selectedBugs.size + '</b> 个Bug指派给：<br><br>' +
    '<select class="search-inp" id="batch-assign-sel" style="width:100%">' +
      '<option value="">未分配</option>' + (_bugUserOptions||[]).map(function(u) { return '<option value="'+u.id+'">'+escHtml(u.name||u.code)+'</option>'; }).join('') +
    '</select></div>',
    [{text:'取消', onclick:'closeSharedDialog()'},{text:'确定', cls:'btn-primary', onclick:'closeSharedDialog();_doBatchAssign()'}]);
}
async function _doBatchAssign() {
  var aid = document.getElementById('batch-assign-sel').value;
  if (!aid) { showToast('请选择负责人', 'error'); return; }
  try {
    var r = await API.post('/bugs/batch-assign', {bug_ids: Array.from(_selectedBugs), assignee_id: parseInt(aid)});
    showToast('已指派 ' + (r.updated || 0) + ' 个Bug', 'success');
    _clearBugSelection(); loadBugs();
  } catch(e) { showToast('批量指派失败: ' + (e.message || ''), 'error'); }
}

async function _loadBugBatchProjectSelect(selId) {
  try {
    var projs = await API.get('/users/project-options');
    var sel = document.getElementById(selId);
    if (sel) (projs || []).forEach(function(p) { sel.insertAdjacentHTML('beforeend', '<option value="' + p.id + '">' + escHtml(p.code || p.name) + '</option>'); });
  } catch(e) { /* ignore */ }
}
function batchTransferBugs() {
  if (!_selectedBugs.size) { showToast('请先选择Bug', 'error'); return; }
  openDialog('批量转移项目',
    '<div class="confirm-dlg">将 <b>' + _selectedBugs.size + '</b> 个Bug转移到项目：<br><br>' +
    '<select class="search-inp" id="batch-transfer-proj" style="width:100%;margin-bottom:8px"><option value="">选择项目...</option></select>' +
    '<select class="search-inp" id="batch-transfer-type" style="width:100%">' +
      '<option value="move">移动（原项目移除）</option><option value="copy">复制（保留原Bug）</option>' +
    '</select></div>',
    [{text:'取消', onclick:'closeSharedDialog()'},{text:'确定', cls:'btn-primary', onclick:'closeSharedDialog();_doBatchTransfer()'}]);
  _loadBugBatchProjectSelect('batch-transfer-proj');
}
async function _doBatchTransfer() {
  var toProj = document.getElementById('batch-transfer-proj').value;
  var type = document.getElementById('batch-transfer-type').value;
  if (!toProj) { showToast('请选择目标项目', 'error'); return; }
  try {
    var r = await API.post('/bugs/batch-transfer', {bug_ids: Array.from(_selectedBugs), to_project_id: parseInt(toProj), transfer_type: type});
    showToast('已处理 ' + (r.processed || 0) + ' 个Bug', 'success');
    _clearBugSelection(); loadBugs();
  } catch(e) { showToast('批量转移失败: ' + (e.message || ''), 'error'); }
}

function batchDeleteBugs() {
  if (!_selectedBugs.size) { showToast('请先选择Bug', 'error'); return; }
  openDialog('批量删除Bug',
    '<div class="confirm-dlg">确认删除 <b>' + _selectedBugs.size + '</b> 个Bug？<br><br><b style="color:var(--danger)">此操作不可撤销。</b></div>',
    [{text:'取消', onclick:'closeSharedDialog()'},
     {text:'确认删除', cls:'btn-danger', onclick:'closeSharedDialog();_doBatchDelete()'}],
    {hideClose: true});
}
async function _doBatchDelete() {
  var ok = await verifyPassword('批量删除 ' + _selectedBugs.size + ' 个Bug', 'skip_bug_delete');
  if (!ok) return;
  try {
    var r = await API.del('/bugs/batch', {bug_ids: Array.from(_selectedBugs)});
    showToast('已删除 ' + (r.deleted || 0) + '/' + _selectedBugs.size + ' 个Bug', 'success');
    _clearBugSelection(); loadBugs();
  } catch(e) { showToast('批量删除失败: ' + (e.message || ''), 'error'); }
}

/* ── Transfer Dialog (single) ── */

function openBugTransferDialog(bugId) {
  openDialog('转移Bug #' + bugId,
    '<div class="confirm-dlg">将 Bug #' + bugId + ' 转移到项目：<br><br>' +
    '<select class="search-inp" id="bug-transfer-proj" style="width:100%;margin-bottom:8px"><option value="">选择项目...</option></select>' +
    '<select class="search-inp" id="bug-transfer-type" style="width:100%">' +
      '<option value="move">移动（原项目移除）</option><option value="copy">复制（保留原Bug）</option>' +
    '</select></div>',
    [{text:'取消', onclick:'closeSharedDialog()'},{text:'确定', cls:'btn-primary', onclick:'closeSharedDialog();_doBugTransfer(' + bugId + ')'}]);
  _loadBugBatchProjectSelect('bug-transfer-proj');
}
async function _doBugTransfer(bugId) {
  var toProj = document.getElementById('bug-transfer-proj').value;
  var type = document.getElementById('bug-transfer-type').value;
  if (!toProj) { showToast('请选择目标项目', 'error'); return; }
  try {
    await API.post('/bugs/' + bugId + '/transfer', {to_project_id: parseInt(toProj), transfer_type: type});
    showToast('转移成功', 'success');
    loadBugs();
  } catch(e) { showToast('转移失败: ' + (e.message || ''), 'error'); }
}

/* ── Zentao Import Dialog ── */

function openZentaoImportDialog() {
  openDialog('从禅道导入Bug',
    '<div class="confirm-dlg">选择产品，然后勾选要导入的禅道Bug（已导入的会自动跳过）：<br><br>' +
    '<select class="search-inp" id="zentao-import-prod" style="width:100%;margin-bottom:8px" onchange="_zentaoLoadCandidates()">' +
      '<option value="">加载产品...</option></select>' +
    '<div class="search-wrap" style="margin-bottom:8px">' +
      '<input class="search-inp" id="zentao-import-search" placeholder="搜索标题..." oninput="_zentaoDebouncedLoad()" style="width:100%">' +
    '</div>' +
    '<div id="zentao-import-cands" style="max-height:300px;overflow-y:auto;font-size:12px">请先选择产品</div></div>',
    [{text:'取消', onclick:'closeSharedDialog()'},{text:'导入选中', cls:'btn-primary', onclick:'_doZentaoImport()'}],
    {hideClose: true});
  API.get('/products?limit=200').then(function(prods) {
    var items = (prods && prods.items) ? prods.items : (prods || []);
    var sel = document.getElementById('zentao-import-prod');
    sel.innerHTML = '<option value="">选择产品...</option>';
    items.forEach(function(p) { sel.insertAdjacentHTML('beforeend', '<option value="' + p.id + '">' + escHtml(p.code || p.name) + '</option>'); });
  }).catch(function() {});
}
var _zentaoImportTimer = null;
function _zentaoDebouncedLoad() {
  clearTimeout(_zentaoImportTimer);
  _zentaoImportTimer = setTimeout(_zentaoLoadCandidates, 300);
}
async function _zentaoLoadCandidates() {
  var prodId = document.getElementById('zentao-import-prod').value;
  var search = document.getElementById('zentao-import-search').value.trim();
  var box = document.getElementById('zentao-import-cands');
  if (!prodId) { box.innerHTML = '请先选择产品'; return; }
  box.innerHTML = '<div class="loading-spinner">加载候选...</div>';
  try {
    var items = await API.get('/bugs/zentao-candidates?product_id=' + prodId + (search ? '&search=' + encodeURIComponent(search) : ''));
    if (!items || !items.length) { box.innerHTML = '<div class="empty-state">没有可导入的禅道Bug</div>'; return; }
    var sevLabels = {1:'致命',2:'严重',3:'一般',4:'建议'};
    box.innerHTML = items.map(function(b) {
      return '<label style="display:flex;gap:8px;align-items:center;padding:6px 4px;border-bottom:1px solid var(--border);cursor:pointer">' +
        '<input type="checkbox" class="zentao-cand-cb" value="' + b.id + '">' +
        '<span style="font-family:var(--mono);font-size:10px">#' + b.id + '</span>' +
        '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHtml(b.title) + '</span>' +
        '<span style="font-size:10px;color:var(--muted)">S' + (b.severity || '-') + ' ' + (sevLabels[b.severity] || '') + '</span>' +
        '<span style="font-size:10px;color:var(--muted)">' + (b.status || '') + '</span>' +
      '</label>';
    }).join('');
  } catch(e) { box.innerHTML = '<div class="error-state">加载失败: ' + escHtml(e.message) + '</div>'; }
}
async function _doZentaoImport() {
  var prodId = document.getElementById('zentao-import-prod').value;
  if (!prodId) { showToast('请先选择产品', 'error'); return; }
  var ids = Array.prototype.slice.call(document.querySelectorAll('.zentao-cand-cb:checked')).map(function(c) { return parseInt(c.value); });
  if (!ids.length) { showToast('请勾选要导入的Bug', 'error'); return; }
  try {
    var r = await API.post('/bugs/import-batch', {zentao_bug_ids: ids, product_id: parseInt(prodId)});
    showToast('导入完成: 新增 ' + (r.imported || 0) + '，跳过 ' + (r.skipped || 0), 'success');
    closeSharedDialog();
    loadBugs();
  } catch(e) { showToast('导入失败: ' + (e.message || ''), 'error'); }
}

/* ── CSV Export ── */

function exportBugsCsv() {
  var bugs = _currentBugs || [];
  if (!bugs.length) { showToast('没有可导出的数据', 'error'); return; }
  var sevLabels = {1:'致命',2:'严重',3:'一般',4:'建议'};
  var rows = [['编号','标题','产品','项目','严重度','优先级','状态','类型','负责人','创建时间','描述']];
  bugs.forEach(function(b) {
    rows.push([
      b.id, b.title, b.product_name || '', b.project_name || '',
      sevLabels[b.severity] || b.severity, b.priority, b.status || '', _bugTypeLabels[b.type] || b.type || '',
      b.assignee_name || '', b.created_at || '', (b.description || '').replace(/[\r\n]+/g, ' ')
    ]);
  });
  var csv = rows.map(function(r) {
    return r.map(function(c) {
      var s = String(c == null ? '' : c);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',');
  }).join('\n');
  var blob = new Blob(['﻿' + csv], {type: 'text/csv;charset=utf-8'});
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'bugs-' + fmtLocalDate().replace(/-/g, '') + '.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
  showToast('已导出 ' + bugs.length + ' 条Bug', 'success');
}

/* ── Report Tab ── */

async function _renderBugReport() {
  var el = document.getElementById('bug-content');
  if (!el) return;
  el.innerHTML =
    '<div class="card" id="bug-report-filters" style="padding:12px 16px;margin-bottom:14px;display:flex;gap:8px;flex-wrap:wrap;align-items:center"></div>' +
    '<div id="bug-report-body"><div class="loading-spinner">加载报表...</div></div>';
  await _renderBugReportFilterBar();
  _loadBugReport();
}

function _bugReportSel(selId, label, changeExpr) {
  return '<label style="font-size:11px;color:var(--muted);display:flex;align-items:center;gap:4px">' + label +
    '<select class="search-inp" id="' + selId + '" onchange="' + changeExpr + '" style="width:110px;font-size:11px;padding:2px 6px"><option value="">全部</option></select></label>';
}

async function _renderBugReportFilterBar() {
  var bar = document.getElementById('bug-report-filters');
  if (!bar) return;
  bar.innerHTML =
    '<span style="font-size:12px;font-weight:600;color:var(--muted)">报表筛选</span>' +
    _bugReportSel('rptf-prod', '产品', '_bugReportF.product=this.value;_loadBugReport()') +
    _bugReportSel('rptf-proj', '项目', '_bugReportF.project=this.value;_loadBugReport()') +
    _bugReportSel('rptf-status', '状态', '_bugReportF.status=this.value;_loadBugReport()') +
    _bugReportSel('rptf-sev', '严重度', '_bugReportF.severity=this.value;_loadBugReport()') +
    '<label style="font-size:11px;color:var(--muted);display:flex;align-items:center;gap:4px">日期' +
      '<input class="search-inp" type="date" id="rptf-dfrom" value="' + _bugReportF.created_from + '" onchange="_bugReportF.created_from=this.value;_loadBugReport()" style="width:120px;font-size:11px;padding:2px 6px">' +
      '<span>~</span>' +
      '<input class="search-inp" type="date" id="rptf-dto" value="' + _bugReportF.created_to + '" onchange="_bugReportF.created_to=this.value;_loadBugReport()" style="width:120px;font-size:11px;padding:2px 6px">' +
    '</label>';

  try {
    var prods = await API.get('/products?limit=200');
    var items = (prods && prods.items) ? prods.items : (prods || []);
    var ps = document.getElementById('rptf-prod');
    items.forEach(function(p) { ps.insertAdjacentHTML('beforeend', '<option value="' + p.id + '">' + escHtml(p.code || p.name) + '</option>'); });
    if (_bugReportF.product) ps.value = _bugReportF.product;
  } catch(e) { /* ignore */ }
  try {
    var projs = await API.get('/users/project-options');
    var pj = document.getElementById('rptf-proj');
    (projs || []).forEach(function(p) { pj.insertAdjacentHTML('beforeend', '<option value="' + p.id + '">' + escHtml(p.code || p.name) + '</option>'); });
    if (_bugReportF.project) pj.value = _bugReportF.project;
  } catch(e) { /* ignore */ }
  try {
    var st = document.getElementById('rptf-status');
    _bugStatusOpts.forEach(function(o) { st.insertAdjacentHTML('beforeend', '<option value="' + o.v + '">' + o.l + '</option>'); });
    if (_bugReportF.status) st.value = _bugReportF.status;
    var se = document.getElementById('rptf-sev');
    [{v:'1',l:'1-致命'},{v:'2',l:'2-严重'},{v:'3',l:'3-一般'},{v:'4',l:'4-建议'}].forEach(function(o) { se.insertAdjacentHTML('beforeend', '<option value="' + o.v + '">' + o.l + '</option>'); });
    if (_bugReportF.severity) se.value = _bugReportF.severity;
  } catch(e) { /* ignore */ }
}

async function _loadBugReport() {
  var body = document.getElementById('bug-report-body');
  if (!body) return;
  body.innerHTML = '<div class="loading-spinner">加载报表...</div>';
  try {
    var qs = new URLSearchParams(_bugReportQueryParams()).toString();
    var stats = await API.get('/bugs/stats' + (qs ? '?' + qs : ''));
    var sevLabels = {1:'致命',2:'严重',3:'一般',4:'建议'};
    var sevColors = {1:'var(--danger)',2:'var(--warn)',3:'var(--accent)',4:'var(--muted)'};
    var statusLabels = {open:'待确认',confirmed:'已确认',in_progress:'处理中',gitlab_submitted:'GitLab已提交',resolved:'已解决',closed:'已关闭'};
    var prioLabels = {low:'低',medium:'中',high:'高',critical:'紧急'};

    // KPI
    var kpi = '<div class="kpi-grid" style="grid-template-columns:repeat(5,1fr);margin-bottom:16px">' +
      '<div class="kpi-card"><div class="kpi-label">Bug总数</div><div class="kpi-value" style="font-size:26px">' + stats.total + '</div></div>' +
      '<div class="kpi-card"><div class="kpi-label">未解决</div><div class="kpi-value" style="font-size:26px;color:var(--danger)">' + stats.open + '</div></div>' +
      '<div class="kpi-card"><div class="kpi-label">已解决</div><div class="kpi-value" style="font-size:26px;color:var(--accent)">' + stats.resolved + '</div></div>' +
      '<div class="kpi-card"><div class="kpi-label">已关闭</div><div class="kpi-value" style="font-size:26px;color:var(--muted)">' + stats.closed + '</div></div>' +
      '<div class="kpi-card"><div class="kpi-label">近30天新增</div><div class="kpi-value" style="font-size:26px;color:var(--warn)">' + stats.recent_30d + '</div></div>' +
    '</div>';

    // 饼图分布：状态/严重度/优先级/类型/产品/项目
    function _bugPieCard(title, groups, counts) {
      var total = 0;
      groups.forEach(function(g) { total += (counts[g.key] || 0); });
      if (!total) return '';
      return _buildPieChart(groups, counts, total, title);
    }
    var piePalette = ['var(--accent)','var(--warn)','var(--success)','var(--danger)','var(--purple)','#B0B8C9'];
    var statusColor = {open:'var(--warn)',confirmed:'var(--accent)',in_progress:'var(--accent)',gitlab_submitted:'var(--purple)',resolved:'var(--success)',closed:'var(--muted)'};
    var typeColor = {codeerror:'var(--accent)',design:'var(--warn)',security:'var(--danger)',performance:'var(--purple)',compatibility:'var(--success)',standard:'#B0B8C9',repair:'var(--warn)',other:'var(--muted)'};

    var statusGroups = _bugStatusOpts.map(function(o) { return {key: o.v, label: o.l, color: statusColor[o.v] || 'var(--muted)'}; });
    var sevGroups = [1,2,3,4].map(function(s) {
      return {key: String(s), label: (sevLabels[s] || ('S'+s)), color: (sevColors[s] || 'var(--muted)')};
    });
    var prioGroups = ['low','medium','high','critical'].map(function(p) {
      return {key: p, label: (prioLabels[p] || p), color: {low:'var(--muted)',medium:'var(--accent)',high:'var(--warn)',critical:'var(--danger)'}[p]};
    });
    var typeGroups = Object.keys(_bugTypeLabels).map(function(t) { return {key: t, label: _bugTypeLabels[t], color: typeColor[t] || 'var(--accent)'}; });
    var prodGroups = (stats.by_product || []).map(function(x, i) { return {key: String(x.id), label: x.name, color: piePalette[i % piePalette.length]}; });
    var prodCounts = {}; (stats.by_product || []).forEach(function(x) { prodCounts[String(x.id)] = x.count; });
    var projGroups = (stats.by_project || []).map(function(x, i) { return {key: String(x.id), label: (x.code || x.name), color: piePalette[i % piePalette.length]}; });
    var projCounts = {}; (stats.by_project || []).forEach(function(x) { projCounts[String(x.id)] = x.count; });

    var pies = [
      _bugPieCard('按状态分布', statusGroups, stats.by_status || {}),
      _bugPieCard('按严重度分布', sevGroups, stats.by_severity || {}),
      _bugPieCard('按优先级分布', prioGroups, stats.by_priority || {}),
      _bugPieCard('按类型分布', typeGroups, stats.by_type || {}),
      _bugPieCard('按产品分布', prodGroups, prodCounts),
      _bugPieCard('按项目分布', projGroups, projCounts)
    ].filter(Boolean);
    var pieHtml = pies.length
      ? '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px;margin-bottom:16px">' + pies.join('') + '</div>'
      : '';

    // 月度趋势
    var trend = stats.trend || [];
    var maxTrend = 1;
    trend.forEach(function(t) { maxTrend = Math.max(maxTrend, t.created, t.resolved); });
    var trendHtml = '<div class="card" style="padding:16px;margin-bottom:16px">' +
      '<div class="section-hd" style="margin-bottom:10px"><span class="section-title">月度趋势（新增 / 解决）</span></div>' +
      '<div style="display:flex;align-items:flex-end;gap:8px;height:140px;padding-top:10px;overflow-x:auto">' +
      trend.map(function(t) {
        var ch = Math.round(t.created / maxTrend * 110);
        var rh = Math.round(t.resolved / maxTrend * 110);
        return '<div style="display:flex;flex-direction:column;align-items:center;justify-content:flex-end;flex:1;min-width:44px;height:130px">' +
          '<div style="display:flex;gap:3px;align-items:flex-end;height:110px">' +
            '<div style="width:10px;height:' + (ch||2) + 'px;background:var(--accent);border-radius:2px 2px 0 0" title="新增 ' + t.created + '"></div>' +
            '<div style="width:10px;height:' + (rh||2) + 'px;background:var(--success);border-radius:2px 2px 0 0" title="解决 ' + t.resolved + '"></div>' +
          '</div>' +
          '<span style="font-size:10px;color:var(--muted);margin-top:4px;white-space:nowrap">' + (t.month||'').slice(2) + '</span>' +
        '</div>';
      }).join('') +
      '</div>' +
      '<div style="display:flex;gap:16px;margin-top:8px;font-size:11px;color:var(--muted)">' +
        '<span><span style="display:inline-block;width:10px;height:10px;background:var(--accent);border-radius:2px;margin-right:4px"></span>新增</span>' +
        '<span><span style="display:inline-block;width:10px;height:10px;background:var(--success);border-radius:2px;margin-right:4px"></span>解决</span>' +
      '</div>' +
    '</div>';

    body.innerHTML = kpi + pieHtml + trendHtml;
  } catch(e) {
    body.innerHTML = '<div class="error-state">加载报表失败: ' + escHtml(e.message) + '</div>';
  }
}

/* ── Project Bug List (project detail sub-page) ── */

async function loadProjectBugs(projectCode) {
  var container = document.getElementById('proj-bugs-content');
  if (!container || !projectCode) return;
  container.innerHTML = '<div class="loading-spinner">加载Bug...</div>';
  try {
    var results = await Promise.all([
      API.get('/bugs?project_id=' + encodeURIComponent(projectCode) + '&limit=200'),
      API.get('/bugs/stats?project_id=' + encodeURIComponent(projectCode)).catch(function() { return null; })
    ]);
    var bugs = results[0] || [];
    var stats = results[1] || null;
    _renderProjectBugs(bugs, stats, container);
  } catch(e) {
    container.innerHTML = '<div class="empty-state" style="color:var(--danger);padding:20px">加载失败: ' + escHtml(e.message || '') + '</div>';
  }
}

var _projBugsAll = [];
var _projBugsDt = null;
var _projBugStats = null;
var _projBugFilterStatus = '';

function _projBugAssignees(bugs) {
  var seen = {};
  (bugs || []).forEach(function(b) {
    var n = b.assignee_name || '';
    if (n) seen[n] = true;
  });
  return Object.keys(seen).sort();
}

function _projBugFilterValues() {
  var sev = document.getElementById('pbuf-severity');
  var prio = document.getElementById('pbuf-priority');
  var asg = document.getElementById('pbuf-assignee');
  return {
    status: _projBugFilterStatus,
    severity: sev ? sev.value : '',
    priority: prio ? prio.value : '',
    assignee: asg ? asg.value : ''
  };
}

function _applyProjBugFilters() {
  var f = _projBugFilterValues();
  var clearBtnMap = {severity: 'pbuf-clear-severity', priority: 'pbuf-clear-priority', assignee: 'pbuf-clear-assignee'};
  Object.keys(clearBtnMap).forEach(function(key) {
    var cb = document.getElementById(clearBtnMap[key]);
    if (cb) cb.style.display = f[key] ? 'inline-flex' : 'none';
  });
  var filtered = _projBugsAll.filter(function(b) {
    if (f.status && b.status !== f.status) return false;
    if (f.severity && String(b.severity) !== f.severity) return false;
    if (f.priority && b.priority !== f.priority) return false;
    if (f.assignee && (b.assignee_name || '') !== f.assignee) return false;
    return true;
  });
  if (_projBugsDt) _projBugsDt.setData(filtered);
  _renderProjBugStats(_projBugStats);
}

function _clearProjBugFilters() {
  _projBugFilterStatus = '';
  ['pbuf-severity', 'pbuf-priority', 'pbuf-assignee'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
  _applyProjBugFilters();
}

function _clearProjBugFilter(field) {
  var map = {severity: 'pbuf-severity', priority: 'pbuf-priority', assignee: 'pbuf-assignee'};
  var el = document.getElementById(map[field]);
  if (el) el.value = '';
  _applyProjBugFilters();
}

function _projBugFilterByStatus(status) {
  _projBugFilterStatus = status;
  _applyProjBugFilters();
}

function _renderProjBugStats(stats) {
  _projBugStats = stats || null;
  var el = document.getElementById('proj-bug-stats');
  if (!el) return;
  if (!_projBugStats) { el.innerHTML = ''; return; }
  var statusLabels = {open:'待确认', confirmed:'已确认', in_progress:'处理中', gitlab_submitted:'GitLab已提交', resolved:'已解决', closed:'已关闭'};
  var statusColors = {open:'var(--warn)', confirmed:'var(--accent)', in_progress:'var(--accent)', gitlab_submitted:'var(--purple)', resolved:'var(--success)', closed:'var(--muted)'};
  var statusKeys = ['open','confirmed','in_progress','resolved','closed'];
  var f = _projBugFilterValues();
  var hasFilter = !!(f.status || f.severity || f.priority || f.assignee);
  var cards = _bugKpiCard('全部', _projBugStats.total, 'var(--fg)', 'var(--surface2)', !hasFilter, '_clearProjBugFilters()');
  statusKeys.forEach(function(k) {
    var cnt = (_projBugStats.by_status && _projBugStats.by_status[k]) || 0;
    cards += _bugKpiCard(statusLabels[k], cnt, statusColors[k], _bugStatusLt[k], f.status === k, "_projBugFilterByStatus('" + k + "')");
  });
  el.innerHTML = '<div class="kpi-grid" style="grid-template-columns:repeat(6,1fr)">' + cards + '</div>';
}

function _renderProjectBugs(bugs, stats, container) {
  _projBugsAll = bugs || [];
  _projBugsDt = null;
  if (!_projBugsAll.length) { container.innerHTML = '<div class="card" style="padding:20px"><div class="empty-state">暂无Bug</div></div>'; return; }
  var sevLabels = {1:'致命',2:'严重',3:'一般',4:'建议'};
  var sevColors = {1:'var(--danger)',2:'var(--warn)',3:'var(--accent)',4:'var(--muted)'};

  var assigneeOpts = _projBugAssignees(_projBugsAll).map(function(n) { return '<option value="' + escHtml(n) + '">' + escHtml(n) + '</option>'; }).join('');

  var filterBar =
    '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 12px;border:1px solid var(--border);border-radius:8px;background:var(--surface);margin-bottom:12px">' +
      '<span style="font-size:11px;color:var(--muted);white-space:nowrap">筛选</span>' +
      '<label style="font-size:11px;color:var(--muted);display:flex;align-items:center;gap:4px">严重程度' +
        '<select class="search-inp" id="pbuf-severity" onchange="_applyProjBugFilters()" style="width:110px;font-size:11px;padding:2px 6px"><option value="">全部</option><option value="1">1-致命</option><option value="2">2-严重</option><option value="3">3-一般</option><option value="4">4-建议</option></select>' +
        '<span class="combo-clear" id="pbuf-clear-severity" onclick="_clearProjBugFilter(\'severity\')" title="清除严重程度筛选" style="display:none">✕</span></label>' +
      '<label style="font-size:11px;color:var(--muted);display:flex;align-items:center;gap:4px">优先级' +
        '<select class="search-inp" id="pbuf-priority" onchange="_applyProjBugFilters()" style="width:100px;font-size:11px;padding:2px 6px"><option value="">全部</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option><option value="critical">紧急</option></select>' +
        '<span class="combo-clear" id="pbuf-clear-priority" onclick="_clearProjBugFilter(\'priority\')" title="清除优先级筛选" style="display:none">✕</span></label>' +
      '<label style="font-size:11px;color:var(--muted);display:flex;align-items:center;gap:4px">责任人' +
        '<select class="search-inp" id="pbuf-assignee" onchange="_applyProjBugFilters()" style="width:110px;font-size:11px;padding:2px 6px"><option value="">全部</option>' + assigneeOpts + '</select>' +
        '<span class="combo-clear" id="pbuf-clear-assignee" onclick="_clearProjBugFilter(\'assignee\')" title="清除责任人筛选" style="display:none">✕</span></label>' +
    '</div>';

  container.innerHTML = '<div id="proj-bug-stats" style="margin-bottom:12px"></div>' + filterBar + '<div id="proj-bugs-table"></div>';
  _renderProjBugStats(stats);
  _projBugsDt = new DataTable({
    container: document.getElementById('proj-bugs-table'),
    columns: [
      { key: 'id', title: '#', minWidth: 60, width: '6%', render: function(v) { return '<span style="font-size:11px;font-family:var(--mono);cursor:pointer" onclick="openBugDetail('+v+')">#'+v+'</span>'; } },
      { key: 'title', title: '标题', minWidth: 120, width: '26%', align: 'left', render: function(v, row) { return '<span style="font-weight:530;cursor:pointer" onclick="openBugDetail('+row.id+')" title="查看Bug详情">'+escHtml(v||'')+'</span>'; } },
      { key: 'status', title: '状态', minWidth: 80, width: '8%', render: function(v) { return renderPill(v||'open'); } },
      { key: 'severity', title: '严重程度', minWidth: 70, width: '7%', render: function(v, row) { var c=sevColors[v]||'var(--muted)'; return '<span style="color:'+c+';font-weight:500;font-size:12px;cursor:pointer" onclick="openBugDetail('+row.id+')">'+(sevLabels[v]||v)+'</span>'; } },
      { key: 'priority', title: '优先级', minWidth: 65, width: '7%', render: function(v) { return renderPriorityBadge(v); } },
      { key: 'component_name', title: '组件', minWidth: 90, width: '10%', render: function(v) { return '<span style="font-size:12px">'+escHtml(v||'—')+'</span>'; } },
      { key: 'assignee_name', title: '负责人', minWidth: 60, width: '60px', render: function(v) { return '<span style="font-size:12px">'+escHtml(v||'—')+'</span>'; } },
      { key: 'created_at', title: '创建时间', minWidth: 100, width: '10%', render: function(v) { return '<span style="font-size:11px;color:var(--muted)">'+formatDate(v)+'</span>'; } }
    ],
    data: _projBugsAll,
    maxHeight: 'calc(100vh - 320px)',
  });
}

function _renderKanban(container, bugs) {
  var cols = [
    {key:'open',label:'待确认'},
    {key:'in_progress',label:'处理中'},{key:'gitlab_submitted',label:'GitLab已提交'},
    {key:'resolved',label:'已解决'},{key:'closed',label:'已关闭'}];
  var grouped = {};
  cols.forEach(function(c) { grouped[c.key] = []; });
  bugs.forEach(function(b) { var k = b.status||'open'; if (!grouped[k]) grouped[k] = []; grouped[k].push(b); });

  var html = '<div style="display:flex;gap:12px;overflow-x:auto;height:100%;align-items:flex-start">';
  cols.forEach(function(c) {
    html += '<div style="flex:1;min-width:200px;background:var(--bg);border-radius:8px;padding:10px">' +
      '<div style="font-weight:600;font-size:12px;margin-bottom:8px;color:var(--muted)">' + c.label + ' <span style="font-size:10px">' + grouped[c.key].length + '</span></div>';
    grouped[c.key].forEach(function(b) {
      html += '<div draggable="true" ondragstart="_bugDragStart(event,'+b.id+')" style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:8px;margin-bottom:6px;cursor:pointer;font-size:12px" onclick="openBugDetail('+b.id+')">' +
        '<div style="font-weight:530;margin-bottom:2px">' + escHtml(b.title) + '</div>' +
        '<div style="font-size:10px;color:var(--muted)">' + escHtml(b.product_name||'') + ' · ' + escHtml(b.assignee_name||'未分配') + '</div>' +
        '<div style="margin-top:4px">' + _renderSev('S'+b.severity, b.severity) + ' ' + renderPriorityBadge(b.priority) + '</div>' +
      '</div>';
    });
    html += '</div>' +
      '<div ondragover="event.preventDefault()" ondrop="_bugDragDrop(event,\''+c.key+'\')" style="min-height:40px"></div>';
  });
  html += '</div>';
  container.innerHTML = html;
}

/* ── Bug Detail ── */

var _bCard = 'background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px 14px;margin-bottom:10px';
var _bCardHd = 'font-size:11px;font-weight:600;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.03em';
var _bGrid2 = 'display:grid;grid-template-columns:1fr 1fr;gap:6px 20px';
var _bLbl = 'font-size:11px;color:var(--muted)';
var _bVal = 'font-size:13px;margin-top:1px';

function _renderBugDetailBody(b) {
  _bugDetailCanEdit = _bugCanEdit(b);
  var sevs = {1:'致命',2:'严重',3:'一般',4:'建议'};
  var sevColors = {1:'var(--danger)',2:'var(--warn)',3:'var(--accent)',4:'var(--muted)'};
  var projHtml = b.project_code ? projCodeTag(b.project_code, 'openProject(\'' + escHtml(b.project_code).replace(/'/g, "\\'") + '\')', b.project_name) + ' ' + escHtml(b.project_name || '') : escHtml(b.project_name || '-');
  var typeLabel = {codeerror:'代码错误',design:'设计缺陷',security:'安全问题',performance:'性能问题',repair:'维修',other:'其他'}[b.type]||b.type;

  var _STATUS_OPTS = [
    {v:'open',l:'待确认'},{v:'in_progress',l:'处理中'},
    {v:'resolved',l:'已解决'},{v:'closed',l:'已关闭'}];
  var _SEV_OPTS = [{v:'1',l:'1-致命'},{v:'2',l:'2-严重'},{v:'3',l:'3-一般'},{v:'4',l:'4-建议'}];
  var _PRIO_OPTS = [{v:'low',l:'低'},{v:'medium',l:'中'},{v:'high',l:'高'},{v:'critical',l:'紧急'}];
  var _TYPE_OPTS = [{v:'codeerror',l:'代码错误'},{v:'design',l:'设计缺陷'},{v:'security',l:'安全问题'},{v:'performance',l:'性能问题'},{v:'repair',l:'维修'},{v:'other',l:'其他'}];

  var html = '';
  // ── CSS for inline editing ──
  html += '<style>' +
    '.bug-detail-body .editable-field{cursor:pointer;display:inline-block;border-radius:5px;padding:2px 8px;margin:-2px -8px;transition:background 0.15s,border-color 0.15s;border:2px solid transparent}' +
    '.bug-detail-body .editable-field:hover{background:var(--accent-lt);border-color:var(--accent)}' +
    '.bug-detail-body .editable-field.editing{cursor:default;padding:0;margin:0;border:none;display:block}' +
    '.bug-detail-body .editable-field.editing:hover{background:transparent;border-color:transparent}' +
    '.bug-detail-body .ef-display{display:inline-block;min-width:8px}' +
    '.bug-detail-body .ef-save-btn{background:var(--accent-lt);border-color:var(--accent);color:var(--accent);transition:background 0.15s,color 0.15s,border-color 0.15s}' +
    '.bug-detail-body .ef-save-btn:hover{background:var(--accent);color:#fff;border-color:var(--accent)}' +
    '.bug-detail-body .ef-cancel-btn{background:var(--warn-lt);border-color:var(--warn);color:var(--warn);transition:background 0.15s,color 0.15s,border-color 0.15s}' +
    '.bug-detail-body .ef-cancel-btn:hover{background:var(--warn);color:#fff;border-color:var(--warn)}' +
    '.bug-detail-body .bd-val{font-size:13px}' +
    '.bug-detail-body .bd-lbl{font-size:11px}' +
    '</style>';

  // ── 布局：左侧其他卡片，右侧基本信息 + 状态与进度（上下摆放）──
  html += '<div style="display:flex;gap:16px;align-items:flex-start">' +

    // ── 左侧：描述 / 分析记录 / 工时日志 / 历史记录 ──
    '<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:16px">' +

      // ── 描述 ──
      '<div class="card info-glass-card" style="padding:20px">' +
        '<div class="section-hd"><span class="section-title">描述</span>' +
          (_bugDetailCanEdit ? iconEdit('_editDescription(\'bug\', ' + b.id + ')', '编辑描述') : '') +
        '</div>' +
        '<div id="bug-desc-' + b.id + '" data-desc="' + escHtml(b.description || '') + '" class="markdown-body" style="font-size:13px;line-height:1.6;min-height:20px">' +
          (b.description ? renderMarkdown(b.description) : '<span style="color:var(--muted)">暂无描述</span>') +
        '</div>' +
      '</div>' +

      // ── 分析记录 ──
      '<div class="card info-glass-card" style="padding:20px">' +
        '<div class="section-hd" style="display:flex;align-items:center;justify-content:space-between">' +
          '<span class="section-title">分析记录</span>' +
          '<div style="display:flex;gap:6px;align-items:center">' +
            _timelineOrderBtn('bug', b.id, 'bv-analyses', '_loadBugAnalyses') +
            '<button class="btn btn-primary" style="font-size:11px;padding:3px 10px" onclick="openBugAnalysisDialog(' + b.id + ')">+ 添加</button>' +
          '</div>' +
        '</div>' +
        '<div id="bv-analyses">加载中...</div>' +
      '</div>' +

      // ── 工时日志 ──
      '<div class="card info-glass-card" style="padding:20px">' +
        '<div class="section-hd"><span class="section-title">工时日志 (' + (b.consumed_hours || 0).toFixed(1) + 'h)</span>' +
          '<button class="btn btn-primary" style="font-size:11px;padding:3px 10px" onclick="openBugWorklogDialog(' + b.id + ')">+ 记录</button></div>' +
        '<div id="bv-worklogs" style="font-size:12px">加载中...</div>' +
      '</div>' +

      // ── 历史记录 ──
      '<div class="card info-glass-card" style="padding:20px">' +
        '<div class="section-hd" style="display:flex;align-items:center;justify-content:space-between">' +
          '<span class="section-title">历史记录</span>' +
          '<div style="display:flex;gap:6px;align-items:center">' +
            _timelineCollapseBtn('bug-detail-comments') +
            _timelineOrderBtn('bug', b.id, 'bug-detail-comments') +
            '<button class="btn btn-primary" style="font-size:11px;padding:3px 10px" onclick="openCommentDialog(\'bug\', ' + b.id + ')">添加评论</button>' +
          '</div>' +
        '</div>' +
        '<div id="bug-detail-comments" style="margin-bottom:8px">加载中...</div>' +
      '</div>' +

    '</div>' +

    // ── 右侧：基本信息 + 状态与进度（上下摆放）──
    '<div style="flex:0 0 400px;min-width:0;display:flex;flex-direction:column;gap:16px">' +

      // ── 基本信息 ──
      '<div class="card info-glass-card" style="padding:20px">' +
        '<div class="section-hd"><span class="section-title">基本信息</span></div>' +
        '<div class="delivery-kpi" style="grid-template-columns:1fr 1fr">' +
          // Product (read-only)
          '<div class="dkpi"><div class="dkpi-lbl">产品</div><div class="bd-val">' + (b.product_code ? '<span class="proj-code-btn" onclick="openProductDetail(\'' + escHtml(b.product_code) + '\')" title="' + escHtml(b.product_name || '') + '">' + escHtml(b.product_code) + '</span> ' + escHtml(b.product_name || '') : escHtml(b.product_name || '-')) + '</div></div>' +
          // Project (read-only)
          '<div class="dkpi"><div class="dkpi-lbl">项目</div><div class="bd-val">' + projHtml + '</div></div>' +
          // Component (editable)
          '<div class="dkpi"><div class="dkpi-lbl">组件</div>' +
            _buildBugEditableField(b.id, 'component_id', 'component-select',
              '<span class="bd-val">' + escHtml(b.component_name || '-') + '</span>',
              String(b.component_id || ''), null, ' data-product-id="' + (b.product_id || '') + '"') + '</div>' +
          // Type (editable)
          '<div class="dkpi"><div class="dkpi-lbl">类型</div>' +
            _buildBugEditableField(b.id, 'type', 'select', '<span class="bd-val">' + escHtml(typeLabel) + '</span>', b.type || 'codeerror', _TYPE_OPTS) + '</div>' +
          // Reporter (read-only)
          '<div class="dkpi"><div class="dkpi-lbl">创建人</div><div class="bd-val">' + escHtml(b.reporter_name || '-') + '</div></div>' +
          // Assignee (editable)
          '<div class="dkpi"><div class="dkpi-lbl">负责人</div>' +
            _buildBugEditableField(b.id, 'assignee_id', 'user-select', '<span class="bd-val">' + escHtml(b.assignee_name || '未分配') + '</span>', b.assignee_id || '') + '</div>' +
        '</div>' +
        // 抄送（基本信息的一部分，整行展示）
        '<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">' +
          '<div class="dkpi"><div class="dkpi-lbl">抄送</div>' +
            _buildBugEditableField(b.id, 'cc_user_ids', 'cc-select',
              '<span class="bd-val">' + ((b.cc_user_names && b.cc_user_names.length) ? escHtml(b.cc_user_names.join(', ')) : '无') + '</span>',
              JSON.stringify(b.cc_user_ids || [])) +
          '</div>' +
        '</div>' +
        ((b.board_ids && b.board_ids.length) ?
          '<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">' +
            '<div class="dkpi"><div class="dkpi-lbl">关联板卡</div><div class="bd-val">' +
              (b.board_nos || []).map(function(no, i) {
                var projCode = escHtml(String(b.project_code || '')).replace(/'/g, "\\'");
                var serial = escHtml(String(no)).replace(/'/g, "\\'");
                return '<span class="tag-badge tag-1" title="跳转到交付页产品列表定位并高亮该编号" style="margin:2px 4px 2px 0;cursor:pointer" onclick="_boardJumpToDelivery(\'' + projCode + '\',\'' + serial + '\')">' + escHtml(no) + '</span>';
              }).join('') +
            '</div></div>' +
          '</div>' : '') +
      '</div>' +

      // ── 状态与进度 ──
      '<div class="card info-glass-card" style="padding:20px">' +
        '<div class="section-hd"><span class="section-title">状态与进度</span></div>' +
        '<div class="delivery-kpi" style="grid-template-columns:1fr 1fr">' +
          // Status (read-only — 只能由进度自动更新)
          '<div class="dkpi"><div class="dkpi-lbl">状态 <span style="font-size:10px;color:var(--accent)">(自动)</span></div><div id="bug-status-' + b.id + '" data-status="' + (b.status || 'open') + '">' + renderPill(b.status || 'open') + '</div></div>' +
          // Severity (editable)
          '<div class="dkpi"><div class="dkpi-lbl">严重程度</div>' + _buildBugEditableField(b.id, 'severity', 'select',
            '<span style="font-size:13px;color:' + (sevColors[b.severity] || 'var(--muted)') + ';font-weight:500">' + (sevs[b.severity] || b.severity) + '</span>',
            String(b.severity || 3), _SEV_OPTS) + '</div>' +
          // Priority (editable)
          '<div class="dkpi"><div class="dkpi-lbl">优先级</div>' + _buildBugEditableField(b.id, 'priority', 'select', renderPriorityBadge(b.priority || 'medium'), b.priority || 'medium', _PRIO_OPTS) + '</div>' +
          // Hours info (read-only — 实际/预估)
          '<div class="dkpi"><div class="dkpi-lbl">工时信息</div><div class="bd-val">实际 ' + (b.consumed_hours || 0).toFixed(1) + 'h / 预估 ' + (b.estimate_hours || 0).toFixed(1) + 'h</div></div>' +
          // Progress (editable — 圆圈显示，点击滑杆编辑，与任务页一致)
          '<div class="dkpi"><div class="dkpi-lbl">进度(%)</div>' +
            _buildBugEditableField(b.id, 'progress', 'number', renderProgressCircle(b.progress || 0, 30, {label:''}), String(b.progress || 0), {min:0,max:100,step:5}) + '</div>' +
          // Resolution (editable — bug解决方式)
          '<div class="dkpi"><div class="dkpi-lbl">解决方式</div>' +
            _buildBugEditableField(b.id, 'resolution', 'select',
              '<span class="bd-val">' + ({resolved:'已解决',duplicate:'重复',wontfix:'不予解决',invalid:'无效',postponed:'延期处理'}[b.resolution] || b.resolution || '—') + '</span>',
              b.resolution || '', [{v:'',l:'—'},{v:'resolved',l:'已解决'},{v:'duplicate',l:'重复'},{v:'wontfix',l:'不予解决'},{v:'invalid',l:'无效'},{v:'postponed',l:'延期处理'}]) + '</div>' +
        '</div>' +
      '</div>' +

    '</div>' +

  '</div>';

  return html;
}

/* ── Full-page Bug Detail / Edit / Create ── */

function initBugDetail(bugId) {
  bugId = parseInt(bugId);
  var viewEl = document.getElementById('view-bugs');
  if (!viewEl) return;
  viewEl.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted)">加载中...</div>';
  document.getElementById('topbar-title').textContent = 'Bug #' + bugId;

  // 先加载收藏列表再渲染，确保标题栏星星在直接访问/刷新时状态正确
  Promise.all([
    API.get('/bugs/' + bugId),
    (typeof loadFavorites === 'function' ? loadFavorites() : Promise.resolve())
  ]).then(function(results) {
    var b = results[0] || {};
    var html = '<div class="bug-detail-page" style="width:80%;margin:0 auto;padding:20px">' +
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">' +
        favStar('bug', b.id, {size: '20px'}) +
        '<span style="font-size:15px;font-weight:620">Bug #' + b.id + ' · ' + escHtml(b.title) + '</span>' +
        '<span style="flex:1"></span>' +
        (_bugCanEdit(b) ? iconEdit('gotoView(\'bugs\', {params: [String(' + b.id + '), \'edit\']})', '编辑') : '') +
      '</div>' +
      '<div class="bug-detail-body">' +
        _renderBugDetailBody(b) +
      '</div>' +
    '</div>';
    viewEl.innerHTML = html;
    document.getElementById('topbar-title').textContent = 'Bug #' + b.id + ' · ' + (b.title || '');

    // Load worklogs + comments + analyses
    API.get('/bugs/'+bugId+'/worklogs').then(function(logs) {
      var el = document.getElementById('bv-worklogs');
      if (el) { el.innerHTML = _renderBugWorklogTable(logs||[], bugId); _initBugWorklogDt(logs||[], bugId); }
    });
    _loadBugComments(bugId);
    _loadBugAnalyses(bugId);
    // 快捷跳转侧栏
    if (typeof updateDetailToc === 'function') updateDetailToc();
  }).catch(function(e) {
    viewEl.innerHTML = '<div style="text-align:center;padding:40px;color:var(--danger)">加载失败: ' + escHtml(e.message || '') + '</div>';
  });
}

function initBugEdit(bugId) {
  bugId = parseInt(bugId);
  var viewEl = document.getElementById('view-bugs');
  if (!viewEl) return;
  viewEl.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted)">加载中...</div>';

  API.get('/bugs/' + bugId).then(function(data) {
    var b = data || {};
    var formHtml = _buildBugForm(b, true);
    var html = '<div class="bug-edit-page" style="max-width:1200px;margin:0 auto;padding:20px">' +
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">' +
        '<button class="btn btn-sm" onclick="history.back()">← 返回</button>' +
        '<span style="font-size:15px;font-weight:620">编辑 Bug #' + b.id + ' · ' + escHtml(b.title) + '</span>' +
        '<span style="flex:1"></span>' +
        '<button class="btn btn-sm btn-primary" onclick="_submitBugFullPage(' + b.id + ')">保存</button>' +
      '</div>' +
      formHtml +
    '</div>';
    viewEl.innerHTML = html;
    document.getElementById('topbar-title').textContent = '编辑 Bug #' + b.id;
    setTimeout(function() { initRichEditor('bf-desc', {height: 400}); }, 100);
    _initBugFormSelectors(b, true);
  }).catch(function(e) {
    viewEl.innerHTML = '<div style="text-align:center;padding:40px;color:var(--danger)">加载失败: ' + escHtml(e.message || '') + '</div>';
  });
}

function initBugCreate() {
  var viewEl = document.getElementById('view-bugs');
  if (!viewEl) return;
  var formHtml = _buildBugForm(null, false);
  var html = '<div class="bug-create-page" style="max-width:1200px;margin:0 auto;padding:20px">' +
    '<div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">' +
      '<span style="font-size:15px;font-weight:620">新建 Bug</span>' +
      '<span style="flex:1"></span>' +
      '<button class="btn btn-sm btn-primary" onclick="_submitBugFullPage(null)">创建</button>' +
    '</div>' +
    formHtml +
  '</div>';
  viewEl.innerHTML = html;
  document.getElementById('topbar-title').textContent = '新建 Bug';
  setTimeout(function() { initRichEditor('bf-desc', {height: 400}); }, 100);
  _initBugFormSelectors(null, false);
}

async function _submitBugFullPage(bugId) {
  var desc = document.getElementById('bf-desc').value.trim();
  var title = (document.getElementById('bf-title') || {}).value || '';
  if (!title) { showToast('请输入Bug标题', 'error'); return; }

  var pid = _bfProdId || 0;
  var projId = _bfProjId || 0;
  var asgnId = window._bfAsgnId || null;
  var sev = parseInt(document.getElementById('bf-severity').value) || 0;

  if (!pid) { showToast('请选择所属产品', 'error'); return; }
  if (!projId) { showToast('请选择所属项目', 'error'); return; }
  if (!asgnId) { showToast('请选择负责人', 'error'); return; }
  if (!sev) { showToast('请选择严重程度', 'error'); return; }
  var bugType = document.getElementById('bf-type').value;
  if (bugType === 'repair' && (!window._bfBoardIds || !window._bfBoardIds.length)) {
    showToast('维修类 Bug 必须至少关联一块板卡', 'error');
    return;
  }

  var data = {
    title: title,
    description: desc,
    product_id: pid,
    project_id: projId,
    component_id: parseInt(document.getElementById('bf-component').value) || null,
    type: bugType,
    severity: sev,
    priority: document.getElementById('bf-priority').value,
    status: document.getElementById('bf-status').value,
    estimate_hours: parseFloat(document.getElementById('bf-estimate').value) || 0,
    progress: parseInt(document.getElementById('bf-progress').value) || 0,
    assignee_id: asgnId,
    cc_user_ids: (window._bfCcIds && window._bfCcIds.length) ? window._bfCcIds : null,
    board_ids: (window._bfBoardIds && window._bfBoardIds.length) ? window._bfBoardIds.slice() : null,
  };

  try {
    if (bugId) {
      await API.put('/bugs/' + bugId, data);
      showToast('保存成功', 'success');
    } else {
      var result = await API.post('/bugs', data);
      showToast('创建成功', 'success');
      bugId = result.id || result.bug_id;
    }
    setTimeout(function() { history.back(); }, 500);
  } catch(e) {
    showToast('操作失败: ' + (e.message || ''), 'error');
  }
}

/* 关联板卡编号 → 跳转项目交付页，定位并高亮产品列表中对应编号 */
function _boardJumpToDelivery(projectCode, serialNo) {
  gotoView('detail', { params: [String(projectCode), 'delivery', String(serialNo)] });
}

function openBugDetail(bugId) {
  gotoView('bugs', { params: [String(bugId)] });
}

async function _refreshBugDetailContent(bugId) {
  // In-place refresh of the full-page bug detail (worklogs/comments/analyses)
  if (!document.querySelector('.bug-detail-page')) return;
  try {
    var freshBug = await API.get('/bugs/' + bugId);
    var bodyEl = document.querySelector('.bug-detail-body');
    if (bodyEl) {
      bodyEl.innerHTML = _renderBugDetailBody(freshBug);
    }
    API.get('/bugs/'+bugId+'/worklogs').then(function(logs) {
      var el = document.getElementById('bv-worklogs');
      if (el) { el.innerHTML = _renderBugWorklogTable(logs||[], bugId); _initBugWorklogDt(logs||[], bugId); }
    });
    _loadBugComments(bugId);
    _loadBugAnalyses(bugId);
    // 快捷跳转侧栏（区块 id 可能变化，重建链接）
    if (typeof updateDetailToc === 'function') updateDetailToc();
  } catch(e) {
    // Fallback: still refresh worklogs
    API.get('/bugs/'+bugId+'/worklogs').then(function(logs) {
      var el = document.getElementById('bv-worklogs');
      if (el) { el.innerHTML = _renderBugWorklogTable(logs||[], bugId); _initBugWorklogDt(logs||[], bugId); }
    });
  }
}

function _loadBugComments(bugId) {
  renderTimeline('bug', bugId, 'bug-detail-comments');
}

// DEPRECATED: replaced by openCommentDialog() (rich-text dialog)
function _submitBugComment(bugId) {
  openCommentDialog('bug', bugId);
}

/* ── Create/Edit Dialog ── */

function openBugDialog(bugId) {
  if (bugId) { gotoView('bugs', { params: [String(bugId)] }); return; }
  gotoView('bug-create');
}

function _buildBugForm(t, isEdit) {
  t = t || {};
  var inp = 'width:100%;box-sizing:border-box;margin-top:1px';
  var bodyHtml = '';

  // ── Row 1: 基本信息 + 状态与进度 ──
  bodyHtml += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
    '<div style="' + _bCard + '">' +
      '<div style="' + _bCardHd + '">基本信息</div>' +
      '<div style="margin-bottom:6px"><label style="' + _bLbl + '">标题 *</label>' +
        '<input class="search-inp" id="bf-title" value="' + escHtml(t.title || '') + '" placeholder="请填入Bug标题" style="' + inp + '">' +
        '<div id="bf-title-hint" style="display:none;font-size:10px;color:var(--danger);margin-top:1px">请填入Bug标题</div></div>' +
      '<div style="' + _bGrid2 + '">' +
        '<div><label style="' + _bLbl + '">项目 *</label>' +
          '<div style="margin-top:2px">' + createSearchCombo({
            comboId: 'bf-proj', inputId: 'bf-proj-input', dropdownId: 'bf-proj-drop',
            placeholder: '搜索项目...',
            dataSource: function() {
              if (_bfProdId) return API.get('/products/' + _bfProdId + '/projects');
              return loadAllProjects().then(function() { return _allProjects || []; });
            },
            selectedIdFn: function() { return t.project_id || null; },
            onSelect: function(p) { _bfProjId = p.id; _bugLoadProducts(p.id); _bugBoardProjectChanged(p.id); }
          }) + '<div id="bf-proj-hint" style="display:none;font-size:10px;color:var(--danger);margin-top:1px">请选择项目</div></div></div>' +
        '<div><label style="' + _bLbl + '">产品 *</label>' +
          '<div style="margin-top:2px">' + createSearchCombo({
            comboId: 'bf-prod', inputId: 'bf-prod-input', dropdownId: 'bf-prod-drop',
            placeholder: '搜索产品...',
            dataSource: function() {
              if (_bfProjId) return API.get('/projects/' + _bfProjId + '/products');
              return API.get('/products?limit=200');
            },
            selectedIdFn: function() { return t.product_id || null; },
            onSelect: function(p) { _bfProdId = p.id; _bugLoadComponents(); _bugLoadProjects(p.id); }
          }) + '<div id="bf-prod-hint" style="display:none;font-size:10px;color:var(--danger);margin-top:1px">请选择产品</div></div></div>' +
      '</div>' +
      '<div style="' + _bGrid2 + '">' +
        '<div><label style="' + _bLbl + '">组件</label><select class="search-inp" id="bf-component" style="' + inp + '"><option value="">选择组件...</option></select></div>' +
        '<div><label style="' + _bLbl + '">负责人 *</label><div id="bf-assignee-wrap" style="margin-top:2px"></div>' +
          '<div id="bf-assignee-hint" style="display:none;font-size:10px;color:var(--danger);margin-top:1px">请选择负责人</div></div>' +
      '</div>' +
      '<div style="' + _bGrid2 + ';margin-top:6px">' +
        '<div><label style="' + _bLbl + '">创建人</label>' +
          '<div style="' + inp + ';padding:7px 11px;background:var(--bg);border:1px solid var(--border);border-radius:7px;font-size:13px;color:var(--fg);line-height:1.4">' + escHtml(t.reporter_name || (function(){var u=getCurrentUser();return u?u.display_name||u.username:'—';})()) + '</div></div>' +
        '<div><label style="' + _bLbl + '">抄送给</label>' +
          '<div id="bf-cc-wrap" style="margin-top:2px"></div></div>' +
      '</div>' +
    '</div>' +
    '<div style="' + _bCard + '">' +
      '<div style="' + _bCardHd + '">状态与进度</div>' +
      '<div style="' + _bGrid2 + '">' +
        '<div><label style="' + _bLbl + '">严重程度 *</label><select class="search-inp" id="bf-severity" style="' + inp + '">' +
          '<option value="">请选择...</option><option value="1">1-致命</option><option value="2">2-严重</option><option value="3" selected>3-一般</option><option value="4">4-建议</option></select>' +
          '<div id="bf-severity-hint" style="display:none;font-size:10px;color:var(--danger);margin-top:1px">请选择严重程度</div></div>' +
        '<div><label style="' + _bLbl + '">优先级</label><select class="search-inp" id="bf-priority" style="' + inp + '">' +
          '<option value="low">低</option><option value="medium" selected>中</option><option value="high">高</option><option value="critical">紧急</option></select></div>' +
        '<div><label style="' + _bLbl + '">类型</label><select class="search-inp" id="bf-type" onchange="_bugTypeChanged(this.value)" style="' + inp + '">' +
          '<option value="codeerror">代码错误</option><option value="design">设计缺陷</option><option value="security">安全问题</option><option value="performance">性能问题</option><option value="repair">维修</option><option value="other">其他</option></select></div>' +
        '<div><label style="' + _bLbl + '">状态</label><select class="search-inp" id="bf-status" style="' + inp + '">' +
          '<option value="open">待确认</option><option value="in_progress">处理中</option><option value="resolved">已解决</option><option value="closed">已关闭</option></select></div>' +
        '<div><label style="' + _bLbl + '">预估工时(h)</label>' +
          '<input class="search-inp" id="bf-estimate" type="number" step="0.5" value="' + (t.estimate_hours || '') + '" style="' + inp + '"></div>' +
        '<div><label style="' + _bLbl + '">进度(%)</label>' +
          '<input class="search-inp" id="bf-progress" type="number" min="0" max="100" step="5" value="' + (t.progress || 0) + '" style="' + inp + '"></div>' +
      '</div>' +
      '<div id="bf-boards-row" style="display:none;margin-top:8px">' +
        '<label style="' + _bLbl + '">产品编号 * <span style="font-size:10px;color:var(--muted)">(维修类 Bug 必填，关联板卡将进入维修中)</span></label>' +
        '<div style="margin-top:2px">' +
          '<div style="position:relative">' +
            '<input class="search-inp" id="bf-boards-input" placeholder="搜索产品编号..." onfocus="_bugBoardDropdown(true)" oninput="_bugBoardDropdown(true)" onblur="setTimeout(function(){_bugBoardDropdown(false)},150)" style="' + inp + '">' +
            '<div id="bf-boards-drop" style="display:none;position:absolute;z-index:50;top:100%;left:0;right:0;max-height:180px;overflow-y:auto;background:var(--surface);border:1px solid var(--border);border-radius:7px;margin-top:2px;box-shadow:0 4px 16px rgba(0,0,0,0.12)"></div>' +
          '</div>' +
          '<div id="bf-boards-tags" style="margin-top:6px;display:flex;flex-wrap:wrap;gap:6px"></div>' +
          '<div id="bf-boards-hint" style="display:none;font-size:10px;color:var(--danger);margin-top:3px">维修类 Bug 必须至少关联一块板卡</div>' +
          '<div id="bf-boards-empty" style="display:none;font-size:10px;color:var(--warn);margin-top:3px">该项目暂无板卡，请先在 项目详情>交付记录 录入板卡</div>' +
        '</div>' +
      '</div>' +
    '</div>' +
  '</div>';

  // ── Section 2: 描述 ──
  bodyHtml += '<div style="' + _bCard + ';margin-top:10px">' +
    '<div style="display:flex;align-items:center;justify-content:space-between">' +
      '<div><span style="' + _bCardHd + ';margin-bottom:0">描述</span>' +
      '<select class="search-inp" id="bf-desc-tpl" onchange="_bugApplyDescTemplate()" style="margin-left:12px;font-size:11px;padding:2px 6px">' +
        '<option value="">不使用模板</option></select></div>' +
    '</div>' +
    '<div style="margin-top:6px">' +
      '<textarea class="search-inp" id="bf-desc" rows="4" style="width:100%;min-height:80px;height:auto;max-height:30vh;box-sizing:border-box">' + escHtml(t.description || '') + '</textarea>' +
    '</div>' +
  '</div>';

  return bodyHtml;
}

/* ── 维修 Bug 产品编号多选（关联板卡 → 自动进入维修中） ── */

function _bugTypeChanged(type) {
  var row = document.getElementById('bf-boards-row');
  if (row) row.style.display = (type === 'repair') ? '' : 'none';
  if (type === 'repair') _bugBoardDropdown(true);
}

async function _bugLoadBoards() {
  if (!_bfProjId) { window._bfBoardCache = []; return; }
  try {
    var res = await API.get('/delivery/projects/' + _bfProjId + '/boards');
    window._bfBoardCache = (res && res.boards) || [];  // API.get 已解包 json.data → {boards, meta}
    _bugBoardRefreshTags();
    _bugBoardRefreshEmptyHint();
  } catch(e) { window._bfBoardCache = []; }
}

function _bugBoardProjectChanged(projId) {
  window._bfBoardIds = [];
  window._bfBoardCache = [];
  _bugBoardRefreshTags();
  if (projId) _bugLoadBoards();
}

function _bugBoardDropdown(show) {
  var drop = document.getElementById('bf-boards-drop');
  if (!drop) return;
  if (!show) { drop.style.display = 'none'; return; }
  if (!window._bfBoardCache || !window._bfBoardCache.length) {
    _bugLoadBoards().then(function() { _bugBoardRenderDrop(); });
    return;
  }
  _bugBoardRenderDrop();
}

function _bugBoardRenderDrop() {
  var drop = document.getElementById('bf-boards-drop');
  var input = document.getElementById('bf-boards-input');
  if (!drop) return;
  var kw = (input ? input.value : '').trim().toLowerCase();
  var sel = window._bfBoardIds || [];
  var list = (window._bfBoardCache || []).filter(function(b) {
    if (sel.indexOf(b.id) >= 0) return false;
    if (kw && String(b.serial_no).toLowerCase().indexOf(kw) < 0) return false;
    return true;
  });
  if (!list.length) {
    drop.innerHTML = '<div style="padding:8px 10px;font-size:11px;color:var(--muted)">' + (sel.length ? '已全部选择或暂无匹配' : '暂无板卡') + '</div>';
    drop.style.display = '';
    return;
  }
  drop.innerHTML = list.map(function(b) {
    return '<div style="padding:7px 10px;cursor:pointer;font-size:12px;display:flex;justify-content:space-between;gap:8px" onmousedown="event.preventDefault();_bugBoardPick(' + b.id + ',\'' + escHtml(String(b.serial_no)).replace(/'/g, "\\'") + '\')">' +
      '<span style="font-family:var(--mono)">' + escHtml(b.serial_no) + '</span>' +
      '<span style="color:var(--muted);font-size:10px">' + escHtml(b.status || '') + '</span>' +
    '</div>';
  }).join('');
  drop.style.display = '';
}

function _bugBoardPick(id) {
  if (!window._bfBoardIds) window._bfBoardIds = [];
  if (window._bfBoardIds.indexOf(id) >= 0) return;
  window._bfBoardIds.push(id);
  var input = document.getElementById('bf-boards-input');
  if (input) input.value = '';
  _bugBoardRefreshTags();
  _bugBoardRenderDrop();
}

function _bugBoardRemove(id) {
  window._bfBoardIds = (window._bfBoardIds || []).filter(function(x) { return x !== id; });
  _bugBoardRefreshTags();
  _bugBoardRenderDrop();
}

function _bugBoardRefreshTags() {
  var el = document.getElementById('bf-boards-tags');
  if (!el) return;
  var ids = window._bfBoardIds || [];
  var map = {};
  (window._bfBoardCache || []).forEach(function(b) { map[b.id] = b.serial_no; });
  el.innerHTML = ids.map(function(id) {
    var no = map[id] || ('#' + id);
    return '<span class="tag-badge tag-1" style="cursor:pointer" title="移除" onclick="_bugBoardRemove(' + id + ')">' + escHtml(no) + ' &times;</span>';
  }).join('');
  var hint = document.getElementById('bf-boards-hint');
  if (hint) hint.style.display = 'none';
}

function _bugBoardRefreshEmptyHint() {
  var row = document.getElementById('bf-boards-row');
  var empty = document.getElementById('bf-boards-empty');
  if (!row || !empty) return;
  empty.style.display = (row.style.display !== 'none' && !(window._bfBoardCache || []).length) ? '' : 'none';
}

function _showBugForm(b) {
  var isEdit = !!b; var t = b || {}; var ctx = window._bugPreFill || {};
  if (!isEdit) { if (ctx.product) t.product_id = ctx.product; if (ctx.project) t.project_id = ctx.project; }
  window._bfProdId = t.product_id || ctx.product || null;
  window._bfProjId = t.project_id || ctx.project || null;
  window._bfAsgnId = t.assignee_id || null;
  window._bfCcIds = (t.cc_user_ids || []).slice();
  window._bugPreFill = null;

  var bodyHtml = _buildBugForm(t, isEdit);

  bodyHtml = '<div style="max-height:75vh;overflow-y:auto;padding-right:4px">' + bodyHtml + '</div>';

  var title = isEdit ? '编辑Bug #'+t.id : '新建Bug';
  setTimeout(function() { initRichEditor('bf-desc', {height: 400}); }, 100);
  openDialog(title, bodyHtml, [
    {text:'取消',onclick:'closeSharedDialog()'},
    {text:isEdit?'保存':'创建',cls:'btn-primary',onclick:'_submitBug('+(t.id||'null')+')'}], {maxWidth:'80vw', maxHeight:'90vh'});

  _initBugFormSelectors(t, isEdit);
}

/** Initialize bug form selectors (product/project/assignee/cc/components/templates) after form is in DOM */
function _initBugFormSelectors(t, isEdit) {
  t = t || {};
  // Set form-scope state (avoid stale values from previous form)
  var ctx = window._bugPreFill || {};
  if (!isEdit) { if (ctx.product) t.product_id = ctx.product; if (ctx.project) t.project_id = ctx.project; }
  window._bfProdId = t.product_id || ctx.product || null;
  window._bfProjId = t.project_id || ctx.project || null;
  window._bfAsgnId = t.assignee_id || null;
  window._bfCcIds = (t.cc_user_ids || []).slice();
  window._bugPreFill = null;

  // Load bug description templates (independent of product selection)
  API.get('/product-doc-templates/bug-templates').then(function(btpls) {
    window._bfDescTemplates = btpls || [];
    var tplSel = document.getElementById('bf-desc-tpl');
    var defaultTpl = (btpls||[]).find(function(x) { return x.is_default; });
    if (tplSel) {
      tplSel.innerHTML = '<option value="">不使用模板</option>';
      (btpls||[]).forEach(function(x) { tplSel.innerHTML += '<option value="'+x.id+'">'+escHtml(x.name)+'</option>'; });
      if (defaultTpl && !isEdit) { tplSel.value = defaultTpl.id; _bugApplyDescTemplate(); }
    }
  });

  // 根据项目加载产品（单产品自动选中，多产品下拉选），并加载组件
  setTimeout(function() {
    if (_bfProjId) { _bugLoadProducts(_bfProjId); }
    else if (t.product_id) { _bugLoadComponents(); }
  }, 100);
  // Pre-fill project name for edit mode
  if (isEdit && t.project_id) {
    setTimeout(function() {
      var projName = (t.project_code ? '[' + t.project_code + '] ' : '') + (t.project_name || '');
      var pi = document.getElementById('bf-proj-input');
      if (pi && projName.trim()) pi.value = projName.trim();
    }, 100);
  }
  if (isEdit && t.severity) { setTimeout(function() { var s=document.getElementById('bf-severity'); if(s)s.value=t.severity; },100); }
  if (isEdit && t.priority) { setTimeout(function() { var s=document.getElementById('bf-priority'); if(s)s.value=t.priority; },100); }
  if (isEdit && t.type) { setTimeout(function() { var s=document.getElementById('bf-type'); if(s)s.value=t.type; },100); }
  if (isEdit && t.status) { setTimeout(function() { var s=document.getElementById('bf-status'); if(s)s.value=t.status; },100); }
  if (isEdit && t.component_id) { setTimeout(function() { var s=document.getElementById('bf-component'); if(s)s.value=t.component_id; },200); }
  // 维修 Bug 板卡多选：初始化选中 + 按类型显隐 + 加载项目板卡
  window._bfBoardIds = (t.board_ids || []).slice();
  window._bfBoardCache = [];
  setTimeout(function() {
    var bt = document.getElementById('bf-type');
    if (bt) _bugTypeChanged(bt.value);
    if (_bfProjId) _bugLoadBoards();
  }, 250);

  // Create user combo + CC selector
  setTimeout(function() {
    var wrap = document.getElementById('bf-assignee-wrap');
    if (wrap) wrap.innerHTML = createUserCombo({comboId:'bf-assignee',inputId:'bf-assignee-input',dropdownId:'bf-assignee-drop',
      selectedIdFn:function(){return t.assignee_id||null;},
      onSelect:function(u){window._bfAsgnId=u.id;}});
    // CC selector
    var ccWrap = document.getElementById('bf-cc-wrap');
    if (ccWrap) {
      ccWrap.innerHTML = createCcSelector({
        containerId: 'bf-cc',
        selectedIds: (t.cc_user_ids || []).slice(),
        placeholder: '搜索抄送人...',
        onChange: function(ids) { window._bfCcIds = ids; }
      });
      setTimeout(function() { _renderCcTags('bf-cc'); }, 150);
    }
    // Pre-fill assignee name for edit mode
    if (isEdit && t.assignee_name) {
      var ai = document.getElementById('bf-assignee-input');
      if (ai) ai.value = t.assignee_name;
    }
  }, 80);
}

function _bugLoadProducts(projectId) {
  // 根据项目加载关联产品：单产品自动选中；多产品让用户选择（保留仍有效的已选值）
  var pid = projectId || _bfProjId;
  if (!pid) return;
  API.get('/projects/' + pid + '/products').then(function(products) {
    var inp = document.getElementById('bf-prod-input');
    if (!inp) return;
    products = products || [];
    var prevVal = _bfProdId;
    if (!products.length) {
      _bfProdId = null;
      inp.value = '';
      _bugFillComponents([]);
      return;
    }
    if (products.length === 1) {
      _bfProdId = products[0].id;
      inp.value = (products[0].code ? products[0].code + ' ' : '') + (products[0].name || '');
      _bugLoadComponents();
      return;
    }
    var kept = products.some(function(p) { return String(p.id) === String(prevVal); });
    _bfProdId = kept ? prevVal : null;
    if (!kept) inp.value = '';
  }).catch(function() {});
}

function _bugLoadProjects(productId) {
  // 根据产品反查关联项目：单项目自动选中；多项目清空让用户从关联列表选
  API.get('/products/' + productId + '/projects').then(function(projects) {
    projects = projects || [];
    if (projects.length === 1) {
      var p = projects[0];
      _bfProjId = p.id;
      var pi = document.getElementById('bf-proj-input');
      if (pi) pi.value = (p.code ? p.code + ' ' : '') + (p.name || '');
    } else if (projects.length > 1) {
      var kept = projects.some(function(p) { return String(p.id) === String(_bfProjId); });
      if (!kept) {
        _bfProjId = null;
        var pi2 = document.getElementById('bf-proj-input');
        if (pi2) pi2.value = '';
      }
    }
  }).catch(function() {});
}

function _bugLoadComponents() {
  if (!_bfProdId) { _bugFillComponents([]); return; }
  API.get("/product-management/products/" + _bfProdId + "/node").then(function(r) {
    var nodeId = (r && r.node_id) ? r.node_id : null;
    if (nodeId) {
      API.get("/product-doc-templates/templates/" + nodeId).then(function(tpls) {
        window._bfAllTemplates = (tpls||[]).filter(function(t, i, arr) {
          return arr.findIndex(function(x) { return x.doc_name === t.doc_name; }) === i;
        });
        _bugFillComponents(window._bfAllTemplates);
      }).catch(function() { _bugFillComponents([]); });
    } else { _bugFillComponents([]); }
  }).catch(function() { _bugFillComponents([]); });
}
function _bugFillComponents(tpls) {
  var sel = document.getElementById('bf-component'); if (!sel) return;
  sel.innerHTML = '<option value="">选择组件...</option>';
  (tpls||[]).forEach(function(t) { sel.innerHTML += '<option value="'+t.id+'">'+escHtml(t.doc_name)+'</option>'; });
}

// DEPRECATED: HugeRTE is WYSIWYG, no preview toggle needed
function _bugToggleMdPreview() {}

function _bugApplyDescTemplate() {
  var tplSel = document.getElementById('bf-desc-tpl');
  var descEl = document.getElementById('bf-desc');
  if (!tplSel || !descEl) return;
  var tplId = tplSel.value;
  var tpls = window._bfDescTemplates || [];
  var t = tpls.find(function(x) { return x.id == tplId; });
  // 未选择模板（不使用模板）或模板不存在 → 清空内容
  var content = t ? (t.content || '') : '';
  // bf-desc 已被 HugeRTE 接管：直接写 textarea.value 不会反映到编辑器，
  // 需同步调用编辑器 API 更新可见内容（markdownToHtml 兼容 Markdown/HTML 模板）。
  var ed = (typeof hugerte !== 'undefined') ? hugerte.get('bf-desc') : null;
  if (ed) {
    ed.setContent(content ? markdownToHtml(content) : '');
    descEl.value = ed.getContent();
  } else {
    descEl.value = content;
  }
}

async function _submitBug(bugId) {
  // Clear hints
  ['bf-title-hint','bf-prod-hint','bf-proj-hint','bf-assignee-hint','bf-severity-hint','bf-boards-hint'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.style.display = 'none';
  });
  var valid = true;
  var title = document.getElementById('bf-title').value.trim();
  if (!title) { var h = document.getElementById('bf-title-hint'); if (h) h.style.display = ''; valid = false; }
  var pid = _bfProdId || 0;
  if (!pid) { var h = document.getElementById('bf-prod-hint'); if (h) h.style.display = ''; valid = false; }
  var projId = _bfProjId || 0;
  if (!projId) { var h = document.getElementById('bf-proj-hint'); if (h) h.style.display = ''; valid = false; }
  var asgnId = window._bfAsgnId || null;
  if (!asgnId) { var h = document.getElementById('bf-assignee-hint'); if (h) h.style.display = ''; valid = false; }
  var sev = parseInt(document.getElementById('bf-severity').value) || 0;
  if (!sev) { var h = document.getElementById('bf-severity-hint'); if (h) h.style.display = ''; valid = false; }
  var bugType = document.getElementById('bf-type').value;
  if (bugType === 'repair' && (!window._bfBoardIds || !window._bfBoardIds.length)) {
    var h = document.getElementById('bf-boards-hint'); if (h) h.style.display = ''; valid = false;
  }
  if (!valid) return;

  var desc = document.getElementById('bf-desc').value.trim();
  var payload = {
    title:title, product_id:pid,
    description:desc,
    project_id:projId,
    component_id:parseInt(document.getElementById('bf-component').value)||null,
    severity:sev,
    priority:document.getElementById('bf-priority').value,
    type:bugType,
    status:document.getElementById('bf-status').value,
    estimate_hours:parseFloat(document.getElementById('bf-estimate').value)||0,
    assignee_id:asgnId,
    progress: parseInt(document.getElementById('bf-progress').value) || 0,
    cc_user_ids:(window._bfCcIds && window._bfCcIds.length) ? window._bfCcIds : null,
    board_ids:(window._bfBoardIds && window._bfBoardIds.length) ? window._bfBoardIds.slice() : null,
  };
  try {
    var result;
    if (bugId) result = await API.put('/bugs/'+bugId, payload);
    else result = await API.post('/bugs', payload);
    var newId = bugId || (result && result.id);
    // Upload pending files and replace (待上传) placeholders with real URLs
    var pending = window._bfPendingFiles || [];
    window._bfPendingFiles = [];
    var desc = payload.description || '';
    for (var i = 0; i < pending.length; i++) {
      try {
        var att = await uploadAttachment(newId, pending[i]);
        var url = att.url || '/api/attachments/' + att.id;
        desc = desc.replace('src="待上传" alt="' + pending[i].name + '"', 'src="' + url + '" alt="' + pending[i].name + '"');
      } catch(e) {}
    }
    // Update description with real URLs
    if (desc !== payload.description && newId) {
      await API.put('/bugs/' + newId, {description: desc});
    }
    showToast(bugId?'已更新':'已创建','success');
    closeSharedDialog();
    EventBus.emit('bug:saved', {bugId: bugId || (result && result.id)});
  } catch(e) { showToast('操作失败: '+(e.message||''),'error'); }
}

/* ── Worklog ── */

function openBugWorklogDialog(bugId) {
  var today = fmtLocalDate();
  var rowHtml = _bwlBuildRow(0, today);
  var html = '<div>' +
    '<div style="display:flex;gap:10px;align-items:center;border:1px solid transparent;padding:0 10px;margin-bottom:4px;font-size:13px;color:var(--muted);font-weight:600;text-align:center">' +
      '<span style="width:155px;flex-shrink:0">日期</span>' +
      '<span style="flex:1;min-width:120px">工作内容</span>' +
      '<span style="width:60px;flex-shrink:0">工时</span>' +
      '<span style="width:80px;flex-shrink:0">占比</span>' +
      '<span style="width:80px;flex-shrink:0">进度</span>' +
      '<span style="width:80px;flex-shrink:0">可用剩余</span>' +
      '<span style="width:32px;flex-shrink:0"></span>' +
    '</div>' +
    '<div id="bwl-rows">' + rowHtml + '</div>' +
    '<div style="text-align:center;margin-top:8px">' +
      '<button class="btn btn-sm" onclick="_bwlAddRow()">+ 添加一行</button>' +
    '</div>' +
    '<input type="hidden" id="bwl-row-count" value="1">' +
  '</div>';
  
  openDialog('记录工时', html, [
    {text:'取消',onclick:'closeSharedDialog()'},
    {text:'提交',cls:'btn-primary',onclick:'_submitBatchBugWorklog('+bugId+')'}], {maxWidth: '80vw'});

  // Auto-load available percentage for default row
  setTimeout(function() { _bwlOnDateChange(0); }, 100);
}

function _bwlBuildRow(idx, defaultDate) {
  return '<div class="bwl-row" data-idx="' + idx + '" style="border:1px solid var(--border);border-radius:8px;padding:8px 10px;margin-bottom:6px">' +
    '<div style="display:flex;gap:10px;align-items:center">' +
      '<input class="search-inp" id="bwl-date-' + idx + '" type="date" value="' + defaultDate + '" style="width:155px;box-sizing:border-box;font-size:15px;flex-shrink:0" onchange="_bwlOnDateChange(' + idx + ')">' +
      '<input class="search-inp" id="bwl-desc-' + idx + '" placeholder="工作内容" style="flex:1;min-width:120px;box-sizing:border-box;font-size:15px">' +
      '<div style="width:60px;flex-shrink:0;text-align:center;font-size:16px;font-weight:600;color:var(--fg)"><span id="bwl-hours-' + idx + '">2.0</span><span style="font-size:14px;color:var(--muted);font-weight:400">h</span></div>' +
      '<div id="bwl-pct-ring-' + idx + '" style="width:80px;flex-shrink:0;cursor:pointer;text-align:center" onclick="_bwlShowPctSlider(' + idx + ')" title="点击调整占比">' +
        _bwlProgressRing(25, 38, 'var(--accent)') +
      '</div>' +
      '<div id="bwl-pct-slider-' + idx + '" style="display:none;flex-shrink:0;align-items:center;gap:4px;width:130px">' +
        '<input type="range" id="bwl-pct-' + idx + '" min="5" max="100" step="1" value="25" style="flex:1" oninput="_bwlPctSliderInput(' + idx + ')" onblur="_bwlHidePctSlider(' + idx + ')">' +
        '<span id="bwl-pct-slider-val-' + idx + '" style="font-size:13px;font-weight:600;color:var(--accent);min-width:38px;text-align:right">25%</span>' +
      '</div>' +
      '<div id="bwl-prog-ring-' + idx + '" style="width:80px;flex-shrink:0;cursor:pointer;text-align:center" onclick="_bwlShowProgSlider(' + idx + ')" title="点击调整进度">' +
        _bwlProgressRing(0, 38, 'var(--success)') +
      '</div>' +
      '<div id="bwl-prog-slider-' + idx + '" style="display:none;flex-shrink:0;align-items:center;gap:4px;width:130px">' +
        '<input type="range" id="bwl-prog-' + idx + '" min="0" max="100" step="5" value="0" style="flex:1" oninput="_bwlProgSliderInput(' + idx + ')" onblur="_bwlHideProgSlider(' + idx + ')">' +
        '<span id="bwl-prog-slider-val-' + idx + '" style="font-size:13px;font-weight:600;color:var(--success);min-width:38px;text-align:right">0%</span>' +
      '</div>' +
      '<span id="bwl-avail-' + idx + '" style="width:80px;flex-shrink:0;font-size:14px;color:var(--success);text-align:center">可用 100%</span>' +
      '<span style="width:32px;flex-shrink:0;text-align:center">' + iconDelete('_bwlRemoveRow(' + idx + ')', '删除此行') + '</span>' +
    '</div>' +
  '</div>';
}

function _bwlAddRow() { var c=parseInt(document.getElementById('bwl-row-count').value)||1; var lastDate=fmtLocalDate(); var rows=document.querySelectorAll('#bwl-rows .bwl-row'); if(rows.length>0){var li=rows[rows.length-1].getAttribute('data-idx');var ld=document.getElementById('bwl-date-'+li);if(ld&&ld.value){var d=new Date(ld.value+'T00:00:00');d.setDate(d.getDate()-1);lastDate=fmtLocalDate(d);}} var r=_bwlBuildRow(c,lastDate); document.getElementById('bwl-rows').insertAdjacentHTML('beforeend',r); document.getElementById('bwl-row-count').value=c+1; setTimeout(function(){_bwlOnDateChange(c);},50); }
function _bwlRemoveRow(idx) { var rowsEl=document.getElementById('bwl-rows'); var rows=rowsEl.querySelectorAll('.bwl-row'); if(rows.length<=1){showToast('至少保留1行','warn');return;} var t=rowsEl.querySelector('.bwl-row[data-idx="'+idx+'"]'); if(t)t.remove(); document.getElementById('bwl-row-count').value=rows.length-1; _bwlCheckOverPct(); }

function _bwlProgressRing(pct, size, color) {
  var r = (size - 4) / 2;
  var circ = 2 * Math.PI * r;
  var dash = circ * pct / 100;
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
    '<circle cx="' + (size/2) + '" cy="' + (size/2) + '" r="' + r + '" fill="none" stroke="var(--border)" stroke-width="3"/>' +
    '<circle cx="' + (size/2) + '" cy="' + (size/2) + '" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="3"' +
    ' stroke-dasharray="' + dash + ' ' + (circ - dash) + '" stroke-linecap="round" transform="rotate(-90 ' + (size/2) + ' ' + (size/2) + ')"/>' +
    '<text x="' + (size/2) + '" y="' + (size/2) + '" text-anchor="middle" dominant-baseline="central" font-size="' + (size*0.32) + '" font-weight="600" fill="var(--fg)">' + pct + '%</text></svg>';
}

var _bwlSavedPct = {};
var _bwlCheckinHours = {};

// ── Inline ring ↔ slider toggle ──
function _bwlShowPctSlider(idx) { document.getElementById('bwl-pct-ring-'+idx).style.display='none'; var s=document.getElementById('bwl-pct-slider-'+idx); s.style.display=''; var inp=s.querySelector('input'); if(inp)inp.focus(); }
function _bwlHidePctSlider(idx) { setTimeout(function(){ document.getElementById('bwl-pct-slider-'+idx).style.display='none'; document.getElementById('bwl-pct-ring-'+idx).style.display=''; },150); }
function _bwlShowProgSlider(idx) { document.getElementById('bwl-prog-ring-'+idx).style.display='none'; var s=document.getElementById('bwl-prog-slider-'+idx); s.style.display=''; var inp=s.querySelector('input'); if(inp)inp.focus(); }
function _bwlHideProgSlider(idx) { setTimeout(function(){ document.getElementById('bwl-prog-slider-'+idx).style.display='none'; document.getElementById('bwl-prog-ring-'+idx).style.display=''; },150); }

function _bwlOnDateChange(idx) {
  var d = document.getElementById('bwl-date-' + idx).value; if (!d) return;
  var user = getCurrentUser(); var uid = user ? user.id : '';
  Promise.all([
    API.get('/worklogs/daily-usage?date=' + d),
    API.get('/wecom/calendar?user_id=' + uid + '&date_from=' + d + '&date_to=' + d)
  ]).then(function(results) {
    var usage = results[0] || {}, wecom = results[1] || {};
    var remaining = usage.remaining_percentage !== undefined ? usage.remaining_percentage : 100;
    var weDay = (wecom.daily && wecom.daily.length) ? wecom.daily[0] : null;
    var checkinH = weDay ? (weDay.total_hours || 0) : 0;
    _bwlSavedPct[d] = usage.total_percentage_used || 0; _bwlCheckinHours[d] = checkinH;
    // 当日企微口径未定型/缺失提示（Issue #9）：无基准日按8h暂计待核正 / 当天未打下班卡自动核算
    _wlRenderRowIncompleteHint(document.querySelector('#bwl-rows .bwl-row[data-idx="' + idx + '"]'), _wlDayIsIncomplete(weDay, d));
    var av = document.getElementById('bwl-avail-' + idx);
    if (av) { av.textContent = '可用 ' + remaining + '%'; av.style.color = remaining > 0 ? 'var(--success)' : 'var(--danger)'; }
    var pctEl = document.getElementById('bwl-pct-' + idx);
    if (remaining <= 0) {
      var ringEl = document.getElementById('bwl-pct-ring-' + idx);
      if (ringEl) ringEl.innerHTML = '<span style="font-size:15px;color:var(--muted)">-</span>';
      var hoursEl = document.getElementById('bwl-hours-' + idx);
      if (hoursEl) hoursEl.textContent = '-';
    } else if (pctEl) {
      pctEl.max = Math.max(5, remaining);
      if (parseInt(pctEl.value) > remaining) pctEl.value = Math.max(5, remaining);
      _bwlUpdatePctRing(idx);
    }
    _bwlCheckOverPct();
  }).catch(function(){});
}

function _bwlPctSliderInput(idx) {
  var pct = parseInt(document.getElementById('bwl-pct-' + idx).value) || 25;
  var d = document.getElementById('bwl-date-' + idx).value;
  var checkinH = _bwlCheckinHours[d] || 8;
  document.getElementById('bwl-hours-' + idx).textContent = (pct / 100 * checkinH).toFixed(1);
  var valEl = document.getElementById('bwl-pct-slider-val-' + idx);
  if (valEl) valEl.textContent = pct + '%';
  _bwlUpdatePctRing(idx); _bwlCheckOverPct();
}

function _bwlUpdatePctRing(idx) {
  var pct = parseInt(document.getElementById('bwl-pct-' + idx).value) || 25;
  document.getElementById('bwl-pct-ring-' + idx).innerHTML = _bwlProgressRing(pct, 32, 'var(--accent)');
}

function _bwlProgSliderInput(idx) {
  var prog = parseInt(document.getElementById('bwl-prog-' + idx).value) || 0;
  var valEl = document.getElementById('bwl-prog-slider-val-' + idx);
  if (valEl) valEl.textContent = prog + '%';
  document.getElementById('bwl-prog-ring-' + idx).innerHTML = _bwlProgressRing(prog, 32, 'var(--success)');
}

function _bwlCheckOverPct() {
  var rows = document.querySelectorAll('#bwl-rows .bwl-row'); var dialogPcts = {}; var overflow = false;
  rows.forEach(function(r) { var i=r.getAttribute('data-idx'); var de=document.getElementById('bwl-date-'+i); var pe=document.getElementById('bwl-pct-'+i); if(de&&pe){dialogPcts[de.value]=(dialogPcts[de.value]||0)+(parseInt(pe.value)||0);} });
  rows.forEach(function(r) { var i=r.getAttribute('data-idx'); var de=document.getElementById('bwl-date-'+i); var pe=document.getElementById('bwl-pct-'+i); var ae=document.getElementById('bwl-avail-'+i); if(de&&pe&&ae){var d=de.value;var saved=_bwlSavedPct[d]||0;var total=saved+(dialogPcts[d]||0);if(total>100){pe.style.outline='2px solid var(--danger)';ae.textContent='超'+(total-100).toFixed(0)+'%';ae.style.color='var(--danger)';ae.style.fontWeight='600';overflow=true;}else{pe.style.outline='';}} });
  var sb = document.querySelector('.dialog-actions .btn-primary'); if(sb) sb.disabled = overflow;
}

function _bwlCloseConfirm() {
  var d = document.querySelector('.bwl-submit-confirm-overlay');
  if (d) d.remove();
}

async function _submitBatchBugWorklog(bugId) {
  var rows = document.querySelectorAll('#bwl-rows .bwl-row'); var entries = []; var maxP=0; var hasErr=false;
  rows.forEach(function(r) {
    var i = r.getAttribute('data-idx');
    var de=document.getElementById('bwl-date-'+i), pe=document.getElementById('bwl-pct-'+i), te=document.getElementById('bwl-desc-'+i), ge=document.getElementById('bwl-prog-'+i);
    var d=de?de.value:'', p=pe?parseInt(pe.value)||0:0, t=te?te.value.trim():'', g=ge?parseInt(ge.value)||0:0;
    if(!d){if(de)de.style.outline='2px solid var(--danger)';hasErr=true;}else{if(de)de.style.outline='';}
    if(!t){if(te)te.style.outline='2px solid var(--danger)';hasErr=true;}else{if(te)te.style.outline='';}
    if(d&&p>=5&&t){entries.push({date:d,percentage:p,description:t,progress:g});}
    if(g>maxP)maxP=g;
  });
  if(hasErr){showToast('请填写所有行的日期和描述','warn');return;}
  if(!entries.length){showToast('至少需要一行有效记录','warn');return;}
  _bwlCheckOverPct(); var sb=document.querySelector('.dialog-actions .btn-primary'); if(sb&&sb.disabled){showToast('日期工时占比超过100%','error');return;}

  // 100% progress confirmation
  if (maxP >= 100) {
    openDialog('确认提交工时',
      '<div style="font-size:13px;margin-bottom:8px">进度 <b>100%</b>，Bug将自动标记为<b>已解决</b>。</div>' +
      '<div style="font-size:11px;color:var(--muted)">确认后将保存 ' + entries.length + ' 条工时记录。</div>',
      [{text:'取消', onclick:'_bwlCloseConfirm()'},{text:'确认',cls:'btn-primary',onclick:async function(){
        var d = document.querySelector('.bwl-submit-confirm-overlay'); if (d) d.remove();
        closeSharedDialog();
        await API.post('/bugs/'+bugId+'/worklogs/batch',{entries:entries});
        if(maxP>=100) await API.put('/bugs/'+bugId,{progress:100,status:'resolved'});
        showToast('已记录 '+entries.length+' 条工时','success');
        _refreshBugDetailContent(bugId);
        EventBus.emit('worklog:saved',{bugId:bugId});
      }}],{hideClose:true,keepExisting:true,overlayClass:'bwl-submit-confirm-overlay'});
    return;
  }

  try {
    await API.post('/bugs/'+bugId+'/worklogs/batch',{entries:entries});
    if (maxP > 0) {
      API.get('/bugs/'+bugId).then(function(bug) { if(maxP>(bug.progress||0)) API.put('/bugs/'+bugId,{progress:maxP}); });
    }
    showToast('已记录 '+entries.length+' 条工时','success');
    closeSharedDialog(); _refreshBugDetailContent(bugId);
    EventBus.emit('worklog:saved',{bugId:bugId});
  } catch(e) { showToast('记录失败: '+(e.message||''),'error'); }
}

function _renderBugWorklogTable(logs, bugId) {
  if (!logs||!logs.length) return '<div style="color:var(--muted);font-size:12px">暂无工时记录</div>';
  return '<div id="bug-worklog-table-'+bugId+'"></div>';
}
function _initBugWorklogDt(logs, bugId) {
  var container = document.getElementById('bug-worklog-table-'+bugId);
  if (!container) return;
  new DataTable({
    container: container,
    columns: [
      { key: 'date', title: '日期', width: '68px', minWidth: 100, render: function(v) { return '<span style="font-size:11px">'+(v||'?')+'</span>'; } },
      { key: 'user', title: '用户', width: '44px', minWidth: 90, render: function(v, row) { return '<span style="font-size:11px">'+escHtml(getDisplayName(v||row.username||''))+'</span>'; } },
      { key: 'percentage', title: '占比', width: '42px', minWidth: 42, render: function(v) { return v ? '<span style="font-weight:600;color:var(--accent)">'+v+'%</span>' : '<span style="color:var(--muted)">—</span>'; } },
      { key: 'calculated_hours', title: '工时(h)', width: '52px', minWidth: 52, render: function(v, row) { var h = v || row.hours || 0; return (h||0).toFixed(1); } },
      { key: 'description', title: '描述', align: 'left', render: function(v) { return '<span style="white-space:normal;word-break:break-word">'+renderMarkdown(v||'')+'</span>'; } },
      { key: 'actions', title: '', width: '90px', minWidth: 90, render: function(v, row) { return iconEdit('openBugWorklogEditDialog('+bugId+','+row.id+')')+iconDelete('deleteBugWorklog('+bugId+','+row.id+')'); } }
    ],
    data: logs,
  });
}

function openBugWorklogEditDialog(bugId, wlId) {
  API.get('/bugs/'+bugId+'/worklogs').then(function(logs) {
    var w = (logs||[]).find(function(l){return l.id===wlId;});
    if (!w) { showToast('未找到工时记录','error'); return; }
    editWorklogEntry({
      id: w.id, task_id: null, bug_id: bugId,
      percentage: w.percentage, calculated_hours: w.calculated_hours,
      hours: w.hours, description: w.description, progress: 0,
      source: 'bug'
    }, w.date || '');
  });
}

async function _submitBugWorklogEdit(bugId, wlId) {
  var h = parseFloat(document.getElementById('bwl-hours').value);
  if (!h||h<=0) { showToast('请输入有效的工时数','error'); return; }
  try {
    await API.put('/bugs/'+bugId+'/worklogs/'+wlId, {hours:h, date:document.getElementById('bwl-date').value, description:document.getElementById('bwl-desc').value.trim()});
    showToast('工时已更新','success');
    closeSharedDialog();
    _refreshBugDetailContent(bugId);
  } catch(e) { showToast('编辑失败: '+(e.message||''),'error'); }
}

async function deleteBugWorklog(bugId, wlId) {
  if (!confirm('确定删除该工时记录？')) return;
  try {
    await API.del('/bugs/'+bugId+'/worklogs/'+wlId);
    showToast('已删除','success');
    _refreshBugDetailContent(bugId);
    EventBus.emit('worklog:deleted', {bugId: bugId});
  } catch(e) { showToast('删除失败: '+(e.message||''),'error'); }
}

/* ── Analysis ── */

function openBugAnalysisDialog(bugId) {
  var html = '<div>' +
    '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">标题 <span style="color:var(--danger)">*</span></label>' +
      '<input class="search-inp" id="ba-title" placeholder="请输入分析标题" style="width:100%;box-sizing:border-box;margin-top:2px"></div>' +
    '<div><label style="font-size:11px;color:var(--muted)">正文（可选，支持富文本与图片粘贴）</label>' +
      '<textarea class="search-inp" id="ba-content" rows="5" style="width:100%;box-sizing:border-box;margin-top:4px;resize:vertical"></textarea></div>' +
  '</div>';
  openDialog('添加分析记录', html, [
    {text:'取消',onclick:'closeSharedDialog()'},
    {text:'提交',cls:'btn-primary',onclick:'_submitBugAnalysis('+bugId+')'}], {maxWidth: '80vw', maxHeight: '80vh'});
  setTimeout(function() { initRichEditor('ba-content', {height: 300}); }, 100);
}

async function _submitBugAnalysis(bugId) {
  var title = (document.getElementById('ba-title') || {}).value || '';
  var c = (document.getElementById('ba-content') || {}).value || '';
  if (!title.trim()) { showToast('请输入分析标题','error'); return; }
  try {
    await API.post('/bugs/'+bugId+'/analysis', {bug_id:bugId, title:title.trim(), content:c});
    showToast('分析已添加','success');
    closeSharedDialog();
    _refreshBugDetailContent(bugId);
  } catch(e) { showToast('提交失败: '+(e.message||''),'error'); }
}

/** Open a rich-text dialog to edit one's own analysis record (author-only). */
function openBugAnalysisEditDialog(bugId, aid) {
  var cached = (window._analysisEditCache || {})[aid] || {title:'', content:''};
  var html = '<div>' +
    '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">标题 <span style="color:var(--danger)">*</span></label>' +
      '<input class="search-inp" id="ba-edit-title" placeholder="请输入分析标题" value="' + escHtml(cached.title) + '" style="width:100%;box-sizing:border-box;margin-top:2px"></div>' +
    '<div><label style="font-size:11px;color:var(--muted)">正文（可选，支持富文本与图片粘贴）</label>' +
      '<textarea class="search-inp" id="ba-edit-content" rows="5" style="width:100%;box-sizing:border-box;margin-top:4px;resize:vertical">' + escHtml(cached.content) + '</textarea></div>' +
  '</div>';
  openDialog('编辑分析记录', html, [
    {text:'取消',onclick:'closeSharedDialog()'},
    {text:'保存',cls:'btn-primary',onclick:'_submitBugAnalysisEdit('+bugId+','+aid+')'}], {maxWidth: '80vw', maxHeight: '80vh'});
  setTimeout(function() { initRichEditor('ba-edit-content', {height: 300}); }, 100);
}

async function _submitBugAnalysisEdit(bugId, aid) {
  var title = (document.getElementById('ba-edit-title') || {}).value || '';
  var c = (document.getElementById('ba-edit-content') || {}).value || '';
  if (!title.trim()) { showToast('请输入分析标题','error'); return; }
  try {
    await API.put('/bugs/'+bugId+'/analysis/'+aid, {title: title.trim(), content: c});
    showToast('分析已更新','success');
    closeSharedDialog();
    _refreshBugDetailContent(bugId);
  } catch(e) { showToast('更新失败: '+(e.message||''),'error'); }
}

/** Soft-delete one's own analysis record (content stays, shown with strikethrough). */
async function _deleteBugAnalysis(bugId, aid) {
  if (!confirm('确认删除该分析记录？删除后内容将以删除线显示。')) return;
  try {
    await API.del('/bugs/' + bugId + '/analysis/' + aid);
    showToast('分析已删除', 'success');
    _refreshBugDetailContent(bugId);
  } catch(e) {
    showToast('删除失败: ' + (e.message || ''), 'error');
  }
}

function _loadBugAnalyses(bugId) {
  API.get('/bugs/'+bugId).then(function(d) {
    var el = document.getElementById('bv-analyses');
    if (!el) return;
    var analyses = d.analyses || [];
    // 与历史记录一致：默认最新优先（desc），可通过头部按钮切换为最早优先
    if (_timelineOrder === 'desc') {
      analyses = analyses.slice().reverse();
    }
    // 标题显示数量（类似工时日志）
    var card = el.closest('.card');
    var titleEl = card ? card.querySelector('.section-title') : null;
    if (titleEl) titleEl.textContent = '分析记录 (' + analyses.length + ')';
    // 导航标签同步数量
    if (typeof updateDetailToc === 'function') updateDetailToc();
    if (!analyses.length) { el.innerHTML = '<div style="color:var(--muted);font-size:12px">暂无分析记录</div>'; return; }
    // 时间线效果：默认显示标题，正文折叠
    var h = '<div style="position:relative;padding-left:24px">' +
      '<div style="position:absolute;left:6px;top:8px;bottom:8px;width:2px;background:var(--border);border-radius:1px"></div>';
    analyses.forEach(function(a) {
      var userHtml = a.username ? ' · ' + escHtml(getDisplayName(a.display_name || a.username)) : '';
      var time = (a.created_at ? fmtISODateTime(a.created_at) : '') || '';
      var title = (a.title && a.title.trim()) ? a.title.trim() : ('分析 #' + a.id);
      var deleted = !!(a.is_deleted);
      // 仅作者本人可编辑/删除自己的分析记录（已删除的不能再操作）
      var me = getCurrentUser();
      var isMine = !!(me && me.id && a.user_id && me.id === a.user_id) && !deleted;
      if (isMine) {
        window._analysisEditCache = window._analysisEditCache || {};
        window._analysisEditCache[a.id] = {title: a.title || '', content: a.content || ''};
      }
      var actBtns = '';
      if (isMine) {
        actBtns = iconEdit('openBugAnalysisEditDialog(' + bugId + ',' + a.id + ')', '编辑分析') +
          iconDelete('_deleteBugAnalysis(' + bugId + ',' + a.id + ')', '删除分析');
      }
      var deletedTag = deleted ? '<span style="color:var(--muted);font-size:10px;border:1px solid var(--border);border-radius:4px;padding:0 5px">已删除</span>' : '';
      var titleStyle = deleted ? 'font-weight:600;color:var(--muted);text-decoration:line-through' : 'font-weight:600;color:var(--fg)';
      var dotColor = deleted ? 'var(--border)' : 'var(--accent)';
      var bodyStyle = deleted ? 'font-size:13px;line-height:1.6;margin-top:4px;color:var(--muted);text-decoration:line-through' : 'font-size:13px;line-height:1.6;margin-top:4px';
      // 正文可选：空正文不显示"查看正文"折叠块
      var hasContent = !!(a.content && a.content.trim() && a.content !== '<p></p>' && a.content !== '<p><br></p>');
      var bodyHtml = hasContent
        ? '<details style="margin-top:4px">' +
            '<summary style="cursor:pointer;font-size:11px;color:var(--accent);user-select:none">查看正文</summary>' +
            '<div class="markdown-body" style="' + bodyStyle + '">' + renderMarkdown(a.content || '') + '</div>' +
          '</details>'
        : '<div style="margin-top:4px;font-size:11px;color:var(--muted)">（无正文）</div>';
      h += '<div style="position:relative;padding:4px 0 12px 0">' +
        '<span style="position:absolute;left:-24px;top:4px;width:14px;height:14px;border-radius:50%;background:var(--surface);border:2px solid ' + dotColor + ';box-sizing:border-box;z-index:1"></span>' +
        '<div style="display:flex;align-items:baseline;gap:6px;font-size:12px;flex-wrap:wrap">' +
          '<span style="' + titleStyle + '">' + escHtml(title) + '</span>' +
          '<span style="color:var(--muted);font-size:10px">' + userHtml + ' ' + time + '</span>' +
          deletedTag + actBtns +
        '</div>' +
        bodyHtml +
      '</div>';
    });
    h += '</div>';
    el.innerHTML = h;
  });
}

/* ── Delete ── */

async function deleteBugById(id) {
  if (!confirm('确定删除此Bug？')) return;
  try { await API.del('/bugs/'+id); showToast('已删除','success'); EventBus.emit('bug:deleted', {}); }
  catch(e) { showToast('删除失败: '+(e.message||''),'error'); }
}

/* ── Helpers ── */

function _bugUploadAttach() {
  var inp = document.getElementById('bf-file-input');
  if (!inp || !inp.files.length) return;
  var bugId = null;
  window._bfPendingFiles = window._bfPendingFiles || [];
  for (var i = 0; i < inp.files.length; i++) {
    window._bfPendingFiles.push(inp.files[i]);
    var ta = document.getElementById('bf-desc');
    if (ta) ta.value += '\n📎 ' + inp.files[i].name + ' (待上传)\n';
  }
  inp.value = '';
}

async function _bugSubmitGitlab(bugId) {
  if (!confirm('将此Bug提交到GitLab创建Issue？\n\n需要仓库Reporter权限。')) return;
  try {
    var r = await API.post('/bugs/'+bugId+'/gitlab-submit');
    showToast('已提交到GitLab: ' + (r.gitlab_url||''), 'success');
    closeSharedDialog();
    EventBus.emit('bug:saved', {bugId: bugId});
  } catch(e) { showToast('提交失败: '+(e.message||''),'error'); }
}

function _bugDragStart(e, bugId) { e.dataTransfer.setData('text/plain', String(bugId)); }
async function _bugDragDrop(e, newStatus) {
  e.preventDefault();
  var bugId = parseInt(e.dataTransfer.getData('text/plain'));
  if (!bugId) return;
  try {
    await API.put('/bugs/'+bugId, {status: newStatus});
    EventBus.emit('bug:saved', {bugId: bugId});
    if (_bugViewMode === 'kanban') loadBugs();
  } catch(ex) { showToast('更新失败: '+(ex.message||''),'error'); }
}

function _renderSev(label, sev) {
  var c = {1:'var(--danger)',2:'var(--warn)',3:'var(--muted)',4:'var(--success)'};
  return '<span style="font-size:11px;color:'+(c[sev]||c[3])+';font-weight:600">'+label+'</span>';
}

/* ── Bug Detail Inline Edit (same pattern as tasks) ── */

function _bugIsAdmin() {
  // 仅 admin 角色/权限可编辑任意 bug（task_edit 不豁免——public 角色普遍带有 task_edit）
  var u = getCurrentUser();
  if (!u) return false;
  return u.role === 'admin' || (u.permissions || '').split(',').indexOf('admin') !== -1;
}

function _hasBugEditPerm() {
  return _bugIsAdmin();
}

function _bugCanEdit(bug) {
  // admin 或当前用户是创建人/负责人，才可编辑该 bug
  if (_bugIsAdmin()) return true;
  var u = getCurrentUser();
  if (!u) return false;
  return bug && (String(bug.reporter_id) === String(u.id) || String(bug.assignee_id) === String(u.id));
}

var _bugDetailCanEdit = false;  // 详情页当前 bug 的编辑权限（渲染时计算）

/* ── Bug Progress Edit (slider dialog — same as task page) ── */

function _openBugProgressInlineEdit(field) {
  var bugId = field.dataset.bugId;
  var currentPct = parseInt(field.dataset.currentValue) || 0;
  var html = _renderProgressSlider('bf-p', currentPct);
  openDialog('修改进度', html, [
    {text: '取消', onclick: 'closeSharedDialog()'},
    {text: '保存', cls: 'btn-primary', onclick: '_saveBugProgressInline(' + bugId + ')'}
  ], {maxWidth: 360});
}

async function _saveBugProgressInline(bugId) {
  var val = parseInt(document.getElementById('bf-p-slider').value) || 0;
  try {
    // 进度驱动状态自动更新（与行内编辑同一套 bug:before-save 规则）
    var statusEl = document.getElementById('bug-status-' + bugId);
    var data = {progress: val};
    var evt = {data: data, progress: val, status: statusEl ? statusEl.getAttribute('data-status') : 'open'};
    EventBus.emit('bug:before-save', evt);
    await API.put('/bugs/' + bugId, data);
    closeSharedDialog();
    showToast('进度已更新: ' + val + '%', 'success');
    EventBus.emit('bug:field-changed', {bugId: bugId, payload: data});
    _refreshBugDetailContent(bugId);
  } catch(e) { showToast('更新失败: ' + (e.message || ''), 'error'); }
}

function _buildBugEditableField(bugId, field, inputType, displayHtml, currentVal, opts, extraAttrs) {
  if (!_bugDetailCanEdit) return '<span>' + displayHtml + '</span>';
  var optsJson = opts ? encodeURIComponent(JSON.stringify(opts)) : '';
  var attrs = extraAttrs || '';
  if (inputType === 'number') {
    attrs += ' data-min="' + (opts && opts.min !== undefined ? opts.min : '') + '"';
    attrs += ' data-max="' + (opts && opts.max !== undefined ? opts.max : '') + '"';
    attrs += ' data-step="' + (opts && opts.step || '1') + '"';
  }
  return '<div class="editable-field" data-bug-id="' + bugId + '" data-field="' + field + '" data-input-type="' + inputType + '" data-current-value="' + escHtml(String(currentVal || '')) + '"' + (optsJson ? ' data-opts="' + optsJson + '"' : '') + attrs + ' onclick="event.stopPropagation();_startBugInlineEdit(this)">' +
    '<span class="ef-display">' + displayHtml + '</span>' +
  '</div>';
}

function _startBugInlineEdit(el) {
  if (!_bugDetailCanEdit) return;
  var field = el.closest('.editable-field') || el;
  if (!field || !field.classList.contains('editable-field') || field.classList.contains('editing')) return;

  var bugId = field.dataset.bugId;
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
    html += '<div style="display:flex;gap:10px;margin-top:6px"><button class="btn-xs ef-save-btn" onclick="event.stopPropagation();_saveBugInlineEdit(this)">✓</button><button class="btn-xs ef-cancel-btn" onclick="event.stopPropagation();_cancelBugInlineEdit(this)">✕</button></div>';
    field.innerHTML = html;
    var sel = field.querySelector('.ef-input');
    if (sel) { setTimeout(function() { sel.focus(); }, 50); }
  } else if (inputType === 'number') {
    if (fieldName === 'progress') {
      // 进度编辑统一采用任务页面的滑杆对话框
      _cancelBugInlineEdit(el);
      _openBugProgressInlineEdit(field);
      return;
    }
    var min = field.dataset.min || '';
    var max = field.dataset.max || '';
    var step = field.dataset.step || '1';
    field.innerHTML = '<input type="number" class="search-inp ef-input" value="' + escHtml(currentVal) + '" min="' + min + '" max="' + max + '" step="' + step + '" style="width:100%;box-sizing:border-box;font-size:13px;margin-top:1px">' +
      '<div style="display:flex;gap:10px;margin-top:6px"><button class="btn-xs ef-save-btn" onclick="event.stopPropagation();_saveBugInlineEdit(this)">✓</button><button class="btn-xs ef-cancel-btn" onclick="event.stopPropagation();_cancelBugInlineEdit(this)">✕</button></div>';
    var inp = field.querySelector('.ef-input');
    if (inp) { setTimeout(function() { inp.focus(); inp.select(); }, 50); }
    if (inp) { inp.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); _saveBugInlineEdit(inp); } if (e.key === 'Escape') { e.preventDefault(); _cancelBugInlineEdit(inp); } }); }
  } else if (inputType === 'text') {
    field.innerHTML = '<input type="text" class="search-inp ef-input" value="' + escHtml(currentVal) + '" style="width:100%;box-sizing:border-box;font-size:13px;margin-top:1px">' +
      '<div style="display:flex;gap:10px;margin-top:6px"><button class="btn-xs ef-save-btn" onclick="event.stopPropagation();_saveBugInlineEdit(this)">✓</button><button class="btn-xs ef-cancel-btn" onclick="event.stopPropagation();_cancelBugInlineEdit(this)">✕</button></div>';
    var inp = field.querySelector('.ef-input');
    if (inp) { setTimeout(function() { inp.focus(); inp.select(); }, 50); }
    if (inp) { inp.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); _saveBugInlineEdit(inp); } if (e.key === 'Escape') { e.preventDefault(); _cancelBugInlineEdit(inp); } }); }
  } else if (inputType === 'textarea') {
    var taId = 'bug-ta-' + bugId + '-' + fieldName;
    field.innerHTML = '<textarea class="search-inp ef-input" id="' + taId + '" rows="4" style="width:100%;box-sizing:border-box;font-size:13px;margin-top:1px;resize:vertical">' + escHtml(currentVal) + '</textarea>' +
      '<div id="' + taId + '-img-preview" style="margin-top:4px;min-height:0;max-height:30vh;overflow-y:auto"></div>' +
      '<div style="font-size:10px;color:var(--muted);margin-top:2px">支持粘贴图片 (Ctrl+V)</div>' +
      '<div style="display:flex;gap:10px;margin-top:6px"><button class="btn-xs ef-save-btn" onclick="event.stopPropagation();_saveBugInlineEdit(this)">✓</button><button class="btn-xs ef-cancel-btn" onclick="event.stopPropagation();_cancelBugInlineEdit(this)">✕</button></div>';
    var inp = field.querySelector('.ef-input');
    if (inp) { setTimeout(function() { inp.focus(); }, 50); }
    setTimeout(function() { initRichEditor(taId, {height: 300}); }, 100);
  } else if (inputType === 'user-select') {
    if (!window._allUsers || !window._allUsers.length) {
      field.innerHTML = '<span style="font-size:12px;color:var(--muted)">加载用户列表...</span>';
      (typeof loadAllUsers === 'function' ? loadAllUsers() : Promise.resolve()).then(function() {
        _renderBugUserSelect(field, currentVal);
      });
      return;
    }
    _renderBugUserSelect(field, currentVal);
  } else if (inputType === 'component-select') {
    var prodId = field.dataset.productId;
    field.innerHTML = '<span style="font-size:12px;color:var(--muted)">加载组件...</span>';
    _loadBugComponentsForEdit(prodId).then(function(comps) {
      var opts = comps.map(function(c) { return {v: String(c.id), l: c.doc_name}; });
      opts.unshift({v: '', l: '无'});
      field.dataset.opts = encodeURIComponent(JSON.stringify(opts));
      field.dataset.inputType = 'select';
      field.classList.remove('editing');
      _startBugInlineEdit(field);
    }).catch(function() {
      field.innerHTML = '<span style="font-size:12px;color:var(--danger)">加载失败</span>';
    });
    return;
  } else if (inputType === 'cc-select') {
    if (!window._allUsers || !window._allUsers.length) {
      field.innerHTML = '<span style="font-size:12px;color:var(--muted)">加载用户列表...</span>';
      (typeof loadAllUsers === 'function' ? loadAllUsers() : Promise.resolve()).then(function() {
        _renderBugCcEdit(field, currentVal);
      });
      return;
    }
    _renderBugCcEdit(field, currentVal);
    return;
  }
}

function _renderBugUserSelect(field, currentVal) {
  field.classList.add('editing');
  var html = '<select class="search-inp ef-input" style="width:100%;box-sizing:border-box;font-size:13px;margin-top:1px"><option value="">未分配</option>';
  (_allUsers || []).forEach(function(u) {
    html += '<option value="' + u.id + '"' + (String(u.id) === String(currentVal) ? ' selected' : '') + '>' + escHtml(u.name) + '</option>';
  });
  html += '</select>';
  html += '<div style="display:flex;gap:10px;margin-top:6px"><button class="btn-xs ef-save-btn" onclick="event.stopPropagation();_saveBugInlineEdit(this)">✓</button><button class="btn-xs ef-cancel-btn" onclick="event.stopPropagation();_cancelBugInlineEdit(this)">✕</button></div>';
  field.innerHTML = html;
  var sel = field.querySelector('.ef-input');
  if (sel) { setTimeout(function() { sel.focus(); }, 50); }
}

async function _loadBugComponentsForEdit(prodId) {
  // Load components for a product
  if (!prodId) return [];
  try {
    var r = await API.get('/product-management/products/' + prodId + '/node');
    var nodeId = (r && r.node_id) ? r.node_id : null;
    if (!nodeId) return [];
    var tpls = await API.get('/product-doc-templates/templates/' + nodeId);
    // Dedupe by doc_name
    var seen = {};
    return (tpls || []).filter(function(t) {
      if (seen[t.doc_name]) return false;
      seen[t.doc_name] = true;
      return true;
    });
  } catch(e) { return []; }
}

function _renderBugCcEdit(field, currentVal) {
  field.classList.add('editing');
  var ccIds = [];
  try { ccIds = JSON.parse(currentVal); } catch(e) { ccIds = []; }
  if (!Array.isArray(ccIds)) ccIds = [];
  // Store for modification
  window._bugCcEditIds = ccIds.slice();
  var html = '<div id="bug-cc-tags" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px"></div>' +
    '<select class="search-inp ef-input" id="bug-cc-select" style="width:100%;box-sizing:border-box;font-size:13px;margin-top:1px" onchange="_bugCcAdd(this.value)"><option value="">添加抄送人...</option>';
  (_allUsers || []).forEach(function(u) {
    if (window._bugCcEditIds.indexOf(u.id) < 0) {
      html += '<option value="' + u.id + '">' + escHtml(u.name) + '</option>';
    }
  });
  html += '</select>';
  html += '<div style="display:flex;gap:10px;margin-top:6px"><button class="btn-xs ef-save-btn" onclick="event.stopPropagation();_bugCcSave(this)">✓</button><button class="btn-xs ef-cancel-btn" onclick="event.stopPropagation();_cancelBugInlineEdit(this)">✕</button></div>';
  field.innerHTML = html;
  _bugCcRenderTags();
}

function _bugCcRenderTags() {
  var el = document.getElementById('bug-cc-tags');
  if (!el) return;
  var ids = window._bugCcEditIds || [];
  var html = '';
  ids.forEach(function(uid) {
    var u = (_allUsers || []).find(function(x) { return x.id == uid; });
    var name = u ? u.name : ('#' + uid);
    html += '<span style="display:inline-flex;align-items:center;gap:2px;background:var(--accent);color:#fff;padding:1px 6px;border-radius:10px;font-size:11px">' + escHtml(name) +
      '<button onclick="event.stopPropagation();_bugCcRemove(' + uid + ')" style="background:none;border:none;color:inherit;cursor:pointer;padding:0;margin-left:2px;font-size:13px;line-height:1;opacity:0.7">×</button></span>';
  });
  el.innerHTML = html;
  // Refresh select options
  var sel = document.getElementById('bug-cc-select');
  if (sel) {
    sel.innerHTML = '<option value="">添加抄送人...</option>';
    (_allUsers || []).forEach(function(u) {
      if (ids.indexOf(u.id) < 0) {
        sel.innerHTML += '<option value="' + u.id + '">' + escHtml(u.name) + '</option>';
      }
    });
  }
}

function _bugCcAdd(uid) {
  uid = parseInt(uid);
  if (!uid || (window._bugCcEditIds || []).indexOf(uid) >= 0) return;
  window._bugCcEditIds.push(uid);
  _bugCcRenderTags();
}

function _bugCcRemove(uid) {
  var ids = window._bugCcEditIds || [];
  var idx = ids.indexOf(uid);
  if (idx >= 0) ids.splice(idx, 1);
  _bugCcRenderTags();
}

function _bugCcSave(el) {
  var field = el.closest('.editable-field');
  if (!field) return;
  var bugId = field.dataset.bugId;
  var ids = window._bugCcEditIds || [];
  var data = { cc_user_ids: ids.length ? ids : null };
  _doSaveBugFieldEdit(bugId, data, field);
}

async function _saveBugInlineEdit(el) {
  var field = el.closest('.editable-field');
  if (!field) return;
  var bugId = field.dataset.bugId;
  var fieldName = field.dataset.field;
  var inputType = field.dataset.inputType;
  var input = field.querySelector('.ef-input');
  if (!input) return;
  var newVal = input.value;
  var currentVal = field.dataset.currentValue || '';

  if (newVal === currentVal && inputType !== 'textarea') {
    _cancelBugInlineEdit(el);
    return;
  }

  // Upload pasted images for textarea fields
  // HugeRTE editor syncs content to textarea automatically; no upload needed

  var data = {};
  if (inputType === 'number') {
    data[fieldName] = newVal === '' ? null : (parseInt(newVal) || 0);
  } else if (fieldName === 'assignee_id' || fieldName === 'component_id') {
    data[fieldName] = newVal === '' ? null : parseInt(newVal) || null;
  } else if (fieldName === 'estimate_hours') {
    data[fieldName] = newVal === '' ? null : (parseFloat(newVal) || 0);
  } else if (fieldName === 'severity') {
    data[fieldName] = parseInt(newVal) || 3;
  } else {
    data[fieldName] = newVal;
  }

  // 进度驱动状态自动更新（状态不可手动改，只能由进度自动更新）
  if (fieldName === 'progress') {
    var statusEl = document.getElementById('bug-status-' + bugId);
    var evt = {data: data, progress: parseInt(newVal) || 0, status: statusEl ? statusEl.getAttribute('data-status') : 'open'};
    EventBus.emit('bug:before-save', evt);
  }

  _doSaveBugFieldEdit(bugId, data, field);
}

async function _doSaveBugFieldEdit(bugId, data, field) {
  try {
    await API.put('/bugs/' + bugId, data);
    EventBus.emit('bug:field-changed', {bugId: bugId, payload: data});
    showToast('已更新','success');
    // Refresh the full-page detail (body + worklogs + comments + analyses)
    _refreshBugDetailContent(bugId);
  } catch(e) { showToast('更新失败: '+(e.message||''),'error'); _cancelBugInlineEdit(field); }
}

function _cancelBugInlineEdit(el) {
  var field = el.closest('.editable-field');
  if (!field) return;
  if (field._originalHTML) field.innerHTML = field._originalHTML;
  field.classList.remove('editing');
}
