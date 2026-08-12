/* PMA Bug Tracking System */
var _bugFilterProduct = null;

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
var _bugKanbanMode = false;
var _bfProjId = null;

/* ── Init & Render ── */

function initBugs() {
  var c = document.getElementById('view-bugs');
  if (!c) return;
  c.innerHTML = '<div style="display:flex;height:100%">' +
    '<div style="width:260px;flex-shrink:0;padding:16px;border-right:1px solid var(--border);overflow-y:auto" id="bug-sidebar"></div>' +
    '<div style="flex:1;display:flex;flex-direction:column;min-width:0">' +
      '<div class="section-hd" style="padding:12px 16px;border-bottom:1px solid var(--border)">' +
        '<span style="font-weight:600;font-size:15px">Bug 管理</span>' +
        '<div style="display:flex;gap:8px">' +
          '<button class="btn-sm" id="bug-view-list" onclick="switchBugView(\'list\')" style="background:var(--accent);color:#fff">列表</button>' +
          '<button class="btn-sm" id="bug-view-kanban" onclick="switchBugView(\'kanban\')">看板</button>' +
          '<button class="btn btn-primary" style="font-size:11px;padding:3px 10px" onclick="openBugDialog()">+ 新建Bug</button>' +
        '</div>' +
      '</div>' +
      '<div id="bug-content" style="flex:1;overflow:auto;padding:16px">加载中...</div>' +
    '</div>' +
  '</div>';
  _renderBugSidebar();
  loadBugs();
}

function switchBugView(mode) {
  _bugKanbanMode = (mode === 'kanban');
  if (_bugKanbanMode) _bugDt = null;
  document.getElementById('bug-view-list').style.background = mode==='list' ? 'var(--accent)' : '';
  document.getElementById('bug-view-list').style.color = mode==='list' ? '#fff' : '';
  document.getElementById('bug-view-kanban').style.background = mode==='kanban' ? 'var(--accent)' : '';
  document.getElementById('bug-view-kanban').style.color = mode==='kanban' ? '#fff' : '';
  loadBugs();
}

/* ── Sidebar Filters ── */

async function _renderBugSidebar() {
  var el = document.getElementById('bug-sidebar');
  if (!el) return;
  var html = '<div style="font-size:11px;color:var(--muted);margin-bottom:4px">产品</div>';
  try {
    var prods = await API.get('/products?limit=200');
    var items = (prods && prods.items) ? prods.items : (prods || []);
    html += '<select class="search-inp" id="bug-filter-prod" onchange="_bugFilterProduct=this.value;loadBugs()" style="width:100%;margin-bottom:14px">' +
      '<option value="">全部产品</option>';
    items.forEach(function(p) {
      html += '<option value="' + p.id + '">' + escHtml(p.code || p.name) + '</option>';
    });
    html += '</select>';
  } catch(e) { html += '<div class="error-state">加载产品失败</div>'; }

  html += '<div style="font-size:11px;color:var(--muted);margin-bottom:4px">状态</div>' +
    '<div style="display:flex;flex-direction:column;gap:3px;margin-bottom:14px">' +
    ['','open','in_progress','resolved','closed'].map(function(s) {
      return '<button class="btn-sm" onclick="_bugFilterStatus=\''+s+'\';loadBugs()" style="text-align:left;font-size:11px;padding:4px 8px' +
        (_bugFilterStatus===s?';background:var(--accent);color:#fff':'') + '">' + (s||'全部') + '</button>';
    }).join('') + '</div>';

  // Show my bugs only
  html += '<button class="btn" onclick="_bugFilterAssignee=1;loadBugs()" style="font-size:11px;width:100%;margin-bottom:8px">我的Bug</button>';

  el.innerHTML = html;
}

/* ── Load & Render Bugs ── */

var _bugFilterAssignee = 0;

async function loadBugs() {
  var el = document.getElementById('bug-content');
  if (!el) return;
  el.innerHTML = '<div class="loading-spinner">加载中...</div>';
  try {
    var params = {};
    if (_bugFilterProduct) params.product_id = _bugFilterProduct;
    if (_bugFilterStatus) params.status = _bugFilterStatus;
    var url = _bugFilterAssignee ? '/bugs/my' : '/bugs';
    var bugs = await API.get(url + (_bugFilterAssignee ? '' : '?' + new URLSearchParams(params).toString()));
    bugs = bugs || [];
    if (_bugKanbanMode) _renderKanban(el, bugs);
    else _renderBugTable(el, bugs);
  } catch(e) {
    el.innerHTML = '<div class="error-state">加载失败: ' + escHtml(e.message) + '</div>';
  }
}

