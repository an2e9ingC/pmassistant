/* ═══════════════════════════════════════════════════
   REUSABLE RENDERING FUNCTIONS
═══════════════════════════════════════════════════ */

/* ── Standard Icon Buttons (emoji style, consistent with doc-templates) ── */

function iconEdit(onclick, title) {
  return iconBtn('✎', title || '编辑', onclick);
}

function iconDelete(onclick, title) {
  return iconBtn('✕', title || '删除', onclick, true);
}

function iconToggle(onclick, title) {
  return iconBtn('↻', title || '切换', onclick);
}

function iconEye(onclick, title) {
  return iconBtn('👁', title || '预览', onclick);
}

function iconCopy(onclick, title) {
  return iconBtn('📋', title || '复制', onclick);
}

function iconUpload(onclick, title) {
  return iconBtn('📤', title || '上传', onclick);
}

function iconDownload(onclick, title) {
  return iconBtn('📥', title || '下载', onclick);
}

function iconAdd(onclick, title) {
  return iconBtn('＋', title || '添加', onclick);
}

function iconLink(onclick, title) {
  return iconBtn('↗', title || '打开', onclick);
}

function iconRestore(onclick, title) {
  return iconBtn('🔄', title || '恢复', onclick);
}

/* ── Favorite helpers ── */

/* ═══════════════════════════════════════════════════
   FAVORITES — unified product + project fav, persisted to DB
   Usage: favStar(type, id) returns HTML; isFav(type, id) checks
   ═══════════════════════════════════════════════════ */

var _favProducts = [];
var _favProjects = [];
var _favLoaded = false;

async function loadFavorites() {
  if (_favLoaded) return;
  try {
    var data = await API.get('/auth/favorites');
    // Handle old format migration: flat array → {products:[], projects:[]}
    if (Array.isArray(data)) { _favProducts = data; _favProjects = []; }
    else { _favProducts = (data && data.products) ? data.products : []; _favProjects = (data && data.projects) ? data.projects : []; }
  } catch(e) { _favProducts = []; _favProjects = []; }
  _favLoaded = true;
}

// Backward compat: product.js callers use this
async function loadFavProducts() { await loadFavorites(); }

function getFavProducts() { return _favProducts; }

function isFav(type, id) {
  if (typeof type !== 'string') return false;
  var list = type === 'product' ? _favProducts : _favProjects;
  return list.indexOf(id) >= 0;
}

// Backward compat
function isFavProduct(id) { return isFav('product', id); }

async function toggleFav(type, id) {
  var list = type === 'product' ? _favProducts : _favProjects;
  var idx = list.indexOf(id);
  if (idx >= 0) { list.splice(idx, 1); }
  else { list.push(id); }
  try {
    await API.put('/auth/favorites/toggle', {type: type, id: id});
  } catch(e) { /* revert on failure */ }
  return idx < 0;
}

// Backward compat
async function toggleFavProduct(id) { return await toggleFav('product', id); }

var _STAR_PATH = 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z';

// Sparkle burst on fav click
function _favSparkle(el) {
  var svg = el.querySelector('svg');
  if (!svg) return;
  svg.style.animation = 'none';
  svg.offsetHeight;
  svg.style.animation = 'fav-sparkle 0.5s ease-out';
  var rect = svg.getBoundingClientRect();
  var cx = rect.left + rect.width/2, cy = rect.top + rect.height/2;
  var colors = ['#eab308','#fbbf24','#f59e0b','#eab308','#fbbf24','#f59e0b','#eab308','#f59e0b'];
  for (var i=0; i<8; i++) {
    (function(idx){
      var dot = document.createElement('div');
      var angle = (idx/8)*Math.PI*2;
      var dist = 14 + Math.random()*16;
      dot.style.cssText = 'position:fixed;left:'+(cx-3)+'px;top:'+(cy-3)+'px;width:6px;height:6px;border-radius:50%;background:'+colors[idx]+';z-index:9999;pointer-events:none;--dx:'+(Math.cos(angle)*dist)+'px;--dy:'+(Math.sin(angle)*dist)+'px;animation:fav-burst-dot 0.7s ease-out forwards';
      document.body.appendChild(dot);
      setTimeout(function(){ dot.remove(); }, 750);
    })(i);
  }
}

function favStar(type, id, opts) {
  opts = opts || {};
  var fav = isFav(type, id);
  var s = parseInt(opts.size) || 16;
  var color = fav ? '#eab308' : 'var(--muted)';
  var fill = fav ? '#eab308' : 'none';
  var sw = 1.5;
  var title = fav ? (opts.unfavTitle || '取消收藏') : (opts.favTitle || '收藏');
  var stop = opts.stopPropagation ? 'event.stopPropagation();' : '';
  return '<span onclick="' + stop + 'toggleFav(\''+type+'\','+id+');_favSparkle(this);var s=this.querySelector(\'svg\');var c=s.getAttribute(\'data-fav\')===\'1\';s.setAttribute(\'data-fav\',c?\'0\':\'1\');var p=s.querySelector(\'path\');p.setAttribute(\'fill\',c?\'none\':\'#eab308\');p.setAttribute(\'stroke\',c?\'var(--muted)\':\'#eab308\')" style="cursor:pointer;display:inline-flex;vertical-align:middle;position:relative" title="' + title + '">' +
    '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" data-fav="' + (fav ? '1' : '0') + '" style="display:block">' +
      '<path d="' + _STAR_PATH + '" fill="' + fill + '" stroke="' + color + '" stroke-width="' + sw + '" stroke-linejoin="round"/>' +
    '</svg></span>';
}

