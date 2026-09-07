/* ═══════════════════════════════════════════════════
   物料编码平台（结构件/结构耗材 8 位料号）— 视图脚本
   · 目录 Tab：matcode_view（搜索/筛选/分页/导出）
   · 发放 Tab：matcode_issue（单发 + 编辑/停用/作废）
   · 管理员级：改号 override_code、查重特批 force_duplicate（同后端判定）
   · 数据：GET /matcode/tree、/matcode/materials、/matcode/next-code、
           /matcode/dup-check、POST /matcode/issue，
           PUT /matcode/materials/{id}、/materials/{id}/status
═══════════════════════════════════════════════════ */

var _mc = {
  isAdmin: false,
  canIssue: false,
  segs: [],            // 全段树（/tree）
  issueSegs: [],       // 可发放叶段（issueable && !closed）
  dirDt: null,
  dirData: [],
  dirPage: 1,
  dirPerPage: 50,
  dirTotal: 0,
  dirDirty: true,
  dirLoaded: false,
  dtInited: false,
  dirSeq: 0,           // 目录加载请求序号（丢弃过期响应）
  dirQTimer: null,     // 目录搜索防抖
  activeTab: 'dir',    // 记住用户上次停留的 Tab，切换导航返回不重置
  prevTimer: null,
  preview: null,       // 最近一次 /next-code 结果
  dupExact: [],        // {code,name,spec,drawing,...} 精确命中
  dupSimilar: [],
  editId: null,        // 当前编辑行 id
  projOptions: [],     // 已跟踪项目（编码 combo 数据源）
  projTouched: false,  // 使用项目被用户手选/手填过 → 名称改名不再覆盖
  projAuto: null,      // 最近一次从名称自动提取的项目号（供名称改动时同步）
};

function _mcUser() { return getCurrentUser() || {}; }

function _mcHas(perm) {
  var u = _mcUser();
  if (u.role === 'admin') return true;
  return (u.permissions || '').split(',').indexOf(perm) >= 0;
}

/* 发放面板 combo：点击其它区域关闭下拉（无全局关闭器，这里按视图收口一次） */
var _mcComboDocBound = false;
function _mcEnsureComboDocClose() {
  if (_mcComboDocBound) return;
  _mcComboDocBound = true;
  document.addEventListener('mousedown', function(ev) {
    var t = ev.target;
    if (t && t.closest && t.closest('.proj-combo')) return;
    document.querySelectorAll('#view-matcode .proj-combo.open').forEach(function(w) {
      w.classList.remove('open');
    });
  });
}

/* ═══════════════ 页面入口 ═══════════════ */

async function initMatcode() {
  var container = document.getElementById('view-matcode');
  if (!container) return;
  _mcEnsureComboDocClose();

  var u = _mcUser();
  _mc.isAdmin = (u.role === 'admin') || _mcHas('admin');
  _mc.canIssue = _mc.isAdmin || _mcHas('matcode_issue');

  container.innerHTML =
    '<div class="mc-tabs">' +
      '<button class="mc-tab active" data-mc-tab="dir" onclick="mcSwitchTab(\'dir\')">物料目录</button>' +
      (_mc.canIssue
        ? '<button class="mc-tab" data-mc-tab="issue" onclick="mcSwitchTab(\'issue\')">编码发放</button>'
        : '') +
    '</div>' +
    '<div id="mc-panel-dir"><div class="empty-state" style="padding:28px">加载中…</div></div>' +
    (_mc.canIssue ? '<div id="mc-panel-issue" style="display:none"></div>' : '');

  // 每次进入视图都会重建 DOM → 必须重置目录加载态，否则 guard 误判"已加载"卡「加载中」
  _mc.dirLoaded = false;
  _mc.dirDirty = true;
  _mc.dtInited = false;
  _mc.dirDt = null;

  // 预加载项目选项（编码 combo 数据源），失败不阻塞
  API.get('/users/project-options').then(function(list) {
    _mc.projOptions = list || [];
    mcSyncProjHint();
    mcMaybeAutoProject();
  }).catch(function() {});

  // 拉全段树 → 构建下拉 → 渲染发放面板 → 进入上次停留的 Tab
  try {
    var tree = await API.get('/matcode/tree');
    _mc.segs = tree || [];
    _mc.issueSegs = (_mc.segs).filter(function(s) {
      return s.issueable && !s.closed && !s.is_group;
    });
    _buildDirSegSelect();
    if (_mc.canIssue) _renderIssuePanel();
    mcSwitchTab(_mc.activeTab === 'issue' && _mc.canIssue ? 'issue' : 'dir');
  } catch (e) {
    container.innerHTML =
      '<div class="error-state" style="padding:30px">物料编码模块加载失败：' + escHtml(e.message) +
      '<br><button class="btn" style="margin-top:10px" onclick="initMatcode()">重试</button></div>';
    showToast('加载失败: ' + e.message, 'error');
  }
}

/* ═══════════════ Tab 切换 ═══════════════ */

function mcSwitchTab(tab) {
  _mc.activeTab = tab;
  document.querySelectorAll('#view-matcode .mc-tab').forEach(function(b) {
    b.classList.toggle('active', b.getAttribute('data-mc-tab') === tab);
  });
  var dirEl = document.getElementById('mc-panel-dir');
  var issEl = document.getElementById('mc-panel-issue');
  if (dirEl) dirEl.style.display = tab === 'dir' ? '' : 'none';
  if (issEl) issEl.style.display = tab === 'issue' ? '' : 'none';
  if (tab === 'dir') {
    if (_mc.dirDirty || !_mc.dirLoaded) { _mc.dirPage = 1; mcDirLoad(); }
  }
}

/* ═══════════════ 段下拉（目录筛选 + 发放共用逻辑） ═══════════════ */

function _segLabel(s) {
  return (s.label || s.key) + ' ·' + s.prefix;
}

