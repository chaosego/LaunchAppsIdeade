'use strict';

const fs = require('fs');
const path = require('path');
const { validateConfig, DEFAULT_SETTINGS } = require('./schema');

const ROOT = path.resolve(__dirname, '..', '..');
const CONFIG_PATH = process.env.LAUNCHAPPS_CONFIG || path.join(ROOT, 'apps.json');
const EXAMPLE_PATH = path.join(ROOT, 'apps.example.json');

/**
 * Carga y valida apps.json. Nunca lanza: ante cualquier fallo devuelve una
 * config segura (settings por defecto, apps []) y acumula mensajes en `errors`
 * para mostrarlos en el panel (issue #2).
 *
 * @returns {{
 *   settings: object,
 *   apps: object[],
 *   errors: string[],
 *   path: string,
 *   ok: boolean,
 *   source: 'file' | 'missing' | 'parse-error'
 * }}
 */
function loadConfig() {
  let rawText;
  try {
    rawText = fs.readFileSync(CONFIG_PATH, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      return {
        settings: { ...DEFAULT_SETTINGS },
        apps: [],
        errors: [
          `No existe ${path.basename(CONFIG_PATH)}. Copiá apps.example.json a apps.json y editalo.`,
        ],
        path: CONFIG_PATH,
        ok: false,
        source: 'missing',
      };
    }
    return {
      settings: { ...DEFAULT_SETTINGS },
      apps: [],
      errors: [`No se pudo leer ${CONFIG_PATH}: ${err.message}`],
      path: CONFIG_PATH,
      ok: false,
      source: 'parse-error',
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    return {
      settings: { ...DEFAULT_SETTINGS },
      apps: [],
      errors: [`apps.json no es JSON válido: ${err.message}`],
      path: CONFIG_PATH,
      ok: false,
      source: 'parse-error',
    };
  }

  const { value, errors } = validateConfig(parsed);
  return {
    settings: value.settings,
    apps: value.apps,
    errors,
    path: CONFIG_PATH,
    ok: errors.length === 0,
    source: 'file',
  };
}

module.exports = { loadConfig, CONFIG_PATH, EXAMPLE_PATH };
