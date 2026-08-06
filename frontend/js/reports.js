/* ═══════════════════════════════════════════════════
   REPORTS VIEW — Phase 3d
   Weekly / Monthly / Bug Stats
═══════════════════════════════════════════════════ */

var _reportTab = 'weekly';

async function renderReports() {
  await Promise.all([
    loadReportWeekly(),
    loadReportMonthly(),
    loadBugStats(),
  ]);
  switchReportTab(_reportTab);
}

function switchReportTab(tab) {
  _reportTab = tab;
  document.querySelectorAll('.rpt-tab').forEach(function(t) { t.classList.remove('active'); });
  var el = document.getElementById('rpttab-' + tab);
  if (el) el.classList.add('active');

  var sections = ['weekly', 'monthly', 'bugs'];
  sections.forEach(function(s) {
    var sec = document.getElementById('rpt-sec-' + s);
    if (sec) sec.style.display = s === tab ? 'block' : 'none';
  });
}

/* ── Weekly Report ── */

async function loadReportWeekly() {
  var container = document.getElementById('rpt-sec-weekly');
  container.innerHTML = '<div class="loading-spinner">加载周报...</div>';
  try {
    var data = await API.get('/reports/weekly');
    container.innerHTML =
      '<div class="section-title" style="margin-bottom:14px">周报 ' + escHtml(data.period) + '</div>' +
      '<div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">' +
        '<div class="kpi-card"><div class="kpi-label">本周完成任务</div><div class="kpi-value" style="color:var(--success)">' + data.tasks_completed + '</div></div>' +
        '<div class="kpi-card"><div class="kpi-label">新增Bug</div><div class="kpi-value" style="color:var(--warn)">' + data.new_bugs + '</div></div>' +
        '<div class="kpi-card"><div class="kpi-label">已解决Bug</div><div class="kpi-value" style="color:var(--accent)">' + data.resolved_bugs + '</div></div>' +
        '<div class="kpi-card"><div class="kpi-label">本周交付量</div><div class="kpi-value" style="color:var(--success)">' + data.delivery_quantity + ' 台</div></div>' +
      '</div>' +
      (data.active_stages && data.active_stages.length ?
        '<div class="card" style="padding:16px;margin-top:14px"><div class="section-title" style="margin-bottom:10px">进行中阶段</div>' +
        data.active_stages.map(function(s) {
          return '<div style="padding:4px 0;font-size:13px;color:var(--fg)">' + escHtml(s.name) + ' <span style="font-size:11px;color:var(--muted)">(项目#' + s.project_id + ')</span></div>';
        }).join('') + '</div>' : '') +
      '<div style="font-size:11px;color:var(--muted);margin-top:10px">生成时间: ' + data.generated_at + '</div>';
  } catch(e) {
    container.innerHTML = '<div class="error-state">加载周报失败: ' + escHtml(e.message) + '</div>';
  }
}

/* ── Monthly Report ── */

async function loadReportMonthly() {
  var container = document.getElementById('rpt-sec-monthly');
  container.innerHTML = '<div class="loading-spinner">加载月报...</div>';
  try {
    var data = await API.get('/reports/monthly');
    var s = data.summary || {};

    container.innerHTML =
      '<div class="section-title" style="margin-bottom:14px">月报 ' + escHtml(data.period) + '</div>' +
      '<div class="kpi-grid" style="grid-template-columns:repeat(5,1fr);margin-bottom:16px">' +
        '<div class="kpi-card"><div class="kpi-label">项目总数</div><div class="kpi-value" style="font-size:26px">' + s.total + '</div><div class="kpi-meta">' + Object.keys(s.type_all || {}).sort().map(function(t) { return getProjectTypeLabel(t) + s.type_all[t]; }).join(' · ') + '</div></div>' +
        '<div class="kpi-card"><div class="kpi-label">进行中</div><div class="kpi-value" style="font-size:26px;color:var(--accent)">' + s.active + '</div></div>' +
        '<div class="kpi-card"><div class="kpi-label">本月完成任务</div><div class="kpi-value" style="font-size:26px;color:var(--success)">' + data.tasks_completed_this_month + '</div></div>' +
        '<div class="kpi-card"><div class="kpi-label">新增/解决Bug</div><div class="kpi-value" style="font-size:26px;color:var(--warn)">' + data.new_bugs_this_month + '<span style="font-size:16px;color:var(--muted)">/' + data.resolved_bugs_this_month + '</span></div></div>' +
        '<div class="kpi-card"><div class="kpi-label">本月交付</div><div class="kpi-value" style="font-size:26px;color:var(--success)">' + data.delivery_quantity_this_month + ' 台</div></div>' +
      '</div>' +
      '<div class="card" style="padding:0;margin-bottom:16px"><div id="rpt-monthly-table"></div></div>' +
      '<div style="font-size:11px;color:var(--muted)">生成时间: ' + data.generated_at + '</div>';

    new DataTable({
      container: document.getElementById('rpt-monthly-table'),
      columns: [
        { key: 'name', title: '项目', render: function(v, row) { return '<span style="font-family:var(--mono);font-size:11.5px;color:var(--accent)">' + escHtml(row.code||'') + '</span> ' + escHtml(v||''); } },
        { key: 'status', title: '状态', render: function(v) { return renderPill(v); } },
        { key: 'progress', title: '进度', render: function(v) { return '<span style="font-variant-numeric:tabular-nums">' + (v||0) + '%</span>'; } },
        { key: 'tasks_info', title: '任务(完成/总数)', render: function(v, row) { return '<span style="font-variant-numeric:tabular-nums">' + (row.tasks_done||0) + '/' + (row.tasks_total||0) + '</span>'; } }
      ],
      data: data.projects || [],
    });
  } catch(e) {
    container.innerHTML = '<div class="error-state">加载月报失败: ' + escHtml(e.message) + '</div>';
  }
}

