/* ═══════════════════════════════════════════════════
   SYSTEM MANAGE — Unified admin page with 3 tabs:
   1. 数据库管理  2. 数据源管理  3. 上传管理
═══════════════════════════════════════════════════ */

var _sysActiveTab = 'db';
var _sysPanelsLoaded = {};
var _sysTargetTab = null;

// Valid tab names for URL routing
var _SYS_TABS = ['db', 'config', 'settings', 'uploads'];

async function initSystemManage(tabParam) {
  // Accept tab from URL hash param (e.g. #/system-manage/config → tabParam='config')
  if (tabParam && _SYS_TABS.indexOf(tabParam) >= 0) {
    _sysTargetTab = tabParam;
  }

  var container = document.getElementById('view-system-manage');
  if (!container) return;

  container.innerHTML = '<div class="loading-spinner" style="padding:40px">加载中...</div>';

  // Ensure required scripts are loaded (db-manage.js, admin.js)
  var scriptsToLoad = [];
  if (typeof initDbManage !== 'function') {
    scriptsToLoad.push('/js/db-manage.js?v=' + (window.APP_VERSION || ''));
  }
  if (typeof initAdmin !== 'function') {
    scriptsToLoad.push('/js/admin.js?v=' + (window.APP_VERSION || ''));
  }

  var self = this;
  function loadNext(idx) {
    if (idx >= scriptsToLoad.length) {
      _renderSystemManageShell(container);
      return;
    }
    var script = document.createElement('script');
    script.src = scriptsToLoad[idx];
    script.onload = function() { loadNext(idx + 1); };
    script.onerror = function() {
      container.innerHTML = '<div class="error-state">脚本加载失败: ' + scriptsToLoad[idx] + '<br><button onclick="initSystemManage()">重试</button></div>';
    };
    document.head.appendChild(script);
  }
  loadNext(0);
}

// ── Shell: tabs + panels ──

function _renderSystemManageShell(container) {
  // Reset panel state on every re-entry (gotoView may re-init the shell)
  _sysPanelsLoaded = {};
  _sysActiveTab = 'db';

  var html =
    '<div class="sys-manage-tabs" style="display:flex;gap:2px;border-bottom:1px solid var(--border);margin-bottom:20px;padding:0 4px">' +
      '<button class="sys-tab active" data-tab="db" onclick="_switchSysTab(\'db\')" style="padding:10px 20px;border:none;background:none;color:var(--muted);font-size:13px;font-weight:500;cursor:pointer;border-bottom:2px solid transparent;transition:all 0.2s">数据库管理</button>' +
      '<button class="sys-tab" data-tab="config" onclick="_switchSysTab(\'config\')" style="padding:10px 20px;border:none;background:none;color:var(--muted);font-size:13px;font-weight:500;cursor:pointer;border-bottom:2px solid transparent;transition:all 0.2s">数据源管理</button>' +
      '<button class="sys-tab" data-tab="settings" onclick="_switchSysTab(\'settings\')" style="padding:10px 20px;border:none;background:none;color:var(--muted);font-size:13px;font-weight:500;cursor:pointer;border-bottom:2px solid transparent;transition:all 0.2s">系统设置</button>' +
      '<button class="sys-tab" data-tab="uploads" onclick="_switchSysTab(\'uploads\')" style="padding:10px 20px;border:none;background:none;color:var(--muted);font-size:13px;font-weight:500;cursor:pointer;border-bottom:2px solid transparent;transition:all 0.2s">上传管理</button>' +
    '</div>' +
    '<div id="sys-panel-db" class="sys-panel" style="display:block"></div>' +
    '<div id="sys-panel-config" class="sys-panel" style="display:none"></div>' +
    '<div id="sys-panel-settings" class="sys-panel" style="display:none"></div>' +
    '<div id="sys-panel-uploads" class="sys-panel" style="display:none"></div>';

  container.innerHTML = html;
  _sysActiveTab = 'db';

  // Add tab active style
  var styleEl = document.createElement('style');
  styleEl.id = 'sys-manage-style';
  if (!document.getElementById('sys-manage-style')) {
    styleEl.textContent =
      '.sys-tab.active { color: var(--accent) !important; border-bottom-color: var(--accent) !important; }' +
      '.sys-tab:hover { color: var(--fg) !important; }' +
      '#sys-config-form .config-actions { display: none; }' +
      '#sys-settings-col .section-hd { margin-top: 0 !important; }' +
      '#sys-settings-col .card { margin-bottom: 0; }' +
      '.sys-chart-card:hover { box-shadow: 0 0 0 2px var(--border); }';
    document.head.appendChild(styleEl);
  }

  // Load target tab (from URL param) or default to db
  var targetTab = _sysTargetTab || 'db';
  _sysTargetTab = null;

  // Switch to target tab (updates URL hash + loads panel)
  _switchSysTab(targetTab, true);
}

