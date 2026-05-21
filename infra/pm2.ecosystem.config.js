// VPS 2 — runs NestJS API only.
// Next.js web is on Vercel (auto-deployed on git push).
const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '..');
const apiDir = path.join(root, 'apps/api');
const rootModules = path.join(root, 'node_modules');

/** Load apps/api/.env into PM2 env (env_file is unreliable on some PM2 versions). */
function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return {};
  const out = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const apiEnv = loadEnvFile(path.join(apiDir, '.env'));

module.exports = {
  apps: [
    {
      name: 'canquest-api',
      // cwd = repo root: npm workspaces hoist deps to ~/canquest/node_modules
      cwd: root,
      script: path.join(apiDir, 'dist/main.js'),
      instances: 1,
      exec_mode: 'fork',
      env_production: {
        NODE_ENV: 'production',
        // Help Node find hoisted workspace packages (@nestjs/platform-express, etc.)
        NODE_PATH: rootModules,
        ...apiEnv,
      },
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
