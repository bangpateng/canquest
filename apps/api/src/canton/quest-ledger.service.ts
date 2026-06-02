import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { CantonLedgerService } from './canton-ledger.service';

/**
 * DAML template paths — module Main (canquest-v2 v0.2.0)
 *
 * Contract layout (packages/daml/daml/Main.daml):
 *   Main:UserAccount     — akun user dengan poin
 *   Main:Mission         — misi FCFS dengan kuota terbatas
 *   Main:DailyLuckySpin  — spin harian (1x per hari)
 *
 * Template ID format: #<packageName>:<Module>:<Template>
 * Example: #canquest-v2:Main:UserAccount
 */
const TPL = {
  UserAccount:    'Main:UserAccount',
  Mission:        'Main:Mission',
  DailyLuckySpin: 'Main:DailyLuckySpin',
} as const;

// ── Result types ──────────────────────────────────────────────────────────────

export interface UserAccountLedgerResult {
  ledgerEnabled: boolean;
  contractId: string | null;
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

// ── Legacy result types (kept for backward compat with existing controllers) ──

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

/**
 * Records CanQuest activity on Canton via DAML templates in packages/daml/daml/Main.daml.
 *
 * Authorization pattern (Canton M3):
 *   signatory admin  — operator signs all contracts
 *   observer user    — user can only read, backend submits on their behalf
 *
 * All methods are best-effort: they log errors but never throw,
 * so a Canton outage does not break the main application flow.
 */
@Injectable()
export class QuestLedgerService {
  private readonly logger = new Logger(QuestLedgerService.name);
  private operatorFallbackWarned = false;

  constructor(
    private readonly ledger: CantonLedgerService,
    private readonly config: ConfigService,
  ) {}

  // ── Config helpers ──────────────────────────────────────────────────────────

  /**
   * Package-name template ref for Canton 3.x.
   * Uses package name (#canquest-v2) instead of hash package-id
   * because hash refs often fail ACS TemplateFilter with INVALID_FIELD on JSON API v2.
   */
  private get damlPackageRef(): string {
    const name = this.config.get<string>('CANTON_DAML_PACKAGE_NAME')?.trim();
    if (name) return name.startsWith('#') ? name : `#${name}`;
    return '#canquest-v2';
  }