/* ── Bug Stats ── */

async function loadBugStats() {
  var container = document.getElementById('rpt-sec-bugs');
  container.innerHTML = '<div class="loading-spinner">加载Bug统计...</div>';
  try {
    var data = await API.get('/dashboard/bugs');
    var stats = data.stats || {};
    var bugs = data.bugs || [];

    var sevHtml = Object.keys(stats.by_severity || {}).map(function(k) {
      return '<div class="kpi-card" style="padding:12px 14px"><div class="kpi-label" style="margin-bottom:4px">' + k + '</div><div class="kpi-value" style="font-size:22px">' + stats.by_severity[k] + '</div></div>';
    }).join('');


    container.innerHTML =
      '<div class="section-title" style="margin-bottom:14px">Bug 统计</div>' +
      '<div class="kpi-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:16px">' +
        '<div class="kpi-card"><div class="kpi-label">Bug总数</div><div class="kpi-value" style="font-size:26px">' + (stats.total || 0) + '</div></div>' +
        '<div class="kpi-card"><div class="kpi-label">未解决</div><div class="kpi-value" style="font-size:26px;color:var(--danger)">' + (stats.open || 0) + '</div></div>' +
        '<div class="kpi-card"><div class="kpi-label">已解决</div><div class="kpi-value" style="font-size:26px;color:var(--accent)">' + (stats.resolved || 0) + '</div></div>' +
        '<div class="kpi-card"><div class="kpi-label">近30天新增</div><div class="kpi-value" style="font-size:26px;color:var(--warn)">' + (stats.recent_30d || 0) + '</div></div>' +
      '</div>' +
      '<div class="kpi-grid" style="grid-template-columns:repeat(' + Object.keys(stats.by_severity || {}).length + ',1fr);margin-bottom:16px">' + sevHtml + '</div>' +
      '<div class="card" style="padding:0"><div id="rpt-bugs-table"></div></div>';

    if (bugs.length) {
      new DataTable({
        container: document.getElementById('rpt-bugs-table'),
        columns: [
          { key: 'severity_label', title: '严重度', width: '60px', render: function(v, row) { var sc = {1:'var(--danger)',2:'var(--warn)',3:'var(--accent)',4:'var(--muted)'}; return '<span style="font-size:10px;padding:1px 5px;border-radius:3px;background:'+(sc[row.severity]||'var(--bg)')+'20;color:'+(sc[row.severity]||'var(--fg)')+';font-weight:600">'+escHtml(v||'')+'</span>'; } },
          { key: 'title', title: '标题', align: 'left', render: function(v) { return '<span style="font-size:12.5px">'+escHtml(v||'')+'</span>'; } },
          { key: 'status', title: '状态', width: '80px', render: function(v) { return renderPill(v); } },
          { key: 'assigned_to', title: '指派', width: '90px', render: function(v) { return '<span style="font-size:11.5px;color:var(--muted)">'+escHtml(v||'')+'</span>'; } },
          { key: 'opened_date', title: '创建日期', width: '100px', render: function(v) { return '<span style="font-size:11.5px;font-family:var(--mono);color:var(--muted)">'+formatDate(v)+'</span>'; } }
        ],
        data: bugs,
      });
    }
  } catch(e) {
    container.innerHTML = '<div class="error-state">加载Bug统计失败: ' + escHtml(e.message) + '</div>';
  }
}
