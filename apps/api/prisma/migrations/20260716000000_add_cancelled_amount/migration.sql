-- ============================================
-- Migration: Add cancelled-amount columns (OFFER_WITHDRAWN / OFFER_REJECTED)
-- Date: 2026-07-16
-- Spec: BAGIAN 2 poin 2 — tampilkan amount orisinal transaksi yang dibatalkan
-- Safe to run: Yes (ADD COLUMN nullable, additive, no data rewrite)
--
-- Konteks:
-- Saat sender menarik offer (OFFER_WITHDRAWN) atau receiver menolak (OFFER_REJECTED),
-- saldo tidak bergerak → amountMicroCc / amount = 0. Amount orisinal offer sebelumnya
-- hanya disematkan di teks description (untuk REJECT) atau tidak sama sekali (WITHDRAW).
-- Kolom ini menyimpan amount orisinal secara terstruktur agar Activity & badge notif
-- bisa menampilkan "cancelled 5 CC" / "cancelled 5 USDCx" dengan akurat.
--
-- Update ID integrity: cantonUpdateId sudah diisi result.updateId saat withdraw/reject,
-- jadi referensi on-chain sudah benar; kolom amount ini melengkapi data display.
-- ============================================

-- CcTransaction: amount CC asli yang dibatalkan (+ instrument id bila token).
ALTER TABLE "CcTransaction"
    ADD COLUMN "cancelledAmountCc"     DECIMAL(20,10),
    ADD COLUMN "cancelledInstrumentId" TEXT;

-- TokenTransaction: amount token asli yang dibatalkan/ditarik.
ALTER TABLE "TokenTransaction"
    ADD COLUMN "cancelledAmount" DECIMAL(38,18);
