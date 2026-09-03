import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { CantonLedgerService } from '../canton-ledger.service';
import { TokenInstrumentHelper, normalizeRewardToken } from '../token-instrument.helper';
import { UsersService } from '../../users/users.service';
import { hasRealWallet } from '../../common/wallet-policy';
import { RewardType } from '@prisma/client';
import {
  V30RewardKindLabel,
  isV30Quest,
  v30Account,
  v30ClaimTemplateId,
  v30Dec,
  v30Enabled,
  v30RewardKindFor,
  v30ValidUntil,
} from './v30.constants';

/** Bentuk command + meta yang dikembalikan ke SigningRelayService (pola BuiltFlow). */
export interface V30BuiltFlow {
  commands: unknown[];
  disclosedContracts?: unknown[];
  commandId?: string;
  meta?: Record<string, unknown>;
  description?: string;
}

/**
 * ClaimOffer / ClaimReceipt — paket `canquest-claim` (v30).
 *
 * Pembagian tugas (FLOW.md):
 *   BACKEND (service ini, token ledger TIDAK PERNAH keluar server):
 *     - create ClaimOffer actAs [validator, rewardSender] saat draw/FCFS
 *     - RevealCode / WithdrawOffer / ConfirmRewardReceived / MarkRewardExpired
 *     - sinkronisasi status receipt + pre-check saldo/preapproval
 *   USER (via signing relay — browser hanya menandatangani HASH):
 *     - AcceptCodeClaim / AcceptTokenClaim (SATU ExerciseCommand per submission —
 *       batas external party; node produksi juga sudah menolak multi-command)
 *
 * Otoritas rewardSender pada Accept* datang dari status SIGNATORY ClaimOffer
 * (warisan), bukan controller — jangan pernah menambah actAs rewardSender ke
 * submission user (AGENT.md "yang terlihat aneh tapi benar").
 */
@Injectable()
export class ClaimOfferService {
  private readonly logger = new Logger(ClaimOfferService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly ledger: CantonLedgerService,
    private readonly prisma: PrismaService,
    private readonly instruments: TokenInstrumentHelper,
    private readonly users: UsersService,
  ) {}

  // ── Party helpers ─────────────────────────────────────────────────────────

  private get validatorParty(): string {
    return this.config.get<string>('CANTON_VALIDATOR_PARTY_ID')?.trim() ?? '';
  }
  private get rewardSenderParty(): string {
    return this.config.get<string>('CANTON_REWARD_PARTY_ID')?.trim() ?? '';
  }
  private get feeReceiverParty(): string {
    return this.config.get<string>('CANTON_FEE_RECIPIENT_PARTY_ID')?.trim() ?? '';
  }
  private get dsoParty(): string {
    return this.config.get<string>('CANTON_DSO_PARTY_ID')?.trim() ?? '';
  }

  private assertConfigured(): void {
    for (const [label, v] of [
      ['CANTON_VALIDATOR_PARTY_ID', this.validatorParty],
      ['CANTON_REWARD_PARTY_ID', this.rewardSenderParty],
      ['CANTON_FEE_RECIPIENT_PARTY_ID', this.feeReceiverParty],
      ['CANTON_DSO_PARTY_ID', this.dsoParty],
    ] as const) {
      if (!v) throw new BadRequestException(`${label} not configured (v30 claim)`);
    }
  }

  // ── 1. Buat ClaimOffer (dipanggil draw-winners / FCFS prepare) ────────────

