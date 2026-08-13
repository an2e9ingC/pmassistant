/* ═══════════════════════════════════════════════════
   CONSTANTS & HELPERS
═══════════════════════════════════════════════════ */
const STATUS_TXT = {completed:'已完成',incomplete:'待完善',active:'进行中',blocked:'已阻塞',pending:'未开始',planning:'规划中',canceled:'已取消',normal:'正常',closed:'已关闭',wait:'未开始',doing:'进行中',done:'已完成',suspended:'已暂停',abolished:'已废止',resolved:'已解决',todo:'待办',in_progress:'进行中',review:'评审中',open:'待确认',confirmed:'已确认',gitlab_submitted:'GitLab已提交'};
var TYPE_TXT = {RD:'研发项目',SC:'生产项目'};  // updated by initProjectTypeLabels() from API

// CSS zoom on <html> creates a coordinate mismatch between getBoundingClientRect()
// (viewport coords) and position:fixed left/top (scaled by zoom). Divide by zoom
// to align them. Use in all position:fixed element placements.
function _getZoom() {
  var z = parseFloat(getComputedStyle(document.documentElement).zoom);
  return (z && z > 0) ? z : 1;
}
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

function fmtLocalDate(d) { d=d||new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function fmtHours(h) { if (!h || h <= 0) return "0h"; var hrs = Math.floor(h); var mins = Math.round((h - hrs) * 60); if (mins === 60) { hrs++; mins = 0; } return hrs + "h" + (mins > 0 ? mins + "m" : ""); }

function clearSearch(inputId, callback) {
  var inp = document.getElementById(inputId);
  if (!inp) return;
  inp.value = '';
  inp.focus();
  if (typeof callback === 'function') callback('');
  else if (inp.oninput) inp.oninput();
}

function fmtISODateTime(isoStr) {
  // Convert ISO 8601 UTC string (e.g. "2026-07-18T09:58:19Z") to local-time display "2026-07-18 17:58:59"
  if (!isoStr) return '';
  try {
    var d = new Date(isoStr);
    if (isNaN(d.getTime())) return String(isoStr).substring(0, 19); // fallback: return as-is up to 19 chars
    return d.getFullYear() + '-' +
      String(d.getMonth()+1).padStart(2,'0') + '-' +
      String(d.getDate()).padStart(2,'0') + ' ' +
      String(d.getHours()).padStart(2,'0') + ':' +
      String(d.getMinutes()).padStart(2,'0') + ':' +
      String(d.getSeconds()).padStart(2,'0');
  } catch(e) {
    return String(isoStr).substring(0, 19);
  }
}

function formatDate(d) {
  if (!d) return '';
  const s = String(d);
  return s.length >= 10 ? s.substring(0, 10) : s;
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
            '<code style="flex:1;font-size:15px;font-weight:700;color:var(--danger);word-break:break-all;font-family:KaiTi,STKaiti,serif" id="' + id + '-code">' + escHtml(confirmStr) + '</code>' +
            '<button class="btn-icon" title="复制" onclick="_copyConfirmText(\'' + id + '\')" style="flex-shrink:0;color:var(--fg)">' +
              '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="9" height="11" rx="1"/><path d="M11 2H3a1 1 0 0 0-1 1v9"/></svg></button>' +
          '</div>' +
          '<div class="user-form-field">' +
            '<label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px">请输入上方红色文字确认</label>' +
            '<input class="config-input" id="' + id + '-input" type="text" placeholder="输入确认文字..." style="width:100%;box-sizing:border-box;font-family:KaiTi,STKaiti,serif" onkeydown="if(event.key===\'Enter\')_confirmSubmit(\'' + id + '\')">' +
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

function renderPriorityBadge(p) {
  // Unified priority badge — uses .prio-tag CSS for consistent colors across all pages
  var labels = {low: '低', medium: '中', high: '高', critical: '紧急'};
  return '<span class="prio-tag ' + (p || 'medium') + '">' + (labels[p] || p) + '</span>';
}

function _filterSearchableItems(input) {
  // Shared: filter dropdown items by data-search-text attribute
  var q = (input.value || '').toLowerCase();
  var list = input.nextElementSibling;
  if (!list) return;
  list.querySelectorAll('.searchable-item').forEach(function(item) {
    item.style.display = q ? (item.getAttribute('data-search-text').indexOf(q) >= 0 ? '' : 'none') : '';
  });
}

function _hasProjectEditPerm() {
  // Shared: check if current user can edit projects
  if (typeof getCurrentUser !== 'function') return false;
  var user = getCurrentUser();
  var perms = (user && user.permissions) ? user.permissions.split(',') : [];
  return perms.indexOf('project_edit') !== -1 || perms.indexOf('admin') >= 0;
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
  return '<span class="cust-badge" onclick="event.stopPropagation();openCustomerByName(\''+escHtml(customerName).replace(/'/g,"\\'")+'\')" title="查看客户详情">' + escHtml(customerName) + '</span>';
}

// Used by topology.js to pre-fill customer search
var _pendingCustSelect = null;

// Render project code tag — clickable to project detail by default
// Usage: projCodeTag(code, handler) or projCodeTag(code, handler, projectName)
function projCodeTag(code, clickHandlerOrProjectId, projectName) {
  var handler = clickHandlerOrProjectId;
  if (typeof handler === 'number' || (typeof handler === 'string' && /^\d+$/.test(handler))) {
    handler = 'openProject(' + handler + ')';
  }
  var title = projectName || code || '查看项目详情';
  if (handler) {
    return '<span class="proj-code-btn" onclick="event.stopPropagation();' + handler + '" title="' + escHtml(title) + '">' + escHtml(code) + '</span>';
  }
  return '<span class="proj-code-btn" style="cursor:default" title="' + escHtml(title) + '">' + escHtml(code) + '</span>';
}

function renderProjectIdBlock(name, customerName) {
  var html = projCodeTag('', null, name) + ' ' + escHtml(name || '');
  if (customerName) {
    html += ' ' + renderCustomerBadge(customerName);
  }
  return html;
}

/* ── Note Image Paste + Upload ── */

function initNoteImagePaste(textareaId) {
  var ta = document.getElementById(textareaId);
  if (!ta) return;
  // Auto-resize textarea on input (grow with content, capped at max-height)
  ta.style.overflowY = 'hidden';
  ta.addEventListener('input', function() {
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  });
  var previewId = textareaId + '-img-preview';
  ta.addEventListener('paste', function(e) {
    var items = (e.clipboardData || e.originalEvent.clipboardData).items;
    for (var i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') === 0) {
        e.preventDefault();
        var blob = items[i].getAsFile();
        var reader = new FileReader();
        reader.onload = function(ev) {
          var dataUrl = ev.target.result;
          var idx = _noteImgCounter++;
          // Store image data
          window._noteImages = window._noteImages || {};
          window._noteImages[idx] = { dataUrl: dataUrl, width: null };
          // Insert placeholder in textarea
          var start = ta.selectionStart;
          var end = ta.selectionEnd;
          var text = ta.value;
          var placeholder = '[img-' + idx + ']';
          ta.value = text.substring(0, start) + placeholder + text.substring(end);
          ta.selectionStart = ta.selectionEnd = start + placeholder.length;
          // Add resizable image to preview
          _addNoteImagePreview(previewId, idx, dataUrl);
          ta.dispatchEvent(new Event('input'));
        };
        reader.readAsDataURL(blob);
        return;
      }
    }
  });
}
var _noteImgCounter = 0;

function _addNoteImagePreview(previewId, idx, dataUrl) {
  var container = document.getElementById(previewId);
  if (!container) return;
  var wrap = document.createElement('div');
  wrap.style.cssText = 'position:relative;display:inline-block;margin:4px;vertical-align:top';
  wrap.id = 'img-wrap-' + idx;
  var img = document.createElement('img');
  img.src = dataUrl;
  img.style.cssText = 'max-width:100%;height:auto;border:1px solid var(--border);border-radius:4px;cursor:default';
  img.style.width = '200px';  // default size
  window._noteImages[idx].width = 200;
  // Resize handle
  var handle = document.createElement('div');
  handle.style.cssText = 'position:absolute;right:0;bottom:0;width:10px;height:10px;background:var(--accent);cursor:se-resize;border-radius:0 0 4px 0';
  handle.title = '拖拽调整大小';
  // Drag resize logic
  var startX, startY, startW;
  handle.addEventListener('mousedown', function(ev) {
    ev.preventDefault();
    ev.stopPropagation();
    startX = ev.clientX;
    startY = ev.clientY;
    startW = img.offsetWidth;
    function onMove(me) {
      var newW = Math.max(40, startW + (me.clientX - startX));
      img.style.width = newW + 'px';
      window._noteImages[idx].width = newW;
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
  // Remove button
  var delBtn = document.createElement('button');
  delBtn.textContent = '×';
  delBtn.style.cssText = 'position:absolute;top:-6px;right:-6px;width:18px;height:18px;border-radius:50%;border:1px solid var(--danger);background:var(--surface);color:var(--danger);font-size:11px;line-height:1;cursor:pointer';
  delBtn.title = '移除图片';
  delBtn.onclick = function() {
    var imgData = (window._noteImages || {})[idx];
    wrap.remove();
    delete (window._noteImages || {})[idx];
    var ta = document.getElementById(textareaId);
    if (!ta) return;
    if (imgData && imgData.uploaded) {
      // Remove existing markdown image syntax
      var escaped = imgData.dataUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      var re = new RegExp('!\\[\\]\\(' + escaped + '\\s*=\\d+x\\)', 'g');
      ta.value = ta.value.replace(re, '');
    } else {
      ta.value = ta.value.replace('[img-' + idx + ']', '');
    }
  };
  wrap.appendChild(img);
  wrap.appendChild(handle);
  wrap.appendChild(delBtn);
  container.appendChild(wrap);
}

// Parse existing images in content and add them to preview
function _loadExistingNoteImages(content, previewId) {
  // Match images with optional width suffix: ![](url) or ![](url =200x)
  var regex = /!\[\]\((\/api\/note-images\/[^)]+?)(?:\s*=(\d+)x)?\)/g;
  var match;
  while ((match = regex.exec(content)) !== null) {
    var url = match[1];
    var width = parseInt(match[2]) || 200;
    var idx = _noteImgCounter++;
    window._noteImages = window._noteImages || {};
    window._noteImages[idx] = { dataUrl: url, width: width, uploaded: true };
    _addNoteImagePreview(previewId, idx, url);
  }
}

function _clearNoteImagePreviews(previewId) {
  var container = document.getElementById(previewId);
  if (container) container.innerHTML = '';
  window._noteImages = {};
  _noteImgCounter = 0;
}

// Upload new images, update size for existing images
async function _uploadNoteImages(content) {
  var imgs = window._noteImages || {};
  // Process new images (base64 data URLs)
  var newRegex = /\[img-(\d+)\]/g;
  var match;
  while ((match = newRegex.exec(content)) !== null) {
    var idx = parseInt(match[1]);
    var imgData = imgs[idx];
    if (!imgData || imgData.uploaded) continue;
    try {
      var resp = await fetch(imgData.dataUrl);
      var blob = await resp.blob();
      var formData = new FormData();
      formData.append('file', blob, 'image.' + (blob.type.split('/')[1] || 'png'));
      var uploadResp = await fetch('/api/note-images', { method: 'POST', body: formData, headers: { 'Authorization': 'Bearer ' + (API.token || localStorage.getItem('pma_token')) } });
      var uploadJson = await uploadResp.json();
      if (uploadJson.code === 0 && uploadJson.data && uploadJson.data.url) {
        var md = imgData.width ? '![](' + uploadJson.data.url + ' =' + imgData.width + 'x)' : '![](' + uploadJson.data.url + ')';
        content = content.replace('[img-' + idx + ']', md);
        imgData.dataUrl = uploadJson.data.url;
        imgData.uploaded = true;
      }
    } catch(e) { /* keep placeholder if upload fails */ }
  }
  // Update width for existing images: find all ![](url =Wx) and update W from _noteImages
  var existingRegex = /!\[\]\((\/api\/note-images\/[^) ]+)\s*=(\d+)x\)/g;
  var existingMatch;
  while ((existingMatch = existingRegex.exec(content)) !== null) {
    var url = existingMatch[1];
    for (var key in imgs) {
      if (imgs[key].dataUrl === url) {
        var w = imgs[key].width;
        if (w && parseInt(existingMatch[2]) !== w) {
          content = content.replace(existingMatch[0], '![](' + url + ' =' + w + 'x)');
        }
        break;
      }
    }
  }
  return content;
}

/* ── Legacy Markdown Compatibility (image-size suffix ` =WxH`) ── */

/**
 * Convert legacy markdown image-size syntax `![alt](url =WxH)` to <img> HTML.
 * Syntax variants handled: ` =200x` (width only), ` =200x300`, ` =200x*` (auto height).
 * `=` must be preceded by whitespace (`\s+`), matching how ZenTao/PMA write the suffix —
 * this avoids false positives on URLs with query strings like `image.png?size=200x300`,
 * where the greedy URL capture would otherwise backtrack and swallow the `=NNNxNNN`.
 * marked v15 has no support for this suffix and would render the whole `![](...)` literally.
 */
function mdImgSizeToHtml(md) {
  return String(md).replace(/!\[([^\]]*)\]\(([^)\s]+)\s+=(\d{1,4})x(\d{1,4}|[*])?\)/g,
    function(m, alt, url, w, h) {
      var html = '<img src="' + escHtml(url) + '" alt="' + escHtml(alt) + '" width="' + w + '"';
      if (h && h !== '*') html += ' height="' + h + '"';
      return html + '>';
    });
}

/**
 * Convert content to HTML for display and rich-editor init.
 * - HugeRTE HTML content (starts with a tag) is passed through unchanged.
 * - Legacy Markdown is parsed via marked, with image-size suffix support (mdImgSizeToHtml).
 * @param {boolean} [forceMarkdown] - if true, always parse as Markdown (used for raw .md
 *   file previews); do not short-circuit content that starts with an HTML tag.
 */
function markdownToHtml(md, forceMarkdown) {
  if (!md) return '';
  var s = String(md).trim();
  // Already HTML (HugeRTE stores HTML content) — return as-is, unless forceMarkdown
  if (!forceMarkdown && /^\s*</.test(s)) return s;
  // Legacy Markdown content — preprocess image-size suffix, then convert to HTML
  try {
    if (typeof marked !== 'undefined' && marked.parse) {
      return marked.parse(mdImgSizeToHtml(s));
    }
  } catch(e) {}
  return '<pre style="white-space:pre-wrap;font-size:13px">' + escHtml(md) + '</pre>';
}

/* ===================================================================
   HugeRTE Rich Text Editor — init, content, upload, theme
   =================================================================== */

var _hugerteSkinInited = false;

/** Inject HugeRTE editor chrome CSS overrides to match PMA theme */
function _ensureHugerteSkin() {
  if (_hugerteSkinInited || document.getElementById('hugerte-skin-override')) return;
  _hugerteSkinInited = true;
  var style = document.createElement('style');
  style.id = 'hugerte-skin-override';
  style.textContent = [
    '.tox .tox-toolbar, .tox .tox-toolbar__primary { background:var(--surface) !important; border-color:var(--border) !important; }',
    '.tox .tox-tbtn { color:var(--fg) !important; }',
    '.tox .tox-tbtn:hover { background:var(--surface2) !important; }',
    '.tox .tox-tbtn--enabled, .tox .tox-tbtn--enabled:hover { background:var(--accent-lt) !important; color:var(--accent) !important; }',
    '.tox .tox-edit-area__iframe { background:var(--bg) !important; }',
    '.tox .tox-statusbar { background:var(--surface) !important; border-color:var(--border) !important; color:var(--muted) !important; }',
    '.tox .tox-dialog { background:var(--surface) !important; border:1px solid var(--border) !important; }',
    '.tox .tox-dialog__header, .tox .tox-dialog__footer { background:var(--surface) !important; }',
    '.tox .tox-dialog__title { color:var(--fg) !important; }',
    '.tox .tox-textfield, .tox .tox-listboxfield .tox-listbox, .tox .tox-textarea { background:var(--bg) !important; color:var(--fg) !important; border-color:var(--border) !important; }',
    '.tox .tox-menu { background:var(--surface) !important; border-color:var(--border) !important; }',
    '.tox .tox-collection__item { color:var(--fg) !important; }',
    '.tox .tox-collection__item--active { background:var(--accent-lt) !important; }',
    '.tox .tox-collection__item--enabled { color:var(--fg) !important; }',
  ].join('\n');
  document.head.appendChild(style);
}

/** Read PMA CSS variables and build content_style for HugeRTE iframe */
function _getEditorContentStyle() {
  var cs = getComputedStyle(document.documentElement);
  var fg = cs.getPropertyValue('--fg').trim() || '#17191F';
  var bg = cs.getPropertyValue('--bg').trim() || '#F4F6FB';
  var accent = cs.getPropertyValue('--accent').trim() || '#2563EB';
  var muted = cs.getPropertyValue('--muted').trim() || '#6B7694';
  var surface2 = cs.getPropertyValue('--surface2').trim() || '#EBEFF5';
  var border = cs.getPropertyValue('--border').trim() || '#E3E8F4';
  return [
    'body { font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif; font-size:13px;',
    '  color:' + fg + '; background:' + bg + '; padding:8px 12px; margin:0; line-height:1.6; }',
    'a { color:' + accent + '; }',
    'img { max-width:100%; height:auto; }',
    'code { font-family:ui-monospace,monospace; background:' + surface2 + '; padding:1px 4px; border-radius:3px; }',
    'pre { background:' + surface2 + '; padding:8px; border-radius:4px; overflow-x:auto; }',
    'td,th { border:1px solid ' + border + '; padding:4px 8px; }',
    'table { border-collapse:collapse; width:100%; }',
    'blockquote { border-left:3px solid ' + accent + '; padding-left:12px; margin-left:0; color:' + muted + '; }'
  ].join('\n');
}

/** Image upload handler for HugeRTE -> POST /api/note-images */
function _hugerteImageUploadHandler(blobInfo, progress) {
  var formData = new FormData();
  formData.append('file', blobInfo.blob(), blobInfo.filename());
  var token = (typeof API !== 'undefined' && API.token) ? API.token : (localStorage.getItem('pma_token') || '');
  return fetch('/api/note-images', {
    method: 'POST',
    body: formData,
    headers: { 'Authorization': 'Bearer ' + token }
  }).then(function(r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }).then(function(j) {
    if (j.code === 0 && j.data && j.data.url) {
      return j.data.url;
    }
    throw new Error(j.message || 'Upload failed');
  });
}

/**
 * Initialize HugeRTE rich text editor on a textarea.
 * @param {string} textareaId - DOM id of the <textarea>
 * @param {object} [options]
 * @param {number} [options.height=360]
 * @param {string|boolean} [options.toolbar] - toolbar config, false = no toolbar
 * @param {string} [options.plugins] - plugin list
 * @param {function} [options.images_upload_handler] - custom upload handler
 * @param {function} [options.onInit] - called after editor is ready
 * @returns {string|null} textareaId on success, null if element not found
 */
function initRichEditor(textareaId, options) {
  var ta = document.getElementById(textareaId);
  if (!ta) return null;
  options = options || {};

  // Destroy existing instance (idempotent)
  if (typeof hugerte !== 'undefined' && hugerte.get(textareaId)) {
    hugerte.get(textareaId).remove();
  }
  if (typeof hugerte === 'undefined') {
    console.error('HugeRTE not loaded');
    return null;
  }

  // Ensure theme CSS is injected
  _ensureHugerteSkin();

  // Get initial content: already HTML, or Markdown -> convert via markdownToHtml
  // (handles HugeRTE HTML passthrough + legacy markdown image-size syntax)
  var rawContent = ta.value || '';
  var htmlContent = markdownToHtml(rawContent);

  var defaultToolbar = 'undo redo | blocks fontsize | bold italic underline strikethrough forecolor backcolor |'
    + ' alignleft aligncenter alignright | bullist numlist | link image table | code removeformat';

  var isSimple = options.toolbar === false;
  var isDark = document.documentElement.getAttribute('data-theme') === 'dark';

  hugerte.init({
    target: ta,
    height: options.height || 360,
    menubar: false,
    statusbar: false,
    skin: isDark ? 'oxide-dark' : 'oxide',
    content_css: isDark ? 'dark' : 'default',
    plugins: options.plugins || (isSimple ? 'autolink lists code' : 'autolink image link lists table code'),
    toolbar: isSimple ? false : (options.toolbar || defaultToolbar),
    block_formats: '段落=p;标题2=h2;标题3=h3;标题4=h4;代码块=pre',
    font_size_formats: '12px 13px 14px 16px 18px 20px 24px',
    branding: false,
    promotion: false,
    paste_data_images: true,
    images_upload_handler: options.images_upload_handler || _hugerteImageUploadHandler,
    content_style: _getEditorContentStyle(),
    setup: function(editor) {
      editor.on('init', function() {
        if (htmlContent) editor.setContent(htmlContent);
        // Sync editor content -> hidden textarea value
        editor.on('change input', function() {
          ta.value = editor.getContent();
        });
        if (options.onInit) options.onInit(editor);
      });
    }
  });

  // Store mapping (textareaId -> original init options, for theme re-build)
  window._hugerteMap = window._hugerteMap || {};
  window._hugerteMap[textareaId] = options;
  return textareaId;
}

/** Get HTML content from a HugeRTE editor instance */
function getEditorContent(textareaId) {
  var ed = hugerte.get(textareaId);
  return ed ? ed.getContent() : '';
}

/** Destroy a HugeRTE editor instance and restore the textarea */
function destroyEditor(textareaId) {
  if (hugerte.get(textareaId)) { hugerte.get(textareaId).remove(); }
  delete (window._hugerteMap || {})[textareaId];
  var ta = document.getElementById(textareaId);
  if (ta) ta.style.display = '';
}

/** Re-build all open editors to match the current theme (content is preserved). */
function refreshEditorThemes() {
  if (typeof hugerte === 'undefined') return;
  var map = window._hugerteMap || {};
  Object.keys(map).forEach(function(taId) {
    var ed = hugerte.get(taId);
    var ta = document.getElementById(taId);
    if (!ed || !ta) return;
    // Preserve current content back to the textarea before rebuilding with the new skin
    ta.value = ed.getContent();
    ed.remove();
    initRichEditor(taId, map[taId] || {});
  });
}

// Watch the `data-theme` attribute so open editors re-theme in real time.
(function() {
  var root = document.documentElement;
  if (!root || typeof MutationObserver === 'undefined') return;
  var last = root.getAttribute('data-theme');
  new MutationObserver(function() {
    var cur = root.getAttribute('data-theme');
    if (cur !== last) {
      last = cur;
      refreshEditorThemes();
    }
  }).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
})();

/* ── DEPRECATED: Old image paste system (replaced by HugeRTE) ── */
// initNoteImagePaste, _addNoteImagePreview, _loadExistingNoteImages,
// _clearNoteImagePreviews, _uploadNoteImages, _noteImgCounter
// These are kept for reference; new code should use initRichEditor().
