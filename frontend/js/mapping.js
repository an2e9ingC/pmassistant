/* ═══════════════════════════════════════════════════
   PRODUCT-PROJECT MAPPING VIEW
   Strictly follows pm-platform.html original design
═══════════════════════════════════════════════════ */

var _mapTab = 'product';
var _mapProducts = [];
var _mapProjects = [];
var _mapDetailCache = {}; // projectId -> { products: [...], description: "", customer_from_desc: "" }
var _curProdCat = null;
var _curProjCust = null;
var _prodViewStyle = 'tree'; // 'tree' (sidebar+cards) | 'mindmap'
var _projViewStyle = 'tree';

/* ── Init ── */

async function renderMapping() {
  var results = await Promise.all([
    API.get('/products?limit=200').catch(function() { return { items: [] }; }),
    API.get('/projects').catch(function() { return []; }),
  ]);
  _mapProducts = results[0].items || [];
  _mapProjects = results[1] || [];

  // Preload all project details
  _mapDetailCache = {};
  await Promise.all(_mapProjects.map(function(pj) {
    return API.get('/projects/' + pj.id).then(function(detail) {
      _mapDetailCache[pj.id] = detail || {};
    }).catch(function() {
      _mapDetailCache[pj.id] = {};
    });
  }));

  switchMapTab(_mapTab);
}

/* ── Helper ── */

function _getProjectCustomer(pj) {
  var detail = _mapDetailCache[pj.id];
  var c = (detail && detail.customer_from_desc) ? detail.customer_from_desc : '';
  // Safety: strip any HTML tags that may have leaked through
  c = stripHtml(c).trim();
  return c || '未知';
}

/* ── Tab Switching ── */

function switchMapTab(tab, el) {
  _mapTab = tab;
  if (el) {
    document.querySelectorAll('#map-tabs .tab').forEach(function(t) { t.classList.remove('active'); });
    el.classList.add('active');
  }
  ['product', 'customer', 'projectid', 'matrix'].forEach(function(v) {
    var view = document.getElementById('map-view-' + v);
    if (view) view.style.display = v === tab ? '' : 'none';
  });

  if (tab === 'product') {
    renderProdCategorySidebar();
  } else if (tab === 'customer') {
    renderProjCategorySidebar();
  } else if (tab === 'projectid') {
    document.getElementById('projid-search-input').value = '';
    document.getElementById('projid-result').innerHTML = '<div class="projid-empty">请输入项目编号进行搜索</div>';
  } else if (tab === 'matrix') {
    renderMatrix();
  }
}

/* ── Search ── */

function filterMapCards(q) {
  var v = q.trim().toLowerCase();

  // Product category sidebar
  document.querySelectorAll('#prod-cat-list .prod-cat-item').forEach(function(item) {
    var text = item.textContent.toLowerCase();
    item.style.display = !v || text.indexOf(v) >= 0 ? '' : 'none';
  });

  // Product tree sections
  document.querySelectorAll('.prod-tree-section').forEach(function(sec) {
    var prod = sec.querySelector('.prod-tree-prod');
    if (!prod) return;
    var text = prod.textContent.toLowerCase();
    sec.style.display = !v || text.indexOf(v) >= 0 ? '' : 'none';
  });

  // Customer sidebar
  document.querySelectorAll('#proj-cat-list .prod-cat-item').forEach(function(item) {
    var text = item.textContent.toLowerCase();
    item.style.display = !v || text.indexOf(v) >= 0 ? '' : 'none';
  });

  // Project tree sections
  document.querySelectorAll('#proj-tree-container .proj-tree-proj').forEach(function(proj) {
    var text = proj.textContent.toLowerCase();
    var section = proj.closest('.proj-tree-section');
    if (section) {
      section.style.display = !v || text.indexOf(v) >= 0 ? '' : 'none';
    }
  });

  // Matrix rows
  document.querySelectorAll('#matrix-tbl tbody tr').forEach(function(row) {
    var text = row.textContent.toLowerCase();
    row.style.display = !v || text.indexOf(v) >= 0 ? '' : 'none';
  });

  // Mindmap nodes
  ['mm-product-canvas', 'mm-project-canvas'].forEach(function(cid) {
    var container = document.getElementById(cid);
    if (!container) return;
    container.querySelectorAll('.mm-leaf-nd, .mm-cat-nd, .mm-root-nd').forEach(function(el) {
      var searchText = (el.dataset.search || el.textContent || '').toLowerCase();
      el.classList.toggle('mm-hidden', v && searchText.indexOf(v) < 0);
    });
  });
}

/* ═══════════════════════════════════════════════════
   TAB 1: 从产品查项目
═══════════════════════════════════════════════════ */

function switchProdViewStyle(style, el) {
  _prodViewStyle = style;
  document.querySelectorAll('#map-view-product .map-style-btn').forEach(function(b) { b.classList.remove('active'); });
  if (el) el.classList.add('active');
  document.getElementById('prod-view-tree').style.display = style === 'tree' ? '' : 'none';
  document.getElementById('mm-product-container').style.display = style === 'mindmap' ? '' : 'none';
}

