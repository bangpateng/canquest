-- ============================================
-- Migration: Passkey (WebAuthn) credentials + backup codes; hapus wallet password
-- Date: 2026-07-13
-- Spec: Passkey replacement for wallet password (wajib + multi-device + backup codes)
-- Safe to run: User belum ada yang set wallet password (zero migration cost).
-- ============================================

-- 1. Drop wallet password columns dari User (system dihapus total — ganti passkey).
--    Aman: belum ada user yang set password wallet (konfirmasi pemilik).
ALTER TABLE "User"
    DROP COLUMN "walletPasswordHash",
    DROP COLUMN "walletPasswordAttempts",
    DROP COLUMN "walletPasswordLockedUntil";

-- 2. Tambah passkeyEnrolledAt timestamp (forced enrollment check).
ALTER TABLE "User"
    ADD COLUMN "passkeyEnrolledAt" TIMESTAMP(3);

-- 3. PasskeyCredential table — multi-device WebAuthn credentials.
CREATE TABLE "PasskeyCredential" (
    "id"            TEXT                  NOT NULL,   -- credentialId (base64url), global unique
    "userId"        TEXT                  NOT NULL,
    "publicKey"     BYTEA                 NOT NULL,   -- COSE public key
    "counter"       INTEGER               NOT NULL DEFAULT 0,
    "transports"    TEXT[]                NOT NULL DEFAULT ARRAY[]::TEXT[],
    "deviceLabel"   TEXT,
    "createdAt"     TIMESTAMP(3)          NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt"    TIMESTAMP(3),

    CONSTRAINT "PasskeyCredential_pkey" PRIMARY KEY ("id")
);

-- FK: userId → User (onDelete Cascade — hapus credentials bila user dihapus)
ALTER TABLE "PasskeyCredential"
    ADD CONSTRAINT "PasskeyCredential_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Index: list credentials per user (Settings page)
CREATE INDEX "PasskeyCredential_userId_idx" ON "PasskeyCredential"("userId");

-- 4. BackupCode table — recovery codes (hash only).
CREATE TABLE "BackupCode" (
    "id"        TEXT                  NOT NULL,
    "userId"    TEXT                  NOT NULL,
    "codeHash"  TEXT                  NOT NULL,   -- bcrypt hash (never plaintext)
    "usedAt"    TIMESTAMP(3),                     -- null = aktif
    "createdAt" TIMESTAMP(3)          NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackupCode_pkey" PRIMARY KEY ("id")
);

-- FK: userId → User (onDelete Cascade)
ALTER TABLE "BackupCode"
    ADD CONSTRAINT "BackupCode_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Index: lookup backup codes per user (recovery flow)
CREATE INDEX "BackupCode_userId_idx" ON "BackupCode"("userId");
