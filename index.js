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
    // Target the #__plugin_content__ div if it exists (tab mode), else rootEl
    var target = (rootEl && rootEl.querySelector('#__plugin_content__')) || rootEl;
    if (!target) return;
    var stats = computeStats(filteredRecords);
    var chroms = getUniqueCol(allRecords, 0);
    var types = getUniqueCol(allRecords, 2);
    var totalPages = Math.max(1, Math.ceil(_totalRecords / PAGE_SIZE));
    var startIdx = currentPage * PAGE_SIZE;
    var pageRecs = filteredRecords;

    var html = '<div class="gff-plugin">';

    // Summary
    html += '<div class="gff-summary">';
    html += '<span class="stat"><b>' + formatNum(_totalRecords) + '</b> features</span>';
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
    target.innerHTML = html;

    // Events
    var fi = target.querySelector('#gffFilter');
    if (fi) fi.addEventListener('input', function() { filterText = this.value; applyFilter(); render(); });
    var cs = target.querySelector('#gffChromFilter');
    if (cs) cs.addEventListener('change', function() { filterChrom = this.value; applyFilter(); render(); });
    var ts = target.querySelector('#gffTypeFilter');
    if (ts) ts.addEventListener('change', function() { filterType = this.value; applyFilter(); render(); });
    var ths = target.querySelectorAll('.gff-table th[data-col]');
    for (var i = 0; i < ths.length; i++) {
      ths[i].addEventListener('click', function() { doSort(parseInt(this.getAttribute('data-col'), 10)); render(); });
    }
    var pbs = target.querySelectorAll('.gff-pagination button');
    for (var i = 0; i < pbs.length; i++) {
      pbs[i].addEventListener('click', function() {
        var pg = this.getAttribute('data-page');
        var tp = Math.ceil(_totalRecords / PAGE_SIZE);
        if (pg === 'prev') { if (currentPage > 0) _loadPage(currentPage - 1); }
        else if (pg === 'next') { if (currentPage < tp - 1) _loadPage(currentPage + 1); }
        else { _loadPage(parseInt(pg, 10)); }
      });
    }
  }

  // ── IGV.js integration ──
  var KNOWN_GENOMES = [
    {id:'hg38', label:'Human (GRCh38/hg38)'},
    {id:'hg19', label:'Human (GRCh37/hg19)'},
    {id:'mm39', label:'Mouse (GRCm39/mm39)'},
    {id:'mm10', label:'Mouse (GRCm38/mm10)'},
    {id:'rn7',  label:'Rat (mRatBN7.2/rn7)'},
    {id:'rn6',  label:'Rat (Rnor_6.0/rn6)'},
    {id:'dm6',  label:'Fruit fly (BDGP6/dm6)'},
    {id:'ce11', label:'C. elegans (WBcel235/ce11)'},
    {id:'danRer11', label:'Zebrafish (GRCz11/danRer11)'},
    {id:'sacCer3',  label:'Yeast (sacCer3)'},
    {id:'tair10',   label:'Arabidopsis (TAIR10)'},
    {id:'galGal6',  label:'Chicken (GRCg6a/galGal6)'}
  ];
  var _igvRef = null;
  var _igvMode = 'data';
  var _selectedGenome = null;

  function _fetchReference() {
    return fetch('/api/reference').then(function(r) { return r.json(); })
      .then(function(d) { _igvRef = d.reference || null; })
      .catch(function() { _igvRef = null; });
  }

  function _loadIgvJs() {
    return new Promise(function(resolve, reject) {
      if (window.igv) { resolve(); return; }
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/igv@3/dist/igv.min.js';
      s.onload = function() { resolve(); };
      s.onerror = function() { reject(new Error('Failed to load igv.js')); };
      document.head.appendChild(s);
    });
  }

  function _buildGenomeDropdown() {
    var current = _selectedGenome || _igvRef || '';
    var html = '<span style="font-size:12px;color:#888;font-weight:500;margin-right:4px">Reference:</span>';
    html += '<select id="__igv_genome_select__" style="font-size:12px;padding:4px 8px;max-width:220px;border:1px solid #ddd;border-radius:4px">';
    html += '<option value="' + (_igvRef || '') + '"' + (current === _igvRef ? ' selected' : '') + '>' + (_igvRef || 'none') + '</option>';
    KNOWN_GENOMES.forEach(function(g) {
      if (g.id !== _igvRef) {
        html += '<option value="' + g.id + '"' + (current === g.id ? ' selected' : '') + '>' + g.label + '</option>';
      }
    });
    html += '</select>';
    return html;
  }

  function _renderIgv(container, fileUrl, filename, trackType, trackFormat) {
    container.innerHTML = '<div id="__igv_div__" class="ap-loading">Loading...</div>';
    _loadIgvJs().then(function() {
      var div = document.getElementById('__igv_div__');
      if (!div) return;
      div.innerHTML = '';
      var activeRef = _selectedGenome || _igvRef;
      var opts = {};
      var knownIds = KNOWN_GENOMES.map(function(g) { return g.id; });
      if (knownIds.indexOf(activeRef) >= 0) {
        opts.genome = activeRef;
      } else {
        opts.reference = { fastaURL: '/file/' + encodeURIComponent(activeRef), indexed: false };
      }
      opts.tracks = [{ type: trackType, format: trackFormat, url: fileUrl, name: filename }];
      igv.createBrowser(div, opts);
    }).catch(function(e) {
      container.innerHTML = '<div style="color:red;padding:16px;">IGV Error: ' + e.message + '</div>';
    });
  }

  var TRACK_TYPE = 'annotation';
  var TRACK_FORMAT = 'gff3';

  var _totalRecords = 0;
  var _currentFilename = '';

  function _fetchPage(filename, page) {
    return fetch('/data/' + encodeURIComponent(filename) + '?page=' + page + '&page_size=' + PAGE_SIZE)
      .then(function(resp) { return resp.json(); });
  }

  function _loadPage(page) {
    var target = (rootEl && rootEl.querySelector('#__plugin_content__')) || rootEl;
    if (!target) return;
    target.innerHTML = '<div class="ap-loading">Loading...</div>';

    _fetchPage(_currentFilename, page).then(function(data) {
      if (data.error) {
        target.innerHTML = '<p style="color:red;padding:16px;">Error: ' + data.error + '</p>';
        return;
      }
      _totalRecords = data.total || _totalRecords;
      currentPage = page;
      var text = '';
      if (data.rows) {
        for (var i = 0; i < data.rows.length; i++) {
          var row = data.rows[i];
          text += (Array.isArray(row) ? row.join('\t') : row) + '\n';
        }
      }
      allRecords = parse(text);
      filteredRecords = allRecords.slice();
      sortCol = -1; sortAsc = true; filterText = ''; filterChrom = ''; filterType = '';
      render();
    }).catch(function(err) {
      target.innerHTML = '<p style="color:red;padding:16px;">Error: ' + err.message + '</p>';
    });
  }

  function _renderData(container, fileUrl, filename) {
    container.innerHTML = '<div class="ap-loading">Loading...</div>';
    allRecords = []; filteredRecords = []; sortCol = -1; sortAsc = true;
    currentPage = 0; filterText = ''; filterChrom = ''; filterType = '';
    _currentFilename = filename;
    _loadPage(0);
  }

  function _showView(container, fileUrl, filename) {
    if (_igvRef) {
      var tabsHtml = '<div style="display:flex;gap:4px;margin-bottom:12px">';
      tabsHtml += '<button id="__tab_data__" style="padding:6px 16px;border:1px solid #ddd;border-radius:4px;cursor:pointer;font-size:13px;' + (_igvMode === 'data' ? 'background:#007bff;color:white;border-color:#007bff' : 'background:#f8f8f8') + '">Data</button>';
      tabsHtml += '<button id="__tab_igv__" style="padding:6px 16px;border:1px solid #ddd;border-radius:4px;cursor:pointer;font-size:13px;' + (_igvMode === 'igv' ? 'background:#007bff;color:white;border-color:#007bff' : 'background:#f8f8f8') + '">IGV</button>';
      tabsHtml += '</div>';
      if (_igvMode === 'igv') tabsHtml += _buildGenomeDropdown();
      container.innerHTML = tabsHtml + '<div id="__plugin_content__"></div>';

      container.querySelector('#__tab_data__').onclick = function() { _igvMode = 'data'; _showView(container, fileUrl, filename); };
      container.querySelector('#__tab_igv__').onclick = function() { _igvMode = 'igv'; _showView(container, fileUrl, filename); };
      var genomeSelect = container.querySelector('#__igv_genome_select__');
      if (genomeSelect) genomeSelect.onchange = function() { _selectedGenome = this.value; _showView(container, fileUrl, filename); };

      var content = container.querySelector('#__plugin_content__');
      if (_igvMode === 'igv') {
        _renderIgv(content, fileUrl, filename, TRACK_TYPE, TRACK_FORMAT);
      } else {
        _renderData(content, fileUrl, filename);
      }
    } else {
      _renderData(container, fileUrl, filename);
    }
  }

  window.AutoPipePlugin = {
    render: function(container, fileUrl, filename) {
      rootEl = container;
      rootEl.innerHTML = '<div class="ap-loading">Loading...</div>';
      _igvMode = 'data';
      _selectedGenome = null;

      _fetchReference().then(function() {
        _showView(container, fileUrl, filename);
      });
    },
    destroy: function() { allRecords = []; filteredRecords = []; rootEl = null; }
  };
})();
