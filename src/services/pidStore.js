'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Persistencia de PIDs de los procesos lanzados (issue #24). Permite que, tras
 * un reinicio del panel, se puedan re-adoptar los procesos hijos que siguen
 * vivos. Guarda id -> { pid, command, args, port, startedAt }.
 */
class PidStore {
  /**
   * @param {object} [opts]
   * @param {string} [opts.dir]   directorio (si se omite, sólo memoria)
   * @param {string} [opts.file]  nombre de archivo
   */
  constructor({ dir, file = 'processes.json' } = {}) {
    this.path = dir ? path.join(dir, file) : null;
    this.data = {};
    if (this.path) {
      try {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        if (fs.existsSync(this.path)) this.data = JSON.parse(fs.readFileSync(this.path, 'utf8')) || {};
      } catch (_) { this.data = {}; }
    }
  }

  /** Registro previo (cargado de disco) de una app, o null. */
  get(id) {
    return this.data[id] || null;
  }

  /** Todas las entradas guardadas. */
  all() {
    return { ...this.data };
  }

  set(id, info) {
    this.data[id] = { ...info };
    this._flush();
  }

  remove(id) {
    if (this.data[id]) {
      delete this.data[id];
      this._flush();
    }
  }

  _flush() {
    if (!this.path) return;
    try {
      const tmp = `${this.path}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tmp, this.path);
    } catch (_) { /* persistencia best-effort */ }
  }
}

module.exports = { PidStore };
