import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { CantonLedgerService } from './canton-ledger.service';

/** DAML module paths per packages/daml/daml/CanQuest/ layout (Canton M3 building/packaging). */
const TPL = {
  QuestParticipation: 'CanQuest.Quest.Participation:QuestParticipation',
  QuestTaskSubmission: 'CanQuest.Quest.Task:QuestTaskSubmission',
  QuestReward: 'CanQuest.Quest.Reward:QuestReward',
  QuestCompletion: 'CanQuest.Quest.Completion:QuestCompletion',
  ClaimSession: 'CanQuest.Reward.ClaimSession:ClaimSession',
} as const;

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
 * Records quest/earn activity on Canton via DAML templates in packages/daml/.
 * Follows Canton M3 authorization: operator signs (signatory), user observes.
 * CIP-56 CC disbursement is handled separately by SpliceValidatorService.
 */
@Injectable()
export class QuestLedgerService {
  private readonly logger = new Logger(QuestLedgerService.name);
  private operatorFallbackWarned = false;

  constructor(
    private readonly ledger: CantonLedgerService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Package-name template ref for Canton 3.x (e.g. #canquest-v2:CanQuest.Quest.Task:QuestTaskSubmission).
   * Hash package-id refs often fail ACS TemplateFilter with INVALID_FIELD on JSON API v2.
   */
  private get damlPackageRef(): string | null {
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
        'CANTON_OPERATOR_PARTY_ID unset — DAML uses CANTON_VALIDATOR_PARTY_ID. Run: npm run quest:operator',
      );
    }
    return validator || null;
  }

  private templateId(suffix: (typeof TPL)[keyof typeof TPL]): string | null {
    const ref = this.damlPackageRef;
    return ref ? `${ref}:${suffix}` : null;
  }

  /** When false, quest ledger writes are skipped (wallet / Splice CC still works). */
  isConfigured(): boolean {
    const enabled = this.config.get<string>('QUEST_LEDGER_ENABLED');
    if (enabled === 'false' || enabled === '0') return false;
    return !!(this.damlPackageRef && this.operatorPartyId);
  }

  /** When false, claim audit skips ClaimSession DAML contract. */
  isClaimSessionConfigured(): boolean {
    const enabled = this.config.get<string>('CLAIM_SESSION_LEDGER_ENABLED');
    if (enabled === 'false' || enabled === '0') return false;
    return !!(this.damlPackageRef && this.operatorPartyId);
  }

  private async ensureReachable(): Promise<string | null> {
    const reachable = await this.ledger.isReachable();
    return reachable ? null : 'Canton JSON Ledger API unreachable';
  }

