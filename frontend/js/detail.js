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
    buildInfo(detail, notes, delivery, docs);
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
      '</div>' +
    '</div>' +
    '<div style="display:flex;align-items:flex-start;gap:24px;flex-shrink:0">' +
      renderProgressCircle(progress, 56, { label: "整体进度" }) +
      renderProgressCircle(_deliveryProgress, 56, { label: "交付进度" }) +
    '</div>';
}

/* Info Tab — Basic Info */

function buildInfo(p, notes, delivery, docs) {
  if (!p) return;
  var del = delivery || {};

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

  // KPI row 2 — key timeline + delivery + linked opportunities
  html += '<div class="delivery-kpi" style="grid-template-columns:repeat(4, 1fr);margin-bottom:16px">' +
    '<div class="dkpi"><div class="dkpi-lbl">计划结束</div><div class="dkpi-val" style="font-size:16px;font-weight:600">' + (p.end ? formatDate(p.end) : '<span style="color:var(--muted)">—</span>') + '</div></div>' +
    '<div class="dkpi"><div class="dkpi-lbl">交付数量</div><div class="dkpi-val" style="font-size:16px;font-weight:600">' +
      '<span style="color:var(--success)">' + (del.done || 0) + '</span>' +
      '<span style="color:var(--muted);font-weight:400"> / ' + (del.planned || 0) + '</span>' +
    '</div></div>' +
    '<div class="dkpi" style="grid-column:span 2"><div class="dkpi-lbl">关联商机（' + linkedOpportunities.length + '）' +
      (_hasProjectEditPerm() ? '<a href="javascript:void(0)" onclick="event.stopPropagation();editLinkedProjects()" title="编辑关联商机" style="text-decoration:none;font-size:14px">&#x1F517;</a>' : '') +
    '</div><div class="dkpi-val" style="font-size:12px;line-height:1.6">' +
    (linkedOpportunities.length
      ? linkedOpportunities.map(function(lp) { return '<span class="proj-code-btn" onclick="loadProjectDetail(' + lp.id + ')" title="' + escHtml(lp.name || '') + '">' + escHtml(lp.code || lp.name) + '</span>'; }).join(' ')
      : '<span style="color:var(--muted)">—</span>') +
    '</div></div>' +
  '</div>';

  // Linked products + Linked projects — side-by-side cards
  var products = p.linked_products || [];
  var isOpportunity = p.project_type && p.project_type !== 'RD' && p.project_type !== 'SC';
  html += '<div style="display:flex;gap:16px;margin-bottom:16px">' +
    '<div class="card card-pad" style="flex:1;min-width:0">' +
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
    '<div class="card card-pad" style="flex:1;min-width:0">' +
      '<div style="font-size:11px;color:var(--muted);margin-bottom:8px">关联项目（' + linkedPeers.length + '）' +
        (isOpportunity && _hasProjectEditPerm() ? ' <a href="javascript:void(0)" onclick="event.stopPropagation();showLsjConvertDialog()" title="商机转化" style="text-decoration:none;font-size:14px">&#x1F504;</a>' : '') +
        (_hasProjectEditPerm() ? ' ' + '<a href="javascript:void(0)" onclick="event.stopPropagation();editLinkedProjects()" title="编辑关联项目" style="text-decoration:none;font-size:14px">&#x1F517;</a>' : '') +
      '</div>';
  if (linkedPeers.length) {
    html += '<div style="display:flex;flex-wrap:wrap;gap:4px">' +
      linkedPeers.map(function(lp) { return '<span class="proj-code-btn" onclick="loadProjectDetail('+lp.id+')" title="'+escHtml(lp.name||'')+'">'+escHtml(lp.code||lp.name)+'</span>'; }).join('') +
    '</div>';
  } else {
    html += '<div style="font-size:12px;color:var(--muted);font-style:italic">暂无</div>';
  }
  html += '</div>' +
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
    '<script>setTimeout(function(){var ta=document.getElementById("proj-bg-input");if(ta){ta.oninput=function(){var pv=document.getElementById("proj-bg-preview");if(pv)pv.innerHTML=typeof marked!=="undefined"?marked.parse(ta.value):"<pre>"+ta.value+"</pre>"}}},100)</' + 'script>',
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
    loadProjectDetail(_comboCurCode);
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

  // Start scroll at first stage
  setTimeout(function() {
    var wrap = document.querySelector('.gantt-wrap');
    if (!wrap) return;
    var firstStartPx = 0;
    if (stages && stages.length) {
      firstStartPx = ganttPx(stages[0].start, range, totalWidth);
    }
    wrap.scrollLeft = Math.max(0, firstStartPx - 40);
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
      { key: '_stage', title: '阶段', width: '11%', rowspan: true, render: function(v, row, idx, count) { return '<span style="font-weight:600;color:var(--accent);font-size:12px">'+escHtml(v||'')+' <sup style="font-size:10px;color:var(--muted);font-weight:400">'+(count||(row._empty?0:1))+'</sup>'+(row._empty?'':'<div style="margin-top:4px">'+row._progressRing+'</div>')+'</span>'; } },
      { key: '_seq', title: '序号', width: '40px', render: function(v, row) { return row._empty?'<span style="color:var(--muted)">-</span>':'<span style="font-family:var(--mono);color:var(--muted)">'+(v||'')+'</span>'; } },
      { key: '_docName', title: '文档名称', width: '14%', className: 'dt-wrap', render: function(v, row) { return row._empty?'<span style="color:var(--muted)">-</span>':'<span style="font-weight:500;word-break:break-all" title="'+escHtml(row.description||'')+'">'+(v||'')+'</span>'; } },
      { key: 'responsible_role', title: '责任人', width: '8%', render: function(v, row) { return row._empty?'<span style="color:var(--muted)">-</span>':'<span style="font-size:12px;white-space:nowrap">'+escHtml(v||'—')+'</span>'; } },
      { key: '_statusHtml', title: '状态', width: '70px', render: function(v, row) { return row._empty?'<span style="color:var(--muted)">-</span>':(v||''); } },
      { key: '_docType', title: '类型', width: '60px', render: function(v, row) { return row._empty?'<span style="color:var(--muted)">-</span>':'<span style="font-size:11px">'+escHtml(v||'')+'</span>'; } },
      { key: '_locHtml', title: '路径', align: 'left', className: 'dt-wrap', render: function(v, row) { return '<span style="font-size:12px;word-break:break-all">'+(v||'')+'</span>'; } },
      { key: '_updatedAt', title: '最后修改时间', width: '12%', render: function(v) { return '<span style="font-size:11px;color:var(--muted);white-space:nowrap">'+escHtml(v||'—')+'</span>'; } },
      { key: '_updatedBy', title: '修改人', width: '7%', render: function(v) { return '<span style="font-size:12px;color:var(--muted)">'+escHtml(getDisplayName(v)||'')+'</span>'; } },
      { key: '_actions', title: '操作', width: '80px', render: function(v, row) { return '<span style="white-space:nowrap">'+(v||'')+'</span>'; } }
    ],
    data: flatRows,
    maxHeight: 'calc(100vh - 320px)',
    resizable: false,
    rowClassFn: function(row) { return row._bg ? { background: row._bg } : null; }
  });
}

