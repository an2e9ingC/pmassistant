/* ═══════════════════════════════════════════════════
   MAIN APP
═══════════════════════════════════════════════════ */
var VIEW_TITLES = { dashboard: '项目总览', detail: '项目详情', topology: '快速检索', reports: '统计报告', logs: '系统日志', users: '用户管理', permissions: '权限管理', config: '数据源配置', 'doc-templates': '项目&模板管理', 'standards': '流程规范', 'product-management': '产品管理', 'product-list': '产品总览', 'product-detail': '产品详情', 'gitlab-releases': 'GitLab 发布', 'db-manage': '数据库管理', customers: '客户管理', 'customer-detail': '客户详情', 'notif-manage': '通知管理', 'user-center': '用户中心' };

// Permission requirements per view (for debug display)
var VIEW_PERMS = {
  dashboard: '登录即可', detail: '登录即可', topology: '登录即可', reports: '登录即可',
  logs: 'admin', users: 'admin', permissions: 'admin', config: 'admin',
  'doc-templates': 'doc_template', standards: 'doc_template',
  'db-manage': 'admin', 'product-management': 'product_link', 'product-list': '登录即可', 'product-detail': '登录即可',
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
    // 当前: user's effective permissions (derived from all assigned roles)
    var userPerms = user ? (user.permissions || '').split(',').filter(Boolean) : [];
    var permLabels = {
      'admin': '系统管理', 'sync': '数据同步', 'project_edit': '项目维护',
      'product_link': '产品维护', 'customer_link': '客户维护',
      'doc_template': '文档模板', 'stage_mapping': '阶段映射',
    };
    var currentLabel = userPerms.length
      ? userPerms.map(function(p) { return permLabels[p] || p; }).join(', ')
      : (user ? '仅登录' : '未登录');
    // 需: roles that have the required permission
    var permKey = VIEW_PERMS[view] || '?';
    var permRoles = window._permRoles || {};
    var requiredLabel = (permRoles[permKey] || []).join(', ') || permKey;
    title += ' <span style="font-size:11px;color:var(--muted);font-weight:400;margin-left:8px">[需: ' + requiredLabel + ' | 当前: ' + currentLabel + ']</span>';
  }
  document.getElementById('topbar-title').innerHTML = title;

  // View-specific init
  if (view === 'dashboard') {
    // Show/hide 新建项目 button based on permissions
    var dashNewProjBtn = document.getElementById('dash-new-proj-btn');
    if (dashNewProjBtn) {
      var user = getCurrentUser();
      var perms = (user && user.permissions) ? user.permissions.split(',') : [];
      var isAdmin = user && (user.role === 'admin' || perms.indexOf('admin') >= 0);
      dashNewProjBtn.style.display = isAdmin ? '' : 'none';
    }
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
    var perms = (user && user.permissions) ? user.permissions.split(',') : [];
    if (!user || (user.role !== 'admin' && perms.indexOf('admin') < 0)) {
      showToast('系统日志仅限管理员访问', 'error');
      return;
    }
    clearLogAutoRefresh();
    renderLogs();
  }
  if (view === 'config') {
    var user = getCurrentUser();
    var perms = (user && user.permissions) ? user.permissions.split(',') : [];
    if (!user || (user.role !== 'admin' && perms.indexOf('admin') < 0)) {
      showToast('数据源配置仅限管理员访问', 'error');
      return;
    }
    initAdmin();
  }
  if (view === 'doc-templates') {
    var user = getCurrentUser();
    var perms = (user && user.permissions) ? user.permissions.split(',') : [];
    if (!user || (user.role !== 'admin' && perms.indexOf('doc_template') < 0)) {
      showToast('项目&模板管理需要 doc_template 权限', 'error');
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
  if (view === 'db-manage') {
    var user = getCurrentUser();
    var perms = (user && user.permissions) ? user.permissions.split(',') : [];
    if (!user || (user.role !== 'admin' && perms.indexOf('admin') < 0)) {
      showToast('数据库管理仅限管理员访问', 'error');
      return;
    }
    initDbManage();
  }
  if (view === 'users') {
    var user = getCurrentUser();
    var perms = (user && user.permissions) ? user.permissions.split(',') : [];
    if (!user || (user.role !== 'admin' && perms.indexOf('admin') < 0)) {
      showToast('用户管理仅限管理员访问', 'error');
      return;
    }
    initUserManagement();
  }
  if (view === 'permissions') {
    var user = getCurrentUser();
    var perms = (user && user.permissions) ? user.permissions.split(',') : [];
    if (!user || (user.role !== 'admin' && perms.indexOf('admin') < 0)) {
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
  if (view === 'product-management') {
    var user = getCurrentUser();
    var perms = (user && user.permissions) ? user.permissions.split(',') : [];
    if (!user || (user.role !== 'admin' && perms.indexOf('product_link') < 0)) {
      showToast('产品管理需要 product_link 权限', 'error');
      return;
    }
    initProductManagement();
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
  if (view === 'notif-manage') {
    initNotifManage();
  }
  if (view === 'user-center') {
    initUserCenter();
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

// Color palette per nav group (cycled within group)
var _FB_GROUP_COLORS = {
  '项目': ['var(--accent)', '#3b82f6', '#2563eb'],
  '产品': ['var(--success)', '#059669', '#0d9488'],
  '客户': ['var(--warn)', '#d97706'],
  '工具': ['#8b5cf6', '#6366f1', '#a855f7'],
  '管理': ['#ec4899', '#f43f5e', '#14b8a6', '#f97316', '#84cc16', '#06b6d4', '#64748b'],
};

function buildFeedbackComponents() {
  // Extract nav items from sidebar DOM to mirror the navigation
  var components = [];
  var groups = document.querySelectorAll('.sidebar-nav .nav-group');
  var groupIdx = {};
  groups.forEach(function(group) {
    // Skip hidden groups (e.g. admin group for non-admin users)
    if (group.style.display === 'none') return;
    var label = group.querySelector('.nav-group-label');
    var groupName = label ? label.textContent.trim() : '';
    if (!groupName) return;
    if (!(groupName in groupIdx)) groupIdx[groupName] = 0;
    var items = group.querySelectorAll('.nav-item');
    items.forEach(function(item) {
      // Skip hidden items (e.g. admin-only nav for non-admin users)
      if (item.style.display === 'none') return;
      var id = item.id.replace('nav-', '');
      var text = item.textContent.trim();
      // Strip badge text from nav label
      var badge = item.querySelector('.nav-badge');
      if (badge) text = text.replace(badge.textContent, '').trim();
      var colors = _FB_GROUP_COLORS[groupName] || ['var(--muted)'];
      var color = colors[groupIdx[groupName] % colors.length];
      components.push({ label: text, tag: id, color: color });
      groupIdx[groupName]++;
    });
  });

  // Extra components beyond sidebar navigation
  components.push({ label: '问题反馈',   tag: 'feedback',    color: '#f59e0b' });
  components.push({ label: '顶部通知栏', tag: 'notification', color: '#ef4444' });
  components.push({ label: '个人中心',   tag: 'profile',      color: '#10b981' });
  components.push({ label: '其他',       tag: 'other',        color: 'var(--muted)' });

  return components;
}

function openFeedbackDialog() {
  _fbComponents = [];
  var user = getCurrentUser();
  var reporterName = user ? (user.display_name || user.username || '') : '';
  // Fetch version info for diagnostic context
  var versionInfo = '';
  API.get('/admin/system-info').then(function(info) {
    if (info) {
      versionInfo = (info.version || '?') + ' (' + (info.commit || '?') + ')';
      var el = document.getElementById('fb-version');
      if (el) el.textContent = versionInfo;
    }
  }).catch(function() {});
  // Inject chip styles once
  if (!document.getElementById('fb-chip-styles')) {
    var styleEl = document.createElement('style');
    styleEl.id = 'fb-chip-styles';
    styleEl.textContent = '.fb-chip{cursor:pointer;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:500;border:1.5px solid var(--border);color:var(--muted);transition:all 0.15s;user-select:none} .fb-chip:hover{border-color:var(--chip-color,var(--accent));color:var(--chip-color,var(--accent))} .fb-chip.active{background:var(--chip-color,var(--accent));color:#fff;border-color:var(--chip-color,var(--accent))}';
    document.head.appendChild(styleEl);
  }
  var chipsHtml = buildFeedbackComponents().map(function(c) {
    return '<span class="fb-chip" data-tag="' + c.tag + '" data-label="' + escHtml(c.label) + '" onclick="toggleFbChip(this)" style="--chip-color:' + c.color + '">' + c.label + '</span>';
  }).join('');

  var html = '<div class="note-dialog-overlay">' +
    '<div class="note-dialog" style="max-width:500px">' +
      '<div class="note-dialog-head"><span class="note-dialog-title">提交反馈 <a href="http://192.168.0.128/bsp_dev/fake_it/pma/-/issues" target="_blank" class="zentao-link" title="在 GitLab 中查看所有 Issue">↗ GitLab</a></span>' +
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
        '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">反馈人 <span style="font-weight:400">（默认当前登录用户）</span></label>' +
        '<input class="search-inp" id="fb-reporter" value="' + escHtml(reporterName) + '" readonly style="width:100%;box-sizing:border-box;background:var(--bg);cursor:not-allowed">' +
      '</div>' +
      '<div style="margin-bottom:12px">' +
        '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">版本信息</label>' +
        '<div id="fb-version" style="font-size:11.5px;font-family:JetBrains Mono,monospace;color:var(--muted);padding:6px 10px;background:var(--bg);border-radius:6px;border:1px solid var(--border)">加载中...</div>' +
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
  var label = el.getAttribute('data-label') || tag;
  var idx = -1;
  for (var i = 0; i < _fbComponents.length; i++) {
    if (_fbComponents[i].tag === tag) { idx = i; break; }
  }
  if (idx >= 0) {
    _fbComponents.splice(idx, 1);
    el.classList.remove('active');
  } else {
    _fbComponents.push({ tag: tag, label: label });
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
  var reporterEl = document.getElementById('fb-reporter');
  var reporter = reporterEl ? reporterEl.value.trim() : '';
  var versionEl = document.getElementById('fb-version');
  var versionInfo = versionEl ? versionEl.textContent : '';
  if (!title) { showToast('请输入标题', 'error'); return; }

  // Prepend selected component labels to title as [标签] prefix
  if (_fbComponents.length) {
    var prefix = _fbComponents.map(function(c) { return '[' + c.label + ']'; }).join('');
    title = prefix + ' ' + title;
  }

  // Append version info to description
  var fullDesc = desc || '';
  if (versionInfo && versionInfo !== '加载中...') {
    fullDesc += '\n\n**版本信息**: ' + versionInfo;
  }

  var btn = document.getElementById('fb-submit');
  btn.disabled = true; btn.textContent = '提交中...';

  try {
    var assigneeEl = document.getElementById('fb-assignee');
    var assigneeId = assigneeEl ? parseInt(assigneeEl.value) || null : null;
    var componentLabels = _fbComponents.length ? _fbComponents.map(function(c) { return c.tag; }).join(',') : '';
    var result = await API.post('/gitlab/issues', {
      issue_type: window._fbType || 'bug',
      title: title,
      description: fullDesc,
      reporter: reporter,
      assignee_id: assigneeId,
      labels: componentLabels
    });
    closeFeedbackDialog();
    if (result && result.web_url) {
      showToast('反馈已提交：<a href="' + result.web_url + '" target="_blank" style="color:var(--success);text-decoration:underline">' + result.web_url + '</a>', 'success', 8000, true, '反馈已提交: ' + result.web_url);
      if (result.fallback) {
        setTimeout(function() {
          showToast('你的 GitLab 授权已过期，Issue 以系统账户提交。<br>请<a href="javascript:void(0)" onclick="switchAccount()" style="color:var(--warn);text-decoration:underline">重新登录</a>以本人身份提交', 'warn', 8000, true);
        }, 1000);
      }
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
  localStorage.setItem('pm_theme_mode', next);
  _applyTheme(next);
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
    var isAdmin = user && (user.role === 'admin' || perms.indexOf('admin') >= 0);
    var canSeeDetail = isAdmin || perms.indexOf('project_edit') >= 0 || perms.indexOf('doc_template') >= 0;
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
    var isAdmin = user && (user.role === 'admin' || perms.indexOf('admin') >= 0);
    var canSeeDetail = isAdmin || perms.indexOf('project_edit') >= 0 || perms.indexOf('doc_template') >= 0;
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

/* ═══════════════════════════════════════════════════
   BROADCAST NOTIFICATION BAR
═══════════════════════════════════════════════════ */

function showPublishNotifButton(user) {
  var btn = document.getElementById('btn-publish-notif');
  if (!btn) return;
  btn.style.display = user ? '' : 'none';
}

function openPublishNotifDialog() {
  var user = getCurrentUser();
  if (!user) return;
  var perms = (user.permissions || '').split(',');
  var isAdmin = perms.indexOf('admin') >= 0;

  var levelOpts = [
    '<option value="general" style="color:#3b82f6">● 一般（蓝色，可关闭）</option>',
    '<option value="important" style="color:#e6a817">● 重要（黄色，可关闭）</option>',
  ];
  if (isAdmin) {
    levelOpts.push('<option value="severe" style="color:var(--danger)">● 严重（红色常驻，不可关闭）</option>');
  }

  var levelHints = {
    general: '一般通知：蓝色，用户可自行关闭',
    important: '重要通知：黄色，用户可自行关闭',
    severe: '严重通知：红色常驻，用户不可关闭',
  };

  var levelColors = {
    general: '#3b82f6',
    important: '#e6a817',
    severe: '#e53e3e',
  };

  var html = '<div class="note-dialog-overlay">' +
    '<div class="note-dialog" style="max-width:480px">' +
      '<div class="note-dialog-head"><span class="note-dialog-title">发布通知</span>' +
        '<button class="note-dialog-close" onclick="closePwDialog()">&times;</button></div>' +
      '<div style="padding:4px 0">' +
        '<div class="user-form-field">' +
          '<label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px">通知级别</label>' +
          '<select class="config-input" id="notif-level" onchange="updateNotifLevelHint()" style="width:100%;box-sizing:border-box">' +
            levelOpts.join('') +
          '</select>' +
        '</div>' +
        '<div class="user-form-field">' +
          '<label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px">通知内容</label>' +
          '<input class="config-input" id="notif-content" type="text" maxlength="32" placeholder="请输入通知内容，最多32字" oninput="updateNotifCharCount()" style="width:100%;box-sizing:border-box">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px">' +
            '<span id="notif-level-hint" style="font-size:11px;color:var(--muted)">' + levelHints.general + '</span>' +
            '<span id="notif-char-count" style="font-size:11px;color:var(--muted)">0/32</span>' +
          '</div>' +
        '</div>' +
        '<div id="notif-preview" style="margin-top:8px;padding:6px 12px;border-radius:6px;font-size:12px;color:#fff;background:var(--accent);display:none"></div>' +
      '</div>' +
      '<div style="display:flex;justify-content:flex-end;align-items:center;gap:10px;margin-top:12px">' +
        '<span id="notif-msg" style="font-size:11px"></span>' +
        '<button class="btn" onclick="closePwDialog()">取消</button>' +
        '<button class="btn btn-primary" id="notif-submit-btn" onclick="submitPublishNotif()">发布</button></div>' +
    '</div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
  updateNotifLevelHint();
}

function updateNotifLevelHint() {
  var level = document.getElementById('notif-level');
  var hint = document.getElementById('notif-level-hint');
  var preview = document.getElementById('notif-preview');
  if (!level || !hint) return;
  var colors = {
    general: '#3b82f6',
    important: '#e6a817',
    severe: '#e53e3e',
  };
  var hints = {
    general: '一般通知：蓝色，用户可自行关闭',
    important: '重要通知：黄色，用户可自行关闭',
    severe: '严重通知：红色常驻，用户不可关闭，只能由发布者或管理员关闭',
  };
  // Style select with level color
  var c = colors[level.value] || '#3b82f6';
  level.style.color = c;
  level.style.borderColor = c;
  hint.textContent = hints[level.value] || '';
  hint.style.color = c;
  if (preview) {
    preview.style.background = c;
  }
  updateNotifCharCount();
}

function updateNotifCharCount() {
  var input = document.getElementById('notif-content');
  var count = document.getElementById('notif-char-count');
  var preview = document.getElementById('notif-preview');
  if (!input || !count) return;
  var len = input.value.length;
  count.textContent = len + '/32';
  count.style.color = len > 32 ? 'var(--danger)' : 'var(--muted)';
  if (preview) {
    if (input.value) {
      preview.style.display = '';
      var user = getCurrentUser();
      preview.textContent = input.value + ' [@' + (user ? user.username : '') + ']';
    } else {
      preview.style.display = 'none';
    }
  }
}

async function submitPublishNotif() {
  var level = document.getElementById('notif-level').value;
  var content = document.getElementById('notif-content').value.trim();
  var msg = document.getElementById('notif-msg');
  var btn = document.getElementById('notif-submit-btn');

  if (!content) { msg.innerHTML = '<span style="color:var(--danger)">请输入通知内容</span>'; return; }
  if (content.length > 32) { msg.innerHTML = '<span style="color:var(--danger)">通知内容不能超过32字</span>'; return; }

  btn.disabled = true;
  btn.textContent = '发布中...';
  msg.innerHTML = '';

  try {
    await API.post('/notifications', { level: level, content: content });
    closePwDialog();
    showToast('通知已发布', 'success');
    loadNotifBar();
  } catch(e) {
    msg.innerHTML = '<span style="color:var(--danger)">' + escHtml(e.message) + '</span>';
    btn.disabled = false;
    btn.textContent = '发布';
  }
}

function _dismissedNotifIds() {
  try {
    return JSON.parse(localStorage.getItem('pma_dismissed_notifs') || '[]');
  } catch(e) { return []; }
}

function _addDismissedNotifId(id) {
  var ids = _dismissedNotifIds();
  if (ids.indexOf(id) < 0) ids.push(id);
  // Keep only last 100 to avoid unlimited growth
  if (ids.length > 100) ids = ids.slice(-100);
  localStorage.setItem('pma_dismissed_notifs', JSON.stringify(ids));
}

async function loadNotifBar() {
  try {
    var data = await API.get('/notifications');
    var bar = document.getElementById('notif-bar');
    if (!bar) return;
    // Filter out personally dismissed notifications
    var dismissedIds = _dismissedNotifIds();
    data = (data || []).filter(function(n) { return dismissedIds.indexOf(n.id) < 0; });
    if (!data || data.length === 0) {
      bar.style.display = 'none';
      bar.innerHTML = '';
      return;
    }
    bar.style.display = '';
    bar.innerHTML = data.map(function(n) {
      var closable = n.level !== 'severe';
      var cls = 'notif-bar-item notif-bar-' + n.level;
      var closeBtn = closable
        ? '<button class="notif-close" onclick="dismissNotif(' + n.id + ')" title="关闭">&times;</button>'
        : '';
      var timeStr = n.created_at ? n.created_at.substr(0, 16) : '';  // YYYY-MM-DD HH:mm
      return '<div class="' + cls + '">' +
        '<span>' + escHtml(n.content) + ' <span class="notif-bar-author">[@' + escHtml(n.created_by) + ']</span>' +
        (timeStr ? ' <span class="notif-bar-author" style="opacity:0.7;font-size:11px">' + timeStr + '</span>' : '') + '</span>' +
        closeBtn +
      '</div>';
    }).join('');
  } catch(e) {
    console.error('Failed to load notifications:', e);
  }
}

function dismissNotif(id) {
  // Personal dismiss — hides notification for current user only,
  // does NOT change the notification's active state in the database.
  _addDismissedNotifId(id);
  loadNotifBar();
}

var _notifPollTimer = null;

function startNotifPoll() {
  loadNotifBar();
  if (_notifPollTimer) clearInterval(_notifPollTimer);
  _notifPollTimer = setInterval(loadNotifBar, 30000);  // poll every 30s
}

/* ── Notification Management View ── */

function initNotifManage() {
  var user = getCurrentUser();
  var perms = (user && user.permissions) ? user.permissions.split(',') : [];
  var isAdmin = user && (user.role === 'admin' || perms.indexOf('admin') >= 0);
  // Show/hide "all" scope option for admin
  var scopeAll = document.getElementById('notif-scope-all');
  if (scopeAll) scopeAll.style.display = isAdmin ? '' : 'none';
  loadNotifManage();
}

function loadNotifManage() {
  var scope = document.getElementById('notif-manage-scope');
  var scopeVal = scope ? scope.value : 'mine';
  var tbody = document.getElementById('notif-manage-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6"><div class="loading-spinner">加载中...</div></td></tr>';

  API.get('/notifications/manage?scope=' + scopeVal).then(function(data) {
    if (!data || data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state">暂无通知</div></td></tr>';
      return;
    }
    var levelLabels = { general: '一般', important: '重要', severe: '严重' };
    var levelColors = { general: '#3b82f6', important: '#e6a817', severe: '#e53e3e' };
    tbody.innerHTML = data.map(function(n) {
      var color = levelColors[n.level] || '#3b82f6';
      return '<tr>' +
        '<td><span style="display:inline-block;padding:2px 8px;border-radius:3px;font-size:11px;font-weight:600;color:#fff;background:' + color + '">' + escHtml(levelLabels[n.level] || n.level) + '</span></td>' +
        '<td style="font-size:13px">' + escHtml(n.content) + '</td>' +
        '<td style="font-size:12px;font-family:var(--mono)">@' + escHtml(n.created_by) + '</td>' +
        '<td><label class="toggle-switch" style="vertical-align:middle">' +
          '<input type="checkbox" ' + (n.is_active ? 'checked' : '') + ' onchange="toggleNotifStatus(' + n.id + ',this)">' +
          '<span class="toggle-slider"></span></label></td>' +
        '<td style="font-size:12px;color:var(--muted)">' + escHtml(n.created_at || '') + '</td>' +
        '<td style="white-space:nowrap">' +
          '<button class="btn-icon" onclick="editNotifDialog(' + n.id + ',\'' + escJs(n.content) + '\')" title="编辑" style="margin-right:4px">' +
            '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 2l3 3-9 9H2v-3l9-9z"/><path d="M10 5l1 1"/></svg></button>' +
          '<button class="btn-icon" onclick="deleteNotif(' + n.id + ')" title="删除" style="color:var(--danger)">' +
            '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h12M5 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1M6 7v5M10 7v5M3 4l1 10a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-10"/></svg></button>' +
        '</td>' +
      '</tr>';
    }).join('');
  }).catch(function(e) {
    tbody.innerHTML = '<tr><td colspan="6"><div class="error-state">加载失败: ' + escHtml(e.message) + '</div></td></tr>';
  });
}

async function toggleNotifStatus(id, cb) {
  try {
    var result = await API.put('/notifications/' + id + '/toggle');
    cb.checked = result.is_active;
    showToast('通知已' + (result.is_active ? '开启' : '关闭'), 'success');
    loadNotifBar();
  } catch(e) {
    cb.checked = !cb.checked;  // revert
    showToast('操作失败: ' + e.message, 'error');
  }
}

function editNotifDialog(id, content) {
  var html = '<div class="note-dialog-overlay">' +
    '<div class="note-dialog" style="max-width:400px">' +
      '<div class="note-dialog-head"><span class="note-dialog-title">编辑通知</span>' +
        '<button class="note-dialog-close" onclick="closePwDialog()">&times;</button></div>' +
      '<div style="padding:4px 0">' +
        '<div class="user-form-field">' +
          '<label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px">通知内容</label>' +
          '<input class="config-input" id="edit-notif-content" type="text" maxlength="32" value="' + escHtml(content) + '" style="width:100%;box-sizing:border-box">' +
          '<div style="text-align:right;margin-top:4px"><span id="edit-notif-count" style="font-size:11px;color:var(--muted)">' + content.length + '/32</span></div>' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;justify-content:flex-end;align-items:center;gap:10px;margin-top:12px">' +
        '<span id="edit-notif-msg" style="font-size:11px"></span>' +
        '<button class="btn" onclick="closePwDialog()">取消</button>' +
        '<button class="btn btn-primary" onclick="submitEditNotif(' + id + ')">保存</button></div>' +
    '</div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
  var inp = document.getElementById('edit-notif-content');
  inp.oninput = function() {
    document.getElementById('edit-notif-count').textContent = inp.value.length + '/32';
  };
}

async function submitEditNotif(id) {
  var content = document.getElementById('edit-notif-content').value.trim();
  var msg = document.getElementById('edit-notif-msg');
  if (!content) { msg.innerHTML = '<span style="color:var(--danger)">内容不能为空</span>'; return; }
  if (content.length > 32) { msg.innerHTML = '<span style="color:var(--danger)">不能超过32字</span>'; return; }
  try {
    await API.put('/notifications/' + id, { content: content });
    closePwDialog();
    showToast('通知已更新', 'success');
    loadNotifManage();
    loadNotifBar();
  } catch(e) {
    msg.innerHTML = '<span style="color:var(--danger)">' + escHtml(e.message) + '</span>';
  }
}

async function deleteNotif(id) {
  if (!confirm('确定删除此通知？')) return;
  try {
    await API.del('/notifications/' + id);
    showToast('通知已删除', 'success');
    loadNotifManage();
    loadNotifBar();
  } catch(e) {
    showToast('删除失败: ' + e.message, 'error');
  }
}

/* Init */

async function init() {
  // Auth check
  if (!isLoggedIn() && window.location.pathname !== '/login') {
    window.location.href = '/login';
    return;
  }

  // Refresh user data from server (permissions may have been updated by admin)
  if (isLoggedIn()) {
    await refreshCurrentUser();
    // Load project type labels once after auth (supports custom types from 项目&模板管理)
    if (typeof initProjectTypeLabels === 'function') initProjectTypeLabels();
  }

  // Theme — compute effective theme from saved preference
  if (!localStorage.getItem('pm_theme_mode')) {
    var saved = localStorage.getItem('pm_theme'); // legacy key
    localStorage.setItem('pm_theme_mode', saved === 'dark' ? 'dark' : saved === 'light' ? 'light' : 'auto');
  }
  _applyTheme(_getEffectiveTheme());
  var themeTgl = document.getElementById('theme-toggle');
  var themeLbl = document.getElementById('theme-lbl');
  if (themeLbl) themeLbl.textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? '深色' : '浅色';
  if (themeTgl) themeTgl.classList.toggle('on', document.documentElement.getAttribute('data-theme') === 'dark');

  // User display
  var user = getCurrentUser();
  if (user) {
    var initials = (user.username || '').substring(0, 2).toUpperCase();
    document.getElementById('user-avatar').textContent = initials;
    document.getElementById('user-name').textContent = user.display_name || user.username;
    // Hide "修改密码" menu item for GitLab users
    var pwMenuItem = document.getElementById('menu-change-password');
    if (pwMenuItem) {
      pwMenuItem.style.display = (user.auth_source === 'gitlab') ? 'none' : '';
    }
    // Show admin nav items based on permissions
    var perms = (user && user.permissions) ? user.permissions.split(',') : [];
    var isAdmin = user && (user.role === 'admin' || perms.indexOf('admin') >= 0);
    var hasAdminAccess = user && (isAdmin || perms.indexOf('doc_template') >= 0);
    if (hasAdminAccess) {
      var adminGroup = document.getElementById('nav-group-admin');
      if (adminGroup) adminGroup.style.display = '';
      // Non-admin: hide admin-only items
      if (!isAdmin) {
        var adminOnlyIds = ['nav-users', 'nav-permissions', 'nav-config', 'nav-logs', 'nav-db-manage'];
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
    if (!isAdmin && perms.indexOf('product_link') < 0) {
      var pmNav = document.getElementById('nav-product-management');
      if (pmNav) pmNav.style.display = 'none';
    }

    // Show sync button only for users with sync permission
    var syncBtn = document.getElementById('src-sync-btn');
    if (syncBtn && (isAdmin || perms.indexOf('sync') >= 0)) {
      syncBtn.style.display = 'flex';
    }
  }

  // Show welcome dialog for first-time GitLab users
  if (sessionStorage.getItem('pma_new_user') === '1') {
    sessionStorage.removeItem('pma_new_user');
    showNewUserWelcomeDialog();
  }

  // Show publish notification button if user has permission
  showPublishNotifButton(user);

  // Start notification bar polling
  startNotifPoll();

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
  var user = getCurrentUser();
  if (user && user.auth_source === 'gitlab') {
    showToast('GitLab 用户请前往 GitLab 管理密码', 'warning');
    return;
  }
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

function initUserCenter() {
  var container = document.getElementById('user-center-content');
  if (!container) return;
  var user = getCurrentUser();
  if (!user) { container.innerHTML = '<div class="error-state">未登录</div>'; return; }
  var isGitlab = user.auth_source === 'gitlab';
  var authLabel = isGitlab ? 'GitLab' : '本地';
  var authBadge = isGitlab
    ? '<span style="display:inline-block;margin-left:8px;padding:2px 8px;border-radius:3px;font-size:11px;background:var(--accent-lt);color:var(--accent);vertical-align:middle">GitLab</span>'
    : '<span style="display:inline-block;margin-left:8px;padding:2px 8px;border-radius:3px;font-size:11px;background:var(--muted-lt);color:var(--muted);vertical-align:middle">本地</span>';
  var perms = (user.permissions || '').split(',').filter(Boolean);
  var permLabels = {
    'admin': '系统管理', 'sync': '数据同步', 'project_edit': '项目维护',
    'product_link': '产品维护', 'customer_link': '客户维护',
    'doc_template': '文档模板配置', 'stage_mapping': '阶段映射',
  };
  var permBadges = perms.length
    ? perms.map(function(p) { return '<span style="display:inline-block;margin:1px 3px;padding:2px 8px;border-radius:3px;font-size:11px;background:var(--accent-lt);color:var(--accent)">' + escHtml(permLabels[p] || p) + '</span>'; }).join('')
    : '<span style="font-size:12px;color:var(--muted)">无特殊权限</span>';

  container.innerHTML =
    // User info section
    '<div style="margin-bottom:24px">' +
      '<div style="font-size:11px;color:var(--muted);margin-bottom:10px;text-transform:uppercase;letter-spacing:0.05em">个人信息</div>' +
      '<div style="display:flex;align-items:center;gap:14px;margin-bottom:10px">' +
        '<div style="width:56px;height:56px;border-radius:50%;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:600">' +
          escHtml((user.display_name || user.username).charAt(0).toUpperCase()) +
        '</div>' +
        '<div>' +
          '<div style="font-size:16px;font-weight:600;margin-bottom:2px">' + escHtml(user.display_name || user.username) + authBadge + '</div>' +
          '<div style="font-size:12px;color:var(--muted);font-family:var(--mono)">@' + escHtml(user.username) + '</div>' +
        '</div>' +
      '</div>' +
      '<div style="font-size:12px;color:var(--muted)">认证来源: ' + authLabel + '</div>' +
      (isGitlab
        ? '<div style="font-size:12px;margin-top:4px">GitLab Token: ' +
            (user.gitlab_token_valid
              ? '<span style="color:var(--success);font-weight:600">有效</span>'
              : '<span style="color:var(--danger);font-weight:600">无效/过期（需重新登录）</span>') +
          '</div>'
        : '') +
    '</div>' +
    // Permissions section
    '<div style="margin-bottom:24px">' +
      '<div style="font-size:11px;color:var(--muted);margin-bottom:10px;text-transform:uppercase;letter-spacing:0.05em">角色与权限</div>' +
      '<div style="line-height:2.2">' + permBadges + '</div>' +
    '</div>' +
    // Security section (local users only)
    (isGitlab
      ? '<div>' +
          '<div style="font-size:11px;color:var(--muted);margin-bottom:10px;text-transform:uppercase;letter-spacing:0.05em">安全设置</div>' +
          '<div style="font-size:12px;color:var(--muted);padding:6px 0">GitLab 用户，请前往 GitLab 管理密码</div>' +
        '</div>'
      : '<div>' +
          '<div style="font-size:11px;color:var(--muted);margin-bottom:10px;text-transform:uppercase;letter-spacing:0.05em">安全设置</div>' +
          '<button class="btn btn-sm" onclick="changePassword()">修改密码</button>' +
        '</div>');
}

async function showNewUserWelcomeDialog() {
  var user = getCurrentUser();
  if (!user) return;

  // Fetch admin contacts
  var contactsHtml = '<span style="color:var(--muted);font-size:12px">加载中...</span>';
  try {
    var resp = await fetch('/api/auth/gitlab/admin-contacts');
    var json = await resp.json();
    if (json.code === 0 && json.data && json.data.contacts && json.data.contacts.length > 0) {
      contactsHtml = json.data.contacts.map(function(c) {
        return '<span style="display:inline-block;margin:2px 4px;padding:2px 8px;border-radius:3px;font-size:11px;background:var(--accent-lt);color:var(--accent)">' +
          escHtml(c.display_name || c.username) + ' (@' + escHtml(c.username) + ')</span>';
      }).join('');
    } else {
      contactsHtml = '<span style="font-size:12px;color:var(--muted)">暂无管理员信息</span>';
    }
  } catch(e) {
    contactsHtml = '<span style="font-size:12px;color:var(--muted)">获取管理员列表失败</span>';
  }

  // Build current permissions display
  var perms = (user.permissions || '').split(',').filter(Boolean);
  var permLabels = {
    'admin': '系统管理', 'sync': '数据同步', 'project_edit': '项目维护',
    'product_link': '产品维护', 'customer_link': '客户维护',
    'doc_template': '文档模板配置', 'stage_mapping': '阶段映射',
  };
  var permBadges = perms.length
    ? perms.map(function(p) { return '<span style="display:inline-block;margin:1px 3px;padding:2px 8px;border-radius:3px;font-size:11px;background:var(--accent-lt);color:var(--accent)">' + escHtml(permLabels[p] || p) + '</span>'; }).join('')
    : '<span style="font-size:12px;color:var(--muted)">无特殊权限（基础 public 角色）</span>';

  var html = '<div class="note-dialog-overlay" style="z-index:9999">' +
    '<div class="note-dialog" style="max-width:480px">' +
      '<div class="note-dialog-head"><span class="note-dialog-title">欢迎使用 PMA</span>' +
        '<button class="note-dialog-close" onclick="closePwDialog()">&times;</button></div>' +
      '<div style="padding:4px 0">' +
        '<p style="font-size:13px;margin-bottom:16px;line-height:1.6">' +
          '你已通过 GitLab 账户 <strong>' + escHtml(user.username) + '</strong> 首次登录 PMA。' +
        '</p>' +
        '<div style="margin-bottom:16px">' +
          '<div style="font-size:11px;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.05em">当前权限</div>' +
          '<div style="line-height:2">' + permBadges + '</div>' +
        '</div>' +
        '<div style="margin-bottom:16px;padding:12px;background:var(--bg);border-radius:8px;border:1px solid var(--border)">' +
          '<div style="font-size:12px;line-height:1.6">' +
            '<strong>需要更多权限？</strong>请联系以下管理员为你分配相应角色：' +
          '</div>' +
          '<div style="margin-top:8px;line-height:2">' + contactsHtml + '</div>' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;justify-content:flex-end;margin-top:8px">' +
        '<button class="btn btn-primary" onclick="closePwDialog()">知道了</button></div>' +
    '</div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
}

function _getEffectiveTheme() {
  var mode = localStorage.getItem('pm_theme_mode') || 'light';
  if (mode === 'auto') {
    var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'dark' : 'light';
  }
  return mode;
}

function _applyTheme(theme) {
  // theme is the effective value: 'light' or 'dark'
  localStorage.setItem('pm_theme', theme);
  document.documentElement.setAttribute('data-theme', theme);

  var themeBtn = document.getElementById('theme-toggle-btn');
  if (themeBtn) {
    themeBtn.innerHTML = theme === 'dark'
      ? '<svg width="15" height="15" viewBox="0 0 16 16" fill="#f5c542" stroke="none"><path d="M6 .278a.768.768 0 0 1 .08.858 7.208 7.208 0 0 0-.878 3.46c0 4.021 3.278 7.277 7.318 7.277.527 0 1.04-.055 1.533-.16a.787.787 0 0 1 .81.316.733.733 0 0 1-.031.893A8.349 8.349 0 0 1 8.344 16C3.734 16 0 12.286 0 7.71 0 4.266 2.114 1.312 5.124.06A.752.752 0 0 1 6 .278z"/></svg>'
      : '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.2 3.2l1 1M11.8 11.8l1 1M11.8 3.2l-1 1M4.2 11.8l-1 1M5 8a3 3 0 1 0 6 0 3 3 0 0 0-6 0z"/></svg>';
    themeBtn.title = theme === 'dark' ? '切换浅色主题' : '切换深色主题';
  }
}

// Re-evaluate auto theme when system preference changes
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function() {
  if (localStorage.getItem('pm_theme_mode') === 'auto') {
    _applyTheme(_getEffectiveTheme());
  }
});

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

// Fetch and display current git branch (for multi-session parallel dev)
function fetchBranch() {
  API.get('/admin/system-info').then(function(data) {
    if (data && data.branch) {
      var badge = document.getElementById('branch-badge');
      if (badge) {
        badge.textContent = data.branch;
        badge.title = '当前开发分支: ' + data.branch;
        if (data.branch !== 'trunk') {
          badge.classList.add('branch-dev');
        }
      }
    }
  }).catch(function() {});
}

document.addEventListener('DOMContentLoaded', function() {
  init();
  fetchBranch();
});