function renderProgressCircle(percent, size, opts) {
  // Standard circular progress ring. opts: { color, label }
  // Percentage inside the ring, label below.
  opts = opts || {};
  var s = size || 56;
  var sw = Math.max(3, Math.round(s * 0.1));  // stroke: 10% of size
  var r = (s / 2) - sw;  // radius
  var cx = s / 2;
  var pct = Math.round(Math.min(100, Math.max(0, percent || 0)));
  var circumference = 2 * Math.PI * r;
  var dash = (pct / 100) * circumference;
  var gap = circumference - dash;
  var color = opts.color || (pct >= 100 ? 'var(--success)' : pct >= 75 ? 'var(--success)' : pct >= 50 ? 'var(--warn)' : pct > 0 ? 'var(--accent)' : 'var(--border)');
  var textSize = Math.round(s * 0.32);
  var labelSize = Math.round(s * 0.16);
  var label = opts.label !== undefined ? opts.label : '';
  var html = '<div class="ring-wrap" style="display:inline-flex;flex-direction:column;align-items:center;gap:4px">' +
    '<div style="position:relative;width:' + s + 'px;height:' + s + 'px">' +
    '<svg width="' + s + '" height="' + s + '" viewBox="0 0 ' + s + ' ' + s + '">' +
      '<circle cx="' + cx + '" cy="' + cx + '" r="' + r + '" fill="none" stroke="var(--border)" stroke-width="' + sw + '"/>' +
      '<circle cx="' + cx + '" cy="' + cx + '" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="' + sw + '"' +
        ' stroke-dasharray="' + dash.toFixed(1) + ' ' + gap.toFixed(1) + '" stroke-linecap="round" transform="rotate(-90 ' + cx + ' ' + cx + ')"/>' +
    '</svg>' +
    '<div style="position:absolute;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:' + textSize + 'px;font-weight:600;font-family:var(--mono);line-height:1">' +
      pct + '<span style="font-size:' + Math.round(textSize * 0.5) + 'px">%</span></div>' +
    '</div>';
  if (label) html += '<div style="font-size:' + labelSize + 'px;color:var(--muted);font-weight:500">' + label + '</div>';
  html += '</div>';
  return html;
}

function iconFav(onclick, active, title) {
  return '<button class="btn-icon" onclick="' + onclick + '" title="' + (title || '收藏') + '" style="font-size:16px;' + (active ? 'color:var(--warn)' : '') + '">' +
    (active ? '★' : '☆') + '</button>';
}

function renderProjIcon(type, code) {
  if (code) return projCodeTag(code);
  var t = (type || 'RD').toLowerCase();
  var label = t === 'sc' ? 'SC' : 'RD';
  return projCodeTag(label);
}

function renderTypeBadge(type) {
  var t = (type || 'RD').toLowerCase();
  return '<span class="badge badge-' + t + '">' + getProjectTypeLabel(type) + '项目</span>';
}

function renderPill(status) {
  return '<span class="pill ' + (status || 'pending') + '">' + (STATUS_TXT[status] || status) + '</span>';
}

// Deprecated: use renderProgressCircle instead
// renderProgressBar removed — all progress display now uses the ring component

function renderDelIcon(item) {
  if (item.done) {
    return '<div class="del-icon done">&#10003;</div>';
  } else if (item.warn) {
    return '<div class="del-icon warn">!</div>';
  }
  return '<div class="del-icon open"></div>';
}

function renderDeliverablesList(dels) {
  if (!dels || !dels.length) return '<span style="font-size:12px;color:var(--muted)">—</span>';
  return '<div class="del-list">' + dels.map(function(d) {
    var locHtml = d.location ? '<span class="doc-link" style="font-size:10.5px;padding:1px 6px">&#x2197; ' + escHtml(d.location) + '</span>' : '';
    var warnStyle = d.warn ? 'color:var(--danger)' : '';
    return '<div class="del-item">' +
      renderDelIcon(d) +
      '<span style="' + warnStyle + '">' + escHtml(d.name) + '</span>' +
      locHtml +
    '</div>';
  }).join('') + '</div>';
}

/* ═══════════════════════════════════════════════════
   FACTORY FUNCTIONS — Standardised HTML builders
   Prefer these over raw string concatenation for
   repeated UI patterns. See CLAUDE.md §10 for rules.
═══════════════════════════════════════════════════ */

/**
 * sectionHeader(title, count, btnLabel, onclick, id)
 * Renders a standard section-hd row:
 *   [Title (count)]              [Blue action button]
 *   - title + btnLabel are required; count can be null for no count display
 *   - btnLabel includes the verb + noun, e.g. "编辑项目背景"
 *   - onclick is the raw JS to execute (usually a function call)
 *   - id (optional): sets the id attribute on the section-hd div.
 *     Used with outerHTML to replace existing static section-hd elements
 *     (e.g. project maintenance tab); omit for dynamically generated sections.
 */
function sectionHeader(title, count, btnLabel, onclick, id) {
  var idAttr = id ? ' id="' + id + '"' : '';
  return '<div class="section-hd"' + idAttr + '>' +
    '<div class="section-title">' + title + (typeof count === 'number' ? ' (' + count + ')' : '') + '</div>' +
    '<button class="btn btn-primary btn-sm" onclick="' + onclick + '">' + btnLabel + '</button>' +
  '</div>';
}

/**
 * iconBtn(icon, title, onclick, danger)
 * Renders an icon-only button with tooltip.
 *   - icon: Unicode character (e.g. '✎', '✕', '📋', '🔄')
 *   - danger: if true, adds var(--danger) color
 */
function iconBtn(icon, title, onclick, danger) {
  return '<button class="btn btn-icon" style="' + (danger ? 'color:var(--danger)' : '') + '" ' +
    'onclick="' + onclick + '" title="' + title + '">' + icon + '</button>';
}

/**
 * chipTag(name, colorClass, onclick, removable)
 * Renders a small chip/tag badge.
 *   - colorClass: e.g. 'tag-0', 'tag-1' (predefined tag colors)
 *   - onclick: if provided, chip is clickable
 *   - removable: if true, shows × to remove
 */
