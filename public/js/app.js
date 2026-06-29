'use strict';

// Panel en vivo (M3). Se suscribe a /events/status (SSE) y cablea las acciones
// por app y globales contra los endpoints POST /apps/*.
(function () {
  var STATUS_CLASS = {
    stopped: 'status-stopped',
    starting: 'status-starting',
    running: 'status-running',
    unhealthy: 'status-unhealthy',
    paused: 'status-paused',
    crashed: 'status-crashed',
  };

  function row(id) {
    return document.querySelector('tr[data-app-id="' + CSS.escape(id) + '"]');
  }

  function applyState(s) {
    var tr = row(s.id);
    if (!tr) return;
    var el = tr.querySelector('[data-role="status"]');
    if (el) {
      el.textContent = s.status;
      el.className = 'status ' + (STATUS_CLASS[s.status] || 'status-stopped');
    }
  }

  function applyHealth(h) {
    var tr = row(h.id);
    if (!tr) return;
    var lat = tr.querySelector('[data-role="latency"]');
    if (lat) {
      if (h.latencyMs != null) {
        lat.textContent = h.latencyMs + ' ms';
        lat.className = h.hung ? 'warn' : 'muted';
      } else {
        lat.textContent = '—';
        lat.className = 'muted';
      }
    }
    if (h.reason) tr.title = h.reason;
    else tr.removeAttribute('title');
  }

  // ----- SSE -----
  function connect() {
    var conn = document.getElementById('conn');
    var es = new EventSource('/events/status');

    es.addEventListener('open', function () {
      if (conn) { conn.textContent = '● en vivo'; conn.className = 'conn conn-on'; }
    });
    es.addEventListener('error', function () {
      if (conn) { conn.textContent = '● reconectando…'; conn.className = 'conn conn-off'; }
    });
    es.addEventListener('snapshot', function (e) {
      JSON.parse(e.data).forEach(function (s) {
        applyState(s);
        if (s.health) applyHealth(s.health);
      });
    });
    es.addEventListener('state', function (e) { applyState(JSON.parse(e.data)); });
    es.addEventListener('health', function (e) { applyHealth(JSON.parse(e.data)); });
  }

  // ----- Acciones -----
  function post(url, btn) {
    if (btn) btn.disabled = true;
    return fetch(url, { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.state) {
          if (Array.isArray(data.state)) data.state.forEach(applyState);
          else applyState(data.state);
        }
        if (data && data.ok === false) console.warn('acción falló:', data.error);
      })
      .catch(function (err) { console.error(err); })
      .finally(function () { if (btn) btn.disabled = false; });
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn) return;

    if (btn.dataset.action) {
      var tr = btn.closest('tr[data-app-id]');
      if (tr) post('/apps/' + encodeURIComponent(tr.dataset.appId) + '/' + btn.dataset.action, btn);
    } else if (btn.dataset.global) {
      post('/apps/' + btn.dataset.global, btn);
    }
  });

  connect();
  console.log('[LaunchApps] panel en vivo');
})();