function _buildDirSegSelect() {
  var sel = document.getElementById('mc-dir-seg');
  if (!sel) return;
  var leaves = _mc.segs.filter(function(s) { return !s.is_group; });
  // 段树里存在父子关系 → 按 parent 分组展示
  var groups = {};
  _mc.segs.forEach(function(s) { groups[s.key] = s; });
  var html = '<option value="">全部段</option>';
  var topLeaves = leaves.filter(function(s) { return !s.parent_key || !groups[s.parent_key]; });
  var children = leaves.filter(function(s) { return s.parent_key && groups[s.parent_key]; });
  html += _optGroup('', topLeaves);
  // 按组归类子段
  var byParent = {};
  children.forEach(function(s) {
    (byParent[s.parent_key] = byParent[s.parent_key] || []).push(s);
  });
  Object.keys(byParent).forEach(function(pk) {
    html += _optGroup(groups[pk] ? groups[pk].label : pk, byParent[pk]);
  });
  sel.innerHTML = html;
}

function _optGroup(groupLabel, arr) {
  if (!arr || !arr.length) return '';
  var out = '';
  if (groupLabel) out += '<optgroup label="' + escHtml(groupLabel) + '">';
  arr.forEach(function(s) {
    var tag = s.closed ? '（冻结）' : (s.issueable ? '' : '');
    out += '<option value="' + escHtml(s.key) + '">' + escHtml(_segLabel(s) + tag) + '</option>';
  });
  if (groupLabel) out += '</optgroup>';
  return out;
}

function _segByKey(k) {
  for (var i = 0; i < _mc.segs.length; i++) if (_mc.segs[i].key === k) return _mc.segs[i];
  return null;
}

/* ═══════════════ Tab 1 — 物料目录 ═══════════════ */

function _renderDirShell() {
  var panel = document.getElementById('mc-panel-dir');
  panel.innerHTML =
    '<div class="mc-filterbar">' +
      '<div class="search-wrap" style="max-width:340px">' +
        '<svg class="search-ico" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">' +
          '<circle cx="6.5" cy="6.5" r="5"/><line x1="10.5" y1="10.5" x2="14" y2="14"/>' +
        '</svg>' +
        '<input class="search-inp" id="mc-dir-q" placeholder="料号 / 名称 / 规格 / 图号 / 备注… 输入即过滤" ' +
          'oninput="mcDirQChange()" onkeydown="if(event.key===\'Enter\'){clearTimeout(_mc.dirQTimer);mcDirApply()}">' +
        '<button class="search-clear" onclick="clearTimeout(_mc.dirQTimer);var q=document.getElementById(\'mc-dir-q\');if(q)q.value=\'\';mcDirApply()" title="清除">&times;</button>' +
      '</div>' +
      '<select id="mc-dir-seg" style="max-width:230px" onchange="mcDirApply()"></select>' +
      '<select id="mc-dir-status" onchange="mcDirApply()">' +
        '<option value="">在用（不含作废）</option>' +
        '<option value="active">仅在用</option>' +
        '<option value="stopped">停用</option>' +
        '<option value="void">作废（含）</option>' +
      '</select>' +
      '<label title="是否显示 11723 旧前缀（已冻结）的历史编码段">' +
        '<input type="checkbox" id="mc-dir-legacy" checked onchange="mcDirApply()"> 含旧前缀' +
      '</label>' +
      '<button class="btn btn-sm" onclick="mcExportCsv()">导出 CSV</button>' +
      '<span class="mc-dim" id="mc-dir-count" style="margin-left:auto"></span>' +
    '</div>' +
    '<div class="section-hd" style="margin-bottom:8px">' +
      '<div class="section-title">物料目录 <span id="mc-dir-title" style="font-size:11px;color:var(--muted)"></span></div>' +
      '<div class="section-acts" style="font-size:11px;color:var(--muted)">料号点击查看详情；编辑/停用/作废需「物料编码发行」权限</div>' +
    '</div>' +
    '<div class="card" style="padding:0"><div id="mc-dir-table"></div></div>' +
    '<div class="mc-pager" id="mc-dir-pager"></div>';
  _buildDirSegSelect();
}

function _initDirTable() {
  if (_mc.dtInited) return;
  var el = document.getElementById('mc-dir-table');
  if (!el) return;
  var canOps = _mc.canIssue;
  // DataTable 列 render 签名：render(v, row, rowIdx, span) —— v=单元格原始值，row=整行对象
  var cols = [
    { key: 'code', title: '料号', width: '92px', align: 'left',
      render: function(v, row) { return _renderCode(row); } },
    { key: 'name', title: '名称', width: '20%', align: 'left',
      render: function(v, row) {
        var legacy = row.legacy_prefix ? '<span class="mc-pill legacy" title="旧前缀历史码">11723旧</span> ' : '';
        return legacy + escHtml(v || '');
      } },
    { key: 'spec', title: '规格型号', width: '170px', align: 'left',
      render: function(v) { return v ? '<span class="mc-spec">' + escHtml(v) + '</span>' : '<span class="mc-dim">—</span>'; } },
    { key: 'drawing', title: '图号', width: '150px', align: 'left',
      render: function(v) { return v ? '<span class="mc-dim" style="font-size:11px">' + escHtml(v) + '</span>' : '—'; } },
    { key: 'segment_label', title: '段', width: '120px', align: 'left',
      render: function(v) { return escHtml(v || ''); } },
    { key: 'project', title: '项目', width: '110px', align: 'left',
      render: function(v) { return v ? '<span class="mc-dim">' + escHtml(v) + '</span>' : '—'; } },
    { key: 'remark', title: '备注', width: '170px', align: 'left',
      render: function(v) {
        return v ? '<span class="mc-remark" title="' + escHtml(v) + '">' + escHtml(v) + '</span>' : '<span class="mc-dim">—</span>';
      } },
    { key: 'status', title: '状态', width: '74px',
      render: function(v, row) { return _mcStatusPill(row.status); } },
  ];
  if (canOps) {
    cols.push({ key: '_op', title: '操作', width: '200px', align: 'left', render: function(v, row) { return _renderRowOps(row); } });
  }
  _mc.dirDt = new DataTable({
    container: el,
    idKey: 'id',
    emptyText: '暂无匹配物料',
    density: 'compact',
    stickyHeader: true,
    maxHeight: 'calc(100vh - 330px)',
    columns: cols,
  });
  _mc.dtInited = true;
}

