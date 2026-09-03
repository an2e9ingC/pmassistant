/* ═══════════════════════════════════════════════════════════════
   board-mgmt.js — 板卡生命周期管理 共享操作（Issue #11）
   从 detail.js「交付状态」提取：时间线 / 状态切换 / 编辑 / 删除。
   页面（项目详情、板卡管理总览）通过 BoardMgr.setContext() 注入数据源与刷新回调，
   保证两侧行为、对话框、校验完全一致（单一来源）。
   权限口径：状态流转 / 时间线对所有登录用户开放；建档 / 编辑 / 删除需 admin|board_manage。
   状态目录 / schema 来自后端 board_meta；操作后仍广播 EVENTS.BOARD_CHANGED。
═══════════════════════════════════════════════════════════════ */
var _userDisplayMap = {};      // username -> display_name（当前页用户表，进入板卡操作前刷新）
var _boardStatusBoardId = null;

/* 用户搜索下拉用：返回当前页可选用户 {code,name} 列表 */
var BoardMgr = {
  _ctx: {
    getBoard: function() { return null; },
    getMeta: function() { return { statuses: [], manual_targets: [], schema: {}, repair_statuses: [] }; },
    getUsers: function() { return []; },
    getProducts: function() { return []; },   // board -> [{code,name}]（可 Promise）
    comboCode: function() { return ''; },     // 当前项目 code（仅「新增板卡」用）
    displayName: function(u) { return getDisplayName(u); }
  },
  setContext: function(c) {
    if (!c) return;
    for (var k in c) { if (typeof c[k] !== 'undefined') this._ctx[k] = c[k]; }
  },
  getBoard: function(id) { return this._ctx.getBoard(id); },
  getMeta: function() { return this._ctx.getMeta(); },
  getUsers: function() { return this._ctx.getUsers(); },
  getProducts: function(board) { return this._ctx.getProducts(board); },
  comboCode: function() { return this._ctx.comboCode(); },
  displayName: function(u) { return this._ctx.displayName(u); },

  /* 板卡管理（建档/编辑/删除）：admin 或 board_manage（默认即库房管理角色）。
     状态流转 / 时间线 / 查看对所有登录用户开放，无需此权限；服务端仍二次校验。 */
  hasBoardPerm: function() {
    var u = getCurrentUser(); if (!u) return false;
    var ps = (u.permissions || '').split(',');
    return ps.indexOf('admin') >= 0 || ps.indexOf('board_manage') >= 0;
  }
};

function _boardRefreshNames() {
  var users = BoardMgr.getUsers() || [];
  var m = {};
  for (var i = 0; i < users.length; i++) {
    var u = users[i];
    if (u && u.code) m[u.code] = u.name || u.code;
  }
  _userDisplayMap = m;
}

// ── 从 detail.js「交付状态」提取的共享实现（下） ──

async function showBoardForm(boardId) {
  var board = boardId ? BoardMgr.getBoard(boardId) : null;
  var isEdit = !!board;
  var curCode = board ? (board.product_code || '') : '';
  var curName = board ? (board.product_name || '') : '';
  var products = (await BoardMgr.getProducts(board)) || [];
  var prodOptions = products.map(function(p) {
    var sel = (curCode === p.code) ? ' selected' : '';
    return '<option value="' + escHtml(p.code || '') + '"' + sel + '>' + escHtml((p.code ? p.code + ' ' : '') + (p.name || '')) + '</option>';
  }).join('');
  // 编辑时若当前产品不在项目关联列表，回填到选项首位，避免误清空
  if (curCode && !products.some(function(p) { return p.code === curCode; })) {
    prodOptions = '<option value="' + escHtml(curCode) + '" selected>' + escHtml(curCode + ' ' + curName) + '</option>' + prodOptions;
  }
  var emptyLabel = products.length ? '— 请选择产品 —' : '— 本项目无关联产品 —';
  var html =
    '<div style="display:grid;grid-template-columns:1fr;gap:12px;padding:8px 0">' +
      '<div><label style="font-size:11px;color:var(--muted)">产品编号 <span style="color:var(--danger)">*</span></label>' +
        '<input class="search-inp" id="bf-serial" value="' + escHtml(board ? (board.serial_no || '') : '') + '" style="margin-top:4px"></div>' +
      '<div><label style="font-size:11px;color:var(--muted)">产品型号' + (isEdit ? '' : ' <span style="color:var(--danger)">*</span>') + '</label>' +
        '<select class="search-inp" id="bf-product" style="margin-top:4px"><option value="">' + emptyLabel + '</option>' + prodOptions + '</select>' +
        '<div style="font-size:10.5px;color:var(--muted);margin-top:3px">选择本项目关联产品，产品型号/名称自动带出</div></div>' +
      '<div><label style="font-size:11px;color:var(--muted)">备注</label>' +
        '<textarea class="search-inp" id="bf-note" rows="2" style="margin-top:4px">' + escHtml(board ? (board.note || '') : '') + '</textarea></div>' +
    '</div>';
  openDialog(isEdit ? '编辑板卡' : '新增板卡', html, [
    { text: '取消', onclick: 'closeSharedDialog()' },
    { text: isEdit ? '保存' : '创建', cls: 'btn-primary', onclick: function() { _submitBoardForm(boardId); } },
  ], { maxWidth: 480 });
}

