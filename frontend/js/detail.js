/* ═══════════════════════════════════════════════════
   PROJECT DETAIL VIEW
═══════════════════════════════════════════════════ */

/* Combo Box — uses shared projectCombo component */

var _comboCurId = null;
var _comboCurCode = null;
var _projDetail = null;
var _projectProducts = [];
var _userNames = [];
var _userOptions = [];
var _userDisplayMap = {};
var _customerNames = [];
var _detailTargetTab = null;
var _deliveryData = null;
var _deliveryProgress = 0;

function setDetailTargetTab(tabId) { _detailTargetTab = tabId; }

initProjectCombo({
  comboId: 'proj-combo',
  inputId: 'combo-input',
  dropdownId: 'combo-dropdown',
  selectedIdFn: function() { return _comboCurId; },
  onSelect: function(p) {
    _comboCurId = p.id;
    _comboCurCode = p.code || String(p.id);
    document.getElementById('combo-input').value = _comboCurCode;
    loadProjectDetail(_comboCurCode);
    // Only replace state on fresh navigation, not back-navigation tab restore
    if (!_detailTargetTab) {
      history.replaceState({ view: 'detail', params: [_comboCurCode, 'info'] }, '', buildHash('detail', _comboCurCode, 'info'));
    }
  }
});

/* Project Detail Loading */

async function loadProjectDetail(code) {
  if (!code) return;
  await loadFavorites();

  // Show loading state
  document.getElementById('detail-header').innerHTML = '<div class="loading-spinner">加载项目详情...</div>';
  document.getElementById('info-content').innerHTML = '<div class="loading-spinner">加载基本信息...</div>';
  document.getElementById('gantt-root').innerHTML = '<div class="loading-spinner">加载甘特图...</div>';
  var stagesTbody = document.getElementById('stages-tbody');
  if (stagesTbody) stagesTbody.innerHTML = '<tr><td colspan="8"><div class="loading-spinner">加载阶段数据...</div></td></tr>';
  document.getElementById('docs-table-wrap').innerHTML = '<div class="loading-spinner">加载文档数据...</div>'; _docsDt = null;
  document.getElementById('delivery-content').innerHTML = '<div class="loading-spinner">加载交付数据...</div>';
  document.getElementById('resources-content').innerHTML = '<div class="loading-spinner">加载产品文档...</div>';

  try {
    // Fetch all data in parallel (use code for API calls)
    var results = await Promise.all([
      API.get('/projects/' + code),
      API.get('/projects/' + code + '/gantt'),
      API.get('/projects/' + code + '/stages'),
      API.get('/projects/' + code + '/documents'),
      API.get('/projects/' + code + '/delivery'),
      API.get('/projects/' + code + '/resources'),
      API.get('/projects/' + code + '/notes'),
      // Load user names + customer names for delivery form dropdown
      API.get('/users/names').catch(function() { return []; }),
      API.get('/users/customers/names').catch(function() { return []; }),
      API.get('/users/options').catch(function() { return []; }),
      // Task/Bug counts for the info card (non-blocking)
      API.get('/tasks/stats?project_id=' + encodeURIComponent(code)).catch(function() { return null; }),
      API.get('/bugs/stats?project_id=' + encodeURIComponent(code)).catch(function() { return null; }),
    ]);

    var detail = results[0];
    _projDetail = detail;
    // Update combo and use pushState for navigation from linked project clicks
    var prevCode = _comboCurCode;
    _comboCurCode = detail.code || String(detail.id);
    _comboCurId = detail.id;
    var comboInput = document.getElementById('combo-input');
    if (comboInput) comboInput.value = _comboCurCode;
    var isLinkNav = prevCode && prevCode !== String(code);
    var ganttData = results[1];
    var stages = results[2];
    var docs = results[3];
    var delivery = results[4];
    var resources = results[5];
    var notes = results[6];
    var userNames = results[7] || [];
    var customerNames = results[8] || [];
    var userOptions = results[9] || [];
    var taskStats = results[10] || null;
    var bugStats = results[11] || null;

    // Store linked products for delivery form dropdown
    _projectProducts = (detail && detail.products) ? detail.products : [];
    // Cache user/customer names for delivery form dropdown
    if (userNames.length) _userNames = userNames;
    if (customerNames.length) _customerNames = customerNames;
    // Build username -> display_name map for table rendering
    _userOptions = userOptions;
    _userDisplayMap = {};
    userOptions.forEach(function(u) {
      var uname = u.code || '';
      var dname = u.name || uname;
      _userDisplayMap[uname] = dname;
    });

    _deliveryData = delivery;
    _deliveryProgress = (delivery && delivery.progress) || 0;
    buildDetailHeader(detail);
    buildDelivery(delivery);
    buildInfo(detail, notes, delivery, docs, taskStats, bugStats);
    buildGantt(ganttData);
    buildStages(stages);
    buildDocs(docs);
    buildResources(resources, detail);
    buildMaintenance();

    // Pre-load task data so task detail tab is ready when user navigates to it
    if (typeof _taskProjectId === 'undefined' || _taskProjectId !== code) {
      _taskProjectId = code;
      _taskProjectName = detail.name || '';
      if (typeof loadTaskData === 'function') loadTaskData();
    }

    // Default to info tab when entering project detail, unless target tab is set
    var targetTab = _detailTargetTab || 'info';
    _detailTargetTab = null;
    switchDTab(targetTab);
    if (isLinkNav) {
      history.pushState({ view: 'detail', params: [_comboCurCode, targetTab] }, '', buildHash('detail', _comboCurCode, targetTab));
    } else {
      history.replaceState({ view: 'detail', params: [_comboCurCode, targetTab] }, '', buildHash('detail', _comboCurCode, targetTab));
    }
  } catch(e) {
    document.getElementById('detail-header').innerHTML = '<div class="error-state">加载失败: ' + escHtml(e.message) + '</div>';
  }
}

/* ── In-place refresh (EventBus-driven, preserves current tab/state) ── */

async function refreshProjectDetail() {
  var code = _comboCurCode;
  if (!code) return;
  try {
    var detail = await API.get('/projects/' + code);
    _projDetail = detail;
    _comboCurCode = detail.code || String(detail.id);
    _comboCurId = detail.id;
    var comboInput = document.getElementById('combo-input');
    if (comboInput) comboInput.value = _comboCurCode;
    var docs = []; var notes = [];
    try { docs = await API.get('/projects/' + code + '/documents') || []; } catch(e) {}
    try { notes = await API.get('/projects/' + code + '/notes') || []; } catch(e) {}
    buildDetailHeader(detail);
    buildInfo(detail, notes, _deliveryData, docs);
  } catch(e) {
    showToast('刷新失败: ' + (e.message || ''), 'error');
  }
}

async function refreshProjectNotes() {
  var code = _comboCurCode;
  if (!code) return;
  try {
    var notes = await API.get('/projects/' + code + '/notes');
    buildNotes(notes || []);
  } catch(e) {}
}

async function refreshProjectDelivery() {
  var code = _comboCurCode;
  if (!code) return;
  try {
    var data = await API.get('/projects/' + code + '/delivery');
    _deliveryData = data;
    _deliveryProgress = data.progress || 0;
    buildDelivery(data);
    if (_projDetail) buildDetailHeader(_projDetail);
  } catch(e) {}
}

async function refreshProjectStages() {
  var code = _comboCurCode;
  if (!code) return;
  try {
    var stages = await API.get('/projects/' + code + '/stages');
    buildStages(stages);
  } catch(e) {}
  loadMaintProjectStages();
  try {
    var ganttData = await API.get('/projects/' + code + '/gantt');
    buildGantt(ganttData);
  } catch(e) {}
  if (typeof loadTaskData === 'function') loadTaskData();
}

function refreshProjectMaintenance() {
  if (!_comboCurCode) return;
  loadMaintProjectStages();
  loadMaintProjectProducts();
  loadMaintProjectCustomers();
  loadMaintProjectTags();
}

/* Detail Header */

function buildDetailHeader(p) {
  if (!p) return;
  var progress = parseFloat(p.progress) || 0;

  var dateHtml = '';
  if (p.begin && p.end) {
    dateHtml = formatDate(p.begin) + ' → ' + formatDate(p.end);
  } else if (p.begin) {
    dateHtml = formatDate(p.begin) + ' 起（长期项目）';
  } else {
    dateHtml = '计划时间待定';
  }

  var projCode = p.code || '';
  var coreName = p.name || '';
  document.getElementById('detail-header').innerHTML =
    '<div class="detail-meta">' +
      '<div class="detail-title">' +
        '<span style="vertical-align:middle;margin-right:4px">' + favStar('project', p.id, {size:'22px'}) + '</span>' +
        projCodeTag(projCode, p.id, p.name) + ' ' +
        escHtml(coreName) +
      '</div>' +
      '<div class="detail-sub">' +
        '<span class="meta-item">' +
          '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><polyline points="8,4.5 8,8 10.5,10"/></svg>' +
          dateHtml +
        '</span>' +
        '<span class="meta-item">' +
          '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="12" height="10" rx="1.5"/><line x1="5" y1="8" x2="11" y2="8"/><line x1="5" y1="11" x2="9" y2="11"/></svg>' +
          (p.customer_name ? '<span onclick="openCustomerByName(\'' + escHtml(p.customer_name) + '\')" style="cursor:pointer">' + renderCustomerBadge(p.customer_name) + '</span>' : '<span style="color:var(--muted);font-size:12px">—</span>') +
        '</span>' +
        renderTypeBadge(p.project_type) +
        renderPill(p.status) +
        (p.is_local
          ? ' <span class="pm-src-badge local" style="vertical-align:middle">PMA本地</span>'
          : (p.zentao_url ? ' <a href="' + p.zentao_url + '" target="_blank" class="zentao-link" title="在禅道中查看">&#x2197; 禅道</a>' : '')) +
        (p.tracking_only ? ' ' + renderTrackingBadge() : '') +
      '</div>' +
    '</div>' +
    '<div style="display:flex;align-items:flex-start;gap:24px;flex-shrink:0">' +
      renderProgressCircle(progress, 56, { label: "整体进度" }) +
      renderProgressCircle(_deliveryProgress, 56, { label: "交付进度" }) +
    '</div>';
}

/* Info Tab — Basic Info */

