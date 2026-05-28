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
    return '<div class="' + cls + '" onclick="selectComboProject(' + p.id + ')">' +
      renderProjIcon(p.project_type) +
      '<div style="min-width:0">' +
        '<div class="combo-opt-name">' + escHtml(p.customer_name || p.name) + '</div>' +
        '<div class="combo-opt-meta">' + escHtml(p.code || p.name) + ' · ' + typeTxt + '项目 · ' + escHtml(p.status || '') + '</div>' +
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
  document.getElementById('stages-tbody').innerHTML = '<tr><td colspan="6"><div class="loading-spinner">加载阶段数据...</div></td></tr>';
  document.getElementById('docs-tbody').innerHTML = '<tr><td colspan="4"><div class="loading-spinner">加载文档数据...</div></td></tr>';
  document.getElementById('delivery-content').innerHTML = '<div class="loading-spinner">加载交付数据...</div>';
  document.getElementById('resources-content').innerHTML = '<div class="loading-spinner">加载资料链接...</div>';

  try {
    // Fetch all data in parallel
    var results = await Promise.all([
      API.get('/projects/' + id),
      API.get('/projects/' + id + '/gantt'),
      API.get('/projects/' + id + '/stages'),
      API.get('/projects/' + id + '/documents'),
      API.get('/projects/' + id + '/delivery'),
      API.get('/projects/' + id + '/resources'),
    ]);

    var detail = results[0];
    var ganttData = results[1];
    var stages = results[2];
    var docs = results[3];
    var delivery = results[4];
    var resources = results[5];

    buildDetailHeader(detail);
    buildGantt(ganttData);
    buildStages(stages);
    buildDocs(docs);
    buildDelivery(delivery);
    buildResources(resources, detail);
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

  document.getElementById('detail-header').innerHTML =
    '<div class="detail-meta">' +
      '<div class="detail-title">' + escHtml(p.alias_name || p.name) + '</div>' +
      '<div class="detail-sub">' +
        '<span class="meta-item">' +
          '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><polyline points="8,4.5 8,8 10.5,10"/></svg>' +
          formatDate(p.begin) + ' → ' + formatDate(p.end) +
        '</span>' +
        renderTypeBadge(p.project_type) +
        '<span class="meta-item">' +
          '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="5" r="3"/><path d="M2 14c0-3 2.7-5 6-5s6 2 6 5"/></svg>' +
          '项目经理：' + escHtml(p.pm_name || '—') +
        '</span>' +
        renderPill(p.status) +
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

var _ganttPpd = 3;        // pixels-per-day (1~30, default 3)
var _ganttDragInit = false;

function ganttGranularity(ppd) {
  if (ppd <= 1.5) return 'month';
  if (ppd <= 6)   return 'week';
  return 'day';
}

// ── Drag-to-pan ──

var _ganttDragWrap = null;
var _ganttDragState = null;

function initGanttDrag() {
  var wrap = document.querySelector('.gantt-wrap');
  if (!wrap) return;

  // Remove old listeners (simplest: replace element clone pattern not needed, just rebind)
  wrap.onmousedown = null;

  wrap.addEventListener('mousedown', function(e) {
    if (e.button !== 0) return;
    if (e.target.closest('.gantt-bar') || e.target.closest('.gantt-toolbar') ||
        e.target.closest('input') || e.target.closest('button')) return;

    _ganttDragWrap = wrap;
    _ganttDragState = { startX: e.pageX, scrollLeft: wrap.scrollLeft };
    wrap.classList.add('dragging');
    e.preventDefault();
  });
}

// Global move/up handlers (registered once)
document.addEventListener('mousemove', function(e) {
  if (!_ganttDragWrap) return;
  _ganttDragWrap.scrollLeft = _ganttDragState.scrollLeft - (e.pageX - _ganttDragState.startX);
});

document.addEventListener('mouseup', function() {
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
    if (e.deltaY < 0) {
      _ganttPpd = Math.min(30, _ganttPpd + 1.05);
    } else {
      _ganttPpd = Math.max(1, _ganttPpd - 1.05);
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
  minDate.setDate(1);
  minDate.setMonth(minDate.getMonth() - 1);
  maxDate.setDate(1);
  maxDate.setMonth(maxDate.getMonth() + 1);

  var minSpan = new Date(today); minSpan.setMonth(today.getMonth() - 3);
  var maxSpan = new Date(today); maxSpan.setMonth(today.getMonth() + 3);
  if (minDate > minSpan) minDate = minSpan;
  if (maxDate < maxSpan) maxDate = maxSpan;

  return { start: minDate, end: maxDate, span: maxDate - minDate };
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// ── Column generation ──

function generateColumns(range, ppd) {
  var cols = [];
  var cursor = new Date(range.start);
  var gran = ganttGranularity(ppd);

  if (gran === 'day') {
    cursor.setHours(0, 0, 0, 0);
    while (cursor <= range.end) {
      var m = cursor.getMonth() + 1, d = cursor.getDate();
      var dow = cursor.getDay();
      var label = (d === 1 || cols.length === 0) ? m + '/' + d : String(d);
      cols.push({
        label: label, isWeekend: dow === 0 || dow === 6,
        isToday: isSameDay(cursor, new Date()),
        isMonthStart: d === 1, w: ppd
      });
      cursor.setDate(cursor.getDate() + 1);
    }
  } else if (gran === 'week') {
    // Align to Monday
    cursor.setDate(cursor.getDate() - cursor.getDay() + 1);
    if (cursor.getDay() === 0) cursor.setDate(cursor.getDate() - 6);
    while (cursor <= range.end) {
      var wm = cursor.getMonth() + 1, wd = cursor.getDate();
      cols.push({
        label: wm + '/' + wd, isWeekend: false,
        isToday: false, isMonthStart: wd <= 7,
        w: ppd * 7
      });
      cursor.setDate(cursor.getDate() + 7);
    }
  } else {
    // Month
    cursor.setDate(1);
    while (cursor <= range.end) {
      var y = cursor.getFullYear(), mo = cursor.getMonth() + 1;
      var today = new Date();
      cols.push({
        label: mo === 1 ? y + '/' + mo : mo + '月',
        isWeekend: false, isMonthStart: true,
        isToday: today.getFullYear() === y && today.getMonth() + 1 === mo,
        w: ppd * new Date(y, mo, 0).getDate()
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }
  return cols;
}

// ── Pixel position ──

function ganttPx(ds, range, totalWidth) {
  if (!ds) return 0;
  var t = new Date(ds) - range.start;
  return Math.max(0, Math.min(totalWidth, (t / range.span) * totalWidth));
}

// ── Main render ──

function buildGantt(stages) {
  var range = ganttRange(stages);
  var ppd = _ganttPpd;
  var cols = generateColumns(range, ppd);
  var totalWidth = cols.reduce(function(s, c) { return s + c.w; }, 0);

  // Column headers
  var mHdrs = cols.map(function(c) {
    var cls = 'gantt-col-hd';
    if (c.isToday) cls += ' today-col';
    if (c.isWeekend) cls += ' weekend';
    if (c.isMonthStart && !c.isToday && ganttGranularity(ppd) === 'day') cls += ' q-end';
    return '<div class="' + cls + '" style="width:' + c.w + 'px">' + c.label + '</div>';
  }).join('');

  // Grid columns
  var gCols = cols.map(function(c) {
    var cls = 'gantt-grid-col';
    if (c.isToday) cls += ' today-bg';
    return '<div class="' + cls + '" style="width:' + c.w + 'px"></div>';
  }).join('');

  var today = new Date().toISOString().slice(0, 10);
  var todayPx = ganttPx(today, range, totalWidth);

  if (!stages || !stages.length) {
    document.getElementById('gantt-root').innerHTML =
      buildGanttToolbar() +
      '<div class="gantt-head-row">' +
        '<div class="gantt-label-col"><div class="gl-stage">阶段</div><div class="gl-who">负责人</div></div>' +
        '<div class="gantt-timeline-head" style="min-width:' + totalWidth + 'px;width:' + totalWidth + 'px">' + mHdrs + '</div>' +
      '</div>' +
      '<div class="gantt-row"><div class="gantt-stage-cell" style="width:100%;text-align:center;color:var(--muted);padding:20px">暂无阶段数据</div></div>';
    initGanttDrag();
    initGanttWheel();
    return;
  }

  var rows = stages.map(function(s, i) {
    var alt = i % 2 === 1 ? ' stage-alt' : '';
    var lp = ganttPx(s.start, range, totalWidth);
    var ep = ganttPx(s.end, range, totalWidth);
    var wp = Math.max(4, ep - lp);
    var whoShort = (s.who || '').split('（')[0].split('、')[0] || '—';
    var barLabel = wp > 50 ? s.name : '';
    return '<div class="gantt-row' + alt + '">' +
      '<div class="gantt-stage-cell">' +
        '<div class="gs-name" title="' + escHtml(s.name) + '">' + escHtml(s.name) + '</div>' +
        '<div class="gs-who" title="' + escHtml(s.who || '') + '">' + escHtml(whoShort) + '</div>' +
      '</div>' +
      '<div class="gantt-bar-cell" style="min-width:' + totalWidth + 'px;width:' + totalWidth + 'px">' +
        '<div class="gantt-grid">' + gCols + '</div>' +
        '<div class="gantt-today-line" style="left:' + todayPx + 'px"><div class="gantt-today-pip"></div></div>' +
        '<div class="gantt-bar ' + s.status + '" style="left:' + lp + 'px;width:' + wp + 'px" title="' + escHtml(s.name) + '  ' + (s.start || '') + ' → ' + (s.end || '') + '">' + escHtml(barLabel) + '</div>' +
      '</div>' +
    '</div>';
  }).join('');

  document.getElementById('gantt-root').innerHTML =
    buildGanttToolbar() +
    '<div class="gantt-head-row">' +
      '<div class="gantt-label-col"><div class="gl-stage">阶段</div><div class="gl-who">负责人</div></div>' +
      '<div class="gantt-timeline-head" style="min-width:' + totalWidth + 'px;width:' + totalWidth + 'px">' + mHdrs + '</div>' +
    '</div>' + rows;

  // Center today on first render
  setTimeout(function() {
    var wrap = document.querySelector('.gantt-wrap');
    if (wrap && todayPx > 0) {
      wrap.scrollLeft = todayPx - wrap.clientWidth / 2;
    }
  }, 50);

  initGanttDrag();
  initGanttWheel();
}

function buildGanttToolbar() {
  var gran = ganttGranularity(_ganttPpd);
  var granLabels = { day: '日', week: '周', month: '月' };
  return '<div class="gantt-toolbar">' +
    '<div style="font-size:10.5px;color:var(--muted)">滚轮缩放 · 拖拽平移</div>' +
    '<div class="gantt-toolbar-zoom">' +
      '<button class="gantt-zoom-btn" onclick="_ganttPpd=Math.max(1,_ganttPpd/1.3);refreshGantt()" title="缩小">−</button>' +
      '<span class="gantt-zoom-label">' + (granLabels[gran] || '月') + '</span>' +
      '<button class="gantt-zoom-btn" onclick="_ganttPpd=Math.min(30,_ganttPpd*1.3);refreshGantt()" title="放大">+</button>' +
    '</div>' +
  '</div>';
}

/* Stages Table */

function buildStages(stages) {
  if (!stages || !stages.length) {
    document.getElementById('stages-tbody').innerHTML = '<tr><td colspan="6"><div class="empty-state">暂无阶段数据</div></td></tr>';
    return;
  }

  document.getElementById('stages-tbody').innerHTML = stages.map(function(s, i) {
    var bg = i % 2 === 0 ? 'var(--surface)' : 'var(--bg)';
    var dels = s.deliverables || [];
    return '<tr style="background:' + bg + '">' +
      '<td><strong>' + escHtml(s.name) + '</strong></td>' +
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
    document.getElementById('docs-tbody').innerHTML = '<tr><td colspan="4"><div class="empty-state">暂无文档数据</div></td></tr>';
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
      var lnk = d.done && d.location ? '<span class="doc-link">↗ ' + escHtml(d.location) + '</span>' : (d.done ? '<span style="font-size:12px;color:var(--muted)">禅道任务附件</span>' : '—');
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

function buildDelivery(data) {
  var total = data.total || 0;
  var done = data.done || 0;
  var rem = total - done;
  var dp = total > 0 ? Math.round(done / total * 100) : 0;
  var records = data.records || [];

  var recHtml = records.length ? '' +
    '<div class="card col-span" style="padding:20px;margin-top:16px">' +
      '<div class="section-title" style="margin-bottom:14px">交付记录明细</div>' +
      '<table class="stage-table"><thead><tr><th>交付日期</th><th>数量</th><th>产品编号</th><th>收货方</th><th>备注</th></tr></thead><tbody>' +
      records.map(function(r) {
        return '<tr>' +
          '<td style="font-family:var(--mono);font-size:12px;color:var(--success);font-weight:540">' + formatDate(r.date) + '</td>' +
          '<td style="font-variant-numeric:tabular-nums;font-weight:600">' + r.qty + ' 台</td>' +
          '<td style="font-family:var(--mono);font-size:11.5px">' + escHtml(r.items || '') + '</td>' +
          '<td style="font-size:12.5px">' + escHtml(r.receiver || '') + '</td>' +
          '<td style="font-size:12px;color:var(--muted)">' + escHtml(r.note || '') + '</td>' +
        '</tr>';
      }).join('') +
      '</tbody></table>' +
    '</div>' : '';

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
        (done === 0 ? '<div style="margin-top:14px;padding:12px 14px;background:var(--warn-lt);border:1px solid var(--warn);border-radius:8px;font-size:13px;color:var(--warn)">暂无交付记录</div>' : '') +
      '</div>' +
      recHtml +
    '</div>';
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

/* Tab Switching */

function switchDTab(id, el) {
  document.querySelectorAll('.dsec').forEach(function(s) { s.classList.remove('active'); });
  document.querySelectorAll('.dtab').forEach(function(t) { t.classList.remove('active'); });
  var sec = document.getElementById('dsec-' + id);
  if (sec) sec.classList.add('active');
  if (el) el.classList.add('active');
}
