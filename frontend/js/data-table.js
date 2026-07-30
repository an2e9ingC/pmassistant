/* ═══════════════════════════════════════════════════
   DataTable — standardized table component
   Replaces inline table HTML concatenation across all views
═══════════════════════════════════════════════════ */

var DataTable = (function() {
  'use strict';

  var INSTANCE_ID = 0;

  function DataTable(opts) {
    opts = opts || {};
    this._id = ++INSTANCE_ID;
    this._container = typeof opts.container === 'string'
      ? document.querySelector(opts.container)
      : opts.container;
    if (!this._container) throw new Error('DataTable: container not found');

    // ── Columns ──
    this._columns = (opts.columns || []).map(function(col) {
      return {
        key: col.key || '',
        title: col.title || '',
        width: col.width || 'auto',
        minWidth: col.minWidth || 40,
        align: col.align || 'center',
        sortable: col.sortable || false,
        resizable: col.resizable !== false,
        render: col.render || null,
        headerRender: col.headerRender || null,
        className: col.className || '',
        rowspan: col.rowspan || false
      };
    });

    // ── Options ──
    this._headerBg = opts.headerBg || 'var(--surface2)';
    this._headerColor = opts.headerColor || null;
    this._rowStriped = opts.rowStriped !== false;
    this._rowClassFn = opts.rowClassFn || null;
    this._hoverHighlight = opts.hoverHighlight !== false;
    this._stickyHeader = opts.stickyHeader !== false;
    this._maxHeight = opts.maxHeight || null;
    this._resizable = opts.resizable !== false;
    this._selectable = opts.selectable || false;
    this._checkboxPosition = opts.checkboxPosition || 'left';
    this._onSelectChange = opts.onSelectChange || null;
    this._emptyText = opts.emptyText || '暂无数据';
    this._clickable = opts.clickable === true;
    this._onRowClick = opts.onRowClick || null;

    // ── Sort state ──
    this._sortCol = null;
    this._sortDir = 'asc';
    this._externalSort = opts.externalSort || null;

    // ── Data ──
    this._data = opts.data || [];
    this._selected = new Set();
    this._idKey = opts.idKey || 'id';

    // ── Build DOM ──
    this._buildDOM();
    this.refresh();
  }

  /* ── DOM Construction ── */

  DataTable.prototype._buildDOM = function() {
    var self = this;

    // Scroll container
    this._scrollEl = document.createElement('div');
    this._scrollEl.className = 'dt-scroll';
    if (this._maxHeight) this._scrollEl.style.maxHeight = this._maxHeight;

    // Table
    this._tableEl = document.createElement('table');
    this._tableEl.className = 'dt-table';
    if (this._resizable) this._tableEl.style.tableLayout = 'fixed';
    if (this._rowStriped) this._tableEl.classList.add('dt-striped');
    if (this._hoverHighlight) this._tableEl.classList.add('dt-hover');
    if (this._clickable) this._tableEl.classList.add('dt-clickable');

    // Header color variants
    if (this._headerBg === 'var(--accent)' || this._headerBg === '--accent')
      this._tableEl.classList.add('dt-header-accent');
    else if (this._headerBg === 'var(--success)' || this._headerBg === '--success')
      this._tableEl.classList.add('dt-header-success');
    else if (this._headerBg === 'var(--danger)' || this._headerBg === '--danger')
      this._tableEl.classList.add('dt-header-danger');
    else if (this._headerBg === 'var(--warn)' || this._headerBg === '--warn')
      this._tableEl.classList.add('dt-header-warn');
    else if (this._headerBg && this._headerBg !== 'var(--surface2)')
      this._tableEl.style.setProperty('--dt-custom-header-bg', this._headerBg);

    // Header
    this._theadEl = document.createElement('thead');
    this._renderHeader();
    this._tableEl.appendChild(this._theadEl);

    // Body
    this._tbodyEl = document.createElement('tbody');
    this._tableEl.appendChild(this._tbodyEl);

    this._scrollEl.appendChild(this._tableEl);
    this._container.innerHTML = '';
    this._container.appendChild(this._scrollEl);

    // ── Attach event handlers ──
    this._attachSort();
    this._attachResize();
    if (this._selectable) this._attachSelect();
    if (this._onRowClick) this._attachRowClick();
  };

  DataTable.prototype._renderHeader = function() {
    var self = this;
    var tr = document.createElement('tr');

    // Checkbox column position: check if placed as numbered index
    var cbIdx = -1;
    if (this._selectable) {
      if (this._checkboxPosition === 'left') cbIdx = 0;
      else if (this._checkboxPosition === 'right') cbIdx = this._columns.length;
      else if (typeof this._checkboxPosition === 'number') cbIdx = this._checkboxPosition;
      else cbIdx = 0;
    }

    this._columns.forEach(function(col, i) {
      // Insert checkbox before column at cbIdx
      if (cbIdx === i) {
        var cbTh = self._buildCheckboxHeader();
        tr.appendChild(cbTh);
      }

      var th = document.createElement('th');
      if (col.width && col.width !== 'auto') th.style.width = col.width;
      if (col.minWidth) th.style.minWidth = col.minWidth + 'px';
      if (col.sortable) th.classList.add('dt-sortable');

      // Header content
      var titleHtml = col.headerRender
        ? col.headerRender(col)
        : (typeof col.title === 'function' ? col.title() : col.title);
      th.innerHTML = titleHtml;

      if (col.sortable) {
        var ind = document.createElement('span');
        ind.className = 'dt-sort-ind';
        ind.setAttribute('data-sort-col', col.key);
        ind.textContent = self._sortCol === col.key ? (self._sortDir === 'asc' ? '▲' : '▼') : '⇅';
        th.appendChild(ind);
      }

      // Resize handle
      if (self._resizable && col.resizable) {
        var handle = document.createElement('div');
        handle.className = 'dt-resize-handle';
        handle.setAttribute('data-col', i);
        th.appendChild(handle);
      }

      th.setAttribute('data-col', col.key);
      tr.appendChild(th);
    });

    // Checkbox at right (end)
    if (cbIdx >= this._columns.length) {
      var cbThRight = this._buildCheckboxHeader();
      tr.appendChild(cbThRight);
    }

    this._theadEl.innerHTML = '';
    this._theadEl.appendChild(tr);
  };

  DataTable.prototype._buildCheckboxHeader = function() {
    var th = document.createElement('th');
    th.className = 'dt-cb-cell';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.title = '全选/取消全选';
    var self = this;
    cb.onchange = function() {
      self._toggleSelectAll(this.checked);
    };
    th.appendChild(cb);
    this._selectAllCb = cb;
    return th;
  };

  /* ── Data Rendering ── */

  DataTable.prototype._renderBody = function() {
    var self = this;
    this._tbodyEl.innerHTML = '';

    if (!this._data || !this._data.length) {
      var tr = document.createElement('tr');
      var td = document.createElement('td');
      td.colSpan = this._columns.length + (this._selectable ? 1 : 0);
      td.className = 'dt-empty';
      td.textContent = this._emptyText;
      tr.appendChild(td);
      this._tbodyEl.appendChild(tr);
      return;
    }

    // Determine checkbox column position
    var cbIdx = -1;
    if (this._selectable) {
      if (this._checkboxPosition === 'left') cbIdx = 0;
      else if (this._checkboxPosition === 'right') cbIdx = this._columns.length;
      else if (typeof this._checkboxPosition === 'number') cbIdx = this._checkboxPosition;
      else cbIdx = 0;
    }

    // Pre-compute rowspan for columns with rowspan: true
    var rowspanMap = {};
    self._columns.forEach(function(col, i) {
      if (!col.rowspan) return;
      var spans = [], count = 0;
      for (var r = 0; r < self._data.length; r++) {
        count++;
        var nextVal = r + 1 < self._data.length ? self._data[r + 1][col.key] : null;
        var curVal = self._data[r][col.key];
        if (nextVal !== curVal) { spans.push({start: r - count + 1, count: count}); count = 0; }
      }
      rowspanMap[i] = spans;
    });

    this._data.forEach(function(row, rowIdx) {
      var tr = document.createElement('tr');
      tr.setAttribute('data-row-idx', rowIdx);
      var rowId = row[self._idKey];
      if (rowId != null) tr.setAttribute('data-row-id', rowId);

      if (self._rowClassFn) {
        var cls = self._rowClassFn(row, rowIdx);
        if (typeof cls === 'string') tr.className = cls;
        else if (cls && typeof cls === 'object') {
          for (var key in cls) { if (cls.hasOwnProperty(key)) tr.style[key] = cls[key]; }
        }
      }

      if (rowId != null && self._selected.has(rowId)) tr.classList.add('selected');

      self._columns.forEach(function(col, i) {
        if (cbIdx === i) { tr.appendChild(self._buildCheckboxCell(row, rowId)); }

        // Rowspan: skip cell if covered by a previous row's rowspan
        if (rowspanMap[i]) {
          for (var s = 0; s < rowspanMap[i].length; s++) {
            var span = rowspanMap[i][s];
            if (rowIdx >= span.start && rowIdx < span.start + span.count) {
              if (rowIdx === span.start) {
                var td = document.createElement('td'); td.rowSpan = span.count; td.style.verticalAlign = 'middle';
                var val = row[col.key];
                td.innerHTML = col.render ? col.render(val, row, rowIdx, span.count) : (val != null ? escHtml(String(val)) : '');
                td.style.textAlign = col.align; if (col.className) td.className = col.className;
                tr.appendChild(td);
              }
              return;
            }
          }
        }

        var td = document.createElement('td'); var val = row[col.key];
        td.innerHTML = col.render ? col.render(val, row, rowIdx) : (val != null ? escHtml(String(val)) : '');
        td.style.textAlign = col.align; if (col.className) td.className = col.className;
        tr.appendChild(td);
      });

      if (cbIdx >= self._columns.length) { tr.appendChild(self._buildCheckboxCell(row, rowId)); }
      self._tbodyEl.appendChild(tr);
    });
  };

  DataTable.prototype._buildCheckboxCell = function(row, rowId) {
    var td = document.createElement('td');
    td.className = 'dt-cb-cell';
    td.onclick = function(e) { e.stopPropagation(); };
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = rowId != null ? rowId : '';
    if (rowId != null && this._selected.has(rowId)) cb.checked = true;
    var self = this;
    cb.onchange = function() {
      self._toggleRow(rowId, this.checked, row);
    };
    td.appendChild(cb);
    return td;
  };

  /* ── Selection ── */

  DataTable.prototype._toggleSelectAll = function(checked) {
    var self = this;
    if (checked) {
      this._data.forEach(function(row) {
        var id = row[self._idKey];
        if (id != null) self._selected.add(id);
      });
    } else {
      this._selected.clear();
    }
    this._updateSelectionUI();
    if (this._onSelectChange) this._onSelectChange(this.getSelected());
  };

  DataTable.prototype._toggleRow = function(id, checked, row) {
    if (checked) this._selected.add(id);
    else this._selected.delete(id);

    // Update select-all checkbox state
    if (this._selectAllCb) {
      this._selectAllCb.indeterminate = false;
      if (this._selected.size === 0) this._selectAllCb.checked = false;
      else if (this._selected.size === this._data.length) this._selectAllCb.checked = true;
      else { this._selectAllCb.checked = false; this._selectAllCb.indeterminate = true; }
    }

    // Update row class
    var tr = this._tbodyEl.querySelector('[data-row-id="' + id + '"]');
    if (tr) { if (checked) tr.classList.add('selected'); else tr.classList.remove('selected'); }

    if (this._onSelectChange) this._onSelectChange(this.getSelected());
  };

  DataTable.prototype._updateSelectionUI = function() {
    var self = this;
    // Update all checkboxes and row classes
    var rows = this._tbodyEl.querySelectorAll('tr[data-row-id]');
    rows.forEach(function(tr) {
      var id = tr.getAttribute('data-row-id');
      var cb = tr.querySelector('input[type="checkbox"]');
      var checked = self._selected.has(Number(id) || id);
      if (cb) cb.checked = checked;
      if (checked) tr.classList.add('selected'); else tr.classList.remove('selected');
    });
    if (this._selectAllCb) {
      this._selectAllCb.checked = this._selected.size === this._data.length && this._data.length > 0;
      this._selectAllCb.indeterminate = this._selected.size > 0 && this._selected.size < this._data.length;
    }
  };

  /* ── Sorting ── */

  DataTable.prototype._attachSort = function() {
    var self = this;
    this._theadEl.addEventListener('click', function(e) {
      var th = e.target.closest('th.dt-sortable');
      if (!th) return;
      // Don't sort if clicking resize handle
      if (e.target.closest('.dt-resize-handle')) return;
      var colKey = th.getAttribute('data-col');
      self._toggleSort(colKey);
    });
  };

  DataTable.prototype._toggleSort = function(colKey) {
    if (this._sortCol === colKey) {
      this._sortDir = this._sortDir === 'asc' ? 'desc' : this._sortDir === 'desc' ? 'none' : 'asc';
      if (this._sortDir === 'none') { this._sortCol = null; this._sortDir = 'asc'; }
    } else {
      this._sortCol = colKey;
      this._sortDir = 'asc';
    }
    this._applySort();
  };

  DataTable.prototype._applySort = function() {
    if (!this._sortCol) {
      this._renderBody();
      this._renderSortIndicators();
      return;
    }

    var self = this;
    var colKey = this._sortCol;
    var dir = this._sortDir;

    if (this._externalSort) {
      this._externalSort(colKey, dir, function(sortedData) {
        self._data = sortedData;
        self._renderBody();
        self._updateSelectionUI();
        self._renderSortIndicators();
      });
    } else {
      // Built-in sort
      this._data.sort(function(a, b) {
        var va = a[colKey], vb = b[colKey];
        if (va == null) va = '';
        if (vb == null) vb = '';
        if (typeof va === 'number' && typeof vb === 'number') {
          return dir === 'asc' ? va - vb : vb - va;
        }
        va = String(va); vb = String(vb);
        return dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      });
      this._renderBody();
      this._updateSelectionUI();
      this._renderSortIndicators();
    }
  };

  DataTable.prototype._renderSortIndicators = function() {
    var inds = this._theadEl.querySelectorAll('.dt-sort-ind');
    var self = this;
    inds.forEach(function(ind) {
      var col = ind.getAttribute('data-sort-col');
      if (col === self._sortCol) {
        ind.textContent = self._sortDir === 'asc' ? '▲' : '▼';
        ind.className = 'dt-sort-ind ' + self._sortDir;
      } else {
        ind.textContent = '⇅';
        ind.className = 'dt-sort-ind';
      }
    });
  };

  /* ── Column Resize ── */

  DataTable.prototype._attachResize = function() {
    var self = this;
    var state = null;

    this._theadEl.addEventListener('mousedown', function(e) {
      var handle = e.target.closest('.dt-resize-handle');
      if (!handle) return;
      e.preventDefault();
      var colIdx = parseInt(handle.getAttribute('data-col'));
      var th = handle.parentElement;
      state = { handle: handle, th: th, colIdx: colIdx, startX: e.clientX, startW: th.offsetWidth };
      handle.classList.add('active');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', function(e) {
      if (!state) return;
      var delta = e.clientX - state.startX;
      var newW = Math.max(state.th.style.minWidth ? parseInt(state.th.style.minWidth) : 40, state.startW + delta);
      state.th.style.width = newW + 'px';
      state.th.style.minWidth = newW + 'px';
    });

    document.addEventListener('mouseup', function() {
      if (!state) return;
      state.handle.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      state = null;
    });
  };

  /* ── Selection attach (click on row) ── */

  DataTable.prototype._attachRowClick = function() {
    var self = this;
    this._tbodyEl.addEventListener('click', function(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'A' || e.target.tagName === 'BUTTON' || e.target.closest('a') || e.target.closest('button')) return;
      var tr = e.target.closest('tr[data-row-idx]');
      if (!tr) return;
      var idx = parseInt(tr.getAttribute('data-row-idx'));
      if (idx >= 0 && idx < self._data.length) {
        if (self._onRowClick) self._onRowClick(self._data[idx], idx);
      }
    });
  };

  DataTable.prototype._attachSelect = function() {
    var self = this;
    this._tbodyEl.addEventListener('click', function(e) {
      // Checkbox clicks are handled directly on the input
      if (e.target.tagName === 'INPUT') return;
      // Click on row: toggle selection via the row's checkbox
      var tr = e.target.closest('tr[data-row-id]');
      if (!tr) return;
      var cb = tr.querySelector('input[type="checkbox"]');
      if (cb) { cb.checked = !cb.checked; cb.onchange({ target: cb }); }
    });
  };

  /* ── Public API ── */

  DataTable.prototype.setData = function(data) {
    this._data = data || [];
    this._selected.clear();
    this.refresh();
  };

  DataTable.prototype.refresh = function() {
    this._renderBody();
    this._updateSelectionUI();
  };

  DataTable.prototype.sortBy = function(colKey, dir) {
    this._sortCol = colKey;
    this._sortDir = dir || 'asc';
    this._applySort();
  };

  DataTable.prototype.getSelected = function() {
    var self = this;
    return this._data.filter(function(row) {
      var id = row[self._idKey];
      return id != null && self._selected.has(id);
    });
  };

  DataTable.prototype.filter = function(predicate) {
    // External filter — caller should manage data
    if (typeof predicate === 'function') {
      this._data = this._data.filter(predicate);
    }
    this.refresh();
  };

  DataTable.prototype.enableDragReorder = function(listRef, renderFn) {
    var self = this;
    var tbody = this._tbodyEl;
    // Attach drag handlers to index cells
    tbody.querySelectorAll('td[data-drag-index]').forEach(function(td) {
      td.setAttribute('draggable', 'true');
      td.style.cursor = 'grab';
    });
    // Use event delegation on tbody
    tbody._dragHandler = function(e) {
      var td = e.target.closest('td[data-drag-index]');
      if (!td) return;
      var idx = parseInt(td.getAttribute('data-drag-index'));
      if (e.type === 'dragstart') {
        self._dragSourceIdx = idx;
        td.style.opacity = '0.4';
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', '');
      } else if (e.type === 'dragend') {
        td.style.opacity = '';
        tbody.querySelectorAll('.dt-drag-over').forEach(function(r) { r.classList.remove('dt-drag-over'); });
      } else if (e.type === 'dragover') {
        e.preventDefault(); e.dataTransfer.dropEffect = 'move';
        td.parentElement.classList.add('dt-drag-over');
      } else if (e.type === 'dragleave') {
        td.parentElement.classList.remove('dt-drag-over');
      } else if (e.type === 'drop') {
        e.preventDefault(); e.stopPropagation();
        td.parentElement.classList.remove('dt-drag-over');
        var targetIdx = idx;
        if (self._dragSourceIdx < 0 || self._dragSourceIdx === targetIdx) return;
        var moved = listRef.splice(self._dragSourceIdx, 1)[0];
        listRef.splice(targetIdx, 0, moved);
        for (var i = 0; i < listRef.length; i++) { listRef[i].sort_order = i + 1; }
        self._dragSourceIdx = -1;
        // Update DataTable data and refresh
        self._data = listRef.slice();
        self.refresh();
        self.enableDragReorder(listRef, renderFn);
        if (typeof renderFn === 'function') setTimeout(renderFn, 50);
      }
    };
    tbody.addEventListener('dragstart', tbody._dragHandler);
    tbody.addEventListener('dragend', tbody._dragHandler);
    tbody.addEventListener('dragover', tbody._dragHandler);
    tbody.addEventListener('dragleave', tbody._dragHandler);
    tbody.addEventListener('drop', tbody._dragHandler);
  };

  DataTable.prototype.destroy = function() {
    this._scrollEl.removeEventListener('mousedown', null);
    this._container.innerHTML = '';
    this._data = null;
    this._selected.clear();
  };

  /* ── Expose ── */
  window.DataTable = DataTable;
  return DataTable;
})();
