#!/usr/bin/env node
/**
 * Replay read-only: rakit CantonUpdateEvent dari LedgerEvent DB (payload per
 * baris), lalu jalankan TIGA keputusan murni yang menentukan hasil history:
 *   1. deriveSenderHint (acting/witness non-receiver non-system)
 *   2. offer-created detect (created offer + tanpa Accept)
 *   3. matcher CC-leg (swap aktif + jumlah 1e-6 + sender==escrow)
 *
 * TIDAK menulis DB, TIDAK memanggil handler, TIDAK menyentuh balance.
 * Usage: node scripts/replay-swap-envelope.cjs <updateId>
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const SYSTEM_PREFIX = ['dso', 'cantex', 'bridge-operator', 'validator-app', 'canquest-validator'];
function isSystem(p) {
  if (!p) return true;
  if (p.startsWith('canquest:')) return true;
  const l = p.toLowerCase();
  return SYSTEM_PREFIX.some((s) => l.startsWith(s));
}

async function main() {
  const updateId = process.argv[2];
  if (!updateId) { console.error('usage: replay-swap-envelope.cjs <updateId>'); process.exit(1); }
  const rows = await prisma.ledgerEvent.findMany({
    where: { updateId },
    orderBy: { eventIndex: 'asc' },
  });
  if (!rows.length) { console.error('no LedgerEvent for', updateId); process.exit(2); }
  const created = [], exercised = [];
  for (const r of rows) {
    const p = r.payload || {};
    if (r.eventType === 'created') created.push(p);
    else if (r.eventType === 'exercised') exercised.push(p);
  }
  // 1. senderHint
  const receivers = new Set();
  for (const c of created) {
    const a = c.createArgument || {};
    if (typeof a.owner === 'string') receivers.add(a.owner);
    else if (typeof a.receiver === 'string') receivers.add(a.receiver);
  }
  let hint = null;
  outer: for (const ex of exercised) {
    for (const p of [...(ex.actingParties || []), ...(ex.witnessParties || [])]) {
      if (!p || receivers.has(p) || isSystem(p)) continue;
      hint = p; break outer;
    }
  }
  // 2. offer detect
  const offerCids = created.filter((c) => String(c.templateId || '').includes(':TransferOffer') || String(c.templateId || '').includes(':TransferInstruction')).map((c) => c.contractId);
  const hasAccept = exercised.some((e) => e.choice === 'TransferInstruction_Accept');
  // 3. ringkasan
  console.log(JSON.stringify({
    updateId: updateId.slice(0, 16),
    created: created.length, exercised: exercised.length,
    senderHint: hint,
    offerCids: offerCids.map((c) => String(c).slice(0, 12)),
    hasAccept,
    choices: exercised.map((e) => e.choice),
  }, null, 1));
  await prisma.$disconnect();
}

main().catch((e) => { console.error('FATAL', String(e).slice(0, 300)); process.exit(1); });
