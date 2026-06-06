/* ═══════════════════════════════════════════════════
   DOCUMENT TEMPLATE CONFIGURATION PAGE
═══════════════════════════════════════════════════ */

var _templatesGrouped = {};  // { stage_type: [template, ...] }
var _selectedStage = null;   // currently selected stage_type

// Fixed stage order matching the project lifecycle
var STAGE_ORDER = [
  '售前', '项目立项', '需求分解',
  '硬件开发', '结构设计', 'BSP开发', '软件开发',
  '测试', '产品发货', '项目总结',
];

function _sortStageTypes(types) {
  return types.sort(function(a, b) {
    var ai = STAGE_ORDER.indexOf(a);
    var bi = STAGE_ORDER.indexOf(b);
    if (ai < 0) ai = 999;
    if (bi < 0) bi = 999;
    return ai - bi;
  });
}

async function initDocTemplates() {
  var container = document.getElementById('view-doc-templates');
  container.innerHTML = '<div class="loading-spinner">加载模板配置...</div>';
  try {
    var data = await API.get('/doc-templates');
    _templatesGrouped = data || {};
    if (!Object.keys(_templatesGrouped).length) {
      container.innerHTML = '<div class="empty-state" style="padding:40px">暂无文档模板，请联系管理员通过种子数据初始化</div>';
      return;
    }
    // Default select first stage type
    var types = _sortStageTypes(Object.keys(_templatesGrouped));
    if (types.length && !_selectedStage) _selectedStage = types[0];
    renderTemplatesPage();
  } catch(e) {
    container.innerHTML = '<div class="error-state">加载失败: ' + escHtml(e.message) + '<br><button class="btn" onclick="initDocTemplates()">重试</button></div>';
  }
}

function renderTemplatesPage() {
  var user = getCurrentUser();
  var canEdit = user && user.role === 'admin';

  var stageTypes = _sortStageTypes(Object.keys(_templatesGrouped));
  if (!stageTypes.length) {
    document.getElementById('view-doc-templates').innerHTML = '<div class="empty-state" style="padding:40px">暂无文档模板配置</div>';
    return;
  }

  // Ensure selected stage is valid
  if (!_selectedStage || stageTypes.indexOf(_selectedStage) < 0) {
    _selectedStage = stageTypes[0];
  }

  var docs = _templatesGrouped[_selectedStage] || [];

  // Left panel: stage type list
  var leftHtml = stageTypes.map(function(st) {
    var count = (_templatesGrouped[st] || []).length;
    var sel = st === _selectedStage ? ' selected' : '';
    return '<div class="dt-stage-item' + sel + '" onclick="selectDocTemplateStage(\'' + escHtml(st) + '\')">' +
      '<span>' + escHtml(st) + '</span>' +
      '<span class="dt-stage-count">' + count + '</span>' +
    '</div>';
  }).join('');

  // Right panel: document list for selected stage
  var rightHtml = '<div class="dt-right">' +
    '<div class="dt-right-head">' +
      '<div class="section-title">' + escHtml(_selectedStage) + ' — 文档清单</div>' +
      (canEdit ? '<button class="btn" style="font-size:11px;padding:4px 12px" onclick="showAddTemplateForm()">+ 添加文档</button>' : '') +
    '</div>';

  if (docs.length) {
    rightHtml += '<div class="table-scroll"><table class="stage-table"><thead><tr>' +
      '<th style="width:50px">序号</th>' +
      '<th>文档名称</th>' +
      '<th>责任人（岗位）</th>' +
      '<th>说明</th>' +
      (canEdit ? '<th style="width:90px;white-space:nowrap">操作</th>' : '') +
    '</tr></thead><tbody>';

    docs.forEach(function(d) {
      rightHtml += '<tr>' +
        '<td style="font-family:var(--mono);color:var(--muted);text-align:center">' + (d.sort_order || '—') + '</td>' +
        '<td style="font-weight:500">' + escHtml(d.doc_name) + '</td>' +
        '<td style="font-size:12px;white-space:nowrap">' + escHtml(d.responsible_role || '—') + '</td>' +
        '<td style="font-size:12px;color:var(--muted)">' + escHtml(d.description || '') + '</td>' +
        (canEdit
          ? '<td style="white-space:nowrap;text-align:center">' +
              '<button class="btn" style="font-size:10px;padding:2px 8px;margin-right:4px" onclick="showEditTemplateForm(' + d.id + ')">编辑</button>' +
              '<button class="btn" style="font-size:10px;padding:2px 8px;color:var(--danger)" onclick="deleteTemplate(' + d.id + ')">删除</button>' +
            '</td>'
          : '') +
      '</tr>';
    });
    rightHtml += '</tbody></table></div>';
  } else {
    rightHtml += '<div class="empty-state" style="padding:20px">该阶段类型暂无文档模板</div>';
  }
  rightHtml += '</div>';

  document.getElementById('view-doc-templates').innerHTML =
    '<div class="dt-layout">' +
      '<div class="dt-left">' +
        '<div class="section-title" style="margin-bottom:10px">阶段类型</div>' +
        leftHtml +
      '</div>' +
      rightHtml +
    '</div>' +
    '<div id="dt-form-container"></div>';
}

