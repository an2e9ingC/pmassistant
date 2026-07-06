/* PMA Bug Tracking System */
var _bugFilterProduct = null;
var _bugFilterStatus = '';
var _bugKanbanMode = false;
var _bfProjId = null;

/* ── Init & Render ── */

function initBugs() {
  var c = document.getElementById('view-bugs');
  if (!c) return;
  c.innerHTML = '<div style="display:flex;height:100%">' +
    '<div style="width:260px;flex-shrink:0;padding:16px;border-right:1px solid var(--border);overflow-y:auto" id="bug-sidebar"></div>' +
    '<div style="flex:1;display:flex;flex-direction:column;min-width:0">' +
      '<div class="section-hd" style="padding:12px 16px;border-bottom:1px solid var(--border)">' +
        '<span style="font-weight:600;font-size:15px">Bug 管理</span>' +
        '<div style="display:flex;gap:8px">' +
          '<button class="btn-sm" id="bug-view-list" onclick="switchBugView(\'list\')" style="background:var(--accent);color:#fff">列表</button>' +
          '<button class="btn-sm" id="bug-view-kanban" onclick="switchBugView(\'kanban\')">看板</button>' +
          '<button class="btn btn-primary" style="font-size:11px;padding:3px 10px" onclick="openBugDialog()">+ 新建Bug</button>' +
        '</div>' +
      '</div>' +
      '<div id="bug-content" style="flex:1;overflow:auto;padding:16px">加载中...</div>' +
    '</div>' +
  '</div>';
  _renderBugSidebar();
  loadBugs();
}

function switchBugView(mode) {
  _bugKanbanMode = (mode === 'kanban');
  document.getElementById('bug-view-list').style.background = mode==='list' ? 'var(--accent)' : '';
  document.getElementById('bug-view-list').style.color = mode==='list' ? '#fff' : '';
  document.getElementById('bug-view-kanban').style.background = mode==='kanban' ? 'var(--accent)' : '';
  document.getElementById('bug-view-kanban').style.color = mode==='kanban' ? '#fff' : '';
  loadBugs();
}

/* ── Sidebar Filters ── */

async function _renderBugSidebar() {
  var el = document.getElementById('bug-sidebar');
  if (!el) return;
  var html = '<div style="font-size:11px;color:var(--muted);margin-bottom:4px">产品</div>';
  try {
    var prods = await API.get('/products?limit=200');
    var items = (prods && prods.items) ? prods.items : (prods || []);
    html += '<select class="search-inp" id="bug-filter-prod" onchange="_bugFilterProduct=this.value;loadBugs()" style="width:100%;margin-bottom:14px">' +
      '<option value="">全部产品</option>';
    items.forEach(function(p) {
      html += '<option value="' + p.id + '">' + escHtml(p.code || p.name) + '</option>';
    });
    html += '</select>';
  } catch(e) { html += '<div class="error-state">加载产品失败</div>'; }

  html += '<div style="font-size:11px;color:var(--muted);margin-bottom:4px">状态</div>' +
    '<div style="display:flex;flex-direction:column;gap:3px;margin-bottom:14px">' +
    ['','open','confirmed','in_progress','resolved','closed'].map(function(s) {
      return '<button class="btn-sm" onclick="_bugFilterStatus=\''+s+'\';loadBugs()" style="text-align:left;font-size:11px;padding:4px 8px' +
        (_bugFilterStatus===s?';background:var(--accent);color:#fff':'') + '">' + (s||'全部') + '</button>';
    }).join('') + '</div>';

  // Show my bugs only
  html += '<button class="btn" onclick="_bugFilterAssignee=1;loadBugs()" style="font-size:11px;width:100%;margin-bottom:8px">我的Bug</button>';

  el.innerHTML = html;
}

/* ── Load & Render Bugs ── */

var _bugFilterAssignee = 0;

