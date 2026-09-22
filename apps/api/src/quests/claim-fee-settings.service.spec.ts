import { PrismaService } from '../prisma/prisma.service';
import {
  CLAIM_FEE_KEYS,
  ClaimFeeSettingsService,
} from './claim-fee-settings.service';

/**
 * Simulasi perilaku setting claim fee global:
 *  - nilai efektif (DB → fallback default bawaan)
 *  - FREEZE: campaign on-chain berfee null/0 dipaku ke nilai LAMA sebelum
 *    setting baru disimpan (biar Settle tidak pecah "fee tidak sesuai kontrak")
 *  - semantik update: tak dikirim = biarkan, null = kembali ke default
 */

interface QuestRow {
  claimFeeCc: number | null;
  rewardType: string;
  ledgerCampaignId: string | null;
}

function makePrisma(quests: QuestRow[]) {
  const store = new Map<string, string>();
  return {
    store,
    prisma: {
      appSetting: {
        findMany: jest.fn(({ where }: { where: { key: { in: string[] } } }) =>
          where.key.in
            .filter((k) => store.has(k))
            .map((k) => ({ key: k, value: store.get(k) as string })),
        ),
        upsert: jest.fn(
          ({
            where,
            update,
          }: {
            where: { key: string };
            update: { value: string };
          }) => {
            store.set(where.key, update.value);
            return { key: where.key, value: update.value };
          },
        ),
        deleteMany: jest.fn(({ where }: { where: { key: string } }) => {
          const had = store.delete(where.key);
          return { count: had ? 1 : 0 };
        }),
      },
      quest: {
        updateMany: jest.fn(
          ({
            where,
            data,
          }: {
            where: {
              OR: { claimFeeCc: number | null }[];
              ledgerCampaignId: { not: null };
              rewardType: { in: string[] };
            };
            data: { claimFeeCc: number };
          }) => {
            const feeNullish = (v: number | null) =>
              where.OR.some((c) => c.claimFeeCc === v);
            let count = 0;
            for (const q of quests) {
              if (!feeNullish(q.claimFeeCc)) continue;
              if (!q.ledgerCampaignId) continue;
              if (!where.rewardType.in.includes(q.rewardType)) continue;
              q.claimFeeCc = data.claimFeeCc;
              count++;
            }
            return { count };
          },
        ),
      },
    },
  };
}

/** Tunggu refresh bawaan konstruktor (async) selesai. */
const settle = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

describe('ClaimFeeSettingsService — nilai efektif', () => {
  it('tanpa setting di DB → default produk (token 1, code 0.5, combined 1)', async () => {
    const { prisma } = makePrisma([]);
    const svc = new ClaimFeeSettingsService(prisma as unknown as PrismaService);
    await settle();
    expect(svc.getSnapshot()).toEqual({
      tokenFeeCc: 1,
      codeFeeCc: 0.5,
      combinedFeeCc: 1,
    });
    await expect(svc.getStatus()).resolves.toMatchObject({
      tokenFeeCc: 1,
      codeFeeCc: 0.5,
      combinedFeeCc: 1,
      configured: {
        tokenFeeCc: false,
        codeFeeCc: false,
        combinedFeeCc: false,
      },
    });
  });

  it('setting di DB menang, nilai sampah diabaikan', async () => {
    const { prisma, store } = makePrisma([]);
    store.set(CLAIM_FEE_KEYS.token, '7.5');
    store.set(CLAIM_FEE_KEYS.code, 'bukan-angka');
    const svc = new ClaimFeeSettingsService(prisma as unknown as PrismaService);
    await settle();
    await svc.refresh();
    expect(svc.getSnapshot()).toEqual({
      tokenFeeCc: 7.5,
      codeFeeCc: 0.5, // fallback default
      combinedFeeCc: 1,
    });
    const status = await svc.getStatus();
    expect(status.configured).toEqual({
      tokenFeeCc: true,
      codeFeeCc: false,
      combinedFeeCc: false,
    });
  });

  it('fee di bawah floor 0.5 dianggap tak ter-set → default', async () => {
    const { prisma, store } = makePrisma([]);
    store.set(CLAIM_FEE_KEYS.token, '0.3');
    store.set(CLAIM_FEE_KEYS.code, '0.01');
    const svc = new ClaimFeeSettingsService(prisma as unknown as PrismaService);
    await settle();
    await svc.refresh();
    expect(svc.getSnapshot()).toEqual({
      tokenFeeCc: 1,
      codeFeeCc: 0.5,
      combinedFeeCc: 1,
    });
    expect((await svc.getStatus()).configured.tokenFeeCc).toBe(false);
  });

  it('update dengan nilai di bawah floor → key dihapus (bukan disimpan)', async () => {
    const { prisma, store } = makePrisma([]);
    const svc = new ClaimFeeSettingsService(prisma as unknown as PrismaService);
    await settle();
    await svc.refresh();
    await svc.update({ tokenFeeCc: 4 });
    expect(store.get(CLAIM_FEE_KEYS.token)).toBe('4');
    const res = await svc.update({ tokenFeeCc: 0.25 });
    expect(store.has(CLAIM_FEE_KEYS.token)).toBe(false);
    expect(res.settings.tokenFeeCc).toBe(1); // kembali ke default
  });
});

