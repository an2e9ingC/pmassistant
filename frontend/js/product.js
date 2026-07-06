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
  renderProdOverview();
}

function _povSelectL2(l2Id) {
  _prodActiveL2 = l2Id;
  document.querySelectorAll('.pov-l2-chip').forEach(function(c) {
    c.classList.toggle('active', c.getAttribute('data-l2-id') === String(l2Id));
  });
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

  // Search
  if (_prodSearchVal) {
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
    return '<div class="pov-prod-card" style="position:relative" onclick="openProductDetail(\'' + p.id + '\')">' +
      '<span style="position:absolute;top:10px;right:10px;z-index:1">' + favStar('product', p.id, {stopPropagation:true, size:'20px'}) + '</span>' +
      '<div class="pov-prod-header"><div>' +
        '<div class="prod-code">' + escHtml(p.code || '#' + p.id) + '</div>' +
        '<div class="prod-name">' + escHtml(p.name) + '</div>' +
      '</div></div>' +
      (tagsHtml || '') +
      '<div class="prod-footer">' +
        '<span class="prod-src ' + (p.is_local ? 'local' : 'synced') + '">' + (p.is_local ? 'PMA 本地' : '禅道同步') + '</span>' +
        renderProgressCircle(p.doc_completion || 0, 36, { label: '资料', color: (p.doc_completion >= 100 ? 'var(--success)' : 'var(--danger)') }) +
      '</div>' +
    '</div>';
  }).join('');
}