async function loadBugs() {
  var el = document.getElementById('bug-content');
  if (!el) return;
  el.innerHTML = '<div class="loading-spinner">加载中...</div>';
  try {
    var params = {};
    if (_bugFilterProduct) params.product_id = _bugFilterProduct;
    if (_bugFilterStatus) params.status = _bugFilterStatus;
    var url = _bugFilterAssignee ? '/bugs/my' : '/bugs';
    var bugs = await API.get(url + (_bugFilterAssignee ? '' : '?' + new URLSearchParams(params).toString()));
    bugs = bugs || [];
    if (_bugKanbanMode) _renderKanban(el, bugs);
    else _renderBugTable(el, bugs);
  } catch(e) {
    el.innerHTML = '<div class="error-state">加载失败: ' + escHtml(e.message) + '</div>';
  }
}

function _renderBugTable(container, bugs) {
  if (!bugs.length) { container.innerHTML = '<div class="empty-state">暂无Bug</div>'; return; }
  var labels = {open:'待确认',confirmed:'已确认',in_progress:'处理中',gitlab_submitted:'GitLab已提交',resolved:'已解决',closed:'已关闭'};
  var sevs = {1:'致命',2:'严重',3:'一般',4:'建议'};
  var html = '<div class="table-scroll"><table class="proj-table clickable"><thead><tr>' +
    '<th>编号</th><th>标题</th><th>产品</th><th>项目</th><th>组件</th><th>严重</th><th>优先级</th><th>状态</th><th>负责人</th><th>操作</th></tr></thead><tbody>';
  bugs.forEach(function(b) {
    html += '<tr onclick="openBugDetail('+b.id+')">' +
      '<td style="font-family:var(--mono);font-size:11px">#' + b.id + '</td>' +
      '<td style="text-align:left;font-weight:530">' + escHtml(b.title) + '</td>' +
      '<td style="font-size:12px">' + escHtml(b.product_name||'-') + '</td>' +
      '<td style="font-size:12px">' + escHtml(b.project_name||'-') + '</td>' +
      '<td style="font-size:11px">' + escHtml(b.component_name||'-') + '</td>' +
      '<td>' + _renderSev(sevs[b.severity]||'一般', b.severity) + '</td>' +
      '<td>' + _renderPriority(b.priority) + '</td>' +
      '<td>' + renderPill(b.status||'open') + '</td>' +
      '<td style="font-size:12px">' + escHtml(b.assignee_name||'-') + '</td>' +
      '<td onclick="event.stopPropagation()">' + iconEdit('openBugDialog('+b.id+')','编辑') + iconDelete('deleteBugById('+b.id+')','删除') + '</td>' +
    '</tr>';
  });
  html += '</tbody></table></div>';
  container.innerHTML = html;
}

function _renderKanban(container, bugs) {
  var cols = [
    {key:'open',label:'待确认'},{key:'confirmed',label:'已确认'},
    {key:'in_progress',label:'处理中'},{key:'gitlab_submitted',label:'GitLab已提交'},
    {key:'resolved',label:'已解决'},{key:'closed',label:'已关闭'}];
  var grouped = {};
  cols.forEach(function(c) { grouped[c.key] = []; });
  bugs.forEach(function(b) { var k = b.status||'open'; if (!grouped[k]) grouped[k] = []; grouped[k].push(b); });

  var html = '<div style="display:flex;gap:12px;overflow-x:auto;height:100%;align-items:flex-start">';
  cols.forEach(function(c) {
    html += '<div style="flex:1;min-width:200px;background:var(--bg);border-radius:8px;padding:10px">' +
      '<div style="font-weight:600;font-size:12px;margin-bottom:8px;color:var(--muted)">' + c.label + ' <span style="font-size:10px">' + grouped[c.key].length + '</span></div>';
    grouped[c.key].forEach(function(b) {
      html += '<div draggable="true" ondragstart="_bugDragStart(event,'+b.id+')" style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:8px;margin-bottom:6px;cursor:pointer;font-size:12px" onclick="openBugDetail('+b.id+')">' +
        '<div style="font-weight:530;margin-bottom:2px">' + escHtml(b.title) + '</div>' +
        '<div style="font-size:10px;color:var(--muted)">' + escHtml(b.product_name||'') + ' · ' + escHtml(b.assignee_name||'未分配') + '</div>' +
        '<div style="margin-top:4px">' + _renderSev('S'+b.severity, b.severity) + ' ' + _renderPriority(b.priority) + '</div>' +
      '</div>';
    });
    html += '</div>' +
      '<div ondragover="event.preventDefault()" ondrop="_bugDragDrop(event,\''+c.key+'\')" style="min-height:40px"></div>';
  });
  html += '</div>';
  container.innerHTML = html;
}

