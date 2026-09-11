/**
 * ledger-event-intent — pembaca METADATA LEDGER dari satu event WSS
 * `/v2/updates`. PURE: tanpa DB, tanpa state, tanpa jaringan.
 *
 * Latar: sumber kebenaran history swap on-chain HANYA event ledger (WSS update
 * service). Ledger sendiri sudah membawa klasifikasi kanonis di `meta.values`
 * dengan kunci ber-namespace `splice.lfdecentralizedtrust.org/*`:
 *
 *   - `tx-kind`  : `transfer` | `unlock` | `merge-split` | `mint` | `burn` | ...
 *                  Ditulis kontrak DAML/Splice (ledger-native).
 *   - `reason`   : teks bebas. Untuk swap CanQuest berisi
 *                  `"Swap 10.42 CC → USDCx (OneSwap esc_<id>)"` — ditulis app
 *                  kita saat submit (`canton-ledger.service.ts`), lalu tersimpan
 *                  di ledger. Jadi ia data ledger, walau nilainya buatan app.
 *   - `sender`   : party pengirim transfer.
 *
 * Meta ini bisa muncul di beberapa tempat tergantung choice:
 *   - `exerciseResult.meta.values`
 *   - `choiceArgument.meta.values`
 *   - `choiceArgument.extraArgs.meta.values`
 *   - `choiceArgument.transferLegSides[].meta.values` (EventLog_HoldingsChange)
 *
 * Modul ini menggantikan matcher DB (jendela waktu + toleransi jumlah +
 * korelasi escrow) yang lama: klasifikasi sekarang dibaca dari event itu
 * sendiri. Tanpa fallback — kalau ledger tidak membawa penandanya, event
 * diperlakukan sebagai transfer biasa (bukan ditebak).
 */
import type { CantonUpdateEvent } from './canton-updates.service';

/** Kunci meta ledger yang dipakai. */
export const LEDGER_META = {
  txKind: 'splice.lfdecentralizedtrust.org/tx-kind',
  reason: 'splice.lfdecentralizedtrust.org/reason',
  sender: 'splice.lfdecentralizedtrust.org/sender',
} as const;

/** Hasil ekstraksi intent dari satu update. */
export interface LedgerEventIntent {
  /** Semua nilai tx-kind yang terlihat di update ini (unik). */
  txKinds: string[];
  /** Semua teks reason yang terlihat (unik). */
  reasons: string[];
  /** Party pengirim, HANYA bila tunggal. Ambigu (>1 nilai berbeda) → null. */
  sender: string | null;
}

/** Parsed penanda swap CanQuest dari teks reason. */
export interface SwapMarker {
  isSwap: boolean;
  /** `esc_<hex>` — identitas swap OneSwap. */
  escrowId: string | null;
  /** Jumlah instrumen yang dijual. */
  sellAmount: string | null;
  /** Instrumen yang dijual, mis. "CC" / "USDCx". */
  sellInstrument: string | null;
  /** Instrumen yang dibeli. */
  buyInstrument: string | null;
}

const EMPTY_MARKER: SwapMarker = {
  isSwap: false,
  escrowId: null,
  sellAmount: null,
  sellInstrument: null,
  buyInstrument: null,
};

/** Bentuk minimal exercised event yang dibaca (subset ExercisedEventShape). */
interface ExercisedLike {
  choice?: string;
  contractId?: string;
  choiceArgument?: unknown;
  exerciseResult?: unknown;
  /** Party yang meng-exercise choice (dipakai klasifikasi lock/unlock). */
  actingParties?: string[];
}

interface MetaAcc {
  txKinds: Set<string>;
  reasons: Set<string>;
  senders: Set<string>;
}

/**
 * Telusuri objek event dan kumpulkan nilai meta ledger yang dikenal.
 * Mencari setiap objek `{ meta: { values: { <key>: <string> } } }` pada
 * kedalaman berapa pun (dibatasi 8 level agar aman).
 */
