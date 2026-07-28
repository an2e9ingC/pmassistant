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
  var svg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>';
  return iconBtn(svg, title || '切换', onclick, true);
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
  } catch(e) { _favProducts = []; _favProjects = []; console.error('loadFavorites failed:', e); }
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
  var wasFav = idx >= 0;
  // Optimistic update
  if (wasFav) { list.splice(idx, 1); }
  else { list.push(id); }
  try {
    await API.put('/auth/favorites/toggle', {type: type, id: id});
  } catch(e) {
    // Revert on failure — DB is the source of truth
    if (wasFav) { list.push(id); }
    else { var ri = list.indexOf(id); if (ri >= 0) list.splice(ri, 1); }
    console.error('toggleFav failed:', e);
    showToast('收藏操作失败: ' + (e.message || '网络错误'), 'error');
    // Revert DOM star
    var stars = document.querySelectorAll('[onclick*="toggleFav(\\\'' + type + '\\\',' + id + ')"]');
    stars.forEach(function(el) {
      var s = el.querySelector('svg');
      if (s) {
        s.setAttribute('data-fav', wasFav ? '1' : '0');
        var p = s.querySelector('path');
        if (p) { p.setAttribute('fill', wasFav ? 'var(--yellow)' : 'none'); p.setAttribute('stroke', wasFav ? 'var(--yellow)' : 'var(--muted)'); }
      }
    });
  }
  return !wasFav;
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
  var colors = ['var(--yellow)','#fbbf24','#f59e0b','var(--yellow)','#fbbf24','#f59e0b','var(--yellow)','#f59e0b'];
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
  var color = fav ? 'var(--yellow)' : 'var(--muted)';
  var fill = fav ? 'var(--yellow)' : 'none';
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
  var bgStroke = (pct === 0 && opts.color) ? opts.color : 'var(--border)';
  var textSize = Math.round(s * 0.32);
  var labelSize = Math.round(s * 0.16);
  var label = opts.label !== undefined ? opts.label : '';
  var html = '<div class="ring-wrap" style="display:inline-flex;flex-direction:column;align-items:center;gap:4px">' +
    '<div style="position:relative;width:' + s + 'px;height:' + s + 'px">' +
    '<svg width="' + s + '" height="' + s + '" viewBox="0 0 ' + s + ' ' + s + '">' +
      '<circle cx="' + cx + '" cy="' + cx + '" r="' + r + '" fill="none" stroke="' + bgStroke + '" stroke-width="' + sw + '"/>' +
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

/** Toggle Switch — iOS-style on/off control for preferences/settings */
function toggleSwitch(isOn, onclick, opts) {
  opts = opts || {};
  var idAttr = opts.id ? ' id="' + opts.id + '"' : '';
  var disabled = opts.disabled ? ' opacity:0.5;cursor:not-allowed' : ' cursor:pointer';
  var bg = isOn ? 'var(--success)' : 'var(--border)';
  var circleX = isOn ? '22px' : '2px';
  var onclickAttr = !opts.disabled ? ' onclick="' + onclick + '"' : '';
  return '<span' + idAttr + ' style="display:inline-flex;align-items:center;width:44px;height:24px;border-radius:12px;background:' + bg + ';transition:background 0.2s;' + disabled + '"' + onclickAttr + '>' +
    '<span style="display:inline-block;width:20px;height:20px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.2);transition:transform 0.2s;transform:translateX(' + circleX + ')"></span>' +
  '</span>';
}

function renderProjIcon(type, code) {
  if (code) return projCodeTag(code);
  var t = (type || 'RD').toLowerCase();
  var label = t === 'sc' ? 'SC' : 'RD';
  return projCodeTag(label);
}

function renderTypeBadge(type) {
  var t = (type || 'RD').toLowerCase();
  return '<span class="badge badge-' + t + '">' + getProjectTypeLabel(type) + '</span>';
}

function renderPill(status) {
  return '<span class="pill ' + (status || 'pending') + '">' + (STATUS_TXT[status] || status) + '</span>';
}

var PRIORITY_LABELS = { low: '低', medium: '中', high: '高', critical: '紧急' };
var PRIORITY_COLORS = { low: 'var(--muted)', medium: 'var(--accent)', high: 'var(--orange)', critical: 'var(--danger)' };