  /**
   * Buat ClaimOffer untuk satu WinnerDraw. Idempoten: baris yang sudah punya
   * offerContractId dilewati. Kode reward DI-ASSIGN SEKARANG dan hash-nya
   * dikomit ke offer — pra-undian, tidak bisa ditukar admin setelahnya
   * (SECURITY.md §2).
   */
  async createOfferForWinner(questId: string, userId: string): Promise<{
    ok: boolean;
    offerContractId?: string;
    error?: string;
    skipped?: string;
  }> {
    if (!v30Enabled(this.config)) return { ok: false, error: 'CLAIM_V30_ENABLED=false' };
    this.assertConfigured();

    const [quest, draw] = await Promise.all([
      this.prisma.quest.findUnique({ where: { id: questId } }),
      this.prisma.winnerDraw.findUnique({ where: { questId_userId: { questId, userId } } }),
    ]);
    if (!quest || !isV30Quest(quest)) return { ok: false, error: 'Quest bukan jalur v30' };
    if (!draw) return { ok: false, error: 'WinnerDraw tidak ditemukan' };
    if (draw.offerContractId) return { ok: true, offerContractId: draw.offerContractId, skipped: 'exists' };
    if (draw.distributed && draw.claimStatus !== 'RewardPending' && draw.claimStatus !== 'RewardExpired') {
      // v29 path already distributed this draw — jangan dobel.
      return { ok: false, skipped: 'already-distributed-v29', error: 'Draw sudah didistribusi via jalur lama' };
    }

    const user = await this.users.findById(userId);
    if (!user?.cantonPartyId || !hasRealWallet(user.cantonPartyId)) {
      return { ok: false, error: 'User belum punya wallet' };
    }

    // Kode reward: assign dari pool SEKARANG (hash dikomit pra-klaim).
    let codePlaintext: string | null = draw.inviteCode ?? null;
    const needsCode =
      quest.rewardType === RewardType.INVITE_CODE_RANDOM ||
      quest.rewardType === RewardType.INVITE_CODE_FCFS ||
      quest.rewardType === RewardType.INVITE_CODE ||
      quest.rewardType === RewardType.CC_AND_INVITE ||
      quest.rewardType === RewardType.CC_AND_CODE_RAFFLE;
    if (needsCode && !codePlaintext) {
      const code = await this.prisma.inviteCodePool.findFirst({
        where: { questId, userId: null },
      });
      if (code) {
        await this.prisma.inviteCodePool.update({
          where: { id: code.id },
          data: { userId, assignedAt: new Date() },
        });
        codePlaintext = code.code;
      } else if (
        quest.rewardType !== RewardType.CC_AND_CODE_RAFFLE // variant CC boleh tanpa kode
      ) {
        return { ok: false, error: 'InviteCodePool habis — upload kode sebelum draw/claim' };
      }
    }

    // Reward token leg: variant split CC_AND_CODE_RAFFLE.
    const variantIsCodeOnly =
      quest.rewardType === RewardType.CC_AND_CODE_RAFFLE && draw.rewardVariant === 'CODE';
    const variantIsCcOnly =
      quest.rewardType === RewardType.CC_AND_CODE_RAFFLE && draw.rewardVariant === 'CC';
    const rewardSymbol = normalizeRewardToken(quest.rewardToken);
    const instrument = await this.instruments.resolveInstrument(rewardSymbol);
    const rewardAmount = variantIsCodeOnly ? 0 : draw.ccAmount || quest.rewardCc || 0;

    const kind = v30RewardKindFor({
      rewardType: variantIsCcOnly ? RewardType.CC_ONLY : quest.rewardType,
      rewardToken: quest.rewardToken,
      rewardAmountCc: rewardAmount,
      codePlaintext,
      instrument: { admin: instrument.instrumentAdmin, id: instrument.instrumentId },
    });
    if (!kind) {
      return {
        ok: false,
        error: `RewardType ${quest.rewardType} (variant=${draw.rewardVariant ?? 'both'}, cc=${rewardAmount}, code=${!!codePlaintext}) tidak ter-map ke RewardKind v30`,
      };
    }

    // lockRef: lock aktif milik user utk quest ini (audit trail on-chain).
    const lock = await this.prisma.lockProposalRecord.findUnique({
      where: { questId_userId: { questId, userId } },
    });
    const lockRef = lock && lock.status === 'ACCEPTED' ? lock.contextRef : null;

    const claimId = draw.claimId ?? `v30-${draw.id}`;
    const drawnAt = draw.drawnAt ?? new Date();
    // AGENT.md: validUntil = waktu UNDIAN + 48 jam — BUKAN waktu campaign.
    const validUntil = v30ValidUntil(drawnAt);

    const payload = {
      admin: this.validatorParty,
      user: user.cantonPartyId,
      feeReceiver: this.feeReceiverParty,
      rewardSender: this.rewardSenderParty,
      campaignId: quest.id,
      claimId,
      feeAmount: v30Dec(this.resolveFee(quest)),
      feeInstrument: { admin: this.dsoParty, id: 'Amulet' }, // fee SELALU CC
      reward: kind.json,
      lockRef, // Optional Text — Some → raw value, None → null
      validUntil: validUntil.toISOString(), // DAML Time = RFC3339
    };

    const commandId = `v30-offer-${createHashShort(claimId)}`;
    const res = await this.ledger.createContract(
      v30ClaimTemplateId(this.config, 'ClaimOffer'),
      payload,
      [this.validatorParty, this.rewardSenderParty], // actAs — svc-offer (SECURITY.md)
      commandId,
    );
    if (!res.ok || !res.contractId) {
      return { ok: false, error: `create ClaimOffer gagal: ${res.error ?? res.updateId ?? '?'}` };
    }

    await this.prisma.winnerDraw.update({
      where: { id: draw.id },
      data: {
        offerContractId: res.contractId,
        claimId,
        rewardKind: kind.label,
        validUntil,
        inviteCode: codePlaintext ?? draw.inviteCode,
      },
    });
    this.logger.log(
      `ClaimOffer dibuat cid=${res.contractId.slice(0, 16)}… quest=${quest.id} user=${userId.slice(0, 8)}… kind=${kind.label} fee=${payload.feeAmount} validUntil=${validUntil.toISOString()}`,
    );
    return { ok: true, offerContractId: res.contractId };
  }

