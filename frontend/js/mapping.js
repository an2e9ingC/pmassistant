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
      _mapDetailCache[pj.id] = {
        products: (detail && detail.products) ? detail.products : [],
        description: (detail && detail.description) ? detail.description : '',
        customer_from_desc: (detail && detail.customer_from_desc) ? detail.customer_from_desc : '',
      };
    }).catch(function() {
      _mapDetailCache[pj.id] = { products: [], description: '', customer_from_desc: '' };
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
    var detail = _mapDetailCache[pj.id] || { products: [], description: '', customer_from_desc: '' };
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
    var detail = _mapDetailCache[p.id] || { products: [] };
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
    var detail = _mapDetailCache[id] || { products: [] };
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
    _mapDetailCache[projectId] = { products: [], description: '', customer_from_desc: '' };
    try {
      var detail = await API.get('/projects/' + projectId);
      _mapDetailCache[projectId] = {
        products: (detail && detail.products) ? detail.products : [],
        description: (detail && detail.description) ? detail.description : '',
        customer_from_desc: (detail && detail.customer_from_desc) ? detail.customer_from_desc : '',
      };
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

    _mapDetailCache[projectId] = { products: [], description: '', customer_from_desc: '' };
    try {
      var detail = await API.get('/projects/' + projectId);
      _mapDetailCache[projectId] = {
        products: (detail && detail.products) ? detail.products : [],
        description: (detail && detail.description) ? detail.description : '',
        customer_from_desc: (detail && detail.customer_from_desc) ? detail.customer_from_desc : '',
      };
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
      _mapDetailCache[pj.id] = {
        products: (detail && detail.products) ? detail.products : [],
        description: (detail && detail.description) ? detail.description : '',
        customer_from_desc: (detail && detail.customer_from_desc) ? detail.customer_from_desc : '',
      };
    }).catch(function() {
      _mapDetailCache[pj.id] = { products: [], description: '', customer_from_desc: '' };
    });
  }));
}

/* ── 项目关联产品 (按项目查产品) ── */

async function initProjectProducts() {
  await _loadMapData();
  document.getElementById('pp-search-input').value = '';
  document.getElementById('pp-result').innerHTML = '<div class="projid-empty">请输入项目编号进行搜索</div>';
}

function searchProjectProducts(q) {
  var container = document.getElementById('pp-result');
  if (!container) return;
  var term = (q || '').trim().toLowerCase();
  if (!term || term.length < 2) {
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
    var detail = _mapDetailCache[p.id] || { products: [] };
    var projCode = extractProjectCode(p.name);
    var coreName = extractCoreName(p.name);
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
        '<span class="projid-item-code">' + escHtml(projCode) + '</span>' +
        '<span class="projid-item-type ' + (p.project_type === 'SC' ? 'sc' : 'rd') + '">' + (p.project_type === 'SC' ? '生产' : '研发') + '</span>' +
        (p.customer_name ? renderCustomerBadge(p.customer_name) : '') +
        renderPill(p.status) +
      '</div>' +
      '<div style="font-size:12px;color:var(--muted);margin-bottom:8px">' + escHtml(coreName) + '</div>' +
      '<div class="projid-item-prods">' + prodHtml + '</div>' +
    '</div>';
  }).join('');
}

/* ── 产品关联项目 (从产品查项目) ── */

