/* ═══════════════════════════════════════════════════
   TOPOLOGY — Unified project-product-customer search
═══════════════════════════════════════════════════ */

var _topoTimer = null;
var _fuzzyTimer = null;
var _topoDt = null;

function _initTopoDt() {
  if (_topoDt) return;
  _topoDt = new DataTable({
    container: document.getElementById('topo-table'),
    columns: [
      { key: 'project_code', title: '项目编号', width: '10%', render: function(v, row) { return v ? projCodeTag(v, 'event.stopPropagation();openProject(\'' + escHtml(v).replace(/'/g, "\\'") + '\')', row.project_name) : '—'; } },
      { key: 'project_name', title: '项目名', render: function(v) { return '<div class="proj-name">' + escHtml(v || '') + '</div>'; } },
      { key: 'customer_name', title: '客户', width: '10%', render: function(v) { return '<span onclick="event.stopPropagation();openCustomerByName(\'' + escHtml(v || '') + '\')" style="cursor:pointer">' + renderCustomerBadge(v) + '</span>'; } },
      { key: 'products', title: '关联产品', render: function(v) {
        if (!v || !v.length) return '<span style="font-size:12px;color:var(--muted)">—</span>';
        return v.map(function(pr) { return '<button class="gs-btn gs-prod" onclick="event.stopPropagation();openProductDetail(\'' + escHtml(pr.code || pr.id) + '\')" style="margin:1px 2px;font-size:11px" title="' + escHtml(pr.name || '') + '">' + escHtml(pr.code || pr.name) + '</button>'; }).join('');
      }},
      { key: 'project_status', title: '状态', width: '10%', render: function(v) { return renderPill(v); } }
    ],
    maxHeight: 'calc(100vh - 260px)',
    emptyText: '输入关键字开始搜索...',
    clickable: false
  });
}

function _topoShowResult(items) {
  _initTopoDt();
  if (!_topoDt) return;
  if (!items || !items.length) {
    _topoDt.setData([]);
    return;
  }
  _topoDt.setData(items);
}

function initTopology() {
  document.getElementById('topo-fuzzy').value = '';
  document.getElementById('topo-proj').value = '';
  document.getElementById('topo-prod').value = '';
  document.getElementById('topo-cust').value = '';
  _initTopoDt();
  _topoDt.setData([]);

  // Auto-focus fuzzy search
  setTimeout(function() {
    var el = document.getElementById('topo-fuzzy');
    if (el) { el.focus(); el.select(); }
  }, 300);

  // Pre-fill customer search if navigated from customer badge
  if (typeof _pendingCustSelect !== 'undefined' && _pendingCustSelect) {
    document.getElementById('topo-cust').value = _pendingCustSelect;
    _pendingCustSelect = null;
    onTopoSearch();
  }
}

function onFuzzySearch() {
  clearTimeout(_fuzzyTimer);
  _fuzzyTimer = setTimeout(doFuzzySearch, 300);
}

async function doFuzzySearch() {
  var q = document.getElementById('topo-fuzzy').value.trim();
  if (!q) { _initTopoDt(); _topoDt.setData([]); return; }
  document.getElementById('topo-proj').value = '';
  document.getElementById('topo-prod').value = '';
  document.getElementById('topo-cust').value = '';

  _initTopoDt();
  _topoDt.setData([{ project_code: '', project_name: '搜索中...', customer_name: '', products: [], project_status: '' }]);
  try {
    var data = await API.get('/topology?q=' + encodeURIComponent(q));
    _topoShowResult((data && data.items) ? data.items : []);
  } catch(e) {
    _topoDt = null;
    document.getElementById('topo-table').innerHTML = '<div class="error-state" style="padding:20px">搜索失败: ' + escHtml(e.message) + '<br><button class="btn" style="margin-top:8px" onclick="onFuzzySearch()">重试</button></div>';
    showToast('搜索失败: ' + e.message, 'error');
  }
}

function onTopoSearch() {
  clearTimeout(_topoTimer);
  _topoTimer = setTimeout(doTopoSearch, 300);
}

async function doTopoSearch() {
  var proj = document.getElementById('topo-proj').value.trim();
  var prod = document.getElementById('topo-prod').value.trim();
  var cust = document.getElementById('topo-cust').value.trim();

  if (!proj && !prod && !cust) { _initTopoDt(); _topoDt.setData([]); return; }

  var params = [];
  if (proj) params.push('project=' + encodeURIComponent(proj));
  if (prod) params.push('product=' + encodeURIComponent(prod));
  if (cust) params.push('customer=' + encodeURIComponent(cust));

  _initTopoDt();
  try {
    var data = await API.get('/topology?' + params.join('&'));
    _topoShowResult((data && data.items) ? data.items : []);
  } catch(e) {
    _topoDt = null;
    document.getElementById('topo-table').innerHTML = '<div class="error-state" style="padding:20px">搜索失败: ' + escHtml(e.message) + '<br><button class="btn" style="margin-top:8px" onclick="onTopoSearch()">重试</button></div>';
    showToast('搜索失败: ' + e.message, 'error');
  }
}