function renderPriority(priority) {
  var p = priority || 'medium';
  return '<span class="prio-tag prio-' + p + '" style="color:' + (PRIORITY_COLORS[p] || '') + '" title="优先级: ' + (PRIORITY_LABELS[p] || p) + '">' +
    (PRIORITY_LABELS[p] || p) + '</span>';
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
    (btnLabel ? '<button class="btn btn-primary" style="font-size:11px;padding:3px 10px" onclick="' + onclick + '">' + btnLabel + '</button>' : '') +
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
  var autoWidth = typeof maxWidth === 'number' ? '' : 'width:' + widthStyle + ';';
  var maxH = opts.maxHeight || '';
  var heightStyle = maxH ? 'max-height:' + maxH + ';overflow-y:auto;' : '';
  var headerExtra = opts.headerExtra || '';
  var html = '<div class="note-dialog-overlay ' + overlayClass + '">' +
    '<div class="note-dialog" style="' + autoWidth + 'max-width:' + widthStyle + ';' + heightStyle + '">' +
      '<div class="note-dialog-head"><span class="note-dialog-title">' + title + '</span>' +
        '<span style="display:flex;align-items:center;gap:8px">' + headerExtra + closeHtml + '</span></div>' +
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
   FLOATING CARD — draggable, closeable, fixed-position card
   z-index: 250 (between topbar 100 and dropdowns 500)
   Usage:
     var fc = createFloatingCard({
       id: 'my-card',
       content: '<div>card body</div>',
       width: 520,
       closable: true,
       onClose: function() { ... },
       restoreLabel: '个人信息',
     });
   Returns: { el, restoreBtn, close(), restore(), setPosition(x,y), destroy() }
═══════════════════════════════════════════════════ */

function createFloatingCard(opts) {
  opts = opts || {};
  var id = opts.id || 'fc-' + Date.now();
  var width = opts.width || 520;
  var closable = opts.closable !== false;  // default true
  var savePos = opts.savePosition !== false; // default true
  var restoreLabel = opts.restoreLabel || '卡片';
  var initialX = opts.initialX;
  var initialY = opts.initialY;
  var content = opts.content || '';

  // ── Position: load saved or use initial/default ──
  var savedPos = null;
  try {
    var raw = localStorage.getItem('pma_fc_' + id + '_pos');
    if (raw) savedPos = JSON.parse(raw);
  } catch(e) {}
  var x = (savedPos && savedPos.x != null) ? savedPos.x
    : (initialX != null ? initialX : Math.max(20, (window.innerWidth - width) / 2));
  var y = (savedPos && savedPos.y != null) ? savedPos.y
    : (initialY != null ? initialY : 72);

  // ── Closed state ──
  var wasClosed = false;
  try {
    wasClosed = localStorage.getItem('pma_fc_' + id + '_closed') === '1';
  } catch(e) {}

  // ── Build DOM ──
  var closeHtml = closable
    ? '<button class="floating-card-close" title="关闭">&times;</button>'
    : '';
  var card = document.createElement('div');
  card.className = 'floating-card';
  card.id = 'fc-' + id;
  card.style.width = width + 'px';
  card.style.left = x + 'px';
  card.style.top = y + 'px';
  card.innerHTML =
    '<div class="floating-card-header">' + closeHtml + '</div>' +
    '<div class="floating-card-body">' + (typeof content === 'string' ? content : '') + '</div>';
  if (typeof content !== 'string' && content.nodeType) {
    card.querySelector('.floating-card-body').appendChild(content);
  }
  document.body.appendChild(card);

  // ── Drag ──
  var dragState = null;
  var header = card.querySelector('.floating-card-header');
  var closeBtn = card.querySelector('.floating-card-close');

  header.addEventListener('mousedown', function(e) {
    // Don't start drag on close button
    if (closeBtn && closeBtn.contains(e.target)) return;
    if (e.button !== 0) return; // left button only
    e.preventDefault();
    dragState = {
      startX: e.clientX, startY: e.clientY,
      origLeft: card.offsetLeft, origTop: card.offsetTop,
      dragging: false
    };
  });

  document.addEventListener('mousemove', function(e) {
    if (!dragState) return;
    var dx = e.clientX - dragState.startX;
    var dy = e.clientY - dragState.startY;
    if (!dragState.dragging && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
    if (!dragState.dragging) {
      dragState.dragging = true;
      card.style.transition = 'none';
      document.body.style.userSelect = 'none';
    }
    var newLeft = dragState.origLeft + dx;
    var newTop = dragState.origTop + dy;
    // Clamp to viewport (10px margin)
    newLeft = Math.max(10, Math.min(newLeft, window.innerWidth - card.offsetWidth - 10));
    newTop = Math.max(0, Math.min(newTop, window.innerHeight - 40));
    requestAnimationFrame(function() {
      card.style.left = newLeft + 'px';
      card.style.top = newTop + 'px';
    });
  });

  document.addEventListener('mouseup', function() {
    if (!dragState) return;
    if (dragState.dragging) {
      card.style.transition = '';
      document.body.style.userSelect = '';
      // Save position
      if (savePos) {
        try {
          localStorage.setItem('pma_fc_' + id + '_pos',
            JSON.stringify({ x: card.offsetLeft, y: card.offsetTop }));
        } catch(e) {}
      }
    }
    dragState = null;
  });

  // ── Viewport resize: clamp position ──
  function clampToViewport() {
    var l = Math.max(10, Math.min(card.offsetLeft, window.innerWidth - card.offsetWidth - 10));
    var t = Math.max(0, Math.min(card.offsetTop, window.innerHeight - 40));
    card.style.left = l + 'px';
    card.style.top = t + 'px';
  }
  window.addEventListener('resize', clampToViewport);

  // ── Restore button ──
  var restoreBtn = null;
  function showRestore() {
    if (restoreBtn) return;
    restoreBtn = document.createElement('div');
    restoreBtn.className = 'floating-card-restore';
    restoreBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><polyline points="8,4 8,8 11,10"/></svg>' + escHtml(restoreLabel);
    restoreBtn.onclick = function() { api.restore(); };
    document.body.appendChild(restoreBtn);
  }
  function hideRestore() {
    if (restoreBtn) { restoreBtn.remove(); restoreBtn = null; }
  }

  // ── Close button handler ──
  if (closeBtn) {
    closeBtn.onclick = function(e) {
      e.stopPropagation();
      api.close();
    };
  }

  // ── Public API ──
  var api = {
    el: card,
    get restoreBtn() { return restoreBtn; },

    close: function() {
      card.style.display = 'none';
      try { localStorage.setItem('pma_fc_' + id + '_closed', '1'); } catch(e) {}
      showRestore();
      if (opts.onClose) opts.onClose();
    },

    restore: function() {
      card.style.display = '';
      try { localStorage.setItem('pma_fc_' + id + '_closed', '0'); } catch(e) {}
      hideRestore();
      clampToViewport();
      if (opts.onRestore) opts.onRestore();
    },

    setPosition: function(nx, ny) {
      nx = Math.max(10, Math.min(nx, window.innerWidth - card.offsetWidth - 10));
      ny = Math.max(0, Math.min(ny, window.innerHeight - 40));
      card.style.left = nx + 'px';
      card.style.top = ny + 'px';
      if (savePos) {
        try { localStorage.setItem('pma_fc_' + id + '_pos', JSON.stringify({x: nx, y: ny})); } catch(e) {}
      }
    },

    destroy: function() {
      window.removeEventListener('resize', clampToViewport);
      hideRestore();
      card.remove();
    }
  };

  // ── Initialize ──
  if (wasClosed) {
    card.style.display = 'none';
    showRestore();
  }

  return api;
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

var _PREVIEWABLE_EXTS = ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'md', 'txt', 'docx', 'vsdx'];

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

  // Build dialog — fullscreen by default
  var dlgId = 'preview-dlg-' + Date.now();
  var dlgStyle = 'position:fixed;inset:0;width:100vw;height:100vh;max-width:100vw;max-height:100vh;display:flex;flex-direction:column;border-radius:0';
  var html = '<div class="note-dialog-overlay" id="' + dlgId + '" style="z-index:9999">' +
    '<div class="note-dialog" id="' + dlgId + '-dlg" style="' + dlgStyle + '">' +
      '<div class="note-dialog-head" style="flex-shrink:0">' +
        '<span class="note-dialog-title">' + escHtml(title) + '</span>' +
        '<span style="display:flex;align-items:center;gap:8px">' +
          (isHttp ? '<a href="' + escHtml(url) + '" target="_blank" style="font-size:11px;color:var(--accent);text-decoration:none;margin-right:4px">在新窗口打开</a>' : '') +
          '<button class="btn btn-sm fs-btn-exit" id="' + dlgId + '-fsbtn" title="退出全屏" style="font-size:12px;padding:2px 6px;margin-right:4px" onclick="togglePreviewFullscreen(\'' + dlgId + '\')">⛶</button>' +
          '<button class="note-dialog-close" onclick="document.getElementById(\'' + dlgId + '\').remove()">&times;</button>' +
        '</span>' +
      '</div>' +
      '<div id="' + dlgId + '-body" style="flex:1;overflow:auto;min-height:400px;display:flex;align-items:center;justify-content:center">' +
        ((ext === 'docx' || ext === 'vsdx') ? '<div style="text-align:center;color:var(--muted)"><div style="display:inline-block;width:48px;height:48px;border:3px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin 0.8s linear infinite"></div><div style="margin-top:16px;font-size:13px">正在加载 <b>"' + escHtml(title) + '"</b> ...</div></div>' : '<div class="loading-spinner">加载中...</div>') +
      '</div>' +
    '</div></div>';
  document.body.insertAdjacentHTML('beforeend', html);

  // ESC: 1st exits fullscreen, 2nd closes dialog
  var escHandler = function(e) {
    if (e.key !== 'Escape') return;
    var dlg = document.getElementById(dlgId);
    if (!dlg) { document.removeEventListener('keydown', escHandler); return; }
    var inner = dlg.querySelector('.note-dialog');
    if (inner && inner.style.position === 'fixed') {
      togglePreviewFullscreen(dlgId);
    } else {
      dlg.remove();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);

  var body = document.getElementById(dlgId + '-body');

  // PDF: direct iframe
  if (ext === 'pdf') {
    body.innerHTML = '<iframe src="' + fetchUrl + '" style="width:100%;height:100%;min-height:70vh;border:none"></iframe>';
    return;
  }

  // DOCX/VSDX: pre-fetch to trigger server-side conversion, then show PDF
  if (ext === 'docx' || ext === 'vsdx') {
    fetch(fetchUrl).then(function(res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.blob();
    }).then(function() {
      body.innerHTML = '<iframe src="' + fetchUrl + '" style="width:100%;height:100%;min-height:70vh;border:none"></iframe>';
    }).catch(function(e) {
      body.innerHTML = '<div class="error-state">转换失败: ' + escHtml(e.message) + '</div>';
    });
    return;
  }
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].indexOf(ext) >= 0) {
    body.innerHTML = '<div style="text-align:center;padding:20px"><img src="' + fetchUrl + '" style="max-width:100%;max-height:80vh" onerror="this.parentElement.innerHTML=\'<div class=error-state>图片加载失败</div>\'"></div>';
    return;
  }

  // MD / TXT: fetch and render text content
  fetch(fetchUrl).then(function(res) {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.text();
  }).then(function(data) {
    if (ext === 'md') {
      body.innerHTML = '<div style="padding:20px;max-width:900px;margin:0 auto;line-height:1.7">' + marked.parse(data) + '</div>';
    } else {
      body.innerHTML = '<pre style="padding:20px;white-space:pre-wrap;font-size:13px;line-height:1.6">' + escHtml(data || '') + '</pre>';
    }
  }).catch(function(e) {
    body.innerHTML = '<div class="error-state">加载失败: ' + escHtml(e.message) + '</div>';
  });
}

