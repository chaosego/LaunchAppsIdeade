'use strict';

const { exec } = require('child_process');

/**
 * Ejecuta un comando de health local (issue #9). Si supera timeoutMs se mata
 * de forma dura (kill árbol en Windows). exit code 0 = ok.
 *
 * @param {string} run        comando shell a ejecutar
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=4000]
 * @param {string} [opts.cwd]
 * @returns {Promise<{ ok: boolean, exitCode: number|null, timedOut: boolean, latencyMs: number, error: string|null }>}
 */
function checkCommand(run, { timeoutMs = 4000, cwd } = {}) {
  const start = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (res) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...res, latencyMs: Date.now() - start });
    };

    const child = exec(run, { cwd, windowsHide: true }, (err) => {
      if (err && err.killed) return; // lo maneja el timeout
      const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
      finish({ ok: code === 0, exitCode: code, timedOut: false, error: code === 0 ? null : `exit ${code}` });
    });

    const timer = setTimeout(() => {
      // Kill duro del árbol para evitar que un health colgado quede vivo.
      if (process.platform === 'win32' && child.pid) {
        exec(`taskkill /PID ${child.pid} /T /F`, () => {});
      } else {
        try { child.kill('SIGKILL'); } catch (_) { /* noop */ }
      }
      finish({ ok: false, exitCode: null, timedOut: true, error: `timeout tras ${timeoutMs}ms` });
    }, timeoutMs);
  });
}

module.exports = { checkCommand };
