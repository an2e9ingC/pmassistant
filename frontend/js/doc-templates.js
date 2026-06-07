/* ═══════════════════════════════════════════════════
   DOCUMENT TEMPLATE CONFIGURATION PAGE
═══════════════════════════════════════════════════ */

var _templatesGrouped = {};  // { stage_type: [template, ...] }
var _selectedStage = null;   // currently selected stage_type
var _pendingOps = [];        // queued changes: {type, data...}
var _nextTempId = -1;        // negative IDs for unsaved templates
var _originalGrouped = null; // snapshot before edits, for "discard"

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

// Role options for responsible_role dropdown
var ROLE_OPTIONS = [
  '销售及售前', 'CTO', 'CEO', '项目经理',
  '硬件开发', '硬件测试', '结构设计及装配',
  'BSP开发', '业务软件开发', '测试交付',
  '采购', '质检', '库房管理',
];

function _roleSelect(selected) {
  return '<select class="search-inp" id="dt-role" style="margin-top:4px;padding:7px 8px">' +
    '<option value="">— 请选择 —</option>' +
    ROLE_OPTIONS.map(function(r) {
      return '<option value="' + r + '"' + (r === selected ? ' selected' : '') + '>' + r + '</option>';
    }).join('') +
  '</select>';
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
  var canEdit = user && (user.role === 'admin' || user.role === 'pm' || user.role === 'test_delivery');

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

  // Left panel: stage type list with edit/delete
  var leftHtml = stageTypes.map(function(st) {
    var count = (_templatesGrouped[st] || []).length;
    var sel = st === _selectedStage ? ' selected' : '';
    return '<div class="dt-stage-item' + sel + '">' +
      '<span onclick="selectDocTemplateStage(\'' + escHtml(st) + '\')" style="flex:1;cursor:pointer">' + escHtml(st) + '</span>' +
      '<span class="dt-stage-count">' + count + '</span>' +
      (canEdit ? '<span class="dt-stage-acts">' +
        '<button class="btn" style="font-size:10px;padding:1px 5px" onclick="event.stopPropagation();showRenameStageDialog(\'' + escHtml(st) + '\')" title="重命名">✎</button>' +
        '<button class="btn" style="font-size:10px;padding:1px 5px;color:var(--danger)" onclick="event.stopPropagation();deleteStageType(\'' + escHtml(st) + '\')" title="删除">✕</button>' +
      '</span>' : '') +
    '</div>';
  }).join('') +
  (canEdit ? '<div class="dt-stage-item" style="justify-content:center;color:var(--accent);font-size:12px;cursor:pointer;border:1px dashed var(--border)" onclick="showAddStageDialog()">+ 新增阶段类型</div>' : '');

  // Right panel: document list for selected stage
  var pendingCount = _pendingOps.length;
  var saveBtnHtml = '';
  if (canEdit && pendingCount > 0) {
    saveBtnHtml = '<button class="btn btn-primary" style="font-size:11px;padding:4px 14px;margin-left:8px" onclick="saveAllChanges()">保存配置 (' + pendingCount + ')</button>' +
      '<button class="btn" style="font-size:11px;padding:4px 10px;margin-left:4px" onclick="discardChanges()">放弃</button>';
  } else if (canEdit && pendingCount === 0) {
    saveBtnHtml = '<span style="font-size:11px;color:var(--muted);margin-left:8px">无待保存更改</span>';
  }
  var rightHtml = '<div class="dt-right">' +
    '<div class="dt-right-head">' +
      '<div style="display:flex;align-items:center">' +
        '<div class="section-title">' + escHtml(_selectedStage) + ' — 文档清单</div>' +
        saveBtnHtml +
      '</div>' +
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
        '<td style="font-family:var(--mono);color:var(--muted);text-align:center">' + (d.sort_order != null ? d.sort_order : '—') + '</td>' +
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
        '<div style="width:80px"><label style="font-size:11px;color:var(--muted)">序号</label><input class="search-inp" id="dt-sort" type="number" min="0" value="' + ((_templatesGrouped[_selectedStage] || []).length + 1) + '" style="margin-top:4px;width:100%;box-sizing:border-box;padding:8px 4px;text-align:center"></div>' +
        '<div style="width:150px"><label style="font-size:11px;color:var(--muted)">责任人（岗位）</label>' + _roleSelect('') + '</div>' +
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
  if (!d) { showToast('未找到该模板数据，请刷新页面', 'error'); return; }
  var html =
    '<div class="card" style="padding:16px;margin-top:12px" id="dt-form-card">' +
      '<div class="section-title" style="margin-bottom:10px">编辑文档模板</div>' +
      '<div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">' +
        '<div style="flex:1;min-width:180px"><label style="font-size:11px;color:var(--muted)">文档名称</label><input class="search-inp" id="dt-doc-name" value="' + escHtml(d.doc_name) + '" style="margin-top:4px"></div>' +
        '<div style="width:80px"><label style="font-size:11px;color:var(--muted)">序号</label><input class="search-inp" id="dt-sort" type="number" min="0" value="' + (d.sort_order != null ? d.sort_order : 1) + '" style="margin-top:4px;width:100%;box-sizing:border-box;padding:8px 4px;text-align:center"></div>' +
        '<div style="width:150px"><label style="font-size:11px;color:var(--muted)">责任人（岗位）</label>' + _roleSelect(d.responsible_role || '') + '</div>' +
        '<div style="flex:1;min-width:180px"><label style="font-size:11px;color:var(--muted)">说明（可选）</label><input class="search-inp" id="dt-desc" value="' + escHtml(d.description || '') + '" style="margin-top:4px"></div>' +
        '<button class="btn btn-primary" onclick="saveTemplate(' + id + ')" style="height:34px;font-size:12px">保存</button>' +
        '<button class="btn" onclick="cancelTemplateForm()" style="height:34px;font-size:12px">取消</button>' +
      '</div>' +
    '</div>';
  document.getElementById('dt-form-container').innerHTML = html;
  document.getElementById('dt-doc-name').focus();
}

