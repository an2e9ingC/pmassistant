/* ═══════════════════════════════════════════════════
   DASHBOARD VIEW
═══════════════════════════════════════════════════ */

// ── Unified filter state (default: fav) ──

var dashFilter = {
  type: 'fav',       // 'fav' | 'all' | 'RD' | 'SC'
  status: '',        // '' | 'doing' | 'wait' | 'done' | 'closed' | 'suspended'
  category: '',      // '' | 'active' | 'completed' | 'high_risk' | 'incomplete_docs'
  program: '',       // '' | program_id
  search: '',
  sortBy: 'end',
  sortOrder: 'asc',
  _searchTimer: null,

  // ── KPI card click (single-select: clicking already-active card does nothing) ──

  _clearSearch: function() {
    this.search = '';
    var inp = document.getElementById('proj-search');
    if (inp) inp.value = '';
  },

  setCard: function(cat, el) {
    this._clearSearch();
    if (cat === 'fav') {
      // Fav card: switch to fav mode, clear category highlight
      if (this.type === 'fav') return; // already on fav, no-op
      this.type = 'fav';
      this.category = '';
      document.querySelectorAll('.kpi-grid .kpi-card').forEach(function(c) { c.classList.remove('active'); });
      if (el) el.classList.add('active');
      // Reset type tabs
      document.querySelectorAll('#dash-type-filter .tab').forEach(function(t) { t.classList.remove('active'); });
      var allTab = document.querySelector('#dash-type-filter .tab[data-type="all"]');
      if (allTab) allTab.classList.add('active');
    } else {
      // Category card: single-select (clicking same card = no-op)
      if (this.category === cat) return;
      this.category = cat;
      // Exit fav mode
      if (this.type === 'fav') {
        this.type = 'all';
        document.querySelectorAll('#dash-type-filter .tab').forEach(function(t) { t.classList.remove('active'); });
        var allTab = document.querySelector('#dash-type-filter .tab[data-type="all"]');
        if (allTab) allTab.classList.add('active');
      }
      document.querySelectorAll('.kpi-grid .kpi-card').forEach(function(c) { c.classList.remove('active'); });
      if (el) el.classList.add('active');
    }
    this.reload();
  },

  // ── Type filter ──

  setType: function(type, el) {
    if (this.type === type) return;
    this._clearSearch();
    this.type = type;
    this.category = ''; // reset category highlight when switching type
    document.querySelectorAll('#dash-type-filter .tab').forEach(function(t) { t.classList.remove('active'); });
    if (el) el.classList.add('active');
    document.querySelectorAll('.kpi-grid .kpi-card').forEach(function(c) { c.classList.remove('active'); });
    this.reload();
  },

  // ── Status filter ──

  setStatus: function(status, el) {
    if (this.status === status) return;
    this._clearSearch();
    this.status = status;
    document.querySelectorAll('#dash-status-filter .tab').forEach(function(t) { t.classList.remove('active'); });
    if (el) el.classList.add('active');
    this.reload();
  },

  // ── Program filter ──

  setProgram: function(pid, el) {
    if (this.program === pid) return;
    this._clearSearch();
    this.program = pid;
    document.querySelectorAll('#dash-program-filter .tab').forEach(function(t) { t.classList.remove('active'); });
    if (el) el.classList.add('active');
    this.reload();
  },

  // ── Sort toggles (table header click) ──

  toggleSortEnd: function() {
    this.sortBy = 'end';
    this.sortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc';
    this._updateSortIndicators();
    this.reload();
  },

  toggleSortCode: function() {
    this.sortBy = 'code';
    this.sortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc';
    this._updateSortIndicators();
    this.reload();
  },

  _updateSortIndicators: function() {
    var ei = document.getElementById('sort-end-ind');
    var ci = document.getElementById('sort-code-ind');
    if (ei) {
      if (this.sortBy === 'end') {
        ei.textContent = this.sortOrder === 'asc' ? '▲' : '▼';
        ei.style.color = '';
      } else {
        ei.textContent = '⇅'; ei.style.color = 'var(--muted)';
      }
    }
    if (ci) {
      if (this.sortBy === 'code') {
        ci.textContent = this.sortOrder === 'asc' ? '▲' : '▼';
        ci.style.color = '';
      } else {
        ci.textContent = '⇅'; ci.style.color = 'var(--muted)';
      }
    }
  },

  // ── Search (300ms debounce) ──

  onSearch: function(v) {
    var self = this;
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(function() { self.search = v; self.reload(); }, 300);
  },

  // ── Build API params ──

  buildParams: function() {
    var p = { page: 1, limit: 50 };
    if (this.search) {
      p.search = this.search;
      // Search globally — ignore type/status/category/program filters
    } else {
      if (this.type && this.type !== 'all' && this.type !== 'fav') p.type = this.type;
      if (this.status) p.status = this.status;
      if (this.category) p.category = this.category;
      if (this.program) p.program_id = this.program;
    }
    p.sort_by = this.sortBy;
    p.sort_order = this.sortOrder;
    return p;
  },

  // ── Reload ──

  reload: function() {
    loadKpiCards();
    loadProjectTable();
  }
};