function _toggleProdFav(id, btn) {
  var added = toggleFavProduct(id);
  btn.innerHTML = added ? '★' : '☆';
  btn.title = added ? '取消收藏' : '收藏';
  btn.style.color = added ? 'var(--warn)' : '';
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

function openProductDetail(id) {
  _prodDetailCurId = id;
  gotoView('product-detail');
}

/* ---- Product Detail ---- */

var _prodDetailCurId = null;
var _prodDocScanning = false;
var _prodDetailTargetTab = null;  // set before navigation to jump to a specific tab
var _prodComboAll = [];

async function initProductDetail() {
  try {
    var data = await API.get('/products?limit=200');
    _prodComboAll = data.items || [];
  } catch(e) { _prodComboAll = []; }
  initSearchCombo({
    comboId: 'prod-combo',
    inputId: 'prod-combo-input',
    dropdownId: 'prod-combo-dropdown',
    dataSource: _prodComboAll,
    selectedIdFn: function() { return _prodDetailCurId; },
    onSelect: function(p) { _prodDetailCurId = p.id; loadProductDetail(p.id); }
  });
  if (_prodDetailCurId) {
    loadProductDetail(_prodDetailCurId);
  }
}

var _prodDetail = null;

function switchProdTab(id, el) {
  document.querySelectorAll('#view-product-detail .dsec').forEach(function(s) { s.classList.remove('active'); });
  document.querySelectorAll('#view-product-detail .dtab').forEach(function(t) { t.classList.remove('active'); });
  var sec = document.getElementById('prodsec-' + id);
  if (sec) sec.classList.add('active');
  if (el) el.classList.add('active');
  if (id === 'maintenance' && _prodDetail) renderProdMaintenance(_prodDetail);
  if (id === 'activities') loadProdActivities();
}

async function loadProductDetail(id) {
  _prodDetailCurId = id;
  // Reset to 基本信息 tab on entry (unless a target tab is specified)
  var targetTab = _prodDetailTargetTab || 'info';
  _prodDetailTargetTab = null;
  var tabEl = document.querySelector('#view-product-detail .dtab[onclick*="switchProdTab(\'' + targetTab + '\'"]');
  if (tabEl) switchProdTab(targetTab, tabEl);

  var selected = _prodComboAll.find(function(p) { return p.id === parseInt(id); });
  if (selected) {
    document.getElementById('prod-combo-input').value = selected.name;
  }

  document.getElementById('prod-detail-header').innerHTML = '<div class="loading-spinner">加载中...</div>';
  ['prodsec-info', 'prodsec-docs', 'prodsec-maintenance'].forEach(function(s) {
    document.getElementById(s).innerHTML = '<div class="card" style="padding:20px"><div class="loading-spinner">加载中...</div></div>';
  });
  var actContainer = document.getElementById('prod-activities-content');
  if (actContainer) actContainer.innerHTML = '<div class="loading-spinner">加载活动记录...</div>';

  try {
    var detail = await API.get('/products/' + id);
    _prodDetail = detail;
    renderProdDetailHeader(detail);
    renderProdInfo(detail);
    renderProdDocs(detail);
  } catch(e) {
    document.getElementById('prod-detail-header').innerHTML = '<div class="error-state">加载失败: ' + escHtml(e.message) + '</div>';
  }
}

function renderProdDetailHeader(p) {
  document.getElementById('prod-detail-header').innerHTML =
    '<div class="detail-meta">' +
      '<div class="detail-title">' +
        '<span style="vertical-align:middle;margin-right:4px">' + favStar('product', p.id, {size:'22px'}) + '</span>' +
        escHtml(p.name) +
        (p.is_local
          ? ' <span class="pm-src-badge local" style="vertical-align:middle;margin-left:6px">PMA本地</span>'
          : (p.synced_at ? ' <span class="pm-src-badge synced" style="vertical-align:middle;margin-left:6px" title="同步于 ' + escHtml(p.synced_at) + '">禅道同步</span>' : '')) +
        (!p.is_local && p.zentao_url ? '<a href="' + p.zentao_url + '" target="_blank" class="zentao-link" style="margin-left:10px;font-size:12px" title="在禅道中查看">&#x2197; 禅道</a>' : '') +
      '</div>' +
      (p.code ? '<div class="detail-subtitle" style="font-family:var(--mono);font-size:12px;color:var(--muted)">' + escHtml(p.code) + '</div>' : '') +
    '</div>' +
    '<div style="flex-shrink:0;margin-left:auto">' + renderProgressCircle(p.doc_completion || 0, 56, { label: '资料完整度', color: (p.doc_completion >= 100 ? 'var(--success)' : 'var(--danger)') }) + '</div>';
}

// ── Tab: 基本信息 ──

function renderProdInfo(p) {
  var productType = p.tree_path || p.category || p.program_name || '未分类';

  var html = '<div class="card" style="padding:20px">';

  // Info row — 4 columns, consistent style
  html += '<div class="delivery-kpi" style="grid-template-columns:repeat(4, 1fr);margin-bottom:16px">' +
    '<div class="dkpi"><div class="dkpi-lbl">产品编号</div><div class="dkpi-val" style="font-family:var(--mono);font-size:16px;font-weight:600;color:var(--fg)">' + escHtml(p.code || '#' + p.id) + '</div></div>' +
    '<div class="dkpi" style="cursor:pointer" onclick="' +
      (p.linked_node_ids && p.linked_node_ids.length ? 'gotoView(\'product-management\');_pmSelectedNodeId=' + p.linked_node_ids[0] + ';setTimeout(function(){if(typeof initProductManagement==\'function\')initProductManagement();},100)' : '') +
      '" title="点击跳转到产品管理">' +
      '<div class="dkpi-lbl">所属分类</div><div class="dkpi-val" style="font-size:16px;font-weight:600;color:var(--accent)">' + escHtml(productType) + '</div></div>' +
    '<div class="dkpi"><div class="dkpi-lbl">状态</div><div class="dkpi-val" style="font-size:16px;font-weight:600;color:' + (p.status === 'normal' ? 'var(--success)' : p.status === 'closed' ? 'var(--muted)' : 'var(--warn)') + '">' + (p.status === 'normal' ? '正常' : p.status === 'closed' ? '已关闭' : (p.status || '—')) + '</div></div>' +
    '<div class="dkpi"><div class="dkpi-lbl">描述</div><div class="dkpi-val" style="font-size:12px;line-height:1.6">' + (p.tags_list && p.tags_list[0] ? p.tags_list.filter(function(t){return t;}).map(function(t){return '<span class="tag-badge tag-' + (t.length % 5) + '">#' + escHtml(t) + '</span>';}).join(' ') : '<span style="color:var(--muted)">—</span>') + '</div></div>' +
  '</div>';

  // Stats row — KPI numbers with status colors
  html += '<div class="delivery-kpi" style="grid-template-columns:repeat(4, 1fr)">';
  var stats = [
    { label: '关联项目', value: p.project_count || 0, color: 'var(--accent)', icon: '🔗', click: true, clickAction: 'switchToProdMaintenance()' },
    { label: '发布次数', value: p.releases || 0, color: 'var(--warn)', icon: '🚀' },
    { label: '需求总数', value: p.total_stories || 0, color: 'var(--success)', icon: '📋' },
    { label: 'Bug 总数', value: p.total_bugs || 0, color: 'var(--danger)', icon: '🐛' },
  ];
  stats.forEach(function(s) {
    html += '<div class="dkpi"' + (s.click ? ' style="cursor:pointer" onclick="' + (s.clickAction || ('gotoView(\'topology\');document.getElementById(\'topo-prod\').value=\'' + escHtml(p.code || p.name) + '\';setTimeout(function(){if(typeof onTopoSearch==\'function\')onTopoSearch()},100)')) + '" title="点击查看关联项目"' : '') + '>' +
      '<div class="dkpi-lbl">' + s.icon + ' ' + s.label + '</div>' +
      '<div class="dkpi-val" style="color:' + s.color + '">' + s.value + '</div></div>';
  });
  html += '</div>';


  html += '</div>';

  // Product Block Diagram / Spec — collapsible dropdown
  html += '<div style="margin-top:20px">' +
    '<div class="section-hd" style="cursor:pointer" onclick="(function(el){var card=document.getElementById(\'prod-spec-card\');var icon=el.querySelector(\'.toggle-icon\');if(card.style.display===\'none\'){card.style.display=\'\';icon.textContent=\'▼\'}else{card.style.display=\'none\';icon.textContent=\'▶\'}})(this)">' +
      '<div class="section-title">产品框图 <span class="toggle-icon" style="font-size:10px;margin-left:4px">▶</span></div>' +
    '</div></div>';
  html += '<div class="card" style="padding:0;overflow:hidden;display:none" id="prod-spec-card">';
  html += '<div id="prod-spec-content"><div class="loading-spinner" style="padding:20px">加载中...</div></div>';
  html += '</div>';

  // Product Notes
  html += '<div style="margin-top:20px">' + sectionHeader('产品笔记', null, '+ 添加笔记', 'showAddProductNoteDialog()') + '</div>';
  html += '<div class="card" style="padding:0;overflow:hidden" id="prod-notes-card">';
  html += '<div style="max-height:400px;overflow-y:auto"><div id="prod-notes-list"><div class="loading-spinner" style="padding:20px">加载中...</div></div></div>';
  html += '</div>';

  document.getElementById('prodsec-info').innerHTML = html;

  // Load product spec document for block diagram section
  API.get('/products/' + p.id + '/documents').then(function(docs) {
    var specDoc = null;
    (docs || []).forEach(function(d) {
      if (!specDoc && d.doc_name && d.doc_name.indexOf('产品规格书') >= 0 && d.location) specDoc = d;
    });
    var el = document.getElementById('prod-spec-content');
    if (el) {
      if (specDoc) {
        el.innerHTML = '<div style="padding:16px;text-align:center">' +
          '<div style="font-size:13px;margin-bottom:8px">' + escHtml(specDoc.doc_name) + '</div>' +
          '<button class="btn btn-primary" style="font-size:12px" onclick="previewDocument(\'' + encodeURIComponent(specDoc.location) + '\',\'' + escJs(specDoc.doc_name || '产品规格书') + '\')">预览产品规格书</button>' +
          '</div>';
      } else {
        el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted)">未找到产品规格书，请先在文档模板中配置</div>';
      }
    }
  }).catch(function() {
    var el = document.getElementById('prod-spec-content');
    if (el) el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted)">加载失败</div>';
  });

  // Load notes
  API.get('/products/' + p.id + '/notes').then(function(notes) {
    renderProductNotes(notes || []);
  }).catch(function() {
    renderProductNotes([]);
  });
}

