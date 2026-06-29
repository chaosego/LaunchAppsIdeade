'use strict';

const path = require('path');
const express = require('express');
const { loadConfig } = require('./config/loader');
const { ProcessManager } = require('./services/processManager');
const { HealthMonitor } = require('./services/healthMonitor');
const { Watchdog } = require('./services/watchdog');
const { runAutostart } = require('./services/autostart');
const { LogStore } = require('./services/logStore');
const { EventLog } = require('./services/eventLog');
const { ConfigManager } = require('./config/manager');
const createIndexRouter = require('./routes/index');
const createEventsRouter = require('./routes/events');
const createActionsRouter = require('./routes/actions');
const createConfigRouter = require('./routes/config');
const createLogsRouter = require('./routes/logs');

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

  // Watchdog (M4): relanza apps caídas/colgadas según config por app.
  app.locals.watchdog = new Watchdog(
    app.locals.pm,
    () => app.locals.config.settings,
    () => app.locals.config.apps
  );
  app.locals.watchdog.on('event', ({ type, id, message }) => console.log(`[watchdog:${id}] ${type}: ${message}`));

  // Logs en vivo (M5 #20): captura stdout/stderr a buffer + archivo.
  app.locals.logStore = new LogStore(app.locals.pm, { dir: path.join(ROOT, 'logs') });

  // Log de eventos (M5 #21): persiste caídas/restarts/recargas.
  app.locals.eventLog = new EventLog(app.locals.pm, { dir: path.join(ROOT, 'data') });
  app.locals.eventLog.attachWatchdog(app.locals.watchdog);

  // Gestor de config en caliente (M5 #18, #19).
  app.locals.configManager = new ConfigManager({
    getConfig: () => app.locals.config,
    setConfig: (c) => { app.locals.config = c; },
    pm: app.locals.pm,
    getWatchdog: () => app.locals.watchdog,
    getHealthMonitor: () => app.locals.healthMonitor,
  });
  app.locals.eventLog.attachConfigManager(app.locals.configManager);

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use('/static', express.static(path.join(ROOT, 'public')));

  app.use('/', createIndexRouter());
  app.use('/events', createEventsRouter());
  app.use('/apps', createLogsRouter());
  app.use('/apps', createActionsRouter());
  app.use('/config', createConfigRouter());

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
    app.locals.watchdog.start();
    app.locals.configManager.watch(); // recarga en caliente al editar apps.json

    // Autostart (M4): lanza apps marcadas, escalonadas.
    runAutostart(app.locals.pm, apps, { log: (m) => console.log(`[LaunchApps] ${m}`) });
  });
}

if (require.main === module) {
  start();
}

module.exports = { createApp, start };