/* ── Bug Detail ── */

async function openBugDetail(bugId) {
  var data = await API.get('/bugs/' + bugId);
  var b = data || {};
  var labels = {open:'待确认',confirmed:'已确认',in_progress:'处理中',gitlab_submitted:'GitLab已提交',resolved:'已解决',closed:'已关闭'};
  var sevs = {1:'致命',2:'严重',3:'一般',4:'建议'};

  var html = '';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">' +
    '<div class="card" style="padding:14px"><div style="font-size:11px;font-weight:600;color:var(--muted);margin-bottom:6px">基本信息</div>' +
      '<div style="font-size:13px;font-weight:600;margin-bottom:6px">' + escHtml(b.title) + '</div>' +
      '<div style="font-size:12px;line-height:1.8">' +
        '<div><span style="color:var(--muted)">产品:</span> ' + escHtml(b.product_name||'-') + '</div>' +
        '<div><span style="color:var(--muted)">项目:</span> ' + escHtml(b.project_name||'-') + '</div>' +
        '<div><span style="color:var(--muted)">组件:</span> ' + escHtml(b.component_name||'-') + '</div>' +
        '<div><span style="color:var(--muted)">类型:</span> ' + escHtml(b.type||'') + '</div>' +
      '</div></div>' +
    '<div class="card" style="padding:14px"><div style="font-size:11px;font-weight:600;color:var(--muted);margin-bottom:6px">状态与进度</div>' +
      '<div style="font-size:12px;line-height:1.8">' +
        '<div><span style="color:var(--muted)">状态:</span> ' + renderPill(b.status||'open') + '</div>' +
        '<div><span style="color:var(--muted)">解决:</span> ' + escHtml(b.resolution||'-') + '</div>' +
        '<div><span style="color:var(--muted)">严重:</span> ' + sevs[b.severity] + '</div>' +
        '<div><span style="color:var(--muted)">优先级:</span> ' + (b.priority||'medium') + '</div>' +
        '<div><span style="color:var(--muted)">负责人:</span> ' + escHtml(b.assignee_name||'未分配') + '</div>' +
        '<div><span style="color:var(--muted)">创建人:</span> ' + escHtml(b.reporter_name||'') + '</div>' +
        '<div>预估 '+(b.estimate_hours||0)+'h / 实际 '+(b.consumed_hours||0)+'h</div>' +
      '</div></div></div>';

  if (b.description) html += '<div class="card" style="padding:14px;margin-bottom:12px"><div style="font-size:11px;font-weight:600;color:var(--muted);margin-bottom:6px">描述</div>' +
    '<div class="markdown-body" style="font-size:13px;line-height:1.6;max-height:300px;overflow-y:auto">' + renderMarkdown(b.description) + '</div></div>';

  html += '<div class="card" style="padding:14px;margin-bottom:12px"><div style="display:flex;justify-content:space-between;margin-bottom:8px">' +
    '<span style="font-size:11px;font-weight:600;color:var(--muted)">工时日志 ('+(b.consumed_hours||0).toFixed(1)+'h)</span>' +
    '<button class="btn btn-primary" style="font-size:11px;padding:3px 10px" onclick="openBugWorklogDialog('+bugId+')">+ 记录工时</button></div>' +
    '<div id="bv-worklogs">加载中...</div></div>';

  html += '<div class="card" style="padding:14px;margin-bottom:12px"><div style="display:flex;justify-content:space-between;margin-bottom:8px">' +
    '<span style="font-size:11px;font-weight:600;color:var(--muted)">分析记录</span>' +
    '<button class="btn btn-primary" style="font-size:11px;padding:3px 10px" onclick="openBugAnalysisDialog('+bugId+')">+ 添加</button></div>' +
    '<div id="bv-analyses" style="max-height:250px;overflow-y:auto"><div class="loading-spinner">加载中...</div></div></div>';

  var btns = [
    {text:'提交到GitLab',cls:'btn',onclick:'_bugSubmitGitlab('+bugId+')',enabled:!!(b.component_id && !b.gitlab_url)},
    {text:'编辑',cls:'btn-primary',onclick:'openBugDialog('+bugId+');closeSharedDialog()'},
    {text:'关闭',onclick:'closeSharedDialog()'}];
  openDialog('Bug #' + bugId, html, btns, {maxWidth:'65%'});

  // Load worklogs + analyses
  API.get('/bugs/'+bugId+'/worklogs').then(function(logs) {
    var el = document.getElementById('bv-worklogs');
    if (el) el.innerHTML = _renderWorklogTable(logs||[]);
  });
  _loadBugAnalyses(bugId);
}