function chipTag(name, colorClass, onclick, removable, removeOnclick) {
  return '<span class="tag-badge ' + (colorClass || '') + '"' +
    (onclick ? ' style="cursor:pointer" onclick="' + onclick + '"' : '') +
    '>#' + escHtml(name) +
    (removable ? ' <span onclick="' + (removeOnclick || '') + '" style="cursor:pointer;opacity:0.5;font-size:14px;line-height:1" title="移除">&times;</span>' : '') +
    '</span>';
}

/**
 * linkChip(name, onclick, title, color)
 * Renders a clickable chip for linked entities (products/projects/customers).
 *   - color: CSS var string, defaults to accent
 */
function linkChip(name, onclick, title, bgColor, fgColor) {
  return '<span class="prod-link-chip" onclick="' + onclick + '" title="' + (title || '') + '">' + escHtml(name) + '</span>';
}

/* ═══════════════════════════════════════════════════
   MULTI-SELECT DIALOG (design spec §15.1)
   Replaces 4 hand-rolled checkbox dialogs.
   ───────────────────────────────────────────────────
   multiSelectDialog(title, items, selectedIds, opts, onSave)
     title       — dialog title string
     items       — array of {id, name} or strings
     selectedIds — array of currently-selected IDs
     opts        — {idKey, labelKey, cbClass, placeholder, maxWidth}
     onSave      — callback(selectedIds), dialog closed before call
   ───────────────────────────────────────────────────
   Usage:
     multiSelectDialog('关联项目', projects, currentIds,
       {placeholder:'搜索项目...'}, function(ids) {
         API.put('/projects/1/linked', {ids:ids}).then(refresh);
       });
═══════════════════════════════════════════════════ */

function multiSelectDialog(title, items, selectedIds, opts, onSave) {
  opts = opts || {};
  var idKey = opts.idKey || 'id';
  var labelKey = opts.labelKey || 'name';
  var cbClass = opts.cbClass || 'multi-dlg-cb';
  var placeholder = opts.placeholder || '搜索...';
  var maxWidth = opts.maxWidth || 480;
  var selectedSet = {};
  (selectedIds || []).forEach(function(id) { selectedSet[id] = true; });

  var listHtml = (items || []).map(function(item) {
    var val, label, searchText;
    if (typeof item === 'object') {
      val = item[idKey]; label = item[labelKey];
      searchText = String(label).toLowerCase();
    } else {
      val = item; label = item; searchText = String(label).toLowerCase();
    }
    if (opts.renderItem) {
      label = opts.renderItem(item, selectedSet[val]);
      searchText = String(label).replace(/<[^>]+>/g, '').toLowerCase();
    }
    var checked = selectedSet[val] ? ' checked' : '';
    return '<label class="searchable-item" data-search-text="' + escHtml(searchText) +
      '" style="display:flex;align-items:center;gap:6px;padding:4px 0;font-size:13px;cursor:pointer">' +
      '<input type="checkbox" value="' + escHtml(String(val)) + '"' + checked + ' class="' + cbClass + '">' + label +
    '</label>';
  }).join('');

  openDialog(title,
    '<input class="search-inp" placeholder="' + placeholder + '" oninput="_filterSearchableItems(this)" style="margin-bottom:6px">' +
    '<div style="max-height:280px;overflow-y:auto;margin-bottom:8px" class="searchable-list">' + listHtml + '</div>',
    [{text: '取消', onclick: 'closeSharedDialog()'},
     {text: '保存', cls: 'btn-primary', onclick: '_multiSelectDialogSave(\'' + cbClass + '\')'}],
    {hideClose: true, maxWidth: maxWidth});

  // Store callback for save handler
  window._multiSelectDialogCallback = onSave;
}

function _multiSelectDialogSave(cbClass) {
  var ids = [];
  document.querySelectorAll('.' + cbClass + ':checked').forEach(function(cb) {
    var v = cb.value;
    // Try to preserve numeric IDs
    ids.push(/^\d+$/.test(v) ? parseInt(v) : v);
  });
  closeSharedDialog();
  if (typeof window._multiSelectDialogCallback === 'function') {
    window._multiSelectDialogCallback(ids);
    window._multiSelectDialogCallback = null;
  }
}

/* ═══════════════════════════════════════════════════
   SHARED DIALOG UTILITY
═══════════════════════════════════════════════════ */

function openDialog(title, bodyHtml, buttons, opts) {
  opts = opts || {};
  var overlayClass = opts.overlayClass || 'shared-dialog-overlay';
  var maxWidth = opts.maxWidth || 440;

  var existing = document.querySelector('.' + overlayClass);
  if (existing) existing.remove();

  var btnHtml = '';
  if (buttons && buttons.length) {
    btnHtml = '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">' +
      buttons.map(function(b) {
        return '<button class="btn ' + (b.cls || '') + '" onclick="' + b.onclick + '">' + b.text + '</button>';
      }).join('') +
    '</div>';
  }

  var closeHtml = opts.hideClose ? '' :
    '<button class="note-dialog-close" onclick="this.closest(\'.note-dialog-overlay\').remove()">&times;</button>';
  var widthStyle = typeof maxWidth === 'number' ? maxWidth + 'px' : maxWidth;
  var autoWidth = typeof maxWidth === 'number' ? '' : 'width:auto;';
  var html = '<div class="note-dialog-overlay ' + overlayClass + '">' +
    '<div class="note-dialog" style="' + autoWidth + 'max-width:' + widthStyle + '">' +
      '<div class="note-dialog-head"><span class="note-dialog-title">' + title + '</span>' +
        closeHtml + '</div>' +
      bodyHtml +
      btnHtml +
    '</div></div>';
  document.body.insertAdjacentHTML('beforeend', html);

  // Auto-focus first focusable element in dialog
  var overlay = document.querySelector('.' + overlayClass);
  if (overlay) {
    var firstFocusable = overlay.querySelector('input, textarea, select, button:not(.note-dialog-close)');
    if (firstFocusable) {
      setTimeout(function() { firstFocusable.focus(); }, 50);
    }
  }
}