// ── Tab switching ──

function _switchSysTab(tab, initialLoad) {
  if (!initialLoad && _sysActiveTab === tab) return;
  _sysActiveTab = tab;

  // Update URL hash for deep-linking (only after initial load)
  if (!initialLoad) {
    var newHash = '#/system-manage/' + tab;
    if (window.location.hash !== newHash) {
      history.replaceState({ view: 'system-manage', params: [tab] }, '', newHash);
    }
  }

  // Update tab styles
  document.querySelectorAll('.sys-tab').forEach(function(el) {
    el.classList.toggle('active', el.getAttribute('data-tab') === tab);
  });

  // Show/hide panels
  document.getElementById('sys-panel-db').style.display = tab === 'db' ? '' : 'none';
  document.getElementById('sys-panel-config').style.display = tab === 'config' ? '' : 'none';
  document.getElementById('sys-panel-settings').style.display = tab === 'settings' ? '' : 'none';
  document.getElementById('sys-panel-uploads').style.display = tab === 'uploads' ? '' : 'none';

  // Lazy-load
  if (tab === 'db' && !_sysPanelsLoaded.db) _loadDbPanel();
  if (tab === 'config' && !_sysPanelsLoaded.config) _loadConfigPanel();
  if (tab === 'settings' && !_sysPanelsLoaded.settings) _loadSysSettingsPanel();
  if (tab === 'uploads' && !_sysPanelsLoaded.uploads) _loadUploadsPanel();
}

// ── Tab 1: Database Management ──

function _loadDbPanel() {
  _sysPanelsLoaded.db = true;
  if (typeof initDbManage === 'function') {
    initDbManage('sys-panel-db');
  }
}

// ── Tab 2: Data Source Config ──

function _loadConfigPanel() {
  _sysPanelsLoaded.config = true;
  var panel = document.getElementById('sys-panel-config');
  if (!panel) return;

  panel.innerHTML = '<div class="loading-spinner" style="padding:40px">加载配置...</div>';

  if (typeof _adminConfigContainerId !== 'undefined') {
    _adminConfigContainerId = 'sys-config-form';
  }

  try {
    var configPromise = (typeof _adminFormData !== 'undefined' && _adminFormData)
      ? Promise.resolve(_adminFormData)
      : API.get('/admin/config');

    configPromise.then(function(cfg) {
      _adminFormData = cfg;

      var html =
        '<div id="sys-config-form"></div>' +
        '<div style="display:flex;gap:8px;align-items:center;padding-top:12px;border-top:1px solid var(--border)">' +
          '<button class="btn btn-sm" onclick="_sysExportConfig()" style="height:32px;font-size:11px">' +
            '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="margin-right:4px;vertical-align:middle"><path d="M14.5 10.5v3a1 1 0 01-1 1h-12a1 1 0 01-1-1v-3"/><polyline points="4.5 6.5 8 2.5 11.5 6.5"/><line x1="8" y1="2.5" x2="8" y2="10.5"/></svg>' +
            '导出配置' +
          '</button>' +
          '<input type="file" id="sys-config-import-file" accept=".json" style="display:none" onchange="_sysImportConfig(this)">' +
          '<button class="btn btn-sm" onclick="document.getElementById(\'sys-config-import-file\').click()" style="height:32px;font-size:11px">' +
            '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="margin-right:4px;vertical-align:middle"><path d="M2.5 10.5v3a1 1 0 001 1h10a1 1 0 001-1v-3"/><polyline points="11.5 6.5 8 10.5 4.5 6.5"/><line x1="8" y1="10.5" x2="8" y2="2.5"/></svg>' +
            '导入配置' +
          '</button>' +
          '<button class="btn btn-sm" onclick="clearDatabase()" style="height:32px;margin-left:auto;font-size:11px;color:var(--danger)">清除数据库缓存</button>' +
          '<span id="sys-config-import-msg" style="font-size:11px;color:var(--muted)"></span>' +
        '</div>';

      panel.innerHTML = html;

      if (typeof _adminConfigContainerId !== 'undefined') {
        _adminConfigContainerId = 'sys-config-form';
      }

      if (typeof renderConfigForm === 'function') renderConfigForm(cfg);

      // Auto-open config dialog if triggered from topbar dropdown
      var autoOpen = typeof _getSrcConfigOpenDialog === 'function' ? _getSrcConfigOpenDialog() : undefined;
      if (autoOpen !== undefined) {
        setTimeout(function() {
          if (autoOpen && typeof openSourceConfigDialog === 'function') {
            openSourceConfigDialog(autoOpen);
          } else if (typeof openSourceConfigDialog === 'function') {
            var first = (typeof _configSections !== 'undefined' && _configSections[0]) ? _configSections[0].key : null;
            if (first) openSourceConfigDialog(first);
          }
        }, 200);
      }
    }).catch(function(e) {
      panel.innerHTML = '<div class="error-state">加载失败: ' + escHtml(e.message || '') + '</div>';
    });
  } catch(e) {
    panel.innerHTML = '<div class="error-state">加载失败: ' + escHtml(e.message || '') + '</div>';
  }
}

