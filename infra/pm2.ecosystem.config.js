// VPS 2 — runs NestJS API only.
// Next.js web is on Vercel (auto-deployed on git push).
// Paths resolve from repo root so this works whether the app lives in
// /root/canquest, /var/www/canquest, or elsewhere.
const path = require('path');

const root = path.resolve(__dirname, '..');

module.exports = {
  apps: [
    {
      name: 'canquest-api',
      cwd: root,
      script: path.join(root, 'apps/api/dist/main.js'),
      instances: 1,
      exec_mode: 'fork',
      env_production: {
        NODE_ENV: 'production',
      },
      env_file: path.join(root, 'apps/api/.env'),
      watch: false,
      max_memory_restart: '512M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: path.join(root, 'logs/api-error.log'),
      out_file: path.join(root, 'logs/api-out.log'),
      merge_logs: true,
      restart_delay: 3000,
      autorestart: true,
    },
  ],
};
