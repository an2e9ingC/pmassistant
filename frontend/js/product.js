/* ═══════════════════════════════════════════════════
   PRODUCT LIST & PRODUCT DETAIL VIEWS
═══════════════════════════════════════════════════ */

/* ---- Product List (Overview) ---- */

var _prodCurCategory = '';
var _prodCurStatus = '';  // '' = all, 'normal', 'closed'
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
    tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state" style="padding:20px">未找到匹配产品</div></td></tr>';
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

async function loadProductDetail(id) {
  _prodDetailCurId = id;
  // Update combo input
  var selected = _prodComboAll.find(function(p) { return p.id === parseInt(id); });
  if (selected) {
    document.getElementById('prod-combo-input').value = selected.name;
  }

  // Show loading
  document.getElementById('prod-detail-header').innerHTML = '<div class="loading-spinner">加载中...</div>';
  document.getElementById('prod-info-area').innerHTML = '<div class="loading-spinner">加载中...</div>';
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
    }).join(' ');
  }
  document.getElementById('prod-detail-header').innerHTML =
    '<div class="detail-meta">' +
      '<div class="detail-title">' +
        escHtml(p.name) +
        (p.zentao_url ? '<a href="' + p.zentao_url + '" target="_blank" class="zentao-link" style="margin-left:10px;font-size:12px" title="在禅道中查看">&#x2197; 禅道</a>' : '') +
      '</div>' +
      (p.code ? '<div class="detail-subtitle" style="font-family:var(--mono);font-size:12px;color:var(--muted)">' + escHtml(p.code) + '</div>' : '') +
      (tagsHtml ? '<div style="margin-top:6px">' + tagsHtml + '</div>' : '') +
      (p.description ? '<div style="margin-top:6px;font-size:13px;color:var(--muted);line-height:1.5">' + escHtml(stripHtml(p.description)) + '</div>' : '') +
    '</div>';
}

function renderProdDetailInfo(p) {
  var linksHtml = '';
  if (p.nas_path) {
    linksHtml += '<a href="' + escHtml(p.nas_path) + '" target="_blank" class="prod-link-chip" title="NAS 路径">&#x1F4C1; NAS</a>';
  }
  if (p.git_url) {
    linksHtml += '<a href="' + escHtml(p.git_url) + '" target="_blank" class="prod-link-chip" title="Git 仓库">&#x1F5C3; Git</a>';
  }
  var html =
    '<div class="section-hd"><div class="section-title">基本信息</div></div>' +
    '<div class="prod-stats">' +
      (p.zentao_url ? '<a href="' + p.zentao_url + '" target="_blank" class="prod-stat-link"><div class="prod-stat"><div class="prod-stat-val" style="color:var(--accent)">' + (p.total_stories || 0) + '</div><div class="prod-stat-lbl">需求数</div></div></a>' :
        '<div class="prod-stat"><div class="prod-stat-val" style="color:var(--accent)">' + (p.total_stories || 0) + '</div><div class="prod-stat-lbl">需求数</div></div>') +
      (p.zentao_bugs_url ? '<a href="' + p.zentao_bugs_url + '" target="_blank" class="prod-stat-link"><div class="prod-stat"><div class="prod-stat-val" style="color:' + (p.total_bugs > 0 ? 'var(--danger)' : 'var(--success)') + '">' + (p.total_bugs || 0) + '</div><div class="prod-stat-lbl">Bug 数</div></div></a>' :
        '<div class="prod-stat"><div class="prod-stat-val" style="color:' + (p.total_bugs > 0 ? 'var(--danger)' : 'var(--success)') + '">' + (p.total_bugs || 0) + '</div><div class="prod-stat-lbl">Bug 数</div></div>') +
      (p.zentao_releases_url ? '<a href="' + p.zentao_releases_url + '" target="_blank" class="prod-stat-link"><div class="prod-stat"><div class="prod-stat-val" style="color:var(--warn)">' + (p.releases || 0) + '</div><div class="prod-stat-lbl">发布次数</div></div></a>' :
        '<div class="prod-stat"><div class="prod-stat-val" style="color:var(--warn)">' + (p.releases || 0) + '</div><div class="prod-stat-lbl">发布次数</div></div>') +
      '<div class="prod-stat" onclick="document.querySelector(\'#prod-projects-tbody\').scrollIntoView({behavior:\'smooth\',block:\'center\'})" style="cursor:pointer"><div class="prod-stat-val">' + (p.project_count || 0) + '</div><div class="prod-stat-lbl">关联项目 &#x2193;</div></div>' +
    '</div>' +
    '<div class="prod-info-row">' +
      '<span class="prod-info-row-label">产品线</span>' +
      '<span class="tag-badge tag-0" style="font-size:12px;font-weight:520">' + escHtml(p.category || p.program_name || '未分类') + '</span>' +
      '<span class="prod-info-row-label" style="margin-left:8px">状态</span>' + renderPill(p.status) +
      (linksHtml ? '<span style="margin-left:auto">' + linksHtml + '</span>' : '') +
    '</div>';
  document.getElementById('prod-info-area').innerHTML = html;
}

