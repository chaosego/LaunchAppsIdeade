'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { STATES } = require('./states');

/**
 * Registro de eventos relevantes (issue #21): caídas, restarts del watchdog,
 * recargas de config, etc. Persiste en data/events.jsonl (una línea JSON por
 * evento) y mantiene los últimos en memoria. Emite 'event' para que la UI los
 * muestre en vivo (SSE) con un toast.
 *
 * Evento: { id, level: 'info'|'warn'|'error', type, message, at }
 */
class EventLog extends EventEmitter {
  /**
   * @param {import('./processManager').ProcessManager} pm
   * @param {object} [opts]
   * @param {string} [opts.dir]
   * @param {number} [opts.maxMem=200]
   */
  constructor(pm, { dir, maxMem = 200 } = {}) {
    super();
    this.dir = dir || null;
    this.maxMem = maxMem;
    this.recent = [];
    this.file = null;

    if (this.dir) {
      try {
        if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
        this.file = path.join(this.dir, 'events.jsonl');
        this._loadRecent();
      } catch (_) { this.file = null; }
    }

    // Cambios de estado significativos del proceso.
    pm.on('state', ({ id, prev, status }) => {
      if (status === STATES.CRASHED) this.record(id, 'error', 'crashed', 'la app terminó de forma inesperada');
      else if (status === STATES.UNHEALTHY) this.record(id, 'warn', 'unhealthy', 'la app no responde correctamente');
      else if (prev === STATES.UNHEALTHY && status === STATES.RUNNING) this.record(id, 'info', 'recovered', 'la app volvió a responder');
    });
  }

  /** Conecta los eventos del watchdog. */
  attachWatchdog(wd) {
    const level = { restart: 'warn', 'give-up': 'error', recovered: 'info', error: 'error' };
    wd.on('event', ({ type, id, message }) => {
      if (type === 'check') return; // ruido: comprobaciones rutinarias
      this.record(id, level[type] || 'info', `watchdog:${type}`, message);
    });
  }

  /** Conecta los eventos del ConfigManager. */
  attachConfigManager(cm) {
    cm.on('reload', ({ source }) => this.record(null, 'info', 'config-reload', `config recargada (${source})`));
  }

  record(id, level, type, message) {
    const event = { id: id || null, level, type, message, at: new Date().toISOString() };
    this.recent.push(event);
    if (this.recent.length > this.maxMem) this.recent.shift();
    if (this.file) {
      try { fs.appendFileSync(this.file, JSON.stringify(event) + '\n', 'utf8'); } catch (_) { /* noop */ }
    }
    this.emit('event', event);
    return event;
  }

  /** Últimos eventos (más recientes al final). */
  list(limit = 50) {
    return this.recent.slice(-limit);
  }

  _loadRecent() {
    try {
      const text = fs.readFileSync(this.file, 'utf8');
      const lines = text.split('\n').filter(Boolean).slice(-this.maxMem);
      this.recent = lines.map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
    } catch (_) { /* archivo aún no existe */ }
  }
}

module.exports = { EventLog };
