# LaunchApps

Panel web **local** (Node + Express + EJS) para monitorizar, lanzar, parar,
reiniciar y **auto-relanzar** aplicaciones locales (Next.js / Node / Sails) en
Windows. Corre bajo **pm2** para arrancar con el sistema y levantar las apps
marcadas con autostart.

## Características

- **Estado en vivo** de cada app (SSE): proceso, puerto, respuesta HTTP, latencia.
- **Detección de "colgado"**: distingue proceso vivo pero que no responde.
- **Acciones** por app: start / stop / restart / pause / resume.
- **Acciones globales**: iniciar / parar / reiniciar / refrescar todas.
- **Watchdog** por app: relanza caídas/colgadas cada X tiempo (configurable), con
  límite de reintentos.
- **Autostart** escalonado al arrancar el panel.
- **CRUD de apps** desde la UI + **recarga en caliente** al editar `apps.json`.
- **Logs en vivo** (stdout/stderr) por app, persistidos en JSONL con búsqueda,
  filtro por stream y paginación; el historial sobrevive reinicios del panel.
- **Log de eventos** persistido + notificaciones (toasts) en la UI.

## Requisitos

- Node.js >= 18 (usa `fetch` global)
- pm2 (`npm i -g pm2`) para despliegue

## Instalación

```bash
npm install
cp apps.example.json apps.json   # editar con tus apps reales
npm start                         # http://localhost:4000
```

Desarrollo con recarga del panel:

```bash
npm run dev
```

## Configuración — `apps.json`

`apps.json` está en `.gitignore` (contiene rutas locales). Versioná solo
`apps.example.json`. Variable de entorno opcional `LAUNCHAPPS_CONFIG` para
apuntar a otra ruta de config.

### `settings`

| Campo | Default | Descripción |
|---|---|---|
| `port` | 4000 | Puerto del panel |
| `watchdogDefaultIntervalMinutes` | 150 | Intervalo de watchdog por defecto (2.5 h) |
| `healthTimeoutMs` | 5000 | Timeout de los health checks |
| `statusPollIntervalMs` | 10000 | Frecuencia de sondeo de estado (UI en vivo) |

### `apps[]`

| Campo | Req. | Descripción |
|---|---|---|
| `id` | sí | Identificador único y estable |
| `name` | sí | Nombre visible |
| `type` | no | `next` \| `node` \| `sails` \| `custom` (default `custom`) |
| `cwd` | sí | Directorio de trabajo (debe existir) |
| `command` | sí | Ejecutable (`npm`, `node`, …) |
| `args` | no | Array de argumentos |
| `env` | no | Variables de entorno (objeto de strings) |
| `port` | no | Puerto que usa la app |
| `autostart` | no | Lanzar al arrancar el panel |
| `health` | no | Pruebas de salud (ver abajo) |
| `watchdog` | no | Auto-relanzado (ver abajo) |

#### `health`

| Campo | Descripción |
|---|---|
| `http.url` / `http.expectStatus` | GET a la URL; ok si el status coincide (default 200) |
| `tcp.port` | Comprueba que el puerto acepta conexión |
| `command.run` / `command.timeoutMs` | Comando local; exit 0 = ok; se mata si supera el timeout |
| `latencyWarnMs` | Si la respuesta HTTP tarda más, se marca `unhealthy` (colgado) |

#### `watchdog`

| Campo | Default | Descripción |
|---|---|---|
| `enabled` | false | Activa el watchdog para esta app |
| `intervalMinutes` | `settings.watchdogDefaultIntervalMinutes` | Cada cuánto comprueba |
| `restartOnUnhealthy` | true | Relanza también si está colgada (no solo caída) |
| `maxRetries` | 3 | Reintentos consecutivos antes de rendirse |

### Ejemplo completo

```jsonc
{
  "settings": { "port": 4000, "watchdogDefaultIntervalMinutes": 150, "healthTimeoutMs": 5000, "statusPollIntervalMs": 10000 },
  "apps": [
    {
      "id": "web-next", "name": "Web Next", "type": "next",
      "cwd": "C:/proyectos/web-next", "command": "npm", "args": ["run", "start"],
      "env": { "NODE_ENV": "production" }, "port": 3000, "autostart": true,
      "health": {
        "http": { "url": "http://localhost:3000/", "expectStatus": 200 },
        "tcp": { "port": 3000 }, "latencyWarnMs": 2000
      },
      "watchdog": { "enabled": true, "intervalMinutes": 150, "restartOnUnhealthy": true, "maxRetries": 3 }
    },
    {
      "id": "api-node", "name": "API Node", "type": "node",
      "cwd": "C:/proyectos/api", "command": "node", "args": ["server.js"], "port": 4001,
      "health": { "tcp": { "port": 4001 }, "command": { "run": "curl -fsS http://localhost:4001/health", "timeoutMs": 4000 } },
      "watchdog": { "enabled": true }
    },
    {
      "id": "api-sails", "name": "API Sails", "type": "sails",
      "cwd": "C:/proyectos/sails-app", "command": "node", "args": ["app.js"], "port": 1337,
      "health": { "http": { "url": "http://localhost:1337/health" }, "tcp": { "port": 1337 } },
      "watchdog": { "enabled": false }
    }
  ]
}
```

