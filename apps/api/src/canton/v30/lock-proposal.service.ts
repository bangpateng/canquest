import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { CantonLedgerService } from '../canton-ledger.service';
import { UsersService } from '../../users/users.service';
import { hasRealWallet } from '../../common/wallet-policy';
import { cantonPartyIdsEqual } from '../../common/canton-party-id';
import {
  V30_PROPOSAL_WINDOW_MS,
  isV30Quest,
  v30Dec,
  v30Enabled,
  v30LockTemplateId,
  v30T1At,
} from './v30.constants';
import type { V30BuiltFlow } from './claim-offer.service';

/** Toleransi pencocokan expiresAt lock vs record (detik). */
const EXPIRY_TOLERANCE_SECONDS = 5;

/**
 * LockProposal / LockReceipt — paket `canquest-lock` (v30).
 *
 * Elibility campaign via lock CC dengan holders = [VALIDATOR] (bukan user!):
 * LockedAmulet_UnlockV2 (early unlock) controller-nya owner::holders TANPA cek
 * waktu — kalau holders user, gerbang eligibility runtuh diam-diam
 * (AGENT.md / LOCK-SPEC.md). Kontrak menyusun Transfer di DALAM body AcceptLock
 * (anti-manipulasi) — backend hanya memilih inputAmuletCids + context.
 *
 * Urutan waktu: T0 lock → T1 tutup pendaftaran (RE-VERIFIKASI semua lock) →
 * T2 campaign end + unlock dibuka utk SEMUA peserta → undian + ClaimOffer.
 */
