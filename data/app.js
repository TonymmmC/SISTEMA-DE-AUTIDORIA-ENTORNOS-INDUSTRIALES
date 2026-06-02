var MOCK_STATUS = {
  device: "Edge101 Auditor (mock)",
  version: "0.1.0-dev",
  build: "local-dev",
  uptime_s: 3725,
  free_heap: 215840,
  ip: "127.0.0.1"
};

var MOCK_BLE = [
  { mac: "AA:BB:CC:11:22:33", nombre: "Smartphone Operador", rssi: -42, ultimaVez: "hace 2s" },
  { mac: "DE:AD:BE:EF:00:01", nombre: "Beacon Sala 3",       rssi: -68, ultimaVez: "hace 14s" },
  { mac: "55:44:33:22:11:00", nombre: "Sensor Temp",         rssi: -55, ultimaVez: "hace 1m" }
];

var MOCK_MODBUS = [
  { slave: 3,  function: 3, len: 8, crc_ok: true,  visto_ms: 2000 },
  { slave: 7,  function: 6, len: 8, crc_ok: true,  visto_ms: 14000 },
  { slave: 12, function: 3, len: 8, crc_ok: false, visto_ms: 60000 }
];

var MOCK_CAN = [
  { id: "0x100", ext: false, dlc: 8, datos: "00 01 A4 B0 02 00 00 00", visto_ms: 1000 },
  { id: "0x101", ext: false, dlc: 4, datos: "FF FF 00 01", visto_ms: 5000 },
  { id: "0x18FF50E5", ext: true, dlc: 8, datos: "AA BB CC DD EE FF 00 11", visto_ms: 12000 }
];

var MOCK_ALERTAS = [
  { hora: "14:21:33", nivel: "CRITICAL", mensaje: "Dispositivo BLE no autorizado: DE:AD:BE:EF:00:01" },
  { hora: "14:18:02", nivel: "WARNING",  mensaje: "Nueva direccion Modbus detectada: esclavo 12" }
];

var MOCK_EVENTS = [
  { utc: 0,          uptime_ms: 12000, source: "ble", detail: "MAC=AA:BB:CC:11:22:33 name=Smartphone rssi=-42" },
  { utc: 0,          uptime_ms: 8500,  source: "ble", detail: "MAC=DE:AD:BE:EF:00:01 name=Beacon rssi=-68" }
];

var MOCK_LOGS = { sd: false, archivos: [] };

var MOCK_STATS = {
  ble: 3, modbus: 3, modbus_valid: 2, can: 3, eventos: 5,
  ntp: false, sd: false, heap: 215840, heap_min: 198400, uptime_s: 3725
};

function badge(texto, clase) {
  return '<span class="badge ' + clase + '">' + texto + '</span>';
}

function actualizarConexion(ok) {
  var dot = document.getElementById('conexion-dot');
  var txt = document.getElementById('conexion-texto');
  if (!dot || !txt) return;
  dot.className = 'dot ' + (ok ? 'dot-ok' : 'dot-err');
  txt.textContent = ok ? 'en linea' : 'sin conexion';
}

function tickReloj() {
  var el = document.getElementById('reloj');
  if (el) el.textContent = new Date().toLocaleTimeString('es-BO');
}

function rellenarStats(s) {
  document.getElementById('stat-ble').textContent     = s.ble;
  document.getElementById('stat-modbus').textContent  = s.modbus;
  document.getElementById('stat-can').textContent     = s.can || 0;
  document.getElementById('stat-eventos').textContent = s.eventos;
  document.getElementById('stat-heap').textContent    = formatearBytes(s.heap || 0);
  document.getElementById('heap-min').textContent     = formatearBytes(s.heap_min || 0);
  var ntpEl = document.getElementById('ntp');
  ntpEl.innerHTML = s.ntp ? badge('sincronizada', 'badge-ok')
                          : badge('NTP pendiente', 'badge-warn');
  var sdEl = document.getElementById('sd');
  sdEl.innerHTML = s.sd ? badge('presente', 'badge-ok')
                        : badge('no presente', 'badge-off');
}

function cargarStats() {
  fetch('/api/stats')
    .then(function(r) { return r.json(); })
    .then(function(data) { actualizarConexion(true); rellenarStats(data); })
    .catch(function() { actualizarConexion(false); rellenarStats(MOCK_STATS); });
}

function formatearHoraUtc(utc) {
  if (!utc || utc === 0) return 'sin hora (NTP pendiente)';
  var d = new Date(utc * 1000);
  return d.toLocaleString('es-BO', { timeZone: 'America/La_Paz' });
}

