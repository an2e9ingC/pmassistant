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
  try {
    await API.post('/logs/clear');
    document.getElementById('log-content').innerHTML = '<div class="empty-state" style="padding:20px">日志已清除</div>';
  } catch(e) {
    showToast('清除失败: ' + e.message, 'error');
  }
}
