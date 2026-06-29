'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');

/**
 * Descubrimiento de PID de procesos externos para adopción manual (#24 / mejora).
 * Encuentra el proceso que escucha en un puerto y sube por la cadena de PPID
 * hasta la raíz del árbol de la app (p.ej. el wrapper `cmd /c npm run start`),
 * para que stop/restart maten el árbol completo y no dejen un padre colgando.
 */

function ps(command) {
  return execFileSync('powershell', ['-NoProfile', '-Command', command], { timeout: 5000, windowsHide: true })
    .toString().trim();
}

/** PID que escucha en un puerto TCP (o null). */
function getListenerPid(port) {
  if (!port) return null;
  if (process.platform === 'win32') {
    try {
      const out = ps(`(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess)`);
      const pid = parseInt(out, 10);
      if (Number.isInteger(pid)) return pid;
    } catch (_) { /* cae a netstat */ }
    try {
      const out = execFileSync('netstat', ['-ano', '-p', 'TCP'], { windowsHide: true }).toString();
      const line = out.split(/\r?\n/).find((l) => new RegExp(`:${port}\\b.*LISTENING`).test(l));
      if (line) { const cols = line.trim().split(/\s+/); return parseInt(cols[cols.length - 1], 10) || null; }
    } catch (_) { /* noop */ }
    return null;
  }
  // POSIX best-effort
  try {
    const out = execFileSync('ss', ['-ltnpH'], {}).toString();
    const line = out.split('\n').find((l) => new RegExp(`:${port}\\b`).test(l));
    const m = line && line.match(/pid=(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  } catch (_) { return null; }
}

/** { pid, ppid, commandLine } de un proceso, o null. */
function getProcessInfo(pid) {
  if (!pid || pid <= 4) return null;
  if (process.platform === 'win32') {
    try {
      const out = ps(`$p=Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; if($p){ '{0}|{1}|{2}' -f $p.ProcessId,$p.ParentProcessId,($p.CommandLine -replace '\\r?\\n',' ') }`);
      if (!out) return null;
      const i = out.indexOf('|'); const j = out.indexOf('|', i + 1);
      if (i < 0 || j < 0) return null;
      return { pid, ppid: parseInt(out.slice(i + 1, j), 10), commandLine: out.slice(j + 1).trim() };
    } catch (_) { return null; }
  }
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const ppid = parseInt(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1], 10);
    const cl = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim();
    return { pid, ppid, commandLine: cl };
  } catch (_) { return null; }
}

// Runtimes genéricos: NO sirven como token (matchearían cualquier cosa).
const GENERIC = new Set(['node', 'node.exe', 'sh', 'bash', 'cmd', 'cmd.exe', 'powershell', 'powershell.exe', 'pwsh', 'pwsh.exe']);

/** Tokens distintivos de la app para reconocer su árbol (args + command si no es genérico). */
function tokensFor(app) {
  const t = [];
  if (app.command && !GENERIC.has(String(app.command).toLowerCase())) t.push(String(app.command));
  for (const a of app.args || []) if (String(a).length > 1) t.push(String(a));
  return t.map((s) => s.toLowerCase());
}

function matches(commandLine, tokens) {
  if (!commandLine || !tokens.length) return false;
  const lc = commandLine.toLowerCase();
  return tokens.some((t) => lc.includes(t));
}

/**
 * Sube por PPID desde el PID que escucha hasta la raíz del árbol de la app:
 * sigue subiendo mientras el padre siga "perteneciendo" a la app (su command-line
 * contiene algún token distintivo). Se detiene en el panel, en PIDs de sistema o
 * cuando el padre ya no matchea (p.ej. la terminal que lanzó la app).
 *
 * @param {number} listenerPid
 * @param {object} app
 * @param {(pid:number)=>object|null} [getInfo]  resolver de info (para reusar un mapa)
 */
function resolveRoot(listenerPid, app, getInfo = getProcessInfo) {
  const tokens = tokensFor(app);
  let cur = listenerPid;
  const seen = new Set();
  for (let depth = 0; depth < 8; depth++) {
    if (seen.has(cur)) break;
    seen.add(cur);
    const info = getInfo(cur);
    if (!info || !info.ppid || info.ppid <= 4) break;
    if (info.ppid === process.pid) break; // nunca subir al propio panel
    const parent = getInfo(info.ppid);
    if (parent && matches(parent.commandLine, tokens)) cur = info.ppid;
    else break;
  }
  return cur;
}

/** Enumera todos los procesos con { pid, ppid, commandLine }. */
function enumerateProcesses() {
  if (process.platform === 'win32') {
    try {
      const out = ps('@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine) | ConvertTo-Json -Compress');
      if (!out) return [];
      let arr = JSON.parse(out);
      if (!Array.isArray(arr)) arr = [arr];
      return arr.filter((p) => p.CommandLine).map((p) => ({
        pid: p.ProcessId, ppid: p.ParentProcessId, commandLine: String(p.CommandLine).replace(/\r?\n/g, ' ').trim(),
      }));
    } catch (_) { return []; }
  }
  // POSIX best-effort vía /proc
  try {
    return fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d)).map((d) => getProcessInfo(parseInt(d, 10)))
      .filter((p) => p && p.commandLine);
  } catch (_) { return []; }
}

/**
 * Descubre el PID por coincidencia de command-line (para apps sin puerto).
 * Exige un match razonablemente único; si varios procesos distintos coinciden
 * con la misma fuerza y resuelven a raíces distintas, devuelve ambiguous.
 */
function findByCmdline(app) {
  const tokens = tokensFor(app);
  if (!tokens.length) return null;

  const procs = enumerateProcesses();
  if (!procs.length) return null;
  const infoMap = new Map(procs.map((p) => [p.pid, p]));
  const getInfo = (pid) => infoMap.get(pid) || getProcessInfo(pid);

  const scored = procs
    .map((p) => ({ p, score: tokens.reduce((n, t) => n + (p.commandLine.toLowerCase().includes(t) ? 1 : 0), 0) }))
    .filter((x) => x.score > 0);
  if (!scored.length) return null;

  const max = Math.max(...scored.map((x) => x.score));
  // Match débil (un único token genérico) -> no arriesgar.
  if (max < Math.min(tokens.length, 2)) return null;

  const top = scored.filter((x) => x.score === max);
  const roots = new Set(top.map((x) => resolveRoot(x.p.pid, app, getInfo)));
  if (roots.size !== 1) return { ambiguous: true, count: top.length };
  return { pid: [...roots][0], via: 'cmdline', matched: top[0].p.pid };
}

/**
 * Descubre el PID raíz adoptable de una app: primero por puerto, luego por
 * command-line (apps sin puerto o cuando el puerto no resuelve).
 * @returns {Promise<{ pid: number, listener?: number, via: string } | { ambiguous: true, count: number } | null>}
 */
async function discoverPid(app) {
  if (app.port) {
    const listener = getListenerPid(app.port);
    if (listener) return { pid: resolveRoot(listener, app), listener, via: 'port' };
  }
  return findByCmdline(app);
}

module.exports = { getListenerPid, getProcessInfo, resolveRoot, discoverPid, findByCmdline, enumerateProcesses, tokensFor };