function formatearUptime(segundos) {
  var h = Math.floor(segundos / 3600);
  var m = Math.floor((segundos % 3600) / 60);
  var s = segundos % 60;
  return h + 'h ' + m + 'm ' + s + 's';
}

function formatearBytes(bytes) {
  return (bytes / 1024).toFixed(1) + ' KB';
}

function rellenarDOM(data) {
  document.getElementById('device').textContent  = data.device   || '--';
  document.getElementById('version').textContent = data.version  || '--';
  document.getElementById('build').textContent   = data.build    || '--';
  document.getElementById('uptime').textContent  = formatearUptime(data.uptime_s  || 0);
  document.getElementById('ip').textContent      = data.ip       || '--';
  document.getElementById('heap').textContent    = formatearBytes(data.free_heap  || 0);
  var ind = document.getElementById('indicador');
  ind.textContent = 'Sistema operativo';
  ind.className   = 'indicador ok';
}

function usarMockData() {
  rellenarDOM(MOCK_STATUS);
  document.getElementById('modo-local').classList.remove('oculto');
}

function cargarEstado() {
  fetch('/api/status')
    .then(function(r) { return r.json(); })
    .then(function(data) { rellenarDOM(data); })
    .catch(function() { usarMockData(); });
}

function formatearVisto(ms) {
  if (ms < 60000)  return 'hace ' + Math.floor(ms / 1000) + 's';
  if (ms < 3600000) return 'hace ' + Math.floor(ms / 60000) + 'm';
  return 'hace ' + Math.floor(ms / 3600000) + 'h';
}

function rellenarBLE(items) {
  var tbody = document.querySelector('#tabla-ble tbody');
  tbody.innerHTML = '';
  if (items.length === 0) {
    var tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="4">Sin dispositivos detectados</td>';
    tbody.appendChild(tr);
    return;
  }
  items.forEach(function(d) {
    var tr = document.createElement('tr');
    var visto = d.visto_ms !== undefined ? formatearVisto(d.visto_ms) : (d.ultimaVez || '--');
    var clase = d.rssi > -60 ? 'badge-ok' : (d.rssi > -75 ? 'badge-warn' : 'badge-err');
    var rssi = badge(d.rssi + ' dBm', clase);
    tr.innerHTML = '<td>' + d.mac + '</td><td>' + (d.nombre || '') +
                   '</td><td>' + rssi + '</td><td>' + visto + '</td>';
    tbody.appendChild(tr);
  });
}

function cargarBLE() {
  fetch('/api/ble/devices')
    .then(function(r) { return r.json(); })
    .then(function(data) { rellenarBLE(data); })
    .catch(function() { rellenarBLE(MOCK_BLE); });
}

function formatearFuncion(fc) {
  var hex = '0x' + ('0' + fc.toString(16).toUpperCase()).slice(-2);
  var nombres = { 1: 'Read Coils', 2: 'Read Inputs', 3: 'Read Holding',
                  4: 'Read Input Reg', 5: 'Write Coil', 6: 'Write Reg',
                  15: 'Write Coils', 16: 'Write Regs' };
  return nombres[fc] ? (hex + ' ' + nombres[fc]) : hex;
}

function rellenarModbus(items) {
  var tbody = document.querySelector('#tabla-modbus tbody');
  tbody.innerHTML = '';
  if (items.length === 0) {
    var tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="5">Sin trafico en el bus RS485</td>';
    tbody.appendChild(tr);
    return;
  }
  items.forEach(function(d) {
    var fila = document.createElement('tr');
    var crc = d.crc_ok ? badge('OK', 'badge-ok') : badge('ERR', 'badge-err');
    fila.innerHTML = '<td>' + formatearVisto(d.visto_ms) + '</td><td>' + d.slave +
                     '</td><td>' + formatearFuncion(d.function) + '</td><td>' + d.len +
                     '</td><td>' + crc + '</td>';
    tbody.appendChild(fila);
  });
}

function cargarModbus() {
  fetch('/api/modbus')
    .then(function(r) { return r.json(); })
    .then(function(data) { rellenarModbus(data); })
    .catch(function() { rellenarModbus(MOCK_MODBUS); });
}

