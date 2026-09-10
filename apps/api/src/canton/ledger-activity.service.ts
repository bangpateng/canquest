import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * LedgerActivityService — FEED HISTORY SATU SUMBER (cermin WSS).
 *
 * Sumber: LedgerEvent (raw projection, ditulis LedgerRawIngestService per
 * update — satu baris per event, tanpa agregasi/klasifikasi).
 *
 * Aturan tampil (fakta, bukan tebakan):
 *   - created Holding/Amulet: owner == party user → baris kredit.
 *   - exercised: actingParty == party user → baris aksi.
 *   - Sisanya (sekadar witness, kontrak quest/claim/lock sistem) → tidak
 *     tampil di feed personal.
 *
 * Setiap baris membawa updateId asli → link explorer SELALU valid.
 * Tanpa matcher, tanpa synthetic, tanpa controller rows.
 */
export interface LedgerActivityItem {
  id: string;
  updateId: string;
  eventType: string;
  template: string;
  choice: string | null;
  contractId: string | null;
  direction: 'in' | 'out' | 'action' | null;
  party: string | null;
  counterparty: string | null;
  instrumentId: string | null;
  amount: string | null;
  label: string;
}

@Injectable()
export class LedgerActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async getFeed(
    userId: string,
    page = 1,
    pageSize = 20,
  ): Promise<{ items: LedgerActivityItem[]; total: number }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { cantonPartyId: true },
    });
    const party = user?.cantonPartyId ?? null;
    if (!party) return { items: [], total: 0 };

    const take = Math.min(200, Math.max(1, pageSize));
    const skip = (Math.max(1, page) - 1) * take;

    // Kandidat: event di mana party user terlibat (witness array mengandung).
    // Filter peran (owner/actor) dilakukan di proyeksi di bawah — witness
    // saja tidak cukup (DSO ikut witness di mana-mana).
    const rows = await this.prisma.ledgerEvent.findMany({
      where: { witnessParties: { has: party } },
      orderBy: [{ updateId: 'desc' }, { eventIndex: 'desc' }],
      take: take * 5, // over-fetch: banyak witness tidak lolos filter peran
      skip: 0,
    });

    const items: LedgerActivityItem[] = [];
    for (const r of rows) {
      const item = this.projectRow(r, party);
      if (item) items.push(item);
      if (items.length >= skip + take) break;
    }
    const page_items = items.slice(skip, skip + take);
    return { items: page_items, total: -1 }; // total eksak butuh scan penuh
  }

  /**
   * Proyeksi satu LedgerEvent → baris feed atau null (tidak relevan).
   * Pure logic (tanpa DB) — diuji unit via mirror di spec.
   */
  projectRow(
    r: {
      updateId: string;
      eventIndex: number;
      eventType: string;
      templateId: string | null;
      choice: string | null;
      contractId: string | null;
      witnessParties: string[];
      payload: unknown;
    },
    party: string,
  ): LedgerActivityItem | null {
    const p = (r.payload ?? {}) as Record<string, unknown>;
    const args = (p.createArgument ?? {}) as Record<string, unknown>;
    const tpl = r.templateId ?? '';
    const shortTpl = tpl.includes(':') ? tpl.slice(tpl.lastIndexOf(':') + 1) : tpl;
    const moduleTpl = tpl.includes(':')
      ? tpl.slice(tpl.indexOf(':') + 1)
      : tpl;

    if (r.eventType === 'created') {
      const owner =
        typeof args.owner === 'string'
          ? args.owner
          : typeof args.receiver === 'string'
            ? args.receiver
            : null;
      // Semua created yang melibatkan user tampil — disebut persis jenisnya:
      // Holding/Amulet milik user = kredit; kontrak offer/sistem yang
      // menyebut user (receiver/witness dengan peran) = kejadian offer.
      // Tanpa tebakan bisnis: label = jenis kontrak + fakta.
      const involvesUser =
        owner === party || (r.witnessParties ?? []).includes(party);
      if (!involvesUser) return null;
      const { instrumentId, amount } = extractHoldingFacts(args, p, tpl);
      const isHolding =
        tpl.includes(':Splice.Amulet:Amulet') ||
        tpl.includes('Holding:Holding');
      return {
        id: `${r.updateId}:${r.eventIndex}`,
        updateId: r.updateId,
        eventType: r.eventType,
        template: moduleTpl || shortTpl,
        choice: null,
        contractId: r.contractId,
        direction: owner === party && isHolding ? 'in' : null,
        party,
        counterparty: owner !== party ? owner : extractSender(p, party),
        instrumentId,
        amount,
        label: labelForHolding(moduleTpl, instrumentId, amount, owner === party),
      };
    }

    if (r.eventType === 'exercised') {
      const actors = Array.isArray(p.actingParties)
        ? (p.actingParties as string[])
        : [];
      const witnesses = r.witnessParties ?? [];
      // Semua exercise yang melibatkan user tampil, disebut persis choice-nya.
      // Archive = consume internal (efeknya tercermin di created) → skip.
      // Bukan cuma actor: counterparty yang disebut di choiceArgument juga
      // ditampilkan (mis. sender/receiver transfer).
      if (!actors.includes(party) && !witnesses.includes(party)) return null;
      if (r.choice === 'Archive') return null; // consume internal, bukan aksi
      return {
        id: `${r.updateId}:${r.eventIndex}`,
        updateId: r.updateId,
        eventType: r.eventType,
        template: moduleTpl || shortTpl,
        choice: r.choice,
        contractId: r.contractId,
        direction: actors.includes(party) ? 'action' : null,
        party,
        counterparty: extractTransferCounterparty(p, party),
        instrumentId: null,
        amount: extractTransferAmount(p),
        label: labelForChoice(r.choice, moduleTpl),
      };
    }

    return null; // archived mentah tidak tampil (efeknya ada di created)
  }
}