async function _submitBoardForm(boardId) {
  var serial = (document.getElementById('bf-serial') || {}).value || '';
  if (!serial.trim()) { showToast('产品编号不能为空', 'error'); return; }
  var selCode = (document.getElementById('bf-product') || {}).value || '';
  var prods = (await BoardMgr.getProducts(boardId ? BoardMgr.getBoard(boardId) : null)) || [];
  var selP = null; for (var pi = 0; pi < prods.length; pi++) { if (prods[pi].code === selCode) { selP = prods[pi]; break; } }
  var selName = selP ? (selP.name || '') : '';
  if (!boardId && !selCode) { showToast('请选择产品型号', 'error'); return; }
  // 编辑时若选择的是回填的存量产品（不在关联列表），用板卡原产品名称
  if (!selName && boardId) {
    var b = BoardMgr.getBoard(boardId);
    if (b && b.product_code === selCode) selName = b.product_name || '';
  }
  var body = {
    serial_no: serial.trim(),
    product_code: selCode,
    product_name: selName,
    note: (document.getElementById('bf-note') || {}).value || '',
  };
  try {
    if (boardId) {
      await API.put('/delivery/boards/' + boardId, body);
      showToast('板卡已更新', 'success');
    } else {
      await API.post('/delivery/projects/' + BoardMgr.comboCode() + '/boards', body);
      showToast('板卡已建档', 'success');
    }
    document.querySelectorAll('.shared-dialog-overlay').forEach(function(o) { o.remove(); });
    EventBus.emit(EVENTS.BOARD_CHANGED, {});
  } catch(e) {
    showToast(e.message || '操作失败', 'error');
  }
}

/* 状态切换：目标状态 schema 由后端 meta 动态驱动 */
function showBoardStatusDialog(boardId) {
  var board = BoardMgr.getBoard(boardId);
  if (!board) return;
  if (board.status === '维修中') { showToast('维修状态需通过维修 Bug 流转', 'warn'); return; }
  _boardStatusBoardId = boardId;
  // 允许选择当前状态（用于同状态下归属人变更）；后端校验「状态+归属人均未变化」时拒绝
  var targets = (BoardMgr.getMeta().manual_targets || []);
  var targetOptions = targets.map(function(s) {
    return '<option value="' + escHtml(s) + '"' + (s === board.status ? ' selected' : '') + '>' + escHtml(s) + (s === board.status ? '（保持不变）' : '') + '</option>';
  }).join('');
  var html =
    '<div style="padding:8px 0">' +
      '<div style="display:flex;gap:10px;align-items:center;margin-bottom:12px">' +
        '<label style="font-size:11px;color:var(--muted)">当前状态</label>' +
        '<span>' + boardStatusPill(board.status) + '</span>' +
      '</div>' +
      '<label style="font-size:11px;color:var(--muted)">切换至 <span style="color:var(--danger)">*</span></label>' +
      '<select class="search-inp" id="bs-target" style="margin-top:4px" onchange="_renderBoardSchemaFields(this.value)">' +
        '<option value="">— 请选择目标状态 —</option>' + targetOptions +
      '</select>' +
      '<div style="font-size:10.5px;color:var(--muted);margin-top:3px">状态与归属人均未变化时无法切换（同状态仅用于变更归属人）</div>' +
      '<div id="bs-fields" style="margin-top:12px"></div>' +
    '</div>';
  openDialog('状态切换 — ' + board.serial_no, html, [
    { text: '取消', onclick: 'closeSharedDialog()' },
    { text: '确认切换', cls: 'btn-primary', onclick: function() { _submitBoardStatus(); } },
  ], { maxWidth: 480 });
}

