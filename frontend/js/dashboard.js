/* ═══════════════════════════════════════════════════
   DASHBOARD VIEW
═══════════════════════════════════════════════════ */
var curTypeFilter = 'all';
var curSearchVal  = '';
var _curCategory = 'active';
var _curProgramId = '';  // '' = all
var _sortEndOrder = 'asc';
var _sortCodeOrder = '';  // '' = no sort, 'asc', 'desc'

var _dashboardLoading = false;

async function renderDashboard() {
  if (_dashboardLoading) return;
  _dashboardLoading = true;
  // Show loading state on KPI cards
  ['kpi-active-count','kpi-completed-count','kpi-high-risk-count','kpi-incomplete-docs-count'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.textContent = '...';
  });
  await Promise.all([
    loadKpiCards(),
    loadProjectTable(curTypeFilter),
    loadAlertList(),
  ]);
  _dashboardLoading = false;
}

/* KPI Cards — now category filter cards */

async function loadKpiCards() {
  try {
    var data = await API.get('/dashboard/kpi');
    document.getElementById('kpi-all-count').textContent = data.total_projects;
    var filterInfo = document.getElementById('kpi-all-filter');
    if (filterInfo) {
      var pf = data.project_filter || '';
      filterInfo.textContent = pf ? '筛选: ' + pf : '所有项目';
      filterInfo.title = pf ? '数据源配置中设定的项目编号前缀过滤' : '未设置项目编号前缀过滤';
    }
    document.getElementById('kpi-active-count').textContent = data.active_count;
    document.getElementById('kpi-meta-types').innerHTML = '研发 <b>' + data.rd_count + '</b> &nbsp;·&nbsp; 生产 <b>' + data.sc_count + '</b>';
    // Update filter tabs with counts
    document.getElementById('tab-all').textContent = '全部 ' + data.total_projects;
    document.getElementById('tab-rd').textContent = '研发项目 ' + (data.rd_all || data.rd_count);
    document.getElementById('tab-sc').textContent = '生产项目 ' + (data.sc_all || data.sc_count);
    document.getElementById('kpi-completed-count').textContent = data.completed_count;
    document.getElementById('kpi-high-risk-count').textContent = data.high_risk_count;
    document.getElementById('kpi-incomplete-docs-count').textContent = data.incomplete_docs_count;
    var badge = document.getElementById('alert-badge');
    if (badge) {
      badge.textContent = data.pending_alerts;
      badge.style.display = data.pending_alerts > 0 ? '' : 'none';
    }
    if (_srcStates && _srcStates.zentao === 'pending') {
      _srcStates.zentao = 'ok';
      renderSourceTags();
    }
    // Render program chips
    if (data.programs && data.programs.length) {
      var chips = data.programs.map(function(pr) {
        return '<span class="tab" data-pid="' + pr.id + '" onclick="filterByProgram(' + pr.id + ',this)">' + escHtml(pr.name) + '</span>';
      }).join('');
      document.getElementById('program-filter').innerHTML = '<span class="tab' + (_curProgramId ? '' : ' active') + '" data-pid="" onclick="filterByProgram(\'\',this)">全部</span>' + chips;
    }
  } catch(e) {
    console.error('Failed to load KPI:', e);
  }
}

/* Program filter */
function filterByProgram(pid, el) {
  _curProgramId = pid;
  document.querySelectorAll('#program-filter .tab').forEach(function(t) { t.classList.remove('active'); });
  if (el) el.classList.add('active');
  loadProjectTable(curTypeFilter);
}

/* Category card click — filters project list */

function filterByCategory(category, el) {
  // Toggle: click active card again to deselect, or click "全部"
  if (_curCategory === category && category !== '') {
    category = '';
  }
  _curCategory = category;
  document.querySelectorAll('#kpi-grid .kpi-card').forEach(function(c) { c.classList.remove('active'); });
  if (el) el.classList.add('active');
  var table = document.querySelector('#view-dashboard .proj-table');
  if (table) {
    if (category) table.setAttribute('data-category', category);
    else table.removeAttribute('data-category');
  }
  loadProjectTable(curTypeFilter);
}

/* Project Table */

var _searchTimer = null;
function onProjSearch(v) {
  curSearchVal = v;
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(function() {
    loadProjectTable(curTypeFilter);
  }, 300);
}

