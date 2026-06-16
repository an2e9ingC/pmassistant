/* ═══════════════════════════════════════════════════
   PRODUCT LIST & PRODUCT DETAIL VIEWS
═══════════════════════════════════════════════════ */

/* ---- Product List (Overview) ---- */

var _prodCurCategory = '';
var _prodCurStatus = '';  // '' = all, 'normal', 'closed'
var _prodCurSource = '';  // '' = all, 'zentao', 'local'
var _prodSearchVal = '';
var _prodSearchTimer = null;
var _allProducts = [];
var _prodLines = [];  // [{ name, count }]

async function initProductList() {
  _allProducts = [];
  _prodLines = [];
  try {
    var data = await API.get('/products?limit=200');
    _allProducts = data.items || [];
  } catch(e) {
    console.error('Failed to load products:', e);
  }
  // Build product line stats
  var cats = {};
  _allProducts.forEach(function(p) {
    var cat = p.category || p.program_name || '其他';
    if (!cats[cat]) cats[cat] = 0;
    cats[cat]++;
  });
  var catNames = Object.keys(cats).sort();
  _prodLines = catNames.map(function(c) { return { name: c, count: cats[c] }; });

  renderProdKpiCards();
  filterByProductLine('', null);
}

function renderProdKpiCards() {
  var grid = document.getElementById('prod-kpi-grid');
  var html = '<div class="kpi-card' + (_prodCurCategory === '' ? ' active' : '') + '" data-prod-cat="" onclick="filterByProductLine(\'\', this)">' +
    '<div class="kpi-label">全部产品</div>' +
    '<div class="kpi-value" id="prod-kpi-all">' + _allProducts.length + '</div>' +
    '<div class="kpi-meta">所有产品线</div>' +
  '</div>';
  _prodLines.forEach(function(pl, i) {
    var colors = ['accent', 'success', 'warn', 'danger'];
    var c = colors[i % colors.length];
    html += '<div class="kpi-card" data-prod-cat="' + escHtml(pl.name) + '" data-color="' + c + '" onclick="filterByProductLine(\'' + escHtml(pl.name).replace(/'/g, "\\'") + '\', this)"' +
      ' style="--cat-color: var(--' + c + ')">' +
      '<div class="kpi-label">' + escHtml(pl.name) + '</div>' +
      '<div class="kpi-value">' + pl.count + '</div>' +
      '<div class="kpi-meta">个产品</div>' +
    '</div>';
  });
  grid.innerHTML = html;
}

function filterByProductLine(cat, el) {
  _prodCurCategory = cat;
  document.querySelectorAll('#prod-kpi-grid .kpi-card').forEach(function(c) { c.classList.remove('active'); });
  if (el) el.classList.add('active');
  renderProductTable();
}

function filterByProdStatus(st, el) {
  _prodCurStatus = st;
  document.querySelectorAll('#prod-status-filter .tab').forEach(function(t) { t.classList.remove('active'); });
  if (el) el.classList.add('active');
  renderProductTable();
}

function filterByProdSource() {
  // Cycle: '' (all) → 'zentao' → 'local' → '' (all)
  if (_prodCurSource === '') { _prodCurSource = 'zentao'; }
  else if (_prodCurSource === 'zentao') { _prodCurSource = 'local'; }
  else { _prodCurSource = ''; }
  var indicator = document.getElementById('prod-src-indicator');
  var icon = document.getElementById('prod-src-filter-icon');
  if (indicator) {
    if (_prodCurSource === 'zentao') indicator.textContent = '禅道';
    else if (_prodCurSource === 'local') indicator.textContent = '本地';
    else indicator.textContent = '';
  }
  if (icon) {
    icon.style.opacity = _prodCurSource ? '0' : '0.4';
  }
  renderProductTable();
}

function onProdSearch(v) {
  _prodSearchVal = v;
  clearTimeout(_prodSearchTimer);
  _prodSearchTimer = setTimeout(function() {
    renderProductTable();
  }, 300);
}

function renderProductTable() {
  var filtered = _allProducts;
  if (_prodCurCategory) {
    filtered = filtered.filter(function(p) {
      return (p.category || p.program_name || '其他') === _prodCurCategory;
    });
  }
  if (_prodCurStatus) {
    filtered = filtered.filter(function(p) {
      return p.status === _prodCurStatus;
    });
  }
  if (_prodCurSource) {
    filtered = filtered.filter(function(p) {
      if (_prodCurSource === 'zentao') return !p.is_local && p.synced_at;
      if (_prodCurSource === 'local') return p.is_local;
      return true;
    });
  }
  if (_prodSearchVal) {
    var q = _prodSearchVal.toLowerCase();
    filtered = filtered.filter(function(p) {
      return (p.name || '').toLowerCase().indexOf(q) >= 0 ||
        (p.code || '').toLowerCase().indexOf(q) >= 0 ||
        stripHtml(p.description || '').toLowerCase().indexOf(q) >= 0 ||
        (p.tags || '').toLowerCase().indexOf(q) >= 0;
    });
  }

  var tbody = document.getElementById('prod-tbody');
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state" style="padding:20px">未找到匹配产品</div></td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(function(p) {
    var codeLabel = p.code || '#' + p.id;
    var tagsList = p.tags_list || [];
    var tagsHtml = '';
    if (tagsList.length > 0 && tagsList[0] !== '') {
      tagsHtml = tagsList.slice(0, 3).map(function(t) {
        return '<span class="tag-badge tag-' + (t.length % 5) + '">#' + escHtml(t) + '</span>';
      }).join(' ');
    } else {
      tagsHtml = '<span style="font-size:11.5px;color:var(--muted)">无</span>';
    }
    return '<tr onclick="openProductDetail(\'' + p.id + '\')" style="cursor:pointer">' +
      '<td><div class="proj-icon rd" style="font-size:11px">' + escHtml(codeLabel) + '</div></td>' +
      '<td><div class="proj-name">' + escHtml(p.name) + '</div></td>' +
      '<td style="font-size:12.5px">' + escHtml(p.category || p.program_name || '—') + '</td>' +
      '<td>' + renderPill(p.status) + '</td>' +
      '<td style="font-size:13px;font-weight:550">' + (p.project_count || 0) + '</td>' +
      '<td>' + tagsHtml + '</td>' +
      '<td>' + (p.is_local ? '<span class="pm-src-badge local">本地</span>' : (p.synced_at ? '<span class="pm-src-badge synced" title="同步于 ' + escHtml(p.synced_at) + '">禅道</span>' : '<span class="pm-src-badge unknown">—</span>')) + '</td>' +
    '</tr>';
  }).join('');
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
  var selected = _prodComboAll.find(function(p) { return p.id === parseInt(id); });
  if (selected) {
    document.getElementById('prod-combo-input').value = selected.name;
  }

  document.getElementById('prod-detail-header').innerHTML = '<div class="loading-spinner">加载中...</div>';
  ['prodsec-info', 'prodsec-maintenance'].forEach(function(s) {
    document.getElementById(s).innerHTML = '<div class="card" style="padding:20px"><div class="loading-spinner">加载中...</div></div>';
  });

  try {
    var detail = await API.get('/products/' + id);
    _prodDetail = detail;
    renderProdDetailHeader(detail);
    renderProdInfo(detail);
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
        (p.zentao_url ? '<a href="' + p.zentao_url + '" target="_blank" class="zentao-link" style="margin-left:10px;font-size:12px" title="在禅道中查看">&#x2197; 禅道</a>' : '') +
      '</div>' +
      (p.code ? '<div class="detail-subtitle" style="font-family:var(--mono);font-size:12px;color:var(--muted)">' + escHtml(p.code) + '</div>' : '') +
    '</div>';
}

