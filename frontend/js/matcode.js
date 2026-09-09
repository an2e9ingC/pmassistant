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
  catalog: [],         // /catalog 顶层树（大类→中类→叶段，含 count/active_count）
  catByKey: {},        // 分类节点 key → 节点（folder / seg）
  catPath: {},         // 节点 key → 祖先链（含自身），供面包屑
  dirAllCount: 0,      // 全部物料（在用）计数
  expanded: {},        // 左树展开状态：{ key: bool }
  catExpandedInit: false,
  dirScopeKind: 'all', // 目录右区粒度: all / folder / seg
  dirScopeKey: '',     // folder→cat key, seg→段 key
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

  // 拉全段树 + 分类目录 → 渲染发放面板/左树 → 进入上次停留的 Tab
  try {
    var tree = await API.get('/matcode/tree');
    _mc.segs = tree || [];
    _mc.issueSegs = (_mc.segs).filter(function(s) {
      return s.issueable && !s.closed && !s.is_group;
    });
    _mc.catalog = (await API.get('/matcode/catalog')) || [];
    _mcIndexCatalog();
    if (!_mc.catExpandedInit) { _mcCatDefaultExpand(); _mc.catExpandedInit = true; }
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

/* 左树「发码」按钮：切到发放 Tab 并按该段预选（目录 scope 保留，可随时切回） */
function mcTreeIssue(el) {
  if (!_mc.canIssue) return;
  var key = el.getAttribute('data-mc-key');
  if (!key || !_segByKey(key)) return;
  if (!document.getElementById('mc-panel-issue')) return;
  mcSwitchTab('issue');
  mcSelectSeg(key);
  var nameEl = document.getElementById('mc-name');
  if (nameEl) nameEl.focus();
}

/* ═══════════════ 段查找（目录/发放/面包屑共用逻辑） ═══════════════ */

function _segLabel(s) {
  return (s.label || s.key) + ' ·' + s.prefix;
}

function _segByKey(k) {
  for (var i = 0; i < _mc.segs.length; i++) if (_mc.segs[i].key === k) return _mc.segs[i];
  return null;
}

/* ── 分类目录索引（/catalog）→ 供左树渲染 / 三粒度 / 面包屑 ── */
function _mcIndexCatalog() {
  _mc.catByKey = {}; _mc.catPath = {}; _mc.dirAllCount = 0;
  (function walk(nodes, path) {
    (nodes || []).forEach(function(n) {
      var p = path.concat([n]);
      _mc.catByKey[n.key] = n;
      _mc.catPath[n.key] = p;
      if (n.kind === 'folder' && n.children) walk(n.children, p);
    });
  })(_mc.catalog, []);
  _mc.catByKey[''] = { key: '', kind: 'all', label: '全部物料' };
  _mc.catPath[''] = [];
  (_mc.catalog || []).forEach(function(t) { _mc.dirAllCount += (t.active_count || 0); });
}

function _mcNode(key) { return _mc.catByKey[key] || null; }

/* 节点 key → 「大类 › 中类 › … › 自身」标签路径（面包屑用） */
function _mcPathLabel(key) {
  var p = _mc.catPath[key];
  if (!p || !p.length) return '';
  return p.map(function(n) { return n.label; }).join(' › ');
}

/* 顶层大类默认展开；中类及更深默认收起（叶段随父展开露出） */
function _mcCatDefaultExpand() {
  _mc.expanded = {};
  (_mc.catalog || []).forEach(function(top) { _mc.expanded[top.key] = true; });
}

/* ═══════════════ Tab 1 — 物料目录 ═══════════════ */

function _renderDirShell() {
  var panel = document.getElementById('mc-panel-dir');
  panel.innerHTML =
    '<div class="mc-dir-layout">' +
      '<aside class="mc-dir-tree card" style="padding:0">' +
        '<div class="mc-tree-hd"><span class="mc-tree-hd-t">物料分类</span>' +
          '<button type="button" class="mc-tree-collapse" onclick="mcCollapseAll()" title="全部收起：只保留一级大类（点击行前箭头可展开下级）">收起</button></div>' +
        '<div class="mc-tree-body" id="mc-cat-tree"></div>' +
      '</aside>' +
      '<div class="mc-dir-main">' +
        '<div class="mc-filterbar">' +
          '<div class="search-wrap" style="max-width:320px">' +
            '<svg class="search-ico" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">' +
              '<circle cx="6.5" cy="6.5" r="5"/><line x1="10.5" y1="10.5" x2="14" y2="14"/>' +
            '</svg>' +
            '<input class="search-inp" id="mc-dir-q" placeholder="料号 / 名称 / 规格 / 厂商 / 图号… 输入即全库过滤" ' +
              'oninput="mcDirQChange()" onkeydown="if(event.key===\'Enter\'){clearTimeout(_mc.dirQTimer);mcDirApply()}">' +
            '<button class="search-clear" onclick="clearTimeout(_mc.dirQTimer);var q=document.getElementById(\'mc-dir-q\');if(q)q.value=\'\';mcDirApply()" title="清除">&times;</button>' +
          '</div>' +
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
        '<div class="section-hd" style="margin:10px 0 8px">' +
          '<div class="section-title">物料列表 <span id="mc-dir-title" style="font-size:11px;color:var(--muted);font-weight:400"></span></div>' +
          '<div class="section-acts" style="font-size:11px;color:var(--muted)">料号点击查看详情；编辑/停用/作废需「物料编码发行」权限</div>' +
        '</div>' +
        '<div class="card" style="padding:0"><div id="mc-dir-table"></div></div>' +
        '<div class="mc-pager" id="mc-dir-pager"></div>' +
      '</div>' +
    '</div>';
  _renderCatTree();
}

/* ═══════════════ 目录左侧分类树（大类→中类→叶段） ═══════════════ */

function _mcIsExpanded(key) { return !!_mc.expanded[key]; }

function _mcTreeRowAll() {
  var sel = _mc.dirScopeKind === 'all';
  return '<div class="dt-tree-node' + (sel ? ' selected' : '') + '" data-mc-key="" data-mc-kind="all"' +
    ' style="padding-left:4px" onclick="mcCatClick(this)">' +
    '<span style="width:16px;flex-shrink:0"></span>' +
    '<span class="dt-tree-icon">🗂</span>' +
    '<span class="dt-tree-label">全部物料</span>' +
    '<span class="dt-tree-badge">' + (_mc.dirAllCount || 0) + '</span>' +
    '</div>';
}

function _mcTreeFolder(n, depth) {
  var key = n.key;
  var sel = (_mc.dirScopeKind === 'folder' && _mc.dirScopeKey === key);
  var open = _mcIsExpanded(key);
  var empty = !(n.children && n.children.length);   // ERP 空分类（无段）→ 灰显占位
  var arrow = empty
    ? '<span style="width:16px;flex-shrink:0"></span>'
    : '<span class="dt-tree-arrow' + (open ? '' : ' collapsed') + '" data-mc-key="' + escHtml(key) + '"' +
      ' onclick="event.stopPropagation();mcCatToggleClick(this)">▼</span>';
  var cls = 'dt-tree-node non-leaf' + (sel ? ' selected' : '') + (empty ? ' dt-tree-empty' : '');
  var html = '<div class="' + cls + '"' +
    ' data-mc-key="' + escHtml(key) + '" data-mc-kind="folder"' +
    ' style="padding-left:' + (4 + depth * 20) + 'px" onclick="mcCatClick(this)">' +
    arrow +
    '<span class="dt-tree-icon">📁</span>' +
    '<span class="dt-tree-label"' + (empty ? ' title="空分类（当前无物料）"' : '') + '>' +
      escHtml(n.label) + '</span>' +
    '<span class="dt-tree-badge">' + (n.active_count || 0) + '</span>' +
    '</div>';
  if (open && n.children) {
    n.children.forEach(function(ch) {
      html += ch.kind === 'folder' ? _mcTreeFolder(ch, depth + 1) : _mcTreeSeg(ch, depth + 1);
    });
  }
  return html;
}

function _mcTreeSeg(n, depth) {
  var key = n.key;
  var sel = (_mc.dirScopeKind === 'seg' && _mc.dirScopeKey === key);
  var s = _segByKey(key);
  var canF = _mc.canIssue && s && s.issueable && !s.closed && !s.is_group;
  var closedTag = (s && s.closed) ? '<span class="mc-pill legacy" style="margin-left:5px">冻结</span>' : '';
  var acts = canF
    ? '<span class="dt-tree-acts"><button type="button" class="btn btn-xs" data-mc-key="' + escHtml(key) + '"' +
      ' onclick="event.stopPropagation();mcTreeIssue(this)" title="切换到发放并按此段预选">发码</button></span>'
    : '';
  return '<div class="dt-tree-node' + (sel ? ' selected' : '') + '"' +
    ' data-mc-key="' + escHtml(key) + '" data-mc-kind="seg"' +
    ' style="padding-left:' + (4 + depth * 20) + 'px" onclick="mcCatClick(this)">' +
    '<span style="width:16px;flex-shrink:0"></span>' +
    '<span class="dt-tree-icon"></span>' +
    '<span class="dt-tree-label" title="' + escHtml(n.label) + ' ' + escHtml(n.prefix || '') + '">' + escHtml(n.label) +
      '<span class="mc-dim" style="margin-left:4px;font-size:10.5px">' + escHtml(n.prefix || '') + '</span>' + closedTag +
    '</span>' +
    '<span class="dt-tree-badge">' + (n.active_count || 0) + '</span>' +
    acts + '</div>';
}

function _renderCatTree() {
  var host = document.getElementById('mc-cat-tree');
  if (!host) return;
  var st = host.scrollTop;  // 折叠/展开后保持滚动位置
  var html = _mcTreeRowAll();
  (_mc.catalog || []).forEach(function(top) { html += _mcTreeFolder(top, 0); });
  host.innerHTML = html;
  host.scrollTop = st;
}

/* 折叠箭头：仅切换展开/收起，不改变右区 scope */
function mcCatToggleClick(el) {
  var key = el.getAttribute('data-mc-key');
  if (!key) return;
  _mc.expanded[key] = !_mcIsExpanded(key);
  _renderCatTree();
}

/* 树行点击：folder=展开(若收)+按 cat 过滤；seg=按段过滤；all=全库 */
function mcCatClick(el) {
  mcPickScope(el.getAttribute('data-mc-kind') || 'all', el.getAttribute('data-mc-key') || '');
}

/* 选择右区粒度并刷新列表；自动展开祖先链，保证树高亮可见 */
function mcPickScope(kind, key) {
  kind = kind || 'all'; key = key || '';
  _mc.dirScopeKind = kind;
  _mc.dirScopeKey = key;
  var path = _mc.catPath[key];
  var rebuild = false;
  if (kind !== 'all' && path) {
    path.forEach(function(n) {
      if (n.kind === 'folder' && !_mcIsExpanded(n.key)) {
        _mc.expanded[n.key] = true; rebuild = true;
      }
    });
  }
  if (rebuild) _renderCatTree();
  _mcTreeSyncHighlight();
  _mc.dirPage = 1;
  mcDirLoad();
}

function _mcTreeSyncHighlight() {
  var host = document.getElementById('mc-cat-tree');
  if (!host) return;
  var old = host.querySelector('.dt-tree-node.selected');
  if (old) old.classList.remove('selected');
  var nd = host.querySelector('.dt-tree-node[data-mc-key="' + _mc.dirScopeKey + '"]');
  if (nd) nd.classList.add('selected');
}

/* 当前目录 scope 的中文标签：加入「物料列表」标题，补足面包屑移除后的归属感。
   搜索时跨全库、不随 scope 收窄 → 返回空串。 */
function _mcScopeLabel() {
  var qEl = document.getElementById('mc-dir-q');
  var q = qEl ? (qEl.value || '').trim() : '';
  if (q) return '';
  if (_mc.dirScopeKind === 'folder') {
    var n = _mcNode(_mc.dirScopeKey);
    return n ? n.label : '';
  }
  if (_mc.dirScopeKind === 'seg') {
    var s = _segByKey(_mc.dirScopeKey);
    return s ? s.label : '';
  }
  return '';
}

/* 一键收起：清空展开状态，分类树只保留一级大类（全部物料根行常显） */
function mcCollapseAll() {
  _mc.expanded = {};
  _renderCatTree();
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
    { key: 'spec', title: '规格型号', width: '150px', align: 'left',
      render: function(v) { return v ? '<span class="mc-spec">' + escHtml(v) + '</span>' : '<span class="mc-dim">—</span>'; } },
    { key: 'manufacturer', title: '生产厂商', width: '140px', align: 'left',
      render: function(v) {
        return v ? '<span class="mc-manu" title="' + escHtml(v) + '">' + escHtml(v) + '</span>' : '<span class="mc-dim">—</span>';
      } },
    { key: 'unit', title: '单位', width: '54px', align: 'left',
      render: function(v) { return v ? escHtml(v) : '<span class="mc-dim">—</span>'; } },
    { key: 'drawing', title: '图号', width: '132px', align: 'left',
      render: function(v) { return v ? '<span class="mc-dim" style="font-size:11px">' + escHtml(v) + '</span>' : '—'; } },
    { key: 'segment_label', title: '段', width: '100px', align: 'left',
      render: function(v) { return escHtml(v || ''); } },
    { key: 'project', title: '项目', width: '92px', align: 'left',
      render: function(v) { return v ? '<span class="mc-dim">' + escHtml(v) + '</span>' : '—'; } },
    { key: 'remark', title: '备注', width: '150px', align: 'left',
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
  var q = (document.getElementById('mc-dir-q') || {}).value ? document.getElementById('mc-dir-q').value.trim() : '';
  // 搜索跨全库、不随分类收窄 → q 存在时丢弃 cat/segment（三粒度仅作浏览定位）
  var scoped = !q;
  return {
    q: q,
    cat: scoped && _mc.dirScopeKind === 'folder' ? _mc.dirScopeKey : '',
    segment: scoped && _mc.dirScopeKind === 'seg' ? _mc.dirScopeKey : '',
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
  if (f.cat) qs += '&cat=' + encodeURIComponent(f.cat);
  else if (f.segment) qs += '&segment=' + encodeURIComponent(f.segment);
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
    if (titleEl) {
      var lbl = _mcScopeLabel();
      titleEl.textContent = lbl ? '（' + lbl + ' · 第 ' + _mc.dirPage + '/' + pages + ' 页）'
                               : '（第 ' + _mc.dirPage + '/' + pages + ' 页）';
    }
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
  if (f.cat) qs += '&cat=' + encodeURIComponent(f.cat);
  else if (f.segment) qs += '&segment=' + encodeURIComponent(f.segment);
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
    var head = ['料号', '段', '名称', '规格型号', '生产厂商', '单位', '图号', '备注', '适用项目', '状态', '旧前缀', '更新时间'];
    var lines = [head.join(',')];
    rows.forEach(function(m) {
      var arr = [m.code, m.segment_label || '', m.name || '', m.spec || '', m.manufacturer || '', m.unit || '',
        m.drawing || '', m.remark || '', m.project || '',
        { active: '在用', stopped: '停用', void: '已作废' }[m.status] || m.status,
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
      '<div class="k">生产厂商</div><div class="v">' + escHtml(m.manufacturer || '—') + '</div>' +
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
    '<div class="mc-field"><label>生产厂商</label><input type="text" id="mc-edit-manufacturer" value="' + escHtml(m.manufacturer || '') + '" placeholder="元器件：供应商/品牌"></div>' +
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
    name: g('mc-edit-name'), spec: g('mc-edit-spec'), manufacturer: g('mc-edit-manufacturer'),
    drawing: g('mc-edit-drawing'), project: g('mc-edit-project'),
    unit: g('mc-edit-unit'), remark: g('mc-edit-remark'),
  };
  if (!payload.name || !payload.name.trim()) { showToast('名称必填', 'error'); return; }
  try {
    await API.put('/matcode/materials/' + id, {
      name: payload.name.trim(), spec: payload.spec, manufacturer: payload.manufacturer,
      drawing: payload.drawing, project: payload.project, unit: payload.unit, remark: payload.remark,
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
    '<div class="mc-issue">' +
      /* ① 建议码实时预览 —— 置顶居中，整页视觉焦点 */
      '<div class="mc-preview-card">' +
        '<div class="mc-preview-hd">建议码实时预览</div>' +
        '<div class="mc-preview-body">' +
          '<div class="mc-big-code" id="mc-prev-code"><span class="mc-prev-none">输入物料名称后预览建议码</span></div>' +
          '<div class="mc-prev-drawing" id="mc-prev-drawing"></div>' +
          '<div class="mc-prev-dup" id="mc-prev-dup"></div>' +
          '<div class="mc-dim mc-prev-seg" id="mc-prev-seg"></div>' +
        '</div>' +
      '</div>' +
      /* ② 录入表单 —— 两列网格；编码段/名称/图号/备注/管理员覆盖整行，其余两两一组 */
      '<div class="mc-issue-card card-pad">' +
        '<div class="section-hd" style="margin-bottom:14px"><div class="section-title">单条发码</div>' +
          '<div class="section-acts" style="font-size:11px;color:var(--muted)">系统按段自动取下一未占用号（段满/被占 409 拦截）</div></div>' +
        '<div class="mc-fields-grid">' +
          '<div class="mc-field mc-span2"><label>编码段</label>' +
            '<div class="mc-dim" id="mc-seg-crumb" style="margin:0 0 5px;font-size:11.5px;line-height:1.5"></div>' +
            segComboHtml +
            '<input type="hidden" id="mc-seg" value="">' +
            '<div class="hint" id="mc-seg-meta"></div></div>' +
          '<div class="mc-field mc-span2"><label>物料名称 *</label>' +
            '<input type="text" id="mc-name" placeholder="必填；名称含 PE0xxx 将自动带出项目，如：PE0141-1326UA 锁紧条" oninput="mcOnNameInput()"></div>' +
          '<div class="mc-field"><label>生产厂商（元器件/外购件等）</label>' +
            '<input type="text" id="mc-mfr" placeholder="选填；品牌/供应商，如 TI / Murata"></div>' +
          '<div class="mc-field"><label>单位</label>' +
            '<input type="text" id="mc-unit" placeholder="件 / 套 / m …"></div>' +
          '<div class="mc-field"><label>规格型号 / 厂家规格型号</label>' +
            '<input type="text" id="mc-spec" placeholder="选填；同名称+同规格将被判重拦截" oninput="mcSchedulePreview()"></div>' +
          '<div class="mc-field"><label>适用项目</label>' +
            projComboHtml +
            '<div class="hint" id="mc-proj-hint"></div></div>' +
          '<div class="mc-field mc-span2"><label>图号</label>' +
            '<label class="mc-check"><input type="checkbox" id="mc-drawing-auto" onchange="mcOnFormChange()"> 随编码自动联号' +
            '</label><input type="text" id="mc-drawing" placeholder="手填图号；或勾选自动按段规则取号（可留空不生成）" oninput="mcSchedulePreview()">' +
            '<div class="hint">默认不自动生成图号；需联号图号（如 LM_LJ.030.0001）时勾选「随编码自动联号」</div></div>' +
          '<div class="mc-field mc-span2"><label>备注</label>' +
            '<textarea id="mc-remark" rows="2" placeholder="用途/采购备注（选填）"></textarea></div>' +
          (_mc.isAdmin
            ? '<div class="mc-field mc-span2"><label>自定义料号（仅管理员）</label>' +
              '<input type="text" id="mc-override" maxlength="8" placeholder="留空 = 系统自动建议下一号；8 位数字" ' +
              'style="font-family:var(--mono)" oninput="mcValidateOverride()">' +
              '<div class="hint" id="mc-override-msg"></div></div>'
            : '') +
          '<div class="mc-issue-actions">' +
            '<button class="btn btn-primary" style="min-width:120px" onclick="mcSubmitIssue()">发码</button>' +
            '<span class="mc-dim" id="mc-issue-note"></span></div>' +
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
  var segKey = (document.getElementById('mc-seg') || {}).value;
  var seg = _segByKey(segKey);
  var crumb = document.getElementById('mc-seg-crumb');
  if (crumb) crumb.textContent = segKey ? _mcPathLabel(segKey) : '';
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
    _mc.dupExactN = 0; _mc.dupSimilarN = 0;
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
    _mc.dupExactN = (p.dup && p.dup.exact_count != null) ? p.dup.exact_count : _mc.dupExact.length;
    _mc.dupSimilarN = (p.dup && p.dup.similar_count != null) ? p.dup.similar_count : _mc.dupSimilar.length;
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
    _mc.dupExactN = 0; _mc.dupSimilarN = 0;
    dupBox.innerHTML = ''; drawBox.innerHTML = '';
  }
}

function _mcDupListHtml(items) {
  var out = '<div class="mc-dup-list">';
  (items || []).forEach(function(m) {
    out += '<div class="mc-dup-item"><span class="mc-codes">' + escHtml(m.code || '') + '</span>' +
      (m.name ? '：' + escHtml(m.name) : '') + '</div>';
  });
  out += '</div>';
  return out;
}

function _renderDupNote() {
  var dupBox = document.getElementById('mc-prev-dup');
  if (!dupBox) return;
  var html = '';
  var exact = _mc.dupExact || [];
  var similar = _mc.dupSimilar || [];
  var exactN = (_mc.dupExactN != null) ? _mc.dupExactN : exact.length;
  var similarN = (_mc.dupSimilarN != null) ? _mc.dupSimilarN : similar.length;
  var actNote = _mc.isAdmin
    ? '系统管理员可点「发码」并在确认框选择「仍要发放（特批）」，系统仍会取新空号。'
    : '普通发码人被拦截：如需发放需系统管理员特批。';
  if (exact.length) {
    var head = '⚠ 已存在 <b>' + exactN + '</b> 条<b>同名+同规格</b>物料：';
    if (exact.length === 1) {
      var m = exact[0];
      html = '<div class="mc-dup-note warn">' + head +
        '<span class="mc-codes">' + escHtml(m.code || '') + '</span>' +
        (m.name ? '：' + escHtml(m.name) : '') + '<br>' + actNote + '</div>';
    } else {
      html = '<div class="mc-dup-note warn">' + head + _mcDupListHtml(exact) +
        (exactN > exact.length ? '<div class="mc-dim">… 共 ' + exactN + ' 条，仅列前 ' + exact.length + '</div>' : '') +
        '<div class="mc-dup-act">' + actNote + '</div></div>';
    }
  } else if (similar.length) {
    html = '<div class="mc-dup-note ok">可正常发放编码，但存在近似的同名物料（规格不同），请关注：' +
      _mcDupListHtml(similar) +
      (similarN > similar.length ? '<div class="mc-dim">… 共 ' + similarN + ' 条，仅列前 ' + similar.length + '</div>' : '') +
      '</div>';
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
    manufacturer: ((document.getElementById('mc-mfr') || {}).value || '').trim() || undefined,
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
    ['mc-name', 'mc-spec', 'mc-mfr', 'mc-unit', 'mc-remark', 'mc-drawing', 'mc-override', 'mc-project'].forEach(function(id) {
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

/* ═══════════════ 轻量刷新段计数（发放后 /tree + /catalog 计数保持一致） ═══════════════ */
async function mcRefreshCounts() {
  try {
    var t = await API.get('/matcode/tree');
    _mc.segs = t || [];
    _mc.issueSegs = (_mc.segs).filter(function(s) {
      return s.issueable && !s.closed && !s.is_group;
    });
    var c = await API.get('/matcode/catalog');
    _mc.catalog = c || [];
    _mcIndexCatalog();
    if (document.getElementById('mc-cat-tree')) {
      // 目录已渲染过：重建树（scope/展开状态保留在 _mc 上）
      _renderCatTree();
    }
    if (document.getElementById('mc-seg')) mcOnSegmentChange();
  } catch (e) { /* 静默：下次进页会重拉 */ }
}

