/* Customer Management */
var _custList = [];

async function initCustomerManagement() {
  try { await loadCustTable(); } catch(e) {
    document.getElementById('cust-tbody').innerHTML = '<tr><td colspan="5"><div class="error-state">加载失败: ' + escHtml(e.message) + '</div></td></tr>';
  }
}

async function loadCustTable() {
  document.getElementById('cust-tbody').innerHTML = '<tr><td colspan="5"><div class="loading-spinner">加载中...</div></td></tr>';
  var data = await API.get('/customers');
  _custList = data || [];
  renderCustTable();
}

function renderCustTable() {
  var tbody = document.getElementById('cust-tbody');
  if (!_custList.length) { tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state">暂无客户数据</div></td></tr>'; return; }
  tbody.innerHTML = _custList.map(function(c) {
    return '<tr>' +
      '<td><button class="gs-btn gs-cust" onclick="openCustomerDetail(' + c.id + ')">' + escHtml(c.name) + '</button></td>' +
      '<td style="font-size:12px;color:var(--muted)">' + escHtml(c.full_name || '—') + '</td>' +
      '<td><span style="padding:2px 8px;border-radius:10px;font-size:12px;font-weight:540;background:var(--accent-lt);color:var(--accent)">' + (c.project_count || 0) + '</span></td>' +
      '<td><span style="padding:2px 8px;border-radius:10px;font-size:12px;font-weight:540;background:var(--success-lt);color:var(--success)">' + (c.product_count || 0) + '</span></td>' +
      '<td style="white-space:nowrap">' +
        '<button class="btn" onclick="openCustEditDialog(' + c.id + ')" style="font-size:11px;padding:3px 10px;margin-right:4px">编辑</button>' +
        '<button class="btn" onclick="deleteCust(' + c.id + ',\'' + escHtml(c.name) + '\')" style="font-size:11px;padding:3px 10px;color:var(--danger)">删除</button>' +
      '</td>' +
    '</tr>';
  }).join('');
}

function openCustCreateDialog() {
  var html = '<div class="note-dialog-overlay">' +
    '<div class="note-dialog">' +
      '<div class="note-dialog-head"><span class="note-dialog-title">添加客户</span>' +
        '<button class="note-dialog-close" onclick="closeCustDialog()">&times;</button></div>' +
      '<div class="user-form">' +
        '<div class="user-form-field"><label>客户名称</label><input class="config-input" id="cust-name"></div>' +
        '<div class="user-form-field"><label>全称（可选）</label><input class="config-input" id="cust-fullname"></div>' +
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
  var ok = await verifyPassword('删除客户', 'pw_verify_delete_cust');
  if (!ok) return;
  try { await API.del('/customers/' + id); loadCustTable(); } catch(e) { showToast('删除失败: ' + e.message, 'error'); }
}

/* ── Customer Detail ── */

function openCustomerDetail(id) {
  localStorage.setItem('pm_cust_id', id);
  gotoView('customer-detail');
}

async function initCustomerDetail() {
  var id = localStorage.getItem('pm_cust_id');
  if (!id) { gotoView('customers'); return; }
  document.getElementById('cust-det-proj-tbody').innerHTML = '<tr><td colspan="2"><div class="loading-spinner">加载中...</div></td></tr>';
  document.getElementById('cust-det-prod-tbody').innerHTML = '<tr><td colspan="2"><div class="loading-spinner">加载中...</div></td></tr>';
  try {
    var c = await API.get('/customers/' + id);
    document.getElementById('cust-det-fullname').textContent = c.full_name || '';
    document.getElementById('cust-det-name-head').textContent = c.name;
    document.getElementById('topbar-title').textContent = c.name + ' · 客户详情';
    // Projects table
    var projTbody = document.getElementById('cust-det-proj-tbody');
    if (c.projects && c.projects.length) {
      projTbody.innerHTML = c.projects.map(function(p) {
        return '<tr onclick="openProject(\'' + p.id + '\')" style="cursor:pointer">' +
          '<td><span style="font-family:var(--mono);font-size:11.5px;color:var(--accent)">' + escHtml(p.code || '#'+p.id) + '</span> ' + escHtml(p.name) + '</td>' +
          '<td>' + renderPill(p.status) + '</td>' +
        '</tr>';
      }).join('');
    } else {
      projTbody.innerHTML = '<tr><td colspan="2"><div class="empty-state" style="padding:12px">暂无关联项目</div></td></tr>';
    }
    // Products table
    var prodTbody = document.getElementById('cust-det-prod-tbody');
    if (c.products && c.products.length) {
      prodTbody.innerHTML = c.products.map(function(p) {
        return '<tr onclick="openProductFromCust(' + p.id + ')" style="cursor:pointer">' +
          '<td><span style="font-family:var(--mono);font-size:11.5px;color:var(--accent)">' + escHtml(p.code || '#'+p.id) + '</span> ' + escHtml(p.name) + '</td>' +
          '<td>' + renderPill(p.status) + '</td>' +
        '</tr>';
      }).join('');
    } else {
      prodTbody.innerHTML = '<tr><td colspan="2"><div class="empty-state" style="padding:12px">暂无关联产品</div></td></tr>';
    }
  } catch(e) {
    document.getElementById('cust-det-name-head').textContent = '加载失败';
  }
}

function openProductFromCust(pid) {
  gotoView('product-detail');
  // Wait for view to switch, then load product
  setTimeout(function() { openProductDetail(pid); }, 150);
}
