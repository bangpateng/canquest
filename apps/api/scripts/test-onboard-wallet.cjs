/**
 * Test WalletOnboardingService — onboard satu user Keycloak + Canton.
 *
 * Usage:
 *   node scripts/test-onboard-wallet.cjs [username]
 *
 * Default username: onboardtest-<timestamp>
 *
 * Pastikan .env punya:
 *   KEYCLOAK_URL, KEYCLOAK_REALM, KEYCLOAK_ADMIN_USER, KEYCLOAK_ADMIN_PASSWORD,
 *   LEDGER_CLIENT_ID, LEDGER_CLIENT_SECRET, LEDGER_API_URL,
 *   CANTON_VALIDATOR_URL
 */

const fs = require('fs');
const path = require('path');
const { NestFactory } = require('@nestjs/core');

// Load .env sebelum Nest bootstrap (ConfigService butuh ini)
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) {
    console.warn('⚠  .env not found at', envPath, '— using process.env only');
    return;
  }
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 1) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnv();

async function main() {
  const username =
    process.argv[2]?.trim() || `onboardtest-${Date.now().toString(36)}`;
  const email = `${username}@canquest.cc`;
  const firstName = username;
  const lastName = 'mainnet';

  console.log('🚀 Onboarding:', { username, email });

  // Dynamic import supaya register-module-path jalan dulu
  require(path.join(__dirname, '..', 'register-module-path.cjs'));
  const { AppModule } = require('../src/app.module');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const onboarding = app.get(
      require('../src/canton/wallet-onboarding.service').WalletOnboardingService,
    );

    const result = await onboarding.onboardWalletForUser({
      username,
      email,
      firstName,
      lastName,
    });

    console.log('\n✅ Onboarding sukses:');
    console.log('  keycloakId:', result.keycloakId);
    console.log('  partyId:   ', result.partyId);
  } catch (err) {
    console.error('\n❌ Onboarding gagal:', err.message);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

main();