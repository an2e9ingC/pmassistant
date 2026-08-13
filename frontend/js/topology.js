/* ═══════════════════════════════════════════════════
   TOPOLOGY — Unified project-product-customer search
   Fuzzy search also matches bugs and tasks (/api/search)
═══════════════════════════════════════════════════ */

var _topoTimer = null;
var _fuzzyTimer = null;
var _topoDt = null;
var _topoBugDt = null;
var _topoTaskDt = null;

function _initTopoDt() {
  if (_topoDt) return;
  _topoDt = new DataTable({
    container: document.getElementById('topo-table'),
    columns: [
      { key: 'project_code', title: '项目编号', width: '10%', minWidth: 90, render: function(v, row) { return v ? projCodeTag(v, 'event.stopPropagation();openProject(\'' + escHtml(v).replace(/'/g, "\\'") + '\')', row.project_name) : '—'; } },
      { key: 'project_name', title: '项目名', minWidth: 100, render: function(v) { return '<div class="proj-name">' + escHtml(v || '') + '</div>'; } },
      { key: 'customer_name', title: '客户', width: '10%', minWidth: 110, render: function(v) { return '<span onclick="event.stopPropagation();openCustomerByName(\'' + escHtml(v || '') + '\')" style="cursor:pointer">' + renderCustomerBadge(v) + '</span>'; } },
      { key: 'products', title: '关联产品', render: function(v) {
        if (!v || !v.length) return '<span style="font-size:12px;color:var(--muted)">—</span>';
        return v.map(function(pr) { return '<button class="gs-btn gs-prod" onclick="event.stopPropagation();openProductDetail(\'' + escHtml(pr.code || pr.id) + '\')" style="margin:1px 2px;font-size:11px" title="' + escHtml(pr.name || '') + '">' + escHtml(pr.code || pr.name) + '</button>'; }).join('');
      }},
      { key: 'project_status', title: '状态', width: '10%', minWidth: 80, render: function(v) { return renderPill(v); } }
    ],
    maxHeight: 'calc(100vh - 260px)',
    emptyText: '输入关键字开始搜索...',
    clickable: false
  });
}

function _topoShowResult(items) {
  _initTopoDt();
  if (!_topoDt) return;
  if (!items || !items.length) {
    _topoDt.setData([]);
    return;
  }
  _topoDt.setData(items);
}

/* ── Bug / Task result sections (fuzzy search only) ── */

var _topoSevLabels = {1:'致命',2:'严重',3:'一般',4:'建议'};
var _topoSevColors = {1:'var(--danger)',2:'var(--warn)',3:'var(--accent)',4:'var(--muted)'};

function _openBug(id) { gotoView('bugs', { params: [String(id)] }); }
function _openTask(id) { gotoView('tasks', { params: [String(id)] }); }

function _topoShowBugs(bugs) {
  var section = document.getElementById('topo-bug-section');
  if (!section) return;
  if (!bugs || !bugs.length) { section.style.display = 'none'; return; }
  if (!_topoBugDt) {
    _topoBugDt = new DataTable({
      container: document.getElementById('topo-bug-table'),
      columns: [
        { key: 'id', title: '编号', width: '7%', minWidth: 70, render: function(v) { return '<span style="font-family:var(--mono);font-size:11px;cursor:pointer" onclick="_openBug(' + v + ')">#' + v + '</span>'; } },
        { key: 'title', title: '标题', align: 'left', minWidth: 120, render: function(v, row) { return '<span style="font-weight:530;cursor:pointer" onclick="_openBug(' + row.id + ')" title="查看Bug详情">' + escHtml(v || '') + '</span>'; } },
        { key: 'severity', title: '严重', width: '7%', minWidth: 70, render: function(v) { return '<span style="color:' + (_topoSevColors[v] || 'var(--muted)') + ';font-size:12px">' + (_topoSevLabels[v] || v || '—') + '</span>'; } },
        { key: 'status', title: '状态', width: '8%', minWidth: 80, render: function(v) { return renderPill(v || 'open'); } },
        { key: 'project_code', title: '项目', width: '10%', minWidth: 100, render: function(v, row) { return v ? '<span style="font-size:12px;cursor:pointer" title="' + escHtml(row.project_name || '') + '" onclick="event.stopPropagation();openProject(\'' + escHtml(v).replace(/'/g, "\\'") + '\')">' + escHtml(v) + '</span>' : '<span style="font-size:12px;color:var(--muted)">—</span>'; } },
        { key: 'assignee_name', title: '负责人', width: '9%', minWidth: 90, render: function(v) { return '<span style="font-size:12px">' + escHtml(v || '—') + '</span>'; } }
      ],
      maxHeight: '320px',
      emptyText: '无匹配 Bug',
      clickable: false
    });
  }
  _topoBugDt.setData(bugs);
  section.style.display = '';
}

function _topoShowTasks(tasks) {
  var section = document.getElementById('topo-task-section');
  if (!section) return;
  if (!tasks || !tasks.length) { section.style.display = 'none'; return; }
  if (!_topoTaskDt) {
    _topoTaskDt = new DataTable({
      container: document.getElementById('topo-task-table'),
      columns: [
        { key: 'id', title: '编号', width: '7%', minWidth: 70, render: function(v) { return '<span style="font-family:var(--mono);font-size:11px;cursor:pointer" onclick="_openTask(' + v + ')">#' + v + '</span>'; } },
        { key: 'title', title: '标题', align: 'left', minWidth: 120, render: function(v, row) { return '<span style="font-weight:530;cursor:pointer" onclick="_openTask(' + row.id + ')" title="查看任务详情">' + escHtml(v || '') + '</span>'; } },
        { key: 'status', title: '状态', width: '8%', minWidth: 80, render: function(v) { return renderPill(v || 'todo'); } },
        { key: 'priority', title: '优先级', width: '8%', minWidth: 80, render: function(v) { return renderPriorityBadge(v); } },
        { key: 'project_code', title: '项目', width: '10%', minWidth: 100, render: function(v, row) { return v ? '<span style="font-size:12px;cursor:pointer" title="' + escHtml(row.project_name || '') + '" onclick="event.stopPropagation();openProject(\'' + escHtml(v).replace(/'/g, "\\'") + '\')">' + escHtml(v) + '</span>' : '<span style="font-size:12px;color:var(--muted)">—</span>'; } },
        { key: 'assignee_name', title: '负责人', width: '9%', minWidth: 90, render: function(v) { return '<span style="font-size:12px">' + escHtml(v || '—') + '</span>'; } }
      ],
      maxHeight: '320px',
      emptyText: '无匹配任务',
      clickable: false
    });
  }
  _topoTaskDt.setData(tasks);
  section.style.display = '';
}

function initTopology() {
  document.getElementById('topo-fuzzy').value = '';
  document.getElementById('topo-proj').value = '';
  document.getElementById('topo-prod').value = '';
  document.getElementById('topo-cust').value = '';
  _initTopoDt();
  _topoDt.setData([]);
  _topoShowBugs(null);
  _topoShowTasks(null);

  // Auto-focus fuzzy search
  setTimeout(function() {
    var el = document.getElementById('topo-fuzzy');
    if (el) { el.focus(); el.select(); }
  }, 300);

  // Pre-fill customer search if navigated from customer badge
  if (typeof _pendingCustSelect !== 'undefined' && _pendingCustSelect) {
    document.getElementById('topo-cust').value = _pendingCustSelect;
    _pendingCustSelect = null;
    onTopoSearch();
  }
}

function onFuzzySearch() {
  clearTimeout(_fuzzyTimer);
  _fuzzyTimer = setTimeout(doFuzzySearch, 300);
}

async function doFuzzySearch() {
  var q = document.getElementById('topo-fuzzy').value.trim();
  if (!q) { _initTopoDt(); _topoDt.setData([]); _topoShowBugs(null); _topoShowTasks(null); return; }
  document.getElementById('topo-proj').value = '';
  document.getElementById('topo-prod').value = '';
  document.getElementById('topo-cust').value = '';

  _initTopoDt();
  _topoDt.setData([{ project_code: '', project_name: '搜索中...', customer_name: '', products: [], project_status: '' }]);
  try {
    var data = await API.get('/search?q=' + encodeURIComponent(q));
    data = data || {};
    _topoShowResult(data.projects || []);
    _topoShowBugs(data.bugs || []);
    _topoShowTasks(data.tasks || []);
  } catch(e) {
    _topoDt = null;
    _topoBugDt = null;
    _topoTaskDt = null;
    document.getElementById('topo-table').innerHTML = '<div class="error-state" style="padding:20px">搜索失败: ' + escHtml(e.message) + '<br><button class="btn" style="margin-top:8px" onclick="onFuzzySearch()">重试</button></div>';
    var bs = document.getElementById('topo-bug-section'); if (bs) bs.style.display = 'none';
    var ts = document.getElementById('topo-task-section'); if (ts) ts.style.display = 'none';
    showToast('搜索失败: ' + e.message, 'error');
  }
}

function onTopoSearch() {
  clearTimeout(_topoTimer);
  _topoTimer = setTimeout(doTopoSearch, 300);
}

async function doTopoSearch() {
  var proj = document.getElementById('topo-proj').value.trim();
  var prod = document.getElementById('topo-prod').value.trim();
  var cust = document.getElementById('topo-cust').value.trim();

  if (!proj && !prod && !cust) { _initTopoDt(); _topoDt.setData([]); _topoShowBugs(null); _topoShowTasks(null); return; }

  var params = [];
  if (proj) params.push('project=' + encodeURIComponent(proj));
  if (prod) params.push('product=' + encodeURIComponent(prod));
  if (cust) params.push('customer=' + encodeURIComponent(cust));

  // 3D search is project-only — hide bug/task sections
  _topoShowBugs(null);
  _topoShowTasks(null);
  _initTopoDt();
  try {
    var data = await API.get('/topology?' + params.join('&'));
    _topoShowResult((data && data.items) ? data.items : []);
  } catch(e) {
    _topoDt = null;
    document.getElementById('topo-table').innerHTML = '<div class="error-state" style="padding:20px">搜索失败: ' + escHtml(e.message) + '<br><button class="btn" style="margin-top:8px" onclick="onTopoSearch()">重试</button></div>';
    showToast('搜索失败: ' + e.message, 'error');
  }
}