  /**
   * FCFS v30: peminang PERTAMA menang. WinnerDraw dibuat saat prepare-claim —
   * race antar request dua peminang diselesaikan constraint
   * @@unique([questId, userId]) / claimId unique (yang kalah dapat error jelas).
   * Kuota dijaga hitungan WinnerDraw vs quest.maxWinners.
   */
  async createOfferForFcfs(questId: string, userId: string): Promise<{
    ok: boolean;
    offerContractId?: string;
    error?: string;
    reason?: 'SLOTS_FULL' | 'ALREADY_CLAIMED';
  }> {
    if (!v30Enabled(this.config)) return { ok: false, error: 'CLAIM_V30_ENABLED=false' };
    this.assertConfigured();

    const quest = await this.prisma.quest.findUnique({ where: { id: questId } });
    if (!quest || !isV30Quest(quest)) return { ok: false, error: 'Quest bukan jalur v30' };
    if (quest.status !== 'ACTIVE') return { ok: false, error: 'Campaign tidak aktif' };
    if (quest.rewardType !== RewardType.INVITE_CODE_FCFS && quest.rewardType !== RewardType.CC_ONLY) {
      return { ok: false, error: `RewardType ${quest.rewardType} bukan jalur FCFS` };
    }

    const existing = await this.prisma.winnerDraw.findUnique({
      where: { questId_userId: { questId, userId } },
    });
    if (existing) {
      if (existing.offerContractId) return { ok: true, offerContractId: existing.offerContractId };
      return this.createOfferForWinner(questId, userId);
    }

    // Kuota: jumlah pemenang tercatat vs maxWinners (null = unlimited).
    if (quest.maxWinners != null) {
      const drawn = await this.prisma.winnerDraw.count({ where: { questId } });
      if (drawn >= quest.maxWinners) {
        return { ok: false, error: 'Kuota pemenang FCFS sudah penuh', reason: 'SLOTS_FULL' };
      }
    }

    try {
      await this.prisma.winnerDraw.create({
        data: {
          questId,
          userId,
          ccAmount: quest.rewardCc || 0,
          rewardToken: quest.rewardToken,
          rewardVariant: quest.rewardType === RewardType.CC_ONLY ? 'CC' : 'CODE',
          fcfsClaimLockedAt: new Date(),
        },
      });
    } catch (err) {
      // P2002 = peminang lain memenangkan race utk slot ini (user sama beda
      // request, atau kuota habis secara bersamaan) — tolak jelas.
      const code = (err as { code?: string })?.code;
      if (code === 'P2002') {
        return { ok: false, error: 'Kuota pemenang FCFS sudah penuh', reason: 'SLOTS_FULL' };
      }
      throw err;
    }
    return this.createOfferForWinner(questId, userId);
  }

  private resolveFee(quest: { claimFeeCc?: number | null; rewardType: string }): number {
    const fee = quest.claimFeeCc ?? null;
    if (fee != null && fee > 0) return fee;
    // Default lama dapp: 2 utk klaim kode, 3 utk FCFS token (kolom claimFeeCc comment).
    return quest.rewardType === RewardType.INVITE_CODE_FCFS ? 3 : 2;
  }

  /**
   * Registry v2 dengan fallback v1 — mirror quest-ledger registryWithFallback
   * (terbukti MainNet): scan-proxy node ini tidak menyajikan endpoint v2
   * (404), tapi factory contract-nya SAMA (implement interface v1+v2) dan
   * choiceContextData hasil v1 dipakai apa adanya sebagai extraArgs.context.
   * Payload v1: sender/receiver Party string + lock:null, TANPA actors.
   */
  private async registryFor(
    v2Payload: Record<string, unknown>,
    instrumentAdmin: string,
  ): Promise<{
    factoryId: string;
    choiceContextData: Record<string, unknown>;
    disclosedContracts: unknown[];
    transferKind: string;
  } | null> {
    const v2 = await this.ledger.callTransferFactoryRegistry(v2Payload, instrumentAdmin, 'v2');
    if (v2) return v2;
    this.logger.warn(
      'Registry v2 tidak tersedia (scan-proxy 404) — fallback ke registry v1 (pola v29 settleAtomic)',
    );
    // Turunkan payload ke shape V1 (transfer V2 Account → Party string).
    const toV1 = (p: Record<string, unknown>): Record<string, unknown> => {
      const out: Record<string, unknown> = { ...p };
      delete out.actors;
      const tr = p.transfer as Record<string, unknown> | undefined;
      if (tr) {
        const sender = typeof tr.sender === 'string' ? tr.sender : (tr.sender as { owner?: string })?.owner;
        const receiver =
          typeof tr.receiver === 'string' ? tr.receiver : (tr.receiver as { owner?: string })?.owner;
        out.transfer = { ...tr, sender, receiver, lock: null };
      }
      return out;
    };
    return this.ledger.callTransferFactoryRegistry(toV1(v2Payload), instrumentAdmin, 'v1');
  }

