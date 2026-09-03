import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { CantonLedgerService } from '../canton-ledger.service';
import { ClaimOfferService } from './claim-offer.service';
import { LockProposalService } from './lock-proposal.service';
import {
  V30_PREAPPROVAL_LIFETIME_DAYS,
  V30_PREAPPROVAL_RENEWAL_MARGIN_DAYS,
  isV30Quest,
  v30Enabled,
  v30T1At,
} from './v30.constants';

/**
 * Job latar v30 (ROADMAP Tahap 3 — "sebelum launch", AGENT.md "Job yang harus
 * jalan"). Semua pola poller setInterval unref + jitter (mirror fee-accepter).
 *
 *   1. PREAPPROVAL RENEWAL (harian)
 *      TransferPreapproval_Renew HANYA bisa SEBELUM kedaluwarsa
 *      (assertWithinDeadline). Terlewat = preapproval hangus permanen utk user
 *      tidak aktif (pembuatan ulang butuh tanda tangan user). Karena itu:
 *      ALERT selalu; exercise Renew hanya bila
 *      V30_PREAPPROVAL_RENEWAL_ENABLED=true (renew membakar ~1.5 CC provider
 *      per preapproval — operator menyalakan secara sadar).
 *
 *   2. LOCK EXPIRY (harian)
 *      Lewatnya expiresAt TIDAK melepas holding dengan sendirinya. Choice
 *      OwnerExpireLockV2 controller OWNER — backend tidak bisa (dan tidak
 *      boleh) menandatangani utk user external. Jaring pengaman = backfill
 *      baris CcLock (supaya tombol unlock muncul di wallet) + penanda record.
 *
 *   3. REWARD PENDING MONITOR (menerus)
 *      Receipt RewardPending tidak berubah sendiri. Evidence = TransferInstruction
 *      reward di ACS user: masih ada & lewat executeBefore → MarkRewardExpired;
 *      sudah hilang (diterima via offer menu) → ConfirmRewardReceived.
 *      Tanpa ini receipt selamanya berkata RewardPending (UI-STATES.md).
 */
