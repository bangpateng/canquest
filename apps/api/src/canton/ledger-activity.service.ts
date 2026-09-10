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
 *
 * URUTAN: kronologis ledger (offset ASC dari ledger, disajikan desc) — offset
 * ledger monotonic per participant. Bukan hash updateId (bukan waktu). Baris
 * tanpa offset (raw pra-perbaikan) diletakkan paling akhir. Waktu tampil =
 * LedgerUpdate.effectiveAt (jam ledger), bukan createdAt app.
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
  /** Jam ledger (LedgerUpdate.effectiveAt) — waktu transaksi sebenarnya.
   *  Diambil dari update terkait saat getFeed; null bila update belum ada. */
  ledgerTime?: string | null;
}

/** Hasil halaman feed.
 *  - `total` = jumlah baris lolos-proyeksi yang BERHASIL dipindai. `null`
 *    berarti pemindaian menyentuh `CANDIDATE_CAP` (lebih banyak di luar
 *    jendela; nilai eksak butuh scan penuh). Stabil antar halaman.
 *  - `hasMore` = masih ada baris setelah halaman ini (eksak). */
export interface LedgerActivityPage {
  items: LedgerActivityItem[];
  total: number | null;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/** Batas baris raw yang dipindai per request (pagination tanpa scan penuh). */
const CANDIDATE_CAP = 1000;
/** Faktor over-fetch batch: banyak witness tidak lolos filter peran (owner/actor). */
const CANDIDATE_OVERFETCH = 5;

@Injectable()
export class LedgerActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async getFeed(
    userId: string,
    page = 1,
    pageSize = 20,
  ): Promise<LedgerActivityPage> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { cantonPartyId: true },
    });
    const party = user?.cantonPartyId ?? null;
    const take = Math.min(200, Math.max(1, pageSize));
    const p = Math.max(1, page);
    const skip = (p - 1) * take;
    if (!party) {
      return { items: [], total: 0, page: p, pageSize: take, hasMore: false };
    }

    // Kandidat: event di mana party user terlibat (witness array mengandung).
    // Filter peran (owner/actor) dilakukan di proyeksi — witness saja tidak
    // cukup (DSO ikut witness di mana-mana).
    //
    // URUTAN: kronologis LEDGER, bukan hash updateId. Offset ledger monotonic
    // per participant (docs Canton) → urutan sebenarnya. Baris lama yang
    // belum ber-offset (raw ingest pra-perbaikan) diletakkan paling akhir
    // (nulls last) supaya tidak mengacak baris baru. Tie-break updateId
    // (hash) + eventIndex untuk offset yang sama — satu update = satu offset.
    //
    // PAGINATION: pindai raw dalam batch ber-over-fetch sampai `skip+take`
    // baris lolos-proyeksi terkumpul (atau baris habis / cap tercapai). Jadi
    // page > 1 benar (dulu selalu skip:0 → halaman lanjut salah/kosong) dan
    // `total` stabil antar halaman (dihitung dari pemindaian yang sama).
    const batchSize = Math.min(
      500,
      Math.max(50, take * CANDIDATE_OVERFETCH),
    );
    const need = skip + take;
    const projected: LedgerActivityItem[] = [];
    let rawSkip = 0;
    let scanned = 0;
    let exhausted = false;

    while (projected.length < need && scanned < CANDIDATE_CAP) {
      const batch = Math.min(batchSize, CANDIDATE_CAP - scanned);
      const rows = await this.prisma.ledgerEvent.findMany({
        where: { witnessParties: { has: party } },
        orderBy: [
          { offset: { sort: 'desc', nulls: 'last' } },
          { updateId: 'desc' },
          { eventIndex: 'desc' },
        ],
        skip: rawSkip,
        take: batch,
      });
      if (rows.length === 0) {
        exhausted = true;
        break;
      }
      for (const r of rows) {
        const item = this.projectRow(r, party);
        if (item) projected.push(item);
      }
      scanned += rows.length;
      rawSkip += rows.length;
      if (rows.length < batch) {
        exhausted = true;
        break;
      }
    }

    const pageItems = projected.slice(skip, skip + take);
    // hasMore: masih ada baris lolos-proyeksi setelah halaman ini, ATAU
    // pemindaian terhenti karena cap (kemungkinan masih ada lanjutan).
    const hasMore =
      projected.length > skip + take ||
      (!exhausted && scanned >= CANDIDATE_CAP);

    // Waktu ledger per baris (batch 1 query untuk halaman ini saja).
    if (pageItems.length > 0) {
      const updateIds = [...new Set(pageItems.map((i) => i.updateId))];
      const updates = await this.prisma.ledgerUpdate.findMany({
        where: { updateId: { in: updateIds } },
        select: { updateId: true, effectiveAt: true },
      });
      const timeById = new Map(updates.map((u) => [u.updateId, u.effectiveAt]));
      for (const item of pageItems) {
        item.ledgerTime = timeById.get(item.updateId)?.toISOString() ?? null;
      }
    }

    return {
      items: pageItems,
      // Eksak bila pemindaian tuntas sebelum cap; null = lower bound.
      total: exhausted ? projected.length : null,
      page: p,
      pageSize: take,
      hasMore,
    };
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
