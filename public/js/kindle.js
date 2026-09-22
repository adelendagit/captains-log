function first(obj, paths) {
  for (var i = 0; i < paths.length; i++) {
    var value = obj;
    var parts = paths[i].split('.');
    for (var j = 0; j < parts.length && value != null; j++) value = value[parts[j]];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function number(value) {
  if (value === null || value === undefined || value === '') return null;
  var n = Number(value);
  return isFinite(n) ? n : null;
}

function render(state) {
  var telemetry = state.telemetry || {};
  var journey = state.journey || state.currentJourney || {};
  var logbook = state.logbook || {};
  var point = telemetry.position || telemetry.latest || journey.position || state.position || {};

  var vesselState = String(state.state || logbook.status || (journey.active ? 'underway' : 'unknown'));
  var place = first(state, ['location.name', 'current.name', 'logbook.current.name', 'logbook.from.name']);
  var lat = number(first(point, ['lat', 'latitude', 'coordinate.latitude']));
  var lng = number(first(point, ['lng', 'lon', 'longitude', 'coordinate.longitude']));
  var speed = number(first(point, ['speedKts', 'speedKnots', 'speed_knots', 'speed']));
  var course = number(first(point, ['course', 'heading']));
  var timestamp = first(point, ['timestamp', 'recordedAt', 'createdAt']);
  var historical = telemetry.status === 'last-known';
  var showMotion = vesselState === 'underway' && telemetry.status === 'active';

  document.getElementById('status').textContent = vesselState.replace(/_/g, ' ');
  document.getElementById('place').textContent = place || (journey.active ? 'Underway' : 'Last recorded position');
  document.getElementById('coords').textContent = lat !== null && lng !== null ? Math.abs(lat).toFixed(5) + (lat < 0 ? '° S\n' : '° N\n') + Math.abs(lng).toFixed(5) + (lng < 0 ? '° W' : '° E') : 'No GPS position available';
  document.getElementById('speed').textContent = showMotion && speed !== null ? speed.toFixed(1) + ' kt' : '—';
  document.getElementById('course').textContent = showMotion && course !== null ? Math.round(course) + '°' : '—';
  document.getElementById('freshness').textContent = historical === true ? 'Last recorded GPS fix' : (telemetry.status === 'active' ? 'Journey GPS fix' : 'No GPS fix');
  document.getElementById('updated').textContent = timestamp ? new Date(timestamp).toLocaleString() : 'Unknown';
  document.getElementById('display').style.display = 'block';
  document.getElementById('error').style.display = 'none';
}

function showError() {
  document.getElementById('error').style.display = 'block';
}

function refresh() {
  // XMLHttpRequest also works in browsers without fetch or Promises.
  var request = new XMLHttpRequest();
  request.open('GET', '/api/vessel-state?_=' + new Date().getTime(), true);
  request.setRequestHeader('Accept', 'application/json');
  request.timeout = 30000;
  request.onload = function () {
    try {
      if (request.status < 200 || request.status >= 300) throw new Error('HTTP ' + request.status);
      render(JSON.parse(request.responseText));
    } catch (error) {
      showError();
    }
  };
  request.onerror = showError;
  request.ontimeout = showError;
  request.send();
}

refresh();
setInterval(refresh, 60000);

function kindleSessionToken() {
  var match = location.search.match(/[?&]session=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

function exitDisplay() {
  var token = kindleSessionToken();
  if (!token) return;
  var button = document.getElementById('exit-display');
  if (button) {
    button.disabled = true;
    button.textContent = 'Exiting…';
  }
  var request = new XMLHttpRequest();
  request.open('POST', '/api/kindle-display/stop?token=' + encodeURIComponent(token), true);
  request.setRequestHeader('Accept', 'application/json');
  request.send('{}');
}

var exitButton = document.getElementById('exit-display');
if (exitButton) exitButton.onclick = exitDisplay;
