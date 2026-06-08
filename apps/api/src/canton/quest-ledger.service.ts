import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { CantonLedgerService } from './canton-ledger.service';

/**
 * DAML template paths — module Main (canquest-v6, DAR yang ter-deploy di ledger)
 *
 * Templates:
 *   Main:UserAccount        — akun user on-chain (earnedPoints & spentPoints)
 *   Main:WalletRegistration — bukti pembuatan wallet / Party ID
 *   Main:QuestCampaign      — template induk quest (6 questKind: CC_FCFS, CC_RAFFLE, CODE_FCFS, CODE_RAFFLE, CC_AND_CODE_RAFFLE, WAITLIST)
 *   Main:QuestClaim         — bukti klaim quest + confirmFee + confirmReward + revealCode
 *   Main:DailyCheckIn       — check-in harian on-chain
 *   Main:SpinExecution      — audit trail spin on-chain
 *   Main:SpinCcReward       — bukti CC reward dari spin sudah dikirim
 *   Main:ReferralReward     — bukti referral reward dikreditkan
 *   Main:CcTransactionLog   — audit trail setiap CC credit/debit event
 *
 * Authorization pattern (Canton M3):
 *   signatory admin  — operator signs all contracts
 *   observer user    — user can only read, backend submits on their behalf
 *
 * All methods are best-effort: they log errors but never throw,
 * so a Canton outage does not break the main application flow.
 */
const TPL = {
  UserAccount:        'Main:UserAccount',
  WalletRegistration: 'Main:WalletRegistration',
  QuestCampaign:      'Main:QuestCampaign',
  QuestClaim:         'Main:QuestClaim',
  DailyCheckIn:       'Main:DailyCheckIn',
  SpinExecution:      'Main:SpinExecution',
  SpinCcReward:       'Main:SpinCcReward',
  ReferralReward:     'Main:ReferralReward',
  CcTransactionLog:   'Main:CcTransactionLog',
} as const;

// ── Result types ──────────────────────────────────────────────────────────────

export interface UserAccountLedgerResult {
  ledgerEnabled: boolean;
  contractId: string | null;
  errors: string[];
}

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

export interface DailyCheckInLedgerResult {
  ledgerEnabled: boolean;
  contractId: string | null;
  errors: string[];
}

export interface SpinExecutionLedgerResult {
  ledgerEnabled: boolean;
  spinExecutionContractId: string | null;
  errors: string[];
}

export interface MissionClaimLedgerResult {
  ledgerEnabled: boolean;
  missionContractId: string | null;
  accountContractId: string | null;
  errors: string[];
}

export interface SpinLedgerResult {
  ledgerEnabled: boolean;
  contractId: string | null;
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
export class QuestLedgerService {
  private readonly logger = new Logger(QuestLedgerService.name);
  private operatorFallbackWarned = false;

  constructor(
    private readonly ledger: CantonLedgerService,
    private readonly config: ConfigService,
  ) {}

  // ── Type helpers — Canton JSON API v2 serialization ─────────────────────────

  /**
   * Canton JSON API v2 requires DAML Decimal fields to be sent as strings.
   * e.g. rewardCc: 10.0 → "10.0", claimFeeCc: 0.0 → "0.0"
   * Int fields stay as JS numbers. Bool fields stay as JS booleans.
   * See: https://docs.canton.network/appdev/modules/m4-json-api-tutorial
   */
  private dec(value: number): string {
    // Always include at least one decimal place for DAML Decimal type
    return Number.isInteger(value) ? `${value}.0` : String(value);
  }

  // ── Config helpers ──────────────────────────────────────────────────────────

  private get damlPackageRef(): string {
    const name = this.config.get<string>('CANTON_DAML_PACKAGE_NAME')?.trim();
    if (name) return name.startsWith('#') ? name : `#${name}`;
    return '#canquest-v7';
  }

  private get operatorPartyId(): string | null {
    const dedicated = this.config.get<string>('CANTON_OPERATOR_PARTY_ID')?.trim();
    if (dedicated) return dedicated;
    const validator = this.config.get<string>('CANTON_VALIDATOR_PARTY_ID')?.trim();
    if (validator && !this.operatorFallbackWarned) {
      this.operatorFallbackWarned = true;
      this.logger.warn(
        'CANTON_OPERATOR_PARTY_ID unset — DAML uses CANTON_VALIDATOR_PARTY_ID as fallback.',
      );
    }
    return validator ?? null;
  }

  private templateId(suffix: (typeof TPL)[keyof typeof TPL]): string {
    const packageId = this.config.get<string>('CANTON_DAML_PACKAGE_ID')?.trim();
    if (packageId) {
      // Canton JSON API v2 requires full package hash, not package name
      return `${packageId}:${suffix}`;
    }
    // Fallback: use package name ref (may resolve to wrong version)
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
        if (Array.isArray(cur)) { stack.push(...cur); continue; }
        const obj = cur as Record<string, unknown>;
        const args =
          (obj.createArgument as Record<string, unknown> | undefined) ??
          ((obj.CreatedTreeEvent as Record<string, unknown> | undefined)?.createArgument as Record<string, unknown> | undefined) ??
          ((obj.CreatedEvent as Record<string, unknown> | undefined)?.createArgument as Record<string, unknown> | undefined);
        const cid =
          typeof obj.contractId === 'string' ? obj.contractId :
          typeof (obj.CreatedTreeEvent as Record<string, unknown> | undefined)?.contractId === 'string'
            ? ((obj.CreatedTreeEvent as Record<string, unknown>).contractId as string)
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
          // Tuple return from exercise: [CampaignCid, ClaimCid]
          // Push in reverse order so we process left-to-right
          for (let i = cur.length - 1; i >= 0; i--) stack.push(cur[i]);
          continue;
        }
        const obj = cur as Record<string, unknown>;
        const cid = typeof obj.contractId === 'string' ? obj.contractId : null;
        // For exercise responses, search deeper for CreatedTreeEvent/CreatedEvent wrappers
        if (cid && !seen.has(cid)) {
          // Check if this is a contractId we care about (not updateId etc)
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
    } catch { /* ignore parse errors */ }
    return cids;
  }

