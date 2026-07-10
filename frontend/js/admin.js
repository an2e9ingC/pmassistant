/* ═══════════════════════════════════════════════════
   ADMIN — Data Source Configuration
═══════════════════════════════════════════════════ */

var _adminFormData = null;

async function initAdmin() {
  var container = document.getElementById('admin-config-form');
  container.innerHTML = '<div class="loading-spinner" style="padding:40px">加载配置...</div>';
  try {
    var data = await API.get('/admin/config');
    _adminFormData = data;
    renderConfigForm(_adminFormData);
    loadPmaSettingsUI();
  } catch(e) {
    container.innerHTML = '<div class="error-state">加载失败: ' + escHtml(e.message) + '<br><button onclick="initAdmin()">重试</button></div>';
  }
}

// ── Config section definitions (module scope, shared by card + dialog) ──

var _configSections = [
  { key: 'zentao', title: '禅道 (Zentao)', summaryKey: 'base_url', summaryPrefix: 'API: ', fields: [
    { key: 'base_url', label: 'API 地址', type: 'url', ph: 'http://192.168.3.22/zentao/api.php/v1' },
    { key: 'account', label: '账号', type: 'text', ph: 'PM_Assistant' },
    { key: 'password', label: '密码', type: 'password', ph: '' },
    { key: 'project_filter', label: '项目筛选', type: 'text', ph: '如 PE04,PE05（逗号分隔前缀，留空=全部）' },
    { key: 'sync_interval', label: '自动同步(分)', type: 'number', ph: '30（0=关闭）' },
    { key: 'sync_releases', label: '同步禅道发布版本（GitLab URL 校验数据源）', type: 'toggle', ph: '' },
  ]},
  { key: 'gitlab', title: 'GitLab', summaryKey: 'base_url', summaryPrefix: 'API: ', fields: [
    { key: 'base_url', label: 'API 地址', type: 'url', ph: 'http://192.168.0.128/api/v4' },
    { key: 'token', label: 'Access Token (数据同步)', type: 'password', ph: '' },
    { key: 'app_id', label: 'OAuth Application ID', type: 'text', ph: '' },
    { key: 'app_secret', label: 'OAuth Application Secret', type: 'password', ph: '' },
    { key: 'oauth_enabled', label: '启用 GitLab OAuth 登录', type: 'toggle', ph: '' },
    { key: 'oauth_redirect_uri', label: 'OAuth 回调地址', type: 'url', ph: 'http://192.168.1.x:8000/api/auth/gitlab/callback' },
    { key: 'project_path', label: 'PMA 项目路径 (Issue/成员)', type: 'text', ph: 'group/subgroup/pma' },
  ]},
  { key: 'nas', title: 'NAS 存储', summaryKey: 'host', summaryPrefix: '主机: ', fields: [
    { key: 'host', label: '主机地址', type: 'text', ph: '192.168.x.x' },
    { key: 'username', label: '用户名', type: 'text', ph: '' },
    { key: 'password', label: '密码', type: 'password', ph: '' },
  ]},
  { key: 'svn', title: 'SVN 版本管理', summaryKey: 'base_url', summaryPrefix: '地址: ', fields: [
    { key: 'base_url', label: 'SVN 地址', type: 'url', ph: 'http://192.168.0.124:8443/svn' },
    { key: 'username', label: '用户名', type: 'text', ph: '' },
    { key: 'password', label: '密码', type: 'password', ph: '' },
  ]},
];

function _renderFieldHtml(f, sectionKey, cfgData) {
  var rawVal = cfgData && cfgData[f.key];
  var val = (f.type === 'checkbox' || f.type === 'toggle') ? '' : (rawVal || '');
  var isPw = f.type === 'password';
  var isCb = f.type === 'checkbox';
  var isTg = f.type === 'toggle';
  var uid = 'cfg-' + sectionKey + '-' + f.key;
  var html = '';

  if (isCb) {
    var checked = (rawVal === true || rawVal === 'true' || rawVal === '1' || rawVal === 1);
    html += '<label class="config-field config-field-checkbox">' +
      '<span class="config-input-wrap">' +
        '<input id="' + uid + '" class="config-input config-checkbox" type="checkbox"' +
          ' data-section="' + sectionKey + '" data-field="' + f.key + '"' +
          (checked ? ' checked' : '') + ' value="1">' +
      '</span>' +
      '<span class="config-field-label config-checkbox-label">' + f.label + '</span>' +
    '</label>';
  } else if (isTg) {
    var tgOn = (rawVal === true || rawVal === 'true' || rawVal === '1' || rawVal === 1);
    html += '<label class="config-field config-field-checkbox">' +
      '<input id="' + uid + '" class="config-input" type="checkbox"' +
        ' data-section="' + sectionKey + '" data-field="' + f.key + '"' +
        (tgOn ? ' checked' : '') + ' value="1" style="position:absolute;opacity:0;pointer-events:none">' +
      toggleSwitch(tgOn, "toggleConfigSwitch('" + uid + "')", {id: uid + '-toggle'}) +
      '<span class="config-field-label" style="width:auto;margin-left:10px">' + f.label + '</span>' +
    '</label>';
  } else {
    html += '<label class="config-field">' +
      '<span class="config-field-label">' + f.label + '</span>' +
      '<span class="config-input-wrap">' +
        '<input id="' + uid + '" class="config-input" type="' + (isPw ? 'password' : f.type) +
          '" data-section="' + sectionKey + '" data-field="' + f.key + '"' +
          ' value="' + escHtml(val) + '" placeholder="' + escHtml(f.ph) + '"' +
          (isPw ? ' autocomplete="new-password" onkeyup="checkCapsLock(event,\'' + uid + '-caps\')"' : '') + '>' +
        (isPw ? '<button type="button" class="config-pw-toggle" onclick="togglePwVis(\'' + uid + '\',this)" title="显示密码">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>' +
            '<circle cx="12" cy="12" r="3"/>' +
          '</svg></button>' : '') +
        (isPw ? '<span id="' + uid + '-caps" class="config-caps-warn" style="display:none">&#x21E7; 大写锁定已开</span>' : '') +
      '</span>' +
    '</label>';
  }
  return html;
}