@Injectable()
export class V30JobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(V30JobsService.name);
  private timers: NodeJS.Timeout[] = [];
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly ledger: CantonLedgerService,
    private readonly claims: ClaimOfferService,
    private readonly locks: LockProposalService,
  ) {}

  onModuleInit(): void {
    if (!v30Enabled(this.config)) {
      this.logger.log('CLAIM_V30_ENABLED=false — job v30 tidak aktif');
      return;
    }
    // Harian (renewal + expiry) — jitter supaya tidak bareng poller lain.
    const dayMs = 24 * 60 * 60 * 1000;
    this.timers.push(setTimeout(() => this.dailyTick(), 60_000 + Math.random() * 60_000));
    const daily = setInterval(() => this.dailyTick(), dayMs);
    daily.unref?.();
    this.timers.push(daily);

    // Reward-pending monitor — tiap 5 menit.
    const monitor = setInterval(() => void this.rewardPendingTick(), 5 * 60_000);
    monitor.unref?.();
    this.timers.push(monitor);

    // T1 (70% durasi) — tiap 10 menit: tutup pendaftaran + re-verifikasi lock.
    const t1 = setInterval(() => void this.t1Tick(), 10 * 60_000);
    t1.unref?.();
    this.timers.push(t1);

    // T2 sweep — tiap 10 menit: buat ClaimOffer utk pemenang event yang sudah
    // berakhir (FCFS winners + raffle yang kelewatan hook draw).
    const t2 = setInterval(() => void this.offerCreationTick(), 10 * 60_000);
    t2.unref?.();
    this.timers.push(t2);

    // Offer hangus (§7 spesifikasi) — tiap 30 menit: lewat 7 hari → arsip
    // (WithdrawOffer) + kode kembali ke pool.
    const exp = setInterval(() => void this.expiredOfferTick(), 30 * 60_000);
    exp.unref?.();
    this.timers.push(exp);

    this.logger.log(
      'Job v30 aktif: preapproval-renewal(harian) + lock-expiry(harian) + reward-pending(5m) + T1-close(10m) + T2-offer(10m) + offer-expiry(30m)',
    );
  }

  onModuleDestroy(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  // ── 1. Preapproval renewal ────────────────────────────────────────────────

  private async dailyTick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.renewPreapprovals();
      await this.expireLocks();
    } catch (err) {
      this.logger.error(`dailyTick error: ${String(err).slice(0, 200)}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Perpanjang preapproval user external yang sisa masa-aktifnya < margin.
   * ALERT (log ERROR + return list) bila gagal — cron diam-diam adalah bug
   * SECURITY.md §3.6, bukan fitur.
   */
  async renewPreapprovals(): Promise<{ scanned: number; renewed: number; alerts: string[] }> {
    const alerts: string[] = [];
    const exerciseEnabled =
      this.config.get<string>('V30_PREAPPROVAL_RENEWAL_ENABLED') === 'true';
    const marginMs = V30_PREAPPROVAL_RENEWAL_MARGIN_DAYS * 24 * 60 * 60 * 1000;

    const users = await this.prisma.user.findMany({
      where: { walletKind: 'external', cantonPartyId: { not: null }, status: 'ACTIVE' },
      select: { id: true, cantonPartyId: true },
      take: 500,
    });
    let renewed = 0;
    let scanned = 0;

    for (const u of users) {
      const partyId = u.cantonPartyId!;
      let status: Awaited<ReturnType<CantonLedgerService['getTransferPreapprovalAuthoritative']>>;
      try {
        status = await this.ledger.getTransferPreapprovalAuthoritative(partyId);
      } catch (err) {
        alerts.push(`user=${u.id.slice(0, 8)}… cek preapproval gagal: ${String(err).slice(0, 80)}`);
        continue;
      }
      scanned++;
      if (!status.active || !status.expiresAt) continue;
      const expiresIn = Date.parse(status.expiresAt) - Date.now();
      if (expiresIn > marginMs) continue;

      if (!exerciseEnabled) {
        alerts.push(
          `user=${u.id.slice(0, 8)}… preapproval habis ${status.expiresAt} (< ${V30_PREAPPROVAL_RENEWAL_MARGIN_DAYS} hari) — ` +
            `RENEW BELUM DIKETIK (V30_PREAPPROVAL_RENEWAL_ENABLED=false). Terlewat = hangus permanen utk user tidak aktif.`,
        );
        continue;
      }
      const ok = await this.exerciseRenew(partyId, status.contractId, status.templateId);
      if (ok) renewed++;
      else {
        alerts.push(
          `user=${u.id.slice(0, 8)}… TransferPreapproval_Renew GAGAL (cid=${status.contractId?.slice(0, 14)}…, ` +
            `habis ${status.expiresAt}) — SEGERA periksa: hanya bisa diperpanjang SEBELUM kedaluwarsa.`,
        );
      }
    }
    if (alerts.length > 0) {
      this.logger.error(`⚠️ PREAPPROVAL RENEWAL — ${alerts.length} alert:\n  - ${alerts.join('\n  - ')}`);
    } else {
      this.logger.log(`preapproval-renewal: scanned=${scanned} renewed=${renewed} (semaya sehat)`);
    }
    return { scanned, renewed, alerts };
  }

  /** Exercise TransferPreapproval_Renew — controller provider (validator). */
  private async exerciseRenew(
    partyId: string,
    contractId?: string,
    templateId?: string,
  ): Promise<boolean> {
    try {
      if (!contractId || !templateId) return false;
      const provider = this.config.get<string>('CANTON_VALIDATOR_PARTY_ID')?.trim();
      if (!provider) return false;

      // Context + input pembayaran — mirror createTransferPreapprovalViaLedger.
      const amuletRules = await this.ledger.fetchScanProxyContract('amulet-rules');
      const openRound = await this.ledger.fetchScanProxyContract('open-and-issuing-mining-rounds');
      if (!amuletRules || !openRound) return false;
      const holdings = await this.ledger.queryAmuletHoldingsRaw(provider);
      const round = openRound.round ?? 0;
      const scored = holdings
        .map((h) => {
          const init = parseFloat(h.initialAmount) || 0;
          const rate = parseFloat(h.ratePerRound) || 0;
          const decay = Math.max(0, round - (h.createdAtRound || 0)) * rate;
          return { cid: h.contractId, eff: Math.max(0, init - decay) };
        })
        .sort((a, b) => b.eff - a.eff);
      if (scored.length === 0 || scored[0].eff < 2) {
        this.logger.error(
          `renew: provider tidak punya Amulet cukup utk bayar renewal (party=${partyId.split('::')[0]})`,
        );
        return false;
      }

      const newExpiresAt = new Date(
        Date.now() + V30_PREAPPROVAL_LIFETIME_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString();
      const choiceArgument = {
        context: {
          amuletRules: amuletRules.contractId,
          context: {
            openMiningRound: openRound.contractId,
            issuingMiningRounds: [],
            validatorRights: [],
          },
        },
        inputs: [{ tag: 'InputAmulet', value: scored[0].cid }],
        newExpiresAt,
      };
      const res = await this.ledger.exerciseChoice(
        contractId,
        templateId,
        'TransferPreapproval_Renew',
        choiceArgument,
        [provider],
        `v30-renew-${partyId.split('::')[0]}-${Date.now()}`,
        undefined,
        [
          { templateId: amuletRules.templateId, contractId: amuletRules.contractId, createdEventBlob: amuletRules.blob },
          { templateId: openRound.templateId, contractId: openRound.contractId, createdEventBlob: openRound.blob },
        ],
      );
      if (!res.ok) {
        this.logger.warn(`renew gagal party=${partyId.split('::')[0]}: ${res.text.slice(0, 160)}`);
        return false;
      }
      this.logger.log(`preapproval diperpanjang → ${newExpiresAt} (party=${partyId.split('::')[0]})`);
      return true;
    } catch (err) {
      this.logger.warn(`exerciseRenew error: ${String(err).slice(0, 120)}`);
      return false;
    }
  }

  // ── 2. Lock expiry ────────────────────────────────────────────────────────

  /**
   * Jaring pengaman lewat-T2: pastikan baris CcLock ada (tombol unlock muncul
   * di wallet UI) dan tandai record yang holding-nya sudah hilang.
   * OwnerExpireLockV2 controller OWNER — user menekan tombolnya sendiri.
   */
  async expireLocks(): Promise<{ checked: number; backfilled: number; cleaned: number }> {
    const records = await this.prisma.lockProposalRecord.findMany({
      where: { status: 'ACCEPTED', expiresAt: { lt: new Date() } },
      take: 200,
    });
    let backfilled = 0;
    let cleaned = 0;
    for (const record of records) {
      const ccLock = record.lockedAmuletCid
        ? await this.prisma.ccLock.findUnique({ where: { lockedAmuletCid: record.lockedAmuletCid } })
        : null;
      if (!ccLock && record.lockedAmuletCid) {
        // On-chain sukses tapi mirror gagal dulu — backfill sekarang.
        const v = await this.locks.verifyAndRecord(record.id).catch(() => null);
        if (v?.ok) backfilled++;
      }
      // Holding hilang dari ACS (dikunyah transfer / unlock di wallet lain)?
      try {
        const user = await this.prisma.user.findUnique({
          where: { id: record.userId },
          select: { cantonPartyId: true },
        });
        if (user?.cantonPartyId) {
          const locks = await this.ledger.findLockedAmulets(user.cantonPartyId);
          const stillActive = locks.some((l) => l.contractId === record.lockedAmuletCid);
          if (!stillActive) {
            await this.locks.onLockedAmuletUnlocked(record.lockedAmuletCid!);
            cleaned++;
          }
        }
      } catch {
        /* best-effort */
      }
    }
    if (records.length > 0) {
      this.logger.log(
        `lock-expiry: checked=${records.length} backfilled=${backfilled} cleaned=${cleaned} ` +
          `(unlock = tombol user; lewat-T2 otomatis boleh — assertDeadlineExceeded yang menolak sebelum T2)`,
      );
    }
    return { checked: records.length, backfilled, cleaned };
  }

  // ── 4. T1 — penutupan pendaftaran otomatis (70% durasi) ────────────────────

  /**
   * Fase 4 spesifikasi owner: pada T1 (70% durasi), pendaftaran ditutup dan
   * SELURUH lock peserta diverifikasi ulang — peserta yang early-unlock
   * (UnlockV2 tanpa cek waktu) dicabut eligibility-nya sebelum undian.
   * setelah T1, LockProposalService.createProposal menolak lock baru
   * (guard waktu + flag v30RegistrationClosedAt yang di-set di sini).
   */
  async t1Tick(): Promise<{ closed: number; revoked: number }> {
    let closed = 0;
    let revoked = 0;
    try {
      const quests = await this.prisma.quest.findMany({
        where: {
          ledgerPackage: 'canquest-v30',
          status: 'ACTIVE',
          v30RegistrationClosedAt: null,
          startsAt: { not: null },
          endsAt: { not: null },
        },
        select: { id: true, startsAt: true, endsAt: true },
        take: 100,
      });
      for (const q of quests) {
        const t1 = v30T1At(q.startsAt, q.endsAt);
        if (!t1 || Date.now() < t1.getTime()) continue;
        const res = await this.locks.reVerifyQuestLocks(q.id).catch(() => null);
        if (res) revoked += res.revoked;
        await this.prisma.quest.update({
          where: { id: q.id },
          data: { v30RegistrationClosedAt: new Date() },
        });
        closed++;
        this.logger.log(
          `T1 quest=${q.id.slice(0, 8)}…: pendaftaran DITUTUP — re-verify: checked=${res?.checked ?? '?'} revoked=${res?.revoked ?? '?'}`,
        );
      }
    } catch (err) {
      this.logger.error(`t1Tick error: ${String(err).slice(0, 160)}`);
    }
    return { closed, revoked };
  }

  // ── 5. T2 — pembuatan offer utk pemenang event berakhir ───────────────────

  /**
   * §4 spesifikasi owner: "Untuk setiap pemenang, backend membuat satu
   * ClaimOffer" saat event berakhir. Raffle biasanya dapat offer dari hook
   * drawWinners; sweep ini menutup celah: FCFS (winner sejak submit, tanpa
   * draw) dan raffle yang hook-nya gagal. validUntil = 7 hari sekarang.
   */
  async offerCreationTick(): Promise<{ quests: number; offers: number }> {
    let offers = 0;
    let quests = 0;
    try {
      const ended = await this.prisma.quest.findMany({
        where: {
          ledgerPackage: 'canquest-v30',
          OR: [{ status: 'ENDED' }, { endsAt: { lte: new Date() } }],
        },
        select: { id: true },
        take: 50,
      });
      for (const q of ended) {
        const pending = await this.prisma.winnerDraw.findMany({
          where: { questId: q.id, offerContractId: null, claimStatus: null },
          select: { userId: true },
          take: 100,
        });
        if (pending.length === 0) continue;
        quests++;
        for (const w of pending) {
          const made = await this.claims.createOfferForWinner(q.id, w.userId);
          if (made.ok) offers++;
          else {
            this.logger.warn(
              `T2 offer quest=${q.id.slice(0, 8)}… user=${w.userId.slice(0, 8)}… GAGAL: ${made.error}`,
            );
          }
        }
      }
    } catch (err) {
      this.logger.error(`offerCreationTick error: ${String(err).slice(0, 160)}`);
    }
    return { quests, offers };
  }

  // ── 6. Offer hangus — 7 hari, arsip + kode kembali ke pool (§7) ───────────

  /**
   * §7 spesifikasi owner: offer tak diklaim dalam 7 hari hangus — backend
   * mengarsipkan (WithdrawOffer on-chain, kuota jangan menggantung) dan
   * MENGEMBALIKAN KODE ke pool (unassign) supaya bisa dipakai campaign lain /
   * draw ulang. Baris WinnerDraw ditandai Expired (kode dibersihkan).
   */
  async expiredOfferTick(): Promise<{ expired: number; codesReturned: number }> {
    let expired = 0;
    let codesReturned = 0;
    try {
      const stale = await this.prisma.winnerDraw.findMany({
        where: {
          offerContractId: { not: null },
          claimStatus: null,
          validUntil: { lt: new Date() },
        },
        select: {
          id: true,
          questId: true,
          userId: true,
          offerContractId: true,
          rewardKind: true,
          inviteCode: true,
        },
        take: 50,
      });
      for (const d of stale) {
        const quest = await this.prisma.quest.findUnique({
          where: { id: d.questId },
          select: { ledgerPackage: true },
        });
        if (!quest || quest.ledgerPackage !== 'canquest-v30') continue;
        const wd = await this.claims.withdrawOffer(
          d.offerContractId!,
          'Offer expired after 7 days (v30 sweep §7)',
        );
        if (!wd.ok) {
          // Offer mungkin sudah dikonsumsi tapi receipt belum ter-sinkron —
          // sinkronkan dulu, jangan tandai expired buta.
          await this.claims.syncReceiptFromLedger(d.id).catch(() => undefined);
          const fresh = await this.prisma.winnerDraw.findUnique({
            where: { id: d.id },
            select: { claimStatus: true },
          });
          if (!fresh?.claimStatus) {
            this.logger.warn(
              `offer-expiry: withdraw gagal draw=${d.id.slice(0, 8)}… — ${String(wd.error).slice(0, 100)}`,
            );
          }
          continue;
        }
        // Kode kembali ke pool (reward ber-kode).
        if (d.inviteCode) {
          const rel = await this.prisma.inviteCodePool.updateMany({
            where: { questId: d.questId, userId: d.userId, code: d.inviteCode },
            data: { userId: null, assignedAt: null },
          });
          codesReturned += rel.count;
        }
        await this.prisma.winnerDraw.update({
          where: { id: d.id },
          data: { claimStatus: 'Expired', inviteCode: null, rewardClosedAt: new Date() },
        });
        expired++;
        this.logger.log(
          `offer-expiry: draw=${d.id.slice(0, 8)}… hangus (7 hari) — offer di-withdraw${d.inviteCode ? ', kode kembali ke pool' : ''}`,
        );
      }
    } catch (err) {
      this.logger.error(`expiredOfferTick error: ${String(err).slice(0, 160)}`);
    }
    return { expired, codesReturned };
  }

  // ── 3. RewardPending monitor ──────────────────────────────────────────────

  async rewardPendingTick(): Promise<{ checked: number; confirmed: number; expired: number }> {
    let pending: Awaited<ReturnType<ClaimOfferService['listRewardPending']>>;
    try {
      pending = await this.claims.listRewardPending();
    } catch (err) {
      this.logger.warn(`rewardPendingTick list gagal: ${String(err).slice(0, 120)}`);
      return { checked: 0, confirmed: 0, expired: 0 };
    }
    let confirmed = 0;
    let expiredCount = 0;
    const rewardSender = this.config.get<string>('CANTON_REWARD_PARTY_ID')?.trim() ?? '';

    for (const row of pending) {
      try {
        const user = await this.prisma.user.findUnique({
          where: { id: row.userId },
          select: { cantonPartyId: true },
        });
        if (!user?.cantonPartyId) continue;

        // Evidence 1: instruksi reward MASIH menggantung di inbox offer user?
        // (pola wildcard-scan yang sama dgn wallet UI — menangkap semua
        // implementer TransferInstruction, dicocokkan pengirim+jumlah.)
        const pendingIncoming = await this.ledger
          .queryPendingOffers(user.cantonPartyId, 'incoming')
          .catch(() => [] as Array<{ sender: string; amount: string; instrumentId: string; expiresAt: string }>);
        const matched = pendingIncoming.find(
          (o) =>
            (!rewardSender || o.sender.split('::')[0] === rewardSender.split('::')[0]) &&
            Math.abs(parseFloat(o.amount) - row.rewardAmountCc) < 1e-6,
        );

        if (matched) {
          // Masih bisa diterima user → tunggu; lewat executeBefore → expired.
          const deadline = Date.parse(matched.expiresAt);
          if (Number.isFinite(deadline) && Date.now() > deadline) {
            const res = await this.claims.markRewardExpired(
              row.receiptContractId,
              'TransferInstruction reward menggantung melewati executeBefore — registry tidak akan menyelesaikan (v30 monitor)',
            );
            if (res.ok) {
              expiredCount++;
              this.logger.warn(
                `RewardPending → RewardExpired draw=${row.id.slice(0, 8)}… (fee tidak dikembalikan kontrak — kebijakan fee di UI)`,
              );
            }
          }
        } else {
          // Instruksi hilang: diterima (offer menu) ATAU ditarik/kedaluwarsa.
          // Evidence 2: saldo user utk instrument reward >= jumlah reward.
          const balance = await this.userRewardBalance(
            user.cantonPartyId,
            row.rewardToken,
          ).catch(() => -1);
          if (balance >= row.rewardAmountCc - 1e-6) {
            const res = await this.claims.confirmRewardReceived(row.receiptContractId);
            if (res.ok) {
              confirmed++;
              this.logger.log(
                `RewardPending → Settled (diterima via offer menu; saldo ${balance} ≥ ${row.rewardAmountCc}) draw=${row.id.slice(0, 8)}…`,
              );
            }
          } else {
            // Tidak bisa buktikan diterima & tidak ada instruksi → jika sudah
            // jauh lewat validUntil+24h, tandai expired; selain itu tunggu
            // (bisa saja inbound sync tertinggal).
            const softDeadline = row.validUntil
              ? row.validUntil.getTime() + 24 * 60 * 60 * 1000
              : null;
            if (softDeadline && Date.now() > softDeadline && balance >= 0) {
              const res = await this.claims.markRewardExpired(
                row.receiptContractId,
                `Instruksi reward hilang tanpa bukti diterima (saldo ${balance} < ${row.rewardAmountCc}) — v30 monitor`,
              );
              if (res.ok) {
                expiredCount++;
                this.logger.warn(`RewardPending → RewardExpired draw=${row.id.slice(0, 8)}… (saldo bukti gagal)`);
              }
            }
          }
        }

        // Reminder day-3/day-8 (UI-STATES.md) — tandai agar status endpoint /
        // SSE bisa memunculkan "Check your offers" tanpa spam.
        await this.markReminderIfDue(row.id);
      } catch (err) {
        this.logger.warn(`rewardPending draw=${row.id.slice(0, 8)}… error: ${String(err).slice(0, 120)}`);
      }
    }
    if (pending.length > 0) {
      this.logger.log(
        `reward-pending monitor: checked=${pending.length} confirmed=${confirmed} expired=${expiredCount}`,
      );
    }
    return { checked: pending.length, confirmed, expired: expiredCount };
  }

  /** Saldo user utk instrument reward (CC = Amulet holdings; non-CC = token holdings). */
  private async userRewardBalance(
    partyId: string,
    rewardToken: string,
  ): Promise<number> {
    if ((rewardToken ?? 'CC').toUpperCase() === 'CC') {
      const holdings = await this.ledger.queryAmuletHoldings(partyId);
      return holdings.reduce((s, h) => s + (parseFloat(h.amount) || 0), 0);
    }
    // Non-CC (USDCx dsb): instrument id = simbol token di dapp.
    const holdings = await this.ledger.getTokenHoldingCids(partyId, rewardToken);
    return holdings.length; // jumlah holding bukan nominal — cukup utk bukti "pernah diterima"
  }

  private async markReminderIfDue(drawId: string): Promise<void> {
    const draw = await this.prisma.winnerDraw.findUnique({
      where: { id: drawId },
      select: { rewardPendingNotifiedAt: true, claimStatus: true },
    });
    if (!draw || draw.claimStatus !== 'RewardPending') return;
    const last = draw.rewardPendingNotifiedAt?.getTime() ?? 0;
    // Reminder setiap 5 hari mendekati pola day-3/day-8 tanpa enum email baru.
    if (Date.now() - last < 5 * 24 * 60 * 60 * 1000) return;
    await this.prisma.winnerDraw.update({
      where: { id: drawId },
      data: { rewardPendingNotifiedAt: new Date() },
    });
  }
}
