/* ═══════════════════════════════════════════════════
   PRODUCT LIST & PRODUCT DETAIL VIEWS
═══════════════════════════════════════════════════ */

/* ---- Product List (Overview) ── Card Layout ── */

var _prodCurCategory = '';
var _prodSearchVal = '';
var _prodSearchTimer = null;
var _allProducts = [];
var _prodTree = [];
var _prodExpandedL2 = {};  // { l2key: true }

async function initProductList() {
  _allProducts = [];
  try {
    var data = await API.get('/products?limit=200');
    _allProducts = data.items || [];
  } catch(e) {
    console.error('Failed to load products:', e);
  }
  try {
    _prodTree = (await API.get('/product-doc-templates/product-tree')) || [];
  } catch(e) { _prodTree = []; }

  renderProdOverview();
}

function renderProdOverview() {
  var total = _allProducts.length;
  var colors = ['var(--accent)', 'var(--success)', 'var(--warn)', 'var(--danger)'];
  var bgColors = ['var(--accent-lt)', 'var(--success-lt)', 'var(--warn-lt)', 'var(--danger-lt)'];
  var ci = 0;

  // Build L1 tab bar
  var tabBar = document.getElementById('pov-tab-bar');
  var tabHtml = '';
  _prodTree.forEach(function(l1, li) {
    var idx = li % colors.length;
    var c = colors[idx];
    var bg = bgColors[idx];
    var l1Total = 0;
    (l1.children || []).forEach(function(l2) {
      var key = l1.name + ' > ' + l2.name;
      l1Total += _allProducts.filter(function(p) { return (p.tree_path || '') === key; }).length;
    });
    tabHtml += '<span class="pov-l1-tab' + (li === 0 ? ' active' : '') + '" data-l1-idx="' + li + '" style="--tab-color:' + c + ';--tab-bg:' + bg + '" onclick="_povSwitchL1(' + li + ')">' +
      escHtml(l1.name) + ' <span class="pov-l1-tab-count">' + l1Total + '</span></span>';
  });
  tabBar.innerHTML = tabHtml;

  if (!_prodTree.length) {
    document.getElementById('pov-container').innerHTML = '<div class="pov-empty">暂无产品数据</div>';
    return;
  }

  // Render first L1 by default
  _povRenderL1(0);
}

function _povRenderL1(li) {
  var container = document.getElementById('pov-container');
  var l1 = _prodTree[li];
  if (!l1) return;

  var idx = li % 4;
  var c = ['var(--accent)', 'var(--success)', 'var(--warn)', 'var(--danger)'][idx];
  var bg = ['var(--accent-lt)', 'var(--success-lt)', 'var(--warn-lt)', 'var(--danger-lt)'][idx];

  var allL2 = l1.children || [];
  var l2sections = [];
  var l1Total = 0;

  allL2.forEach(function(l2) {
    var key = l1.name + ' > ' + l2.name;
    var l2products = _allProducts.filter(function(p) { return (p.tree_path || '') === key; });
    l1Total += l2products.length;
    l2sections.push({ id: l2.id, name: l2.name, products: l2products, color: c });
  });

  var html = '<div class="pov-card" style="--card-bg:' + bg + ';--card-color:' + c + '">' +
    '<div class="pov-card-body">';

  if (l2sections.length > 0) {
    html += '<div class="pov-tabs">';
    l2sections.forEach(function(l2s, ti) {
      html += '<span class="pov-tab' + (ti === 0 ? ' active' : '') + '" data-l2="' + l2s.id + '" onclick="_povSwitchTab(this,\'' + l1.id + '\',\'' + l2s.id + '\')">' +
        escHtml(l2s.name) + ' <span class="pov-tab-count">' + l2s.products.length + '</span></span>';
    });
    html += '</div>';

    l2sections.forEach(function(l2s, ti) {
      html += '<div class="pov-tab-panel' + (ti === 0 ? ' active' : '') + '" data-l2-panel="' + l2s.id + '">' +
        '<div class="pov-l3-list">';
      if (l2s.products.length) {
        l2s.products.forEach(function(p) {
          var statusLabel = p.status === 'normal' ? '量产' : (p.status === 'closed' ? 'EOL' : '—');
          var statusCls = p.status === 'normal' ? 'prod' : (p.status === 'closed' ? 'ext' : '');
          var tagsHtml = '';
          if (p.tags_list && p.tags_list[0]) {
            tagsHtml = '<div class="pov-l3-chips">' + p.tags_list.filter(function(t){return t;}).slice(0,3).map(function(t){return '<span class="tag-badge tag-' + (t.length % 5) + '">#' + escHtml(t) + '</span>';}).join('') + '</div>';
          }
          html += '<div class="pov-l3-chip" onclick="openProductDetail(\'' + p.id + '\')">' +
            '<div class="pov-l3-name">' + escHtml(p.code || '#' + p.id) + '</div>' +
            '<div class="pov-l3-desc">' + escHtml(p.name) + '</div>' +
            tagsHtml +
            '<div class="pov-l3-meta">' +
              '<span class="pov-l3-ver">' + (p.is_local ? 'PMA本地' : '') + '</span>' +
              (statusLabel !== '—' ? '<span class="pov-l3-status ' + statusCls + '">' + statusLabel + '</span>' : '') +
            '</div>' +
          '</div>';
        });
      } else {
        html += '<div style="font-size:12px;color:var(--muted);padding:8px">暂无产品</div>';
      }
      html += '</div></div>';
    });
  }

  html += '</div></div>';

  if (!_allProducts.length) {
    html = '<div class="pov-empty">暂无产品数据</div>';
  }

  container.innerHTML = html;
}

