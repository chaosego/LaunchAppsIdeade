'use strict';

const { runHealth } = require('./health/aggregate');
const { STATES } = require('./states');

/**
 * Reconciliación de instancias externas / huérfanas (issue #22).
 *
 * Decisión de diseño v1: los procesos se lanzan con child_process SIN `detached`,
 * por lo que NO se re-adoptan tras un reinicio del panel. Si el panel (bajo pm2)
 * se reinicia mientras una app sigue viva, esa app queda "huérfana": el panel ya
 * no la gestiona (no tiene su PID).
 *
 * Esta función NO mata ni adopta esos procesos; solo los DETECTA por health y
 * registra un aviso, para dar visibilidad y evitar que el autostart intente
 * relanzar algo que ya está escuchando (lo que provocaría conflicto de puerto).
 *
 * @param {import('./processManager').ProcessManager} pm
 * @param {object[]} apps
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=5000]
 * @param {(id: string, message: string) => void} [opts.onExternal]
 * @returns {Promise<string[]>} ids detectados como accesibles externamente
 */
async function reconcileExternal(pm, apps, { timeoutMs = 5000, onExternal = () => {} } = {}) {
  const externalUp = [];
  await Promise.all(
    apps.map(async (app) => {
      const h = app.health || {};
      if (!h.tcp && !h.http) return; // sin forma de sondear
      const state = pm.getState(app.id);
      if (state.status !== STATES.STOPPED) return; // solo nos interesa lo que el panel cree apagado
      try {
        const result = await runHealth(app, { timeoutMs });
        if (result.healthy) {
          externalUp.push(app.id);
          onExternal(app.id, 'accesible pero no gestionada por el panel (posible instancia externa o huérfana de un reinicio)');
        }
      } catch (_) { /* noop */ }
    })
  );
  return externalUp;
}

module.exports = { reconcileExternal };
