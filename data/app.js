/* ── MOCK DATA ──────────────────────────────────────── */

var MOCK_STATUS = {
  device: 'Edge101 Auditor', version: '0.1.0', build: 'Jun 08 2026',
  uptime_s: 4812, free_heap: 218240, ip: '192.168.1.101',
  ble: 6, modbus: 6, modbus_valid: 6, can: 6, sd: false
};

var MOCK_BLE = [
  { mac: 'AA:BB:CC:11:22:33', nombre: 'Smartphone Operador A',  rssi: -38, visto_ms: 1800  },
  { mac: 'DE:AD:BE:EF:00:01', nombre: 'Beacon Sala Servidores', rssi: -56, visto_ms: 4200  },
  { mac: '55:44:33:22:11:00', nombre: 'Sensor Temperatura',     rssi: -62, visto_ms: 9000  },
  { mac: 'F0:E1:D2:C3:B4:A5', nombre: '',                       rssi: -74, visto_ms: 22000 },
  { mac: '11:22:AB:CD:EF:10', nombre: 'Tablet Mantenimiento',   rssi: -81, visto_ms: 45000 },
  { mac: '99:88:77:66:55:44', nombre: '',                       rssi: -91, visto_ms: 88000 },
];

var MOCK_EVENTS = [
  { utc:0, uptime_ms:245000, source:'ble',    detail:'MAC=AA:BB:CC:11:22:33 name=Smartphone rssi=-38' },
  { utc:0, uptime_ms:244200, source:'modbus', detail:'slave=5 fc=0x06 len=8' },
  { utc:0, uptime_ms:243800, source:'can',    detail:'id=0x181 dlc=6 ext=0' },
  { utc:0, uptime_ms:243100, source:'can',    detail:'id=0x18F00400 dlc=8 ext=1' },
  { utc:0, uptime_ms:242000, source:'modbus', detail:'slave=1 fc=0x04 len=8' },
  { utc:0, uptime_ms:240500, source:'ble',    detail:'MAC=11:22:AB:CD:EF:10 name=Tablet rssi=-81' },
  { utc:0, uptime_ms:239200, source:'modbus', detail:'slave=3 fc=0x03 len=8' },
  { utc:0, uptime_ms:238600, source:'can',    detail:'id=0x182 dlc=4 ext=0' },
  { utc:0, uptime_ms:237000, source:'modbus', detail:'slave=7 fc=0x03 len=8' },
  { utc:0, uptime_ms:235000, source:'ble',    detail:'MAC=DE:AD:BE:EF:00:01 name=Beacon rssi=-56' },
  { utc:0, uptime_ms:233400, source:'can',    detail:'id=0x18FE0900 dlc=8 ext=1' },
  { utc:0, uptime_ms:231000, source:'modbus', detail:'slave=2 fc=0x04 len=8' },
  { utc:0, uptime_ms:229000, source:'can',    detail:'id=0x701 dlc=1 ext=0' },
  { utc:0, uptime_ms:225000, source:'modbus', detail:'slave=5 fc=0x01 len=8' },
  { utc:0, uptime_ms:220000, source:'ble',    detail:'MAC=55:44:33:22:11:00 name=Sensor rssi=-62' },
];

var MOCK_MODBUS = [
  { slave:1, function:4, len:8, crc_ok:true, visto_ms:600  },
  { slave:2, function:4, len:8, crc_ok:true, visto_ms:950  },
  { slave:3, function:3, len:8, crc_ok:true, visto_ms:1100 },
  { slave:5, function:1, len:8, crc_ok:true, visto_ms:400  },
  { slave:7, function:3, len:8, crc_ok:true, visto_ms:1900 },
  { slave:5, function:6, len:8, crc_ok:true, visto_ms:4800 },
];

var MOCK_CAN = [
  { id:'0x701',       ext:false, dlc:1, datos:'05',                       visto_ms:900  },
  { id:'0x181',       ext:false, dlc:6, datos:'B0 04 11 00 00 00',        visto_ms:90   },
  { id:'0x182',       ext:false, dlc:4, datos:'C4 09 18 17',              visto_ms:180  },
  { id:'0x18F00400',  ext:true,  dlc:8, datos:'FF FF FF C0 2E FF FF FF',  visto_ms:95   },
  { id:'0x18FE0900',  ext:true,  dlc:8, datos:'00 04 00 00 FF FF FF FF',  visto_ms:950  },
  { id:'0x583',       ext:false, dlc:8, datos:'43 00 10 00 95 07 00 00',  visto_ms:4900 },
];

var MOCK_LOGS    = { sd: false, archivos: [] };
var MOCK_ALERTAS = [
  { utc:0, uptime_ms:245000, nivel:'WARNING',  mensaje:'Nuevo dispositivo BLE detectado fuera de whitelist (AA:BB:CC:11:22:33)' },
  { utc:0, uptime_ms:200000, nivel:'WARNING',  mensaje:'Nueva dirección Modbus detectada: esclavo 5 (primer vez en sesión)' },
  { utc:0, uptime_ms:150000, nivel:'WARNING',  mensaje:'ID CAN extendido 0x18F00400 (J1939 EEC1) detectado por primera vez' },
];

/* ── STATE ──────────────────────────────────────────── */

var state = {
  bleDevices:    [],
  bleHistory:    [],
  mbHistory:     [],
  canHistory:    [],
  knownMacs:     {},
  newMacsThisCycle: [],
  events:        [],
  status:        null,
  sdInfo:        null,
  connected:     false,
  isMock:        false,
  lastBleMs:     0,
  totalHeap:     327680,
  mbStats:       { slaveCount: {}, fcCount: {}, total: 0 },
  canStats:      { idCount: {}, stdCount: 0, extCount: 0, total: 0 },
  mbAccum:       {},
  canAccum:      {},
};

/* ── RSSI HELPERS ───────────────────────────────────── */

function rssiInfo(rssi) {
  var pct = Math.max(0, Math.min(100, ((rssi + 100) / 70) * 100));
  if (rssi >= -60) return { pct:pct, cls:'exc',  label:'Excelente', color:'#22c55e' };
  if (rssi >= -70) return { pct:pct, cls:'ok',   label:'Bueno',     color:'#84cc16' };
  if (rssi >= -80) return { pct:pct, cls:'warn', label:'Débil',     color:'#f59e0b' };
  return              { pct:pct, cls:'crit', label:'Crítico',   color:'#ef4444' };
}

/* ── FORMATTING ─────────────────────────────────────── */

function fmtVisto(ms) {
  if (ms < 60000)   return 'hace ' + Math.floor(ms / 1000) + 's';
  if (ms < 3600000) return 'hace ' + Math.floor(ms / 60000) + 'm';
  return 'hace ' + Math.floor(ms / 3600000) + 'h';
}

function fmtUptime(s) {
  var h = Math.floor(s / 3600);
  var m = Math.floor((s % 3600) / 60);
  var ss = s % 60;
  if (h > 0) return h + 'h ' + m + 'm ' + ss + 's';
  if (m > 0) return m + 'm ' + ss + 's';
  return ss + 's';
}

function fmtBytes(b) {
  if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB';
  return (b / 1024).toFixed(0) + ' KB';
}

function fmtHeapKB(b) { return Math.round(b / 1024) + ' KB'; }

