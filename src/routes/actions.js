'use strict';

const express = require('express');

/**
 * Endpoints de acción sobre apps (issues #13, #14).
 *
 *   POST /apps/:id/start | stop | restart | pause | resume
 *   POST /apps/start-all | stop-all | restart-all | refresh-all
 *
 * Devuelven JSON con el estado resultante. La UI (EventSource) ya recibe los
 * cambios por SSE; la respuesta sirve de confirmación inmediata.
 */
function createActionsRouter() {
  const router = express.Router();

  const perApp = {
    start: (pm, id) => pm.start(id),
    stop: (pm, id) => pm.stop(id),
    restart: (pm, id) => pm.restart(id),
    pause: (pm, id) => pm.pause(id),
    resume: (pm, id) => pm.resume(id),
  };

  // --- Acciones globales (orden secuencial para no saturar la máquina) ---

  // Ejecuta fn(id) sobre una lista de ids de forma secuencial.
  async function sequential(ids, fn) {
    const results = [];
    for (const id of ids) {
      try {
        results.push({ id, result: await fn(id), ok: true });
      } catch (err) {
        results.push({ id, error: err.message, ok: false });
      }
    }
    return results;
  }

  router.post('/start-all', async (req, res) => {
    const pm = req.app.locals.pm;
    // No relanza apps pausadas (pausa = intención explícita del usuario).
    const ids = pm.getAll().filter((s) => s.status !== 'paused').map((s) => s.id);
    const results = await sequential(ids, (id) => pm.start(id));
    res.json({ ok: true, action: 'start-all', results, state: pm.getAll() });
  });

  router.post('/stop-all', async (req, res) => {
    const pm = req.app.locals.pm;
    const ids = pm.getAll().map((s) => s.id);
    const results = await sequential(ids, (id) => pm.stop(id));
    res.json({ ok: true, action: 'stop-all', results, state: pm.getAll() });
  });

  router.post('/restart-all', async (req, res) => {
    const pm = req.app.locals.pm;
    const ids = pm.getAll().filter((s) => s.status !== 'paused').map((s) => s.id);
    const results = await sequential(ids, (id) => pm.restart(id));
    res.json({ ok: true, action: 'restart-all', results, state: pm.getAll() });
  });

  router.post('/refresh-all', async (req, res) => {
    const monitor = req.app.locals.healthMonitor;
    if (monitor) await monitor.tick();
    res.json({ ok: true, action: 'refresh-all', state: req.app.locals.pm.getAll() });
  });

  // --- Acción por app ---
  router.post('/:id/:action', async (req, res) => {
    const { id, action } = req.params;
    const pm = req.app.locals.pm;
    const fn = perApp[action];

    if (!fn) {
      return res.status(400).json({ ok: false, error: `acción inválida: '${action}'` });
    }
    try {
      pm.getApp(id); // lanza si no existe
    } catch (err) {
      return res.status(404).json({ ok: false, error: err.message });
    }
    try {
      const result = await fn(pm, id);
      res.json({ ok: true, action, id, result, state: pm.getState(id) });
    } catch (err) {
      res.status(500).json({ ok: false, action, id, error: err.message });
    }
  });

  return router;
}

module.exports = createActionsRouter;
