import { createHash } from 'crypto';
import type { ConfigService } from '@nestjs/config';
import { RewardType } from '@prisma/client';

/**
 * v30 — paket DAML `canquest-claim` + `canquest-lock` (packages/daml-v30).
 *
 * Sumber kebenaran perilaku: packages/daml-v30/{AGENT,FLOW,SECURITY,ROADMAP,
 * UI-STATES,LOCK-SPEC}.md. FILE DAML TIDAK PERNAH DIUBAH dari sisi backend.
 *
 * Pinning versi: Quest.ledgerPackage === V30_LEDGER_PACKAGE menandai quest
 * memakai jalur v30 (campaign v29 lama tetap jalan di paket lamanya sampai
 * selesai — tidak ada migrasi, README.md v30 §"Bukan upgrade").
 */

/** Marker yang disimpan admin ke Quest.ledgerPackage untuk quest jalur v30. */
export const V30_LEDGER_PACKAGE = 'canquest-v30';

/** Nilai WinnerDraw.claimStatus — mirror ClaimStatus on-chain (Main.daml ADT). */
export type V30ClaimStatus =
  | 'PreSettle'
  | 'Settled'
  | 'RewardPending'
  | 'RewardExpired'
  | 'Revealed';

/** Nilai WinnerDraw.rewardKind — mirror RewardKind yang dikomit di ClaimOffer. */
export type V30RewardKindLabel =
  | 'CODE_ONLY'
  | 'TOKEN_ONLY'
  | 'TOKEN_AND_CODE';

/** Flag global jalur v30 (default OFF — dual-run dengan v29 sampai smoke lulus). */
export function v30Enabled(config: ConfigService): boolean {
  return config.get<string>('CLAIM_V30_ENABLED') === 'true';
}

export function isV30Quest(quest: { ledgerPackage?: string | null }): boolean {
  return (quest.ledgerPackage ?? '').trim() === V30_LEDGER_PACKAGE;
}

// ── Package refs (nama DAR, di-resolve participant via prefix '#') ──────────

function packageRef(config: ConfigService, key: string, fallback: string): string {
  const name = config.get<string>(key)?.trim() || fallback;
  return name.startsWith('#') ? name : `#${name}`;
}

/** `#canquest-claim` — Main:ClaimOffer / Main:ClaimReceipt. */
export function v30ClaimPackageRef(config: ConfigService): string {
  return packageRef(config, 'CANTON_CLAIM_PACKAGE_NAME', 'canquest-claim');
}

/** `#canquest-lock` — LockProposal:LockProposal / LockProposal:LockReceipt. */
export function v30LockPackageRef(config: ConfigService): string {
  return packageRef(config, 'CANTON_LOCK_PACKAGE_NAME', 'canquest-lock');
}

export function v30ClaimTemplateId(
  config: ConfigService,
  template: 'ClaimOffer' | 'ClaimReceipt',
): string {
  return `${v30ClaimPackageRef(config)}:Main:${template}`;
}

export function v30LockTemplateId(
  config: ConfigService,
  template: 'LockProposal' | 'LockReceipt',
): string {
  return `${v30LockPackageRef(config)}:LockProposal:${template}`;
}

// ── codeHash — rumus terkunci dengan vektor uji ─────────────────────────────
//
// Kontrak: `assert (sha256 (toHex plaintext) == expected)` (Main.daml RevealCode).
// `sha256 : BytesHex -> BytesHex` — input di-hex-DECODE jadi bytes dulu, lalu
// di-hash. Jadi rumus backend = sha256 atas utf8-bytes plaintext, output hex.
//
// TERBUKTI 2026-09-02 (Daml Script SDK 3.4.11 vs Node 22):
//   sha256 (toHex "INVITE-XYZ")
//     = d3b9e1b1c8914974d152102b7086866a575ac600ddf1111142a7bba5eb358d09
//   = crypto.createHash('sha256').update("INVITE-XYZ", 'utf8').digest('hex')
//
// JANGAN hash string-hex-nya (sha256 atas teks hex) — itu "sha256 mentah"
// yang AGENT.md peringatkan: RevealCode gagal selamanya tanpa error jelas.
export function v30CodeHash(plaintext: string): string {
  return createHash('sha256').update(plaintext, 'utf8').digest('hex');
}