// ── Render Dashboard (entry point) ──

var _dashboardLoading = false;
var _origRenderDashboard;

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
    loadProjectTable(),
  ]);
  document.getElementById('kpi-fav-count').textContent = _favProjects.length;
  _dashboardLoading = false;
}


// ── KPI Cards — only update numbers, no dynamic tab/chip creation ──

async function loadKpiCards() {
  try {
    var data = await API.get('/dashboard/kpi');

    // Update KPI card numbers
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
    document.getElementById('kpi-completed-count').textContent = data.completed_count;
    document.getElementById('kpi-high-risk-count').textContent = data.high_risk_count;
    // Add config gear for admin users on high-risk card
    var user = getCurrentUser();
    var perms = (user && user.permissions) ? user.permissions.split(',') : [];
    var isAdmin = user && (user.role === 'admin' || perms.indexOf('admin') >= 0 || perms.indexOf('project_edit') >= 0);
    var hrCard = document.querySelector('[data-filter="high_risk"]');
    if (hrCard && isAdmin) {
      hrCard.title = '统计条件：存在红色告警的项目（单击筛选，双击配置规则）';
      hrCard.ondblclick = function(e) { e.stopPropagation(); showRiskConfigDialog(); };
      var gear = document.getElementById('kpi-risk-gear');
      if (!gear) {
        var gearEl = document.createElement('span');
      gearEl.id = 'kpi-risk-gear';
      gearEl.title = '配置高风险规则';
      gearEl.style.cssText = 'position:absolute;top:4px;right:6px;cursor:pointer;font-size:14px;opacity:0.6';
      gearEl.innerHTML = '&#9881;';
      gearEl.onclick = function(e) { e.stopPropagation(); showRiskConfigDialog(); };
      hrCard.appendChild(gearEl);
      }
    }
    document.getElementById('kpi-incomplete-docs-count').textContent = data.incomplete_docs_count;

    var badge = document.getElementById('alert-badge');
    if (badge) {
      badge.textContent = data.pending_alerts;
      badge.style.display = data.pending_alerts > 0 ? '' : 'none';
    }

    // Load risk config for admin users
    loadRiskConfig();

    if (_srcStates && _srcStates.zentao === 'pending') {
      _srcStates.zentao = 'ok';
      renderSourceTags();
    }

    // Build type filter tabs (one-time, from type_all)
    var typeFilterEl = document.getElementById('dash-type-filter');
    if (typeFilterEl && data.type_all) {
      var tabs = '<span class="tab' + (dashFilter.type === 'all' ? ' active' : '') + '" data-type="all" onclick="dashFilter.setType(\'all\',this)">全部 <b>' + data.total_projects + '</b></span>';
      Object.keys(data.type_all).sort().forEach(function(pt) {
        tabs += '<span class="tab' + (dashFilter.type === pt ? ' active' : '') + '" data-type="' + pt + '" onclick="dashFilter.setType(\'' + pt + '\',this)">' + getProjectTypeLabel(pt) + ' <b>' + data.type_all[pt] + '</b></span>';
      });
      typeFilterEl.innerHTML = tabs;
    }

    // Build program filter tabs
    var programEl = document.getElementById('dash-program-filter');
    if (programEl && data.programs && data.programs.length) {
      var chips = data.programs.map(function(pr) {
        return '<span class="tab' + (dashFilter.program === String(pr.id) ? ' active' : '') + '" data-pid="' + pr.id + '" onclick="dashFilter.setProgram(\'' + pr.id + '\',this)">' + escHtml(pr.name) + '</span>';
      }).join('');
      programEl.innerHTML = '<span class="tab' + (dashFilter.program === '' ? ' active' : '') + '" data-pid="" onclick="dashFilter.setProgram(\'\',this)">全部</span>' + chips;
    }
  } catch(e) {
    console.error('Failed to load KPI:', e);
  }
}


// ── Risk Config (global scope) ──

async function loadRiskConfig() {
  try {
    var config = await API.get('/dashboard/risk-config');
    if (config) _riskConfig = config;
  } catch(e) { /* non-admin: silent */ }
}

