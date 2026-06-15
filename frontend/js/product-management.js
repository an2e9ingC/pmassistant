/* ═══════════════════════════════════════════════════
   PRODUCT MANAGEMENT PAGE
   Left: Product hierarchy tree (from pma_product_lines)
   Right: Products & Projects linked to selected node
═══════════════════════════════════════════════════ */

var _pmTree = [];              // [{id, name, parent_id, level, product_count, project_count, children}]
var _pmSelectedNodeId = null;  // currently selected tree node ID
var _pmNodeProducts = [];      // products linked to selected node
var _pmNodeProjects = [];      // projects linked to selected node's products
var _pmExpandedNodes = {};     // {nodeId: true}
var _pmAllProducts = [];       // all products (for dropdowns)
var _pmAllProjects = [];       // all projects (for dropdowns)
var _pmIsAdmin = false;        // whether current user has admin access

var PM_TREE_ICONS = ['', '📁', '📂', '📄'];  // level 1/2/3

/* ── Init ── */

async function initProductManagement() {
  var user = getCurrentUser();
  var perms = (user && user.permissions) ? user.permissions.split(',') : [];
  _pmIsAdmin = user && (user.role === 'admin' || perms.indexOf('admin') >= 0);

  var container = document.getElementById('view-product-management');
  container.innerHTML = '<div class="loading-spinner">加载产品管理...</div>';

  try {
    // Load tree + all products + all projects in parallel
    var treeData = await API.get('/product-management/tree');
    _pmTree = treeData || [];

    // Load all products and projects for dropdowns
    try {
      _pmAllProducts = (await API.get('/product-management/all-products')) || [];
    } catch (e) {
      _pmAllProducts = [];
    }
    try {
      _pmAllProjects = (await API.get('/product-management/all-projects')) || [];
    } catch (e) {
      _pmAllProjects = [];
    }

    // Auto-expand level 1 only (L2 collapsed → hides L3)
    _pmExpandedNodes = {};
    function _pmSetExpand(nodes) {
      nodes.forEach(function (n) {
        if (n.level === 1) {
          _pmExpandedNodes[n.id] = true;
        } else if (n.level === 2) {
          _pmExpandedNodes[n.id] = false;
        }
        if (n.children && n.children.length) _pmSetExpand(n.children);
      });
    }
    _pmSetExpand(_pmTree);

    // Select first leaf or first node
    if (!_pmSelectedNodeId || !_pmFindNodeById(_pmSelectedNodeId)) {
      _pmSelectedNodeId = _pmFindFirstLeaf() || (_pmTree.length ? _pmTree[0].id : null);
    }
    if (_pmSelectedNodeId) {
      await _pmLoadNodeContent(_pmSelectedNodeId);
    }
    renderProductManagementPage();
  } catch (e) {
    container.innerHTML = '<div class="error-state">加载失败: ' + escHtml(e.message) +
      '<br><button class="btn" onclick="initProductManagement()">重试</button></div>';
  }
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

function _pmFindFirstLeaf() {
  return _pmFindFirstLeafIn(_pmTree);
}

function _pmFindFirstLeafIn(nodes) {
  for (var i = 0; i < nodes.length; i++) {
    if (!nodes[i].children || !nodes[i].children.length) return nodes[i].id;
    var found = _pmFindFirstLeafIn(nodes[i].children);
    if (found) return found;
  }
  return null;
}

function _pmGetBreadcrumb(nodeId) {
  var node = _pmFindNodeById(nodeId);
  if (!node) return [];
  var path = [node.name];
  var parentId = node.parent_id;
  while (parentId) {
    var p = _pmFindNodeById(parentId);
    if (!p) break;
    path.unshift(p.name);
    parentId = p.parent_id;
  }
  return path;
}

/* ── Load Node Content ── */

async function _pmLoadNodeContent(nodeId) {
  try {
    _pmNodeProducts = (await API.get('/product-management/nodes/' + nodeId + '/products')) || [];
  } catch (e) {
    _pmNodeProducts = [];
  }
  try {
    _pmNodeProjects = (await API.get('/product-management/nodes/' + nodeId + '/projects')) || [];
  } catch (e) {
    _pmNodeProjects = [];
  }
}

/* ── Main Render ── */

function renderProductManagementPage() {
  var selNode = _pmFindNodeById(_pmSelectedNodeId);

  // ── Top button bar (admin only) ──
  var topBarHtml = '';
  if (_pmIsAdmin) {
    topBarHtml = '<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">' +
      '<button class="btn btn-primary" style="font-size:12px;padding:5px 14px" onclick="_pmShowAddProductLineDialog()">+ 新增产品线</button>' +
      '<button class="btn btn-primary" style="font-size:12px;padding:5px 14px" onclick="_pmShowAddProductSeriesDialog()">+ 新增产品系列</button>' +
      '<button class="btn btn-primary" style="font-size:12px;padding:5px 14px" onclick="_pmShowAddProductModelDialog()">+ 添加产品型号</button>' +
      '<span style="font-size:10.5px;color:var(--muted);align-self:center;margin-left:4px">一级 / 二级 / 三级</span>' +
    '</div>';
  }

  // Build left panel: tree (read-only structure display)
  var leftHtml = '<div class="section-title" style="margin-bottom:10px">产品架构</div>';
  _pmTree.forEach(function (n) {
    leftHtml += _pmRenderTreeNode(n, 0);
  });

  // Breadcrumb
  var crumbs = selNode ? _pmGetBreadcrumb(_pmSelectedNodeId) : [];
  var titleHtml = crumbs.length
    ? crumbs.join(' <span style="color:var(--muted);font-weight:300">›</span> ')
    : '选择产品节点';

  // Right panel
  var rightHtml = '<div class="dt-right">';
  rightHtml += '<div class="dt-right-head">';
  rightHtml += '<div class="section-title">' + titleHtml + '</div>';
  rightHtml += '<div style="display:flex;gap:6px">';
  if (_pmIsAdmin && selNode) {
    rightHtml += '<button class="btn btn-primary" style="font-size:11px;padding:4px 12px" onclick="_pmShowLinkProductDialog()">+ 关联已有产品</button>';
    if (selNode.level >= 3) {
      rightHtml += '<button class="btn btn-primary" style="font-size:11px;padding:4px 12px" onclick="_pmShowCreateProductDialog()">+ 新建产品</button>';
    }
  }
  rightHtml += '</div></div>';

  if (!selNode) {
    rightHtml += '<div class="empty-state" style="padding:20px">请从左侧选择产品节点</div>';
  } else {
    // Products table
    rightHtml += '<div class="section-hd" style="margin-top:14px"><div class="section-title">关联产品 (' + _pmNodeProducts.length + ')</div></div>';
    if (_pmNodeProducts.length) {
      rightHtml += '<div class="table-scroll" style="max-height:300px"><table class="stage-table"><thead><tr>' +
        '<th>编号</th><th>产品名</th><th>状态</th><th>关联项目数</th><th>来源</th>' +
        (_pmIsAdmin ? '<th style="width:100px">操作</th>' : '') +
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
      rightHtml += '<div class="empty-state" style="padding:12px;font-size:13px">该节点暂无关联产品' +
        (selNode.level < 3 ? '<br><span style="color:var(--muted)">建议关联到三级产品型号节点</span>' : '') +
      '</div>';
    }

    // Projects table
    rightHtml += '<div class="section-hd" style="margin-top:18px"><div class="section-title">关联项目 (' + _pmNodeProjects.length + ')</div></div>';
    if (_pmNodeProjects.length) {
      rightHtml += '<div class="table-scroll" style="max-height:300px"><table class="stage-table"><thead><tr>' +
        '<th>编号</th><th>项目名</th><th>类型</th><th>状态</th><th>关联产品</th><th>来源</th>' +
        '</tr></thead><tbody>';
      _pmNodeProjects.forEach(function (proj) {
        var productNames = (proj.product_names || []).slice(0, 3).join(', ');
        if ((proj.product_names || []).length > 3) productNames += ' ...';
        rightHtml += '<tr onclick="openProject(\'' + proj.id + '\')" style="cursor:pointer">' +
          '<td style="font-family:var(--mono);font-size:12px">' + escHtml(proj.code || '') + '</td>' +
          '<td style="font-weight:500">' + escHtml(proj.name) + '</td>' +
          '<td>' + renderTypeBadge(proj.project_type) + '</td>' +
          '<td>' + renderPill(proj.status) + '</td>' +
          '<td style="font-size:12px;color:var(--muted)">' + escHtml(productNames || '—') + '</td>' +
          '<td>' + (proj.is_local ? '<span class="pm-src-badge local">PMA本地</span>' : (proj.synced_at ? '<span class="pm-src-badge synced" title="同步于 ' + escHtml(proj.synced_at) + '">禅道同步</span>' : '<span class="pm-src-badge unknown">未知</span>')) + '</td>' +
        '</tr>';
      });
      rightHtml += '</tbody></table></div>';
    } else {
      rightHtml += '<div class="empty-state" style="padding:12px;font-size:13px">该节点下产品暂未关联项目</div>';
    }
  }
  rightHtml += '</div>'; // .dt-right

  document.getElementById('view-product-management').innerHTML =
    topBarHtml +
    '<div class="dt-layout">' +
      '<div class="dt-left">' + leftHtml + '</div>' +
      rightHtml +
    '</div>';
}

/* ── Tree Node Rendering ── */

function _pmRenderTreeNode(node, depth) {
  var collapsed = _pmExpandedNodes[node.id] === false;
  var hasChildren = node.children && node.children.length > 0;
  var isSelected = node.id === _pmSelectedNodeId;
  var indent = depth * 18;

  var html = '<div class="dt-tree-node' +
    (isSelected ? ' selected' : '') +
    '" style="padding-left:' + (4 + indent) + 'px" onclick="_pmSelectNode(' + node.id + ')" ondblclick="event.stopPropagation();_pmToggleNode(' + node.id + ')">';

  // Arrow
  if (hasChildren) {
    html += '<span class="dt-tree-arrow' + (collapsed ? ' collapsed' : '') +
      '" onclick="event.stopPropagation();_pmToggleNode(' + node.id + ')">▼</span>';
  } else {
    html += '<span style="width:16px;flex-shrink:0"></span>';
  }

  // Icon
  html += '<span class="dt-tree-icon">' + (PM_TREE_ICONS[node.level] || '📄') + '</span>';

  // Name
  html += '<span class="dt-tree-label">' + escHtml(node.name) + '</span>';

  // Badges
  html += '<span class="dt-tree-badge" style="background:var(--accent-lt);color:var(--accent)">' + (node.product_count || 0) + '</span>';
  if (node.project_count) {
    html += '<span class="dt-tree-badge" style="background:var(--success-lt);color:var(--success);margin-left:2px">' + node.project_count + '</span>';
  }

  // Actions (hover, admin only) — add operations moved to top button bar
  if (_pmIsAdmin) {
    html += '<span class="dt-tree-acts">';
    html += '<button class="btn" style="font-size:10px;padding:1px 5px" onclick="event.stopPropagation();_pmShowRenameNodeDialog(' + node.id + ')" title="重命名">✎</button>';
    html += '<button class="btn" style="font-size:10px;padding:1px 5px;color:var(--danger)" onclick="event.stopPropagation();_pmDeleteNode(' + node.id + ')" title="删除">✕</button>';
    html += '</span>';
  }

  html += '</div>';

  // Children
  if (hasChildren) {
    html += '<div class="dt-tree-children' + (collapsed ? ' collapsed' : '') + '">';
    node.children.forEach(function (child) {
      html += _pmRenderTreeNode(child, depth + 1);
    });
    html += '</div>';
  }

  return html;
}

/* ── Tree Interactions ── */

function _pmToggleNode(nodeId) {
  _pmExpandedNodes[nodeId] = !_pmExpandedNodes[nodeId];
  renderProductManagementPage();
}

async function _pmSelectNode(nodeId) {
  _pmSelectedNodeId = nodeId;
  await _pmLoadNodeContent(nodeId);
  renderProductManagementPage();
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
    _pmTree = (await API.get('/product-management/tree')) || [];
    if (_pmSelectedNodeId) await _pmLoadNodeContent(_pmSelectedNodeId);
    renderProductManagementPage();
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
    _pmTree = (await API.get('/product-management/tree')) || [];
    if (!_pmFindNodeById(_pmSelectedNodeId)) {
      _pmSelectedNodeId = _pmFindFirstLeaf() || (_pmTree.length ? _pmTree[0].id : null);
    }
    if (_pmSelectedNodeId) await _pmLoadNodeContent(_pmSelectedNodeId);
    renderProductManagementPage();
  } catch (e) {
    showToast('删除失败: ' + (e.detail || e.message), 'error');
  }
}