/* Toggle preview dialog fullscreen mode */
function togglePreviewFullscreen(dlgId) {
  var dlg = document.getElementById(dlgId);
  if (!dlg) return;
  var body = dlg.querySelector('.note-dialog');
  var btn = document.getElementById(dlgId + '-fsbtn');
  if (!body) return;
  var isFullscreen = body.style.position === 'fixed';
  if (isFullscreen) {
    // Exit fullscreen → 95vw windowed mode
    body.style.position = '';
    body.style.inset = '';
    body.style.width = '95vw';
    body.style.height = '';
    body.style.maxWidth = '95vw';
    body.style.maxHeight = '95vh';
    body.style.borderRadius = '';
    if (btn) { btn.classList.remove('fs-btn-exit'); btn.title = '全屏查看'; }
  } else {
    // Enter fullscreen
    body.style.position = 'fixed';
    body.style.inset = '0';
    body.style.width = '100vw';
    body.style.height = '100vh';
    body.style.maxWidth = '100vw';
    body.style.maxHeight = '100vh';
    body.style.borderRadius = '0';
    if (btn) { btn.classList.add('fs-btn-exit'); btn.title = '退出全屏'; }
  }
}

/* Open a document URL in a fullscreen iframe overlay (for detail page preview cards) */
function openDocIframeFullscreen(url, title) {
  var token = localStorage.getItem('pma_token') || '';
  var fetchUrl = '/api/documents/fetch?url=' + encodeURIComponent(url) + '&token=' + encodeURIComponent(token);
  var dlgId = 'fs-doc-dlg-' + Date.now();
  var html = '<div class="note-dialog-overlay" id="' + dlgId + '" style="z-index:9999">' +
    '<div class="note-dialog" style="position:fixed;inset:0;width:100vw;height:100vh;max-width:100vw;max-height:100vh;border-radius:0;display:flex;flex-direction:column">' +
      '<div class="note-dialog-head" style="flex-shrink:0">' +
        '<span class="note-dialog-title">' + escHtml(title || '文档全屏预览') + '</span>' +
        '<span style="display:flex;align-items:center;gap:8px">' +
          '<button class="note-dialog-close" onclick="document.getElementById(\'' + dlgId + '\').remove()">&times;</button>' +
        '</span>' +
      '</div>' +
      '<div style="flex:1;overflow:auto">' +
        '<iframe src="' + fetchUrl + '" style="width:100%;height:100%;border:none"></iframe>' +
      '</div>' +
    '</div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
  var escHandler = function(e) {
    if (e.key === 'Escape') {
      document.getElementById(dlgId).remove();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
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
      document.getElementById(inputId).value = (p.code ? p.code + ' ' : '') + p.name;
      if (onSelect) onSelect(p);
    }
  };

  // Enter key to select first option
  setTimeout(function() {
    var inp = document.getElementById(inputId);
    if (inp) inp.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { var dd = document.getElementById(dropdownId); if (dd) { var f = dd.querySelector('.combo-opt'); if (f) f.click(); } }
    });
  }, 200);
}

// Generic searchable combo — accepts any dataSource (async function or array)
function createSearchCombo(opts) {
  var comboId = opts.comboId, inputId = opts.inputId, dropdownId = opts.dropdownId;
  var openFn = _fnName(comboId, 'Open');
  var filterFn = _fnName(comboId, 'Filter');
  var selectFn = _fnName(comboId, 'Select');
  window[openFn] = function() {
    var getData = opts.dataSource;
    Promise.resolve(typeof getData === 'function' ? getData() : getData).then(function(items) {
      items = (items && items.items) ? items.items : (items || []);
      window['_combo_'+comboId] = items;
      var wrap = document.getElementById(comboId); if (!wrap) return;
      wrap.classList.add('open');
      var inp = document.getElementById(inputId); if (inp) inp.select();
      _renderSearchDropdown(dropdownId, items, opts.selectedIdFn ? opts.selectedIdFn() : null, '', selectFn);
    });
  };
  window[filterFn] = function(q) {
    var items = window['_combo_'+comboId] || [];
    _renderSearchDropdown(dropdownId, items, opts.selectedIdFn ? opts.selectedIdFn() : null, q, selectFn);
  };
  window[selectFn] = function(id) {
    var wrap = document.getElementById(comboId); if (wrap) wrap.classList.remove('open');
    var items = window['_combo_'+comboId] || [];
    var p = items.find(function(x) { return x.id == id; });
    if (p) {
      document.getElementById(inputId).value = (p.code || p.name || p.username || '');
      if (opts.onSelect) opts.onSelect(p);
    }
  };
  var enterFn = _fnName(comboId, 'Enter');
  window[enterFn] = function(e) {
    if (e.key !== 'Enter') return;
    var dd = document.getElementById(dropdownId);
    if (!dd) return;
    var first = dd.querySelector('.combo-opt');
    if (first) first.click();
  };
  return '<div class="proj-combo" id="' + comboId + '" style="min-width:0!important">' +
    '<input class="proj-combo-input" id="' + inputId + '" type="text" autocomplete="off" placeholder="' + escHtml(opts.placeholder || '搜索...') + '" ' +
      'onclick="' + openFn + '()" oninput="' + filterFn + '(this.value)" onkeydown="' + enterFn + '(event)">' +
    '<svg class="proj-combo-arrow" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="2,5 7,10 12,5"/></svg>' +
    '<div class="proj-combo-dropdown" id="' + dropdownId + '"></div>' +
  '</div>';
}

// Thin wrappers — delegate to createSearchCombo with pre-configured dataSource
function createProductCombo(opts) {
  opts.dataSource = function() { return API.get('/products?limit=200'); };
  opts.placeholder = opts.placeholder || '搜索产品...';
  return createSearchCombo(opts);
}

function createTaskCombo(opts) {
  // opts.projectIdFn: function returning current project code (or null)
  // opts.stageFilterFn: function returning selected stage name (or empty string for all)
  // opts.onSelect: called with selected task object
  var comboId = opts.comboId, inputId = opts.inputId, dropdownId = opts.dropdownId;
  var pidFn = opts.projectIdFn || function() { return null; };
  var stageFn = opts.stageFilterFn || function() { return ''; };
  var onSelect = opts.onSelect;
  var loadFn = _fnName(comboId, 'Load');
  var openFn = _fnName(comboId, 'Open');
  var filterFn = _fnName(comboId, 'Filter');
  var selectFn = _fnName(comboId, 'Select');
  var enterFn = _fnName(comboId, 'Enter');

  function _filterStage(items) {
    var stage = stageFn();
    if (!stage) return items;
    return items.filter(function(t) { return (t.stage_name||'') === stage; });
  }

  window[loadFn] = async function() {
    var pid = pidFn();
    if (!pid) { window['_combo_'+comboId] = []; return []; }
    try {
      var data = await API.get('/tasks?project_id=' + pid + '&limit=100');
      var items = (data && data.items) ? data.items : (data || []);
      window['_combo_'+comboId] = items;
      return _filterStage(items);
    } catch(e) { window['_combo_'+comboId] = []; return []; }
  };

  window[openFn] = function() {
    window[loadFn]().then(function(items) {
      var wrap = document.getElementById(comboId); if (!wrap) return;
      wrap.classList.add('open');
      var inp = document.getElementById(inputId); if (inp) inp.select();
      _renderTaskDropdown(dropdownId, items, '', selectFn);
    });
  };

  window[filterFn] = function(q) {
    var items = _filterStage(window['_combo_'+comboId] || []);
    _renderTaskDropdown(dropdownId, items, q, selectFn);
  };

  window[selectFn] = function(id) {
    var wrap = document.getElementById(comboId); if (wrap) wrap.classList.remove('open');
    var items = window['_combo_'+comboId] || [];
    var t = items.find(function(x) { return x.id == id; });
    if (t) {
      document.getElementById(inputId).value = t.name || t.title || '';
      if (onSelect) onSelect(t);
    }
  };

  window[enterFn] = function(e) {
    if (e.key !== 'Enter') return;
    var dd = document.getElementById(dropdownId);
    if (!dd) return;
    var first = dd.querySelector('.combo-opt');
    if (first) first.click();
  };

  return '<div class="proj-combo" id="' + comboId + '" style="min-width:0!important">' +
    '<input class="proj-combo-input" id="' + inputId + '" type="text" autocomplete="off" placeholder="' + escHtml(opts.placeholder || '先选择项目后搜索任务...') + '" ' +
      'onclick="' + openFn + '()" oninput="' + filterFn + '(this.value)" onkeydown="' + enterFn + '(event)">' +
    '<svg class="proj-combo-arrow" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="2,5 7,10 12,5"/></svg>' +
    '<div class="proj-combo-dropdown" id="' + dropdownId + '"></div>' +
  '</div>';
}