function cancelTemplateForm() {
  var el = document.getElementById('dt-form-container');
  if (el) el.innerHTML = '';
}

function saveTemplate(id) {
  var nameEl = document.getElementById('dt-doc-name');
  var sortEl = document.getElementById('dt-sort');
  var roleEl = document.getElementById('dt-role');
  var descEl = document.getElementById('dt-desc');
  if (!nameEl || !sortEl) { showToast('表单数据异常，请重新打开', 'error'); return; }

  var name = nameEl.value.trim();
  var sortVal = sortEl.value;
  var sort = sortVal !== '' ? parseInt(sortVal) : 0;
  var role = roleEl ? roleEl.value.trim() : '';
  var desc = descEl ? descEl.value.trim() : '';
  if (!name) { showToast('请输入文档名称', 'error'); return; }
  if (isNaN(sort) || sort < 0) sort = 0;

  var stageType = _selectedStage;
  if (!id && !stageType) { showToast('阶段类型丢失，请重新选择阶段', 'error'); return; }

  if (id && id > 0) {
    // Edit existing — queue update
    var arr = _templatesGrouped[stageType] || [];
    var existing = arr.find(function(x) { return x.id === id; });
    if (existing) {
      existing.doc_name = name;
      existing.sort_order = sort;
      existing.responsible_role = role || '';
      existing.description = desc;
      _pendingOps.push({ type: 'edit', id: id, stage_type: stageType,
        doc_name: name, sort_order: sort, responsible_role: role || '', description: desc });
    }
  } else {
    // New template — add locally with temp ID
    var tempId = _nextTempId--;
    var newDoc = { id: tempId, stage_type: stageType, doc_name: name,
      sort_order: sort, responsible_role: role || '', description: desc };
    _pendingOps.push({ type: 'add', tempId: tempId, stage_type: stageType,
      doc_name: name, sort_order: sort, responsible_role: role || '', description: desc });
    var arr2 = _templatesGrouped[stageType];
    if (!arr2) { _templatesGrouped[stageType] = []; arr2 = _templatesGrouped[stageType]; }
    arr2.push(newDoc);
  }

  cancelTemplateForm();
  _selectedStage = stageType;
  renderTemplatesPage();
}

