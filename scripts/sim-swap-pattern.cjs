#!/usr/bin/env node
/**
 * Simulasi pola data: ambil field mentah per-event dari LedgerEvent DB
 * (payload persis seperti dilihat handler live), susun CantonUpdateEvent
 * dengan pola yang SAMA (urutan parse WSS: created/exercised top-level),
 * lalu jalankan keputusan murni kode sekarang:
 *   deriveSenderHint / offerCid detect / hasAccept / matcher-input
 * Balasan = simulasi value: baris apa yang akan ditulis handler.
 * READ-ONLY total: hanya SELECT, tanpa tulis, tanpa panggil handler.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const SYSTEM = ['dso', 'cantex', 'bridge-operator', 'validator-app', 'canquest-validator'];
function isSystem(p) {
  if (!p) return true;
  if (p.startsWith('canquest:')) return true;
  return SYSTEM.some((s) => p.toLowerCase().startsWith(s));
}

async function loadUpdate(updateId) {
  const rows = await prisma.ledgerEvent.findMany({
    where: { updateId }, orderBy: { eventIndex: 'asc' },
  });
  const created = [], exercised = [];
  for (const r of rows) {
    // Bentuk persis seperti parser WSS serahkan ke handler: inner object
    // (CreatedEventShape / ExercisedEventShape) — BUKAN wrapper.
    const p = r.payload || {};
    if (r.eventType === 'created') created.push({
      contractId: p.contractId, templateId: p.templateId,
      createArgument: p.createArgument || {},
      signatories: p.signatories, witnessParties: p.witnessParties,
      interfaceViews: p.interfaceViews,
    });
    else if (r.eventType === 'exercised') exercised.push({
      contractId: p.contractId, templateId: p.templateId, choice: p.choice,
      choiceArgument: p.choiceArgument || {}, actingParties: p.actingParties,
      witnessParties: p.witnessParties,
    });
  }
  return { created, exercised };
}

function senderHint(created, exercised) {
  const receivers = new Set();
  for (const c of created) {
    const a = c.createArgument || {};
    if (typeof a.owner === 'string') receivers.add(a.owner);
    else if (typeof a.receiver === 'string') receivers.add(a.receiver);
  }
  for (const ex of exercised) {
    for (const p of [...(ex.actingParties || []), ...(ex.witnessParties || [])]) {
      if (!p || receivers.has(p) || isSystem(p)) continue;
      return p;
    }
  }
  return null;
}

async function main() {
  const ids = process.argv.slice(2);
  for (const id of ids) {
    const { created, exercised } = await loadUpdate(id);
    const offerCids = created
      .filter((c) => (c.templateId || '').includes(':TransferOffer') || (c.templateId || '').includes(':TransferInstruction'))
      .map((c) => String(c.contractId).slice(0, 12));
    const hasAccept = exercised.some((e) => e.choice === 'TransferInstruction_Accept');
    const hint = senderHint(created, exercised);
    // Simulasi value: baris apa yang ditulis handler sekarang.
    let row;
    if (offerCids.length && !hasAccept) row = 'TANPA BARIS (offer, bukan history)';
    else if (hasAccept) {
      const cid = exercised.find((e) => e.choice === 'TransferInstruction_Accept')?.contractId;
      row = `1 BARIS accept (cid ${String(cid).slice(0, 12)}…, sender=${hint ? hint.split('::')[0] : 'null'})`;
    } else row = `1 BARIS delivery langsung (sender=${hint ? hint.split('::')[0] : 'null'})`;
    console.log(JSON.stringify({
      update: id.slice(0, 16), created: created.length,
      exercised: exercised.map((e) => e.choice), hint: hint ? hint.split('::')[0] : null,
      offerCids, hasAccept, SIMULASI: row,
    }));
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error('FATAL', String(e).slice(0, 200)); process.exit(1); });