function fmtEvTime(ev) {
  if (ev.utc && ev.utc > 0) {
    var d = new Date(ev.utc * 1000);
    return d.toLocaleTimeString('es-BO', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  }
  var s = Math.floor((ev.uptime_ms || 0) / 1000);
  return 'up+' + fmtUptime(s);
}

function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

function escAttr(s) { return escHtml(s); }

/* ── CHART: SPARKLINE ───────────────────────────────── */

function buildSparkPaths(data, w, h, pad) {
  pad = pad || 4;
  if (data.length < 2) return { line: '', area: '' };
  var max = Math.max.apply(null, data.concat([1]));
  var pts = data.map(function(v, i) {
    var x = (i / (data.length - 1)) * w;
    var y = h - pad - (v / max) * (h - pad * 2);
    return [parseFloat(x.toFixed(1)), parseFloat(y.toFixed(1))];
  });
  var cmds = pts.map(function(p, i) { return (i ? 'L' : 'M') + p[0] + ',' + p[1]; }).join('');
  var last = pts[pts.length - 1];
  var area = cmds + 'L' + last[0] + ',' + h + 'L0,' + h + 'Z';
  return { line: cmds, area: area };
}

function updateSparkline() {
  var data = state.bleHistory;
  var paths = buildSparkPaths(data, 300, 52, 4);
  document.getElementById('sp-line').setAttribute('d', paths.line);
  document.getElementById('sp-area').setAttribute('d', paths.area);
  var el = document.getElementById('sp-range');
  if (data.length > 1) el.textContent = '(' + data.length * 5 + 's)';
}

/* ── CHART: MULTI-SERIES ACTIVITY ───────────────────── */

function updateActivityChart() {
  var ble = state.bleHistory;
  var mb  = state.mbHistory;
  var can = state.canHistory;
  var W = 400, H = 72, pad = 5;

  var allVals = ble.concat(mb).concat(can).concat([1]);
  var maxVal = Math.max.apply(null, allVals);

  function makePath(data) {
    if (data.length < 2) return { line: '', area: '' };
    var pts = data.map(function(v, i) {
      var x = (i / (data.length - 1)) * W;
      var y = H - pad - (v / maxVal) * (H - pad * 2);
      return [x.toFixed(1), y.toFixed(1)];
    });
    var cmds = pts.map(function(p, i) { return (i ? 'L' : 'M') + p[0] + ',' + p[1]; }).join('');
    var last = pts[pts.length - 1];
    return {
      line: cmds,
      area: cmds + 'L' + last[0] + ',' + H + 'L0,' + H + 'Z'
    };
  }

  var pBle = makePath(ble), pMb = makePath(mb), pCan = makePath(can);
  document.getElementById('act-ble').setAttribute('d', pBle.line);
  document.getElementById('act-ble-area').setAttribute('d', pBle.area);
  document.getElementById('act-mb').setAttribute('d', pMb.line);
  document.getElementById('act-mb-area').setAttribute('d', pMb.area);
  document.getElementById('act-can').setAttribute('d', pCan.line);
  document.getElementById('act-can-area').setAttribute('d', pCan.area);
}

/* ── CHART: DONUT ───────────────────────────────────── */

function renderDonut(svgId, legendId, segments) {
  var svgEl    = document.getElementById(svgId);
  var legendEl = legendId ? document.getElementById(legendId) : null;
  if (!svgEl) return;

  var total = segments.reduce(function(s, x) { return s + x.count; }, 0);
  var r = 40, circ = 2 * Math.PI * r;
  var offset = circ / 4;
  var html = '<circle cx="60" cy="60" r="40" fill="none" stroke="#e2dac9" stroke-width="16"/>';

  if (total > 0) {
    segments.forEach(function(seg) {
      if (!seg.count) return;
      var dash = (seg.count / total) * circ;
      html += '<circle cx="60" cy="60" r="40" fill="none" stroke="' + seg.color + '" stroke-width="16" ' +
        'stroke-dasharray="' + dash.toFixed(2) + ' ' + (circ - dash).toFixed(2) + '" ' +
        'stroke-dashoffset="' + offset.toFixed(2) + '"/>';
      offset -= dash;
    });
  }

  var label = total > 0 ? String(total) : '--';
  html += '<text x="60" y="57" text-anchor="middle" fill="#2c2a23" font-size="20" font-weight="700" font-family="system-ui">' + label + '</text>';
  html += '<text x="60" y="70" text-anchor="middle" fill="#8c8472" font-size="8.5" font-family="system-ui">total</text>';
  svgEl.innerHTML = html;

  if (legendEl) {
    legendEl.innerHTML = segments.map(function(s) {
      return '<div class="leg-row">' +
        '<span class="leg-dot" style="background:' + s.color + '"></span>' +
        '<span class="leg-lbl">' + s.label + '</span>' +
        '<span class="leg-n">' + s.count + '</span>' +
      '</div>';
    }).join('');
  }
}

/* ── CHART: HORIZONTAL BARS ─────────────────────────── */

function renderBars(elId, items) {
  var el = document.getElementById(elId);
  if (!el) return;
  if (!items || !items.length) {
    el.innerHTML = '<div class="rssi-empty">Sin datos</div>';
    return;
  }
  var maxVal = Math.max.apply(null, items.map(function(i){ return i.value; }).concat([1]));
  el.innerHTML = items.map(function(item) {
    var pct = (item.value / maxVal * 100).toFixed(1);
    return '<div class="hbar-row">' +
      '<div class="hbar-lbl">' + escHtml(String(item.label)) + '</div>' +
      '<div class="hbar-track"><div class="hbar-fill" style="width:' + pct + '%;background:' + (item.color || 'var(--accent)') + '"></div></div>' +
      '<div class="hbar-val">' + item.value + '</div>' +
    '</div>';
  }).join('');
}

/* ── RSSI DISTRIBUTION ──────────────────────────────── */

function updateRssiDonuts() {
  var devs = state.bleDevices;
  var bins = [
    { label:'Excelente', color:'#22c55e', count:0 },
    { label:'Bueno',     color:'#84cc16', count:0 },
    { label:'Débil',     color:'#f59e0b', count:0 },
    { label:'Crítico',   color:'#ef4444', count:0 },
  ];
  devs.forEach(function(d) {
    var q = rssiInfo(d.rssi);
    var map = { exc:0, ok:1, warn:2, crit:3 };
    bins[map[q.cls]].count++;
  });
  renderDonut('rssi-donut',     'donut-legend',      bins);
  renderDonut('ble-rssi-donut', 'ble-donut-legend',  bins);
}

/* ── EVENT FEED ──────────────────────────────────────── */

function evSourceClass(src) {
  if (src === 'ble')    return 'ble';
  if (src === 'modbus') return 'modbus';
  if (src === 'can')    return 'can';
  return 'other';
}

function buildEvItem(ev) {
  var sc = evSourceClass(ev.source);
  var li = document.createElement('li');
  li.className = 'ev-item ev-item--' + sc;
  li.innerHTML =
    '<span class="ev-time">' + fmtEvTime(ev) + '</span>' +
    '<span class="ev-src ev-src--' + sc + '">' + (ev.source || '?').toUpperCase() + '</span>' +
    '<span class="ev-detail">' + escHtml(ev.detail) + '</span>';
  return li;
}

function updateEventFeeds() {
  var evs = state.events;

  var mini = document.getElementById('mini-feed');
  mini.innerHTML = '';
  var shown = evs.slice(0, 6);
  if (shown.length === 0) {
    var li = document.createElement('li');
    li.className = 'ev-empty'; li.textContent = 'Sin eventos registrados';
    mini.appendChild(li);
  } else {
    shown.forEach(function(ev) { mini.appendChild(buildEvItem(ev)); });
  }

  var full = document.getElementById('ev-feed');
  full.innerHTML = '';
  document.getElementById('ev-chip').textContent = evs.length;
  setNavChip('nav-ev-chip', evs.length);
  if (evs.length === 0) {
    var li2 = document.createElement('li');
    li2.className = 'ev-empty'; li2.textContent = 'Sin eventos registrados';
    full.appendChild(li2);
  } else {
    evs.forEach(function(ev) { full.appendChild(buildEvItem(ev)); });
  }

  // source breakdown strip
  var counts = { ble:0, modbus:0, can:0 };
  evs.forEach(function(ev) { if (counts[ev.source] !== undefined) counts[ev.source]++; });
  var srcRow = document.getElementById('ev-src-row');
  if (srcRow) {
    var defs = [
      { key:'ble',    label:'BLE',    color:'#2dd4bf' },
      { key:'modbus', label:'Modbus', color:'#f59e0b' },
      { key:'can',    label:'CAN',    color:'#4a9eff' },
    ];
    srcRow.innerHTML = defs.map(function(d) {
      return '<div class="ev-src-stat">' +
        '<span class="ev-src-stat-dot" style="background:' + d.color + '"></span>' +
        '<span class="ev-src-stat-n" style="color:' + d.color + '">' + counts[d.key] + '</span>' +
        '<span class="ev-src-stat-lbl">' + d.label + '</span>' +
      '</div>';
    }).join('') + '<div class="ev-src-stat" style="margin-left:auto">' +
      '<span class="ev-src-stat-n">' + evs.length + '</span>' +
      '<span class="ev-src-stat-lbl">total</span>' +
    '</div>';
  }
}

/* ── BLE DEVICE LIST ─────────────────────────────────── */

function buildDevCard(d) {
  var q = rssiInfo(d.rssi);
  var isNew = state.newMacsThisCycle.indexOf(d.mac) >= 0;
  var visto = d.visto_ms !== undefined ? fmtVisto(d.visto_ms) : '--';
  return '<div class="dev-card">' +
    '<div class="dev-signal">' +
      '<div class="sig-track"><div class="sig-fill sig-fill--' + q.cls + '" style="width:' + q.pct.toFixed(0) + '%"></div></div>' +
      '<div class="sig-meta">' +
        '<span class="sig-dbm sig-dbm--' + q.cls + '">' + d.rssi + ' dBm</span>' +
        '<span class="sig-qlabel">' + q.label + '</span>' +
      '</div>' +
    '</div>' +
    '<div class="dev-info">' +
      '<span class="dev-mac">' + escHtml(d.mac) + '</span>' +
      '<span class="dev-name">' + (d.nombre ? escHtml(d.nombre) : '<em style="opacity:.5">sin nombre</em>') + '</span>' +
    '</div>' +
    '<div class="dev-meta">' +
      '<span class="dev-seen">' + visto + '</span>' +
      (isNew ? '<span class="badge-new">NUEVO</span>' : '') +
    '</div>' +
  '</div>';
}

function updateBleSection() {
  var devs = state.bleDevices.slice().sort(function(a, b) { return b.rssi - a.rssi; });
  document.getElementById('ble-chip').textContent = devs.length;
  setNavChip('nav-ble-chip', devs.length);
  var container = document.getElementById('dev-list');
  if (devs.length === 0) {
    container.innerHTML = '<div class="empty-state">Sin dispositivos BLE detectados en los últimos 2 min</div>';
  } else {
    container.innerHTML = devs.map(buildDevCard).join('');
  }
  var ts = document.getElementById('ble-ts');
  if (state.lastBleMs) ts.textContent = 'actualizado ' + fmtVisto(Date.now() - state.lastBleMs);
}

/* ── KPI UPDATE ──────────────────────────────────────── */

function updateKpis() {
  var devs  = state.bleDevices;
  var total = Object.keys(state.knownMacs).length;

  document.getElementById('k-ble-activos').textContent = devs.length;
  document.getElementById('k-ble-total').textContent   = total;
  document.getElementById('k-eventos').textContent     = state.events.length;
  document.getElementById('k-mb-frames').textContent   = state.mbStats.total || '--';
  document.getElementById('k-can-frames').textContent  = state.canStats.total || '--';

  // header pills
  setText('pill-ble-n', devs.length);
  setText('pill-mb-n',  state.mbStats.total || 0);
  setText('pill-can-n', state.canStats.total || 0);

  if (state.status) {
    var h   = state.status.free_heap;
    var pct = Math.min(100, (h / state.totalHeap) * 100);
    document.getElementById('k-heap').textContent = fmtHeapKB(h);
    setBarPct('k-heap-bar', pct);
  }
}

function setText(id, val) {
  var el = document.getElementById(id);
  if (el) el.textContent = val;
}

function setBarPct(id, pct) {
  var el = document.getElementById(id);
  if (!el) return;
  el.style.width = pct.toFixed(0) + '%';
  el.style.background = pct > 50 ? 'var(--ok)' : pct > 25 ? 'var(--warn)' : 'var(--crit)';
}

/* ── SISTEMA UPDATE ──────────────────────────────────── */

function updateSistema() {
  var s = state.status;
  if (!s) return;
  setText('s-device',  s.device  || '--');
  setText('s-version', s.version || '--');
  setText('s-build',   s.build   || '--');
  setText('s-ip',      s.ip      || '--');
  setText('s-uptime',  fmtUptime(s.uptime_s || 0));
  setText('header-ip', s.ip      || '--');
  setText('footer-up', 'uptime: ' + fmtUptime(s.uptime_s || 0));

  var h   = s.free_heap || 0;
  var pct = Math.min(100, (h / state.totalHeap) * 100);
  setText('s-heap',    fmtBytes(h));
  setText('s-heap-pct', '(' + pct.toFixed(0) + '% libre)');
  setBarPct('s-heap-bar', pct);

  // live metrics strip
  var heapUsed = state.totalHeap - h;
  var heapUsedPct = Math.min(100, (heapUsed / state.totalHeap) * 100);
  var gFill = document.getElementById('sysm-heap-fill');
  if (gFill) {
    gFill.style.width = heapUsedPct.toFixed(0) + '%';
    gFill.style.background = heapUsedPct < 60 ? 'linear-gradient(90deg,var(--ok),var(--teal))' : 'linear-gradient(90deg,var(--warn),var(--crit))';
  }
  setText('sysm-heap-used', fmtBytes(heapUsed) + ' usados');
  setText('sysm-evcount',   state.events.length);
  setText('sysm-blecount',  Object.keys(state.knownMacs).length);

  scheduleBuildTopology();

  // bus status tiles
  var mbN  = s.modbus || 0;
  var canN = s.can    || 0;
  var bleN = s.ble    || 0;
  setText('sb-ble', bleN + ' dispositivos');
  setText('sb-mb',  mbN  + ' tramas');
  setText('sb-can', canN + ' tramas');
  setText('sb-sd',  s.sd ? 'presente' : 'no presente');
}

/* ── LOGS UPDATE ─────────────────────────────────────── */

function updateLogs(data) {
  state.sdInfo = data;
  var tabla = document.getElementById('t-logs');

  // Disk card (always visible)
  var SD_TOTAL_KB = 32768; // 32 MB typical SD
  var archivos = data.archivos || [];
  var usedBytes = archivos.reduce(function(s, f) { return s + (f.bytes || 0); }, 0);
  var usedKB = usedBytes / 1024;
  var pct = Math.min(100, (usedKB / SD_TOTAL_KB) * 100);

  var badge = document.getElementById('disk-status-badge');
  if (badge) {
    badge.textContent = data.sd ? 'Presente' : 'No detectada';
    badge.className   = 'disk-status ' + (data.sd ? 'disk-status--ok' : 'disk-status--warn');
  }
  var fill = document.getElementById('disk-bar-fill');
  if (fill) fill.style.width = (data.sd ? Math.max(pct, 0.5) : 0) + '%';
  setText('disk-used',  data.sd ? (usedKB.toFixed(1) + ' KB usados de ' + (SD_TOTAL_KB/1024) + ' MB') : 'Sin acceso');
  setText('disk-files', data.sd ? (archivos.length + ' archivo' + (archivos.length !== 1 ? 's' : '')) : '--');

  if (!data.sd) { tabla.classList.add('oculto'); return; }

  tabla.classList.remove('oculto');
  var tbody = tabla.querySelector('tbody');
  tbody.innerHTML = '';
  archivos.forEach(function(f) {
    var tr = document.createElement('tr');
    tr.innerHTML = '<td>' + escHtml(f.nombre) + '</td>' +
                   '<td>' + (f.bytes / 1024).toFixed(1) + ' KB</td>' +
                   '<td><a href="/api/logs/download?file=' + encodeURIComponent(f.nombre) + '">descargar</a></td>';
    tbody.appendChild(tr);
  });
}

/* ── MODBUS ──────────────────────────────────────────── */

function fmtFuncion(fc) {
  var hex = '0x' + ('0' + fc.toString(16).toUpperCase()).slice(-2);
  var n = { 1:'Read Coils', 2:'Read Inputs', 3:'Read Holding',
            4:'Read Input Reg', 5:'Write Coil', 6:'Write Single Reg',
            15:'Write Coils', 16:'Write Regs' };
  return n[fc] ? (hex + ' ' + n[fc]) : hex;
}

function setNavChip(id, n) {
  var el = document.getElementById(id);
  if (!el) return;
  el.textContent = n;
  el.classList.toggle('visible', n > 0);
}

function updateModbus(rows) {
  document.getElementById('mb-chip').textContent = rows.length;
  setNavChip('nav-mb-chip', rows.length);

  // Compute stats
  var slaveCount = {};
  var fcCount    = {};
  rows.forEach(function(d) {
    var sk = 'Esclavo ' + d.slave;
    slaveCount[sk] = (slaveCount[sk] || 0) + 1;
    var fk = fmtFuncion(d.function);
    fcCount[fk] = (fcCount[fk] || 0) + 1;
  });

  // Merge into accumulators for persistent history
  Object.keys(slaveCount).forEach(function(k) {
    state.mbAccum[k] = (state.mbAccum[k] || 0) + slaveCount[k];
  });
  Object.keys(fcCount).forEach(function(k) {
    state.canAccum; // intentional noop — fcCount is not accumulated globally
  });

  state.mbStats = { slaveCount: slaveCount, fcCount: fcCount, total: rows.length };

  // Push history point
  state.mbHistory.push(rows.length);
  if (state.mbHistory.length > 30) state.mbHistory.shift();

  // Render charts
  var slaveItems = Object.keys(state.mbAccum).map(function(k) {
    return { label: k, value: state.mbAccum[k], color: 'var(--warn)' };
  }).sort(function(a,b){ return b.value - a.value; }).slice(0, 6);

  var fcItems = Object.keys(fcCount).map(function(k) {
    return { label: k, value: fcCount[k], color: 'rgba(245,158,11,.7)' };
  }).sort(function(a,b){ return b.value - a.value; });

  renderBars('mb-slave-bars', slaveItems);
  renderBars('mb-fc-bars',    fcItems);
  renderBars('ov-mb-bars',    slaveItems.slice(0, 5));

  // Rate badge
  var badge = document.getElementById('mb-rate');
  if (badge) badge.textContent = rows.length + ' tramas en buffer';

  // Table
  var idle  = document.getElementById('mb-idle');
  var tabla = document.getElementById('t-modbus');
  if (rows.length === 0) {
    idle.classList.remove('oculto'); tabla.classList.add('oculto'); return;
  }
  idle.classList.add('oculto'); tabla.classList.remove('oculto');
  var tbody = tabla.querySelector('tbody');
  tbody.innerHTML = '';
  rows.forEach(function(d) {
    var crc = d.crc_ok ? '<span class="badge-ok">OK</span>' : '<span class="badge-err">ERR</span>';
    var tr = document.createElement('tr');
    tr.innerHTML = '<td>' + fmtVisto(d.visto_ms) + '</td><td>' + d.slave +
                   '</td><td>' + fmtFuncion(d.function) + '</td><td>' + d.len +
                   '</td><td>' + crc + '</td>';
    tbody.appendChild(tr);
  });

  updateKpis();
  updateActivityChart();
  scheduleBuildTopology();
}

/* ── CAN ─────────────────────────────────────────────── */

function updateCan(rows) {
  document.getElementById('can-chip').textContent = rows.length;
  setNavChip('nav-can-chip', rows.length);

  var idCount  = {};
  var stdCount = 0, extCount = 0;
  rows.forEach(function(d) {
    idCount[d.id] = (idCount[d.id] || 0) + 1;
    if (d.ext) extCount++; else stdCount++;
  });

  // Accumulate for persistent history
  Object.keys(idCount).forEach(function(k) {
    state.canAccum[k] = (state.canAccum[k] || 0) + idCount[k];
  });

  state.canStats = { idCount: idCount, stdCount: stdCount, extCount: extCount, total: rows.length };

  state.canHistory.push(rows.length);
  if (state.canHistory.length > 30) state.canHistory.shift();

  // ID bars (from accumulator, sorted by activity)
  var idItems = Object.keys(state.canAccum).map(function(k) {
    return { label: k, value: state.canAccum[k], color: 'var(--accent)' };
  }).sort(function(a,b){ return b.value - a.value; }).slice(0, 6);

  renderBars('can-id-bars', idItems);
  renderBars('ov-can-bars', idItems.slice(0, 5));

  // Protocol donut
  var protoSegs = [
    { label:'Estándar (11b)', color:'#4a9eff', count: stdCount },
    { label:'Extendido (29b)', color:'#a855f7', count: extCount },
  ];
  renderDonut('can-proto-donut', 'can-proto-legend', protoSegs);

  // Rate badge
  var badge = document.getElementById('can-rate');
  if (badge) badge.textContent = rows.length + ' tramas en buffer';

  // Table
  var idle  = document.getElementById('can-idle');
  var tabla = document.getElementById('t-can');
  if (rows.length === 0) {
    idle.classList.remove('oculto'); tabla.classList.add('oculto'); return;
  }
  idle.classList.add('oculto'); tabla.classList.remove('oculto');
  var tbody = tabla.querySelector('tbody');
  tbody.innerHTML = '';
  rows.forEach(function(d) {
    var ext = d.ext ? ' <span class="badge-ext">ext</span>' : '';
    var tr = document.createElement('tr');
    tr.innerHTML = '<td>' + fmtVisto(d.visto_ms) + '</td><td>' + escHtml(d.id) + ext +
                   '</td><td>' + d.dlc + '</td><td>' + escHtml(d.datos || '') + '</td>';
    tbody.appendChild(tr);
  });

  updateKpis();
  updateActivityChart();
  scheduleBuildTopology();
}

/* ── ALERTAS ─────────────────────────────────────────── */

function updateAlertas(rows) {
  document.getElementById('al-chip').textContent = rows.length;
  setNavChip('nav-al-chip', rows.length);

  var nWarn = 0, nCrit = 0;
  rows.forEach(function(a) {
    if (a.nivel === 'CRITICAL') nCrit++; else nWarn++;
  });
  setText('al-n-warn', nWarn);
  setText('al-n-crit', nCrit);
  var okCard = document.getElementById('al-n-ok');
  if (okCard) {
    okCard.parentElement.style.display = rows.length === 0 ? '' : 'none';
  }

  var feed = document.getElementById('al-feed');
  feed.innerHTML = '';
  if (rows.length === 0) {
    var vacio = document.createElement('li');
    vacio.className = 'ev-empty';
    vacio.textContent = 'Sin alertas — ninguna entidad anómala detectada';
    feed.appendChild(vacio); return;
  }
  rows.forEach(function(a) {
    var li = document.createElement('li');
    var cls = (a.nivel === 'CRITICAL') ? 'crit' : 'warn';
    li.className = 'ev-item ev-item--' + cls;
    li.innerHTML =
      '<span class="ev-time">' + fmtEvTime(a) + '</span>' +
      '<span class="ev-src ev-src--' + cls + '">' + escHtml(a.nivel) + '</span>' +
      '<span class="ev-detail">' + escHtml(a.mensaje) + '</span>';
    feed.appendChild(li);
  });
}

/* ── API FETCHERS ────────────────────────────────────── */

function setConn(ok) {
  state.connected = ok;
  var dot  = document.getElementById('conn-dot');
  var text = document.getElementById('conn-text');
  dot.className    = 'conn-dot ' + (ok ? 'ok' : 'err');
  text.textContent = ok ? 'conectado' : 'sin conexión';
}

function fetchStatus() {
  fetch('/api/status')
    .then(function(r){ return r.json(); })
    .then(function(data) {
      state.status = data; state.isMock = false;
      setConn(true);
      updateSistema(); updateKpis();
      document.getElementById('modo-local').classList.add('oculto');
    })
    .catch(function() {
      if (!state.status) {
        state.status = MOCK_STATUS; state.isMock = true;
        document.getElementById('modo-local').classList.remove('oculto');
        document.getElementById('conn-dot').className = 'conn-dot pulse';
        document.getElementById('conn-text').textContent = 'modo local';
        updateSistema(); updateKpis();
      }
    });
}

function fetchBle() {
  fetch('/api/ble/devices')
    .then(function(r){ return r.json(); })
    .then(function(data){ applyBleData(data); })
    .catch(function(){ if (state.isMock) applyBleData(MOCK_BLE); });
}

function applyBleData(devs) {
  state.newMacsThisCycle = [];
  var now = Date.now();
  devs.forEach(function(d) {
    if (!state.knownMacs[d.mac]) {
      state.knownMacs[d.mac] = now;
      state.newMacsThisCycle.push(d.mac);
    }
  });
  state.bleDevices = devs;
  state.lastBleMs  = now;
  state.bleHistory.push(devs.length);
  if (state.bleHistory.length > 30) state.bleHistory.shift();

  updateBleSection();
  updateKpis();
  updateSparkline();
  updateRssiDonuts();
  updateActivityChart();
  scheduleBuildTopology();
}

function fetchEvents() {
  fetch('/api/events')
    .then(function(r){ return r.json(); })
    .then(function(data){ state.events = data; updateEventFeeds(); })
    .catch(function(){
      if (state.isMock && state.events.length === 0) {
        state.events = MOCK_EVENTS; updateEventFeeds();
      }
    });
}

function fetchLogs() {
  fetch('/api/logs')
    .then(function(r){ return r.json(); })
    .then(function(data){ updateLogs(data); })
    .catch(function(){ if (state.isMock) updateLogs(MOCK_LOGS); });
}

function fetchModbus() {
  fetch('/api/modbus')
    .then(function(r){ return r.json(); })
    .then(function(data){ updateModbus(data); })
    .catch(function(){ if (state.isMock) updateModbus(MOCK_MODBUS); });
}

function fetchCan() {
  fetch('/api/can')
    .then(function(r){ return r.json(); })
    .then(function(data){ updateCan(data); })
    .catch(function(){ if (state.isMock) updateCan(MOCK_CAN); });
}

function fetchAlertas() {
  fetch('/api/alerts')
    .then(function(r){ return r.json(); })
    .then(function(data){ updateAlertas(data); })
    .catch(function(){ if (state.isMock) updateAlertas(MOCK_ALERTAS); });
}

/* ── TOPOLOGY MAP ────────────────────────────────────── */

var _topoTimer = null;
var _ttNodeG   = null;
function scheduleBuildTopology() {
  clearTimeout(_topoTimer);
  _topoTimer = setTimeout(buildTopology, 120);
}

function buildTopology() {
  var svg = document.getElementById('topo-svg');
  if (!svg) return;

  svg.setAttribute('viewBox', '0 0 1100 520');

  var CX = 550, CY = 260;

  // Module positions — star layout
  var bP = {x:195, y:118};
  var mP = {x:180, y:405};
  var cP = {x:905, y:168};
  var sP = {x:820, y:415};

  // ── LINES ─────────────────────────────────────────────

  // Green glowing dotted line with moving dot (center → module)
  function gline(x1,y1,x2,y2,dur) {
    var p = 'M'+x1+','+y1+' L'+x2+','+y2;
    return '<line x1="'+x1+'" y1="'+y1+'" x2="'+x2+'" y2="'+y2+
      '" stroke="#1f9a52" stroke-width="14" stroke-opacity="0.1" stroke-dasharray="9 11" filter="url(#gg)" pointer-events="none"/>'+
      '<line x1="'+x1+'" y1="'+y1+'" x2="'+x2+'" y2="'+y2+
      '" stroke="#149043" stroke-width="2" stroke-opacity="0.85" stroke-dasharray="7 9" pointer-events="none">'+
      '<animate attributeName="stroke-dashoffset" from="16" to="0" dur="'+dur+'s" repeatCount="indefinite"/></line>'+
      '<circle r="3.5" fill="#149043" opacity="0.9" pointer-events="none">'+
        '<animateMotion dur="'+(dur*2.5)+'s" repeatCount="indefinite" path="'+p+'"/>'+
      '</circle>';
  }

  // Thin sub-line (module → device)
  function sline(x1,y1,x2,y2,col,dur) {
    return '<line x1="'+x1+'" y1="'+y1+'" x2="'+x2+'" y2="'+y2+
      '" stroke="'+col+'" stroke-width="8" stroke-opacity="0.07" stroke-dasharray="5 9" filter="url(#gg)" pointer-events="none"/>'+
      '<line x1="'+x1+'" y1="'+y1+'" x2="'+x2+'" y2="'+y2+
      '" stroke="'+col+'" stroke-width="1" stroke-opacity="0.4" stroke-dasharray="4 7" pointer-events="none">'+
      '<animate attributeName="stroke-dashoffset" from="11" to="0" dur="'+dur+'s" repeatCount="indefinite"/></line>';
  }

  // ── NODES ─────────────────────────────────────────────

  // Equipment module (translates to absolute position)
  function equipNode(x,y,col,sec,ntype,iconFn,lbl,sub) {
    var sa  = sec   ? ' data-sec="'+escAttr(sec)+'"'     : '';
    var nta = ntype ? ' data-ntype="'+escAttr(ntype)+'"' : '';
    return '<g class="topo-node"'+sa+nta+' transform="translate('+x+','+y+')">'+
      '<circle r="66" fill="'+col+'" fill-opacity="0.10"/>'+
      '<circle r="66" fill="none" stroke="'+col+'" stroke-width="0.6" stroke-dasharray="3 10" stroke-opacity="0.32"/>'+
      '<g filter="url(#mg)"><g transform="scale(1.28)">'+iconFn(col)+'</g></g>'+
      '<text y="56" text-anchor="middle" fill="'+col+'" font-size="10.5" font-weight="700" font-family="system-ui" letter-spacing="0.5">'+lbl+'</text>'+
      '<text y="69" text-anchor="middle" fill="#8c8472" font-size="7.5" font-family="Consolas,monospace">'+sub+'</text>'+
      '</g>';
  }

  // Device sub-node (small labeled box)
  function devNode(x,y,lbl,sub,col,sec,ntype,nkey) {
    var sa  = sec   ? ' data-sec="'+escAttr(sec)+'"'     : '';
    var nta = ntype ? ' data-ntype="'+escAttr(ntype)+'"' : '';
    var nka = nkey  ? ' data-nkey="'+escAttr(nkey)+'"'   : '';
    return '<g class="topo-node"'+sa+nta+nka+' transform="translate('+x+','+y+')">'+
      '<rect x="-38" y="-17" width="76" height="34" rx="5" fill="rgba(255,255,255,0.95)" stroke="'+col+'" stroke-width="1" stroke-opacity="0.45"/>'+
      '<circle cx="-27" cy="0" r="2.5" fill="'+col+'" opacity="0.75">'+
        '<animate attributeName="opacity" values="0.9;0.25;0.9" dur="2.2s" repeatCount="indefinite"/>'+
      '</circle>'+
      '<text x="2" y="-4" text-anchor="middle" fill="'+col+'" font-size="7.5" font-weight="600" font-family="Consolas,monospace">'+escHtml(lbl)+'</text>'+
      '<text x="2" y="7" text-anchor="middle" fill="#8c8472" font-size="6.5" font-family="Consolas,monospace">'+escHtml(sub)+'</text>'+
      '</g>';
  }

  // ── ICON PICTOGRAMS (rendered at local 0,0) ───────────

  function iconBLE(col) {
    return '<rect x="-18" y="-14" width="36" height="26" rx="4" fill="rgba(255,255,255,0.93)" stroke="'+col+'" stroke-width="1.4"/>'+
      '<line x1="0" y1="-14" x2="0" y2="-29" stroke="'+col+'" stroke-width="1.5"/>'+
      '<circle cx="0" cy="-32" r="2.5" fill="'+col+'"/>'+
      '<path d="M-8,-23 Q0,-33 8,-23" fill="none" stroke="'+col+'" stroke-width="1.2" stroke-opacity="0.9"/>'+
      '<path d="M-14,-19 Q0,-38 14,-19" fill="none" stroke="'+col+'" stroke-width="1" stroke-opacity="0.55"/>'+
      '<path d="M-20,-15 Q0,-43 20,-15" fill="none" stroke="'+col+'" stroke-width="0.7" stroke-opacity="0.3"/>'+
      '<circle cx="-7" cy="-4" r="1.8" fill="'+col+'" opacity="0.7"/>'+
      '<circle cx="0"  cy="-4" r="1.8" fill="'+col+'" opacity="0.7"/>'+
      '<circle cx="7"  cy="-4" r="1.8" fill="'+col+'" opacity="0.7"/>'+
      '<text x="0" y="8" text-anchor="middle" fill="'+col+'" font-size="5.5" font-family="Consolas">NimBLE</text>';
  }

  function iconMB(col) {
    return '<rect x="-20" y="-18" width="40" height="34" rx="3" fill="rgba(255,255,255,0.93)" stroke="'+col+'" stroke-width="1.4"/>'+
      '<rect x="-16" y="-14" width="32" height="10" rx="2" fill="rgba(120,108,86,0.10)" stroke="'+col+'" stroke-width="0.5" stroke-opacity="0.35"/>'+
      '<circle cx="-11" cy="-9" r="1.5" fill="'+col+'" opacity="0.7"/>'+
      '<circle cx="-6"  cy="-9" r="1.5" fill="'+col+'" opacity="0.7"/>'+
      '<circle cx="-1"  cy="-9" r="1.5" fill="'+col+'" opacity="0.7"/>'+
      '<circle cx="4"   cy="-9" r="1.5" fill="'+col+'" opacity="0.7"/>'+
      '<circle cx="9"   cy="-9" r="1.5" fill="'+col+'" opacity="0.7"/>'+
      '<rect x="-12" y="0" width="24" height="8" rx="1.5" fill="rgba(120,108,86,0.10)" stroke="'+col+'" stroke-width="0.5" stroke-opacity="0.35"/>'+
      '<circle cx="12" cy="10" r="3" fill="'+col+'">'+
        '<animate attributeName="opacity" values="0.9;0.25;0.9" dur="0.9s" repeatCount="indefinite"/>'+
      '</circle>'+
      '<text x="-3" y="16" text-anchor="middle" fill="'+col+'" font-size="5.5" font-family="Consolas">RS-485</text>';
  }

  function iconCAN(col) {
    return '<rect x="-20" y="-16" width="40" height="32" rx="4" fill="rgba(255,255,255,0.93)" stroke="'+col+'" stroke-width="1.4"/>'+
      '<rect x="-14" y="-11" width="28" height="12" rx="2" fill="rgba(120,108,86,0.10)" stroke="'+col+'" stroke-width="0.5" stroke-opacity="0.35"/>'+
      '<circle cx="-9" cy="-5" r="1.8" fill="'+col+'" opacity="0.8"/>'+
      '<circle cx="-3" cy="-5" r="1.8" fill="'+col+'" opacity="0.8"/>'+
      '<circle cx="3"  cy="-5" r="1.8" fill="'+col+'" opacity="0.8"/>'+
      '<circle cx="9"  cy="-5" r="1.8" fill="'+col+'" opacity="0.8"/>'+
      '<circle cx="-9" cy="7" r="2.5" fill="'+col+'">'+
        '<animate attributeName="opacity" values="1;0.3;1" dur="0.65s" repeatCount="indefinite"/>'+
      '</circle>'+
      '<circle cx="-1" cy="7" r="2.5" fill="#22c55e">'+
        '<animate attributeName="opacity" values="1;0.3;1" dur="0.85s" begin="0.3s" repeatCount="indefinite"/>'+
      '</circle>'+
      '<text x="5" y="12" text-anchor="middle" fill="'+col+'" font-size="5.5" font-family="Consolas">TWAI</text>';
  }

  function iconSD(col) {
    return '<path d="M-14,-20 L-14,17 L14,17 L14,-13 L7,-20 Z" fill="rgba(255,255,255,0.93)" stroke="'+col+'" stroke-width="1.4"/>'+
      '<line x1="-8" y1="17" x2="-8" y2="8" stroke="'+col+'" stroke-width="1.5"/>'+
      '<line x1="-4" y1="17" x2="-4" y2="8" stroke="'+col+'" stroke-width="1.5"/>'+
      '<line x1="0"  y1="17" x2="0"  y2="8" stroke="'+col+'" stroke-width="1.5"/>'+
      '<line x1="4"  y1="17" x2="4"  y2="8" stroke="'+col+'" stroke-width="1.5"/>'+
      '<line x1="8"  y1="17" x2="8"  y2="8" stroke="'+col+'" stroke-width="1.5"/>'+
      '<circle cx="0" cy="-3" r="5" fill="'+col+'" fill-opacity="0.12" stroke="'+col+'" stroke-width="0.7"/>'+
      '<circle cx="0" cy="-3" r="2.5" fill="'+col+'">'+
        '<animate attributeName="opacity" values="0.9;0.3;0.9" dur="2.5s" repeatCount="indefinite"/>'+
      '</circle>';
  }

  // ── DEVICE SUB-NODES FROM STATE ───────────────────────

  var bAbsPos = [{x:58,y:52},{x:55,y:165},{x:58,y:272}];
  var bleNodes = state.bleDevices.slice(0,3).map(function(d,i){
    return {x:bAbsPos[i].x, y:bAbsPos[i].y, lbl:d.mac.slice(-8), sub:d.rssi+' dBm', ntype:'dev-ble', nkey:d.mac};
  });

  var mAbsPos = [{x:45,y:305},{x:42,y:378},{x:45,y:455},{x:170,y:490},{x:295,y:483}];
  var mbNodes = Object.keys(state.mbAccum).slice(0,5).map(function(k,i){
    return {x:mAbsPos[i].x, y:mAbsPos[i].y, lbl:k, sub:state.mbAccum[k]+' tr', ntype:'dev-mb', nkey:k};
  });

  var cAbsPos = [{x:1012,y:72},{x:1032,y:170},{x:1022,y:270},{x:992,y:360}];
  var canNodes = Object.keys(state.canAccum).slice(0,4).map(function(k,i){
    return {x:cAbsPos[i].x, y:cAbsPos[i].y, lbl:k.length>9?k.slice(0,9):k, sub:state.canAccum[k]+' tr', ntype:'dev-can', nkey:k};
  });

  var sdOk  = state.sdInfo && state.sdInfo.sd;
  var sdCol = sdOk ? '#22c55e' : '#8c8472';
  var ip    = (state.status && state.status.ip) ? state.status.ip : '--';

  // ── BUILD SVG ─────────────────────────────────────────

  var buf = '<defs>'+
    '<pattern id="fg" width="55" height="55" patternUnits="userSpaceOnUse">'+
      '<path d="M55 0L0 0 0 55" fill="none" stroke="rgba(150,138,116,0.22)" stroke-width="0.6"/>'+
    '</pattern>'+
    // Glow filter (for connection lines + icon halos)
    '<filter id="gg" x="-60%" y="-60%" width="220%" height="220%">'+
      '<feGaussianBlur stdDeviation="5" result="b"/>'+
      '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>'+
    '</filter>'+
    // Module glow filter
    '<filter id="mg" x="-55%" y="-55%" width="210%" height="210%">'+
      '<feGaussianBlur stdDeviation="4" result="b"/>'+
      '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>'+
    '</filter>'+
    // Fondo claro con leve degradado radial (mas luminoso al centro)
    '<radialGradient id="topbg" cx="50%" cy="44%" r="72%">'+
      '<stop offset="0%" stop-color="#fdfbf6"/>'+
      '<stop offset="100%" stop-color="#ece5d6"/>'+
    '</radialGradient>'+
    '</defs>'+
    // Background
    '<rect width="1100" height="520" fill="url(#topbg)"/>'+
    '<rect width="1100" height="520" fill="url(#fg)"/>'+
    // Zonas (areas tipo planta): tenue lavado de color + borde punteado
    '<ellipse cx="195" cy="118" rx="90" ry="72" fill="rgba(13,139,125,0.06)" stroke="rgba(13,139,125,0.40)" stroke-width="1.2" stroke-dasharray="3 9" pointer-events="none"/>'+
    '<ellipse cx="180" cy="405" rx="90" ry="72" fill="rgba(193,118,12,0.06)" stroke="rgba(193,118,12,0.40)" stroke-width="1.2" stroke-dasharray="3 9" pointer-events="none"/>'+
    '<ellipse cx="905" cy="168" rx="90" ry="70" fill="rgba(47,111,176,0.06)" stroke="rgba(47,111,176,0.40)" stroke-width="1.2" stroke-dasharray="3 9" pointer-events="none"/>'+
    '<ellipse cx="820" cy="415" rx="78" ry="60" fill="rgba(28,154,75,0.06)" stroke="rgba(28,154,75,0.38)" stroke-width="1.2" stroke-dasharray="3 9" pointer-events="none"/>'+
    // Etiquetas de zona
    '<text x="115"  y="22"  fill="#0d8b7d" font-size="10" font-weight="700" font-family="system-ui" letter-spacing="2" pointer-events="none">ZONA BLE</text>'+
    '<text x="55"   y="515" fill="#c1760c" font-size="10" font-weight="700" font-family="system-ui" letter-spacing="2" pointer-events="none">ZONA RS-485</text>'+
    '<text x="820"  y="22"  fill="#2f6fb0" font-size="10" font-weight="700" font-family="system-ui" letter-spacing="2" pointer-events="none">ZONA CAN</text>';

  // Green connection lines (drawn behind everything)
  buf += gline(CX,CY, bP.x,bP.y, 1.1);
  buf += gline(CX,CY, mP.x,mP.y, 1.4);
  buf += gline(CX,CY, cP.x,cP.y, 0.95);
  buf += gline(CX,CY, sP.x,sP.y, 1.7);

  // Sub-lines: module → devices
  bleNodes.forEach(function(d){ buf += sline(bP.x,bP.y, d.x,d.y, '#2dd4bf', 1.4); });
  mbNodes.forEach(function(d){  buf += sline(mP.x,mP.y, d.x,d.y, '#f59e0b', 1.7); });
  canNodes.forEach(function(d){ buf += sline(cP.x,cP.y, d.x,d.y, '#4a9eff', 1.2); });

  // Device sub-nodes
  bleNodes.forEach(function(d){ buf += devNode(d.x,d.y, d.lbl,d.sub, '#2dd4bf', 'ble',    d.ntype, d.nkey); });
  mbNodes.forEach(function(d){  buf += devNode(d.x,d.y, d.lbl,d.sub, '#f59e0b', 'modbus', d.ntype, d.nkey); });
  canNodes.forEach(function(d){ buf += devNode(d.x,d.y, d.lbl,d.sub, '#4a9eff', 'can',    d.ntype, d.nkey); });

  // Module equipment nodes (on top of lines and sub-nodes)
  buf += equipNode(bP.x,bP.y, '#2dd4bf', 'ble',    'mod-ble', iconBLE, 'BLE Scanner', 'NimBLE · Core 0');
  buf += equipNode(mP.x,mP.y, '#f59e0b', 'modbus', 'mod-mb',  iconMB,  'Modbus RTU',  'RS-485 · 9600bd');
  buf += equipNode(cP.x,cP.y, '#4a9eff', 'can',    'mod-can', iconCAN, 'CAN Bus',     'TWAI · 500kbps');
  buf += equipNode(sP.x,sP.y, sdCol,     'logs',   'mod-sd',  iconSD,  'microSD',     sdOk ? 'SD presente' : 'Sin microSD');

  // Center EDGE101 gateway box
  buf += '<g class="topo-node" data-ntype="center" data-sec="" transform="translate('+CX+','+CY+')">'+
    '<circle r="95" fill="rgba(47,111,176,0.08)" stroke="#4a9eff" stroke-width="0.7" stroke-dasharray="3 8" stroke-opacity="0.42"/>'+
    // Glowing box frame (blurred) — escalado ~1.28x vs viewBox anterior
    '<g filter="url(#mg)">'+
      '<rect x="-67" y="-38" width="134" height="76" rx="9" fill="rgba(255,255,255,0.97)" stroke="#2f6fb0" stroke-width="2.5"/>'+
      '<path d="M-67,-38 L-60,-51 L74,-51 L67,-38 Z" fill="#dce8f5" stroke="#2f6fb0" stroke-width="1"/>'+
    '</g>'+
    // Ports + LED (no filter → crisp)
    '<rect x="-49" y="-26" width="11" height="9" rx="2" fill="#4a9eff" opacity="0.55"/>'+
    '<rect x="-33" y="-26" width="11" height="9" rx="2" fill="#4a9eff" opacity="0.55"/>'+
    '<rect x="-17" y="-26" width="11" height="9" rx="2" fill="#4a9eff" opacity="0.55"/>'+
    '<rect x="-1"  y="-26" width="11" height="9" rx="2" fill="#4a9eff" opacity="0.55"/>'+
    '<circle cx="37" cy="-18" r="5" fill="#22c55e">'+
      '<animate attributeName="opacity" values="1;0.5;1" dur="2s" repeatCount="indefinite"/>'+
    '</circle>'+
    '<text y="9"  text-anchor="middle" fill="#1f2a38" font-size="13" font-weight="700" font-family="system-ui" letter-spacing="0.5">AUDITORIA</text>'+
    '<text y="26" text-anchor="middle" fill="#2f6fb0" font-size="9.5" font-family="system-ui" letter-spacing="0.5">Y MONITOREO IIoT</text>'+
    '<text y="54" text-anchor="middle" fill="#8c8472" font-size="9" font-family="Consolas,monospace">'+escHtml(ip)+'</text>'+
    '</g>';

  svg.innerHTML = buf;

  // ── CLICK ─────────────────────────────────────────────
  svg.onclick = function(e) {
    var t = e.target;
    while (t && t !== svg) {
      if (t.getAttribute && t.getAttribute('data-sec')) {
        var s = t.getAttribute('data-sec');
        if (s) { window.location.hash = '#/' + s; navTo(s); }
        return;
      }
      t = t.parentNode;
    }
  };

  // ── TOOLTIP FLOTANTE ──────────────────────────────────
  var tooltip = document.getElementById('topo-tooltip');
  if (!tooltip) return;

  _ttNodeG = null;

  svg.onmousemove = function(e) {
    var t = e.target;
    var nodeG = null;
    while (t && t !== svg) {
      if (t.getAttribute && t.getAttribute('data-ntype')) { nodeG = t; break; }
      t = t.parentNode;
    }
    if (!nodeG || nodeG === _ttNodeG) return;
    _ttNodeG = nodeG;

    var content = buildTooltipContent(
      nodeG.getAttribute('data-ntype')||'',
      nodeG.getAttribute('data-nkey') ||''
    );
    if (!content) { tooltip.classList.add('oculto'); return; }

    tooltip.innerHTML = content;
    tooltip.classList.remove('oculto');

    // Posición anclada al centro del nodo (coords SVG → pixeles display)
    var svgRect = svg.getBoundingClientRect();
    var scale   = svgRect.width / 1100;
    var tfm = nodeG.getAttribute('transform') || '';
    var mt  = tfm.match(/translate\(([^,)]+)[,\s]+([^)]+)\)/);
    var cx  = mt ? parseFloat(mt[1]) * scale : e.clientX - svgRect.left;
    var cy  = mt ? parseFloat(mt[2]) * scale : e.clientY - svgRect.top;

    var ttW = 265, ttH = 200, gap = 62;
    var tx = cx + gap;
    var ty = cy - 80;
    if (tx + ttW > svgRect.width)  tx = cx - ttW - gap;
    if (ty + ttH > svgRect.height) ty = svgRect.height - ttH - 8;
    if (ty < 4) ty = 4;
    if (tx < 4) tx = 4;
    tooltip.style.left = tx + 'px';
    tooltip.style.top  = ty + 'px';
  };

  svg.onmouseleave = function() {
    tooltip.classList.add('oculto');
    _ttNodeG = null;
  };
}