/* ── Create/Edit Dialog ── */

function openBugDialog(bugId) {
  var isEdit = !!bugId;
  if (isEdit) {
    API.get('/bugs/'+bugId).then(function(b) { _showBugForm(b); });
  } else {
    _showBugForm(null);
  }
}

function _showBugForm(b) {
  var isEdit = !!b; var t = b || {};
  window._bfProdId = t.product_id || null;
  var html = '<div style="max-height:60vh;overflow-y:auto;padding-right:4px">' +
    '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">标题 *</label>' +
    '<input class="search-inp" id="bf-title" value="'+escHtml(t.title||'')+'" style="width:100%;box-sizing:border-box;margin-top:2px"></div>' +
    // Row: 产品 | 项目 (full width each, 2-col)
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
      '<div><label style="font-size:11px;color:var(--muted)">产品 *</label>' +
        '<div style="margin-top:2px">' + createProductCombo({
          comboId: 'bf-prod', inputId: 'bf-prod-input', dropdownId: 'bf-prod-drop',
          placeholder: '搜索产品...',
          selectedIdFn: function() { return t.product_id || null; },
          onSelect: function(p) { _bfProdId = p.id; _bugLoadComponents(); }
        }) + '</div></div>' +
      '<div><label style="font-size:11px;color:var(--muted)">项目</label>' +
        '<div style="margin-top:2px">' + createSearchCombo({
          comboId: 'bf-proj', inputId: 'bf-proj-input', dropdownId: 'bf-proj-drop',
          placeholder: '搜索项目...',
          dataSource: function() { return API.get('/products/'+(_bfProdId||0)+'/projects').then(function(d){ return d||[]; }).catch(function(){ return []; }); },
          selectedIdFn: function() { return t.project_id || null; },
          onSelect: function(p) { _bfProjId = p.id; }
        }) + '</div></div>' +
    '</div>' +
    // Row: 组件 | 负责人 | 严重程度 | 优先级 (4-col)
    '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px 10px">' +
      '<div><label style="font-size:11px;color:var(--muted)">组件</label><select class="search-inp" id="bf-component" style="width:100%;margin-top:2px"><option value="">选择组件...</option></select></div>' +
      '<div><label style="font-size:11px;color:var(--muted)">负责人</label><div id="bf-assignee-wrap" style="margin-top:2px"></div></div>' +
      '<div><label style="font-size:11px;color:var(--muted)">严重程度</label><select class="search-inp" id="bf-severity" style="width:100%;margin-top:2px">' +
        '<option value="1">1-致命</option><option value="2">2-严重</option><option value="3" selected>3-一般</option><option value="4">4-建议</option></select></div>' +
      '<div><label style="font-size:11px;color:var(--muted)">优先级</label><select class="search-inp" id="bf-priority" style="width:100%;margin-top:2px">' +
        '<option value="low">低</option><option value="medium" selected>中</option><option value="high">高</option><option value="critical">紧急</option></select></div>' +
    '</div>' +
    // Row: 类型 | 状态 | 预估工时 | (empty) (4-col)
    '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px 10px">' +
      '<div><label style="font-size:11px;color:var(--muted)">类型</label><select class="search-inp" id="bf-type" style="width:100%;margin-top:2px">' +
        '<option value="codeerror">代码错误</option><option value="design">设计缺陷</option><option value="security">安全问题</option><option value="performance">性能问题</option><option value="other">其他</option></select></div>' +
      '<div><label style="font-size:11px;color:var(--muted)">状态</label><select class="search-inp" id="bf-status" style="width:100%;margin-top:2px">' +
        '<option value="open">待确认</option><option value="confirmed">已确认</option><option value="in_progress">处理中</option><option value="resolved">已解决</option><option value="closed">已关闭</option></select></div>' +
      '<div><label style="font-size:11px;color:var(--muted)">预估工时(h)</label>' +
        '<input class="search-inp" id="bf-estimate" type="number" step="0.5" value="'+(t.estimate_hours||'')+'" style="width:100%;margin-top:2px"></div>' +
      '<div></div>' +
    '</div>' +
    '<div style="margin-top:8px"><label style="font-size:11px;color:var(--muted)">描述模板 <span style="font-weight:400">（可选）</span></label>' +
    '<select class="search-inp" id="bf-desc-tpl" onchange="_bugApplyDescTemplate()" style="width:100%;box-sizing:border-box;margin-top:2px">' +
      '<option value="">不使用模板</option></select></div>' +
    '<div style="margin-top:8px"><div style="display:flex;align-items:center;justify-content:space-between">' +
      '<label style="font-size:11px;color:var(--muted)">描述（Markdown）</label>' +
      '<button class="btn btn-xs" onclick="_bugToggleMdPreview()" style="font-size:10px;padding:1px 6px">预览</button>' +
    '</div>' +
    '<textarea class="search-inp" id="bf-desc" rows="6" style="width:100%;box-sizing:border-box;margin-top:2px;resize:vertical">'+escHtml(t.description||'')+'</textarea>' +
    '<div id="bf-desc-preview" class="markdown-body" style="display:none;max-height:200px;overflow-y:auto;padding:8px;border:1px solid var(--border);border-radius:6px;margin-top:2px;font-size:13px"></div>' +
    '<div style="display:flex;gap:8px;margin-top:4px;align-items:center">' +
      '<label class="btn btn-sm" style="cursor:pointer;font-size:10px;padding:2px 8px">📎 附件<input type="file" id="bf-file-input" style="display:none" onchange="_bugUploadAttach()" multiple></label>' +
      '<span style="font-size:10px;color:var(--muted)">支持粘贴图片 (Ctrl+V)</span>' +
    '</div></div>' +
  '</div>';
  var title = isEdit ? '编辑Bug #'+t.id : '新建Bug';
  openDialog(title, html, [
    {text:'取消',onclick:'closeSharedDialog()'},
    {text:isEdit?'保存':'创建',cls:'btn-primary',onclick:'_submitBug('+(t.id||'null')+')'}], {maxWidth:'60%'});
  // Load bug description templates (independent of product selection)
  API.get('/product-doc-templates/bug-templates').then(function(btpls) {
  window._bfDescTemplates = btpls || [];
    var tplSel = document.getElementById('bf-desc-tpl');
    var defaultTpl = (btpls||[]).find(function(t) { return t.is_default; });
    if (tplSel) {
      tplSel.innerHTML = '<option value="">不使用模板</option>';
      (btpls||[]).forEach(function(t) { tplSel.innerHTML += '<option value="'+t.id+'">'+escHtml(t.name)+'</option>'; });
      if (defaultTpl && !isEdit) { tplSel.value = defaultTpl.id; _bugApplyDescTemplate(); }
    }
  });

  // Pre-fill existing product name + load projects/components for edit mode
  if (t.product_id) {
    setTimeout(function() {
      API.get('/products?limit=200').then(function(data) {
        var items = (data && data.items) ? data.items : (data || []);
        var p = items.find(function(x) { return x.id == t.product_id; });
        var inp = document.getElementById('bf-prod-input');
        if (inp && p) inp.value = p.name;
      });
      _bugLoadComponents();
    }, 100);
  }
  if (isEdit && t.severity) { setTimeout(function() { var s=document.getElementById('bf-severity'); if(s)s.value=t.severity; },100); }
  if (isEdit && t.priority) { setTimeout(function() { var s=document.getElementById('bf-priority'); if(s)s.value=t.priority; },100); }
  if (isEdit && t.status) { setTimeout(function() { var s=document.getElementById('bf-status'); if(s)s.value=t.status; },100); }
  // Create user combo + init features
  setTimeout(function() {
    var wrap = document.getElementById('bf-assignee-wrap');
    if (wrap) wrap.innerHTML = createUserCombo({comboId:'bf-assignee',inputId:'bf-assignee-input',dropdownId:'bf-assignee-drop',
      selectedIdFn:function(){return t.assignee_id||null;},
      onSelect:function(u){window._bfAsgnId=u.id;}});
    _initBugFormFeatures();
  }, 80);
}