  private get operatorPartyId(): string | null {
    const dedicated = this.config.get<string>('CANTON_OPERATOR_PARTY_ID')?.trim();
    if (dedicated) return dedicated;
    const validator = this.config.get<string>('CANTON_VALIDATOR_PARTY_ID')?.trim();
    if (validator && !this.operatorFallbackWarned) {
      this.operatorFallbackWarned = true;
      this.logger.warn(
        'CANTON_OPERATOR_PARTY_ID unset — DAML uses CANTON_VALIDATOR_PARTY_ID as fallback. ' +
        'Run: node scripts/ensure-quest-operator.cjs',
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

  // ── UserAccount ─────────────────────────────────────────────────────────────

  /**
   * Create a UserAccount contract on the ledger.
   * Idempotent: returns existing contract if already created for this user.
   *
   * Called when: user registers / creates wallet on CanQuest.
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
        admin:       operator,
        userAddress: params.userPartyId,
        username:    params.username,
        totalPoints: 0,
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
   * Add points to a UserAccount by exercising RewardUser choice.
   * Called after: quest completion, spin reward, mission claim.
   */
  async rewardUser(params: {
    accountContractId: string;
    pointsToAdd: number;
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
      'RewardUser',
      { pointsToAdd: params.pointsToAdd },
      [operator],
      `reward-user-${randomUUID()}`,
    );

    if (ok) {
      // Extract new contract ID from response
      let newContractId: string | null = null;
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        newContractId = (parsed.contractId as string | undefined) ?? null;
      } catch { /* ignore */ }
      this.logger.log(`RewardUser: +${params.pointsToAdd} pts on ${params.accountContractId.slice(0, 12)}...`);
      return { ok: true, newContractId, errors: [] };
    }
    return { ok: false, newContractId: null, errors: [text.slice(0, 200)] };
  }

  // ── Mission (FCFS) ──────────────────────────────────────────────────────────

  /**
   * Create a Mission contract on the ledger.
   * Called by admin when creating a new FCFS mission/campaign.
   */
  async createMission(params: {
    missionId: string;
    rewardPoints: number;
    maxQuota: number;
  }): Promise<{ contractId: string | null; error?: string }> {
    if (!this.isConfigured()) {
      return { contractId: null, error: 'Quest ledger disabled' };
    }
    const tpl = this.templateId(TPL.Mission);
    const operator = this.operatorPartyId;
    if (!operator) {
      return { contractId: null, error: 'Canton operator party not configured' };
    }
    const reachErr = await this.ensureReachable();
    if (reachErr) return { contractId: null, error: reachErr };

    const res = await this.ledger.createContract(
      tpl,
      {
        admin:         operator,
        missionId:     params.missionId,
        rewardPoints:  params.rewardPoints,
        maxQuota:      params.maxQuota,
        currentClaims: 0,
      },
      [operator],
      `mission-${params.missionId}`,
    );

    if (res.ok && res.contractId) {
      this.logger.log(`Mission created: ${params.missionId} quota=${params.maxQuota}`);
      return { contractId: res.contractId };
    }
    return { contractId: null, error: this.formatLedgerError(res.error, 'Failed to create Mission') };
  }

  /**
   * Claim a Mission FCFS slot by exercising ClaimMission choice.
   * The DAML contract enforces quota — if full, the ledger rejects the tx.
   *
   * Called when: user claims an FCFS campaign reward.
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
    if (!this.isClaimSessionConfigured()) return result;

    const tpl = this.templateId(TPL.Mission);
    const operator = this.operatorPartyId;
    if (!operator) {
      result.errors.push('Canton operator party not configured');
      return result;
    }
    const reachErr = await this.ensureReachable();
    if (reachErr) { result.errors.push(reachErr); return result; }

    result.ledgerEnabled = true;

    const { ok, text } = await this.ledger.exerciseChoice(
      params.missionContractId,
      tpl,
      'ClaimMission',
      {
        user:       params.userPartyId,
        accountCid: params.accountContractId,
      },
      [operator],
      `claim-mission-${params.missionContractId}-${randomUUID()}`,
    );

    if (ok) {
      // ClaimMission returns (ContractId Mission, ContractId UserAccount)
      // Extract both from the transaction tree response
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        const stack: unknown[] = [parsed];
        const cids: string[] = [];
        while (stack.length) {
          const cur = stack.pop();
          if (!cur || typeof cur !== 'object') continue;
          if (Array.isArray(cur)) { stack.push(...cur); continue; }
          const obj = cur as Record<string, unknown>;
          if (typeof obj.contractId === 'string') cids.push(obj.contractId);
          for (const v of Object.values(obj)) stack.push(v);
        }
        // First new contract = updated Mission, second = updated UserAccount
        result.missionContractId  = cids[0] ?? null;
        result.accountContractId  = cids[1] ?? null;
      } catch { /* ignore parse errors */ }
      this.logger.log(
        `ClaimMission: user=${params.userPartyId.split('::')[0]} mission=${params.missionContractId.slice(0, 12)}...`,
      );
    } else {
      result.errors.push(this.formatLedgerError(text, 'ClaimMission failed (quota full or ledger error)'));
    }
    return result;
  }

  // ── DailyLuckySpin ──────────────────────────────────────────────────────────

