/* ═══════════════════════════════════════════════════
   PRODUCT LIST & PRODUCT DETAIL VIEWS
═══════════════════════════════════════════════════ */

/* ---- Product List (Overview) ── Card Layout ── */

var _prodActiveL1 = null;  // null = all
var _prodActiveL2 = null;
var _prodSearchVal = '';
var _prodSearchTimer = null;
var _allProducts = [];
var _prodTree = [];

var _prodCatColors = ['var(--accent)', 'var(--success)', 'var(--warn)', 'var(--danger)'];
var _prodCatCls = ['pov-self', 'pov-integ', 'pov-purch', 'pov-inner'];
var _prodCatIcons = ['⊞', '⊡', '⊕', '⊟'];

async function initProductList() {
  _allProducts = [];
  try {
    var data = await API.get('/products?limit=200');
    _allProducts = data.items || [];
  } catch(e) { console.error('Failed to load products:', e); }
  try {
    _prodTree = (await API.get('/product-doc-templates/product-tree')) || [];
  } catch(e) { _prodTree = []; }

  await loadFavProducts();
  _prodActiveL1 = null;
  _prodActiveL2 = null;
  renderProdOverview();
  setTimeout(function() {
    var el = document.getElementById('prod-search');
    if (el) { el.focus(); el.select(); }
  }, 300);
}

function _prodTotal(l1, l2) {
  var key = l1.name + ' > ' + (l2 ? l2.name : '');
  if (l2) {
    return _allProducts.filter(function(p) { return (p.tree_path || '') === key; }).length;
  }
  var total = 0;
  (l1.children || []).forEach(function(c) {
    total += _allProducts.filter(function(p) { return (p.tree_path || '') === (l1.name + ' > ' + c.name); }).length;
  });
  return total;
}

function renderProdOverview() {
  if (!_prodTree.length) {
    document.getElementById('pov-container').innerHTML = '<div class="pov-empty-state"><p>暂无产品数据</p></div>';
    return;
  }

  // L1 category cards
  var catGrid = document.getElementById('pov-cat-grid');
  var favCount = getFavProducts().length;
  catGrid.innerHTML = '<div class="pov-cat-card' + (_prodActiveL1 === null ? ' active' : '') + '" onclick="_povSelectL1(null)">' +
    '<div class="pov-cat-icon" style="background:var(--warn-lt);color:var(--warn)">★</div>' +
    '<div class="pov-cat-info"><div class="pov-cat-name">关注产品</div><div class="pov-cat-desc">用户收藏的产品</div></div>' +
    '<div class="pov-cat-count" style="color:var(--warn)">' + favCount + '</div></div>' +
    _prodTree.map(function(l1, i) {
      var idx = i % _prodCatColors.length;
      var c = _prodCatColors[idx];
      var total = _prodTotal(l1);
      return '<div class="pov-cat-card' + (_prodActiveL1 === l1.id ? ' active' : '') + '" onclick="_povSelectL1(' + l1.id + ')" style="--accent:' + c + '">' +
        '<div class="pov-cat-icon" style="background:color-mix(in srgb,' + c + ' 12%,transparent);color:' + c + '">' + _prodCatIcons[idx] + '</div>' +
        '<div class="pov-cat-info"><div class="pov-cat-name">' + escHtml(l1.name) + '</div><div class="pov-cat-desc">' + total + ' 个产品</div></div>' +
        '<div class="pov-cat-count" style="color:' + c + '">' + total + '</div></div>';
    }).join('');

  // L2 chips + products
  _povRenderContent();
}

function _povSelectL1(l1Id) {
  _prodActiveL1 = l1Id;
  _prodActiveL2 = null;
  _prodSearchVal = '';
  var inp = document.getElementById('prod-search');
  if (inp) inp.value = '';
  renderProdOverview();
}

function _povSelectL2(l2Id) {
  _prodActiveL2 = l2Id;
  document.querySelectorAll('.pov-l2-chip').forEach(function(c) {
    c.classList.toggle('active', c.getAttribute('data-l2-id') === String(l2Id));
  });
  _prodSearchVal = '';
  var inp = document.getElementById('prod-search');
  if (inp) inp.value = '';
  _povRenderProducts();
}

function _povRenderContent() {
  var l1 = _prodActiveL1 ? _prodTree.find(function(t) { return t.id === _prodActiveL1; }) : null;
  var l2Bar = document.getElementById('pov-l2-bar');
  var prodGrid = document.getElementById('pov-prod-grid');
  var searchBar = document.getElementById('pov-search-bar');

  // L2 chips: for L1 categories or favorites, show subcategories with counts
  if (_prodActiveL1) {
    var l2s = l1 ? (l1.children || []) : [];
    var allActive = _prodActiveL2 === null;
    var total = l1 ? _prodTotal(l1) : _allProducts.length;
    l2Bar.innerHTML = (l2s.length ? '<span class="pov-l2-label">子类：</span>' : '') +
      '<span class="pov-l2-chip' + (allActive ? ' active' : '') + '" onclick="_povSelectL2(null)">全部<span class="pov-l2-count">' + total + '</span></span>' +
      l2s.map(function(l2) {
        var cnt = _prodTotal(l1, l2);
        var active = _prodActiveL2 === l2.id;
        return '<span class="pov-l2-chip' + (active ? ' active' : '') + '" data-l2-id="' + l2.id + '" onclick="_povSelectL2(' + l2.id + ')">' + escHtml(l2.name) + '<span class="pov-l2-count">' + cnt + '</span></span>';
      }).join('');
  } else {
    // Favorites: show L2 chips with counts from favorited products only
    var favIds = getFavProducts();
    var favProducts = _allProducts.filter(function(p) { return favIds.indexOf(p.id) >= 0; });
    // Collect unique L2 keys with counts
    var l2Map = {};
    _prodTree.forEach(function(l1) {
      (l1.children || []).forEach(function(l2) {
        var key = l1.name + ' > ' + l2.name;
        var cnt = favProducts.filter(function(p) { return (p.tree_path || '') === key; }).length;
        if (cnt > 0) l2Map[l2.name] = { id: l2.id, name: l2.name, count: (l2Map[l2.name] ? l2Map[l2.name].count + cnt : cnt) };
      });
    });
    var l2Arr = Object.values(l2Map);
    var totalFav = favProducts.length;
    var allActive = _prodActiveL2 === null;
    l2Bar.innerHTML = (l2Arr.length ? '<span class="pov-l2-label">子类：</span>' : '') +
      '<span class="pov-l2-chip' + (allActive ? ' active' : '') + '" onclick="_povSelectL2(null)">全部<span class="pov-l2-count">' + totalFav + '</span></span>' +
      l2Arr.map(function(l2) {
        var active = _prodActiveL2 === l2.id;
        return '<span class="pov-l2-chip' + (active ? ' active' : '') + '" data-l2-id="' + l2.id + '" onclick="_povSelectL2(' + l2.id + ')">' + escHtml(l2.name) + '<span class="pov-l2-count">' + l2.count + '</span></span>';
      }).join('');
  }

  _povRenderProducts();
}

function _povRenderProducts() {
  var grid = document.getElementById('pov-prod-grid');
  var products = _allProducts;

  // Filter by L1 (null = favorites)
  if (_prodActiveL1) {
    var l1 = _prodTree.find(function(t) { return t.id === _prodActiveL1; });
    if (l1) {
      products = products.filter(function(p) {
        var path = p.tree_path || '';
        return path.indexOf(l1.name + ' > ') === 0 || path === l1.name;
      });
    } else {
      products = [];
    }
  }
  // Filter by L2
  if (_prodActiveL2) {
    var l2Key = null;
    _prodTree.forEach(function(t) {
      (t.children || []).forEach(function(c) {
        if (c.id === _prodActiveL2) l2Key = t.name + ' > ' + c.name;
      });
    });
    if (l2Key) {
      products = products.filter(function(p) { return (p.tree_path || '') === l2Key; });
    }
  }
  // Filter favorites (when "关注产品" is active, _prodActiveL1 === null)
  if (_prodActiveL1 === null) {
    var favIds = getFavProducts();
    products = products.filter(function(p) { return favIds.indexOf(p.id) >= 0; });
  }

  // Search (searches ALL products, ignoring tree filter)
  if (_prodSearchVal) {
    products = _allProducts;  // reset to ALL products before search
    var q = _prodSearchVal.toLowerCase();
    products = products.filter(function(p) {
      return (p.code || '').toLowerCase().indexOf(q) >= 0 ||
        (p.name || '').toLowerCase().indexOf(q) >= 0 ||
        (p.tags || '').toLowerCase().indexOf(q) >= 0;
    });
  }

  // Count
  var cnt = document.getElementById('pov-search-count');
  if (_prodSearchVal) {
    cnt.innerHTML = '找到 <strong>' + products.length + '</strong> 个匹配产品';
    cnt.style.display = '';
  } else {
    cnt.style.display = 'none';
  }

  if (!products.length) {
    grid.innerHTML = '<div class="pov-empty-state" style="grid-column:1/-1"><p>没有匹配的产品</p></div>';
    return;
  }

  grid.innerHTML = products.map(function(p) {
    var tagsHtml = '';
    var tagTexts = (p.tags_list || []).filter(function(t){return t;});
    if (tagTexts.length) {
      tagsHtml = '<div class="prod-tags">' + tagTexts.slice(0,4).map(function(t,j){ return '<span class="prod-tag t' + (j%5) + '">' + escHtml(t) + '</span>'; }).join('') + '</div>';
    }
    // Per-stage doc completion rings
    var stageOrder = ['硬件开发', '结构设计', 'BSP开发', '软件开发', '测试'];
    var docStages = p.doc_stages || [];
    var stageMap = {};
    docStages.forEach(function(s) { stageMap[s.stage_type] = s; });
    var ringsHtml = '';
    stageOrder.forEach(function(st) {
      var s = stageMap[st];
      if (!s || s.total === 0) return;
      var color = s.pct >= 100 ? 'var(--success)' : (s.pct > 0 ? 'var(--orange)' : 'var(--muted)');
      ringsHtml += '<div style="text-align:center;cursor:pointer" onclick="event.stopPropagation();_prodDetailTargetTab=\'docs\';openProductDetail(\'' + escHtml(p.code || '').replace(/'/g, "\\'") + '\')" title="' + escHtml(st) + ': ' + s.done + '/' + s.total + '">' +
        renderProgressCircle(s.pct, 32, { label: '', color: color }) +
        '<div style="font-size:8px;color:var(--muted);margin-top:1px;line-height:1.1">' + escHtml(st.replace('开发','') || st) + '</div>' +
      '</div>';
    });
    Object.keys(stageMap).forEach(function(st) {
      if (stageOrder.indexOf(st) >= 0) return;
      var s = stageMap[st];
      var color = s.pct >= 100 ? 'var(--success)' : (s.pct > 0 ? 'var(--orange)' : 'var(--muted)');
      ringsHtml += '<div style="text-align:center;cursor:pointer" onclick="event.stopPropagation();_prodDetailTargetTab=\'docs\';openProductDetail(\'' + escHtml(p.code || '').replace(/'/g, "\\'") + '\')" title="' + escHtml(st) + ': ' + s.done + '/' + s.total + '">' +
        renderProgressCircle(s.pct, 32, { label: '', color: color }) +
        '<div style="font-size:8px;color:var(--muted);margin-top:1px;line-height:1.1">' + escHtml(st.replace('开发','') || st) + '</div>' +
      '</div>';
    });
    var sourceBadge = '<span class="prod-src ' + (p.is_local ? 'local' : 'synced') + '">' + (p.is_local ? 'PMA 本地' : '禅道同步') + '</span>';

    return '<div class="pov-prod-card" style="position:relative" onclick="openProductDetail(\'' + escHtml(p.code || '').replace(/'/g, "\\'") + '\')">' +
      '<span style="position:absolute;top:10px;right:10px;z-index:1">' + favStar('product', p.id, {stopPropagation:true, size:'20px'}) + '</span>' +
      '<div class="pov-prod-header"><div>' +
        '<div class="prod-code">' + escHtml(p.code || '#' + p.id) + '</div>' +
        '<div class="prod-name">' + escHtml(p.name) + '</div>' +
      '</div></div>' +
      (tagsHtml || '') +
      (ringsHtml ? '<div class="prod-footer" style="display:flex;gap:6px;align-items:flex-end">' + sourceBadge + '<div style="display:flex;gap:4px;margin-left:auto">' + ringsHtml + '</div></div>' : '<div class="prod-footer">' + sourceBadge + '</div>') +
    '</div>';
  }).join('');
}

function _toggleProdFav(id, btn) {
  var added = toggleFavProduct(id);
  btn.innerHTML = added ? '★' : '☆';
  btn.title = added ? '取消收藏' : '收藏';
  btn.style.color = added ? 'var(--yellow)' : '';
  renderProdOverview();
}

function onProdSearch(v) {
  _prodSearchVal = v;
  clearTimeout(_prodSearchTimer);
  _prodSearchTimer = setTimeout(function() { _povRenderProducts(); }, 300);
}

document.addEventListener('keydown', function(e) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    var activeView = document.querySelector('.view.active');
    if (activeView && activeView.id === 'view-product-list') {
      e.preventDefault();
      var searchEl = document.getElementById('prod-search');
      if (searchEl) { searchEl.focus(); searchEl.select(); }
    }
  }
});

// ESC in search box clears and resets (deferred to after DOM ready)
setTimeout(function() {
  var searchEl = document.getElementById('prod-search');
  if (searchEl) {
    searchEl.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') { this.value = ''; onProdSearch(''); }
    });
  }
}, 500);

