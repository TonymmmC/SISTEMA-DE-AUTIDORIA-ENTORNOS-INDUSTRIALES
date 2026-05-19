function formatearUptime(segundos) {
  var h = Math.floor(segundos / 3600);
  var m = Math.floor((segundos % 3600) / 60);
  var s = segundos % 60;
  return h + 'h ' + m + 'm ' + s + 's';
}

function formatearBytes(bytes) {
  return (bytes / 1024).toFixed(1) + ' KB';
}

function cargarEstado() {
  fetch('/api/status')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      document.getElementById('device').textContent  = data.device   || '--';
      document.getElementById('version').textContent = data.version  || '--';
      document.getElementById('build').textContent   = data.build    || '--';
      document.getElementById('uptime').textContent  = formatearUptime(data.uptime_s  || 0);
      document.getElementById('ip').textContent      = data.ip       || '--';
      document.getElementById('heap').textContent    = formatearBytes(data.free_heap  || 0);

      var ind = document.getElementById('indicador');
      ind.textContent = 'Sistema operativo';
      ind.className   = 'indicador ok';
    })
    .catch(function() {
      var ind = document.getElementById('indicador');
      ind.textContent = 'Sin conexion';
      ind.className   = 'indicador error';
    });
}

document.addEventListener('DOMContentLoaded', function() {
  cargarEstado();
  setInterval(cargarEstado, 5000);
});
