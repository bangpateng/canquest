"use client";

import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Ban,
  Lock,
  LockOpen,
  ShieldCheck,
  ShieldOff,
  Undo2,
  Zap,
} from "lucide-react";

import type { TxType } from "@/lib/canton/tx-labels";

/**
 * Ikon + warna latar untuk tipe transaksi — SATU sumber untuk semua tempat
 * yang menampilkan ikon tx (menu History, header modal detail).
 *
 * Sebelumnya TxTypeIcon/txIconBg hidup di transactions-view dan header
 * TransactionDetailModal hardcode "Send"/panah merah untuk SEMUA tipe di luar
 * transfer masuk — ikon detail Lock/Unlock tampil panah Send padahal label
 * tipenya benar (laporan owner 2026-09-13). Kini dipakai bersama.
 */
export function TxTypeIcon({ type }: { type: TxType }) {
  switch (type) {
    case "TRANSFER_OUT":
      return <ArrowUpRight className="h-4 w-4" />;
    case "TRANSFER_IN":
      return <ArrowDownLeft className="h-4 w-4" />;
    case "CC_LOCK":
      return <Lock className="h-4 w-4" />;
    case "CC_UNLOCK":
      return <LockOpen className="h-4 w-4" />;
    case "OFFER_REJECTED":
    case "TOKEN_OFFER_REJECTED":
      return <Ban className="h-4 w-4" />;
    case "OFFER_WITHDRAWN":
    case "TOKEN_OFFER_WITHDRAWN":
      return <Undo2 className="h-4 w-4" />;
    case "PREAPPROVAL_ENABLED":
      return <ShieldCheck className="h-4 w-4" />;
    case "PREAPPROVAL_DISABLED":
      return <ShieldOff className="h-4 w-4" />;
    case "SWAP_OUT":
      // Hanya kaki keluar swap yang ber-ikon swap.
      return <ArrowLeftRight className="h-4 w-4" />;
    case "TOKEN_TRANSFER_OUT":
      return <ArrowUpRight className="h-4 w-4" />;
    case "TRANSFER_IN":
    case "TOKEN_TRANSFER_IN":
    case "SWAP_IN":
    case "QUEST_REWARD":
    case "SPIN_REWARD":
    case "AIRDROP":
      // Dana masuk (transfer, hasil swap, maupun reward) — SATU bahasa:
      // panah hijau. Notifikasi KEMENANGAN undian tetap pakai ikon earn
      // (Sparkles) di bell — itu alert draw, bukan baris dana.
      return <ArrowDownLeft className="h-4 w-4" />;
    default:
      return <Zap className="h-4 w-4" />;
  }
}

export function txIconBg(type: TxType): string {
  switch (type) {
    case "TRANSFER_OUT":
    case "TOKEN_TRANSFER_OUT":
      return "bg-red-500/10 text-red-600 ring-1 ring-red-500/15";
    case "TRANSFER_IN":
    case "TOKEN_TRANSFER_IN":
    case "SWAP_IN":
    case "QUEST_REWARD":
    case "SPIN_REWARD":
    case "AIRDROP":
      // Semua dana masuk (termasuk reward) — hijau (panah hijau konsisten).
      return "bg-canton-subtle text-canton ring-1 ring-[rgb(var(--canton-rgb)/0.15)]";
    case "CC_LOCK":
      // Netral/amber — BUKAN merah transfer (dana dikunci, bukan keluar).
      return "bg-orange-500/10 text-orange-600 ring-1 ring-orange-500/15";
    case "CC_UNLOCK":
      return "bg-canton-subtle text-canton ring-1 ring-[rgb(var(--canton-rgb)/0.15)]";
    case "OFFER_REJECTED":
    case "OFFER_WITHDRAWN":
    case "TOKEN_OFFER_REJECTED":
    case "TOKEN_OFFER_WITHDRAWN":
    case "PREAPPROVAL_DISABLED":
      // Aksi toggle netral — muted, bukan merah (tidak ada pergerakan CC).
      return "bg-[var(--muted)] text-[var(--muted-foreground)]";
    case "PREAPPROVAL_ENABLED":
      return "bg-canton-subtle text-canton ring-1 ring-[rgb(var(--canton-rgb)/0.15)]";
    case "SWAP_OUT":
      // Kaki KELUAR swap — KUNING (satu-satunya yang berlabel Swap).
      return "bg-amber-500/15 text-amber-600 ring-1 ring-amber-500/25";
    default:
      return "bg-[var(--muted)] text-[var(--muted-foreground)]";
  }
}
