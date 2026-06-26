/**
 * Re-onboard user placeholder → party Canton real via Keycloak + Validator API.
 *
 * Untuk setiap user dengan cantonPartyId placeholder ("canquest:..."), script ini
 * menjalankan flow onboarding yang sama dengan WalletOnboardingService:
 *   a. Buat user Keycloak (realm canton) → dapat UUID (sub)
 *   b. POST /api/validator/v0/admin/users { name: username } → dapat party_id real
 *   c. POST/PATCH /v2/users/{UUID} (Ledger API) → bridge UUID ↔ party
 *   d. POST /v2/users/{UUID}/rights → grant CanActAs + CanReadAs
 * Lalu update tabel User: cantonPartyId = party real, keycloakId = UUID.
 *
 * KEAMANAN:
 *   - Idempoten: user yang sudah punya party REAL dilewati.
 *   - Dry-run default (cetak rencana tanpa mengubah). Tambah --confirm untuk eksekusi.
 *   - Satu user per langkah, commit transaksional per-user (gagal satu ≠ gagal semua).
 *
 * Jalankan di VPS:
 *   1. Audit dulu:        npx ts-node prisma/scripts/audit-placeholder-parties.ts
 *   2. Dry-run re-onboard: npx ts-node prisma/scripts/re-onboard-placeholder-parties.ts
 *   3. Eksekusi:           npx ts-node prisma/scripts/re-onboard-placeholder-parties.ts --confirm
 *
 * Env wajib (di apps/api/.env):
 *   KEYCLOAK_URL, KEYCLOAK_REALM, KEYCLOAK_ADMIN_USER, KEYCLOAK_ADMIN_PASSWORD,
 *   CANTON_VALIDATOR_URL, LEDGER_API_URL, LEDGER_CLIENT_ID, LEDGER_CLIENT_SECRET,
 *   LEDGER_API_AUTH_SCOPE, DATABASE_URL
 */
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'crypto';

const prisma = new PrismaClient();
const CONFIRM = process.argv.includes('--confirm');

// ── Env helpers ──────────────────────────────────────────────────────────────
function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Env ${name} belum diset`);
  return v.replace(/\/$/, '');
}
const KEYCLOAK_URL = () => req('KEYCLOAK_URL');
const REALM = process.env.KEYCLOAK_REALM || 'canton';
const VALIDATOR_URL = () => req('CANTON_VALIDATOR_URL');
const LEDGER_URL = () => req('LEDGER_API_URL');
const SCOPE = process.env.LEDGER_API_AUTH_SCOPE || 'daml_ledger_api';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Token caches ─────────────────────────────────────────────────────────────
let adminKcToken = '';
let adminKcExp = 0;
async function getAdminKcToken(): Promise<string> {
  if (adminKcToken && adminKcExp - 60_000 > Date.now()) return adminKcToken;
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: 'admin-cli',
    username: req('KEYCLOAK_ADMIN_USER'),
    password: req('KEYCLOAK_ADMIN_PASSWORD'),
  });
  const res = await fetch(`${KEYCLOAK_URL()}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`admin-cli token ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  adminKcToken = data.access_token;
  adminKcExp = Date.now() + data.expires_in * 1000;
  return adminKcToken;
}

let ledgerToken = '';
let ledgerExp = 0;
async function getLedgerToken(): Promise<string> {
  if (ledgerToken && ledgerExp - 60_000 > Date.now()) return ledgerToken;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: req('LEDGER_CLIENT_ID'),
    client_secret: req('LEDGER_CLIENT_SECRET'),
    scope: SCOPE,
  });
  const res = await fetch(`${KEYCLOAK_URL()}/realms/${REALM}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`ledger token ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  ledgerToken = data.access_token;
  ledgerExp = Date.now() + data.expires_in * 1000;
  return ledgerToken;
}

// ── Onboarding steps ─────────────────────────────────────────────────────────

/** Buat user Keycloak (idempoten terhadap 409), return UUID. */
async function createKeycloakUserAndId(params: {
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  password: string;
}): Promise<string> {
  const token = await getAdminKcToken();
  const url = `${KEYCLOAK_URL()}/admin/realms/${REALM}/users`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      username: params.username,
      enabled: true,
      firstName: params.firstName,
      lastName: params.lastName,
      email: params.email,
      emailVerified: true,
      credentials: [{ type: 'password', value: params.password, temporary: false }],
    }),
    signal: AbortSignal.timeout(15_000),
  });
  // 201 = created, 409 = already exists → lanjut ambil UUID
  if (res.status !== 201 && res.status !== 409) {
    throw new Error(`createKeycloakUser ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  // Ambil UUID
  const lookup = await fetch(
    `${KEYCLOAK_URL()}/admin/realms/${REALM}/users?username=${encodeURIComponent(params.username)}`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) },
  );
  if (!lookup.ok) throw new Error(`getUserId ${lookup.status}`);
  const arr = (await lookup.json()) as Array<{ id: string }>;
  if (!arr.length) throw new Error(`Keycloak user '${params.username}' tidak ditemukan setelah create`);
  return arr[0].id;
}

