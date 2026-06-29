#!/usr/bin/env bash
# Bulk-create milestones, labels e issues en chaosego/LaunchAppsIdeade
# Requiere: gh CLI logueado con permiso de escritura.
#   gh auth login   (scopes: repo)
# Uso:
#   bash scripts/create-github-issues.sh
set -euo pipefail

REPO="chaosego/LaunchAppsIdeade"

echo ">> Repo: $REPO"
gh repo view "$REPO" >/dev/null

# ---------- Labels ----------
echo ">> Creando labels..."
create_label() {
  local name="$1" color="$2" desc="$3"
  gh label create "$name" --repo "$REPO" --color "$color" --description "$desc" 2>/dev/null \
    || gh label edit "$name" --repo "$REPO" --color "$color" --description "$desc" 2>/dev/null \
    || true
}
create_label setup     "0e8a16" "Scaffold y configuración inicial"
create_label backend   "1d76db" "Lógica de servidor"
create_label frontend  "5319e7" "UI / panel"
create_label health    "fbca04" "Health checks"
create_label watchdog  "d93f0b" "Auto-restart / scheduler"
create_label config    "c2e0c6" "apps.json / configuración"
create_label logs      "bfdadc" "Logs y eventos"
create_label docs      "0075ca" "Documentación"

# ---------- Milestones ----------
echo ">> Creando milestones..."
create_milestone() {
  local title="$1" desc="$2"
  gh api "repos/$REPO/milestones" -f title="$title" -f description="$desc" -f state=open >/dev/null 2>&1 || true
}
create_milestone "M0 — Setup"                       "Scaffold, config loader, pm2"
create_milestone "M1 — Núcleo de procesos"          "ProcessManager, estados, pause/resume"
create_milestone "M2 — Health checks"               "TCP, HTTP, latencia, comando local, polling SSE"
create_milestone "M3 — UI"                          "Dashboard, acciones por app y globales"
create_milestone "M4 — Watchdog + autostart"        "Scheduler por app, auto-restart, autostart"
create_milestone "M5 — Config CRUD + logs + eventos" "CRUD UI, watch archivo, logs en vivo, eventos"
create_milestone "M6 — Hardening / entrega"         "Edge cases, docs, pruebas"

# ---------- Issues ----------
echo ">> Creando issues..."
mk() {
  local title="$1" milestone="$2" labels="$3" body="$4"
  gh issue create --repo "$REPO" \
    --title "$title" \
    --milestone "$milestone" \
    --label "$labels" \
    --body "$body"
}

mk "[M0] Scaffold del proyecto (Express + EJS)" "M0 — Setup" "setup,backend" \
"Estructura base del panel.

