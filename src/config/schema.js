'use strict';

/**
 * Validación del schema de apps.json sin dependencias externas.
 * No lanza excepciones: devuelve { value, errors }.
 * El panel nunca debe crashear por un JSON inválido (issue #2).
 */

const APP_TYPES = ['next', 'node', 'sails', 'custom'];

const DEFAULT_SETTINGS = {
  port: 4000,
  watchdogDefaultIntervalMinutes: 150,
  healthTimeoutMs: 5000,
  statusPollIntervalMs: 10000,
};

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isPositiveInt(v) {
  return Number.isInteger(v) && v > 0;
}

/**
 * Normaliza y valida settings, rellenando defaults.
 * @returns {{ settings: object, errors: string[] }}
 */
function validateSettings(raw) {
  const errors = [];
  const settings = { ...DEFAULT_SETTINGS };

  if (raw !== undefined && !isObject(raw)) {
    errors.push('settings: debe ser un objeto. Se usan los valores por defecto.');
    return { settings, errors };
  }

  const src = raw || {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (src[key] === undefined) continue;
    if (!isPositiveInt(src[key])) {
      errors.push(`settings.${key}: debe ser un entero positivo. Se usa el default (${DEFAULT_SETTINGS[key]}).`);
      continue;
    }
    settings[key] = src[key];
  }

  return { settings, errors };
}

/**
 * Valida un bloque health opcional.
 */
function validateHealth(raw, appLabel) {
  const errors = [];
  if (raw === undefined) return { health: {}, errors };
  if (!isObject(raw)) {
    errors.push(`${appLabel}: health debe ser un objeto.`);
    return { health: {}, errors };
  }

  const health = {};

  if (raw.tcp !== undefined) {
    if (isObject(raw.tcp) && isPositiveInt(raw.tcp.port)) {
      health.tcp = { port: raw.tcp.port };
    } else {
      errors.push(`${appLabel}: health.tcp.port debe ser un entero positivo.`);
    }
  }

  if (raw.http !== undefined) {
    if (isObject(raw.http) && typeof raw.http.url === 'string' && raw.http.url.trim()) {
      health.http = {
        url: raw.http.url.trim(),
        expectStatus: isPositiveInt(raw.http.expectStatus) ? raw.http.expectStatus : 200,
      };
    } else {
      errors.push(`${appLabel}: health.http.url es obligatorio (string) si se define health.http.`);
    }
  }

  if (raw.command !== undefined) {
    if (isObject(raw.command) && typeof raw.command.run === 'string' && raw.command.run.trim()) {
      health.command = {
        run: raw.command.run.trim(),
        timeoutMs: isPositiveInt(raw.command.timeoutMs) ? raw.command.timeoutMs : 4000,
      };
    } else {
      errors.push(`${appLabel}: health.command.run es obligatorio (string) si se define health.command.`);
    }
  }

  if (raw.latencyWarnMs !== undefined) {
    if (isPositiveInt(raw.latencyWarnMs)) {
      health.latencyWarnMs = raw.latencyWarnMs;
    } else {
      errors.push(`${appLabel}: health.latencyWarnMs debe ser un entero positivo.`);
    }
  }

  return { health, errors };
}

/**
 * Valida un bloque watchdog opcional.
 */
function validateWatchdog(raw, appLabel, defaultInterval) {
  const errors = [];
  const watchdog = {
    enabled: false,
    intervalMinutes: defaultInterval,
    restartOnUnhealthy: true,
  };
  if (raw === undefined) return { watchdog, errors };
  if (!isObject(raw)) {
    errors.push(`${appLabel}: watchdog debe ser un objeto.`);
    return { watchdog, errors };
  }

  if (raw.enabled !== undefined) {
    if (typeof raw.enabled === 'boolean') watchdog.enabled = raw.enabled;
    else errors.push(`${appLabel}: watchdog.enabled debe ser booleano.`);
  }
  if (raw.intervalMinutes !== undefined) {
    if (isPositiveInt(raw.intervalMinutes)) watchdog.intervalMinutes = raw.intervalMinutes;
    else errors.push(`${appLabel}: watchdog.intervalMinutes debe ser un entero positivo.`);
  }
  if (raw.restartOnUnhealthy !== undefined) {
    if (typeof raw.restartOnUnhealthy === 'boolean') watchdog.restartOnUnhealthy = raw.restartOnUnhealthy;
    else errors.push(`${appLabel}: watchdog.restartOnUnhealthy debe ser booleano.`);
  }

  return { watchdog, errors };
}

/**
 * Valida una app individual.
 */
