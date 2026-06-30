/* ═══════════════════════════════════════════════════
   DASHBOARD VIEW
═══════════════════════════════════════════════════ */
var curTypeFilter = 'all';

// Project favorites use shared favStar component (persisted to DB)
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
  try { await loadFavorites(); } catch(e) { console.error('loadFavorites failed:', e); }
  await Promise.all([
    loadKpiCards(),
    loadProjectTable(curTypeFilter),
  ]);
  document.getElementById('tab-fav').textContent = '★ 收藏 ' + _favProjects.length;
  document.getElementById('kpi-fav-count').textContent = _favProjects.length;
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
    document.getElementById('kpi-meta-types').innerHTML = Object.keys(data.type_active || {}).map(function(t) {
      return getProjectTypeLabel(t) + ' <b>' + data.type_active[t] + '</b>';
    }).join(' &nbsp;·&nbsp; ');
    // Update filter tabs with counts, dynamic per project type
    document.getElementById('tab-all').textContent = '全部 ' + data.total_projects;
    var typeFilterEl = document.getElementById('type-filter');
    if (typeFilterEl && data.type_all) {
      // Remove old type tabs (keep only "全部")
      typeFilterEl.querySelectorAll('.tab[data-ptype]').forEach(function(t) { t.remove(); });
      Object.keys(data.type_all).sort().forEach(function(pt) {
        var tab = document.createElement('span');
        tab.className = 'tab' + (curTypeFilter === pt ? ' active' : '');
        tab.setAttribute('data-ptype', pt);
        tab.onclick = function() { filterTable(pt, this); };
        tab.textContent = getProjectTypeLabel(pt) + ' ' + data.type_all[pt];
        typeFilterEl.appendChild(tab);
      });
    }
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
  if (_curCategory === category && category !== '') { category = ''; }
  _curCategory = category;
  // Reset type filter tabs
  curTypeFilter = 'all';
  document.querySelectorAll('#type-filter .tab').forEach(function(t) { t.classList.remove('active'); });
  var allTab = document.getElementById('tab-all');
  if (allTab) allTab.classList.add('active');
  // Update KPI card highlights
  document.querySelectorAll('.kpi-card').forEach(function(c) { c.classList.remove('active'); });
  if (el) el.classList.add('active');
  loadProjectTable('all');
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
  // Reset category filter when switching type filter
  _curCategory = '';
  document.querySelectorAll('#kpi-grid .kpi-card').forEach(function(c){c.classList.remove('active');});
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
  if (filter && filter !== 'all' && filter !== 'fav') params.type = filter;
  if (_curProgramId) params.program_id = _curProgramId;

  var tbody = document.getElementById('proj-tbody');
  tbody.innerHTML = '<tr><td colspan="11"><div class="loading-spinner">加载中...</div></td></tr>';

  try {
    var query = Object.keys(params).map(function(k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');
    var data = await API.get('/dashboard/projects?' + query);
    var list = data.items || [];

    // Filter by favorites
    if (curTypeFilter === 'fav') {
      list = list.filter(function(p) { return isFav('project', p.id); });
      document.getElementById('tab-fav').textContent = '★ 收藏 ' + list.length;
    }

    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="11"><div class="empty-state">未找到匹配项目</div></td></tr>';
      return;
    }

    tbody.innerHTML = list.map(function(p) {
      var projCode = extractProjectCode(p.name, p.code);
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
      var projIconHtml = projCode ? projCodeTag(projCode, 'event.stopPropagation();openProject(\'' + p.id + '\')') : projCodeTag('RD');
      var riskLevel = p.risk_level || 'normal';
      var riskLabel = { normal: '正常', low: '较低', medium: '中等', high: '高', overdue: '已超期', incomplete: '资料不全' }[riskLevel] || '正常';
      var riskColor = { normal: 'var(--success)', low: 'var(--muted)', medium: 'var(--warn)', high: 'var(--danger)', overdue: 'var(--danger)', incomplete: 'var(--warn)' }[riskLevel] || 'var(--muted)';
      var riskBg = { normal: 'var(--success-lt)', low: 'var(--bg)', medium: 'var(--warn-lt)', high: 'var(--danger-lt)', overdue: 'var(--danger-lt)', incomplete: 'var(--warn-lt)' }[riskLevel] || 'var(--bg)';

      return '<tr id="proj-row-' + p.id + '" ' + rowClick + '>' +
        '<td style="width:28px;text-align:center;padding-center:0">' + favStar('project', p.id, {stopPropagation: true}) + '</td>' +
        '<td>' + projIconHtml + '</td>' +
        '<td><div class="proj-name">' + escHtml(coreName) + '</div></td>' +
        '<td>' + renderCustomerBadge(p.customer_name) + '</td>' +
        '<td>' + renderTypeBadge(p.type) + '</td>' +
        '<td style="font-size:13px">' + escHtml(p.current_stage || '—') + '</td>' +
        '<td style="font-size:12.5px;color:' + (p.end ? 'var(--muted)' : 'var(--warn)') + '">' + (p.end ? formatDate(p.end) : '长期') + '</td>' +
        '<td>' + renderPill(p.status) + '</td>' +
        '<td style="text-align:center">' + renderProgressCircle(parseFloat(p.progress) || 0, 32, { label: '' }) + '</td>' +
        '<td><span class="risk-tag" style="--risk-color:' + riskColor + ';background:' + riskBg + ';font-size:11px">' + riskLabel + '</span></td>' +
        '<td>' + tagsHtml + '</td>' +
      '</tr>';
    }).join('');
  } catch(e) {
    tbody.innerHTML = '<tr><td colspan="11"><div class="error-state">加载失败: ' + escHtml(e.message) + '<br><button onclick="loadProjectTable(\'' + filter + '\')">重试</button></div></td></tr>';
  }
}

