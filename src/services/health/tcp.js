'use strict';

const net = require('net');

/**
 * Comprueba si un puerto TCP acepta conexión (issue #7).
 * @param {number} port
 * @param {object} [opts]
 * @param {string} [opts.host='127.0.0.1']
 * @param {number} [opts.timeoutMs=5000]
 * @returns {Promise<{ ok: boolean, latencyMs: number|null, error: string|null }>}
 */
function checkTcp(port, { host = '127.0.0.1', timeoutMs = 5000 } = {}) {
  const start = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok, error) => {
      if (settled) return;
      settled = true;
      try { sock.destroy(); } catch (_) { /* noop */ }
      resolve({ ok, latencyMs: ok ? Date.now() - start : null, error: error || null });
    };

    const sock = net.connect({ host, port });
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish(true, null));
    sock.once('timeout', () => finish(false, `timeout tras ${timeoutMs}ms`));
    sock.once('error', (err) => finish(false, err.message));
  });
}

module.exports = { checkTcp };
