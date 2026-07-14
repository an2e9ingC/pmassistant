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
    var nameEsc = escHtml(c.name).replace(/'/g, "\\'");
    return '<tr>' +
      '<td><button class="gs-btn gs-cust" onclick="openCustomerDetail(\'' + nameEsc + '\')">' + escHtml(c.name) + '</button></td>' +
      '<td style="font-size:12px;color:var(--muted)">' + escHtml(c.full_name || '—') + '</td>' +
      '<td><span onclick="event.stopPropagation();openCustomerDetail(\'' + nameEsc + '\')" style="cursor:pointer;padding:2px 8px;border-radius:10px;font-size:12px;font-weight:540;background:var(--accent-lt);color:var(--accent)" title="查看客户详情">' + (c.project_count || 0) + '</span></td>' +
      '<td><span onclick="event.stopPropagation();openCustomerDetail(\'' + nameEsc + '\')" style="cursor:pointer;padding:2px 8px;border-radius:10px;font-size:12px;font-weight:540;background:var(--success-lt);color:var(--success)" title="查看客户详情">' + (c.product_count || 0) + '</span></td>' +
      '<td style="white-space:nowrap">' +
        iconEdit('openCustEditDialog(' + c.id + ')') +
        iconDelete('deleteCust(' + c.id + ',\'' + escHtml(c.name) + '\')') +
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

async function initCustomerDetail(customerName) {
  var name = customerName || localStorage.getItem('pm_cust_name');
  if (!name) { gotoView('customers'); return; }
  document.getElementById('cust-det-proj-tbody').innerHTML = '<tr><td colspan="5"><div class="loading-spinner">加载中...</div></td></tr>';
  document.getElementById('cust-det-prod-tbody').innerHTML = '<tr><td colspan="5"><div class="loading-spinner">加载中...</div></td></tr>';
  try {
    var c = await API.get('/customers/' + encodeURIComponent(name));
    document.getElementById('cust-det-fullname').textContent = c.full_name || '';
    document.getElementById('cust-det-name-head').textContent = c.name;
    document.getElementById('topbar-title').textContent = c.name + ' · 客户详情';
    // Projects table
    var projTbody = document.getElementById('cust-det-proj-tbody');
    if (c.projects && c.projects.length) {
      projTbody.innerHTML = c.projects.map(function(p, i) {
        var prodTags = (p.products || []).map(function(pr) {
          return '<span style="display:inline-block;margin:1px 2px;padding:1px 6px;border-radius:3px;font-size:10.5px;background:var(--success-lt);color:var(--success);cursor:pointer" onclick="event.stopPropagation();openProductFromCust(\'' + escHtml(pr.code || String(pr.id)).replace(/'/g, "\\'") + '\')" title="' + escHtml(pr.name || '') + '">' + escHtml(pr.code || '#'+pr.id) + '</span>';
        }).join('');
        return '<tr>' +
          '<td style="color:var(--muted);font-size:12px">' + (i + 1) + '</td>' +
          '<td><span style="font-family:var(--mono);font-size:11.5px;color:var(--accent);cursor:pointer" onclick="event.stopPropagation();openProject(\'' + escHtml(p.code || String(p.id)).replace(/'/g, "\\'") + '\')">' + escHtml(p.code || '#'+p.id) + '</span></td>' +
          '<td>' + escHtml(p.name) + '</td>' +
          '<td>' + renderPill(p.status) + '</td>' +
          '<td>' + (prodTags || '<span style="color:var(--muted);font-size:11px">—</span>') + '</td>' +
        '</tr>';
      }).join('');
    } else {
      projTbody.innerHTML = '<tr><td colspan="5"><div class="empty-state" style="padding:12px">暂无关联项目</div></td></tr>';
    }
    // Products table
    var prodTbody = document.getElementById('cust-det-prod-tbody');
    if (c.products && c.products.length) {
      prodTbody.innerHTML = c.products.map(function(p, i) {
        var projTags = (p.projects || []).map(function(pj) {
          return '<span style="display:inline-block;margin:1px 2px;padding:1px 6px;border-radius:3px;font-size:10.5px;background:var(--accent-lt);color:var(--accent);cursor:pointer" onclick="event.stopPropagation();openProject(\'' + escHtml(pj.code || String(pj.id)).replace(/'/g, "\\'") + '\')" title="' + escHtml(pj.code || '') + '">' + escHtml(pj.code || '#'+pj.id) + '</span>';
        }).join('');
        return '<tr>' +
          '<td style="color:var(--muted);font-size:12px">' + (i + 1) + '</td>' +
          '<td><span style="font-family:var(--mono);font-size:11.5px;color:var(--accent);cursor:pointer" onclick="event.stopPropagation();openProductFromCust(\'' + escHtml(p.code || String(p.id)).replace(/'/g, "\\'") + '\')">' + escHtml(p.code || '#'+p.id) + '</span></td>' +
          '<td>' + escHtml(p.name) + '</td>' +
          '<td>' + renderPill(p.status) + '</td>' +
          '<td>' + (projTags || '<span style="color:var(--muted);font-size:11px">—</span>') + '</td>' +
        '</tr>';
      }).join('');
    } else {
      prodTbody.innerHTML = '<tr><td colspan="5"><div class="empty-state" style="padding:12px">暂无关联产品</div></td></tr>';
    }
  } catch(e) {
    document.getElementById('cust-det-name-head').textContent = '加载失败';
  }
}

function openProductFromCust(code) {
  gotoView('product-detail', {params: [String(code), 'info']});
}