function openProductDetail(code, tabId) {
  _prodDetailCurId = null;  // will be set by combo or init
  _prodDetailCurCode = code;
  sessionStorage.setItem('pm_last_prod_code', code);
  gotoView('product-detail', {params: [String(code), tabId || 'info']});
}

/* ---- Product Detail ---- */

var _prodDetailCurId = null;
var _prodDetailCurCode = null;
var _prodDocScanning = false;
var _prodDetailTargetTab = null;  // set before navigation to jump to a specific tab
var _prodComboAll = [];

async function initProductDetail(code, tabId) {
  if (code) {
    _prodDetailCurCode = code;
    if (tabId) _prodDetailTargetTab = tabId;
  }
  try {
    var data = await API.get('/products?limit=200');
    _prodComboAll = data.items || [];
  } catch(e) { _prodComboAll = []; }
  // Find product by code to get integer id for combo
  if (code) {
    var found = _prodComboAll.find(function(p) { return p.code === code || String(p.id) === code; });
    if (found) _prodDetailCurId = found.id;
  }
  initSearchCombo({
    comboId: 'prod-combo',
    inputId: 'prod-combo-input',
    dropdownId: 'prod-combo-dropdown',
    dataSource: _prodComboAll,
    selectedIdFn: function() { return _prodDetailCurId; },
    onSelect: function(p) { _prodDetailCurId = p.id; _prodDetailCurCode = p.code || String(p.id); loadProductDetail(_prodDetailCurCode); if (!_prodDetailTargetTab) { history.replaceState({ view: 'product-detail', params: [_prodDetailCurCode, 'info'] }, '', buildHash('product-detail', _prodDetailCurCode, 'info')); } }
  });
  if (_prodDetailCurId) {
    loadProductDetail(_prodDetailCurCode);
  }
}

var _prodDetail = null;

function switchProdTab(id, el, skipHistory) {
  document.querySelectorAll('#view-product-detail .dsec').forEach(function(s) { s.classList.remove('active'); });
  document.querySelectorAll('#view-product-detail .dtab').forEach(function(t) { t.classList.remove('active'); });
  var sec = document.getElementById('prodsec-' + id);
  if (sec) sec.classList.add('active');
  if (!el) el = document.querySelector('#view-product-detail .dtab[onclick*="switchProdTab(\\\'' + id + '\\\'"]');
  if (el) el.classList.add('active');
  if (id === 'maintenance' && _prodDetail) renderProdMaintenance(_prodDetail);
  if (id === 'activities') loadProdActivities();
  if (id === 'bugs' && _prodDetailCurCode) {
    if (typeof openBugDetail !== 'function' && typeof loadViewScript === 'function') {
      loadViewScript('/js/bugs.js?v=' + APP_VERSION, function() { loadProductBugs(); });
    } else {
      loadProductBugs();
    }
  }
  // Update hash: user clicks push, back navigation skip
  if (!skipHistory && _prodDetailCurCode && typeof buildHash === 'function') {
    history.pushState({ view: 'product-detail', params: [_prodDetailCurCode, id] }, '', buildHash('product-detail', _prodDetailCurCode, id));
  }
}

async function loadProductDetail(code) {
  // Reset to 基本信息 tab on entry (unless a target tab is specified)
  var targetTab = _prodDetailTargetTab || 'info';
  _prodDetailTargetTab = null;
  var tabEl = document.querySelector('#view-product-detail .dtab[onclick*="switchProdTab(\'' + targetTab + '\'"]');
  if (tabEl) switchProdTab(targetTab, tabEl, true /* skipHistory — replaceState above already handles it */);

  var selected = _prodComboAll.find(function(p) { return p.code === code || String(p.id) === code; });
  if (selected) {
    _prodDetailCurId = selected.id;
    _prodDetailCurCode = selected.code || String(selected.id);
    document.getElementById('prod-combo-input').value = selected.code || selected.name;
  }

  document.getElementById('prod-detail-header').innerHTML = '<div class="loading-spinner">加载中...</div>';
  ['prodsec-info', 'prodsec-docs', 'prodsec-activities', 'prodsec-maintenance', 'prodsec-bugs'].forEach(function(s) {
    document.getElementById(s).innerHTML = '<div class="card" style="padding:20px"><div class="loading-spinner">加载中...</div></div>';
  });
  var actContainer = document.getElementById('prod-activities-content');
  if (actContainer) actContainer.innerHTML = '<div class="loading-spinner">加载活动记录...</div>';

  try {
    var detail = await API.get('/products/' + code);
    _prodDetail = detail;
    // Load docs first so header can show per-stage completion rings
    var docs = [];
    try { docs = await API.get('/products/' + code + '/documents') || []; } catch(e) {}
    renderProdDetailHeader(detail, docs);
    renderProdInfo(detail, docs);
    renderProdDocs(detail, docs);  // pass pre-loaded docs to avoid duplicate fetch
  } catch(e) {
    document.getElementById('prod-detail-header').innerHTML = '<div class="error-state">加载失败: ' + escHtml(e.message) + '</div>';
  }
  // Update hash to reflect current product + tab
  if (_prodDetailCurCode && typeof buildHash === 'function') {
    history.replaceState({ view: 'product-detail', params: [_prodDetailCurCode, targetTab] }, '', buildHash('product-detail', _prodDetailCurCode, targetTab));
  }
}

function renderProdDetailHeader(p, docs) {
  // Compute per-stage completion
  var stageStats = {};
  var stageOrder = ['硬件开发', '结构设计', 'BSP开发', '软件开发', '测试'];
  (docs || []).forEach(function(d) {
    var st = d.stage_type || '通用';
    if (!stageStats[st]) stageStats[st] = { total: 0, done: 0 };
    stageStats[st].total++;
    if (d.done) stageStats[st].done++;
  });

  // Build per-stage progress rings
  var ringsHtml = '';
  stageOrder.forEach(function(st) {
    var s = stageStats[st];
    if (!s || s.total === 0) return;
    var pct = Math.round(s.done / s.total * 100);
    var color = pct >= 100 ? 'var(--success)' : (pct > 0 ? 'var(--warn)' : 'var(--muted)');
    ringsHtml += '<div style="text-align:center;flex-shrink:0;cursor:pointer;transition:transform 0.15s" onmouseenter="this.style.transform=\'scale(1.2)\'" onmouseleave="this.style.transform=\'scale(1)\'" onclick="switchProdTab(\'docs\');setTimeout(function(){_scrollToDocStage(\'' + escJs(st) + '\')},100)" title="' + escHtml(st) + ': ' + s.done + '/' + s.total + '">' +
      renderProgressCircle(pct, 40, { label: '', color: color }) +
      '<div style="font-size:9px;color:var(--muted);margin-top:2px;max-width:48px;line-height:1.2">' + escHtml(st) + '</div>' +
      '</div>';
  });
  // Also show unsorted stages
  Object.keys(stageStats).forEach(function(st) {
    if (stageOrder.indexOf(st) >= 0) return;
    var s = stageStats[st];
    var pct = Math.round(s.done / s.total * 100);
    var color = pct >= 100 ? 'var(--success)' : (pct > 0 ? 'var(--warn)' : 'var(--muted)');
    ringsHtml += '<div style="text-align:center;flex-shrink:0;cursor:pointer;transition:transform 0.15s" onmouseenter="this.style.transform=\'scale(1.2)\'" onmouseleave="this.style.transform=\'scale(1)\'" onclick="switchProdTab(\'docs\');setTimeout(function(){_scrollToDocStage(\'' + escJs(st) + '\')},100)" title="' + escHtml(st) + ': ' + s.done + '/' + s.total + '">' +
      renderProgressCircle(pct, 40, { label: '', color: color }) +
      '<div style="font-size:9px;color:var(--muted);margin-top:2px;max-width:48px;line-height:1.2">' + escHtml(st) + '</div>' +
      '</div>';
  });

  document.getElementById('prod-detail-header').innerHTML =
    '<div class="detail-meta">' +
      '<div class="detail-title">' +
        '<span style="vertical-align:middle;margin-right:4px">' + favStar('product', p.id, {size:'22px'}) + '</span>' +
        (p.code ? '<span class="proj-code-tag" style="margin-right:8px;vertical-align:middle">' + escHtml(p.code) + '</span>' : '') +
        escHtml(p.name) +
        (p.is_local
          ? ' <span class="pm-src-badge local" style="vertical-align:middle;margin-left:6px">PMA本地</span>'
          : (p.synced_at ? ' <span class="pm-src-badge synced" style="vertical-align:middle;margin-left:6px" title="同步于 ' + escHtml(p.synced_at) + '">禅道同步</span>' : '')) +
        (!p.is_local && p.zentao_url ? '<a href="' + p.zentao_url + '" target="_blank" class="zentao-link" style="margin-left:10px;font-size:12px" title="在禅道中查看">&#x2197; 禅道</a>' : '') +
      '</div>' +
    '</div>' +
    '<div style="flex-shrink:0;margin-left:auto;display:flex;gap:16px;align-items:flex-start">' + ringsHtml + '</div>';
}