  // ── 1. UserAccount ──────────────────────────────────────────────────────────

  /**
   * Create a UserAccount contract on the ledger.
   * Idempotent: returns existing contract if already created for this user.
   * Called when user registers and creates their wallet.
   */
  async ensureUserAccount(params: {
    userPartyId: string;
    username: string;
  }): Promise<UserAccountLedgerResult> {
    const result: UserAccountLedgerResult = {
      ledgerEnabled: false,
      contractId: null,
      errors: [],
    };
    if (!this.isConfigured()) return result;

    const tpl = this.templateId(TPL.UserAccount);
    const operator = this.operatorPartyId;
    if (!operator) {
      result.errors.push('Canton operator party not configured');
      return result;
    }
    const reachErr = await this.ensureReachable();
    if (reachErr) { result.errors.push(reachErr); return result; }

    result.ledgerEnabled = true;

    await this.ledger.grantUserRights(operator).catch((err) =>
      this.logger.warn(`grantUserRights(operator) failed: ${String(err)}`),
    );

    // Idempotency: check if account already exists
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
        admin:        operator,
        userAddress:  params.userPartyId,
        username:     params.username,
        earnedPoints: 0,
        spentPoints:  0,
        createdAt:    new Date().toISOString(),
      },
      [operator],
      `user-account-${params.username}-${randomUUID()}`,
    );

    if (res.ok && res.contractId) {
      this.logger.log(`UserAccount created: @${params.username} → ${params.userPartyId.split('::')[0]}`);
      result.contractId = res.contractId;
    } else {
      result.errors.push(this.formatLedgerError(res.error, 'Failed to create UserAccount'));
    }
    return result;
  }

  /**
   * Add points to a UserAccount by exercising RewardPoints choice.
   * Called after: quest completion, spin win, daily check-in, referral.
   */
  async rewardUser(params: {
    accountContractId: string;
    pointsToAdd: number;
    reason: string;
  }): Promise<{ ok: boolean; newContractId: string | null; errors: string[] }> {
    if (!this.isConfigured()) {
      return { ok: false, newContractId: null, errors: ['Quest ledger disabled'] };
    }
    const tpl = this.templateId(TPL.UserAccount);
    const operator = this.operatorPartyId;
    if (!operator) {
      return { ok: false, newContractId: null, errors: ['Canton operator party not configured'] };
    }

    const { ok, text } = await this.ledger.exerciseChoice(
      params.accountContractId,
      tpl,
      'RewardPoints',
      {
        pointsToAdd: params.pointsToAdd,
        reason:      params.reason || 'quest_completion',
      },
      [operator],
      `reward-points-${randomUUID()}`,
    );

    if (ok) {
      const cids = this.extractContractIds(text);
      this.logger.log(`RewardPoints: +${params.pointsToAdd} pts on ${params.accountContractId.slice(0, 12)}...`);
      return { ok: true, newContractId: cids[0] ?? null, errors: [] };
    }
    return { ok: false, newContractId: null, errors: [text.slice(0, 200)] };
  }

  /**
   * Debit points from a UserAccount by exercising DebitPoints choice.
   * Called before spin execution to deduct spin cost.
   */
  async debitPoints(params: {
    accountContractId: string;
    amount: number;
    reason: string;
  }): Promise<{ ok: boolean; newContractId: string | null; errors: string[] }> {
    if (!this.isConfigured()) {
      return { ok: false, newContractId: null, errors: ['Quest ledger disabled'] };
    }
    const tpl = this.templateId(TPL.UserAccount);
    const operator = this.operatorPartyId;
    if (!operator) {
      return { ok: false, newContractId: null, errors: ['Canton operator party not configured'] };
    }

    const { ok, text } = await this.ledger.exerciseChoice(
      params.accountContractId,
      tpl,
      'DebitPoints',
      {
        amount: params.amount,
        reason: params.reason || 'spin_cost',
      },
      [operator],
      `debit-points-${randomUUID()}`,
    );

    if (ok) {
      const cids = this.extractContractIds(text);
      this.logger.log(`DebitPoints: -${params.amount} pts on ${params.accountContractId.slice(0, 12)}...`);
      return { ok: true, newContractId: cids[0] ?? null, errors: [] };
    }
    return { ok: false, newContractId: null, errors: [text.slice(0, 200)] };
  }

  // ── 2. WalletRegistration ───────────────────────────────────────────────────

  /**
   * Register a wallet on the ledger.
   * Called when user submits their Party ID (from admin invite code) in Wallet menu.
   * Idempotent: returns existing contract if already registered.
   */
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
    if (reachErr) { result.errors.push(reachErr); return result; }

    result.ledgerEnabled = true;

    await this.ledger.grantUserRights(operator).catch((err) =>
      this.logger.warn(`grantUserRights(operator) failed: ${String(err)}`),
    );

    // Idempotency: check if wallet already registered
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
        admin:        operator,
        userAddress:  params.userPartyId,
        username:     params.username,
        partyId:      params.partyId,
        inviteCode:   params.inviteCode,
        registeredAt: new Date().toISOString(),
        confirmedAt:  null,
      },
      [operator],
      `wallet-reg-${params.username}-${randomUUID()}`,
    );

    if (res.ok && res.contractId) {
      this.logger.log(`WalletRegistration created: @${params.username} partyId=${params.partyId.split('::')[0]}`);
      result.contractId = res.contractId;
    } else {
      result.errors.push(this.formatLedgerError(res.error, 'Failed to create WalletRegistration'));
    }
    return result;
  }

  /**
   * Confirm wallet is active on Canton Network.
   * Called after wallet is verified.
   */
  async confirmWalletActive(params: {
    walletContractId: string;
  }): Promise<{ ok: boolean; newContractId: string | null; errors: string[] }> {
    if (!this.isConfigured()) {
      return { ok: false, newContractId: null, errors: ['Quest ledger disabled'] };
    }
    const tpl = this.templateId(TPL.WalletRegistration);
    const operator = this.operatorPartyId;
    if (!operator) {
      return { ok: false, newContractId: null, errors: ['Canton operator party not configured'] };
    }

    const { ok, text } = await this.ledger.exerciseChoice(
      params.walletContractId,
      tpl,
      'ConfirmWalletActive',
      { confirmedAt: new Date().toISOString() },
      [operator],
      `confirm-wallet-${randomUUID()}`,
    );

    if (ok) {
      const cids = this.extractContractIds(text);
      this.logger.log(`WalletRegistration confirmed: ${params.walletContractId.slice(0, 12)}...`);
      return { ok: true, newContractId: cids[0] ?? null, errors: [] };
    }
    return { ok: false, newContractId: null, errors: [text.slice(0, 200)] };
  }

  // ── 3. QuestCampaign ────────────────────────────────────────────────────────

  /**
   * Map backend RewardType → DAML questKind string.
   * CC_ONLY / CC_MANUAL     → "CC_FCFS" / "CC_RAFFLE"
   * INVITE_CODE_FCFS        → "CODE_FCFS"
   * INVITE_CODE_RANDOM      → "CODE_RAFFLE"
   * CC_AND_CODE_RAFFLE      → "CC_AND_CODE_RAFFLE"
   * WAITLIST_EMAIL          → "WAITLIST"
   * CC_AND_INVITE           → "CC_FCFS" (auto-assign, no on-chain fee)
   */
  static mapRewardTypeToQuestKind(
    rewardType: string,
    hasFcfsSlots: boolean,
  ): 'CC_FCFS' | 'CC_RAFFLE' | 'CODE_FCFS' | 'CODE_RAFFLE' | 'CC_AND_CODE_RAFFLE' | 'WAITLIST' {
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

  /**
   * Create a QuestCampaign contract on the ledger.
   * Called by admin when creating a new quest campaign.
   * Supports all 6 questKind values: CC_FCFS, CC_RAFFLE, CODE_FCFS,
   * CODE_RAFFLE, CC_AND_CODE_RAFFLE, WAITLIST.
   */
  async createQuestCampaign(params: {
    campaignId: string;
    title: string;
    questKind: 'CC_FCFS' | 'CC_RAFFLE' | 'CODE_FCFS' | 'CODE_RAFFLE' | 'CC_AND_CODE_RAFFLE' | 'WAITLIST';
    rewardCc: number;
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
    if (reachErr) { result.errors.push(reachErr); return result; }

    result.ledgerEnabled = true;

    const res = await this.ledger.createContract(
      tpl,
      {
        admin:         operator,
        campaignId:    params.campaignId,
        title:         params.title,
        questKind:     params.questKind,
        rewardCc:      this.dec(params.rewardCc),
        claimFeeCc:    this.dec(params.claimFeeCc),
        maxWinners:    params.maxWinners,
        currentClaims: 0,
        status:        'ACTIVE',
        createdAt:     new Date().toISOString(),
      },
      [operator],
      `quest-campaign-${params.campaignId}`,
    );

    if (res.ok && res.contractId) {
      this.logger.log(`QuestCampaign created: ${params.campaignId} kind=${params.questKind} quota=${params.maxWinners}`);
      result.contractId = res.contractId;
    } else {
      result.errors.push(this.formatLedgerError(res.error, 'Failed to create QuestCampaign'));
    }
    return result;
  }

  /**
   * Claim a FCFS slot by exercising ClaimFcfsSlot choice.
   * The DAML contract enforces quota — if full, the ledger rejects the tx.
   * Used for CC_FCFS and CODE_FCFS quest types.
   */
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
    if (reachErr) { result.errors.push(reachErr); return result; }

    result.ledgerEnabled = true;

    const { ok, text } = await this.ledger.exerciseChoice(
      params.campaignContractId,
      tpl,
      'ClaimFcfsSlot',
      {
        user:      params.userPartyId,
        claimId:   params.claimId,
        claimedAt: new Date().toISOString(),
      },
      [operator],
      `claim-fcfs-${params.claimId}-${randomUUID()}`,
    );

    if (ok) {
      const cids = this.extractContractIds(text);
      // ClaimFcfsSlot returns (ContractId QuestCampaign, ContractId QuestClaim)
      // Canton JSON API v2 wraps tuple results — extract all unique contract IDs
      // cids[0] = new QuestCampaign, cids[1] = new QuestClaim
      // If only 1 cid found, it might be the claim (campaign update creates new cid)
      result.campaignContractId = cids.length >= 2 ? (cids[0] ?? null) : null;
      result.claimContractId    = cids.length >= 2 ? (cids[1] ?? null) : (cids[0] ?? null);
      this.logger.log(
        `ClaimFcfsSlot: user=${params.userPartyId.split('::')[0]} campaign=${params.campaignContractId.slice(0, 12)}... claim=${result.claimContractId?.slice(0, 12) ?? 'none'}`,
      );
    } else {
      result.errors.push(this.formatLedgerError(text, 'ClaimFcfsSlot failed (quota full or ledger error)'));
    }
    return result;
  }

  /**
   * Draw a raffle winner by exercising DrawRaffleWinner choice.
   * Called by admin after raffle event ends.
   * Used for CC_RAFFLE and CODE_RAFFLE quest types.
   */
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
    if (reachErr) { result.errors.push(reachErr); return result; }

    result.ledgerEnabled = true;

    const { ok, text } = await this.ledger.exerciseChoice(
      params.campaignContractId,
      tpl,
      'DrawRaffleWinner',
      {
        user:       params.userPartyId,
        claimId:    params.claimId,
        rewardCode: params.rewardCode ?? '',
        drawnAt:    new Date().toISOString(),
      },
      [operator],
      `draw-raffle-${params.claimId}-${randomUUID()}`,
    );

    if (ok) {
      const cids = this.extractContractIds(text);
      result.campaignContractId = cids[0] ?? null;
      result.claimContractId    = cids[1] ?? null;
      this.logger.log(
        `DrawRaffleWinner: user=${params.userPartyId.split('::')[0]} campaign=${params.campaignContractId.slice(0, 12)}...`,
      );
    } else {
      result.errors.push(this.formatLedgerError(text, 'DrawRaffleWinner failed'));
    }
    return result;
  }

  // ── 4. QuestClaim ───────────────────────────────────────────────────────────

  /**
   * Confirm fee CC has been received from user.
   * Called after Splice TX fee is confirmed.
   * MUST be called before confirmRewardSent.
   */
  async confirmFeePaid(params: {
    claimContractId: string;
    feeTxId: string;
  }): Promise<{ ok: boolean; newContractId: string | null; errors: string[] }> {
    if (!this.isClaimSessionConfigured()) {
      return { ok: false, newContractId: null, errors: ['Claim session ledger disabled'] };
    }
    const tpl = this.templateId(TPL.QuestClaim);
    const operator = this.operatorPartyId;
    if (!operator) {
      return { ok: false, newContractId: null, errors: ['Canton operator party not configured'] };
    }

    const { ok, text } = await this.ledger.exerciseChoice(
      params.claimContractId,
      tpl,
      'ConfirmFeePaid',
      {
        txId:        params.feeTxId,
        confirmedAt: new Date().toISOString(),
      },
      [operator],
      `confirm-fee-${randomUUID()}`,
    );

    if (ok) {
      const cids = this.extractContractIds(text);
      this.logger.log(`ConfirmFeePaid: claim=${params.claimContractId.slice(0, 12)}... feeTx=${params.feeTxId.slice(0, 16)}`);
      return { ok: true, newContractId: cids[0] ?? null, errors: [] };
    }
    return { ok: false, newContractId: null, errors: [text.slice(0, 200)] };
  }

  /**
   * Confirm reward has been sent to user.
   * Called after Splice TX reward is confirmed.
   * Fee must be paid first (enforced by DAML contract).
   */
  async confirmRewardSent(params: {
    claimContractId: string;
    rewardTxId: string;
  }): Promise<{ ok: boolean; newContractId: string | null; errors: string[] }> {
    if (!this.isClaimSessionConfigured()) {
      return { ok: false, newContractId: null, errors: ['Claim session ledger disabled'] };
    }
    const tpl = this.templateId(TPL.QuestClaim);
    const operator = this.operatorPartyId;
    if (!operator) {
      return { ok: false, newContractId: null, errors: ['Canton operator party not configured'] };
    }

    const { ok, text } = await this.ledger.exerciseChoice(
      params.claimContractId,
      tpl,
      'ConfirmRewardSent',
      {
        txId:   params.rewardTxId,
        sentAt: new Date().toISOString(),
      },
      [operator],
      `confirm-reward-${randomUUID()}`,
    );

    if (ok) {
      const cids = this.extractContractIds(text);
      this.logger.log(`ConfirmRewardSent: claim=${params.claimContractId.slice(0, 12)}... rewardTx=${params.rewardTxId.slice(0, 16)}`);
      return { ok: true, newContractId: cids[0] ?? null, errors: [] };
    }
    return { ok: false, newContractId: null, errors: [text.slice(0, 200)] };
  }

  // ── 5. DailyCheckIn ─────────────────────────────────────────────────────────

  /**
   * Record a daily check-in on the ledger.
   * checkInId = "{userId}_{YYYY-MM-DD}" — unique per user per day.
   * Idempotency is checked at API level before calling this.
   */
  async recordDailyCheckIn(params: {
    userPartyId: string;
    username: string;
    userId: string;
    checkInDate: string;   // "YYYY-MM-DD"
    pointsAwarded: number;
    streakCount: number;
  }): Promise<DailyCheckInLedgerResult> {
    const result: DailyCheckInLedgerResult = {
      ledgerEnabled: false,
      contractId: null,
      errors: [],
    };
    if (!this.isClaimSessionConfigured()) return result;

    const tpl = this.templateId(TPL.DailyCheckIn);
    const operator = this.operatorPartyId;
    if (!operator) {
      result.errors.push('Canton operator party not configured');
      return result;
    }
    const reachErr = await this.ensureReachable();
    if (reachErr) { result.errors.push(reachErr); return result; }

    result.ledgerEnabled = true;

    const checkInId = `${params.userId}_${params.checkInDate}`;

    // Idempotency: check if check-in already recorded for this user+date
    const existing = this.findContractId(
      await this.ledger.queryActiveContracts(tpl, [operator]),
      (args) => args.checkInId === checkInId,
    );
    if (existing) {
      result.contractId = existing;
      return result;
    }

    const res = await this.ledger.createContract(
      tpl,
      {
        admin:         operator,
        userAddress:   params.userPartyId,
        username:      params.username,
        checkInId,
        checkInDate:   params.checkInDate,
        pointsAwarded: params.pointsAwarded,
        streakCount:   params.streakCount,
        checkedInAt:   new Date().toISOString(),
      },
      [operator],
      `daily-checkin-${checkInId}-${randomUUID()}`,
    );

    if (res.ok && res.contractId) {
      this.logger.log(`DailyCheckIn recorded: @${params.username} date=${params.checkInDate} streak=${params.streakCount}`);
      result.contractId = res.contractId;
    } else {
      result.errors.push(this.formatLedgerError(res.error, 'Failed to record DailyCheckIn'));
    }
    return result;
  }

  // ── 6. SpinExecution ────────────────────────────────────────────────────────

  /**
   * Record a spin execution on the ledger.
   * Creates a SpinExecution contract as on-chain audit trail.
   * spinResultId is unique per spin (from DB) — prevents double-spend.
   */
  async recordSpinExecution(params: {
    userPartyId:   string;
    username:      string;
    spinResultId:  string;
    spinItemId:    string;
    spinItemLabel: string;
    rewardType:    string;
    rewardCc:      number;
    rewardPoints:  number;
    spinCost:      number;
    executedAt:    string;
    accountContractId?: string | null;
  }): Promise<SpinExecutionLedgerResult> {
    const result: SpinExecutionLedgerResult = {
      ledgerEnabled: false,
      spinExecutionContractId: null,
      errors: [],
    };
    if (!this.isClaimSessionConfigured()) return result;

    const tpl = this.templateId(TPL.SpinExecution);
    const operator = this.operatorPartyId;
    if (!operator) {
      result.errors.push('Canton operator party not configured');
      return result;
    }
    const reachErr = await this.ensureReachable();
    if (reachErr) { result.errors.push(reachErr); return result; }

    result.ledgerEnabled = true;

    await this.ledger.grantUserRights(operator).catch((err) =>
      this.logger.warn(`grantUserRights(operator) failed: ${String(err)}`),
    );

    const res = await this.ledger.createContract(
      tpl,
      {
        admin:         operator,
        userAddress:   params.userPartyId,
        username:      params.username,
        spinResultId:  params.spinResultId,
        spinItemId:    params.spinItemId,
        spinItemLabel: params.spinItemLabel,
        rewardType:    params.rewardType,
        rewardCc:      this.dec(params.rewardCc),
        rewardPoints:  params.rewardPoints,
        spinCost:      params.spinCost,
        executedAt:    params.executedAt,
      },
      [operator],
      `spin-exec-${params.spinResultId}`,
    );

    if (res.ok && res.contractId) {
      this.logger.log(
        `SpinExecution recorded: @${params.username} item="${params.spinItemLabel}" type=${params.rewardType} spinResultId=${params.spinResultId.slice(0, 8)}`,
      );
      result.spinExecutionContractId = res.contractId;
    } else {
      result.errors.push(this.formatLedgerError(res.error, 'Failed to record SpinExecution'));
    }
    return result;
  }

  /**
   * Confirm CC reward from spin has been delivered.
   * Called after BullMQ job successfully sends CC via Splice.
   * Creates SpinCcReward contract as permanent audit trail.
   */
  async confirmSpinCcDelivered(params: {
    spinExecutionContractId: string;
    spliceTxId: string;
  }): Promise<{ ok: boolean; ccRewardContractId: string | null; errors: string[] }> {
    if (!this.isClaimSessionConfigured()) {
      return { ok: true, ccRewardContractId: null, errors: [] };
    }
    const tpl = this.templateId(TPL.SpinExecution);
    const operator = this.operatorPartyId;
    if (!operator) {
      return { ok: false, ccRewardContractId: null, errors: ['Canton operator party not configured'] };
    }

    const { ok, text } = await this.ledger.exerciseChoice(
      params.spinExecutionContractId,
      tpl,
      'ConfirmCcDelivered',
      {
        spliceTxId:  params.spliceTxId,
        deliveredAt: new Date().toISOString(),
      },
      [operator],
      `confirm-spin-cc-${randomUUID()}`,
    );

    if (ok) {
      const cids = this.extractContractIds(text);
      this.logger.log(
        `SpinCcReward confirmed: spinExec=${params.spinExecutionContractId.slice(0, 12)}... spliceTx=${params.spliceTxId.slice(0, 16)}`,
      );
      return { ok: true, ccRewardContractId: cids[0] ?? null, errors: [] };
    }
    return { ok: false, ccRewardContractId: null, errors: [text.slice(0, 200)] };
  }

  // ── Legacy: Mission (FCFS) — maps to QuestCampaign ─────────────────────────

  /**
   * Create a Mission contract on the ledger.
   * @deprecated Use createQuestCampaign() instead.
   * Kept for backward compatibility with existing admin flows.
   */
  async createMission(params: {
    missionId: string;
    rewardPoints: number;
    maxQuota: number;
  }): Promise<{ contractId: string | null; error?: string }> {
    const result = await this.createQuestCampaign({
      campaignId:  params.missionId,
      title:       `Mission ${params.missionId}`,
      questKind:   'CC_FCFS',
      rewardCc:    0,
      claimFeeCc:  0,
      maxWinners:  params.maxQuota,
    });
    if (result.contractId) return { contractId: result.contractId };
    return { contractId: null, error: result.errors.join(' | ') };
  }

  /**
   * Claim a Mission FCFS slot.
   * @deprecated Use claimFcfsSlot() instead.
   * Kept for backward compatibility with existing quest flows.
   */
  async claimMission(params: {
    missionContractId: string;
    userPartyId: string;
    accountContractId: string;
  }): Promise<MissionClaimLedgerResult> {
    const result: MissionClaimLedgerResult = {
      ledgerEnabled: false,
      missionContractId: null,
      accountContractId: null,
      errors: [],
    };

    const claimResult = await this.claimFcfsSlot({
      campaignContractId: params.missionContractId,
      userPartyId:        params.userPartyId,
      claimId:            `mission-claim-${randomUUID()}`,
    });

    result.ledgerEnabled      = claimResult.ledgerEnabled;
    result.missionContractId  = claimResult.campaignContractId;
    result.accountContractId  = claimResult.claimContractId;
    result.errors             = claimResult.errors;
    return result;
  }

  // ── Legacy stubs (kept for backward compatibility) ──────────────────────────

  /** @deprecated Use ensureUserAccount() instead */
  async ensureParticipation(params: {
    questId: string;
    questKind: string;
    userPartyId: string;
  }): Promise<{ contractId: string | null; error?: string }> {
    this.logger.warn(`ensureParticipation() called for quest=${params.questId} — use ensureUserAccount()`);
    return { contractId: null };
  }

  /** @deprecated Use claimFcfsSlot() or drawRaffleWinner() instead */
  async createClaimSession(params: {
    questId: string;
    userPartyId: string;
    claimKind: string;
    feeCc: number;
    rewardCc: number;
  }): Promise<ClaimSessionLedgerResult> {
    this.logger.warn(`createClaimSession() called for quest=${params.questId} — use claimFcfsSlot()`);
    return { ledgerEnabled: false, sessionContractId: null, errors: [] };
  }

  /** @deprecated — no-op stub */
  async createEarnClaimSession(params: {
    questId?: string;
    campaignId?: string;
    userPartyId: string;
    [key: string]: unknown;
  }): Promise<{ contractId: string | null; error?: string }> {
    return { contractId: null };
  }

  /** @deprecated — no-op stub */
  async createFcfsSlotReservation(params: {
    questId?: string;
    campaignId?: string;
    userPartyId: string;
    [key: string]: unknown;
  }): Promise<{ contractId: string | null; error?: string }> {
    return { contractId: null };
  }

  /** @deprecated — no-op stub */
  async createCcRewardEntitlement(params: {
    questId?: string;
    campaignId?: string;
    userPartyId: string;
    [key: string]: unknown;
  }): Promise<{ contractId: string | null; error?: string }> {
    return { contractId: null };
  }

  /** @deprecated — no-op stub */
  async createCodeRewardEntitlement(params: {
    questId?: string;
    campaignId?: string;
    userPartyId: string;
    [key: string]: unknown;
  }): Promise<{ contractId: string | null; error?: string }> {
    return { contractId: null };
  }

  /**
   * Record wallet registration on the DAML ledger.
   * Creates both WalletRegistration AND UserAccount contracts (idempotent).
   * Called from party.controller.ts after wallet is successfully created.
   *
   * Per DAML contract (canquest-v6):
   *   - WalletRegistration: bukti on-chain bahwa user telah membuat wallet
   *   - UserAccount: akun user on-chain (earnedPoints & spentPoints)
   * Both are created together when a wallet is first registered.
   */
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

    // 1. Create WalletRegistration contract
    const walletResult = await this.registerWallet({
      userPartyId: params.userPartyId,
      username:    resolvedUsername,
      partyId:     params.userPartyId,
      inviteCode:  params.inviteCode ?? '',
    });

    // 2. Create UserAccount contract (idempotent — skips if already exists)
    const accountResult = await this.ensureUserAccount({
      userPartyId: params.userPartyId,
      username:    resolvedUsername,
    });

    const errors = [...walletResult.errors, ...accountResult.errors];
    const ok = !!walletResult.contractId || !!accountResult.contractId;

    if (walletResult.contractId) {
      this.logger.log(
        `recordPartyRegistration: WalletRegistration=${walletResult.contractId.slice(0, 12)}... UserAccount=${accountResult.contractId?.slice(0, 12) ?? 'skipped'}...`,
      );
    }

    return {
      ok,
      contractId: walletResult.contractId,
      errors,
    };
  }

  /** @deprecated — no-op stub */
  async recordCcTransfer(params: {
    senderPartyId?: string;
    receiverPartyId?: string;
    amount?: number;
    txId?: string;
    [key: string]: unknown;
  }): Promise<{ ok: boolean; contractId: string | null; errors: string[] }> {
    return { ok: true, contractId: null, errors: [] };
  }

  /** @deprecated Use drawRaffleWinner() instead */
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

  /** @deprecated Use confirmFeePaid() instead */
  async markEarnClaimFeePaid(params: {
    sessionContractId: string;
    feeTxId: string;
  }): Promise<{ ok: boolean; errors: string[] }> {
    const result = await this.confirmFeePaid({
      claimContractId: params.sessionContractId,
      feeTxId:         params.feeTxId,
    });
    return { ok: result.ok, errors: result.errors };
  }

  /** @deprecated Use confirmRewardSent() instead */
  async markEarnClaimRewardSent(params: {
    sessionContractId: string;
    rewardTxId: string;
  }): Promise<{ ok: boolean; errors: string[] }> {
    const result = await this.confirmRewardSent({
      claimContractId: params.sessionContractId,
      rewardTxId:      params.rewardTxId,
    });
    return { ok: result.ok, errors: result.errors };
  }

  /** @deprecated Use confirmFeePaid() instead */
  async markClaimFeePaid(params: {
    sessionContractId: string;
    feeTxId: string;
  }): Promise<{ ok: boolean; errors: string[] }> {
    return this.markEarnClaimFeePaid(params);
  }

  /** @deprecated Use confirmRewardSent() instead */
  async markClaimRewardSent(params: {
    sessionContractId: string;
    rewardTxId: string;
  }): Promise<{ ok: boolean; errors: string[] }> {
    return this.markEarnClaimRewardSent({ sessionContractId: params.sessionContractId, rewardTxId: params.rewardTxId });
  }

  /** @deprecated — no-op stub */
  async markRewardClaimed(params: {
    rewardContractId: string;
    payoutTxId: string;
  }): Promise<{ ok: boolean; errors: string[] }> {
    return { ok: true, errors: [] };
  }

  /** @deprecated Use ensureUserAccount() + rewardUser() instead */
  async recordQuestCompletion(params: {
    questId: string;
    questKind: string;
    questTitle: string;
    rewardCc: number;
    userPartyId: string;
    taskIds: string[];
    proofs: Array<{ taskId: string; taskType: string; proof: string | null }>;
  }): Promise<QuestLedgerSubmitResult> {
    this.logger.warn(`recordQuestCompletion() called for quest=${params.questId} — use ensureUserAccount() + rewardUser()`);
    return {
      ledgerEnabled: false,
      participationContractId: null,
      completionContractId: null,
      rewardContractId: null,
      taskSubmissionIds: [],
      errors: [],
    };
  }

  /**
   * @deprecated — no-op stub (canquest-v6 tidak punya QuestTaskSubmission template).
   * Task submission tidak perlu on-chain — hanya quest claim yang perlu.
   * Tidak ada WARN log agar tidak spam.
   */
  async recordTaskSubmission(params: {
    questId: string;
    questKind: string;
    taskId: string;
    taskType: string;
    proof: string | null;
    userPartyId: string;
  }): Promise<QuestTaskLedgerResult> {
    // canquest-v6: task submission tidak dicatat on-chain (hanya quest claim)
    // Ini intentional — tidak perlu WARN
    return {
      ledgerEnabled: false,
      participationContractId: null,
      taskSubmissionContractId: null,
      errors: [],
    };
  }

  // ── 7. QuestClaim: RevealRewardCode ─────────────────────────────────────────

  /**
   * Reveal invite code on a QuestClaim contract.
   * Called after fee is confirmed for CODE_FCFS / CODE_RAFFLE / CC_AND_CODE_RAFFLE.
   * The code is stored on-chain so user can always retrieve it.
   */
  async revealRewardCode(params: {
    claimContractId: string;
    code: string;
  }): Promise<{ ok: boolean; newContractId: string | null; errors: string[] }> {
    if (!this.isClaimSessionConfigured()) {
      return { ok: false, newContractId: null, errors: ['Claim session ledger disabled'] };
    }
    const tpl = this.templateId(TPL.QuestClaim);
    const operator = this.operatorPartyId;
    if (!operator) {
      return { ok: false, newContractId: null, errors: ['Canton operator party not configured'] };
    }

    const { ok, text } = await this.ledger.exerciseChoice(
      params.claimContractId,
      tpl,
      'RevealRewardCode',
      {
        code:       params.code,
        revealedAt: new Date().toISOString(),
      },
      [operator],
      `reveal-code-${randomUUID()}`,
    );

    if (ok) {
      const cids = this.extractContractIds(text);
      this.logger.log(`RevealRewardCode: claim=${params.claimContractId.slice(0, 12)}... code=${params.code.slice(0, 8)}...`);
      return { ok: true, newContractId: cids[0] ?? null, errors: [] };
    }
    return { ok: false, newContractId: null, errors: [text.slice(0, 200)] };
  }

  // ── 8. ReferralReward ────────────────────────────────────────────────────────

  /**
   * Record a referral reward on the ledger.
   * Called when a referred user successfully registers.
   * referralId = "{referrerId}_{referredUserId}" — unique per pair (idempotency).
   * referrerPartyId: Canton Party ID of the referrer (must have cantonPartyId set).
   */
  async recordReferralReward(params: {
    referrerPartyId: string;
    referrerId: string;
    referredUserId: string;
    points: number;
  }): Promise<{ ok: boolean; contractId: string | null; errors: string[] }> {
    if (!this.isClaimSessionConfigured()) {
      return { ok: false, contractId: null, errors: ['Claim session ledger disabled'] };
    }
    const tpl = this.templateId(TPL.ReferralReward);
    const operator = this.operatorPartyId;
    if (!operator) {
      return { ok: false, contractId: null, errors: ['Canton operator party not configured'] };
    }
    const reachErr = await this.ensureReachable();
    if (reachErr) return { ok: false, contractId: null, errors: [reachErr] };

    const referralId = `${params.referrerId}_${params.referredUserId}`;

    // Idempotency: check if referral already recorded
    const existing = this.findContractId(
      await this.ledger.queryActiveContracts(tpl, [operator]),
      (args) => args.referralId === referralId,
    );
    if (existing) {
      this.logger.log(`ReferralReward already exists: ${referralId}`);
      return { ok: true, contractId: existing, errors: [] };
    }

    const res = await this.ledger.createContract(
      tpl,
      {
        admin:           operator,
        referrerAddress: params.referrerPartyId,
        referrerId:      params.referrerId,
        referredUserId:  params.referredUserId,
        points:          params.points,
        referralId,
        createdAt:       new Date().toISOString(),
      },
      [operator],
      `referral-reward-${referralId}`,
    );

    if (res.ok && res.contractId) {
      this.logger.log(`ReferralReward recorded: referrer=${params.referrerId.slice(0, 8)} referred=${params.referredUserId.slice(0, 8)} pts=${params.points}`);
      return { ok: true, contractId: res.contractId, errors: [] };
    }
    return {
      ok: false,
      contractId: null,
      errors: [this.formatLedgerError(res.error, 'Failed to record ReferralReward')],
    };
  }

  // ── 9. CcTransactionLog ──────────────────────────────────────────────────────

  /**
   * Record a CC transaction event on the ledger.
   * Called for every CC credit/debit event (quest reward, spin reward, airdrop, etc).
   * txType: "QUEST_REWARD" | "SPIN_REWARD" | "TRANSFER_IN" | "TRANSFER_OUT" | "AIRDROP"
   * amountMicroCc: positive = credit, negative = debit (1 CC = 1_000_000 micro-CC).
   * Best-effort: does not block main flow if ledger is unavailable.
   */
  async recordCcTransactionLog(params: {
    userPartyId: string;
    username: string;
    txLogId: string;
    txType: 'QUEST_REWARD' | 'SPIN_REWARD' | 'TRANSFER_IN' | 'TRANSFER_OUT' | 'AIRDROP';
    amountMicroCc: number;
    description: string;
    referenceId: string;
    ledgerTxId?: string;
  }): Promise<{ ok: boolean; contractId: string | null; errors: string[] }> {
    if (!this.isClaimSessionConfigured()) {
      return { ok: false, contractId: null, errors: ['Claim session ledger disabled'] };
    }
    const tpl = this.templateId(TPL.CcTransactionLog);
    const operator = this.operatorPartyId;
    if (!operator) {
      return { ok: false, contractId: null, errors: ['Canton operator party not configured'] };
    }
    const reachErr = await this.ensureReachable();
    if (reachErr) return { ok: false, contractId: null, errors: [reachErr] };

    const res = await this.ledger.createContract(
      tpl,
      {
        admin:         operator,
        userAddress:   params.userPartyId,
        username:      params.username,
        txLogId:       params.txLogId,
        txType:        params.txType,
        amountMicroCc: params.amountMicroCc,
        description:   params.description,
        referenceId:   params.referenceId,
        ledgerTxId:    params.ledgerTxId ?? '',
        createdAt:     new Date().toISOString(),
      },
      [operator],
      `cc-tx-log-${params.txLogId}`,
    );

    if (res.ok && res.contractId) {
      this.logger.log(
        `CcTransactionLog recorded: @${params.username} type=${params.txType} amount=${params.amountMicroCc} txLogId=${params.txLogId.slice(0, 8)}`,
      );
      return { ok: true, contractId: res.contractId, errors: [] };
    }
    return {
      ok: false,
      contractId: null,
      errors: [this.formatLedgerError(res.error, 'Failed to record CcTransactionLog')],
    };
  }

  /**
   * Settle a CcTransactionLog by updating its ledger TX ID.
   * Called after CC transfer is confirmed on-chain.
   */
  async settleCcTransactionLog(params: {
    txLogContractId: string;
    txId: string;
  }): Promise<{ ok: boolean; newContractId: string | null; errors: string[] }> {
    if (!this.isClaimSessionConfigured()) {
      return { ok: false, newContractId: null, errors: ['Claim session ledger disabled'] };
    }
    const tpl = this.templateId(TPL.CcTransactionLog);
    const operator = this.operatorPartyId;
    if (!operator) {
      return { ok: false, newContractId: null, errors: ['Canton operator party not configured'] };
    }

    const { ok, text } = await this.ledger.exerciseChoice(
      params.txLogContractId,
      tpl,
      'SettleCcTransaction',
      {
        txId:      params.txId,
        settledAt: new Date().toISOString(),
      },
      [operator],
      `settle-cc-tx-${randomUUID()}`,
    );

    if (ok) {
      const cids = this.extractContractIds(text);
      this.logger.log(`CcTransactionLog settled: contract=${params.txLogContractId.slice(0, 12)}... txId=${params.txId.slice(0, 16)}`);
      return { ok: true, newContractId: cids[0] ?? null, errors: [] };
    }
    return { ok: false, newContractId: null, errors: [text.slice(0, 200)] };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /** Short human-readable snippet from Canton JSON error body. */
  private formatLedgerError(raw: string | undefined, fallback: string): string {
    if (!raw) return fallback;
    try {
      const j = JSON.parse(raw) as { code?: string; cause?: string; message?: string };
      if (j.cause)   return `${fallback}: ${j.cause}`;
      if (j.message) return `${fallback}: ${j.message}`;
      if (j.code)    return `${fallback}: ${j.code}`;
    } catch { /* use raw slice */ }
    return `${fallback}: ${raw.slice(0, 120)}`;
  }
}