// ── Tab 3: System Settings (操作安全设置 + 系统参数) ──

var _sysParamsCache = null;

function _loadSysSettingsPanel() {
  _sysPanelsLoaded.settings = true;
  var panel = document.getElementById('sys-panel-settings');
  if (!panel) return;

  panel.innerHTML = '<div class="loading-spinner" style="padding:40px">加载设置...</div>';

  if (typeof _adminSettingsContainerId !== 'undefined') {
    _adminSettingsContainerId = 'sys-settings-col';
  }

  API.get('/admin/system-params').then(function(sysParams) {
    _sysParamsCache = sysParams;

    var html =
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">' +
        // Left: 操作安全设置 (rendered by loadPmaSettingsUI — creates its own section-hd + card)
        '<div id="sys-settings-col"></div>' +
        // Right: 系统参数
        '<div>' +
          '<div class="section-hd"><div class="section-title">系统参数</div></div>' +
          '<div class="card" style="padding:16px">' +
            '<div style="font-size:11px;color:var(--muted);margin-bottom:10px">存储在 .env 文件中，修改敏感项后重启服务生效。</div>' +
            _sysParamsCardRows(sysParams) +
          '</div>' +
        '</div>' +
      '</div>';

    panel.innerHTML = html;

    if (typeof _adminSettingsContainerId !== 'undefined') {
      _adminSettingsContainerId = 'sys-settings-col';
    }

    if (typeof loadPmaSettingsUI === 'function') loadPmaSettingsUI();
  }).catch(function(e) {
    panel.innerHTML = '<div class="error-state">加载失败: ' + escHtml(e.message || '') + '</div>';
  });
}

// ── System Parameters Card ──

var _SYS_PARAM_META = {
  jwt_secret_key:    { label: 'JWT 密钥',         type: 'password', ph: '至少 32 字符随机字符串', sensitive: true,
                        info: '用于签发和验证用户登录 Token。修改后所有已登录用户将立即被强制退出，需重新登录。' },
  jwt_algorithm:     { label: 'JWT 算法',         type: 'select',   ph: '', options: ['HS256','HS384','HS512','RS256'], sensitive: false },
  jwt_expire_minutes:{ label: 'Token 过期(分钟)',  type: 'number',   ph: '480（8小时）', sensitive: false },
  log_level:         { label: '日志级别',          type: 'select',   ph: '', options: ['DEBUG','INFO','WARNING','ERROR'], sensitive: false },
  CONVERT_CACHE_MAX_SIZE_MB: {
    label: '文件转换缓存上限 (MB)', type: 'number', default: '1024', options: null, sensitive: false,
    info: '0 表示不限制；达到上限后按最近最少使用淘汰旧缓存文件',
  },
};

