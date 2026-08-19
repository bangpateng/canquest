import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { DEBUG_LEDGER } from '../common/debug-flags';
import { CantonLedgerService } from './canton-ledger.service';

/**
 * DAML template paths — module Main (canquest-v31, DAR packages/daml)
 *
 * Templates (9 — v31):
 *   Main:WalletRegistrationProposal — 2-step consent (admin propose → user Accept)
 *   Main:WalletRegistration         — identitas on-chain (signatory admin + userAddress)
 *   Main:CampaignEligibility        — bukti eligibility (LOCK_CC / POINTS) per campaign
 *   Main:QuestCampaign              — template induk quest (6 questKind) + state machine + eligibility guard
 *   Main:QuestClaimReceipt          — bukti klaim: atomic Settle + RevealCode + RecordTxId
 *   Main:PlatformTransfer           — atomic send token + platform fee
 *   Main:CoinLockProposal           — v31: 2-step lock (admin propose → user AcceptLock)
 *   Main:CoinLock                   — v31: lock proof utk ClaimSlot/DrawWinner LOCK_CC (lockId cross-check)
 *   Main:SecretRewardCode           — v31: kode reward admin-only, reveal setelah SETTLED
 *
 * v31 CHANGE vs v28 (kontrak FIX-13/14/15 — dampak ke backend):
 *   - QuestCampaign +5 field trusted*: rewardWallet, appProvider, treasury,
 *     instrumentAdmin, instrumentId. Instrument dipin ke pasangan CC/Amulet
 *     (DSO + "Amulet") karena fee SELALU CC; reward non-CC (USDCx) tetap
 *     lewat jalur delivery token terpisah (rewardCc=0 di chain → FIX-15 tidak
 *     mensyaratkan leg reward on-chain).
 *   - [FIX-14] ensure whitelist: eligibilityType HANYA "LOCK_CC"|"POINTS".
 *     "NONE" TIDAK sah lagi di kontrak → backend map NONE/CC_OR_POINTS ke
 *     "POINTS" (amount 0) dan claim path WAJIB buat CampaignEligibility
 *     dulu (auto-issue POINTS proof amount=earnPoints user).
 *   - [FIX-13] claimFeeCc > 0.0 wajib — campaign fee-0 ditolak ensure.
 *   - [FIX-14] questKind CC_* + rewardCc==0 ditolak ensure (CC reward wajib > 0).
 *   - ClaimSlot/DrawWinner +param lockCid (Optional ContractId CoinLock) —
 *     WAJIB Some utk LOCK_CC (cross-check e.lockId == l.lockId, FIX-11).
 *   - DrawWinner rewardCode jadi Optional Text (JSON: string | null).
 *   - CampaignEligibility +field lockId (Optional Text) + usedInClaimId (null saat create).
 *   - Settle/ExecuteTransfer memakai Splice TransferInstructionV2:
 *     Transfer.sender/.receiver bertipe Account { owner, provider, id } —
 *     regular account = { owner: <party>, provider: null, id: "" } (default
 *     id string kosong per Splice.Api.Token.HoldingV2). Field `lock` TIDAK
 *     ada di V2. Registry endpoint: /registry/transfer-instruction/v2/...
 *     (factory = ExternalPartyAmuletRules, splice-node 0.6.12).
 *   - Contract keys TIDAK ada (SDK 3.x) → uniqueness campaignId/claimId/
 *     lockId + 1 eligibility aktif per user per campaign DIJAMIN DB
 *     (unique constraint + pre-submit check) — lihat Prisma schema.
 *
 * YANG TIDAK ADA ON-CHAIN (off-chain Postgres):
 *   - Poin user        → User.earnPoints + EarnEntry (backend DB)
 *   - Daily check-in   → QuestSubmission unik + cooldown 24h (backend DB)
 *   - Referral reward  → ReferralReward (backend DB)
 *   - Audit trail CC   → redundan; ledger Canton sudah audit mutlak
 *   - Spin             → feature removed (tabel di-drop)
 *
 * Authorization pattern (Canton M3 + v24 multi-controller fix):
 *   signatory admin  — operator signs all contracts
 *   observer user    — user can only read, backend submits on their behalf
 *   Settle multi-controller: admin + userAddress + rewardSender (nested auth propagate)
 *   WalletRegistrationProposal.Accept: controller userAddress
 *     (backend custodial actAs [admin, userAddress] via grant rights)
 *   CoinLockProposal.AcceptLock: controller userAddress (pattern sama)
 *
 * TIMESTAMP KONVENSI (temuan #5 handoff v31): SEMUA field Text waktu on-chain
 * (createdAt/claimedAt/lockedAt/settledAt/dll) HARUS format ISO-8601 Zulu
 * detik-presisi "YYYY-MM-DDTHH:MM:SSZ" (via zulu()). Kontrak membandingkan
 * leksikografik (e.lockedAt > e.campaignCreatedAt) — format campuran
 * (ada/ms vs tanpa ms) menyebabkan inversi urutan. Field bertipe DAML Time
 * (Transfer.requestedAt/executeBefore) tetap RFC3339 via toISOString().
 *
 * All methods are best-effort: they log errors but never throw,
 * so a Canton outage does not break the main application flow.
 */
const TPL = {
  WalletRegistration: 'Main:WalletRegistration',
  WalletRegistrationProposal: 'Main:WalletRegistrationProposal', // v28 NEW (2-step)
  CampaignEligibility: 'Main:CampaignEligibility',
  QuestCampaign: 'Main:QuestCampaign',
  QuestClaimReceipt: 'Main:QuestClaimReceipt',
  PlatformTransfer: 'Main:PlatformTransfer',
  CoinLockProposal: 'Main:CoinLockProposal', // v31 NEW (2-step lock)
  CoinLock: 'Main:CoinLock', // v31 NEW (LOCK_CC proof)
  SecretRewardCode: 'Main:SecretRewardCode', // v31 NEW (kode rahasia)
} as const;

// ── Result types ──────────────────────────────────────────────────────────────

export interface WalletRegistrationLedgerResult {
  ledgerEnabled: boolean;
  contractId: string | null;
  errors: string[];
}

export interface QuestCampaignLedgerResult {
  ledgerEnabled: boolean;
  contractId: string | null;
  errors: string[];
}

export interface QuestClaimLedgerResult {
  ledgerEnabled: boolean;
  campaignContractId: string | null;
  claimContractId: string | null;
  errors: string[];
}

// Legacy result types (kept for backward compat with existing controllers)
export interface QuestLedgerSubmitResult {
  ledgerEnabled: boolean;
  participationContractId: string | null;
  completionContractId: string | null;
  rewardContractId: string | null;
  taskSubmissionIds: string[];
  errors: string[];
}

export interface QuestTaskLedgerResult {
  ledgerEnabled: boolean;
  participationContractId: string | null;
  taskSubmissionContractId: string | null;
  errors: string[];
}

@Injectable()
export class QuestLedgerService implements OnModuleInit {
  private readonly logger = new Logger(QuestLedgerService.name);
  private operatorFallbackWarned = false;

