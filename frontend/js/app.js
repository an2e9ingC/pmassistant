/* ═══════════════════════════════════════════════════
   MAIN APP
═══════════════════════════════════════════════════ */
var VIEW_TITLES = { dashboard: '项目总览', detail: '项目详情', topology: '快速检索', reports: '统计报告', logs: '系统日志', users: '用户管理', permissions: '权限管理', config: '数据源配置', 'doc-templates': '文档模板配置', 'standards': '流程规范', 'product-list': '产品总览', 'product-detail': '产品详情', 'gitlab-releases': 'GitLab 发布', customers: '客户管理', 'customer-detail': '客户详情' };

// Permission requirements per view (for debug display)
var VIEW_PERMS = {
  dashboard: '登录即可', detail: '登录即可', topology: '登录即可', reports: '登录即可',
  logs: 'admin', users: 'admin', permissions: 'admin', config: 'admin',
  'doc-templates': 'doc_template', standards: 'doc_template',
  'product-list': '登录即可', 'product-detail': '登录即可',
  customers: 'customer_link', 'customer-detail': '登录即可',
};

var _pageDirty = false;
function markPageDirty() { _pageDirty = true; }
function markPageClean() { _pageDirty = false; }
function isPageDirty() { return _pageDirty; }

var _navigatingBack = false;

