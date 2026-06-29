'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Captura stdout/stderr de los procesos (issue #20) y los persiste en JSONL
 * estructurado (`logs/<id>.jsonl`, una línea = { at, stream, line }) para poder
 * buscar, filtrar por stream y paginar (sin SQLite). El historial sobrevive a
 * reinicios del panel: el buffer se seedea desde el archivo bajo demanda.
 */
class LogStore {
  /**
   * @param {import('./processManager').ProcessManager} pm
   * @param {object} [opts]
   * @param {string} [opts.dir]              directorio de logs
   * @param {number} [opts.maxLines=1000]    líneas en memoria por app (tail vivo)
   * @param {number} [opts.maxFileLines=20000] retención por archivo
   */
  constructor(pm, { dir, maxLines = 1000, maxFileLines = 20000 } = {}) {
    this.dir = dir || null;
    this.maxLines = maxLines;
    this.maxFileLines = maxFileLines;
    /** @type {Map<string, object[]>} */
    this.buffers = new Map();
    /** @type {Set<string>} ids ya seedeados desde disco */
    this.seeded = new Set();
    /** @type {Map<string, number>} appends desde la última poda */
    this.sinceTrim = new Map();

    if (this.dir && !fs.existsSync(this.dir)) {
      try { fs.mkdirSync(this.dir, { recursive: true }); } catch (_) { this.dir = null; }
    }

    pm.on('log', ({ id, stream, chunk }) => this._push(id, stream, chunk));
    pm.on('state', ({ id, prev, status }) => this._push(id, 'system', `--- ${prev} -> ${status} ---`));
  }

  _file(id) {
    return path.join(this.dir, `${this._safe(id)}.jsonl`);
  }
  _safe(id) {
    return String(id).replace(/[^a-zA-Z0-9_.-]/g, '_');
  }

  _push(id, stream, chunk) {
    const lines = String(chunk).split(/\r?\n/).filter((l) => l.length > 0);
    if (!lines.length) return;
    this._ensureSeeded(id);
    let buf = this.buffers.get(id);
    if (!buf) { buf = []; this.buffers.set(id, buf); }
    const at = new Date().toISOString();
    const entries = lines.map((line) => ({ at, stream, line }));
    for (const e of entries) {
      buf.push(e);
      if (buf.length > this.maxLines) buf.shift();
    }
    if (this.dir) this._appendFile(id, entries);
  }

  _appendFile(id, entries) {
    const file = this._file(id);
    try {
      fs.appendFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
      const n = (this.sinceTrim.get(id) || 0) + entries.length;
      if (n >= 500) { this.sinceTrim.set(id, 0); this._trim(id); }
      else this.sinceTrim.set(id, n);
    } catch (_) { /* logging no debe romper el flujo */ }
  }

  /** Poda el archivo a las últimas maxFileLines (retención). */
  _trim(id) {
    const file = this._file(id);
    try {
      const all = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
      if (all.length <= this.maxFileLines) return;
      const kept = all.slice(all.length - this.maxFileLines);
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, kept.join('\n') + '\n', 'utf8');
      fs.renameSync(tmp, file);
    } catch (_) { /* noop */ }
  }

  /** Carga el tail del archivo al buffer la primera vez (seed-from-file). */
  _ensureSeeded(id) {
    if (this.seeded.has(id)) return;
    this.seeded.add(id);
    if (!this.dir) return;
    try {
      const all = fs.readFileSync(this._file(id), 'utf8').split('\n').filter(Boolean);
      const tail = all.slice(Math.max(0, all.length - this.maxLines));
      const buf = tail.map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
      if (buf.length) this.buffers.set(id, buf);
    } catch (_) { /* archivo aún no existe */ }
  }

  /** Tail en memoria (para el stream SSE inicial). */
  getHistory(id) {
    this._ensureSeeded(id);
    return this.buffers.get(id) || [];
  }

  /**
   * Consulta con búsqueda / filtro / paginación (lee el archivo completo, con
   * retención acotada). Devuelve la página más reciente primero (page 0 = última).
   *
   * @param {string} id
   * @param {object} [opts]
   * @param {string} [opts.search]   substring (case-insensitive)
   * @param {string} [opts.stream]   stdout|stderr|system|all
   * @param {string} [opts.from]     ISO; incluir at >= from
   * @param {string} [opts.to]       ISO; incluir at <= to
   * @param {number} [opts.limit=200]
   * @param {number} [opts.page=0]   0 = más reciente
   * @returns {{ total: number, page: number, limit: number, entries: object[] }}
   */
  query(id, { search, stream, from, to, limit = 200, page = 0 } = {}) {
    let entries = this._readAll(id);

    if (stream && stream !== 'all') entries = entries.filter((e) => e.stream === stream);
    if (search) { const s = search.toLowerCase(); entries = entries.filter((e) => e.line.toLowerCase().includes(s)); }
    if (from) entries = entries.filter((e) => e.at >= from);
    if (to) entries = entries.filter((e) => e.at <= to);

    const total = entries.length;
    const end = total - page * limit;
    const start = Math.max(0, end - limit);
    return { total, page, limit, entries: entries.slice(start, Math.max(start, end)) };
  }

  _readAll(id) {
    if (this.dir) {
      try {
        return fs.readFileSync(this._file(id), 'utf8').split('\n').filter(Boolean)
          .map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
      } catch (_) { /* sin archivo: cae al buffer */ }
    }
    return (this.buffers.get(id) || []).slice();
  }
}

module.exports = { LogStore };
