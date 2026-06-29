'use strict';

const { spawn } = require('child_process');
const net = require('net');
const { EventEmitter } = require('events');
const { STATES, canTransition, isLive } = require('./states');

/**
 * Gestiona el ciclo de vida de los procesos hijos (issues #4, #5, #6).
 *
 * - spawn / stop / restart con kill de árbol en Windows (taskkill /T /F).
 * - Tracking de PID y estado en memoria por app.
 * - pause / resume (estado lógico que excluye del watchdog).
 * - Emite eventos para que la UI (SSE, M2/M3) reaccione:
 *     'state'  { id, prev, status }
 *     'log'    { id, stream: 'stdout'|'stderr', chunk }   (consumido en M5)
 *     'exit'   { id, code, signal, intentional }
 */
class ProcessManager extends EventEmitter {
  /**
   * @param {object[]} apps  apps validadas de la config
   */
  constructor(apps = []) {
    super();
    /** @type {Map<string, object>} */
    this.entries = new Map();
    this.setApps(apps);
  }

  /** Reconstruye el set de apps preservando procesos vivos (usado en M5 al recargar). */
  setApps(apps) {
    const seen = new Set();
    for (const app of apps) {
      seen.add(app.id);
      const existing = this.entries.get(app.id);
      if (existing) {
        existing.app = app; // refresca config sin tocar el proceso vivo
      } else {
        this.entries.set(app.id, this._newEntry(app));
      }
    }
    // No elimina entries con proceso vivo aunque desaparezcan de config (se decide en M5).
    for (const [id, entry] of this.entries) {
      if (!seen.has(id) && !isLive(entry.status)) this.entries.delete(id);
    }
  }

  _newEntry(app) {
    return {
      app,
      child: null,
      pid: null,
      status: STATES.STOPPED,
      startedAt: null,
      exitCode: null,
      restarts: 0,
      intentionalStop: false,
    };
  }

