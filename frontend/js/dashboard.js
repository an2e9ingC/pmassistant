/* ═══════════════════════════════════════════════════
   DASHBOARD VIEW
═══════════════════════════════════════════════════ */
var curTypeFilter = 'all';
var curSearchVal  = '';

async function renderDashboard() {
  await Promise.all([
    loadKpiCards(),
    loadProjectTable(curTypeFilter),
    loadAlertList(),
  ]);
}

/* KPI Cards */

async function loadKpiCards() {
  try {
    var data = await API.get('/dashboard/kpi');
    document.getElementById('kpi-active').textContent = data.active_projects;
    document.getElementById('kpi-meta-types').innerHTML = '研发 <b>' + data.rd_count + '</b> &nbsp;·&nbsp; 生产 <b>' + data.sc_count + '</b>';
    document.getElementById('kpi-alerts').textContent = data.pending_alerts;
    document.getElementById('alert-badge').textContent = data.pending_alerts;
    document.getElementById('kpi-delivered').textContent = data.delivered_this_month;
    document.getElementById('kpi-progress').innerHTML = data.avg_progress + '<span style="font-size:18px;font-weight:500">%</span>';
  } catch(e) {
    console.error('Failed to load KPI:', e);
  }
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
  if (curSearchVal) params.search = curSearchVal;
  if (filter && filter !== 'all') params.type = filter;

  var tbody = document.getElementById('proj-tbody');
  tbody.innerHTML = '<tr><td colspan="7"><div class="loading-spinner">加载中...</div></td></tr>';

  try {
    var query = Object.keys(params).map(function(k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');
    var data = await API.get('/dashboard/projects?' + query);
    var list = data.items || [];

    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state">未找到匹配项目</div></td></tr>';
      return;
    }

    tbody.innerHTML = list.map(function(p) {
      var fc = p.status === 'blocked' ? 'red' : (parseFloat(p.progress) >= 100 ? 'green' : 'blue');
      var custName = p.customer_name || p.name;
      return '<tr onclick="openProject(\'' + p.id + '\')">' +
        '<td><div class="proj-id-cell">' +
          renderProjIcon(p.type) +
          '<div><div class="proj-name">' + escHtml(custName) + '</div><div class="proj-code">' + escHtml(p.code || p.name) + '</div></div>' +
        '</div></td>' +
        '<td>' + renderTypeBadge(p.type) + '</td>' +
        '<td style="font-size:13px">' + escHtml(p.pm_name || '—') + '</td>' +
        '<td style="font-size:13px">' + escHtml(p.current_stage || '—') + '</td>' +
        '<td>' + renderPill(p.status) + '</td>' +
        '<td class="prog-cell">' + renderProgressBar(p.progress, p.status) + '</td>' +
        '<td style="font-size:12.5px;color:var(--muted)">' + formatDate(p.end) + '</td>' +
      '</tr>';
    }).join('');
  } catch(e) {
    tbody.innerHTML = '<tr><td colspan="7"><div class="error-state">加载失败: ' + escHtml(e.message) + '<br><button onclick="loadProjectTable(\'' + filter + '\')">重试</button></div></td></tr>';
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

function openProject(id) {
  selectComboProject(id);
  gotoView('detail');
}
