import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { CantonLedgerService } from './canton-ledger.service';

export interface QuestLedgerSubmitResult {
  ledgerEnabled: boolean;
  participationContractId: string | null;
  rewardContractId: string | null;
  taskSubmissionIds: string[];
  errors: string[];
}

export interface ClaimSessionLedgerResult {
  ledgerEnabled: boolean;
  sessionContractId: string | null;
  errors: string[];
}

/**
 * Records quest completion on Canton via DAML templates in packages/daml/Main.daml.
 * CIP-56 CC disbursement is handled separately by SpliceValidatorService (TransferPreapproval).
 */
@Injectable()
export class QuestLedgerService {
  private readonly logger = new Logger(QuestLedgerService.name);

  constructor(
    private readonly ledger: CantonLedgerService,
    private readonly config: ConfigService,
  ) {}

  private get packageId(): string | null {
    const id = this.config.get<string>('CANTON_DAML_PACKAGE_ID')?.trim();
    return id || null;
  }

  private get operatorPartyId(): string | null {
    const id =
      this.config.get<string>('CANTON_OPERATOR_PARTY_ID')?.trim() ||
      this.config.get<string>('CANTON_VALIDATOR_PARTY_ID')?.trim();
    return id || null;
  }

  /** When false, quest submit skips DAML contracts (wallet / Splice CC still works). */
  isConfigured(): boolean {
    const enabled = this.config.get<string>('QUEST_LEDGER_ENABLED');
    if (enabled === 'false' || enabled === '0') return false;
    return !!(this.packageId && this.operatorPartyId);
  }

  /** When false, claim audit skips ClaimSession DAML contract. */
  isClaimSessionConfigured(): boolean {
    const enabled = this.config.get<string>('CLAIM_SESSION_LEDGER_ENABLED');
    if (enabled === 'false' || enabled === '0') return false;
    return !!(this.packageId && this.operatorPartyId);
  }

  /**
   * Create a ClaimSession for FCFS/invite claim audit trail.
   * Best-effort: returns errors but does not throw.
   */
  async createClaimSession(params: {
    questId: string;
    userPartyId: string;
    claimKind: 'fcfs_cc' | 'invite_code';
    feeCc: number;
    rewardCc: number;
  }): Promise<ClaimSessionLedgerResult> {
    const pkg = this.packageId;
    const operator = this.operatorPartyId;
    const result: ClaimSessionLedgerResult = {
      ledgerEnabled: false,
      sessionContractId: null,
      errors: [],
    };

    if (!pkg || !operator) {
      result.errors.push('Canton DAML package or operator party not configured');
      return result;
    }
    const reachable = await this.ledger.isReachable();
    if (!reachable) {
      result.errors.push('Canton JSON Ledger API unreachable');
      return result;
    }

    result.ledgerEnabled = true;
    await this.ledger.grantUserRights(operator).catch((err) =>
      this.logger.warn(`grantUserRights(operator) failed: ${String(err)}`),
    );

    const tpl = `${pkg}:Main:ClaimSession`;
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
    const pkg = this.packageId;
    const operator = this.operatorPartyId;
    if (!pkg || !operator) return { ok: false, errors: ['Canton DAML not configured'] };
    const templateId = `${pkg}:Main:ClaimSession`;
    const { ok, text } = await this.ledger.exerciseChoice(
      params.sessionContractId,
      templateId,
      'ClaimSession_MarkFeePaidWithTx',
      params.feeTxId,
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
    const pkg = this.packageId;
    const operator = this.operatorPartyId;
    if (!pkg || !operator) return { ok: false, errors: ['Canton DAML not configured'] };
    const templateId = `${pkg}:Main:ClaimSession`;
    const { ok, text } = await this.ledger.exerciseChoice(
      params.sessionContractId,
      templateId,
      'ClaimSession_MarkRewardSentWithTx',
      params.rewardTxId,
      [operator],
      `claim-reward-sent-${randomUUID()}`,
    );
    return ok ? { ok: true, errors: [] } : { ok: false, errors: [text.slice(0, 200)] };
  }

  /**
   * Create QuestParticipation, QuestTaskSubmission (per task), and QuestReward on ledger.
   * Best-effort: partial success is returned in the result object.
   */
  async recordQuestCompletion(params: {
    questId: string;
    questTitle: string;
    rewardCc: number;
    userPartyId: string;
    taskIds: string[];
    proofs: Array<{ taskId: string; proof: string | null }>;
  }): Promise<QuestLedgerSubmitResult> {
    const pkg = this.packageId;
    const operator = this.operatorPartyId;
    const result: QuestLedgerSubmitResult = {
      ledgerEnabled: false,
      participationContractId: null,
      rewardContractId: null,
      taskSubmissionIds: [],
      errors: [],
    };

    if (!pkg || !operator) {
      result.errors.push('Canton DAML package or operator party not configured');
      return result;
    }

    const reachable = await this.ledger.isReachable();
    if (!reachable) {
      result.errors.push('Canton JSON Ledger API unreachable');
      return result;
    }

    result.ledgerEnabled = true;
    // Operator-only actAs: templates use signatory operator + observer user.
    const actAs = [operator];
    await this.ledger.grantUserRights(operator).catch((err) =>
      this.logger.warn(`grantUserRights(operator) failed: ${String(err)}`),
    );

    const participationTpl = `${pkg}:Main:QuestParticipation`;
    const participationRes = await this.ledger.createContract(
      participationTpl,
      {
        operator,
        user: params.userPartyId,
        questId: params.questId,
        startedAt: new Date().toISOString(),
      },
      actAs,
      `quest-participation-${randomUUID()}`,
    );

    if (!participationRes.ok) {
      result.errors.push(
        this.formatLedgerError(
          participationRes.error,
          'Failed to create QuestParticipation',
        ),
      );
    } else if (participationRes.contractId) {
      result.participationContractId = participationRes.contractId;
    } else {
      result.errors.push(
        'QuestParticipation submitted but contract id missing — restart API (latest Canton ledger client).',
      );
    }

    const submissionTpl = `${pkg}:Main:QuestTaskSubmission`;
    for (const { taskId, proof } of params.proofs) {
      const subRes = await this.ledger.createContract(
        submissionTpl,
        {
          operator,
          user: params.userPartyId,
          questId: params.questId,
          taskId,
          proof: proof ?? '',
          submittedAt: new Date().toISOString(),
          verified: true,
        },
        actAs,
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

    if (params.rewardCc > 0) {
      const rewardTpl = `${pkg}:Main:QuestReward`;
      const rewardRes = await this.ledger.createContract(
        rewardTpl,
        {
          operator,
          user: params.userPartyId,
          questId: params.questId,
          rewardCc: params.rewardCc,
          completedAt: new Date().toISOString(),
          claimed: false,
        },
        [operator],
        `quest-reward-${randomUUID()}`,
      );
      if (rewardRes.ok && rewardRes.contractId) {
        result.rewardContractId = rewardRes.contractId;
        // Claim requires user controller — skip if ledger user cannot act as user party.
        // CC payout uses CIP-56 TransferPreapproval separately.
      } else {
        result.errors.push(rewardRes.error ?? 'Failed to create QuestReward');
      }
    }

    this.logger.log(
      `Quest ledger: quest=${params.questId} participation=${result.participationContractId ?? 'none'} reward=${result.rewardContractId ?? 'none'}`,
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