/* ═══════════════════════════════════════════════════
   STAGE MISMATCH DIALOG (shared by stages + gantt)
═══════════════════════════════════════════════════ */

var STAGE_OPTIONS = ['售前', '项目立项', '需求分解', '硬件开发', '结构设计', 'BSP开发', '软件开发', '测试', '产品发货', '项目总结'];
var _mismatchExecId = null;

function showStageMismatchDialog(execId, stageName, suggestedName, event) {
  _mismatchExecId = execId;
  if (event) event.stopPropagation();

  var zentaoUrl = '';
  if (execId && typeof _zentaoWebBase !== 'undefined' && _zentaoWebBase) {
    zentaoUrl = _zentaoWebBase + '/index.php?m=execution&f=view&executionID=' + execId;
  }

  var bodyHtml = '<div style="padding:8px 0;line-height:1.8">';
  if (suggestedName) {
    bodyHtml +=
      '<p style="margin-bottom:10px">当前阶段名 <b style="color:var(--warn)">"' + escHtml(stageName) + '"</b> 与标准名不一致。</p>' +
      '<p style="margin-bottom:6px">请在禅道中将阶段名修改为：</p>' +
      '<p style="padding:12px 16px;background:var(--accent-lt);border:1px solid var(--accent);border-radius:8px;font-size:16px;font-weight:700;color:var(--accent);text-align:center;margin:10px 0">' + escHtml(suggestedName) + '</p>';
  } else {
    var standards = (typeof _standardStages !== 'undefined' && _standardStages.length)
      ? _standardStages : STAGE_OPTIONS;
    var stageListHtml = standards.map(function(st) {
      return '<li style="padding:2px 0;font-weight:500">' + escHtml(st) + '</li>';
    }).join('');
    bodyHtml +=
      '<p style="margin-bottom:10px">当前阶段名 <b style="color:var(--warn)">"' + escHtml(stageName) + '"</b> 不在标准阶段列表中。</p>' +
      '<p style="margin-bottom:6px;color:var(--muted)">请修改禅道阶段名为以下标准名称之一：</p>' +
      '<ul style="margin:0;padding-left:20px;color:var(--fg);font-size:13px">' + stageListHtml + '</ul>';
  }
  if (zentaoUrl) {
    bodyHtml += '<div style="margin-top:10px;padding:8px 12px;background:var(--bg);border-radius:6px;font-size:12px">' +
      '<a href="' + zentaoUrl + '" target="_blank" style="color:var(--accent);text-decoration:none;font-weight:500">&#x2197; 打开禅道阶段设置页面</a>' +
      '<span style="color:var(--muted);margin-left:6px">修改后重新同步即可</span></div>';
  }
  bodyHtml += '<p style="margin-top:12px;font-size:11px;color:var(--muted);font-style:italic">修改后下次禅道同步生效，系统将自动匹配并显示正常数据。</p>';
  bodyHtml += '</div>';

  var buttons = [{ text: '关闭', cls: '', onclick: "this.closest('.note-dialog-overlay').remove()" }];

  openDialog('⚠ 请修改禅道阶段名为标准名字', bodyHtml, buttons, { overlayClass: 'stage-mismatch-dialog-overlay' });
}

/* ── Document Preview ── */

var _PREVIEWABLE_EXTS = ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'md', 'txt', 'docx'];

function isPreviewableUrl(url) {
  if (!url) return false;
  var u = url.split('?')[0].split('#')[0];
  var ext = u.split('.').pop().toLowerCase();
  return _PREVIEWABLE_EXTS.indexOf(ext) >= 0;
}

function previewDocument(url, filename) {
  // Decode URL if passed through onclick (to avoid JS escape sequence issues with backslashes)
  try { url = decodeURIComponent(url); } catch(e) {}
  if (!isPreviewableUrl(url)) {
    showToast('不支持预览此链接（仅支持 ' + _PREVIEWABLE_EXTS.join('/') + ' 格式）', 'info');
    return;
  }
  var u = url.split('?')[0].split('#')[0];
  var ext = u.split('.').pop().toLowerCase();
  var token = localStorage.getItem('pma_token') || '';
  var fetchUrl = '/api/documents/fetch?url=' + encodeURIComponent(url) + '&token=' + encodeURIComponent(token);
  var title = filename || u.split('/').pop() || u.split('\\').pop() || '文档预览';
  var isHttp = /^https?:\/\//.test(url);

  // Build dialog
  var dlgId = 'preview-dlg-' + Date.now();
  var html = '<div class="note-dialog-overlay" id="' + dlgId + '" style="z-index:9999">' +
    '<div class="note-dialog" style="max-width:90vw;width:90vw;max-height:90vh;display:flex;flex-direction:column">' +
      '<div class="note-dialog-head" style="flex-shrink:0">' +
        '<span class="note-dialog-title">' + escHtml(title) + '</span>' +
        '<span style="display:flex;align-items:center;gap:8px">' +
          (isHttp ? '<a href="' + escHtml(url) + '" target="_blank" style="font-size:11px;color:var(--accent);text-decoration:none;margin-right:12px">在新窗口打开</a>' : '') +
          '<button class="note-dialog-close" onclick="document.getElementById(\'' + dlgId + '\').remove()">&times;</button>' +
        '</span>' +
      '</div>' +
      '<div id="' + dlgId + '-body" style="flex:1;overflow:auto;min-height:300px;display:flex;align-items:center;justify-content:center">' +
        '<div class="loading-spinner">加载中...</div>' +
      '</div>' +
    '</div></div>';
  document.body.insertAdjacentHTML('beforeend', html);

  // ESC to close
  var escHandler = function(e) { if (e.key === 'Escape') { document.getElementById(dlgId).remove(); document.removeEventListener('keydown', escHandler); } };
  document.addEventListener('keydown', escHandler);

  var body = document.getElementById(dlgId + '-body');

  // PDF / Images: direct iframe/img
  if (['pdf'].indexOf(ext) >= 0) {
    body.innerHTML = '<iframe src="' + fetchUrl + '" style="width:100%;height:100%;min-height:70vh;border:none"></iframe>';
    return;
  }
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].indexOf(ext) >= 0) {
    body.innerHTML = '<div style="text-align:center;padding:20px"><img src="' + fetchUrl + '" style="max-width:100%;max-height:80vh" onerror="this.parentElement.innerHTML=\'<div class=error-state>图片加载失败</div>\'"></div>';
    return;
  }

  // MD / TXT / DOCX: fetch content
  fetch(fetchUrl).then(function(res) {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    if (ext === 'docx') return res.arrayBuffer();
    return res.text();
  }).then(function(data) {
    if (ext === 'md') {
      body.innerHTML = '<div style="padding:20px;max-width:900px;margin:0 auto;line-height:1.7">' + marked.parse(data) + '</div>';
    } else if (ext === 'docx') {
      mammoth.convertToHtml({ arrayBuffer: data }).then(function(result) {
        body.innerHTML = '<div style="padding:20px;max-width:900px;margin:0 auto;line-height:1.7">' + result.value + '</div>';
      }).catch(function() {
        body.innerHTML = '<div class="error-state">文档解析失败</div>';
      });
    } else {
      body.innerHTML = '<pre style="padding:20px;white-space:pre-wrap;font-size:13px;line-height:1.6">' + escHtml(data || '') + '</pre>';
    }
  }).catch(function(e) {
    body.innerHTML = '<div class="error-state">加载失败: ' + escHtml(e.message) + '</div>';
  });
}