  _get(id) {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`App desconocida: '${id}'`);
    return entry;
  }

  /** Cambia el estado respetando la máquina de estados y emite 'state'. */
  _setStatus(entry, next) {
    const prev = entry.status;
    if (prev === next) return;
    if (!canTransition(prev, next)) {
      // Transición inválida: la registramos pero no rompemos el flujo.
      this.emit('warn', { id: entry.app.id, message: `transición inválida ${prev} -> ${next}` });
    }
    entry.status = next;
    this.emit('state', { id: entry.app.id, prev, status: next });
  }

  /** Estado serializable de una app. */
  getState(id) {
    const e = this._get(id);
    return {
      id: e.app.id,
      name: e.app.name,
      status: e.status,
      pid: e.pid,
      startedAt: e.startedAt,
      exitCode: e.exitCode,
      restarts: e.restarts,
    };
  }

  /** Estado de todas las apps. */
  getAll() {
    return [...this.entries.keys()].map((id) => this.getState(id));
  }

  /** Lanza la app. Idempotente si ya está viva. */
  start(id) {
    const entry = this._get(id);
    if (isLive(entry.status) && entry.child) {
      return { id, status: entry.status, alreadyRunning: true };
    }

    const { app } = entry;
    this._setStatus(entry, STATES.STARTING);
    entry.intentionalStop = false;
    entry.exitCode = null;

    let child;
    try {
      child = spawn(app.command, app.args || [], {
        cwd: app.cwd,
        env: { ...process.env, ...(app.env || {}) },
        // shell:true para resolver .cmd/.bat en Windows (npm, npx, etc.)
        shell: true,
        windowsHide: true,
      });
    } catch (err) {
      this._setStatus(entry, STATES.CRASHED);
      this.emit('warn', { id, message: `no se pudo lanzar: ${err.message}` });
      return { id, status: entry.status, error: err.message };
    }

    entry.child = child;
    entry.pid = child.pid;
    entry.startedAt = new Date().toISOString();

    child.stdout && child.stdout.on('data', (c) => this.emit('log', { id, stream: 'stdout', chunk: c.toString() }));
    child.stderr && child.stderr.on('data', (c) => this.emit('log', { id, stream: 'stderr', chunk: c.toString() }));

    child.on('spawn', () => {
      // Proceso lanzado. El estado "running" real lo confirmará el health check (M2);
      // por ahora marcamos running optimista al spawnear.
      if (entry.status === STATES.STARTING) this._setStatus(entry, STATES.RUNNING);
    });

    child.on('error', (err) => {
      this.emit('warn', { id, message: `error de proceso: ${err.message}` });
      this._setStatus(entry, STATES.CRASHED);
    });

    child.on('exit', (code, signal) => {
      entry.exitCode = code;
      entry.child = null;
      entry.pid = null;
      const intentional = entry.intentionalStop;
      this.emit('exit', { id, code, signal, intentional });
      if (intentional) {
        this._setStatus(entry, entry.status === STATES.PAUSED ? STATES.PAUSED : STATES.STOPPED);
      } else {
        // Salida inesperada -> crashed (independiente del code: un server no debería salir solo)
        this._setStatus(entry, STATES.CRASHED);
      }
      entry.intentionalStop = false;
    });

    return { id, status: entry.status, pid: entry.pid };
  }

  /**
   * Para la app matando el árbol de procesos.
   * @returns {Promise<{id,status}>}
   */
  stop(id, { markPaused = false } = {}) {
    const entry = this._get(id);
    if (!entry.child) {
      if (markPaused) this._setStatus(entry, STATES.PAUSED);
      else this._setStatus(entry, STATES.STOPPED);
      return Promise.resolve({ id, status: entry.status });
    }

    entry.intentionalStop = true;
    if (markPaused) entry.status = STATES.PAUSED; // marca destino; el handler exit lo respeta

    const pid = entry.pid;
    const child = entry.child;

    return new Promise((resolve) => {
      const done = () => resolve({ id, status: entry.status });
      child.once('exit', done);

      killTree(pid, (err) => {
        if (err) this.emit('warn', { id, message: `kill falló: ${err.message}` });
      });

      // Salvaguarda: si en 8s no salió, resolvemos igual.
      setTimeout(() => {
        if (entry.child) {
          this.emit('warn', { id, message: 'el proceso no terminó en 8s tras kill' });
          done();
        }
      }, 8000);
    });
  }

  /** Reinicia: stop -> espera liberación de puerto -> start. */
  async restart(id) {
    const entry = this._get(id);
    entry.restarts += 1;
    await this.stop(id);
    if (entry.app.port) await waitPortFree(entry.app.port, 5000);
    return this.start(id);
  }

  /** Pausa: para el proceso y marca paused (excluida del watchdog, issue #6). */
  pause(id) {
    return this.stop(id, { markPaused: true });
  }

  /** Reanuda: vuelve a estado gestionado (stopped). No autolanza. */
  resume(id) {
    const entry = this._get(id);
    if (entry.status === STATES.PAUSED) this._setStatus(entry, STATES.STOPPED);
    return { id, status: entry.status };
  }

  /** ¿La app está pausada? (para el watchdog, M4). */
  isPaused(id) {
    return this._get(id).status === STATES.PAUSED;
  }

  /** Devuelve la config de la app. */
  getApp(id) {
    return this._get(id).app;
  }

  /** Ids de apps con proceso vivo esperado (running/unhealthy/starting). */
  liveIds() {
    return [...this.entries.values()].filter((e) => isLive(e.status)).map((e) => e.app.id);
  }

  /**
   * Aplica el veredicto del health check (M2): transiciona running <-> unhealthy.
   * Solo actúa si la app está viva; nunca pisa starting/stopped/paused/crashed.
   */
  applyHealth(id, healthy) {
    const entry = this._get(id);
    if (entry.status === STATES.RUNNING && !healthy) {
      this._setStatus(entry, STATES.UNHEALTHY);
    } else if (entry.status === STATES.UNHEALTHY && healthy) {
      this._setStatus(entry, STATES.RUNNING);
    }
  }
}

/** Mata el árbol de procesos. Windows: taskkill /T /F. POSIX: SIGTERM al grupo/pid. */
function killTree(pid, cb = () => {}) {
  if (!pid) return cb();
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F']);
    killer.on('exit', () => cb());
    killer.on('error', (err) => cb(err));
  } else {
    try {
      process.kill(pid, 'SIGTERM');
      cb();
    } catch (err) {
      cb(err);
    }
  }
}

/** Espera a que el puerto deje de aceptar conexiones (hasta timeoutMs). */
function waitPortFree(port, timeoutMs = 5000) {
  const start = Date.now();
  return new Promise((resolve) => {
    const check = () => {
      const sock = net.connect({ host: '127.0.0.1', port }, () => {
        sock.destroy();
        if (Date.now() - start > timeoutMs) return resolve(false);
        setTimeout(check, 200);
      });
      sock.on('error', () => {
        sock.destroy();
        resolve(true); // conexión rechazada => puerto libre
      });
    };
    check();
  });
}

module.exports = { ProcessManager, killTree, waitPortFree };