function collectMeta(node: unknown, acc: MetaAcc, depth = 0): void {
  if (depth > 8 || node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) collectMeta(item, acc, depth + 1);
    return;
  }
  const obj = node as Record<string, unknown>;
  const meta = obj.meta;
  if (meta && typeof meta === 'object') {
    const values = (meta as { values?: unknown }).values;
    if (values && typeof values === 'object') {
      const v = values as Record<string, unknown>;
      const kind = v[LEDGER_META.txKind];
      if (typeof kind === 'string' && kind) acc.txKinds.add(kind);
      const reason = v[LEDGER_META.reason];
      if (typeof reason === 'string' && reason) acc.reasons.add(reason);
      const sender = v[LEDGER_META.sender];
      if (typeof sender === 'string' && sender) acc.senders.add(sender);
    }
  }
  for (const value of Object.values(obj)) collectMeta(value, acc, depth + 1);
}

/**
 * Baca intent (tx-kind / reason / sender) dari seluruh exercised event.
 *
 * Sumber `sender` mengikuti urutan parser resmi Canton (token-standard cli
 * `txparse/parserv1.ts`): meta `sender` → `choiceArgument.transfer.sender`.
 * Keduanya dikumpulkan; hasil hanya diisi bila tepat SATU nilai unik — dua
 * sender berbeda dalam satu update = ambigu, dan menebak salah lebih buruk
 * daripada null.
 *
 * Ini klasifikasi arah yang didokumentasikan: leg masuk = sender ≠ party
 * kita, leg keluar = sender === party kita (EventLog V2 memakai
 * `transferLegSides[].side` SenderSide/ReceiverSide dengan semantik sama).
 */
export function readLedgerIntent(
  ev: Pick<CantonUpdateEvent, 'exercised'>,
): LedgerEventIntent {
  const acc: MetaAcc = {
    txKinds: new Set<string>(),
    reasons: new Set<string>(),
    senders: new Set<string>(),
  };
  for (const ex of (ev.exercised ?? []) as ExercisedLike[]) {
    collectMeta(ex.exerciseResult, acc);
    collectMeta(ex.choiceArgument, acc);
    // Parser resmi V1 membaca `choiceArgument.transfer.sender` sebagai sumber
    // pengirim (delivery token tidak membawa meta sama sekali — terverifikasi
    // di produksi: TransferRule_TwoStepTransfer sender=escrow, meta kosong).
    const ca = ex.choiceArgument as
      | { transfer?: { sender?: unknown } }
      | undefined;
    const tSender = ca?.transfer?.sender;
    if (typeof tSender === 'string' && tSender) acc.senders.add(tSender);
  }
  return {
    txKinds: [...acc.txKinds],
    reasons: [...acc.reasons],
    sender: acc.senders.size === 1 ? [...acc.senders][0] : null,
  };
}

/**
 * Parse penanda swap dari teks reason. Format yang dihasilkan app:
 *   `Swap <sellAmount> <sellInstrument> → <buyInstrument> (OneSwap esc_<id>)`
 * (panah bisa `→` atau `->`). Mengembalikan marker kosong bila tidak cocok —
 * TIDAK menebak dari kata "swap" yang kebetulan muncul.
 */
