'use strict';

const path = require('path');
const express = require('express');
const { loadConfig } = require('./config/loader');
const { ProcessManager } = require('./services/processManager');
const { HealthMonitor } = require('./services/healthMonitor');
const { Watchdog } = require('./services/watchdog');
const { runAutostart } = require('./services/autostart');
const { reconcileExternal } = require('./services/reconcile');
const { adoptOrphans } = require('./services/adopt');
const { PidStore } = require('./services/pidStore');
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

  // Persistencia de PIDs para re-adopción de huérfanos (#24).
  app.locals.pidStore = new PidStore({ dir: path.join(ROOT, 'data') });

  // Gestor de procesos (M1). Las rutas de acción se cablean en M3.
  app.locals.pm = new ProcessManager(app.locals.config.apps, { pidStore: app.locals.pidStore });
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

  // Manejo global de errores de rutas: nunca tumbar el panel (issue #22).
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('[error]', err.message);
    if (res.headersSent) return;
    res.status(500).json({ ok: false, error: err.message });
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

    bootstrap(app);
  });
}

/**
 * Arranque post-listen (M6): detecta instancias externas/huérfanas y luego
 * autostart, evitando relanzar apps que ya están accesibles.
 */
async function bootstrap(app) {
  const { pm, pidStore, eventLog, config } = app.locals;
  const apps = config.apps;
  const timeoutMs = config.settings.healthTimeoutMs;

  // 1) Re-adoptar procesos huérfanos vivos de una ejecución anterior (#24).
  let adoptedIds = [];
  try {
    const r = await adoptOrphans(pm, apps, pidStore, {
      timeoutMs,
      onAdopt: (id, method) => {
        console.log(`[LaunchApps] adoptada ${id} (verificada por ${method})`);
        if (eventLog) eventLog.record(id, 'info', 'adopted', `proceso huérfano re-adoptado (verificado por ${method}); sus logs no se recapturan hasta un restart`);
      },
      onStale: (id) => console.log(`[LaunchApps] PID guardado de ${id} ya no existe (limpiado)`),
      onUnverified: (id, pid) => {
        console.warn(`[LaunchApps] ${id}: PID ${pid} vivo pero NO verificado, no se adopta`);
        if (eventLog) eventLog.record(id, 'warn', 'adopt-unverified', `PID ${pid} vivo pero no se pudo verificar su identidad; no se adopta`);
      },
    });
    adoptedIds = r.adopted;
  } catch (err) {
    console.error('[LaunchApps] adopción falló:', err.message);
  }

  // 2) Detectar instancias externas (sin PID guardado) accesibles por health.
  let externalUp = [];
  try {
    externalUp = await reconcileExternal(pm, apps, {
      timeoutMs,
      onExternal: (id, message) => {
        console.warn(`[LaunchApps] huérfana/externa: ${id} — ${message}`);
        if (eventLog) eventLog.record(id, 'warn', 'external', message);
      },
    });
  } catch (err) {
    console.error('[LaunchApps] reconcile falló:', err.message);
  }

  // 3) Autostart, evitando relanzar lo adoptado o ya accesible.
  runAutostart(pm, apps, {
    skip: adoptedIds.concat(externalUp),
    log: (m) => console.log(`[LaunchApps] ${m}`),
  });
}

if (require.main === module) {
  // El panel no debe morir por un error no capturado (issue #22).
  process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));
  process.on('unhandledRejection', (reason) => console.error('[unhandledRejection]', reason));
  start();
}

module.exports = { createApp, start };
