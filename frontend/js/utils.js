/* ═══════════════════════════════════════════════════
   CONSTANTS & HELPERS
═══════════════════════════════════════════════════ */
const STATUS_TXT = {completed:'已完成',active:'进行中',blocked:'已阻塞',pending:'未开始',planning:'规划中',canceled:'已取消',normal:'正常',closed:'已关闭',wait:'未开始',doing:'进行中',done:'已完成',suspended:'已暂停',resolved:'已解决'};
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

function showToast(msg, type, duration) {
  type = type || 'info';
  // Add to notification queue for bell dropdown
  _notifQueue.unshift({ message: msg, type: type, time: new Date().toLocaleTimeString() });
  if (_notifQueue.length > 50) _notifQueue.pop();
  _notifUnread++;
  updateBellBadge();

  // Render toast at top-center
  var container = document.getElementById('toast-container');
  if (!container) return null;
  var el = document.createElement('div');
  el.className = 'toast ' + type;
  var closeHtml = '';
  // duration=0 means no auto-close; error also defaults to no auto-close
  var autoClose = (duration !== 0) && (type !== 'error');
  var ms = (typeof duration === 'number' && duration > 0) ? duration : 4000;
  if (!autoClose) {
    closeHtml = '<button class="toast-close" onclick="this.parentElement.remove()">&times;</button>';
  }
  el.innerHTML = '<span>' + escHtml(msg) + '</span>' + closeHtml;
  container.appendChild(el);
  if (autoClose) {
    setTimeout(function() {
      if (el.parentElement) el.remove();
    }, ms);
  }
  return el;
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

// Extract project code from name: "PE0406-CDLY-xxx" -> "PE0406"
function extractProjectCode(name) {
  if (!name) return '';
  return name.split('-')[0] || '';
}

// Extract core project name: "PE0406-CDLY-全国产存储板卡" -> "全国产存储板卡"
// "PE9004-PMAssistant" -> "PMAssistant"
function extractCoreName(name) {
  if (!name) return '';
  var parts = name.split('-');
  // First segment is always project code (PE0406, PE9004, etc.)
  // If second segment looks like customer abbreviation (2-6 uppercase), strip it too
  if (parts.length >= 2 && /^[A-Z]{2,6}$/.test(parts[1])) {
    return parts.slice(2).join('-') || parts[1]; // fallback to customer if nothing left
  }
  return parts.slice(1).join('-') || name;
}

// Strip HTML tags from a string, returning plain text
function stripHtml(html) {
  if (!html) return '';
  var el = document.createElement('div');
  el.innerHTML = html;
  return el.textContent || el.innerText || '';
}

// Render customer badge: small icon-style abbreviation
function renderCustomerBadge(customerName) {
  if (!customerName) return '<span style="font-size:12px;color:var(--muted)">—</span>';
  return '<span class="cust-badge">' + escHtml(customerName) + '</span>';
}

// Navigate to customer-projects view and auto-select a customer
var _pendingCustSelect = null;
function gotoCustomerProjects(custName) {
  if (!custName) return;
  _pendingCustSelect = custName;
  if (typeof gotoView === 'function') gotoView('customer-projects');
}

// Render unified project identity block: [PE0406] 核心名 · CDLY
function renderProjectIdBlock(name, customerName) {
  var code = extractProjectCode(name);
  var core = extractCoreName(name);
  var html = '<span class="proj-code-tag">' + escHtml(code) + '</span> ' + escHtml(core);
  if (customerName) {
    html += ' ' + renderCustomerBadge(customerName);
  }
  return html;
}