  constructor(
    private readonly ledger: CantonLedgerService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Canton Network safety check — pastikan 3 party ID LENGKAP berbeda.
   *
   * ⚠️ PENTING: Fingerprint SAMA adalah NORMAL di arsitektur Canton!
   *
   * Canton party ID format: username::fingerprint
   * - fingerprint = hash public key PARTICIPANT NODE (bukan user)
   * - 1 participant node = 1 fingerprint untuk SEMUA party di node itu
   * - Canton membedakan party dari NAMA LENGKAP (termasuk username sebelum ::)
   * - Isolasi privacy terjadi di level party ID lengkap, bukan fingerprint
   *
   * Contoh VALID (fingerprint sama, tapi party berbeda):
   *   canquest-validator-1::abc123def456
   *   canquest-operator::abc123def456
   *   canquest-fee::abc123def456
   *
   * Yang wajib divalidasi: partyHint (username) BERBEDA, dan bukan placeholder.
   *
   * Docs: https://docs.canton.network/overview/learn/architecture
   */
  onModuleInit(): void {
    if (!this.isConfigured()) return;
    const validator = this.config
      .get<string>('CANTON_VALIDATOR_PARTY_ID')
      ?.trim();
    const operator = this.operatorPartyId;
    const fee = this.config
      .get<string>('CANTON_FEE_RECIPIENT_PARTY_ID')
      ?.trim();

    const partyIds = [
      { label: 'validator', value: validator },
      { label: 'operator', value: operator },
      { label: 'fee', value: fee },
    ];

    // Validasi 1: semua party ID harus ada
    const missing = partyIds.filter((p) => !p.value).map((p) => p.label);
    if (missing.length > 0) {
      this.logger.error(
        `⛔ CANQUEST PARTY CONFIG MISSING: ${missing.join(', ')} party ID(s) not set in .env.\n` +
          '   Isi CANTON_VALIDATOR_PARTY_ID, CANTON_OPERATOR_PARTY_ID, dan CANTON_FEE_RECIPIENT_PARTY_ID.',
      );
      return;
    }

    // Validasi 2: partyHint (username) harus berbeda
    const hints = new Set(partyIds.map((p) => p.value!.split('::')[0] ?? ''));
    if (hints.size < 3) {
      this.logger.error(
        '╔══════════════════════════════════════════════════════════════╗\n' +
          '║  ⛔ CANQUEST PARTY HINT DUPLICATE                             ║\n' +
          '║  Dua atau lebih party ID memiliki nama yang SAMA.            ║\n' +
          '║  Canton akan menganggapnya sebagai 1 party.                  ║\n' +
          '║                                                              ║\n' +
          '║  Saat ini terdaftar:                                         ║\n' +
          `║    validator : ${(validator ?? 'MISSING').split('::')[0]?.padEnd(35) ?? 'MISSING'.padEnd(35)}║\n` +
          `║    operator  : ${(operator ?? 'MISSING').split('::')[0]?.padEnd(35) ?? 'MISSING'.padEnd(35)}║\n` +
          `║    fee       : ${(fee ?? 'MISSING').split('::')[0]?.padEnd(35) ?? 'MISSING'.padEnd(35)}║\n` +
          '║                                                              ║\n' +
          '║  PERBAIKI: Buat Splice user dengan nama BERBEDA di VPS1:     ║\n' +
          '║    curl -X POST .../admin/users -d \'{"name":"canquest-operator"}\'  ║\n' +
          '║    curl -X POST .../admin/users -d \'{"name":"canquest-fee"}\'       ║\n' +
          '╚══════════════════════════════════════════════════════════════╝',
      );
      return;
    }

    // Validasi 3: tidak boleh ada placeholder
    const placeholders = partyIds.filter((p) => {
      const v = p.value ?? '';
      return (
        v.includes('__GANTI') ||
        v.includes('__UPLOAD') ||
        v.includes('<FINGERPRINT')
      );
    });
    if (placeholders.length > 0) {
      this.logger.error(
        `⛔ CANQUEST PARTY PLACEHOLDER DETECTED: ${placeholders.map((p) => p.label).join(', ')} masih pakai placeholder.\n` +
          '   Jalankan: curl -X POST .../admin/users untuk mendapatkan party ID asli, lalu isi di .env.',
      );
      return;
    }

    // Validasi 4: fingerprint sebaiknya sama (karena 1 participant node)
    const fingerprints = new Set<string>();
    for (const p of partyIds) {
      const fp = p.value!.split('::')[1] ?? '';
      if (fp) fingerprints.add(fp);
    }
    if (fingerprints.size > 1) {
      this.logger.warn(
        `⚠ UNEXPECTED: ${fingerprints.size} different fingerprints detected across 3 party IDs.\n` +
          '   Ini berarti party dibuat di participant node BERBEDA. Pastikan SEMUA party dari VPS1 yang sama.',
      );
    } else {
      this.logger.log(
        `✅ Canton party check PASSED: ${hints.size} unique party hints, 1 participant (fingerprint ${[...fingerprints][0].slice(0, 12)}…)`,
      );
    }
  }

  // ── Type helpers — Canton JSON API v2 serialization ─────────────────────────

  /**
   * Canton JSON API v2 requires DAML Decimal fields to be sent as strings.
   * e.g. rewardCc: 10.0 → "10.0", claimFeeCc: 0.0 → "0.0"
   */
  private dec(value: number): string {
    return Number.isInteger(value) ? `${value}.0` : String(value);
  }

  /**
   * Canton JSON API v2 requires DAML Int fields to be sent as strings too.
   * e.g. earnedPoints: 0 → "0", maxWinners: 100 → "100"
   * Failure to do this causes: LEDGER_API_INTERNAL_ERROR "Expected ujson.Str"
   */
  private intStr(value: number): string {
    return String(value);
  }

  /**
   * Konvensi timestamp on-chain v31 (temuan #5): ISO-8601 Zulu detik-presisi
   * "YYYY-MM-DDTHH:MM:SSZ". Kontrak membandingkan Text timestamp secara
   * LEKSIKOGRAFIK (mis. e.lockedAt > e.campaignCreatedAt) — semua penulis
   * field waktu WAJIB pakai format ini agar urutan konsisten. toISOString()
   * mentah (dengan .mmm) tidak dipakai utk field Text waktu lagi.
   */
  private zulu(d: Date = new Date()): string {
    return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  /** Normalisasi Date/string apapun (Prisma DateTime, ISO ms, dll) ke Zulu. */
  private toZulu(value: Date | string | null | undefined): string {
    if (!value) return this.zulu();
    const d = typeof value === 'string' ? new Date(value) : value;
    return Number.isFinite(d.getTime()) ? this.zulu(d) : this.zulu();
  }

  // ── Config helpers ──────────────────────────────────────────────────────────

  private get damlPackageRef(): string {
    const name = this.config.get<string>('CANTON_DAML_PACKAGE_NAME')?.trim();
    if (name) return name.startsWith('#') ? name : `#${name}`;
    return '#canquest-v31';
  }

  private get operatorPartyId(): string | null {
    const dedicated = this.config
      .get<string>('CANTON_OPERATOR_PARTY_ID')
      ?.trim();
    if (dedicated) return dedicated;
    const validator = this.config
      .get<string>('CANTON_VALIDATOR_PARTY_ID')
      ?.trim();
    if (validator && !this.operatorFallbackWarned) {
      this.operatorFallbackWarned = true;
      this.logger.warn(
        'CANTON_OPERATOR_PARTY_ID unset — DAML uses CANTON_VALIDATOR_PARTY_ID as fallback.',
      );
    }
    return validator ?? null;
  }

  // ── v31 trusted-party getters (field QuestCampaign.trusted*) ────────────────

  /** Reward wallet resmi (Settle co-controller + validator rewardSender). */
  private get rewardWalletPartyId(): string | null {
    return this.config.get<string>('CANTON_REWARD_PARTY_ID')?.trim() ?? null;
  }

  /** Treasury resmi (receiver fee leg Settle / fee recipient). */
  private get treasuryPartyId(): string | null {
    return (
      this.config.get<string>('CANTON_FEE_RECIPIENT_PARTY_ID')?.trim() ?? null
    );
  }

  /**
   * App provider (FAR beneficiary). Optional — saat FAR off, kontrak hanya
   * butuh Party valid → fallback operator (tidak dipakai dalam choice body).
   */
  private get appProviderPartyId(): string | null {
    return (
      this.config.get<string>('CANTON_APP_PROVIDER_PARTY_ID')?.trim() ??
      this.operatorPartyId
    );
  }

  /**
   * Instrument admin CC/Amulet (DSO). Fee klaim SELALU CC → trusted pair di
   * QuestCampaign dipin ke (DSO, "Amulet"). Reward non-CC (USDCx) tidak lewat
   * Settle on-chain (rewardCc=0 → jalur delivery token terpisah).
   */
  private get instrumentAdminPartyId(): string | null {
    return this.config.get<string>('CANTON_DSO_PARTY_ID')?.trim() ?? null;
  }

  private templateId(suffix: (typeof TPL)[keyof typeof TPL]): string {
    return `${this.damlPackageRef}:${suffix}`;
  }

  /** Returns true when DAML ledger writes are enabled and configured. */
  isConfigured(): boolean {
    const enabled = this.config.get<string>('QUEST_LEDGER_ENABLED');
    if (enabled === 'false' || enabled === '0') return false;
    return !!this.operatorPartyId;
  }

  /** Returns true when ClaimSession / Spin ledger writes are enabled. */
  isClaimSessionConfigured(): boolean {
    const enabled = this.config.get<string>('CLAIM_SESSION_LEDGER_ENABLED');
    if (enabled === 'false' || enabled === '0') return false;
    return !!this.operatorPartyId;
  }

  private async ensureReachable(): Promise<string | null> {
    const ok = await this.ledger.isReachable();
    return ok ? null : 'Canton JSON Ledger API unreachable';
  }

  /** Find a contract ID in ACS results by matching createArgument fields. */
  private findContractId(
    contracts: unknown[],
    match: (args: Record<string, unknown>) => boolean,
  ): string | null {
    for (const entry of contracts) {
      if (!entry || typeof entry !== 'object') continue;
      const stack: unknown[] = [entry];
      while (stack.length) {
        const cur = stack.pop();
        if (!cur || typeof cur !== 'object') continue;
        if (Array.isArray(cur)) {
          stack.push(...cur);
          continue;
        }
        const obj = cur as Record<string, unknown>;
        const args =
          (obj.createArgument as Record<string, unknown> | undefined) ??
          ((obj.CreatedTreeEvent as Record<string, unknown> | undefined)
            ?.createArgument as Record<string, unknown> | undefined) ??
          ((obj.CreatedEvent as Record<string, unknown> | undefined)
            ?.createArgument as Record<string, unknown> | undefined);
        const cid =
          typeof obj.contractId === 'string'
            ? obj.contractId
            : typeof (
                  obj.CreatedTreeEvent as Record<string, unknown> | undefined
                )?.contractId === 'string'
              ? ((obj.CreatedTreeEvent as Record<string, unknown>)
                  .contractId as string)
              : null;
        if (args && cid && match(args)) return cid;
        for (const v of Object.values(obj)) stack.push(v);
      }
    }
    return null;
  }

  /** Extract all contractIds from a ledger exercise response (handles tuple returns). */
  private extractContractIds(text: string): string[] {
    const cids: string[] = [];
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const stack: unknown[] = [parsed];
      const seen = new Set<string>();
      while (stack.length) {
        const cur = stack.pop();
        if (!cur || typeof cur !== 'object') continue;
        if (Array.isArray(cur)) {
          for (let i = cur.length - 1; i >= 0; i--) stack.push(cur[i]);
          continue;
        }
        const obj = cur as Record<string, unknown>;
        const cid = typeof obj.contractId === 'string' ? obj.contractId : null;
        if (cid && !seen.has(cid)) {
          const hasTemplateOrCreate =
            obj.templateId !== undefined ||
            obj.createArgument !== undefined ||
            obj.CreatedEvent !== undefined ||
            obj.CreatedTreeEvent !== undefined;
          if (hasTemplateOrCreate || cids.length < 2) {
            cids.push(cid);
            seen.add(cid);
          }
        }
        for (const v of Object.values(obj)) stack.push(v);
      }
    } catch {
      /* ignore parse errors */
    }
    return cids;
  }

  /**
   * Extract contract IDs dari response JSON, FILTER berdasarkan templateId suffix.
   * Lebih robust dari extractContractIds (urutan-based) — hindari bug WRONGLY_TYPED_CONTRACT
   * saat urutan CreatedEvent di transaction tree tidak sesuai ekspektasi.
   *
   * @param text  - JSON response dari exerciseChoice (submit-and-wait-for-transaction-tree)
   * @param suffix - templateId suffix, mis. 'Main:QuestClaimReceipt'
   * @returns contract IDs (string) yg match suffix, urutan appearance. Kosong jika none.
   */
  private extractContractIdsByTemplate(
    text: string,
    suffix: (typeof TPL)[keyof typeof TPL],
  ): string[] {
    const cids: string[] = [];
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const stack: unknown[] = [parsed];
      const seen = new Set<string>();
      while (stack.length) {
        const cur = stack.pop();
        if (!cur || typeof cur !== 'object') continue;
        if (Array.isArray(cur)) {
          for (let i = cur.length - 1; i >= 0; i--) stack.push(cur[i]);
          continue;
        }
        const obj = cur as Record<string, unknown>;
        const cid = typeof obj.contractId === 'string' ? obj.contractId : null;
        const tplId =
          typeof obj.templateId === 'string' ? obj.templateId : null;
        if (cid && tplId && tplId.endsWith(suffix) && !seen.has(cid)) {
          cids.push(cid);
          seen.add(cid);
        }
        for (const v of Object.values(obj)) stack.push(v);
      }
    } catch {
      /* ignore parse errors */
    }
    return cids;
  }

