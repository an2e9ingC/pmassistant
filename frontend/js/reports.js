/* ═══════════════════════════════════════════════════
   REPORTS VIEW — Phase 3d
   Weekly / Monthly / Bug Stats
═══════════════════════════════════════════════════ */

var _reportTab = 'manpower';
var _reportTabs = ['manpower', 'weekly', 'monthly', 'bugs'];

async function renderReports(initialTab) {
  var mpPerm = hasPerm('manpower_view');

  // Show/hide manpower tab based on permission
  var mpTab = document.getElementById('rpttab-manpower');
  if (mpTab) mpTab.style.display = mpPerm ? '' : 'none';

  // 根据 URL 参数决定初始 tab（#/reports/manpower 等）
  var want = (initialTab && _reportTabs.indexOf(initialTab) >= 0) ? initialTab : _reportTab;
  // 无 manpower_view 权限的用户不可停留在人力 tab（默认与 URL 均回退周报）
  if (!mpPerm && want === 'manpower') want = 'weekly';
  _reportTab = want;

  // 先同步收起非目标 section，避免无权限用户闪现人力区
  ['weekly', 'monthly', 'bugs', 'manpower'].forEach(function(s) {
    var sec = document.getElementById('rpt-sec-' + s);
    if (sec) sec.style.display = s === want ? 'block' : 'none';
  });

  await Promise.all([
    loadReportWeekly(),
    loadReportMonthly(),
    loadBugStats(),
  ]);
  switchReportTab(_reportTab);
}

function switchReportTab(tab) {
  _reportTab = tab;
  document.querySelectorAll('#view-reports .map-tab').forEach(function(t) { t.classList.remove('active'); });
  var el = document.getElementById('rpttab-' + tab);
  if (el) el.classList.add('active');

  var sections = ['weekly', 'monthly', 'bugs', 'manpower'];
  sections.forEach(function(s) {
    var sec = document.getElementById('rpt-sec-' + s);
    if (sec) sec.style.display = s === tab ? 'block' : 'none';
  });

  // 同步 URL（每个 tab 独立 URL：#/reports/manpower 等）
  var url = buildHash('reports', tab);
  if (window.location.hash !== url) {
    history.replaceState({ view: 'reports', params: [tab] }, '', url);
  }

  // Lazy-load manpower report when tab is first clicked
  if (tab === 'manpower') loadManpowerReport();
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
        { key: 'name', title: '项目', minWidth: 100, render: function(v, row) { return '<span style="font-family:var(--mono);font-size:11.5px;color:var(--accent)">' + escHtml(row.code||'') + '</span> ' + escHtml(v||''); } },
        { key: 'status', title: '状态', minWidth: 80, render: function(v) { return renderPill(v); } },
        { key: 'progress', title: '进度', minWidth: 60, render: function(v) { return '<span style="font-variant-numeric:tabular-nums">' + (v||0) + '%</span>'; } },
        { key: 'tasks_info', title: '任务(完成/总数)', minWidth: 60, render: function(v, row) { return '<span style="font-variant-numeric:tabular-nums">' + (row.tasks_done||0) + '/' + (row.tasks_total||0) + '</span>'; } }
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
      var sevLabels = {1:'致命',2:'严重',3:'一般',4:'建议'};
      new DataTable({
        container: document.getElementById('rpt-bugs-table'),
        columns: [
          { key: 'severity', title: '严重度', width: '60px', minWidth: 60, render: function(v, row) { var sc = {1:'var(--danger)',2:'var(--warn)',3:'var(--accent)',4:'var(--muted)'}; return '<span style="font-size:10px;padding:1px 5px;border-radius:3px;background:'+(sc[v]||'var(--bg)')+'20;color:'+(sc[v]||'var(--fg)')+';font-weight:600">'+escHtml(sevLabels[v]||v||'')+'</span>'; } },
          { key: 'title', title: '标题', minWidth: 100, align: 'left', render: function(v) { return '<span style="font-size:12.5px">'+escHtml(v||'')+'</span>'; } },
          { key: 'status', title: '状态', width: '80px', minWidth: 80, render: function(v) { return renderPill(v); } },
          { key: 'assignee_name', title: '指派', width: '90px', minWidth: 90, render: function(v) { return '<span style="font-size:11.5px;color:var(--muted)">'+escHtml(v||'')+'</span>'; } },
          { key: 'created_at', title: '创建日期', width: '100px', minWidth: 100, render: function(v) { return '<span style="font-size:11.5px;font-family:var(--mono);color:var(--muted)">'+formatDate(v)+'</span>'; } }
        ],
        data: bugs,
      });
    }
  } catch(e) {
    container.innerHTML = '<div class="error-state">加载Bug统计失败: ' + escHtml(e.message) + '</div>';
  }
}

/* ── Manpower Report ── */

