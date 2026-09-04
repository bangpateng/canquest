#!/usr/bin/env node
/**
 * Audit L1 (Phase 4) — verifikasi resolver party→user ketat (gap #19). READ-ONLY.
 *
 * (a) Tabrakan di data:
 *     1. Pasangan cantonPartyId yang sama setelah normalisasi lowercase
 *        (membuat match eksak ambigu → resolver fail-closed).
 *     2. Jebakan heuristik lama: user yang username-nya = prefix party user lain
 *        (party eksternal "budi::…" akan salah nempel ke user "budi").
 *
 * (b) Dry-run: untuk setiap party yang dikenal/disaksikan (semua cantonPartyId
 *     user + semua referenceId baris wss: di kedua tabel transaksi), bandingkan
 *     hasil resolver LAMA (heuristik) vs KETAT (eksak). Laporkan setiap
 *     perbedaan atribusi.
 *
 * Jalankan DI VPS2 (pipe via stdin, tanpa menulis file):
 *   ssh vps2 'cd /var/www/canquest && DATABASE_URL=… node -' < audit-party-resolution.cjs
 */
const { PrismaClient } = require('/var/www/canquest/node_modules/@prisma/client');
const prisma = new PrismaClient();

function norm(p) {
  if (!p || !p.trim()) return null;
  const t = p.trim();
  const sep = t.indexOf('::');
  if (sep === -1) return t.toLowerCase();
  return `${t.slice(0, sep).toLowerCase()}::${t.slice(sep + 2).toLowerCase()}`;
}
function prefix(p) {
  const n = norm(p);
  if (!n) return null;
  const sep = n.indexOf('::');
  return sep > 0 ? n.slice(0, sep) : null;
}

/** Replikasi resolver LAMA (balance-event-handler sebelum L1). */
function oldResolve(users, party) {
  if (!party || party.startsWith('canquest:')) return null;
  const hint = party.includes('::') ? party.split('::')[0] : null;
  const candidates = [];
  const np = norm(party);
  for (const u of users) {
    if (u.cantonPartyId && norm(u.cantonPartyId) === np) candidates.push(u);
  }
  if (candidates.length) return { set: candidates, via: 'exact' };
  for (const u of users) {
    if (u.keycloakId && u.keycloakId.toLowerCase() === party.toLowerCase())
      candidates.push(u);
  }
  if (candidates.length) return { set: candidates, via: 'keycloakId-exact' };
  if (hint) {
    for (const u of users) {
      if (u.username && u.username.toLowerCase() === hint.toLowerCase())
        candidates.push(u);
    }
  }
  if (candidates.length) return { set: candidates, via: 'username-prefix' };
  if (party.startsWith('auth0_')) {
    for (const u of users) {
      if (
        u.keycloakId &&
        u.keycloakId.toLowerCase().includes(party.toLowerCase())
      )
        candidates.push(u);
    }
  }
  if (candidates.length) return { set: candidates, via: 'auth0-contains' };
  return null;
}

/** Resolver KETAT (baru). */
function strictResolve(users, party) {
  const np = norm(party);
  if (!np || np.startsWith('canquest:')) return null;
  const hits = users.filter((u) => u.cantonPartyId && norm(u.cantonPartyId) === np);
  if (hits.length !== 1) return null;
  return hits[0];
}

(async () => {
  const users = await prisma.user.findMany({
    select: { id: true, username: true, cantonPartyId: true, keycloakId: true },
  });

  console.log(`users total=${users.length} denganParty=${users.filter((u) => u.cantonPartyId).length}`);

  // ── (a).1 tabrakan normalisasi ────────────────────────────────────────────
  const byNorm = new Map();
  for (const u of users) {
    if (!u.cantonPartyId) continue;
    const k = norm(u.cantonPartyId);
    if (!byNorm.has(k)) byNorm.set(k, []);
    byNorm.get(k).push(u);
  }
  const collisions = [...byNorm.entries()].filter(([, v]) => v.length > 1);
  console.log(`\n[a.1] tabrakan normalisasi party: ${collisions.length}`);
  for (const [k, v] of collisions) console.log('  COLLISION', k, v.map((u) => u.id).join(','));

  // ── (a).2 jebakan prefix username ────────────────────────────────────────
  const withParty = users.filter((u) => u.cantonPartyId);
  const traps = [];
  for (const owner of withParty) {
    const hint = prefix(owner.cantonPartyId);
    if (!hint) continue;
    for (const other of users) {
      if (other.id === owner.id) continue;
      if (other.username && other.username.toLowerCase() === hint) {
        traps.push({ hint, owner: owner.id, other: other.id });
      }
    }
  }
  // Dedup (hint,other) — beberapa owner bisa share prefix sama.
  const trapKeys = new Set(traps.map((t) => `${t.hint}|${t.other}`));
  console.log(`[a.2] user lain yang username-nya = prefix party orang lain: ${trapKeys.size}`);
  for (const k of trapKeys) console.log('  TRAP', k.replace('|', ' → user '));

  // ── (b) dry-run old vs strict ────────────────────────────────────────────
  const [ccRefs, tokRefs] = await Promise.all([
    prisma.ccTransaction.findMany({
      where: { ledgerTxId: { startsWith: 'wss:' } },
      select: { referenceId: true },
      distinct: ['referenceId'],
    }),
    prisma.tokenTransaction.findMany({
      where: { ledgerTxId: { startsWith: 'wss:' } },
      select: { referenceId: true },
      distinct: ['referenceId'],
    }),
  ]);
  const queryParties = new Set();
  for (const u of withParty) queryParties.add(u.cantonPartyId);
  for (const r of [...ccRefs, ...tokRefs]) {
    if (r.referenceId && r.referenceId.includes('::')) queryParties.add(r.referenceId);
  }
  console.log(`\n[b] party query = ${queryParties.size} (user parties + referenceId wss:)`);
  let agree = 0;
  const diffs = [];
  for (const p of queryParties) {
    const oldR = oldResolve(users, p);
    const newR = strictResolve(users, p);
    const oldId = oldR ? [...new Set(oldR.set.map((u) => u.id))].join('+') : null;
    const newId = newR ? newR.id : null;
    if (oldId === newId) {
      agree++;
    } else {
      diffs.push({ party: p.slice(0, 40), oldId, oldVia: oldR?.via ?? null, newId });
    }
  }
  console.log(`[b] setuju=${agree} berbeda=${diffs.length}`);
  for (const d of diffs) console.log('  DIFF', JSON.stringify(d));

  // Party auth0_ yang pernah muncul di referenceId (indikasi event ber-owner auth0_).
  const auth0Seen = [...queryParties].filter((p) => p.startsWith('auth0_'));
  console.log(`\n[b.extra] party auth0_ terlihat di data: ${auth0Seen.length}`);

  await prisma.$disconnect();
})().catch((e) => {
  console.error('AUDIT_ERROR', String(e));
  process.exit(1);
});