function _renderTaskDropdown(dropdownId, items, q, selectFnName) {
  var dd = document.getElementById(dropdownId);
  if (!dd) return;
  var v = (q || '').trim().toLowerCase();
  var list = v ? items.filter(function(t) {
    return (t.name || t.title || '').toLowerCase().indexOf(v) >= 0;
  }) : items;
  if (!list.length) { dd.innerHTML = '<div class="combo-no-match">未找到匹配任务</div>'; return; }
  dd.innerHTML = list.map(function(t) {
    return '<div class="combo-opt" onmousedown="event.preventDefault()" onclick="' + selectFnName + '(' + t.id + ')">' +
      '<div class="combo-opt-name">' + escHtml(t.name || t.title || '?') + '</div>' +
    '</div>';
  }).join('');
}

function createProjectCombo(opts) {
  _setupComboFunctions(opts);
  var openFn = _fnName(opts.comboId, 'Open');
  var filterFn = _fnName(opts.comboId, 'Filter');
  var enterFn = _fnName(opts.comboId, 'Enter');
  window[enterFn] = function(e) { if (e.key === 'Enter') { var dd = document.getElementById(opts.dropdownId); if (dd) { var f = dd.querySelector('.combo-opt'); if (f) f.click(); } } };
  return '<div class="proj-combo" id="' + opts.comboId + '">' +
    '<input class="proj-combo-input" id="' + opts.inputId + '" type="text" autocomplete="off" placeholder="' + escHtml(opts.placeholder || '搜索或选择项目…') + '" ' +
      'onclick="' + openFn + '()" oninput="' + filterFn + '(this.value)" onkeydown="' + enterFn + '(event)">' +
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
  var cacheKey = '_combo_data_' + comboId;

  var openFn = _fnName(comboId, 'Open');
  var filterFn = _fnName(comboId, 'Filter');
  var selectFn = _fnName(comboId, 'Select');

  function _loadAndCache() {
    return Promise.resolve(typeof getData === 'function' ? getData() : getData).then(function(items) {
      window[cacheKey] = items || [];
      return window[cacheKey];
    });
  }

  window[openFn] = function() {
    var wrap = document.getElementById(comboId);
    if (wrap) wrap.classList.add('open');
    var input = document.getElementById(inputId);
    if (input) input.select();
    _loadAndCache().then(function(items) {
      _renderSearchDropdown(dropdownId, items, selectedIdFn(), '', selectFn);
    });
  };

  // Enter to select first result (same pattern as createProjectCombo)
  setTimeout(function() {
    var input = document.getElementById(inputId);
    if (input) {
      input.onkeydown = function(e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        var dd = document.getElementById(dropdownId);
        if (!dd || dd.children.length === 0) return;
        var first = dd.querySelector('.combo-opt');
        if (first) first.click();
      };
    }
  }, 200);

  window[filterFn] = function(q) {
    _loadAndCache().then(function(items) {
      _renderSearchDropdown(dropdownId, items, selectedIdFn(), q, selectFn);
    });
  };

  window[selectFn] = function(id) {
    var wrap = document.getElementById(comboId);
    if (wrap) wrap.classList.remove('open');
    // Sync update from cache first (avoid race with user clicking save)
    var cached = window[cacheKey] || [];
    var p = cached.find(function(x) { return x.id == id; });
    if (p) {
      document.getElementById(inputId).value = p.name;
      if (onSelect) onSelect(p);
    }
    // Also refresh cache for next use
    _loadAndCache();
  };
}

