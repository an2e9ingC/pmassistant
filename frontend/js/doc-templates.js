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

function switchDocTemplateTab(tab, el) {
  _currentTab = tab;
  document.querySelectorAll('#view-doc-templates .map-tab').forEach(function(t) { t.classList.remove('active'); });
  if (el) el.classList.add('active');
  document.getElementById('dtsec-project').style.display = tab === 'project' ? '' : 'none';
  document.getElementById('dtsec-product').style.display = tab === 'product' ? '' : 'none';
  document.getElementById('dtsec-tags').style.display = tab === 'tags' ? '' : 'none';
  if (tab === 'project') initDocTemplates();
  else if (tab === 'product') initProductDocTemplates();
  else if (tab === 'tags') initTags();
}
var _currentTab = 'project';

// ── Drag-and-drop reorder ──

var _dragSourceIndex = -1;

function _trDragStart(e) {
  _dragSourceIndex = parseInt(this.getAttribute('data-drag-index'));
  this.style.opacity = '0.4';
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', '');
  e.stopPropagation();
}

function _trDragEnd(e) {
  this.style.opacity = '';
  document.querySelectorAll('.dt-drag-over').forEach(function(r) { r.classList.remove('dt-drag-over'); });
}

function _trDragOver(e) {
  if (_dragSourceIndex < 0) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  this.classList.add('dt-drag-over');
}

function _trDragLeave(e) {
  this.classList.remove('dt-drag-over');
}

function _trDrop(e, list, renderFn) {
  e.preventDefault();
  e.stopPropagation();
  this.classList.remove('dt-drag-over');
  var targetIndex = parseInt(this.getAttribute('data-drag-index'));
  if (_dragSourceIndex < 0 || _dragSourceIndex === targetIndex) return;

  // Reorder the array
  var moved = list.splice(_dragSourceIndex, 1)[0];
  list.splice(targetIndex, 0, moved);

  // Update sort_order for all items
  for (var i = 0; i < list.length; i++) {
    list[i].sort_order = i + 1;
  }

  _dragSourceIndex = -1;
  renderFn();
}

async function initDocTemplates() {
  var container = document.getElementById('dtsec-project');
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
  var perms = (user && user.permissions) ? user.permissions.split(',') : [];
  var canEdit = user && (user.role === 'admin' || perms.indexOf('doc_template') >= 0);

  var stageTypes = _sortStageTypes(Object.keys(_templatesGrouped));
  if (!stageTypes.length) {
    document.getElementById('dtsec-project').innerHTML = '<div class="empty-state" style="padding:40px">暂无文档模板配置</div>';
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
    return '<div class="dt-stage-item' + sel + '" onclick="selectDocTemplateStage(\'' + escHtml(st) + '\')">' +
      '<span style="flex:1">' + escHtml(st) + '</span>' +
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
      '<button class="btn" style="font-size:11px;padding:4px 10px;margin-left:4px;color:var(--warn);border-color:var(--warn)" onclick="discardChanges()">放弃</button>';
  } else if (canEdit && pendingCount === 0) {
    saveBtnHtml = '<span style="font-size:11px;color:var(--muted);margin-left:8px"><span style="color:var(--muted)">✓ 已保存</span></span>';
  }
  var syncAllHtml = canEdit
    ? '<button class="btn" style="font-size:11px;padding:4px 10px;margin-left:8px;color:var(--accent);border-color:var(--accent)" onclick="syncAllProjects()" title="将当前模板应用到全部项目的文档清单">↻ 应用到全部项目</button>'
    : '';
  var rightHtml = '<div class="dt-right">' +
    '<div class="dt-right-head">' +
      '<div style="display:flex;align-items:center">' +
        '<div class="section-title">' + escHtml(_selectedStage) + ' — 文档清单</div>' +
        saveBtnHtml +
        syncAllHtml +
      '</div>' +
      (canEdit ? '<button class="btn" style="font-size:11px;padding:4px 12px" onclick="showAddTemplateForm()">+ 添加文档</button>' : '') +
    '</div>';

  if (docs.length) {
    rightHtml += '<div class="table-scroll"><table class="stage-table"><thead><tr>' +
      '<th style="width:50px">序号</th>' +
      '<th>文档名称</th>' +
      '<th>责任人（岗位）</th>' +
      '<th style="width:140px">路径</th>' +
      '<th>说明</th>' +
      (canEdit ? '<th style="width:90px;white-space:nowrap">操作</th>' : '') +
    '</tr></thead><tbody>';

    docs.forEach(function(d, i) {
      rightHtml += '<tr>' +
        '<td data-drag-index="' + i + '" draggable="true"' +
        ' ondragstart="_trDragStart.call(this,event)" ondragend="_trDragEnd.call(this,event)"' +
        ' ondragover="_trDragOver.call(this,event)" ondragleave="_trDragLeave.call(this,event)"' +
        ' ondrop="_trDrop.call(this,event,_templatesGrouped[_selectedStage] || [],renderTemplatesAfterReorder)"' +
        ' style="font-family:var(--mono);color:var(--muted);text-align:center;cursor:grab" title="拖动排序">' + (d.sort_order != null ? d.sort_order : '—') + '</td>' +
        '<td style="font-weight:500">' + escHtml(d.doc_name) + '</td>' +
        '<td style="font-size:12px;white-space:nowrap">' + escHtml(d.responsible_role || '—') + '</td>' +
        '<td style="font-size:12px">' + (d.doc_path
          ? '<a href="' + escHtml(d.doc_path) + '" target="_blank" style="color:var(--accent);text-decoration:none" onmouseover="this.style.textDecoration=\'underline\'" onmouseout="this.style.textDecoration=\'none\'" title="点击打开路径">' + escHtml(d.doc_path) + ' ↗</a>'
          : '—') + '</td>' +
        '<td style="font-size:12px;color:var(--muted)">' + escHtml(d.description || '') + '</td>' +
        (canEdit
          ? '<td style="white-space:nowrap;text-align:center" ondragover="event.stopPropagation()" ondrop="event.stopPropagation()">' +
              '<button class="btn" style="font-size:12px;padding:2px 6px;margin-right:2px" onclick="copyTemplate(' + d.id + ')" title="复制">📋</button>' +
              '<button class="btn" style="font-size:12px;padding:2px 6px;margin-right:2px" onclick="showEditTemplateForm(' + d.id + ')" title="编辑">✎</button>' +
              '<button class="btn" style="font-size:12px;padding:2px 6px;color:var(--danger)" onclick="deleteTemplate(' + d.id + ')" title="删除">✕</button>' +
            '</td>'
          : '') +
      '</tr>';
    });
    rightHtml += '</tbody></table></div>';
    rightHtml += '<div style="font-size:10.5px;color:var(--muted);margin-top:4px">💡 拖动序号列可调整文档顺序</div>';
  } else {
    rightHtml += '<div class="empty-state" style="padding:20px">该阶段类型暂无文档模板</div>';
  }
  rightHtml += '</div>';

  document.getElementById('dtsec-project').innerHTML =
    '<div class="dt-layout">' +
      '<div class="dt-left">' +
        '<div class="section-title" style="margin-bottom:10px">阶段类型</div>' +
        leftHtml +
      '</div>' +
      rightHtml +
    '</div>';
}