function renderProdCategorySidebar() {
  // Build category list from program_name
  var cats = {};
  _mapProducts.forEach(function(p) {
    var cat = p.category || '未分类';
    if (!cats[cat]) cats[cat] = 0;
    cats[cat]++;
  });

  var keys = Object.keys(cats).sort();
  var list = document.getElementById('prod-cat-list');
  var html = keys.map(function(cat) {
    var cls = _curProdCat === cat ? 'prod-cat-item active' : 'prod-cat-item';
    return '<div class="' + cls + '" onclick="selectProdCategory(\'' + escHtml(cat).replace(/'/g, "&#39;") + '\')">' +
      '<span>' + escHtml(cat) + '</span>' +
      '<span class="cat-count">' + cats[cat] + '</span></div>';
  }).join('');

  if (!html) {
    html = '<div style="padding:12px;font-size:12px;color:var(--muted);text-align:center">暂无产品</div>';
  }
  // Auto-select first if nothing selected
  if (!_curProdCat && keys.length > 0) _curProdCat = keys[0];

  list.innerHTML = html;

  // Render tree for current category
  if (_curProdCat) {
    renderProdTree(_curProdCat);
  }
}

function selectProdCategory(catId) {
  _curProdCat = catId;
  renderProdCategorySidebar();
  renderProdTree(catId);
}

function renderProdTree(catId) {
  var container = document.getElementById('prod-tree-container');
  var products = _mapProducts.filter(function(p) { return (p.category || '未分类') === catId; });
  if (!products.length) {
    container.innerHTML = '<div class="prod-tree-empty">该分类下暂无产品</div>';
    return;
  }

  container.innerHTML = products.map(function(prod) {
    // Find linked projects
    var linkedProjects = _mapProjects.filter(function(pj) {
      var detail = _mapDetailCache[pj.id];
      return detail && detail.products && detail.products.some(function(pr) { return pr.id === prod.id; });
    });

    // Customer tags from project descriptions
    var custIcons = '';
    var custSet = {};
    linkedProjects.forEach(function(pj) {
      var detail = _mapDetailCache[pj.id];
      var c = (detail && detail.customer_from_desc) ? detail.customer_from_desc : '';
      if (c) custSet[c] = true;
    });
    var custKeys = Object.keys(custSet);
    if (custKeys.length) {
      custIcons = custKeys.map(function(c) {
        return '<span style="font-size:10px;color:var(--accent);background:var(--accent-lt);padding:1px 5px;border-radius:3px">' + escHtml(c) + '</span>';
      }).join('');
    }

    var projCount = linkedProjects.length;

    return '<div class="prod-tree-section">' +
      '<div class="prod-tree-prod" data-prod="' + prod.id + '" onclick="toggleProdTree(\'' + prod.id + '\')">' +
        '<div class="prod-tree-prod-header">' +
          '<div class="prod-tree-prod-title">' +
            '<span class="map-card-code">' + escHtml(prod.code || '#' + prod.id) + '</span>' +
            '<span>' + escHtml(prod.name) + '</span>' +
            (prod.category ? '<span class="badge badge-' + (prod.category === '存储' ? 'rd' : 'sc') + '" style="font-size:10px;padding:1px 6px">' + escHtml(prod.category) + '</span>' : '') +
            custIcons +
          '</div>' +
          '<div class="prod-tree-toggle" id="toggle-' + prod.id + '">&#9654;</div>' +
        '</div>' +
        '<div class="prod-tree-prod-meta">关联 ' + projCount + ' 个项目' +
          (prod.nas_path ? ' · <a class="doc-link" href="' + escHtml(prod.nas_path) + '" target="_blank" onclick="event.stopPropagation()" style="font-size:10px">NAS</a>' : '') +
          (prod.git_url ? ' · <a class="doc-link" href="' + escHtml(prod.git_url) + '" target="_blank" onclick="event.stopPropagation()" style="font-size:10px">Git</a>' : '') +
        '</div>' +
        '<div class="prod-tree-projs" id="projs-' + prod.id + '">' +
          (projCount ? linkedProjects.map(function(pj) {
            var pjDetail = _mapDetailCache[pj.id];
            var pjDesc = (pjDetail && pjDetail.description) ? stripHtml(pjDetail.description) : '';
            var pjDescSnippet = pjDesc.length > 150 ? pjDesc.substring(0, 150) + '...' : pjDesc;
            return '<div class="proj-tree-prod-item" onclick="openProject(\'' + pj.id + '\'); event.stopPropagation();" style="cursor:pointer">' +
              '<div class="proj-tree-prod-name">' +
                renderProjectIdBlock(pj.name, pj.customer_name) +
                ' <span style="font-size:10px;color:var(--muted)">' + (pj.project_type === 'SC' ? '生产' : '研发') + '</span>' +
              '</div>' +
              (pjDescSnippet ? '<div class="proj-tree-prod-meta">' + escHtml(pjDescSnippet) + '</div>' : '') +
            '</div>';
          }).join('') : '<div style="font-size:11px;color:var(--muted);padding:8px 0">暂无关联项目 — ' +
            '<span style="cursor:pointer;color:var(--accent)" onclick="event.stopPropagation();showLinkDialog(\'product\',' + prod.id + ',\'' + escHtml(prod.name).replace(/'/g, "\\'") + '\')">立即关联</span></div>') +
        '</div>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:6px;margin-top:8px">' +
        '<button class="btn" style="font-size:10.5px;padding:2px 8px" onclick="event.stopPropagation();showLinkDialog(\'product\',' + prod.id + ',\'' + escHtml(prod.name).replace(/'/g, "\\'") + '\')">+ 关联项目</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

function toggleProdTree(prodId) {
  var el = document.querySelector('.prod-tree-prod[data-prod="' + prodId + '"]');
  var toggle = document.getElementById('toggle-' + prodId);
  var projs = document.getElementById('projs-' + prodId);
  if (!el || !toggle || !projs) return;
  var isOpen = el.classList.contains('expanded');
  if (isOpen) {
    el.classList.remove('expanded');
    toggle.classList.remove('open');
    projs.classList.remove('show');
  } else {
    el.classList.add('expanded');
    toggle.classList.add('open');
    projs.classList.add('show');
  }
}

/* ═══════════════════════════════════════════════════
   TAB 2: 从客户查项目
═══════════════════════════════════════════════════ */

function switchProjViewStyle(style, el) {
  _projViewStyle = style;
  document.querySelectorAll('#map-view-customer .map-style-btn').forEach(function(b) { b.classList.remove('active'); });
  if (el) el.classList.add('active');
  document.getElementById('proj-view-tree').style.display = style === 'tree' ? '' : 'none';
  document.getElementById('mm-project-container').style.display = style === 'mindmap' ? '' : 'none';
}

function renderProjCategorySidebar() {
  var custs = {};
  _mapProjects.forEach(function(p) {
    var c = _getProjectCustomer(p);
    if (!custs[c]) custs[c] = 0;
    custs[c]++;
  });

  var keys = Object.keys(custs).sort();
  var list = document.getElementById('proj-cat-list');
  var html = keys.map(function(cust) {
    var cls = _curProjCust === cust ? 'prod-cat-item active' : 'prod-cat-item';
    var abbr = cust.length > 6 ? cust.substring(0, 6) : cust;
    return '<div class="' + cls + '" onclick="selectProjCustomer(\'' + escHtml(cust).replace(/'/g, "&#39;") + '\')">' +
      '<span>' + escHtml(abbr) + '</span>' +
      '<span class="cat-count">' + custs[cust] + '</span></div>';
  }).join('');

  if (!html) {
    html = '<div style="padding:12px;font-size:12px;color:var(--muted);text-align:center">暂无项目</div>';
  }
  if (!_curProjCust && keys.length > 0) _curProjCust = keys[0];

  list.innerHTML = html;

  if (_curProjCust) {
    renderProjTree(_curProjCust);
  }
}

function selectProjCustomer(custId) {
  _curProjCust = custId;
  renderProjCategorySidebar();
  renderProjTree(custId);
}

function renderProjTree(custId) {
  var container = document.getElementById('proj-tree-container');
  var projects = _mapProjects.filter(function(p) { return _getProjectCustomer(p) === custId; });
  if (!projects.length) {
    container.innerHTML = '<div class="prod-tree-empty">该客户下暂无项目</div>';
    return;
  }

  container.innerHTML = projects.map(function(pj) {
    var detail = _mapDetailCache[pj.id] || {};
    var descText = stripHtml(detail.description || '');
    var descSnippet = descText.length > 200 ? descText.substring(0, 200) + '...' : descText;
    var productCount = (detail.products || []).length;

    return '<div class="proj-tree-section">' +
      '<div class="proj-tree-proj" data-proj="' + pj.id + '" onclick="toggleProjTree(\'' + pj.id + '\')">' +
        '<div class="proj-tree-proj-header">' +
          '<div class="proj-tree-proj-title">' +
            renderProjIcon(pj.project_type, extractProjectCode(pj.name)) +
            '<span class="map-card-code">' + escHtml(extractProjectCode(pj.name)) + '</span>' +
            '<span>' + escHtml(extractCoreName(pj.name)) + '</span>' +
            (pj.customer_name ? ' ' + renderCustomerBadge(pj.customer_name) : '') +
            renderPill(pj.status) +
          '</div>' +
          '<div class="proj-tree-toggle" id="proj-toggle-' + pj.id + '">&#9654;</div>' +
        '</div>' +
        '<div class="proj-tree-proj-meta">' +
          escHtml(extractCoreName(pj.name)) + ' · ' + (pj.project_type === 'SC' ? '生产' : '研发') + '项目 · ' +
          '关联 ' + productCount + ' 个产品' +
        '</div>' +
        (descSnippet ? '<div style="font-size:11px;color:var(--muted);margin-top:4px;padding-left:26px;line-height:1.5">' + escHtml(descSnippet) + '</div>' : '') +
        '<div class="proj-tree-prods" id="proj-prods-' + pj.id + '">' +
          (productCount ? detail.products.map(function(prod) {
            return '<div class="proj-tree-prod-item" onclick="openProject(\'' + pj.id + '\'); event.stopPropagation();">' +
              '<div class="proj-tree-prod-name">' + escHtml(prod.name) + '</div>' +
              '<div class="proj-tree-prod-meta">' + escHtml(prod.code || '') + (prod.category ? ' · ' + escHtml(prod.category) : '') + '</div>' +
              '<div class="proj-tree-chips">' +
                '<span class="map-unlink" onclick="event.stopPropagation();unlinkProduct(' + prod.id + ',' + pj.id + ')" title="取消关联">取消关联</span>' +
              '</div>' +
            '</div>';
          }).join('') : '<div style="font-size:11px;color:var(--muted);padding:8px 0">暂无关联产品 — ' +
            '<span style="cursor:pointer;color:var(--accent)" onclick="event.stopPropagation();showLinkDialog(\'project\',' + pj.id + ',\'' + escHtml(pj.customer_name || pj.name).replace(/'/g, "\\'") + '\')">立即关联</span></div>') +
        '</div>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:6px;margin-top:8px">' +
        '<button class="btn" style="font-size:10.5px;padding:2px 8px" onclick="event.stopPropagation();showLinkDialog(\'project\',' + pj.id + ',\'' + escHtml(pj.customer_name || pj.name).replace(/'/g, "\\'") + '\')">+ 关联产品</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

function toggleProjTree(projId) {
  var el = document.querySelector('.proj-tree-proj[data-proj="' + projId + '"]');
  var toggle = document.getElementById('proj-toggle-' + projId);
  var prods = document.getElementById('proj-prods-' + projId);
  if (!el || !toggle || !prods) return;
  var isOpen = el.classList.contains('expanded');
  if (isOpen) {
    el.classList.remove('expanded');
    toggle.classList.remove('open');
    prods.classList.remove('show');
  } else {
    el.classList.add('expanded');
    toggle.classList.add('open');
    prods.classList.add('show');
  }
}

/* ═══════════════════════════════════════════════════
   TAB 3: 按项目查产品 (Project ID Search)
═══════════════════════════════════════════════════ */

function searchProjectById(q) {
  var container = document.getElementById('projid-result');
  var term = q.trim().toLowerCase();
  if (!term) {
    container.innerHTML = '<div class="projid-empty">请输入项目编号进行搜索</div>';
    return;
  }

  var results = _mapProjects.filter(function(p) {
    return (p.code || '').toLowerCase().indexOf(term) >= 0 ||
           (p.name || '').toLowerCase().indexOf(term) >= 0 ||
           (p.customer_name || '').toLowerCase().indexOf(term) >= 0 ||
           String(p.id).indexOf(term) >= 0;
  });

  if (!results.length) {
    container.innerHTML = '<div class="projid-empty">未找到匹配的项目</div>';
    return;
  }

  container.innerHTML = results.map(function(p) {
    var detail = _mapDetailCache[p.id] || {};
    var prodHtml = '';
    if (detail.products && detail.products.length) {
      prodHtml = detail.products.map(function(prod) {
        return '<span class="projid-prod-chip">' + escHtml(prod.name) + (prod.category ? '<span style="font-size:10px;color:var(--muted)"> · ' + escHtml(prod.category) + '</span>' : '') + '</span>';
      }).join('');
    } else {
      prodHtml = '<span style="color:var(--muted);font-size:12px">无关联产品</span>';
    }

    return '<div class="projid-item" onclick="openProject(\'' + p.id + '\')" style="cursor:pointer">' +
      '<div class="projid-item-header">' +
        '<span class="projid-item-code">' + escHtml(extractProjectCode(p.name)) + '</span>' +
        '<span class="projid-item-type ' + (p.project_type === 'SC' ? 'sc' : 'rd') + '">' + (p.project_type === 'SC' ? '生产' : '研发') + '</span>' +
        (p.customer_name ? '<span class="projid-item-cust">' + renderCustomerBadge(p.customer_name) + '</span>' : '') +
        renderPill(p.status) +
      '</div>' +
      '<div style="font-size:12px;color:var(--muted);margin-bottom:8px">' + escHtml(extractCoreName(p.name)) + '</div>' +
      '<div class="projid-item-prods">' + prodHtml + '</div>' +
    '</div>';
  }).join('');
}

/* ═══════════════════════════════════════════════════
   TAB 4: 关系矩阵 (Matrix)
═══════════════════════════════════════════════════ */

function renderMatrix() {
  if (!_mapProducts.length || !_mapProjects.length) {
    document.getElementById('matrix-tbl').innerHTML =
      '<tr><th>产品 \\ 项目</th></tr><tr><td style="text-align:center;padding:30px;color:var(--muted)">暂无数据</td></tr>';
    return;
  }

  var headHtml = '<tr><th>产品 \\ 项目</th>' +
    _mapProjects.map(function(p) {
      return '<th style="min-width:88px;font-size:10px">' + escHtml(extractProjectCode(p.name)) +
        (p.customer_name ? '<br>' + renderCustomerBadge(p.customer_name) : '') + '</th>';
    }).join('') +
  '</tr>';

  // Group products by category
  var catOrder = [];
  var catGroups = {};
  _mapProducts.forEach(function(prod) {
    var cat = prod.category || '未分类';
    if (!catGroups[cat]) { catGroups[cat] = []; catOrder.push(cat); }
    catGroups[cat].push(prod);
  });

  var bodyHtml = '';
  catOrder.forEach(function(cat) {
    bodyHtml += '<tr>' +
      '<td colspan="' + (_mapProjects.length + 1) + '" style="padding:7px 14px;background:var(--bg);border-bottom:1px solid var(--border)">' +
        '<span style="font-size:11px;font-weight:640;color:var(--fg);text-transform:uppercase;letter-spacing:0.05em">' + escHtml(cat) + '</span>' +
        '<span style="font-size:11px;color:var(--muted);margin-left:6px">' + catGroups[cat].length + ' 个产品</span>' +
      '</td>' +
    '</tr>';

    catGroups[cat].forEach(function(prod, idx) {
      var alt = idx % 2 === 1 ? ' style="background:var(--surface)"' : ' style="background:var(--bg)"';
      var cellsHtml = _mapProjects.map(function(pj) {
        var detail = _mapDetailCache[pj.id];
        var linked = detail && detail.products && detail.products.some(function(pr) { return pr.id === prod.id; });
        if (linked) {
          return '<td><div class="m-dot yes" style="cursor:pointer" onclick="event.stopPropagation();openProject(\'' + pj.id + '\')">' +
            '<svg width="9" height="9" viewBox="0 0 9 9"><path d="M1.5 4.5l2 2L7 2" stroke="white" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></div></td>';
        }
        return '<td><div class="m-dot no">·</div></td>';
      }).join('');

      bodyHtml += '<tr' + alt + '>' +
        '<td>' + escHtml(prod.name) + '<br><span style="font-size:10.5px;color:var(--muted)">' + escHtml(prod.code || '') + '</span></td>' +
        cellsHtml +
      '</tr>';
    });
  });

  document.getElementById('matrix-tbl').innerHTML = '<thead>' + headHtml + '</thead><tbody>' + bodyHtml + '</tbody>';
}

/* ═══════════════════════════════════════════════════
   LINK / UNLINK
═══════════════════════════════════════════════════ */

var _linkDialogType = '';
var _linkDialogId = 0;

function showLinkDialog(type, id, name) {
  _linkDialogType = type;
  _linkDialogId = id;

  var title = type === 'product' ? '关联项目到「' + name + '」' : '关联产品到「' + name + '」';

  if (type === 'product') {
    API.get('/products/' + id).then(function(detail) {
      var linkedIds = (detail.projects || []).map(function(p) { return p.id; });
      var available = _mapProjects.filter(function(p) { return linkedIds.indexOf(p.id) < 0; });
      if (!available.length) { showToast('所有项目已关联', 'info'); return; }
      renderLinkOptions(available, 'project', title);
    });
  } else {
    var detail = _mapDetailCache[id] || {};
    var linkedIds = detail.products.map(function(p) { return p.id; });
    var available = _mapProducts.filter(function(p) { return linkedIds.indexOf(p.id) < 0; });
    if (!available.length) { showToast('所有产品已关联', 'info'); return; }
    renderLinkOptions(available, 'product', title);
  }
}

function renderLinkOptions(items, itemType, title) {
  var listHtml = items.map(function(item) {
    var label = itemType === 'product' ? item.name : extractCoreName(item.name);
    var code = itemType === 'product' ? (item.code || '') : extractProjectCode(item.name);
    var sub = itemType === 'product' ? (item.category || item.type || '') : (item.project_type || 'RD');
    return '<div class="link-dialog-item" onclick="doLink(' + _linkDialogId + ',' + item.id + ',\'' + _linkDialogType + '\')">' +
      '<div><div style="font-weight:510">' + escHtml(code) + ' ' + escHtml(label) + '</div><div style="font-size:10.5px;color:var(--muted)">' + escHtml(sub) + '</div></div>' +
      '<span style="color:var(--accent);font-weight:600">+ 关联</span>' +
    '</div>';
  }).join('');

  var dialog = document.getElementById('link-dialog');
  dialog.querySelector('.link-dialog-title').textContent = title;
  dialog.querySelector('.link-dialog-list').innerHTML = listHtml;
  dialog.classList.add('open');
}

function closeLinkDialog() {
  document.getElementById('link-dialog').classList.remove('open');
}

async function doLink(id1, id2, type) {
  var productId = type === 'product' ? id1 : id2;
  var projectId = type === 'product' ? id2 : id1;
  try {
    await API.post('/products/link', { product_id: productId, project_id: projectId });
    showToast('关联成功', 'success');
    closeLinkDialog();

    // Refresh cache for affected project
    _mapDetailCache[projectId] = {};
    try {
      var detail = await API.get('/projects/' + projectId);
      _mapDetailCache[projectId] = detail || {};
    } catch(e) {}

    // Refresh current view
    switchMapTab(_mapTab);
  } catch(e) {
    showToast('关联失败: ' + (e.message || '未知错误'), 'error');
  }
}

async function unlinkProduct(productId, projectId) {
  if (!confirm('确认取消此产品与项目的关联？')) return;
  try {
    await API.del('/products/link?product_id=' + productId + '&project_id=' + projectId);
    showToast('已取消关联', 'success');

    _mapDetailCache[projectId] = {};
    try {
      var detail = await API.get('/projects/' + projectId);
      _mapDetailCache[projectId] = detail || {};
    } catch(e) {}

    switchMapTab(_mapTab);
  } catch(e) {
    showToast('取消失败: ' + (e.message || '未知错误'), 'error');
  }
}

document.addEventListener('click', function(e) {
  var dialog = document.getElementById('link-dialog');
  if (dialog && dialog.classList.contains('open') && e.target === dialog) {
    closeLinkDialog();
  }
});

/* ── Shared data loader for split views ── */

async function _loadMapData() {
  if (_mapProducts.length && _mapProjects.length) return; // already loaded
  var results = await Promise.all([
    API.get('/products?limit=200').catch(function() { return { items: [] }; }),
    API.get('/projects').catch(function() { return []; }),
  ]);
  _mapProducts = results[0].items || [];
  _mapProjects = results[1] || [];
  _mapDetailCache = {};
  await Promise.all(_mapProjects.map(function(pj) {
    return API.get('/projects/' + pj.id).then(function(detail) {
      _mapDetailCache[pj.id] = detail || {};
    }).catch(function() {
      _mapDetailCache[pj.id] = {};
    });
  }));
}

/* ═══════════════════════════════════════════════════
   SPLIT VIEWS — 6 association views (consistent pattern)
   Each view: sidebar categories + main area with results
═══════════════════════════════════════════════════ */

/* ── Shared: render project table with optional linked products ── */

function _renderProjTable(projects, showProducts) {
  return '<table class="proj-table"><thead><tr>' +
    '<th>项目编号</th><th>项目名</th><th>客户</th><th>类型</th><th>状态</th><th>进度</th><th>计划完成</th>' +
    (showProducts ? '<th>关联产品</th>' : '') +
    '</tr></thead><tbody>' +
    projects.map(function(pj) {
      var projCode = extractProjectCode(pj.name);
      var detail = _mapDetailCache[pj.id] || {};
      var dStatus = detail.status || pj.status || '';
      var dProgress = detail.progress || pj.progress || '0';
      var dEnd = detail.end || pj.end || null;
      var prodsHtml = '';
      if (showProducts) {
        var prods = detail.products || [];
        prodsHtml = '<td>' + (prods.length ? prods.map(function(pp) {
          return '<span class="projid-prod-chip" onclick="event.stopPropagation();openProductDetail(\'' + pp.id + '\')" title="查看产品详情">' + escHtml(pp.name) + '</span>';
        }).join(' ') : '<span style="font-size:11px;color:var(--muted)">—</span>') + '</td>';
      }
      return '<tr onclick="openProject(\'' + pj.id + '\')" style="cursor:pointer">' +
        '<td>' + renderProjIcon(pj.project_type, projCode) + '</td>' +
        '<td><div class="proj-name">' + escHtml(extractCoreName(pj.name)) + '</div><div class="proj-code">' + escHtml(projCode) + '</div></td>' +
        '<td>' + renderCustomerBadge(pj.customer_name) + '</td>' +
        '<td>' + renderTypeBadge(pj.project_type) + '</td>' +
        '<td>' + renderPill(dStatus) + '</td>' +
        '<td class="prog-cell">' + renderProgressBar(dProgress, dStatus) + '</td>' +
        '<td style="font-size:12px;color:' + (dEnd ? 'var(--muted)' : 'var(--warn)') + '">' + (dEnd ? formatDate(dEnd) : '长期') + '</td>' +
        prodsHtml +
      '</tr>';
    }).join('') +
    '</tbody></table>';
}

/* ── 1. 项目关联产品 ── */

var _ppCats = {}, _ppSearchVal = '';
async function initProjectProducts() {
  await _loadMapData();
  var cats = { '研发项目': [], '生产项目': [] };
  _mapProjects.forEach(function(p) {
    if (p.project_type === 'SC') cats['生产项目'].push(p);
    else cats['研发项目'].push(p);
  });
  document.getElementById('pp-cat-list').innerHTML = Object.keys(cats).map(function(c) {
    return '<div class="prod-cat-item" onclick="selectPjProjCat(\'' + escHtml(c).replace(/'/g, "\\'") + '\', this)">' + escHtml(c) + '<span class="cat-count">' + cats[c].length + '</span></div>';
  }).join('');
  _ppCats = cats;
  _ppSearchVal = '';
  document.getElementById('pp-search').value = '';
  document.getElementById('pp-container').innerHTML = '<div class="prod-tree-empty">请选择左侧分类</div>';
}

function doPpSearch(v) {
  _ppSearchVal = v.trim().toLowerCase();
  var active = document.querySelector('#pp-cat-list .prod-cat-item.active');
  if (active) { selectPjProjCat(active.textContent.replace(/\d+$/, '').trim(), active); return; }
  // No category selected: search across all
  var all = [];
  Object.keys(_ppCats).forEach(function(c) { all = all.concat(_ppCats[c]); });
  var filtered = all.filter(function(pj) {
    if (!_ppSearchVal) return true;
    var code = extractProjectCode(pj.name).toLowerCase();
    var core = extractCoreName(pj.name).toLowerCase();
    return code.indexOf(_ppSearchVal) >= 0 || core.indexOf(_ppSearchVal) >= 0;
  });
  document.getElementById('pp-container').innerHTML = filtered.length ? _renderProjTable(filtered, true) : '<div class="empty-state" style="padding:20px">未找到匹配项目</div>';
}

function selectPjProjCat(cat, el) {
  document.querySelectorAll('#pp-cat-list .prod-cat-item').forEach(function(c) { c.classList.remove('active'); });
  if (el) el.classList.add('active');
  var projects = (_ppCats[cat] || []).filter(function(pj) {
    if (!_ppSearchVal) return true;
    var code = extractProjectCode(pj.name).toLowerCase();
    var core = extractCoreName(pj.name).toLowerCase();
    var cust = (pj.customer_name || '').toLowerCase();
    return code.indexOf(_ppSearchVal) >= 0 || core.indexOf(_ppSearchVal) >= 0 || cust.indexOf(_ppSearchVal) >= 0;
  });
  var c = document.getElementById('pp-container');
  c.innerHTML = projects.length ? _renderProjTable(projects, true) : '<div class="prod-tree-empty">此分类暂无项目</div>';
}

/* ── 2. 项目关联客户 ── */

async function initProjectCustomers() {
  await _loadMapData();
  var cats = { '研发项目': [], '生产项目': [] };
  _mapProjects.forEach(function(p) {
    if (p.project_type === 'SC') cats['生产项目'].push(p);
    else cats['研发项目'].push(p);
  });
  document.getElementById('pc-cat-list').innerHTML = Object.keys(cats).map(function(c) {
    return '<div class="prod-cat-item" onclick="selectPjCustCat(\'' + escHtml(c).replace(/'/g, "\\'") + '\', this)">' + escHtml(c) + '<span class="cat-count">' + cats[c].length + '</span></div>';
  }).join('');
  _pcCats = cats;
  _pcSearchVal = '';
  var si = document.getElementById('pc-search');
  if (si) si.value = '';
  document.getElementById('pc-tree-container').innerHTML = '<div class="prod-tree-empty">请选择左侧分类</div>';
}

var _pcCats = {}, _pcSearchVal = '';
function doPcSearch(v) {
  _pcSearchVal = v.trim().toLowerCase();
  var active = document.querySelector('#pc-cat-list .prod-cat-item.active');
  if (active) { selectPjCustCat(active.textContent.replace(/\d+$/, '').trim(), active); return; }
  var all = [];
  Object.keys(_pcCats).forEach(function(c) { all = all.concat(_pcCats[c]); });
  var filtered = all.filter(function(pj) {
    if (!_pcSearchVal) return true;
    var code = extractProjectCode(pj.name).toLowerCase();
    var core = extractCoreName(pj.name).toLowerCase();
    return code.indexOf(_pcSearchVal) >= 0 || core.indexOf(_pcSearchVal) >= 0;
  });
  var c = document.getElementById('pc-tree-container');
  c.innerHTML = filtered.length ? filtered.map(function(pj) {
    return '<div class="projid-item" style="cursor:pointer" onclick="openProject(\'' + pj.id + '\')">' +
      '<div class="projid-item-header">' +
        '<span class="projid-item-code">' + escHtml(extractProjectCode(pj.name)) + '</span>' +
        '<span class="projid-item-type ' + (pj.project_type === 'SC' ? 'sc' : 'rd') + '">' + (pj.project_type === 'SC' ? '生产' : '研发') + '</span>' +
        (pj.customer_name ? '<span onclick="event.stopPropagation();gotoCustomerProjects(\'' + escHtml(pj.customer_name) + '\')" style="cursor:pointer">' + renderCustomerBadge(pj.customer_name) + '</span>' : '') + renderPill(pj.status) +
      '</div>' +
      '<div style="font-size:12px;color:var(--muted);margin-bottom:4px">' + escHtml(extractCoreName(pj.name)) + '</div>' +
    '</div>';
  }).join('') : '<div class="empty-state" style="padding:20px">未找到匹配项目</div>';
}

var _pendingCustSelect = null;
function gotoCustomerProjects(custName) {
  _pendingCustSelect = custName;
  gotoView('customer-projects');
}
function selectPjCustCat(cat, el) {
  document.querySelectorAll('#pc-cat-list .prod-cat-item').forEach(function(c) { c.classList.remove('active'); });
  if (el) el.classList.add('active');
  var projects = (_pcCats[cat] || []).filter(function(pj) {
    if (!_pcSearchVal) return true;
    var code = extractProjectCode(pj.name).toLowerCase();
    var core = extractCoreName(pj.name).toLowerCase();
    return code.indexOf(_pcSearchVal) >= 0 || core.indexOf(_pcSearchVal) >= 0;
  });
  var c = document.getElementById('pc-tree-container');
  if (!projects.length) { c.innerHTML = '<div class="prod-tree-empty">此分类暂无项目</div>'; return; }
  c.innerHTML = projects.map(function(pj) {
    return '<div class="projid-item" style="cursor:pointer" onclick="openProject(\'' + pj.id + '\')">' +
      '<div class="projid-item-header">' +
        '<span class="projid-item-code">' + escHtml(extractProjectCode(pj.name)) + '</span>' +
        '<span class="projid-item-type ' + (pj.project_type === 'SC' ? 'sc' : 'rd') + '">' + (pj.project_type === 'SC' ? '生产' : '研发') + '</span>' +
        (pj.customer_name ? renderCustomerBadge(pj.customer_name) : '') +
        renderPill(pj.status) +
      '</div>' +
      '<div style="font-size:12px;color:var(--muted);margin-bottom:4px">' + escHtml(extractCoreName(pj.name)) + '</div>' +
    '</div>';
  }).join('');
}

/* ── 3. 产品关联项目 ── */

var _vpCats = {}, _vpSearchVal = '';
async function initProductProjects() {
  await _loadMapData();
  var cats = {};
  _mapProducts.forEach(function(p) {
    var cat = p.category || p.program_name || '其他';
    if (!cats[cat]) cats[cat] = [];
    cats[cat].push(p);
  });
  document.getElementById('vp-cat-list').innerHTML = Object.keys(cats).sort().map(function(c) {
    return '<div class="prod-cat-item" onclick="selectVpCategory(\'' + escHtml(c).replace(/'/g, "\\'") + '\', this)">' + escHtml(c) + '<span class="cat-count">' + cats[c].length + '</span></div>';
  }).join('');
  _vpCats = cats;
  _vpSearchVal = '';
  var si = document.getElementById('vp-search');
  if (si) si.value = '';
  document.getElementById('vp-tree-container').innerHTML = '<div class="prod-tree-empty">请选择左侧产品分类</div>';
}

function doVpSearch(v) {
  _vpSearchVal = v.trim().toLowerCase();
  var active = document.querySelector('#vp-cat-list .prod-cat-item.active');
  if (active) { selectVpCategory(active.textContent.replace(/\d+$/, '').trim(), active); return; }
  var all = [];
  Object.keys(_vpCats).forEach(function(c) { all = all.concat(_vpCats[c]); });
  var products = all.filter(function(p) {
    if (!_vpSearchVal) return true;
    return (p.name || '').toLowerCase().indexOf(_vpSearchVal) >= 0 || (p.code || '').toLowerCase().indexOf(_vpSearchVal) >= 0;
  });
  var c = document.getElementById('vp-tree-container');
  if (!products.length) { c.innerHTML = '<div class="prod-tree-empty">未找到匹配产品</div>'; return; }
  c.innerHTML = products.map(function(p) {
    var links = _mapProjects.filter(function(pj) {
      var detail = _mapDetailCache[pj.id] || {};
      return (detail.products || []).some(function(pp) { return pp.id === p.id; });
    });
    return '<div style="margin-bottom:18px">' +
      '<div class="section-hd" style="margin-bottom:6px"><div class="section-title" style="font-size:13px;cursor:pointer" onclick="openProductDetail(\'' + p.id + '\')">' + escHtml(p.name) + '</div><span style="font-size:11px;color:var(--muted)">' + links.length + ' 个项目</span></div>' +
      (links.length ? _renderProjTable(links) : '<div class="empty-state" style="padding:12px;font-size:12px">暂无关联项目</div>') +
    '</div>';
  }).join('');
}

function selectVpCategory(cat, el) {
  document.querySelectorAll('#vp-cat-list .prod-cat-item').forEach(function(c) { c.classList.remove('active'); });
  if (el) el.classList.add('active');
  var products = (_vpCats[cat] || []).filter(function(p) {
    if (!_vpSearchVal) return true;
    return (p.name || '').toLowerCase().indexOf(_vpSearchVal) >= 0 ||
           (p.code || '').toLowerCase().indexOf(_vpSearchVal) >= 0;
  });
  var c = document.getElementById('vp-tree-container');
  if (!products.length) { c.innerHTML = '<div class="prod-tree-empty">此分类暂无产品</div>'; return; }
  c.innerHTML = products.map(function(p) {
    var links = _mapProjects.filter(function(pj) {
      var detail = _mapDetailCache[pj.id] || {};
      return (detail.products || []).some(function(pp) { return pp.id === p.id; });
    });
    return '<div style="margin-bottom:18px">' +
      '<div class="section-hd" style="margin-bottom:6px"><div class="section-title" style="font-size:13px;cursor:pointer" onclick="openProductDetail(\'' + p.id + '\')">' + escHtml(p.name) + '</div><span style="font-size:11px;color:var(--muted)">' + links.length + ' 个项目</span></div>' +
      (links.length ? _renderProjTable(links) : '<div class="empty-state" style="padding:12px;font-size:12px">暂无关联项目</div>') +
    '</div>';
  }).join('');
}

/* ── 4. 产品关联客户 ── */

var _pdcCats = {}, _pdcSearchVal = '';
async function initProductCustomers() {
  await _loadMapData();
  var cats = {};
  _mapProducts.forEach(function(p) {
    var cat = p.category || p.program_name || '其他';
    if (!cats[cat]) cats[cat] = [];
    cats[cat].push(p);
  });
  document.getElementById('pdc-cat-list').innerHTML = Object.keys(cats).sort().map(function(c) {
    return '<div class="prod-cat-item" onclick="selectPdCustCat(\'' + escHtml(c).replace(/'/g, "\\'") + '\', this)">' + escHtml(c) + '<span class="cat-count">' + cats[c].length + '</span></div>';
  }).join('');
  _pdcCats = cats;
  _pdcSearchVal = '';
  var si = document.getElementById('pdc-search');
  if (si) si.value = '';
  document.getElementById('pdc-tree-container').innerHTML = '<div class="prod-tree-empty">请选择左侧产品分类</div>';
}

function doPdcSearch(v) {
  _pdcSearchVal = v.trim().toLowerCase();
  var active = document.querySelector('#pdc-cat-list .prod-cat-item.active');
  if (active) { selectPdCustCat(active.textContent.replace(/\d+$/, '').trim(), active); return; }
  var all = [];
  Object.keys(_pdcCats).forEach(function(c) { all = all.concat(_pdcCats[c]); });
  var products = all.filter(function(p) {
    if (!_pdcSearchVal) return true;
    return (p.name || '').toLowerCase().indexOf(_pdcSearchVal) >= 0 || (p.code || '').toLowerCase().indexOf(_pdcSearchVal) >= 0;
  });
  var c = document.getElementById('pdc-tree-container');
  if (!products.length) { c.innerHTML = '<div class="prod-tree-empty">未找到匹配产品</div>'; return; }
  c.innerHTML = products.map(function(p) {
    var links = _mapProjects.filter(function(pj) {
      var detail = _mapDetailCache[pj.id] || {};
      return (detail.products || []).some(function(pp) { return pp.id === p.id; });
    });
    var custNames = [];
    links.forEach(function(pj) { if (pj.customer_name && custNames.indexOf(pj.customer_name) < 0) custNames.push(pj.customer_name); });
    return '<div style="margin-bottom:14px">' +
      '<div class="section-hd" style="margin-bottom:4px"><div class="section-title" style="font-size:13px;cursor:pointer" onclick="openProductDetail(\'' + p.id + '\')">' + escHtml(p.name) + '</div></div>' +
      (custNames.length ? custNames.map(function(cn) { return renderCustomerBadge(cn); }).join(' ') : '<span style="color:var(--muted);font-size:12px">—</span>') +
    '</div>';
  }).join('');
}

function selectPdCustCat(cat, el) {
  document.querySelectorAll('#pdc-cat-list .prod-cat-item').forEach(function(c) { c.classList.remove('active'); });
  if (el) el.classList.add('active');
  var products = (_pdcCats[cat] || []).filter(function(p) {
    if (!_pdcSearchVal) return true;
    return (p.name || '').toLowerCase().indexOf(_pdcSearchVal) >= 0 ||
           (p.code || '').toLowerCase().indexOf(_pdcSearchVal) >= 0;
  });
  var c = document.getElementById('pdc-tree-container');
  if (!products.length) { c.innerHTML = '<div class="prod-tree-empty">此分类暂无产品</div>'; return; }
  c.innerHTML = products.map(function(p) {
    var links = _mapProjects.filter(function(pj) {
      var detail = _mapDetailCache[pj.id] || {};
      return (detail.products || []).some(function(pp) { return pp.id === p.id; });
    });
    var custNames = [];
    links.forEach(function(pj) { if (pj.customer_name && custNames.indexOf(pj.customer_name) < 0) custNames.push(pj.customer_name); });
    return '<div style="margin-bottom:14px">' +
      '<div class="section-hd" style="margin-bottom:4px"><div class="section-title" style="font-size:13px;cursor:pointer" onclick="openProductDetail(\'' + p.id + '\')">' + escHtml(p.name) + '</div></div>' +
      (custNames.length ? custNames.map(function(cn) { return renderCustomerBadge(cn); }).join(' ') : '<span style="color:var(--muted);font-size:12px">—</span>') +
    '</div>';
  }).join('');
}

/* ── 5. 客户关联项目 ── */

var _vcCustomers = [], _vcSearchVal = '';
async function initCustomerProjects() {
  var catList = document.getElementById('vc-cat-list');
  document.getElementById('vc-tree-container').innerHTML = '<div class="prod-tree-empty">请选择左侧客户</div>';
  try { var data = await API.get('/customers'); _vcCustomers = data.items || []; } catch(e) { _vcCustomers = []; }
  _vcSearchVal = '';
  var si = document.getElementById('vc-search');
  if (si) si.value = '';
  catList.innerHTML = _vcCustomers.map(function(c) {
    return '<div class="prod-cat-item" onclick="selectVcCustomer(\'' + c.id + '\', this)">' + escHtml(c.name) + '<span class="cat-count">' + c.project_count + '</span></div>';
  }).join('');
  if (!_vcCustomers.length) catList.innerHTML = '<div style="padding:12px;color:var(--muted);font-size:12px">暂无客户数据</div>';
  // Auto-select pending customer
  if (_pendingCustSelect) {
    var target = _vcCustomers.find(function(c) { return c.name === _pendingCustSelect; });
    if (target) {
      _pendingCustSelect = null;
      var el = document.querySelector('#vc-cat-list .prod-cat-item');
      if (el && el.textContent.trim().indexOf(target.name) === 0) selectVcCustomer(target.id, el);
    }
  }
}

function doVcSearch(v) {
  _vcSearchVal = v.trim().toLowerCase();
  var active = document.querySelector('#vc-cat-list .prod-cat-item.active');
  if (active) {
    var cid = parseInt(active.onclick.toString().match(/selectVcCustomer\('(\d+)'/)[1]);
    selectVcCustomer(cid, active); return;
  }
  // Search across all customers
  var c = document.getElementById('vc-tree-container');
  if (!_vcSearchVal) { c.innerHTML = '<div class="prod-tree-empty">请选择左侧客户</div>'; return; }
  if (!_vcCustomers.length) { c.innerHTML = '<div class="prod-tree-empty">暂无客户数据，请刷新页面</div>'; return; }
  c.innerHTML = '<div class="loading-spinner" style="padding:20px">搜索中...</div>';
  // Try each customer
  Promise.all(_vcCustomers.map(function(cu) {
    return API.get('/customers/' + cu.id).then(function(d) { return {cust: cu, projects: d.projects || []}; }).catch(function() { return null; });
  })).then(function(results) {
    var html = '';
    results.forEach(function(r) {
      if (!r || !r.projects.length) return;
      var filtered = r.projects.filter(function(pj) {
        var code = extractProjectCode(pj.name).toLowerCase();
        var core = extractCoreName(pj.name).toLowerCase();
        return code.indexOf(_vcSearchVal) >= 0 || core.indexOf(_vcSearchVal) >= 0;
      });
      if (filtered.length) {
        html += '<div class="section-hd" style="margin-bottom:6px"><div class="section-title" style="font-size:13px">' + escHtml(r.cust.name) + '</div></div>' + _renderProjTable(filtered);
      }
    });
    c.innerHTML = html || '<div class="empty-state" style="padding:20px">未找到匹配项目</div>';
  });
}

async function selectVcCustomer(custId, el) {
  document.querySelectorAll('#vc-cat-list .prod-cat-item').forEach(function(c) { c.classList.remove('active'); });
  if (el) el.classList.add('active');
  var c = document.getElementById('vc-tree-container');
  c.innerHTML = '<div class="loading-spinner" style="padding:20px">加载中...</div>';
  try { var data = await API.get('/customers/' + custId); var projects = data.projects || []; } catch(e) { projects = []; }
  if (_vcSearchVal) projects = projects.filter(function(pj) {
    var code = extractProjectCode(pj.name).toLowerCase();
    var core = extractCoreName(pj.name).toLowerCase();
    return code.indexOf(_vcSearchVal) >= 0 || core.indexOf(_vcSearchVal) >= 0;
  });
  if (!projects.length) { c.innerHTML = '<div class="prod-tree-empty">此客户暂无关联项目</div>'; return; }
  await _loadMapData();
  c.innerHTML = _renderProjTable(projects);
}

/* ── 6. 客户关联产品 ── */

var _cpCustomers = [], _cpSearchVal = '';
async function initCustomerProducts() {
  var catList = document.getElementById('cp-cat-list');
  document.getElementById('cp-tree-container').innerHTML = '<div class="prod-tree-empty">请选择左侧客户</div>';
  try { var data = await API.get('/customers'); _cpCustomers = data.items || []; } catch(e) { _cpCustomers = []; }
  _cpSearchVal = '';
  var si = document.getElementById('cp-search');
  if (si) si.value = '';
  catList.innerHTML = _cpCustomers.map(function(c) {
    return '<div class="prod-cat-item" onclick="selectCpCustomer(\'' + c.id + '\', this)">' + escHtml(c.name) + '<span class="cat-count">' + c.project_count + '</span></div>';
  }).join('');
  if (!_cpCustomers.length) catList.innerHTML = '<div style="padding:12px;color:var(--muted);font-size:12px">暂无客户数据</div>';
}

function doCpSearch(v) {
  _cpSearchVal = v.trim().toLowerCase();
  var active = document.querySelector('#cp-cat-list .prod-cat-item.active');
  if (active) {
    var cid = parseInt(active.onclick.toString().match(/selectCpCustomer\('(\d+)'/)[1]);
    selectCpCustomer(cid, active); return;
  }
  var c = document.getElementById('cp-tree-container');
  if (!_cpSearchVal) { c.innerHTML = '<div class="prod-tree-empty">请选择左侧客户</div>'; return; }
  if (!_cpCustomers.length) { c.innerHTML = '<div class="prod-tree-empty">暂无客户数据，请刷新页面</div>'; return; }
  c.innerHTML = '<div class="loading-spinner" style="padding:20px">搜索中...</div>';
  Promise.all(_cpCustomers.map(function(cu) {
    return API.get('/customers/' + cu.id + '/products').then(function(d) { return {cust: cu, products: d || []}; }).catch(function() { return null; });
  })).then(function(results) {
    var html = '';
    results.forEach(function(r) {
      if (!r || !r.products.length) return;
      var filtered = r.products.filter(function(p) {
        return (p.name || '').toLowerCase().indexOf(_cpSearchVal) >= 0 || (p.code || '').toLowerCase().indexOf(_cpSearchVal) >= 0;
      });
      if (filtered.length) {
        html += '<div class="section-hd" style="margin-bottom:6px"><div class="section-title" style="font-size:13px">' + escHtml(r.cust.name) + '</div></div>' +
          '<div class="product-grid">' + filtered.map(function(p) {
            var desc = stripHtml(p.description || '');
            var descShort = desc.length > 60 ? desc.substring(0, 60) + '...' : desc;
            return '<div class="product-card" onclick="openProductDetail(\'' + p.id + '\')">' +
              '<div class="product-card-name">' + escHtml(p.name) + '</div>' +
              '<div class="product-card-code">' + escHtml(p.code || '') + '</div>' +
              (descShort ? '<div class="product-card-desc">' + escHtml(descShort) + '</div>' : '') +
              '<div class="product-card-meta"><span class="pill normal">' + escHtml(p.status || 'normal') + '</span></div>' +
            '</div>';
          }).join('') + '</div>';
      }
    });
    c.innerHTML = html || '<div class="empty-state" style="padding:20px">未找到匹配产品</div>';
  });
}

async function selectCpCustomer(custId, el) {
  document.querySelectorAll('#cp-cat-list .prod-cat-item').forEach(function(c) { c.classList.remove('active'); });
  if (el) el.classList.add('active');
  var c = document.getElementById('cp-tree-container');
  c.innerHTML = '<div class="loading-spinner" style="padding:20px">加载中...</div>';
  try { var data = await API.get('/customers/' + custId + '/products'); var products = data || []; } catch(e) { products = []; }
  if (_cpSearchVal) products = products.filter(function(p) {
    return (p.name || '').toLowerCase().indexOf(_cpSearchVal) >= 0 ||
           (p.code || '').toLowerCase().indexOf(_cpSearchVal) >= 0;
  });
  if (!products.length) { c.innerHTML = '<div class="prod-tree-empty">此客户暂无关联产品</div>'; return; }
  c.innerHTML = '<div class="product-grid">' + products.map(function(p) {
    var desc = stripHtml(p.description || '');
    var descShort = desc.length > 60 ? desc.substring(0, 60) + '...' : desc;
    return '<div class="product-card" onclick="openProductDetail(\'' + p.id + '\')">' +
      '<div class="product-card-name">' + escHtml(p.name) + '</div>' +
      '<div class="product-card-code">' + escHtml(p.code || '') + '</div>' +
      (descShort ? '<div class="product-card-desc">' + escHtml(descShort) + '</div>' : '') +
      '<div class="product-card-meta"><span class="pill normal">' + escHtml(p.status || 'normal') + '</span></div>' +
    '</div>';
  }).join('') + '</div>';
}