function _renderSearchDropdown(dropdownId, items, selectedId, q, selectFnName) {
  var dd = document.getElementById(dropdownId);
  if (!dd) return;
  var v = (q || '').trim().toLowerCase();
  var list = v ? items.filter(function(p) {
    return (p.code || '').toLowerCase().indexOf(v) >= 0 ||
      (p.name || '').toLowerCase().indexOf(v) >= 0 ||
      (p.full_name || '').toLowerCase().indexOf(v) >= 0;
  }) : items;
  if (!list.length) { dd.innerHTML = '<div class="combo-no-match">未找到匹配项目</div>'; return; }
  dd.innerHTML = list.map(function(p) {
    var cls = (p.id == selectedId || p.code == selectedId) ? 'combo-opt selected' : 'combo-opt';
    return '<div class="' + cls + '" onmousedown="event.preventDefault()" onclick="' + selectFnName + '(\'' + p.id + '\')">' +
      '<div class="combo-opt-name">' + escHtml(p.code || p.name) + '</div>' +
      (p.code ? '<div class="combo-opt-meta">' + escHtml(p.name) + '</div>' : (p.full_name ? '<div class="combo-opt-meta">' + escHtml(p.full_name) + '</div>' : '')) +
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
    var cls = (p.id == selectedId || p.code == selectedId) ? 'combo-opt selected' : 'combo-opt';
    return '<div class="' + cls + '" onmousedown="event.preventDefault()" onclick="' + selectFnName + '(\'' + p.id + '\')">' +
      '<div class="combo-opt-name">' + escHtml(p.code || p.name) + '</div>' +
      (p.code ? '<div class="combo-opt-meta">' + escHtml(p.name) + '</div>' : (p.full_name ? '<div class="combo-opt-meta">' + escHtml(p.full_name) + '</div>' : '')) +
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

  var enterFn = _fnName(comboId, 'Enter');
  window[enterFn] = function(e) { if (e.key === 'Enter') { var dd = document.getElementById(dropdownId); if (dd) { var f = dd.querySelector('.combo-opt'); if (f) f.click(); } } };
  return '<div class="proj-combo" id="' + comboId + '">' +
    '<input class="proj-combo-input" id="' + inputId + '" type="text" autocomplete="off" placeholder="' + escHtml(opts.placeholder || '搜索负责人...') + '" ' +
      'onclick="' + openFn + '()" oninput="' + filterFn + '(this.value)" onkeydown="' + enterFn + '(event)">' +
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
    return '<div class="'+cls+'" onmousedown="event.preventDefault()" onclick="' + selectFnName + '(\'' + u.id + '\')">' +
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
      '<button class="btn-xs" style="color:var(--fg);background:var(--bg);border:1px solid var(--border)" onclick="_calShift(-1)">◀</button>' +
      '<button class="btn-xs" style="font-weight:600;color:var(--fg);background:var(--bg);border:1px solid var(--border)" onclick="_calGoToday()">今天</button>' +
      '<button class="btn-xs" style="color:var(--fg);background:var(--bg);border:1px solid var(--border)" onclick="_calShift(1)">▶</button>' +
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

    // Cell color fill: gradient bar proportional to hours (0-8h blue, >8h yellow→red)
    var cellBg = '', tipText = '';
    if (isCurrentMonth && h > 0) {
      tipText = (typeof fmtHours === 'function' ? fmtHours(h) : h.toFixed(1)+'h');
      if (dd && dd.checkin_info) tipText += ' | ' + dd.checkin_info.trim();
      if (h < 8) {
        var pct = h/8*100;
        var blueColor = isDark ? '#6B9FFF' : '#3B82F6';
        cellBg = 'background:linear-gradient(to top,' + blueColor + ' ' + pct + '%,transparent ' + pct + '%);';
      } else if (h < 8.5) {
        cellBg = 'background:var(--success);'; // green: 8h ~ 8h30m
      } else {
        // 8 levels, each 1h, from yellow #EAFF00 to red #FF2400
        var overLevel = Math.min(7, Math.floor(h - 8.5));
        // Theme-aware OT colors: light=low-sat muted, dark=higher-luminance for visibility
        var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        var otColors = isDark
          ? ['#D4C89A','#D4B078','#D49860','#CC8050','#C06844','#B0503C','#A04038','#903434']
          : ['#C5B88A','#C9A070','#C88860','#C07054','#B4604C','#A45048','#944444','#843A3A'];
        cellBg = 'background:' + otColors[overLevel] + ';';
      }
    } else if (intensity.bg) {
      // Fallback to intensity-based solid color for current month with 0h
      cellBg = intensity.bg + ';';
    }
    cells += '<div onclick="openDayDetail(\''+dStr+'\','+h+(calData&&calData._wecom?',true':'')+')" '+(tipText?'title="'+tipText+'"':'')+' style="border:1px solid '+(isToday?'var(--accent)':'var(--border)')+';border-radius:4px;padding:3px 2px;text-align:center;cursor:pointer;' +
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

var _dayDetailTasks = []; // closure for edit/copy operations

function openDayDetail(dateStr, totalHours, fromWecom) {
  if (fromWecom) {
    API.get('/wecom/calendar?date_from='+dateStr+'&date_to='+dateStr).then(function(data) {
      var dd = (data && data.daily && data.daily.length) ? data.daily[0] : null;
      var checkins = (dd && dd.checkins) ? dd.checkins : [];
      var rowsHtml = '';
      if (checkins.length) {
        checkins.forEach(function(c, i) {
          var tag = c.type.indexOf('上班') >= 0 ? '↑' : '↓';
          var cls = c.type.indexOf('上班') >= 0 ? 'color:var(--accent)' : 'color:var(--warn)';
          var ex = c.exception ? (' <span style="font-size:10px;color:var(--danger)">' + escHtml(c.exception) + '</span>') : '';
          rowsHtml += '<tr>' +
            '<td style="text-align:center;color:var(--muted)">' + (i+1) + '</td>' +
            '<td style="font-weight:600;' + cls + '">' + tag + ' ' + escHtml(c.type) + '</td>' +
            '<td style="font-family:var(--mono);font-weight:500">' + escHtml(c.time) + ex + '</td>' +
            '<td style="font-size:11px;color:var(--muted);max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escHtml(c.location) + '">' + escHtml(c.location || '—') + '</td>' +
          '</tr>';
        });
      }
      var tableHtml = rowsHtml ? '<div style="max-height:360px;overflow-y:auto;margin:-12px -16px 0 -16px"><table class="proj-table" style="font-size:11px;margin:0"><thead><tr>' +
        '<th style="width:30px">#</th><th style="width:90px">类型</th><th style="width:80px">时间</th><th>地点</th>' +
        '</tr></thead><tbody>' + rowsHtml + '</tbody></table></div>' : '<div style="color:var(--muted);text-align:center;padding:20px">当日无打卡记录</div>';
      var titleStr = dateStr + ' 打卡详情 (' + (typeof fmtHours === 'function' ? fmtHours(totalHours) : totalHours.toFixed(1)+'h') + ')';
      openDialog(titleStr,
        tableHtml, [{text:'关闭',onclick:"document.querySelector('.note-dialog-overlay').remove()"}]);
    }).catch(function() {
      showToast('加载打卡详情失败', 'error');
    });
    return;
  }
  var uid = '';
  try { var u = JSON.parse(localStorage.getItem('pma_user') || '{}'); uid = u.id || ''; } catch(e) {}
  API.get('/worklogs/calendar?user_id=' + uid + '&date_from='+dateStr+'&date_to='+dateStr).then(function(data) {
    var daily = (data&&data.daily) ? data.daily : [];
    var dayData = daily.length ? daily[0] : null;
    _dayDetailTasks = [];
    var rowsHtml = '';
    if (dayData && dayData.tasks && dayData.tasks.length) {
      _dayDetailTasks = dayData.tasks;
      dayData.tasks.forEach(function(t, i) {
        var rowNum = i + 1;
        var desc = (t.description || '').substring(0, 60) + ((t.description||'').length > 60 ? '...' : '');
        var recordedAt = t.created_at ? fmtISODateTime(t.created_at).substring(11, 19) : '';
        rowsHtml += '<tr>' +
          '<td style="text-align:center;color:var(--muted)">' + rowNum + '</td>' +
          '<td style="font-size:11px;color:var(--muted);white-space:nowrap">' + escHtml(recordedAt) + '</td>' +
          '<td style="font-family:var(--mono);font-size:11px">' + escHtml(t.project_code||'') + '</td>' +
          '<td style="font-size:12px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+escHtml(t.project_name||'')+'">' + escHtml(t.project_name||'') + '</td>' +
          '<td style="font-size:12px">' + escHtml(t.stage_name||'') + '</td>' +
          '<td style="font-size:12px;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+escHtml(t.title||'')+'">' + escHtml(t.title||'') + '</td>' +
          '<td style="text-align:center">' + (t.progress||0) + '%</td>' +
          '<td style="text-align:right;font-weight:500">' + t.hours.toFixed(1) + 'h</td>' +
          '<td style="font-size:11px;color:var(--muted);max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+escHtml(t.description||'')+'">' + escHtml(desc) + '</td>' +
          '<td style="white-space:nowrap">' +
            iconEdit('editWorklogEntryById(' + t.id + ',\'' + dateStr + '\')', '编辑') +
            iconDelete('deleteWorklogEntry(' + t.id + ',' + (t.source==='bug'?'true':'false') + ')', '删除') +
            iconCopy('copyWorklogEntryById(' + t.id + ',\'' + dateStr + '\')', '复制') +
          '</td>' +
        '</tr>';
      });
    }
    var tableHtml = rowsHtml ? '<div style="max-height:420px;overflow-y:auto;margin:-12px -16px 0 -16px"><table class="proj-table" style="font-size:11px;margin:0"><thead><tr>' +
      '<th style="width:36px">#</th><th style="width:48px">记录时间</th><th style="width:70px">项目编号</th><th>项目名</th><th>阶段</th><th>任务名</th><th style="width:52px">进度</th><th style="width:52px">工时</th><th>工作内容</th><th style="width:80px">操作</th>' +
      '</tr></thead><tbody>' + rowsHtml + '</tbody></table></div>' : '<div style="color:var(--muted);text-align:center;padding:20px">当日无工时记录</div>';
    openDialog(dateStr+' 工时详情 ('+totalHours.toFixed(1)+'h)',
      tableHtml,
      [{text:'记录工时',cls:'btn-primary',onclick:'openWorklogFromCalendar(\''+dateStr+'\')'},
       {text:'关闭',onclick:"document.querySelector('.note-dialog-overlay').remove()"}],
      {maxWidth: '80vw'});
  }).catch(function(e) {
    showToast('加载详情失败: '+(e.message||'未知错误'), 'error');
  });
}

function _findDayTask(id) { return _dayDetailTasks.find(function(t){return t.id===id;}); }

function editWorklogEntryById(wlId, dateStr) {
  var t = _findDayTask(wlId);
  if (!t) { showToast('数据已过期，请刷新', 'error'); return; }
  editWorklogEntry(t, dateStr);
}

function copyWorklogEntryById(wlId, dateStr) {
  var t = _findDayTask(wlId);
  if (!t) { showToast('数据已过期，请刷新', 'error'); return; }
  copyWorklogEntry(t, dateStr);
}

function editWorklogEntry(t, dateStr) {
  var isBug = t.source === 'bug';
  var projectHtml = isBug ? '' :
    '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">项目</label>' +
      createProjectCombo({comboId: 'wl-edit-proj', inputId: 'wl-edit-proj-input', dropdownId: 'wl-edit-proj-dd', placeholder: '搜索项目...',
        onSelect: function(p) {
          document.getElementById('wl-edit-project-id').value = p.id;
          document.getElementById('wl-edit-project-code').value = p.code || '';
          _wlEditLoadStages(p.code || '');
        }}) + '</div>';
  var stageTaskHtml = isBug ? '' :
    '<input type="hidden" id="wl-edit-project-id" value="' + (t.project_id||'') + '">' +
    '<input type="hidden" id="wl-edit-project-code" value="' + escHtml(t.project_code||'') + '">' +
    '<div style="margin-bottom:8px;display:flex;gap:8px">' +
      '<div style="flex:1"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">阶段</label>' +
        '<select class="search-inp" id="wl-edit-stage" style="width:100%;box-sizing:border-box" onchange="_wlEditOnStageChange()"><option value="">全部阶段</option></select></div>' +
      '<div style="flex:2"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">任务</label>' +
        createTaskCombo({comboId: 'wl-edit-task', inputId: 'wl-edit-task-input', dropdownId: 'wl-edit-task-dd',
          projectIdFn: function() { return document.getElementById('wl-edit-project-code').value; },
          stageFilterFn: function() { return document.getElementById('wl-edit-stage').value; },
          onSelect: function(tsk) {
            document.getElementById('wl-edit-task-id').value = tsk.id;
            document.getElementById('wl-edit-progress').value = tsk.progress || 0;
          }}) + '</div></div>' +
    '<input type="hidden" id="wl-edit-task-id" value="' + (t.task_id||'') + '">';
  var html = '<div>' + projectHtml + stageTaskHtml +
    '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">日期 *</label>' +
      '<input class="search-inp" id="wl-edit-date" type="date" required value="'+dateStr+'" style="width:100%;box-sizing:border-box;margin-top:2px"></div>' +
    '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">工时(h) *</label>' +
      '<input class="search-inp" id="wl-edit-hours" type="number" step="0.5" min="0.5" required value="'+t.hours+'" style="width:100%;box-sizing:border-box;margin-top:2px"></div>' +
    (isBug ? '' : '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">进度(%) *</label>' +
      '<input class="search-inp" id="wl-edit-progress" type="number" min="0" max="100" step="5" required value="'+(t.progress||0)+'" style="width:100%;box-sizing:border-box;margin-top:2px"></div>') +
    '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">工作描述</label>' +
      '<textarea class="search-inp" id="wl-edit-desc" rows="2" style="width:100%;box-sizing:border-box;margin-top:2px;resize:vertical">'+escHtml(t.description||'')+'</textarea></div>' +
    '</div>';
  openDialog('编辑工时', html, [
    {text:'取消',onclick:'closeSharedDialog()'},
    {text:'保存',cls:'btn-primary',onclick:'saveWorklogEntry('+t.id+','+(isBug?'true':'false')+')'}
  ], {maxWidth: isBug ? 400 : 480});
  if (!isBug) {
    setTimeout(function() {
      var inp = document.getElementById('wl-edit-proj-input');
      if (inp && t.project_code) inp.value = t.project_code + ' ' + (t.project_name||'');
      if (t.project_code) _wlEditLoadStages(t.project_code, t.stage_name);
      var taskInp = document.getElementById('wl-edit-task-input');
      if (taskInp && t.title) taskInp.value = t.title;
    }, 150);
  }
}

function _wlEditLoadStages(projectCode, selectedStage) {
  var sel = document.getElementById('wl-edit-stage');
  if (!sel) return;
  sel.innerHTML = '<option value="">加载中...</option>';
  API.get('/tasks?project_id=' + projectCode + '&limit=200').then(function(data) {
    var items = (data && data.items) ? data.items : (data || []);
    var stages = [];
    var seen = {};
    items.forEach(function(t) {
      var s = t.stage_name || '';
      if (s && !seen[s]) { seen[s] = true; stages.push(s); }
    });
    stages.sort();
    sel.innerHTML = '<option value="">全部阶段</option>' + stages.map(function(s) {
      return '<option value="' + escHtml(s) + '"' + (s === selectedStage ? ' selected' : '') + '>' + escHtml(s) + '</option>';
    }).join('');
  }).catch(function() {
    sel.innerHTML = '<option value="">全部阶段</option>';
  });
}

function _wlEditOnStageChange() {
  document.getElementById('wl-edit-task-id').value = '';
  var taskInput = document.getElementById('wl-edit-task-input');
  if (taskInput) taskInput.value = '';
  var loadFn = window['wlEditTaskLoad'];
  if (loadFn) loadFn();
}

async function saveWorklogEntry(wlId, isBug) {
  var hours = parseFloat(document.getElementById('wl-edit-hours').value);
  var desc = document.getElementById('wl-edit-desc').value.trim();
  var date = document.getElementById('wl-edit-date').value;
  var taskIdEl = document.getElementById('wl-edit-task-id');
  var progressEl = document.getElementById('wl-edit-progress');
  var newTaskId = taskIdEl ? (parseInt(taskIdEl.value) || 0) : 0;
  var progress = progressEl ? (parseInt(progressEl.value) || 0) : 0;
  if (!date || !hours || hours <= 0) { showToast('请填写日期和工时', 'error'); return; }
  var url = (isBug ? '/bug-worklogs/' : '/worklogs/') + wlId;
  try {
    var payload = {hours: hours, date: date, description: desc};
    if (newTaskId && !isBug) payload.task_id = newTaskId;
    await API.put(url, payload);
    if (newTaskId && !isBug) await API.put('/tasks/' + newTaskId, {progress: progress});
    closeSharedDialog();
    showToast('工时已更新', 'success');
    if (typeof _ucLoadCalendar === 'function') { var u = getCurrentUser(); if (u) _ucLoadCalendar(u); }
  } catch(e) { showToast('更新失败: '+(e.message||''), 'error'); }
}

async function deleteWorklogEntry(wlId, isBug) {
  if (!confirm('确定删除此工时记录？')) return;
  var url = (isBug ? '/bug-worklogs/' : '/worklogs/') + wlId;
  try {
    await API.del(url);
    showToast('已删除', 'success');
    if (typeof _ucLoadCalendar === 'function') { var u = getCurrentUser(); if (u) _ucLoadCalendar(u); }
  } catch(e) { showToast('删除失败: '+(e.message||''), 'error'); }
}

function copyWorklogEntry(t, dateStr) {
  var html = '<div>' +
    '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">日期 *</label>' +
      '<input class="search-inp" id="wl-copy-date" type="date" required value="'+dateStr+'" style="width:100%;box-sizing:border-box;margin-top:2px"></div>' +
    '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">工时(h) *</label>' +
      '<input class="search-inp" id="wl-copy-hours" type="number" step="0.5" min="0.5" required value="'+t.hours+'" style="width:100%;box-sizing:border-box;margin-top:2px"></div>' +
    '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">工作描述</label>' +
      '<textarea class="search-inp" id="wl-copy-desc" rows="2" style="width:100%;box-sizing:border-box;margin-top:2px;resize:vertical">'+escHtml(t.description||'')+'</textarea></div>' +
    '</div>';
  openDialog('复制工时', html, [
    {text:'取消',onclick:'closeSharedDialog()'},
    {text:'提交',cls:'btn-primary',onclick:'submitCopyWorklog('+t.id+','+(t.source==='bug'?'true':'false')+')'}
  ], {maxWidth:400});
}

async function submitCopyWorklog(wlId, isBug) {
  var t = _findDayTask(wlId);
  var hours = parseFloat(document.getElementById('wl-copy-hours').value);
  var desc = document.getElementById('wl-copy-desc').value.trim();
  var date = document.getElementById('wl-copy-date').value;
  if (!date || !hours || hours <= 0) { showToast('请填写日期和工时', 'error'); return; }
  try {
    var payload = {hours: hours, date: date, description: desc};
    if (isBug) payload.bug_id = t.task_id ? null : (t.project_id || null);
    else payload.task_id = t.task_id;
    await API.post(isBug ? '/bug-worklogs' : '/worklogs', payload);
    closeSharedDialog();
    showToast('工时已复制', 'success');
    if (typeof _ucLoadCalendar === 'function') { var u = getCurrentUser(); if (u) _ucLoadCalendar(u); }
  } catch(e) { showToast('复制失败: '+(e.message||''), 'error'); }
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

/* ── Markdown Rendering ── */
function renderMarkdown(md) {
  if (!md) return '';
  try {
    if (typeof marked !== 'undefined' && marked.parse) {
      return marked.parse(md);
    }
  } catch(e) {}
  return '<pre style="white-space:pre-wrap;font-size:13px">' + escHtml(md) + '</pre>';
}

/* ── Attachment Upload ── */
async function uploadAttachment(bugId, file, analysisId) {
  var fd = new FormData();
  fd.append('file', file);
  if (analysisId) fd.append('analysis_id', String(analysisId));
  var xhr = new XMLHttpRequest();
  return new Promise(function(resolve, reject) {
    xhr.open('POST', '/api/bugs/' + bugId + '/attachments');
    xhr.setRequestHeader('Authorization', 'Bearer ' + (localStorage.getItem('pma_token') || ''));
    xhr.onload = function() {
      if (xhr.status >= 200 && xhr.status < 300) {
        var d = JSON.parse(xhr.responseText);
        resolve(d.data || d);
      } else { reject(new Error('Upload failed: ' + xhr.status)); }
    };
    xhr.onerror = function() { reject(new Error('Network error')); };
    xhr.send(fd);
  });
}

/* ── Image Paste Handler ── */
function initImagePaste(textarea, bugId, onUrlInserted) {
  if (!textarea) return;
  textarea.addEventListener('paste', function(e) {
    var items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (var i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') === 0) {
        e.preventDefault();
        var file = items[i].getAsFile();
        if (!bugId) {
          window._bfPendingFiles = window._bfPendingFiles || [];
          window._bfPendingFiles.push(file);
          var mdImg = '<img src="待上传" alt="' + (file.name || 'image') + '" style="max-width:100%">';
          var start = textarea.selectionStart;
          textarea.value = textarea.value.substring(0, start) + '\n' + mdImg + '\n' + textarea.value.substring(textarea.selectionEnd);
          textarea.selectionStart = textarea.selectionEnd = start + mdImg.length + 2;
          return;
        }
        uploadAttachment(bugId, file).then(function(a) {
          var url = a.url || '/api/attachments/' + a.id;
          var mdImg = '<img src="' + url + '" alt="' + (a.filename || 'image') + '" style="max-width:100%">';
          var start = textarea.selectionStart;
          textarea.value = textarea.value.substring(0, start) + '\n' + mdImg + '\n' + textarea.value.substring(textarea.selectionEnd);
          textarea.selectionStart = textarea.selectionEnd = start + mdImg.length + 2;
          if (onUrlInserted) onUrlInserted(url);
        }).catch(function(err) { showToast('图片上传失败: ' + (err.message || ''), 'error'); });
        break;
      }
    }
  });
}


/* ── Generic Worklog Dialog (used by calendar + task views) ── */

function _wlLoadStages(projectCode) {
  var sel = document.getElementById('wl-stage');
  if (!sel) return;
  sel.innerHTML = '<option value="">加载中...</option>';
  API.get('/tasks?project_id=' + projectCode + '&limit=200').then(function(data) {
    var items = (data && data.items) ? data.items : (data || []);
    var stages = [];
    var seen = {};
    items.forEach(function(t) {
      var s = t.stage_name || '';
      if (s && !seen[s]) { seen[s] = true; stages.push(s); }
    });
    stages.sort();
    sel.innerHTML = '<option value="">全部阶段</option>' + stages.map(function(s) {
      return '<option value="' + escHtml(s) + '">' + escHtml(s) + '</option>';
    }).join('');
  }).catch(function() {
    sel.innerHTML = '<option value="">全部阶段</option>';
  });
}

function _wlOnStageChange() {
  // Clear task selection and re-open task combo
  document.getElementById('wl-task-id').value = '';
  var taskInput = document.getElementById('wl-task-input');
  if (taskInput) taskInput.value = '';
  // Trigger task reload
  var loadFn = window['wlTaskLoad'];
  if (loadFn) loadFn();
}

function openWorklogFromCalendar(dateStr) {
  var html = '<div>' +
    '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">项目</label>' +
      createProjectCombo({comboId: 'wl-proj', inputId: 'wl-proj-input', dropdownId: 'wl-proj-dd', placeholder: '搜索项目...',
        onSelect: function(p) {
          document.getElementById('wl-project-id').value = p.id;
          document.getElementById('wl-project-code').value = p.code || '';
          _wlLoadStages(p.code || '');
        }}) + '</div>' +
    '<input type="hidden" id="wl-project-id" value="">' +
    '<input type="hidden" id="wl-project-code" value="">' +
    '<div style="margin-bottom:8px;display:flex;gap:8px">' +
      '<div style="flex:1"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">阶段</label>' +
        '<select class="search-inp" id="wl-stage" style="width:100%;box-sizing:border-box" onchange="_wlOnStageChange()"><option value="">全部阶段</option></select></div>' +
      '<div style="flex:2"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">任务</label>' +
        createTaskCombo({comboId: 'wl-task', inputId: 'wl-task-input', dropdownId: 'wl-task-dd',
          projectIdFn: function() { return document.getElementById('wl-project-code').value; },
          stageFilterFn: function() { return document.getElementById('wl-stage').value; },
          onSelect: function(t) {
            document.getElementById('wl-task-id').value = t.id;
            document.getElementById('wl-progress').value = t.progress || 0;
          }}) + '</div></div>' +
    '<input type="hidden" id="wl-task-id" value="">' +
    '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">日期 *</label>' +
      '<input class="search-inp" id="wl-date" type="date" required value="'+dateStr+'" style="width:100%;box-sizing:border-box;margin-top:2px"></div>' +
    '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">工时(h) *</label>' +
      '<input class="search-inp" id="wl-hours" type="number" step="0.5" min="0.5" required value="1" style="width:100%;box-sizing:border-box;margin-top:2px"></div>' +
    '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">进度(%) *</label>' +
      '<input class="search-inp" id="wl-progress" type="number" min="0" max="100" step="5" required value="0" style="width:100%;box-sizing:border-box;margin-top:2px"></div>' +
    '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">工作描述 *</label>' +
      '<textarea class="search-inp" id="wl-desc" rows="2" required style="width:100%;box-sizing:border-box;margin-top:2px;resize:vertical"></textarea></div>' +
    '</div>';
  openDialog('记录工时 — ' + dateStr, html, [
    {text:'取消',onclick:'closeSharedDialog()'},
    {text:'提交',cls:'btn-primary',onclick:'submitGenericWorklog()'}
  ], {maxWidth:480});
}

async function submitGenericWorklog() {
  var tid = parseInt(document.getElementById('wl-task-id').value) || 0;
  var hours = parseFloat(document.getElementById('wl-hours').value);
  var progress = parseInt(document.getElementById('wl-progress').value);
  var desc = document.getElementById('wl-desc').value.trim();
  var date = document.getElementById('wl-date').value;
  if (!tid) { showToast('请选择任务', 'error'); return; }
  if (!date) { showToast('请选择日期', 'error'); return; }
  if (!hours || hours <= 0) { showToast('请输入有效的工时数', 'error'); return; }
  if (isNaN(progress) || progress < 0 || progress > 100) { showToast('请输入有效的进度(0-100)', 'error'); return; }
  if (!desc) { showToast('请填写工作描述', 'error'); return; }
  try {
    await API.post('/worklogs', {task_id:tid, hours:hours, date:date, description:desc});
    await API.put('/tasks/'+tid, {progress:progress});
    closeSharedDialog();
    showToast('工时记录成功', 'success');
    if (typeof _ucLoadCalendar === 'function') {
      var user = getCurrentUser();
      if (user) _ucLoadCalendar(user);
    }
  } catch(e) {
    showToast('提交失败: ' + (e.message || ''), 'error');
  }
}
var _selectedTasks = new Set();

function _onTaskCheckbox(cb) {
  var tid = parseInt(cb.value);
  if (cb.checked) _selectedTasks.add(tid); else _selectedTasks.delete(tid);
  _updateBatchToolbar();
}

function _toggleSelectAllTasks(cb) {
  document.querySelectorAll('.task-checkbox').forEach(function(c) {
    // Only toggle visible checkboxes (filtered/paginated views may hide rows)
    if (c.offsetParent === null) return;
    c.checked = cb.checked;
    var tid = parseInt(c.value);
    if (cb.checked) _selectedTasks.add(tid); else _selectedTasks.delete(tid);
  });
  _updateBatchToolbar();
}

function _renderBatchToolbar() {
  return '<div id="batch-toolbar" style="display:none;position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:1000;' +
    'background:var(--accent);color:#fff;padding:8px 16px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.2);' +
    'align-items:center;gap:12px">' +
    '<span id="batch-count">已选 0 个任务</span>' +
    '<button onclick="openBatchEditDialog()" style="padding:4px 12px;border:1px solid #fff;border-radius:4px;background:transparent;color:#fff;cursor:pointer;font-size:12px">批量编辑</button>' +
    '<button onclick="_clearBatchSelection()" style="padding:4px 12px;border:none;border-radius:4px;background:rgba(255,255,255,0.2);color:#fff;cursor:pointer;font-size:12px">取消</button>' +
    '</div>';
}

// Inject batch toolbar into document.body (top-level) to escape stacking contexts
function _ensureBatchToolbar() {
  if (document.getElementById('batch-toolbar')) return;
  document.body.insertAdjacentHTML('beforeend', _renderBatchToolbar());
}

function _adjustBatchToolbarPosition() {
  var bar = document.getElementById('batch-toolbar');
  if (!bar || bar.style.display === 'none') return;
  var bottomH = typeof _getBottomBarHeight === 'function' ? _getBottomBarHeight() : 0;
  bar.style.bottom = (bottomH + 20) + 'px';
}

function _updateBatchToolbar() {
  var bar = document.getElementById('batch-toolbar');
  if (!bar) return;
  var count = _selectedTasks.size;
  if (count > 0) {
    bar.style.display = 'flex';
    document.getElementById('batch-count').textContent = '已选 ' + count + ' 个任务';
    _adjustBatchToolbarPosition();
  } else {
    bar.style.display = 'none';
  }
}

function _clearBatchSelection() {
  _selectedTasks.clear();
  document.querySelectorAll('.task-checkbox').forEach(function(c) { c.checked = false; });
  var allCb = document.getElementById('task-select-all');
  if (allCb) allCb.checked = false;
  _updateBatchToolbar();
}

function openBatchEditDialog() {
  if (_selectedTasks.size === 0) { showToast('请先选择任务', 'error'); return; }
  var inp = 'width:100%;box-sizing:border-box;margin-top:1px';
  var html = '<div style="max-height:500px;overflow-y:auto">' +
    '<div style="margin-bottom:4px;font-size:11px;color:var(--muted)">将对 <b>' + _selectedTasks.size + '</b> 个任务批量设置以下属性（留空=不修改）</div>' +
    '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">指派负责人</label>' +
      '<select class="search-inp" id="ba-assignee" style="' + inp + '"><option value="">不修改</option></select></div>' +
    '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">状态</label>' +
      '<select class="search-inp" id="ba-status" style="' + inp + '"><option value="">不修改</option>' +
        '<option value="todo">待办</option><option value="in_progress">进行中</option><option value="review">评审中</option><option value="done">已完成</option><option value="closed">已关闭</option></select></div>' +
    '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">阶段</label>' +
      '<select class="search-inp" id="ba-stage" style="' + inp + '"><option value="">不修改</option></select></div>' +
    '<div style="display:flex;gap:8px;margin-bottom:8px">' +
      '<div style="flex:1"><label style="font-size:11px;color:var(--muted)">计划开始</label><input class="search-inp" id="ba-start" type="date" style="' + inp + '"></div>' +
      '<div style="flex:1"><label style="font-size:11px;color:var(--muted)">截止日期</label><input class="search-inp" id="ba-due" type="date" style="' + inp + '"></div>' +
    '</div>' +
    '</div>';
  openDialog('批量编辑任务', html, [
    {text:'取消',onclick:'closeSharedDialog()'},
    {text:'确定',cls:'btn-primary',onclick:'submitBatchEdit()'}
  ], {maxWidth:440});
  // Load assignee options from public user list
  API.get('/users/options').then(function(data) {
    if (!data) return;
    var sel = document.getElementById('ba-assignee');
    (data || []).forEach(function(u) {
      sel.innerHTML += '<option value="' + u.id + '">' + escHtml(u.name) + '</option>';
    });
  });
  // Load stage options from first selected task's project
  var firstId = _selectedTasks.values().next().value;
  API.get('/tasks/' + firstId).then(function(task) {
    if (task.project_code) {
      API.get('/tasks?project_id=' + task.project_code + '&limit=200').then(function(data) {
        var sel = document.getElementById('ba-stage');
        var items = data.items || data || [];
        var stages = [...new Set(items.map(function(t) { return t.stage_name; }).filter(Boolean))].sort();
        stages.forEach(function(s) {
          sel.innerHTML += '<option value="' + escHtml(s) + '">' + escHtml(s) + '</option>';
        });
      });
    }
  });
}

async function submitBatchEdit() {
  var updates = {};
  var assignee = document.getElementById('ba-assignee').value;
  var status = document.getElementById('ba-status').value;
  var stage = document.getElementById('ba-stage').value;
  var start = document.getElementById('ba-start').value;
  var due = document.getElementById('ba-due').value;
  if (assignee) updates.assignee_id = parseInt(assignee);
  if (status) updates.status = status;
  if (stage) updates.stage_name = stage;
  if (start) updates.start_date = start;
  if (due) updates.due_date = due;
  if (Object.keys(updates).length === 0) { showToast('请至少设置一个字段', 'error'); return; }
  try {
    var r = await API.put('/tasks/batch', {task_ids: Array.from(_selectedTasks), updates: updates});
    showToast('已更新 ' + r.updated + '/' + r.total + ' 个任务', 'success');
    closeSharedDialog();
    _clearBatchSelection();
    if (typeof loadTaskData === 'function') loadTaskData();
    if (typeof _ucLoadCalendar === 'function') { var u = getCurrentUser(); if (u) _ucLoadCalendar(u); }
  } catch(e) { showToast('批量更新失败: ' + (e.message || ''), 'error'); }
}

function openAssignDialog(taskId) {
  API.get('/tasks/' + taskId).then(function(task) {
    var inp = 'width:100%;box-sizing:border-box;margin-top:1px';
    var html = '<div>' +
      '<div style="margin-bottom:4px;font-size:11px;color:var(--muted)">当前负责人: <b>' + escHtml(task.assignee_name || task.assignee_username || '未指派') + '</b></div>' +
      '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">新负责人</label>' +
        '<select class="search-inp" id="as-assignee" style="' + inp + '"><option value="">加载中...</option></select></div>' +
      '</div>';
    openDialog('指派任务 — ' + escHtml(task.title || ''), html, [
      {text:'取消',onclick:'closeSharedDialog()'},
      {text:'指派',cls:'btn-primary',onclick:'submitAssign(' + taskId + ')'}
    ], {maxWidth:360});
    API.get('/users/options').then(function(data) {
      if (!data) return;
      var sel = document.getElementById('as-assignee');
      sel.innerHTML = '<option value="">不修改</option>';
      (data || []).forEach(function(u) {
        sel.innerHTML += '<option value="' + u.id + '"' + (u.id === task.assignee_id ? ' selected' : '') + '>' + escHtml(u.name) + '</option>';
      });
    });
  }).catch(function(e) { showToast('加载失败: ' + (e.message || ''), 'error'); });
}

async function submitAssign(taskId) {
  var assignee = document.getElementById('as-assignee').value;
  if (!assignee) { showToast('请选择负责人', 'error'); return; }
  try {
    await API.put('/tasks/' + taskId, {assignee_id: parseInt(assignee)});
    closeSharedDialog();
    showToast('已指派', 'success');
    if (typeof loadTaskData === 'function') loadTaskData();
  } catch(e) { showToast('指派失败: ' + (e.message || ''), 'error'); }
}

function openReviewerDialog(taskId) {
  API.get('/tasks/' + taskId).then(function(task) {
    var inp = 'width:100%;box-sizing:border-box;margin-top:1px';
    var html = '<div>' +
      '<div style="margin-bottom:4px;font-size:11px;color:var(--muted)">当前审批人: <b>' + escHtml(task.reviewer_name || '未设置') + '</b></div>' +
      '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">新审批人</label>' +
        '<select class="search-inp" id="rv-reviewer" style="' + inp + '"><option value="">加载中...</option></select></div>' +
      '</div>';
    openDialog('设置审批人 — ' + escHtml(task.title || ''), html, [
      {text:'取消',onclick:'closeSharedDialog()'},
      {text:'确认',cls:'btn-primary',onclick:'submitReviewer(' + taskId + ')'}
    ], {maxWidth:360});
    API.get('/users/options').then(function(data) {
      if (!data) return;
      var sel = document.getElementById('rv-reviewer');
      sel.innerHTML = '<option value="">不修改</option>';
      (data || []).forEach(function(u) {
        sel.innerHTML += '<option value="' + u.id + '"' + (u.id === task.reviewer_id ? ' selected' : '') + '>' + escHtml(u.name) + '</option>';
      });
    });
  }).catch(function(e) { showToast('加载失败: ' + (e.message || ''), 'error'); });
}

async function submitReviewer(taskId) {
  var reviewer = document.getElementById('rv-reviewer').value;
  if (!reviewer) { showToast('请选择审批人', 'error'); return; }
  try {
    await API.put('/tasks/' + taskId, {reviewer_id: parseInt(reviewer)});
    closeSharedDialog();
    showToast('审批人已更新', 'success');
    if (typeof loadTaskData === 'function') loadTaskData();
  } catch(e) { showToast('更新失败: ' + (e.message || ''), 'error'); }
}