var _bugDt = null;

function _renderBugTable(container, bugs) {
  if (!bugs.length) { container.innerHTML = '<div class="empty-state">暂无Bug</div>'; _bugDt = null; return; }
  var sevs = {1:'致命',2:'严重',3:'一般',4:'建议'};
  if (!_bugDt) {
    container.innerHTML = '<div id="bug-table"></div>';
    _bugDt = new DataTable({
      container: document.getElementById('bug-table'),
      columns: [
        { key: 'id', title: '编号', width: '6%', minWidth: 75, render: function(v) { return '<span style="font-family:var(--mono);font-size:11px">#' + v + '</span>'; } },
        { key: 'title', title: '标题', align: 'left', minWidth: 100, render: function(v) { return '<span style="font-weight:530">'+escHtml(v||'')+'</span>'; } },
        { key: 'product_name', title: '产品', width: '9%', minWidth: 100, render: function(v) { return '<span style="font-size:12px">'+escHtml(v||'-')+'</span>'; } },
        { key: 'project_name', title: '项目', width: '9%', minWidth: 100, render: function(v) { return '<span style="font-size:12px">'+escHtml(v||'-')+'</span>'; } },
        { key: 'component_name', title: '组件', width: '8%', minWidth: 100, render: function(v) { return '<span style="font-size:11px">'+escHtml(v||'-')+'</span>'; } },
        { key: 'severity', title: '严重', width: '5%', minWidth: 60, render: function(v) { return _renderSev(sevs[v]||'一般', v); } },
        { key: 'priority', title: '优先级', width: '6%', minWidth: 65, render: function(v) { return renderPriorityBadge(v); } },
        { key: 'status', title: '状态', width: '7%', minWidth: 80, render: function(v) { return renderPill(v||'open'); } },
        { key: 'assignee_name', title: '负责人', width: '8%', minWidth: 90, render: function(v) { return '<span style="font-size:12px">'+escHtml(v||'-')+'</span>'; } },
        { key: 'actions', title: '操作', width: '90px', minWidth: 90, render: function(v, row) { return '<span onclick="event.stopPropagation()">'+iconEdit('openBugDialog('+row.id+')','编辑')+iconDelete('deleteBugById('+row.id+')','删除')+'</span>'; } }
      ],
    });
  }
  _bugDt.setData(bugs);
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
  var sevs = {1:'致命',2:'严重',3:'一般',4:'建议'};
  var sevColors = {1:'var(--danger)',2:'var(--warn)',3:'var(--accent)',4:'var(--muted)'};
  var projHtml = b.project_code ? projCodeTag(b.project_code, b.project_id, b.project_name) + ' ' + escHtml(b.project_name || '') : escHtml(b.project_name || '-');
  var typeLabel = {codeerror:'代码错误',design:'设计缺陷',security:'安全问题',performance:'性能问题',other:'其他'}[b.type]||b.type;

  var _STATUS_OPTS = [
    {v:'open',l:'待确认'},{v:'in_progress',l:'处理中'},
    {v:'resolved',l:'已解决'},{v:'closed',l:'已关闭'}];
  var _SEV_OPTS = [{v:'1',l:'1-致命'},{v:'2',l:'2-严重'},{v:'3',l:'3-一般'},{v:'4',l:'4-建议'}];
  var _PRIO_OPTS = [{v:'low',l:'低'},{v:'medium',l:'中'},{v:'high',l:'高'},{v:'critical',l:'紧急'}];
  var _TYPE_OPTS = [{v:'codeerror',l:'代码错误'},{v:'design',l:'设计缺陷'},{v:'security',l:'安全问题'},{v:'performance',l:'性能问题'},{v:'other',l:'其他'}];

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

  // ── Row 1: 基本信息 + 状态与进度 side by side ──
  html += '<div style="display:flex;gap:16px">' +
    // ── 基本信息 ──
    '<div class="card info-glass-card" style="flex:1;min-width:0;padding:20px">' +
      '<div class="section-hd"><span class="section-title">' + favStar('bug', b.id, {size: '18px'}) + ' 基本信息</span></div>' +
      '<div class="delivery-kpi" style="grid-template-columns:1fr 1fr">' +
        // Title (editable)
        '<div class="dkpi"><div class="dkpi-lbl">标题</div>' +
          _buildBugEditableField(b.id, 'title', 'text', '<span class="bd-val">' + escHtml(b.title || '—') + '</span>', b.title || '') + '</div>' +
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
        // Assignee (editable)
        '<div class="dkpi"><div class="dkpi-lbl">负责人</div>' +
          _buildBugEditableField(b.id, 'assignee_id', 'user-select', '<span class="bd-val">' + escHtml(b.assignee_name || '未分配') + '</span>', b.assignee_id || '') + '</div>' +
        // Reporter (read-only)
        '<div class="dkpi"><div class="dkpi-lbl">创建人</div><div class="bd-val">' + escHtml(b.reporter_name || '-') + '</div></div>' +
        // CC (editable)
        '<div class="dkpi" style="grid-column:1/-1"><div class="dkpi-lbl">抄送</div>' +
          _buildBugEditableField(b.id, 'cc_user_ids', 'cc-select',
            '<span class="bd-val">' + ((b.cc_user_names && b.cc_user_names.length) ? escHtml(b.cc_user_names.join(', ')) : '无') + '</span>',
            JSON.stringify(b.cc_user_ids || [])) + '</div>' +
      '</div>' +
    '</div>' +
    // ── 状态与进度 ──
    '<div class="card info-glass-card" style="flex:1;min-width:0;padding:20px">' +
      '<div class="section-hd"><span class="section-title">状态与进度</span></div>' +
      '<div class="delivery-kpi" style="grid-template-columns:1fr 1fr">' +
        // Status (read-only — changed via quick action buttons)
        '<div class="dkpi"><div class="dkpi-lbl">状态</div><div style="margin-top:6px">' + renderPill(b.status || 'open') + '</div></div>' +
        // Severity (editable)
        '<div class="dkpi"><div class="dkpi-lbl">严重程度</div><div style="margin-top:6px">' + _buildBugEditableField(b.id, 'severity', 'select',
          '<span style="font-size:13px;color:' + (sevColors[b.severity] || 'var(--muted)') + ';font-weight:500">' + (sevs[b.severity] || b.severity) + '</span>',
          String(b.severity || 3), _SEV_OPTS) + '</div></div>' +
        // Priority (editable)
        '<div class="dkpi"><div class="dkpi-lbl">优先级</div><div style="margin-top:6px">' + _buildBugEditableField(b.id, 'priority', 'select', renderPriorityBadge(b.priority || 'medium'), b.priority || 'medium', _PRIO_OPTS) + '</div></div>' +
        // Estimate (editable)
        '<div class="dkpi"><div class="dkpi-lbl">预估工时(h)</div>' +
          _buildBugEditableField(b.id, 'estimate_hours', 'number', '<span class="bd-val">' + (b.estimate_hours || 0).toFixed(1) + 'h</span>', String(b.estimate_hours || 0), {min:0,step:0.5}) + '</div>' +
        // Progress (editable)
        '<div class="dkpi"><div class="dkpi-lbl">进度(%)</div>' +
          _buildBugEditableField(b.id, 'progress', 'number', '<span class="bd-val">' + (b.progress || 0) + '%</span>', String(b.progress || 0), {min:0,max:100,step:5}) + '</div>' +
        // Resolution (editable — bug解决方式)
        '<div class="dkpi"><div class="dkpi-lbl">解决方式</div>' +
          _buildBugEditableField(b.id, 'resolution', 'select',
            '<span class="bd-val">' + ({resolved:'已解决',duplicate:'重复',wontfix:'不予解决',invalid:'无效',postponed:'延期处理'}[b.resolution] || b.resolution || '—') + '</span>',
            b.resolution || '', [{v:'',l:'—'},{v:'resolved',l:'已解决'},{v:'duplicate',l:'重复'},{v:'wontfix',l:'不予解决'},{v:'invalid',l:'无效'},{v:'postponed',l:'延期处理'}]) + '</div>' +
      '</div>' +
    '</div>' +
  '</div>';

  // ── Section 2: 描述 ──
  html += '<div class="card info-glass-card" style="margin-top:16px;padding:20px">' +
    '<div class="section-hd"><span class="section-title">描述</span></div>' +
    _buildBugEditableField(b.id, 'description', 'textarea',
      '<div class="markdown-body" style="font-size:13px;line-height:1.6;min-height:20px">' + (b.description ? renderMarkdown(b.description) : '<span style="color:var(--muted)">暂无描述，点击编辑</span>') + '</div>',
      b.description || '') +
  '</div>';

  // ── Section 3: 工时日志 ──
  html += '<div class="card info-glass-card" style="margin-top:16px;padding:20px">' +
    '<div class="section-hd"><span class="section-title">工时日志 (' + (b.consumed_hours || 0).toFixed(1) + 'h)</span>' +
      '<button class="btn btn-primary" style="font-size:11px;padding:3px 10px" onclick="openBugWorklogDialog(' + b.id + ')">+ 记录</button></div>' +
    '<div id="bv-worklogs" style="font-size:12px">加载中...</div>' +
  '</div>';

  // ── Section 4: 评论 ──
  html += '<div class="card info-glass-card" style="margin-top:16px;padding:20px">' +
    '<div class="section-hd"><span class="section-title">评论</span></div>' +
    '<div id="bug-detail-comments" style="margin-bottom:8px">加载中...</div>' +
    '<div style="display:flex;gap:8px">' +
      '<input class="search-inp" id="bug-comment-input" placeholder="添加评论..." style="flex:1">' +
      '<button class="btn-sm btn-primary" onclick="_submitBugComment(' + b.id + ')">发送</button>' +
    '</div>' +
  '</div>';

  // ── Section 5: 分析记录 ──
  html += '<div class="card info-glass-card" style="margin-top:16px;padding:20px">' +
    '<div class="section-hd"><span class="section-title">分析记录</span>' +
      '<button class="btn btn-primary" style="font-size:11px;padding:3px 10px" onclick="openBugAnalysisDialog(' + b.id + ')">+ 添加</button></div>' +
    '<div id="bv-analyses">加载中...</div>' +
  '</div>';

  return html;
}

