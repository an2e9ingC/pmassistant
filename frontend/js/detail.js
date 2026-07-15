/* ═══════════════════════════════════════════════════
   PROJECT DETAIL VIEW
═══════════════════════════════════════════════════ */

/* Combo Box — uses shared projectCombo component */

var _comboCurId = null;
var _comboCurCode = null;
var _projDetail = null;
var _projectProducts = [];
var _userNames = [];
var _customerNames = [];
var _detailTargetTab = null;

function setDetailTargetTab(tabId) { _detailTargetTab = tabId; }

initProjectCombo({
  comboId: 'proj-combo',
  inputId: 'combo-input',
  dropdownId: 'combo-dropdown',
  selectedIdFn: function() { return _comboCurId; },
  onSelect: function(p) {
    _comboCurId = p.id;
    _comboCurCode = p.code || String(p.id);
    loadProjectDetail(_comboCurCode);
    history.replaceState({ view: 'detail', params: [_comboCurCode, 'info'] }, '', buildHash('detail', _comboCurCode, 'info'));
  }
});

/* Project Detail Loading */

async function loadProjectDetail(code) {
  if (!code) return;
  await loadFavorites();

  // Show loading state
  document.getElementById('detail-header').innerHTML = '<div class="loading-spinner">加载项目详情...</div>';
  document.getElementById('info-content').innerHTML = '<div class="loading-spinner">加载基本信息...</div>';
  document.getElementById('gantt-root').innerHTML = '<div class="loading-spinner">加载甘特图...</div>';
  var stagesTbody = document.getElementById('stages-tbody');
  if (stagesTbody) stagesTbody.innerHTML = '<tr><td colspan="8"><div class="loading-spinner">加载阶段数据...</div></td></tr>';
  document.getElementById('docs-tbody').innerHTML = '<tr><td colspan="6"><div class="loading-spinner">加载文档数据...</div></td></tr>';
  document.getElementById('delivery-content').innerHTML = '<div class="loading-spinner">加载交付数据...</div>';
  document.getElementById('resources-content').innerHTML = '<div class="loading-spinner">加载产品文档...</div>';

  try {
    // Fetch all data in parallel (use code for API calls)
    var results = await Promise.all([
      API.get('/projects/' + code),
      API.get('/projects/' + code + '/gantt'),
      API.get('/projects/' + code + '/stages'),
      API.get('/projects/' + code + '/documents'),
      API.get('/projects/' + code + '/delivery'),
      API.get('/projects/' + code + '/resources'),
      API.get('/projects/' + code + '/notes'),
      // Load user names + customer names for delivery form dropdown
      API.get('/users/names').catch(function() { return []; }),
      API.get('/users/customers/names').catch(function() { return []; }),
    ]);

    var detail = results[0];
    _projDetail = detail;
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
    buildDelivery(delivery);
    buildInfo(detail, notes, delivery);
    buildGantt(ganttData);
    buildStages(stages);
    buildDocs(docs);
    buildResources(resources, detail);
    buildMaintenance();

    // Pre-load task data so task detail tab is ready when user navigates to it
    if (typeof _taskProjectId === 'undefined' || _taskProjectId !== code) {
      _taskProjectId = code;
      _taskProjectName = detail.name || '';
      if (typeof loadTaskData === 'function') loadTaskData();
    }

    // Default to info tab when entering project detail, unless target tab is set
    var targetTab = _detailTargetTab || 'info';
    _detailTargetTab = null;
    switchDTab(targetTab);
    // Update hash to reflect current tab
    history.replaceState({ view: 'detail', params: [_comboCurCode, targetTab] }, '', buildHash('detail', _comboCurCode, targetTab));
  } catch(e) {
    document.getElementById('detail-header').innerHTML = '<div class="error-state">加载失败: ' + escHtml(e.message) + '</div>';
  }
}

/* Detail Header */

function buildDetailHeader(p) {
  if (!p) return;
  var progress = parseFloat(p.progress) || 0;

  var dateHtml = '';
  if (p.begin && p.end) {
    dateHtml = formatDate(p.begin) + ' → ' + formatDate(p.end);
  } else if (p.begin) {
    dateHtml = formatDate(p.begin) + ' 起（长期项目）';
  } else {
    dateHtml = '计划时间待定';
  }

  var projCode = extractProjectCode(p.name, p.code);
  var coreName = extractCoreName(p.name);
  document.getElementById('detail-header').innerHTML =
    '<div class="detail-meta">' +
      '<div class="detail-title">' +
        '<span style="vertical-align:middle;margin-right:4px">' + favStar('project', p.id, {size:'22px'}) + '</span>' +
        projCodeTag(projCode, p.id, p.name) + ' ' +
        escHtml(coreName) +
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
        (p.is_local
          ? ' <span class="pm-src-badge local" style="vertical-align:middle">PMA本地</span>'
          : (p.zentao_url ? ' <a href="' + p.zentao_url + '" target="_blank" class="zentao-link" title="在禅道中查看">&#x2197; 禅道</a>' : '')) +
      '</div>' +
    '</div>' +
    renderProgressCircle(progress, 56, { label: "整体进度" });
}

/* Info Tab — Basic Info */

