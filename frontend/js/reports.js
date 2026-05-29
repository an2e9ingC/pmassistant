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
    var projRows = (data.projects || []).map(function(p) {
      return '<tr>' +
        '<td><span style="font-family:var(--mono);font-size:11.5px;color:var(--accent)">' + escHtml(p.code || '#' + p.id) + '</span> ' + escHtml(p.name) + '</td>' +
        '<td>' + renderPill(p.status) + '</td>' +
        '<td style="font-variant-numeric:tabular-nums">' + p.progress + '%</td>' +
        '<td style="font-variant-numeric:tabular-nums">' + p.tasks_done + '/' + p.tasks_total + '</td>' +
      '</tr>';
    }).join('');

    container.innerHTML =
      '<div class="section-title" style="margin-bottom:14px">月报 ' + escHtml(data.period) + '</div>' +
      '<div class="kpi-grid" style="grid-template-columns:repeat(5,1fr);margin-bottom:16px">' +
        '<div class="kpi-card"><div class="kpi-label">项目总数</div><div class="kpi-value" style="font-size:26px">' + s.total + '</div><div class="kpi-meta">研发' + s.rd_count + ' · 生产' + s.sc_count + '</div></div>' +
        '<div class="kpi-card"><div class="kpi-label">进行中</div><div class="kpi-value" style="font-size:26px;color:var(--accent)">' + s.active + '</div></div>' +
        '<div class="kpi-card"><div class="kpi-label">本月完成任务</div><div class="kpi-value" style="font-size:26px;color:var(--success)">' + data.tasks_completed_this_month + '</div></div>' +
        '<div class="kpi-card"><div class="kpi-label">新增/解决Bug</div><div class="kpi-value" style="font-size:26px;color:var(--warn)">' + data.new_bugs_this_month + '<span style="font-size:16px;color:var(--muted)">/' + data.resolved_bugs_this_month + '</span></div></div>' +
        '<div class="kpi-card"><div class="kpi-label">本月交付</div><div class="kpi-value" style="font-size:26px;color:var(--success)">' + data.delivery_quantity_this_month + ' 台</div></div>' +
      '</div>' +
      '<div class="card" style="overflow:hidden;margin-bottom:16px">' +
        '<table class="proj-table"><thead><tr><th>项目</th><th>状态</th><th>进度</th><th>任务(完成/总数)</th></tr></thead><tbody>' + projRows + '</tbody></table>' +
      '</div>' +
      '<div style="font-size:11px;color:var(--muted)">生成时间: ' + data.generated_at + '</div>';
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

    var bugRows = bugs.map(function(b) {
      var sevColors = {1:'var(--danger)',2:'var(--warn)',3:'var(--accent)',4:'var(--muted)'};
      return '<tr>' +
        '<td><span style="font-size:10px;padding:1px 5px;border-radius:3px;background:' + (sevColors[b.severity] || 'var(--bg)') + '20;color:' + (sevColors[b.severity] || 'var(--fg)') + ';font-weight:600">' + escHtml(b.severity_label) + '</span></td>' +
        '<td style="font-size:12.5px">' + escHtml(b.title) + '</td>' +
        '<td>' + renderPill(b.status) + '</td>' +
        '<td style="font-size:11.5px;color:var(--muted)">' + escHtml(b.assigned_to || '') + '</td>' +
        '<td style="font-size:11.5px;font-family:var(--mono);color:var(--muted)">' + formatDate(b.opened_date) + '</td>' +
      '</tr>';
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
      '<div class="card" style="overflow:hidden">' +
        '<table class="proj-table"><thead><tr><th style="width:60px">严重度</th><th>标题</th><th style="width:80px">状态</th><th style="width:90px">指派</th><th style="width:100px">创建日期</th></tr></thead><tbody>' + (bugRows || '<tr><td colspan="5"><div class="empty-state">暂无Bug数据</div></td></tr>') + '</tbody></table>' +
      '</div>';
  } catch(e) {
    container.innerHTML = '<div class="error-state">加载Bug统计失败: ' + escHtml(e.message) + '</div>';
  }
}
