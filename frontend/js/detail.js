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
        '<div class="combo-opt-meta">' + escHtml(p.code) + ' · ' + typeTxt + '项目 · ' + escHtml(p.status || '') + '</div>' +
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
    document.getElementById('combo-input').value = custName + '  (' + p.code + ')';
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

function buildGantt(stages) {
  var now = new Date(), cy = now.getFullYear(), cm = now.getMonth() + 1;
  var mHdrs = '', gCols = '';
  for (var y = 2025; y <= 2026; y++) {
    for (var m = 1; m <= 12; m++) {
      var isc = (y === cy && m === cm);
      var lbl = m === 1 ? y + '/' + m : m + '月';
      mHdrs += '<div class="gantt-mon' + (isc ? ' today-col' : '') + '">' + lbl + '</div>';
      gCols += '<div class="gantt-grid-col"></div>';
    }
  }
  var tp = todayPct();

  if (!stages || !stages.length) {
    document.getElementById('gantt-root').innerHTML =
      '<div class="gantt-head-row"><div class="gantt-label-col">阶段 / 负责人</div><div class="gantt-timeline-head">' + mHdrs + '</div></div>' +
      '<div class="gantt-row"><div class="gantt-stage-cell" style="width:100%;text-align:center;color:var(--muted);padding:20px">暂无阶段数据</div></div>';
    return;
  }

  var rows = stages.map(function(s, i) {
    var lp = d2pct(s.start), rp = d2pct(s.end), wp = Math.max(1, rp - lp);
    var alt = i % 2 === 1 ? ' stage-alt' : '';
    return '<div class="gantt-row' + alt + '">' +
      '<div class="gantt-stage-cell">' +
        '<div class="gantt-stage-name">' + escHtml(s.name) + '</div>' +
        '<div class="gantt-stage-who">' + escHtml((s.who || '').split('（')[0]) + '</div>' +
      '</div>' +
      '<div class="gantt-bar-cell">' +
        '<div class="gantt-grid">' + gCols + '</div>' +
        '<div class="gantt-today-line" style="left:' + tp + '%"><div class="gantt-today-pip"></div></div>' +
        '<div class="gantt-bar ' + s.status + '" style="left:calc(' + lp + '% + 3px);width:calc(' + wp + '% - 6px)" title="' + escHtml(s.name) + '  ' + s.start + ' → ' + s.end + '">' + (wp > 5 ? s.name : '') + '</div>' +
      '</div>' +
    '</div>';
  }).join('');

  document.getElementById('gantt-root').innerHTML =
    '<div class="gantt-head-row">' +
      '<div class="gantt-label-col">阶段 / 负责人</div>' +
      '<div class="gantt-timeline-head">' + mHdrs + '</div>' +
    '</div>' + rows;
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