  // ── 1. WalletRegistration (v28: 2-step Proposal → Accept) ───────────────────
  //
  // v28 WalletRegistration jadi co-signed (signatory admin + userAddress).
  // Admin tidak bisa create sendiri → backend jalankan 2-step custodial:
  //   Step 1: create WalletRegistrationProposal (actAs: [admin])
  //   Step 2: exercise Accept atas nama user (actAs: [admin, userAddress])
  // Pattern sama dengan Settle multi-controller (grant rights utk user party).
  //
  // userProfileRef format: "user:<userId>" (reference ke Prisma User.id).
  // PII (username, inviteCode) TIDAK on-chain — tetap di DB, direferensikan
  // via userProfileRef.

  async registerWallet(params: {
    userPartyId: string;
    userId: string; // v28: utk userProfileRef "user:<userId>"
    username: string; // utk log + commandId (tidak dikirim ke ledger)
    partyId: string;
    inviteCode: string; // tetap di DB, TIDAK on-chain (v28)
  }): Promise<WalletRegistrationLedgerResult> {
    const result: WalletRegistrationLedgerResult = {
      ledgerEnabled: false,
      contractId: null,
      errors: [],
    };
    if (!this.isConfigured()) return result;
    const walletTpl = this.templateId(TPL.WalletRegistration);
    const proposalTpl = this.templateId(TPL.WalletRegistrationProposal);
    const operator = this.operatorPartyId;
    if (!operator) {
      result.errors.push('Canton operator party not configured');
      return result;
    }
    const reachErr = await this.ensureReachable();
    if (reachErr) {
      result.errors.push(reachErr);
      return result;
    }
    result.ledgerEnabled = true;
    await this.ledger
      .grantUserRights(operator)
      .catch((err) =>
        this.logger.warn(`grantUserRights(operator) failed: ${String(err)}`),
      );
    // Grant rights utk user party (needed utk Step 2 Accept, controller userAddress).
    await this.ledger
      .grantUserRights(params.userPartyId)
      .catch((err) =>
        this.logger.warn(`grantUserRights(user) failed: ${String(err)}`),
      );

    // Idempotency: jika WalletRegistration utk user ini sudah ada, return langsung.
    const existing = this.findContractId(
      await this.ledger.queryActiveContracts(walletTpl, [operator]),
      (args) => args.userAddress === params.userPartyId,
    );
    if (existing) {
      result.contractId = existing;
      return result;
    }

    const userProfileRef = `user:${params.userId}`;
    const nowIso = this.zulu(); // konvensi timestamp Text on-chain v31

    // ── Step 1: create WalletRegistrationProposal (actAs: [admin]) ──────────
    const proposalRes = await this.ledger.createContract(
      proposalTpl,
      {
        admin: operator,
        userAddress: params.userPartyId,
        userProfileRef,
        partyId: params.partyId,
        registeredAt: nowIso,
      },
      [operator],
      `wallet-prop-${params.username}-${randomUUID()}`,
    );
    if (!proposalRes.ok || !proposalRes.contractId) {
      result.errors.push(
        this.formatLedgerError(
          proposalRes.error,
          'Failed to create WalletRegistrationProposal',
        ),
      );
      return result;
    }
    const proposalCid = proposalRes.contractId;

    // ── Step 2: exercise Accept (actAs: [admin, userAddress], custodial) ────
    // Accept controller = userAddress. Backend submit atas nama user
    // (grant rights sudah dilakukan di atas). Accept create WalletRegistration.
    const acceptRes = await this.ledger.exerciseChoice(
      proposalCid,
      proposalTpl,
      'Accept',
      {}, // Accept tidak punya choice arg (hanya controller)
      [operator, params.userPartyId],
      `wallet-accept-${params.username}-${randomUUID()}`,
      'submit-and-wait-for-transaction-tree',
    );
    if (!acceptRes.ok) {
      // Step 2 gagal → Proposal orphan (non-critical). Idempotency check di
      // retry tetap valid (WalletRegistration belum ada). Proposal bisa di-
      // cleanup manual nanti bila perlu.
      result.errors.push(
        this.formatLedgerError(
          acceptRes.text,
          'Failed to exercise WalletRegistrationProposal.Accept',
        ),
      );
      return result;
    }

    // WalletRegistration created event ada di transaction tree.
    // Extract by template (lebih robust dari urutan-based).
    const walletCids = this.extractContractIdsByTemplate(
      acceptRes.text,
      TPL.WalletRegistration,
    );
    const walletCid = walletCids[0] ?? null;
    if (walletCid) {
      this.logger.log(
        `WalletRegistration created (v28 2-step): @${params.username} partyId=${params.partyId.split('::')[0]} profileRef=${userProfileRef}`,
      );
      result.contractId = walletCid;
    } else {
      // Accept sukses tapi WalletRegistration cid tidak ter-extract —
      // log warning, tetap anggap sukses (ledger state sudah benar).
      this.logger.warn(
        `WalletRegistration Accept OK tapi cid tidak ter-extract @${params.username}`,
      );
      result.errors.push(
        'WalletRegistrationProposal.Accept succeeded but WalletRegistration cid not found in tree',
      );
    }
    return result;
  }