function gotoView(view, pushState) {
  // Check auth
  if (!isLoggedIn()) {
    window.location.href = '/login';
    return;
  }

  // Warn if unsaved changes
  if (_pageDirty) {
    if (!confirm('当前页面有未保存的修改，是否放弃并切换页面？')) return;
    _pageDirty = false;
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
  var title = VIEW_TITLES[view] || '';
  // Permission debug overlay (globally toggled via permissions page)
  if (window._debugPermEnabled) {
    var user = getCurrentUser();
    // 当前: user's role label
    var roleKey = user ? (user.role || '?') : '未登录';
    var roleLabels = window._roleLabels || {};
    var currentLabel = roleLabels[roleKey] || roleKey;
    // 需: roles that have the required permission
    var permKey = VIEW_PERMS[view] || '?';
    var permRoles = window._permRoles || {};
    var requiredLabel = (permRoles[permKey] || []).join(', ') || permKey;
    title += ' <span style="font-size:11px;color:var(--muted);font-weight:400;margin-left:8px">[需: ' + requiredLabel + ' | 当前: ' + currentLabel + ']</span>';
  }
  document.getElementById('topbar-title').innerHTML = title;

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
    var perms = (user && user.permissions) ? user.permissions.split(',') : [];
    if (!user || (user.role !== 'admin' && perms.indexOf('doc_template') < 0)) {
      showToast('文档模板需要 doc_template 权限', 'error');
      return;
    }
    initDocTemplates();
  }
  if (view === 'standards') {
    var user = getCurrentUser();
    var perms = (user && user.permissions) ? user.permissions.split(',') : [];
    if (!user || (user.role !== 'admin' && perms.indexOf('doc_template') < 0)) {
      showToast('流程规范需要 doc_template 权限', 'error');
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
  if (view === 'gitlab-releases') {
    initGitLabReleases();
  }
  if (view === 'product-list') {
    initProductList();
  }
  if (view === 'product-detail') {
    initProductDetail();
  }
  if (view === 'customers') {
    var user = getCurrentUser();
    var perms = (user && user.permissions) ? user.permissions.split(',') : [];
    if (!user || (user.role !== 'admin' && perms.indexOf('customer_link') < 0)) {
      showToast('客户管理需要 customer_link 权限', 'error');
      return;
    }
    initCustomerManagement();
  }
  if (view === 'customer-detail') {
    initCustomerDetail();
  }
  localStorage.setItem('pm_view', view);

  // Browser history: push state unless navigating back/forward or initial load
  if (pushState !== false && !_navigatingBack) {
    var url = '#/' + view;
    if (window.location.hash !== url) {
      history.pushState({ view: view }, '', url);
    }
  }
}

// Handle browser back/forward buttons
window.addEventListener('popstate', function(e) {
  if (e.state && e.state.view) {
    _navigatingBack = true;
    gotoView(e.state.view, false);
    _navigatingBack = false;
  }
});

/* Theme */

/* Feedback Dialog — create GitLab issue (bug/feature) */

var _fbComponents = [];  // selected component labels

var _FB_COMPONENTS = [
  { label: '前端UI',     tag: 'frontend',     color: 'var(--accent)' },
  { label: '后端API',    tag: 'backend',      color: 'var(--success)' },
  { label: '甘特图',     tag: 'gantt',        color: 'var(--warn)' },
  { label: '文档模板',   tag: 'doc-template', color: 'var(--danger)' },
  { label: '数据同步',   tag: 'sync',         color: '#8b5cf6' },
  { label: '权限',       tag: 'auth',         color: '#ec4899' },
  { label: 'GitLab集成', tag: 'gitlab',       color: '#f97316' },
  { label: '产品管理',   tag: 'product',      color: '#06b6d4' },
  { label: '交付管理',   tag: 'delivery',     color: '#84cc16' },
  { label: '统计报表',   tag: 'reports',      color: '#6366f1' },
];

function openFeedbackDialog() {
  _fbComponents = [];
  // Inject chip styles once
  if (!document.getElementById('fb-chip-styles')) {
    var styleEl = document.createElement('style');
    styleEl.id = 'fb-chip-styles';
    styleEl.textContent = '.fb-chip{cursor:pointer;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:500;border:1.5px solid var(--border);color:var(--muted);transition:all 0.15s;user-select:none} .fb-chip:hover{border-color:var(--chip-color,var(--accent));color:var(--chip-color,var(--accent))} .fb-chip.active{background:var(--chip-color,var(--accent));color:#fff;border-color:var(--chip-color,var(--accent))}';
    document.head.appendChild(styleEl);
  }
  var chipsHtml = _FB_COMPONENTS.map(function(c) {
    return '<span class="fb-chip" data-tag="' + c.tag + '" onclick="toggleFbChip(this)" style="--chip-color:' + c.color + '">' + c.label + '</span>';
  }).join('');

  var html = '<div class="note-dialog-overlay">' +
    '<div class="note-dialog" style="max-width:500px">' +
      '<div class="note-dialog-head"><span class="note-dialog-title">提交反馈</span>' +
        '<a href="http://192.168.0.128/bsp_dev/fake_it/pma/-/issues" target="_blank" class="zentao-link" title="在 GitLab 中查看所有 Issue">↗ GitLab</a>' +
        '<button class="note-dialog-close" onclick="closeFeedbackDialog()">&times;</button></div>' +
      '<div style="margin-bottom:12px">' +
        '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">类型</label>' +
        '<span class="tabs" style="display:inline-flex">' +
          '<span class="tab active" id="fb-type-bug" onclick="selectFeedbackType(\'bug\')" style="color:var(--muted);border-color:var(--border)">🐛 Bug 报告</span>' +
          '<span class="tab" id="fb-type-feature" onclick="selectFeedbackType(\'feature\')" style="color:var(--muted);border-color:var(--border)">💡 功能建议</span>' +
        '</span>' +
      '</div>' +
      '<div style="margin-bottom:12px">' +
        '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">组件（可多选）</label>' +
        '<div style="display:flex;flex-wrap:wrap;gap:6px">' + chipsHtml + '</div>' +
      '</div>' +
      '<div style="margin-bottom:12px">' +
        '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">标题</label>' +
        '<input class="search-inp" id="fb-title" placeholder="简要描述问题或建议..." style="width:100%;box-sizing:border-box">' +
      '</div>' +
      '<div style="margin-bottom:12px">' +
        '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">详细描述 <span style="font-weight:400">（可选）</span></label>' +
        '<textarea class="search-inp" id="fb-desc" rows="4" placeholder="请详细描述遇到的问题或期望的功能（可选）..." style="width:100%;box-sizing:border-box;resize:vertical"></textarea>' +
      '</div>' +
      '<div style="margin-bottom:12px">' +
        '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">指派给</label>' +
        '<select id="fb-assignee" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--fg);font-size:13px">' +
          '<option value="">— 自动指派（最近提交者）—</option>' +
        '</select>' +
      '</div>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px">' +
        '<button class="btn" onclick="closeFeedbackDialog()">取消</button>' +
        '<button class="btn btn-primary" id="fb-submit" onclick="submitFeedback()">提交</button>' +
      '</div>' +
    '</div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
  window._fbType = 'bug';
  selectFeedbackType('bug');
  loadFeedbackMembers();
  document.getElementById('fb-title').focus();
}

function toggleFbChip(el) {
  var tag = el.getAttribute('data-tag');
  var idx = _fbComponents.indexOf(tag);
  if (idx >= 0) {
    _fbComponents.splice(idx, 1);
    el.classList.remove('active');
  } else {
    _fbComponents.push(tag);
    el.classList.add('active');
  }
}

async function loadFeedbackMembers() {
  var sel = document.getElementById('fb-assignee');
  if (!sel) return;
  try {
    var data = await API.get('/gitlab/members');
    var members = (data && data.members) ? data.members : (Array.isArray(data) ? data : []);
    var defaultId = (data && data.default_assignee_id) || null;
    if (members.length) {
      members.forEach(function(m) {
        var opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.name + ' (@' + m.username + ')';
        if (m.id === defaultId) opt.selected = true;
        sel.appendChild(opt);
      });
    } else {
      sel.innerHTML = '<option value="">— 无可用成员 —</option>';
    }
  } catch (e) {
    sel.innerHTML = '<option value="">— 加载失败 —</option>';
  }
}

function closeFeedbackDialog() {
  var overlay = document.querySelector('.note-dialog-overlay');
  if (overlay) overlay.remove();
}

function selectFeedbackType(type) {
  window._fbType = type;
  var bugEl = document.getElementById('fb-type-bug');
  var featEl = document.getElementById('fb-type-feature');
  // Bug tab
  bugEl.classList.toggle('active', type === 'bug');
  bugEl.style.background = type === 'bug' ? 'var(--danger-lt)' : '';
  bugEl.style.color = type === 'bug' ? 'var(--danger)' : 'var(--muted)';
  bugEl.style.borderColor = type === 'bug' ? 'var(--danger)' : 'var(--border)';
  bugEl.style.fontWeight = type === 'bug' ? '600' : '';
  // Feature tab
  featEl.classList.toggle('active', type === 'feature');
  featEl.style.background = type === 'feature' ? 'var(--accent-lt)' : '';
  featEl.style.color = type === 'feature' ? 'var(--accent)' : 'var(--muted)';
  featEl.style.borderColor = type === 'feature' ? 'var(--accent)' : 'var(--border)';
  featEl.style.fontWeight = type === 'feature' ? '600' : '';
}

async function submitFeedback() {
  var title = document.getElementById('fb-title').value.trim();
  var desc = document.getElementById('fb-desc').value.trim();
  if (!title) { showToast('请输入标题', 'error'); return; }

  var btn = document.getElementById('fb-submit');
  btn.disabled = true; btn.textContent = '提交中...';

  try {
    var user = getCurrentUser();
    var assigneeEl = document.getElementById('fb-assignee');
    var assigneeId = assigneeEl ? parseInt(assigneeEl.value) || null : null;
    var componentLabels = _fbComponents.length ? _fbComponents.join(',') : '';
    var result = await API.post('/gitlab/issues', {
      issue_type: window._fbType || 'bug',
      title: title,
      description: desc,
      reporter: user ? (user.username || '') : '',
      assignee_id: assigneeId,
      labels: componentLabels
    });
    closeFeedbackDialog();
    if (result && result.web_url) {
      showToast('反馈已提交：<a href="' + result.web_url + '" target="_blank" style="color:var(--success);text-decoration:underline">' + result.web_url + '</a>', 'success', 6000, true, '反馈已提交: ' + result.web_url);
    } else {
      showToast('反馈已提交', 'success');
    }
  } catch (e) {
    showToast('提交失败: ' + (e.message || '未知错误'), 'error');
  } finally {
    btn.disabled = false; btn.textContent = '提交';
  }
}

function toggleTheme() {
  var dark = document.documentElement.getAttribute('data-theme') === 'dark';
  var next = dark ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  // Sidebar (kept for backward compat, may be null after move to user menu)
  var lbl = document.getElementById('theme-lbl');
  if (lbl) lbl.textContent = next === 'dark' ? '深色' : '浅色';
  var tgl = document.getElementById('theme-toggle');
  if (tgl) tgl.classList.toggle('on', next === 'dark');
  // User menu
  var menuLbl = document.getElementById('theme-menu-lbl');
  if (menuLbl) menuLbl.textContent = next === 'dark' ? '切换浅色主题' : '切换深色主题';
  var menuIcon = document.getElementById('theme-menu-icon');
  if (menuIcon && next === 'dark') {
    menuIcon.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 1a7 7 0 1 0 0 14 5.5 5.5 0 0 1 0-11z"/></svg>';
  } else if (menuIcon) {
    menuIcon.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.2 3.2l1 1M11.8 11.8l1 1M11.8 3.2l-1 1M4.2 11.8l-1 1M5 8a3 3 0 1 0 6 0 3 3 0 0 0-6 0z"/></svg>';
  }
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
    // Pre-fill tips with permission-aware detail
    var user = getCurrentUser();
    var perms = (user && user.permissions) ? user.permissions.split(',') : [];
    var isAdmin = user && user.role === 'admin';
    var canSeeDetail = isAdmin || (user && user.role === 'pm');
    sources.forEach(function(s) {
      var tip = document.getElementById('src-' + s.key + '-tip');
      if (tip) {
        tip.textContent = canSeeDetail ? (s.detail || getSimpleStatus(s)) : getSimpleStatus(s);
      }
    });
  }).catch(function(e) {
    console.error('updateLinkStatus failed:', e);
  });
}