/** POST /api/validator/v0/admin/users { name } → party_id real. */
async function createWalletParty(username: string): Promise<string> {
  const token = await getLedgerToken();
  const res = await fetch(`${VALIDATOR_URL()}/api/validator/v0/admin/users`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: username }),
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 409) {
    // Sudah ada → ambil party via GET /admin/users/{username}
    const get = await fetch(
      `${VALIDATOR_URL()}/api/validator/v0/admin/users/${encodeURIComponent(username)}`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) },
    );
    if (get.ok) {
      const d = (await get.json()) as { party_id?: string };
      if (d.party_id) return d.party_id;
    }
    throw new Error(`createWalletParty 409 dan get party gagal`);
  }
  if (!res.ok) throw new Error(`createWalletUser ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { party_id?: string };
  if (!data.party_id) throw new Error('validator response missing party_id');
  return data.party_id;
}

/** Bridge UUID ↔ party di Ledger API + grant rights. Idempoten. */
async function ensureLedgerUser(uuid: string, partyId: string): Promise<void> {
  const token = await getLedgerToken();

  // POST /v2/users (create) — idempoten terhadap already-exists
  const createRes = await fetch(`${LEDGER_URL()}/v2/users`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user: { id: uuid, primaryParty: partyId },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  // 409/ALREADY_EXISTS = OK, lanjut patch + grant
  if (!createRes.ok && createRes.status !== 409) {
    // Bukan fatal — mungkin sudah ada, lanjut ke grant
    console.warn(`    create /v2/users ${createRes.status}: ${(await createRes.text()).slice(0, 150)}`);
  }

  // PATCH /v2/users/{uuid} (primaryParty) — best effort
  await fetch(`${LEDGER_URL()}/v2/users/${encodeURIComponent(uuid)}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user: { id: uuid, primaryParty: partyId },
      updateMask: { paths: ['primary_party'] },
    }),
    signal: AbortSignal.timeout(20_000),
  }).catch(() => {});

  // POST /v2/users/{uuid}/rights — grant CanActAs + CanReadAs (idempoten)
  const grantRes = await fetch(`${LEDGER_URL()}/v2/users/${encodeURIComponent(uuid)}/rights`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: uuid,
      rights: [
        { kind: { CanActAs: { value: { party: partyId } } } },
        { kind: { CanReadAs: { value: { party: partyId } } } },
      ],
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!grantRes.ok && grantRes.status !== 409) {
    console.warn(`    grant rights ${grantRes.status}: ${(await grantRes.text()).slice(0, 150)}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const placeholders = await prisma.user.findMany({
    where: { cantonPartyId: { startsWith: 'canquest:' } },
    select: { id: true, email: true, username: true, displayName: true, cantonPartyId: true, keycloakId: true },
    orderBy: { createdAt: 'asc' },
  });

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`  RE-ONBOARD PLACEHOLDER PARTIES  —  ${CONFIRM ? 'EXECUTE' : 'DRY-RUN (--confirm untuk eksekusi)'}`);
  console.log(`  User placeholder: ${placeholders.length}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  if (placeholders.length === 0) {
    console.log('✅ Tidak ada user placeholder.\n');
    return;
  }

  let ok = 0;
  let fail = 0;
  for (const u of placeholders) {
    const tag = `[${u.email}]`;
    if (!u.username) {
      console.log(`${tag} ⚠ SKIP — username null. Set username dulu.`);
      fail++;
      continue;
    }
    console.log(`${tag} onboarding @${u.username} ...`);
    console.log(`    placeholder: ${u.cantonPartyId}`);

    if (!CONFIRM) {
      console.log(`    (dry-run) akan: create Keycloak → party real → grant → update DB`);
      continue;
    }

    try {
      // a. Keycloak identity
      const uuid = await createKeycloakUserAndId({
        username: u.username,
        email: u.email,
        firstName: u.displayName || u.username,
        lastName: 'canquest',
        password: cryptoRandomHex(),
      });
      console.log(`    keycloak UUID: ${uuid.slice(0, 8)}...`);

      // b. Validator → party real
      const partyId = await createWalletParty(u.username);
      console.log(`    party real   : ${partyId.split('::')[0]}`);

      // c+d. Bridge ledger + grant
      await ensureLedgerUser(uuid, partyId);
      console.log(`    ledger bridge + rights: OK`);

      // e. Update DB
      await prisma.user.update({
        where: { id: u.id },
        data: { cantonPartyId: partyId, keycloakId: uuid },
      });
      console.log(`    ✅ DB updated: ${u.cantonPartyId} → ${partyId.split('::')[0]}`);
      ok++;
    } catch (err) {
      console.error(`    ❌ GAGAL: ${String(err)}`);
      fail++;
    }
    await sleep(500); // jeda antar user
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`  Selesai. Sukses: ${ok}, Gagal: ${fail}`);
  if (!CONFIRM) console.log('  (dry-run — tidak ada data diubah)');
  console.log('═══════════════════════════════════════════════════════════\n');
}

function cryptoRandomHex(): string {
  // Password acak untuk identity Keycloak — user login web tetap pakai password DB app.
  return randomBytes(24).toString('hex');
}

main()
  .catch((err) => {
    console.error('Re-onboard error:', err);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
