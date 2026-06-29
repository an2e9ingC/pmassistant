/* ═══════════════════════════════════════════════════
   CONSTANTS & HELPERS
═══════════════════════════════════════════════════ */
const STATUS_TXT = {completed:'已完成',incomplete:'待完善',active:'进行中',blocked:'已阻塞',pending:'未开始',planning:'规划中',canceled:'已取消',normal:'正常',closed:'已关闭',wait:'未开始',doing:'进行中',done:'已完成',suspended:'已暂停',resolved:'已解决',todo:'待办',in_progress:'进行中',review:'评审中'};
var TYPE_TXT = {RD:'研发',SC:'生产'};  // updated by initProjectTypeLabels() from API
function getProjectTypeLabel(type) {
  return TYPE_TXT[type] || type || '研发';
}
async function initProjectTypeLabels() {
  try {
    var data = await API.get('/doc-templates/project-types');
    if (data && data.length) {
      data.forEach(function(pt) { TYPE_TXT[pt.id] = pt.label; });
    }
  } catch(e) { /* use defaults */ }
}

const G_START = new Date('2025-01-01');
const G_END   = new Date('2027-01-01');
const G_SPAN  = G_END - G_START;

function d2pct(ds) {
  const t = new Date(ds) - G_START;
  return Math.max(0, Math.min(100, (t / G_SPAN) * 100));
}

function fmtLocalDate(d) { d=d||new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }

function todayPct() {
  return d2pct(fmtLocalDate());
}

function clearSearch(inputId, callback) {
  var inp = document.getElementById(inputId);
  if (!inp) return;
  inp.value = '';
  inp.focus();
  if (typeof callback === 'function') callback('');
  else if (inp.oninput) inp.oninput();
}

function formatDate(d) {
  if (!d) return '';
  const s = String(d);
  return s.length >= 10 ? s.substring(0, 10) : s;
}

function formatShortDate(d) {
  if (!d) return '';
  var s = String(d);
  if (s.length < 10) return s;
  // YYYY-MM-DD → M月D日
  var parts = s.substring(0, 10).split('-');
  var m = parseInt(parts[1], 10);
  var day = parseInt(parts[2], 10);
  return m + '月' + day + '日';
}

var _pmaSettings = null; // cached settings from API

async function loadPmaSettings() {
  try { _pmaSettings = await API.get('/admin/settings'); } catch(e) { _pmaSettings = null; }
}

function isPwVerifyEnabled(settingKey) {
  if (!_pmaSettings || !_pmaSettings[settingKey]) return true; // default: enabled
  return _pmaSettings[settingKey].value !== false;
}

function verifyPassword(action, settingKey) {
  // Check if confirmation is enabled for this operation
  if (settingKey && !isPwVerifyEnabled(settingKey)) return Promise.resolve(true);
  var confirmStr = action || '此操作';
  return new Promise(function(resolve) {
    var id = 'confirm-dlg-' + Date.now();
    // Store confirm string + resolve on window so inline handlers can access them
    window['_cd_' + id] = { str: confirmStr, resolve: resolve };
    var html = '<div class="note-dialog-overlay" id="' + id + '">' +
      '<div class="note-dialog" style="max-width:440px">' +
        '<div class="note-dialog-head"><span class="note-dialog-title">操作确认</span>' +
          '<button class="note-dialog-close" onclick="_confirmClose(\'' + id + '\',false)">&times;</button></div>' +
        '<div style="padding:4px 0">' +
          '<p style="font-size:13px;margin-bottom:12px">' + escHtml(action) + '</p>' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;padding:10px 14px;background:var(--bg);border:1px solid var(--border);border-radius:8px">' +
            '<code style="flex:1;font-size:15px;font-weight:700;color:var(--danger);word-break:break-all;font-family:var(--mono)" id="' + id + '-code">' + escHtml(confirmStr) + '</code>' +
            '<button class="btn-icon" title="复制" onclick="_copyConfirmText(\'' + id + '\')" style="flex-shrink:0">' +
              '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="9" height="11" rx="1"/><path d="M11 2H3a1 1 0 0 0-1 1v9"/></svg></button>' +
          '</div>' +
          '<div class="user-form-field">' +
            '<label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px">请输入上方红色文字确认</label>' +
            '<input class="config-input" id="' + id + '-input" type="text" placeholder="输入确认文字..." style="width:100%;box-sizing:border-box;font-family:var(--mono)" onkeydown="if(event.key===\'Enter\')_confirmSubmit(\'' + id + '\')">' +
            '<div id="' + id + '-msg" style="font-size:11px;min-height:16px;margin-top:4px"></div>' +
          '</div>' +
        '</div>' +
        '<div style="display:flex;justify-content:flex-end;align-items:center;gap:10px;margin-top:8px">' +
          '<button class="btn" onclick="_confirmClose(\'' + id + '\',false)">取消</button>' +
          '<button class="btn btn-primary" id="' + id + '-btn" onclick="_confirmSubmit(\'' + id + '\')">确认</button>' +
        '</div></div></div>';
    document.body.insertAdjacentHTML('beforeend', html);
    setTimeout(function() {
      var inp = document.getElementById(id + '-input');
      if (inp) inp.focus();
    }, 100);
  });
}

