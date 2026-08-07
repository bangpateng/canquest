import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { CantonLedgerService } from './canton-ledger.service';

/**
 * DAML template paths — module Main (canquest-v27 hybrid).
 *
 * Templates CanQuest (5 — v27):
 *   Main:WalletRegistration  — jangkar identitas on-chain (Party ID)
 *   Main:CampaignEligibility — bukti eligibility (LOCK_CC / POINTS) per campaign
 *   Main:QuestCampaign       — template induk quest (6 questKind) + state machine + eligibility guard
 *   Main:PlatformTransfer    — atomic send token + platform fee (dormant)
 *   Main:QuestPaymentRequest — fee-tracking wrapper utk AppPaymentRequest (FEE ONLY)
 *
 * Templates Splice (via Ledger API, literal packageId — BUKAN via damlPackageRef):
 *   #splice-wallet-payments:Splice.Wallet.Payment:AppPaymentRequest
 *   #splice-wallet-payments:Splice.Wallet.Payment:AcceptedAppPayment
 *
 * ⚠️ v27 HYBRID (koreksi dari v25 Settle):
 *   - Fee claim (user → treasury) : AppPaymentRequest (locked, no preapproval)
 *   - Reward (platform → user)    : CIP-56 TransferFactory_Transfer (backend, unchanged)
 *   - Splice tidak punya mekanisme native platform→user reward (verified vs docs).
 *
 * YANG TIDAK ADA ON-CHAIN (off-chain Postgres):
 *   - Poin user        → User.earnPoints + EarnEntry (backend DB)
 *   - Daily check-in   → QuestSubmission unik + cooldown 24h (backend DB)
 *   - Referral reward  → ReferralReward (backend DB)
 *   - Audit trail CC   → redundan; ledger Canton sudah audit mutlak
 *   - Spin             → feature removed (tabel di-drop)
 *
 * Authorization pattern (Canton M3 + v27 hybrid):
 *   signatory admin  — operator signs all contracts
 *   observer user    — user can only read, backend submits on their behalf (custodial)
 *   AppPaymentRequest_Accept  : actAs [userAddress, walletProvider] (custodial, CanActAsAnyParty)
 *   AcceptedAppPayment_Collect: actAs [admin, userAddress, platformParty, treasuryParty]
 *
 * All methods are best-effort: they log errors but never throw,
 * so a Canton outage does not break the main application flow.
 */
const TPL = {
  WalletRegistration: 'Main:WalletRegistration',
  CampaignEligibility: 'Main:CampaignEligibility',
  QuestCampaign: 'Main:QuestCampaign',
  PlatformTransfer: 'Main:PlatformTransfer',
  QuestPaymentRequest: 'Main:QuestPaymentRequest',
  // Splice templates — literal packageId, TIDAK lewat damlPackageRef.
  // Dipakai apa adanya sebagai templateId (bukan suffix).
  AppPaymentRequest: '#splice-wallet-payments:Splice.Wallet.Payment:AppPaymentRequest',
  AcceptedAppPayment: '#splice-wallet-payments:Splice.Wallet.Payment:AcceptedAppPayment',
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
  errors: string[];
}

// ── v27 AppPaymentRequest flow result types ──────────────────────────────────

export interface QuestPaymentRequestLedgerResult {
  ledgerEnabled: boolean;
  contractId: string | null;
  errors: string[];
}

export interface AppPaymentRequestLedgerResult {
  ledgerEnabled: boolean;
  appPaymentRequestCid: string | null;
  errors: string[];
}

export interface AcceptAppPaymentResult {
  ok: boolean;
  acceptedAppPaymentCid: string | null;
  senderChangeAmulet: string | null;
  errors: string[];
}

export interface CollectAppPaymentResult {
  ok: boolean;
  collectTxId: string | null;
  receiverAmulets: Array<{ receiver: string; amuletCid: string }>;
  errors: string[];
}

