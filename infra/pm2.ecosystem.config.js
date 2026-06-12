// VPS 2 — NestJS API (:3001) + Next.js web (:3000). Nginx fronts both (see infra/nginx/canquest.conf).
const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '..');
const apiDir = path.join(root, 'apps/api');

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

const webDir = path.join(root, 'apps/web');
const apiEnv = loadEnvFile(path.join(apiDir, '.env'));
const webEnv = loadEnvFile(path.join(webDir, '.env'));

// npm workspaces installs api deps under apps/api/node_modules (not always at repo root)
const nodePath = [path.join(root, 'node_modules'), path.join(apiDir, 'node_modules')]
  .filter((p) => fs.existsSync(p))
  .join(path.delimiter);

module.exports = {
  apps: [
    {
      name: 'canquest-web',
      cwd: webDir,
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000',
      instances: 1,
      exec_mode: 'fork',
      env_production: {
        NODE_ENV: 'production',
        ...webEnv,
      },
      watch: false,
      max_memory_restart: '768M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: path.join(root, 'logs/web-error.log'),
      out_file: path.join(root, 'logs/web-out.log'),
      merge_logs: true,
      restart_delay: 3000,
      autorestart: true,
    },
    {
      name: 'canquest-api',
      cwd: root,
      script: path.join(apiDir, 'dist/main.js'),
      // Preload fixes "No driver (HTTP)" when deps live in apps/api/node_modules
      node_args: `-r ${path.join(apiDir, 'register-module-path.cjs')}`,
      instances: 1,
      exec_mode: 'fork',
      env_production: {
        NODE_ENV: 'production',
        NODE_PATH: nodePath,
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
    {
      name: 'splice-transfer-bot',
      cwd: root,
      script: path.join(apiDir, 'scripts/splice-transfer-bot.mjs'),
      instances: 1,
      exec_mode: 'fork',
      env_production: {
        NODE_ENV: 'production',
        SPLICE_VALIDATOR_URL: env.SPLICE_VALIDATOR_URL ?? apiEnv.SPLICE_VALIDATOR_URL ?? 'http://localhost:5012',
        SPLICE_VALIDATOR_HOST_HEADER: env.SPLICE_VALIDATOR_HOST_HEADER ?? apiEnv.SPLICE_VALIDATOR_HOST_HEADER ?? 'wallet.localhost',
        CANTON_SPLICE_SECRET: env.CANTON_SPLICE_SECRET ?? apiEnv.CANTON_SPLICE_SECRET ?? '',
        SPLICE_BOT_USERNAME: env.SPLICE_BOT_USERNAME ?? apiEnv.SPLICE_BOT_USERNAME ?? 'administrator',
        SPLICE_BOT_AUTO_ACCEPT: env.SPLICE_BOT_AUTO_ACCEPT ?? apiEnv.SPLICE_BOT_AUTO_ACCEPT ?? 'true',
        SPLICE_BOT_POLL_INTERVAL_MS: env.SPLICE_BOT_POLL_INTERVAL_MS ?? apiEnv.SPLICE_BOT_POLL_INTERVAL_MS ?? '10000',
        ...apiEnv,
      },
      watch: false,
      max_memory_restart: '256M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: path.join(root, 'logs/splice-bot-error.log'),
      out_file: path.join(root, 'logs/splice-bot-out.log'),
      merge_logs: true,
      restart_delay: 5000,
      autorestart: true,
    },
  ],
};


