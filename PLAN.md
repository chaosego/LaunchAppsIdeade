# Plan de acción — LaunchApps

Plan por fases. Cada fase = milestone en GitHub. Las issues detalladas están en
`docs/ISSUES.md` y se crearán en el repo `chaosego/LaunchAppsIdeade`.

## Fase 0 — Setup (M0)
- Scaffold Express + EJS, estructura de carpetas, scripts npm.
- Config loader de `apps.json` + validación de schema.
- ecosystem pm2 del panel.

## Fase 1 — Núcleo de procesos (M1)
- ProcessManager: spawn/stop/restart, tracking de PID y estado en memoria.
- Kill de árbol de procesos en Windows (taskkill /T /F).
- Pause/resume (estado lógico que excluye del watchdog).

## Fase 2 — Health checks (M2)
- Checkers: TCP puerto, HTTP endpoint, latencia, comando local con timeout.
- Agregador de estado por app (running / unhealthy / crashed...).
- Loop de polling de estado + push a UI via SSE.

## Fase 3 — UI (M3)
- Dashboard: lista de apps con estado en vivo, badges, latencia.
- Acciones por app (start/stop/restart/pause/resume).
- Acciones globales (start/stop/restart/refresh all).

## Fase 4 — Watchdog + autostart (M4)
- Scheduler por app (intervalo configurable, default 2.5 h).
- Relanzar apps unhealthy/caídas según flag.
- Autostart al arrancar el panel.

## Fase 5 — Config CRUD + logs + eventos (M5)
- CRUD de apps desde UI (escribe `apps.json`).
- Watch del archivo en disco + recarga.
- Viewer de logs en vivo (SSE).
- Log de eventos persistido + notificaciones en UI.

## Fase 6 — Hardening / entrega (M6)
- Manejo de errores y edge cases (comando que cuelga, puerto ocupado, etc.).
- README, guía de despliegue con pm2, ejemplo de `apps.json`.
- Pruebas manuales del flujo completo.

## Orden de dependencias

```
M0 → M1 → M2 → M3
              ↘ M4 (depende de M1+M2)
M3 + M2 → M5
todo → M6
```
