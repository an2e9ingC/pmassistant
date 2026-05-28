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

function showToast(msg, type) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'toast ' + (type || 'error');
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(function() { el.remove(); }, 4000);
}