// ── Tab: 基本信息 ──

function renderProdInfo(p, docs) {
  var productType = p.tree_path || p.category || p.program_name || '未分类';

  var html = '<div style="display:flex;gap:20px;align-items:flex-start">';

  // Left column — main card
  html += '<div class="card info-glass-card" style="flex:1.618;min-width:0;padding:20px">';

  // Info row — 4 columns, consistent style
  html += '<div class="delivery-kpi" style="grid-template-columns:repeat(4, 1fr);margin-bottom:16px">' +
    '<div class="dkpi" style="cursor:pointer" onclick="' +
      (p.linked_node_ids && p.linked_node_ids.length ? '_pmSelectedNodeId=' + p.linked_node_ids[0] + ';gotoView(\'product-management\')' : '') +
      '" title="点击跳转到产品管理">' +
      '<div class="dkpi-lbl">所属分类</div><div class="dkpi-val" style="font-size:16px;font-weight:600;color:var(--accent)">' + escHtml(productType) + '</div></div>' +
    '<div class="dkpi"><div class="dkpi-lbl">状态</div><div class="dkpi-val" style="font-size:16px;font-weight:600;color:' + (p.status === 'normal' ? 'var(--success)' : p.status === 'closed' ? 'var(--muted)' : 'var(--warn)') + '">' + (p.status === 'normal' ? '正常' : p.status === 'closed' ? '已关闭' : (p.status || '—')) + '</div></div>' +
    '<div class="dkpi"><div class="dkpi-lbl">描述</div><div class="dkpi-val" style="font-size:12px;line-height:1.6">' + (p.tags_list && p.tags_list[0] ? p.tags_list.filter(function(t){return t;}).map(function(t){return '<span class="tag-badge tag-' + (t.length % 5) + '">#' + escHtml(t) + '</span>';}).join(' ') : '<span style="color:var(--muted)">—</span>') + '</div></div>' +
  '</div>';

  // Stats row — KPI numbers with status colors; Bug card uses donut ring
  html += '<div class="delivery-kpi" style="grid-template-columns:repeat(4, 1fr)">';
  // 关联项目 — bubble animation sliding right-to-left
  var projectsList = p.projects || [];
  html += '<div class="dkpi" style="cursor:pointer;position:relative;overflow:hidden" onclick="switchToProdMaintenance()" title="点击查看关联项目">' +
    '<div class="dkpi-lbl">🔗 关联项目</div>' +
    '<div class="dkpi-val" style="color:var(--accent);position:relative;z-index:1">' + (p.project_count || 0) + '</div>';
  if (projectsList.length > 0) {
    if (!document.getElementById('proj-bubble-style')) {
      var style = document.createElement('style');
      style.id = 'proj-bubble-style';
      // 0-30% visible slide-and-fade, 30-100% invisible tail — clean gap between bubbles
      style.textContent = '@keyframes projBubbleSlide{0%{transform:translateX(0);opacity:0}5%{opacity:0.7}20%{opacity:0.2}30%{transform:translateX(-200px);opacity:0}100%{transform:translateX(-200px);opacity:0}}.proj-bubble{position:absolute;right:8px;font-size:11px;white-space:nowrap;color:var(--accent);pointer-events:none;animation-name:projBubbleSlide;animation-iteration-count:infinite;animation-timing-function:linear;animation-fill-mode:backwards}';
      document.head.appendChild(style);
    }
    // Per-layer accumulator: ensure previous bubble is invisible before next starts
    var layerNext = [0, 0, 0, 0];
    projectsList.forEach(function(proj, i) {
      var name = proj.name || proj.code || '';
      var nameLen = Math.max(1, name.length);
      var layer = i % 4;
      var topPct = 30 + layer * 18;
      var dur = nameLen * 0.5 + 3;
      var delay = layerNext[layer];
      // Minimum 5s gap ensures previous bubble fully invisible before next appears
      layerNext[layer] += Math.max(dur * 0.5, 5);
      html += '<span class="proj-bubble" style="top:' + topPct + '%;animation-duration:' + dur.toFixed(1) + 's;animation-delay:' + delay.toFixed(1) + 's">' + escHtml(name) + '</span>';
    });
  }
  html += '</div>';
  // Other stats
  var stats = [
    { label: '发布次数', value: p.releases || 0, color: 'var(--warn)', icon: '🚀' },
    { label: '需求总数', value: p.total_stories || 0, color: 'var(--success)', icon: '📋' },
  ];
  stats.forEach(function(s) {
    html += '<div class="dkpi">' +
      '<div class="dkpi-lbl">' + s.icon + ' ' + s.label + '</div>' +
      '<div class="dkpi-val" style="color:' + s.color + '">' + s.value + '</div></div>';
  });
  // Bug KPI — donut ring with source breakdown
  var zentaoBugs = p.total_bugs || 0;
  var pmaBugs = p.pma_bugs || 0;
  var totalBugs = zentaoBugs + pmaBugs;
  var bugPctZentao = totalBugs > 0 ? Math.round(zentaoBugs / totalBugs * 100) : 0;
  var bugPctPma = totalBugs > 0 ? Math.round(pmaBugs / totalBugs * 100) : 0;
  // Build conic-gradient: Zentao=var(--danger) PMA=#EAB308
  var ringParts = [];
  if (zentaoBugs > 0) ringParts.push('var(--yellow) 0% ' + bugPctZentao + '%');
  if (pmaBugs > 0) ringParts.push('var(--accent) ' + bugPctZentao + '% ' + (bugPctZentao + bugPctPma) + '%');
  var ringGradient = ringParts.length ? 'background:conic-gradient(' + ringParts.join(',') + ');' : '';
  var bugRingHtml = '<div class="dkpi" title="禅道: ' + zentaoBugs + ' | PMA: ' + pmaBugs + '">' +
    '<div class="dkpi-lbl">🐛 Bug 总数</div>' +
    '<div style="display:flex;align-items:center;gap:10px">' +
      '<div style="position:relative;width:52px;height:52px;flex-shrink:0">' +
        '<div style="width:44px;height:44px;border-radius:50%;' + ringGradient + 'margin:4px"></div>' +
        '<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:30px;height:30px;border-radius:50%;background:var(--bg);display:flex;align-items:center;justify-content:center">' +
          '<span style="font-size:14px;font-weight:700;font-family:var(--mono);color:var(--fg)">' + totalBugs + '</span></div>' +
      '</div>' +
      '<div style="display:flex;gap:4px;margin-top:2px">' +
        '<button class="btn btn-xs" style="font-size:10px;color:var(--yellow);border-color:var(--yellow);padding:1px 5px" onclick="event.stopPropagation();window.open(\'' + (p.zentao_bugs_url || '#') + '\',\'_blank\')" title="禅道 Bug ' + zentaoBugs + '">禅道 ' + zentaoBugs + '</button>' +
        '<button class="btn btn-xs" style="font-size:10px;color:var(--accent);border-color:var(--accent);padding:1px 5px" onclick="event.stopPropagation()" title="PMA Bug ' + pmaBugs + '（待完成）">PMA ' + pmaBugs + '</button>' +
      '</div>' +
    '</div>' +
  '</div>';
  html += bugRingHtml;
  html += '</div>';


  html += '</div>'; // .card

  // Right column — product notes (independent card)
  html += '<div style="flex:1;min-width:0">';
  html += '<div class="card card-clip" style="padding:0;overflow:hidden" id="prod-notes-card">';
  html += '<div style="padding:8px 12px;background:var(--surface2);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">';
  html += '<span style="font-size:12px;font-weight:600">产品笔记</span>';
  html += '<button class="btn-xs" onclick="showAddProductNoteDialog()">+ 添加笔记</button>';
  html += '</div>';
  html += '<div style="max-height:400px;overflow-y:auto"><div id="prod-notes-list"><div class="loading-spinner" style="padding:20px">加载中...</div></div></div>';
  html += '</div></div>';

  html += '</div>'; // flex row

  // Creator info
  if (p.reporter_name) {
    html += '<div style="font-size:11px;color:var(--muted);margin:8px 0 4px">创建者: ' + escHtml(p.reporter_name) + '</div>';
  }

  // Product Spec Sheet — default to 产品规格书, dropdown to switch to 设计框图
  var blockDocs = docs || [];
  var blockOptions = ['产品规格书', '设计框图'];
  var findBlockDoc = function(name) {
    var found = null;
    blockDocs.forEach(function(d) {
      if (!found && d.doc_name && d.doc_name.indexOf(name) >= 0 && d.location) found = d;
    });
    return found;
  };
  var defaultDoc = findBlockDoc('产品规格书') || findBlockDoc('设计框图');
  var currentBlockName = defaultDoc ? (findBlockDoc('产品规格书') ? '产品规格书' : '设计框图') : null;

  html += '<div style="margin-top:20px;display:flex;align-items:center;justify-content:space-between">' +
    sectionHeader(currentBlockName || '产品规格书') +
    '<div style="display:flex;align-items:center;gap:6px">' +
    '<select id="block-doc-select" style="font-size:12px;padding:2px 8px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--fg);cursor:pointer" onchange="switchBlockDoc(this.value)">';
  blockOptions.forEach(function(opt) {
    html += '<option value="' + escHtml(opt) + '"' + (currentBlockName === opt ? ' selected' : '') + '>' + escHtml(opt) + '</option>';
  });
  html += '</select>' +
    '<button class="btn btn-sm" title="全屏查看" style="font-size:12px;padding:2px 6px" onclick="openBlockDocFullscreen()">⛶</button>' +
    '</div></div>';
  html += '<div class="card" style="padding:0;overflow:hidden" id="prod-block-card">';
  html += '<div id="prod-block-content"></div>';
  html += '</div>';

  document.getElementById('prodsec-info').innerHTML = html;

  // Render block doc inline
  var renderBlockDoc = function(docName) {
    var doc = findBlockDoc(docName);
    var el = document.getElementById('prod-block-content');
    if (!el) return;
    if (doc) {
      var token = localStorage.getItem('pma_token') || '';
      var fetchUrl = '/api/documents/fetch?url=' + encodeURIComponent(doc.location) + '&token=' + encodeURIComponent(token);
      el.innerHTML = '<iframe src="' + fetchUrl + '" style="width:100%;min-height:500px;border:none"></iframe>';
    } else {
      el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted)">未找到' + docName + '，请按要求提交</div>';
    }
  };
  renderBlockDoc(currentBlockName || '产品规格书');

  // Expose switch function globally for the onchange handler
  window.switchBlockDoc = function(docName) {
    // Update section header text
    var hdr = document.querySelector('#prodsec-info .section-hd .section-title');
    if (hdr) hdr.textContent = docName;
    renderBlockDoc(docName);
  };

  window.openBlockDocFullscreen = function() {
    var sel = document.getElementById('block-doc-select');
    var docName = sel ? sel.value : (currentBlockName || '产品规格书');
    var doc = findBlockDoc(docName);
    if (doc) openDocIframeFullscreen(doc.location, doc.doc_name || docName);
    else showToast('未找到"' + docName + '"的文档', 'info');
  };

  // Load notes
  API.get('/products/' + p.code + '/notes').then(function(notes) {
    renderProductNotes(notes || []);
  }).catch(function() {
    renderProductNotes([]);
  });
}

