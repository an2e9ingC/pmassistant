/* ═══════════════════════════════════════════════════
   DB MANAGE — Export / Import / Backup Config
═══════════════════════════════════════════════════ */

var _dbBackupConfig = null;
var _dbBackups = [];
var _dbSqlcipherEnabled = false;
var _dbRemoteBackupConfig = null;
var _dbRemoteBackups = [];
var _dbManageContainerId = 'view-db-manage';

async function initDbManage(containerId) {
  if (containerId) _dbManageContainerId = containerId;
  var container = document.getElementById(_dbManageContainerId);
  if (!container) return;
  container.innerHTML = '<div class="loading-spinner" style="padding:40px">加载中...</div>';

  try {
    var cfg = await API.get('/admin/db/backup-config');
    _dbBackupConfig = cfg;
    var backups = await API.get('/admin/db/backups');
    _dbBackups = backups || [];
    var scStatus = await API.get('/admin/db/sqlcipher-status');
    _dbSqlcipherEnabled = scStatus && scStatus.enabled;
    var rcfg = await API.get('/admin/db/remote-backup-config');
    _dbRemoteBackupConfig = rcfg || {};
    var rbacks = await API.get('/admin/db/remote-backups');
    _dbRemoteBackups = (rbacks && rbacks.files) ? rbacks.files : [];
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
  var keepHours = (_dbBackupConfig && _dbBackupConfig.keep_interval_hours) ? _dbBackupConfig.keep_interval_hours : 0;
  var maxPermanent = (_dbBackupConfig && _dbBackupConfig.max_permanent_count) ? _dbBackupConfig.max_permanent_count : 10;
  html += '<div class="config-section">' +
    '<div class="config-section-title">自动备份配置</div>' +
    '<div class="config-fields" style="padding:12px 16px">' +
      // Row 1: Rolling backup settings
      '<div style="font-size:11px;color:var(--muted);font-weight:540;margin-bottom:6px">滚动备份（hotback）</div>' +
      '<div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;margin-bottom:14px">' +
        '<label style="flex:1;min-width:160px">' +
          '<span style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">备份间隔（分钟，0=关闭）</span>' +
          '<input type="number" id="db-backup-interval" value="' + interval + '" min="0" step="5" style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--fg);font-size:13px;box-sizing:border-box;height:35px">' +
        '</label>' +
        '<label style="flex:1;min-width:160px">' +
          '<span style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">保留数量（超出自动删除）</span>' +
          '<input type="number" id="db-backup-retention" value="' + retention + '" min="1" max="100" style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--fg);font-size:13px;box-sizing:border-box;height:35px">' +
        '</label>' +
      '</div>' +
      // Row 2: Permanent backup settings
      '<div style="font-size:11px;color:var(--muted);font-weight:540;margin-bottom:6px">永久备份（permanent）— 同时控制远端同步</div>' +
      '<div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;margin-bottom:14px">' +
        '<label style="flex:1;min-width:160px">' +
          '<span style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">保存间隔（小时，0=关闭）</span>' +
          '<input type="number" id="db-backup-keep-hours" value="' + keepHours + '" min="0" step="1" style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--fg);font-size:13px;box-sizing:border-box;height:35px">' +
        '</label>' +
        '<label style="flex:1;min-width:160px">' +
          '<span style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">最大保留数量（超出自动删除）</span>' +
          '<input type="number" id="db-backup-max-permanent" value="' + maxPermanent + '" min="1" max="100" style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--fg);font-size:13px;box-sizing:border-box;height:35px">' +
        '</label>' +
      '</div>' +
      // Hint + save button
      '<div style="display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap">' +
        '<div style="flex:1;min-width:0;font-size:10.5px;color:var(--muted);line-height:1.4">' +
          '滚动备份保存在 <code>data/backups/hotback/</code>，按保留数量自动滚动删除。<br>' +
          '永久备份保存在 <code>data/backups/permanent/</code>（含数据库、配置、附件），不会被滚动清理删除，且会自动同步到远端 NAS。' +
        '</div>' +
        '<button class="btn btn-primary" onclick="saveBackupConfig()" style="height:35px;flex-shrink:0">保存配置</button>' +
      '</div>' +
    '</div></div>';

  // ── Remote Backup Config ──
  var rcfg = _dbRemoteBackupConfig || {};
  var rEnabled = rcfg.enabled;
  var rType = rcfg.remote_type || 'nas';
  var rPath = rcfg.remote_path || '';
  var rUser = rcfg.remote_username || '';
  var rHasPwd = rcfg.has_password;
  html += '<div class="config-section">' +
    '<div class="config-section-title">远端备份配置</div>' +
    '<div class="config-fields" style="padding:12px 16px">' +

    // Enable toggle
    '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">' +
      '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px">' +
        '<input type="checkbox" id="db-remote-backup-enabled" ' + (rEnabled ? 'checked' : '') + ' onchange="onRemoteEnabledToggle()">' +
        '启用远端备份同步' +
      '</label>' +
      '<span style="font-size:10.5px;color:var(--muted)">在每次自动备份后将文件同步到远端服务器</span>' +
    '</div>' +

    // Config rows (hidden when disabled)
    '<div id="db-remote-config-rows" style="display:' + (rEnabled ? 'block' : 'none') + '">' +

      // Type selector
      '<div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;margin-bottom:10px">' +
        '<label style="flex:1;min-width:120px">' +
          '<span style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">远端类型</span>' +
          '<select id="db-remote-type" onchange="onRemoteTypeChange()" style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--fg);font-size:13px;box-sizing:border-box;height:35px">' +
            '<option value="nas" ' + (rType === 'nas' ? 'selected' : '') + '>NAS（网络存储）</option>' +
            '<option value="svn" ' + (rType === 'svn' ? 'selected' : '') + '>SVN（即将支持）</option>' +
          '</select>' +
        '</label>' +
        '<label style="flex:3;min-width:260px">' +
          '<span style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">远端路径</span>' +
          '<input type="text" id="db-remote-path" value="' + escHtml(rPath) + '" placeholder="NAS 路径，如 //192.168.0.180/PMABackup 或 /mnt/nas-backup" style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--fg);font-size:13px;box-sizing:border-box;height:35px">' +
        '</label>' +
      '</div>' +

      // SVN hint
      '<div id="db-remote-svn-hint" style="display:' + (rType === 'svn' ? 'block' : 'none') + ';font-size:11px;color:var(--warn);margin-bottom:10px">' +
        '&#9888; SVN 远端备份功能即将支持，当前请先使用 NAS 方式。' +
      '</div>' +

      // NAS credentials (only for NAS type)
      '<div id="db-remote-nas-credentials" style="display:' + (rType === 'nas' ? 'block' : 'none') + '">' +
        '<div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;margin-bottom:10px">' +
          '<label style="flex:1;min-width:140px">' +
            '<span style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">用户名</span>' +
            '<input type="text" id="db-remote-username" value="' + escHtml(rUser) + '" placeholder="SMB 共享用户名" style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--fg);font-size:13px;box-sizing:border-box;height:35px">' +
          '</label>' +
          '<label style="flex:1;min-width:140px">' +
            '<span style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">密码</span>' +
            '<div style="display:flex;align-items:stretch">' +
              '<input type="password" id="db-remote-password" value="" placeholder="' + (rHasPwd ? '密码已设置（留空不修改）' : 'SMB 共享密码') + '" style="flex:1;padding:6px 10px;border:1px solid var(--border);border-radius:6px 0 0 6px;background:var(--bg);color:var(--fg);font-size:13px;box-sizing:border-box;height:35px;min-width:0">' +
              '<button type="button" class="btn-icon" onclick="togglePwdVisibility(\'db-remote-password\', this)" title="显示/隐藏密码" style="height:35px;width:35px;border-radius:0 6px 6px 0;border:1px solid var(--border);border-left:none;background:var(--bg);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0">' +
                '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
                  '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>' +
                  '<circle cx="12" cy="12" r="3"/>' +
                '</svg>' +
              '</button>' +
            '</div>' +
          '</label>' +
        '</div>' +
        '<div style="font-size:10.5px;color:var(--muted);margin-bottom:4px">' +
          '本地路径（<code>/mnt/...</code>）直接复制，需先将 NAS 挂载到本地；SMB 直连（<code>//server/share</code>）需安装 smbclient。' +
        '</div>' +
      '</div>' +

      // Test button — inside config rows (only relevant when fields are visible)
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end">' +
        '<button class="btn btn-outline" onclick="testRemoteConnection()" id="db-remote-test-btn" style="height:35px;" ' + (rType === 'svn' ? 'disabled title="SVN 暂不支持连接测试"' : '') + '>测试连接</button>' +
      '</div>' +
    '</div>' +  // #db-remote-config-rows

    // Save button — always visible (outside toggle), so user can save "disabled" state
    '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end;margin-top:8px">' +
      '<button class="btn btn-primary" onclick="saveRemoteBackupConfig()" style="height:35px;">保存配置</button>' +
    '</div>' +

    '</div></div>';

  // ── Backup History ──
  // Sort state per table (persisted across renders)
  if (typeof _dbLocalSortCol === 'undefined') _dbLocalSortCol = 'created_at';
  if (typeof _dbLocalSortDir === 'undefined') _dbLocalSortDir = 'desc';
  if (typeof _dbRemoteSortCol === 'undefined') _dbRemoteSortCol = 'created_at';
  if (typeof _dbRemoteSortDir === 'undefined') _dbRemoteSortDir = 'desc';
  if (typeof _dbFileTypeFilter === 'undefined') _dbFileTypeFilter = '';

  var TYPE_LABELS = { 'db': '数据库', 'env': '配置文件 .env', 'uploads': '附件包' };

  var rEnabled = (_dbRemoteBackupConfig && _dbRemoteBackupConfig.enabled);
  var rPath = (_dbRemoteBackupConfig && _dbRemoteBackupConfig.remote_path) || '';
  var rType = (_dbRemoteBackupConfig && _dbRemoteBackupConfig.remote_type) || '';

  html += '<div class="config-section" style="grid-column:1/-1">' +
    '<div class="config-section-title">备份历史</div>';

  // ── Shared toolbar for both tables ──
  html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">' +
    '<span style="font-size:12px;font-weight:540">备份历史</span>' +
    '<button class="btn btn-xs" onclick="backupNow()" title="立即执行一次备份">' +
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:2px"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>立即备份' +
    '</button>' +
    (rEnabled && rType === 'nas' ? '<button class="btn btn-xs" onclick="syncAllToRemote()" title="同步所有未同步的本地备份到远端">' +
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:2px"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>全部同步到远端' +
    '</button>' : '') +
    '<select onchange="_dbFileTypeFilter=this.value;renderDbManage()" style="margin-left:auto;padding:3px 8px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--fg);font-size:11px">' +
      '<option value="">全部类型</option>' +
      '<option value="hotback-db"' + (_dbFileTypeFilter === 'hotback-db' ? ' selected' : '') + '>热备份 — 数据库</option>' +
      '<option value="hotback-env"' + (_dbFileTypeFilter === 'hotback-env' ? ' selected' : '') + '>热备份 — .env 配置</option>' +
      '<option value="hotback-uploads"' + (_dbFileTypeFilter === 'hotback-uploads' ? ' selected' : '') + '>热备份 — 附件包</option>' +
      '<option value="permanent-db"' + (_dbFileTypeFilter === 'permanent-db' ? ' selected' : '') + '>永久备份 — 数据库</option>' +
      '<option value="permanent-env"' + (_dbFileTypeFilter === 'permanent-env' ? ' selected' : '') + '>永久备份 — .env 配置</option>' +
      '<option value="permanent-uploads"' + (_dbFileTypeFilter === 'permanent-uploads' ? ' selected' : '') + '>永久备份 — 附件包</option>' +
    '</select>' +
  '</div>';

  // ── Two tables side by side ──
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">';

  // ── Local backups table ──
  html += '<div>' +
    '<div style="font-size:11px;color:var(--muted);font-weight:540;margin-bottom:4px">本地备份（共 ' + _dbBackups.length + ' 个）</div>';
  if (!_dbBackups.length) {
    html += '<div class="card card-pad" style="font-size:12px;color:var(--muted);font-style:italic">暂无备份文件</div>';
  } else {
    html += '<div class="card" style="padding:0;max-height:360px;overflow:auto"><div id="db-backup-table"></div></div>';
  }
  html += '</div>';

  // ── Remote backups table ──
  html += '<div>' +
    '<div style="font-size:11px;color:var(--muted);font-weight:540;margin-bottom:4px">远端备份（共 ' + _dbRemoteBackups.length + ' 个）' +
      (rPath ? ' — ' + escHtml(rPath) : '') + '</div>';
  if (!rEnabled) {
    html += '<div class="card card-pad" style="font-size:12px;color:var(--muted);font-style:italic">远端备份未启用，请在配置中启用</div>';
  } else if (rType === 'svn') {
    html += '<div class="card card-pad" style="font-size:12px;color:var(--warn);font-style:italic">SVN 暂不支持</div>';
  } else if (!_dbRemoteBackups.length) {
    html += '<div class="card card-pad" style="font-size:12px;color:var(--muted);font-style:italic">暂无远端备份文件</div>';
  } else {
    html += '<div class="card" style="padding:0;max-height:360px;overflow:auto"><div id="db-remote-backup-table"></div></div>';
  }
  html += '</div>';

  html += '</div></div></div>';  // grid + section + .db-manage-grid

  document.getElementById(_dbManageContainerId).innerHTML = html;

  // Render tables
  _renderLocalBackupTable(TYPE_LABELS);
  _renderRemoteBackupTable(TYPE_LABELS);
}

// ── Backup Table Renderers ──

function _sortBackups(list, col, dir) {
  return list.slice().sort(function(a, b) {
    var av = a[col] || '', bv = b[col] || '';
    if (col === 'size') { av = Number(av) || 0; bv = Number(bv) || 0; }
    var cmp = av < bv ? -1 : (av > bv ? 1 : 0);
    return dir === 'asc' ? cmp : -cmp;
  });
}

function _filterBackups(list, typeFilter) {
  if (!typeFilter) return list;
  // Format: "hotback-db", "permanent-env", etc.
  var parts = typeFilter.split('-');
  var dirFilter = parts[0];   // "hotback" or "permanent"
  var typeFilterVal = parts[1]; // "db", "env", or "uploads"
  return list.filter(function(item) {
    var dirMatch = dirFilter === 'hotback' ? !item.permanent : item.permanent;
    var typeMatch = item.file_type === typeFilterVal;
    return dirMatch && typeMatch;
  });
}

function _sortHeader(label, col, table) {
  // table: 'local' or 'remote' — each table has independent sort state
  var sortColVar = table === 'local' ? '_dbLocalSortCol' : '_dbRemoteSortCol';
  var sortDirVar = table === 'local' ? '_dbLocalSortDir' : '_dbRemoteSortDir';
  var arrow = '';
  if (window[sortColVar] === col) {
    arrow = window[sortDirVar] === 'asc' ? ' &#9650;' : ' &#9660;';
  }
  // Check OLD column before setting new — new column defaults to asc (Excel convention)
  return '<span style="cursor:pointer;user-select:none" onclick="' + sortDirVar + '=(' + sortColVar + '===\'' + col + '\'&&' + sortDirVar + '===\'asc\')?\'desc\':\'asc\';' + sortColVar + '=\'' + col + '\';renderDbManage()" title="点击排序">' + label + arrow + '</span>';
}

function _renderLocalBackupTable(TYPE_LABELS) {
  var container = document.getElementById('db-backup-table');
  if (!container) return;

  var filtered = _filterBackups(_dbBackups, _dbFileTypeFilter);
  var sorted = _sortBackups(filtered, _dbLocalSortCol, _dbLocalSortDir);

  // Calculate sync stats for summary
  var syncedCount = _dbBackups.filter(function(b) { return b.sync_status === 'synced'; }).length;

  var h = '<table style="width:100%;border-collapse:collapse;font-size:11px">' +
    '<thead><tr style="position:sticky;top:0;background:var(--bg);z-index:1">' +
      '<th style="padding:6px 8px;border-bottom:1px solid var(--border);text-align:center;width:36px;color:var(--muted)">#</th>' +
      '<th style="padding:6px 8px;border-bottom:1px solid var(--border);text-align:left">' + _sortHeader('数据类型', 'file_type', 'local') + '</th>' +
      '<th style="padding:6px 8px;border-bottom:1px solid var(--border);text-align:left">文件名</th>' +
      '<th style="padding:6px 8px;border-bottom:1px solid var(--border);text-align:right;width:70px">' + _sortHeader('大小', 'size', 'local') + '</th>' +
      '<th style="padding:6px 8px;border-bottom:1px solid var(--border);text-align:left;width:135px">' + _sortHeader('备份时间', 'created_at', 'local') + '</th>' +
      '<th style="padding:6px 8px;border-bottom:1px solid var(--border);text-align:center;width:80px">远端状态</th>' +
      '<th style="padding:6px 8px;border-bottom:1px solid var(--border);text-align:center;width:120px">操作</th>' +
    '</tr></thead><tbody>';

  if (!sorted.length) {
    h += '<tr><td colspan="7" style="padding:16px;text-align:center;color:var(--muted);font-style:italic">' +
      (_dbFileTypeFilter ? '无匹配类型的备份文件' : '暂无备份文件') + '</td></tr>';
  } else {
    for (var i = 0; i < sorted.length; i++) {
      var row = sorted[i];
      var typeLabel = TYPE_LABELS[row.file_type] || row.file_type;
      var typeBadge = '<span style="font-size:10px;padding:1px 5px;border-radius:3px;' +
        (row.file_type === 'db' ? 'background:var(--accent-lt);color:var(--accent)' :
         row.file_type === 'env' ? 'background:var(--warn-lt);color:var(--warn)' :
         'background:var(--muted-lt);color:var(--muted)') + '">' + typeLabel + '</span>';
      var permBadge = row.permanent ? ' <span style="font-size:9px;padding:1px 4px;border-radius:3px;background:var(--success-lt);color:var(--success)">永久</span>' : '';
      var syncBadge = row.sync_status === 'synced'
        ? '<span style="font-size:10px;padding:1px 6px;border-radius:3px;background:var(--success-lt);color:var(--success)">已同步</span>'
        : '<span style="font-size:10px;padding:1px 6px;border-radius:3px;background:var(--muted-lt);color:var(--muted)">未同步</span>';
      var canSync = true;

      h += '<tr style="' + (row.permanent ? 'background:var(--accent-lt)' : '') + '">' +
        '<td style="padding:4px 8px;border-bottom:1px solid var(--border);text-align:center;color:var(--muted);font-family:var(--mono)">' + (i + 1) + '</td>' +
        '<td style="padding:4px 8px;border-bottom:1px solid var(--border)">' + typeBadge + '</td>' +
        '<td style="padding:4px 8px;border-bottom:1px solid var(--border);font-family:monospace;font-size:10.5px;word-break:break-all">' + escHtml(row.name) + permBadge + '</td>' +
        '<td style="padding:4px 8px;border-bottom:1px solid var(--border);text-align:right">' + escHtml(row.size_display) + '</td>' +
        '<td style="padding:4px 8px;border-bottom:1px solid var(--border);font-size:10.5px">' + escHtml(fmtISODateTime(row.created_at) || row.created_at) + '</td>' +
        '<td style="padding:4px 8px;border-bottom:1px solid var(--border);text-align:center">' + syncBadge + '</td>' +
        '<td style="padding:4px 8px;border-bottom:1px solid var(--border);text-align:center;white-space:nowrap">' +
          (canSync ? iconSync('syncSingleToRemote(\'' + escHtml(row.name) + '\')', '同步到远端') : '') +
          iconRestore('restoreBackup(\'' + escHtml(row.name) + '\')', '恢复') +
          iconDelete('deleteBackup(\'' + escHtml(row.name) + '\')', '删除') +
        '</td>' +
        '</tr>';
    }
  }
  h += '</tbody></table>';
  container.innerHTML = h;
}

function _renderRemoteBackupTable(TYPE_LABELS) {
  var container = document.getElementById('db-remote-backup-table');
  if (!container) return;

  // Remote backups use independent sort state (separate from local)
  var filtered = _filterBackups(_dbRemoteBackups, _dbFileTypeFilter);
  var sorted = _sortBackups(filtered, _dbRemoteSortCol, _dbRemoteSortDir);

  var h = '<table style="width:100%;border-collapse:collapse;font-size:11px">' +
    '<thead><tr style="position:sticky;top:0;background:var(--bg);z-index:1">' +
      '<th style="padding:6px 8px;border-bottom:1px solid var(--border);text-align:center;width:36px;color:var(--muted)">#</th>' +
      '<th style="padding:6px 8px;border-bottom:1px solid var(--border);text-align:left">' + _sortHeader('数据类型', 'file_type', 'remote') + '</th>' +
      '<th style="padding:6px 8px;border-bottom:1px solid var(--border);text-align:left">文件名</th>' +
      '<th style="padding:6px 8px;border-bottom:1px solid var(--border);text-align:right;width:70px">' + _sortHeader('大小', 'size', 'remote') + '</th>' +
      '<th style="padding:6px 8px;border-bottom:1px solid var(--border);text-align:left;width:135px">' + _sortHeader('备份时间', 'created_at', 'remote') + '</th>' +
      '<th style="padding:6px 8px;border-bottom:1px solid var(--border);text-align:center;width:80px">操作</th>' +
    '</tr></thead><tbody>';

  if (!sorted.length) {
    h += '<tr><td colspan="6" style="padding:16px;text-align:center;color:var(--muted);font-style:italic">' +
      (_dbFileTypeFilter ? '无匹配类型的远端备份' : '暂无远端备份文件') + '</td></tr>';
  } else {
    for (var i = 0; i < sorted.length; i++) {
      var row = sorted[i];
      var typeLabel = TYPE_LABELS[row.file_type] || row.file_type;
      var typeBadge = '<span style="font-size:10px;padding:1px 5px;border-radius:3px;' +
        (row.file_type === 'db' ? 'background:var(--accent-lt);color:var(--accent)' :
         row.file_type === 'env' ? 'background:var(--warn-lt);color:var(--warn)' :
         'background:var(--muted-lt);color:var(--muted)') + '">' + typeLabel + '</span>';
      var permBadge = row.permanent ? ' <span style="font-size:9px;padding:1px 4px;border-radius:3px;background:var(--success-lt);color:var(--success)">永久</span>' : '';

      h += '<tr style="' + (row.permanent ? 'background:var(--accent-lt)' : '') + '">' +
        '<td style="padding:4px 8px;border-bottom:1px solid var(--border);text-align:center;color:var(--muted);font-family:var(--mono)">' + (i + 1) + '</td>' +
        '<td style="padding:4px 8px;border-bottom:1px solid var(--border)">' + typeBadge + '</td>' +
        '<td style="padding:4px 8px;border-bottom:1px solid var(--border);font-family:monospace;font-size:10.5px;word-break:break-all">' + escHtml(row.name) + permBadge + '</td>' +
        '<td style="padding:4px 8px;border-bottom:1px solid var(--border);text-align:right">' + escHtml(row.size_display) + '</td>' +
        '<td style="padding:4px 8px;border-bottom:1px solid var(--border);font-size:10.5px">' + escHtml(fmtISODateTime(row.created_at) || row.created_at || '') + '</td>' +
        '<td style="padding:4px 8px;border-bottom:1px solid var(--border);text-align:center;white-space:nowrap">' +
          iconRestore('restoreRemoteBackup(\'' + escHtml(row.name) + '\')', '恢复到本地') +
          iconDelete('deleteRemoteBackup(\'' + escHtml(row.name) + '\')', '删除') +
        '</td>' +
        '</tr>';
    }
  }
  h += '</tbody></table>';
  container.innerHTML = h;
}

// ── Actions ──

function backupNow() {
  showToast('正在执行备份...', 'info');
  API.post('/admin/db/backup-now')
    .then(function() {
      showToast('备份完成', 'success');
      initDbManage();
    })
    .catch(function(e) {
      showToast('备份失败: ' + (e.message || '未知错误'), 'error');
    });
}

function syncAllToRemote() {
  if (!confirm('确认将所有未同步的本地备份同步到远端？')) return;
  showToast('正在批量同步到远端...', 'info');
  API.post('/admin/db/sync-all-to-remote')
    .then(function(res) {
      var msg = (res && res.message) || '同步完成';
      showToast(msg, 'success');
      initDbManage();
    })
    .catch(function(e) {
      showToast('批量同步失败: ' + (e.message || '未知错误'), 'error');
    });
}

function syncSingleToRemote(name) {
  if (!confirm('确认将 ' + name + ' 同步到远端？')) return;
  showToast('正在同步 ' + name + ' ...', 'info');
  API.post('/admin/db/backups/' + encodeURIComponent(name) + '/sync-to-remote')
    .then(function() {
      showToast(name + ' 已同步到远端', 'success');
      // Reload both lists
      initDbManage();
    })
    .catch(function(e) {
      showToast('同步失败: ' + (e.message || '未知错误'), 'error');
    });
}

function deleteRemoteBackup(name) {
  if (!confirm('确认删除远端备份 ' + name + ' ？')) return;
  API.del('/admin/db/remote-backups/' + encodeURIComponent(name))
    .then(function() {
      showToast('已删除远端备份 ' + name, 'success');
      initDbManage();
    })
    .catch(function(e) {
      showToast('删除失败: ' + (e.message || '未知错误'), 'error');
    });
}

function restoreRemoteBackup(name) {
  var isDb = name.endsWith('.db');
  var msg = isDb
    ? '确认从远端恢复 ' + name + ' ？\n\n服务器将自动重启，所有用户将被登出。'
    : '确认从远端下载 ' + name + ' 到本地备份目录？';
  if (!confirm(msg)) return;

  if (isDb) {
    // Double confirm for DB restore
    verifyPassword('从远端恢复数据库: ' + name, 'pw_verify_db_restore').then(function(ok) {
      if (!ok) return;
      _doRestoreRemote(name);
    }).catch(function() {});
  } else {
    _doRestoreRemote(name);
  }
}

function _doRestoreRemote(name) {
  showToast('正在从远端恢复 ' + name + ' ...', 'info');
  API.post('/admin/db/remote-backups/' + encodeURIComponent(name) + '/restore')
    .then(function() {
      showToast(name + ' 已从远端恢复', 'success');
      setTimeout(function() { initDbManage(); }, 500);
    })
    .catch(function(e) {
      showToast('恢复失败: ' + (e.message || '未知错误'), 'error');
    });
}

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
      a.download = 'pma-backup-' + fmtLocalDate().replace(/-/g,'') + '-' +
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
  var keepHours = parseInt(document.getElementById('db-backup-keep-hours').value) || 0;
  var maxPermanent = parseInt(document.getElementById('db-backup-max-permanent').value) || 10;
  if (interval < 0) interval = 0;
  if (retention < 1) retention = 1;
  if (keepHours < 0) keepHours = 0;
  if (maxPermanent < 1) maxPermanent = 1;

  showToast('正在保存备份配置...', 'info');

  try {
    await API.put('/admin/db/backup-config', {
      interval_minutes: interval,
      retention_count: retention,
      keep_interval_hours: keepHours,
      max_permanent_count: maxPermanent,
    });
    _dbBackupConfig = { interval_minutes: interval, retention_count: retention, keep_interval_hours: keepHours, max_permanent_count: maxPermanent };
    showToast('备份配置已保存', 'success');
  } catch(e) {
    showToast('保存备份配置失败: ' + (e.message || '未知错误'), 'error');
  }
}