function _renderCode(m) {
  var cls = m.status === 'void' ? 'mc-code void' : 'mc-code';
  var title = (m.segment_label || '') + (m.legacy_prefix ? '（旧前缀）' : '');
  return '<span class="' + cls + '" title="' + escHtml(title) + '" onclick="mcDetail(' + m.id + ')">' + escHtml(m.code) + '</span>';
}

function _mcStatusPill(status) {
  var txt = { active: '在用', stopped: '停用', void: '已作废' }[status] || status;
  return '<span class="mc-pill ' + (status || 'active') + '">' + txt + '</span>';
}

function _renderRowOps(m) {
  var s = iconEdit('mcEditRow(' + m.id + ')', '编辑');
  if (m.status === 'active') {
    s += '<button class="btn btn-xs" style="margin-right:4px" onclick="mcStopRow(' + m.id + ')" title="停用后不再参与查重/占用，可再启用">停用</button>';
  } else if (m.status === 'stopped') {
    s += '<button class="btn btn-xs" style="margin-right:4px" onclick="mcReactivateRow(' + m.id + ')">启用</button>';
  }
  if (m.status !== 'void') {
    s += '<button class="btn btn-xs" style="margin-right:4px;color:var(--danger);border-color:var(--danger)" onclick="mcVoidRow(' + m.id + ')">作废</button>';
  }
  return s;
}

function _dirFilters() {
  return {
    q: (document.getElementById('mc-dir-q') || {}).value ? document.getElementById('mc-dir-q').value.trim() : '',
    segment: document.getElementById('mc-dir-seg') ? document.getElementById('mc-dir-seg').value : '',
    status: document.getElementById('mc-dir-status') ? document.getElementById('mc-dir-status').value : '',
    include_legacy: document.getElementById('mc-dir-legacy') ? document.getElementById('mc-dir-legacy').checked : true,
  };
}

async function mcDirLoad() {
  var panel = document.getElementById('mc-panel-dir');
  if (!panel) return;
  if (!_mc.dirLoaded || !_mc.dtInited) {
    _renderDirShell();
    _initDirTable();
  }
  var countEl = document.getElementById('mc-dir-count');
  if (countEl) countEl.textContent = '加载中…';

  var f = _dirFilters();
  var qs = 'page=' + _mc.dirPage + '&page_size=' + _mc.dirPerPage +
    '&include_legacy=' + (f.include_legacy ? 'true' : 'false');
  if (f.q) qs += '&q=' + encodeURIComponent(f.q);
  if (f.segment) qs += '&segment=' + encodeURIComponent(f.segment);
  if (f.status) qs += '&status=' + encodeURIComponent(f.status);

  var seq = ++_mc.dirSeq;  // 本次请求序号：实时输入会连发，只认最后一次的结果
  try {
    var d = await API.get('/matcode/materials?' + qs);
    if (seq !== _mc.dirSeq) return;  // 已有更新的请求 → 丢弃本次过期结果
    _mc.dirData = d.items || [];
    _mc.dirTotal = d.total || 0;
    if (_mc.dirDt) _mc.dirDt.setData(_mc.dirData);
    var pages = Math.max(1, Math.ceil(_mc.dirTotal / _mc.dirPerPage));
    if (countEl) countEl.textContent = '共 ' + _mc.dirTotal + ' 条';
    var titleEl = document.getElementById('mc-dir-title');
    if (titleEl) titleEl.textContent = '（第 ' + _mc.dirPage + '/' + pages + ' 页）';
    _renderPager(pages);
    _mc.dirLoaded = true;
    _mc.dirDirty = false;
  } catch (e) {
    var tbl = document.getElementById('mc-dir-table');
    if (tbl) tbl.innerHTML = '<div class="error-state" style="padding:20px">加载失败: ' + escHtml(e.message) +
      '<br><button class="btn" style="margin-top:8px" onclick="mcDirLoad()">重试</button></div>';
    if (countEl) countEl.textContent = '';
    showToast('加载失败: ' + e.message, 'error');
  }
}

function mcDirApply() {
  _mc.dirPage = 1;
  mcDirLoad();
}

/* 实时搜索：输入防抖后重新查询（查询按钮已移除，回车/清除/下拉/勾选同样触发） */
function mcDirQChange() {
  clearTimeout(_mc.dirQTimer);
  _mc.dirQTimer = setTimeout(function() { mcDirApply(); }, 260);
}

function mcDirGo(page, pages) {
  if (page < 1 || page > pages) return;
  _mc.dirPage = page;
  mcDirLoad();
}

function _renderPager(pages) {
  var p = document.getElementById('mc-dir-pager');
  if (!p) return;
  var cur = _mc.dirPage;
  if (pages <= 1) { p.innerHTML = ''; return; }
  p.innerHTML =
    '<button class="btn" ' + (cur <= 1 ? 'disabled' : '') + ' onclick="mcDirGo(' + (cur - 1) + ',' + pages + ')">‹ 上一页</button>' +
    '<span>第 ' + cur + ' / ' + pages + ' 页</span>' +
    '<button class="btn" ' + (cur >= pages ? 'disabled' : '') + ' onclick="mcDirGo(' + (cur + 1) + ',' + pages + ')">下一页 ›</button>';
}

function mcExportCsv() {
  var f = _dirFilters();
  var qs = 'page=1&page_size=1000&include_legacy=' + (f.include_legacy ? 'true' : 'false');
  if (f.q) qs += '&q=' + encodeURIComponent(f.q);
  if (f.segment) qs += '&segment=' + encodeURIComponent(f.segment);
  if (f.status) qs += '&status=' + encodeURIComponent(f.status);
  var collect = [];
  function grab(page) {
    return API.get('/matcode/materials?' + qs.replace('page=1', 'page=' + page)).then(function(d) {
      collect = collect.concat(d.items || []);
      var totalPages = Math.max(1, Math.ceil((d.total || 0) / 1000));
      if (page < totalPages) return grab(page + 1);
      return collect;
    });
  }
  grab(1).then(function(rows) {
    var head = ['料号', '段', '名称', '规格型号', '图号', '备注', '适用项目', '单位', '状态', '旧前缀', '更新时间'];
    var lines = [head.join(',')];
    rows.forEach(function(m) {
      var arr = [m.code, m.segment_label || '', m.name || '', m.spec || '', m.drawing || '',
        m.remark || '', m.project || '', m.unit || '', { active: '在用', stopped: '停用', void: '已作废' }[m.status] || m.status,
        m.legacy_prefix || '', (m.updated_at || '').slice(0, 10)];
      lines.push(arr.map(_csvCell).join(','));
    });
    var content = '﻿' + lines.join('\n');
    var blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'matcode-materials.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function() { URL.revokeObjectURL(a.href); }, 4000);
    showToast('已导出 ' + rows.length + ' 条', 'success');
  }).catch(function(e) {
    showToast('导出失败: ' + e.message, 'error');
  });
}