function selectDocTemplateStage(stageType) {
  _selectedStage = stageType;
  renderTemplatesPage();
}

/* ── Add/Edit Template Forms ── */

function showAddTemplateForm() {
  var nextSort = ((_templatesGrouped[_selectedStage] || []).length + 1);
  openDialog('添加文档模板 — ' + escHtml(_selectedStage),
    '<div style="margin-bottom:10px">' +
      '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">文档名称</label>' +
      '<input class="search-inp" id="dt-doc-name" style="width:100%;box-sizing:border-box">' +
    '</div>' +
    '<div style="display:flex;gap:10px;margin-bottom:10px">' +
      '<div style="width:80px"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">序号</label>' +
        '<input class="search-inp" id="dt-sort" type="number" min="0" value="' + nextSort + '" style="width:100%;box-sizing:border-box;padding:8px 4px;text-align:center"></div>' +
      '<div style="flex:1"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">责任人（岗位）</label>' + _roleSelect('') + '</div>' +
    '</div>' +
    '<div style="margin-bottom:10px">' +
      '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">路径 <span style="color:var(--danger)">*必填</span></label>' +
      '<input class="search-inp" id="dt-path" placeholder="文档索引路径（如 NAS 路径）" style="width:100%;box-sizing:border-box">' +
    '</div>' +
    '<div style="margin-bottom:4px">' +
      '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">说明（可选）</label>' +
      '<input class="search-inp" id="dt-desc" style="width:100%;box-sizing:border-box">' +
    '</div>',
    [{text: '取消', cls: '', onclick: 'closeSharedDialog()'},
     {text: '确定', cls: 'btn-primary', onclick: 'saveTemplate()'}], {hideClose: true});
}

function showEditTemplateForm(id) {
  var docs = _templatesGrouped[_selectedStage] || [];
  var d = docs.find(function(x) { return x.id === id; });
  if (!d) { showToast('未找到该模板数据，请刷新页面', 'error'); return; }
  openDialog('编辑文档模板',
    '<div style="margin-bottom:10px">' +
      '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">文档名称</label>' +
      '<input class="search-inp" id="dt-doc-name" value="' + escHtml(d.doc_name) + '" style="width:100%;box-sizing:border-box">' +
    '</div>' +
    '<div style="display:flex;gap:10px;margin-bottom:10px">' +
      '<div style="width:80px"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">序号</label>' +
        '<input class="search-inp" id="dt-sort" type="number" min="0" value="' + (d.sort_order != null ? d.sort_order : 1) + '" style="width:100%;box-sizing:border-box;padding:8px 4px;text-align:center"></div>' +
      '<div style="flex:1"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">责任人（岗位）</label>' + _roleSelect(d.responsible_role || '') + '</div>' +
    '</div>' +
    '<div style="margin-bottom:10px">' +
      '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">路径 <span style="color:var(--danger)">*必填</span></label>' +
      '<input class="search-inp" id="dt-path" value="' + escHtml(d.doc_path || '') + '" placeholder="文档索引路径" style="width:100%;box-sizing:border-box">' +
    '</div>' +
    '<div style="margin-bottom:4px">' +
      '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">说明（可选）</label>' +
      '<input class="search-inp" id="dt-desc" value="' + escHtml(d.description || '') + '" style="width:100%;box-sizing:border-box">' +
    '</div>',
    [{text: '取消', cls: '', onclick: 'closeSharedDialog()'},
     {text: '确定', cls: 'btn-primary', onclick: 'saveTemplate(' + id + ')'}], {hideClose: true});
}

function saveTemplate(id) {
  var nameEl = document.getElementById('dt-doc-name');
  var sortEl = document.getElementById('dt-sort');
  var roleEl = document.getElementById('dt-role');
  var descEl = document.getElementById('dt-desc');
  var pathEl = document.getElementById('dt-path');
  if (!nameEl || !sortEl) { showToast('表单数据异常，请重新打开', 'error'); return; }

  var name = nameEl.value.trim();
  var sortVal = sortEl.value;
  var sort = sortVal !== '' ? parseInt(sortVal) : 0;
  var role = roleEl ? roleEl.value.trim() : '';
  var desc = descEl ? descEl.value.trim() : '';
  var path = pathEl ? pathEl.value.trim() : '';
  if (!name) { showToast('请输入文档名称', 'error'); return; }
  if (!path) { showToast('请输入路径', 'error'); return; }
  if (isNaN(sort) || sort < 0) sort = 0;

  var stageType = _selectedStage;
  if (!id && !stageType) { showToast('阶段类型丢失，请重新选择阶段', 'error'); return; }

  if (id && id > 0) {
    // Edit existing server-side template
    var arr = _templatesGrouped[stageType] || [];
    var existing = arr.find(function(x) { return x.id === id; });
    if (!existing) { showToast('未找到该模板', 'error'); return; }
    existing.doc_name = name;
    existing.sort_order = sort;
    existing.responsible_role = role || '';
    existing.description = desc;
    existing.doc_path = path;
    _pendingOps.push({ type: 'edit', id: id, stage_type: stageType,
      doc_name: name, sort_order: sort, responsible_role: role || '', description: desc, doc_path: path });
  } else if (id && id < 0) {
    // Edit locally-added (not yet saved) template — update pending add op
    var arr = _templatesGrouped[stageType] || [];
    var existing = arr.find(function(x) { return x.id === id; });
    if (existing) {
      existing.doc_name = name;
      existing.sort_order = sort;
      existing.responsible_role = role || '';
      existing.description = desc;
      existing.doc_path = path;
    }
    // Update the pending add op too
    for (var pi = 0; pi < _pendingOps.length; pi++) {
      if (_pendingOps[pi].tempId === id) {
        _pendingOps[pi].doc_name = name;
        _pendingOps[pi].sort_order = sort;
        _pendingOps[pi].responsible_role = role || '';
        _pendingOps[pi].description = desc;
        _pendingOps[pi].doc_path = path;
        break;
      }
    }
  } else {
    // New template — add locally with temp ID
    var tempId = _nextTempId--;
    var newDoc = { id: tempId, stage_type: stageType, doc_name: name,
      sort_order: sort, responsible_role: role || '', description: desc, doc_path: path };
    _pendingOps.push({ type: 'add', tempId: tempId, stage_type: stageType,
      doc_name: name, sort_order: sort, responsible_role: role || '', description: desc, doc_path: path });
    var arr2 = _templatesGrouped[stageType];
    if (!arr2) { _templatesGrouped[stageType] = []; arr2 = _templatesGrouped[stageType]; }
    arr2.push(newDoc);
  }

  var overlay = document.querySelector('.shared-dialog-overlay');
  if (overlay) overlay.remove();
  _selectedStage = stageType;
  renderTemplatesPage();
}

function renderTemplatesAfterReorder() {
  var docs = _templatesGrouped[_selectedStage] || [];
  for (var i = 0; i < docs.length; i++) {
    var d = docs[i];
    d.sort_order = i + 1;
    // Push edit op for server-side templates
    if (d.id > 0) {
      _pendingOps.push({ type: 'edit', id: d.id, stage_type: _selectedStage,
        doc_name: d.doc_name, sort_order: d.sort_order, responsible_role: d.responsible_role || '',
        description: d.description || '', doc_path: d.doc_path || '' });
    }
  }
  renderTemplatesPage();
}

