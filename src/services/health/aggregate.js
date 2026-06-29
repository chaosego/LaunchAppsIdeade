'use strict';

const { checkTcp } = require('./tcp');
const { checkHttp } = require('./http');
const { checkCommand } = require('./command');

/**
 * Ejecuta todos los checks configurados de una app y combina el resultado
 * en un veredicto único (issue #10).
 *
 * Detección de "vivo pero colgado" (hung): el proceso está vivo pero no
 * responde como debería:
 *   - HTTP hace timeout, o
 *   - HTTP responde pero la latencia supera latencyWarnMs, o
 *   - el puerto TCP acepta conexión pero el HTTP falla (escucha pero no sirve).
 *
 * @param {object} app             app validada (usa app.health)
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs] timeout por defecto (settings.healthTimeoutMs)
 * @returns {Promise<{
 *   healthy: boolean,
 *   hung: boolean,
 *   latencyMs: number|null,
 *   reason: string|null,
 *   checks: object
 * }>}
 */
async function runHealth(app, { timeoutMs = 5000 } = {}) {
  const h = app.health || {};
  const checks = {};
  const reasons = [];

  // Sin ninguna prueba configurada no podemos sondear: lo damos por sano.
  if (!h.tcp && !h.http && !h.command) {
    return { healthy: true, hung: false, latencyMs: null, reason: 'sin checks configurados', checks };
  }

  const tasks = [];
  if (h.tcp) {
    tasks.push(
      checkTcp(h.tcp.port, { timeoutMs }).then((r) => {
        checks.tcp = r;
      })
    );
  }
  if (h.http) {
    tasks.push(
      checkHttp(h.http.url, { expectStatus: h.http.expectStatus, timeoutMs }).then((r) => {
        checks.http = r;
      })
    );
  }
  if (h.command) {
    tasks.push(
      checkCommand(h.command.run, { timeoutMs: h.command.timeoutMs || timeoutMs, cwd: app.cwd }).then((r) => {
        checks.command = r;
      })
    );
  }
  await Promise.all(tasks);

  let healthy = true;
  let hung = false;
  const latencyMs = checks.http ? checks.http.latencyMs : checks.tcp ? checks.tcp.latencyMs : null;

  if (checks.tcp && !checks.tcp.ok) {
    healthy = false;
    reasons.push(`TCP ${app.health.tcp.port}: ${checks.tcp.error}`);
  }

  if (checks.http) {
    if (!checks.http.ok) {
      healthy = false;
      reasons.push(`HTTP: ${checks.http.error}`);
      // Puerto abierto pero HTTP falla, o timeout HTTP => colgado.
      if (checks.http.timedOut || (checks.tcp && checks.tcp.ok)) hung = true;
    } else if (h.latencyWarnMs && checks.http.latencyMs > h.latencyWarnMs) {
      healthy = false;
      hung = true;
      reasons.push(`latencia ${checks.http.latencyMs}ms > ${h.latencyWarnMs}ms`);
    }
  }

  if (checks.command && !checks.command.ok) {
    healthy = false;
    reasons.push(`comando: ${checks.command.error}`);
    if (checks.command.timedOut) hung = true;
  }

  return {
    healthy,
    hung,
    latencyMs,
    reason: reasons.length ? reasons.join('; ') : null,
    checks,
  };
}

module.exports = { runHealth };