function _csvCell(v) {
  var s = String(v == null ? '' : v);
  return (/[",\n]/.test(s)) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/* ═══════════════ 详情 / 编辑 / 状态 ═══════════════ */

function _findRow(id) {
  for (var i = 0; i < _mc.dirData.length; i++) if (_mc.dirData[i].id === id) return _mc.dirData[i];
  return null;
}

function mcDetail(id) {
  var m = _findRow(id);
  if (!m) return;
  var statusTxt = { active: '在用', stopped: '停用', void: '已作废' }[m.status] || m.status;
  var html =
    '<div class="mc-detail-grid">' +
      '<div class="k">料号</div><div class="v mono">' + escHtml(m.code) + (m.legacy_prefix ? ' <span class="mc-pill legacy">11723旧前缀</span>' : '') + '</div>' +
      '<div class="k">编码段</div><div class="v">' + escHtml(m.segment_label || '') + ' <span class="mc-dim">(' + escHtml(m.segment_key || '') + ')</span></div>' +
      '<div class="k">名称</div><div class="v">' + escHtml(m.name) + '</div>' +
      '<div class="k">规格型号</div><div class="v">' + escHtml(m.spec || '—') + '</div>' +
      '<div class="k">图号</div><div class="v" style="font-family:var(--mono)">' + escHtml(m.drawing || '—') + '</div>' +
      '<div class="k">适用项目</div><div class="v">' + escHtml(m.project || '—') + '</div>' +
      '<div class="k">单位</div><div class="v">' + escHtml(m.unit || '—') + '</div>' +
      '<div class="k">状态</div><div class="v">' + _mcStatusPill(m.status) + '</div>' +
      '<div class="k">备注</div><div class="v">' + escHtml(m.remark || '—') + '</div>' +
      '<div class="k">来源</div><div class="v mc-dim">' + escHtml(m.source || '—') + '</div>' +
      '<div class="k">创建人</div><div class="v">' + escHtml(m.created_by || '—') + '</div>' +
      '<div class="k">创建时间</div><div class="v">' + escHtml(m.created_at ? fmtISODateTime(m.created_at) : '—') + '</div>' +
    '</div>';
  openDialog('物料详情 · ' + escHtml(m.code), html, [{ text: '关闭', cls: 'btn-primary', onclick: 'closeSharedDialog()' }], { maxWidth: 560 });
}

function _currentDirRowById(id) { return _findRow(id); }

function mcEditRow(id) {
  var m = _findRow(id);
  if (!m) return;
  _mc.editId = id;
  var seg = _segByKey(m.segment_key);
  var segName = seg ? _segLabel(seg) : (m.segment_label || '');
  var html =
    '<div class="mc-field"><label>料号（不可改）</label>' +
      '<input type="text" value="' + escHtml(m.code) + '" readonly style="background:var(--surface2)"></div>' +
    '<div class="mc-field"><label>编码段（不可改）</label>' +
      '<input type="text" value="' + escHtml(segName) + '" readonly style="background:var(--surface2)"></div>' +
    '<div class="mc-field"><label>名称 *</label><input type="text" id="mc-edit-name" value="' + escHtml(m.name || '') + '"></div>' +
    '<div class="mc-field"><label>规格型号</label><input type="text" id="mc-edit-spec" value="' + escHtml(m.spec || '') + '"></div>' +
    '<div class="mc-field"><label>图号</label>' +
      '<div class="mc-draw-edit">' +
        '<input type="text" id="mc-edit-drawing" value="' + escHtml(m.drawing || '') + '" placeholder="自动生成或手动修改（需全局唯一）">' +
        '<button type="button" class="btn btn-sm" onclick="mcGenDrawingFill()" title="按该码段联号规则重新生成">生成</button>' +
      '</div>' +
      '<div class="hint" id="mc-edit-draw-hint"></div></div>' +
    '<div class="mc-field"><label>适用项目</label><input type="text" id="mc-edit-project" value="' + escHtml(m.project || '') + '" placeholder="项目编号（PMA 未跟踪的老项目可直接填编号）"></div>' +
    '<div class="mc-field"><label>单位</label><input type="text" id="mc-edit-unit" value="' + escHtml(m.unit || '') + '"></div>' +
    '<div class="mc-field"><label>备注</label><textarea id="mc-edit-remark" rows="3">' + escHtml(m.remark || '') + '</textarea></div>';
  openDialog('编辑物料 · ' + escHtml(m.code), html,
    [{ text: '取消', onclick: 'closeSharedDialog()' },
     { text: '保存', cls: 'btn-primary', onclick: function() { mcSaveEdit(); } }],
    { maxWidth: 480 });
  // 图号输入实时提示（与码段联号规则建议号比较）
  var de = document.getElementById('mc-edit-drawing');
  if (de) de.addEventListener('input', function() { mcEditDrawHint(de.value); });
  mcEditDrawHint(m.drawing || '');
}

/* 按码段联号规则推导该料号的标准图号（series.序号补零） */
function _canonicalDrawing(m) {
  if (!m) return null;
  var seg = _segByKey(m.segment_key);
  if (!seg || !seg.drawing_series) return null;
  var prefix = seg.prefix || String(m.code || '').slice(0, 4);
  var sfx = parseInt(String(m.code || '').slice(String(prefix).length), 10);
  if (isNaN(sfx)) return null;
  var w = seg.drawing_width || 4;
  return seg.drawing_series + '.' + String(sfx).padStart(w, '0');
}

function mcGenDrawingFill() {
  var m = _findRow(_mc.editId);
  var inp = document.getElementById('mc-edit-drawing');
  if (!m || !inp) return;
  var d = _canonicalDrawing(m);
  if (!d) { showToast('该编码段无联号图号规则，请手动填写', 'warn'); return; }
  inp.value = d;
  mcEditDrawHint(d);
}

function mcEditDrawHint(v) {
  var h = document.getElementById('mc-edit-draw-hint');
  var m = _findRow(_mc.editId);
  if (!h || !m) return;
  var canon = _canonicalDrawing(m);
  var cur = (v || '').trim();
  if (cur && cur === canon) {
    h.textContent = '与码段联号规则一致 ✓';
    h.className = 'hint mc-hint-ok';
  } else if (canon) {
    h.textContent = cur
      ? '与码段规则建议号不一致；可点「生成」还原为 ' + canon
      : '留空 = 清除图号；或点「生成」按 ' + canon + ' 自动填写';
    h.className = 'hint';
  } else if (cur) {
    h.textContent = '该码段无联号规则，手动图号保存时校验全局唯一。';
    h.className = 'hint mc-hint-warn';
  } else {
    h.textContent = '该码段无联号规则，可留空或手动填写。';
    h.className = 'hint';
  }
}

async function mcSaveEdit() {
  var id = _mc.editId;
  function g(x) { var el = document.getElementById(x); return el ? el.value : ''; }
  var payload = {
    name: g('mc-edit-name'), spec: g('mc-edit-spec'),
    drawing: g('mc-edit-drawing'), project: g('mc-edit-project'),
    unit: g('mc-edit-unit'), remark: g('mc-edit-remark'),
  };
  if (!payload.name || !payload.name.trim()) { showToast('名称必填', 'error'); return; }
  try {
    await API.put('/matcode/materials/' + id, {
      name: payload.name.trim(), spec: payload.spec, drawing: payload.drawing,
      project: payload.project, unit: payload.unit, remark: payload.remark,
    });
    closeSharedDialog();
    showToast('已保存', 'success');
    mcDirLoad();
  } catch (e) { showToast('保存失败: ' + e.message, 'error'); }
}

function _confirmStatusChange(id, title, msg, fn) {
  var m = _findRow(id);
  if (!m) return;
  openDialog(title,
    '<div style="font-size:13px;line-height:1.8">' + msg + '<br><span style="font-family:var(--mono);color:var(--accent)">' +
      escHtml(m.code) + '</span> · ' + escHtml(m.name) + '</div>',
    [{ text: '取消', onclick: 'closeSharedDialog()' },
     { text: '确定', cls: 'btn-danger', onclick: function() { fn(m); } }],
    { maxWidth: 420 });
}

function mcStopRow(id) {
  _confirmStatusChange(id, '停用物料', '停用后：该料号不再参与查重与占用计数，可随时重新启用。确认停用？', function(m) {
    _mcSetStatus(m, 'stopped');
  });
}

function mcReactivateRow(id) {
  var m = _findRow(id); if (!m) return;
  _mcSetStatus(m, 'active');
}

function mcVoidRow(id) {
  _confirmStatusChange(id, '作废物料', '作废后号码永久保留、永不回填，编码无法撤销；如属录入错误建议作废重发。确认作废？', function(m) {
    _mcSetStatus(m, 'void');
  });
}

async function _mcSetStatus(m, status) {
  try {
    await API.put('/matcode/materials/' + m.id + '/status', { status: status });
    showToast(status === 'void' ? '已作废' : (status === 'stopped' ? '已停用' : '已启用'), 'success');
    mcDirLoad();
    if (status === 'void' || status === 'stopped') _mc.dirDirty = true;
  } catch (e) { showToast('操作失败: ' + e.message, 'error'); }
}

/* ═══════════════ Tab 2 — 编码发放 ═══════════════ */

function _renderIssuePanel() {
  var panel = document.getElementById('mc-panel-issue');
  if (!panel) return;
  var segComboHtml = _mc.issueSegs.length
    ? createSearchCombo({
        comboId: 'mc-seg-combo', inputId: 'mc-seg-combo-input', dropdownId: 'mc-seg-dd',
        placeholder: '搜索编码段（名称/前缀）…',
        dataSource: function() { return _segComboItems(); },
        selectedIdFn: function() { var h = document.getElementById('mc-seg'); return h ? h.value : null; },
        onSelect: function(p) { mcSelectSeg(p.id); },
      })
    : '<div class="mc-dim" style="padding:2px 0">（暂无可用发放段）</div>';
  var projComboHtml = createSearchCombo({
    comboId: 'mc-proj-combo', inputId: 'mc-project', dropdownId: 'mc-proj-dd',
    placeholder: '搜索项目，或直接输入老项目编号（如 PE0141）',
    dataSource: function() { return _projComboItems(); },
    selectedIdFn: function() { return (document.getElementById('mc-project') || {}).value || null; },
    onSelect: function(p) { _mc.projTouched = true; mcSyncProjHint(); },
  });

  panel.innerHTML =
    '<div class="mc-issue-grid">' +
      '<div class="card-pad">' +
        '<div class="section-hd" style="margin-bottom:12px"><div class="section-title">单条发码</div>' +
          '<div class="section-acts" style="font-size:11px;color:var(--muted)">系统按段自动取下一未占用号（段满/被占 409 拦截）</div></div>' +
        '<div class="mc-field"><label>编码段</label>' +
          segComboHtml +
          '<input type="hidden" id="mc-seg" value="">' +
          '<div class="hint" id="mc-seg-meta"></div></div>' +
        '<div class="mc-field"><label>物料名称 *</label>' +
          '<input type="text" id="mc-name" placeholder="必填；名称含 PE0xxx 将自动带出项目，如：PE0141-1326UA 锁紧条" oninput="mcOnNameInput()"></div>' +
        '<div class="mc-field"><label>规格型号 / 厂家规格型号</label>' +
          '<input type="text" id="mc-spec" placeholder="选填；同名称+同规格将被判重拦截" oninput="mcSchedulePreview()"></div>' +
        '<div class="mc-field"><label>图号</label>' +
          '<label class="mc-check"><input type="checkbox" id="mc-drawing-auto" onchange="mcOnFormChange()"> 随编码自动联号' +
          '</label><input type="text" id="mc-drawing" placeholder="手填图号；或勾选自动按段规则取号（可留空不生成）" oninput="mcSchedulePreview()">' +
          '<div class="hint">默认不自动生成图号；需联号图号（如 LM_LJ.030.0001）时勾选「随编码自动联号」</div></div>' +
        '<div class="mc-field"><label>适用项目</label>' +
          projComboHtml +
          '<div class="hint" id="mc-proj-hint"></div></div>' +
        '<div class="mc-field"><label>单位</label><input type="text" id="mc-unit" placeholder="件 / 套 / m …"></div>' +
        '<div class="mc-field"><label>备注</label><textarea id="mc-remark" rows="2" placeholder="用途/采购备注（选填）"></textarea></div>' +
        (_mc.isAdmin
          ? '<div class="mc-field"><label>自定义料号（仅管理员）</label>' +
            '<input type="text" id="mc-override" maxlength="8" placeholder="留空 = 系统自动建议下一号；8 位数字" ' +
            'style="font-family:var(--mono)" oninput="mcValidateOverride()">' +
            '<div class="hint" id="mc-override-msg"></div></div>'
          : '') +
        '<div style="margin-top:4px"><button class="btn btn-primary" style="min-width:120px" onclick="mcSubmitIssue()">发码</button>' +
          '<span class="mc-dim" style="margin-left:8px" id="mc-issue-note"></span></div>' +
      '</div>' +
      '<div class="mc-preview-card">' +
        '<div class="mc-preview-hd">建议码实时预览</div>' +
        '<div class="mc-preview-body">' +
          '<div class="mc-big-code" id="mc-prev-code"><span class="mc-prev-none">输入名称后预览</span></div>' +
          '<div class="mc-prev-drawing" id="mc-prev-drawing"></div>' +
          '<div id="mc-prev-dup"></div>' +
          '<div class="mc-dim" style="margin-top:10px" id="mc-prev-seg"></div>' +
        '</div>' +
      '</div>' +
    '</div>';

  // 使用项目：真实按键（含清空/手填老项目）视为用户主动编辑 → 名称自动提取不再覆盖
  var pj = document.getElementById('mc-project');
  if (pj) pj.addEventListener('input', function() {
    if (_mc.projAutoWrite) return;
    _mc.projTouched = true;
    mcSyncProjHint();
  });
  // 默认选第一个可发段并刷新编码段元信息 / 项目提示
  if (_mc.issueSegs.length) mcSelectSeg(_mc.issueSegs[0].key);
  mcSyncProjHint();
}

function mcOnFormChange() {
  _syncDrawingVisibility();
  mcSchedulePreview();
}

/* 发放下拉 combo 数据源：编码段（叶段） / 使用项目（PMA 已跟踪，可搜索） */
function _segComboItems() {
  return (_mc.issueSegs || []).map(function(s) {
    return { id: s.key, code: _segLabel(s), name: '现量 ' + (s.active_count != null ? s.active_count : s.count) };
  });
}

function _projComboItems() {
  return (_mc.projOptions || []).map(function(p) {
    var c = p.code, n = p.name || p.full_name || '';
    return { id: p.id != null ? p.id : c, code: c, name: n };
  }).filter(function(x) { return x.code || x.name; });
}

/* 选中某编码段：同步隐藏字段(发码读取用) + 可见下拉框显示名称 */
function mcSelectSeg(key) {
  var h = document.getElementById('mc-seg');
  var inp = document.getElementById('mc-seg-combo-input');
  if (h) h.value = key || '';
  var seg = _segByKey(key);
  if (inp) inp.value = seg ? _segLabel(seg) : '';
  mcOnSegmentChange();
}

function _findTrackedProject(code) {
  code = String(code || '').trim();
  for (var i = 0; i < _mc.projOptions.length; i++) {
    var p = _mc.projOptions[i];
    if (String(p.code) === code || p.name === code || p.full_name === code) return p;
  }
  return null;
}

/* 使用项目输入下方提示：区分「已跟踪项目」与「PMA 未跟踪的老项目」 */
function mcSyncProjHint() {
  var projEl = document.getElementById('mc-project');
  var hintEl = document.getElementById('mc-proj-hint');
  if (!projEl || !hintEl) return;
  var v = (projEl.value || '').trim();
  if (!v) { hintEl.textContent = ''; hintEl.className = 'hint'; return; }
  var p = _findTrackedProject(v);
  if (p) {
    hintEl.textContent = '已跟踪项目：' + (p.name || p.full_name || p.code || '');
    hintEl.className = 'hint mc-hint-ok';
  } else if (/^[A-Za-z]{1,4}\d{2,}/.test(v)) {
    hintEl.textContent = 'PMA 未跟踪的项目（老项目）→ 将按该编号原样记录';
    hintEl.className = 'hint mc-hint-warn';
  } else {
    hintEl.textContent = '';
    hintEl.className = 'hint';
  }
}

/* 名称含 PE0xxx（EPE4751 等整词不计）→ 自动填入使用项目；用户手动填过则不覆盖 */
function mcMaybeAutoProject() {
  if (!_mc.canIssue) return;
  var projEl = document.getElementById('mc-project');
  if (!projEl || _mc.projTouched) return;
  var name = ((document.getElementById('mc-name') || {}).value || '').trim();
  var m = name.match(/(?:^|[^A-Za-z0-9])(PE\d{3,4})/i);
  var proj = m ? m[1].toUpperCase() : null;
  if (proj) {
    _mc.projAuto = proj;
    if (((projEl.value || '').trim()) !== proj) {
      _mc.projAutoWrite = true;
      projEl.value = proj;
      _mc.projAutoWrite = false;
    }
  } else if (_mc.projAuto && ((projEl.value || '').trim()) === _mc.projAuto) {
    // 名称里不再含 PE 项目号 → 清掉之前自动填入的，避免误带
    _mc.projAuto = null;
    projEl.value = '';
  }
  mcSyncProjHint();
}

function mcOnNameInput() {
  mcMaybeAutoProject();
  mcSchedulePreview();
}

function mcOnSegmentChange() {
  _syncDrawingVisibility();
  var seg = _segByKey(document.getElementById('mc-seg').value);
  var meta = document.getElementById('mc-seg-meta');
  if (meta && seg) {
    meta.innerHTML = '前缀 <b>' + escHtml(seg.prefix) + '</b> · 序号宽 ' + seg.suffix_width +
      ' · 现量 <b>' + (seg.active_count != null ? seg.active_count : seg.count) + '</b>' +
      (seg.drawing_series ? ' · 图号联号 ' + escHtml(seg.drawing_series) : '');
  }
  mcSchedulePreview();
}

function _syncDrawingVisibility() {
  var auto = document.getElementById('mc-drawing-auto');
  var manual = document.getElementById('mc-drawing');
  if (!auto || !manual) return;
  manual.style.display = auto.checked ? 'none' : '';
  if (auto.checked) manual.value = '';
}

function mcSchedulePreview() {
  clearTimeout(_mc.prevTimer);
  _mc.prevTimer = setTimeout(function() { mcRefreshPreview(); }, 350);
}

async function mcRefreshPreview() {
  var segEl = document.getElementById('mc-seg');
  var nameEl = document.getElementById('mc-name');
  if (!segEl || !nameEl) return;
  var segKey = segEl.value;
  var name = (nameEl.value || '').trim();
  var spec = (document.getElementById('mc-spec') || {}).value || '';
  var codeBox = document.getElementById('mc-prev-code');
  var dupBox = document.getElementById('mc-prev-dup');
  var drawBox = document.getElementById('mc-prev-drawing');

  if (!segKey) { codeBox.innerHTML = '<span class="mc-prev-none">请选择编码段</span>'; return; }
  if (!name) {
    codeBox.innerHTML = '<span class="mc-prev-none">输入名称后预览建议码</span>';
    dupBox.innerHTML = ''; drawBox.innerHTML = '';
    _mc.preview = null; _mc.dupExact = []; _mc.dupSimilar = [];
    return;
  }
  codeBox.innerHTML = '<span class="mc-prev-wait">计算中…</span>';
  dupBox.innerHTML = ''; drawBox.innerHTML = '';
  var autoEl = document.getElementById('mc-drawing-auto');
  var autoDraw = !autoEl || autoEl.checked;
  var qs = 'segment_key=' + encodeURIComponent(segKey) + '&name=' + encodeURIComponent(name) +
    '&with_drawing=' + (autoDraw ? 'true' : 'false');
  if (spec) qs += '&spec=' + encodeURIComponent(spec);

  try {
    var p = await API.get('/matcode/next-code?' + qs);
    _mc.preview = p;
    _mc.dupExact = (p.dup && p.dup.exact) || [];
    _mc.dupSimilar = (p.dup && p.dup.similar) || [];
    codeBox.innerHTML = escHtml(p.code || '');
    drawBox.innerHTML = '';
    if (p.drawing && document.getElementById('mc-drawing-auto') && document.getElementById('mc-drawing-auto').checked) {
      drawBox.innerHTML = '<b>建议图号</b><span style="font-family:var(--mono)">' + escHtml(p.drawing) + '</span>';
    }
    _renderDupNote();
    var seg = _segByKey(segKey);
    var segMeta = document.getElementById('mc-prev-seg');
    if (segMeta && seg) segMeta.textContent = seg.label + ' ·' + seg.prefix + ' · 段现量 ' + (seg.active_count != null ? seg.active_count : seg.count);
  } catch (e) {
    codeBox.innerHTML = '<span class="mc-prev-none" style="color:var(--danger)">' + escHtml(e.message) + '</span>';
    _mc.preview = null; _mc.dupExact = []; _mc.dupSimilar = [];
    dupBox.innerHTML = ''; drawBox.innerHTML = '';
  }
}

function _renderDupNote() {
  var dupBox = document.getElementById('mc-prev-dup');
  if (!dupBox) return;
  var html = '';
  if (_mc.dupExact.length) {
    var codes = _mc.dupExact.map(function(m) { return m.code; }).join(' / ');
    html = '<div class="mc-dup-note warn">⚠ 已存在 <b>' + _mc.dupExact.length + '</b> 条<b>同名+同规格</b>物料：' +
      '<span class="mc-codes">' + escHtml(codes) + '</span><br>' +
      (_mc.isAdmin
        ? '系统管理员可点「发码」并在确认框选择「仍要发放（特批）」，系统仍会取新空号。'
        : '普通发码人被拦截：如需发放需系统管理员特批。') +
      '</div>';
  } else if (_mc.dupSimilar.length) {
    var scodes = _mc.dupSimilar.map(function(m) { return m.code; }).join(' / ');
    html = '<div class="mc-dup-note ok">近似的同名物料（规格不同）：<span class="mc-codes">' + escHtml(scodes) +
      '</span>，可正常发放。</div>';
  } else if (_mc.preview && _mc.preview.code) {
    html = '<div class="mc-dup-note ok">✓ 无重复，可发放</div>';
  }
  dupBox.innerHTML = html;
}

function mcValidateOverride() {
  var el = document.getElementById('mc-override');
  var msg = document.getElementById('mc-override-msg');
  if (!el || !msg) return;
  var v = (el.value || '').trim();
  msg.textContent = '';
  if (!v) { msg.textContent = ''; return; }
  if (!/^\d{8}$/.test(v)) { msg.textContent = '需为 8 位数字（段前缀 + 序号）'; return; }
  var segKey = (document.getElementById('mc-seg') || {}).value;
  var seg = _segByKey(segKey);
  if (seg && seg.prefix && v.indexOf(seg.prefix) !== 0) {
    msg.textContent = '不属于所选段前缀 ' + seg.prefix + '，请核对';
    return;
  }
  msg.textContent = '将按此自定义料号发放（需未被占用）';
}

function _issuePayload(force) {
  var segKey = (document.getElementById('mc-seg') || {}).value;
  var autoEl = document.getElementById('mc-drawing-auto');
  var autoDraw = !autoEl || autoEl.checked;   // 勾选 = 自动联号（默认关）
  var manual = ((document.getElementById('mc-drawing') || {}).value || '').trim();
  var override = _mc.isAdmin ? ((document.getElementById('mc-override') || {}).value || '').trim() : '';
  return {
    segment_key: segKey,
    name: ((document.getElementById('mc-name') || {}).value || '').trim(),
    spec: ((document.getElementById('mc-spec') || {}).value || '').trim(),
    drawing: autoDraw ? undefined : (manual || undefined),
    auto_drawing: autoDraw,
    project: ((document.getElementById('mc-project') || {}).value || '').trim() || undefined,
    unit: ((document.getElementById('mc-unit') || {}).value || '').trim() || undefined,
    remark: ((document.getElementById('mc-remark') || {}).value || '').trim() || undefined,
    override_code: override || undefined,
    force_duplicate: !!force,
  };
}

function _openBlockedDialog() {
  var codes = _mc.dupExact.map(function(m) {
    return escHtml(m.code) + ' ·' + escHtml(m.name) + (m.spec ? '（' + escHtml(m.spec) + '）' : '');
  }).join('<br>');
  openDialog('该物料已存在',
    '<div style="font-size:13px;line-height:1.9">系统按 <b>名称+规格型号</b> 判重：以下 <b>' + _mc.dupExact.length +
      '</b> 条现存物料与您输入相同。<br><span class="mc-codes" style="font-family:var(--mono);color:var(--warn)">' + codes +
      '</span><br><br>为保证「一物一码」，普通发码人不能重复发放；如需确认为新物料（如规格有差异请补全规格再发），请<strong>系统管理员特批</strong>。</div>',
    [{ text: '知道了', cls: 'btn-primary', onclick: 'closeSharedDialog()' }],
    { maxWidth: 460 });
}

function _openForceDialog() {
  var codes = _mc.dupExact.map(function(m) { return m.code; }).join(' / ');
  openDialog('重复物料 · 管理员特批',
    '<div style="font-size:13px;line-height:1.9">该物料与现存 ' + _mc.dupExact.length + ' 条重复（现存码：<span class="mc-codes" style="font-family:var(--mono)">' +
      escHtml(codes) + '</span>）。<br>特批后系统仍会分配<b>新的空料号</b>（不会复用旧码），保持号码全局唯一。<br>若实为同一物料，请改为对旧码作废处理，避免重复编码。</div>',
    [{ text: '取消', onclick: 'closeSharedDialog()' },
     { text: '仍要发放（特批）', cls: 'btn-danger', onclick: function() { closeSharedDialog(); mcDoIssue(true); } }],
    { maxWidth: 460 });
}

function mcSubmitIssue() {
  if (!_mc.canIssue) return;
  var segEl = document.getElementById('mc-seg');
  var nameEl = document.getElementById('mc-name');
  if (!segEl || !segEl.value) { showToast('请选择编码段', 'error'); return; }
  if (!nameEl || !(nameEl.value || '').trim()) { showToast('物料名称必填', 'error'); return; }
  if (_mc.dupExact.length) {
    if (_mc.isAdmin) { _openForceDialog(); return; }
    _openBlockedDialog();
    return;
  }
  mcDoIssue(false);
}

async function mcDoIssue(force) {
  var p = _issuePayload(force);
  if (!p.segment_key || !p.name) { showToast('编码段与名称必填', 'error'); return; }
  if (p.override_code) {
    if (!_mc.isAdmin) { showToast('改号仅系统管理员可操作', 'error'); return; }
    if (!/^\d{8}$/.test(p.override_code)) { showToast('自定义料号必须为 8 位数字', 'error'); return; }
  }
  var note = document.getElementById('mc-issue-note');
  if (note) note.textContent = '发放中…';
  try {
    var m = await API.post('/matcode/issue', p);
    showToast('发码成功：' + m.code, 'success');
    if (note) note.textContent = '';
    // 重置表单（保留编码段）
    ['mc-name', 'mc-spec', 'mc-unit', 'mc-remark', 'mc-drawing', 'mc-override', 'mc-project'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.value = '';
    });
    if (document.getElementById('mc-drawing-auto')) document.getElementById('mc-drawing-auto').checked = false;
    _mc.projTouched = false; _mc.projAuto = null; _mc.projAutoWrite = false;
    mcSyncProjHint();
    if (document.getElementById('mc-override-msg')) document.getElementById('mc-override-msg').textContent = '';
    _mc.preview = null; _mc.dupExact = []; _mc.dupSimilar = [];
    var box = document.getElementById('mc-prev-code');
    if (box) box.innerHTML = '<span class="mc-prev-none">已发放 ' + escHtml(m.code) + '，可继续下一单</span>';
    document.getElementById('mc-prev-dup').innerHTML = '';
    document.getElementById('mc-prev-drawing').innerHTML = '';
    _mc.dirDirty = true;
    mcRefreshCounts();
    mcOnSegmentChange();
  } catch (e) {
    if (note) note.textContent = '';
    var msg = e.message || '未知错误';
    // 后端仍可能拦截（如竞态下新出现的重复）→ 用存量的查重结果给引导
    if (msg.indexOf('已存在') >= 0 || msg.indexOf('特批') >= 0) {
      if (_mc.isAdmin && _mc.dupExact.length) _openForceDialog();
      else if (!_mc.isAdmin) showToast(msg, 'error');
      else showToast(msg, 'error');
    } else {
      showToast('发码失败: ' + msg, 'error');
    }
  }
}

/* ═══════════════ 轻量刷新段计数（发放后 /tree 现量保持一致） ═══════════════ */
async function mcRefreshCounts() {
  try {
    var t = await API.get('/matcode/tree');
    _mc.segs = t || [];
    _mc.issueSegs = (_mc.segs).filter(function(s) {
      return s.issueable && !s.closed && !s.is_group;
    });
    if (document.getElementById('mc-seg')) mcOnSegmentChange();
  } catch (e) { /* 静默：下次进页会重拉 */ }
}