function renderProdDocs(p, preDocs) {
  var nodeIds = (p.linked_node_ids && p.linked_node_ids.length) ? p.linked_node_ids : [];
  var templateLink = '';
  if (nodeIds.length) {
    templateLink = '<a id="prod-docs-template-link" href="javascript:void(0)" onclick="gotoView(\'doc-templates\',{params:[\'product\',String(' + nodeIds[0] + ')]})" style="font-size:11px;color:var(--accent);text-decoration:none;margin-left:8px">查看文档模板详情 →</a>';
  }
  document.getElementById('prodsec-docs').innerHTML =
    '<div class="section-hd"><div class="section-title">产品文档</div>' + templateLink + '</div>' +
    '<div id="prod-docs-inline"><div class="loading-spinner" style="padding:20px">加载中...</div></div>';

  // Use pre-loaded docs if available, otherwise fetch
  var loadDocs = preDocs ? Promise.resolve(preDocs) : API.get('/products/' + p.code + '/documents');
  loadDocs.then(function(docs) {
    _renderProdDocsInline(docs || []);
    // Always re-scan on tab open: check file existence + refresh SVN metadata (rev changes etc.)
    _prodDocScanning = true;
    _renderProdDocsInline(docs || []);  // re-render to show "验证中"
    API.post('/products/' + p.code + '/docs/check', {}).then(function(result) {
      _prodDocScanning = false;
      if (result && (result.auto_submitted > 0 || result.scanned > 0)) {
        API.get('/products/' + p.code + '/documents').then(function(fresh) {
          _renderProdDocsInline(fresh || []);
        });
      }
    }).catch(function() { _prodDocScanning = false; });
  }).catch(function() {
    _renderProdDocsInline([]);
  });
}

function renderProductNotes(notes) {
  var el = document.getElementById('prod-notes-list');
  if (!el) return;
  if (!notes.length) { el.innerHTML = '<div class="empty-state" style="padding:20px">暂无笔记</div>'; return; }
  var currentUser = (getCurrentUser() || {}).username || '';
  el.innerHTML = '<div id="prod-notes-table"></div>';
  new DataTable({
    container: document.getElementById('prod-notes-table'),
    columns: [
      { key: 'created_at', title: '记录时间', width: '140px', render: function(v, row) { return '<span style="font-size:11px;font-family:var(--mono);color:var(--muted);white-space:nowrap">'+(fmtISODateTime(v)||'—')+'</span>'+(row.updated_at?'<div style="font-size:9px;color:var(--warn)">编辑过</div>':''); } },
      { key: 'category', title: '涉及领域', width: '90px', render: function(v) { return '<span style="font-size:12px">'+escHtml(v||'不涉及')+'</span>'; } },
      { key: 'recorded_by', title: '记录人', width: '70px', render: function(v) { return '<span style="font-size:12.5px;font-weight:540">'+escHtml(v||'')+'</span>'; } },
      { key: 'content', title: '内容', render: function(v, row) {
        var plainText = stripHtml(renderMarkdown?renderMarkdown(v):v).substring(0,80);
        return '<span style="font-size:13px;line-height:1.5">'+(row.parent_id?'<span style="font-size:10px;color:var(--accent);margin-right:4px">↳ 回复</span>':'')+escHtml(plainText)+(v&&v.length>80?'...':'')+(/!\[.*\]\(.*\)/.test(v)?' <span style="font-size:10px">📷</span>':'')+'</span>';
      }},
      { key: 'actions', title: '操作', width: '90px', render: function(v, row) {
        var isMine = row.recorded_by === currentUser;
        var a = '<span style="cursor:pointer;font-size:12px;color:var(--accent);margin-right:4px" onclick="openViewProdNoteDialog('+row.id+')" title="查看">👁</span>';
        a += isMine ? iconEdit('openEditProdNoteDialog('+row.id+')','编辑')+iconDelete('deleteProductNote('+row.id+')','删除') : '<span style="cursor:pointer;font-size:12px;color:var(--accent)" onclick="openReplyProdNoteDialog('+row.id+')" title="回复">💬</span>';
        return a;
      }}
    ],
    data: notes,
    resizable: false,
    rowClassFn: function(row) { return row.parent_id ? { paddingLeft: '28px', borderLeft: '3px solid var(--accent-lt)' } : null; }
  });
}

function openViewProdNoteDialog(noteId) {
  if (!_prodDetailCurCode) return;
  API.get('/products/' + _prodDetailCurCode + '/notes').then(function(result) {
    var notes = (result && result.length) ? result : [];
    var note = notes.find(function(n) { return n.id === noteId; });
    if (!note) { showToast('笔记不存在', 'error'); return; }
    var content = note.content.replace(/!\[\]\((\/api\/note-images\/[^) ]+)\s*=(\d+)x\)/g, '<img src="$1" style="width:$2px;max-width:100%">');
    var contentHtml = (typeof renderMarkdown === 'function') ? renderMarkdown(content) : '<pre>' + escHtml(content) + '</pre>';
    var dialog = document.createElement('div');
    dialog.className = 'note-dialog-overlay';
    dialog.innerHTML = '<div class="note-dialog" style="max-width:75vw;width:75vw">' +
      '<div class="note-dialog-head"><span class="note-dialog-title">查看笔记</span>' +
        '<button class="note-dialog-close" onclick="this.closest(\'.note-dialog-overlay\').remove()">&times;</button></div>' +
      '<div style="margin-bottom:8px;display:flex;gap:16px;font-size:11px;color:var(--muted)">' +
        '<span>领域: ' + escHtml(note.category || '不涉及') + '</span>' +
        '<span>作者: ' + escHtml(note.recorded_by || '') + '</span>' +
        '<span>时间: ' + escHtml(fmtISODateTime(note.created_at) || '—') + '</span>' +
      '</div>' +
      '<div style="max-height:70vh;overflow-y:auto;padding:12px;background:var(--bg);border-radius:8px;font-size:13px;line-height:1.7" class="markdown-body">' + contentHtml + '</div>' +
      '<div style="display:flex;justify-content:flex-end;margin-top:12px">' +
        '<button class="btn" onclick="this.closest(\'.note-dialog-overlay\').remove()">关闭</button>' +
      '</div></div>';
    document.body.appendChild(dialog);
  });
}

async function showAddProductNoteDialog() {
  _clearNoteImagePreviews('prod-note-content-img-preview');
  // Fetch note categories from product doc template stage_types
  var categoriesHtml = '<option value="">请选择领域...</option>';
  try {
    var cats = await API.get('/products/' + _prodDetailCurCode + '/note-categories');
    if (cats && cats.length) {
      cats.forEach(function(c) {
        categoriesHtml += '<option value="' + escHtml(c) + '">' + escHtml(c) + '</option>';
      });
    }
  } catch(e) { /* ignore */ }

  openDialog('添加产品笔记 — ' + escHtml((_prodDetail || {}).name || ''),
    '<div style="margin-bottom:10px">' +
      '<label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px">涉及领域</label>' +
      '<select id="prod-note-category" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--fg);font-size:13px;box-sizing:border-box">' + categoriesHtml + '</select>' +
    '</div>' +
    '<textarea id="prod-note-content" style="width:100%;min-height:60px;height:auto;max-height:30vh;box-sizing:border-box;padding:10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--fg);font-size:13px;resize:vertical;font-family:var(--font)" placeholder="记录产品关键信息..."></textarea>' +
    '<div style="font-size:10px;color:var(--muted);margin-top:2px">支持粘贴图片 (Ctrl+V)和大小调整</div>' +
    '<div id="prod-note-content-img-preview" style="margin-top:4px;min-height:0;max-height:50vh;overflow-y:auto"></div>' +
    '<div style="display:flex;justify-content:flex-end;align-items:center;gap:10px;margin-top:12px">' +
      '<span id="prod-note-msg" style="font-size:11px"></span>' +
      '<button class="btn" onclick="document.querySelector(\'.shared-dialog-overlay\').remove()" style="font-size:12px">取消</button>' +
      '<button class="btn btn-primary" onclick="addProductNote()" style="font-size:12px">保存</button>' +
    '</div>',
    null,
    {maxWidth: '80vw', maxHeight: '90vh', hideClose: true});
  setTimeout(function() { initNoteImagePaste('prod-note-content'); }, 100);
}

async function addProductNote() {
  var content = document.getElementById('prod-note-content').value.trim();
  var category = document.getElementById('prod-note-category').value;
  if (!content) { showToast('请输入笔记内容', 'error'); return; }
  if (!category) { showToast('请选择涉及领域', 'error'); return; }
  content = await _uploadNoteImages(content);
  closeSharedDialog();
  try {
    await API.post('/products/' + _prodDetailCurCode + '/notes', {content: content, category: category});
    showToast('已添加', 'ok');
    // Reload notes
    var notes = await API.get('/products/' + _prodDetailCurCode + '/notes');
    renderProductNotes(notes || []);
  } catch(e) {
    showToast('添加失败: ' + (e.message || ''), 'error');
  }
}

