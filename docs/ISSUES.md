# Backlog de issues — LaunchApps

Listas para crear en `chaosego/LaunchAppsIdeade`. Agrupadas por milestone.
Labels sugeridos: `setup`, `backend`, `frontend`, `health`, `watchdog`, `config`, `logs`, `docs`.

---

## M0 — Setup

### #1 Scaffold del proyecto (Express + EJS)
**Labels:** setup, backend
Estructura base del panel.
- [ ] `package.json`, scripts `start`/`dev`.
- [ ] Servidor Express + motor EJS.
- [ ] Estructura: `src/` (server, services, routes), `views/`, `public/`, `config/`.
- [ ] Endpoint `GET /` que renderiza dashboard vacío.
- [ ] `.gitignore`, `.editorconfig`.

### #2 Config loader + validación de `apps.json`
**Labels:** setup, config, backend
- [ ] Cargar `apps.json` al arrancar.
- [ ] Validar schema (ids únicos, campos requeridos, defaults de `settings`).
- [ ] Errores claros si el JSON es inválido (no crashear el panel).
- [ ] `apps.example.json` documentado.

### #3 ecosystem pm2 del panel
**Labels:** setup, docs
- [ ] `ecosystem.config.js` para correr el panel bajo pm2.
- [ ] Doc: `pm2 start ecosystem.config.js` + `pm2 save` + `pm2 startup`.

---

## M1 — Núcleo de procesos

### #4 ProcessManager: spawn / stop / restart
**Labels:** backend
- [ ] `spawn` con `cwd`, `command`, `args`, `env`.
- [ ] Track de PID y estado en memoria por app.
- [ ] `stop` con kill de **árbol** de procesos en Windows (`taskkill /PID <pid> /T /F`).
- [ ] `restart` = stop + start con espera de liberación de puerto.
- [ ] Eventos: `exit`, `error` → actualizar estado (`crashed`).

### #5 Estados y máquina de estados de la app
**Labels:** backend
- [ ] Estados: `stopped`, `starting`, `running`, `unhealthy`, `paused`, `crashed`.
- [ ] Transiciones válidas + guardas.
- [ ] API interna para consultar estado actual de cada app.

### #6 Pause / resume
**Labels:** backend
- [ ] `pause`: parar la app y marcar estado `paused` (excluida del watchdog).
- [ ] `resume`: volver a estado gestionado (no autolanzar salvo acción explícita).

---

## M2 — Health checks

### #7 Checker TCP de puerto
**Labels:** health, backend
- [ ] Comprobar si el puerto acepta conexión (con timeout).

### #8 Checker HTTP endpoint
**Labels:** health, backend
- [ ] GET a `health.http.url`, validar `expectStatus`, medir latencia.
- [ ] Timeout configurable; clasificar timeout como `unhealthy`.

### #9 Checker de comando local
**Labels:** health, backend
- [ ] Ejecutar `health.command.run` con `timeoutMs`; **kill duro** si cuelga.
- [ ] Evaluar exit code (0 = ok) y/o salida esperada.

### #10 Agregador de estado + latencia/colgado
**Labels:** health, backend
- [ ] Combinar resultados (proceso + tcp + http + comando) en un estado único.
- [ ] Detectar "vivo pero colgado": proceso up + http timeout/latencia > `latencyWarnMs` → `unhealthy`.

### #11 Loop de polling + push SSE
**Labels:** health, backend
- [ ] Intervalo de polling de estado configurable.
- [ ] Endpoint SSE `GET /events/status` que emite cambios de estado a la UI.

---

## M3 — UI

### #12 Dashboard: lista de apps con estado en vivo
**Labels:** frontend
- [ ] Tabla/tarjetas por app: nombre, tipo, puerto, estado, latencia.
- [ ] Badges de color por estado; actualización en vivo via SSE.

### #13 Acciones por app
**Labels:** frontend, backend
- [ ] Botones start / stop / restart / pause / resume por app.
- [ ] Endpoints `POST /apps/:id/{start,stop,restart,pause,resume}`.
- [ ] Feedback de carga + manejo de errores en UI.

### #14 Acciones globales
**Labels:** frontend, backend
- [ ] start all / stop all / restart all / refresh all.
- [ ] Endpoints `POST /apps/{start-all,stop-all,restart-all,refresh-all}`.
- [ ] Ejecución secuencial/controlada para no saturar la máquina.

---

## M4 — Watchdog + autostart

### #15 Scheduler de watchdog por app
**Labels:** watchdog, backend
- [ ] Timer por app con `intervalMinutes` (default `settings.watchdogDefaultIntervalMinutes`).
- [ ] Saltar apps `paused` o con `watchdog.enabled=false`.

### #16 Auto-restart de apps unhealthy/caídas
**Labels:** watchdog, backend
- [ ] Si app no accesible y `restartOnUnhealthy` → relanzar.
- [ ] Backoff / límite de reintentos para evitar loops.
- [ ] Registrar evento de cada relanzamiento.

### #17 Autostart al arrancar el panel
**Labels:** watchdog, backend
- [ ] Al iniciar, lanzar apps con `autostart=true`.
- [ ] Lanzamiento escalonado (evitar pico de CPU).

---

## M5 — Config CRUD + logs + eventos

### #18 CRUD de apps desde la UI
**Labels:** config, frontend, backend
- [ ] Formulario alta/edición/borrado de apps.
- [ ] Persistir en `apps.json` de forma atómica (no corromper el archivo).
- [ ] Validar antes de guardar.

### #19 Watch de `apps.json` + recarga
**Labels:** config, backend
- [ ] Detectar cambios en disco y recargar config sin reiniciar el panel.
- [ ] Reconciliar con procesos en curso (no matar apps corriendo por un reload).

### #20 Viewer de logs en vivo
**Labels:** logs, backend, frontend
- [ ] Capturar stdout/stderr de cada proceso (buffer + archivo por app).
- [ ] SSE `GET /apps/:id/logs` con tail/stream en la UI.
- [ ] Límite de buffer / rotación básica.

### #21 Log de eventos + notificaciones UI
**Labels:** logs, frontend, backend
- [ ] Persistir eventos (caída, restart, watchdog, start/stop manual) en JSONL/SQLite.
- [ ] Vista de historial consultable.
- [ ] Toast/badge en UI al producirse un evento relevante.

---

## M6 — Hardening / entrega

### #22 Edge cases y robustez
**Labels:** backend
- [ ] Puerto ocupado al arrancar; comando inexistente; cwd inválido.
- [ ] Comando de health que cuelga; proceso zombie.
- [ ] Reattach/huérfanos tras caída del panel (decisión documentada).

### #23 Documentación y entrega
**Labels:** docs
- [ ] README: instalación, `apps.json`, despliegue con pm2.
- [ ] Ejemplo completo de `apps.json` (Next/Node/Sails).
- [ ] Guía de troubleshooting.
