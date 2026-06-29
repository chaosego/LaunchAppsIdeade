'use strict';

/**
 * Comprueba un endpoint HTTP (issue #8). Usa fetch global (Node >= 18) con
 * AbortController para timeout duro. Un timeout se clasifica como fallo
 * (la app puede estar "colgada": proceso vivo pero sin responder).
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {number} [opts.expectStatus=200]
 * @param {number} [opts.timeoutMs=5000]
 * @returns {Promise<{ ok: boolean, status: number|null, latencyMs: number|null, timedOut: boolean, error: string|null }>}
 */
async function checkHttp(url, { expectStatus = 200, timeoutMs = 5000 } = {}) {
  const start = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'manual' });
    const latencyMs = Date.now() - start;
    const ok = res.status === expectStatus;
    return {
      ok,
      status: res.status,
      latencyMs,
      timedOut: false,
      error: ok ? null : `status ${res.status} (esperado ${expectStatus})`,
    };
  } catch (err) {
    const timedOut = err.name === 'AbortError';
    return {
      ok: false,
      status: null,
      latencyMs: timedOut ? timeoutMs : Date.now() - start,
      timedOut,
      error: timedOut ? `timeout tras ${timeoutMs}ms` : err.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { checkHttp };