/* ═══════════════════════════════════════════════════
   PROJECT COMBO — reusable searchable project selector
   Usage: createProjectCombo({ comboId, inputId, dropdownId, placeholder, onSelect })
   Generates global functions: {comboId}Open(), {comboId}Filter(q), {comboId}Select(id)
   ═══════════════════════════════════════════════════ */

var _allProjects = [];
var _allProjectsLoaded = false;

async function loadAllProjects() {
  if (_allProjectsLoaded) return;
  try {
    var data = await API.get('/projects');
    if (data) _allProjects = data;
    _allProjectsLoaded = true;
  } catch(e) {}
}

function _fnName(comboId, suffix) {
  // Convert 'task-proj-combo' + 'Open' -> 'taskProjComboOpen'
  return comboId.replace(/-([a-z])/g, function(m, c) { return c.toUpperCase(); }) + suffix;
}

function _setupComboFunctions(opts) {
  var comboId = opts.comboId;
  var inputId = opts.inputId;
  var dropdownId = opts.dropdownId;
  var onSelect = opts.onSelect;
  var selectedIdFn = opts.selectedIdFn || function() { return null; };

  var openFn = _fnName(comboId, 'Open');
  var filterFn = _fnName(comboId, 'Filter');
  var selectFn = _fnName(comboId, 'Select');

  window[openFn] = function() {
    loadAllProjects().then(function() {
      var wrap = document.getElementById(comboId);
      if (!wrap) { console.error(comboId + ' not found'); return; }
      wrap.classList.add('open');
      var input = document.getElementById(inputId);
      if (input) input.select();
      _renderComboDropdown(dropdownId, selectedIdFn(), '', selectFn);
    }).catch(function(e) { console.error(comboId + ' load error:', e); });
  };

  window[filterFn] = function(q) {
    _renderComboDropdown(dropdownId, selectedIdFn(), q, selectFn);
  };

  window[selectFn] = function(id) {
    var wrap = document.getElementById(comboId);
    if (wrap) wrap.classList.remove('open');
    var p = _allProjects.find(function(x) { return x.id == id; });
    if (p) {
      document.getElementById(inputId).value = p.name;
      if (onSelect) onSelect(p);
    }
  };
}

function createProjectCombo(opts) {
  _setupComboFunctions(opts);
  var openFn = _fnName(opts.comboId, 'Open');
  var filterFn = _fnName(opts.comboId, 'Filter');
  return '<div class="proj-combo" id="' + opts.comboId + '">' +
    '<input class="proj-combo-input" id="' + opts.inputId + '" type="text" autocomplete="off" placeholder="' + escHtml(opts.placeholder || '搜索或选择项目…') + '" ' +
      'onclick="' + openFn + '()" oninput="' + filterFn + '(this.value)">' +
    '<svg class="proj-combo-arrow" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="2,5 7,10 12,5"/></svg>' +
    '<div class="proj-combo-dropdown" id="' + opts.dropdownId + '"></div>' +
  '</div>';
}

// For existing HTML (e.g., detail page, product page) — just wire up the functions
function initProjectCombo(opts) {
  _setupComboFunctions(opts);
}

// Generic search combo: accepts custom dataSource (array or async function returning array)
function initSearchCombo(opts) {
  var comboId = opts.comboId;
  var inputId = opts.inputId;
  var dropdownId = opts.dropdownId;
  var onSelect = opts.onSelect;
  var getData = opts.dataSource;
  var selectedIdFn = opts.selectedIdFn || function() { return null; };

  var openFn = _fnName(comboId, 'Open');
  var filterFn = _fnName(comboId, 'Filter');
  var selectFn = _fnName(comboId, 'Select');

  window[openFn] = function() {
    var wrap = document.getElementById(comboId);
    if (wrap) wrap.classList.add('open');
    var input = document.getElementById(inputId);
    if (input) input.select();
    Promise.resolve(typeof getData === 'function' ? getData() : getData).then(function(items) {
      _renderSearchDropdown(dropdownId, items, selectedIdFn(), '', selectFn);
    });
  };

  window[filterFn] = function(q) {
    Promise.resolve(typeof getData === 'function' ? getData() : getData).then(function(items) {
      _renderSearchDropdown(dropdownId, items, selectedIdFn(), q, selectFn);
    });
  };

  window[selectFn] = function(id) {
    var wrap = document.getElementById(comboId);
    if (wrap) wrap.classList.remove('open');
    Promise.resolve(typeof getData === 'function' ? getData() : getData).then(function(items) {
      var p = items.find(function(x) { return x.id == id; });
      if (p) {
        document.getElementById(inputId).value = p.name;
        if (onSelect) onSelect(p);
      }
    });
  };
}