/* ── TOPOLOGY TOOLTIP CONTENT ───────────────────────── */

function ttRow(lbl, val) {
  return '<div class="topo-tt-row"><span class="topo-tt-lbl">'+escHtml(lbl)+'</span>'+
    '<span class="topo-tt-val">'+escHtml(String(val))+'</span></div>';
}
function ttHtml(title, col, rows) {
  return '<div class="topo-tt-title" style="color:'+col+'">'+escHtml(title)+'</div>'+rows.join('');
}

function buildTooltipContent(ntype, nkey) {
  switch (ntype) {
    case 'center': {
      var s = state.status || {};
      var buses = [];
      if (state.bleDevices.length) buses.push('BLE');
      if (Object.keys(state.mbAccum).length) buses.push('Modbus');
      if (Object.keys(state.canAccum).length) buses.push('CAN');
      return ttHtml('EDGE101 Auditor IIoT','#4a9eff',[
        ttRow('IP', s.ip||'--'),
        ttRow('Heap', s.free_heap ? fmtHeapKB(s.free_heap)+' libre' : '--'),
        ttRow('Uptime', fmtUptime(s.uptime_s||0)),
        ttRow('Buses', buses.join(' · ')||'iniciando…'),
      ]);
    }
    case 'mod-ble': {
      var devs = state.bleDevices;
      var avg = devs.length ? Math.round(devs.reduce(function(a,d){return a+d.rssi;},0)/devs.length) : '--';
      return ttHtml('BLE Scanner','#2dd4bf',[
        ttRow('Activos',    devs.length+' dispositivos'),
        ttRow('Sesión',     Object.keys(state.knownMacs).length+' MACs únicas'),
        ttRow('Señal media',avg+' dBm'),
        ttRow('Modo',       'Pasivo · Core 0'),
      ]);
    }
    case 'mod-mb':
      return ttHtml('Modbus RTU','#f59e0b',[
        ttRow('Tramas',   state.mbStats.total+' en buffer'),
        ttRow('Esclavos', Object.keys(state.mbAccum).length+' detectados'),
        ttRow('Bus',      'RS-485 @ 9600 baud'),
        ttRow('Modo',     'Listen-only · Core 1'),
      ]);
    case 'mod-can':
      return ttHtml('CAN Bus','#4a9eff',[
        ttRow('Tramas',    state.canStats.total+' en buffer'),
        ttRow('IDs únicos',Object.keys(state.canAccum).length),
        ttRow('Std / Ext', (state.canStats.stdCount||0)+' / '+(state.canStats.extCount||0)),
        ttRow('Modo',      'TWAI · 500kbps · Core 1'),
      ]);
    case 'mod-sd': {
      var sdOk2 = state.sdInfo && state.sdInfo.sd;
      var arch  = sdOk2 ? (state.sdInfo.archivos||[]) : [];
      var kb    = (arch.reduce(function(a,f){return a+(f.bytes||0);},0)/1024).toFixed(1);
      return ttHtml('microSD', sdOk2?'#22c55e':'#636b80',[
        ttRow('Estado',   sdOk2?'Presente':'No detectada'),
        ttRow('Archivos', arch.length),
        ttRow('Usado',    sdOk2?kb+' KB':'--'),
        ttRow('Sistema',  'LittleFS + FAT32'),
      ]);
    }
    case 'dev-ble': {
      var dev = null;
      state.bleDevices.forEach(function(d){ if (d.mac===nkey) dev=d; });
      if (!dev) return '';
      var qi = rssiInfo(dev.rssi);
      return ttHtml('Dispositivo BLE','#2dd4bf',[
        ttRow('MAC',    dev.mac),
        ttRow('Nombre', dev.nombre||'sin nombre'),
        ttRow('RSSI',   dev.rssi+' dBm — '+qi.label),
        ttRow('Visto',  fmtVisto(dev.visto_ms||0)),
      ]);
    }
    case 'dev-mb':
      return ttHtml('Esclavo Modbus','#f59e0b',[
        ttRow('ID',     nkey),
        ttRow('Tramas', (state.mbAccum[nkey]||0)+' capturadas'),
        ttRow('Bus',    'RS-485 listen-only'),
      ]);
    case 'dev-can': {
      var proto = (nkey.length>6)?'J1939 · ext 29b':'CANopen · std 11b';
      return ttHtml('Nodo CAN','#4a9eff',[
        ttRow('ID',        nkey),
        ttRow('Tramas',    (state.canAccum[nkey]||0)+' capturadas'),
        ttRow('Protocolo', proto),
      ]);
    }
  }
  return '';
}