  // ── 2. QuestCampaign ────────────────────────────────────────────────────────

  static mapRewardTypeToQuestKind(
    rewardType: string,
    hasFcfsSlots: boolean,
  ):
    | 'CC_FCFS'
    | 'CC_RAFFLE'
    | 'CODE_FCFS'
    | 'CODE_RAFFLE'
    | 'CC_AND_CODE_RAFFLE'
    | 'WAITLIST' {
    switch (rewardType) {
      case 'CC_ONLY':
        return hasFcfsSlots ? 'CC_FCFS' : 'CC_RAFFLE';
      case 'CC_MANUAL':
        return 'CC_RAFFLE';
      case 'CC_AND_INVITE':
        return 'CC_FCFS';
      case 'INVITE_CODE_FCFS':
        return 'CODE_FCFS';
      case 'INVITE_CODE_RANDOM':
      case 'INVITE_CODE':
        return 'CODE_RAFFLE';
      case 'CC_AND_CODE_RAFFLE':
        return 'CC_AND_CODE_RAFFLE';
      case 'WAITLIST_EMAIL':
        return 'WAITLIST';
      default:
        return hasFcfsSlots ? 'CC_FCFS' : 'CC_RAFFLE';
    }
  }

  async createQuestCampaign(params: {
    campaignId: string;
    title: string;
    questKind:
      | 'CC_FCFS'
      | 'CC_RAFFLE'
      | 'CODE_FCFS'
      | 'CODE_RAFFLE'
      | 'CC_AND_CODE_RAFFLE'
      | 'WAITLIST';
    rewardCc: number;
    rewardToken?: 'CC' | 'USDCx' | null;
    claimFeeCc: number;
    maxWinners: number;
    /** v25: DAML eligibility type. "NONE" default = no on-chain eligibility check.
     *  Backend map dari Quest.entryGateMode (CC_ONLY→LOCK_CC, POINTS_ONLY→POINTS,
     *  CC_OR_POINTS/NONE→NONE).
     *  v31 [FIX-14]: "NONE" TIDAK sah di kontrak (ensure whitelist) →
     *  di-map ke "POINTS" amount 0 di sini; claim path tetap wajib buat
     *  eligibility proof (auto-issue POINTS amount=earnPoints user). */
    eligibilityType?: 'NONE' | 'LOCK_CC' | 'POINTS';
    /** v25: min CC locked (LOCK_CC) atau min points (POINTS). 0 bila NONE. */
    eligibilityAmount?: number;
  }): Promise<QuestCampaignLedgerResult> {
    const result: QuestCampaignLedgerResult = {
      ledgerEnabled: false,
      contractId: null,
      errors: [],
    };
    if (!this.isConfigured()) return result;
    const tpl = this.templateId(TPL.QuestCampaign);
    const operator = this.operatorPartyId;
    if (!operator) {
      result.errors.push('Canton operator party not configured');
      return result;
    }
    // ── v31 ensure guards (fail fast di backend, sebelum submit) ─────────────
    // [FIX-13] claimFeeCc wajib > 0 — campaign fee-0 deadlock di Settle.
    if (!(params.claimFeeCc > 0)) {
      result.errors.push(
        `claimFeeCc harus > 0 (v31 FIX-13); dapat ${params.claimFeeCc}`,
      );
      return result;
    }
    // [FIX-14] questKind CC_* wajib rewardCc > 0 (ensure kontrak).
    if (
      (params.questKind === 'CC_FCFS' ||
        params.questKind === 'CC_RAFFLE' ||
        params.questKind === 'CC_AND_CODE_RAFFLE') &&
      !(params.rewardCc > 0)
    ) {
      result.errors.push(
        `questKind ${params.questKind} wajib rewardCc > 0 (v31 FIX-14); dapat ${params.rewardCc}`,
      );
      return result;
    }
    // v31 trusted* parties wajib lengkap (dipakai guard Settle on-chain).
    const trustedRewardWallet = this.rewardWalletPartyId;
    const trustedTreasury = this.treasuryPartyId;
    const trustedAppProvider = this.appProviderPartyId;
    const trustedInstrumentAdmin = this.instrumentAdminPartyId;
    const missing = [
      ['CANTON_REWARD_PARTY_ID', trustedRewardWallet],
      ['CANTON_FEE_RECIPIENT_PARTY_ID', trustedTreasury],
      ['CANTON_DSO_PARTY_ID', trustedInstrumentAdmin],
    ].filter(([, v]) => !v);
    if (missing.length > 0) {
      result.errors.push(
        `Party config v31 missing: ${missing.map(([k]) => k).join(', ')}`,
      );
      return result;
    }
    const reachErr = await this.ensureReachable();
    if (reachErr) {
      result.errors.push(reachErr);
      return result;
    }
    result.ledgerEnabled = true;
    // [FIX-14] "NONE" tidak sah di ensure kontrak → map ke POINTS amount 0.
    const onChainEligibilityType =
      params.eligibilityType === 'LOCK_CC' ? 'LOCK_CC' : 'POINTS';
    const res = await this.ledger.createContract(
      tpl,
      {
        admin: operator,
        campaignId: params.campaignId,
        title: params.title,
        questKind: params.questKind,
        rewardCc: this.dec(params.rewardCc),
        rewardToken: params.rewardToken === 'USDCx' ? 'USDCx' : null,
        claimFeeCc: this.dec(params.claimFeeCc),
        maxWinners: this.intStr(params.maxWinners),
        currentClaims: this.intStr(0),
        status: 'ACTIVE',
        eligibilityType: onChainEligibilityType,
        eligibilityAmount: this.dec(params.eligibilityAmount ?? 0),
        // v31 NEW: trusted parties utk guard Settle/ExecuteTransfer on-chain.
        trustedRewardWallet,
        trustedAppProvider,
        trustedTreasury,
        trustedInstrumentAdmin,
        // Fee selalu CC/Amulet → pin ke pasangan (DSO, "Amulet"). Reward
        // non-CC tidak lewat Settle (lihat catatan header).
        trustedInstrumentId: 'Amulet',
        createdAt: this.zulu(),
      },
      [operator],
      `quest-campaign-${params.campaignId}`,
    );
    if (res.ok && res.contractId) {
      this.logger.log(
        `QuestCampaign created (v31): ${params.campaignId} kind=${params.questKind} quota=${params.maxWinners} eligibility=${onChainEligibilityType} fee=${params.claimFeeCc}`,
      );
      result.contractId = res.contractId;
    } else {
      result.errors.push(
        this.formatLedgerError(res.error, 'Failed to create QuestCampaign'),
      );
    }
    return result;
  }

  // ── 2b. CampaignEligibility (v25) ─────────────────────────────────────────
  // Eligibility proof: bukti on-chain user memenuhi syarat utk claim campaign.
  // Dibuat backend SETELAH verifikasi lock CC (AllocationFactory) atau points.
  // Fetch di ClaimSlot/DrawWinner utk guard on-chain.

