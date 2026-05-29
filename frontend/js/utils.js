/* ═══════════════════════════════════════════════════
   CONSTANTS & HELPERS
═══════════════════════════════════════════════════ */
const STATUS_TXT = {completed:'已完成',active:'进行中',blocked:'已阻塞',pending:'未开始',planning:'规划中',canceled:'已取消'};
const TYPE_TXT   = {RD:'研发',SC:'生产'};

const G_START = new Date('2025-01-01');
const G_END   = new Date('2027-01-01');
const G_SPAN  = G_END - G_START;

function d2pct(ds) {
  const t = new Date(ds) - G_START;
  return Math.max(0, Math.min(100, (t / G_SPAN) * 100));
}

function todayPct() {
  return d2pct(new Date().toISOString().slice(0, 10));
}

function formatDate(d) {
  if (!d) return '';
  const s = String(d);
  return s.length >= 10 ? s.substring(0, 10) : s;
}

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Notification queue (shared between toast + bell)
var _notifQueue = [];
var _notifUnread = 0;

function showToast(msg, type) {
  type = type || 'info';
  // Add to notification queue for bell dropdown
  _notifQueue.unshift({ message: msg, type: type, time: new Date().toLocaleTimeString() });
  if (_notifQueue.length > 50) _notifQueue.pop();
  _notifUnread++;
  updateBellBadge();

  // Render toast at top-center
  var container = document.getElementById('toast-container');
  if (!container) return;
  var el = document.createElement('div');
  el.className = 'toast ' + type;
  var closeHtml = '';
  // error/critical: no auto-close, require manual dismissal
  var autoClose = type !== 'error';
  if (!autoClose) {
    closeHtml = '<button class="toast-close" onclick="this.parentElement.remove()">&times;</button>';
  }
  el.innerHTML = '<span>' + escHtml(msg) + '</span>' + closeHtml;
  container.appendChild(el);
  if (autoClose) {
    setTimeout(function() {
      if (el.parentElement) el.remove();
    }, 4000);
  }
}

function updateBellBadge() {
  var badge = document.getElementById('bell-badge');
  if (!badge) return;
  if (_notifUnread > 0) {
    badge.textContent = _notifUnread > 99 ? '99+' : _notifUnread;
    badge.classList.add('show');
  } else {
    badge.classList.remove('show');
  }
}

function clearBellUnread() {
  _notifUnread = 0;
  updateBellBadge();
}
