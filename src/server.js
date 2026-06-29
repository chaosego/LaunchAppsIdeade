'use strict';

const path = require('path');
const express = require('express');
const { loadConfig } = require('./config/loader');
const { ProcessManager } = require('./services/processManager');
const { HealthMonitor } = require('./services/healthMonitor');
const createIndexRouter = require('./routes/index');
const createEventsRouter = require('./routes/events');

const ROOT = path.resolve(__dirname, '..');

function createApp() {
  const app = express();

  // Config cargada al arrancar. En M5 se añadirá recarga en caliente.
  app.locals.config = loadConfig();

  // Gestor de procesos (M1). Las rutas de acción se cablean en M3.
  app.locals.pm = new ProcessManager(app.locals.config.apps);
  app.locals.pm.on('warn', ({ id, message }) => console.warn(`[pm:${id}] ${message}`));
  app.locals.pm.on('state', ({ id, prev, status }) => console.log(`[pm:${id}] ${prev} -> ${status}`));

  // Monitor de health (M2): polling periódico + transiciones running<->unhealthy.
  app.locals.healthMonitor = new HealthMonitor(app.locals.pm, () => app.locals.config.settings);

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use('/static', express.static(path.join(ROOT, 'public')));

  app.use('/', createIndexRouter());
  app.use('/events', createEventsRouter());

  // 404 simple
  app.use((req, res) => {
    res.status(404).send('Not found');
  });

  return app;
}

function start() {
  const app = createApp();
  const { settings, apps, errors, source } = app.locals.config;
  const port = settings.port;

  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`[LaunchApps] panel en http://localhost:${port}`);
    console.log(`[LaunchApps] config: ${source} — ${apps.length} app(s), ${errors.length} aviso(s)`);
    if (errors.length) {
      for (const e of errors) console.warn(`[config] ${e}`);
    }
    app.locals.healthMonitor.start();
  });
}

if (require.main === module) {
  start();
}

module.exports = { createApp, start };