function _renderBoardSchemaFields(target) {
  var el = document.getElementById('bs-fields');
  if (!el) return;
  if (!target) { el.innerHTML = ''; return; }
  var fields = (BoardMgr.getMeta().schema && BoardMgr.getMeta().schema[target]) || [];
  el.innerHTML = fields.map(function(f) { return _boardSchemaFieldHtml(f); }).join('');
  // 默认：操作人=当前用户
  var operator = document.getElementById('bsf-operator');
  var user = getCurrentUser() || {};
  if (operator && user.username) operator.value = user.username;
}

function _boardSchemaFieldHtml(f) {
  var label = '<label style="font-size:11px;color:var(--muted)">' + escHtml(f.label) + (f.required ? ' <span style="color:var(--danger)">*</span>' : '') + '</label>';
  var id = 'bsf-' + f.key;
  var inp = '';
  if (f.type === 'date') {
    inp = '<input class="search-inp" id="' + id + '" type="date" value="' + fmtLocalDate() + '" style="margin-top:4px">';
  } else if (f.type === 'textarea') {
    inp = '<textarea class="search-inp" id="' + id + '" rows="2" style="margin-top:4px"></textarea>';
  } else if (f.type === 'select') {
    var opts = (f.options || []).map(function(o) { return '<option value="' + escHtml(o) + '">' + escHtml(o) + '</option>'; }).join('');
    inp = '<select class="search-inp" id="' + id + '" style="margin-top:4px"><option value="">— 请选择 —</option>' + opts + '</select>';
  } else if (f.type === 'user_select' && f.key === 'operator') {
    // 操作人：不可修改，自动填入当前登录人
    var cur = getCurrentUser() || {};
    inp = '<div style="margin-top:4px;padding:6px 10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;font-size:12px;color:var(--muted)">' +
      escHtml(cur.display_name || cur.username || '') + '（当前登录人，不可修改）</div>' +
      '<input type="hidden" id="' + id + '" value="' + escHtml(cur.username || '') + '">';
  } else if (f.type === 'user_select') {
    inp = _userSearchFieldHtml(f);
  } else {
    inp = '<input class="search-inp" id="' + id + '" style="margin-top:4px">';
  }
  return '<div style="margin-bottom:10px">' + label + inp + '</div>';
}

/* 用户搜索输入框（user_select 字段：转交给谁/归属人/交付责任人） */
function _userSearchFieldHtml(f) {
  var key = f.key;
  return '<div style="position:relative;margin-top:4px">' +
    '<input class="search-inp" id="bs-us-' + key + '-input" placeholder="搜索姓名/账号..." autocomplete="off" ' +
      'onfocus="_userSearchOpen(\'' + key + '\')" oninput="_userSearchOpen(\'' + key + '\')" ' +
      'onblur="setTimeout(function(){_userSearchClose(\'' + key + '\')},150)">' +
    '<span id="bs-us-' + key + '-chip" style="display:none;position:absolute;right:9px;top:50%;transform:translateY(-50%);cursor:pointer;font-size:13px;color:var(--muted)" title="清除选择" onmousedown="event.preventDefault();_userSearchClear(\'' + key + '\')">&times;</span>' +
    '<div id="bs-us-' + key + '-drop" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:30;background:var(--surface);border:1px solid var(--border);border-radius:6px;max-height:180px;overflow-y:auto;box-shadow:0 4px 12px rgba(0,0,0,.12)"></div>' +
    '<input type="hidden" id="bsf-' + key + '">' +
  '</div>';
}

