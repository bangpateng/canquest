// VPS 2 — runs NestJS API only.
// Next.js web is on Vercel (auto-deployed on git push).
module.exports = {
  apps: [
    {
      name: 'canquest-api',
      cwd: '/var/www/canquest/apps/api',
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'fork',
      env_production: {
        NODE_ENV: 'production',
      },
      env_file: '/var/www/canquest/apps/api/.env',
      watch: false,
      max_memory_restart: '512M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: '/var/log/canquest/api-error.log',
      out_file: '/var/log/canquest/api-out.log',
      merge_logs: true,
      restart_delay: 3000,
      autorestart: true,
    },
  ],
};