function rellenarCAN(items) {
  var tbody = document.querySelector('#tabla-can tbody');
  tbody.innerHTML = '';
  if (items.length === 0) {
    var tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="4">Sin trafico en el bus CAN</td>';
    tbody.appendChild(tr);
    return;
  }
  items.forEach(function(d) {
    var fila = document.createElement('tr');
    var tipo = d.ext ? badge('ext', 'badge-can') : '';
    fila.innerHTML = '<td>' + formatearVisto(d.visto_ms) + '</td><td>' + d.id + ' ' + tipo +
                     '</td><td>' + d.dlc + '</td><td>' + (d.datos || '') + '</td>';
    tbody.appendChild(fila);
  });
}

function cargarCAN() {
  fetch('/api/can')
    .then(function(r) { return r.json(); })
    .then(function(data) { rellenarCAN(data); })
    .catch(function() { rellenarCAN(MOCK_CAN); });
}

function rellenarAlertas(items) {
  var ul = document.getElementById('lista-alertas');
  ul.innerHTML = '';
  items.forEach(function(d) {
    var li = document.createElement('li');
    li.className = 'alerta-' + d.nivel.toLowerCase();
    li.textContent = '[' + d.hora + '] ' + d.nivel + ': ' + d.mensaje;
    ul.appendChild(li);
  });
}

function rellenarEventos(items) {
  var tbody = document.querySelector('#tabla-eventos tbody');
  tbody.innerHTML = '';
  if (items.length === 0) {
    var tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="3">Sin eventos registrados</td>';
    tbody.appendChild(tr);
    return;
  }
  items.forEach(function(d) {
    var tr = document.createElement('tr');
    var clase = d.source === 'modbus' ? 'badge-modbus' : (d.source === 'can' ? 'badge-can' : 'badge-ble');
    tr.innerHTML = '<td>' + formatearHoraUtc(d.utc) + '</td><td>' + badge(d.source, clase) +
                   '</td><td>' + d.detail + '</td>';
    tbody.appendChild(tr);
  });
}

function rellenarLogs(data) {
  var estadoEl = document.getElementById('sd-estado');
  var tablaEl  = document.getElementById('tabla-logs');
  if (!data.sd) {
    estadoEl.classList.remove('oculto');
    tablaEl.classList.add('oculto');
    return;
  }
  estadoEl.classList.add('oculto');
  tablaEl.classList.remove('oculto');
  var tbody = tablaEl.querySelector('tbody');
  tbody.innerHTML = '';
  (data.archivos || []).forEach(function(f) {
    var tr = document.createElement('tr');
    var kb = (f.bytes / 1024).toFixed(1) + ' KB';
    var enlace = '<a href="/api/logs/download?file=' + f.nombre + '">descargar</a>';
    tr.innerHTML = '<td>' + f.nombre + '</td><td>' + kb + '</td><td>' + enlace + '</td>';
    tbody.appendChild(tr);
  });
}

function cargarEventos() {
  fetch('/api/events')
    .then(function(r) { return r.json(); })
    .then(function(data) { rellenarEventos(data); })
    .catch(function() { rellenarEventos(MOCK_EVENTS); });
}

function cargarLogs() {
  fetch('/api/logs')
    .then(function(r) { return r.json(); })
    .then(function(data) { rellenarLogs(data); })
    .catch(function() { rellenarLogs(MOCK_LOGS); });
}

function mostrarSeccion(nombre) {
  document.querySelectorAll('main section').forEach(function(s) {
    s.classList.toggle('oculto', s.dataset.seccion !== nombre);
  });
  document.querySelectorAll('.sidebar a').forEach(function(a) {
    a.classList.toggle('activo', a.getAttribute('href') === '#/' + nombre);
  });
}

function leerSeccionDeHash() {
  var hash = window.location.hash || '#/sistema';
  return hash.replace('#/', '') || 'sistema';
}

document.addEventListener('DOMContentLoaded', function() {
  tickReloj();
  setInterval(tickReloj, 1000);

  cargarStats();
  setInterval(cargarStats, 5000);

  cargarEstado();
  setInterval(cargarEstado, 5000);

  cargarBLE();
  setInterval(cargarBLE, 5000);

  cargarEventos();
  setInterval(cargarEventos, 5000);

  cargarLogs();
  setInterval(cargarLogs, 15000);

  cargarModbus();
  setInterval(cargarModbus, 5000);

  cargarCAN();
  setInterval(cargarCAN, 5000);

  rellenarAlertas(MOCK_ALERTAS);

  mostrarSeccion(leerSeccionDeHash());
  window.addEventListener('hashchange', function() {
    mostrarSeccion(leerSeccionDeHash());
  });
});
