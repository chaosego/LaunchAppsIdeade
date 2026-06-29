'use strict';

const express = require('express');

/**
 * Stream SSE de estado en vivo (issue #11): GET /events/status.
 * Emite un snapshot inicial y luego cambios de estado (pm) y resultados de
 * health (monitor). El frontend (M3) se suscribe con EventSource.
 */
function createEventsRouter() {
  const router = express.Router();

  router.get('/status', (req, res) => {
    const pm = req.app.locals.pm;
    const monitor = req.app.locals.healthMonitor;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('retry: 3000\n\n');

    const send = (event, data) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Snapshot inicial: estado + último health conocido por app.
    const snapshot = pm.getAll().map((s) => ({ ...s, health: monitor ? monitor.getLast(s.id) : null }));
    send('snapshot', snapshot);

    const onState = (payload) => send('state', payload);
    const onHealth = (payload) => send('health', payload);
    pm.on('state', onState);
    if (monitor) monitor.on('health', onHealth);

    // Keep-alive (comentario SSE) para evitar cierres por inactividad.
    const ka = setInterval(() => res.write(': keep-alive\n\n'), 25000);

    req.on('close', () => {
      clearInterval(ka);
      pm.removeListener('state', onState);
      if (monitor) monitor.removeListener('health', onHealth);
    });
  });

  return router;
}

module.exports = createEventsRouter;
