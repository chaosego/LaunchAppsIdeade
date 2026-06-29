'use strict';

const { EventEmitter } = require('events');
const { runHealth } = require('./health/aggregate');

/**
 * Loop de polling de health (issue #11). Cada `statusPollIntervalMs` sondea
 * las apps vivas, actualiza el estado del ProcessManager (running <-> unhealthy)
 * y emite el resultado para que la UI (SSE) lo muestre.
 *
 * Eventos:
 *   'health'  { id, healthy, hung, latencyMs, reason, checks, at }
 */
class HealthMonitor extends EventEmitter {
  /**
   * @param {import('./processManager').ProcessManager} pm
   * @param {() => object} getSettings  devuelve settings actuales (port, healthTimeoutMs, statusPollIntervalMs)
   */
  constructor(pm, getSettings) {
    super();
    this.pm = pm;
    this.getSettings = getSettings;
    this.timer = null;
    this.running = false;
    /** @type {Map<string, object>} último resultado por app */
    this.last = new Map();
  }

  start() {
    if (this.timer) return;
    const interval = this.getSettings().statusPollIntervalMs || 10000;
    // Primer ciclo inmediato y luego periódico.
    this.tick();
    this.timer = setInterval(() => this.tick(), interval);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Resultado de health más reciente de una app (o null). */
  getLast(id) {
    return this.last.get(id) || null;
  }

  /** Ejecuta un ciclo de checks sobre todas las apps vivas. */
  async tick() {
    if (this.running) return; // evita solapamiento si un ciclo tarda más que el intervalo
    this.running = true;
    try {
      const timeoutMs = this.getSettings().healthTimeoutMs || 5000;
      const ids = this.pm.liveIds();
      await Promise.all(
        ids.map(async (id) => {
          const app = this.pm.getApp(id);
          let result;
          try {
            result = await runHealth(app, { timeoutMs });
          } catch (err) {
            result = { healthy: false, hung: false, latencyMs: null, reason: `error health: ${err.message}`, checks: {} };
          }
          this.pm.applyHealth(id, result.healthy);
          const payload = { id, ...result, at: new Date().toISOString() };
          this.last.set(id, payload);
          this.emit('health', payload);
        })
      );
    } finally {
      this.running = false;
    }
  }
}

module.exports = { HealthMonitor };
