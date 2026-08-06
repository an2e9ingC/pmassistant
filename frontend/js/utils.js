/* ═══════════════════════════════════════════════════
   CONSTANTS & HELPERS
═══════════════════════════════════════════════════ */
const STATUS_TXT = {completed:'已完成',incomplete:'待完善',active:'进行中',blocked:'已阻塞',pending:'未开始',planning:'规划中',canceled:'已取消',normal:'正常',closed:'已关闭',wait:'未开始',doing:'进行中',done:'已完成',suspended:'已暂停',resolved:'已解决',todo:'待办',in_progress:'进行中',review:'评审中',open:'待确认',confirmed:'已确认',gitlab_submitted:'GitLab已提交'};
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
  // Unified priority badge (badge style with background, from tasks.js impl)
  var colors = {low: 'var(--success)', medium: 'var(--warn)', high: 'var(--warn)', critical: 'var(--danger)'};
  var labels = {low: '低', medium: '中', high: '高', critical: '紧急'};
  return '<span style="display:inline-block;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600;color:#fff;background:' + (colors[p] || 'var(--muted)') + '">' + (labels[p] || p) + '</span>';
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