  // ── 2. Bangun Accept* utk user (dipanggil signing relay) ──────────────────

  /**
   * SATU ExerciseCommand AcceptCodeClaim / AcceptTokenClaim — controller user
   * sendirian; otoritas rewardSender diwarisi signatory offer. Fee leg selalu
   * CC dari holdings user; reward leg dari holdings rewardSender.
   */
  async buildAcceptClaimOffer(
    userId: string,
    params: Record<string, unknown>,
  ): Promise<V30BuiltFlow> {
    if (!v30Enabled(this.config)) throw new BadRequestException('v30 claim disabled');
    this.assertConfigured();
    const questId = typeof params.questId === 'string' ? params.questId : '';
    if (!questId) throw new BadRequestException('questId is required');

    const [quest, draw] = await Promise.all([
      this.prisma.quest.findUnique({ where: { id: questId } }),
      this.prisma.winnerDraw.findUnique({ where: { questId_userId: { questId, userId } } }),
    ]);
    if (!quest || !isV30Quest(quest)) throw new BadRequestException('Quest bukan jalur v30');
    if (!draw?.offerContractId) throw new BadRequestException('Belum ada ClaimOffer utk klaim ini');
    if (draw.claimStatus && draw.claimStatus !== 'PreSettle') {
      throw new BadRequestException(`Klaim sudah diproses (status: ${draw.claimStatus})`);
    }
    const validUntil = draw.validUntil ?? new Date();
    if (validUntil.getTime() <= Date.now()) {
      throw new BadRequestException('Offer kedaluwarsa (48 jam sejak undian) — hubungi operator.');
    }

    const user = await this.users.findById(userId);
    if (!user?.cantonPartyId) throw new BadRequestException('Wallet tidak ditemukan');
    const userParty = user.cantonPartyId;

    const kindLabel = (draw.rewardKind ?? '') as V30RewardKindLabel;
    const hasToken = kindLabel === 'TOKEN_ONLY' || kindLabel === 'TOKEN_AND_CODE';
    const feeAmount = this.resolveFee(quest);

    // ── FEE leg: user → feeReceiver (CC) ────────────────────────────────────
    const feeHoldings = await this.ledger.queryAmuletHoldings(userParty);
    const feeInputCids = greedyFill(feeHoldings, feeAmount);
    if (feeInputCids.length === 0) {
      throw new BadRequestException(
        `Saldo CC bebas tidak cukup utk fee ${feeAmount} CC — buka lock / top up dulu. (UI-STATES: cek SEBELUM tanda tangan)`,
      );
    }
    const nowIso = new Date().toISOString();
    const executeBefore = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const feeCommon = {
      amount: feeAmount.toFixed(10),
      instrumentId: { admin: this.dsoParty, id: 'Amulet' },
      requestedAt: nowIso,
      executeBefore,
      inputHoldingCids: feeInputCids,
      meta: { values: {} },
    };
    const feeTransfer = {
      sender: v30Account(userParty),
      receiver: v30Account(this.feeReceiverParty),
      ...feeCommon,
    };
    const feeRegistry = await this.registryFor(
      {
        expectedAdmin: this.dsoParty,
        actors: [userParty],
        transfer: feeTransfer,
        extraArgs: { context: { values: {} }, meta: { values: {} } },
      },
      this.dsoParty,
    );
    if (!feeRegistry) throw new BadRequestException('Registry fee (CC) tidak merespons');

    // ── REWARD leg (bila Token*): rewardSender → user ───────────────────────
    let rewardRegistry: { factoryId: string; choiceContextData: Record<string, unknown>; disclosedContracts: unknown[] } | null = null;
    let rewardTransfer: Record<string, unknown> | null = null;
    let rewardInputsForDisclosure: string[] = [];
    if (hasToken) {
      const rewardSymbol = normalizeRewardToken(quest.rewardToken);
      const instrument = await this.instruments.resolveInstrument(rewardSymbol);
      const rewardAmount = draw.ccAmount || quest.rewardCc || 0;
      const rewardHoldings =
        instrument.instrumentId.toLowerCase() === 'amulet'
          ? await this.ledger.queryAmuletHoldings(this.rewardSenderParty)
          : await this.ledger.getTokenHoldingCids(this.rewardSenderParty, instrument.instrumentId);
      const rewardInputs = greedyFill(rewardHoldings, rewardAmount);
      if (rewardInputs.length === 0) {
        throw new BadRequestException(
          `Reward wallet kekurangan ${instrument.instrumentId} — laporkan ke operator (GUIDE §monitoring saldo reward)`,
        );
      }
      rewardInputsForDisclosure = rewardInputs;
      const rewardCommon = {
        amount: rewardAmount.toFixed(10),
        instrumentId: { admin: instrument.instrumentAdmin, id: instrument.instrumentId },
        requestedAt: nowIso,
        executeBefore,
        inputHoldingCids: rewardInputs,
        meta: { values: {} },
      };
      rewardTransfer = {
        sender: v30Account(this.rewardSenderParty),
        receiver: v30Account(userParty),
        ...rewardCommon,
      };
      rewardRegistry = await this.registryFor(
        {
          expectedAdmin: instrument.instrumentAdmin,
          actors: [this.rewardSenderParty],
          transfer: rewardTransfer,
          extraArgs: { context: { values: {} }, meta: { values: {} } },
        },
        instrument.instrumentAdmin,
      );
      if (!rewardRegistry) throw new BadRequestException('Registry reward tidak merespons');
    }

    const safeCtx = (ctx: Record<string, unknown> | null | undefined) =>
      ctx && Object.keys(ctx).length > 0 ? ctx : { values: {} };
    // Activity marker fee leg: default OFF — FeaturedAppRight di paket v30 adalah
    // v2 (data-dep splice-api-featured-app-v2), cid-nya harus diverifikasi
    // bertipe V2 sebelum dipakai. Nyalakan via CANTON_V30_FEE_MARKER_FAR_CID.
    const farCid = this.config.get<string>('CANTON_V30_FEE_MARKER_FAR_CID')?.trim() || null;

    const choiceArgument = hasToken
      ? {
          feeFactoryCid: feeRegistry.factoryId,
          feeTransfer,
          feeExtraArgs: { context: safeCtx(feeRegistry.choiceContextData), meta: { values: {} } },
          rewardFactoryCid: rewardRegistry!.factoryId,
          rewardTransfer,
          rewardExtraArgs: { context: safeCtx(rewardRegistry!.choiceContextData), meta: { values: {} } },
          featuredAppRightCid: farCid,
        }
      : {
          feeFactoryCid: feeRegistry.factoryId,
          feeTransfer,
          feeExtraArgs: { context: safeCtx(feeRegistry.choiceContextData), meta: { values: {} } },
          featuredAppRightCid: farCid,
        };

    const disclosed = [...feeRegistry.disclosedContracts];
    if (rewardRegistry) disclosed.push(...rewardRegistry.disclosedContracts);
    // DISCLOSURE amulet input REWARD WALLET: submitter = user external —
    // amulet milik rewardSender tidak ada di ACS user → tanpa disclosure,
    // prepare gagal CONTRACT_NOT_FOUND (nested exercise reward leg di dalam
    // Accept* memakan input tsb). Fee inputs = amulet user sendiri (submitter)
    // → sudah terlihat, tidak perlu disclosure.
    if (hasToken && rewardInputsForDisclosure.length > 0) {
      const rewardOwner = this.rewardSenderParty;
      const blobs = await this.ledger.fetchContractsForDisclosure(rewardOwner, rewardInputsForDisclosure);
      if (blobs.length !== rewardInputsForDisclosure.length) {
        throw new BadRequestException(
          `Disclosure amulet reward gagal (${blobs.length}/${rewardInputsForDisclosure.length}) — coba lagi sebentar (ACS index).`,
        );
      }
      disclosed.push(...blobs);
    }

    return {
      commands: [
        {
          ExerciseCommand: {
            templateId: v30ClaimTemplateId(this.config, 'ClaimOffer'),
            contractId: draw.offerContractId!,
            choice: hasToken ? 'AcceptTokenClaim' : 'AcceptCodeClaim',
            choiceArgument,
          },
        },
      ],
      disclosedContracts: disclosed,
      commandId: `v30-accept-${createHashShort(draw.id + randomUUID())}`,
      meta: {
        winnerDrawId: draw.id,
        questId,
        rewardKind: kindLabel,
        feeAmount,
        offerContractId: draw.offerContractId,
      },
      description: hasToken
        ? `Claim reward (fee ${feeAmount} CC)`
        : `Claim invite code (fee ${feeAmount} CC)`,
    };
  }

