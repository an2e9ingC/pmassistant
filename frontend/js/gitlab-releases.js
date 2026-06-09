/* ═══════════════════════════════════════════════════
   GITLAB RELEASES VIEW — 发布版本统计页
   风格对齐产品总览：KPI 卡片 + 过滤 Tab + 搜索 + 表格
═══════════════════════════════════════════════════ */

var _glrAllItems = [];
var _glrKpi = { total: 0, with_url: 0, valid: 0, invalid: 0, unchecked: 0, missing_url: 0 };
var _glrFilter = 'all';      // all | with-url | valid | invalid | missing
var _glrValidFilter = '';    // '' | valid | invalid | unchecked | missing
var _glrSearchVal = '';
var _glrSearchTimer = null;

async function initGitLabReleases() {
  var tbody = document.getElementById('glr-tbody');
  tbody.innerHTML = '<tr><td colspan="6"><div class="loading-spinner">加载中...</div></td></tr>';

  try {
    var data = await API.get('/gitlab/releases/stats');
    _glrKpi = data.kpi || { total: 0, valid: 0, invalid: 0, unchecked: 0, missing_url: 0 };
    _glrAllItems = data.items || [];
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="6"><div class="error-state">加载失败: ' + escHtml(e.message) + '<br><button class="btn" onclick="initGitLabReleases()">重试</button></div></td></tr>';
    return;
  }

  renderGlrKpiCards();
  renderGlrTable();
}

function renderGlrKpiCards() {
  document.getElementById('glr-kpi-total').textContent = _glrKpi.total || 0;
  document.getElementById('glr-kpi-with-url').textContent = _glrKpi.with_url || 0;
  document.getElementById('glr-kpi-valid').textContent = _glrKpi.valid || 0;
  document.getElementById('glr-kpi-invalid').textContent = _glrKpi.invalid || 0;
  document.getElementById('glr-kpi-missing').textContent = _glrKpi.missing_url || 0;
}

function filterGlrReleases(filter, el) {
  _glrFilter = filter;
  document.querySelectorAll('#glr-kpi-grid .kpi-card').forEach(function(c) { c.classList.remove('active'); });
  if (el) el.classList.add('active');
  renderGlrTable();
}

function filterGlrByValid(valid, el) {
  _glrValidFilter = valid;
  document.querySelectorAll('[data-glr-valid]').forEach(function(t) {
    if (t.getAttribute('data-glr-valid') === valid) t.classList.add('active');
    else t.classList.remove('active');
  });
  renderGlrTable();
}

function onGlrSearch(v) {
  _glrSearchVal = v;
  clearTimeout(_glrSearchTimer);
  _glrSearchTimer = setTimeout(function() {
    renderGlrTable();
  }, 300);
}

