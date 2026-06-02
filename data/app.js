/* ── MOCK DATA ──────────────────────────────────────── */

var MOCK_STATUS = {
  device: 'Edge101 Auditor', version: '0.1.0-dev', build: 'local-dev',
  uptime_s: 3725, free_heap: 218240, ip: '192.168.1.101'
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
  { utc:0, uptime_ms:245000, source:'ble', detail:'MAC=AA:BB:CC:11:22:33 name=Smartphone rssi=-38' },
  { utc:0, uptime_ms:230000, source:'ble', detail:'MAC=11:22:AB:CD:EF:10 name=Tablet rssi=-81' },
  { utc:0, uptime_ms:198000, source:'ble', detail:'MAC=DE:AD:BE:EF:00:01 name=Beacon Sala rssi=-56' },
  { utc:0, uptime_ms:175000, source:'ble', detail:'MAC=55:44:33:22:11:00 name=Sensor Temperatura rssi=-62' },
  { utc:0, uptime_ms:120000, source:'ble', detail:'MAC=F0:E1:D2:C3:B4:A5 name=- rssi=-74' },
  { utc:0, uptime_ms:85000,  source:'ble', detail:'MAC=99:88:77:66:55:44 name=- rssi=-91' },
];

var MOCK_LOGS = { sd: false, archivos: [] };

var MOCK_MODBUS = [
  { slave: 3,  function: 3, len: 8, crc_ok: true,  visto_ms: 2000  },
  { slave: 7,  function: 6, len: 8, crc_ok: true,  visto_ms: 14000 },
  { slave: 12, function: 3, len: 8, crc_ok: false, visto_ms: 60000 }
];

var MOCK_CAN = [
  { id: '0x100',      ext: false, dlc: 8, datos: '00 01 A4 B0 02 00 00 00', visto_ms: 1000  },
  { id: '0x101',      ext: false, dlc: 4, datos: 'FF FF 00 01',             visto_ms: 5000  },
  { id: '0x18FF50E5', ext: true,  dlc: 8, datos: 'AA BB CC DD EE FF 00 11', visto_ms: 12000 }
];

var MOCK_ALERTAS = [
  { utc: 0, nivel: 'WARNING', mensaje: 'Nuevo dispositivo BLE detectado (id 0x1A2B3C)' },
  { utc: 0, nivel: 'WARNING', mensaje: 'Nueva direccion Modbus detectada: esclavo 12' }
];

/* ── STATE ──────────────────────────────────────────── */

var state = {
  bleDevices:    [],
  bleHistory:    [],   // [count, count, ...] ultimas 30 lecturas cada 5s
  knownMacs:     {},   // mac -> timestamp primera vez vista (sesion)
  newMacsThisCycle: [],
  events:        [],
  status:        null,
  sdInfo:        null,
  connected:     false,
  isMock:        false,
  lastBleMs:     0,
  totalHeap:     327680,   // referencia ESP32 (bytes)
};

/* ── RSSI HELPERS ───────────────────────────────────── */

function rssiInfo(rssi) {
  var pct = Math.max(0, Math.min(100, ((rssi + 100) / 70) * 100));
  if (rssi >= -60) return { pct:pct, cls:'exc',  label:'Excelente' };
  if (rssi >= -70) return { pct:pct, cls:'ok',   label:'Bueno'     };
  if (rssi >= -80) return { pct:pct, cls:'warn', label:'Débil'     };
  return              { pct:pct, cls:'crit', label:'Crítico'   };
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
  var s = Math.floor(ev.uptime_ms / 1000);
  return 'up+' + fmtUptime(s);
}

/* ── SPARKLINE ──────────────────────────────────────── */

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
  if (data.length > 1) {
    el.textContent = '(' + data.length * 5 + 's window)';
  }
}

/* ── RSSI DISTRIBUTION CHART ─────────────────────────── */

