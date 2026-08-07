/* ═══════════════════════════════════════════════════
   DOCUMENT / TASK TEMPLATE CONFIGURATION PAGE
═══════════════════════════════════════════════════ */

var _templatesGrouped = {};  // { stage_type: [template, ...] }
var _taskTemplatesGrouped = {};  // { stage_type: [task_template, ...] }
var _selectedStage = null;   // currently selected stage_type
var _pendingOps = [];        // queued changes: {type, data...}
var _taskPendingOps = [];    // queued task template changes
var _nextTempId = -1;        // negative IDs for unsaved templates
var _originalGrouped = null; // snapshot before edits, for "discard"
var _currentProjectType = 'RD'; // selected project type tab
var _projectTypes = [];      // [{id, label, stages, builtin}]

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

// Role options for responsible_role dropdown — loaded dynamically from server.
// Falls back to built-in defaults (matching backend ROLE_LABELS) before the first API response.
var _DEFAULT_ROLE_LABELS = {
  'public': '普通用户', 'admin': '管理员', 'ceo': 'CEO', 'cto': 'CTO', 'pm': '项目经理',
  'sales': '销售及售前', 'hw_dev': '硬件开发', 'structure': '结构设计及装配',
  'hw_test': '硬件测试', 'bsp_dev': 'BSP开发', 'sw_dev': '业务软件开发',
  'test_delivery': '测试交付', 'procurement': '采购', 'quality': '质检',
  'warehouse': '库房管理', 'viewer': '只读用户',
};

function _getRoleLabels() {
  return window._roleLabels || _DEFAULT_ROLE_LABELS;
}

function _getRoleLeaders() {
  return window._roleLeaders || {};
}

function _checkRoleLeader(roleLabel) {
  if (!roleLabel) return { hasLeader: false, leaderName: '' };
  var leaders = _getRoleLeaders();
  var info = leaders[roleLabel];
  if (info && info.leader_id && info.leader_name) {
    return { hasLeader: true, leaderName: info.leader_name };
  }
  return { hasLeader: false, leaderName: '' };
}

function _roleSelect(selected) {
  var labels = _getRoleLabels();
  var leaders = _getRoleLeaders();
  // Use label text as both option value and display for backward compatibility
  // (responsible_role column stores labels, not keys).
  var options = [];
  var seen = {};
  Object.keys(labels).forEach(function(k) {
    var v = labels[k];
    if (!seen[v]) { seen[v] = true; options.push(v); }
  });
  options.sort();
  var html = '<select class="search-inp" id="dt-role" style="margin-top:4px;padding:7px 8px" onchange="_onRoleSelectChange()">' +
    '<option value="">— 请选择 —</option>' +
    options.map(function(r) {
      return '<option value="' + r + '"' + (r === selected ? ' selected' : '') + '>' + r + '</option>';
    }).join('') +
  '</select>' +
  '<div id="dt-role-leader-warn" style="display:none;margin-top:4px;font-size:11px;color:var(--warning-dark, #b06d00);background:var(--warning-lt, #fff8e1);padding:4px 8px;border-radius:4px">' +
    '⚠ 该角色未设置Leader，将使用角色组第一个成员作为默认责任人。' +
    '<a href="javascript:void(0)" onclick="closeSharedDialog();gotoView(\'users\');setTimeout(function(){switchUserTab(\'roles\')},100)" style="margin-left:4px;color:var(--accent);text-decoration:underline">去设置</a>' +
  '</div>' +
  '<div id="dt-role-leader-info" style="display:none;margin-top:4px;font-size:11px;color:var(--success);padding:2px 0">' +
    'Leader: <span id="dt-role-leader-name"></span>' +
  '</div>';
  // Trigger initial check if editing with pre-selected role
  setTimeout(function() { _onRoleSelectChange(); }, 50);
  return html;
}

function _onRoleSelectChange() {
  var sel = document.getElementById('dt-role');
  var warnEl = document.getElementById('dt-role-leader-warn');
  var infoEl = document.getElementById('dt-role-leader-info');
  var nameEl = document.getElementById('dt-role-leader-name');
  if (!sel || !warnEl || !infoEl) return;
  var val = sel.value;
  if (!val) {
    warnEl.style.display = 'none';
    infoEl.style.display = 'none';
    return;
  }
  var leader = _checkRoleLeader(val);
  if (leader.hasLeader) {
    warnEl.style.display = 'none';
    infoEl.style.display = '';
    if (nameEl) nameEl.textContent = leader.leaderName;
  } else {
    warnEl.style.display = '';
    infoEl.style.display = 'none';
  }
}