  /**
   * Create a DailyLuckySpin contract for a user.
   * Called once when user first accesses the spin feature.
   * Idempotent: returns existing contract if already created.
   */
  async ensureDailySpinContract(params: {
    userPartyId: string;
    initialDate: string; // ISO date string "YYYY-MM-DD"
  }): Promise<SpinLedgerResult> {
    const result: SpinLedgerResult = {
      ledgerEnabled: false,
      contractId: null,
      errors: [],
    };
    if (!this.isClaimSessionConfigured()) return result;

    const tpl = this.templateId(TPL.DailyLuckySpin);
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

    // Idempotency: check if spin contract already exists for this user
    const existing = this.findContractId(
      await this.ledger.queryActiveContracts(tpl, [operator]),
      (args) => args.userAddress === params.userPartyId,
    );
    if (existing) {
      result.contractId = existing;
      return result;
    }

    // Parse ISO date → DAML Date format { year, month, day }
    const [year, month, day] = params.initialDate.split('-').map(Number);

    const res = await this.ledger.createContract(
      tpl,
      {
        admin:        operator,
        userAddress:  params.userPartyId,
        // DAML Date is represented as days since epoch in JSON API
        // Use ISO string and let the ledger parse it
        lastSpinDate: { year, month, day },
      },
      [operator],
      `daily-spin-${params.userPartyId}-${randomUUID()}`,
    );

    if (res.ok && res.contractId) {
      this.logger.log(`DailyLuckySpin created: ${params.userPartyId.split('::')[0]}`);
      result.contractId = res.contractId;
    } else {
      result.errors.push(this.formatLedgerError(res.error, 'Failed to create DailyLuckySpin'));
    }
    return result;
  }

