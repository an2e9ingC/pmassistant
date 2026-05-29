/* ═══════════════════════════════════════════════════
   PRODUCT-PROJECT MAPPING VIEW
   Phase 2: FR-005/006
═══════════════════════════════════════════════════ */

var _mapMode = 'product'; // 'product' | 'project'
var _mapSearchTimer = null;
var _mapProducts = [];
var _mapProjects = [];

async function renderMapping() {
  // Load overview stats + initial data
  try {
    var overview = await API.get('/products/overview');
    buildMappingOverview(overview);
  } catch(e) { /* overview not critical */ }

  await Promise.all([
    loadMapProducts(),
    loadMapProjects(),
  ]);

  switchMapMode(_mapMode);
}

function buildMappingOverview(data) {
  if (!data) return;
  document.getElementById('map-overview').innerHTML =
    '<div class="map-stat"><div class="map-stat-val">' + data.total_products + '</div><div class="map-stat-lbl">产品总数</div></div>' +
    '<div class="map-stat"><div class="map-stat-val">' + data.total_projects + '</div><div class="map-stat-lbl">项目总数</div></div>' +
    '<div class="map-stat"><div class="map-stat-val">' + data.total_links + '</div><div class="map-stat-lbl">关联总数</div></div>' +
    '<div class="map-stat"><div class="map-stat-val" style="color:' + (data.unlinked_projects > 0 ? 'var(--warn)' : 'var(--muted)') + '">' + data.unlinked_projects + '</div><div class="map-stat-lbl">未关联项目</div></div>';
}

async function loadMapProducts() {
  try {
    var data = await API.get('/products?limit=200');
    _mapProducts = data.items || [];
  } catch(e) { _mapProducts = []; }
}

async function loadMapProjects() {
  try {
    _mapProjects = await API.get('/projects');
  } catch(e) { _mapProjects = []; }
}

function switchMapMode(mode) {
  _mapMode = mode;
  document.querySelectorAll('.map-tab').forEach(function(t) { t.classList.remove('active'); });
  var tab = document.getElementById('maptab-' + mode);
  if (tab) tab.classList.add('active');

  if (mode === 'product') {
    renderMapByProduct();
  } else {
    renderMapByProject();
  }
}

/* ── By Product ── */

function onMapProductSearch(v) {
  clearTimeout(_mapSearchTimer);
  _mapSearchTimer = setTimeout(function() { renderMapByProduct(); }, 250);
}

function onMapCategoryFilter(cat) {
  document.querySelectorAll('.map-cat-chip').forEach(function(c) { c.classList.remove('active'); });
  var el = document.getElementById('cat-chip-' + (cat || 'all'));
  if (el) el.classList.add('active');
  _mapCatFilter = cat || '';
  renderMapByProduct();
}

var _mapCatFilter = '';

