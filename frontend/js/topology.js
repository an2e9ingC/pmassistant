/* ═══════════════════════════════════════════════════
   TOPOLOGY — Unified project-product-customer search
═══════════════════════════════════════════════════ */

var _topoTimer = null;

function initTopology() {
  document.getElementById('topo-proj').value = '';
  document.getElementById('topo-prod').value = '';
  document.getElementById('topo-cust').value = '';
  document.getElementById('topo-tbody').innerHTML = '<tr><td colspan="5"><div class="empty-state" style="padding:20px">输入关键字开始搜索...</div></td></tr>';

  // Pre-fill customer search if navigated from customer badge
  if (typeof _pendingCustSelect !== 'undefined' && _pendingCustSelect) {
    document.getElementById('topo-cust').value = _pendingCustSelect;
    _pendingCustSelect = null;
    onTopoSearch();
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

  if (!proj && !prod && !cust) {
    document.getElementById('topo-tbody').innerHTML = '<tr><td colspan="5"><div class="empty-state" style="padding:20px">输入关键字开始搜索...</div></td></tr>';
    return;
  }

  var params = [];
  if (proj) params.push('project=' + encodeURIComponent(proj));
  if (prod) params.push('product=' + encodeURIComponent(prod));
  if (cust) params.push('customer=' + encodeURIComponent(cust));

  var tbody = document.getElementById('topo-tbody');
  tbody.innerHTML = '<tr><td colspan="5"><div class="loading-spinner" style="padding:20px">搜索中...</div></td></tr>';

  try {
    var data = await API.get('/topology?' + params.join('&'));
    var items = data.items || [];
    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state" style="padding:20px">未找到匹配结果</div></td></tr>';
      return;
    }
    tbody.innerHTML = items.map(function(item) {
      var code = extractProjectCode(item.project_name);
      var coreName = extractCoreName(item.project_name);
      var productList = item.products || [];
      var productsHtml = productList.length
        ? productList.map(function(pr) {
            return '<button class="gs-btn gs-prod" onclick="event.stopPropagation();openProductDetail(\'' + pr.id + '\')" style="margin:1px 2px;font-size:11px">' + escHtml(pr.name) + '</button>';
          }).join('')
        : '<span style="font-size:12px;color:var(--muted)">—</span>';
      return '<tr onclick="openProject(\'' + item.project_id + '\')">' +
        '<td>' + renderProjIcon(item.project_type, code) + '</td>' +
        '<td><div class="proj-name">' + escHtml(coreName) + '</div><div class="proj-code">' + escHtml(code) + '</div></td>' +
        '<td><span onclick="event.stopPropagation();openCustomerByName(\'' + escHtml(item.customer_name || '') + '\')" style="cursor:pointer">' + renderCustomerBadge(item.customer_name) + '</span></td>' +
        '<td>' + productsHtml + '</td>' +
        '<td>' + renderPill(item.project_status) + '</td>' +
      '</tr>';
    }).join('');
  } catch(e) {
    tbody.innerHTML = '<tr><td colspan="5"><div class="error-state">搜索失败: ' + escHtml(e.message) + '<br><button onclick="onTopoSearch()">重试</button></div></td></tr>';
  }
}
