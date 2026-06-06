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
      '<td><strong>' + escHtml(c.name) + '</strong></td>' +
      '<td style="font-size:12px;color:var(--muted)">' + escHtml(c.full_name || '—') + '</td>' +
      '<td>' + (c.project_count || 0) + '</td>' +
      '<td>' + (c.product_count || 0) + '</td>' +
      '<td>' +
        '<button class="btn" onclick="openCustEditDialog(' + c.id + ')" style="font-size:11px;padding:3px 10px;margin-right:4px">编辑</button>' +
        '<button class="btn" onclick="deleteCust(' + c.id + ',\'' + escHtml(c.name) + '\')" style="font-size:11px;padding:3px 10px;color:var(--danger)">删除</button>' +
      '</td>' +
    '</tr>';
  }).join('');
}

function openCustCreateDialog() {
  var html = '<div class="note-dialog-overlay" onclick="if(event.target===this)closeCustDialog()">' +
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
  var html = '<div class="note-dialog-overlay" onclick="if(event.target===this)closeCustDialog()">' +
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
  try { await API.del('/customers/' + id); loadCustTable(); } catch(e) { showToast('删除失败: ' + e.message, 'error'); }
}
