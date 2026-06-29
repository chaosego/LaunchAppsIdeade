'use strict';

// Panel en vivo (M3) + CRUD, logs y eventos (M5).
(function () {
  var STATUS_CLASS = {
    stopped: 'status-stopped', starting: 'status-starting', running: 'status-running',
    unhealthy: 'status-unhealthy', paused: 'status-paused', crashed: 'status-crashed',
  };
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  function row(id) { return document.querySelector('tr[data-app-id="' + CSS.escape(id) + '"]'); }

  // ---------- Estado en vivo ----------
  function applyState(s) {
    var tr = row(s.id); if (!tr) return;
    var el = tr.querySelector('[data-role="status"]');
    if (el) {
      el.textContent = s.status;
      el.className = 'status ' + (STATUS_CLASS[s.status] || 'status-stopped');
      var td = el.parentNode;
      var mark = td.querySelector('.adopted-mark');
      if (s.adopted) {
        if (!mark) {
          mark = document.createElement('span');
          mark.className = 'adopted-mark';
          mark.textContent = ' ⚓';
          mark.title = 'Proceso adoptado tras reinicio del panel. Sus logs no se recapturan hasta un restart.';
          el.insertAdjacentElement('afterend', mark);
        }
      } else if (mark) { mark.remove(); }
    }
  }
  function applyHealth(h) {
    var tr = row(h.id); if (!tr) return;
    var lat = tr.querySelector('[data-role="latency"]');
    if (lat) {
      if (h.latencyMs != null) { lat.textContent = h.latencyMs + ' ms'; lat.className = h.hung ? 'warn' : 'muted'; }
      else { lat.textContent = '—'; lat.className = 'muted'; }
    }
    if (h.reason) tr.title = h.reason; else tr.removeAttribute('title');
  }

  // ---------- Eventos + toasts ----------
  var LEVEL_ICON = { info: 'ℹ', warn: '⚠', error: '✖' };
  function renderEvent(ev, prepend) {
    var list = $('#events-list'); if (!list) return;
    var li = document.createElement('li');
    li.className = 'ev ev-' + ev.level;
    var when = new Date(ev.at).toLocaleTimeString();
    li.innerHTML = '<span class="ev-icon">' + (LEVEL_ICON[ev.level] || '•') + '</span>' +
      '<span class="ev-msg">' + (ev.id ? '<b>' + ev.id + '</b> ' : '') + escapeHtml(ev.message) + '</span>' +
      '<span class="ev-time muted">' + when + '</span>';
    if (prepend) list.insertBefore(li, list.firstChild); else list.appendChild(li);
  }
  function toast(ev) {
    var box = $('#toasts'); if (!box) return;
    var t = document.createElement('div');
    t.className = 'toast toast-' + ev.level;
    t.textContent = (ev.id ? ev.id + ': ' : '') + ev.message;
    box.appendChild(t);
    setTimeout(function () { t.classList.add('show'); }, 10);
    setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.remove(); }, 300); }, 5000);
  }
  function loadEvents() {
    fetch('/events/log?limit=50').then(function (r) { return r.json(); }).then(function (d) {
      var list = $('#events-list'); if (list) list.innerHTML = '';
      (d.events || []).forEach(function (ev) { renderEvent(ev, true); });
      if (!d.events || !d.events.length) list.innerHTML = '<li class="muted">sin eventos</li>';
    }).catch(function () {});
  }

  // ---------- SSE ----------
  function connect() {
    var conn = $('#conn');
    var es = new EventSource('/events/status');
    es.addEventListener('open', function () { if (conn) { conn.textContent = '● en vivo'; conn.className = 'conn conn-on'; } });
    es.addEventListener('error', function () { if (conn) { conn.textContent = '● reconectando…'; conn.className = 'conn conn-off'; } });
    es.addEventListener('snapshot', function (e) {
      JSON.parse(e.data).forEach(function (s) { applyState(s); if (s.health) applyHealth(s.health); });
    });
    es.addEventListener('state', function (e) { applyState(JSON.parse(e.data)); });
    es.addEventListener('health', function (e) { applyHealth(JSON.parse(e.data)); });
    es.addEventListener('appevent', function (e) {
      var ev = JSON.parse(e.data);
      var list = $('#events-list');
      if (list && list.children.length === 1 && /sin eventos|cargando/.test(list.textContent)) list.innerHTML = '';
      renderEvent(ev, true);
      if (ev.level !== 'info') toast(ev);
    });
  }

  // ---------- Acciones ----------
  function post(url, btn) {
    if (btn) btn.disabled = true;
    return fetch(url, { method: 'POST' }).then(function (r) { return r.json(); }).then(function (data) {
      if (data && data.state) { if (Array.isArray(data.state)) data.state.forEach(applyState); else applyState(data.state); }
      if (data && data.ok === false) console.warn('acción falló:', data.error);
    }).catch(function (err) { console.error(err); }).finally(function () { if (btn) btn.disabled = false; });
  }

  // ---------- CRUD ----------
  function openForm(app) {
    var f = $('#app-form'); f.reset(); $('#app-form-error').classList.add('hidden');
    $('#modal-app-title').textContent = app ? 'Editar app' : 'Añadir app';
    f._editId.value = app ? app.id : '';
    if (app) {
      f.id.value = app.id; f.name.value = app.name; f.type.value = app.type || 'custom';
      f.cwd.value = app.cwd || ''; f.command.value = app.command || '';
      f.args.value = (app.args || []).join(' '); f.port.value = app.port || '';
      f.autostart.checked = !!app.autostart;
      f.health.value = app.health && Object.keys(app.health).length ? JSON.stringify(app.health) : '';
      f.watchdog.value = app.watchdog ? JSON.stringify(app.watchdog) : '';
    }
    $('#modal-app').classList.remove('hidden');
  }
  function buildApp(f) {
    var app = {
      id: f.id.value.trim(), name: f.name.value.trim(), type: f.type.value,
      cwd: f.cwd.value.trim(), command: f.command.value.trim(),
      args: f.args.value.trim() ? f.args.value.trim().split(/\s+/) : [],
      autostart: f.autostart.checked,
    };
    if (f.port.value) app.port = parseInt(f.port.value, 10);
    if (f.health.value.trim()) app.health = JSON.parse(f.health.value);
    if (f.watchdog.value.trim()) app.watchdog = JSON.parse(f.watchdog.value);
    return app;
  }
  function submitForm(e) {
    e.preventDefault();
    var f = e.target, errBox = $('#app-form-error');
    var app;
    try { app = buildApp(f); } catch (err) { return showFormError('JSON inválido en health/watchdog: ' + err.message); }
    var editId = f._editId.value;
    var url = editId ? '/config/apps/' + encodeURIComponent(editId) : '/config/apps';
    fetch(url, { method: editId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(app) })
      .then(function (r) { return r.json().then(function (d) { return { code: r.status, d: d }; }); })
      .then(function (res) {
        if (res.d.ok) { location.reload(); }
        else showFormError((res.d.errors || ['error']).join('; '));
      }).catch(function (err) { showFormError(err.message); });
  }
  function showFormError(msg) { var b = $('#app-form-error'); b.textContent = msg; b.classList.remove('hidden'); }

  function delApp(id) {
    if (!confirm('¿Eliminar la app "' + id + '"? Se detendrá si está corriendo.')) return;
    fetch('/config/apps/' + encodeURIComponent(id), { method: 'DELETE' })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d.ok) location.reload(); else alert((d.errors || ['error']).join('; ')); });
  }

  // ---------- Logs ----------
  var logsES = null;
  function openLogs(id) {
    $('#modal-logs-title').textContent = 'Logs — ' + id;
    var out = $('#logs-output'); out.textContent = '';
    var tr = row(id);
    if (tr && tr.querySelector('.adopted-mark')) {
      var note = document.createElement('div');
      note.className = 'log-line log-system';
      note.textContent = '⚓ App adoptada: los logs previos no se capturaron. Reiniciala desde el panel para capturar su salida.';
      out.appendChild(note);
    }
    $('#modal-logs').classList.remove('hidden');
    logsES = new EventSource('/apps/' + encodeURIComponent(id) + '/logs');
    logsES.addEventListener('log', function (e) {
      var entry = JSON.parse(e.data);
      var line = document.createElement('div');
      line.className = 'log-line log-' + entry.stream;
      line.textContent = entry.line;
      out.appendChild(line);
      out.scrollTop = out.scrollHeight;
    });
  }
  function closeLogs() { if (logsES) { logsES.close(); logsES = null; } $('#modal-logs').classList.add('hidden'); }

  // ---------- Wiring ----------
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('button'); if (!btn) return;
    var tr = btn.closest('tr[data-app-id]');
    var id = tr ? tr.dataset.appId : null;

    if (btn.dataset.action && id) return post('/apps/' + encodeURIComponent(id) + '/' + btn.dataset.action, btn);
    if (btn.dataset.global) return post('/apps/' + btn.dataset.global, btn);
    if (btn.id === 'btn-add') return openForm(null);
    if (btn.hasAttribute('data-delete') && id) return delApp(id);
    if (btn.hasAttribute('data-logs') && id) return openLogs(id);
    if (btn.hasAttribute('data-edit') && id) {
      return fetch('/config/apps').then(function (r) { return r.json(); }).then(function (d) {
        var app = (d.apps || []).find(function (a) { return a.id === id; });
        if (app) openForm(app);
      });
    }
    if (btn.hasAttribute('data-close')) {
      btn.closest('#modal-logs') ? closeLogs() : btn.closest('.modal').classList.add('hidden');
    }
  });
  document.addEventListener('submit', function (e) { if (e.target.id === 'app-form') submitForm(e); });

  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  connect();
  loadEvents();
  console.log('[LaunchApps] panel en vivo');
})();
