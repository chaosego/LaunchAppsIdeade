# PRD — LaunchApps (Panel de control de aplicaciones locales)

> Estado: v1 draft · Owner: chaosego · Fecha: 2026-06-29

## 1. Visión

Aplicación web **local** (Node) para **monitorizar, lanzar, parar, reiniciar y
auto-relanzar** un conjunto de aplicaciones que corren en la misma máquina
(Windows). Las apps objetivo son heterogéneas: proyectos **Next.js**, servidores
**Node** y servidores **Sails**. El panel se ejecuta bajo **pm2** para arrancar
automáticamente con el sistema y, a su vez, levanta las apps marcadas como
autostart.

## 2. Problema

- Hoy no hay visión unificada de qué apps locales están corriendo, en qué puerto
  y si **responden** (algunas siguen "vivas" como proceso pero se quedan
  **colgadas** y no responden).
- Relanzar apps caídas es manual.
- No hay un punto único para start/stop/restart ni para configurar el set de apps.

## 3. Objetivos (v1)

1. Cargar una lista de apps desde `apps.json` (local).
2. Mostrar en una web el **estado** de cada app: proceso vivo, puerto escuchando,
   respuesta HTTP, latencia, y resultado de un **comando de health local**.
3. Acciones por app: **start / stop / restart / pause / resume**.
4. Acciones globales: **start all / stop all / restart all / refresh all**.
5. **Autostart**: al arrancar el panel, lanzar las apps marcadas.
6. **Watchdog** configurable **por app**: cada X tiempo (default 2-3 h,
   configurable) comprobar si está lanzada y accesible; si no, relanzar.
7. **CRUD de apps** desde la UI **y** edición directa del JSON con recarga.
8. **Logs en vivo** (stdout/stderr) por app en el panel.
9. **Log de eventos** persistido (caídas, restarts, watchdog) + notificaciones en UI.

## 4. No-objetivos (v1)

- Sin autenticación (solo uso local / red interna de confianza).
- Sin gestión de apps remotas (todas las apps son **locales**).
- Sin notificaciones externas (email/Telegram/webhook) — posible v2.
- Sin clustering ni multi-host.

## 5. Decisiones técnicas

| Aspecto | Decisión |
|---|---|
| Runtime | Node.js (LTS) |
| Backend | Express |
| Vistas | EJS (server-side render) + frontend **vanilla JS** |
| Gestión de procesos | `child_process.spawn` propio; tracking de PID/estado en memoria |
| Health check | Combinable por app: **HTTP endpoint** + **TCP puerto** + **latencia/ping** + **comando local** (exit code/timeout) |
| Watchdog | Scheduler configurable **por app** (flag + intervalo) |
| Persistencia config | `apps.json` (UI escribe + watch del archivo en disco) |
| Persistencia eventos | Log de eventos en archivo (JSONL) / SQLite ligero (a decidir en diseño) |
| Logs apps | Captura de stdout/stderr en buffer + archivo; stream a UI (SSE) |
| Auth | Ninguna |
| Arranque del panel | pm2 (ecosystem file) |
| Tiempo real UI | SSE (Server-Sent Events) para estado y logs |

## 6. Modelo de datos — `apps.json` (borrador)

```jsonc
{
  "settings": {
    "watchdogDefaultIntervalMinutes": 150,   // 2.5 h
    "healthTimeoutMs": 5000,
    "port": 4000                              // puerto del panel
  },
  "apps": [
    {
      "id": "web-next",                        // único, estable
      "name": "Web Next",
      "type": "next | node | sails | custom",
      "cwd": "C:/proyectos/web-next",          // dir de trabajo
      "command": "npm",                        // ejecutable
      "args": ["run", "start"],                // argumentos
      "env": { "NODE_ENV": "production" },
      "port": 3000,
      "autostart": true,                        // lanzar al arrancar el panel
      "health": {
        "http": { "url": "http://localhost:3000/health", "expectStatus": 200 },
        "tcp": { "port": 3000 },
        "latencyWarnMs": 2000,                  // > = "lento/colgado"
        "command": { "run": "curl -fsS http://localhost:3000/health", "timeoutMs": 4000 }
      },
      "watchdog": {
        "enabled": true,
        "intervalMinutes": 150,                 // override del default
        "restartOnUnhealthy": true
      }
    }
  ]
}
```

## 7. Estados de una app

`stopped` · `starting` · `running` · `unhealthy` (proceso vivo pero no responde / latencia alta)
· `paused` (parada manual, watchdog la ignora) · `crashed` (salió con error).

## 8. Métricas de éxito

- Detectar una app colgada (responde proceso, no responde HTTP) en < 1 ciclo de health.
- Relanzar automáticamente una app caída sin intervención manual.
- Alta/baja/edición de una app sin reiniciar el panel.

## 9. Riesgos / cuestiones abiertas

- **Persistencia de eventos**: archivo JSONL vs SQLite → decidir en fase de diseño.
- **Reattach tras reinicio del panel**: si el panel cae, ¿re-adopta procesos hijos
  o los considera huérfanos? (spawn propio no sobrevive al padre salvo `detached`).
- **Windows specifics**: matar árbol de procesos (taskkill /T /F), shells (`shell: true`).
- Comando de health que cuelga → necesita timeout duro + kill.