/* Alert List */

var _alertProjectFilter = null; // { id, label } when filtered by project

async function _resizeProjTable() {
  var wrap = document.getElementById('proj-table-wrap');
  if (!wrap) return;
  var top = wrap.getBoundingClientRect().top;
  var avail = window.innerHeight - top - 32;  // 32px bottom margin
  wrap.style.maxHeight = Math.max(200, avail) + 'px';
}

function toggleAlertSection() {
  var list = document.getElementById('alert-list');
  var icon = document.getElementById('alert-toggle-icon');
  if (!list || !icon) return;
  if (list.style.display === 'none') {
    list.style.display = '';
    icon.textContent = '▼';
    loadAlertList();
  } else {
    list.style.display = 'none';
    icon.textContent = '▶';
  }
  setTimeout(_resizeProjTable, 100);
}

window.addEventListener('resize', _resizeProjTable);
// Call after table render
var _origRenderDashboard = renderDashboard;
renderDashboard = function() {
  _origRenderDashboard();
  setTimeout(_resizeProjTable, 200);
};

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
        (a.project_code ? projCodeTag(a.project_code, 'event.stopPropagation();openProject(\'' + a.project_id + '\')') : '') +
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
  sessionStorage.setItem('pm_last_proj_id', id);
  window._pendingProjectId = id;  // detail.js may not be loaded yet — initDetailView will pick this up
  gotoView('detail');
}

/* ── Dashboard: Create Local Project Dialog ── */

var _dashAllProducts = [];
var _dashAllProjects = [];