function _povSwitchL1(li) {
  document.querySelectorAll('#pov-tab-bar .pov-l1-tab').forEach(function(t, i) { t.classList.toggle('active', i === li); });
  _povRenderL1(li);
}

function _povSwitchTab(tab, l1Id, l2Id) {
  var card = tab.closest('.pov-card');
  card.querySelectorAll('.pov-tab').forEach(function(t) { t.classList.remove('active'); });
  tab.classList.add('active');
  card.querySelectorAll('.pov-tab-panel').forEach(function(p) { p.classList.remove('active'); });
  var panel = card.querySelector('[data-l2-panel="' + l2Id + '"]');
  if (panel) panel.classList.add('active');
}

function onProdSearch(v) {
  _prodSearchVal = v;
  clearTimeout(_prodSearchTimer);
  _prodSearchTimer = setTimeout(function() {
    if (_prodSearchVal) {
      var q = _prodSearchVal.toLowerCase();
      var foundLi = -1;
      _prodTree.forEach(function(l1, li) {
        if (foundLi >= 0) return;
        (l1.children || []).forEach(function(l2) {
          if (foundLi >= 0) return;
          var key = l1.name + ' > ' + l2.name;
          var match = _allProducts.some(function(p) {
            return (p.tree_path || '') === key &&
              ((p.name || '').toLowerCase().indexOf(q) >= 0 || (p.code || '').toLowerCase().indexOf(q) >= 0 || (p.tags || '').toLowerCase().indexOf(q) >= 0);
          });
          if (match) foundLi = li;
        });
      });
      if (foundLi >= 0) {
        _povSwitchL1(foundLi);
      }
      // Apply filter after render
      setTimeout(function() {
        var container = document.getElementById('pov-container');
        container.querySelectorAll('.pov-tab').forEach(function(tab) {
          var l2Id = tab.getAttribute('data-l2');
          var panel = container.querySelector('[data-l2-panel="' + l2Id + '"]');
          var l2Visible = false;
          if (panel) {
            panel.querySelectorAll('.pov-l3-chip').forEach(function(chip) {
              if (chip.textContent.toLowerCase().indexOf(q) >= 0) { chip.classList.remove('hidden'); l2Visible = true; }
              else { chip.classList.add('hidden'); }
            });
          }
          if (l2Visible) { tab.classList.remove('hidden'); tab.classList.add('active'); if (panel) panel.classList.add('active'); }
          else { tab.classList.add('hidden'); }
        });
      }, 100);
    } else {
      _povSwitchL1(0);
    }
  }, 200);
}

