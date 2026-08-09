import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { CantonLedgerService } from './canton-ledger.service';

/**
 * DAML template paths — module Main (canquest-v27 DAR, built di VPS).
 *
 * Templates (6 — v25 + v27):
 *   Main:WalletRegistration   — jangkar identitas on-chain (Party ID)
 *   Main:CampaignEligibility  — v25: bukti eligibility (LOCK_CC / POINTS) per campaign
 *   Main:QuestCampaign        — template induk quest (6 questKind) + state machine + eligibility guard
 *   Main:QuestClaimReceipt    — v25: bukti klaim: atomic Settle + RevealCode + RecordTxId (FALLBACK)
 *   Main:PlatformTransfer     — v25: atomic send token + platform fee (dipakai PATH A v27)
 *   Main:QuestPaymentRequest  — v27: wrapper lifecycle AppPaymentRequest (PENDING→ACCEPTED→SETTLED)
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
 *
 * v27 reward flow (2 PATH, di-belakang flag QUEST_V27_FLOW):
 *   PATH A: PlatformTransfer.ExecuteTransfer (CC + preapproval ON) — instan, reward leg
 *           sender = REWARD_SENDER, fee leg sender = user (lihat executePlatformTransferReward).
 *   PATH B: AppPaymentRequest → Accept → Collect (USDCx / CC no preapproval) — Fase 2b.
 *
 * AppPaymentRequest (Splice native, #splice-wallet-payments:...) BUKAN template Main —
 * diakses via Ledger API JSON-RPC langsung ke participant node (lihat Fase 2b).
 *
 * All methods are best-effort: they log errors but never throw,
 * so a Canton outage does not break the main application flow.
 */