var _docsDt = null;

/* ── Document Status Edit Dialog ── */

function openDocEditDialog(docId) {
  var inp = 'width:100%;box-sizing:border-box;margin-top:1px';
  openDialog('编辑文档状态',
    '<div style="margin-bottom:10px">' +
      '<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px">文档链接/路径（标记已提交时需要）</label>' +
      '<input class="search-inp" id="doc-edit-loc" placeholder="输入文档链接/路径" style="' + inp + '">' +
    '</div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
      '<button class="btn btn-primary" onclick="submitDocStatus(' + docId + ')">标记已提交</button>' +
      '<button class="btn" onclick="markDocUnnecessary(' + docId + ')" style="color:var(--warn);border-color:var(--warn)">标记为无需文档</button>' +
    '</div>',
    [{text: '取消', onclick: 'closeSharedDialog()'}],
    {hideClose: true});
}

function submitDocStatus(docId) { saveDocStatus(docId, 'submitted'); }
function markDocUnnecessary(docId) { saveDocStatus(docId, 'unnecessary'); }
function deleteDocStatus(docId, docName) {
  var label = docName || ('#' + docId);
  openDialog('删除文档',
    '<div class="confirm-dlg">确认删除文档 <b>' + escHtml(label) + '</b>？<br><br>删除后将不再显示。<br><br>如需恢复，可在"导入模板文档"中重新导入。</div>',
    [{text: '取消', onclick: 'closeSharedDialog()'},
     {text: '确认删除', cls: 'btn-danger', onclick: 'closeSharedDialog();_confirmDeleteDoc(' + docId + ',\x27' + escJs(label) + '\x27)'}],
    {hideClose: true});
}
async function _confirmDeleteDoc(docId, docName) {
  var ok = await verifyPassword('删除文档: ' + (docName || '#' + docId), 'skip_doc_delete');
  if (!ok) return;
  saveDocStatus(docId, 'deleted');
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
    // Refresh docs
    if (typeof buildDocs === 'function') {
      var data = await API.get('/projects/' + _comboCurCode + '/documents');
      if (data) buildDocs(data);
    }
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
    API.get('/projects/' + _comboCurCode + '/documents').then(function(docs) { buildDocs(docs); });
  } catch(e) { showToast('移除失败: ' + (e.message || ''), 'error'); }
}