function deleteTemplate(id) {
  if (!confirm('确认删除此文档模板？')) return;
  if (id > 0) _pendingOps.push({ type: 'delete', id: id });
  // Remove from local cache
  var stageType = _selectedStage;
  var arr = _templatesGrouped[stageType];
  if (arr) {
    for (var i = arr.length - 1; i >= 0; i--) {
      if (arr[i].id === id) { arr.splice(i, 1); break; }
    }
  }
  renderTemplatesPage();
}

/* ── Stage Type Management (rename / add / delete) ── */

function showRenameStageDialog(oldName) {
  var html = '<div class="note-dialog-overlay" onclick="if(event.target===this)this.remove()">' +
    '<div class="note-dialog" style="max-width:380px" onclick="event.stopPropagation()">' +
      '<div class="note-dialog-head"><span class="note-dialog-title">重命名阶段类型</span>' +
        '<button class="note-dialog-close" onclick="this.closest(\'.note-dialog-overlay\').remove()">&times;</button></div>' +
      '<div style="margin-bottom:10px;font-size:12px;color:var(--muted)">当前名称: <b>' + escHtml(oldName) + '</b></div>' +
      '<input class="search-inp" id="dt-rename-input" value="' + escHtml(oldName) + '" style="margin-bottom:12px">' +
      '<div style="display:flex;justify-content:flex-end;gap:8px">' +
        '<button class="btn" onclick="this.closest(\'.note-dialog-overlay\').remove()">取消</button>' +
        '<button class="btn btn-primary" onclick="renameStageType(\'' + escHtml(oldName) + '\')">保存</button>' +
      '</div>' +
    '</div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
  document.getElementById('dt-rename-input').focus();
  document.getElementById('dt-rename-input').select();
}

function renameStageType(oldName) {
  var newName = document.getElementById('dt-rename-input').value.trim();
  if (!newName) { showToast('请输入新名称', 'error'); return; }
  if (newName === oldName) { document.querySelector('.note-dialog-overlay').remove(); return; }
  _pendingOps.push({ type: 'rename_stage', old_name: oldName, new_name: newName });
  // Update local cache
  if (_templatesGrouped[oldName]) {
    _templatesGrouped[newName] = _templatesGrouped[oldName];
    delete _templatesGrouped[oldName];
    _templatesGrouped[newName].forEach(function(d) { d.stage_type = newName; });
  }
  if (_selectedStage === oldName) _selectedStage = newName;
  document.querySelector('.note-dialog-overlay').remove();
  renderTemplatesPage();
}

function showAddStageDialog() {
  var html = '<div class="note-dialog-overlay" onclick="if(event.target===this)this.remove()">' +
    '<div class="note-dialog" style="max-width:380px" onclick="event.stopPropagation()">' +
      '<div class="note-dialog-head"><span class="note-dialog-title">新增阶段类型</span>' +
        '<button class="note-dialog-close" onclick="this.closest(\'.note-dialog-overlay\').remove()">&times;</button></div>' +
      '<div style="margin-bottom:10px;font-size:12px;color:var(--muted)">输入新阶段类型名称（新增后需手动添加文档模板）</div>' +
      '<input class="search-inp" id="dt-new-stage-input" placeholder="输入阶段名称" style="margin-bottom:12px">' +
      '<div style="display:flex;justify-content:flex-end;gap:8px">' +
        '<button class="btn" onclick="this.closest(\'.note-dialog-overlay\').remove()">取消</button>' +
        '<button class="btn btn-primary" onclick="addStageType()">创建</button>' +
      '</div>' +
    '</div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
  document.getElementById('dt-new-stage-input').focus();
}

