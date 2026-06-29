'use strict';

const fs = require('fs');
const { CONFIG_PATH } = require('./loader');

/**
 * Escribe la config en disco de forma atómica (issue #18): escribe a un .tmp y
 * renombra, para no dejar nunca un apps.json a medias si el proceso muere.
 *
 * @param {{ settings: object, apps: object[] }} config
 * @param {string} [target=CONFIG_PATH]
 */
function writeConfigAtomic(config, target = CONFIG_PATH) {
  const tmp = `${target}.tmp`;
  const json = `${JSON.stringify({ settings: config.settings, apps: config.apps }, null, 2)}\n`;
  fs.writeFileSync(tmp, json, 'utf8');
  fs.renameSync(tmp, target); // rename atómico (reemplaza el existente)
}

module.exports = { writeConfigAtomic };