// ── Tab: 基本信息 ──

function renderProdInfo(p) {
  // Get breadcrumb from product management tree
  var productType = p.category || p.program_name || '未分类';

  var html =
    '<div class="card" style="padding:20px">' +
      '<div style="display:flex;gap:24px;margin-bottom:16px">' +
        '<div style="min-width:100px"><span style="font-size:11px;color:var(--muted)">产品编号</span><div style="font-family:var(--mono);font-size:13px;margin-top:2px">' + escHtml(p.code || '#' + p.id) + '</div></div>' +
        '<div style="min-width:100px"><span style="font-size:11px;color:var(--muted)">所属分类</span><div style="font-size:13px;margin-top:2px">' + escHtml(productType) + '</div></div>' +
        '<div style="min-width:80px"><span style="font-size:11px;color:var(--muted)">状态</span><div style="margin-top:2px">' + renderPill(p.status) + '</div></div>' +
        '<div style="min-width:80px"><span style="font-size:11px;color:var(--muted)">发布次数</span><div style="font-size:18px;font-weight:600;color:var(--warn);margin-top:2px">' + (p.releases || 0) + '</div></div>' +
        '<div style="min-width:80px"><span style="font-size:11px;color:var(--muted)">关联项目</span><div style="font-size:18px;font-weight:600;color:var(--accent);margin-top:2px">' + (p.project_count || 0) + '</div></div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;margin-bottom:16px">' +
        (p.nas_path ? '<a href="' + escHtml(p.nas_path) + '" target="_blank" class="prod-link-chip">&#x1F4C1; NAS</a>' : '') +
        (p.git_url ? '<a href="' + escHtml(p.git_url) + '" target="_blank" class="prod-link-chip">&#x1F5C3; Git</a>' : '') +
      '</div>' +
    '</div>';

  // Product Documents
  html += '<div class="section-hd" style="margin-top:20px"><div class="section-title">产品文档</div></div>';
  html += '<div id="prod-docs-inline"><div class="loading-spinner" style="padding:20px">加载中...</div></div>';

  // Product Notes
  html += '<div class="section-hd" style="margin-top:20px"><div class="section-title">产品笔记</div>' +
    '<button class="btn" style="font-size:11px;padding:3px 10px" onclick="showAddProductNoteDialog()">+ 添加笔记</button></div>';
  html += '<div class="card" style="padding:0;overflow:hidden" id="prod-notes-card">';
  html += '<div style="max-height:400px;overflow-y:auto"><div id="prod-notes-list"><div class="loading-spinner" style="padding:20px">加载中...</div></div></div>';
  html += '</div>';

  document.getElementById('prodsec-info').innerHTML = html;

  // Load documents
  API.get('/products/' + p.id + '/documents').then(function(docs) {
    _renderProdDocsInline(docs || []);
  }).catch(function() {
    _renderProdDocsInline([]);
  });

  // Load notes
  API.get('/products/' + p.id + '/notes').then(function(notes) {
    renderProductNotes(notes || []);
  }).catch(function() {
    renderProductNotes([]);
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

// ── Inline: 产品文档（在基本信息中展示） ──

function _renderProdDocsInline(docs) {
  var el = document.getElementById('prod-docs-inline');
  if (!el) return;
  if (!docs.length) {
    el.innerHTML = '<div class="card" style="padding:20px"><div class="empty-state">该产品暂未关联文档模板。请先在「文档模板配置」页面为对应产品系列添加文档模板。</div></div>';
    return;
  }

  // Group by stage_type
  var stageOrder = ['硬件开发', '结构设计', 'BSP开发', '软件开发', '测试', '通用'];
  var grouped = {};
  docs.forEach(function(d) {
    var st = d.stage_type || '通用';
    if (!grouped[st]) grouped[st] = [];
    grouped[st].push(d);
  });

  var colorMap = { '硬件开发': 'var(--accent-lt)', '结构设计': '#e8f5e9', 'BSP开发': '#fff3e0', '软件开发': '#e3f2fd', '测试': '#fce4ec', '通用': 'var(--surface)' };
  var html = '<div class="card" style="padding:0;overflow:hidden">';
  html += '<div class="table-scroll" style="max-height:600px"><table class="stage-table"><thead><tr>' +
    '<th style="width:80px">分类</th><th style="width:50px">序号</th><th>文档名称</th><th>责任人</th><th>路径</th><th>上传人</th><th>上传时间</th><th>操作</th>' +
    '</tr></thead><tbody>';
  stageOrder.forEach(function(st) {
    var items = grouped[st];
    if (!items || !items.length) return;
    items.sort(function(a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });

    var bg = colorMap[st] || 'var(--surface)';
    var cellStyle = 'background:' + bg + ';';
    items.forEach(function(d, i) {
      var isLast = i === items.length - 1;
      var borderStyle = isLast ? '' : '';
      html += '<tr>';
      if (i === 0) {
        html += '<td rowspan="' + items.length + '" style="vertical-align:middle;text-align:center;font-weight:600;' + cellStyle + 'color:var(--accent);font-size:12px;' + borderStyle + '">' + escHtml(st) + '<br><span style="font-size:10px;color:var(--muted)">' + items.length + ' 项</span></td>';
      }
      html += '<td style="font-family:var(--mono);color:var(--muted);text-align:center;' + cellStyle + borderStyle + '">' + (d.sort_order != null ? d.sort_order : '—') + '</td>' +
        '<td style="font-weight:500;' + cellStyle + borderStyle + '">' + escHtml(d.doc_name) + '</td>' +
        '<td style="font-size:12px;white-space:nowrap;' + cellStyle + borderStyle + '">' + escHtml(d.responsible_role || '—') + '</td>' +
        '<td style="font-size:12px;' + cellStyle + borderStyle + '">' + (d.doc_path
          ? '<a href="' + escHtml(d.doc_path) + '" target="_blank" style="color:var(--accent);text-decoration:none" onmouseover="this.style.textDecoration=\'underline\'" onmouseout="this.style.textDecoration=\'none\'">' + escHtml(d.doc_path) + '</a>'
          : '—') + '</td>' +
        '<td style="font-size:12px;color:var(--muted);' + cellStyle + borderStyle + '">—</td>' +
        '<td style="font-size:11px;color:var(--muted);' + cellStyle + borderStyle + '">—</td>' +
        '<td style="white-space:nowrap;text-align:center;' + cellStyle + borderStyle + '"><span style="font-style:italic;color:var(--muted);font-size:11px">TODO：预览</span></td>' +
      '</tr>';
    });
  });
  html += '</tbody></table></div></div>';

  el.innerHTML = html;
}

// ── Tab: 产品维护（项目关联、客户、标签） ──

function renderProdMaintenance(p) {
  var projects = p.projects || [];
  var html = '';

  // Associated projects table
  html += '<div class="card" style="padding:0;overflow:hidden;margin-bottom:16px">';
  html += '<div class="section-hd" style="padding:12px 16px"><div class="section-title">关联项目 (' + projects.length + ')</div></div>';
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
  html += '<div class="section-hd"><div class="section-title">关联客户 (' + customers.length + ')</div></div>';
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
  html += '<div class="section-hd"><div class="section-title">产品标签 (' + (tagsList[0] ? tagsList.length : 0) + ')</div></div>';
  if (tagsList.length > 0 && tagsList[0] !== '') {
    html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">';
    tagsList.forEach(function(t) {
      html += '<span class="tag-badge tag-' + (t.length % 5) + '">#' + escHtml(t) + '</span>';
    });
    html += '</div>';
  } else {
    html += '<div style="font-size:12px;color:var(--muted);margin-top:8px">暂无标签</div>';
  }
  html += '</div>';

  document.getElementById('prodsec-maintenance').innerHTML = html;
}