function _bugLoadComponents() {
  if (!_bfProdId) { _bugFillComponents([]); return; }
  API.get("/product-management/products/" + _bfProdId + "/node").then(function(r) {
    var nodeId = (r && r.node_id) ? r.node_id : null;
    if (nodeId) {
      API.get("/product-doc-templates/templates/" + nodeId).then(function(tpls) {
        window._bfAllTemplates = (tpls||[]).filter(function(t, i, arr) {
          return arr.findIndex(function(x) { return x.doc_name === t.doc_name; }) === i;
        });
        _bugFillComponents(window._bfAllTemplates);
      }).catch(function() { _bugFillComponents([]); });
    } else { _bugFillComponents([]); }
  }).catch(function() { _bugFillComponents([]); });
}
function _bugFillComponents(tpls) {
  var sel = document.getElementById('bf-component'); if (!sel) return;
  sel.innerHTML = '<option value="">选择组件...</option>';
  (tpls||[]).forEach(function(t) { sel.innerHTML += '<option value="'+t.id+'">'+escHtml(t.doc_name)+'</option>'; });
}

function _bugToggleMdPreview() {
  var ta = document.getElementById('bf-desc');
  var pv = document.getElementById('bf-desc-preview');
  var btn = event && event.target;
  if (!ta || !pv) return;
  if (pv.style.display === 'none') {
    pv.innerHTML = renderMarkdown(ta.value);
    pv.style.display = '';
    ta.style.display = 'none';
    if (btn) btn.textContent = '编辑';
  } else {
    pv.style.display = 'none';
    ta.style.display = '';
    if (btn) btn.textContent = '预览';
  }
}