  async createCampaignEligibility(params: {
    userPartyId: string;
    campaignId: string;
    campaignCreatedAt: string; // ISO timestamp campaign dibuat (utk lock-after guard)
    eligibilityType: 'LOCK_CC' | 'POINTS';
    amount: number; // CC locked (LOCK_CC) atau points (POINTS)
    lockedAt: string | null; // ISO kapan user lock CC (LOCK_CC); null bila POINTS
    expiresAt: string; // ISO eligibility berlaku sampai kapan
    /** v31 [FIX-11]: lockId CcLock/CoinLock (LOCK_CC). null bila POINTS.
     *  Dicocokkan on-chain dgn CoinLock.lockId saat ClaimSlot/DrawWinner. */
    lockId?: string | null;
  }): Promise<{ ok: boolean; contractId: string | null; errors: string[] }> {
    if (!this.isClaimSessionConfigured())
      return {
        ok: false,
        contractId: null,
        errors: ['Claim session ledger disabled'],
      };
    const tpl = this.templateId(TPL.CampaignEligibility);
    const operator = this.operatorPartyId;
    if (!operator)
      return {
        ok: false,
        contractId: null,
        errors: ['Canton operator party not configured'],
      };
    const reachErr = await this.ensureReachable();
    if (reachErr) return { ok: false, contractId: null, errors: [reachErr] };
    try {
      const res = await this.ledger.createContract(
        tpl,
        {
          admin: operator,
          userAddress: params.userPartyId,
          campaignId: params.campaignId,
          campaignCreatedAt: this.toZulu(params.campaignCreatedAt),
          eligibilityType: params.eligibilityType,
          amount: this.dec(params.amount),
          lockedAt: params.lockedAt ? this.toZulu(params.lockedAt) : '',
          expiresAt: this.toZulu(params.expiresAt),
          status: 'ELIGIBLE',
          // v31 NEW: cross-check lockId (FIX-11) + Optional kosong saat create.
          lockId: params.lockId ?? null,
          usedInClaimId: null,
        },
        [operator],
        `eligibility-${params.campaignId}-${params.userPartyId.slice(0, 16)}`,
      );
      if (res.ok && res.contractId) {
        this.logger.log(
          `CampaignEligibility created: campaign=${params.campaignId.slice(0, 8)} user=${params.userPartyId.split('::')[0]} type=${params.eligibilityType} amount=${params.amount}`,
        );
        return { ok: true, contractId: res.contractId, errors: [] };
      }
      const err = this.formatLedgerError(
        res.error,
        'Failed to create CampaignEligibility',
      );
      this.logger.warn(`CampaignEligibility fail: ${err}`);
      return { ok: false, contractId: null, errors: [err] };
    } catch (err) {
      const msg = `createCampaignEligibility exception: ${String(err)}`;
      this.logger.warn(msg);
      return { ok: false, contractId: null, errors: [msg] };
    }
  }

  // ── 2c. CoinLock (v31: 2-step Proposal → AcceptLock) ───────────────────────
  //
  // CoinLock = proof lock CC canquest-domain utk guard ClaimSlot/DrawWinner
  // LOCK_CC (cross-check e.lockId == l.lockId — FIX-11). BUKAN pengganti
  // LockedAmulet (Splice): LockedAmulet tetap sumber kebenaran jumlah CC
  // terkunci; CoinLock mencerminkannya untuk quest domain.
  //
  // 2-step custodial (pattern sama WalletRegistrationProposal):
  //   Step 1: create CoinLockProposal   (actAs [admin])
  //   Step 2: exercise AcceptLock       (actAs [admin, userAddress] — controller userAddress)
  //
  // Kontrak HANYA menerima durationDays 3|7|15 → caller memetakan term lock
  // asli (LOCK_TERM_OPTIONS, bisa menit/30d) ke nilai terdekat; expiresAt
  // Text tetap menyimpan expiry ASLI (guard kontrak tidak mencocokkan
  // durationDays vs expiresAt).
  //
  // Idempoten: ACS check CoinLock aktif dgn lockId sama → return cid lama.
  async createCoinLock(params: {
    userPartyId: string;
    /** Deterministik per konteks (mis. `lock:<questId>:<userId>`) agar retry aman. */
    lockId: string;
    amount: number;
    /** HARUS salah satu 3|7|15 (ensure kontrak). */
    durationDays: 3 | 7 | 15;
    lockedAt: string; // ISO waktu lock asli
    expiresAt: string; // ISO expiry asli
    campaignId?: string | null;
  }): Promise<{ ok: boolean; contractId: string | null; errors: string[] }> {
    const fail = (errors: string[]) => ({
      ok: false,
      contractId: null,
      errors,
    });
    if (!this.isClaimSessionConfigured())
      return fail(['Claim session ledger disabled']);
    const proposalTpl = this.templateId(TPL.CoinLockProposal);
    const operator = this.operatorPartyId;
    if (!operator) return fail(['Canton operator party not configured']);
    if (!params.lockId)
      return fail(['lockId wajib non-kosong (ensure kontrak)']);
    if (!(params.amount > 0))
      return fail(['CoinLock amount harus > 0 (ensure)']);
    if (![3, 7, 15].includes(params.durationDays))
      return fail([
        `durationDays harus 3|7|15 (ensure kontrak); dapat ${params.durationDays}`,
      ]);
    const reachErr = await this.ensureReachable();
    if (reachErr) return fail([reachErr]);
    try {
      await this.ledger
        .grantUserRights(operator)
        .catch((err) =>
          this.logger.warn(`grantUserRights(operator) failed: ${String(err)}`),
        );
      await this.ledger
        .grantUserRights(params.userPartyId)
        .catch((err) =>
          this.logger.warn(`grantUserRights(user) failed: ${String(err)}`),
        );

      // Idempotency: CoinLock aktif dengan lockId sama sudah ada → reuse.
      const coinLockTpl = this.templateId(TPL.CoinLock);
      const existing = this.findContractId(
        await this.ledger.queryActiveContracts(coinLockTpl, [operator]),
        (args) => args.lockId === params.lockId,
      );
      if (existing) return { ok: true, contractId: existing, errors: [] };

      // Step 1: create CoinLockProposal (actAs [admin])
      const proposalRes = await this.ledger.createContract(
        proposalTpl,
        {
          admin: operator,
          userAddress: params.userPartyId,
          lockId: params.lockId,
          amount: this.dec(params.amount),
          durationDays: this.intStr(params.durationDays),
          lockedAt: this.toZulu(params.lockedAt),
          expiresAt: this.toZulu(params.expiresAt),
          campaignId: params.campaignId ?? null,
        },
        [operator],
        `coin-lock-prop-${params.lockId}-${randomUUID()}`,
      );
      if (!proposalRes.ok || !proposalRes.contractId) {
        return fail([
          this.formatLedgerError(
            proposalRes.error,
            'Failed to create CoinLockProposal',
          ),
        ]);
      }

      // Step 2: exercise AcceptLock (actAs [admin, userAddress], custodial)
      const acceptRes = await this.ledger.exerciseChoice(
        proposalRes.contractId,
        proposalTpl,
        'AcceptLock',
        {},
        [operator, params.userPartyId],
        `coin-lock-accept-${params.lockId}-${randomUUID()}`,
        'submit-and-wait-for-transaction-tree',
      );
      if (!acceptRes.ok) {
        return fail([
          this.formatLedgerError(
            acceptRes.text,
            'Failed to exercise CoinLockProposal.AcceptLock',
          ),
        ]);
      }
      const coinLockCids = this.extractContractIdsByTemplate(
        acceptRes.text,
        TPL.CoinLock,
      );
      const coinLockCid = coinLockCids[0] ?? null;
      if (!coinLockCid) {
        return fail([
          'CoinLockProposal.AcceptLock OK tapi CoinLock cid tidak ter-extract',
        ]);
      }
      this.logger.log(
        `CoinLock created (v31): lockId=${params.lockId.slice(0, 24)} user=${params.userPartyId.split('::')[0]} amount=${params.amount} days=${params.durationDays}`,
      );
      return { ok: true, contractId: coinLockCid, errors: [] };
    } catch (err) {
      const msg = `createCoinLock exception: ${String(err)}`;
      this.logger.warn(msg);
      return fail([msg]);
    }
  }