function switchDocTemplateTab(tab, el) {
  _currentTab = tab;
  document.querySelectorAll('#view-doc-templates .map-tab').forEach(function(t) { t.classList.remove('active'); });
  if (!el) el = document.getElementById('dttab-' + tab);
  if (el) el.classList.add('active');
  document.getElementById('dtsec-project').style.display = tab === 'project' ? '' : 'none';
  document.getElementById('dtsec-product').style.display = tab === 'product' ? '' : 'none';
  document.getElementById('dtsec-tags').style.display = tab === 'tags' ? '' : 'none';
  document.getElementById('dtsec-naming').style.display = tab === 'naming' ? '' : 'none';
  document.getElementById('dtsec-bugtpl').style.display = tab === 'bugtpl' ? '' : 'none';
  if (tab === 'project') initDocTemplates();
  else if (tab === 'product') initProductDocTemplates();
  else if (tab === 'tags') initTags();
  else if (tab === 'naming') initNamingOptions();
  else if (tab === 'bugtpl') initBugTemplates();
  _updateDocTemplatesHash();
}
function _openDocDialog(title, bodyHtml, buttons, opts, defaultDocType) {
  openDialog(title, bodyHtml, buttons, opts);
  if (defaultDocType) {
    var dialog = document.querySelector('.shared-dialog-overlay .note-dialog');
    if (dialog) _applyDocTypePlaceholder(dialog, defaultDocType);
  }
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

function _trDropStage(e) {
  e.preventDefault();
  e.stopPropagation();
  this.classList.remove('dt-drag-over');
  var targetIndex = parseInt(this.getAttribute('data-drag-index'));
  if (_dragSourceIndex < 0 || _dragSourceIndex === targetIndex) return;

  // Reorder stage types in _templatesGrouped
  var stageKeys = Object.keys(_templatesGrouped);
  var moved = stageKeys.splice(_dragSourceIndex, 1)[0];
  stageKeys.splice(targetIndex, 0, moved);

  // Rebuild _templatesGrouped with new key order
  var newGrouped = {};
  stageKeys.forEach(function(k) {
    newGrouped[k] = _templatesGrouped[k] || [];
  });
  _templatesGrouped = newGrouped;

  // Track reorder in pending ops — save ALL stages for this project_type
  _pendingOps.push({ type: 'reorder_stages', stages: stageKeys.slice() });

  _dragSourceIndex = -1;
  renderTemplatesPage();
}

// ── Doc-templates hash helper ──

function _updateDocTemplatesHash() {
  if (typeof buildHash !== 'function') return;
  var params = [];
  if (_currentTab === 'project') {
    params = ['project', _currentProjectType];
    if (_selectedStage) params.push(_selectedStage);
  } else if (_currentTab === 'product') {
    params = ['product'];
    if (_selectedNodeId) params.push(String(_selectedNodeId));
    if (_productStage) params.push(_productStage);
  } else {
    params = [_currentTab];
  }
  // Encode non-ASCII params so decodeURIComponent in initDocTemplates works reliably
  var encodedParams = params.map(function(p) { return encodeURIComponent(p); });
  history.pushState({ view: 'doc-templates', params: params }, '', buildHash('doc-templates', encodedParams[0], encodedParams[1], encodedParams[2]));
}

// Safe decodeURIComponent — falls back to raw string when already decoded (browser-dependent)
function _safeDecode(s) {
  if (!s) return s;
  // Only attempt decode if the string contains percent-encoded sequences
  if (s.indexOf('%') < 0) return s;
  try { return decodeURIComponent(s); } catch(e) { return s; }
}

async function initDocTemplates(tab, sub1, sub2) {
  // Parse params: tab, sub1 (projectType | nodeId), sub2 (stage)
  if (tab && tab !== 'project') {
    _currentTab = tab;
    if (tab === 'product') {
      if (sub1) _selectedNodeId = parseInt(sub1);
      if (sub2) _productStage = _safeDecode(sub2);
    }
    // Activate the right tab in the top-level tab bar
    setTimeout(function() {
      var tabEl = document.getElementById('dttab-' + _currentTab);
      if (tabEl) switchDocTemplateTab(_currentTab, tabEl);
    }, 50);
  } else if (tab === 'project') {
    _currentTab = 'project';
    if (sub1) _currentProjectType = _safeDecode(sub1);
    if (sub2) _selectedStage = _safeDecode(sub2);
  }

  var container = document.getElementById('dtsec-project');
  container.innerHTML = '<div class="loading-spinner">加载模板配置...</div>';
  try {
    // Load project types first
    var ptypes = await API.get('/doc-templates/project-types');
    _projectTypes = ptypes || [];
    if (!_projectTypes.length) {
      _projectTypes = [{id: 'RD', label: '研发项目', stages: [], builtin: true}];
    }
    // Load stage unnecessary flags
    try {
      var unnecRes = await API.get('/doc-templates/stage-unnecessary?project_type=' + encodeURIComponent(_currentProjectType));
      _stageUnnecDocs = unnecRes.docs || [];
      _stageUnnecTasks = unnecRes.tasks || [];
    } catch(e) { _stageUnnecDocs = []; _stageUnnecTasks = []; }

    // Load templates for current project type
    var _savedStage = _selectedStage;
    await loadTemplatesForType(_currentProjectType);
    if (_savedStage) _selectedStage = _savedStage;
    renderTemplatesPage();
  } catch(e) {
    container.innerHTML = '<div class="error-state">加载失败: ' + escHtml(e.message) + '<br><button class="btn" onclick="initDocTemplates()">重试</button></div>';
  }
}

async function loadTemplatesForType(ptype) {
  _currentProjectType = ptype;
  _selectedStage = null;
  try {
    var data = await API.get('/doc-templates?project_type=' + encodeURIComponent(ptype));
    _templatesGrouped = data || {};
  } catch(e) {
    _templatesGrouped = {};
  }
  // Also load task templates
  try {
    var tdata = await API.get('/task-templates?project_type=' + encodeURIComponent(ptype));
    _taskTemplatesGrouped = tdata || {};
  } catch(e) {
    _taskTemplatesGrouped = {};
  }
}

function selectProjectTypeTab(ptype) {
  if (ptype === _currentProjectType) return;
  var container = document.getElementById('dtsec-project');
  container.innerHTML = '<div class="loading-spinner">加载模板配置...</div>';
  loadTemplatesForType(ptype).then(function() {
    var types = _sortStageTypes(Object.keys(_templatesGrouped));
    if (types.length && !_selectedStage) _selectedStage = types[0];
    renderTemplatesPage();
    _updateDocTemplatesHash();
  });
}

function showAddProjectTypeDialog() {
  var html = '<div style="margin-bottom:12px">' +
    '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">项目类型 ID（英文标识）</label>' +
    '<input class="search-inp" id="ptype-id" placeholder="如：SW" style="width:100%;box-sizing:border-box">' +
    '</div>' +
    '<div style="margin-bottom:12px">' +
    '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">显示名称</label>' +
    '<input class="search-inp" id="ptype-label" placeholder="如：软件迭代项目" style="width:100%;box-sizing:border-box">' +
    '</div>' +
    '<div style="margin-bottom:12px">' +
    '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">项目编号前缀 <span style="font-weight:400">（如 PE、SW、PT、LSJ）</span></label>' +
    '<input class="search-inp" id="ptype-prefix" placeholder="如：SW" style="width:100%;box-sizing:border-box">' +
    '</div>';
  openDialog('新增项目类型', html, [
    { text: '取消', onclick: "document.querySelector('.note-dialog-overlay').remove()" },
    { text: '创建', cls: 'btn-primary', onclick: 'createProjectType()' }
  ]);
}

async function createProjectType() {
  var id = document.getElementById('ptype-id').value.trim();
  var label = document.getElementById('ptype-label').value.trim();
  var prefix = document.getElementById('ptype-prefix').value.trim();
  if (!id) { showToast('请输入项目类型 ID', 'error'); return; }
  if (!label) { showToast('请输入显示名称', 'error'); return; }
  try {
    await API.post('/doc-templates/project-types?project_type=' + encodeURIComponent(id) + '&label=' + encodeURIComponent(label) + '&code_prefix=' + encodeURIComponent(prefix || 'PE'));
    document.querySelector('.note-dialog-overlay').remove();
    showToast('项目类型已创建: ' + label, 'success');
    initDocTemplates();
  } catch(e) {
    showToast('创建失败: ' + (e.message || ''), 'error');
  }
}

function renderTemplatesPage() {
  var user = getCurrentUser();
  var perms = (user && user.permissions) ? user.permissions.split(',') : [];
  var canEdit = user && (user.role === 'admin' || perms.indexOf('doc_template') >= 0);

  var stageTypes = Object.keys(_templatesGrouped);

  // Project type tabs bar (with edit/delete icons)
  var ptypeTabs = '<div class="map-tabs" style="margin-bottom:12px">';
  _projectTypes.forEach(function(pt) {
    var isActive = pt.id === _currentProjectType;
    var labelEsc = escHtml(pt.label).replace(/'/g, "\\'");
    var prefix = pt.code_prefix || '';
    ptypeTabs += '<div class="map-tab' + (isActive ? ' active' : '') + '" onclick="selectProjectTypeTab(\'' + escHtml(pt.id) + '\')">' +
      '<span class="ptype-label">' + escHtml(pt.label) + '</span>' +
      (prefix ? ' <code style="font-size:9px;opacity:0.8;background:var(--accent-lt);padding:1px 4px;border-radius:3px">' + prefix + '</code>' : '') +
      (pt.builtin ? '' : ' <span style="font-size:9px;opacity:0.7">自定义</span>') +
      (canEdit ? '<span style="margin-left:4px;opacity:0.4;cursor:pointer;font-size:11px" onclick="event.stopPropagation();showRenameProjectTypeDialog(\'' + escHtml(pt.id) + '\',\'' + labelEsc + '\')" title="重命名">✎</span>' : '') +
      (canEdit && !pt.builtin ? '<span style="margin-left:2px;opacity:0.4;cursor:pointer;color:var(--danger);font-size:12px" onclick="event.stopPropagation();deleteProjectType(\'' + escHtml(pt.id) + '\',\'' + labelEsc + '\')" title="删除项目类型">✕</span>' : '') +
      '</div>';
  });
  if (canEdit) {
    ptypeTabs += '<div class="map-tab" onclick="showAddProjectTypeDialog()" style="color:var(--accent);font-weight:600" title="新增项目类型">+</div>';
  }
  ptypeTabs += '</div>';

  if (!stageTypes.length) {
    var emptyHtml = ptypeTabs +
      '<div class="empty-state" style="padding:40px">暂无阶段类型<br><span style="font-size:11px;color:var(--muted)">请先添加阶段类型，再配置文档和任务模板</span></div>';
    if (canEdit) {
      emptyHtml += '<div style="text-align:center;margin-top:12px">' +
        '<button class="btn btn-primary" style="font-size:11px;padding:3px 10px" onclick="showAddStageDialog()">+ 新增阶段类型</button>' +
        '</div>';
    }
    document.getElementById('dtsec-project').innerHTML = emptyHtml;
    return;
  }

  // Ensure selected stage is valid
  if (!_selectedStage || stageTypes.indexOf(_selectedStage) < 0) {
    _selectedStage = stageTypes[0];
  }

  // Left panel: stage type list with drag-drop + edit/delete, showing combined count
  var leftHtml = stageTypes.map(function(st, i) {
    var docCount = (_templatesGrouped[st] || []).length;
    var taskCount = (_taskTemplatesGrouped[st] || []).length;
    var totalCount = docCount + taskCount;
    var sel = st === _selectedStage ? ' selected' : '';
    return '<div class="dt-stage-item' + sel + '" data-drag-index="' + i + '" draggable="true"' +
      ' onclick="selectDocTemplateStage(\'' + escHtml(st) + '\')"' +
      ' ondragstart="_trDragStart.call(this,event)" ondragend="_trDragEnd.call(this,event)"' +
      ' ondragover="_trDragOver.call(this,event)" ondragleave="_trDragLeave.call(this,event)"' +
      ' ondrop="_trDropStage.call(this,event)"' +
      ' style="cursor:' + (sel ? 'default' : 'grab') + '">' +
      '<span style="flex:1">' + escHtml(st) + '</span>' +
      '<span class="dt-stage-count">' + totalCount + '</span>' +
      (canEdit ? '<span class="dt-stage-acts">' +
        iconEdit('event.stopPropagation();showRenameStageDialog(\'' + escHtml(st) + '\')', '重命名') +
        iconDelete('event.stopPropagation();deleteStageType(\'' + escHtml(st) + '\')', '删除') +
      '</span>' : '') +
    '</div>';
  }).join('') +
  (canEdit ? '<div class="dt-stage-item" style="justify-content:center;color:var(--accent);font-size:12px;cursor:pointer;border:1px dashed var(--border)" onclick="showAddStageDialog()">+ 新增阶段类型</div>' : '');

  // Right panel with TWO sections: doc templates + task templates
  var rightHtml = '<div class="dt-right">' +
    _renderDocTemplateSection(_selectedStage, canEdit) +
    _renderTaskTemplateSection(_selectedStage, canEdit) +
    '</div>';

  document.getElementById('dtsec-project').innerHTML =
    ptypeTabs +
    '<div class="dt-layout">' +
      '<div class="dt-left">' +
        '<div class="section-title" style="margin-bottom:10px">阶段类型</div>' +
        leftHtml +
      '</div>' +
      rightHtml +
    '</div>';

  // Build DataTables for doc and task template sections
  var docs = _templatesGrouped[_selectedStage] || [];
  var tasks = _taskTemplatesGrouped[_selectedStage] || [];
  var stageKey = escHtml(_selectedStage).replace(/[^a-zA-Z0-9]/g,'_');
  var typeLabels = DOC_TYPE_LABELS;

  if (docs.length) {
    var dtDocs = new DataTable({
      container: document.getElementById('tpl-docs-' + stageKey),
      columns: (function() {
        var cols = [
          { key: 'sort_order', title: '序号', width: '50px', render: function(v, row, idx) { return '<span data-drag-index="'+idx+'" style="font-family:var(--mono);color:var(--muted);cursor:grab" title="拖动排序">'+(v!=null?v:'—')+'</span>'; } },
          { key: 'doc_name', title: '文档名称', render: function(v) { return '<span style="font-weight:500">'+escHtml(v||'')+'</span>'; } },
          { key: 'responsible_role', title: '责任人', width: '80px', render: function(v) { return '<span style="font-size:12px;white-space:nowrap">'+escHtml(v||'—')+'</span>'; } },
          { key: 'doc_type', title: '类型', width: '60px', render: function(v) { return '<span style="font-size:11px">'+escHtml(typeLabels[v]||'—')+'</span>'; } },
          { key: 'path_info', title: '路径', render: function(v, row) { return '<span style="font-size:11px">'+(row.base_path||row.file_pattern?(row.base_path?'<div style="color:var(--muted)">'+escHtml(row.base_path)+'</div>':'')+(row.file_pattern?'<div style="font-family:var(--mono);color:var(--accent)">'+escHtml(row.file_pattern)+'</div>':''):(row.doc_path?'<a href="'+escHtml(row.doc_path)+'" target="_blank" style="color:var(--accent);text-decoration:none">'+escHtml(row.doc_path)+' ↗</a>':'—'))+'</span>'; } },
          { key: 'description', title: '说明', render: function(v) { return '<span style="font-size:12px;color:var(--muted)">'+escHtml(v||'')+'</span>'; } }
        ];
        if (canEdit) cols.push({ key: 'actions', title: '操作', width: '90px', render: function(v, row) {
          var h = '<span style="white-space:nowrap;text-align:center">';
          if (row.is_unnecessary) h += '<span style="font-size:10px;color:var(--warn);margin-right:4px" title="已标记为无需文档">无需</span>';
          h += '<span style="font-size:10px;color:'+(row.is_optional?'var(--accent)':'var(--muted)')+';margin-right:4px;cursor:pointer" onclick="event.stopPropagation();toggleDocOptional(\''+escHtml(_selectedStage)+'\','+row.id+','+(row.is_optional?'1':'0')+')">'+(row.is_optional?'可选':'必选')+'</span>';
          h += iconCopy('copyTemplate('+row.id+')')+iconEdit('showEditTemplateForm('+row.id+')')+iconDelete('deleteTemplate('+row.id+')');
          h += '</span>'; return h;
        }});
        return cols;
      })(),
      data: docs,
    });
    dtDocs.enableDragReorder(_templatesGrouped[_selectedStage] || [], function() {
      _pendingOps.push({ stage: _selectedStage, type: 'docs', items: (_templatesGrouped[_selectedStage]||[]).map(function(d,i) { return {id:d.id, sort_order:i+1}; }) });
      renderTemplatesPage();
    });
  }

  if (tasks.length) {
    var dtTasks = new DataTable({
      container: document.getElementById('tpl-tasks-' + stageKey),
      columns: (function() {
        var cols = [
          { key: 'sort_order', title: '序号', width: '50px', render: function(v, row, idx) { return '<span data-drag-index="'+idx+'" style="font-family:var(--mono);color:var(--muted);cursor:grab" title="拖动排序">'+(v!=null?v:'—')+'</span>'; } },
          { key: 'task_name', title: '任务名称', render: function(v) { return '<span style="font-weight:500">'+escHtml(v||'')+'</span>'; } },
          { key: 'responsible_role', title: '责任人', width: '100px', render: function(v) { return '<span style="font-size:12px;white-space:nowrap">'+escHtml(v||'—')+'</span>'; } },
          { key: 'description', title: '说明', render: function(v) { return '<span style="font-size:12px;color:var(--muted)">'+escHtml(v||'')+'</span>'; } }
        ];
        if (canEdit) cols.push({ key: 'actions', title: '操作', width: '90px', render: function(v, row) {
          return '<span style="white-space:nowrap;text-align:center">'+(row.is_unnecessary?'<span style="font-size:10px;color:var(--warn);margin-right:4px">无需</span>':'')+'<span style="font-size:10px;color:'+(row.is_optional?'var(--accent)':'var(--muted)')+';margin-right:4px;cursor:pointer" onclick="event.stopPropagation();toggleTaskOptional(\''+escHtml(_selectedStage)+'\','+row.id+','+(row.is_optional?'1':'0')+')">'+(row.is_optional?'可选':'必选')+'</span>'+iconCopy('copyTaskTemplate('+row.id+')')+iconEdit('showEditTaskTemplateForm('+row.id+')')+iconDelete('deleteTaskTemplate('+row.id+')')+'</span>';
        }});
        return cols;
      })(),
      data: tasks,
    });
    dtTasks.enableDragReorder(_taskTemplatesGrouped[_selectedStage] || [], function() {
      _taskPendingOps.push({ stage: _selectedStage, type: 'tasks', items: (_taskTemplatesGrouped[_selectedStage]||[]).map(function(t,i) { return {id:t.id, sort_order:i+1}; }) });
      renderTemplatesPage();
    });
  }
}

function selectDocTemplateStage(stageType) {
  _selectedStage = stageType;
  renderTemplatesPage();
  _updateDocTemplatesHash();
}

/* ── Section Renderers for Doc & Task Templates ── */

function _renderDocTemplateSection(stageName, canEdit) {
  var docs = _templatesGrouped[stageName] || [];
  var pendingCount = _pendingOps.length;
  var html = '<div class="dt-section">';

  // Section header
  html += '<div class="dt-section-head">';
  html += '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px">';
  html += '<div class="section-title">' + escHtml(stageName) + ' — 文档清单 (' + docs.length + ')</div>';
  if (canEdit && pendingCount > 0) {
    html += '<button class="btn btn-primary" style="font-size:11px;padding:3px 10px;padding-left:14px;padding-right:14px;margin-left:8px" onclick="saveAllChanges()">保存配置 (' + pendingCount + ')</button>' +
      '<button class="btn btn-sm" style="margin-left:4px;color:var(--warn);border-color:var(--warn)" onclick="discardChanges()">放弃</button>';
  } else if (canEdit && pendingCount === 0) {
    html += '<span style="font-size:11px;color:var(--muted);margin-left:8px">✓ 已保存</span>';
  }
  html += '</div>';
  if (canEdit) {
    var allUnnec = (docs.length > 0 && docs.every(function(d) { return d.is_unnecessary; }))
      || (docs.length === 0 && (_stageUnnecDocs || []).indexOf(stageName) >= 0);
    html += '<div style="display:flex;align-items:center;gap:8px">' +
      '<span style="display:inline-flex;align-items:center;gap:4px">' +
        '<span style="font-size:11px;color:var(--muted)">无需文档</span>' +
        toggleSwitch(allUnnec, "toggleStageDocsUnnecessary('" + escHtml(stageName).replace(/'/g, "\\'") + "'," + (allUnnec ? '1' : '0') + ")", {id: 'doc-unnec-' + escHtml(stageName).replace(/[^a-zA-Z0-9]/g, '_')}) +
      '</span>';
    var addTitle = allUnnec ? '已配置为无需文档，请先关闭无需开关' : '添加文档';
    html += '<button class="btn btn-primary" style="font-size:11px;padding:3px 10px" onclick="' + (allUnnec ? 'showToast(\'已配置为无需文档，请先关闭无需开关\',\'warn\')' : 'showAddTemplateForm()') + '" title="' + escHtml(addTitle) + '">+ 添加文档</button>' +
    '</div>';
  }
  html += '</div>';

  // If no docs and toggle ON, show text instead of empty table
  if (allUnnec && docs.length === 0) {
    html += '<div style="padding:20px;text-align:center;color:var(--muted);font-style:italic">已配置为无需文档</div>';
    html += '</div>';
    return html;
  }

  // Table or empty state
  if (docs.length) {
    html += '<div id="tpl-docs-' + escHtml(stageName).replace(/[^a-zA-Z0-9]/g,'_') + '"></div>';
    html += '<div style="font-size:10.5px;color:var(--muted);margin-top:4px">💡 拖动序号列可调整文档顺序</div>';
  } else {
    html += '<div class="empty-state" style="padding:16px">暂无文档模板</div>';
  }

  html += '</div>';
  return html;
}

function _renderTaskTemplateSection(stageName, canEdit) {
  var tasks = _taskTemplatesGrouped[stageName] || [];
  var pendingCount = _taskPendingOps.length;
  var html = '<div class="dt-section">';

  // Section header
  html += '<div class="dt-section-head">';
  html += '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px">';
  html += '<div class="section-title">' + escHtml(stageName) + ' — 任务清单 (' + tasks.length + ')</div>';
  if (canEdit && pendingCount > 0) {
    html += '<button class="btn btn-primary" style="font-size:11px;padding:3px 10px;padding-left:14px;padding-right:14px;margin-left:8px" onclick="saveAllTaskChanges()">保存配置 (' + pendingCount + ')</button>' +
      '<button class="btn btn-sm" style="margin-left:4px;color:var(--warn);border-color:var(--warn)" onclick="discardTaskChanges()">放弃</button>';
  } else if (canEdit && pendingCount === 0 && tasks.length >= 0) {
    html += '<span style="font-size:11px;color:var(--muted);margin-left:8px">✓ 已保存</span>';
  }
  html += '</div>';
  if (canEdit) {
    var allUnnecTask = (tasks.length > 0 && tasks.every(function(t) { return t.is_unnecessary; }))
      || (tasks.length === 0 && (_stageUnnecTasks || []).indexOf(stageName) >= 0);
    html += '<div style="display:flex;align-items:center;gap:8px">' +
      '<span style="display:inline-flex;align-items:center;gap:4px">' +
        '<span style="font-size:11px;color:var(--muted)">无需任务</span>' +
        toggleSwitch(allUnnecTask, "toggleStageTasksUnnecessary('" + escHtml(stageName).replace(/'/g, "\\'") + "'," + (allUnnecTask ? '1' : '0') + ")", {id: 'task-unnec-' + escHtml(stageName).replace(/[^a-zA-Z0-9]/g, '_')}) +
      '</span>';
    var addTitle = allUnnecTask ? '已配置为无需任务，请先关闭无需开关' : '添加任务';
    html += '<button class="btn btn-primary" style="font-size:11px;padding:3px 10px" onclick="' + (allUnnecTask ? 'showToast(\'已配置为无需任务，请先关闭无需开关\',\'warn\')' : 'showAddTaskTemplateForm()') + '" title="' + escHtml(addTitle) + '">+ 添加任务</button>' +
    '</div>';
  }
  html += '</div>';

  if (allUnnecTask && tasks.length === 0) {
    html += '<div style="padding:20px;text-align:center;color:var(--muted);font-style:italic">已配置为无需任务</div>';
    html += '</div>';
    return html;
  }

  // Table or empty state
  if (tasks.length) {
    html += '<div id="tpl-tasks-' + escHtml(stageName).replace(/[^a-zA-Z0-9]/g,'_') + '"></div>';
    html += '<div style="font-size:10.5px;color:var(--muted);margin-top:4px">💡 拖动序号列可调整任务顺序</div>';
  } else {
    html += '<div class="empty-state" style="padding:16px">暂无任务模板</div>';
  }
  html += '</div>';
  return html;
}

/* ── Add/Edit Template Forms ── */

function showAddTemplateForm() {
  var nextSort = ((_templatesGrouped[_selectedStage] || []).length + 1);
  _openDocDialog('添加文档模板 — ' + escHtml(_selectedStage),
    '<div style="margin-bottom:10px">' +
      '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">文档名称</label>' +
      '<input class="search-inp" id="dt-doc-name" style="width:100%;box-sizing:border-box">' +
    '</div>' +
    '<div style="display:flex;gap:10px;margin-bottom:10px">' +
      '<div style="width:80px"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">序号</label>' +
        '<input class="search-inp" id="dt-sort" type="number" min="0" value="' + nextSort + '" style="width:100%;box-sizing:border-box;padding:8px 4px;text-align:center"></div>' +
      '<div style="flex:1"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">责任人（岗位） <span style="color:var(--danger)">*必填</span></label>' + _roleSelect('') + '</div>' +
    '</div>' +
    '<input type="hidden" class="doc-type-value" id="dt-doctype" value="gitlab">' +
    '<div style="margin-bottom:10px">' +
      '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:6px">文档类型 <span style="color:var(--danger)">*必填</span></label>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap" id="dt-doctype-btns">' +
        _docTypeButtons('gitlab') +
      '</div>' +
    '</div>' +
    '<div style="margin-bottom:10px">' +
      '<label class="dt-path-label" style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">路径 <span style="color:var(--danger)">*必填</span> &nbsp;<span class="dt-path-hint" style="font-weight:400;font-size:10px">{code} = 项目代号占位符</span></label>' +
      '<input class="search-inp" id="dt-base-path" placeholder="http://.../项目/{code}/" style="width:100%;box-sizing:border-box;margin-bottom:6px" oninput="_updateProjPathPreview()">' +
    '</div>' +
    '<div style="margin-bottom:10px">' +
      '<label class="dt-file-label" style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">文档名 <span style="color:var(--danger)">*必填</span> &nbsp;<span class="dt-file-hint" style="font-weight:400;font-size:10px">{code} = 项目代号占位符</span></label>' +
      '<input class="search-inp" id="dt-file-pattern" placeholder="01_{code}_SCH-FINAL.rar" style="width:100%;box-sizing:border-box" oninput="_updateProjPathPreview()">' +
    '</div>' +
    '<div style="margin-bottom:10px">' +
      '<label class="dt-preview-label" style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">最终路径预览 &nbsp;<span style="font-weight:400;font-size:10px">* 替换为项目代号</span></label>' +
      '<input class="search-inp" id="dt-path-preview" value="" style="width:100%;box-sizing:border-box;color:var(--accent);font-size:11px;font-family:var(--mono)" disabled>' +
    '</div>' +
    '<div style="margin-bottom:10px">' +
      '<label style="font-size:11px;color:var(--muted);display:flex;align-items:center;gap:6px;cursor:pointer">' +
        '<input type="checkbox" id="dt-is-optional" style="width:16px;height:16px;cursor:pointer">' +
        '可选项（标记后，项目可按需删除该文档）' +
      '</label></div>' +
    '<div style="margin-bottom:4px">' +
      '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">说明（可选）</label>' +
      '<input class="search-inp" id="dt-desc" style="width:100%;box-sizing:border-box">' +
    '</div>',
    [{text: '取消', cls: '', onclick: 'closeSharedDialog()'},
     {text: '确定', cls: 'btn-primary', onclick: 'saveTemplate()'}], {hideClose: true, maxWidth: 780}, 'gitlab');
  setTimeout(_updateProjPathPreview, 80);
}

function showEditTemplateForm(id) {
  var docs = _templatesGrouped[_selectedStage] || [];
  var d = docs.find(function(x) { return x.id === id; });
  if (!d) { showToast('未找到该模板数据，请刷新页面', 'error'); return; }
  // Fallback: if base_path/file_pattern empty but doc_path exists, parse doc_path
  var bp = d.base_path || '';
  var fp = d.file_pattern || '';
  if (!bp && !fp && d.doc_path) {
    var lastSlash = d.doc_path.lastIndexOf('/');
    if (lastSlash > 0) {
      bp = d.doc_path.substring(0, lastSlash + 1);
      fp = d.doc_path.substring(lastSlash + 1);
    }
  }
  _openDocDialog('编辑文档模板',
    '<div style="margin-bottom:10px">' +
      '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">文档名称</label>' +
      '<input class="search-inp" id="dt-doc-name" value="' + escHtml(d.doc_name) + '" style="width:100%;box-sizing:border-box">' +
    '</div>' +
    '<div style="display:flex;gap:10px;margin-bottom:10px">' +
      '<div style="width:80px"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">序号</label>' +
        '<input class="search-inp" id="dt-sort" type="number" min="0" value="' + (d.sort_order != null ? d.sort_order : 1) + '" style="width:100%;box-sizing:border-box;padding:8px 4px;text-align:center"></div>' +
      '<div style="flex:1"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">责任人（岗位） <span style="color:var(--danger)">*必填</span></label>' + _roleSelect(d.responsible_role || '') + '</div>' +
    '</div>' +
    '<input type="hidden" class="doc-type-value" id="dt-doctype" value="' + escHtml(d.doc_type || 'gitlab') + '">' +
    '<div style="margin-bottom:10px">' +
      '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:6px">文档类型 <span style="color:var(--danger)">*必填</span></label>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap" id="dt-doctype-btns">' +
        _docTypeButtons(d.doc_type || 'gitlab') +
      '</div>' +
    '</div>' +
    '<div style="margin-bottom:10px">' +
      '<label class="dt-path-label" style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">路径 <span style="color:var(--danger)">*必填</span> &nbsp;<span class="dt-path-hint" style="font-weight:400;font-size:10px">{code} = 项目代号占位符</span></label>' +
      '<input class="search-inp" id="dt-base-path" value="' + escHtml(bp) + '" placeholder="http://.../项目/{code}/" style="width:100%;box-sizing:border-box;margin-bottom:6px" oninput="_updateProjPathPreview()">' +
    '</div>' +
    '<div style="margin-bottom:10px">' +
      '<label class="dt-file-label" style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">文档名 <span style="color:var(--danger)">*必填</span> &nbsp;<span class="dt-file-hint" style="font-weight:400;font-size:10px">{code} = 项目代号占位符</span></label>' +
      '<input class="search-inp" id="dt-file-pattern" value="' + escHtml(fp) + '" placeholder="01_{code}_SCH-FINAL.rar" style="width:100%;box-sizing:border-box" oninput="_updateProjPathPreview()">' +
    '</div>' +
    '<div style="margin-bottom:10px">' +
      '<label class="dt-preview-label" style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">最终路径预览 &nbsp;<span style="font-weight:400;font-size:10px">* 替换为项目代号</span></label>' +
      '<input class="search-inp" id="dt-path-preview" value="" style="width:100%;box-sizing:border-box;color:var(--accent);font-size:11px;font-family:var(--mono)" disabled>' +
    '</div>' +
    '<div style="margin-bottom:10px">' +
      '<label style="font-size:11px;color:var(--muted);display:flex;align-items:center;gap:6px;cursor:pointer">' +
        '<input type="checkbox" id="dt-is-optional" style="width:16px;height:16px;cursor:pointer"' + (d.is_optional ? ' checked' : '') + '>' +
        '可选项（标记后，项目可按需删除该文档）' +
      '</label></div>' +
    '<div style="margin-bottom:4px">' +
      '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">说明（可选）</label>' +
      '<input class="search-inp" id="dt-desc" value="' + escHtml(d.description || '') + '" style="width:100%;box-sizing:border-box">' +
    '</div>',
    [{text: '取消', cls: '', onclick: 'closeSharedDialog()'},
     {text: '确定', cls: 'btn-primary', onclick: 'saveTemplate(' + id + ')'}], {hideClose: true, maxWidth: 780}, d.doc_type || 'gitlab');
  setTimeout(_updateProjPathPreview, 80);
}

function saveTemplate(id) {
  var nameEl = document.getElementById('dt-doc-name');
  var sortEl = document.getElementById('dt-sort');
  var roleEl = document.getElementById('dt-role');
  var descEl = document.getElementById('dt-desc');
  var basePathEl = document.getElementById('dt-base-path');
  var patternEl = document.getElementById('dt-file-pattern');
  if (!nameEl || !sortEl) { showToast('表单数据异常，请重新打开', 'error'); return; }

  var name = nameEl.value.trim();
  var sortVal = sortEl.value;
  var sort = sortVal !== '' ? parseInt(sortVal) : 0;
  var role = roleEl ? roleEl.value.trim() : '';
  var desc = descEl ? descEl.value.trim() : '';
  var basePath = basePathEl ? basePathEl.value.trim() : '';
  var filePattern = patternEl ? patternEl.value.trim() : '';
  var path = (basePath + '/' + filePattern).replace(/([^:])\/{2,}/g, '$1/');
  var typeEl = document.getElementById('dt-doctype');
  var docType = typeEl ? typeEl.value : '';
  if (!name) { showToast('请输入文档名称', 'error'); return; }
  if (!basePath && !filePattern) { showToast('请输入路径或文档名', 'error'); return; }
  if (!docType) { showToast('请选择文档类型', 'error'); return; }
  if (!role) { showToast('请选择责任人', 'error'); return; }
  if (isNaN(sort) || sort < 0) sort = 0;

  var isOptEl = document.getElementById('dt-is-optional');
  var isOptional = isOptEl && isOptEl.checked ? 1 : 0;

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
    existing.base_path = basePath;
    existing.file_pattern = filePattern;
    existing.doc_type = docType;
    existing.is_optional = !!isOptional;
    _pendingOps.push({ type: 'edit', id: id, stage_type: stageType,
      doc_name: name, sort_order: sort, responsible_role: role || '', description: desc, doc_path: path, base_path: basePath, file_pattern: filePattern, doc_type: docType, is_optional: isOptional });
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
      existing.base_path = basePath;
      existing.file_pattern = filePattern;
      existing.doc_type = docType;
      existing.is_optional = !!isOptional;
    }
    // Update the pending add op too
    for (var pi = 0; pi < _pendingOps.length; pi++) {
      if (_pendingOps[pi].tempId === id) {
        _pendingOps[pi].doc_name = name;
        _pendingOps[pi].sort_order = sort;
        _pendingOps[pi].responsible_role = role || '';
        _pendingOps[pi].description = desc;
        _pendingOps[pi].doc_path = path;
        _pendingOps[pi].base_path = basePath;
        _pendingOps[pi].file_pattern = filePattern;
        _pendingOps[pi].doc_type = docType;
        _pendingOps[pi].is_optional = isOptional;
        break;
      }
    }
  } else {
    // New template — add locally with temp ID
    var tempId = _nextTempId--;
    var newDoc = { id: tempId, stage_type: stageType, doc_name: name,
      sort_order: sort, responsible_role: role || '', description: desc, doc_path: path, base_path: basePath, file_pattern: filePattern, doc_type: docType, is_optional: !!isOptional };
    _pendingOps.push({ type: 'add', tempId: tempId, stage_type: stageType,
      doc_name: name, sort_order: sort, responsible_role: role || '', description: desc, doc_path: path, base_path: basePath, file_pattern: filePattern, doc_type: docType, is_optional: isOptional });
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
        description: d.description || '', doc_path: d.doc_path || '', doc_type: d.doc_type || '' });
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
    doc_path: tpl.doc_path || '',
    base_path: tpl.base_path || '',
    file_pattern: tpl.file_pattern || '',
    doc_type: tpl.doc_type || '',
    is_optional: tpl.is_optional || false,
    is_unnecessary: tpl.is_unnecessary || false
  };
  arr.push(newDoc);
  _pendingOps.push({ type: 'add', tempId: tempId, stage_type: _selectedStage,
    doc_name: newDoc.doc_name, sort_order: newDoc.sort_order,
    responsible_role: newDoc.responsible_role,
    description: newDoc.description, doc_path: newDoc.doc_path,
    base_path: newDoc.base_path, file_pattern: newDoc.file_pattern,
    doc_type: newDoc.doc_type, is_optional: newDoc.is_optional, is_unnecessary: newDoc.is_unnecessary });
  showToast('已复制，请修改后保存', 'info');
  renderTemplatesPage();
}

function toggleStageDocsUnnecessary(stageName, current) {
  var stageDocs = _templatesGrouped[stageName] || [];
  var newVal = current ? 0 : 1;
  if (stageDocs.length > 0) {
    // If turning ON with active templates, warn
    if (newVal === 1 && !stageDocs.every(function(d) { return d.is_unnecessary; })) {
      showToast('该阶段有文档模板，请先删除后再标记为无需文档', 'warn');
      loadTemplatesForType(_currentProjectType);
      return;
    }
    stageDocs.forEach(function(d) {
      if (d.is_unnecessary != newVal) {
        d.is_unnecessary = newVal;
        var found = false;
        for (var i = 0; i < _pendingOps.length; i++) {
          if (_pendingOps[i].type === 'edit' && _pendingOps[i].id === d.id) {
            _pendingOps[i].is_unnecessary = newVal;
            found = true; break;
          }
        }
        if (!found) {
          _pendingOps.push({ type: 'edit', id: d.id, stage_type: stageName,
            doc_name: d.doc_name, sort_order: d.sort_order, responsible_role: d.responsible_role || '',
            description: d.description || '', doc_path: d.doc_path || '', base_path: d.base_path || '',
            file_pattern: d.file_pattern || '', doc_type: d.doc_type || '', is_unnecessary: newVal });
        }
      }
    });
    renderTemplatesPage();
  } else {
    // Empty stage: save directly via API
    API.put('/doc-templates/stage-unnecessary/docs?project_type=' + encodeURIComponent(_currentProjectType),
      { stage_name: stageName, unnecessary: !current }).then(function() {
      // Update local cache immediately for visual feedback
      _stageUnnecDocs = _stageUnnecDocs || [];
      var idx = _stageUnnecDocs.indexOf(stageName);
      if (newVal && idx < 0) _stageUnnecDocs.push(stageName);
      if (!newVal && idx >= 0) _stageUnnecDocs.splice(idx, 1);
      renderTemplatesPage();
    }).catch(function(e) { showToast('操作失败: ' + (e.message || ''), 'error'); });
  }
}
function toggleStageTasksUnnecessary(stageName, current) {
  var stageTasks = (_taskTemplatesGrouped || {})[stageName] || [];
  var newVal = current ? 0 : 1;
  if (stageTasks.length > 0) {
    if (newVal === 1 && !stageTasks.every(function(t) { return t.is_unnecessary; })) {
      showToast('该阶段有任务模板，请先删除后再标记为无需任务', 'warn');
      loadTemplatesForType(_currentProjectType);
      return;
    }
    stageTasks.forEach(function(t) {
      if (t.is_unnecessary != newVal) {
        t.is_unnecessary = newVal;
        var found = false;
        for (var i = 0; i < _taskPendingOps.length; i++) {
          if (_taskPendingOps[i].type === 'edit' && _taskPendingOps[i].id === t.id) {
            _taskPendingOps[i].is_unnecessary = newVal;
            found = true; break;
          }
        }
        if (!found) {
          _taskPendingOps.push({ type: 'edit', id: t.id, stage_type: stageName,
            task_name: t.task_name, sort_order: t.sort_order, responsible_role: t.responsible_role || '',
            description: t.description || '', is_unnecessary: newVal });
        }
      }
    });
    renderTemplatesPage();
  } else {
    API.put('/doc-templates/stage-unnecessary/tasks?project_type=' + encodeURIComponent(_currentProjectType),
      { stage_name: stageName, unnecessary: !current }).then(function() {
      _stageUnnecTasks = _stageUnnecTasks || [];
      var idx = _stageUnnecTasks.indexOf(stageName);
      if (newVal && idx < 0) _stageUnnecTasks.push(stageName);
      if (!newVal && idx >= 0) _stageUnnecTasks.splice(idx, 1);
      renderTemplatesPage();
    }).catch(function(e) { showToast('操作失败: ' + (e.message || ''), 'error'); });
  }
}
function toggleTemplateUnnecessary(id, current) {
  var newVal = current ? 0 : 1;
  API.put('/doc-templates/' + id, { is_unnecessary: newVal }).then(function() {
    showToast(newVal ? '已标记为无需文档' : '已取消标记', 'success');
    loadTemplatesForType(_currentProjectType).then(function() { renderTemplatesPage(); });
  }).catch(function(e) { showToast('操作失败: ' + (e.message || ''), 'error'); });
}
function toggleTaskUnnecessary(id, current) {
  var newVal = current ? 0 : 1;
  API.put('/doc-templates/tasks/' + id, { is_unnecessary: newVal }).then(function() {
    showToast(newVal ? '已标记为无需任务' : '已取消标记', 'success');
    loadTemplatesForType(_currentProjectType).then(function() { renderTemplatesPage(); });
  }).catch(function(e) { showToast('操作失败: ' + (e.message || ''), 'error'); });
}

function toggleDocOptional(stageName, id, current) {
  var newVal = current ? 0 : 1;
  var arr = _templatesGrouped[stageName] || [];
  var d = arr.find(function(x) { return x.id === id; });
  if (!d) return;
  d.is_optional = !!newVal;
  var found = false;
  for (var i = 0; i < _pendingOps.length; i++) {
    if (_pendingOps[i].type === 'edit' && _pendingOps[i].id === id) {
      _pendingOps[i].is_optional = newVal; found = true; break;
    }
  }
  if (!found) {
    _pendingOps.push({ type: 'edit', id: id, stage_type: stageName,
      doc_name: d.doc_name, sort_order: d.sort_order, responsible_role: d.responsible_role || '',
      description: d.description || '', doc_path: d.doc_path || '', base_path: d.base_path || '',
      file_pattern: d.file_pattern || '', doc_type: d.doc_type || '', is_optional: newVal });
  }
  renderTemplatesPage();
}
function toggleProductDocOptional(id, current) {
  var newVal = current ? 0 : 1;
  var t = _productTemplates.find(function(x) { return x.id === id; });
  if (!t) return;
  t.is_optional = !!newVal;
  var found = false;
  for (var i = 0; i < _productPendingOps.length; i++) {
    if (_productPendingOps[i].type === 'edit' && _productPendingOps[i].id === id) {
      _productPendingOps[i].is_optional = newVal; found = true; break;
    }
  }
  if (!found) {
    _productPendingOps.push({ type: 'edit', id: id,
      doc_name: t.doc_name, sort_order: t.sort_order, stage_type: t.stage_type || '通用',
      responsible_role: t.responsible_role || '', description: t.description || '',
      doc_path: t.doc_path || '', base_path: t.base_path || '', file_pattern: t.file_pattern || '',
      doc_type: t.doc_type || '', is_optional: newVal });
  }
  renderProductTreePage();
}

function toggleTaskOptional(stageName, id, current) {
  var newVal = current ? 0 : 1;
  var arr = _taskTemplatesGrouped[stageName] || [];
  var t = arr.find(function(x) { return x.id === id; });
  if (!t) return;
  t.is_optional = !!newVal;
  var found = false;
  for (var i = 0; i < _taskPendingOps.length; i++) {
    if (_taskPendingOps[i].type === 'edit' && _taskPendingOps[i].id === id) {
      _taskPendingOps[i].is_optional = newVal; found = true; break;
    }
  }
  if (!found) {
    _taskPendingOps.push({ type: 'edit', id: id, stage_type: stageName,
      task_name: t.task_name, sort_order: t.sort_order, responsible_role: t.responsible_role || '',
      description: t.description || '', is_optional: newVal });
  }
  renderTemplatesPage();
}

async function deleteTemplate(id) {
  if (id < 0) {
    // Locally-added template, just remove
    for (var pi = _pendingOps.length - 1; pi >= 0; pi--) {
      if (_pendingOps[pi].tempId === id) { _pendingOps.splice(pi, 1); break; }
    }
    var arr0 = _templatesGrouped[_selectedStage];
    if (arr0) {
      for (var i0 = arr0.length - 1; i0 >= 0; i0--) {
        if (arr0[i0].id === id) { arr0.splice(i0, 1); break; }
      }
    }
    renderTemplatesPage();
    return;
  }

  // Find template info
  var tplInfo = '';
  var arr = _templatesGrouped[_selectedStage] || [];
  var found = arr.find(function(x) { return x.id === id; });
  if (found) tplInfo = found.doc_name;

  var html = '<div style="font-size:13px">' +
    '<p>确认删除文档模板 <b>"' + escHtml(tplInfo || '#' + id) + '"</b>？</p>' +
    '<div style="margin:12px 0"><label style="font-size:13px;font-weight:600;display:block;margin-bottom:8px">对已创建的项目文档：</label>' +
    '<div style="margin:6px 0"><label style="cursor:pointer;display:flex;align-items:flex-start;gap:8px"><input type="radio" name="deleteMode" value="keep" checked style="margin-top:2px"><div><div style="font-size:13px">保留项目文档（推荐）</div><div style="font-size:11px;color:var(--muted)">文档保留但不再随模板同步更新</div></div></label></div>' +
    '<div style="margin:6px 0"><label style="cursor:pointer;display:flex;align-items:flex-start;gap:8px"><input type="radio" name="deleteMode" value="hard" style="margin-top:2px"><div><div style="font-size:13px;color:var(--danger)">同时删除项目文档</div><div style="font-size:11px;color:var(--muted)">删除所有项目中通过该模板创建的文档，不可恢复</div></div></label></div>' +
    '</div></div>';

  openDialog('删除文档模板', html, [
    {text: '取消', onclick: 'closeSharedDialog()'},
    {text: '确认删除', cls: 'btn-danger', onclick: '_doDeleteDocTemplateDialog(' + id + ')'}
  ], {hideClose: true});
}

function _doDeleteDocTemplateDialog(id) {
  var mode = document.querySelector('input[name="deleteMode"]:checked');
  var hardDelete = mode && mode.value === 'hard';
  closeSharedDialog();
  _doDeleteDocTemplate(id, hardDelete);
}

async function _doDeleteDocTemplate(id, hardDelete) {
  try {
    var url = '/doc-templates/' + id;
    if (hardDelete) url += '?delete_docs=true';
    await API.del(url);
    showToast(hardDelete ? '已删除模板及项目文档' : '模板已删除（项目文档已保留）', 'success');
  } catch(e) {
    showToast('删除失败: ' + (e.message || '未知错误'), 'error');
    return;
  }
  // Remove from local cache and refresh
  var arr = _templatesGrouped[_selectedStage];
  if (arr) {
    for (var i = arr.length - 1; i >= 0; i--) {
      if (arr[i].id === id) { arr.splice(i, 1); break; }
    }
  }
  try {
    var fresh = await API.get('/doc-templates?project_type=' + encodeURIComponent(_currentProjectType));
    if (fresh && Object.keys(fresh).length) _templatesGrouped = fresh;
  } catch(e) {}
  renderTemplatesPage();
}

/* ── Task Template CRUD ── */

function showAddTaskTemplateForm() {
  var nextSort = ((_taskTemplatesGrouped[_selectedStage] || []).length + 1);
  var bodyHtml =
    '<div style="margin-bottom:10px">' +
      '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">任务名称 <span style="color:var(--danger)">*必填</span></label>' +
      '<input class="search-inp" id="dt-task-name" style="width:100%;box-sizing:border-box" placeholder="输入任务名称">' +
    '</div>' +
    '<div style="display:flex;gap:10px;margin-bottom:10px">' +
      '<div style="width:80px"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">序号</label>' +
        '<input class="search-inp" id="dt-task-sort" type="number" min="0" value="' + nextSort + '" style="width:100%;box-sizing:border-box;padding:8px 4px;text-align:center"></div>' +
      '<div style="flex:1"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">责任人（岗位） <span style="color:var(--danger)">*必填</span></label>' + _roleSelect('') + '</div>' +
    '</div>' +
    '<div style="margin-bottom:10px">' +
      '<label style="font-size:11px;color:var(--muted);display:flex;align-items:center;gap:6px;cursor:pointer">' +
        '<input type="checkbox" id="dt-task-is-optional" style="width:16px;height:16px;cursor:pointer">' +
        '可选项（标记后，项目可按需删除该任务）' +
      '</label></div>' +
    '<div style="margin-bottom:4px">' +
      '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">任务描述（可选）</label>' +
      '<textarea class="search-inp" id="dt-task-desc" rows="3" style="width:100%;box-sizing:border-box;resize:vertical" placeholder="任务详细描述"></textarea>' +
    '</div>';
  openDialog('添加任务模板 — ' + escHtml(_selectedStage), bodyHtml,
    [{text: '取消', cls: '', onclick: 'closeSharedDialog()'},
     {text: '确定', cls: 'btn-primary', onclick: 'saveTaskTemplate()'}], {hideClose: true});
}

function showEditTaskTemplateForm(id) {
  var items = _taskTemplatesGrouped[_selectedStage] || [];
  var t = items.find(function(x) { return x.id === id; });
  if (!t) { showToast('未找到该任务模板，请刷新页面', 'error'); return; }
  var bodyHtml =
    '<div style="margin-bottom:10px">' +
      '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">任务名称 <span style="color:var(--danger)">*必填</span></label>' +
      '<input class="search-inp" id="dt-task-name" value="' + escHtml(t.task_name) + '" style="width:100%;box-sizing:border-box">' +
    '</div>' +
    '<div style="display:flex;gap:10px;margin-bottom:10px">' +
      '<div style="width:80px"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">序号</label>' +
        '<input class="search-inp" id="dt-task-sort" type="number" min="0" value="' + (t.sort_order != null ? t.sort_order : 1) + '" style="width:100%;box-sizing:border-box;padding:8px 4px;text-align:center"></div>' +
      '<div style="flex:1"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">责任人（岗位） <span style="color:var(--danger)">*必填</span></label>' + _roleSelect(t.responsible_role || '') + '</div>' +
    '</div>' +
    '<div style="margin-bottom:10px">' +
      '<label style="font-size:11px;color:var(--muted);display:flex;align-items:center;gap:6px;cursor:pointer">' +
        '<input type="checkbox" id="dt-task-is-optional" style="width:16px;height:16px;cursor:pointer"' + (t.is_optional ? ' checked' : '') + '>' +
        '可选项（标记后，项目可按需删除该任务）' +
      '</label></div>' +
    '<div style="margin-bottom:4px">' +
      '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">任务描述（可选）</label>' +
      '<textarea class="search-inp" id="dt-task-desc" rows="3" style="width:100%;box-sizing:border-box;resize:vertical">' + escHtml(t.description || '') + '</textarea>' +
    '</div>';
  openDialog('编辑任务模板', bodyHtml,
    [{text: '取消', cls: '', onclick: 'closeSharedDialog()'},
     {text: '确定', cls: 'btn-primary', onclick: 'saveTaskTemplate(' + id + ')'}], {hideClose: true});
}

function saveTaskTemplate(id) {
  var nameEl = document.getElementById('dt-task-name');
  var sortEl = document.getElementById('dt-task-sort');
  var roleEl = document.getElementById('dt-role');
  var descEl = document.getElementById('dt-task-desc');
  if (!nameEl || !sortEl) { showToast('表单数据异常，请重新打开', 'error'); return; }

  var name = nameEl.value.trim();
  var sortVal = sortEl.value;
  var sort = sortVal !== '' ? parseInt(sortVal) : 0;
  var role = roleEl ? roleEl.value.trim() : '';
  var desc = descEl ? descEl.value.trim() : '';
  var isOptTaskEl = document.getElementById('dt-task-is-optional');
  var isOptional = isOptTaskEl && isOptTaskEl.checked ? 1 : 0;

  if (!name) { showToast('请输入任务名称', 'error'); return; }

  var stageType = _selectedStage;
  if (!id && !stageType) { showToast('阶段类型丢失，请重新选择阶段', 'error'); return; }

  if (id && id > 0) {
    // Edit existing server-side template
    var arr = _taskTemplatesGrouped[stageType] || [];
    var existing = arr.find(function(x) { return x.id === id; });
    if (!existing) { showToast('未找到该任务模板', 'error'); return; }
    existing.task_name = name;
    existing.sort_order = sort;
    existing.responsible_role = role || '';
    existing.description = desc;
    existing.is_optional = !!isOptional;
    _taskPendingOps.push({ type: 'edit', id: id, stage_type: stageType,
      task_name: name, sort_order: sort, responsible_role: role || '', description: desc, is_optional: isOptional });
  } else if (id && id < 0) {
    // Edit locally-added (not yet saved)
    var arr = _taskTemplatesGrouped[stageType] || [];
    var existing = arr.find(function(x) { return x.id === id; });
    if (existing) {
      existing.task_name = name;
      existing.sort_order = sort;
      existing.responsible_role = role || '';
      existing.description = desc;
    }
    for (var pi = 0; pi < _taskPendingOps.length; pi++) {
      if (_taskPendingOps[pi].tempId === id) {
        _taskPendingOps[pi].task_name = name;
        _taskPendingOps[pi].sort_order = sort;
        _taskPendingOps[pi].responsible_role = role || '';
        _taskPendingOps[pi].description = desc;
        break;
      }
    }
  } else {
    // New template — add locally with temp ID
    var tempId = _nextTempId--;
    var newTpl = { id: tempId, stage_type: stageType, task_name: name,
      sort_order: sort, responsible_role: role || '', description: desc, is_optional: !!isOptional };
    _taskPendingOps.push({ type: 'add', tempId: tempId, stage_type: stageType,
      task_name: name, sort_order: sort, responsible_role: role || '', description: desc, is_optional: isOptional });
    var arr2 = _taskTemplatesGrouped[stageType];
    if (!arr2) { _taskTemplatesGrouped[stageType] = []; arr2 = _taskTemplatesGrouped[stageType]; }
    arr2.push(newTpl);
  }

  var overlay = document.querySelector('.shared-dialog-overlay');
  if (overlay) overlay.remove();
  _selectedStage = stageType;
  renderTemplatesPage();
}

async function deleteTaskTemplate(id) {
  if (id < 0) {
    var arr = _taskTemplatesGrouped[_selectedStage];
    if (arr) {
      for (var i = arr.length - 1; i >= 0; i--) {
        if (arr[i].id === id) { arr.splice(i, 1); break; }
      }
    }
    _taskPendingOps = _taskPendingOps.filter(function(op) { return op.tempId !== id; });
    renderTemplatesPage();
    return;
  }
  // Find template info for the dialog
  var tplInfo = '';
  for (var st in _taskTemplatesGrouped) {
    var found = (_taskTemplatesGrouped[st] || []).find(function(x) { return x.id === id; });
    if (found) { tplInfo = found.task_name; break; }
  }

  var html = '<div style="font-size:13px">' +
    '<p>确认删除任务模板 <b>"' + escHtml(tplInfo || '#' + id) + '"</b>？</p>' +
    '<div style="margin:12px 0"><label style="font-size:13px;font-weight:600;display:block;margin-bottom:8px">对已创建的项目任务：</label>' +
    '<div style="margin:6px 0"><label style="cursor:pointer;display:flex;align-items:flex-start;gap:8px"><input type="radio" name="deleteMode" value="keep" checked style="margin-top:2px"><div><div style="font-size:13px">保留项目任务（推荐）</div><div style="font-size:11px;color:var(--muted)">任务转为手动任务，脱离模板关联，数据不会丢失</div></div></label></div>' +
    '<div style="margin:6px 0"><label style="cursor:pointer;display:flex;align-items:flex-start;gap:8px"><input type="radio" name="deleteMode" value="hard" style="margin-top:2px"><div><div style="font-size:13px;color:var(--danger)">同时删除项目任务</div><div style="font-size:11px;color:var(--muted)">删除所有项目中通过该模板创建的任务（含工时和评论），不可恢复</div></div></label></div>' +
    '</div></div>';

  openDialog('删除任务模板', html, [
    {text: '取消', onclick: 'closeSharedDialog()'},
    {text: '确认删除', cls: 'btn-danger', onclick: '_doDeleteTaskTemplateDialog(' + id + ')'}
  ], {hideClose: true});
}

function _doDeleteTaskTemplateDialog(id) {
  var mode = document.querySelector('input[name="deleteMode"]:checked');
  var hardDelete = mode && mode.value === 'hard';
  closeSharedDialog();
  _doDeleteTaskTemplate(id, hardDelete);
}

async function _doDeleteTaskTemplate(id, hardDelete) {
  try {
    var url = '/task-templates/' + id;
    if (hardDelete) url += '?delete_tasks=true';
    var result = await API.del(url);
    showToast(hardDelete ? '已删除模板及项目任务' : '模板已删除（任务已转为手动）', 'success');
  } catch(e) {
    showToast('删除失败: ' + (e.message || '未知错误'), 'error');
    return;
  }
  // Refresh task template cache
  try {
    var taskFresh = await API.get('/task-templates?project_type=' + encodeURIComponent(_currentProjectType));
    if (taskFresh && Object.keys(taskFresh).length) _taskTemplatesGrouped = taskFresh;
  } catch(e) {}
  renderTemplatesPage();
}

function copyTaskTemplate(id) {
  var arr = _taskTemplatesGrouped[_selectedStage] || [];
  var tpl = arr.find(function(x) { return x.id === id; });
  if (!tpl) { showToast('未找到该任务模板', 'error'); return; }
  var tempId = _nextTempId--;
  var newTpl = {
    id: tempId,
    stage_type: _selectedStage,
    task_name: tpl.task_name + '（副本）',
    sort_order: arr.length + 1,
    responsible_role: tpl.responsible_role || '',
    description: tpl.description || ''
  };
  arr.push(newTpl);
  _taskPendingOps.push({ type: 'add', tempId: tempId, stage_type: _selectedStage,
    task_name: newTpl.task_name, sort_order: newTpl.sort_order,
    responsible_role: newTpl.responsible_role, description: newTpl.description });
  renderTemplatesPage();
}

function renderTaskTemplatesAfterReorder() {
  var items = _taskTemplatesGrouped[_selectedStage] || [];
  for (var i = 0; i < items.length; i++) {
    var t = items[i];
    t.sort_order = i + 1;
    if (t.id > 0) {
      _taskPendingOps.push({ type: 'edit', id: t.id, stage_type: _selectedStage,
        task_name: t.task_name, sort_order: t.sort_order,
        responsible_role: t.responsible_role || '', description: t.description || '' });
    }
  }
  renderTemplatesPage();
}

async function saveAllTaskChanges() {
  for (var i = 0; i < _taskPendingOps.length; i++) {
    var op = _taskPendingOps[i];
    try {
      if (op.type === 'add') {
        var data = await API.post('/task-templates', {
          project_type: _currentProjectType,
          stage_type: op.stage_type,
          task_name: op.task_name,
          sort_order: op.sort_order,
          responsible_role: op.responsible_role || '',
          description: op.description || '',
          is_optional: op.is_optional || 0
        });
        // Update temp ID references
        if (op.tempId) {
          var arr = _taskTemplatesGrouped[op.stage_type];
          if (arr) {
            var item = arr.find(function(x) { return x.id === op.tempId; });
            if (item) { item.id = data.id; }
          }
        }
      } else if (op.type === 'edit') {
        await API.put('/task-templates/' + op.id, {
          stage_type: op.stage_type,
          task_name: op.task_name,
          sort_order: op.sort_order,
          responsible_role: op.responsible_role || '',
          description: op.description || '',
          is_optional: op.is_optional || 0
        });
      } else if (op.type === 'delete') {
        await API.del('/task-templates/' + op.id);
      }
    } catch(e) {
      showToast('保存失败: ' + (e.message || ''), 'error');
      return;
    }
  }
  _taskPendingOps = [];
  showToast('任务模板已保存', 'success');
  // Reload from server
  try {
    var tdata = await API.get('/task-templates?project_type=' + encodeURIComponent(_currentProjectType));
    _taskTemplatesGrouped = tdata || {};
  } catch(e) {}
  renderTemplatesPage();
}

function discardTaskChanges() {
  _taskPendingOps = [];
  // Reload from server
  loadTemplatesForType(_currentProjectType).then(function() {
    renderTemplatesPage();
  });
  showToast('已放弃未保存的修改');
}

async function syncAllProjectsTasks() {
  if (!confirm('将当前任务模板应用到全部项目，在对应阶段自动创建任务。\n\n已存在的任务不会被重复创建。\n\n确定继续？')) return;
  try {
    var result = await API.post('/task-templates/sync-all', {});
    showToast('已同步 ' + result.synced + '/' + result.total + ' 个项目' + (result.failed ? '，' + result.failed + ' 个失败' : ''), 'success');
  } catch(e) {
    showToast('同步失败: ' + (e.message || ''), 'error');
  }
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

async function renameStageType(oldName) {
  var newName = document.getElementById('dt-rename-input').value.trim();
  if (!newName) { showToast('请输入新名称', 'error'); return; }
  if (newName === oldName) { document.querySelector('.note-dialog-overlay').remove(); return; }

  // 关闭重命名弹窗
  document.querySelector('.note-dialog-overlay').remove();

  // 检查未保存的配置
  if (_pendingOps.length > 0 || _taskPendingOps.length > 0) {
    if (!confirm('有未保存的配置将被清空：\n  • ' + _pendingOps.length + ' 个文档模板变更\n  • ' + _taskPendingOps.length + ' 个任务模板变更\n\n继续重命名将丢弃这些未保存的配置。确认继续？')) return;
    _pendingOps = [];
    _taskPendingOps = [];
  }

  // 确认弹窗
  if (!confirm('修改阶段名将立即保存配置并同步到所有项目和产品。此操作不可撤销，确认继续？\n\n旧名称：' + oldName + '\n新名称：' + newName)) return;

  // 1. 立即执行重命名
  try {
    var renameResult = await API.put('/doc-templates/stage-types/rename', { old_name: oldName, new_name: newName });
    var total = Object.values(renameResult).reduce(function(a, b) { return a + b; }, 0);
    showToast('阶段已重命名: ' + oldName + ' → ' + newName + ' (' + total + ' 条记录)', 'success');
  } catch(e) {
    showToast('重命名失败: ' + (e.message || '未知错误'), 'error');
    return;
  }

  // 2. 立即同步到所有项目和产品（含部分失败重试）
  await _doRenameSyncAll(oldName, newName);

  // 3. 刷新本地缓存
  try {
    var fresh = await API.get('/doc-templates?project_type=' + encodeURIComponent(_currentProjectType));
    if (fresh && Object.keys(fresh).length) _templatesGrouped = fresh;
  } catch(e) {}
  try {
    var taskFresh = await API.get('/task-templates?project_type=' + encodeURIComponent(_currentProjectType));
    if (taskFresh && Object.keys(taskFresh).length) _taskTemplatesGrouped = taskFresh;
  } catch(e) {}

  if (_selectedStage === oldName) _selectedStage = newName;
  renderTemplatesPage();
}

async function _doRenameSyncAll(oldName, newName) {
  var results = await Promise.all([
    API.post('/doc-templates/sync-all').catch(function(e) { return {_error: e.message}; }),
    API.post('/task-templates/sync-all').catch(function(e) { return {_error: e.message}; }),
    API.post('/product-doc-templates/sync-all').catch(function(e) { return {_error: e.message}; }),
  ]);
  var docR = results[0], taskR = results[1], prodR = results[2];
  var totalFailed = (docR._error ? 1 : (docR.failed || 0)) + (taskR._error ? 1 : (taskR.failed || 0)) + (prodR._error ? 1 : (prodR.failed || 0));
  if (totalFailed > 0) {
    var failList = [];
    if (docR._error) failList.push('文档: ' + docR._error);
    else if (docR.failed > 0) failList.push('文档: ' + docR.failed + '/' + docR.total + ' 失败');
    if (taskR._error) failList.push('任务: ' + taskR._error);
    else if (taskR.failed > 0) failList.push('任务: ' + taskR.failed + '/' + taskR.total + ' 失败');
    if (prodR._error) failList.push('产品: ' + prodR._error);
    else if (prodR.failed > 0) failList.push('产品: ' + prodR.failed + '/' + prodR.total + ' 失败');
    showToast('同步部分失败:\n' + failList.join('\n'), 'error');
  } else {
    showToast('同步完成 | 文档: ' + (docR.synced||0) + '/' + (docR.total||0)
      + ' | 任务: ' + (taskR.synced||0) + '/' + (taskR.total||0)
      + ' | 产品: ' + (prodR.synced||0) + '/' + (prodR.total||0), 'success');
  }
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

async function deleteStageType(stageType) {
  var docCount = (_templatesGrouped[stageType] || []).length;
  var taskCount = (_taskTemplatesGrouped[stageType] || []).length;

  // 查询影响范围
  var usage = null;
  try {
    usage = await API.get('/doc-templates/stage-types/' + encodeURIComponent(stageType) + '/usage?project_type=' + encodeURIComponent(_currentProjectType));
  } catch(e) {}

  var impactHtml = '';
  if (usage && usage.affected_projects && usage.affected_projects.length > 0) {
    impactHtml = '<div style="margin:8px 0;font-size:12px;color:var(--warn)">影响 ' + usage.affected_projects.length + ' 个项目的 ' + usage.total_tasks + ' 个任务和 ' + usage.total_docs + ' 个文档</div>';
  }

  var html = '<div style="font-size:13px">' +
    '<p>确认删除阶段类型 <b>"' + escHtml(stageType) + '"</b>？</p>' +
    '<p style="color:var(--muted);font-size:12px">将同时删除 ' + docCount + ' 个文档模板、' + taskCount + ' 个任务模板</p>' +
    impactHtml +
    '<div style="margin:12px 0"><label style="font-size:13px;font-weight:600;display:block;margin-bottom:8px">对已有项目数据的处理方式：</label>' +
    '<div style="margin:6px 0"><label style="cursor:pointer;display:flex;align-items:flex-start;gap:8px"><input type="radio" name="deleteMode" value="keep" checked style="margin-top:2px"><div><div style="font-size:13px">保留项目数据（推荐）</div><div style="font-size:11px;color:var(--muted)">任务和文档移至「未知」阶段并脱离模板关联，不删除任何项目数据</div></div></label></div>' +
    '<div style="margin:6px 0"><label style="cursor:pointer;display:flex;align-items:flex-start;gap:8px"><input type="radio" name="deleteMode" value="hard" style="margin-top:2px"><div><div style="font-size:13px;color:var(--danger)">同时删除项目数据</div><div style="font-size:11px;color:var(--muted)">删除所有项目中的该阶段及其任务和文档，不可恢复</div></div></label></div>' +
    '</div></div>';

  openDialog('删除阶段类型', html, [
    {text: '取消', onclick: 'closeSharedDialog()'},
    {text: '确认删除', cls: 'btn-danger', onclick: '_doDeleteStageDialog(\'' + escHtml(stageType) + '\')'}
  ], {hideClose: true});

  // Store stageType for the callback
  window._deleteStageType = stageType;
}

function _doDeleteStageDialog(stageType) {
  var mode = document.querySelector('input[name="deleteMode"]:checked');
  var hardDelete = mode && mode.value === 'hard';
  closeSharedDialog();
  _doDeleteStage(stageType, hardDelete);
}

async function _doDeleteStage(stageType, hardDelete) {
  try {
    var url = '/doc-templates/stage-types/' + encodeURIComponent(stageType) + '?project_type=' + encodeURIComponent(_currentProjectType);
    if (hardDelete) url += '&delete_tasks=true';
    var result = await API.del(url);
    var action = hardDelete ? '已删除阶段及项目数据' : '已删除阶段（项目数据已保留）';
    showToast(action + ' (docs=' + (result.doc_templates||0) + ' tasks=' + (result.task_templates||0) + ')', 'success');
  } catch(e) {
    showToast('删除失败: ' + (e.message || '未知错误'), 'error');
    return;
  }

  // Refresh cache
  try {
    var fresh = await API.get('/doc-templates?project_type=' + encodeURIComponent(_currentProjectType));
    if (fresh && Object.keys(fresh).length) _templatesGrouped = fresh;
    var taskFresh = await API.get('/task-templates?project_type=' + encodeURIComponent(_currentProjectType));
    if (taskFresh && Object.keys(taskFresh).length) _taskTemplatesGrouped = taskFresh;
  } catch(e) {}

  if (_selectedStage === stageType) _selectedStage = null;
  renderTemplatesPage();
}

/* ── Project Type Rename / Delete ── */

function showRenameProjectTypeDialog(ptypeId, currentLabel) {
  var current = _projectTypes.find(function(p) { return p.id === ptypeId; });
  var currentPrefix = (current && current.code_prefix) || '';
  var html = '<div class="note-dialog-overlay">' +
    '<div class="note-dialog" style="max-width:400px">' +
      '<div class="note-dialog-head"><span class="note-dialog-title">编辑项目类型 — ' + escHtml(ptypeId) + '</span>' +
        '<button class="note-dialog-close" onclick="this.closest(\'.note-dialog-overlay\').remove()">&times;</button></div>' +
      '<div style="margin-bottom:12px">' +
        '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">显示名称</label>' +
        '<input class="search-inp" id="ptype-rename-input" value="' + escHtml(currentLabel) + '" style="width:100%;box-sizing:border-box">' +
      '</div>' +
      '<div style="margin-bottom:12px">' +
        '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">项目编号前缀</label>' +
        '<input class="search-inp" id="ptype-prefix-input" value="' + escHtml(currentPrefix) + '" placeholder="如：PE、SW、PT、LSJ" style="width:100%;box-sizing:border-box">' +
      '</div>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px">' +
        '<button class="btn" onclick="this.closest(\'.note-dialog-overlay\').remove()">取消</button>' +
        '<button class="btn btn-primary" onclick="renameProjectType(\'' + escHtml(ptypeId) + '\')">保存</button>' +
      '</div>' +
    '</div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
  document.getElementById('ptype-rename-input').focus();
  document.getElementById('ptype-rename-input').select();
}

async function renameProjectType(ptypeId) {
  var newLabel = document.getElementById('ptype-rename-input').value.trim();
  var newPrefix = (document.getElementById('ptype-prefix-input') || {}).value || '';
  newPrefix = newPrefix.trim();
  if (!newLabel) { showToast('请输入新名称', 'error'); return; }
  var current = _projectTypes.find(function(p) { return p.id === ptypeId; });
  try {
    var params = 'label=' + encodeURIComponent(newLabel);
    if (newPrefix) params += '&code_prefix=' + encodeURIComponent(newPrefix);
    await API.put('/doc-templates/project-types/' + encodeURIComponent(ptypeId) + '?' + params);
    document.querySelector('.note-dialog-overlay').remove();
    if (current) { current.label = newLabel; if (newPrefix) current.code_prefix = newPrefix; }
    showToast('项目类型已更新: ' + newLabel, 'success');
    renderTemplatesPage();
  } catch(e) {
    showToast('更新失败: ' + (e.message || ''), 'error');
  }
}

function deleteProjectType(ptypeId, label) {
  var html = '<div style="font-size:13px;margin-bottom:16px">' +
    '确认删除项目类型 <b>"' + escHtml(label) + '"</b>？' +
    '<div style="margin-top:8px;font-size:11px;color:var(--danger)">将同时删除该项目类型下的所有阶段类型、文档模板和任务模板，此操作不可撤销。</div>' +
    '</div>';
  openDialog('删除项目类型', html, [
    {text: '取消', onclick: 'closeSharedDialog()'},
    {text: '确认删除', cls: 'btn-danger', onclick: 'confirmDeleteProjectType(\'' + escHtml(ptypeId) + '\')'}
  ], {hideClose: true});
}

async function confirmDeleteProjectType(ptypeId) {
  closeSharedDialog();
  try {
    await API.del('/doc-templates/project-types/' + encodeURIComponent(ptypeId));
    // Remove from local list
    _projectTypes = _projectTypes.filter(function(pt) { return pt.id !== ptypeId; });
    // Switch to first available type if current was deleted
    if (_currentProjectType === ptypeId) {
      _currentProjectType = _projectTypes.length ? _projectTypes[0].id : 'RD';
      await loadTemplatesForType(_currentProjectType);
    }
    showToast('项目类型已删除', 'success');
    renderTemplatesPage();
  } catch(e) {
    showToast('删除失败: ' + (e.message || ''), 'error');
  }
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
              description: docs[di].description || '', doc_path: docs[di].doc_path || '',
              base_path: docs[di].base_path || '', file_pattern: docs[di].file_pattern || '',
              doc_type: docs[di].doc_type || '', is_optional: docs[di].is_optional ? 1 : 0 });
          }
        }
      }
    }
  }

  var ops = _pendingOps.slice();
  var total = ops.length;
  var success = 0;
  var failedOps = [];

  for (var i = 0; i < ops.length; i++) {
    var op = ops[i];
    try {
      if (op.type === 'add') {
        await API.post('/doc-templates', { project_type: _currentProjectType, stage_type: op.stage_type, doc_name: op.doc_name, sort_order: op.sort_order, responsible_role: op.responsible_role || '', description: op.description || '', doc_path: op.doc_path || '', base_path: op.base_path || '', file_pattern: op.file_pattern || '', doc_type: op.doc_type || '', is_optional: op.is_optional || 0 });
        success++;
      } else if (op.type === 'edit') {
        await API.put('/doc-templates/' + op.id, { doc_name: op.doc_name, sort_order: op.sort_order, responsible_role: op.responsible_role || '', description: op.description || '', doc_path: op.doc_path || '', base_path: op.base_path || '', file_pattern: op.file_pattern || '', doc_type: op.doc_type || '', is_optional: op.is_optional || 0 });
        success++;
      } else if (op.type === 'delete') {
        await API.del('/doc-templates/' + op.id);
        success++;
      } else if (op.type === 'rename_stage') {
        await API.put('/doc-templates/stage-types/rename', { old_name: op.old_name, new_name: op.new_name });
        success++;
      } else if (op.type === 'delete_stage') {
        await API.del('/doc-templates/stage-types/' + encodeURIComponent(op.stage_type) + '?project_type=' + encodeURIComponent(_currentProjectType));
        success++;
      } else if (op.type === 'add_stage') {
        await API.post('/doc-templates/stage-types?stage_type=' + encodeURIComponent(op.stage_type) + '&project_type=' + encodeURIComponent(_currentProjectType), {});
        success++;
      } else if (op.type === 'reorder_stages') {
        await API.put('/doc-templates/stage-types/reorder', { project_type: _currentProjectType, stages: op.stages });
        success++;
      }
      // Remove successful op from pending
      _pendingOps = _pendingOps.filter(function(o) { return o !== op; });
    } catch(e) {
      failedOps.push({ op: op, error: e.message || '未知错误' });
    }
  }

  // Auto-sync to all projects after save
  if (success > 0) {
    try {
      var syncResult = await API.post('/doc-templates/sync-all');
      showToast('保存完成: ' + success + ' 成功, 同步 ' + syncResult.synced + '/' + syncResult.total + ' 个项目'
        + (failedOps.length > 0 ? ', ' + failedOps.length + ' 失败' : ''), failedOps.length > 0 ? 'error' : 'success');
    } catch(e) {
      showToast('保存完成但同步失败: ' + (e.message || ''), 'error');
    }
  }

  // Report failed ops
  if (failedOps.length > 0) {
    var failMsg = failedOps.map(function(f) {
      var desc = f.op.type;
      if (f.op.doc_name) desc += ': ' + f.op.doc_name;
      if (f.op.stage_type) desc += ' (' + f.op.stage_type + ')';
      return desc + ' — ' + f.error;
    }).join('\n');
    if (confirm('以下操作失败：\n\n' + failMsg + '\n\n是否重试失败的操作？')) {
      // Re-run failed ops
      for (var fi = 0; fi < failedOps.length; fi++) {
        _pendingOps.push(failedOps[fi].op);
      }
      await saveAllChanges();
      return;
    }
  }

  // Refresh cache from server
  try {
    var fresh = await API.get('/doc-templates?project_type=' + encodeURIComponent(_currentProjectType));
    if (fresh && Object.keys(fresh).length) _templatesGrouped = fresh;
  } catch(e) {}
  renderTemplatesPage();
}

