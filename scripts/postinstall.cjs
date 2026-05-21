/**
 * Local dev: generate Prisma client after npm install.
 * Vercel (web only): skip — no Prisma CLI / DB on the frontend build.
 */
const { execSync } = require('child_process');

if (process.env.VERCEL || process.env.SKIP_PRISMA_GENERATE === '1') {
  process.exit(0);
}

execSync('npm run prisma:generate -w api', {
  stdio: 'inherit',
  shell: true,
});
