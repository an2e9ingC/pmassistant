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
  } catch(e) {
    container.innerHTML = '<div class="error-state">加载失败: ' + escHtml(e.message) + '<br><button onclick="initAdmin()">重试</button></div>';
  }
}

function renderConfigForm(cfg) {
  var sections = [
    { key: 'zentao', title: '禅道 (Zentao)', fields: [
      { key: 'base_url', label: 'API 地址', type: 'url', ph: 'http://192.168.3.22/zentao/api.php/v1' },
      { key: 'account', label: '账号', type: 'text', ph: 'PM_Assistant' },
      { key: 'password', label: '密码', type: 'password', ph: '' },
    ]},
    { key: 'gitlab', title: 'GitLab', fields: [
      { key: 'base_url', label: 'API 地址', type: 'url', ph: 'http://192.168.0.128/api/v4' },
      { key: 'token', label: 'Access Token', type: 'password', ph: '' },
    ]},
    { key: 'nas', title: 'NAS 存储', fields: [
      { key: 'host', label: '主机地址', type: 'text', ph: '192.168.x.x' },
      { key: 'path', label: '挂载路径', type: 'text', ph: '/mnt/nas/pre-sales/' },
      { key: 'username', label: '用户名', type: 'text', ph: '' },
      { key: 'password', label: '密码', type: 'password', ph: '' },
    ]},
  ];

  var html = '<div class="config-grid">';
  sections.forEach(function(sec) {
    html += '<div class="config-section ' + sec.key + '">' +
      '<div class="config-section-title">' + sec.title + '</div>' +
      '<div class="config-fields">';
    sec.fields.forEach(function(f) {
      var val = (cfg[sec.key] && cfg[sec.key][f.key]) || '';
      var isPw = f.type === 'password';
      var uid = 'cfg-' + sec.key + '-' + f.key;
      html += '<label class="config-field">' +
        '<span class="config-field-label">' + f.label + '</span>' +
        '<span class="config-input-wrap">' +
          '<input id="' + uid + '" class="config-input" type="' + (isPw ? 'password' : f.type) +
            '" data-section="' + sec.key + '" data-field="' + f.key + '"' +
            ' value="' + escHtml(val) + '" placeholder="' + escHtml(f.ph) + '"' +
            (isPw ? ' autocomplete="new-password" onkeyup="checkCapsLock(event,\'' + uid + '-caps\')"' : '') + '>' +
          (isPw ? '<button type="button" class="config-pw-toggle" onclick="togglePwVis(\'' + uid + '\',this)" title="显示/隐藏密码">' +
            '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">' +
              '<path d="M1 8s3-5.5 7-5.5S15 8 15 8s-3 5.5-7 5.5S1 8 1 8z"/>' +
              '<circle cx="8" cy="8" r="2.5"/>' +
            '</svg></button>' : '') +
          (isPw ? '<span id="' + uid + '-caps" class="config-caps-warn" style="display:none">&#x21E7; 大写锁定已开</span>' : '') +
        '</span>' +
      '</label>';
    });
    html += '</div></div>';
  });

  html += '</div>'; // .config-grid
  html += '<div class="config-actions">' +
    '<button class="btn btn-primary" onclick="saveConfig()">保存配置</button>' +
    '<span id="config-save-msg" style="font-size:12px;margin-left:12px"></span>' +
  '</div>';

  document.getElementById('admin-config-form').innerHTML = html;
}

function togglePwVis(id, btn) {
  var inp = document.getElementById(id);
  var isPw = inp.type === 'password';
  inp.type = isPw ? 'text' : 'password';
  btn.innerHTML = isPw
    ? '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6.5 3.5c1.5-.3 3-.3 4.5 0M3.5 5c-1 .6-2 1.5-2.8 2.5.3.4.6.8 1 1.2M12.5 5c.8.6 1.5 1.2 2 2-.3.4-.6.7-.9 1M8 5.5c-.8 0-1.5.7-1.5 1.5s.7 1.5 1.5 1.5M3 2l11 12"/></svg>'
    : '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 8s3-5.5 7-5.5S15 8 15 8s-3 5.5-7 5.5S1 8 1 8z"/><circle cx="8" cy="8" r="2.5"/></svg>';
  btn.title = isPw ? '显示密码' : '隐藏密码';
}

