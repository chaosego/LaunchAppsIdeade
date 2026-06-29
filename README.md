# LaunchApps

Panel web **local** (Node + Express + EJS) para monitorizar, lanzar, parar,
reiniciar y auto-relanzar aplicaciones locales (Next.js / Node / Sails) en
Windows. Corre bajo **pm2** para arrancar con el sistema.

> Estado: en desarrollo. Roadmap por milestones M0–M6 (ver `PLAN.md` y las issues).

## Requisitos

- Node.js >= 18
- pm2 (`npm i -g pm2`)

## Instalación

```bash
npm install
cp apps.example.json apps.json   # editar con tus apps reales
npm start                         # http://localhost:4000
```

Desarrollo con recarga:

```bash
npm run dev
```

## Configuración — `apps.json`

Plantilla en [`apps.example.json`](./apps.example.json). Estructura:

- `settings`: `port` (puerto del panel), `watchdogDefaultIntervalMinutes`,
  `healthTimeoutMs`, `statusPollIntervalMs`.
- `apps[]`: por app → `id` (único), `name`, `type` (`next|node|sails|custom`),
  `cwd`, `command`, `args`, `env`, `port`, `autostart`, `health`, `watchdog`.

`apps.json` está en `.gitignore` (contiene rutas locales). Versioná solo
`apps.example.json`.

Variable de entorno opcional `LAUNCHAPPS_CONFIG` para apuntar a otro archivo de config.

## Despliegue con pm2

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup          # seguir la instrucción que imprime para arrancar con el SO
```

Comandos útiles:

```bash
pm2 status
pm2 logs launchapps
pm2 restart launchapps
```

## Estructura

```
src/
  server.js            arranque Express
  config/
    loader.js          carga apps.json (nunca crashea ante JSON inválido)
    schema.js          validación sin dependencias
  routes/
    index.js           dashboard + /healthz
views/                 plantillas EJS
public/                css + js estáticos
ecosystem.config.js    config pm2 del panel
```