async function openBugDetail(bugId) {
  var data = await API.get('/bugs/' + bugId);
  var b = data || {};

  var html = '<div class="bug-detail-body" style="max-height:75vh;overflow-y:auto;padding-right:4px">' +
    _renderBugDetailBody(b) +
  '</div>';

  var btns = [
    {text:'提交到GitLab',cls:'btn',onclick:'_bugSubmitGitlab('+bugId+')'},
    {text:'关闭',onclick:'closeSharedDialog()'}];
  openDialog('Bug #' + bugId, html, btns, {maxWidth: '80vw', maxHeight: '90vh'});
  // Scroll to top when dialog opens
  setTimeout(function() {
    var body = document.querySelector('.bug-detail-body');
    if (body) body.scrollTop = 0;
  }, 50);

  // Load worklogs + comments + analyses
  API.get('/bugs/'+bugId+'/worklogs').then(function(logs) {
    var el = document.getElementById('bv-worklogs');
    if (el) { el.innerHTML = _renderBugWorklogTable(logs||[], bugId); _initBugWorklogDt(logs||[], bugId); }
  });
  _loadBugComments(bugId);
  _loadBugAnalyses(bugId);
}

function _loadBugComments(bugId) {
  API.get('/bugs/' + bugId + '/comments').then(function(comments) {
    var el = document.getElementById('bug-detail-comments');
    if (!el) return;
    if (!comments || !comments.length) { el.innerHTML = '<div style="color:var(--muted);font-size:12px">暂无评论</div>'; return; }
    el.innerHTML = '<div id="bug-comments-table"></div>';
    new DataTable({
      container: document.getElementById('bug-comments-table'),
      columns: [
        { key: 'created_at', title: '时间', width: '130px', minWidth: 120, render: function(v) { return '<span style="font-size:10px;color:var(--muted);white-space:nowrap">'+(fmtISODateTime(v)||'')+'</span>'; } },
        { key: 'username', title: '用户', width: '80px', minWidth: 90, render: function(v) { return '<span style="font-size:12px">'+escHtml(v)+'</span>'; } },
        { key: 'content', title: '内容', align: 'left', render: function(v) { return '<span style="font-size:13px">'+escHtml(v||'')+'</span>'; } }
      ],
      data: comments,
    });
  }).catch(function() {});
}