async function openCustomerByName(name) {
  if (!name) return;
  // If multiple names separated by "、", try each one individually
  var names = name.split('、').filter(Boolean);
  var found = null;
  try {
    for (var i = 0; i < names.length; i++) {
      var customers = await API.get('/customers?search=' + encodeURIComponent(names[i].trim()));
      if (customers && customers.length) {
        found = customers[0];
        break;
      }
    }
    if (found) {
      localStorage.setItem('pm_cust_id', found.id);
      gotoView('customer-detail');
    } else {
      showToast('未找到客户: ' + name, 'warn');
    }
  } catch(e) {
    showToast('查找客户失败', 'error');
  }
}

function compactDate(d) {
  if (!d) return '';
  var s = String(d);
  if (s.length < 10) return s;
  // YYYY-MM-DD → M/D
  var parts = s.substring(0, 10).split('-');
  var m = parseInt(parts[1], 10);
  var day = parseInt(parts[2], 10);
  return m + '/' + day;
}

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escJs(str) {
  if (!str) return '';
  return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
}

/* ── Confirm dialog helpers ── */

function _confirmClose(id, result) {
  var dlg = document.getElementById(id);
  if (dlg) dlg.remove();
  var data = window['_cd_' + id];
  if (data && data.resolve) data.resolve(result);
  delete window['_cd_' + id];
}

function _confirmSubmit(id) {
  var data = window['_cd_' + id];
  var input = document.getElementById(id + '-input');
  var msg = document.getElementById(id + '-msg');
  var val = (input.value || '').trim();
  if (!val) { msg.innerHTML = '<span style="color:var(--danger)">请输入确认文字</span>'; return; }
  if (val !== data.str) { msg.innerHTML = '<span style="color:var(--danger)">输入不匹配</span>'; return; }
  _confirmClose(id, true);
}

function _copyConfirmText(id) {
  var code = document.getElementById(id + '-code');
  if (!code) return;
  var text = code.textContent || '';
  try {
    // Try modern clipboard API first
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function() {
        showToast('已复制到剪贴板', 'success');
      }).catch(function() {
        _fallbackCopy(text);
      });
    } else {
      _fallbackCopy(text);
    }
  } catch(e) {
    _fallbackCopy(text);
  }
}

function _fallbackCopy(text) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed'; ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    showToast('已复制到剪贴板', 'success');
  } catch(e) {
    showToast('复制失败，请手动复制', 'error');
  }
  document.body.removeChild(ta);
}

// Notification queue (shared between toast + bell)
var _notifQueue = [];
var _notifUnread = 0;

function showToast(msg, type, duration, allowHtml, bellMsg) {
  type = type || 'info';
  // Add to notification queue for bell dropdown (plain text only)
  _notifQueue.unshift({ message: bellMsg || msg, type: type, time: new Date().toLocaleTimeString() });
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
  var content = allowHtml ? msg : escHtml(msg);
  el.innerHTML = '<span>' + content + '</span>' + closeHtml;
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
function extractProjectCode(name, code) {
  if (code) return code;
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

// Navigate to customer detail (replaces old topology redirect)
var _pendingCustSelect = null;
function gotoCustomerProjects(custName) {
  if (!custName) return;
  openCustomerByName(custName);
}

// Render project code tag — clickable to project detail by default
function projCodeTag(code, clickHandlerOrProjectId) {
  var handler = clickHandlerOrProjectId;
  if (typeof handler === 'number' || (typeof handler === 'string' && /^\d+$/.test(handler))) {
    handler = 'openProject(' + handler + ')';
  }
  if (handler) {
    return '<span class="proj-code-btn" onclick="' + handler + '" title="查看项目详情">' + escHtml(code) + '</span>';
  }
  return '<span class="proj-code-btn" style="cursor:default">' + escHtml(code) + '</span>';
}

function renderProjectIdBlock(name, customerName) {
  var code = extractProjectCode(name);
  var core = extractCoreName(name);
  var html = projCodeTag(code) + ' ' + escHtml(core);
  if (customerName) {
    html += ' ' + renderCustomerBadge(customerName);
  }
  return html;
}