function validateApp(raw, index, defaultInterval) {
  const errors = [];
  const label = `apps[${index}]`;

  if (!isObject(raw)) {
    errors.push(`${label}: cada app debe ser un objeto.`);
    return { app: null, errors };
  }

  const idLabel = typeof raw.id === 'string' && raw.id.trim() ? `app '${raw.id}'` : label;

  // Requeridos
  if (typeof raw.id !== 'string' || !raw.id.trim()) {
    errors.push(`${label}: 'id' es obligatorio (string no vacío).`);
  }
  if (typeof raw.name !== 'string' || !raw.name.trim()) {
    errors.push(`${idLabel}: 'name' es obligatorio (string no vacío).`);
  }
  if (typeof raw.command !== 'string' || !raw.command.trim()) {
    errors.push(`${idLabel}: 'command' es obligatorio (string no vacío).`);
  }
  if (typeof raw.cwd !== 'string' || !raw.cwd.trim()) {
    errors.push(`${idLabel}: 'cwd' es obligatorio (ruta del directorio de trabajo).`);
  }

  // Opcionales con validación
  const type = APP_TYPES.includes(raw.type) ? raw.type : 'custom';
  if (raw.type !== undefined && !APP_TYPES.includes(raw.type)) {
    errors.push(`${idLabel}: 'type' inválido ('${raw.type}'). Permitidos: ${APP_TYPES.join(', ')}. Se usa 'custom'.`);
  }

  let args = [];
  if (raw.args !== undefined) {
    if (Array.isArray(raw.args) && raw.args.every((a) => typeof a === 'string')) {
      args = raw.args;
    } else {
      errors.push(`${idLabel}: 'args' debe ser un array de strings.`);
    }
  }

  let env = {};
  if (raw.env !== undefined) {
    if (isObject(raw.env) && Object.values(raw.env).every((v) => typeof v === 'string')) {
      env = raw.env;
    } else {
      errors.push(`${idLabel}: 'env' debe ser un objeto de strings.`);
    }
  }

  let port;
  if (raw.port !== undefined) {
    if (isPositiveInt(raw.port)) port = raw.port;
    else errors.push(`${idLabel}: 'port' debe ser un entero positivo.`);
  }

  const autostart = raw.autostart === true;
  if (raw.autostart !== undefined && typeof raw.autostart !== 'boolean') {
    errors.push(`${idLabel}: 'autostart' debe ser booleano.`);
  }

  const { health, errors: hErr } = validateHealth(raw.health, idLabel);
  const { watchdog, errors: wErr } = validateWatchdog(raw.watchdog, idLabel, defaultInterval);
  errors.push(...hErr, ...wErr);

  const app = {
    id: typeof raw.id === 'string' ? raw.id.trim() : undefined,
    name: typeof raw.name === 'string' ? raw.name.trim() : undefined,
    type,
    cwd: typeof raw.cwd === 'string' ? raw.cwd.trim() : undefined,
    command: typeof raw.command === 'string' ? raw.command.trim() : undefined,
    args,
    env,
    port,
    autostart,
    health,
    watchdog,
  };

  return { app, errors };
}

/**
 * Valida la config completa de apps.json.
 * @param {*} raw  JSON parseado
 * @returns {{ value: { settings: object, apps: object[] }, errors: string[] }}
 */
function validateConfig(raw) {
  const errors = [];

  if (!isObject(raw)) {
    return {
      value: { settings: { ...DEFAULT_SETTINGS }, apps: [] },
      errors: ['La raíz de apps.json debe ser un objeto con { settings, apps }.'],
    };
  }

  const { settings, errors: sErr } = validateSettings(raw.settings);
  errors.push(...sErr);

  let apps = [];
  if (raw.apps === undefined) {
    errors.push("Falta el array 'apps'. Se asume lista vacía.");
  } else if (!Array.isArray(raw.apps)) {
    errors.push("'apps' debe ser un array. Se asume lista vacía.");
  } else {
    const seen = new Set();
    for (let i = 0; i < raw.apps.length; i++) {
      const { app, errors: aErr } = validateApp(raw.apps[i], i, settings.watchdogDefaultIntervalMinutes);
      errors.push(...aErr);
      if (!app || !app.id) continue;
      if (seen.has(app.id)) {
        errors.push(`app '${app.id}': id duplicado. Se ignora la repetición.`);
        continue;
      }
      seen.add(app.id);
      apps.push(app);
    }
  }

  return { value: { settings, apps }, errors };
}

module.exports = { validateConfig, DEFAULT_SETTINGS, APP_TYPES };
