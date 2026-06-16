/* ═══════════════════════════════════════════════════
   DB MANAGE — Export / Import / Backup Config
═══════════════════════════════════════════════════ */

var _dbBackupConfig = null;
var _dbBackups = [];
var _dbSqlcipherEnabled = false;

async function initDbManage() {
  var container = document.getElementById('view-db-manage');
  container.innerHTML = '<div class="loading-spinner" style="padding:40px">加载中...</div>';

  try {
    var cfg = await API.get('/admin/db/backup-config');
    _dbBackupConfig = cfg;
    var backups = await API.get('/admin/db/backups');
    _dbBackups = backups || [];
    var scStatus = await API.get('/admin/db/sqlcipher-status');
    _dbSqlcipherEnabled = scStatus && scStatus.enabled;
  } catch(e) {
    container.innerHTML = '<div class="error-state">加载失败: ' + escHtml(e.message) + '</div>';
    return;
  }

  renderDbManage();
}

function renderDbManage() {
  var html = '<div class="db-manage-grid">';

  // ── Export Section ──
  html += '<div class="config-section">' +
    '<div class="config-section-title">导出数据库</div>' +
    '<div class="config-fields" style="padding:12px 16px">' +
      '<div style="font-size:11.5px;color:var(--muted);margin-bottom:10px">下载当前 PMA 数据库文件（SQLite），可用于备份或迁移。</div>' +
      '<button class="btn btn-primary" onclick="exportDatabase()" style="height:35px;">' +
        '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;vertical-align:middle">' +
          '<path d="M14.5 10.5v3a1 1 0 0 1-1 1h-12a1 1 0 0 1-1-1v-3"/>' +
          '<polyline points="4.5 6.5 8 2.5 11.5 6.5"/>' +
          '<line x1="8" y1="2.5" x2="8" y2="10.5"/>' +
        '</svg>' +
        '导出数据库' +
      '</button>' +
    '</div></div>';

  // ── Import Section ──
  html += '<div class="config-section">' +
    '<div class="config-section-title">导入数据库</div>' +
    '<div class="config-fields" style="padding:12px 16px">' +
      '<div style="font-size:11.5px;color:var(--muted);margin-bottom:8px">上传一个 SQLite 数据库文件（.db）。导入前会自动备份当前数据库。</div>' +
      '<div style="font-size:11px;color:var(--warn);margin-bottom:10px">&#9888; 导入会替换当前全部数据，请确认文件正确后再操作。</div>' +
      '<input type="file" id="db-import-file" accept=".db" style="display:none" onchange="onImportFileSelected(this)">' +
      '<button class="btn btn-primary" onclick="triggerImportFile()" style="height:35px;">' +
        '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;vertical-align:middle">' +
          '<path d="M2.5 10.5v3a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-3"/>' +
          '<polyline points="11.5 6.5 8 10.5 4.5 6.5"/>' +
          '<line x1="8" y1="10.5" x2="8" y2="2.5"/>' +
        '</svg>' +
        '选择文件并导入' +
      '</button>' +
      '<span id="db-import-file-name" style="font-size:11px;color:var(--muted);margin-left:8px"></span>' +
      '<div id="db-import-msg" style="margin-top:8px;font-size:11.5px"></div>' +
    '</div></div>';

  // ── SQLCipher Rekey Section (only when enabled) ──
  if (_dbSqlcipherEnabled) {
    html += '<div class="config-section">' +
      '<div class="config-section-title">修改数据库密码 🔒</div>' +
      '<div class="config-fields" style="padding:12px 16px">' +
        '<div style="font-size:11.5px;color:var(--muted);margin-bottom:10px">更换 SQLCipher 加密数据库的 passphrase。修改后自动更新密钥文件，无需手动操作。</div>' +
        '<div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap">' +
          '<label style="flex:1;min-width:160px">' +
            '<span style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">当前密码</span>' +
            '<input type="password" id="db-rekey-old-pass" placeholder="输入当前 passphrase" style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--fg);font-size:13px;box-sizing:border-box">' +
          '</label>' +
          '<label style="flex:1;min-width:160px">' +
            '<span style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">新密码</span>' +
            '<input type="password" id="db-rekey-new-pass" placeholder="输入新 passphrase（≥8 字符）" style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--fg);font-size:13px;box-sizing:border-box">' +
          '</label>' +
          '<label style="flex:1;min-width:160px">' +
            '<span style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">确认新密码</span>' +
            '<input type="password" id="db-rekey-confirm" placeholder="再次输入新 passphrase" style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--fg);font-size:13px;box-sizing:border-box">' +
          '</label>' +
          '<button class="btn btn-primary" onclick="rekeyDatabase()" style="height:35px;">更换密码</button>' +
        '</div>' +
        '<div id="db-rekey-msg" style="margin-top:8px;font-size:11.5px"></div>' +
        '<div style="font-size:10.5px;color:var(--muted);margin-top:6px">' +
          '密码通过 PBKDF2-HMAC-SHA512（100 万次迭代）派生为 256-bit 密钥。' +
          '修改后密钥文件自动更新，无需手动替换。' +
        '</div>' +
      '</div></div>';
  }

  // ── Auto-Backup Config ──
  var interval = _dbBackupConfig ? _dbBackupConfig.interval_minutes : 0;
  var retention = _dbBackupConfig ? _dbBackupConfig.retention_count : 5;
  html += '<div class="config-section">' +
    '<div class="config-section-title">自动备份配置</div>' +
    '<div class="config-fields" style="padding:12px 16px">' +
      '<div style="display:flex;gap:16px;align-items:flex-end;flex-wrap:wrap">' +
        '<label style="flex:1;min-width:140px">' +
          '<span style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">备份间隔（分钟，0=关闭）</span>' +
          '<input type="number" id="db-backup-interval" value="' + interval + '" min="0" step="5" style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--fg);font-size:13px;box-sizing:border-box">' +
        '</label>' +
        '<label style="flex:1;min-width:140px">' +
          '<span style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">保留备份数量</span>' +
          '<input type="number" id="db-backup-retention" value="' + retention + '" min="1" max="100" style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--fg);font-size:13px;box-sizing:border-box">' +
        '</label>' +
        '<button class="btn btn-primary" onclick="saveBackupConfig()" style="height:35px;">保存配置</button>' +
      '</div>' +
      '<div id="db-backup-cfg-msg" style="margin-top:8px;font-size:11.5px"></div>' +
    '</div></div>';

  // ── Backup History ──
  html += '<div class="config-section" style="grid-column:1/-1">' +
    '<div class="config-section-title">备份历史 <span style="font-size:11px;color:var(--muted);font-weight:400">（共 ' + _dbBackups.length + ' 个）</span></div>';

  if (!_dbBackups.length) {
    html += '<div class="config-fields" style="padding:12px 16px;font-size:12px;color:var(--muted);font-style:italic">暂无备份文件</div>';
  } else {
    html += '<div style="overflow-x:auto;max-height:400px;overflow-y:auto">' +
      '<table class="stage-table" style="font-size:12px;width:100%">' +
        '<thead><tr>' +
          '<th style="width:50px;text-align:center">序号</th><th>文件名</th><th style="width:90px">大小</th><th style="width:160px">时间</th><th style="width:120px">操作</th>' +
        '</tr></thead><tbody>';
    _dbBackups.forEach(function(b, i) {
      html += '<tr>' +
        '<td style="text-align:center;font-family:var(--mono);color:var(--muted);font-size:11px">' + (i + 1) + '</td>' +
        '<td style="font-family:monospace;font-size:11px">' + escHtml(b.name) + '</td>' +
        '<td style="font-size:11px">' + escHtml(b.size_display) + '</td>' +
        '<td style="font-size:11px">' + escHtml(b.created_at) + '</td>' +
        '<td style="white-space:nowrap">' +
          '<button class="btn" style="font-size:10px;padding:3px 8px;margin-right:4px" onclick="restoreBackup(\'' + escHtml(b.name) + '\')" title="恢复到此备份">恢复</button>' +
          '<button class="btn" style="font-size:10px;padding:3px 8px;color:var(--danger)" onclick="deleteBackup(\'' + escHtml(b.name) + '\')" title="删除此备份">删除</button>' +
        '</td>' +
      '</tr>';
    });
    html += '</tbody></table></div>';
  }

  html += '</div></div>';  // .db-manage-grid

  document.getElementById('view-db-manage').innerHTML = html;
}