  // ── 3. Pasca-execute: sinkron receipt + auto-RevealCode ───────────────────

  /** Dipanggil signing-relay setelah execute sukses. Tidak boleh throw. */
  async onAcceptExecuted(
    userId: string,
    meta: Record<string, unknown>,
    result: { updateId?: string } | undefined,
  ): Promise<void> {
    const drawId = String(meta.winnerDrawId ?? '');
    if (!drawId) return;
    try {
      await this.syncReceiptFromLedger(drawId);
      const draw = await this.prisma.winnerDraw.findUnique({ where: { id: drawId } });
      if (draw?.claimStatus === 'Settled' && draw.rewardKind !== 'TOKEN_ONLY') {
        await this.revealIfSettled(draw.questId, draw.userId);
      }
      this.logger.log(
        `accept_claim_offer sukses draw=${drawId.slice(0, 8)}… update=${result?.updateId?.slice(0, 16) ?? '?'} status=${draw?.claimStatus ?? '?'}`,
      );
    } catch (err) {
      // On-chain sudah nyata — kegagalan sinkronisasi hanya di-log keras;
      // job reward-pending monitor + endpoint status akan backfill.
      this.logger.error(
        `⚠️ AUDIT-TRAIL LOSS: accept_claim_offer on-chain sukses (${result?.updateId ?? 'n/a'}) draw=${drawId} — sync gagal: ${String(err).slice(0, 180)}`,
      );
    }
  }

