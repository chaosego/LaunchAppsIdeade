'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { loadConfig, CONFIG_PATH } = require('./loader');
const { validateConfig } = require('./schema');
const { writeConfigAtomic } = require('./store');

/**
 * Gestiona la config en caliente (issues #18, #19):
 *  - apply(): vuelca una config nueva al estado vivo (pm.setApps preserva
 *    procesos en curso) y reprograma el watchdog. NO mata apps corriendo.
 *  - watch(): observa apps.json en disco y recarga al detectar cambios.
 *  - saveApps(): persiste cambios desde la UI (CRUD) sin disparar el watcher.
 *
 * Eventos: 'reload' { source: 'disk'|'crud', apps }
 */
class ConfigManager extends EventEmitter {
  /**
   * @param {object} deps
   * @param {() => object} deps.getConfig
   * @param {(c: object) => void} deps.setConfig
   * @param {object} deps.pm
   * @param {() => object|null} deps.getWatchdog
   * @param {() => object|null} [deps.getHealthMonitor]
   */
  constructor({ getConfig, setConfig, pm, getWatchdog, getHealthMonitor }) {
    super();
    this.getConfig = getConfig;
    this.setConfig = setConfig;
    this.pm = pm;
    this.getWatchdog = getWatchdog;
    this.getHealthMonitor = getHealthMonitor || (() => null);
    this.watcher = null;
    this.debounce = null;
    this._suppressUntil = 0;
  }

  /** Aplica una config ya cargada/validada al estado vivo. */
  apply(config, source) {
    this.setConfig(config);
    this.pm.setApps(config.apps); // preserva procesos vivos
    const wd = this.getWatchdog();
    if (wd) {
      wd.stop();
      wd.start();
    }
    this.emit('reload', { source, apps: config.apps });
  }

  /** Recarga desde disco y aplica. */
  reloadFromDisk(source = 'disk') {
    const config = loadConfig();
    this.apply(config, source);
    return config;
  }

  /**
   * Persiste una lista de apps (desde la UI) y la aplica. No dispara el watcher.
   * @returns {{ ok: boolean, errors: string[], config?: object }}
   */
  saveApps(apps) {
    const settings = this.getConfig().settings;
    const { value, errors } = validateConfig({ settings, apps });
    if (errors.length) return { ok: false, errors };

    this._suppressUntil = Date.now() + 1500; // ignora el evento de escritura propia
    writeConfigAtomic(value);
    this.apply(value, 'crud');
    return { ok: true, errors: [], config: value };
  }

  /** Observa el directorio de apps.json y recarga al cambiar. */
  watch() {
    if (this.watcher) return;
    const dir = path.dirname(CONFIG_PATH);
    const file = path.basename(CONFIG_PATH);
    try {
      this.watcher = fs.watch(dir, (eventType, fname) => {
        if (fname !== file) return;
        if (Date.now() < this._suppressUntil) return; // cambio propio (CRUD)
        clearTimeout(this.debounce);
        this.debounce = setTimeout(() => {
          this.emit('reload-start', {});
          try {
            this.reloadFromDisk('disk');
          } catch (err) {
            this.emit('error', err);
          }
        }, 300);
      });
    } catch (err) {
      this.emit('error', err);
    }
  }

  stopWatch() {
    if (this.watcher) this.watcher.close();
    this.watcher = null;
    clearTimeout(this.debounce);
  }
}

module.exports = { ConfigManager };
