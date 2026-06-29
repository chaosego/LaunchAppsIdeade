'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Captura stdout/stderr de los procesos (issue #20). Mantiene un buffer en
 * memoria por app (ring buffer) y opcionalmente vuelca a logs/<id>.log con
 * rotación básica por tamaño. Se alimenta del evento 'log' del ProcessManager.
 */
class LogStore {
  /**
   * @param {import('./processManager').ProcessManager} pm
   * @param {object} [opts]
   * @param {string} [opts.dir]           directorio de logs (si se omite, sólo memoria)
   * @param {number} [opts.maxLines=500]  líneas en memoria por app
   * @param {number} [opts.maxBytes=2MB]  tamaño máx por archivo antes de rotar
   */
  constructor(pm, { dir, maxLines = 500, maxBytes = 2 * 1024 * 1024 } = {}) {
    this.dir = dir || null;
    this.maxLines = maxLines;
    this.maxBytes = maxBytes;
    /** @type {Map<string, object[]>} */
    this.buffers = new Map();

    if (this.dir && !fs.existsSync(this.dir)) {
      try { fs.mkdirSync(this.dir, { recursive: true }); } catch (_) { this.dir = null; }
    }

    pm.on('log', ({ id, stream, chunk }) => this._push(id, stream, chunk));
    pm.on('state', ({ id, prev, status }) =>
      this._push(id, 'system', `--- ${prev} -> ${status} ---\n`));
  }

  _push(id, stream, chunk) {
    const lines = String(chunk).split(/\r?\n/).filter((l) => l.length > 0);
    if (!lines.length) return;
    let buf = this.buffers.get(id);
    if (!buf) { buf = []; this.buffers.set(id, buf); }
    const at = new Date().toISOString();
    for (const line of lines) {
      buf.push({ stream, line, at });
      if (buf.length > this.maxLines) buf.shift();
    }
    if (this.dir) this._appendFile(id, lines, stream);
  }

  _appendFile(id, lines, stream) {
    const file = path.join(this.dir, `${this._safe(id)}.log`);
    try {
      const prefix = stream === 'stderr' ? '[err] ' : stream === 'system' ? '' : '';
      fs.appendFileSync(file, lines.map((l) => prefix + l).join('\n') + '\n', 'utf8');
      const st = fs.statSync(file);
      if (st.size > this.maxBytes) fs.renameSync(file, `${file}.1`); // rotación simple
    } catch (_) { /* logging no debe romper el flujo */ }
  }

  _safe(id) {
    return String(id).replace(/[^a-zA-Z0-9_.-]/g, '_');
  }

  /** Historial en memoria de una app. */
  getHistory(id) {
    return this.buffers.get(id) || [];
  }
}

module.exports = { LogStore };