/* ── Link Product to Node ── */

function _pmShowLinkProductDialog() {
  // Filter out already-linked products
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

  openDialog('关联已有产品 — 到「' + escHtml((_pmFindNodeById(_pmSelectedNodeId) || {}).name || '') + '」',
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

/* ── Create Local Product ── */

function _pmShowCreateProductDialog() {
  var node = _pmFindNodeById(_pmSelectedNodeId);
  // Project checkbox list
  var projectCheckboxes = _pmAllProjects.length
    ? _pmAllProjects.slice(0, 50).map(function(proj) {
        return '<label style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:12px;cursor:pointer">' +
          '<input type="checkbox" value="' + proj.id + '" class="pm-newprod-proj">' +
          escHtml(proj.code || '') + ' ' + escHtml(proj.name) +
        '</label>';
      }).join('')
    : '<span style="font-size:12px;color:var(--muted)">暂无可选项目</span>';

  openDialog('新建产品 — 归属于「' + escHtml(node ? node.name : '') + '」',
    '<div style="margin-bottom:10px"><label style="font-size:11px;color:var(--muted)">产品名称 *</label>' +
    '<input class="search-inp" id="pm-newprod-name" placeholder="如：VPX-6206" style="width:100%;box-sizing:border-box;margin-top:4px"></div>' +
    '<div style="margin-bottom:10px"><label style="font-size:11px;color:var(--muted)">产品编号 *</label>' +
    '<input class="search-inp" id="pm-newprod-code" placeholder="如：PROD-VPX6206" style="width:100%;box-sizing:border-box;margin-top:4px"></div>' +
    '<div style="margin-bottom:10px"><label style="font-size:11px;color:var(--muted)">状态</label>' +
    '<select id="pm-newprod-status" style="width:100%;box-sizing:border-box;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--fg);margin-top:4px">' +
      '<option value="normal">正常</option><option value="closed">已关闭</option>' +
    '</select></div>' +
    '<div style="margin-bottom:10px"><label style="font-size:11px;color:var(--muted)">描述</label>' +
    '<textarea class="search-inp" id="pm-newprod-desc" rows="2" placeholder="产品描述（可选）" style="width:100%;box-sizing:border-box;margin-top:4px;resize:vertical"></textarea></div>' +
    '<div style="margin-bottom:10px"><label style="font-size:11px;color:var(--muted)">关联项目 <span style="font-weight:400">（可选，可多选）</span></label>' +
    '<div style="max-height:160px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;padding:8px;margin-top:4px;background:var(--surface)">' + projectCheckboxes + '</div></div>',
    [{text: '取消', onclick: 'document.querySelector(\'.shared-dialog-overlay\').remove()'},
     {text: '创建', cls: 'btn-primary', onclick: '_pmCreateProduct()'}],
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

/* ── Add Product Model (level 3) with parent selection ── */

function _pmShowAddProductModelDialog() {
  // Collect level-1 nodes (产品线) and level-2 nodes (产品系列)
  var level1Nodes = [];
  var level2Nodes = [];
  function collectNodes(nodes) {
    nodes.forEach(function(n) {
      if (n.level === 1) level1Nodes.push(n);
      if (n.level === 2) level2Nodes.push(n);
      if (n.children && n.children.length) collectNodes(n.children);
    });
  }
  collectNodes(_pmTree);

  var l1Options = level1Nodes.length
    ? '<option value="">— 请选择 —</option>' + level1Nodes.map(function(n) {
        return '<option value="' + n.id + '">' + escHtml(n.name) + '</option>';
      }).join('')
    : '<option value="">暂无产品线，请先创建</option>';

  var l2Options = '<option value="">— 请先选择产品线 —</option>';

  openDialog('添加产品型号',
    '<div style="margin-bottom:10px"><label style="font-size:11px;color:var(--muted)">一级 — 产品线</label>' +
    '<select id="pm-model-l1" style="width:100%;box-sizing:border-box;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--fg);margin-top:4px" onchange="_pmModelL1Changed()">' + l1Options + '</select></div>' +
    '<div style="margin-bottom:10px"><label style="font-size:11px;color:var(--muted)">二级 — 产品系列</label>' +
    '<select id="pm-model-l2" style="width:100%;box-sizing:border-box;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--fg);margin-top:4px" onchange="_pmModelL2Changed()">' + l2Options + '</select></div>' +
    '<div style="margin-bottom:10px"><label style="font-size:11px;color:var(--muted)">三级 — 产品型号名称 *</label>' +
    '<input class="search-inp" id="pm-model-name" placeholder="如：VPX-6206" style="width:100%;box-sizing:border-box;margin-top:4px"></div>',
    [{text: '取消', onclick: 'document.querySelector(\'.shared-dialog-overlay\').remove()'},
     {text: '确定', cls: 'btn-primary', onclick: '_pmAddProductModel()'}],
    {hideClose: true});
}

function _pmModelL1Changed() {
  var l1Id = parseInt(document.getElementById('pm-model-l1').value) || 0;
  var l2Sel = document.getElementById('pm-model-l2');
  if (!l1Id) {
    l2Sel.innerHTML = '<option value="">— 请先选择产品线 —</option>';
    return;
  }
  // Find the level-1 node and collect its direct children (level 2)
  var l1Node = _pmFindNodeById(l1Id);
  var children = (l1Node && l1Node.children) ? l1Node.children : [];
  if (children.length) {
    l2Sel.innerHTML = '<option value="">— 请选择 —</option>' + children.map(function(n) {
      return '<option value="' + n.id + '">' + escHtml(n.name) + '</option>';
    }).join('');
  } else {
    l2Sel.innerHTML = '<option value="">该产品线下暂无系列</option>';
  }
}

function _pmModelL2Changed() {
  // No action needed — just for UX
}

async function _pmAddProductModel() {
  var l1Id = parseInt(document.getElementById('pm-model-l1').value) || 0;
  var l2Id = parseInt(document.getElementById('pm-model-l2').value) || 0;
  var name = document.getElementById('pm-model-name').value.trim();

  if (!l1Id) { showToast('请选择产品线', 'error'); return; }
  if (!l2Id) { showToast('请选择产品系列', 'error'); return; }
  if (!name) { showToast('请输入产品型号名称', 'error'); return; }

  document.querySelector('.shared-dialog-overlay').remove();
  try {
    await API.post('/product-doc-templates/product-nodes', {name: name, parent_id: l2Id, sort_order: 0});
    showToast('已添加产品型号: ' + name, 'ok');
    await refreshPMData();
    // Select the new node if found
    _pmExpandedNodes[l1Id] = true;
    _pmExpandedNodes[l2Id] = true;
  } catch (e) {
    showToast('添加失败: ' + (e.detail || e.message), 'error');
  }
}

/* ── Add Product Line (level 1) ── */

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

/* ── Add Product Series (level 2, needs level-1 parent) ── */

function _pmShowAddProductSeriesDialog() {
  var level1Nodes = [];
  function collectL1(nodes) {
    nodes.forEach(function(n) {
      if (n.level === 1) level1Nodes.push(n);
      if (n.children && n.children.length) collectL1(n.children);
    });
  }
  collectL1(_pmTree);

  var l1Options = level1Nodes.length
    ? '<option value="">— 请选择 —</option>' + level1Nodes.map(function(n) {
        return '<option value="' + n.id + '">' + escHtml(n.name) + '</option>';
      }).join('')
    : '<option value="">暂无产品线，请先创建</option>';

  openDialog('新增产品系列',
    '<div style="margin-bottom:10px"><label style="font-size:11px;color:var(--muted)">所属产品线</label>' +
    '<select id="pm-series-l1" style="width:100%;box-sizing:border-box;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--fg);margin-top:4px">' + l1Options + '</select></div>' +
    '<div style="margin-bottom:10px"><label style="font-size:11px;color:var(--muted)">产品系列名称</label>' +
    '<input class="search-inp" id="pm-series-name" placeholder="如：VPX系列" style="width:100%;box-sizing:border-box;margin-top:4px"></div>',
    [{text: '取消', onclick: 'document.querySelector(\'.shared-dialog-overlay\').remove()'},
     {text: '确定', cls: 'btn-primary', onclick: '_pmAddProductSeries()'}],
    {hideClose: true});
}

async function _pmAddProductSeries() {
  var l1Id = parseInt(document.getElementById('pm-series-l1').value) || 0;
  var name = document.getElementById('pm-series-name').value.trim();

  if (!l1Id) { showToast('请选择所属产品线', 'error'); return; }
  if (!name) { showToast('请输入产品系列名称', 'error'); return; }

  document.querySelector('.shared-dialog-overlay').remove();
  try {
    await API.post('/product-doc-templates/product-nodes', {name: name, parent_id: l1Id, sort_order: 0});
    showToast('已添加产品系列: ' + name, 'ok');
    _pmExpandedNodes[l1Id] = true;
    await refreshPMData();
  } catch (e) {
    showToast('添加失败: ' + (e.detail || e.message), 'error');
  }
}

/* ── Manage Product-Project Associations ── */

function _pmShowManageProductProjects(productId, productName) {
  // Load current project links for this product
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
  } catch (e) {
    // ignore individual failures
  }
  if (_pmSelectedNodeId) {
    await _pmLoadNodeContent(_pmSelectedNodeId);
  }
  renderProductManagementPage();
}