function _bugApplyDescTemplate() {
  var tplSel = document.getElementById('bf-desc-tpl');
  var descEl = document.getElementById('bf-desc');
  if (!tplSel || !descEl) return;
  var tplId = tplSel.value;
  if (!tplId) return;
  var tpls = window._bfDescTemplates || [];
  var t = tpls.find(function(x) { return x.id == tplId; });
  if (t) descEl.value = t.content || '';
}

async function _submitBug(bugId) {
  var title = document.getElementById('bf-title').value.trim();
  if (!title) { showToast('请输入标题','error'); return; }
  var pid = _bfProdId || 0;
  if (!pid) { showToast('请选择产品','error'); return; }
  var payload = {
    title:title, product_id:pid,
    description:document.getElementById('bf-desc').value.trim(),
    project_id:_bfProjId||null,
    component_id:parseInt(document.getElementById('bf-component').value)||null,
    severity:parseInt(document.getElementById('bf-severity').value)||3,
    priority:document.getElementById('bf-priority').value,
    type:document.getElementById('bf-type').value,
    status:document.getElementById('bf-status').value,
    estimate_hours:parseFloat(document.getElementById('bf-estimate').value)||0,
    assignee_id:window._bfAsgnId||null,
  };
  try {
    var result;
    if (bugId) result = await API.put('/bugs/'+bugId, payload);
    else result = await API.post('/bugs', payload);
    var newId = bugId || (result && result.id);
    // Upload pending files and replace (待上传) placeholders with real URLs
    var pending = window._bfPendingFiles || [];
    window._bfPendingFiles = [];
    var desc = payload.description || '';
    for (var i = 0; i < pending.length; i++) {
      try {
        var att = await uploadAttachment(newId, pending[i]);
        var url = att.url || '/api/attachments/' + att.id;
        desc = desc.replace('src="待上传" alt="' + pending[i].name + '"', 'src="' + url + '" alt="' + pending[i].name + '"');
      } catch(e) {}
    }
    // Update description with real URLs
    if (desc !== payload.description && newId) {
      await API.put('/bugs/' + newId, {description: desc});
    }
    showToast(bugId?'已更新':'已创建','success');
    closeSharedDialog();
    loadBugs();
  } catch(e) { showToast('操作失败: '+(e.message||''),'error'); }
}

