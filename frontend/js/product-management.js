/* ═══════════════════════════════════════════════════
   PRODUCT MANAGEMENT PAGE
   Left: 2-level product nav (产品线 → 产品系列)
   Right: Next-level items + contextual actions
═══════════════════════════════════════════════════ */

var _pmTree = [];              // [{id, name, parent_id, level, product_count, project_count, children}]
var _pmSelectedNodeId = null;  // currently selected tree node ID
var _pmNodeProducts = [];      // products linked to selected node (for L2 → products)
var _pmNodeChildren = [];      // child nodes of selected node (for L1 → L2 list)
var _pmAllProducts = [];       // all products (for dropdowns)
var _pmAllProjects = [];       // all projects (for dropdowns)
var _pmIsAdmin = false;

var PM_TREE_ICONS = ['', '📁', '📂', '📄'];

/* ── Init ── */

async function initProductManagement() {
  var user = getCurrentUser();
  var perms = (user && user.permissions) ? user.permissions.split(',') : [];
  _pmIsAdmin = user && (user.role === 'admin' || perms.indexOf('admin') >= 0);

  var container = document.getElementById('view-product-management');
  container.innerHTML = '<div class="loading-spinner">加载产品管理...</div>';

  try {
    var treeData = await API.get('/product-management/tree');
    _pmTree = treeData || [];

    try { _pmAllProducts = (await API.get('/product-management/all-products')) || []; } catch (e) { _pmAllProducts = []; }
    try { _pmAllProjects = (await API.get('/product-management/all-projects')) || []; } catch (e) { _pmAllProjects = []; }

    // Select first L2 or L1 by default
    if (!_pmSelectedNodeId || !_pmFindNodeById(_pmSelectedNodeId)) {
      var firstL2 = _pmFindFirstL2(_pmTree);
      _pmSelectedNodeId = firstL2 || (_pmTree.length ? _pmTree[0].id : null);
    }
    await _pmLoadContent();
    renderProductManagementPage();
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
  if (!selNode) { _pmNodeProducts = []; _pmNodeChildren = []; return; }

  // Child nodes (L2 children for L1, L3 children for L2)
  _pmNodeChildren = (selNode.children || []).slice();

  // Products linked to this node
  try {
    _pmNodeProducts = (await API.get('/product-management/nodes/' + _pmSelectedNodeId + '/products')) || [];
  } catch (e) {
    _pmNodeProducts = [];
  }
}

/* ── Main Render ── */

function renderProductManagementPage() {
  var selNode = _pmFindNodeById(_pmSelectedNodeId);
  var isL1 = selNode && selNode.level === 1;
  var isL2 = selNode && selNode.level === 2;

  // Left panel: 2-level nav
  var leftHtml = '<div class="section-title" style="margin-bottom:10px">产品导航</div>';
  _pmTree.forEach(function (l1) {
    leftHtml += _pmRenderL1Node(l1);
  });
  // Add product line button at bottom
  if (_pmIsAdmin) {
    leftHtml += '<div class="dt-tree-node" style="cursor:pointer;color:var(--accent);font-weight:500;padding:6px 12px" onclick="_pmShowAddProductLineDialog()">' +
      '<span style="width:16px;flex-shrink:0"></span>' +
      '<span class="dt-tree-icon">➕</span>' +
      '<span class="dt-tree-label">新增产品线</span>' +
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
  rightHtml += '<div class="section-title">' + titleHtml + '</div>';
  rightHtml += '</div>';

  if (!selNode) {
    rightHtml += '<div class="empty-state" style="padding:20px">请从左侧选择产品节点</div>';
  } else if (isL1) {
    // L1 selected → Show L2 (产品系列) list
    rightHtml += '<div class="section-hd" style="margin-top:10px"><div class="section-title">二级产品 · 产品系列 (' + _pmNodeChildren.length + ')</div></div>';
    if (_pmNodeChildren.length) {
      rightHtml += '<div class="table-scroll" style="max-height:400px"><table class="stage-table"><thead><tr>' +
        '<th>产品系列名称</th><th>型号数</th>' +
        (_pmIsAdmin ? '<th style="width:100px">操作</th>' : '') +
        '</tr></thead><tbody>';
      _pmNodeChildren.forEach(function (l2) {
        var modelCount = (l2.children || []).length;
        rightHtml += '<tr style="cursor:pointer" onclick="_pmSelectNode(' + l2.id + ')">' +
          '<td style="font-weight:500">📂 ' + escHtml(l2.name) + '</td>' +
          '<td style="text-align:center">' + modelCount + '</td>' +
          (_pmIsAdmin ? '<td style="white-space:nowrap;text-align:center">' +
            '<button class="btn" style="font-size:10px;padding:2px 6px;margin-right:3px" onclick="event.stopPropagation();_pmShowRenameNodeDialog(' + l2.id + ')">✎</button>' +
            '<button class="btn" style="font-size:10px;padding:2px 6px;color:var(--danger)" onclick="event.stopPropagation();_pmDeleteNode(' + l2.id + ')">✕</button>' +
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
    rightHtml += '<div style="display:flex;gap:6px;margin-bottom:12px">';
    if (_pmIsAdmin) {
      rightHtml += '<button class="btn btn-primary" style="font-size:11px;padding:5px 12px" onclick="_pmShowCreateProductDialog()">+ 添加三级产品</button>';
      rightHtml += '<button class="btn btn-primary" style="font-size:11px;padding:5px 12px" onclick="_pmShowLinkProductDialog()">+ 关联已有三级产品</button>';
    }
    rightHtml += '</div>';
    rightHtml += '<div class="section-hd"><div class="section-title">三级产品 · 产品型号 (' + _pmNodeProducts.length + ')</div></div>';
    if (_pmNodeProducts.length) {
      rightHtml += '<div class="table-scroll" style="max-height:400px"><table class="stage-table"><thead><tr>' +
        '<th>编号</th><th>产品名</th><th>状态</th><th>关联项目数</th><th>来源</th>' +
        (_pmIsAdmin ? '<th style="width:120px">操作</th>' : '') +
        '</tr></thead><tbody>';
      _pmNodeProducts.forEach(function (p) {
        rightHtml += '<tr>' +
          '<td style="font-family:var(--mono);font-size:12px">' + escHtml(p.code || '#' + p.id) + '</td>' +
          '<td style="font-weight:500">' + escHtml(p.name) + '</td>' +
          '<td>' + renderPill(p.status) + '</td>' +
          '<td style="text-align:center">' + (p.project_count || 0) + '</td>' +
          '<td>' + (p.is_local ? '<span class="pm-src-badge local">PMA本地</span>' : (p.synced_at ? '<span class="pm-src-badge synced" title="同步于 ' + escHtml(p.synced_at) + '">禅道同步</span>' : '<span class="pm-src-badge unknown">未知</span>')) + '</td>' +
          (_pmIsAdmin ? '<td style="white-space:nowrap;text-align:center">' +
            '<button class="btn" style="font-size:10px;padding:2px 6px;margin-right:3px" onclick="_pmShowManageProductProjects(' + p.id + ',\'' + escHtml(p.name).replace(/'/g, "\\'") + '\')">项目</button>' +
            '<button class="btn" style="font-size:10px;padding:2px 6px;color:var(--danger)" onclick="_pmUnlinkProduct(' + p.id + ')">移除</button>' +
          '</td>' : '') +
        '</tr>';
      });
      rightHtml += '</tbody></table></div>';
    } else {
      rightHtml += '<div class="empty-state" style="padding:16px;font-size:13px">该产品系列下暂无产品型号</div>';
    }

    // Also show L3 nodes (product tree nodes) that are children of this L2
    if (_pmNodeChildren.length) {
      rightHtml += '<div class="section-hd" style="margin-top:18px"><div class="section-title">产品型号节点 (' + _pmNodeChildren.length + ')</div></div>';
      rightHtml += '<div style="font-size:11px;color:var(--muted);margin-bottom:8px">以下为产品架构中的三级节点，需关联禅道产品后才在此处显示为完整产品</div>';
      rightHtml += '<div class="table-scroll" style="max-height:300px"><table class="stage-table"><thead><tr>' +
        '<th>节点名称</th>' +
        (_pmIsAdmin ? '<th style="width:100px">操作</th>' : '') +
        '</tr></thead><tbody>';
      _pmNodeChildren.forEach(function (l3) {
        rightHtml += '<tr>' +
          '<td>📄 ' + escHtml(l3.name) + '</td>' +
          (_pmIsAdmin ? '<td style="white-space:nowrap;text-align:center">' +
            '<button class="btn" style="font-size:10px;padding:2px 6px;margin-right:3px" onclick="_pmShowRenameNodeDialog(' + l3.id + ')">✎</button>' +
            '<button class="btn" style="font-size:10px;padding:2px 6px;color:var(--danger)" onclick="_pmDeleteNode(' + l3.id + ')">✕</button>' +
          '</td>' : '') +
        '</tr>';
      });
      rightHtml += '</tbody></table></div>';
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

function _pmRenderL1Node(l1) {
  var isSelected = l1.id === _pmSelectedNodeId;
  var hasChildren = l1.children && l1.children.length > 0;

  var html = '<div class="dt-tree-node' + (isSelected ? ' selected' : '') +
    '" style="padding-left:4px" onclick="_pmSelectNode(' + l1.id + ')">';

  html += '<span style="width:16px;flex-shrink:0"></span>';
  html += '<span class="dt-tree-icon">📁</span>';
  html += '<span class="dt-tree-label">' + escHtml(l1.name) + '</span>';
  if (hasChildren) {
    html += '<span class="dt-tree-badge">' + l1.children.length + '</span>';
  }
  if (_pmIsAdmin) {
    html += '<span class="dt-tree-acts">' +
      '<button class="btn" style="font-size:10px;padding:1px 5px" onclick="event.stopPropagation();_pmShowRenameNodeDialog(' + l1.id + ')" title="重命名">✎</button>' +
      '<button class="btn" style="font-size:10px;padding:1px 5px;color:var(--danger)" onclick="event.stopPropagation();_pmDeleteNode(' + l1.id + ')" title="删除">✕</button>' +
    '</span>';
  }
  html += '</div>';

  // Show L2 children (always visible, indented)
  if (hasChildren) {
    l1.children.forEach(function (l2) {
      var l2Selected = l2.id === _pmSelectedNodeId;
      html += '<div class="dt-tree-node' + (l2Selected ? ' selected' : '') +
        '" style="padding-left:24px" onclick="_pmSelectNode(' + l2.id + ')">';
      html += '<span style="width:16px;flex-shrink:0"></span>';
      html += '<span class="dt-tree-icon">📂</span>';
      html += '<span class="dt-tree-label">' + escHtml(l2.name) + '</span>';
      var l3Count = (l2.children || []).length;
      if (l3Count) {
        html += '<span class="dt-tree-badge" style="background:var(--accent-lt);color:var(--accent)">' + l3Count + '</span>';
      }
      if (_pmIsAdmin) {
        html += '<span class="dt-tree-acts">' +
          '<button class="btn" style="font-size:10px;padding:1px 5px" onclick="event.stopPropagation();_pmShowRenameNodeDialog(' + l2.id + ')" title="重命名">✎</button>' +
          '<button class="btn" style="font-size:10px;padding:1px 5px;color:var(--danger)" onclick="event.stopPropagation();_pmDeleteNode(' + l2.id + ')" title="删除">✕</button>' +
        '</span>';
      }
      html += '</div>';
    });
  }

  return html;
}

/* ── Selection ── */

async function _pmSelectNode(nodeId) {
  _pmSelectedNodeId = nodeId;
  await _pmLoadContent();
  renderProductManagementPage();
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
  document.querySelector('.shared-dialog-overlay').remove();
  try {
    await API.post('/product-doc-templates/product-nodes', {name: name, parent_id: parentId, sort_order: 0});
    showToast('已添加: ' + name, 'ok');
    await refreshPMData();
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
  var ok = await verifyPassword('重命名产品节点', 'pw_verify_product_node_edit');
  if (!ok) return;
  document.querySelector('.shared-dialog-overlay').remove();
  try {
    await API.put('/product-doc-templates/product-nodes/' + nodeId, {name: name});
    showToast('已重命名', 'ok');
    await refreshPMData();
  } catch (e) {
    showToast('重命名失败: ' + (e.detail || e.message), 'error');
  }
}

async function _pmDeleteNode(nodeId) {
  var node = _pmFindNodeById(nodeId);
  if (!node) return;
  if (!confirm('确定删除「' + node.name + '」及其所有子节点？\n\n注意：子节点下的文档模板也会被删除。')) return;
  var ok = await verifyPassword('删除产品节点', 'pw_verify_product_node_del');
  if (!ok) return;
  try {
    await API.del('/product-doc-templates/product-nodes/' + nodeId);
    showToast('已删除: ' + node.name, 'ok');
    await refreshPMData();
    // If selected node was deleted, select first available
    if (!_pmFindNodeById(_pmSelectedNodeId)) {
      var firstL2 = _pmFindFirstL2(_pmTree);
      _pmSelectedNodeId = firstL2 || (_pmTree.length ? _pmTree[0].id : null);
    }
  } catch (e) {
    showToast('删除失败: ' + (e.detail || e.message), 'error');
  }
}

/* ── Add Product Line (L1) ── */

function _pmShowAddProductLineDialog() {
  openDialog('新增产品线',
    '<div style="margin-bottom:12px"><label style="font-size:11px;color:var(--muted)">产品线名称</label>' +
    '<input class="search-inp" id="pm-line-name" placeholder="如：嵌入式产品线" style="width:100%;box-sizing:border-box;margin-top:4px"></div>',
    [{text: '取消', onclick: 'document.querySelector(\'.shared-dialog-overlay\').remove()'},
     {text: '确定', cls: 'btn-primary', onclick: '_pmAddProductLine()'}],
    {hideClose: true});
}

async function _pmAddProductLine() {
  var name = document.getElementById('pm-line-name').value.trim();
  if (!name) { showToast('请输入产品线名称', 'error'); return; }
  document.querySelector('.shared-dialog-overlay').remove();
  try {
    await API.post('/product-doc-templates/product-nodes', {name: name, parent_id: null, sort_order: 0});
    showToast('已添加产品线: ' + name, 'ok');
    await refreshPMData();
  } catch (e) {
    showToast('添加失败: ' + (e.detail || e.message), 'error');
  }
}

/* ── Link Existing Product ── */

function _pmShowLinkProductDialog() {
  var linkedIds = {};
  _pmNodeProducts.forEach(function(p) { linkedIds[p.id] = true; });
  var available = _pmAllProducts.filter(function(p) { return !linkedIds[p.id]; });

  var optionsHtml = '';
  if (!available.length) {
    optionsHtml = '<div style="font-size:12px;color:var(--muted);padding:8px">所有产品已关联到此节点</div>';
  } else {
    optionsHtml = '<select id="pm-link-product-select" style="width:100%;box-sizing:border-box;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--fg)" size="8">' +
      available.map(function(p) {
        return '<option value="' + p.id + '">' + escHtml(p.code || '') + ' — ' + escHtml(p.name) + '</option>';
      }).join('') +
    '</select>';
  }

  openDialog('关联已有三级产品 — 到「' + escHtml((_pmFindNodeById(_pmSelectedNodeId) || {}).name || '') + '」',
    '<div style="margin-bottom:12px">' +
      '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">选择产品</label>' +
      optionsHtml +
    '</div>',
    [{text: '取消', onclick: 'document.querySelector(\'.shared-dialog-overlay\').remove()'},
     {text: '关联', cls: 'btn-primary', onclick: '_pmLinkProduct()'}],
    {hideClose: true});
}

async function _pmLinkProduct() {
  var sel = document.getElementById('pm-link-product-select');
  if (!sel || !sel.value) { showToast('请选择产品', 'error'); return; }
  document.querySelector('.shared-dialog-overlay').remove();
  try {
    await API.post('/product-management/link-product-node', {
      product_id: parseInt(sel.value),
      node_id: _pmSelectedNodeId
    });
    showToast('已关联产品', 'ok');
    await refreshPMData();
  } catch (e) {
    showToast('关联失败: ' + (e.detail || e.message), 'error');
  }
}

async function _pmUnlinkProduct(productId) {
  if (!confirm('确定从此节点移除该产品？')) return;
  var ok = await verifyPassword('移除产品关联', 'pw_verify_product_node_edit');
  if (!ok) return;
  try {
    await API.del('/product-management/link-product-node?product_id=' + productId + '&node_id=' + _pmSelectedNodeId);
    showToast('已移除关联', 'ok');
    await refreshPMData();
  } catch (e) {
    showToast('移除失败: ' + (e.detail || e.message), 'error');
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
        return '<label style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:12px;cursor:pointer">' +
          '<input type="checkbox" value="' + proj.id + '" class="pm-newprod-proj">' +
          escHtml(proj.code || '') + ' ' + escHtml(proj.name) +
        '</label>';
      }).join('')
    : '<span style="font-size:12px;color:var(--muted)">暂无可选项目</span>';

  openDialog('添加三级产品 — ' + crumbTitle,
    '<div style="margin-bottom:10px"><label style="font-size:11px;color:var(--muted)">产品编号 * <span style="font-weight:400">（如：LVX624M-V010，短横线前为产品主体，后为硬件版本 V010/V020）</span></label>' +
    '<input class="search-inp" id="pm-newprod-code" placeholder="如：LVX624M-V010" style="width:100%;box-sizing:border-box;margin-top:4px"></div>' +
    '<div style="margin-bottom:10px"><label style="font-size:11px;color:var(--muted)">产品名称 * <span style="font-weight:400">（通常与编号一致，也可不同如：手持频谱仪）</span></label>' +
    '<input class="search-inp" id="pm-newprod-name" placeholder="如：LVX624M-V010 或 手持频谱仪" style="width:100%;box-sizing:border-box;margin-top:4px"></div>' +
    '<div style="margin-bottom:10px"><label style="font-size:11px;color:var(--muted)">状态</label>' +
    '<select id="pm-newprod-status" style="width:100%;box-sizing:border-box;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--fg);margin-top:4px">' +
      '<option value="normal">正常</option><option value="closed">已关闭</option>' +
    '</select></div>' +
    '<div style="margin-bottom:10px"><label style="font-size:11px;color:var(--muted)">描述</label>' +
    '<textarea class="search-inp" id="pm-newprod-desc" rows="2" placeholder="产品描述（可选）" style="width:100%;box-sizing:border-box;margin-top:4px;resize:vertical"></textarea></div>' +
    '<div style="margin-bottom:10px"><label style="font-size:11px;color:var(--muted)">关联项目 <span style="font-weight:400">（可选，可多选）</span></label>' +
    '<div style="max-height:160px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;padding:8px;margin-top:4px;background:var(--surface)">' + projectCheckboxes + '</div></div>',
    [{text: '取消', onclick: 'document.querySelector(\'.shared-dialog-overlay\').remove()'},
     {text: '添加', cls: 'btn-primary', onclick: '_pmCreateProduct()'}],
    {hideClose: true});
}

async function _pmCreateProduct() {
  var name = document.getElementById('pm-newprod-name').value.trim();
  var code = document.getElementById('pm-newprod-code').value.trim();
  var status = document.getElementById('pm-newprod-status').value;
  var desc = document.getElementById('pm-newprod-desc').value.trim();

  if (!name) { showToast('请输入产品名称', 'error'); return; }
  if (!code) { showToast('请输入产品编号', 'error'); return; }

  var projectIds = [];
  document.querySelectorAll('.pm-newprod-proj:checked').forEach(function(cb) {
    projectIds.push(parseInt(cb.value));
  });

  document.querySelector('.shared-dialog-overlay').remove();
  try {
    await API.post('/product-management/products', {
      name: name, code: code, node_id: _pmSelectedNodeId,
      status: status, description: desc, project_ids: projectIds
    });
    showToast('产品已创建: ' + name, 'ok');
    await refreshPMData();
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
          return '<label style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:12px;cursor:pointer">' +
            '<input type="checkbox" value="' + proj.id + '" class="pm-prodproj-cb"' + checked + '>' +
            escHtml(proj.code || '') + ' ' + escHtml(proj.name) +
          '</label>';
        }).join('')
      : '<span style="font-size:12px;color:var(--muted)">暂无可选项目</span>';

    openDialog('管理项目关联 — ' + escHtml(productName),
      '<div style="margin-bottom:12px">' +
        '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">选择关联的项目（可多选）</label>' +
        '<div style="max-height:300px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;padding:8px;background:var(--surface)">' +
          checkboxesHtml +
        '</div>' +
        '<div style="font-size:10.5px;color:var(--muted);margin-top:4px">勾选即关联，取消勾选即解除关联。保存时会替换所有关联。</div>' +
      '</div>',
      [{text: '取消', onclick: 'document.querySelector(\'.shared-dialog-overlay\').remove()'},
       {text: '保存', cls: 'btn-primary', onclick: '_pmSaveProductProjects(' + productId + ')'}],
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
  document.querySelector('.shared-dialog-overlay').remove();
  try {
    await API.put('/product-management/products/' + productId + '/projects', { project_ids: projectIds });
    showToast('项目关联已更新', 'ok');
    await refreshPMData();
  } catch (e) {
    showToast('更新失败: ' + (e.detail || e.message), 'error');
  }
}

/* ── Refresh ── */

async function refreshPMData() {
  try {
    _pmTree = (await API.get('/product-management/tree')) || [];
    _pmAllProducts = (await API.get('/product-management/all-products')) || [];
    _pmAllProjects = (await API.get('/product-management/all-projects')) || [];
  } catch (e) { /* ignore */ }
  await _pmLoadContent();
  renderProductManagementPage();
}
