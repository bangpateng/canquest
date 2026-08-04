import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { CantonLedgerService } from './canton-ledger.service';

/**
 * DAML template paths — module Main (canquest-v21 lean, DAR yang ter-deploy di ledger)
 *
 * Templates (3 — yang benar-benar dipakai backend):
 *   Main:WalletRegistration — jangkar identitas on-chain (Party ID)
 *   Main:QuestCampaign      — template induk quest (6 questKind) + state machine
 *   Main:QuestClaim         — bukti klaim: AtomicFeeAndReward + RevealRewardCode
 *
 * YANG TIDAK ADA ON-CHAIN (off-chain Postgres):
 *   - Poin user        → User.earnPoints + EarnEntry (backend DB)
 *   - Daily check-in   → QuestSubmission unik + cooldown 24h (backend DB)
 *   - Referral reward  → ReferralReward (backend DB)
 *   - Audit trail CC   → redundan; ledger Canton sudah audit mutlak
 *   - Spin             → feature removed (tabel di-drop)
 *
 * Authorization pattern (Canton M3):
 *   signatory admin  — operator signs all contracts
 *   observer user    — user can only read, backend submits on their behalf
 *
 * All methods are best-effort: they log errors but never throw,
 * so a Canton outage does not break the main application flow.
 */
const TPL = {
  WalletRegistration: 'Main:WalletRegistration',
  QuestCampaign: 'Main:QuestCampaign',
  QuestClaimReceipt: 'Main:QuestClaimReceipt',
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
    return '#canquest-v23';
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
        createdAt: new Date().toISOString(),
      },
      [operator],
      `quest-campaign-${params.campaignId}`,
    );
    if (res.ok && res.contractId) {
      this.logger.log(
        `QuestCampaign created: ${params.campaignId} kind=${params.questKind} quota=${params.maxWinners}`,
      );
      result.contractId = res.contractId;
    } else {
      result.errors.push(
        this.formatLedgerError(res.error, 'Failed to create QuestCampaign'),
      );
    }
    return result;
  }

  async claimFcfsSlot(params: {
    campaignContractId: string;
    userPartyId: string;
    claimId: string;
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
      },
      [operator],
      `claim-fcfs-${params.claimId}-${randomUUID()}`,
      'submit-and-wait-for-transaction-tree',
    );
    if (ok) {
      const cids = this.extractContractIds(text);
      result.campaignContractId = cids.length >= 2 ? (cids[0] ?? null) : null;
      result.claimContractId =
        cids.length >= 2 ? (cids[1] ?? null) : (cids[0] ?? null);
      this.logger.log(
        `ClaimSlot: user=${params.userPartyId.split('::')[0]} campaign=${params.campaignContractId.slice(0, 12)}... claim=${result.claimContractId?.slice(0, 12) ?? 'none'}`,
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
      },
      [operator],
      `draw-raffle-${params.claimId}-${randomUUID()}`,
    );
    if (ok) {
      const cids = this.extractContractIds(text);
      result.campaignContractId = cids[0] ?? null;
      result.claimContractId = cids[1] ?? null;
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
      // DAML Optional: Some x → { tags: 'Some', value: x }, None → null
      // ExtraArgs record butuh context + meta eksplisit (non-optional).
      // choiceContextData dari registry bisa null utk direct transfer →
      // default ke { values: {} } (pattern sama executeTransferFactoryTransfer line 597).
      const opt = <T,>(v: T | null) => (v == null ? null : { tags: 'Some', value: v });
      const safeContext = (ctx: Record<string, unknown> | null | undefined) =>
        ctx && typeof ctx === 'object' && Object.keys(ctx).length > 0 ? ctx : { values: {} };
      const feeExtraArgs = {
        context: safeContext(feeRegistry.choiceContextData),
        meta: { values: {} },
      };
      const rewardExtraArgs = rewardRegistry
        ? opt({ context: safeContext(rewardRegistry.choiceContextData), meta: { values: {} } })
        : null;
      const choiceArgument: Record<string, unknown> = {
        feeFactoryCid: feeRegistry.factoryId,
        feeTransfer,
        feeExtraArgs,
        rewardFactoryCid: rewardRegistry ? opt(rewardRegistry.factoryId) : null,
        rewardTransfer: rewardTransfer ? opt(rewardTransfer) : null,
        rewardExtraArgs,
        featuredAppRightCid: params.featuredAppRightCid ? opt(params.featuredAppRightCid) : null,
        appProvider: params.appProviderPartyId ?? '',
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
   */
  async recordTxId(params: {
    settledContractId: string;
    feeTxId: string;
    rewardTxId: string;
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
