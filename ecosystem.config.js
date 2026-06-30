// PM2 process manager config — keeps the API and Dashboard running, restarts
// on crash, and gives `pm2 logs` / `pm2 restart` as the day-to-day operational
// commands instead of bare `node` processes that die with the SSH session.
//
// Usage:
//   pm2 start ecosystem.config.js
//   pm2 save                      # persist process list across reboots
//   pm2 startup                   # generate the systemd unit that runs `pm2 resurrect` on boot
//
// This is intentionally PM2 rather than systemd units for this testing-deploy
// pass — fewer moving parts to debug remotely, and `pm2 logs --lines 100` beats
// `journalctl -u slotwise-api -f` for quick iteration. Revisit for systemd (or
// containerized) once this moves past "testing" into something unattended.

module.exports = {
  apps: [
    {
      name: 'slotwise-api',
      cwd: './apps/api',
      script: 'dist/server.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '400M',
      error_file: '../../logs/api-error.log',
      out_file: '../../logs/api-out.log',
      time: true,
    },
    {
      name: 'slotwise-dashboard',
      cwd: './apps/dashboard',
      script: 'node_modules/.bin/next',
      args: 'start -p 3000',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '400M',
      error_file: '../../logs/dashboard-error.log',
      out_file: '../../logs/dashboard-out.log',
      time: true,
    },
  ],
};
