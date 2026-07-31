/* ═══════════════════════════════════════════════════
   MAIN APP
═══════════════════════════════════════════════════ */
// Human-readable permission labels for error toasts
var TOAST_PERM_LABELS = {
  admin: '管理员',
  doc_template: '文档模板配置',
  product_link: '产品维护',
  customer_link: '客户维护',
  task_edit: '任务管理',
};

// ── View init wrappers (complex init logic extracted from gotoView) ──

function initDashboard() {
  setTimeout(function() {
    var el = document.getElementById('proj-search');
    if (el) { el.focus(); el.select(); }
  }, 300);
  var dashNewProjBtn = document.getElementById('dash-new-proj-btn');
  if (dashNewProjBtn) {
    var user = getCurrentUser();
    var perms = (user && user.permissions) ? user.permissions.split(',') : [];
    var canCreate = perms.indexOf('admin') >= 0 || perms.indexOf('project_edit') >= 0;
    dashNewProjBtn.style.display = canCreate ? '' : 'none';
  }
  renderDashboard();
  var lastPid = sessionStorage.getItem('pm_last_proj_id');
  if (lastPid) {
    sessionStorage.removeItem('pm_last_proj_id');
    setTimeout(function() {
      var row = document.getElementById('proj-row-' + lastPid);
      if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 300);
  }
}

function initDetailView(code, tabId) {
  loadAllProjects().then(function() {
    if (code) {
      // Look up project by code to get integer id for combo
      var p = _allProjects.find(function(x) { return x.code === code || String(x.id) === code; });
      if (p) {
        document.getElementById('combo-input').value = '';
        // Set target tab BEFORE projComboSelect — it calls loadProjectDetail synchronously
        if (tabId && typeof setDetailTargetTab === 'function') {
          setDetailTargetTab(tabId);
        }
        projComboSelect(p.id);
      }
    } else if (window._pendingProjectCode) {
      var pc = _allProjects.find(function(x) { return x.code === window._pendingProjectCode || String(x.id) === window._pendingProjectCode; });
      if (pc) {
        document.getElementById('combo-input').value = '';
        projComboSelect(pc.id);
      }
      window._pendingProjectCode = null;
    } else if (_comboCurCode) {
      loadProjectDetail(_comboCurCode);
    }
  });
}

function initLogsView() {
  clearLogAutoRefresh();
  renderLogs();
}

// ── View Registry (single source of truth for all views) ──

var VIEW_REGISTRY = {
  dashboard:        { title: '项目总览',    label: '项目总览',    perm: null,            init: initDashboard },
  detail:           { title: '项目详情',    label: '项目详情',    perm: null,            init: initDetailView,         js: '/js/detail.js?v=' + APP_VERSION },
  'product-list':   { title: '产品总览',    label: '产品总览',    perm: null,            init: initProductList },
  'product-detail': { title: '产品详情',    label: '产品详情',    perm: null,            init: initProductDetail },
  'product-management': { title: '产品管理', label: '产品管理',  perm: 'product_link',  initName: 'initProductManagement', js: '/js/product-management.js?v=' + APP_VERSION },
  customers:        { title: '客户管理',    label: '客户管理',    perm: 'customer_link', initName: 'initCustomerManagement', js: '/js/customers.js?v=' + APP_VERSION },
  'customer-detail':{ title: '客户详情',    label: '客户详情',    perm: null,            initName: 'initCustomerDetail',   js: '/js/customers.js?v=' + APP_VERSION },
  topology:         { title: '快速检索',    label: '快速检索',    perm: null,            initName: 'initTopology',         js: '/js/topology.js?v=' + APP_VERSION },
  'gitlab-releases':{ title: 'GitLab 发布', label: 'GitLab 发布', perm: null,            initName: 'initGitLabReleases',   js: '/js/gitlab-releases.js?v=' + APP_VERSION },
  reports:          { title: '统计报告',    label: '统计报告',    perm: null,            initName: 'renderReports',        js: '/js/reports.js?v=' + APP_VERSION },
  'notif-manage':   { title: '通知管理',    label: '通知管理',    perm: null,            init: initNotifManage },
  logs:             { title: '系统日志',    label: '系统日志',    perm: 'admin',         init: initLogsView,           js: '/js/logs.js?v=' + APP_VERSION },
  bugs:             { title: 'Bug 管理',     label: 'Bug 管理',    perm: null,            initName: 'initBugs',         js: '/js/bugs.js?v=' + APP_VERSION },
  users:            { title: '用户管理',    label: '用户管理',    perm: 'admin',         initName: 'initUserManagement',   js: '/js/admin.js?v=' + APP_VERSION },
  permissions:      { title: '权限管理',    label: '权限管理',    perm: 'admin',         initName: 'initPermissions',      js: '/js/admin.js?v=' + APP_VERSION },
  config:           { title: '数据源配置',  label: '数据源配置',  perm: 'admin',         initName: 'initAdmin',            js: '/js/admin.js?v=' + APP_VERSION },
  'doc-templates':  { title: '模板管理',    label: '模板管理',    perm: 'doc_template', initName: 'initDocTemplates',  js: '/js/doc-templates.js?v=' + APP_VERSION },
  standards:        { title: '流程规范',    label: '流程规范',    perm: 'doc_template',  initName: 'initStandards',        js: '/js/standards.js?v=' + APP_VERSION },
  'db-manage':      { title: '数据库管理',  label: '数据库管理',  perm: 'admin',         initName: 'initDbManage',         js: '/js/db-manage.js?v=' + APP_VERSION },
  'user-center':    { title: '用户中心',    label: '用户中心',    perm: null,            init: initUserCenter },
  tasks:            { title: '任务管理',    label: '任务管理',    perm: null,            initName: 'initTasks',            js: '/js/tasks.js?v=' + APP_VERSION },
};

// ── Lazy script loader ──

var _loadedScripts = {};
var _loadingScripts = {};

function loadViewScript(url, callback) {
  if (_loadedScripts[url]) { callback(); return; }
  if (_loadingScripts[url]) { _loadingScripts[url].push(callback); return; }
  _loadingScripts[url] = [callback];
  var script = document.createElement('script');
  script.src = url;
  script.onload = function() {
    _loadedScripts[url] = true;
    var cbs = _loadingScripts[url] || [];
    delete _loadingScripts[url];
    for (var i = 0; i < cbs.length; i++) { cbs[i](); }
  };
  script.onerror = function() {
    delete _loadingScripts[url];
    showToast('页面加载失败，请刷新重试', 'error');
  };
  document.head.appendChild(script);
}

// ── Nav visibility ──

function updateNavVisibility() {
  var user = getCurrentUser();
  if (!user) return;

  var perms = (user.permissions || '').split(',').filter(Boolean);
  var isAdmin = user.role === 'admin' || perms.indexOf('admin') >= 0;

  // Show/hide each nav item based on VIEW_REGISTRY permission
  document.querySelectorAll('.nav-item').forEach(function(item) {
    var viewName = item.id.replace('nav-', '');
    var entry = VIEW_REGISTRY[viewName];
    if (!entry) return; // not a view-linked item (e.g., user menu items)

    if (!entry.perm) {
      item.style.display = '';
    } else {
      item.style.display = (isAdmin || perms.indexOf(entry.perm) >= 0) ? '' : 'none';
    }
  });

  // Hide empty nav groups (including the admin group)
  document.querySelectorAll('.sidebar-nav .nav-group').forEach(function(group) {
    var items = group.querySelectorAll('.nav-item');
    var hasVisible = false;
    items.forEach(function(item) {
      if (item.style.display !== 'none') hasVisible = true;
    });
    group.style.display = hasVisible ? '' : 'none';
  });
}

var _pageDirty = false;
function markPageDirty() { _pageDirty = true; }
function markPageClean() { _pageDirty = false; }
function isPageDirty() { return _pageDirty; }

var _navigatingBack = false;

// ── Hash URL helpers ──

function parseHash() {
  var parts = window.location.hash.replace('#/', '').split('/');
  return { view: parts[0] || '', params: parts.slice(1) };
}

function buildHash(view) {
  var url = '#/' + view;
  for (var i = 1; i < arguments.length; i++) {
    if (arguments[i] != null && arguments[i] !== '') {
      url += '/' + arguments[i];
    }
  }
  return url;
}

function gotoView(view, opts) {
  // Auth guard
  if (!isLoggedIn()) {
    window.location.href = '/login';
    return;
  }

  // Warn if unsaved changes
  if (_pageDirty) {
    if (!confirm('当前页面有未保存的修改，是否放弃并切换页面？')) return;
    _pageDirty = false;
  }

  // Lookup registry
  var entry = VIEW_REGISTRY[view];
  if (!entry) return;

  // Permission check
  if (entry.perm) {
    var permLabel = TOAST_PERM_LABELS[entry.perm] || entry.perm;
    if (!canAccess(entry.perm, entry.label + '需要 ' + permLabel + ' 权限')) return;
  }

  // Activate view DOM
  document.querySelectorAll('.view').forEach(function(v) { v.classList.remove('active'); });
  var viewEl = document.getElementById('view-' + view);
  if (viewEl) viewEl.classList.add('active');

  // Hide right panel when leaving user-center
  if (view !== 'user-center' && window._ucRightPanel) {
    window._ucRightPanel.style.display = 'none';
  }

  // Activate nav
  document.querySelectorAll('.nav-item').forEach(function(n) { n.classList.remove('active'); });
  var navEl = document.getElementById('nav-' + view);
  if (navEl) navEl.classList.add('active');

  // Title with optional debug overlay
  var title = entry.title || '';
  if (window._debugPermEnabled) {
    var user = getCurrentUser();
    var userPerms = user ? (user.permissions || '').split(',').filter(Boolean) : [];
    var permLabels = {
      'admin': '系统管理', 'sync': '数据同步', 'project_edit': '项目维护',
      'product_link': '产品维护', 'customer_link': '客户维护',
      'doc_template': '文档模板', 'stage_mapping': '阶段映射',
    };
    var currentLabel = userPerms.length
      ? userPerms.map(function(p) { return permLabels[p] || p; }).join(', ')
      : (user ? '仅登录' : '未登录');
    var permKey = entry.perm || '登录即可';
    var permRoles = window._permRoles || {};
    var requiredLabel = (permRoles[permKey] || []).join(', ') || permKey;
    title += ' <span style="font-size:11px;color:var(--muted);font-weight:400;margin-left:8px">[需: ' + requiredLabel + ' | 当前: ' + currentLabel + ']</span>';
  }
  document.getElementById('topbar-title').innerHTML = title;

  // Init — lazy-load JS if needed, then init
  var params = (opts && opts.params) ? opts.params : [];
  var doPush = opts !== false && (!opts || opts.pushState !== false);
  var doReplace = opts && opts.replace;

  var doInit = function() {
    var initFn = entry.init;
    if (!initFn && entry.initName) initFn = window[entry.initName];
    if (initFn) {
      // Pass params to init function (backward-compatible: old init fns ignore extra args)
      initFn.apply(null, params);
    }
    localStorage.setItem('pm_view', view);
    if (doReplace) {
      var url2 = buildHash.apply(null, [view].concat(params));
      history.replaceState({ view: view, params: params }, '', url2);
    } else if (doPush && !_navigatingBack) {
      var url2 = buildHash.apply(null, [view].concat(params));
      if (window.location.hash !== url2) {
        history.pushState({ view: view, params: params }, '', url2);
      }
    }
  };

  if (entry.js) {
    loadViewScript(entry.js, doInit);
  } else {
    doInit();
  }
}

// Handle browser back/forward buttons
window.addEventListener('popstate', function(e) {
  if (e.state && e.state.view) {
    _navigatingBack = true;
    gotoView(e.state.view, {params: e.state.params || [], pushState: false});
    _navigatingBack = false;
  }
});

// Handle manual hash changes (user edits address bar hash and hits Enter)
window.addEventListener('hashchange', function() {
  var parsed = parseHash();
  if (parsed.view) {
    gotoView(parsed.view, {params: parsed.params, replace: true});
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
        '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">组件 <span style="color:var(--danger)">*必选</span></label>' +
        '<div style="display:flex;flex-wrap:wrap;gap:6px">' + chipsHtml + '</div>' +
      '</div>' +
      '<div style="margin-bottom:12px">' +
        '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">标题 <span style="color:var(--danger)">*必填</span></label>' +
        '<input class="search-inp" id="fb-title" placeholder="简要描述问题或建议..." style="width:100%;box-sizing:border-box">' +
      '</div>' +
      '<div style="margin-bottom:12px">' +
        '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">详细描述 <span style="font-weight:400">（可选）</span></label>' +
        '<textarea class="search-inp" id="fb-desc" rows="4" placeholder="请详细描述遇到的问题或期望的功能（可选）... 支持粘贴图片" style="width:100%;box-sizing:border-box;resize:vertical" onpaste="handleDescPaste(event)"></textarea>' +
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

async function handleDescPaste(e) {
  var items = (e.clipboardData || window.clipboardData).items;
  if (!items) return;
  for (var i = 0; i < items.length; i++) {
    if (items[i].type.indexOf('image') === 0) {
      e.preventDefault();
      var blob = items[i].getAsFile();
      var ta = document.getElementById('fb-desc');
      var cursorPos = ta.selectionStart;
      var before = ta.value.substring(0, cursorPos);
      var after = ta.value.substring(cursorPos);
      ta.value = before + '[上传图片中...]' + after;
      try {
        var formData = new FormData();
        formData.append('file', blob, 'paste-' + Date.now() + '.png');
        var resp = await fetch('/api/gitlab/upload', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('pma_token') || '') },
          body: formData,
        });
        if (!resp.ok) throw new Error('Upload failed');
        var data = await resp.json();
        var imgUrl = (data.data && data.data.url) || data.url || '';
        if (imgUrl && !imgUrl.startsWith('http')) imgUrl = 'http://192.168.0.128' + imgUrl;
        var mdImg = '\n' + (data.data && data.data.markdown ? data.data.markdown : '![image](' + imgUrl + ')') + '\n';
        ta.value = ta.value.replace('[上传图片中...]', mdImg);
      } catch(err) {
        ta.value = ta.value.replace('[上传图片中...]', '[upload failed]');
      }
      break;
    }
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
  if (!_fbComponents.length) { showToast('请至少选择一个组件', 'error'); return; }

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
  var mode = localStorage.getItem('pm_theme_mode') || 'auto';
  var next = mode === 'auto' ? 'light' : (mode === 'light' ? 'dark' : 'auto');
  _savePref('pm_theme_mode', next);
  _applyTheme(_getEffectiveTheme());
}

/* Data Source Status — topbar tags */

var _srcStates = { zentao: 'pending', gitlab: 'pending', nas: 'pending', svn: 'pending', wecom: 'pending', pdm: 'pending' };
var _srcDetails = { zentao: '', gitlab: '', nas: '', svn: '', wecom: '', pdm: '' };
var _srcEnabled = { zentao: false, gitlab: false, nas: false, svn: false, wecom: false, pdm: false };
var _srcSyncMsg = {};

function updateLinkStatus() {
  API.get('/sync/sources').then(function(sources) {
    if (!sources || !sources.length) return;
    sources.forEach(function(s) {
      var key = s.key;
      if (!_srcStates.hasOwnProperty(key)) return;
      _srcEnabled[key] = s.enabled === true;
      _srcDetails[key] = s.detail || '';
      if (!s.enabled) {
        _srcStates[key] = 'pending';
      } else if (!s.configured) {
        _srcStates[key] = 'warn';
      } else if (s.sync_status === 'success') {
        _srcStates[key] = 'ok';
      } else if (s.sync_status === 'failed') {
        _srcStates[key] = 'err';
      } else {
        _srcStates[key] = 'warn';
      }
    });
    // Apply permission filter to tooltip detail
    var user = getCurrentUser();
    var perms = (user && user.permissions) ? user.permissions.split(',') : [];
    var isAdmin = user && (user.role === 'admin' || perms.indexOf('admin') >= 0);
    var canSeeDetail = isAdmin || perms.indexOf('project_edit') >= 0 || perms.indexOf('doc_template') >= 0;
    sources.forEach(function(s) {
      // Store config detail for tooltip fallback (permission-aware)
      _srcDetails[s.key] = canSeeDetail ? (s.detail || '') : '';
    });
    renderSourceTags();
  }).catch(function(e) {
    console.error('updateLinkStatus failed:', e);
  });
}

document.addEventListener('click', function(e) {
  if (!e.target.closest('.src-tag')) document.querySelectorAll('.src-tag-tip.show').forEach(function(t) { t.classList.remove('show'); });
});

// ── Source tag click menu ──

function showSrcMenu(key, e) {
  e.stopPropagation();
  var existing = document.getElementById('src-popup-menu');
  if (existing) existing.remove();
  var tag = document.getElementById('src-' + key);
  if (!tag) return;
  var rect = tag.getBoundingClientRect();
  var names = { zentao: '禅道', gitlab: 'GitLab', nas: 'NAS', svn: 'SVN', wecom: '企微', pdm: 'PDM' };
  var name = names[key] || key;
  var menu = document.createElement('div');
  menu.id = 'src-popup-menu';
  menu.style.cssText = 'position:fixed;z-index:1000;background:var(--surface);border:1px solid var(--border);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.15);min-width:150px;overflow:hidden';
  menu.style.left = rect.left + 'px';
  menu.style.top = (rect.bottom + 4) + 'px';
  menu.innerHTML =
    '<div style="padding:8px 14px;font-size:11px;color:var(--muted);border-bottom:1px solid var(--border)">' + escHtml(name) + '</div>' +
    '<button onclick="triggerSingleSync(\'' + key + '\');var m=document.getElementById(\'src-popup-menu\');if(m)m.remove()" style="display:block;width:100%;padding:8px 14px;border:none;background:var(--surface);color:var(--fg);font-size:13px;text-align:left;cursor:pointer;transition:background 0.1s" onmouseover="this.style.background=\'var(--bg)\'" onmouseout="this.style.background=\'var(--surface)\'">' +
      '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:8px;vertical-align:middle"><polyline points="1.5,5.5 3.5,2.5 1.5,2.5"/><polyline points="14.5,10.5 12.5,13.5 14.5,13.5"/><path d="M2.5 8a5.5 5.5 0 0 1 10-2.5"/><path d="M13.5 8a5.5 5.5 0 0 1-10 2.5"/></svg>同步此数据源' +
    '</button>' +
    '<button onclick="openConfigDialog(\'' + key + '\');var m=document.getElementById(\'src-popup-menu\');if(m)m.remove()" style="display:block;width:100%;padding:8px 14px;border:none;background:var(--surface);color:var(--fg);font-size:13px;text-align:left;cursor:pointer;transition:background 0.1s" onmouseover="this.style.background=\'var(--bg)\'" onmouseout="this.style.background=\'var(--surface)\'">' +
      '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-right:8px;vertical-align:middle"><circle cx="8" cy="8" r="2.5"/><path d="M8 1.5v2M8 12.5v2M2.5 8h2M11.5 8h2"/></svg>配置此数据源' +
    '</button>' +
    (key === 'svn' ? '<button onclick="clearSVNSync();var m=document.getElementById(\'src-popup-menu\');if(m)m.remove()" style="display:block;width:100%;padding:8px 14px;border:none;background:var(--surface);color:var(--danger);font-size:13px;text-align:left;cursor:pointer;transition:background 0.1s" onmouseover="this.style.background=\'var(--bg)\'" onmouseout="this.style.background=\'var(--surface)\'">' +
      '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-right:8px;vertical-align:middle"><polyline points="3,6 5,6 13,6"/><path d="M5 6l1 8h4l1-8"/></svg>清除SVN同步数据' +
    '</button>' : '');
  document.body.appendChild(menu);
  // Close on outside click
  setTimeout(function() {
    document.addEventListener('click', function _close(e) {
      if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', _close); }
    });
  }, 10);
}

async function clearSVNSync() {
  if (!confirm('确定清除所有SVN同步数据？\n\n文档路径和状态将重置，下次同步重新扫描。')) return;
  try {
    var r = await API.post('/admin/clear-svn');
    showToast(r.message || '已清除', 'success');
  } catch(e) { showToast('清除失败: ' + (e.message || ''), 'error'); }
}

async function triggerSingleSync(key) {
  var names = { zentao: '禅道', gitlab: 'GitLab', nas: 'NAS', svn: 'SVN', wecom: '企业微信', pdm: 'PDM' };
  var name = names[key] || key;
  // Show syncing state on tag label + tooltip
  _srcSyncMsg[key] = '同步中...';
  var el = document.getElementById('src-' + key);
  var labelEl = el ? el.querySelector('.src-tag-label') : null;
  if (labelEl) labelEl.textContent = name + ' 同步中...';
  renderSourceTags();
  showToast(name + ' 同步中...', 'info');
  try {
    var result = await API.post('/sync/trigger/' + key);
    var d = result || {};
    var summary = '', status = 'success';
    if (key === 'svn') {
      var ss = d.svn_summary || {};
      summary = ss.summary || '完成';
    } else if (key === 'gitlab') {
      var gs = d.gitlab_summary || {};
      summary = gs.summary || '完成';
    } else if (key === 'wecom') {
      var ws = d.wecom_summary || {};
      summary = ws.summary || '完成';
      status = ws.status === 'failed' ? 'error' : 'success';
    } else if (key === 'pdm') {
      var ps = d.pdm_summary || {};
      summary = ps.summary || '完成';
      status = ps.status === 'failed' ? 'error' : 'success';
    } else {
      summary = '已触发（请使用完整同步）';
    }
    _srcSyncMsg[key] = summary;
    showToast(name + ' 同步完成: ' + summary, status);
    updateLinkStatus();
  } catch(e) {
    _srcSyncMsg[key] = '同步失败';
    if (labelEl) labelEl.textContent = name;
    showToast(name + ' 同步失败: ' + (e.message || '未知错误'), 'error');
  }
}

// Open the config edit dialog directly for a source (or all)
function openConfigDialog(key) {
  window._srcConfigOpenDialog = key || null;  // null = open first section
  gotoView('config');
}

// Called by renderConfigForm to add highlight
function _getSrcConfigHighlight() {
  var k = window._srcConfigHighlight;
  window._srcConfigHighlight = null;
  return k;
}

// Called by initAdmin to auto-open dialog
function _getSrcConfigOpenDialog() {
  var k = window._srcConfigOpenDialog;
  window._srcConfigOpenDialog = null;
  return k;
}

function renderSourceTags() {
  var names = { zentao: '禅道', gitlab: 'GitLab', nas: 'NAS', svn: 'SVN', wecom: '企微', pdm: 'PDM' };

  Object.keys(_srcStates).forEach(function(key) {
    var el = document.getElementById('src-' + key);
    if (!el) return;
    var enabled = _srcEnabled[key] === true;
    el.classList.toggle('src-tag-hidden', !enabled);
    if (!enabled) return;
    var state = _srcStates[key] || 'pending';
    el.className = 'src-tag ' + state;
    var label = el.querySelector('.src-tag-label');
    if (label) label.textContent = names[key];
    var tip = el.querySelector('.src-tag-tip');
    if (tip) tip.textContent = _srcSyncMsg[key] || _srcDetails[key] || names[key] + ' 连接状态未知';
  });
  // Hide project filter menu item when zentao is disabled
  var filterBtn = document.getElementById('src-sync-filter');
  if (filterBtn) filterBtn.style.display = (_srcEnabled['zentao'] ? '' : 'none');
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
          '<div style="font-size:10.5px;color:var(--muted)">' + escHtml(a.project_code || '') + (a.project_code && a.project_name ? ' ' + escHtml(a.project_name) : '') + '</div></div>' +
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

/* ── User Menu Dropdown ── */
function toggleUserMenu(e) {
  e.stopPropagation();
  var dd = document.getElementById('user-dropdown');
  if (!dd) return;
  var isOpen = dd.classList.contains('open');
  closeUserMenu();
  if (!isOpen) dd.classList.add('open');
}
function closeUserMenu() {
  var dd = document.getElementById('user-dropdown');
  if (dd) dd.classList.remove('open');
}
document.addEventListener('click', function(e) {
  if (!e.target.closest('#user-menu-btn')) closeUserMenu();
});

function openPreferencesDialog() {
  openDialog('偏好设置', '<div id="pref-dialog-content" style="min-width:360px"></div>', [
    {text: '关闭', onclick: 'closeSharedDialog()'}
  ], {maxWidth: 520});
  setTimeout(function() {
    var el = document.getElementById('pref-dialog-content');
    if (el) _renderPreferencesPanel(el);
  }, 80);
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
      _adjustTickerPosition(0);
      return;
    }
    bar.style.display = '';
    bar.innerHTML = data.map(function(n) {
      // Ticker position adjusted after rendering
      var closable = n.level !== 'severe';
      var cls = 'notif-bar-item notif-bar-' + n.level;
      var closeBtn = closable
        ? '<button class="notif-close" onclick="dismissNotif(' + n.id + ')" title="关闭">&times;</button>'
        : '';
      var timeStr = n.created_at ? fmtISODateTime(n.created_at) : '';  // YYYY-MM-DD HH:mm
      return '<div class="' + cls + '">' +
        '<span>' + escHtml(n.content) + ' <span class="notif-bar-author">[@' + escHtml(n.created_by) + ']</span>' +
        (timeStr ? ' <span class="notif-bar-author" style="opacity:0.7;font-size:11px">' + timeStr + '</span>' : '') + '</span>' +
        closeBtn +
      '</div>';
    }).join('');
    setTimeout(function() { _adjustTickerPosition(bar.offsetHeight); }, 50);
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

/* ── Alert Ticker (bottom scrolling bar) ── */

var _tickerEnabled = localStorage.getItem('pma_ticker_enabled') !== '0';  // default ON
var _tickerSpeed = localStorage.getItem('pma_ticker_speed') || 'normal';  // slow|normal|fast
var _tickerSpeeds = {slow: 30, normal: 50, fast: 80};  // px/s
var _tickerContentMode = localStorage.getItem('pma_ticker_mode') || 'activities';  // activities|alerts
var _tickerTimer = null;

function initAlertTicker() {
  if (_tickerEnabled) {
    document.body.classList.add('has-ticker');
    loadAlertTicker();
    if (_tickerTimer) clearInterval(_tickerTimer);
    _tickerTimer = setInterval(loadAlertTicker, 60000);
  } else {
    document.body.classList.remove('has-ticker');
  }
}

function applyTickerSpeed() {
  var inner = document.getElementById('alert-ticker-inner');
  if (!inner) return;
  var pxPerSec = _tickerSpeeds[_tickerSpeed] || 50;
  // Use requestAnimationFrame so the browser has laid out the new content
  requestAnimationFrame(function() {
    var contentWidth = inner.scrollWidth;
    // Animation is translateX(-50%) — scrolls half the content width
    var duration = Math.max(contentWidth / 2 / pxPerSec, 10);  // minimum 10s
    inner.style.animationDuration = duration + 's';
  });
}

function toggleAlertTicker() {
  _tickerEnabled = !_tickerEnabled;
  _savePref('pma_ticker_enabled', _tickerEnabled ? '1' : '0');
  var ticker = document.getElementById('alert-ticker');
  if (_tickerEnabled) {
    if (ticker) ticker.style.display = '';
    document.body.classList.add('has-ticker');
    initAlertTicker();
  } else {
    if (ticker) ticker.style.display = 'none';
    document.body.classList.remove('has-ticker');
    if (_tickerTimer) { clearInterval(_tickerTimer); _tickerTimer = null; }
  }
  _syncBottomLayout();
}

function setTickerSpeed(speed) {
  _tickerSpeed = speed;
  _savePref('pma_ticker_speed', speed);
  applyTickerSpeed();
}

function toggleTickerContentMode() {
  _tickerContentMode = _tickerContentMode === 'activities' ? 'alerts' : 'activities';
  _savePref('pma_ticker_mode', _tickerContentMode);
  loadAlertTicker();
  _renderPreferencesPanel();
}

function tickerOpenTaskDetail(taskId) {
  if (typeof openTaskDetail === 'function') { openTaskDetail(taskId); }
  else if (typeof loadViewScript === 'function') { loadViewScript('/js/tasks.js?v=' + APP_VERSION, function() { openTaskDetail(taskId); }); }
}

async function loadAlertTicker() {
  var ticker = document.getElementById('alert-ticker');
  if (!ticker || !_tickerEnabled) return;
  try {
    if (_tickerContentMode === 'activities') {
      var actData = await API.get('/dashboard/recent-activity-feed?days=7&limit=30');
      var acts = actData.items || [];
      if (!acts.length) { ticker.style.display = 'none'; document.body.classList.remove('has-ticker'); _syncBottomLayout(); return; }
      ticker.style.display = '';
      document.body.classList.add('has-ticker');
      _syncBottomLayout();
      var actItems = acts.concat(acts);
      var actHtml = '';
      actItems.forEach(function(a) {
        var desc = a.description || '';
        var descDisplay = desc.length > 15 ? desc.substring(0, 15) + '...' : desc;
        var newBadge = a.is_today ? ' <span style="display:inline-block;background:var(--success);color:#fff;font-size:10px;padding:0 3px;border-radius:2px;vertical-align:middle;position:relative;top:-1px;font-weight:600">NEW</span> ' : '';
        actHtml += '<span class="ticker-activity-item" style="display:inline-block;margin:0 12px;padding:2px 8px;border-radius:3px;background:var(--bg);cursor:pointer" onclick="tickerOpenTaskDetail(' + a.task_id + ')" title="' + escHtml(desc) + '">' +
          newBadge +
          '<span style="color:var(--accent)">' + escHtml(a.project_code || '') + '</span>' +
          '<span style="color:var(--muted);margin:0 4px">-</span>' +
          '<span style="color:var(--fg)">' + escHtml(a.assignee_name || '') + '</span>' +
          '<span style="color:var(--muted);margin:0 4px">-</span>' +
          (a.activity_date ? '<span style="color:var(--muted);font-size:11px">' + a.activity_date + '</span>' : '') +
          '<span style="color:var(--muted);margin:0 4px">-</span>' +
          '<span style="color:var(--fg)">' + escHtml(descDisplay) + '</span>' +
        '</span>';
      });
      document.getElementById('alert-ticker-inner').innerHTML = actHtml;
      applyTickerSpeed();
    } else {
      var data = await API.get('/dashboard/alerts?limit=30');
      var alerts = data.items || [];
      if (!alerts.length) { ticker.style.display = 'none'; document.body.classList.remove('has-ticker'); _syncBottomLayout(); return; }
      ticker.style.display = '';
      document.body.classList.add('has-ticker');
      _syncBottomLayout();
      // Duplicate items for seamless scrolling
      var items = alerts.concat(alerts);
      var html = '';
      items.forEach(function(a) {
        var dot = a.severity === 'red' ? '#f87171' : '#fbbf24';
        html += '<span style="display:inline-block;margin:0 12px;padding:2px 8px;border-radius:3px;background:var(--bg)">' +
          '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:' + dot + ';margin-right:4px;vertical-align:middle"></span>' +
          '<span style="color:var(--accent);cursor:pointer" onclick="openProject(\'' + escHtml(a.project_code || '') + '\')">' + escHtml(a.project_code || '') + '</span>' +
          (a.project_name ? ' <span style="color:var(--muted);font-size:11px">' + escHtml(a.project_name) + '</span>' : '') +
          ' <span style="color:var(--fg)">' + escHtml(a.message) + '</span>' +
        '</span>';
      });
      document.getElementById('alert-ticker-inner').innerHTML = html;
      applyTickerSpeed();
    }
  } catch(e) { /* non-critical */ }
}

function _syncBottomLayout() {
  // Sync batch toolbar position and user-center layout with current bottom bar heights
  if (typeof _adjustBatchToolbarPosition === 'function') _adjustBatchToolbarPosition();
  if (typeof window._ucUpdateLayout === 'function') window._ucUpdateLayout();
}

function _adjustTickerPosition(notifBarHeight) {
  var ticker = document.getElementById('alert-ticker');
  if (ticker) ticker.style.bottom = (notifBarHeight || 0) + 'px';
  _syncBottomLayout();
}

function _getBottomBarHeight() {
  var h = 0;
  var ticker = document.getElementById('alert-ticker');
  var notifBar = document.getElementById('notif-bar');
  if (ticker && ticker.style.display !== 'none' && _tickerEnabled) h += ticker.offsetHeight || 28;
  if (notifBar && notifBar.style.display !== 'none') h += notifBar.offsetHeight;
  return h;
}

function setThemeMode(mode) {
  _savePref('pm_theme_mode', mode);
  var effective = _getEffectiveTheme();
  localStorage.setItem('pm_theme', effective);  // pre-render hint for inline script
  _applyTheme(effective);
  var themeTgl = document.getElementById('theme-toggle');
  if (themeTgl) themeTgl.classList.toggle('on', document.documentElement.getAttribute('data-theme') === 'dark');
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

var _notifDt = null;

function loadNotifManage() {
  var scope = document.getElementById('notif-manage-scope');
  var scopeVal = scope ? scope.value : 'mine';
  var container = document.getElementById('notif-manage-table');
  if (!container) return;

  if (!_notifDt) {
    _notifDt = new DataTable({
      container: container,
      columns: [
        { key: 'level', title: '级别', width: '60px', render: function(v) {
          var labels = { general: '一般', important: '重要', severe: '严重' };
          var colors = { general: '#3b82f6', important: '#e6a817', severe: '#e53e3e' };
          return '<span style="display:inline-block;padding:2px 8px;border-radius:3px;font-size:11px;font-weight:600;color:#fff;background:' + (colors[v]||'#3b82f6') + '">' + escHtml(labels[v]||v) + '</span>';
        }},
        { key: 'content', title: '内容', align: 'left' },
        { key: 'created_by', title: '发布者', width: '100px', render: function(v) { return '<span style="font-family:var(--mono);font-size:12px">@' + escHtml(v) + '</span>'; } },
        { key: 'is_active', title: '状态', width: '60px', render: function(v, row) { return toggleSwitch(v, 'toggleNotifStatus(' + row.id + ')', {id: 'notif-tgl-' + row.id}); } },
        { key: 'created_at', title: '发布时间', width: '130px', render: function(v) { return '<span style="color:var(--muted);font-size:12px">' + escHtml(fmtISODateTime(v) || '—') + '</span>'; } },
        { key: 'actions', title: '操作', width: '60px', render: function(v, row) { return '<span style="white-space:nowrap">' + iconEdit('editNotifDialog(' + row.id + ',\'' + escJs(row.content) + '\')') + iconDelete('deleteNotif(' + row.id + ')') + '</span>'; } }
      ],
      maxHeight: 'calc(100vh - 260px)',
      resizable: false
    });
  }

  _notifDt.setData([{ content: '加载中...', level: 'general', created_by: '', is_active: false, created_at: '', id: 0, actions: '' }]);

  API.get('/notifications/manage?scope=' + scopeVal).then(function(data) {
    if (!data || data.length === 0) {
      _notifDt.setData([]);
      return;
    }
    _notifDt.setData(data);
  }).catch(function(e) {
    _notifDt = null;
    document.getElementById('notif-manage-table').innerHTML = '<div class="error-state" style="padding:20px">加载失败: ' + escHtml(e.message) + '</div>';
    showToast('加载失败: ' + e.message, 'error');
  });
}

async function toggleNotifStatus(id) {
  try {
    var result = await API.put('/notifications/' + id + '/toggle');
    var tgl = document.getElementById('notif-tgl-' + id);
    if (tgl) tgl.outerHTML = toggleSwitch(result.is_active, 'toggleNotifStatus(' + id + ')', {id: 'notif-tgl-' + id});
    showToast('通知已' + (result.is_active ? '开启' : '关闭'), 'success');
    loadNotifBar();
  } catch(e) {
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

  // Activate correct view RIGHT after user refresh, before other async work
  var parsed = parseHash();
  var hashView = parsed.view;
  var hashParams = parsed.params;
  var lastView = hashView || 'user-center';
  gotoView(lastView, {params: hashView ? hashParams : [], pushState: false});
  if (!history.state || !history.state.view) {
    history.replaceState({ view: lastView, params: hashParams }, '', '#/' + lastView);
  }

  // Legacy theme key migration
  if (!localStorage.getItem('pm_theme_mode')) {
    var saved = localStorage.getItem('pm_theme');
    var m = saved === 'dark' ? 'dark' : saved === 'light' ? 'light' : 'auto';
    localStorage.setItem('pm_theme_mode', m);
  }

  // User display — non-blocking UI setup
  var user = getCurrentUser();
  if (user) {
    var initials = (user.username || '').substring(0, 2).toUpperCase();
    document.getElementById('user-avatar').textContent = initials;
    document.getElementById('user-name').textContent = user.display_name || user.username;
    updateNavVisibility();
    var perms = (user && user.permissions) ? user.permissions.split(',') : [];
    var isAdmin = user && (user.role === 'admin' || perms.indexOf('admin') >= 0);
    var syncBtn = document.getElementById('src-sync-btn');
    if (syncBtn && (isAdmin || perms.indexOf('sync') >= 0)) {
      syncBtn.style.display = 'flex';
    }
  }

  // Sync preferences from backend BEFORE rendering content (avoid theme flash)
  if (user && user.id) {
    try {
      var prefs = await API.get('/auth/preferences');
      if (prefs && typeof prefs === 'object') {
        Object.keys(prefs).forEach(function(k) {
          if (prefs[k] != null) localStorage.setItem(k, String(prefs[k]));
        });
      }
    } catch(e) { /* non-critical */ }
  }

  // Apply theme once — after sync, before content render
  _applyTheme(_getEffectiveTheme());
  var themeTgl = document.getElementById('theme-toggle');
  if (themeTgl) themeTgl.classList.toggle('on', document.documentElement.getAttribute('data-theme') === 'dark');

  // Show guide based on user.need_guide flag (from DB, persisted across sessions)
  if (user && user.need_guide) {
    showNewUserGuide(); // changelog will be shown after guide completes
  } else {
    checkNewVersion();
  }

  // Show publish notification button if user has permission
  showPublishNotifButton(user);

  // Start notification bar polling
  startNotifPoll();

  // Start alert ticker (if enabled by user preference)
  initAlertTicker();

  // Data source status — render defaults immediately, then update
  renderSourceTags();
  updateLinkStatus();
  // Load PMA settings (password verification toggles etc.) — admin only
  if (isAdmin) loadPmaSettings();
  // Load public settings (debug_perm + role-permission mapping)
  API.get('/admin/settings/public').then(function(d) {
    window._debugPermEnabled = d && d.debug_perm;
    window._approvalEnabled = d && d.approval_enabled !== false;
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

async function initUserCenter(viewUserId) {
  var container = document.getElementById('user-center-content');
  if (!container) return;
  var currentUser = getCurrentUser();
  if (!currentUser) { container.innerHTML = '<div class="error-state">未登录</div>'; return; }

  // If viewing another user's center (admin feature), load that user's data
  var user = currentUser;
  var isViewingOther = viewUserId && viewUserId !== currentUser.id;
  window._ucViewUserId = isViewingOther ? viewUserId : null;
  if (isViewingOther) {
    try {
      var resp = await API.get('/admin/users/' + viewUserId);
      if (resp) { user = resp; }
    } catch(e) { /* fall back to current user */ }
  }

  var isGitlab = user.auth_source === 'gitlab';
  var perms = (user.permissions || '').split(',').filter(Boolean);
  var permLabels = {'admin':'系统管理','sync':'数据同步','project_edit':'项目维护','product_link':'产品维护','customer_link':'客户维护','doc_template':'文档模板配置','stage_mapping':'阶段映射','task_edit':'任务管理'};
  var permBadges = perms.map(function(p) { return '<span class="profile-role-tag">' + escHtml(permLabels[p]||p) + '</span>'; }).join('');
  var showPermRoles = window._debugPermEnabled && permBadges;

  // Build profile-bar HTML as standalone string for floating card
  // Left: avatar + info; Right: tab buttons with counts
  var profileBarHtml =
    '<div class="profile-bar" style="display:flex;align-items:center;justify-content:space-between">' +
      '<div style="display:flex;align-items:center;gap:20px;min-width:0">' +
        '<div class="profile-avatar">' + escHtml((user.display_name||user.username).charAt(0).toUpperCase()) + '</div>' +
        '<div class="profile-info">' +
          '<div class="profile-name">' + escHtml(user.display_name || user.username) + '</div>' +
          '<div class="profile-row"><div class="profile-user">@' + escHtml(user.username) + '</div>' +
            (user.wecom_userid ? '<span class="profile-wecom-tag" title="已关联企业微信">' + escHtml(user.wecom_userid) + '</span>' : '<span style="font-size:11px;color:var(--muted)">未关联企业微信</span>') +
            '<button class="profile-action-btn" id="btn-gitlab" onclick="_ucTogglePanel(\'gitlab\')"><svg width="16" height="16" viewBox="0 0 380 380" fill="currentColor"><path d="M282.83 170.73l-.27-.69-26.14-68.22a6.81 6.81 0 00-2.69-3.24 7 7 0 00-8 .43 7 7 0 00-2.32 3.52l-17.65 54H154.07l-17.65-54a6.86 6.86 0 00-2.32-3.53 7 7 0 00-8-.43 6.87 6.87 0 00-2.69 3.24L97.44 170l-.26.69a48.54 48.54 0 0016.1 56.1l.09.07.24.17 39.82 30.2 19.7 15.11 12 9.08a7.07 7.07 0 004.33 1.58 7.09 7.09 0 004.33-1.58l12-9.08 19.7-15.11 40.06-30.35.09-.07a48.63 48.63 0 0016.08-56.1z"/></svg> GitLab</button>' +
            '<button class="profile-action-btn" id="btn-security" onclick="_ucTogglePanel(\'security\')"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg> 安全</button>' +
            '<button class="profile-action-btn" id="btn-preferences" onclick="_ucTogglePanel(\'preferences\')"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> 偏好</button>' +
            '<button class="profile-action-btn" id="btn-switch-account" onclick="switchAccount()" style="color:var(--warn)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M16 3h5v5M21 3l-7 7M8 21H3v-5M3 21l7-7"/></svg> 切换账号</button>' +
          '</div>' +
          '<div class="profile-row" style="margin-top:4px">' +
            
            (showPermRoles ? '<div class="profile-roles" style="margin-top:0">' + permBadges + '</div>' : '') +
          '</div>' +
        '</div>' +
      '</div>' +
      // Right: tab buttons with counts
      '<div class="profile-tabs">' +
        '<button class="profile-tab-btn tab-tasks active" id="btn-my-tasks" onclick="_ucSwitchTab(\'tasks\')"><span>' + (isViewingOther ? escHtml(user.display_name||user.username) + '的任务' : '我的任务') + '</span><span class="profile-tab-count" id="uc-tasks-count">...</span></button>' +
        '<button class="profile-tab-btn tab-bugs" id="btn-my-bugs" onclick="_ucSwitchTab(\'bugs\')"><span>' + (isViewingOther ? escHtml(user.display_name||user.username) + '的Bug' : '我的Bug') + '</span><span class="profile-tab-count" id="uc-bugs-count">...</span></button>' +
        (window._approvalEnabled ? '<button class="profile-tab-btn tab-approvals" id="btn-my-approvals" onclick="_ucSwitchTab(\'approvals\')"><span>' + (isViewingOther ? escHtml(user.display_name||user.username) + '的审批' : '我的审批') + '</span><span class="profile-tab-count" id="uc-approvals-count">...</span></button>' : '') +
      '</div>' +
    '</div>';

  // Container: profile bar at top + tab-switched content below
  container.innerHTML =
    '<div id="uc-inner" style="display:flex;flex-direction:column;height:100%;overflow:hidden">' +
    // Profile bar — inline, not floating; reserve space for right panel
    '<div id="uc-profile-bar-wrap" style="margin-right:358px">' + profileBarHtml + '</div>' +
    // Expand panel
    '<div class="profile-expand" id="uc-expand" style="margin-right:358px"><div class="profile-expand-inner"><div id="uc-expand-content"></div></div></div>' +
    // Bottom area: left (tab-switched tables) + right (calendar)
    '<div style="flex:1;min-height:0;display:flex;flex-direction:column">' +
      // ── Left: tab-switched content (tasks or bugs), reserve space for right panel ──
      '<div style="display:flex;flex-direction:column;min-width:0;flex:1;margin-right:358px">' +
        // Tasks section (default visible)
        '<div id="uc-tasks-section" style="flex:1;display:flex;flex-direction:column;min-height:0">' +
          '<div class="task-filter-bar" id="uc-tasks-filter-bar"></div>' +
          '<div id="uc-tasks-table-wrap"></div>' +
        '</div>' +
        // Bugs section (hidden by default)
        '<div id="uc-bugs-section" style="flex:1;flex-direction:column;min-height:0;display:none">' +
          '<div class="task-filter-bar" id="uc-bugs-filter-bar"></div>' +
          '<div id="uc-bugs-table-wrap"></div>' +
        '</div>' +
        // Approvals section (hidden by default)
        (window._approvalEnabled ? '<div id="uc-approvals-section" style="flex:1;flex-direction:column;min-height:0;display:none">' +
          '<div id="uc-approvals-table-wrap"></div>' +
        '</div>' : '') +
      '</div>' +
    '</div>' +
    '</div>';

  // Reset DataTable refs — DOM rebuilt, old instances point to detached elements
  _ucTasksDt = null;
  _ucBugsDt = null;
  _ucApprovalsDt = null;

  // Create or show fixed right panel (calendar at top + stats below)
  if (!window._ucRightPanel) {
    var rp = document.createElement('div');
    rp.id = 'uc-right-panel';
    rp.innerHTML = '<div id="uc-calendar"></div><div id="uc-wecom-calendar"></div><div id="uc-right-stats"></div>';
    document.body.appendChild(rp);
    window._ucRightPanel = rp;
  } else {
    window._ucRightPanel.style.display = '';
  }

  // Dynamic table scroll heights (like dashboard's _resizeProjTable)
  window._ucUpdateLayout = function() {
    var bottomH = typeof _getBottomBarHeight === 'function' ? _getBottomBarHeight() : 0;
    var inner = document.getElementById('uc-inner');
    if (inner) { inner.style.height = 'calc(100% - ' + bottomH + 'px)'; }
    // Defer maxHeight until after browser re-layout
    requestAnimationFrame(function() {
      var bottomH = typeof _getBottomBarHeight === 'function' ? _getBottomBarHeight() : 0;
      var tw = document.querySelector('#uc-tasks-table-wrap .dt-scroll');
      if (tw) { var tr = tw.getBoundingClientRect(); tw.style.maxHeight = Math.max(200, window.innerHeight - tr.top - 32 - bottomH) + 'px'; }
      var bw = document.querySelector('#uc-bugs-table-wrap .dt-scroll');
      if (bw) { var br = bw.getBoundingClientRect(); bw.style.maxHeight = Math.max(200, window.innerHeight - br.top - 32 - bottomH) + 'px'; }
      var aw = document.querySelector('#uc-approvals-table-wrap .dt-scroll');
      if (aw) { var ar = aw.getBoundingClientRect(); aw.style.maxHeight = Math.max(200, window.innerHeight - ar.top - 32 - bottomH) + 'px'; }
    });
  }
  setTimeout(window._ucUpdateLayout, 80);
  // Re-apply on window resize
  window.addEventListener('resize', window._ucUpdateLayout);

  // Calendar navigation callback
  _calChangeCallback = function() { _ucLoadCalendar(user); _ucLoadWecomCalendar(user); };
  // Load tasks by default (bugs load on tab switch)
  _ucActiveTab = 'tasks';
  _ucLoadTasks(user);
  // Preload bug count for the tab button, stats hidden (bugs section not active)
  _ucLoadBugs();
  // Preload approvals count for the tab button
  if (window._approvalEnabled) _ucLoadApprovals();
}

var _ucTasks = [];
var _ucFilterStatus = 'unfinished';
var _ucFilterProd = '';
var _ucFilterProj = '';
var _ucSortCol = '';
var _ucSortDir = 'asc';
var _ucActiveTab = 'tasks'; // 'tasks' | 'bugs'

function _ucUpdateTaskCount() {
  var el = document.getElementById('uc-tasks-count');
  if (el) el.textContent = _ucTasks.length;
}
function _ucUpdateBugCount(n) {
  var el = document.getElementById('uc-bugs-count');
  if (el) el.textContent = (n != null ? n : '...');
}
function _ucRefreshRightStats() {
  // Clear right stats area and show stats for active tab
  var rs = document.getElementById('uc-right-stats');
  if (!rs) return;
  rs.innerHTML = '';
  if (_ucActiveTab === 'tasks') {
    _ucRenderTaskStats();
  } else if (_ucActiveTab === 'bugs') {
    _ucLoadBugStats();
  }
}
function _ucRenderTaskStats() {
  var rs = document.getElementById("uc-right-stats");
  if (!rs) return;
  var html = _ucBuildTaskStats();
  rs.innerHTML = html || '<div class="panel panel-pad" style="margin-bottom:18px"><div class="sec-hd"><h2>任务统计</h2></div><div style="color:var(--muted);font-size:12px">暂无数据</div></div>';
}

function _ucSwitchTab(tab) {
  if (_ucActiveTab === tab) return;
  _ucActiveTab = tab;
  // Update button active states in floating card
  var tasksBtn = document.getElementById('btn-my-tasks');
  var bugsBtn = document.getElementById('btn-my-bugs');
  var approvalsBtn = document.getElementById('btn-my-approvals');
  if (tasksBtn) tasksBtn.classList.toggle('active', tab === 'tasks');
  if (bugsBtn) bugsBtn.classList.toggle('active', tab === 'bugs');
  if (approvalsBtn) approvalsBtn.classList.toggle('active', tab === 'approvals');
  // Show/hide content sections
  var tasksSec = document.getElementById('uc-tasks-section');
  var bugsSec = document.getElementById('uc-bugs-section');
  var approvalsSec = document.getElementById('uc-approvals-section');
  if (tasksSec) tasksSec.style.display = tab === 'tasks' ? 'flex' : 'none';
  if (bugsSec) bugsSec.style.display = tab === 'bugs' ? 'flex' : 'none';
  if (approvalsSec) approvalsSec.style.display = tab === 'approvals' ? 'flex' : 'none';
  // Update right-side stats to match active tab
  _ucRefreshRightStats();
  // Load data for the active tab
  if (tab === 'tasks') {
    var user = getCurrentUser();
    if (user) _ucLoadTasks(user);
  } else if (tab === 'bugs') {
    _ucLoadBugs();
  } else if (tab === 'approvals') {
    if (window._approvalEnabled) _ucLoadApprovals();
  }
}

function _ucNewBug() {
  // Auto-fill product/project context from current page
  var ctx = {};
  var prodId = sessionStorage.getItem('pm_last_prod_id');
  if (prodId) ctx.product = parseInt(prodId);
  var projId = sessionStorage.getItem('pm_last_proj_id');
  if (projId) ctx.project = parseInt(projId);
  if (ctx.product || ctx.project) window._bugPreFill = ctx;
  if (typeof openBugDialog === 'function') openBugDialog();
  else if (typeof loadViewScript === 'function') loadViewScript('/js/bugs.js?v=' + APP_VERSION, function() { openBugDialog(); });
}

function _ucLoadApprovals() {
  var user = getCurrentUser();
  if (!user) return;
  var reviewerId = window._ucViewUserId || user.id;
  // Load tasks where user is reviewer and status is review
  API.get('/tasks?reviewer_id=' + reviewerId + '&status=review').then(function(tasks) {
    _ucApprovals = tasks || [];
    var countEl = document.getElementById('uc-approvals-count');
    if (countEl) countEl.textContent = _ucApprovals.length;
    _renderUcApprovalTable();
  }).catch(function(e) {
    console.error('_ucLoadApprovals failed:', e);
    document.getElementById('uc-approvals-table-tbody').innerHTML = '<tr><td colspan="6"><div class="empty-state">加载失败: ' + (e && e.message ? e.message : '') + '</div></td></tr>';
  });
}

var _ucApproveIcon = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,8 6,11 13,4"/></svg>';
var _ucRejectIcon = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>';

var _ucApprovalsDt = null;

function _renderUcApprovalTable() {
  var container = document.getElementById('uc-approvals-table-wrap');
  if (!container) return;
  if (!_ucApprovals || !_ucApprovals.length) { container.innerHTML = '<div class="empty-state">暂无需要审批的任务</div>'; _ucApprovalsDt = null; return; }
  if (!_ucApprovalsDt) {
    container.innerHTML = '<div id="uc-approvals-dt"></div>';
    _ucApprovalsDt = new DataTable({
      container: document.getElementById('uc-approvals-dt'),
      columns: [
        { key: 'id', title: '任务编号', width: '6%', render: function(v) { return '<span style="font-size:11px;font-family:var(--mono);color:var(--muted)">#'+v+'</span>'; } },
        { key: 'project_code', title: '项目编号', width: '8%', render: function(v, row) { return v ? projCodeTag(v, 'event.stopPropagation();openProject(\''+escHtml(v).replace(/'/g,"\\'")+'\')', row.project_name) : '-'; } },
        { key: 'stage_name', title: '阶段', render: function(v) { return '<span style="font-size:12px">'+escHtml(v||'')+'</span>'; } },
        { key: 'title', title: '任务标题', render: function(v) { return '<span style="font-weight:530">'+escHtml(v||'')+'</span>'; } },
        { key: 'status', title: '状态', width: '70px', render: function(v, row) { return '<span style="cursor:pointer" onclick="event.stopPropagation();openReviewerDialog('+row.id+')" title="'+(row.reviewer_name?'审批人: '+escHtml(row.reviewer_name)+' — 点击修改':'点击设置审批人')+'">'+renderPill(v||'review')+'</span>'; } },
        { key: 'progress', title: '进度', width: '6%', render: function(v) { return renderProgressCircle(v||0, 30, {label:''}); } },
        { key: 'assignee_name', title: '责任人', width: '8%', render: function(v) { return '<span style="font-size:12px">'+escHtml(v||'')+'</span>'; } },
        { key: 'due_date', title: '截止', width: '7%', render: function(v, row) { var overdue = v && row.status!=='done' && row.status!=='closed' && v<fmtLocalDate(); return '<span style="font-size:12px;color:'+(overdue?'var(--danger)':'')+'">'+(v||'-')+'</span>'; } },
        { key: 'actions', title: '操作', render: function(v, row) { return '<span style="white-space:nowrap" onclick="event.stopPropagation()"><button class="btn-icon" onclick="_ucApproveTask('+row.id+',\''+escJs(row.title)+'\')" title="批准" style="color:var(--success)">'+_ucApproveIcon+'</button><button class="btn-icon" onclick="_ucRejectTask('+row.id+',\''+escJs(row.title)+'\')" title="驳回" style="color:var(--danger);margin-left:2px">'+_ucRejectIcon+'</button></span>'; } }
      ],
      data: _ucApprovals,
      resizable: false,
      onRowClick: function(row) { _ucOpenTask(row.id); }
    });
  } else {
    _ucApprovalsDt.setData(_ucApprovals);
  }
}

function _ucApproveTask(taskId, taskTitle) {
  if (!confirm('确认批准任务「' + taskTitle + '」？批准后任务将标记为已完成。')) return;
  API.post('/tasks/' + taskId + '/approve').then(function() {
    showToast('任务「' + taskTitle + '」已批准', 'success');
    _ucLoadApprovals();
  }).catch(function(e) { showToast('批准失败: ' + (e.message || ''), 'error'); });
}

function _ucRejectTask(taskId, taskTitle) {
  var reason = prompt('请输入驳回原因：');
  if (!reason || !reason.trim()) return;
  API.post('/tasks/' + taskId + '/reject?reason=' + encodeURIComponent(reason.trim())).then(function() {
    showToast('任务「' + taskTitle + '」已驳回', 'warn');
    _ucLoadApprovals();
  }).catch(function(e) { showToast('驳回失败: ' + (e.message || ''), 'error'); });
}

function _ucLoadTasks(user) {
  var url = window._ucViewUserId ? '/tasks?assignee_id=' + window._ucViewUserId + '&limit=200' : '/tasks/my';
  API.get(url).then(function(tasks) {
    _ucTasks = Array.isArray(tasks) ? tasks : (tasks && tasks.items ? tasks.items : []);
    _ucUpdateTaskCount();
    _ucRenderTaskStats();
    _renderUcFilterBar();
    _renderUcTaskTable();
    // Re-render calendar with pie charts once task data is available
    _ucLoadCalendar(user);
    _ucLoadWecomCalendar(user);
  }).catch(function() {
    var wrap = document.getElementById('uc-tasks-table-wrap');
    if (wrap) wrap.innerHTML = '<div class="empty-state">加载失败</div>';
    _ucTasksDt = null;
  });
}

function _ucMatchFilter(status, task) {
  if (_ucFilterStatus === 'all' || !_ucFilterStatus) return true;
  if (_ucFilterStatus === 'unfinished') return status !== 'done' && status !== 'review';
  if (_ucFilterStatus === 'high_priority') {
    if (!task) return false;
    if (status === 'done' || status === 'closed') return false;
    return task.priority === 'high' || task.priority === 'critical';
  }
  if (_ucFilterStatus === 'expiring') {
    if (!task || !task.due_date) return false;
    if (status === 'done' || status === 'closed') return false;
    var today = fmtLocalDate();
    var due = task.due_date;
    var diff = Math.ceil((new Date(due + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000);
    return diff <= 3;
  }
  return status === _ucFilterStatus;
}

function _renderUcFilterBar() {
  var counts = {todo:0, in_progress:0, review:0, done:0};
  _ucTasks.forEach(function(t) {
    counts[t.status||'todo'] = (counts[t.status]||0)+1;
  });
  var unfinishedCount = _ucTasks.reduce(function(s,t){return s + ((t.status||'todo')!=='done'&&(t.status||'todo')!=='review'?1:0);}, 0);

  // Counts for new category cards
  var today = fmtLocalDate();
  var highPriorityCount = _ucTasks.reduce(function(s, t) {
    if ((t.status || 'todo') === 'done' || t.status === 'closed') return s;
    return s + (t.priority === 'high' || t.priority === 'critical' ? 1 : 0);
  }, 0);
  var expiringCount = _ucTasks.reduce(function(s, t) {
    if (!t.due_date) return s;
    if ((t.status || 'todo') === 'done' || t.status === 'closed') return s;
    var diff = Math.ceil((new Date(t.due_date + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000);
    return s + (diff <= 3 ? 1 : 0);
  }, 0);

  // Category cards — order: 高优先级 → 即将到期/已过期 → 未完成 → 已完成 → [评审中] → 全部
  var cardsHtml = '<div class="uc-cat-cards">'
    + '<div class="kpi-card' + (_ucFilterStatus==='high_priority'?' active':'') + '" data-filter="high_priority" onclick="_ucSetFilter(\'high_priority\')">'
    + '<div class="kpi-label">⚠ 高优先级</div><div class="kpi-value">' + highPriorityCount + '</div><div class="kpi-meta">高/紧急优先级</div></div>'
    + '<div class="kpi-card' + (_ucFilterStatus==='expiring'?' active':'') + '" data-filter="expiring" onclick="_ucSetFilter(\'expiring\')">'
    + '<div class="kpi-label">⏰ 即将到期/已过期</div><div class="kpi-value">' + expiringCount + '</div><div class="kpi-meta">3天内到期或已过期</div></div>'
    + '<div class="kpi-card' + (_ucFilterStatus==='unfinished'?' active':'') + '" data-filter="unfinished" onclick="_ucSetFilter(\'unfinished\')">'
    + '<div class="kpi-label">未完成</div><div class="kpi-value">' + unfinishedCount + '</div><div class="kpi-meta">待办 + 进行中</div></div>'
    + '<div class="kpi-card' + (_ucFilterStatus==='done'?' active':'') + '" data-filter="done" onclick="_ucSetFilter(\'done\')">'
    + '<div class="kpi-label">已完成</div><div class="kpi-value">' + (counts.done||0) + '</div><div class="kpi-meta">已完成的全部任务</div></div>';
  if (window._approvalEnabled) {
    cardsHtml += '<div class="kpi-card' + (_ucFilterStatus==='review'?' active':'') + '" data-filter="review" onclick="_ucSetFilter(\'review\')">'
      + '<div class="kpi-label">评审中</div><div class="kpi-value">' + (counts.review||0) + '</div><div class="kpi-meta">等待评审</div></div>';
  }
  cardsHtml += '<div class="kpi-card' + (_ucFilterStatus==='all'?' active':'') + '" data-filter="all" onclick="_ucSetFilter(\'all\')">'
    + '<div class="kpi-label">全部</div><div class="kpi-value">' + _ucTasks.length + '</div><div class="kpi-meta">所有任务</div></div>'
    + '</div>';

  // Build product items from user's tasks only
  var prodItems = [], prodSeen = {};
  _ucTasks.forEach(function(t) {
    var key = t.product_code || t.product_name || '';
    if (key && !prodSeen[key]) {
      prodSeen[key] = true;
      prodItems.push({ id: 'p' + prodItems.length, code: t.product_code, name: t.product_name });
    }
  });
  prodItems.sort(function(a, b) { return (a.code || a.name || '').localeCompare(b.code || b.name || ''); });

  // Build project items from user's tasks only
  var projItems = [], projSeen = {};
  _ucTasks.forEach(function(t) {
    var key = t.project_code || t.project_name || '';
    if (key && !projSeen[key]) {
      projSeen[key] = true;
      projItems.push({ id: 'j' + projItems.length, code: t.project_code, name: t.project_name });
    }
  });
  projItems.sort(function(a, b) { return (a.code || a.name || '').localeCompare(b.code || b.name || ''); });

  // Product search combo (from user's tasks)
  var prodSelHtml = createSearchCombo({
    comboId: 'uc-task-prod-filter', inputId: 'uc-task-prod-filter-input', dropdownId: 'uc-task-prod-filter-dropdown',
    placeholder: '全部产品',
    dataSource: prodItems,
    selectedIdFn: function() { return ''; },
    onSelect: function(p) { _ucFilterProd = p.name;
      var inp = document.getElementById('uc-task-prod-filter-input');
      if (inp) { var display = p.code ? p.code + ' ' + p.name : p.name; inp.value = display; inp.title = display; }
      _renderUcTaskTable(); _ucRefreshTaskStats(); }
  });

  // Project search combo (from user's tasks)
  var projSelHtml = createSearchCombo({
    comboId: 'uc-task-proj-filter', inputId: 'uc-task-proj-filter-input', dropdownId: 'uc-task-proj-filter-dropdown',
    placeholder: '全部项目',
    dataSource: projItems,
    selectedIdFn: function() { return ''; },
    onSelect: function(p) { _ucFilterProj = p.name;
      var inp = document.getElementById('uc-task-proj-filter-input');
      if (inp) { var display = p.code ? p.code + ' ' + p.name : p.name; inp.value = display; inp.title = display; }
      _renderUcTaskTable(); _ucRefreshTaskStats(); }
  });

  var projClearBtn = _ucFilterProj ? '<span class="combo-clear" onclick="_ucClearFilter(\'proj\')" title="清除项目过滤">✕</span>' : '';
  var prodClearBtn = _ucFilterProd ? '<span class="combo-clear" onclick="_ucClearFilter(\'prod\')" title="清除产品过滤">✕</span>' : '';

  document.getElementById('uc-tasks-filter-bar').innerHTML =
    '<div style="width:100%">' + cardsHtml + '</div>'
    + '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:6px">'
    + projSelHtml + projClearBtn + prodSelHtml + prodClearBtn + '</div>';
}

function _ucClearFilter(type) {
  if (type === 'proj') {
    _ucFilterProj = '';
    var inp = document.getElementById('uc-task-proj-filter-input');
    if (inp) inp.value = '';
  } else if (type === 'prod') {
    _ucFilterProd = '';
    var inp = document.getElementById('uc-task-prod-filter-input');
    if (inp) inp.value = '';
  }
  _renderUcTaskTable();
  _ucRefreshTaskStats();
  _renderUcFilterBar();
}

function _ucSetFilter(s) { _ucFilterStatus = s; _ucFilterProd = ''; _ucFilterProj = ''; _renderUcFilterBar(); _renderUcTaskTable(); _ucRefreshTaskStats(); }

function _ucRefreshTaskStats() {
  _ucRenderTaskStats();
}

function _ucOpenTask(taskId) {
  if (typeof openTaskDetail === 'function') { openTaskDetail(taskId); }
  else if (typeof loadViewScript === 'function') { loadViewScript('/js/tasks.js?v=' + APP_VERSION, function() { openTaskDetail(taskId); }); }
}


function _ucSortBy(col) {
  if (_ucSortCol === col) { _ucSortDir = _ucSortDir === 'asc' ? 'desc' : _ucSortDir === 'desc' ? '' : 'asc'; }
  else { _ucSortCol = col; _ucSortDir = 'asc'; }
  if (!_ucSortDir) { _ucSortCol = ''; _ucSortDir = 'asc'; }
  // Update sort indicators
  var prioEl = document.getElementById('uc-sort-prio');
  var dueEl = document.getElementById('uc-sort-due');
  if (prioEl) { prioEl.textContent = _ucSortCol==='priority' ? (_ucSortDir==='asc'?'▲':'▼') : '⇅'; prioEl.style.color = _ucSortCol==='priority' ? '' : 'var(--muted)'; }
  if (dueEl) { dueEl.textContent = _ucSortCol==='due_date' ? (_ucSortDir==='asc'?'▲':'▼') : '⇅'; dueEl.style.color = _ucSortCol==='due_date' ? '' : 'var(--muted)'; }
  _renderUcTaskTable();
}

function _ucTaskRow(t, opts) {
  opts = opts || {};
  var pct = t.progress || 0;
  var overdue = t.due_date && t.status !== 'done' && t.status !== 'closed' && t.due_date < fmtLocalDate();

  // Project code cell (with optional rowspan, skipped for merged rows)
  var projCell = '';
  if (!opts.skipProj) {
    var prs = opts.projRowspan > 1 ? ' rowspan="' + opts.projRowspan + '"' : '';
    projCell = '<td style="text-align:center;vertical-align:middle;border-right:2px solid var(--border)"' + prs + '>'
      + (t.project_code ? projCodeTag(t.project_code, 'event.stopPropagation();openProject(\'' + escHtml(t.project_code).replace(/'/g, "\\'") + '\')', t.project_name) : '-')
      + '</td>';
  }

  // Product code cell (with optional rowspan, skipped for merged rows)
  var prodCell = '';
  if (!opts.skipProd) {
    var prds = opts.prodRowspan > 1 ? ' rowspan="' + opts.prodRowspan + '"' : '';
    prodCell = '<td style="text-align:center;vertical-align:middle;font-size:12px"' + prds + '>'
      + (t.product_code ? '<span class="proj-code-btn" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" onclick="event.stopPropagation();openProductDetail(\'' + escHtml(t.product_code) + '\')" title="' + escHtml(t.product_code) + ' ' + escHtml(t.product_name || '') + '">' + escHtml(t.product_code) + '</span>' : '<span style="font-size:12px;color:var(--muted)">—</span>')
      + '</td>';
  }

  // Stage cell (with optional rowspan, skipped for merged rows)
  var stageCell = '';
  if (!opts.skipStage) {
    var srs = opts.stageRowspan > 1 ? ' rowspan="' + opts.stageRowspan + '"' : '';
    stageCell = '<td style="font-size:12px;text-align:center;vertical-align:middle"' + srs + '>' + escHtml(t.stage_name||'') + '</td>';
  }

  var trClass = opts.projFirst ? ' class="uc-proj-first"' : '';
  return '<tr style="cursor:pointer" onclick="_ucOpenTask('+t.id+')"' + trClass + '>' +
    // project code (rowspan)
    projCell +
    // product code (rowspan)
    prodCell +
    // stage (rowspan)
    stageCell +
    // checkbox
    '<td style="text-align:center;width:22px" onclick="event.stopPropagation();if(event.target!==this.firstElementChild){var cb=this.firstElementChild;if(cb){cb.checked=!cb.checked;cb.onchange()}}"><input type="checkbox" value="' + t.id + '" onchange="_onTaskCheckbox(this)" class="task-checkbox"></td>' +
    // task id
    '<td style="text-align:center;font-size:11px;font-family:var(--mono);color:var(--muted)">#' + t.id + '</td>' +
    // title
    '<td style="text-align:left;font-weight:530">' + escHtml(t.title) + '</td>' +
    // status
    '<td style="text-align:center' + (window._approvalEnabled ? ';cursor:pointer' : '') + '"' + (window._approvalEnabled ? ' onclick="event.stopPropagation();openReviewerDialog(' + t.id + ')" title="' + (t.reviewer_name ? '审批人: ' + escHtml(t.reviewer_name) + ' — 点击修改' : '点击设置审批人') + '"' : '') + '>' + renderPill(t.status||'todo') + '</td>' +
    // priority
    '<td style="text-align:center"><span class="prio-tag '+(t.priority||'medium')+'">'+({low:'低',medium:'中',high:'高',critical:'紧急'}[t.priority]||t.priority)+'</span></td>' +
    // progress
    '<td style="text-align:center">'+renderProgressCircle(pct,36,{label:''})+'</td>' +
    // due date
    '<td style="text-align:center;font-size:12px;color:'+(overdue?'var(--danger)':'')+'">'+(t.due_date||'-')+'</td>' +
    // actions
    '<td style="text-align:center;white-space:nowrap" onclick="event.stopPropagation()">' +
      iconEdit('_ucOpenTask('+t.id+')', '查看/编辑') +
      iconDelete('_ucDeleteTask('+t.id+')', '删除') +
    '</td>' +
  '</tr>';
}

var _ucTasksDt = null;

function _renderUcTaskTable() {
  var filtered = _ucTasks.filter(function(t) {
    if (!_ucMatchFilter(t.status || 'todo', t)) return false;
    if (_ucFilterProd && t.product_name !== _ucFilterProd) return false;
    if (_ucFilterProj && t.project_name !== _ucFilterProj) return false;
    return true;
  });
  if (_ucSortCol) {
    var prioOrder = {critical:4, high:3, medium:2, low:1};
    var dir = _ucSortDir === 'asc' ? 1 : -1;
    filtered.sort(function(a, b) {
      if (_ucSortCol === 'priority') return ((prioOrder[a.priority]||0) - (prioOrder[b.priority]||0)) * dir;
      else if (_ucSortCol === 'due_date') { var da = a.due_date||'9999-99-99', db = b.due_date||'9999-99-99'; return da.localeCompare(db) * dir; }
      return 0;
    });
  }

  // Flatten: sort projects, then products, then stages, then tasks
  var projMap = {};
  filtered.forEach(function(t) {
    var pk = t.project_code || t.project_name || '__unknown__';
    var dk = t.product_code || t.product_name || '__unknown__';
    var sk = t.stage_name || '未分类';
    if (!projMap[pk]) projMap[pk] = { code: t.project_code||'', name: t.project_name||'未知项目', prodMap: {} };
    if (!projMap[pk].prodMap[dk]) projMap[pk].prodMap[dk] = { code: t.product_code||'', name: t.product_name||'', stageMap: {} };
    if (!projMap[pk].prodMap[dk].stageMap[sk]) projMap[pk].prodMap[dk].stageMap[sk] = [];
    projMap[pk].prodMap[dk].stageMap[sk].push(t);
  });
  var projKeys = Object.keys(projMap).sort(function(a,b) {
    if (!projMap[a].code) return 1; if (!projMap[b].code) return -1;
    return projMap[a].name.localeCompare(projMap[b].name);
  });

  var flatRows = [];
  projKeys.forEach(function(pk) {
    var pg = projMap[pk];
    Object.keys(pg.prodMap).forEach(function(dk) {
      var pd = pg.prodMap[dk];
      Object.keys(pd.stageMap).forEach(function(sk) {
        pd.stageMap[sk].forEach(function(t) {
          t._projCode = pg.code || pk; t._prodName = pd.name || dk; t._stageName = sk;
          flatRows.push(t);
        });
      });
    });
  });

  _selectedTasks = new Set();
  var wrap = document.getElementById('uc-tasks-table-wrap');
  if (!flatRows.length) { wrap.innerHTML = '<div class="empty-state">暂无匹配任务</div>'; _ucTasksDt = null; return; }

  if (!_ucTasksDt) {
    wrap.innerHTML = '<div id="uc-tasks-dt"></div>';
    _ucTasksDt = new DataTable({
      container: document.getElementById('uc-tasks-dt'),
      columns: [
        { key: '_projCode', title: '项目编号', width: '8%', rowspan: true, render: function(v, row) { return v ? projCodeTag(row.project_code||v, 'event.stopPropagation();openProject(\''+escHtml(row.project_code||v).replace(/'/g,"\\'")+'\')', row.project_name) : '-'; } },
        { key: '_prodName', title: '产品编号', width: '100px', rowspan: true, render: function(v, row) { return row.product_code ? '<span class="proj-code-btn" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" onclick="event.stopPropagation();openProductDetail(\''+escHtml(row.product_code)+'\')" title="'+escHtml(row.product_code)+' '+escHtml(row.product_name||'')+'">'+escHtml(row.product_code)+'</span>' : '<span style="font-size:12px;color:var(--muted)">—</span>'; } },
        { key: '_stageName', title: '阶段', rowspan: true, render: function(v) { return '<span style="font-size:12px">'+escHtml(v||'')+'</span>'; } },
        { key: 'id', title: '任务编号', width: '6%', render: function(v) { return '<span style="font-size:11px;font-family:var(--mono);color:var(--muted)">#'+v+'</span>'; } },
        { key: 'title', title: '任务标题', align: 'left', render: function(v) { return '<span style="font-weight:530">'+escHtml(v||'')+'</span>'; } },
        { key: 'status', title: '状态', width: '70px', render: function(v, row) { var h = renderPill(v||'todo'); if (window._approvalEnabled) h = '<span style="cursor:pointer" onclick="event.stopPropagation();openReviewerDialog('+row.id+')" title="'+(row.reviewer_name?'审批人: '+escHtml(row.reviewer_name)+' — 点击修改':'点击设置审批人')+'">'+h+'</span>'; return h; } },
        { key: 'priority', title: '<span style="cursor:pointer" onclick="_ucSortBy(\'priority\')">优先级</span> <span id="uc-sort-prio" style="color:var(--muted);font-size:10px">⇅</span>', width: '6%', render: function(v) { return '<span class="prio-tag '+(v||'medium')+'">'+({low:'低',medium:'中',high:'高',critical:'紧急'}[v]||v)+'</span>'; } },
        { key: 'progress', title: '进度', width: '6%', render: function(v) { return renderProgressCircle(v||0, 36, {label:''}); } },
        { key: 'due_date', title: '<span style="cursor:pointer" onclick="_ucSortBy(\'due_date\')">截止</span> <span id="uc-sort-due" style="color:var(--muted);font-size:10px">⇅</span>', width: '7%', render: function(v, row) { var overdue = v && row.status!=='done' && row.status!=='closed' && v<fmtLocalDate(); return '<span style="font-size:12px;color:'+(overdue?'var(--danger)':'')+'">'+(v||'-')+'</span>'; } },
        { key: 'actions', title: '操作', render: function(v, row) { return '<span style="white-space:nowrap" onclick="event.stopPropagation()">'+iconEdit('_ucOpenTask('+row.id+')','查看/编辑')+iconDelete('_ucDeleteTask('+row.id+')','删除')+'</span>'; } }
      ],
      data: flatRows,
      maxHeight: '400px',
      resizable: false,
      stickyHeader: true,
      selectable: true,
      checkboxPosition: 3,
      onSelectChange: function(rows) { _selectedTasks = new Set(rows.map(function(r) { return r.id; })); if (typeof _ensureBatchToolbar==='function') _ensureBatchToolbar(); if (typeof _updateBatchToolbar==='function') _updateBatchToolbar(); },
      onRowClick: function(row) { _ucOpenTask(row.id); }
    });
  } else {
    _ucTasksDt.setData(flatRows);
  }

  if (typeof _ensureBatchToolbar === 'function') _ensureBatchToolbar();
  // Ensure table height is set — may have been missed by _ucUpdateLayout if DataTable wasn't yet created
  setTimeout(function() { if (typeof window._ucUpdateLayout === 'function') window._ucUpdateLayout(); }, 20);
  // Double-call to ensure layout has settled
  setTimeout(function() { if (typeof window._ucUpdateLayout === 'function') window._ucUpdateLayout(); }, 100);
}

function _ucEnsureBugsJs(fn) {
  // Lazy-load bugs.js, then call fn (handles bug onclick from user center)
  return 'loadViewScript(\'/js/bugs.js?v=' + APP_VERSION + '\',function(){' + fn + '})';
}

var _ucBugTab = 'assignee'; // 'assignee' | 'reporter'
var _ucBugFilterProd = '';
var _ucBugFilterProj = '';
var _ucBugFilterStatus = '';

function _ucRenderBugFilter(bugs, uid) {
  var assigned = (bugs||[]).filter(function(b) { return b.assignee_id === uid; });
  var reported = (bugs||[]).filter(function(b) { return b.reporter_id === uid; });
  // Collect unique product and project names from all bugs
  var prodSet = {}, projSet = {};
  (bugs||[]).forEach(function(b) {
    if (b.product_name) prodSet[b.product_name] = 1;
    if (b.project_name) projSet[b.project_name] = 1;
  });
  var projs = Object.keys(projSet).sort();
  var statuses = [{v:'',l:'全部状态'},{v:'open',l:'待确认'},{v:'confirmed',l:'已确认'},{v:'in_progress',l:'处理中'},{v:'resolved',l:'已解决'},{v:'closed',l:'已关闭'}];
  var statusSel = '<select class="proj-select" onchange="_ucBugFilterStatus=this.value;_ucLoadBugs()">' + statuses.map(function(s) { return '<option value="'+s.v+'"'+(_ucBugFilterStatus===s.v?' selected':'')+'>'+s.l+'</option>'; }).join('') + '</select>';
  var prodSelHtml = createProductCombo({
    comboId: 'uc-bug-prod-filter', inputId: 'uc-bug-prod-filter-input', dropdownId: 'uc-bug-prod-filter-dropdown',
    placeholder: '全部产品',
    onSelect: function(p) { _ucBugFilterProd = p.name; _ucLoadBugs(); }
  });
  var projSel = projs.length ? '<select class="proj-select" onchange="_ucBugFilterProj=this.value;_ucLoadBugs()"><option value="">全部项目</option>' + projs.map(function(p) { return '<option value="'+escHtml(p)+'"'+(_ucBugFilterProj===p?' selected':'')+'>'+escHtml(p)+'</option>'; }).join('') + '</select>' : '';
  document.getElementById('uc-bugs-filter-bar').innerHTML =
    '<div class="task-tabs">' +
      '<button class="task-tab' + (_ucBugTab==='assignee'?' active':'') + '" onclick="_ucBugTab=\'assignee\';_ucLoadBugs()">待我处理<span class="task-tab-count">' + assigned.length + '</span></button>' +
      '<button class="task-tab' + (_ucBugTab==='reporter'?' active':'') + '" onclick="_ucBugTab=\'reporter\';_ucLoadBugs()">我创建的<span class="task-tab-count">' + reported.length + '</span></button>' +
    '</div>' + statusSel + '<span style="display:inline-block;vertical-align:middle">' + prodSelHtml + '</span>' + projSel;
  var result = _ucBugTab === 'assignee' ? assigned : reported;
  // Apply product/project/status filters
  if (_ucBugFilterStatus) result = result.filter(function(b) { return (b.status || 'open') === _ucBugFilterStatus; });
  if (_ucBugFilterProd) result = result.filter(function(b) { return b.product_name === _ucBugFilterProd; });
  if (_ucBugFilterProj) result = result.filter(function(b) { return b.project_name === _ucBugFilterProj; });
  return result;
}

var _ucBugsDt = null;

async function _ucLoadBugs() {
  try {
    var user = getCurrentUser();
    var viewUid = window._ucViewUserId || (user ? user.id : null);
    var bugsUrl = window._ucViewUserId ? '/bugs?assignee_id=' + window._ucViewUserId + '&limit=200' : '/bugs/my';
    var bugs = await API.get(bugsUrl);
    bugs = Array.isArray(bugs) ? bugs : (bugs && bugs.items ? bugs.items : []);
    _ucUpdateBugCount((bugs || []).filter(function(b) { return b.assignee_id === viewUid; }).length);
    var filtered = _ucRenderBugFilter(bugs, viewUid);
    var container = document.getElementById('uc-bugs-table-wrap');
    if (!filtered.length) { container.innerHTML = '<div class="empty-state">' + (_ucBugTab==='assignee'?'暂无待处理的Bug':'暂无创建的Bug') + '</div>'; _ucBugsDt = null; if (_ucActiveTab==='bugs') _ucLoadBugStats(); return; }
    if (!_ucBugsDt) {
      container.innerHTML = '<div id="uc-bugs-dt"></div>';
      _ucBugsDt = new DataTable({
        container: document.getElementById('uc-bugs-dt'),
        columns: [
          { key: 'id', title: 'Bug编号', width: '6%', render: function(v) { return '<span style="font-family:var(--mono);font-size:11px">#'+v+'</span>'; } },
          { key: 'project_code', title: '项目编号', width: '8%', render: function(v, row) { return v ? projCodeTag(v, 'event.stopPropagation();openProject(\''+escHtml(v)+'\')', row.project_name) : escHtml(row.project_name||'-'); } },
          { key: 'product_code', title: '产品编号', width: '100px', render: function(v, row) { return v ? '<span class="proj-code-btn" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" onclick="event.stopPropagation();openProductDetail(\''+escHtml(v)+'\')" title="'+escHtml(v)+' '+escHtml(row.product_name||'')+'">'+escHtml(v)+'</span>' : '<span style="font-size:12px;color:var(--muted)">—</span>'; } },
          { key: 'title', title: 'Bug标题', align: 'left', render: function(v) { return '<span style="font-weight:530">'+escHtml(v||'')+'</span>'; } },
          { key: 'status', title: '状态', width: '70px', render: function(v) { return renderPill(v||'open'); } },
          { key: 'priority', title: '优先级', width: '6%', render: function(v) { return '<span class="prio-tag '+(v||'medium')+'">'+({low:'低',medium:'中',high:'高',critical:'紧急'}[v]||v)+'</span>'; } },
          { key: 'progress', title: '进度', width: '6%', render: function(v) { return typeof renderProgressCircle==='function'?renderProgressCircle(v||0,36,{label:''}):(v||0)+'%'; } },
          { key: 'due_date', title: '截止', width: '7%', render: function(v) { return '<span style="font-size:12px">'+(v||'—')+'</span>'; } },
          { key: 'actions', title: '操作', render: function(v, row) { return '<span style="white-space:nowrap" onclick="event.stopPropagation()">'+iconEdit(_ucEnsureBugsJs('openBugDialog('+row.id+')'),'编辑')+iconDelete(_ucEnsureBugsJs('deleteBugById('+row.id+')'),'删除')+'</span>'; } }
        ],
        data: filtered,
        resizable: false,
        onRowClick: function(row) { _ucEnsureBugsJs('openBugDetail('+row.id+')'); eval('openBugDetail('+row.id+')'); }
      });
    } else { _ucBugsDt.setData(filtered); }
  } catch(e) { document.getElementById('uc-bugs-table-wrap').innerHTML = '<div class="error-state">加载失败</div>'; _ucBugsDt = null; }
  if (_ucActiveTab === 'bugs') _ucLoadBugStats();
  setTimeout(function() { if (typeof window._ucUpdateLayout === "function") window._ucUpdateLayout(); }, 50);
}

function _ucNewTask() {
  // Auto-fill project context from current page
  var pid = sessionStorage.getItem('pm_last_proj_id');
  if (pid) window._taskProjectId = parseInt(pid);
  if (typeof openTaskDialog === 'function') { openTaskDialog(); }
  else if (typeof loadViewScript === 'function') { loadViewScript('/js/tasks.js?v=' + APP_VERSION, function() { openTaskDialog(); }); }
}
async function _ucDeleteTask(taskId) {
  if (!confirm('确定删除此任务？')) return;
  try {
    await API.del('/tasks/' + taskId);
    showToast('已删除', 'success');
    var user = getCurrentUser();
    if (user) _ucLoadTasks(user);
  } catch(e) { showToast('删除失败: ' + (e.message || ''), 'error'); }
}
function _ucLoadBugStats() {
  var rs = document.getElementById('uc-right-stats');
  if (!rs) return;
  var bugsUrl2 = window._ucViewUserId ? '/bugs?assignee_id=' + window._ucViewUserId + '&limit=200' : '/bugs/my';
  API.get(bugsUrl2).then(function(bugs) {
    bugs = Array.isArray(bugs) ? bugs : (bugs && bugs.items ? bugs.items : []);
    var user = getCurrentUser();
    var uid = window._ucViewUserId || (user ? user.id : null);
    // Filter by tab: assignee or reporter
    var filtered = _ucBugTab === 'assignee'
      ? (bugs||[]).filter(function(b) { return b.assignee_id === uid; })
      : (bugs||[]).filter(function(b) { return b.reporter_id === uid; });
    // Apply product/project/status filters from dropdowns
    if (_ucBugFilterStatus) filtered = filtered.filter(function(b) { return (b.status || 'open') === _ucBugFilterStatus; });
    if (_ucBugFilterProd) filtered = filtered.filter(function(b) { return b.product_name === _ucBugFilterProd; });
    if (_ucBugFilterProj) filtered = filtered.filter(function(b) { return b.project_name === _ucBugFilterProj; });
    // Exclude resolved/closed
    var activeBugs = filtered.filter(function(b) { return b.status !== 'resolved' && b.status !== 'closed'; });
    var title = (_ucBugTab === 'assignee' ? '待我处理' : '我创建的') + ' · 产品分布（活跃）';
    if (typeof _buildPieChart !== 'function') return;
    var byProd = {}, prodList = [], prodColors = ['var(--accent)','var(--warn)','var(--success)','var(--danger)','var(--purple)'];
    if (activeBugs.length > 0) {
      activeBugs.forEach(function(b) {
        var pn = b.product_name || '未知';
        if (!byProd[pn]) { byProd[pn] = 0; prodList.push({key: pn, label: pn}); }
        byProd[pn]++;
      });
      prodList.sort(function(a,b) { return byProd[b.key] - byProd[a.key]; });
      prodList.forEach(function(s, i) { s.color = prodColors[i % prodColors.length]; });
    }
    var bugHtml = '<div class="panel panel-pad" style="margin-top:18px" id="uc-bug-stats">' +
      '<div class="sec-hd"><h2>Bug统计</h2></div>' +
      '<div style="display:flex;gap:8px">' +
        _buildPieChart(activeBugs.length ? prodList : [{key:'—',label:'—',color:'var(--muted)'}], activeBugs.length ? byProd : {'—':0}, activeBugs.length, title) +
      '</div></div>';
    rs.innerHTML = bugHtml;
  }).catch(function(){});
}

function _ucBuildTaskStats() {
  var cols = [
    {key:'todo',label:'待办',color:'var(--muted)'},
    {key:'in_progress',label:'进行中',color:'var(--accent)'},
    {key:'review',label:'评审中',color:'var(--warn)'},
    {key:'done',label:'已完成',color:'var(--success)'},
  ];
  var tasks = _ucTasks || [];
  // Apply filters
  if (_ucFilterStatus && _ucFilterStatus !== 'all') {
    tasks = tasks.filter(function(t) { return _ucMatchFilter(t.status || 'todo', t); });
  }
  if (_ucFilterProd) {
    tasks = tasks.filter(function(t) { return t.product_name === _ucFilterProd; });
  }
  if (_ucFilterProj) {
    tasks = tasks.filter(function(t) { return t.project_name === _ucFilterProj; });
  }
  var totalTasks = tasks.length;
  if (typeof _buildPieChart !== 'function') return '';
  if (totalTasks === 0) {
    // Show empty card so the section remains visible
    var emptyCounts = {}; cols.forEach(function(c) { emptyCounts[c.key] = 0; });
    return '<div class="panel panel-pad" style="margin-bottom:18px" id="uc-task-stats">' +
      '<div class="sec-hd"><h2>任务统计</h2></div>' +
      '<div style="display:flex;gap:8px">' +
        _buildPieChart(cols, emptyCounts, 0, '状态分布') +
        _buildPieChart([{key:'—',label:'—',color:'var(--muted)'}], {'—':0}, 0, '项目分布') +
      '</div></div>';
  }
  var byStatus = {}; cols.forEach(function(c){byStatus[c.key]=0;});
  tasks.forEach(function(t){var s=t.status||'todo';byStatus[s]=(byStatus[s]||0)+1;});
  var statusCounts = {}; cols.forEach(function(c){statusCounts[c.key]=byStatus[c.key]||0;});

  // Project distribution: top 3 by count
  var byProj = {}, projColors = ['var(--accent)','var(--success)','var(--warn)'];
  var projList = [];
  tasks.forEach(function(t){var pn=t.project_code||t.project_name||'未知';if(!byProj[pn]){byProj[pn]=0;projList.push({key:pn,label:pn});}byProj[pn]++;});
  projList.sort(function(a,b){return byProj[b.key]-byProj[a.key];});
  projList = projList.slice(0,3);
  while (projList.length < 3) { var dummy = '—'; projList.push({key:dummy+projList.length,label:dummy}); byProj[dummy+projList.length]=0; }
  projList.forEach(function(s,i){s.color=projColors[i];});

  var activeCols = cols.filter(function(c){return (statusCounts[c.key]||0)>0;});
  return '<div class="panel panel-pad" style="margin-bottom:18px" id="uc-task-stats">' +
    '<div class="sec-hd"><h2>任务统计</h2></div>' +
    '<div style="display:flex;gap:8px">' +
      _buildPieChart(activeCols, statusCounts, totalTasks, '状态分布') +
      _buildPieChart(projList, byProj, totalTasks, '项目分布') +
    '</div></div>';
}

function _ucLoadCalendar(user) {
  // Use the month currently displayed in the calendar (supports navigation)
  var now = new Date();
  var y = (typeof _calYear !== 'undefined') ? _calYear : now.getFullYear();
  var m = (typeof _calMonth !== 'undefined') ? _calMonth : (now.getMonth()+1);
  var ms = new Date(y, m-1, 1);
  var me = new Date(y, m, 0);
  var df = fmtLocalDate(ms), dt = fmtLocalDate(me);
  var cal = document.getElementById('uc-calendar');
  if(!cal) return;

  // Load calendar data + render pie charts + intensity calendar
  API.get('/worklogs/calendar?user_id='+user.id+'&date_from='+df+'&date_to='+dt).then(function(data) {
    var dailyMap = {};
    if(data&&data.daily) data.daily.forEach(function(d){dailyMap[d.date]=d;});
    var total = data?(data.total||0):0;

    // Calculate this week's total from dailyMap
    var weekTotal = 0;
    var today = new Date();
    var curDow = today.getDay();
    var monOff = curDow === 0 ? -6 : 1 - curDow;
    for (var wi = 0; wi < 7; wi++) {
      var wd = new Date(today);
      wd.setDate(today.getDate() + monOff + wi);
      var wds = fmtLocalDate(wd);
      if (dailyMap[wds]) weekTotal += dailyMap[wds].total_hours || 0;
    }
    var monthTotal = total;

    // Standard working hours
    var weekStd = 40;
    var workDays = 0;
    for (var di = 1; di <= me.getDate(); di++) {
      var dw = new Date(y, m-1, di).getDay();
      if (dw !== 0 && dw !== 6) workDays++;
    }
    var monthStd = workDays * 8;

    // Intensity bar: ratio vs standard working hours
    // within +-5%: green | below: blue | above: graded like daily
    function _ucBarCls(hours, std) {
      if (std <= 0) return 'uc-hbar-empty';
      var r = hours / std;
      if (r >= 0.95 && r <= 1.05) return 'uc-hbar-ok';
      if (r < 0.95) return 'uc-hbar-under';
      if (r <= 1.25) return 'uc-hbar-low';
      if (r <= 1.50) return 'uc-hbar-mid';
      if (r <= 1.75) return 'uc-hbar-high';
      return 'uc-hbar-over';
    }
    var weekCls = _ucBarCls(weekTotal, weekStd);
    var monthCls = _ucBarCls(monthTotal, monthStd);

    var html = '';

    // Calendar card
    html += '<div class="panel panel-pad">' +
      '<div class="sec-hd" style="display:flex;justify-content:space-between;align-items:center">' +
        '<h2 style="margin:0">工时</h2>' +
        '<div style="display:flex;align-items:center;gap:8px">' +
          '<span style="font-size:11px;color:var(--muted)">周</span>' +
          '<span class="uc-week-bar ' + weekCls + '">' + (typeof fmtHours === 'function' ? fmtHours(weekTotal) : weekTotal.toFixed(1) + 'h') + '</span>' +
          '<span style="font-size:11px;color:var(--muted)">月</span>' +
          '<span class="uc-week-bar ' + monthCls + '">' + (typeof fmtHours === 'function' ? fmtHours(monthTotal) : monthTotal.toFixed(1) + 'h') + '</span>' +
        '</div>' +
      '</div>';
    if (typeof _renderMonthCalendar === 'function') {
      html += _renderMonthCalendar(now, dailyMap, data);
    }
    html += '</div>';
    cal.innerHTML = html;

    // Bug stats: only refresh when bugs tab is active
    if (_ucActiveTab === 'bugs') _ucLoadBugStats();
  }).catch(function(){});
}

var _ucPanelOpen = null;
function _ucTogglePanel(type) {
  var expand = document.getElementById('uc-expand');
  var content = document.getElementById('uc-expand-content');
  var user = getCurrentUser();
  if (_ucPanelOpen === type) { _ucPanelOpen = null; expand.classList.remove('open'); return; }
  _ucPanelOpen = type; expand.classList.add('open');
  if (type === 'gitlab') {
    var isGitlab = user.auth_source === 'gitlab';
    content.innerHTML =
      '<div class="expand-card" style="visibility:hidden"></div>' +
      '<div class="expand-card">' +
        '<h3><svg width="16" height="16" viewBox="0 0 380 380" fill="#e24329"><path d="M282.83 170.73l-.27-.69-26.14-68.22a6.81 6.81 0 00-2.69-3.24 7 7 0 00-8 .43 7 7 0 00-2.32 3.52l-17.65 54H154.07l-17.65-54a6.86 6.86 0 00-2.32-3.53 7 7 0 00-8-.43 6.87 6.87 0 00-2.69 3.24L97.44 170l-.26.69a48.54 48.54 0 0016.1 56.1l.09.07.24.17 39.82 30.2 19.7 15.11 12 9.08a7.07 7.07 0 004.33 1.58 7.09 7.09 0 004.33-1.58l12-9.08 19.7-15.11 40.06-30.35.09-.07a48.63 48.63 0 0016.08-56.1z"/></svg> GitLab 账户</h3>' +
        (isGitlab ? '' +
          '<div class="integration-row"><span class="integration-row-lbl">用户名</span><span class="integration-row-val">@'+escHtml(user.username)+'</span></div>' +
          '<div class="integration-row"><span class="integration-row-lbl">Token 状态</span><span class="integration-row-val ok">'+(user.gitlab_token_valid?'有效':'无效')+'</span></div>' +
          '<a class="integration-link" href="http://192.168.0.128/'+escHtml(user.username)+'" target="_blank">GitLab 个人主页 ↗</a>'
        : '<div class="integration-row"><span class="integration-row-lbl">状态</span><span class="integration-row-val">未启用，请使用本地密码登录</span></div>') +
      '</div>';
  } else if (type === 'security') {
    var isGitlab = user.auth_source === 'gitlab';
    content.innerHTML =
      '<div class="expand-card" style="visibility:hidden"></div>' +
      '<div class="expand-card">' +
        '<h3><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg> 安全设置</h3>' +
        '<div class="integration-row"><span class="integration-row-lbl">账户来源</span><span class="integration-row-val">'+(isGitlab?'GitLab OAuth':'本地账户')+'</span></div>' +
        '<div class="integration-row"><span class="integration-row-lbl">登录方式</span><span class="integration-row-val">'+(isGitlab?'GitLab 账户登录':'本地密码登录')+'</span></div>' +
        (isGitlab
          ? '<a class="integration-link" href="http://192.168.0.128/-/profile/password/edit" target="_blank">在 GitLab 中管理密码 ↗</a>'
          : '<button class="btn btn-sm" onclick="changePassword()">修改密码</button>') +
      '</div>';
  } else if (type === 'preferences') {
    _renderPreferencesPanel(content);
  }
}

function _renderPreferencesPanel(content) {
  if (!content) content = document.getElementById('pref-dialog-content') || document.getElementById('uc-expand-content');
  var tickerOn = localStorage.getItem('pma_ticker_enabled') !== '0';
  var tickerSpeed = localStorage.getItem('pma_ticker_speed') || 'normal';
  var tickerMode = localStorage.getItem('pma_ticker_mode') || 'activities';
  var themeMode = localStorage.getItem('pm_theme_mode') || 'auto';
  var speedLabels = {slow: '慢速', normal: '正常', fast: '快速'};
  var speedBtns = '';
  ['slow', 'normal', 'fast'].forEach(function(s) {
    speedBtns += '<button class="btn btn-xs" style="margin-right:4px;' +
      (tickerSpeed === s ? 'background:var(--accent);color:#fff;border-color:var(--accent)' : '') +
      '" onclick="setTickerSpeed(\'' + s + '\');_renderPreferencesPanel()">' + speedLabels[s] + '</button>';
  });
  var modeLabels = {alerts: '告警信息', activities: '任务动态'};
  var modeBtns = '';
  ['activities', 'alerts'].forEach(function(m) {
    modeBtns += '<button class="btn btn-xs" style="margin-right:4px;' +
      (tickerMode === m ? 'background:var(--accent);color:#fff;border-color:var(--accent)' : '') +
      '" onclick="toggleTickerContentMode()">' + modeLabels[m] + '</button>';
  });
  var themeIcons = {
    auto: '<svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="#f5c542" stroke-width="1.2" style="vertical-align:middle"><path d="M6 .278a.768.768 0 0 1 .08.858 7.208 7.208 0 0 0-.878 3.46c0 4.021 3.278 7.277 7.318 7.277.527 0 1.04-.055 1.533-.16a.787.787 0 0 1 .81.316.733.733 0 0 1-.031.893A8.349 8.349 0 0 1 8.344 16C3.734 16 0 12.286 0 7.71 0 4.266 2.114 1.312 5.124.06A.752.752 0 0 1 6 .278z"/><text x="6.5" y="11" font-size="12" font-weight="700" fill="#f5c542" stroke="none" font-family="sans-serif">A</text></svg>',
    light: '<svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="#f59e0b" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.2 3.2l1 1M11.8 11.8l1 1M11.8 3.2l-1 1M4.2 11.8l-1 1M5 8a3 3 0 1 0 6 0 3 3 0 0 0-6 0z"/></svg>',
    dark: '<svg width="20" height="20" viewBox="0 0 16 16" fill="#f5c542" stroke="none" style="vertical-align:middle"><path d="M6 .278a.768.768 0 0 1 .08.858 7.208 7.208 0 0 0-.878 3.46c0 4.021 3.278 7.277 7.318 7.277.527 0 1.04-.055 1.533-.16a.787.787 0 0 1 .81.316.733.733 0 0 1-.031.893A8.349 8.349 0 0 1 8.344 16C3.734 16 0 12.286 0 7.71 0 4.266 2.114 1.312 5.124.06A.752.752 0 0 1 6 .278z"/></svg>'
  };
  var themeTips = {auto: '自动（白天浅色，晚上深色）', light: '浅色', dark: '深色'};
  var themeBtns = '';
  ['auto', 'light', 'dark'].forEach(function(m) {
    themeBtns += '<button class="btn-icon" title="' + themeTips[m] + '" style="margin-right:8px;padding:3px 7px;border-radius:6px;' +
      (themeMode === m ? 'background:var(--accent-lt);border:1px solid var(--accent)' : 'border:1px solid transparent') +
      '" onclick="setThemeMode(\'' + m + '\');_renderPreferencesPanel()">' + themeIcons[m] + '</button>';
  });

  var html =
    '<div class="expand-card" style="visibility:hidden"></div>' +
    '<div class="expand-card">' +
      '<h3 style="margin-bottom:12px"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> 偏好设置</h3>' +

      // Responsive card grid
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px">' +

        // Card 1: 通知
        '<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px">' +
          '<div style="font-size:12px;font-weight:600;color:var(--fg);margin-bottom:10px">通知</div>' +
          '<div class="integration-row" style="margin-bottom:8px">' +
            '<span class="integration-row-lbl">底部滚动告警条</span>' +
            toggleSwitch(tickerOn, 'toggleAlertTicker();_renderPreferencesPanel()') +
          '</div>' +
          (tickerOn ? '<div><span style="font-size:11px;color:var(--muted)">滚动速率</span><div style="margin-top:3px">' + speedBtns + '</div></div><div style="margin-top:6px"><span style="font-size:11px;color:var(--muted)">显示内容</span><div style="margin-top:3px">' + modeBtns + '</div></div>' : '') +
        '</div>' +

        // Card 2: 外观
        '<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px">' +
          '<div style="font-size:12px;font-weight:600;color:var(--fg);margin-bottom:10px">外观</div>' +
          '<div class="integration-row">' +
            '<span class="integration-row-lbl">主题模式</span>' +
            '<span class="integration-row-val">' + themeBtns + '</span>' +
          '</div>' +
        '</div>' +

      '</div>' +

      '<div style="font-size:10px;color:var(--muted);margin-top:10px;padding-top:8px;border-top:1px solid var(--border)">更多偏好设置即将上线</div>' +
    '</div>';
  if (content) content.innerHTML = html;
  return html;
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

function _savePref(key, value) {
  try { localStorage.setItem(key, value); } catch(e) {}
  // Persist to backend
  try { API.put('/auth/preferences', { key: key, value: String(value) }); } catch(e) {}
}

function _getEffectiveTheme() {
  var mode = localStorage.getItem('pm_theme_mode') || 'auto';
  if (mode === 'auto') {
    var h = new Date().getHours();
    return (h >= 6 && h < 19) ? 'light' : 'dark';
  }
  return mode;
}

function _applyTheme(theme) {
  localStorage.setItem('pm_theme', theme);  // effective theme for pre-render
  document.documentElement.setAttribute('data-theme', theme);

  var mode = localStorage.getItem('pm_theme_mode') || 'auto';
  var themeBtn = document.getElementById('theme-toggle-btn');
  if (themeBtn) {
    if (mode === 'auto') {
      // Moon + "A" — auto mode
      themeBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="#f5c542" stroke-width="1.2"><path d="M6 .278a.768.768 0 0 1 .08.858 7.208 7.208 0 0 0-.878 3.46c0 4.021 3.278 7.277 7.318 7.277.527 0 1.04-.055 1.533-.16a.787.787 0 0 1 .81.316.733.733 0 0 1-.031.893A8.349 8.349 0 0 1 8.344 16C3.734 16 0 12.286 0 7.71 0 4.266 2.114 1.312 5.124.06A.752.752 0 0 1 6 .278z"/><text x="6.5" y="10" font-size="12" font-weight="700" fill="#f5c542" stroke="none" font-family="sans-serif">A</text></svg>';
      themeBtn.title = '自动切换（白天浅色，晚上深色）';
    } else if (theme === 'dark') {
      themeBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 16 16" fill="#f5c542" stroke="none"><path d="M6 .278a.768.768 0 0 1 .08.858 7.208 7.208 0 0 0-.878 3.46c0 4.021 3.278 7.277 7.318 7.277.527 0 1.04-.055 1.533-.16a.787.787 0 0 1 .81.316.733.733 0 0 1-.031.893A8.349 8.349 0 0 1 8.344 16C3.734 16 0 12.286 0 7.71 0 4.266 2.114 1.312 5.124.06A.752.752 0 0 1 6 .278z"/></svg>';
      themeBtn.title = '深色 · 点击切换浅色';
    } else {
      themeBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.2 3.2l1 1M11.8 11.8l1 1M11.8 3.2l-1 1M4.2 11.8l-1 1M5 8a3 3 0 1 0 6 0 3 3 0 0 0-6 0z"/></svg>';
      themeBtn.title = '浅色 · 点击切换自动';
    }
  }
}

// Re-evaluate time-based auto theme every 5 minutes
setInterval(function() {
  if ((localStorage.getItem('pm_theme_mode') || 'auto') === 'auto') {
    _applyTheme(_getEffectiveTheme());
  }
}, 300000);

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

// ── New User Guide ──

var _guideAllSteps = [
  { el: '.sidebar-brand', tip: '点击 PMA Logo 进入个人中心', pos: 'bottom' },
  { el: '.sidebar-nav', tip: '通过左侧导航栏切换各个功能页面', pos: 'right' },
  { el: '#topbar-sources', tip: '顶部标签显示数据源连接状态，鼠标悬停查看详情', pos: 'bottom' },
  { el: '#notif-bell-btn', tip: '铃铛图标是通知中心，查看系统告警和历史消息', pos: 'bottom' },
  { el: '#theme-toggle-btn', tip: '浅色/深色主题切换，支持自动模式', pos: 'bottom' },
  { el: '#user-avatar', tip: '个人中心：任务总览、偏好设置、切换账号、工时统计等', pos: 'bottom' },
  { el: '#feedback-link', tip: '左下角问题反馈入口，提交 Bug 或功能建议', pos: 'top' },
  { el: '#src-sync-btn', tip: '点击这里手动触发数据同步', pos: 'bottom', adminOnly: true },
];

function showNewUserGuide() {
  // Filter steps by user permissions
  var user = getCurrentUser();
  var perms = (user && user.permissions) ? user.permissions.split(',') : [];
  var isAdmin = user && (user.role === 'admin' || perms.indexOf('admin') >= 0);
  var steps = _guideAllSteps.filter(function(s) { return !s.adminOnly || isAdmin; });

  var step = 0;
  var overlay = document.createElement('div');
  overlay.id = 'guide-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.2);z-index:9999;transition:opacity 0.3s';
  var highlight = document.createElement('div');
  highlight.id = 'guide-highlight';
  highlight.style.cssText = 'position:fixed;z-index:10001;border:2px solid var(--accent);border-radius:8px;box-shadow:0 0 0 6px var(--accent-lt);pointer-events:none;transition:all 0.3s';
  var tipBox = document.createElement('div');
  tipBox.id = 'guide-tip';
  tipBox.style.cssText = 'position:fixed;z-index:10000;background:var(--surface);border:2px solid var(--accent);border-radius:10px;padding:16px 20px;box-shadow:0 8px 32px rgba(0,0,0,0.3);width:300px;font-size:13px;line-height:1.6;transition:all 0.3s';
  var tipText = document.createElement('div');
  tipText.style.cssText = 'margin-bottom:12px;color:var(--fg)';
  var prevBtn = document.createElement('button');
  prevBtn.className = 'btn btn-sm'; prevBtn.textContent = '上一步'; prevBtn.style.display = 'none';
  var nextBtn = document.createElement('button');
  nextBtn.className = 'btn btn-primary'; nextBtn.style.cssText = 'font-size:12px;padding:4px 14px;margin-left:auto';
  var btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;align-items:center;gap:8px';
  btnRow.append(prevBtn, nextBtn);
  tipBox.append(tipText, btnRow);
  document.body.append(overlay, highlight, tipBox);

  function showStep(n) {
    step = n;
    if (step >= steps.length) {
      overlay.remove(); highlight.remove(); tipBox.remove();
      showGuideWelcome();
      return;
    }
    var s = steps[n];
    var target = document.querySelector(s.el);
    if (!target) { showStep(n + 1); return; }
    var r = target.getBoundingClientRect();
    // Update highlight (clamp within viewport)
    var hl = Math.max(0, r.left - 6), ht = Math.max(0, r.top - 6);
    var hw = Math.max(48, Math.min(r.width + 12, window.innerWidth - hl)), hh = Math.max(36, Math.min(r.height + 12, window.innerHeight - ht));
    highlight.style.left = hl + 'px';
    highlight.style.top = ht + 'px';
    highlight.style.width = hw + 'px';
    highlight.style.height = hh + 'px';
    highlight.style.display = '';
    // Position tip
    var tipW = 300, tipH = 110;
    var tx, ty;
    if (s.pos === 'right') {
      tx = Math.min(r.right + 16, window.innerWidth - tipW - 16);
      ty = Math.max(16, Math.min(r.top + r.height / 2 - tipH / 2, window.innerHeight - tipH - 16));
      tipBox.style.transform = 'none';
    } else if (s.pos === 'top') {
      tx = Math.max(tipW / 2 + 8, Math.min(r.left + r.width / 2, window.innerWidth - tipW / 2 - 8));
      ty = Math.max(16, r.top - tipH - 12);
      tipBox.style.transform = 'translate(-50%, 0)';
    } else {
      tx = Math.max(tipW / 2 + 8, Math.min(r.left + r.width / 2, window.innerWidth - tipW / 2 - 8));
      ty = Math.min(r.bottom + 12, window.innerHeight - tipH - 16);
      tipBox.style.transform = 'translate(-50%, 0)';
    }
    tipText.textContent = s.tip;
    tipBox.style.left = tx + 'px';
    tipBox.style.top = ty + 'px';
    prevBtn.style.display = n > 0 ? '' : 'none';
    nextBtn.textContent = n < steps.length - 1 ? '下一步' : '完成';
  }

  nextBtn.onclick = function() { showStep(step + 1); };
  prevBtn.onclick = function() { showStep(step - 1); };
  overlay.addEventListener('click', function(e) { e.stopPropagation(); });
  showStep(0);
}

async function showGuideWelcome() {
  var user = getCurrentUser();
  // Fetch admin contacts
  var contactsHtml = '加载中...';
  try {
    var resp = await fetch('/api/auth/gitlab/admin-contacts');
    var json = await resp.json();
    if (json.code === 0 && json.data && json.data.contacts && json.data.contacts.length > 0) {
      contactsHtml = json.data.contacts.map(function(c) {
        return '<span style="display:inline-block;margin:2px 4px;padding:2px 8px;border-radius:3px;font-size:11px;background:var(--accent-lt);color:var(--accent)">' +
          escHtml(c.display_name || c.username) + ' (@' + escHtml(c.username) + ')</span>';
      }).join('');
    } else {
      contactsHtml = '暂无管理员信息';
    }
  } catch(e) { contactsHtml = '获取失败'; }

  var perms = (user ? user.permissions || '' : '').split(',').filter(Boolean);
  var permLabels = {'admin': '系统管理', 'sync': '数据同步', 'project_edit': '项目维护', 'product_link': '产品维护', 'customer_link': '客户维护', 'doc_template': '文档模板配置', 'stage_mapping': '阶段映射'};
  var permBadges = perms.length ? perms.map(function(p) { return '<span style="display:inline-block;margin:1px 3px;padding:2px 8px;border-radius:3px;font-size:11px;background:var(--accent-lt);color:var(--accent)">' + escHtml(permLabels[p] || p) + '</span>'; }).join('') : '无特殊权限（基础 public 角色）';

  var html =
    '<div style="text-align:center;padding:8px 0">' +
      '<img src="/logo/logo-mark-light.svg" style="width:140px;margin-bottom:12px" onerror="this.style.display=\'none\'">' +
      '<div style="font-size:14px;line-height:1.8;margin-bottom:16px">欢迎使用项目管理助手！</div>' +
    '</div>' +
    '<div style="margin-bottom:12px;font-size:12px;line-height:1.6">' +
      '<div style="font-size:11px;color:var(--muted);margin-bottom:4px">当前权限</div>' +
      '<div style="line-height:2">' + permBadges + '</div>' +
    '</div>' +
    '<div style="padding:12px;background:var(--bg);border-radius:8px;border:1px solid var(--border);font-size:12px;line-height:1.6">' +
      '<strong>需要更多权限？</strong>请联系以下管理员为你分配相应角色：' +
      '<div style="margin-top:6px;line-height:2">' + contactsHtml + '</div>' +
    '</div>';
  openDialog('&#x1F44B; 欢迎使用 PMA', html,
    [{ text: '开始使用', cls: 'btn-primary', onclick: "var d=document.querySelector('.shared-dialog-overlay,.note-dialog-overlay');if(d)d.remove();API.put('/auth/guide/done',{});checkNewVersion()" }],
    { maxWidth: 460 }
  );
}

// ── Version Changelog Dialog ──

async function checkNewVersion() {
  var user = getCurrentUser();
  var lastVer = (user && user.seen_version) || '';
  var curVer = window.APP_VERSION || '';
  if (!curVer) return;
  if (lastVer === curVer) return;

  // Mark current version as seen immediately (persist to server + update local cache)
  API.put('/auth/seen-version?version=' + encodeURIComponent(curVer)).then(function() {
    if (user) { user.seen_version = curVer; localStorage.setItem('pma_user', JSON.stringify(user)); }
  }).catch(function(){});

  try {
    var data = await API.get('/admin/changelog');
    var allEntries = data || [];

    // Collect entries newer than lastVer (exclusive) up to curVer (inclusive)
    // allEntries is newest-first from dev-plan.md; reverse to show oldest first
    var newEntries = [];
    var foundLast = false;
    for (var i = 0; i < allEntries.length; i++) {
      if (allEntries[i].version === lastVer) { foundLast = true; break; }
      newEntries.push(allEntries[i]);
    }
    // If lastVer not in changelog (new user, edited entries, skipped versions),
    // limit to most recent 3 entries to avoid showing entire history
    if (!foundLast && newEntries.length > 3) newEntries = newEntries.slice(0, 3);
    newEntries.reverse();

    // If no entries found in range, show missing notice
    if (!newEntries.length) {
      newEntries = [{ version: curVer, date: '', description: '版本日志缺失，请联系管理员检查版本日志' }];
    }

    var page = 0;
    var lastPage = newEntries.length - 1;
    function renderPage() {
      var e = newEntries[page];
      var descStyle = e.description.indexOf('版本日志缺失') >= 0 ? 'color:var(--warn);font-style:italic' : 'color:var(--fg)';
      var html = '<div style="font-size:13px;line-height:1.8">' +
        '<div style="font-weight:600;color:var(--accent);margin-bottom:8px">' +
          escHtml(e.version) + (e.date ? ' <span style="font-size:11px;color:var(--muted)">' + escHtml(e.date) + '</span>' : '') + '</div>' +
        '<div style="white-space:pre-wrap;' + descStyle + '">' + escHtml(e.description) + '</div>' +
      '</div>';
      var isLast = page >= lastPage;
      var prevBtn = page > 0
        ? '<button class="btn btn-xs" onclick="event.stopPropagation();_clPrevPage()">← 上一条</button>'
        : '<span style="display:inline-block;width:56px"></span>';
      var nextLabel = isLast ? '我知道了' : '下一条 →';
      var nextBtn = '<button class="btn btn-xs btn-primary" onclick="event.stopPropagation();' + (isLast ? '_clClose()' : '_clNextPage()') + '">' + nextLabel + '</button>';
      var nav = '<div style="display:flex;align-items:center;justify-content:center;gap:12px;margin-top:12px;font-size:11px;color:var(--muted)">' +
        prevBtn +
        '<span style="min-width:40px;text-align:center;' + (newEntries.length > 1 ? '' : 'visibility:hidden') + '">' + (page + 1) + ' / ' + newEntries.length + '</span>' +
        nextBtn +
      '</div>';
      var body = document.querySelector('#clog-body');
      if (body) body.innerHTML = html + nav;
    }
    window._clPrevPage = function() { if (page > 0) { page--; renderPage(); } };
    window._clNextPage = function() { if (page < lastPage) { page++; renderPage(); } };
    window._clClose = function() { var d=document.querySelector('.shared-dialog-overlay,.note-dialog-overlay'); if(d) d.remove(); };

    var bodyHtml = '<div id="clog-body"></div>';
    openDialog('系统更新日志', bodyHtml, null, { maxWidth: 520 });
    renderPage();
  } catch(e) { console.error('checkNewVersion error:', e); }
}

/* ── WeCom Checkin Calendar ── */
function _ucLoadWecomCalendar(user) {
  var cal = document.getElementById('uc-wecom-calendar');
  if (!cal) return;
  var now = new Date();
  var y = (typeof _calYear !== 'undefined') ? _calYear : now.getFullYear();
  var m = (typeof _calMonth !== 'undefined') ? _calMonth : (now.getMonth() + 1);
  var ms = new Date(y, m - 1, 1);
  var me = new Date(y, m, 0);
  var df = fmtLocalDate(ms), dt = fmtLocalDate(me);

  API.get('/wecom/calendar?date_from=' + df + '&date_to=' + dt).then(function(data) {
    if (!data) data = {};
    var dailyMap = {};
    if (data.daily) data.daily.forEach(function(d) { dailyMap[d.date] = d; });
    var total = data.total || 0;
    var status = data.status || 'ok';

    // Status-based rendering
    if (status === 'unlinked') {
      cal.innerHTML = '<div class="panel panel-pad" style="text-align:center;padding:20px">' +
        '<div style="font-size:13px;color:var(--muted);margin-bottom:8px">未关联企业微信账号</div>' +
        '<div style="font-size:11px;color:var(--muted)">请在用户管理中绑定企业微信账号</div></div>';
      return;
    }
    if (status === 'no_data') {
      cal.innerHTML = '<div class="panel panel-pad">' +
        '<div class="sec-hd"><h2>打卡工时</h2></div>' +
        '<div style="text-align:center;padding:12px;color:var(--muted);font-size:12px">暂无打卡数据</div>' +
        (data.last_sync_at ? '<div style="text-align:center;font-size:10px;color:var(--muted);padding-bottom:8px">上次同步: ' + data.last_sync_at.substring(11, 19) + '</div>' : '') +
        '</div>';
      return;
    }

    // Week total
    var weekTotal = 0;
    var today = new Date();
    var curDow = today.getDay();
    var monOff = curDow === 0 ? -6 : 1 - curDow;
    for (var wi = 0; wi < 7; wi++) {
      var wd = new Date(today);
      wd.setDate(today.getDate() + monOff + wi);
      var wds = fmtLocalDate(wd);
      if (dailyMap[wds]) weekTotal += dailyMap[wds].total_hours || 0;
    }
    var monthTotal = total;

    // Standard: use WeCom schedule if available, else legal 40h/week
    var weekStd = 40, monthStd = 0, scheduleSrc = '法定';
    if (data.schedule && data.schedule.work_hours > 0) {
      var daysInMonth = me.getDate();
      weekStd = Math.round(data.schedule.work_hours / data.schedule.work_days * 5) || 40;
      monthStd = data.schedule.work_hours;
      scheduleSrc = '企业微信';
    } else {
      var workDays = 0;
      for (var di = 1; di <= me.getDate(); di++) {
        var dw = new Date(y, m - 1, di).getDay();
        if (dw !== 0 && dw !== 6) workDays++;
      }
      monthStd = workDays * 8;
    }

    function _wcBarCls(hours, std) {
      if (std <= 0) return 'uc-hbar-empty';
      var r = hours / std;
      if (r >= 0.95 && r <= 1.05) return 'uc-hbar-ok';
      if (r < 0.95) return 'uc-hbar-under';
      if (r <= 1.25) return 'uc-hbar-low';
      if (r <= 1.50) return 'uc-hbar-mid';
      if (r <= 1.75) return 'uc-hbar-high';
      return 'uc-hbar-over';
    }
    var weekCls = _wcBarCls(weekTotal, weekStd);
    var monthCls = _wcBarCls(monthTotal, monthStd);

    var html = '<div class="panel panel-pad">' +
      '<div class="sec-hd" style="display:flex;justify-content:space-between;align-items:center">' +
        '<h2 style="margin:0">打卡工时</h2>' +
        '<div style="display:flex;align-items:center;gap:8px">' +
          '<span style="font-size:10px;color:var(--muted)">[' + scheduleSrc + ']</span>' +
          '<span style="font-size:11px;color:var(--muted)">周</span>' +
          '<span class="uc-week-bar ' + weekCls + '">' + (typeof fmtHours === 'function' ? fmtHours(weekTotal) : weekTotal.toFixed(1) + 'h') + '</span>' +
          '<span style="font-size:11px;color:var(--muted)">月</span>' +
          '<span class="uc-week-bar ' + monthCls + '">' + (typeof fmtHours === 'function' ? fmtHours(monthTotal) : monthTotal.toFixed(1) + 'h') + '</span>' +
        '</div>' +
      '</div>';
    if (typeof _renderMonthCalendar === 'function') {
      data._wecom = true;
      html += _renderMonthCalendar(now, dailyMap, data);
    }
    if (data.last_sync_at) {
      html += '<div style="text-align:right;font-size:10px;color:var(--muted);margin-top:4px">上次同步: ' + data.last_sync_at.substring(11, 19) + '</div>';
    }
    html += '</div>';
    cal.innerHTML = html;
  }).catch(function(e) {
    cal.innerHTML = '<div class="panel panel-pad" style="text-align:center;padding:20px">' +
      '<div style="font-size:13px;color:var(--muted);margin-bottom:4px">打卡工时</div>' +
      '<div style="font-size:11px;color:var(--danger)">加载失败</div></div>';
  });
}

document.addEventListener('DOMContentLoaded', function() {
  init();
  fetchBranch();
});
