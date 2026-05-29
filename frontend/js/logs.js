/* ═══════════════════════════════════════════════════
   LOG VIEWER
═══════════════════════════════════════════════════ */

var _logLevel = '';
var _logTail = 200;
var _logSearch = '';
var _logAutoRefresh = null;

async function renderLogs() {
  var container = document.getElementById('log-content');
  container.innerHTML = '<div class="loading-spinner">加载日志...</div>';
  await fetchLogs();
}

async function fetchLogs() {
  var container = document.getElementById('log-content');
  var params = 'tail=' + _logTail;
  if (_logLevel) params += '&level=' + _logLevel;
  if (_logSearch) params += '&search=' + encodeURIComponent(_logSearch);

  try {
    // API now returns JSON: {code:0, data:"<log text>", message:"ok"}
    // API.get extracts the data field automatically
    var text = await API.get('/logs/view?' + params);
    if (text && typeof text !== 'string') {
      text = String(text);
    }
    if (!text || !text.trim()) {
      container.innerHTML = '<div class="empty-state">暂无匹配日志</div>';
      return;
    }
    // Colorize by level
    var lines = text.split('\n');
    var html = lines.map(function(line) {
      var cls = '';
      if (line.indexOf(' ERROR ') >= 0 || line.indexOf(' CRITICAL ') >= 0) {
        cls = 'log-error';
      } else if (line.indexOf(' WARNING ') >= 0) {
        cls = 'log-warn';
      } else if (line.indexOf(' DEBUG ') >= 0) {
        cls = 'log-debug';
      }
      return '<span class="' + cls + '">' + escHtml(line) + '</span>';
    }).join('\n');
    container.innerHTML = '<pre class="log-pre">' + html + '</pre>';
    // Auto-scroll to bottom
    var pre = container.querySelector('.log-pre');
    if (pre) pre.scrollTop = pre.scrollHeight;
  } catch(e) {
    container.innerHTML = '<div class="error-state">加载日志失败: ' + escHtml(e.message) + '</div>';
  }
}

function setLogLevel(v) {
  _logLevel = v;
  document.querySelectorAll('.log-lvl-btn').forEach(function(b) { b.classList.remove('active'); });
  var btn = document.getElementById('log-lvl-' + (v || 'all'));
  if (btn) btn.classList.add('active');
  fetchLogs();
}

function setLogTail(v) {
  _logTail = v;
  document.querySelectorAll('.log-tail-btn').forEach(function(b) { b.classList.remove('active'); });
  var btn = document.getElementById('log-tail-' + v);
  if (btn) btn.classList.add('active');
  fetchLogs();
}

function onLogSearch(v) {
  _logSearch = v;
  clearTimeout(_logSearchTimer);
  _logSearchTimer = setTimeout(fetchLogs, 300);
}

var _logSearchTimer = null;

function toggleLogAutoRefresh() {
  var btn = document.getElementById('log-refresh-btn');
  if (_logAutoRefresh) {
    clearInterval(_logAutoRefresh);
    _logAutoRefresh = null;
    btn.textContent = '自动刷新';
    btn.style.background = '';
    btn.style.color = '';
  } else {
    _logAutoRefresh = setInterval(fetchLogs, 5000);
    btn.textContent = '停止刷新';
    btn.style.background = 'var(--accent-lt)';
    btn.style.color = 'var(--accent)';
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