async function deleteBackup(name) {
  if (!confirm('确认删除备份 ' + name + ' ？')) return;
  var ok = await verifyPassword('删除备份: ' + name, 'pw_verify_db_delete_backup');
  if (!ok) return;
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
  // Double confirmation: native confirm + type-to-confirm
  if (!confirm('确认从备份 ' + name + ' 恢复数据库？\n\n当前数据库将被替换为备份的数据。恢复前会自动备份当前数据库。\n恢复后服务器将自动重启，所有用户将被登出。')) return;

  // Type-to-confirm using existing verifyPassword pattern
  try {
    var confirmed = await verifyPassword('恢复数据库: ' + name, 'pw_verify_db_restore');
    if (!confirmed) return;
  } catch(e) { return; }

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

// ── Remote Backup Config Actions ──

async function togglePwdVisibility(inputId, btn) {
  var input = document.getElementById(inputId);
  if (!input) return;

  // If field is empty but password is saved, fetch actual password from backend first
  if (!input.value && _dbRemoteBackupConfig && _dbRemoteBackupConfig.has_password) {
    btn.disabled = true;
    try {
      var res = await API.get('/admin/db/remote-backup-config/password');
      if (res && res.password) {
        input.value = res.password;
      }
    } catch(e) {
      showToast('无法获取已保存的密码', 'error');
      btn.disabled = false;
      return;
    }
    btn.disabled = false;
  }

  var isPassword = input.type === 'password';
  input.type = isPassword ? 'text' : 'password';
  // Toggle icon: eye (closed) vs eye-off (open)
  var svg = btn.querySelector('svg');
  if (isPassword) {
    // Was password → now text, show eye-off (open) icon
    svg.innerHTML = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="m14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>';
  } else {
    // Was text → now password, show eye (closed) icon
    svg.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
  }
}

function onRemoteEnabledToggle() {
  var checked = document.getElementById('db-remote-backup-enabled').checked;
  var rows = document.getElementById('db-remote-config-rows');
  if (rows) rows.style.display = checked ? 'block' : 'none';
}

function onRemoteTypeChange() {
  var type = document.getElementById('db-remote-type').value;
  var svnHint = document.getElementById('db-remote-svn-hint');
  var nasCreds = document.getElementById('db-remote-nas-credentials');
  var testBtn = document.getElementById('db-remote-test-btn');
  var syncBtn = document.getElementById('db-remote-sync-btn');

  if (svnHint) svnHint.style.display = type === 'svn' ? 'block' : 'none';
  if (nasCreds) nasCreds.style.display = type === 'nas' ? 'block' : 'none';

  if (testBtn) {
    testBtn.disabled = type === 'svn';
    testBtn.title = type === 'svn' ? 'SVN 暂不支持连接测试' : '';
  }
}

async function saveRemoteBackupConfig() {
  var enabled = document.getElementById('db-remote-backup-enabled').checked;
  var remoteType = document.getElementById('db-remote-type').value;
  var remotePath = document.getElementById('db-remote-path').value.trim();
  var remoteUsername = document.getElementById('db-remote-username').value.trim();
  var remotePassword = document.getElementById('db-remote-password').value;
  // Preserve existing has_password if user didn't type a new password
  var prevHasPwd = _dbRemoteBackupConfig && _dbRemoteBackupConfig.has_password;

  showToast('正在保存远端备份配置...', 'info');

  try {
    var payload = {
      enabled: enabled,
      remote_type: remoteType,
      remote_path: remotePath,
      remote_username: remoteUsername,
      remote_password: remotePassword,
    };
    await API.put('/admin/db/remote-backup-config', payload);
    _dbRemoteBackupConfig = {
      enabled: enabled,
      remote_type: remoteType,
      remote_path: remotePath,
      remote_username: remoteUsername,
      has_password: !!remotePassword || prevHasPwd,
    };
    showToast('远端备份配置已保存', 'success');

    // Re-render to update button states
    renderDbManage();
  } catch(e) {
    showToast('保存远端备份配置失败: ' + (e.message || '未知错误'), 'error');
  }
}

async function testRemoteConnection() {
  showToast('正在测试远端连接...', 'info');

  try {
    await API.post('/admin/db/remote-backup/test');
    try { _dbRemoteBackupConfig = await API.get('/admin/db/remote-backup-config'); } catch(e) {}
    showToast('远端连接测试成功', 'success');
  } catch(e) {
    showToast('远端连接测试失败: ' + (e.message || '未知错误'), 'error');
  }
}

async function syncToRemoteNow() {
  // Inline progress toast
  var progEl = document.createElement('div');
  progEl.className = 'toast info';
  progEl.style.padding = '6px 14px';
  progEl.style.maxWidth = '480px';
  progEl.innerHTML =
    '<div style="display:flex;align-items:center;gap:8px">' +
      '<div class="sync-spinner" style="width:16px;height:16px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;flex-shrink:0"></div>' +
      '<span style="font-size:12px;font-weight:540;white-space:nowrap">正在同步到远端...</span>' +
    '</div>';
  document.getElementById('toast-container').appendChild(progEl);

  var startTime = Date.now();
  try {
    var res = await API.post('/admin/db/remote-backup/sync-now');
    if (progEl.parentElement) progEl.remove();
    var elapsed = Math.round((Date.now() - startTime) / 1000);
    var syncCount = (res && res.synced) ? res.synced.length : 0;
    var failedCount = (res && res.failed) ? res.failed.length : 0;
    var detail = syncCount > 0 ? syncCount + ' 个文件' : '';
    if (failedCount > 0) detail += '，' + failedCount + ' 个失败';
    showToast('远端同步: ' + (detail || '已完成') + '（' + elapsed + 's）', 'success');
  } catch(e) {
    if (progEl.parentElement) progEl.remove();
    showToast('远端同步失败: ' + (e.message || '未知错误'), 'error');
  }
}
