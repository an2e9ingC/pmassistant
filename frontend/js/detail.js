/* ═══════════════════════════════════════════════════
   PROJECT DETAIL VIEW
═══════════════════════════════════════════════════ */

/* Combo Box */

var _comboCurId = null;
var _comboOpen  = false;
var _comboProjects = [];

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
    ]);

    var detail = results[0];
    var ganttData = results[1];
    var stages = results[2];
    var docs = results[3];
    var delivery = results[4];
    var resources = results[5];
    var notes = results[6];

    buildDetailHeader(detail);
    buildGantt(ganttData);
    buildStages(stages);
    buildDocs(docs);
    buildDelivery(delivery);
    buildResources(resources, detail);
    buildNotes(notes);
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
      '</div>' +
      '<div class="detail-sub">' +
        '<span class="meta-item">' +
          '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><polyline points="8,4.5 8,8 10.5,10"/></svg>' +
          dateHtml +
        '</span>' +
        '<span class="meta-item">' +
          '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="12" height="10" rx="1.5"/><line x1="5" y1="8" x2="11" y2="8"/><line x1="5" y1="11" x2="9" y2="11"/></svg>' +
          (p.customer_name ? '<span onclick="gotoCustomerProjects(\'' + escHtml(p.customer_name) + '\')" style="cursor:pointer">' + renderCustomerBadge(p.customer_name) + '</span>' : '<span style="color:var(--muted);font-size:12px">—</span>') +
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