// ── Actions ──

function exportDatabase() {
  // Inline progress toast — same style as data sync
  var progEl = document.createElement('div');
  progEl.className = 'toast info';
  progEl.style.padding = '6px 14px';
  progEl.style.maxWidth = '480px';
  progEl.id = 'db-export-progress';
  progEl.innerHTML =
    '<div style="display:flex;align-items:center;gap:8px">' +
      '<div class="sync-spinner" style="width:16px;height:16px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;flex-shrink:0"></div>' +
      '<span style="font-size:12px;font-weight:540;white-space:nowrap">正在导出数据库...</span>' +
      '<span style="font-size:11px;color:var(--muted)" id="db-export-elapsed">0s</span>' +
    '</div>';
  document.getElementById('toast-container').appendChild(progEl);

  var startTime = Date.now();
  var elapsedTimer = setInterval(function() {
    var et = document.getElementById('db-export-elapsed');
    if (et) et.textContent = Math.round((Date.now() - startTime) / 1000) + 's';
  }, 1000);

  var token = localStorage.getItem('pma_token');
  if (token) {
    fetch('/api/admin/db/export', {
      headers: { 'Authorization': 'Bearer ' + token }
    }).then(function(res) {
      if (!res.ok) {
        clearInterval(elapsedTimer);
        if (progEl.parentElement) progEl.remove();
        showToast('导出失败: HTTP ' + res.status, 'error');
        return null;
      }
      return res.blob();
    }).then(function(blob) {
      clearInterval(elapsedTimer);
      if (progEl.parentElement) progEl.remove();
      if (!blob) return;
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'pma-backup-' + new Date().toISOString().slice(0,10).replace(/-/g,'') + '-' +
        new Date().toTimeString().slice(0,8).replace(/:/g,'') + '.db';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      var elapsed = Math.round((Date.now() - startTime) / 1000);
      showToast('数据库导出成功（' + elapsed + 's）', 'success');
    }).catch(function(e) {
      clearInterval(elapsedTimer);
      if (progEl.parentElement) progEl.remove();
      showToast('导出失败: ' + (e.message || '网络错误'), 'error');
    });
    return;
  }
  // Fallback: direct link (for non-token environments)
  clearInterval(elapsedTimer);
  if (progEl.parentElement) progEl.remove();
  var a = document.createElement('a');
  a.href = '/api/admin/db/export';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function triggerImportFile() {
  var fileInput = document.getElementById('db-import-file');
  if (fileInput) fileInput.click();
}

function onImportFileSelected(input) {
  var file = input.files && input.files[0];
  if (!file) return;
  if (!file.name.endsWith('.db')) {
    showToast('请选择 .db 格式的 SQLite 数据库文件', 'error');
    input.value = '';
    return;
  }
  document.getElementById('db-import-file-name').textContent = '已选择: ' + file.name;
  importDatabase(file);
}

async function importDatabase(file) {
  if (!file) return;

  if (!confirm('确认导入数据库？\n\n文件: ' + file.name + '\n导入后将替换当前全部数据。系统会自动备份当前数据库后再执行导入。\n导入后请刷新页面以加载新数据。')) {
    document.getElementById('db-import-file').value = '';
    document.getElementById('db-import-file-name').textContent = '';
    return;
  }

  // Inline progress toast
  var progEl = document.createElement('div');
  progEl.className = 'toast info';
  progEl.style.padding = '6px 14px';
  progEl.style.maxWidth = '480px';
  progEl.id = 'db-import-progress';
  progEl.innerHTML =
    '<div style="display:flex;align-items:center;gap:8px">' +
      '<div class="sync-spinner" style="width:16px;height:16px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;flex-shrink:0"></div>' +
      '<span style="font-size:12px;font-weight:540;white-space:nowrap">正在导入数据库...</span>' +
    '</div>';
  document.getElementById('toast-container').appendChild(progEl);

  var startTime = Date.now();
  try {
    var formData = new FormData();
    formData.append('file', file);
    var token = localStorage.getItem('pma_token');
    var res = await fetch('/api/admin/db/import', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
      body: formData,
    });
    var json = await res.json();
    if (progEl.parentElement) progEl.remove();
    if (json.code === 0) {
      var elapsed = Math.round((Date.now() - startTime) / 1000);
      showToast(json.message + '（' + elapsed + 's）', 'success');
      document.getElementById('db-import-file').value = '';
      document.getElementById('db-import-file-name').textContent = '';
      setTimeout(async function() {
        try { _dbBackups = await API.get('/admin/db/backups') || []; renderDbManage(); } catch(e) {}
      }, 500);
    } else {
      showToast('导入失败: ' + json.message, 'error');
    }
  } catch(e) {
    if (progEl.parentElement) progEl.remove();
    showToast('导入失败: ' + (e.message || '网络错误'), 'error');
  }
}

