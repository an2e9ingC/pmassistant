/* ═══════════════════════════════════════════════════
   LOG VIEWER (Admin Only)
   - Auto-refresh with smart scroll: stays at bottom for new logs,
     pauses auto-scroll when user scrolls up manually
   - Single pause/resume button
═══════════════════════════════════════════════════ */

// NOTE: 后续新增 log_audit() action code 时必须同步在此增加映射
var ACTION_LABEL = {
  'bug_analysis_add': 'Bug添加分析',
  'bug_analysis_delete': 'Bug删除分析',
  'bug_analysis_edit': 'Bug编辑分析',
  'bug_attachment_add': 'Bug上传附件',
  'bug_create': 'Bug创建',
  'bug_delete': 'Bug删除',
  'bug_gitlab_submit': 'Bug提交GitLab',
  'bug_import': 'Bug导入',
  'bug_import_batch': 'Bug批量导入',
  'bug_template_add': 'Bug模板新增',
  'bug_template_delete': 'Bug模板删除',
  'bug_template_edit': 'Bug模板编辑',
  'bug_transfer': 'Bug转移',
  'bug_update': 'Bug更新',
  'bug_worklog_add': 'Bug记录工时',
  'bug_worklog_delete': 'Bug删除工时',
  'bug_worklog_edit': 'Bug编辑工时',
  'clear_database': '清除数据库',
  'clear_logs': '清除系统日志',
  'clear_svn': '清除SVN数据',
  'db_delete_backup': '删除数据库备份',
  'db_export': '导出数据库',
  'db_import': '导入数据库',
  'db_rekey': '数据库密钥更换',
  'db_restore_backup': '恢复数据库备份',
  'delete_customer': '删除客户',
  'delete_user': '删除用户',
  'doc_ptype_add': '新增项目类型',
  'doc_ptype_edit': '编辑项目类型',
  'doc_reset': '重置项目文档',
  'doc_stage_add': '新增阶段类型',
  'doc_stage_del': '删除阶段类型',
  'doc_stage_rename': '重命名阶段类型',
  'doc_stage_reorder': '重排阶段类型',
  'doc_template_add': '新增文档模板',
  'doc_template_del': '删除文档模板',
  'doc_template_edit': '编辑文档模板',
  'doc_template_sync_all': '同步所有项目文档模板',
  'local_product_create': '创建本地产品',
  'local_product_delete': '删除本地产品',
  'local_product_update': '更新本地产品',
  'local_project_create': '创建本地项目',
  'local_project_update': '更新本地项目',
  'naming_option_add': '新增命名选项',
  'naming_option_delete': '删除命名选项',
  'naming_option_edit': '编辑命名选项',
  'pma_tag_add': '新增标签',
  'pma_tag_del': '删除标签',
  'pma_tag_edit': '编辑标签',
  'product_doc_template_add': '新增产品文档模板',
  'product_doc_template_del': '删除产品文档模板',
  'product_doc_template_edit': '编辑产品文档模板',
  'product_doc_template_import': '导入产品文档模板',
  'product_node_add': '新增产品节点',
  'product_node_del': '删除产品节点',
  'product_node_link': '关联产品到节点',
  'product_node_unlink': '取消关联产品',
  'product_node_update': '更新产品节点',
  'product_note_add': '新增产品笔记',
  'product_note_delete': '删除产品笔记',
  'product_note_edit': '编辑产品笔记',
  'product_projects_update': '更新产品关联项目',
  'project_delete': '删除项目',
  'project_doc_scan': '扫描项目文档',
  'project_doc_update': '更新项目文档',
  'project_note_add': '新增项目笔记',
  'project_note_delete': '删除项目笔记',
  'project_note_edit': '编辑项目笔记',
  'project_update': '更新项目',
  'role_create': '创建角色',
  'role_delete': '删除角色',
  'role_update': '更新角色',
  'stage_init': '初始化项目阶段',
  'stage_unnecessary_docs': '设置阶段无需文档',
  'stage_unnecessary_tasks': '设置阶段无需任务',
  'standard_edit': '编辑准入准出标准',
  'task_create': '任务创建',
  'task_create_batch': '批量创建任务',
  'task_delete': '任务删除',
  'task_delete_all': '批量删除任务',
  'task_extend': '任务延长预估',
  'task_import': '从其他项目导入任务',
  'task_import_templates': '任务从模板导入',
  'task_template_add': '新增任务模板',
  'task_template_del': '删除任务模板',
  'task_template_edit': '编辑任务模板',
  'task_template_sync_all': '同步所有项目任务模板',
  'task_update': '任务更新',
  'user_password_reset': '用户密码重置',
  'user_permissions_update': '用户权限更新',
  'user_role_assign': '用户角色更新',
  'user_update': '用户信息更新',
};