function renderGlrTable() {
  var filtered = _glrAllItems;

  // KPI card filter
  if (_glrFilter === 'with-url') {
    filtered = filtered.filter(function(r) { return r.gitlab_url; });
  } else if (_glrFilter === 'valid') {
    filtered = filtered.filter(function(r) { return r.gitlab_url_valid === true; });
  } else if (_glrFilter === 'invalid') {
    filtered = filtered.filter(function(r) { return r.gitlab_url_valid === false; });
  } else if (_glrFilter === 'missing') {
    filtered = filtered.filter(function(r) { return !r.gitlab_url; });
  }

  // Valid sub-filter
  if (_glrValidFilter === 'valid') {
    filtered = filtered.filter(function(r) { return r.gitlab_url_valid === true; });
  } else if (_glrValidFilter === 'invalid') {
    filtered = filtered.filter(function(r) { return r.gitlab_url_valid === false; });
  } else if (_glrValidFilter === 'unchecked') {
    filtered = filtered.filter(function(r) { return r.gitlab_url && r.gitlab_url_valid === null; });
  } else if (_glrValidFilter === 'missing') {
    filtered = filtered.filter(function(r) { return !r.gitlab_url; });
  }

  // Search
  if (_glrSearchVal) {
    var q = _glrSearchVal.toLowerCase();
    filtered = filtered.filter(function(r) {
      return (r.product_name || '').toLowerCase().indexOf(q) >= 0 ||
        (r.product_code || '').toLowerCase().indexOf(q) >= 0 ||
        (r.version || '').toLowerCase().indexOf(q) >= 0 ||
        (r.gitlab_url || '').toLowerCase().indexOf(q) >= 0;
    });
  }

  var tbody = document.getElementById('glr-tbody');
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state">暂无匹配的发布版本</div></td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(function(r) {
    var productHtml = '<span style="font-weight:520">' + escHtml(r.product_name) + '</span>';
    if (r.product_code) {
      productHtml += '<div style="font-size:11px;color:var(--muted);font-family:var(--mono)">' + escHtml(r.product_code) + '</div>';
    }

    var versionHtml = '<span style="font-weight:520;font-family:var(--mono)">' + escHtml(r.version) + '</span>';
    if (r.marker === 1) {
      versionHtml += ' <span class="tag-badge tag-0" style="font-size:10px">里程碑</span>';
    }

    // GitLab URL — extracted from Zentao release desc
    var urlHtml;
    if (r.gitlab_url) {
      var displayUrl = r.gitlab_url.length > 55 ? r.gitlab_url.substring(0, 52) + '...' : r.gitlab_url;
      urlHtml = '<a href="' + escHtml(r.gitlab_url) + '" target="_blank" style="color:var(--accent);font-size:12px;word-break:break-all" title="来源: 禅道发布版本描述字段\n' + escHtml(r.gitlab_url) + '">' +
        escHtml(displayUrl) + ' &#x2197;</a>';
    } else {
      urlHtml = '<span style="color:var(--warn);font-size:11px" title="禅道发布版本描述(desc)中未检测到GitLab链接">⚠ 未填写</span>';
    }

    // Validation status — checked against GitLab API
    var validHtml, validColor;
    if (!r.gitlab_url) {
      validHtml = '—';
      validColor = 'var(--muted)';
    } else if (r.gitlab_url_valid === true) {
      validHtml = '✓ 有效';
      validColor = 'var(--success)';
    } else if (r.gitlab_url_valid === false) {
      validHtml = '✗ 无效';
      validColor = 'var(--danger)';
    } else {
      validHtml = '待校验';
      validColor = 'var(--muted)';
    }
    // Add checked_at tooltip if available
    if (r.gitlab_url_checked_at && r.gitlab_url) {
      validHtml = '<span title="上次校验: ' + r.gitlab_url_checked_at + '">' + validHtml + '</span>';
    } else if (r.gitlab_url && r.gitlab_url_valid === null) {
      validHtml = '<span title="需配置 GitLab Token 并在同步时自动校验">' + validHtml + '</span>';
    }

    var dateHtml = r.date ? r.date : '<span style="color:var(--muted)">—</span>';

    // Desc preview — source of GitLab URL
    var descText = r.desc || '';
    if (descText) {
      // Strip HTML tags for preview
      var tmp = document.createElement('div');
      tmp.innerHTML = descText;
      descText = (tmp.textContent || tmp.innerText || '').trim();
    }
    var descHtml;
    if (descText) {
      var shortDesc = descText.length > 60 ? descText.substring(0, 57) + '...' : descText;
      descHtml = '<span style="font-size:11px;color:var(--muted)" title="' + escHtml(descText) + '">' + escHtml(shortDesc) + '</span>';
    } else {
      descHtml = '<span style="font-size:11px;color:var(--muted);font-style:italic">（空）</span>';
    }

    // Row highlight for invalid
    var rowStyle = r.gitlab_url_valid === false ? ' style="background:var(--danger-lt)"' : '';

    return '<tr' + rowStyle + '>' +
      '<td>' + productHtml + '</td>' +
      '<td>' + versionHtml + '</td>' +
      '<td>' + urlHtml + '</td>' +
      '<td style="font-weight:600;color:' + validColor + '">' + validHtml + '</td>' +
      '<td style="font-size:12px">' + dateHtml + '</td>' +
      '<td>' + descHtml + '</td>' +
    '</tr>';
  }).join('');
}
