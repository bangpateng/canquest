-- ============================================
-- Migration: Add PasswordReset (Forgot Password — kode 6 digit)
-- Date: 2026-06-24
-- Safe to run: Yes (CREATE TABLE only, additive — NO changes to "User" table)
--
-- Tabel terpisah dari email OTP (otpCodeHash). Kode 6 digit disimpan sebagai
-- HMAC-SHA256 (bukan plaintext), TTL 15 menit, attempt lockout 5x.
-- Relasi balik ("UserPasswordResets") TIDAK menambah kolom fisik di User.
-- ============================================

CREATE TABLE "PasswordReset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordReset_pkey" PRIMARY KEY ("id")
);

-- Index: lookup kode aktif terbaru per user (forgot-password & reset-password)
CREATE INDEX "PasswordReset_userId_idx" ON "PasswordReset"("userId");

-- FK: userId → User (cascade: hapus kode saat user dihapus)
ALTER TABLE "PasswordReset"
    ADD CONSTRAINT "PasswordReset_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