function renderProdDocs(p) {
  var nodeIds = (p.linked_node_ids && p.linked_node_ids.length) ? p.linked_node_ids : [];
  var templateLink = '';
  if (nodeIds.length) {
    templateLink = '<a id="prod-docs-template-link" href="javascript:void(0)" onclick="gotoView(\'doc-templates\');_selectedNodeId=' + nodeIds[0] + ';setTimeout(function(){switchDocTemplateTab(\'product\',document.querySelector(\'#view-doc-templates .map-tab:nth-child(2)\'))},100)" style="font-size:11px;color:var(--accent);text-decoration:none;margin-left:8px">查看文档模板详情 →</a>';
  }
  document.getElementById('prodsec-docs').innerHTML =
    '<div class="section-hd"><div class="section-title">产品文档</div>' + templateLink + '</div>' +
    '<div id="prod-docs-inline"><div class="loading-spinner" style="padding:20px">加载中...</div></div>';

  API.get('/products/' + p.id + '/documents').then(function(docs) {
    _renderProdDocsInline(docs || []);
    // Always re-scan on tab open: check file existence + refresh SVN metadata (rev changes etc.)
    _prodDocScanning = true;
    _renderProdDocsInline(docs || []);  // re-render to show "验证中"
    API.post('/products/' + p.id + '/docs/check', {}).then(function(result) {
      _prodDocScanning = false;
      if (result && (result.auto_submitted > 0 || result.scanned > 0)) {
        API.get('/products/' + p.id + '/documents').then(function(fresh) {
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
  if (!notes.length) {
    el.innerHTML = '<div class="empty-state" style="padding:20px">暂无笔记</div>';
    return;
  }
  el.innerHTML = notes.map(function(n) {
    return '<div style="padding:12px 16px;border-bottom:1px solid var(--border)">' +
      '<div style="font-size:12.5px;line-height:1.6;white-space:pre-wrap">' + escHtml(n.content) + '</div>' +
      '<div style="display:flex;justify-content:space-between;margin-top:6px;font-size:10.5px;color:var(--muted)">' +
        '<span>' + escHtml(n.recorded_by) + '</span>' +
        '<span>' + escHtml(n.created_at) + '</span>' +
        '<span style="cursor:pointer;color:var(--danger)" onclick="deleteProductNote(' + n.id + ',this)">删除</span>' +
      '</div>' +
    '</div>';
  }).join('');
}

function showAddProductNoteDialog() {
  openDialog('添加产品笔记 — ' + escHtml((_prodDetail || {}).name || ''),
    '<div style="margin-bottom:12px">' +
      '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">笔记内容</label>' +
      '<textarea class="search-inp" id="prod-note-content" rows="4" placeholder="输入笔记..." style="width:100%;box-sizing:border-box;resize:vertical"></textarea>' +
    '</div>',
    [{text: '取消', onclick: 'document.querySelector(\'.shared-dialog-overlay\').remove()'},
     {text: '添加', cls: 'btn-primary', onclick: 'addProductNote()'}],
    {hideClose: true});
}

async function addProductNote() {
  var content = document.getElementById('prod-note-content').value.trim();
  if (!content) { showToast('请输入笔记内容', 'error'); return; }
  closeSharedDialog();
  try {
    await API.post('/products/' + _prodDetail.id + '/notes', {content: content});
    showToast('已添加', 'ok');
    // Reload notes
    var notes = await API.get('/products/' + _prodDetail.id + '/notes');
    renderProductNotes(notes || []);
  } catch(e) {
    showToast('添加失败: ' + (e.message || ''), 'error');
  }
}

async function deleteProductNote(noteId, el) {
  if (!confirm('确认删除此笔记？')) return;
  try {
    await API.del('/products/' + _prodDetail.id + '/notes/' + noteId);
    showToast('已删除', 'ok');
    var notes = await API.get('/products/' + _prodDetail.id + '/notes');
    renderProductNotes(notes || []);
  } catch(e) {
    showToast('删除失败: ' + (e.message || ''), 'error');
  }
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
    var res = await fetch('/api/products/' + _prodDetail.id + '/block-diagrams', {
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
    var diagrams = await API.get('/products/' + _prodDetail.id + '/block-diagrams');
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
    await API.del('/products/' + _prodDetail.id + '/block-diagrams/' + bdId);
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

  var colorMap = { '硬件开发': 'var(--accent-lt)', '结构设计': '#e8f5e9', 'BSP开发': '#fff3e0', '软件开发': '#e3f2fd', '测试': '#fce4ec', '通用': 'var(--surface)' };
  var typeLabels = { gitlab: 'GitLab', svn: 'SVN', nas: 'NAS', solidworks: '结构设计', pma: 'PMA' };
  var html = '<div class="card" style="padding:0;overflow:hidden">';
  html += '<div class="table-scroll" style="max-height:600px"><table class="stage-table"><thead><tr>' +
    '<th style="width:80px">分类</th><th style="width:50px">序号</th><th>文档名称</th><th>责任人</th><th style="width:90px">状态</th><th>类型</th><th>路径</th><th>最后修改时间</th><th>修改人</th><th>操作</th>' +
    '</tr></thead><tbody>';
  stageOrder.forEach(function(st) {
    var items = grouped[st];
    if (!items || !items.length) return;
    items.sort(function(a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });

    var bg = colorMap[st] || 'var(--surface)';
    var cellStyle = 'background:' + bg + ';';
    items.forEach(function(d, i) {
      var isLast = i === items.length - 1;
      html += '<tr>';
      if (i === 0) {
        html += '<td rowspan="' + items.length + '" style="vertical-align:middle;text-align:center;font-weight:600;' + cellStyle + 'color:var(--accent);font-size:12px">' + escHtml(st) + '<br><span style="font-size:10px;color:var(--muted)">' + items.length + ' 项</span></td>';
      }
      // Status pill — system auto-detects
      var hasError = (!d.done && d.location) || d.mismatch;
      var statusHtml;
      if (d.done && !d.mismatch) {
        statusHtml = '<span class="pill completed">已提交</span>';
      } else if (_prodDocScanning) {
        statusHtml = '<span class="pill" style="background:var(--warn-lt);color:var(--warn);animation:pulse 1s infinite">验证中</span>';
      } else if (hasError) {
        statusHtml = '<span class="pill" style="background:var(--danger-lt);color:var(--danger)">×错误</span>';
      } else {
        statusHtml = '<span class="pill blocked">未提交</span>';
      }

      html += '<td style="font-family:var(--mono);color:var(--muted);text-align:center;' + cellStyle + '">' + (d.sort_order != null ? d.sort_order : '—') + '</td>' +
        '<td style="font-weight:500;' + cellStyle + '">' + escHtml(d.doc_name) + '</td>' +
        '<td style="font-size:12px;white-space:nowrap;' + cellStyle + '">' + escHtml(d.responsible_role || '—') + '</td>' +
        '<td style="white-space:nowrap;' + cellStyle + '">' + statusHtml + '</td>' +
        '<td style="font-size:11px;' + cellStyle + '">' + escHtml(typeLabels[d.doc_type] || '—') + '</td>' +
        '<td style="font-size:12px;text-align:left;' + cellStyle + '">' + (d.mismatch
          ? '<span style="color:var(--danger)">' + escHtml((d.location||'').replace(/^请提交到：/,'')) + '</span><br><span style="font-size:10px;color:var(--danger)">' + escHtml(d.mismatch) + '</span>'
          : (d.location
            ? (hasError
              ? '<span style="color:var(--danger)">' + escHtml((d.location||'').replace(/^请提交到：/,'')) + '</span><br><span style="font-size:10px;color:var(--danger)">文件不存在或无法访问</span>'
              : '<a href="' + escHtml(d.location) + '" target="_blank" style="color:var(--accent);text-decoration:none" onmouseover="this.style.textDecoration=\'underline\'" onmouseout="this.style.textDecoration=\'none\'">' + escHtml(d.location) + '</a>')
            : (d.doc_path ? '<span style="color:var(--muted);font-style:italic">请提交到：' + escHtml(d.doc_path) + '</span>' : '—'))) +
          // Show template path only when not yet submitted (helps user verify match)
          (d.doc_path && d.location && !d.done ? '<br><span style="font-size:10px;color:var(--muted)">模板: ' + escHtml(d.doc_path) + '</span>' : '') +
        '</td>' +
        '<td style="font-size:11px;color:var(--muted);white-space:nowrap;' + cellStyle + '">' + escHtml(d.svn_last_modified || '—') + '</td>' +
        '<td style="font-size:12px;color:var(--muted);' + cellStyle + '">' + escHtml(d.svn_author || '—') + '</td>' +
        '<td style="white-space:nowrap;text-align:center;' + cellStyle + '">' +
          (d.location
            ? (isPreviewableUrl(d.location)
              ? iconEye("previewDocument('" + encodeURIComponent(d.location) + "','" + escJs(d.doc_name || '') + "')")
              : '<a href="' + escHtml(d.location) + '" target="_blank" title="打开链接" style="text-decoration:none;font-size:15px">&#x1F517;</a>')
            : '') +
        '</td>' +
      '</tr>';
    });
  });
  html += '</tbody></table></div></div>';

  el.innerHTML = html;
}

function _filterSearchableItems(input) {
  var q = (input.value || '').toLowerCase();
  var list = input.nextElementSibling;
  if (!list) return;
  list.querySelectorAll('.searchable-item').forEach(function(item) {
    item.style.display = q ? (item.getAttribute('data-search-text').indexOf(q) >= 0 ? '' : 'none') : '';
  });
}

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
    html += '<div class="table-scroll" style="max-height:400px"><table class="stage-table"><thead><tr>' +
      '<th>编号</th><th>项目名</th><th>客户</th><th>类型</th><th>状态</th><th>进度</th><th>计划完成</th>' +
      '</tr></thead><tbody>';
    projects.forEach(function(proj) {
      var projCode = extractProjectCode(proj.name);
      var coreName = extractCoreName(proj.name);
      html += '<tr onclick="openProject(\'' + proj.id + '\')" style="cursor:pointer">' +
        '<td>' + renderProjIcon(proj.project_type, projCode) + '</td>' +
        '<td><div class="proj-name">' + escHtml(coreName) + '</div></td>' +
        '<td>' + (proj.customer_name ? renderCustomerBadge(proj.customer_name) : '—') + '</td>' +
        '<td>' + renderTypeBadge(proj.project_type) + '</td>' +
        '<td>' + renderPill(proj.status) + '</td>' +
        '<td class="prog-cell">' + renderProgressCircle(parseFloat(proj.progress) || 0, 26, {label:''}) + '</td>' +
        '<td style="font-size:12px;color:' + (proj.end ? 'var(--muted)' : 'var(--warn)') + '">' + (proj.end ? formatDate(proj.end) : '长期') + '</td>' +
      '</tr>';
    });
    html += '</tbody></table></div>';
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
        '<input class="search-inp" id="prod-edit-code" value="' + escHtml(p.code || '') + '" style="width:100%;box-sizing:border-box"></div>' +
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
    await API.put('/products/' + _prodDetailCurId, { name: name, code: code, status: status, tags: tags.join(',') });
    showToast('产品已更新', 'success');
    loadProductDetail(_prodDetailCurId);
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
      API.put('/product-management/products/' + _prodDetailCurId + '/projects', { project_ids: ids }).then(function() {
        showToast('关联项目已更新', 'success');
        loadProductDetail(_prodDetailCurId);
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
      API.put('/products/' + _prodDetailCurId, { pma_customer: nameStr }).then(function() {
        showToast('关联客户已更新', 'success');
        loadProductDetail(_prodDetailCurId);
      }).catch(function(e) { showToast('更新失败: ' + (e.message || ''), 'error'); });
    });
  }).catch(function() { showToast('获取客户列表失败', 'error'); });
}

async function deleteCurrentProduct() {
  if (!confirm('确认删除产品「' + (_prodDetail.name || '') + '」？\n\n此操作不可撤销。')) return;
  var ok = await verifyPassword('删除产品: ' + (_prodDetail.name || ''), 'pw_verify_product_node_del');
  if (!ok) return;
  try {
    await API.del('/product-management/products/' + _prodDetailCurId);
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
    await API.put('/products/' + _prodDetailCurId, { tags: tags.join(',') });
    showToast('标签已更新', 'success');
    loadProductDetail(_prodDetailCurId);
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
  if (!_prodDetailCurId) return;
  var container = document.getElementById('prod-activities-content');
  if (!container) return;
  container.innerHTML = '<div class="loading-spinner">加载活动记录...</div>';
  try {
    var params = 'sort=' + _prodActivitySort + '&limit=200';
    if (_prodActivityFilterUser) params += '&username=' + encodeURIComponent(_prodActivityFilterUser);
    if (_prodActivityFilterAction) params += '&action=' + encodeURIComponent(_prodActivityFilterAction);
    var resp = await API.get('/products/' + _prodDetailCurId + '/activities?' + params);
    var items = resp && resp.items ? resp.items : (Array.isArray(resp) ? resp : []);
    var opts = resp && resp.options ? resp.options : null;
    buildProdActivities(items, opts);
  } catch(e) {
    container.innerHTML = '<div class="error-state">加载失败: ' + escHtml(e.message) + '</div>';
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

  var html = filterBadge;
  html += '<div class="table-scroll" style="max-height:calc(100vh - 330px)">';
  html += '<table class="stage-table activity-table">';
  html += '<thead><tr>' +
    '<th style="cursor:pointer;user-select:none;white-space:nowrap" onclick="toggleProdActivitySort()">时间 ' + sortIcon + '</th>' +
    '<th style="white-space:nowrap">用户名 ' + userFilter + '</th>' +
    '<th style="white-space:nowrap">操作类型 ' + actionFilter + '</th>' +
    '<th>具体明细</th>' +
    '</tr></thead><tbody>';

  items.forEach(function(a) {
    var time = (a.created_at || '').replace('T', ' ');
    html += '<tr>' +
      '<td class="act-td-time">' + escHtml(time) + '</td>' +
      '<td class="act-td-user">' + escHtml(a.username) + '</td>' +
      '<td style="white-space:nowrap"><span class="activity-action pill">' + escHtml(a.action) + '</span></td>' +
      '<td class="act-td-detail">' + (a.detail ? escHtml(a.detail) : '') + '</td>' +
      '</tr>';
  });

  html += '</tbody></table></div>';
  container.innerHTML = html;

  updateProdActivitySortInd();
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