@Injectable()
export class LockProposalService {
  private readonly logger = new Logger(LockProposalService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly ledger: CantonLedgerService,
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  private get validatorParty(): string {
    return this.config.get<string>('CANTON_VALIDATOR_PARTY_ID')?.trim() ?? '';
  }
  private get dsoParty(): string {
    return this.config.get<string>('CANTON_DSO_PARTY_ID')?.trim() ?? '';
  }

  // ── 1. Backend membuat LockProposal (actAs validator, lokal) ──────────────

  /**
   * contextRef = CSPRNG 128-bit hex. optContext PUBLIK on-chain — JANGAN pernah
   * isi "canquest:campaign-42"; mapping contextRef→quest hanya di DB
   * (LOCK-SPEC.md §"opaque token").
   */
  async createProposal(questId: string, userId: string): Promise<{
    ok: boolean;
    recordId?: string;
    proposalContractId?: string;
    amountCc?: number;
    expiresAt?: string;
    proposalExpiresAt?: string;
    error?: string;
  }> {
    if (!v30Enabled(this.config)) return { ok: false, error: 'CLAIM_V30_ENABLED=false' };
    if (!this.validatorParty || !this.dsoParty) {
      return { ok: false, error: 'CANTON_VALIDATOR_PARTY_ID / CANTON_DSO_PARTY_ID belum diset' };
    }

    const quest = await this.prisma.quest.findUnique({ where: { id: questId } });
    if (!quest || !isV30Quest(quest)) return { ok: false, error: 'Quest bukan jalur v30' };
    if (quest.status !== 'ACTIVE') return { ok: false, error: 'Campaign tidak aktif' };

    // T2 = campaign end. Lock harus masih hidup sampai T2.
    const endsAt = quest.endsAt ?? null;
    if (!endsAt) return { ok: false, error: 'Quest belum punya endsAt (T2) — set di dashboard admin' };
    const proposalExpiresAt = new Date(Date.now() + V30_PROPOSAL_WINDOW_MS);
    if (endsAt.getTime() <= proposalExpiresAt.getTime() + EXPIRY_TOLERANCE_SECONDS * 1000) {
      return { ok: false, error: 'Campaign terlalu dekat dengan berakhir (T2) untuk lock baru' };
    }

    // T1 = 70% durasi — pendaftaran TERTUTUP setelah ini (spesifikasi owner).
    // Guard ganda: flag v30RegistrationClosedAt (di-set scheduler T1) ATAU
    // hitungan waktu langsung (kalau scheduler belum sempat jalan).
    const t1 = v30T1At(quest.startsAt, quest.endsAt);
    const registrationClosed =
      quest.v30RegistrationClosedAt != null ||
      (t1 != null && Date.now() >= t1.getTime());
    if (registrationClosed) {
      return {
        ok: false,
        error: 'Pendaftaran campaign sudah ditutup (T1) — lock baru tidak diterima.',
      };
    }

    const existing = await this.prisma.lockProposalRecord.findUnique({
      where: { questId_userId: { questId, userId } },
    });
    if (existing && existing.status !== 'PROPOSED') {
      return { ok: false, error: `Sudah ada lock (${existing.status}) utk campaign ini` };
    }

    const user = await this.users.findById(userId);
    if (!user?.cantonPartyId || !hasRealWallet(user.cantonPartyId)) {
      return { ok: false, error: 'Wallet external belum aktif' };
    }
    if (user.walletKind && user.walletKind !== 'external') {
      return { ok: false, error: 'Jalur lock v30 hanya utk wallet non-custodial' };
    }

    // Ambang = eligibility campaign (LOCK_CC). Default entryCcLock / 30 CC.
    const amountCc = quest.entryCcLock ?? 30;
    const contextRef = randomBytes(16).toString('hex'); // CSPRNG 128-bit, opaque

    const payload = {
      admin: this.validatorParty,
      user: user.cantonPartyId,
      contextRef,
      amount: v30Dec(amountCc),
      expiresAt: endsAt.toISOString(), // DAML Time — RFC3339
      proposalExpiresAt: proposalExpiresAt.toISOString(),
    };
    const res = await this.ledger.createContract(
      v30LockTemplateId(this.config, 'LockProposal'),
      payload,
      [this.validatorParty],
      `v30-lock-${createHash('sha256').update(contextRef).digest('hex').slice(0, 24)}`,
    );
    if (!res.ok || !res.contractId) {
      return { ok: false, error: `create LockProposal gagal: ${res.error ?? '?'}` };
    }

    const record = existing
      ? await this.prisma.lockProposalRecord.update({
          where: { id: existing.id },
          data: {
            contextRef,
            proposalContractId: res.contractId,
            amountCc,
            expiresAt: endsAt,
            proposalExpiresAt,
            status: 'PROPOSED',
            createdAt: new Date(),
          },
        })
      : await this.prisma.lockProposalRecord.create({
          data: {
            questId,
            userId,
            contextRef,
            proposalContractId: res.contractId,
            amountCc,
            expiresAt: endsAt,
            proposalExpiresAt,
            status: 'PROPOSED',
          },
        });

    this.logger.log(
      `LockProposal dibuat cid=${res.contractId.slice(0, 16)}… quest=${questId} user=${userId.slice(0, 8)}… amount=${amountCc} T2=${endsAt.toISOString()}`,
    );
    return {
      ok: true,
      recordId: record.id,
      proposalContractId: res.contractId,
      amountCc,
      expiresAt: endsAt.toISOString(),
      proposalExpiresAt: proposalExpiresAt.toISOString(),
    };
  }

  // ── 2. Bangun AcceptLock utk user (dipanggil signing relay) ───────────────

  /**
   * AcceptLock — controller user sendirian. `expectedDso` WAJIB dari config
   * (diisi dari Scan API saat setup — tidak pernah hardcode di Daml,
   * LockProposal.daml:141). inputAmuletCid dipilih BACKEND dari holdings user
   * (user tidak bisa memilih input orang lain — tetap diverifikasi kontrak).
   */
  async buildAcceptLockProposal(
    userId: string,
    params: Record<string, unknown>,
  ): Promise<V30BuiltFlow> {
    if (!v30Enabled(this.config)) throw new BadRequestException('v30 lock disabled');
    const questId = typeof params.questId === 'string' ? params.questId : '';
    if (!questId) throw new BadRequestException('questId is required');

    const record = await this.prisma.lockProposalRecord.findUnique({
      where: { questId_userId: { questId, userId } },
    });
    if (!record || record.status !== 'PROPOSED') {
      throw new BadRequestException('LockProposal tidak ditemukan / sudah tidak PROPOSED');
    }
    if (record.proposalExpiresAt.getTime() <= Date.now()) {
      throw new BadRequestException(
        'Jendela tanda tangan (10 menit) sudah lewat — minta proposal baru.',
      );
    }
    const user = await this.users.findById(userId);
    if (!user?.cantonPartyId) throw new BadRequestException('Wallet tidak ditemukan');

    const amuletRules = await this.ledger.fetchScanProxyContract('amulet-rules');
    if (!amuletRules) throw new BadRequestException('scan-proxy /amulet-rules gagal');
    const openRound = await this.ledger.fetchScanProxyContract(
      'open-and-issuing-mining-rounds',
    );
    if (!openRound) throw new BadRequestException('scan-proxy /open-and-issuing-mining-rounds gagal');

    const amount = Number(record.amountCc);
    const holdings = await this.ledger.queryAmuletHoldings(user.cantonPartyId);
    const inputAmuletCids = greedyFill(holdings, amount);
    if (inputAmuletCids.length === 0) {
      throw new BadRequestException(
        `Saldo CC bebas tidak cukup utk lock ${amount} CC (maks 100 input per transfer).`,
      );
    }

    // TransferContext FLAT — mirror buildLockCcCommand (terbukti MainNet).
    const choiceArgument = {
      amuletRulesCid: amuletRules.contractId,
      inputAmuletCids,
      context: {
        openMiningRound: openRound.contractId,
        issuingMiningRounds: [],
        validatorRights: [],
        featuredAppRight: null,
      },
      expectedDso: this.dsoParty,
    };

    return {
      commands: [
        {
          ExerciseCommand: {
            templateId: v30LockTemplateId(this.config, 'LockProposal'),
            contractId: record.proposalContractId,
            choice: 'AcceptLock',
            choiceArgument,
          },
        },
      ],
      disclosedContracts: [
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
      ],
      commandId: `v30-acceptlock-${createHash('sha256').update(record.id).digest('hex').slice(0, 24)}`,
      meta: {
        lockRecordId: record.id,
        questId,
        amountCc: amount,
        contextRef: record.contextRef,
        expiresAt: record.expiresAt.toISOString(),
      },
      description: `Lock ${amount} CC until campaign ends`,
    };
  }

  // ── 3. Pasca-accept: verifikasi HoldingV2 dari LEDGER ─────────────────────

  /**
   * Dipanggil signing-relay setelah execute sukses. Verifikasi dari ledger
   * (BUKAN input frontend — FLOW.md §verifikasi):
   *   owner == user, amount >= ambang, holders == [validator] (WAJIB),
   *   expiresAt ≈ T2, optContext == contextRef, kontrak aktif di ACS.
   * Gagal verifikasi → status record tetap PROPOSED (tidak dianggap eligible)
   * dan dicatat keras utk investigasi.
   */
  async onAcceptExecuted(
    userId: string,
    meta: Record<string, unknown>,
    result: { updateId?: string } | undefined,
  ): Promise<void> {
    const lockRecordId = String(meta.lockRecordId ?? '');
    if (!lockRecordId) return;
    try {
      const verified = await this.verifyAndRecord(lockRecordId, result?.updateId);
      this.logger.log(
        `accept_lock_proposal ${verified.ok ? 'TERVERIFIKASI' : 'GAGAL VERIFIKASI'} record=${lockRecordId.slice(0, 8)}… ${verified.detail ?? ''}`,
      );
    } catch (err) {
      this.logger.error(
        `⚠️ accept_lock_proposal on-chain sukses (${result?.updateId ?? 'n/a'}) record=${lockRecordId} — verifikasi gagal: ${String(err).slice(0, 180)}`,
      );
    }
  }

  /** Verifikasi lock on-chain → flip record + eligibility + CcLock mirror. */
  async verifyAndRecord(
    lockRecordId: string,
    acceptUpdateId?: string,
  ): Promise<{ ok: boolean; detail?: string }> {
    const record = await this.prisma.lockProposalRecord.findUnique({
      where: { id: lockRecordId },
    });
    if (!record) return { ok: false, detail: 'record tidak ada' };
    if (record.status === 'ACCEPTED' || record.status === 'UNLOCKED') {
      return { ok: true, detail: `sudah ${record.status}` };
    }
    const user = await this.users.findById(record.userId);
    if (!user?.cantonPartyId) return { ok: false, detail: 'user tanpa wallet' };

    const locks = await this.ledger.findLockedAmulets(user.cantonPartyId);
    const match =
      locks.find((l) => l.optContext === record.contextRef) ??
      locks.find(
        (l) =>
          Math.abs(
            Date.parse(l.expiresAt || '') - record.expiresAt.getTime(),
          ) /
            1000 <=
          EXPIRY_TOLERANCE_SECONDS,
      );
    if (!match) {
      return { ok: false, detail: 'LockedAmulet dgn contextRef/expiresAt cocok tidak ditemukan di ACS' };
    }
    // holders WAJIB [validator] persis — selain itu TOLAK (gerbang eligibility).
    const holdersOk =
      match.holders.length === 1 && cantonPartyIdsEqual(match.holders[0], this.validatorParty);
    if (!holdersOk) {
      this.logger.error(
        `⚠️ LOCK HOLDERS SALAH: cid=${match.contractId.slice(0, 16)}… holders=${JSON.stringify(match.holders)} — record TIDAK di-ACCEPT (SECURITY.md §holders)`,
      );
      return { ok: false, detail: `holders != [validator]: ${JSON.stringify(match.holders)}` };
    }
    if (match.amount + 1e-9 < Number(record.amountCc)) {
      return { ok: false, detail: `amount ${match.amount} < ambang ${Number(record.amountCc)}` };
    }

    await this.prisma.lockProposalRecord.update({
      where: { id: record.id },
      data: {
        status: 'ACCEPTED',
        lockedAmuletCid: match.contractId,
        acceptedAt: new Date(),
        acceptUpdateId: acceptUpdateId ?? null,
      },
    });
    // Mirror utk gating partisipasi existing (CampaignEligibilityLedger LOCK_CC).
    await this.prisma.campaignEligibilityLedger.upsert({
      where: { questId_userId: { questId: record.questId, userId: record.userId } },
      create: {
        questId: record.questId,
        userId: record.userId,
        contractId: record.proposalContractId,
        eligibilityType: 'LOCK_CC',
        amount: Number(record.amountCc),
        lockedAt: new Date(),
        status: 'ELIGIBLE',
        lockId: `v30:${record.contextRef}`,
      },
      update: { status: 'ELIGIBLE', amount: Number(record.amountCc), lockId: `v30:${record.contextRef}` },
    });
    // Mirror CcLock supaya lock tampil di wallet UI + bisa di-unlock via flow
    // unlock_cc existing (LockedAmulet_OwnerExpireLockV2, controller owner).
    await this.prisma.ccLock.upsert({
      where: { lockedAmuletCid: match.contractId },
      create: {
        ownerParty: user.cantonPartyId,
        userId: record.userId,
        amountCc: match.amount,
        termKey: `v30-${record.questId.slice(0, 8)}`,
        lockSeconds: Math.max(
          1,
          Math.round((record.expiresAt.getTime() - Date.now()) / 1000),
        ),
        lockedAt: new Date(),
        expiresAt: record.expiresAt,
        status: 'LOCKED',
        lockedAmuletCid: match.contractId,
      },
      update: { status: 'LOCKED' },
    });
    return { ok: true, detail: `cid=${match.contractId.slice(0, 14)}… amount=${match.amount}` };
  }

  // ── 4. Re-verifikasi T1 + expiry ──────────────────────────────────────────

  /**
   * RE-VERIFY T1 (penutupan pendaftaran, sebelum undian): semua lock dicek
   * ulang dari ledger. UnlockV2 (early unlock) TANPA cek waktu — peserta yang
   * early-unlock HARUS dicabut eligibility-nya (FLOW.md §T1, SECURITY.md §3.2).
   * Dipanggil: admin endpoint close-registration + job harian.
   */
  async reVerifyQuestLocks(questId: string): Promise<{
    checked: number;
    revoked: number;
    stillEligible: number;
    details: string[];
  }> {
    const records = await this.prisma.lockProposalRecord.findMany({
      where: { questId, status: 'ACCEPTED' },
    });
    const details: string[] = [];
    let revoked = 0;
    let stillEligible = 0;

    for (const record of records) {
      const user = await this.users.findById(record.userId);
      if (!user?.cantonPartyId) continue;
      const locks = await this.ledger.findLockedAmulets(user.cantonPartyId);
      const active = locks.some(
        (l) =>
          l.contractId === record.lockedAmuletCid &&
          l.optContext === record.contextRef,
      );
      if (active) {
        stillEligible++;
        continue;
      }
      // Kontrak hilang = early-unlock (UnlockV2 oleh user+admin) atau dikonsumsi.
      await this.prisma.lockProposalRecord.update({
        where: { id: record.id },
        data: {
          status: 'REVOKED',
          revokedAt: new Date(),
          revokedReason: 'T1 re-verify: LockedAmulet tidak lagi aktif (early-unlock?)',
        },
      });
      await this.prisma.campaignEligibilityLedger.updateMany({
        where: { questId, userId: record.userId },
        data: { status: 'REVOKED' },
      });
      revoked++;
      details.push(`user=${record.userId.slice(0, 8)}… dicabut (lock hilang dari ACS)`);
    }
    this.logger.log(
      `reVerify T1 quest=${questId}: checked=${records.length} eligible=${stillEligible} revoked=${revoked}`,
    );
    return { checked: records.length, revoked, stillEligible, details };
  }

  /** Status lock utk UI (endpoint GET lock-v30/status). */
  async lockStatus(questId: string, userId: string): Promise<{
    v30: true;
    record: {
      exists: boolean;
      status: string | null;
      amountCc: number | null;
      expiresAt: string | null;
      proposalExpiresAt: string | null;
      proposalWindowOpen: boolean;
      canRequest: boolean;
      unlockedAt: string | null;
    };
    eligible: boolean;
  }> {
    const quest = await this.prisma.quest.findUnique({ where: { id: questId } });
    if (!quest || !isV30Quest(quest)) throw new BadRequestException('Quest bukan jalur v30');
    const record = await this.prisma.lockProposalRecord.findUnique({
      where: { questId_userId: { questId, userId } },
    });
    const eligibility = await this.prisma.campaignEligibilityLedger.findUnique({
      where: { questId_userId: { questId, userId } },
    });
    const proposalWindowOpen = !!record
      && record.status === 'PROPOSED'
      && record.proposalExpiresAt.getTime() > Date.now();
    const canRequest =
      (!record || (record.status === 'PROPOSED' && !proposalWindowOpen)) &&
      quest.status === 'ACTIVE';
    return {
      v30: true,
      record: {
        exists: !!record,
        status: record?.status ?? null,
        amountCc: record ? Number(record.amountCc) : null,
        expiresAt: record?.expiresAt.toISOString() ?? null,
        proposalExpiresAt: record?.proposalExpiresAt.toISOString() ?? null,
        proposalWindowOpen,
        canRequest,
        unlockedAt: record?.unlockedAt?.toISOString() ?? null,
      },
      eligible: eligibility?.status === 'ELIGIBLE' || record?.status === 'ACCEPTED',
    };
  }

  /** Tandai UNLOCKED (dipanggil bookkeeping unlock_cc utk cid milik record v30). */
  async onLockedAmuletUnlocked(lockedAmuletCid: string): Promise<void> {
    const record = await this.prisma.lockProposalRecord.findUnique({
      where: { lockedAmuletCid },
    });
    if (!record || record.status === 'UNLOCKED' || record.status === 'REVOKED') return;
    await this.prisma.lockProposalRecord.update({
      where: { id: record.id },
      data: { status: 'UNLOCKED', unlockedAt: new Date() },
    });
    await this.prisma.campaignEligibilityLedger.updateMany({
      where: { questId: record.questId, userId: record.userId },
      data: { status: 'EXPIRED' },
    }).catch(() => undefined);
  }
}

function greedyFill(
  holdings: Array<{ contractId: string; amount: string }>,
  target: number,
): string[] {
  const sorted = [...holdings].sort((a, b) => parseFloat(b.amount) - parseFloat(a.amount));
  const cids: string[] = [];
  let acc = 0;
  for (const h of sorted) {
    if (acc >= target) break;
    cids.push(h.contractId);
    acc += parseFloat(h.amount) || 0;
  }
  return acc >= target ? cids : [];
}
