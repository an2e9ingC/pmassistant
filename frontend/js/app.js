/* ═══════════════════════════════════════════════════
   MAIN APP
═══════════════════════════════════════════════════ */
var VIEW_TITLES = { dashboard: '项目总览', detail: '项目详情', mapping: '产品↔项目映射', reports: '统计报告', logs: '系统日志', 'product-list': '产品列表', 'product-detail': '产品详情', 'project-products': '项目关联产品', 'product-projects': '产品关联项目', 'customer-projects': '客户关联项目' };

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
  if (view === 'product-list') {
    initProductList();
  }
  if (view === 'product-detail') {
    initProductDetail();
  }
  if (view === 'project-products') {
    initProjectProducts();
  }
  if (view === 'product-projects') {
    initProductProjects();
  }
  if (view === 'customer-projects') {
    initCustomerProjects();
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

/* Data Source Status — topbar tags */

var _srcStates = { zentao: 'pending', gitlab: 'pending', nas: 'pending' };

function updateLinkStatus() {
  API.get('/sync/sources').then(function(sources) {
    if (!sources || !sources.length) return;
    sources.forEach(function(s) {
      var key = s.key;
      if (!_srcStates.hasOwnProperty(key)) return;
      if (!s.configured) {
        _srcStates[key] = 'pending'; // 未配置
      } else if (s.sync_status === 'success') {
        _srcStates[key] = 'ok';
      } else if (s.sync_status === 'failed') {
        _srcStates[key] = 'err';
      } else {
        _srcStates[key] = 'warn'; // configured but not synced yet
      }
    });
    renderSourceTags();
  }).catch(function() {});
}

function renderSourceTags() {
  var names = { zentao: '禅道', gitlab: 'GitLab', nas: 'NAS' };
  var reasons = {
    zentao: { ok: '', warn: '未同步', err: '同步失败', pending: '待同步' },
    gitlab: { ok: '', warn: '未同步', err: '同步失败', pending: '未配置' },
    nas:    { ok: '', warn: '未同步', err: '同步失败', pending: '未配置' },
  };
  var todoTitles = {
    gitlab: 'TODO：GitLab集成待实现——commit统计、release版本验证（Phase 3，需GITLAB_TOKEN）',
    nas: 'TODO：NAS集成待实现——售前项目检测、交付文档扫描（Phase 3，需NAS路径配置）',
  };
  ['zentao', 'gitlab', 'nas'].forEach(function(key) {
    var el = document.getElementById('src-' + key);
    if (!el) return;
    var state = _srcStates[key] || 'pending';
    el.className = 'src-tag ' + state;
    var reason = reasons[key][state] || '';
    el.textContent = names[key] + (reason ? ' ' + reason : '');
    el.title = (state === 'pending' && todoTitles[key]) ? todoTitles[key] : (names[key] + '：' + (reason || '已同步'));
  });
}

/* Notification Dropdown — shows recent toasts + system alerts */

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
  dd.classList.add('open');

  // Clear unread count when user opens the dropdown
  clearBellUnread();

  // Show queued notifications first (from toasts)
  var html = '';
  var queue = _notifQueue || [];
  if (queue.length) {
    html += '<div style="font-size:10.5px;color:var(--muted);padding:8px 14px 4px">最近消息</div>';
    queue.slice(0, 10).forEach(function(n) {
      var dotColors = { error: 'var(--danger)', warn: 'var(--warn)', success: 'var(--success)', info: 'var(--accent)' };
      var dot = dotColors[n.type] || 'var(--muted)';
      html += '<div class="notif-item">' +
        '<div style="width:6px;height:6px;border-radius:50%;background:' + dot + ';flex-shrink:0;margin-top:5px"></div>' +
        '<div style="min-width:0"><div style="font-size:12px;line-height:1.4">' + escHtml(n.message) + '</div>' +
        '<div style="font-size:10px;color:var(--muted)">' + (n.time || '') + '</div></div>' +
      '</div>';
    });
  }

  // Also fetch system alerts from API
  try {
    var data = await API.get('/dashboard/alerts?limit=5');
    var alerts = data.items || [];
    if (alerts.length) {
      html += '<div style="font-size:10.5px;color:var(--muted);padding:8px 14px 4px">系统告警</div>';
      alerts.forEach(function(a) {
        var dotColor = a.severity === 'red' ? 'var(--danger)' : 'var(--warn)';
        html += '<div class="notif-item" onclick="openProject(\'' + a.project_id + '\');closeNotifDropdown()">' +
          '<div style="width:6px;height:6px;border-radius:50%;background:' + dotColor + ';flex-shrink:0;margin-top:5px"></div>' +
          '<div style="min-width:0"><div style="font-size:12px;line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHtml(a.message) + '</div>' +
          '<div style="font-size:10.5px;color:var(--muted)">' + escHtml(a.project_code || '') + '</div></div>' +
        '</div>';
      });
    }
  } catch(e) { /* non-critical */ }

  if (!html) {
    listEl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);font-size:12px">暂无通知</div>';
  } else {
    listEl.innerHTML = html;
  }
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

  // Data source status — render defaults immediately, then update
  renderSourceTags();
  updateLinkStatus();

  // Navigate to saved view or dashboard
  var lastView = localStorage.getItem('pm_view') || 'dashboard';
  gotoView(lastView);
}

document.addEventListener('DOMContentLoaded', init);