/* ── Worklog ── */

function openBugWorklogDialog(bugId) {
  var html = '<div><div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">工时(h) *</label>' +
    '<input class="search-inp" id="bwl-hours" type="number" step="0.5" value="1" style="width:100%;margin-top:2px"></div>' +
    '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">日期</label>' +
    '<input class="search-inp" id="bwl-date" type="date" value="'+fmtLocalDate()+'" style="width:100%;margin-top:2px"></div>' +
    '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--muted)">描述</label>' +
    '<textarea class="search-inp" id="bwl-desc" rows="2" style="width:100%;margin-top:2px;resize:vertical"></textarea></div></div>';
  openDialog('记录工时', html, [
    {text:'取消',onclick:'closeSharedDialog()'},
    {text:'提交',cls:'btn-primary',onclick:'_submitBugWorklog('+bugId+')'}], {maxWidth:400});
}

async function _submitBugWorklog(bugId) {
  var h = parseFloat(document.getElementById('bwl-hours').value);
  if (!h||h<=0) { showToast('请输入有效的工时数','error'); return; }
  try {
    await API.post('/bugs/'+bugId+'/worklogs', {bug_id:bugId, hours:h, date:document.getElementById('bwl-date').value, description:document.getElementById('bwl-desc').value.trim()});
    showToast('工时已记录','success'); closeSharedDialog();
    var data = await API.get('/bugs/'+bugId);
    var el = document.getElementById('bv-worklogs');
    if (el) { API.get('/bugs/'+bugId+'/worklogs').then(function(logs){ el.innerHTML = _renderWorklogTable(logs||[]); }); }
  } catch(e) { showToast('记录失败: '+(e.message||''),'error'); }
}

function _renderWorklogTable(logs) {
  if (!logs||!logs.length) return '<div style="color:var(--muted);font-size:12px">暂无工时记录</div>';
  var h = '<table class="proj-table" style="font-size:12px"><thead><tr><th>日期</th><th>用户</th><th>工时(h)</th><th>描述</th></tr></thead><tbody>';
  logs.forEach(function(w) { h += '<tr><td>'+(w.date||'?')+'</td><td>'+escHtml(w.username||'?')+'</td><td>'+w.hours.toFixed(1)+'</td><td style="text-align:left">'+escHtml(w.description||'')+'</td></tr>'; });
  return h + '</tbody></table>';
}

/* ── Analysis ── */

function openBugAnalysisDialog(bugId) {
  var html = '<div><label style="font-size:11px;color:var(--muted)">分析内容（Markdown）</label>' +
    '<textarea class="search-inp" id="ba-content" rows="5" style="width:100%;box-sizing:border-box;margin-top:4px;resize:vertical"></textarea></div>';
  openDialog('添加分析记录', html, [
    {text:'取消',onclick:'closeSharedDialog()'},
    {text:'提交',cls:'btn-primary',onclick:'_submitBugAnalysis('+bugId+')'}], {maxWidth:500});
}