## Estados de una app

`stopped` · `starting` · `running` · `unhealthy` (vivo pero no responde / lento)
· `paused` (parada manual, el watchdog la ignora) · `crashed` (salió con error).

## Despliegue con pm2

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup          # seguir la instrucción que imprime para arrancar con el SO
```

Útiles: `pm2 status`, `pm2 logs launchapps`, `pm2 restart launchapps`.

## API HTTP

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/` | Dashboard |
| GET | `/healthz` | Healthcheck del panel |
| GET | `/events/status` | SSE: snapshot + estado + health + eventos |
| GET | `/events/log?limit=N` | Historial de eventos |
| GET | `/apps/:id/logs` | SSE: logs en vivo de una app |
| GET | `/apps/:id/logs/query` | Logs con búsqueda/filtro/paginación (`search`,`stream`,`from`,`to`,`page`,`limit`) |
| POST | `/apps/:id/{start,stop,restart,pause,resume}` | Acción por app |
| POST | `/apps/{start-all,stop-all,restart-all,refresh-all}` | Acciones globales |
| GET | `/config/apps` | Lista settings + apps |
| POST | `/config/apps` | Alta de app |
| PUT | `/config/apps/:id` | Edición de app |
| DELETE | `/config/apps/:id` | Borrado de app |

## Estructura

```
src/
  server.js              arranque Express + cableado
  config/
    loader.js            carga apps.json (nunca crashea)
    schema.js            validación sin dependencias
    store.js             escritura atómica de apps.json
    manager.js           recarga en caliente + watch de archivo
  services/
    processManager.js    spawn/stop/restart, estados, pause/resume
    states.js            máquina de estados
    healthMonitor.js     polling de health + transiciones
    health/{tcp,http,command,aggregate}.js  checkers + detección de colgado
    watchdog.js          auto-relanzado por app con backoff
    autostart.js         lanzamiento escalonado al arrancar
    reconcile.js         detección de instancias externas
    adopt.js             re-adopción de procesos huérfanos (verifica identidad)
    pidStore.js          persistencia de PIDs (data/processes.json)
    logStore.js          captura de logs (buffer + archivo)
    eventLog.js          persistencia de eventos (JSONL)
  routes/                index, events, actions, config, logs
views/                   plantillas EJS
public/                  css + js del panel
ecosystem.config.js      config pm2 del panel
```

## Troubleshooting

- **Una app no arranca** → revisá el modal de **logs** (📄). Causas típicas:
  `cwd` inexistente (el panel lo avisa), comando mal escrito, puerto ocupado.
- **Aparece como `unhealthy` pero el proceso vive** → está "colgada": no responde
  al HTTP, el puerto no sirve, o la latencia supera `latencyWarnMs`. Revisá el
  endpoint de `health.http.url` y que el `tcp.port` apunte al puerto correcto.
- **El watchdog no relanza** → comprobá `watchdog.enabled: true` y que la app no
  esté en `paused`. Tras `maxRetries` fallidos seguidos se rinde hasta que vuelva
  a estar sana (verás un evento `give-up`).
- **Cambios en `apps.json` no se aplican** → se recargan solos (watch). Si editaste
  con un editor que hace escritura atómica rara, reiniciá el panel.
- **Huérfanos tras reiniciar el panel**: el panel **re-adopta** los procesos que
  siguen vivos. Al spawnear guarda los PID en `data/processes.json`; al arrancar,
  por cada app con PID vivo verifica su identidad (health OK si hay health, o
  coincidencia de command-line si no) y la adopta (estado `running`, marcada con
  ⚓). Un proceso adoptado se puede parar/reiniciar normalmente, pero **sus logs
  no se recapturan** hasta que lo reinicies desde el panel (no hay handle del
  proceso). Si un PID está vivo pero no se puede verificar, no se adopta (se
  registra un aviso `adopt-unverified`); si una instancia externa sin PID guardado
  responde, se registra como `external`. En ambos casos el autostart no la duplica.

## Roadmap (hecho)

M0 Setup · M1 Procesos · M2 Health · M3 UI · M4 Watchdog+Autostart · M5 Config/Logs/Eventos · M6 Hardening.