async function saveDocStatus(docId, status) {
  var user = getCurrentUser();
  var username = user ? (user.display_name || user.username) : '?';
  var now = new Date().toISOString().substring(0, 10);
  var locEl = document.getElementById('doc-edit-loc');
  var loc = locEl ? locEl.value.trim() : '';
  var body = { status: status };
  if (status === 'unnecessary') {
    body.status = 'submitted';
    body.location = '无需文档';
  } else if (status === 'deleted') {
    body.is_removed = 1;
    body.location = '已删除';
  } else if (loc) {
    body.location = loc;
  }
  closeSharedDialog();
  try {
    await API.put('/projects/' + _comboCurCode + '/documents/' + docId, body);
    var msgs = {submitted:'已标记为提交', unnecessary:'已标记为无需文档', deleted:'已删除'};
    showToast(msgs[status] || '状态已更新', 'success');
    var docs = await API.get('/projects/' + _comboCurCode + '/documents');
    buildDocs(docs);
  } catch(e) {
    showToast('操作失败: ' + (e.message || '未知错误'), 'error');
  }
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
    refreshDocs();
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
    refreshDocs();
  }).catch(function(e) { showToast('添加失败: ' + (e.message || ''), 'error'); });
}

/* Delivery */

function _hasProjectEditPerm() {
  var user = getCurrentUser();
  var perms = (user && user.permissions) ? user.permissions.split(',') : [];
  return perms.indexOf('admin') >= 0 || perms.indexOf('project_edit') >= 0;
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

  var recHtml = '' +
    '<div class="card col-span" style="padding:20px;margin-top:16px">' +
      sectionHeader('交付记录明细', records.length + ' 条', '+ 添加记录', 'showDeliveryForm()') +
      (records.length ? '<div id="delivery-table"></div>' : '<div class="empty-state" style="padding:20px">暂无交付记录，点击上方按钮添加</div>') +
    '</div>';

  document.getElementById('delivery-content').innerHTML =
    '<div class="two-col">' +
      '<div class="card" style="padding:20px">' +
        '<div class="section-title" style="margin-bottom:14px">交付概要</div>' +
        ringsHtml +
      '</div>' +
      recHtml +
    '</div>' +
    '<div id="delivery-form-container"></div>';

  if (records.length) {
    var cols = [
      { key: 'date', title: '交付日期', render: function(v) { return '<span style="font-family:var(--mono);font-size:12px;color:var(--success);font-weight:540;white-space:nowrap">'+formatDate(v)+'</span>'; } },
      { key: 'product_code', title: '产品编号', render: function(v, row) {
        if (v) return '<span class="proj-code-btn" onclick="event.stopPropagation();openProductDetail(\'' + escHtml(v) + '\')" title="' + escHtml(v) + ' ' + escHtml(row.product_name || '') + '">' + escHtml(v) + '</span>';
        return '<span style="font-size:12px;color:var(--muted)">—</span>';
      }},
      { key: 'product_name', title: '产品名称', render: function(v) { return '<span style="font-size:12.5px;font-weight:500">'+escHtml(v||'')+'</span>'; } },
      { key: 'material_code', title: '物料编码', render: function(v) { return '<span style="font-family:var(--mono);font-size:11.5px">'+escHtml(v||'')+'</span>'; } },
      { key: 'responsible_person', title: '交付人', render: function(v) { return '<span style="font-size:12px">'+escHtml(_userDisplayMap[v] || v || '—')+'</span>'; } },
      { key: 'receiver', title: '收货方', render: function(v) { return '<span style="font-size:12.5px">'+escHtml(v||'—')+'</span>'; } },
      { key: 'delivery_method', title: '交付形式', render: function(v) { return '<span style="font-size:12px">'+(v||'—')+'</span>'; } },
      { key: 'note', title: '备注', render: function(v) { return '<span style="font-size:12px;color:var(--muted)">'+escHtml(v||'')+'</span>'; } },
    ];
    if (canEdit) {
      cols.push({ key: 'actions', title: '', width: '64px', render: function(v, row) {
        return iconEdit('editDeliveryRecord(' + row.id + ')', '编辑') +
               iconDelete('deleteDeliveryRecord(' + row.id + ')', '删除');
      }});
    }
    new DataTable({
      container: document.getElementById('delivery-table'),
      columns: cols,
      data: records,
      resizable: false
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
    var data = await API.get('/projects/' + _comboCurCode + '/delivery');
    _deliveryData = data;
    _deliveryProgress = data.progress || 0;
    buildDelivery(data);
    // Refresh header ring
    if (_projDetail) buildDetailHeader(_projDetail);
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

  // Build material code rows
  var mcs = (r.material_codes && r.material_codes.length) ? r.material_codes : [];
  if (!mcs.length) mcs = ['', ''];  // default 2 empty
  var mcRows = mcs.map(function(mc, idx) {
    return '<div class="df-serial-row" style="display:flex;gap:6px;margin-bottom:6px;align-items:center">' +
      '<span class="df-serial-seq" style="width:28px;text-align:center;font-family:var(--mono);font-size:12px;color:var(--muted);flex-shrink:0">' + (idx + 1) + '</span>' +
      '<input class="search-inp df-serial-inp" value="' + escHtml(mc) + '" placeholder="物料编码 ' + (idx + 1) + '" style="flex:1;margin-top:0">' +
      (mcs.length > 1 ? '<button class="btn" onclick="removeSerialRow(this)" style="font-size:14px;padding:2px 8px;color:var(--danger);flex-shrink:0">&times;</button>' : '') +
    '</div>';
  }).join('');

  var html =
    '<div class="note-dialog-overlay">' +
    '<div class="note-dialog" style="max-width:560px;max-height:85vh;overflow-y:auto">' +
      '<div class="note-dialog-head"><span class="note-dialog-title">' + (isEdit ? '编辑交付记录' : '添加交付记录') + '</span>' +
        '<button class="note-dialog-close" onclick="cancelDeliveryForm()">&times;</button></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">' +
        '<div><label style="font-size:11px;color:var(--muted)">产品编号</label><select class="search-inp" id="df-product" style="margin-top:4px;padding:8px 10px">' + prodOptions + '</select></div>' +
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
        '<label style="font-size:11px;color:var(--muted);margin-bottom:4px;display:block">物料编码（每行一个）</label>' +
        '<div id="df-serial-rows">' + mcRows + '</div>' +
        '<button class="btn btn-xs" onclick="addSerialRow()" style="margin-top:4px">+ 添加物料编码</button>' +
      '</div>' +
      '<div style="margin-bottom:12px"><label style="font-size:11px;color:var(--muted)">备注</label><input class="search-inp" id="df-note" value="' + escHtml(r.note || '') + '" style="margin-top:4px"></div>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px">' +
        '<button class="btn" onclick="cancelDeliveryForm()">取消</button>' +
        '<button class="btn btn-primary" id="df-save-btn" onclick="saveDeliveryRecord(' + (r.id || 0) + ')">' + (isEdit ? '保存修改' : '添加记录') + '</button>' +
      '</div>' +
    '</div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
}

function addSerialRow() {
  var container = document.getElementById('df-serial-rows');
  if (!container) return;
  var idx = container.querySelectorAll('.df-serial-row').length + 1;
  var div = document.createElement('div');
  div.className = 'df-serial-row';
  div.style.cssText = 'display:flex;gap:6px;margin-bottom:6px;align-items:center';
  div.innerHTML = '<span class="df-serial-seq" style="width:28px;text-align:center;font-family:var(--mono);font-size:12px;color:var(--muted);flex-shrink:0">' + idx + '</span>' +
    '<input class="search-inp df-serial-inp" placeholder="物料编码 ' + idx + '" style="flex:1;margin-top:0">' +
    '<button class="btn" onclick="removeSerialRow(this)" style="font-size:14px;padding:2px 8px;color:var(--danger);flex-shrink:0">&times;</button>';
  container.appendChild(div);
}

function removeSerialRow(btn) {
  var row = btn.closest('.df-serial-row');
  if (row) {
    var container = document.getElementById('df-serial-rows');
    if (container && container.querySelectorAll('.df-serial-row').length <= 1) return;
    row.remove();
    // Renumber remaining rows
    var rows = container.querySelectorAll('.df-serial-row');
    rows.forEach(function(r, i) {
      var seq = r.querySelector('.df-serial-seq');
      if (seq) seq.textContent = i + 1;
      var inp = r.querySelector('.df-serial-inp');
      if (inp) inp.placeholder = '物料编码 ' + (i + 1);
    });
  }
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

  // Collect material codes
  var mcs = [];
  document.querySelectorAll('.df-serial-inp').forEach(function(inp) {
    var v = inp.value.trim();
    if (v) mcs.push(v);
  });

  if (!productCode) { showToast('请选择产品编号', 'error'); return; }
  if (mcs.length === 0) { showToast('请至少填写一个物料编码', 'error'); return; }

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
    var data = await API.get('/projects/' + _comboCurCode + '/delivery');
    _deliveryData = data;
    _deliveryProgress = data.progress || 0;
    buildDelivery(data);
    if (_projDetail) buildDetailHeader(_projDetail);
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
    var data = await API.get('/projects/' + _comboCurCode + '/delivery');
    _deliveryData = data;
    _deliveryProgress = data.progress || 0;
    buildDelivery(data);
    if (_projDetail) buildDetailHeader(_projDetail);
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
        { key: 'created_at', title: '记录时间', width: '140px', render: function(v, row) { return '<span style="font-size:11px;font-family:var(--mono);color:var(--muted);white-space:nowrap">'+(fmtISODateTime(v)||'—')+'</span>'+(row.updated_at?'<div style="font-size:9px;color:var(--warn)">编辑过</div>':''); } },
        { key: 'stage_name', title: '涉及阶段', width: '90px', render: function(v) { return '<span style="font-size:12px">'+escHtml(v||'项目整体')+'</span>'; } },
        { key: 'recorded_by', title: '记录人', width: '70px', render: function(v) { return '<span style="font-size:12.5px;font-weight:540">'+escHtml(_userDisplayMap[v] || v || '')+'</span>'; } },
        { key: 'content', title: '内容', align: 'left', className: 'dt-wrap', render: function(v, row) {
          var plainText = stripHtml(renderMarkdown?renderMarkdown(v):v).substring(0,80);
          var replyMark = row.parent_id?'<span style="font-size:10px;color:var(--accent);margin-right:4px">↳ 回复</span>':'';
          var imgBadge = /!\[.*\]\(.*\)/.test(v)?' <span style="font-size:10px">📷</span>':'';
          return '<span style="font-size:13px;line-height:1.5">'+replyMark+escHtml(plainText)+(v&&v.length>80?'...':'')+imgBadge+'</span>';
        }},
        { key: 'actions', title: '操作', width: '90px', render: function(v, row) {
          var isMine = row.recorded_by === currentUser;
          var a = '<span style="cursor:pointer;font-size:12px;color:var(--accent);margin-right:4px" onclick="openViewNoteDialog('+row.id+')" title="查看">👁</span>';
          if (isMine) a += iconEdit('openEditNoteDialog('+row.id+')','编辑')+iconDelete('deleteProjectNote('+row.id+')','删除');
          else a += '<span style="cursor:pointer;font-size:12px;color:var(--accent)" onclick="openReplyNoteDialog('+row.id+')" title="回复">💬</span>';
          return a;
        }}
      ],
      data: notes,
      resizable: false,
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
        { key: 'created_at', title: '时间', width: '130px', render: function(v) { return '<span style="font-size:11px;font-family:var(--mono);color:var(--muted);white-space:nowrap">' + (fmtISODateTime(v) || '—') + '</span>'; } },
        { key: 'task_name', title: '任务名', width: 'auto', render: function(v, row) {
          var name = escHtml(v || '—');
          if (row.task_id && v) {
            return '<a href="javascript:void(0)" onclick="openProjectActivityTask(' + row.task_id + ')" style="font-size:12px;font-weight:500;color:var(--accent);text-decoration:none" title="查看任务详情">' + name + '</a>';
          }
          return '<span style="font-size:12px;font-weight:500">' + name + '</span>';
        } },
        { key: 'task_assignee', title: '责任人', width: '70px', render: function(v) { return '<span style="font-size:12px;color:var(--muted)">' + escHtml(v || '—') + '</span>'; } },
        { key: 'detail', title: '动态内容', align: 'left', className: 'dt-wrap', render: function(v, row) {
          var text = _cleanDetail(v, row.action);
          return '<span style="font-size:12px;line-height:1.5">' + escHtml(text.length > 100 ? text.substring(0, 100) + '...' : text) + '</span>';
        }}
      ],
      data: taskItems,
      resizable: false,
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
  _clearNoteImagePreviews('note-dialog-input-img-preview');
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
    initNoteImagePaste('note-dialog-input');
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
    // Pre-process custom image size syntax: ![](url =Wx) → <img>
    var content = note.content.replace(/!\[\]\((\/api\/note-images\/[^) ]+)\s*=(\d+)x\)/g, '<img src="$1" style="width:$2px;max-width:100%">');
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
  _clearNoteImagePreviews('edit-note-content-img-preview');
  API.get('/projects/' + _comboCurCode + '/notes').then(function(result) {
    var notes = (result && result.length) ? result : [];
    var note = notes.find(function(n) { return n.id === noteId; });
    if (!note) { showToast('笔记不存在', 'error'); return; }
    // Load existing images into preview
    setTimeout(function() { _loadExistingNoteImages(note.content, 'edit-note-content-img-preview'); }, 150);
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
    setTimeout(function() { initNoteImagePaste('edit-note-content'); }, 100);
    });
  });
}

