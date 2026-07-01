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
  worklog_edit: '工时填报',
};

// ── View init wrappers (complex init logic extracted from gotoView) ──

function initDashboard() {
  var dashNewProjBtn = document.getElementById('dash-new-proj-btn');
  if (dashNewProjBtn) {
    var user = getCurrentUser();
    var perms = (user && user.permissions) ? user.permissions.split(',') : [];
    var isAdmin = user && (user.role === 'admin' || perms.indexOf('admin') >= 0);
    dashNewProjBtn.style.display = isAdmin ? '' : 'none';
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

function initDetailView() {
  loadAllProjects().then(function() {
    if (window._pendingProjectId) {
      document.getElementById('combo-input').value = '';
      projComboSelect(window._pendingProjectId);
      window._pendingProjectId = null;
    } else if (_comboCurId) {
      loadProjectDetail(_comboCurId);
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
  users:            { title: '用户管理',    label: '用户管理',    perm: 'admin',         initName: 'initUserManagement',   js: '/js/admin.js?v=' + APP_VERSION },
  permissions:      { title: '权限管理',    label: '权限管理',    perm: 'admin',         initName: 'initPermissions',      js: '/js/admin.js?v=' + APP_VERSION },
  config:           { title: '数据源配置',  label: '数据源配置',  perm: 'admin',         initName: 'initAdmin',            js: '/js/admin.js?v=' + APP_VERSION },
  'doc-templates':  { title: '项目&模板管理', label: '项目&模板管理', perm: 'doc_template', initName: 'initDocTemplates',  js: '/js/doc-templates.js?v=' + APP_VERSION },
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

function gotoView(view, pushState) {
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
  var doInit = function() {
    var initFn = entry.init;
    if (!initFn && entry.initName) initFn = window[entry.initName];
    if (initFn) initFn();
    localStorage.setItem('pm_view', view);
    if (pushState !== false && !_navigatingBack) {
      var url = '#/' + view;
      if (window.location.hash !== url) {
        history.pushState({ view: view }, '', url);
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
  localStorage.setItem('pm_theme_mode', next);
  _applyTheme(_getEffectiveTheme());
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

/* ── Alert Ticker (bottom scrolling bar) ── */

var _tickerEnabled = localStorage.getItem('pma_ticker_enabled') !== '0';  // default ON
var _tickerSpeed = localStorage.getItem('pma_ticker_speed') || 'normal';  // slow|normal|fast
var _tickerSpeeds = {slow: 150, normal: 100, fast: 60};
var _tickerTimer = null;

function initAlertTicker() {
  if (_tickerEnabled) {
    loadAlertTicker();
    if (_tickerTimer) clearInterval(_tickerTimer);
    _tickerTimer = setInterval(loadAlertTicker, 60000);
  }
}

function applyTickerSpeed() {
  var inner = document.getElementById('alert-ticker-inner');
  if (inner) inner.style.animationDuration = _tickerSpeeds[_tickerSpeed] + 's';
}

function toggleAlertTicker() {
  _tickerEnabled = !_tickerEnabled;
  localStorage.setItem('pma_ticker_enabled', _tickerEnabled ? '1' : '0');
  var ticker = document.getElementById('alert-ticker');
  if (_tickerEnabled) {
    if (ticker) ticker.style.display = '';
    initAlertTicker();
  } else {
    if (ticker) ticker.style.display = 'none';
    if (_tickerTimer) { clearInterval(_tickerTimer); _tickerTimer = null; }
  }
}

function setTickerSpeed(speed) {
  _tickerSpeed = speed;
  localStorage.setItem('pma_ticker_speed', speed);
  applyTickerSpeed();
}

async function loadAlertTicker() {
  var ticker = document.getElementById('alert-ticker');
  if (!ticker || !_tickerEnabled) return;
  try {
    var data = await API.get('/dashboard/alerts?limit=30');
    var alerts = data.items || [];
    if (!alerts.length) { ticker.style.display = 'none'; return; }
    ticker.style.display = '';
    applyTickerSpeed();
    // Duplicate items for seamless scrolling
    var items = alerts.concat(alerts);
    var html = '';
    items.forEach(function(a) {
      var dot = a.severity === 'red' ? '#f87171' : '#fbbf24';
      html += '<span style="display:inline-block;margin:0 12px;padding:2px 8px;border-radius:3px;background:var(--bg)">' +
        '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:' + dot + ';margin-right:4px;vertical-align:middle"></span>' +
        '<span style="color:var(--accent);cursor:pointer" onclick="openProject(\'' + a.project_id + '\')">' + escHtml(a.project_code || '') + '</span>' +
        (a.project_name ? ' <span style="color:var(--muted);font-size:11px">' + escHtml(a.project_name) + '</span>' : '') +
        ' <span style="color:var(--fg)">' + escHtml(a.message) + '</span>' +
      '</span>';
    });
    document.getElementById('alert-ticker-inner').innerHTML = html;
  } catch(e) { /* non-critical */ }
}

function setThemeMode(mode) {
  localStorage.setItem('pm_theme_mode', mode);
  _applyTheme(_getEffectiveTheme());
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
          iconEdit('editNotifDialog(' + n.id + ',\'' + escJs(n.content) + '\')') +
          iconDelete('deleteNotif(' + n.id + ')') +
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
  if (themeTgl) themeTgl.classList.toggle('on', document.documentElement.getAttribute('data-theme') === 'dark');

  // User display
  var user = getCurrentUser();
  if (user) {
    var initials = (user.username || '').substring(0, 2).toUpperCase();
    document.getElementById('user-avatar').textContent = initials;
    document.getElementById('user-name').textContent = user.display_name || user.username;
    // Show/hide nav items based on user permissions (driven by VIEW_REGISTRY)
    updateNavVisibility();

    // Show sync button only for users with sync permission
    var perms = (user && user.permissions) ? user.permissions.split(',') : [];
    var isAdmin = user && (user.role === 'admin' || perms.indexOf('admin') >= 0);
    var syncBtn = document.getElementById('src-sync-btn');
    if (syncBtn && (isAdmin || perms.indexOf('sync') >= 0)) {
      syncBtn.style.display = 'flex';
    }
  }

  // Show welcome dialog for first-time GitLab users
  if (localStorage.getItem('pma_new_user') === '1') {
    localStorage.removeItem('pma_new_user');
    showNewUserWelcomeDialog();
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
  var lastView = hashView || localStorage.getItem('pm_view') || 'user-center';
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
  var perms = (user.permissions || '').split(',').filter(Boolean);
  var permLabels = {'admin':'系统管理','sync':'数据同步','project_edit':'项目维护','product_link':'产品维护','customer_link':'客户维护','doc_template':'文档模板配置','stage_mapping':'阶段映射','task_edit':'任务管理','worklog_edit':'工时填报'};
  var permBadges = perms.map(function(p) { return '<span class="profile-role-tag">' + escHtml(permLabels[p]||p) + '</span>'; }).join('');

  container.innerHTML =
    // Profile bar
    '<div class="profile-bar">' +
      '<div class="profile-avatar">' + escHtml((user.display_name||user.username).charAt(0).toUpperCase()) + '</div>' +
      '<div class="profile-info">' +
        '<div class="profile-name">' + escHtml(user.display_name||user.username) + '</div>' +
        '<div class="profile-row"><div class="profile-user">@' + escHtml(user.username) + '</div>' +
          '<button class="profile-action-btn" id="btn-gitlab" onclick="_ucTogglePanel(\'gitlab\')"><svg width="16" height="16" viewBox="0 0 380 380" fill="currentColor"><path d="M282.83 170.73l-.27-.69-26.14-68.22a6.81 6.81 0 00-2.69-3.24 7 7 0 00-8 .43 7 7 0 00-2.32 3.52l-17.65 54H154.07l-17.65-54a6.86 6.86 0 00-2.32-3.53 7 7 0 00-8-.43 6.87 6.87 0 00-2.69 3.24L97.44 170l-.26.69a48.54 48.54 0 0016.1 56.1l.09.07.24.17 39.82 30.2 19.7 15.11 12 9.08a7.07 7.07 0 004.33 1.58 7.09 7.09 0 004.33-1.58l12-9.08 19.7-15.11 40.06-30.35.09-.07a48.63 48.63 0 0016.08-56.1z"/></svg> GitLab</button>' +
          '<button class="profile-action-btn" id="btn-security" onclick="_ucTogglePanel(\'security\')"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg> 安全</button>' +
          '<button class="profile-action-btn" id="btn-preferences" onclick="_ucTogglePanel(\'preferences\')"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg> 偏好</button>' +
          '<button class="profile-action-btn" id="btn-switch-account" onclick="switchAccount()" style="color:var(--warn)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M16 3h5v5M21 3l-7 7M8 21H3v-5M3 21l7-7"/></svg> 切换账号</button>' +
        '</div>' +
        '<div class="profile-roles">' + permBadges + '</div>' +
      '</div>' +
      '<div class="profile-stats" id="uc-stats">加载中...</div>' +
    '</div>' +
    // Expand panel
    '<div class="profile-expand" id="uc-expand"><div class="profile-expand-inner"><div id="uc-expand-content"></div></div></div>' +
    // Task list + Calendar
    '<div class="dash-grid-task">' +
      '<div>' +
        '<div class="sec-hd"><h2 id="uc-list-heading">我的任务</h2>' +
          '<div class="view-switch">' +
            '<button class="view-switch-btn active" onclick="_ucSwitchView(\'tasks\')">任务</button>' +
            '<button class="view-switch-btn" onclick="_ucSwitchView(\'bugs\')">Bug</button>' +
          '</div>' +
        '</div>' +
        '<div class="task-filter-bar" id="uc-filter-bar"></div>' +
        '<div class="panel"><div class="task-table-wrap"><table class="task-table"><thead id="uc-table-head"></thead><tbody id="uc-table-tbody"></tbody></table></div></div>' +
      '</div>' +
      '<div>' +
        '<div id="uc-calendar"></div>' +
      '</div>' +
    '</div>';

  // Calendar navigation callback
  _calChangeCallback = function() { _ucLoadCalendar(user); };
  // Load data (calendar loads inside _ucLoadTasks after task data is ready)
  _ucLoadTasks(user);
}

var _ucTasks = [];
var _ucFilterStatus = 'all';
var _ucFilterProj = '';
var _ucView = 'tasks';

function _ucSwitchView(v) {
  _ucView = v;
  document.getElementById('uc-list-heading').textContent = v === 'tasks' ? '我的任务' : '我的Bug';
  document.querySelectorAll('.view-switch-btn').forEach(function(b,i){ b.classList.toggle('active', (i===0&&v==='tasks')||(i===1&&v==='bugs')); });
  if (v === 'tasks') { _renderUcFilterBar(); _renderUcTableHead(); _renderUcTaskTable(); }
  else {
    document.getElementById('uc-filter-bar').innerHTML = '';
    document.getElementById('uc-table-head').innerHTML = '';
    document.getElementById('uc-table-tbody').innerHTML = '<tr><td colspan="1"><div class="empty-state" style="padding:40px">TODO：Bug 管理功能即将上线，敬请期待。</div></td></tr>';
  }
}

function _ucLoadTasks(user) {
  API.get('/tasks/my').then(function(tasks) {
    _ucTasks = tasks || [];
    _renderUcFilterBar();
    _renderUcTableHead();
    _renderUcTaskTable();
    _renderUcStats();
    // Re-render calendar with pie charts once task data is available
    _ucLoadCalendar(user);
  }).catch(function() {
    document.getElementById('uc-table-tbody').innerHTML = '<tr><td colspan="11"><div class="empty-state">加载失败</div></td></tr>';
  });
}

function _renderUcFilterBar() {
  var counts = {todo:0, in_progress:0, review:0, done:0};
  var projSet = {};
  _ucTasks.forEach(function(t) { counts[t.status||'todo'] = (counts[t.status]||0)+1; if(t.project_name) projSet[t.project_name]=1; });
  var projs = Object.keys(projSet).sort();
  var tabs = [{k:'all',l:'全部',c:_ucTasks.length},{k:'todo',l:'待办',c:counts.todo||0},{k:'in_progress',l:'进行中',c:counts.in_progress||0},{k:'review',l:'评审中',c:counts.review||0},{k:'done',l:'已完成',c:counts.done||0}];
  document.getElementById('uc-filter-bar').innerHTML =
    '<div class="task-tabs">' + tabs.map(function(t) { return '<button class="task-tab' + (_ucFilterStatus===t.k?' active':'') + '" onclick="_ucSetFilter(\''+t.k+'\')">'+t.l+'<span class="task-tab-count">'+t.c+'</span></button>'; }).join('') + '</div>' +
    '<select class="proj-select" onchange="_ucFilterProj=this.value;_renderUcTaskTable()"><option value="">全部项目</option>' + projs.map(function(p) { return '<option value="'+escHtml(p)+'"'+(_ucFilterProj===p?' selected':'')+'>'+escHtml(p)+'</option>'; }).join('') + '</select>';
}

function _ucSetFilter(s) { _ucFilterStatus = s; _renderUcFilterBar(); _renderUcTaskTable(); }

function _ucOpenTask(taskId) {
  if (typeof openTaskViewDialog === 'function') { openTaskViewDialog(taskId); }
  else if (typeof loadViewScript === 'function') { loadViewScript('/js/tasks.js?v=' + APP_VERSION, function() { openTaskViewDialog(taskId); }); }
}

function _renderUcTableHead() {
  document.getElementById('uc-table-head').innerHTML = '<tr><th>编号</th><th>项目名称</th><th>任务</th><th>阶段</th><th>状态</th><th>优先级</th><th>负责人</th><th>预估</th><th>实际</th><th>进度</th><th>截止</th></tr>';
}

function _renderUcTaskTable() {
  var filtered = _ucTasks.filter(function(t) {
    if (_ucFilterStatus !== 'all' && t.status !== _ucFilterStatus) return false;
    if (_ucFilterProj && t.project_name !== _ucFilterProj) return false;
    return true;
  });
  var tbody = document.getElementById('uc-table-tbody');
  if (!filtered.length) { tbody.innerHTML = '<tr><td colspan="11"><div class="empty-state">暂无匹配任务</div></td></tr>'; return; }
  tbody.innerHTML = filtered.map(function(t) {
    var stageName = t.stage_name || t.execution_name || '-';
    var pct = t.progress || 0;
    var overdue = t.due_date && t.status !== 'done' && t.status !== 'closed' && t.due_date < fmtLocalDate();
    var assignee = t.assignee_name || t.assignee_username || (t.assignee_id||'-');
    return '<tr style="cursor:pointer" onclick="_ucOpenTask('+t.id+')">' +
      '<td>' + (t.project_code ? projCodeTag(t.project_code, t.project_id) : '-') + '</td>' +
      '<td style="text-align:left;font-size:12px">' + escHtml(t.project_name || '-') + '</td>' +
      '<td style="text-align:left;font-weight:530">' + escHtml(t.title) + '</td>' +
      '<td style="font-size:11px;color:var(--muted)">' + escHtml(stageName) + '</td>' +
      '<td>' + renderPill(t.status||'todo') + '</td>' +
      '<td><span class="prio-tag '+(t.priority||'medium')+'">'+({low:'低',medium:'中',high:'高',critical:'紧急'}[t.priority]||t.priority)+'</span></td>' +
      '<td style="font-size:12px">'+escHtml(assignee)+'</td>' +
      '<td style="font-size:12px">'+(t.estimate_hours||0).toFixed(1)+'h</td>' +
      '<td style="font-size:12px">'+(t.consumed_hours||0).toFixed(1)+'h</td>' +
      '<td>'+renderProgressCircle(pct,22,{label:''})+'</td>' +
      '<td style="font-size:12px;color:'+(overdue?'var(--danger)':'')+'">'+(t.due_date||'-')+'</td>' +
    '</tr>';
  }).join('');
}

function _renderUcStats() {
  var counts = {todo:0, in_progress:0, done:0};
  _ucTasks.forEach(function(t) { if(t.status==='todo')counts.todo++; else if(t.status==='in_progress'||t.status==='review')counts.in_progress++; else if(t.status==='done'||t.status==='closed')counts.done++; });
  document.getElementById('uc-stats').innerHTML =
    '<div class="profile-stat todo"><div class="profile-stat-val">'+counts.todo+'</div><div class="profile-stat-lbl">待办</div></div>' +
    '<div class="profile-stat doing"><div class="profile-stat-val">'+counts.in_progress+'</div><div class="profile-stat-lbl">进行中</div></div>' +
    '<div class="profile-stat hours"><div class="profile-stat-val" id="uc-week-total">...</div><div class="profile-stat-lbl">本周工时</div></div>';
}

function _fmtLocalDate(d) { return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }

function _ucLoadCalendar(user) {
  var now = new Date();
  var ws = new Date(now); ws.setDate(now.getDate()-now.getDay()+1);
  var df = _fmtLocalDate(ws), dt = _fmtLocalDate(now);
  var cal = document.getElementById('uc-calendar');
  if(!cal) return;

  // Load calendar data + render pie charts + intensity calendar
  API.get('/worklogs/calendar?user_id='+user.id+'&date_from='+df+'&date_to='+dt).then(function(data) {
    var dailyMap = {};
    if(data&&data.daily) data.daily.forEach(function(d){dailyMap[d.date]=d;});
    var total = data?(data.total||0):0;
    document.getElementById('uc-week-total').textContent = total.toFixed(1)+'h';

    var tasks = _ucTasks || [];
    var totalTasks = tasks.length;
    var html = '';

    // Pie charts card
    if (totalTasks > 0 && typeof _buildPieChart === 'function') {
      var cols = [
        {key:'todo',label:'待办',color:'var(--muted)'},
        {key:'in_progress',label:'进行中',color:'var(--accent)'},
        {key:'review',label:'评审中',color:'var(--warn)'},
        {key:'done',label:'已完成',color:'var(--success)'},
      ];
      var byStatus = {}; cols.forEach(function(c){byStatus[c.key]=0;});
      tasks.forEach(function(t){var s=t.status||'todo';byStatus[s]=(byStatus[s]||0)+1;});
      var statusCounts = {}; cols.forEach(function(c){statusCounts[c.key]=byStatus[c.key]||0;});

      // Project distribution: top 3 by count, show project code only, fill missing with —
      var byProj = {}, projColors = ['var(--accent)','var(--success)','var(--warn)'];
      var projList = [];
      tasks.forEach(function(t){var pn=t.project_code||t.project_name||'未知';if(!byProj[pn]){byProj[pn]=0;projList.push({key:pn,label:pn});}byProj[pn]++;});
      projList.sort(function(a,b){return byProj[b.key]-byProj[a.key];});
      projList = projList.slice(0,3);
      while (projList.length < 3) { var dummy = '—'; projList.push({key:dummy+projList.length,label:dummy}); byProj[dummy+projList.length]=0; }
      projList.forEach(function(s,i){s.color=projColors[i];s.label=s.label;}); // project_code already in API

      // Filter to only active groups for status pie
      var activeCols = cols.filter(function(c){return (statusCounts[c.key]||0)>0;});
      html += '<div class="panel panel-pad" style="margin-bottom:18px">' +
        '<div class="sec-hd"><h2>任务统计</h2></div>' +
        '<div style="display:flex;gap:8px">' +
          _buildPieChart(activeCols,statusCounts,totalTasks,'状态分布') +
          _buildPieChart(projList,byProj,totalTasks,'项目分布') +
        '</div></div>';
    }

    // Calendar card
    html += '<div class="panel panel-pad">' +
      '<div class="sec-hd"><h2>工时</h2></div>';
    if (typeof _renderMonthCalendar === 'function') {
      html += _renderMonthCalendar(now, dailyMap, data);
    }
    html += '</div>';
    cal.innerHTML = html;
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
      '<div class="expand-card">' +
        '<h3><svg width="16" height="16" viewBox="0 0 380 380" fill="#e24329"><path d="M282.83 170.73l-.27-.69-26.14-68.22a6.81 6.81 0 00-2.69-3.24 7 7 0 00-8 .43 7 7 0 00-2.32 3.52l-17.65 54H154.07l-17.65-54a6.86 6.86 0 00-2.32-3.53 7 7 0 00-8-.43 6.87 6.87 0 00-2.69 3.24L97.44 170l-.26.69a48.54 48.54 0 0016.1 56.1l.09.07.24.17 39.82 30.2 19.7 15.11 12 9.08a7.07 7.07 0 004.33 1.58 7.09 7.09 0 004.33-1.58l12-9.08 19.7-15.11 40.06-30.35.09-.07a48.63 48.63 0 0016.08-56.1z"/></svg> GitLab 账户</h3>' +
        (isGitlab ? '' +
          '<div class="integration-row"><span class="integration-row-lbl">用户名</span><span class="integration-row-val">@'+escHtml(user.username)+'</span></div>' +
          '<div class="integration-row"><span class="integration-row-lbl">Token 状态</span><span class="integration-row-val ok">'+(user.gitlab_token_valid?'有效':'无效')+'</span></div>' +
          '<a class="integration-link" href="http://192.168.0.128/'+escHtml(user.username)+'" target="_blank">GitLab 个人主页 ↗</a>'
        : '<div class="integration-row"><span class="integration-row-lbl">状态</span><span class="integration-row-val">未启用，请使用本地密码登录</span></div>') +
      '</div>' +
      '<div class="expand-card" style="visibility:hidden"></div>';
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
  if (!content) content = document.getElementById('uc-expand-content');
  if (!content) return;
  var tickerOn = localStorage.getItem('pma_ticker_enabled') !== '0';
  var tickerSpeed = localStorage.getItem('pma_ticker_speed') || 'normal';
  var themeMode = localStorage.getItem('pm_theme_mode') || 'auto';
  var themeLabels = {auto: '自动', light: '浅色', dark: '深色'};
  var speedLabels = {slow: '慢速', normal: '正常', fast: '快速'};
  var speedBtns = '';
  ['slow', 'normal', 'fast'].forEach(function(s) {
    speedBtns += '<button class="btn btn-xs" style="margin-right:4px;' +
      (tickerSpeed === s ? 'background:var(--accent);color:#fff;border-color:var(--accent)' : '') +
      '" onclick="setTickerSpeed(\'' + s + '\');_renderPreferencesPanel()">' + speedLabels[s] + '</button>';
  });
  var themeBtns = '';
  ['auto', 'light', 'dark'].forEach(function(m) {
    themeBtns += '<button class="btn btn-xs" style="margin-right:4px;' +
      (themeMode === m ? 'background:var(--accent);color:#fff;border-color:var(--accent)' : '') +
      '" onclick="setThemeMode(\'' + m + '\');_renderPreferencesPanel()">' + themeLabels[m] + '</button>';
  });

  content.innerHTML =
    '<div class="expand-card" style="visibility:hidden"></div>' +
    '<div class="expand-card">' +
      '<h3 style="margin-bottom:12px"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg> 偏好设置</h3>' +

      // Responsive card grid
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px">' +

        // Card 1: 通知
        '<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px">' +
          '<div style="font-size:12px;font-weight:600;color:var(--fg);margin-bottom:10px">通知</div>' +
          '<div class="integration-row" style="margin-bottom:8px">' +
            '<span class="integration-row-lbl">底部滚动告警条</span>' +
            toggleSwitch(tickerOn, 'toggleAlertTicker();_renderPreferencesPanel()') +
          '</div>' +
          (tickerOn ? '<div><span style="font-size:11px;color:var(--muted)">滚动速率</span><div style="margin-top:3px">' + speedBtns + '</div></div>' : '') +
        '</div>' +

        // Card 2: 外观
        '<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px">' +
          '<div style="font-size:12px;font-weight:600;color:var(--fg);margin-bottom:10px">外观</div>' +
          '<span style="font-size:11px;color:var(--muted)">主题模式</span><div style="margin-top:3px">' + themeBtns + '</div>' +
        '</div>' +

      '</div>' +

      '<div style="font-size:10px;color:var(--muted);margin-top:10px;padding-top:8px;border-top:1px solid var(--border)">更多偏好设置即将上线</div>' +
    '</div>';
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
  var mode = localStorage.getItem('pm_theme_mode') || 'auto';
  if (mode === 'auto') {
    var h = new Date().getHours();
    return (h >= 6 && h < 19) ? 'light' : 'dark';
  }
  return mode;
}

function _applyTheme(theme) {
  localStorage.setItem('pm_theme', theme);
  document.documentElement.setAttribute('data-theme', theme);

  var mode = localStorage.getItem('pm_theme_mode') || 'auto';
  var themeBtn = document.getElementById('theme-toggle-btn');
  if (themeBtn) {
    if (mode === 'auto') {
      // Moon + "A" — auto mode
      themeBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="#f5c542" stroke-width="1.2"><path d="M6 .278a.768.768 0 0 1 .08.858 7.208 7.208 0 0 0-.878 3.46c0 4.021 3.278 7.277 7.318 7.277.527 0 1.04-.055 1.533-.16a.787.787 0 0 1 .81.316.733.733 0 0 1-.031.893A8.349 8.349 0 0 1 8.344 16C3.734 16 0 12.286 0 7.71 0 4.266 2.114 1.312 5.124.06A.752.752 0 0 1 6 .278z"/><text x="6.5" y="10" font-size="12" font-weight="700" fill="#f5c542" stroke="none" font-family="sans-serif">A</text></svg>';
      themeBtn.title = '自动（跟随系统）';
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

document.addEventListener('DOMContentLoaded', function() {
  init();
  fetchBranch();
});