async function initProductProjects() {
  // Reuse mapping.js product view render into vp-* elements
  await _loadMapData();
  var catList = document.getElementById('vp-cat-list');
  var treeContainer = document.getElementById('vp-tree-container');

  // Build category list
  var cats = {};
  _mapProducts.forEach(function(p) {
    var cat = p.category || p.program_name || '其他';
    if (!cats[cat]) cats[cat] = [];
    cats[cat].push(p);
  });
  var catNames = Object.keys(cats).sort();
  catList.innerHTML = catNames.map(function(c) {
    return '<div class="prod-cat-item" onclick="selectVpCategory(\'' + escHtml(c).replace(/'/g, "\\'") + '\', this)">' + escHtml(c) + '<span class="cat-count">' + cats[c].length + '</span></div>';
  }).join('');
  treeContainer.innerHTML = '<div class="prod-tree-empty">请选择左侧产品分类</div>';
  _vpCats = cats;
}

var _vpCats = {};

function selectVpCategory(cat, el) {
  document.querySelectorAll('#vp-cat-list .prod-cat-item').forEach(function(c) { c.classList.remove('active'); });
  if (el) el.classList.add('active');
  var products = _vpCats[cat] || [];
  var container = document.getElementById('vp-tree-container');
  if (!products.length) {
    container.innerHTML = '<div class="prod-tree-empty">此分类暂无产品</div>';
    return;
  }
  container.innerHTML = products.map(function(p) {
    var links = _mapProjects.filter(function(pj) {
      var detail = _mapDetailCache[pj.id];
      return detail && detail.products && detail.products.some(function(pp) { return pp.id === p.id; });
    });
    var rowsHtml = '';
    if (links.length) {
      rowsHtml = '<table class="proj-table" style="margin-top:8px"><thead><tr>' +
        '<th>项目编号</th><th>项目名</th><th>客户</th><th width="8%">类型</th><th>当前阶段</th><th width="7%">状态</th><th width="12%">进度</th><th width="10%">计划完成</th>' +
        '</tr></thead><tbody>' +
        links.map(function(pj) {
          var projCode = extractProjectCode(pj.name);
          return '<tr onclick="openProject(\'' + pj.id + '\')" style="cursor:pointer">' +
            '<td>' + renderProjIcon(pj.project_type, projCode) + '</td>' +
            '<td><div class="proj-name">' + escHtml(extractCoreName(pj.name)) + '</div><div class="proj-code">' + escHtml(projCode) + '</div></td>' +
            '<td>' + renderCustomerBadge(pj.customer_name) + '</td>' +
            '<td>' + renderTypeBadge(pj.project_type) + '</td>' +
            '<td>' + renderPill(pj.status) + '</td>' +
            '<td>' + renderPill(pj.status) + '</td>' +
            '<td class="prog-cell">' + renderProgressBar(pj.progress, pj.status) + '</td>' +
            '<td style="font-size:12px;color:' + (pj.end ? 'var(--muted)' : 'var(--warn)') + '">' + (pj.end ? formatDate(pj.end) : '长期') + '</td>' +
          '</tr>';
        }).join('') +
        '</tbody></table>';
    } else {
      rowsHtml = '<div class="empty-state" style="padding:16px;font-size:12px">暂无关联项目</div>';
    }
    return '<div style="margin-bottom:18px">' +
      '<div class="section-hd" style="margin-bottom:6px"><div class="section-title" style="font-size:13px">' + escHtml(p.name) + '</div><span style="font-size:11px;color:var(--muted)">' + links.length + ' 个项目</span></div>' +
      rowsHtml +
    '</div>';
  }).join('');
}

/* ── 客户关联项目 (从客户查项目) ── */

async function initCustomerProjects() {
  await _loadMapData();
  var catList = document.getElementById('vc-cat-list');
  var treeContainer = document.getElementById('vc-tree-container');

  // Collect customers from project data
  var custs = {};
  _mapProjects.forEach(function(pj) {
    var cust = _getProjectCustomer(pj) || '未分类';
    if (!custs[cust]) custs[cust] = [];
    custs[cust].push(pj);
  });
  var custNames = Object.keys(custs).sort();
  catList.innerHTML = custNames.map(function(c) {
    return '<div class="prod-cat-item" onclick="selectVcCustomer(\'' + escHtml(c).replace(/'/g, "\\'") + '\', this)">' + escHtml(c) + '<span class="cat-count">' + custs[c].length + '</span></div>';
  }).join('');
  treeContainer.innerHTML = '<div class="prod-tree-empty">请选择左侧客户</div>';
  _vcCusts = custs;
}

var _vcCusts = {};

function selectVcCustomer(cust, el) {
  document.querySelectorAll('#vc-cat-list .prod-cat-item').forEach(function(c) { c.classList.remove('active'); });
  if (el) el.classList.add('active');
  var projects = _vcCusts[cust] || [];
  var container = document.getElementById('vc-tree-container');
  if (!projects.length) {
    container.innerHTML = '<div class="prod-tree-empty">此客户暂无项目</div>';
    return;
  }
  container.innerHTML = projects.map(function(pj) {
    var detail = _mapDetailCache[pj.id];
    var products = (detail && detail.products) ? detail.products : [];
    var projCode = extractProjectCode(pj.name);
    return '<div class="prod-tree-section">' +
      '<div class="proj-tree-proj" onclick="this.classList.toggle(\'expanded\');this.nextElementSibling.classList.toggle(\'show\')">' +
        '<div class="proj-tree-proj-header">' +
          '<div class="proj-tree-proj-title">' + escHtml(projCode) + ' ' + escHtml(extractCoreName(pj.name)) + '</div>' +
          '<div class="prod-tree-toggle" style="font-size:11px">▶</div>' +
        '</div>' +
        '<div class="proj-tree-proj-meta">' + renderTypeBadge(pj.project_type) + ' · ' + renderPill(pj.status) + '</div>' +
      '</div>' +
      '<div class="prod-tree-projs">' + products.map(function(pp) {
        return '<div class="proj-tree-prod-item">' +
          '<div class="proj-tree-prod-name">' + escHtml(pp.name) + '</div>' +
          '<div class="proj-tree-prod-meta">' + escHtml(pp.code || '') + '</div>' +
        '</div>';
      }).join('') + '</div>' +
    '</div>';
  }).join('');
}