function renderConfigForm(cfg) {
  var html = '<div class="config-grid">';
  _configSections.forEach(function(sec) {
    var data = cfg[sec.key] || {};
    var enabledOn = !(data.enabled === false);
    var euid = 'cfg-' + sec.key + '-enabled';
    var summaryVal = data[sec.summaryKey] || '';
    var summaryText = summaryVal ? sec.summaryPrefix + summaryVal : '未配置';

    html += '<div class="config-section ' + sec.key + '">' +
      '<div class="config-section-title" style="display:flex;align-items:center;gap:10px">' +
        '<span>' + sec.title + '</span>' +
        '<span style="margin-left:auto;display:flex;align-items:center;gap:8px">' +
          '<span style="font-size:10px;color:var(--muted);white-space:nowrap">启用</span>' +
          '<input id="' + euid + '" class="config-input" type="checkbox"' +
            ' data-section="' + sec.key + '" data-field="enabled"' +
            (enabledOn ? ' checked' : '') + ' value="1" style="position:absolute;opacity:0;pointer-events:none">' +
          toggleSwitch(enabledOn, "toggleSourceEnabled('" + sec.key + "')", {id: euid + '-toggle'}) +
          '<button class="btn btn-xs" onclick="testSourceConnection(\'' + sec.key + '\')" style="font-size:10px;padding:2px 8px;white-space:nowrap;flex-shrink:0">测试连接</button>' +
          '<button class="btn btn-xs" onclick="openSourceConfigDialog(\'' + sec.key + '\')" title="编辑配置" style="font-size:10px;padding:2px 6px;white-space:nowrap;flex-shrink:0">' +
            '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
              '<path d="M11 2l3 3-9 9H2v-3l9-9z"/></svg>' +
          '</button>' +
        '</span>' +
      '</div>' +
      '<div style="padding:8px 20px;font-size:11.5px;color:' + (summaryVal ? 'var(--fg)' : 'var(--muted)') + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
        escHtml(summaryText) +
      '</div>' +
    '</div>';
  });

  html += '</div>'; // .config-grid
  html += '<div class="config-actions" style="margin-top:12px">' +
    '<span id="config-save-msg" style="font-size:12px"></span>' +
    '<button class="btn" onclick="clearDatabase()" style="margin-left:auto;font-size:12px;color:var(--danger);padding:5px 16px">清除数据库缓存</button>' +
  '</div>';

  document.getElementById('admin-config-form').innerHTML = html;
  // Highlight target card if navigated from source tag
  if (typeof _getSrcConfigHighlight === 'function') {
    var hlKey = _getSrcConfigHighlight();
    if (hlKey) {
      setTimeout(function() {
        var card = document.querySelector('.config-section.' + hlKey);
        if (card) {
          card.style.transition = 'box-shadow 0.3s, border-color 0.3s';
          card.style.boxShadow = '0 0 0 3px var(--accent)';
          card.style.borderColor = 'var(--accent)';
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          var count = 0;
          var flash = setInterval(function() {
            card.style.boxShadow = (count % 2 === 0) ? '0 0 0 3px var(--accent)' : '0 0 0 3px transparent';
            count++;
            if (count >= 6) { clearInterval(flash); card.style.boxShadow = ''; card.style.borderColor = ''; }
          }, 500);
        }
      }, 200);
    }
  }
}

// ── Dialog-based config editing ──

function openSourceConfigDialog(secKey) {
  var sec = _configSections.find(function(s) { return s.key === secKey; });
  if (!sec) return;
  var data = (_adminFormData && _adminFormData[secKey]) ? _adminFormData[secKey] : {};

  var fieldsHtml = '';
  sec.fields.forEach(function(f) {
    fieldsHtml += _renderFieldHtml(f, secKey, data);
  });

  var bodyHtml = '<div style="display:flex;flex-direction:column;max-height:55vh;overflow-y:auto;padding:4px 0">' +
    fieldsHtml +
  '</div>';

  openDialog(sec.title + ' 配置', bodyHtml, [
    { text: '取消', cls: '', onclick: "this.closest('.note-dialog-overlay').remove()" },
    { text: '保存', cls: 'btn-primary', onclick: "saveSourceConfig('" + secKey + "');this.closest('.note-dialog-overlay').remove()" },
  ], { maxWidth: 560 });
}

async function saveSourceConfig(secKey) {
  var msg = document.getElementById('config-save-msg');
  if (msg) { msg.textContent = ''; }

  // Collect field values from dialog
  var sectionData = {};
  document.querySelectorAll('.config-input[data-section="' + secKey + '"]').forEach(function(inp) {
    var field = inp.dataset.field;
    if (inp.type === 'checkbox') {
      sectionData[field] = inp.checked;
    } else {
      // Skip masked passwords
      if ((field === 'password' || field === 'token') && inp.value && inp.value.indexOf('•') >= 0) {
        return;
      }
      sectionData[field] = inp.value;
    }
  });

  // Build full payload from _adminFormData, replacing the edited section
  var payload = JSON.parse(JSON.stringify(_adminFormData));
  payload[secKey] = sectionData;

  // Preserve enabled state from the card
  var ecb = document.getElementById('cfg-' + secKey + '-enabled');
  if (ecb) { payload[secKey].enabled = ecb.checked; }

  try {
    var result = await API.put('/admin/config', payload);
    _adminFormData = result;
    // Re-render cards with updated data
    renderConfigForm(_adminFormData);
    if (msg) msg.innerHTML = '<span style="color:var(--success)">&#10003; ' +
      (secKey === 'zentao' ? '禅道' : secKey === 'gitlab' ? 'GitLab' : secKey === 'nas' ? 'NAS' : 'SVN') +
      ' 配置已保存</span>';
    setTimeout(function() { if (msg) msg.textContent = ''; }, 3000);
  } catch(e) {
    if (msg) msg.innerHTML = '<span style="color:var(--danger)">保存失败: ' + escHtml(e.message) + '</span>';
  }
}

async function toggleSourceEnabled(secKey) {
  var cb = document.getElementById('cfg-' + secKey + '-enabled');
  var toggle = document.getElementById('cfg-' + secKey + '-enabled-toggle');
  if (!cb || !toggle) return;
  cb.checked = !cb.checked;
  toggle.style.background = cb.checked ? 'var(--success)' : 'var(--border)';
  var dot = toggle.querySelector('span');
  if (dot) dot.style.transform = 'translateX(' + (cb.checked ? '22px' : '2px') + ')';

  // Auto-save
  if (!_adminFormData || !_adminFormData[secKey]) return;
  _adminFormData[secKey].enabled = cb.checked;
  try {
    await API.put('/admin/config', _adminFormData);
  } catch(e) {
    // revert
    cb.checked = !cb.checked;
    _adminFormData[secKey].enabled = cb.checked;
    toggle.style.background = cb.checked ? 'var(--success)' : 'var(--border)';
    if (dot) dot.style.transform = 'translateX(' + (cb.checked ? '22px' : '2px') + ')';
    showToast('保存失败: ' + e.message, 'error');
  }
}

function togglePwVis(id, btn) {
  var inp = document.getElementById(id);
  if (!inp) return;
  var show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  if (show) {
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
    btn.title = '隐藏密码';
  } else {
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    btn.title = '显示密码';
  }
}

function checkCapsLock(e, warnId) {
  var el = document.getElementById(warnId);
  if (!el) return;
  var caps = e.getModifierState && e.getModifierState('CapsLock');
  el.style.display = caps ? '' : 'none';
}

function toggleConfigSwitch(checkboxId) {
  var cb = document.getElementById(checkboxId);
  var toggle = document.getElementById(checkboxId + '-toggle');
  if (!cb || !toggle) return;
  cb.checked = !cb.checked;
  toggle.style.background = cb.checked ? 'var(--success)' : 'var(--border)';
  var dot = toggle.querySelector('span');
  if (dot) dot.style.transform = 'translateX(' + (cb.checked ? '22px' : '2px') + ')';
}

var _testResults = {};

async function testSourceConnection(source) {
  var btn = event && event.target;
  if (btn) { btn.disabled = true; btn.textContent = '测试中...'; }
  try {
    var result = await API.post('/admin/test-connection/' + source);
    _testResults[source] = result;
    var ok = result && result.ok;
    showToast(
      (ok ? '✓ ' : '✗ ') + (source === 'zentao' ? '禅道' : source === 'gitlab' ? 'GitLab' : source === 'nas' ? 'NAS' : 'SVN') +
      ': ' + (result ? result.detail : '未知'),
      ok ? 'success' : 'error'
    );
  } catch(e) {
    showToast('测试失败: ' + escHtml(e.message || '未知错误'), 'error');
  }
  if (btn) { btn.disabled = false; btn.textContent = '测试连接'; }
}

async function clearDatabase() {
  if (!confirm('确定清除所有缓存数据？（项目/产品/执行/任务/Bug等）\n注意：此操作不可撤销，清除后需重新同步。')) return;
  if (!confirm('再次确认：清除后需从禅道重新同步全部数据，可能耗时较长。确定继续？')) return;
  var ok = await verifyPassword('清除数据库', 'pw_verify_clear_db');
  if (!ok) return;
  try {
    var result = await API.post('/admin/clear-db');
    showToast(result.message || '已清除', 'success');
  } catch(e) {
    showToast('清除失败: ' + e.message, 'error');
  }
}