/* ── PRE-POPULATE MOCK HISTORIES ────────────────────── */

function initMockHistories() {
  state.bleHistory = [4,4,5,5,6,6,6,5,5,4,4,5,6,6,6,5,5,4,4,5,6,6,5,5,4,5,6,6,6,6];
  state.mbHistory  = [6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6];
  state.canHistory = [6,7,7,8,8,7,7,6,7,7,8,8,7,7,6,7,8,8,8,7,7,6,7,8,8,7,7,6,7,8];

  // Seed accumulators so charts are full immediately in mock mode
  state.mbAccum = {
    'Esclavo 1': 18, 'Esclavo 2': 14, 'Esclavo 3': 12,
    'Esclavo 5': 28, 'Esclavo 7': 7
  };
  state.canAccum = {
    '0x181': 180, '0x18F00400': 180, '0x182': 90,
    '0x18FE0900': 18, '0x701': 18, '0x583': 3
  };
}

/* ── NAVIGATION ──────────────────────────────────────── */

function getSecFromHash() {
  var h = window.location.hash || '#/overview';
  return h.replace('#/', '') || 'overview';
}

function navTo(sec) {
  document.querySelectorAll('main section').forEach(function(s) {
    s.classList.toggle('oculto', s.dataset.sec !== sec);
  });
  document.querySelectorAll('.nav-item').forEach(function(a) {
    var href = a.getAttribute('href') || '';
    a.classList.toggle('activo', href === '#/' + sec);
  });
}

/* ── INIT ────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('conn-dot').className = 'conn-dot pulse';
  document.getElementById('conn-text').textContent = 'conectando...';

  navTo(getSecFromHash());
  window.addEventListener('hashchange', function() { navTo(getSecFromHash()); });
  document.querySelectorAll('[data-link]').forEach(function(a) {
    a.addEventListener('click', function() {
      setTimeout(function() { navTo(getSecFromHash()); }, 0);
    });
  });

  // In mock mode, seed histories so charts look good from the start
  initMockHistories();

  fetchStatus();
  fetchBle();
  fetchEvents();
  fetchLogs();
  fetchModbus();
  fetchCan();
  fetchAlertas();

  setInterval(fetchStatus,  5000);
  setInterval(fetchBle,     5000);
  setInterval(fetchEvents,  5000);
  setInterval(fetchLogs,   15000);
  setInterval(fetchModbus,  5000);
  setInterval(fetchCan,     5000);
  setInterval(fetchAlertas, 5000);

  setInterval(function() {
    var ts = document.getElementById('ble-ts');
    if (state.lastBleMs) ts.textContent = 'actualizado ' + fmtVisto(Date.now() - state.lastBleMs);
  }, 2000);
});