function copyTemplate(id) {
  var arr = _templatesGrouped[_selectedStage] || [];
  var tpl = arr.find(function(x) { return x.id === id; });
  if (!tpl) { showToast('未找到该模板', 'error'); return; }
  var tempId = _nextTempId--;
  var newDoc = {
    id: tempId,
    stage_type: _selectedStage,
    doc_name: tpl.doc_name + '（副本）',
    sort_order: arr.length + 1,
    responsible_role: tpl.responsible_role || '',
    description: tpl.description || '',
    doc_path: tpl.doc_path || ''
  };
  arr.push(newDoc);
  _pendingOps.push({ type: 'add', tempId: tempId, stage_type: _selectedStage,
    doc_name: newDoc.doc_name, sort_order: newDoc.sort_order,
    responsible_role: newDoc.responsible_role,
    description: newDoc.description, doc_path: newDoc.doc_path });
  showToast('已复制，请修改后保存', 'info');
  renderTemplatesPage();
}

function deleteTemplate(id) {
  if (!confirm('确认删除此文档模板？')) return;
  if (id > 0) {
    _pendingOps.push({ type: 'delete', id: id });
  } else if (id < 0) {
    // Remove pending add op for locally-added template
    for (var pi = _pendingOps.length - 1; pi >= 0; pi--) {
      if (_pendingOps[pi].tempId === id) { _pendingOps.splice(pi, 1); break; }
    }
  }
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
  var html = '<div class="note-dialog-overlay">' +
    '<div class="note-dialog" style="max-width:380px">' +
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
  var html = '<div class="note-dialog-overlay">' +
    '<div class="note-dialog" style="max-width:380px">' +
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
  // Check if already exists
  if (_templatesGrouped[name]) {
    showToast('阶段类型已存在', 'error');
    return;
  }
  _pendingOps.push({ type: 'add_stage', stage_type: name });
  _templatesGrouped[name] = [];
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
    document.getElementById('dtsec-project').innerHTML = '<div class="empty-state" style="padding:40px">暂无文档模板，点击下方"保存配置"或刷新页面</div>';
    return;
  }
  renderTemplatesPage();
}

/* ── Save / Discard ── */