var _logLevel = 'INFO';
var _logTail = 200;
var _logSearch = '';
var _logAutoRefresh = null;
var _logRefreshInterval = 2000; // default 2s
var _logUserScrolled = false;    // true when user manually scrolls away from bottom

// Refresh intervals by level
var _logIntervals = { 'DEBUG': 5000, 'INFO': 2000, 'WARNING': 2000, 'ERROR': 2000, 'CRITICAL': 2000 };

function isLogAtBottom() {
  var el = document.querySelector('.log-container');
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 40;
}

function scrollLogToBottom() {
  var el = document.querySelector('.log-container');
  if (el) el.scrollTop = el.scrollHeight;
}

async function renderLogs() {
  document.getElementById('log-content').innerHTML = '<div class="loading-spinner">加载日志...</div>';
  _logUserScrolled = false;
  await fetchLogs();
  startLogAutoRefresh();
}

function _logLineHtml(line) {
  var cls = '';
  if (line.indexOf(' ERROR ') >= 0 || line.indexOf('CRITICAL') >= 0) cls = 'log-error';
  else if (line.indexOf('WARNING') >= 0) cls = 'log-warn';
  else if (line.indexOf('DEBUG') >= 0) cls = 'log-debug';
  return '<span class="' + cls + '">' + escHtml(line) + '</span>';
}

function _logRenderFull(container, lines) {
  container.innerHTML = '<pre class="log-pre">' + lines.map(_logLineHtml).join('\n') + '</pre>';
}

async function fetchLogs(forceFull) {
  var container = document.getElementById('log-content');
  var params = 'tail=' + _logTail + '&level=' + _logLevel;
  if (_logSearch) params += '&search=' + encodeURIComponent(_logSearch);

  try {
    var text = await API.get('/logs/view?' + params);
    if (typeof text !== 'string') text = String(text || '');
    if (!text.trim()) {
      container.innerHTML = '<div class="empty-state">暂无匹配日志</div>';
      return;
    }
    var lines = text.split('\n');
    var pre = container.querySelector('.log-pre');

    if (forceFull || !pre || _logSearch) {
      _logRenderFull(container, lines);
      var wasAtBottom = true;
    } else {
      // Check if content actually changed
      var oldText = pre.textContent || '';
      if (oldText === text) {
        // No change — skip DOM update entirely, preserve selection
        _logUserScrolled = _logUserScrolled; // keep current state
      } else {
        // Content changed — find last common line and append new ones
        var spans = pre.querySelectorAll('span');
        var lastDomLine = spans.length ? spans[spans.length - 1].textContent : '';
        var lastIdx = -1;
        for (var i = lines.length - 1; i >= 0; i--) {
          if (lines[i] === lastDomLine) { lastIdx = i; break; }
        }
        if (lastIdx >= 0 && lastIdx < lines.length - 1) {
          // Append only new lines, keep existing DOM intact
          var newLines = lines.slice(lastIdx + 1);
          pre.insertAdjacentHTML('beforeend', '\n' + newLines.map(_logLineHtml).join('\n'));
          // Trim oldest if exceeding tail
          spans = pre.querySelectorAll('span');
          while (spans.length > _logTail) { spans[0].remove(); spans = pre.querySelectorAll('span'); }
        } else {
          // Last line not found — full refresh
          _logRenderFull(container, lines);
        }
      }
      var wasAtBottom = isLogAtBottom();
    }

    document.getElementById('log-status').textContent =
      '已加载 ' + lines.length + ' 条 · ' + new Date().toLocaleTimeString();

    if (!_logUserScrolled || wasAtBottom) {
      scrollLogToBottom();
    }
  } catch(e) {
    container.innerHTML = '<div class="error-state">加载日志失败: ' + escHtml(e.message || 'Request failed') +
      '<br><button onclick="fetchLogs()">重试</button></div>';
  }
}

