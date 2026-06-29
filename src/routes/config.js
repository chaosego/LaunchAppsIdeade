'use strict';

const express = require('express');

/**
 * CRUD de apps desde la UI (issue #18). Cada cambio se valida con el mismo
 * schema y se persiste atómicamente vía ConfigManager.saveApps (que además
 * lo aplica en caliente sin matar procesos vivos).
 *
 *   GET    /config/apps          lista settings + apps
 *   POST   /config/apps          alta (body = objeto app)
 *   PUT    /config/apps/:id       edición (body = objeto app)
 *   DELETE /config/apps/:id       borrado (para el proceso si está vivo)
 */
function createConfigRouter() {
  const router = express.Router();

  router.get('/apps', (req, res) => {
    const c = req.app.locals.config;
    res.json({ settings: c.settings, apps: c.apps });
  });

  router.post('/apps', (req, res) => {
    const cm = req.app.locals.configManager;
    const apps = req.app.locals.config.apps.slice();
    const incoming = req.body || {};
    if (!incoming.id) return res.status(400).json({ ok: false, errors: ["'id' es obligatorio"] });
    if (apps.some((a) => a.id === incoming.id)) {
      return res.status(400).json({ ok: false, errors: [`ya existe una app con id '${incoming.id}'`] });
    }
    apps.push(incoming);
    const result = cm.saveApps(apps);
    res.status(result.ok ? 201 : 400).json(result);
  });

  router.put('/apps/:id', (req, res) => {
    const cm = req.app.locals.configManager;
    const { id } = req.params;
    const apps = req.app.locals.config.apps.slice();
    const idx = apps.findIndex((a) => a.id === id);
    if (idx === -1) return res.status(404).json({ ok: false, errors: [`app '${id}' no existe`] });

    const incoming = req.body || {};
    const newId = incoming.id || id;
    if (newId !== id && apps.some((a) => a.id === newId)) {
      return res.status(400).json({ ok: false, errors: [`ya existe una app con id '${newId}'`] });
    }
    apps[idx] = incoming;
    const result = cm.saveApps(apps);
    res.status(result.ok ? 200 : 400).json(result);
  });

  router.delete('/apps/:id', async (req, res) => {
    const cm = req.app.locals.configManager;
    const pm = req.app.locals.pm;
    const { id } = req.params;
    const apps = req.app.locals.config.apps.slice();
    const idx = apps.findIndex((a) => a.id === id);
    if (idx === -1) return res.status(404).json({ ok: false, errors: [`app '${id}' no existe`] });

    try {
      await pm.stop(id); // para el proceso si está vivo antes de quitarla
    } catch (_) { /* noop */ }

    apps.splice(idx, 1);
    const result = cm.saveApps(apps);
    res.status(result.ok ? 200 : 400).json(result);
  });

  return router;
}

module.exports = createConfigRouter;