  /** Baca ClaimReceipt dari ledger (ACS party user) → mirror ke WinnerDraw. */
  async syncReceiptFromLedger(drawId: string): Promise<{
    claimStatus: string | null;
    receiptContractId: string | null;
  }> {
    const draw = await this.prisma.winnerDraw.findUnique({ where: { id: drawId } });
    if (!draw?.claimId) return { claimStatus: null, receiptContractId: null };
    const user = await this.users.findById(draw.userId);
    if (!user?.cantonPartyId) return { claimStatus: null, receiptContractId: null };

    const receipt = await this.findReceiptOnChain(draw.claimId, user.cantonPartyId);
    if (!receipt) return { claimStatus: draw.claimStatus, receiptContractId: draw.receiptContractId };

    await this.prisma.winnerDraw.update({
      where: { id: drawId },
      data: {
        receiptContractId: receipt.contractId,
        claimStatus: receipt.status,
        revealedCode: receipt.revealedCode ?? draw.revealedCode,
      },
    });
    return { claimStatus: receipt.status, receiptContractId: receipt.contractId };
  }

  /** Cari ClaimReceipt aktif di ACS user berdasarkan claimId (payload match). */
  private async findReceiptOnChain(
    claimId: string,
    userParty: string,
  ): Promise<{
    contractId: string;
    status: string;
    rewardTokenSent: boolean;
    revealedCode: string | null;
  } | null> {
    const templateId = v30ClaimTemplateId(this.config, 'ClaimReceipt');
    const contracts = await this.ledger.queryContractsByTemplate(
      userParty,
      templateId,
    );
    for (const c of contracts) {
      if (c.payload?.claimId === claimId) {
        return {
          contractId: c.contractId,
          status: parseVariantTag(c.payload?.status) ?? 'PreSettle',
          rewardTokenSent: c.payload?.rewardTokenSent === true,
          revealedCode:
            typeof c.payload?.revealedCode === 'string' && c.payload.revealedCode
              ? c.payload.revealedCode
              : null,
        };
      }
    }
    return null;
  }

  /**
   * RevealCode — controller admin. Idempoten: status sudah Revealed → return kode.
   * Plaintext diambil dari WinnerDraw.inviteCode (hash-nya dikomit pra-undian).
   */
  async revealIfSettled(questId: string, userId: string): Promise<{ code: string | null; status: string | null }> {
    const draw = await this.prisma.winnerDraw.findUnique({
      where: { questId_userId: { questId, userId } },
    });
    if (!draw?.receiptContractId) return { code: null, status: draw?.claimStatus ?? null };
    if (draw.claimStatus === 'Revealed' && draw.revealedCode) {
      return { code: draw.revealedCode, status: 'Revealed' };
    }
    if (draw.claimStatus !== 'Settled' && draw.claimStatus !== 'RewardPending') {
      return { code: null, status: draw.claimStatus };
    }
    const plaintext = draw.inviteCode;
    if (!plaintext) return { code: null, status: draw.claimStatus };

    const res = await this.ledger.exerciseChoice(
      draw.receiptContractId,
      v30ClaimTemplateId(this.config, 'ClaimReceipt'),
      'RevealCode',
      { plaintext },
      [this.validatorParty],
      `v30-reveal-${createHashShort(draw.id)}`,
    );
    if (!res.ok) {
      this.logger.warn(`RevealCode gagal draw=${draw.id}: ${res.text.slice(0, 160)}`);
      return { code: null, status: draw.claimStatus };
    }
    await this.prisma.winnerDraw.update({
      where: { id: draw.id },
      data: { claimStatus: 'Revealed', revealedCode: plaintext },
    });
    return { code: plaintext, status: 'Revealed' };
  }

