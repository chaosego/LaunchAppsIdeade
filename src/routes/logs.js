'use strict';

const express = require('express');

/**
 * Stream SSE de logs de una app (issue #20): GET /apps/:id/logs.
 * Envía el historial en buffer y luego las líneas en vivo del ProcessManager.
 */
function createLogsRouter() {
  const router = express.Router();

  router.get('/:id/logs', (req, res) => {
    const { id } = req.params;
    const pm = req.app.locals.pm;
    const logStore = req.app.locals.logStore;

    try {
      pm.getApp(id);
    } catch (err) {
      return res.status(404).json({ ok: false, error: err.message });
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('retry: 3000\n\n');

    const send = (entry) => {
      res.write('event: log\n');
      res.write(`data: ${JSON.stringify(entry)}\n\n`);
    };

    // Historial primero.
    for (const entry of logStore.getHistory(id)) send(entry);

    // En vivo: filtra por app.
    const onLog = ({ id: lid, stream, chunk }) => {
      if (lid !== id) return;
      String(chunk).split(/\r?\n/).filter((l) => l.length).forEach((line) =>
        send({ stream, line, at: new Date().toISOString() }));
    };
    pm.on('log', onLog);

    const ka = setInterval(() => res.write(': keep-alive\n\n'), 25000);
    req.on('close', () => {
      clearInterval(ka);
      pm.removeListener('log', onLog);
    });
  });

  return router;
}

module.exports = createLogsRouter;
