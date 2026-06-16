/* ═══════════════════════════════════════════════════
   PROJECT DETAIL VIEW
═══════════════════════════════════════════════════ */

/* Combo Box */

var _comboCurId = null;
var _comboOpen  = false;
var _comboProjects = [];
var _projectProducts = [];
var _userNames = [];     // PMA users for 交付责任人
var _customerNames = []; // customers for 收货方

async function loadComboProjects() {
  try {
    _comboProjects = await API.get('/projects');
  } catch(e) {
    _comboProjects = [];
  }
}

function renderComboOptions(q) {
  var v = (q || '').trim().toLowerCase();
  var list = v ? _comboProjects.filter(function(p) {
    return (p.code || '').toLowerCase().indexOf(v) >= 0 ||
           (p.name || '').toLowerCase().indexOf(v) >= 0 ||
           (p.customer_name || '').toLowerCase().indexOf(v) >= 0;
  }) : _comboProjects;

  if (!list.length) {
    return '<div class="combo-no-match">未找到匹配项目</div>';
  }

  return list.map(function(p) {
    var cls = p.id == _comboCurId ? 'combo-opt selected' : 'combo-opt';
    var typeTxt = TYPE_TXT[p.project_type] || p.project_type || '研发';
    var projCode = extractProjectCode(p.name);
    var coreName = extractCoreName(p.name);
    return '<div class="' + cls + '" onclick="selectComboProject(' + p.id + ')">' +
      renderProjIcon(p.project_type, projCode) +
      '<div style="min-width:0">' +
        '<div class="combo-opt-name">' + escHtml(coreName) + '</div>' +
        '<div class="combo-opt-meta">' + escHtml(projCode) + ' · ' + typeTxt + '项目' + (p.customer_name ? ' · ' + renderCustomerBadge(p.customer_name) : '') + '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

function openCombo() {
  _comboOpen = true;
  document.getElementById('proj-combo').classList.add('open');
  document.getElementById('combo-input').select();
  document.getElementById('combo-dropdown').innerHTML = renderComboOptions('');
}

function filterCombo(q) {
  if (!_comboOpen) openCombo();
  document.getElementById('combo-dropdown').innerHTML = renderComboOptions(q);
}

async function selectComboProject(id) {
  _comboCurId = id;
  var p = _comboProjects.find(function(p) { return p.id == id; });
  if (p) {
    var custName = p.customer_name || p.name;
    var codeLabel = p.code || '#' + p.id;
    document.getElementById('combo-input').value = custName + '  (' + codeLabel + ')';
  }
  closeCombo();
  await loadProjectDetail(id);
}

function closeCombo() {
  _comboOpen = false;
  document.getElementById('proj-combo').classList.remove('open');
}

document.addEventListener('click', function(e) {
  var combo = document.getElementById('proj-combo');
  if (combo && !combo.contains(e.target)) closeCombo();
});

/* Project Detail Loading */

async function loadProjectDetail(id) {
  if (!id) return;

  // Show loading state
  document.getElementById('detail-header').innerHTML = '<div class="loading-spinner">加载项目详情...</div>';
  document.getElementById('gantt-root').innerHTML = '<div class="loading-spinner">加载甘特图...</div>';
  document.getElementById('stages-tbody').innerHTML = '<tr><td colspan="8"><div class="loading-spinner">加载阶段数据...</div></td></tr>';
  document.getElementById('docs-tbody').innerHTML = '<tr><td colspan="4"><div class="loading-spinner">加载文档数据...</div></td></tr>';
  document.getElementById('delivery-content').innerHTML = '<div class="loading-spinner">加载交付数据...</div>';
  document.getElementById('resources-content').innerHTML = '<div class="loading-spinner">加载资料链接...</div>';
  document.getElementById('notes-content').innerHTML = '<div class="loading-spinner">加载笔记...</div>';

  try {
    // Fetch all data in parallel
    var results = await Promise.all([
      API.get('/projects/' + id),
      API.get('/projects/' + id + '/gantt'),
      API.get('/projects/' + id + '/stages'),
      API.get('/projects/' + id + '/documents'),
      API.get('/projects/' + id + '/delivery'),
      API.get('/projects/' + id + '/resources'),
      API.get('/projects/' + id + '/notes'),
      // Load user names + customer names for delivery form dropdown
      API.get('/users/names').catch(function() { return []; }),
      API.get('/users/customers/names').catch(function() { return []; }),
    ]);

    var detail = results[0];
    var ganttData = results[1];
    var stages = results[2];
    var docs = results[3];
    var delivery = results[4];
    var resources = results[5];
    var notes = results[6];
    var userNames = results[7] || [];
    var customerNames = results[8] || [];

    // Store linked products for delivery form dropdown
    _projectProducts = (detail && detail.products) ? detail.products : [];
    // Cache user/customer names for delivery form dropdown
    if (userNames.length) _userNames = userNames;
    if (customerNames.length) _customerNames = customerNames;

    buildDetailHeader(detail);
    buildGantt(ganttData);
    buildStages(stages);
    buildDocs(docs);
    buildDelivery(delivery);
    buildResources(resources, detail);
    buildNotes(notes);
    buildMaintenance();
  } catch(e) {
    document.getElementById('detail-header').innerHTML = '<div class="error-state">加载失败: ' + escHtml(e.message) + '</div>';
  }
}

/* Detail Header */

function buildDetailHeader(p) {
  if (!p) return;
  var progress = parseFloat(p.progress) || 0;
  var pctArc = (progress / 100) * 138.2;
  var gap = 138.2 - pctArc;
  var rc = p.status === 'blocked' ? 'var(--danger)' : progress > 75 ? 'var(--success)' : 'var(--accent)';

  var dateHtml = '';
  if (p.begin && p.end) {
    dateHtml = formatDate(p.begin) + ' → ' + formatDate(p.end);
  } else if (p.begin) {
    dateHtml = formatDate(p.begin) + ' 起（长期项目）';
  } else {
    dateHtml = '计划时间待定';
  }

  var projCode = extractProjectCode(p.name);
  var coreName = extractCoreName(p.name);
  document.getElementById('detail-header').innerHTML =
    '<div class="detail-meta">' +
      '<div class="detail-title">' +
        '<span class="proj-code-tag">' + escHtml(projCode) + '</span> ' +
        escHtml(coreName) +
        ((p.linked_products && p.linked_products.length)
          ? ' ' + p.linked_products.map(function(prod) {
              return '<span class="prod-link-chip" style="cursor:pointer;font-size:11px;padding:2px 8px;margin-right:3px;background:var(--accent-lt);color:var(--accent);border-radius:4px;vertical-align:middle" onclick="event.stopPropagation();openProductDetail(\'' + prod.id + '\')" title="' + escHtml(prod.code || '') + '">' + escHtml(prod.name) + '</span>';
            }).join('')
          : '') +
      '</div>' +
      '<div class="detail-sub">' +
        '<span class="meta-item">' +
          '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><polyline points="8,4.5 8,8 10.5,10"/></svg>' +
          dateHtml +
        '</span>' +
        '<span class="meta-item">' +
          '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="12" height="10" rx="1.5"/><line x1="5" y1="8" x2="11" y2="8"/><line x1="5" y1="11" x2="9" y2="11"/></svg>' +
          (p.customer_name ? '<span onclick="openCustomerByName(\'' + escHtml(p.customer_name) + '\')" style="cursor:pointer">' + renderCustomerBadge(p.customer_name) + '</span>' : '<span style="color:var(--muted);font-size:12px">—</span>') +
        '</span>' +
        renderTypeBadge(p.project_type) +
        renderPill(p.status) +
        (p.zentao_url ? '<a href="' + p.zentao_url + '" target="_blank" class="zentao-link" title="在禅道中查看">&#x2197; 禅道</a>' : '') +
      '</div>' +
    '</div>' +
    '<div class="ring-wrap">' +
      '<svg width="56" height="56" viewBox="0 0 56 56">' +
        '<circle cx="28" cy="28" r="22" fill="none" stroke="var(--border)" stroke-width="5"/>' +
        '<circle cx="28" cy="28" r="22" fill="none" stroke="' + rc + '" stroke-width="5"' +
                ' stroke-dasharray="' + pctArc + ' ' + gap + '" stroke-linecap="round" transform="rotate(-90 28 28)"/>' +
      '</svg>' +
      '<div><div class="ring-val">' + progress + '<span style="font-size:14px;font-weight:500">%</span></div><div class="ring-lbl">整体进度</div></div>' +
    '</div>';
}

/* Gantt Chart */

var _ganttPpd = 16;        // pixels-per-day; presets: 6/16/24, default 16
var _ganttPresets = [6, 16, 24];
var _ganttDragInit = false;

function ganttGranularity(ppd) {
  if (ppd <= 1.5) return 'month';
  if (ppd <= 6)   return 'week';
  return 'day';
}

// ── Drag-to-pan ──

var _ganttDragWrap = null;
var _ganttDragState = null;
var _ganttResizeState = null;

function ganttLeftW() {
  var v = getComputedStyle(document.documentElement).getPropertyValue('--gantt-left-w').trim();
  return v ? parseInt(v) : 280;
}
function setGanttLeftW(w) {
  document.documentElement.style.setProperty('--gantt-left-w', w + 'px');
}

function initGanttDrag() {
  var wrap = document.querySelector('.gantt-wrap');
  if (!wrap) return;

  wrap.addEventListener('mousedown', function(e) {
    if (e.button !== 0) return;
    if (e.target.closest('.gantt-resize-handle')) return; // handled globally
    if (e.target.closest('.gantt-bar') || e.target.closest('input') || e.target.closest('button')) return;

    _ganttDragWrap = wrap;
    _ganttDragState = { startX: e.pageX, scrollLeft: wrap.scrollLeft };
    wrap.classList.add('dragging');
    e.preventDefault();
  });
}

// Global handlers
document.addEventListener('mousedown', function(e) {
  if (e.button !== 0) return;
  var h = e.target.closest('.gantt-resize-handle');
  if (!h) return;
  _ganttResizeState = { startX: e.pageX, startW: ganttLeftW() };
  document.querySelectorAll('.gantt-resize-handle').forEach(function(el) { el.classList.add('active'); });
  e.preventDefault();
});

document.addEventListener('mousemove', function(e) {
  if (_ganttResizeState) {
    var newW = Math.max(160, _ganttResizeState.startW + (e.pageX - _ganttResizeState.startX));
    setGanttLeftW(newW);
    return;
  }
  if (!_ganttDragWrap) return;
  _ganttDragWrap.scrollLeft = _ganttDragState.scrollLeft - (e.pageX - _ganttDragState.startX);
});

document.addEventListener('mouseup', function() {
  if (_ganttResizeState) {
    document.querySelectorAll('.gantt-resize-handle').forEach(function(el) { el.classList.remove('active'); });
    _ganttResizeState = null;
    return;
  }
  if (_ganttDragWrap) {
    _ganttDragWrap.classList.remove('dragging');
    _ganttDragWrap = null;
    _ganttDragState = null;
  }
});

// ── Wheel zoom ──

var _ganttRefreshTimer = null;
var _ganttTodayPx = 0;

function initGanttWheel() {
  var wrap = document.querySelector('.gantt-wrap');
  if (!wrap) return;
  if (wrap._wheelInited) return;
  wrap._wheelInited = true;

  wrap.addEventListener('wheel', function(e) {
    if (!e.ctrlKey && !e.metaKey) return; // only zoom with Ctrl held
    e.preventDefault();
    var cur = snapToPreset(_ganttPpd);
    var idx = _ganttPresets.indexOf(cur);
    if (e.deltaY < 0 && idx < _ganttPresets.length - 1) {
      _ganttPpd = _ganttPresets[idx + 1];
    } else if (e.deltaY > 0 && idx > 0) {
      _ganttPpd = _ganttPresets[idx - 1];
    }
    // Debounce refresh: only rebuild after scrolling stops
    clearTimeout(_ganttRefreshTimer);
    _ganttRefreshTimer = setTimeout(function() {
      refreshGantt();
    }, 150);
  }, { passive: false });
}

function refreshGantt() {
  if (_comboCurId) {
    API.get('/projects/' + _comboCurId + '/gantt').then(function(data) {
      buildGantt(data);
    });
  }
}

function snapToPreset(ppd) {
  var best = _ganttPresets[0];
  var bestDist = Math.abs(ppd - best);
  for (var i = 1; i < _ganttPresets.length; i++) {
    var d = Math.abs(ppd - _ganttPresets[i]);
    if (d < bestDist) { bestDist = d; best = _ganttPresets[i]; }
  }
  return best;
}

function ganttZoomIn() {
  var cur = snapToPreset(_ganttPpd);
  var idx = _ganttPresets.indexOf(cur);
  if (idx < _ganttPresets.length - 1) _ganttPpd = _ganttPresets[idx + 1];
  refreshGantt();
}

function ganttZoomOut() {
  var cur = snapToPreset(_ganttPpd);
  var idx = _ganttPresets.indexOf(cur);
  if (idx > 0) _ganttPpd = _ganttPresets[idx - 1];
  refreshGantt();
}

function ganttScrollToToday() {
  var wrap = document.querySelector('.gantt-wrap');
  if (!wrap) return;
  wrap.scrollTo({ left: Math.max(0, _ganttTodayPx - 80), behavior: 'smooth' });
}

// ── Date range ──

function ganttRange(stages) {
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var minDate = new Date(today), maxDate = new Date(today);

  if (stages && stages.length) {
    stages.forEach(function(s) {
      if (s.start) { var sd = new Date(s.start); if (sd < minDate) minDate = sd; }
      if (s.end)   { var ed = new Date(s.end);   if (ed > maxDate) maxDate = ed; }
    });
  }
  // Start from earliest stage date, end 2 months after latest stage end
  maxDate.setDate(1);
  maxDate.setMonth(maxDate.getMonth() + 2);

  return { start: minDate, end: maxDate, span: maxDate - minDate };
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// ── Column generation ──

function generateColumns(range, ppd) {
  var cols = [];
  var topGroups = [];
  var midGroups = [];
  var cursor = new Date(range.start);
  var gran = ganttGranularity(ppd);

  if (gran === 'day') {
    // 3 tiers: 月 / 周 / 日
    cursor.setHours(0, 0, 0, 0);
    var curTop = null, curMid = null;
    while (cursor <= range.end) {
      var m = cursor.getMonth() + 1, d = cursor.getDate();
      var dow = cursor.getDay();
      var label = String(d);
      var mcIdx = m - 1;
      cols.push({
        label: label, isWeekend: dow === 0 || dow === 6,
        isToday: isSameDay(cursor, new Date()),
        isMonthStart: d === 1, w: ppd, monthColor: mcIdx
      });
      // Top: month
      var tKey = cursor.getFullYear() + '-' + m;
      if (!curTop || curTop.key !== tKey) {
        curTop = { key: tKey, label: m + '月', w: 0, colorIdx: mcIdx };
        topGroups.push(curTop);
      }
      curTop.w += ppd;
      // Mid: week-of-month (W1~W5)
      var wkOfMonth = Math.ceil(d / 7);
      var mKey = tKey + '-W' + wkOfMonth;
      if (!curMid || curMid.key !== mKey) {
        curMid = { key: mKey, label: 'W' + wkOfMonth, w: 0 };
        midGroups.push(curMid);
      }
      curMid.w += ppd;
      cursor.setDate(cursor.getDate() + 1);
    }
  } else if (gran === 'week') {
    // 3 tiers: 年 / 月 / 周
    cursor.setDate(cursor.getDate() - cursor.getDay() + 1);
    if (cursor.getDay() === 0) cursor.setDate(cursor.getDate() - 6);
    var curTop = null, curMid = null;
    while (cursor <= range.end) {
      var wm = cursor.getMonth() + 1, wd = cursor.getDate();
      var mcIdx = wm - 1;
      cols.push({
        label: wm + '/' + wd, isWeekend: false,
        isToday: false, isMonthStart: wd <= 7,
        w: ppd * 7, monthColor: mcIdx
      });
      // Top: year
      var tKey = String(cursor.getFullYear());
      if (!curTop || curTop.key !== tKey) {
        curTop = { key: tKey, label: cursor.getFullYear() + '年', w: 0 };
        topGroups.push(curTop);
      }
      curTop.w += ppd * 7;
      // Mid: month
      var mKey = cursor.getFullYear() + '-' + wm;
      if (!curMid || curMid.key !== mKey) {
        curMid = { key: mKey, label: wm + '月', w: 0, colorIdx: mcIdx };
        midGroups.push(curMid);
      }
      curMid.w += ppd * 7;
      cursor.setDate(cursor.getDate() + 7);
    }
  } else {
    // 2 tiers: 年 / 月 (no mid tier needed)
    cursor.setDate(1);
    var curTop = null;
    while (cursor <= range.end) {
      var y = cursor.getFullYear(), mo = cursor.getMonth() + 1;
      var today = new Date();
      var mcIdx = mo - 1;
      cols.push({
        label: mo === 1 ? y + '/' + mo : mo + '月',
        isWeekend: false, isMonthStart: true,
        isToday: today.getFullYear() === y && today.getMonth() + 1 === mo,
        w: ppd * new Date(y, mo, 0).getDate(), monthColor: mcIdx
      });
      // Top: year
      var tKey = String(y);
      if (!curTop || curTop.key !== tKey) {
        curTop = { key: tKey, label: y + '年', w: 0 };
        topGroups.push(curTop);
      }
      curTop.w += ppd * new Date(y, mo, 0).getDate();
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }
  return { cols: cols, topGroups: topGroups, midGroups: midGroups };
}

// ── Pixel position ──

function ganttPx(ds, range, totalWidth) {
  if (!ds) return 0;
  var t = new Date(ds) - range.start;
  return Math.max(0, Math.min(totalWidth, (t / range.span) * totalWidth));
}

// ── Progress ring ──

function renderProgressRing(pct) {
  pct = Math.round(Math.max(0, Math.min(100, pct || 0)));
  var size = 36, cx = 18, r = 13;
  var circ = 2 * Math.PI * r;
  var offset = circ * (1 - pct / 100);
  var color = pct >= 100 ? 'var(--success)' : pct > 0 ? 'var(--accent)' : 'var(--border)';
  return '<svg class="gs-ring" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
    '<circle cx="' + cx + '" cy="' + cx + '" r="' + r + '" fill="none" stroke="var(--border)" stroke-width="3"/>' +
    '<circle cx="' + cx + '" cy="' + cx + '" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="3" ' +
      'stroke-dasharray="' + circ.toFixed(1) + '" stroke-dashoffset="' + offset.toFixed(1) + '" ' +
      'stroke-linecap="round" transform="rotate(-90 ' + cx + ' ' + cx + ')"/>' +
    '<text x="' + cx + '" y="' + cx + '" text-anchor="middle" dy="0.35em" font-size="12" font-weight="600" fill="var(--muted)">' + pct + '</text>' +
    '</svg>';
}

// ── Main render ──

function buildGantt(data) {
  var stages = (data && data.stages) ? data.stages : (Array.isArray(data) ? data : []);
  var projBegin = data && data.project_begin ? data.project_begin : null;
  var projEnd   = data && data.project_end   ? data.project_end   : null;
  var range = ganttRange(stages);
  var ppd = _ganttPpd;
  var result = generateColumns(range, ppd);
  var cols = result.cols;
  var topGroups = result.topGroups;
  var midGroups = result.midGroups;
  var totalWidth = cols.reduce(function(s, c) { return s + c.w; }, 0);

  // Ensure content always overflows so drag-to-pan works at any zoom level
  var wrap = document.querySelector('.gantt-wrap');
  var minTotalWidth = (wrap ? wrap.clientWidth : 800) + 400;
  var displayWidth = Math.max(totalWidth, minTotalWidth);

  buildGanttToolbar();

  // Top-level group headers (年 / 月)
  var topHdrs = topGroups.map(function(g) {
    var mcCls = g.colorIdx !== undefined ? ' gantt-mc-' + g.colorIdx : '';
    return '<div class="gantt-group-hd gantt-top-hd' + mcCls + '" style="width:' + g.w + 'px">' + g.label + '</div>';
  }).join('');

  // Mid-level group headers (月 / 周), only when present
  var midHdrs = '';
  var midRowHtml = '';
  if (midGroups.length) {
    midHdrs = midGroups.map(function(g) {
      var mcCls = g.colorIdx !== undefined ? ' gantt-mc-' + g.colorIdx : '';
      return '<div class="gantt-group-hd gantt-mid-hd' + mcCls + '" style="width:' + g.w + 'px">' + g.label + '</div>';
    }).join('');
    midRowHtml = '<div class="gantt-head-row gantt-head-mid">' +
      '<div class="gantt-label-col"></div>' +
      '<div class="gantt-timeline-head" style="min-width:' + displayWidth + 'px;width:' + displayWidth + 'px">' + midHdrs + '</div>' +
    '</div>';
  }

  // Column headers
  var mHdrs = cols.map(function(c) {
    var cls = 'gantt-col-hd';
    if (c.isToday) cls += ' today-col';
    if (c.isWeekend) cls += ' weekend';
    if (c.isMonthStart && !c.isToday && ganttGranularity(ppd) === 'day') cls += ' q-end';
    if (c.monthColor !== undefined) cls += ' gantt-mc-' + c.monthColor;
    return '<div class="' + cls + '" style="width:' + c.w + 'px">' + c.label + '</div>';
  }).join('');

  // Grid columns
  var gCols = cols.map(function(c) {
    var cls = 'gantt-grid-col';
    if (c.isToday) cls += ' today-bg';
    if (c.monthColor !== undefined) cls += ' gantt-mc-' + c.monthColor;
    return '<div class="' + cls + '" style="width:' + c.w + 'px"></div>';
  }).join('');

  var today = new Date().toISOString().slice(0, 10);
  var todayPx = ganttPx(today, range, totalWidth);
  _ganttTodayPx = todayPx;

  if (!stages || !stages.length) {
    document.getElementById('gantt-root').innerHTML =
      '<div class="gantt-head-row gantt-head-top">' +
        '<div class="gantt-label-col"></div>' +
        '<div class="gantt-timeline-head" style="min-width:' + displayWidth + 'px;width:' + displayWidth + 'px">' + topHdrs + '</div>' +
      '</div>' +
      midRowHtml +
      '<div class="gantt-head-row">' +
        '<div class="gantt-label-col"><div class="gl-stage">阶段</div><div class="gl-risk">风险</div><div class="gl-prog">进度</div><div class="gl-who">负责人</div><div class="gantt-resize-handle"></div></div>' +
        '<div class="gantt-timeline-head" style="min-width:' + displayWidth + 'px;width:' + displayWidth + 'px">' + mHdrs + '</div>' +
      '</div>' +
      '<div class="gantt-row"><div class="gantt-stage-cell" style="width:100%;text-align:center;color:var(--muted);padding:20px">暂无阶段数据</div></div>';
    initGanttDrag();
    initGanttWheel();
    return;
  }

  // Project timeline — vertical start/end lines
  var projBeginPx = projBegin ? ganttPx(projBegin, range, totalWidth) : 0;
  var projEndPx = projEnd ? ganttPx(projEnd, range, totalWidth) : 0;
  var projLinesHtml = '';
  if (projBegin) {
    projLinesHtml += '<div class="gantt-proj-start-line" style="left:' + projBeginPx + 'px" title="项目开始: ' + projBegin + '"></div>';
  }
  if (projEnd) {
    projLinesHtml += '<div class="gantt-proj-end-line" style="left:' + projEndPx + 'px" title="项目结束: ' + projEnd + '"></div>';
  }

  var rows = stages.map(function(s, i) {
    var alt = i % 2 === 1 ? ' stage-alt' : '';
    var ms = s.match_status || 'matched';
    var mk = s.match_kind || '';
    var isMissing = ms === 'missing';
    var isUnmatched = ms === 'unmatched';
    var isFuzzy = mk === 'fuzzy';

    var lp = isMissing ? 0 : ganttPx(s.start, range, totalWidth);
    var ep = isMissing ? 0 : ganttPx(s.end, range, totalWidth);
    var wp = Math.max(4, ep - lp);
    var whoShort = (s.who || '').split('（')[0].split('、')[0] || '—';
    var isUnassigned = !s.who || s.who === '未指派';
    if (isUnassigned || isMissing) whoShort = isMissing ? '—' : '未指派';
    var prog = parseFloat(s.progress) || 0;
    var tasksDone = s.tasks_done || 0;
    var tasksTotal = s.tasks_total || 0;

    // Stage name
    var nameEl = isMissing
      ? '<span style="color:var(--muted);font-weight:500;font-size:12px">' + escHtml(s.name) + '</span>'
      : '<button class="gs-btn" title="跳转到阶段详情" onclick="gotoStageDetail(' + i + ');event.stopPropagation()">' + escHtml(s.name) + '</button>';

    // Risk tag
    var riskHtml = '';
    if (isMissing) {
      riskHtml = '<span class="risk-tag" style="--risk-color:var(--warn);font-size:10px">⚠ 阶段缺失</span>';
    } else if (isUnmatched || isFuzzy) {
      var suggested = isFuzzy ? (s.standard_stage || '') : '';
      riskHtml = '<span class="risk-tag" style="--risk-color:var(--warn);font-size:10px;cursor:pointer" ' +
        'onclick="showStageMismatchDialog(' + (s.id || 0) + ',\'' + escHtml(s.name || '') + '\',\'' + escHtml(suggested) + '\',event)" ' +
        'title="' + (isFuzzy ? '请修改为: ' + escHtml(s.standard_stage || '') : '请修改禅道阶段名为标准名字') + '">⚠ 请修改禅道阶段名</span>';
    } else {
      var risk = getStageRisk(s);
      riskHtml = '<span class="risk-tag" style="--risk-color:' + risk.color + '" title="' + escHtml(risk.tip) + '">' + escHtml(risk.label) + '</span>';
    }

    // Row style
    var rowStyle = '';
    if (isMissing) rowStyle = 'opacity:0.4;';
    else if (isUnmatched) rowStyle = 'background:var(--warn-lt);';

    // Bar — add red bottom border for overdue stages (all non-missing)
    var ganttOverdue = !isMissing && isStageOverdue(s);
    var noTasks = tasksTotal === 0 && !isMissing;
    var barCls = 'gantt-bar ' + s.status + (ganttOverdue ? ' gantt-overdue' : '') + (noTasks ? ' gantt-no-tasks' : '');
    var barHtml = '';
    if (isMissing) {
      barHtml = '';
    } else {
      barHtml = '<div class="' + barCls + '" style="left:' + lp + 'px;width:' + wp + 'px" data-tip="' + compactDate(s.start) + '→' + compactDate(s.end) + '　任务:' + tasksDone + '/' + tasksTotal + '">' +
        '<div class="gantt-bar-fill" style="width:' + prog + '%"></div>' +
      '</div>';
    }

    return '<div class="gantt-row' + alt + '" id="gantt-row-' + i + '" style="' + rowStyle + '">' +
      '<div class="gantt-stage-cell">' +
        nameEl +
        '<div class="gs-risk">' + riskHtml + '</div>' +
        '<div class="gs-prog">' + (isMissing ? '<span style="color:var(--muted);font-size:10px">—</span>' : renderProgressRing(prog)) + '</div>' +
        '<div class="gs-who' + (isUnassigned ? ' gs-who-una' : '') + '" title="' + escHtml(s.who || '') + '">' + escHtml(whoShort) + '</div>' +
      '</div>' +
      '<div class="gantt-bar-cell" style="min-width:' + displayWidth + 'px;width:' + displayWidth + 'px">' +
        '<div class="gantt-grid">' + gCols + '</div>' +
        projLinesHtml +
        '<div class="gantt-today-line" style="left:' + todayPx + 'px"></div>' +
        barHtml +
      '</div>' +
    '</div>';
  }).join('');

  document.getElementById('gantt-root').innerHTML =
    '<div class="gantt-head-row gantt-head-top">' +
      '<div class="gantt-label-col"></div>' +
      '<div class="gantt-timeline-head" style="min-width:' + displayWidth + 'px;width:' + displayWidth + 'px">' + topHdrs + '</div>' +
    '</div>' +
    midRowHtml +
    '<div class="gantt-head-row">' +
      '<div class="gantt-label-col"><div class="gl-stage">阶段</div><div class="gl-risk">风险</div><div class="gl-prog">进度</div><div class="gl-who">负责人</div><div class="gantt-resize-handle"></div></div>' +
      '<div class="gantt-timeline-head" style="min-width:' + displayWidth + 'px;width:' + displayWidth + 'px">' + mHdrs + '</div>' +
    '</div>' + rows;

  // Start scroll at first stage
  setTimeout(function() {
    var wrap = document.querySelector('.gantt-wrap');
    if (!wrap) return;
    var firstStartPx = 0;
    if (stages && stages.length) {
      firstStartPx = ganttPx(stages[0].start, range, totalWidth);
    }
    wrap.scrollLeft = Math.max(0, firstStartPx - 40);
  }, 50);

  initGanttDrag();
  initGanttWheel();
  initBarTooltip();
}

var _barTipEl = null;

function initBarTooltip() {
  var root = document.getElementById('gantt-root');
  if (!root) return;
  if (!_barTipEl) {
    _barTipEl = document.createElement('div');
    _barTipEl.style.cssText = 'display:none;position:fixed;background:#333;color:#fff;font-size:11px;padding:5px 10px;border-radius:5px;z-index:9999;pointer-events:none;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.3);font-family:var(--mono)';
    document.body.appendChild(_barTipEl);
  }
  root.addEventListener('mousemove', function(e) {
    var bar = e.target.closest('.gantt-bar');
    if (!bar || !bar.dataset.tip) { _barTipEl.style.display = 'none'; return; }
    _barTipEl.textContent = bar.dataset.tip;
    _barTipEl.style.display = 'block';
    _barTipEl.style.left = (e.clientX + 12) + 'px';
    _barTipEl.style.top = (e.clientY - 30) + 'px';
  });
  root.addEventListener('mouseleave', function() {
    _barTipEl.style.display = 'none';
  });
}

function buildGanttToolbar() {
  var container = document.getElementById('gantt-toolbar-container');
  if (container) {
    container.innerHTML = '<div class="gantt-toolbar">' +
      '<div style="font-size:10.5px;color:var(--muted)">Ctrl+滚轮缩放 · 拖拽平移</div>' +
      '<div class="gantt-toolbar-zoom">' +
        '<button class="gantt-zoom-btn" onclick="ganttZoomOut()" title="缩小">−</button>' +
        '<span class="gantt-zoom-val">×' + _ganttPpd.toFixed(0) + '</span>' +
        '<button class="gantt-zoom-btn" onclick="ganttZoomIn()" title="放大">+</button>' +
        '<button class="gantt-zoom-btn" onclick="ganttScrollToToday()" title="定位到今日" style="margin-left:8px;font-size:11px">●今</button>' +
      '</div>' +
    '</div>';
  }
}

/* Stages Table */

function isStageOverdue(s) {
  if (s.status === 'completed' || s.status === 'blocked') return false;
  if (!s.end) return false;
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var end = new Date(s.end);
  var prog = parseFloat(s.progress) || 0;
  return today > end && prog < 100;
}

function getStageRisk(s) {
  // Returns { level, label, color, tip }
  if (s.status === 'completed') return { level: 'none', label: '已完成', color: 'var(--success)', tip: '阶段已完成' };
  if (s.status === 'blocked') return { level: 'high', label: '阻塞', color: 'var(--danger)', tip: '阶段被挂起/阻塞' };

  var today = new Date(); today.setHours(0, 0, 0, 0);
  var start = s.start ? new Date(s.start) : null;
  var end = s.end ? new Date(s.end) : null;
  var prog = s.progress || 0;

  if (!start || !end) return { level: 'low', label: '无计划', color: 'var(--muted)', tip: '缺少计划日期' };

  var totalDays = Math.max(1, Math.round((end - start) / 86400000));
  var elapsedDays = Math.round((today - start) / 86400000);

  // Overdue
  if (today > end && prog < 100) {
    var overdueDays = Math.round((today - end) / 86400000);
    return { level: 'high', label: '超期' + overdueDays + '天', color: 'var(--danger)', tip: '应于 ' + formatDate(s.end) + ' 完成' };
  }
  // Not started yet
  if (today < start) return { level: 'none', label: '未开始', color: 'var(--muted)', tip: '计划 ' + formatDate(s.start) + ' 开始' };

  // On-track analysis
  var expectedProg = Math.min(100, Math.round((elapsedDays / totalDays) * 100));
  var gap = expectedProg - prog;

  if (gap <= 5) return { level: 'none', label: '正常', color: 'var(--success)', tip: '预期' + expectedProg + '% 实际' + prog + '%' };
  if (gap <= 20) return { level: 'low', label: '滞后', color: 'var(--warn)', tip: '预期' + expectedProg + '% 实际' + prog + '%' };
  if (gap <= 40) return { level: 'medium', label: '滞后', color: '#e67e22', tip: '预期' + expectedProg + '% 实际' + prog + '%' };
  return { level: 'high', label: '严重', color: 'var(--danger)', tip: '预期' + expectedProg + '% 实际' + prog + '%' };
}

function buildStages(stages) {
  // Support both old array format and new {stages, standard_stages} format
  var _standardStages = (stages && stages.standard_stages) ? stages.standard_stages : [];
  var stageList = (stages && stages.stages) ? stages.stages : stages;

  // Extract Zentao web base URL from first execution_url for dialog links
  if (!window._zentaoWebBase && stageList.length) {
    for (var si = 0; si < stageList.length; si++) {
      var u = stageList[si].execution_url;
      if (u) {
        var m = u.match(/^(.+)\/index\.php/);
        if (m) { window._zentaoWebBase = m[1]; break; }
      }
    }
  }

  if (!stageList || !stageList.length) {
    document.getElementById('stages-tbody').innerHTML = '<tr><td colspan="8"><div class="empty-state">暂无阶段数据</div></td></tr>';
    return;
  }

  document.getElementById('stages-tbody').innerHTML = stageList.map(function(s, i) {
    var dels = s.deliverables || [];
    var matchStatus = s.match_status || 'matched';
    var matchKind = s.match_kind || '';

    // --- Row styling ---
    var rowStyle = '';
    var isMissing = matchStatus === 'missing';
    var isUnmatched = matchStatus === 'unmatched';

    if (isMissing) {
      rowStyle = 'opacity:0.5;background:var(--warn-lt)';
    } else if (isUnmatched) {
      rowStyle = 'background:var(--warn-lt)';
    }

    // --- Name column (clean, warnings only in risk column) ---
    var nameHtml = '';
    if (isMissing) {
      nameHtml = '<span style="color:var(--muted);font-weight:500">' + escHtml(s.name) + '</span>';
    } else {
      nameHtml = s.execution_url
        ? '<a href="' + escHtml(s.execution_url) + '" target="_blank" class="gs-btn" onclick="event.stopPropagation()" style="text-decoration:none">' + escHtml(s.name) + '</a>'
        : '<strong>' + escHtml(s.name) + '</strong>';
    }

    // --- Risk column ---
    var riskHtml = '';
    if (isMissing) {
      riskHtml = '<span class="risk-tag" style="--risk-color:var(--warn)">⚠ 阶段缺失</span>';
    } else if (isUnmatched || matchKind === 'fuzzy') {
      var suggested = (matchKind === 'fuzzy') ? (s.standard_stage || '') : '';
      riskHtml = '<span class="risk-tag" style="--risk-color:var(--warn);cursor:pointer" ' +
        'onclick="showStageMismatchDialog(' + (s.id || 0) + ',\'' + escHtml(s.name || '') + '\',\'' + escHtml(suggested) + '\',event)" ' +
        'title="' + (suggested ? '请修改为: ' + escHtml(suggested) : '请修改禅道阶段名为标准名字') + '">⚠ 请修改禅道阶段名</span>';
    } else {
      var risk = getStageRisk(s);
      riskHtml = '<span class="risk-tag" style="--risk-color:' + risk.color + '" title="' + escHtml(risk.tip) + '">' + escHtml(risk.label) + '</span>';
    }

    // --- Progress, Who, Dates, Status, Blocker ---
    var prog = parseFloat(s.progress) || 0;
    var progHtml = isMissing ? '<span style="color:var(--muted)">—</span>' : renderProgressRing(prog);
    var whoHtml = isMissing ? '<span style="color:var(--muted)">—</span>' :
      '<span style="font-size:12px;white-space:nowrap;' + (!s.who || s.who === '未指派' ? 'color:var(--danger);font-weight:540' : '') + '">' + escHtml(s.who || '未指派') + '</span>';
    var dateHtml = isMissing ? '<span style="color:var(--muted)">—</span>' :
      '<span style="font-size:11.5px;color:var(--muted);white-space:nowrap;line-height:1.8">' + formatDate(s.start) + '<br>' + formatDate(s.end) + '</span>';
    var overdue = !isMissing && isStageOverdue(s);
    var statusHtml = isMissing ? '<span class="pill" style="background:var(--warn-lt);color:var(--warn)">阶段缺失</span>' :
      renderPill(s.status) +
      (overdue ? '<div style="font-size:10.5px;color:var(--danger);margin-top:4px;font-family:var(--mono);font-weight:600">⚠ 超期</div>' : '') +
      (s.completed_date ? '<div style="font-size:10.5px;color:var(--success);margin-top:4px;font-family:var(--mono)">&#10003; ' + s.completed_date + '</div>' : '');
    var blockerHtml = isMissing ? '<span style="color:var(--muted)">—</span>' :
      '<span style="font-size:12px;color:' + (s.blocker ? 'var(--danger)' : 'var(--muted)') + ';max-width:200px">' + escHtml(s.blocker || '—') + '</span>';
    var delsHtml = isMissing ? '<span style="font-size:11px;color:var(--muted);font-style:italic">暂无</span>' : renderDeliverablesList(dels);

    return '<tr style="' + rowStyle + '" id="stage-row-' + i + '">' +
      '<td>' + nameHtml + '</td>' +
      '<td>' + riskHtml + '</td>' +
      '<td>' + progHtml + '</td>' +
      '<td>' + whoHtml + '</td>' +
      '<td>' + dateHtml + '</td>' +
      '<td>' + statusHtml + '</td>' +
      '<td>' + blockerHtml + '</td>' +
      '<td>' + delsHtml + '</td>' +
    '</tr>';
  }).join('');
}

/* Documents Table */

function buildDocs(data) {
  var user = getCurrentUser();
  var canEdit = user && (user.role === 'admin' || user.role === 'pm' || user.role === 'test_delivery');

  // New format: { documents: [...], standard_stages: [...] }
  var stageList = (data && data.documents) ? data.documents : data;
  if (!stageList || !stageList.length) {
    document.getElementById('docs-tbody').innerHTML = '<tr><td colspan="5"><div style="text-align:center;padding:30px;font-style:italic;color:var(--muted)">暂无文档清单<br><span style="font-size:11px">项目阶段尚未匹配到文档模板，请先配置文档模板</span></div></td></tr>';
    return;
  }

  var stageIdx = 0;
  var rows = '';
  stageList.forEach(function(stage) {
    var stageName = stage.stage_name || '未分类';
    var items = stage.documents || [];
    var hasDocs = stage.has_documents;
    var bg = stageIdx % 2 === 0 ? 'var(--surface)' : 'var(--bg)';
    var completedDate = stage.stage_completed_date || null;

    // Stage name with gs-btn style + match status indicator (matching stages tab)
    var hasExec = stage.has_execution;
    var mk = stage.match_kind;
    var stageNameHtml;
    if (hasDocs && stage.execution_url) {
      stageNameHtml = '<a href="' + escHtml(stage.execution_url) + '" target="_blank" class="gs-btn" title="在禅道中查看此阶段" onclick="event.stopPropagation()" style="text-decoration:none;font-size:12px">' + escHtml(stageName) + '</a>';
    } else if (hasExec) {
      stageNameHtml = '<span style="font-weight:540;font-size:12px">' + escHtml(stageName) + '</span>';
    } else {
      stageNameHtml = '<span style="font-weight:500;color:var(--muted);font-size:12px">' + escHtml(stageName) + '</span>';
    }
    // Match status indicators (same as stages tab)
    if (!hasExec) {
      stageNameHtml += ' <span class="pill" style="background:var(--warn-lt);color:var(--warn);font-size:10px">阶段缺失</span>';
    } else if (mk === 'fuzzy') {
      stageNameHtml += ' <span class="pill" style="background:var(--info-lt,var(--accent-lt));color:var(--accent);font-size:10px">~模糊匹配</span>';
    }

    if (!hasDocs && !hasExec) {
      // Standard stage with no execution and no documents
      rows += '<tr style="background:' + bg + ';opacity:0.5">' +
        '<td style="vertical-align:middle;font-weight:540;border-right:1px solid var(--border)">' + stageNameHtml + '</td>' +
        '<td colspan="4" style="color:var(--muted);font-style:italic;font-size:12px">暂无文档（阶段未匹配到禅道数据或文档模板）</td>' +
      '</tr>';
    } else if (!hasDocs && hasExec) {
      // Has execution but no documents initialized yet
      rows += '<tr style="background:' + bg + ';opacity:0.5">' +
        '<td style="vertical-align:middle;font-weight:540;border-right:1px solid var(--border)">' + stageNameHtml + '</td>' +
        '<td colspan="4" style="color:var(--muted);font-style:italic;font-size:12px">暂无文档（文档尚未初始化，请先配置文档模板）</td>' +
      '</tr>';
    } else {
      items.forEach(function(d, i) {
        var rowCls = d.warn ? 'doc-row-warn' : (d.done ? 'doc-row-submitted' : '');
        var cls = d.done ? 'completed' : (d.warn ? 'blocked' : 'pending');
        var lbl = d.done ? '已提交' : (d.warn ? '⚠ 告警缺失' : '未开始');
        var statusCell = '<span class="pill ' + cls + '" style="font-size:11px;cursor:' + (canEdit ? 'pointer' : 'default') + '"' +
          (canEdit ? ' onclick="toggleDocEdit(' + d.id + ')" title="点击切换状态"' : '') + '>' + lbl + '</span>' +
          (d.completed_at ? '<div style="font-size:10.5px;color:var(--success);margin-top:3px;font-family:var(--mono)">' + d.completed_at + '</div>' : '');

        var locHtml = '';
        if (d.done && d.location) {
          locHtml = '<a class="doc-link" href="' + escHtml(d.location) + '" target="_blank">↗ ' + escHtml(d.location) + '</a>';
        } else if (d.done) {
          locHtml = '<span style="font-size:12px;color:var(--muted)">已提交</span>';
        } else if (d.warn) {
          locHtml = '<span style="font-size:11.5px;color:var(--warn);font-style:italic">缺失文档，请及时提交</span>';
        } else {
          locHtml = '<span style="font-size:11.5px;color:var(--muted);font-style:italic">待提交</span>';
        }

        // Deliverable icon (same as stages tab output件)
        var delIcon = renderDelIcon(d);

        rows += '<tr class="' + rowCls + '" style="background:' + bg + '" id="doc-row-' + d.id + '">' +
          (i === 0 ? '<td rowspan="' + items.length + '" style="vertical-align:middle;border-right:1px solid var(--border)">' + stageNameHtml + (completedDate ? '<br><span style="font-size:10.5px;color:var(--success);font-weight:400">&#10003; ' + completedDate + '</span>' : '') + '</td>' : '') +
          '<td><span style="display:flex;align-items:center;gap:6px" title="' + escHtml(d.description || '') + '">' + delIcon + escHtml(d.doc_name) + '</span></td>' +
          '<td style="font-size:12px;color:' + (d.responsible_role ? 'var(--fg)' : 'var(--muted)') + '">' + escHtml(d.responsible_role || '—') + '</td>' +
          '<td>' + statusCell + '</td><td id="doc-loc-cell-' + d.id + '">' + locHtml + '</td>' +
        '</tr>';
      });
    }
    stageIdx++;
  });
  document.getElementById('docs-tbody').innerHTML = rows;
}

/* ── Document Status Toggle (inline edit) ── */

var _editingDocId = null;

function toggleDocEdit(docId) {
  // If already editing, cancel
  if (_editingDocId === docId) {
    cancelDocEdit();
    return;
  }
  // Close any existing edit
  cancelDocEdit();

  // Find the row and insert an edit row after it
  var row = document.getElementById('doc-row-' + docId);
  if (!row) return;

  _editingDocId = docId;

  var editRow = document.createElement('tr');
  editRow.id = 'doc-edit-row-' + docId;
  editRow.className = 'doc-edit-row';
  // Determine colspan: if first row in stage group, stage cell occupies 1 col
  var hasStageCell = row.querySelector('td[rowspan]') !== null;
  var colspan = hasStageCell ? 4 : 5;
  editRow.innerHTML =
    '<td colspan="' + colspan + '" style="padding:8px 12px">' +
      '<div class="doc-edit-inline">' +
        '<input id="doc-edit-loc" placeholder="输入文档链接/路径" style="font-size:12px">' +
        '<button class="doc-status-btn done" onclick="saveDocStatus(' + docId + ',\'submitted\')">标记已提交</button>' +
        (hasStageCell ? '' : '') +
        '<button class="doc-status-btn" onclick="cancelDocEdit()">取消</button>' +
      '</div>' +
    '</td>';

  // Insert after the current row
  row.parentNode.insertBefore(editRow, row.nextSibling);
  document.getElementById('doc-edit-loc').focus();
}

function cancelDocEdit() {
  var editRow = document.getElementById('doc-edit-row-' + _editingDocId);
  if (editRow) editRow.remove();
  _editingDocId = null;
}

async function saveDocStatus(docId, status) {
  var loc = document.getElementById('doc-edit-loc').value.trim();
  var body = { status: status };
  if (loc) body.location = loc;
  try {
    await API.put('/projects/' + _comboCurId + '/documents/' + docId, body);
    showToast(status === 'submitted' ? '已标记为提交' : '状态已更新', 'success');
    cancelDocEdit();
    // Refresh documents tab
    var docs = await API.get('/projects/' + _comboCurId + '/documents');
    buildDocs(docs);
  } catch(e) {
    showToast('操作失败: ' + (e.message || '未知错误'), 'error');
  }
}

/* Delivery */

var _deliveryData = null;

function buildDelivery(data) {
  _deliveryData = data;
  var planned = data.planned || 0;
  var delivered = data.total || 0;  // total = delivered qty sum from records
  var remaining = data.remaining || 0;
  var progress = data.progress || 0;
  var note = data.delivery_note || '';
  var records = data.records || [];
  var hasPlan = planned > 0;
  var user = getCurrentUser();
  var canEdit = user && (user.role === 'admin' || user.role === 'pm' || user.role === 'test_delivery');

  var kpiHtml =
    '<div class="delivery-kpi">' +
      '<div class="dkpi"><div class="dkpi-lbl">应交付总数</div><div class="dkpi-val">' + (hasPlan ? planned : '—') + '</div></div>' +
      '<div class="dkpi"><div class="dkpi-lbl">已交付数量</div><div class="dkpi-val" style="color:var(--success)">' + delivered + '</div></div>' +
      '<div class="dkpi"><div class="dkpi-lbl">剩余未交付</div><div class="dkpi-val" style="color:' + (remaining > 0 ? 'var(--warn)' : 'var(--muted)') + '">' + remaining + '</div></div>' +
    '</div>' +
    (hasPlan
      ? '<div class="progress-bar" style="height:8px;margin-bottom:6px"><div class="progress-fill ' + (progress >= 100 ? 'green' : 'blue') + '" style="width:' + Math.min(100, progress) + '%"></div></div>' +
        '<div style="font-size:12px;color:var(--muted)">交付进度 ' + progress + '%（' + delivered + ' / ' + planned + '）</div>'
      : '<div style="font-size:11px;color:var(--muted);font-style:italic">提示：尚未设置应交付总数，请通过下方设置</div>') +
    (note ? '<div style="margin-top:8px;padding:8px 12px;background:var(--warn-lt);border:1px solid var(--warn);border-radius:7px;font-size:12px;color:var(--warn)">备注：' + escHtml(note) + '</div>' : '') +
    (delivered === 0 ? '<div style="margin-top:14px;padding:12px 14px;background:var(--warn-lt);border:1px solid var(--warn);border-radius:8px;font-size:13px;color:var(--warn)">暂无交付记录</div>' : '');

  // Delivery plan settings (collapsible, for PM/admin/test_delivery)
  var planFormHtml = '';
  if (canEdit) {
    planFormHtml =
      '<div class="card" style="padding:16px;margin-top:12px">' +
        '<div class="section-title" style="margin-bottom:10px;cursor:pointer" onclick="toggleDeliveryPlanForm()">' +
          '交付计划设置 <span style="font-size:10px;color:var(--muted)">（点击展开/收起）</span>' +
        '</div>' +
        '<div id="delivery-plan-form" style="display:none">' +
          '<div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap">' +
            '<div><label style="font-size:11px;color:var(--muted)">应交付总数</label><input class="search-inp" id="del-plan-qty" type="number" min="0" value="' + planned + '" style="width:120px;margin-top:4px"></div>' +
            '<div style="flex:1;min-width:200px"><label style="font-size:11px;color:var(--muted)">备注/延迟原因</label><input class="search-inp" id="del-plan-note" value="' + escHtml(note) + '" style="margin-top:4px"></div>' +
            '<button class="btn btn-primary" onclick="saveDeliveryPlan()" style="height:34px;font-size:12px;white-space:nowrap">保存计划</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  var recHtml = '' +
    '<div class="card col-span" style="padding:20px;margin-top:16px">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">' +
        '<div class="section-title">交付记录明细 (' + records.length + ' 条)</div>' +
        '<button class="btn" style="font-size:11px;padding:4px 10px" onclick="showDeliveryForm()">+ 添加记录</button>' +
      '</div>' +
      (records.length ? '<div class="table-scroll"><table class="stage-table"><thead><tr><th>交付日期</th><th>产品名</th><th>数量</th><th>产品编号</th><th>责任人</th><th>收货方</th><th>备注</th><th style="width:50px"></th></tr></thead><tbody>' +
      records.map(function(r) {
        return '<tr>' +
          '<td style="font-family:var(--mono);font-size:12px;color:var(--success);font-weight:540;white-space:nowrap">' + formatDate(r.date) + '</td>' +
          '<td style="font-size:12.5px;font-weight:500">' + escHtml(r.product_name || '') + '</td>' +
          '<td style="font-variant-numeric:tabular-nums;font-weight:600">' + r.qty + ' 台</td>' +
          '<td style="font-family:var(--mono);font-size:11.5px">' + escHtml(r.items || '') + '</td>' +
          '<td style="font-size:12px">' + escHtml(r.responsible_person || '—') + '</td>' +
          '<td style="font-size:12.5px">' + escHtml(r.receiver || '—') + '</td>' +
          '<td style="font-size:12px;color:var(--muted)">' + escHtml(r.note || '') + '</td>' +
          '<td><button class="btn" style="font-size:10px;padding:2px 8px;color:var(--danger)" onclick="deleteDeliveryRecord(' + r.id + ')">删除</button></td>' +
        '</tr>';
      }).join('') +
      '</tbody></table></div>' : '<div class="empty-state" style="padding:20px">暂无交付记录，点击上方按钮添加</div>') +
    '</div>';

  document.getElementById('delivery-content').innerHTML =
    '<div class="two-col">' +
      '<div class="card" style="padding:20px">' +
        '<div class="section-title" style="margin-bottom:14px">交付概要</div>' +
        kpiHtml +
      '</div>' +
      recHtml +
    '</div>' +
    planFormHtml +
    '<div id="delivery-form-container"></div>';
}

function toggleDeliveryPlanForm() {
  var el = document.getElementById('delivery-plan-form');
  if (el) el.style.display = el.style.display === 'none' ? '' : 'none';
}

async function saveDeliveryPlan() {
  var qty = parseInt(document.getElementById('del-plan-qty').value) || 0;
  var note = document.getElementById('del-plan-note').value.trim();
  try {
    await API.put('/projects/' + _comboCurId + '/delivery-plan', {
      planned_delivery_qty: qty,
      delivery_note: note
    });
    showToast('交付计划已保存', 'success');
    // Refresh delivery data
    var data = await API.get('/projects/' + _comboCurId + '/delivery');
    buildDelivery(data);
  } catch(e) {
    showToast('保存失败: ' + (e.message || '未知错误'), 'error');
  }
}

function showDeliveryForm(record) {
  var r = record || {};
  var isEdit = !!record;
  // Build product dropdown from linked products
  var products = (typeof _projectProducts !== 'undefined' && _projectProducts) ? _projectProducts : [];
  var prodOptions = products.map(function(p) {
    var sel = (r.product_name === p.name) ? ' selected' : '';
    return '<option value="' + escHtml(p.name) + '"' + sel + '>' + escHtml(p.name) + '</option>';
  }).join('');
  if (!prodOptions) prodOptions = '<option value="">— 无关联产品 —</option>';
  if (r.product_name && products.length === 0) {
    prodOptions = '<option value="' + escHtml(r.product_name) + '" selected>' + escHtml(r.product_name) + '</option>';
  }

  // Build user/customer dropdown
  function _selectHtml(id, options, selected) {
    return '<select class="search-inp" id="' + id + '" style="margin-top:4px;padding:8px 10px">' +
      '<option value="">— 请选择 —</option>' +
      options.map(function(u) {
        return '<option value="' + u + '"' + (u === selected ? ' selected' : '') + '>' + u + '</option>';
      }).join('') +
    '</select>';
  }

  var noProducts = products.length === 0;
  var prodLabel = noProducts ? '产品名称 <span style="color:var(--warn);font-size:10px">请在项目中关联产品</span>' : '产品名称';

  // Build serial number rows (default 2, or from existing records)
  var serials = (r.serial_numbers && r.serial_numbers.length) ? r.serial_numbers : (r.items ? r.items.split(/[,，]/).map(function(s){return s.trim();}).filter(Boolean) : []);
  if (!serials.length) serials = ['', ''];  // default 2 empty
  var serialRows = serials.map(function(s, idx) {
    return '<div class="df-serial-row" style="display:flex;gap:6px;margin-bottom:6px;align-items:center">' +
      '<span class="df-serial-seq" style="width:28px;text-align:center;font-family:var(--mono);font-size:12px;color:var(--muted);flex-shrink:0">' + (idx + 1) + '</span>' +
      '<input class="search-inp df-serial-inp" value="' + escHtml(s) + '" placeholder="产品编号 ' + (idx + 1) + '" style="flex:1;margin-top:0" oninput="updateSerialCount()">' +
      (serials.length > 2 ? '<button class="btn" onclick="removeSerialRow(this)" style="font-size:14px;padding:2px 8px;color:var(--danger);flex-shrink:0">&times;</button>' : '') +
    '</div>';
  }).join('');

  var qtyDisabled = isEdit ? '' : 'disabled';
  var autoQty = serials.filter(function(s) { return s && s.trim(); }).length || 0;

  var html =
    '<div class="note-dialog-overlay">' +
    '<div class="note-dialog" style="max-width:520px;max-height:85vh;overflow-y:auto">' +
      '<div class="note-dialog-head"><span class="note-dialog-title">' + (isEdit ? '编辑交付记录' : '添加交付记录') + '</span>' +
        '<button class="note-dialog-close" onclick="cancelDeliveryForm()">&times;</button></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">' +
        '<div><label style="font-size:11px;color:var(--muted)">' + prodLabel + '</label><select class="search-inp" id="df-product" style="margin-top:4px;padding:8px 10px">' + prodOptions + '</select></div>' +
        '<div><label style="font-size:11px;color:var(--muted)">交付日期</label><input class="search-inp" id="df-date" type="date" value="' + (r.date || new Date().toISOString().slice(0,10)) + '" style="margin-top:4px"></div>' +
        '<div><label style="font-size:11px;color:var(--muted)">交付责任人（PMA用户）</label>' + _selectHtml('df-responsible', _userNames, r.responsible_person || '') + '</div>' +
        '<div><label style="font-size:11px;color:var(--muted)">收货方（客户）</label>' + _selectHtml('df-receiver', _customerNames, r.receiver || '') + '</div>' +
      '</div>' +
      '<div style="margin-bottom:10px">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">' +
          '<label style="font-size:11px;color:var(--muted)">产品编号（每行一个）</label>' +
          '<button class="btn" onclick="addSerialRow()" style="font-size:10px;padding:2px 10px">+ 添加编号</button>' +
        '</div>' +
        '<div id="df-serial-rows">' + serialRows + '</div>' +
      '</div>' +
      '<div style="margin-bottom:12px;display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--bg);border-radius:6px">' +
        '<label style="font-size:11px;color:var(--muted);white-space:nowrap">交付数量：</label>' +
        '<span id="df-qty-display" style="font-size:16px;font-weight:700;color:var(--accent)">' + autoQty + ' 台</span>' +
        '<span style="font-size:11px;color:var(--muted)">（根据有效编号自动计算）</span>' +
      '</div>' +
      '<div style="margin-bottom:12px"><label style="font-size:11px;color:var(--muted)">备注</label><input class="search-inp" id="df-note" value="' + escHtml(r.note || '') + '" style="margin-top:4px"></div>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px">' +
        '<button class="btn" onclick="cancelDeliveryForm()">取消</button>' +
        '<button class="btn btn-primary" id="df-save-btn" onclick="saveDeliveryRecord(' + (r.id || 0) + ')">' + (isEdit ? '保存修改' : '添加记录') + '</button>' +
      '</div>' +
    '</div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
  updateSerialCount();
}

function addSerialRow() {
  var container = document.getElementById('df-serial-rows');
  if (!container) return;
  var idx = container.querySelectorAll('.df-serial-row').length + 1;
  var div = document.createElement('div');
  div.className = 'df-serial-row';
  div.style.cssText = 'display:flex;gap:6px;margin-bottom:6px;align-items:center';
  div.innerHTML = '<span class="df-serial-seq" style="width:28px;text-align:center;font-family:var(--mono);font-size:12px;color:var(--muted);flex-shrink:0">' + idx + '</span>' +
    '<input class="search-inp df-serial-inp" placeholder="产品编号 ' + idx + '" style="flex:1;margin-top:0" oninput="updateSerialCount()">' +
    '<button class="btn" onclick="removeSerialRow(this)" style="font-size:14px;padding:2px 8px;color:var(--danger);flex-shrink:0">&times;</button>';
  container.appendChild(div);
  updateSerialCount();
}

function removeSerialRow(btn) {
  var row = btn.closest('.df-serial-row');
  if (row) {
    var container = document.getElementById('df-serial-rows');
    if (container && container.querySelectorAll('.df-serial-row').length <= 2) return;
    row.remove();
    // Renumber remaining rows
    var rows = container.querySelectorAll('.df-serial-row');
    rows.forEach(function(r, i) {
      var seq = r.querySelector('.df-serial-seq');
      if (seq) seq.textContent = i + 1;
      var inp = r.querySelector('.df-serial-inp');
      if (inp) inp.placeholder = '产品编号 ' + (i + 1);
    });
    updateSerialCount();
  }
}

function updateSerialCount() {
  var inputs = document.querySelectorAll('.df-serial-inp');
  var count = 0;
  inputs.forEach(function(inp) { if (inp.value.trim()) count++; });
  var display = document.getElementById('df-qty-display');
  if (display) display.textContent = count + ' 台';
  // Enable/disable save based on count
  var btn = document.getElementById('df-save-btn');
  if (btn) btn.disabled = count === 0;
}

function cancelDeliveryForm() {
  var overlay = document.querySelector('.note-dialog-overlay');
  if (overlay) overlay.remove();
  // Also clean up old inline form container
  var container = document.getElementById('delivery-form-container');
  if (container) container.innerHTML = '';
}

async function saveDeliveryRecord(recordId) {
  var productEl = document.getElementById('df-product');
  var product = productEl.value.trim();
  var date = document.getElementById('df-date').value;
  var responsible = document.getElementById('df-responsible').value;
  var receiver = document.getElementById('df-receiver').value;
  var note = document.getElementById('df-note').value.trim();

  // Collect serial numbers from dynamic inputs
  var serials = [];
  document.querySelectorAll('.df-serial-inp').forEach(function(inp) {
    var v = inp.value.trim();
    if (v) serials.push(v);
  });

  if (!product) { showToast('请选择产品名称', 'error'); return; }
  if (serials.length === 0) { showToast('请至少填写一个产品编号', 'error'); return; }

  var body = { product_name: product, quantity: serials.length, delivery_date: date, responsible_person: responsible, receiver: receiver, note: note, serial_numbers: serials };

  // Disable form buttons during save
  var btns = document.querySelectorAll('#delivery-form-card button');
  btns.forEach(function(b) { b.disabled = true; });

  try {
    if (recordId) {
      await API.put('/delivery/records/' + recordId, body);
    } else {
      await API.post('/delivery/projects/' + _comboCurId + '/records', body);
    }
    showToast(recordId ? '修改成功' : '添加成功', 'success');
    cancelDeliveryForm();
    var data = await API.get('/projects/' + _comboCurId + '/delivery');
    buildDelivery(data);
  } catch(e) {
    showToast('操作失败: ' + (e.message || '未知错误'), 'error');
    btns.forEach(function(b) { b.disabled = false; });
  }
}

async function deleteDeliveryRecord(id) {
  if (!confirm('确认删除此交付记录？')) return;
  var ok = await verifyPassword('删除交付记录', 'pw_verify_delete_delivery');
  if (!ok) return;
  try {
    await API.del('/delivery/records/' + id);
    showToast('删除成功', 'success');
    var data = await API.get('/projects/' + _comboCurId + '/delivery');
    buildDelivery(data);
  } catch(e) {
    showToast('删除失败: ' + (e.message || '未知错误'), 'error');
  }
}

/* Resources */

function buildResources(resources, detail) {
  var productNames = (detail && detail.products) ? detail.products.map(function(p) { return p.name; }).join(' · ') : '—';
  var linksHtml = (resources || []).map(function(r) {
    return '<a class="doc-link" href="' + escHtml(r.url) + '" target="_blank" style="padding:9px 14px">' +
      '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="1" width="14" height="14" rx="2"/><polyline points="5,8 7.5,10.5 11,6"/></svg>' +
      escHtml(r.label) + ' — ' + escHtml(r.description || '') +
    '</a>';
  }).join('');

  document.getElementById('resources-content').innerHTML =
    '<div class="card" style="padding:20px">' +
      '<div class="section-title" style="margin-bottom:14px">软硬件资料快速访问</div>' +
      '<div style="display:flex;flex-direction:column;gap:9px">' +
        linksHtml +
      '</div>' +
      '<div style="margin-top:12px;padding:10px 12px;background:var(--bg);border-radius:7px;font-size:12px;color:var(--muted);border:1px solid var(--border)">' +
        '关联产品：<b>' + escHtml(productNames) + '</b>' +
      '</div>' +
    '</div>';
}

/* Notes */

function buildNotes(notes) {
  var container = document.getElementById('notes-content');
  var tableHtml;
  if (notes && notes.length) {
    tableHtml = '<div class="table-scroll"><table class="stage-table"><thead><tr>' +
      '<th style="width:140px">记录时间</th><th style="width:90px">涉及阶段</th><th style="width:70px">记录人</th><th>内容</th>' +
    '</tr></thead><tbody>';
    notes.forEach(function(n) {
      tableHtml += '<tr>' +
        '<td style="font-size:12px;font-family:var(--mono);color:var(--muted);white-space:nowrap">' + escHtml(n.created_at || '') + '</td>' +
        '<td style="font-size:12px">' + escHtml(n.stage_name || '项目整体') + '</td>' +
        '<td style="font-size:12.5px;font-weight:540">' + escHtml(n.recorded_by || '') + '</td>' +
        '<td style="font-size:13px;line-height:1.5;white-space:pre-wrap">' + escHtml(n.content) + '</td>' +
      '</tr>';
    });
    tableHtml += '</tbody></table></div>';
  } else {
    tableHtml = '<div class="empty-state" style="padding:12px">暂无笔记</div>';
  }

  container.innerHTML = tableHtml;
}

async function openNoteDialog() {
  if (!_comboCurId) return;

  // Fetch stages for the selector
  var stagesHtml = '<option value="">项目整体</option>';
  try {
    var stages = await API.get('/projects/' + _comboCurId + '/stages');
    if (stages && stages.length) {
      stages.forEach(function(s) {
        stagesHtml += '<option value="' + escHtml(s.name) + '">' + escHtml(s.name) + '</option>';
      });
    }
  } catch(e) { /* ignore, just show project-level option */ }

  var overlay = document.createElement('div');
  overlay.className = 'note-dialog-overlay';
  overlay.innerHTML = '<div class="note-dialog">' +
    '<div class="note-dialog-head">' +
      '<span class="note-dialog-title">添加项目笔记</span>' +
      '<button class="note-dialog-close" onclick="closeNoteDialog()">&times;</button>' +
    '</div>' +
    '<div style="margin-bottom:10px">' +
      '<label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px">涉及阶段</label>' +
      '<select id="note-dialog-stage" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--fg);font-size:13px;box-sizing:border-box">' + stagesHtml + '</select>' +
    '</div>' +
    '<textarea id="note-dialog-input" style="width:100%;min-height:100px;box-sizing:border-box;padding:10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--fg);font-size:13px;resize:vertical;font-family:var(--font)" placeholder="记录项目关键信息：会议纪要、采购问题、交付调整等..."></textarea>' +
    '<div style="display:flex;justify-content:flex-end;align-items:center;gap:10px;margin-top:12px">' +
      '<span id="note-dialog-msg" style="font-size:11px"></span>' +
      '<button class="btn" onclick="closeNoteDialog()" style="font-size:12px">取消</button>' +
      '<button class="btn btn-primary" onclick="submitNote()" style="font-size:12px">保存</button>' +
    '</div>' +
  '</div>';
  document.body.appendChild(overlay);
  setTimeout(function() {
    var inp = document.getElementById('note-dialog-input');
    if (inp) inp.focus();
  }, 100);
}

function closeNoteDialog() {
  var overlay = document.querySelector('.note-dialog-overlay');
  if (overlay) overlay.remove();
}

async function submitNote() {
  var inp = document.getElementById('note-dialog-input');
  var sel = document.getElementById('note-dialog-stage');
  var msg = document.getElementById('note-dialog-msg');
  var content = inp.value.trim();
  if (!content) return;
  if (!_comboCurId) return;

  try {
    msg.innerHTML = '<span style="color:var(--muted)">保存中...</span>';
    await API.post('/projects/' + _comboCurId + '/notes', { content: content, stage_name: sel ? sel.value : '' });
    closeNoteDialog();
    var notes = await API.get('/projects/' + _comboCurId + '/notes');
    buildNotes(notes);
  } catch(e) {
    msg.innerHTML = '<span style="color:var(--danger)">失败: ' + escHtml(e.message) + '</span>';
  }
}

/* Tab Switching */

function switchDTab(id, el) {
  document.querySelectorAll('.dsec').forEach(function(s) { s.classList.remove('active'); });
  document.querySelectorAll('.dtab').forEach(function(t) { t.classList.remove('active'); });
  var sec = document.getElementById('dsec-' + id);
  if (sec) sec.classList.add('active');
  if (el) { el.classList.add('active'); }
  else {
    var tab = document.querySelector('.dtab[onclick*="' + id + '"]');
    if (tab) tab.classList.add('active');
  }
  // Refresh maintenance tab content when switching to it
  if (id === 'maintenance') buildMaintenance();
  if (id === 'activities') loadActivities();
}

function gotoStageDetail(idx) {
  // Switch to stages tab
  switchDTab('stages');
  // Scroll to and highlight the matching stage row
  setTimeout(function() {
    var row = document.getElementById('stage-row-' + idx);
    if (!row) return;
    // Remove any existing highlights
    document.querySelectorAll('.stage-row-flash').forEach(function(r) { r.classList.remove('stage-row-flash'); });
    row.classList.add('stage-row-flash');
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(function() { row.classList.remove('stage-row-flash'); }, 2000);
  }, 100);
}

/* ⚠ showStageMismatchDialog / showStageNameEdit are now in components.js */

async function saveStageNameMapping(presetName) {
  var name;
  if (presetName) {
    name = presetName;  // one-click mapping from dialog button
  } else {
    if (!_mismatchExecId) { showToast('请重新点击告警标记', 'error'); return; }
    var sel = document.getElementById('stage-name-select');
    if (!sel) { showToast('表单已失效，请重新打开', 'error'); return; }
    name = sel.value.trim();
    if (!name) { showToast('请选择标准阶段名', 'error'); return; }
  }
  if (!_mismatchExecId) { showToast('请重新点击告警标记', 'error'); return; }

  try {
    await API.put('/projects/' + _comboCurId + '/stages/' + _mismatchExecId + '/sync-to-zentao', { stage_name: name });
    showToast('PMA 映射已保存（请在禅道中手动修改执行名）', 'success');
    var dlg = document.querySelector('.stage-mismatch-dialog-overlay');
    if (dlg) dlg.remove();
    _mismatchExecId = null;
    var p = await Promise.all([
      API.get('/projects/' + _comboCurId + '/stages'),
      API.get('/projects/' + _comboCurId + '/documents'),
    ]);
    buildStages(p[0]);
    buildDocs(p[1]);
  } catch(e) {
    showToast('保存失败: ' + (e.message || '未知错误'), 'error');
  }
}

/* ── Project Maintenance ── */

function buildMaintenance() {
  if (!_comboCurId) return;
  var user = getCurrentUser();
  var hasPerm = user && (user.role === 'admin' || user.role === 'pm' || user.role === 'manager');
  var dt = document.getElementById('dt-maintenance');
  if (dt) dt.style.display = hasPerm ? '' : 'none';
  if (!hasPerm) return;
  loadMaintProjectProducts();
  loadMaintProjectCustomers();
  loadMaintProjectTags();
}

// ── Shared section renderer (badges + edit button only) ──

function _renderMaintSection(containerId, linked, idKey, labelKey, type, labelName) {
  var container = document.getElementById(containerId);
  var badgesHtml = linked.length ? linked.map(function(x) {
    return '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:6px;font-size:12px;background:var(--accent-lt);color:var(--accent)">' +
      escHtml(x[labelKey]) + ' <span onclick="maintRemove_' + type + '(' + x[idKey] + ')" style="cursor:pointer;opacity:0.5;font-size:14px" title="移除">&times;</span></span>';
  }).join('') : '<span style="font-size:12px;color:var(--muted)">暂无' + labelName + '</span>';

  container.innerHTML =
    '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">' + badgesHtml + '</div>' +
    '<button class="btn btn-secondary" onclick="maintOpenDialog_' + type + '()" style="font-size:11px">编辑' + labelName + '</button>';
}

// ── Dialog helpers ──

function _maintBuildDialogCheckboxes(containerId, allItems, linked, idKey, labelKey, type) {
  var linkedIds = (linked || []).map(function(x) { return x[idKey]; });
  var html = allItems.map(function(item) {
    var lid = item[idKey];
    return '<label style="display:flex;align-items:center;gap:6px;padding:3px 6px;font-size:12px;cursor:pointer" class="maint-dlg-cb" data-filter="' + escHtml((item[labelKey] || '').toLowerCase()) + '">' +
      '<input type="checkbox" value="' + lid + '" ' + (linkedIds.indexOf(lid) >= 0 ? 'checked' : '') + '>' +
      escHtml(item[labelKey]) + '</label>';
  }).join('');
  document.getElementById(containerId).innerHTML = html;
}

function _maintDialogFilter(type, v) {
  var q = (v || '').toLowerCase();
  var dd = document.getElementById('maint-dlg-dd-' + type);
  dd.querySelectorAll('[data-filter]').forEach(function(el) {
    el.style.display = q ? (el.dataset.filter.indexOf(q) >= 0 ? '' : 'none') : '';
  });
}

// ── Products ──

var _maintLinkedProds = [];
var _maintAllProds = [];

async function loadMaintProjectProducts() {
  try {
    var linked = await API.get('/maintenance/projects/' + _comboCurId + '/products');
    _maintLinkedProds = linked || [];
    var all = await API.get('/products?limit=200');
    _maintAllProds = (all.items || []).map(function(p) { return {id: p.id, name: p.name}; });
    _renderMaintSection('maint-proj-products', _maintLinkedProds, 'id', 'name', 'prod', '产品');
  } catch(e) {
    document.getElementById('maint-proj-products').innerHTML = '<div class="error-state">加载失败</div>';
  }
}

function maintOpenDialog_prod() {
  var bodyHtml =
    '<input class="search-inp" placeholder="搜索产品..." oninput="_maintDialogFilter(\'prod\', this.value)" style="width:100%;padding:6px 8px;font-size:12px;margin-bottom:6px;box-sizing:border-box">' +
    '<div style="max-height:240px;overflow-y:auto;overscroll-behavior:contain" id="maint-dlg-dd-prod"></div>';
  openDialog('编辑关联产品', bodyHtml, [
    {text: '取消', cls: '', onclick: 'document.querySelector(\'.note-dialog-overlay\').remove()'},
    {text: '确定', cls: 'btn-primary', onclick: 'maintDialogSave_prod()'}
  ], {maxWidth: 500});
  _maintBuildDialogCheckboxes('maint-dlg-dd-prod', _maintAllProds, _maintLinkedProds, 'id', 'name', 'prod');
}

async function maintDialogSave_prod() {
  var ids = [];
  document.querySelectorAll('#maint-dlg-dd-prod .maint-dlg-cb input:checked').forEach(function(cb) { ids.push(parseInt(cb.value)); });
  document.querySelector('.note-dialog-overlay').remove();
  await API.put('/maintenance/projects/' + _comboCurId + '/products', { ids: ids });
  loadMaintProjectProducts();
}

function maintRemove_prod(pid) {
  verifyPassword('移除产品关联', 'pw_verify_maint_remove').then(function(ok) {
    if (!ok) return;
    var ids = _maintLinkedProds.map(function(p) { return p.id; }).filter(function(id) { return id !== pid; });
    API.put('/maintenance/projects/' + _comboCurId + '/products', { ids: ids }).then(function() { loadMaintProjectProducts(); });
  });
}

// ── Customers ──

var _maintLinkedCustomers = [];
var _maintAllCustomers = [];

async function loadMaintProjectCustomers() {
  try {
    var linked = await API.get('/maintenance/projects/' + _comboCurId + '/customers');
    _maintLinkedCustomers = linked || [];
    var all = await API.get('/customers');
    _maintAllCustomers = (all || []).map(function(c) { return {id: c.id, name: c.name}; });
    _renderMaintSection('maint-proj-customers', _maintLinkedCustomers, 'id', 'name', 'cust', '客户');
  } catch(e) {
    document.getElementById('maint-proj-customers').innerHTML = '<div class="error-state">加载失败</div>';
  }
}

function maintOpenDialog_cust() {
  var linkedIds = _maintLinkedCustomers.map(function(c) { return c.id; });
  var listHtml = _maintAllCustomers.map(function(c) {
    var sel = linkedIds.indexOf(c.id) >= 0;
    return '<div class="maint-dlg-row" data-filter="' + escHtml(c.name.toLowerCase()) + '" ' +
      'onclick="maintToggle_cust(' + c.id + ')" ' +
      'style="display:flex;align-items:center;gap:8px;padding:6px 10px;font-size:12px;cursor:pointer;border-radius:4px;' +
      (sel ? 'background:var(--accent-lt);color:var(--accent);font-weight:540' : '') + '">' +
      (sel ? '✓ ' : '<span style="visibility:hidden">✓ </span>') + escHtml(c.name) +
    '</div>';
  }).join('');

  var bodyHtml =
    '<input class="search-inp" placeholder="搜索客户..." oninput="_maintDialogFilter(\'cust\', this.value)" style="width:100%;padding:6px 8px;font-size:12px;margin-bottom:6px;box-sizing:border-box">' +
    '<div style="max-height:300px;overflow-y:auto;overscroll-behavior:contain" id="maint-dlg-dd-cust">' + listHtml + '</div>';
  openDialog('编辑关联客户', bodyHtml, [], {maxWidth: 450, hideClose: false});
}

async function maintToggle_cust(cid) {
  var linkedIds = _maintLinkedCustomers.map(function(c) { return c.id; });
  var idx = linkedIds.indexOf(cid);
  if (idx >= 0) {
    linkedIds.splice(idx, 1);
  } else {
    linkedIds.push(cid);
  }
  try {
    await API.put('/maintenance/projects/' + _comboCurId + '/customers', { ids: linkedIds });
    _maintLinkedCustomers = _maintAllCustomers.filter(function(c) { return linkedIds.indexOf(c.id) >= 0; });
    _renderMaintCustDialogList();
    _renderMaintSection('maint-proj-customers', _maintLinkedCustomers, 'id', 'name', 'cust', '客户');
  } catch(e) {
    showToast('操作失败: ' + (e.message || '未知错误'), 'error');
  }
}

function _renderMaintCustDialogList() {
  var listEl = document.getElementById('maint-dlg-dd-cust');
  if (!listEl) return;
  var linkedIds = _maintLinkedCustomers.map(function(c) { return c.id; });
  listEl.innerHTML = _maintAllCustomers.map(function(c) {
    var sel = linkedIds.indexOf(c.id) >= 0;
    return '<div class="maint-dlg-row" data-filter="' + escHtml(c.name.toLowerCase()) + '" ' +
      'onclick="maintToggle_cust(' + c.id + ')" ' +
      'style="display:flex;align-items:center;gap:8px;padding:6px 10px;font-size:12px;cursor:pointer;border-radius:4px;' +
      (sel ? 'background:var(--accent-lt);color:var(--accent);font-weight:540' : '') + '">' +
      (sel ? '✓ ' : '<span style="visibility:hidden">✓ </span>') + escHtml(c.name) +
    '</div>';
  }).join('');
}

function maintRemove_cust(cid) {
  verifyPassword('移除客户关联', 'pw_verify_maint_remove').then(function(ok) {
    if (!ok) return;
    var ids = _maintLinkedCustomers.map(function(c) { return c.id; }).filter(function(id) { return id !== cid; });
    API.put('/maintenance/projects/' + _comboCurId + '/customers', { ids: ids }).then(function() { loadMaintProjectCustomers(); });
  });
}

// ── Tags ──

var _maintLinkedTags = [];
var _maintAllTags = [];
var _maintAllTagsFull = [];

async function loadMaintProjectTags() {
  try {
    var linked = await API.get('/maintenance/projects/' + _comboCurId + '/tags');
    _maintLinkedTags = linked || [];
    var allData = await API.get('/tags');
    var allList = allData || [];
    _maintAllTagsFull = allList;
    _maintAllTags = allList.filter(function(t) {
      return t.category === 'project' || !t.category || t.category === '';
    });
    _renderMaintTagSection();
  } catch(e) {
    document.getElementById('maint-proj-tags').innerHTML = '<div class="error-state">加载失败: ' + escHtml(e.message || '未知错误') + '</div>';
  }
}

function _renderMaintTagSection() {
  var container = document.getElementById('maint-proj-tags');
  var linkedNames = _maintLinkedTags.slice();

  var badgesHtml = linkedNames.length ? linkedNames.map(function(name) {
    var cls = 'tag-' + (name.length % 5);
    return '<span class="tag-badge ' + cls + '" style="font-size:12px;padding:3px 12px;display:inline-flex;align-items:center;gap:4px">' +
      '#' + escHtml(name) +
      ' <span data-tag-name="' + escHtml(name) + '" onclick="maintRemove_tag(this.getAttribute(\'data-tag-name\'))" style="cursor:pointer;opacity:0.5;font-size:14px;line-height:1" title="移除">&times;</span></span>';
  }).join('') : '<span style="font-size:12px;color:var(--muted)">暂无标签</span>';

  container.innerHTML =
    '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">' + badgesHtml + '</div>' +
    '<button class="btn btn-secondary" onclick="maintOpenDialog_tag()" style="font-size:11px">编辑标签</button>';
}

function maintOpenDialog_tag() {
  var linkedNames = _maintLinkedTags.slice();
  var projectTags = _maintAllTagsFull.filter(function(t) { return t.category === 'project'; });
  var productTags = _maintAllTagsFull.filter(function(t) { return t.category === 'product'; });
  var generalTags = _maintAllTagsFull.filter(function(t) { return !t.category || t.category === ''; });

  var sections = [
    { title: '项目标签', color: 'var(--accent)', bg: 'var(--accent-lt)', tags: projectTags },
    { title: '产品标签', color: 'var(--success)', bg: 'var(--success-lt)', tags: productTags },
    { title: '通用标签', color: 'var(--muted)', bg: 'var(--bg)', tags: generalTags },
  ];

  var bodyHtml = '';
  sections.forEach(function(sec) {
    bodyHtml += '<div class="card" style="margin-bottom:10px;padding:12px 14px">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:' + (sec.tags.length ? '8px' : '2px') + '">' +
        '<span style="width:8px;height:8px;border-radius:50%;background:' + sec.color + '"></span>' +
        '<span style="font-weight:540;font-size:13px">' + sec.title + '</span>' +
        '<span style="font-size:11px;color:var(--muted)">' + sec.tags.length + '</span>' +
      '</div>';
    if (sec.tags.length) {
      bodyHtml += '<div style="display:flex;flex-wrap:wrap;gap:6px">';
      sec.tags.forEach(function(t) {
        var isLinked = linkedNames.indexOf(t.name) >= 0;
        bodyHtml += '<span class="tag-badge tag-' + (t.name.length % 5) + '" ' +
          'data-tag-name="' + escHtml(t.name) + '" onclick="maintToggle_tag(this.getAttribute(\'data-tag-name\'))" ' +
          'style="font-size:12px;padding:3px 12px;cursor:pointer;' +
          (isLinked ? '' : 'opacity:0.35') + '" ' +
          'title="' + (isLinked ? '点击移除' : '点击添加') + '">#' + escHtml(t.name) + '</span>';
      });
      bodyHtml += '</div>';
    } else {
      bodyHtml += '<div style="font-size:11px;color:var(--muted);font-style:italic">暂无</div>';
    }
    bodyHtml += '</div>';
  });

  openDialog('编辑项目标签', '<div id="maint-dlg-tag-content">' + bodyHtml + '</div>', [], {maxWidth: 520, hideClose: false});
}

async function maintToggle_tag(name) {
  var linkedNames = _maintLinkedTags.slice();
  var idx = linkedNames.indexOf(name);
  if (idx >= 0) {
    linkedNames.splice(idx, 1);
  } else {
    linkedNames.push(name);
  }
  try {
    await API.put('/maintenance/projects/' + _comboCurId + '/tags', { tags: linkedNames });
    _maintLinkedTags = linkedNames;
    _renderMaintTagDialogContent();
    _renderMaintTagSection();
  } catch(e) {
    showToast('操作失败: ' + (e.message || '未知错误'), 'error');
  }
}

function _renderMaintTagDialogContent() {
  var linkedNames = _maintLinkedTags.slice();
  var projectTags = _maintAllTagsFull.filter(function(t) { return t.category === 'project'; });
  var productTags = _maintAllTagsFull.filter(function(t) { return t.category === 'product'; });
  var generalTags = _maintAllTagsFull.filter(function(t) { return !t.category || t.category === ''; });

  var sections = [
    { title: '项目标签', color: 'var(--accent)', bg: 'var(--accent-lt)', tags: projectTags },
    { title: '产品标签', color: 'var(--success)', bg: 'var(--success-lt)', tags: productTags },
    { title: '通用标签', color: 'var(--muted)', bg: 'var(--bg)', tags: generalTags },
  ];

  var container = document.getElementById('maint-dlg-tag-content');
  if (!container) return;

  var bodyHtml = '';
  sections.forEach(function(sec) {
    bodyHtml += '<div class="card" style="margin-bottom:10px;padding:12px 14px">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:' + (sec.tags.length ? '8px' : '2px') + '">' +
        '<span style="width:8px;height:8px;border-radius:50%;background:' + sec.color + '"></span>' +
        '<span style="font-weight:540;font-size:13px">' + sec.title + '</span>' +
        '<span style="font-size:11px;color:var(--muted)">' + sec.tags.length + '</span>' +
      '</div>';
    if (sec.tags.length) {
      bodyHtml += '<div style="display:flex;flex-wrap:wrap;gap:6px">';
      sec.tags.forEach(function(t) {
        var isLinked = linkedNames.indexOf(t.name) >= 0;
        bodyHtml += '<span class="tag-badge tag-' + (t.name.length % 5) + '" ' +
          'data-tag-name="' + escHtml(t.name) + '" onclick="maintToggle_tag(this.getAttribute(\'data-tag-name\'))" ' +
          'style="font-size:12px;padding:3px 12px;cursor:pointer;' +
          (isLinked ? '' : 'opacity:0.35') + '" ' +
          'title="' + (isLinked ? '点击移除' : '点击添加') + '">#' + escHtml(t.name) + '</span>';
      });
      bodyHtml += '</div>';
    } else {
      bodyHtml += '<div style="font-size:11px;color:var(--muted);font-style:italic">暂无</div>';
    }
    bodyHtml += '</div>';
  });
  container.innerHTML = bodyHtml;
}

function maintRemove_tag(name) {
  var tags = _maintLinkedTags.filter(function(t) { return t !== name; });
  API.put('/maintenance/projects/' + _comboCurId + '/tags', { tags: tags }).then(function() { loadMaintProjectTags(); });
}

/* ── Project Activities (进度明细) ── */

var _activitySort = 'desc';

async function loadActivities() {
  var container = document.getElementById('activities-content');
  container.innerHTML = '<div class="loading-spinner">加载活动记录...</div>';
  try {
    var data = await API.get('/projects/' + _comboCurId + '/activities?sort=' + _activitySort + '&limit=200');
    buildActivities(data || []);
  } catch(e) {
    container.innerHTML = '<div class="error-state">加载失败: ' + escHtml(e.message) + '</div>';
  }
}

function buildActivities(items) {
  var container = document.getElementById('activities-content');

  var sortBtn = '<button class="btn" style="font-size:11px;padding:4px 12px;margin-bottom:12px" onclick="toggleActivitySort()">' +
    (_activitySort === 'desc' ? '↓ 最新优先' : '↑ 最早优先') + '</button>';

  if (!items || !items.length) {
    container.innerHTML = sortBtn + '<div class="empty-state" style="padding:20px">暂无活动记录</div>';
    return;
  }

  var html = sortBtn + '<div class="activity-list">';
  items.forEach(function(a) {
    var time = (a.created_at || '').replace('T', ' ');
    html += '<div class="activity-item">' +
      '<div class="activity-time">' + escHtml(time) + '</div>' +
      '<div class="activity-body">' +
        '<span class="activity-user">' + escHtml(a.username) + '</span>' +
        ' <span class="activity-action pill" style="font-size:10px">' + escHtml(a.action) + '</span>' +
        (a.detail ? ' <span class="activity-detail">' + escHtml(a.detail) + '</span>' : '') +
      '</div>' +
    '</div>';
  });
  html += '</div>';
  container.innerHTML = html;
}

function toggleActivitySort() {
  _activitySort = _activitySort === 'desc' ? 'asc' : 'desc';
  loadActivities();
}