function initGanttWheel() {
  var wrap = document.querySelector('.gantt-wrap');
  if (!wrap) return;
  if (wrap._wheelInited) return;
  wrap._wheelInited = true;

  wrap.addEventListener('wheel', function(e) {
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

  // Project timeline bar (full project span)
  var projBeginPx = projBegin ? ganttPx(projBegin, range, totalWidth) : 0;
  var projEndPx = projEnd ? ganttPx(projEnd, range, totalWidth) : 0;
  var projWidth = Math.max(2, projEndPx - projBeginPx);
  var projBarHtml = (projBegin && projEnd) ?
    '<div class="gantt-project-bar" style="left:' + projBeginPx + 'px;width:' + projWidth + 'px" data-proj-begin="' + projBegin + '" data-proj-end="' + projEnd + '">' + projBegin + ' → ' + projEnd + '</div>' : '';

  var rows = stages.map(function(s, i) {
    var alt = i % 2 === 1 ? ' stage-alt' : '';
    var lp = ganttPx(s.start, range, totalWidth);
    var ep = ganttPx(s.end, range, totalWidth);
    var wp = Math.max(4, ep - lp);
    var whoShort = (s.who || '').split('（')[0].split('、')[0] || '—';
    var barLabel = wp > 30 ? String(Math.round(s.progress || 0)) : '';
    var prog = s.progress || 0;
    var risk = getStageRisk(s);
    return '<div class="gantt-row' + alt + '">' +
      '<div class="gantt-stage-cell">' +
        '<div class="gs-name" title="' + escHtml(s.name) + '" onclick="switchDTab(\'stages\');event.stopPropagation()">' + escHtml(s.name) + '</div>' +
        '<div class="gs-risk"><span class="risk-tag" style="--risk-color:' + risk.color + '" title="' + escHtml(risk.tip) + '"><span class="risk-dot" style="background:' + risk.color + '"></span>' + escHtml(risk.label) + '</span></div>' +
        '<div class="gs-prog">' + renderProgressRing(prog) + '</div>' +
        '<div class="gs-who" title="' + escHtml(s.who || '') + '">' + escHtml(whoShort) + '</div>' +
      '</div>' +
      '<div class="gantt-bar-cell" style="min-width:' + displayWidth + 'px;width:' + displayWidth + 'px">' +
        '<div class="gantt-grid">' + gCols + '</div>' +
        projBarHtml +
        '<div class="gantt-today-line" style="left:' + todayPx + 'px"><div class="gantt-today-pip"></div></div>' +
        '<div class="gantt-bar ' + s.status + '" style="left:' + lp + 'px;width:' + wp + 'px" title="' + escHtml(s.name) + '  ' + (s.start || '') + ' → ' + (s.end || '') + '">' + escHtml(barLabel) + '</div>' +
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
  initProjBarTooltip();
}

var _projTipEl = null;

function initProjBarTooltip() {
  var root = document.getElementById('gantt-root');
  if (!root) return;

  // Create tooltip element once
  if (!_projTipEl) {
    _projTipEl = document.createElement('div');
    _projTipEl.className = 'gantt-proj-tip';
    _projTipEl.style.cssText = 'display:none;position:fixed;background:#333;color:#fff;font-size:11px;padding:6px 12px;border-radius:6px;z-index:9999;pointer-events:none;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.3);font-family:var(--mono)';
    document.body.appendChild(_projTipEl);
  }

  root.addEventListener('mousemove', function(e) {
    // Check if mouse is over a project bar by testing bounds
    var bars = root.querySelectorAll('.gantt-project-bar');
    var found = null;
    for (var i = 0; i < bars.length; i++) {
      var r = bars[i].getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
        found = bars[i];
        break;
      }
    }
    if (!found) { _projTipEl.style.display = 'none'; return; }
    var b = found.dataset.projBegin || '';
    var ed = found.dataset.projEnd || '';
    _projTipEl.textContent = '项目周期: ' + b + ' → ' + ed;
    _projTipEl.style.display = 'block';
    _projTipEl.style.left = (e.clientX + 14) + 'px';
    _projTipEl.style.top = (e.clientY - 36) + 'px';
  });

  root.addEventListener('mouseleave', function() {
    _projTipEl.style.display = 'none';
  });
}

function buildGanttToolbar() {
  var container = document.getElementById('gantt-toolbar-container');
  if (container) {
    container.innerHTML = '<div class="gantt-toolbar">' +
      '<div style="font-size:10.5px;color:var(--muted)">滚轮缩放 · 拖拽平移</div>' +
      '<div class="gantt-toolbar-zoom">' +
        '<button class="gantt-zoom-btn" onclick="ganttZoomOut()" title="缩小">−</button>' +
        '<span class="gantt-zoom-val">×' + _ganttPpd.toFixed(0) + '</span>' +
        '<button class="gantt-zoom-btn" onclick="ganttZoomIn()" title="放大">+</button>' +
      '</div>' +
    '</div>';
  }
}

/* Stages Table */

function getStageRisk(s) {
  // Returns { level, label, color, tip }
  if (s.status === 'completed') return { level: 'none', label: '已完成', color: 'var(--success)', tip: '阶段已完成' };
  if (s.status === 'blocked') return { level: 'high', label: '已阻塞', color: 'var(--danger)', tip: '阶段被挂起/阻塞' };

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
    return { level: 'high', label: '已超期' + overdueDays + '天', color: 'var(--danger)', tip: '应于 ' + formatDate(s.end) + ' 完成，已超期' };
  }
  // Not started yet
  if (today < start) return { level: 'none', label: '未开始', color: 'var(--muted)', tip: '计划 ' + formatDate(s.start) + ' 开始' };

  // On-track analysis
  var expectedProg = Math.min(100, Math.round((elapsedDays / totalDays) * 100));
  var gap = expectedProg - prog;

  if (gap <= 5) return { level: 'none', label: '正常', color: 'var(--success)', tip: '进度正常，预期 ' + expectedProg + '%，实际 ' + prog + '%' };
  if (gap <= 20) return { level: 'low', label: '轻微滞后', color: 'var(--warn)', tip: '预期 ' + expectedProg + '%，实际 ' + prog + '%，差 ' + gap + '%' };
  if (gap <= 40) return { level: 'medium', label: '进度滞后', color: '#e67e22', tip: '预期 ' + expectedProg + '%，实际 ' + prog + '%，差 ' + gap + '%' };
  return { level: 'high', label: '严重滞后', color: 'var(--danger)', tip: '预期 ' + expectedProg + '%，实际 ' + prog + '%，差 ' + gap + '%' };
}

function buildStages(stages) {
  if (!stages || !stages.length) {
    document.getElementById('stages-tbody').innerHTML = '<tr><td colspan="8"><div class="empty-state">暂无阶段数据</div></td></tr>';
    return;
  }

  document.getElementById('stages-tbody').innerHTML = stages.map(function(s, i) {
    var bg = i % 2 === 0 ? 'var(--surface)' : 'var(--bg)';
    var dels = s.deliverables || [];
    var risk = getStageRisk(s);
    var prog = s.progress || 0;
    return '<tr style="background:' + bg + '">' +
      '<td><strong>' + escHtml(s.name) + '</strong></td>' +
      '<td><span class="risk-tag" style="--risk-color:' + risk.color + '" title="' + escHtml(risk.tip) + '">' +
        '<span class="risk-dot" style="background:' + risk.color + '"></span>' + escHtml(risk.label) +
      '</span></td>' +
      '<td>' + renderProgressRing(prog) + '</td>' +
      '<td style="font-size:12px;white-space:nowrap">' + escHtml(s.who || '—') + '</td>' +
      '<td style="font-size:11.5px;color:var(--muted);white-space:nowrap;line-height:1.8">' + formatDate(s.start) + '<br>' + formatDate(s.end) + '</td>' +
      '<td>' + renderPill(s.status) + (s.completed_date ? '<div style="font-size:10.5px;color:var(--success);margin-top:4px;font-family:var(--mono)">&#10003; ' + s.completed_date + '</div>' : '') + '</td>' +
      '<td style="font-size:12px;color:' + (s.blocker ? 'var(--danger)' : 'var(--muted)') + ';max-width:200px">' + escHtml(s.blocker || '—') + '</td>' +
      '<td>' + renderDeliverablesList(dels) + '</td>' +
    '</tr>';
  }).join('');
}

/* Documents Table */

function buildDocs(docs) {
  if (!docs || !docs.length) {
    document.getElementById('docs-tbody').innerHTML = '<tr><td colspan="4"><div style="text-align:center;padding:30px;font-style:italic;color:var(--muted)">TODO：各阶段文档清单尚未配置，当前显示为禅道任务名占位<br><span style="font-size:11px">后续根据阶段类型匹配固定文档模板（售前→技术需求书/可行性报告、硬件→原理图/PCB/BOM…）</span></div></td></tr>';
    return;
  }

  // Group by stage
  var grouped = {};
  docs.forEach(function(d) {
    var key = d.stage_name || '未分类';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(d);
  });

  var stageIdx = 0;
  var rows = '';
  Object.keys(grouped).forEach(function(stageName) {
    var items = grouped[stageName];
    var bg = stageIdx % 2 === 0 ? 'var(--surface)' : 'var(--bg)';
    items.forEach(function(d, i) {
      var cls = d.done ? 'completed' : (d.warn ? 'blocked' : 'pending');
      var lbl = d.done ? '已提交' : (d.warn ? '⚠ 告警缺失' : '未开始');
      var lnk = d.done && d.location ? '<span class="doc-link">↗ ' + escHtml(d.location) + '</span>' : (d.done ? '<span style="font-size:12px;color:var(--muted)">禅道任务附件</span>' : '<span style="font-size:11.5px;color:var(--muted);font-style:italic">请按照规范输出对应文档（TODO：后续要根据不同的阶段提示不同的信息）</span>');
      var statusCell = '<span class="pill ' + cls + '" style="font-size:11px">' + lbl + '</span>' + (d.completed_at ? '<div style="font-size:10.5px;color:var(--success);margin-top:3px;font-family:var(--mono)">' + d.completed_at + '</div>' : '');
      var completedDate = items[0].stage_completed_date;
      rows += '<tr style="background:' + bg + '">' +
        (i === 0 ? '<td rowspan="' + items.length + '" style="vertical-align:middle;font-weight:540;border-right:1px solid var(--border)">' + escHtml(stageName) + (completedDate ? '<br><span style="font-size:10.5px;color:var(--success);font-weight:400">&#10003; ' + completedDate + '</span>' : '') + '</td>' : '') +
        '<td>' + escHtml(d.name) + '</td><td>' + statusCell + '</td><td>' + lnk + '</td>' +
      '</tr>';
    });
    stageIdx++;
  });
  document.getElementById('docs-tbody').innerHTML = rows;
}

/* Delivery */

var _deliveryData = null;

function buildDelivery(data) {
  _deliveryData = data;
  var total = data.total || 0;
  var done = data.done || 0;
  var rem = total - done;
  var dp = total > 0 ? Math.round(done / total * 100) : 0;
  var records = data.records || [];

  var recHtml = '' +
    '<div class="card col-span" style="padding:20px;margin-top:16px">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">' +
        '<div class="section-title">交付记录明细 (' + records.length + ' 条)</div>' +
        '<button class="btn" style="font-size:11px;padding:4px 10px" onclick="showDeliveryForm()">+ 添加记录</button>' +
      '</div>' +
      (records.length ? '<table class="stage-table"><thead><tr><th>交付日期</th><th>数量</th><th>产品编号</th><th>收货方</th><th>备注</th><th style="width:60px"></th></tr></thead><tbody>' +
      records.map(function(r) {
        return '<tr>' +
          '<td style="font-family:var(--mono);font-size:12px;color:var(--success);font-weight:540">' + formatDate(r.date) + '</td>' +
          '<td style="font-variant-numeric:tabular-nums;font-weight:600">' + r.qty + ' 台</td>' +
          '<td style="font-family:var(--mono);font-size:11.5px">' + escHtml(r.items || '') + '</td>' +
          '<td style="font-size:12.5px">' + escHtml(r.receiver || '') + '</td>' +
          '<td style="font-size:12px;color:var(--muted)">' + escHtml(r.note || '') + '</td>' +
          '<td><button class="btn" style="font-size:10px;padding:2px 8px;color:var(--danger)" onclick="deleteDeliveryRecord(' + r.id + ')">删除</button></td>' +
        '</tr>';
      }).join('') +
      '</tbody></table>' : '<div class="empty-state" style="padding:20px">暂无交付记录，点击上方按钮添加</div>') +
    '</div>';

  document.getElementById('delivery-content').innerHTML =
    '<div class="two-col">' +
      '<div class="card" style="padding:20px">' +
        '<div class="section-title" style="margin-bottom:14px">交付概要</div>' +
        '<div class="delivery-kpi">' +
          '<div class="dkpi"><div class="dkpi-lbl">应交付总数</div><div class="dkpi-val">' + total + '</div></div>' +
          '<div class="dkpi"><div class="dkpi-lbl">已交付数量</div><div class="dkpi-val" style="color:var(--success)">' + done + '</div></div>' +
          '<div class="dkpi"><div class="dkpi-lbl">剩余未交付</div><div class="dkpi-val" style="color:' + (rem > 0 ? 'var(--warn)' : 'var(--muted)') + '">' + rem + '</div></div>' +
        '</div>' +
        '<div class="progress-bar" style="height:8px;margin-bottom:6px"><div class="progress-fill ' + (dp === 100 ? 'green' : 'blue') + '" style="width:' + dp + '%"></div></div>' +
        '<div style="font-size:12px;color:var(--muted)">交付进度 ' + dp + '%</div>' +
        '<div style="margin-top:8px;font-size:11px;font-style:italic;color:var(--muted)">TODO：进度计算逻辑待完善——应对比"项目计划交付量"与"实际交付汇总"，当前简化为记录统计</div>' +
        (done === 0 ? '<div style="margin-top:14px;padding:12px 14px;background:var(--warn-lt);border:1px solid var(--warn);border-radius:8px;font-size:13px;color:var(--warn)">暂无交付记录</div>' : '') +
      '</div>' +
      recHtml +
    '</div>' +
    '<div id="delivery-form-container"></div>';
}

function showDeliveryForm(record) {
  var r = record || {};
  var html =
    '<div class="card" style="padding:20px;margin-top:12px" id="delivery-form-card">' +
      '<div class="section-title" style="margin-bottom:14px">' + (record ? '编辑交付记录' : '添加交付记录') + '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">' +
        '<div><label style="font-size:11px;color:var(--muted)">产品名称</label><input class="search-inp" id="df-product" value="' + escHtml(r.product_name || '') + '" style="margin-top:4px"></div>' +
        '<div><label style="font-size:11px;color:var(--muted)">数量</label><input class="search-inp" id="df-qty" type="number" value="' + (r.qty || 1) + '" style="margin-top:4px"></div>' +
        '<div><label style="font-size:11px;color:var(--muted)">交付日期</label><input class="search-inp" id="df-date" type="date" value="' + (r.date || new Date().toISOString().slice(0,10)) + '" style="margin-top:4px"></div>' +
        '<div><label style="font-size:11px;color:var(--muted)">收货方</label><input class="search-inp" id="df-receiver" value="' + escHtml(r.receiver || '') + '" style="margin-top:4px"></div>' +
      '</div>' +
      '<div style="margin-bottom:12px"><label style="font-size:11px;color:var(--muted)">产品编号（逗号分隔）</label><input class="search-inp" id="df-items" value="' + escHtml(r.items || '') + '" style="margin-top:4px"></div>' +
      '<div style="margin-bottom:12px"><label style="font-size:11px;color:var(--muted)">备注</label><input class="search-inp" id="df-note" value="' + escHtml(r.note || '') + '" style="margin-top:4px"></div>' +
      '<div style="display:flex;gap:8px">' +
        '<button class="btn btn-primary" onclick="saveDeliveryRecord(' + (r.id || 0) + ')">' + (record ? '保存修改' : '添加记录') + '</button>' +
        '<button class="btn" onclick="cancelDeliveryForm()">取消</button>' +
      '</div>' +
    '</div>';
  document.getElementById('delivery-form-container').innerHTML = html;
  document.getElementById('delivery-form-card').scrollIntoView({ behavior: 'smooth' });
}

function cancelDeliveryForm() {
  document.getElementById('delivery-form-container').innerHTML = '';
}

async function saveDeliveryRecord(recordId) {
  var product = document.getElementById('df-product').value.trim();
  var qty = parseInt(document.getElementById('df-qty').value) || 0;
  var date = document.getElementById('df-date').value;
  var receiver = document.getElementById('df-receiver').value.trim();
  var itemsStr = document.getElementById('df-items').value.trim();
  var note = document.getElementById('df-note').value.trim();
  var serials = itemsStr ? itemsStr.split(/[,，]/).map(function(s) { return s.trim(); }).filter(Boolean) : [];

  if (!product) { showToast('请输入产品名称', 'error'); return; }

  var body = { product_name: product, quantity: qty, delivery_date: date, receiver: receiver, note: note, serial_numbers: serials };

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
  var btnHtml = '<div style="margin-bottom:12px">' +
    '<button class="btn btn-primary" onclick="openNoteDialog()" style="font-size:12px;padding:5px 16px">+ 添加笔记</button>' +
  '</div>';

  var tableHtml;
  if (notes && notes.length) {
    tableHtml = '<table class="stage-table"><thead><tr>' +
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
    tableHtml += '</tbody></table>';
  } else {
    tableHtml = '<div class="empty-state" style="padding:12px">暂无笔记，点击上方按钮添加</div>';
  }

  container.innerHTML = btnHtml + tableHtml;
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
}
