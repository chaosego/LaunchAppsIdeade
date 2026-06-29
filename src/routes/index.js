'use strict';

const express = require('express');

/**
 * Rutas del panel. En M0 solo el dashboard (placeholder con la lista de apps
 * cargadas de la config). Las acciones start/stop/restart se añaden en M3.
 */
function createIndexRouter() {
  const router = express.Router();

  router.get('/', (req, res) => {
    const config = req.app.locals.config;
    res.render('dashboard', {
      title: 'LaunchApps',
      apps: config.apps,
      settings: config.settings,
      configErrors: config.errors,
      configSource: config.source,
    });
  });

  // Healthcheck del propio panel
  router.get('/healthz', (req, res) => {
    res.json({ ok: true, apps: req.app.locals.config.apps.length });
  });

  return router;
}

module.exports = createIndexRouter;