async function deleteProductNote(noteId) {
  if (!confirm('确认删除此笔记？（有回复的笔记不能删除）')) return;
  try {
    await API.del('/products/' + _prodDetailCurCode + '/notes/' + noteId);
    showToast('已删除', 'ok');
    var notes = await API.get('/products/' + _prodDetailCurCode + '/notes');
    renderProductNotes(notes || []);
  } catch(e) {
    showToast('删除失败: ' + (e.message || ''), 'error');
  }
}

function openEditProdNoteDialog(noteId) {
  if (!_prodDetailCurCode) return;
  _clearNoteImagePreviews('edit-prod-note-content-img-preview');
  API.get('/products/' + _prodDetailCurCode + '/notes').then(function(result) {
    var notes = (result && result.length) ? result : [];
    var note = notes.find(function(n) { return n.id === noteId; });
    if (!note) { showToast('笔记不存在', 'error'); return; }
    setTimeout(function() { _loadExistingNoteImages(note.content, 'edit-prod-note-content-img-preview'); }, 150);
    // Fetch categories
    var catsHtml = '<option value="">请选择领域...</option>';
    API.get('/products/' + _prodDetailCurCode + '/note-categories').then(function(cats) {
      if (cats && cats.length) {
        cats.forEach(function(c) {
          var sel = c === note.category ? ' selected' : '';
          catsHtml += '<option value="' + escHtml(c) + '"' + sel + '>' + escHtml(c) + '</option>';
        });
      }
      openDialog('编辑产品笔记',
        '<div style="margin-bottom:10px">' +
          '<label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px">涉及领域</label>' +
          '<select id="edit-prod-note-cat" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--fg);font-size:13px;box-sizing:border-box">' + catsHtml + '</select>' +
        '</div>' +
        '<textarea id="edit-prod-note-content" style="width:100%;min-height:60px;height:auto;max-height:30vh;box-sizing:border-box;padding:10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--fg);font-size:13px;resize:vertical;font-family:var(--font)">' + escHtml(note.content) + '</textarea>' +
        '<div style="font-size:10px;color:var(--muted);margin-top:2px">支持粘贴图片 (Ctrl+V)和大小调整</div>' +
        '<div id="edit-prod-note-content-img-preview" style="margin-top:4px;min-height:0;max-height:50vh;overflow-y:auto"></div>',
        [{text: '取消', onclick: 'closeSharedDialog()'},
         {text: '保存', cls: 'btn-primary', onclick: 'saveEditProdNote(' + noteId + ')'}],
        {maxWidth: '80vw', maxHeight: '90vh', hideClose: true});
    setTimeout(function() { initNoteImagePaste('edit-prod-note-content'); }, 100);
    });
  });
}

async function saveEditProdNote(noteId) {
  var content = document.getElementById('edit-prod-note-content').value.trim();
  var category = document.getElementById('edit-prod-note-cat').value;
  if (!content) { showToast('请输入内容', 'error'); return; }
  content = await _uploadNoteImages(content);
  closeSharedDialog();
  try {
    await API.put('/products/' + _prodDetailCurCode + '/notes/' + noteId, {content: content, category: category});
    showToast('已更新', 'success');
    var notes = await API.get('/products/' + _prodDetailCurCode + '/notes');
    renderProductNotes(notes || []);
  } catch(e) { showToast('编辑失败: ' + (e.message || ''), 'error'); }
}