async function renderMapByProduct() {
  var searchVal = (document.getElementById('map-search') || {}).value || '';
  var container = document.getElementById('map-content');

  var list = _mapProducts;
  if (searchVal) {
    var q = searchVal.toLowerCase();
    list = list.filter(function(p) {
      return (p.name || '').toLowerCase().indexOf(q) >= 0 ||
             (p.code || '').toLowerCase().indexOf(q) >= 0;
    });
  }
  if (_mapCatFilter) {
    list = list.filter(function(p) { return p.category === _mapCatFilter; });
  }

  if (!list.length) {
    container.innerHTML = '<div class="empty-state">未找到匹配产品</div>';
    return;
  }

  // Load full product details with project links
  var productIds = list.map(function(p) { return p.id; });
  var details = await Promise.all(productIds.map(function(id) {
    return API.get('/products/' + id).catch(function() { return null; });
  }));

  var catCounts = {};
  _mapProducts.forEach(function(p) {
    if (p.category) catCounts[p.category] = (catCounts[p.category] || 0) + 1;
  });

  var catHtml = '<span class="map-cat-chip active" id="cat-chip-all" onclick="onMapCategoryFilter(\'\')">全部 <b>' + _mapProducts.length + '</b></span>';
  Object.keys(catCounts).sort().forEach(function(c) {
    catHtml += '<span class="map-cat-chip" id="cat-chip-' + c + '" onclick="onMapCategoryFilter(\'' + c + '\')">' + escHtml(c) + ' <b>' + catCounts[c] + '</b></span>';
  });

  var rows = '';
  details.forEach(function(d) {
    if (!d) return;
    var projHtml = '';
    if (d.projects && d.projects.length) {
      projHtml = d.projects.map(function(pj) {
        var typeLabel = pj.project_type === 'SC' ? '生产' : '研发';
        return '<span class="map-link-chip" onclick="event.stopPropagation();openProject(\'' + pj.id + '\')" title="' + escHtml(pj.name) + '">' +
          renderProjIcon(pj.project_type) +
          '<span>' + escHtml(pj.customer_name || pj.code || pj.name) + '</span>' +
          '<span style="font-size:10px;color:var(--muted)">' + typeLabel + '</span>' +
        '</span>';
      }).join('');
    } else {
      projHtml = '<span style="font-size:11.5px;color:var(--muted)">未关联项目</span>';
    }

    var catBadge = d.category ? '<span class="badge badge-' + (d.category === '存储' ? 'rd' : 'sc') + '">' + escHtml(d.category) + '</span>' : '';

    rows += '<div class="map-card">' +
      '<div class="map-card-hd">' +
        '<div class="map-card-title">' +
          '<span class="map-card-code">' + escHtml(d.code || '#' + d.id) + '</span>' +
          escHtml(d.name) +
          catBadge +
        '</div>' +
        '<div class="map-card-acts">' +
          '<button class="btn" style="font-size:11px;padding:3px 10px" onclick="event.stopPropagation();showLinkDialog(\'product\',' + d.id + ',\'' + escHtml(d.name).replace(/'/g, "\\'") + '\')">+ 关联项目</button>' +
          (d.nas_path ? '<a class="doc-link" href="' + escHtml(d.nas_path) + '" target="_blank" onclick="event.stopPropagation()" style="font-size:11px">NAS</a>' : '') +
          (d.git_url ? '<a class="doc-link" href="' + escHtml(d.git_url) + '" target="_blank" onclick="event.stopPropagation()" style="font-size:11px">Git</a>' : '') +
        '</div>' +
      '</div>' +
      '<div class="map-card-projs">' + projHtml + '</div>' +
    '</div>';
  });

  container.innerHTML =
    '<div class="map-search-row">' +
      '<div class="search-wrap" style="max-width:300px">' +
        '<svg class="search-ico" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="6.5" cy="6.5" r="5"/><line x1="10.5" y1="10.5" x2="14" y2="14"/></svg>' +
        '<input class="search-inp" id="map-search" placeholder="搜索产品名称或代号…" oninput="onMapProductSearch(this.value)">' +
      '</div>' +
      '<div class="map-cats">' + catHtml + '</div>' +
    '</div>' +
    '<div class="map-list">' + rows + '</div>';
}

/* ── By Project ── */

function onMapProjectSearch(v) {
  clearTimeout(_mapSearchTimer);
  _mapSearchTimer = setTimeout(function() { renderMapByProject(); }, 250);
}

async function renderMapByProject() {
  var searchVal = (document.getElementById('map-search-pj') || {}).value || '';
  var container = document.getElementById('map-content');

  var list = _mapProjects;
  if (searchVal) {
    var q = searchVal.toLowerCase();
    list = list.filter(function(p) {
      return (p.customer_name || '').toLowerCase().indexOf(q) >= 0 ||
             (p.code || '').toLowerCase().indexOf(q) >= 0 ||
             (p.name || '').toLowerCase().indexOf(q) >= 0;
    });
  }

  if (!list.length) {
    container.innerHTML = '<div class="empty-state">未找到匹配项目</div>';
    return;
  }

  // Load linked products for each project
  var results = await Promise.all(list.map(function(pj) {
    return API.get('/projects/' + pj.id).then(function(detail) {
      return { project: pj, products: (detail && detail.products) ? detail.products : [] };
    }).catch(function() {
      return { project: pj, products: [] };
    });
  }));

  var rows = '';
  results.forEach(function(r) {
    var pj = r.project;
    var products = r.products;
    var prodHtml = '';
    if (products.length) {
      prodHtml = products.map(function(prod) {
        var catBadge = prod.category ? '<span style="font-size:10px;color:var(--muted)">' + escHtml(prod.category) + '</span>' : '';
        return '<span class="map-link-chip" title="' + escHtml(prod.name) + '">' +
          '<span style="font-weight:540">' + escHtml(prod.code || prod.name) + '</span> ' + catBadge +
          '<span class="map-unlink" onclick="event.stopPropagation();unlinkProduct(' + prod.id + ',' + pj.id + ')" title="取消关联">x</span>' +
        '</span>';
      }).join('');
    } else {
      prodHtml = '<span style="font-size:11.5px;color:var(--muted)">未关联产品</span>';
    }

    rows += '<div class="map-card">' +
      '<div class="map-card-hd">' +
        '<div class="map-card-title">' +
          renderProjIcon(pj.project_type || 'RD') +
          '<span class="map-card-code">' + escHtml(pj.code || '#' + pj.id) + '</span>' +
          escHtml(pj.customer_name || pj.name) +
        '</div>' +
        '<div class="map-card-acts">' +
          '<button class="btn" style="font-size:11px;padding:3px 10px" onclick="event.stopPropagation();showLinkDialog(\'project\',' + pj.id + ',\'' + escHtml((pj.customer_name || pj.name)).replace(/'/g, "\\'") + '\')">+ 关联产品</button>' +
          '<button class="btn" style="font-size:11px;padding:3px 10px" onclick="event.stopPropagation();openProject(\'' + pj.id + '\')">查看详情</button>' +
        '</div>' +
      '</div>' +
      '<div class="map-card-projs">' + prodHtml + '</div>' +
    '</div>';
  });

  container.innerHTML =
    '<div class="map-search-row">' +
      '<div class="search-wrap" style="max-width:300px">' +
        '<svg class="search-ico" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="6.5" cy="6.5" r="5"/><line x1="10.5" y1="10.5" x2="14" y2="14"/></svg>' +
        '<input class="search-inp" id="map-search-pj" placeholder="搜索项目名称或代号…" oninput="onMapProjectSearch(this.value)">' +
      '</div>' +
    '</div>' +
    '<div class="map-list">' + rows + '</div>';
}

/* ── Link/Unlink Dialogs ── */

var _linkDialogType = '';
var _linkDialogId = 0;

function showLinkDialog(type, id, name) {
  _linkDialogType = type;
  _linkDialogId = id;

  var title = type === 'product' ? '关联项目到「' + name + '」' : '关联产品到「' + name + '」';
  var optionsHtml = '';
  if (type === 'product') {
    // Show projects not yet linked
    var productId = id;
    API.get('/products/' + productId).then(function(detail) {
      var linkedIds = (detail.projects || []).map(function(p) { return p.id; });
      var available = _mapProjects.filter(function(p) { return linkedIds.indexOf(p.id) < 0; });
      renderLinkOptions(available, 'project', title);
    });
  } else {
    // Show products not yet linked
    var projectId = id;
    API.get('/projects/' + projectId).then(function(detail) {
      var linkedIds = (detail.products || []).map(function(p) { return p.id; });
      var available = _mapProducts.filter(function(p) { return linkedIds.indexOf(p.id) < 0; });
      renderLinkOptions(available, 'product', title);
    });
  }
}

function renderLinkOptions(items, itemType, title) {
  if (!items.length) {
    showToast('没有可关联的' + (itemType === 'product' ? '产品' : '项目'), 'error');
    closeLinkDialog();
    return;
  }

  var listHtml = items.map(function(item) {
    var label = item.customer_name || item.code || item.name;
    var sub = itemType === 'product' ? (item.category || item.type || '') : (item.project_type || 'RD');
    return '<div class="link-dialog-item" onclick="doLink(' + _linkDialogId + ',' + item.id + ',\'' + _linkDialogType + '\')">' +
      '<div><div style="font-weight:510">' + escHtml(label) + '</div><div style="font-size:10.5px;color:var(--muted)">' + escHtml(sub) + '</div></div>' +
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
  // id1 = _linkDialogId (the subject), id2 = the selected item to link
  var productId = type === 'product' ? id1 : id2;
  var projectId = type === 'product' ? id2 : id1;
  try {
    await API.post('/products/link', { product_id: productId, project_id: projectId });
    showToast('关联成功', 'success');
    closeLinkDialog();
    // Refresh
    await Promise.all([loadMapProducts(), loadMapProjects()]);
    switchMapMode(_mapMode);
  } catch(e) {
    showToast('关联失败: ' + (e.message || '未知错误'), 'error');
  }
}

async function unlinkProduct(productId, projectId) {
  if (!confirm('确认取消此产品与项目的关联？')) return;
  try {
    await API.del('/products/link?product_id=' + productId + '&project_id=' + projectId);
    showToast('已取消关联', 'success');
    await Promise.all([loadMapProducts(), loadMapProjects()]);
    switchMapMode(_mapMode);
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