function updateRssiDist() {
  var devs = state.bleDevices;
  var bins = [
    { label: 'Excelente', range: '≥ −60',  cls: 'exc',  color: '#22c55e', count: 0 },
    { label: 'Bueno',     range: '−70',    cls: 'ok',   color: '#84cc16', count: 0 },
    { label: 'Débil',     range: '−80',    cls: 'warn', color: '#f59e0b', count: 0 },
    { label: 'Crítico',   range: '< −80',  cls: 'crit', color: '#ef4444', count: 0 },
  ];

  devs.forEach(function(d) {
    var q = rssiInfo(d.rssi);
    for (var i = 0; i < bins.length; i++) {
      if (bins[i].cls === q.cls) { bins[i].count++; break; }
    }
  });

  var total = devs.length || 1;
  var el = document.getElementById('rssi-dist');

  if (devs.length === 0) {
    el.innerHTML = '<div class="rssi-empty">Sin datos BLE</div>';
    return;
  }

  var html = bins.map(function(b) {
    var pct = (b.count / total * 100).toFixed(0) + '%';
    return '<div class="rssi-row">' +
      '<div class="rssi-row-lbl">' + b.label + '</div>' +
      '<div class="rssi-row-track"><div class="rssi-row-fill" style="width:' + pct + ';background:' + b.color + '"></div></div>' +
      '<div class="rssi-row-count">' + b.count + '</div>' +
    '</div>';
  }).join('');

  el.innerHTML = html;
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

function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

function updateEventFeeds() {
  var evs = state.events;

  // mini feed (overview, last 5)
  var mini = document.getElementById('mini-feed');
  mini.innerHTML = '';
  var shown = evs.slice(0, 5);
  if (shown.length === 0) {
    var li = document.createElement('li');
    li.className = 'ev-empty';
    li.textContent = 'Sin eventos registrados';
    mini.appendChild(li);
  } else {
    shown.forEach(function(ev) { mini.appendChild(buildEvItem(ev)); });
  }

  // full feed (eventos section)
  var full = document.getElementById('ev-feed');
  full.innerHTML = '';
  document.getElementById('ev-chip').textContent = evs.length;
  if (evs.length === 0) {
    var li2 = document.createElement('li');
    li2.className = 'ev-empty';
    li2.textContent = 'Sin eventos registrados';
    full.appendChild(li2);
  } else {
    evs.forEach(function(ev) { full.appendChild(buildEvItem(ev)); });
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
  var container = document.getElementById('dev-list');

  document.getElementById('ble-chip').textContent = devs.length;

  var navChip = document.getElementById('nav-ble-chip');
  navChip.textContent = devs.length;
  navChip.classList.toggle('visible', devs.length > 0);

  if (devs.length === 0) {
    container.innerHTML = '<div class="empty-state">Sin dispositivos BLE detectados en los últimos 2 min</div>';
  } else {
    container.innerHTML = devs.map(buildDevCard).join('');
  }

  var ts = document.getElementById('ble-ts');
  if (state.lastBleMs) {
    ts.textContent = 'actualizado ' + fmtVisto(Date.now() - state.lastBleMs);
  }
}

/* ── KPI UPDATE ──────────────────────────────────────── */

function updateKpis() {
  var devs = state.bleDevices;
  var total = Object.keys(state.knownMacs).length;

  document.getElementById('k-ble-activos').textContent = devs.length;
  document.getElementById('k-ble-total').textContent   = total;
  document.getElementById('k-eventos').textContent     = state.events.length;

  if (state.status) {
    var h = state.status.free_heap;
    var pct = Math.min(100, (h / state.totalHeap) * 100);
    document.getElementById('k-heap').textContent = fmtHeapKB(h);
    setBarPct('k-heap-bar', pct);
  }
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
  document.getElementById('s-device').textContent  = s.device  || '--';
  document.getElementById('s-version').textContent = s.version || '--';
  document.getElementById('s-build').textContent   = s.build   || '--';
  document.getElementById('s-ip').textContent      = s.ip      || '--';
  document.getElementById('s-uptime').textContent  = fmtUptime(s.uptime_s || 0);

  var h = s.free_heap || 0;
  var pct = Math.min(100, (h / state.totalHeap) * 100);
  document.getElementById('s-heap').textContent    = fmtBytes(h);
  document.getElementById('s-heap-pct').textContent = '(' + pct.toFixed(0) + '% libre)';
  setBarPct('s-heap-bar', pct);

  document.getElementById('header-ip').textContent  = s.ip || '--';
  document.getElementById('footer-up').textContent  = 'uptime: ' + fmtUptime(s.uptime_s || 0);
}

/* ── LOGS UPDATE ─────────────────────────────────────── */

function updateLogs(data) {
  state.sdInfo = data;
  var missing = document.getElementById('sd-missing');
  var tabla   = document.getElementById('t-logs');

  if (!data.sd) {
    missing.classList.remove('oculto');
    tabla.classList.add('oculto');
    return;
  }

  missing.classList.add('oculto');
  tabla.classList.remove('oculto');
  var tbody = tabla.querySelector('tbody');
  tbody.innerHTML = '';
  (data.archivos || []).forEach(function(f) {
    var tr = document.createElement('tr');
    tr.innerHTML = '<td>' + escHtml(f.nombre) + '</td>' +
                   '<td>' + (f.bytes / 1024).toFixed(1) + ' KB</td>' +
                   '<td><a href="/api/logs/download?file=' + encodeURIComponent(f.nombre) + '">descargar</a></td>';
    tbody.appendChild(tr);
  });
}

/* ── API FETCHERS ────────────────────────────────────── */

function setConn(ok) {
  state.connected = ok;
  var dot  = document.getElementById('conn-dot');
  var text = document.getElementById('conn-text');
  dot.className  = 'conn-dot ' + (ok ? 'ok' : 'err');
  text.textContent = ok ? 'conectado' : 'sin conexion';
}

function fetchStatus() {
  fetch('/api/status')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      state.status = data;
      state.isMock = false;
      setConn(true);
      updateSistema();
      updateKpis();
      document.getElementById('modo-local').classList.add('oculto');
    })
    .catch(function() {
      if (!state.status) {
        state.status = MOCK_STATUS;
        state.isMock = true;
        document.getElementById('modo-local').classList.remove('oculto');
        var dot = document.getElementById('conn-dot');
        dot.className = 'conn-dot pulse';
        document.getElementById('conn-text').textContent = 'modo local';
        updateSistema();
        updateKpis();
      }
    });
}

