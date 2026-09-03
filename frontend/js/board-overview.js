/* ═══════════════════════════════════════════════════
   板卡管理总览（Issue #11）— 跨所有项目的硬件板卡交付状态
   数据源：GET /api/delivery/overview（行=板卡 + 项目代号/名称）
   - 顶部状态卡：逐状态快捷过滤（不含「生产中」；已维修并入已交付口径），单选高亮，
     顺序与后端 BOARD_STATUSES 一致（在库→…→维修中→已报废→已交付）
   - 筛选条：项目 / 产品型号 / 序列号与归属 —— 搜索过滤框（同项目总览/产品总览）
   - 表格：DataTable，项目编号 / 产品型号 跨行合并；
     项目编号列可排序（按编号数值 从大到小 为默认，点击表头在两态间切换 降/升）
   - 序号列：位于产品编号前，按“项目+产品型号”分组从 1 计数，表达该型号板卡数量
   - 行操作与「项目详情 → 交付状态」完全一致（共享 board-mgmt.js）：
     状态流转（所有登录用户可点击，维修中除外）、时间线（所有登录用户）、
     编辑 / 删除（需 admin/board_manage 权限，通常为库房管理/管理员）
   - BoardMgr.setContext() 注入本页数据源；操作后广播 BOARD_CHANGED 自动刷新
   共享 pill：components.js 的 boardStatusPill / BOARD_PILL_CLASS（勿在本文件重复定义）
═══════════════════════════════════════════════════ */

/* 项目编号排序键：取尾部数字段作为数值（PE0450 → 450），无数字段按 -1。
   “从大到小”= 数字段降序，前缀仅在同数字时兜底。 */
function _projNumKey(code) {
  var c = String(code || '');
  var m = /^(.*?)(\d+)(.*)$/.exec(c);
  if (!m) return { head: c, n: -1, tail: '', raw: c };
  return { head: m[1], n: parseInt(m[2], 10), tail: m[3], raw: c };
}
function _projCompare(a, b, dir) {
  var ka = _projNumKey(a.project_code), kb = _projNumKey(b.project_code);
  var d = ka.n - kb.n;
  if (d === 0) d = (ka.raw < kb.raw ? -1 : ka.raw > kb.raw ? 1 : 0);
  return dir === 'asc' ? d : -d;
}