/** Amount + instrument dari createArgument atau interface view (bila ada). */
function extractHoldingFacts(
  args: Record<string, unknown>,
  p: Record<string, unknown>,
  tpl: string,
): { instrumentId: string | null; amount: string | null } {
  // Interface view didahulukan (kanonis bila ada).
  const views = Array.isArray(p.interfaceViews) ? p.interfaceViews : [];
  for (const v of views) {
    const vv = (v as { viewValue?: Record<string, unknown> })?.viewValue;
    if (!vv || typeof vv !== 'object') continue;
    const inst = vv.instrumentId as { admin?: string; id?: string } | undefined;
    if (
      typeof vv.owner === 'string' &&
      typeof vv.amount === 'string' &&
      inst?.id
    ) {
      return { instrumentId: inst.id, amount: vv.amount };
    }
  }
  // Amulet: amount.initialAmount.
  const amt = args.amount as Record<string, unknown> | undefined;
  const amountStr =
    typeof amt?.initialAmount === 'string'
      ? amt.initialAmount
      : typeof amt?.amount === 'string'
        ? amt.amount
        : typeof args.amount === 'string'
          ? args.amount
          : typeof args.balance === 'string'
            ? args.balance
            : null;
  // Instrument: dari template (Amulet) atau args (token).
  let instrumentId: string | null = null;
  if (tpl.includes(':Splice.Amulet:Amulet')) instrumentId = 'CC';
  else {
    const inst = args.instrument as { id?: string } | undefined;
    if (inst?.id) instrumentId = inst.id;
    else if (typeof args.instrumentId === 'string') instrumentId = args.instrumentId;
    else if (typeof args.label === 'string') instrumentId = args.label;
  }
  return { instrumentId, amount: amountStr };
}

/** Pengirim dari choiceArgument transfer (bila ada), selain party sendiri. */
function extractSender(
  p: Record<string, unknown>,
  self: string,
): string | null {
  const ca = p.choiceArgument as Record<string, unknown> | undefined;
  const t = ca?.transfer as Record<string, unknown> | undefined;
  const s = t?.sender;
  return typeof s === 'string' && s !== self ? s : null;
}

/** Counterparty transfer dari choiceArgument (sender atau receiver, selain diri). */
function extractTransferCounterparty(
  p: Record<string, unknown>,
  self: string,
): string | null {
  const ca = p.choiceArgument as Record<string, unknown> | undefined;
  const t = ca?.transfer as Record<string, unknown> | undefined;
  if (!t || typeof t !== 'object') return null;
  for (const k of ['sender', 'receiver']) {
    const v = t[k];
    if (typeof v === 'string' && v !== self) return v;
  }
  return null;
}

/** Amount dari choiceArgument transfer (bila ada). */
function extractTransferAmount(p: Record<string, unknown>): string | null {
  const ca = p.choiceArgument as Record<string, unknown> | undefined;
  const t = ca?.transfer as Record<string, unknown> | undefined;
  return typeof t?.amount === 'string' ? t.amount : null;
}

function labelForHolding(
  moduleTpl: string,
  instrumentId: string | null,
  amount: string | null,
  isOwner: boolean,
): string {
  const unit = instrumentId ?? 'token';
  const amt = amount ?? '?';
  if (!isOwner) return `${moduleTpl} ${amt} ${unit}`.trim();
  if (moduleTpl.includes('TransferOffer') || moduleTpl.includes('TransferInstruction')) {
    return `Offer ${amt} ${unit}`;
  }
  return `Received ${amt} ${unit}`;
}

function labelForChoice(
  choice: string | null,
  moduleTpl: string,
): string {
  if (!choice) return moduleTpl || 'Action';
  if (choice === 'TransferInstruction_Accept') return 'Accepted offer';
  if (choice === 'TransferFactory_Transfer') return 'Sent transfer';
  return choice;
}
