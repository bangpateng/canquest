/**
 * Audit (READ-ONLY) — list user yang masih punya cantonPartyId placeholder.
 *
 * Placeholder party = cantonPartyId yang diawali "canquest:" (party lokal/stub,
 * bukan party Canton on-chain). Guard `startsWith('canquest:')` ada di ~12 tempat
 * di backend untuk skip operasi onchain bagi user ini. Setelah migrasi ke
 * Keycloak + API publik, user placeholder harus di-re-onboard ke party real.
 *
 * Jalankan di VPS (di mana DATABASE_URL menunjuk):
 *   npx ts-node prisma/scripts/audit-placeholder-parties.ts
 *
 * Script ini HANYA membaca — tidak mengubah data. Lihat companion:
 *   prisma/scripts/re-onboard-placeholder-parties.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const all = await prisma.user.findMany({
    where: { cantonPartyId: { not: null } },
    select: {
      id: true,
      email: true,
      username: true,
      displayName: true,
      cantonPartyId: true,
      keycloakId: true,
      status: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  const placeholders = all.filter((u) =>
    u.cantonPartyId?.startsWith('canquest:'),
  );
  const real = all.filter((u) => !u.cantonPartyId?.startsWith('canquest:'));
  const noParty = await prisma.user.count({
    where: { cantonPartyId: null },
  });

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  AUDIT PLACEHOLDER PARTY (canquest:) — READ ONLY');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Total user dengan party       : ${all.length}`);
  console.log(`    ├─ party REAL (on-chain)     : ${real.length}`);
  console.log(`    └─ party PLACEHOLDER (canquest:): ${placeholders.length}`);
  console.log(`  User tanpa party sama sekali  : ${noParty}`);
  console.log('───────────────────────────────────────────────────────────\n');

  if (placeholders.length === 0) {
    console.log('✅ Tidak ada user placeholder. DB bersih — tidak perlu re-onboard.\n');
    return;
  }

  console.log(`⚠  Ditemukan ${placeholders.length} user placeholder yang perlu re-onboard:\n`);
  console.log(
    'id                        | email'.padEnd(50) +
      '              | username        | cantonPartyId (placeholder)',
  );
  console.log('-'.repeat(120));
  for (const u of placeholders) {
    const row = [
      u.id,
      u.email,
      u.username ?? '(null)',
      u.cantonPartyId ?? '(null)',
    ];
    console.log(row.join(' | '));
  }

  const withoutKeycloak = placeholders.filter((u) => !u.keycloakId);
  console.log(
    `\n  Catatan: ${withoutKeycloak.length} dari ${placeholders.length} user placeholder`,
  );
  console.log(
    '  belum punya keycloakId — re-onboard akan membuat identity Keycloak baru.',
  );
  console.log(
    '\n  Lanjutkan dengan: npx ts-node prisma/scripts/re-onboard-placeholder-parties.ts --confirm\n',
  );
}

main()
  .catch((err) => {
    console.error('Audit error:', err);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