function openReplyProdNoteDialog(parentId) {
  if (!_prodDetailCurCode) return;
  _clearNoteImagePreviews('reply-prod-note-content-img-preview');
  API.get('/products/' + _prodDetailCurCode + '/notes').then(function(result) {
    var notes = (result && result.length) ? result : [];
    var parent = notes.find(function(n) { return n.id === parentId; });
    if (!parent) { showToast('笔记不存在', 'error'); return; }
    var catLabel = parent.category || '不涉及';
    openDialog('回复笔记',
      '<div style="margin-bottom:8px;padding:8px 12px;background:var(--bg);border-radius:6px;font-size:11px;color:var(--muted)">' +
        '回复 <b>' + escHtml(parent.recorded_by) + '</b> 的笔记（' + escHtml(catLabel) + '）<br>' +
        '<span style="color:var(--fg)">' + escHtml(parent.content.substring(0, 80)) + (parent.content.length > 80 ? '...' : '') + '</span>' +
      '</div>' +
      '<textarea id="reply-prod-note-content" style="width:100%;min-height:60px;height:auto;max-height:30vh;box-sizing:border-box;padding:10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--fg);font-size:13px;resize:vertical;font-family:var(--font)" placeholder="输入回复..."></textarea>' +
      '<div style="font-size:10px;color:var(--muted);margin-top:2px">支持粘贴图片 (Ctrl+V)和大小调整</div>' +
      '<div id="reply-prod-note-content-img-preview" style="margin-top:4px;min-height:0;max-height:50vh;overflow-y:auto"></div>',
      [{text: '取消', onclick: 'closeSharedDialog()'},
       {text: '回复', cls: 'btn-primary', onclick: 'submitReplyProdNote(' + parentId + ',\'' + escHtml(catLabel).replace(/'/g, "\\'") + '\')'}],
      {maxWidth: '80vw', maxHeight: '90vh', hideClose: true});
    setTimeout(function() { initNoteImagePaste('reply-prod-note-content'); }, 100);
  });
}

async function submitReplyProdNote(parentId, category) {
  var content = document.getElementById('reply-prod-note-content').value.trim();
  if (!content) { showToast('请输入回复内容', 'error'); return; }
  content = await _uploadNoteImages(content);
  closeSharedDialog();
  try {
    await API.post('/products/' + _prodDetailCurCode + '/notes', {content: content, category: category, parent_id: parentId});
    showToast('已回复', 'success');
    var notes = await API.get('/products/' + _prodDetailCurCode + '/notes');
    renderProductNotes(notes || []);
  } catch(e) { showToast('回复失败: ' + (e.message || ''), 'error'); }
}

// ── Product Block Diagrams ──

function _hasProductLinkPerm() {
  var user = getCurrentUser();
  var perms = (user && user.permissions) ? user.permissions.split(',') : [];
  return perms.indexOf('product_link') !== -1;
}

function triggerBlockDiagramUpload() {
  document.getElementById('block-diagram-file-input').click();
}

async function uploadBlockDiagram(input) {
  var file = input.files[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    showToast('只支持图片文件', 'error');
    input.value = '';
    return;
  }

  var formData = new FormData();
  formData.append('file', file);

  var token = localStorage.getItem('pma_token');
  try {
    var res = await fetch('/api/products/' + _prodDetailCurCode + '/block-diagrams', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
      body: formData,
    });
    var json = await res.json();
    if (json.code === 0) {
      showToast('上传成功', 'ok');
      loadBlockDiagrams();
    } else {
      showToast('上传失败: ' + (json.message || json.detail || ''), 'error');
    }
  } catch (e) {
    showToast('上传失败: ' + (e.message || '网络错误'), 'error');
  }
  input.value = '';
}

async function loadBlockDiagrams() {
  try {
    var diagrams = await API.get('/products/' + _prodDetailCurCode + '/block-diagrams');
    renderBlockDiagrams(diagrams || []);
  } catch (e) {
    renderBlockDiagrams([]);
  }
}

function renderBlockDiagrams(diagrams) {
  var el = document.getElementById('prod-block-diagrams-list');
  if (!el) return;
  if (!diagrams.length) {
    el.innerHTML = '<div class="empty-state" style="padding:20px">暂无系统框图</div>';
    return;
  }
  var canEdit = _hasProductLinkPerm();
  el.innerHTML = '<div style="display:flex;flex-wrap:wrap;gap:12px;padding:12px">' +
    diagrams.map(function(d) {
      var imgUrl = '/api/products/block-diagrams/' + d.id + '/image';
      return '<div class="block-diagram-item" style="position:relative;width:200px;border:1px solid var(--border);border-radius:8px;overflow:hidden;background:var(--bg)">' +
        '<img src="' + imgUrl + '" alt="' + escHtml(d.filename) + '" ' +
          'onclick="showBlockDiagramLightboxById(' + d.id + ')" ' +
          'style="width:100%;height:150px;object-fit:cover;cursor:pointer;display:block" ' +
          'title="点击放大">' +
        '<div style="padding:6px 8px;font-size:10.5px;color:var(--muted);display:flex;justify-content:space-between;align-items:center">' +
          '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;margin-right:4px" title="' + escHtml(d.filename) + '">' + escHtml(d.filename) + '</span>' +
          (canEdit ? '<span style="cursor:pointer;color:var(--danger);flex-shrink:0;font-size:11px" onclick="deleteBlockDiagram(' + d.id + ')" title="删除">✕</span>' : '') +
        '</div>' +
        '<div style="padding:0 8px 6px;font-size:10px;color:var(--muted);display:flex;justify-content:space-between">' +
          '<span>' + escHtml(d.uploaded_by) + '</span>' +
          '<span>' + escHtml(d.created_at) + '</span>' +
        '</div>' +
      '</div>';
    }).join('') +
  '</div>';
}

function deleteBlockDiagram(bdId) {
  var user = getCurrentUser();
  if (!user) { showToast('请先登录', 'error'); return; }
  openDialog('删除框图确认',
    '<div style="margin-bottom:12px">' +
      '<div style="font-size:13px;color:var(--fg);margin-bottom:12px">确认删除此系统框图？此操作不可恢复。</div>' +
      '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">请输入 <b>' + escHtml(user.username) + '</b> 的登录密码确认：</label>' +
      '<input type="password" id="bd-del-password" class="search-inp" placeholder="登录密码" style="width:100%;box-sizing:border-box">' +
      '<div id="bd-del-err" style="font-size:11px;color:var(--danger);margin-top:6px;display:none"></div>' +
    '</div>',
    [
      {text: '取消', onclick: 'document.querySelector(\'.shared-dialog-overlay\').remove()'},
      {text: '确认删除', cls: 'btn-danger', onclick: 'confirmDeleteBlockDiagram(' + bdId + ')'},
    ],
    {hideClose: true});
}

async function confirmDeleteBlockDiagram(bdId) {
  var user = getCurrentUser();
  var pwInput = document.getElementById('bd-del-password');
  var errEl = document.getElementById('bd-del-err');
  var password = (pwInput && pwInput.value) || '';
  if (!password) {
    if (errEl) { errEl.textContent = '请输入密码'; errEl.style.display = 'block'; }
    return;
  }
  // Verify password
  try {
    var res = await API.post('/auth/login', { username: user.username, password: password });
    if (!res || !res.access_token) {
      if (errEl) { errEl.textContent = '密码验证失败'; errEl.style.display = 'block'; }
      return;
    }
  } catch (e) {
    if (errEl) { errEl.textContent = '密码错误，请重试'; errEl.style.display = 'block'; }
    return;
  }
  // Close dialog
  document.querySelector('.shared-dialog-overlay') && closeSharedDialog();
  // Proceed with deletion
  try {
    await API.del('/products/' + _prodDetailCurCode + '/block-diagrams/' + bdId);
    showToast('已删除', 'ok');
    loadBlockDiagrams();
  } catch (e) {
    showToast('删除失败: ' + (e.message || ''), 'error');
  }
}

function showBlockDiagramLightboxById(bdId) {
  showBlockDiagramLightbox('/api/products/block-diagrams/' + bdId + '/image');
}

function showBlockDiagramLightbox(imgUrl) {
  var overlay = document.createElement('div');
  overlay.className = 'block-diagram-lightbox-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:10000;display:flex;align-items:center;justify-content:center;cursor:pointer';
  overlay.onclick = function(e) {
    if (e.target === overlay) overlay.remove();
  };
  var img = document.createElement('img');
  img.src = imgUrl;
  img.style.cssText = 'max-width:92vw;max-height:92vh;object-fit:contain;border-radius:6px;box-shadow:0 8px 40px rgba(0,0,0,0.5)';
  var closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'position:absolute;top:16px;right:20px;background:none;border:none;color:#fff;font-size:28px;cursor:pointer;opacity:0.7;z-index:1';
  closeBtn.onclick = function() { overlay.remove(); };
  overlay.appendChild(closeBtn);
  overlay.appendChild(img);
  document.body.appendChild(overlay);
}

// ── Inline: 产品文档（在基本信息中展示） ──

function _scrollToDocStage(st) {
  var el = document.getElementById('doc-stage-' + st);
  if (!el) return;
  // Inject highlight style once
  if (!document.getElementById('doc-stage-hl-style')) {
    var style = document.createElement('style');
    style.id = 'doc-stage-hl-style';
    style.textContent = '.doc-stage-highlight{animation:doc-stage-pulse 0.6s ease-out 2;box-shadow:inset 0 0 0 3px var(--accent)}@keyframes doc-stage-pulse{0%,100%{box-shadow:inset 0 0 0 3px var(--accent)}50%{box-shadow:inset 0 0 0 6px var(--accent),0 0 16px rgba(37,99,235,0.3)}}';
    document.head.appendChild(style);
  }
  // Remove previous highlight
  document.querySelectorAll('.doc-stage-highlight').forEach(function(e) { e.classList.remove('doc-stage-highlight'); });
  el.classList.add('doc-stage-highlight');
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(function() { el.classList.remove('doc-stage-highlight'); }, 2000);
}

function _renderProdDocsInline(docs) {
  var el = document.getElementById('prod-docs-inline');
  if (!el) return;

  // Update template link
  var linkEl = document.getElementById('prod-docs-template-link');
  if (linkEl) {
    if (docs.length) {
      linkEl.textContent = '查看文档模板详情 →';
      linkEl.style.color = 'var(--accent)';
    } else {
      linkEl.textContent = '未找到匹配的文档模板';
      linkEl.style.color = 'var(--muted)';
      linkEl.style.cursor = 'default';
      linkEl.onclick = function() { return false; };
    }
  }

  if (!docs.length) {
    el.innerHTML = '<div class="card" style="padding:20px"><div class="empty-state">该产品暂未关联文档模板。请先在「文档模板配置」页面为对应产品系列添加文档模板。</div></div>';
    return;
  }

  var user = getCurrentUser();
  var perms = (user && user.permissions) ? user.permissions.split(',') : [];
  var canEdit = user && (user.role === 'admin' || perms.indexOf('admin') >= 0 || perms.indexOf('product_link') >= 0);

  // Group by stage_type
  var stageOrder = ['硬件开发', '结构设计', 'BSP开发', '软件开发', '测试', '通用'];
  var grouped = {};
  docs.forEach(function(d) {
    var st = d.stage_type || '通用';
    if (!grouped[st]) grouped[st] = [];
    grouped[st].push(d);
  });

  var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  var colorMap = {
    '硬件开发': 'var(--accent-lt)',
    '结构设计': isDark ? '#283528' : '#e8f5e9',
    'BSP开发': isDark ? '#353020' : '#fff3e0',
    '软件开发': isDark ? '#2a3340' : '#e3f2fd',
    '测试': isDark ? '#352830' : '#fce4ec',
    '通用': 'var(--surface)'
  };
  var typeLabels = { gitlab: 'GitLab', svn: 'SVN', nas: 'NAS', solidworks: '结构设计', pma: 'PMA' };
  var html = '<div class="card" style="padding:0;overflow:hidden"><div id="prod-docs-table"></div></div>';

  el.innerHTML = html;

  // Flatten into DataTable rows
  var flatRows = [];
  stageOrder.forEach(function(st) {
    var items = grouped[st];
    if (!items || !items.length) return;
    items.sort(function(a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });
    var bg = colorMap[st] || 'var(--surface)';
    items.forEach(function(d, i) {
      d._cat = st; d._bg = bg; d._seq = i + 1; d._catCount = items.length;
      d._docName = escHtml(d.doc_name);
      d._docType = typeLabels[d.doc_type] || '—';
      var hasError = (!d.done && d.location) || d.mismatch;
      if (d.done && !d.mismatch) d._statusHtml = '<span class="pill completed">已提交</span>';
      else if (_prodDocScanning) d._statusHtml = '<span class="pill" style="background:var(--warn-lt);color:var(--warn);animation:pulse 1s infinite">验证中</span>';
      else if (hasError) d._statusHtml = '<span class="pill" style="background:var(--danger-lt);color:var(--danger)">×错误</span>';
      else d._statusHtml = '<span class="pill blocked">未提交</span>';
      if (d.location) {
        if (d.mismatch) d._locHtml = '<span style="color:var(--danger)">' + escHtml((d.location||'').replace(/^请提交到：/,'')) + '</span><br><span style="font-size:10px;color:var(--danger)">' + escHtml(d.mismatch) + '</span>';
        else if (d.file_count && d.file_count > 0 && d.done) d._locHtml = '<span style="display:inline-block;background:var(--accent-lt);color:var(--accent);font-size:10px;padding:1px 6px;border-radius:10px;font-weight:500;white-space:nowrap;border:1px solid var(--accent);margin-right:4px">' + d.file_count + ' 文件</span><a href="' + escHtml(d.location) + '" target="_blank" style="color:var(--accent);text-decoration:none" onmouseover="this.style.textDecoration=\'underline\'" onmouseout="this.style.textDecoration=\'none\'">' + escHtml(d.location) + '</a>';
        else if (hasError) d._locHtml = '<span style="color:var(--danger)">' + escHtml((d.location||'').replace(/^请提交到：/,'')) + '</span><br><span style="font-size:10px;color:var(--danger)">文件不存在或无法访问</span>';
        else d._locHtml = '<a href="' + escHtml(d.location) + '" target="_blank" style="color:var(--accent);text-decoration:none" onmouseover="this.style.textDecoration=\'underline\'" onmouseout="this.style.textDecoration=\'none\'">' + escHtml(d.location) + '</a>';
      } else { d._locHtml = d.doc_path ? '<span style="color:var(--muted);font-style:italic">请提交到：' + escHtml(d.doc_path) + '</span>' : '—'; }
      if (d.doc_path && d.location && !d.done) d._locHtml += '<br><span style="font-size:10px;color:var(--muted)">模板: ' + escHtml(d.doc_path) + '</span>';
      d._updatedAt = fmtISODateTime(d.svn_last_modified) || '—';
      d._updatedBy = d.svn_author || '—';
      d._actions = (d.location ? (isPreviewableUrl(d.location) ? iconEye("previewDocument('" + encodeURIComponent(d.location) + "','" + escJs(d.doc_name||'') + "')") : '<a href="' + escHtml(d.location) + '" target="_blank" title="打开链接" style="text-decoration:none;font-size:15px">&#x1F517;</a>') : '') + (d.is_optional && canEdit ? iconDelete('removeOptionalProductDoc(' + d.id + ')', '移除此文档') : '');
      flatRows.push(d);
    });
  });

  new DataTable({
    container: document.getElementById('prod-docs-table'),
    columns: [
      { key: '_cat', title: '分类', width: '100px', rowspan: true, render: function(v, row, idx, count) { return '<span style="font-weight:600;color:var(--accent);font-size:12px">'+escHtml(v||'')+' <sup style="font-size:10px;color:var(--muted);font-weight:400">'+(count||(row._catCount||1))+'</sup></span>'; } },
      { key: '_seq', title: '序号', width: '50px', render: function(v) { return '<span style="font-family:var(--mono);color:var(--muted)">'+(v||'')+'</span>'; } },
      { key: '_docName', title: '文档名称', className: 'dt-wrap', render: function(v) { return '<span style="font-weight:500;word-break:break-all">'+(v||'')+'</span>'; } },
      { key: 'responsible_role', title: '责任人', width: '80px', render: function(v) { return '<span style="font-size:12px;white-space:nowrap">'+escHtml(v||'—')+'</span>'; } },
      { key: '_statusHtml', title: '状态', width: '80px', render: function(v) { return v||''; } },
      { key: '_docType', title: '类型', width: '50px', render: function(v) { return '<span style="font-size:11px">'+escHtml(v||'')+'</span>'; } },
      { key: '_locHtml', title: '路径', align: 'left', className: 'dt-wrap', render: function(v) { return '<span style="font-size:12px;word-break:break-all">'+(v||'')+'</span>'; } },
      { key: '_updatedAt', title: '最后修改时间', width: '100px', render: function(v) { return '<span style="font-size:11px;color:var(--muted);white-space:nowrap">'+escHtml(v||'—')+'</span>'; } },
      { key: '_updatedBy', title: '修改人', width: '80px', render: function(v) { return '<span style="font-size:12px;color:var(--muted)">'+escHtml(v||'')+'</span>'; } },
      { key: '_actions', title: '操作', width: '100px', render: function(v) { return v||''; } }
    ],
    data: flatRows,
    resizable: false,
    rowClassFn: function(row) { return row._bg ? { background: row._bg } : null; }
  });

  // Dynamic table height
  _resizeProdDocsTable();
}

async function removeOptionalProductDoc(docId) {
  if (!confirm('移除此可选项后，该文档将不再显示，也不计入完成统计。确认移除？')) return;
  try {
    await API.put('/products/' + _prodDetailCurCode + '/documents/' + docId, { is_removed: 1 });
    showToast('已移除可选项', 'success');
    // Re-fetch and re-render docs only (don't reload entire page)
    var docs = await API.get('/products/' + _prodDetailCurCode + '/documents');
    _renderProdDocsInline(docs);
  } catch(e) { showToast('移除失败: ' + (e.message || ''), 'error'); }
}

function _resizeProdDocsTable() {
  var tables = document.querySelectorAll('#prod-docs-table .dt-scroll, #proj-docs-table .dt-scroll');
  tables.forEach(function(wrap) {
    var top = wrap.getBoundingClientRect().top;
    wrap.style.maxHeight = Math.max(200, window.innerHeight - top - 24) + 'px';
  });
}
window.addEventListener('resize', _resizeProdDocsTable);

// _filterSearchableItems moved to utils.js

function switchToProdMaintenance() {
  var tab = document.querySelector('#view-product-detail .dtab[onclick*="maintenance"]');
  if (tab) switchProdTab('maintenance', tab);
}

// ── Tab: 产品维护（编辑、删除、项目关联、客户、标签） ──

function renderProdMaintenance(p) {
  var projects = p.projects || [];
  var canEdit = isAdminLike() || hasPerm('product_link');

  // Action buttons for edit/delete
  var html = '<div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap">';
  if (canEdit) {
    html += '<button class="btn btn-primary" style="font-size:11px;padding:5px 12px" onclick="showProdEditDialog()">✎ 编辑产品</button>';
    html += '<button class="btn" style="font-size:11px;padding:5px 12px;color:var(--danger);border-color:var(--danger)" onclick="deleteCurrentProduct()">✕ 删除产品</button>';
  }
  html += '</div>';

  // Associated projects table
  html += '<div class="card" style="padding:0;overflow:hidden;margin-bottom:16px">';
  if (canEdit) {
    html += '<div style="padding:12px 16px 0">' + sectionHeader('关联项目', projects.length, '+ 关联项目', 'showProdLinkProjectsDialog()') + '</div>';
  } else {
    html += '<div style="padding:12px 16px 0"><div class="section-hd"><div class="section-title">关联项目 (' + projects.length + ')</div></div></div>';
  }
  if (projects.length) {
    html += '<div id="prod-linked-proj-table"></div>';
  } else {
    html += '<div class="empty-state" style="padding:20px">暂无关联项目</div>';
  }
  html += '</div>';

  // Customer info
  var customers = p.customers_from_desc || [];
  html += '<div class="card" style="padding:16px;margin-bottom:16px">';
  if (canEdit) {
    html += sectionHeader('关联客户', customers.length, '+ 关联客户', 'showProdCustomersDialog()');
  } else {
    html += '<div class="section-hd"><div class="section-title">关联客户 (' + customers.length + ')</div></div>';
  }
  if (customers.length) {
    html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">';
    customers.forEach(function(c) {
      html += '<span class="tag-badge tag-1" style="font-size:12px;cursor:pointer" onclick="openCustomerByName(\'' + escHtml(c) + '\')">' + escHtml(c) + '</span>';
    });
    html += '</div>';
  } else {
    html += '<div style="font-size:12px;color:var(--muted);margin-top:8px">暂无关联客户</div>';
  }
  html += '</div>';

  // Tags
  var tagsList = p.tags_list || [];
  html += '<div class="card" style="padding:16px;margin-bottom:16px">';
  var activeTagCount = tagsList[0] && tagsList[0] !== '' ? tagsList.filter(function(t){return t!=='';}).length : 0;
  if (canEdit) {
    html += sectionHeader('产品标签', activeTagCount, '+ 管理标签', 'showProdTagsDialog()');
  } else {
    html += '<div class="section-hd"><div class="section-title">产品标签 (' + activeTagCount + ')</div></div>';
  }
  if (tagsList.length > 0 && tagsList[0] !== '') {
    html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">';
    tagsList.forEach(function(t) {
      if (!t) return;
      html += '<span class="tag-badge tag-' + (t.length % 5) + '">#' + escHtml(t) + '</span>';
    });
    html += '</div>';
  } else {
    html += '<div style="font-size:12px;color:var(--muted);margin-top:8px">暂无标签</div>';
  }
  html += '</div>';

  document.getElementById('prodsec-maintenance').innerHTML = html;

  if (projects.length) {
    new DataTable({
      container: document.getElementById('prod-linked-proj-table'),
      columns: [
        { key: 'code', title: '项目编号', render: function(v, row) { return v ? projCodeTag(v, 'event.stopPropagation();openProject(\''+escHtml(v).replace(/'/g,"\\'")+'\')', row.name) : '—'; } },
        { key: 'name', title: '项目名', render: function(v, row) { return '<div class="proj-name">'+escHtml(v||'')+'</div>'; } },
        { key: 'customer_name', title: '客户', render: function(v) { return v ? renderCustomerBadge(v) : '—'; } },
        { key: 'project_type', title: '类型', render: function(v) { return renderTypeBadge(v); } },
        { key: 'status', title: '状态', render: function(v) { return renderPill(v); } },
        { key: 'progress', title: '进度', render: function(v) { return renderProgressCircle(parseFloat(v)||0, 26, {label:''}); } },
        { key: 'end', title: '计划完成', render: function(v) { return '<span style="font-size:12px;color:'+(v?'var(--muted)':'var(--yellow)')+'">'+(v?formatDate(v):'长期')+'</span>'; } }
      ],
      data: projects,
      resizable: false,
      onRowClick: function(row) { openProject(row.code || String(row.id)); }
    });
  }
}

function hasPerm(perm) {
  var user = getCurrentUser();
  var perms = (user && user.permissions) ? user.permissions.split(',') : [];
  return perms.indexOf(perm) >= 0;
}

function isAdminLike() {
  var user = getCurrentUser();
  return user && (user.role === 'admin' || hasPerm('admin'));
}

function showProdEditDialog() {
  var p = _prodDetail;
  var currentTags = (p.tags || '').split(',').filter(function(t) { return t; });
  API.get('/tags').then(function(allTags) {
    var tagCheckboxes = allTags && allTags.length
      ? allTags.filter(function(t) { return !t.category || t.category === 'product'; }).map(function(t) {
          var checked = currentTags.indexOf(t.name) >= 0;
          return '<label class="searchable-item" data-search-text="' + escHtml(t.name).toLowerCase() + '" style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:12px;cursor:pointer">' +
            '<input type="checkbox" value="' + escHtml(t.name) + '"' + (checked ? ' checked' : '') + ' class="prod-edit-tag">' + escHtml(t.name) +
          '</label>';
        }).join('')
      : '<span style="font-size:12px;color:var(--muted)">暂无标签</span>';

    openDialog('编辑产品 — ' + escHtml(p.name),
      '<div style="margin-bottom:10px"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">产品名称</label>' +
        '<input class="search-inp" id="prod-edit-name" value="' + escHtml(p.name) + '" style="width:100%;box-sizing:border-box"></div>' +
      '<div style="margin-bottom:10px"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">产品编号</label>' +
        '<input class="search-inp" id="prod-edit-code" value="' + escHtml(p.code || '') + '" readonly style="width:100%;box-sizing:border-box;background:var(--border);cursor:not-allowed"></div>' +
      '<div style="margin-bottom:10px"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">状态</label>' +
        '<select class="search-inp" id="prod-edit-status" style="width:100%;box-sizing:border-box">' +
          '<option value="normal"' + (p.status === 'normal' ? ' selected' : '') + '>正常</option>' +
          '<option value="closed"' + (p.status === 'closed' ? ' selected' : '') + '>已关闭</option>' +
        '</select></div>' +
      '<div style="margin-bottom:4px"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">产品标签 <span style="font-weight:400">（多选）</span></label>' +
        '<input class="search-inp" placeholder="搜索标签..." oninput="_filterSearchableItems(this)" style="margin-bottom:4px">' +
        '<div style="max-height:140px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;padding:8px;background:var(--surface)" class="searchable-list">' + tagCheckboxes + '</div></div>',
      [{text: '取消', onclick: 'closeSharedDialog()'},
       {text: '保存', cls: 'btn-primary', onclick: 'saveProdEdit()'}],
      {hideClose: true});
  });
}

async function saveProdEdit() {
  var name = document.getElementById('prod-edit-name').value.trim();
  var code = document.getElementById('prod-edit-code').value.trim();
  var status = document.getElementById('prod-edit-status').value;
  if (!name) { showToast('请输入产品名称', 'error'); return; }

  var tags = [];
  document.querySelectorAll('.prod-edit-tag:checked').forEach(function(cb) { tags.push(cb.value); });

  closeSharedDialog();
  try {
    await API.put('/products/' + _prodDetailCurCode, { name: name, code: code, status: status, tags: tags.join(',') });
    showToast('产品已更新', 'success');
    loadProductDetail(_prodDetailCurCode);
  } catch(e) {
    showToast('更新失败: ' + (e.message || ''), 'error');
  }
}

function showProdLinkProjectsDialog() {
  API.get('/product-management/all-projects').then(function(projects) {
    var projIds = (_prodDetail.projects || []).map(function(p) { return p.id; });
    multiSelectDialog('关联项目 — ' + escHtml(_prodDetail.name), projects, projIds, {
      renderItem: function(proj) { return escHtml(proj.name) + ' <span style="font-size:10px;color:var(--muted)">' + escHtml(proj.code || '') + '</span>'; },
      placeholder: '搜索项目...'
    }, function(ids) {
      API.put('/product-management/products/' + _prodDetailCurCode + '/projects', { project_ids: ids }).then(function() {
        showToast('关联项目已更新', 'success');
        loadProductDetail(_prodDetailCurCode);
      }).catch(function(e) { showToast('更新失败: ' + (e.message || ''), 'error'); });
    });
  });
}

function showProdCustomersDialog() {
  API.get('/customers').then(function(custs) {
    var currentCusts = _prodDetail.customers_from_desc || [];
    multiSelectDialog('关联客户 — ' + escHtml(_prodDetail.name), custs, currentCusts, {
      idKey: 'name', labelKey: 'name', placeholder: '搜索客户...'
    }, function(names) {
      var nameStr = names.join('、');
      API.put('/products/' + _prodDetailCurCode, { pma_customer: nameStr }).then(function() {
        showToast('关联客户已更新', 'success');
        loadProductDetail(_prodDetailCurCode);
      }).catch(function(e) { showToast('更新失败: ' + (e.message || ''), 'error'); });
    });
  }).catch(function() { showToast('获取客户列表失败', 'error'); });
}

async function deleteCurrentProduct() {
  if (!confirm('确认删除产品「' + (_prodDetail.name || '') + '」？\n\n此操作不可撤销。')) return;
  var ok = await verifyPassword('删除产品: ' + (_prodDetail.name || ''), 'pw_verify_product_node_del');
  if (!ok) return;
  try {
    await API.del('/product-management/products/' + _prodDetailCurCode);
    showToast('产品已删除', 'success');
    gotoView('product-list');
  } catch(e) {
    showToast('删除失败: ' + (e.message || ''), 'error');
  }
}

function showProdTagsDialog() {
  API.get('/tags').then(function(allTags) {
    var tags = (allTags || []).filter(function(t) { return !t.category || t.category === 'product'; });
    var currentTags = (_prodDetail.tags || '').split(',').filter(function(t) { return t; });
    var listHtml = tags.map(function(t) {
      var checked = currentTags.indexOf(t.name) >= 0;
      return '<label class="searchable-item" data-search-text="' + escHtml(t.name).toLowerCase() + '" style="display:flex;align-items:center;gap:6px;padding:4px 0;font-size:13px;cursor:pointer">' +
        '<input type="checkbox" value="' + escHtml(t.name) + '"' + (checked ? ' checked' : '') + ' class="prod-tag-cb">' +
        escHtml(t.name) + '</label>';
    }).join('');
    openDialog('产品标签 — ' + escHtml(_prodDetail.name),
      '<input class="search-inp" placeholder="搜索标签..." oninput="_filterSearchableItems(this)" style="margin-bottom:6px">' +
      '<div style="max-height:280px;overflow-y:auto;margin-bottom:8px" class="searchable-list">' + listHtml + '</div>',
      [{text: '取消', onclick: 'closeSharedDialog()'},
       {text: '保存', cls: 'btn-primary', onclick: 'saveProdTags()'}],
      {hideClose: true});
  }).catch(function() { showToast('获取标签失败', 'error'); });
}

async function saveProdTags() {
  var tags = [];
  document.querySelectorAll('.prod-tag-cb:checked').forEach(function(cb) { tags.push(cb.value); });
  closeSharedDialog();
  try {
    await API.put('/products/' + _prodDetailCurCode, { tags: tags.join(',') });
    showToast('标签已更新', 'success');
    loadProductDetail(_prodDetailCurCode);
  } catch(e) {
    showToast('更新失败: ' + (e.message || ''), 'error');
  }
}

// ── Tab: 产品进度明细 ──

var _prodActivitySort = 'desc';
var _prodActivityFilterUser = '';
var _prodActivityFilterAction = '';
var _prodActivityOptions = null;

async function loadProdActivities() {
  var code = _prodDetailCurCode || (_prodDetail && _prodDetail.code) || '';
  var container = document.getElementById('prod-activities-content');
  if (!code) {
    if (container) container.innerHTML = '<div class="empty-state">请先选择产品</div>';
    return;
  }
  if (!container) return;
  container.innerHTML = '<div class="loading-spinner">加载活动记录...</div>';
  try {
    var params = 'sort=' + _prodActivitySort + '&limit=200';
    if (_prodActivityFilterUser) params += '&username=' + encodeURIComponent(_prodActivityFilterUser);
    if (_prodActivityFilterAction) params += '&action=' + encodeURIComponent(_prodActivityFilterAction);
    var resp = await API.get('/products/' + encodeURIComponent(code) + '/activities?' + params);
    var items = resp && resp.items ? resp.items : (Array.isArray(resp) ? resp : []);
    var opts = resp && resp.options ? resp.options : null;
    buildProdActivities(items, opts);
  } catch(e) {
    container.innerHTML = '<div class="error-state">加载失败: ' + escHtml(e.message || '') + '</div>';
  }
}

function buildProdActivities(items, opts) {
  var container = document.getElementById('prod-activities-content');
  if (!container) return;

  if (opts) _prodActivityOptions = opts;

  // Filter badge
  var filterBadge = '';
  if (_prodActivityFilterUser || _prodActivityFilterAction) {
    filterBadge = '<div style="margin-bottom:8px">' +
      '<span class="activity-filter-badge">' +
      '筛选: ' + [_prodActivityFilterUser, _prodActivityFilterAction].filter(Boolean).join(' + ') +
      ' <a href="javascript:void(0)" onclick="clearProdActivityFilters()" style="color:var(--danger);text-decoration:none;margin-left:4px">✕</a>' +
      '</span></div>';
  }

  // Sort indicator
  var sortIcon = '<span id="prod-act-sort-ind" style="color:var(--muted)">⇅</span>';

  // Filter dropdowns for header
  var userOpts = (_prodActivityOptions && _prodActivityOptions.usernames) ? _prodActivityOptions.usernames : [];
  var userFilter = '<select id="prod-act-filter-user" onchange="onProdActivityFilterUser(this.value)" class="activity-header-filter">' +
    '<option value="">全部</option>';
  userOpts.forEach(function(u) {
    userFilter += '<option value="' + escHtml(u) + '"' + (_prodActivityFilterUser === u ? ' selected' : '') + '>' + escHtml(u) + '</option>';
  });
  userFilter += '</select>';

  var actionOpts = (_prodActivityOptions && _prodActivityOptions.actions) ? _prodActivityOptions.actions : [];
  var actionFilter = '<select id="prod-act-filter-action" onchange="onProdActivityFilterAction(this.value)" class="activity-header-filter">' +
    '<option value="">全部</option>';
  actionOpts.forEach(function(a) {
    actionFilter += '<option value="' + escHtml(a) + '"' + (_prodActivityFilterAction === a ? ' selected' : '') + '>' + escHtml(a) + '</option>';
  });
  actionFilter += '</select>';

  if (!items || !items.length) {
    container.innerHTML = filterBadge + '<div class="empty-state" style="padding:20px">暂无活动记录</div>';
    return;
  }
  container.innerHTML = filterBadge + '<div id="prod-act-table"></div>';
  new DataTable({
    container: document.getElementById('prod-act-table'),
    columns: [
      { key: 'created_at', title: '时间 <span id="prod-act-sort-ind" style="cursor:pointer" onclick="toggleProdActivitySort()">' + sortIcon + '</span>', width: '160px', render: function(v) { return '<span class="act-td-time">'+escHtml(fmtISODateTime(v))+'</span>'; } },
      { key: 'display_name', title: '用户名 ' + userFilter, width: '100px', render: function(v, row) { return '<span class="act-td-user">'+escHtml(getDisplayName(v||row.username))+'</span>'; } },
      { key: 'action', title: '操作类型 ' + actionFilter, width: '120px', render: function(v) { return '<span class="activity-action pill">'+escHtml(v||'')+'</span>'; } },
      { key: 'detail', title: '具体明细', render: function(v) { return '<span class="act-td-detail">'+(v?escHtml(v):'')+'</span>'; } }
    ],
    data: items,
    maxHeight: 'calc(100vh - 330px)',
    resizable: false
  });
}

function updateProdActivitySortInd() {
  var si = document.getElementById('prod-act-sort-ind');
  if (!si) return;
  if (_prodActivitySort === 'asc') { si.textContent = '▲'; si.style.color = ''; }
  else if (_prodActivitySort === 'desc') { si.textContent = '▼'; si.style.color = ''; }
  else { si.textContent = '⇅'; si.style.color = 'var(--muted)'; }
}

function toggleProdActivitySort() {
  _prodActivitySort = _prodActivitySort === 'desc' ? 'asc' : 'desc';
  loadProdActivities();
}

function onProdActivityFilterUser(val) {
  _prodActivityFilterUser = val || '';
  loadProdActivities();
}

function onProdActivityFilterAction(val) {
  _prodActivityFilterAction = val || '';
  loadProdActivities();
}

function clearProdActivityFilters() {
  _prodActivityFilterUser = '';
  _prodActivityFilterAction = '';
  loadProdActivities();
}

/* ── Product Bugs Tab ── */

var _prodBugs = [];

function loadProductBugs() {
  var container = document.getElementById('prodsec-bugs');
  if (!container || !_prodDetailCurCode) return;
  container.innerHTML = '<div class="loading-spinner">加载Bug...</div>';
  API.get('/bugs?product_id=' + _prodDetailCurId + '&limit=200').then(function(bugs) {
    bugs = bugs || [];
    _prodBugs = bugs;
    _renderProdBugs(bugs, container);
  }).catch(function(e) {
    container.innerHTML = '<div class="empty-state" style="color:var(--danger);padding:20px">加载失败: ' + escHtml(e.message || '') + '</div>';
  });
}

function _renderProdBugs(bugs, container) {
  if (!bugs.length) { container.innerHTML = '<div class="card" style="padding:20px"><div class="empty-state">暂无Bug</div></div>'; return; }
  var sevLabels = {1:'致命',2:'严重',3:'一般',4:'建议'};
  var sevColors = {1:'var(--danger)',2:'var(--warn)',3:'var(--accent)',4:'var(--muted)'};
  container.innerHTML = '<div id="prod-bugs-table"></div>';
  new DataTable({
    container: document.getElementById('prod-bugs-table'),
    columns: [
      { key: 'id', title: '#', width: '6%', render: function(v) { return '<span style="font-size:11px;font-family:var(--mono);cursor:pointer" onclick="openBugDetail('+v+')">#'+v+'</span>'; } },
      { key: 'title', title: '标题', width: '24%', align: 'left', render: function(v, row) { return '<span style="font-weight:530;cursor:pointer" onclick="openBugDetail('+row.id+')" title="查看Bug详情">'+escHtml(v||'')+'</span>'; } },
      { key: 'status', title: '状态', width: '6%', render: function(v, row) { return '<span onclick="openBugDetail('+row.id+')">'+renderPill(v||'open')+'</span>'; } },
      { key: 'severity', title: '严重程度', width: '5%', render: function(v, row) { var c=sevColors[v]||'var(--muted)'; return '<span style="color:'+c+';font-weight:500;font-size:12px;cursor:pointer" onclick="openBugDetail('+row.id+')">'+(sevLabels[v]||v)+'</span>'; } },
      { key: 'priority', title: '优先级', width: '5%', render: function(v, row) { return '<span onclick="openBugDetail('+row.id+')"><span class="prio-tag '+(v||'medium')+'">'+({low:'低',medium:'中',high:'高',critical:'紧急'}[v]||v)+'</span></span>'; } },
      { key: 'assignee_name', title: '负责人', width: '8%', render: function(v, row) { return '<span style="font-size:12px;cursor:pointer" onclick="openBugDetail('+row.id+')">'+escHtml(v||'—')+'</span>'; } },
      { key: 'project_code', title: '项目编号', width: '8%', render: function(v, row) { return v?'<span class="proj-code-btn" onclick="event.stopPropagation();openProject(\''+escHtml(v)+'\')" title="'+escHtml(row.project_name||'')+'">'+escHtml(v)+'</span>':'<span style="font-size:12px;color:var(--muted)">—</span>'; } },
      { key: 'created_at', title: '创建时间', width: '10%', render: function(v, row) { return '<span style="font-size:11px;color:var(--muted);cursor:pointer" onclick="openBugDetail('+row.id+')">'+formatDate(v)+'</span>'; } },
      { key: 'actions', title: '操作', render: function(v, row) { return '<span style="white-space:nowrap" onclick="event.stopPropagation()">'+iconEdit('openBugDialog('+row.id+')','编辑Bug')+'</span>'; } }
    ],
    data: bugs,
    maxHeight: 'calc(100vh - 280px)',
    resizable: false
  });
}
