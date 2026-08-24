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

function iconSync(onclick, title) {
  var svg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>';
  return iconBtn(svg, title || '同步到远端', onclick);
}

/* ── Optional/Required toggle (模板管理操作列) ──
   可选 = 空心圆, 必选 = 实心圆; 点击在两者间切换 */
function iconOptional(isOptional, onclick) {
  var glyph = isOptional ? '○' : '●';
  var title = isOptional ? '可选（点击改为必选）' : '必选（点击改为可选）';
  var color = isOptional ? 'var(--accent)' : 'var(--muted)';
  return '<button class="btn btn-icon" style="color:' + color + '" onclick="' + onclick + '" title="' + title + '">' + glyph + '</button>';
}

/* ── Operation column width (derived from icon button count) ──
   Every 操作 column should size itself by the number of icon buttons it renders,
   not by an arbitrary hardcoded width. One .btn-icon ≈ 30px wide
   (icon ~14px + 6px×2 padding + 1px×2 border) + 4px right margin (last excluded);
   the cell adds 10px×2 horizontal padding. Rounded up to the nearest 10px. */
function actionColWidth(n) {
  n = Math.max(1, n | 0);
  return Math.ceil((20 + n * 30 + Math.max(0, n - 1) * 4) / 10) * 10;
}

/* ── Bug Action Icon Buttons ── */

function iconBugConfirm(onclick, disabled) {
  var svg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="8 12 11 15 16 9"/></svg>';
  if (disabled) return '<span class="btn-icon" style="color:var(--muted);opacity:0.35;cursor:not-allowed" title="确认Bug">' + svg + '</span>';
  return '<button class="btn-icon" style="color:var(--success);border:1px solid var(--success);border-radius:4px;background:var(--success-lt);cursor:pointer;line-height:1" onclick="' + onclick + '" title="确认Bug">' + svg + '</button>';
}

function iconBugResolve(onclick, disabled) {
  var svg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 12 9 17 20 6"/></svg>';
  if (disabled) return '<span class="btn-icon" style="color:var(--muted);opacity:0.35;cursor:not-allowed" title="解决Bug">' + svg + '</span>';
  return '<button class="btn-icon" style="color:var(--accent);border:1px solid var(--accent);border-radius:4px;background:var(--accent-lt);cursor:pointer;line-height:1" onclick="' + onclick + '" title="解决Bug">' + svg + '</button>';
}

function iconBugClose(onclick, disabled) {
  var svg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v8"/><path d="M18 6a9 9 0 1 1-12 0"/></svg>';
  if (disabled) return '<span class="btn-icon" style="color:var(--muted);opacity:0.35;cursor:not-allowed" title="关闭">' + svg + '</span>';
  return '<button class="btn-icon" style="color:var(--danger);border:1px solid var(--danger);border-radius:4px;background:var(--danger-lt);cursor:pointer;line-height:1" onclick="' + onclick + '" title="关闭">' + svg + '</button>';
}

function iconBugReopen(onclick, disabled) {
  var svg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>';
  if (disabled) return '<span class="btn-icon" style="color:var(--muted);opacity:0.35;cursor:not-allowed" title="重新激活Bug">' + svg + '</span>';
  return '<button class="btn-icon" style="color:var(--warn);border:1px solid var(--warn);border-radius:4px;background:var(--warn-lt);cursor:pointer;line-height:1" onclick="' + onclick + '" title="重新激活Bug">' + svg + '</button>';
}

/* ── Task Action Icon Buttons (same SVG/style as bug icons, task-specific titles) ── */

function iconTaskDone(onclick, disabled) {
  var svg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 12 9 17 20 6"/></svg>';
  if (disabled) return '<span class="btn-icon" style="color:var(--muted);opacity:0.35;cursor:not-allowed" title="完成任务">' + svg + '</span>';
  return '<button class="btn-icon" style="color:var(--accent);border:1px solid var(--accent);border-radius:4px;background:var(--accent-lt);cursor:pointer;line-height:1" onclick="' + onclick + '" title="完成任务">' + svg + '</button>';
}

function iconTaskActivate(onclick, disabled) {
  var svg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>';
  if (disabled) return '<span class="btn-icon" style="color:var(--muted);opacity:0.35;cursor:not-allowed" title="激活任务">' + svg + '</span>';
  return '<button class="btn-icon" style="color:var(--warn);border:1px solid var(--warn);border-radius:4px;background:var(--warn-lt);cursor:pointer;line-height:1" onclick="' + onclick + '" title="激活任务">' + svg + '</button>';
}

/* ── Favorite helpers ── */

/* ═══════════════════════════════════════════════════
   FAVORITES — unified product + project + task + bug fav, persisted to DB
   Usage: favStar(type, id) returns HTML; isFav(type, id) checks
   ═══════════════════════════════════════════════════ */

var _favProducts = [];
var _favProjects = [];
var _favTasks = [];
var _favBugs = [];
var _favLoaded = false;

async function loadFavorites(force) {
  if (_favLoaded && !force) return;
  try {
    var data = await API.get('/auth/favorites');
    // Handle old format migration: flat array → {products:[], projects:[]}
    if (Array.isArray(data)) { _favProducts = data; _favProjects = []; _favTasks = []; _favBugs = []; }
    else {
      _favProducts = (data && data.products) ? data.products : [];
      _favProjects = (data && data.projects) ? data.projects : [];
      _favTasks = (data && data.tasks) ? data.tasks : [];
      _favBugs = (data && data.bugs) ? data.bugs : [];
    }
  } catch(e) { _favProducts = []; _favProjects = []; _favTasks = []; _favBugs = []; console.error('loadFavorites failed:', e); }
  _favLoaded = true;
}

// Backward compat: product.js callers use this
async function loadFavProducts() { await loadFavorites(); }

function getFavProducts() { return _favProducts; }

function _favList(type) {
  if (type === 'product') return _favProducts;
  if (type === 'project') return _favProjects;
  if (type === 'task') return _favTasks;
  if (type === 'bug') return _favBugs;
  return [];
}

function isFav(type, id) {
  if (typeof type !== 'string') return false;
  return _favList(type).indexOf(id) >= 0;
}

// Backward compat
function isFavProduct(id) { return isFav('product', id); }