async function showDashboardCreateProjectDialog() {
  // Load products and projects if not already loaded
  if (!_dashAllProducts.length) {
    try { _dashAllProducts = (await API.get('/product-management/all-products')) || []; } catch(e) {}
  }
  if (!_dashAllProjects.length) {
    try { _dashAllProjects = (await API.get('/product-management/all-projects')) || []; } catch(e) {}
  }
  // Load project types for dropdown (includes custom types from 项目&模板管理)
  var projectTypes = [{id: 'RD', label: '研发项目'}, {id: 'SC', label: '生产项目'}];
  try { var pts = await API.get('/doc-templates/project-types'); if (pts && pts.length) projectTypes = pts; } catch(e) {}
  var typeOptions = projectTypes.map(function(pt) {
    return '<option value="' + escHtml(pt.id) + '">' + escHtml(pt.label) + '</option>';
  }).join('');

  var productCheckboxes = _dashAllProducts.length
    ? _dashAllProducts.slice(0, 100).map(function(p) {
        return '<label style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:12px;cursor:pointer">' +
          '<input type="checkbox" value="' + p.id + '" class="dash-newproj-prod">' +
          escHtml(p.code || '') + ' ' + escHtml(p.name) +
        '</label>';
      }).join('')
    : '<span style="font-size:12px;color:var(--muted)">暂无可选产品，请先在禅道同步或本地创建产品</span>';

  openDialog('新建项目',
    '<div style="margin-bottom:10px"><label style="font-size:11px;color:var(--muted)">项目名称 *</label>' +
    '<input class="search-inp" id="dash-newproj-name" placeholder="如：某型计算刀片" style="width:100%;box-sizing:border-box;margin-top:4px"></div>' +
    '<div style="margin-bottom:10px"><label style="font-size:11px;color:var(--muted)">项目编号 *</label>' +
    '<input class="search-inp" id="dash-newproj-code" placeholder="如：PROJ-001" style="width:100%;box-sizing:border-box;margin-top:4px"></div>' +
    '<div style="display:flex;gap:10px;margin-bottom:10px">' +
      '<div style="flex:1"><label style="font-size:11px;color:var(--muted)">类型</label>' +
      '<select id="dash-newproj-type" style="width:100%;box-sizing:border-box;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--fg);margin-top:4px">' +
        typeOptions +
      '</select></div>' +
      '<div style="flex:1"><label style="font-size:11px;color:var(--muted)">状态</label>' +
      '<select id="dash-newproj-status" style="width:100%;box-sizing:border-box;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--fg);margin-top:4px">' +
        '<option value="wait">未开始</option><option value="doing">进行中</option><option value="done">已完成</option>' +
      '</select></div>' +
    '</div>' +
    '<div style="margin-bottom:10px"><label style="font-size:11px;color:var(--muted)">描述</label>' +
    '<textarea class="search-inp" id="dash-newproj-desc" rows="2" placeholder="项目描述（可选）" style="width:100%;box-sizing:border-box;margin-top:4px;resize:vertical"></textarea></div>' +
    '<div style="margin-bottom:10px"><label style="font-size:11px;color:var(--muted)">关联产品 * <span style="font-weight:400;color:var(--danger)">（至少选1个）</span></label>' +
    '<div style="max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;padding:8px;margin-top:4px;background:var(--surface)">' + productCheckboxes + '</div></div>',
    [{text: '取消', onclick: 'document.querySelector(\'.shared-dialog-overlay\').remove()'},
     {text: '创建', cls: 'btn-primary', onclick: 'dashboardCreateProject()'}],
    {hideClose: true});
}

async function dashboardCreateProject() {
  var name = document.getElementById('dash-newproj-name').value.trim();
  var code = document.getElementById('dash-newproj-code').value.trim();
  var pt = document.getElementById('dash-newproj-type').value;
  var st = document.getElementById('dash-newproj-status').value;
  var desc = document.getElementById('dash-newproj-desc').value.trim();

  if (!name) { showToast('请输入项目名称', 'error'); return; }
  if (!code) { showToast('请输入项目编号', 'error'); return; }

  var productIds = [];
  document.querySelectorAll('.dash-newproj-prod:checked').forEach(function(cb) {
    productIds.push(parseInt(cb.value));
  });

  if (!productIds.length) { showToast('项目必须关联至少1个产品', 'error'); return; }

  closeSharedDialog();
  try {
    await API.post('/product-management/projects', {
      name: name, code: code, project_type: pt,
      status: st, description: desc, product_ids: productIds
    });
    showToast('项目已创建: ' + name, 'ok');
    // Refresh dashboard
    renderDashboard();
  } catch (e) {
    showToast('创建失败: ' + (e.detail || e.message), 'error');
  }
}

// Ctrl+K shortcut: focus search on dashboard
document.addEventListener('keydown', function(e) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    var activeView = document.querySelector('.view.active');
    if (activeView && activeView.id === 'view-dashboard') {
      e.preventDefault();
      var searchEl = document.getElementById('proj-search');
      if (searchEl) { searchEl.focus(); searchEl.select(); }
    }
  }
});