function _sysParamsCardRows(params) {
  var rows = '';
  Object.keys(_SYS_PARAM_META).forEach(function(key) {
    var meta = _SYS_PARAM_META[key];
    var val = params[key] || '';
    var display = meta.sensitive && val ? '••••••••' : (val || '（未设置）');
    var infoIcon = meta.info
      ? '<span style="position:relative;display:inline-flex;align-items:center;margin-left:3px;cursor:help" ' +
          'onmouseenter="var t=this.querySelector(\'.sys-info-tip\');if(t)t.style.display=\'block\'" ' +
          'onmouseleave="var t=this.querySelector(\'.sys-info-tip\');if(t)t.style.display=\'none\'">' +
          '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="var(--muted)" stroke-width="1.5" style="flex-shrink:0"><circle cx="8" cy="8" r="6"/><line x1="8" y1="6" x2="8" y2="10"/><circle cx="8" cy="12.5" r="0.7" fill="var(--muted)" stroke="none"/></svg>' +
          '<span class="sys-info-tip" style="display:none;position:absolute;left:16px;top:-4px;z-index:500;background:var(--tooltip-bg,var(--bg-inv,#333));color:var(--tooltip-fg,var(--fg-inv,#fff));font-size:11px;font-weight:400;padding:6px 10px;border-radius:6px;max-width:260px;white-space:normal;line-height:1.4">' + escHtml(meta.info) + '</span>' +
        '</span>'
      : '';
    rows +=
      '<label style="display:flex;align-items:center;justify-content:space-between;padding:8px 14px;background:var(--bg);border-radius:8px;gap:10px;margin-bottom:4px">' +
        '<div style="min-width:0">' +
          '<span style="font-size:12px">' + escHtml(meta.label) + infoIcon + '</span>' +
          '<span style="font-size:11px;color:var(--muted);margin-left:6px">' + escHtml(display) + '</span>' +
        '</div>' +
        '<button class="btn btn-xs" onclick="_sysEditParam(\'' + key + '\')" style="height:24px;padding:0 8px;font-size:10px;flex-shrink:0">编辑</button>' +
      '</label>';
  });
  return '<div style="display:flex;flex-direction:column">' + rows + '</div>';
}

function _sysEditParam(key) {
  var meta = _SYS_PARAM_META[key];
  var curVal = _sysParamsCache ? (_sysParamsCache[key] || '') : '';

  var bodyHtml = '<div style="min-width:360px">';
  if (meta.type === 'select') {
    bodyHtml += '<label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px">' + escHtml(meta.label) + '</label>' +
      '<select id="sys-param-val" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--fg);font-size:13px">';
    meta.options.forEach(function(opt) {
      bodyHtml += '<option value="' + opt + '"' + (curVal === opt ? ' selected' : '') + '>' + opt + '</option>';
    });
    bodyHtml += '</select>';
  } else if (meta.type === 'number') {
    bodyHtml += '<label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px">' + escHtml(meta.label) + '</label>' +
      '<input type="number" id="sys-param-val" value="' + escHtml(curVal) + '" placeholder="' + escHtml(meta.ph) + '" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--fg);font-size:13px;box-sizing:border-box">';
  } else {
    var isMasked = meta.sensitive && curVal && curVal.indexOf('•') === -1;
    bodyHtml += '<label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px">' + escHtml(meta.label) + '</label>' +
      '<input type="' + (meta.type === 'password' ? 'password' : 'text') + '" id="sys-param-val" placeholder="' + escHtml(meta.ph) + '" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--fg);font-size:13px;box-sizing:border-box">';
    if (meta.sensitive) {
      bodyHtml += '<div style="font-size:10px;color:var(--muted);margin-top:4px">留空 = 保持不变。输入新值将替换现有密钥。</div>';
    }
  }
  bodyHtml += '</div>';

  openDialog(
    '编辑: ' + meta.label,
    bodyHtml,
    [
      { text: '取消', cls: 'btn-sm', onclick: 'this.closest(\'.shared-dialog-overlay\').remove()' },
      { text: '保存', cls: 'btn-primary btn-sm', onclick: '_sysSaveParam(\'' + key + '\',document.getElementById(\'sys-param-val\').value)' }
    ],
    { overlayClass: 'shared-dialog-overlay', maxWidth: 440 }
  );
}

async function _sysSaveParam(key, newVal) {
  var payload = {};
  payload[key] = newVal || '';
  try {
    // Close dialog first
    var overlay = document.querySelector('.shared-dialog-overlay');
    if (overlay) overlay.remove();

    var result = await API.put('/admin/system-params', payload);
    showToast(result.message || '已保存', 'success');
    EventBus.emit(EVENTS.SETTING_SAVED, { scope: 'settings' });
  } catch(e) {
    showToast('保存失败: ' + (e.message || ''), 'error');
  }
}

// ── Config Export/Import ──