// ── validUntil — berlaku 7 HARI sejak offer DIBUAT (spesifikasi owner
// 2026-09-03, menggantikan konvensi docs 48 jam; kontrak tidak membatasi —
// yang penting ANCHOR-nya momen pembuatan offer, bukan tanggal campaign,
// supaya undian/draw yang mundur tidak melahirkan offer kedaluwarsa).
// Offer kedaluwarsa diarsipkan job + kode kembali ke pool (§7 spesifikasi).
export const V30_OFFER_VALIDITY_MS = 7 * 24 * 60 * 60 * 1000;

export function v30ValidUntil(drawnAt: Date): Date {
  return new Date(drawnAt.getTime() + V30_OFFER_VALIDITY_MS);
}

// ── DAML-LF JSON helpers (encoding yang sama dengan v29 settleAtomic) ───────

/** Decimal DAML wajib string, mis. 5 → "5.0". */
export function v30Dec(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : String(value);
}

/** Splice.Api.Token.HoldingV2.Account — regular account (owner Some, provider/id kosong). */
export function v30Account(partyId: string): { owner: string; provider: null; id: string } {
  return { owner: partyId, provider: null, id: '' };
}

/** RewardKind variant JSON (variant ber-field berlabel → value = objek record). */
export type V30RewardKindJson =
  | { tag: 'CodeOnly'; value: { codeHash: string } }
  | {
      tag: 'TokenOnly';
      value: { tokenAmount: string; tokenInstrument: { admin: string; id: string } };
    }
  | {
      tag: 'TokenAndCode';
      value: {
        tokenAmount: string;
        tokenInstrument: { admin: string; id: string };
        codeHash: string;
      };
    };

/**
 * Mapping RewardType dapp → RewardKind v30 (rifle/FCFS TIDAK ada di Daml —
 * perbedaan cara pilih pemenang murni backend, FLOW.md §Raffle/FCFS).
 */
export function v30RewardKindFor(params: {
  rewardType: RewardType | string;
  rewardToken: string; // "CC" | "USDCx"
  rewardAmountCc: number;
  codePlaintext: string | null; // kode dari InviteCodePool (sudah di-assign)
  instrument: { admin: string; id: string }; // reward instrument (CC=Amulet/DSO)
}): { label: V30RewardKindLabel; json: V30RewardKindJson; hasToken: boolean; hasCode: boolean } | null {
  const rt = String(params.rewardType);
  const tokenLeg = { tokenAmount: v30Dec(params.rewardAmountCc), tokenInstrument: params.instrument };
  const codeHash = params.codePlaintext ? v30CodeHash(params.codePlaintext) : null;

  const isCodeType =
    rt === RewardType.INVITE_CODE_RANDOM ||
    rt === RewardType.INVITE_CODE_FCFS ||
    rt === RewardType.INVITE_CODE;
  const isCcOnly = rt === RewardType.CC_ONLY || rt === RewardType.CC_MANUAL;
  const isBoth = rt === RewardType.CC_AND_INVITE || rt === RewardType.CC_AND_CODE_RAFFLE;

  if (isCodeType && codeHash) {
    return {
      label: 'CODE_ONLY',
      // Variant ber-FIELD BERLABEL → value WAJIB objek {codeHash} (bukan string
      // polos). Bukti MainNet 2026-09-03: string polos ditolak participant
      // "Expected ujson.Obj"; TokenOnly (value objek) diterima. String polos
      // hanya untuk NEWTYPE seperti InputAmulet.
      json: { tag: 'CodeOnly', value: { codeHash } },
      hasToken: false,
      hasCode: true,
    };
  }
  if (isCcOnly && params.rewardAmountCc > 0) {
    return { label: 'TOKEN_ONLY', json: { tag: 'TokenOnly', value: tokenLeg }, hasToken: true, hasCode: false };
  }
  if (isBoth && params.rewardAmountCc > 0 && codeHash) {
    return {
      label: 'TOKEN_AND_CODE',
      json: { tag: 'TokenAndCode', value: { ...tokenLeg, codeHash } },
      hasToken: true,
      hasCode: true,
    };
  }
  // CC_AND_CODE_RAFFLE variant split (rewardVariant 'CODE' tanpa CC / 'CC' tanpa
  // kode) ditangani caller dengan men-set rewardType/rewardAmount secara efektif
  // sebelum memanggil helper ini. Kombinasi tak-terduga → null (caller menolak).
  return null;
}

/** Jendela pendek proposal lock — sama dengan jendela CC prepare→submit. */
export const V30_PROPOSAL_WINDOW_MS = 10 * 60 * 1000;