function setLogLevel() {
  var sel = document.getElementById('log-level-select');
  _logLevel = sel ? sel.value : 'INFO';
  _logRefreshInterval = _logIntervals[_logLevel] || 15000;
  _logUserScrolled = false;
  restartLogAutoRefresh();
  fetchLogs(true);
}

function setLogTail() {
  var sel = document.getElementById('log-tail-select');
  _logTail = parseInt(sel ? sel.value : 200) || 200;
  fetchLogs(true);
}

function onLogSearch(v) {
  _logSearch = v;
  clearTimeout(window._logSearchTimer);
  window._logSearchTimer = setTimeout(function() { fetchLogs(true); }, 300);
}

/* ── Single pause/resume button ── */

function startLogAutoRefresh() {
  clearLogAutoRefresh();
  _logAutoRefresh = setInterval(fetchLogs, _logRefreshInterval);
  var btn = document.getElementById('log-refresh-btn');
  if (btn) {
    btn.textContent = '暂停';
    btn.style.background = 'var(--accent-lt)';
    btn.style.color = 'var(--accent)';
  }
}

function restartLogAutoRefresh() {
  clearLogAutoRefresh();
  startLogAutoRefresh();
}

function toggleLogAutoRefresh() {
  if (_logAutoRefresh) {
    // Currently running → pause
    clearLogAutoRefresh();
    var btn = document.getElementById('log-refresh-btn');
    if (btn) {
      btn.textContent = '恢复';
      btn.style.background = '';
      btn.style.color = '';
    }
  } else {
    // Currently paused → resume, and reset scroll state
    _logUserScrolled = false;
    startLogAutoRefresh();
    fetchLogs(true);
  }
}

function clearLogAutoRefresh() {
  if (_logAutoRefresh) {
    clearInterval(_logAutoRefresh);
    _logAutoRefresh = null;
  }
}

async function clearLogs() {
  if (!confirm('确定清空所有日志？此操作不可撤销。')) return;
  var ok = await verifyPassword('清除日志', 'pw_verify_clear_logs');
  if (!ok) return;
  try {
    await API.post('/logs/clear');
    document.getElementById('log-content').innerHTML = '<div class="empty-state" style="padding:20px">日志已清除</div>';
  } catch(e) {
    showToast('清除失败: ' + e.message, 'error');
  }
}

/* ── Audit Log Tab ── */

var _logTab = 'system';

function switchLogTab(tab) {
  _logTab = tab;
  document.querySelectorAll('#view-logs .map-tab').forEach(function(t) { t.classList.remove('active'); });
  var tabEl = document.getElementById('logtab-' + tab);
  if (tabEl) tabEl.classList.add('active');
  document.getElementById('log-sec-system').style.display = tab === 'system' ? '' : 'none';
  document.getElementById('log-sec-audit').style.display = tab === 'audit' ? '' : 'none';
  if (tab === 'audit') loadAuditLogs();
  else refreshLogs();
}

var _auditCategory = '';
var _auditLevel = '';
var _auditSearch = '';
var _auditPage = 1;
var _auditCategories = null;  // fetched dynamically from /api/logs/audit/categories

