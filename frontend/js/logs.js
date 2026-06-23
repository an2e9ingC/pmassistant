/* ═══════════════════════════════════════════════════
   LOG VIEWER (Admin Only)
   - Auto-refresh with smart scroll: stays at bottom for new logs,
     pauses auto-scroll when user scrolls up manually
   - Single pause/resume button
═══════════════════════════════════════════════════ */

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

async function fetchLogs() {
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
    var html = lines.map(function(line) {
      var cls = '';
      if (line.indexOf(' ERROR ') >= 0 || line.indexOf('CRITICAL') >= 0) cls = 'log-error';
      else if (line.indexOf('WARNING') >= 0) cls = 'log-warn';
      else if (line.indexOf('DEBUG') >= 0) cls = 'log-debug';
      return '<span class="' + cls + '">' + escHtml(line) + '</span>';
    }).join('\n');

    // Preserve scroll position if user is reading older logs
    var wasAtBottom = isLogAtBottom();
    container.innerHTML = '<pre class="log-pre">' + html + '</pre>';

    // Re-bind scroll listener on the scrollable container
    if (container) {
      container.addEventListener('scroll', function() {
        _logUserScrolled = !isLogAtBottom();
      });
      // Auto-scroll to bottom only if: initial load, or user was already at bottom
      if (!_logUserScrolled || wasAtBottom) {
        scrollLogToBottom();
      }
    }

    document.getElementById('log-status').textContent =
      '已加载 ' + lines.length + ' 条 · ' + new Date().toLocaleTimeString();
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
  fetchLogs();
}

function setLogTail() {
  var sel = document.getElementById('log-tail-select');
  _logTail = parseInt(sel ? sel.value : 200) || 200;
  fetchLogs();
}

function onLogSearch(v) {
  _logSearch = v;
  clearTimeout(window._logSearchTimer);
  window._logSearchTimer = setTimeout(fetchLogs, 300);
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
    fetchLogs();
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
      html += '<div class="table-scroll" style="max-height:calc(100vh - 280px)"><table class="stage-table"><thead><tr>' +
        '<th style="width:140px">时间</th>' +
        '<th style="width:70px">用户</th>' +
        '<th style="width:80px">分类</th>' +
        '<th style="width:140px">操作</th>' +
        '<th style="width:50px">等级</th>' +
        '<th>详情</th>' +
      '</tr></thead><tbody>' +
      items.map(function(e) {
        return '<tr>' +
          '<td style="font-size:11px;font-family:var(--mono);color:var(--muted);white-space:nowrap">' + escHtml(e.created_at) + '</td>' +
          '<td style="font-size:12px">' + escHtml(e.username) + '</td>' +
          '<td style="font-size:11px">' + escHtml(e.category || '—') + '</td>' +
          '<td style="font-size:11px">' + escHtml(e.action) + '</td>' +
          '<td>' + levelPill(e.level) + '</td>' +
          '<td style="font-size:11px;color:var(--muted)">' + escHtml(e.detail) + '</td>' +
        '</tr>';
      }).join('') +
      '</tbody></table></div>';

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
  } catch(e) {
    container.innerHTML = '<div class="error-state">加载失败: ' + escHtml(e.message) + '</div>';
  }
}

async function clearAuditLogs() {
  if (!confirm('确定清空所有操作日志？此操作不可撤销。')) return;
  try {
    await API.post('/logs/audit/clear');
    showToast('操作日志已清除', 'success');
    document.getElementById('audit-content').innerHTML = '<div class="empty-state" style="padding:20px">操作日志已清除</div>';
  } catch(e) {
    showToast('清除失败: ' + e.message + '（仅admin可清除操作日志）', 'error');
  }
}