function buildInfo(p, notes, delivery) {
  if (!p) return;
  var del = delivery || {};

  // Status display mapping
  var statusMap = {
    active: { label: '进行中', color: 'var(--success)' },
    completed: { label: '已完成', color: 'var(--accent)' },
    blocked: { label: '已阻塞', color: 'var(--danger)' },
    pending: { label: '待启动', color: 'var(--warn)' },
    canceled: { label: '已取消', color: 'var(--muted)' },
    incomplete: { label: '未完成', color: 'var(--muted)' },
  };
  var st = statusMap[p.status] || { label: p.status || '—', color: 'var(--muted)' };

  var html = '<div class="card" style="padding:20px">';

  // KPI row 1 — 4 columns
  html += '<div class="delivery-kpi" style="grid-template-columns:repeat(4, 1fr);margin-bottom:16px">' +
    '<div class="dkpi"><div class="dkpi-lbl">项目类型</div><div class="dkpi-val" style="font-size:16px;font-weight:600">' +
      '<span style="color:' + (p.project_type === 'RD' ? 'var(--accent)' : p.project_type === 'SC' ? 'var(--success)' : '#8b5cf6') +
      ';background:' + (p.project_type === 'RD' ? 'var(--accent-lt)' : p.project_type === 'SC' ? 'var(--success-lt)' : 'var(--accent-lt)') +
      ';padding:2px 10px;border-radius:4px;font-size:13px">' + escHtml(getProjectTypeLabel(p.project_type)) + '</span>' +
    '</div></div>' +
    '<div class="dkpi"><div class="dkpi-lbl">项目状态</div><div class="dkpi-val" style="font-size:16px;font-weight:600;color:' + st.color + '">' + st.label + '</div></div>' +
    '<div class="dkpi"><div class="dkpi-lbl">项目经理</div><div class="dkpi-val" style="font-size:16px;font-weight:600">' + escHtml(p.pm_name || '—') + '</div></div>' +
    '<div class="dkpi"><div class="dkpi-lbl">客户</div><div class="dkpi-val" style="font-size:16px;font-weight:600">' +
      (p.customer_name ? '<span style="cursor:pointer" onclick="openCustomerByName(\'' + escHtml(p.customer_name) + '\')" title="查看客户详情">' + renderCustomerBadge(p.customer_name) + '</span>' : '<span style="color:var(--muted)">—</span>') +
    '</div></div>' +
  '</div>';

  // KPI row 2 — key timeline + delivery + description tags
  html += '<div class="delivery-kpi" style="grid-template-columns:repeat(4, 1fr);margin-bottom:16px">' +
    '<div class="dkpi"><div class="dkpi-lbl">计划结束</div><div class="dkpi-val" style="font-size:16px;font-weight:600">' + (p.end ? formatDate(p.end) : '<span style="color:var(--muted)">—</span>') + '</div></div>' +
    '<div class="dkpi"><div class="dkpi-lbl">交付数量</div><div class="dkpi-val" style="font-size:16px;font-weight:600">' +
      '<span style="color:var(--success)">' + (del.done || 0) + '</span>' +
      '<span style="color:var(--muted);font-weight:400"> / ' + (del.planned || 0) + '</span>' +
    '</div></div>' +
    // Description as PMA local tags
    '<div class="dkpi" style="grid-column:span 2"><div class="dkpi-lbl">项目描述</div><div class="dkpi-val" style="font-size:12px;line-height:1.6">' +
    (p.tags_list && p.tags_list.length
      ? p.tags_list.map(function(t, idx) { return '<span class="tag-badge tag-' + (idx % 5) + '" style="font-size:10px;margin-right:2px">#' + escHtml(t) + '</span>'; }).join('')
      : '<span style="color:var(--muted)">—</span>') +
    '</div></div>' +
  '</div>';

  // Linked products + Linked projects — side-by-side cards
  var products = p.linked_products || [];
  var linkedProjects = p.linked_projects || [];
  html += '<div style="display:flex;gap:16px;margin-bottom:16px">' +
    '<div class="card card-pad" style="flex:1;min-width:0">' +
      '<div style="font-size:11px;color:var(--muted);margin-bottom:8px">关联产品（' + products.length + '）</div>';
  if (products.length) {
    html += '<div style="display:flex;flex-wrap:wrap;gap:4px">' +
      products.map(function(prod) { return linkChip(prod.code || prod.name, 'openProductDetail(\'' + escHtml(prod.code || String(prod.id)).replace(/'/g, "\\'") + '\')', prod.name || ''); }).join('') +
    '</div>';
  } else {
    html += '<div style="font-size:12px;color:var(--muted);font-style:italic">暂无</div>';
  }
  html += '</div>' +
    '<div class="card card-pad" style="flex:1;min-width:0">' +
      '<div style="font-size:11px;color:var(--muted);margin-bottom:8px">关联项目（' + linkedProjects.length + '）</div>';
  if (linkedProjects.length) {
    html += '<div style="display:flex;flex-wrap:wrap;gap:4px">' +
      linkedProjects.map(function(lp) { return '<span class="proj-code-btn" onclick="loadProjectDetail('+lp.id+')" title="'+escHtml(lp.code||'')+'">'+escHtml(lp.name)+'</span>'; }).join('') +
    '</div>';
  } else {
    html += '<div style="font-size:12px;color:var(--muted);font-style:italic">暂无</div>';
  }
  html += '</div>' +
  '</div>';

  // Additional info row (minimal)
  var extras = [];
  if (p.real_end) extras.push('实际结束: <b style="color:var(--fg)">' + formatDate(p.real_end) + '</b>');
  if (extras.length) {
    html += '<div style="display:flex;gap:24px;flex-wrap:wrap;font-size:12px;color:var(--muted);margin-bottom:12px">' +
      extras.map(function(e) { return '<span>' + e + '</span>'; }).join('') +
    '</div>';
  }

  html += '</div>'; // .card

  // Project Background (editable by project_edit permission)
  var hasEdit = _hasProjectEditPerm();
  if (hasEdit) {
    html += '<div style="margin-top:20px">' + sectionHeader('项目背景', null, '编辑', 'editProjectBackground()') + '</div>';
  } else {
    html += '<div class="section-hd" style="margin-top:20px"><div class="section-title">项目背景</div></div>';
  }
  html += '<div class="card" style="padding:12px 16px;min-height:40px" id="proj-background-content">';
  html += (p.background ? '<div style="font-size:12.5px;line-height:1.7;white-space:pre-wrap">' + escHtml(p.background) + '</div>' : '<div style="color:var(--muted);font-size:12px;font-style:italic">暂无项目背景说明</div>');
  html += '</div>';

  // Notes section
  html += '<div style="margin-top:20px">' + sectionHeader('项目笔记', null, '+ 添加笔记', 'openNoteDialog()') + '</div>';
  html += '<div class="card" style="padding:0;overflow:hidden">';
  html += '<div style="max-height:400px;overflow-y:auto"><div id="notes-content"></div></div>';
  html += '</div>';

  document.getElementById('info-content').innerHTML = html;

  // Populate notes
  buildNotes(notes || []);
}

function _hasProjectEditPerm() {
  var user = getCurrentUser();
  var perms = (user && user.permissions) ? user.permissions.split(',') : [];
  return perms.indexOf('project_edit') !== -1 || perms.indexOf('admin') >= 0;
}

function editProjectBackground() {
  if (!_comboCurCode || !_projDetail) return;
  var currentBg = (_projDetail && _projDetail.background) ? _projDetail.background : '';
  openDialog('编辑项目背景 — ' + escHtml(_projDetail.name || ''),
    '<div style="margin-bottom:12px">' +
      '<textarea id="proj-bg-input" class="search-inp" rows="6" placeholder="输入项目背景说明..." style="width:100%;box-sizing:border-box;resize:vertical;font-size:13px">' + escHtml(currentBg) + '</textarea>' +
    '</div>',
    [
      {text: '取消', onclick: 'document.querySelector(\'.shared-dialog-overlay\').remove()'},
      {text: '保存', cls: 'btn-primary', onclick: 'saveProjectBackground()'},
    ],
    {hideClose: true});
}

async function saveProjectBackground() {
  var input = document.getElementById('proj-bg-input');
  var bg = (input && input.value) ? input.value : '';
  closeSharedDialog();
  try {
    await API.put('/projects/' + _comboCurCode + '/background', { background: bg });
    _projDetail.background = bg;
    showToast('已保存', 'ok');
    // Refresh the background display
    var el = document.getElementById('proj-background-content');
    if (el) {
      el.innerHTML = bg ? '<div style="font-size:12.5px;line-height:1.7;white-space:pre-wrap">' + escHtml(bg) + '</div>' : '<div style="color:var(--muted);font-size:12px;font-style:italic">暂无项目背景说明</div>';
    }
  } catch(e) {
    showToast('保存失败: ' + (e.message || '未知错误'), 'error');
  }
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
  if (_comboCurCode) {
    API.get('/projects/' + _comboCurCode + '/gantt').then(function(data) {
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
  var size = 48, cx = 24, r = 17;
  var circ = 2 * Math.PI * r;
  var offset = circ * (1 - pct / 100);
  var color = pct >= 100 ? 'var(--success)' : pct > 0 ? 'var(--accent)' : 'var(--border)';
  return '<svg class="gs-ring" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
    '<circle cx="' + cx + '" cy="' + cx + '" r="' + r + '" fill="none" stroke="var(--border)" stroke-width="3"/>' +
    '<circle cx="' + cx + '" cy="' + cx + '" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="3" ' +
      'stroke-dasharray="' + circ.toFixed(1) + '" stroke-dashoffset="' + offset.toFixed(1) + '" ' +
      'stroke-linecap="round" transform="rotate(-90 ' + cx + ' ' + cx + ')"/>' +
    '<text x="' + cx + '" y="' + cx + '" text-anchor="middle" dy="0.35em" font-size="15" font-weight="600" fill="var(--muted)">' + pct + '</text>' +
    '</svg>';
}

// ── Main render ──

function buildGantt(data) {
  var stages = (data && data.stages) ? data.stages : (Array.isArray(data) ? data : []);
  _lastGanttStages = stages;  // store for gotoStageDetail
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

  var today = fmtLocalDate();
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
    var prog = parseFloat(s.progress) || 0;
    var tasksDone = s.tasks_done || 0;
    var tasksTotal = s.tasks_total || 0;

    // Stage name
    var nameEl = '<button class="gs-btn" title="跳转到任务详情" onclick="gotoStageDetail(' + i + ');event.stopPropagation()">' + escHtml(s.name) + '</button>';

    // Risk tag — PMA stages are all standard, no missing/unmatched/fuzzy
    var risk = getStageRisk(s);
    var riskHtml = '<span class="risk-tag" style="--risk-color:' + risk.color + '" title="' + escHtml(risk.tip) + '">' + escHtml(risk.label) + '</span>';

    // Bar — use dates if available, otherwise full-width progress
    var hasDates = s.start && s.end;
    var lp = hasDates ? ganttPx(s.start, range, totalWidth) : 0;
    var ep = hasDates ? ganttPx(s.end, range, totalWidth) : totalWidth;
    var wp = Math.max(4, ep - lp);
    var barCls = 'gantt-bar ' + (s.status || 'active') + (isStageOverdue(s) ? ' gantt-overdue' : '') + (tasksTotal === 0 ? ' gantt-empty' : '');
    var barHtml = '<div class="' + barCls + '" style="left:' + lp + 'px;width:' + wp + 'px" data-tip="' +
      (hasDates ? compactDate(s.start) + '→' + compactDate(s.end) + '　' : '') +
      '任务:' + tasksDone + '/' + tasksTotal + '">' +
      '<div class="gantt-bar-fill" style="width:' + prog + '%"></div>' +
    '</div>';

    return '<div class="gantt-row' + alt + '" id="gantt-row-' + i + '">' +
      '<div class="gantt-stage-cell">' +
        nameEl +
        '<div class="gs-risk">' + riskHtml + '</div>' +
        '<div class="gs-prog">' + renderProgressRing(prog) + '</div>' +
        '<div class="gs-who">' + escHtml((s.who || '—').split('（')[0].split('、')[0]) + '</div>' +
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
  var stageList = (stages && stages.stages) ? stages.stages : stages;
  var tbody = document.getElementById('stages-tbody');
  if (!tbody) return;  // stages section removed — data now shown in task detail tab

  if (!stageList || !stageList.length) {
    tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state">暂无阶段数据</div></td></tr>';
    return;
  }

  tbody.innerHTML = stageList.map(function(s, i) {
    var dels = s.deliverables || [];
    var taskCount = s.task_count || 0;
    var risk = getStageRisk(s);
    var prog = parseFloat(s.progress) || 0;
    var progHtml = prog !== null && prog !== undefined ? renderProgressRing(prog) : '<span style="color:var(--muted)">—</span>';

    return '<tr id="stage-row-' + i + '">' +
      '<td><strong>' + escHtml(s.name) + '</strong>' +
        (taskCount ? ' <span style="font-size:10px;color:var(--muted)">' + taskCount + '个任务</span>' : '') +
      '</td>' +
      '<td><span class="risk-tag" style="--risk-color:' + risk.color + '" title="' + escHtml(risk.tip) + '">' + escHtml(risk.label) + '</span></td>' +
      '<td>' + progHtml + '</td>' +
      '<td><span style="font-size:12px;color:var(--muted)">—</span></td>' +
      '<td><span style="font-size:11.5px;color:var(--muted);white-space:nowrap;line-height:1.8">—</span></td>' +
      '<td><span class="pill" style="background:var(--accent-lt);color:var(--accent)">标准阶段</span></td>' +
      '<td><span style="font-size:12px;color:var(--muted)">—</span></td>' +
      '<td>' + renderDeliverablesList(dels) + '</td>' +
    '</tr>';
  }).join('');
}

/* Documents Table */

function buildDocs(data) {
  var user = getCurrentUser();
  var perms = (user && user.permissions) ? user.permissions.split(',') : [];
  var canEdit = perms.indexOf('doc_template') >= 0 || perms.indexOf('admin') >= 0 || perms.indexOf('project_edit') >= 0;

  // New format: { documents: [...], standard_stages: [...] }
  var stageList = (data && data.documents) ? data.documents : data;
  if (!stageList || !stageList.length) {
    document.getElementById('docs-tbody').innerHTML = '<tr><td colspan="6"><div style="text-align:center;padding:30px;font-style:italic;color:var(--muted)">暂无文档清单<br><span style="font-size:11px">项目阶段尚未匹配到文档模板，请先配置文档模板</span></div></td></tr>';
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

    // Stage name display — no Zentao execution dependency
    var stageNameHtml = '<span style="font-weight:540;font-size:12px">' + escHtml(stageName) + '</span>';

    if (!hasDocs) {
      // No documents for this stage yet
      rows += '<tr style="background:' + bg + ';opacity:0.5">' +
        '<td style="vertical-align:middle;font-weight:540;border-right:1px solid var(--border)">' + stageNameHtml + '</td>' +
        '<td colspan="6" style="color:var(--muted);font-style:italic;font-size:12px">暂无文档</td>' +
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
          '<td style="white-space:nowrap;text-align:center">' +
            (d.location && isPreviewableUrl(d.location)
              ? iconEye('previewDocument(\'' + encodeURIComponent(d.location) + '\',\'' + escJs(d.doc_name || '') + '\')')
              : '') +
          '</td>' +
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
    await API.put('/projects/' + _comboCurCode + '/documents/' + docId, body);
    showToast(status === 'submitted' ? '已标记为提交' : '状态已更新', 'success');
    cancelDocEdit();
    // Refresh documents tab
    var docs = await API.get('/projects/' + _comboCurCode + '/documents');
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
  var perms = (user && user.permissions) ? user.permissions.split(',') : [];
  var canEdit = perms.indexOf('doc_template') >= 0 || perms.indexOf('admin') >= 0 || perms.indexOf('project_edit') >= 0;

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
      sectionHeader('交付记录明细', records.length + ' 条', '+ 添加记录', 'showDeliveryForm()') +
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
          '<td><button class="btn btn-xs" style="color:var(--danger)" onclick="deleteDeliveryRecord(' + r.id + ')">删除</button></td>' +
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
    await API.put('/projects/' + _comboCurCode + '/delivery-plan', {
      planned_delivery_qty: qty,
      delivery_note: note
    });
    showToast('交付计划已保存', 'success');
    // Refresh delivery data
    var data = await API.get('/projects/' + _comboCurCode + '/delivery');
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
    var label = (p.code ? p.code + ' ' : '') + p.name;
    return '<option value="' + escHtml(p.name) + '"' + sel + '>' + escHtml(label) + '</option>';
  }).join('');
  if (!prodOptions) prodOptions = '<option value="">— 无关联产品 —</option>';
  if (r.product_name && products.length === 0) {
    var rLabel = (p && p.code ? p.code + ' ' : '') + r.product_name;
    prodOptions = '<option value="' + escHtml(r.product_name) + '" selected>' + escHtml(rLabel) + '</option>';
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
        '<div><label style="font-size:11px;color:var(--muted)">交付日期</label><input class="search-inp" id="df-date" type="date" value="' + (r.date || fmtLocalDate()) + '" style="margin-top:4px"></div>' +
        '<div><label style="font-size:11px;color:var(--muted)">交付责任人（PMA用户）</label>' + _selectHtml('df-responsible', _userNames, r.responsible_person || '') + '</div>' +
        '<div><label style="font-size:11px;color:var(--muted)">收货方（客户）</label>' + _selectHtml('df-receiver', _customerNames, r.receiver || '') + '</div>' +
      '</div>' +
      '<div style="margin-bottom:10px">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">' +
          '<label style="font-size:11px;color:var(--muted)">产品编号（每行一个）</label>' +
          '<button class="btn btn-xs" onclick="addSerialRow()">+ 添加编号</button>' +
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
      await API.post('/delivery/projects/' + _comboCurCode + '/records', body);
    }
    showToast(recordId ? '修改成功' : '添加成功', 'success');
    cancelDeliveryForm();
    var data = await API.get('/projects/' + _comboCurCode + '/delivery');
    buildDelivery(data);
  } catch(e) {
    showToast('操作失败: ' + (e.message || '未知错误'), 'error');
    btns.forEach(function(b) { b.disabled = false; });
  }
}

async function deleteDeliveryRecord(id) {
  if (!confirm('确认删除此交付记录？')) return;
  var ok = await verifyPassword('删除交付记录 #' + id, 'pw_verify_delete_delivery');
  if (!ok) return;
  try {
    await API.del('/delivery/records/' + id);
    showToast('删除成功', 'success');
    var data = await API.get('/projects/' + _comboCurCode + '/delivery');
    buildDelivery(data);
  } catch(e) {
    showToast('删除失败: ' + (e.message || '未知错误'), 'error');
  }
}

/* Resources */

function buildResources(resources, detail) {
  var products = (detail && detail.linked_products) || (detail && detail.products) || [];

  var html = '<div class="card" style="padding:20px">' +
    '<div class="section-title" style="margin-bottom:14px">关联产品文档</div>' +
    '<div style="font-size:12px;color:var(--muted);margin-bottom:16px">以下为本项目关联的产品，点击可查看各产品的文档齐套情况。</div>';

  if (products.length) {
    products.forEach(function(prod) {
      html += '<div class="card prod-doc-card" onclick="openProductDetail(\'' + escHtml(prod.code || String(prod.id)).replace(/'/g, "\\'") + '\', \'docs\')" title="' + escHtml(prod.name || '') + '">' +
        '<span style="font-size:12px;font-weight:600;font-family:var(--mono);color:var(--accent);margin-bottom:2px">' + escHtml(prod.code || '#' + prod.id) + '</span>' +
        '<span style="font-size:11px;color:var(--muted);line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHtml(prod.name) + '</span>' +
      '</div>';
    });
  } else {
    html += '<div style="font-size:12px;color:var(--muted);font-style:italic;padding:12px 0">暂无关联产品</div>';
  }

  html += '</div>';

  document.getElementById('resources-content').innerHTML = html;
}

/* Notes */

function buildNotes(notes) {
  var container = document.getElementById('notes-content');
  var tableHtml;
  var currentUser = (getCurrentUser() || {}).username || '';
  if (notes && notes.length) {
    tableHtml = '<div class="table-scroll"><table class="stage-table"><thead><tr>' +
      '<th style="width:140px">记录时间</th><th style="width:90px">涉及阶段</th><th style="width:70px">记录人</th><th>内容</th><th style="width:90px">操作</th>' +
    '</tr></thead><tbody>';
    notes.forEach(function(n) {
      var isMine = n.recorded_by === currentUser;
      var isReply = !!n.parent_id;
      var hasImage = /!\[.*\]\(.*\)/.test(n.content);
      var plainText = stripHtml(renderMarkdown ? renderMarkdown(n.content) : n.content).substring(0, 80);
      var actions = '';
      actions += '<span style="cursor:pointer;font-size:12px;color:var(--accent);margin-right:4px" onclick="openViewNoteDialog(' + n.id + ')" title="查看">👁</span>';
      if (isMine) {
        actions += iconEdit('openEditNoteDialog(' + n.id + ')', '编辑') +
                   iconDelete('deleteProjectNote(' + n.id + ')', '删除');
      } else {
        actions += '<span style="cursor:pointer;font-size:12px;color:var(--accent)" onclick="openReplyNoteDialog(' + n.id + ')" title="回复">💬</span>';
      }
      var indentStyle = isReply ? 'padding-left:28px;border-left:3px solid var(--accent-lt)' : '';
      var replyMark = isReply ? '<span style="font-size:10px;color:var(--accent);margin-right:4px">↳ 回复</span>' : '';
      var imgBadge = hasImage ? ' <span style="font-size:10px">📷</span>' : '';
      var timeCell = (n.created_at || '') + (n.updated_at ? '<div style="font-size:9px;color:var(--warn)">编辑过</div>' : '');
      tableHtml += '<tr style="' + indentStyle + '">' +
        '<td style="font-size:11px;font-family:var(--mono);color:var(--muted);white-space:nowrap">' + timeCell + '</td>' +
        '<td style="font-size:12px">' + escHtml(n.stage_name || '项目整体') + '</td>' +
        '<td style="font-size:12.5px;font-weight:540">' + escHtml(n.recorded_by || '') + '</td>' +
        '<td style="font-size:13px;line-height:1.5;text-align:left">' + replyMark + escHtml(plainText) + (n.content.length > 80 ? '...' : '') + imgBadge + '</td>' +
        '<td style="white-space:nowrap">' + actions + '</td>' +
      '</tr>';
    });
    tableHtml += '</tbody></table></div>';
  } else {
    tableHtml = '<div class="empty-state" style="padding:12px">暂无笔记</div>';
  }

  container.innerHTML = tableHtml;
}

async function openNoteDialog() {
  if (!_comboCurCode) return;

  // Fetch stages for the selector
  _clearNoteImagePreviews('note-dialog-input-img-preview');
  var stagesHtml = '<option value="">请选择阶段...</option>';
  try {
    var result = await API.get('/projects/' + _comboCurCode + '/stages');
    var stages = (result && result.stages) ? result.stages : [];
    if (stages.length) {
      stages.forEach(function(s) {
        stagesHtml += '<option value="' + escHtml(s.name) + '">' + escHtml(s.name) + '</option>';
      });
    }
  } catch(e) { /* ignore, just show project-level option */ }

  var overlay = document.createElement('div');
  overlay.className = 'note-dialog-overlay';
  overlay.innerHTML = '<div class="note-dialog" style="width:80vw;max-width:80vw;max-height:90vh;overflow-y:auto">' +
    '<div class="note-dialog-head">' +
      '<span class="note-dialog-title">添加项目笔记</span>' +
      '<button class="note-dialog-close" onclick="closeNoteDialog()">&times;</button>' +
    '</div>' +
    '<div style="margin-bottom:10px">' +
      '<label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px">涉及阶段</label>' +
      '<select id="note-dialog-stage" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--fg);font-size:13px;box-sizing:border-box">' + stagesHtml + '</select>' +
    '</div>' +
    '<textarea id="note-dialog-input" style="width:100%;min-height:60px;height:auto;max-height:30vh;box-sizing:border-box;padding:10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--fg);font-size:13px;resize:vertical;font-family:var(--font)" placeholder="记录项目关键信息：会议纪要、采购问题、交付调整等..."></textarea>' +
    '<div style="font-size:10px;color:var(--muted);margin-top:2px">支持粘贴图片 (Ctrl+V)和大小调整</div>' +
    '<div id="note-dialog-input-img-preview" style="margin-top:4px;min-height:0;max-height:50vh;overflow-y:auto"></div>' +
    '<div style="display:flex;justify-content:flex-end;align-items:center;gap:10px;margin-top:12px">' +
      '<span id="note-dialog-msg" style="font-size:11px"></span>' +
      '<button class="btn" onclick="closeNoteDialog()" style="font-size:12px">取消</button>' +
      '<button class="btn btn-primary" onclick="submitNote()" style="font-size:12px">保存</button>' +
    '</div>' +
  '</div>';
  document.body.appendChild(overlay);
  setTimeout(function() {
    var inp = document.getElementById('note-dialog-input');
    if (inp) { inp.focus(); }
    initNoteImagePaste('note-dialog-input');
  }, 100);
}

function closeNoteDialog() {
  var overlay = document.querySelector('.note-dialog-overlay');
  if (overlay) overlay.remove();
}

/* ── View Note Dialog ── */

function openViewNoteDialog(noteId) {
  if (!_comboCurCode) return;
  API.get('/projects/' + _comboCurCode + '/notes').then(function(result) {
    var notes = (result && result.length) ? result : [];
    var note = notes.find(function(n) { return n.id === noteId; });
    if (!note) { showToast('笔记不存在', 'error'); return; }
    // Pre-process custom image size syntax: ![](url =Wx) → <img>
    var content = note.content.replace(/!\[\]\((\/api\/note-images\/[^) ]+)\s*=(\d+)x\)/g, '<img src="$1" style="width:$2px;max-width:100%">');
    var contentHtml = (typeof renderMarkdown === 'function') ? renderMarkdown(content) : '<pre>' + escHtml(content) + '</pre>';
    var dialog = document.createElement('div');
    dialog.className = 'note-dialog-overlay';
    dialog.innerHTML = '<div class="note-dialog" style="max-width:75vw;width:75vw">' +
      '<div class="note-dialog-head">' +
        '<span class="note-dialog-title">查看笔记</span>' +
        '<button class="note-dialog-close" onclick="this.closest(\'.note-dialog-overlay\').remove()">&times;</button>' +
      '</div>' +
      '<div style="margin-bottom:8px;display:flex;gap:16px;font-size:11px;color:var(--muted)">' +
        '<span>阶段: ' + escHtml(note.stage_name || '项目整体') + '</span>' +
        '<span>作者: ' + escHtml(note.recorded_by || '') + '</span>' +
        '<span>时间: ' + escHtml(note.created_at || '') + (note.updated_at ? ' (编辑过)' : '') + '</span>' +
      '</div>' +
      '<div style="max-height:70vh;overflow-y:auto;padding:12px;background:var(--bg);border-radius:8px;font-size:13px;line-height:1.7" class="markdown-body">' + contentHtml + '</div>' +
      '<div style="display:flex;justify-content:flex-end;margin-top:12px">' +
        '<button class="btn" onclick="this.closest(\'.note-dialog-overlay\').remove()">关闭</button>' +
      '</div>' +
    '</div>';
    document.body.appendChild(dialog);
  });
}

/* Edit / Reply / Delete notes */

function openEditNoteDialog(noteId) {
  if (!_comboCurCode) return;
  _clearNoteImagePreviews('edit-note-content-img-preview');
  API.get('/projects/' + _comboCurCode + '/notes').then(function(result) {
    var notes = (result && result.length) ? result : [];
    var note = notes.find(function(n) { return n.id === noteId; });
    if (!note) { showToast('笔记不存在', 'error'); return; }
    // Load existing images into preview
    setTimeout(function() { _loadExistingNoteImages(note.content, 'edit-note-content-img-preview'); }, 150);
    var stagesHtml = '<option value="">请选择阶段...</option>';
    // Re-fetch stages for the dropdown
    API.get('/projects/' + _comboCurCode + '/stages').then(function(r) {
      var stages = (r && r.stages) ? r.stages : [];
      stages.forEach(function(s) {
        var sel = s.name === note.stage_name ? ' selected' : '';
        stagesHtml += '<option value="' + escHtml(s.name) + '"' + sel + '>' + escHtml(s.name) + '</option>';
      });
      openDialog('编辑项目笔记',
        '<div style="margin-bottom:10px">' +
          '<label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px">涉及阶段</label>' +
          '<select id="edit-note-stage" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--fg);font-size:13px;box-sizing:border-box">' + stagesHtml + '</select>' +
        '</div>' +
        '<textarea id="edit-note-content" style="width:100%;min-height:60px;height:auto;max-height:30vh;box-sizing:border-box;padding:10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--fg);font-size:13px;resize:vertical;font-family:var(--font)">' + escHtml(note.content) + '</textarea>' +
        '<div style="font-size:10px;color:var(--muted);margin-top:2px">支持粘贴图片 (Ctrl+V)和大小调整</div>' +
        '<div id="edit-note-content-img-preview" style="margin-top:4px;min-height:0;max-height:50vh;overflow-y:auto"></div>',
        [{text: '取消', onclick: 'closeSharedDialog()'},
         {text: '保存', cls: 'btn-primary', onclick: 'saveEditNote(' + noteId + ')'}],
        {maxWidth: '80vw', maxHeight: '90vh', hideClose: true});
    setTimeout(function() { initNoteImagePaste('edit-note-content'); }, 100);
    });
  });
}

async function saveEditNote(noteId) {
  var content = document.getElementById('edit-note-content').value.trim();
  var stage = document.getElementById('edit-note-stage').value;
  if (!content) { showToast('请输入内容', 'error'); return; }
  content = await _uploadNoteImages(content);
  closeSharedDialog();
  try {
    await API.put('/projects/' + _comboCurCode + '/notes/' + noteId, {content: content, stage_name: stage});
    showToast('已更新', 'success');
    var notes = await API.get('/projects/' + _comboCurCode + '/notes');
    buildNotes(notes || []);
  } catch(e) { showToast('编辑失败: ' + (e.message || ''), 'error'); }
}

function openReplyNoteDialog(parentId) {
  if (!_comboCurCode) return;
  _clearNoteImagePreviews('reply-note-content-img-preview');
  // Fetch parent note for context
  API.get('/projects/' + _comboCurCode + '/notes').then(function(result) {
    var notes = (result && result.length) ? result : [];
    var parent = notes.find(function(n) { return n.id === parentId; });
    if (!parent) { showToast('笔记不存在', 'error'); return; }
    var stageLabel = parent.stage_name || '项目整体';
    openDialog('回复笔记',
      '<div style="margin-bottom:8px;padding:8px 12px;background:var(--bg);border-radius:6px;font-size:11px;color:var(--muted)">' +
        '回复 <b>' + escHtml(parent.recorded_by) + '</b> 的笔记（' + escHtml(stageLabel) + '）<br>' +
        '<span style="color:var(--fg)">' + escHtml(parent.content.substring(0, 80)) + (parent.content.length > 80 ? '...' : '') + '</span>' +
      '</div>' +
      '<textarea id="reply-note-content" style="width:100%;min-height:60px;height:auto;max-height:30vh;box-sizing:border-box;padding:10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--fg);font-size:13px;resize:vertical;font-family:var(--font)" placeholder="输入回复..."></textarea>' +
      '<div style="font-size:10px;color:var(--muted);margin-top:2px">支持粘贴图片 (Ctrl+V)和大小调整</div>' +
      '<div id="reply-note-content-img-preview" style="margin-top:4px;min-height:0;max-height:50vh;overflow-y:auto"></div>',
      [{text: '取消', onclick: 'closeSharedDialog()'},
       {text: '回复', cls: 'btn-primary', onclick: 'submitReplyNote(' + parentId + ',\'' + escHtml(stageLabel).replace(/'/g, "\\'") + '\')'}],
      {maxWidth: '80vw', maxHeight: '90vh', hideClose: true});
    setTimeout(function() { initNoteImagePaste('reply-note-content'); }, 100);
  });
}

async function submitReplyNote(parentId, stageName) {
  var content = document.getElementById('reply-note-content').value.trim();
  if (!content) { showToast('请输入回复内容', 'error'); return; }
  content = await _uploadNoteImages(content);
  closeSharedDialog();
  try {
    await API.post('/projects/' + _comboCurCode + '/notes', {content: content, stage_name: stageName, parent_id: parentId});
    showToast('已回复', 'success');
    var notes = await API.get('/projects/' + _comboCurCode + '/notes');
    buildNotes(notes || []);
  } catch(e) { showToast('回复失败: ' + (e.message || ''), 'error'); }
}

async function deleteProjectNote(noteId) {
  if (!confirm('确认删除此笔记？（有回复的笔记不能删除）')) return;
  try {
    await API.del('/projects/' + _comboCurCode + '/notes/' + noteId);
    showToast('已删除', 'success');
    var notes = await API.get('/projects/' + _comboCurCode + '/notes');
    buildNotes(notes || []);
  } catch(e) { showToast('删除失败: ' + (e.message || ''), 'error'); }
}

async function submitNote() {
  var inp = document.getElementById('note-dialog-input');
  var sel = document.getElementById('note-dialog-stage');
  var msg = document.getElementById('note-dialog-msg');
  var content = inp.value.trim();
  if (!content) return;
  var stage = sel ? sel.value : '';
  if (!stage) { msg.innerHTML = '<span style="color:var(--danger)">请选择涉及阶段</span>'; return; }
  if (!_comboCurCode) return;

  content = await _uploadNoteImages(content);
  try {
    msg.innerHTML = '<span style="color:var(--muted)">保存中...</span>';
    await API.post('/projects/' + _comboCurCode + '/notes', { content: content, stage_name: stage });
    closeNoteDialog();
    var notes = await API.get('/projects/' + _comboCurCode + '/notes');
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
  // Refresh tab content when switching to it
  if (id === 'maintenance') buildMaintenance();
  if (id === 'activities') loadActivities();
  if (id === 'pma-tasks' && _comboCurCode) {
    var projName = (document.getElementById('combo-input') || {}).value || '';
    if (!projName && typeof _allProjects !== 'undefined') {
      var p = _allProjects.find(function(x) { return x.id == _comboCurCode; });
      if (p) projName = p.name;
    }
    if (typeof initProjectTasks === 'function') {
      initProjectTasks(_comboCurCode, projName);
    } else if (typeof loadViewScript === 'function') {
      loadViewScript('/js/tasks.js?v=250630', function() { initProjectTasks(_comboCurCode, projName); });
    }
  }
  // Update hash to reflect current tab (replace: don't add history entry per tab switch)
  if (_comboCurCode && typeof buildHash === 'function') {
    history.replaceState({ view: 'detail', params: [String(_comboCurCode), id] }, '', buildHash('detail', String(_comboCurCode), id));
  }
}

function gotoStageDetail(idx) {
  var stages = _lastGanttStages;
  if (!stages || !stages[idx]) return;
  var stageName = stages[idx].standard_stage || stages[idx].name;
  if (!stageName) return;
  _scrollToStageTasks(stageName);
}

/* Jump to stage tasks from maintenance page (or any page) — reuse scroll+flash logic */
function gotoStageTasksFromMaint(stageName) {
  if (!stageName) return;
  switchDTab('pma-tasks');
  _scrollToStageTasks(stageName);
}

function _scrollToStageTasks(stageName) {
  switchDTab('pma-tasks');
  var tries = 0;
  var doScroll = function() {
    var rows = document.querySelectorAll('.task-stage-row[data-stage="' + stageName + '"]');
    if (rows.length) {
      document.querySelectorAll('.stage-row-flash').forEach(function(r) { r.classList.remove('stage-row-flash'); });
      var flashCount = 0;
      var maxFlashes = 6;
      var flashInterval = setInterval(function() {
        rows.forEach(function(r) { r.classList.toggle('stage-row-flash'); });
        if (++flashCount >= maxFlashes) clearInterval(flashInterval);
      }, 500);
      rows[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (++tries < 30) {
      setTimeout(doScroll, 200);
    }
  };
  setTimeout(doScroll, 200);
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
    await API.put('/projects/' + _comboCurCode + '/stages/' + _mismatchExecId + '/sync-to-zentao', { stage_name: name });
    showToast('PMA 映射已保存（请在禅道中手动修改执行名）', 'success');
    var dlg = document.querySelector('.stage-mismatch-dialog-overlay');
    if (dlg) dlg.remove();
    _mismatchExecId = null;
    var p = await Promise.all([
      API.get('/projects/' + _comboCurCode + '/stages'),
      API.get('/projects/' + _comboCurCode + '/documents'),
    ]);
    buildStages(p[0]);
    buildDocs(p[1]);
  } catch(e) {
    showToast('保存失败: ' + (e.message || '未知错误'), 'error');
  }
}

/* ── Project Maintenance ── */

function buildMaintenance() {
  if (!_comboCurCode) return;
  var user = getCurrentUser();
  var perms = (user && user.permissions) ? user.permissions.split(',') : [];
  var hasPerm = perms.indexOf('project_edit') >= 0 || perms.indexOf('admin') >= 0;
  var dt = document.getElementById('dt-maintenance');
  if (dt) dt.style.display = hasPerm ? '' : 'none';
  if (!hasPerm) return;

  // Render edit/delete action buttons
  var actions = document.getElementById('maint-actions');
  if (actions) {
    actions.innerHTML =
      '<button class="btn btn-primary" style="font-size:11px;padding:5px 12px" onclick="showProjectEditDialog()">✎ 编辑项目</button>' +
      '<button class="btn" style="font-size:11px;padding:5px 12px;color:var(--danger);border-color:var(--danger)" onclick="deleteCurrentProject()">✕ 删除项目</button>';
  }

  loadMaintProjectProducts();
  loadMaintProjectCustomers();
  loadMaintProjectTags();
  loadMaintProjectStages();
}

// ── Project Edit Dialog ──

function showProjectEditDialog() {
  var p = _projDetail;
  if (!p) return;

  // Load all dropdown options in parallel
  Promise.all([
    API.get('/users/pm-names').catch(function() { return []; }),
    API.get('/users/customers/names').catch(function() { return []; }),
    API.get('/users/program-names').catch(function() { return []; }),
    API.get('/tags').catch(function() { return []; }),
    API.get('/users/project-options').catch(function() { return []; }),
  ]).then(function(results) {
    var pmNames = results[0] || [];
    var custNames = results[1] || [];
    var progNames = results[2] || [];
    var allTags = results[3] || [];
    var projectOpts = results[4] || [];

    var tagNames = allTags.filter(function(t) { return t.category === 'project' || !t.category || t.category === ''; }).map(function(t) { return t.name; });

    function dl(id, options, selected) {
      var sel = selected || '';
      return '<div style="position:relative">' +
        '<input class="search-inp" id="' + id + '" list="' + id + '-list" value="' + escHtml(sel) + '" style="width:100%;box-sizing:border-box;padding-right:28px" autocomplete="off" placeholder="输入搜索或选择...">' +
        '<span style="position:absolute;right:10px;top:50%;transform:translateY(-50%);pointer-events:none;color:var(--muted);font-size:10px">▼</span>' +
        '<datalist id="' + id + '-list">' + options.map(function(o) {
          var val = typeof o === 'string' ? o : o.name;
          return '<option value="' + escHtml(val) + '">';
        }).join('') + '</datalist></div>';
    }

    function dlIdName(id, options, selectedId) {
      // For linked projects: show "name (id)" as option value, store id separately
      var sel = selectedId || '';
      return '<input class="search-inp" id="' + id + '" list="' + id + '-list" value="' + escHtml(sel) + '" style="width:100%;box-sizing:border-box" autocomplete="off">' +
        '<datalist id="' + id + '-list">' + options.map(function(o) {
          return '<option value="' + escHtml(o.name + ' (' + o.id + ')') + '">';
        }).join('') + '</datalist>';
    }

    // Build project options for linked projects datalist
    var linkedProjOpts = projectOpts.map(function(o) {
      return o.name + ' (' + o.id + ')';
    });
    var rawStatus = p.raw_status || p.status || '';

    var bodyHtml =
      '<div style="margin-bottom:10px"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">项目名称</label>' +
      '<input class="search-inp" id="proj-edit-name" value="' + escHtml(p.name || '') + '" style="width:100%;box-sizing:border-box"></div>' +
      '<div style="margin-bottom:10px"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">项目编号</label>' +
      '<input class="search-inp" id="proj-edit-code" value="' + escHtml(p.code || '') + '" style="width:100%;box-sizing:border-box"></div>' +
      '<div style="margin-bottom:10px"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">项目经理</label>' +
      dl('proj-edit-pm-name', pmNames, p.pm_name) + '</div>' +
      '<div style="margin-bottom:10px"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">客户名称</label>' +
      dl('proj-edit-customer', custNames, p.customer_name) + '</div>' +
      '<div style="display:flex;gap:10px;margin-bottom:10px">' +
        '<div style="flex:1"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">项目类型</label>' +
          '<select class="search-inp" id="proj-edit-type" style="width:100%;box-sizing:border-box">' +
            Object.keys(TYPE_TXT).map(function(k) {
              return '<option value="' + k + '"' + (p.project_type === k ? ' selected' : '') + '>' + TYPE_TXT[k] + '</option>';
            }).join('') +
          '</select></div>' +
        '<div style="flex:1"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">状态</label>' +
          '<select class="search-inp" id="proj-edit-status" style="width:100%;box-sizing:border-box">' +
            '<option value="">不修改</option>' +
            '<option value="wait"' + (rawStatus === 'wait' ? ' selected' : '') + '>待启动</option>' +
            '<option value="doing"' + (rawStatus === 'doing' ? ' selected' : '') + '>进行中</option>' +
            '<option value="done"' + (rawStatus === 'done' ? ' selected' : '') + '>已完成</option>' +
            '<option value="closed"' + (rawStatus === 'closed' ? ' selected' : '') + '>已关闭</option>' +
            '<option value="suspended"' + (rawStatus === 'suspended' ? ' selected' : '') + '>已挂起</option>' +
          '</select></div>' +
      '</div>' +
      '<div style="display:flex;gap:10px;margin-bottom:10px">' +
        '<div style="flex:1"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">计划开始</label>' +
          '<input class="search-inp" id="proj-edit-begin" type="date" value="' + (p.begin || '') + '" style="width:100%;box-sizing:border-box"></div>' +
        '<div style="flex:1"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">计划结束</label>' +
          '<input class="search-inp" id="proj-edit-end" type="date" value="' + (p.end || '') + '" style="width:100%;box-sizing:border-box"></div>' +
      '</div>' +
      '<div style="display:flex;gap:10px;margin-bottom:10px">' +
        '<div style="flex:1"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">实际开始</label>' +
          '<input class="search-inp" id="proj-edit-real-began" type="date" value="' + (p.real_began || '') + '" style="width:100%;box-sizing:border-box"></div>' +
        '<div style="flex:1"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">实际结束</label>' +
          '<input class="search-inp" id="proj-edit-real-end" type="date" value="' + (p.real_end || '') + '" style="width:100%;box-sizing:border-box"></div>' +
      '</div>' +
      '<div style="margin-bottom:10px"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">项目集</label>' +
      dl('proj-edit-program', progNames, p.program_name) + '</div>' +
      '<div style="display:flex;gap:10px;margin-bottom:10px">' +
        '<div style="flex:1"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">进度 (%)</label>' +
          '<input class="search-inp" id="proj-edit-progress" value="' + escHtml(p.progress || '') + '" style="width:100%;box-sizing:border-box"></div>' +
        '<div style="flex:1"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">预估工时</label>' +
          '<input class="search-inp" id="proj-edit-estimate" type="number" value="' + (p.estimate != null ? p.estimate : '') + '" style="width:100%;box-sizing:border-box"></div>' +
      '</div>' +
      '<div style="display:flex;gap:10px;margin-bottom:10px">' +
        '<div style="flex:1"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">已耗工时</label>' +
          '<input class="search-inp" id="proj-edit-consumed" type="number" value="' + (p.consumed != null ? p.consumed : '') + '" style="width:100%;box-sizing:border-box"></div>' +
        '<div style="flex:1"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">计划交付数</label>' +
          '<input class="search-inp" id="proj-edit-delivery-qty" type="number" value="' + (p.planned_delivery_qty != null ? p.planned_delivery_qty : '') + '" style="width:100%;box-sizing:border-box"></div>' +
      '</div>' +
      '<div style="margin-bottom:10px"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">交付备注</label>' +
      '<input class="search-inp" id="proj-edit-delivery-note" value="' + escHtml(p.delivery_note || '') + '" style="width:100%;box-sizing:border-box"></div>' +
      '<div style="margin-bottom:10px"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">项目背景</label>' +
      '<textarea class="search-inp" id="proj-edit-background" rows="3" style="width:100%;box-sizing:border-box;resize:vertical">' + escHtml(p.background || '') + '</textarea></div>' +
      '<div style="margin-bottom:10px"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">标签（逗号分隔）</label>' +
      dl('proj-edit-tags', tagNames, p.tags) + '</div>' +
      '<div style="margin-bottom:4px"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">关联项目（搜索选择，逗号分隔ID）</label>' +
      dl('proj-edit-linked', linkedProjOpts, p.linked_project_ids) + '</div>';

    openDialog('编辑项目 — ' + escHtml(p.name || ''),
      '<div style="max-height:65vh;overflow-y:auto;padding-right:4px">' + bodyHtml + '</div>',
      [
        { text: '取消', onclick: 'closeSharedDialog()' },
        { text: '保存', cls: 'btn-primary', onclick: 'saveProjectEdit()' }
      ],
      { hideClose: true }
    );
  });
}

async function saveProjectEdit() {
  var payload = {};
  var g = function(id) { return document.getElementById(id); };

  payload.project_type = g('proj-edit-type').value;
  var statusVal = g('proj-edit-status').value;
  if (statusVal) payload.status = statusVal;

  var textFields = ['proj-edit-name','proj-edit-code','proj-edit-pm-name',
    'proj-edit-customer','proj-edit-program','proj-edit-progress','proj-edit-delivery-note',
    'proj-edit-background','proj-edit-tags','proj-edit-linked'];
  var keyMap = {
    'proj-edit-name': 'name', 'proj-edit-code': 'code',
    'proj-edit-pm-name': 'pm_name',
    'proj-edit-customer': 'customer_name', 'proj-edit-program': 'program_name',
    'proj-edit-progress': 'progress', 'proj-edit-delivery-note': 'delivery_note',
    'proj-edit-background': 'background', 'proj-edit-tags': 'tags',
    'proj-edit-linked': 'linked_project_ids'
  };
  textFields.forEach(function(fid) {
    var el = g(fid);
    if (el) payload[keyMap[fid]] = el.value;
  });

  var numFields = ['proj-edit-estimate','proj-edit-consumed','proj-edit-delivery-qty'];
  var numKeys = { 'proj-edit-estimate': 'estimate', 'proj-edit-consumed': 'consumed', 'proj-edit-delivery-qty': 'planned_delivery_qty' };
  numFields.forEach(function(fid) {
    var el = g(fid);
    if (el && el.value !== '') payload[numKeys[fid]] = parseFloat(el.value);
  });

  var dateFields = ['proj-edit-begin','proj-edit-end','proj-edit-real-began','proj-edit-real-end'];
  var dateKeys = { 'proj-edit-begin': 'begin', 'proj-edit-end': 'end', 'proj-edit-real-began': 'real_began', 'proj-edit-real-end': 'real_end' };
  dateFields.forEach(function(fid) {
    var el = g(fid);
    if (el && el.value) payload[dateKeys[fid]] = el.value;
  });

  try {
    var result = await API.put('/projects/' + _comboCurCode, payload);
    closeSharedDialog();
    showToast(result.message || '项目已更新', 'success');
    loadProjectDetail(_comboCurCode);
  } catch(e) {
    showToast('保存失败: ' + (e.message || '未知错误'), 'error');
  }
}

// ── Project Delete ──

async function deleteCurrentProject() {
  var p = _projDetail;
  if (!p) return;
  if (!confirm('确认删除项目「' + (p.name || '') + '」？\n\n此操作将同时删除：\n- 项目所有执行/迭代/任务\n- 项目文档实例\n- 项目笔记\n- 关联产品/客户/标签\n- 交付记录\n- 操作活动记录\n\n此操作不可撤销！')) return;
  var ok = await verifyPassword('删除项目: ' + (p.name || ''), 'pw_verify_maint_remove');
  if (!ok) return;
  try {
    await API.del('/projects/' + _comboCurCode);
    showToast('项目已删除', 'success');
    // Navigate back to project list
    if (typeof gotoView === 'function') {
      gotoView('project-list');
    } else {
      location.reload();
    }
  } catch(e) {
    showToast('删除失败: ' + (e.message || '未知错误'), 'error');
  }
}

// ── Shared section renderer (badges + edit button only) ──

function _renderMaintSection(containerId, hdId, linked, idKey, labelKey, type, labelName) {
  var container = document.getElementById(containerId);
  var hd = document.getElementById(hdId);

  var chipClass = type === 'prod' ? 'prod-link-chip' : (type === 'cust' ? 'cust-badge' : 'proj-code-btn');
  var clickFn = type === 'prod' ? 'openProductDetail' : (type === 'cust' ? 'openCustomerByName' : '');
  var clickArg = type === 'prod' ? 'code' : (type === 'cust' ? labelKey : idKey);
  var badgesHtml = linked.length ? linked.map(function(x) {
    var onClick = clickFn ? ' onclick="event.stopPropagation();' + clickFn + '(\''+escHtml(x[clickArg]).replace(/'/g,"\\'")+'\')"' : '';
    var displayLabel = (type === 'prod' && x.code) ? escHtml(x.code) : escHtml(x[labelKey]);
    var tooltip = (type === 'prod' && x.code) ? escHtml(x[labelKey]) : '查看详情';
    return '<span class="'+chipClass+'"' + onClick + ' title="' + tooltip + '">' + displayLabel + '</span>' +
      ' <span onclick="maintRemove_' + type + '(' + x[idKey] + ')" style="cursor:pointer;opacity:0.5;font-size:14px" title="移除">&times;</span>';
  }).join('') : '<span style="font-size:12px;color:var(--muted)">暂无' + labelName + '</span>';

  // Section header: replace entire element to avoid nested section-hd
  if (hd) {
    hd.outerHTML = sectionHeader(labelName, linked.length, '编辑' + labelName, 'maintOpenDialog_' + type + '()', hdId);
  }

  // Card body: badges only
  container.innerHTML = '<div style="display:flex;flex-wrap:wrap;gap:6px">' + badgesHtml + '</div>';
}

// ── Dialog helpers ──

// ── Products ──

var _maintLinkedProds = [];
var _maintAllProds = [];

async function loadMaintProjectProducts() {
  try {
    var linked = await API.get('/maintenance/projects/' + _comboCurCode + '/products');
    _maintLinkedProds = linked || [];
    var all = await API.get('/products?limit=200');
    _maintAllProds = (all.items || []).map(function(p) { return {id: p.id, name: p.name, code: p.code}; });
    _renderMaintSection('maint-proj-products', 'maint-hd-products', _maintLinkedProds, 'id', 'name', 'prod', '关联产品');
  } catch(e) {
    document.getElementById('maint-proj-products').innerHTML = '<div class="error-state">加载失败</div>';
  }
}

function maintOpenDialog_prod() {
  var linkedIds = (_maintLinkedProds || []).map(function(p) { return p.id; });
  multiSelectDialog('编辑关联产品', _maintAllProds, linkedIds, {
    placeholder: '搜索产品...', maxWidth: 550,
    renderItem: function(item, selected) {
      return (item.code ? '<span style="font-size:11px;padding:1px 6px;border-radius:4px;background:var(--accent-lt);color:var(--accent);font-family:var(--mono);margin-right:6px;white-space:nowrap">' + escHtml(item.code) + '</span>' : '') +
        '<span>' + escHtml(item.name) + '</span>';
    }
  }, function(ids) {
    API.put('/maintenance/projects/' + _comboCurCode + '/products', { ids: ids }).then(function() { loadMaintProjectProducts(); });
  });
}

function maintRemove_prod(pid) {
  var prod = _maintLinkedProds.find(function(p) { return p.id === pid; });
  var name = prod ? (prod.name || '') : '';
  verifyPassword('移除产品关联: ' + name, 'pw_verify_maint_remove').then(function(ok) {
    if (!ok) return;
    var ids = _maintLinkedProds.map(function(p) { return p.id; }).filter(function(id) { return id !== pid; });
    API.put('/maintenance/projects/' + _comboCurCode + '/products', { ids: ids }).then(function() { loadMaintProjectProducts(); });
  });
}

// ── Customers ──

var _maintLinkedCustomers = [];
var _maintAllCustomers = [];

async function loadMaintProjectCustomers() {
  try {
    var linked = await API.get('/maintenance/projects/' + _comboCurCode + '/customers');
    _maintLinkedCustomers = linked || [];
    var all = await API.get('/customers');
    _maintAllCustomers = (all || []).map(function(c) { return {id: c.id, name: c.name}; });
    _renderMaintSection('maint-proj-customers', 'maint-hd-customers', _maintLinkedCustomers, 'id', 'name', 'cust', '关联客户');
  } catch(e) {
    document.getElementById('maint-proj-customers').innerHTML = '<div class="error-state">加载失败</div>';
  }
}

function maintOpenDialog_cust() {
  var linkedIds = (_maintLinkedCustomers || []).map(function(c) { return c.id; });
  multiSelectDialog('编辑关联客户', _maintAllCustomers, linkedIds, {
    placeholder: '搜索客户...', maxWidth: 450
  }, function(ids) {
    API.put('/maintenance/projects/' + _comboCurCode + '/customers', { ids: ids }).then(function() { loadMaintProjectCustomers(); });
  });
}

function maintRemove_cust(cid) {
  var cust = _maintLinkedCustomers.find(function(c) { return c.id === cid; });
  var name = cust ? (cust.name || '') : '';
  verifyPassword('移除客户关联: ' + name, 'pw_verify_maint_remove').then(function(ok) {
    if (!ok) return;
    var ids = _maintLinkedCustomers.map(function(c) { return c.id; }).filter(function(id) { return id !== cid; });
    API.put('/maintenance/projects/' + _comboCurCode + '/customers', { ids: ids }).then(function() { loadMaintProjectCustomers(); });
  });
}

// ── Tags ──

var _maintLinkedTags = [];
var _maintAllTags = [];
var _maintAllTagsFull = [];

async function loadMaintProjectTags() {
  try {
    var linked = await API.get('/maintenance/projects/' + _comboCurCode + '/tags');
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
  var hd = document.getElementById('maint-hd-tags');
  var linkedNames = _maintLinkedTags.slice();

  var badgesHtml = linkedNames.length ? linkedNames.map(function(name) {
    var cls = 'tag-' + (name.length % 5);
    return '<span class="tag-badge ' + cls + '" style="font-size:12px;padding:3px 12px;display:inline-flex;align-items:center;gap:4px">' +
      '#' + escHtml(name) +
      ' <span data-tag-name="' + escHtml(name) + '" onclick="maintRemove_tag(this.getAttribute(\'data-tag-name\'))" style="cursor:pointer;opacity:0.5;font-size:14px;line-height:1" title="移除">&times;</span></span>';
  }).join('') : '<span style="font-size:12px;color:var(--muted)">暂无标签</span>';

  // Section header: replace entire element to avoid nested section-hd
  if (hd) {
    hd.outerHTML = sectionHeader('项目标签', linkedNames.length, '编辑标签', 'maintOpenDialog_tag()', 'maint-hd-tags');
  }

  // Card body: badges only
  container.innerHTML = '<div style="display:flex;flex-wrap:wrap;gap:6px">' + badgesHtml + '</div>';
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
    await API.put('/maintenance/projects/' + _comboCurCode + '/tags', { tags: linkedNames });
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
  API.put('/maintenance/projects/' + _comboCurCode + '/tags', { tags: tags }).then(function() { loadMaintProjectTags(); });
}

/* ── Add Stage Dialog ── */

function openAddStageDialog() {
  if (!_comboCurCode) { showToast('请先选择项目', 'error'); return; }
  var inp = 'width:100%;box-sizing:border-box;margin-top:1px';
  var lbl = 'font-size:11px;color:var(--muted);display:block;margin-bottom:2px';
  var row2 = 'display:grid;grid-template-columns:1fr 1fr;gap:10px';
  _stgOwnerId = null;

  openDialog('添加阶段',
    '<div style="max-height:60vh;overflow-y:auto;padding-right:4px">' +
      '<div style="margin-bottom:10px"><label style="' + lbl + '">阶段名称 *</label>' +
        '<input class="search-inp" id="add-stg-name" style="' + inp + '" placeholder="输入阶段名称..."></div>' +
      '<div style="' + row2 + '">' +
        '<div><label style="' + lbl + '">计划开始</label><input class="search-inp" id="add-stg-start" type="date" style="' + inp + '"></div>' +
        '<div><label style="' + lbl + '">计划结束</label><input class="search-inp" id="add-stg-end" type="date" style="' + inp + '"></div>' +
      '</div>' +
      '<div style="margin-bottom:10px"><label style="' + lbl + '">责任人</label><div style="margin-top:2px">' +
        createUserCombo({
          comboId: 'add-stg-owner-combo', inputId: 'add-stg-owner-input', dropdownId: 'add-stg-owner-dropdown',
          selectedIdFn: function() { return _stgOwnerId; },
          onSelect: function(u) { _stgOwnerId = u.id; }
        }) + '</div></div>' +
      '<div style="margin-bottom:4px"><label style="' + lbl + '">备注</label>' +
        '<textarea class="search-inp" id="add-stg-desc" rows="2" style="width:100%;box-sizing:border-box;resize:vertical"></textarea></div>' +
    '</div>',
    [{text: '取消', onclick: 'closeSharedDialog()'},
     {text: '添加', cls: 'btn-primary', onclick: 'submitAddStage()'}],
    {maxWidth: '520px', hideClose: true});
}

async function submitAddStage() {
  var name = document.getElementById('add-stg-name').value.trim();
  if (!name) { showToast('请输入阶段名称', 'error'); return; }
  var data = {
    name: name,
    start_date: document.getElementById('add-stg-start').value || null,
    end_date: document.getElementById('add-stg-end').value || null,
    owner_id: _stgOwnerId || null,
    description: document.getElementById('add-stg-desc').value.trim() || null,
  };
  closeSharedDialog();
  try {
    await API.post('/projects/' + _comboCurCode + '/stages', data);
    showToast('阶段已添加', 'success');
    loadMaintProjectStages();
  } catch(e) { showToast('添加失败: ' + (e.message || ''), 'error'); }
}

/* ── Stage Edit Dialog (shared between maintenance tab and task tab) ── */

function openStageDialog(stageId) {
  var projectCode = _comboCurCode;
  if (!projectCode) { showToast('项目信息缺失', 'error'); return; }
  API.get('/projects/' + projectCode + '/stages').then(function(result) {
    var stages = (result && result.stages) ? result.stages : [];
    var stage = null;
    for (var i = 0; i < stages.length; i++) {
      if (stages[i].id === stageId) { stage = stages[i]; break; }
    }
    if (!stage) { showToast('阶段不存在', 'error'); return; }
    _showStageDialog(stage, projectCode);
  }).catch(function(e) {
    showToast('加载阶段失败: ' + (e.message || ''), 'error');
  });
}

var _stgOwnerId = null;

function _showStageDialog(stage, projectCode) {
  var inp = 'width:100%;box-sizing:border-box;margin-top:1px';
  var lbl = 'font-size:11px;color:var(--muted);display:block;margin-bottom:2px';
  var row2 = 'display:grid;grid-template-columns:1fr 1fr;gap:10px';

  _stgOwnerId = stage.owner_id || null;

  var bodyHtml = '<div style="max-height:65vh;overflow-y:auto;padding-right:4px">' +
    '<div style="margin-bottom:10px"><label style="' + lbl + '">阶段名称</label>' +
      '<input class="search-inp" id="stg-name" value="' + escHtml(stage.name || '') + '" style="' + inp + '"></div>' +
    '<div style="' + row2 + '">' +
      '<div><label style="' + lbl + '">计划开始</label><input class="search-inp" id="stg-start" type="date" value="' + (stage.start || '') + '" style="' + inp + '"></div>' +
      '<div><label style="' + lbl + '">计划结束</label><input class="search-inp" id="stg-end" type="date" value="' + (stage.end || '') + '" style="' + inp + '"></div>' +
    '</div>' +
    '<div style="' + row2 + '">' +
      '<div><label style="' + lbl + '">状态</label>' +
        '<select class="search-inp" id="stg-status" style="' + inp + '">' +
          '<option value="active"' + (stage.status === 'active' ? ' selected' : '') + '>进行中</option>' +
          '<option value="completed"' + (stage.status === 'completed' ? ' selected' : '') + '>已完成</option>' +
          '<option value="blocked"' + (stage.status === 'blocked' ? ' selected' : '') + '>已阻塞</option>' +
        '</select></div>' +
      '<div><label style="' + lbl + '">责任人</label><div style="margin-top:2px">' +
        createUserCombo({
          comboId: 'stg-owner-combo', inputId: 'stg-owner-input', dropdownId: 'stg-owner-dropdown',
          selectedIdFn: function() { return _stgOwnerId; },
          onSelect: function(u) { _stgOwnerId = u.id; }
        }) + '</div></div>' +
    '</div>' +
    '<div style="margin-bottom:10px"><label style="' + lbl + '">备注</label>' +
      '<textarea class="search-inp" id="stg-desc" rows="2" style="width:100%;box-sizing:border-box;resize:vertical">' + escHtml(stage.description || '') + '</textarea></div>' +
    '<div style="font-size:11px;color:var(--muted);margin-top:8px">' +
      '任务数量: ' + (stage.task_count || 0) + ' | 进度: ' + (stage.progress || 0) + '% | 完成: ' + (stage.tasks_done || 0) +
    '</div>' +
  '</div>';

  openDialog('编辑阶段 — ' + escHtml(stage.name), bodyHtml,
    [{text: '取消', onclick: 'closeSharedDialog()'},
     {text: '保存', cls: 'btn-primary', onclick: 'saveStageData(' + stage.id + ',\'' + escHtml(projectCode).replace(/'/g, "\\'") + '\')'}],
    {maxWidth: '520px', hideClose: true});
}

async function saveStageData(stageId, projectCode) {
  var data = {
    name: document.getElementById('stg-name').value.trim(),
    start_date: document.getElementById('stg-start').value || null,
    end_date: document.getElementById('stg-end').value || null,
    status: document.getElementById('stg-status').value,
    owner_id: _stgOwnerId || null,
    description: document.getElementById('stg-desc').value.trim() || null,
  };
  if (!data.name) { showToast('请输入阶段名称', 'error'); return; }
  closeSharedDialog();
  try {
    await API.put('/projects/' + projectCode + '/stages/' + stageId, data);
    showToast('阶段已更新', 'success');
    // Refresh Gantt chart
    try {
      var ganttData = await API.get('/projects/' + projectCode + '/gantt');
      if (typeof buildGantt === 'function') buildGantt(ganttData);
    } catch(e) { /* non-critical */ }
    // Refresh maintenance stage list
    loadMaintProjectStages();
    // Refresh task table if loaded
    if (typeof loadTaskData === 'function') loadTaskData();
  } catch(e) { showToast('保存失败: ' + (e.message || ''), 'error'); }
}

/* ── Maintenance: Project Stages ── */

var _maintAllStages = [];  // all stages for current project

async function deleteMaintStage(stageId, stageName) {
  if (!_comboCurCode) return;
  var ok = await verifyPassword('删除阶段: ' + stageName, 'pw_verify_stage_delete');
  if (!ok) return;
  try {
    await API.del('/projects/' + _comboCurCode + '/stages/' + stageId);
    showToast('阶段「' + stageName + '」已删除', 'success');
    loadMaintProjectStages();
  } catch(e) { showToast('删除失败: ' + (e.message || ''), 'error'); }
}

function loadMaintProjectStages() {
  var container = document.getElementById('maint-proj-stages');
  if (!_comboCurCode) { if (container) container.innerHTML = '<div class="empty-state" style="padding:12px">请选择项目</div>'; return; }

  // Update section header with add button
  var hd = document.getElementById('maint-hd-stages');
  if (hd) hd.outerHTML = sectionHeader('阶段信息', null, '添加阶段', 'openAddStageDialog()', 'maint-hd-stages');

  container.innerHTML = '<div class="loading-spinner">加载中...</div>';
  API.get('/projects/' + _comboCurCode + '/stages').then(function(result) {
    var stages = (result && result.stages) ? result.stages : [];
    _maintAllStages = stages;
    _renderMaintStages(stages, container);
  }).catch(function(e) {
    container.innerHTML = '<div class="empty-state" style="padding:12px;color:var(--danger)">加载失败: ' + (e.message || '') + '</div>';
  });
}

function _renderMaintStages(stages, container) {
  if (!stages.length) {
    container.innerHTML = '<div class="empty-state" style="padding:12px">暂无阶段数据 — 请在任务详情页点击"初始化阶段"按钮</div>';
    return;
  }

  var riskLabels = { active: '进行中', completed: '已完成', blocked: '已阻塞' };
  var html = '<table class="proj-table" style="width:100%"><thead><tr>' +
    '<th style="width:5%">#</th>' +
    '<th style="width:16%">阶段名称</th>' +
    '<th style="width:10%">状态</th>' +
    '<th style="width:10%">责任人</th>' +
    '<th style="width:12%">计划开始</th>' +
    '<th style="width:12%">计划结束</th>' +
    '<th style="width:7%">任务数</th>' +
    '<th style="width:7%">进度</th>' +
    '<th style="width:8%">完成日期</th>' +
    '<th>操作</th>' +
    '</tr></thead><tbody>';

  stages.forEach(function(s, i) {
    var riskLabel = riskLabels[s.status] || s.status || '进行中';
    var riskColor = s.status === 'blocked' ? 'var(--danger)' : (s.status === 'completed' ? 'var(--success)' : 'var(--accent)');
    var ownerName = s.owner_name || s.who || '—';
    var startStr = s.start || '—';
    var endStr = s.end || '—';
    var taskCount = s.task_count || 0;
    var progress = s.progress || 0;
    var completedDate = s.completed_date || '—';

    html += '<tr>' +
      '<td style="text-align:center;color:var(--muted)">' + (i + 1) + '</td>' +
      '<td style="font-weight:500">' + escHtml(s.name) + '</td>' +
      '<td><span style="font-size:11px;padding:2px 8px;border-radius:10px;background:' + riskColor + '15;color:' + riskColor + ';font-weight:500">' + escHtml(riskLabel) + '</span></td>' +
      '<td style="font-size:12px">' + escHtml(ownerName) + '</td>' +
      '<td style="font-size:12px">' + escHtml(startStr) + '</td>' +
      '<td style="font-size:12px">' + escHtml(endStr) + '</td>' +
      '<td style="text-align:center;cursor:pointer;color:var(--accent);font-weight:500" onclick="gotoStageTasksFromMaint(\'' + escHtml(s.name).replace(/'/g, "\\'") + '\')" title="跳转到任务详情">' + taskCount + '</td>' +
      '<td style="text-align:center;cursor:pointer" onclick="gotoStageTasksFromMaint(\'' + escHtml(s.name).replace(/'/g, "\\'") + '\')" title="跳转到任务详情">' + (typeof renderProgressRing === 'function' ? '<div style="display:inline-block">' + renderProgressRing(progress) + '</div>' : progress + '%') + '</td>' +
      '<td style="font-size:12px">' + escHtml(completedDate) + '</td>' +
      '<td style="white-space:nowrap">' +
        (s.id ? iconEdit('openStageDialog(' + s.id + ')', '编辑阶段') + iconDelete('deleteMaintStage(' + s.id + ',\'' + escHtml(s.name).replace(/'/g, "\\'") + '\')', '删除阶段') : '') +
      '</td>' +
    '</tr>';
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

/* ── Project Activities (进度明细) ── */

var _activitySort = 'desc';
var _activityFilterUser = '';
var _activityFilterAction = '';
var _activityOptions = null;  // {usernames: [...], actions: [...]}

async function loadActivities() {
  var container = document.getElementById('activities-content');
  container.innerHTML = '<div class="loading-spinner">加载活动记录...</div>';
  try {
    var params = 'sort=' + _activitySort + '&limit=200';
    if (_activityFilterUser) params += '&username=' + encodeURIComponent(_activityFilterUser);
    if (_activityFilterAction) params += '&action=' + encodeURIComponent(_activityFilterAction);
    var resp = await API.get('/projects/' + _comboCurCode + '/activities?' + params);
    var items = resp && resp.items ? resp.items : (Array.isArray(resp) ? resp : []);
    var opts = resp && resp.options ? resp.options : null;
    buildActivities(items, opts);
  } catch(e) {
    container.innerHTML = '<div class="error-state">加载失败: ' + escHtml(e.message) + '</div>';
  }
}

function buildActivities(items, opts) {
  var container = document.getElementById('activities-content');

  // Keep filter options for dropdowns
  if (opts) _activityOptions = opts;

  // Filter badge (when active)
  var filterBadge = '';
  if (_activityFilterUser || _activityFilterAction) {
    filterBadge = '<div style="margin-bottom:8px">' +
      '<span class="activity-filter-badge">' +
      '筛选: ' + [_activityFilterUser, _activityFilterAction].filter(Boolean).join(' + ') +
      ' <a href="javascript:void(0)" onclick="clearActivityFilters()" style="color:var(--danger);text-decoration:none;margin-left:4px">✕</a>' +
      '</span></div>';
  }

  // Sort indicator
  var sortIcon = '<span id="act-sort-ind" style="color:var(--muted)">⇅</span>';

  // Build filter dropdowns for header
  var userOpts = (_activityOptions && _activityOptions.usernames) ? _activityOptions.usernames : [];
  var userFilter = '<select id="act-filter-user" onchange="onActivityFilterUser(this.value)" class="activity-header-filter">' +
    '<option value="">全部</option>';
  userOpts.forEach(function(u) {
    userFilter += '<option value="' + escHtml(u) + '"' + (_activityFilterUser === u ? ' selected' : '') + '>' + escHtml(u) + '</option>';
  });
  userFilter += '</select>';

  var actionOpts = (_activityOptions && _activityOptions.actions) ? _activityOptions.actions : [];
  var actionFilter = '<select id="act-filter-action" onchange="onActivityFilterAction(this.value)" class="activity-header-filter">' +
    '<option value="">全部</option>';
  actionOpts.forEach(function(a) {
    actionFilter += '<option value="' + escHtml(a) + '"' + (_activityFilterAction === a ? ' selected' : '') + '>' + escHtml(a) + '</option>';
  });
  actionFilter += '</select>';

  if (!items || !items.length) {
    container.innerHTML = filterBadge + '<div class="empty-state" style="padding:20px">暂无活动记录</div>';
    return;
  }

  var html = filterBadge;
  html += '<div class="table-scroll" style="max-height:calc(100vh - 330px)">';
  html += '<table class="stage-table activity-table">';
  html += '<thead><tr>' +
    '<th style="cursor:pointer;user-select:none;white-space:nowrap" onclick="toggleActivitySort()">时间 ' + sortIcon + '</th>' +
    '<th style="white-space:nowrap">用户名 ' + userFilter + '</th>' +
    '<th style="white-space:nowrap">操作类型 ' + actionFilter + '</th>' +
    '<th>具体明细</th>' +
    '</tr></thead><tbody>';

  items.forEach(function(a) {
    var time = (a.created_at || '').replace('T', ' ');
    html += '<tr>' +
      '<td class="act-td-time">' + escHtml(time) + '</td>' +
      '<td class="act-td-user">' + escHtml(a.username) + '</td>' +
      '<td style="white-space:nowrap"><span class="activity-action pill">' + escHtml(a.action) + '</span></td>' +
      '<td class="act-td-detail">' + (a.detail ? escHtml(a.detail) : '') + '</td>' +
      '</tr>';
  });

  html += '</tbody></table></div>';
  container.innerHTML = html;

  // Update sort indicator after render
  updateActivitySortInd();
}

function updateActivitySortInd() {
  var si = document.getElementById('act-sort-ind');
  if (!si) return;
  if (_activitySort === 'asc') { si.textContent = '▲'; si.style.color = ''; }
  else if (_activitySort === 'desc') { si.textContent = '▼'; si.style.color = ''; }
  else { si.textContent = '⇅'; si.style.color = 'var(--muted)'; }
}

function toggleActivitySort() {
  _activitySort = _activitySort === 'desc' ? 'asc' : 'desc';
  loadActivities();
}

function onActivityFilterUser(val) {
  _activityFilterUser = val || '';
  loadActivities();
}

function onActivityFilterAction(val) {
  _activityFilterAction = val || '';
  loadActivities();
}

function clearActivityFilters() {
  _activityFilterUser = '';
  _activityFilterAction = '';
  loadActivities();
}
