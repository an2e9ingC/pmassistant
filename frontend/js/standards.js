/* ═══════════════════════════════════════════════════
   PROCESS STANDARDS PAGE (流程规范)
═══════════════════════════════════════════════════ */

var _standardsGrouped = {};  // { category: [{id, key, value, description}, ...] }

async function initStandards() {
  var container = document.getElementById('view-standards');
  container.innerHTML = '<div class="loading-spinner">加载流程规范...</div>';
  try {
    markPageClean(); _standardsGrouped = await API.get('/standards') || {};
    renderStandards();
  } catch(e) {
    container.innerHTML = '<div class="error-state">加载失败: ' + escHtml(e.message) + '<br><button class="btn" onclick="initStandards()">重试</button></div>';
  }
}

function renderStandards() {
  var user = getCurrentUser();
  var perms = (user && user.permissions) ? user.permissions.split(',') : [];
  var canEdit = perms.indexOf('doc_template') >= 0 || perms.indexOf('admin') >= 0;

  var categories = Object.keys(_standardsGrouped).sort();
  if (!categories.length) {
    document.getElementById('view-standards').innerHTML = '<div class="empty-state" style="padding:40px">暂无流程规范</div>';
    return;
  }

  var html = '';
  categories.forEach(function(cat, idx) {
    var items = _standardsGrouped[cat] || [];
    html += '<div class="card" style="padding:16px;margin-bottom:16px">' +
      '<div class="section-title" style="margin-bottom:12px">' + escHtml(cat) + '</div>' +
      '<div id="std-table-' + idx + '"></div></div>';
  });

    if (isPageDirty()) {
    html += '<div style="position:fixed;bottom:20px;right:20px;z-index:100;display:flex;gap:8px;background:var(--surface);padding:10px 16px;border:1px solid var(--warn);border-radius:10px;box-shadow:var(--sh-md)">' +
      '<span style="font-size:12px;color:var(--warn);line-height:2">⚠ 已修改，待保存</span>' +
      '<button class="btn btn-primary" onclick="saveStandardsChanges()">保存配置</button>' +
      '<button class="btn" style="color:var(--warn);border-color:var(--warn)" onclick="discardStandardsChanges()">放弃</button>' +
    '</div>';
  }
  document.getElementById('view-standards').innerHTML = html;

  // Build DataTable for each category
  categories.forEach(function(cat, idx) {
    var items = _standardsGrouped[cat] || [];
    var cols = [
      { key: 'key', title: '规则键', width: '200px', render: function(v) { return '<span style="font-family:var(--mono);font-size:12px;font-weight:500">' + escHtml(v||'') + '</span>'; } },
      { key: 'value', title: '规则值', render: function(v) { return '<code style="font-size:12px;color:var(--accent);word-break:break-all">' + escHtml(v||'（未设置）') + '</code>'; } },
      { key: 'description', title: '说明', width: '300px', render: function(v) { return '<span style="font-size:12px;color:var(--muted)">' + escHtml(v||'') + '</span>'; } }
    ];
    if (canEdit) cols.push({ key: 'actions', title: '操作', width: '70px', render: function(v, row) { return '<button class="btn btn-xs" onclick="showStdEdit(' + row.id + ')">编辑</button>'; } });
  });
}

function showStdEdit(id) {
  var found = null;
  Object.keys(_standardsGrouped).forEach(function(cat) {
    (_standardsGrouped[cat] || []).forEach(function(s) {
      if (s.id === id) found = s;
    });
  });
  if (!found) return;

  var bodyHtml = '<div style="padding:8px 0">' +
    '<div style="margin-bottom:10px">' +
      '<label style="font-size:11px;color:var(--muted)">规则键</label>' +
      '<div style="font-family:var(--mono);font-size:13px;font-weight:600;margin-top:2px">' + escHtml(found.key) + '</div>' +
    '</div>' +
    '<div style="margin-bottom:10px">' +
      '<label style="font-size:11px;color:var(--muted)">规则值</label>' +
      '<textarea class="search-inp" id="std-value" style="margin-top:4px;width:100%;min-height:80px;font-family:var(--mono);font-size:12px;box-sizing:border-box">' + escHtml(found.value || '') + '</textarea>' +
    '</div>' +
    '<div style="margin-bottom:10px">' +
      '<label style="font-size:11px;color:var(--muted)">说明</label>' +
      '<input class="search-inp" id="std-desc" value="' + escHtml(found.description || '') + '" style="margin-top:4px">' +
    '</div>' +
  '</div>';

  openDialog('编辑规则: ' + found.key, bodyHtml, [
    { text: '取消', cls: '', onclick: "this.closest('.note-dialog-overlay').remove()" },
    { text: '保存', cls: 'btn-primary', onclick: "saveStdEdit(" + id + ");this.closest('.note-dialog-overlay').remove()" },
  ]);
}

async function saveStdEdit(id) {
  var value = document.getElementById('std-value').value;
  var desc = document.getElementById('std-desc').value.trim();
  try {
    await API.put('/standards/' + id, { value: value, description: desc });
    showToast('已保存', 'success');
    markPageClean(); _standardsGrouped = await API.get('/standards');
    renderStandards();
  } catch(e) {
    showToast('保存失败: ' + (e.message || '未知错误'), 'error');
  }
}

/* ── Batch Save / Discard ── */

async function saveStandardsChanges() {
  var all = [];
  Object.keys(_standardsGrouped).forEach(function(cat) {
    (_standardsGrouped[cat] || []).forEach(function(s) { all.push(s); });
  });
  var success = 0, fail = 0;
  for (var i = 0; i < all.length; i++) {
    var s = all[i];
    try {
      await API.put('/standards/' + s.id, { value: s.value, description: s.description });
      success++;
    } catch(e) { fail++; }
  }
  showToast('保存完成: ' + success + ' 成功' + (fail > 0 ? ', ' + fail + ' 失败' : ''), fail ? 'error' : 'success');
  _standardsGrouped = await API.get('/standards');
  markPageClean();
  renderStandards();
}

function discardStandardsChanges() {
  if (!confirm('放弃所有未保存的修改？')) return;
  API.get('/standards').then(function(d) {
    _standardsGrouped = d;
    markPageClean();
    renderStandards();
  });
}
