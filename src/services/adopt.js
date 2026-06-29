'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const { runHealth } = require('./health/aggregate');
const { isPidAlive } = require('./processManager');
const { STATES } = require('./states');

/**
 * Re-adopción de procesos huérfanos (issue #24).
 *
 * Tras un reinicio del panel, lee los PIDs persistidos (pidStore) y, por cada
 * app cuyo PID sigue vivo, verifica su IDENTIDAD antes de adoptarlo (para evitar
 * adoptar un proceso ajeno que haya reciclado el PID):
 *   - App con health (tcp/http) -> adopta si el health responde OK.
 *   - App sin health            -> adopta si el command-line del PID coincide.
 *   - No verificable             -> no adopta (queda para reconcile/aviso).
 */

/** Lee la línea de comando de un PID (Windows: Win32_Process; Linux: /proc). */
function getCommandLine(pid) {
  if (process.platform === 'win32') {
    try {
      const out = execFileSync('powershell', [
        '-NoProfile', '-Command',
        `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
      ], { timeout: 4000, windowsHide: true });
      return out.toString().trim() || null;
    } catch (_) { return null; }
  }
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim() || null;
  } catch (_) { return null; }
}

function matchesCmdline(app, cmdline) {
  if (!cmdline) return false;
  const lc = cmdline.toLowerCase();
  if (!lc.includes(String(app.command).toLowerCase())) return false;
  if (app.args && app.args.length) return lc.includes(String(app.args[0]).toLowerCase());
  return true;
}

async function verifyIdentity(app, pid, timeoutMs) {
  const h = app.health || {};
  if (h.tcp || h.http) {
    const r = await runHealth(app, { timeoutMs });
    return { ok: r.healthy, method: 'health', detail: r.reason };
  }
  const cl = getCommandLine(pid);
  return { ok: matchesCmdline(app, cl), method: 'cmdline', detail: cl };
}

/**
 * @returns {Promise<{ adopted: string[], stale: string[], unverified: string[] }>}
 */
async function adoptOrphans(pm, apps, pidStore, {
  timeoutMs = 5000,
  onAdopt = () => {},
  onStale = () => {},
  onUnverified = () => {},
} = {}) {
  const result = { adopted: [], stale: [], unverified: [] };
  if (!pidStore) return result;

  await Promise.all(apps.map(async (app) => {
    const rec = pidStore.get(app.id);
    if (!rec || !rec.pid) return;

    // Solo nos interesa lo que el panel cree apagado al arrancar.
    if (pm.getState(app.id).status !== STATES.STOPPED) return;

    if (!isPidAlive(rec.pid)) {
      pidStore.remove(app.id);
      result.stale.push(app.id);
      onStale(app.id);
      return;
    }

    const v = await verifyIdentity(app, rec.pid, timeoutMs);
    if (v.ok) {
      pm.adopt(app.id, rec.pid, { startedAt: rec.startedAt });
      result.adopted.push(app.id);
      onAdopt(app.id, v.method);
    } else {
      result.unverified.push(app.id);
      onUnverified(app.id, rec.pid, v.method);
    }
  }));

  return result;
}

module.exports = { adoptOrphans, getCommandLine, matchesCmdline };