async function saveAllChanges() {
  if (!_pendingOps.length) { showToast('没有待保存的更改', 'error'); return; }

  // Normalize sort_order: renumber all templates sequentially per stage
  var stageTypes = Object.keys(_templatesGrouped);
  for (var si = 0; si < stageTypes.length; si++) {
    var docs = _templatesGrouped[stageTypes[si]] || [];
    docs.sort(function(a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });
    for (var di = 0; di < docs.length; di++) {
      var newSort = di + 1;
      if (docs[di].sort_order !== newSort) {
        docs[di].sort_order = newSort;
        // Add edit op if template is server-side
        if (docs[di].id > 0) {
          var found = false;
          for (var oi = 0; oi < _pendingOps.length; oi++) {
            if (_pendingOps[oi].type === 'edit' && _pendingOps[oi].id === docs[di].id) {
              _pendingOps[oi].sort_order = newSort;
              found = true;
              break;
            }
          }
          if (!found) {
            _pendingOps.push({ type: 'edit', id: docs[di].id, stage_type: stageTypes[si],
              doc_name: docs[di].doc_name, sort_order: newSort,
              responsible_role: docs[di].responsible_role || '',
              description: docs[di].description || '', doc_path: docs[di].doc_path || '' });
          }
        }
      }
    }
  }

  var ops = _pendingOps.slice(); // snapshot
  var total = ops.length;
  var success = 0, fail = 0;

  for (var i = 0; i < ops.length; i++) {
    var op = ops[i];
    try {
      if (op.type === 'add') {
        await API.post('/doc-templates', { stage_type: op.stage_type, doc_name: op.doc_name, sort_order: op.sort_order, responsible_role: op.responsible_role || '', description: op.description || '', doc_path: op.doc_path || '' });
        success++;
      } else if (op.type === 'edit') {
        await API.put('/doc-templates/' + op.id, { doc_name: op.doc_name, sort_order: op.sort_order, responsible_role: op.responsible_role || '', description: op.description || '', doc_path: op.doc_path || '' });
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
        await API.post('/doc-templates/stage-types?stage_type=' + encodeURIComponent(op.stage_type), {});
        success++;
      }
    } catch(e) {
      fail++;
      showToast('操作失败: ' + (e.message || '未知错误'), 'error');
    }
  }

  _pendingOps = [];
  // Collect affected stage types and reset their project documents
  var affectedTypes = [];
  ops.forEach(function(op) {
    var st = op.stage_type || (op.old_name || op.stage_type);
    if (st && affectedTypes.indexOf(st) < 0) affectedTypes.push(st);
  });
  if (affectedTypes.length) {
    try { await API.post('/doc-templates/reset-project-docs', { stage_types: affectedTypes }); } catch(e) {}
  }
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

async function syncAllProjects() {
  if (!confirm('将当前文档模板应用到全部项目？\n\n这会把所有项目的文档清单与模板同步：\n• 新增模板中的文档到各项目\n• 删除模板中已不存在的文档\n• 清理孤立和重复数据\n\n此操作不可撤销，确认继续？')) return;

  var btn = event.target;
  btn.disabled = true;
  btn.textContent = '⏳ 同步中...';

  try {
    var data = await API.post('/doc-templates/sync-all');
    btn.textContent = '↻ 应用到全部项目';
    btn.disabled = false;
    var msg = '同步完成：' + data.synced + '/' + data.total + ' 个项目';
    if (data.failed > 0) {
      msg += '\n失败：' + data.failed + ' 个';
      msg += '\n' + data.failed_list.join('\n');
    }
    alert(msg);
    showToast(data.failed > 0 ? 'warn' : 'ok', '同步完成', msg.replace(/\n/g, '; '));
  } catch (e) {
    btn.textContent = '↻ 应用到全部项目';
    btn.disabled = false;
    alert('同步失败: ' + e.message);
    showToast('err', '同步失败', e.message);
  }
}

/* ═══════════════════════════════════════════════════
   PRODUCT DOCUMENT TEMPLATES TAB (2-level nav)
═══════════════════════════════════════════════════ */

var _productTree = [];           // [{id, name, parent_id, level, template_count, children[...]}]
var _selectedNodeId = null;      // currently selected product node ID
var _productTemplates = [];      // doc templates for selected node (all stages)
var _productStage = '通用';       // currently selected stage filter
var _productPendingOps = [];     // pending operations queue (add/edit/delete/reorder)
var _productNextTempId = -1000;  // temp IDs for locally-added templates

var PRODUCT_STAGE_TYPES = ['硬件开发', '结构设计', 'BSP开发', '软件开发', '测试', '通用'];
var _dtBreadcrumbIds = [];       // cached breadcrumb node IDs for click nav

var TREE_ICONS = ['', '📁', '📂', '📄'];  // level 1/2/3 icons

async function initProductDocTemplates() {
  var container = document.getElementById('dtsec-product');
  container.innerHTML = '<div class="loading-spinner">加载产品文档模板...</div>';
  try {
    var tree = await API.get('/product-doc-templates/product-tree');
    _productTree = tree || [];
    // Select first L2 or L1 by default
    if (!_selectedNodeId || !_findNodeById(_selectedNodeId)) {
      var firstL2 = _findFirstL2(_productTree);
      _selectedNodeId = firstL2 || (_productTree.length ? _productTree[0].id : null);
    }
    if (_selectedNodeId) {
      await _loadTemplatesForNode(_selectedNodeId);
    }
    renderProductTreePage();
  } catch(e) {
    container.innerHTML = '<div class="error-state">加载失败: ' + escHtml(e.message) + '<br><button class="btn" onclick="initProductDocTemplates()">重试</button></div>';
  }
}

function _findNodeById(id) {
  return _findInTree(_productTree, id);
}

function _findInTree(nodes, id) {
  for (var i = 0; i < nodes.length; i++) {
    if (nodes[i].id === id) return nodes[i];
    if (nodes[i].children && nodes[i].children.length) {
      var found = _findInTree(nodes[i].children, id);
      if (found) return found;
    }
  }
  return null;
}

function _findFirstL2(nodes) {
  for (var i = 0; i < nodes.length; i++) {
    if (nodes[i].children && nodes[i].children.length) return nodes[i].children[0].id;
  }
  return null;
}

function _getNodeBreadcrumb(nodeId) {
  var node = _findNodeById(nodeId);
  if (!node) { _dtBreadcrumbIds = []; return []; }
  var path = [node.name];
  var ids = [node.id];
  var parentId = node.parent_id;
  while (parentId) {
    var p = _findNodeById(parentId);
    if (!p) break;
    path.unshift(p.name);
    ids.unshift(p.id);
    parentId = p.parent_id;
  }
  _dtBreadcrumbIds = ids;
  return path;
}

function _dtBreadcrumbNodeId(index) {
  return _dtBreadcrumbIds[index] || null;
}

async function _loadTemplatesForNode(nodeId) {
  try {
    var data = await API.get('/product-doc-templates/templates/' + nodeId);
    _productTemplates = data || [];
  } catch(e) {
    _productTemplates = [];
  }
}

function renderProductTreePage() {
  var user = getCurrentUser();
  var perms = (user && user.permissions) ? user.permissions.split(',') : [];
  var canEdit = user && (user.role === 'admin' || perms.indexOf('doc_template') >= 0);

  var selNode = _findNodeById(_selectedNodeId);
  var isL1 = selNode && selNode.level === 1;
  var isL2 = selNode && selNode.level === 2;
  var children = selNode ? (selNode.children || []) : [];

  // Left panel: 2-level nav
  var leftHtml = '<div class="section-title" style="margin-bottom:10px">产品导航</div>';
  _productTree.forEach(function(l1) {
    leftHtml += _renderL1Node(l1);
  });
  leftHtml += '<div style="font-size:10.5px;color:var(--muted);padding:8px 4px;font-style:italic;cursor:pointer" onclick="gotoView(\'product-management\')" title="跳转到产品管理页面">※ 产品维护请到「<span style="color:var(--accent);text-decoration:underline">产品管理</span>」页面</div>';

  // Breadcrumb
  var crumbs = selNode ? _getNodeBreadcrumb(_selectedNodeId) : [];
  var titleHtml = crumbs.length
    ? crumbs.map(function(c, i) {
        var nodeId = _dtBreadcrumbNodeId(i);
        if (i < crumbs.length - 1 && nodeId) {
          return '<a href="javascript:void(0)" onclick="selectProductNode(' + nodeId + ')" style="color:var(--accent);text-decoration:none" onmouseover="this.style.textDecoration=\'underline\'" onmouseout="this.style.textDecoration=\'none\'">' + escHtml(c) + '</a>';
        }
        return escHtml(c);
      }).join(' <span style="color:var(--muted);font-weight:300">›</span> ') + ' — 文档清单'
    : '选择产品 — 文档清单';

  // Right panel
  var pendingCount = _productPendingOps.length;
  var saveBtnHtml = '';
  if (canEdit && pendingCount > 0) {
    saveBtnHtml = '<button class="btn btn-primary" style="font-size:11px;padding:4px 14px;margin-left:8px" onclick="saveProductChanges()">保存配置 (' + pendingCount + ')</button>' +
      '<button class="btn" style="font-size:11px;padding:4px 10px;margin-left:4px;color:var(--warn);border-color:var(--warn)" onclick="discardProductChanges()">放弃</button>';
  } else if (canEdit && pendingCount === 0 && _productTemplates.length >= 0 && _selectedNodeId) {
    // Only show "已保存" when we have loaded a node
    saveBtnHtml = '<span style="font-size:11px;color:var(--muted);margin-left:8px">✓ 已保存</span>';
  }
  var rightHtml = '<div class="dt-right">';
  rightHtml += '<div class="dt-right-head">';
  rightHtml += '<div style="display:flex;align-items:center">';
  rightHtml += '<div class="section-title">' + titleHtml + '</div>';
  rightHtml += saveBtnHtml;
  rightHtml += '</div>';
  if (canEdit && isL2) {
    rightHtml += '<span style="display:flex;gap:4px">' +
      '<button class="btn btn-primary" style="font-size:11px;padding:4px 12px" onclick="showAddProductTemplateForm()">+ 添加文档</button>' +
      '<button class="btn" style="font-size:11px;padding:4px 12px;color:var(--accent);border-color:var(--accent)" onclick="showImportTemplatesDialog()">导入模板</button>' +
    '</span>';
  }
  rightHtml += '</div>';

  if (!selNode) {
    rightHtml += '<div class="empty-state" style="padding:20px">请从左侧选择产品节点</div>';
  } else if (isL1) {
    // L1 → show L2 list
    rightHtml += '<div class="section-hd"><div class="section-title">二级产品 · 产品系列 (' + children.length + ')</div></div>';
    if (children.length) {
      rightHtml += '<div class="table-scroll"><table class="stage-table"><thead><tr>' +
        '<th>产品系列名称</th><th style="width:80px">模板数</th>' +
        '</tr></thead><tbody>';
      children.forEach(function(l2) {
        rightHtml += '<tr style="cursor:pointer" onclick="selectProductNode(' + l2.id + ')">' +
          '<td style="font-weight:500">📂 ' + escHtml(l2.name) + '</td>' +
          '<td style="text-align:center">' + (l2.template_count || 0) + '</td>' +
        '</tr>';
      });
      rightHtml += '</tbody></table></div>';
    } else {
      rightHtml += '<div class="empty-state" style="padding:16px;font-size:13px">暂无二级产品（产品系列）</div>';
    }
    rightHtml += '<div class="empty-state" style="padding:12px;font-size:12px;color:var(--muted);font-style:italic">文档模板仅可添加到二级产品系列</div>';
  } else if (isL2) {
    // L2 → show templates with phase tabs
    _productStageDocs = _productTemplates.filter(function(d) { return (d.stage_type || '通用') === _productStage; });
    _productStageDocs.sort(function(a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });

    // Phase tab bar
    rightHtml += '<div class="tabs dt-product-tabs" style="margin-bottom:10px">';
    PRODUCT_STAGE_TYPES.forEach(function(st) {
      var count = _productTemplates.filter(function(d) { return (d.stage_type || '通用') === st; }).length;
      var active = st === _productStage ? ' active' : '';
      rightHtml += '<span class="tab' + active + '" onclick="_selectProductStage(\'' + escHtml(st) + '\')">' + escHtml(st) + (count > 0 ? ' (' + count + ')' : '') + '</span>';
    });
    rightHtml += '</div>';

    rightHtml += '<div class="section-hd"><div class="section-title">' + escHtml(_productStage) + ' — 文档清单 (' + _productStageDocs.length + ')</div></div>';
    if (_productStageDocs.length) {
      rightHtml += '<div class="table-scroll"><table class="stage-table"><thead><tr>' +
        '<th>序号</th><th>文档名称</th><th>责任人（岗位）</th><th>路径</th><th>说明</th>' +
        (canEdit ? '<th style="white-space:nowrap">操作</th>' : '') +
      '</tr></thead><tbody>';
      _productStageDocs.forEach(function(d, i) {
        rightHtml += '<tr>' +
          '<td data-drag-index="' + i + '" draggable="true"' +
          ' ondragstart="_trDragStart.call(this,event)" ondragend="_trDragEnd.call(this,event)"' +
          ' ondragover="_trDragOver.call(this,event)" ondragleave="_trDragLeave.call(this,event)"' +
          ' ondrop="_trDrop.call(this,event,_productStageDocs,renderProductAfterReorder)"' +
          ' style="font-family:var(--mono);color:var(--muted);text-align:center;cursor:grab" title="拖动排序">' + (d.sort_order != null ? d.sort_order : '—') + '</td>' +
          '<td style="font-weight:500">' + escHtml(d.doc_name) + '</td>' +
          '<td style="font-size:12px;white-space:nowrap">' + escHtml(d.responsible_role || '—') + '</td>' +
          '<td style="font-size:12px">' + (d.doc_path
            ? '<a href="' + escHtml(d.doc_path) + '" target="_blank" style="color:var(--accent);text-decoration:none" onmouseover="this.style.textDecoration=\'underline\'" onmouseout="this.style.textDecoration=\'none\'" title="点击打开路径">' + escHtml(d.doc_path) + ' ↗</a>'
            : '—') + '</td>' +
          '<td style="font-size:12px;color:var(--muted)">' + escHtml(d.description || '') + '</td>' +
          (canEdit ? '<td style="white-space:nowrap;text-align:center" ondragover="event.stopPropagation()" ondrop="event.stopPropagation()">' +
            '<button class="btn" style="font-size:12px;padding:2px 6px;margin-right:2px" onclick="copyProductTemplate(' + d.id + ')" title="复制">📋</button>' +
            '<button class="btn" style="font-size:12px;padding:2px 6px;margin-right:2px" onclick="showEditProductTemplateForm(' + d.id + ')" title="编辑">✎</button>' +
            '<button class="btn" style="font-size:12px;padding:2px 6px;color:var(--danger)" onclick="deleteProductTemplate(' + d.id + ')" title="删除">✕</button>' +
          '</td>' : '') +
        '</tr>';
      });
      rightHtml += '</tbody></table></div>';
      rightHtml += '<div style="font-size:10.5px;color:var(--muted);margin-top:4px">💡 拖动序号列可调整文档顺序</div>';
    } else {
      rightHtml += '<div class="empty-state" style="padding:20px">暂无文档模板</div>';
    }
  }
  rightHtml += '</div>';

  document.getElementById('dtsec-product').innerHTML =
    '<div class="dt-layout">' +
      '<div class="dt-left">' + leftHtml + '</div>' +
      rightHtml +
    '</div>';
}

/* ── Left Nav Rendering (2 levels only) ── */

function _renderL1Node(l1) {
  var isSelected = l1.id === _selectedNodeId;
  var hasChildren = l1.children && l1.children.length > 0;

  var html = '<div class="dt-tree-node' + (isSelected ? ' selected' : '') +
    '" style="padding-left:4px" onclick="selectProductNode(' + l1.id + ')">';
  html += '<span style="width:16px;flex-shrink:0"></span>';
  html += '<span class="dt-tree-icon">📁</span>';
  html += '<span class="dt-tree-label">' + escHtml(l1.name) + '</span>';
  if (hasChildren) {
    html += '<span class="dt-tree-badge">' + l1.children.length + '</span>';
  }
  html += '</div>';

  if (hasChildren) {
    l1.children.forEach(function(l2) {
      var l2Selected = l2.id === _selectedNodeId;
      html += '<div class="dt-tree-node' + (l2Selected ? ' selected' : '') +
        '" style="padding-left:24px" onclick="selectProductNode(' + l2.id + ')">';
      html += '<span style="width:16px;flex-shrink:0"></span>';
      html += '<span class="dt-tree-icon">📂</span>';
      html += '<span class="dt-tree-label">' + escHtml(l2.name) + '</span>';
      html += '<span class="dt-tree-badge">' + (l2.template_count || 0) + '</span>';
      html += '</div>';
    });
  }

  return html;
}

/* ── Tree Interactions ── */

async function selectProductNode(nodeId) {
  _selectedNodeId = nodeId;
  _productStage = PRODUCT_STAGE_TYPES[0];
  await _loadTemplatesForNode(nodeId);
  renderProductTreePage();
}

function _selectProductStage(stage) {
  _productStage = stage;
  renderProductTreePage();
}

/* ── Product Template CRUD (direct API, no pending queue) ── */

function showAddProductTemplateForm() {
  var selNode = _findNodeById(_selectedNodeId);
  var name = selNode ? selNode.name : '';
  var nextSort = _productStageDocs ? _productStageDocs.length + 1 : 1;
  openDialog('添加文档模板 — ' + escHtml(name),
    '<div style="margin-bottom:10px">' +
      '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">文档名称</label>' +
      '<input class="search-inp" id="ptf-name" style="width:100%;box-sizing:border-box">' +
    '</div>' +
    '<div style="display:flex;gap:10px;margin-bottom:10px">' +
      '<div style="width:80px"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">序号</label>' +
        '<input class="search-inp" id="ptf-order" type="number" min="0" value="' + nextSort + '" style="width:100%;box-sizing:border-box;padding:8px 4px;text-align:center"></div>' +
      '<div style="flex:1"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">开发阶段</label>' +
        '<select class="search-inp" id="ptf-stage" style="width:100%;box-sizing:border-box">' +
          PRODUCT_STAGE_TYPES.map(function(s) { return '<option value="' + s + '"' + (s === _productStage ? ' selected' : '') + '>' + s + '</option>'; }).join('') +
        '</select></div>' +
    '</div>' +
    '<div style="display:flex;gap:10px;margin-bottom:10px">' +
      '<div style="flex:1"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">责任人（岗位）</label>' + _roleSelect('') + '</div>' +
    '</div>' +
    '<div style="margin-bottom:10px">' +
      '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">路径 <span style="color:var(--danger)">*必填</span></label>' +
      '<input class="search-inp" id="ptf-path" placeholder="文档索引路径（如 NAS 路径）" style="width:100%;box-sizing:border-box">' +
    '</div>' +
    '<div style="margin-bottom:4px">' +
      '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">说明（可选）</label>' +
      '<input class="search-inp" id="ptf-desc" style="width:100%;box-sizing:border-box">' +
    '</div>',
    [{text: '取消', cls: '', onclick: 'closeSharedDialog()'},
     {text: '确定', cls: 'btn-primary', onclick: 'saveProductTemplate()'}], {hideClose: true});
}

function showEditProductTemplateForm(id) {
  var tpl = null;
  for (var i = 0; i < _productTemplates.length; i++) {
    if (_productTemplates[i].id === id) { tpl = _productTemplates[i]; break; }
  }
  if (!tpl) return;
  var tplStage = tpl.stage_type || '通用';
  openDialog('编辑文档模板',
    '<div style="margin-bottom:10px">' +
      '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">文档名称</label>' +
      '<input class="search-inp" id="ptf-name" value="' + escHtml(tpl.doc_name) + '" style="width:100%;box-sizing:border-box">' +
    '</div>' +
    '<div style="display:flex;gap:10px;margin-bottom:10px">' +
      '<div style="width:80px"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">序号</label>' +
        '<input class="search-inp" id="ptf-order" type="number" min="0" value="' + (tpl.sort_order || '') + '" style="width:100%;box-sizing:border-box;padding:8px 4px;text-align:center"></div>' +
      '<div style="flex:1"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">开发阶段</label>' +
        '<select class="search-inp" id="ptf-stage" style="width:100%;box-sizing:border-box">' +
          PRODUCT_STAGE_TYPES.map(function(s) { return '<option value="' + s + '"' + (s === tplStage ? ' selected' : '') + '>' + s + '</option>'; }).join('') +
        '</select></div>' +
    '</div>' +
    '<div style="display:flex;gap:10px;margin-bottom:10px">' +
      '<div style="flex:1"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">责任人（岗位）</label>' + _roleSelect(tpl.responsible_role || '') + '</div>' +
    '</div>' +
    '<div style="margin-bottom:10px">' +
      '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">路径 <span style="color:var(--danger)">*必填</span></label>' +
      '<input class="search-inp" id="ptf-path" value="' + escHtml(tpl.doc_path || '') + '" placeholder="文档索引路径" style="width:100%;box-sizing:border-box">' +
    '</div>' +
    '<div style="margin-bottom:4px">' +
      '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">说明（可选）</label>' +
      '<input class="search-inp" id="ptf-desc" value="' + escHtml(tpl.description || '') + '" style="width:100%;box-sizing:border-box">' +
    '</div>',
    [{text: '取消', cls: '', onclick: 'closeSharedDialog()'},
     {text: '确定', cls: 'btn-primary', onclick: 'saveProductTemplate(' + id + ')'}], {hideClose: true});
}

function renderProductAfterReorder() {
  // Reorder within current stage — update sort_order and push pending ops
  for (var i = 0; i < _productStageDocs.length; i++) {
    var t = _productStageDocs[i];
    t.sort_order = i + 1;
    if (t.id > 0) {
      _productPendingOps.push({ type: 'edit', id: t.id,
        doc_name: t.doc_name, sort_order: t.sort_order,
        stage_type: t.stage_type || '通用',
        responsible_role: t.responsible_role || '', description: t.description || '',
        doc_path: t.doc_path || '' });
    }
  }
  renderProductTreePage();
}

function saveProductTemplate(id) {
  var nameEl = document.getElementById('ptf-name');
  var orderEl = document.getElementById('ptf-order');
  var descEl = document.getElementById('ptf-desc');
  var roleEl = document.getElementById('dt-role');
  var pathEl = document.getElementById('ptf-path');
  var stageEl = document.getElementById('ptf-stage');

  if (!nameEl || !orderEl || !descEl || !pathEl) { showToast('表单数据异常，请重新打开对话框', 'error'); return; }

  var order = parseInt(orderEl.value) || 0;
  var desc = descEl.value.trim();
  var role = roleEl ? roleEl.value : '';
  var path = pathEl.value.trim();
  var stage = stageEl ? stageEl.value : (_productStage || '通用');
  if (!nameEl.value.trim()) { showToast('请输入文档名称', 'error'); return; }
  if (!path) { showToast('请输入路径', 'error'); return; }
  var name = nameEl.value.trim();

  var overlay = document.querySelector('.shared-dialog-overlay');
  if (overlay) overlay.remove();

  if (id && id > 0) {
    // Edit existing template
    var tpl = _productTemplates.find(function(x) { return x.id === id; });
    if (!tpl) { showToast('未找到该模板', 'error'); return; }
    tpl.doc_name = name;
    tpl.sort_order = order;
    tpl.stage_type = stage;
    tpl.description = desc;
    tpl.responsible_role = role;
    tpl.doc_path = path;
    _productPendingOps.push({ type: 'edit', id: id,
      doc_name: name, sort_order: order, stage_type: stage, responsible_role: role,
      description: desc, doc_path: path });
  } else if (id && id < 0) {
    // Edit locally-added template
    var tpl2 = _productTemplates.find(function(x) { return x.id === id; });
    if (tpl2) {
      tpl2.doc_name = name;
      tpl2.sort_order = order;
      tpl2.stage_type = stage;
      tpl2.description = desc;
      tpl2.responsible_role = role;
      tpl2.doc_path = path;
    }
    // Update the pending add op
    for (var pi = 0; pi < _productPendingOps.length; pi++) {
      if (_productPendingOps[pi].tempId === id) {
        _productPendingOps[pi].doc_name = name;
        _productPendingOps[pi].sort_order = order;
        _productPendingOps[pi].stage_type = stage;
        _productPendingOps[pi].responsible_role = role;
        _productPendingOps[pi].description = desc;
        _productPendingOps[pi].doc_path = path;
        break;
      }
    }
  } else {
    // New template — add locally with temp ID
    var tempId = _productNextTempId--;
    var newDoc = { id: tempId, doc_name: name, sort_order: order,
      stage_type: stage, responsible_role: role, description: desc, doc_path: path };
    _productTemplates.push(newDoc);
    _productPendingOps.push({ type: 'add', tempId: tempId,
      doc_name: name, sort_order: order, stage_type: stage, responsible_role: role,
      description: desc, doc_path: path });
  }
  renderProductTreePage();
}

function copyProductTemplate(id) {
  var tpl = _productTemplates.find(function(x) { return x.id === id; });
  if (!tpl) { showToast('未找到该模板', 'error'); return; }
  var nextSort = _productStageDocs ? _productStageDocs.length + 1 : 1;
  var tempId = _productNextTempId--;
  var newDoc = {
    id: tempId,
    doc_name: tpl.doc_name + '（副本）',
    sort_order: nextSort,
    stage_type: tpl.stage_type || '通用',
    responsible_role: tpl.responsible_role || '',
    description: tpl.description || '',
    doc_path: tpl.doc_path || ''
  };
  _productTemplates.push(newDoc);
  _productPendingOps.push({ type: 'add', tempId: tempId,
    doc_name: newDoc.doc_name, sort_order: newDoc.sort_order,
    stage_type: newDoc.stage_type,
    responsible_role: newDoc.responsible_role,
    description: newDoc.description, doc_path: newDoc.doc_path });
  showToast('已复制，请修改后保存', 'info');
  renderProductTreePage();
}

function deleteProductTemplate(id) {
  if (!confirm('确认删除此文档模板？')) return;
  if (id > 0) {
    _productPendingOps.push({ type: 'delete', id: id });
  } else {
    // Remove from pending add ops
    _productPendingOps = _productPendingOps.filter(function(op) { return op.tempId !== id; });
  }
  // Remove locally
  _productTemplates = _productTemplates.filter(function(t) { return t.id !== id; });
  renderProductTreePage();
}

/* ── Product Template Save / Discard ── */

async function saveProductChanges() {
  if (!_productPendingOps.length) { showToast('没有待保存的更改', 'error'); return; }

  // Normalize sort_order: renumber all templates sequentially per stage
  PRODUCT_STAGE_TYPES.forEach(function(st) {
    var docs = _productTemplates.filter(function(d) { return (d.stage_type || '通用') === st; });
    docs.sort(function(a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });
    for (var di = 0; di < docs.length; di++) {
      var newSort = di + 1;
      if (docs[di].sort_order !== newSort) {
        docs[di].sort_order = newSort;
        if (docs[di].id > 0) {
          var found = false;
          for (var oi = 0; oi < _productPendingOps.length; oi++) {
            if (_productPendingOps[oi].type === 'edit' && _productPendingOps[oi].id === docs[di].id) {
              _productPendingOps[oi].sort_order = newSort;
              found = true;
              break;
            }
          }
          if (!found) {
            _productPendingOps.push({ type: 'edit', id: docs[di].id,
              doc_name: docs[di].doc_name, sort_order: newSort,
              stage_type: docs[di].stage_type || '通用',
              responsible_role: docs[di].responsible_role || '',
              description: docs[di].description || '', doc_path: docs[di].doc_path || '' });
          }
        }
      }
    }
  });

  var ops = _productPendingOps.slice();
  var success = 0, fail = 0;

  for (var i = 0; i < ops.length; i++) {
    var op = ops[i];
    try {
      if (op.type === 'add') {
        await API.post('/product-doc-templates', { product_id: _selectedNodeId, doc_name: op.doc_name, sort_order: op.sort_order, stage_type: op.stage_type || '通用', responsible_role: op.responsible_role || '', description: op.description || '', doc_path: op.doc_path || '' });
        success++;
      } else if (op.type === 'edit') {
        await API.put('/product-doc-templates/' + op.id, { doc_name: op.doc_name, sort_order: op.sort_order, stage_type: op.stage_type || '通用', responsible_role: op.responsible_role || '', description: op.description || '', doc_path: op.doc_path || '' });
        success++;
      } else if (op.type === 'delete') {
        await API.del('/product-doc-templates/' + op.id);
        success++;
      } else if (op.type === 'import') {
        await API.post('/product-doc-templates/import/' + _selectedNodeId, { source_node_id: op.source_node_id });
        success++;
      }
    } catch(e) {
      fail++;
      showToast('操作失败: ' + (e.message || '未知错误'), 'error');
    }
  }

  _productPendingOps = [];
  // Refresh from server
  try {
    _productTree = (await API.get('/product-doc-templates/product-tree')) || [];
  } catch(e) {}
  if (_selectedNodeId) await _loadTemplatesForNode(_selectedNodeId);
  showToast('保存完成: ' + success + ' 成功' + (fail > 0 ? ', ' + fail + ' 失败' : ''), success === ops.length ? 'success' : 'error');
  renderProductTreePage();
}

async function discardProductChanges() {
  if (!confirm('放弃所有未保存的更改？此操作不可撤销。')) return;
  _productPendingOps = [];
  // Re-fetch from server
  try {
    _productTree = (await API.get('/product-doc-templates/product-tree')) || [];
    if (_selectedNodeId) await _loadTemplatesForNode(_selectedNodeId);
  } catch(e) {}
  renderProductTreePage();
}

// ── Import Templates from Another Node ──

function showImportTemplatesDialog() {
  if (!_selectedNodeId) { showToast('请先选择目标产品节点', 'error'); return; }

  var selNode = _findNodeById(_selectedNodeId);
  var currentName = selNode ? selNode.name : '';

  // Collect all L2 nodes except current, with template counts
  var l2Nodes = [];
  function collectL2(nodes) {
    nodes.forEach(function(n) {
      if (n.level === 2 && n.id !== _selectedNodeId) {
        l2Nodes.push({id: n.id, name: n.name, template_count: n.template_count || 0});
      }
      if (n.children && n.children.length) collectL2(n.children);
    });
  }
  collectL2(_productTree);

  if (!l2Nodes.length) {
    showToast('没有其他产品系列可导入模板', 'info');
    return;
  }

  var listHtml = l2Nodes.map(function(n) {
    return '<div style="padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border)" onclick="selectImportSource(' + n.id + ', \'' + escHtml(n.name).replace(/'/g, "\\'") + '\', this)">' +
      '<span style="font-weight:500">' + escHtml(n.name) + '</span>' +
      '<span style="font-size:11px;color:var(--muted);margin-left:8px">（' + n.template_count + ' 个模板）</span>' +
    '</div>';
  }).join('');

  var html =
    '<div style="margin-bottom:12px">' +
      '<div style="font-size:11px;color:var(--muted);margin-bottom:6px">目标节点：<span style="color:var(--accent);font-weight:500">' + escHtml(currentName) + '</span></div>' +
      '<div style="font-size:11px;color:var(--muted);margin-bottom:8px">选择源节点，将其文档模板覆盖到当前节点。目标节点现有模板将被全部清除后替换。</div>' +
      '<div style="max-height:280px;overflow-y:auto;border:1px solid var(--border);border-radius:6px" id="import-src-list">' + listHtml + '</div>' +
      '<div id="import-src-selected" style="margin-top:8px;font-size:11px;color:var(--accent)"></div>' +
    '</div>';

  openDialog('导入文档模板 — ' + escHtml(currentName), html,
    [
      {text: '取消', onclick: 'closeSharedDialog()'},
      {text: '导入', cls: 'btn-primary', onclick: 'executeImportTemplates()', id: 'import-templates-btn'},
    ],
    {hideClose: true}
  );

  window._importSourceId = null;
  var btn = document.getElementById('import-templates-btn');
  if (btn) btn.disabled = true;
}

function selectImportSource(nodeId, name, el) {
  window._importSourceId = nodeId;
  document.querySelectorAll('#import-src-list > div').forEach(function(d) {
    d.style.background = '';
    d.style.borderLeft = '';
  });
  el.style.background = 'var(--accent-lt)';
  el.style.borderLeft = '3px solid var(--accent)';
  document.getElementById('import-src-selected').textContent = '已选择: ' + name;
  var btn = document.getElementById('import-templates-btn');
  if (btn) btn.disabled = false;
}

function closeSharedDialog() {
  var overlay = document.querySelector('.shared-dialog-overlay');
  if (overlay) overlay.remove();
}

function executeImportTemplates() {
  if (!window._importSourceId || !_selectedNodeId) return;
  closeSharedDialog();

  var sourceId = window._importSourceId;
  window._importSourceId = null;

  // Push as pending operation: "import" type
  _productPendingOps.push({ type: 'import', source_node_id: sourceId });
  showToast('导入模板已加入待保存队列，点击保存配置生效', 'info');
  renderProductTreePage();
}


/* ═══════════════════════════════════════════════════
   TAGS TEMPLATE TAB
═══════════════════════════════════════════════════ */

var _tags = [];

async function initTags() {
  var container = document.getElementById('dtsec-tags');
  container.innerHTML = '<div class="loading-spinner">加载标签...</div>';
  try {
    var data = await API.get('/tags');
    _tags = data || [];
    renderTagsPage();
  } catch(e) {
    container.innerHTML = '<div class="error-state">加载失败: ' + escHtml(e.message) + '<br><button class="btn" onclick="initTags()">重试</button></div>';
  }
}

function renderTagsPage() {
  var user = getCurrentUser();
  var perms = (user && user.permissions) ? user.permissions.split(',') : [];
  var canEdit = user && (user.role === 'admin' || perms.indexOf('doc_template') >= 0);

  var projectTags = _tags.filter(function(t) { return t.category === 'project'; });
  var productTags = _tags.filter(function(t) { return t.category === 'product'; });
  var generalTags = _tags.filter(function(t) { return !t.category || t.category === ''; });

  var sections = [
    { title: '项目标签', color: 'var(--accent)', bg: 'var(--accent-lt)', tags: projectTags },
    { title: '产品标签', color: 'var(--success)', bg: 'var(--success-lt)', tags: productTags },
    { title: '通用标签', color: 'var(--muted)', bg: 'var(--bg)', tags: generalTags },
  ];

  var html = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">' +
    '<div class="section-title">标签管理 <span style="font-size:11px;color:var(--muted);font-weight:400">（' + _tags.length + '）</span></div>' +
    (canEdit ? '<button class="btn btn-primary" style="font-size:11px;padding:4px 12px" onclick="showAddTagDialog()">+ 添加标签</button>' : '') +
  '</div>';

  sections.forEach(function(sec) {
    html += '<div class="card" style="margin-bottom:12px;padding:14px 16px">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:' + (sec.tags.length ? '10px' : '4px') + '">' +
        '<span style="width:8px;height:8px;border-radius:50%;background:' + sec.color + '"></span>' +
        '<span style="font-weight:540;font-size:13px">' + sec.title + '</span>' +
        '<span style="font-size:11px;color:var(--muted)">' + sec.tags.length + '</span>' +
      '</div>';
    if (sec.tags.length) {
      html += '<div style="display:flex;flex-wrap:wrap;gap:6px">';
      sec.tags.forEach(function(t) {
        html += '<span class="tag-badge tag-' + (t.name.length % 5) + '" style="font-size:12px;padding:3px 12px;cursor:' + (canEdit ? 'pointer' : 'default') + '"' +
          (canEdit ? ' onclick="showEditTagDialog(' + t.id + ')" title="点击编辑"' : '') + '>#' + escHtml(t.name) +
          (canEdit ? '<span onclick="event.stopPropagation();deleteTag(' + t.id + ')" style="margin-left:4px;opacity:0.5;font-size:14px;line-height:1" title="删除">&times;</span>' : '') +
        '</span>';
      });
      html += '</div>';
    } else {
      html += '<div style="font-size:11px;color:var(--muted);font-style:italic">暂无</div>';
    }
    html += '</div>';
  });

  document.getElementById('dtsec-tags').innerHTML = html;
}

function showAddTagDialog() {
  openDialog('添加标签',
    '<div style="margin-bottom:12px">' +
      '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">标签名</label>' +
      '<input class="search-inp" id="tf-name" placeholder="如：全国产、双V7、PCIe卡" style="width:100%;box-sizing:border-box">' +
    '</div>' +
    '<div style="margin-bottom:8px">' +
      '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">分类</label>' +
      '<select id="tf-cat" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--fg);font-size:13px">' +
        '<option value="">通用（项目+产品）</option>' +
        '<option value="project">项目</option>' +
        '<option value="product">产品</option>' +
      '</select>' +
    '</div>',
    [{text: '取消', cls: '', onclick: 'closeSharedDialog()'},
     {text: '确定', cls: 'btn-primary', onclick: 'saveTag()'}], {hideClose: true});
}

function showEditTagDialog(id) {
  var tag = null;
  for (var i = 0; i < _tags.length; i++) { if (_tags[i].id === id) { tag = _tags[i]; break; } }
  if (!tag) return;
  openDialog('编辑标签',
    '<div style="margin-bottom:12px">' +
      '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">标签名</label>' +
      '<input class="search-inp" id="tf-name" value="' + escHtml(tag.name) + '" style="width:100%;box-sizing:border-box">' +
    '</div>' +
    '<div style="margin-bottom:8px">' +
      '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">分类</label>' +
      '<select id="tf-cat" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--fg);font-size:13px">' +
        '<option value=""' + (!tag.category ? ' selected' : '') + '>通用（项目+产品）</option>' +
        '<option value="project"' + (tag.category === 'project' ? ' selected' : '') + '>项目</option>' +
        '<option value="product"' + (tag.category === 'product' ? ' selected' : '') + '>产品</option>' +
      '</select>' +
    '</div>',
    [{text: '取消', cls: '', onclick: 'closeSharedDialog()'},
     {text: '确定', cls: 'btn-primary', onclick: 'saveTag(' + id + ')'}],
    {hideClose: true, overlayClass: 'shared-dialog-overlay'});
}

async function saveTag(id) {
  var nameEl = document.getElementById('tf-name');
  var catEl = document.getElementById('tf-cat');
  if (!nameEl) return;
  var name = nameEl.value.trim();
  var cat = catEl ? catEl.value : '';
  if (!name) { showToast('请输入标签名', 'error'); return; }

  closeSharedDialog();
  try {
    if (id) {
      var updated = await API.put('/tags/' + id, {name: name, category: cat || null});
      for (var i = 0; i < _tags.length; i++) { if (_tags[i].id === id) { _tags[i] = updated; break; } }
    } else {
      var created = await API.post('/tags', {name: name, category: cat || null});
      _tags.push(created);
    }
    renderTagsPage();
    showToast(id ? '标签已更新' : '标签已创建', 'ok');
  } catch(e) {
    showToast('保存失败: ' + e.message, 'error');
  }
}

async function deleteTag(id) {
  var tag = null;
  for (var i = 0; i < _tags.length; i++) { if (_tags[i].id === id) { tag = _tags[i]; break; } }
  if (!confirm('确认删除标签 #' + (tag ? tag.name : id) + '？')) return;
  try {
    await API.del('/tags/' + id);
    _tags = _tags.filter(function(t) { return t.id !== id; });
    renderTagsPage();
    showToast('标签已删除', 'ok');
  } catch(e) {
    showToast('删除失败: ' + e.message, 'error');
  }
}
