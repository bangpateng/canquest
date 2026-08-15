/**
 * Reset POINTS + AKTIVITAS QUEST semua user — untuk bersih-bersih sebelum buka umum.
 *
 * Akun user TIDAK dihapus (email, password hash, wallet binding, referral tetap utuh).
 * Hanya poin & catatan partisipasi quest yang dikembalikan ke nol/kosong, sehingga
 * setiap user bisa mulai mengerjakan quest dari awal.
 *
 * Yang di-reset / dihapus (seluruh row, lintas user):
 *   • User.earnPoints   → 0   (saldo lifetime poin tiap user)
 *   • EarnEntry         → hapus semua  (catatan poin terpotong saat ikut Earn campaign)
 *   • QuestSubmission   → hapus semua  (bukti task: PENDING/VERIFIED/REJECTED)
 *   • QuestCompletion   → hapus semua  (record quest selesai + reward CC)
 *   • WinnerDraw        → hapus semua  (record pemenang raffle/FCFS + status distribusi)
 *
 * Yang DIPERTAHANKAN:
 *   • Semua row User (akun login, cantonPartyId, keycloakId, isAdmin, dll.)
 *   • ReferralReward   (record referral yang sah + poin referrer)
 *   • CcBalance / CcTransaction  (saldo & audit trail token CC — sumber on-chain)
 *   • CcLock, RefreshToken, PasswordReset, WalletInviteCode, WalletAllocationLog
 *   • Quest, QuestTask, InviteCodePool, AppSetting  (definisi & konfigurasi)
 *
 * Opsional:
 *   --release-invite-codes  Lepaskan assignment kode undangan (InviteCodePool) yang
 *                           sudah diberikan ke user, supaya bisa dibagikan ulang.
 *                           (Default: tidak dilepas — kode yang sudah diterima user tetap.)
 *
 * Pemakaian:
 *   cd apps/api
 *   node scripts/reset-user-activity.cjs --dry-run
 *   node scripts/reset-user-activity.cjs --apply
 *   node scripts/reset-user-activity.cjs --apply --release-invite-codes
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const apply = process.argv.includes('--apply');
const dryRun = process.argv.includes('--dry-run') || !apply;
const releaseInviteCodes = process.argv.includes('--release-invite-codes');

function dbLabel() {
  // DATABASE_URL sudah dimuat Prisma dari .env saat ini. Tampilkan tujuan tanpa password.
  const url = process.env.DATABASE_URL ?? '';
  const m = url.match(/^postgres(?:ql)?:\/\/([^:]+):([^@]*)@([^:/]+)(?::(\d+))?\/(.+)$/);
  if (!m) return { raw: url ? '(format tidak dikenali)' : '(DATABASE_URL kosong!)' };
  return { user: m[1], host: m[3], port: m[4] || '5432', db: m[5].split('?')[0] };
}

async function counts() {
  return {
    users: await prisma.user.count(),
    usersWithPoints: await prisma.user.count({ where: { earnPoints: { gt: 0 } } }),
    earnEntries: await prisma.earnEntry.count(),
    questSubmissions: await prisma.questSubmission.count(),
    questCompletions: await prisma.questCompletion.count(),
    winnerDraws: await prisma.winnerDraw.count(),
    inviteCodesAssigned: await prisma.inviteCodePool.count({ where: { userId: { not: null } } }),
    referralRewards: await prisma.referralReward.count(),
    ccTransactions: await prisma.ccTransaction.count(),
    ccBalances: await prisma.ccBalance.count(),
  };
}

async function resetActivityInTxn() {
  // Urutan tidak penting di sini (tidak ada FK antar tabel-tabel ini yang mengharuskan
  // urutan tertentu — semua FK cascade dari User, dan kita tidak menghapus User).
  // Dibungkus $transaction agar atomik: kalau satu gagal, semua di-rollback.
  const result = await prisma.$transaction(async (tx) => {
    const earnEntries = await tx.earnEntry.deleteMany({});
    const submissions = await tx.questSubmission.deleteMany({});
    const completions = await tx.questCompletion.deleteMany({});
    const winnerDraws = await tx.winnerDraw.deleteMany({});
    const pointsReset = await tx.user.updateMany({
      data: { earnPoints: 0 },
    });
    let inviteReleased = null;
    if (releaseInviteCodes) {
      inviteReleased = await tx.inviteCodePool.updateMany({
        where: { userId: { not: null } },
        data: { userId: null, assignedAt: null },
      });
    }
    return {
      earnEntries: earnEntries.count,
      questSubmissions: submissions.count,
      questCompletions: completions.count,
      winnerDraws: winnerDraws.count,
      usersPointsReset: pointsReset.count,
      inviteCodesReleased: inviteReleased ? inviteReleased.count : null,
    };
  });
  return result;
}

async function main() {
  const dest = dbLabel();
  console.log('\n========================================');
  console.log('  CanQuest — Reset Points & Aktivitas User');
  console.log('========================================');
  console.log('Tujuan DB :', dest.raw
    ? dest.raw
    : `${dest.user}@${dest.host}:${dest.port}/${dest.db}`);
  console.log('Mode      :', apply ? 'APPLY (akan menulis ke DB)' : 'DRY RUN (tidak menulis)');
  console.log('Lepas kode undangan :', releaseInviteCodes ? 'YA' : 'tidak');

  if (dryRun && !apply) {
    console.log('\n--- DRY RUN: tidak ada perubahan yang ditulis ---');
    console.log('  (jalankan ulang dengan --apply untuk benar-benar mengeksekusi)\n');
  } else {
    console.log('\n--- APPLY: perubahan akan ditulis ke database ---\n');
  }

  console.log('Status sebelum (counts):');
  const before = await counts();
  console.log(before);

  // Ringkasan apa yang AKAN terjadi.
  console.log('\nYang akan di-reset / hapus:');
  console.log('  • User.earnPoints → 0        :', before.users, 'akun (semua dipertahankan)');
  console.log('  • EarnEntry      hapus semua :', before.earnEntries, 'row');
  console.log('  • QuestSubmission hapus semua :', before.questSubmissions, 'row');
  console.log('  • QuestCompletion hapus semua :', before.questCompletions, 'row');
  console.log('  • WinnerDraw     hapus semua :', before.winnerDraws, 'row');
  if (releaseInviteCodes) {
    console.log('  • InviteCodePool lepas assign :', before.inviteCodesAssigned, 'row');
  }
  console.log('\nYang TIDAK dihapus (dipertahankan):');
  console.log('  • User rows (akun login)      :', before.users, 'akun');
  console.log('  • ReferralReward              :', before.referralRewards, 'row');
  console.log('  • CcTransaction / CcBalance   :', before.ccTransactions, '/', before.ccBalances, 'row');

  if (dryRun && !apply) {
    console.log('\n✅ DRY RUN selesai — tidak ada data yang berubah.');
    await prisma.$disconnect();
    return;
  }

  console.log('\nMenjalankan reset dalam transaksi atomik…');
  const result = await resetActivityInTxn();
  console.log('Hasil:', result);

  const after = await counts();
  console.log('\nStatus sesudah (counts):', after);

  console.log('\n✅ Selesai. Semua akun user dipertahankan; points & aktivitas quest dibersihkan.');
  console.log('   Catatan: saldo CC (CcBalance) sengaja tidak diubah — sumbernya on-chain.');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('\n❌ Gagal:', e);
  process.exit(1);
});