function selectDocTemplateStage(stageType) {
  _selectedStage = stageType;
  renderTemplatesPage();
}

/* ── Add/Edit Template Forms ── */

function showAddTemplateForm() {
  var html =
    '<div class="card" style="padding:16px;margin-top:12px" id="dt-form-card">' +
      '<div class="section-title" style="margin-bottom:10px">添加文档模板 — ' + escHtml(_selectedStage) + '</div>' +
      '<div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">' +
        '<div style="flex:1;min-width:180px"><label style="font-size:11px;color:var(--muted)">文档名称</label><input class="search-inp" id="dt-doc-name" style="margin-top:4px"></div>' +
        '<div style="width:80px"><label style="font-size:11px;color:var(--muted)">序号</label><input class="search-inp" id="dt-sort" type="number" value="' + ((_templatesGrouped[_selectedStage] || []).length + 1) + '" style="margin-top:4px"></div>' +
        '<div style="width:140px"><label style="font-size:11px;color:var(--muted)">责任人（岗位）</label><input class="search-inp" id="dt-role" style="margin-top:4px" placeholder="如：硬件开发"></div>' +
        '<div style="flex:1;min-width:180px"><label style="font-size:11px;color:var(--muted)">说明（可选）</label><input class="search-inp" id="dt-desc" style="margin-top:4px"></div>' +
        '<button class="btn btn-primary" onclick="saveTemplate()" style="height:34px;font-size:12px">添加</button>' +
        '<button class="btn" onclick="cancelTemplateForm()" style="height:34px;font-size:12px">取消</button>' +
      '</div>' +
    '</div>';
  document.getElementById('dt-form-container').innerHTML = html;
  document.getElementById('dt-doc-name').focus();
}

function showEditTemplateForm(id) {
  var docs = _templatesGrouped[_selectedStage] || [];
  var d = docs.find(function(x) { return x.id === id; });
  if (!d) return;
  var html =
    '<div class="card" style="padding:16px;margin-top:12px" id="dt-form-card">' +
      '<div class="section-title" style="margin-bottom:10px">编辑文档模板</div>' +
      '<div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">' +
        '<div style="flex:1;min-width:180px"><label style="font-size:11px;color:var(--muted)">文档名称</label><input class="search-inp" id="dt-doc-name" value="' + escHtml(d.doc_name) + '" style="margin-top:4px"></div>' +
        '<div style="width:80px"><label style="font-size:11px;color:var(--muted)">序号</label><input class="search-inp" id="dt-sort" type="number" value="' + (d.sort_order || 0) + '" style="margin-top:4px"></div>' +
        '<div style="width:140px"><label style="font-size:11px;color:var(--muted)">责任人（岗位）</label><input class="search-inp" id="dt-role" value="' + escHtml(d.responsible_role || '') + '" style="margin-top:4px" placeholder="如：硬件开发"></div>' +
        '<div style="flex:1;min-width:180px"><label style="font-size:11px;color:var(--muted)">说明（可选）</label><input class="search-inp" id="dt-desc" value="' + escHtml(d.description || '') + '" style="margin-top:4px"></div>' +
        '<button class="btn btn-primary" onclick="saveTemplate(' + id + ')" style="height:34px;font-size:12px">保存</button>' +
        '<button class="btn" onclick="cancelTemplateForm()" style="height:34px;font-size:12px">取消</button>' +
      '</div>' +
    '</div>';
  document.getElementById('dt-form-container').innerHTML = html;
  document.getElementById('dt-doc-name').focus();
}

function cancelTemplateForm() {
  document.getElementById('dt-form-container').innerHTML = '';
}

async function saveTemplate(id) {
  var name = document.getElementById('dt-doc-name').value.trim();
  var sort = parseInt(document.getElementById('dt-sort').value) || 0;
  var role = document.getElementById('dt-role').value.trim();
  var desc = document.getElementById('dt-desc').value.trim();
  if (!name) { showToast('请输入文档名称', 'error'); return; }

  try {
    if (id) {
      await API.put('/doc-templates/' + id, { doc_name: name, sort_order: sort, responsible_role: role, description: desc });
      showToast('修改成功', 'success');
    } else {
      await API.post('/doc-templates', { stage_type: _selectedStage, doc_name: name, sort_order: sort, responsible_role: role, description: desc });
      showToast('添加成功', 'success');
    }
    cancelTemplateForm();
    // Refresh data
    _templatesGrouped = await API.get('/doc-templates');
    renderTemplatesPage();
  } catch(e) {
    showToast('保存失败: ' + (e.message || '未知错误'), 'error');
  }
}

async function deleteTemplate(id) {
  if (!confirm('确认删除此文档模板？此操作不可撤销。')) return;
  try {
    await API.del('/doc-templates/' + id);
    showToast('删除成功', 'success');
    _templatesGrouped = await API.get('/doc-templates');
    renderTemplatesPage();
  } catch(e) {
    showToast('删除失败: ' + (e.message || '未知错误'), 'error');
  }
}