describe('ClaimFeeSettingsService.update', () => {
  it('field tak dikirim dibiarkan; null = kembali ke default', async () => {
    const { prisma, store } = makePrisma([]);
    const svc = new ClaimFeeSettingsService(prisma as unknown as PrismaService);
    await settle();
    await svc.refresh();

    const r1 = await svc.update({ tokenFeeCc: 7 });
    expect(r1.settings).toEqual({
      tokenFeeCc: 7,
      codeFeeCc: 0.5,
      combinedFeeCc: 1,
    });
    expect(store.get(CLAIM_FEE_KEYS.token)).toBe('7');

    // codeFeeCc tidak dikirim → tak ada tulis apa pun.
    expect(store.has(CLAIM_FEE_KEYS.code)).toBe(false);

    // null → hapus key → kembali ke default produk (1).
    const r2 = await svc.update({ tokenFeeCc: null });
    expect(r2.settings.tokenFeeCc).toBe(1);
    expect(store.has(CLAIM_FEE_KEYS.token)).toBe(false);
  });

  it('FREEZE: campaign berfee null/0 + kontrak dipaku ke fee LAMA', async () => {
    const quests: QuestRow[] = [
      // null fee + kontrak → ikut freeze (token group).
      { claimFeeCc: null, rewardType: 'CC_ONLY', ledgerCampaignId: 'cid1' },
      // fee 0 + kontrak → ikut freeze (token group).
      { claimFeeCc: 0, rewardType: 'CC_MANUAL', ledgerCampaignId: 'cid2' },
      // fee eksplisit → TIDAK disentuh.
      { claimFeeCc: 0.01, rewardType: 'CC_ONLY', ledgerCampaignId: 'cid3' },
      // code group (fee lama 2) → freeze.
      {
        claimFeeCc: null,
        rewardType: 'INVITE_CODE_FCFS',
        ledgerCampaignId: 'cid4',
      },
      // waitlist email (no fee) → tidak disentuh.
      {
        claimFeeCc: null,
        rewardType: 'WAITLIST_EMAIL',
        ledgerCampaignId: 'cid5',
      },
      // null fee TANPA kontrak → tidak ikut freeze.
      { claimFeeCc: null, rewardType: 'CC_ONLY', ledgerCampaignId: null },
    ];
    const { prisma } = makePrisma(quests);
    const svc = new ClaimFeeSettingsService(prisma as unknown as PrismaService);
    await settle();
    await svc.refresh();

    const res = await svc.update({ tokenFeeCc: 9, codeFeeCc: 5 });
    expect(res.frozenQuests).toBe(3);
    // Nilai LAMA yang dipaku: token 1, code 0.5 — bukan nilai baru.
    expect(quests[0].claimFeeCc).toBe(1);
    expect(quests[1].claimFeeCc).toBe(1);
    expect(quests[2].claimFeeCc).toBe(0.01);
    expect(quests[3].claimFeeCc).toBe(0.5);
    expect(quests[4].claimFeeCc).toBeNull();
    expect(quests[5].claimFeeCc).toBeNull();
    // Setting baru sudah aktif untuk campaign SELANJUTNYA.
    expect(res.settings).toEqual({
      tokenFeeCc: 9,
      codeFeeCc: 5,
      combinedFeeCc: 1,
    });
  });

  it('freeze hanya jalan sekali — update kedua tak ada yang dibekukan', async () => {
    const quests: QuestRow[] = [
      { claimFeeCc: null, rewardType: 'CC_ONLY', ledgerCampaignId: 'cid1' },
    ];
    const { prisma } = makePrisma(quests);
    const svc = new ClaimFeeSettingsService(prisma as unknown as PrismaService);
    await settle();
    await svc.refresh();
    expect((await svc.update({ tokenFeeCc: 5 })).frozenQuests).toBe(1);
    expect((await svc.update({ tokenFeeCc: 6 })).frozenQuests).toBe(0);
    expect(quests[0].claimFeeCc).toBe(1); // tetap fee kontrak aslinya
  });
});