var _manpowerGroupBy = 'user';
// 饼图专用彩色（不含黑/白/灰），保证 light/dark 下都醒目
var _pieColors = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316', '#6366F1', '#84CC16'];

async function loadManpowerReport() {
  var container = document.getElementById('rpt-sec-manpower');
  if (!container || container._loaded) return;
  container.innerHTML = '<div class="loading-spinner">加载人力报表...</div>';

  try {
    var data = await API.get('/reports/manpower');
    var s = data.summary || {};
    var checkinTotal = (data.by_user || []).reduce(function(acc, u) { return acc + (u.checkin_hours || 0); }, 0);

    container.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
        '<div class="section-title" style="margin:0">人力工时报表</div>' +
        '<button class="btn btn-primary btn-sm" onclick="_exportManpower()">导出 Excel</button>' +
      '</div>' +
      '<div class="kpi-grid" style="grid-template-columns:repeat(5,1fr);margin-bottom:16px">' +
        '<div class="kpi-card"><div class="kpi-label">总工时</div><div class="kpi-value" style="font-size:22px">' + (s.total_hours||0).toFixed(1) + 'h</div></div>' +
        '<div class="kpi-card"><div class="kpi-label">企微打卡总工时</div><div class="kpi-value" style="font-size:22px">' + checkinTotal.toFixed(1) + 'h</div></div>' +
        '<div class="kpi-card"><div class="kpi-label">参与人数</div><div class="kpi-value" style="font-size:22px">' + (s.person_count||0) + '</div></div>' +
        '<div class="kpi-card"><div class="kpi-label">涉及项目</div><div class="kpi-value" style="font-size:22px">' + (s.project_count||0) + '</div></div>' +
        '<div class="kpi-card"><div class="kpi-label">涉及产品</div><div class="kpi-value" style="font-size:22px">' + (s.product_count||0) + '</div></div>' +
      '</div>' +
      '<div class="map-tabs" style="margin-bottom:12px">' +
        '<div class="map-tab' + (_manpowerGroupBy === 'user' ? ' active' : '') + '" onclick="_switchManpowerDim(\'user\')">按人员</div>' +
        '<div class="map-tab' + (_manpowerGroupBy === 'project' ? ' active' : '') + '" onclick="_switchManpowerDim(\'project\')">按项目</div>' +
      '</div>' +
      '<div id="mp-table-area"></div>' +
      '<div style="font-size:11px;color:var(--muted);margin-top:8px">' + data.period.from + ' ~ ' + data.period.to + '</div>';

    window._mpData = data;
    _renderManpowerDim(_manpowerGroupBy);
    container._loaded = true;
  } catch(e) {
    container.innerHTML = '<div class="error-state">加载人力报表失败: ' + escHtml(e.message) + '</div>';
  }
}

function _switchManpowerDim(dim) {
  _manpowerGroupBy = dim;
  document.querySelectorAll('#rpt-sec-manpower .map-tab').forEach(function(t) {
    t.classList.toggle('active', t.textContent.indexOf(dim === 'project' ? '项目' : '人员') >= 0);
  });
  _renderManpowerDim(dim);
}