  async claimFcfsSlot(params: {
    campaignContractId: string;
    userPartyId: string;
    claimId: string;
    rewardSenderPartyId: string; // v24: party reward wallet (CANTON_REWARD_PARTY_ID)
    // dikirim ke ClaimSlot choice → set field rewardSender
    // di QuestClaimReceipt → jadi co-controller Settle.
    /** v25: DAML CampaignEligibility contract id (utk fetch guard on-chain).
     *  v31: WAJIB Some utk semua campaign (NONE di-map ke POINTS proof). */
    eligibilityCid?: string | null;
    /** v31 [FIX-11]: CoinLock contract id — WAJIB utk eligibility LOCK_CC
     *  (kontrak fetch + cross-check lockId). Null utk POINTS. */
    lockCid?: string | null;
  }): Promise<QuestClaimLedgerResult> {
    const result: QuestClaimLedgerResult = {
      ledgerEnabled: false,
      campaignContractId: null,
      claimContractId: null,
      errors: [],
    };
    if (!this.isClaimSessionConfigured()) return result;
    const tpl = this.templateId(TPL.QuestCampaign);
    const operator = this.operatorPartyId;
    if (!operator) {
      result.errors.push('Canton operator party not configured');
      return result;
    }
    const reachErr = await this.ensureReachable();
    if (reachErr) {
      result.errors.push(reachErr);
      return result;
    }
    result.ledgerEnabled = true;
    const { ok, text } = await this.ledger.exerciseChoice(
      params.campaignContractId,
      tpl,
      'ClaimSlot',
      {
        user: params.userPartyId,
        claimId: params.claimId,
        claimedAt: this.zulu(),
        rewardSender: params.rewardSenderPartyId, // v24: co-controller Settle
        eligibilityCid: params.eligibilityCid ?? null, // v25: Optional (nullable)
        lockCid: params.lockCid ?? null, // v31: Optional CoinLock (LOCK_CC)
      },
      [operator],
      `claim-fcfs-${params.claimId}-${randomUUID()}`,
      'submit-and-wait-for-transaction-tree',
    );
    if (ok) {
      // FIX: extract by templateId (bukan urutan) — ClaimSlot return
      // (ContractId QuestCampaign, ContractId QuestClaimReceipt) tapi urutan
      // di transaction tree response tidak dijamin. Sebelumnya pakai cids[0/1]
      // → kadang dapat QuestCampaign sbg claimContractId → Settle gagal
      // WRONGLY_TYPED_CONTRACT ("Expected QuestClaimReceipt but got QuestCampaign").
      const campaignCids = this.extractContractIdsByTemplate(
        text,
        TPL.QuestCampaign,
      );
      const claimCids = this.extractContractIdsByTemplate(
        text,
        TPL.QuestClaimReceipt,
      );
      result.campaignContractId = campaignCids[0] ?? null;
      result.claimContractId = claimCids[0] ?? null;
      this.logger.log(
        `ClaimSlot: user=${params.userPartyId.split('::')[0]} campaign=${result.campaignContractId?.slice(0, 12) ?? 'none'}... claim=${result.claimContractId?.slice(0, 12) ?? 'none'}`,
      );
    } else {
      result.errors.push(
        this.formatLedgerError(
          text,
          'ClaimSlot failed (quota full or ledger error)',
        ),
      );
    }
    return result;
  }

  async drawRaffleWinner(params: {
    campaignContractId: string;
    userPartyId: string;
    claimId: string;
    rewardCode?: string;
    rewardSenderPartyId: string; // v24: party reward wallet (CANTON_REWARD_PARTY_ID)
    /** v25: DAML CampaignEligibility contract id. v31: wajib Some (NONE→POINTS). */
    eligibilityCid?: string | null;
    /** v31 [FIX-11]: CoinLock contract id — WAJIB utk eligibility LOCK_CC. */
    lockCid?: string | null;
  }): Promise<QuestClaimLedgerResult> {
    const result: QuestClaimLedgerResult = {
      ledgerEnabled: false,
      campaignContractId: null,
      claimContractId: null,
      errors: [],
    };
    if (!this.isClaimSessionConfigured()) return result;
    const tpl = this.templateId(TPL.QuestCampaign);
    const operator = this.operatorPartyId;
    if (!operator) {
      result.errors.push('Canton operator party not configured');
      return result;
    }
    const reachErr = await this.ensureReachable();
    if (reachErr) {
      result.errors.push(reachErr);
      return result;
    }
    result.ledgerEnabled = true;
    const { ok, text } = await this.ledger.exerciseChoice(
      params.campaignContractId,
      tpl,
      'DrawWinner',
      {
        user: params.userPartyId,
        claimId: params.claimId,
        // v31: rewardCode jadi Optional Text — DAML-LF JSON: Some → string
        // mentah, None → null. (v28 kirim '' utk "tanpa kode"; '' di v31
        // berarti Some "" → kontrak create SecretRewardCode kosong = DITOLAK
        // ensure code /= "". Jadi null bila tidak ada kode.)
        rewardCode: params.rewardCode ?? null,
        drawnAt: this.zulu(),
        rewardSender: params.rewardSenderPartyId, // v24: co-controller Settle
        eligibilityCid: params.eligibilityCid ?? null, // v25: Optional (nullable)
        lockCid: params.lockCid ?? null, // v31: Optional CoinLock (LOCK_CC)
      },
      [operator],
      `draw-raffle-${params.claimId}-${randomUUID()}`,
      'submit-and-wait-for-transaction-tree',
    );
    if (ok) {
      // FIX: extract by templateId (bukan urutan) — sama bug dgn claimFcfsSlot.
      const campaignCids = this.extractContractIdsByTemplate(
        text,
        TPL.QuestCampaign,
      );
      const claimCids = this.extractContractIdsByTemplate(
        text,
        TPL.QuestClaimReceipt,
      );
      result.campaignContractId = campaignCids[0] ?? null;
      result.claimContractId = claimCids[0] ?? null;
    } else {
      result.errors.push(this.formatLedgerError(text, 'DrawWinner failed'));
    }
    return result;
  }

  // ── 3. QuestClaimReceipt: RevealCode (v22/v23 rename from RevealRewardCode) ──

  async revealRewardCode(params: {
    claimContractId: string;
    code: string;
  }): Promise<{ ok: boolean; newContractId: string | null; errors: string[] }> {
    if (!this.isClaimSessionConfigured())
      return {
        ok: false,
        newContractId: null,
        errors: ['Claim session ledger disabled'],
      };
    const tpl = this.templateId(TPL.QuestClaimReceipt);
    const operator = this.operatorPartyId;
    if (!operator)
      return {
        ok: false,
        newContractId: null,
        errors: ['Canton operator party not configured'],
      };
    const { ok, text } = await this.ledger.exerciseChoice(
      params.claimContractId,
      tpl,
      'RevealCode',
      { code: params.code, revealedAt: this.zulu() },
      [operator],
      `reveal-code-${randomUUID()}`,
    );
    if (ok) {
      const cids = this.extractContractIds(text);
      return { ok: true, newContractId: cids[0] ?? null, errors: [] };
    }
    return { ok: false, newContractId: null, errors: [text.slice(0, 200)] };
  }