var _roleLabels = {public:'普通用户',admin:'管理员',ceo:'CEO',cto:'CTO',pm:'项目经理',sales:'销售及售前',hw_dev:'硬件开发',structure:'结构设计及装配',hw_test:'硬件测试',bsp_dev:'BSP开发',sw_dev:'业务软件开发',test_delivery:'测试交付',procurement:'采购',quality:'质检',warehouse:'库房管理',viewer:'只读用户'};

function _roleOptions(selected) {
  return Object.keys(_roleLabels).map(function(k) {
    return '<option value="' + k + '"' + (k === selected ? ' selected' : '') + '>' + _roleLabels[k] + '</option>';
  }).join('');
}

function _roleCheckboxes(roleIds) {
  // Load all roles from _permRoles (populated by initUserManagement or initPermissions)
  var roles = _permRoles.length ? _permRoles : [];
  if (!roles.length) return '<span style="font-size:11px;color:var(--muted)">加载角色失败</span>';
  return '<div style="max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:8px 12px">' +
    roles.map(function(r) {
      return '<label style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:12px;cursor:pointer">' +
        '<input type="checkbox" value="' + r.id + '" class="ue-role-cb" ' + (roleIds.indexOf(r.id) >= 0 ? 'checked' : '') + '>' +
        escHtml(r.label) + ' <span style="font-size:10px;color:var(--muted)">(' + escHtml(r.key) + ')</span>' +
      '</label>';
    }).join('') + '</div>';
}

/* ── User Management ── */

var _userList = [];

var _userTab = 'users';

function switchUserTab(tab) {
  _userTab = tab;
  document.getElementById('utab-users').classList.toggle('active', tab === 'users');
  document.getElementById('utab-roles').classList.toggle('active', tab === 'roles');
  document.getElementById('usec-users').style.display = tab === 'users' ? '' : 'none';
  document.getElementById('usec-roles').style.display = tab === 'roles' ? '' : 'none';
}

async function initUserManagement() {
  _userList = [];
  document.getElementById('users-tbody').innerHTML = '<tr><td colspan="8"><div class="loading-spinner">加载中...</div></td></tr>';
  document.getElementById('roles-tbody').innerHTML = '<tr><td colspan="7"><div class="loading-spinner">加载中...</div></td></tr>';
  try {
    var rolesPromise = API.get('/admin/users/roles');
    var usersPromise = API.get('/admin/users');
    _permRoles = await rolesPromise || [];
    _userList = await usersPromise || [];
    switchUserTab(_userTab);
    renderUserTable();
    renderRoleTable();
    renderUserKPIs();
    renderRoleKPIs();
  } catch(e) {
    document.getElementById('users-tbody').innerHTML = '<tr><td colspan="8"><div class="error-state">加载失败: ' + escHtml(e.message) + '</div></td></tr>';
  }
}

var _userFilter = 'all';
var _roleFilter = 'all';

function userFilterKPI(filter) {
  _userFilter = filter;
  renderUserKPIs();
  renderUserTable();
}

function roleFilterKPI(filter) {
  _roleFilter = filter;
  renderRoleKPIs();
  renderRoleTable();
}

function renderUserKPIs() {
  var total = _userList.length;
  var active = _userList.filter(function(u) { return u.is_active; }).length;
  var disabled = total - active;
  var html =
    '<div class="kpi-card' + (_userFilter === 'all' ? ' active' : '') + '" onclick="userFilterKPI(\'all\')"><div class="kpi-label">总用户</div><div class="kpi-value">' + total + '</div></div>' +
    '<div class="kpi-card' + (_userFilter === 'active' ? ' active' : '') + '" onclick="userFilterKPI(\'active\')"><div class="kpi-label">活跃用户</div><div class="kpi-value" style="color:var(--success)">' + active + '</div></div>' +
    '<div class="kpi-card' + (_userFilter === 'disabled' ? ' active' : '') + '" onclick="userFilterKPI(\'disabled\')"><div class="kpi-label">已禁用</div><div class="kpi-value" style="color:var(--muted)">' + disabled + '</div></div>';
  var grid = document.getElementById('user-kpi-grid');
  if (grid) grid.innerHTML = html;
}

function renderRoleKPIs() {
  var total = _permRoles.length;
  var withPerms = _permRoles.filter(function(r) { return (r.permissions || []).length > 0; }).length;
  var html =
    '<div class="kpi-card' + (_roleFilter === 'all' ? ' active' : '') + '" onclick="roleFilterKPI(\'all\')"><div class="kpi-label">角色组总数</div><div class="kpi-value">' + total + '</div></div>' +
    '<div class="kpi-card' + (_roleFilter === 'withPerms' ? ' active' : '') + '" onclick="roleFilterKPI(\'withPerms\')"><div class="kpi-label">有特殊权限角色</div><div class="kpi-value" style="color:var(--accent)">' + withPerms + '</div></div>' +
    '<div class="kpi-card' + (_roleFilter === 'public' ? ' active' : '') + '" onclick="roleFilterKPI(\'public\')"><div class="kpi-label">基础角色(public)</div><div class="kpi-value" style="color:var(--muted)">' + (total - withPerms) + '</div></div>';
  var grid = document.getElementById('role-kpi-grid');
  if (grid) grid.innerHTML = html;
}

function renderRoleTable() {
  var tbody = document.getElementById('roles-tbody');
  // Apply filter
  var roles = _permRoles.slice();
  if (_roleFilter === 'withPerms') roles = roles.filter(function(r) { return (r.permissions || []).length > 0; });
  else if (_roleFilter === 'public') roles = roles.filter(function(r) { return (r.permissions || []).length === 0; });
  if (!roles.length) {
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state" style="padding:16px">暂无匹配角色</div></td></tr>';
    return;
  }
  // Sort: public first, then alphabetically by key
  var sorted = roles.slice().sort(function(a, b) {
    if (a.key === 'public') return -1;
    if (b.key === 'public') return 1;
    return (a.key < b.key) ? -1 : 1;
  });
  tbody.innerHTML = sorted.map(function(r, idx) {
    var perms = r.permissions || [];
    var permBadges = perms.map(function(p) {
      return '<span style="display:inline-block;margin:1px 2px;padding:1px 6px;border-radius:3px;font-size:10px;background:var(--accent-lt);color:var(--accent)">' + escHtml(p) + '</span>';
    }).join('') || '<span style="font-size:11px;color:var(--muted)">无</span>';
    var userCount = _userList.filter(function(u) { return (u.role_ids || []).indexOf(r.id) >= 0; }).length;
    return '<tr>' +
      '<td style="font-family:var(--mono);color:var(--muted);text-align:center">' + (idx + 1) + '</td>' +
      '<td style="font-family:var(--mono);font-size:12px;font-weight:500">' + escHtml(r.key) + '</td>' +
      '<td style="font-size:13px">' + escHtml(r.label) + '</td>' +
      '<td>' + permBadges + '</td>' +
      '<td><button class="btn btn-sm"' +
        ' onclick="showRoleUsers(' + r.id + ',\'' + escHtml(r.label) + '\')">' + userCount + ' 人</button></td>' +
      '<td style="white-space:nowrap">' +
        (r.key === 'admin' ? '<span style="font-size:11px;color:var(--muted)">系统内置</span>' :
          iconEdit('openRoleCreateDialog(' + r.id + ')') + iconDelete('deleteRole(' + r.id + ',\'' + escHtml(r.label) + '\')')) +
      '</td>' +
    '</tr>';
  }).join('');
}

