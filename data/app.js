var MOCK_STATUS = {
  device: "Edge101 Auditor (mock)",
  version: "0.1.0-dev",
  build: "local-dev",
  uptime_s: 3725,
  free_heap: 215840,
  ip: "127.0.0.1"
};

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

document.addEventListener('DOMContentLoaded', function() {
  cargarEstado();
  setInterval(cargarEstado, 5000);
});