function _renderManpowerDim(dim) {
  var area = document.getElementById('mp-table-area');
  if (!area || !window._mpData) return;
  var data = window._mpData['by_' + dim] || [];
  var columns;

  if (dim === 'user') {
    // 按人员：搜索 + 左侧表格(40%) + 右侧详情(60%)（项目占比饼图 + 每日明细）
    area.innerHTML =
      '<div style="display:flex;gap:14px;align-items:flex-start">' +
        '<div style="flex:0 0 40%;min-width:0">' +
          '<input class="search-inp" id="mp-user-search" placeholder="搜索人员姓名/账号..." oninput="_filterMpUsers(this.value)" style="margin-bottom:8px;max-width:280px">' +
          '<div class="card" style="padding:0"><div id="mp-dt"></div></div>' +
        '</div>' +
        '<div id="mp-user-detail" style="flex:1;min-width:0;margin-top:44px"></div>' +
      '</div>';
    window._mpUserData = data;
    window._mpUserDt = null;
    columns = [
      {key:'display_name',title:'人员',width:'70px',minWidth:60,sortable:true,render:function(v){return '<span style="white-space:nowrap">'+escHtml(v||'?')+'</span>';}},
      {key:'checkin_hours',title:'打卡工时',width:'78px',minWidth:78,sortable:true,render:function(v){return '<span style="font-family:var(--mono)">'+(v||0).toFixed(1)+'h</span>';}},
      {key:'pma_hours',title:'PMA记录工时',width:'95px',minWidth:95,sortable:true,render:function(v){return '<span style="font-family:var(--mono)">'+(v||0).toFixed(1)+'h</span>';}},
      {key:'ratio',title:'记录/打卡',width:'80px',minWidth:80,sortable:true,render:function(v){return (v==null||v===undefined) ? '<span style="color:var(--muted)">—</span>' : '<span style="font-variant-numeric:tabular-nums">'+v+'%</span>';}},
      {key:'project_count',title:'涉及项目',width:'72px',minWidth:72,sortable:true},
    ];
    setTimeout(function() {
      var dtEl = document.getElementById('mp-dt');
      if (dtEl && typeof DataTable !== 'undefined') {
        window._mpUserDt = new DataTable({
          container: dtEl, columns: columns, data: data,
          clickable: true,
          onRowClick: function(row) { _loadMpUserDetail(row.user_id, row.display_name); },
        });
        // 默认加载第一个人员的详情
        if (data && data.length) {
          _loadMpUserDetail(data[0].user_id, data[0].display_name);
        }
      }
    }, 50);
    return;
  }

  if (dim === 'project') {
    // 按项目：搜索 + 左侧表格(60%) + 右侧饼图(40%)
    area.innerHTML =
      '<div style="display:flex;gap:14px;align-items:flex-start">' +
        '<div style="flex:0 0 60%;min-width:0">' +
          '<input class="search-inp" id="mp-proj-search" placeholder="搜索项目编号/名称..." oninput="_filterMpProjects(this.value)" style="margin-bottom:8px;max-width:280px">' +
          '<div class="card" style="padding:0"><div id="mp-dt"></div></div>' +
        '</div>' +
        '<div style="flex:1;min-width:0;margin-top:44px"><div class="card card-pad" id="mp-proj-pie"></div></div>' +
      '</div>';
    window._mpProjData = data;
    window._mpProjDt = null;
    columns = [
      {key:'project_code',title:'项目编号',minWidth:80,render:function(v){return '<span style="font-family:var(--mono);font-size:11px;color:var(--accent)">'+escHtml(v||'')+'</span>';}},
      {key:'project_name',title:'项目名称',minWidth:120,align:'left',render:function(v){return escHtml(v||'');}},
      {key:'total_hours',title:'总工时',width:'80px',minWidth:80,render:function(v){return (v||0).toFixed(1)+'h';}},
      {key:'total_share',title:'总人力占比',width:'90px',minWidth:90,render:function(v){return (v||0)+'%';}},
    ];
  }
  setTimeout(function() {
    var dtEl = document.getElementById('mp-dt');
    if (dtEl && typeof DataTable !== 'undefined') {
      var dt = new DataTable({container: dtEl, columns: columns, data: data});
      if (dim === 'project') window._mpProjDt = dt;
    }
    if (dim === 'project') {
      var pieEl = document.getElementById('mp-proj-pie');
      if (pieEl && typeof renderDonutChart === 'function') {
        var segs = data.filter(function(p) { return p.total_hours > 0; }).map(function(p, i) {
          return {
            label: (p.project_code || p.project_name || '其他'),
            value: p.total_hours,
            color: _pieColors[i % _pieColors.length],
            name: p.project_name || '',
            percentage: p.total_share || 0,
          };
        });
        var totalH = (window._mpData && window._mpData.summary) ? (window._mpData.summary.total_hours || 0) : 0;
        renderDonutChart(pieEl, segs, {
          title: '项目人力占比',
          size: 200,
          centerText: totalH.toFixed(1) + 'h',
        });
      }
    }
  }, 50);
}

function _filterMpUsers(q) {
  q = (q || '').trim().toLowerCase();
  var all = window._mpUserData || [];
  var filtered = q
    ? all.filter(function(u) {
        return (u.display_name || '').toLowerCase().indexOf(q) >= 0 ||
               (u.username || '').toLowerCase().indexOf(q) >= 0;
      })
    : all;
  if (window._mpUserDt) window._mpUserDt.setData(filtered);
}

function _filterMpProjects(q) {
  q = (q || '').trim().toLowerCase();
  var all = window._mpProjData || [];
  var filtered = q
    ? all.filter(function(p) {
        return (p.project_code || '').toLowerCase().indexOf(q) >= 0 ||
               (p.project_name || '').toLowerCase().indexOf(q) >= 0;
      })
    : all;
  if (window._mpProjDt) window._mpProjDt.setData(filtered);
}

function _loadMpUserDetail(userId, displayName) {
  var detailEl = document.getElementById('mp-user-detail');
  if (!detailEl) return;
  detailEl.innerHTML = '<div class="loading-spinner">加载工时详情...</div>';
  var period = (window._mpData && window._mpData.period) || {};
  var url = '/reports/manpower/user/' + userId + '/detail?date_from=' + encodeURIComponent(period.from || '') + '&date_to=' + encodeURIComponent(period.to || '');
  API.get(url).then(function(res) {
    var d = (res && res.data) ? res.data : res;
    _renderMpUserDetail(detailEl, d);
  }).catch(function(e) {
    detailEl.innerHTML = '<div class="error-state">加载失败: ' + escHtml(e.message || '') + '</div>';
  });
}

