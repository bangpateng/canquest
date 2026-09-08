-- ============================================
-- Migration: TokenTxType + SWAP_IN / SWAP_OUT (2026-09-08)
-- Diterapkan manual via ALTER TYPE (additive-only, tanpa transaction block
-- issue) karena `prisma migrate dev` butuh CREATE DATABASE yang tidak dimiliki
-- user prod. Baris ini dicatat resolved via `prisma migrate resolve`.
-- Sifat: ADD VALUE saja — tidak ubah/hapus nilai lama, tidak sentuh data.
-- Kaki swap token lahir sebagai SWAP_IN/SWAP_OUT (paralel CcTransactionType),
-- bukan TOKEN_TRANSFER_* generik.
-- ============================================

ALTER TYPE "TokenTxType" ADD VALUE 'SWAP_IN';
ALTER TYPE "TokenTxType" ADD VALUE 'SWAP_OUT';
