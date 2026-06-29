'use strict';

const { EventEmitter } = require('events');
const { STATES, isLive } = require('./states');

/**
 * Watchdog (issues #15, #16). Por cada app con watchdog.enabled programa una
 * comprobación periódica (intervalMinutes, default settings.watchdogDefaultIntervalMinutes).
 * Si la app debería estar arriba y está caída (crashed/stopped) o colgada
 * (unhealthy, sólo si restartOnUnhealthy) la relanza, con límite de reintentos
 * consecutivos (maxRetries). El contador se resetea cuando la app vuelve a estar
 * sana. Nunca toca apps pausadas.
 *
 * Eventos:
 *   'event'  { type, id, message, at }
 *      type ∈ check | restart | give-up | recovered | error
 */
class Watchdog extends EventEmitter {
  /**
   * @param {import('./processManager').ProcessManager} pm
   * @param {() => object} getSettings
   * @param {() => object[]} getApps  apps actuales de la config
   */
  constructor(pm, getSettings, getApps) {
    super();
    this.pm = pm;
    this.getSettings = getSettings;
    this.getApps = getApps;
    /** @type {Map<string, { timer: any, attempts: number }>} */
    this.timers = new Map();
    this.active = false;
  }

  _emit(type, id, message) {
    this.emit('event', { type, id, message, at: new Date().toISOString() });
  }

  _intervalMs(app) {
    const def = this.getSettings().watchdogDefaultIntervalMinutes || 150;
    const min = (app.watchdog && app.watchdog.intervalMinutes) || def;
    return min * 60 * 1000;
  }

  /** Arranca el watchdog para todas las apps con watchdog habilitado. */
  start() {
    this.active = true;
    for (const app of this.getApps()) {
      if (app.watchdog && app.watchdog.enabled) this._schedule(app.id);
    }
  }

  stop() {
    this.active = false;
    for (const { timer } of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  _schedule(id) {
    if (!this.active) return;
    const app = this._appById(id);
    if (!app || !app.watchdog || !app.watchdog.enabled) return;

    const entry = this.timers.get(id) || { timer: null, attempts: 0 };
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => this._check(id), this._intervalMs(app));
    this.timers.set(id, entry);
  }

  _appById(id) {
    return this.getApps().find((a) => a.id === id) || null;
  }

  /** Comprobación de una app + relanzamiento si procede. */
  async _check(id) {
    const app = this._appById(id);
    if (!app || !app.watchdog || !app.watchdog.enabled) return; // pudo deshabilitarse (M5 reload)

    try {
      if (this.pm.isPaused(id)) {
        this._emit('check', id, 'pausada, se omite');
        return;
      }

      const state = this.pm.getState(id);
      const entry = this.timers.get(id) || { timer: null, attempts: 0 };
      const maxRetries = app.watchdog.maxRetries || 3;

      const isDown = state.status === STATES.CRASHED || state.status === STATES.STOPPED;
      const isHung = state.status === STATES.UNHEALTHY;
      const needsRestart = isDown || (isHung && app.watchdog.restartOnUnhealthy);

      if (!needsRestart) {
        // Sana (running) o no procede: resetea reintentos.
        if (entry.attempts > 0) {
          this._emit('recovered', id, `recuperada (${state.status}), reintentos reseteados`);
          entry.attempts = 0;
          this.timers.set(id, entry);
        } else {
          this._emit('check', id, `ok (${state.status})`);
        }
        return;
      }

      if (entry.attempts >= maxRetries) {
        this._emit('give-up', id, `${state.status}: alcanzado maxRetries (${maxRetries}), no se relanza`);
        return;
      }

      entry.attempts += 1;
      this.timers.set(id, entry);
      this._emit('restart', id, `${state.status}: relanzando (intento ${entry.attempts}/${maxRetries})`);

      // Caída -> start; colgada (proceso vivo) -> restart.
      if (isLive(state.status)) await this.pm.restart(id);
      else this.pm.start(id);
    } catch (err) {
      this._emit('error', id, err.message);
    } finally {
      this._schedule(id); // reprograma el siguiente ciclo
    }
  }
}

module.exports = { Watchdog };