export interface QuestRewardCip56Result {
  ok: boolean;
  updateId: string | null;
  transferKind: string;
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
    // v27 hybrid: DAML sekarang QuestPaymentRequest (fee-tracking wrapper) +
    // ClaimSlot/DrawWinner tanpa rewardSender. Default package name canquest-v27
    // (override via CANTON_DAML_PACKAGE_NAME=<hash> di deploy, lihat runbook).
    return '#canquest-v27';
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
   * @param suffix - templateId suffix, mis. 'Main:QuestPaymentRequest'
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
    /** DAML CampaignEligibility contract id (utk fetch guard on-chain).
     *  Null bila quest eligibilityType=NONE (tidak perlu eligibility check). */
    eligibilityCid?: string | null;
  }): Promise<QuestClaimLedgerResult> {
    const result: QuestClaimLedgerResult = {
      ledgerEnabled: false,
      campaignContractId: null,
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
    // v27: ClaimSlot return ContractId QuestCampaign SAJA (no receipt, no rewardSender).
    // Reward/fee flow di-orchestrate terpisah via AppPaymentRequest + CIP-56.
    const { ok, text } = await this.ledger.exerciseChoice(
      params.campaignContractId,
      tpl,
      'ClaimSlot',
      {
        user: params.userPartyId,
        claimId: params.claimId,
        claimedAt: new Date().toISOString(),
        eligibilityCid: params.eligibilityCid ?? null, // Optional (nullable)
      },
      [operator],
      `claim-fcfs-${params.claimId}-${randomUUID()}`,
      'submit-and-wait-for-transaction-tree',
    );
    if (ok) {
      const campaignCids = this.extractContractIdsByTemplate(text, TPL.QuestCampaign);
      result.campaignContractId = campaignCids[0] ?? null;
      this.logger.log(
        `ClaimSlot: user=${params.userPartyId.split('::')[0]} campaign=${result.campaignContractId?.slice(0, 12) ?? 'none'}...`,
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
    /** DAML CampaignEligibility contract id. Null bila NONE. */
    eligibilityCid?: string | null;
  }): Promise<QuestClaimLedgerResult> {
    const result: QuestClaimLedgerResult = {
      ledgerEnabled: false,
      campaignContractId: null,
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
    // v27: DrawWinner return ContractId QuestCampaign SAJA (no receipt, no rewardSender).
    const { ok, text } = await this.ledger.exerciseChoice(
      params.campaignContractId,
      tpl,
      'DrawWinner',
      {
        user: params.userPartyId,
        claimId: params.claimId,
        rewardCode: params.rewardCode ?? '',
        drawnAt: new Date().toISOString(),
        eligibilityCid: params.eligibilityCid ?? null,
      },
      [operator],
      `draw-raffle-${params.claimId}-${randomUUID()}`,
    );
    if (ok) {
      const campaignCids = this.extractContractIdsByTemplate(text, TPL.QuestCampaign);
      result.campaignContractId = campaignCids[0] ?? null;
    } else {
      result.errors.push(
        this.formatLedgerError(text, 'DrawWinner failed'),
      );
    }
    return result;
  }

  // ── v25 LEGACY DIHAPUS di v27: revealRewardCode, settleAtomic, recordTxId ──
  // QuestClaimReceipt template tidak ada lagi. Fee flow sekarang via
  // AppPaymentRequest (B1-B7 di atas), reward via CIP-56. Lihat header file.
  // ────────────────────────────────────────────────────────────────────────────



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
   * Multi-controller, registry pre-step, FAR optional. (Legacy v25 pattern; dipakai
   * utk send-token+fee atomic. Quest reward claim di v27 pakai AppPaymentRequest+CIP-56.)
   *
   * Pre-step backend (sebelum submit):
   *   1. callTransferFactoryRegistry × 2 (transfer utama + fee)
   *   2. queryAmuletHoldings × 2 utk inputHoldingCids (transfer + fee)
   *   3. (optional) featuredAppRightCid → farCid
   *   Lalu konstruksi ExecuteTransfer args dgn data di atas.
   *
   * Self-contained: caller cukup pass platformTransferCid + userPartyId + amounts +
   * receiver/treasury party ids. Method handle registry/holdings sendiri.
   * CC (Amulet) only — utk USDCx, extend caller resolve.
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
      const instrumentAdmin = dso;

      // ── TRANSFER leg: user → receiver ───────────────────────────────────────
      const transferHoldings = await this.ledger.queryAmuletHoldings(params.userPartyId);
      // Holdings harus cukup utk amount + feeAmount (kedua leg dari wallet user sama).
      const transferInputCids = this.greedyFillHoldings(transferHoldings, params.amount + params.feeAmount);
      if (transferInputCids.length === 0 && (params.amount + params.feeAmount) > 0) {
        return fail([`Insufficient Amulet holdings for transfer ${params.amount} + fee ${params.feeAmount} CC (user=${params.userPartyId.split('::')[0]})`]);
      }
      const transferSpec = {
        sender: params.userPartyId,
        receiver: params.receiverPartyId,
        amount: params.amount.toFixed(10),
        instrumentId: { admin: instrumentAdmin, id: 'Amulet' },
        lock: null,
        requestedAt: nowIso,
        executeBefore,
        inputHoldingCids: transferInputCids,
        meta: { values: {} },
      };
      const transferRegistry = await this.ledger.callTransferFactoryRegistry(
        { expectedAdmin: instrumentAdmin, transfer: transferSpec, extraArgs: { context: { values: {} }, meta: { values: {} } } },
        instrumentAdmin,
      );
      if (!transferRegistry) return fail(['Transfer leg: callTransferFactoryRegistry returned null']);

      // ── FEE leg: user → treasury (CC Amulet) ────────────────────────────────
      const feeHoldings = await this.ledger.queryAmuletHoldings(params.userPartyId);
      const feeInputCids = this.greedyFillHoldings(feeHoldings, params.feeAmount);
      if (params.feeAmount > 0 && feeInputCids.length === 0) {
        return fail([`Insufficient Amulet holdings for fee ${params.feeAmount} CC (user=${params.userPartyId.split('::')[0]})`]);
      }
      const feeSpec = {
        sender: params.userPartyId,
        receiver: params.feeReceiverPartyId,
        amount: params.feeAmount.toFixed(10),
        instrumentId: { admin: instrumentAdmin, id: 'Amulet' },
        lock: null,
        requestedAt: nowIso,
        executeBefore,
        inputHoldingCids: feeInputCids,
        meta: { values: {} },
      };
      const feeRegistry = await this.ledger.callTransferFactoryRegistry(
        { expectedAdmin: instrumentAdmin, transfer: feeSpec, extraArgs: { context: { values: {} }, meta: { values: {} } } },
        instrumentAdmin,
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

  // ── v27 hybrid: AppPaymentRequest fee flow + CIP-56 reward ──────────────────
  //
  // Flow claim payout v27 (di-orchestrate di quests.service.executeClaimPayoutV27):
  //   1. ClaimSlot/DrawWinner        → ContractId QuestCampaign
  //   2. createQuestPaymentRequest   → ContractId QuestPaymentRequest (PENDING)
  //   3. createAppPaymentRequest     → AppPaymentRequest cid (sender=user, receiver=treasury)
  //   4. acceptAppPaymentRequest     → AcceptedAppPayment cid (custodial, actAs user+validator)
  //   5. markAccepted                → update QuestPaymentRequest status ACCEPTED
  //   6. collectAcceptedAppPayment   → fee cair ke treasury (no preapproval)
  //   7. markSettled                 → update QuestPaymentRequest status SETTLED
  //   [TERPISAH] sendQuestRewardCip56 → reward wallet → user (bila reward > 0)
  //
  // Reward (platform→user) TETAP CIP-56 — Splice tidak punya native platform→user
  // reward mechanism (verified vs docs.sync.global). AppPaymentRequest hanya utk fee.

  /** walletProvider party (utk AppPaymentRequest_Accept). Default validator party. */
  private get walletProviderPartyId(): string | null {
    const dedicated = this.config
      .get<string>('CANTON_WALLET_PROVIDER_PARTY_ID')
      ?.trim();
    if (dedicated) return dedicated;
    // Fallback: validator party (operator of WalletAppInstall).
    // Sesuai pattern inspect-token-standard-dar.cjs:54.
    return this.operatorPartyId;
  }

  /** platformParty (AppPaymentRequest.provider = app provider). */
  private get platformPartyId(): string | null {
    return this.config.get<string>('CANTON_APP_PROVIDER_PARTY_ID')?.trim() ?? null;
  }

  /** treasuryParty (fee receiver). */
  private get treasuryPartyId(): string | null {
    return this.config.get<string>('CANTON_FEE_RECIPIENT_PARTY_ID')?.trim() ?? null;
  }

  /** dsoParty (Amulet instrument admin). */
  private get dsoPartyId(): string | null {
    return this.config.get<string>('CANTON_DSO_PARTY_ID')?.trim() ?? null;
  }

  /**
   * B1. createQuestPaymentRequest — create DAML QuestPaymentRequest (PENDING).
   * Fee-tracking wrapper utk AppPaymentRequest lifecycle. Reward TIDAK lewat sini
   * (reward via CIP-56). Field appPaymentRequestCid diisi string kosong dulu,
   * di-update ke AcceptedAppPayment cid setelah MarkAccepted.
   */
  async createQuestPaymentRequest(params: {
    userPartyId: string;
    campaignId: string;
    claimId: string;
    requestId: string;            // UUID internal utk korelasi DB
    feeAmount: number;
    token: 'CC' | 'USDCx';
    expiresAt: string;            // ISO, sama dgn AppPaymentRequest.expiresAt
  }): Promise<QuestPaymentRequestLedgerResult> {
    const result: QuestPaymentRequestLedgerResult = {
      ledgerEnabled: false,
      contractId: null,
      errors: [],
    };
    if (!this.isClaimSessionConfigured()) return result;
    const tpl = this.templateId(TPL.QuestPaymentRequest);
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
    try {
      const res = await this.ledger.createContract(
        tpl,
        {
          admin: operator,
          userAddress: params.userPartyId,
          campaignId: params.campaignId,
          claimId: params.claimId,
          requestId: params.requestId,
          appPaymentRequestCid: '',      // di-update setelah create AppPaymentRequest
          feeAmount: this.dec(params.feeAmount),
          token: params.token,
          status: 'PENDING',
          createdAt: new Date().toISOString(),
          expiresAt: params.expiresAt,
        },
        [operator],
        `qpr-${params.requestId}`,
      );
      if (res.ok && res.contractId) {
        this.logger.log(
          `QuestPaymentRequest created: campaign=${params.campaignId.slice(0, 8)} fee=${params.feeAmount}`,
        );
        return { ledgerEnabled: true, contractId: res.contractId, errors: [] };
      }
      const err = this.formatLedgerError(res.error, 'Failed to create QuestPaymentRequest');
      this.logger.warn(`QuestPaymentRequest fail: ${err}`);
      return { ledgerEnabled: true, contractId: null, errors: [err] };
    } catch (err) {
      const msg = `createQuestPaymentRequest exception: ${String(err)}`;
      this.logger.warn(msg);
      return { ledgerEnabled: true, contractId: null, errors: [msg] };
    }
  }

  /**
   * B2. createAppPaymentRequest — create Splice AppPaymentRequest via Ledger API.
   * Flow USER-BAYAR: sender=user, receiverAmounts=[(treasury, fee)], provider=platform.
   * ⚠️ FEE ONLY — reward TIDAK di-sini (reward via CIP-56, arah terbalik).
   */
  async createAppPaymentRequest(params: {
    userPartyId: string;          // sender (user yang BAYAR fee)
    feeAmount: number;
    treasuryPartyId?: string;     // default this.treasuryPartyId
    platformPartyId?: string;     // default this.platformPartyId
    dsoPartyId?: string;          // default this.dsoPartyId
    expiresAt: string;            // ISO
    description: string;
    requestId: string;            // utk commandId idempotency
  }): Promise<AppPaymentRequestLedgerResult> {
    const result: AppPaymentRequestLedgerResult = {
      ledgerEnabled: false,
      appPaymentRequestCid: null,
      errors: [],
    };
    if (!this.isClaimSessionConfigured()) return result;
    const operator = this.operatorPartyId;
    const treasury = params.treasuryPartyId ?? this.treasuryPartyId;
    const platform = params.platformPartyId ?? this.platformPartyId;
    const dso = params.dsoPartyId ?? this.dsoPartyId;
    if (!operator || !treasury || !platform || !dso) {
      result.errors.push(
        'Missing party config (operator/treasury/platform/dso) for AppPaymentRequest',
      );
      return result;
    }
    const reachErr = await this.ensureReachable();
    if (reachErr) {
      result.errors.push(reachErr);
      return result;
    }
    result.ledgerEnabled = true;
    try {
      const tpl = TPL.AppPaymentRequest; // literal packageId (bukan via damlPackageRef)
      const res = await this.ledger.createContract(
        tpl,
        {
          sender: params.userPartyId,
          receiverAmounts: [
            {
              receiver: treasury,
              amount: {
                amount: this.dec(params.feeAmount),
                unit: 'AmuletUnit',
              },
            },
          ],
          provider: platform,
          dso,
          expiresAt: params.expiresAt,
          description: params.description,
        },
        [params.userPartyId], // sender = user
        `apr-${params.requestId}`,
      );
      if (res.ok && res.contractId) {
        this.logger.log(
          `AppPaymentRequest created: user=${params.userPartyId.split('::')[0]} fee=${params.feeAmount} cid=${res.contractId.slice(0, 16)}…`,
        );
        return {
          ledgerEnabled: true,
          appPaymentRequestCid: res.contractId,
          errors: [],
        };
      }
      const err = this.formatLedgerError(res.error, 'Failed to create AppPaymentRequest');
      this.logger.warn(`AppPaymentRequest fail: ${err}`);
      return { ledgerEnabled: true, appPaymentRequestCid: null, errors: [err] };
    } catch (err) {
      const msg = `createAppPaymentRequest exception: ${String(err)}`;
      this.logger.warn(msg);
      return { ledgerEnabled: true, appPaymentRequestCid: null, errors: [msg] };
    }
  }

  /**
   * B3. acceptAppPaymentRequest — exercise AppPaymentRequest_Accept (CUSTODIAL).
   * Paling kompleks: resolve PaymentTransferContext (nested) + TransferInput dari
   * holdings user, exercise atas nama [user, walletProvider]. Backend pegang
   * CanActAsAnyParty. Dana fee terkunci di AcceptedAppPayment.lockedAmulet.
   *
   * Pattern reference: canton-ledger.service.ts:1815-1843 (CreateTransferPreapproval).
   */
  async acceptAppPaymentRequest(params: {
    appPaymentRequestCid: string;
    userPartyId: string;
    feeAmount: number;
    walletProviderPartyId?: string; // default this.walletProviderPartyId
  }): Promise<AcceptAppPaymentResult> {
    if (!this.isClaimSessionConfigured())
      return {
        ok: false,
        acceptedAppPaymentCid: null,
        senderChangeAmulet: null,
        errors: ['Claim session ledger disabled'],
      };
    const operator = this.operatorPartyId;
    const walletProvider = params.walletProviderPartyId ?? this.walletProviderPartyId;
    if (!operator || !walletProvider) {
      return {
        ok: false,
        acceptedAppPaymentCid: null,
        senderChangeAmulet: null,
        errors: ['Missing operator/walletProvider party for AppPaymentRequest_Accept'],
      };
    }
    const reachErr = await this.ensureReachable();
    if (reachErr)
      return {
        ok: false,
        acceptedAppPaymentCid: null,
        senderChangeAmulet: null,
        errors: [reachErr],
      };

    try {
      // 1) Resolve disclosed contracts dari scan-proxy (amuletRules + openMiningRound).
      const amuletRules = await this.ledger.fetchScanProxyContract('amulet-rules');
      if (!amuletRules)
        return {
          ok: false,
          acceptedAppPaymentCid: null,
          senderChangeAmulet: null,
          errors: ['scan-proxy /amulet-rules failed'],
        };
      const openRound = await this.ledger.fetchScanProxyContract(
        'open-and-issuing-mining-rounds',
      );
      if (!openRound)
        return {
          ok: false,
          acceptedAppPaymentCid: null,
          senderChangeAmulet: null,
          errors: ['scan-proxy /open-and-issuing-mining-rounds failed'],
        };

      // 2) Resolve TransferInput (InputAmulet) dari holdings user.
      //    Greedy-fill supaya total cover fee (+ buffer decay). Accept butuh input
      //    yang cukup utk lock; sisa dikembalikan via senderChangeAmulet.
      const holdings = await this.ledger.queryAmuletHoldings(params.userPartyId);
      if (holdings.length === 0)
        return {
          ok: false,
          acceptedAppPaymentCid: null,
          senderChangeAmulet: null,
          errors: [`User ${params.userPartyId.split('::')[0]} has no Amulet holdings to pay fee`],
        };
      const inputCids = this.greedyFillHoldings(holdings, params.feeAmount);
      if (inputCids.length === 0)
        return {
          ok: false,
          acceptedAppPaymentCid: null,
          senderChangeAmulet: null,
          errors: ['Insufficient Amulet holdings to cover fee'],
        };
      const inputs = inputCids.map((cid) => ({ tag: 'InputAmulet', value: cid }));

      // 3) choiceArgument — nested PaymentTransferContext (BUKAN flat).
      //    AppPaymentRequest_Accept: { inputs, context: { amuletRules, context }, walletProvider }
      const choiceArgument = {
        inputs,
        context: {
          amuletRules: amuletRules.contractId,
          context: {
            openMiningRound: openRound.contractId,
            issuingMiningRounds: [],
            validatorRights: [],
          },
        },
        walletProvider,
      };

      const disclosedContracts = [
        {
          templateId: amuletRules.templateId,
          contractId: amuletRules.contractId,
          createdEventBlob: amuletRules.blob,
        },
        {
          templateId: openRound.templateId,
          contractId: openRound.contractId,
          createdEventBlob: openRound.blob,
        },
      ];

      // 4) Exercise Accept — custodial, actAs [user, walletProvider].
      const tpl = TPL.AppPaymentRequest;
      const { ok, text } = await this.ledger.exerciseChoice(
        params.appPaymentRequestCid,
        tpl,
        'AppPaymentRequest_Accept',
        choiceArgument,
        [params.userPartyId, walletProvider],
        `accept-apr-${randomUUID()}`,
        'submit-and-wait-for-transaction-tree',
        disclosedContracts,
      );

      if (!ok)
        return {
          ok: false,
          acceptedAppPaymentCid: null,
          senderChangeAmulet: null,
          errors: [
            this.formatLedgerError(text, 'AppPaymentRequest_Accept failed'),
          ],
        };

      // 5) Parse result — AppPaymentRequest_AcceptResult =
      //    { acceptedPayment: ContractId AcceptedAppPayment, senderChangeAmulet: Optional }
      //    AcceptedAppPayment cid via extractContractIdsByTemplate.
      const acceptedCids = this.extractContractIdsByTemplate(
        text,
        TPL.AcceptedAppPayment,
      );
      let senderChange: string | null = null;
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        const exercise = parsed.exerciseResult as Record<string, unknown> | undefined;
        if (exercise) {
          const sc = exercise.senderChangeAmulet;
          if (typeof sc === 'string') senderChange = sc;
          else if (sc && typeof sc === 'object') {
            // Optional encoded sebagai { _1: ... } atau { some: ... }
            const scRec = sc as Record<string, unknown>;
            senderChange =
              (typeof scRec._1 === 'string' && scRec._1) ||
              (typeof scRec.some === 'string' && scRec.some) ||
              null;
          }
        }
      } catch {
        /* ignore parse — acceptedCid cukup */
      }

      this.logger.log(
        `AppPaymentRequest_Accept: user=${params.userPartyId.split('::')[0]} accepted=${acceptedCids[0]?.slice(0, 16) ?? 'none'}…`,
      );
      return {
        ok: true,
        acceptedAppPaymentCid: acceptedCids[0] ?? null,
        senderChangeAmulet: senderChange,
        errors: [],
      };
    } catch (err) {
      const msg = `acceptAppPaymentRequest exception: ${String(err)}`;
      this.logger.warn(msg);
      return {
        ok: false,
        acceptedAppPaymentCid: null,
        senderChangeAmulet: null,
        errors: [msg],
      };
    }
  }

  /**
   * B4. markAccepted — exercise QuestPaymentRequest.MarkAccepted.
   * Simpan AcceptedAppPayment cid ke field appPaymentRequestCid, status → ACCEPTED.
   */
  async markAccepted(params: {
    requestContractId: string; // QuestPaymentRequest cid (PENDING)
    acceptedAppPaymentCid: string;
  }): Promise<{ ok: boolean; newContractId: string | null; errors: string[] }> {
    if (!this.isClaimSessionConfigured())
      return { ok: false, newContractId: null, errors: ['Claim session ledger disabled'] };
    const tpl = this.templateId(TPL.QuestPaymentRequest);
    const operator = this.operatorPartyId;
    if (!operator)
      return { ok: false, newContractId: null, errors: ['Canton operator party not configured'] };
    const { ok, text } = await this.ledger.exerciseChoice(
      params.requestContractId,
      tpl,
      'MarkAccepted',
      {
        acceptedAppPaymentCid: params.acceptedAppPaymentCid,
        acceptedAt: new Date().toISOString(),
      },
      [operator],
      `mark-accepted-${randomUUID()}`,
      'submit-and-wait-for-transaction-tree',
    );
    if (ok) {
      const cids = this.extractContractIdsByTemplate(text, TPL.QuestPaymentRequest);
      return { ok: true, newContractId: cids[0] ?? null, errors: [] };
    }
    return {
      ok: false,
      newContractId: null,
      errors: [this.formatLedgerError(text, 'MarkAccepted failed')],
    };
  }

  /**
   * B5. collectAcceptedAppPayment — exercise AcceptedAppPayment_Collect.
   * Fee cair ke treasury (direct, no preapproval). Context FLAT (AppTransferContext),
   * bukan nested PaymentTransferContext. actAs 4 party: admin, user, platform, treasury.
   */
  async collectAcceptedAppPayment(params: {
    acceptedAppPaymentCid: string;
    userPartyId: string;
    platformPartyId?: string; // default this.platformPartyId
    treasuryPartyId?: string; // default this.treasuryPartyId
  }): Promise<CollectAppPaymentResult> {
    if (!this.isClaimSessionConfigured())
      return {
        ok: false,
        collectTxId: null,
        receiverAmulets: [],
        errors: ['Claim session ledger disabled'],
      };
    const operator = this.operatorPartyId;
    const platform = params.platformPartyId ?? this.platformPartyId;
    const treasury = params.treasuryPartyId ?? this.treasuryPartyId;
    if (!operator || !platform || !treasury)
      return {
        ok: false,
        collectTxId: null,
        receiverAmulets: [],
        errors: ['Missing operator/platform/treasury party for Collect'],
      };

    try {
      // 1) Resolve disclosed contracts (amuletRules + openMiningRound) — sama Accept.
      const amuletRules = await this.ledger.fetchScanProxyContract('amulet-rules');
      if (!amuletRules)
        return {
          ok: false,
          collectTxId: null,
          receiverAmulets: [],
          errors: ['scan-proxy /amulet-rules failed'],
        };
      const openRound = await this.ledger.fetchScanProxyContract(
        'open-and-issuing-mining-rounds',
      );
      if (!openRound)
        return {
          ok: false,
          collectTxId: null,
          receiverAmulets: [],
          errors: ['scan-proxy /open-and-issuing-mining-rounds failed'],
        };

      // 2) AppTransferContext FLAT: { amuletRules, openMiningRound, featuredAppRight }
      //    (BUKAN nested { amuletRules, context: {...} } seperti Accept).
      //    featuredAppRight Optional → null.
      const choiceArgument = {
        context: {
          amuletRules: amuletRules.contractId,
          openMiningRound: openRound.contractId,
          featuredAppRight: null,
        },
      };

      const disclosedContracts = [
        {
          templateId: amuletRules.templateId,
          contractId: amuletRules.contractId,
          createdEventBlob: amuletRules.blob,
        },
        {
          templateId: openRound.templateId,
          contractId: openRound.contractId,
          createdEventBlob: openRound.blob,
        },
      ];

      // 3) Exercise Collect — actAs 4 party (backend pegang CanActAsAnyParty).
      const tpl = TPL.AcceptedAppPayment;
      const { ok, text } = await this.ledger.exerciseChoice(
        params.acceptedAppPaymentCid,
        tpl,
        'AcceptedAppPayment_Collect',
        choiceArgument,
        [operator, params.userPartyId, platform, treasury],
        `collect-aap-${randomUUID()}`,
        'submit-and-wait-for-transaction-tree',
        disclosedContracts,
      );

      if (!ok)
        return {
          ok: false,
          collectTxId: null,
          receiverAmulets: [],
          errors: [
            this.formatLedgerError(text, 'AcceptedAppPayment_Collect failed'),
          ],
        };

      const collectTxId = this.extractUpdateId(text);
      this.logger.log(
        `AcceptedAppPayment_Collect: user=${params.userPartyId.split('::')[0]} txId=${collectTxId?.slice(0, 16) ?? 'none'}…`,
      );
      return {
        ok: true,
        collectTxId,
        receiverAmulets: [], // receiverAmulets parse opsional (audit), skip utk now
        errors: [],
      };
    } catch (err) {
      const msg = `collectAcceptedAppPayment exception: ${String(err)}`;
      this.logger.warn(msg);
      return { ok: false, collectTxId: null, receiverAmulets: [], errors: [msg] };
    }
  }

  /**
   * B6. markSettled — exercise QuestPaymentRequest.MarkSettled.
   * Simpan collectTxId, status → SETTLED. Step terakhir fee flow.
   */
  async markSettled(params: {
    requestContractId: string; // QuestPaymentRequest cid (ACCEPTED)
    collectTxId: string;
  }): Promise<{ ok: boolean; newContractId: string | null; errors: string[] }> {
    if (!this.isClaimSessionConfigured())
      return { ok: false, newContractId: null, errors: ['Claim session ledger disabled'] };
    const tpl = this.templateId(TPL.QuestPaymentRequest);
    const operator = this.operatorPartyId;
    if (!operator)
      return { ok: false, newContractId: null, errors: ['Canton operator party not configured'] };
    const { ok, text } = await this.ledger.exerciseChoice(
      params.requestContractId,
      tpl,
      'MarkSettled',
      {
        collectTxId: params.collectTxId,
        settledAt: new Date().toISOString(),
      },
      [operator],
      `mark-settled-${randomUUID()}`,
      'submit-and-wait-for-transaction-tree',
    );
    if (ok) {
      const cids = this.extractContractIdsByTemplate(text, TPL.QuestPaymentRequest);
      return { ok: true, newContractId: cids[0] ?? null, errors: [] };
    }
    return {
      ok: false,
      newContractId: null,
      errors: [this.formatLedgerError(text, 'MarkSettled failed')],
    };
  }

  /**
   * B7. sendQuestRewardCip56 — reward delivery (platform → user) via CIP-56.
   * Reward TIDAK lewat AppPaymentRequest (arah terbalik). Thin wrapper ke
   * executeTransferFactoryTransfer dgn sender=reward wallet, receiver=user.
   * Hanya dipanggil bila rewardAmount > 0.
   */
  async sendQuestRewardCip56(params: {
    userPartyId: string;          // receiver (user dapat reward)
    rewardAmount: number;
    rewardSenderPartyId: string;  // CANTON_REWARD_PARTY_ID (sender = reward wallet)
    description?: string;
    token?: 'CC' | 'USDCx';
    instrumentId?: string;        // default 'Amulet' (CC)
    instrumentAdmin?: string;     // default CANTON_DSO_PARTY_ID
    clientNonce?: string;         // idempotency nonce (utk dedup)
  }): Promise<QuestRewardCip56Result> {
    if (!this.isClaimSessionConfigured())
      return { ok: false, updateId: null, transferKind: 'unknown', errors: ['Claim session ledger disabled'] };
    try {
      const res = await this.ledger.executeTransferFactoryTransfer({
        senderPartyId: params.rewardSenderPartyId,
        receiverPartyId: params.userPartyId,
        amountCc: params.rewardAmount,
        description: params.description ?? 'Quest reward',
        identity: 'reward',
        clientNonce: params.clientNonce,
        instrumentId: params.instrumentId ?? 'Amulet',
        instrumentAdmin: params.instrumentAdmin,
      });
      if (res.ok) {
        this.logger.log(
          `Reward CIP-56 sent: user=${params.userPartyId.split('::')[0]} amount=${params.rewardAmount} txId=${res.updateId?.slice(0, 16) ?? 'none'}… kind=${res.transferKind}`,
        );
        return {
          ok: true,
          updateId: res.updateId,
          transferKind: res.transferKind,
          errors: [],
        };
      }
      const err = res.error ?? 'executeTransferFactoryTransfer failed';
      this.logger.warn(`Reward CIP-56 fail: ${err}`);
      return { ok: false, updateId: null, transferKind: res.transferKind, errors: [err] };
    } catch (err) {
      const msg = `sendQuestRewardCip56 exception: ${String(err)}`;
      this.logger.warn(msg);
      return { ok: false, updateId: null, transferKind: 'unknown', errors: [msg] };
    }
  }



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