function _renderMpUserDetail(el, d) {
  var s = d.summary || {};
  var ratioTxt = (s.ratio == null || s.ratio === undefined) ? '—' : s.ratio + '%';
  var checkinH = s.checkin_hours || 0;
  var segments = (d.projects || []).filter(function(p) { return p.hours > 0; }).map(function(p, i) {
    return {
      label: (p.project_code || p.project_name || '其他'),
      value: p.hours,
      color: _pieColors[i % _pieColors.length],
      name: p.project_name || '',
      percentage: p.percentage || 0,
    };
  });
  // 未记录 = 打卡总工时 - 记录总工时（灰色斜纹线条，无纯色填充）；百分比统一以打卡工时为分母
  var unrecorded = Math.max(0, checkinH - (s.pma_hours || 0));
  if (unrecorded > 0) {
    segments.push({
      label: '未记录',
      value: unrecorded,
      hatch: true,
      name: '',
      percentage: 0,
    });
  }

  var dailyRows = '';
  (d.daily || []).forEach(function(day) {
    var projHtml = (day.projects || []).map(function(p) {
      return '<div style="display:flex;justify-content:space-between;gap:6px">' +
        '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHtml(p.project_code || p.project_name || '其他') + '</span>' +
        '<span style="font-family:var(--mono);flex-shrink:0">' + (p.hours || 0).toFixed(1) + 'h (' + (p.percentage || 0) + '%)</span>' +
        '</div>';
    }).join('');
    dailyRows += '<tr>' +
      '<td style="font-family:var(--mono);font-size:11px;color:var(--muted);white-space:nowrap;vertical-align:top">' + escHtml(day.date) + '</td>' +
      '<td style="font-family:var(--mono);font-size:11px;text-align:right;white-space:nowrap;vertical-align:top">' + (day.hours || 0).toFixed(1) + 'h</td>' +
      '<td style="font-size:11px;min-width:160px">' + projHtml + '</td>' +
      '</tr>';
  });

  el.innerHTML =
    '<div style="display:flex;gap:12px;align-items:flex-start">' +
      '<div style="flex:1 1 0;min-width:0;display:flex;flex-direction:column;gap:12px">' +
        '<div class="card card-pad">' +
          '<div style="font-weight:620;font-size:14px">' + escHtml(s.display_name || '') + '</div>' +
          '<div style="font-size:12px;color:var(--muted);margin-top:6px;display:flex;gap:14px;flex-wrap:wrap">' +
            '<span>打卡 <b style="color:var(--fg)">' + (s.checkin_hours || 0).toFixed(1) + 'h</b></span>' +
            '<span>记录 <b style="color:var(--fg)">' + (s.pma_hours || 0).toFixed(1) + 'h</b></span>' +
            '<span>记录/打卡 <b style="color:var(--fg)">' + ratioTxt + '</b></span>' +
          '</div>' +
        '</div>' +
        '<div class="card card-pad"><div id="mp-user-pie"></div></div>' +
      '</div>' +
      '<div class="card card-pad" style="flex:1 1 0;min-width:0">' +
        '<div style="font-weight:620;font-size:13px;margin-bottom:8px">每日各项目占比</div>' +
        (dailyRows ? '<table class="proj-table" style="font-size:12px;width:100%"><thead><tr><th style="text-align:left">日期</th><th style="text-align:right">工时</th><th style="text-align:left">项目明细</th></tr></thead><tbody>' + dailyRows + '</tbody></table>' : '<div style="color:var(--muted);font-size:12px;text-align:center;padding:16px">该时段无工时记录</div>') +
      '</div>' +
    '</div>';

  var pieEl = document.getElementById('mp-user-pie');
  if (pieEl && typeof renderDonutChart === 'function') {
    renderDonutChart(pieEl, segments, {
      title: '项目工时占比',
      size: 150,
      centerText: (s.checkin_hours || 0).toFixed(1) + 'h',
    });
  }
}

async function _exportManpower() {
  var token = localStorage.getItem('pma_token');
  if (!token) { showToast('未登录', 'error'); return; }
  try {
    var res = await fetch('/api/reports/manpower/export', { headers: { 'Authorization': 'Bearer ' + token } });
    if (!res.ok) {
      var err = {};
      try { err = await res.json(); } catch(e) {}
      throw new Error(err.detail || err.message || ('HTTP ' + res.status));
    }
    var blob = await res.blob();
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    var _period = (window._mpData && window._mpData.period) || {};
    a.download = 'manpower_report_' + (_period.from || '') + '_' + (_period.to || '') + '.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch(e) {
    showToast('导出失败: ' + (e.message || ''), 'error');
  }
}