function _renderSearchDropdown(dropdownId, items, selectedId, q, selectFnName) {
  var dd = document.getElementById(dropdownId);
  if (!dd) return;
  var v = (q || '').trim().toLowerCase();
  var list = v ? items.filter(function(p) {
    return (p.code || '').toLowerCase().indexOf(v) >= 0 || (p.name || '').toLowerCase().indexOf(v) >= 0;
  }) : items;
  if (!list.length) { dd.innerHTML = '<div class="combo-no-match">未找到匹配项目</div>'; return; }
  dd.innerHTML = list.map(function(p) {
    var cls = p.id == selectedId ? 'combo-opt selected' : 'combo-opt';
    return '<div class="' + cls + '" onmousedown="event.preventDefault()" onclick="' + selectFnName + '(' + p.id + ')">' +
      '<div class="combo-opt-name">' + escHtml(p.name) + '</div>' +
      '<div class="combo-opt-meta">' + escHtml(p.code || '') + '</div>' +
    '</div>';
  }).join('');
}

function _renderComboDropdown(dropdownId, selectedId, q, selectFnName) {
  var dd = document.getElementById(dropdownId);
  if (!dd) return;
  var v = (q || '').trim().toLowerCase();
  var list = v ? _allProjects.filter(function(p) {
    return (p.code || '').toLowerCase().indexOf(v) >= 0 || (p.name || '').toLowerCase().indexOf(v) >= 0;
  }) : _allProjects;
  if (!list.length) { dd.innerHTML = '<div class="combo-no-match">未找到匹配项目</div>'; return; }
  dd.innerHTML = list.map(function(p) {
    var cls = p.id == selectedId ? 'combo-opt selected' : 'combo-opt';
    return '<div class="' + cls + '" onmousedown="event.preventDefault()" onclick="' + selectFnName + '(' + p.id + ')">' +
      '<div class="combo-opt-name">' + escHtml(p.name) + '</div>' +
      '<div class="combo-opt-meta">' + escHtml(p.code || '') + '</div>' +
    '</div>';
  }).join('');
}

/* ═══════════════════════════════════════════════════
   USER COMBO — reusable searchable user selector
   ═══════════════════════════════════════════════════ */

var _allUsers = [];
var _allUsersLoaded = false;

async function loadAllUsers() {
  if (_allUsersLoaded) return;
  try {
    var data = await API.get('/users/options');
    if (data) _allUsers = data;
    _allUsersLoaded = true;
  } catch(e) {}
}

function createUserCombo(opts) {
  var comboId = opts.comboId;
  var inputId = opts.inputId;
  var dropdownId = opts.dropdownId;
  var onSelect = opts.onSelect;
  var selectedIdFn = opts.selectedIdFn || function() { return null; };

  var openFn = _fnName(comboId, 'Open');
  var filterFn = _fnName(comboId, 'Filter');
  var selectFn = _fnName(comboId, 'Select');

  window[openFn] = function() {
    loadAllUsers().then(function() {
      var wrap = document.getElementById(comboId);
      if (wrap) wrap.classList.add('open');
      var input = document.getElementById(inputId);
      if (input) input.select();
      _renderUserDropdown(dropdownId, selectedIdFn(), '', selectFn);
    }).catch(function(e) { console.error(comboId + ' load error:', e); });
  };

  window[filterFn] = function(q) {
    _renderUserDropdown(dropdownId, selectedIdFn(), q, selectFn);
  };

  window[selectFn] = function(id) {
    var wrap = document.getElementById(comboId);
    if (wrap) wrap.classList.remove('open');
    var u = _allUsers.find(function(x) { return x.id == id; });
    if (u) {
      document.getElementById(inputId).value = u.name;
      if (onSelect) onSelect(u);
    }
  };

  return '<div class="proj-combo" id="' + comboId + '">' +
    '<input class="proj-combo-input" id="' + inputId + '" type="text" autocomplete="off" placeholder="' + escHtml(opts.placeholder || '搜索负责人...') + '" ' +
      'onclick="' + openFn + '()" oninput="' + filterFn + '(this.value)">' +
    '<svg class="proj-combo-arrow" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="2,5 7,10 12,5"/></svg>' +
    '<div class="proj-combo-dropdown" id="' + dropdownId + '"></div>' +
  '</div>';
}

function _renderUserDropdown(dropdownId, selectedId, q, selectFnName) {
  var dd = document.getElementById(dropdownId);
  if (!dd) return;
  var v = (q || '').trim().toLowerCase();
  var list = v ? _allUsers.filter(function(u) {
    return (u.code||'').toLowerCase().indexOf(v)>=0 || (u.name||'').toLowerCase().indexOf(v)>=0;
  }) : _allUsers;
  if (!list.length) { dd.innerHTML = '<div class="combo-no-match">未找到匹配用户</div>'; return; }
  dd.innerHTML = list.map(function(u) {
    var cls = u.id == selectedId ? 'combo-opt selected' : 'combo-opt';
    return '<div class="'+cls+'" onmousedown="event.preventDefault()" onclick="'+selectFnName+'('+u.id+')">' +
      '<div class="combo-opt-name">'+escHtml(u.name)+'</div>' +
      '<div class="combo-opt-meta">@'+escHtml(u.code||'')+'</div></div>';
  }).join('');
}

