/* ═══════════════════════════════════════════════════
   LOG VIEWER (Admin Only)
   - Database-backed log entries via /api/logs/view
   - Dropdown selects for level & line count
   - Auto-refresh based on filter level
═══════════════════════════════════════════════════ */

var _logLevel = 'INFO';
var _logTail = 200;
var _logSearch = '';
var _logAutoRefresh = null;
var _logRefreshInterval = 15000; // default 15s for INFO

// Refresh intervals by level: more critical = faster refresh
var _logIntervals = { 'DEBUG': 30000, 'INFO': 15000, 'WARNING': 10000, 'ERROR': 5000, 'CRITICAL': 3000 };

async function renderLogs() {
  document.getElementById('log-content').innerHTML = '<div class="loading-spinner">加载日志...</div>';
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
    container.innerHTML = '<pre class="log-pre">' + html + '</pre>';
    container.querySelector('.log-pre').scrollTop = container.querySelector('.log-pre').scrollHeight;
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

function startLogAutoRefresh() {
  clearLogAutoRefresh();
  _logAutoRefresh = setInterval(fetchLogs, _logRefreshInterval);
  var btn = document.getElementById('log-refresh-btn');
  if (btn) {
    btn.textContent = '停止刷新';
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
    clearLogAutoRefresh();
    var btn = document.getElementById('log-refresh-btn');
    if (btn) {
      btn.textContent = '自动刷新';
      btn.style.background = '';
      btn.style.color = '';
    }
  } else {
    startLogAutoRefresh();
  }
}

function clearLogAutoRefresh() {
  if (_logAutoRefresh) {
    clearInterval(_logAutoRefresh);
    _logAutoRefresh = null;
    var btn = document.getElementById('log-refresh-btn');
    if (btn) {
      btn.textContent = '自动刷新';
      btn.style.background = '';
      btn.style.color = '';
    }
  }
}