function openRoleCreateDialog(editId) {
  var r = editId ? _permRoles.find(function(x) { return x.id === editId; }) : null;
  var title = r ? '编辑角色: ' + r.label : '添加角色';
  var bodyHtml = '<div style="padding:8px 0">' +
    '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">角色Key</label>' +
      '<input class="search-inp" id="role-key" value="' + escHtml(r ? r.key : '') + '" ' + (r ? 'readonly' : '') + ' style="margin-top:4px;font-family:var(--mono)"></div>' +
    '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">显示名</label>' +
      '<input class="search-inp" id="role-label" value="' + escHtml(r ? r.label : '') + '" style="margin-top:4px"></div>' +
    '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">说明</label>' +
      '<input class="search-inp" id="role-desc" value="' + escHtml(r ? (r.description || '') : '') + '" style="margin-top:4px"></div>' +
  '</div>';
  openDialog(title, bodyHtml, [
    { text: '取消', cls: '', onclick: "this.closest('.note-dialog-overlay').remove()" },
    { text: '保存', cls: 'btn-primary', onclick: "saveRole(" + (editId || 0) + ");this.closest('.note-dialog-overlay').remove()" },
  ]);
}

async function saveRole(editId) {
  var key = document.getElementById('role-key').value.trim();
  var label = document.getElementById('role-label').value.trim();
  var desc = document.getElementById('role-desc').value.trim();
  if (!key || !label) { showToast('Key和显示名不能为空', 'error'); return; }
  try {
    if (editId) {
      await API.put('/admin/users/roles/' + editId, { label: label, description: desc });
    } else {
      await API.post('/admin/users/roles', { key: key, label: label, description: desc });
    }
    showToast(editId ? '角色已更新' : '角色已创建', 'success');
    initUserManagement();
  } catch(e) {
    showToast('保存失败: ' + (e.message || '未知错误'), 'error');
  }
}

var _ruSelected = {};  // { userId: username }

function showRoleUsers(roleId, roleLabel) {
  _ruSelected = {};
  _userList.forEach(function(u) {
    if ((u.role_ids || []).indexOf(roleId) >= 0) {
      _ruSelected[u.id] = u.username;
    }
  });

  // Show all users as clickable tags (styling via CSS class only)
  var allTags = _userList.map(function(u) {
    var sel = _ruSelected.hasOwnProperty(u.id);
    return '<span class="ru-user-tag' + (sel ? ' selected' : '') + '" data-uid="' + u.id + '" onclick="ruToggleUser(' + u.id + ')"' +
      '>' + escHtml(u.username) + (u.is_active ? '' : ' <span style="font-size:9px;opacity:0.6">已禁用</span>') + '</span>';
  }).join('');

  var bodyHtml = '<div style="padding:8px 0">' +
    '<div style="margin-bottom:6px;font-size:12px;color:var(--muted)">角色 <b>' + escHtml(roleLabel) + '</b> — 点击用户标签选择，已选 <span id="ru-count">' + Object.keys(_ruSelected).length + '</span> 人</div>' +
    '<div style="display:flex;gap:6px;margin-bottom:8px">' +
      '<button class="btn btn-sm" onclick="ruSelectAll()">全选</button>' +
      '<button class="btn btn-sm" style="color:var(--danger)" onclick="ruClearAll()">清空</button>' +
    '</div>' +
    '<div id="ru-all-tags" style="max-height:300px;overflow-y:auto;line-height:2">' + allTags + '</div>' +
  '</div>';

  openDialog('管理角色成员', bodyHtml, [
    { text: '取消', cls: '', onclick: "this.closest('.note-dialog-overlay').remove()" },
    { text: '保存', cls: 'btn-primary', onclick: "saveRoleUsers(" + roleId + ");this.closest('.note-dialog-overlay').remove()" },
  ], { maxWidth: 550 });
}

function ruToggleUser(id) {
  if (_ruSelected[id]) {
    delete _ruSelected[id];
  } else {
    var u = _userList.find(function(x) { return x.id === id; });
    if (u) _ruSelected[id] = u.username;
  }
  // Update only the specific tag for this user
  var tag = document.querySelector('.ru-user-tag[data-uid="' + id + '"]');
  if (tag) tag.classList.toggle('selected', _ruSelected.hasOwnProperty(id));
  document.getElementById('ru-count').textContent = Object.keys(_ruSelected).length;
}

function ruSelectAll() {
  _userList.forEach(function(u) { _ruSelected[u.id] = u.username; });
  document.querySelectorAll('.ru-user-tag').forEach(function(t) { t.classList.add('selected'); });
  document.getElementById('ru-count').textContent = Object.keys(_ruSelected).length;
}

function ruClearAll() {
  _ruSelected = {};
  document.querySelectorAll('.ru-user-tag').forEach(function(t) { t.classList.remove('selected'); });
  document.getElementById('ru-count').textContent = '0';
}

async function saveRoleUsers(roleId) {
  var userIds = Object.keys(_ruSelected).map(function(id) { return parseInt(id); });
  var promises = _userList.map(function(u) {
    var roleIds = (u.role_ids || []).slice();
    var inRole = roleIds.indexOf(roleId) >= 0;
    var shouldBe = userIds.indexOf(u.id) >= 0;
    if (inRole === shouldBe) return null;
    if (shouldBe) roleIds.push(roleId);
    else roleIds = roleIds.filter(function(r) { return r !== roleId; });
    return API.put('/admin/users/' + u.id + '/roles', { role_ids: roleIds });
  }).filter(Boolean);

  try {
    await Promise.all(promises);
    showToast('成员已更新', 'success');
    initUserManagement();
  } catch(e) {
    showToast('保存失败: ' + (e.message || '未知错误'), 'error');
  }
}

async function deleteRole(id, label) {
  if (!confirm('确定删除角色 "' + label + '"？关联的用户将被移除该角色。')) return;
  try {
    await API.del('/admin/users/roles/' + id);
    showToast('角色已删除', 'success');
    initUserManagement();
  } catch(e) {
    showToast('删除失败: ' + (e.message || '未知错误'), 'error');
  }
}