function closeSharedDialog() {
  var overlay = document.querySelector('.shared-dialog-overlay');
  if (overlay) overlay.remove();
}

// Global click to close any open combo
document.addEventListener('click', function(e) {
  document.querySelectorAll('.proj-combo').forEach(function(c) {
    if (!c.contains(e.target)) c.classList.remove('open');
  });
});

/* ═══════════════════════════════════════════════════
   SVG DONUT PIE CHART — reusable component
   ═══════════════════════════════════════════════════ */

function _buildPieChart(groups, counts, total, title) {
  // conic-gradient for accurate visual, transparent SVG for hover tooltips
  var pieParts = [];
  var acc = 0;
  groups.forEach(function(g) {
    var cnt = counts[g.key] || 0;
    if (cnt <= 0) return;
    var pct = cnt/total;
    pieParts.push(g.color+' '+Math.round(acc*100)+'% '+Math.round((acc+pct)*100)+'%');
    acc += pct;
  });
  var gradient = pieParts.length ? 'conic-gradient('+pieParts.join(',')+')' : '';

  // Transparent SVG overlay for tooltips
  var cx=45, cy=45, r=36, sw=14, C=2*Math.PI*r;
  var a=0, svgPaths='';
  groups.forEach(function(g) {
    var cnt = counts[g.key] || 0;
    if (cnt <= 0) return;
    var pct = cnt/total;
    var len = pct*C;
    svgPaths += '<circle cx="'+cx+'" cy="'+cy+'" r="'+r+'" fill="none" stroke="transparent" stroke-width="'+sw+'" ' +
      'stroke-dasharray="'+len.toFixed(1)+' '+(C-len).toFixed(1)+'" stroke-dashoffset="'+(-a).toFixed(1)+'" ' +
      'style="transform:rotate(-90deg);transform-origin:'+cx+'px '+cy+'px;cursor:pointer" ' +
      'onmouseover="_showPieTooltip(event,\''+escHtml(g.label)+'\','+cnt+','+Math.round(pct*100)+')" ' +
      'onmouseout="_hidePieTooltip()"><title>'+escHtml(g.label)+': '+cnt+' ('+Math.round(pct*100)+'%)</title></circle>';
    a += len;
  });

  var svg = '<svg width="90" height="90" viewBox="0 0 90 90" style="position:absolute;top:0;left:0">'+svgPaths+'</svg>';

  return '<div style="flex:1;background:var(--surface);border:1px solid var(--border);border-radius:var(--r-lg);padding:14px;display:flex;flex-direction:column;align-items:center;gap:12px">' +
    '<div style="font-weight:620;font-size:13px">'+title+'</div>' +
    '<div style="position:relative;width:90px;height:90px">' +
      '<div style="width:72px;height:72px;border-radius:50%;background:'+gradient+';margin:9px"></div>' +
      '<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:54px;height:54px;border-radius:50%;background:var(--surface);display:flex;flex-direction:column;align-items:center;justify-content:center">' +
        '<span style="font-size:18px;font-weight:700;font-family:var(--mono);line-height:1">'+total+'</span></div>' +
      svg +
    '</div>' +
    '<div style="width:100%;font-size:11px;line-height:1.6">' +
      groups.map(function(g) {
        var cnt = counts[g.key] || 0;
        if (!cnt) { if(g.label==='—')return '<div style="display:flex;align-items:center;justify-content:space-between;padding:2px 0"><span style="color:var(--muted)">—</span><span style="color:var(--muted)">—</span></div>'; return ''; }
        return '<div style="display:flex;align-items:center;justify-content:space-between;padding:2px 0">' +
          '<span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:'+g.color+';margin-right:6px;vertical-align:middle"></span>'+escHtml(g.label)+'</span>' +
          '<span style="font-family:var(--mono);color:var(--muted)">'+cnt+' ('+Math.round(cnt/total*100)+'%)</span></div>';
      }).join('') +
    '</div></div>';
}

function _resolveCSSVar(cssVar) {
  var el = document.createElement('div');
  el.style.color = cssVar;
  document.body.appendChild(el);
  var color = getComputedStyle(el).color;
  el.remove();
  return color || '#999';
}

function _showPieTooltip(e, label, cnt, pct) {
  var tip = document.getElementById('pie-tooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'pie-tooltip';
    tip.style.cssText = 'position:fixed;pointer-events:none;z-index:9999;padding:6px 10px;background:var(--surface);border:1px solid var(--border);border-radius:6px;font-size:12px;box-shadow:var(--sh-md);white-space:nowrap;';
    document.body.appendChild(tip);
  }
  tip.innerHTML = '<strong>'+escHtml(label)+'</strong>: '+cnt+' 个 ('+pct+'%)';
  tip.style.left = (e.clientX+12)+'px';
  tip.style.top = (e.clientY-28)+'px';
  tip.style.display = 'block';
}

function _hidePieTooltip() {
  var tip = document.getElementById('pie-tooltip');
  if (tip) tip.style.display = 'none';
}

var _calYear, _calMonth;