function addStageType() {
  var name = document.getElementById('dt-new-stage-input').value.trim();
  if (!name) { showToast('请输入阶段名称', 'error'); return; }
  _pendingOps.push({ type: 'add_stage', stage_type: name });
  var tempId = _nextTempId--;
  var placeholder = { id: tempId, stage_type: name, doc_name: '（待配置）',
    sort_order: 1, responsible_role: '', description: '请修改或删除此占位模板' };
  _pendingOps.push({ type: 'add', tempId: tempId, stage_type: name,
    doc_name: placeholder.doc_name, sort_order: 1, responsible_role: '', description: placeholder.description });
  _templatesGrouped[name] = [placeholder];
  document.querySelector('.note-dialog-overlay').remove();
  _selectedStage = name;
  renderTemplatesPage();
}

function deleteStageType(stageType) {
  var count = (_templatesGrouped[stageType] || []).length;
  if (!confirm('确认删除阶段类型 "' + stageType + '"？\n将同时删除其下的 ' + count + ' 个文档模板。此操作不可撤销。')) return;
  _pendingOps.push({ type: 'delete_stage', stage_type: stageType });
  delete _templatesGrouped[stageType];
  if (_selectedStage === stageType) _selectedStage = null;
  if (!Object.keys(_templatesGrouped).length) {
    document.getElementById('view-doc-templates').innerHTML = '<div class="empty-state" style="padding:40px">暂无文档模板，点击下方"保存配置"或刷新页面</div>';
    return;
  }
  renderTemplatesPage();
}

/* ── Save / Discard ── */

async function saveAllChanges() {
  if (!_pendingOps.length) { showToast('没有待保存的更改', 'error'); return; }
  var ops = _pendingOps.slice(); // snapshot
  var total = ops.length;
  var success = 0, fail = 0;

  for (var i = 0; i < ops.length; i++) {
    var op = ops[i];
    try {
      if (op.type === 'add') {
        await API.post('/doc-templates', { stage_type: op.stage_type, doc_name: op.doc_name, sort_order: op.sort_order, responsible_role: op.responsible_role || '', description: op.description || '' });
        success++;
      } else if (op.type === 'edit') {
        await API.put('/doc-templates/' + op.id, { doc_name: op.doc_name, sort_order: op.sort_order, responsible_role: op.responsible_role || '', description: op.description || '' });
        success++;
      } else if (op.type === 'delete') {
        await API.del('/doc-templates/' + op.id);
        success++;
      } else if (op.type === 'rename_stage') {
        await API.put('/doc-templates/stage-types/rename', { old_name: op.old_name, new_name: op.new_name });
        success++;
      } else if (op.type === 'delete_stage') {
        await API.del('/doc-templates/stage-types/' + encodeURIComponent(op.stage_type));
        success++;
      } else if (op.type === 'add_stage') {
        // No-op: the placeholder template is handled by 'add' op
        success++;
      }
    } catch(e) {
      fail++;
      showToast('操作失败: ' + (e.message || '未知错误'), 'error');
    }
  }

  _pendingOps = [];
  // Full refresh from server
  try {
    var fresh = await API.get('/doc-templates');
    if (fresh && Object.keys(fresh).length) {
      _templatesGrouped = fresh;
    }
  } catch(e) {}
  showToast('保存完成: ' + success + ' 成功' + (fail > 0 ? ', ' + fail + ' 失败' : ''), success === total ? 'success' : 'error');
  renderTemplatesPage();
}

function discardChanges() {
  if (!confirm('放弃所有未保存的更改？此操作不可撤销。')) return;
  _pendingOps = [];
  // Re-fetch from server
  API.get('/doc-templates').then(function(fresh) {
    if (fresh && Object.keys(fresh).length) {
      _templatesGrouped = fresh;
    }
    renderTemplatesPage();
  }).catch(function() {
    renderTemplatesPage();
  });
}
