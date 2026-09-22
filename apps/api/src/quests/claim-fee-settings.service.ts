import { Injectable, Logger } from '@nestjs/common';
import { RewardType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Default claim fee (CC) per kelompok reward type — bisa di-set admin dari
 * dashboard (halaman Settings → Claim fee). Disimpan di tabel AppSetting
 * (live, tanpa restart/migrasi).
 *
 * WAJIB: nilai efektif TIDAK BOLEH 0 untuk campaign on-chain — kontrak DAML
 * menolak fee-0 (v29 FIX-13). Kosongkan field = kembali ke nilai bawaan.
 */
export const CLAIM_FEE_KEYS = {
  token: 'claim_fee_token_cc',
  code: 'claim_fee_code_cc',
  combined: 'claim_fee_combined_cc',
} as const;

/**
 * Default produk claim fee (CC). Sebelum setting global ada nilainya
 * hardcoded 3/2/3; sejak 2026-09-22 produk pakai 1/0.5/1 (keputusan user:
 * CC_ONLY terbaru sudah dibuat berfee 1). Campaign yang fee-nya eksplisit di
 * DB (sudah dibekukan) tidak terpengaruh.
 */
export const CLAIM_FEE_DEFAULTS = {
  token: 1, // CC_ONLY, CC_MANUAL
  code: 0.5, // INVITE_CODE_FCFS / RANDOM / INVITE_CODE / CC_AND_INVITE
  combined: 1, // CC_AND_CODE_RAFFLE
} as const;

export interface ClaimFeeSettings {
  tokenFeeCc: number;
  codeFeeCc: number;
  combinedFeeCc: number;
}

/** Status buat panel admin — mana key yang benar-benar ter-set di DB. */
export interface ClaimFeeStatus extends ClaimFeeSettings {
  configured: Record<keyof ClaimFeeSettings, boolean>;
}

/** Kelompok reward type → key setting (buat freeze + label UI). */
const FEE_GROUPS: {
  key: keyof typeof CLAIM_FEE_KEYS;
  types: RewardType[];
}[] = [
  {
    key: 'token',
    types: [RewardType.CC_ONLY, RewardType.CC_MANUAL],
  },
  {
    key: 'code',
    types: [
      RewardType.INVITE_CODE_FCFS,
      RewardType.INVITE_CODE_RANDOM,
      RewardType.INVITE_CODE,
      RewardType.CC_AND_INVITE,
    ],
  },
  {
    key: 'combined',
    types: [RewardType.CC_AND_CODE_RAFFLE],
  },
];

/**
 * Setting global claim fee — sumber default untuk campaign yang tidak
 * mengisi fee eksplisit (Quest.claimFeeCc kosong/0).
 *
 * Snapshot di-cache in-memory (TTL 60s) supaya claim path (dipanggil user)
 * tidak membombardir DB — pola sama seperti MaintenanceService.
 *
 * PENTING (kenapa ada "freeze"): fee sebuah campaign on-chain DIBEKENKAN ke
 * kontrak QuestCampaign saat dibuat, dan Settle menolak bila feeTransfer ≠
 * claimFeeCc kontrak. Jadi tiap kali setting global diubah, campaign lama
 * yang masih pakai default (claimFeeCc null/0)harus DULUAN dibekukan ke
 * nilai lama di DB — kalau tidak, klaim campaign lama akan mentok di
 * "Fee amount tidak sesuai kontrak!".
 */
@Injectable()
export class ClaimFeeSettingsService {
  private readonly logger = new Logger(ClaimFeeSettingsService.name);

  /** Snapshot terjadwal + waktu kadaluarsa (ms). */
  private snapshot: ClaimFeeSettings = {
    tokenFeeCc: CLAIM_FEE_DEFAULTS.token,
    codeFeeCc: CLAIM_FEE_DEFAULTS.code,
    combinedFeeCc: CLAIM_FEE_DEFAULTS.combined,
  };
  private loadedAt = 0;
  private loading = false;
  private readonly ttlMs = 60_000;

  constructor(private readonly prisma: PrismaService) {
    void this.refresh().catch((err) =>
      this.logger.warn(
        `Inisialisasi claim fee settings gagal (pakai default): ${
          err instanceof Error ? err.message : String(err)
        }`,
      ),
    );
  }

  /**
   * Snapshot sinkron (dari cache) — untuk call site sync seperti
   * resolveClaimFeeCc(). Kalau TTL kedaluwarsa, refresh di background.
   */
  getSnapshot(): ClaimFeeSettings {
    if (!this.loading && Date.now() - this.loadedAt > this.ttlMs) {
      void this.refresh().catch(() => {
        /* fail-open: snapshot lama tetap dipakai */
      });
    }
    return this.snapshot;
  }

  /** Baca DB + update cache. Return snapshot efektif. */
  async refresh(): Promise<ClaimFeeSettings> {
    if (this.loading) return this.snapshot;
    this.loading = true;
    try {
      this.snapshot = await this.readFromDb();
      this.loadedAt = Date.now();
    } finally {
      this.loading = false;
    }
    return this.snapshot;
  }

  /**
   * Status lengkap buat panel admin: nilai efektif + penanda mana yang
   * benar-benar di-set di DB (false = masih default bawaan).
   */
  async getStatus(): Promise<ClaimFeeStatus> {
    const rows = await this.prisma.appSetting.findMany({
      where: { key: { in: Object.values(CLAIM_FEE_KEYS) } },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const configured = {} as Record<keyof ClaimFeeSettings, boolean>;
    for (const [group, key] of Object.entries(CLAIM_FEE_KEYS)) {
      configured[`${group}FeeCc` as keyof ClaimFeeSettings] =
        Number((map.get(key) ?? '').trim()) > 0;
    }
    return { ...this.snapshot, configured };
  }

  /**
   * Ubah setting. Langkah:
   *  1. FREEZE — campaign lama (claimFeeCc null/0 + ada kontrak on-chain)
   *     dipaku ke default LAMA per kelompok reward type, supaya Settle-nya
   *     tidak pecah setelah setting berubah.
   *  2. Tulis nilai baru (null = hapus key → kembali ke default bawaan).
   *  3. Refresh cache.
   */
  async update(
    input: Partial<Record<keyof ClaimFeeSettings, number | null>>,
  ): Promise<{
    settings: ClaimFeeSettings;
    frozenQuests: number;
  }> {
    const before = await this.readFromDb();
    let frozenQuests = 0;
    for (const group of FEE_GROUPS) {
      const fee = before[`${group.key}FeeCc` as keyof ClaimFeeSettings];
      if (!(fee > 0)) continue;
      const res = await this.prisma.quest.updateMany({
        where: {
          OR: [{ claimFeeCc: null }, { claimFeeCc: 0 }],
          ledgerCampaignId: { not: null },
          rewardType: { in: group.types },
        },
        data: { claimFeeCc: fee },
      });
      frozenQuests += res.count;
    }

    for (const group of FEE_GROUPS) {
      const next = input[`${group.key}FeeCc` as keyof ClaimFeeSettings];
      if (next === undefined) continue; // tak dikirim → biarkan nilai lama
      const key = CLAIM_FEE_KEYS[group.key];
      if (next === null || !Number.isFinite(next) || next <= 0) {
        await this.prisma.appSetting.deleteMany({ where: { key } });
      } else {
        await this.prisma.appSetting.upsert({
          where: { key },
          update: { value: String(next) },
          create: { key, value: String(next) },
        });
      }
    }

    this.snapshot = await this.readFromDb();
    this.loadedAt = Date.now();
    if (frozenQuests > 0) {
      this.logger.log(
        `Claim fee settings diperbarui — ${frozenQuests} campaign dibekukan ke fee lama sebelum setting baru berlaku`,
      );
    }
    return { settings: this.snapshot, frozenQuests };
  }

  private async readFromDb(): Promise<ClaimFeeSettings> {
    const rows = await this.prisma.appSetting.findMany({
      where: { key: { in: Object.values(CLAIM_FEE_KEYS) } },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const parse = (key: string, fallback: number): number => {
      const raw = (map.get(key) ?? '').trim();
      if (!raw) return fallback;
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? n : fallback;
    };
    return {
      tokenFeeCc: parse(CLAIM_FEE_KEYS.token, CLAIM_FEE_DEFAULTS.token),
      codeFeeCc: parse(CLAIM_FEE_KEYS.code, CLAIM_FEE_DEFAULTS.code),
      combinedFeeCc: parse(
        CLAIM_FEE_KEYS.combined,
        CLAIM_FEE_DEFAULTS.combined,
      ),
    };
  }
}