async function loadAuditLogs() {
  var container = document.getElementById('audit-content');
  container.innerHTML = '<div class="loading-spinner">加载操作日志...</div>';
  try {
    var params = 'limit=50&page=' + _auditPage;
    if (_auditCategory) params += '&category=' + encodeURIComponent(_auditCategory);
    if (_auditLevel) params += '&level=' + encodeURIComponent(_auditLevel);
    if (_auditSearch) params += '&search=' + encodeURIComponent(_auditSearch);
    var data = await API.get('/logs/audit?' + params);
    var items = data.items || [];
    var total = data.total || 0;

    // Category filter buttons — fetched dynamically
    if (!_auditCategories) {
      try { _auditCategories = await API.get('/logs/audit/categories') || []; }
      catch(e) { _auditCategories = []; }
    }
    var catBtns = [''].concat(_auditCategories).map(function(c) {
      var label = c || '全部';
      var cls = _auditCategory === c ? 'tab active' : 'tab';
      var escapedC = c.replace(/'/g, "\\'");
      return '<span class="' + cls + '" onclick="_auditCategory=\'' + escapedC + '\';_auditPage=1;loadAuditLogs()">' + label + '</span>';
    }).join('');

    var lvlBtns = ['', 'high', 'medium', 'low'].map(function(l) {
      var label = l === 'high' ? '高' : (l === 'medium' ? '中' : (l === 'low' ? '低' : '全部'));
      var cls = _auditLevel === l ? 'tab active' : 'tab';
      return '<span class="' + cls + '" onclick="_auditLevel=\'' + l + '\';_auditPage=1;loadAuditLogs()">' + label + '</span>';
    }).join('');

    // Level pill color
    function levelPill(lvl) {
      var c = lvl === 'high' ? 'var(--danger)' : (lvl === 'low' ? 'var(--muted)' : 'var(--warn)');
      var bg = lvl === 'high' ? 'var(--danger-lt)' : (lvl === 'low' ? 'var(--bg)' : 'var(--warn-lt)');
      var label = lvl === 'high' ? '高' : (lvl === 'low' ? '低' : '中');
      return '<span class="pill" style="background:' + bg + ';color:' + c + ';font-size:10px">' + label + '</span>';
    }

    var html = '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px">' +
      '<div style="display:flex;align-items:center;gap:6px">' +
        '<span style="font-size:11px;color:var(--muted)">分类:</span><span class="tabs" style="display:inline-flex">' + catBtns + '</span>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:6px">' +
        '<span style="font-size:11px;color:var(--muted)">等级:</span><span class="tabs" style="display:inline-flex">' + lvlBtns + '</span>' +
        '<input class="search-inp" id="audit-search-inp" placeholder="搜索..." value="' + escHtml(_auditSearch) + '" style="width:140px;margin-left:8px" onkeyup="if(event.key===\'Enter\'){_auditSearch=this.value;_auditPage=1;loadAuditLogs()}">' +
      '</div>' +
    '</div>';

    if (!items.length) {
      html += '<div class="empty-state" style="padding:20px">暂无操作日志</div>';
    } else {
      html += '<div class="card" style="padding:0"><div id="audit-table"></div></div>';

      // Pagination
      var totalPages = Math.ceil(total / 50);
      if (totalPages > 1) {
        html += '<div style="display:flex;justify-content:center;gap:4px;margin-top:10px">';
        for (var p = 1; p <= totalPages; p++) {
          var pCls = p === _auditPage ? 'tab active' : 'tab';
          html += '<span class="' + pCls + '" onclick="_auditPage=' + p + ';loadAuditLogs()">' + p + '</span>';
        }
        html += '</div>';
      }
    }

    container.innerHTML = html;

    // Build DataTable for audit items
    if (items.length) {
      new DataTable({
        container: document.getElementById('audit-table'),
        columns: [
          { key: 'created_at', title: '时间', width: '140px', render: function(v) { return '<span style="font-size:11px;font-family:var(--mono);color:var(--muted);white-space:nowrap">' + escHtml(fmtISODateTime(v)) + '</span>'; } },
          { key: 'username', title: '用户', width: '70px', render: function(v) { return '<span style="font-size:12px">' + escHtml(getDisplayName(v)) + '</span>'; } },
          { key: 'category', title: '分类', width: '80px', render: function(v) { return '<span style="font-size:11px">' + escHtml(v||'—') + '</span>'; } },
          { key: 'action', title: '操作', width: '140px', render: function(v) { return '<span style="font-size:11px">' + escHtml(ACTION_LABEL[v]||v) + '</span>'; } },
          { key: 'level', title: '等级', width: '50px', render: function(v) { return levelPill(v); } },
          { key: 'detail', title: '详情', render: function(v) { return '<span style="font-size:11px;color:var(--muted)">' + escHtml(v||'') + '</span>'; } }
        ],
        data: items,
        maxHeight: 'calc(100vh - 280px)',
        resizable: false
      });
    }
  } catch(e) {
    container.innerHTML = '<div class="error-state">加载失败: ' + escHtml(e.message) + '</div>';
  }
}

async function clearAuditLogs() {
  if (!confirm('确定清空所有操作日志？此操作不可撤销。')) return;
  var ok = await verifyPassword('清除操作日志', 'pw_verify_clear_audit');
  if (!ok) return;
  try {
    await API.post('/logs/audit/clear');
    showToast('操作日志已清除', 'success');
    document.getElementById('audit-content').innerHTML = '<div class="empty-state" style="padding:20px">操作日志已清除</div>';
  } catch(e) {
    showToast('清除失败: ' + e.message + '（仅admin可清除操作日志）', 'error');
  }
}
