"use client";

import { TokenList } from "@/components/app/wallet/token-list";

interface WalletDashboardProps {
  me: { username?: string | null; cantonPartyId?: string | null };
  onRefresh?: () => void;
}

/**
 * Main wallet view — daftar kartu token yang bisa diklik.
 *
 * Sebelumnya: single-page dashboard (balance hero + actions + transactions).
 * Sekarang: token list (kartu per-token). Klik → detail view /wallet/<tokenId>.
 *
 * History transaksi pindah ke:
 *   1. Notification badge (global, realtime) — sudah ada.
 *   2. CC detail view Activity section (/wallet/cc).
 */
export function WalletDashboard({ me, onRefresh }: WalletDashboardProps) {
  return <TokenList me={me} onRefresh={onRefresh} />;
}
