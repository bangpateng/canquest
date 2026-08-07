import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { CantonLedgerService } from './canton-ledger.service';

/**
 * DAML template paths — module Main (canquest-v25, DAR yang ter-deploy di ledger)
 *
 * Templates (5 — v25):
 *   Main:WalletRegistration  — jangkar identitas on-chain (Party ID)
 *   Main:CampaignEligibility — v25: bukti eligibility (LOCK_CC / POINTS) per campaign
 *   Main:QuestCampaign       — template induk quest (6 questKind) + state machine + eligibility guard
 *   Main:QuestClaimReceipt   — bukti klaim: atomic Settle + RevealCode + RecordTxId
 *   Main:PlatformTransfer    — v25: atomic send token + platform fee
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
 * All methods are best-effort: they log errors but never throw,
 * so a Canton outage does not break the main application flow.
 */
const TPL = {
  WalletRegistration: 'Main:WalletRegistration',
  CampaignEligibility: 'Main:CampaignEligibility',   // v25
  QuestCampaign: 'Main:QuestCampaign',
  QuestClaimReceipt: 'Main:QuestClaimReceipt',
  PlatformTransfer: 'Main:PlatformTransfer',         // v25
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
    const { ok, text } = await this.ledger.exerciseChoice(
      params.campaignContractId,
      tpl,
      'ClaimSlot',
      {
        user: params.userPartyId,
        claimId: params.claimId,
        claimedAt: new Date().toISOString(),
        rewardSender: params.rewardSenderPartyId,   // v24: co-controller Settle
        eligibilityCid: params.eligibilityCid ?? null, // v25: Optional (nullable)
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
      const campaignCids = this.extractContractIdsByTemplate(text, TPL.QuestCampaign);
      const claimCids = this.extractContractIdsByTemplate(text, TPL.QuestClaimReceipt);
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
    const { ok, text } = await this.ledger.exerciseChoice(
      params.campaignContractId,
      tpl,
      'DrawWinner',
      {
        user: params.userPartyId,
        claimId: params.claimId,
        rewardCode: params.rewardCode ?? '',
        drawnAt: new Date().toISOString(),
        rewardSender: params.rewardSenderPartyId,   // v24: co-controller Settle
        eligibilityCid: params.eligibilityCid ?? null, // v25: Optional (nullable)
      },
      [operator],
      `draw-raffle-${params.claimId}-${randomUUID()}`,
    );
    if (ok) {
      // FIX: extract by templateId (bukan urutan) — sama bug dgn claimFcfsSlot.
      const campaignCids = this.extractContractIdsByTemplate(text, TPL.QuestCampaign);
      const claimCids = this.extractContractIdsByTemplate(text, TPL.QuestClaimReceipt);
      result.campaignContractId = campaignCids[0] ?? null;
      result.claimContractId = claimCids[0] ?? null;
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