async function saveEditNote(noteId) {
  var content = document.getElementById('edit-note-content').value.trim();
  var stage = document.getElementById('edit-note-stage').value;
  if (!content) { showToast('请输入内容', 'error'); return; }
  content = await _uploadNoteImages(content);
  closeSharedDialog();
  try {
    await API.put('/projects/' + _comboCurCode + '/notes/' + noteId, {content: content, stage_name: stage});
    showToast('已更新', 'success');
    var notes = await API.get('/projects/' + _comboCurCode + '/notes');
    buildNotes(notes || []);
  } catch(e) { showToast('编辑失败: ' + (e.message || ''), 'error'); }
}

function openReplyNoteDialog(parentId) {
  if (!_comboCurCode) return;
  _clearNoteImagePreviews('reply-note-content-img-preview');
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
    setTimeout(function() { initNoteImagePaste('reply-note-content'); }, 100);
  });
}

async function submitReplyNote(parentId, stageName) {
  var content = document.getElementById('reply-note-content').value.trim();
  if (!content) { showToast('请输入回复内容', 'error'); return; }
  content = await _uploadNoteImages(content);
  closeSharedDialog();
  try {
    await API.post('/projects/' + _comboCurCode + '/notes', {content: content, stage_name: stageName, parent_id: parentId});
    showToast('已回复', 'success');
    var notes = await API.get('/projects/' + _comboCurCode + '/notes');
    buildNotes(notes || []);
  } catch(e) { showToast('回复失败: ' + (e.message || ''), 'error'); }
}

