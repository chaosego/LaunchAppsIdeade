'use strict';

const path = require('path');
const express = require('express');
const { loadConfig } = require('./config/loader');
const createIndexRouter = require('./routes/index');

const ROOT = path.resolve(__dirname, '..');

function createApp() {
  const app = express();

  // Config cargada al arrancar. En M5 se añadirá recarga en caliente.
  app.locals.config = loadConfig();

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use('/static', express.static(path.join(ROOT, 'public')));

  app.use('/', createIndexRouter());

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
  });
}

if (require.main === module) {
  start();
}

module.exports = { createApp, start };