  /**
   * settleAtomic — DAML v23 Settle choice (ATOMIC fee + optional reward).
   *
   * Nested-exercise TransferFactory_Transfer di dalam Settle choice body:
   *   1. FEE leg (wajib): user → feeReceiver (canquest-fee)
   *   2. REWARD leg (optional bila rewardAmount=0): rewardSender → user
   *   3. (optional) FAR activity marker
   * Semua dalam 1 transaction tree → atomic all-or-nothing.
   *
   * actAs command: [operator, user, rewardSender] (+ appProvider bila FAR).
   * Nested exercises inherit authorization dari command-level actAs (Canton M3).
   *
   * Tx ID TIDAK bisa didapat dari Settle (TransferFactory_Transfer return record,
   * bukan tx id). Settle return ContractId QuestClaimReceipt SETTLED baru (settledCid).
   * Tx id di-extract dari transaction tree response (updateId) lalu di-record
   * via recordTxId() post-settle.
   *
   * ⚠️ v23 BREAKING vs v21 atomicFeeAndReward:
   *   - atomicFeeAndReward hanya receipt (CC transfer di CIP-56 terpisah, non-atomic)
   *   - settleAtomic: CC transfer DI DALAM choice (atomic sungguhan)
   *   - Backend caller tidak boleh panggil collectClaimFee/sendReward terpisah
   *     bila settleAtomic dipakai (double-transfer). Fallback path di-belakang flag.
   */
  async settleAtomic(params: {
    claimContractId: string; // QuestClaimReceipt PRE_SETTLE
    userPartyId: string; // sender fee leg, receiver reward leg
    feeReceiverPartyId: string; // CANTON_FEE_RECIPIENT_PARTY_ID
    feeAmount: number; // CC amount (claimFeeCc)
    rewardSenderPartyId: string; // CANTON_REWARD_PARTY_ID (skip bila rewardAmount=0)
    rewardAmount: number; // 0 untuk kode claim → reward=None
    rewardToken: 'CC' | 'USDCx';
    rewardInstrumentId?: string; // resolve caller utk USDCx (CC default Amulet)
    rewardInstrumentAdmin?: string; // resolve caller utk USDCx (CC default DSO)
    featuredAppRightCid?: string | null;
    appProviderPartyId?: string;
  }): Promise<{
    ok: boolean;
    settledCid: string | null; // QuestClaimReceipt SETTLED baru
    updateId: string | null; // Canton tx id (utk recordTxId)
    errors: string[];
  }> {
    const fail = (errors: string[]) => ({
      ok: false,
      settledCid: null,
      updateId: null,
      errors,
    });
    if (!this.isClaimSessionConfigured())
      return fail(['Claim session ledger disabled']);
    const tpl = this.templateId(TPL.QuestClaimReceipt);
    const operator = this.operatorPartyId;
    if (!operator) return fail(['Canton operator party not configured']);
    const dso = this.config.get<string>('CANTON_DSO_PARTY_ID')?.trim();
    if (!dso) return fail(['CANTON_DSO_PARTY_ID not configured']);

    try {
      const now = new Date();
      const nowIso = now.toISOString(); // DAML Time (Transfer.requestedAt) — RFC3339
      const executeBefore = new Date(
        now.getTime() + 24 * 3600 * 1000,
      ).toISOString();
      const hasReward = params.rewardAmount > 0;

      // ── v31: Account V2 — regular account { owner, provider: null, id: "" } ──
      // Splice.Api.Token.HoldingV2.Account. owner WAJIB Some utk regular
      // account (scan registry: TokenStandardAccount.tryGetRegularAccountOwner).
      const account = (partyId: string) => ({
        owner: partyId,
        provider: null,
        id: '',
      });

      // ── FEE leg: user → feeReceiver (CC Amulet, selalu jalan) ──────────────
      const feeInstrumentAdmin = dso;
      const feeHoldings = await this.ledger.queryAmuletHoldings(
        params.userPartyId,
      );
      const feeInputCids = this.greedyFillHoldings(
        feeHoldings,
        params.feeAmount,
      );
      if (feeInputCids.length === 0) {
        return fail([
          `Insufficient Amulet holdings for fee ${params.feeAmount} CC (user=${params.userPartyId.split('::')[0]})`,
        ]);
      }
      // v31 TransferInstructionV2.Transfer — TANPA field lock (dihapus di V2);
      // sender/receiver berubah Party → Account.
      const feeTransfer = {
        sender: account(params.userPartyId),
        receiver: account(params.feeReceiverPartyId),
        amount: params.feeAmount.toFixed(10),
        instrumentId: { admin: feeInstrumentAdmin, id: 'Amulet' },
        requestedAt: nowIso,
        executeBefore,
        inputHoldingCids: feeInputCids,
        meta: { values: {} },
      };
      const feeRegistry = await this.ledger.callTransferFactoryRegistry(
        {
          expectedAdmin: feeInstrumentAdmin,
          // v31: TransferFactory_Transfer V2 — actors eksplisit (sender party;
          // diekstrak dari Account.owner oleh scan registry).
          actors: [params.userPartyId],
          transfer: feeTransfer,
          extraArgs: { context: { values: {} }, meta: { values: {} } },
        },
        feeInstrumentAdmin,
        'v2',
      );
      if (!feeRegistry) {
        return fail(['Fee leg: callTransferFactoryRegistry returned null']);
      }

      // ── REWARD leg (optional, hanya bila hasReward) ────────────────────────
      let rewardRegistry: {
        factoryId: string;
        choiceContextData: Record<string, unknown>;
        disclosedContracts: unknown[];
      } | null = null;
      let rewardTransfer: Record<string, unknown> | null = null;
      if (hasReward) {
        const rewardInstrumentId = params.rewardInstrumentId ?? 'Amulet';
        const rewardInstrumentAdmin = params.rewardInstrumentAdmin ?? dso;
        // Reward sender holdings (reward wallet)
        const rewardHoldings =
          rewardInstrumentId.toLowerCase() === 'amulet'
            ? await this.ledger.queryAmuletHoldings(params.rewardSenderPartyId)
            : await this.ledger.getTokenHoldingCids(
                params.rewardSenderPartyId,
                rewardInstrumentId,
              );
        const rewardInputCids = this.greedyFillHoldings(
          rewardHoldings,
          params.rewardAmount,
        );
        if (rewardInputCids.length === 0) {
          return fail([
            `Insufficient ${rewardInstrumentId} holdings for reward ${params.rewardAmount} (sender=${params.rewardSenderPartyId.split('::')[0]})`,
          ]);
        }
        rewardTransfer = {
          sender: account(params.rewardSenderPartyId),
          receiver: account(params.userPartyId),
          amount: params.rewardAmount.toFixed(10),
          instrumentId: {
            admin: rewardInstrumentAdmin,
            id: rewardInstrumentId,
          },
          requestedAt: nowIso,
          executeBefore,
          inputHoldingCids: rewardInputCids,
          meta: { values: {} },
        };
        rewardRegistry = await this.ledger.callTransferFactoryRegistry(
          {
            expectedAdmin: rewardInstrumentAdmin,
            actors: [params.rewardSenderPartyId],
            transfer: rewardTransfer,
            extraArgs: { context: { values: {} }, meta: { values: {} } },
          },
          rewardInstrumentAdmin,
          'v2',
        );
        if (!rewardRegistry) {
          return fail([
            'Reward leg: callTransferFactoryRegistry returned null',
          ]);
        }
      }

      // ── Construct Settle choiceArgument (DAML v23 Optional encoding) ───────
      // DAML-LF JSON: Optional = NULLABLE special case (BUKAN variant).
      //   Some x → langsung x (raw value, TANPA wrapper tag/value)
      //   None   → null
      // Bukti: field Transfer.lock (Optional Lock) pakai null & ledger ACCEPT.
      // Ref: docs DAML-LF JSON Encoding — "Optional: JSON value when defined,
      //      or null when empty."
      //
      // BUG HISTORY (jangan ulangi):
      //   {tags:'Some',value:x}   → "Missing context, meta" (tags jamak, salah)
      //   {tag:'Some',value:x}    → sama error (wrapper tetap salah utk Optional)
      //   {tag:'None',value:{}}   → "Expected ujson.Str" (None harus null)
      //
      // ExtraArgs record butuh context + meta eksplisit (non-optional).
      // choiceContextData dari registry bisa null utk direct transfer →
      // default ke { values: {} } (pattern sama executeTransferFactoryTransfer line 597).
      const opt = <T>(v: T | null | undefined) => (v == null ? null : v);
      const safeContext = (ctx: Record<string, unknown> | null | undefined) =>
        ctx && typeof ctx === 'object' && Object.keys(ctx).length > 0
          ? ctx
          : { values: {} };
      const feeExtraArgs = {
        context: safeContext(feeRegistry.choiceContextData),
        meta: { values: {} },
      };
      const rewardExtraArgs = opt(
        rewardRegistry
          ? {
              context: safeContext(rewardRegistry.choiceContextData),
              meta: { values: {} },
            }
          : null,
      );
      const choiceArgument: Record<string, unknown> = {
        feeFactoryCid: feeRegistry.factoryId,
        feeTransfer,
        feeExtraArgs,
        rewardFactoryCid: opt(rewardRegistry ? rewardRegistry.factoryId : null),
        rewardTransfer: opt(rewardTransfer),
        rewardExtraArgs,
        featuredAppRightCid: opt(params.featuredAppRightCid ?? null),
        // appProvider: DAML Party TIDAK boleh empty string (error "Daml-LF Party
        // is empty"). Saat FAR off (CANTON_APP_PROVIDER_PARTY_ID not set),
        // default ke operator party (pasti valid — sudah signatory). appProvider
        // cuma benar-benar dipakai saat FAR on (beneficiary marker); saat FAR
        // off nilainya tidak relevan, hanya perlu valid Party utk lolos validasi.
        appProvider: params.appProviderPartyId ?? operator,
        settledAt: nowIso,
      };

      // ── actAs: [operator, user, rewardSender?] (+ appProvider? bila FAR) ────
      const actAs = [operator, params.userPartyId];
      if (hasReward) actAs.push(params.rewardSenderPartyId);
      if (params.featuredAppRightCid && params.appProviderPartyId) {
        actAs.push(params.appProviderPartyId);
      }

      // ── disclosedContracts: concat fee + reward registry ───────────────────
      const disclosedContracts: unknown[] = [...feeRegistry.disclosedContracts];
      if (rewardRegistry)
        disclosedContracts.push(...rewardRegistry.disclosedContracts);

      // ── Submit Settle choice ────────────────────────────────────────────────
      const commandId = `settle-${params.claimContractId.slice(0, 16)}-${randomUUID()}`;
      // DIAGNOSTIC: full choiceArgument payload untuk debug COMMAND_PREPROCESSING_FAILED.
      // Gate dengan DEBUG_LEDGER agar JSON.stringify tidak jalan di production.
      if (DEBUG_LEDGER) {
        this.logger.debug(
          `SETTLE_DEBUG payload: ${JSON.stringify({
            feeFactoryCid: feeRegistry.factoryId.slice(0, 16),
            feeTransfer: {
              sender: String(feeTransfer.sender).split('::')[0],
              receiver: String(feeTransfer.receiver).split('::')[0],
              meta_keys: Object.keys(feeTransfer.meta ?? {}),
            },
            feeExtraArgs: feeExtraArgs,
            rewardFactoryCid: rewardRegistry?.factoryId?.slice(0, 16) ?? null,
            rewardTransfer: rewardTransfer
              ? {
                  sender: String(rewardTransfer.sender).split('::')[0],
                  meta_keys: Object.keys(rewardTransfer.meta ?? {}),
                }
              : null,
            rewardExtraArgs: rewardExtraArgs,
            feeCtxRaw: feeRegistry.choiceContextData,
            rewardCtxRaw: rewardRegistry?.choiceContextData ?? null,
          })}`,
        );
      }
      const { ok, text } = await this.ledger.exerciseChoice(
        params.claimContractId,
        tpl,
        'Settle',
        choiceArgument,
        actAs,
        commandId,
        'submit-and-wait-for-transaction-tree',
        disclosedContracts,
      );

      if (ok) {
        const cids = this.extractContractIds(text);
        const settledCid = cids[0] ?? null;
        const updateId = this.extractUpdateId(text);
        this.logger.log(
          `Settle OK: settled=${settledCid?.slice(0, 12)} updateId=${updateId?.slice(0, 12) ?? 'none'} reward=${hasReward}`,
        );
        return { ok: true, settledCid, updateId, errors: [] };
      }

      this.logger.warn(
        `DAML_SETTLE_FAIL claimContractId=${params.claimContractId.slice(0, 16)}: ${text.slice(0, 300)}`,
      );
      return fail([this.formatLedgerError(text, 'Settle failed')]);
    } catch (err) {
      const msg = `settleAtomic exception: ${String(err)}`;
      this.logger.warn(msg);
      return fail([msg]);
    }
  }