function discardChanges() {
  if (!confirm('放弃所有未保存的更改？此操作不可撤销。')) return;
  _pendingOps = [];
  // Re-fetch from server for current project type
  API.get('/doc-templates?project_type=' + encodeURIComponent(_currentProjectType)).then(function(fresh) {
    if (fresh && Object.keys(fresh).length) {
      _templatesGrouped = fresh;
    }
    renderTemplatesPage();
  }).catch(function() {
    renderTemplatesPage();
  });
}

async function syncAllProjectsAndTasks() {
  if (!confirm('将当前模板配置（含重命名和顺序调整）应用到全部项目和产品？\n\n文档模板 → 全部项目\n任务模板 → 全部项目\n产品文档模板 → 全部产品\n\n此操作不可撤销，确认继续？')) return;
  var btn = event.target;
  btn.disabled = true; btn.textContent = '⏳ 同步中...';
  try {
    var [docResult, taskResult, prodResult] = await Promise.all([
      API.post('/doc-templates/sync-all'),
      API.post('/task-templates/sync-all'),
      API.post('/product-doc-templates/sync-all'),
    ]);
    var msg = '文档: ' + docResult.synced + '/' + docResult.total
      + ' | 任务: ' + taskResult.synced + '/' + taskResult.total
      + ' | 产品: ' + prodResult.synced + '/' + prodResult.total;
    showToast(msg, 'success');
  } catch(e) {
    showToast('同步失败: ' + (e.message || ''), 'error');
  }
  btn.disabled = false; btn.textContent = '↻ 应用到全部项目/产品';
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
var _selectedNodeId = _selectedNodeId || null;      // preserve preset from onclick before script load
var _productTemplates = [];      // doc templates for selected node (all stages)
var _productStage = '通用';       // currently selected stage filter
var _productPendingOps = [];     // pending operations queue (add/edit/delete/reorder)
var _productNextTempId = -1000;  // temp IDs for locally-added templates

var PRODUCT_STAGE_TYPES = ['硬件开发', '结构设计', 'BSP开发', '软件开发', '测试', '通用'];

var DOC_TYPES = [
  { key: 'gitlab', label: 'GitLab' },
  { key: 'svn', label: 'SVN' },
  { key: 'nas', label: 'NAS' },
  { key: 'solidworks', label: '结构设计' },
  { key: 'pma', label: 'PMA' },
];
var DOC_TYPE_LABELS = {};
DOC_TYPES.forEach(function(t) { DOC_TYPE_LABELS[t.key] = t.label; });

function _docTypeButtons(selected) {
  selected = selected || '';
  return DOC_TYPES.map(function(t) {
    var active = t.key === selected;
    return '<button class="btn doc-type-btn" style="font-size:11px;padding:4px 10px' +
      (active ? ';background:var(--accent);color:#fff' : '') +
      '" onclick="_selectDocType(\'' + t.key + '\',this)">' + t.label + '</button>';
  }).join('');
}

function _selectDocType(type, el) {
  var container = el.parentElement;
  if (!container) return;
  container.querySelectorAll('.doc-type-btn').forEach(function(btn) {
    btn.style.background = ''; btn.style.color = '';
  });
  el.style.background = 'var(--accent)'; el.style.color = '#fff';
  _applyDocTypePlaceholder(el.closest('.note-dialog'), type);
}

function _applyDocTypePlaceholder(dialog, type) {
  if (!dialog || !type) return;
  var hidden = dialog.querySelector('.doc-type-value');
  if (hidden) hidden.value = type;

  var isSolidworks = type === 'solidworks';

  // Update path label and hint
  var pathLabel = dialog.querySelector('.dt-path-label');
  var pathHint = dialog.querySelector('.dt-path-hint');
  if (pathLabel) {
    pathLabel.innerHTML = isSolidworks
      ? 'PDM 目录路径 <span style="color:var(--danger)">*必填</span>'
      : '路径 <span style="color:var(--danger)">*必填</span>';
  }
  if (pathHint) {
    pathHint.textContent = isSolidworks
      ? '{code} = 项目代号, * = 通配符, 如 PE0445*'
      : '{code} = 项目代号占位符';
  }

  // Update file pattern label and hint
  var fileLabel = dialog.querySelector('.dt-file-label');
  var fileHint = dialog.querySelector('.dt-file-hint');
  if (fileLabel) {
    fileLabel.innerHTML = isSolidworks
      ? '文件名模式 <span style="color:var(--danger)">*必填</span>'
      : '文档名 <span style="color:var(--danger)">*必填</span>';
  }
  if (fileHint) {
    fileHint.textContent = isSolidworks
      ? '{code} = 项目代号, *.pdf = 匹配所有PDF'
      : '{code} = 项目代号占位符';
  }

  // Update preview label
  var previewLabel = dialog.querySelector('.dt-preview-label');
  if (previewLabel) {
    previewLabel.innerHTML = isSolidworks
      ? 'PDM 完整路径预览 &nbsp;<span style="font-weight:400;font-size:10px">* 替换为项目代号</span>'
      : '最终路径预览 &nbsp;<span style="font-weight:400;font-size:10px">* 替换为项目代号</span>';
  }

  // Update placeholders
  var placeholders = {
    gitlab: 'GitLab 发布链接，如 http://192.168.0.128/.../-/releases/...',
    svn: 'SVN 地址，如 http://192.168.0.124:8443/svn/...',
    nas: 'NAS 路径，如 \\\\192.168.0.x\\share\\...',
    solidworks: 'http://192.168.0.191/SOLIDWORKSPDM/LM-PDM/1.结构项目/{code}*/3.项目输出/',
    pma: 'PMA 系统内部链接'
  };
  var pathInput = dialog.querySelector('input[id*="base-path"]');
  if (pathInput && placeholders[type]) {
    pathInput.placeholder = placeholders[type];
  }
  var fileInput = dialog.querySelector('input[id*="file-pattern"]');
  if (fileInput) {
    fileInput.placeholder = isSolidworks ? '*.pdf' : '01_{code}_SCH-FINAL.rar';
  }
}
var _dtBreadcrumbIds = [];       // cached breadcrumb node IDs for click nav

var TREE_ICONS = ['', '📁', '📂', '📄'];  // level 1/2/3 icons

async function initProductDocTemplates() {
  var container = document.getElementById('dtsec-product');
  container.innerHTML = '<div class="loading-spinner">加载产品文档模板...</div>';
  try {
    var tree = await API.get('/product-doc-templates/product-tree');
    _productTree = tree || [];
    // Select first L2 or L1 by default; if pre-selected, resolve to L2 ancestor
    if (!_selectedNodeId || !_findNodeById(_selectedNodeId)) {
      var firstL2 = _findFirstL2(_productTree);
      _selectedNodeId = firstL2 || (_productTree.length ? _productTree[0].id : null);
    } else {
      // If pre-selected node is L3 (product model), navigate to its L2 parent
      var sel = _findNodeById(_selectedNodeId);
      if (sel && sel.level === 3 && sel.parent_id) {
        _selectedNodeId = sel.parent_id;
      }
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
    saveBtnHtml = '<button class="btn btn-primary" style="font-size:11px;padding:3px 10px;padding-left:14px;padding-right:14px;margin-left:8px" onclick="saveProductChanges()">保存配置 (' + pendingCount + ')</button>' +
      '<button class="btn btn-sm" style="margin-left:4px;color:var(--warn);border-color:var(--warn)" onclick="discardProductChanges()">放弃</button>';
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
      '<button class="btn btn-primary" style="font-size:11px;padding:3px 10px" onclick="showAddProductTemplateForm()">+ 添加文档</button>' +
      '<button class="btn btn-sm" style="color:var(--accent);border-color:var(--accent)" onclick="showImportTemplatesDialog()">导入模板</button>' +
    '</span>';
  }
  rightHtml += '</div>';

  if (!selNode) {
    rightHtml += '<div class="empty-state" style="padding:20px">请从左侧选择产品节点</div>';
  } else if (isL1) {
    // L1 → show L2 list
    rightHtml += '<div class="section-hd"><div class="section-title">二级产品 · 产品系列 (' + children.length + ')</div></div>';
    if (children.length) {
      rightHtml += '<div id="tpl-l2-table"></div>';
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
      rightHtml += '<div id="tpl-prod-stage-docs"></div>';
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

  // Product stage docs DataTable (with drag-reorder)
  if (isL2 && _productStageDocs.length) {
    var typeLabels = DOC_TYPE_LABELS;
    var dtProdDocs = new DataTable({
      container: document.getElementById('tpl-prod-stage-docs'),
      columns: (function() {
        var cols = [
          { key: 'sort_order', title: '序号', render: function(v, row, idx) { return '<span data-drag-index="'+idx+'" style="font-family:var(--mono);color:var(--muted);cursor:grab" title="拖动排序">'+(v!=null?v:'—')+'</span>'; } },
          { key: 'doc_name', title: '文档名称', render: function(v) { return '<span style="font-weight:500">'+escHtml(v||'')+'</span>'; } },
          { key: 'responsible_role', title: '责任人', width: '80px', render: function(v) { return '<span style="font-size:12px;white-space:nowrap">'+escHtml(v||'—')+'</span>'; } },
          { key: 'doc_type', title: '类型', width: '60px', render: function(v) { return '<span style="font-size:11px">'+escHtml(typeLabels[v]||'—')+'</span>'; } },
          { key: 'doc_path', title: '路径', render: function(v) { return '<span style="font-size:12px">'+(v?'<a href="'+escHtml(v)+'" target="_blank" style="color:var(--accent);text-decoration:none" onmouseover="this.style.textDecoration=\'underline\'" onmouseout="this.style.textDecoration=\'none\'" title="点击打开路径">'+escHtml(v)+' ↗</a>':'—')+'</span>'; } },
          { key: 'description', title: '说明', render: function(v) { return '<span style="font-size:12px;color:var(--muted)">'+escHtml(v||'')+'</span>'; } }
        ];
        if (canEdit) cols.push({ key: 'actions', title: '操作', render: function(v, row) {
          return '<span style="white-space:nowrap;text-align:center"><span style="font-size:10px;color:'+(row.is_optional?'var(--accent)':'var(--muted)')+';cursor:pointer;margin-right:4px" onclick="event.stopPropagation();toggleProductDocOptional('+row.id+','+(row.is_optional?'1':'0')+')">'+(row.is_optional?'可选':'必选')+'</span>'+iconCopy('copyProductTemplate('+row.id+')')+iconEdit('showEditProductTemplateForm('+row.id+')')+iconDelete('deleteProductTemplate('+row.id+')')+'</span>';
        }});
        return cols;
      })(),
      data: _productStageDocs,
    });
    dtProdDocs.enableDragReorder(_productStageDocs, renderProductAfterReorder);
  }

  if (isL1 && children.length) {
    new DataTable({
      container: document.getElementById('tpl-l2-table'),
      columns: [
        { key: 'name', title: '产品系列名称', render: function(v, row) { return '<span style="cursor:pointer;font-weight:500" onclick="selectProductNode('+row.id+')">📂 '+escHtml(v||'')+'</span>'; } },
        { key: 'template_count', title: '模板数', width: '80px', render: function(v) { return '<span style="text-align:center">'+(v||0)+'</span>'; } }
      ],
      data: children,
    });
  }
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
  _updateDocTemplatesHash();
}

function _selectProductStage(stage) {
  _productStage = stage;
  renderProductTreePage();
  _updateDocTemplatesHash();
}

/* ── Product Template CRUD (direct API, no pending queue) ── */

function _updateProjPathPreview() {
  var baseEl = document.getElementById('dt-base-path');
  var patEl = document.getElementById('dt-file-pattern');
  var previewEl = document.getElementById('dt-path-preview');
  if (!previewEl) return;
  var base = baseEl ? baseEl.value.trim() : '';
  var pat = patEl ? patEl.value.trim() : '';
  if (!base && !pat) { previewEl.value = ''; return; }
  previewEl.value = (base + '/' + pat).replace(/([^:])\/{2,}/g, '$1/');
}

function _updatePathPreview() {
  var baseEl = document.getElementById('ptf-base-path');
  var patEl = document.getElementById('ptf-file-pattern');
  var previewEl = document.getElementById('ptf-path-preview');
  if (!previewEl) return;
  var base = baseEl ? baseEl.value.trim() : '';
  var pat = patEl ? patEl.value.trim() : '';
  if (!base && !pat) { previewEl.value = ''; return; }
  previewEl.value = (base + '/' + pat).replace(/([^:])\/{2,}/g, '$1/');
}

function showAddProductTemplateForm() {
  var selNode = _findNodeById(_selectedNodeId);
  var name = selNode ? selNode.name : '';
  var nextSort = _productStageDocs ? _productStageDocs.length + 1 : 1;
  _openDocDialog('添加文档模板 — ' + escHtml(name),
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
      '<div style="flex:1"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">责任人（岗位） <span style="color:var(--danger)">*必填</span></label>' + _roleSelect('') + '</div>' +
    '</div>' +
    '<input type="hidden" class="doc-type-value" id="ptf-doctype" value="gitlab">' +
    '<div style="margin-bottom:10px">' +
      '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:6px">文档类型 <span style="color:var(--danger)">*必填</span></label>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap" id="ptf-doctype-btns">' +
        _docTypeButtons('gitlab') +
      '</div>' +
    '</div>' +
    '<div style="margin-bottom:10px">' +
      '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">路径 <span style="color:var(--danger)">*必填</span> &nbsp;<span style="font-weight:400;font-size:10px">{code} = 产品代号占位符</span></label>' +
      '<input class="search-inp" id="ptf-base-path" placeholder="http://.../信号板/{code}/" style="width:100%;box-sizing:border-box;margin-bottom:8px" oninput="_updatePathPreview()">' +
    '</div>' +
    '<div style="margin-bottom:10px">' +
      '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">文档名 <span style="color:var(--danger)">*必填</span> &nbsp;<span style="font-weight:400;font-size:10px">{code} = 产品代号占位符</span></label>' +
      '<input class="search-inp" id="ptf-file-pattern" placeholder="01_{code}_SCH-FINAL.rar" style="width:100%;box-sizing:border-box" oninput="_updatePathPreview()">' +
    '</div>' +
    '<div style="margin-bottom:10px">' +
      '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">最终路径预览 &nbsp;<span style="font-weight:400;font-size:10px">* 替换为产品代号</span></label>' +
      '<input class="search-inp" id="ptf-path-preview" value="" style="width:100%;box-sizing:border-box;color:var(--accent);font-size:11px;font-family:var(--mono)" disabled>' +
    '</div>' +
    '<div style="margin-bottom:10px">' +
      '<label style="font-size:11px;color:var(--muted);display:flex;align-items:center;gap:6px;cursor:pointer">' +
        '<input type="checkbox" id="ptf-is-optional" style="width:16px;height:16px;cursor:pointer">' +
        '可选项（标记后，产品可按需删除该文档）' +
      '</label></div>' +
    '<div style="margin-bottom:4px">' +
      '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">说明（可选）</label>' +
      '<input class="search-inp" id="ptf-desc" style="width:100%;box-sizing:border-box">' +
    '</div>',
    [{text: '取消', cls: '', onclick: 'closeSharedDialog()'},
     {text: '确定', cls: 'btn-primary', onclick: 'saveProductTemplate()'}], {hideClose: true, maxWidth: 780}, 'gitlab');
  setTimeout(_updatePathPreview, 80);
}

function showEditProductTemplateForm(id) {
  var tpl = null;
  for (var i = 0; i < _productTemplates.length; i++) {
    if (_productTemplates[i].id === id) { tpl = _productTemplates[i]; break; }
  }
  if (!tpl) return;
  var tplStage = tpl.stage_type || '通用';
  // Fallback: if base_path/file_pattern empty but doc_path exists, parse doc_path
  var bp = tpl.base_path || '';
  var fp = tpl.file_pattern || '';
  if (!bp && !fp && tpl.doc_path) {
    var lastSlash = tpl.doc_path.lastIndexOf('/');
    if (lastSlash > 0) {
      bp = tpl.doc_path.substring(0, lastSlash + 1);
      fp = tpl.doc_path.substring(lastSlash + 1);
    }
  }
  _openDocDialog('编辑文档模板',
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
      '<div style="flex:1"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">责任人（岗位） <span style="color:var(--danger)">*必填</span></label>' + _roleSelect(tpl.responsible_role || '') + '</div>' +
    '</div>' +
    '<input type="hidden" class="doc-type-value" id="ptf-doctype" value="' + escHtml(tpl.doc_type || '') + '">' +
    '<div style="margin-bottom:10px">' +
      '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:6px">文档类型 <span style="color:var(--danger)">*必填</span></label>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap" id="ptf-doctype-btns">' +
        _docTypeButtons(tpl.doc_type || '') +
      '</div>' +
    '</div>' +
    '<div style="margin-bottom:10px">' +
      '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">路径 <span style="color:var(--danger)">*必填</span> &nbsp;<span style="font-weight:400;font-size:10px">{code} = 产品代号占位符，如 LNS677A-V010</span></label>' +
      '<input class="search-inp" id="ptf-base-path" value="' + escHtml(bp) + '" placeholder="http://.../信号板/{code}/" style="width:100%;box-sizing:border-box;margin-bottom:8px" oninput="_updatePathPreview()">' +
    '</div>' +
    '<div style="margin-bottom:10px">' +
      '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">文档名 <span style="color:var(--danger)">*必填</span> &nbsp;<span style="font-weight:400;font-size:10px">{code} = 产品代号占位符</span></label>' +
      '<input class="search-inp" id="ptf-file-pattern" value="' + escHtml(fp) + '" placeholder="01_{code}_SCH-FINAL.rar" style="width:100%;box-sizing:border-box" oninput="_updatePathPreview()">' +
    '</div>' +
    '<div style="margin-bottom:10px">' +
      '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">最终路径预览 &nbsp;<span style="font-weight:400;font-size:10px">* 替换为产品代号</span></label>' +
      '<input class="search-inp" id="ptf-path-preview" value="" style="width:100%;box-sizing:border-box;color:var(--accent);font-size:11px;font-family:var(--mono)" disabled>' +
    '</div>' +
    '<div style="margin-bottom:10px">' +
      '<label style="font-size:11px;color:var(--muted);display:flex;align-items:center;gap:6px;cursor:pointer">' +
        '<input type="checkbox" id="ptf-is-optional" style="width:16px;height:16px;cursor:pointer"' + (tpl.is_optional ? ' checked' : '') + '>' +
        '可选项（标记后，产品可按需删除该文档）' +
      '</label></div>' +
    '<div style="margin-bottom:4px">' +
      '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">说明（可选）</label>' +
      '<input class="search-inp" id="ptf-desc" value="' + escHtml(tpl.description || '') + '" style="width:100%;box-sizing:border-box">' +
    '</div>',
    [{text: '取消', cls: '', onclick: 'closeSharedDialog()'},
     {text: '确定', cls: 'btn-primary', onclick: 'saveProductTemplate(' + id + ')'}], {hideClose: true, maxWidth: 780}, tpl.doc_type || 'gitlab');
  setTimeout(_updatePathPreview, 80);
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
  var basePathEl = document.getElementById('ptf-base-path');
  var filePatEl = document.getElementById('ptf-file-pattern');
  var stageEl = document.getElementById('ptf-stage');

  if (!nameEl || !orderEl || !descEl || !basePathEl || !filePatEl) { showToast('表单数据异常，请重新打开对话框', 'error'); return; }

  var order = parseInt(orderEl.value) || 0;
  var desc = descEl.value.trim();
  var role = roleEl ? roleEl.value : '';
  var basePath = basePathEl.value.trim();
  var filePattern = filePatEl.value.trim();
  // Compute full doc_path for legacy compatibility
  var fullPath = basePath && filePattern ? basePath.replace(/\/*$/, '') + '/' + filePattern.replace(/^\/*/, '') : '';
  var stage = stageEl ? stageEl.value : (_productStage || '通用');
  var typeEl = document.getElementById('ptf-doctype');
  var docType = typeEl ? typeEl.value : '';
  var isOptEl = document.getElementById('ptf-is-optional');
  var isOptional = isOptEl && isOptEl.checked ? 1 : 0;
  if (!nameEl.value.trim()) { showToast('请输入文档名称', 'error'); return; }
  if (!basePath && !filePattern) { showToast('请填写路径或文档名', 'error'); return; }
  if (!docType) { showToast('请选择文档类型', 'error'); return; }
  if (!role) { showToast('请选择责任人', 'error'); return; }
  var name = nameEl.value.trim();

  var overlay = document.querySelector('.shared-dialog-overlay');
  if (overlay) overlay.remove();

  if (id && id > 0) {
    // Edit existing template
    var tpl = _productTemplates.find(function(x) { return x.id === id; });
    if (!tpl) { showToast('未找到该模板', 'error'); return; }
    tpl.doc_name = name; tpl.doc_path = fullPath; tpl.base_path = basePath; tpl.file_pattern = filePattern; tpl.doc_type = docType;
    tpl.sort_order = order; tpl.stage_type = stage; tpl.description = desc; tpl.responsible_role = role;
    tpl.is_optional = !!isOptional;
    _productPendingOps.push({ type: 'edit', id: id,
      doc_name: name, sort_order: order, stage_type: stage, responsible_role: role,
      description: desc, doc_path: fullPath, base_path: basePath, file_pattern: filePattern, doc_type: docType, is_optional: isOptional });
  } else if (id && id < 0) {
    var tpl2 = _productTemplates.find(function(x) { return x.id === id; });
    if (tpl2) {
      tpl2.doc_name = name; tpl2.doc_path = fullPath; tpl2.base_path = basePath; tpl2.file_pattern = filePattern; tpl2.doc_type = docType;
      tpl2.sort_order = order; tpl2.stage_type = stage; tpl2.description = desc; tpl2.responsible_role = role;
      tpl2.is_optional = !!isOptional;
    }
    for (var pi = 0; pi < _productPendingOps.length; pi++) {
      if (_productPendingOps[pi].tempId === id) {
        _productPendingOps[pi].doc_name = name; _productPendingOps[pi].doc_path = fullPath;
        _productPendingOps[pi].base_path = basePath; _productPendingOps[pi].file_pattern = filePattern;
        _productPendingOps[pi].doc_type = docType; _productPendingOps[pi].sort_order = order;
        _productPendingOps[pi].stage_type = stage; _productPendingOps[pi].responsible_role = role;
        _productPendingOps[pi].description = desc;
        _productPendingOps[pi].is_optional = isOptional;
        break;
      }
    }
  } else {
    var tempId = _productNextTempId--;
    var newDoc = { id: tempId, doc_name: name, sort_order: order,
      stage_type: stage, responsible_role: role, description: desc,
      doc_path: fullPath, base_path: basePath, file_pattern: filePattern, doc_type: docType, is_optional: !!isOptional };
    _productTemplates.push(newDoc);
    _productPendingOps.push({ type: 'add', tempId: tempId,
      doc_name: name, sort_order: order, stage_type: stage, responsible_role: role,
      description: desc, doc_path: fullPath, base_path: basePath, file_pattern: filePattern, doc_type: docType, is_optional: isOptional });
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
    doc_path: tpl.doc_path || '',
    doc_type: tpl.doc_type || '',
    is_optional: tpl.is_optional || false
  };
  _productTemplates.push(newDoc);
  _productPendingOps.push({ type: 'add', tempId: tempId,
    doc_name: newDoc.doc_name, sort_order: newDoc.sort_order,
    stage_type: newDoc.stage_type, doc_type: newDoc.doc_type,
    responsible_role: newDoc.responsible_role,
    description: newDoc.description, doc_path: newDoc.doc_path,
    is_optional: newDoc.is_optional });
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
              stage_type: docs[di].stage_type || '通用', doc_type: docs[di].doc_type || '',
              responsible_role: docs[di].responsible_role || '',
              description: docs[di].description || '',
              doc_path: docs[di].doc_path || '', base_path: docs[di].base_path || '',
              file_pattern: docs[di].file_pattern || '' });
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
        await API.post('/product-doc-templates', { product_id: _selectedNodeId, doc_name: op.doc_name, sort_order: op.sort_order, stage_type: op.stage_type || '通用', doc_type: op.doc_type || '', responsible_role: op.responsible_role || '', description: op.description || '', doc_path: op.doc_path || '', base_path: op.base_path || '', file_pattern: op.file_pattern || '', is_optional: op.is_optional || 0 });
        success++;
      } else if (op.type === 'edit') {
        await API.put('/product-doc-templates/' + op.id, { doc_name: op.doc_name, sort_order: op.sort_order, stage_type: op.stage_type || '通用', doc_type: op.doc_type || '', responsible_role: op.responsible_role || '', description: op.description || '', doc_path: op.doc_path || '', base_path: op.base_path || '', file_pattern: op.file_pattern || '', is_optional: op.is_optional || 0 });
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
    return '<div class="searchable-item" data-search-text="' + escHtml(n.name).toLowerCase() + '" style="padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border)" onclick="selectImportSource(' + n.id + ', \'' + escHtml(n.name).replace(/'/g, "\\'") + '\', this)">' +
      '<span style="font-weight:500">' + escHtml(n.name) + '</span>' +
      '<span style="font-size:11px;color:var(--muted);margin-left:8px">（' + n.template_count + ' 个模板）</span>' +
    '</div>';
  }).join('');

  var html =
    '<div style="margin-bottom:12px">' +
      '<div style="font-size:11px;color:var(--muted);margin-bottom:6px">目标节点：<span style="color:var(--accent);font-weight:500">' + escHtml(currentName) + '</span></div>' +
      '<div style="font-size:11px;color:var(--muted);margin-bottom:8px">选择源节点，将其文档模板覆盖到当前节点。目标节点现有模板将被全部清除后替换。</div>' +
      '<input class="search-inp" placeholder="搜索节点..." oninput="var q=this.value.toLowerCase();document.querySelectorAll(\'#import-src-list .searchable-item\').forEach(function(el){el.style.display=q?(el.getAttribute(\'data-search-text\').indexOf(q)>=0?\'\':\'none\'):\'\'})" style="margin-bottom:4px">' +
      '<div style="max-height:260px;overflow-y:auto;border:1px solid var(--border);border-radius:6px" id="import-src-list">' + listHtml + '</div>' +
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
    (canEdit ? '<button class="btn btn-primary" style="font-size:11px;padding:3px 10px" onclick="showAddTagDialog()">+ 添加标签</button>' : '') +
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

/* ── Product Naming Convention ── */

var _namingFieldLabels = {series:'系列', fpga:'FPGA', cpu:'CPU', adc:'ADC', form:'形态'};
var _namingCurrentData = null;

async function initNamingOptions() {
  var container = document.getElementById('dtsec-naming');
  container.innerHTML = '<div class="loading-spinner">加载中...</div>';
  try {
    var data = await API.get('/product-doc-templates/naming-options');
    _namingCurrentData = data;
    var fields = ['series', 'fpga', 'cpu', 'adc', 'form'];
    var html = '<div style="max-width:900px">';
    fields.forEach(function(fk) {
      var opts = (data[fk] || []).sort(function(a, b) { return a.code < b.code ? -1 : a.code > b.code ? 1 : 0; });
      html += '<div class="card" style="padding:14px 18px;margin-bottom:12px">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">' +
          '<span style="font-weight:600;font-size:13px">' + escHtml(_namingFieldLabels[fk] || fk) + '</span>' +
          '<button class="btn btn-sm btn-primary" onclick="_namingShowAdd(\'' + fk + '\')">+ 添加</button>' +
        '</div>' +
        '<div id="naming-table-' + fk + '"></div></div>';
    });
    html += '</div>';
    container.innerHTML = html;
    // Build DataTables for each field
    fields.forEach(function(fk) {
      var opts = (data[fk] || []).sort(function(a, b) { return a.code < b.code ? -1 : a.code > b.code ? 1 : 0; });
      if (!opts.length) return;
      new DataTable({
        container: document.getElementById('naming-table-' + fk),
        columns: [
          { key: 'code', title: '编号', render: function(v) { return '<span style="font-family:var(--mono);font-weight:600">'+escHtml(v||'')+'</span>'; } },
          { key: 'description', title: '描述', render: function(v) { return escHtml(v||''); } },
          { key: 'actions', title: '操作', render: function(v, row) { return iconEdit('_namingShowEdit('+row.id+',\''+fk+'\',\''+escHtml(row.code||'').replace(/'/g,"\\'")+'\',\''+escHtml(row.description||'').replace(/'/g,"\\'")+'\')','编辑')+iconDelete('_namingDelete('+row.id+',\''+fk+'\')','删除'); } }
        ],
        data: opts,
      });
    });
  } catch(e) {
    container.innerHTML = '<div class="error-state">加载失败: ' + escHtml(e.message) + '</div>';
  }
}

function _namingShowAdd(fk) {
  var label = _namingFieldLabels[fk] || fk;
  var codeOpts = _namingGetAvailableCodes(fk, '');
  var body = '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">编号 * <span style="font-weight:400">(0-9, A-Z，不可重复)</span></label>' +
    '<select class="search-inp" id="nm-code" style="width:100%;box-sizing:border-box;margin-top:3px;font-family:var(--mono)">' +
    '<option value="">选择编号...</option>' + codeOpts + '</select></div>' +
    '<div><label style="font-size:11px;color:var(--muted)">描述 *</label>' +
    '<input class="search-inp" id="nm-desc" style="width:100%;box-sizing:border-box;margin-top:3px"></div>';
  openDialog('添加' + label + '选项', body, [
    {text: '取消', onclick: 'closeSharedDialog()'},
    {text: '添加', cls: 'btn-primary', onclick: "_namingSave(0,'" + fk + "')"}
  ]);
}

function _namingShowEdit(id, fk, code, desc) {
  var label = _namingFieldLabels[fk] || fk;
  var codeOpts = _namingGetAvailableCodes(fk, code);
  var body = '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">编号 * <span style="font-weight:400">(0-9, A-Z)</span></label>' +
    '<select class="search-inp" id="nm-code" style="width:100%;box-sizing:border-box;margin-top:3px;font-family:var(--mono)">' +
    codeOpts.replace('value="' + code + '"', 'value="' + code + '" selected') + '</select></div>' +
    '<div><label style="font-size:11px;color:var(--muted)">描述 *</label>' +
    '<input class="search-inp" id="nm-desc" value="' + escHtml(desc) + '" style="width:100%;box-sizing:border-box;margin-top:3px"></div>';
  openDialog('编辑' + label + '选项', body, [
    {text: '取消', onclick: 'closeSharedDialog()'},
    {text: '保存', cls: 'btn-primary', onclick: "_namingSave(" + id + ",'" + fk + "')"}
  ]);
}

function _namingGetAvailableCodes(fk, currentCode) {
  // Build list of 0-9, A-Z minus already-used codes (except currentCode for edit)
  var allCodes = [];
  for (var i = 0; i <= 9; i++) allCodes.push(String(i));
  for (var c = 65; c <= 90; c++) allCodes.push(String.fromCharCode(c));
  var used = {};
  var data = _namingCurrentData;
  if (data && data[fk]) {
    data[fk].forEach(function(o) {
      if (o.code !== currentCode) used[o.code] = true;
    });
  }
  return allCodes.filter(function(c) { return !used[c]; }).map(function(c) {
    return '<option value="' + c + '">' + c + '</option>';
  }).join('');
}

async function _namingSave(id, fk) {
  var code = document.getElementById('nm-code').value.trim();
  var desc = document.getElementById('nm-desc').value.trim();
  if (!code || !desc) { showToast('编号和描述不能为空', 'error'); return; }
  try {
    if (id) {
      await API.put('/product-doc-templates/naming-options/' + id, {code: code, description: desc});
    } else {
      await API.post('/product-doc-templates/naming-options', {field_key: fk, code: code, description: desc});
    }
    closeSharedDialog();
    initNamingOptions();
  } catch(e) {
    showToast('保存失败: ' + (e.message || ''), 'error');
  }
}

async function _namingDelete(id, fk) {
  if (!confirm('确定删除此选项？')) return;
  try {
    await API.del('/product-doc-templates/naming-options/' + id);
    initNamingOptions();
  } catch(e) {
    showToast('删除失败: ' + (e.message || ''), 'error');
  }
}

/* ── Bug Templates Tab ── */

async function initBugTemplates() {
  var c = document.getElementById('dtsec-bugtpl');
  c.innerHTML = '<div class="loading-spinner">加载中...</div>';
  try {
    var data = await API.get('/product-doc-templates/bug-templates');
    var tpls = data || [];
    var html = '<div style="max-width:800px">' +
      '<div style="display:flex;justify-content:flex-end;margin-bottom:10px">' +
        '<button class="btn btn-primary" style="font-size:11px;padding:3px 10px" onclick="_bugTplShowEdit(0)">+ 添加模板</button>' +
      '</div>';
    if (!tpls.length) { html += '<div class="empty-state">暂无模板</div>'; }
    else { html += '<div id="bug-tpl-table"></div>'; }
    html += '</div>';
    c.innerHTML = html;

    if (tpls.length) {
      new DataTable({
        container: document.getElementById('bug-tpl-table'),
        columns: [
          { key: 'name', title: '名称', render: function(v, row) { return '<span style="font-weight:500">'+escHtml(v||'')+'</span>'+(row.is_default?' <span style="font-size:9px;color:var(--accent);background:var(--accent-lt);padding:1px 4px;border-radius:3px">默认</span>':''); } },
          { key: 'content', title: '内容预览', render: function(v) { return '<span style="font-size:11px;color:var(--muted);max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escHtml((v||'').substring(0,80))+'</span>'; } },
          { key: 'actions', title: '操作', render: function(v, row) { return (row.is_default?'':iconBtn('⭐','设为默认','_bugTplSetDefault('+row.id+')'))+iconEdit('_bugTplShowEdit('+row.id+')','编辑')+iconDelete('_bugTplDelete('+row.id+')','删除'); } }
        ],
        data: tpls,
      });
    }
  } catch(e) { c.innerHTML = '<div class="error-state">加载失败: '+escHtml(e.message)+'</div>'; }
}

function _bugTplShowEdit(id) {
  var defaultContent = '## 问题描述\n\n请简要描述遇到的问题。\n\n## 复现步骤\n\n1. \n2. \n3. \n\n## 期望行为\n\n应该发生什么。\n\n## 实际行为\n\n实际发生了什么。\n\n## 环境信息\n\n- 版本: \n- 硬件: \n- 浏览器: \n\n## 附件/截图\n\n';
  var t = id ? _bugTplFind(id) : null;
  var body = '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">模板名称 *</label>' +
    '<input class="search-inp" id="bt-name" value="'+escHtml(t?t.name:'')+'" style="width:100%;box-sizing:border-box;margin-top:3px"></div>' +
    '<div><label style="font-size:11px;color:var(--muted)">内容（Markdown）</label>' +
    '<textarea class="search-inp" id="bt-content" rows="12" style="width:100%;box-sizing:border-box;margin-top:3px;resize:vertical;font-family:var(--mono);font-size:12px">'+escHtml(t?t.content:defaultContent)+'</textarea></div>';
  openDialog((id?'编辑':'添加')+' Bug提交模板', body, [
    {text:'取消',onclick:'closeSharedDialog()'},
    {text:'保存',cls:'btn-primary',onclick:'_bugTplSave('+(id||0)+')'}
  ], {maxWidth:560});
}

function _bugTplFind(id) {
  var el = document.querySelector('#dtsec-bugtpl');
  return null; // We'll re-fetch
}

async function _bugTplSave(id) {
  var name = document.getElementById('bt-name').value.trim();
  var content = document.getElementById('bt-content').value;
  if (!name) { showToast('请输入模板名称','error'); return; }
  try {
    if (id) await API.put('/product-doc-templates/bug-templates/'+id, {name:name, content:content});
    else await API.post('/product-doc-templates/bug-templates', {name:name, content:content});
    closeSharedDialog(); initBugTemplates();
  } catch(e) { showToast('保存失败: '+(e.message||''),'error'); }
}

async function _bugTplSetDefault(id) {
  try { await API.put('/product-doc-templates/bug-templates/'+id, {is_default: 1}); initBugTemplates(); }
  catch(e) { showToast('设置失败: '+(e.message||''),'error'); }
}

async function _bugTplDelete(id) {
  if (!confirm('确定删除此模板？')) return;
  try { await API.del('/product-doc-templates/bug-templates/'+id); initBugTemplates(); }
  catch(e) { showToast('删除失败: '+(e.message||''),'error'); }
}