  /** WithdrawOffer — controller admin, offer belum dikonsumsi. */
  async withdrawOffer(offerContractId: string, reason: string): Promise<{ ok: boolean; error?: string }> {
    if (!reason.trim()) throw new BadRequestException('reason wajib non-empty (kontrak ensure)');
    const res = await this.ledger.exerciseChoice(
      offerContractId,
      v30ClaimTemplateId(this.config, 'ClaimOffer'),
      'WithdrawOffer',
      { reason },
      [this.validatorParty],
      `v30-withdraw-${createHashShort(offerContractId)}`,
    );
    if (!res.ok) return { ok: false, error: res.text.slice(0, 200) };
    await this.prisma.winnerDraw.updateMany({
      where: { offerContractId },
      data: { claimStatus: 'Withdrawn' },
    });
    return { ok: true };
  }

  /** ConfirmRewardReceived — user menerima reward lewat menu offer. */
  async confirmRewardReceived(receiptContractId: string): Promise<{ ok: boolean; error?: string }> {
    const res = await this.ledger.exerciseChoice(
      receiptContractId,
      v30ClaimTemplateId(this.config, 'ClaimReceipt'),
      'ConfirmRewardReceived',
      { confirmedAt: new Date().toISOString() },
      [this.validatorParty],
      `v30-confirm-${createHashShort(receiptContractId)}`,
    );
    if (!res.ok) return { ok: false, error: res.text.slice(0, 200) };
    await this.prisma.winnerDraw.updateMany({
      where: { receiptContractId },
      data: { claimStatus: 'Settled', rewardClosedAt: new Date() },
    });
    return { ok: true };
  }

  /** MarkRewardExpired — reward hangus, fee TIDAK dikembalikan kontrak. */
  async markRewardExpired(receiptContractId: string, reason: string): Promise<{ ok: boolean; error?: string }> {
    const res = await this.ledger.exerciseChoice(
      receiptContractId,
      v30ClaimTemplateId(this.config, 'ClaimReceipt'),
      'MarkRewardExpired',
      { reason, expiredAt: new Date().toISOString() },
      [this.validatorParty],
      `v30-expire-${createHashShort(receiptContractId)}`,
    );
    if (!res.ok) return { ok: false, error: res.text.slice(0, 200) };
    await this.prisma.winnerDraw.updateMany({
      where: { receiptContractId },
      data: { claimStatus: 'RewardExpired', rewardClosedAt: new Date() },
    });
    return { ok: true };
  }

  // ── 4. Status + pre-checks (endpoint GET claim-v30/status) ────────────────