/** Margin perpanjangan preapproval: renew saat sisa < 15 dari 90 hari. */
export const V30_PREAPPROVAL_RENEWAL_MARGIN_DAYS = 15;
export const V30_PREAPPROVAL_LIFETIME_DAYS = 90;

// ── T1 — penutupan pendaftaran (70% durasi campaign, spesifikasi owner) ────
//
// T1 = startsAt + 70% × (endsAt − startsAt). Setelah T1: tidak ada lock baru
// (pendaftaran ditutup) DAN seluruh lock diverifikasi ulang (coret early-unlock).
// Fallback kalau startsAt kosong: T1 = endsAt (tanpa penutupan dini).
export function v30T1At(
  startsAt: Date | null | undefined,
  endsAt: Date | null | undefined,
): Date | null {
  if (!endsAt) return null;
  if (!startsAt) return endsAt;
  const t1 = new Date(startsAt.getTime() + 0.7 * (endsAt.getTime() - startsAt.getTime()));
  // Jangan melewati T2.
  return t1.getTime() >= endsAt.getTime() ? endsAt : t1;
}

// ── Matriks klaim v30 — SATU sumber kebenaran utk sumbu pemenang × reward ──
//
// Sumbu 1 (cara pilih pemenang — TIDAK ada di kontrak, murni backend):
//   FCFS  = peminang pertama (offer dibuat saat prepare-claim)
//   RAFFLE= admin draw (offer dibuat saat draw-winners)
//   OFFCHAIN = tanpa klaim on-chain (waitlist email)
// Sumbu 2 (jenis reward → RewardKind kontrak):
//   TOKEN_CC / TOKEN_USDCX → TokenOnly
//   CODE                   → CodeOnly
//   TOKEN_AND_CODE         → TokenAndCode
export type V30Selection = 'FCFS' | 'RAFFLE' | 'OFFCHAIN';
export type V30RewardKindSpec =
  | 'TOKEN_CC'
  | 'TOKEN_USDCX'
  | 'CODE'
  | 'TOKEN_AND_CODE';

export interface V30ClaimModel {
  selection: V30Selection;
  reward: V30RewardKindSpec | null;
  /** true = jenis ini punya jalur klaim on-chain v30. */
  allowed: boolean;
  /** Gate campaign meminta lock CC utk ikut (eligibility LOCK_CC). */
  requiresLock: boolean;
}

export function v30ClaimModel(quest: {
  rewardType: string;
  rewardToken?: string | null;
  entryGateMode?: string | null;
}): V30ClaimModel {
  const rt = String(quest.rewardType);
  const token = String(quest.rewardToken ?? 'CC').toUpperCase() === 'USDCX' ? 'USDCx' : 'CC';
  const requiresLock =
    quest.entryGateMode === 'CC_ONLY' ||
    (quest.entryGateMode !== 'NONE' && quest.entryGateMode !== 'POINTS_ONLY' && quest.entryGateMode !== undefined);

  const base = (selection: V30Selection): V30ClaimModel => ({
    selection,
    reward: null,
    allowed: false,
    requiresLock,
  });

  // ── FCFS: peminang pertama ──
  if (rt === 'INVITE_CODE_FCFS') {
    return { selection: 'FCFS', reward: 'CODE', allowed: true, requiresLock };
  }
  if (rt === 'CC_ONLY') {
    return {
      selection: 'FCFS',
      reward: token === 'USDCx' ? 'TOKEN_USDCX' : 'TOKEN_CC',
      allowed: true,
      requiresLock,
    };
  }
  // ── Raffle: admin draw ──
  if (rt === 'INVITE_CODE_RANDOM' || rt === 'INVITE_CODE') {
    return { selection: 'RAFFLE', reward: 'CODE', allowed: true, requiresLock };
  }
  if (rt === 'CC_MANUAL') {
    return {
      selection: 'RAFFLE',
      reward: token === 'USDCx' ? 'TOKEN_USDCX' : 'TOKEN_CC',
      allowed: true,
      requiresLock,
    };
  }
  if (rt === 'CC_AND_INVITE' || rt === 'CC_AND_CODE_RAFFLE') {
    return { selection: 'RAFFLE', reward: 'TOKEN_AND_CODE', allowed: true, requiresLock };
  }
  // ── Offchain ──
  if (rt === 'WAITLIST_EMAIL') {
    return { ...base('OFFCHAIN'), reward: null, allowed: false, requiresLock };
  }
  return { ...base('OFFCHAIN'), reward: null, allowed: false, requiresLock };
}