document.addEventListener('keydown', function(e) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    var activeView = document.querySelector('.view.active');
    if (activeView && activeView.id === 'view-product-list') {
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
var _prodDetailTargetTab = null;  // set before navigation to jump to a specific tab
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
  var combo = document.getElementById('prod-combo');
  var dd = document.getElementById('prod-combo-dropdown');
  dd.innerHTML = _prodComboAll.map(function(p) {
    return '<div class="combo-opt" onclick="selectProdCombo(\'' + p.id + '\', \'' + escHtml(p.name).replace(/'/g, "\\'") + '\')">' +
      '<span class="combo-opt-code">' + escHtml(p.code || '') + '</span>' +
      '<span class="combo-opt-name">' + escHtml(p.name) + '</span>' +
    '</div>';
  }).join('');
  combo.classList.add('open');
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
  document.getElementById('prod-combo').classList.remove('open');
  loadProductDetail(id);
}

// Close combo on outside click
document.addEventListener('click', function(e) {
  var combo = document.getElementById('prod-combo');
  if (combo && !combo.contains(e.target)) {
    combo.classList.remove('open');
  }
});

var _prodDetail = null;

function switchProdTab(id, el) {
  document.querySelectorAll('#view-product-detail .dsec').forEach(function(s) { s.classList.remove('active'); });
  document.querySelectorAll('#view-product-detail .dtab').forEach(function(t) { t.classList.remove('active'); });
  var sec = document.getElementById('prodsec-' + id);
  if (sec) sec.classList.add('active');
  if (el) el.classList.add('active');
  if (id === 'maintenance' && _prodDetail) renderProdMaintenance(_prodDetail);
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
        escHtml(p.name) +
        (p.is_local
          ? ' <span class="pm-src-badge local" style="vertical-align:middle;margin-left:6px">PMA本地</span>'
          : (p.synced_at ? ' <span class="pm-src-badge synced" style="vertical-align:middle;margin-left:6px" title="同步于 ' + escHtml(p.synced_at) + '">禅道同步</span>' : '')) +
        (!p.is_local && p.zentao_url ? '<a href="' + p.zentao_url + '" target="_blank" class="zentao-link" style="margin-left:10px;font-size:12px" title="在禅道中查看">&#x2197; 禅道</a>' : '') +
      '</div>' +
      (p.code ? '<div class="detail-subtitle" style="font-family:var(--mono);font-size:12px;color:var(--muted)">' + escHtml(p.code) + '</div>' : '') +
    '</div>';
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

  // Links
  if (p.nas_path || p.git_url) {
    html += '<div style="display:flex;gap:8px;margin-top:12px">' +
      (p.nas_path ? '<a href="' + escHtml(p.nas_path) + '" target="_blank" class="prod-link-chip">📁 NAS</a>' : '') +
      (p.git_url ? '<a href="' + escHtml(p.git_url) + '" target="_blank" class="prod-link-chip">🗃 Git</a>' : '') +
    '</div>';
  }

  html += '</div>';

  // Product Notes
  html += '<div class="section-hd" style="margin-top:20px"><div class="section-title">产品笔记</div>' +
    '<button class="btn" style="font-size:11px;padding:3px 10px" onclick="showAddProductNoteDialog()">+ 添加笔记</button></div>';
  html += '<div class="card" style="padding:0;overflow:hidden" id="prod-notes-card">';
  html += '<div style="max-height:400px;overflow-y:auto"><div id="prod-notes-list"><div class="loading-spinner" style="padding:20px">加载中...</div></div></div>';
  html += '</div>';

  // Product Block Diagrams
  var bdCanEdit = _hasProductLinkPerm();
  html += '<div class="section-hd" style="margin-top:20px"><div class="section-title">产品框图</div>' +
    (bdCanEdit ? '<button class="btn" style="font-size:11px;padding:3px 10px" onclick="triggerBlockDiagramUpload()">+ 上传框图</button>' +
    '<input type="file" id="block-diagram-file-input" accept="image/*" style="display:none" onchange="uploadBlockDiagram(this)">' : '') +
    '</div>';
  html += '<div class="card" style="padding:0;overflow:hidden" id="prod-block-diagrams-card">';
  html += '<div id="prod-block-diagrams-list"><div class="loading-spinner" style="padding:20px">加载中...</div></div>';
  html += '</div>';

  document.getElementById('prodsec-info').innerHTML = html;

  // Load notes
  API.get('/products/' + p.id + '/notes').then(function(notes) {
    renderProductNotes(notes || []);
  }).catch(function() {
    renderProductNotes([]);
  });

  // Load block diagrams
  loadBlockDiagrams();
}

function renderProdDocs(p) {
  var nodeIds = (p.linked_node_ids && p.linked_node_ids.length) ? p.linked_node_ids : [];
  var templateLink = '';
  if (nodeIds.length) {
    templateLink = '<a id="prod-docs-template-link" href="javascript:void(0)" onclick="gotoView(\'doc-templates\');_selectedNodeId=' + nodeIds[0] + ';setTimeout(function(){if(typeof initProductDocTemplates==\'function\'){initProductDocTemplates();}},200)" style="font-size:11px;color:var(--accent);text-decoration:none;margin-left:8px">查看文档模板详情 →</a>';
  }
  document.getElementById('prodsec-docs').innerHTML =
    '<div class="section-hd"><div class="section-title">产品文档</div>' + templateLink + '</div>' +
    '<div id="prod-docs-inline"><div class="loading-spinner" style="padding:20px">加载中...</div></div>';

  API.get('/products/' + p.id + '/documents').then(function(docs) {
    _renderProdDocsInline(docs || []);
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
  document.querySelector('.shared-dialog-overlay').remove();
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
  document.querySelector('.shared-dialog-overlay') && document.querySelector('.shared-dialog-overlay').remove();
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
  var typeLabels = { gitlab: 'GitLab', svn: 'SVN', nas: 'NAS', solidworks: 'SOLIDWORKS', pma: 'PMA' };
  var html = '<div class="card" style="padding:0;overflow:hidden">';
  html += '<div class="table-scroll" style="max-height:600px"><table class="stage-table"><thead><tr>' +
    '<th style="width:80px">分类</th><th style="width:50px">序号</th><th>文档名称</th><th>责任人</th><th style="width:90px">状态</th><th>类型</th><th>路径</th><th>上传人</th><th>上传时间</th><th>操作</th>' +
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
      // Status pill — only submitted is clickable (toggle to pending)
      var statusHtml = d.done
        ? '<span class="pill completed" style="cursor:' + (canEdit ? 'pointer' : 'default') + '" onclick="' + (canEdit ? 'toggleProdDocStatus(' + d.id + ',\'pending\')' : '') + '" title="点击标记为未提交">已提交</span>'
        : '<span class="pill blocked">未提交</span>';

      html += '<td style="font-family:var(--mono);color:var(--muted);text-align:center;' + cellStyle + '">' + (d.sort_order != null ? d.sort_order : '—') + '</td>' +
        '<td style="font-weight:500;' + cellStyle + '">' + escHtml(d.doc_name) + '</td>' +
        '<td style="font-size:12px;white-space:nowrap;' + cellStyle + '">' + escHtml(d.responsible_role || '—') + '</td>' +
        '<td style="white-space:nowrap;' + cellStyle + '">' + statusHtml + '</td>' +
        '<td style="font-size:11px;' + cellStyle + '">' + escHtml(typeLabels[d.doc_type] || '—') + '</td>' +
        '<td style="font-size:12px;' + cellStyle + '">' + (d.location
          ? '<a href="' + escHtml(d.location) + '" target="_blank" style="color:var(--accent);text-decoration:none" onmouseover="this.style.textDecoration=\'underline\'" onmouseout="this.style.textDecoration=\'none\'">' + escHtml(d.location) + '</a>'
          : (d.doc_path ? '<span style="color:var(--muted);font-style:italic">请提交到：' + escHtml(d.doc_path) + '</span>' : '—')) + '</td>' +
        '<td style="font-size:12px;color:var(--muted);' + cellStyle + '">' + escHtml(d.uploaded_by || '—') + '</td>' +
        '<td style="font-size:11px;color:var(--muted);white-space:nowrap;' + cellStyle + '">' + escHtml(d.uploaded_at || '—') + '</td>' +
        '<td style="white-space:nowrap;text-align:center;' + cellStyle + '">' +
          '<button class="btn" style="font-size:12px;padding:2px 6px" onclick="showToast(\'暂不支持\',\'info\')" title="预览">👁</button>' +
          '<button class="btn" style="font-size:12px;padding:2px 6px;margin-left:2px" onclick="showUploadDocDialog(' + d.id + ')" title="上传文档">📤</button>' +
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

async function toggleProdDocStatus(docId, newStatus) {
  try {
    await API.put('/products/' + _prodDetailCurId + '/documents/' + docId, { status: newStatus });
    var docs = await API.get('/products/' + _prodDetailCurId + '/documents');
    _renderProdDocsInline(docs || []);
  } catch(e) {
    showToast('操作失败: ' + (e.message || '未知错误'), 'error');
  }
}

function showUploadDocDialog(docId) {
  var doc = null;
  // Find doc data from the last rendered list
  var el = document.getElementById('prod-docs-inline');
  if (el) {
    // Re-fetch to get doc info
    API.get('/products/' + _prodDetailCurId + '/documents').then(function(docs) {
      var d = (docs || []).find(function(x) { return x.id === docId; });
      if (!d) { showToast('未找到文档信息', 'error'); return; }
      _openUploadDialog(d);
    });
  }
}

function _openUploadDialog(d) {
  var currentUser = getCurrentUser();
  var uploadBy = currentUser ? (currentUser.display_name || currentUser.username) : '';
  var defaultType = d.doc_type || 'gitlab';
  var placeholderMap = {
    svn: 'SVN 地址，如 http://192.168.0.124:8443/svn/...',
    gitlab: 'GitLab 发布链接，如 http://192.168.0.128/.../-/releases/...',
    nas: 'NAS 路径，如 \\\\192.168.0.x\\share\\...',
    solidworks: 'SOLIDWORKS 文件路径',
    pma: 'PMA 系统内部链接'
  };
  var typeLabels = { gitlab: 'GitLab', svn: 'SVN', nas: 'NAS', solidworks: 'SOLIDWORKS', pma: 'PMA 链接' };
  var makeTypeBtn = function(type, label) {
    var active = type === defaultType;
    return '<button class="btn upload-type-btn" style="font-size:11px;padding:4px 10px' +
      (active ? ';background:var(--accent);color:#fff' : '') +
      '" onclick="setUploadType(\'' + type + '\')">' + label + '</button>';
  };
  var html = '<div style="margin-bottom:10px">' +
    '<div style="font-size:11px;color:var(--muted);margin-bottom:8px">期望路径：' + escHtml(d.doc_path || '未配置') + '</div>' +
    '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:6px">文档类型</label>' +
    '<div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap" id="upload-type-btns">' +
      makeTypeBtn('gitlab', 'GitLab') +
      makeTypeBtn('svn', 'SVN') +
      makeTypeBtn('nas', 'NAS') +
      makeTypeBtn('solidworks', 'SOLIDWORKS') +
      makeTypeBtn('pma', 'PMA') +
    '</div>' +
    '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:6px">文档位置</label>' +
    '<input class="search-inp" id="upload-doc-location" value="' + escHtml(d.location || '') + '" placeholder="' + (placeholderMap[defaultType] || '') + '" style="width:100%;box-sizing:border-box;margin-bottom:10px">' +
    '<div style="font-size:11px;color:var(--muted);margin-bottom:4px">上传人：<span style="color:var(--fg);font-weight:500">' + escHtml(uploadBy) + '</span></div>' +
  '</div>';

  openDialog('上传文档 — <span style="color:var(--accent)">' + escHtml(d.doc_name) + '</span>', html,
    [{text: '取消', onclick: 'closeSharedDialog()'},
     {text: '提交', cls: 'btn-primary', onclick: 'submitUploadDoc(' + d.id + ')'}],
    {hideClose: true});
}

function setUploadType(type) {
  var input = document.getElementById('upload-doc-location');
  if (!input) return;
  if (type === 'svn') { input.value = ''; input.placeholder = 'SVN 地址，如 http://192.168.0.124:8443/svn/...'; }
  else if (type === 'gitlab') { input.value = ''; input.placeholder = 'GitLab 发布链接，如 http://192.168.0.128/.../-/releases/...'; }
  else if (type === 'nas') { input.value = ''; input.placeholder = 'NAS 路径，如 \\\\192.168.0.x\\share\\...'; }
  else if (type === 'solidworks') { input.value = ''; input.placeholder = 'SOLIDWORKS 文件路径'; }
  else if (type === 'pma') { input.value = ''; input.placeholder = 'PMA 系统内部链接'; }
  // Highlight selected
  document.querySelectorAll('#upload-type-btns .upload-type-btn').forEach(function(btn) {
    btn.style.background = ''; btn.style.color = '';
  });
  var selected = document.querySelector('#upload-type-btns .upload-type-btn[onclick*=\"' + type + '\"]');
  if (selected) { selected.style.background = 'var(--accent)'; selected.style.color = '#fff'; }
  input.focus();
}

async function submitUploadDoc(docId) {
  var location = document.getElementById('upload-doc-location').value.trim();
  if (!location) { showToast('请输入文档位置', 'error'); return; }

  var currentUser = getCurrentUser();
  var uploadBy = currentUser ? (currentUser.display_name || currentUser.username) : '';
  var now = new Date().toISOString().slice(0, 19);
  try {
    await API.put('/products/' + _prodDetailCurId + '/documents/' + docId, {
      status: 'submitted',
      location: location,
      uploaded_by: uploadBy,
      uploaded_at: now,
    });
    closeSharedDialog();
    var docs = await API.get('/products/' + _prodDetailCurId + '/documents');
    _renderProdDocsInline(docs || []);
    showToast('文档已提交', 'success');
  } catch(e) {
    showToast('提交失败: ' + (e.message || '未知错误'), 'error');
  }
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
  html += '<div class="section-hd" style="padding:12px 16px"><div class="section-title">关联项目 (' + projects.length + ')</div>' +
    (canEdit ? '<button class="btn btn-primary" style="font-size:11px;padding:4px 10px" onclick="showProdLinkProjectsDialog()">+ 关联项目</button>' : '') +
  '</div>';
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
        '<td>' + (proj.customer_name ? '<span onclick="event.stopPropagation();openCustomerByName(\'' + escHtml(proj.customer_name) + '\')" style="cursor:pointer">' + renderCustomerBadge(proj.customer_name) + '</span>' : '—') + '</td>' +
        '<td>' + renderTypeBadge(proj.project_type) + '</td>' +
        '<td>' + renderPill(proj.status) + '</td>' +
        '<td class="prog-cell">' + renderProgressBar(proj.progress, proj.status) + '</td>' +
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
  html += '<div class="section-hd"><div class="section-title">关联客户 (' + customers.length + ')</div>' +
    (canEdit ? '<button class="btn btn-primary" style="font-size:11px;padding:4px 10px" onclick="showProdCustomersDialog()">+ 关联客户</button>' : '') +
  '</div>';
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
  html += '<div class="section-hd"><div class="section-title">产品标签 (' + (tagsList[0] && tagsList[0] !== '' ? tagsList.filter(function(t){return t!=='';}).length : 0) + ')</div>' +
    (canEdit ? '<button class="btn btn-primary" style="font-size:11px;padding:4px 10px" onclick="showProdTagsDialog()">+ 管理标签</button>' : '') +
  '</div>';
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
    await API.put('/products/' + _prodDetailCurId, { name: name, code: code, status: status, description: tags.join(','), tags: tags.join(',') });
    showToast('产品已更新', 'success');
    loadProductDetail(_prodDetailCurId);
  } catch(e) {
    showToast('更新失败: ' + (e.message || ''), 'error');
  }
}

function showProdLinkProjectsDialog() {
  API.get('/product-management/all-projects').then(function(projects) {
    var projIds = (_prodDetail.projects || []).map(function(p) { return p.id; });
    var listHtml = projects.map(function(proj) {
      var checked = projIds.indexOf(proj.id) >= 0;
      return '<label class="searchable-item" data-search-text="' + escHtml((proj.name + ' ' + (proj.code || '')).toLowerCase()) + '" style="display:flex;align-items:center;gap:6px;padding:4px 0;font-size:13px;cursor:pointer">' +
        '<input type="checkbox" value="' + proj.id + '"' + (checked ? ' checked' : '') + ' class="prod-link-proj-cb">' +
        escHtml(proj.name) + ' <span style="font-size:10px;color:var(--muted)">' + escHtml(proj.code || '') + '</span>' +
      '</label>';
    }).join('');
    openDialog('关联项目 — ' + escHtml(_prodDetail.name),
      '<input class="search-inp" placeholder="搜索项目..." oninput="_filterSearchableItems(this)" style="margin-bottom:6px">' +
      '<div style="max-height:280px;overflow-y:auto;margin-bottom:8px" class="searchable-list">' + listHtml + '</div>',
      [{text: '取消', onclick: 'closeSharedDialog()'},
       {text: '保存', cls: 'btn-primary', onclick: 'saveProdLinkProjects()'}],
      {hideClose: true});
  });
}

async function saveProdLinkProjects() {
  var ids = [];
  document.querySelectorAll('.prod-link-proj-cb:checked').forEach(function(cb) { ids.push(parseInt(cb.value)); });
  closeSharedDialog();
  try {
    await API.put('/product-management/products/' + _prodDetailCurId + '/projects', { project_ids: ids });
    showToast('关联项目已更新', 'success');
    loadProductDetail(_prodDetailCurId);
  } catch(e) {
    showToast('更新失败: ' + (e.message || ''), 'error');
  }
}

function showProdCustomersDialog() {
  API.get('/customers').then(function(custs) {
    var currentCusts = _prodDetail.customers_from_desc || [];
    var listHtml = custs.map(function(c) {
      var checked = currentCusts.indexOf(c.name) >= 0;
      return '<label class="searchable-item" data-search-text="' + escHtml(c.name).toLowerCase() + '" style="display:flex;align-items:center;gap:6px;padding:4px 0;font-size:13px;cursor:pointer">' +
        '<input type="checkbox" value="' + escHtml(c.name) + '"' + (checked ? ' checked' : '') + ' class="prod-cust-cb">' + escHtml(c.name) +
      '</label>';
    }).join('');
    openDialog('关联客户 — ' + escHtml(_prodDetail.name),
      '<input class="search-inp" placeholder="搜索客户..." oninput="_filterSearchableItems(this)" style="margin-bottom:6px">' +
      '<div style="max-height:280px;overflow-y:auto;margin-bottom:8px" class="searchable-list">' + listHtml + '</div>',
      [{text: '取消', onclick: 'closeSharedDialog()'},
       {text: '保存', cls: 'btn-primary', onclick: 'saveProdCustomers()'}],
      {hideClose: true});
  }).catch(function() { showToast('获取客户列表失败', 'error'); });
}

async function saveProdCustomers() {
  var names = [];
  document.querySelectorAll('.prod-cust-cb:checked').forEach(function(cb) { names.push(cb.value); });
  closeSharedDialog();
  try {
    await API.put('/products/' + _prodDetailCurId, { pma_customer: names.join('、') });
    showToast('关联客户已更新', 'success');
    loadProductDetail(_prodDetailCurId);
  } catch(e) {
    showToast('更新失败: ' + (e.message || ''), 'error');
  }
}

async function deleteCurrentProduct() {
  if (!confirm('确认删除产品「' + (_prodDetail.name || '') + '」？\n\n此操作不可撤销。')) return;
  var ok = await verifyPassword('删除产品', 'pw_verify_product_node_del');
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
