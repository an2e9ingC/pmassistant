/* ═══════════════════════════════════════════════════
   PRODUCT MANAGEMENT PAGE
   Left: 2-level product nav (产品线 → 产品系列)
   Right: Next-level items + contextual actions
═══════════════════════════════════════════════════ */

var _pmTree = [];              // [{id, name, parent_id, level, product_count, project_count, children}]
var _pmSelectedNodeId = _pmSelectedNodeId || null;  // preserve preset from onclick before script load
var _pmNodeProducts = [];      // products linked to selected node (for L2 → products)
var _pmNodeChildren = [];      // child nodes of selected node (for L1 → L2 list)
var _pmNodeTemplates = [];     // doc templates for selected node
var _pmAllProducts = [];       // all products (for dropdowns)
var _pmAllProjects = [];       // all projects (for dropdowns)
var _pmIsAdmin = false;

var PM_TREE_ICONS = ['', '📁', '📂', '📄'];

/* ── Init ── */

async function initProductManagement(nodeId) {
  if (nodeId) _pmSelectedNodeId = parseInt(nodeId);
  var user = getCurrentUser();
  var perms = (user && user.permissions) ? user.permissions.split(',') : [];
  _pmIsAdmin = user && (user.role === 'admin' || perms.indexOf('admin') >= 0 || perms.indexOf('product_link') >= 0);

  var container = document.getElementById('view-product-management');
  container.innerHTML = '<div class="loading-spinner">加载产品管理...</div>';

  try {
    var treeData = await API.get('/product-management/tree');
    _pmTree = treeData || [];

    try { _pmAllProducts = (await API.get('/product-management/all-products')) || []; } catch (e) { _pmAllProducts = []; }
    try { _pmAllProjects = (await API.get('/product-management/all-projects')) || []; } catch (e) { _pmAllProjects = []; }

    // Select first L2 or L1 by default; if pre-selected, resolve to L2 ancestor
    if (!_pmSelectedNodeId || !_pmFindNodeById(_pmSelectedNodeId)) {
      var firstL2 = _pmFindFirstL2(_pmTree);
      _pmSelectedNodeId = firstL2 || (_pmTree.length ? _pmTree[0].id : null);
    } else {
      // If pre-selected node is L3 (product model), navigate to its L2 parent
      var sel = _pmFindNodeById(_pmSelectedNodeId);
      if (sel && sel.level === 3 && sel.parent_id) {
        _pmSelectedNodeId = sel.parent_id;
      }
    }
    await _pmLoadContent();
    renderProductManagementPage();
    _resizePMTable();
  } catch (e) {
    container.innerHTML = '<div class="error-state">加载失败: ' + escHtml(e.message) +
      '<br><button class="btn" onclick="initProductManagement()">重试</button></div>';
  }
}

function _pmFindFirstL2(nodes) {
  for (var i = 0; i < nodes.length; i++) {
    if (nodes[i].children && nodes[i].children.length) return nodes[i].children[0].id;
  }
  return null;
}

/* ── Tree Helpers ── */

function _pmFindNodeById(id) {
  return _pmFindInTree(_pmTree, id);
}

function _pmFindInTree(nodes, id) {
  for (var i = 0; i < nodes.length; i++) {
    if (nodes[i].id === id) return nodes[i];
    if (nodes[i].children && nodes[i].children.length) {
      var found = _pmFindInTree(nodes[i].children, id);
      if (found) return found;
    }
  }
  return null;
}

function _pmGetBreadcrumb(nodeId) {
  var node = _pmFindNodeById(nodeId);
  if (!node) return [];
  var path = [node.name];
  var ids = [node.id];
  var parentId = node.parent_id;
  while (parentId) {
    var p = _pmFindNodeById(parentId);
    if (!p) break;
    path.unshift(p.name);
    ids.unshift(p.id);
    parentId = p.parent_id;
  }
  // Cache ids for breadcrumb click navigation
  _pmBreadcrumbIds = ids;
  return path;
}

var _pmBreadcrumbIds = [];
function _pmGetBreadcrumbNodeId(index) {
  return _pmBreadcrumbIds[index] || null;
}

/* ── Load Content ── */

async function _pmLoadContent() {
  var selNode = _pmFindNodeById(_pmSelectedNodeId);
  if (!selNode) { _pmNodeProducts = []; _pmNodeChildren = []; _pmNodeTemplates = []; return; }

  // Child nodes (L2 children for L1, L3 children for L2)
  _pmNodeChildren = (selNode.children || []).slice();

  // Products linked to this node
  try {
    _pmNodeProducts = (await API.get('/product-management/nodes/' + _pmSelectedNodeId + '/products')) || [];
  } catch (e) {
    _pmNodeProducts = [];
  }

  // Doc templates for this node (L2 only)
  if (selNode.level === 2) {
    try {
      _pmNodeTemplates = (await API.get('/product-doc-templates/templates/' + _pmSelectedNodeId)) || [];
    } catch (e) {
      _pmNodeTemplates = [];
    }
  } else {
    _pmNodeTemplates = [];
  }
}

/* ── Main Render ── */

