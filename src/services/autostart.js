'use strict';

/**
 * Autostart al arrancar el panel (issue #17). Lanza de forma escalonada las
 * apps marcadas con autostart=true, para evitar un pico de CPU al levantar
 * varias a la vez.
 *
 * @param {import('./processManager').ProcessManager} pm
 * @param {object[]} apps           apps de la config
 * @param {object} [opts]
 * @param {number} [opts.staggerMs=1500]  separación entre lanzamientos
 * @param {(msg: string) => void} [opts.log]
 * @returns {Promise<string[]>}     ids lanzados
 */
async function runAutostart(pm, apps, { staggerMs = 1500, log = () => {} } = {}) {
  const targets = apps.filter((a) => a.autostart);
  const launched = [];
  for (let i = 0; i < targets.length; i++) {
    const app = targets[i];
    try {
      pm.start(app.id);
      launched.push(app.id);
      log(`autostart: ${app.id} lanzada (${i + 1}/${targets.length})`);
    } catch (err) {
      log(`autostart: fallo en ${app.id}: ${err.message}`);
    }
    if (i < targets.length - 1) await sleep(staggerMs);
  }
  return launched;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { runAutostart };
