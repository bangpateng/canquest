/**
 * List packages on the participant and probe canquest-v4 ACS filter.
 * Templates: Main:UserAccount, Main:WalletRegistration, Main:QuestCampaign,
 *            Main:QuestClaim, Main:DailyCheckIn, Main:SpinExecution, Main:SpinCcReward
 * Usage: node scripts/verify-daml-package.cjs
 */
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 1) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnv();

const baseUrl = (process.env.CANTON_JSON_API_URL || 'http://127.0.0.1:7575').replace(/\/$/, '');
const secret = process.env.CANTON_SPLICE_SECRET || 'unsafe';
const audience = process.env.CANTON_LEDGER_API_AUDIENCE || 'https://canton.network.global';
const user = process.env.CANTON_LEDGER_API_USER || 'ledger-api-user';
const expectedPkg = process.env.CANTON_DAML_PACKAGE_ID?.trim();
const packageName = process.env.CANTON_DAML_PACKAGE_NAME?.trim() || 'canquest-v4';
const operator =
  process.env.CANTON_OPERATOR_PARTY_ID?.trim() ||
  process.env.CANTON_VALIDATOR_PARTY_ID?.trim();

function headers() {
  const token = jwt.sign({ sub: user, aud: audience }, secret, {
    algorithm: 'HS256',
    expiresIn: '5m',
  });
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function listPackages() {
  const res = await fetch(`${baseUrl}/v2/packages`, {
    headers: headers(),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error('GET /v2/packages failed', res.status, text.slice(0, 300));
    process.exit(1);
  }
  return JSON.parse(text);
}

async function probeAcs(templateId) {
  if (!operator) {
    console.log('Skip ACS probe — no operator/validator party in env');
    return;
  }
  let offset = 0;
  try {
    const endRes = await fetch(`${baseUrl}/v2/state/ledger-end`, {
      headers: headers(),
      signal: AbortSignal.timeout(8_000),
    });
    if (endRes.ok) {
      const end = await endRes.json();
      offset = end.offset ?? 0;
    }
  } catch {
    /* use 0 */
  }

  const body = {
    eventFormat: {
      filtersByParty: {
        [operator]: {
          cumulative: [
            {
              identifierFilter: {
                TemplateFilter: {
                  value: { templateId, includeCreatedEventBlob: true },
                },
              },
            },
          ],
        },
      },
      filtersForAnyParty: { cumulative: [] },
      verbose: false,
    },
    activeAtOffset: offset,
  };

  const res = await fetch(`${baseUrl}/v2/state/active-contracts`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  if (res.ok) {
    console.log(`ACS probe OK for ${templateId}`);
    return;
  }
  console.error(`ACS probe FAILED ${res.status} for ${templateId}`);
  console.error(text.slice(0, 400));
}

async function main() {
  const live = await fetch(`${baseUrl}/livez`, { signal: AbortSignal.timeout(4_000) });
  console.log('livez:', live.status, live.ok ? 'OK' : 'FAIL');
  if (!live.ok) process.exit(1);

  const packages = await listPackages();
  const ids = Array.isArray(packages) ? packages : packages.packageIds ?? [];
  console.log(`Packages on participant: ${ids.length}`);
  for (const id of ids.slice(-8)) console.log(' ', id);
  if (ids.length > 8) console.log('  …');

  if (expectedPkg) {
    const found = ids.some((id) => id.toLowerCase() === expectedPkg.toLowerCase());
    console.log(
      found
        ? `CANTON_DAML_PACKAGE_ID ${expectedPkg.slice(0, 16)}… present`
        : `WARNING: CANTON_DAML_PACKAGE_ID ${expectedPkg.slice(0, 16)}… NOT on participant — run: npm run daml:upload`,
    );
  }

  const ref = packageName.startsWith('#') ? packageName : `#${packageName}`;

  // Probe all 7 templates from canquest-v4 Main.daml
  const templates = [
    `${ref}:Main:UserAccount`,
    `${ref}:Main:WalletRegistration`,
    `${ref}:Main:QuestCampaign`,
    `${ref}:Main:QuestClaim`,
    `${ref}:Main:DailyCheckIn`,
    `${ref}:Main:SpinExecution`,
    `${ref}:Main:SpinCcReward`,
  ];

  for (const tpl of templates) {
    console.log('Template ref:', tpl);
    await probeAcs(tpl);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