var ovBoard = {
  _boards: [],        // 全量行（含分组键），规范序 = 项目编号降序 + 型号/序号升序
  _summary: null,
  _meta: null,        // board_meta（状态目录/schema），供状态流转对话框
  _users: [],         // /users/options → [{code,name}]，供共享操作的用户下拉
  _usersLoaded: false,
  _prodCache: {},     // 项目代号 → 关联产品列表（编辑对话框下拉）
  _statusKey: 'all',
  _project: '',
  _product: '',
  _q: '',
  _table: null,
  _cur: [],           // 最近一次 setData 的筛选结果（规范序），供“取消排序”复原
  _busBound: false,
  _resizeBound: false,

  // 卡片键 → 板卡状态值（目录见后端 BOARD_STATUSES；null=全部。生产中无卡；
  // delivered 数组 = 交付口径：已交付 + 已维修，已维修不再单独成卡）
  _KEY_STATUS: {
    all: null,
    stock: '在库',
    power: '硬件上电',
    debug: '研发调试',
    cust: '客户联调',
    test: '测试',
    coating: '三防',
    assy: '装配',
    repairing: '维修中',
    scrapped: '已报废',
    delivered: ['已交付', '已维修']
  },

  init: async function() {
    var root = document.getElementById('bdov-table');
    if (!root) return; // 防御：视图容器未挂载
    root.innerHTML = '<div class="empty-state" style="padding:24px">加载板卡数据…</div>';
    this._syncContext();            // 板卡操作数据源指向本总览页
    this._ensureBus();              // 注册 BOARD_CHANGED 刷新（仅一次）
    // 每次进入视图还原筛选默认态
    this._statusKey = 'all'; this._project = ''; this._product = ''; this._q = '';
    ['bdov-f-project', 'bdov-f-product', 'bdov-f-q'].forEach(function(id) {
      var el = document.getElementById(id); if (el) el.value = '';
    });
    this._syncStatusChips();
    try {
      var d = await API.get('/delivery/overview');
      this._summary = d.summary || {};
      this._meta = d.meta || {};
      this._initRows((d.boards || []).slice());
      await this._ensureUsers();          // 归属人/持有人显示名 + 共享操作用户表
      await loadDisplayNameCache();
      this._fillKpis();
      this._renderTable();
      this._bindResize();
      // 字体/指标卡晚排版后再校一次表格高度（KPI 换行会影响 dt 顶边）
      var that = this;
      setTimeout(function() { that._resizeTable(); }, 150);
    } catch (e) {
      root.innerHTML = '<div class="empty-state" style="padding:24px">加载失败：' + escHtml(e.message || '未知错误') + '</div>';
      showToast('板卡数据加载失败: ' + (e.message || '未知错误'), 'error');
    }
  },

  /* 板卡操作后（编辑/状态切换/删除）自动刷新：保留当前状态卡与筛选搜索词 */
  reload: async function() {
    var root = document.getElementById('bdov-table');
    if (!root) return; // 视图未激活时不刷新
    try {
      var d = await API.get('/delivery/overview');
      this._summary = d.summary || {};
      this._meta = d.meta || this._meta || {};
      this._initRows((d.boards || []).slice());
      await this._ensureUsers();
      await loadDisplayNameCache();
      this._fillKpis();
      this._renderTable();
    } catch (e) {
      showToast('板卡数据刷新失败: ' + (e.message || '未知错误'), 'error');
    }
  },

  _syncContext: function() {
    if (typeof BoardMgr === 'undefined') return;
    var that = this;
    BoardMgr.setContext({
      getBoard: function(id) { return that._findBoard(id); },
      getMeta: function() { return that._meta || { statuses: [], manual_targets: [], schema: {}, repair_statuses: [] }; },
      getUsers: function() { return that._users || []; },
      getProducts: function(board) { return that._boardProducts(board); },
      comboCode: function() { return ''; },   // 总览页无「新增板卡」入口
      displayName: function(u) { return getDisplayName(u); }
    });
  },

  _ensureBus: function() {
    if (this._busBound || typeof EventBus === 'undefined') return;
    this._busBound = true;
    var that = this;
    EventBus.on(EVENTS.BOARD_CHANGED, function() {
      if (typeof isViewActive === 'function' && isViewActive('board-delivery')) that.reload();
    });
  },

  _ensureUsers: async function() {
    if (this._usersLoaded) return this._users;
    try { this._users = (await API.get('/users/options')) || []; }
    catch (e) { this._users = []; }
    this._usersLoaded = true;
    return this._users;
  },

  // 编辑对话框：某项目板卡的产品下拉 = 该项目关联产品（缓存，避免重复请求）
  _boardProducts: async function(board) {
    var param = board ? (board.project_code || (board.project_id != null ? String(board.project_id) : '')) : '';
    if (!param) return [];
    if (this._prodCache[param]) return this._prodCache[param];
    var list = [];
    try {
      var d = await API.get('/projects/' + encodeURIComponent(param));
      list = (d && d.products) || [];
    } catch (e) { list = []; }
    this._prodCache[param] = list;
    return list;
  },

  // 行预处理：分组键（项目列按 project_id 分组；型号列按 项目+型号 分组，避免跨项目误合并）+ 规范排序
  // 规范序：项目编号 从大到小 → 型号升序 → 产品编号数值升序（同项目块内保持型号/编号相邻）
  _initRows: function(rows) {
    rows.forEach(function(r) {
      r._grpProj = String(r.project_id != null ? r.project_id : (r.project_code || ''));
      r._grp = r._grpProj + '|' + (r.product_code || '');
    });
    rows.sort(function(a, b) {
      var d = _projCompare(a, b, 'desc');
      if (d) return d;
      var ca = a.product_code || '', cb = b.product_code || '';
      if (ca !== cb) return ca < cb ? -1 : 1;
      return String(a.serial_no || '').localeCompare(String(b.serial_no || ''), undefined, { numeric: true });
    });
    this._boards = rows;
  },

  // 填充状态卡计数（all = 全部已建档；delivered = 交付口径 已交付+已维修）
  _fillKpis: function() {
    var by = this._summary.by_status || {};
    var that = this;
    Object.keys(this._KEY_STATUS).forEach(function(key) {
      var st = that._KEY_STATUS[key];
      var n;
      if (key === 'all') n = that._summary.total || that._boards.length;
      else if (Array.isArray(st)) { n = 0; for (var i = 0; i < st.length; i++) n += (by[st[i]] || 0); }
      else n = (by[st] || 0);
      var el = document.getElementById('bdov-kpi-' + key);
      if (el) el.textContent = n;
    });
  },

  // 表格高度填满可用空间：dt 顶 → 底部固定条(alert-ticker/notif-bar)上沿(没有则视口底)，留 content 底部 padding 余量。
  // 复用 app.js 的 _ucBottomBarTop()（ticker/notif 未显示时返回视口高度），随窗口/视图激活重算。
  _resizeTable: function() {
    var dt = this._table;
    if (!dt || !dt._scrollEl) return;
    if (typeof isViewActive === 'function' && !isViewActive('board-delivery')) return; // 视图未激活不量（display:none 时 top 不可靠）
    var barTop = (typeof window._ucBottomBarTop === 'function') ? window._ucBottomBarTop() : window.innerHeight;
    var top = dt._scrollEl.getBoundingClientRect().top;
    var avail = Math.round(barTop - top - 24);
    dt._scrollEl.style.maxHeight = Math.max(160, avail) + 'px';
  },
  // 窗口缩放时重算表格高度（仅视图激活时生效）
  _bindResize: function() {
    if (this._resizeBound) return;
    this._resizeBound = true;
    var that = this;
    window.addEventListener('resize', function() { that._resizeTable(); });
  },

  _renderTable: function() {
    var container = document.getElementById('bdov-table');
    if (!container) return;
    var that = this;
    var serialChip = function(v, row) {
      var s = v != null ? String(v) : '';
      return s
        ? '<span class="proj-code-btn" style="font-family:var(--mono);font-size:12px;padding:2px 8px" onclick="event.stopPropagation();showBoardTimeline(' + row.id + ')" title="查看时间线">' + escHtml(s) + '</span>'
        : '<span style="font-size:12px;color:var(--muted)">—</span>';
    };
    // 高度不写死：由 _resizeTable() 按「表格顶 → 底部条/视口底」实测填满，避免固定偏移在不同窗口/状态卡换行下留大片空白
    this._table = new DataTable({
      container: container,
      density: 'compact',
      emptyText: '无匹配板卡',
      columns: [
        // 项目编号：标准 projCodeTag 控件；可排序，默认从大到小
        { key: 'project_code', title: '项目编号', width: '128px', minWidth: 128, sortable: true, rowspan: '_grpProj', render: function(v, row) {
          var code = v || String(row.project_id != null ? row.project_id : '');
          if (!code) return '<span style="font-size:12px;color:var(--muted)">—</span>';
          var handler = "openProject('" + escHtml(code).replace(/'/g, "\\'") + "')";
          return projCodeTag(code, handler, row.project_name || code);
        }},
        // 产品型号：同项目内跨行合并，型号名悬浮 title；数量信息无论 1 还是多块都显示 (n)
        { key: 'product_code', title: '产品型号', minWidth: 150, rowspan: '_grp', render: function(v, row, idx, span) {
          if (!v) {
            return (span > 1 ? '<span style="font-size:10px;color:var(--muted)">(' + span + ') </span>' : '')
              + '<span style="font-size:12px;color:var(--muted)">—</span>';
          }
          var tip = row.product_name && row.product_name !== v ? v + ' · ' + row.product_name : v;
          var chip = '<span style="font-family:var(--mono);font-size:11.5px;font-weight:600;color:var(--accent);cursor:default;white-space:nowrap" title="' + escHtml(tip) + '">' + escHtml(v) + '</span>';
          return chip + ' <span style="font-size:10px;color:var(--muted)">(' + span + ')</span>';
        }},
        // 序号：按“项目+型号”组从 1 计数，表示该型号板卡数量
        { key: '_seq', title: '序号', width: '48px', minWidth: 46, align: 'center', render: function(v) {
          return '<span style="font-family:var(--mono);font-size:11px;color:var(--muted)">' + (v != null ? v : '') + '</span>';
        }},
        { key: 'serial_no', title: '产品编号', minWidth: 150, render: function(v, row) { return serialChip(v, row); } },
        // 状态流转：与项目详情交付状态一致 —— 所有登录用户可点击当前状态流转（维修中除外，经维修 Bug）
        { key: 'status', title: '状态流转', minWidth: 240, align: 'center', render: function(v, row) {
          var prevPill = row.prev_status
            ? '<span class="pill ' + (BOARD_PILL_CLASS[row.prev_status] || 'pending') + ' fx4" style="opacity:.72">' + escHtml(row.prev_status) + '</span>'
            : '<span class="pill pending fx4">系统初始</span>';
          var canSwitch = row.status !== '维修中';
          var curPill = boardStatusPill(v, canSwitch ? 'showBoardStatusDialog(' + row.id + ')' : '', canSwitch ? '点击切换状态' : '维修状态需通过维修 Bug 流转', 'fx4');
          return '<div style="display:flex;align-items:center;justify-content:center;gap:5px;flex-wrap:nowrap;white-space:nowrap">' + prevPill + '<span style="color:var(--muted);font-size:11px">→</span>' + curPill + '</div>';
        }},
        { key: 'owner', title: '人员流转', minWidth: 190, align: 'center', render: function(v, row) {
          var prevOwner = row.prev_owner ? getDisplayName(row.prev_owner) : '';
          var prevSpan = prevOwner
            ? '<span class="pill person fx3" style="opacity:.72">' + escHtml(prevOwner) + '</span>'
            : '<span class="pill person fx3">系统</span>';
          var curSpan = '<span class="pill person-cur fx3">' + escHtml(getDisplayName(v) || v || '—') + '</span>';
          return '<div style="display:flex;align-items:center;justify-content:center;gap:5px;flex-wrap:nowrap;white-space:nowrap">' + prevSpan + '<span style="color:var(--muted);font-size:11px">→</span>' + curSpan + '</div>';
        }},
        { key: 'current_holder', title: '当前持有人', minWidth: 110, render: function(v) {
          return '<span style="font-size:12px;color:var(--muted)">' + escHtml(getDisplayName(v) || v || '—') + '</span>';
        }},
        { key: 'updated_at', title: '最近更新', minWidth: 120, render: function(v) {
          return '<span style="font-size:11px;color:var(--muted);white-space:nowrap">' + (v ? fmtISODateTime(v) : '—') + '</span>';
        }},
        // 操作列：跳项目交付并高亮（所有登录用户）→ 时间线（所有登录）→ 编辑/删除（需板卡管理权限）
        { key: 'actions', title: '操作', width: '176px', minWidth: 176, render: function(v, row) {
          var pc = escHtml(String(row.project_code != null ? row.project_code : (row.project_id != null ? row.project_id : ''))).replace(/'/g, "\\'");
          var ser = escHtml(String(row.serial_no || '')).replace(/'/g, "\\'");
          var h = (pc && ser)
            ? '<button class="btn btn-icon" title="跳转项目详情→交付状态并定位此板卡" onclick="event.stopPropagation();gotoView(\'detail\', { params: [\'' + pc + '\', \'delivery\', \'' + ser + '\'] })">' +
              '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></button>'
            : '';
          h += '<button class="btn btn-icon" onclick="showBoardTimeline(' + row.id + ')" title="查看时间线">' +
            '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5"/><path d="M9 2l3 3 3-3"/></svg></button>';
          if (BoardMgr.hasBoardPerm()) h += iconEdit('showBoardForm(' + row.id + ')', '编辑');
          if (BoardMgr.hasBoardPerm()) h += iconDelete('deleteBoard(' + row.id + ')', '删除');
          return h;
        }}
      ],
      externalSort: function(colKey, dir, cb) {
        var data = this._data.slice();
        data.sort(function(a, b) { return _projCompare(a, b, dir); });
        cb(data);
      }
    });
    var dt = this._table;
    // 项目编号列排序：仅「倒序(desc) / 正序(asc)」两态；默认从大到小，点表头在两态间切换
    var baseToggle = dt._toggleSort.bind(dt);
    dt._toggleSort = function(colKey) {
      if (colKey !== 'project_code') { baseToggle(colKey); return; }
      if (dt._sortCol === colKey) {
        dt._sortDir = (dt._sortDir === 'desc') ? 'asc' : 'desc';
      } else {
        dt._sortCol = colKey;
        dt._sortDir = 'asc';
      }
      dt._applySort();
    };
    dt._sortCol = 'project_code'; dt._sortDir = 'desc';
    dt._applySort();
    this._apply();
    this._resizeTable();
  },

  // 按当前筛选重算行并局部刷新（setData 会重算 rowspan 合并 + 重放排序）
  _apply: function() {
    var that = this;
    var status = this._KEY_STATUS[this._statusKey];     // null = 全部
    var proj = this._project, prod = this._product, q = this._q;
    var list = this._boards.filter(function(r) {
      if (proj) {
        var pc = (r.project_code || '').toLowerCase(), pn = (r.project_name || '').toLowerCase();
        if (pc.indexOf(proj) < 0 && pn.indexOf(proj) < 0) return false;
      }
      if (prod) {
        var dc = (r.product_code || '').toLowerCase(), dn = (r.product_name || '').toLowerCase();
        if (dc.indexOf(prod) < 0 && dn.indexOf(prod) < 0) return false;
      }
      if (status) {
        var statusOk = Array.isArray(status) ? status.indexOf(r.status) >= 0 : r.status === status;
        if (!statusOk) return false;
      }
      if (q) {
        var hay = [String(r.serial_no || ''), r.owner || '', r.current_holder || '', r.note || ''].join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    // 序号：按“项目+型号”分组从 1 计数（list 保持同型号相邻）
    var groups = {};
    list.forEach(function(r) {
      groups[r._grp] = (groups[r._grp] || 0) + 1;
      r._seq = groups[r._grp];
    });
    this._cur = list.slice();
    if (this._table) this._table.setData(list);
    var cnt = document.getElementById('bdov-title-count');
    if (cnt) cnt.textContent = list.length === this._boards.length
      ? '（共 ' + list.length + ' 块）'
      : '（' + list.length + ' / ' + this._boards.length + '）';
  },

  /* ── UI 事件入口（index.html 内联 handler 调用） ── */

  // 状态卡单选：重复点当前卡无操作；高亮逻辑同项目总览卡片
  setStatus: function(statusKey) {
    if (this._statusKey === statusKey) return;
    this._statusKey = statusKey || 'all';
    this._syncStatusChips();
    this._apply();
  },
  _syncStatusChips: function() {
    var grid = document.getElementById('bdov-kpis');
    if (!grid) return;
    var that = this;
    grid.querySelectorAll('.kpi-card').forEach(function(c) {
      c.classList.toggle('active', c.getAttribute('data-ov-group') === that._statusKey);
    });
  },
  // 项目 / 产品型号搜索（匹配 代号|名称 子串，小写不区分）
  setProject: function(v) { this._project = (v || '').trim().toLowerCase(); this._apply(); },
  clearProject: function() {
    var el = document.getElementById('bdov-f-project');
    if (el) el.value = '';
    this._project = ''; this._apply();
  },
  setProduct: function(v) { this._product = (v || '').trim().toLowerCase(); this._apply(); },
  clearProduct: function() {
    var el = document.getElementById('bdov-f-product');
    if (el) el.value = '';
    this._product = ''; this._apply();
  },
  setQuery: function(v) { this._q = (v || '').trim().toLowerCase(); this._apply(); },
  clearQuery: function() {
    var el = document.getElementById('bdov-f-q');
    if (el) el.value = '';
    this._q = '';
    this._apply();
  },

  _findBoard: function(id) {
    for (var i = 0; i < this._boards.length; i++) {
      if (this._boards[i].id === id) return this._boards[i];
    }
    return null;
  }
};

// app.js VIEW_REGISTRY initName 入口
function initBoardOverview() {
  ovBoard.init();
}