  /**
   * Execute a daily spin by exercising ExecuteSpin choice.
   * The DAML contract enforces 1-spin-per-day — if already spun today, ledger rejects.
   *
   * Called when: user clicks spin button.
   */
  async executeDailySpin(params: {
    spinContractId: string;
    accountContractId: string;
    currentDate: string; // ISO date string "YYYY-MM-DD"
    spinReward: number;
  }): Promise<SpinLedgerResult> {
    const result: SpinLedgerResult = {
      ledgerEnabled: false,
      contractId: null,
      errors: [],
    };
    if (!this.isClaimSessionConfigured()) return result;

    const tpl = this.templateId(TPL.DailyLuckySpin);
    const operator = this.operatorPartyId;
    if (!operator) {
      result.errors.push('Canton operator party not configured');
      return result;
    }
    const reachErr = await this.ensureReachable();
    if (reachErr) { result.errors.push(reachErr); return result; }

    result.ledgerEnabled = true;

    const [year, month, day] = params.currentDate.split('-').map(Number);

    const { ok, text } = await this.ledger.exerciseChoice(
      params.spinContractId,
      tpl,
      'ExecuteSpin',
      {
        currentDate: { year, month, day },
        accountCid:  params.accountContractId,
        spinReward:  params.spinReward,
      },
      [operator],
      `execute-spin-${params.spinContractId}-${randomUUID()}`,
    );

    if (ok) {
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        const stack: unknown[] = [parsed];
        while (stack.length) {
          const cur = stack.pop();
          if (!cur || typeof cur !== 'object') continue;
          if (Array.isArray(cur)) { stack.push(...cur); continue; }
          const obj = cur as Record<string, unknown>;
          if (typeof obj.contractId === 'string') {
            result.contractId = obj.contractId;
            break;
          }
          for (const v of Object.values(obj)) stack.push(v);
        }
      } catch { /* ignore */ }
      this.logger.log(
        `ExecuteSpin: +${params.spinReward} pts user=${params.spinContractId.slice(0, 12)}... date=${params.currentDate}`,
      );
    } else {
      result.errors.push(this.formatLedgerError(text, 'ExecuteSpin failed (already spun today or ledger error)'));
    }
    return result;
  }

  // ── Legacy stubs (kept for backward compatibility) ──────────────────────────
  // These methods are called by existing controllers. They now log a deprecation
  // warning and return a disabled result. Remove them once controllers are updated.

  /** @deprecated Use ensureUserAccount() instead */
  async ensureParticipation(params: {
    questId: string;
    questKind: string;
    userPartyId: string;
  }): Promise<{ contractId: string | null; error?: string }> {
    this.logger.warn(`ensureParticipation() called for quest=${params.questId} — legacy stub, no-op`);
    return { contractId: null, error: 'Legacy method: use ensureUserAccount()' };
  }

  /** @deprecated Use claimMission() instead */
  async createClaimSession(params: {
    questId: string;
    userPartyId: string;
    claimKind: string;
    feeCc: number;
    rewardCc: number;
  }): Promise<ClaimSessionLedgerResult> {
    this.logger.warn(`createClaimSession() called for quest=${params.questId} — legacy stub, no-op`);
    return { ledgerEnabled: false, sessionContractId: null, errors: ['Legacy method: use claimMission()'] };
  }

  /** @deprecated — EarnClaimSession not in canquest-v3, no-op stub */
  async createEarnClaimSession(params: {
    questId?: string;
    userPartyId: string;
    claimKind?: string;
    feeCc?: number;
    rewardCc?: number;
  }): Promise<{ contractId: string | null; error?: string }> {
    return { contractId: null };
  }

  /** @deprecated — FcfsSlotReservation not in canquest-v3, no-op stub */
  async createFcfsSlotReservation(params: {
    questId?: string;
    userPartyId: string;
    expiresAt?: string;
    slotIndex?: number;
  }): Promise<{ contractId: string | null; error?: string }> {
    return { contractId: null };
  }

  /** @deprecated — CcRewardEntitlement not in canquest-v3, no-op stub */
  async createCcRewardEntitlement(params: {
    questId?: string;
    userPartyId: string;
    rewardCc?: number;
    rewardOfferId?: string;
  }): Promise<{ contractId: string | null; error?: string }> {
    return { contractId: null };
  }

  /** @deprecated — CodeRewardEntitlement not in canquest-v3, no-op stub */
  async createCodeRewardEntitlement(params: {
    questId?: string;
    userPartyId: string;
    rewardCode?: string;
    rewardOfferId?: string;
  }): Promise<{ contractId: string | null; error?: string }> {
    return { contractId: null };
  }

  /** @deprecated — no-op stub */
  async markEarnClaimFeePaid(params: {
    sessionContractId: string;
    feeTxId: string;
  }): Promise<{ ok: boolean; errors: string[] }> {
    return { ok: true, errors: [] };
  }

  /** @deprecated — no-op stub */
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
    this.logger.warn(`markClaimFeePaid() called — legacy stub, no-op`);
    return { ok: false, errors: ['Legacy method: no ClaimSession in new contract'] };
  }

  /** @deprecated */
  async markClaimRewardSent(params: {
    sessionContractId: string;
    rewardTxId: string;
  }): Promise<{ ok: boolean; errors: string[] }> {
    this.logger.warn(`markClaimRewardSent() called — legacy stub, no-op`);
    return { ok: false, errors: ['Legacy method: no ClaimSession in new contract'] };
  }

  /** @deprecated */
  async markRewardClaimed(params: {
    rewardContractId: string;
    payoutTxId: string;
  }): Promise<{ ok: boolean; errors: string[] }> {
    this.logger.warn(`markRewardClaimed() called — legacy stub, no-op`);
    return { ok: false, errors: ['Legacy method: no QuestReward in new contract'] };
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
    this.logger.warn(`recordQuestCompletion() called for quest=${params.questId} — legacy stub, no-op`);
    return {
      ledgerEnabled: false,
      participationContractId: null,
      completionContractId: null,
      rewardContractId: null,
      taskSubmissionIds: [],
      errors: ['Legacy method: use ensureUserAccount() + rewardUser()'],
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
    this.logger.warn(`recordTaskSubmission() called — legacy stub, no-op`);
    return {
      ledgerEnabled: false,
      participationContractId: null,
      taskSubmissionContractId: null,
      errors: ['Legacy method: no QuestTaskSubmission in new contract'],
    };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /** Short human-readable snippet from Canton JSON error body. */
  private formatLedgerError(raw: string | undefined, fallback: string): string {
    if (!raw) return fallback;
    try {
      const j = JSON.parse(raw) as { code?: string; cause?: string; message?: string };
      if (j.cause)    return `${fallback}: ${j.cause}`;
      if (j.message)  return `${fallback}: ${j.message}`;
      if (j.code)     return `${fallback}: ${j.code}`;
    } catch { /* use raw slice */ }
    return `${fallback}: ${raw.slice(0, 120)}`;
  }
}
