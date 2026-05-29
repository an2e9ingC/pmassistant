/* ═══════════════════════════════════════════════════
   DASHBOARD VIEW
═══════════════════════════════════════════════════ */
var curTypeFilter = 'all';
var curSearchVal  = '';
var _curCategory = 'active';
var _sortEndOrder = 'asc'; // 'asc' = nearest first, 'desc' = farthest first

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
    document.getElementById('kpi-active-count').textContent = data.active_count;
    document.getElementById('kpi-meta-types').innerHTML = '研发 <b>' + data.rd_count + '</b> &nbsp;·&nbsp; 生产 <b>' + data.sc_count + '</b>';
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
  } catch(e) {
    console.error('Failed to load KPI:', e);
  }
}

/* Category card click — filters project list */

function filterByCategory(category, el) {
  _curCategory = category;
  // Toggle active class on cards
  document.querySelectorAll('#kpi-grid .kpi-card').forEach(function(c) { c.classList.remove('active'); });
  if (el) el.classList.add('active');
  // Apply category color to project table
  var table = document.querySelector('#view-dashboard .proj-table');
  if (table) {
    table.setAttribute('data-category', category);
  }
  // Reload project list with category filter
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
  var params = { page: 1, limit: 50, sort_by: 'end', sort_order: _sortEndOrder, category: _curCategory };
  if (curSearchVal) params.search = curSearchVal;
  if (filter && filter !== 'all') params.type = filter;

  var tbody = document.getElementById('proj-tbody');
  tbody.innerHTML = '<tr><td colspan="9"><div class="loading-spinner">加载中...</div></td></tr>';

  try {
    var query = Object.keys(params).map(function(k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');
    var data = await API.get('/dashboard/projects?' + query);
    var list = data.items || [];

    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="9"><div class="empty-state">未找到匹配项目</div></td></tr>';
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
      return '<tr onclick="openProject(\'' + p.id + '\')">' +
        '<td>' + renderProjIcon(p.type, projCode) + '</td>' +
        '<td><div class="proj-name">' + escHtml(coreName) + '</div><div class="proj-code">' + escHtml(projCode) + '</div></td>' +
        '<td>' + renderCustomerBadge(p.customer_name) + '</td>' +
        '<td>' + renderTypeBadge(p.type) + '</td>' +
        '<td style="font-size:13px">' + escHtml(p.current_stage || '—') + '</td>' +
        '<td>' + renderPill(p.status) + '</td>' +
        '<td class="prog-cell">' + renderProgressBar(p.progress, p.status) + '</td>' +
        '<td style="font-size:12.5px;color:' + (p.end ? 'var(--muted)' : 'var(--warn)') + '">' + (p.end ? formatDate(p.end) : '长期') + '</td>' +
        '<td>' + tagsHtml + '</td>' +
      '</tr>';
    }).join('');
  } catch(e) {
    tbody.innerHTML = '<tr><td colspan="9"><div class="error-state">加载失败: ' + escHtml(e.message) + '<br><button onclick="loadProjectTable(\'' + filter + '\')">重试</button></div></td></tr>';
  }
}

/* Alert List */

async function loadAlertList() {
  var container = document.getElementById('alert-list');
  container.innerHTML = '<div class="loading-spinner">加载告警...</div>';

  try {
    var data = await API.get('/dashboard/alerts?limit=50');
    var alerts = data.items || [];
    document.getElementById('alert-count').textContent = '共 ' + data.total + ' 条';

    if (!alerts.length) {
      container.innerHTML = '<div class="empty-state">暂无告警</div>';
      return;
    }

    container.innerHTML = alerts.map(function(a) {
      var dot = a.severity === 'red' ? 'r' : 'y';
      return '<div class="alert-row">' +
        '<div class="alert-dot ' + dot + '"></div>' +
        '<div class="alert-body">' +
          '<div class="alert-msg">' + escHtml(a.message) + '</div>' +
          (a.sub_message ? '<div class="alert-sub">' + escHtml(a.sub_message) + '</div>' : '') +
          (a.project_id ? '<div class="alert-proj" onclick="openProject(\'' + a.project_id + '\')">' + escHtml(a.project_code || '') + ' →</div>' : '') +
        '</div>' +
      '</div>';
    }).join('');
  } catch(e) {
    container.innerHTML = '<div class="error-state">告警加载失败<button onclick="loadAlertList()">重试</button></div>';
  }
}

/* Navigation */

function toggleSortEnd() {
  _sortEndOrder = _sortEndOrder === 'asc' ? 'desc' : 'asc';
  var ind = document.getElementById('sort-end-ind');
  if (ind) ind.textContent = _sortEndOrder === 'asc' ? '▲' : '▼';
  loadProjectTable(curTypeFilter);
}

function openProject(id) {
  selectComboProject(id);
  gotoView('detail');
}