function renderProductManagementPage() {
  var selNode = _pmFindNodeById(_pmSelectedNodeId);
  var isL1 = selNode && selNode.level === 1;
  var isL2 = selNode && selNode.level === 2;

  // Left panel: 2-level nav
  var leftHtml = '<div class="section-title" style="margin-bottom:10px">产品导航</div>';
  _pmTree.forEach(function (l1, li) {
    leftHtml += _pmRenderL1Node(l1, li);
  });
  // Drag hint
  if (_pmIsAdmin) {
    leftHtml += '<div style="font-size:10.5px;color:var(--muted);padding:4px 4px">💡 拖动节点可调整顺序</div>';
  }
  // Add product line button at bottom
  if (_pmIsAdmin) {
    leftHtml += '<div class="dt-tree-node" style="cursor:pointer;color:var(--accent);font-weight:500;padding:6px 12px" onclick="_pmShowAddProductLineDialog()">' +
      '<span style="width:16px;flex-shrink:0"></span>' +
      '<span class="dt-tree-icon">➕</span>' +
      '<span class="dt-tree-label">新增一级产品线</span>' +
    '</div>';
  }

  // Breadcrumb
  var crumbs = selNode ? _pmGetBreadcrumb(_pmSelectedNodeId) : [];
  var titleHtml = crumbs.length
    ? crumbs.map(function(c, i) {
        var nodeId = _pmGetBreadcrumbNodeId(i);
        if (i < crumbs.length - 1 && nodeId) {
          return '<a href="javascript:void(0)" onclick="_pmSelectNode(' + nodeId + ')" style="color:var(--accent);text-decoration:none" onmouseover="this.style.textDecoration=\'underline\'" onmouseout="this.style.textDecoration=\'none\'">' + escHtml(c) + '</a>';
        }
        return escHtml(c);
      }).join(' <span style="color:var(--muted);font-weight:300">›</span> ')
    : '选择产品节点';

  // Right panel
  var rightHtml = '<div class="dt-right">';
  rightHtml += '<div class="dt-right-head">';
  rightHtml += '<div class="section-title">' + titleHtml;
  if (selNode && isL1) {
    rightHtml += ' <span class="pm-src-badge synced" style="font-size:11px;vertical-align:middle">' + _pmNodeChildren.length + ' 个系列</span>';
  } else if (selNode && isL2) {
    rightHtml += ' <span class="pm-src-badge synced" style="font-size:11px;vertical-align:middle">' + _pmNodeProducts.length + ' 个产品</span>';
  }
  rightHtml += '</div>';
  rightHtml += '</div>';

  if (!selNode) {
    rightHtml += '<div class="empty-state" style="padding:20px">请从左侧选择产品节点</div>';
  } else if (isL1) {
    // L1 selected → Show L2 (产品系列) list
    if (_pmNodeChildren.length) {
      rightHtml += '<div class="table-scroll" id="pm-l1-table"><table class="stage-table"><thead><tr>' +
        '<th>产品系列名称</th><th>型号数</th>' +
        (_pmIsAdmin ? '<th style="width:80px">操作</th>' : '') +
        '</tr></thead><tbody>';
      _pmNodeChildren.forEach(function (l2) {
        var modelCount = (l2.children || []).length;
        rightHtml += '<tr style="cursor:pointer" onclick="_pmSelectNode(' + l2.id + ')">' +
          '<td style="font-weight:500">📂 ' + escHtml(l2.name) + '</td>' +
          '<td style="text-align:center">' + modelCount + '</td>' +
          (_pmIsAdmin ? '<td style="white-space:nowrap;text-align:center">' +
            iconEdit('event.stopPropagation();_pmShowRenameNodeDialog(' + l2.id + ')', '重命名') +
            iconDelete('event.stopPropagation();_pmDeleteNode(' + l2.id + ')', '删除') +
          '</td>' : '') +
        '</tr>';
      });
      rightHtml += '</tbody></table></div>';
    } else {
      rightHtml += '<div class="empty-state" style="padding:16px;font-size:13px">暂无二级产品（产品系列）</div>';
    }
    if (_pmIsAdmin) {
      rightHtml += '<div style="padding:10px 0">' +
        '<button class="btn btn-primary" style="font-size:12px;padding:5px 14px" onclick="_pmShowAddChildDialog(' + _pmSelectedNodeId + ', 2)">+ 添加二级产品</button>' +
      '</div>';
    }
  } else if (isL2) {
    // L2 selected → Show products linked to this L2 node

    // Doc templates quick view
    if (_pmNodeTemplates && _pmNodeTemplates.length) {
      var templateStages = {};
      _pmNodeTemplates.forEach(function(t) { var s = t.stage_type || '通用'; templateStages[s] = (templateStages[s] || 0) + 1; });
      var templateParts = [];
      ['硬件开发', '结构设计', 'BSP开发', '软件开发', '测试', '通用'].forEach(function(st) {
        if (templateStages[st]) templateParts.push(st + templateStages[st] + '个');
      });
      rightHtml += '<div style="font-size:11px;color:var(--muted);margin-bottom:4px">文档模板：' +
        templateParts.join('、') + '　' +
        '<a href="javascript:void(0)" onclick="gotoView(\'doc-templates\',{params:[\'product\',String(' + _pmSelectedNodeId + ')]})" style="color:var(--accent);font-size:11px;text-decoration:none">查看详情 →</a>' +
      '</div>';
    }

    rightHtml += '<div style="display:flex;gap:6px;margin-bottom:12px">';
    if (_pmIsAdmin) {
      rightHtml += '<button class="btn btn-primary" style="font-size:11px;padding:5px 12px" onclick="_pmShowNamingProductDialog()">+ 添加三级产品</button>';
      rightHtml += '<button class="btn" style="font-size:11px;padding:5px 12px" onclick="_pmShowCreateProductDialog()">+ 添加三级产品(Old)</button>';
      rightHtml += '<button class="btn btn-primary" style="font-size:11px;padding:5px 12px" onclick="_pmShowLinkProductDialog()">+ 关联已有三级产品</button>';
    }
    rightHtml += '</div>';
    if (_pmNodeProducts.length) {
      rightHtml += '<div class="table-scroll" id="pm-l2-table"><table class="stage-table"><thead><tr>' +
        '<th>编号</th><th>产品名</th><th>状态</th><th>关联项目数</th><th>来源</th>' +
        (_pmIsAdmin ? '<th style="width:120px">操作</th>' : '') +
        '</tr></thead><tbody>';
      _pmNodeProducts.forEach(function (p) {
        rightHtml += '<tr>' +
          '<td><span class="pm-src-badge synced" style="cursor:pointer;font-family:var(--mono);font-size:11px" onclick="event.stopPropagation();openProductDetail(\'' + escHtml(p.code || '') + '\')" title="查看产品详情">' + escHtml(p.code || '#' + p.id) + '</span></td>' +
          '<td style="font-weight:500;cursor:pointer" onclick="openProductDetail(\'' + escHtml(p.code || '') + '\')">' + escHtml(p.name) + '</td>' +
          '<td>' + renderPill(p.status) + '</td>' +
          '<td style="text-align:center">' + (p.project_count || 0) + '</td>' +
          '<td>' + (p.is_local ? '<span class="pm-src-badge local">PMA本地</span>' : (p.synced_at ? '<span class="pm-src-badge synced" title="同步于 ' + escHtml(p.synced_at) + '">禅道同步</span>' : '<span class="pm-src-badge unknown">未知</span>')) + '</td>' +
          (_pmIsAdmin ? '<td style="white-space:nowrap;text-align:center">' +
            iconLink('_pmShowManageProductProjects(\'' + escHtml(p.code || '').replace(/'/g, "\\'") + '\',\'' + escHtml(p.name).replace(/'/g, "\\'") + '\')', '关联项目') +
            iconEdit('_pmShowEditProductDialog(\'' + escHtml(p.code || '').replace(/'/g, "\\'") + '\',\'' + escHtml(p.name).replace(/'/g, "\\'") + '\',\'' + escHtml(p.code || '').replace(/'/g, "\\'") + '\')', '编辑产品') +
            iconDelete('_pmDeleteProduct(\'' + escHtml(p.code || '').replace(/'/g, "\\'") + '\',\'' + escHtml(p.name).replace(/'/g, "\\'") + '\')', '删除产品') +
          '</td>' : '') +
        '</tr>';
      });
      rightHtml += '</tbody></table></div>';
    } else {
      rightHtml += '<div class="empty-state" style="padding:16px;font-size:13px">该产品系列下暂无产品型号</div>';
    }

  }


  rightHtml += '</div>'; // .dt-right

  document.getElementById('view-product-management').innerHTML =
    '<div class="dt-layout">' +
      '<div class="dt-left">' + leftHtml + '</div>' +
      rightHtml +
    '</div>';
}

/* ── Left Nav Rendering (2 levels only) ── */

function _pmRenderL1Node(l1, index) {
  var isSelected = l1.id === _pmSelectedNodeId;
  var hasChildren = l1.children && l1.children.length > 0;

  var html = '<div class="dt-tree-node' + (isSelected ? ' selected' : '') +
    '" data-pm-node-id="' + l1.id + '" data-pm-node-level="1" data-pm-index="' + index + '"' +
    (_pmIsAdmin ? ' draggable="true"' +
    ' ondragstart="_pmTreeDragStart(event,' + l1.id + ',1)"' +
    ' ondragover="_pmTreeDragOver(event)"' +
    ' ondragleave="_pmTreeDragLeave(event)"' +
    ' ondrop="_pmTreeDrop(event,' + l1.id + ',1)"' : '') +
    ' style="padding-left:4px;' + (_pmIsAdmin ? 'cursor:grab' : '') + '" onclick="_pmSelectNode(' + l1.id + ')">';

  html += '<span style="width:16px;flex-shrink:0"></span>';
  html += '<span class="dt-tree-icon">📁</span>';
  html += '<span class="dt-tree-label">' + escHtml(l1.name) + '</span>';
  if (_pmIsAdmin) {
    html += '<span class="dt-tree-acts">' +
      iconEdit('event.stopPropagation();_pmShowRenameNodeDialog(' + l1.id + ')', '重命名') +
      iconDelete('event.stopPropagation();_pmDeleteNode(' + l1.id + ')', '删除') +
    '</span>';
  }
  html += '</div>';

  // Show L2 children (always visible, indented)
  if (hasChildren) {
    l1.children.forEach(function (l2) {
      var l2Selected = l2.id === _pmSelectedNodeId;
      html += '<div class="dt-tree-node' + (l2Selected ? ' selected' : '') +
        '" data-pm-node-id="' + l2.id + '" data-pm-node-level="2"' +
        (_pmIsAdmin ? ' draggable="true"' +
        ' ondragstart="_pmTreeDragStart(event,' + l2.id + ',2)"' +
        ' ondragover="_pmTreeDragOver(event)"' +
        ' ondragleave="_pmTreeDragLeave(event)"' +
        ' ondrop="_pmTreeDrop(event,' + l2.id + ',2)"' : '') +
        ' style="padding-left:24px;' + (_pmIsAdmin ? 'cursor:grab' : '') + '" onclick="_pmSelectNode(' + l2.id + ')">';
      html += '<span style="width:16px;flex-shrink:0"></span>';
      html += '<span class="dt-tree-icon">📂</span>';
      html += '<span class="dt-tree-label">' + escHtml(l2.name) + '</span>';
      var prodCount = l2.product_count || 0;
      if (prodCount) {
        html += '<span class="dt-tree-badge" style="background:var(--accent-lt);color:var(--accent)">' + prodCount + '</span>';
      }
      if (_pmIsAdmin) {
        html += '<span class="dt-tree-acts">' +
          iconBtn('✎', '重命名', 'event.stopPropagation();_pmShowRenameNodeDialog(' + l2.id + ')') +
          iconBtn('✕', '删除', 'event.stopPropagation();_pmDeleteNode(' + l2.id + ')', true) +
        '</span>';
      }
      html += '</div>';
    });
  }

  return html;
}

/* ── Tree Drag-and-Drop Reorder ── */

var _pmDragNodeId = null;
var _pmDragLevel = null;

function _pmTreeDragStart(e, nodeId, level) {
  _pmDragNodeId = nodeId;
  _pmDragLevel = level;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', '');
  e.stopPropagation();
}

function _pmTreeDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  var target = e.currentTarget;
  if (target) target.classList.add('dt-drag-over');
}

function _pmTreeDragLeave(e) {
  e.currentTarget.classList.remove('dt-drag-over');
}

async function _pmTreeDrop(e, targetNodeId, targetLevel) {
  e.preventDefault();
  e.stopPropagation();
  document.querySelectorAll('.dt-drag-over').forEach(function(el) { el.classList.remove('dt-drag-over'); });

  if (!_pmDragNodeId || _pmDragNodeId === targetNodeId) return;
  if (_pmDragLevel !== targetLevel) return; // Only reorder within same level

  // Find the dragged node
  var draggedNode = _pmFindNodeById(_pmDragNodeId);
  var targetNode = _pmFindNodeById(targetNodeId);
  if (!draggedNode || !targetNode) return;

  // Determine parent and sibling list
  var siblings;
  if (_pmDragLevel === 1) {
    siblings = _pmTree;
  } else {
    var parent = _pmFindNodeById(draggedNode.parent_id);
    if (!parent || !parent.children) return;
    siblings = parent.children;
  }

  // Reorder: find target index
  var targetIdx = -1;
  for (var i = 0; i < siblings.length; i++) {
    if (siblings[i].id === targetNodeId) { targetIdx = i; break; }
  }
  if (targetIdx < 0) return;

  // Remove dragged from old position
  var draggedIdx = -1;
  for (var j = 0; j < siblings.length; j++) {
    if (siblings[j].id === _pmDragNodeId) { draggedIdx = j; break; }
  }
  if (draggedIdx < 0) return;
  var moved = siblings.splice(draggedIdx, 1)[0];
  siblings.splice(targetIdx, 0, moved);

  // Update sort_order for all siblings
  for (var k = 0; k < siblings.length; k++) {
    siblings[k].sort_order = k + 1;
    // Save to backend
    try {
      await API.put('/product-doc-templates/product-nodes/' + siblings[k].id, { sort_order: k + 1 });
    } catch(e) {}
  }

  _pmDragNodeId = null;
  _pmDragLevel = null;
  EventBus.emit(EVENTS.PRODUCT_LINE_SAVED, {});
}

/* ── Selection ── */

async function _pmSelectNode(nodeId) {
  _pmSelectedNodeId = nodeId;
  await _pmLoadContent();
  renderProductManagementPage();
  // Update hash with current tree node
  if (typeof buildHash === 'function') {
    history.pushState({ view: 'product-management', params: [String(nodeId)] }, '', buildHash('product-management', String(nodeId)));
  }
}

/* ── Add Child Node (L2 under L1, or L3 under L2) ── */

function _pmShowAddChildDialog(parentId, level) {
  var parent = _pmFindNodeById(parentId);
  var levelLabel = level === 2 ? '二级产品（产品系列）' : '三级产品（产品型号）';
  openDialog('添加' + levelLabel + ' — 归属于「' + escHtml(parent ? parent.name : '') + '」',
    '<div style="margin-bottom:12px"><label style="font-size:11px;color:var(--muted)">名称</label>' +
    '<input class="search-inp" id="pm-child-name" placeholder="请输入名称" style="width:100%;box-sizing:border-box;margin-top:4px"></div>',
    [{text: '取消', onclick: 'document.querySelector(\'.shared-dialog-overlay\').remove()'},
     {text: '确定', cls: 'btn-primary', onclick: '_pmAddChildNode(' + parentId + ')'}],
    {hideClose: true});
}

async function _pmAddChildNode(parentId) {
  var name = document.getElementById('pm-child-name').value.trim();
  if (!name) { showToast('请输入名称', 'error'); return; }
  closeSharedDialog();
  try {
    await API.post('/product-doc-templates/product-nodes', {name: name, parent_id: parentId, sort_order: 0});
    showToast('已添加: ' + name, 'ok');
    EventBus.emit(EVENTS.PRODUCT_LINE_SAVED, {});
  } catch (e) {
    showToast('添加失败: ' + (e.detail || e.message), 'error');
  }
}

/* ── Node CRUD (rename / delete) ── */

function _pmShowRenameNodeDialog(nodeId) {
  var node = _pmFindNodeById(nodeId);
  if (!node) return;
  openDialog('重命名 — ' + escHtml(node.name),
    '<div style="margin-bottom:12px"><label style="font-size:11px;color:var(--muted)">新名称</label>' +
    '<input class="search-inp" id="pm-rename" value="' + escHtml(node.name) + '" style="width:100%;box-sizing:border-box;margin-top:4px"></div>',
    [{text: '取消', onclick: 'document.querySelector(\'.shared-dialog-overlay\').remove()'},
     {text: '确定', cls: 'btn-primary', onclick: '_pmRenameNode(' + nodeId + ')'}],
    {hideClose: true});
}

async function _pmRenameNode(nodeId) {
  var name = document.getElementById('pm-rename').value.trim();
  if (!name) { showToast('请输入名称', 'error'); return; }
  var node = _pmFindNodeById(nodeId);
  var ok = await verifyPassword('重命名产品节点: ' + (node ? node.name : ''), 'pw_verify_product_node_edit');
  if (!ok) return;
  closeSharedDialog();
  try {
    await API.put('/product-doc-templates/product-nodes/' + nodeId, {name: name});
    showToast('已重命名', 'ok');
    EventBus.emit(EVENTS.PRODUCT_LINE_SAVED, {});
  } catch (e) {
    showToast('重命名失败: ' + (e.detail || e.message), 'error');
  }
}

async function _pmDeleteNode(nodeId) {
  var node = _pmFindNodeById(nodeId);
  if (!node) return;
  if (!confirm('确定删除「' + node.name + '」及其所有子节点？\n\n注意：子节点下的文档模板也会被删除。')) return;
  var ok = await verifyPassword('删除产品节点: ' + node.name, 'pw_verify_product_node_del');
  if (!ok) return;
  try {
    await API.del('/product-doc-templates/product-nodes/' + nodeId);
    showToast('已删除: ' + node.name, 'ok');
    EventBus.emit(EVENTS.PRODUCT_LINE_DELETED, {});
  } catch (e) {
    showToast('删除失败: ' + (e.detail || e.message), 'error');
  }
}

/* ── Add Product Line (L1) ── */

function _pmShowAddProductLineDialog() {
  openDialog('新增一级产品线',
    '<div style="margin-bottom:12px"><label style="font-size:11px;color:var(--muted)">产品线名称</label>' +
    '<input class="search-inp" id="pm-line-name" placeholder="如：嵌入式产品线" style="width:100%;box-sizing:border-box;margin-top:4px"></div>',
    [{text: '取消', onclick: 'document.querySelector(\'.shared-dialog-overlay\').remove()'},
     {text: '确定', cls: 'btn-primary', onclick: '_pmAddProductLine()'}],
    {hideClose: true});
}

async function _pmAddProductLine() {
  var name = document.getElementById('pm-line-name').value.trim();
  if (!name) { showToast('请输入产品线名称', 'error'); return; }
  closeSharedDialog();
  try {
    await API.post('/product-doc-templates/product-nodes', {name: name, parent_id: null, sort_order: 0});
    showToast('已添加产品线: ' + name, 'ok');
    EventBus.emit(EVENTS.PRODUCT_LINE_SAVED, {});
  } catch (e) {
    showToast('添加失败: ' + (e.detail || e.message), 'error');
  }
}

/* ── Link Existing Product ── */

var _pmLinkAvailable = [];  // cache for filter

function _pmShowLinkProductDialog() {
  var linkedIds = {};
  _pmNodeProducts.forEach(function(p) { linkedIds[p.id] = true; });
  _pmLinkAvailable = _pmAllProducts.filter(function(p) { return !linkedIds[p.id]; });

  if (!_pmLinkAvailable.length) {
    openDialog('关联已有三级产品 — 到「' + escHtml((_pmFindNodeById(_pmSelectedNodeId) || {}).name || '') + '」',
      '<div style="font-size:12px;color:var(--muted);padding:12px">所有产品已关联到此节点</div>',
      [{text: '关闭', cls: 'btn-primary', onclick: 'document.querySelector(\'.shared-dialog-overlay\').remove()'}],
      {hideClose: true});
    return;
  }

  openDialog('关联已有三级产品 — 到「' + escHtml((_pmFindNodeById(_pmSelectedNodeId) || {}).name || '') + '」',
    '<div style="margin-bottom:8px">' +
      '<input class="search-inp" id="pm-link-search" placeholder="搜索产品编号或名称..." style="width:100%;box-sizing:border-box" oninput="_pmFilterLinkProducts()">' +
    '</div>' +
    '<div style="margin-bottom:6px;font-size:10.5px;color:var(--muted)">' +
      '<span id="pm-link-count">共 ' + _pmLinkAvailable.length + ' 个可选</span>' +
      '<a href="javascript:void(0)" onclick="_pmSelectAllLinks(true)" style="margin-left:8px;color:var(--accent);text-decoration:none">全选</a>' +
      '<a href="javascript:void(0)" onclick="_pmSelectAllLinks(false)" style="margin-left:6px;color:var(--accent);text-decoration:none">取消全选</a>' +
    '</div>' +
    '<div id="pm-link-list" style="max-height:300px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;padding:4px;background:var(--surface)">' +
      _pmRenderLinkList(_pmLinkAvailable) +
    '</div>',
    [{text: '取消', onclick: 'document.querySelector(\'.shared-dialog-overlay\').remove()'},
     {text: '关联选中', cls: 'btn-primary', onclick: '_pmLinkProducts()'}],
    {hideClose: true, maxWidth: 500});
}

function _pmRenderLinkList(products) {
  if (!products.length) {
    return '<div style="font-size:12px;color:var(--muted);padding:12px;text-align:center">未找到匹配产品</div>';
  }
  return products.map(function(p) {
    return '<label style="display:flex;align-items:center;gap:8px;padding:6px 10px;font-size:12.5px;cursor:pointer;border-radius:4px" ' +
      'onmouseover="this.style.background=\'var(--bg)\'" onmouseout="this.style.background=\'\'">' +
      '<input type="checkbox" value="' + p.id + '" class="pm-link-cb">' +
      '<span style="font-family:var(--mono);font-size:11px;min-width:110px;color:var(--muted)">' + escHtml(p.code || '') + '</span>' +
      '<span style="flex:1">' + escHtml(p.name) + '</span>' +
      (p.is_local ? '<span class="pm-src-badge local">本地</span>' : '<span class="pm-src-badge synced">禅道</span>') +
    '</label>';
  }).join('');
}

function _pmFilterLinkProducts() {
  var q = document.getElementById('pm-link-search').value.toLowerCase();
  var filtered = q ? _pmLinkAvailable.filter(function(p) {
    return (p.code || '').toLowerCase().indexOf(q) >= 0 || (p.name || '').toLowerCase().indexOf(q) >= 0;
  }) : _pmLinkAvailable;
  document.getElementById('pm-link-list').innerHTML = _pmRenderLinkList(filtered);
  document.getElementById('pm-link-count').textContent = q ? ('筛选到 ' + filtered.length + ' 个') : ('共 ' + _pmLinkAvailable.length + ' 个可选');
}

function _pmSelectAllLinks(val) {
  document.querySelectorAll('.pm-link-cb').forEach(function(cb) { cb.checked = val; });
}

async function _pmLinkProducts() {
  var cbs = document.querySelectorAll('.pm-link-cb:checked');
  if (!cbs.length) { showToast('请至少勾选一个产品', 'error'); return; }
  var ids = [];
  cbs.forEach(function(cb) { ids.push(parseInt(cb.value)); });

  closeSharedDialog();
  var success = 0, fail = 0;
  for (var i = 0; i < ids.length; i++) {
    try {
      await API.post('/product-management/link-product-node', {
        product_id: ids[i],
        node_id: _pmSelectedNodeId
      });
      success++;
    } catch (e) {
      fail++;
    }
  }
  if (success) showToast('已关联 ' + success + ' 个产品' + (fail ? '，' + fail + ' 个失败' : ''), fail ? 'warn' : 'ok');
  else showToast('关联失败', 'error');
  EventBus.emit(EVENTS.PRODUCT_SAVED, {});
}

async function _pmUnlinkProduct(productId) {
  if (!confirm('确定从此节点移除该产品？')) return;
  var ok = await verifyPassword('移除产品关联 #' + productId, 'pw_verify_product_node_edit');
  if (!ok) return;
  try {
    await API.del('/product-management/link-product-node?product_id=' + productId + '&node_id=' + _pmSelectedNodeId);
    showToast('已移除关联', 'ok');
    EventBus.emit(EVENTS.PRODUCT_SAVED, {});
  } catch (e) {
    showToast('移除失败: ' + (e.detail || e.message), 'error');
  }
}

function _pmShowEditProductDialog(productId, productName, productCode) {
  API.get('/products/' + productId).then(function(p) {
    var currentTags = (p.tags || '').split(',').filter(function(t) { return t; });
    API.get('/tags').then(function(allTags) {
      var tagCheckboxes = allTags && allTags.length
        ? allTags.filter(function(t) { return !t.category || t.category === 'product'; }).map(function(t) {
            var checked = currentTags.indexOf(t.name) >= 0;
            return '<label class="searchable-item" data-search-text="' + escHtml(t.name).toLowerCase() + '" style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:12px;cursor:pointer">' +
              '<input type="checkbox" value="' + escHtml(t.name) + '"' + (checked ? ' checked' : '') + ' class="pm-edit-tag">' + escHtml(t.name) +
            '</label>';
          }).join('')
        : '<span style="font-size:12px;color:var(--muted)">暂无标签</span>';

      openDialog('编辑产品 — ' + escHtml(productName),
        '<div style="margin-bottom:10px"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">产品编号</label>' +
          '<input class="search-inp" id="pm-edit-code" value="' + escHtml(p.code || '') + '" style="width:100%;box-sizing:border-box"></div>' +
        '<div style="margin-bottom:10px"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">产品名称 <span style="font-weight:400">（不能包含空格和中文符号）</span></label>' +
          '<input class="search-inp" id="pm-edit-name" value="' + escHtml(p.name || '') + '" style="width:100%;box-sizing:border-box" oninput="_pmValidateProdName(this)">' +
          '<div id="pm-newprod-name-err" style="font-size:10px;color:var(--danger);margin-top:2px;display:none"></div></div>' +
        '<div style="margin-bottom:10px"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">状态</label>' +
          '<select class="search-inp" id="pm-edit-status" style="width:100%;box-sizing:border-box">' +
            '<option value="normal"' + (p.status === 'normal' ? ' selected' : '') + '>正常</option>' +
            '<option value="closed"' + (p.status === 'closed' ? ' selected' : '') + '>已关闭</option>' +
          '</select></div>' +
        '<div style="margin-bottom:4px"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">产品标签 <span style="font-weight:400">（多选）</span></label>' +
          '<input class="search-inp" placeholder="搜索标签..." oninput="_filterSearchableItems(this)" style="margin-bottom:4px">' +
          '<div style="max-height:120px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;padding:8px;background:var(--surface)" class="searchable-list">' + tagCheckboxes + '</div></div>',
        [{text: '取消', onclick: 'closeSharedDialog()'},
         {text: '保存', cls: 'btn-primary', onclick: '_pmSaveEditProduct(\'' + productId + '\')'}],
        {hideClose: true});
    });
  }).catch(function(e) {
    showToast('获取产品信息失败: ' + (e.message || ''), 'error');
  });
}

async function _pmSaveEditProduct(productId) {
  var code = document.getElementById('pm-edit-code').value.trim();
  var name = document.getElementById('pm-edit-name').value.trim();
  var status = document.getElementById('pm-edit-status').value;
  if (!name) { showToast('请输入产品名称', 'error'); return; }
  // Validate name: no spaces + Chinese punctuation
  var forbidden = _pmGetNameForbidden();
  var bad = '';
  for (var i = 0; i < name.length; i++) {
    if (forbidden.has(name[i])) { bad = name[i]; break; }
  }
  if (bad) { showToast('产品名称不能包含空格和中文符号', 'error'); return; }

  var tags = [];
  document.querySelectorAll('.pm-edit-tag:checked').forEach(function(cb) { tags.push(cb.value); });

  closeSharedDialog();
  try {
    await API.put('/product-management/products/' + productId, {
      code: code, name: name, status: status,
    });
    showToast('产品已更新', 'success');
    EventBus.emit(EVENTS.PRODUCT_SAVED, {});
  } catch (e) {
    showToast('更新失败: ' + (e.detail || e.message), 'error');
  }
}

async function _pmDeleteProduct(productId, productName) {
  if (!confirm('确认删除产品「' + productName + '」？\n\n此操作不可撤销，将同时删除该产品的关联数据。')) return;
  var ok = await verifyPassword('删除产品: ' + productName, 'pw_verify_product_node_del');
  if (!ok) return;
  try {
    await API.del('/product-management/products/' + productId);
    showToast('已删除产品「' + productName + '」', 'success');
    EventBus.emit(EVENTS.PRODUCT_DELETED, {});
  } catch (e) {
    showToast('删除失败: ' + (e.detail || e.message), 'error');
  }
}

// _filterSearchableItems moved to utils.js

/* ── Create Product by Naming Convention ── */

var _prodNamingOpts = null;

async function _pmLoadNamingOpts() {
  try {
    var data = await API.get('/product-doc-templates/naming-options');
    var opts = {};
    for (var key in (data || {})) {
      opts[key] = (data[key] || []).map(function(o) { return {code: o.code, desc: o.description}; });
    }
    _prodNamingOpts = opts;
  } catch(e) {
    // Fallback defaults
    _prodNamingOpts = {
      series: [{code:'S',desc:'高速存储'},{code:'P',desc:'电源管理'},{code:'X',desc:'信号处理'},{code:'H',desc:'混合信号'}],
      fpga: [{code:'0',desc:'无FPGA'},{code:'1',desc:'Xilinx Spartan'},{code:'2',desc:'Xilinx Kintex'},{code:'3',desc:'Xilinx Zynq'}],
      cpu: [{code:'0',desc:'无CPU'},{code:'1',desc:'ARM Cortex-A'},{code:'2',desc:'ARM Cortex-M'},{code:'3',desc:'RISC-V'}],
      adc: [{code:'0',desc:'无ADC'},{code:'1',desc:'12-bit'},{code:'2',desc:'14-bit'},{code:'3',desc:'16-bit'}],
      form: [{code:'3',desc:'3U VPX'},{code:'6',desc:'6U VPX'},{code:'8',desc:'8U VPX'},{code:'4',desc:'4U CPCI'},{code:'N',desc:'非标定制'}],
    };
  }
}

function _pmBuildProdCode() {
  var s = document.getElementById('pmnc-series'); if (!s) return 'L####';
  var code = 'L' +
    (s.value || '#') +
    (document.getElementById('pmnc-fpga').value || '#') +
    (document.getElementById('pmnc-cpu').value || '#') +
    (document.getElementById('pmnc-adc').value || '#') +
    (document.getElementById('pmnc-form').value || '#');
  var preview = document.getElementById('pmnc-preview');
  if (preview) preview.textContent = code;
  // Auto-select matching tags from naming options
  var autoTags = {};
  ['pmnc-series','pmnc-fpga','pmnc-cpu','pmnc-adc','pmnc-form'].forEach(function(sid) {
    var sel = document.getElementById(sid);
    if (sel && sel.selectedIndex >= 0) {
      var txt = sel.options[sel.selectedIndex].text;
      var idx = txt.indexOf(' – ');
      if (idx > 0) autoTags[txt.substring(idx + 3)] = true;
    }
  });
  document.querySelectorAll('.pm-newprod-tag').forEach(function(cb) {
    cb.checked = !!autoTags[cb.value];
  });
  // Fetch next version for this base code
  _pmFetchNextVersion(code);
  return code;
}

function _pmFetchNextVersion(baseCode) {
  if (baseCode.indexOf('#') >= 0) {
    var verEl = document.getElementById('pmnc-version');
    if (verEl) verEl.textContent = '—';
    return;
  }
  API.get('/product-management/next-product-version?base_code=' + encodeURIComponent(baseCode)).then(function(res) {
    var verEl = document.getElementById('pmnc-version');
    if (verEl) verEl.textContent = res.version;
    var fullEl = document.getElementById('pmnc-full-code');
    if (fullEl) fullEl.textContent = res.full_code;
    // Update top preview to show full code with version
    var preview = document.getElementById('pmnc-preview');
    if (preview) preview.textContent = res.full_code;
  }).catch(function() {
    var verEl = document.getElementById('pmnc-version');
    if (verEl) verEl.textContent = '—';
  });
}

function _pmShowNamingProductDialog() {
  var node = _pmFindNodeById(_pmSelectedNodeId);
  var crumbs = _pmGetBreadcrumb(_pmSelectedNodeId);
  var crumbTitle = crumbs.length > 1
    ? escHtml(crumbs[0]) + ' / ' + escHtml(crumbs[1])
    : escHtml(crumbs[0] || '');

  // Ensure naming options are loaded
  if (!_prodNamingOpts) {
    _pmLoadNamingOpts().then(function() { _pmShowNamingProductDialog(); });
    return;
  }

  var makeSelect = function(id, opts) {
    var h = '<select class="search-inp" id="' + id + '" onchange="_pmBuildProdCode()" style="width:100%;box-sizing:border-box;margin-top:4px">';
    opts.forEach(function(o) {
      h += '<option value="' + o.code + '">' + o.code + ' – ' + o.desc + '</option>';
    });
    return h + '</select>';
  };

  var projectCheckboxes = _pmAllProjects.length
    ? _pmAllProjects.slice(0, 50).map(function(proj) {
        return '<label class="searchable-item" data-search-text="' + escHtml((proj.name + ' ' + (proj.code || '')).toLowerCase()) + '" style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:12px;cursor:pointer">' +
          '<input type="checkbox" value="' + proj.id + '" class="pm-newprod-proj">' +
          escHtml(proj.code || '') + ' ' + escHtml(proj.name) +
        '</label>';
      }).join('')
    : '<span style="font-size:12px;color:var(--muted)">暂无可选项目</span>';

  API.get('/tags').then(function(allTags) {
    var tagCheckboxes = allTags && allTags.length
      ? allTags.filter(function(t) { return !t.category || t.category === 'product'; }).map(function(t) {
          return '<label style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:12px;cursor:pointer">' +
            '<input type="checkbox" value="' + escHtml(t.name) + '" class="pm-newprod-tag">' + escHtml(t.name) +
          '</label>';
        }).join('')
      : '<span style="font-size:12px;color:var(--muted)">暂无标签，请先在文档模板中配置</span>';

    var formHtml =
      // Auto-generated code preview — centered at top
      '<div style="text-align:center;margin-bottom:12px">' +
        '<div style="font-size:10px;color:var(--muted);margin-bottom:4px">自动生成编号</div>' +
        '<div style="display:inline-block;font-size:22px;font-weight:700;font-family:var(--mono);color:var(--accent);background:var(--accent-lt);padding:6px 18px;border-radius:6px;border:1px solid var(--accent);letter-spacing:0.05em" id="pmnc-preview">L####</div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px">' +
        '<div><label style="font-size:10px;color:var(--muted)">系列</label>' + makeSelect('pmnc-series', _prodNamingOpts.series) + '</div>' +
        '<div><label style="font-size:10px;color:var(--muted)">FPGA</label>' + makeSelect('pmnc-fpga', _prodNamingOpts.fpga) + '</div>' +
        '<div><label style="font-size:10px;color:var(--muted)">CPU</label>' + makeSelect('pmnc-cpu', _prodNamingOpts.cpu) + '</div>' +
        '<div><label style="font-size:10px;color:var(--muted)">ADC</label>' + makeSelect('pmnc-adc', _prodNamingOpts.adc) + '</div>' +
        '<div><label style="font-size:10px;color:var(--muted)">形态</label>' + makeSelect('pmnc-form', _prodNamingOpts.form) + '</div>' +
        '<div style="display:flex;flex-direction:column;justify-content:flex-end">' +
          '<div style="text-align:center;padding:4px;background:var(--bg);border-radius:6px;border:1px solid var(--border)">' +
            '<div style="font-size:9px;color:var(--muted)">自动生成版本号</div>' +
            '<div style="font-size:14px;font-weight:600;font-family:var(--mono);color:var(--fg)">' +
              '<span id="pmnc-version" style="font-size:20px;font-weight:700;color:var(--warn)">—</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      // Hidden field to store the full code (base + version)
      '<input type="hidden" id="pmnc-full-code" value="">' +
      '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">产品名称 <span style="font-weight:400;color:var(--danger)">*</span> <span style="font-weight:400">（不能包含空格和中文符号）</span></label>' +
      '<input class="search-inp" id="pm-newprod-name" placeholder="输入产品名称" style="width:100%;box-sizing:border-box;margin-top:4px" oninput="_pmValidateProdName(this)">' +
      '<div id="pm-newprod-name-err" style="font-size:10px;color:var(--danger);margin-top:2px;display:none"></div></div>' +
      '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">状态</label>' +
      '<select id="pm-newprod-status" style="width:100%;box-sizing:border-box;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--fg);margin-top:4px">' +
        '<option value="normal">正常</option><option value="closed">已关闭</option>' +
      '</select></div>' +
      '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">产品标签 <span style="font-weight:400">（可选，多选）</span></label>' +
      '<input class="search-inp" placeholder="搜索标签..." oninput="_filterSearchableItems(this)" style="margin-top:4px;margin-bottom:4px">' +
      '<div style="max-height:120px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;padding:8px;background:var(--surface)" class="searchable-list">' + tagCheckboxes + '</div></div>' +
      '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">关联项目 <span style="font-weight:400">（可选，可多选）</span></label>' +
      '<input class="search-inp" placeholder="搜索项目..." oninput="_filterSearchableItems(this)" style="margin-top:4px;margin-bottom:4px">' +
      '<div style="max-height:120px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;padding:8px;background:var(--surface)" class="searchable-list">' + projectCheckboxes + '</div></div>';

    openDialog('创建新产品 — ' + crumbTitle, formHtml, [
      {text: '取消', onclick: "var d=document.querySelector('.shared-dialog-overlay');if(d)d.remove()"},
      {text: '创建', cls: 'btn-primary', onclick: '_pmSubmitNamingProduct()'}
    ], {maxWidth: 560});

    setTimeout(function() {
      _pmBuildProdCode();
    }, 80);
  });
}

// Name validation: no spaces, no Chinese punctuation
var _PM_PROD_NAME_FORBIDDEN = null;
function _pmGetNameForbidden() {
  if (!_PM_PROD_NAME_FORBIDDEN) {
    _PM_PROD_NAME_FORBIDDEN = new Set((' \t　' +
      '，、；：。！？' +
      '（）《》「」『』' +
      '【】〔〕').split(''));
  }
  return _PM_PROD_NAME_FORBIDDEN;
}
function _pmValidateProdName(input) {
  var errEl = document.getElementById('pm-newprod-name-err');
  if (!errEl) return true;
  var val = input.value;
  var forbidden = _pmGetNameForbidden();
  var bad = '';
  for (var i = 0; i < val.length; i++) {
    if (forbidden.has(val[i])) { bad = val[i]; break; }
  }
  if (bad) {
    errEl.textContent = '名称包含非法字符: "' + bad + '"（不能包含空格和中文符号）';
    errEl.style.display = 'block';
    return false;
  }
  errEl.style.display = 'none';
  return true;
}

async function _pmSubmitNamingProduct() {
  var baseCode = _pmBuildProdCode();
  if (baseCode.indexOf('#') >= 0) { showToast('请选择所有属性', 'error'); return; }
  var name = document.getElementById('pm-newprod-name').value.trim();
  if (!name) { showToast('请输入产品名称', 'error'); return; }
  if (!_pmValidateProdName(document.getElementById('pm-newprod-name'))) {
    showToast('产品名称包含非法字符', 'error'); return;
  }
  var status = document.getElementById('pm-newprod-status').value;
  var tags = [];
  // Auto-tags from naming convention selections
  ['pmnc-series','pmnc-fpga','pmnc-cpu','pmnc-adc','pmnc-form'].forEach(function(sid) {
    var sel = document.getElementById(sid);
    if (sel && sel.selectedIndex >= 0) {
      var txt = sel.options[sel.selectedIndex].text;
      // Extract description part (after " – ")
      var idx = txt.indexOf(' – ');
      if (idx > 0) tags.push(txt.substring(idx + 3));
    }
  });
  // Merge user-selected tags
  document.querySelectorAll('.pm-newprod-tag:checked').forEach(function(cb) { tags.push(cb.value); });
  var projectIds = [];
  document.querySelectorAll('.pm-newprod-proj:checked').forEach(function(cb) { projectIds.push(parseInt(cb.value)); });

  // Use full code (base + version)
  var fullCode = document.getElementById('pmnc-full-code').value || (baseCode + '-V1');

  try {
    await API.post('/product-management/products', {
      name: name, code: fullCode, node_id: _pmSelectedNodeId,
      status: status, project_ids: projectIds,
      description: tags.join(', ')
    });
    showToast('产品已创建: ' + fullCode, 'success');
    var d = document.querySelector('.shared-dialog-overlay');
    if (d) d.remove();
    EventBus.emit(EVENTS.PRODUCT_SAVED, {});
  } catch(e) {
    showToast('创建失败: ' + (e.message || e.detail || '未知错误'), 'error');
  }
}

/* ── Create Local Product (PMA-local, for L2 → 三级产品) ── */

function _pmShowCreateProductDialog() {
  var node = _pmFindNodeById(_pmSelectedNodeId);
  var crumbs = _pmGetBreadcrumb(_pmSelectedNodeId);
  var crumbTitle = crumbs.length > 1
    ? '<span style="color:var(--accent);font-weight:500">' + escHtml(crumbs[0]) + '</span>' +
      ' <span style="color:var(--muted)">/</span> ' +
      '<span style="color:var(--accent);font-weight:500">' + escHtml(crumbs[1]) + '</span>'
    : '<span style="color:var(--accent);font-weight:500">' + escHtml(crumbs[0] || '') + '</span>';

  var projectCheckboxes = _pmAllProjects.length
    ? _pmAllProjects.slice(0, 50).map(function(proj) {
        return '<label class="searchable-item" data-search-text="' + escHtml((proj.name + ' ' + (proj.code || '')).toLowerCase()) + '" style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:12px;cursor:pointer">' +
          '<input type="checkbox" value="' + proj.id + '" class="pm-newprod-proj">' +
          escHtml(proj.code || '') + ' ' + escHtml(proj.name) +
        '</label>';
      }).join('')
    : '<span style="font-size:12px;color:var(--muted)">暂无可选项目</span>';

  // Fetch product/通用 tags for description
  API.get('/tags').then(function(allTags) {
    var tagCheckboxes = allTags && allTags.length
      ? allTags.filter(function(t) { return !t.category || t.category === 'product'; }).map(function(t) {
          return '<label style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:12px;cursor:pointer">' +
            '<input type="checkbox" value="' + escHtml(t.name) + '" class="pm-newprod-tag">' + escHtml(t.name) +
          '</label>';
        }).join('')
      : '<span style="font-size:12px;color:var(--muted)">暂无标签，请先在文档模板中配置</span>';

    openDialog('添加三级产品 — ' + crumbTitle,
      '<div style="margin-bottom:10px"><label style="font-size:11px;color:var(--muted)">产品编号 * <span style="font-weight:400">（如：LVX624M-V010）</span></label>' +
      '<input class="search-inp" id="pm-newprod-code" placeholder="如：LVX624M-V010" style="width:100%;box-sizing:border-box;margin-top:4px"></div>' +
      '<div style="margin-bottom:10px"><label style="font-size:11px;color:var(--muted)">产品名称 * <span style="font-weight:400">（通常与编号一致）</span></label>' +
      '<input class="search-inp" id="pm-newprod-name" placeholder="如：LVX624M-V010" style="width:100%;box-sizing:border-box;margin-top:4px"></div>' +
      '<div style="margin-bottom:10px"><label style="font-size:11px;color:var(--muted)">状态</label>' +
      '<select id="pm-newprod-status" style="width:100%;box-sizing:border-box;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--fg);margin-top:4px">' +
        '<option value="normal">正常</option><option value="closed">已关闭</option>' +
      '</select></div>' +
      '<div style="margin-bottom:10px"><label style="font-size:11px;color:var(--muted)">产品标签 <span style="font-weight:400">（可选，多选）</span></label>' +
      '<input class="search-inp" placeholder="搜索标签..." oninput="_filterSearchableItems(this)" style="margin-top:4px;margin-bottom:4px">' +
      '<div style="max-height:120px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;padding:8px;background:var(--surface)" class="searchable-list">' + tagCheckboxes + '</div></div>' +
      '<div style="margin-bottom:10px"><label style="font-size:11px;color:var(--muted)">关联项目 <span style="font-weight:400">（可选，可多选）</span></label>' +
      '<input class="search-inp" placeholder="搜索项目..." oninput="_filterSearchableItems(this)" style="margin-top:4px;margin-bottom:4px">' +
      '<div style="max-height:120px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;padding:8px;background:var(--surface)" class="searchable-list">' + projectCheckboxes + '</div></div>',
      [{text: '取消', onclick: 'document.querySelector(\'.shared-dialog-overlay\').remove()'},
       {text: '添加', cls: 'btn-primary', onclick: '_pmCreateProduct()'}],
      {hideClose: true});
  });
}

async function _pmCreateProduct() {
  var name = document.getElementById('pm-newprod-name').value.trim();
  var code = document.getElementById('pm-newprod-code').value.trim();
  var status = document.getElementById('pm-newprod-status').value;

  if (!name) { showToast('请输入产品名称', 'error'); return; }
  if (!code) { showToast('请输入产品编号', 'error'); return; }

  var tags = [];
  document.querySelectorAll('.pm-newprod-tag:checked').forEach(function(cb) {
    tags.push(cb.value);
  });
  var projectIds = [];
  document.querySelectorAll('.pm-newprod-proj:checked').forEach(function(cb) {
    projectIds.push(parseInt(cb.value));
  });

  closeSharedDialog();
  try {
    await API.post('/product-management/products', {
      name: name, code: code, node_id: _pmSelectedNodeId,
      status: status, project_ids: projectIds
    });
    showToast('产品已创建: ' + name, 'ok');
    EventBus.emit(EVENTS.PRODUCT_SAVED, {});
  } catch (e) {
    showToast('创建失败: ' + (e.detail || e.message), 'error');
  }
}

/* ── Manage Product-Project Associations ── */

function _pmShowManageProductProjects(productId, productName) {
  API.get('/product-management/products/' + productId + '/projects').then(function(linkedProjects) {
    var linkedIds = {};
    (linkedProjects || []).forEach(function(p) { linkedIds[p.id] = true; });

    var checkboxesHtml = _pmAllProjects.length
      ? _pmAllProjects.slice(0, 100).map(function(proj) {
          var checked = linkedIds[proj.id] ? ' checked' : '';
          return '<label class="searchable-item" data-search-text="' + escHtml((proj.name + ' ' + (proj.code || '')).toLowerCase()) + '" style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:12px;cursor:pointer">' +
            '<input type="checkbox" value="' + proj.id + '" class="pm-prodproj-cb"' + checked + '>' +
            escHtml(proj.code || '') + ' ' + escHtml(proj.name) +
          '</label>';
        }).join('')
      : '<span style="font-size:12px;color:var(--muted)">暂无可选项目</span>';

    openDialog('管理项目关联 — ' + escHtml(productName),
      '<div style="margin-bottom:12px">' +
        '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">选择关联的项目（可多选）</label>' +
        '<input class="search-inp" placeholder="搜索项目..." oninput="_filterSearchableItems(this)" style="margin-bottom:4px">' +
        '<div style="max-height:280px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;padding:8px;background:var(--surface)" class="searchable-list">' +
          checkboxesHtml +
        '</div>' +
        '<div style="font-size:10.5px;color:var(--muted);margin-top:4px">勾选即关联，取消勾选即解除关联。保存时会替换所有关联。</div>' +
      '</div>',
      [{text: '取消', onclick: 'document.querySelector(\'.shared-dialog-overlay\').remove()'},
       {text: '保存', cls: 'btn-primary', onclick: '_pmSaveProductProjects(\'' + productId + '\')'}],
      {hideClose: true});
  }).catch(function(e) {
    showToast('加载项目列表失败: ' + (e.message || ''), 'error');
  });
}

async function _pmSaveProductProjects(productId) {
  var projectIds = [];
  document.querySelectorAll('.pm-prodproj-cb:checked').forEach(function(cb) {
    projectIds.push(parseInt(cb.value));
  });
  closeSharedDialog();
  try {
    await API.put('/product-management/products/' + productId + '/projects', { project_ids: projectIds });
    showToast('项目关联已更新', 'ok');
    EventBus.emit(EVENTS.PRODUCT_SAVED, {});
    EventBus.emit(EVENTS.PROJECT_SAVED, {});
  } catch (e) {
    showToast('更新失败: ' + (e.detail || e.message), 'error');
  }
}

/* Resize product table to fill window height */
function _resizePMTable() {
  ['pm-l1-table', 'pm-l2-table'].forEach(function(id) {
    var wrap = document.getElementById(id);
    if (!wrap) return;
    var top = wrap.getBoundingClientRect().top;
    wrap.style.maxHeight = Math.max(200, window.innerHeight - top - 24) + 'px';
  });
}

/* ── Refresh ── */

async function refreshPMData() {
  // 保留表格滚动位置与选中节点（增删产品/产品线后原位刷新，不跳回顶部）
  var prevNodeId = _pmSelectedNodeId;
  var scrollEl = document.querySelector('#view-product-management .table-scroll');
  var prevScroll = scrollEl ? scrollEl.scrollTop : 0;
  try {
    _pmTree = (await API.get('/product-management/tree')) || [];
    _pmAllProducts = (await API.get('/product-management/all-products')) || [];
    _pmAllProjects = (await API.get('/product-management/all-projects')) || [];
  } catch (e) { /* ignore */ }
  // If selected node no longer exists, select first available
  if (!_pmFindNodeById(_pmSelectedNodeId)) {
    var firstL2 = _pmFindFirstL2(_pmTree);
    _pmSelectedNodeId = firstL2 || (_pmTree.length ? _pmTree[0].id : null);
  }
  await _pmLoadContent();
  renderProductManagementPage();
  _resizePMTable();
  // 选中节点未变时恢复表格滚动位置（节点变了内容完全不同，无需恢复）
  if (_pmSelectedNodeId === prevNodeId && prevScroll > 0) {
    var scrollEl2 = document.querySelector('#view-product-management .table-scroll');
    if (scrollEl2) scrollEl2.scrollTop = prevScroll;
  }
}
window.addEventListener('resize', _resizePMTable);