- [ ] \`package.json\`, scripts \`start\`/\`dev\`.
- [ ] Servidor Express + motor EJS.
- [ ] Estructura: \`src/\` (server, services, routes), \`views/\`, \`public/\`, \`config/\`.
- [ ] Endpoint \`GET /\` que renderiza dashboard vacío.
- [ ] \`.gitignore\`, \`.editorconfig\`."

mk "[M0] Config loader + validación de apps.json" "M0 — Setup" "setup,config,backend" \
"Cargar y validar la configuración de apps.

- [ ] Cargar \`apps.json\` al arrancar.
- [ ] Validar schema (ids únicos, campos requeridos, defaults de \`settings\`).
- [ ] Errores claros si el JSON es inválido (no crashear el panel).
- [ ] \`apps.example.json\` documentado."

mk "[M0] ecosystem pm2 del panel" "M0 — Setup" "setup,docs" \
"Arranque automático del panel bajo pm2.

- [ ] \`ecosystem.config.js\` para correr el panel bajo pm2.
- [ ] Doc: \`pm2 start ecosystem.config.js\` + \`pm2 save\` + \`pm2 startup\`."

mk "[M1] ProcessManager: spawn / stop / restart" "M1 — Núcleo de procesos" "backend" \
"Núcleo de gestión de procesos hijos con child_process.

- [ ] \`spawn\` con \`cwd\`, \`command\`, \`args\`, \`env\`.
- [ ] Track de PID y estado en memoria por app.
- [ ] \`stop\` con kill de árbol de procesos en Windows (\`taskkill /PID <pid> /T /F\`).
- [ ] \`restart\` = stop + start con espera de liberación de puerto.
- [ ] Eventos: \`exit\`, \`error\` -> actualizar estado (\`crashed\`)."

mk "[M1] Estados y máquina de estados de la app" "M1 — Núcleo de procesos" "backend" \
"Modelar el ciclo de vida de cada app.

- [ ] Estados: \`stopped\`, \`starting\`, \`running\`, \`unhealthy\`, \`paused\`, \`crashed\`.
- [ ] Transiciones válidas + guardas.
- [ ] API interna para consultar estado actual de cada app."

mk "[M1] Pause / resume de apps" "M1 — Núcleo de procesos" "backend" \
"Estado pausado que excluye del watchdog.

- [ ] \`pause\`: parar la app y marcar estado \`paused\` (excluida del watchdog).
- [ ] \`resume\`: volver a estado gestionado (no autolanzar salvo acción explícita)."

mk "[M2] Checker TCP de puerto" "M2 — Health checks" "health,backend" \
"- [ ] Comprobar si el puerto acepta conexión (con timeout)."

mk "[M2] Checker HTTP endpoint" "M2 — Health checks" "health,backend" \
"- [ ] GET a \`health.http.url\`, validar \`expectStatus\`, medir latencia.
- [ ] Timeout configurable; clasificar timeout como \`unhealthy\`."

mk "[M2] Checker de comando local" "M2 — Health checks" "health,backend" \
"- [ ] Ejecutar \`health.command.run\` con \`timeoutMs\`; kill duro si cuelga.
- [ ] Evaluar exit code (0 = ok) y/o salida esperada."

mk "[M2] Agregador de estado + detección de colgado" "M2 — Health checks" "health,backend" \
"- [ ] Combinar resultados (proceso + tcp + http + comando) en un estado único.
- [ ] Detectar 'vivo pero colgado': proceso up + http timeout/latencia > \`latencyWarnMs\` -> \`unhealthy\`."

mk "[M2] Loop de polling + push SSE" "M2 — Health checks" "health,backend" \
"- [ ] Intervalo de polling de estado configurable.
- [ ] Endpoint SSE \`GET /events/status\` que emite cambios de estado a la UI."

mk "[M3] Dashboard: lista de apps con estado en vivo" "M3 — UI" "frontend" \
"- [ ] Tabla/tarjetas por app: nombre, tipo, puerto, estado, latencia.
- [ ] Badges de color por estado; actualización en vivo via SSE."

mk "[M3] Acciones por app" "M3 — UI" "frontend,backend" \
"- [ ] Botones start / stop / restart / pause / resume por app.
- [ ] Endpoints \`POST /apps/:id/{start,stop,restart,pause,resume}\`.
- [ ] Feedback de carga + manejo de errores en UI."

mk "[M3] Acciones globales" "M3 — UI" "frontend,backend" \
"- [ ] start all / stop all / restart all / refresh all.
- [ ] Endpoints \`POST /apps/{start-all,stop-all,restart-all,refresh-all}\`.
- [ ] Ejecución secuencial/controlada para no saturar la máquina."

mk "[M4] Scheduler de watchdog por app" "M4 — Watchdog + autostart" "watchdog,backend" \
"- [ ] Timer por app con \`intervalMinutes\` (default \`settings.watchdogDefaultIntervalMinutes\`).
- [ ] Saltar apps \`paused\` o con \`watchdog.enabled=false\`."

mk "[M4] Auto-restart de apps unhealthy/caídas" "M4 — Watchdog + autostart" "watchdog,backend" \
"- [ ] Si app no accesible y \`restartOnUnhealthy\` -> relanzar.
- [ ] Backoff / límite de reintentos para evitar loops.
- [ ] Registrar evento de cada relanzamiento."

mk "[M4] Autostart al arrancar el panel" "M4 — Watchdog + autostart" "watchdog,backend" \
"- [ ] Al iniciar, lanzar apps con \`autostart=true\`.
- [ ] Lanzamiento escalonado (evitar pico de CPU)."

mk "[M5] CRUD de apps desde la UI" "M5 — Config CRUD + logs + eventos" "config,frontend,backend" \
"- [ ] Formulario alta/edición/borrado de apps.
- [ ] Persistir en \`apps.json\` de forma atómica (no corromper el archivo).
- [ ] Validar antes de guardar."

mk "[M5] Watch de apps.json + recarga" "M5 — Config CRUD + logs + eventos" "config,backend" \
"- [ ] Detectar cambios en disco y recargar config sin reiniciar el panel.
- [ ] Reconciliar con procesos en curso (no matar apps corriendo por un reload)."

mk "[M5] Viewer de logs en vivo" "M5 — Config CRUD + logs + eventos" "logs,backend,frontend" \
"- [ ] Capturar stdout/stderr de cada proceso (buffer + archivo por app).
- [ ] SSE \`GET /apps/:id/logs\` con tail/stream en la UI.
- [ ] Límite de buffer / rotación básica."

mk "[M5] Log de eventos + notificaciones UI" "M5 — Config CRUD + logs + eventos" "logs,frontend,backend" \
"- [ ] Persistir eventos (caída, restart, watchdog, start/stop manual) en JSONL/SQLite.
- [ ] Vista de historial consultable.
- [ ] Toast/badge en UI al producirse un evento relevante."

mk "[M6] Edge cases y robustez" "M6 — Hardening / entrega" "backend" \
"- [ ] Puerto ocupado al arrancar; comando inexistente; cwd inválido.
- [ ] Comando de health que cuelga; proceso zombie.
- [ ] Reattach/huérfanos tras caída del panel (decisión documentada)."

mk "[M6] Documentación y entrega" "M6 — Hardening / entrega" "docs" \
"- [ ] README: instalación, \`apps.json\`, despliegue con pm2.
- [ ] Ejemplo completo de \`apps.json\` (Next/Node/Sails).
- [ ] Guía de troubleshooting."

echo ">> Listo. Issues creadas en $REPO"