function renderUserTable() {
  var tbody = document.getElementById('users-tbody');
  // Apply filter
  var users = _userList.slice();
  if (_userFilter === 'active') users = users.filter(function(u) { return u.is_active; });
  else if (_userFilter === 'disabled') users = users.filter(function(u) { return !u.is_active; });
  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state" style="padding:16px">暂无匹配用户</div></td></tr>';
    return;
  }
  tbody.innerHTML = users.map(function(u, idx) {
    var statusHtml = u.is_active
      ? '<span class="pill" style="background:var(--success-lt);color:var(--success)">正常</span>'
      : '<span class="pill" style="background:var(--danger-lt);color:var(--danger)">已禁用</span>';
    var toggleLabel = u.is_active ? '禁用' : '启用';
    // Role group badges from user_roles
    var roleIds = u.role_ids || [];
    // Sort: public role badge first
    roleIds.sort(function(a, b) {
      var ra = _permRoles.find(function(x) { return x.id === a; });
      var rb = _permRoles.find(function(x) { return x.id === b; });
      if (ra && ra.key === 'public') return -1;
      if (rb && rb.key === 'public') return 1;
      return 0;
    });
    var roleBadges = roleIds.map(function(rid) {
      var r = _permRoles.find(function(x) { return x.id === rid; });
      return r ? '<span style="display:inline-block;margin:1px 2px;padding:1px 6px;border-radius:3px;font-size:10.5px;background:var(--accent-lt);color:var(--accent)">' + escHtml(r.label) + '</span>' : '';
    }).join('');
    var authSourceHtml = '<span style="display:inline-block;padding:1px 6px;border-radius:3px;font-size:10px;background:' +
      (u.auth_source === 'gitlab' ? 'var(--accent-lt)' : 'var(--muted-lt)') + ';color:' +
      (u.auth_source === 'gitlab' ? 'var(--accent)' : 'var(--muted)') + '">' +
      (u.auth_source === 'gitlab' ? 'GitLab' : '本地') + '</span>';
    // Login status column
    var loginHtml = '';
    if (u.is_online) {
      var tooltip = (u.last_login_ua || '') + ' / ' + (u.last_login_ip || '') + ' / ' + (u.last_login_at || '');
      loginHtml = '<span class="pill" style="background:var(--success-lt);color:var(--success);cursor:default" title="' + escHtml(tooltip) + '">在线</span>';
    } else if (u.last_login_at) {
      var tip2 = '最后登录: ' + (u.last_login_at || '') + '\n' + (u.last_login_ua || '') + ' / ' + (u.last_login_ip || '');
      loginHtml = '<span style="font-size:11px;color:var(--muted);cursor:default" title="' + escHtml(tip2) + '">离线</span>';
    } else {
      loginHtml = '<span style="font-size:11px;color:var(--muted)">从未登录</span>';
    }
    return '<tr>' +
      '<td style="font-family:var(--mono);color:var(--muted);text-align:center">' + (idx + 1) + '</td>' +
      '<td style="font-size:13px;font-weight:500">' + escHtml(u.username) + '</td>' +
      '<td style="font-size:12px">' + authSourceHtml + '</td>' +
      '<td>' + (roleBadges || '<span style="font-size:11px;color:var(--muted)">未分配</span>') + '</td>' +
      '<td>' + statusHtml + '</td>' +
      '<td style="font-size:11px">' + loginHtml + '</td>' +
      '<td style="font-size:12px;color:var(--muted)">' + escHtml(u.created_at || '') + '</td>' +
      '<td style="white-space:nowrap">' +
        iconEdit('openUserEditDialog(' + u.id + ')') +
        iconToggle('toggleUserActive(' + u.id + ',' + u.is_active + ')', toggleLabel) +
        iconDelete('deleteUser(' + u.id + ',\'' + escHtml(u.username) + '\')') +
      '</td>' +
    '</tr>';
  }).join('');
}

var _udRowCount = 0;

function openUserCreateDialog() {
  _udRowCount = 0;
  var html = '<div class="note-dialog-overlay">' +
    '<div class="note-dialog" style="width:820px;max-width:none;max-height:80vh;display:flex;flex-direction:column">' +
      '<div class="note-dialog-head"><span class="note-dialog-title">批量添加用户</span>' +
        '<button class="note-dialog-close" onclick="closeUserDialog()">&times;</button></div>' +
      '<div style="margin-bottom:10px;font-size:12px;color:var(--muted)">每行填写一个用户，密码留空默认为 123456</div>' +
      '<div id="ud-rows" style="flex:1;overflow-y:auto;min-height:240px"></div>' +
      '<div style="display:flex;align-items:center;gap:8px;margin-top:8px;flex-shrink:0">' +
        '<button class="btn btn-primary" style="font-size:11px;padding:3px 10px;padding-left:12px;padding-right:12px" onclick="addUdRow()">+ 添加行</button>' +
      '</div>' +
      '<div style="display:flex;justify-content:flex-end;align-items:center;gap:10px;margin-top:14px;flex-shrink:0">' +
        '<span id="ud-msg" style="font-size:11px"></span>' +
        '<button class="btn" onclick="closeUserDialog()">取消</button>' +
        '<button class="btn btn-primary" onclick="submitUserCreate()">批量创建</button></div>' +
    '</div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
  // Add default 3 rows
  for (var i = 0; i < 5; i++) addUdRow();
}

function addUdRow() {
  var container = document.getElementById('ud-rows');
  if (!container) return;
  var idx = _udRowCount++;
  var roleOpts = (_permRoles.length ? _permRoles : []).map(function(r) {
    var sel = r.key === 'test_delivery' ? 'selected' : '';
    return '<option value="' + r.id + '" ' + sel + '>' + escHtml(r.label) + '</option>';
  }).join('');
  var div = document.createElement('div');
  div.className = 'ud-row';
  div.id = 'ud-row-' + idx;
  div.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px;padding:8px 10px;background:var(--bg);border-radius:8px';
  div.innerHTML =
    '<div style="flex:0 0 140px">' +
      '<input class="search-inp ud-uname" placeholder="用户名" style="width:100%;padding:6px 8px;font-size:12px;font-family:var(--mono);box-sizing:border-box">' +
    '</div>' +
    '<div style="flex:0 0 110px">' +
      '<input class="search-inp ud-pw" type="text" value="123456" placeholder="密码" style="width:100%;padding:6px 8px;font-size:12px;box-sizing:border-box">' +
    '</div>' +
    '<div style="flex:3;min-width:280px;position:relative">' +
      '<div class="ud-ms-trigger" onclick="toggleUdMs(this)" style="cursor:pointer;border:1px solid var(--border);border-radius:6px;padding:3px 6px;min-height:28px;background:var(--surface);display:flex;align-items:center;gap:4px" title="点击选择角色">' +
        '<span class="ud-ms-tags" style="flex:1;word-break:break-all;line-height:1.6"></span>' +
        '<span style="font-size:11px;color:var(--muted);flex-shrink:0">&#x25BC;</span>' +
      '</div>' +
      '<select class="ud-ms-select" multiple style="display:none">' + roleOpts + '</select>' +
      '<div class="ud-ms-dd" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:999;background:var(--surface);border:1px solid var(--border);border-radius:6px;box-shadow:var(--sh-md);padding:4px;max-height:200px;overflow-y:auto;overscroll-behavior:contain">' +
        roleOpts.split('</option>').join('</option>') +
      '</div>' +
    '</div>' +
    '<button class="btn" onclick="removeUdRow(' + idx + ')" style="font-size:16px;padding:2px 8px;line-height:1;color:var(--danger);flex-shrink:0">&times;</button>';
  container.appendChild(div);
  // Sync select ↔ dropdown visual state
  var dd = div.querySelector('.ud-ms-dd');
  var sel = div.querySelector('.ud-ms-select');
  // Stop wheel on dropdown from reaching parent list
  dd.addEventListener('wheel', function(e) { e.stopPropagation(); });
  // Initialize dropdown option selected states to match hidden select
  for (var si = 0; si < sel.options.length; si++) {
    if (dd.children[si]) dd.children[si].selected = sel.options[si].selected;
  }
  dd.addEventListener('click', function(e) {
    var opt = e.target.closest('option');
    if (!opt) return;
    e.stopPropagation();
    var idx = Array.prototype.indexOf.call(dd.children, opt);
    if (idx >= 0 && idx < sel.options.length) {
      sel.options[idx].selected = !sel.options[idx].selected;
      opt.selected = sel.options[idx].selected;
      updateUdMsTags(div.querySelector('.ud-ms-trigger'));
    }
  });
  updateUdMsTags(div.querySelector('.ud-ms-trigger'));
}

function toggleUdMs(trigger) {
  var dd = trigger.parentElement.querySelector('.ud-ms-dd');
  if (!dd) return;
  var isOpen = dd.style.display === 'block';
  document.querySelectorAll('.ud-ms-dd').forEach(function(d) { d.style.display = 'none'; });
  dd.style.display = isOpen ? 'none' : 'block';
}

document.addEventListener('click', function(e) {
  if (!e.target.closest('.ud-ms-trigger') && !e.target.closest('.ud-ms-dd')) {
    document.querySelectorAll('.ud-ms-dd').forEach(function(d) { d.style.display = 'none'; });
  }
});