function _renderMonthCalendar(today, dailyMap, calData) {
  if (!_calYear) { _calYear = today.getFullYear(); _calMonth = today.getMonth()+1; }
  var total = calData ? (calData.total||0) : 0;
  var monthNames = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
  var dayNames = ['一','二','三','四','五','六','日'];

  var firstDay = new Date(_calYear, _calMonth-1, 1);
  var lastDay = new Date(_calYear, _calMonth, 0);
  var startDow = firstDay.getDay()===0 ? 6 : firstDay.getDay()-1;
  var totalDays = lastDay.getDate();
  var prevMonthDays = new Date(_calYear, _calMonth-1, 0).getDate();

  var html = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">' +
    '<span style="font-size:11px;color:var(--muted)">'+_calYear+'年'+monthNames[_calMonth-1]+' · 本周 '+total.toFixed(1)+'h</span>' +
    '<span style="display:flex;gap:4px">' +
      '<button class="btn-xs" onclick="_calShift(-1)">◀</button>' +
      '<button class="btn-xs" style="font-weight:600" onclick="_calGoToday()">今天</button>' +
      '<button class="btn-xs" onclick="_calShift(1)">▶</button>' +
    '</span></div>';

  html += '<div style="display:grid;grid-template-columns:repeat(7,1fr);text-align:center;margin-bottom:4px">';
  dayNames.forEach(function(n) { html += '<div style="font-size:10px;color:var(--muted);padding:2px 0">'+n+'</div>'; });
  html += '</div>';

  var cells = '';
  var totalCells = Math.ceil((startDow + totalDays)/7)*7;
  for (var i=0; i<totalCells; i++) {
    var dayNum = i - startDow + 1;
    var isCurrentMonth = dayNum >= 1 && dayNum <= totalDays;
    var displayDay = isCurrentMonth ? dayNum : (dayNum < 1 ? prevMonthDays+dayNum : dayNum-totalDays);
    // Calculate actual date for this cell
    var y = _calYear, m = _calMonth-1;
    if (dayNum < 1) { m--; if(m<0){m=11;y--;} }
    else if (dayNum > totalDays) { m++; if(m>11){m=0;y++;} }
    var d = new Date(y, m, displayDay);
    var dStr = y+'-'+String(m+1).padStart(2,'0')+'-'+String(displayDay).padStart(2,'0');
    var dd = dailyMap[dStr];
    var h = dd ? (dd.total_hours || dd.h || 0) : 0;
    var intensity = _getIntensityStyle(h);
    var todayStr = today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0')+'-'+String(today.getDate()).padStart(2,'0');
    var isToday = dStr === todayStr;

    // Cell background fill: solid blue from bottom (0-8h), overtime color from yellow to red (>8h)
    var cellBg = '', tipText = '';
    if (isCurrentMonth && h > 0) {
      tipText = h.toFixed(1)+'h';
      if (h <= 8) {
        var pct = h/8*100;
        cellBg = 'background:linear-gradient(to top,#3B82F6 '+pct+'%,transparent '+pct+'%)';
      } else {
        // Overtime: no blue, yellow→red gradient from bottom up, height = overtime/8
        var overH = h - 8;
        var overPct = overH/8*100;  // overtime height relative to standard 8h
        cellBg = 'background:linear-gradient(to top,#fbbf24 0%,#ef4444 '+overPct+'%,transparent '+overPct+'%)';
      }
    }
    cells += '<div onclick="openDayDetail(\''+dStr+'\','+h+')" '+(tipText?'title="'+tipText+'"':'')+' style="border:1px solid '+(isToday?'var(--accent)':'var(--border)')+';border-radius:4px;padding:3px 2px;text-align:center;cursor:pointer;' +
      cellBg + ';' + (isCurrentMonth ? '' : 'opacity:0.35;') + '">' +
      '<div style="font-size:11px;font-weight:'+(isToday?'700':'400')+';color:'+(isCurrentMonth?'var(--fg)':'var(--muted)')+'">'+displayDay+'</div>' +
    '</div>';
  }
  html += '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px">'+cells+'</div>';
  return html;
}

var _calChangeCallback = null;

function _calShift(delta) {
  _calMonth += delta;
  if (_calMonth > 12) { _calMonth = 1; _calYear++; }
  if (_calMonth < 1) { _calMonth = 12; _calYear--; }
  if (_calChangeCallback) _calChangeCallback();
}

function _calGoToday() {
  var now = new Date();
  _calYear = now.getFullYear();
  _calMonth = now.getMonth()+1;
  if (_calChangeCallback) _calChangeCallback();
}

function openDayDetail(dateStr, totalHours) {
  API.get('/worklogs/calendar?date_from='+dateStr+'&date_to='+dateStr).then(function(data) {
    var daily = (data&&data.daily) ? data.daily : [];
    var dayData = daily.length ? daily[0] : null;
    var tasksHtml = '';
    if (dayData && dayData.tasks) {
      dayData.tasks.forEach(function(t) {
        var pct = totalHours>0 ? Math.round(t.hours/totalHours*100) : 0;
        tasksHtml += '<div style="padding:6px 0;border-bottom:1px solid var(--border)">' +
          '<div style="font-weight:500">'+escHtml(t.title)+'</div>' +
          '<div style="font-size:11px;color:var(--muted)">'+t.hours.toFixed(1)+'h ('+pct+'%)'+(t.description?' — '+escHtml(t.description):'')+'</div></div>';
      });
    }
    openDialog(dateStr+' 工时详情 ('+totalHours.toFixed(1)+'h)',
      '<div style="max-height:400px;overflow-y:auto">'+(tasksHtml||'<div style="color:var(--muted)">当日无工时记录</div>')+'</div>',
      [{text:'关闭',onclick:"document.querySelector('.note-dialog-overlay').remove()"}]);
  }).catch(function(e) {
    showToast('加载详情失败: '+(e.message||'未知错误'), 'error');
  });
}

function _getIntensityStyle(hours) {
  if (hours <= 0) return {bg: '', text: 'var(--muted)'};
  var pct = hours / 8;
  if (pct <= 0.25) return {bg: 'background:var(--success-lt)', text: 'var(--success)'};
  if (pct <= 0.5)  return {bg: 'background:var(--accent-lt)', text: 'var(--accent)'};
  if (pct <= 0.75) return {bg: 'background:var(--warn-lt)', text: 'var(--warn)'};
  if (pct <= 1.0)  return {bg: 'background:var(--danger-lt)', text: 'var(--danger)'};
  return {bg: 'background:var(--danger);color:#fff', text: '#fff'};
}

