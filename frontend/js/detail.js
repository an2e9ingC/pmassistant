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

var _ganttZoomLevel = 2; // 0=day, 1=week, 2=month(default), 3=quarter
var _ganttDragState = { down: false, startX: 0, scrollLeft: 0 };

// Column width per zoom level (pixels)
var ZOOM_COL_WIDTH = [36, 56, 80, 120];
var ZOOM_LABELS = ['日', '周', '月', '季'];

function ganttZoomIn() {
  if (_ganttZoomLevel > 0) { _ganttZoomLevel--; refreshGantt(); }
}
function ganttZoomOut() {
  if (_ganttZoomLevel < 3) { _ganttZoomLevel++; refreshGantt(); }
}
function refreshGantt() {
  if (_comboCurId) {
    API.get('/projects/' + _comboCurId + '/gantt').then(function(data) {
      buildGantt(data);
    });
  }
}

// ── Drag-to-pan ──

function initGanttDrag() {
  var wrap = document.querySelector('.gantt-wrap');
  if (!wrap) return;
  wrap.addEventListener('mousedown', function(e) {
    // Only start drag on bar-cell area (not on bars themselves)
    if (e.target.closest('.gantt-bar')) return;
    _ganttDragState.down = true;
    _ganttDragState.startX = e.pageX;
    _ganttDragState.scrollLeft = wrap.scrollLeft;
    wrap.classList.add('dragging');
  });
  document.addEventListener('mousemove', function(e) {
    if (!_ganttDragState.down) return;
    var dx = e.pageX - _ganttDragState.startX;
    wrap.scrollLeft = _ganttDragState.scrollLeft - dx;
  });
  document.addEventListener('mouseup', function() {
    if (_ganttDragState.down) {
      _ganttDragState.down = false;
      var w = document.querySelector('.gantt-wrap');
      if (w) w.classList.remove('dragging');
    }
  });
}

// ── Zoom via scroll wheel ──

function initGanttWheel() {
  var wrap = document.querySelector('.gantt-wrap');
  if (!wrap) return;
  wrap.addEventListener('wheel', function(e) {
    if (!e.ctrlKey && !e.metaKey) return; // require Ctrl+scroll for zoom
    e.preventDefault();
    if (e.deltaY < 0) {
      ganttZoomIn();
    } else {
      ganttZoomOut();
    }
  }, { passive: false });
}

// ── Column generation ──

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

function generateColumns(range, zoomLevel) {
  var cols = [];
  var cursor = new Date(range.start);

  if (zoomLevel === 0) {
    // Day columns
    cursor.setHours(0, 0, 0, 0);
    var endMs = range.end.getTime();
    while (cursor.getTime() <= endMs) {
      var d = cursor.getDate(), m = cursor.getMonth() + 1;
      var dow = cursor.getDay(); // 0=Sun, 6=Sat
      var label = m + '/' + d;
      if (d === 1 || cols.length === 0) label = m + '/' + d;
      cols.push({
        label: label,
        isToday: isSameDay(cursor, new Date()),
        isWeekend: dow === 0 || dow === 6,
        isMonthStart: d === 1,
        ts: cursor.getTime()
      });
      cursor.setDate(cursor.getDate() + 1);
    }
  } else if (zoomLevel === 1) {
    // Week columns
    cursor.setDate(cursor.getDate() - cursor.getDay() + 1); // Monday
    while (cursor.getTime() <= range.end.getTime()) {
      var m2 = cursor.getMonth() + 1, d2 = cursor.getDate();
      cols.push({
        label: m2 + '/' + d2,
        isToday: false,
        isWeekend: false,
        isMonthStart: d2 <= 7,
        ts: cursor.getTime()
      });
      cursor.setDate(cursor.getDate() + 7);
    }
  } else if (zoomLevel === 2) {
    // Month columns
    cursor.setDate(1);
    while (cursor <= range.end) {
      var y = cursor.getFullYear(), mo = cursor.getMonth() + 1;
      var today = new Date();
      cols.push({
        label: mo === 1 ? y + '/' + mo : mo + '月',
        isToday: today.getFullYear() === y && today.getMonth() + 1 === mo,
        isWeekend: false,
        isMonthStart: true,
        ts: cursor.getTime()
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
  } else {
    // Quarter columns
    cursor.setDate(1);
    cursor.setMonth(Math.floor(cursor.getMonth() / 3) * 3);
    while (cursor <= range.end) {
      var qy = cursor.getFullYear(), qm = cursor.getMonth();
      var qn = Math.floor(qm / 3) + 1;
      cols.push({
        label: qy + ' Q' + qn,
        isToday: false,
        isWeekend: false,
        isMonthStart: true,
        ts: cursor.getTime()
      });
      cursor.setMonth(cursor.getMonth() + 3);
    }
  }
  return cols;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth() === b.getMonth() &&
         a.getDate() === b.getDate();
}

// ── Pixel position helper ──

function ganttPx(ds, range, totalWidth) {
  if (!ds) return 0;
  var t = new Date(ds) - range.start;
  return Math.max(0, Math.min(totalWidth, (t / range.span) * totalWidth));
}

// ── Main render ──

function buildGantt(stages) {
  var range = ganttRange(stages);
  var colW = ZOOM_COL_WIDTH[_ganttZoomLevel];
  var cols = generateColumns(range, _ganttZoomLevel);
  var totalWidth = cols.length * colW;

  // Column headers
  var mHdrs = cols.map(function(c) {
    var cls = 'gantt-col-hd';
    if (c.isToday) cls += ' today-col';
    if (c.isWeekend) cls += ' weekend';
    if (c.isMonthStart && !c.isToday && _ganttZoomLevel <= 1) cls += ' q-end';
    return '<div class="' + cls + '" style="width:' + colW + 'px">' + c.label + '</div>';
  }).join('');

  // Grid columns
  var gCols = cols.map(function(c) {
    var cls = 'gantt-grid-col';
    if (c.isToday) cls += ' today-bg';
    return '<div class="' + cls + '" style="width:' + colW + 'px"></div>';
  }).join('');

  // Today position
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

  // Scroll to center today
  setTimeout(function() {
    var wrap = document.querySelector('.gantt-wrap');
    if (wrap && todayPx > 0) {
      wrap.scrollLeft = todayPx - wrap.clientWidth / 2;
    }
  }, 50);

  // Init zoom and drag
  initGanttWheel();
  initGanttDrag();
}

function buildGanttToolbar() {
  return '<div class="gantt-toolbar">' +
    '<div style="font-size:12px;font-weight:600;color:var(--fg)">甘特图</div>' +
    '<div class="gantt-toolbar-zoom">' +
      '<span style="font-size:10px;color:var(--muted)">Ctrl+滚轮缩放</span>' +
      '<button class="gantt-zoom-btn" onclick="ganttZoomIn()" title="放大">+</button>' +
      '<span class="gantt-zoom-label">' + ZOOM_LABELS[_ganttZoomLevel] + '</span>' +
      '<button class="gantt-zoom-btn" onclick="ganttZoomOut()" title="缩小">−</button>' +
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