function _userSearchOpen(fkey) {
  var drop = document.getElementById('bs-us-' + fkey + '-drop');
  var input = document.getElementById('bs-us-' + fkey + '-input');
  if (!drop) return;
  var kw = (input ? input.value : '').trim().toLowerCase();
  var list = (BoardMgr.getUsers() || []).filter(function(u) {
    if (!kw) return true;
    return String(u.code || '').toLowerCase().indexOf(kw) >= 0 ||
           String(u.name || '').toLowerCase().indexOf(kw) >= 0;
  });
  if (!list.length) {
    drop.innerHTML = '<div style="padding:7px 10px;font-size:11px;color:var(--muted)">无匹配用户</div>';
    drop.style.display = '';
    return;
  }
  drop.innerHTML = list.map(function(u) {
    var code = escHtml(String(u.code || '')).replace(/'/g, "\\'");
    var name = escHtml(String(u.name || u.code || '')).replace(/'/g, "\\'");
    return '<div style="padding:6px 10px;cursor:pointer;font-size:12px;display:flex;justify-content:space-between;gap:8px" ' +
      'onmousedown="event.preventDefault();_userSearchPick(\'' + fkey + '\',\'' + code + '\',\'' + name + '\')">' +
      '<span>' + escHtml(u.name || u.code) + '</span>' +
      '<span style="color:var(--muted);font-size:10px">' + escHtml(u.code) + '</span>' +
    '</div>';
  }).join('');
  drop.style.display = '';
}

function _userSearchPick(fkey, code, name) {
  var hidden = document.getElementById('bsf-' + fkey);
  var input = document.getElementById('bs-us-' + fkey + '-input');
  var chip = document.getElementById('bs-us-' + fkey + '-chip');
  if (hidden) hidden.value = code;
  if (input) input.value = name;
  if (chip) chip.style.display = '';
  _userSearchClose(fkey);
}

function _userSearchClear(fkey) {
  var hidden = document.getElementById('bsf-' + fkey);
  var input = document.getElementById('bs-us-' + fkey + '-input');
  var chip = document.getElementById('bs-us-' + fkey + '-chip');
  if (hidden) hidden.value = '';
  if (input) input.value = '';
  if (chip) chip.style.display = 'none';
}

function _userSearchClose(fkey) {
  var drop = document.getElementById('bs-us-' + fkey + '-drop');
  if (drop) drop.style.display = 'none';
}

function _submitBoardStatus() {
  var boardId = _boardStatusBoardId;
  var target = (document.getElementById('bs-target') || {}).value;
  if (!target) { showToast('请选择目标状态', 'error'); return; }
  var fields = (BoardMgr.getMeta().schema && BoardMgr.getMeta().schema[target]) || [];
  var data = {};
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    var val = ((document.getElementById('bsf-' + f.key) || {}).value || '').trim();
    if (f.required && !val) { showToast(f.label + '为必填项', 'error'); return; }
    if (val) data[f.key] = val;
  }
  // 操作人恒为当前登录人（防篡改兜底）
  if (fields.some(function(f) { return f.key === 'operator'; })) {
    var cur = getCurrentUser() || {};
    if (cur.username) data.operator = cur.username;
  }
  API.post('/delivery/boards/' + boardId + '/status', { to_status: target, data: data })
    .then(function(res) {
      showToast('状态已切换至「' + target + '」', 'success');
      document.querySelectorAll('.shared-dialog-overlay').forEach(function(o) { o.remove(); });
      EventBus.emit(EVENTS.BOARD_CHANGED, {});
    })
    .catch(function(e) { showToast(e.message || '切换失败', 'error'); });
}

/* 时间线 */
function showBoardTimeline(boardId) {
  openDialog('板卡时间线', '<div id="bt-body" style="color:var(--muted);font-size:12px;padding:8px 0">加载中...</div>', [], { maxWidth: 560, maxHeight: '70vh' });
  _loadBoardTimeline(boardId, 'desc');
}

async function _loadBoardTimeline(boardId, order) {
  _boardRefreshNames();
  try {
    var resp = await API.get('/delivery/boards/' + boardId + '/timeline?order=' + order);
    var data = resp || {};  // API.get 已解包 json.data → {board, events}
    var board = data.board || {};
    var bodyEl = document.getElementById('bt-body');
    if (!bodyEl) return;
    var titleEl = document.querySelector('.note-dialog-title');
    if (titleEl) titleEl.textContent = '板卡时间线 — ' + (board.serial_no || '');
    var orderBtn = '<button class="btn" style="font-size:11px;padding:2px 8px" onclick="_loadBoardTimeline(' + boardId + ',\'' + (order === 'asc' ? 'desc' : 'asc') + '\')">' + (order === 'desc' ? '最新在前 ↓' : '最早在前 ↑') + '</button>';
    var header =
      '<div style="display:flex;gap:10px;align-items:center;margin-bottom:10px;font-size:12px;flex-wrap:wrap">' +
        '<span>当前状态: ' + boardStatusPill(board.status) + '</span>' +
        '<span style="color:var(--muted)">归属人: ' + escHtml(_userDisplayMap[board.owner] || board.owner || '—') + '</span>' +
        orderBtn +
      '</div>';
    bodyEl.innerHTML = header + _boardTimelineHtml(data.events || []);
  } catch(e) {
    var bodyEl = document.getElementById('bt-body');
    if (bodyEl) bodyEl.innerHTML = '<div style="color:var(--danger);font-size:12px">加载失败: ' + escHtml(e.message) + '</div>';
  }
}

/* 操作时间展示：仅录入日期（date-only，存 UTC 午夜）时只显示日期，
   否则（建档/交付/维修等真实时刻）显示完整本地时间，避免误导性一致的 08:00:00 */
function _boardEventTimeDisplay(iso) {
  if (!iso) return '';
  var m = /T(\d{2}):(\d{2}):(\d{2})/.exec(iso);
  if (m && m[1] === '00' && m[2] === '00' && m[3] === '00') return formatDate(iso);
  return fmtISODateTime(iso);
}

function _boardTimelineHtml(events) {
  if (!events.length) return '<div style="color:var(--muted);font-size:12px">暂无事件</div>';
  var html = '<div style="position:relative;padding-left:24px">' +
    '<div style="position:absolute;left:6px;top:8px;bottom:8px;width:2px;background:var(--border);border-radius:1px"></div>';
  // 最新时间点：插入序 id 最大（id 序=真实时序，event_time 可能 date-only 午夜导致乱序）
  var newestId = events.reduce(function(m, e) { return (e.id || 0) > m ? (e.id || 0) : m; }, 0);
  events.forEach(function(e) {
    var isNewest = e.id === newestId;
    var dotColor = BOARD_PILL_COLORS[e.to_status] || 'var(--accent)';
    // 最新时间点：圆点用强调色填充 + 光晕突出
    var dot = isNewest
      ? '<span style="position:absolute;left:-24px;top:4px;width:14px;height:14px;border-radius:50%;background:var(--accent);border:2px solid var(--accent);box-shadow:0 0 0 3px color-mix(in srgb, var(--accent) 28%, transparent);box-sizing:border-box;z-index:1"></span>'
      : '<span style="position:absolute;left:-24px;top:4px;width:14px;height:14px;border-radius:50%;background:var(--surface);border:2px solid ' + dotColor + ';box-sizing:border-box;z-index:1"></span>';
    var time = e.event_time ? _boardEventTimeDisplay(e.event_time) : '';
    var migrate = (e.from_status ? boardStatusPill(e.from_status) + ' <span style="color:var(--muted)">→</span> ' : '') + boardStatusPill(e.to_status);
    var actor = e.actor ? (_userDisplayMap[e.actor] || e.actor) : '';
    var isBugEvent = !!e.bug_id;
    var d = e.data || {};

    // 第 1 行：时间 + 状态切换（与其他状态事件保持一致）；最新点时间用强调色加粗
    var bodyHtml = '<div style="display:flex;align-items:baseline;gap:6px;font-size:12px;flex-wrap:wrap">' +
      '<span style="font-size:11px;white-space:nowrap;' + (isNewest ? 'color:var(--accent);font-weight:600' : 'color:var(--muted)') + '">' + escHtml(time) + '</span>' +
      migrate +
    '</div>';

    if (isBugEvent) {
      // 第 2 行：报修人 --> 维修人（维修中=责任人；已维修=返修处理人）
      var reporter = d['报修人'] || '';
      var repairer = d['返修处理人'] || d['责任人'] || '';
      if (reporter) {
        bodyHtml += '<div style="margin-top:3px;font-size:11.5px;color:var(--muted)">' +
          '<span style="color:var(--accent);font-weight:600">' + escHtml(_userDisplayMap[reporter] || reporter) + '</span>' +
          ' <span style="color:var(--muted)">→</span> ' +
          '<span style="color:var(--accent);font-weight:600">' + escHtml(_userDisplayMap[repairer] || repairer || '—') + '</span>' +
        '</div>';
      } else if (repairer) {
        // 已维修事件无报修人字段，仅呈现维修人
        bodyHtml += '<div style="margin-top:3px;font-size:11.5px;color:var(--muted)">' +
          '<span style="color:var(--accent);font-weight:600">' + escHtml(_userDisplayMap[repairer] || repairer) + '</span>' +
        '</div>';
      }
      // 第 3 行：bug 编号 + bug 标题（可点击跳转并自动关闭时间线）
      bodyHtml += '<div style="margin-top:3px;font-size:12px">' +
        '<span class="tag-badge tag-1" style="cursor:pointer" onclick="_boardBugJump(' + e.bug_id + ')" title="打开维修 Bug">Bug #' + e.bug_id + '</span>' +
        '<span style="font-size:12px;color:var(--muted);margin-left:6px">' + escHtml(d.bug_title || '') + '</span>' +
      '</div>';
    } else {
      var toHolder = d.to_holder || d['转交给谁'] || '';
      // 第 2 行：生产转交事件显示 转交人 --> 接收人；其余事件显示操作人
      if (toHolder) {
        bodyHtml += '<div style="margin-top:3px;font-size:11.5px;color:var(--muted)">' +
          '<span style="color:var(--accent);font-weight:600">' + escHtml(actor || '—') + '</span>' +
          ' <span style="color:var(--muted)">→</span> ' +
          '<span style="color:var(--accent);font-weight:600">' + escHtml(_userDisplayMap[toHolder] || toHolder) + '</span>' +
        '</div>';
      } else if (actor) {
        bodyHtml += '<div style="margin-top:3px;font-size:11.5px;color:var(--muted)">' + escHtml(actor) + '</div>';
      }
      // 第 3 行：转交/操作时填写的说明内容（没有则不显示）
      if (e.note) {
        bodyHtml += '<div style="margin-top:4px;font-size:12px;color:var(--muted)">' + escHtml(e.note) + '</div>';
      }
      // 其余字段小网格（转交事件已由 转交人→接收人 + 说明 呈现，不再重复展示网格）
      if (!toHolder) {
        bodyHtml += _boardEventDataGrid(d);
      }
    }

    // 最新时间点内容强调：浅色强调底 + 边框圆角
    var newestBox = isNewest
      ? 'background:color-mix(in srgb, var(--accent) 8%, transparent);border:1px solid color-mix(in srgb, var(--accent) 38%, transparent);border-radius:8px;padding:6px 10px;'
      : '';
    html += '<div style="position:relative;padding:4px 0 14px 0">' + dot + '<div style="' + newestBox + '">' + bodyHtml + '</div></div>';
  });
  html += '</div>';
  return html;
}

/* 维修 Bug 跳转：先自动关闭时间线对话框，再导航到 Bug 详情
   （bugs.js 懒加载，不能直接调 openBugDetail；gotoView 会加载并带参初始化） */
function _boardBugJump(bugId) {
  if (typeof closeSharedDialog === 'function') closeSharedDialog();
  gotoView('bugs', { params: [String(bugId)] });
}

/* 事件 data 中存 username 的字段 → 展示中文名（企微） */
var _BOARD_USER_DATA_KEYS = ['to_holder', 'owner', 'operator', 'responsible_person', '转交给谁', '归属人', '交付责任人', '操作人', '责任人', '返修处理人', '报修人'];

function _boardEventDataGrid(data) {
  var keys = Object.keys(data).filter(function(k) { return data[k] !== null && data[k] !== undefined && String(data[k]) !== ''; });
  if (!keys.length) return '';
  var cells = keys.map(function(k) {
    var v = String(data[k]);
    if (_BOARD_USER_DATA_KEYS.indexOf(k) >= 0 && _userDisplayMap[data[k]]) v = _userDisplayMap[data[k]];
    return '<div style="padding:4px 6px;background:var(--bg);border-radius:5px">' +
      '<div style="font-size:10px;color:var(--muted)">' + escHtml(k) + '</div>' +
      '<div style="font-size:11px;margin-top:1px;word-break:break-all">' + escHtml(v) + '</div>' +
    '</div>';
  }).join('');
  return '<div style="margin-top:6px;display:grid;grid-template-columns:1fr 1fr;gap:6px">' + cells + '</div>';
}

async function deleteBoard(boardId) {
  var board = BoardMgr.getBoard(boardId);
  if (!board) return;
  if (!confirm('确认删除板卡「' + board.serial_no + '」？其生命周期记录将一并删除。')) return;
  try {
    await API.del('/delivery/boards/' + boardId);
    showToast('板卡已删除', 'success');
    EventBus.emit(EVENTS.BOARD_CHANGED, {});
  } catch(e) {
    showToast(e.message || '删除失败', 'error');
  }
}

