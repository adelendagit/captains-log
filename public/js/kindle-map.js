(function () {
  var zoom = 'local';
  var sessionMatch = location.search.match(/[?&]session=([^&]+)/);
  var sessionToken = sessionMatch ? decodeURIComponent(sessionMatch[1]) : '';
  if (sessionToken) {
    var links = document.getElementsByTagName('a');
    for (var linkIndex = 0; linkIndex < links.length; linkIndex++) {
      if (links[linkIndex].getAttribute('href') === '/kindle.html') {
        links[linkIndex].setAttribute('href', '/kindle.html?session=' + encodeURIComponent(sessionToken));
      }
    }
  }
  var point = null;
  var map = document.getElementById('map');
  var error = document.getElementById('error');
  function valid(p) {
    return p && typeof p.lat === 'number' && typeof p.lng === 'number' &&
      isFinite(p.lat) && isFinite(p.lng) && Math.abs(p.lat) <= 85 && Math.abs(p.lng) <= 180;
  }
  function showError() { error.style.display = 'block'; }
  function draw() {
    if (!point) return;
    map.src = '/api/kindle-map.svg?lat=' + point.lat.toFixed(5) + '&lng=' + point.lng.toFixed(5) + '&zoom=' + zoom;
  }
  map.onload = function () { map.style.display = 'block'; error.style.display = 'none'; };
  map.onerror = function () { map.style.display = 'none'; showError(); };
  document.getElementById('local').onclick = function () { setZoom('local'); };
  document.getElementById('wide').onclick = function () { setZoom('wide'); };
  document.getElementById('exit-display').onclick = function () {
    var match = location.search.match(/[?&]session=([^&]+)/);
    if (!match) return;
    var token = decodeURIComponent(match[1]);
    var button = document.getElementById('exit-display');
    button.disabled = true;
    button.textContent = 'Exiting…';
    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/kindle-display/stop?token=' + encodeURIComponent(token), true);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.send('{}');
  };
  function setZoom(value) {
    zoom = value;
    document.getElementById('local').disabled = value === 'local';
    document.getElementById('wide').disabled = value === 'wide';
    draw();
  }
  function refresh() {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/vessel-state?_=' + new Date().getTime(), true);
    xhr.timeout = 30000;
    xhr.onload = function () {
      try {
        if (xhr.status !== 200) throw new Error('Position request failed');
        var state = JSON.parse(xhr.responseText);
        var telemetry = state.telemetry || {};
        var current = (state.logbook || {}).current || {};
        point = valid(telemetry.position) ? telemetry.position : (valid(current) ? current : null);
        document.getElementById('place').textContent = state.state === 'underway' ? 'Underway' : (current.name || 'Recorded position');
        document.getElementById('position').textContent = !point ? 'No mapped position available' :
          (point === current ? 'Recorded stop' : (telemetry.status === 'active' ? 'Journey GPS fix' : 'Last recorded GPS fix'));
        document.getElementById('updated').textContent = point && point.timestamp ? 'Position: ' + new Date(point.timestamp).toLocaleString() : '';
        error.style.display = 'none';
        if (point) draw();
        else map.style.display = 'none';
      } catch (e) { showError(); }
    };
    xhr.onerror = showError;
    xhr.ontimeout = showError;
    xhr.send();
  }
  refresh();
  setInterval(refresh, 60000);
})();