function buildInfo(p, notes, delivery, docs, taskStats, bugStats) {
  if (!p) return;
  var del = delivery || {};

  // Task/Bug counts for the overview cards (n = incomplete/open, m = total)
  var taskTotal = (taskStats && taskStats.total) || 0;
  var taskDone = (((taskStats && taskStats.by_status) || {}).done || 0) + (((taskStats && taskStats.by_status) || {}).closed || 0);
  var taskIncomplete = Math.max(0, taskTotal - taskDone);
  var bugTotal = (bugStats && bugStats.total) || 0;
  var bugOpen = (bugStats && bugStats.open) || 0;

  // Status display mapping
  var statusMap = {
    active: { label: '进行中', color: 'var(--success)' },
    completed: { label: '已完成', color: 'var(--accent)' },
    blocked: { label: '已阻塞', color: 'var(--danger)' },
    pending: { label: '待启动', color: 'var(--warn)' },
    canceled: { label: '已取消', color: 'var(--muted)' },
    incomplete: { label: '未完成', color: 'var(--muted)' },
    abolished: { label: '已废止', color: 'var(--muted)' },
  };
  var st = statusMap[p.status] || { label: p.status || '—', color: 'var(--muted)' };

  // Flatten docs from API response for agreement lookup
  var projDocs = [];
  if (docs && docs.documents) {
    docs.documents.forEach(function(stage) {
      if (stage.documents) projDocs = projDocs.concat(stage.documents);
    });
  }
  var agreementOptions = ['对外销售-技术协议', '研发内部-技术协议'];
  var findAgreementDoc = function(name) {
    var found = null;
    projDocs.forEach(function(d) {
      if (!found && d.doc_name && d.doc_name.indexOf(name) >= 0 && d.location) found = d;
    });
    return found;
  };
  var defaultAgreement = findAgreementDoc('对外销售-技术协议') || findAgreementDoc('研发内部-技术协议');
  var currentAgreementName = defaultAgreement
    ? (findAgreementDoc('对外销售-技术协议') ? '对外销售-技术协议' : '研发内部-技术协议')
    : null;

  // 2-column layout: Left (info + notes + activity), Right (agreement doc, full height)
  var html = '<div style="display:flex;gap:20px">';

  // === LEFT COLUMN (50%) ===
  html += '<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:20px">';

  // --- info-glass-card ---
  html += '<div class="card info-glass-card" style="padding:20px">';

  // KPI row 1 — 4 columns
  html += '<div class="delivery-kpi" style="grid-template-columns:repeat(4, 1fr);margin-bottom:16px">' +
    '<div class="dkpi"><div class="dkpi-lbl">项目类型</div><div class="dkpi-val" style="font-size:16px;font-weight:600;color:' + (p.project_type === 'RD' ? 'var(--accent)' : p.project_type === 'SC' ? 'var(--success)' : '#8b5cf6') + '">' + escHtml(getProjectTypeLabel(p.project_type)) + '</div></div>' +
    '<div class="dkpi"><div class="dkpi-lbl">项目状态</div><div class="dkpi-val" style="font-size:16px;font-weight:600;color:' + st.color + '">' + st.label + '</div></div>' +
    '<div class="dkpi"><div class="dkpi-lbl">创建人</div><div class="dkpi-val" style="font-size:16px;font-weight:600">' + escHtml(p.reporter_name || '—') + '</div></div>' +
    '<div class="dkpi"><div class="dkpi-lbl">客户</div><div class="dkpi-val" style="font-size:16px;font-weight:600">' +
      (p.customer_name ? '<span style="cursor:pointer" onclick="openCustomerByName(\'' + escHtml(p.customer_name) + '\')" title="查看客户详情">' + renderCustomerBadge(p.customer_name) + '</span>' : '<span style="color:var(--muted)">—</span>') +
    '</div></div>' +
  '</div>';

  var allLinked = p.linked_projects || [];
  var linkedOpportunities = allLinked.filter(function(lp) { return lp.code && /^LSJ/i.test(lp.code); });
  var linkedPeers = allLinked.filter(function(lp) { return !lp.code || !/^LSJ/i.test(lp.code); });
  var isOpportunity = p.project_type && p.project_type !== 'RD' && p.project_type !== 'SC';

  // KPI row 2 — key timeline + delivery + linked opportunities + linked projects
  html += '<div class="delivery-kpi" style="grid-template-columns:repeat(4, 1fr);margin-bottom:16px">' +
    '<div class="dkpi"><div class="dkpi-lbl">计划结束</div><div class="dkpi-val" style="font-size:16px;font-weight:600">' + (p.end ? formatDate(p.end) : '<span style="color:var(--muted)">—</span>') + '</div></div>' +
    '<div class="dkpi"><div class="dkpi-lbl">交付数量</div><div class="dkpi-val" style="font-size:16px;font-weight:600">' +
      '<span style="color:var(--success)">' + (del.done || 0) + '</span>' +
      '<span style="color:var(--muted);font-weight:400"> / ' + (del.planned || 0) + '</span>' +
    '</div></div>' +
    '<div class="dkpi"><div class="dkpi-lbl">关联商机（' + linkedOpportunities.length + '）' +
      (_hasProjectEditPerm() ? '<a href="javascript:void(0)" onclick="event.stopPropagation();editLinkedProjects()" title="编辑关联商机" style="text-decoration:none;font-size:14px">&#x1F517;</a>' : '') +
    '</div><div class="dkpi-val" style="font-size:12px;line-height:1.6">' +
    (linkedOpportunities.length
      ? '<div style="display:flex;flex-wrap:wrap;gap:4px">' + linkedOpportunities.map(function(lp) { return '<span class="proj-code-btn" onclick="loadProjectDetail(' + lp.id + ')" title="' + escHtml(lp.name || '') + '">' + escHtml(lp.code || lp.name) + '</span>'; }).join('') + '</div>'
      : '<span style="color:var(--muted)">—</span>') +
    '</div></div>' +
    '<div class="dkpi"><div class="dkpi-lbl">关联项目（' + linkedPeers.length + '）' +
      (isOpportunity && _hasProjectEditPerm() ? ' <a href="javascript:void(0)" onclick="event.stopPropagation();showLsjConvertDialog()" title="商机转化" style="text-decoration:none;font-size:14px">&#x1F504;</a>' : '') +
      (_hasProjectEditPerm() ? ' ' + '<a href="javascript:void(0)" onclick="event.stopPropagation();editLinkedProjects()" title="编辑关联项目" style="text-decoration:none;font-size:14px">&#x1F517;</a>' : '') +
    '</div><div class="dkpi-val" style="font-size:12px;line-height:1.6">' +
    (linkedPeers.length
      ? '<div style="display:flex;flex-wrap:wrap;gap:4px">' + linkedPeers.map(function(lp) { return '<span class="proj-code-btn" onclick="loadProjectDetail('+lp.id+')" title="'+escHtml(lp.name||'')+'">'+escHtml(lp.code||lp.name)+'</span>'; }).join('') + '</div>'
      : '<span style="color:var(--muted)">—</span>') +
    '</div></div>' +
  '</div>';

  // Linked products + task/bug overview cards — side-by-side
  var products = p.linked_products || [];
  html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">' +
    '<div class="card card-pad" style="grid-column:span 2;min-width:0">' +
      '<div style="font-size:11px;color:var(--muted);margin-bottom:8px">关联产品（' + products.length + '）</div>';
  if (products.length) {
    html += '<div style="display:flex;flex-wrap:wrap;gap:8px">' +
      products.map(function(prod) {
        var chip = linkChip(prod.code || prod.name, 'openProductDetail(\'' + escHtml(prod.code || String(prod.id)).replace(/'/g, "\\'") + '\')', prod.name || '');
        var qty = prod.quantity || 1;
        return '<span style="position:relative;display:inline-block">' + chip +
          '<span style="position:absolute;top:-7px;right:-7px;background:var(--accent);color:#fff;border-radius:50%;min-width:16px;height:16px;line-height:16px;text-align:center;font-size:9px;font-weight:600;padding:0 2px;box-sizing:border-box">' + qty + '</span>' +
          '</span>';
      }).join('') +
    '</div>';
  } else {
    html += '<div style="font-size:12px;color:var(--muted);font-style:italic">暂无</div>';
  }
  html += '</div>' +
    '<div class="card card-pad" style="min-width:0;cursor:pointer" onclick="switchDTab(\'pma-tasks\')" title="未完成 ' + taskIncomplete + ' / 总数 ' + taskTotal + '">' +
      '<div style="font-size:11px;color:var(--muted);margin-bottom:8px">项目任务</div>' +
      '<div style="font-size:22px;font-weight:650;line-height:1">' +
        '<span style="color:' + (taskIncomplete === 0 ? 'var(--success)' : 'var(--blue)') + '">' + taskIncomplete + '</span><span style="font-size:13px;color:var(--muted);font-weight:400"> / ' + taskTotal + '</span>' +
      '</div>' +
    '</div>' +
    '<div class="card card-pad" style="min-width:0;cursor:pointer" onclick="switchDTab(\'bugs\')" title="未解决 ' + bugOpen + ' / 总数 ' + bugTotal + '">' +
      '<div style="font-size:11px;color:var(--muted);margin-bottom:8px">项目Bug</div>' +
      '<div style="font-size:22px;font-weight:650;line-height:1">' +
        '<span style="color:' + (bugOpen === 0 ? 'var(--success)' : 'var(--blue)') + '">' + bugOpen + '</span><span style="font-size:13px;color:var(--muted);font-weight:400"> / ' + bugTotal + '</span>' +
      '</div>' +
    '</div>' +
  '</div>';

  // Additional info row (minimal)
  var extras = [];
  if (p.real_end) extras.push('实际结束: <b style="color:var(--fg)">' + formatDate(p.real_end) + '</b>');
  if (extras.length) {
    html += '<div style="display:flex;gap:24px;flex-wrap:wrap;font-size:12px;color:var(--muted);margin-bottom:12px">' +
      extras.map(function(e) { return '<span>' + e + '</span>'; }).join('') +
    '</div>';
  }

  html += '</div>'; // .info-glass-card

  // --- 项目笔记 ---
  html += '<div class="card card-clip" style="padding:0;overflow:hidden">';
  html += '<div style="padding:8px 12px;background:var(--surface2);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">';
  html += '<span style="font-size:12px;font-weight:600">项目笔记</span>';
  html += '<button class="btn-xs" onclick="openNoteDialog()">+ 添加笔记</button>';
  html += '</div>';
  html += '<div style="max-height:400px;overflow-y:auto"><div id="notes-content"></div></div>';
  html += '</div>';

  // --- 项目动态 ---
  html += '<div class="card card-clip" style="padding:0;overflow:hidden">';
  html += '<div style="padding:8px 12px;background:var(--surface2);border-bottom:1px solid var(--border)">';
  html += '<span style="font-size:12px;font-weight:600">项目动态</span>';
  html += '</div>';
  html += '<div style="max-height:400px;overflow-y:auto" id="project-activity-content"><div style="padding:12px;text-align:center;color:var(--muted);font-size:12px">加载中...</div></div>';
  html += '</div>';

  html += '</div>'; // LEFT COLUMN

  // === RIGHT COLUMN (50%) — 技术协议, full height ===
  html += '<div style="flex:1;min-width:0;display:flex;flex-direction:column">';
  html += '<div class="card card-clip" style="padding:0;overflow:hidden;flex:1;display:flex;flex-direction:column">';
  html += '<div style="padding:8px 12px;background:var(--surface2);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-shrink:0">';
  html += '<span style="font-size:12px;font-weight:600">' + escHtml(currentAgreementName || '技术协议') + '</span>';
  html += '<div style="display:flex;align-items:center;gap:4px">';
  html += '<select id="agreement-doc-select" style="font-size:11px;padding:2px 6px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--fg);cursor:pointer" onchange="switchAgreementDoc(this.value)">';
  agreementOptions.forEach(function(opt) {
    html += '<option value="' + escHtml(opt) + '"' + (currentAgreementName === opt ? ' selected' : '') + '>' + escHtml(opt) + '</option>';
  });
  html += '</select>';
  html += '<button class="btn-xs" title="全屏查看" onclick="openAgreementDocFullscreen()">⛶</button>';
  html += '</div></div>';
  html += '<div style="flex:1;overflow:hidden" id="proj-agreement-card">';
  html += '<div id="proj-agreement-content" style="height:100%"></div>';
  html += '</div></div></div>';

  html += '</div>'; // main flex row

  document.getElementById('info-content').innerHTML = html;

  // Render agreement doc inline
  var renderAgreementDoc = function(docName) {
    var doc = findAgreementDoc(docName);
    var el = document.getElementById('proj-agreement-content');
    if (!el) return;
    if (doc) {
      var token = localStorage.getItem('pma_token') || '';
      var fetchUrl = '/api/documents/fetch?url=' + encodeURIComponent(doc.location) + '&token=' + encodeURIComponent(token);
      el.innerHTML = '<iframe src="' + fetchUrl + '" style="width:100%;min-height:800px;border:none"></iframe>';
    } else {
      el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted)">未找到' + docName + '，请按要求提交</div>';
    }
  };
  renderAgreementDoc(currentAgreementName || '对外销售-技术协议');

  window.switchAgreementDoc = function(docName) {
    var hdr = document.querySelector('#info-content .section-hd .section-title');
    if (hdr) hdr.textContent = docName;
    renderAgreementDoc(docName);
  };

  window.openAgreementDocFullscreen = function() {
    var sel = document.getElementById('agreement-doc-select');
    var docName = sel ? sel.value : (currentAgreementName || '对外销售-技术协议');
    var doc = findAgreementDoc(docName);
    if (doc) openDocIframeFullscreen(doc.location, doc.doc_name || docName);
    else showToast('未找到"' + docName + '"的文档', 'info');
  };

  // Populate notes
  buildNotes(notes || []);

  // Load project activity
  buildProjectActivity(p.code);
}

// _hasProjectEditPerm moved to utils.js

function editProjectBackground() {
  if (!_comboCurCode || !_projDetail) return;
  var currentBg = (_projDetail && _projDetail.background) ? _projDetail.background : '';
  openDialog('编辑项目背景 — ' + escHtml(_projDetail.name || ''),
    '<div style="margin-bottom:8px;display:flex;gap:4px">' +
      '<button class="btn btn-xs" onclick="document.getElementById(\'proj-bg-edit\').style.display=\'\';document.getElementById(\'proj-bg-preview\').style.display=\'none\';this.classList.add(\'btn-primary\');this.nextElementSibling.classList.remove(\'btn-primary\')" style="font-size:10px" id="proj-bg-edit-btn">编辑</button>' +
      '<button class="btn btn-xs" onclick="document.getElementById(\'proj-bg-edit\').style.display=\'none\';document.getElementById(\'proj-bg-preview\').style.display=\'\';this.classList.add(\'btn-primary\');this.previousElementSibling.classList.remove(\'btn-primary\')" style="font-size:10px" id="proj-bg-preview-btn">预览</button>' +
    '</div>' +
    '<div id="proj-bg-edit" style="margin-bottom:8px">' +
      '<textarea id="proj-bg-input" class="search-inp" rows="8" placeholder="支持 Markdown 格式，如 # 标题、**粗体**、- 列表" style="width:100%;box-sizing:border-box;resize:vertical;font-size:13px;font-family:var(--mono)">' + escHtml(currentBg) + '</textarea>' +
    '</div>' +
    '<div id="proj-bg-preview" class="markdown-body" style="display:none;margin-bottom:8px;padding:8px;border:1px solid var(--border);border-radius:6px;min-height:100px;max-height:300px;overflow-y:auto;background:var(--bg);font-size:12.5px;line-height:1.7"></div>' +
    '<script>setTimeout(function(){var ta=document.getElementById("proj-bg-input");if(ta){ta.oninput=function(){var pv=document.getElementById("proj-bg-preview");if(pv)pv.innerHTML=(typeof markdownToHtml==="function")?markdownToHtml(ta.value):"<pre>"+ta.value+"</pre>"}}},100)</' + 'script>',
    [
      {text: '取消', onclick: 'document.querySelector(\'.shared-dialog-overlay\').remove()'},
      {text: '保存', cls: 'btn-primary', onclick: 'saveProjectBackground()'},
    ],
    {hideClose: true, maxWidth: 640});
}

async function saveProjectBackground() {
  var input = document.getElementById('proj-bg-input');
  var bg = (input && input.value) ? input.value : '';
  closeSharedDialog();
  try {
    await API.put('/projects/' + _comboCurCode + '/background', { background: bg });
    _projDetail.background = bg;
    showToast('已保存', 'ok');
    // Refresh the background display
    var el = document.getElementById('proj-background-content');
    if (el) {
      el.innerHTML = bg ? '<div style="font-size:12.5px;line-height:1.7;white-space:pre-wrap">' + escHtml(bg) + '</div>' : '<div style="color:var(--muted);font-size:12px;font-style:italic">暂无项目背景说明</div>';
    }
  } catch(e) {
    showToast('保存失败: ' + (e.message || '未知错误'), 'error');
  }
}

var _editLinkedCodes = [];

async function editLinkedProjects() {
  if (!_comboCurCode || !_projDetail) return;
  try {
    var linked = (await API.get('/projects/' + _comboCurCode + '/linked-projects')) || [];
    _editLinkedCodes = linked.map(function(p) { return p.code || p.name; });

    var selectedHtml = _editLinkedCodes.length
      ? '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:8px" id="edit-linked-selected">' +
        _editLinkedCodes.map(function(code) {
          return '<span style="display:inline-flex;align-items:center;gap:2px;background:var(--accent-lt);color:var(--accent);padding:2px 6px;border-radius:4px;font-size:11px;font-family:var(--mono)">' +
            escHtml(code) + '<button onclick="removeEditLinkedCode(\'' + escHtml(code).replace(/'/g, "\\'") + '\')" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:12px;line-height:1;padding:0">&times;</button></span>';
        }).join('') + '</div>'
      : '';

    openDialog('编辑关联项目 — ' + escHtml(_projDetail.name || ''),
      '<div style="margin-bottom:12px"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">关联项目</label>' +
      '<div class="proj-combo" id="edit-linked-combo">' +
      '<input class="proj-combo-input" id="edit-linked-input" value="" autocomplete="off" placeholder="搜索选择项目..." onfocus="if(window.editLinkedComboOpen)editLinkedComboOpen()" oninput="if(window.editLinkedComboFilter)editLinkedComboFilter(this.value)" onclick="if(window.editLinkedComboOpen)editLinkedComboOpen()">' +
      '<svg class="proj-combo-arrow" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="2,5 7,10 12,5"/></svg>' +
      '<div class="proj-combo-dropdown" id="edit-linked-dd"></div>' +
      '</div>' + selectedHtml + '</div>',
      [{text: '取消', onclick: 'closeSharedDialog()'},
       {text: '保存', cls: 'btn-primary', onclick: 'saveLinkedProjects()'}],
      {hideClose: true, maxWidth: 460});

    // Init search combo (delayed to ensure DOM ready)
    setTimeout(function() {
      if (typeof initSearchCombo === 'function') {
        initSearchCombo({
          comboId: 'edit-linked-combo',
          inputId: 'edit-linked-input',
          dropdownId: 'edit-linked-dd',
          dataSource: function() { return API.get('/users/project-options').catch(function() { return []; }); },
          onSelect: function(p) {
            var code = p.code || p.name;
            if (_editLinkedCodes.indexOf(code) < 0) _editLinkedCodes.push(code);
            _refreshEditLinkedCodes();
            var el = document.getElementById('edit-linked-input');
            if (el) el.value = '';
          }
        });
      }
    }, 150);
  } catch(e) {
    showToast('加载失败: ' + (e.message || ''), 'error');
  }
}

function _refreshEditLinkedCodes() {
  var container = document.getElementById('edit-linked-selected');
  if (!container) return;
  if (!_editLinkedCodes.length) { container.innerHTML = ''; return; }
  container.innerHTML = _editLinkedCodes.map(function(code) {
    return '<span style="display:inline-flex;align-items:center;gap:2px;background:var(--accent-lt);color:var(--accent);padding:2px 6px;border-radius:4px;font-size:11px;font-family:var(--mono)">' +
      escHtml(code) + '<button onclick="removeEditLinkedCode(\'' + escHtml(code).replace(/'/g, "\\'") + '\')" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:12px;line-height:1;padding:0">&times;</button></span>';
  }).join('');
}

window.removeEditLinkedCode = function(code) {
  _editLinkedCodes = _editLinkedCodes.filter(function(c) { return c !== code; });
  _refreshEditLinkedCodes();
};

window.saveLinkedProjects = async function() {
  // Collect IDs from selected codes
  try {
    var allProjects = (await API.get('/users/project-options')) || [];
    var codeToId = {};
    allProjects.forEach(function(p) { codeToId[p.code || p.name] = p.id; });
    var ids = _editLinkedCodes.map(function(c) { return codeToId[c]; }).filter(Boolean);
  } catch(e) { var ids = []; }
  closeSharedDialog();
  try {
    await API.put('/projects/' + _comboCurCode + '/linked-projects', { ids: ids });
    showToast('关联项目已更新', 'ok');
    EventBus.emit(EVENTS.PROJECT_SAVED, {});
  } catch(e) {
    showToast('保存失败: ' + (e.message || '未知错误'), 'error');
  }
};

function showLsjConvertDialog() {
  if (!_projDetail || !_comboCurCode) return;
  showProjectFormDialog(false, _projDetail);
}

/* Gantt Chart */

var _ganttPpd = 16;        // pixels-per-day; presets: 6/16/24, default 16
var _ganttPresets = [6, 16, 24];
var _ganttDragInit = false;

function ganttGranularity(ppd) {
  if (ppd <= 1.5) return 'month';
  if (ppd <= 6)   return 'week';
  return 'day';
}

// ── Drag-to-pan ──

var _ganttDragWrap = null;
var _ganttDragState = null;
var _ganttResizeState = null;

function ganttLeftW() {
  var v = getComputedStyle(document.documentElement).getPropertyValue('--gantt-left-w').trim();
  return v ? parseInt(v) : 280;
}
function setGanttLeftW(w) {
  document.documentElement.style.setProperty('--gantt-left-w', w + 'px');
}

function initGanttDrag() {
  var wrap = document.querySelector('.gantt-wrap');
  if (!wrap) return;

  wrap.addEventListener('mousedown', function(e) {
    if (e.button !== 0) return;
    if (e.target.closest('.gantt-resize-handle')) return; // handled globally
    if (e.target.closest('.gantt-bar') || e.target.closest('input') || e.target.closest('button')) return;

    _ganttDragWrap = wrap;
    _ganttDragState = { startX: e.pageX, scrollLeft: wrap.scrollLeft };
    wrap.classList.add('dragging');
    e.preventDefault();
  });
}

// Global handlers
document.addEventListener('mousedown', function(e) {
  if (e.button !== 0) return;
  var h = e.target.closest('.gantt-resize-handle');
  if (!h) return;
  _ganttResizeState = { startX: e.pageX, startW: ganttLeftW() };
  document.querySelectorAll('.gantt-resize-handle').forEach(function(el) { el.classList.add('active'); });
  e.preventDefault();
});

document.addEventListener('mousemove', function(e) {
  if (_ganttResizeState) {
    var newW = Math.max(160, _ganttResizeState.startW + (e.pageX - _ganttResizeState.startX));
    setGanttLeftW(newW);
    return;
  }
  if (!_ganttDragWrap) return;
  _ganttDragWrap.scrollLeft = _ganttDragState.scrollLeft - (e.pageX - _ganttDragState.startX);
});

document.addEventListener('mouseup', function() {
  if (_ganttResizeState) {
    document.querySelectorAll('.gantt-resize-handle').forEach(function(el) { el.classList.remove('active'); });
    _ganttResizeState = null;
    return;
  }
  if (_ganttDragWrap) {
    _ganttDragWrap.classList.remove('dragging');
    _ganttDragWrap = null;
    _ganttDragState = null;
  }
});

// ── Wheel zoom ──

var _ganttRefreshTimer = null;
var _ganttTodayPx = 0;

function initGanttWheel() {
  var wrap = document.querySelector('.gantt-wrap');
  if (!wrap) return;
  if (wrap._wheelInited) return;
  wrap._wheelInited = true;

  wrap.addEventListener('wheel', function(e) {
    if (!e.ctrlKey && !e.metaKey) return; // only zoom with Ctrl held
    e.preventDefault();
    var cur = snapToPreset(_ganttPpd);
    var idx = _ganttPresets.indexOf(cur);
    if (e.deltaY < 0 && idx < _ganttPresets.length - 1) {
      _ganttPpd = _ganttPresets[idx + 1];
    } else if (e.deltaY > 0 && idx > 0) {
      _ganttPpd = _ganttPresets[idx - 1];
    }
    // Debounce refresh: only rebuild after scrolling stops
    clearTimeout(_ganttRefreshTimer);
    _ganttRefreshTimer = setTimeout(function() {
      refreshGantt();
    }, 150);
  }, { passive: false });
}

function refreshGantt() {
  if (_comboCurCode) {
    API.get('/projects/' + _comboCurCode + '/gantt').then(function(data) {
      buildGantt(data);
    });
  }
}

function snapToPreset(ppd) {
  var best = _ganttPresets[0];
  var bestDist = Math.abs(ppd - best);
  for (var i = 1; i < _ganttPresets.length; i++) {
    var d = Math.abs(ppd - _ganttPresets[i]);
    if (d < bestDist) { bestDist = d; best = _ganttPresets[i]; }
  }
  return best;
}

function ganttZoomIn() {
  var cur = snapToPreset(_ganttPpd);
  var idx = _ganttPresets.indexOf(cur);
  if (idx < _ganttPresets.length - 1) _ganttPpd = _ganttPresets[idx + 1];
  refreshGantt();
}

function ganttZoomOut() {
  var cur = snapToPreset(_ganttPpd);
  var idx = _ganttPresets.indexOf(cur);
  if (idx > 0) _ganttPpd = _ganttPresets[idx - 1];
  refreshGantt();
}

function ganttScrollToToday() {
  var wrap = document.querySelector('.gantt-wrap');
  if (!wrap) return;
  wrap.scrollTo({ left: Math.max(0, _ganttTodayPx - 80), behavior: 'smooth' });
}

// ── Date range ──

function ganttRange(stages) {
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var minDate = new Date(today), maxDate = new Date(today);

  if (stages && stages.length) {
    stages.forEach(function(s) {
      if (s.start) { var sd = new Date(s.start); if (sd < minDate) minDate = sd; }
      if (s.end)   { var ed = new Date(s.end);   if (ed > maxDate) maxDate = ed; }
    });
  }
  // Start from earliest stage date, end 2 months after latest stage end
  maxDate.setDate(1);
  maxDate.setMonth(maxDate.getMonth() + 2);

  return { start: minDate, end: maxDate, span: maxDate - minDate };
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// ── Column generation ──

function generateColumns(range, ppd) {
  var cols = [];
  var topGroups = [];
  var midGroups = [];
  var cursor = new Date(range.start);
  var gran = ganttGranularity(ppd);

  if (gran === 'day') {
    // 3 tiers: 月 / 周 / 日
    cursor.setHours(0, 0, 0, 0);
    var curTop = null, curMid = null;
    while (cursor <= range.end) {
      var m = cursor.getMonth() + 1, d = cursor.getDate();
      var dow = cursor.getDay();
      var label = String(d);
      var mcIdx = m - 1;
      cols.push({
        label: label, isWeekend: dow === 0 || dow === 6,
        isToday: isSameDay(cursor, new Date()),
        isMonthStart: d === 1, w: ppd, monthColor: mcIdx
      });
      // Top: month
      var tKey = cursor.getFullYear() + '-' + m;
      if (!curTop || curTop.key !== tKey) {
        curTop = { key: tKey, label: m + '月', w: 0, colorIdx: mcIdx };
        topGroups.push(curTop);
      }
      curTop.w += ppd;
      // Mid: week-of-month (W1~W5)
      var wkOfMonth = Math.ceil(d / 7);
      var mKey = tKey + '-W' + wkOfMonth;
      if (!curMid || curMid.key !== mKey) {
        curMid = { key: mKey, label: 'W' + wkOfMonth, w: 0 };
        midGroups.push(curMid);
      }
      curMid.w += ppd;
      cursor.setDate(cursor.getDate() + 1);
    }
  } else if (gran === 'week') {
    // 3 tiers: 年 / 月 / 周
    cursor.setDate(cursor.getDate() - cursor.getDay() + 1);
    if (cursor.getDay() === 0) cursor.setDate(cursor.getDate() - 6);
    var curTop = null, curMid = null;
    while (cursor <= range.end) {
      var wm = cursor.getMonth() + 1, wd = cursor.getDate();
      var mcIdx = wm - 1;
      cols.push({
        label: wm + '/' + wd, isWeekend: false,
        isToday: false, isMonthStart: wd <= 7,
        w: ppd * 7, monthColor: mcIdx
      });
      // Top: year
      var tKey = String(cursor.getFullYear());
      if (!curTop || curTop.key !== tKey) {
        curTop = { key: tKey, label: cursor.getFullYear() + '年', w: 0 };
        topGroups.push(curTop);
      }
      curTop.w += ppd * 7;
      // Mid: month
      var mKey = cursor.getFullYear() + '-' + wm;
      if (!curMid || curMid.key !== mKey) {
        curMid = { key: mKey, label: wm + '月', w: 0, colorIdx: mcIdx };
        midGroups.push(curMid);
      }
      curMid.w += ppd * 7;
      cursor.setDate(cursor.getDate() + 7);
    }
  } else {
    // 2 tiers: 年 / 月 (no mid tier needed)
    cursor.setDate(1);
    var curTop = null;
    while (cursor <= range.end) {
      var y = cursor.getFullYear(), mo = cursor.getMonth() + 1;
      var today = new Date();
      var mcIdx = mo - 1;
      cols.push({
        label: mo === 1 ? y + '/' + mo : mo + '月',
        isWeekend: false, isMonthStart: true,
        isToday: today.getFullYear() === y && today.getMonth() + 1 === mo,
        w: ppd * new Date(y, mo, 0).getDate(), monthColor: mcIdx
      });
      // Top: year
      var tKey = String(y);
      if (!curTop || curTop.key !== tKey) {
        curTop = { key: tKey, label: y + '年', w: 0 };
        topGroups.push(curTop);
      }
      curTop.w += ppd * new Date(y, mo, 0).getDate();
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }
  return { cols: cols, topGroups: topGroups, midGroups: midGroups };
}

// ── Pixel position ──

function ganttPx(ds, range, totalWidth) {
  if (!ds) return 0;
  var t = new Date(ds) - range.start;
  return Math.max(0, Math.min(totalWidth, (t / range.span) * totalWidth));
}

// ── Progress ring ──

function renderProgressRing(pct) {
  pct = Math.round(Math.max(0, Math.min(100, pct || 0)));
  var size = 48, cx = 24, r = 17;
  var circ = 2 * Math.PI * r;
  var offset = circ * (1 - pct / 100);
  var color = pct >= 100 ? 'var(--success)' : pct > 0 ? 'var(--accent)' : 'var(--border)';
  return '<svg class="gs-ring" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
    '<circle cx="' + cx + '" cy="' + cx + '" r="' + r + '" fill="none" stroke="var(--border)" stroke-width="3"/>' +
    '<circle cx="' + cx + '" cy="' + cx + '" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="3" ' +
      'stroke-dasharray="' + circ.toFixed(1) + '" stroke-dashoffset="' + offset.toFixed(1) + '" ' +
      'stroke-linecap="round" transform="rotate(-90 ' + cx + ' ' + cx + ')"/>' +
    '<text x="' + cx + '" y="' + cx + '" text-anchor="middle" dy="0.35em" font-size="15" font-weight="600" fill="var(--muted)">' + pct + '</text>' +
    '</svg>';
}

// ── Main render ──

function buildGantt(data) {
  // 记录刷新前的滚动位置：任务增删改联动刷新时保留横向滚动，避免"跳回开头"的整页刷新感
  var _ganttRootEl = document.getElementById('gantt-root');
  var _isRefresh = !!(_ganttRootEl && _ganttRootEl.querySelector('.gantt-row'));
  var _prevWrap = document.querySelector('.gantt-wrap');
  var _prevScroll = _prevWrap ? _prevWrap.scrollLeft : 0;

  var stages = (data && data.stages) ? data.stages : (Array.isArray(data) ? data : []);
  _lastGanttStages = stages;  // store for gotoStageDetail
  var projBegin = data && data.project_begin ? data.project_begin : null;
  var projEnd   = data && data.project_end   ? data.project_end   : null;
  var range = ganttRange(stages);
  var ppd = _ganttPpd;
  var result = generateColumns(range, ppd);
  var cols = result.cols;
  var topGroups = result.topGroups;
  var midGroups = result.midGroups;
  var totalWidth = cols.reduce(function(s, c) { return s + c.w; }, 0);

  // Ensure content always overflows so drag-to-pan works at any zoom level
  var wrap = document.querySelector('.gantt-wrap');
  var minTotalWidth = (wrap ? wrap.clientWidth : 800) + 400;
  var displayWidth = Math.max(totalWidth, minTotalWidth);

  buildGanttToolbar();

  // Top-level group headers (年 / 月)
  var topHdrs = topGroups.map(function(g) {
    var mcCls = g.colorIdx !== undefined ? ' gantt-mc-' + g.colorIdx : '';
    return '<div class="gantt-group-hd gantt-top-hd' + mcCls + '" style="width:' + g.w + 'px">' + g.label + '</div>';
  }).join('');

  // Mid-level group headers (月 / 周), only when present
  var midHdrs = '';
  var midRowHtml = '';
  if (midGroups.length) {
    midHdrs = midGroups.map(function(g) {
      var mcCls = g.colorIdx !== undefined ? ' gantt-mc-' + g.colorIdx : '';
      return '<div class="gantt-group-hd gantt-mid-hd' + mcCls + '" style="width:' + g.w + 'px">' + g.label + '</div>';
    }).join('');
    midRowHtml = '<div class="gantt-head-row gantt-head-mid">' +
      '<div class="gantt-label-col"></div>' +
      '<div class="gantt-timeline-head" style="min-width:' + displayWidth + 'px;width:' + displayWidth + 'px">' + midHdrs + '</div>' +
    '</div>';
  }

  // Column headers
  var mHdrs = cols.map(function(c) {
    var cls = 'gantt-col-hd';
    if (c.isToday) cls += ' today-col';
    if (c.isWeekend) cls += ' weekend';
    if (c.isMonthStart && !c.isToday && ganttGranularity(ppd) === 'day') cls += ' q-end';
    if (c.monthColor !== undefined) cls += ' gantt-mc-' + c.monthColor;
    return '<div class="' + cls + '" style="width:' + c.w + 'px">' + c.label + '</div>';
  }).join('');

  // Grid columns
  var gCols = cols.map(function(c) {
    var cls = 'gantt-grid-col';
    if (c.isToday) cls += ' today-bg';
    if (c.monthColor !== undefined) cls += ' gantt-mc-' + c.monthColor;
    return '<div class="' + cls + '" style="width:' + c.w + 'px"></div>';
  }).join('');

  var today = fmtLocalDate();
  var todayPx = ganttPx(today, range, totalWidth);
  _ganttTodayPx = todayPx;

  if (!stages || !stages.length) {
    document.getElementById('gantt-root').innerHTML =
      '<div class="gantt-head-row gantt-head-top">' +
        '<div class="gantt-label-col"></div>' +
        '<div class="gantt-timeline-head" style="min-width:' + displayWidth + 'px;width:' + displayWidth + 'px">' + topHdrs + '</div>' +
      '</div>' +
      midRowHtml +
      '<div class="gantt-head-row">' +
        '<div class="gantt-label-col"><div class="gl-stage">阶段</div><div class="gl-risk">风险</div><div class="gl-prog">进度</div><div class="gl-who">负责人</div><div class="gantt-resize-handle"></div></div>' +
        '<div class="gantt-timeline-head" style="min-width:' + displayWidth + 'px;width:' + displayWidth + 'px">' + mHdrs + '</div>' +
      '</div>' +
      '<div class="gantt-row"><div class="gantt-stage-cell" style="width:100%;text-align:center;color:var(--muted);padding:20px">暂无阶段数据</div></div>';
    initGanttDrag();
    initGanttWheel();
    return;
  }

  // Project timeline — vertical start/end lines
  var projBeginPx = projBegin ? ganttPx(projBegin, range, totalWidth) : 0;
  var projEndPx = projEnd ? ganttPx(projEnd, range, totalWidth) : 0;
  var projLinesHtml = '';
  if (projBegin) {
    projLinesHtml += '<div class="gantt-proj-start-line" style="left:' + projBeginPx + 'px" title="项目开始: ' + projBegin + '"></div>';
  }
  if (projEnd) {
    projLinesHtml += '<div class="gantt-proj-end-line" style="left:' + projEndPx + 'px" title="项目结束: ' + projEnd + '"></div>';
  }

  var rows = stages.map(function(s, i) {
    var alt = i % 2 === 1 ? ' stage-alt' : '';
    var prog = parseFloat(s.progress) || 0;
    var tasksDone = s.tasks_done || 0;
    var tasksTotal = s.tasks_total || 0;

    // Stage name
    var nameEl = '<button class="gs-btn" title="跳转到任务详情" onclick="gotoStageDetail(' + i + ');event.stopPropagation()">' + escHtml(s.name) + '</button>';

    // Risk tag — PMA stages are all standard, no missing/unmatched/fuzzy
    var risk = getStageRisk(s);
    var riskHtml = '<span class="risk-tag" style="--risk-color:' + risk.color + '" title="' + escHtml(risk.tip) + '">' + escHtml(risk.label) + '</span>';

    // Bar — use dates if available, otherwise full-width progress
    var hasDates = s.start && s.end;
    var lp = hasDates ? ganttPx(s.start, range, totalWidth) : 0;
    var ep = hasDates ? ganttPx(s.end, range, totalWidth) : totalWidth;
    var wp = Math.max(4, ep - lp);
    var barCls = 'gantt-bar ' + (s.status || 'active') + (isStageOverdue(s) ? ' gantt-overdue' : '') + (tasksTotal === 0 ? ' gantt-empty' : '');
    var barHtml = '<div class="' + barCls + '" style="left:' + lp + 'px;width:' + wp + 'px" data-tip="' +
      (hasDates ? compactDate(s.start) + '→' + compactDate(s.end) + '　' : '') +
      '任务:' + tasksDone + '/' + tasksTotal + '">' +
      '<div class="gantt-bar-fill" style="width:' + prog + '%"></div>' +
    '</div>';

    return '<div class="gantt-row' + alt + '" id="gantt-row-' + i + '">' +
      '<div class="gantt-stage-cell">' +
        nameEl +
        '<div class="gs-risk">' + riskHtml + '</div>' +
        '<div class="gs-prog">' + renderProgressRing(prog) + '</div>' +
        '<div class="gs-who"' + (s.who_tooltip ? ' title="' + escHtml(s.who_tooltip) + '"' : '') + '>' + escHtml(s.who || '—') + '</div>' +
      '</div>' +
      '<div class="gantt-bar-cell" style="min-width:' + displayWidth + 'px;width:' + displayWidth + 'px">' +
        '<div class="gantt-grid">' + gCols + '</div>' +
        projLinesHtml +
        '<div class="gantt-today-line" style="left:' + todayPx + 'px"></div>' +
        barHtml +
      '</div>' +
    '</div>';
  }).join('');

  document.getElementById('gantt-root').innerHTML =
    '<div class="gantt-head-row gantt-head-top">' +
      '<div class="gantt-label-col"></div>' +
      '<div class="gantt-timeline-head" style="min-width:' + displayWidth + 'px;width:' + displayWidth + 'px">' + topHdrs + '</div>' +
    '</div>' +
    midRowHtml +
    '<div class="gantt-head-row">' +
      '<div class="gantt-label-col"><div class="gl-stage">阶段</div><div class="gl-risk">风险</div><div class="gl-prog">进度</div><div class="gl-who">负责人</div><div class="gantt-resize-handle"></div></div>' +
      '<div class="gantt-timeline-head" style="min-width:' + displayWidth + 'px;width:' + displayWidth + 'px">' + mHdrs + '</div>' +
    '</div>' + rows;

  // 首次加载滚动到第一个阶段；刷新场景保留原滚动位置
  setTimeout(function() {
    var wrap = document.querySelector('.gantt-wrap');
    if (!wrap) return;
    if (_isRefresh) {
      wrap.scrollLeft = _prevScroll;
    } else {
      var firstStartPx = 0;
      if (stages && stages.length) {
        firstStartPx = ganttPx(stages[0].start, range, totalWidth);
      }
      wrap.scrollLeft = Math.max(0, firstStartPx - 40);
    }
  }, 50);

  initGanttDrag();
  initGanttWheel();
  initBarTooltip();
}

var _barTipEl = null;

function initBarTooltip() {
  var root = document.getElementById('gantt-root');
  if (!root) return;
  if (!_barTipEl) {
    _barTipEl = document.createElement('div');
    _barTipEl.style.cssText = 'display:none;position:fixed;background:#333;color:#fff;font-size:11px;padding:5px 10px;border-radius:5px;z-index:9999;pointer-events:none;white-space:nowrap;word-break:keep-all;box-shadow:0 2px 8px rgba(0,0,0,0.3);font-family:var(--mono)';
    document.body.appendChild(_barTipEl);
  }
  root.addEventListener('mousemove', function(e) {
    var bar = e.target.closest('.gantt-bar');
    if (!bar || !bar.dataset.tip) { _barTipEl.style.display = 'none'; return; }
    _barTipEl.textContent = bar.dataset.tip;
    _barTipEl.style.display = 'block';
    var z = _getZoom();
    _barTipEl.style.left = (e.clientX / z + 12) + 'px';
    _barTipEl.style.top = (e.clientY / z - 30) + 'px';
  });
  root.addEventListener('mouseleave', function() {
    _barTipEl.style.display = 'none';
  });
}

function buildGanttToolbar() {
  var container = document.getElementById('gantt-toolbar-container');
  if (container) {
    container.innerHTML = '<div class="gantt-toolbar">' +
      '<div style="font-size:10.5px;color:var(--muted)">Ctrl+滚轮缩放 · 拖拽平移</div>' +
      '<div class="gantt-toolbar-zoom">' +
        '<button class="gantt-zoom-btn" onclick="ganttZoomOut()" title="缩小">−</button>' +
        '<span class="gantt-zoom-val">×' + _ganttPpd.toFixed(0) + '</span>' +
        '<button class="gantt-zoom-btn" onclick="ganttZoomIn()" title="放大">+</button>' +
        '<button class="gantt-zoom-btn" onclick="ganttScrollToToday()" title="定位到今日" style="margin-left:8px;font-size:11px">●今</button>' +
      '</div>' +
    '</div>';
  }
}

/* Stages Table */

function isStageOverdue(s) {
  if (s.status === 'completed' || s.status === 'blocked') return false;
  if (!s.end) return false;
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var end = new Date(s.end);
  var prog = parseFloat(s.progress) || 0;
  return today > end && prog < 100;
}

function getStageRisk(s) {
  // Returns { level, label, color, tip }
  if (s.status === 'completed') return { level: 'none', label: '已完成', color: 'var(--success)', tip: '阶段已完成' };
  if (s.status === 'blocked') return { level: 'high', label: '阻塞', color: 'var(--danger)', tip: '阶段被挂起/阻塞' };

  var today = new Date(); today.setHours(0, 0, 0, 0);
  var start = s.start ? new Date(s.start) : null;
  var end = s.end ? new Date(s.end) : null;
  var prog = s.progress || 0;

  if (!start || !end) return { level: 'low', label: '无计划', color: 'var(--muted)', tip: '缺少计划日期' };

  var totalDays = Math.max(1, Math.round((end - start) / 86400000));
  var elapsedDays = Math.round((today - start) / 86400000);

  // Overdue
  if (today > end && prog < 100) {
    var overdueDays = Math.round((today - end) / 86400000);
    return { level: 'high', label: '超期' + overdueDays + '天', color: 'var(--danger)', tip: '应于 ' + formatDate(s.end) + ' 完成' };
  }
  // Not started yet
  if (today < start) return { level: 'none', label: '未开始', color: 'var(--muted)', tip: '计划 ' + formatDate(s.start) + ' 开始' };

  // On-track analysis
  var expectedProg = Math.min(100, Math.round((elapsedDays / totalDays) * 100));
  var gap = expectedProg - prog;

  if (gap <= 5) return { level: 'none', label: '正常', color: 'var(--success)', tip: '预期' + expectedProg + '% 实际' + prog + '%' };
  if (gap <= 20) return { level: 'low', label: '滞后', color: 'var(--warn)', tip: '预期' + expectedProg + '% 实际' + prog + '%' };
  if (gap <= 40) return { level: 'medium', label: '滞后', color: '#e67e22', tip: '预期' + expectedProg + '% 实际' + prog + '%' };
  return { level: 'high', label: '严重', color: 'var(--danger)', tip: '预期' + expectedProg + '% 实际' + prog + '%' };
}

function buildStages(stages) {
  var stageList = (stages && stages.stages) ? stages.stages : stages;
  var tbody = document.getElementById('stages-tbody');
  if (!tbody) return;  // stages section removed — data now shown in task detail tab

  if (!stageList || !stageList.length) {
    tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state">暂无阶段数据</div></td></tr>';
    return;
  }

  tbody.innerHTML = stageList.map(function(s, i) {
    var dels = s.deliverables || [];
    var taskCount = s.task_count || 0;
    var risk = getStageRisk(s);
    var prog = parseFloat(s.progress) || 0;
    var progHtml = prog !== null && prog !== undefined ? renderProgressRing(prog) : '<span style="color:var(--muted)">—</span>';

    return '<tr id="stage-row-' + i + '">' +
      '<td><strong>' + escHtml(s.name) + '</strong>' +
        (taskCount ? ' <span style="font-size:10px;color:var(--muted)">' + taskCount + '个任务</span>' : '') +
      '</td>' +
      '<td><span class="risk-tag" style="--risk-color:' + risk.color + '" title="' + escHtml(risk.tip) + '">' + escHtml(risk.label) + '</span></td>' +
      '<td>' + progHtml + '</td>' +
      '<td><span style="font-size:12px;color:var(--muted)">—</span></td>' +
      '<td><span style="font-size:11.5px;color:var(--muted);white-space:nowrap;word-break:keep-all;line-height:1.8">—</span></td>' +
      '<td><span class="pill" style="background:var(--accent-lt);color:var(--accent)">标准阶段</span></td>' +
      '<td><span style="font-size:12px;color:var(--muted)">—</span></td>' +
      '<td>' + renderDeliverablesList(dels) + '</td>' +
    '</tr>';
  }).join('');
}

/* Documents Table */

function buildDocs(data) {
  _projectDocsRaw = data;
  var user = getCurrentUser();
  var perms = (user && user.permissions) ? user.permissions.split(',') : [];
  var canEdit = perms.indexOf('doc_template') >= 0 || perms.indexOf('admin') >= 0 || perms.indexOf('project_edit') >= 0;

  // Update template link to navigate to the correct project type
  var projType = (_projDetail && _projDetail.project_type) ? _projDetail.project_type : 'RD';
  var linkEl = document.getElementById('proj-docs-template-link');
  if (linkEl) {
    linkEl.onclick = function() { gotoView('doc-templates', {params: ['project', projType]}); };
    linkEl.textContent = '查看文档模板详情 →';
  }

  // New format: { documents: [...], standard_stages: [...] }
  var stageList = (data && data.documents) ? data.documents : data;
  if (!stageList || !stageList.length) {
    document.getElementById('docs-table-wrap').innerHTML = '<div style="text-align:center;padding:30px;font-style:italic;color:var(--muted)">暂无文档清单<br><span style="font-size:11px">项目阶段尚未匹配到文档模板，请先配置文档模板</span></div>'; _docsDt = null;
    return;
  }

  var typeLabels = { gitlab: 'GitLab', svn: 'SVN', nas: 'NAS', solidworks: '结构设计', pma: 'PMA' };
  var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  var stageColors = isDark
    ? ['var(--accent-lt)', '#283528', '#353020', '#2a3340', '#283530', '#2c2c30', '#353028', '#2a2e3a']
    : ['var(--accent-lt)', '#e8f5e9', '#fff3e0', '#e3f2fd', '#e0f2f1', '#f5f5f5', '#fff8e1', '#e8eaf6'];

  // Flatten into rows for DataTable
  var flatRows = [];
  stageList.forEach(function(stage, stageIdx) {
    var stageName = stage.stage_name || '未分类';
    var items = stage.documents || [];
    var hasDocs = stage.has_documents;
    var bg = stageColors[stageIdx % stageColors.length];
    var doneCount = 0, totalCount = 0;
    if (hasDocs) { items.forEach(function(d) { totalCount++; if (d.done) doneCount++; }); }
    var progressPct = totalCount > 0 ? Math.round(doneCount / totalCount * 100) : 0;
    var progressColor = progressPct >= 100 ? 'var(--success)' : (progressPct > 0 ? 'var(--warn)' : 'var(--muted)');
    var progressRing = totalCount > 0 ? '<span style="display:inline-flex;align-items:center;gap:4px;vertical-align:middle">' + renderProgressCircle(progressPct, 28, { label: '', color: progressColor }) + '<span style="font-size:9px;color:var(--muted);font-weight:400">' + doneCount + '/' + totalCount + '</span></span>' : '';

    if (!hasDocs) {
      flatRows.push({ _stage: stageName, _empty: true, _bg: bg, _progressRing: '', _seq: '', _docName: '', responsible_role: '', _statusHtml: '', _docType: '', _locHtml: '暂无文档模板，请先配置文档模板 @CTO', updated_at: '', updated_by: '', _actions: '' });
    } else {
      items.sort(function(a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });
      items.forEach(function(d, i) {
        var hasError = (!d.done && d.location) || d.mismatch;
        if (d.done && !d.mismatch) d._statusHtml = '<span class="pill completed">已提交</span>';
        else if (hasError) d._statusHtml = '<span class="pill" style="background:var(--danger-lt);color:var(--danger)">×错误</span>';
        else d._statusHtml = '<span class="pill blocked">未提交</span>';
        if (d.location === '无需文档' || d.location === '已删除') d._locHtml = '<span style="font-size:11px;color:var(--muted);font-style:italic">' + escHtml(d.location) + '</span>';
        else if (d.mismatch) d._locHtml = '<span style="color:var(--danger)">' + escHtml((d.location||'').replace(/^请提交到：/,'')) + '</span><br><span style="font-size:10px;color:var(--danger)">' + escHtml(d.mismatch) + '</span>';
        else if (d.file_count && d.file_count > 0 && d.done && d.location) d._locHtml = '<span style="display:inline-block;background:var(--accent-lt);color:var(--accent);font-size:10px;padding:1px 6px;border-radius:10px;font-weight:500;white-space:nowrap;border:1px solid var(--accent);margin-right:4px">' + d.file_count + ' 文件</span><a href="' + escHtml(d.location) + '" target="_blank" style="color:var(--accent);text-decoration:none;word-break:break-all" onmouseover="this.style.textDecoration=\'underline\'" onmouseout="this.style.textDecoration=\'none\'">' + escHtml(d.location) + '</a>';
        else if (d.done && d.location) d._locHtml = '<a href="' + escHtml(d.location) + '" target="_blank" style="color:var(--accent);text-decoration:none;word-break:break-all" onmouseover="this.style.textDecoration=\'underline\'" onmouseout="this.style.textDecoration=\'none\'">' + escHtml(d.location) + '</a>';
        else if (hasError && d.location) d._locHtml = '<span style="color:var(--danger)">' + escHtml((d.location||'').replace(/^请提交到：/,'')) + '</span><br><span style="font-size:10px;color:var(--danger)">文件不存在或无法访问</span>';
        else if (d.doc_path) d._locHtml = '<span style="color:var(--muted);font-style:italic">请提交到：<span style="word-break:break-all">' + escHtml(d.doc_path) + '</span></span>';
        else d._locHtml = '<span style="font-size:11.5px;color:var(--muted);font-style:italic">待提交</span>';
        d._stage = stageName; d._empty = false; d._bg = bg; d._progressRing = progressRing; d._seq = i + 1;
        d._docName = escHtml(d.doc_name) + (d.is_optional ? ' <span style="font-size:9px;color:var(--accent);background:var(--accent-lt);padding:1px 4px;border-radius:3px" title="可选项">可选</span>' : '');
        d._docType = typeLabels[d.doc_type] || d.doc_type || '—';
        d._updatedAt = fmtISODateTime(d.updated_at) || formatDate(d.completed_at);
        d._updatedBy = d.updated_by || '';
        var loc = d.location, dn = d.doc_name;
        var isOrphan = d.stage_type === '未知';
        d._actions = (loc && !loc.startsWith('@') && isPreviewableUrl(loc) ? iconEye('previewDocument(\'' + encodeURIComponent(loc) + '\',\'' + escJs(dn||'') + '\')', '预览') : (loc && loc !== '无需文档' && loc !== '已删除' ? '<a href="' + escHtml(loc) + '" target="_blank" title="打开链接" style="text-decoration:none;font-size:15px">&#x1F517;</a>' : '')) + (d.is_optional && canEdit ? iconDelete('removeOptionalDoc(' + d.id + ',\x27' + escJs(dn) + '\x27)', '移除此文档') : '') + (isOrphan && canEdit ? iconDelete('deleteOrphanDoc(' + d.id + ',\x27' + escJs(dn) + '\x27)', '删除文档') : '') + (canEdit ? iconEdit('openDocEditDialog(' + d.id + ')', '编辑') : '');
        flatRows.push(d);
      });
    }
  });

  var container = document.getElementById('docs-table-wrap');
  if (_docsDt) { _docsDt.setData(flatRows); return; }
  container.innerHTML = '<div style="width:100%"><div id="docs-table"></div></div>';
  _docsDt = new DataTable({
    container: document.getElementById('docs-table'),
    columns: [
      { key: '_stage', title: '阶段', width: '11%', minWidth: 100, rowspan: true, render: function(v, row, idx, count) { return '<span style="font-weight:600;color:var(--accent);font-size:12px">'+escHtml(v||'')+' <sup style="font-size:10px;color:var(--muted);font-weight:400">'+(count||(row._empty?0:1))+'</sup>'+(row._empty?'':'<div style="margin-top:4px">'+row._progressRing+'</div>')+'</span>'; } },
      { key: '_seq', title: '序号', width: '40px', minWidth: 60, render: function(v, row) { return row._empty?'<span style="color:var(--muted)">-</span>':'<span style="font-family:var(--mono);color:var(--muted)">'+(v||'')+'</span>'; } },
      { key: '_docName', title: '文档名称', width: '14%', minWidth: 100, className: 'dt-wrap', render: function(v, row) { return row._empty?'<span style="color:var(--muted)">-</span>':'<span style="font-weight:500;word-break:break-all" title="'+escHtml(row.description||'')+'">'+(v||'')+'</span>'; } },
      { key: 'responsible_role', title: '责任人', width: '8%', minWidth: 90, render: function(v, row) { return row._empty?'<span style="color:var(--muted)">-</span>':'<span style="font-size:12px;white-space:nowrap">'+escHtml(v||'—')+'</span>'; } },
      { key: '_statusHtml', title: '状态', width: '70px', minWidth: 80, render: function(v, row) { return row._empty?'<span style="color:var(--muted)">-</span>':(v||''); } },
      { key: '_docType', title: '类型', width: '60px', minWidth: 70, render: function(v, row) { return row._empty?'<span style="color:var(--muted)">-</span>':'<span style="font-size:11px">'+escHtml(v||'')+'</span>'; } },
      { key: '_locHtml', title: '路径', align: 'left', className: 'dt-wrap', render: function(v, row) { return '<span style="font-size:12px;word-break:break-all">'+(v||'')+'</span>'; } },
      { key: '_updatedAt', title: '最后修改时间', width: '12%', minWidth: 120, render: function(v) { return '<span style="font-size:11px;color:var(--muted);white-space:nowrap">'+escHtml(v||'—')+'</span>'; } },
      { key: '_updatedBy', title: '修改人', width: '7%', minWidth: 90, render: function(v) { return '<span style="font-size:12px;color:var(--muted)">'+escHtml(getDisplayName(v)||'')+'</span>'; } },
      { key: '_actions', title: '操作', width: actionColWidth(4) + 'px', minWidth: actionColWidth(4), render: function(v, row) { return '<span style="white-space:nowrap">'+(v||'')+'</span>'; } }
    ],
    data: flatRows,
    maxHeight: 'calc(100vh - 320px)',
    rowClassFn: function(row) { return row._bg ? { background: row._bg } : null; }
  });
}

var _docsDt = null;
var _projectDocsRaw = null;  // 最近一次文档数据（用于编辑对话框读取 doc 元数据）

/* ── 软件版本 Tab（聚合项目发布 + 产品基础版本，支持锁定）── */
var _svData = null;        // GET /software-versions 返回的 data
var _svView = 'all';   // 'all' 版本汇总(默认子tab) | 'current' 版本维护
var _svTypeFilter = 'all'; // 'all' | 'project' | 'product'
var _svProdFilter = 'all'; // 产品 code 或 'all'
var _svKeyword = '';       // 版本关键字
var _svExpanded = {};      // doc key('project_doc:12'/'product_doc:3342') -> bool

function _svCanEdit() {
  var user = getCurrentUser();
  var perms = (user && user.permissions) ? user.permissions.split(',') : [];
  return perms.indexOf('project_edit') >= 0 || perms.indexOf('admin') >= 0;
}

/* ── Document Status Edit Dialog ── */

function openDocEditDialog(docId) {
  var doc = _findProjectDoc(docId);
  var isVersionDoc = doc && doc.doc_type === 'gitlab';

  var html = '';
  // 版本选择（GitLab 版本文档：软件发布 / FPGA版本开发 等）
  // （来源切换已统一收敛到软件版本页的每个子项「来源选择」下拉，不再在此处配置）
  if (isVersionDoc) {
    html += '<div style="margin-bottom:12px;padding:10px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px" id="doc-edit-ver-box">' +
      '<div style="font-size:11px;color:var(--muted);margin-bottom:4px">当前版本（展示层选择，不影响文档自动跟踪最新）</div>' +
      '<div id="doc-edit-ver-inner"><span style="color:var(--muted);font-size:11px">加载版本中...</span></div>' +
    '</div>';
  }
  if (!isVersionDoc) {
    html += '<div style="padding:8px 4px;color:var(--muted);font-size:12px">该文档无版本配置项</div>';
  }

  openDialog('编辑文档状态',
    html,
    [{text: '关闭', onclick: 'closeSharedDialog()'}],
    {hideClose: true, maxWidth: 480});

  if (isVersionDoc) loadDocVersionOptions(docId, doc);
}

function _findProjectDoc(docId) {
  var raw = _projectDocsRaw;
  var stages = raw && raw.documents ? raw.documents : (Array.isArray(raw) ? raw : []);
  var found = null;
  stages.forEach(function(stage) {
    (stage.documents || []).forEach(function(d) { if (d.id == docId) found = d; });
  });
  return found;
}

async function loadDocVersionOptions(docId, doc) {
  var inner = document.getElementById('doc-edit-ver-inner');
  if (!inner) return;
  try {
    var resp = await API.get('/projects/' + _comboCurCode + '/software-versions');
    var data = (resp && resp.data) ? resp.data : resp;
    var match = null;
    ((data && data.groups) || []).forEach(function(g) {
      (g.docs || []).forEach(function(d) {
        if (d.source_type === 'project_doc' && d.doc_id == docId) match = d;
      });
    });
    if (!match || !match.versions || !match.versions.length) {
      inner.innerHTML = '<span style="color:var(--muted);font-size:11px">暂无版本（文档路径未匹配到 GitLab 发布，或尚未扫描）</span>';
      return;
    }
    var sorted = match.versions.slice().sort(function(a, b) { return (b.date || '').localeCompare(a.date || ''); });
    var opts = '';
    sorted.forEach(function(v) {
      var sel = (v.version === match.current) ? ' selected' : '';
      opts += '<option value="' + escHtml(v.version) + '"' + sel + '>' + escHtml(v.version) + (v.date ? '（' + formatDate(v.date) + '）' : '') + '</option>';
    });
    var lockedTxt = match.locked
      ? '<span style="color:var(--success);font-weight:700;margin-left:6px">✅</span>' + (match.has_newer ? '<span class="tag-badge tag-2" style="margin-left:6px">非最新</span>' : '')
      : '';
    inner.innerHTML =
      '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
        '<select id="doc-edit-ver" style="flex:1;min-width:180px;padding:5px 8px;font-size:12px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--fg)">' + opts + '</select>' +
        '<button class="btn btn-sm" onclick="saveDocVersion(' + docId + ')" style="font-size:11px;padding:4px 10px">锁定为当前版本</button>' +
        (match.locked ? '<button class="btn btn-sm" onclick="unlockDocVersion(' + docId + ')" style="font-size:11px;padding:4px 10px;color:var(--danger);border-color:var(--danger)">恢复自动最新</button>' : '') +
      '</div>' +
      '<div style="font-size:10px;color:var(--muted);margin-top:4px">当前：' + escHtml(match.current || '—') + lockedTxt + '</div>';
  } catch(e) {
    inner.innerHTML = '<span style="color:var(--danger);font-size:11px">加载版本失败: ' + escHtml(e.message) + '</span>';
  }
}

async function saveDocVersion(docId) {
  var sel = document.getElementById('doc-edit-ver');
  var version = sel ? sel.value : '';
  if (!version) return;
  try {
    await API.post('/projects/' + _comboCurCode + '/software-versions/lock', { source_type: 'project_doc', doc_id: docId, version: version });
    showToast('已锁定版本：' + version, 'success');
    closeSharedDialog();
    EventBus.emit(EVENTS.PROJECT_DOC_SAVED, {});
  } catch(e) { showToast('设置失败: ' + (e.message || ''), 'error'); }
}

async function unlockDocVersion(docId) {
  try {
    await API.post('/projects/' + _comboCurCode + '/software-versions/unlock', { source_type: 'project_doc', doc_id: docId });
    showToast('已恢复自动最新', 'success');
    closeSharedDialog();
    EventBus.emit(EVENTS.PROJECT_DOC_SAVED, {});
  } catch(e) { showToast('操作失败: ' + (e.message || ''), 'error'); }
}

function removeOptionalDoc(docId, docName) {
  var label = docName || ('#' + docId);
  openDialog('移除可选项',
    '<div class="confirm-dlg">确认移除文档 <b>' + escHtml(label) + '</b>？<br><br>移除后文档将不再显示，也不计入完成统计。<br><br>如需恢复，可在"导入模板文档"中重新导入。</div>',
    [{text: '取消', onclick: 'closeSharedDialog()'},
     {text: '确认移除', cls: 'btn-danger', onclick: 'closeSharedDialog();_confirmRemoveDoc(' + docId + ',\x27' + escJs(label) + '\x27)'}],
    {hideClose: true});
}

async function deleteOrphanDoc(docId, docName) {
  var label = docName || ('#' + docId);
  openDialog('删除文档',
    '<div class="confirm-dlg">确认<strong>永久删除</strong>文档 <b>' + escHtml(label) + '</b>？<br><br><span style="color:var(--danger)">此操作不可恢复。</span></div>',
    [{text: '取消', onclick: 'closeSharedDialog()'},
     {text: '确认删除', cls: 'btn-danger', onclick: 'closeSharedDialog();_confirmDeleteOrphanDoc(' + docId + ',\x27' + escJs(label) + '\x27)'}],
    {hideClose: true});
}

async function _confirmDeleteOrphanDoc(docId, docName) {
  try {
    await API.del('/projects/' + _comboCurCode + '/documents/' + docId);
    showToast('文档「' + docName + '」已删除', 'success');
    EventBus.emit(EVENTS.PROJECT_DOC_DELETED, {});
  } catch(e) {
    showToast('删除失败: ' + (e.message || ''), 'error');
  }
}
async function _confirmRemoveDoc(docId, docName) {
  var ok = await verifyPassword('移除文档: ' + (docName || '#' + docId), 'skip_doc_remove');
  if (!ok) return;
  try {
    await API.put('/projects/' + _comboCurCode + '/documents/' + docId, { is_removed: 1 });
    showToast('已移除可选项', 'success');
    EventBus.emit(EVENTS.PROJECT_DOC_SAVED, {});
  } catch(e) { showToast('移除失败: ' + (e.message || ''), 'error'); }
}

function refreshDocs() {
  if (!_comboCurCode) return;
  API.get('/projects/' + _comboCurCode + '/documents').then(function(data) {
    buildDocs(data);
  });
}

/* ── Import Template Docs ── */

function importTemplateDocs() {
  if (!_comboCurCode) return;
  API.get('/projects/' + _comboCurCode + '/documents?include_removed=1').then(function(data) {
    var stageList = (data && data.documents) ? data.documents : [];
    var hasRemoved = false;
    var rows = '';
    stageList.forEach(function(stage) {
      var items = stage.documents || [];
      items.forEach(function(d) {
        var isRemoved = d.is_removed;
        if (isRemoved) hasRemoved = true;
        rows += '<tr><td><input type="checkbox" value="' + d.id + '" data-removed="' + (isRemoved ? '1' : '0') + '"' + (isRemoved ? '' : ' checked disabled') + '></td>' +
          '<td style="font-size:11px;color:var(--muted)">' + escHtml(stage.stage_name || '') + '</td>' +
          '<td>' + escHtml(d.doc_name) + '</td>' +
          '<td>' + (isRemoved ? '<span style="color:var(--danger)">已删除</span>' : '已导入') + '</td></tr>';
      });
    });

    var html = '<div style="max-height:400px;overflow-y:auto"><table class="proj-table"><thead><tr><th style="width:30px">选</th><th>阶段</th><th>文档名</th><th>状态</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    if (hasRemoved) {
      html += '<div style="margin-top:8px;font-size:11px;color:var(--warn)">已删除的文档可勾选后强制重新导入</div>';
    }

    openDialog('导入模板文档', html, [
      {text: '取消', onclick: 'closeSharedDialog()'},
      {text: '确认导入', cls: 'btn-primary', onclick: 'doImportTemplateDocs()'}
    ], {maxWidth: 600});
  }).catch(function(e) { showToast('加载失败: ' + (e.message || ''), 'error'); });
}

function doImportTemplateDocs() {
  var cbs = document.querySelectorAll('.shared-dialog-overlay input[type=checkbox]:checked');
  var ids = [];
  cbs.forEach(function(cb) { ids.push(parseInt(cb.value)); });
  if (!ids.length) { showToast('请选择要导入的文档', 'error'); return; }
  API.post('/projects/' + _comboCurCode + '/documents/sync', {doc_ids: ids}).then(function(r) {
    showToast(r.message || '导入完成', 'success');
    closeSharedDialog();
    EventBus.emit(EVENTS.PROJECT_DOC_SAVED, {});
  }).catch(function(e) { showToast('导入失败: ' + (e.message || ''), 'error'); });
}

/* ── Add Custom Document ── */

function addCustomDoc() {
  if (!_comboCurCode) return;
  var stages = [];
  // Get standard stages from last loaded docs data
  var inp = 'width:100%;box-sizing:border-box;margin-top:2px';
  var html = '<div style="display:flex;flex-direction:column;gap:10px">' +
    '<div><label style="font-size:11px;color:var(--muted)">文档名称</label><input class="search-inp" id="custom-doc-name" style="' + inp + '" placeholder="如：硬件测试报告"></div>' +
    '<div><label style="font-size:11px;color:var(--muted)">所属阶段</label><select class="search-inp" id="custom-doc-stage" style="' + inp + '"></select></div>' +
    '<div><label style="font-size:11px;color:var(--muted)">文档类型</label><select class="search-inp" id="custom-doc-type" style="' + inp + '"><option value="">PMA内部</option><option value="gitlab">GitLab</option><option value="svn">SVN</option><option value="nas">NAS</option><option value="solidworks">结构设计</option></select></div>' +
    '<div><label style="font-size:11px;color:var(--muted)">文档路径/链接</label><input class="search-inp" id="custom-doc-location" style="' + inp + '" placeholder="如：http://..."></div>' +
  '</div>';

  openDialog('新增文档', html, [
    {text: '取消', onclick: 'closeSharedDialog()'},
    {text: '添加', cls: 'btn-primary', onclick: 'submitCustomDoc()'}
  ], {maxWidth: 500});

  // Load stage options
  API.get('/projects/' + _comboCurCode + '/documents').then(function(data) {
    var sel = document.getElementById('custom-doc-stage');
    var stageList = (data && data.documents) ? data.documents : [];
    stageList.forEach(function(stage) {
      sel.innerHTML += '<option value="' + escHtml(stage.stage_name || '') + '">' + escHtml(stage.stage_name || '') + '</option>';
    });
  });
}

function submitCustomDoc() {
  var name = document.getElementById('custom-doc-name').value.trim();
  var stage = document.getElementById('custom-doc-stage').value;
  var docType = document.getElementById('custom-doc-type').value;
  var location = document.getElementById('custom-doc-location').value.trim();
  if (!name) { showToast('请输入文档名称', 'error'); return; }
  if (!stage) { showToast('请选择所属阶段', 'error'); return; }
  API.post('/projects/' + _comboCurCode + '/documents/add', {
    doc_name: name, stage_type: stage, doc_type: docType,
    location: location, is_optional: true
  }).then(function(r) {
    showToast(r.message || '文档已添加', 'success');
    closeSharedDialog();
    EventBus.emit(EVENTS.PROJECT_DOC_SAVED, {});
  }).catch(function(e) { showToast('添加失败: ' + (e.message || ''), 'error'); });
}

/* Delivery */

function _hasProjectEditPerm() {
  var user = getCurrentUser();
  var perms = (user && user.permissions) ? user.permissions.split(',') : [];
  return perms.indexOf('admin') >= 0 || perms.indexOf('project_edit') >= 0;
}

/* ── 板卡 (DeliveryBoard) ── */

function _hasBoardPerm() {
  var user = getCurrentUser();
  var perms = (user && user.permissions) ? user.permissions.split(',') : [];
  return perms.indexOf('admin') >= 0 || perms.indexOf('board_manage') >= 0;
}

function _canManageBoard(board) {
  if (!board) return false;
  var user = getCurrentUser();
  if (!user) return false;
  return _hasProjectEditPerm() || user.username === board.owner;
}

var _boardMetaData = { statuses: [], manual_targets: [], schema: {}, repair_statuses: [] };
var _boardFilterProduct = '';
var _boardFilterStatus = '';
var _boardStatusBoardId = null;

var _BOARD_PILL_CLASS = {
  '在库': 'bd-stock',
  '生产中': 'bd-prod', '研发调试': 'bd-prod', '硬件上电': 'bd-prod',
  '测试': 'bd-prod', '三防': 'bd-prod', '装配': 'bd-prod',
  '已交付': 'bd-delivered',
  '维修中': 'bd-repairing',
  '已维修': 'bd-repaired',
  '已报废': 'bd-scrapped',
};
var _BOARD_PILL_COLORS = {
  '在库': 'var(--muted)',
  '生产中': 'var(--accent)', '研发调试': 'var(--accent)', '硬件上电': 'var(--accent)',
  '测试': 'var(--accent)', '三防': 'var(--accent)', '装配': 'var(--accent)',
  '已交付': 'var(--success)',
  '维修中': 'var(--warn)',
  '已维修': 'var(--success)',
  '已报废': 'var(--danger)',
};

function _boardPill(status, onClick, title, fx) {
  var cls = _BOARD_PILL_CLASS[status] || 'pending';
  var s = '<span class="pill ' + cls + (fx ? ' ' + fx : '') + '"';
  if (onClick) s += ' style="cursor:pointer" onclick="' + onClick + '"';
  if (title) s += ' title="' + escHtml(title) + '"';
  s += '>' + escHtml(status) + '</span>';
  return s;
}

function _boardById(id) {
  if (!_deliveryData || !_deliveryData.boards) return null;
  return _deliveryData.boards.find(function(b) { return b.id === id; }) || null;
}

function _buildBoardCard(boards, meta) {
  _boardMetaData = meta || _boardMetaData;
  var canWrite = _hasBoardPerm();
  var btnHtml = '';
  if (canWrite) {
    btnHtml = '<div style="display:flex;gap:8px">' +
      '<button class="btn btn-primary" style="font-size:11px;padding:3px 10px" onclick="showBoardBatchDialog()">+ 产品录入</button>' +
      '</div>';
  }
  // 状态筛选：完整状态目录；产品筛选：已建档板卡的产品集合
  var statusOpts = (_boardMetaData.statuses || []).map(function(s) {
    return '<option value="' + escHtml(s) + '"' + (s === _boardFilterStatus ? ' selected' : '') + '>' + escHtml(s) + '</option>';
  }).join('');
  var prodSet = [];
  var seenP = {};
  boards.forEach(function(b) {
    var c = b.product_code || '';
    if (c && !seenP[c]) { seenP[c] = 1; prodSet.push(c); }
  });
  var prodOpts = prodSet.map(function(c) {
    return '<option value="' + escHtml(c) + '"' + (c === _boardFilterProduct ? ' selected' : '') + '>' + escHtml(c) + '</option>';
  }).join('');
  return '<div class="card" style="padding:20px;min-width:0">' +
    '<div class="section-hd">' +
      '<div class="section-title">产品列表 <span style="font-size:11px;color:var(--muted)">(' + boards.length + ')</span></div>' +
      '<div style="display:flex;gap:10px;align-items:center;white-space:nowrap">' +
        '<label style="font-size:11px;color:var(--muted)">产品型号</label>' +
        '<select id="board-filter-product" class="search-inp" onchange="_boardFilterProduct=this.value;_applyBoardFilters()" style="padding:5px 8px;max-width:200px"><option value="">全部</option>' + prodOpts + '</select>' +
        '<label style="font-size:11px;color:var(--muted)">状态</label>' +
        '<select id="board-filter-status" class="search-inp" onchange="_boardFilterStatus=this.value;_applyBoardFilters()" style="padding:5px 8px;max-width:150px"><option value="">全部</option>' + statusOpts + '</select>' +
        btnHtml +
      '</div>' +
    '</div>' +
    (boards.length ? '<div id="board-table-container"></div>' : '<div class="empty-state" style="padding:20px">暂无产品，点击上方按钮录入</div>') +
    '</div>';
}

function _renderBoardTable(boards) {
  var el = document.getElementById('board-table-container');
  if (!el) return;
  var canProjectEdit = _hasProjectEditPerm();
  // 按产品型号分组排序，保证同型号相邻，供产品型号列 rowspan 合并
  boards = boards.slice().sort(function(a, b) {
    var ca = a.product_code || '', cb = b.product_code || '';
    if (ca !== cb) return ca < cb ? -1 : 1;
    return String(a.serial_no || '').localeCompare(String(b.serial_no || ''));
  });
  var cols = [
    { key: 'product_code', title: '产品型号', minWidth: 130, rowspan: true, render: function(v, row, idx, span) {
      // 产品名称不再单独列，悬浮在型号按钮上以 title 提示呈现
      var btn = v ? '<span class="proj-code-btn" style="font-size:11px;padding:2px 8px" onclick="event.stopPropagation();openProductDetail(\'' + escHtml(v) + '\')" title="' + escHtml((v || '') + (row.product_name ? ' ' + row.product_name : '')) + '">' + escHtml(v) + '</span>'
                  : '<span style="font-size:12px;color:var(--muted)">—</span>';
      return btn + (span > 1 ? ' <span style="font-size:10px;color:var(--muted)">(' + span + ')</span>' : '');
    }},
    { key: 'serial_no', title: '产品编号', minWidth: 140, render: function(v, row) { return '<span class="proj-code-btn" style="font-family:var(--mono);font-size:12px;padding:2px 8px" onclick="event.stopPropagation();showBoardTimeline(' + row.id + ')" title="查看时间线">' + escHtml(v) + '</span>'; } },
    { key: 'status', title: '状态流转', minWidth: 240, render: function(v, row) {
      var prevPill = row.prev_status
        ? '<span class="pill ' + (_BOARD_PILL_CLASS[row.prev_status] || 'pending') + ' fx4" style="opacity:.72">' + escHtml(row.prev_status) + '</span>'
        : '<span class="pill pending fx4">系统初始</span>';
      var canSwitch = _canManageBoard(row) && row.status !== '维修中';
      var curPill = _boardPill(v, canSwitch ? 'showBoardStatusDialog(' + row.id + ')' : '', canSwitch ? '点击切换状态' : '维修状态需通过维修 Bug 流转', 'fx4');
      return '<div style="display:flex;align-items:center;gap:5px;flex-wrap:nowrap;white-space:nowrap">' + prevPill + '<span style="color:var(--muted);font-size:11px">→</span>' + curPill + '</div>';
    }},
    { key: 'owner', title: '人员流转', minWidth: 190, render: function(v, row) {
      var prevOwner = row.prev_owner ? (_userDisplayMap[row.prev_owner] || row.prev_owner) : '';
      var prevSpan = prevOwner
        ? '<span class="pill person fx3" style="opacity:.72">' + escHtml(prevOwner) + '</span>'
        : '<span class="pill person fx3">系统</span>';
      var curSpan = '<span class="pill person-cur fx3">' + escHtml(_userDisplayMap[v] || v || '—') + '</span>';
      return '<div style="display:flex;align-items:center;gap:5px;flex-wrap:nowrap;white-space:nowrap">' + prevSpan + '<span style="color:var(--muted);font-size:11px">→</span>' + curSpan + '</div>';
    }},
    { key: 'current_holder', title: '当前持有人', minWidth: 110, render: function(v) { return '<span style="font-size:12px;color:var(--muted)">' + escHtml(_userDisplayMap[v] || v || '—') + '</span>'; } },
    { key: 'updated_at', title: '最近更新', minWidth: 120, render: function(v) { return '<span style="font-size:11px;color:var(--muted)">' + (v ? fmtISODateTime(v) : '—') + '</span>'; } },
    { key: 'actions', title: '操作', width: '120px', minWidth: 120, render: function(v, row) {
      var h = '<button class="btn btn-icon" onclick="showBoardTimeline(' + row.id + ')" title="查看时间线">' +
        '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5"/><path d="M9 2l3 3 3-3"/></svg></button>';
      if (_canManageBoard(row)) h += iconEdit('showBoardForm(' + row.id + ')', '编辑');
      if (canProjectEdit) h += iconDelete('deleteBoard(' + row.id + ')', '删除');
      return h;
    }},
  ];
  new DataTable({ container: el, columns: cols, data: boards, maxHeight: '400px', density: 'compact', emptyText: '无匹配产品' });
  if (window._deliveryHighlightBoard) _highlightBoardRow(window._deliveryHighlightBoard);
}

/* 从 Bug 详情跳转时，在产品列表中定位到对应板卡行并高亮闪烁 */
function _highlightBoardRow(serialNo) {
  var serial = String(serialNo || '');
  if (!serial || !_deliveryData || !_deliveryData.boards) return;
  var board = null;
  for (var i = 0; i < _deliveryData.boards.length; i++) {
    if (String(_deliveryData.boards[i].serial_no) === serial) { board = _deliveryData.boards[i]; break; }
  }
  if (!board) return;
  var tr = document.querySelector('#board-table-container tr[data-row-id="' + board.id + '"]');
  if (!tr) return;
  var prev = document.querySelector('#board-table-container tr.hl-board');
  if (prev) prev.classList.remove('hl-board');
  tr.classList.add('hl-board');
  // 滚动到目标行居中可见（表格有 maxHeight，需滚到 .dt-scroll 容器内）
  var scrollEl = document.querySelector('#board-table-container .dt-scroll');
  if (scrollEl) {
    var rowTopInScroll = tr.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop;
    scrollEl.scrollTop = Math.max(0, rowTopInScroll - scrollEl.clientHeight / 2);
  }
  // 高亮闪烁后自动消退
  setTimeout(function() { tr.classList.remove('hl-board'); }, 3000);
  window._deliveryHighlightBoard = null;  // 只定位一次
}

function _applyBoardFilters() {
  if (!_deliveryData || !_deliveryData.boards) return;
  // 从 Bug 详情跳转定位板卡时，先重置筛选，确保目标行可见
  if (window._deliveryHighlightBoard) {
    _boardFilterProduct = '';
    _boardFilterStatus = '';
    var sp = document.getElementById('board-filter-product'), ss = document.getElementById('board-filter-status');
    if (sp) sp.value = '';
    if (ss) ss.value = '';
  }
  var boards = _deliveryData.boards.filter(function(b) {
    if (_boardFilterProduct && (b.product_code || '') !== _boardFilterProduct) return false;
    if (_boardFilterStatus && b.status !== _boardFilterStatus) return false;
    return true;
  });
  _renderBoardTable(boards);
}

/* 产品编号起始值 + 数量 → 递增尾部数字段生成产品编号（无数字段追加计数） */
function _expandSerialRange(startNo, count) {
  var result = [];
  startNo = (startNo || '').trim();
  if (!startNo || count < 1) return result;
  var m = /^(.*?)(\d+)([^\d]*)$/.exec(startNo);
  for (var i = 0; i < count; i++) {
    if (m) {
      var width = m[2].length;
      var serial = m[1] + String(parseInt(m[2], 10) + i).padStart(width, '0') + m[3];
      result.push(serial);
    } else {
      result.push(startNo + '-' + String(i + 1).padStart(2, '0'));
    }
  }
  return result;
}

function showBoardBatchDialog() {
  var products = _projectProducts || [];
  var prodOptions = products.map(function(p) {
    return '<option value="' + escHtml(p.code || '') + '">' + escHtml((p.code ? p.code + ' ' : '') + (p.name || '')) + '</option>';
  }).join('');
  var emptyLabel = products.length ? '— 请选择产品 —' : '— 本项目无关联产品 —';
  var html =
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:8px 0">' +
      '<div style="grid-column:1/-1"><label style="font-size:11px;color:var(--muted)">产品型号 <span style="color:var(--danger)">*</span></label>' +
        '<select class="search-inp" id="bb-product" style="margin-top:4px"><option value="">' + emptyLabel + '</option>' + prodOptions + '</select>' +
        '<div style="font-size:10.5px;color:var(--muted);margin-top:3px">选择本项目关联产品，产品型号/名称自动带出</div></div>' +
      '<div><label style="font-size:11px;color:var(--muted)">产品编号起始值 <span style="color:var(--danger)">*</span></label>' +
        '<input class="search-inp" id="bb-start" placeholder="如 PCBA-001" oninput="_refreshBoardBatchPreview()" style="margin-top:4px"></div>' +
      '<div><label style="font-size:11px;color:var(--muted)">数量 <span style="color:var(--danger)">*</span> <span style="color:var(--muted)">(≤50)</span></label>' +
        '<input class="search-inp" id="bb-count" type="number" min="1" max="50" value="1" oninput="_refreshBoardBatchPreview()" style="margin-top:4px"></div>' +
    '</div>' +
    '<div style="margin-top:4px;font-size:11px;color:var(--muted)">自动递增产品编号尾部数字段，预览：</div>' +
    '<div id="bb-preview" style="margin-top:6px;max-height:170px;overflow-y:auto;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:8px;font-family:var(--mono);font-size:11px;line-height:1.7"></div>';
  openDialog('产品录入', html, [
    { text: '取消', onclick: 'closeSharedDialog()' },
    { text: '录入', cls: 'btn-primary', onclick: function() { _submitBoardBatch(); } },
  ], { maxWidth: 520 });
}

function _refreshBoardBatchPreview() {
  var start = (document.getElementById('bb-start') || {}).value || '';
  var count = parseInt((document.getElementById('bb-count') || {}).value) || 1;
  var el = document.getElementById('bb-preview');
  if (!el) return;
  var list = _expandSerialRange(start, count);
  if (!list.length) { el.innerHTML = '<span style="color:var(--muted)">请输入产品编号起始值</span>'; return; }
  if (list.length > 50) { el.innerHTML = '<span style="color:var(--danger)">单次最多录入 50 块板卡</span>'; return; }
  el.innerHTML = list.map(function(s) { return '<div>' + escHtml(s) + '</div>'; }).join('');
}

async function _submitBoardBatch() {
  var start = (document.getElementById('bb-start') || {}).value || '';
  var count = parseInt((document.getElementById('bb-count') || {}).value) || 0;
  var list = _expandSerialRange(start, count);
  if (!list.length) { showToast('请填写产品编号起始值', 'error'); return; }
  if (list.length > 50) { showToast('单次最多录入 50 块板卡', 'error'); return; }
  var selCode = (document.getElementById('bb-product') || {}).value || '';
  var selName = _productName(selCode);
  if (!selCode) { showToast('请选择产品型号', 'error'); return; }
  try {
    var res = await API.post('/delivery/projects/' + _comboCurCode + '/boards/batch', {
      serial_numbers: list,
      product_code: selCode,
      product_name: selName,
    });
    var data = res.data || res;
    var dup = (data.duplicated || []).length;
    var msg = '成功录入 ' + (data.created || []).length + ' 块板卡' + (dup ? '，' + dup + ' 个产品编号已存在' : '');
    showToast(msg, dup && dup >= (data.created || []).length ? 'warn' : 'success');
    document.querySelectorAll('.shared-dialog-overlay').forEach(function(o) { o.remove(); });
    EventBus.emit(EVENTS.BOARD_CHANGED, {});
  } catch(e) {
    showToast('录入失败: ' + (e.message || ''), 'error');
  }
}

function _productName(code) {
  if (!code) return '';
  var matched = (_projectProducts || []).filter(function(p) { return p.code === code; })[0];
  return matched ? (matched.name || '') : '';
}

function showBoardForm(boardId) {
  var board = boardId ? _boardById(boardId) : null;
  var isEdit = !!board;
  var curCode = board ? (board.product_code || '') : '';
  var curName = board ? (board.product_name || '') : '';
  var products = _projectProducts || [];
  var prodOptions = products.map(function(p) {
    var sel = (curCode === p.code) ? ' selected' : '';
    return '<option value="' + escHtml(p.code || '') + '"' + sel + '>' + escHtml((p.code ? p.code + ' ' : '') + (p.name || '')) + '</option>';
  }).join('');
  // 编辑时若当前产品不在项目关联列表，回填到选项首位，避免误清空
  if (curCode && !products.some(function(p) { return p.code === curCode; })) {
    prodOptions = '<option value="' + escHtml(curCode) + '" selected>' + escHtml(curCode + ' ' + curName) + '</option>' + prodOptions;
  }
  var emptyLabel = products.length ? '— 请选择产品 —' : '— 本项目无关联产品 —';
  var html =
    '<div style="display:grid;grid-template-columns:1fr;gap:12px;padding:8px 0">' +
      '<div><label style="font-size:11px;color:var(--muted)">产品编号 <span style="color:var(--danger)">*</span></label>' +
        '<input class="search-inp" id="bf-serial" value="' + escHtml(board ? (board.serial_no || '') : '') + '" style="margin-top:4px"></div>' +
      '<div><label style="font-size:11px;color:var(--muted)">产品型号' + (isEdit ? '' : ' <span style="color:var(--danger)">*</span>') + '</label>' +
        '<select class="search-inp" id="bf-product" style="margin-top:4px"><option value="">' + emptyLabel + '</option>' + prodOptions + '</select>' +
        '<div style="font-size:10.5px;color:var(--muted);margin-top:3px">选择本项目关联产品，产品型号/名称自动带出</div></div>' +
      '<div><label style="font-size:11px;color:var(--muted)">备注</label>' +
        '<textarea class="search-inp" id="bf-note" rows="2" style="margin-top:4px">' + escHtml(board ? (board.note || '') : '') + '</textarea></div>' +
    '</div>';
  openDialog(isEdit ? '编辑板卡' : '新增板卡', html, [
    { text: '取消', onclick: 'closeSharedDialog()' },
    { text: isEdit ? '保存' : '创建', cls: 'btn-primary', onclick: function() { _submitBoardForm(boardId); } },
  ], { maxWidth: 480 });
}

async function _submitBoardForm(boardId) {
  var serial = (document.getElementById('bf-serial') || {}).value || '';
  if (!serial.trim()) { showToast('产品编号不能为空', 'error'); return; }
  var selCode = (document.getElementById('bf-product') || {}).value || '';
  var selName = _productName(selCode);
  if (!boardId && !selCode) { showToast('请选择产品型号', 'error'); return; }
  // 编辑时若选择的是回填的存量产品（不在关联列表），用板卡原产品名称
  if (!selName && boardId) {
    var b = _boardById(boardId);
    if (b && b.product_code === selCode) selName = b.product_name || '';
  }
  var body = {
    serial_no: serial.trim(),
    product_code: selCode,
    product_name: selName,
    note: (document.getElementById('bf-note') || {}).value || '',
  };
  try {
    if (boardId) {
      await API.put('/delivery/boards/' + boardId, body);
      showToast('板卡已更新', 'success');
    } else {
      await API.post('/delivery/projects/' + _comboCurCode + '/boards', body);
      showToast('板卡已建档', 'success');
    }
    document.querySelectorAll('.shared-dialog-overlay').forEach(function(o) { o.remove(); });
    EventBus.emit(EVENTS.BOARD_CHANGED, {});
  } catch(e) {
    showToast(e.message || '操作失败', 'error');
  }
}

/* 状态切换：目标状态 schema 由后端 meta 动态驱动 */
function showBoardStatusDialog(boardId) {
  var board = _boardById(boardId);
  if (!board) return;
  if (board.status === '维修中') { showToast('维修状态需通过维修 Bug 流转', 'warn'); return; }
  _boardStatusBoardId = boardId;
  // 允许选择当前状态（用于同状态下归属人变更）；后端校验「状态+归属人均未变化」时拒绝
  var targets = (_boardMetaData.manual_targets || []);
  var targetOptions = targets.map(function(s) {
    return '<option value="' + escHtml(s) + '"' + (s === board.status ? ' selected' : '') + '>' + escHtml(s) + (s === board.status ? '（保持不变）' : '') + '</option>';
  }).join('');
  var html =
    '<div style="padding:8px 0">' +
      '<div style="display:flex;gap:10px;align-items:center;margin-bottom:12px">' +
        '<label style="font-size:11px;color:var(--muted)">当前状态</label>' +
        '<span>' + _boardPill(board.status) + '</span>' +
      '</div>' +
      '<label style="font-size:11px;color:var(--muted)">切换至 <span style="color:var(--danger)">*</span></label>' +
      '<select class="search-inp" id="bs-target" style="margin-top:4px" onchange="_renderBoardSchemaFields(this.value)">' +
        '<option value="">— 请选择目标状态 —</option>' + targetOptions +
      '</select>' +
      '<div style="font-size:10.5px;color:var(--muted);margin-top:3px">状态与归属人均未变化时无法切换（同状态仅用于变更归属人）</div>' +
      '<div id="bs-fields" style="margin-top:12px"></div>' +
    '</div>';
  openDialog('状态切换 — ' + board.serial_no, html, [
    { text: '取消', onclick: 'closeSharedDialog()' },
    { text: '确认切换', cls: 'btn-primary', onclick: function() { _submitBoardStatus(); } },
  ], { maxWidth: 480 });
}

function _renderBoardSchemaFields(target) {
  var el = document.getElementById('bs-fields');
  if (!el) return;
  if (!target) { el.innerHTML = ''; return; }
  var fields = (_boardMetaData.schema && _boardMetaData.schema[target]) || [];
  el.innerHTML = fields.map(function(f) { return _boardSchemaFieldHtml(f); }).join('');
  // 默认：操作人=当前用户
  var operator = document.getElementById('bsf-operator');
  var user = getCurrentUser() || {};
  if (operator && user.username) operator.value = user.username;
}

function _boardSchemaFieldHtml(f) {
  var label = '<label style="font-size:11px;color:var(--muted)">' + escHtml(f.label) + (f.required ? ' <span style="color:var(--danger)">*</span>' : '') + '</label>';
  var id = 'bsf-' + f.key;
  var inp = '';
  if (f.type === 'date') {
    inp = '<input class="search-inp" id="' + id + '" type="date" value="' + fmtLocalDate() + '" style="margin-top:4px">';
  } else if (f.type === 'textarea') {
    inp = '<textarea class="search-inp" id="' + id + '" rows="2" style="margin-top:4px"></textarea>';
  } else if (f.type === 'select') {
    var opts = (f.options || []).map(function(o) { return '<option value="' + escHtml(o) + '">' + escHtml(o) + '</option>'; }).join('');
    inp = '<select class="search-inp" id="' + id + '" style="margin-top:4px"><option value="">— 请选择 —</option>' + opts + '</select>';
  } else if (f.type === 'user_select' && f.key === 'operator') {
    // 操作人：不可修改，自动填入当前登录人
    var cur = getCurrentUser() || {};
    inp = '<div style="margin-top:4px;padding:6px 10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;font-size:12px;color:var(--muted)">' +
      escHtml(cur.display_name || cur.username || '') + '（当前登录人，不可修改）</div>' +
      '<input type="hidden" id="' + id + '" value="' + escHtml(cur.username || '') + '">';
  } else if (f.type === 'user_select') {
    inp = _userSearchFieldHtml(f);
  } else {
    inp = '<input class="search-inp" id="' + id + '" style="margin-top:4px">';
  }
  return '<div style="margin-bottom:10px">' + label + inp + '</div>';
}

/* 用户搜索输入框（user_select 字段：转交给谁/归属人/交付责任人） */
function _userSearchFieldHtml(f) {
  var key = f.key;
  return '<div style="position:relative;margin-top:4px">' +
    '<input class="search-inp" id="bs-us-' + key + '-input" placeholder="搜索姓名/账号..." autocomplete="off" ' +
      'onfocus="_userSearchOpen(\'' + key + '\')" oninput="_userSearchOpen(\'' + key + '\')" ' +
      'onblur="setTimeout(function(){_userSearchClose(\'' + key + '\')},150)">' +
    '<span id="bs-us-' + key + '-chip" style="display:none;position:absolute;right:9px;top:50%;transform:translateY(-50%);cursor:pointer;font-size:13px;color:var(--muted)" title="清除选择" onmousedown="event.preventDefault();_userSearchClear(\'' + key + '\')">&times;</span>' +
    '<div id="bs-us-' + key + '-drop" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:30;background:var(--surface);border:1px solid var(--border);border-radius:6px;max-height:180px;overflow-y:auto;box-shadow:0 4px 12px rgba(0,0,0,.12)"></div>' +
    '<input type="hidden" id="bsf-' + key + '">' +
  '</div>';
}

function _userSearchOpen(fkey) {
  var drop = document.getElementById('bs-us-' + fkey + '-drop');
  var input = document.getElementById('bs-us-' + fkey + '-input');
  if (!drop) return;
  var kw = (input ? input.value : '').trim().toLowerCase();
  var list = (_userOptions || []).filter(function(u) {
    if (!kw) return true;
    return String(u.code || '').toLowerCase().indexOf(kw) >= 0 ||
           String(u.name || '').toLowerCase().indexOf(kw) >= 0;
  });
  if (!list.length) {
    drop.innerHTML = '<div style="padding:7px 10px;font-size:11px;color:var(--muted)">无匹配用户</div>';
    drop.style.display = '';
    return;
  }
  drop.innerHTML = list.map(function(u) {
    var code = escHtml(String(u.code || '')).replace(/'/g, "\\'");
    var name = escHtml(String(u.name || u.code || '')).replace(/'/g, "\\'");
    return '<div style="padding:6px 10px;cursor:pointer;font-size:12px;display:flex;justify-content:space-between;gap:8px" ' +
      'onmousedown="event.preventDefault();_userSearchPick(\'' + fkey + '\',\'' + code + '\',\'' + name + '\')">' +
      '<span>' + escHtml(u.name || u.code) + '</span>' +
      '<span style="color:var(--muted);font-size:10px">' + escHtml(u.code) + '</span>' +
    '</div>';
  }).join('');
  drop.style.display = '';
}

function _userSearchPick(fkey, code, name) {
  var hidden = document.getElementById('bsf-' + fkey);
  var input = document.getElementById('bs-us-' + fkey + '-input');
  var chip = document.getElementById('bs-us-' + fkey + '-chip');
  if (hidden) hidden.value = code;
  if (input) input.value = name;
  if (chip) chip.style.display = '';
  _userSearchClose(fkey);
}

function _userSearchClear(fkey) {
  var hidden = document.getElementById('bsf-' + fkey);
  var input = document.getElementById('bs-us-' + fkey + '-input');
  var chip = document.getElementById('bs-us-' + fkey + '-chip');
  if (hidden) hidden.value = '';
  if (input) input.value = '';
  if (chip) chip.style.display = 'none';
}

function _userSearchClose(fkey) {
  var drop = document.getElementById('bs-us-' + fkey + '-drop');
  if (drop) drop.style.display = 'none';
}

function _submitBoardStatus() {
  var boardId = _boardStatusBoardId;
  var target = (document.getElementById('bs-target') || {}).value;
  if (!target) { showToast('请选择目标状态', 'error'); return; }
  var fields = (_boardMetaData.schema && _boardMetaData.schema[target]) || [];
  var data = {};
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    var val = ((document.getElementById('bsf-' + f.key) || {}).value || '').trim();
    if (f.required && !val) { showToast(f.label + '为必填项', 'error'); return; }
    if (val) data[f.key] = val;
  }
  // 操作人恒为当前登录人（防篡改兜底）
  if (fields.some(function(f) { return f.key === 'operator'; })) {
    var cur = getCurrentUser() || {};
    if (cur.username) data.operator = cur.username;
  }
  API.post('/delivery/boards/' + boardId + '/status', { to_status: target, data: data })
    .then(function(res) {
      showToast('状态已切换至「' + target + '」', 'success');
      document.querySelectorAll('.shared-dialog-overlay').forEach(function(o) { o.remove(); });
      EventBus.emit(EVENTS.BOARD_CHANGED, {});
    })
    .catch(function(e) { showToast(e.message || '切换失败', 'error'); });
}

/* 时间线 */
function showBoardTimeline(boardId) {
  openDialog('板卡时间线', '<div id="bt-body" style="color:var(--muted);font-size:12px;padding:8px 0">加载中...</div>', [], { maxWidth: 560, maxHeight: '70vh' });
  _loadBoardTimeline(boardId, 'desc');
}

async function _loadBoardTimeline(boardId, order) {
  try {
    var resp = await API.get('/delivery/boards/' + boardId + '/timeline?order=' + order);
    var data = resp || {};  // API.get 已解包 json.data → {board, events}
    var board = data.board || {};
    var bodyEl = document.getElementById('bt-body');
    if (!bodyEl) return;
    var titleEl = document.querySelector('.note-dialog-title');
    if (titleEl) titleEl.textContent = '板卡时间线 — ' + (board.serial_no || '');
    var orderBtn = '<button class="btn" style="font-size:11px;padding:2px 8px" onclick="_loadBoardTimeline(' + boardId + ',\'' + (order === 'asc' ? 'desc' : 'asc') + '\')">' + (order === 'desc' ? '最新在前 ↓' : '最早在前 ↑') + '</button>';
    var header =
      '<div style="display:flex;gap:10px;align-items:center;margin-bottom:10px;font-size:12px;flex-wrap:wrap">' +
        '<span>当前状态: ' + _boardPill(board.status) + '</span>' +
        '<span style="color:var(--muted)">归属人: ' + escHtml(_userDisplayMap[board.owner] || board.owner || '—') + '</span>' +
        orderBtn +
      '</div>';
    bodyEl.innerHTML = header + _boardTimelineHtml(data.events || []);
  } catch(e) {
    var bodyEl = document.getElementById('bt-body');
    if (bodyEl) bodyEl.innerHTML = '<div style="color:var(--danger);font-size:12px">加载失败: ' + escHtml(e.message) + '</div>';
  }
}

/* 操作时间展示：仅录入日期（date-only，存 UTC 午夜）时只显示日期，
   否则（建档/交付/维修等真实时刻）显示完整本地时间，避免误导性一致的 08:00:00 */
function _boardEventTimeDisplay(iso) {
  if (!iso) return '';
  var m = /T(\d{2}):(\d{2}):(\d{2})/.exec(iso);
  if (m && m[1] === '00' && m[2] === '00' && m[3] === '00') return formatDate(iso);
  return fmtISODateTime(iso);
}

function _boardTimelineHtml(events) {
  if (!events.length) return '<div style="color:var(--muted);font-size:12px">暂无事件</div>';
  var html = '<div style="position:relative;padding-left:24px">' +
    '<div style="position:absolute;left:6px;top:8px;bottom:8px;width:2px;background:var(--border);border-radius:1px"></div>';
  // 最新时间点：插入序 id 最大（id 序=真实时序，event_time 可能 date-only 午夜导致乱序）
  var newestId = events.reduce(function(m, e) { return (e.id || 0) > m ? (e.id || 0) : m; }, 0);
  events.forEach(function(e) {
    var isNewest = e.id === newestId;
    var dotColor = _BOARD_PILL_COLORS[e.to_status] || 'var(--accent)';
    // 最新时间点：圆点用强调色填充 + 光晕突出
    var dot = isNewest
      ? '<span style="position:absolute;left:-24px;top:4px;width:14px;height:14px;border-radius:50%;background:var(--accent);border:2px solid var(--accent);box-shadow:0 0 0 3px color-mix(in srgb, var(--accent) 28%, transparent);box-sizing:border-box;z-index:1"></span>'
      : '<span style="position:absolute;left:-24px;top:4px;width:14px;height:14px;border-radius:50%;background:var(--surface);border:2px solid ' + dotColor + ';box-sizing:border-box;z-index:1"></span>';
    var time = e.event_time ? _boardEventTimeDisplay(e.event_time) : '';
    var migrate = (e.from_status ? _boardPill(e.from_status) + ' <span style="color:var(--muted)">→</span> ' : '') + _boardPill(e.to_status);
    var actor = e.actor ? (_userDisplayMap[e.actor] || e.actor) : '';
    var isBugEvent = !!e.bug_id;
    var d = e.data || {};

    // 第 1 行：时间 + 状态切换（与其他状态事件保持一致）；最新点时间用强调色加粗
    var bodyHtml = '<div style="display:flex;align-items:baseline;gap:6px;font-size:12px;flex-wrap:wrap">' +
      '<span style="font-size:11px;white-space:nowrap;' + (isNewest ? 'color:var(--accent);font-weight:600' : 'color:var(--muted)') + '">' + escHtml(time) + '</span>' +
      migrate +
    '</div>';

    if (isBugEvent) {
      // 第 2 行：报修人 --> 维修人（维修中=责任人；已维修=返修处理人）
      var reporter = d['报修人'] || '';
      var repairer = d['返修处理人'] || d['责任人'] || '';
      if (reporter) {
        bodyHtml += '<div style="margin-top:3px;font-size:11.5px;color:var(--muted)">' +
          '<span style="color:var(--accent);font-weight:600">' + escHtml(_userDisplayMap[reporter] || reporter) + '</span>' +
          ' <span style="color:var(--muted)">→</span> ' +
          '<span style="color:var(--accent);font-weight:600">' + escHtml(_userDisplayMap[repairer] || repairer || '—') + '</span>' +
        '</div>';
      } else if (repairer) {
        // 已维修事件无报修人字段，仅呈现维修人
        bodyHtml += '<div style="margin-top:3px;font-size:11.5px;color:var(--muted)">' +
          '<span style="color:var(--accent);font-weight:600">' + escHtml(_userDisplayMap[repairer] || repairer) + '</span>' +
        '</div>';
      }
      // 第 3 行：bug 编号 + bug 标题（可点击跳转并自动关闭时间线）
      bodyHtml += '<div style="margin-top:3px;font-size:12px">' +
        '<span class="tag-badge tag-1" style="cursor:pointer" onclick="_boardBugJump(' + e.bug_id + ')" title="打开维修 Bug">Bug #' + e.bug_id + '</span>' +
        '<span style="font-size:12px;color:var(--muted);margin-left:6px">' + escHtml(d.bug_title || '') + '</span>' +
      '</div>';
    } else {
      var toHolder = d.to_holder || d['转交给谁'] || '';
      // 第 2 行：生产转交事件显示 转交人 --> 接收人；其余事件显示操作人
      if (toHolder) {
        bodyHtml += '<div style="margin-top:3px;font-size:11.5px;color:var(--muted)">' +
          '<span style="color:var(--accent);font-weight:600">' + escHtml(actor || '—') + '</span>' +
          ' <span style="color:var(--muted)">→</span> ' +
          '<span style="color:var(--accent);font-weight:600">' + escHtml(_userDisplayMap[toHolder] || toHolder) + '</span>' +
        '</div>';
      } else if (actor) {
        bodyHtml += '<div style="margin-top:3px;font-size:11.5px;color:var(--muted)">' + escHtml(actor) + '</div>';
      }
      // 第 3 行：转交/操作时填写的说明内容（没有则不显示）
      if (e.note) {
        bodyHtml += '<div style="margin-top:4px;font-size:12px;color:var(--muted)">' + escHtml(e.note) + '</div>';
      }
      // 其余字段小网格（转交事件已由 转交人→接收人 + 说明 呈现，不再重复展示网格）
      if (!toHolder) {
        bodyHtml += _boardEventDataGrid(d);
      }
    }

    // 最新时间点内容强调：浅色强调底 + 边框圆角
    var newestBox = isNewest
      ? 'background:color-mix(in srgb, var(--accent) 8%, transparent);border:1px solid color-mix(in srgb, var(--accent) 38%, transparent);border-radius:8px;padding:6px 10px;'
      : '';
    html += '<div style="position:relative;padding:4px 0 14px 0">' + dot + '<div style="' + newestBox + '">' + bodyHtml + '</div></div>';
  });
  html += '</div>';
  return html;
}

/* 维修 Bug 跳转：先自动关闭时间线对话框，再导航到 Bug 详情
   （bugs.js 懒加载，不能直接调 openBugDetail；gotoView 会加载并带参初始化） */
function _boardBugJump(bugId) {
  if (typeof closeSharedDialog === 'function') closeSharedDialog();
  gotoView('bugs', { params: [String(bugId)] });
}

/* 事件 data 中存 username 的字段 → 展示中文名（企微） */
var _BOARD_USER_DATA_KEYS = ['to_holder', 'owner', 'operator', 'responsible_person', '转交给谁', '归属人', '交付责任人', '操作人', '责任人', '返修处理人', '报修人'];

function _boardEventDataGrid(data) {
  var keys = Object.keys(data).filter(function(k) { return data[k] !== null && data[k] !== undefined && String(data[k]) !== ''; });
  if (!keys.length) return '';
  var cells = keys.map(function(k) {
    var v = String(data[k]);
    if (_BOARD_USER_DATA_KEYS.indexOf(k) >= 0 && _userDisplayMap[data[k]]) v = _userDisplayMap[data[k]];
    return '<div style="padding:4px 6px;background:var(--bg);border-radius:5px">' +
      '<div style="font-size:10px;color:var(--muted)">' + escHtml(k) + '</div>' +
      '<div style="font-size:11px;margin-top:1px;word-break:break-all">' + escHtml(v) + '</div>' +
    '</div>';
  }).join('');
  return '<div style="margin-top:6px;display:grid;grid-template-columns:1fr 1fr;gap:6px">' + cells + '</div>';
}

async function deleteBoard(boardId) {
  var board = _boardById(boardId);
  if (!board) return;
  if (!confirm('确认删除板卡「' + board.serial_no + '」？其生命周期记录将一并删除。')) return;
  try {
    await API.del('/delivery/boards/' + boardId);
    showToast('板卡已删除', 'success');
    EventBus.emit(EVENTS.BOARD_CHANGED, {});
  } catch(e) {
    showToast(e.message || '删除失败', 'error');
  }
}

function buildDelivery(data) {
  _deliveryData = data;
  var planned = data.planned || 0;
  var delivered = data.total || 0;
  var progress = data.progress || 0;
  var records = data.records || [];
  var productStats = data.product_stats || [];
  var canEdit = _hasProjectEditPerm();

  // Big ring: manual n/m, arc progress from product aggregation
  var bigManualDelivered = data.delivered_manual || 0;
  var bigRingHtml = renderDeliveryRing(bigManualDelivered, planned, 120, {
    label: "总套数",
    showEdit: canEdit,
    editOnclick: "inlineEditPlanQty('total')",
    arcProgress: progress,  // computed from sum(product delivered) / sum(product planned)
  });

  // Small rings: per-product
  // If no product stats yet, auto-initialize from linked products
  var products = _projectProducts || [];
  if (!productStats.length && products.length) {
    // Compute delivered per product from actual records
    var deliveredByProduct = {};
    records.forEach(function(r) {
      if (r.product_code) {
        deliveredByProduct[r.product_code] = (deliveredByProduct[r.product_code] || 0) + (r.qty || 0);
      }
    });
    productStats = products.map(function(p) {
      var d = deliveredByProduct[p.code] || 0;
      var planQty = p.quantity || 0;
      return { product_code: p.code, product_name: p.name, planned_qty: planQty, delivered_qty: d,
        progress: planQty > 0 ? Math.min(100, Math.round(d / planQty * 100)) : 0 };
    });
  }
  var smallRingsHtml = '';
  productStats.forEach(function(ps) {
    smallRingsHtml += renderDeliveryRing(ps.delivered_qty, ps.planned_qty, 74, {
      label: ps.product_code || ps.product_name,
      showEdit: canEdit,
      editOnclick: "inlineEditPlanQty('" + escHtml(ps.product_code) + "')",
    });
  });

  var ringsHtml =
    '<div class="delivery-rings">' +
      bigRingHtml +
      '<div class="delivery-small-rings">' + smallRingsHtml + '</div>' +
    '</div>';

  // 批量交付记录按产品编号拆行后显示的行数（空记录占 1 行）
  var recRowCount = records.reduce(function(n, r) {
    var mcs = (r.material_codes && r.material_codes.length) ? r.material_codes : [''];
    return n + mcs.length;
  }, 0);

  var recHtml = '' +
    '<div class="card" style="padding:20px;min-width:0">' +
      sectionHeader('交付记录明细', recRowCount + ' 条', '+ 添加记录', 'showDeliveryForm()') +
      (records.length ? '<div id="delivery-table"></div>' : '<div class="empty-state" style="padding:20px">暂无交付记录，点击上方按钮添加</div>') +
    '</div>';

  // 产品列表卡片（板卡生命周期 + 交付进度动态）
  var boards = data.boards || [];
  var boardMeta = data.board_meta || {};
  var boardHtml = _buildBoardCard(boards, boardMeta);

  document.getElementById('delivery-content').innerHTML =
    '<div class="card" style="padding:20px">' +
      '<div class="section-title" style="margin-bottom:14px">交付概要</div>' +
      ringsHtml +
      '<div style="margin-top:12px;font-size:10.5px;color:var(--muted)">交付进度按板卡当前状态实时统计：已交付/已维修计入，维修中从已交付中扣减</div>' +
    '</div>' +
    '<div class="delivery-split">' +
      boardHtml +
      recHtml +
    '</div>' +
    '<div id="delivery-form-container"></div>';

  if (boards.length) {
    _applyBoardFilters();
  }

  if (records.length) {
    // 每条交付记录按产品编号拆成单独一行（批量添加的编号各自成行）
    var rows = [];
    records.forEach(function(r) {
      var mcs = (r.material_codes && r.material_codes.length) ? r.material_codes : [''];
      mcs.forEach(function(mc) {
        rows.push({
          _recId: r.id,
          date: r.date,
          product_code: r.product_code,
          product_name: r.product_name,
          serial_no: mc,
          responsible_person: r.responsible_person,
          delivery_method: r.delivery_method,
          note: r.note,
        });
      });
    });
    var cols = [
      { key: 'date', title: '交付日期', minWidth: 100, sortable: true, render: function(v) { return '<span style="font-family:var(--mono);font-size:12px;color:var(--success);font-weight:540;white-space:nowrap">'+formatDate(v)+'</span>'; } },
      { key: 'product_code', title: '产品型号', minWidth: 170, render: function(v, row) {
        if (v) return '<span class="proj-code-btn" onclick="event.stopPropagation();openProductDetail(\'' + escHtml(v) + '\')" title="' + escHtml(v) + ' ' + escHtml(row.product_name || '') + '">' + escHtml(v) + '</span>';
        return '<span style="font-size:12px;color:var(--muted)">—</span>';
      }},
      { key: 'serial_no', title: '产品编号', minWidth: 140, render: function(v) { return '<span style="font-family:var(--mono);font-size:11.5px">'+escHtml(v||'')+'</span>'; } },
      { key: 'responsible_person', title: '交付人', minWidth: 90, render: function(v) { return '<span style="font-size:12px">'+escHtml(_userDisplayMap[v] || v || '—')+'</span>'; } },
      { key: 'delivery_method', title: '交付形式', minWidth: 80, render: function(v) { return '<span style="font-size:12px">'+(v||'—')+'</span>'; } },
      { key: 'note', title: '备注', render: function(v) { return '<span style="font-size:12px;color:var(--muted)">'+escHtml(v||'')+'</span>'; } },
    ];
    if (canEdit) {
      cols.push({ key: 'actions', title: '操作', width: '100px', minWidth: 100, render: function(v, row) {
        return iconEdit('editDeliveryRecord(' + row._recId + ')', '编辑') +
               iconDelete('deleteDeliveryRecord(' + row._recId + ')', '删除');
      }});
    }
    new DataTable({
      container: document.getElementById('delivery-table'),
      columns: cols,
      data: rows,
    });
  }
}

function editDeliveryRecord(recordId) {
  var records = (_deliveryData && _deliveryData.records) ? _deliveryData.records : [];
  var record = records.find(function(r) { return r.id === recordId; });
  if (record) showDeliveryForm(record);
}

function inlineEditPlanQty(type) {
  if (type === 'total') {
    // Big ring: show dialog with both delivered (n) and planned (m)
    var curDelivered = (_deliveryData && _deliveryData.delivered_manual) || 0;
    var curPlanned = (_deliveryData && _deliveryData.planned) || 0;
    var html =
      '<div class="note-dialog-overlay" id="ring-edit-overlay">' +
      '<div class="note-dialog" style="max-width:360px">' +
        '<div class="note-dialog-head"><span class="note-dialog-title">设置总套数</span>' +
          '<button class="note-dialog-close" onclick="document.getElementById(\'ring-edit-overlay\').remove()">&times;</button></div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:8px 0">' +
          '<div><label style="font-size:11px;color:var(--muted)">已交付 (n)</label><input class="search-inp" id="ring-edit-delivered" type="number" min="0" value="' + curDelivered + '" style="margin-top:4px"></div>' +
          '<div><label style="font-size:11px;color:var(--muted)">应交付 (m)</label><input class="search-inp" id="ring-edit-planned" type="number" min="0" value="' + curPlanned + '" style="margin-top:4px"></div>' +
        '</div>' +
        '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px">' +
          '<button class="btn" onclick="document.getElementById(\'ring-edit-overlay\').remove()">取消</button>' +
          '<button class="btn btn-primary" id="ring-edit-save" onclick="saveRingEdit()">保存</button>' +
        '</div>' +
      '</div></div>';
    document.body.insertAdjacentHTML('beforeend', html);
  } else {
    // Small ring: prompt for product planned_qty
    var plans = (_deliveryData && _deliveryData.product_delivery_plans) || [];
    var match = plans.find(function(p) { return p.product_code === type; });
    var currentVal = match ? (match.planned_qty || 0) : 0;
    var newVal = prompt(type + ' 计划数量:', currentVal);
    if (newVal === null) return;
    newVal = parseInt(newVal) || 0;
    if (newVal === currentVal) return;
    var plans = (_deliveryData && _deliveryData.product_delivery_plans) ? JSON.parse(JSON.stringify(_deliveryData.product_delivery_plans)) : [];
    var found = false;
    plans.forEach(function(p) {
      if (p.product_code === type) { p.planned_qty = newVal; found = true; }
    });
    if (!found) {
      var ps = (_deliveryData && _deliveryData.product_stats) || [];
      var match = ps.find(function(s) { return s.product_code === type; });
      plans.push({ product_code: type, planned_qty: newVal, product_name: match ? match.product_name : '' });
    }
    _savePlanInline({ product_delivery_plans: JSON.stringify(plans) });
  }
}

function saveRingEdit() {
  var newDelivered = parseInt(document.getElementById('ring-edit-delivered').value) || 0;
  var newPlanned = parseInt(document.getElementById('ring-edit-planned').value) || 0;
  var curDelivered = (_deliveryData && _deliveryData.delivered_manual) || 0;
  var curPlanned = (_deliveryData && _deliveryData.planned) || 0;
  if (newDelivered === curDelivered && newPlanned === curPlanned) {
    document.getElementById('ring-edit-overlay').remove();
    return;
  }
  // Disable save button during request
  var btn = document.getElementById('ring-edit-save');
  if (btn) { btn.disabled = true; btn.textContent = '保存中...'; }
  _savePlanInline({ delivered_sets_qty: newDelivered, planned_delivery_qty: newPlanned });
  document.getElementById('ring-edit-overlay').remove();
}

async function _savePlanInline(updates) {
  try {
    await API.put('/projects/' + _comboCurCode + '/delivery-plan', updates);
    showToast('计划已更新', 'success');
    EventBus.emit(EVENTS.DELIVERY_SAVED, {});
  } catch(e) {
    showToast('更新失败: ' + (e.message || ''), 'error');
  }
}

function showDeliveryForm(record) {
  var r = record || {};
  var isEdit = !!record;
  var products = (typeof _projectProducts !== 'undefined' && _projectProducts) ? _projectProducts : [];

  // Product code dropdown from linked products
  var prodOptions = products.map(function(p) {
    var sel = (r.product_code === p.code) ? ' selected' : '';
    return '<option value="' + escHtml(p.code || '') + '"' + sel + '>' + escHtml((p.code ? p.code + ' ' : '') + (p.name || '')) + '</option>';
  }).join('');
  if (!prodOptions) prodOptions = '<option value="">— 无关联产品 —</option>';
  if (r.product_code && products.length === 0) {
    prodOptions = '<option value="' + escHtml(r.product_code || '') + '" selected>' + escHtml((r.product_code || '') + ' ' + (r.product_name || '')) + '</option>';
  }

  // Build user/customer dropdown with optional valueKey/labelKey for objects
  function _selectHtml(id, options, selected, valueKey, labelKey) {
    return '<select class="search-inp" id="' + id + '" style="margin-top:4px;padding:8px 10px">' +
      '<option value="">— 请选择 —</option>' +
      options.map(function(opt) {
        var val, label;
        if (valueKey && typeof opt === 'object') {
          val = opt[valueKey] || '';
          label = opt[labelKey || valueKey] || '';
        } else {
          val = opt;
          label = opt;
        }
        return '<option value="' + escHtml(val) + '"' + (val === selected ? ' selected' : '') + '>' + escHtml(label) + '</option>';
      }).join('') +
    '</select>';
  }

  // Default receiver to project customer, default responsible to current user
  var currentUser = getCurrentUser();
  var defReceiver = isEdit ? (r.receiver || '') : (_projDetail && _projDetail.customer_name ? _projDetail.customer_name : '');
  var defResponsible = isEdit ? (r.responsible_person || '') : (currentUser ? currentUser.username : '');

  // 产品编号勾选池：所选产品型号下已建档的板卡编号 + 编辑时已有的编号（物料编码统一为产品编号）
  // 新建记录时产品下拉默认选中第一个关联产品，勾选池按该默认产品构建
  var selSerials = isEdit && r.material_codes ? r.material_codes.slice() : [];
  var initProductCode = r.product_code || (products.length ? products[0].code : '');
  var pool = _dfSerialPool(initProductCode, selSerials);
  var serialChips = pool.map(function(p) {
    var checked = selSerials.indexOf(p.serial) >= 0 ? ' checked' : '';
    return '<label class="tag-badge tag-1" style="cursor:pointer;margin:2px 4px 2px 0;display:inline-flex;align-items:center;gap:4px">' +
      '<input type="checkbox" class="df-serial-chk" value="' + escHtml(p.serial) + '"' + checked + ' style="margin:0"> ' +
      '<span style="font-size:12px">' + escHtml(p.serial) + '</span>' +
      (p.status ? '<span style="font-size:10px;color:var(--muted)">(' + escHtml(p.status) + ')</span>' : '') +
    '</label>';
  }).join('');
  var hasDfBoards = initProductCode && (_deliveryData.boards || []).some(function(b) { return (b.product_code || '') === initProductCode; });
  var serialHint = !initProductCode
    ? '<span style="font-size:11px;color:var(--muted)">请先选择产品型号</span>'
    : (hasDfBoards && !pool.length
        ? '<span style="font-size:11px;color:var(--muted)">该产品型号下板卡已全部交付</span>'
        : '<span style="font-size:11px;color:var(--muted)">该产品型号暂无已录入板卡编号</span>');

  var html =
    '<div class="note-dialog-overlay">' +
    '<div class="note-dialog" style="max-width:560px;max-height:85vh;overflow-y:auto">' +
      '<div class="note-dialog-head"><span class="note-dialog-title">' + (isEdit ? '编辑交付记录' : '添加交付记录') + '</span>' +
        '<button class="note-dialog-close" onclick="cancelDeliveryForm()">&times;</button></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">' +
        '<div><label style="font-size:11px;color:var(--muted)">产品型号</label><select class="search-inp" id="df-product" onchange="_onDfProductChange()" style="margin-top:4px;padding:8px 10px">' + prodOptions + '</select></div>' +
        '<div><label style="font-size:11px;color:var(--muted)">交付日期</label><input class="search-inp" id="df-date" type="date" value="' + (r.date || (isEdit ? (r.date || '') : fmtLocalDate())) + '" style="margin-top:4px"></div>' +
        '<div><label style="font-size:11px;color:var(--muted)">交付人</label>' + _selectHtml('df-responsible', _userOptions.length ? _userOptions : _userNames, defResponsible, _userOptions.length ? 'code' : null, _userOptions.length ? 'name' : null) + '</div>' +
        '<div><label style="font-size:11px;color:var(--muted)">收货方</label>' + _selectHtml('df-receiver', _customerNames, defReceiver, 'name', 'full_name') + '</div>' +
        '<div><label style="font-size:11px;color:var(--muted)">交付形式</label>' +
          '<select class="search-inp" id="df-method" style="margin-top:4px;padding:8px 10px">' +
            '<option value="">— 请选择 —</option>' +
            '<option value="快递"' + (r.delivery_method === '快递' ? ' selected' : '') + '>快递</option>' +
            '<option value="人工携带"' + (r.delivery_method === '人工携带' ? ' selected' : '') + '>人工携带</option>' +
          '</select></div>' +
        '<div></div>' +
      '</div>' +
      '<div style="margin-bottom:10px">' +
        '<label style="font-size:11px;color:var(--muted);margin-bottom:4px;display:block">产品编号 <span style="color:var(--danger)">*</span><span style="color:var(--muted)">（勾选本项目已录入板卡的编号，可多选）</span></label>' +
        '<div id="df-serial-box" style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;min-height:34px">' +
          (serialChips || serialHint) +
        '</div>' +
      '</div>' +
      '<div style="margin-bottom:12px"><label style="font-size:11px;color:var(--muted)">备注</label><input class="search-inp" id="df-note" value="' + escHtml(r.note || '') + '" style="margin-top:4px"></div>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px">' +
        '<button class="btn" onclick="cancelDeliveryForm()">取消</button>' +
        '<button class="btn btn-primary" id="df-save-btn" onclick="saveDeliveryRecord(' + (r.id || 0) + ')">' + (isEdit ? '保存修改' : '添加记录') + '</button>' +
      '</div>' +
    '</div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
}

/* 产品编号勾选池：指定产品型号下的已建档板卡编号 + 编辑记录已有的编号（物料编码统一为产品编号） */
function _dfSerialPool(productCode, existing) {
  var seen = {}, out = [];
  var bs = (_deliveryData && _deliveryData.boards) || [];
  if (productCode) {
    bs.forEach(function(b) {
      if ((b.product_code || '') !== productCode) return;
      // 已交付的板卡不再可选（避免重复交付）；编辑记录时已有编号走下方 existing 分支保留
      if (b.status === '已交付') return;
      if (b.serial_no && !seen[b.serial_no]) {
        seen[b.serial_no] = 1;
        out.push({ serial: b.serial_no, status: b.status || '' });
      }
    });
  }
  (existing || []).forEach(function(s) {
    if (s && !seen[s]) { seen[s] = 1; out.push({ serial: s, status: '' }); }
  });
  return out;
}

/* 产品型号切换时刷新产品编号勾选池（保留仍可选的已勾选项） */
function _onDfProductChange() {
  var box = document.getElementById('df-serial-box');
  if (!box) return;
  var prodCode = (document.getElementById('df-product') || {}).value || '';
  var checked = [].slice.call(box.querySelectorAll('.df-serial-chk:checked')).map(function(cb) { return cb.value; });
  var pool = _dfSerialPool(prodCode, checked);
  var hasDfBoards = prodCode && (_deliveryData.boards || []).some(function(b) { return (b.product_code || '') === prodCode; });
  box.innerHTML = pool.map(function(p) {
    var c = checked.indexOf(p.serial) >= 0 ? ' checked' : '';
    return '<label class="tag-badge tag-1" style="cursor:pointer;margin:2px 4px 2px 0;display:inline-flex;align-items:center;gap:4px">' +
      '<input type="checkbox" class="df-serial-chk" value="' + escHtml(p.serial) + '"' + c + ' style="margin:0"> ' +
      '<span style="font-size:12px">' + escHtml(p.serial) + '</span>' +
      (p.status ? '<span style="font-size:10px;color:var(--muted)">(' + escHtml(p.status) + ')</span>' : '') +
    '</label>';
  }).join('') || '<span style="font-size:11px;color:var(--muted)">' + (hasDfBoards ? '该产品型号下板卡已全部交付' : '该产品型号暂无已录入板卡编号') + '</span>';
}

function cancelDeliveryForm() {
  var overlay = document.querySelector('.note-dialog-overlay');
  if (overlay) overlay.remove();
  var container = document.getElementById('delivery-form-container');
  if (container) container.innerHTML = '';
}

async function saveDeliveryRecord(recordId) {
  var productCode = document.getElementById('df-product').value.trim();
  var date = document.getElementById('df-date').value;
  var responsible = document.getElementById('df-responsible').value;
  var receiver = document.getElementById('df-receiver').value;
  var method = document.getElementById('df-method').value;
  var note = document.getElementById('df-note').value.trim();

  // Collect selected product codes（勾选的板卡编号）
  var mcs = [];
  document.querySelectorAll('#df-serial-box .df-serial-chk:checked').forEach(function(cb) {
    var v = cb.value.trim();
    if (v) mcs.push(v);
  });

  if (!productCode) { showToast('请选择产品型号', 'error'); return; }
  if (mcs.length === 0) { showToast('请至少选择一个产品编号', 'error'); return; }

  // Resolve product name from linked products
  var products = _projectProducts || [];
  var prodMatch = products.find(function(p) { return p.code === productCode; });
  var productName = prodMatch ? prodMatch.name : productCode;

  var body = {
    product_code: productCode,
    product_name: productName,
    quantity: mcs.length,
    delivery_date: date,
    responsible_person: responsible,
    receiver: receiver,
    delivery_method: method,
    note: note,
    material_codes: mcs,
  };

  // Disable save button during request
  var saveBtn = document.getElementById('df-save-btn');
  if (saveBtn) saveBtn.disabled = true;

  try {
    if (recordId) {
      await API.put('/delivery/records/' + recordId, body);
    } else {
      await API.post('/delivery/projects/' + _comboCurCode + '/records', body);
    }
    showToast(recordId ? '修改成功' : '添加成功', 'success');
    cancelDeliveryForm();
    EventBus.emit(EVENTS.DELIVERY_SAVED, {});
  } catch(e) {
    showToast('操作失败: ' + (e.message || '未知错误'), 'error');
    if (saveBtn) saveBtn.disabled = false;
  }
}

async function deleteDeliveryRecord(id) {
  if (!confirm('确认删除此交付记录？')) return;
  var ok = await verifyPassword('删除交付记录 #' + id, 'pw_verify_delete_delivery');
  if (!ok) return;
  try {
    await API.del('/delivery/records/' + id);
    showToast('删除成功', 'success');
    EventBus.emit(EVENTS.DELIVERY_DELETED, {});
  } catch(e) {
    showToast('删除失败: ' + (e.message || '未知错误'), 'error');
  }
}

/* Resources */

function buildResources(resources, detail) {
  var products = (detail && detail.linked_products) || (detail && detail.products) || [];

  var html = '<div class="card" style="padding:20px">' +
    '<div class="section-title" style="margin-bottom:14px">关联产品文档</div>' +
    '<div style="font-size:12px;color:var(--muted);margin-bottom:16px">以下为本项目关联的产品，点击可查看各产品的文档齐套情况。</div>';

  if (products.length) {
    products.forEach(function(prod) {
      html += '<div class="card prod-doc-card" onclick="openProductDetail(\'' + escHtml(prod.code || String(prod.id)).replace(/'/g, "\\'") + '\', \'docs\')" title="' + escHtml(prod.name || '') + '">' +
        '<span style="font-size:12px;font-weight:600;font-family:var(--mono);color:var(--accent);margin-bottom:2px">' + escHtml(prod.code || '#' + prod.id) + '</span>' +
        '<span style="font-size:11px;color:var(--muted);line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHtml(prod.name) + '</span>' +
      '</div>';
    });
  } else {
    html += '<div style="font-size:12px;color:var(--muted);font-style:italic;padding:12px 0">暂无关联产品</div>';
  }

  html += '</div>';

  document.getElementById('resources-content').innerHTML = html;
}

/* Notes */

function buildNotes(notes) {
  var container = document.getElementById('notes-content');
  var currentUser = (getCurrentUser() || {}).username || '';
  if (notes && notes.length) {
    container.innerHTML = '<div id="notes-table"></div>';
    new DataTable({
      container: document.getElementById('notes-table'),
      columns: [
        { key: 'created_at', title: '记录时间', width: '140px', minWidth: 120, render: function(v, row) { return '<span style="font-size:11px;font-family:var(--mono);color:var(--muted);white-space:nowrap">'+(fmtISODateTime(v)||'—')+'</span>'+(row.updated_at?'<div style="font-size:9px;color:var(--warn)">编辑过</div>':''); } },
        { key: 'stage_name', title: '涉及阶段', width: '90px', minWidth: 100, render: function(v) { return '<span style="font-size:12px">'+escHtml(v||'项目整体')+'</span>'; } },
        { key: 'recorded_by', title: '记录人', width: '70px', minWidth: 90, render: function(v) { return '<span style="font-size:12.5px;font-weight:540">'+escHtml(_userDisplayMap[v] || v || '')+'</span>'; } },
        { key: 'content', title: '内容', align: 'left', className: 'dt-wrap', render: function(v, row) {
          var plainText = stripHtml(renderMarkdown?renderMarkdown(v):v).substring(0,80);
          var replyMark = row.parent_id?'<span style="font-size:10px;color:var(--accent);margin-right:4px">↳ 回复</span>':'';
          var imgBadge = (/!\[.*\]\(.*\)/.test(v) || /<img\b/.test(v)) ? ' <span style="font-size:10px">📷</span>' : '';
          return '<span style="font-size:13px;line-height:1.5">'+replyMark+escHtml(plainText)+(v&&v.length>80?'...':'')+imgBadge+'</span>';
        }},
        { key: 'actions', title: '操作', width: actionColWidth(3) + 'px', minWidth: actionColWidth(3), render: function(v, row) {
          var isMine = row.recorded_by === currentUser;
          var a = '<span style="cursor:pointer;font-size:12px;color:var(--accent);margin-right:4px" onclick="openViewNoteDialog('+row.id+')" title="查看">👁</span>';
          if (isMine) a += iconEdit('openEditNoteDialog('+row.id+')','编辑')+iconDelete('deleteProjectNote('+row.id+')','删除');
          else a += '<span style="cursor:pointer;font-size:12px;color:var(--accent)" onclick="openReplyNoteDialog('+row.id+')" title="回复">💬</span>';
          return a;
        }}
      ],
      data: notes,
      rowClassFn: function(row) { return row.parent_id ? { paddingLeft: '28px', borderLeft: '3px solid var(--accent-lt)' } : null; }
    });
  } else {
    container.innerHTML = '<div class="empty-state" style="padding:12px">暂无笔记</div>';
  }
}

function buildProjectActivity(code) {
  var TASK_ACTIONS = ['任务创建', '批量创建任务', '导入任务', '任务更新', '任务删除', '工时记录', '工时更新', '工时删除'];

  // Strip redundant task-name prefix from detail since task_name column already shows it
  function _cleanDetail(v, action) {
    var text = v || '';
    // "更新任务「xxx」: changes" → "changes"
    var m = text.match(/^更新任务「[^」]*」:\s*/);
    if (m) return text.substring(m[0].length);
    // "创建任务 #N: title" → "#N: title" — keep #N as task reference
    m = text.match(/^创建任务\s+(#\d+):\s*/);
    if (m) return m[1];
    // "批量创建任务 [CODE] #N: title" → "#N: title"
    m = text.match(/^批量创建任务\s*\[[^\]]*\]\s*(#\d+):\s*/);
    if (m) return m[1];
    // "导入任务 #N: title" → "#N: title"
    m = text.match(/^导入任务\s+(#\d+):\s*/);
    if (m) return m[1];
    // "删除任务「xxx」" → "已删除"
    if (/^删除任务「[^」]*」$/.test(text)) return '已删除';
    return text;
  }
  API.get('/projects/' + code + '/activities?sort=desc&limit=50').then(function(data) {
    var items = (data && data.items) ? data.items : [];
    // Filter task-related activities only
    var taskItems = items.filter(function(r) {
      return TASK_ACTIONS.indexOf(r.action) >= 0;
    });
    var container = document.getElementById('project-activity-content');
    if (!container) return;
    if (taskItems.length === 0) {
      container.innerHTML = '<div class="empty-state" style="padding:12px">暂无任务动态</div>';
      return;
    }
    container.innerHTML = '<div id="project-activity-table"></div>';
    new DataTable({
      container: document.getElementById('project-activity-table'),
      columns: [
        { key: 'created_at', title: '时间', width: '130px', minWidth: 120, render: function(v) { return '<span style="font-size:11px;font-family:var(--mono);color:var(--muted);white-space:nowrap">' + (fmtISODateTime(v) || '—') + '</span>'; } },
        { key: 'task_name', title: '任务名', width: 'auto', render: function(v, row) {
          var name = escHtml(v || '—');
          if (row.task_id && v) {
            return '<a href="javascript:void(0)" onclick="openProjectActivityTask(' + row.task_id + ')" style="font-size:12px;font-weight:500;color:var(--accent);text-decoration:none" title="查看任务详情">' + name + '</a>';
          }
          return '<span style="font-size:12px;font-weight:500">' + name + '</span>';
        } },
        { key: 'task_assignee', title: '责任人', width: '12%', minWidth: 150, render: function(v) { return '<span style="font-size:12px;color:var(--muted)">' + escHtml(v || '—') + '</span>'; } },
        { key: 'detail', title: '动态内容', align: 'left', className: 'dt-wrap', render: function(v, row) {
          var text = _cleanDetail(v, row.action);
          return '<span style="font-size:12px;line-height:1.5">' + escHtml(text.length > 100 ? text.substring(0, 100) + '...' : text) + '</span>';
        }}
      ],
      data: taskItems,
      maxHeight: '400px'
    });
  }).catch(function() {
    var container = document.getElementById('project-activity-content');
    if (container) container.innerHTML = '<div class="empty-state" style="padding:12px">加载失败</div>';
  });
}

function openProjectActivityTask(taskId) {
  if (typeof openTaskDetail === 'function') { openTaskDetail(taskId); }
  else if (typeof loadViewScript === 'function') { loadViewScript('/js/tasks.js?v=' + APP_VERSION, function() { openTaskDetail(taskId); }); }
}

async function openNoteDialog() {
  if (!_comboCurCode) return;

  // Fetch stages for the selector
  // DEPRECATED: image previews handled by HugeRTE
  var stagesHtml = '<option value="">请选择阶段...</option>';
  try {
    var result = await API.get('/projects/' + _comboCurCode + '/stages');
    var stages = (result && result.stages) ? result.stages : [];
    if (stages.length) {
      stages.forEach(function(s) {
        stagesHtml += '<option value="' + escHtml(s.name) + '">' + escHtml(s.name) + '</option>';
      });
    }
  } catch(e) { /* ignore, just show project-level option */ }

  var overlay = document.createElement('div');
  overlay.className = 'note-dialog-overlay';
  overlay.innerHTML = '<div class="note-dialog" style="width:80vw;max-width:80vw;max-height:90vh;overflow-y:auto">' +
    '<div class="note-dialog-head">' +
      '<span class="note-dialog-title">添加项目笔记</span>' +
      '<button class="note-dialog-close" onclick="closeNoteDialog()">&times;</button>' +
    '</div>' +
    '<div style="margin-bottom:10px">' +
      '<label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px">涉及阶段</label>' +
      '<select id="note-dialog-stage" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--fg);font-size:13px;box-sizing:border-box">' + stagesHtml + '</select>' +
    '</div>' +
    '<textarea id="note-dialog-input" style="width:100%;min-height:60px;height:auto;max-height:30vh;box-sizing:border-box;padding:10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--fg);font-size:13px;resize:vertical;font-family:var(--font)" placeholder="记录项目关键信息：会议纪要、采购问题、交付调整等..."></textarea>' +
    '<div style="font-size:10px;color:var(--muted);margin-top:2px">支持粘贴图片 (Ctrl+V)和大小调整</div>' +
    '<div id="note-dialog-input-img-preview" style="margin-top:4px;min-height:0;max-height:50vh;overflow-y:auto"></div>' +
    '<div style="display:flex;justify-content:flex-end;align-items:center;gap:10px;margin-top:12px">' +
      '<span id="note-dialog-msg" style="font-size:11px"></span>' +
      '<button class="btn" onclick="closeNoteDialog()" style="font-size:12px">取消</button>' +
      '<button class="btn btn-primary" onclick="submitNote()" style="font-size:12px">保存</button>' +
    '</div>' +
  '</div>';
  document.body.appendChild(overlay);
  setTimeout(function() {
    var inp = document.getElementById('note-dialog-input');
    if (inp) { inp.focus(); }
    initRichEditor('note-dialog-input', {height: 300});
  }, 100);
}

function closeNoteDialog() {
  var overlay = document.querySelector('.note-dialog-overlay');
  if (overlay) overlay.remove();
}

/* ── View Note Dialog ── */

function openViewNoteDialog(noteId) {
  if (!_comboCurCode) return;
  API.get('/projects/' + _comboCurCode + '/notes').then(function(result) {
    var notes = (result && result.length) ? result : [];
    var note = notes.find(function(n) { return n.id === noteId; });
    if (!note) { showToast('笔记不存在', 'error'); return; }
    // Pre-process legacy custom image size syntax: ![](url =Wx) -> <img>
    var content = note.content;
    if (!/^\s*</.test(content)) {
      content = content.replace(/!\[\]\((\/api\/note-images\/[^) ]+)\s*=(\d+)x\)/g, '<img src="$1" style="width:$2px;max-width:100%">');
    }
    var contentHtml = (typeof renderMarkdown === 'function') ? renderMarkdown(content) : '<pre>' + escHtml(content) + '</pre>';
    var dialog = document.createElement('div');
    dialog.className = 'note-dialog-overlay';
    dialog.innerHTML = '<div class="note-dialog" style="max-width:75vw;width:75vw">' +
      '<div class="note-dialog-head">' +
        '<span class="note-dialog-title">查看笔记</span>' +
        '<button class="note-dialog-close" onclick="this.closest(\'.note-dialog-overlay\').remove()">&times;</button>' +
      '</div>' +
      '<div style="margin-bottom:8px;display:flex;gap:16px;font-size:11px;color:var(--muted)">' +
        '<span>阶段: ' + escHtml(note.stage_name || '项目整体') + '</span>' +
        '<span>作者: ' + escHtml(note.recorded_by || '') + '</span>' +
        '<span>时间: ' + escHtml(fmtISODateTime(note.created_at) || '—') + (note.updated_at ? ' (编辑过)' : '') + '</span>' +
      '</div>' +
      '<div style="max-height:70vh;overflow-y:auto;padding:12px;background:var(--bg);border-radius:8px;font-size:13px;line-height:1.7" class="markdown-body">' + contentHtml + '</div>' +
      '<div style="display:flex;justify-content:flex-end;margin-top:12px">' +
        '<button class="btn" onclick="this.closest(\'.note-dialog-overlay\').remove()">关闭</button>' +
      '</div>' +
    '</div>';
    document.body.appendChild(dialog);
  });
}

/* Edit / Reply / Delete notes */

function openEditNoteDialog(noteId) {
  if (!_comboCurCode) return;
  // DEPRECATED
  API.get('/projects/' + _comboCurCode + '/notes').then(function(result) {
    var notes = (result && result.length) ? result : [];
    var note = notes.find(function(n) { return n.id === noteId; });
    if (!note) { showToast('笔记不存在', 'error'); return; }
    // Load existing images into preview
// DEPRECATED
    var stagesHtml = '<option value="">请选择阶段...</option>';
    // Re-fetch stages for the dropdown
    API.get('/projects/' + _comboCurCode + '/stages').then(function(r) {
      var stages = (r && r.stages) ? r.stages : [];
      stages.forEach(function(s) {
        var sel = s.name === note.stage_name ? ' selected' : '';
        stagesHtml += '<option value="' + escHtml(s.name) + '"' + sel + '>' + escHtml(s.name) + '</option>';
      });
      openDialog('编辑项目笔记',
        '<div style="margin-bottom:10px">' +
          '<label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px">涉及阶段</label>' +
          '<select id="edit-note-stage" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--fg);font-size:13px;box-sizing:border-box">' + stagesHtml + '</select>' +
        '</div>' +
        '<textarea id="edit-note-content" style="width:100%;min-height:60px;height:auto;max-height:30vh;box-sizing:border-box;padding:10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--fg);font-size:13px;resize:vertical;font-family:var(--font)">' + escHtml(note.content) + '</textarea>' +
        '<div style="font-size:10px;color:var(--muted);margin-top:2px">支持粘贴图片 (Ctrl+V)和大小调整</div>' +
        '<div id="edit-note-content-img-preview" style="margin-top:4px;min-height:0;max-height:50vh;overflow-y:auto"></div>',
        [{text: '取消', onclick: 'closeSharedDialog()'},
         {text: '保存', cls: 'btn-primary', onclick: 'saveEditNote(' + noteId + ')'}],
        {maxWidth: '80vw', maxHeight: '90vh', hideClose: true});
    setTimeout(function() { initRichEditor('edit-note-content', {height: 300}); }, 100);
    });
  });
}

async function saveEditNote(noteId) {
  var content = document.getElementById('edit-note-content').value.trim();
  var stage = document.getElementById('edit-note-stage').value;
  if (!content) { showToast('请输入内容', 'error'); return; }
// HugeRTE handles content directly
  closeSharedDialog();
  try {
    await API.put('/projects/' + _comboCurCode + '/notes/' + noteId, {content: content, stage_name: stage});
    showToast('已更新', 'success');
    EventBus.emit(EVENTS.NOTE_SAVED, {});
  } catch(e) { showToast('编辑失败: ' + (e.message || ''), 'error'); }
}

function openReplyNoteDialog(parentId) {
  if (!_comboCurCode) return;
  // DEPRECATED
  // Fetch parent note for context
  API.get('/projects/' + _comboCurCode + '/notes').then(function(result) {
    var notes = (result && result.length) ? result : [];
    var parent = notes.find(function(n) { return n.id === parentId; });
    if (!parent) { showToast('笔记不存在', 'error'); return; }
    var stageLabel = parent.stage_name || '项目整体';
    openDialog('回复笔记',
      '<div style="margin-bottom:8px;padding:8px 12px;background:var(--bg);border-radius:6px;font-size:11px;color:var(--muted)">' +
        '回复 <b>' + escHtml(parent.recorded_by) + '</b> 的笔记（' + escHtml(stageLabel) + '）<br>' +
        '<span style="color:var(--fg)">' + escHtml(parent.content.substring(0, 80)) + (parent.content.length > 80 ? '...' : '') + '</span>' +
      '</div>' +
      '<textarea id="reply-note-content" style="width:100%;min-height:60px;height:auto;max-height:30vh;box-sizing:border-box;padding:10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--fg);font-size:13px;resize:vertical;font-family:var(--font)" placeholder="输入回复..."></textarea>' +
      '<div style="font-size:10px;color:var(--muted);margin-top:2px">支持粘贴图片 (Ctrl+V)和大小调整</div>' +
      '<div id="reply-note-content-img-preview" style="margin-top:4px;min-height:0;max-height:50vh;overflow-y:auto"></div>',
      [{text: '取消', onclick: 'closeSharedDialog()'},
       {text: '回复', cls: 'btn-primary', onclick: 'submitReplyNote(' + parentId + ',\'' + escHtml(stageLabel).replace(/'/g, "\\'") + '\')'}],
      {maxWidth: '80vw', maxHeight: '90vh', hideClose: true});
    setTimeout(function() { initRichEditor('reply-note-content', {height: 300}); }, 100);
  });
}

async function submitReplyNote(parentId, stageName) {
  var content = document.getElementById('reply-note-content').value.trim();
  if (!content) { showToast('请输入回复内容', 'error'); return; }
// HugeRTE handles content directly
  closeSharedDialog();
  try {
    await API.post('/projects/' + _comboCurCode + '/notes', {content: content, stage_name: stageName, parent_id: parentId});
    showToast('已回复', 'success');
    EventBus.emit(EVENTS.NOTE_SAVED, {});
  } catch(e) { showToast('回复失败: ' + (e.message || ''), 'error'); }
}

async function deleteProjectNote(noteId) {
  if (!confirm('确认删除此笔记？（有回复的笔记不能删除）')) return;
  try {
    await API.del('/projects/' + _comboCurCode + '/notes/' + noteId);
    showToast('已删除', 'success');
    EventBus.emit(EVENTS.NOTE_DELETED, {});
  } catch(e) { showToast('删除失败: ' + (e.message || ''), 'error'); }
}

async function submitNote() {
  var inp = document.getElementById('note-dialog-input');
  var sel = document.getElementById('note-dialog-stage');
  var msg = document.getElementById('note-dialog-msg');
  var content = inp.value.trim();
  if (!content) return;
  var stage = sel ? sel.value : '';
  if (!stage) { msg.innerHTML = '<span style="color:var(--danger)">请选择涉及阶段</span>'; return; }
  if (!_comboCurCode) return;

// HugeRTE handles content directly
  try {
    msg.innerHTML = '<span style="color:var(--muted)">保存中...</span>';
    await API.post('/projects/' + _comboCurCode + '/notes', { content: content, stage_name: stage });
    closeNoteDialog();
    EventBus.emit(EVENTS.NOTE_SAVED, {});
  } catch(e) {
    msg.innerHTML = '<span style="color:var(--danger)">失败: ' + escHtml(e.message) + '</span>';
  }
}

/* Tab Switching */

function switchDTab(id, el) {
  document.querySelectorAll('.dsec').forEach(function(s) { s.classList.remove('active'); });
  document.querySelectorAll('.dtab').forEach(function(t) { t.classList.remove('active'); });
  // Reset any cross-panel batch-selection state/toolbars (task vs bug) when switching
  // project-detail tabs, so e.g. a previous Bug list can't feed the Task batch delete.
  if (typeof _clearAllBatchState === 'function') _clearAllBatchState();
  var sec = document.getElementById('dsec-' + id);
  if (sec) sec.classList.add('active');
  if (el) { el.classList.add('active'); }
  else {
    var tab = document.querySelector('.dtab[onclick*="' + id + '"]');
    if (tab) tab.classList.add('active');
  }
  // Refresh tab content when switching to it
  if (id === 'maintenance') buildMaintenance();
  if (id === 'activities') loadActivities();
  if (id === 'versions') buildVersionsTab();
  if (id === 'pma-tasks' && _comboCurCode) {
    var projName = (document.getElementById('combo-input') || {}).value || '';
    if (!projName && typeof _allProjects !== 'undefined') {
      var p = _allProjects.find(function(x) { return x.id == _comboCurCode; });
      if (p) projName = p.name;
    }
    if (typeof initProjectTasks === 'function') {
      initProjectTasks(_comboCurCode, projName);
    } else if (typeof loadViewScript === 'function') {
      loadViewScript('/js/tasks.js?v=250630', function() { initProjectTasks(_comboCurCode, projName); });
    }
  }
  if (id === 'bugs' && _comboCurCode) {
    if (typeof loadProjectBugs === 'function') {
      loadProjectBugs(_comboCurCode);
    } else if (typeof loadViewScript === 'function') {
      loadViewScript('/js/bugs.js?v=' + APP_VERSION, function() { loadProjectBugs(_comboCurCode); });
    }
  }
  // Update hash: user clicks push, initial load skip (history is handled by loadProjectDetail)
  if (_comboCurCode && typeof buildHash === 'function' && el) {
    history.pushState({ view: 'detail', params: [String(_comboCurCode), id] }, '', buildHash('detail', String(_comboCurCode), id));
  }
}

/* ── 软件版本 Tab ── */

function _svDocKey(sourceType, docId) { return sourceType + ':' + docId; }

function _svCopyText(text, label) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function() { showToast('已复制' + (label ? '：' + label : ''), 'success'); })
        .catch(function() { _fallbackCopy(text); });
    } else { _fallbackCopy(text); }
  } catch(e) { _fallbackCopy(text); }
}

function _svCopyUrl(url, version) {
  _svCopyText(url, version ? ('版本链接：' + version) : '版本链接');
}

async function buildVersionsTab() {
  _svRegisterRealtime();  // 版本锁定事件实时订阅（只注册一次）
  _svView = 'all';  // 每次进入「软件版本」Tab 都切回「版本汇总」子视图（不保留上次的版本维护/过滤状态）
  var container = document.getElementById('versions-content');
  if (!container) return;
  if (!_comboCurCode) {
    container.innerHTML = '<div class="empty-state" style="padding:20px">请选择项目</div>';
    return;
  }
  container.innerHTML = '<div class="loading-spinner" style="padding:30px">加载软件版本...</div>';
  try {
    var resp = await API.get('/projects/' + _comboCurCode + '/software-versions');
    _svData = (resp && resp.data) ? resp.data : resp;
    renderVersionsTab();
  } catch(e) {
    container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--danger)">加载失败: ' + escHtml(e.message) + '</div>';
  }
}

function renderVersionsTab() {
  var container = document.getElementById('versions-content');
  if (!container) return;
  var groups = (_svData && _svData.groups) || [];
  var prodOpts = '<option value="all">全部产品</option>';
  groups.forEach(function(g) {
    if (g.type === 'product') {
      prodOpts += '<option value="' + escHtml(g.key) + '"' + (_svProdFilter === g.key ? ' selected' : '') + '>' + escHtml(g.label) + '</option>';
    }
  });
  var isSummary = (_svView === 'all');
  container.innerHTML =
    '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:2px 2px 10px">' +
        '<button class="btn btn-sm ' + (isSummary ? 'btn-primary' : '') + '" onclick="_svSetView(\'all\')" style="font-size:11px;padding:4px 10px">版本汇总</button>' +
        '<button class="btn btn-sm ' + (!isSummary ? 'btn-primary' : '') + '" onclick="_svSetView(\'current\')" style="font-size:11px;padding:4px 10px">版本维护</button>' +
        '<span style="width:1px;height:18px;background:var(--border);flex-shrink:0"></span>' +
        '<select onchange="_svSetType(this.value)" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--fg)">' +
          '<option value="all">全部来源</option>' +
          '<option value="project"' + (_svTypeFilter === 'project' ? ' selected' : '') + '>项目发布</option>' +
          '<option value="product"' + (_svTypeFilter === 'product' ? ' selected' : '') + '>产品基础版本</option>' +
        '</select>' +
        '<select onchange="_svSetProd(this.value)" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--fg)">' + prodOpts + '</select>' +
        '<input id="sv-keyword" placeholder="搜索版本..." value="' + escHtml(_svKeyword) + '" oninput="_svSetKeyword(this.value)" style="font-size:11px;padding:4px 8px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--fg);width:140px">' +
        (isSummary ?
          '<button class="btn btn-sm" onclick="_svCopyAll()" style="font-size:11px;padding:4px 10px">📋 复制全部链接</button>' +
          '<button class="btn btn-sm" onclick="_svExportCsv()" style="font-size:11px;padding:4px 10px">⬇ 导出CSV</button>' : '') +
      '</div>' +
    '<div class="card" style="padding:0;overflow:hidden">' +
      '<div id="versions-body">' + _svRenderBody() + '</div>' +
    '</div>';
}

function _svRenderBody() {
  return _svView === 'all' ? _svRenderSummary() : _svRenderCurrent();
}

function _svRenderCurrent() {
  var groups = (_svData && _svData.groups) || [];
  var help = '<div style="background:var(--accent-lt);border:1px solid var(--accent-lt);border-radius:8px;padding:8px 12px;font-size:11px;color:var(--muted);line-height:1.7;margin-bottom:10px">' +
    '💡 <b style="color:var(--fg)">维护说明</b>：<br>' +
    '· <span style="color:var(--success);font-weight:700">✅</span> 已锁定为本项目使用的版本；<span style="color:var(--muted);font-weight:700">?</span> 未锁定，自动跟踪最新版本。<br>' +
    '· 展开文档的版本列表，勾选某版本复选框即<u>锁定</u>；取消勾选则<u>恢复自动跟随</u>（需要编辑权限）。<br>' +
    '· 每个<b>项目发布</b>子项都有「<u>来源选择</u>」下拉：默认<b>使用项目侧发布版本</b>（本项目仓库 GitLab 发布的版本）；切换到<b>使用产品基础版本</b>后版本来源改为关联产品对应阶段的发布版本，默认自动锁定并跟随最新，也可在展开的版本列表中手动锁定任一产品版本。<br>' +
    '· 「FPGA版本开发」按<b>含 FPGA 的板卡</b>拆分为板卡子文档（FPGA版本开发-&lt;产品代码&gt;），<b>每块板卡的来源在各自的子文档上单独控制</b>：同一项目可能有多块含 FPGA 的板卡，有的使用<b>项目发布的版本</b>、有的使用<b>产品基础版本</b>，不能统一控制。<br>' +
    '· 板卡使用产品基础版本时跟随其产品「FPGA基础版本」发布；<b>未配置 / 尚未提供</b>「FPGA基础版本」的板卡照常显示并标记 <b>未提交</b>（版本汇总同样列出），便于区分「FPGA 未提交」与「无需提供」；确无 FPGA 的产品在模板管理标记「无FPGA」即不再要求。<br>' +
    '· <span style="color:var(--success)">🔒</span> 产品基础版本文档处于「使用最新版本」自动管理下（默认开启；卡片开关或子项单独开关可批量/个别关闭），自动锁定最新版本，无需手动维护。<br>' +
    '· 「最新」= 已锁定且无更新；「非最新」= 已锁定但来源有更新可用，请及时升级。<br>' +
    '· 已锁定的版本（✅）与未锁定但自动跟踪的当前版本（自动）都会汇总到「版本汇总」页，作为最终交付给测试/工程的版本清单。<br>' +
    '· 「全部使用最新版本」（🔌 产品基础版本卡片开关）：开启后所有产品基础版本（BSP开发 / 业务软件开发 / FPGA开发）自动锁定最新版本，不可手动选择其他版本；每个产品版本文档还可单独开关「使用最新版本」。<br>' +
    '· <span style="color:var(--warn);font-weight:700">单一来源</span>：业务软件 / FPGA 开发的最终版本只能有一个来源——子项用<b>项目侧发布版本</b>（含默认）时，项目侧版本即最终交付，<b>同阶段产品基础版本不再进入「版本汇总」</b>；子项改用<b>产品基础版本</b>后，由产品侧决定最终版本，产品卡同阶段基础版本文档灰显。切换来源时会弹出确认提示。' +
    '</div>';
  if (!groups.length) {
    return help + '<div style="text-align:center;padding:30px;font-style:italic;color:var(--muted)">暂无软件版本<br><span style="font-size:11px">项目发布文档或产品基础版本文档未匹配到 GitLab 发布</span></div>';
  }
  var canEdit = _svCanEdit();
  var projRows = '';
  var projCount = 0;
  var prodRows = '';
  var prodCount = 0;
  groups.forEach(function(g) {
    if (_svTypeFilter === 'project' && g.type !== 'project') return;
    if (_svTypeFilter === 'product' && g.type !== 'product') return;
    if (_svProdFilter !== 'all' && g.key !== _svProdFilter) return;
    var docs = (g.docs || []).filter(function(d) { return _svDocMatch(d); });
    if (!docs.length) return;
    var rows = '';
    docs.forEach(function(d) { rows += _svRenderDoc(g, d, canEdit); });
    if (!rows) return;
    if (g.type === 'project') {
      projRows += rows;
      projCount += docs.length;
    } else {
      // 产品卡片标题：产品编号（标准控件，可点击跳产品详情）+（产品名）
      var gChip = (g.code)
        ? projCodeTag(String(g.code), 'openProductDetail(\'' + escJs(String(g.code)) + '\')', g.name || '')
        : escHtml(g.label || '');
      prodRows += '<div class="sv-group" style="padding:10px 0 0 0">' +
        '<div style="font-size:11px;font-weight:600;color:var(--fg);margin-bottom:6px;display:flex;align-items:center;flex-wrap:wrap;gap:4px">🔌 ' + gChip + (g.name ? '<span>（' + escHtml(g.name) + '）</span>' : '') + ' <span style="font-size:10px;color:var(--muted);font-weight:400">' + docs.length + ' 个版本来源</span></div>' +
        rows +
      '</div>';
      prodCount += docs.length;
    }
  });
  var out = '';
  if (projRows) out += _svSection('🚀', '项目发布', projRows, projCount, '', 'blue');
  if (prodRows) out += _svSection('🔌', '产品基础版本', prodRows, prodCount, _svBspSwitch(), 'green');
  if (!out) return help + '<div style="text-align:center;padding:30px;font-style:italic;color:var(--muted)">无匹配的版本来源</div>';
  return help + '<div style="display:flex;align-items:flex-start;gap:16px;flex-wrap:wrap">' + out + '</div>';
}

function _svSection(icon, label, innerHtml, count, extra, theme) {
  // 主题色头部带：项目发布 = 蓝色(蓝=主题强调色)；产品基础版本 = 绿色(绿=success)
  theme = (theme === 'green') ? 'green' : 'blue';
  return '<div class="sv-section" style="flex:1 1 380px;min-width:300px;border:1px solid var(--border);border-radius:10px;overflow:hidden">' +
    '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:9px 14px;background:var(--' + theme + '-lt);border-bottom:1px solid var(--' + theme + ')">' +
      '<span style="font-size:12px;font-weight:700;color:var(--' + theme + ')">' + icon + ' ' + label + ' <span style="font-size:10px;opacity:.72;font-weight:400">' + count + ' 个版本来源</span></span>' +
      (extra ? '<span style="flex:1"></span>' + extra : '') +
    '</div>' +
    '<div style="padding:10px 12px 12px 12px">' + innerHtml + '</div>' +
  '</div>';
}

// 产品基础版本卡片上的「全部使用最新版本」批量配置开关（project.bsp_auto_latest）
function _svBspSwitch() {
  var canEdit = _svCanEdit();
  var mode = (_svData && _svData.mode) || {};
  return '<label style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--muted);cursor:' + (canEdit ? 'pointer' : 'not-allowed') + ';user-select:none" title="开启后所有产品基础版本（BSP开发 / 业务软件开发 / FPGA开发）自动锁定最新版本（随产品迭代自动更新），不可手动选择其他版本；每个文档还可单独精细调整">' +
    '<input type="checkbox" id="sv-bsp-auto"' + (mode.bsp_auto_latest ? ' checked' : '') + (canEdit ? '' : ' disabled') + ' onchange="_svToggleBspAuto(this.checked)" style="cursor:pointer;width:13px;height:13px;accent-color:var(--accent)">' +
    '全部使用最新版本' +
  '</label>';
}

function _svDocMatch(d) {
  var kw = (_svKeyword || '').trim().toLowerCase();
  if (!kw) return true;
  var hay = ((d.current || '') + ' ' + (d.doc_name || '')).toLowerCase();
  var hit = (d.versions || []).some(function(v) { return (v.version || '').toLowerCase().indexOf(kw) >= 0; });
  return hay.indexOf(kw) >= 0 || hit;
}

function _svSrcSelect(d, canEdit) {
  // 项目发布子项「来源选择」下拉：使用项目侧发布版本（project，doc_auto=0，默认）
  // / 使用产品基础版本（product，doc_auto=1）。data-cur 记录切换前状态供取消还原。
  var opts = '<option value="project"' + (d.doc_auto ? '' : ' selected') + '>使用项目侧发布版本</option>' +
             '<option value="product"' + (d.doc_auto ? ' selected' : '') + '>使用产品基础版本</option>';
  if (canEdit) {
    return '<select data-cur="' + (d.doc_auto ? 'product' : 'project') + '" onchange="_svChangeSource(\'' + d.source_type + '\',' + d.doc_id + ',\'' + escJs(d.doc_name) + '\',this)" title="该子项的发布版本来源：使用项目侧发布版本 = 本项目仓库 GitLab 发布的版本；使用产品基础版本 = 关联产品对应阶段的发布版本" style="font-size:10px;padding:2px 6px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--fg);cursor:pointer;max-width:155px;white-space:nowrap">' + opts + '</select>';
  }
  return '<span style="font-size:10px;color:var(--muted);white-space:nowrap" title="该子项的发布版本来源">' + (d.doc_auto ? '使用产品基础版本' : '使用项目侧发布版本') + '</span>';
}

function _svRenderDoc(g, d, canEdit) {
  var key = _svDocKey(d.source_type, d.doc_id);
  var expanded = !!_svExpanded[key];
  if (!_svDocMatch(d)) return '';
  var sorted = d.versions ? d.versions.slice().sort(function(a, b) { return (b.date || '').localeCompare(a.date || ''); }) : [];
  var latestVer = sorted.length ? sorted[0].version : null;
  // 阶段级来源互斥：covered = 该产品基础版本文档已被同阶段项目发布文档「使用产品基础版本」覆盖
  var covered = !!d.covered;
  var isFpgaParent = !!d.fpga_parent;
  var isFpgaChild = !!d.fpga_child;
  var stagePill = d.stage ? '<span class="pill active" style="margin-right:6px;font-size:10px">' + escHtml(d.stage) + '</span>' : '';

  // 项目发布子项「来源选择」下拉：普通项目文档 + 各 FPGA 板卡子文档（后端仅对其置 doc_auto_capable）
  // 通用 FPGA 容器行（fpga_parent）无下拉 —— 每块板卡的来源在各自子文档上单独控制
  var srcSel = '';
  if (g.type === 'project' && d.doc_auto_capable) {
    srcSel = _svSrcSelect(d, canEdit);
  }

  // 通用 FPGA 文档有板卡子文档时仅作「容器行」：无来源下拉 / 无版本列表（来源下放到各板卡），
  // 每块板卡使用 项目侧发布 / 产品基础版本 由下方 fpga_child 子文档各自的来源下拉单独控制。
  // srcSel 为空（容器行 doc_auto_capable=false，见 backend get_software_versions 分支）
  if (isFpgaParent) {
    var childDocs = (g.docs || []).filter(function(x) { return x.fpga_child; });
    return '<div class="sv-doc" style="padding:8px 12px;background:var(--accent-lt);border:1px dashed var(--accent);border-radius:8px;margin-bottom:6px">' +
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
        '<span style="font-size:13px;flex-shrink:0">🧩</span>' +
        stagePill +
        '<span style="font-size:12px;font-weight:700;color:var(--fg);word-break:break-all">' + escHtml(d.doc_name) + '</span>' +
        '<span class="tag-badge" style="background:var(--accent-lt);color:var(--accent);border:1px solid var(--accent)" title="该项目含多块含 FPGA 的板卡，同一项目不同板卡可能分别使用项目发布版本或产品基础版本，因此版本来源在下方各板卡子文档上单独控制">按 ' + childDocs.length + ' 个板卡拆分，各板卡来源单独控制</span>' +
        '<span style="flex:1"></span>' +
        '<span style="font-size:10px;color:var(--muted);white-space:nowrap">' + childDocs.length + ' 个产品子项</span>' +
      '</div>' +
    '</div>';
  }

  var badge = '';
  if (covered) {
    badge += '<span class="tag-badge" style="margin-left:4px;background:var(--bg-lt);color:var(--muted);border:1px solid var(--border)" title="该阶段已由项目发布「' + escHtml(d.covered_by || '') + '」使用产品基础版本，版本来源以项目侧为准，无需单独锁定">随「' + escHtml(d.covered_by || '') + '」使用产品基础版本</span>';
  } else if (d.has_newer) {
    badge += '<span class="tag-badge tag-2" style="margin-left:4px" title="来源已有更新版本">非最新</span>';
  }
  // 已锁定且为来源最新 → 标「最新」
  if (latestVer && d.current === latestVer) {
    badge += '<span class="tag-badge tag-4" style="margin-left:4px">最新</span>';
  }

  // 整行行首状态图标：已锁定 ✅ 绿色 | 未锁定 ? 圆形灰色（自动跟踪最新）
  var stateIcon = d.locked
    ? '<span style="color:var(--success);font-weight:700;flex-shrink:0" title="已锁定为当前版本">✅</span>'
    : '<span style="display:inline-flex;width:16px;height:16px;align-items:center;justify-content:center;border:1px solid var(--warn);border-radius:50%;color:var(--warn);font-size:10px;font-weight:700;flex-shrink:0" title="未锁定，自动跟踪最新版本">?</span>';

  // 当前版本名 → 可点击跳转（有 URL 时），当前版本文字绿色
  var curVer = null;
  (d.versions || []).forEach(function(v) { if (v.version === d.current) curVer = v; });
  var current = d.current
    ? (curVer && curVer.url
        ? '<a href="' + escHtml(curVer.url) + '" target="_blank" title="' + escHtml(curVer.url) + '" style="font-family:var(--mono);font-size:12px;font-weight:600;color:var(--success);word-break:break-all;text-decoration:none">' + escHtml(d.current) + '</a>'
        : '<span style="font-family:var(--mono);font-size:12px;font-weight:600;color:var(--success);word-break:break-all">' + escHtml(d.current) + '</span>')
    : '<span style="font-size:11px;color:var(--warn);font-weight:600;font-style:italic">未提交</span>';

  var verDivId = 'sv-vers-' + key.replace(/[^a-zA-Z0-9]/g, '_');
  var versionsHtml = '';
  if (sorted.length) {
    versionsHtml = '<div id="' + verDivId + '" style="' + (expanded ? '' : 'display:none') + ';margin:8px 0 0 0;border-top:1px dashed var(--border);padding:8px 0 0 ' + (isFpgaChild ? '24px' : '12px') + '">' +
      sorted.map(function(v) {
        var isCur = v.version === d.current;
        var isLatest = v.version === latestVer;
        var rowBadge = '';
        if (isLatest) rowBadge += '<span class="tag-badge tag-4" style="margin-left:6px">最新</span>';
        var nameHtml = v.url
          ? '<a href="' + escHtml(v.url) + '" target="_blank" title="' + escHtml(v.url) + '" style="font-family:var(--mono);word-break:break-all;color:' + (isCur ? 'var(--success)' : 'var(--fg)') + ';text-decoration:none">' + escHtml(v.version) + '</a>'
          : '<span style="font-family:var(--mono);word-break:break-all;color:' + (isCur ? 'var(--success)' : 'var(--fg)') + '">' + escHtml(v.version) + '</span>';
        // 复选框替代 锁定/解锁 按钮（仅编辑权限显示；行首状态图标已在文档行头部统一展示）
        // 自动管理模式（auto_managed）下不提供手动复选框，显示 🔒 提示自动锁定最新版本
        // covered（被项目侧同阶段「使用产品基础版本」覆盖）→ 显示灰色 ⊗，不提供单独锁定
        var rowCb = '';
        if (covered) {
          rowCb = '<span title="该阶段已由项目发布「' + escHtml(d.covered_by || '') + '」使用产品基础版本，无需单独锁定" style="color:var(--muted);font-size:11px;flex-shrink:0;width:13px;text-align:center">⊗</span>';
        } else if (canEdit) {
          if (d.auto_managed) {
            rowCb = '<span title="自动锁定最新版本，不可手动选择" style="color:var(--success);font-size:12px;flex-shrink:0;width:13px;text-align:center">🔒</span>';
          } else {
            var cbChecked = (isCur && d.locked) ? ' checked' : '';
            rowCb = '<input type="checkbox"' + cbChecked + ' title="' + ((isCur && d.locked) ? '取消锁定，恢复自动跟随' : '锁定为本项目使用的版本') + '" onchange="_svToggleRowLock(\'' + d.source_type + '\',' + d.doc_id + ',\x27' + escJs(v.version) + '\x27,\x27' + escJs(d.doc_name) + '\x27,this)" style="width:13px;height:13px;flex-shrink:0;cursor:pointer;accent-color:var(--success)">';
          }
        }
        return '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:12px">' +
          rowCb +
          '<span style="width:6px;height:6px;border-radius:50%;background:' + (isCur ? 'var(--success)' : 'var(--border)') + ';flex-shrink:0"></span>' +
          nameHtml +
          (v.date ? '<span style="font-size:10px;color:var(--muted);white-space:nowrap">' + formatDate(v.date) + '</span>' : '') +
          rowBadge +
          '<span style="flex:1"></span>' +
        '</div>';
      }).join('') +
    '</div>';
  }

  var actions = '';
  var tglKey = key.replace(/[^a-zA-Z0-9]/g, '_');
  if (sorted.length) {
    actions += '<button class="btn-icon" id="sv-tgl-' + tglKey + '" title="' + (expanded ? '收起' : '展开全部版本') + '" onclick="_svToggleDoc(\'' + d.source_type + '\',' + d.doc_id + ')">' + (expanded ? '&#9650;' : '&#9660;') + '</button>';
  }

  // 产品基础版本子项的「使用最新版本」单独开关（来源已由来源下拉管理，项目侧不再提供复选框）
  // covered 文档的来源由项目侧同阶段「使用产品基础版本」控制，不提供单独开关
  var autoCb = '';
  if (g.type === 'product' && d.doc_auto_capable && !covered) {
    var autoLabel = '使用最新版本';
    autoCb = '<label title="' + (d.doc_auto ? '已开启' : '已关闭') + '「' + autoLabel + '」：' + (d.doc_auto ? '该文档自动锁定最新版本，不可手动选择其他版本' : '该文档手动管理版本') + '" style="display:inline-flex;align-items:center;gap:3px;font-size:10px;color:var(--muted);cursor:' + (canEdit ? 'pointer' : 'not-allowed') + ';user-select:none;white-space:nowrap">' +
      '<input type="checkbox"' + (d.doc_auto ? ' checked' : '') + (canEdit ? '' : ' disabled') + ' onchange="_svToggleDocAuto(\'' + d.source_type + '\',' + d.doc_id + ',\'' + autoLabel + '\',this)" style="width:12px;height:12px;cursor:pointer;accent-color:var(--accent)">' +
      autoLabel +
    '</label>';
  }

  return '<div class="sv-doc" style="padding:8px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;margin-bottom:8px' + (isFpgaChild ? ';margin-left:18px' : '') + '">' +
    '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
      stateIcon +
      stagePill +
      '<span style="font-size:12px;font-weight:600;color:var(--fg);word-break:break-all">' + escHtml(d.doc_name) + '</span>' +
      '<span style="color:var(--muted)">→</span>' +
      current +
      badge +
      srcSel +
      autoCb +
      '<span style="flex:1"></span>' +
      '<span style="font-size:10px;color:var(--muted);white-space:nowrap">' + (d.version_count || (d.versions ? d.versions.length : 0)) + ' 个版本</span>' +
      actions +
    '</div>' +
    versionsHtml +
  '</div>';
}

function _svToggleDoc(sourceType, docId) {
  var key = _svDocKey(sourceType, docId);
  _svExpanded[key] = !_svExpanded[key];
  var tglKey = key.replace(/[^a-zA-Z0-9]/g, '_');
  var el = document.getElementById('sv-vers-' + tglKey);
  if (el) el.style.display = _svExpanded[key] ? '' : 'none';
  var btn = document.getElementById('sv-tgl-' + tglKey);
  if (btn) {
    btn.innerHTML = _svExpanded[key] ? '&#9650;' : '&#9660;';
    btn.title = _svExpanded[key] ? '收起' : '展开全部版本';
  }
}

// 版本汇总：单一来源的最终交付清单（业务软件 / FPGA开发 每项一个来源），按 组件/版本状态/版本路径 表格展示
function _svSummaryRows() {
  var groups = (_svData && _svData.groups) || [];
  // 单一来源口径：项目发布子项（软件发布 / 各 FPGA 板卡子文档）选择「使用项目侧发布版本」
  // （含默认）即代表开发人员确定该交付项（业务软件 / FPGA开发）的最终版本走项目侧，
  // 同阶段的产品基础版本不再进入版本汇总 —— 避免同一阶段出现两个来源。
  //   stageProjectOwned：整阶段被项目侧项目文档占据（软件发布；无板卡拆分时通用 FPGA 文档）
  //   boardProjectOwned：某产品板卡的 FPGA 子文档为项目侧 → 该产品 FPGA基础版本不参与汇总
  var stageProjectOwned = {};
  var boardProjectOwned = {};
  groups.forEach(function(g) {
    if (g.type !== 'project') return;
    (g.docs || []).forEach(function(d) {
      if (d.fpga_parent) return;                     // FPGA 容器行不直接占据阶段
      if (d.fpga_child) {
        if (!d.doc_auto && d.product_code) boardProjectOwned[d.product_code] = true;
      } else if (!d.doc_auto) {
        stageProjectOwned[d.stage || ''] = true;
      }
    });
  });
  var rows = [];
  groups.forEach(function(g) {
    if (_svTypeFilter === 'project' && g.type !== 'project') return;
    if (_svTypeFilter === 'product' && g.type !== 'product') return;
    if (_svProdFilter !== 'all' && g.key !== _svProdFilter) return;
    (g.docs || []).forEach(function(d) {
      // 汇总口径：已锁定版本 → ✅ 交付；未锁定但有当前解析版本（当前跟踪来源最新，
      // 如 项目侧 软件发布 自身的发布版本、产品基础版本自动跟踪）→ 自动 一并列出；
      // 自动 FPGA 子文档(fpga_child) 即使尚无版本（未提交）也列出 —— 让测试/项目管理
      // 能区分「FPGA 未提交」与「无需提供」。
      if (!d.current && !d.fpga_child) return;   // 无当前版本且非板卡子文档 → 不汇总
      if (d.covered) return;          // 被项目侧同阶段「使用产品基础版本」覆盖 → 不单独汇总（阶段级互斥）
      if (g.type === 'product') {
        // 单一来源：同阶段已被项目侧项目发布占据 → 该产品基础版本不是最终交付，不参与汇总
        var shadowed = !!stageProjectOwned[d.stage || ''];
        if (!shadowed && (d.stage || '') === 'FPGA开发') shadowed = !!boardProjectOwned[g.code || ''];
        if (shadowed) return;
        // 产品基础版本文档：手动管理模式（doc_auto=0）且未锁定 → 用户未承诺任何版本，不进入汇总
        if (!d.doc_auto && !d.locked) return;
      }
      if (!_svDocMatch(d)) return;
      var sorted = (d.versions || []).slice().sort(function(a, b) { return (b.date || '').localeCompare(a.date || ''); });
      var latestVer = sorted.length ? sorted[0].version : null;
      var curVer = null;
      (d.versions || []).forEach(function(v) { if (v.version === d.current) curVer = v; });
      // 分类：项目来源=阶段，产品基础版本=产品文档的分类（即 stage）；自动 FPGA 子文档携带其产品编号
      // 版本来源 = 实际来源：项目发布子项若切了「使用产品基础版本」(doc_auto=1) 则其版本来自产品侧
      rows.push({
        stage: d.stage || '',
        doc_name: d.doc_name,
        source: g.type === 'product' || d.doc_auto ? '产品基础版本' : '项目发布',
        product_code: g.type === 'product' ? (g.code || '') : (d.product_code || null),
        version: d.current,
        url: curVer ? curVer.url : null,
        locked: !!d.locked,
        has_newer: !!d.has_newer,
        is_latest: !!latestVer && d.current === latestVer
      });
    });
  });
  return rows;
}

function _svRenderSummary() {
  var rows = _svSummaryRows();
  if (!rows.length) {
    return '<div style="text-align:center;padding:30px;font-style:italic;color:var(--muted)">暂无版本汇总<br><span style="font-size:11px">已锁定或有当前解析版本的文档会在此汇总最终交付版本（未锁定的标「自动」）</span></div>';
  }
  // 同来源+同产品的【连续】行合并（版本来源 + 产品编号 列 rowspan）。
  // 仅相邻连续行合并；跨组同 key 行（如项目发布子项切产品侧后其行与产品卡同名产品行）
  // 位置不相邻，各自渲染，避免 rowspan 误吞中间行。
  var spanOf = [];
  var s0 = 0;
  while (s0 < rows.length) {
    var e0 = s0;
    while (e0 + 1 < rows.length &&
           rows[e0 + 1].source === rows[s0].source &&
           (rows[e0 + 1].product_code || '') === (rows[s0].product_code || '')) {
      e0++;
    }
    for (var kk = s0; kk <= e0; kk++) spanOf[kk] = (kk === s0) ? (e0 - s0 + 1) : 0;
    s0 = e0 + 1;
  }
  var trs = rows.map(function(r, i) {
    var rowspan = spanOf[i] || 0;
    var mergeTd = '';
    if (rowspan) {
      var prodCell = r.product_code
        ? '<span class="proj-code-btn" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" onclick="event.stopPropagation();openProductDetail(\'' + escHtml(r.product_code) + '\')" title="' + escHtml(r.product_code) + '">' + escHtml(r.product_code) + '</span>'
        : '<span style="font-size:12px;color:var(--muted)">——</span>';
      mergeTd = '<td rowspan="' + rowspan + '" style="padding:8px 12px;vertical-align:middle;white-space:nowrap">' + escHtml(r.source) + '</td>' +
                '<td rowspan="' + rowspan + '" style="padding:8px 12px;vertical-align:middle;white-space:nowrap">' + prodCell + '</td>';
    }
    var status;
    if (r.version) {
      if (r.locked) {
        // 已锁定（手动锁定或自动锁行）→ ✅ 确认交付
        status = '<span style="color:var(--success);font-weight:700;margin-right:4px" title="已锁定为当前版本">✅</span>';
        status += '<span style="font-family:var(--mono);font-weight:600;color:var(--success);word-break:break-all">' + escHtml(r.version) + '</span>';
      } else {
        // 未锁定但来源已解析出当前版本（自动跟踪来源）→ 标 自动，与手动锁定的 ✅ 区分
        status = '<span style="display:inline-block;border:1px solid var(--accent);color:var(--accent);border-radius:4px;font-size:10px;line-height:1.4;padding:0 5px;margin-right:4px" title="未锁定：自动跟踪当前版本来源（如需固定可选具体版本后锁定）">自动</span>';
        status += '<span style="font-family:var(--mono);font-weight:600;color:var(--fg);word-break:break-all">' + escHtml(r.version) + '</span>';
      }
      if (r.is_latest) status += '<span class="tag-badge tag-4" style="margin-left:6px">最新</span>';
      else if (r.has_newer) status += '<span class="tag-badge tag-2" style="margin-left:6px">非最新</span>';
    } else {
      status = '<span style="font-size:11px;color:var(--warn);font-weight:600;font-style:italic">未提交</span>';
    }
    var path = r.url
      ? '<a href="' + escHtml(r.url) + '" target="_blank" title="' + escHtml(r.url) + '" style="font-family:var(--mono);font-size:11px;color:var(--accent);text-decoration:none;word-break:break-all">' + escHtml(r.url) + '</a>'
      : '<span style="color:var(--muted);font-size:11px">—</span>';
    var op = r.url
      ? '<button class="btn-icon" title="复制链接" onclick="_svCopyUrl(' + escJs(r.url) + ',\x27' + escJs(r.version) + '\x27)">&#128203;</button>'
      : '<span style="color:var(--muted);font-size:11px">—</span>';
    // 列顺序：版本名字 / 分类 / 版本信息 / 版本路径 / 版本来源+产品编号(合并) / 操作
    return '<tr style="border-bottom:1px solid var(--border)">' +
      '<td style="padding:8px 12px;font-weight:700;vertical-align:top">' + escHtml(r.doc_name) + '</td>' +
      '<td style="padding:8px 12px;vertical-align:top;white-space:nowrap"><span style="font-size:11px;color:var(--muted)">' + escHtml(r.stage) + '</span></td>' +
      '<td style="padding:8px 12px;vertical-align:top">' + status + '</td>' +
      '<td style="padding:8px 12px;vertical-align:top;min-width:200px">' + path + '</td>' +
      mergeTd +
      '<td style="padding:8px 12px;vertical-align:middle;white-space:nowrap;text-align:center">' + op + '</td>' +
    '</tr>';
  }).join('');
  return '<table style="width:100%;border-collapse:collapse;font-size:12px">' +
    '<thead><tr style="background:var(--bg-lt);text-align:left">' +
      '<th style="padding:8px 12px;border-bottom:1px solid var(--border);font-size:11px;color:var(--muted)">版本名字</th>' +
      '<th style="padding:8px 12px;border-bottom:1px solid var(--border);font-size:11px;color:var(--muted)">分类</th>' +
      '<th style="padding:8px 12px;border-bottom:1px solid var(--border);font-size:11px;color:var(--muted)">版本信息</th>' +
      '<th style="padding:8px 12px;border-bottom:1px solid var(--border);font-size:11px;color:var(--muted)">版本路径</th>' +
      '<th style="padding:8px 12px;border-bottom:1px solid var(--border);font-size:11px;color:var(--muted)">版本来源</th>' +
      '<th style="padding:8px 12px;border-bottom:1px solid var(--border);font-size:11px;color:var(--muted)">产品编号</th>' +
      '<th style="padding:8px 12px;border-bottom:1px solid var(--border);font-size:11px;color:var(--muted);text-align:center">操作</th>' +
    '</tr></thead><tbody>' + trs + '</tbody></table>';
}

function _svSetView(v) { _svView = v; renderVersionsTab(); }
function _svSetType(v) { _svTypeFilter = v; renderVersionsTab(); }
function _svSetProd(v) { _svProdFilter = v; renderVersionsTab(); }
// 版本来源切换确认弹窗（阶段级互斥：切换后项目仓库发布 / 产品基础版本二选一）
function _svConfirmToggle(title, message, onOk, onCancel) {
  openDialog(title,
    '<div style="padding:16px 18px;font-size:13px;color:var(--fg);line-height:1.8">' + message + '</div>',
    [
      { text: '取消', cls: '', onclick: function() { this.closest('.note-dialog-overlay').remove(); if (onCancel) onCancel(); } },
      { text: '确认切换', cls: 'btn-danger', onclick: function() { this.closest('.note-dialog-overlay').remove(); onOk(); } },
    ],
    { maxWidth: 460 }
  );
}

async function _svToggleBspAuto(checked) {
  if (!_svCanEdit()) { showToast('无编辑权限', 'error'); return; }
  try {
    await API.post('/projects/' + _comboCurCode + '/software-versions/bsp-auto-latest', { enabled: checked });
    showToast(checked ? '已开启「全部使用最新版本」，所有产品基础版本将自动锁定最新版本' : '已关闭「全部使用最新版本」，恢复手动选择', 'success');
    _svEmitLockChanged();
  } catch(e) { showToast('切换失败: ' + (e.message || ''), 'error'); }
}

// 子项级「使用最新版本」开关（仅产品基础版本组文档；项目发布组来源由来源下拉管理）
async function _svToggleDocAuto(sourceType, docId, label, el) {
  if (!_svCanEdit()) { showToast('无编辑权限', 'error'); return; }
  _svDoDocAuto(sourceType, docId, label, !!el.checked);
}

// 项目发布子项「版本来源」下拉：使用项目侧发布版本（project，默认）↔ 使用产品基础版本（product）
// 切换涉及阶段级来源互斥（同阶段产品文档 covered），弹确认框；取消则还原下拉值
function _svChangeSource(sourceType, docId, docName, el) {
  if (!_svCanEdit()) { showToast('无编辑权限', 'error'); return; }
  var cur = el && el.getAttribute('data-cur');
  var on = el && el.value === 'product';
  if ((cur === 'product' && on) || (cur === 'project' && !on)) { return; } // 未变化（如程序重绘）
  var msg = on
    ? '「' + escHtml(docName) + '」将改用<b>使用产品基础版本</b>：<br>· 版本列表改为关联产品对应阶段的发布版本，默认自动锁定并跟随产品侧基础版本最新，也可在展开的版本列表中手动锁定任一产品版本；<br>· <b>项目仓库发布的版本将不再参与版本汇总</b>，产品卡上同阶段基础版本文档灰显（该板卡不覆盖任何其他板卡，其余板卡来源保持不变）。<br><br>确认切换？'
    : '「' + escHtml(docName) + '」将<b>恢复使用项目侧发布版本</b>：版本来自本项目仓库 GitLab 发布，按项目文档模板显示匹配结果；产品卡同阶段基础版本文档恢复单独管理。<br><br>确认切换？';
  _svConfirmToggle('切换版本来源', msg, function() {
    _svDoChangeSource(sourceType, docId, docName, on, el);
  }, function() {
    if (el) el.value = cur; // 取消 → 还原下拉
  });
}

async function _svDoChangeSource(sourceType, docId, docName, on, el) {
  try {
    await API.post('/projects/' + _comboCurCode + '/software-versions/doc-auto', { source_type: sourceType, doc_id: docId, enabled: on });
    if (el) el.setAttribute('data-cur', on ? 'product' : 'project');
    showToast('「' + docName + '」已切换为' + (on ? '使用产品基础版本' : '使用项目侧发布版本'), 'success');
    _svEmitLockChanged();
  } catch(e) {
    showToast('切换失败: ' + (e.message || ''), 'error');
    if (el) el.value = (el.getAttribute('data-cur') || 'project'); // 失败还原
  }
}

async function _svDoDocAuto(sourceType, docId, label, on) {
  try {
    await API.post('/projects/' + _comboCurCode + '/software-versions/doc-auto', { source_type: sourceType, doc_id: docId, enabled: on });
    showToast((on ? '已开启「' : '已关闭「') + label + '」', 'success');
    _svEmitLockChanged();
  } catch(e) { showToast('切换失败: ' + (e.message || ''), 'error'); }
}
function _svSetKeyword(v) {
  _svKeyword = v;
  var body = document.getElementById('versions-body');
  if (body) body.innerHTML = _svRenderBody();
}

function _svCopyAll() {
  var rows = _svSummaryRows();
  if (!rows.length) { showToast('暂无版本链接', 'info'); return; }
  var lines = rows.map(function(r) {
    return (r.stage + ' ' + r.doc_name) + '\t' + (r.source || '') + '\t' + (r.product_code || '——') + '\t' + (r.version || '未提交') + (r.url ? '\t' + r.url : '');
  });
  _svCopyText(lines.join('\n'), '全部版本链接');
}

function _svExportCsv() {
  var rows = _svSummaryRows();
  if (!rows.length) { showToast('暂无版本数据', 'info'); return; }
  var csvRows = [['版本来源', '产品编号', '分类', '版本名字', '版本信息', '版本路径']];
  rows.forEach(function(r) {
    var status = r.version || '未提交';
    if (r.locked) status = '✅ ' + status;
    if (r.is_latest) status += ' 最新';
    else if (r.has_newer) status += ' 非最新';
    csvRows.push([r.source || '', r.product_code || '——', r.stage || '', r.doc_name, status, r.url || '']);
  });
  var csv = csvRows.map(function(r) {
    return r.map(function(c) {
      var s = String(c == null ? '' : c);
      if (/[",\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
      return s;
    }).join(',');
  }).join('\r\n');
  var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '软件版本_' + _comboCurCode + '_' + fmtLocalDate() + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
  showToast('已导出 CSV', 'success');
}

/* ── 锁定 / 解锁 ── */

async function _svToggleRowLock(sourceType, docId, version, docName, el) {
  if (el && el.checked) await lockVersion(sourceType, docId, version, docName);
  else await unlockVersion(sourceType, docId, docName);
}

async function lockVersion(sourceType, docId, version, docName) {
  if (!version) return;
  try {
    await API.post('/projects/' + _comboCurCode + '/software-versions/lock', { source_type: sourceType, doc_id: docId, version: version });
    showToast('已锁定版本：' + version + (docName ? '（' + docName + '）' : ''), 'success');
    _svEmitLockChanged();
  } catch(e) { showToast('操作失败: ' + (e.message || ''), 'error'); }
}

async function unlockVersion(sourceType, docId, docName) {
  try {
    await API.post('/projects/' + _comboCurCode + '/software-versions/unlock', { source_type: sourceType, doc_id: docId });
    showToast('已恢复自动最新' + (docName ? '（' + docName + '）' : ''), 'success');
    _svEmitLockChanged();
  } catch(e) { showToast('操作失败: ' + (e.message || ''), 'error'); }
}

async function _svReload() {
  try {
    var resp = await API.get('/projects/' + _comboCurCode + '/software-versions');
    _svData = (resp && resp.data) ? resp.data : resp;
    renderVersionsTab();
  } catch(e) { showToast('刷新失败: ' + (e.message || ''), 'error'); }
}

/* ── 版本锁定实时刷新：EventBus（同页面多视图）+ BroadcastChannel（跨浏览器标签页） ──
   任何锁定/解锁/自动模式切换后发送事件；打开的同一项目页面订阅后自动刷新，无需手动操作。 */

var _svRealtimeRegistered = false;
var _svLockChannel = null;

function _svOnLockChanged(e) {
  // 只刷新正在查看该项目软件版本/汇总的页面；其他项目不打扰
  if (e && e.projectCode && e.projectCode !== _comboCurCode) return;
  _svReload();
}

function _svEmitLockChanged() {
  EventBus.emit(EVENTS.RELEASE_LOCK_CHANGED, { projectCode: _comboCurCode });
  try {
    if (_svLockChannel) _svLockChannel.postMessage({ projectCode: _comboCurCode });
  } catch(e) {}
}

function _svRegisterRealtime() {
  if (_svRealtimeRegistered) return;
  _svRealtimeRegistered = true;
  EventBus.on(EVENTS.RELEASE_LOCK_CHANGED, _svOnLockChanged);
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      _svLockChannel = new BroadcastChannel('pma-release-lock');
      _svLockChannel.onmessage = function(e) { _svOnLockChanged(e && e.data); };
    }
  } catch(e) {}
}

function gotoStageDetail(idx) {
  var stages = _lastGanttStages;
  if (!stages || !stages[idx]) return;
  var stageName = stages[idx].standard_stage || stages[idx].name;
  if (!stageName) return;
  _scrollToStageTasks(stageName);
}

/* Jump to stage tasks from maintenance page (or any page) — reuse scroll+flash logic */
function gotoStageTasksFromMaint(stageName) {
  if (!stageName) return;
  switchDTab('pma-tasks');
  _scrollToStageTasks(stageName);
}

function _scrollToStageTasks(stageName) {
  switchDTab('pma-tasks');
  var tries = 0;
  var doScroll = function() {
    var rows = document.querySelectorAll('.task-stage-row[data-stage="' + stageName + '"]');
    if (rows.length) {
      document.querySelectorAll('.stage-row-flash').forEach(function(r) { r.classList.remove('stage-row-flash'); });
      var flashCount = 0;
      var maxFlashes = 6;
      var flashInterval = setInterval(function() {
        rows.forEach(function(r) { r.classList.toggle('stage-row-flash'); });
        if (++flashCount >= maxFlashes) clearInterval(flashInterval);
      }, 500);
      rows[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (++tries < 30) {
      setTimeout(doScroll, 200);
    }
  };
  setTimeout(doScroll, 200);
}

/* ── Project Maintenance ── */

function buildMaintenance() {
  if (!_comboCurCode) return;
  var user = getCurrentUser();
  var perms = (user && user.permissions) ? user.permissions.split(',') : [];
  var hasPerm = perms.indexOf('project_edit') >= 0 || perms.indexOf('admin') >= 0;
  var dt = document.getElementById('dt-maintenance');
  if (dt) dt.style.display = hasPerm ? '' : 'none';
  if (!hasPerm) return;

  // Render edit/delete action buttons
  var actions = document.getElementById('maint-actions');
  if (actions) {
    actions.innerHTML =
      '<button class="btn btn-primary" style="font-size:11px;padding:5px 12px" onclick="showProjectEditDialog()">✎ 编辑项目</button>' +
      '<button class="btn" style="font-size:11px;padding:5px 12px;color:var(--danger);border-color:var(--danger)" onclick="deleteCurrentProject()">✕ 删除项目</button>';
  }

  loadMaintProjectProducts();
  loadMaintProjectCustomers();
  loadMaintProjectTags();
  loadMaintProjectStages();
}

// ── Project Edit Dialog ──

// ── Unified Project Form Dialog (Create + Edit) ──

var _projFormSelectedPids = [];   // selected product IDs
var _projFormSelectedProdQtys = {};  // product_id -> quantity
var _projFormLinkedCodes = [];    // selected linked project codes
var _projFormConvertSource = null; // LSJ source project for conversion mode
var _projFormSelectedTags = [];   // selected tag names
var _projFormAllTagsFull = [];    // all tags (for dialog)

function showProjectFormDialog(isEdit, convertSource) {
  _projFormIsEdit = !!isEdit;
  _projFormOrigType = (isEdit && _projDetail && _projDetail.project_type) ? _projDetail.project_type : '';
  var p = isEdit ? _projDetail : null;
  var isConvert = !!convertSource;
  _projFormConvertSource = convertSource || null;
  var title = isConvert ? ('商机转化 — ' + escHtml(convertSource.name || ''))
             : isEdit ? ('编辑项目 — ' + escHtml(p ? p.name : ''))
             : '新建项目';

  // Load all dropdown options in parallel
  Promise.all([
    API.get('/users/customers/names').catch(function() { return []; }),
    API.get('/tags').catch(function() { return []; }),
    API.get('/users/project-options').catch(function() { return []; }),
    API.get('/doc-templates/project-types').catch(function() { return []; }),
  ]).then(function(results) {
    var custNames = results[0] || [];
    var allTags = results[1] || [];
    var projectOpts = results[2] || [];
    var projectTypes = results[3] || [];
    if (!projectTypes.length) projectTypes = [{id: 'RD', label: '研发项目'}, {id: 'SC', label: '生产项目'}];

    _projFormSelectedPids = [];
    _projFormSelectedProdQtys = {};
    _projFormLinkedCodes = [];
    _projFormSelectedTags = [];
    // Pre-fill for edit or convert mode
    if ((isEdit || isConvert) && (p || convertSource)) {
      var src = isConvert ? convertSource : p;
      if (src.linked_products) {
        _projFormSelectedPids = src.linked_products.map(function(lp) { return lp.id; });
        src.linked_products.forEach(function(lp) { _projFormSelectedProdQtys[lp.id] = lp.quantity || 1; });
      }
      if (src.linked_project_ids) {
        _projFormLinkedCodes = src.linked_project_ids.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
      }
      if (src.tags) {
        _projFormSelectedTags = src.tags.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
      }
    }

    // In convert mode, use source data as form pre-fill (but keep name/code empty for user input)
    if (isConvert) {
      p = {
        customer_name: convertSource.customer_name,
        begin: convertSource.begin,
        end: convertSource.end,
        estimate: convertSource.estimate,
        planned_delivery_qty: convertSource.planned_delivery_qty,
        tags: convertSource.tags,
        linked_products: convertSource.linked_products,
        linked_project_ids: convertSource.linked_project_ids
      };
    }

    var tagNames = allTags.filter(function(t) { return t.category === 'project' || !t.category || t.category === ''; }).map(function(t) { return t.name; });

    var user = getCurrentUser();
    var perms = (user && user.permissions) ? user.permissions.split(',') : [];
    var hasCustomerPerm = perms.indexOf('customer_link') >= 0 || perms.indexOf('admin') >= 0;

    function dl(id, options, selected, placeholder) {
      var sel = selected || '';
      var ph = placeholder || '输入搜索或选择...';
      return '<div style="position:relative">' +
        '<input class="search-inp" id="' + id + '" list="' + id + '-list" value="' + escHtml(sel) + '" style="width:100%;box-sizing:border-box;padding-right:28px" autocomplete="off" placeholder="' + ph + '">' +
        '<span style="position:absolute;right:10px;top:50%;transform:translateY(-50%);pointer-events:none;color:var(--muted);font-size:10px">▼</span>' +
        '<datalist id="' + id + '-list">' + options.map(function(o) {
          var val = typeof o === 'string' ? o : o.name;
          return '<option value="' + escHtml(val) + '">';
        }).join('') + '</datalist></div>';
    }

    // Product selection: search combo with multi-select (like linked projects)
    var prodSelectedText = '';
    if ((isEdit || isConvert) && src && src.linked_products) {
      prodSelectedText = src.linked_products.map(function(lp) {
        return lp.code || lp.name || '';
      }).join(', ');
    }

    // Linked projects: use search combo component
    var linkedProjSelected = (isEdit || isConvert) ? (src ? (src.linked_project_ids || '') : '') : '';

    // Code field: readonly by default, admin can unlock via edit icon
    var codeReadonly = ' readonly';
    var codeBg = 'background:var(--border);cursor:not-allowed';
    var codeEditIcon = '<span id="proj-form-code-edit" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);cursor:pointer;font-size:15px;opacity:0.4;display:none" title="编辑编号" onclick="_unlockProjCode()">&#9998;</span>';

    var bodyHtml =
      // Row 1: 项目编号 with admin edit icon on the right
      '<div style="margin-bottom:10px"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">项目编号 <span style="color:var(--danger)">*</span>' + (!isEdit ? ' <span style="color:var(--muted)">（自动生成）</span>' : '') + '</label>' +
      '<div style="position:relative">' +
      '<input class="search-inp" id="proj-form-code" value="' + escHtml((p && p.code) || '') + '"' + codeReadonly + ' style="width:100%;box-sizing:border-box;' + codeBg + '" placeholder="自动生成">' +
      codeEditIcon +
      '</div>' +
      '<div id="proj-form-code-hint" style="display:none;font-size:10px;color:var(--danger);margin-top:1px">请输入项目编号</div></div>' +
      // Row 2: 项目名称
      '<div style="margin-bottom:10px"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">项目名称 *</label>' +
      '<input class="search-inp" id="proj-form-name" value="' + escHtml((p && p.name) || '') + '" style="width:100%;box-sizing:border-box" placeholder="项目名称（不能包含空格）">' +
    '<div id="proj-form-name-hint" style="display:none;font-size:10px;color:var(--danger);margin-top:1px">请输入项目名称（不能包含空格）</div></div>' +
      // Row 3: 项目类型 | 客户名称
      '<div style="display:flex;gap:10px;margin-bottom:10px">' +
        '<div style="flex:1"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">项目类型</label>' +
          '<select class="search-inp" id="proj-form-type" style="width:100%;box-sizing:border-box" onchange="_projFormTypeChanged()">' +
            projectTypes.map(function(pt) {
              var sel = (p && p.project_type === pt.id) || (!isEdit && pt.id === 'RD');
              return '<option value="' + escHtml(pt.id) + '"' + (sel ? ' selected' : '') + '>' + escHtml(pt.label) + '</option>';
            }).join('') +
          '</select>' +
          '<div id="proj-form-type-hint" style="display:none;font-size:10px;color:var(--danger);margin-top:1px">请选择项目类型</div></div>' +
        '<div style="flex:1"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">客户名称 <span style="color:var(--danger)">*</span></label>' +
        '<div style="display:flex;gap:4px;align-items:flex-end"><div class="proj-combo" style="flex:1" id="proj-form-customer-combo">' +
        '<input class="proj-combo-input" id="proj-form-customer" value="' + escHtml(p ? p.customer_name || '' : '') + '" autocomplete="off" placeholder="搜索选择已有客户..." onfocus="projFormCustomerComboOpen()" oninput="projFormCustomerComboFilter(this.value)" onclick="projFormCustomerComboOpen()">' +
        '<svg class="proj-combo-arrow" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="2,5 7,10 12,5"/></svg>' +
        '<div class="proj-combo-dropdown" id="proj-form-customer-dd"></div>' +
        '<svg class="proj-combo-arrow" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="2,5 7,10 12,5"/></svg>' +
        '<div class="proj-combo-dropdown" id="proj-form-customer-dd"></div>' +
        '</div>' +
        (hasCustomerPerm ? '<button type="button" onclick="projFormCreateCustomer()" title="新建客户" style="flex-shrink:0;margin-bottom:1px;width:28px;height:28px;border:1px solid var(--accent);border-radius:6px;background:var(--accent-lt);color:var(--accent);font-size:16px;cursor:pointer">+</button>' : '') + '</div>' +
        '<div id="proj-form-customer-hint" style="display:none;font-size:10px;color:var(--danger);margin-top:1px">请选择客户</div></div>' +
      '</div>' +
      // Row 4: 关联产品（搜索下拉多选）
      '<div style="margin-bottom:10px"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">关联产品</label>' +
      '<div class="proj-combo" id="proj-form-prod-combo">' +
      '<input class="proj-combo-input" id="proj-form-prod-input" value="' + escHtml(prodSelectedText) + '" autocomplete="off" placeholder="搜索选择产品（可多选）..." onfocus="projFormProdComboOpen()" oninput="projFormProdComboFilter(this.value)" onclick="projFormProdComboOpen()">' +
      '<svg class="proj-combo-arrow" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="2,5 7,10 12,5"/></svg>' +
      '<div class="proj-combo-dropdown" id="proj-form-prod-dd"></div>' +
      '</div>' +
      '<div id="proj-form-prod-selected" style="margin-top:6px"></div>' +
      '</div>' +
      // Row 5: 计划开始 | 计划结束 | 项目状态
      '<div style="display:flex;gap:10px;margin-bottom:10px">' +
        '<div style="flex:1"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">计划开始 <span style="color:var(--danger)">*</span></label>' +
          '<input class="search-inp" id="proj-form-begin" type="date" value="' + ((p && p.begin) || '') + '" style="width:100%;box-sizing:border-box">' +
          '<div id="proj-form-begin-hint" style="display:none;font-size:10px;color:var(--danger);margin-top:1px">请选择计划开始</div></div>' +
        '<div style="flex:1"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">计划结束 <span style="color:var(--danger)">*</span></label>' +
          '<input class="search-inp" id="proj-form-end" type="date" value="' + ((p && p.end) || '') + '" style="width:100%;box-sizing:border-box">' +
          '<div id="proj-form-end-hint" style="display:none;font-size:10px;color:var(--danger);margin-top:1px">请选择计划结束</div></div>' +
        '<div style="flex:1"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">项目状态</label>' +
          '<select class="search-inp" id="proj-form-status" style="width:100%;box-sizing:border-box">' +
            '<option value="wait"' + ((p && p.raw_status === 'wait') || (!isEdit) ? ' selected' : '') + '>待启动</option>' +
            '<option value="doing"' + (p && p.raw_status === 'doing' ? ' selected' : '') + '>进行中</option>' +
            '<option value="suspended"' + (p && p.raw_status === 'suspended' ? ' selected' : '') + '>已挂起</option>' +
            '<option value="done"' + (p && p.raw_status === 'done' ? ' selected' : '') + '>已完成</option>' +
            '<option value="closed"' + (p && p.raw_status === 'closed' ? ' selected' : '') + '>已关闭</option>' +
            '<option value="abolished"' + (p && p.raw_status === 'abolished' ? ' selected' : '') + '>已废止</option>' +
          '</select></div>' +
      '</div>' +
      // Row 5b: 老项目跟踪标记（convert 模式隐藏）
      (!isConvert ? '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">' +
        '<input type="checkbox" id="proj-form-tracking"' + ((p && p.tracking_only) ? ' checked' : '') + ' style="width:16px;height:16px;cursor:pointer;accent-color:var(--accent)">' +
        '<label for="proj-form-tracking" style="font-size:12px;color:var(--muted);cursor:pointer">研发基本完成，仅需跟踪（不自动创建模板任务，可手动导入/创建）</label>' +
        '</div>' : '') +
      // Row 6: 实际开始 | 实际结束
      '<div style="display:flex;gap:10px;margin-bottom:10px">' +
        '<div style="flex:1"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">实际开始</label>' +
          '<input class="search-inp" id="proj-form-real-began" type="date" value="' + ((p && p.real_began) || '') + '" style="width:100%;box-sizing:border-box"></div>' +
        '<div style="flex:1"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">实际结束</label>' +
          '<input class="search-inp" id="proj-form-real-end" type="date" value="' + ((p && p.real_end) || '') + '" style="width:100%;box-sizing:border-box"></div>' +
      '</div>' +
      // Row 7: 预估总工时 | 实际总工时
      '<div style="display:flex;gap:10px;margin-bottom:10px">' +
        '<div style="flex:1"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">预估总工时</label>' +
          '<input class="search-inp" id="proj-form-estimate" type="number" value="' + ((p && p.estimate != null) ? p.estimate : '') + '" style="width:100%;box-sizing:border-box">' +
    '<div id="proj-form-estimate-hint" style="display:none;font-size:10px;color:var(--danger);margin-top:1px">请填写预估工时</div></div>' +
        '<div style="flex:1"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">实际总工时</label>' +
          '<input class="search-inp" id="proj-form-consumed" type="number" value="' + ((p && p.consumed != null) ? p.consumed : '') + '" style="width:100%;box-sizing:border-box"></div>' +
      '</div>' +
      // Row 8: 交付数量 | 标签
      '<div style="display:flex;gap:10px;margin-bottom:10px">' +
        '<div style="flex:1"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">交付数量</label>' +
          '<input class="search-inp" id="proj-form-delivery-qty" type="number" value="' + ((p && p.planned_delivery_qty != null) ? p.planned_delivery_qty : '') + '" style="width:100%;box-sizing:border-box"></div>' +
        '<div style="flex:1"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">标签</label>' +
        '<div id="proj-form-tags-section" style="min-height:36px;display:flex;flex-wrap:wrap;gap:4px;align-items:center;padding:4px 0">' +
        '<span style="font-size:12px;color:var(--muted)">加载中...</span>' +
        '</div></div>' +
      '</div>' +
      // Row 9: 关联项目
      '<div style="margin-bottom:4px"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">关联项目</label>' +
      '<div class="proj-combo" id="proj-form-linked-combo">' +
      '<input class="proj-combo-input" id="proj-form-linked-input" value="' + escHtml(linkedProjSelected) + '" autocomplete="off" placeholder="搜索选择项目..." onfocus="projFormLinkedComboOpen()" oninput="projFormLinkedComboFilter(this.value)" onclick="projFormLinkedComboOpen()">' +
      '<svg class="proj-combo-arrow" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="2,5 7,10 12,5"/></svg>' +
      '<div class="proj-combo-dropdown" id="proj-form-linked-dd"></div>' +
      '</div></div>';

    var buttons = [
      { text: '取消', onclick: 'closeSharedDialog()' },
      { text: isEdit ? '保存' : '创建', cls: 'btn-primary', onclick: isEdit ? 'saveProjectForm(true)' : 'saveProjectForm(false)' }
    ];

    openDialog(title,
      '<div style="max-height:70vh;overflow-y:auto;padding-right:4px">' + bodyHtml + '</div>',
      buttons, { hideClose: true, maxWidth: 560 }
    );

    // Auto-generate code for create mode
    if (!isEdit) setTimeout(function() { _autoGenProjCode(); }, 100);

    // Admin can edit code: show pencil icon on the right
    setTimeout(function() {
      var user = getCurrentUser();
      var perms = (user && user.permissions) ? user.permissions.split(',') : [];
      var isAdmin = user && (user.role === 'admin' || perms.indexOf('admin') >= 0);
      if (isAdmin) {
        var icon = document.getElementById('proj-form-code-edit');
        if (icon) icon.style.display = '';
      }
    }, 150);

    // Init customer search combo
    setTimeout(function() {
      if (typeof initSearchCombo === 'function') {
        initSearchCombo({
          comboId: 'proj-form-customer-combo',
          inputId: 'proj-form-customer',
          dropdownId: 'proj-form-customer-dd',
          dataSource: function(query) {
            var url = '/users/customers/names';
            if (query) url += '?search=' + encodeURIComponent(query);
            return API.get(url).then(function(names) {
              return (names || []).map(function(n) {
                var label = n.full_name ? n.name + ' (' + n.full_name + ')' : n.name;
                return {id: n.name, name: n.name, full_name: n.full_name, label: label};
              });
            }).catch(function() { return []; });
          },
          onSelect: function(p) { document.getElementById('proj-form-customer').value = p.name || p; }
        });
      }
    }, 150);

    // Init product search combo (multi-select)
    setTimeout(function() {
      if (typeof initSearchCombo === 'function') {
        initSearchCombo({
          comboId: 'proj-form-prod-combo',
          inputId: 'proj-form-prod-input',
          dropdownId: 'proj-form-prod-dd',
          dataSource: function() {
            return API.get('/product-management/all-products').then(function(products) {
              var items = [{id: '__future__', name: '🆕 未来新产品', code: ''}];
              (products || []).forEach(function(p) {
                items.push({id: p.id, name: p.name, code: p.code || ''});
              });
              return items;
            }).catch(function() { return [{id: '__future__', name: '🆕 未来新产品', code: ''}]; });
          },
          onSelect: function(p) {
            var el = document.getElementById('proj-form-prod-input');
            if (!el) return;
            if (p.id === '__future__') {
              // 未来新产品 — just append as text placeholder
              var current = el.value.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
              if (current.indexOf('未来新产品') < 0) current.push('未来新产品');
              el.value = current.join(', ');
              return;
            }
            var pid = parseInt(p.id);
            if (_projFormSelectedPids.indexOf(pid) < 0) {
              _projFormSelectedPids.push(pid);
              _projFormSelectedProdQtys[pid] = 1;
            }
            // Fetch all products to rebuild display text from selected IDs
            API.get('/product-management/all-products').then(function(products) {
              var names = [];
              _projFormSelectedPids.forEach(function(spid) {
                var prod = (products || []).find(function(x) { return x.id === spid; });
                if (prod) names.push(prod.code || prod.name || '');
              });
              el.value = names.join(', ');
            }).catch(function() {});
            _renderProjFormSelectedProds();
          }
        });
      }
    }, 250);

    // Init linked-projects search combo
    setTimeout(function() {
      if (typeof initSearchCombo === 'function') {
        initSearchCombo({
          comboId: 'proj-form-linked-combo',
          inputId: 'proj-form-linked-input',
          dropdownId: 'proj-form-linked-dd',
          dataSource: function() { return API.get('/users/project-options').catch(function() { return []; }); },
          onSelect: function(p) {
            var code = p.code || p.name;
            if (_projFormLinkedCodes.indexOf(code) < 0) _projFormLinkedCodes.push(code);
            var el = document.getElementById('proj-form-linked-input');
            if (el) el.value = _projFormLinkedCodes.join(', ');
          }
        });
      }
    }, 200);

    // Init tags: show badges with edit button (maintenance-style)
    _projFormAllTagsFull = allTags || [];
    _renderProjFormTags();
    // Render selected products with quantity inputs
    _renderProjFormSelectedProds();
  });
}

function _renderProjFormSelectedProds() {
  var container = document.getElementById('proj-form-prod-selected');
  if (!container) return;
  if (!_projFormSelectedPids.length) { container.innerHTML = ''; return; }
  // Fetch all products to get names for selected IDs
  API.get('/product-management/all-products').then(function(products) {
    var html = '';
    _projFormSelectedPids.forEach(function(pid) {
      var prod = (products || []).find(function(x) { return x.id === pid; });
      var name = prod ? (prod.code || prod.name) : ('ID:' + pid);
      var qty = _projFormSelectedProdQtys[pid] || 1;
      html += '<div style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:12px">' +
        '<span style="background:var(--accent-lt);color:var(--accent);padding:1px 8px;border-radius:4px;font-family:var(--mono);font-size:11px">' + escHtml(name) + '</span>' +
        '<span style="color:var(--muted);font-size:11px">数量:</span>' +
        '<input type="number" class="search-inp proj-form-prod-qty" value="' + qty + '" min="1" ' +
        'style="width:55px;padding:2px 6px;text-align:center;font-size:11px" ' +
        'onchange="_projFormProdQtyChange(' + pid + ', this.value)" onfocus="this.select()">' +
        '<span onclick="_projFormRemoveProd(' + pid + ')" style="cursor:pointer;opacity:0.4;font-size:14px;margin-left:4px" title="移除">&times;</span>' +
        '</div>';
    });
    container.innerHTML = html;
  }).catch(function() { container.innerHTML = ''; });
}

function _projFormProdQtyChange(pid, val) {
  _projFormSelectedProdQtys[pid] = Math.max(1, parseInt(val) || 1);
}

function _projFormRemoveProd(pid) {
  var idx = _projFormSelectedPids.indexOf(pid);
  if (idx >= 0) _projFormSelectedPids.splice(idx, 1);
  delete _projFormSelectedProdQtys[pid];
  _renderProjFormSelectedProds();
  // Update search combo display text
  var el = document.getElementById('proj-form-prod-input');
  if (!el) return;
  API.get('/product-management/all-products').then(function(products) {
    var names = [];
    _projFormSelectedPids.forEach(function(spid) {
      var prod = (products || []).find(function(x) { return x.id === spid; });
      if (prod) names.push(prod.code || prod.name || '');
    });
    el.value = names.join(', ');
  }).catch(function() {});
}


function projFormCreateCustomer() {
  // Save current dialog content so we can restore after customer creation
  var dialogEl = document.querySelector('.shared-dialog-overlay .note-dialog');
  window._savedProjFormContent = dialogEl ? dialogEl.innerHTML : null;
  var inp = 'width:100%;box-sizing:border-box;margin-top:1px';
  openDialog('新建客户',
    '<div>' +
      '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">客户名称 <span style="color:var(--danger)">*</span></label>' +
      '<input class="search-inp" id="new-cust-name" placeholder="如 CD-AKT（城市拼音-公司名首字母）" style="' + inp + '">' +
    '</div>' +
    '<div style="margin-top:8px">' +
      '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">客户全称</label>' +
      '<input class="search-inp" id="new-cust-fullname" placeholder="如 领目科技有限公司" style="' + inp + '">' +
    '</div>',
    [
      {text: '取消', onclick: 'restoreProjFormDialog()'},
      {text: '创建', cls: 'btn-primary', onclick: 'submitProjFormCreateCustomer()'}
    ],
    {maxWidth: 400}
  );
}

function restoreProjFormDialog() {
  if (window._savedProjFormContent) {
    var overlay = document.querySelector('.shared-dialog-overlay');
    if (overlay) overlay.innerHTML = '<div class="note-dialog" style="max-width:560px">' + window._savedProjFormContent + '</div>';
    window._savedProjFormContent = null;
  } else {
    closeSharedDialog();
  }
}

async function submitProjFormCreateCustomer() {
  var name = document.getElementById('new-cust-name').value.trim();
  var fullname = document.getElementById('new-cust-fullname').value.trim();
  if (!name) { showToast('请输入客户名称', 'error'); return; }
  try {
    await API.post('/customers', {name: name, full_name: fullname});
    showToast('客户已创建', 'success');
    // Restore project form dialog with customer name filled in
    if (window._savedProjFormContent) {
      var overlay = document.querySelector('.shared-dialog-overlay');
      if (overlay) overlay.innerHTML = '<div class="note-dialog" style="max-width:560px">' + window._savedProjFormContent + '</div>';
      window._savedProjFormContent = null;
      setTimeout(function() {
        var input = document.getElementById('proj-form-customer');
        if (input) input.value = name;
      }, 100);
    } else {
      closeSharedDialog();
    }
  } catch(e) { showToast('创建失败: ' + (e.message || ''), 'error'); }
}

function _unlockProjCode() {
  var codeEl = document.getElementById('proj-form-code');
  var icon = document.getElementById('proj-form-code-edit');
  if (!codeEl) return;
  codeEl.removeAttribute('readonly');
  codeEl.style.background = '';
  codeEl.style.cursor = '';
  codeEl.placeholder = '输入新编号（不可重复）';
  codeEl.focus();
  if (icon) icon.style.display = 'none';
}

function _renderProjFormTags() {
  var container = document.getElementById('proj-form-tags-section');
  if (!container) return;
  var names = _projFormSelectedTags.slice();
  var badgesHtml = names.length ? names.map(function(name) {
    var cls = 'tag-' + (name.length % 5);
    return '<span class="tag-badge ' + cls + '" style="font-size:11px;padding:2px 8px;display:inline-flex;align-items:center;gap:3px">' +
      '#' + escHtml(name) +
      ' <span data-tag-name="' + escHtml(name) + '" onclick="event.stopPropagation();_projFormRemoveTag(this.getAttribute(\'data-tag-name\'))" style="cursor:pointer;opacity:0.5;font-size:13px;line-height:1" title="移除">&times;</span></span>';
  }).join('') : '<span style="font-size:11px;color:var(--muted)">未选择</span>';
  container.innerHTML = badgesHtml +
    ' <button class="btn btn-xs" onclick="event.stopPropagation();_projFormOpenTagDialog()" style="font-size:11px;padding:1px 8px;margin-left:2px">选择标签</button>';
}

function _projFormRemoveTag(name) {
  var idx = _projFormSelectedTags.indexOf(name);
  if (idx >= 0) _projFormSelectedTags.splice(idx, 1);
  _renderProjFormTags();
}

function _projFormOpenTagDialog() {
  // Work on a temp copy; commit on Confirm, discard on Cancel
  window._projFormTmpTags = _projFormSelectedTags.slice();
  _projFormRenderTagDialog();
}

function _projFormRenderTagDialog() {
  var linkedNames = window._projFormTmpTags || [];
  var allTags = _projFormAllTagsFull;
  var projectTags = allTags.filter(function(t) { return t.category === 'project'; });
  var productTags = allTags.filter(function(t) { return t.category === 'product'; });
  var generalTags = allTags.filter(function(t) { return !t.category || t.category === ''; });

  var sections = [
    { title: '项目标签', color: 'var(--accent)', bg: 'var(--accent-lt)', tags: projectTags },
    { title: '产品标签', color: 'var(--success)', bg: 'var(--success-lt)', tags: productTags },
    { title: '通用标签', color: 'var(--muted)', bg: 'var(--bg)', tags: generalTags },
  ];

  var bodyHtml = '';
  sections.forEach(function(sec) {
    bodyHtml += '<div class="card" style="margin-bottom:10px;padding:12px 14px">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:' + (sec.tags.length ? '8px' : '2px') + '">' +
        '<span style="width:8px;height:8px;border-radius:50%;background:' + sec.color + '"></span>' +
        '<span style="font-weight:540;font-size:13px">' + sec.title + '</span>' +
        '<span style="font-size:11px;color:var(--muted)">' + sec.tags.length + '</span>' +
      '</div>';
    if (sec.tags.length) {
      bodyHtml += '<div style="display:flex;flex-wrap:wrap;gap:6px">';
      sec.tags.forEach(function(t) {
        var isLinked = linkedNames.indexOf(t.name) >= 0;
        bodyHtml += '<span class="tag-badge tag-' + (t.name.length % 5) + '" ' +
          'data-tag-name="' + escHtml(t.name) + '" onclick="_projFormToggleTmpTag(this.getAttribute(\'data-tag-name\'))" ' +
          'style="font-size:12px;padding:3px 12px;cursor:pointer;' +
          (isLinked ? '' : 'opacity:0.35') + '" ' +
          'title="' + (isLinked ? '点击移除' : '点击添加') + '">#' + escHtml(t.name) + '</span>';
      });
      bodyHtml += '</div>';
    } else {
      bodyHtml += '<div style="font-size:11px;color:var(--muted);font-style:italic">暂无</div>';
    }
    bodyHtml += '</div>';
  });

  openDialog('选择标签', bodyHtml,
    [{text: '取消', onclick: 'document.querySelector(\".proj-form-tag-overlay\")?.remove()'},
     {text: '确定', cls: 'btn-primary', onclick: '_projFormConfirmTags()'}],
    {maxWidth: 520, hideClose: true, overlayClass: 'proj-form-tag-overlay'});
}

function _projFormToggleTmpTag(name) {
  var tmp = window._projFormTmpTags || [];
  var idx = tmp.indexOf(name);
  if (idx >= 0) { tmp.splice(idx, 1); } else { tmp.push(name); }
  window._projFormTmpTags = tmp;
  _projFormRefreshTagDialogContent();
}

function _projFormRefreshTagDialogContent() {
  var linkedNames = window._projFormTmpTags || [];
  var allBadges = document.querySelectorAll('.proj-form-tag-overlay .tag-badge[data-tag-name]');
  allBadges.forEach(function(badge) {
    var name = badge.getAttribute('data-tag-name');
    if (linkedNames.indexOf(name) >= 0) {
      badge.style.opacity = '1';
      badge.title = '点击移除';
    } else {
      badge.style.opacity = '0.35';
      badge.title = '点击添加';
    }
  });
}

function _projFormConfirmTags() {
  _projFormSelectedTags = (window._projFormTmpTags || []).slice();
  delete window._projFormTmpTags;
  var ov = document.querySelector('.proj-form-tag-overlay');
  if (ov) ov.remove();
  _renderProjFormTags();
}

var _projFormIsEdit = false;
var _projFormOrigType = '';

function _projFormTypeChanged() {
  var typeEl = document.getElementById('proj-form-type');
  if (!typeEl) return;

  // In edit mode, warn about stage/doc/task reset before allowing type change
  if (_projFormIsEdit && typeEl.value !== _projFormOrigType) {
    // Store typeEl ref for onclick handlers (openDialog uses inline HTML onclick)
    window._projFormTypeChangedEl = typeEl;
    var newTypeLabel = typeEl.options[typeEl.selectedIndex].text;
    openDialog('⚠️ 切换项目类型',
      '<div style="font-size:13px;line-height:1.6">' +
        '<p>将项目类型切换为 <b>' + escHtml(newTypeLabel) + '</b> 后，系统将在保存时：</p>' +
        '<ul style="margin:8px 0;padding-left:18px">' +
          '<li><b>重置所有阶段</b> — 原阶段全部删除，按新类型重建</li>' +
          '<li><b>重置文档模板</b> — 原模板文档全部删除并重新同步</li>' +
          '<li><b>删除模板任务</b> — 所有模板生成的任务及关联工时和评论将被删除</li>' +
        '</ul>' +
        '<p style="color:var(--warning)">手动创建的任务和项目笔记不受影响，项目编号也不会改变。</p>' +
        '<p style="margin-top:10px;color:var(--muted);font-size:12px">保存时将要求输入红色文字最终确认。</p>' +
      '</div>',
      [
        {text: '取消', onclick: '_projFormTypeCancel()'},
        {text: '确定切换', cls: 'btn-warning', onclick: '_projFormTypeConfirm()'}
      ],
      {maxWidth: 460, hideClose: true, overlayClass: 'proj-form-type-warn-overlay'}
    );
    return;
  }

  // Create mode: auto-generate code when type changes
  _autoGenProjCode(true);
}

function _projFormTypeCancel() {
  var typeEl = window._projFormTypeChangedEl;
  if (typeEl) typeEl.value = _projFormOrigType;
  window._projFormTypeChangedEl = null;
  var ov = document.querySelector('.proj-form-type-warn-overlay');
  if (ov) ov.remove();
}

function _projFormTypeConfirm() {
  window._projFormTypeChangedEl = null;
  var ov = document.querySelector('.proj-form-type-warn-overlay');
  if (ov) ov.remove();
}

function _autoGenProjCode(force) {
  // Never auto-generate code in edit mode — the project already has a valid code
  if (_projFormIsEdit) return;
  var typeEl = document.getElementById('proj-form-type');
  var codeEl = document.getElementById('proj-form-code');
  if (!typeEl || !codeEl) return;
  if (!force && codeEl.value && codeEl.value.trim()) return; // don't overwrite existing code unless forced
  var type = typeEl.value || 'RD';
  API.get('/product-management/next-project-code?project_type=' + encodeURIComponent(type)).then(function(data) {
    if (data && data.code) codeEl.value = data.code;
  }).catch(function() {});
}

// Keep backward-compatible wrappers
function showProjectEditDialog() { showProjectFormDialog(true); }

async function saveProjectForm(isEdit) {
  var isConvert = !!_projFormConvertSource;
  var payload = {};
  var g = function(id) { return document.getElementById(id); };

  // Validate required fields for new projects
  var nameEl = g('proj-form-name');
  var name = (nameEl && nameEl.value || '').trim();
  payload.name = name;

  // For conversion, use the convert endpoint
  if (isConvert && !isEdit) {
    if (!name) { showToast('请输入项目名称', 'error'); return; }
    var projectType = g('proj-form-type').value;
    closeSharedDialog();
    try {
      var result = await API.post('/projects/' + _comboCurCode + '/convert', {
        project_type: projectType,
        name: name
      });
      showToast('商机转化成功！新项目：' + (result.code || ''), 'ok');
      _projFormConvertSource = null;
      if (result && result.code) {
        _comboCurCode = result.code;
        EventBus.emit(EVENTS.PROJECT_SAVED, {});
        document.getElementById('combo-input').value = result.code;
        loadProjectDetail(result.code);
      }
    } catch(e) {
      showToast('转化失败: ' + (e.message || '未知错误'), 'error');
    }
    return;
  }

  var codeEl = g('proj-form-code');
  var code = (codeEl && codeEl.value || '').trim();
  payload.code = code;

  payload.project_type = g('proj-form-type').value;

  var statusEl = g('proj-form-status');
  if (statusEl) payload.status = statusEl.value;

  // 老项目跟踪标记 (checkbox)
  var trackingEl = g('proj-form-tracking');
  if (trackingEl) payload.tracking_only = trackingEl.checked;

  // Confirm wait→doing transition (triggers template sync) (#231)
  if (isEdit && _projDetail && _projDetail.raw_status === 'wait' && payload.status === 'doing') {
    if (payload.tracking_only) {
      if (!confirm('将项目状态从「待启动」切换为「进行中」将自动创建阶段和文档（老项目跟踪：不会自动创建任务，可手动导入/创建）。确认继续？')) {
        return;
      }
    } else if (!confirm('将项目状态从「待启动」切换为「进行中」将自动根据模板创建阶段、任务和文档。确认继续？')) {
      return;
    }
  }

  var custEl = g('proj-form-customer');
  if (custEl && custEl.value.trim()) payload.customer_name = custEl.value.trim();

  var beginEl = g('proj-form-begin');
  if (beginEl && beginEl.value) payload.begin = beginEl.value;
  var endEl = g('proj-form-end');
  if (endEl && endEl.value) payload.end = endEl.value;
  var estEl = g('proj-form-estimate');
  if (estEl && estEl.value !== '') payload.estimate = parseFloat(estEl.value) || 0;

  // Required field validation (inline hints, matching task form pattern)
  ['proj-form-name-hint','proj-form-code-hint','proj-form-type-hint','proj-form-customer-hint','proj-form-begin-hint','proj-form-end-hint','proj-form-estimate-hint'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.style.display = 'none';
  });
  var valid = true;
  if (!name) { var h = document.getElementById('proj-form-name-hint'); if (h) { h.textContent = '请输入项目名称（不能包含空格）'; h.style.display = ''; } valid = false; }
  else if (/\s/.test(name)) { var h = document.getElementById('proj-form-name-hint'); if (h) { h.textContent = '项目名称不能包含空格'; h.style.display = ''; } valid = false; }
  if (!code) { var h = document.getElementById('proj-form-code-hint'); if (h) h.style.display = ''; valid = false; }
  if (!payload.customer_name) { var h = document.getElementById('proj-form-customer-hint'); if (h) h.style.display = ''; valid = false; }
  if (!payload.begin) { var h = document.getElementById('proj-form-begin-hint'); if (h) h.style.display = ''; valid = false; }
  if (!payload.end) { var h = document.getElementById('proj-form-end-hint'); if (h) h.style.display = ''; valid = false; }
  if (!payload.estimate) { var h = document.getElementById('proj-form-estimate-hint'); if (h) h.style.display = ''; valid = false; }
  if (!valid) return;

  // Dates
  ['begin','end','real_began','real_end'].forEach(function(k) {
    var el = g('proj-form-' + k);
    if (el && el.value) payload[k] = el.value;
  });

  // Numbers
  var numMap = {'estimate':'estimate','consumed':'consumed','delivery-qty':'planned_delivery_qty'};
  Object.keys(numMap).forEach(function(fid) {
    var el = g('proj-form-' + fid);
    if (el && el.value !== '') payload[numMap[fid]] = parseFloat(el.value);
  });

  // Tags
  if (_projFormSelectedTags.length) payload.tags = _projFormSelectedTags.join(',');

  // Linked projects
  var linkedEl = g('proj-form-linked-input');
  if (linkedEl && linkedEl.value.trim()) payload.linked_project_ids = linkedEl.value.trim();

  // Linked products (with quantity support)
  if (_projFormSelectedPids.length) {
    payload.product_ids = _projFormSelectedPids.map(function(pid) {
      return { product_id: pid, quantity: _projFormSelectedProdQtys[pid] || 1 };
    });
  }
  if (!isEdit && !payload.status) payload.status = 'wait';

  // In edit mode, if project type changed, require final confirmation
  if (isEdit && _projFormOrigType && payload.project_type !== _projFormOrigType) {
    var typeEl2 = document.getElementById('proj-form-type');
    var origLabel = _projFormOrigType;
    var newLabel = payload.project_type;
    if (typeEl2) {
      for (var i = 0; i < typeEl2.options.length; i++) {
        if (typeEl2.options[i].value === _projFormOrigType) origLabel = typeEl2.options[i].text;
        if (typeEl2.options[i].value === payload.project_type) newLabel = typeEl2.options[i].text;
      }
    }
    var typeConfirmed = await verifyPassword(
      '切换项目类型: ' + origLabel + ' → ' + newLabel,
      'pw_verify_maint_remove'
    );
    if (!typeConfirmed) {
      // Revert type and close dialog (don't save)
      var typeEl = document.getElementById('proj-form-type');
      if (typeEl) typeEl.value = _projFormOrigType;
      return;
    }
  }

  try {
    var result;
    if (isEdit) {
      result = await API.put('/projects/' + _comboCurCode, payload);
    } else {
      result = await API.post('/product-management/projects', payload);
    }
    closeSharedDialog();
    if (isEdit) {
      var count = result._updated_count;
      showToast(count > 0 ? '已更新 ' + count + ' 个字段' : '未检测到变更', count > 0 ? 'success' : 'warn');
    } else {
      showToast('项目已创建', 'success');
    }
    EventBus.emit(EVENTS.PROJECT_SAVED, {});
  } catch(e) {
    showToast('保存失败: ' + (e.message || '未知错误'), 'error');
  }
}

// ── Project Delete ──

async function deleteCurrentProject() {
  var p = _projDetail;
  if (!p) return;
  if (!confirm('确认删除项目「' + (p.name || '') + '」？\n\n此操作将同时删除：\n- 项目所有执行/迭代/任务\n- 项目文档实例\n- 项目笔记\n- 关联产品/客户/标签\n- 交付记录\n- 操作活动记录\n\n此操作不可撤销！')) return;
  var ok = await verifyPassword('删除项目: ' + (p.name || ''), 'pw_verify_maint_remove');
  if (!ok) return;
  try {
    await API.del('/projects/' + _comboCurCode);
    showToast('项目已删除', 'success');
    EventBus.emit(EVENTS.PROJECT_DELETED, {});
    // Navigate back to project list
    if (typeof gotoView === 'function') gotoView('project-list');
  } catch(e) {
    showToast('删除失败: ' + (e.message || '未知错误'), 'error');
  }
}

// ── Shared section renderer (badges + edit button only) ──

function _renderMaintSection(containerId, hdId, linked, idKey, labelKey, type, labelName) {
  var container = document.getElementById(containerId);
  var hd = document.getElementById(hdId);

  var chipClass = type === 'prod' ? 'prod-link-chip' : (type === 'cust' ? 'cust-badge' : 'proj-code-btn');
  var clickFn = type === 'prod' ? 'openProductDetail' : (type === 'cust' ? 'openCustomerByName' : '');
  var clickArg = type === 'prod' ? 'code' : (type === 'cust' ? labelKey : idKey);
  var badgesHtml = linked.length ? linked.map(function(x) {
    var onClick = clickFn ? ' onclick="event.stopPropagation();' + clickFn + '(\''+escHtml(x[clickArg]).replace(/'/g,"\\'")+'\')"' : '';
    var displayLabel = (type === 'prod' && x.code) ? escHtml(x.code) : escHtml(x[labelKey]);
    var tooltip = (type === 'prod' && x.code) ? escHtml(x[labelKey]) : '查看详情';
    var qtyBadge = (type === 'prod')
      ? '<span style="position:absolute;top:-7px;right:-7px;background:var(--accent);color:#fff;border-radius:50%;min-width:16px;height:16px;line-height:16px;text-align:center;font-size:9px;font-weight:600;padding:0 2px;box-sizing:border-box">' + (x.quantity || 1) + '</span>'
      : '';
    var wrapperOpen = (type === 'prod') ? '<span style="position:relative;display:inline-block">' : '';
    var wrapperClose = (type === 'prod') ? '</span>' : '';
    return wrapperOpen + '<span class="'+chipClass+'"' + onClick + ' title="' + tooltip + '">' + displayLabel + '</span>' + qtyBadge + wrapperClose +
      ' <span onclick="maintRemove_' + type + '(' + x[idKey] + ')" style="cursor:pointer;opacity:0.5;font-size:14px" title="移除">&times;</span>';
  }).join('') : '<span style="font-size:12px;color:var(--muted)">暂无' + labelName + '</span>';

  // Section header: replace entire element to avoid nested section-hd
  if (hd) {
    hd.outerHTML = sectionHeader(labelName, linked.length, '编辑' + labelName, 'maintOpenDialog_' + type + '()', hdId);
  }

  // Card body: badges only
  container.innerHTML = '<div style="display:flex;flex-wrap:wrap;gap:6px">' + badgesHtml + '</div>';
}

// ── Dialog helpers ──

// ── Products ──

var _maintLinkedProds = [];
var _maintAllProds = [];

async function loadMaintProjectProducts() {
  try {
    var linked = await API.get('/maintenance/projects/' + _comboCurCode + '/products');
    _maintLinkedProds = linked || [];
    var all = await API.get('/products?limit=200');
    _maintAllProds = (all.items || []).map(function(p) { return {id: p.id, name: p.name, code: p.code}; });
    _renderMaintSection('maint-proj-products', 'maint-hd-products', _maintLinkedProds, 'id', 'name', 'prod', '关联产品');
  } catch(e) {
    document.getElementById('maint-proj-products').innerHTML = '<div class="error-state">加载失败</div>';
  }
}

function maintOpenDialog_prod() {
  var linkedMap = {};
  (_maintLinkedProds || []).forEach(function(p) { linkedMap[p.id] = p.quantity || 1; });

  var bodyHtml = '<input class="search-inp" placeholder="搜索产品..." oninput="_filterSearchableItems(this)" style="margin-bottom:6px">' +
    '<div style="max-height:280px;overflow-y:auto;margin-bottom:8px" class="searchable-list">' +
    (_maintAllProds || []).map(function(item) {
      var isLinked = linkedMap.hasOwnProperty(item.id);
      var qty = linkedMap[item.id] || 1;
      var codeBadge = item.code
        ? '<span style="font-size:11px;padding:1px 6px;border-radius:4px;background:var(--accent-lt);color:var(--accent);font-family:var(--mono);margin-right:6px;white-space:nowrap">' + escHtml(item.code) + '</span>'
        : '';
      var searchText = String(item.name + ' ' + (item.code || '')).toLowerCase();
      return '<label class="searchable-item" data-search-text="' + escHtml(searchText) +
        '" style="display:flex;align-items:center;gap:6px;padding:4px 0;font-size:13px;cursor:pointer">' +
        '<input type="checkbox" value="' + item.id + '"' + (isLinked ? ' checked' : '') + ' class="maint-prod-cb" onchange="_maintProdCbChange(this)">' +
        codeBadge + '<span>' + escHtml(item.name) + '</span>' +
        '<input type="number" class="search-inp maint-prod-qty" value="' + qty + '" min="1" ' +
        'style="width:55px;margin-left:auto;padding:2px 6px;text-align:center;font-size:11px"' +
        (isLinked ? '' : ' disabled') + ' onfocus="this.select()">' +
        '</label>';
    }).join('') +
    '</div>';

  openDialog('编辑关联产品', bodyHtml, [
    {text: '取消', onclick: 'closeSharedDialog()'},
    {text: '保存', cls: 'btn-primary', onclick: '_maintSaveProducts()'}
  ], {hideClose: true, maxWidth: 550});
}

function _maintProdCbChange(cb) {
  var qtyInput = cb.parentElement.querySelector('.maint-prod-qty');
  if (qtyInput) {
    qtyInput.disabled = !cb.checked;
    if (cb.checked && (!qtyInput.value || parseInt(qtyInput.value) < 1)) qtyInput.value = 1;
  }
}

function _maintSaveProducts() {
  var items = [];
  document.querySelectorAll('.maint-prod-cb:checked').forEach(function(cb) {
    var qtyInput = cb.parentElement.querySelector('.maint-prod-qty');
    var qty = qtyInput ? parseInt(qtyInput.value) || 1 : 1;
    items.push({ product_id: parseInt(cb.value), quantity: Math.max(1, qty) });
  });
  closeSharedDialog();
  API.put('/maintenance/projects/' + _comboCurCode + '/products', { items: items }).then(function() {
    EventBus.emit(EVENTS.MAINT_SAVED, {});
  });
}

function maintRemove_prod(pid) {
  var prod = _maintLinkedProds.find(function(p) { return p.id === pid; });
  var name = prod ? (prod.name || '') : '';
  verifyPassword('移除产品关联: ' + name, 'pw_verify_maint_remove').then(function(ok) {
    if (!ok) return;
    var items = _maintLinkedProds
      .filter(function(p) { return p.id !== pid; })
      .map(function(p) { return { product_id: p.id, quantity: p.quantity || 1 }; });
    API.put('/maintenance/projects/' + _comboCurCode + '/products', { items: items }).then(function() { EventBus.emit(EVENTS.MAINT_SAVED, {}); });
  });
}

// ── Customers ──

var _maintLinkedCustomers = [];
var _maintAllCustomers = [];

async function loadMaintProjectCustomers() {
  try {
    var linked = await API.get('/maintenance/projects/' + _comboCurCode + '/customers');
    _maintLinkedCustomers = linked || [];
    var all = await API.get('/customers');
    _maintAllCustomers = (all || []).map(function(c) { return {id: c.id, name: c.name}; });
    _renderMaintSection('maint-proj-customers', 'maint-hd-customers', _maintLinkedCustomers, 'id', 'name', 'cust', '关联客户');
  } catch(e) {
    document.getElementById('maint-proj-customers').innerHTML = '<div class="error-state">加载失败</div>';
  }
}

function maintOpenDialog_cust() {
  var linkedIds = (_maintLinkedCustomers || []).map(function(c) { return c.id; });
  multiSelectDialog('编辑关联客户', _maintAllCustomers, linkedIds, {
    placeholder: '搜索客户...', maxWidth: 450
  }, function(ids) {
    API.put('/maintenance/projects/' + _comboCurCode + '/customers', { ids: ids }).then(function() { EventBus.emit(EVENTS.MAINT_SAVED, {}); });
  });
}

function maintRemove_cust(cid) {
  var cust = _maintLinkedCustomers.find(function(c) { return c.id === cid; });
  var name = cust ? (cust.name || '') : '';
  verifyPassword('移除客户关联: ' + name, 'pw_verify_maint_remove').then(function(ok) {
    if (!ok) return;
    var ids = _maintLinkedCustomers.map(function(c) { return c.id; }).filter(function(id) { return id !== cid; });
    API.put('/maintenance/projects/' + _comboCurCode + '/customers', { ids: ids }).then(function() { EventBus.emit(EVENTS.MAINT_SAVED, {}); });
  });
}

// ── Tags ──

var _maintLinkedTags = [];
var _maintAllTags = [];
var _maintAllTagsFull = [];

async function loadMaintProjectTags() {
  try {
    var linked = await API.get('/maintenance/projects/' + _comboCurCode + '/tags');
    _maintLinkedTags = linked || [];
    var allData = await API.get('/tags');
    var allList = allData || [];
    _maintAllTagsFull = allList;
    _maintAllTags = allList.filter(function(t) {
      return t.category === 'project' || !t.category || t.category === '';
    });
    _renderMaintTagSection();
  } catch(e) {
    document.getElementById('maint-proj-tags').innerHTML = '<div class="error-state">加载失败: ' + escHtml(e.message || '未知错误') + '</div>';
  }
}

function _renderMaintTagSection() {
  var container = document.getElementById('maint-proj-tags');
  var hd = document.getElementById('maint-hd-tags');
  var linkedNames = _maintLinkedTags.slice();

  var badgesHtml = linkedNames.length ? linkedNames.map(function(name) {
    var cls = 'tag-' + (name.length % 5);
    return '<span class="tag-badge ' + cls + '" style="font-size:12px;padding:3px 12px;display:inline-flex;align-items:center;gap:4px">' +
      '#' + escHtml(name) +
      ' <span data-tag-name="' + escHtml(name) + '" onclick="maintRemove_tag(this.getAttribute(\'data-tag-name\'))" style="cursor:pointer;opacity:0.5;font-size:14px;line-height:1" title="移除">&times;</span></span>';
  }).join('') : '<span style="font-size:12px;color:var(--muted)">暂无标签</span>';

  // Section header: replace entire element to avoid nested section-hd
  if (hd) {
    hd.outerHTML = sectionHeader('项目标签', linkedNames.length, '编辑标签', 'maintOpenDialog_tag()', 'maint-hd-tags');
  }

  // Card body: badges only
  container.innerHTML = '<div style="display:flex;flex-wrap:wrap;gap:6px">' + badgesHtml + '</div>';
}

function maintOpenDialog_tag() {
  var linkedNames = _maintLinkedTags.slice();
  var projectTags = _maintAllTagsFull.filter(function(t) { return t.category === 'project'; });
  var productTags = _maintAllTagsFull.filter(function(t) { return t.category === 'product'; });
  var generalTags = _maintAllTagsFull.filter(function(t) { return !t.category || t.category === ''; });

  var sections = [
    { title: '项目标签', color: 'var(--accent)', bg: 'var(--accent-lt)', tags: projectTags },
    { title: '产品标签', color: 'var(--success)', bg: 'var(--success-lt)', tags: productTags },
    { title: '通用标签', color: 'var(--muted)', bg: 'var(--bg)', tags: generalTags },
  ];

  var bodyHtml = '';
  sections.forEach(function(sec) {
    bodyHtml += '<div class="card" style="margin-bottom:10px;padding:12px 14px">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:' + (sec.tags.length ? '8px' : '2px') + '">' +
        '<span style="width:8px;height:8px;border-radius:50%;background:' + sec.color + '"></span>' +
        '<span style="font-weight:540;font-size:13px">' + sec.title + '</span>' +
        '<span style="font-size:11px;color:var(--muted)">' + sec.tags.length + '</span>' +
      '</div>';
    if (sec.tags.length) {
      bodyHtml += '<div style="display:flex;flex-wrap:wrap;gap:6px">';
      sec.tags.forEach(function(t) {
        var isLinked = linkedNames.indexOf(t.name) >= 0;
        bodyHtml += '<span class="tag-badge tag-' + (t.name.length % 5) + '" ' +
          'data-tag-name="' + escHtml(t.name) + '" onclick="maintToggle_tag(this.getAttribute(\'data-tag-name\'))" ' +
          'style="font-size:12px;padding:3px 12px;cursor:pointer;' +
          (isLinked ? '' : 'opacity:0.35') + '" ' +
          'title="' + (isLinked ? '点击移除' : '点击添加') + '">#' + escHtml(t.name) + '</span>';
      });
      bodyHtml += '</div>';
    } else {
      bodyHtml += '<div style="font-size:11px;color:var(--muted);font-style:italic">暂无</div>';
    }
    bodyHtml += '</div>';
  });

  openDialog('编辑项目标签', '<div id="maint-dlg-tag-content">' + bodyHtml + '</div>', [], {maxWidth: 520, hideClose: false});
}

async function maintToggle_tag(name) {
  var linkedNames = _maintLinkedTags.slice();
  var idx = linkedNames.indexOf(name);
  if (idx >= 0) {
    linkedNames.splice(idx, 1);
  } else {
    linkedNames.push(name);
  }
  try {
    await API.put('/maintenance/projects/' + _comboCurCode + '/tags', { tags: linkedNames });
    _maintLinkedTags = linkedNames;
    _renderMaintTagDialogContent();
    _renderMaintTagSection();
  } catch(e) {
    showToast('操作失败: ' + (e.message || '未知错误'), 'error');
  }
}

function _renderMaintTagDialogContent() {
  var linkedNames = _maintLinkedTags.slice();
  var projectTags = _maintAllTagsFull.filter(function(t) { return t.category === 'project'; });
  var productTags = _maintAllTagsFull.filter(function(t) { return t.category === 'product'; });
  var generalTags = _maintAllTagsFull.filter(function(t) { return !t.category || t.category === ''; });

  var sections = [
    { title: '项目标签', color: 'var(--accent)', bg: 'var(--accent-lt)', tags: projectTags },
    { title: '产品标签', color: 'var(--success)', bg: 'var(--success-lt)', tags: productTags },
    { title: '通用标签', color: 'var(--muted)', bg: 'var(--bg)', tags: generalTags },
  ];

  var container = document.getElementById('maint-dlg-tag-content');
  if (!container) return;

  var bodyHtml = '';
  sections.forEach(function(sec) {
    bodyHtml += '<div class="card" style="margin-bottom:10px;padding:12px 14px">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:' + (sec.tags.length ? '8px' : '2px') + '">' +
        '<span style="width:8px;height:8px;border-radius:50%;background:' + sec.color + '"></span>' +
        '<span style="font-weight:540;font-size:13px">' + sec.title + '</span>' +
        '<span style="font-size:11px;color:var(--muted)">' + sec.tags.length + '</span>' +
      '</div>';
    if (sec.tags.length) {
      bodyHtml += '<div style="display:flex;flex-wrap:wrap;gap:6px">';
      sec.tags.forEach(function(t) {
        var isLinked = linkedNames.indexOf(t.name) >= 0;
        bodyHtml += '<span class="tag-badge tag-' + (t.name.length % 5) + '" ' +
          'data-tag-name="' + escHtml(t.name) + '" onclick="maintToggle_tag(this.getAttribute(\'data-tag-name\'))" ' +
          'style="font-size:12px;padding:3px 12px;cursor:pointer;' +
          (isLinked ? '' : 'opacity:0.35') + '" ' +
          'title="' + (isLinked ? '点击移除' : '点击添加') + '">#' + escHtml(t.name) + '</span>';
      });
      bodyHtml += '</div>';
    } else {
      bodyHtml += '<div style="font-size:11px;color:var(--muted);font-style:italic">暂无</div>';
    }
    bodyHtml += '</div>';
  });
  container.innerHTML = bodyHtml;
}

function maintRemove_tag(name) {
  var tags = _maintLinkedTags.filter(function(t) { return t !== name; });
  API.put('/maintenance/projects/' + _comboCurCode + '/tags', { tags: tags }).then(function() { EventBus.emit(EVENTS.MAINT_SAVED, {}); });
}

/* ── Add Stage Dialog ── */

function openAddStageDialog() {
  if (!_comboCurCode) { showToast('请先选择项目', 'error'); return; }
  var inp = 'width:100%;box-sizing:border-box;margin-top:1px';
  var lbl = 'font-size:11px;color:var(--muted);display:block;margin-bottom:2px';
  var row2 = 'display:grid;grid-template-columns:1fr 1fr;gap:10px';
  _stgOwnerId = null;

  openDialog('添加阶段',
    '<div style="max-height:60vh;overflow-y:auto;padding-right:4px">' +
      '<div style="margin-bottom:10px"><label style="' + lbl + '">阶段名称 *</label>' +
        '<input class="search-inp" id="add-stg-name" style="' + inp + '" placeholder="输入阶段名称..."></div>' +
      '<div style="' + row2 + '">' +
        '<div><label style="' + lbl + '">计划开始</label><input class="search-inp" id="add-stg-start" type="date" style="' + inp + '"></div>' +
        '<div><label style="' + lbl + '">计划结束</label><input class="search-inp" id="add-stg-end" type="date" style="' + inp + '"></div>' +
      '</div>' +
      '<div style="margin-bottom:10px"><label style="' + lbl + '">责任人</label><div style="margin-top:2px">' +
        createUserCombo({
          comboId: 'add-stg-owner-combo', inputId: 'add-stg-owner-input', dropdownId: 'add-stg-owner-dropdown',
          selectedIdFn: function() { return _stgOwnerId; },
          onSelect: function(u) { _stgOwnerId = u.id; }
        }) + '</div></div>' +
      '<div style="margin-bottom:4px"><label style="' + lbl + '">备注</label>' +
        '<textarea class="search-inp" id="add-stg-desc" rows="2" style="width:100%;box-sizing:border-box;resize:vertical"></textarea></div>' +
    '</div>',
    [{text: '取消', onclick: 'closeSharedDialog()'},
     {text: '添加', cls: 'btn-primary', onclick: 'submitAddStage()'}],
    {maxWidth: '520px', hideClose: true});
}

async function submitAddStage() {
  var name = document.getElementById('add-stg-name').value.trim();
  if (!name) { showToast('请输入阶段名称', 'error'); return; }
  var data = {
    name: name,
    start_date: document.getElementById('add-stg-start').value || null,
    end_date: document.getElementById('add-stg-end').value || null,
    owner_id: _stgOwnerId || null,
    description: document.getElementById('add-stg-desc').value.trim() || null,
  };
  closeSharedDialog();
  try {
    await API.post('/projects/' + _comboCurCode + '/stages', data);
    showToast('阶段已添加', 'success');
    EventBus.emit(EVENTS.STAGE_SAVED, {});
  } catch(e) { showToast('添加失败: ' + (e.message || ''), 'error'); }
}

/* ── Stage Edit Dialog (shared between maintenance tab and task tab) ── */

function openStageDialog(stageId) {
  var projectCode = _comboCurCode;
  if (!projectCode) { showToast('项目信息缺失', 'error'); return; }
  API.get('/projects/' + projectCode + '/stages').then(function(result) {
    var stages = (result && result.stages) ? result.stages : [];
    var stage = null;
    for (var i = 0; i < stages.length; i++) {
      if (stages[i].id === stageId) { stage = stages[i]; break; }
    }
    if (!stage) { showToast('阶段不存在', 'error'); return; }
    _showStageDialog(stage, projectCode);
  }).catch(function(e) {
    showToast('加载阶段失败: ' + (e.message || ''), 'error');
  });
}

var _stgOwnerId = null;

function _showStageDialog(stage, projectCode) {
  var inp = 'width:100%;box-sizing:border-box;margin-top:1px';
  var lbl = 'font-size:11px;color:var(--muted);display:block;margin-bottom:2px';
  var row2 = 'display:grid;grid-template-columns:1fr 1fr;gap:10px';

  _stgOwnerId = stage.owner_id || null;

  var bodyHtml = '<div style="max-height:65vh;overflow-y:auto;padding-right:4px">' +
    '<div style="margin-bottom:10px"><label style="' + lbl + '">阶段名称</label>' +
      '<input class="search-inp" id="stg-name" value="' + escHtml(stage.name || '') + '" style="' + inp + '"></div>' +
    '<div style="' + row2 + '">' +
      '<div><label style="' + lbl + '">计划开始</label><input class="search-inp" id="stg-start" type="date" value="' + (stage.start || '') + '" style="' + inp + '"></div>' +
      '<div><label style="' + lbl + '">计划结束</label><input class="search-inp" id="stg-end" type="date" value="' + (stage.end || '') + '" style="' + inp + '"></div>' +
    '</div>' +
    '<div style="' + row2 + '">' +
      '<div><label style="' + lbl + '">状态</label>' +
        '<select class="search-inp" id="stg-status" style="' + inp + '">' +
          '<option value="active"' + (stage.status === 'active' ? ' selected' : '') + '>进行中</option>' +
          '<option value="completed"' + (stage.status === 'completed' ? ' selected' : '') + '>已完成</option>' +
          '<option value="blocked"' + (stage.status === 'blocked' ? ' selected' : '') + '>已阻塞</option>' +
        '</select></div>' +
      '<div><label style="' + lbl + '">责任人</label><div style="margin-top:2px">' +
        createUserCombo({
          comboId: 'stg-owner-combo', inputId: 'stg-owner-input', dropdownId: 'stg-owner-dropdown',
          selectedIdFn: function() { return _stgOwnerId; },
          onSelect: function(u) { _stgOwnerId = u.id; }
        }) + '</div></div>' +
    '</div>' +
    '<div style="margin-bottom:10px"><label style="' + lbl + '">备注</label>' +
      '<textarea class="search-inp" id="stg-desc" rows="2" style="width:100%;box-sizing:border-box;resize:vertical">' + escHtml(stage.description || '') + '</textarea></div>' +
    '<div style="font-size:11px;color:var(--muted);margin-top:8px">' +
      '任务数量: ' + (stage.task_count || 0) + ' | 进度: ' + (stage.progress || 0) + '% | 完成: ' + (stage.tasks_done || 0) +
    '</div>' +
  '</div>';

  openDialog('编辑阶段 — ' + escHtml(stage.name), bodyHtml,
    [{text: '取消', onclick: 'closeSharedDialog()'},
     {text: '保存', cls: 'btn-primary', onclick: 'saveStageData(' + stage.id + ',\'' + escHtml(projectCode).replace(/'/g, "\\'") + '\')'}],
    {maxWidth: '520px', hideClose: true});
}

async function saveStageData(stageId, projectCode) {
  var data = {
    name: document.getElementById('stg-name').value.trim(),
    start_date: document.getElementById('stg-start').value || null,
    end_date: document.getElementById('stg-end').value || null,
    status: document.getElementById('stg-status').value,
    owner_id: _stgOwnerId || null,
    description: document.getElementById('stg-desc').value.trim() || null,
  };
  if (!data.name) { showToast('请输入阶段名称', 'error'); return; }
  closeSharedDialog();
  try {
    await API.put('/projects/' + projectCode + '/stages/' + stageId, data);
    showToast('阶段已更新', 'success');
    EventBus.emit(EVENTS.STAGE_SAVED, {});
  } catch(e) { showToast('保存失败: ' + (e.message || ''), 'error'); }
}

/* ── Maintenance: Project Stages ── */

var _maintAllStages = [];  // all stages for current project

async function deleteMaintStage(stageId, stageName) {
  if (!_comboCurCode) return;
  var ok = await verifyPassword('删除阶段: ' + stageName, 'pw_verify_stage_delete');
  if (!ok) return;
  try {
    await API.del('/projects/' + _comboCurCode + '/stages/' + stageId);
    showToast('阶段「' + stageName + '」已删除', 'success');
    EventBus.emit(EVENTS.STAGE_DELETED, {});
  } catch(e) { showToast('删除失败: ' + (e.message || ''), 'error'); }
}

function loadMaintProjectStages() {
  var container = document.getElementById('maint-proj-stages');
  if (!_comboCurCode) { if (container) container.innerHTML = '<div class="empty-state" style="padding:12px">请选择项目</div>'; return; }

  var user = getCurrentUser();
  var perms = (user && user.permissions) ? user.permissions.split(',') : [];
  var canEditStage = perms.indexOf('stage_mapping') >= 0 || perms.indexOf('admin') >= 0;

  // Update section header with add button (only if has stage_mapping permission)
  var hd = document.getElementById('maint-hd-stages');
  if (hd) hd.outerHTML = sectionHeader('阶段信息', null, canEditStage ? '添加阶段' : null, canEditStage ? 'openAddStageDialog()' : null, 'maint-hd-stages');

  container.innerHTML = '<div class="loading-spinner">加载中...</div>';
  API.get('/projects/' + _comboCurCode + '/stages').then(function(result) {
    var stages = (result && result.stages) ? result.stages : [];
    _maintAllStages = stages;
    _renderMaintStages(stages, container, canEditStage);
  }).catch(function(e) {
    container.innerHTML = '<div class="empty-state" style="padding:12px;color:var(--danger)">加载失败: ' + (e.message || '') + '</div>';
  });
}

var _maintStagesDt = null;

function _renderMaintStages(stages, container, canEditStage) {
  if (!stages.length) {
    container.innerHTML = '<div class="empty-state" style="padding:12px">暂无阶段数据 — 请在任务详情页点击"初始化阶段"按钮</div>';
    _maintStagesDt = null; return;
  }
  var riskLabels = { active: '进行中', completed: '已完成', blocked: '已阻塞' };
  if (!_maintStagesDt) {
    container.innerHTML = '<div id="maint-stages-table"></div>';
    _maintStagesDt = new DataTable({
      container: document.getElementById('maint-stages-table'),
      columns: [
        { key: 'idx', title: '#', width: '5%', minWidth: 60, render: function(v) { return '<span style="color:var(--muted)">'+v+'</span>'; } },
        { key: 'name', title: '阶段名称', width: '16%', render: function(v) { return '<span style="font-weight:500">'+escHtml(v||'')+'</span>'; } },
        { key: 'status', title: '状态', width: '10%', minWidth: 80, render: function(v) { var l=riskLabels[v]||v||'进行中'; var c=v==='blocked'?'var(--danger)':(v==='completed'?'var(--success)':'var(--accent)'); return '<span style="font-size:11px;padding:2px 8px;border-radius:10px;background:'+c+'15;color:'+c+';font-weight:500">'+escHtml(l)+'</span>'; } },
        { key: 'owner', title: '责任人', width: '10%', minWidth: 90, render: function(v) { return '<span style="font-size:12px">'+escHtml(v||'—')+'</span>'; } },
        { key: 'start', title: '计划开始', width: '12%', minWidth: 100, render: function(v) { return '<span style="font-size:12px">'+escHtml(v||'—')+'</span>'; } },
        { key: 'end', title: '计划结束', width: '12%', minWidth: 100, render: function(v) { return '<span style="font-size:12px">'+escHtml(v||'—')+'</span>'; } },
        { key: 'task_count', title: '任务数', width: '7%', minWidth: 50, render: function(v, row) { var n=escHtml(row.name||'').replace(/'/g,"\\'"); return '<span style="cursor:pointer;color:var(--accent);font-weight:500" onclick="gotoStageTasksFromMaint(\''+n+'\')" title="跳转到任务详情">'+(v||0)+'</span>'; } },
        { key: 'progress', title: '进度', width: '7%', minWidth: 60, render: function(v, row) { var n=escHtml(row.name||'').replace(/'/g,"\\'"); return '<span style="cursor:pointer" onclick="gotoStageTasksFromMaint(\''+n+'\')" title="跳转到任务详情">'+(typeof renderProgressRing==='function'?'<div style="display:inline-block">'+renderProgressRing(v||0)+'</div>':(v||0)+'%')+'</span>'; } },
        { key: 'completed_date', title: '完成日期', width: '8%', minWidth: 100, render: function(v) { return '<span style="font-size:12px">'+escHtml(v||'—')+'</span>'; } },
        { key: 'actions', title: '操作', width: actionColWidth(2) + 'px', minWidth: actionColWidth(2), render: function(v, row) { return '<span style="white-space:nowrap">'+(row.id&&canEditStage?iconEdit('openStageDialog('+row.id+')','编辑阶段')+iconDelete('deleteMaintStage('+row.id+',\''+escHtml(row.name||'').replace(/'/g,"\\'")+'\')','删除阶段'):'')+'</span>'; } }
      ],
      maxHeight: 'calc(100vh - 400px)'
    });
  }
  stages.forEach(function(s, i) { s.idx = i+1; s.owner = s.owner_name || s.who; });
  _maintStagesDt.setData(stages);
}

/* ── Project Activities (进度明细) ── */

var _activitySort = 'desc';
var _activityFilterUser = '';
var _activityFilterAction = '';
var _activityOptions = null;  // {usernames: [...], actions: [...]}

async function loadActivities() {
  var container = document.getElementById('activities-content');
  container.innerHTML = '<div class="loading-spinner">加载活动记录...</div>';
  try {
    var params = 'sort=' + _activitySort + '&limit=200';
    if (_activityFilterUser) params += '&username=' + encodeURIComponent(_activityFilterUser);
    if (_activityFilterAction) params += '&action=' + encodeURIComponent(_activityFilterAction);
    var resp = await API.get('/projects/' + _comboCurCode + '/activities?' + params);
    var items = resp && resp.items ? resp.items : (Array.isArray(resp) ? resp : []);
    var opts = resp && resp.options ? resp.options : null;
    buildActivities(items, opts);
  } catch(e) {
    container.innerHTML = '<div class="error-state">加载失败: ' + escHtml(e.message) + '</div>';
  }
}

function buildActivities(items, opts) {
  var container = document.getElementById('activities-content');

  // Keep filter options for dropdowns
  if (opts) _activityOptions = opts;

  // Filter badge (when active)
  var filterBadge = '';
  if (_activityFilterUser || _activityFilterAction) {
    filterBadge = '<div style="margin-bottom:8px">' +
      '<span class="activity-filter-badge">' +
      '筛选: ' + [_activityFilterUser, _activityFilterAction].filter(Boolean).join(' + ') +
      ' <a href="javascript:void(0)" onclick="clearActivityFilters()" style="color:var(--danger);text-decoration:none;margin-left:4px">✕</a>' +
      '</span></div>';
  }

  // Sort indicator
  var sortIcon = '<span id="act-sort-ind" style="color:var(--muted)">⇅</span>';

  // Build filter dropdowns for header
  var userOpts = (_activityOptions && _activityOptions.usernames) ? _activityOptions.usernames : [];
  var userFilter = '<select id="act-filter-user" onchange="onActivityFilterUser(this.value)" class="activity-header-filter">' +
    '<option value="">全部</option>';
  userOpts.forEach(function(u) {
    userFilter += '<option value="' + escHtml(u) + '"' + (_activityFilterUser === u ? ' selected' : '') + '>' + escHtml(u) + '</option>';
  });
  userFilter += '</select>';

  var actionOpts = (_activityOptions && _activityOptions.actions) ? _activityOptions.actions : [];
  var actionFilter = '<select id="act-filter-action" onchange="onActivityFilterAction(this.value)" class="activity-header-filter">' +
    '<option value="">全部</option>';
  actionOpts.forEach(function(a) {
    actionFilter += '<option value="' + escHtml(a) + '"' + (_activityFilterAction === a ? ' selected' : '') + '>' + escHtml(a) + '</option>';
  });
  actionFilter += '</select>';

  if (!items || !items.length) {
    container.innerHTML = filterBadge + '<div class="empty-state" style="padding:20px">暂无活动记录</div>';
    return;
  }

  var html = filterBadge;
  container.innerHTML = filterBadge + '<div id="act-table"></div>';
  new DataTable({
    container: document.getElementById('act-table'),
    columns: [
      { key: 'created_at', title: '时间 <span id="act-sort-ind" style="cursor:pointer" onclick="toggleActivitySort()">' + sortIcon + '</span>', width: '160px', minWidth: 120, render: function(v) { return '<span class="act-td-time">'+escHtml(fmtISODateTime(v))+'</span>'; } },
      { key: 'display_name', title: '用户名 ' + userFilter, width: '100px', minWidth: 90, render: function(v, row) { return '<span class="act-td-user">'+escHtml(getDisplayName(v||row.username))+'</span>'; } },
      { key: 'action', title: '操作类型 ' + actionFilter, width: '120px', minWidth: 80, render: function(v) { return '<span class="activity-action pill">'+escHtml(v||'')+'</span>'; } },
      { key: 'detail', title: '具体明细', width: 'auto', align: 'left', className: 'dt-wrap', render: function(v) { return '<span class="act-td-detail">'+(v?escHtml(v):'')+'</span>'; } }
    ],
    data: items,
    maxHeight: 'calc(100vh - 330px)',
  });
}

function updateActivitySortInd() {
  var si = document.getElementById('act-sort-ind');
  if (!si) return;
  if (_activitySort === 'asc') { si.textContent = '▲'; si.style.color = ''; }
  else if (_activitySort === 'desc') { si.textContent = '▼'; si.style.color = ''; }
  else { si.textContent = '⇅'; si.style.color = 'var(--muted)'; }
}

function toggleActivitySort() {
  _activitySort = _activitySort === 'desc' ? 'asc' : 'desc';
  loadActivities();
}

function onActivityFilterUser(val) {
  _activityFilterUser = val || '';
  loadActivities();
}

function onActivityFilterAction(val) {
  _activityFilterAction = val || '';
  loadActivities();
}

function clearActivityFilters() {
  _activityFilterUser = '';
  _activityFilterAction = '';
  loadActivities();
}