async function _sysExportConfig() {
  try {
    var resp = await API.get('/admin/config/export');
    var blob = new Blob([JSON.stringify(resp, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var now = new Date();
    var ds = now.getFullYear() + ('0' + (now.getMonth() + 1)).slice(-2) + ('0' + now.getDate()).slice(-2);
    a.href = url;
    a.download = 'pma-config-' + ds + '.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('配置已导出', 'success');
  } catch(e) {
    showToast('导出失败: ' + (e.message || ''), 'error');
  }
}

function _sysImportConfig(input) {
  var file = input.files[0];
  if (!file) return;
  if (!file.name.endsWith('.json')) { showToast('请选择 .json 配置文件', 'error'); input.value = ''; return; }
  if (!confirm('导入将覆盖当前数据源配置（密码/token 等敏感字段为空时会保留现有值）。\n\n确认导入？')) { input.value = ''; return; }

  var msgEl = document.getElementById('sys-config-import-msg');
  if (msgEl) msgEl.innerHTML = '<span style="color:var(--muted)">导入中...</span>';

  var formData = new FormData();
  formData.append('file', file);

  var token = localStorage.getItem('pma_token');
  fetch('/api/admin/config/import', {
    method: 'POST',
    headers: token ? { 'Authorization': 'Bearer ' + token } : {},
    body: formData
  }).then(function(r) { return r.json(); })
    .then(function(json) {
      if (json.code === 0) {
        if (msgEl) msgEl.innerHTML = '<span style="color:var(--success)">&#10003; ' + escHtml(json.message) + '</span>';
        showToast('配置导入成功', 'success');
        // Reload config via event
        _adminFormData = null;
        EventBus.emit(EVENTS.SETTING_SAVED, { scope: 'config' });
      } else {
        if (msgEl) msgEl.innerHTML = '<span style="color:var(--danger)">' + escHtml(json.message) + '</span>';
        showToast('导入失败: ' + (json.message || ''), 'error');
      }
    }).catch(function(e) {
      if (msgEl) msgEl.innerHTML = '<span style="color:var(--danger)">导入失败: ' + escHtml(e.message) + '</span>';
    }).finally(function() {
      input.value = '';
    });
}

// ── Tab 3: Upload Statistics ──

function _loadUploadsPanel() {
  _sysPanelsLoaded.uploads = true;
  var panel = document.getElementById('sys-panel-uploads');
  if (!panel) return;

  panel.innerHTML = '<div class="loading-spinner" style="padding:40px">加载上传统计...</div>';

  API.get('/admin/uploads/stats').then(function(stats) {
    _renderUploadStats(panel, stats);
  }).catch(function(e) {
    panel.innerHTML = '<div class="error-state">加载失败: ' + escHtml(e.message || '') + '</div>';
  });
}

function _renderUploadStats(panel, stats) {
  var t = stats.total || {};

  // ── Overview cards ──
  var html =
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:20px">' +
      '<div class="card" style="padding:16px;text-align:center">' +
        '<div style="font-size:24px;font-weight:700;color:var(--accent)">' + escHtml(String(t.count || 0)) + '</div>' +
        '<div style="font-size:11px;color:var(--muted);margin-top:4px">文件总数</div>' +
      '</div>' +
      '<div class="card" style="padding:16px;text-align:center">' +
        '<div style="font-size:24px;font-weight:700;color:var(--success)">' + escHtml(t.size_display || '0 B') + '</div>' +
        '<div style="font-size:11px;color:var(--muted);margin-top:4px">总占用空间</div>' +
      '</div>' +
    '</div>';

  // ── Charts row: clickable cards (3 cols) ──
  var hasAnyData = (t.count || 0) > 0;
  // Store stats for detail switching
  _sysUploadStats = stats;

  html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:20px">';

  html += '<div class="card sys-chart-card active" id="sys-chart-card-type" onclick="_sysShowUploadDetail(\'type\',this)" style="padding:16px;cursor:pointer;transition:box-shadow 0.2s,border-color 0.2s;border:2px solid var(--accent)"><div id="sys-chart-type"></div></div>';
  html += '<div class="card sys-chart-card" id="sys-chart-card-product" onclick="_sysShowUploadDetail(\'product\',this)" style="padding:16px;cursor:pointer;transition:box-shadow 0.2s,border-color 0.2s;border:2px solid transparent"><div id="sys-chart-product"></div></div>';
  html += '<div class="card sys-chart-card" id="sys-chart-card-project" onclick="_sysShowUploadDetail(\'project\',this)" style="padding:16px;cursor:pointer;transition:box-shadow 0.2s,border-color 0.2s;border:2px solid transparent"><div id="sys-chart-project"></div></div>';

  html += '</div>';

  // Detail table (dynamic)
  html += '<div class="card" style="padding:16px;margin-bottom:20px" id="sys-upload-detail"></div>';

  panel.innerHTML = html;

  // Render charts after DOM is in place
  if (hasAnyData) {
    var typeSegments = (stats.by_type || []).filter(function(r) { return r.count > 0; }).map(function(r) {
      return { label: r.label, value: r.size_bytes };
    });
    if (typeSegments.length > 0) {
      renderDonutChart('sys-chart-type', typeSegments, { title: '按类型分布', size: 170, centerText: t.size_display });
    }

    var prodSegments = (stats.by_product || []).slice(0, 8).map(function(r) {
      return { label: r.product_name, value: r.size_bytes };
    });
    if (prodSegments.length > 0) {
      renderDonutChart('sys-chart-product', prodSegments, { title: '按产品分布 (Top 8)', size: 170 });
    }

    var projSegments = (stats.by_project || []).slice(0, 8).map(function(r) {
      return { label: r.project_name, value: r.size_bytes };
    });
    if (projSegments.length > 0) {
      renderDonutChart('sys-chart-project', projSegments, { title: '按项目分布 (Top 8)', size: 170 });
    }
  } else {
    document.getElementById('sys-chart-type').innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted);font-size:13px">暂无上传文件</div>';
    document.getElementById('sys-chart-product').innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted);font-size:13px">暂无数据</div>';
    document.getElementById('sys-chart-project').innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted);font-size:13px">暂无数据</div>';
  }

  // Render default detail table (type)
  _sysShowUploadDetail('type', document.getElementById('sys-chart-card-type'));
}

