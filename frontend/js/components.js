/* ═══════════════════════════════════════════════════
   REUSABLE RENDERING FUNCTIONS
═══════════════════════════════════════════════════ */
function renderProjIcon(type, code) {
  var t = (type || 'RD').toLowerCase();
  var label = code || (t === 'sc' ? 'SC' : 'RD');
  return '<div class="proj-icon ' + t + '">' + escHtml(label) + '</div>';
}

function renderTypeBadge(type) {
  var t = (type || 'RD').toLowerCase();
  return '<span class="badge badge-' + t + '">' + (TYPE_TXT[type] || type) + '项目</span>';
}

function renderPill(status) {
  return '<span class="pill ' + (status || 'pending') + '">' + (STATUS_TXT[status] || status) + '</span>';
}

function renderProgressBar(percent, status) {
  var p = parseFloat(percent) || 0;
  var fc = status === 'blocked' ? 'red' : p >= 100 ? 'green' : 'blue';
  return '<div class="progress-bar"><div class="progress-fill ' + fc + '" style="width:' + p + '%"></div></div>' +
         '<div class="prog-label">' + p + '%</div>';
}

function renderDelIcon(item) {
  if (item.done) {
    return '<div class="del-icon done">&#10003;</div>';
  } else if (item.warn) {
    return '<div class="del-icon warn">!</div>';
  }
  return '<div class="del-icon open"></div>';
}

function renderDeliverablesList(dels) {
  if (!dels || !dels.length) return '<span style="font-size:12px;color:var(--muted)">—</span>';
  return '<div class="del-list">' + dels.map(function(d) {
    var locHtml = d.location ? '<span class="doc-link" style="font-size:10.5px;padding:1px 6px">&#x2197; ' + d.location + '</span>' : '';
    var warnStyle = d.warn ? 'color:var(--danger)' : '';
    return '<div class="del-item">' +
      renderDelIcon(d) +
      '<span style="' + warnStyle + '">' + d.name + '</span>' +
      locHtml +
    '</div>';
  }).join('') + '</div>';
}
