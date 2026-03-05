// AutoPipe Plugin: gff-viewer
// Interactive GFF/GTF annotation viewer

(function() {
  var GFF_HEADERS = ['seqid','source','type','start','end','score','strand','phase','attributes'];
  var PAGE_SIZE = 100;

  var FEATURE_COLORS = {
    gene: 'feature-gene', mrna: 'feature-mrna', transcript: 'feature-mrna',
    exon: 'feature-exon', cds: 'feature-cds',
    five_prime_utr: 'feature-utr', three_prime_utr: 'feature-utr',
    utr: 'feature-utr'
  };

  var allRecords = [];
  var filteredRecords = [];
  var sortCol = -1;
  var sortAsc = true;
  var currentPage = 0;
  var filterText = '';
  var filterChrom = '';
  var filterType = '';
  var rootEl = null;

  function parse(text) {
    var lines = text.split('\n');
    var recs = [];
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i].trim();
      if (!l || l[0] === '#') continue;
      var cols = l.split('\t');
      if (cols.length >= 9) recs.push(cols.slice(0, 9));
    }
    return recs;
  }

  function getUniqueCol(recs, col) {
    var seen = {};
    var list = [];
    for (var i = 0; i < recs.length; i++) {
      var v = recs[i][col];
      if (v && !seen[v]) { seen[v] = true; list.push(v); }
    }
    return list;
  }

  function regionLen(rec) {
    var s = parseInt(rec[3], 10);
    var e = parseInt(rec[4], 10);
    return isNaN(s) || isNaN(e) ? 0 : e - s + 1;
  }

  function formatNum(n) { return n.toLocaleString(); }

  function parseAttrs(str) {
    if (!str || str === '.') return [];
    var pairs = [];
    // GFF3: key=value; GTF: key "value";
    var parts = str.split(';');
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].trim();
      if (!p) continue;
      var eq = p.indexOf('=');
      var sp = p.indexOf(' ');
      if (eq > 0) {
        pairs.push({ key: p.substring(0, eq), val: p.substring(eq + 1) });
      } else if (sp > 0) {
        var k = p.substring(0, sp);
        var v = p.substring(sp + 1).replace(/"/g, '').trim();
        pairs.push({ key: k, val: v });
      }
      if (pairs.length >= 5) break;
    }
    return pairs;
  }

  function computeStats(recs) {
    var totalLen = 0, minLen = Infinity, maxLen = 0;
    var typeCounts = {};
    for (var i = 0; i < recs.length; i++) {
      var len = regionLen(recs[i]);
      totalLen += len;
      if (len < minLen) minLen = len;
      if (len > maxLen) maxLen = len;
      var t = recs[i][2];
      typeCounts[t] = (typeCounts[t] || 0) + 1;
    }
    if (recs.length === 0) minLen = 0;
    return { total: totalLen, min: minLen, max: maxLen,
             avg: recs.length > 0 ? Math.round(totalLen / recs.length) : 0,
             typeCounts: typeCounts };
  }

  function applyFilter() {
    var ft = filterText.toLowerCase();
    filteredRecords = allRecords.filter(function(rec) {
      if (filterChrom && rec[0] !== filterChrom) return false;
      if (filterType && rec[2] !== filterType) return false;
      if (ft) {
        var match = false;
        for (var i = 0; i < rec.length; i++) {
          if (rec[i].toLowerCase().indexOf(ft) >= 0) { match = true; break; }
        }
        if (!match) return false;
      }
      return true;
    });
    currentPage = 0;
  }

  function doSort(col) {
    if (sortCol === col) { sortAsc = !sortAsc; } else { sortCol = col; sortAsc = true; }
    filteredRecords.sort(function(a, b) {
      var va = a[col] || '';
      var vb = b[col] || '';
      if (col === 3 || col === 4 || col === 5) {
        var na = parseFloat(va);
        var nb = parseFloat(vb);
        if (!isNaN(na) && !isNaN(nb)) return sortAsc ? na - nb : nb - na;
      }
      return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
    });
    currentPage = 0;
  }

  function renderFeatureBadge(type) {
    var cls = FEATURE_COLORS[type.toLowerCase()] || 'feature-other';
    return '<span class="feature-badge ' + cls + '">' + type + '</span>';
  }

  function renderAttrs(str) {
    var pairs = parseAttrs(str);
    if (pairs.length === 0) return '.';
    var html = '';
    for (var i = 0; i < pairs.length; i++) {
      html += '<span class="attr-tag"><b>' + pairs[i].key + '</b>=' + pairs[i].val + '</span>';
    }
    return html;
  }

  function render() {
    if (!rootEl) return;
    var stats = computeStats(filteredRecords);
    var chroms = getUniqueCol(allRecords, 0);
    var types = getUniqueCol(allRecords, 2);
    var totalPages = Math.max(1, Math.ceil(filteredRecords.length / PAGE_SIZE));
    if (currentPage >= totalPages) currentPage = totalPages - 1;
    var startIdx = currentPage * PAGE_SIZE;
    var pageRecs = filteredRecords.slice(startIdx, startIdx + PAGE_SIZE);

    var html = '<div class="gff-plugin">';

    // Summary
    html += '<div class="gff-summary">';
    html += '<span class="stat"><b>' + formatNum(filteredRecords.length) + '</b> features</span>';
    html += '<span class="stat"><b>' + chroms.length + '</b> chromosomes</span>';
    html += '<span class="stat"><b>' + types.length + '</b> feature types</span>';
    html += '<span class="stat">Avg length: <b>' + formatNum(stats.avg) + ' bp</b></span>';
    if (filteredRecords.length !== allRecords.length) {
      html += '<span class="stat" style="color:#c62828">(' + formatNum(allRecords.length - filteredRecords.length) + ' filtered out)</span>';
    }
    html += '</div>';

    // Controls
    html += '<div class="gff-controls">';
    html += '<input type="text" id="gffFilter" placeholder="Search features..." value="' + filterText.replace(/"/g, '&quot;') + '">';
    html += '<select id="gffChromFilter"><option value="">All chromosomes</option>';
    for (var ci = 0; ci < chroms.length; ci++) {
      html += '<option value="' + chroms[ci] + '"' + (chroms[ci] === filterChrom ? ' selected' : '') + '>' + chroms[ci] + '</option>';
    }
    html += '</select>';
    html += '<select id="gffTypeFilter"><option value="">All types</option>';
    for (var ti = 0; ti < types.length; ti++) {
      html += '<option value="' + types[ti] + '"' + (types[ti] === filterType ? ' selected' : '') + '>' + types[ti] + '</option>';
    }
    html += '</select>';
    html += '</div>';

    // Table
    html += '<div class="gff-table-wrap" style="max-height:500px;overflow:auto;">';
    html += '<table class="gff-table"><thead><tr>';
    html += '<th>#</th>';
    for (var hi = 0; hi < GFF_HEADERS.length; hi++) {
      var arrow = '';
      if (sortCol === hi) arrow = '<span class="sort-arrow">' + (sortAsc ? '\u25B2' : '\u25BC') + '</span>';
      html += '<th data-col="' + hi + '">' + GFF_HEADERS[hi] + arrow + '</th>';
    }
    html += '<th>length</th>';
    html += '</tr></thead><tbody>';

    for (var ri = 0; ri < pageRecs.length; ri++) {
      var rec = pageRecs[ri];
      html += '<tr>';
      html += '<td style="color:#aaa">' + (startIdx + ri + 1) + '</td>';
      html += '<td>' + '<span class="chr-badge">' + rec[0] + '</span></td>';
      html += '<td>' + (rec[1] || '.') + '</td>';
      html += '<td>' + renderFeatureBadge(rec[2]) + '</td>';
      html += '<td>' + formatNum(parseInt(rec[3], 10) || 0) + '</td>';
      html += '<td>' + formatNum(parseInt(rec[4], 10) || 0) + '</td>';
      html += '<td>' + (rec[5] || '.') + '</td>';
      html += '<td>' + (rec[6] === '+' ? '<span class="strand-plus">+</span>' : rec[6] === '-' ? '<span class="strand-minus">-</span>' : rec[6] || '.') + '</td>';
      html += '<td>' + (rec[7] || '.') + '</td>';
      html += '<td>' + renderAttrs(rec[8]) + '</td>';
      html += '<td><span class="region-len">' + formatNum(regionLen(rec)) + ' bp</span></td>';
      html += '</tr>';
    }
    html += '</tbody></table></div>';

    // Pagination
    if (totalPages > 1) {
      html += '<div class="gff-pagination">';
      html += '<button data-page="prev">&laquo; Prev</button>';
      var startP = Math.max(0, currentPage - 3);
      var endP = Math.min(totalPages, startP + 7);
      if (startP > 0) html += '<button data-page="0">1</button><span>...</span>';
      for (var p = startP; p < endP; p++) {
        html += '<button data-page="' + p + '"' + (p === currentPage ? ' class="current"' : '') + '>' + (p + 1) + '</button>';
      }
      if (endP < totalPages) html += '<span>...</span><button data-page="' + (totalPages - 1) + '">' + totalPages + '</button>';
      html += '<button data-page="next">Next &raquo;</button>';
      html += '<span class="page-info">Page ' + (currentPage + 1) + ' of ' + totalPages + '</span>';
      html += '</div>';
    }

    html += '</div>';
    rootEl.innerHTML = html;

    // Events
    var fi = rootEl.querySelector('#gffFilter');
    if (fi) fi.addEventListener('input', function() { filterText = this.value; applyFilter(); render(); });
    var cs = rootEl.querySelector('#gffChromFilter');
    if (cs) cs.addEventListener('change', function() { filterChrom = this.value; applyFilter(); render(); });
    var ts = rootEl.querySelector('#gffTypeFilter');
    if (ts) ts.addEventListener('change', function() { filterType = this.value; applyFilter(); render(); });
    var ths = rootEl.querySelectorAll('.gff-table th[data-col]');
    for (var i = 0; i < ths.length; i++) {
      ths[i].addEventListener('click', function() { doSort(parseInt(this.getAttribute('data-col'), 10)); render(); });
    }
    var pbs = rootEl.querySelectorAll('.gff-pagination button');
    for (var i = 0; i < pbs.length; i++) {
      pbs[i].addEventListener('click', function() {
        var pg = this.getAttribute('data-page');
        if (pg === 'prev') { if (currentPage > 0) currentPage--; }
        else if (pg === 'next') { var tp = Math.ceil(filteredRecords.length / PAGE_SIZE); if (currentPage < tp - 1) currentPage++; }
        else { currentPage = parseInt(pg, 10); }
        render();
      });
    }
  }

  window.AutoPipePlugin = {
    render: function(container, fileUrl, filename) {
      rootEl = container;
      rootEl.innerHTML = '<div class="gff-loading">Loading ' + filename + '...</div>';
      allRecords = []; filteredRecords = []; sortCol = -1; sortAsc = true;
      currentPage = 0; filterText = ''; filterChrom = ''; filterType = '';

      fetch(fileUrl)
        .then(function(resp) { return resp.text(); })
        .then(function(data) {
          allRecords = parse(data);
          filteredRecords = allRecords.slice();
          render();
        })
        .catch(function(err) {
          rootEl.innerHTML = '<p style="color:red;padding:16px;">Error loading file: ' + err.message + '</p>';
        });
    },
    destroy: function() { allRecords = []; filteredRecords = []; rootEl = null; }
  };
})();