function checkCapsLock(e, warnId) {
  var el = document.getElementById(warnId);
  if (!el) return;
  var caps = e.getModifierState && e.getModifierState('CapsLock');
  el.style.display = caps ? '' : 'none';
}

async function saveConfig() {
  var btn = document.querySelector('.config-actions .btn');
  var msg = document.getElementById('config-save-msg');
  btn.disabled = true;
  btn.textContent = '保存中...';
  msg.textContent = '';

  var payload = { zentao: {}, gitlab: {}, nas: {} };
  document.querySelectorAll('.config-input').forEach(function(inp) {
    var sec = inp.dataset.section;
    var field = inp.dataset.field;
    payload[sec][field] = inp.value;
  });

  try {
    var result = await API.put('/admin/config', payload);
    _adminFormData = result;
    msg.innerHTML = '<span style="color:var(--success)">&#10003; 已保存（部分配置需下次同步生效）</span>';
    // Update password/token fields with masked values from response
    document.querySelectorAll('.config-input').forEach(function(inp) {
      var sec = inp.dataset.section;
      var field = inp.dataset.field;
      if (result[sec] && result[sec][field] && (field === 'password' || field === 'token')) {
        inp.value = result[sec][field];
        if (inp.type === 'text') inp.type = 'password';
      }
    });
  } catch(e) {
    msg.innerHTML = '<span style="color:var(--danger)">保存失败: ' + escHtml(e.message) + '</span>';
  }
  btn.disabled = false;
  btn.textContent = '保存配置';
}

/* ── User Management ── */

var _userList = [];

async function initUserManagement() {
  _userList = [];
  document.getElementById('users-tbody').innerHTML = '<tr><td colspan="6"><div class="loading-spinner">加载中...</div></td></tr>';
  try {
    var data = await API.get('/admin/users');
    _userList = data || [];
    renderUserTable();
  } catch(e) {
    document.getElementById('users-tbody').innerHTML = '<tr><td colspan="6"><div class="error-state">加载失败: ' + escHtml(e.message) + '</div></td></tr>';
  }
}

function renderUserTable() {
  var tbody = document.getElementById('users-tbody');
  if (!_userList.length) {
    tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state" style="padding:16px">暂无用户</div></td></tr>';
    return;
  }
  tbody.innerHTML = _userList.map(function(u) {
    var statusHtml = u.is_active
      ? '<span class="pill" style="background:var(--success-lt);color:var(--success)">正常</span>'
      : '<span class="pill" style="background:var(--danger-lt);color:var(--danger)">已禁用</span>';
    var toggleLabel = u.is_active ? '禁用' : '启用';
    return '<tr>' +
      '<td style="font-family:var(--mono);font-size:13px">' + escHtml(u.username) + '</td>' +
      '<td>' + escHtml(u.role) + '</td>' +
      '<td>' + statusHtml + '</td>' +
      '<td style="font-size:12px;color:var(--muted)">' + escHtml(u.created_at || '') + '</td>' +
      '<td style="white-space:nowrap">' +
        '<button class="btn" onclick="openUserEditDialog(' + u.id + ')" style="font-size:11px;padding:3px 10px;margin-right:4px">编辑</button>' +
        '<button class="btn" onclick="toggleUserActive(' + u.id + ',' + u.is_active + ')" style="font-size:11px;padding:3px 10px;margin-right:4px">' + toggleLabel + '</button>' +
        '<button class="btn" onclick="deleteUser(' + u.id + ',\'' + escHtml(u.username) + '\')" style="font-size:11px;padding:3px 10px;color:var(--danger)">删除</button>' +
      '</td>' +
    '</tr>';
  }).join('');
}

