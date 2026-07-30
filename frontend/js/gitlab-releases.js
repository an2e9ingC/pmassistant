/* ═══════════════════════════════════════════════════
   GITLAB RELEASES VIEW — 发布版本统计页
   风格对齐产品总览：KPI 卡片 + 过滤 Tab + 搜索 + 表格
═══════════════════════════════════════════════════ */

var _glrAllItems = [];
var _glrKpi = { total: 0, with_url: 0, valid: 0, invalid: 0, unchecked: 0, missing_url: 0 };
var _glrFilter = 'all';
var _glrValidFilter = '';
var _glrSearchVal = '';
var _glrSearchTimer = null;
var _glrDt = null;

function _initGlrDt() {
  if (_glrDt) return;
  _glrDt = new DataTable({
    container: document.getElementById('glr-table'),
    columns: [
      { key: 'product_name', title: '产品', width: '12%', render: function(v, row) {
        var h = '<span style="font-weight:520">' + escHtml(v || '') + '</span>';
        if (row.product_code) h += '<div style="font-size:11px;color:var(--muted);font-family:var(--mono)">' + escHtml(row.product_code) + '</div>';
        return h;
      }},
      { key: 'version', title: '发布版本', width: '10%', render: function(v, row) {
        var h = '<span style="font-weight:520;font-family:var(--mono)">' + escHtml(v || '') + '</span>';
        if (row.marker === 1) h += ' <span class="tag-badge tag-0" style="font-size:10px">里程碑</span>';
        return h;
      }},
      { key: 'gitlab_url', title: 'GitLab 链接', width: '30%', align: 'left', render: function(v) {
        if (v) {
          var display = v.length > 55 ? v.substring(0, 52) + '...' : v;
          return '<a href="' + escHtml(v) + '" target="_blank" style="color:var(--accent);font-size:12px;word-break:break-all">' + escHtml(display) + ' ↗</a>';
        }
        return '<span style="color:var(--warn);font-size:11px">⚠ 未填写</span>';
      }},
      { key: 'gitlab_url_valid', title: '校验', width: '8%', render: function(v, row) {
        var validHtml, validColor;
        if (!row.gitlab_url) { validHtml = '—'; validColor = 'var(--muted)'; }
        else if (v === true) { validHtml = '✓ 有效'; validColor = 'var(--success)'; }
        else if (v === false) { validHtml = '✗ 无效'; validColor = 'var(--danger)'; }
        else { validHtml = '待校验'; validColor = 'var(--muted)'; }
        if (row.gitlab_url_checked_at && row.gitlab_url) validHtml = '<span title="上次校验: ' + row.gitlab_url_checked_at + '">' + validHtml + '</span>';
        else if (row.gitlab_url && v === null) validHtml = '<span title="需配置 GitLab Token 并在同步时自动校验">' + validHtml + '</span>';
        return '<span style="font-weight:600;color:' + validColor + '">' + validHtml + '</span>';
      }},
      { key: 'date', title: '发布日期', width: '8%', render: function(v) { return v ? '<span style="font-size:12px">' + escHtml(v) + '</span>' : '<span style="color:var(--muted)">—</span>'; } },
      { key: 'desc', title: '描述（来源）', width: '20%', render: function(v) {
        if (!v) return '<span style="font-size:11px;color:var(--muted);font-style:italic">（空）</span>';
        var tmp = document.createElement('div'); tmp.innerHTML = v;
        var text = (tmp.textContent || tmp.innerText || '').trim();
        var short = text.length > 60 ? text.substring(0, 57) + '...' : text;
        return '<span style="font-size:11px;color:var(--muted)" title="' + escHtml(text) + '">' + escHtml(short) + '</span>';
      }}
    ],
    maxHeight: 'calc(100vh - 360px)',
    resizable: false,
    rowClassFn: function(row) { return row.gitlab_url_valid === false ? { background: 'var(--danger-lt)' } : null; }
  });
}

function _glrApplyData(items) {
  _initGlrDt();
  _glrDt.setData(items || []);
}

async function initGitLabReleases() {
  _initGlrDt();
  _glrDt.setData([{ product_name: '加载中...', version: '', gitlab_url: '', gitlab_url_valid: null, date: '', desc: '' }]);

  try {
    var data = await API.get('/gitlab/releases/stats');
    _glrKpi = data.kpi || { total: 0, valid: 0, invalid: 0, unchecked: 0, missing_url: 0 };
    _glrAllItems = data.items || [];
  } catch (e) {
    _glrDt.setData([]);
    showToast('加载失败: ' + e.message, 'error');
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
  if (_glrFilter === 'with-url') filtered = filtered.filter(function(r) { return r.gitlab_url; });
  else if (_glrFilter === 'valid') filtered = filtered.filter(function(r) { return r.gitlab_url_valid === true; });
  else if (_glrFilter === 'invalid') filtered = filtered.filter(function(r) { return r.gitlab_url_valid === false; });
  else if (_glrFilter === 'missing') filtered = filtered.filter(function(r) { return !r.gitlab_url; });
  if (_glrValidFilter === 'valid') filtered = filtered.filter(function(r) { return r.gitlab_url_valid === true; });
  else if (_glrValidFilter === 'invalid') filtered = filtered.filter(function(r) { return r.gitlab_url_valid === false; });
  else if (_glrValidFilter === 'unchecked') filtered = filtered.filter(function(r) { return r.gitlab_url && r.gitlab_url_valid === null; });
  else if (_glrValidFilter === 'missing') filtered = filtered.filter(function(r) { return !r.gitlab_url; });
  if (_glrSearchVal) {
    var q = _glrSearchVal.toLowerCase();
    filtered = filtered.filter(function(r) { return (r.product_name||'').toLowerCase().indexOf(q)>=0 || (r.product_code||'').toLowerCase().indexOf(q)>=0 || (r.version||'').toLowerCase().indexOf(q)>=0 || (r.gitlab_url||'').toLowerCase().indexOf(q)>=0; });
  }
  _glrApplyData(filtered);
}
