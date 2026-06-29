// Configuración pm2 para el panel LaunchApps.
// El panel arranca automáticamente con el sistema y, a su vez, lanza las
// apps marcadas con autostart (issue #17, M4).
//
// Uso:
//   pm2 start ecosystem.config.js
//   pm2 save
//   pm2 startup        (genera el comando para arrancar pm2 con el SO)
module.exports = {
  apps: [
    {
      name: 'launchapps',
      script: 'src/server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
