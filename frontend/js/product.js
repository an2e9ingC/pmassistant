/* ═══════════════════════════════════════════════════
   PRODUCT LIST & PRODUCT DETAIL VIEWS
═══════════════════════════════════════════════════ */

/* ---- Product List ---- */

var _prodCurCategory = '';
var _prodSearchVal = '';
var _prodSearchTimer = null;
var _allProducts = [];

async function initProductList() {
  _allProducts = [];
  try {
    var data = await API.get('/products?limit=200');
    _allProducts = data.items || [];
  } catch(e) {
    console.error('Failed to load products:', e);
  }
  renderProdCategories();
  filterByProductLine('', null);
}

function renderProdCategories() {
  // Build category list from products
  var cats = {};
  _allProducts.forEach(function(p) {
    var cat = p.category || p.program_name || '其他';
    if (!cats[cat]) cats[cat] = 0;
    cats[cat]++;
  });
  var catNames = Object.keys(cats).sort();
  var container = document.getElementById('prod-line-cat-list');
  var html = '<div class="prod-cat-item' + (_prodCurCategory === '' ? ' active' : '') + '" onclick="filterByProductLine(\'\', this)">全部<span class="prod-cat-count">' + _allProducts.length + '</span></div>';
  catNames.forEach(function(c) {
    html += '<div class="prod-cat-item' + (_prodCurCategory === c ? ' active' : '') + '" onclick="filterByProductLine(\'' + escHtml(c).replace(/'/g, "\\'") + '\', this)">' + escHtml(c) + '<span class="prod-cat-count">' + cats[c] + '</span></div>';
  });
  container.innerHTML = html;
}

function filterByProductLine(cat, el) {
  _prodCurCategory = cat;
  // Update active state
  document.querySelectorAll('#prod-line-cat-list .prod-cat-item').forEach(function(c) { c.classList.remove('active'); });
  if (el) el.classList.add('active');
  renderProductCards();
}

function onProdSearch(v) {
  _prodSearchVal = v;
  clearTimeout(_prodSearchTimer);
  _prodSearchTimer = setTimeout(function() {
    renderProductCards();
  }, 300);
}

function renderProductCards() {
  var filtered = _allProducts;
  // Filter by category
  if (_prodCurCategory) {
    filtered = filtered.filter(function(p) {
      return (p.category || p.program_name || '其他') === _prodCurCategory;
    });
  }
  // Filter by search
  if (_prodSearchVal) {
    var q = _prodSearchVal.toLowerCase();
    filtered = filtered.filter(function(p) {
      var nameMatch = (p.name || '').toLowerCase().indexOf(q) >= 0;
      var codeMatch = (p.code || '').toLowerCase().indexOf(q) >= 0;
      var descMatch = stripHtml(p.description || '').toLowerCase().indexOf(q) >= 0;
      var tagMatch = (p.tags || '').toLowerCase().indexOf(q) >= 0;
      return nameMatch || codeMatch || descMatch || tagMatch;
    });
  }

  var container = document.getElementById('prod-grid-container');
  if (!filtered.length) {
    container.innerHTML = '<div class="empty-state" style="padding:40px">未找到匹配产品</div>';
    return;
  }

  container.innerHTML = '<div class="product-grid">' + filtered.map(function(p) {
    var desc = stripHtml(p.description || '');
    var descShort = desc.length > 80 ? desc.substring(0, 80) + '...' : desc;
    var tagsHtml = '';
    if (p.tags_list && p.tags_list.length > 0 && p.tags_list[0] !== '') {
      tagsHtml = p.tags_list.map(function(t) {
        return '<span class="tag-badge tag-' + (t.length % 5) + '">#' + escHtml(t) + '</span>';
      }).join('');
    }
    return '<div class="product-card" onclick="openProductDetail(\'' + p.id + '\')">' +
      '<div class="product-card-name">' + escHtml(p.name) + '</div>' +
      '<div class="product-card-code">' + escHtml(p.code || '') + '</div>' +
      (descShort ? '<div class="product-card-desc">' + escHtml(descShort) + '</div>' : '') +
      (tagsHtml ? '<div class="product-card-tags">' + tagsHtml + '</div>' : '') +
      '<div class="product-card-meta">' +
        '<span class="pill ' + (p.status || 'normal') + '">' + (p.status || '—') + '</span>' +
        '<span style="font-size:11px;color:var(--muted)">关联项目: ' + p.project_count + '</span>' +
      '</div>' +
    '</div>';
  }).join('') + '</div>';
}

function openProductDetail(id) {
  _prodDetailCurId = id;
  gotoView('product-detail');
}

/* ---- Product Detail ---- */

var _prodDetailCurId = null;
var _prodComboAll = [];

async function initProductDetail() {
  try {
    var data = await API.get('/products?limit=200');
    _prodComboAll = data.items || [];
  } catch(e) {
    console.error('Failed to load products for combo:', e);
    _prodComboAll = [];
  }
  if (_prodDetailCurId) {
    loadProductDetail(_prodDetailCurId);
  }
}

function openProdCombo() {
  var dd = document.getElementById('prod-combo-dropdown');
  dd.innerHTML = _prodComboAll.map(function(p) {
    return '<div class="combo-opt" onclick="selectProdCombo(\'' + p.id + '\', \'' + escHtml(p.name).replace(/'/g, "\\'") + '\')">' +
      '<span class="combo-opt-code">' + escHtml(p.code || '') + '</span>' +
      '<span class="combo-opt-name">' + escHtml(p.name) + '</span>' +
    '</div>';
  }).join('');
  dd.classList.add('open');
}

function filterProdCombo(v) {
  openProdCombo();
  var q = v.toLowerCase();
  if (!q) return;
  var dd = document.getElementById('prod-combo-dropdown');
  var filtered = _prodComboAll.filter(function(p) {
    return (p.name || '').toLowerCase().indexOf(q) >= 0 || (p.code || '').toLowerCase().indexOf(q) >= 0;
  });
  dd.innerHTML = filtered.length ? filtered.map(function(p) {
    return '<div class="combo-opt" onclick="selectProdCombo(\'' + p.id + '\', \'' + escHtml(p.name).replace(/'/g, "\\'") + '\')">' +
      '<span class="combo-opt-code">' + escHtml(p.code || '') + '</span>' +
      '<span class="combo-opt-name">' + escHtml(p.name) + '</span>' +
    '</div>';
  }).join('') : '<div class="combo-none">未找到匹配产品</div>';
}

function selectProdCombo(id, name) {
  _prodDetailCurId = id;
  document.getElementById('prod-combo-input').value = name;
  document.getElementById('prod-combo-dropdown').classList.remove('open');
  loadProductDetail(id);
}

// Close combo on outside click
document.addEventListener('click', function(e) {
  var combo = document.getElementById('prod-combo');
  if (combo && !combo.contains(e.target)) {
    var dd = document.getElementById('prod-combo-dropdown');
    if (dd) dd.classList.remove('open');
  }
});

async function loadProductDetail(id) {
  _prodDetailCurId = id;
  // Update combo input
  var selected = _prodComboAll.find(function(p) { return p.id === parseInt(id); });
  if (selected) {
    document.getElementById('prod-combo-input').value = selected.name;
  }

  // Show loading
  document.getElementById('prod-detail-header').innerHTML = '<div class="loading-spinner">加载中...</div>';
  document.getElementById('prod-info-grid').innerHTML = '<div class="loading-spinner">加载中...</div>';
  document.getElementById('prod-projects-tbody').innerHTML = '<tr><td colspan="4"><div class="loading-spinner">加载中...</div></td></tr>';
  document.getElementById('prod-resources-card').innerHTML = '<div class="loading-spinner">加载中...</div>';

  try {
    var detail = await API.get('/products/' + id);
    renderProdDetailHeader(detail);
    renderProdDetailInfo(detail);
    renderProdDetailProjects(detail);
    renderProdDetailResources(detail);
  } catch(e) {
    document.getElementById('prod-detail-header').innerHTML = '<div class="error-state">加载失败: ' + escHtml(e.message) + '</div>';
  }
}

function renderProdDetailHeader(p) {
  var tagsHtml = '';
  if (p.tags_list && p.tags_list.length > 0 && p.tags_list[0] !== '') {
    tagsHtml = p.tags_list.map(function(t) {
      return '<span class="tag-badge tag-' + (t.length % 5) + '">#' + escHtml(t) + '</span>';
    }).join('');
  }
  document.getElementById('prod-detail-header').innerHTML =
    '<div class="detail-title">' + escHtml(p.name) + '</div>' +
    '<div class="detail-subtitle">' + escHtml(p.code || '') + '</div>' +
    (tagsHtml ? '<div style="margin-top:8px">' + tagsHtml + '</div>' : '') +
    (p.description ? '<div style="margin-top:8px;font-size:13px;color:var(--muted);line-height:1.5">' + escHtml(stripHtml(p.description)) + '</div>' : '');
}

function renderProdDetailInfo(p) {
  var customers = p.customers_from_desc || [];
  var customersHtml = customers.length ? customers.map(function(c) { return renderCustomerBadge(c); }).join(' ') : '<span style="color:var(--muted)">—</span>';
  var html =
    '<div class="prod-info-item"><span class="prod-info-label">产品线</span><span class="prod-info-val">' + escHtml(p.category || p.program_name || '—') + '</span></div>' +
    '<div class="prod-info-item"><span class="prod-info-label">状态</span><span class="prod-info-val">' + renderPill(p.status) + '</span></div>' +
    '<div class="prod-info-item"><span class="prod-info-label">类型</span><span class="prod-info-val">' + escHtml(p.type || '—') + '</span></div>' +
    '<div class="prod-info-item"><span class="prod-info-label">需求数</span><span class="prod-info-val">' + p.total_stories + '</span></div>' +
    '<div class="prod-info-item"><span class="prod-info-label">Bug数</span><span class="prod-info-val">' + p.total_bugs + '</span></div>' +
    '<div class="prod-info-item"><span class="prod-info-label">发布次数</span><span class="prod-info-val">' + p.releases + '</span></div>' +
    '<div class="prod-info-item"><span class="prod-info-label">关联客户</span><span class="prod-info-val">' + customersHtml + '</span></div>';
  if (p.nas_path) {
    html += '<div class="prod-info-item"><span class="prod-info-label">NAS路径</span><span class="prod-info-val"><code>' + escHtml(p.nas_path) + '</code></span></div>';
  }
  if (p.git_url) {
    html += '<div class="prod-info-item"><span class="prod-info-label">Git仓库</span><span class="prod-info-val"><code>' + escHtml(p.git_url) + '</code></span></div>';
  }
  document.getElementById('prod-info-grid').innerHTML = html;
}

function renderProdDetailProjects(p) {
  var projects = p.projects || [];
  var tbody = document.getElementById('prod-projects-tbody');
  if (!projects.length) {
    tbody.innerHTML = '<tr><td colspan="4"><div class="empty-state">暂无关联项目</div></td></tr>';
    return;
  }
  tbody.innerHTML = projects.map(function(proj) {
    var projCode = extractProjectCode(proj.name);
    var coreName = extractCoreName(proj.name);
    return '<tr onclick="openProject(\'' + proj.id + '\')" style="cursor:pointer">' +
      '<td><div class="proj-id-cell">' +
        renderProjIcon(proj.project_type, projCode) +
        '<div><div class="proj-name">' + escHtml(coreName) + '</div><div class="proj-code">' + escHtml(projCode) + '</div></div>' +
      '</div></td>' +
      '<td>' + renderCustomerBadge(proj.customer_name) + '</td>' +
      '<td>' + renderTypeBadge(proj.project_type) + '</td>' +
      '<td>' + renderPill(proj.status) + '</td>' +
    '</tr>';
  }).join('');
}

function renderProdDetailResources(p) {
  var card = document.getElementById('prod-resources-card');
  var html = '<ul style="list-style:none;padding:16px;margin:0">';
  var items = [];
  if (p.nas_path) {
    items.push('<li style="padding:6px 0;font-size:13px"><span style="color:var(--muted)">NAS路径: </span><code>' + escHtml(p.nas_path) + '</code></li>');
  }
  if (p.git_url) {
    items.push('<li style="padding:6px 0;font-size:13px"><span style="color:var(--muted)">Git仓库: </span><code>' + escHtml(p.git_url) + '</code></li>');
  }
  if (p.releases > 0) {
    items.push('<li style="padding:6px 0;font-size:13px"><span style="color:var(--muted)">发布次数: </span>' + p.releases + '</li>');
  }
  if (!items.length) {
    items.push('<li style="padding:6px 0;font-size:13px;color:var(--muted)">暂无交付资料信息</li>');
  }
  html += items.join('') + '</ul>';
  card.innerHTML = html;
}