function showRiskConfigDialog() {
  var c = _riskConfig || {};
  var row = 'padding:8px 0;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between';
  var lbl = 'font-size:13px;color:var(--fg)';
  var inp = 'width:72px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;text-align:center;font-size:13px;background:var(--bg);color:var(--fg)';
  var chk = 'width:18px;height:18px;cursor:pointer;accent-color:var(--accent)';
  openDialog('高风险项目判定标准',
    '<div>' +
      '<div style="' + row + '"><span style="' + lbl + '">阶段逾期容忍天数</span><input id="rc-overdue-days" type="number" min="0" value="' + (c.stage_overdue_days||0) + '" style="' + inp + '"></div>' +
      '<div style="' + row + '"><span style="' + lbl + '">最少逾期阶段数</span><input id="rc-min-overdue" type="number" min="1" value="' + (c.min_overdue_stages||1) + '" style="' + inp + '"></div>' +
      '<div style="' + row + '"><span style="' + lbl + '">文档未提交算高风险</span><input type="checkbox" id="rc-pending-docs"' + (c.include_pending_docs?' checked':'') + ' style="' + chk + '"></div>' +
      '<div style="' + row + '"><span style="' + lbl + '">审核缺同意算高风险</span><input type="checkbox" id="rc-review-missing"' + (c.include_review_missing?' checked':'') + ' style="' + chk + '"></div>' +
    '</div>',
    [
      {text: '取消', onclick: 'closeSharedDialog()'},
      {text: '保存', cls: 'btn-primary', onclick: 'saveRiskConfig()'}
    ],
    {maxWidth: 420}
  );
}

async function saveRiskConfig() {
  var config = {
    stage_overdue_days: parseInt(document.getElementById('rc-overdue-days').value) || 0,
    min_overdue_stages: parseInt(document.getElementById('rc-min-overdue').value) || 1,
    include_pending_docs: document.getElementById('rc-pending-docs').checked,
    include_review_missing: document.getElementById('rc-review-missing').checked,
  };
  try {
    await API.put('/dashboard/risk-config', config);
    _riskConfig = config;
    closeSharedDialog();
    showToast('风险配置已保存', 'success');
    loadKpiCards();
  } catch(e) { showToast('保存失败: ' + (e.message || ''), 'error'); }
}


// ── Project Table ──

async function loadProjectTable() {
  var params = dashFilter.buildParams();
  var tbody = document.getElementById('proj-tbody');
  tbody.innerHTML = '<tr><td colspan="12"><div class="loading-spinner">加载中...</div></td></tr>';

  try {
    var query = Object.keys(params).map(function(k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');
    var data = await API.get('/dashboard/projects?' + query);
    var list = data.items || [];

    // Filter by favorites (client-side), skip when searching globally
    if (dashFilter.type === 'fav' && !dashFilter.search) {
      list = list.filter(function(p) { return isFav('project', p.id); });
    }

    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="12"><div class="empty-state">未找到匹配项目</div></td></tr>';
      return;
    }

    tbody.innerHTML = list.map(function(p) {
      var projCode = extractProjectCode(p.name, p.code);
      var coreName = extractCoreName(p.name);
      // Tags
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
      var projIconHtml = projCode ? projCodeTag(projCode, 'event.stopPropagation();openProject(\'' + escHtml(p.code || String(p.id)).replace(/'/g, "\\'") + '\')', p.name) : projCodeTag('RD');
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
        '<td style="font-size:11px">' + (p.linked_projects && p.linked_projects.length
          ? p.linked_projects.map(function(lp) { return '<span class="proj-code-btn" style="font-size:10px" onclick="event.stopPropagation();openProject(\'' + escHtml(lp.code || String(lp.id)) + '\')" title="' + escHtml(lp.name || '') + '">' + escHtml(lp.code || lp.name) + '</span>'; }).join(' ')
          : '<span style="color:var(--muted)">—</span>') + '</td>' +
        '<td>' + tagsHtml + '</td>' +
      '</tr>';
    }).join('');
  } catch(e) {
    tbody.innerHTML = '<tr><td colspan="12"><div class="error-state">加载失败: ' + escHtml(e.message) + '<br><button onclick="loadProjectTable()">重试</button></div></td></tr>';
  }
}


// ── Alert List ──

var _alertProjectFilter = null;

async function _resizeProjTable() {
  var wrap = document.getElementById('proj-table-wrap');
  if (!wrap) return;
  var top = wrap.getBoundingClientRect().top;
  var avail = window.innerHeight - top - 32;
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
_origRenderDashboard = renderDashboard;
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
        (a.project_code ? projCodeTag(a.project_code, 'event.stopPropagation();openProject(\'' + escHtml(a.project_code || String(a.project_id)).replace(/'/g, "\\'") + '\')', a.project_name) + ' ' + escHtml(a.project_name || '') : '') +
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


// ── Navigation ──

function openProject(code) {
  sessionStorage.setItem('pm_last_proj_code', code);
  window._pendingProjectCode = code;
  gotoView('detail');
}


// ── Dashboard: Create Local Project Dialog ──

function showDashboardCreateProjectDialog() {
  if (typeof showProjectFormDialog === 'function') {
    showProjectFormDialog(false);
  } else {
    var callback = function() { showProjectFormDialog(false); };
    if (typeof loadViewScript === 'function') {
      loadViewScript('/js/detail.js?v=' + APP_VERSION, callback);
    } else {
      showToast('页面加载中，请稍后重试', 'warn');
    }
  }
}


// ── Ctrl+K shortcut: focus search on dashboard ──

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