const TPL = {
  WalletRegistration: 'Main:WalletRegistration',
  CampaignEligibility: 'Main:CampaignEligibility',   // v25
  QuestCampaign: 'Main:QuestCampaign',
  QuestClaimReceipt: 'Main:QuestClaimReceipt',       // v25 (FALLBACK saat QUEST_V27_FLOW=false)
  PlatformTransfer: 'Main:PlatformTransfer',         // v25 (dipakai PATH A v27)
  QuestPaymentRequest: 'Main:QuestPaymentRequest',   // v27 NEW
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

export interface ClaimSessionLedgerResult {
  ledgerEnabled: boolean;
  sessionContractId: string | null;
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

  // ── Config helpers ──────────────────────────────────────────────────────────

  private get damlPackageRef(): string {
    const name = this.config.get<string>('CANTON_DAML_PACKAGE_NAME')?.trim();
    if (name) return name.startsWith('#') ? name : `#${name}`;
    return '#canquest-v25';
  }

  /**
   * Deteksi apakah package DAR yang ter-deploy adalah v27 (AppPaymentRequest arch).
   *
   * Dipakai utk branching signature ClaimSlot/DrawWinner (v27 hapus field
   * rewardSender + return hanya ContractId QuestCampaign, bukan tuple).
   *
   * v27 detection:
   *   - CANTON_DAML_PACKAGE_NAME mengandung "v27" (string) → true
   *   - CANTON_DAML_PACKAGE_NAME = hash hex (post-upload) → tidak bisa detect
   *     dari hash saja. Fallback ke QUEST_V27_FLOW flag (caller sudah set true
   *     saat deploy v27).
   *
   * Saat v27 fully verified + v25 dihapus (Step 7), method ini jadi always-true
   * dan bisa di-delete.
   */
  private get isV27Package(): boolean {
    const name = this.config.get<string>('CANTON_DAML_PACKAGE_NAME')?.trim() ?? '';
    if (name.includes('v27')) return true;
    // Hash hex (post-upload) → rely on flag (caller wajib set QUEST_V27_FLOW=true).
    const flag = this.config.get<string>('QUEST_V27_FLOW')?.trim().toLowerCase();
    return flag === 'true' || flag === '1';
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
        const tplId = typeof obj.templateId === 'string' ? obj.templateId : null;
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

  // ── 1. WalletRegistration ───────────────────────────────────────────────────

  async registerWallet(params: {
    userPartyId: string;
    username: string;
    partyId: string;
    inviteCode: string;
  }): Promise<WalletRegistrationLedgerResult> {
    const result: WalletRegistrationLedgerResult = {
      ledgerEnabled: false,
      contractId: null,
      errors: [],
    };
    if (!this.isConfigured()) return result;
    const tpl = this.templateId(TPL.WalletRegistration);
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
    const existing = this.findContractId(
      await this.ledger.queryActiveContracts(tpl, [operator]),
      (args) => args.userAddress === params.userPartyId,
    );
    if (existing) {
      result.contractId = existing;
      return result;
    }
    const res = await this.ledger.createContract(
      tpl,
      {
        admin: operator,
        userAddress: params.userPartyId,
        username: params.username,
        partyId: params.partyId,
        inviteCode: params.inviteCode,
        registeredAt: new Date().toISOString(),
      },
      [operator],
      `wallet-reg-${params.username}-${randomUUID()}`,
    );
    if (res.ok && res.contractId) {
      this.logger.log(
        `WalletRegistration created: @${params.username} partyId=${params.partyId.split('::')[0]}`,
      );
      result.contractId = res.contractId;
    } else {
      result.errors.push(
        this.formatLedgerError(
          res.error,
          'Failed to create WalletRegistration',
        ),
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
     *  CC_OR_POINTS/NONE→NONE). */
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
    const reachErr = await this.ensureReachable();
    if (reachErr) {
      result.errors.push(reachErr);
      return result;
    }
    result.ledgerEnabled = true;
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
        eligibilityType: params.eligibilityType ?? 'NONE',         // v25
        eligibilityAmount: this.dec(params.eligibilityAmount ?? 0), // v25
        createdAt: new Date().toISOString(),
      },
      [operator],
      `quest-campaign-${params.campaignId}`,
    );
    if (res.ok && res.contractId) {
      this.logger.log(
        `QuestCampaign created: ${params.campaignId} kind=${params.questKind} quota=${params.maxWinners} eligibility=${params.eligibilityType ?? 'NONE'}`,
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
    campaignCreatedAt: string;       // ISO timestamp campaign dibuat (utk lock-after guard)
    eligibilityType: 'LOCK_CC' | 'POINTS';
    amount: number;                  // CC locked (LOCK_CC) atau points (POINTS)
    lockedAt: string | null;         // ISO kapan user lock CC (LOCK_CC); null bila POINTS
    expiresAt: string;               // ISO eligibility berlaku sampai kapan
  }): Promise<{ ok: boolean; contractId: string | null; errors: string[] }> {
    if (!this.isClaimSessionConfigured())
      return { ok: false, contractId: null, errors: ['Claim session ledger disabled'] };
    const tpl = this.templateId(TPL.CampaignEligibility);
    const operator = this.operatorPartyId;
    if (!operator)
      return { ok: false, contractId: null, errors: ['Canton operator party not configured'] };
    const reachErr = await this.ensureReachable();
    if (reachErr)
      return { ok: false, contractId: null, errors: [reachErr] };
    try {
      const res = await this.ledger.createContract(
        tpl,
        {
          admin: operator,
          userAddress: params.userPartyId,
          campaignId: params.campaignId,
          campaignCreatedAt: params.campaignCreatedAt,
          eligibilityType: params.eligibilityType,
          amount: this.dec(params.amount),
          lockedAt: params.lockedAt ?? '',
          expiresAt: params.expiresAt,
          status: 'ELIGIBLE',
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
      const err = this.formatLedgerError(res.error, 'Failed to create CampaignEligibility');
      this.logger.warn(`CampaignEligibility fail: ${err}`);
      return { ok: false, contractId: null, errors: [err] };
    } catch (err) {
      const msg = `createCampaignEligibility exception: ${String(err)}`;
      this.logger.warn(msg);
      return { ok: false, contractId: null, errors: [msg] };
    }
  }

  async claimFcfsSlot(params: {
    campaignContractId: string;
    userPartyId: string;
    claimId: string;
    rewardSenderPartyId: string;   // v24: party reward wallet (CANTON_REWARD_PARTY_ID)
                                    // dikirim ke ClaimSlot choice → set field rewardSender
                                    // di QuestClaimReceipt → jadi co-controller Settle.
    /** v25: DAML CampaignEligibility contract id (utk fetch guard on-chain).
     *  Null bila quest eligibilityType=NONE (tidak perlu eligibility check). */
    eligibilityCid?: string | null;
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
    // v27 signature: TIDAK ada field rewardSender (dihapus), return hanya
    // ContractId QuestCampaign (bukan tuple QuestClaimReceipt).
    // v25 signature: ada rewardSender (co-controller Settle), return tuple.
    const isV27 = this.isV27Package;
    const choiceArgs = isV27
      ? {
          user: params.userPartyId,
          claimId: params.claimId,
          claimedAt: new Date().toISOString(),
          eligibilityCid: params.eligibilityCid ?? null,
        }
      : {
          user: params.userPartyId,
          claimId: params.claimId,
          claimedAt: new Date().toISOString(),
          rewardSender: params.rewardSenderPartyId,   // v24: co-controller Settle
          eligibilityCid: params.eligibilityCid ?? null, // v25: Optional (nullable)
        };
    const { ok, text } = await this.ledger.exerciseChoice(
      params.campaignContractId,
      tpl,
      'ClaimSlot',
      choiceArgs,
      [operator],
      `claim-fcfs-${params.claimId}-${randomUUID()}`,
      'submit-and-wait-for-transaction-tree',
    );
    if (ok) {
      const campaignCids = this.extractContractIdsByTemplate(text, TPL.QuestCampaign);
      result.campaignContractId = campaignCids[0] ?? null;
      if (isV27) {
        // v27: ClaimSlot return hanya ContractId QuestCampaign (QuestClaimReceipt
        // dihapus). claimContractId set ke campaignContractId sbg pengganti
        // (caller path v27 pakai sbg claimContractId → settleAndRecordV27).
        result.claimContractId = result.campaignContractId;
      } else {
        // v25: ClaimSlot return tuple (QuestCampaign, QuestClaimReceipt).
        // Extract by templateId (bukan urutan) — urutan tx tree tidak dijamin.
        const claimCids = this.extractContractIdsByTemplate(text, TPL.QuestClaimReceipt);
        result.claimContractId = claimCids[0] ?? null;
      }
      this.logger.log(
        `ClaimSlot${isV27 ? ' [v27]' : ''}: user=${params.userPartyId.split('::')[0]} campaign=${result.campaignContractId?.slice(0, 12) ?? 'none'}... claim=${result.claimContractId?.slice(0, 12) ?? 'none'}`,
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
    rewardSenderPartyId: string;   // v24: party reward wallet (CANTON_REWARD_PARTY_ID)
    /** v25: DAML CampaignEligibility contract id. Null bila NONE. */
    eligibilityCid?: string | null;
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
    // v27 signature: TIDAK ada field rewardSender + rewardCode (dihapus),
    // return hanya ContractId QuestCampaign (bukan tuple QuestClaimReceipt).
    // v25 signature: ada rewardSender + rewardCode, return tuple.
    const isV27 = this.isV27Package;
    const choiceArgs = isV27
      ? {
          user: params.userPartyId,
          claimId: params.claimId,
          drawnAt: new Date().toISOString(),
          eligibilityCid: params.eligibilityCid ?? null,
        }
      : {
          user: params.userPartyId,
          claimId: params.claimId,
          rewardCode: params.rewardCode ?? '',
          drawnAt: new Date().toISOString(),
          rewardSender: params.rewardSenderPartyId,   // v24: co-controller Settle
          eligibilityCid: params.eligibilityCid ?? null, // v25: Optional (nullable)
        };
    const { ok, text } = await this.ledger.exerciseChoice(
      params.campaignContractId,
      tpl,
      'DrawWinner',
      choiceArgs,
      [operator],
      `draw-raffle-${params.claimId}-${randomUUID()}`,
    );
    if (ok) {
      const campaignCids = this.extractContractIdsByTemplate(text, TPL.QuestCampaign);
      result.campaignContractId = campaignCids[0] ?? null;
      if (isV27) {
        // v27: return hanya ContractId QuestCampaign (QuestClaimReceipt dihapus).
        result.claimContractId = result.campaignContractId;
      } else {
        // v25: return tuple (QuestCampaign, QuestClaimReceipt).
        const claimCids = this.extractContractIdsByTemplate(text, TPL.QuestClaimReceipt);
        result.claimContractId = claimCids[0] ?? null;
      }
    } else {
      result.errors.push(
        this.formatLedgerError(text, 'DrawWinner failed'),
      );
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
      { code: params.code, revealedAt: new Date().toISOString() },
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
    claimContractId: string;          // QuestClaimReceipt PRE_SETTLE
    userPartyId: string;              // sender fee leg, receiver reward leg
    feeReceiverPartyId: string;       // CANTON_FEE_RECIPIENT_PARTY_ID
    feeAmount: number;                // CC amount (claimFeeCc)
    rewardSenderPartyId: string;      // CANTON_REWARD_PARTY_ID (skip bila rewardAmount=0)
    rewardAmount: number;             // 0 untuk kode claim → reward=None
    rewardToken: 'CC' | 'USDCx';
    rewardInstrumentId?: string;      // resolve caller utk USDCx (CC default Amulet)
    rewardInstrumentAdmin?: string;   // resolve caller utk USDCx (CC default DSO)
    featuredAppRightCid?: string | null;
    appProviderPartyId?: string;
  }): Promise<{
    ok: boolean;
    settledCid: string | null;        // QuestClaimReceipt SETTLED baru
    updateId: string | null;          // Canton tx id (utk recordTxId)
    errors: string[];
  }> {
    const fail = (errors: string[]) => ({ ok: false, settledCid: null, updateId: null, errors });
    if (!this.isClaimSessionConfigured()) return fail(['Claim session ledger disabled']);
    const tpl = this.templateId(TPL.QuestClaimReceipt);
    const operator = this.operatorPartyId;
    if (!operator) return fail(['Canton operator party not configured']);
    const dso = this.config.get<string>('CANTON_DSO_PARTY_ID')?.trim();
    if (!dso) return fail(['CANTON_DSO_PARTY_ID not configured']);

    try {
      const now = new Date();
      const nowIso = now.toISOString();
      const executeBefore = new Date(now.getTime() + 24 * 3600 * 1000).toISOString();
      const hasReward = params.rewardAmount > 0;

      // ── FEE leg: user → feeReceiver (CC Amulet, selalu jalan) ──────────────
      const feeInstrumentAdmin = dso;
      const feeHoldings = await this.ledger.queryAmuletHoldings(params.userPartyId);
      const feeInputCids = this.greedyFillHoldings(feeHoldings, params.feeAmount);
      if (feeInputCids.length === 0) {
        return fail([`Insufficient Amulet holdings for fee ${params.feeAmount} CC (user=${params.userPartyId.split('::')[0]})`]);
      }
      const feeTransfer = {
        sender: params.userPartyId,
        receiver: params.feeReceiverPartyId,
        amount: params.feeAmount.toFixed(10),
        instrumentId: { admin: feeInstrumentAdmin, id: 'Amulet' },
        lock: null,
        requestedAt: nowIso,
        executeBefore,
        inputHoldingCids: feeInputCids,
        meta: { values: {} },
      };
      const feeRegistry = await this.ledger.callTransferFactoryRegistry(
        { expectedAdmin: feeInstrumentAdmin, transfer: feeTransfer, extraArgs: { context: { values: {} }, meta: { values: {} } } },
        feeInstrumentAdmin,
      );
      if (!feeRegistry) {
        return fail(['Fee leg: callTransferFactoryRegistry returned null']);
      }

      // ── REWARD leg (optional, hanya bila hasReward) ────────────────────────
      let rewardRegistry: { factoryId: string; choiceContextData: Record<string, unknown>; disclosedContracts: unknown[] } | null = null;
      let rewardTransfer: Record<string, unknown> | null = null;
      if (hasReward) {
        const rewardInstrumentId = params.rewardInstrumentId ?? 'Amulet';
        const rewardInstrumentAdmin = params.rewardInstrumentAdmin ?? dso;
        // Reward sender holdings (reward wallet)
        const rewardHoldings = rewardInstrumentId.toLowerCase() === 'amulet'
          ? await this.ledger.queryAmuletHoldings(params.rewardSenderPartyId)
          : await this.ledger.getTokenHoldingCids(params.rewardSenderPartyId, rewardInstrumentId);
        const rewardInputCids = this.greedyFillHoldings(rewardHoldings, params.rewardAmount);
        if (rewardInputCids.length === 0) {
          return fail([`Insufficient ${rewardInstrumentId} holdings for reward ${params.rewardAmount} (sender=${params.rewardSenderPartyId.split('::')[0]})`]);
        }
        rewardTransfer = {
          sender: params.rewardSenderPartyId,
          receiver: params.userPartyId,
          amount: params.rewardAmount.toFixed(10),
          instrumentId: { admin: rewardInstrumentAdmin, id: rewardInstrumentId },
          lock: null,
          requestedAt: nowIso,
          executeBefore,
          inputHoldingCids: rewardInputCids,
          meta: { values: {} },
        };
        rewardRegistry = await this.ledger.callTransferFactoryRegistry(
          { expectedAdmin: rewardInstrumentAdmin, transfer: rewardTransfer, extraArgs: { context: { values: {} }, meta: { values: {} } } },
          rewardInstrumentAdmin,
        );
        if (!rewardRegistry) {
          return fail(['Reward leg: callTransferFactoryRegistry returned null']);
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
      const opt = <T,>(v: T | null | undefined) => (v == null ? null : v);
      const safeContext = (ctx: Record<string, unknown> | null | undefined) =>
        ctx && typeof ctx === 'object' && Object.keys(ctx).length > 0 ? ctx : { values: {} };
      const feeExtraArgs = {
        context: safeContext(feeRegistry.choiceContextData),
        meta: { values: {} },
      };
      const rewardExtraArgs = opt(
        rewardRegistry
          ? { context: safeContext(rewardRegistry.choiceContextData), meta: { values: {} } }
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
      if (rewardRegistry) disclosedContracts.push(...rewardRegistry.disclosedContracts);

      // ── Submit Settle choice ────────────────────────────────────────────────
      const commandId = `settle-${params.claimContractId.slice(0, 16)}-${randomUUID()}`;
      // DIAGNOSTIC: log full choiceArgument payload untuk debug COMMAND_PREPROCESSING_FAILED.
      this.logger.debug(
        `SETTLE_DEBUG payload: ${JSON.stringify({
          feeFactoryCid: feeRegistry.factoryId.slice(0, 16),
          feeTransfer: { sender: String(feeTransfer.sender).split('::')[0], receiver: String(feeTransfer.receiver).split('::')[0], meta_keys: Object.keys(feeTransfer.meta ?? {}) },
          feeExtraArgs: feeExtraArgs,
          rewardFactoryCid: rewardRegistry?.factoryId?.slice(0, 16) ?? null,
          rewardTransfer: rewardTransfer ? { sender: String(rewardTransfer.sender).split('::')[0], meta_keys: Object.keys(rewardTransfer.meta ?? {}) } : null,
          rewardExtraArgs: rewardExtraArgs,
          feeCtxRaw: feeRegistry.choiceContextData,
          rewardCtxRaw: rewardRegistry?.choiceContextData ?? null,
        })}`,
      );
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
    rewardTxId: string | null;   // v25: null bila kode claim (reward=0), DAML Optional Text
  }): Promise<{ ok: boolean; errors: string[] }> {
    if (!this.isClaimSessionConfigured()) return { ok: false, errors: ['Claim session ledger disabled'] };
    const tpl = this.templateId(TPL.QuestClaimReceipt);
    const operator = this.operatorPartyId;
    if (!operator) return { ok: false, errors: ['Canton operator party not configured'] };
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
        this.logger.log(`RecordTxId OK: settled=${params.settledContractId.slice(0, 12)}`);
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
    const sorted = [...holdings].sort((a, b) => parseFloat(b.amount) - parseFloat(a.amount));
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
      const tree = parsed.transactionTree as Record<string, unknown> | undefined;
      if (tree && typeof tree.updateId === 'string') return tree.updateId;
      if (typeof parsed.updateId === 'string') return parsed.updateId;
      // safety net: deep-search string berawalan "1220"
      const stack: unknown[] = [parsed];
      while (stack.length > 0) {
        const cur = stack.pop();
        if (!cur || typeof cur !== 'object') continue;
        if (Array.isArray(cur)) { stack.push(...cur); continue; }
        const rec = cur as Record<string, unknown>;
        for (const [k, v] of Object.entries(rec)) {
          if (k === 'updateId' && typeof v === 'string' && v.startsWith('1220')) return v;
          if (v && typeof v === 'object') stack.push(v);
        }
      }
    } catch { /* ignore */ }
    return null;
  }

  // ── 4. PlatformTransfer (v25) — atomic send token + platform fee ─────────
  // 2-step: create PENDING contract lalu execute (atomic transfer + fee + FAR).
  // Backend feature flag QUEST_ATOMIC_PLATFORM_TRANSFER utk gradual rollout.
  // Fallback: sendCc/sendToken existing (2 transfer terpisah, non-atomic).

  async createPlatformTransfer(params: {
    userPartyId: string;
    transferId: string;       // client idempotency id
    amount: number;
    feeAmount: number;
    receiverPartyId: string;  // receiver (full party id dgn ::suffix)
    treasuryPartyId: string;  // CANTON_FEE_RECIPIENT_PARTY_ID
    token: string;            // "CC" | "USDCx" | instrument id lain
  }): Promise<{ ok: boolean; contractId: string | null; errors: string[] }> {
    if (!this.isClaimSessionConfigured())
      return { ok: false, contractId: null, errors: ['Claim session ledger disabled'] };
    const tpl = this.templateId(TPL.PlatformTransfer);
    const operator = this.operatorPartyId;
    if (!operator)
      return { ok: false, contractId: null, errors: ['Canton operator party not configured'] };
    const reachErr = await this.ensureReachable();
    if (reachErr)
      return { ok: false, contractId: null, errors: [reachErr] };
    try {
      const res = await this.ledger.createContract(
        tpl,
        {
          admin: operator,
          userAddress: params.userPartyId,
          transferId: params.transferId,
          amount: this.dec(params.amount),
          feeAmount: this.dec(params.feeAmount),
          receiver: params.receiverPartyId,
          treasury: params.treasuryPartyId,
          token: params.token,
          status: 'PENDING',
          createdAt: new Date().toISOString(),
        },
        [operator],
        `platform-transfer-${params.transferId}`,
      );
      if (res.ok && res.contractId) {
        this.logger.log(
          `PlatformTransfer created: transferId=${params.transferId.slice(0, 16)} amount=${params.amount} ${params.token} fee=${params.feeAmount}`,
        );
        return { ok: true, contractId: res.contractId, errors: [] };
      }
      const err = this.formatLedgerError(res.error, 'Failed to create PlatformTransfer');
      this.logger.warn(`PlatformTransfer create fail: ${err}`);
      return { ok: false, contractId: null, errors: [err] };
    } catch (err) {
      const msg = `createPlatformTransfer exception: ${String(err)}`;
      this.logger.warn(msg);
      return { ok: false, contractId: null, errors: [msg] };
    }
  }

  /**
   * Execute PlatformTransfer atomically: transfer utama + platform fee + FAR marker.
   * Mirrors settleAtomic pattern (multi-controller, registry pre-step, FAR optional).
   *
   * Pre-step backend (sebelum submit):
   *   1. callTransferFactoryRegistry × 2 (transfer utama + fee)
   *   2. queryAmuletHoldings × 2 utk inputHoldingCids (transfer + fee)
   *   3. (optional) featuredAppRightCid → farCid
   *   Lalu konstruksi ExecuteTransfer args dgn data di atas.
   *
   * Self-contained: caller cukup pass platformTransferCid + userPartyId + amounts +
   * receiver/treasury party ids. Method handle registry/holdings sendiri
   * (pattern sama settleAtomic). CC (Amulet) only — utk USDCx, extend caller resolve.
   *
   * actAs: [operator, userPartyId] (+ appProvider bila FAR on)
   * Multi-controller: admin + userAddress (kedua leg controller = user, sender).
   */
  async executePlatformTransfer(params: {
    platformTransferCid: string;       // PlatformTransfer PENDING contract
    userPartyId: string;               // sender kedua leg (transfer + fee)
    receiverPartyId: string;           // receiver transfer utama
    feeReceiverPartyId: string;        // treasury (CANTON_FEE_RECIPIENT_PARTY_ID)
    amount: number;                    // transfer utama (CC)
    feeAmount: number;                 // platform fee (CC); 0 → fee leg skip via guard
    featuredAppRightCid?: string | null;
    appProviderPartyId?: string | null;
    /** Instrument transfer leg. Default 'Amulet' (CC). Utk non-CC (USDCx dll),
     *  set transferInstrumentId + transferInstrumentAdmin (resolve dari OneSwap). */
    transferInstrumentId?: string;       // default 'Amulet'
    transferInstrumentAdmin?: string;    // default CANTON_DSO_PARTY_ID
  }): Promise<{ ok: boolean; settledCid: string | null; updateId: string | null; errors: string[] }> {
    const fail = (errors: string[]) => ({ ok: false, settledCid: null, updateId: null, errors });
    if (!this.isClaimSessionConfigured())
      return fail(['Claim session ledger disabled']);
    const tpl = this.templateId(TPL.PlatformTransfer);
    const operator = this.operatorPartyId;
    if (!operator)
      return fail(['Canton operator party not configured']);
    const dso = this.config.get<string>('CANTON_DSO_PARTY_ID')?.trim();
    if (!dso) return fail(['CANTON_DSO_PARTY_ID not configured']);

    try {
      const now = new Date();
      const nowIso = now.toISOString();
      const executeBefore = new Date(now.getTime() + 24 * 3600 * 1000).toISOString();

      // Transfer leg instrument: default Amulet (CC), support non-CC (USDCx dll).
      // Fee leg SELALU Amulet/CC (fee platform dibayar dalam CC).
      const tInstrumentId = params.transferInstrumentId ?? 'Amulet';
      const isAmuletTransfer = tInstrumentId.toLowerCase() === 'amulet';
      const tInstrumentAdmin = params.transferInstrumentAdmin ?? dso;

      // ── RESOLVE INPUT HOLDINGS (partition utk CC, terpisah utk non-CC) ────────
      // ⚠️ CRITICAL: PlatformTransfer punya 2 leg, keduanya sender = user yang sama.
      // Untuk CC (Amulet), kedua leg minum dari POOL holdings Amulet yang sama.
      // Kalau greedyFillHoldings di-query 2x terpisah, kedua leg bisa pilih CID yang
      // SAMA → leg 1 archive CID → leg 2 CONTRACT_NOT_ACTIVE (bug fix: ini root cause
      // CONTRACT_NOT_ACTIVE di log deploy pertama).
      //
      // Fix: utk CC, query 1x lalu PARTISI — transferInputCids ambil sebagian, fee
      // ambil dari SISA (tidak overlap). Utk non-CC, pool transfer (USDCx) beda dari
      // pool fee (Amulet/CC) → query terpisah aman (tidak overlap by definition).
      let transferInputCids: string[];
      let feeInputCids: string[];
      if (isAmuletTransfer) {
        // CC: pool sama → partisi. Query sekali, alokasi transfer dulu, fee dari sisa.
        const ccHoldings = await this.ledger.queryAmuletHoldings(params.userPartyId);
        const sorted = [...ccHoldings].sort(
          (a, b) => parseFloat(b.amount) - parseFloat(a.amount),
        );
        // Alokasi transfer leg (amount) — ambil holdings desc sampai cukup.
        let acc = 0;
        const transferCids: string[] = [];
        for (const h of sorted) {
          if (acc >= params.amount) break;
          transferCids.push(h.contractId);
          acc += parseFloat(h.amount);
        }
        if (params.amount > 0 && transferCids.length === 0) {
          return fail([`Insufficient CC for transfer ${params.amount} (user=${params.userPartyId.split('::')[0]})`]);
        }
        // Fee leg: ambil dari holdings yang TIDAK dipakai transfer (sisa), lalu
        // kalau sisa kurang, boleh reuse (registry CIP-56 handle via change amulet).
        const transferCidSet = new Set(transferCids);
        const remainder = sorted.filter((h) => !transferCidSet.has(h.contractId));
        let feeAcc = 0;
        const feeCids: string[] = [];
        for (const h of remainder) {
          if (feeAcc >= params.feeAmount) break;
          feeCids.push(h.contractId);
          feeAcc += parseFloat(h.amount);
        }
        // Kalau sisa < fee tapi total pool cukup (transfer leg ada change), izinkan
        // reuse CID transfer — registry akan return change amulet (DAML handle).
        // Ini edge case: user punya 1 holding besar. CIP-56 TransferFactory_Transfer
        // split otomatis (input consumed, change created).
        if (feeCids.length === 0 && params.feeAmount > 0) {
          // fallback: reuse 1 CID terbesar (registry buat change amulet utk sisa).
          if (sorted.length > 0) feeCids.push(sorted[0].contractId);
        }
        transferInputCids = transferCids;
        feeInputCids = feeCids;
      } else {
        // Non-CC: pool transfer (USDCx) ≠ pool fee (Amulet/CC). Query terpisah aman.
        const tokenHoldings = await this.ledger.getTokenHoldingCids(
          params.userPartyId,
          tInstrumentId,
        );
        transferInputCids = this.greedyFillHoldings(tokenHoldings, params.amount);
        if (params.amount > 0 && transferInputCids.length === 0) {
          return fail([`Insufficient ${tInstrumentId} for transfer ${params.amount} (user=${params.userPartyId.split('::')[0]})`]);
        }
        const ccHoldingsForFee = await this.ledger.queryAmuletHoldings(params.userPartyId);
        feeInputCids = this.greedyFillHoldings(ccHoldingsForFee, params.feeAmount);
      }
      if (params.feeAmount > 0 && feeInputCids.length === 0) {
        return fail([`Insufficient CC for fee ${params.feeAmount} (user=${params.userPartyId.split('::')[0]})`]);
      }

      // ── TRANSFER leg: user → receiver ───────────────────────────────────────
      const transferSpec = {
        sender: params.userPartyId,
        receiver: params.receiverPartyId,
        amount: params.amount.toFixed(10),
        instrumentId: { admin: tInstrumentAdmin, id: tInstrumentId },
        lock: null,
        requestedAt: nowIso,
        executeBefore,
        inputHoldingCids: transferInputCids,
        meta: { values: {} },
      };
      const transferRegistry = await this.ledger.callTransferFactoryRegistry(
        { expectedAdmin: tInstrumentAdmin, transfer: transferSpec, extraArgs: { context: { values: {} }, meta: { values: {} } } },
        tInstrumentAdmin,
      );
      if (!transferRegistry) return fail(['Transfer leg: callTransferFactoryRegistry returned null']);

      // ── FEE leg: user → treasury (CC Amulet) ────────────────────────────────
      const feeSpec = {
        sender: params.userPartyId,
        receiver: params.feeReceiverPartyId,
        amount: params.feeAmount.toFixed(10),
        instrumentId: { admin: dso, id: 'Amulet' },
        lock: null,
        requestedAt: nowIso,
        executeBefore,
        inputHoldingCids: feeInputCids,
        meta: { values: {} },
      };
      const feeRegistry = await this.ledger.callTransferFactoryRegistry(
        { expectedAdmin: dso, transfer: feeSpec, extraArgs: { context: { values: {} }, meta: { values: {} } } },
        dso,
      );
      if (!feeRegistry) return fail(['Fee leg: callTransferFactoryRegistry returned null']);

      // ── Construct ExecuteTransfer choiceArgument ────────────────────────────
      const opt = <T,>(v: T | null | undefined) => (v == null ? null : v); // DAML Optional = nullable
      const safeContext = (ctx: Record<string, unknown> | null | undefined) =>
        ctx && typeof ctx === 'object' && Object.keys(ctx).length > 0 ? ctx : { values: {} };
      const transferExtraArgs = {
        context: safeContext(transferRegistry.choiceContextData),
        meta: { values: {} },
      };
      const feeExtraArgs = {
        context: safeContext(feeRegistry.choiceContextData),
        meta: { values: {} },
      };
      const choiceArgument: Record<string, unknown> = {
        transferFactoryCid: transferRegistry.factoryId,
        transferSpec,
        transferExtraArgs,
        feeFactoryCid: feeRegistry.factoryId,
        feeSpec,
        feeExtraArgs,
        featuredAppRightCid: opt(params.featuredAppRightCid),
        appProvider: params.appProviderPartyId ?? operator,
        settledAt: nowIso,
      };

      // actAs: [operator, userPartyId] (+ appProvider bila FAR)
      const actAs = [operator, params.userPartyId];
      if (params.featuredAppRightCid && params.appProviderPartyId) {
        actAs.push(params.appProviderPartyId);
      }

      // disclosedContracts: concat transfer + fee registry
      const disclosedContracts: unknown[] = [...transferRegistry.disclosedContracts, ...feeRegistry.disclosedContracts];

      const commandId = `platform-exec-${params.platformTransferCid.slice(0, 16)}-${randomUUID()}`;
      const { ok, text } = await this.ledger.exerciseChoice(
        params.platformTransferCid,
        tpl,
        'ExecuteTransfer',
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
          `PlatformTransfer ExecuteTransfer OK: settled=${settledCid?.slice(0, 12) ?? 'none'} updateId=${updateId?.slice(0, 12) ?? 'none'}`,
        );
        return { ok: true, settledCid, updateId, errors: [] };
      }
      const err = this.formatLedgerError(text, 'ExecuteTransfer failed');
      this.logger.warn(`PlatformTransfer exec fail: ${text.slice(0, 300)}`);
      return fail([err]);
    } catch (err) {
      const msg = `executePlatformTransfer exception: ${String(err)}`;
      this.logger.warn(msg);
      return fail([msg]);
    }
  }

  // ── 5. v27 reward flow — QuestPaymentRequest wrapper + PATH A / PATH B ──────
  // Routing (di-belakang flag QUEST_V27_FLOW, default off → v25 fallback):
  //   CC + preapproval ON   → PATH A: executePlatformTransferReward (instan)
  //   USDCx / CC no preapp  → PATH B: AppPaymentRequest flow (Fase 2b)
  //   rewardAmount == 0     → v25 fallback (PlatformTransfer.ExecuteTransfer
  //                            butuh amount > 0 + feeAmount > 0 per DAML assertion)
  //
  // QuestPaymentRequest = DAML wrapper (Main template, milik kita) utk track
  // lifecycle reward on-chain. Status: PENDING → ACCEPTED → SETTLED / EXPIRED.
  // Field appPaymentRequestCid mulai kosong, di-update via MarkAccepted (PATH B).

  /**
   * createQuestPaymentRequest — create DAML wrapper (PENDING).
   *
   * Dipakai PATH A & B sebagai audit trail on-chain pertama, SEBELUM eksekusi
   * transfer. Field appPaymentRequestCid="" saat create; di-update via
   * MarkAccepted setelah AppPaymentRequest di-accept (PATH B). Utk PATH A,
   * field ini tetap kosong (AppPaymentRequest tidak dipakai).
   *
   * actAs: [operator] (signatory admin only).
   */
  async createQuestPaymentRequest(params: {
    userPartyId: string;
    campaignId: string;          // QuestCampaign campaignId (korelasi ke claim slot)
    claimId: string;             // korelasi ke WinnerDraw id / draw id
    feeAmount: number;
    token: 'CC' | 'USDCx';
    expiresAt: string;           // ISO — sama dgn AppPaymentRequest.expiresAt (PATH B)
  }): Promise<{ ok: boolean; contractId: string | null; errors: string[] }> {
    if (!this.isClaimSessionConfigured())
      return { ok: false, contractId: null, errors: ['Claim session ledger disabled'] };
    const tpl = this.templateId(TPL.QuestPaymentRequest);
    const operator = this.operatorPartyId;
    if (!operator)
      return { ok: false, contractId: null, errors: ['Canton operator party not configured'] };
    const reachErr = await this.ensureReachable();
    if (reachErr)
      return { ok: false, contractId: null, errors: [reachErr] };
    try {
      const nowIso = new Date().toISOString();
      const requestId = randomUUID();
      const res = await this.ledger.createContract(
        tpl,
        {
          admin: operator,
          userAddress: params.userPartyId,
          campaignId: params.campaignId,
          claimId: params.claimId,
          requestId,
          appPaymentRequestCid: '',          // kosong saat create; update via MarkAccepted (PATH B)
          feeAmount: this.dec(params.feeAmount),
          token: params.token,
          status: 'PENDING',
          createdAt: nowIso,
          expiresAt: params.expiresAt,
        },
        [operator],
        `qpr-create-${params.claimId.slice(0, 16)}-${requestId}`,
      );
      if (res.ok && res.contractId) {
        this.logger.log(
          `QuestPaymentRequest created: claimId=${params.claimId.slice(0, 16)} fee=${params.feeAmount} ${params.token} (reward via PlatformTransfer/AppPaymentRequest, bukan di wrapper)`,
        );
        return { ok: true, contractId: res.contractId, errors: [] };
      }
      const err = this.formatLedgerError(res.error, 'Failed to create QuestPaymentRequest');
      this.logger.warn(`QuestPaymentRequest create fail: ${err}`);
      return { ok: false, contractId: null, errors: [err] };
    } catch (err) {
      const msg = `createQuestPaymentRequest exception: ${String(err)}`;
      this.logger.warn(msg);
      return { ok: false, contractId: null, errors: [msg] };
    }
  }

  /**
   * executePlatformTransferReward — PATH A core.
   *
   * Exercise PlatformTransfer.ExecuteTransfer dgn **reward leg sender = REWARD_SENDER**
   * (bukan user). Berbeda dari executePlatformTransfer (P2P) yang hardcode user sbg
   * sender kedua leg. Pattern ini mengikuti settleAtomic (lines 821-961): 2 query
   * holdings terpisah (reward dari REWARD_SENDER wallet, fee dari user wallet), 2
   * registry call, actAs [operator, user, rewardSender] + appProvider bila FAR.
   *
   * PRE-CONDITION (DAML assertion, Main.daml line 442-443):
   *   PlatformTransfer.amount > 0  → rewardAmount > 0 (PATH A tidak utk CODE claim)
   *   PlatformTransfer.feeAmount > 0 → feeAmount > 0
   * Caller wajib filter rewardAmount > 0 sebelum panggil method ini.
   *
   * ⚠️ PENTING: PlatformTransfer contract di-create dgn field amount = rewardAmount
   * dan feeAmount = feeAmount (lihat createPlatformTransfer). Field ini di-assert
   * ExecuteTransfer. Jadi platformTransferCid harus dari createPlatformTransfer dgn
   * params.amount=rewardAmount, params.feeAmount=feeAmount.
   *
   * actAs: [operator, userPartyId, rewardSenderPartyId] (+ appProvider bila FAR on)
   * Return: { ok, settledCid, updateId } — updateId = Canton tx id (utk markSettled).
   */
  async executePlatformTransferReward(params: {
    platformTransferCid: string;       // PlatformTransfer PENDING (amount=reward, feeAmount=fee)
    userPartyId: string;               // receiver reward, sender fee
    rewardSenderPartyId: string;       // CANTON_REWARD_PARTY_ID — sender reward leg
    feeReceiverPartyId: string;        // CANTON_FEE_RECIPIENT_PARTY_ID — receiver fee
    rewardAmount: number;              // > 0 (DAML assertion)
    feeAmount: number;                 // > 0 (DAML assertion)
    rewardToken: 'CC' | 'USDCx';
    rewardInstrumentId?: string;       // default 'Amulet' (CC); USDCx resolve dari caller
    rewardInstrumentAdmin?: string;    // default CANTON_DSO_PARTY_ID
    featuredAppRightCid?: string | null;
    appProviderPartyId?: string | null;
  }): Promise<{ ok: boolean; settledCid: string | null; updateId: string | null; errors: string[] }> {
    const fail = (errors: string[]) => ({ ok: false, settledCid: null, updateId: null, errors });
    if (!this.isClaimSessionConfigured())
      return fail(['Claim session ledger disabled']);
    const tpl = this.templateId(TPL.PlatformTransfer);
    const operator = this.operatorPartyId;
    if (!operator)
      return fail(['Canton operator party not configured']);
    const dso = this.config.get<string>('CANTON_DSO_PARTY_ID')?.trim();
    if (!dso) return fail(['CANTON_DSO_PARTY_ID not configured']);

    // PRE-CONDITION: rewardAmount > 0 dan feeAmount > 0 (DAML ExecuteTransfer assertion).
    if (params.rewardAmount <= 0) return fail(['rewardAmount must be > 0 for PATH A (DAML assertion)']);
    if (params.feeAmount <= 0) return fail(['feeAmount must be > 0 for PATH A (DAML assertion)']);

    try {
      const now = new Date();
      const nowIso = now.toISOString();
      const executeBefore = new Date(now.getTime() + 24 * 3600 * 1000).toISOString();

      const rewardInstrumentId = params.rewardInstrumentId ?? 'Amulet';
      const rewardInstrumentAdmin = params.rewardInstrumentAdmin ?? dso;

      // ── REWARD leg: rewardSender → user (CC Amulet atau USDCx) ──────────────
      // Sender = REWARD_SENDER (bukan user). Query holdings REWARD_SENDER wallet.
      const rewardHoldings = rewardInstrumentId.toLowerCase() === 'amulet'
        ? await this.ledger.queryAmuletHoldings(params.rewardSenderPartyId)
        : await this.ledger.getTokenHoldingCids(params.rewardSenderPartyId, rewardInstrumentId);
      const rewardInputCids = this.greedyFillHoldings(rewardHoldings, params.rewardAmount);
      if (rewardInputCids.length === 0) {
        return fail([`Insufficient ${rewardInstrumentId} holdings for reward ${params.rewardAmount} (sender=${params.rewardSenderPartyId.split('::')[0]})`]);
      }
      const transferSpec = {
        sender: params.rewardSenderPartyId,
        receiver: params.userPartyId,
        amount: params.rewardAmount.toFixed(10),
        instrumentId: { admin: rewardInstrumentAdmin, id: rewardInstrumentId },
        lock: null,
        requestedAt: nowIso,
        executeBefore,
        inputHoldingCids: rewardInputCids,
        meta: { values: {} },
      };
      const transferRegistry = await this.ledger.callTransferFactoryRegistry(
        { expectedAdmin: rewardInstrumentAdmin, transfer: transferSpec, extraArgs: { context: { values: {} }, meta: { values: {} } } },
        rewardInstrumentAdmin,
      );
      if (!transferRegistry) return fail(['Reward leg: callTransferFactoryRegistry returned null']);

      // ── FEE leg: user → feeReceiver (CC Amulet, selalu CC) ──────────────────
      // Sender = user (beda wallet dari reward sender → query terpisah aman, tidak overlap).
      const feeHoldings = await this.ledger.queryAmuletHoldings(params.userPartyId);
      const feeInputCids = this.greedyFillHoldings(feeHoldings, params.feeAmount);
      if (feeInputCids.length === 0) {
        return fail([`Insufficient Amulet holdings for fee ${params.feeAmount} (user=${params.userPartyId.split('::')[0]})`]);
      }
      const feeSpec = {
        sender: params.userPartyId,
        receiver: params.feeReceiverPartyId,
        amount: params.feeAmount.toFixed(10),
        instrumentId: { admin: dso, id: 'Amulet' },
        lock: null,
        requestedAt: nowIso,
        executeBefore,
        inputHoldingCids: feeInputCids,
        meta: { values: {} },
      };
      const feeRegistry = await this.ledger.callTransferFactoryRegistry(
        { expectedAdmin: dso, transfer: feeSpec, extraArgs: { context: { values: {} }, meta: { values: {} } } },
        dso,
      );
      if (!feeRegistry) return fail(['Fee leg: callTransferFactoryRegistry returned null']);

      // ── Construct ExecuteTransfer choiceArgument ────────────────────────────
      const opt = <T,>(v: T | null | undefined) => (v == null ? null : v); // DAML Optional = nullable
      const safeContext = (ctx: Record<string, unknown> | null | undefined) =>
        ctx && typeof ctx === 'object' && Object.keys(ctx).length > 0 ? ctx : { values: {} };
      const transferExtraArgs = {
        context: safeContext(transferRegistry.choiceContextData),
        meta: { values: {} },
      };
      const feeExtraArgs = {
        context: safeContext(feeRegistry.choiceContextData),
        meta: { values: {} },
      };
      const choiceArgument: Record<string, unknown> = {
        transferFactoryCid: transferRegistry.factoryId,
        transferSpec,
        transferExtraArgs,
        feeFactoryCid: feeRegistry.factoryId,
        feeSpec,
        feeExtraArgs,
        featuredAppRightCid: opt(params.featuredAppRightCid),
        appProvider: params.appProviderPartyId ?? operator,
        settledAt: nowIso,
      };

      // actAs: [operator, user, rewardSender] (+ appProvider bila FAR)
      // rewardSender wajib (controller reward leg via nested TransferFactory_Transfer).
      const actAs = [operator, params.userPartyId, params.rewardSenderPartyId];
      if (params.featuredAppRightCid && params.appProviderPartyId) {
        actAs.push(params.appProviderPartyId);
      }

      // disclosedContracts: concat reward + fee registry
      const disclosedContracts: unknown[] = [...transferRegistry.disclosedContracts, ...feeRegistry.disclosedContracts];

      const commandId = `v27-pathA-${params.platformTransferCid.slice(0, 16)}-${randomUUID()}`;
      // DEBUG: log actAs utk diagnose DAML_AUTHORIZATION_ERROR (party drop issue).
      this.logger.debug(
        `v27 PATH A DEBUG actAs=[${actAs.map((p) => p.split('::')[0]).join(',')}] ` +
          `rewardSender=${params.rewardSenderPartyId.split('::')[0]} user=${params.userPartyId.split('::')[0]} ` +
          `transferSpec.sender=${String(transferSpec.sender).split('::')[0]} feeSpec.sender=${String(feeSpec.sender).split('::')[0]}`,
      );
      const { ok, text } = await this.ledger.exerciseChoice(
        params.platformTransferCid,
        tpl,
        'ExecuteTransfer',
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
          `v27 PATH A ExecuteTransfer OK: settled=${settledCid?.slice(0, 12) ?? 'none'} updateId=${updateId?.slice(0, 12) ?? 'none'}`,
        );
        return { ok: true, settledCid, updateId, errors: [] };
      }
      const err = this.formatLedgerError(text, 'ExecuteTransfer (PATH A) failed');
      this.logger.warn(`v27 PATH A exec fail: ${text.slice(0, 300)}`);
      return fail([err]);
    } catch (err) {
      const msg = `executePlatformTransferReward exception: ${String(err)}`;
      this.logger.warn(msg);
      return fail([msg]);
    }
  }

  /**
   * markSettled — exercise QuestPaymentRequest.MarkSettled (v27 wrapper lifecycle).
   *
   * Dipanggil setelah:
   *   PATH A: executePlatformTransferReward sukses (collectTxId = updateId Canton)
   *   PATH B: collectAcceptedAppPayment sukses (collectTxId = updateId Canton)
   *
   * Guard DAML: status harus "ACCEPTED" utk PATH B. Tapi PATH A langsung dari
   * PENDING (tidak ada Accept step). ⚠️ Karena itu PATH A LONCENG ke MarkSettled
   * akan GAGAL (DAML guard "Harus ACCEPTED untuk MarkSettled!").
   *
   * Solusi: PATH A tidak panggil markSettled — QuestPaymentRequest tetap PENDING
   * sebagai audit record (acceptable, krn PATH A sukses berarti reward sudah
   * terkirim via PlatformTransfer SETTLED). Method ini HANYA dipakai PATH B.
   * Alternatif future: tambah choice MarkSettledFromPending di DAML utk PATH A.
   *
   * actAs: [operator] (controller admin).
   */
  async markSettled(params: {
    questPaymentRequestCid: string;   // QuestPaymentRequest (status ACCEPTED)
    collectTxId: string;              // Canton update id dari Collect/ExecuteTransfer
  }): Promise<{ ok: boolean; errors: string[] }> {
    if (!this.isClaimSessionConfigured()) return { ok: false, errors: ['Claim session ledger disabled'] };
    const tpl = this.templateId(TPL.QuestPaymentRequest);
    const operator = this.operatorPartyId;
    if (!operator) return { ok: false, errors: ['Canton operator party not configured'] };
    try {
      const nowIso = new Date().toISOString();
      const { ok, text } = await this.ledger.exerciseChoice(
        params.questPaymentRequestCid,
        tpl,
        'MarkSettled',
        { collectTxId: params.collectTxId, settledAt: nowIso },
        [operator],
        `qpr-settled-${params.questPaymentRequestCid.slice(0, 16)}-${randomUUID()}`,
        'submit-and-wait-for-transaction-tree',
      );
      if (ok) {
        this.logger.log(`MarkSettled OK: qpr=${params.questPaymentRequestCid.slice(0, 12)}`);
        return { ok: true, errors: [] };
      }
      const err = this.formatLedgerError(text, 'MarkSettled failed');
      this.logger.warn(`MarkSettled fail: ${text.slice(0, 200)}`);
      return { ok: false, errors: [err] };
    } catch (err) {
      return { ok: false, errors: [`markSettled exception: ${String(err)}`] };
    }
  }

  // ── 5b. v27 PATH B — AppPaymentRequest flow (Splice native) ─────────────────
  // PATH B dipakai saat: token=USDCx (selalu) ATAU CC tanpa preapproval.
  // Flow: createAppPaymentRequest → acceptAppPaymentRequest → markAccepted →
  //       collectAcceptedAppPayment → markSettled.
  //
  // AppPaymentRequest & AcceptedAppPayment adalah template Splice native
  // (#splice-wallet-payments:Splice.Wallet.Payment:...) — BUKAN template Main.
  // Diakses via Ledger API JSON-RPC langsung ke participant node.
  //
  // Sync Accept: backend exercise AppPaymentRequest_Accept atas nama user
  // (custodial, actAs [userPartyId, walletProvider]). Sesuai arsitektur custodial
  // yang sudah dipakai settleAtomic (actAs multi-party via service account).

  /** Template ID Splice utk AppPaymentRequest & AcceptedAppPayment. */
  private static readonly SPLICE_APP_PAYMENT_REQUEST_TPL =
    '#splice-wallet-payments:Splice.Wallet.Payment:AppPaymentRequest';
  private static readonly SPLICE_ACCEPTED_APP_PAYMENT_TPL =
    '#splice-wallet-payments:Splice.Wallet.Payment:AcceptedAppPayment';

  /**
   * createAppPaymentRequest — create Splice AppPaymentRequest (PATH B step 1).
   *
   * Template: #splice-wallet-payments:Splice.Wallet.Payment:AppPaymentRequest
   * sender = REWARD_SENDER (sumber dana reward), provider = APP_PROVIDER,
   * dso = DSO. receiverAmounts = [(user, reward), (feeParty, fee)].
   *
   * actAs: 5-party [operator, rewardSender, appProvider, userPartyId, feeParty]
   *   (AppPaymentRequest signatory = sender + receivers + provider, per master flow).
   * disclosedContracts: AmuletRules + OpenMiningRound (resolve via scan-proxy).
   *
   * unit encoding: CC = 'AmuletUnit', USDCx = 'USDUnit'.
   */
  async createAppPaymentRequest(params: {
    senderPartyId: string;          // CANTON_REWARD_PARTY_ID
    receiverUserPartyId: string;    // user (receiver reward)
    feeReceiverPartyId: string;     // CANTON_FEE_RECIPIENT_PARTY_ID (receiver fee)
    providerPartyId: string;        // CANTON_APP_PROVIDER_PARTY_ID
    dsoPartyId: string;             // CANTON_DSO_PARTY_ID
    rewardAmount: number;
    feeAmount: number;
    token: 'CC' | 'USDCx';          // CC → AmuletUnit, USDCx → USDUnit
    expiresAt: string;              // ISO — sinkron dgn QuestPaymentRequest.expiresAt
    description: string;
    commandIdHint: string;          // idempotency (mis. claimId)
  }): Promise<{ ok: boolean; appPaymentRequestCid: string | null; errors: string[] }> {
    const fail = (errors: string[]) => ({ ok: false, appPaymentRequestCid: null, errors });
    if (!this.isClaimSessionConfigured())
      return fail(['Claim session ledger disabled']);
    const operator = this.operatorPartyId;
    if (!operator) return fail(['Canton operator party not configured']);
    const reachErr = await this.ensureReachable();
    if (reachErr) return fail([reachErr]);

    // Resolve disclosed contracts (AmuletRules + OpenMiningRound).
    const splice = await this.ledger.resolveSpliceDisclosedContracts();
    if (!splice) return fail(['Failed to resolve Splice disclosed contracts (AmuletRules/OpenMiningRound)']);

    // unit: CC → AmuletUnit, USDCx → USDUnit.
    const unit = params.token === 'CC' ? 'AmuletUnit' : 'USDUnit';

    try {
      const tpl = QuestLedgerService.SPLICE_APP_PAYMENT_REQUEST_TPL;
      const createArguments = {
        sender: params.senderPartyId,
        receiverAmounts: [
          {
            receiver: params.receiverUserPartyId,
            amount: { amount: this.dec(params.rewardAmount), unit },
          },
          {
            receiver: params.feeReceiverPartyId,
            amount: { amount: this.dec(params.feeAmount), unit },
          },
        ],
        provider: params.providerPartyId,
        dso: params.dsoPartyId,
        expiresAt: params.expiresAt,
        description: params.description,
      };
      // actAs: 5-party (signatory sender + receivers + provider, + operator utk submit).
      const actAs = [
        operator,
        params.senderPartyId,
        params.providerPartyId,
        params.receiverUserPartyId,
        params.feeReceiverPartyId,
      ];
      const res = await this.ledger.createContract(
        tpl,
        createArguments,
        actAs,
        `apreq-create-${params.commandIdHint.slice(0, 16)}-${randomUUID()}`,
        splice.disclosedContracts,
      );
      if (res.ok && res.contractId) {
        this.logger.log(
          `AppPaymentRequest created: hint=${params.commandIdHint.slice(0, 16)} reward=${params.rewardAmount} fee=${params.feeAmount} ${params.token}`,
        );
        return { ok: true, appPaymentRequestCid: res.contractId, errors: [] };
      }
      const err = this.formatLedgerError(res.error, 'Failed to create AppPaymentRequest');
      this.logger.warn(`AppPaymentRequest create fail: ${err}`);
      return fail([err]);
    } catch (err) {
      const msg = `createAppPaymentRequest exception: ${String(err)}`;
      this.logger.warn(msg);
      return fail([msg]);
    }
  }

  /**
   * acceptAppPaymentRequest — exercise AppPaymentRequest_Accept (PATH B step 2).
   *
   * Sync Accept: backend exercise atas nama user (custodial). Membangun:
   *   inputs = TransferInput[] dari REWARD_SENDER Amulet holdings ({tag:'InputAmulet', value}).
   *     ⚠️ SENDER reward = REWARD_SENDER (bukan user). User TIDAK funding — user hanya
   *     receiver. Funding datang dari sender (REWARD_SENDER) wallet. Tapi Accept choice
   *     dikontrol sender (user dalam konteks AppPaymentRequest = sender field), jadi
   *     inputs = holdings REWARD_SENDER (sender funding locked amulet).
   *     Koreksi: AppPaymentRequest.sender = REWARD_SENDER → Accept controller = sender
   *     → inputs dari REWARD_SENDER holdings.
   *   context = PaymentTransferContext { amuletRules, context: TransferContext }
   *   walletProvider = CANTON_WALLET_PROVIDER_PARTY_ID
   *
   * actAs: [userPartyId, walletProvider] per master flow line 190.
   *   ⚠️ "userPartyId" di sini = AppPaymentRequest.sender = REWARD_SENDER party
   *   (sender adalah party yang accept). Backend pass senderPartyId sbg actAs[0].
   *
   * Return: { acceptedAppPaymentCid, senderChangeAmulet } dari AcceptResult.
   */
  async acceptAppPaymentRequest(params: {
    appPaymentRequestCid: string;
    senderPartyId: string;          // AppPaymentRequest.sender = REWARD_SENDER
    walletProviderPartyId: string;  // CANTON_WALLET_PROVIDER_PARTY_ID
    fundingAmount: number;          // total reward+fee utk greedyFill inputs
    commandIdHint: string;
  }): Promise<{
    ok: boolean;
    acceptedAppPaymentCid: string | null;
    senderChangeAmulet: string | null;
    errors: string[];
  }> {
    const fail = (errors: string[]) => ({
      ok: false,
      acceptedAppPaymentCid: null,
      senderChangeAmulet: null,
      errors,
    });
    if (!this.isClaimSessionConfigured())
      return fail(['Claim session ledger disabled']);
    const operator = this.operatorPartyId;
    if (!operator) return fail(['Canton operator party not configured']);

    const splice = await this.ledger.resolveSpliceDisclosedContracts();
    if (!splice) return fail(['Failed to resolve Splice disclosed contracts']);

    // Build TransferInput[] dari sender (REWARD_SENDER) Amulet holdings.
    const senderHoldings = await this.ledger.queryAmuletHoldings(params.senderPartyId);
    const inputCids = this.greedyFillHoldings(senderHoldings, params.fundingAmount);
    if (inputCids.length === 0) {
      return fail([`Insufficient Amulet holdings for Accept funding ${params.fundingAmount} (sender=${params.senderPartyId.split('::')[0]})`]);
    }
    const inputs = inputCids.map((cid) => ({ tag: 'InputAmulet', value: cid }));

    // PaymentTransferContext = { amuletRules, context: TransferContext }
    // TransferContext = { openMiningRound, issuingMiningRounds, validatorRights, featuredAppRight }
    const choiceArgument = {
      inputs,
      context: {
        amuletRules: splice.amuletRulesCid,
        context: {
          openMiningRound: splice.openMiningRoundCid,
          issuingMiningRounds: [],
          validatorRights: [],
          featuredAppRight: null,
        },
      },
      walletProvider: params.walletProviderPartyId,
    };

    // actAs: [sender, walletProvider] per master flow.
    const actAs = [params.senderPartyId, params.walletProviderPartyId];

    try {
      const tpl = QuestLedgerService.SPLICE_APP_PAYMENT_REQUEST_TPL;
      const { ok, text } = await this.ledger.exerciseChoice(
        params.appPaymentRequestCid,
        tpl,
        'AppPaymentRequest_Accept',
        choiceArgument,
        actAs,
        `apreq-accept-${params.commandIdHint.slice(0, 16)}-${randomUUID()}`,
        'submit-and-wait-for-transaction-tree',
        splice.disclosedContracts,
      );
      if (ok) {
        // Parse AcceptedAppPayment cid + senderChangeAmulet dari transaction tree.
        const acceptedCid = this.extractCidBySuffix(text, ':Splice.Wallet.Payment:AcceptedAppPayment');
        const changeAmulet = this.extractCidBySuffix(text, ':Splice.Amulet:Amulet');
        this.logger.log(
          `AppPaymentRequest_Accept OK: accepted=${acceptedCid?.slice(0, 12) ?? 'none'} changeAmulet=${changeAmulet?.slice(0, 12) ?? 'none'}`,
        );
        return {
          ok: true,
          acceptedAppPaymentCid: acceptedCid,
          senderChangeAmulet: changeAmulet,
          errors: [],
        };
      }
      const err = this.formatLedgerError(text, 'AppPaymentRequest_Accept failed');
      this.logger.warn(`AppPaymentRequest_Accept fail: ${text.slice(0, 300)}`);
      return fail([err]);
    } catch (err) {
      const msg = `acceptAppPaymentRequest exception: ${String(err)}`;
      this.logger.warn(msg);
      return fail([msg]);
    }
  }

  /**
   * markAccepted — exercise QuestPaymentRequest.MarkAccepted (PATH B step 3).
   *
   * Dipanggil setelah acceptAppPaymentRequest sukses. Update field
   * appPaymentRequestCid ke acceptedAppPaymentCid, status PENDING → ACCEPTED.
   *
   * actAs: [operator] (controller admin).
   */
  async markAccepted(params: {
    questPaymentRequestCid: string;   // QuestPaymentRequest (status PENDING)
    acceptedAppPaymentCid: string;    // dari AcceptResult.acceptedPayment
  }): Promise<{ ok: boolean; errors: string[] }> {
    if (!this.isClaimSessionConfigured()) return { ok: false, errors: ['Claim session ledger disabled'] };
    const tpl = this.templateId(TPL.QuestPaymentRequest);
    const operator = this.operatorPartyId;
    if (!operator) return { ok: false, errors: ['Canton operator party not configured'] };
    try {
      const nowIso = new Date().toISOString();
      const { ok, text } = await this.ledger.exerciseChoice(
        params.questPaymentRequestCid,
        tpl,
        'MarkAccepted',
        { acceptedAppPaymentCid: params.acceptedAppPaymentCid, acceptedAt: nowIso },
        [operator],
        `qpr-accepted-${params.questPaymentRequestCid.slice(0, 16)}-${randomUUID()}`,
        'submit-and-wait-for-transaction-tree',
      );
      if (ok) {
        this.logger.log(`MarkAccepted OK: qpr=${params.questPaymentRequestCid.slice(0, 12)}`);
        return { ok: true, errors: [] };
      }
      const err = this.formatLedgerError(text, 'MarkAccepted failed');
      this.logger.warn(`MarkAccepted fail: ${text.slice(0, 200)}`);
      return { ok: false, errors: [err] };
    } catch (err) {
      return { ok: false, errors: [`markAccepted exception: ${String(err)}`] };
    }
  }

  /**
   * collectAcceptedAppPayment — exercise AcceptedAppPayment_Collect (PATH B step 4).
   *
   * Template: #splice-wallet-payments:Splice.Wallet.Payment:AcceptedAppPayment
   * Choice: AcceptedAppPayment_Collect, args = { context: AppTransferContext }.
   * AppTransferContext = { amuletRules, openMiningRound, featuredAppRight: Optional }
   *   (FLAT — beda dari PaymentTransferContext nested Accept).
   *
   * actAs: 4-party [rewardSender, appProvider, userPartyId, feeReceiver]
   *   (controller = signatory this = SEMUA signatory AcceptedAppPayment).
   *   Kurang 1 party → DITOLAK ledger.
   *
   * ATOMIC 1 TX: LockedAmulet dilepas, user + fee terima reward, FAR built-in.
   * Return: { receiverAmulets (array), collectTxId (Canton updateId) }.
   */
  async collectAcceptedAppPayment(params: {
    acceptedAppPaymentCid: string;
    rewardSenderPartyId: string;     // sender (signatory)
    appProviderPartyId: string;      // provider (signatory)
    userPartyId: string;             // receiver reward (signatory)
    feeReceiverPartyId: string;      // receiver fee (signatory)
    featuredAppRightCid?: string | null; // Optional — null utk basic collect
    commandIdHint: string;
  }): Promise<{
    ok: boolean;
    collectTxId: string | null;
    errors: string[];
  }> {
    const fail = (errors: string[]) => ({ ok: false, collectTxId: null, errors });
    if (!this.isClaimSessionConfigured())
      return fail(['Claim session ledger disabled']);
    const operator = this.operatorPartyId;
    if (!operator) return fail(['Canton operator party not configured']);

    const splice = await this.ledger.resolveSpliceDisclosedContracts();
    if (!splice) return fail(['Failed to resolve Splice disclosed contracts']);

    // AppTransferContext = { amuletRules, openMiningRound, featuredAppRight: Optional }
    const opt = <T,>(v: T | null | undefined) => (v == null ? null : v); // DAML Optional = nullable
    const choiceArgument = {
      context: {
        amuletRules: splice.amuletRulesCid,
        openMiningRound: splice.openMiningRoundCid,
        featuredAppRight: opt(params.featuredAppRightCid ?? null),
      },
    };

    // actAs: 4 signatory (controller = signatory this).
    const actAs = [
      params.rewardSenderPartyId,
      params.appProviderPartyId,
      params.userPartyId,
      params.feeReceiverPartyId,
    ];

    try {
      const tpl = QuestLedgerService.SPLICE_ACCEPTED_APP_PAYMENT_TPL;
      const { ok, text } = await this.ledger.exerciseChoice(
        params.acceptedAppPaymentCid,
        tpl,
        'AcceptedAppPayment_Collect',
        choiceArgument,
        actAs,
        `apreq-collect-${params.commandIdHint.slice(0, 16)}-${randomUUID()}`,
        'submit-and-wait-for-transaction-tree',
        splice.disclosedContracts,
      );
      if (ok) {
        const collectTxId = this.extractUpdateId(text);
        this.logger.log(
          `AcceptedAppPayment_Collect OK: txId=${collectTxId?.slice(0, 12) ?? 'none'}`,
        );
        return { ok: true, collectTxId, errors: [] };
      }
      const err = this.formatLedgerError(text, 'AcceptedAppPayment_Collect failed');
      this.logger.warn(`AcceptedAppPayment_Collect fail: ${text.slice(0, 300)}`);
      return fail([err]);
    } catch (err) {
      const msg = `collectAcceptedAppPayment exception: ${String(err)}`;
      this.logger.warn(msg);
      return fail([msg]);
    }
  }

  /**
   * markExpired — exercise QuestPaymentRequest.MarkExpired (PATH B failure flow).
   *
   * 4 skenario: TIMEOUT, REJECTED, WITHDRAWN, CANCELLED.
   * Consuming choice → QuestPaymentRequest di-archive setelah expired.
   *
   * actAs: [operator] (controller admin).
   */
  async markExpired(params: {
    questPaymentRequestCid: string;
    reason: 'TIMEOUT' | 'REJECTED' | 'WITHDRAWN' | 'CANCELLED';
  }): Promise<{ ok: boolean; errors: string[] }> {
    if (!this.isClaimSessionConfigured()) return { ok: false, errors: ['Claim session ledger disabled'] };
    const tpl = this.templateId(TPL.QuestPaymentRequest);
    const operator = this.operatorPartyId;
    if (!operator) return { ok: false, errors: ['Canton operator party not configured'] };
    try {
      const nowIso = new Date().toISOString();
      const { ok, text } = await this.ledger.exerciseChoice(
        params.questPaymentRequestCid,
        tpl,
        'MarkExpired',
        { reason: params.reason, expiredAt: nowIso },
        [operator],
        `qpr-expired-${params.questPaymentRequestCid.slice(0, 16)}-${randomUUID()}`,
        'submit-and-wait-for-transaction-tree',
      );
      if (ok) {
        this.logger.log(`MarkExpired OK: qpr=${params.questPaymentRequestCid.slice(0, 12)} reason=${params.reason}`);
        return { ok: true, errors: [] };
      }
      const err = this.formatLedgerError(text, 'MarkExpired failed');
      this.logger.warn(`MarkExpired fail: ${text.slice(0, 200)}`);
      return { ok: false, errors: [err] };
    } catch (err) {
      return { ok: false, errors: [`markExpired exception: ${String(err)}`] };
    }
  }

  /**
   * extractCidBySuffix — generic contractId extractor by templateId suffix.
   *
   * Berbeda dari extractContractIdsByTemplate (typed TPL union), ini accept
   * arbitrary string suffix (utk Splice template IDs di luar TPL const).
   * Walk transaction-tree JSON, return first contractId whose templateId.endsWith(suffix).
   */
  private extractCidBySuffix(text: string, suffix: string): string | null {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const stack: unknown[] = [parsed];
      while (stack.length) {
        const cur = stack.pop();
        if (!cur || typeof cur !== 'object') continue;
        if (Array.isArray(cur)) {
          for (const item of cur) stack.push(item);
          continue;
        }
        const obj = cur as Record<string, unknown>;
        const cid = typeof obj.contractId === 'string' ? obj.contractId : null;
        const tplId = typeof obj.templateId === 'string' ? obj.templateId : null;
        if (cid && tplId && tplId.endsWith(suffix)) return cid;
        for (const v of Object.values(obj)) stack.push(v);
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  // ── Legacy / deprecated stubs ───────────────────────────────────────────────

  /** @deprecated */
  async ensureParticipation(params: {
    questId: string;
    questKind: string;
    userPartyId: string;
  }): Promise<{ contractId: string | null; error?: string }> {
    return { contractId: null };
  }
  /** @deprecated */
  async createClaimSession(params: {
    questId: string;
    userPartyId: string;
    claimKind: string;
    feeCc: number;
    rewardCc: number;
  }): Promise<ClaimSessionLedgerResult> {
    return { ledgerEnabled: false, sessionContractId: null, errors: [] };
  }
  /** @deprecated */
  async createEarnClaimSession(params: {
    questId?: string;
    campaignId?: string;
    userPartyId: string;
    [key: string]: unknown;
  }): Promise<{ contractId: string | null; error?: string }> {
    return { contractId: null };
  }
  /** @deprecated */
  async createFcfsSlotReservation(params: {
    questId?: string;
    campaignId?: string;
    userPartyId: string;
    [key: string]: unknown;
  }): Promise<{ contractId: string | null; error?: string }> {
    return { contractId: null };
  }
  /** @deprecated */
  async createCcRewardEntitlement(params: {
    questId?: string;
    campaignId?: string;
    userPartyId: string;
    [key: string]: unknown;
  }): Promise<{ contractId: string | null; error?: string }> {
    return { contractId: null };
  }
  /** @deprecated */
  async createCodeRewardEntitlement(params: {
    questId?: string;
    campaignId?: string;
    userPartyId: string;
    [key: string]: unknown;
  }): Promise<{ contractId: string | null; error?: string }> {
    return { contractId: null };
  }

  async recordPartyRegistration(params: {
    userPartyId: string;
    username?: string;
    partyHint?: string;
    inviteCode?: string;
    [key: string]: unknown;
  }): Promise<{ ok: boolean; contractId: string | null; errors: string[] }> {
    if (!params.userPartyId) return { ok: true, contractId: null, errors: [] };
    const resolvedUsername =
      params.username ?? params.partyHint ?? params.userPartyId.split('::')[0];
    // v21: hanya create WalletRegistration. UserAccount dihapus (poin off-chain).
    const walletResult = await this.registerWallet({
      userPartyId: params.userPartyId,
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

  /** @deprecated */
  async recordCcTransfer(params: {
    senderPartyId?: string;
    receiverPartyId?: string;
    amount?: number;
    txId?: string;
    [key: string]: unknown;
  }): Promise<{ ok: boolean; contractId: string | null; errors: string[] }> {
    return { ok: true, contractId: null, errors: [] };
  }
  /** @deprecated */
  async createRaffleWinner(params: {
    userPartyId: string;
    questId?: string;
    campaignId?: string;
    rewardCc?: number;
    txId?: string;
    [key: string]: unknown;
  }): Promise<{ contractId: string | null; error?: string }> {
    return { contractId: null };
  }
  /** @deprecated — v21: gunakan atomicFeeAndReward (gabungan fee+reward) */
  async markEarnClaimFeePaid(params: {
    sessionContractId: string;
    feeTxId: string;
  }): Promise<{ ok: boolean; errors: string[] }> {
    return { ok: true, errors: [] };
  }
  /** @deprecated — v21: gunakan atomicFeeAndReward (gabungan fee+reward) */
  async markEarnClaimRewardSent(params: {
    sessionContractId: string;
    rewardTxId: string;
  }): Promise<{ ok: boolean; errors: string[] }> {
    return { ok: true, errors: [] };
  }
  /** @deprecated */
  async markClaimFeePaid(params: {
    sessionContractId: string;
    feeTxId: string;
  }): Promise<{ ok: boolean; errors: string[] }> {
    return this.markEarnClaimFeePaid(params);
  }
  /** @deprecated */
  async markClaimRewardSent(params: {
    sessionContractId: string;
    rewardTxId: string;
  }): Promise<{ ok: boolean; errors: string[] }> {
    return this.markEarnClaimRewardSent({
      sessionContractId: params.sessionContractId,
      rewardTxId: params.rewardTxId,
    });
  }
  /** @deprecated */
  async markRewardClaimed(params: {
    rewardContractId: string;
    payoutTxId: string;
  }): Promise<{ ok: boolean; errors: string[] }> {
    return { ok: true, errors: [] };
  }
  /** @deprecated */
  async recordQuestCompletion(params: {
    questId: string;
    questKind: string;
    questTitle: string;
    rewardCc: number;
    userPartyId: string;
    taskIds: string[];
    proofs: Array<{ taskId: string; taskType: string; proof: string | null }>;
  }): Promise<QuestLedgerSubmitResult> {
    return {
      ledgerEnabled: false,
      participationContractId: null,
      completionContractId: null,
      rewardContractId: null,
      taskSubmissionIds: [],
      errors: [],
    };
  }
  /** @deprecated */
  async recordTaskSubmission(params: {
    questId: string;
    questKind: string;
    taskId: string;
    taskType: string;
    proof: string | null;
    userPartyId: string;
  }): Promise<QuestTaskLedgerResult> {
    return {
      ledgerEnabled: false,
      participationContractId: null,
      taskSubmissionContractId: null,
      errors: [],
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