async function toggleFav(type, id) {
  var list = _favList(type);
  var idx = list.indexOf(id);
  var wasFav = idx >= 0;
  // Optimistic update
  if (wasFav) { list.splice(idx, 1); }
  else { list.push(id); }
  var ok = false;
  try {
    await API.put('/auth/favorites/toggle', {type: type, id: id});
    ok = true;
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
  if (ok && typeof EventBus !== 'undefined') {
    EventBus.emit('fav:toggled', {type: type, id: id, isFav: !wasFav});
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
  var z = _getZoom();
  var cx = (rect.left + rect.width/2) / z, cy = (rect.top + rect.height/2) / z;
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
  return '<span class="prio-tag prio-' + p + '" title="优先级: ' + (PRIORITY_LABELS[p] || p) + '">' +
    (PRIORITY_LABELS[p] || p) + '</span>';
}

// Deprecated: use renderProgressCircle instead
// renderProgressBar removed — all progress display now uses the ring component

/** Delivery progress ring — n/m format (n=delivered green, m=planned amber).
 *  opts: { label, showEdit, editOnclick } */
function renderDeliveryRing(delivered, planned, size, opts) {
  opts = opts || {};
  var s = size || 74;
  var sw = Math.max(3, Math.round(s * 0.09));
  var r = (s / 2) - sw;
  var cx = s / 2;
  // arcProgress overrides the ring-fill percentage (for big ring aggregated from products)
  var progress = opts.arcProgress !== undefined ? Math.min(100, Math.max(0, opts.arcProgress || 0))
    : (planned > 0 ? Math.min(100, Math.round(delivered / planned * 100)) : 0);
  var circumference = 2 * Math.PI * r;
  var dash = (progress / 100) * circumference;
  var gap = circumference - dash;
  var deliveredColor = 'var(--success)';
  var plannedColor = 'var(--warn)';
  var bgStroke = 'var(--border)';
  var textSize = Math.round(s * 0.22);
  var labelSize = Math.round(s * 0.14);

  var html = '<div class="ring-wrap" style="display:inline-flex;flex-direction:column;align-items:center;gap:4px;position:relative">';

  // Edit button (top-right)
  if (opts.showEdit && opts.editOnclick) {
    html += '<button class="btn-icon ring-edit-btn" style="position:absolute;top:-4px;right:-4px;font-size:' + Math.round(s * 0.13) + 'px;z-index:2;padding:2px 4px;border-radius:4px;background:var(--surface);border:1px solid var(--border);cursor:pointer;opacity:0.7" ' +
      'onclick="' + opts.editOnclick + '" title="编辑计划数量">&#9881;</button>';
  }

  html += '<div style="position:relative;width:' + s + 'px;height:' + s + 'px">' +
    '<svg width="' + s + '" height="' + s + '" viewBox="0 0 ' + s + ' ' + s + '">' +
      '<circle cx="' + cx + '" cy="' + cx + '" r="' + r + '" fill="none" stroke="' + bgStroke + '" stroke-width="' + sw + '"/>' +
      (progress > 0
        ? '<circle cx="' + cx + '" cy="' + cx + '" r="' + r + '" fill="none" stroke="' + deliveredColor + '" stroke-width="' + sw + '"' +
          ' stroke-dasharray="' + dash.toFixed(1) + ' ' + gap.toFixed(1) + '" stroke-linecap="round" transform="rotate(-90 ' + cx + ' ' + cx + ')"/>'
        : '') +
    '</svg>' +
    '<div style="position:absolute;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;line-height:1">' +
      '<span style="font-size:' + textSize + 'px;font-weight:700;font-family:var(--mono)">' +
        '<span style="color:' + deliveredColor + '">' + delivered + '</span>' +
        '<span style="color:var(--muted);font-size:' + Math.round(textSize * 0.65) + 'px"> / </span>' +
        '<span style="color:' + plannedColor + '">' + planned + '</span>' +
      '</span>' +
    '</div>' +
  '</div>';

  if (opts.label) {
    // Use consistent label area height so circles align at bottom across sizes
    var lblH = Math.round(Math.max(size, 120) * 0.16);  // at least big-ring label height
    html += '<div style="font-size:' + labelSize + 'px;color:var(--muted);font-weight:500;text-align:center;max-width:' + (s + 10) + 'px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-height:' + lblH + 'px;line-height:' + lblH + 'px">' + escHtml(opts.label) + '</div>';
  }
  html += '</div>';
  return html;
}

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
  if (existing && !opts.keepExisting) existing.remove();

  var btnHtml = '';
  if (buttons && buttons.length) {
    btnHtml = '<div class="dialog-actions" style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">' +
      buttons.map(function(b) {
        return '<button class="btn ' + (b.cls || '') + '">' + b.text + '</button>';
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

  // Attach button click handlers + auto-focus.
  // Use the LAST overlay with overlayClass: when keepExisting stacks a second
  // dialog, the newly inserted one is last in document order.
  var overlays = document.querySelectorAll('.' + overlayClass);
  var overlay = overlays.length ? overlays[overlays.length - 1] : null;
  if (overlay) {
    if (buttons && buttons.length) {
      overlay.querySelectorAll('.dialog-actions .btn').forEach(function(btn, i) {
        var b = buttons[i];
        if (!b || b.onclick == null) return;
        if (typeof b.onclick === 'function') {
          btn.addEventListener('click', b.onclick);
        } else if (typeof b.onclick === 'string' && b.onclick.trim()) {
          btn.setAttribute('onclick', b.onclick);
        }
      });
    }
    setTimeout(function() {
      // Prefer "取消" button so Enter doesn't accidentally confirm
      var cancelBtn = overlay.querySelector('.note-dialog .btn');
      if (cancelBtn && cancelBtn.textContent.indexOf('取消') >= 0) {
        cancelBtn.focus();
      } else {
        var firstFocusable = overlay.querySelector('input, textarea, select, button:not(.note-dialog-close)');
        if (firstFocusable) firstFocusable.focus();
      }
    }, 50);
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
      // 原始 .md 文件始终按 Markdown 解析（含图片尺寸后缀预处理），不做 HTML 直通判断
      body.innerHTML = '<div style="padding:20px;max-width:900px;margin:0 auto;line-height:1.7">' + markdownToHtml(data, true) + '</div>';
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
  var ext = (url || '').split('.').pop().toLowerCase().split('?')[0];
  var needConvert = (ext === 'vsdx' || ext === 'docx');
  var dlgId = 'fs-doc-dlg-' + Date.now();
  var html = '<div class="note-dialog-overlay" id="' + dlgId + '" style="z-index:9999">' +
    '<div class="note-dialog" style="position:fixed;inset:0;width:100vw;height:100vh;max-width:100vw;max-height:100vh;border-radius:0;display:flex;flex-direction:column">' +
      '<div class="note-dialog-head" style="flex-shrink:0">' +
        '<span class="note-dialog-title">' + escHtml(title || '文档全屏预览') + '</span>' +
        '<span style="display:flex;align-items:center;gap:8px">' +
          '<button class="note-dialog-close" onclick="document.getElementById(\'' + dlgId + '\').remove()">&times;</button>' +
        '</span>' +
      '</div>' +
      '<div style="flex:1;overflow:auto;position:relative" id="' + dlgId + '-body">' +
        '<div id="' + dlgId + '-loading" style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;min-height:300px;color:var(--muted)">' +
          '<div style="display:inline-block;width:40px;height:40px;border:3px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin 0.8s linear infinite;margin-bottom:16px"></div>' +
          '<div style="font-size:13px">正在加载文档预览...</div>' +
          (needConvert ? '<div style="font-size:11px;color:var(--muted);margin-top:4px">首次转换需要 5–15 秒，请稍候…</div>' : '') +
        '</div>' +
        '<iframe src="' + fetchUrl + '" style="width:100%;height:100%;border:none;display:none" ' +
          'onload="var s=document.getElementById(\\\'' + dlgId + '-loading\\\');if(s)s.style.display=\\\'none\\\';this.style.display=\\\'\\\'"></iframe>' +
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
   EVENT BUS — cross-module data-change notifications
   Usage:
     EventBus.emit('task:saved', {taskId: 42})
     EventBus.on('task:saved', function(e) { ... })
   ═══════════════════════════════════════════════════ */

var EventBus = {
  _handlers: {},
  on: function(event, fn) {
    (this._handlers[event] = this._handlers[event] || []).push(fn);
  },
  off: function(event, fn) {
    var list = this._handlers[event];
    if (list) {
      var idx = list.indexOf(fn);
      if (idx >= 0) list.splice(idx, 1);
    }
  },
  emit: function(event, data) {
    (this._handlers[event] || []).forEach(function(fn) { fn(data || {}); });
  }
};

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

function invalidateAllProjects() {
  _allProjectsLoaded = false;
  _allProjects = [];
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

function invalidateAllUsers() {
  _allUsersLoaded = false;
  _allUsers = [];
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

/* ── CC (抄送) Multi-User Selector ── */

function createCcSelector(opts) {
  // opts: { containerId, selectedIds: [], onChange: fn(ids), placeholder }
  var containerId = opts.containerId;
  // Sanitize containerId for use in function names (replace hyphens with underscores)
  var safeId = containerId.replace(/-/g, '_');
  var comboId = containerId + '-combo';
  var inputId = containerId + '-input';
  var dropdownId = containerId + '-dropdown';
  var tagsId = containerId + '-tags';
  var ph = opts.placeholder || '搜索抄送人...';

  // Store selected IDs globally accessible by combo functions
  var key = '_cc_' + safeId;
  window[key] = opts.selectedIds ? opts.selectedIds.slice() : [];

  var openFn = '_ccOpen_' + safeId;
  window[openFn] = function() {
    if (typeof loadAllUsers !== 'function') return;
    loadAllUsers().then(function() {
      document.getElementById(comboId).classList.add('open');
      var inp = document.getElementById(inputId); if (inp) inp.select();
      _renderCcDropdown(dropdownId, window[key], '', containerId);
    });
  };

  var filterFn = '_ccFilter_' + safeId;
  window[filterFn] = function(q) {
    _renderCcDropdown(dropdownId, window[key], q, containerId);
  };

  var selectFn = '_ccSelect_' + safeId;
  window[selectFn] = function(uid) {
    var ids = window[key];
    if (ids.indexOf(uid) >= 0) return; // already selected
    ids.push(uid);
    document.getElementById(inputId).value = '';
    document.getElementById(comboId).classList.remove('open');
    _renderCcTags(containerId);
    if (opts.onChange) opts.onChange(ids.slice());
  };

  var enterFn = '_ccEnter_' + safeId;
  window[enterFn] = function(e) {
    if (e.key === 'Enter') {
      var dd = document.getElementById(dropdownId);
      if (dd) { var f = dd.querySelector('.combo-opt'); if (f) f.click(); }
    }
  };

  // Expose getter/setter for external use
  window['_getCcIds_' + safeId] = function() { return window[key]; };
  window['_setCcIds_' + safeId] = function(ids) { window[key] = ids || []; };

  return '<div style="margin-top:2px">' +
    '<div id="' + tagsId + '" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:4px"></div>' +
    '<div class="proj-combo" id="' + comboId + '" style="width:100%">' +
      '<input class="proj-combo-input" id="' + inputId + '" type="text" autocomplete="off" placeholder="' + escHtml(ph) + '" ' +
        'onclick="' + openFn + '()" oninput="' + filterFn + '(this.value)" onkeydown="' + enterFn + '(event)">' +
      '<svg class="proj-combo-arrow" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="2,5 7,10 12,5"/></svg>' +
      '<div class="proj-combo-dropdown" id="' + dropdownId + '"></div>' +
    '</div>' +
  '</div>';
}

function _renderCcTags(containerId) {
  var safeId = containerId.replace(/-/g, '_');
  var tagsEl = document.getElementById(containerId + '-tags');
  if (!tagsEl) return;
  var ids = window['_cc_' + safeId] || [];
  if (!ids.length) { tagsEl.innerHTML = ''; return; }
  loadAllUsers().then(function() {
    var html = '';
    ids.forEach(function(uid) {
      var u = _allUsers.find(function(x) { return x.id == uid; });
      var name = u ? (u.name || u.display_name || u.username) : ('#' + uid);
      html += '<span style="display:inline-flex;align-items:center;gap:2px;background:var(--accent);color:#fff;padding:1px 6px;border-radius:10px;font-size:11px;white-space:nowrap">' +
        escHtml(name) +
        '<button onclick="event.stopPropagation();var ids=window._cc_' + safeId + ';var idx=ids.indexOf(' + uid + ');if(idx>=0)ids.splice(idx,1);_renderCcTags(\'' + containerId + '\');" ' +
        'style="background:none;border:none;color:inherit;cursor:pointer;padding:0;margin-left:2px;font-size:13px;line-height:1;opacity:0.7">×</button>' +
      '</span>';
    });
    tagsEl.innerHTML = html;
  });
}

function _renderCcDropdown(dropdownId, selectedIds, q, containerId) {
  var safeId = containerId.replace(/-/g, '_');
  var dd = document.getElementById(dropdownId);
  if (!dd) return;
  var v = (q || '').trim().toLowerCase();
  var list = v
    ? _allUsers.filter(function(u) { return (u.name || '').toLowerCase().indexOf(v) >= 0 && selectedIds.indexOf(u.id) < 0; })
    : _allUsers.filter(function(u) { return selectedIds.indexOf(u.id) < 0; });
  list = list.slice(0, 30);
  if (!list.length) { dd.innerHTML = '<div class="combo-opt" style="color:var(--muted)">无匹配用户</div>'; return; }
  var fn = '_ccSelect_' + safeId;
  dd.innerHTML = list.map(function(u) {
    return '<div class="combo-opt" onclick="' + fn + '(' + u.id + ')">' + escHtml(u.name) + '</div>';
  }).join('');
}

/* ── Multi-User Selector (generalized from createCcSelector) ── */
function createMultiUserSelector(opts) {
  // opts: { containerId, selectedIds: [], onChange: fn(ids), placeholder }
  var containerId = opts.containerId;
  var safeId = containerId.replace(/-/g, '_');
  var comboId = containerId + '-combo';
  var inputId = containerId + '-input';
  var dropdownId = containerId + '-dropdown';
  var tagsId = containerId + '-tags';
  var ph = opts.placeholder || '搜索用户...';

  // Store selected IDs globally accessible by combo functions
  var key = '_mu_' + safeId;
  window[key] = opts.selectedIds ? opts.selectedIds.slice() : [];

  var openFn = '_muOpen_' + safeId;
  window[openFn] = function() {
    if (typeof loadAllUsers !== 'function') return;
    loadAllUsers().then(function() {
      document.getElementById(comboId).classList.add('open');
      var inp = document.getElementById(inputId); if (inp) inp.select();
      _muRenderDropdown(dropdownId, window[key], '', containerId);
    });
  };

  var filterFn = '_muFilter_' + safeId;
  window[filterFn] = function(q) {
    _muRenderDropdown(dropdownId, window[key], q, containerId);
  };

  var selectFn = '_muSelect_' + safeId;
  window[selectFn] = function(uid) {
    var ids = window[key];
    if (ids.indexOf(uid) >= 0) return; // already selected
    ids.push(uid);
    document.getElementById(inputId).value = '';
    document.getElementById(comboId).classList.remove('open');
    _muRenderTags(containerId);
    if (opts.onChange) opts.onChange(ids.slice());
  };

  var enterFn = '_muEnter_' + safeId;
  window[enterFn] = function(e) {
    if (e.key === 'Enter') {
      var dd = document.getElementById(dropdownId);
      if (dd) { var f = dd.querySelector('.combo-opt'); if (f) f.click(); }
    }
  };

  // Expose getter/setter for external use
  window['_getMuIds_' + safeId] = function() { return window[key]; };
  window['_setMuIds_' + safeId] = function(ids) { window[key] = ids || []; };

  return '<div style="margin-top:2px">' +
    '<div id="' + tagsId + '" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:4px"></div>' +
    '<div class="proj-combo" id="' + comboId + '" style="width:100%">' +
      '<input class="proj-combo-input" id="' + inputId + '" type="text" autocomplete="off" placeholder="' + escHtml(ph) + '" ' +
        'onclick="' + openFn + '()" oninput="' + filterFn + '(this.value)" onkeydown="' + enterFn + '(event)">' +
      '<svg class="proj-combo-arrow" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="2,5 7,10 12,5"/></svg>' +
      '<div class="proj-combo-dropdown" id="' + dropdownId + '"></div>' +
    '</div>' +
  '</div>';
}

function _muRenderTags(containerId) {
  var safeId = containerId.replace(/-/g, '_');
  var tagsEl = document.getElementById(containerId + '-tags');
  if (!tagsEl) return;
  var ids = window['_mu_' + safeId] || [];
  if (!ids.length) { tagsEl.innerHTML = ''; return; }
  loadAllUsers().then(function() {
    var html = '';
    ids.forEach(function(uid) {
      var u = _allUsers.find(function(x) { return x.id == uid; });
      var name = u ? (u.name || u.display_name || u.username) : ('#' + uid);
      html += '<span style="display:inline-flex;align-items:center;gap:2px;background:var(--accent);color:#fff;padding:1px 6px;border-radius:10px;font-size:11px;white-space:nowrap">' +
        escHtml(name) +
        '<button onclick="event.stopPropagation();var ids=window._mu_' + safeId + ';var idx=ids.indexOf(' + uid + ');if(idx>=0)ids.splice(idx,1);_muRenderTags(\'' + containerId + '\');" ' +
        'style="background:none;border:none;color:inherit;cursor:pointer;padding:0;margin-left:2px;font-size:13px;line-height:1;opacity:0.7">×</button>' +
      '</span>';
    });
    tagsEl.innerHTML = html;
  });
}

function _muRenderDropdown(dropdownId, selectedIds, q, containerId) {
  var safeId = containerId.replace(/-/g, '_');
  var dd = document.getElementById(dropdownId);
  if (!dd) return;
  var v = (q || '').trim().toLowerCase();
  var list = v
    ? _allUsers.filter(function(u) { return (u.name || '').toLowerCase().indexOf(v) >= 0 && selectedIds.indexOf(u.id) < 0; })
    : _allUsers.filter(function(u) { return selectedIds.indexOf(u.id) < 0; });
  list = list.slice(0, 30);
  if (!list.length) { dd.innerHTML = '<div class="combo-opt" style="color:var(--muted)">无匹配用户</div>'; return; }
  var fn = '_muSelect_' + safeId;
  dd.innerHTML = list.map(function(u) {
    return '<div class="combo-opt" onclick="' + fn + '(' + u.id + ')">' + escHtml(u.name) + '</div>';
  }).join('');
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
  var z = _getZoom();
  tip.style.left = (e.clientX/z + 12)+'px';
  tip.style.top = (e.clientY/z - 28)+'px';
  tip.style.display = 'block';
}

function _hidePieTooltip() {
  var tip = document.getElementById('pie-tooltip');
  if (tip) tip.style.display = 'none';
}

var _calYear, _calMonth;

function _renderMergedMonthCalendar(today, wecomDailyMap, wlData, weData) {
  if (!_calYear) { _calYear = today.getFullYear(); _calMonth = today.getMonth()+1; }
  var total = weData ? (weData.total||0) : 0;
  var monthNames = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
  var dayNames = ['一','二','三','四','五','六','日'];

  var firstDay = new Date(_calYear, _calMonth-1, 1);
  var lastDay = new Date(_calYear, _calMonth, 0);
  var startDow = firstDay.getDay()===0 ? 6 : firstDay.getDay()-1;
  var totalDays = lastDay.getDate();
  var prevMonthDays = new Date(_calYear, _calMonth-1, 0).getDate();

  // Build wlDailyMap from wlData
  var wlDailyMap = {};
  if (wlData && wlData.daily) wlData.daily.forEach(function(d) { wlDailyMap[d.date] = d; });

  var html = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">' +
    '<span style="font-size:11px;color:var(--muted)">'+_calYear+'年'+monthNames[_calMonth-1]+' · 打卡工时 '+total.toFixed(1)+'h</span>' +
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
    var y = _calYear, mm = _calMonth-1;
    if (dayNum < 1) { mm--; if(mm<0){mm=11;y--;} }
    else if (dayNum > totalDays) { mm++; if(mm>11){mm=0;y++;} }
    var dStr = y+'-'+String(mm+1).padStart(2,'0')+'-'+String(displayDay).padStart(2,'0');
    var weDay = wecomDailyMap[dStr];
    var wlDay = wlDailyMap[dStr];
    var h = weDay ? (weDay.total_hours || 0) : 0;
    var todayStr = today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0')+'-'+String(today.getDate()).padStart(2,'0');
    var isToday = dStr === todayStr;

    // Check if this date has checkin data
    var hasCheckin = !!(weDay && weDay.total_hours > 0);

    // 圆点：有打卡即显示；红/绿 = PMA 记录工时 vs 打卡工时（记录覆盖打卡 = 100% 绿）
    var wlH = 0;
    if (wlDay && wlDay.tasks) {
      wlDay.tasks.forEach(function(t) { wlH += (t.calculated_hours || t.hours || 0); });
    }
    var dotHtml = '';
    if (isCurrentMonth && hasCheckin) {
      // 与页面展示(.toFixed(1))口径一致：按 0.1h 四舍五入后比较，
      // 避免"显示打卡/记录均 8.2h/100% 却因浮点差(~0.01h)判红点"的误导
      var filled = Math.round(wlH * 10) >= Math.round(h * 10);
      dotHtml = '<span style="position:absolute;top:1px;right:2px;width:6px;height:6px;border-radius:50%;background:' +
                (filled ? 'var(--success)' : 'var(--danger)') + '"></span>';
    }

    // Cell color fill based on WeCom checkin hours
    var cellBg = '', tipText = '';
    if (isCurrentMonth && h > 0) {
      tipText = (typeof fmtHours === 'function' ? fmtHours(h) : h.toFixed(1)+'h');
      if (h < 8) {
        var pct = h/8*100;
        var blueColor = 'var(--accent)';
        cellBg = 'background:linear-gradient(to top,' + blueColor + ' ' + pct + '%,transparent ' + pct + '%);';
      } else if (h < 8.5) {
        cellBg = 'background:var(--success);';
      } else {
        var otColors = ['#C5B88A','#C9A070','#C88860','#C07054','#B4604C','#A45048','#944444','#843A3A'];
        var overLevel = Math.min(7, Math.floor(h - 8.5));
        cellBg = 'background:' + otColors[overLevel] + ';';
      }
    }

    // 工作日（周一~五）无打卡 → 红边框（仅限过去日期，未来未打卡属正常）；今天 → accent
    var dow = new Date(y, mm, displayDay).getDay();
    var isWorkday = dow >= 1 && dow <= 5;
    var borderColor = 'var(--border)';
    var borderWidth = '1px';
    if (isCurrentMonth && isWorkday && !hasCheckin && dStr < todayStr) {
      borderColor = 'var(--danger)';
      borderWidth = '2px';
    } else if (isToday) {
      borderColor = 'var(--accent)';
    }

    cells += '<div onclick="_openMergedDayDetail(\''+dStr+'\','+h+','+hasCheckin+')" '+(tipText?'title="'+tipText+'"':'')+' style="position:relative;border:'+borderWidth+' solid '+borderColor+';border-radius:4px;padding:3px 2px;text-align:center;cursor:pointer;' +
      cellBg + ';' + (isCurrentMonth ? '' : 'opacity:0.35;') + '">' +
      '<div style="font-size:11px;font-weight:'+(isToday?'700':'400')+';color:'+(isCurrentMonth?'var(--fg)':'var(--muted)')+'">'+displayDay+'</div>' +
      dotHtml +
    '</div>';
  }
  html += '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px">'+cells+'</div>';
  return html;
}

function _openMergedDayDetail(dateStr, checkinHours, hasCheckin) {
  function render(wlData) {
    var tasks = (wlData && wlData.daily && wlData.daily[0]) ? wlData.daily[0].tasks : [];
    _dayDetailTasks = tasks; // populate for edit/copy operations

    // Build rows
    var rowsHtml = '';
    var rowNum = 0;
    tasks.forEach(function(t) {
      rowNum++;
      var desc = t.description || '';
      if (desc.length > 60) desc = desc.substring(0, 57) + '...';
      var typeBadge = t.source === 'bug'
        ? '<span style="font-size:9px;padding:1px 4px;border-radius:3px;background:var(--danger)20;color:var(--danger)">BUG</span>'
        : '<span style="font-size:9px;padding:1px 4px;border-radius:3px;background:var(--accent)20;color:var(--accent)">任务</span>';
      rowsHtml += '<tr>' +
        '<td style="text-align:center">' + rowNum + '</td>' +
        '<td style="font-size:13px;font-family:var(--mono);color:var(--muted)">' + (t.created_at||'').substring(11,16) + '</td>' +
        '<td style="font-family:var(--mono);font-size:13px;color:var(--accent)">' + escHtml(t.project_code||'') + '</td>' +
        '<td style="font-size:14px;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHtml(t.project_name||'') + '</td>' +
        '<td style="font-size:13px;color:var(--muted)">' + escHtml(t.stage_name||t.component_name||'') + '</td>' +
        '<td style="font-size:14px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+escHtml(t.title||'')+'">' + escHtml(t.title||'') + '</td>' +
        '<td style="text-align:center">' + typeBadge + '</td>' +
        '<td style="text-align:center">' + (t.progress||0) + '%</td>' +
        '<td style="text-align:center;font-weight:600;color:var(--accent)">' + (t.percentage ? t.percentage+'%' : '<span style="color:var(--muted)">—</span>') + '</td>' +
        '<td style="text-align:right;font-weight:500">' + ((t.calculated_hours||t.hours||0)).toFixed(1) + 'h</td>' +
        '<td style="font-size:13px;color:var(--muted);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+escHtml(t.description||'')+'">' + escHtml(desc) + '</td>' +
        '<td style="white-space:nowrap">' +
          (window._ucViewUserId ? '' :
            iconEdit('editWorklogEntryById(' + t.id + ',\'' + dateStr + '\')', '编辑') +
            iconDelete('deleteWorklogEntry(' + t.id + ',' + (t.source==='bug'?'true':'false') + ',' + (t.bug_id||'null') + ')', '删除')) +
        '</td></tr>';
    });

    // Summary stats
    var totalCalcH = 0, entryCount = tasks.length;
    tasks.forEach(function(t) {
      totalCalcH += (t.calculated_hours || t.hours || 0);
    });

    // Merged summary bar: checkin + worklog stats in one row
    // Always render the full structure; zero/empty values shown as-is (issue #263)
    var checkinLabel = '<span style="font-size:15px;color:var(--muted)">打卡 <b style="color:' + (hasCheckin ? 'var(--success)' : 'var(--muted)') + ';font-size:17px">' + checkinHours.toFixed(1) + 'h</b></span>';
    var ratioText = checkinHours > 0
      ? '<span style="font-size:15px;color:var(--muted)" title="已记录工时 ÷ 打卡工时的比例">记录/打卡 <b style="color:var(--fg);font-size:17px">' + (totalCalcH / checkinHours * 100).toFixed(0) + '%</b></span>'
      : '<span style="font-size:15px;color:var(--muted)" title="已记录工时 ÷ 打卡工时的比例">记录/打卡 <b style="color:var(--fg);font-size:17px">—</b></span>';

    var summaryBar = '<div style="display:flex;gap:16px;padding:12px 16px;margin-bottom:12px;background:var(--bg);border-radius:8px;border:1px solid var(--border);align-items:center;flex-wrap:wrap">' +
      checkinLabel +
      '<span style="color:var(--border)">|</span>' +
      '<span style="font-size:15px;color:var(--muted)" title="当天所有工时记录的总小时数">已记录 <b style="color:var(--fg);font-size:17px">' + totalCalcH.toFixed(1) + 'h</b></span>' +
      '<span style="font-size:15px;color:var(--muted)">' + entryCount + ' 条</span>' +
      ratioText +
    '</div>' +
    '<div id="wl-checkin-detail" style="font-size:15px;color:var(--muted);margin-bottom:10px;padding:10px 14px;background:var(--bg);border-radius:8px;border:1px solid var(--border);display:none">加载打卡详情...</div>';

    var tableHtml = summaryBar + (rowsHtml ? '<div style="max-height:420px;overflow-y:auto;margin:0 -16px 0 -16px"><table class="proj-table" style="font-size:14px;margin:0"><thead><tr>' +
      '<th style="width:28px">#</th><th style="width:42px">时间</th><th style="width:60px">项目</th><th>项目名</th><th>阶段</th><th>任务</th><th style="width:36px">类型</th><th style="width:40px">进度</th><th style="width:52px" title="该记录占当天所有工时记录的比例">当日占比</th><th style="width:44px">工时</th><th>内容</th><th style="width:68px">操作</th>' +
      '</tr></thead><tbody>' + rowsHtml + '</tbody></table></div>' : '<div style="color:var(--muted);text-align:center;padding:20px">当日无工时记录</div>');

    // Update dialog body in-place (reuse the existing dialog if open)
    var overlay = document.querySelector('.note-dialog-overlay');
    if (overlay) {
      var body = overlay.querySelector('.note-dialog');
      if (body) {
        // Preserve header, replace body content after header
        var head = body.querySelector('.note-dialog-head');
        var afterHead = head ? head.nextElementSibling : null;
        // Remove all content after head
        while (body.lastChild && body.lastChild !== head) {
          body.removeChild(body.lastChild);
        }
        // Insert new content
        var wrapper = document.createElement('div');
        wrapper.innerHTML = tableHtml;
        while (wrapper.firstChild) {
          body.appendChild(wrapper.firstChild);
        }
        // Update footer buttons
        var footer = body.querySelector('.note-dialog-foot');
        if (!footer) {
          footer = document.createElement('div');
          footer.className = 'note-dialog-foot';
          footer.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:14px;padding-top:12px;border-top:1px solid var(--border)';
          body.appendChild(footer);
        }
        var isViewingOther = !!window._ucViewUserId;
        footer.innerHTML = (isViewingOther ? '' : '<button class="btn btn-sm btn-primary" onclick="openWorklogFromCalendar(\''+dateStr+'\')">记录工时</button>') +
          '<button class="btn btn-sm" onclick="document.querySelector(\'.note-dialog-overlay\').remove()">关闭</button>';
        return;
      }
    }

    // First open
    var isViewingOther = !!window._ucViewUserId;
    var dlgButtons = isViewingOther
      ? [{text:'关闭',onclick:"document.querySelector('.note-dialog-overlay').remove()"}]
      : [{text:'记录工时',cls:'btn-primary',onclick:'openWorklogFromCalendar(\''+dateStr+'\')'},
         {text:'关闭',onclick:"document.querySelector('.note-dialog-overlay').remove()"}];
    openDialog(dateStr+' 工时详情',
      tableHtml,
      dlgButtons,
      {maxWidth: '80vw'});
    // Fetch checkin details
    _loadCheckinDetail(dateStr);
  }

  function _loadCheckinDetail(dateStr) {
    var uid = window._ucViewUserId || (getCurrentUser() ? getCurrentUser().id : '');
    var detailEl = document.getElementById('wl-checkin-detail');
    if (!detailEl) return;
    API.get('/wecom/calendar?user_id=' + uid + '&date_from=' + dateStr + '&date_to=' + dateStr).then(function(data) {
      var day = (data && data.daily && data.daily.length) ? data.daily[0] : null;
      var lines = [];
      if (day && day.checkins && day.checkins.length) {
        day.checkins.forEach(function(c) {
          var t = c.type || '打卡';
          var tm = c.time || '?';
          var ex = c.exception ? ' <span style="color:var(--warn)">(' + c.exception + ')</span>' : '';
          var loc = c.location ? ' @' + c.location : '';
          lines.push(t + ': ' + tm + ex + loc);
        });
      }
      if (day && day.approvals && day.approvals.length) {
        day.approvals.forEach(function(a) {
          lines.push('<span style="color:var(--accent)">' + (a.name || '审批') + '</span> ' + (a.start_time||'') + '-' + (a.end_time||''));
        });
      }
      // No checkin/approval data: still render the structure, values left empty (issue #263)
      if (!lines.length) {
        lines.push('上班打卡: -- <span style="color:var(--warn)">(未打卡)</span>');
        lines.push('下班打卡: -- <span style="color:var(--warn)">(未打卡)</span>');
      }
      detailEl.innerHTML = lines.join(' | ');
      detailEl.style.display = '';
    }).catch(function() {
      if (detailEl) { detailEl.innerHTML = ''; detailEl.style.display = 'none'; }
    });
  }

  function fetchAndRender() {
    var uid = window._ucViewUserId || (getCurrentUser() ? getCurrentUser().id : '');
    API.get('/worklogs/calendar?user_id='+uid+'&date_from='+dateStr+'&date_to='+dateStr).then(function(wlData) {
      render(wlData);
      _loadCheckinDetail(dateStr);
    });
  }

  // Register event listeners for real-time refresh
  function onWlChanged(e) {
    // Check if this event affects the current date
    fetchAndRender();
  }
  EventBus.off('worklog:saved', onWlChanged);
  EventBus.off('worklog:deleted', onWlChanged);
  EventBus.on('worklog:saved', onWlChanged);
  EventBus.on('worklog:deleted', onWlChanged);

  // Cleanup listeners when dialog is closed
  var cleanup = function() {
    EventBus.off('worklog:saved', onWlChanged);
    EventBus.off('worklog:deleted', onWlChanged);
  };
  var existingClose = document.querySelector('.note-dialog-overlay');
  // Use MutationObserver or simply re-register on each open
  setTimeout(function() {
    var closeBtn = document.querySelector('.note-dialog-close');
    if (closeBtn && !closeBtn._wlCleanup) {
      closeBtn._wlCleanup = true;
      closeBtn.addEventListener('click', cleanup);
    }
    // Also cleanup on cancel button
    var btns = document.querySelectorAll('.note-dialog-foot .btn-sm');
    btns.forEach(function(b) {
      if (b.textContent === '关闭' && !b._wlCleanup) {
        b._wlCleanup = true;
        b.addEventListener('click', cleanup);
      }
    });
  }, 100);

  // Initial load
  fetchAndRender();
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

function _findDayTask(id) { return _dayDetailTasks.find(function(t){return t.id===id;}); }

/* ── Progress Slider (shared) ── */
function _renderProgressSlider(idPrefix, currentPct, label) {
  var pcts = [0, 25, 50, 75, 100];
  var ticks = pcts.map(function(p) {
    return '<span style="position:absolute;left:' + p + '%;transform:translateX(-50%);font-size:9px;color:var(--muted);cursor:pointer" onclick="var s=document.getElementById(\'' + idPrefix + '-slider\');s.value=' + p + ';s.oninput()">' + p + '%</span>';
  }).join('');
  var labelHtml = label ? '<div style="font-size:11px;color:var(--muted);margin-bottom:8px">' + escHtml(label) + '</div>' : '';
  return labelHtml +
    '<div style="position:relative;padding:0 6px;margin-bottom:18px">' +
      '<input type="range" id="' + idPrefix + '-slider" min="0" max="100" step="5" value="' + currentPct + '" style="width:100%;margin:0" oninput="document.getElementById(\'' + idPrefix + '-val\').textContent=this.value+\'%\'">' +
      '<div style="position:relative;width:100%;height:14px;margin-top:0">' + ticks + '</div>' +
    '</div>' +
    '<div style="text-align:center;margin-bottom:8px"><span id="' + idPrefix + '-val" style="font-weight:510;font-size:18px;color:var(--accent)">' + currentPct + '%</span></div>';
}

function editWorklogEntryById(wlId, dateStr) {
  var t = _findDayTask(wlId);
  if (!t) { showToast('数据已过期，请刷新', 'error'); return; }
  editWorklogEntry(t, dateStr);
}

function editWorklogEntry(t, dateStr) {
  _wlEditBugId = t.bug_id || null;
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
            document.getElementById('wl-edit-slider').value = tsk.progress || 0;
          }}) + '</div></div>' +
    '<input type="hidden" id="wl-edit-task-id" value="' + (t.task_id||'') + '">' +
    '<input type="hidden" id="wl-edit-reviewer-name" value="' + escHtml(t.reviewer_name || '') + '">' +
    '<input type="hidden" id="wl-edit-reviewer-id" value="' + (t.reviewer_id || '') + '">';
  var html = '<div>' + projectHtml + stageTaskHtml +
    '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">日期 *</label>' +
      '<input class="search-inp" id="wl-edit-date" type="date" required value="'+dateStr+'" style="width:100%;box-sizing:border-box;margin-top:2px"></div>' +
    '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">工时占比 (%) *</label>' +
      '<input type="range" id="wl-edit-pct" min="5" max="100" step="1" value="'+(t.percentage||25)+'" style="width:100%" oninput="_wlEditPctChanged()">' +
      '<div style="display:flex;justify-content:space-between;font-size:9px;color:var(--muted)"><span>5%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span></div>' +
      '<div style="text-align:center"><span id="wl-edit-pct-val" style="font-size:18px;font-weight:600;color:var(--accent)">'+(t.percentage||25)+'%</span></div>' +
      '<div style="font-size:10px;color:var(--muted);margin-top:2px">计算工时: ' + ((t.calculated_hours||t.hours||0)).toFixed(1) + 'h</div>' +
      '<div id="wl-edit-pct-hint" style="font-size:10px;color:var(--warn);margin-top:2px"></div></div>' +
    (isBug ? '' : '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">进度(%) *</label>' +
      _renderProgressSlider('wl-edit', t.progress||0) + '</div>') +
    '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">工作描述</label>' +
      '<textarea class="search-inp" id="wl-edit-desc" rows="2" style="width:100%;box-sizing:border-box;margin-top:2px;resize:vertical">'+escHtml(t.description||'')+'</textarea></div>' +
    '</div>';
  openDialog('编辑工时', html, [
    {text:'取消',onclick:'closeSharedDialog()'},
    {text:'保存',cls:'btn-primary',onclick:'saveWorklogEntry('+t.id+','+(isBug?'true':'false')+')'}
  ], {maxWidth: isBug ? 400 : 480});

  // 限制占比上限：当天其他记录百分比总和 + 当前值 ≤ 100
  window._wlEditOthersPct = 0;
  setTimeout(function() {
    var uid = window._ucViewUserId || (getCurrentUser() ? getCurrentUser().id : '');
    API.get('/worklogs/daily-usage?user_id=' + uid + '&date=' + dateStr).then(function(data) {
      var totalUsed = data.total_percentage_used || 0;
      var othersPct = totalUsed - (t.percentage || 0);
      window._wlEditOthersPct = Math.round(othersPct);
      var maxPct = Math.max(5, 100 - othersPct);
      var pctEl = document.getElementById('wl-edit-pct');
      if (pctEl) {
        pctEl.max = maxPct;
        if (parseInt(pctEl.value) > maxPct) pctEl.value = maxPct;
      }
      _wlEditPctChanged();
    }).catch(function(){});
  }, 100);
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

var _wlEditEntryPending = null;
var _wlEditBugId = null;

function _wlEditPctChanged() {
  var pctEl = document.getElementById('wl-edit-pct');
  var valEl = document.getElementById('wl-edit-pct-val');
  var hintEl = document.getElementById('wl-edit-pct-hint');
  if (!pctEl) return;
  var pct = parseInt(pctEl.value) || 0;
  if (valEl) valEl.textContent = pct + '%';
  if (hintEl) {
    var others = window._wlEditOthersPct || 0;
    var total = others + pct;
    if (total > 100) {
      hintEl.textContent = '当前 ' + pct + '% + 其他记录 ' + others + '% = ' + total + '%，超过 100%！';
      hintEl.style.color = 'var(--danger)';
    } else {
      hintEl.textContent = '当前 ' + pct + '% + 其他记录 ' + others + '% = ' + total + '%，剩余可用 ' + (100 - total) + '%';
      hintEl.style.color = 'var(--muted)';
    }
  }
}

async function saveWorklogEntry(wlId, isBug) {
  var pct = parseInt(document.getElementById('wl-edit-pct').value) || 0;
  var desc = document.getElementById('wl-edit-desc').value.trim();
  var date = document.getElementById('wl-edit-date').value;
  var taskIdEl = document.getElementById('wl-edit-task-id');
  var progressEl = document.getElementById('wl-edit-slider');
  var newTaskId = taskIdEl ? (parseInt(taskIdEl.value) || 0) : 0;
  var progress = progressEl ? (parseInt(progressEl.value) || 0) : 0;
  if (!date || !pct || pct < 5) { showToast('请填写日期和工时占比(≥5%)', 'error'); return; }

  // If progress >= 100 and not a bug, show confirmation before saving
  if (!isBug && progress >= 100) {
    _wlEditEntryPending = { wlId: wlId, isBug: isBug, newTaskId: newTaskId, percentage: pct, progress: progress, desc: desc, date: date };
    var approvalEnabled = window._approvalEnabled;
    var reviewerName = document.getElementById('wl-edit-reviewer-name');
    var rname = reviewerName ? reviewerName.value.trim() : '';
    if (approvalEnabled) {
      var reviewMsg = rname ? '，评审人: <b>' + escHtml(rname) + '</b>' : '，评审人: <b>待分配</b>';
      openDialog('确认保存工时',
        '<div style="font-size:13px;margin-bottom:8px">进度 <b>100%</b>，任务将进入<b>评审中</b>状态' + reviewMsg + '。</div>' +
        '<div style="font-size:11px;color:var(--muted)">确认后工时记录将保存，任务状态将自动更新。</div>',
        [
          {text: '取消', onclick: '_wlEditEntryCancel()'},
          {text: '确认', cls: 'btn-primary', onclick: '_wlEditEntryConfirm()'},
        ],
        {hideClose: true, overlayClass: 'wl-edit-entry-confirm-overlay', keepExisting: true}
      );
    } else {
      openDialog('确认保存工时',
        '<div style="font-size:13px;margin-bottom:8px">进度 <b>100%</b>，任务将自动切换为<b>已完成</b>状态。</div>' +
        '<div style="font-size:11px;color:var(--muted)">确认后工时记录将保存，任务状态将自动更新。</div>',
        [
          {text: '取消', onclick: '_wlEditEntryCancel()'},
          {text: '确认', cls: 'btn-primary', onclick: '_wlEditEntryConfirm()'},
        ],
        {hideClose: true, overlayClass: 'wl-edit-entry-confirm-overlay', keepExisting: true}
      );
    }
    return;
  }

  await _doSaveWorklogEntry(wlId, isBug, newTaskId, pct, progress, desc, date);
}

function _wlEditEntryCancel() {
  var d = document.querySelector('.wl-edit-entry-confirm-overlay'); if (d) d.remove();
  _wlEditEntryPending = null;
  // Edit dialog stays open with data preserved
}

async function _wlEditEntryConfirm() {
  var d = document.querySelector('.wl-edit-entry-confirm-overlay'); if (d) d.remove();
  if (!_wlEditEntryPending) return;
  var p = _wlEditEntryPending;
  _wlEditEntryPending = null;
  await _doSaveWorklogEntry(p.wlId, p.isBug, p.newTaskId, p.percentage, p.progress, p.desc, p.date);
}

async function _doSaveWorklogEntry(wlId, isBug, newTaskId, percentage, progress, desc, date) {
  var url = (isBug ? '/bugs/' + _wlEditBugId + '/worklogs/' : '/worklogs/') + wlId;
  try {
    var payload = {percentage: percentage, date: date, description: desc};
    if (newTaskId && !isBug) payload.task_id = newTaskId;
    await API.put(url, payload);
    if (newTaskId && !isBug) {
      var taskRes = await API.put('/tasks/' + newTaskId, {progress: progress});
      if (taskRes && taskRes.auto_messages && taskRes.auto_messages.length) {
        taskRes.auto_messages.forEach(function(msg) { showToast(msg, 'success'); });
      }
    }
    closeSharedDialog();
    showToast('工时已更新', 'success');
    EventBus.emit('worklog:saved', {taskId: newTaskId || null, bugId: isBug ? _wlEditBugId : null});
  } catch(e) { showToast('更新失败: '+(e.message||''), 'error'); }
}

async function deleteWorklogEntry(wlId, isBug, bugId) {
  if (!confirm('确定删除此工时记录？')) return;
  var realBugId = bugId || _wlEditBugId;
  var url = (isBug ? '/bugs/' + realBugId + '/worklogs/' : '/worklogs/') + wlId;
  try {
    await API.del(url);
    showToast('已删除', 'success');
    EventBus.emit('worklog:deleted', {taskId: null, bugId: isBug ? realBugId : null});
  } catch(e) { showToast('删除失败: '+(e.message||''), 'error'); }
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

/* ── Rich Content Rendering (HTML / Markdown) ── */
function renderMarkdown(md) {
  // Delegate to shared markdownToHtml (utils.js): handles HugeRTE HTML passthrough,
  // legacy markdown parsing, and the ` =WxH` image-size suffix (marked can't parse it).
  if (typeof markdownToHtml === 'function') return markdownToHtml(md);
  if (!md) return '';
  var s = String(md).trim();
  // Already HTML? Return as-is (HugeRTE stores HTML content)
  if (/^\s*</.test(s)) return s;
  // Legacy Markdown content — convert to HTML
  try {
    if (typeof marked !== 'undefined' && marked.parse) {
      return marked.parse(s);
    }
  } catch(e) {}
  return '<pre style="white-space:pre-wrap;font-size:13px">' + escHtml(md) + '</pre>';
}

/* ── Entity Action Timeline (Zentao-style change history) ── */

var _ENTITY_FIELD_LABELS = {
  title: '标题', description: '描述', status: '状态', priority: '优先级', type: '类型',
  execution_id: '迭代', stage_name: '阶段', assignee_id: '负责人', reviewer_id: '审批人',
  parent_id: '父任务', blocked_by_id: '阻塞任务', cc_user_ids: '抄送人',
  start_date: '开始日期', due_date: '截止日期', progress: '进度', estimate_hours: '预估工时',
  severity: '严重程度', project_id: '项目', component_id: '组件', resolution: '解决方案',
  gitlab_url: 'GitLab链接', gitlab_iid: 'GitLab编号', resolved_by_id: '解决人',
  product_id: '产品', template: '模板',
};

var _ACTION_LABELS = {
  created: '创建了', updated: '更新了', approved: '批准了', rejected: '驳回了', deleted: '删除了',
};

function _entityFieldLabel(field) {
  return _ENTITY_FIELD_LABELS[field] || field;
}

/** Check whether a string contains inline images (HugeRTE <img> or note-images URL). */
function _hasImages(s) {
  if (!s) return false;
  return /<img\b|\/api\/note-images\//.test(s);
}

var _timelineOrder = 'desc';  // 'desc' = 最新到最旧（默认），'asc' = 最旧到最新

function _timelineOrderLabel() {
  return _timelineOrder === 'desc' ? '最新优先' : '最早优先';
}

function _timelineOrderIcon() {
  return _timelineOrder === 'desc' ? '↓' : '↑';
}

function _timelineOrderBtn(entityType, entityId, containerId, refreshFn) {
  // refreshFn: 可选，切换排序后调用的刷新函数名（默认 renderTimeline，如分析记录传 _loadBugAnalyses）
  var fn = refreshFn || 'renderTimeline';
  return '<button class="btn btn-icon timeline-order-btn" onclick="_toggleTimelineOrder(\'' + entityType + '\', ' + entityId + ', \'' + containerId + '\', \'' + fn + '\')" title="' + _timelineOrderLabel() + '">' + _timelineOrderIcon() + '</button>';
}

function _toggleTimelineOrder(entityType, entityId, containerId, refreshFn) {
  _timelineOrder = _timelineOrder === 'desc' ? 'asc' : 'desc';
  // 更新所有排序按钮图标与提示
  document.querySelectorAll('.timeline-order-btn').forEach(function(btn) {
    btn.textContent = _timelineOrderIcon();
    btn.title = _timelineOrderLabel();
  });
  var fn = refreshFn || 'renderTimeline';
  if (fn === 'renderTimeline') {
    renderTimeline(entityType, entityId, containerId);
  } else {
    var f = window[fn];
    if (typeof f === 'function') f(entityId);
  }
}

/** Collapse/expand button for the whole history timeline (历史记录卡片头部). */
function _timelineCollapseBtn(containerId) {
  return '<button class="btn btn-icon timeline-collapse-btn" onclick="_toggleTimelineCollapse(this, \'' + containerId + '\')" title="收起历史记录">▾</button>';
}

function _toggleTimelineCollapse(btn, containerId) {
  if (!btn) return;
  // 优先在按钮所在卡片内查找容器，避免命中隐藏视图/旧弹窗中的同名容器
  var card = btn.closest ? btn.closest('.card') : null;
  var el = card ? card.querySelector('#' + containerId) : document.getElementById(containerId);
  if (!el) return;
  var collapsed = el.classList.toggle('timeline-collapsed');
  btn.textContent = collapsed ? '▸' : '▾';
  btn.title = collapsed ? '展开历史记录' : '收起历史记录';
}

/**
 * Render a merged action+comment timeline into a container.
 * Actions (field changes) are collapsed by default; comments show directly.
 * Default order: newest first (desc); toggleable via _toggleTimelineOrder.
 */
async function renderTimeline(entityType, entityId, containerId) {
  var el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '<div style="color:var(--muted);font-size:12px">加载中...</div>';
  try {
    var resp = await API.get('/actions?entity_type=' + entityType + '&entity_id=' + entityId);
    var timeline = (resp && resp.data) ? resp.data : (resp || []);
    // 标题显示数量（类似工时日志）
    var card = el.closest('.card');
    var titleEl = card ? card.querySelector('.section-title') : null;
    if (titleEl) titleEl.textContent = '历史记录 (' + timeline.length + ')';
    // 导航标签同步数量
    if (typeof updateDetailToc === 'function') updateDetailToc();
    if (!timeline || !timeline.length) {
      el.innerHTML = '<div style="color:var(--muted);font-size:12px">暂无记录</div>';
      return;
    }
    // 默认最新到最旧（后端返回升序，需倒序）；切换为 asc 时保持升序
    if (_timelineOrder === 'desc') {
      timeline = timeline.slice().reverse();
    }
    var html = '<div style="position:relative;padding-left:24px">' +
      '<div style="position:absolute;left:6px;top:8px;bottom:8px;width:2px;background:var(--border);border-radius:1px"></div>';
    timeline.forEach(function(item) {
      var author = item.display_name || item.username || '?';
      var time = (item.created_at ? fmtISODateTime(item.created_at) : '') || '';
      var isAction = item.type === 'action';
      var dotColor = isAction ? 'var(--accent)' : 'var(--success)';
      // 时间线节点圆点（与竖线对齐）
      var dot = '<span style="position:absolute;left:-24px;top:4px;width:14px;height:14px;border-radius:50%;background:var(--surface);border:2px solid ' + dotColor + ';box-sizing:border-box;z-index:1"></span>';
      var inner = isAction
        ? _renderTimelineAction(item, author, time)
        : _renderTimelineComment(item, author, time, entityType, entityId);
      html += '<div style="position:relative;padding:4px 0 12px 0">' + dot + inner + '</div>';
    });
    html += '</div>';
    el.innerHTML = html;
  } catch(e) {
    el.innerHTML = '<div style="color:var(--danger);font-size:12px">加载失败</div>';
  }
}

function _renderTimelineAction(item, author, time) {
  var actionLabel = _ACTION_LABELS[item.action] || item.action;
  var head = '<div style="display:flex;align-items:baseline;gap:6px;font-size:12px;flex-wrap:wrap">' +
    '<span style="font-weight:600;color:var(--fg)">' + escHtml(author) + '</span>' +
    '<span style="color:var(--muted)">' + escHtml(actionLabel) + '</span>' +
    '<span style="color:var(--muted);font-size:10px">' + escHtml(time) + '</span>' +
  '</div>';

  var changes = item.changes || [];
  var body = '';
  if (changes.length === 1) {
    // 单字段修改：直接渲染，避免外层"修改了X"摘要与内层字段标签重复折叠
    body = '<div style="margin-top:4px">' + _renderTimelineChange(changes[0]) + '</div>';
  } else if (changes.length > 1) {
    // 多字段修改：折叠在"修改了 X、Y"摘要下，展开再看各字段 old→new
    var fieldNames = changes.map(function(c) { return _entityFieldLabel(c.field); });
    var summaryText = '修改了 ' + fieldNames.join('、');
    body = '<details style="margin-top:4px">' +
      '<summary style="cursor:pointer;font-size:11px;color:var(--accent);user-select:none">' + escHtml(summaryText) + '</summary>' +
      '<div style="margin-top:4px;padding:6px 8px;background:var(--bg);border-radius:6px;border:1px solid var(--border)">' +
        changes.map(function(c) { return _renderTimelineChange(c); }).join('') +
      '</div>' +
    '</details>';
  } else if (item.comment) {
    body = '<div style="margin-top:4px;font-size:12px">' + renderMarkdown(item.comment) + '</div>';
  }

  return head + body;
}

function _renderTimelineChange(c) {
  var label = _entityFieldLabel(c.field);
  var oldVal = c.old_value || '';
  var newVal = c.new_value || '';
  // 长文本字段（description 等）/含图片 → 折叠为单个"修改了X"，展开直接看完整 diff
  var isLong = (c.field === 'description') || oldVal.length > 80 || newVal.length > 80 || _hasImages(oldVal) || _hasImages(newVal);
  if (isLong) {
    var detailHtml = '<div style="font-size:12px;margin-top:4px;line-height:1.6">' +
      '<div style="margin-bottom:6px"><div style="color:var(--muted);font-size:10px;margin-bottom:2px">修改前</div><div style="color:var(--danger)">' + (oldVal ? renderMarkdown(oldVal) : '<span style="color:var(--muted)">（空）</span>') + '</div></div>' +
      '<div><div style="color:var(--muted);font-size:10px;margin-bottom:2px">修改后</div><div style="color:var(--success)">' + (newVal ? renderMarkdown(newVal) : '<span style="color:var(--muted)">（空）</span>') + '</div></div>' +
    '</div>';
    return '<details style="margin:4px 0;font-size:12px">' +
      '<summary style="cursor:pointer;color:var(--accent);user-select:none;font-weight:500">修改了 ' + escHtml(label) + '</summary>' +
      detailHtml +
    '</details>';
  }
  return '<div style="margin:4px 0;font-size:12px">' +
    '<span style="color:var(--muted)">' + escHtml(label) + ':</span> ' +
    '<span style="color:var(--danger);text-decoration:line-through">' + escHtml(oldVal) + '</span>' +
    ' → ' +
    '<span style="color:var(--success)">' + escHtml(newVal) + '</span>' +
  '</div>';
}

function _renderTimelineComment(item, author, time, entityType, entityId) {
  var deleted = !!(item.is_deleted);
  // 仅作者本人可编辑/删除自己的评论（已删除的不能再操作）
  var me = getCurrentUser();
  var isMine = !!(me && me.id && item.user_id && me.id === item.user_id) && !deleted;
  if (isMine) {
    // 缓存内容供编辑对话框预填（onclick 内联字符串无法安全携带 HTML）
    window._commentEditCache = window._commentEditCache || {};
    window._commentEditCache[item.id] = item.content || '';
  }
  var actBtns = '';
  if (isMine) {
    actBtns = iconEdit('_openCommentEdit(\'' + entityType + '\',' + entityId + ',' + item.id + ')', '编辑评论') +
      iconDelete('_deleteComment(\'' + entityType + '\',' + entityId + ',' + item.id + ')', '删除评论');
  }
  var deletedTag = deleted ? '<span style="color:var(--muted);font-size:10px;border:1px solid var(--border);border-radius:4px;padding:0 5px">已删除</span>' : '';
  var head = '<div style="display:flex;align-items:baseline;gap:6px;font-size:12px;flex-wrap:wrap">' +
    '<span style="font-weight:600;color:var(--fg)">' + escHtml(author) + '</span>' +
    '<span style="color:var(--muted);font-size:10px">' + escHtml(time) + '</span>' +
    deletedTag + actBtns +
  '</div>';

  var content = item.content || '';
  var body = deleted
    ? '<div style="margin-top:4px;font-size:13px;line-height:1.5;color:var(--muted)"><span style="text-decoration:line-through">' + renderMarkdown(content) + '</span></div>'
    : '<div style="margin-top:4px;font-size:13px;line-height:1.5;color:var(--fg)">' + renderMarkdown(content) + '</div>';
  return head + body;
}

/** Soft-delete one's own comment (content stays, shown with strikethrough). */
async function _deleteComment(entityType, entityId, commentId) {
  if (!confirm('确认删除该评论？删除后内容将以删除线显示。')) return;
  try {
    if (entityType === 'task') {
      await API.del('/task-comments/' + commentId);
    } else {
      await API.del('/bugs/' + entityId + '/comments/' + commentId);
    }
    showToast('评论已删除', 'success');
    // 刷新所有可能承载该评论时间线的容器（详情页 + 任务编辑表单）
    var cids = entityType === 'task' ? ['task-detail-comments', 'tf-comments'] : ['bug-detail-comments'];
    cids.forEach(function(cid) {
      if (document.getElementById(cid)) renderTimeline(entityType, entityId, cid);
    });
  } catch(e) {
    showToast('删除失败: ' + (e.message || ''), 'error');
  }
}

/** Open a rich-text dialog to edit one's own comment. */
function _openCommentEdit(entityType, entityId, commentId) {
  var cached = (window._commentEditCache || {})[commentId] || '';
  var dialogId = 'comment-edit-' + Date.now();
  var taId = dialogId + '-ta';
  var html = '<div class="note-dialog-overlay" id="' + dialogId + '">' +
    '<div class="note-dialog" style="width:80vw;max-width:80vw;max-height:80vh;overflow-y:auto">' +
      '<div class="note-dialog-head">' +
        '<span class="note-dialog-title">编辑评论</span>' +
        '<button class="note-dialog-close" onclick="document.getElementById(\'' + dialogId + '\').remove()">&times;</button>' +
      '</div>' +
      '<textarea id="' + taId + '" rows="6" style="width:100%;box-sizing:border-box">' + escHtml(cached) + '</textarea>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">' +
        '<button class="btn" onclick="document.getElementById(\'' + dialogId + '\').remove()">取消</button>' +
        '<button class="btn btn-primary" onclick="_submitCommentEdit(\'' + entityType + '\',' + entityId + ',' + commentId + ',\'' + dialogId + '\')">保存</button>' +
      '</div>' +
    '</div>' +
  '</div>';
  document.body.insertAdjacentHTML('beforeend', html);
  setTimeout(function() { initRichEditor(taId, {height: 400}); }, 50);
}

/** Submit an edited comment (author-only, backend enforces ownership). */
async function _submitCommentEdit(entityType, entityId, commentId, dialogId) {
  var ta = document.getElementById(dialogId + '-ta');
  var content = ta ? ta.value : '';  // HugeRTE syncs HTML to the textarea
  if (!content.trim() || content === '<p></p>' || content === '<p><br></p>') {
    showToast('请输入评论内容', 'error');
    return;
  }
  try {
    if (entityType === 'task') {
      await API.put('/task-comments/' + commentId, {content: content});
    } else {
      await API.put('/bugs/' + entityId + '/comments/' + commentId, {content: content});
    }
    var overlay = document.getElementById(dialogId);
    if (overlay) overlay.remove();
    showToast('评论已更新', 'success');
    // 刷新所有可能承载该评论时间线的容器（详情页 + 任务编辑表单）
    var cids = entityType === 'task' ? ['task-detail-comments', 'tf-comments'] : ['bug-detail-comments'];
    cids.forEach(function(cid) {
      if (document.getElementById(cid)) renderTimeline(entityType, entityId, cid);
    });
  } catch(e) {
    showToast('更新失败: ' + (e.message || ''), 'error');
  }
}

/* ── Description Inline Edit (button-triggered, read-only display by default) ── */

function _editDescription(entityType, entityId) {
  var container = document.getElementById((entityType === 'task' ? 'task-desc-' : 'bug-desc-') + entityId);
  if (!container) return;
  var currentVal = container.getAttribute('data-desc') || '';
  var taId = 'desc-ta-' + entityType + '-' + entityId;
  container.innerHTML =
    '<textarea class="search-inp ef-input" id="' + taId + '" rows="4" style="width:100%;box-sizing:border-box;font-size:13px;margin-top:1px;resize:vertical">' + escHtml(currentVal) + '</textarea>' +
    '<div style="display:flex;gap:10px;margin-top:6px">' +
      '<button class="btn btn-primary" onclick="_saveDescription(\'' + entityType + '\',' + entityId + ')">保存</button>' +
      '<button class="btn" onclick="_cancelDescription(\'' + entityType + '\',' + entityId + ')">取消</button>' +
    '</div>';
  setTimeout(function() { initRichEditor(taId, {height: 300}); }, 100);
}

async function _saveDescription(entityType, entityId) {
  var ta = document.getElementById('desc-ta-' + entityType + '-' + entityId);
  var val = ta ? ta.value : '';
  var url = (entityType === 'task' ? '/tasks/' : '/bugs/') + entityId;
  try {
    await API.put(url, {description: val});
    showToast('已更新', 'success');
    _refreshDescriptionDetail(entityType, entityId);
  } catch(e) { showToast('更新失败: ' + (e.message || ''), 'error'); }
}

function _cancelDescription(entityType, entityId) {
  _refreshDescriptionDetail(entityType, entityId);
}

function _refreshDescriptionDetail(entityType, entityId) {
  if (entityType === 'task' && typeof _refreshTaskDetailContent === 'function') {
    _refreshTaskDetailContent(entityId);
  } else if (entityType === 'bug' && typeof _refreshBugDetailContent === 'function') {
    _refreshBugDetailContent(entityId);
  }
}

/* ── Detail Page Quick-Jump Sidebar (markdown-style TOC) ── */

/**
 * Build/refresh the fixed right-side quick-jump menu for task/bug detail pages.
 * Scans section cards (.card.info-glass-card with a .section-title) and creates
 * anchor links that smooth-scroll to each section. Hides when no detail page.
 */
function updateDetailToc() {
  var toc = document.getElementById('detail-toc');
  // 只取当前激活视图内的详情页（隐藏视图的旧内容仍在 DOM 中，不能作为跳转依据）
  var page = document.querySelector('.view.active .task-detail-page, .view.active .bug-detail-page');
  // 清理所有旧的跳转 id，避免与隐藏视图残留 id 冲突导致 getElementById 取错
  document.querySelectorAll('.task-detail-page [id^="dtoc-"], .bug-detail-page [id^="dtoc-"]').forEach(function(el) {
    el.removeAttribute('id');
  });
  if (!page) { if (toc) toc.style.display = 'none'; return; }
  if (!toc) {
    toc = document.createElement('div');
    toc.id = 'detail-toc';
    toc.innerHTML = '<div class="detail-toc-label">跳转</div><div class="detail-toc-links"></div>';
    document.body.appendChild(toc);
  }
  toc.style.display = '';
  var body = page.querySelector('.task-detail-body, .bug-detail-body') || page;
  var linksHtml = '';
  var idx = 0;
  // 遍历详情主体所有信息卡片（含左右分栏嵌套），每卡一个锚点
  Array.prototype.slice.call(body.querySelectorAll('.card.info-glass-card')).forEach(function(card) {
    var titleEl = card.querySelector('.section-title');
    if (!titleEl) return;
    var label = titleEl.textContent.trim();
    if (!label) return;
    var id = 'dtoc-' + (idx++);
    card.id = id;
    linksHtml += '<a class="detail-toc-link" data-toc="' + id + '" title="' + escHtml(label) + '" onclick="event.preventDefault();scrollToDetailSection(\'' + id + '\', this)">' + escHtml(label) + '</a>';
  });
  toc.querySelector('.detail-toc-links').innerHTML = linksHtml;
  updateDetailTocActive();
}

function scrollToDetailSection(id, link) {
  var el = document.getElementById(id);
  if (!el) return;
  // 立即高亮点击的导航项（不必等滚动事件）
  var toc = document.getElementById('detail-toc');
  if (toc) {
    toc.querySelectorAll('.detail-toc-link').forEach(function(a) { a.classList.toggle('active', a === link); });
  }
  // 目标区块闪烁反馈
  el.classList.remove('toc-flash');
  void el.offsetWidth; // 重置动画
  el.classList.add('toc-flash');
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function updateDetailTocActive() {
  var toc = document.getElementById('detail-toc');
  if (!toc || toc.style.display === 'none') return;
  var links = toc.querySelectorAll('.detail-toc-link');
  if (!links.length) return;
  var scrollY = window.scrollY + 80;
  var active = null;
  // 已滚到底部时高亮最后一项（末项可能无法滚动到顶部）
  var atBottom = (window.innerHeight + window.scrollY) >= (document.documentElement.scrollHeight - 2);
  if (atBottom) {
    active = links[links.length - 1];
  } else {
    links.forEach(function(a) {
      var el = document.getElementById(a.getAttribute('data-toc'));
      if (el && (el.getBoundingClientRect().top + window.scrollY) <= scrollY) active = a;
    });
  }
  links.forEach(function(a) { a.classList.toggle('active', a === active); });
}
document.addEventListener('scroll', function() {
  if (typeof updateDetailTocActive === 'function') updateDetailTocActive();
}, true);

/* ── Comment Dialog (rich-text) ── */

/** Open a rich-text comment dialog for a task/bug. */
function openCommentDialog(entityType, entityId) {
  var dialogId = 'comment-dialog-' + Date.now();
  var taId = dialogId + '-ta';
  var html = '<div class="note-dialog-overlay" id="' + dialogId + '">' +
    '<div class="note-dialog" style="width:80vw;max-width:80vw;max-height:80vh;overflow-y:auto">' +
      '<div class="note-dialog-head">' +
        '<span class="note-dialog-title">添加评论</span>' +
        '<button class="note-dialog-close" onclick="document.getElementById(\'' + dialogId + '\').remove()">&times;</button>' +
      '</div>' +
      '<textarea id="' + taId + '" rows="6" style="width:100%;box-sizing:border-box"></textarea>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">' +
        '<button class="btn" onclick="document.getElementById(\'' + dialogId + '\').remove()">取消</button>' +
        '<button class="btn btn-primary" onclick="_submitCommentDialog(\'' + entityType + '\', ' + entityId + ', \'' + dialogId + '\')">提交</button>' +
      '</div>' +
    '</div>' +
  '</div>';
  document.body.insertAdjacentHTML('beforeend', html);
  setTimeout(function() { initRichEditor(taId, {height: 400}); }, 50);
}

/** Submit a rich-text comment from the dialog. */
async function _submitCommentDialog(entityType, entityId, dialogId) {
  var taId = dialogId + '-ta';
  var content = '';
  var ta = document.getElementById(taId);
  if (ta) {
    content = ta.value;  // HugeRTE syncs content to the hidden textarea
  }
  if (!content || !content.trim() || content === '<p></p>' || content === '<p><br></p>') {
    showToast('请输入评论内容', 'error');
    return;
  }
  try {
    if (entityType === 'task') {
      await API.post('/task-comments', {task_id: entityId, content: content});
    } else {
      await API.post('/bugs/' + entityId + '/comments', {content: content});
    }
    document.getElementById(dialogId).remove();
    showToast('评论成功', 'success');
    // Refresh timeline
    var containerId = entityType === 'task' ? 'task-detail-comments' : 'bug-detail-comments';
    renderTimeline(entityType, entityId, containerId);
  } catch(e) {
    showToast('评论失败: ' + (e.message || ''), 'error');
  }
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

/* ── Image Paste Handler (DEPRECATED — replaced by HugeRTE) ── */
// eslint-disable-next-line no-unused-vars
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
    // Project + Stage + Task combo (shared across all rows)
    '<div style="margin-bottom:8px"><label style="font-size:15px;color:var(--muted)">项目</label>' +
      createProjectCombo({comboId: 'wl-proj', inputId: 'wl-proj-input', dropdownId: 'wl-proj-dd', placeholder: '搜索项目...',
        onSelect: function(p) {
          document.getElementById('wl-project-id').value = p.id;
          document.getElementById('wl-project-code').value = p.code || '';
          _wlLoadStages(p.code || '');
        }}) + '</div>' +
    '<input type="hidden" id="wl-project-id" value="">' +
    '<input type="hidden" id="wl-project-code" value="">' +
    '<div style="margin-bottom:10px;display:flex;gap:8px">' +
      '<div style="flex:1"><label style="font-size:15px;color:var(--muted);display:block;margin-bottom:3px">阶段</label>' +
        '<select class="search-inp" id="wl-stage" style="width:100%;box-sizing:border-box" onchange="_wlOnStageChange()"><option value="">全部阶段</option></select></div>' +
      '<div style="flex:2"><label style="font-size:15px;color:var(--muted);display:block;margin-bottom:3px">任务</label>' +
        createTaskCombo({comboId: 'wl-task', inputId: 'wl-task-input', dropdownId: 'wl-task-dd',
          projectIdFn: function() { return document.getElementById('wl-project-code').value; },
          stageFilterFn: function() { return document.getElementById('wl-stage').value; },
          onSelect: function(t) { document.getElementById('wl-task-id').value = t.id; }}) + '</div></div>' +
    '<input type="hidden" id="wl-task-id" value="">' +
    // Column header
    '<div style="display:flex;gap:10px;align-items:center;border:1px solid transparent;padding:0 10px;margin-bottom:4px;font-size:13px;color:var(--muted);font-weight:600;text-align:center">' +
      '<span style="width:155px;flex-shrink:0">日期</span>' +
      '<span style="flex:1;min-width:120px">工作内容</span>' +
      '<span style="width:60px;flex-shrink:0">工时</span>' +
      '<span style="width:80px;flex-shrink:0">占比</span>' +
      '<span style="width:80px;flex-shrink:0">可用剩余</span>' +
      '<span style="width:32px;flex-shrink:0"></span>' +
    '</div>' +
    // Batch rows: date + desc + hours + pct slider + remaining
    '<div id="wl-cal-rows">' + _wlCalBuildRow(0, dateStr) + '</div>' +
    '<div style="text-align:center;margin-top:8px">' +
      '<button class="btn btn-sm" onclick="_wlCalAddRow()">+ 添加一行</button>' +
    '</div>' +
    '<input type="hidden" id="wl-cal-row-count" value="1">' +
  '</div>';
  openDialog('记录工时 — ' + dateStr, html, [
    {text:'取消',onclick:'closeSharedDialog()'},
    {text:'提交',cls:'btn-primary',onclick:'_submitCalBatchWorklog()'}
  ], {maxWidth: '80vw'});
  setTimeout(function() { _wlCalOnDateChange(0); }, 100);
}

function _wlCalBuildRow(idx, defaultDate) {
  return '<div class="wl-cal-row" data-idx="' + idx + '" style="border:1px solid var(--border);border-radius:8px;padding:8px 10px;margin-bottom:6px">' +
    '<div style="display:flex;gap:10px;align-items:center">' +
      '<input class="search-inp" id="wl-cal-date-' + idx + '" type="date" value="' + defaultDate + '" style="width:155px;box-sizing:border-box;font-size:15px;flex-shrink:0" onchange="_wlCalOnDateChange(' + idx + ')">' +
      '<input class="search-inp" id="wl-cal-desc-' + idx + '" placeholder="工作内容" style="flex:1;min-width:120px;box-sizing:border-box;font-size:15px">' +
      '<div style="width:60px;flex-shrink:0;text-align:center;font-size:16px;font-weight:600;color:var(--fg)"><span id="wl-cal-hours-' + idx + '">2.0</span><span style="font-size:14px;color:var(--muted);font-weight:400">h</span></div>' +
      '<div id="wl-cal-pct-ring-' + idx + '" style="width:80px;flex-shrink:0;cursor:pointer;text-align:center" onclick="_wlCalShowPct(' + idx + ')" title="点击调整占比">' +
        _wlCalRing(25, 38, 'var(--accent)') +
      '</div>' +
      '<div id="wl-cal-pct-slider-' + idx + '" style="display:none;flex-shrink:0;align-items:center;gap:4px;width:130px">' +
        '<input type="range" id="wl-cal-pct-' + idx + '" min="5" max="100" step="1" value="25" style="flex:1" oninput="_wlCalPctInput(' + idx + ')" onblur="_wlCalHidePct(' + idx + ')">' +
        '<span id="wl-cal-pct-slider-val-' + idx + '" style="font-size:13px;font-weight:600;color:var(--accent);min-width:38px;text-align:right">25%</span>' +
      '</div>' +
      '<span id="wl-cal-avail-' + idx + '" style="width:80px;flex-shrink:0;font-size:14px;color:var(--success);text-align:center">可用 100%</span>' +
      '<span style="width:32px;flex-shrink:0;text-align:center">' + iconDelete('_wlCalRemoveRow(' + idx + ')', '删除此行') + '</span>' +
    '</div>' +
  '</div>';
}

function _wlCalRing(pct, size, color) {
  var r = (size - 4) / 2, circ = 2 * Math.PI * r, dash = circ * pct / 100;
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
    '<circle cx="' + (size/2) + '" cy="' + (size/2) + '" r="' + r + '" fill="none" stroke="var(--border)" stroke-width="3"/>' +
    '<circle cx="' + (size/2) + '" cy="' + (size/2) + '" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="3"' +
    ' stroke-dasharray="' + dash + ' ' + (circ - dash) + '" stroke-linecap="round" transform="rotate(-90 ' + (size/2) + ' ' + (size/2) + ')"/>' +
    '<text x="' + (size/2) + '" y="' + (size/2) + '" text-anchor="middle" dominant-baseline="central" font-size="' + (size*0.32) + '" font-weight="600" fill="var(--fg)">' + pct + '%</text></svg>';
}

var _wlCalCheckinH = {}, _wlCalSavedPct = {};

function _wlCalShowPct(idx) { document.getElementById('wl-cal-pct-ring-'+idx).style.display='none'; var s=document.getElementById('wl-cal-pct-slider-'+idx); s.style.display=''; var inp=s.querySelector('input'); if(inp)inp.focus(); }
function _wlCalHidePct(idx) { setTimeout(function(){ document.getElementById('wl-cal-pct-slider-'+idx).style.display='none'; document.getElementById('wl-cal-pct-ring-'+idx).style.display=''; },150); }

function _wlCalOnDateChange(idx) {
  var d = document.getElementById('wl-cal-date-' + idx).value; if (!d) return;
  var user = getCurrentUser(); var uid = user ? user.id : '';
  Promise.all([
    API.get('/worklogs/daily-usage?date=' + d),
    API.get('/wecom/calendar?user_id=' + uid + '&date_from=' + d + '&date_to=' + d)
  ]).then(function(results) {
    var usage = results[0] || {}, wecom = results[1] || {};
    var remaining = usage.remaining_percentage !== undefined ? usage.remaining_percentage : 100;
    var checkinH = (wecom.daily && wecom.daily[0]) ? wecom.daily[0].total_hours : 0;
    _wlCalSavedPct[d] = usage.total_percentage_used || 0; _wlCalCheckinH[d] = checkinH;
    var av = document.getElementById('wl-cal-avail-' + idx);
    if (av) { av.textContent = '可用 ' + remaining + '%'; av.style.color = remaining > 0 ? 'var(--success)' : 'var(--danger)'; }
    var pctEl = document.getElementById('wl-cal-pct-' + idx);
    if (remaining <= 0) {
      var ringEl = document.getElementById('wl-cal-pct-ring-' + idx);
      if (ringEl) ringEl.innerHTML = '<span style="font-size:15px;color:var(--muted)">-</span>';
      var hoursEl = document.getElementById('wl-cal-hours-' + idx);
      if (hoursEl) hoursEl.textContent = '-';
    } else if (pctEl) {
      pctEl.max = Math.max(5, remaining);
      if (parseInt(pctEl.value) > remaining) pctEl.value = Math.max(5, remaining);
      _wlCalUpdateRing(idx);
    }
  });
}

function _wlCalPctInput(idx) {
  var pct = parseInt(document.getElementById('wl-cal-pct-' + idx).value) || 25;
  var d = document.getElementById('wl-cal-date-' + idx).value;
  var checkinH = _wlCalCheckinH[d] || 8;
  document.getElementById('wl-cal-hours-' + idx).textContent = (pct / 100 * checkinH).toFixed(1);
  var valEl = document.getElementById('wl-cal-pct-slider-val-' + idx);
  if (valEl) valEl.textContent = pct + '%';
  _wlCalUpdateRing(idx);
}

function _wlCalUpdateRing(idx) {
  var pct = parseInt(document.getElementById('wl-cal-pct-' + idx).value) || 25;
  document.getElementById('wl-cal-pct-ring-' + idx).innerHTML = _wlCalRing(pct, 32, 'var(--accent)');
}

function _wlCalAddRow() {
  var cnt = parseInt(document.getElementById('wl-cal-row-count').value) || 1;
  var lastDate = document.getElementById('wl-cal-date-0') ? document.getElementById('wl-cal-date-0').value : fmtLocalDate();
  var rows = document.querySelectorAll('#wl-cal-rows .wl-cal-row');
  if (rows.length > 0) {
    var li = rows[rows.length - 1].getAttribute('data-idx');
    var ld = document.getElementById('wl-cal-date-' + li);
    if (ld && ld.value) { var dt = new Date(ld.value + 'T00:00:00'); dt.setDate(dt.getDate() - 1); lastDate = fmtLocalDate(dt); }
  }
  var row = _wlCalBuildRow(cnt, lastDate);
  document.getElementById('wl-cal-rows').insertAdjacentHTML('beforeend', row);
  document.getElementById('wl-cal-row-count').value = cnt + 1;
  setTimeout(function() { _wlCalOnDateChange(cnt); }, 50);
}

function _wlCalRemoveRow(idx) {
  var rowsEl = document.getElementById('wl-cal-rows');
  var rows = rowsEl.querySelectorAll('.wl-cal-row');
  if (rows.length <= 1) { showToast('至少保留1行', 'warn'); return; }
  var t = rowsEl.querySelector('.wl-cal-row[data-idx="' + idx + '"]');
  if (t) t.remove();
  document.getElementById('wl-cal-row-count').value = rows.length - 1;
}

async function _submitCalBatchWorklog() {
  var tid = parseInt(document.getElementById('wl-task-id').value) || 0;
  if (!tid) { showToast('请选择任务', 'error'); return; }
  var rows = document.querySelectorAll('#wl-cal-rows .wl-cal-row');
  var entries = [], hasErr = false;
  rows.forEach(function(r) {
    var i = r.getAttribute('data-idx');
    var de = document.getElementById('wl-cal-date-' + i), te = document.getElementById('wl-cal-desc-' + i),
        pe = document.getElementById('wl-cal-pct-' + i);
    var d = de ? de.value : '', t = te ? te.value.trim() : '', p = pe ? parseInt(pe.value) || 0 : 0;
    if (!d) { if (de) de.style.outline = '2px solid var(--danger)'; hasErr = true; } else { if (de) de.style.outline = ''; }
    if (!t) { if (te) te.style.outline = '2px solid var(--danger)'; hasErr = true; } else { if (te) te.style.outline = ''; }
    if (d && p >= 5 && t) entries.push({date: d, percentage: p, description: t});
  });
  if (hasErr) { showToast('请填写所有行的日期和描述', 'warn'); return; }
  if (!entries.length) { showToast('至少需要一行有效记录', 'warn'); return; }
  try {
    await API.post('/worklogs/batch', {task_id: tid, entries: entries});
    closeSharedDialog();
    showToast('已记录 ' + entries.length + ' 条工时', 'success');
    EventBus.emit('worklog:saved', {taskId: tid});
  } catch(e) { showToast('提交失败: ' + (e.message || ''), 'error'); }
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
    '<button onclick="batchDeleteTasks()" style="padding:4px 12px;border:1px solid #fff;border-radius:4px;background:transparent;color:#fff;cursor:pointer;font-size:12px">批量删除</button>' +
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

/* ── Clear ALL batch-selection state & floating toolbars (defensive) ──
   任务(_selectedTasks/batch-toolbar)与Bug(_selectedBugs/bug-batch-toolbar)共享
   全局集合与两个同位置的底部浮层；切换视图/Tab时清空集合并隐藏工具栏，避免某视图
   的批量状态残留或双工具栏重叠造成误操作。
   (注：批量删除误走Bug路径的真正根因是 _doBatchDelete 函数名冲突，见 _doTaskBatchDelete；
   本函数仅作额外防御，非修复所必需。) */
function _clearAllBatchState() {
  try { if (window._selectedTasks && window._selectedTasks.clear) window._selectedTasks.clear(); } catch(e) {}
  try { if (window._selectedBugs && window._selectedBugs.clear) window._selectedBugs.clear(); } catch(e) {}
  var bt = document.getElementById('batch-toolbar');
  if (bt) bt.style.display = 'none';
  var bbt = document.getElementById('bug-batch-toolbar');
  if (bbt) bbt.style.display = 'none';
}

/* ── Batch Delete ── */
function batchDeleteTasks() {
  if (_selectedTasks.size === 0) { showToast('请先选择任务', 'error'); return; }
  var count = _selectedTasks.size;
  openDialog('批量删除任务',
    '<div class="confirm-dlg">确认删除 <b>' + count + '</b> 个任务？<br><br>相关工时记录和评论也会被删除。<br><br><b style="color:var(--danger)">此操作不可撤销。</b></div>',
    [{text: '取消', onclick: 'closeSharedDialog()'},
     {text: '确认删除', cls: 'btn-danger', onclick: 'closeSharedDialog();_doTaskBatchDelete()'}],
    {hideClose: true});
}

/* 注意：勿命名为 _doBatchDelete —— bugs.js 的同名函数会在其加载后覆盖本函数，
   导致任务批量删除误调 Bug 删除逻辑（弹"批量删除 0 个Bug"并走 /bugs/batch）。 */
async function _doTaskBatchDelete() {
  var ok = await verifyPassword('批量删除 ' + _selectedTasks.size + ' 个任务', 'skip_task_delete');
  if (!ok) return;
  try {
    var r = await API.del('/tasks/batch', {task_ids: Array.from(_selectedTasks)});
    showToast('已删除 ' + r.deleted + '/' + r.total + ' 个任务', 'success');
    _clearBatchSelection();
    EventBus.emit('task:deleted', {});
  } catch(e) {
    showToast('批量删除失败: ' + (e.message || ''), 'error');
  }
}

/* ── Assignee Display (shared) ── */
// Renders assignee names with 团队(n) badge for multi-person tasks
function _renderAssigneeDisplay(names, taskId, opts) {
  opts = opts || {};
  if (!names || !names.length) return escHtml(opts.fallback || '—');
  if (names.length === 1) return escHtml(names[0]);
  // 2+ people: 团队(n) badge first, then first 2 names (+ ... if >2)
  var html = ' <span class="team-badge" onclick="event.stopPropagation();_showTeamMembers(event,\'' + escHtml(JSON.stringify(names)) + '\')" title="查看团队所有成员">团队(' + names.length + ')</span>';
  html += ' ' + escHtml(names[0]) + '、' + escHtml(names[1]);
  if (names.length > 2) html += '...';
  return html;
}

function _showTeamMembers(event, namesJson) {
  var names = JSON.parse(namesJson);
  var html = '<div style="font-size:13px;line-height:1.8">' +
    '<div style="font-weight:510;margin-bottom:8px">团队成员（' + names.length + '人）</div>' +
    names.map(function(n, i) { return '<div style="padding:4px 0;border-bottom:1px solid var(--border)">' + (i + 1) + '. ' + escHtml(n) + '</div>'; }).join('') +
    '</div>';
  var rect = event.target.getBoundingClientRect();
  var popover = document.createElement('div');
  popover.className = 'team-popover';
  popover.innerHTML = html;
  popover.style.cssText = 'position:fixed;z-index:10000;background:var(--surface);color:var(--fg);border:1px solid var(--border);border-radius:12px;padding:14px 18px;box-shadow:0 8px 32px rgba(0,0,0,0.15);backdrop-filter:blur(8px);min-width:180px;max-width:300px;max-height:360px;overflow-y:auto;animation:popoverIn 0.2s ease';
  popover.style.left = Math.min(rect.left, window.innerWidth - 320) + 'px';
  popover.style.top = Math.min(rect.bottom + 6, window.innerHeight - 380) + 'px';
  popover.onclick = function(e) { e.stopPropagation(); };
  document.body.appendChild(popover);
  setTimeout(function() {
    document.addEventListener('click', function handler(e) {
      if (!popover.contains(e.target)) { popover.remove(); document.removeEventListener('click', handler); }
    });
  }, 10);
}

/* ── Batch Edit Dialog ── */
function openBatchEditDialog() {
  if (_selectedTasks.size === 0) { showToast('请先选择任务', 'error'); return; }
  var inp = 'width:100%;box-sizing:border-box;margin-top:1px';
  window._mu_ba_assignee = [];
  var html = '<div style="max-height:500px;overflow-y:auto">' +
    '<div style="margin-bottom:4px;font-size:11px;color:var(--muted)">将对 <b>' + _selectedTasks.size + '</b> 个任务批量设置以下属性（留空=不修改）</div>' +
    '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">指派负责人</label>' +
      '<div id="ba-assignee-wrap"></div></div>' +
    '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">状态</label>' +
      '<select class="search-inp" id="ba-status" style="' + inp + '"><option value="">不修改</option>' +
        '<option value="todo">待办</option><option value="in_progress">进行中</option><option value="review">评审中</option><option value="done">已完成</option><option value="closed">已关闭</option></select></div>' +
    '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">优先级</label>' +
      '<select class="search-inp" id="ba-priority" style="' + inp + '"><option value="">不修改</option>' +
        '<option value="low">低</option><option value="medium">中</option><option value="high">高</option><option value="critical">紧急</option></select></div>' +
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
  ], {maxWidth:560});
  // Load multi-user selector for assignee
  loadAllUsers().then(function() {
    var wrap = document.getElementById('ba-assignee-wrap');
    if (wrap) {
      wrap.innerHTML = createMultiUserSelector({
        containerId: 'ba-assignee',
        selectedIds: [],
        placeholder: '选择负责人（留空=不修改）'
      });
    }
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
  var assigneeIds = window._mu_ba_assignee || [];
  if (assigneeIds.length) { updates.assignee_id = assigneeIds[0]; updates.assignee_ids = assigneeIds; }
  var status = document.getElementById('ba-status').value;
  var priority = document.getElementById('ba-priority').value;
  var stage = document.getElementById('ba-stage').value;
  var start = document.getElementById('ba-start').value;
  var due = document.getElementById('ba-due').value;
  if (status) updates.status = status;
  if (priority) updates.priority = priority;
  if (stage) updates.stage_name = stage;
  if (start) updates.start_date = start;
  if (due) updates.due_date = due;
  if (Object.keys(updates).length === 0) { showToast('请至少设置一个字段', 'error'); return; }
  try {
    var r = await API.put('/tasks/batch', {task_ids: Array.from(_selectedTasks), updates: updates});
    showToast('已更新 ' + r.updated + '/' + r.total + ' 个任务', 'success');
    closeSharedDialog();
    _clearBatchSelection();
    EventBus.emit('task:saved', {});
  } catch(e) { showToast('批量更新失败: ' + (e.message || ''), 'error'); }
}

function openAssignDialog(taskId) {
  API.get('/tasks/' + taskId).then(function(task) {
    var currentIds = task.assignee_ids || (task.assignee_id ? [task.assignee_id] : []);
    var currentDisplay = _renderAssigneeDisplay(task.assignee_names || [], task.id, {fallback: task.assignee_name || task.assignee_username || '未指派'});
    // Pre-populate the multi-selector with current assignees
    window._mu_as_assignee = currentIds.slice();
    var html = '<div>' +
      '<div style="margin-bottom:4px;font-size:11px;color:var(--muted)">当前负责人: <b>' + currentDisplay + '</b></div>' +
      '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">新负责人</label>' +
        '<div id="as-assignee-wrap"></div></div>' +
      '</div>';
    openDialog('指派任务 — ' + escHtml(task.title || ''), html, [
      {text:'取消',onclick:'closeSharedDialog()'},
      {text:'指派',cls:'btn-primary',onclick:'submitAssign(' + taskId + ')'}
    ], {maxWidth:520});
    loadAllUsers().then(function() {
      var wrap = document.getElementById('as-assignee-wrap');
      if (wrap) {
        wrap.innerHTML = createMultiUserSelector({
          containerId: 'as-assignee',
          selectedIds: currentIds,
          placeholder: '搜索并添加负责人...'
        });
        _muRenderTags('as-assignee');
      }
    });
  }).catch(function(e) { showToast('加载失败: ' + (e.message || ''), 'error'); });
}

async function submitAssign(taskId) {
  var ids = window._mu_as_assignee || [];
  if (!ids.length) { showToast('请选择负责人', 'error'); return; }
  try {
    await API.put('/tasks/' + taskId, {assignee_id: ids[0], assignee_ids: ids});
    closeSharedDialog();
    showToast('已指派', 'success');
    EventBus.emit('task:saved', {taskId: taskId});
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
    EventBus.emit('task:saved', {taskId: taskId});
  } catch(e) { showToast('更新失败: ' + (e.message || ''), 'error'); }
}

/* ═══════════════════════════════════════════════════
   SVG Donut Chart
═══════════════════════════════════════════════════ */

/**
 * Render an SVG donut (ring) chart into a container element.
 * @param {string|Element} container - DOM element or id
 * @param {Array} segments - [{label, value, color}] — value used for proportion
 * @param {Object} opts - {title, size, centerText}
 */
function renderDonutChart(container, segments, opts) {
  var el = typeof container === 'string' ? document.getElementById(container) : container;
  if (!el) return;

  opts = opts || {};
  var size = opts.size || 180;
  var strokeW = size * 0.18;
  var HOVER_SCALE = 1.3;  // 悬停放大倍数（与 mouseover 处理保持一致）
  // 预留放大外扩余量，避免悬停放大后扇区被 SVG 边缘裁切
  var radius = (size - strokeW * HOVER_SCALE) / 2 - 1;
  var center = size / 2;
  var circumference = 2 * Math.PI * radius;
  var total = 0;
  segments.forEach(function(s) { total += s.value || 0; });
  if (total === 0) total = 1; // avoid division by zero

  var titleHtml = opts.title ? '<div style="font-size:12px;font-weight:600;color:var(--muted);text-align:center;margin-bottom:8px">' + escHtml(opts.title) + '</div>' : '';

  // 斜纹填充图案：用于「未记录」等需以灰色线条绘制、而非纯色填充的段
  var hatchId = 'donut-hatch-' + Math.random().toString(36).slice(2, 8);
  var defsHtml = '<defs><pattern id="' + hatchId + '" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
    '<line x1="0" y1="0" x2="0" y2="4" stroke="var(--muted)" stroke-width="2"/></pattern></defs>';

  // Build SVG ring segments
  var svgCircles = '';
  var offset = 0;
  var colors = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316', '#6366F1', '#84CC16'];
  segments.forEach(function(s, i) {
    var pct = s.value / total;
    var dashLen = Math.max(pct * circumference, 0.5); // min visible sliver
    var dashGap = circumference - dashLen;
    var color = s.hatch ? 'url(#' + hatchId + ')' : (s.color || colors[i % colors.length]);
    var dashOffset = (-offset * circumference / total);
    svgCircles += '<circle cx="' + center + '" cy="' + center + '" r="' + radius + '" ' +
      'fill="none" stroke="' + color + '" stroke-width="' + strokeW + '" ' +
      'stroke-dasharray="' + dashLen + ' ' + dashGap + '" ' +
      'stroke-dashoffset="' + dashOffset + '" ' +
      'data-seg-i="' + i + '" ' +
      'stroke-linecap="butt" style="cursor:pointer;transition: stroke-dasharray 0.5s, stroke-dashoffset 0.5s, stroke-width 0.15s"/>';
    offset += s.value;
  });

  // 无数据（如 PMA 记录工时为 0）时，用灰色底环占位
  if (segments.length === 0) {
    svgCircles = '<circle cx="' + center + '" cy="' + center + '" r="' + radius + '" ' +
      'fill="none" stroke="var(--muted)" stroke-width="' + strokeW + '" stroke-opacity="0.35"/>';
  }

  var centerText = opts.centerText || (total > 0 ? '' : '暂无数据');
  var centerHtml = centerText ? '<text x="' + center + '" y="' + center + '" text-anchor="middle" dominant-baseline="middle" font-size="' + (size * 0.13) + '" fill="var(--fg)">' + escHtml(centerText) + '</text>' : '';

  // Build legend
  var legendHtml = '<div style="display:flex;flex-wrap:wrap;gap:6px 14px;justify-content:center;margin-top:10px;font-size:11px">';
  segments.forEach(function(s, i) {
    var pct = total > 0 ? Math.round(s.value / total * 100) : 0;
    var swatchBg = s.hatch
      ? 'repeating-linear-gradient(45deg, var(--muted) 0 2px, transparent 2px 4px)'
      : (s.color || colors[i % colors.length]);
    legendHtml += '<span style="display:inline-flex;align-items:center;gap:4px;white-space:nowrap">' +
      '<span style="width:8px;height:8px;border-radius:2px;background:' + swatchBg + ';flex-shrink:0"></span>' +
      escHtml(s.label) + ' ' + pct + '%' +
      '</span>';
  });
  legendHtml += '</div>';

  el.innerHTML = titleHtml +
    '<div style="display:flex;justify-content:center">' +
    '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
    defsHtml + svgCircles + centerHtml +
    '</svg></div>' +
    legendHtml;

  // 扇区悬停（鼠标聚焦即显示，信息跟随鼠标位置；移出隐藏；聚焦扇区放大突出）
  var svg = el.querySelector('svg');
  if (svg) {
    var hovered = null;
    svg.addEventListener('mouseover', function(e) {
      var c = e.target && e.target.closest ? e.target.closest('circle[data-seg-i]') : null;
      if (hovered === c) return;
      if (hovered) hovered.setAttribute('stroke-width', strokeW);
      hovered = c;
      if (!c) return;
      var idx = parseInt(c.getAttribute('data-seg-i'), 10);
      if (isNaN(idx) || idx < 0 || idx >= segments.length) return;
      var seg = segments[idx];
      var pct = (seg.value || 0) / total * 100;
      var namePart = (seg.name && seg.name !== seg.label) ? ' ' + escHtml(seg.name) : '';
      c.setAttribute('stroke-width', (strokeW * HOVER_SCALE).toFixed(1));
      _showDonutClickTip(e, '<b>' + escHtml(seg.label || '') + '</b>' + namePart + '：' + (seg.value || 0).toFixed(1) + 'h (' + pct.toFixed(1) + '%)');
      if (opts.onSegmentClick) opts.onSegmentClick(seg, idx);
    });
    svg.addEventListener('mouseout', function(e) {
      var c = e.target && e.target.closest ? e.target.closest('circle[data-seg-i]') : null;
      if (c) {
        c.setAttribute('stroke-width', strokeW);
        if (hovered === c) hovered = null;
      }
      _hideDonutClickTip();
    });
  }
}

// 饼图扇区悬停提示：跟随鼠标显示；自动夹紧到视口内，超出边缘时翻转到光标另一侧
function _showDonutClickTip(e, html) {
  var tip = document.getElementById('donut-click-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'donut-click-tip';
    tip.style.cssText = 'position:fixed;pointer-events:none;z-index:9999;padding:6px 10px;background:var(--surface);border:1px solid var(--border);border-radius:6px;font-size:12px;line-height:1.5;box-shadow:var(--sh-md);white-space:normal;overflow-wrap:break-word;max-width:320px;';
    document.body.appendChild(tip);
  }
  tip.innerHTML = html;
  tip.style.display = 'block';
  var z = (typeof _getZoom === 'function') ? _getZoom() : 1;
  var rect = tip.getBoundingClientRect();
  var tipW = rect.width, tipH = rect.height;
  var margin = 8;
  // 在视口坐标下计算位置；右/下溢出则翻转到光标另一侧，再夹紧到视口内
  var vx = e.clientX + 14;
  var vy = e.clientY + 12;
  if (vx + tipW + margin > window.innerWidth) vx = e.clientX - tipW - 14;
  vx = Math.max(margin, Math.min(vx, window.innerWidth - tipW - margin));
  if (vy + tipH + margin > window.innerHeight) vy = e.clientY - tipH - 12;
  vy = Math.max(margin, Math.min(vy, window.innerHeight - tipH - margin));
  tip.style.left = (vx / z) + 'px';
  tip.style.top = (vy / z) + 'px';
}

function _hideDonutClickTip() {
  var tip = document.getElementById('donut-click-tip');
  if (tip) tip.style.display = 'none';
}

// 点击非扇区（圆环外）区域时，自动隐藏饼图点击提示
document.addEventListener('click', function(e) {
  var onCircle = e.target && e.target.closest && e.target.closest('circle[data-seg-i]');
  if (!onCircle) _hideDonutClickTip();
});
