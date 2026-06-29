'use strict';

/**
 * Máquina de estados de una app (issue #5).
 *
 *   stopped   ──start──▶ starting ──(spawn ok)──▶ running
 *   running   ──(health falla)──▶ unhealthy ──(health ok)──▶ running
 *   *         ──stop──▶ stopped
 *   *         ──(exit !=0 inesperado)──▶ crashed
 *   *         ──pause──▶ paused   (excluida del watchdog)
 *   paused    ──resume──▶ stopped
 */

const STATES = Object.freeze({
  STOPPED: 'stopped',
  STARTING: 'starting',
  RUNNING: 'running',
  UNHEALTHY: 'unhealthy',
  PAUSED: 'paused',
  CRASHED: 'crashed',
});

const ALL = Object.freeze(Object.values(STATES));

// Transiciones permitidas: from -> Set(to)
const TRANSITIONS = Object.freeze({
  // RUNNING desde STOPPED/CRASHED es válido por adopción de un proceso externo (#24).
  [STATES.STOPPED]: new Set([STATES.STARTING, STATES.RUNNING, STATES.PAUSED]),
  [STATES.STARTING]: new Set([STATES.RUNNING, STATES.CRASHED, STATES.STOPPED]),
  [STATES.RUNNING]: new Set([STATES.UNHEALTHY, STATES.CRASHED, STATES.STOPPED, STATES.STARTING, STATES.PAUSED]),
  [STATES.UNHEALTHY]: new Set([STATES.RUNNING, STATES.CRASHED, STATES.STOPPED, STATES.STARTING, STATES.PAUSED]),
  [STATES.CRASHED]: new Set([STATES.STARTING, STATES.RUNNING, STATES.STOPPED, STATES.PAUSED]),
  [STATES.PAUSED]: new Set([STATES.STOPPED, STATES.STARTING]),
});

/** ¿Es válida la transición from -> to? */
function canTransition(from, to) {
  if (!ALL.includes(to)) return false;
  if (from === to) return true; // no-op permitido (idempotencia)
  const allowed = TRANSITIONS[from];
  return Boolean(allowed && allowed.has(to));
}

/** Estados en los que la app se considera "lanzada" (proceso vivo esperado). */
function isLive(state) {
  return state === STATES.STARTING || state === STATES.RUNNING || state === STATES.UNHEALTHY;
}

module.exports = { STATES, ALL, TRANSITIONS, canTransition, isLive };