function updateUdMsTags(trigger) {
  var sel = trigger.parentElement.querySelector('.ud-ms-select');
  var tags = trigger.querySelector('.ud-ms-tags');
  if (!sel || !tags) return;
  var selected = [];
  for (var i = 0; i < sel.options.length; i++) {
    if (sel.options[i].selected) selected.push({ idx: i, label: sel.options[i].textContent });
  }
  tags.innerHTML = selected.length
    ? selected.map(function(s) {
        return '<span class="ud-ms-tag" data-idx="' + s.idx + '" onclick="removeUdMsTag(this, event)" style="display:inline-block;margin:1px;padding:0 5px;border-radius:4px;font-size:10.5px;background:var(--accent-lt);color:var(--accent);white-space:nowrap;cursor:pointer" title="点击移除">' + escHtml(s.label) + ' &times;</span>';
      }).join('')
    : '<span style="font-size:10.5px;color:var(--muted)">选择角色...</span>';
}

function removeUdMsTag(el, ev) {
  ev.stopPropagation();
  var trigger = el.closest('.ud-ms-trigger');
  if (!trigger) return;
  var sel = trigger.parentElement.querySelector('.ud-ms-select');
  var dd = trigger.parentElement.querySelector('.ud-ms-dd');
  var idx = parseInt(el.dataset.idx, 10);
  if (sel && idx >= 0 && idx < sel.options.length) {
    sel.options[idx].selected = false;
    if (dd && dd.children[idx]) dd.children[idx].selected = false;
    updateUdMsTags(trigger);
  }
}

function closeUserDialog() {
  var overlay = document.querySelector('.note-dialog-overlay');
  if (overlay) overlay.remove();
}

function removeUdRow(idx) {
  var row = document.getElementById('ud-row-' + idx);
  if (row) row.remove();
}

async function submitUserCreate() {
  var rows = document.querySelectorAll('.ud-row');
  var users = [];
  rows.forEach(function(row) {
    var uname = (row.querySelector('.ud-uname').value || '').trim();
    if (!uname) return;
    var pw = row.querySelector('.ud-pw').value || '123456';
    var roleIds = [];
    var sel = row.querySelector('.ud-ms-select');
    if (sel) {
      for (var j = 0; j < sel.options.length; j++) {
        if (sel.options[j].selected) roleIds.push(parseInt(sel.options[j].value));
      }
    }
    var primaryRole = roleIds.length > 0 ? (_permRoles.find(function(r) { return r.id === roleIds[0]; }) || {}).key || 'viewer' : 'viewer';
    users.push({ username: uname, password: pw, primaryRole: primaryRole, roleIds: roleIds });
  });
  var msg = document.getElementById('ud-msg');
  if (!users.length) { msg.innerHTML = '<span style="color:var(--danger)">请至少填写一个用户名</span>'; return; }
  var success = 0, fail = 0;
  var errors = [];
  msg.innerHTML = '<span style="color:var(--muted)">创建中...</span>';
  msg.style.color = 'var(--muted)';
  for (var i = 0; i < users.length; i++) {
    var u = users[i];
    try {
      var resp = await API.post('/admin/users', { username: u.username, password: u.password, role: u.primaryRole });
      if (resp && resp.id && u.roleIds.length) {
        try {
          await API.put('/admin/users/' + resp.id + '/roles', { role_ids: u.roleIds });
        } catch(roleErr) {
          // Rollback: delete the created user since role assignment failed
          try { await API.del('/admin/users/' + resp.id); } catch(ignore) {}
          throw new Error('角色分配失败: ' + roleErr.message);
        }
      }
      success++;
      msg.innerHTML = '<span style="color:var(--muted)">已创建 ' + success + ' / ' + users.length + '...<span>';
    } catch(e) {
      fail++;
      errors.push(u.username + ': ' + e.message);
      showToast('创建 ' + u.username + ' 失败: ' + e.message, 'error');
    }
  }
  if (fail === 0) {
    closeUserDialog();
    showToast('成功创建 ' + success + ' 个用户', 'success');
  } else {
    var errSummary = errors.slice(0, 3).join('; ');
    if (errors.length > 3) errSummary += ' ...等' + errors.length + '个错误';
    msg.innerHTML = '<span style="color:var(--danger)">成功 ' + success + ' 个, 失败 ' + fail + ' 个: ' + escHtml(errSummary) + '</span>';
  }
  initUserManagement();
}

function openUserEditDialog(id) {
  var u = _userList.find(function(x) { return x.id === id; });
  if (!u) return;
  var isGitlab = u.auth_source === 'gitlab';
  var passwordField = isGitlab
    ? '<div class="user-form-field"><label>密码</label><div style="font-size:12px;color:var(--muted);padding:6px 0">GitLab 用户无需本地密码</div></div>'
    : '<div class="user-form-field"><label>新密码（留空不修改）</label><input class="config-input" id="ue-password" type="password" placeholder="留空则不修改密码"></div>';
  var authBadge = isGitlab
    ? ' <span style="display:inline-block;margin-left:8px;padding:1px 8px;border-radius:3px;font-size:11px;background:var(--accent-lt);color:var(--accent);vertical-align:middle">GitLab</span>'
    : '';
  var html = '<div class="note-dialog-overlay">' +
    '<div class="note-dialog">' +
      '<div class="note-dialog-head"><span class="note-dialog-title">编辑用户: ' + escHtml(u.username) + authBadge + '</span>' +
        '<button class="note-dialog-close" onclick="closeUserDialog()">&times;</button></div>' +
      '<div class="user-form">' +
        '<div class="user-form-field"><label>角色组（可多选）</label><div id="ue-role-cbs">' + _roleCheckboxes(u.role_ids || []) + '</div></div>' +
        passwordField +
      '</div>' +
      '<div style="display:flex;justify-content:flex-end;align-items:center;gap:10px;margin-top:14px">' +
        '<span id="ue-msg" style="font-size:11px"></span>' +
        '<button class="btn" onclick="closeUserDialog()">取消</button>' +
        '<button class="btn btn-primary" onclick="submitUserEdit(' + id + ')">保存</button></div>' +
    '</div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
}

async function submitUserEdit(id) {
  var roleIds = [];
  document.querySelectorAll('#ue-role-cbs .ue-role-cb:checked').forEach(function(cb) { roleIds.push(parseInt(cb.value)); });
  var role = roleIds.length > 0 ? _permRoles.find(function(r) { return r.id === roleIds[0]; }) : null;
  var pwEl = document.getElementById('ue-password');
  var password = pwEl ? pwEl.value : '';
  var msg = document.getElementById('ue-msg');
  var payload = { role: role ? role.key : 'viewer' };
  if (password) payload.password = password;
  try {
    msg.innerHTML = '<span style="color:var(--muted)">保存中...</span>';
    await API.put('/admin/users/' + id, payload);
    // Update role assignments
    await API.put('/admin/users/' + id + '/roles', { role_ids: roleIds });
    closeUserDialog();
    initUserManagement();
  } catch(e) {
    msg.innerHTML = '<span style="color:var(--danger)">' + escHtml(e.message) + '</span>';
  }
}

async function toggleUserActive(id, currentActive) {
  try {
    await API.put('/admin/users/' + id, { is_active: !currentActive });
    initUserManagement();
  } catch(e) {
    showToast('操作失败: ' + e.message, 'error');
  }
}

async function deleteUser(id, username) {
  if (!confirm('确定删除用户 "' + username + '"？此操作不可撤销。')) return;
  var ok = await verifyPassword('删除用户: ' + username, 'pw_verify_delete_user');
  if (!ok) return;
  try {
    await API.del('/admin/users/' + id);
    initUserManagement();
    showToast('用户已删除', 'success');
  } catch(e) {
    showToast('删除失败: ' + e.message, 'error');
  }
}

/* ── PMA Settings in Config Page ── */

