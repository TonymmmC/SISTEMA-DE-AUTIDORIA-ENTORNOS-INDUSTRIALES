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
  { hora: "14:23:01", esclavo: 3,  funcion: "0x03 Read",  registro: "40001", datos: "0x00A4" },
  { hora: "14:23:01", esclavo: 7,  funcion: "0x06 Write", registro: "40010", datos: "0x0100" },
  { hora: "14:23:02", esclavo: 12, funcion: "0x03 Read",  registro: "40005", datos: "0x12FA" }
];

var MOCK_CAN = [
  { hora: "14:23:01", id: "0x100", dlc: 8, datos: "00 01 A4 B0 02 00 00 00" },
  { hora: "14:23:01", id: "0x101", dlc: 4, datos: "FF FF 00 01" },
  { hora: "14:23:02", id: "0x200", dlc: 8, datos: "AA BB CC DD EE FF 00 11" }
];

var MOCK_ALERTAS = [
  { hora: "14:21:33", nivel: "CRITICAL", mensaje: "Dispositivo BLE no autorizado: DE:AD:BE:EF:00:01" },
  { hora: "14:18:02", nivel: "WARNING",  mensaje: "Nueva direccion Modbus detectada: esclavo 12" }
];

var MOCK_LOGS = [
  { archivo: "audit/2026-05-19.csv", fecha: "2026-05-19", tamano: "1.2 MB", eventos: 4823 },
  { archivo: "audit/2026-05-18.csv", fecha: "2026-05-18", tamano: "987 KB", eventos: 3941 },
  { archivo: "audit/critical.csv",   fecha: "live",       tamano: "12 KB",  eventos: 47 }
];

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
    tr.innerHTML = '<td>' + d.mac + '</td><td>' + (d.nombre || '') +
                   '</td><td>' + d.rssi + ' dBm</td><td>' + visto + '</td>';
    tbody.appendChild(tr);
  });
}

function cargarBLE() {
  fetch('/api/ble/devices')
    .then(function(r) { return r.json(); })
    .then(function(data) { rellenarBLE(data); })
    .catch(function() { rellenarBLE(MOCK_BLE); });
}

function rellenarModbus(items) {
  var tbody = document.querySelector('#tabla-modbus tbody');
  tbody.innerHTML = '';
  items.forEach(function(d) {
    var tr = document.createElement('tr');
    tr.innerHTML = '<td>' + d.hora + '</td><td>' + d.esclavo +
                   '</td><td>' + d.funcion + '</td><td>' + d.registro +
                   '</td><td>' + d.datos + '</td>';
    tbody.appendChild(tr);
  });
}

function rellenarCAN(items) {
  var tbody = document.querySelector('#tabla-can tbody');
  tbody.innerHTML = '';
  items.forEach(function(d) {
    var tr = document.createElement('tr');
    tr.innerHTML = '<td>' + d.hora + '</td><td>' + d.id +
                   '</td><td>' + d.dlc + '</td><td>' + d.datos + '</td>';
    tbody.appendChild(tr);
  });
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

function rellenarLogs(items) {
  var tbody = document.querySelector('#tabla-logs tbody');
  tbody.innerHTML = '';
  items.forEach(function(d) {
    var tr = document.createElement('tr');
    tr.innerHTML = '<td>' + d.archivo + '</td><td>' + d.fecha +
                   '</td><td>' + d.tamano + '</td><td>' + d.eventos + '</td>';
    tbody.appendChild(tr);
  });
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
  cargarEstado();
  setInterval(cargarEstado, 5000);

  cargarBLE();
  setInterval(cargarBLE, 5000);

  rellenarModbus(MOCK_MODBUS);
  rellenarCAN(MOCK_CAN);
  rellenarAlertas(MOCK_ALERTAS);
  rellenarLogs(MOCK_LOGS);

  mostrarSeccion(leerSeccionDeHash());
  window.addEventListener('hashchange', function() {
    mostrarSeccion(leerSeccionDeHash());
  });
});