function fetchBle() {
  fetch('/api/ble/devices')
    .then(function(r) { return r.json(); })
    .then(function(data) { applyBleData(data); })
    .catch(function() {
      if (state.isMock) applyBleData(MOCK_BLE);
    });
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

  // historial para sparkline (max 30 puntos = ~2.5 min)
  state.bleHistory.push(devs.length);
  if (state.bleHistory.length > 30) state.bleHistory.shift();

  updateBleSection();
  updateKpis();
  updateSparkline();
  updateRssiDist();
}

function fetchEvents() {
  fetch('/api/events')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      state.events = data;
      updateEventFeeds();
    })
    .catch(function() {
      if (state.isMock && state.events.length === 0) {
        state.events = MOCK_EVENTS;
        updateEventFeeds();
      }
    });
}

function fetchLogs() {
  fetch('/api/logs')
    .then(function(r) { return r.json(); })
    .then(function(data) { updateLogs(data); })
    .catch(function() {
      if (state.isMock) updateLogs(MOCK_LOGS);
    });
}

/* ── MODBUS ──────────────────────────────────────────── */

function fmtFuncion(fc) {
  var hex = '0x' + ('0' + fc.toString(16).toUpperCase()).slice(-2);
  var nombres = { 1:'Read Coils', 2:'Read Inputs', 3:'Read Holding',
                  4:'Read Input Reg', 5:'Write Coil', 6:'Write Reg',
                  15:'Write Coils', 16:'Write Regs' };
  return nombres[fc] ? (hex + ' ' + nombres[fc]) : hex;
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
  var idle  = document.getElementById('mb-idle');
  var tabla = document.getElementById('t-modbus');
  if (rows.length === 0) {
    idle.classList.remove('oculto');
    tabla.classList.add('oculto');
    return;
  }
  idle.classList.add('oculto');
  tabla.classList.remove('oculto');
  var tbody = tabla.querySelector('tbody');
  tbody.innerHTML = '';
  rows.forEach(function(d) {
    var crc = d.crc_ok ? '<span class="badge-ok">OK</span>'
                       : '<span class="badge-err">ERR</span>';
    var tr = document.createElement('tr');
    tr.innerHTML = '<td>' + fmtVisto(d.visto_ms) + '</td><td>' + d.slave +
                   '</td><td>' + fmtFuncion(d.function) + '</td><td>' + d.len +
                   '</td><td>' + crc + '</td>';
    tbody.appendChild(tr);
  });
}

