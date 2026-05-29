/* ═══════════════════════════════════════════════════
   MAIN APP
═══════════════════════════════════════════════════ */
var VIEW_TITLES = { dashboard: '项目总览', detail: '项目详情', mapping: '产品↔项目映射', reports: '统计报告', logs: '系统日志' };

function gotoView(view) {
  // Check auth
  if (!isLoggedIn()) {
    window.location.href = '/login';
    return;
  }

  // Update views
  document.querySelectorAll('.view').forEach(function(v) { v.classList.remove('active'); });
  var viewEl = document.getElementById('view-' + view);
  if (viewEl) viewEl.classList.add('active');

  // Update nav
  document.querySelectorAll('.nav-item').forEach(function(n) { n.classList.remove('active'); });
  var navEl = document.getElementById('nav-' + view);
  if (navEl) navEl.classList.add('active');

  // Update title
  document.getElementById('topbar-title').textContent = VIEW_TITLES[view] || '';

  // View-specific init
  if (view === 'dashboard') {
    renderDashboard();
  }
  if (view === 'detail') {
    loadComboProjects().then(function() {
      if (_comboCurId) {
        loadProjectDetail(_comboCurId);
      }
    });
  }
  if (view === 'mapping') {
    renderMapping();
  }
  if (view === 'reports') {
    renderReports();
  }
  if (view === 'logs') {
    var user = getCurrentUser();
    if (!user || user.role !== 'admin') {
      showToast('系统日志仅限管理员访问', 'error');
      return;
    }
    clearLogAutoRefresh();
    renderLogs();
  }

  localStorage.setItem('pm_view', view);
}

/* Theme */

function toggleTheme() {
  var dark = document.documentElement.getAttribute('data-theme') === 'dark';
  var next = dark ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  document.getElementById('theme-lbl').textContent = next === 'dark' ? '深色' : '浅色';
  document.getElementById('theme-toggle').classList.toggle('on', next === 'dark');
  localStorage.setItem('pm_theme', next);
}

/* Data Source Status */

function updateLinkStatus() {
  API.get('/sync/status').then(function(statuses) {
    if (!statuses || !statuses.length) return;

    // Zentao status
    var zentaoStatus = statuses.find(function(s) { return s.entity_type === 'projects'; });
    updateStatusBadge('status-zentao', zentaoStatus);

    // Overall: check if all entities have recent successful syncs
    var allOk = statuses.every(function(s) { return s.status === 'success'; });
    var partialOk = statuses.some(function(s) { return s.status === 'success'; });
    var nasBadge = document.getElementById('status-nas');
    if (allOk) {
      nasBadge.className = 'link-status-badge ok';
      nasBadge.textContent = '✓ 已配置';
    } else if (partialOk) {
      nasBadge.className = 'link-status-badge warn';
      nasBadge.textContent = '⚠ 部分配置';
    } else {
      nasBadge.className = 'link-status-badge err';
      nasBadge.textContent = '✗ 未配置';
    }

    // GitLab status
    updateStatusBadge('status-gitlab', null);
  }).catch(function() {});
}

function updateStatusBadge(elId, status) {
  var el = document.getElementById(elId);
  if (!el) return;
  if (status && status.status === 'success') {
    el.className = 'link-status-badge ok';
    el.textContent = '✓ 已同步';
  } else if (status && status.status === 'failed') {
    el.className = 'link-status-badge err';
    el.textContent = '✗ 同步失败';
  } else {
    el.className = 'link-status-badge warn';
    el.textContent = '⚠ 未同步';
  }
}

/* Alert Notification Dropdown */

var _notifLoading = false;

async function toggleNotifDropdown(e) {
  if (e) e.stopPropagation();
  var dd = document.getElementById('notif-dropdown');
  if (!dd) return;
  var isOpen = dd.classList.contains('open');
  if (isOpen) {
    dd.classList.remove('open');
    return;
  }
  var listEl = document.getElementById('notif-dropdown-list');
  if (!listEl) return;
  listEl.innerHTML = '<div class="loading-spinner" style="padding:20px">加载中...</div>';
  dd.classList.add('open');
  if (_notifLoading) return;
  _notifLoading = true;
  try {
    var data = await API.get('/dashboard/alerts?limit=5');
    var alerts = data.items || [];
    var pip = document.getElementById('notif-pip');
    if (pip) pip.style.display = alerts.length > 0 ? 'block' : 'none';
    if (!alerts.length) {
      listEl.innerHTML = '<div style="padding:16px;text-align:center;color:var(--muted);font-size:12px">暂无告警</div>';
    } else {
      listEl.innerHTML = alerts.map(function(a) {
        var dotColor = a.severity === 'red' ? 'var(--danger)' : 'var(--warn)';
        return '<div class="notif-item" onclick="openProject(\'' + a.project_id + '\');closeNotifDropdown()">' +
          '<div style="width:6px;height:6px;border-radius:50%;background:' + dotColor + ';flex-shrink:0;margin-top:5px"></div>' +
          '<div style="min-width:0"><div style="font-size:12px;line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHtml(a.message) + '</div>' +
          '<div style="font-size:10.5px;color:var(--muted)">' + escHtml(a.project_code || '') + '</div></div>' +
        '</div>';
      }).join('');
    }
  } catch(e) {
    listEl.innerHTML = '<div style="padding:16px;text-align:center;color:var(--muted);font-size:12px">加载失败</div>';
  }
  _notifLoading = false;
}

function closeNotifDropdown() {
  var dd = document.getElementById('notif-dropdown');
  if (dd) dd.classList.remove('open');
}

document.addEventListener('click', function(e) {
  var dd = document.getElementById('notif-dropdown');
  if (dd && dd.classList.contains('open') && !e.target.closest('.icon-btn') && !e.target.closest('.notif-item')) {
    dd.classList.remove('open');
  }
});

/* Init */

function init() {
  // Auth check
  if (!isLoggedIn() && window.location.pathname !== '/login') {
    window.location.href = '/login';
    return;
  }

  // Theme
  var t = localStorage.getItem('pm_theme') || 'light';
  document.documentElement.setAttribute('data-theme', t);
  if (t === 'dark') {
    document.getElementById('theme-lbl').textContent = '深色';
    document.getElementById('theme-toggle').classList.add('on');
  }

  // User display
  var user = getCurrentUser();
  if (user) {
    var initials = (user.display_name || user.username).substring(0, 2);
    document.getElementById('user-avatar').textContent = initials;
    document.getElementById('user-name').textContent = user.display_name + ' · ' + user.role;
  }

  // Data source status
  updateLinkStatus();

  // Navigate to saved view or dashboard
  var lastView = localStorage.getItem('pm_view') || 'dashboard';
  gotoView(lastView);
}

document.addEventListener('DOMContentLoaded', init);