function filterTable(f, el) {
  if (el) {
    document.querySelectorAll('#type-filter .tab').forEach(function(t) { t.classList.remove('active'); });
    el.classList.add('active');
  }
  loadProjectTable(f);
}

async function loadProjectTable(filter) {
  curTypeFilter = filter;
  var params = { page: 1, limit: 50 };
  if (_curCategory) params.category = _curCategory;
  if (_sortCodeOrder) {
    params.sort_by = 'code'; params.sort_order = _sortCodeOrder;
  } else if (_sortEndOrder) {
    params.sort_by = 'end'; params.sort_order = _sortEndOrder;
  } else {
    params.sort_by = 'id'; params.sort_order = 'asc';
  }
  if (curSearchVal) params.search = curSearchVal;
  if (filter && filter !== 'all') params.type = filter;
  if (_curProgramId) params.program_id = _curProgramId;

  var tbody = document.getElementById('proj-tbody');
  tbody.innerHTML = '<tr><td colspan="10"><div class="loading-spinner">加载中...</div></td></tr>';

  try {
    var query = Object.keys(params).map(function(k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');
    var data = await API.get('/dashboard/projects?' + query);
    var list = data.items || [];

    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="10"><div class="empty-state">未找到匹配项目</div></td></tr>';
      return;
    }

    tbody.innerHTML = list.map(function(p) {
      var fc = p.status === 'blocked' ? 'red' : (parseFloat(p.progress) >= 100 ? 'green' : 'blue');
      var projCode = extractProjectCode(p.name);
      var coreName = extractCoreName(p.name);
      // Tags: show max 3, or "无" if none
      var tagsList = p.tags_list || [];
      var tagsHtml = '';
      if (tagsList.length > 0 && tagsList[0] !== '') {
        tagsHtml = tagsList.slice(0, 3).map(function(t) {
          return '<span class="tag-badge tag-' + (t.length % 5) + '">#' + escHtml(t) + '</span>';
        }).join(' ');
      } else {
        tagsHtml = '<span style="font-size:11.5px;color:var(--muted)">无</span>';
      }
      var rowClick = 'onclick="filterAlertsByProject(\'' + p.id + '\', \'' + escHtml(projCode + ' ' + coreName).replace(/'/g, "\\'") + '\')"';
      var projIconHtml = renderProjIcon(p.type, projCode).replace('<div class=', '<div onclick="event.stopPropagation();openProject(\'' + p.id + '\')" class=');
      var riskLevel = p.risk_level || 'normal';
      var riskLabel = { normal: '正常', low: '较低', medium: '中等', high: '高', overdue: '已超期', incomplete: '资料不全' }[riskLevel] || '正常';
      var riskColor = { normal: 'var(--success)', low: 'var(--muted)', medium: 'var(--warn)', high: 'var(--danger)', overdue: 'var(--danger)', incomplete: 'var(--warn)' }[riskLevel] || 'var(--muted)';
      var riskBg = { normal: 'var(--success-lt)', low: 'var(--bg)', medium: 'var(--warn-lt)', high: 'var(--danger-lt)', overdue: 'var(--danger-lt)', incomplete: 'var(--warn-lt)' }[riskLevel] || 'var(--bg)';

      return '<tr ' + rowClick + '>' +
        '<td>' + projIconHtml + '</td>' +
        '<td><div class="proj-name">' + escHtml(coreName) + '</div><div class="proj-code">' + escHtml(projCode) + '</div></td>' +
        '<td><span onclick="event.stopPropagation();openCustomerByName(\'' + escHtml(p.customer_name || '') + '\')" style="cursor:pointer">' + renderCustomerBadge(p.customer_name) + '</span></td>' +
        '<td>' + renderTypeBadge(p.type) + '</td>' +
        '<td style="font-size:13px">' + escHtml(p.current_stage || '—') + '</td>' +
        '<td><span class="risk-tag" style="--risk-color:' + riskColor + ';background:' + riskBg + ';font-size:11px">' + riskLabel + '</span></td>' +
        '<td>' + renderPill(p.status) + '</td>' +
        '<td class="prog-cell">' + renderProgressBar(p.progress, p.status) + '</td>' +
        '<td style="font-size:12.5px;color:' + (p.end ? 'var(--muted)' : 'var(--warn)') + '">' + (p.end ? formatDate(p.end) : '长期') + '</td>' +
        '<td>' + tagsHtml + '</td>' +
      '</tr>';
    }).join('');
  } catch(e) {
    tbody.innerHTML = '<tr><td colspan="10"><div class="error-state">加载失败: ' + escHtml(e.message) + '<br><button onclick="loadProjectTable(\'' + filter + '\')">重试</button></div></td></tr>';
  }
}

/* Alert List */

var _alertProjectFilter = null; // { id, label } when filtered by project

async function loadAlertList(projectId) {
  var container = document.getElementById('alert-list');
  container.innerHTML = '<div class="loading-spinner">加载告警...</div>';

  try {
    var url = '/dashboard/alerts?limit=50';
    if (projectId) url += '&project_id=' + projectId;
    var data = await API.get(url);
    var alerts = data.items || [];
    var countEl = document.getElementById('alert-count');
    countEl.innerHTML = '共 ' + data.total + ' 条';
    if (_alertProjectFilter) {
      countEl.innerHTML += ' <span style="font-size:11px;color:var(--accent);cursor:pointer" onclick="clearAlertFilter()">(已筛选: ' + escHtml(_alertProjectFilter.label) + ' ✕)</span>';
    }

    if (!alerts.length) {
      container.innerHTML = '<div class="empty-state">' + (_alertProjectFilter ? '该项目暂无告警' : '暂无告警') + '</div>';
      return;
    }

    container.innerHTML = alerts.map(function(a) {
      var dot = a.severity === 'red' ? 'r' : 'y';
      return '<div class="alert-row">' +
        '<div class="alert-dot ' + dot + '"></div>' +
        (a.project_code ? '<button class="gs-btn" onclick="event.stopPropagation();openProject(\'' + a.project_id + '\')" title="跳转到项目详情">' + escHtml(a.project_code) + '</button>' : '') +
        '<div class="alert-body">' +
          '<div class="alert-msg">' + escHtml(a.message) + '</div>' +
          (a.sub_message ? '<div class="alert-sub">' + escHtml(a.sub_message) + '</div>' : '') +
        '</div>' +
      '</div>';
    }).join('');
  } catch(e) {
    container.innerHTML = '<div class="error-state">告警加载失败<button onclick="loadAlertList()">重试</button></div>';
  }
}

function filterAlertsByProject(projectId, label) {
  _alertProjectFilter = { id: projectId, label: label };
  loadAlertList(projectId);
}

function clearAlertFilter() {
  _alertProjectFilter = null;
  loadAlertList();
}

/* Navigation */

function _updateSortIndicators() {
  var ei = document.getElementById('sort-end-ind');
  var ci = document.getElementById('sort-code-ind');
  // End date indicator
  if (_sortEndOrder === 'asc') { ei.textContent = '▲'; ei.style.color = ''; }
  else if (_sortEndOrder === 'desc') { ei.textContent = '▼'; ei.style.color = ''; }
  else { ei.textContent = '⇅'; ei.style.color = 'var(--muted)'; }
  // Code indicator
  if (_sortCodeOrder === 'asc') { ci.textContent = '▲'; ci.style.color = ''; }
  else if (_sortCodeOrder === 'desc') { ci.textContent = '▼'; ci.style.color = ''; }
  else { ci.textContent = '⇅'; ci.style.color = 'var(--muted)'; }
}

function toggleSortEnd() {
  _sortCodeOrder = '';
  _sortEndOrder = _sortEndOrder === 'asc' ? 'desc' : _sortEndOrder === 'desc' ? '' : 'asc';
  if (_sortEndOrder) { _updateSortIndicators(); loadProjectTable(curTypeFilter); }
  else _updateSortIndicators();
}

function toggleSortCode() {
  _sortEndOrder = '';
  _sortCodeOrder = _sortCodeOrder === 'asc' ? 'desc' : _sortCodeOrder === 'desc' ? '' : 'asc';
  if (_sortCodeOrder) { _updateSortIndicators(); loadProjectTable(curTypeFilter); }
  else _updateSortIndicators();
}

function openProject(id) {
  selectComboProject(id);
  gotoView('detail');
}
