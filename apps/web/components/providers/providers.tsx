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
            staleTime: 60_000,
            refetchOnWindowFocus: false,
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