  /**
   * Pre-checks SEBELUM tombol claim ditampilkan (UI-STATES.md — cek sebelum
   * user menandatangani, bukan setelah transaksi gagal):
   *   - saldo CC bebas >= fee (kurang → arahkan unlock dulu)
   *   - preapproval aktif (tidak → warning reward masuk menu offer)
   */
  async claimStatus(questId: string, userId: string): Promise<{
    v30: true;
    offer: {
      exists: boolean;
      claimStatus: string | null;
      rewardKind: string | null;
      validUntil: string | null;
      expired: boolean;
    };
    revealedCode: string | null;
    prechecks: {
      freeBalanceCc: number;
      feeCc: number;
      balanceOk: boolean;
      preapprovalActive: boolean;
      preapprovalExpiresAt: string | null;
    };
    uiHint: 'CLAIM_READY' | 'NEED_UNLOCK_OR_TOPUP' | 'NO_PREAPPROVAL_WARN' | 'OFFER_EXPIRED' | 'NOT_DRAWN' | 'DONE';
  }> {
    const [quest, draw] = await Promise.all([
      this.prisma.quest.findUnique({ where: { id: questId } }),
      this.prisma.winnerDraw.findUnique({ where: { questId_userId: { questId, userId } } }),
    ]);
    if (!quest || !isV30Quest(quest)) throw new BadRequestException('Quest bukan jalur v30');

    // Refresh dari ledger bila offer sudah dikonsumsi (async, best-effort).
    if (draw?.receiptContractId) {
      await this.syncReceiptFromLedger(draw.id).catch(() => undefined);
    }
    const fresh = draw
      ? await this.prisma.winnerDraw.findUnique({ where: { id: draw.id } })
      : null;

    const user = await this.users.findById(userId);
    const userParty = user?.cantonPartyId ?? '';
    const feeCc = this.resolveFee(quest);

    let freeBalanceCc = 0;
    let preapprovalActive = false;
    let preapprovalExpiresAt: string | null = null;
    if (userParty) {
      try {
        const holdings = await this.ledger.queryAmuletHoldings(userParty);
        freeBalanceCc = holdings.reduce((s, h) => s + (parseFloat(h.amount) || 0), 0);
      } catch {
        /* baca gagal → 0 → UI memaksa user cek manual; jangan blokir dgn error */
      }
      try {
        const pa = await this.ledger.getTransferPreapprovalAuthoritative(userParty);
        preapprovalActive = pa.active;
        preapprovalExpiresAt = pa.expiresAt ?? null;
      } catch {
        /* status unknown → anggap tidak aktif (warn) */
      }
    }

    const validUntil = fresh?.validUntil ?? null;
    const expired = !!validUntil && new Date(validUntil).getTime() <= Date.now();
    const status = fresh?.claimStatus ?? null;

    let uiHint: 'CLAIM_READY' | 'NEED_UNLOCK_OR_TOPUP' | 'NO_PREAPPROVAL_WARN' | 'OFFER_EXPIRED' | 'NOT_DRAWN' | 'DONE' = 'NOT_DRAWN';
    if (!fresh?.offerContractId && !fresh?.receiptContractId) uiHint = 'NOT_DRAWN';
    else if (status && status !== 'PreSettle' && status !== 'Withdrawn') uiHint = 'DONE';
    else if (expired) uiHint = 'OFFER_EXPIRED';
    else if (freeBalanceCc < feeCc) uiHint = 'NEED_UNLOCK_OR_TOPUP';
    else if (!preapprovalActive) uiHint = 'NO_PREAPPROVAL_WARN';
    else uiHint = 'CLAIM_READY';

    return {
      v30: true,
      offer: {
        exists: !!fresh?.offerContractId,
        claimStatus: status,
        rewardKind: fresh?.rewardKind ?? null,
        validUntil: validUntil ? new Date(validUntil).toISOString() : null,
        expired,
      },
      revealedCode: fresh?.revealedCode ?? null,
      prechecks: {
        freeBalanceCc: Math.floor(freeBalanceCc * 10_000) / 10_000,
        feeCc,
        balanceOk: freeBalanceCc >= feeCc,
        preapprovalActive,
        preapprovalExpiresAt,
      },
      uiHint,
    };
  }

  /** Pastikan user ledger admin memegang actAs rewardSender (svc-offer). */
  async ensureOfferRights(): Promise<void> {
    try {
      await this.ledger.grantUserRights(this.rewardSenderParty);
    } catch (err) {
      this.logger.warn(`grantUserRights(rewardSender) gagal: ${String(err).slice(0, 120)}`);
    }
  }

  /** Job monitor: semua WinnerDraw RewardPending (lihat v30-jobs.service). */
  async listRewardPending(): Promise<
    Array<{
      id: string;
      questId: string;
      userId: string;
      receiptContractId: string;
      validUntil: Date | null;
      rewardAmountCc: number;
      rewardToken: string;
    }>
  > {
    const rows = await this.prisma.winnerDraw.findMany({
      where: { claimStatus: 'RewardPending', receiptContractId: { not: null } },
      select: {
        id: true,
        questId: true,
        userId: true,
        receiptContractId: true,
        validUntil: true,
        ccAmount: true,
        rewardToken: true,
      },
      take: 100,
    });
    return rows.map((r) => ({
      id: r.id,
      questId: r.questId,
      userId: r.userId,
      receiptContractId: r.receiptContractId as string,
      validUntil: r.validUntil,
      rewardAmountCc: r.ccAmount,
      rewardToken: r.rewardToken,
    }));
  }
}

// ── local helpers ───────────────────────────────────────────────────────────

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

function createHashShort(seed: string): string {
  return createHash('sha256').update(seed).digest('hex').slice(0, 24);
}

/** DAML-LF JSON variant → nama tag ({"tag":"Settled"} | {"tag":"X","value":…}). */
function parseVariantTag(v: unknown): string | null {
  if (v && typeof v === 'object' && 'tag' in v) {
    const tag = (v as { tag?: unknown }).tag;
    if (typeof tag === 'string') return tag;
  }
  return null;
}