function _submitBugComment(bugId) {
  var input = document.getElementById('bug-comment-input');
  if (!input || !input.value.trim()) return;
  API.post('/bugs/' + bugId + '/comments', {content: input.value.trim()}).then(function() {
    input.value = '';
    _loadBugComments(bugId);
  }).catch(function(e) { showToast('发送失败: ' + (e.message || ''), 'error'); });
}

/* ── Create/Edit Dialog ── */

function openBugDialog(bugId) {
  if (bugId) { openBugDetail(bugId); return; } // route edit to unified detail view
  _showBugForm(null);
}

function _showBugForm(b) {
  var isEdit = !!b; var t = b || {};
  // Accept pre-fill context from topbar quick-create (app.js sets _bugPreFill)
  var ctx = window._bugPreFill || {};
  if (!isEdit) {
    if (ctx.product) t.product_id = ctx.product;
    if (ctx.project) t.project_id = ctx.project;
  }
  window._bfProdId = t.product_id || ctx.product || null;
  window._bfProjId = t.project_id || ctx.project || null;
  window._bfAsgnId = t.assignee_id || null;
  window._bfCcIds = (t.cc_user_ids || []).slice();
  window._bugPreFill = null;  // consume once

  var inp = 'width:100%;box-sizing:border-box;margin-top:1px';
  var bodyHtml = '';

  // ── Row 1: 基本信息 + 状态与进度 side by side ──
  bodyHtml += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
    // ── 基本信息 Card ──
    '<div style="' + _bCard + '">' +
      '<div style="' + _bCardHd + '">基本信息</div>' +
      '<div style="margin-bottom:6px"><label style="' + _bLbl + '">标题 *</label>' +
        '<input class="search-inp" id="bf-title" value="' + escHtml(t.title || '') + '" placeholder="请填入Bug标题" style="' + inp + '">' +
        '<div id="bf-title-hint" style="display:none;font-size:10px;color:var(--danger);margin-top:1px">请填入Bug标题</div></div>' +
      '<div style="' + _bGrid2 + '">' +
        '<div><label style="' + _bLbl + '">产品 *</label>' +
          '<div style="margin-top:2px">' + createProductCombo({
            comboId: 'bf-prod', inputId: 'bf-prod-input', dropdownId: 'bf-prod-drop',
            placeholder: '搜索产品...',
            selectedIdFn: function() { return t.product_id || null; },
            onSelect: function(p) { _bfProdId = p.id; _bugLoadComponents(); }
          }) + '<div id="bf-prod-hint" style="display:none;font-size:10px;color:var(--danger);margin-top:1px">请选择产品</div></div></div>' +
        '<div><label style="' + _bLbl + '">项目 *</label>' +
          '<div style="margin-top:2px">' + createSearchCombo({
            comboId: 'bf-proj', inputId: 'bf-proj-input', dropdownId: 'bf-proj-drop',
            placeholder: '搜索项目...',
            dataSource: function() { return API.get('/products/' + (_bfProdId || 0) + '/projects').then(function(d) { return d || []; }).catch(function() { return []; }); },
            selectedIdFn: function() { return t.project_id || null; },
            onSelect: function(p) { _bfProjId = p.id; }
          }) + '<div id="bf-proj-hint" style="display:none;font-size:10px;color:var(--danger);margin-top:1px">请选择项目</div></div></div>' +
      '</div>' +
      '<div style="' + _bGrid2 + '">' +
        '<div><label style="' + _bLbl + '">组件</label><select class="search-inp" id="bf-component" style="' + inp + '"><option value="">选择组件...</option></select></div>' +
        '<div><label style="' + _bLbl + '">负责人 *</label><div id="bf-assignee-wrap" style="margin-top:2px"></div>' +
          '<div id="bf-assignee-hint" style="display:none;font-size:10px;color:var(--danger);margin-top:1px">请选择负责人</div></div>' +
      '</div>' +
      '<div style="margin-top:6px"><label style="' + _bLbl + '">抄送给</label>' +
        '<div id="bf-cc-wrap" style="margin-top:2px"></div></div>' +
    '</div>' +
    // ── 状态与进度 Card ──
    '<div style="' + _bCard + '">' +
      '<div style="' + _bCardHd + '">状态与进度</div>' +
      '<div style="' + _bGrid2 + '">' +
        '<div><label style="' + _bLbl + '">严重程度 *</label><select class="search-inp" id="bf-severity" style="' + inp + '">' +
          '<option value="">请选择...</option><option value="1">1-致命</option><option value="2">2-严重</option><option value="3" selected>3-一般</option><option value="4">4-建议</option></select>' +
          '<div id="bf-severity-hint" style="display:none;font-size:10px;color:var(--danger);margin-top:1px">请选择严重程度</div></div>' +
        '<div><label style="' + _bLbl + '">优先级</label><select class="search-inp" id="bf-priority" style="' + inp + '">' +
          '<option value="low">低</option><option value="medium" selected>中</option><option value="high">高</option><option value="critical">紧急</option></select></div>' +
        '<div><label style="' + _bLbl + '">类型</label><select class="search-inp" id="bf-type" style="' + inp + '">' +
          '<option value="codeerror">代码错误</option><option value="design">设计缺陷</option><option value="security">安全问题</option><option value="performance">性能问题</option><option value="other">其他</option></select></div>' +
        '<div><label style="' + _bLbl + '">状态</label><select class="search-inp" id="bf-status" style="' + inp + '">' +
          '<option value="open">待确认</option><option value="in_progress">处理中</option><option value="resolved">已解决</option><option value="closed">已关闭</option></select></div>' +
        '<div><label style="' + _bLbl + '">预估工时(h)</label>' +
          '<input class="search-inp" id="bf-estimate" type="number" step="0.5" value="' + (t.estimate_hours || '') + '" style="' + inp + '"></div>' +
        '<div><label style="' + _bLbl + '">进度(%)</label>' +
          '<input class="search-inp" id="bf-progress" type="number" min="0" max="100" step="5" value="' + (t.progress || 0) + '" style="' + inp + '"></div>' +
        '<div style="grid-column:1/-1"><label style="' + _bLbl + '">创建人</label><div style="' + inp + ';padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;font-size:13px;color:var(--fg)">' + escHtml(t.reporter_name || (function(){var u=getCurrentUser();return u?u.display_name||u.username:'—';})()) + '</div></div>' +
      '</div>' +
    '</div>' +
  '</div>';

  // ── Section 2: 描述 Card ──
  bodyHtml += '<div style="' + _bCard + ';margin-top:10px">' +
    '<div style="display:flex;align-items:center;justify-content:space-between">' +
      '<div><span style="' + _bCardHd + ';margin-bottom:0">描述 (Markdown)</span>' +
      '<select class="search-inp" id="bf-desc-tpl" onchange="_bugApplyDescTemplate()" style="margin-left:12px;font-size:11px;padding:2px 6px">' +
        '<option value="">不使用模板</option></select></div>' +
      '<button class="btn btn-xs" onclick="_bugToggleMdPreview()" style="font-size:10px;padding:1px 6px">预览</button>' +
    '</div>' +
    '<div style="margin-top:6px">' +
      '<textarea class="search-inp" id="bf-desc" rows="4" style="width:100%;min-height:80px;height:auto;max-height:30vh;box-sizing:border-box;resize:vertical">' + escHtml(t.description || '') + '</textarea>' +
    '</div>' +
    '<div id="bf-desc-preview" class="markdown-body" style="display:none;overflow-y:auto;padding:8px;border:1px solid var(--border);border-radius:6px;margin-top:6px;font-size:13px;max-height:30vh"></div>' +
    '<div style="font-size:10px;color:var(--muted);margin-top:4px">支持粘贴图片 (Ctrl+V)</div>' +
    '<div id="bf-desc-img-preview" style="margin-top:4px;min-height:0;max-height:50vh;overflow-y:auto"></div>' +
  '</div>';

  bodyHtml = '<div style="max-height:75vh;overflow-y:auto;padding-right:4px">' + bodyHtml + '</div>';

  var title = isEdit ? '编辑Bug #'+t.id : '新建Bug';
  _clearNoteImagePreviews('bf-desc-img-preview');
  setTimeout(function() { initNoteImagePaste('bf-desc'); }, 100);
  setTimeout(function() { _loadExistingNoteImages(t.description||'', 'bf-desc-img-preview'); }, 200);
  openDialog(title, bodyHtml, [
    {text:'取消',onclick:'closeSharedDialog()'},
    {text:isEdit?'保存':'创建',cls:'btn-primary',onclick:'_submitBug('+(t.id||'null')+')'}], {maxWidth:'80vw', maxHeight:'90vh'});

  // Load bug description templates (independent of product selection)
  API.get('/product-doc-templates/bug-templates').then(function(btpls) {
    window._bfDescTemplates = btpls || [];
    var tplSel = document.getElementById('bf-desc-tpl');
    var defaultTpl = (btpls||[]).find(function(t) { return t.is_default; });
    if (tplSel) {
      tplSel.innerHTML = '<option value="">不使用模板</option>';
      (btpls||[]).forEach(function(t) { tplSel.innerHTML += '<option value="'+t.id+'">'+escHtml(t.name)+'</option>'; });
      if (defaultTpl && !isEdit) { tplSel.value = defaultTpl.id; _bugApplyDescTemplate(); }
    }
  });

  // Pre-fill existing product name + load projects/components for edit mode
  if (t.product_id) {
    setTimeout(function() {
      API.get('/products?limit=200').then(function(data) {
        var items = (data && data.items) ? data.items : (data || []);
        var p = items.find(function(x) { return x.id == t.product_id; });
        var inp = document.getElementById('bf-prod-input');
        if (inp && p) inp.value = p.name;
      });
      _bugLoadComponents();
    }, 100);
  }
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

function _bugToggleMdPreview() {
  var ta = document.getElementById('bf-desc');
  var pv = document.getElementById('bf-desc-preview');
  var btn = event && event.target;
  if (!ta || !pv) return;
  if (pv.style.display === 'none') {
    pv.innerHTML = renderMarkdown(ta.value);
    pv.style.display = '';
    ta.style.display = 'none';
    if (btn) btn.textContent = '编辑';
  } else {
    pv.style.display = 'none';
    ta.style.display = '';
    if (btn) btn.textContent = '预览';
  }
}

function _bugApplyDescTemplate() {
  var tplSel = document.getElementById('bf-desc-tpl');
  var descEl = document.getElementById('bf-desc');
  if (!tplSel || !descEl) return;
  var tplId = tplSel.value;
  if (!tplId) return;
  var tpls = window._bfDescTemplates || [];
  var t = tpls.find(function(x) { return x.id == tplId; });
  if (t) descEl.value = t.content || '';
}

async function _submitBug(bugId) {
  // Clear hints
  ['bf-title-hint','bf-prod-hint','bf-proj-hint','bf-assignee-hint','bf-severity-hint'].forEach(function(id) {
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
  if (!valid) return;

  var desc = document.getElementById('bf-desc').value.trim();
  desc = await _uploadNoteImages(desc);
  var payload = {
    title:title, product_id:pid,
    description:desc,
    project_id:projId,
    component_id:parseInt(document.getElementById('bf-component').value)||null,
    severity:sev,
    priority:document.getElementById('bf-priority').value,
    type:document.getElementById('bf-type').value,
    status:document.getElementById('bf-status').value,
    estimate_hours:parseFloat(document.getElementById('bf-estimate').value)||0,
    assignee_id:asgnId,
    progress: parseInt(document.getElementById('bf-progress').value) || 0,
    cc_user_ids:(window._bfCcIds && window._bfCcIds.length) ? window._bfCcIds : null,
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
    {text:'取消',onclick:'closeSharedDialog();openBugDetail('+bugId+')'},
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
    var checkinH = (wecom.daily && wecom.daily[0]) ? wecom.daily[0].total_hours : 0;
    _bwlSavedPct[d] = usage.total_percentage_used || 0; _bwlCheckinHours[d] = checkinH;
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
      [{text:'取消'},{text:'确认',cls:'btn-primary',onclick:async function(){
        closeSharedDialog();
        await API.post('/bugs/'+bugId+'/worklogs/batch',{entries:entries});
        if(maxP>=100) await API.put('/bugs/'+bugId,{progress:100,status:'resolved'});
        showToast('已记录 '+entries.length+' 条工时','success');
        openBugDetail(bugId);
        EventBus.emit('worklog:saved',{bugId:bugId});
      }}],{hideClose:true,keepExisting:true});
    return;
  }

  try {
    await API.post('/bugs/'+bugId+'/worklogs/batch',{entries:entries});
    if (maxP > 0) {
      API.get('/bugs/'+bugId).then(function(bug) { if(maxP>(bug.progress||0)) API.put('/bugs/'+bugId,{progress:maxP}); });
    }
    showToast('已记录 '+entries.length+' 条工时','success');
    closeSharedDialog(); openBugDetail(bugId);
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
      { key: 'description', title: '描述', align: 'left', render: function(v) { return '<span style="white-space:normal;word-break:break-word">'+escHtml(v||'')+'</span>'; } },
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
    openBugDetail(bugId);
  } catch(e) { showToast('编辑失败: '+(e.message||''),'error'); }
}

async function deleteBugWorklog(bugId, wlId) {
  if (!confirm('确定删除该工时记录？')) return;
  try {
    await API.del('/bugs/'+bugId+'/worklogs/'+wlId);
    showToast('已删除','success');
    openBugDetail(bugId);
    EventBus.emit('worklog:deleted', {bugId: bugId});
  } catch(e) { showToast('删除失败: '+(e.message||''),'error'); }
}

/* ── Analysis ── */

function openBugAnalysisDialog(bugId) {
  var html = '<div><label style="font-size:11px;color:var(--muted)">分析内容（Markdown）</label>' +
    '<textarea class="search-inp" id="ba-content" rows="5" style="width:100%;box-sizing:border-box;margin-top:4px;resize:vertical"></textarea></div>';
  openDialog('添加分析记录', html, [
    {text:'取消',onclick:'closeSharedDialog();openBugDetail('+bugId+')'},
    {text:'提交',cls:'btn-primary',onclick:'_submitBugAnalysis('+bugId+')'}], {maxWidth:500});
}

async function _submitBugAnalysis(bugId) {
  var c = document.getElementById('ba-content').value.trim();
  if (!c) { showToast('请输入分析内容','error'); return; }
  try {
    await API.post('/bugs/'+bugId+'/analysis', {bug_id:bugId, content:c});
    showToast('分析已添加','success');
    closeSharedDialog();
    openBugDetail(bugId);
  } catch(e) { showToast('提交失败: '+(e.message||''),'error'); }
}

function _loadBugAnalyses(bugId) {
  API.get('/bugs/'+bugId).then(function(d) {
    var el = document.getElementById('bv-analyses');
    if (!el) return;
    var analyses = d.analyses || [];
    if (!analyses.length) { el.innerHTML = '<div style="color:var(--muted);font-size:12px">暂无分析记录</div>'; return; }
    var h = '';
    analyses.forEach(function(a) {
      var userHtml = a.username ? ' · ' + escHtml(getDisplayName(a.display_name || a.username)) : '';
      h += '<div style="border-left:2px solid var(--accent);padding:4px 0 8px 12px;margin-bottom:4px">' +
        '<div style="font-size:11px;color:var(--muted);margin-bottom:4px">'+(fmtISODateTime(a.created_at)||'?') + userHtml + '</div>' +
        '<div class="markdown-body" style="font-size:13px;line-height:1.6">'+renderMarkdown(a.content)+'</div></div>';
    });
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
  } catch(ex) { showToast('更新失败: '+(ex.message||''),'error'); }
}

function _renderSev(label, sev) {
  var c = {1:'var(--danger)',2:'var(--warn)',3:'var(--muted)',4:'var(--success)'};
  return '<span style="font-size:11px;color:'+(c[sev]||c[3])+';font-weight:600">'+label+'</span>';
}

/* ── Bug Detail Inline Edit (same pattern as tasks) ── */

function _hasBugEditPerm() {
  // Same perm check as tasks for now
  if (typeof _hasTaskEditPerm === 'function') return _hasTaskEditPerm();
  return true;
}

function _buildBugEditableField(bugId, field, inputType, displayHtml, currentVal, opts, extraAttrs) {
  if (!_hasBugEditPerm()) return '<span>' + displayHtml + '</span>';
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
  if (!_hasBugEditPerm()) return;
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
    setTimeout(function() { _clearNoteImagePreviews(taId + '-img-preview'); initNoteImagePaste(taId); _loadExistingNoteImages(currentVal, taId + '-img-preview'); }, 100);
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
  if (inputType === 'textarea' && typeof _uploadNoteImages === 'function') {
    newVal = await _uploadNoteImages(newVal);
  }

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

  // Bidirectional sync: progress <-> status (via EventBus, same as tasks)
  if (fieldName === 'progress' || fieldName === 'status') {
    var progressEl = document.querySelector('.bug-detail-body .editable-field[data-field="progress"]');
    var statusEl = document.querySelector('.bug-detail-body .editable-field[data-field="status"]');
    var progress = fieldName === 'progress' ? parseInt(newVal) || 0 : parseInt(progressEl ? progressEl.dataset.currentValue : 0) || 0;
    var status = fieldName === 'status' ? newVal : (statusEl ? statusEl.dataset.currentValue : 'open');
    var evt = {data: data, progress: progress, status: status};
    EventBus.emit('bug:before-save', evt);
  }

  _doSaveBugFieldEdit(bugId, data, field);
}

async function _doSaveBugFieldEdit(bugId, data, field) {
  try {
    await API.put('/bugs/' + bugId, data);
    EventBus.emit('bug:field-changed', {bugId: bugId, payload: data});
    // Refresh the detail view
    var fresh = await API.get('/bugs/' + bugId);
    if (fresh) {
      var bodyEl = document.querySelector('.bug-detail-body');
      if (bodyEl) bodyEl.innerHTML = _renderBugDetailBody(fresh);
    }
    showToast('已更新','success');
  } catch(e) { showToast('更新失败: '+(e.message||''),'error'); _cancelBugInlineEdit(field); }
}

function _cancelBugInlineEdit(el) {
  var field = el.closest('.editable-field');
  if (!field) return;
  if (field._originalHTML) field.innerHTML = field._originalHTML;
  field.classList.remove('editing');
}