function fetchModbus() {
  fetch('/api/modbus')
    .then(function(r) { return r.json(); })
    .then(function(data) { updateModbus(data); })
    .catch(function() { if (state.isMock) updateModbus(MOCK_MODBUS); });
}

/* ── CAN ─────────────────────────────────────────────── */

function updateCan(rows) {
  document.getElementById('can-chip').textContent = rows.length;
  setNavChip('nav-can-chip', rows.length);
  var idle  = document.getElementById('can-idle');
  var tabla = document.getElementById('t-can');
  if (rows.length === 0) {
    idle.classList.remove('oculto');
    tabla.classList.add('oculto');
    return;
  }
  idle.classList.add('oculto');
  tabla.classList.remove('oculto');
  var tbody = tabla.querySelector('tbody');
  tbody.innerHTML = '';
  rows.forEach(function(d) {
    var ext = d.ext ? ' <span class="badge-ext">ext</span>' : '';
    var tr = document.createElement('tr');
    tr.innerHTML = '<td>' + fmtVisto(d.visto_ms) + '</td><td>' + escHtml(d.id) + ext +
                   '</td><td>' + d.dlc + '</td><td>' + escHtml(d.datos || '') + '</td>';
    tbody.appendChild(tr);
  });
}

function fetchCan() {
  fetch('/api/can')
    .then(function(r) { return r.json(); })
    .then(function(data) { updateCan(data); })
    .catch(function() { if (state.isMock) updateCan(MOCK_CAN); });
}

/* ── ALERTAS ─────────────────────────────────────────── */

function updateAlertas(rows) {
  document.getElementById('al-chip').textContent = rows.length;
  setNavChip('nav-al-chip', rows.length);
  var feed = document.getElementById('al-feed');
  feed.innerHTML = '';
  if (rows.length === 0) {
    var vacio = document.createElement('li');
    vacio.className = 'ev-empty';
    vacio.textContent = 'Sin alertas -- ninguna entidad anomala detectada';
    feed.appendChild(vacio);
    return;
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

function fetchAlertas() {
  fetch('/api/alerts')
    .then(function(r) { return r.json(); })
    .then(function(data) { updateAlertas(data); })
    .catch(function() { if (state.isMock) updateAlertas(MOCK_ALERTAS); });
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

  // initial connection dot state
  document.getElementById('conn-dot').className = 'conn-dot pulse';
  document.getElementById('conn-text').textContent = 'conectando...';

  // navigation
  navTo(getSecFromHash());
  window.addEventListener('hashchange', function() { navTo(getSecFromHash()); });
  document.querySelectorAll('[data-link]').forEach(function(a) {
    a.addEventListener('click', function() {
      setTimeout(function() { navTo(getSecFromHash()); }, 0);
    });
  });

  // initial fetch
  fetchStatus();
  fetchBle();
  fetchEvents();
  fetchLogs();
  fetchModbus();
  fetchCan();
  fetchAlertas();

  // polling
  setInterval(fetchStatus, 5000);
  setInterval(fetchBle,    5000);
  setInterval(fetchEvents, 5000);
  setInterval(fetchLogs,   15000);
  setInterval(fetchModbus, 5000);
  setInterval(fetchCan,    5000);
  setInterval(fetchAlertas, 5000);

  // update "updated X ago" label in BLE section
  setInterval(function() {
    var ts = document.getElementById('ble-ts');
    if (state.lastBleMs) {
      ts.textContent = 'actualizado ' + fmtVisto(Date.now() - state.lastBleMs);
    }
  }, 2000);
});