async function _submitBugAnalysis(bugId) {
  var c = document.getElementById('ba-content').value.trim();
  if (!c) { showToast('请输入分析内容','error'); return; }
  try {
    await API.post('/bugs/'+bugId+'/analysis', {bug_id:bugId, content:c});
    showToast('分析已添加','success'); closeSharedDialog();
    _loadBugAnalyses(bugId);
  } catch(e) { showToast('提交失败: '+(e.message||''),'error'); }
}

function _loadBugAnalyses(bugId) {
  API.get('/bugs/'+bugId).then(function(d) {
    var el = document.getElementById('bv-analyses');
    if (!el) return;
    var analyses = d.analyses || [];
    if (!analyses.length) { el.innerHTML = '<div style="color:var(--muted);font-size:12px">暂无分析记录</div>'; return; }
    var h = '';
    analyses.forEach(function(a) {
      h += '<div style="border-left:2px solid var(--accent);padding:4px 0 8px 12px;margin-bottom:4px">' +
        '<div style="font-size:11px;color:var(--muted);margin-bottom:4px">'+(a.created_at||'?')+'</div>' +
        '<div class="markdown-body" style="font-size:13px;line-height:1.6">'+renderMarkdown(a.content)+'</div></div>';
    });
    el.innerHTML = h;
  });
}

/* ── Delete ── */

async function deleteBugById(id) {
  if (!confirm('确定删除此Bug？')) return;
  try { await API.del('/bugs/'+id); showToast('已删除','success'); loadBugs(); }
  catch(e) { showToast('删除失败: '+(e.message||''),'error'); }
}

/* ── Helpers ── */



function _bugUploadAttach() {
  var inp = document.getElementById('bf-file-input');
  if (!inp || !inp.files.length) return;
  var bugId = null; // Not created yet — upload after create
  // For new bugs, store files and upload after creation
  window._bfPendingFiles = window._bfPendingFiles || [];
  for (var i = 0; i < inp.files.length; i++) {
    window._bfPendingFiles.push(inp.files[i]);
    var ta = document.getElementById('bf-desc');
    if (ta) ta.value += '\n📎 ' + inp.files[i].name + ' (待上传)\n';
  }
  inp.value = '';
}

function _initBugFormFeatures() {
  var ta = document.getElementById('bf-desc');
  var bugId = null; // Will be filled after create
  if (ta) initImagePaste(ta, bugId || 0, function(url) {
    // Store URL for later use
    if (!window._bfUploadedUrls) window._bfUploadedUrls = [];
    window._bfUploadedUrls.push(url);
  });
}

async function _bugSubmitGitlab(bugId) {
  if (!confirm('将此Bug提交到GitLab创建Issue？\n\n需要仓库Reporter权限。')) return;
  try {
    var r = await API.post('/bugs/'+bugId+'/gitlab-submit');
    showToast('已提交到GitLab: ' + (r.gitlab_url||''), 'success');
    closeSharedDialog();
    loadBugs();
  } catch(e) { showToast('提交失败: '+(e.message||''),'error'); }
}

function _bugDragStart(e, bugId) { e.dataTransfer.setData('text/plain', String(bugId)); }
async function _bugDragDrop(e, newStatus) {
  e.preventDefault();
  var bugId = parseInt(e.dataTransfer.getData('text/plain'));
  if (!bugId) return;
  try {
    await API.put('/bugs/'+bugId, {status: newStatus});
    loadBugs();
  } catch(ex) { showToast('更新失败: '+(ex.message||''),'error'); }
}

function _renderSev(label, sev) {
  var c = {1:'var(--danger)',2:'var(--warn)',3:'var(--muted)',4:'var(--success)'};
  return '<span style="font-size:11px;color:'+(c[sev]||c[3])+';font-weight:600">'+label+'</span>';
}
function _renderPriority(p) {
  var labels = {low:'低',medium:'中',high:'高',critical:'紧急'};
  var colors = {low:'var(--muted)',medium:'var(--fg)',high:'var(--warn)',critical:'var(--danger)'};
  return '<span style="font-size:11px;color:'+(colors[p]||colors.medium)+'">'+(labels[p]||p)+'</span>';
}
