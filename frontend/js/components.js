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

function getFavProducts() {
  try { return JSON.parse(localStorage.getItem('pma_fav_products') || '[]'); }
  catch(e) { return []; }
}
function isFavProduct(id) {
  return getFavProducts().indexOf(id) >= 0;
}
function toggleFavProduct(id) {
  var favs = getFavProducts();
  var idx = favs.indexOf(id);
  if (idx >= 0) { favs.splice(idx, 1); }
  else { favs.push(id); }
  localStorage.setItem('pma_fav_products', JSON.stringify(favs));
  return idx < 0; // true = added, false = removed
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

function renderProgressBar(percent, status) {
  var p = parseFloat(percent) || 0;
  var fc = status === 'blocked' ? 'red' : p >= 100 ? 'green' : 'blue';
  return '<div class="progress-bar"><div class="progress-fill ' + fc + '" style="width:' + p + '%"></div></div>' +
         '<div class="prog-label">' + p + '%</div>';
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
  var bg = bgColor || 'var(--accent-lt)';
  var fg = fgColor || 'var(--accent)';
  return '<span style="cursor:pointer;background:' + bg + ';color:' + fg +
    ';padding:2px 8px;border-radius:3px;font-size:11px;font-weight:500;white-space:nowrap"' +
    ' onclick="' + onclick + '" title="' + (title || '') + '">' + escHtml(name) + '</span>';
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

// Global click to close any open combo
document.addEventListener('click', function(e) {
  document.querySelectorAll('.proj-combo').forEach(function(c) {
    if (!c.contains(e.target)) c.classList.remove('open');
  });
});