  /** Find existing contract id in ACS by matching createArgument fields. */
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
          ((obj.CreatedTreeEvent as Record<string, unknown> | undefined)?.createArgument as
            | Record<string, unknown>
            | undefined) ??
          ((obj.CreatedEvent as Record<string, unknown> | undefined)?.createArgument as
            | Record<string, unknown>
            | undefined);
        const cid =
          typeof obj.contractId === 'string'
            ? obj.contractId
            : typeof (obj.CreatedTreeEvent as Record<string, unknown> | undefined)?.contractId ===
                'string'
              ? ((obj.CreatedTreeEvent as Record<string, unknown>).contractId as string)
              : null;
        if (args && cid && match(args)) return cid;
        for (const v of Object.values(obj)) stack.push(v);
      }
    }
    return null;
  }

  /** Idempotent: create QuestParticipation or return existing (contract key: user + questId). */
  async ensureParticipation(params: {
    questId: string;
    questKind: 'EARN_HUB' | 'CAMPAIGN';
    userPartyId: string;
  }): Promise<{ contractId: string | null; error?: string }> {
    if (!this.isConfigured()) {
      return { contractId: null, error: 'Quest ledger disabled' };
    }
    const tpl = this.templateId(TPL.QuestParticipation);
    const operator = this.operatorPartyId;
    if (!tpl || !operator) {
      return { contractId: null, error: 'Canton DAML package or operator party not configured' };
    }
    const reachErr = await this.ensureReachable();
    if (reachErr) return { contractId: null, error: reachErr };

    await this.ledger.grantUserRights(operator).catch((err) =>
      this.logger.warn(`grantUserRights(operator) failed: ${String(err)}`),
    );

    const existing = this.findContractId(
      await this.ledger.queryActiveContracts(tpl, [operator]),
      (args) =>
        args.user === params.userPartyId &&
        args.questId === params.questId,
    );
    if (existing) return { contractId: existing };

    const res = await this.ledger.createContract(
      tpl,
      {
        operator,
        user: params.userPartyId,
        questId: params.questId,
        questKind: params.questKind,
        startedAt: new Date().toISOString(),
      },
      [operator],
      `quest-participation-${params.questId}-${params.userPartyId}`,
    );
    if (res.ok && res.contractId) return { contractId: res.contractId };
    return {
      contractId: null,
      error: this.formatLedgerError(res.error, 'Failed to create QuestParticipation'),
    };
  }

  /**
   * Record a verified task on ledger (best-effort, per Canton audit trail).
   * Creates participation on first task if missing.
   */
  async recordTaskSubmission(params: {
    questId: string;
    questKind: 'EARN_HUB' | 'CAMPAIGN';
    taskId: string;
    taskType: string;
    proof: string | null;
    userPartyId: string;
  }): Promise<QuestTaskLedgerResult> {
    const result: QuestTaskLedgerResult = {
      ledgerEnabled: false,
      participationContractId: null,
      taskSubmissionContractId: null,
      errors: [],
    };
    if (!this.isConfigured()) return result;

    const tpl = this.templateId(TPL.QuestTaskSubmission);
    const operator = this.operatorPartyId;
    if (!tpl || !operator) {
      result.errors.push('Canton DAML package or operator party not configured');
      return result;
    }
    const reachErr = await this.ensureReachable();
    if (reachErr) {
      result.errors.push(reachErr);
      return result;
    }

    result.ledgerEnabled = true;

    const part = await this.ensureParticipation({
      questId: params.questId,
      questKind: params.questKind,
      userPartyId: params.userPartyId,
    });
    result.participationContractId = part.contractId;
    if (part.error && !part.contractId) result.errors.push(part.error);

    const existingTask = this.findContractId(
      await this.ledger.queryActiveContracts(tpl, [operator]),
      (args) =>
        args.user === params.userPartyId &&
        args.questId === params.questId &&
        args.taskId === params.taskId,
    );
    if (existingTask) {
      result.taskSubmissionContractId = existingTask;
      return result;
    }

    const subRes = await this.ledger.createContract(
      tpl,
      {
        operator,
        user: params.userPartyId,
        questId: params.questId,
        taskId: params.taskId,
        taskType: params.taskType,
        proof: params.proof ?? '',
        submittedAt: new Date().toISOString(),
        verified: true,
      },
      [operator],
      `quest-task-sub-${params.questId}-${params.taskId}-${randomUUID()}`,
    );
    if (subRes.ok && subRes.contractId) {
      result.taskSubmissionContractId = subRes.contractId;
    } else {
      result.errors.push(
        this.formatLedgerError(
          subRes.error,
          `Failed to record task submission ${params.taskId}`,
        ),
      );
    }
    return result;
  }

  /**
   * Create ClaimSession for FCFS/invite claim audit trail.
   * Best-effort: returns errors but does not throw.
   */
  async createClaimSession(params: {
    questId: string;
    userPartyId: string;
    claimKind: 'fcfs_cc' | 'invite_code';
    feeCc: number;
    rewardCc: number;
  }): Promise<ClaimSessionLedgerResult> {
    const result: ClaimSessionLedgerResult = {
      ledgerEnabled: false,
      sessionContractId: null,
      errors: [],
    };
    if (!this.isClaimSessionConfigured()) return result;

    const tpl = this.templateId(TPL.ClaimSession);
    const operator = this.operatorPartyId;
    if (!tpl || !operator) {
      result.errors.push('Canton DAML package or operator party not configured');
      return result;
    }
    const reachErr = await this.ensureReachable();
    if (reachErr) {
      result.errors.push(reachErr);
      return result;
    }

    result.ledgerEnabled = true;
    await this.ledger.grantUserRights(operator).catch((err) =>
      this.logger.warn(`grantUserRights(operator) failed: ${String(err)}`),
    );

    const createdAt = new Date().toISOString();
    const res = await this.ledger.createContract(
      tpl,
      {
        operator,
        user: params.userPartyId,
        questId: params.questId,
        claimKind: params.claimKind,
        feeCc: String(params.feeCc),
        rewardCc: String(params.rewardCc),
        createdAt,
        feePaidAt: null,
        feeTxId: null,
        rewardSentAt: null,
        rewardTxId: null,
        status: 'INIT',
      },
      [operator],
      `claim-session-${randomUUID()}`,
    );

    if (res.ok && res.contractId) {
      result.sessionContractId = res.contractId;
      return result;
    }
    result.errors.push(res.error ?? 'Failed to create ClaimSession');
    return result;
  }

  /** Mark fee paid (with tx id) on ClaimSession. Best-effort. */
  async markClaimFeePaid(params: {
    sessionContractId: string;
    feeTxId: string;
  }): Promise<{ ok: boolean; errors: string[] }> {
    if (!this.isClaimSessionConfigured()) {
      return { ok: false, errors: ['Claim session ledger disabled'] };
    }
    const templateId = this.templateId(TPL.ClaimSession);
    const operator = this.operatorPartyId;
    if (!templateId || !operator) {
      return { ok: false, errors: ['Canton DAML not configured'] };
    }
    const { ok, text } = await this.ledger.exerciseChoice(
      params.sessionContractId,
      templateId,
      'ClaimSession_MarkFeePaidWithTx',
      { paidAt: new Date().toISOString(), txId: params.feeTxId },
      [operator],
      `claim-fee-paid-${randomUUID()}`,
    );
    return ok ? { ok: true, errors: [] } : { ok: false, errors: [text.slice(0, 200)] };
  }

  /** Mark reward sent (with tx id) on ClaimSession. Best-effort. */
  async markClaimRewardSent(params: {
    sessionContractId: string;
    rewardTxId: string;
  }): Promise<{ ok: boolean; errors: string[] }> {
    if (!this.isClaimSessionConfigured()) {
      return { ok: false, errors: ['Claim session ledger disabled'] };
    }
    const templateId = this.templateId(TPL.ClaimSession);
    const operator = this.operatorPartyId;
    if (!templateId || !operator) {
      return { ok: false, errors: ['Canton DAML not configured'] };
    }
    const { ok, text } = await this.ledger.exerciseChoice(
      params.sessionContractId,
      templateId,
      'ClaimSession_MarkRewardSentWithTx',
      { sentAt: new Date().toISOString(), txId: params.rewardTxId },
      [operator],
      `claim-reward-sent-${randomUUID()}`,
    );
    return ok ? { ok: true, errors: [] } : { ok: false, errors: [text.slice(0, 200)] };
  }

  /** Operator marks QuestReward claimed after CIP-56 payout (propose-accept completion). */
  async markRewardClaimed(params: {
    rewardContractId: string;
    payoutTxId: string;
  }): Promise<{ ok: boolean; errors: string[] }> {
    if (!this.isConfigured()) {
      return { ok: false, errors: ['Quest ledger disabled'] };
    }
    const templateId = this.templateId(TPL.QuestReward);
    const operator = this.operatorPartyId;
    if (!templateId || !operator) {
      return { ok: false, errors: ['Canton DAML not configured'] };
    }
    const { ok, text } = await this.ledger.exerciseChoice(
      params.rewardContractId,
      templateId,
      'QuestReward_MarkClaimedWithTx',
      { txId: params.payoutTxId, claimedAt: new Date().toISOString() },
      [operator],
      `quest-reward-claimed-${randomUUID()}`,
    );
    return ok ? { ok: true, errors: [] } : { ok: false, errors: [text.slice(0, 200)] };
  }

  /**
   * Create QuestCompletion, QuestTaskSubmission (per task), QuestReward on ledger.
   * Participation is ensured idempotently. Best-effort partial success.
   */
  async recordQuestCompletion(params: {
    questId: string;
    questKind: 'EARN_HUB' | 'CAMPAIGN';
    questTitle: string;
    rewardCc: number;
    userPartyId: string;
    taskIds: string[];
    proofs: Array<{ taskId: string; taskType: string; proof: string | null }>;
  }): Promise<QuestLedgerSubmitResult> {
    const result: QuestLedgerSubmitResult = {
      ledgerEnabled: false,
      participationContractId: null,
      completionContractId: null,
      rewardContractId: null,
      taskSubmissionIds: [],
      errors: [],
    };

    if (!this.isConfigured()) return result;

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
    await this.ledger.grantUserRights(operator).catch((err) =>
      this.logger.warn(`grantUserRights(operator) failed: ${String(err)}`),
    );

    const part = await this.ensureParticipation({
      questId: params.questId,
      questKind: params.questKind,
      userPartyId: params.userPartyId,
    });
    result.participationContractId = part.contractId;
    if (part.error && !part.contractId) {
      result.errors.push(part.error);
    }

    const submissionTpl = this.templateId(TPL.QuestTaskSubmission);
    if (submissionTpl) {
      const existingContracts = await this.ledger.queryActiveContracts(submissionTpl, [operator]);
      for (const { taskId, taskType, proof } of params.proofs) {
        const existing = this.findContractId(
          existingContracts,
          (args) =>
            args.user === params.userPartyId &&
            args.questId === params.questId &&
            args.taskId === taskId,
        );
        if (existing) {
          result.taskSubmissionIds.push(existing);
          continue;
        }
        const subRes = await this.ledger.createContract(
          submissionTpl,
          {
            operator,
            user: params.userPartyId,
            questId: params.questId,
            taskId,
            taskType,
            proof: proof ?? '',
            submittedAt: new Date().toISOString(),
            verified: true,
          },
          [operator],
          `quest-task-sub-${randomUUID()}`,
        );
        if (subRes.ok && subRes.contractId) {
          result.taskSubmissionIds.push(subRes.contractId);
        } else if (subRes.ok) {
          result.errors.push(
            `Task ${taskId}: on-chain write ok but contract id missing — restart API.`,
          );
        } else {
          result.errors.push(
            this.formatLedgerError(
              subRes.error,
              `Failed to record task submission ${taskId}`,
            ),
          );
        }
      }
    }

    const completionTpl = this.templateId(TPL.QuestCompletion);
    if (completionTpl) {
      const existingCompletion = this.findContractId(
        await this.ledger.queryActiveContracts(completionTpl, [operator]),
        (args) =>
          args.user === params.userPartyId && args.questId === params.questId,
      );
      if (existingCompletion) {
        result.completionContractId = existingCompletion;
      } else {
        const completionRes = await this.ledger.createContract(
          completionTpl,
          {
            operator,
            user: params.userPartyId,
            questId: params.questId,
            questKind: params.questKind,
            rewardCc: String(params.rewardCc),
            taskCount: params.proofs.length,
            completedAt: new Date().toISOString(),
          },
          [operator],
          `quest-completion-${randomUUID()}`,
        );
        if (completionRes.ok && completionRes.contractId) {
          result.completionContractId = completionRes.contractId;
        } else {
          result.errors.push(
            completionRes.error ?? 'Failed to create QuestCompletion',
          );
        }
      }
    }

    if (params.rewardCc > 0) {
      const rewardTpl = this.templateId(TPL.QuestReward);
      if (rewardTpl) {
        const rewardRes = await this.ledger.createContract(
          rewardTpl,
          {
            operator,
            user: params.userPartyId,
            questId: params.questId,
            rewardCc: String(params.rewardCc),
            completedAt: new Date().toISOString(),
            claimed: false,
            payoutTxId: null,
          },
          [operator],
          `quest-reward-${randomUUID()}`,
        );
        if (rewardRes.ok && rewardRes.contractId) {
          result.rewardContractId = rewardRes.contractId;
        } else {
          result.errors.push(rewardRes.error ?? 'Failed to create QuestReward');
        }
      }
    }

    this.logger.log(
      `Quest ledger: quest=${params.questId} participation=${result.participationContractId ?? 'none'} completion=${result.completionContractId ?? 'none'} reward=${result.rewardContractId ?? 'none'}`,
    );

    return result;
  }

  /** Short human-readable snippet from Canton JSON error body. */
  private formatLedgerError(raw: string | undefined, fallback: string): string {
    if (!raw) return fallback;
    try {
      const j = JSON.parse(raw) as { code?: string; cause?: string };
      if (j.cause) return `${fallback}: ${j.cause}`;
      if (j.code) return `${fallback}: ${j.code}`;
    } catch {
      /* use raw slice */
    }
    return `${fallback}: ${raw.slice(0, 120)}`;
  }
}