// ── Upload Detail Switching ──

var _sysUploadStats = null;
var _sysUploadDetailKey = 'type';

function _sysShowUploadDetail(key, cardEl) {
  _sysUploadDetailKey = key;
  var stats = _sysUploadStats;
  if (!stats) return;

  // Update card active styles
  document.querySelectorAll('.sys-chart-card').forEach(function(c) {
    c.style.borderColor = 'transparent';
  });
  if (cardEl) {
    cardEl.style.borderColor = 'var(--accent)';
  }

  // Build detail table
  var detailEl = document.getElementById('sys-upload-detail');
  if (!detailEl) return;

  var title, rows, cols;
  if (key === 'type') {
    title = '按类型明细';
    rows = stats.by_type || [];
    cols = [{ key: 'label', label: '类型', align: 'left' }];
  } else if (key === 'product') {
    title = '按产品明细';
    rows = stats.by_product || [];
    cols = [{ key: 'product_name', label: '产品', align: 'left' }];
  } else {
    title = '按项目明细';
    rows = stats.by_project || [];
    cols = [{ key: 'project_name', label: '项目', align: 'left' }];
  }

  var html = '<div style="font-size:12px;font-weight:600;color:var(--fg);margin-bottom:10px">' + title + '</div>';
  html += '<table style="width:100%;font-size:12px;border-collapse:collapse">' +
    '<thead><tr style="color:var(--muted);text-align:left">' +
      '<th style="padding:6px 8px;border-bottom:1px solid var(--border)">' + cols[0].label + '</th>' +
      '<th style="padding:6px 8px;border-bottom:1px solid var(--border);text-align:right">数量</th>' +
      '<th style="padding:6px 8px;border-bottom:1px solid var(--border);text-align:right">大小</th>' +
      '<th style="padding:6px 8px;border-bottom:1px solid var(--border);text-align:right">占比</th>' +
    '</tr></thead><tbody>';

  if (rows.length === 0) {
    html += '<tr><td colspan="4" style="padding:20px;text-align:center;color:var(--muted)">暂无数据</td></tr>';
  } else {
    rows.forEach(function(row) {
      var name = row[cols[0].key] || '未知';
      html += '<tr>' +
        '<td style="padding:6px 8px;border-bottom:1px solid var(--border-subtle)">' + escHtml(name) + '</td>' +
        '<td style="padding:6px 8px;border-bottom:1px solid var(--border-subtle);text-align:right">' + (row.count || 0) + '</td>' +
        '<td style="padding:6px 8px;border-bottom:1px solid var(--border-subtle);text-align:right">' + escHtml(row.size_display || '0 B') + '</td>' +
        '<td style="padding:6px 8px;border-bottom:1px solid var(--border-subtle);text-align:right">' + (row.percent || 0) + '%</td>' +
        '</tr>';
    });
  }
  html += '</tbody></table>';
  detailEl.innerHTML = html;
}