export function readSwapMarker(
  reason: string | null | undefined,
): SwapMarker {
  if (!reason || typeof reason !== 'string') return { ...EMPTY_MARKER };
  const m = /^\s*Swap\s+([0-9]+(?:\.[0-9]+)?)\s+([A-Za-z0-9]+)\s*(?:→|->|=>)\s*([A-Za-z0-9]+)/.exec(
    reason,
  );
  const escrow = /(?:^|[\s(])esc_[0-9a-fA-F]+/.exec(reason)?.[0]?.trim() ?? null;
  if (!m) return { ...EMPTY_MARKER };
  return {
    isSwap: true,
    escrowId: escrow,
    sellAmount: m[1] ?? null,
    sellInstrument: m[2] ?? null,
    buyInstrument: m[3] ?? null,
  };
}

/** True bila salah satu reason menandai swap CanQuest. */
export function hasSwapMarker(reasons: readonly string[]): boolean {
  return reasons.some((r) => readSwapMarker(r).isSwap);
}

/** Escrow id swap dari daftar reason (yang pertama cocok), atau null. */
export function escrowIdFromReasons(reasons: readonly string[]): string | null {
  for (const r of reasons) {
    const marker = readSwapMarker(r);
    if (marker.isSwap && marker.escrowId) return marker.escrowId;
  }
  return null;
}

/** Kaki keluar swap yang terbaca dari event ledger itu sendiri. */
export interface SwapOutLeg {
  /** Party pengirim (pemilik swap). */
  sender: string;
  /** Jumlah yang dijual (desimal string, satuan instrumen). */
  amount: string;
  /** Party penerima (escrow). */
  receiver: string | null;
  /** Instrumen yang dijual: dari marker, fallback ke instrumentId transfer. */
  instrument: string | null;
  /** Admin party instrumen (token non-CC); null untuk CC. */
  instrumentAdmin: string | null;
  escrowId: string | null;
}

/**
 * Baca KAKI KELUAR swap dari exercised event yang membawa `transfer` lengkap
 * (sender/receiver/amount) + penanda swap pada reason-nya.
 *
 * Ini leg OUT persis seperti yang dilihat explorer: transfer user → escrow.
 * Syarat ketat (semua harus lolos, miss → null):
 *   1. Ada `choiceArgument.transfer` (bukan sekadar Accept — Accept tidak
 *      membawa transfer args).
 *   2. `transfer.sender` terisi.
 *   3. Reason-nya membawa penanda swap CanQuest.
 *
 * Tanpa fallback: tanpa ketiganya, bukan kaki keluar swap.
 */
export function readSwapOutLeg(
  ev: Pick<CantonUpdateEvent, 'exercised'>,
): SwapOutLeg | null {
  for (const ex of (ev.exercised ?? []) as ExercisedLike[]) {
    const ca = ex.choiceArgument as Record<string, unknown> | undefined;
    const t = ca?.transfer as Record<string, unknown> | undefined;
    if (!t || typeof t !== 'object') continue;

    const sender = typeof t.sender === 'string' ? t.sender : null;
    if (!sender) continue;

    const meta =
      t.meta && typeof t.meta === 'object'
        ? ((t.meta as { values?: Record<string, unknown> }).values ?? {})
        : {};
    const marker = readSwapMarker(
      typeof meta[LEDGER_META.reason] === 'string'
        ? (meta[LEDGER_META.reason] as string)
        : null,
    );
    if (!marker.isSwap) continue;

    const amount = typeof t.amount === 'string' ? t.amount : null;
    if (!amount) continue;

    const receiver = typeof t.receiver === 'string' ? t.receiver : null;
    const instObj = t.instrumentId as { admin?: unknown; id?: unknown } | null;
    const instId =
      instObj && typeof instObj.id === 'string' ? instObj.id : null;
    const instAdmin =
      instObj && typeof instObj.admin === 'string' ? instObj.admin : null;

    return {
      sender,
      amount,
      receiver,
      instrument: marker.sellInstrument ?? instId,
      instrumentAdmin: instAdmin,
      escrowId: marker.escrowId,
    };
  }
  return null;
}

/**
 * tx-kind yang TIDAK memindahkan nilai antar-party secara neto:
 *   - `unlock`      : locked → unlocked (re-materialisasi holding yang sama)
 *   - `merge-split` : konsolidasi/pemecahan UTXO milik party yang sama
 * Kind tak dikenal → false (fail-open): jangan tahan credit karena kind
 * hilang/baru. Suppression hanya untuk kind yang memang diketahui.
 */
export function isNonValueKind(txKinds: readonly string[]): boolean {
  return txKinds.some((k) => k === 'unlock' || k === 'merge-split');
}

/**
 * Contract id yang DIBUAT lalu DIKONSUMSI di update yang sama (kontrak
 * transien). Nilai nettonya nol: holding perantara yang langsung di-archive
 * (mis. output unlock yang diteruskan ke party lain dalam transaksi sama).
 *
 * Dipakai untuk mencegah phantom credit: handler lama meng-credit SEMUA
 * created holding tanpa memperhitungkan archive di update yang sama.
 *
 * Ledger mengekspresikan archive lewat array `archived` dan/atau
 * ExercisedEvent choice `Archive` (LEDGER_EFFECTS). Keduanya dihitung.
 */
export function transientContractIds(
  ev: Pick<CantonUpdateEvent, 'created' | 'archived' | 'exercised'>,
): Set<string> {
  const created = new Set<string>();
  for (const c of ev.created ?? []) {
    if (c.contractId) created.add(c.contractId);
  }
  if (created.size === 0) return new Set();

  const consumed = new Set<string>();
  for (const a of ev.archived ?? []) {
    if (a.contractId) consumed.add(a.contractId);
  }
  for (const ex of (ev.exercised ?? []) as ExercisedLike[]) {
    if (ex.choice === 'Archive' && ex.contractId) consumed.add(ex.contractId);
  }

  const transient = new Set<string>();
  for (const cid of consumed) {
    if (created.has(cid)) transient.add(cid);
  }
  return transient;
}

/**
 * Choice yang menandakan dana MILIK PARTY SENDIRI berpindah status (bukan
 * transfer dari/ke pihak lain):
 *   - LockedAmulet_UnlockV2          : lock dibuka (atas permintaan party)
 *   - LockedAmulet_OwnerExpireLockV2 : lock kedaluwarsa → dana kembali
 * Ledger menegaskannya lewat `actingParties` party itu sendiri. Dipakai untuk
 * mengisi counterparty SELF (bukan null) sehingga From/To menampilkan "You",
 * bukan kosong. Bukan tebakan: syaratnya choice + actor ledger.
 */
const SELF_FUNDS_CHOICES: ReadonlySet<string> = new Set([
  'LockedAmulet_UnlockV2',
  'LockedAmulet_OwnerExpireLockV2',
]);

/** True bila update ini memindahkan dana party itu sendiri (unlock/expire). */
export function isSelfFundsMovement(
  exercised: ReadonlyArray<{ choice?: string; actingParties?: string[] }> | undefined,
  party: string,
): boolean {
  return (exercised ?? []).some(
    (ex) =>
      !!ex?.choice &&
      SELF_FUNDS_CHOICES.has(ex.choice) &&
      (ex.actingParties ?? []).includes(party),
  );
}

/**
 * Pergerakan LOCK/UNLOCK dana sendiri (lock campaign), bukan transfer ke
 * pihak lain. Dikembalikan oleh readLockMovement().
 */
export interface LockMovement {
  kind: 'lock' | 'unlock';
  /** Jumlah CC (desimal string). */
  amount: string;
  /** cid LockedAmulet: yang dibuat (lock) atau yang dikonsumsi (unlock). */
  lockedAmuletCid: string | null;
}

/** Choice yang menandakan LockedAmulet dibuka. */
const UNLOCK_CHOICES: ReadonlySet<string> = new Set([
  'LockedAmulet_UnlockV2',
  'LockedAmulet_OwnerExpireLockV2',
]);

/**
 * Baca owner+amount holding dari satu created event. Sumber kanonis =
 * interfaceViews[].viewValue (dipakai Amulet & LockedAmulet di update lock),
 * fallback ke createArgument.
 *
 * CATATAN kenapa helper kecil ini ada (bukan memakai extractor handler):
 *   - LockedAmulet.createArgument menaruh pemilik/jumlah di objek NESTED
 *     `amulet` (bukan `owner`/`amount` di top-level) — bentuk yang tidak
 *     dikenal extractTokenOwnerParty/extractTokenAmount.
 *   - Nilai kanonis di update ini justru ada di interfaceViews, yang tidak
 *     dibaca extractor tsb.
 * Jadi ini pembaca bentuk-bentuk spesifik lock/unlock, bukan duplikasi
 * logika holding umum.
 */
function readHoldingOwnerAmount(c: Record<string, unknown>): {
  owner: string | null;
  amount: string | null;
} {
  const ivs = Array.isArray(c.interfaceViews)
    ? (c.interfaceViews as Array<{ viewValue?: Record<string, unknown> }>)
    : [];
  for (const iv of ivs) {
    const v = iv?.viewValue;
    if (!v || typeof v !== 'object') continue;
    const owner = typeof v.owner === 'string' ? v.owner : null;
    const amount = typeof v.amount === 'string' ? v.amount : null;
    if (owner && amount) return { owner, amount };
  }
  const args = (c.createArgument ?? {}) as Record<string, unknown>;
  // Bentuk LockedAmulet: { lock, amulet: { owner, amount } }.
  const nested = args.amulet as Record<string, unknown> | undefined;
  const src = nested && typeof nested === 'object' ? nested : args;
  const owner =
    typeof src.owner === 'string'
      ? src.owner
      : typeof src.receiver === 'string'
        ? src.receiver
        : null;
  const amt = src.amount as Record<string, unknown> | string | undefined;
  const amount =
    typeof amt === 'string'
      ? amt
      : typeof amt?.initialAmount === 'string'
        ? (amt.initialAmount as string)
        : typeof amt?.amount === 'string'
          ? (amt.amount as string)
          : null;
  return { owner, amount };
}

/**
 * Deteksi pergerakan lock/unlock MILIK party dari satu update (ledger-only).
 *
 * Aturan (semua harus lolos; tanpa fallback):
 *   1. Tidak ada transfer KELUAR dari party di update ini — kalau ada, update
 *      itu bagian dari transfer/swap (mis. deposit swap yang juga membuat
 *      LockedAmulet), BUKAN lock campaign.
 *   2. LOCK   : ada created `Splice.Amulet:LockedAmulet` persisten (tidak
 *               dikonsumsi di update yang sama) dengan owner = party.
 *   3. UNLOCK : ada exercise LockedAmulet_UnlockV2 / OwnerExpireLockV2 dengan
 *               actingParties memuat party, DAN update mengembalikan Amulet
 *               persisten milik party (jumlah unlock).
 */
export function readLockMovement(
  ev: Pick<CantonUpdateEvent, 'created' | 'exercised' | 'archived'>,
  party: string,
): LockMovement | null {
  const hasOutgoing = ((ev.exercised ?? []) as ExercisedLike[]).some((ex) => {
    const t = (ex.choiceArgument as { transfer?: Record<string, unknown> })
      ?.transfer;
    return (
      !!t &&
      t.sender === party &&
      typeof t.receiver === 'string' &&
      t.receiver !== party
    );
  });
  if (hasOutgoing) return null;

  const transient = transientContractIds(ev);

  // UNLOCK
  const unlock = ((ev.exercised ?? []) as ExercisedLike[]).find(
    (ex) =>
      !!ex.choice &&
      UNLOCK_CHOICES.has(ex.choice) &&
      (ex.actingParties ?? []).includes(party),
  );
  if (unlock) {
    for (const c of (ev.created ?? []) as unknown as Array<
      Record<string, unknown>
    >) {
      const tpl = String(c.templateId ?? '');
      if (!tpl.includes(':Splice.Amulet:Amulet')) continue;
      if (transient.has(String(c.contractId ?? ''))) continue;
      const { owner, amount } = readHoldingOwnerAmount(c);
      if (owner === party && amount) {
        return {
          kind: 'unlock',
          amount,
          lockedAmuletCid: unlock.contractId ?? null,
        };
      }
    }
    return null;
  }

  // LOCK
  for (const c of (ev.created ?? []) as unknown as Array<
      Record<string, unknown>
    >) {
    const tpl = String(c.templateId ?? '');
    if (!tpl.endsWith(':Splice.Amulet:LockedAmulet')) continue;
    const cid = String(c.contractId ?? '');
    if (transient.has(cid)) continue;
    const { owner, amount } = readHoldingOwnerAmount(c);
    if (owner === party && amount) {
      return { kind: 'lock', amount, lockedAmuletCid: cid };
    }
  }
  return null;
}