function openUserCreateDialog() {
  var html = '<div class="note-dialog-overlay" onclick="if(event.target===this)closeUserDialog()">' +
    '<div class="note-dialog">' +
      '<div class="note-dialog-head"><span class="note-dialog-title">添加用户</span>' +
        '<button class="note-dialog-close" onclick="closeUserDialog()">&times;</button></div>' +
      '<div class="user-form">' +
        '<div class="user-form-field"><label>用户名</label><input class="config-input" id="ud-username"></div>' +
        '<div class="user-form-field"><label>密码</label><input class="config-input" id="ud-password" type="password"></div>' +
        '<div class="user-form-field"><label>角色</label><select class="config-input" id="ud-role"><option value="viewer">viewer</option><option value="manager">manager</option><option value="admin">admin</option></select></div>' +
      '</div>' +
      '<div style="display:flex;justify-content:flex-end;align-items:center;gap:10px;margin-top:14px">' +
        '<span id="ud-msg" style="font-size:11px"></span>' +
        '<button class="btn" onclick="closeUserDialog()">取消</button>' +
        '<button class="btn btn-primary" onclick="submitUserCreate()">创建</button></div>' +
    '</div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
}

function closeUserDialog() {
  var overlay = document.querySelector('.note-dialog-overlay');
  if (overlay) overlay.remove();
}

async function submitUserCreate() {
  var username = document.getElementById('ud-username').value.trim();
  var password = document.getElementById('ud-password').value;
  var role = document.getElementById('ud-role').value;
  var msg = document.getElementById('ud-msg');
  if (!username || !password) { msg.innerHTML = '<span style="color:var(--danger)">请填写所有字段</span>'; return; }
  try {
    msg.innerHTML = '<span style="color:var(--muted)">创建中...</span>';
    await API.post('/admin/users', { username: username, password: password, role: role });
    closeUserDialog();
    initUserManagement();
  } catch(e) {
    msg.innerHTML = '<span style="color:var(--danger)">' + escHtml(e.message) + '</span>';
  }
}

function openUserEditDialog(id) {
  var u = _userList.find(function(x) { return x.id === id; });
  if (!u) return;
  var roles = ['viewer', 'manager', 'admin'];
  var roleOpts = roles.map(function(r) { return '<option value="' + r + '"' + (u.role === r ? ' selected' : '') + '>' + r + '</option>'; }).join('');
  var html = '<div class="note-dialog-overlay" onclick="if(event.target===this)closeUserDialog()">' +
    '<div class="note-dialog">' +
      '<div class="note-dialog-head"><span class="note-dialog-title">编辑用户: ' + escHtml(u.username) + '</span>' +
        '<button class="note-dialog-close" onclick="closeUserDialog()">&times;</button></div>' +
      '<div class="user-form">' +
        '<div class="user-form-field"><label>角色</label><select class="config-input" id="ue-role">' + roleOpts + '</select></div>' +
        '<div class="user-form-field"><label>新密码（留空不修改）</label><input class="config-input" id="ue-password" type="password" placeholder="留空则不修改密码"></div>' +
      '</div>' +
      '<div style="display:flex;justify-content:flex-end;align-items:center;gap:10px;margin-top:14px">' +
        '<span id="ue-msg" style="font-size:11px"></span>' +
        '<button class="btn" onclick="closeUserDialog()">取消</button>' +
        '<button class="btn btn-primary" onclick="submitUserEdit(' + id + ')">保存</button></div>' +
    '</div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
}

async function submitUserEdit(id) {
  var role = document.getElementById('ue-role').value;
  var password = document.getElementById('ue-password').value;
  var msg = document.getElementById('ue-msg');
  var payload = { role: role };
  if (password) payload.password = password;
  try {
    msg.innerHTML = '<span style="color:var(--muted)">保存中...</span>';
    await API.put('/admin/users/' + id, payload);
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
  try {
    await API.del('/admin/users/' + id);
    initUserManagement();
    showToast('用户已删除', 'success');
  } catch(e) {
    showToast('删除失败: ' + e.message, 'error');
  }
}
