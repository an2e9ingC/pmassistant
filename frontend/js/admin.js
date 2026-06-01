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