async function saveBackupConfig() {
  var interval = parseInt(document.getElementById('db-backup-interval').value) || 0;
  var retention = parseInt(document.getElementById('db-backup-retention').value) || 5;
  if (interval < 0) interval = 0;
  if (retention < 1) retention = 1;

  var msgEl = document.getElementById('db-backup-cfg-msg');
  msgEl.textContent = '保存中...';
  msgEl.style.color = 'var(--muted)';

  try {
    await API.put('/admin/db/backup-config', {
      interval_minutes: interval,
      retention_count: retention,
    });
    _dbBackupConfig = { interval_minutes: interval, retention_count: retention };
    msgEl.textContent = '已保存';
    msgEl.style.color = 'var(--success)';
    setTimeout(function() { if (msgEl) msgEl.textContent = ''; }, 2000);
  } catch(e) {
    msgEl.textContent = '保存失败: ' + (e.message || '未知错误');
    msgEl.style.color = 'var(--danger)';
  }
}

async function deleteBackup(name) {
  if (!confirm('确认删除备份 ' + name + ' ？')) return;
  try {
    await API.del('/admin/db/backups/' + encodeURIComponent(name));
    _dbBackups = _dbBackups.filter(function(b) { return b.name !== name; });
    renderDbManage();
    showToast('已删除 ' + name, 'success');
  } catch(e) {
    showToast('删除失败: ' + (e.message || '未知错误'), 'error');
  }
}