function toggleSrcTip(key, e) {
  e.stopPropagation();
  var tip = document.getElementById('src-' + key + '-tip');
  if (!tip) return;
  if (!tip.textContent) {
    tip.textContent = '加载中...';
    var user = getCurrentUser();
    var perms = (user && user.permissions) ? user.permissions.split(',') : [];
    var isAdmin = user && user.role === 'admin';
    var canSeeDetail = isAdmin || (user && user.role === 'pm');
    API.get('/sync/sources').then(function(sources) {
      var s = sources.find(function(x) { return x.key === key; });
      if (!s) { tip.textContent = '暂无信息'; return; }
      if (canSeeDetail) {
        tip.textContent = s.detail || getSimpleStatus(s);
      } else {
        tip.textContent = getSimpleStatus(s);
      }
    }).catch(function() { tip.textContent = '获取失败'; });
  }
  document.querySelectorAll('.src-tag-tip.show').forEach(function(t) { if (t !== tip) t.classList.remove('show'); });
  tip.classList.toggle('show');
}

function getSimpleStatus(s) {
  var names = { zentao: '禅道', gitlab: 'GitLab', nas: 'NAS' };
  var name = names[s.key] || s.key;
  if (!s.configured) return name + ' 未配置';
  if (s.sync_status === 'success') return name + ' 连接正常';
  if (s.sync_status === 'failed') return name + ' 连接异常';
  return name + ' 待同步';
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
  // Theme toggle moved to user menu — update if elements exist
  var themeLbl = document.getElementById('theme-lbl');
  if (themeLbl) themeLbl.textContent = t === 'dark' ? '深色' : '浅色';
  var themeTgl = document.getElementById('theme-toggle');
  if (themeTgl) themeTgl.classList.toggle('on', t === 'dark');

  // User display
  var user = getCurrentUser();
  if (user) {
    var initials = (user.username || '').substring(0, 2).toUpperCase();
    document.getElementById('user-avatar').textContent = initials;
    document.getElementById('user-name').textContent = user.username + ' · ' + user.role;
    // Show admin nav items based on permissions
    var perms = (user && user.permissions) ? user.permissions.split(',') : [];
    var isAdmin = user && user.role === 'admin';
    var hasAdminAccess = user && (isAdmin || perms.indexOf('doc_template') >= 0);
    if (hasAdminAccess) {
      var adminGroup = document.getElementById('nav-group-admin');
      if (adminGroup) adminGroup.style.display = '';
      // Non-admin: hide admin-only items
      if (!isAdmin) {
        var adminOnlyIds = ['nav-users', 'nav-permissions', 'nav-config', 'nav-logs'];
        adminOnlyIds.forEach(function(id) {
          var el = document.getElementById(id);
          if (el) el.style.display = 'none';
        });
      }
    }

    // Hide nav items for pages user lacks permission to access
    if (!isAdmin && perms.indexOf('customer_link') < 0) {
      var custNav = document.getElementById('nav-customers');
      if (custNav) custNav.style.display = 'none';
    }

    // Show sync button only for users with sync permission
    var syncBtn = document.getElementById('src-sync-btn');
    if (syncBtn && (isAdmin || perms.indexOf('sync') >= 0)) {
      syncBtn.style.display = 'flex';
    }
  }

  // Data source status — render defaults immediately, then update
  renderSourceTags();
  updateLinkStatus();
  // Load PMA settings (password verification toggles etc.)
  loadPmaSettings();
  // Load public settings (debug_perm + role-permission mapping)
  API.get('/admin/settings/public').then(function(d) {
    window._debugPermEnabled = d && d.debug_perm;
    if (d && d.perm_roles) window._permRoles = d.perm_roles;
    if (d && d.role_labels) window._roleLabels = d.role_labels;
  }).catch(function() {});

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
        // Detect phase transitions for per-source notifications
        var phase = p.phase || '';
        if (!_zentaoNotified && phase && (phase === '发布版本' || phase === 'GitLab校验')) {
          _zentaoNotified = true;
          API.get('/sync/auto-notify').then(function(n) {
            if (n && n.zentao && n.zentao.status !== 'pending') {
              _notifySource('禅道', n.zentao.status, n.zentao.summary);
            }
          }).catch(function() {});
        }
        if (!_gitlabNotified && _autoLastPhase === 'GitLab校验' && phase && phase !== 'GitLab校验' && phase !== '发布版本') {
          _gitlabNotified = true;
          API.get('/sync/auto-notify').then(function(n) {
            if (n && n.gitlab && n.gitlab.status !== 'pending') {
              _notifySource('GitLab', n.gitlab.status, n.gitlab.summary);
            }
          }).catch(function() {});
        }
        _autoLastPhase = phase;
        if (phaseEl) phaseEl.textContent = p.phase || '...';
        if (statsEl) {
          var parts = [];
          if (p.projects_total) parts.push('项目 ' + (p.projects_done||0) + '/' + p.projects_total);
          if (p.execs_total) parts.push('执行 ' + (p.execs_done||0) + '/' + p.execs_total);
          if (p.tasks_total) parts.push('任务 ' + p.tasks_total);
          // GitLab phases don't have counters yet, just show phase name
          if (p.phase === '发布版本' || p.phase === 'GitLab校验') parts.push(p.phase);
          statsEl.textContent = parts.join(' · ') || '';
        }
        if (et) et.textContent = Math.round((Date.now() - _autoSyncStart) / 1000) + 's';
      } else if (_autoSyncKnownRunning && _autoSyncEl) {
        // Sync just finished — show per-source toasts
        var elapsed = Math.round((Date.now() - _autoSyncStart) / 1000);
        _autoSyncEl.remove();
        _autoSyncEl = null;
        _autoSyncKnownRunning = false;
        API.get('/sync/auto-notify').then(function(n) {
          if (!n || !n.completed) return;
          // Show remaining sources not yet notified
          if (!_zentaoNotified && n.zentao && n.zentao.status !== 'pending') {
            _notifySource('禅道', n.zentao.status, n.zentao.summary);
          }
          if (!_gitlabNotified && n.gitlab && n.gitlab.status !== 'pending') {
            _notifySource('GitLab', n.gitlab.status, n.gitlab.summary);
          }
          if (n.nas && n.nas.status !== 'pending') {
            _notifySource('NAS', n.nas.status, n.nas.summary);
          }
          // Stage mismatch warning
          var mm = n.mismatches;
          if (mm && (mm.total_unmatched > 0 || mm.total_fuzzy > 0)) {
            var mmParts = [];
            if (mm.total_unmatched > 0) mmParts.push(mm.total_unmatched + ' 个非标准阶段');
            if (mm.total_fuzzy > 0) mmParts.push(mm.total_fuzzy + ' 个模糊匹配');
            showToast('⚠ ' + mmParts.join('，') + '，影响 ' + (mm.affected_projects || []).length + ' 个项目', 'warn', 8000);
          }
          // Reset for next sync
          _zentaoNotified = false;
          _gitlabNotified = false;
          _autoLastPhase = '';
        }).catch(function() {});
      }
    } catch(ignore) {}
  }, 3000);

  // Navigate to saved view or dashboard (respect URL hash first)
  var hashView = window.location.hash.replace('#/', '');
  var lastView = hashView || localStorage.getItem('pm_view') || 'dashboard';
  gotoView(lastView, false);  // don't push state on initial load
  if (!hashView && window.location.hash !== '#/' + lastView) {
    history.replaceState({ view: lastView }, '', '#/' + lastView);
  }

  // Global ESC handler: first ESC blurs input, second closes dialog / clears search
  var _escBlurred = false;
  document.addEventListener('keydown', function(e) {
    if (e.key !== 'Escape') { _escBlurred = false; return; }
    var active = document.activeElement;
    var isInput = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT');
    if (isInput && !_escBlurred) {
      active.blur();
      _escBlurred = true;
      return;
    }
    _escBlurred = false;
    // Clear search inputs (dialogs only close via confirm/cancel buttons)
    var searchInps = document.querySelectorAll('.search-inp');
    var cleared = false;
    searchInps.forEach(function(inp) {
      if (inp.value && inp === document.activeElement) return; // skip focused input
      if (inp.value) { inp.value = ''; inp.dispatchEvent(new Event('input')); cleared = true; }
    });
  });
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
  var html = '<div class="note-dialog-overlay">' +
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