  /**
   * recordTxId — post-settle, isi feeTxId + rewardTxId di QuestClaimReceipt SETTLED.
   *
   * Tx ID tidak bisa didapat dari dalam Settle (TransferFactory_Transfer return
   * record, bukan tx id). Backend baca tx id dari Settle response (updateId),
   * lalu exercise RecordTxId utk persist ke contract.
   *
   * v25: rewardTxId jadi Optional Text di DAML (kode claim reward=0 → null).
   *      Backend kirim null bila kode claim (rewardAmount=0), string bila ada reward.
   */
  async recordTxId(params: {
    settledContractId: string;
    feeTxId: string;
    rewardTxId: string | null; // v25: null bila kode claim (reward=0), DAML Optional Text
  }): Promise<{ ok: boolean; errors: string[] }> {
    if (!this.isClaimSessionConfigured())
      return { ok: false, errors: ['Claim session ledger disabled'] };
    const tpl = this.templateId(TPL.QuestClaimReceipt);
    const operator = this.operatorPartyId;
    if (!operator)
      return { ok: false, errors: ['Canton operator party not configured'] };
    try {
      const { ok, text } = await this.ledger.exerciseChoice(
        params.settledContractId,
        tpl,
        'RecordTxId',
        { feeTxId: params.feeTxId, rewardTxId: params.rewardTxId },
        [operator],
        `record-tx-${params.settledContractId.slice(0, 16)}-${randomUUID()}`,
        'submit-and-wait-for-transaction-tree',
      );
      if (ok) {
        this.logger.log(
          `RecordTxId OK: settled=${params.settledContractId.slice(0, 12)}`,
        );
        return { ok: true, errors: [] };
      }
      const err = this.formatLedgerError(text, 'RecordTxId failed');
      this.logger.warn(`RecordTxId fail: ${text.slice(0, 200)}`);
      return { ok: false, errors: [err] };
    } catch (err) {
      return { ok: false, errors: [`recordTxId exception: ${String(err)}`] };
    }
  }

  /**
   * greedyFillHoldings — pilih holding cids yg total amount ≥ target.
   * Dipakai utk inputHoldingCids di TransferFactory_Transfer.
   */
  private greedyFillHoldings(
    holdings: Array<{ contractId: string; amount: string }>,
    target: number,
  ): string[] {
    const sorted = [...holdings].sort(
      (a, b) => parseFloat(b.amount) - parseFloat(a.amount),
    );
    const cids: string[] = [];
    let acc = 0;
    for (const h of sorted) {
      if (acc >= target) break;
      cids.push(h.contractId);
      acc += parseFloat(h.amount);
    }
    return cids;
  }

  /**
   * extractUpdateId — Canton update id dari transaction-tree response.
   * Wrapper ke cantonLedger helper (jika tersedia) atau parse inline.
   */
  private extractUpdateId(text: string): string | null {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const tree = parsed.transactionTree as
        | Record<string, unknown>
        | undefined;
      if (tree && typeof tree.updateId === 'string') return tree.updateId;
      if (typeof parsed.updateId === 'string') return parsed.updateId;
      // safety net: deep-search string berawalan "1220"
      const stack: unknown[] = [parsed];
      while (stack.length > 0) {
        const cur = stack.pop();
        if (!cur || typeof cur !== 'object') continue;
        if (Array.isArray(cur)) {
          stack.push(...cur);
          continue;
        }
        const rec = cur as Record<string, unknown>;
        for (const [k, v] of Object.entries(rec)) {
          if (k === 'updateId' && typeof v === 'string' && v.startsWith('1220'))
            return v;
          if (v && typeof v === 'object') stack.push(v);
        }
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  // ── Party registration (WalletRegistration on-chain) ────────────────────────

  async recordPartyRegistration(params: {
    userPartyId: string;
    userId?: string; // v28: utk userProfileRef "user:<userId>"
    username?: string;
    partyHint?: string;
    inviteCode?: string;
    [key: string]: unknown;
  }): Promise<{ ok: boolean; contractId: string | null; errors: string[] }> {
    if (!params.userPartyId) return { ok: true, contractId: null, errors: [] };
    const resolvedUsername =
      params.username ?? params.partyHint ?? params.userPartyId.split('::')[0];
    // v28: userId wajib utk userProfileRef. Jika tidak provided (caller lama),
    // fallback ke partyHint (kurang ideal — log warning utk surface bug).
    const userId =
      params.userId ??
      (typeof params.userId === 'string' ? params.userId : resolvedUsername);
    if (!params.userId) {
      this.logger.warn(
        `recordPartyRegistration called tanpa userId — userProfileRef fallback ke username @${resolvedUsername}. ` +
          `Caller harus pass userId (req.user.userId).`,
      );
    }
    // v21: hanya create WalletRegistration. UserAccount dihapus (poin off-chain).
    // v28: 2-step Proposal→Accept, userProfileRef = "user:<userId>".
    const walletResult = await this.registerWallet({
      userPartyId: params.userPartyId,
      userId,
      username: resolvedUsername,
      partyId: params.userPartyId,
      inviteCode: params.inviteCode ?? '',
    });
    return {
      ok: !!walletResult.contractId,
      contractId: walletResult.contractId,
      errors: walletResult.errors,
    };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private formatLedgerError(raw: string | undefined, fallback: string): string {
    if (!raw) return fallback;
    try {
      const j = JSON.parse(raw) as {
        code?: string;
        cause?: string;
        message?: string;
      };
      if (j.cause) return `${fallback}: ${j.cause}`;
      if (j.message) return `${fallback}: ${j.message}`;
      if (j.code) return `${fallback}: ${j.code}`;
    } catch {
      /* use raw slice */
    }
    return `${fallback}: ${raw.slice(0, 120)}`;
  }
}
