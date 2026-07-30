/* Customer Management */
var _custList = [];
var _custDt = null;

function _initCustDt() {
  if (_custDt) return;
  _custDt = new DataTable({
    container: document.getElementById('cust-table'),
    columns: [
      { key: 'name', title: '客户名称', render: function(v) { return '<button class="gs-btn gs-cust" onclick="openCustomerDetail(\'' + escHtml(v||'').replace(/'/g, "\\'") + '\')">' + escHtml(v||'') + '</button>'; } },
      { key: 'full_name', title: '全称', width: '18%', render: function(v) { return '<span style="font-size:12px;color:var(--muted)">' + escHtml(v||'—') + '</span>'; } },
      { key: 'project_count', title: '关联项目', width: '10%', render: function(v, row) { var n = escHtml(row.name||'').replace(/'/g, "\\'"); return '<span onclick="event.stopPropagation();openCustomerDetail(\'' + n + '\')" style="cursor:pointer;padding:2px 8px;border-radius:10px;font-size:12px;font-weight:540;background:var(--accent-lt);color:var(--accent)" title="查看客户详情">' + (v||0) + '</span>'; } },
      { key: 'product_count', title: '关联产品', width: '10%', render: function(v, row) { var n = escHtml(row.name||'').replace(/'/g, "\\'"); return '<span onclick="event.stopPropagation();openCustomerDetail(\'' + n + '\')" style="cursor:pointer;padding:2px 8px;border-radius:10px;font-size:12px;font-weight:540;background:var(--success-lt);color:var(--success)" title="查看客户详情">' + (v||0) + '</span>'; } },
      { key: 'actions', title: '操作', width: '18%', render: function(v, row) { return '<span style="white-space:nowrap">' + iconEdit('openCustEditDialog(' + row.id + ')') + iconDelete('deleteCust(' + row.id + ',\'' + escHtml(row.name) + '\')') + '</span>'; } }
    ],
    maxHeight: 'calc(100vh - 200px)',
    resizable: false
  });
}

async function initCustomerManagement() {
  try { await loadCustTable(); } catch(e) { _initCustDt(); _custDt.setData([]); showToast('加载失败: ' + e.message, 'error'); }
}

async function loadCustTable() {
  _initCustDt();
  var data = await API.get('/customers');
  _custList = data || [];
  renderCustTable();
}

function renderCustTable() {
  _custDt.setData(_custList);
}

function openCustCreateDialog() {
  var html = '<div class="note-dialog-overlay">' +
    '<div class="note-dialog">' +
      '<div class="note-dialog-head"><span class="note-dialog-title">添加客户</span>' +
        '<button class="note-dialog-close" onclick="closeCustDialog()">&times;</button></div>' +
      '<div class="user-form">' +
        '<div class="user-form-field"><label>客户名称 <span style="font-weight:400;font-size:10px;color:var(--muted)">城市拼音首字母-公司名首字母</span></label><input class="config-input" id="cust-name" placeholder="如 CD-AKT"></div>' +
        '<div class="user-form-field"><label>全称（可选） <span style="font-weight:400;font-size:10px;color:var(--muted)">公司实际中文全名</span></label><input class="config-input" id="cust-fullname" placeholder="如 领目科技有限公司"></div>' +
      '</div>' +
      '<div style="display:flex;justify-content:flex-end;align-items:center;gap:10px;margin-top:14px">' +
        '<span id="cust-msg" style="font-size:11px"></span>' +
        '<button class="btn" onclick="closeCustDialog()">取消</button>' +
        '<button class="btn btn-primary" onclick="submitCustCreate()">创建</button></div>' +
    '</div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
}

function closeCustDialog() { var o = document.querySelector('.note-dialog-overlay'); if (o) o.remove(); }

async function submitCustCreate() {
  var name = document.getElementById('cust-name').value.trim();
  var fullName = document.getElementById('cust-fullname').value.trim();
  var msg = document.getElementById('cust-msg');
  if (!name) { msg.innerHTML = '<span style="color:var(--danger)">请填写客户名称</span>'; return; }
  try {
    await API.post('/customers', { name: name, full_name: fullName });
    closeCustDialog();
    loadCustTable();
  } catch(e) { msg.innerHTML = '<span style="color:var(--danger)">' + escHtml(e.message) + '</span>'; }
}

function openCustEditDialog(id) {
  var c = _custList.find(function(x) { return x.id === id; });
  if (!c) return;
  var html = '<div class="note-dialog-overlay">' +
    '<div class="note-dialog">' +
      '<div class="note-dialog-head"><span class="note-dialog-title">编辑: ' + escHtml(c.name) + '</span>' +
        '<button class="note-dialog-close" onclick="closeCustDialog()">&times;</button></div>' +
      '<div class="user-form">' +
        '<div class="user-form-field"><label>客户名称</label><input class="config-input" id="cust-edit-name" value="' + escHtml(c.name) + '"></div>' +
        '<div class="user-form-field"><label>全称</label><input class="config-input" id="cust-edit-fullname" value="' + escHtml(c.full_name || '') + '"></div>' +
      '</div>' +
      '<div style="display:flex;justify-content:flex-end;align-items:center;gap:10px;margin-top:14px">' +
        '<span id="cust-edit-msg" style="font-size:11px"></span>' +
        '<button class="btn" onclick="closeCustDialog()">取消</button>' +
        '<button class="btn btn-primary" onclick="submitCustEdit(' + id + ')">保存</button></div>' +
    '</div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
}

async function submitCustEdit(id) {
  var name = document.getElementById('cust-edit-name').value.trim();
  var fullName = document.getElementById('cust-edit-fullname').value.trim();
  var msg = document.getElementById('cust-edit-msg');
  if (!name) { msg.innerHTML = '<span style="color:var(--danger)">请填写客户名称</span>'; return; }
  try {
    await API.put('/customers/' + id, { name: name, full_name: fullName });
    closeCustDialog();
    loadCustTable();
  } catch(e) { msg.innerHTML = '<span style="color:var(--danger)">' + escHtml(e.message) + '</span>'; }
}

async function deleteCust(id, name) {
  if (!confirm('确认删除客户 "' + name + '"？将同时解除所有项目/产品关联。')) return;
  var ok = await verifyPassword('删除客户: ' + name, 'pw_verify_delete_cust');
  if (!ok) return;
  try { await API.del('/customers/' + id); loadCustTable(); } catch(e) { showToast('删除失败: ' + e.message, 'error'); }
}

/* ── Customer Detail ── */

function openCustomerDetail(name) {
  localStorage.setItem('pm_cust_name', name);
  gotoView('customer-detail', {params: [name]});
}

var _custDetProjDt = null;
var _custDetProdDt = null;

function _initCustDetProjDt() {
  if (_custDetProjDt) return;
  _custDetProjDt = new DataTable({
    container: document.getElementById('cust-det-proj-table'),
    columns: [
      { key: 'idx', title: '序号', width: '6%', render: function(v) { return '<span style="color:var(--muted);font-size:12px">' + v + '</span>'; } },
      { key: 'code', title: '项目编号', width: '14%', render: function(v) { return '<span style="font-family:var(--mono);font-size:11.5px;color:var(--accent);cursor:pointer" onclick="event.stopPropagation();openProject(\'' + escHtml(v||'').replace(/'/g, "\\'") + '\')">' + escHtml(v||'') + '</span>'; } },
      { key: 'name', title: '项目名称', render: function(v) { return escHtml(v||''); } },
      { key: 'status', title: '状态', width: '10%', render: function(v) { return renderPill(v); } },
      { key: 'products', title: '产品信息', render: function(v) {
        if (!v || !v.length) return '<span style="color:var(--muted);font-size:11px">—</span>';
        return v.map(function(pr) { return '<span style="display:inline-block;margin:1px 2px;padding:1px 6px;border-radius:3px;font-size:10.5px;background:var(--success-lt);color:var(--success);cursor:pointer" onclick="event.stopPropagation();openProductFromCust(\'' + escHtml(pr.code||String(pr.id)).replace(/'/g, "\\'") + '\')" title="' + escHtml(pr.name||'') + '">' + escHtml(pr.code||'#'+pr.id) + '</span>'; }).join('');
      }}
    ],
    maxHeight: '400px',
    resizable: false,
    headerBg: 'var(--accent)',
    headerColor: '#fff'
  });
}

function _initCustDetProdDt() {
  if (_custDetProdDt) return;
  _custDetProdDt = new DataTable({
    container: document.getElementById('cust-det-prod-table'),
    columns: [
      { key: 'idx', title: '序号', width: '6%', render: function(v) { return '<span style="color:var(--muted);font-size:12px">' + v + '</span>'; } },
      { key: 'code', title: '产品编号', width: '14%', render: function(v) { return '<span style="font-family:var(--mono);font-size:11.5px;color:var(--accent);cursor:pointer" onclick="event.stopPropagation();openProductFromCust(\'' + escHtml(v||'').replace(/'/g, "\\'") + '\')">' + escHtml(v||'') + '</span>'; } },
      { key: 'name', title: '产品名称', render: function(v) { return escHtml(v||''); } },
      { key: 'status', title: '状态', width: '10%', render: function(v) { return renderPill(v); } },
      { key: 'projects', title: '项目信息', render: function(v) {
        if (!v || !v.length) return '<span style="color:var(--muted);font-size:11px">—</span>';
        return v.map(function(pj) { return '<span style="display:inline-block;margin:1px 2px;padding:1px 6px;border-radius:3px;font-size:10.5px;background:var(--accent-lt);color:var(--accent);cursor:pointer" onclick="event.stopPropagation();openProject(\'' + escHtml(pj.code||String(pj.id)).replace(/'/g, "\\'") + '\')" title="' + escHtml(pj.code||'') + '">' + escHtml(pj.code||'#'+pj.id) + '</span>'; }).join('');
      }}
    ],
    maxHeight: '400px',
    resizable: false,
    headerBg: 'var(--success)',
    headerColor: '#fff'
  });
}

async function initCustomerDetail(customerName) {
  var name = customerName || localStorage.getItem('pm_cust_name');
  if (!name) { gotoView('customers'); return; }
  _initCustDetProjDt(); _custDetProjDt.setData([]);
  _initCustDetProdDt(); _custDetProdDt.setData([]);
  try {
    var c = await API.get('/customers/' + encodeURIComponent(name));
    document.getElementById('cust-det-fullname').textContent = c.full_name || '';
    document.getElementById('cust-det-name-head').textContent = c.name;
    document.getElementById('topbar-title').textContent = c.name + ' · 客户详情';
    // Projects
    if (c.projects && c.projects.length) {
      _custDetProjDt.setData(c.projects.map(function(p, i) { p.idx = i+1; return p; }));
    } else { _custDetProjDt.setData([]); }
    // Products
    if (c.products && c.products.length) {
      _custDetProdDt.setData(c.products.map(function(p, i) { p.idx = i+1; return p; }));
    } else { _custDetProdDt.setData([]); }
  } catch(e) {
    document.getElementById('cust-det-name-head').textContent = '加载失败';
  }
}

function openProductFromCust(code) {
  gotoView('product-detail', {params: [String(code), 'info']});
}