async function restoreBackup(name) {
  if (!confirm('确认从备份 ' + name + ' 恢复数据库？\n\n当前数据库将被替换为备份的数据。恢复前会自动备份当前数据库。\n恢复后请刷新页面以加载恢复后的数据。')) return;

  // Inline progress toast
  var progEl = document.createElement('div');
  progEl.className = 'toast info';
  progEl.style.padding = '6px 14px';
  progEl.style.maxWidth = '480px';
  progEl.id = 'db-restore-progress';
  progEl.innerHTML =
    '<div style="display:flex;align-items:center;gap:8px">' +
      '<div class="sync-spinner" style="width:16px;height:16px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;flex-shrink:0"></div>' +
      '<span style="font-size:12px;font-weight:540;white-space:nowrap">正在恢复数据库...</span>' +
    '</div>';
  document.getElementById('toast-container').appendChild(progEl);

  var startTime = Date.now();
  try {
    await API.post('/admin/db/backups/' + encodeURIComponent(name) + '/restore');
    if (progEl.parentElement) progEl.remove();
    var elapsed = Math.round((Date.now() - startTime) / 1000);
    showToast('恢复成功（' + elapsed + 's）', 'success');
    setTimeout(async function() {
      try { _dbBackups = await API.get('/admin/db/backups') || []; renderDbManage(); } catch(e) {}
    }, 500);
  } catch(e) {
    if (progEl.parentElement) progEl.remove();
    showToast('恢复失败: ' + (e.message || '未知错误'), 'error');
  }
}

async function rekeyDatabase() {
  var oldPass = document.getElementById('db-rekey-old-pass').value;
  var newPass = document.getElementById('db-rekey-new-pass').value;
  var confirmPass = document.getElementById('db-rekey-confirm').value;
  var msgEl = document.getElementById('db-rekey-msg');

  if (!oldPass) { msgEl.textContent = '请输入当前密码'; msgEl.style.color = 'var(--danger)'; return; }
  if (newPass.length < 8) { msgEl.textContent = '新密码至少需要 8 个字符'; msgEl.style.color = 'var(--danger)'; return; }
  if (newPass !== confirmPass) { msgEl.textContent = '两次输入的新密码不一致'; msgEl.style.color = 'var(--danger)'; return; }
  if (oldPass === newPass) { msgEl.textContent = '新旧密码相同，无需更换'; msgEl.style.color = 'var(--muted)'; return; }

  if (!confirm('确认更换数据库密码？\n\n更换完成后密钥文件将自动更新。请务必记住新密码，丢失后数据库将无法解密。')) return;

  // Inline progress toast
  var progEl = document.createElement('div');
  progEl.className = 'toast info';
  progEl.style.padding = '6px 14px';
  progEl.style.maxWidth = '480px';
  progEl.innerHTML =
    '<div style="display:flex;align-items:center;gap:8px">' +
      '<div class="sync-spinner" style="width:16px;height:16px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;flex-shrink:0"></div>' +
      '<span style="font-size:12px;font-weight:540;white-space:nowrap">正在更换密码...</span>' +
    '</div>';
  document.getElementById('toast-container').appendChild(progEl);

  var startTime = Date.now();
  try {
    await API.post('/admin/db/rekey', {
      old_passphrase: oldPass,
      new_passphrase: newPass,
    });
    if (progEl.parentElement) progEl.remove();
    var elapsed = Math.round((Date.now() - startTime) / 1000);
    showToast('数据库密码已更换（' + elapsed + 's）', 'success');
    document.getElementById('db-rekey-old-pass').value = '';
    document.getElementById('db-rekey-new-pass').value = '';
    document.getElementById('db-rekey-confirm').value = '';
  } catch(e) {
    if (progEl.parentElement) progEl.remove();
    showToast('更换密码失败: ' + (e.message || '未知错误'), 'error');
  }
}
