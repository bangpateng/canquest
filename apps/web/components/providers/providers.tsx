"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { MaintenanceGate } from "@/components/providers/maintenance-gate";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Cache dianggap segar 60s — refetch dalam jendela ini no-op.
            staleTime: 60_000,
            // Nonaktifkan auto-refetch saat tab focus / reconnect. Sebelumnya
            // true → setiap kali user balik ke tab, 5+ query fire bersamaan
            // (prices, offers, lock-status, notifications, transactions) = burst
            // request ke VPS 2. SSE sudah jadi sumber update real-time; polling
            // refetchInterval per-hook tetap jalan sebagai safety-net.
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            // 2x retry sudah cukup; 3x (default) terlalu lama untuk error server.
            retry: 2,
          },
        },
      }),
  );

  return (
    <ThemeProvider>
      <QueryClientProvider client={client}>
        {children}
        {/* Overlay maintenance global — no-op di /admin & saat OFF. */}
        <MaintenanceGate />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