async function loadPmaSettingsUI() {
  try {
    var settings = await API.get('/admin/settings');
    var items = [];
    Object.keys(settings).forEach(function(key) {
      var s = settings[key];
      var uid = 'pma-setting-' + key;
      items.push(
        '<label style="display:flex;align-items:center;justify-content:space-between;padding:8px 14px;background:var(--bg);border-radius:8px;gap:10px;cursor:default">' +
          '<span style="font-size:12.5px">' + escHtml(s.label) + '</span>' +
          '<span style="flex-shrink:0">' +
            toggleSwitch(s.value, "togglePmaSetting('" + key + "'," + !s.value + ",this)", {id: uid}) +
          '</span>' +
        '</label>'
      );
    });
    var html = '<div class="section-hd" style="margin-top:22px"><div class="section-title">操作安全设置</div></div>' +
      '<div class="card" style="padding:16px;margin-bottom:20px">' +
        '<div style="font-size:12px;color:var(--muted);margin-bottom:12px">以下操作是否需要密码验证确认：</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
          items.join('') +
        '</div>' +
      '</div>';
    var container = document.getElementById('admin-settings-area');
    if (container) container.innerHTML = html;
  } catch(e) {}
}

async function togglePmaSetting(key, newValue, toggleEl) {
  if (toggleEl) {
    toggleEl.style.background = newValue ? 'var(--success)' : 'var(--border)';
    var dot = toggleEl.querySelector('span');
    if (dot) dot.style.transform = 'translateX(' + (newValue ? '22px' : '2px') + ')';
  }
  var payload = {}; payload[key] = newValue;
  try {
    await API.put('/admin/settings', payload);
    _pmaSettings = null;
    if (typeof loadPmaSettings === 'function') loadPmaSettings();
  } catch(e) {
    if (toggleEl) {
      toggleEl.style.background = !newValue ? 'var(--success)' : 'var(--border)';
      if (dot) dot.style.transform = 'translateX(' + (!newValue ? '22px' : '2px') + ')';
    }
    showToast('保存失败: ' + e.message, 'error');
  }
}

/* ═══════════════════════════════════════════════════
   PERMISSION MANAGEMENT (Role-based)
═══════════════════════════════════════════════════ */

var _permRoles = [];
var _permRolesOrig = null;
var _permUsers = [];
var _allPerms = [];

function arraysEqual(a, b) { if (!a || !b) return a === b; if (a.length !== b.length) return false; for (var i=0;i<a.length;i++){if(a[i]!==b[i])return false;} return true; }

async function toggleDebugPerm() {
  var toggle = document.getElementById('toggle-debug-perm');
  var knob = toggle ? toggle.querySelector('span') : null;
  var next = !window._debugPermEnabled;
  try {
    await API.put('/admin/settings', { debug_perm: next });
    window._debugPermEnabled = next;
    if (toggle) { toggle.style.background = next ? 'var(--success)' : 'var(--border)'; }
    if (knob) { knob.style.transform = next ? 'translateX(22px)' : 'translateX(2px)'; }
    // Refresh current page title
    var view = localStorage.getItem('pm_view') || 'dashboard';
    var entry = VIEW_REGISTRY[view];
    var title = entry ? entry.title : '';
    if (next) {
      var user = getCurrentUser();
      var roleKey = user ? (user.role || '?') : '未登录';
      var roleLabels = window._roleLabels || {};
      var currentLabel = roleLabels[roleKey] || roleKey;
      var permKey = entry ? (entry.perm || '登录即可') : '?';
      var permRoles = window._permRoles || {};
      var requiredLabel = (permRoles[permKey] || []).join(', ') || permKey;
      title += ' <span style="font-size:11px;color:var(--muted);font-weight:400;margin-left:8px">[需: ' + requiredLabel + ' | 当前: ' + currentLabel + ']</span>';
    }
    document.getElementById('topbar-title').innerHTML = title;
    showToast('权限调试: ' + (next ? '开' : '关'), 'success');
  } catch(e) {
    showToast('切换失败: ' + (e.message || '未知错误'), 'error');
  }
}

var _permTab = 'roles';

function switchPermTab(tab) {
  _permTab = tab;
  document.getElementById('ptab-roles').classList.toggle('active', tab === 'roles');
  document.getElementById('ptab-perms').classList.toggle('active', tab === 'perms');
  document.getElementById('psec-roles').style.display = tab === 'roles' ? '' : 'none';
  document.getElementById('psec-perms').style.display = tab === 'perms' ? '' : 'none';
  if (tab === 'perms') renderPermByPermTable();
}

function renderPermByPermTable() {
  var tbody = document.getElementById('perm-perm-tbody');
  tbody.innerHTML = _allPerms.map(function(p) {
    var allRoles = _permRoles.filter(function(r) { return r.key !== 'admin'; }); // exclude immutable admin
    var checkboxes = allRoles.map(function(r) {
      var has = (r.permissions || []).indexOf(p.key) >= 0;
      return '<label style="display:inline-flex;align-items:center;gap:3px;margin:2px 4px;font-size:11px;cursor:pointer">' +
        '<input type="checkbox" ' + (has ? 'checked' : '') + ' onchange="togglePermForRole(' + r.id + ',\'' + p.key + '\',this.checked)">' +
        escHtml(r.label) + '</label>';
    }).join('');
    return '<tr>' +
      '<td style="font-size:13px;font-weight:500">' + escHtml(p.label) + ' <span style="font-size:10px;color:var(--muted);font-family:var(--mono)">' + escHtml(p.key) + '</span></td>' +
      '<td style="line-height:2">' + (checkboxes || '<span style="font-size:11px;color:var(--muted)">无</span>') + '</td>' +
      '<td style="font-size:12px;color:var(--muted)">' + allRoles.filter(function(r){return (r.permissions||[]).indexOf(p.key)>=0;}).length + ' 个角色</td>' +
    '</tr>';
  }).join('');
}

function togglePermForRole(roleId, permKey, checked) {
  var role = _permRoles.find(function(r) { return r.id === roleId; });
  if (!role || role.key === 'admin') return;
  var perms = (role.permissions || []).slice();
  if (checked) { if (perms.indexOf(permKey) < 0) perms.push(permKey); }
  else { perms = perms.filter(function(p) { return p !== permKey; }); }
  role.permissions = perms;
  markPageDirty();
  renderPermByPermTable();
  _renderPermSaveBar();
}

async function initPermissions() {
  var debugToggle = document.getElementById("toggle-debug-perm");
  if (debugToggle) {
    debugToggle.style.background = window._debugPermEnabled ? 'var(--success)' : 'var(--border)';
    var knob = debugToggle.querySelector('span');
    if (knob) knob.style.transform = window._debugPermEnabled ? 'translateX(22px)' : 'translateX(2px)';
  }
  try {
    var meta = await API.get('/admin/users/permissions');
    _allPerms = meta.permissions || [];
    var data = await API.get('/admin/users');
    _permUsers = data || [];
    var roles = await API.get('/admin/users/roles');
    _permRoles = roles || [];
    // Snapshot original permissions for change detection
    _permRolesOrig = JSON.parse(JSON.stringify(_permRoles));
    markPageClean();
    renderPermTable();
  } catch(e) {
    document.getElementById('perm-tbody').innerHTML = '<tr><td colspan="5"><div class="error-state">加载失败: ' + escHtml(e.message) + '</div></td></tr>';
  }
}

