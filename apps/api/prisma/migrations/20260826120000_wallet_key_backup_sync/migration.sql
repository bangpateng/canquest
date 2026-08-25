-- M4b: sync backup kunci dompet terenkripsi antar-browser (opt-out-able).
-- Server hanya menyimpan blob AES-256-GCM; passphrase tidak pernah dikirim.

CREATE TABLE "WalletKeyBackup" (
    "userId" TEXT NOT NULL,
    "blob" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletKeyBackup_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "WalletKeyBackup" ADD CONSTRAINT "WalletKeyBackup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
