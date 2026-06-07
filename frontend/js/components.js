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
    var locHtml = d.location ? '<span class="doc-link" style="font-size:10.5px;padding:1px 6px">&#x2197; ' + escHtml(d.location) + '</span>' : '';
    var warnStyle = d.warn ? 'color:var(--danger)' : '';
    return '<div class="del-item">' +
      renderDelIcon(d) +
      '<span style="' + warnStyle + '">' + escHtml(d.name) + '</span>' +
      locHtml +
    '</div>';
  }).join('') + '</div>';
}

/* ═══════════════════════════════════════════════════
   SHARED DIALOG UTILITY
═══════════════════════════════════════════════════ */

function openDialog(title, bodyHtml, buttons, opts) {
  opts = opts || {};
  var overlayClass = opts.overlayClass || 'shared-dialog-overlay';
  var maxWidth = opts.maxWidth || 440;

  var existing = document.querySelector('.' + overlayClass);
  if (existing) existing.remove();

  var btnHtml = '';
  if (buttons && buttons.length) {
    btnHtml = '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">' +
      buttons.map(function(b) {
        return '<button class="btn ' + (b.cls || '') + '" onclick="' + b.onclick + '">' + b.text + '</button>';
      }).join('') +
    '</div>';
  }

  var html = '<div class="note-dialog-overlay ' + overlayClass + '" onclick="if(event.target===this)this.remove()">' +
    '<div class="note-dialog" style="max-width:' + maxWidth + 'px" onclick="event.stopPropagation()">' +
      '<div class="note-dialog-head"><span class="note-dialog-title">' + title + '</span>' +
        '<button class="note-dialog-close" onclick="this.closest(\'.note-dialog-overlay\').remove()">&times;</button></div>' +
      bodyHtml +
      btnHtml +
    '</div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
}

/* ═══════════════════════════════════════════════════
   STAGE MISMATCH DIALOG (shared by stages + gantt)
═══════════════════════════════════════════════════ */

var STAGE_OPTIONS = ['售前', '项目立项', '需求分解', '硬件开发', '结构设计', 'BSP开发', '软件开发', '测试', '产品发货', '项目总结'];
var _mismatchExecId = null;

function showStageMismatchDialog(execId, stageName, suggestedName, event) {
  _mismatchExecId = execId;
  if (event) event.stopPropagation();

  var zentaoUrl = '';
  if (execId && typeof _zentaoWebBase !== 'undefined' && _zentaoWebBase) {
    zentaoUrl = _zentaoWebBase + '/index.php?m=execution&f=view&executionID=' + execId;
  }

  var bodyHtml = '<div style="padding:8px 0;line-height:1.8">';
  if (suggestedName) {
    bodyHtml +=
      '<p style="margin-bottom:10px">当前阶段名 <b style="color:var(--warn)">"' + escHtml(stageName) + '"</b> 与标准名不一致。</p>' +
      '<p style="margin-bottom:6px">请在禅道中将阶段名修改为：</p>' +
      '<p style="padding:12px 16px;background:var(--accent-lt);border:1px solid var(--accent);border-radius:8px;font-size:16px;font-weight:700;color:var(--accent);text-align:center;margin:10px 0">' + escHtml(suggestedName) + '</p>';
  } else {
    var standards = (typeof _standardStages !== 'undefined' && _standardStages.length)
      ? _standardStages : STAGE_OPTIONS;
    var stageListHtml = standards.map(function(st) {
      return '<li style="padding:2px 0;font-weight:500">' + escHtml(st) + '</li>';
    }).join('');
    bodyHtml +=
      '<p style="margin-bottom:10px">当前阶段名 <b style="color:var(--warn)">"' + escHtml(stageName) + '"</b> 不在标准阶段列表中。</p>' +
      '<p style="margin-bottom:6px;color:var(--muted)">请修改禅道阶段名为以下标准名称之一：</p>' +
      '<ul style="margin:0;padding-left:20px;color:var(--fg);font-size:13px">' + stageListHtml + '</ul>';
  }
  if (zentaoUrl) {
    bodyHtml += '<div style="margin-top:10px;padding:8px 12px;background:var(--bg);border-radius:6px;font-size:12px">' +
      '<a href="' + zentaoUrl + '" target="_blank" style="color:var(--accent);text-decoration:none;font-weight:500">&#x2197; 打开禅道阶段设置页面</a>' +
      '<span style="color:var(--muted);margin-left:6px">修改后重新同步即可</span></div>';
  }
  bodyHtml += '<p style="margin-top:12px;font-size:11px;color:var(--muted);font-style:italic">修改后下次禅道同步生效，系统将自动匹配并显示正常数据。</p>';
  bodyHtml += '</div>';

  var buttons = [{ text: '关闭', cls: '', onclick: "this.closest('.note-dialog-overlay').remove()" }];

  openDialog('⚠ 请修改禅道阶段名为标准名字', bodyHtml, buttons, { overlayClass: 'stage-mismatch-dialog-overlay' });
}