function renderProdDetailProjects(p) {
  var projects = p.projects || [];
  var tbody = document.getElementById('prod-projects-tbody');
  if (!projects.length) {
    tbody.innerHTML = '<tr><td colspan="9"><div class="empty-state">暂无关联项目</div></td></tr>';
    return;
  }
  tbody.innerHTML = projects.map(function(proj) {
    var projCode = extractProjectCode(proj.name);
    var coreName = extractCoreName(proj.name);
    var tagsList = proj.tags_list || [];
    var tagsHtml = '';
    if (tagsList.length > 0 && tagsList[0] !== '') {
      tagsHtml = tagsList.slice(0, 3).map(function(t) {
        return '<span class="tag-badge tag-' + (t.length % 5) + '">#' + escHtml(t) + '</span>';
      }).join(' ');
    } else {
      tagsHtml = '<span style="font-size:11.5px;color:var(--muted)">无</span>';
    }
    return '<tr onclick="openProject(\'' + proj.id + '\')" style="cursor:pointer">' +
      '<td>' + renderProjIcon(proj.project_type, projCode) + '</td>' +
      '<td><div class="proj-name">' + escHtml(coreName) + '</div><div class="proj-code">' + escHtml(projCode) + '</div></td>' +
      '<td><span onclick="event.stopPropagation();openCustomerByName(\'' + escHtml(proj.customer_name || '') + '\')" style="cursor:pointer">' + renderCustomerBadge(proj.customer_name) + '</span></td>' +
      '<td>' + renderTypeBadge(proj.project_type) + '</td>' +
      '<td style="font-size:13px">' + escHtml(proj.status || '—') + '</td>' +
      '<td>' + renderPill(proj.status) + '</td>' +
      '<td class="prog-cell">' + renderProgressBar(proj.progress, proj.status) + '</td>' +
      '<td style="font-size:12px;color:' + (proj.end ? 'var(--muted)' : 'var(--warn)') + '">' + (proj.end ? formatDate(proj.end) : '长期') + '</td>' +
      '<td>' + tagsHtml + '</td>' +
    '</tr>';
  }).join('');
}

function renderProdDetailResources(p) {
  var card = document.getElementById('prod-resources-card');
  var html = '';

  // ── 交付资料（NAS + Git 仓库链接） ──
  html += '<div class="section-hd"><div class="section-title">交付资料</div></div>';
  html += '<ul style="list-style:none;padding:16px;margin:0">';
  var items = [];
  if (p.nas_path) {
    items.push('<li style="padding:6px 0;font-size:13px"><span style="color:var(--muted)">NAS路径: </span><code>' + escHtml(p.nas_path) + '</code></li>');
  }
  if (p.git_url) {
    items.push('<li style="padding:6px 0;font-size:13px"><span style="color:var(--muted)">Git仓库: </span><a href="' + escHtml(p.git_url) + '" target="_blank" style="color:var(--accent)"><code>' + escHtml(p.git_url) + '</code> &#x2197;</a></li>');
  }
  if (!items.length) {
    items.push('<li style="padding:6px 0;font-size:13px;color:var(--muted)">暂无交付资料信息</li>');
  }
  html += items.join('') + '</ul>';

  // ── 发布版本（含 GitLab 链接校验） ──
  var releases = p.releases_list || [];
  html += '<div class="section-hd" style="margin-top:16px"><div class="section-title">发布版本</div>';
  if (releases.length > 0) {
    html += '<span style="font-size:12px;color:var(--muted);margin-left:8px">共 ' + releases.length + ' 个</span>';
  }
  html += '</div>';

  if (releases.length > 0) {
    html += '<div class="table-scroll" style="max-height:300px">';
    html += '<table class="stage-table"><thead><tr>';
    html += '<th>版本</th><th>发布日期</th><th>状态</th><th>GitLab 链接</th><th>校验</th>';
    html += '</tr></thead><tbody>';

    releases.forEach(function(r) {
      var dateStr = r.date ? r.date : '—';
      var statusPill = r.status === 'normal' ? '<span class="pill active">正常</span>' :
                       r.status === 'terminated' ? '<span class="pill closed">已终止</span>' :
                       '<span class="pill">' + escHtml(r.status || '未知') + '</span>';

      // GitLab URL link
      var urlHtml = '—';
      if (r.gitlab_url) {
        urlHtml = '<a href="' + escHtml(r.gitlab_url) + '" target="_blank" style="color:var(--accent);font-size:12px" title="' + escHtml(r.gitlab_url) + '">' +
          (r.gitlab_url.length > 50 ? escHtml(r.gitlab_url.substring(0, 47)) + '...' : escHtml(r.gitlab_url)) +
        ' &#x2197;</a>';
      } else if (r.desc) {
        urlHtml = '<span style="font-size:12px;color:var(--muted)">未填写</span>';
      }

      // Validation status
      var validationHtml = '';
      if (!r.gitlab_url) {
        validationHtml = '<span style="font-size:12px;color:var(--muted)">—</span>';
      } else if (r.gitlab_url_valid === true) {
        validationHtml = '<span style="color:var(--success);font-weight:600" title="已校验: ' + (r.gitlab_url_checked_at || '') + '">&#x2713; 有效</span>';
      } else if (r.gitlab_url_valid === false) {
        validationHtml = '<span style="color:var(--danger);font-weight:600" title="已校验: ' + (r.gitlab_url_checked_at || '') + '">&#x2717; 无效</span>';
      } else {
        validationHtml = '<span style="color:var(--muted);font-size:12px" title="待同步后校验">待校验</span>';
      }

      // Row style: red-ish if invalid
      var rowStyle = r.gitlab_url_valid === false ? ' style="background:var(--danger-lt)"' : '';

      html += '<tr' + rowStyle + '>' +
        '<td><strong>' + escHtml(r.name) + '</strong></td>' +
        '<td style="font-size:12px">' + dateStr + '</td>' +
        '<td>' + statusPill + '</td>' +
        '<td>' + urlHtml + '</td>' +
        '<td>' + validationHtml + '</td>' +
      '</tr>';
    });
    html += '</tbody></table></div>';
  } else {
    html += '<div style="padding:16px;font-size:13px;color:var(--muted);font-style:italic">TODO: 同步禅道发布版本数据后将在此显示 GitLab 链接校验状态</div>';
  }

  card.innerHTML = html;
}
