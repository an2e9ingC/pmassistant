/* ═══════════════════════════════════════════════════
   MAIN APP
═══════════════════════════════════════════════════ */
var VIEW_TITLES = { dashboard: '项目总览', detail: '项目详情', topology: '快速检索', reports: '统计报告', logs: '系统日志', users: '用户管理', permissions: '权限管理', config: '数据源配置', 'doc-templates': '文档模板配置', 'standards': '流程规范', 'product-list': '产品总览', 'product-detail': '产品详情', customers: '客户管理', 'customer-detail': '客户详情' };

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
  if (view === 'topology') {
    initTopology();
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
  if (view === 'config') {
    var user = getCurrentUser();
    if (!user || user.role !== 'admin') {
      showToast('数据源配置仅限管理员访问', 'error');
      return;
    }
    initAdmin();
  }
  if (view === 'doc-templates') {
    var user = getCurrentUser();
    if (!user || (user.role !== 'admin' && user.role !== 'pm')) {
      showToast('文档模板配置仅限管理员和项目经理访问', 'error');
      return;
    }
    initDocTemplates();
  }
  if (view === 'standards') {
    var user = getCurrentUser();
    if (!user || (user.role !== 'admin' && user.role !== 'pm')) {
      showToast('流程规范仅限管理员和项目经理访问', 'error');
      return;
    }
    initStandards();
  }
  if (view === 'users') {
    var user = getCurrentUser();
    if (!user || user.role !== 'admin') {
      showToast('用户管理仅限管理员访问', 'error');
      return;
    }
    initUserManagement();
  }
  if (view === 'permissions') {
    var user = getCurrentUser();
    if (!user || user.role !== 'admin') {
      showToast('权限管理仅限管理员访问', 'error');
      return;
    }
    initPermissions();
  }
  if (view === 'product-list') {
    initProductList();
  }
  if (view === 'product-detail') {
    initProductDetail();
  }
  if (view === 'customers') {
    initCustomerManagement();
  }
  if (view === 'customer-detail') {
    initCustomerDetail();
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
var _srcDetails = { zentao: '', gitlab: '', nas: '' };

function updateLinkStatus() {
  API.get('/sync/sources').then(function(sources) {
    if (!sources || !sources.length) return;
    sources.forEach(function(s) {
      var key = s.key;
      if (!_srcStates.hasOwnProperty(key)) return;
      _srcDetails[key] = s.detail || '';
      if (!s.configured) {
        _srcStates[key] = 'pending';
      } else if (s.sync_status === 'success') {
        _srcStates[key] = 'ok';
      } else if (s.sync_status === 'failed') {
        _srcStates[key] = 'err';
      } else {
        _srcStates[key] = 'warn';
      }
    });
    renderSourceTags();
      sources.forEach(function(s) {
      var tip = document.getElementById('src-' + s.key + '-tip');
      if (tip && s.detail) tip.textContent = s.detail;
    });
  }).catch(function(e) {
    console.error('updateLinkStatus failed:', e);
  });
}

function toggleSrcTip(key, e) {
  e.stopPropagation();
  var tip = document.getElementById('src-' + key + '-tip');
  if (!tip) return;
  // Fetch detail on demand if not yet populated
  if (!tip.textContent) {
    tip.textContent = '加载中...';
    API.get('/sync/sources').then(function(sources) {
      var s = sources.find(function(x) { return x.key === key; });
      if (s && s.detail) tip.textContent = s.detail;
      else tip.textContent = '暂无信息';
    }).catch(function() { tip.textContent = '获取失败'; });
  }
  document.querySelectorAll('.src-tag-tip.show').forEach(function(t) { if (t !== tip) t.classList.remove('show'); });
  tip.classList.toggle('show');
}
document.addEventListener('click', function(e) {
  if (!e.target.closest('.src-tag')) document.querySelectorAll('.src-tag-tip.show').forEach(function(t) { t.classList.remove('show'); });
});

function renderSourceTags() {
  var names = { zentao: '禅道', gitlab: 'GitLab', nas: 'NAS' };
  var reasons = {
    zentao: { ok: '', warn: '未同步', err: '同步失败', pending: '待同步' },
    gitlab: { ok: '', warn: '未同步', err: '同步失败', pending: '未配置' },
    nas:    { ok: '', warn: '未同步', err: '同步失败', pending: '未配置' },
  };

  ['zentao', 'gitlab', 'nas'].forEach(function(key) {
    var el = document.getElementById('src-' + key);
    if (!el) return;
    var state = _srcStates[key] || 'pending';
    el.className = 'src-tag ' + state;
    var reason = reasons[key][state] || '';
    var label = el.querySelector('.src-tag-label');
    if (label) label.textContent = names[key] + (reason ? ' ' + reason : '');
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

  // Theme — prefer saved, fallback to system preference
  var t = localStorage.getItem('pm_theme');
  if (!t) {
    var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    t = prefersDark ? 'dark' : 'light';
    localStorage.setItem('pm_theme', t);
  }
  document.documentElement.setAttribute('data-theme', t);
  if (t === 'dark') {
    document.getElementById('theme-lbl').textContent = '深色';
    document.getElementById('theme-toggle').classList.add('on');
  }

  // User display
  var user = getCurrentUser();
  if (user) {
    var initials = (user.username || '').substring(0, 2).toUpperCase();
    document.getElementById('user-avatar').textContent = initials;
    document.getElementById('user-name').textContent = user.username + ' · ' + user.role;
    // Show admin/PM nav items (hide individual items based on role)
    if (user.role === 'admin' || user.role === 'pm') {
      var adminGroup = document.getElementById('nav-group-admin');
      if (adminGroup) adminGroup.style.display = '';
      // PM can only see 文档模板 and 流程规范
      if (user.role !== 'admin') {
        var adminOnlyIds = ['nav-users', 'nav-permissions', 'nav-config', 'nav-logs'];
        adminOnlyIds.forEach(function(id) {
          var el = document.getElementById(id);
          if (el) el.style.display = 'none';
        });
      }
    }
  }

  // Data source status — render defaults immediately, then update
  renderSourceTags();
  updateLinkStatus();
  // Load PMA settings (password verification toggles etc.)
  loadPmaSettings();
  // Poll for auto-sync — show progress if running, notify when done
  var _autoSyncEl = null;
  var _autoSyncStart = 0;
  var _autoSyncKnownRunning = false;
  setInterval(async function() {
    try {
      var p = await API.get('/sync/progress');
      if (p.running) {
        // Don't show auto progress if manual sync UI is already visible
        if (document.getElementById('sync-prog-phase')) return;
        _autoSyncKnownRunning = true;
        if (!_autoSyncEl) {
          // Create progress element (reuse the same pattern as manual sync)
          _autoSyncStart = Date.now();
          _autoSyncEl = document.createElement('div');
          _autoSyncEl.className = 'toast info';
          _autoSyncEl.style.padding = '6px 14px';
          _autoSyncEl.style.maxWidth = '480px';
          _autoSyncEl.innerHTML =
            '<div style="display:flex;align-items:center;gap:8px">' +
              '<div class="sync-spinner" style="width:16px;height:16px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:sync-spin 0.8s linear infinite;flex-shrink:0"></div>' +
              '<span style="font-size:12px;font-weight:540;white-space:nowrap">自动同步</span>' +
              '<span style="font-size:11px;color:var(--muted);white-space:nowrap" id="auto-sync-phase">...</span>' +
              '<span style="font-size:10.5px;color:var(--muted);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" id="auto-sync-stats"></span>' +
              '<span style="font-size:10.5px;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap" id="auto-sync-elapsed">0s</span>' +
            '</div>';
          document.getElementById('toast-container').appendChild(_autoSyncEl);
        }
        // Update progress
        var phaseEl = document.getElementById('auto-sync-phase');
        var statsEl = document.getElementById('auto-sync-stats');
        var et = document.getElementById('auto-sync-elapsed');
        if (phaseEl) phaseEl.textContent = p.phase || '...';
        if (statsEl) {
          var parts = [];
          if (p.projects_total) parts.push('项目 ' + (p.projects_done||0) + '/' + p.projects_total);
          if (p.execs_total) parts.push('执行 ' + (p.execs_done||0) + '/' + p.execs_total);
          if (p.tasks_total) parts.push('任务 ' + p.tasks_total);
          statsEl.textContent = parts.join(' · ') || '';
        }
        if (et) et.textContent = Math.round((Date.now() - _autoSyncStart) / 1000) + 's';
      } else if (_autoSyncKnownRunning && _autoSyncEl) {
        // Sync just finished
        var elapsed = Math.round((Date.now() - _autoSyncStart) / 1000);
        _autoSyncEl.remove();
        _autoSyncEl = null;
        _autoSyncKnownRunning = false;
        // Show completion notification
        API.get('/sync/auto-notify').then(function(n) {
          if (n && n.completed) {
            var msg = '数据已自动更新（' + n.time + '，耗时' + elapsed + 's）';
            var mm = n.mismatches;
            if (mm && (mm.total_unmatched > 0 || mm.total_fuzzy > 0)) {
              var parts = [];
              if (mm.total_unmatched > 0) parts.push(mm.total_unmatched + ' 个非标准阶段');
              if (mm.total_fuzzy > 0) parts.push(mm.total_fuzzy + ' 个模糊匹配');
              msg += ' ⚠ ' + parts.join('，') + '，';
              msg += '影响 ' + (mm.affected_projects || []).length + ' 个项目';
              showToast(msg, 'warn', 8000);
            } else {
              showToast(msg, 'success', 5000);
            }
          }
        }).catch(function() {});
      }
    } catch(ignore) {}
  }, 3000);

  // Navigate to saved view or dashboard
  var lastView = localStorage.getItem('pm_view') || 'dashboard';
  gotoView(lastView);
}

/* User menu */

function toggleUserMenu(e) {
  e.stopPropagation();
  var menu = document.getElementById('user-menu');
  menu.classList.toggle('open');
}

function closeUserMenu() {
  var menu = document.getElementById('user-menu');
  if (menu) menu.classList.remove('open');
}

document.addEventListener('click', function(e) {
  if (!e.target.closest('.user-pill') && !e.target.closest('.user-menu')) {
    closeUserMenu();
  }
});

function changePassword() {
  var html = '<div class="note-dialog-overlay" onclick="if(event.target===this)closePwDialog()">' +
    '<div class="note-dialog">' +
      '<div class="note-dialog-head"><span class="note-dialog-title">修改密码</span>' +
        '<button class="note-dialog-close" onclick="closePwDialog()">&times;</button></div>' +
      '<div style="margin-bottom:10px"><label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px">原密码</label>' +
        '<input class="config-input" id="pw-old" type="password" style="width:100%;box-sizing:border-box"></div>' +
      '<div style="margin-bottom:10px"><label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px">新密码</label>' +
        '<input class="config-input" id="pw-new" type="password" style="width:100%;box-sizing:border-box"></div>' +
      '<div style="display:flex;justify-content:flex-end;align-items:center;gap:10px;margin-top:12px">' +
        '<span id="pw-msg" style="font-size:11px"></span>' +
        '<button class="btn" onclick="closePwDialog()">取消</button>' +
        '<button class="btn btn-primary" onclick="submitPassword()">保存</button></div>' +
    '</div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
}

function closePwDialog() {
  var overlay = document.querySelector('.note-dialog-overlay');
  if (overlay) overlay.remove();
}

async function submitPassword() {
  var oldPw = document.getElementById('pw-old').value;
  var newPw = document.getElementById('pw-new').value;
  if (!oldPw || !newPw) return;
  var msg = document.getElementById('pw-msg');
  try {
    msg.innerHTML = '<span style="color:var(--muted)">保存中...</span>';
    await API.put('/auth/password', { old_password: oldPw, new_password: newPw });
    closePwDialog();
    showToast('密码已更新', 'success');
  } catch(e) {
    msg.innerHTML = '<span style="color:var(--danger)">' + escHtml(e.message) + '</span>';
  }
}

document.addEventListener('DOMContentLoaded', init);