async function deleteProjectNote(noteId) {
  if (!confirm('确认删除此笔记？（有回复的笔记不能删除）')) return;
  try {
    await API.del('/projects/' + _comboCurCode + '/notes/' + noteId);
    showToast('已删除', 'success');
    var notes = await API.get('/projects/' + _comboCurCode + '/notes');
    buildNotes(notes || []);
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

  content = await _uploadNoteImages(content);
  try {
    msg.innerHTML = '<span style="color:var(--muted)">保存中...</span>';
    await API.post('/projects/' + _comboCurCode + '/notes', { content: content, stage_name: stage });
    closeNoteDialog();
    var notes = await API.get('/projects/' + _comboCurCode + '/notes');
    buildNotes(notes);
  } catch(e) {
    msg.innerHTML = '<span style="color:var(--danger)">失败: ' + escHtml(e.message) + '</span>';
  }
}

/* Tab Switching */

function switchDTab(id, el) {
  document.querySelectorAll('.dsec').forEach(function(s) { s.classList.remove('active'); });
  document.querySelectorAll('.dtab').forEach(function(t) { t.classList.remove('active'); });
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
  // Update hash: user clicks push, initial load skip (history is handled by loadProjectDetail)
  if (_comboCurCode && typeof buildHash === 'function' && el) {
    history.pushState({ view: 'detail', params: [String(_comboCurCode), id] }, '', buildHash('detail', String(_comboCurCode), id));
  }
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

/* ⚠ showStageMismatchDialog / showStageNameEdit are now in components.js */

async function saveStageNameMapping(presetName) {
  var name;
  if (presetName) {
    name = presetName;  // one-click mapping from dialog button
  } else {
    if (!_mismatchExecId) { showToast('请重新点击告警标记', 'error'); return; }
    var sel = document.getElementById('stage-name-select');
    if (!sel) { showToast('表单已失效，请重新打开', 'error'); return; }
    name = sel.value.trim();
    if (!name) { showToast('请选择标准阶段名', 'error'); return; }
  }
  if (!_mismatchExecId) { showToast('请重新点击告警标记', 'error'); return; }

  try {
    await API.put('/projects/' + _comboCurCode + '/stages/' + _mismatchExecId + '/sync-to-zentao', { stage_name: name });
    showToast('PMA 映射已保存（请在禅道中手动修改执行名）', 'success');
    var dlg = document.querySelector('.stage-mismatch-dialog-overlay');
    if (dlg) dlg.remove();
    _mismatchExecId = null;
    var p = await Promise.all([
      API.get('/projects/' + _comboCurCode + '/stages'),
      API.get('/projects/' + _comboCurCode + '/documents'),
    ]);
    buildStages(p[0]);
    buildDocs(p[1]);
  } catch(e) {
    showToast('保存失败: ' + (e.message || '未知错误'), 'error');
  }
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
        if (typeof invalidateAllProjects === 'function') invalidateAllProjects();
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

  // Confirm wait→doing transition (triggers template sync) (#231)
  if (isEdit && _projDetail && _projDetail.raw_status === 'wait' && payload.status === 'doing') {
    if (!confirm('将项目状态从「待启动」切换为「进行中」将自动根据模板创建阶段、任务和文档。确认继续？')) {
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
    if (isEdit) {
      loadProjectDetail(_comboCurCode);
      if (typeof invalidateAllProjects === 'function') invalidateAllProjects();
    } else {
      // Refresh dashboard
      if (typeof loadKpiCards === 'function') loadKpiCards();
      if (typeof loadProjectTable === 'function') loadProjectTable();
      if (typeof invalidateAllProjects === 'function') invalidateAllProjects();
    }
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
    if (typeof invalidateAllProjects === 'function') invalidateAllProjects();
    showToast('项目已删除', 'success');
    // Navigate back to project list
    if (typeof gotoView === 'function') {
      gotoView('project-list');
    } else {
      location.reload();
    }
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
    loadMaintProjectProducts();
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
    API.put('/maintenance/projects/' + _comboCurCode + '/products', { items: items }).then(function() { loadMaintProjectProducts(); });
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
    API.put('/maintenance/projects/' + _comboCurCode + '/customers', { ids: ids }).then(function() { loadMaintProjectCustomers(); });
  });
}

function maintRemove_cust(cid) {
  var cust = _maintLinkedCustomers.find(function(c) { return c.id === cid; });
  var name = cust ? (cust.name || '') : '';
  verifyPassword('移除客户关联: ' + name, 'pw_verify_maint_remove').then(function(ok) {
    if (!ok) return;
    var ids = _maintLinkedCustomers.map(function(c) { return c.id; }).filter(function(id) { return id !== cid; });
    API.put('/maintenance/projects/' + _comboCurCode + '/customers', { ids: ids }).then(function() { loadMaintProjectCustomers(); });
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
  API.put('/maintenance/projects/' + _comboCurCode + '/tags', { tags: tags }).then(function() { loadMaintProjectTags(); });
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
    loadMaintProjectStages();
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
    // Refresh Gantt chart
    try {
      var ganttData = await API.get('/projects/' + projectCode + '/gantt');
      if (typeof buildGantt === 'function') buildGantt(ganttData);
    } catch(e) { /* non-critical */ }
    // Refresh maintenance stage list
    loadMaintProjectStages();
    // Refresh task table if loaded
    if (typeof loadTaskData === 'function') loadTaskData();
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
    loadMaintProjectStages();
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
        { key: 'idx', title: '#', width: '5%', render: function(v) { return '<span style="color:var(--muted)">'+v+'</span>'; } },
        { key: 'name', title: '阶段名称', width: '16%', render: function(v) { return '<span style="font-weight:500">'+escHtml(v||'')+'</span>'; } },
        { key: 'status', title: '状态', width: '10%', render: function(v) { var l=riskLabels[v]||v||'进行中'; var c=v==='blocked'?'var(--danger)':(v==='completed'?'var(--success)':'var(--accent)'); return '<span style="font-size:11px;padding:2px 8px;border-radius:10px;background:'+c+'15;color:'+c+';font-weight:500">'+escHtml(l)+'</span>'; } },
        { key: 'owner', title: '责任人', width: '10%', render: function(v) { return '<span style="font-size:12px">'+escHtml(v||'—')+'</span>'; } },
        { key: 'start', title: '计划开始', width: '12%', render: function(v) { return '<span style="font-size:12px">'+escHtml(v||'—')+'</span>'; } },
        { key: 'end', title: '计划结束', width: '12%', render: function(v) { return '<span style="font-size:12px">'+escHtml(v||'—')+'</span>'; } },
        { key: 'task_count', title: '任务数', width: '7%', render: function(v, row) { var n=escHtml(row.name||'').replace(/'/g,"\\'"); return '<span style="cursor:pointer;color:var(--accent);font-weight:500" onclick="gotoStageTasksFromMaint(\''+n+'\')" title="跳转到任务详情">'+(v||0)+'</span>'; } },
        { key: 'progress', title: '进度', width: '7%', render: function(v, row) { var n=escHtml(row.name||'').replace(/'/g,"\\'"); return '<span style="cursor:pointer" onclick="gotoStageTasksFromMaint(\''+n+'\')" title="跳转到任务详情">'+(typeof renderProgressRing==='function'?'<div style="display:inline-block">'+renderProgressRing(v||0)+'</div>':(v||0)+'%')+'</span>'; } },
        { key: 'completed_date', title: '完成日期', width: '8%', render: function(v) { return '<span style="font-size:12px">'+escHtml(v||'—')+'</span>'; } },
        { key: 'actions', title: '操作', render: function(v, row) { return '<span style="white-space:nowrap">'+(row.id&&canEditStage?iconEdit('openStageDialog('+row.id+')','编辑阶段')+iconDelete('deleteMaintStage('+row.id+',\''+escHtml(row.name||'').replace(/'/g,"\\'")+'\')','删除阶段'):'')+'</span>'; } }
      ],
      resizable: false,
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
      { key: 'created_at', title: '时间 <span id="act-sort-ind" style="cursor:pointer" onclick="toggleActivitySort()">' + sortIcon + '</span>', width: '160px', render: function(v) { return '<span class="act-td-time">'+escHtml(fmtISODateTime(v))+'</span>'; } },
      { key: 'display_name', title: '用户名 ' + userFilter, width: '100px', render: function(v, row) { return '<span class="act-td-user">'+escHtml(getDisplayName(v||row.username))+'</span>'; } },
      { key: 'action', title: '操作类型 ' + actionFilter, width: '120px', render: function(v) { return '<span class="activity-action pill">'+escHtml(v||'')+'</span>'; } },
      { key: 'detail', title: '具体明细', width: 'auto', align: 'left', className: 'dt-wrap', render: function(v) { return '<span class="act-td-detail">'+(v?escHtml(v):'')+'</span>'; } }
    ],
    data: items,
    maxHeight: 'calc(100vh - 330px)',
    resizable: false
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