function renderPermTable() {
  var tbody = document.getElementById('perm-tbody');
  if (!_permRoles.length) {
    tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state">暂无角色</div></td></tr>';
    return;
  }
  tbody.innerHTML = _permRoles.map(function(r) {
    var perms = r.permissions || [];
    var usersInRole = _permUsers.filter(function(u) { return (u.role_ids || []).indexOf(r.id) >= 0; });
    return '<tr>' +
      '<td><strong>' + escHtml(r.label) + (isPageDirty() && _permRolesOrig && !arraysEqual(perms, (_permRolesOrig.find(function(x){return x.id===r.id})||{}).permissions||[]) ? ' <span style="font-size:8px;color:var(--warn);vertical-align:super">●</span>' : '') + '</strong><div style="font-size:10.5px;color:var(--muted);font-family:var(--mono)">' + escHtml(r.key) + '</div></td>' +
      '<td style="font-size:11.5px">' + _allPerms.map(function(p) {
        var checked = perms.indexOf(p.key) >= 0;
        var disabled = r.key === 'admin' ? ' disabled' : '';
        return '<label style="cursor:' + (disabled ? 'default' : 'pointer') + ';display:inline-flex;align-items:center;gap:3px;margin-right:8px;font-size:11px;opacity:' + (disabled ? '0.6' : '1') + '">' +
          '<input type="checkbox" ' + (checked ? 'checked' : '') + disabled + ' onchange="toggleRolePerm(' + r.id + ',\'' + p.key + '\',this.checked)">' +
          escHtml(p.label) + '</label>';
      }).join('') + '</td>' +
      '<td style="font-size:11.5px">' +
        '<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap">' +
          (usersInRole.length ? usersInRole.map(function(u) {
            return '<span style="display:inline-block;margin:1px 2px;padding:1px 6px;border-radius:3px;background:var(--accent-lt);color:var(--accent);font-size:11px">' + escHtml(u.username) + '</span>';
          }).join('') : '<span style="color:var(--muted)">—</span>') +
        '</div>' +
      '</td>' +
      '<td><button class="btn btn-xs" onclick="openRoleMemberDialog(' + r.id + ',\'' + escHtml(r.label).replace(/'/g, "\\'") + '\')">管理成员</button></td>' +
      '<td style="font-size:11px;color:var(--muted)">' + escHtml(r.description || '') + '</td>' +
    '</tr>';
  }).join('');
  _renderPermSaveBar();
}

function _renderPermSaveBar() {
  // Show save/discard bar when permissions have been modified
  var existing = document.getElementById('perm-save-bar');
  if (existing) existing.remove();
  if (isPageDirty()) {
    var bar = document.createElement('div');
    bar.id = 'perm-save-bar';
    bar.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:100;display:flex;gap:8px;background:var(--surface);padding:10px 16px;border:1px solid var(--warn);border-radius:10px;box-shadow:var(--sh-md)';
    bar.innerHTML = '<span style="font-size:12px;color:var(--warn);line-height:2">⚠ 已修改，待保存</span>' +
      '<button class="btn btn-primary" onclick="savePermChanges()">保存配置</button>' +
      '<button class="btn" style="color:var(--warn);border-color:var(--warn)" onclick="discardPermChanges()">放弃</button>';
    document.getElementById('view-permissions').appendChild(bar);
  }
}

function openRoleMemberDialog(roleId, roleLabel) {
  // Build checkbox list of all users
  var userRows = _permUsers.map(function(u) {
    var inRole = (u.role_ids || []).indexOf(roleId) >= 0;
    return '<label class="rm-user-row" data-rm-username="' + u.username.toLowerCase() + '" style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:13px;cursor:pointer">' +
      '<input type="checkbox" ' + (inRole ? 'checked' : '') + ' value="' + u.id + '" class="rm-user-cb">' +
      escHtml(u.username) + ' <span style="font-size:10px;color:var(--muted)">' + escHtml(_roleLabels[u.role] || u.role) + '</span>' +
    '</label>';
  }).join('');

  var html = '<div class="note-dialog-overlay">' +
    '<div class="note-dialog" style="max-width:360px">' +
      '<div class="note-dialog-head"><span class="note-dialog-title">管理角色成员: ' + roleLabel + '</span>' +
        '<button class="note-dialog-close" onclick="closeUserDialog()">&times;</button></div>' +
      '<input class="search-inp" id="rm-search" placeholder="搜索用户..." oninput="filterRmUsers()" style="margin-bottom:10px;padding:7px 12px">' +
      '<div style="max-height:340px;overflow-y:auto;margin-bottom:12px" id="rm-user-list">' + userRows + '</div>' +
      '<div style="display:flex;justify-content:flex-end;gap:10px">' +
        '<button class="btn" onclick="closeUserDialog()">取消</button>' +
        '<button class="btn btn-primary" onclick="submitRoleMembers(' + roleId + ')">保存</button></div>' +
    '</div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
}

function filterRmUsers() {
  var q = (document.getElementById('rm-search').value || '').toLowerCase();
  document.querySelectorAll('.rm-user-row').forEach(function(row) {
    row.style.display = q ? (row.dataset.rmUsername.indexOf(q) >= 0 ? '' : 'none') : '';
  });
}

async function submitRoleMembers(roleId) {
  var userIds = [];
  document.querySelectorAll('.rm-user-cb:checked').forEach(function(cb) { userIds.push(parseInt(cb.value)); });
  // For each user, update their role_ids
  var promises = _permUsers.map(function(u) {
    var roleIds = (u.role_ids || []).slice();
    var inRole = roleIds.indexOf(roleId) >= 0;
    var shouldBe = userIds.indexOf(u.id) >= 0;
    if (inRole && !shouldBe) {
      roleIds = roleIds.filter(function(r) { return r !== roleId; });
    } else if (!inRole && shouldBe) {
      roleIds.push(roleId);
    } else {
      return null; // no change
    }
    return API.put('/admin/users/' + u.id + '/roles', { role_ids: roleIds });
  }).filter(Boolean);

  try {
    await Promise.all(promises);
    closeUserDialog();
    // Refresh data
    var data = await API.get('/admin/users');
    _permUsers = data || [];
    renderPermTable();
  } catch(e) {
    showToast('保存失败: ' + e.message, 'error');
  }
}

function toggleRolePerm(roleId, permKey, checked) {
  var role = _permRoles.find(function(r) { return r.id === roleId; });
  if (!role || role.key === 'admin') return;  // admin is immutable
  var perms = (role.permissions || []).slice();
  if (checked) { if (perms.indexOf(permKey) < 0) perms.push(permKey); }
  else { perms = perms.filter(function(p) { return p !== permKey; }); }
  role.permissions = perms;
  markPageDirty();
  renderPermTable();
}

async function savePermChanges() {
  var success = 0, fail = 0, skipped = 0;
  for (var i = 0; i < _permRoles.length; i++) {
    var r = _permRoles[i];
    // Skip admin role (immutable)
    if (r.key === 'admin') { skipped++; continue; }
    // Skip unchanged roles
    var orig = _permRolesOrig ? _permRolesOrig.find(function(x) { return x.id === r.id; }) : null;
    if (orig && arraysEqual(r.permissions, orig.permissions || [])) { skipped++; continue; }
    try {
      await API.put('/admin/users/roles/' + r.id, { permissions: r.permissions });
      success++;
    } catch(e) { fail++; showToast('保存 ' + r.label + ' 失败: ' + (e.message || '未知错误'), 'error'); }
  }
  var msg = '保存完成: ' + success + ' 成功';
  if (fail > 0) msg += ', ' + fail + ' 失败';
  if (skipped > 0) msg += ', ' + skipped + ' 跳过';
  showToast(msg, fail > 0 ? 'error' : 'success');
  markPageClean();
  renderPermTable();
  if (_permTab === 'perms') renderPermByPermTable();
}

function discardPermChanges() {
  if (!confirm('放弃所有未保存的权限修改？')) return;
  API.get('/admin/users').then(function(users) { _permUsers = users || []; });
  API.get('/admin/users/roles').then(function(roles) {
    _permRoles = roles || [];
    // Snapshot original permissions for change detection
    _permRolesOrig = JSON.parse(JSON.stringify(_permRoles));
    markPageClean();
    markPageClean();
    renderPermTable();
  });
}
