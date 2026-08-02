"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { queryKeys } from "@/lib/queries/query-keys";

/**
 * GET /api/party/fee-config — env-backed config (TRANSACTION_FEE_CC,
 * CC_USD_PRICE, PREAPPROVAL_ENABLED_TOKENS).
 *
 * Response statis per deploy (dari env backend) → staleTime panjang (5 menit).
 * Key dishared lintas consumer (WalletActions butuh `feeCc`, SettingsPreapproval
 * butuh `preapprovalTokens`) supaya request ter-dedup. Sebelumnya dua komponen
 * ini masing-masing raw-fetch sendiri (2x request uncached per mount).
 */
export type FeeConfig = {
  feeCc: number;
  ccUsdPrice: number;
  preapprovalTokens: string[];
};

const DEFAULT_CONFIG: FeeConfig = {
  feeCc: 5,
  ccUsdPrice: 0,
  preapprovalTokens: ["CC"],
};

export function useFeeConfig(opts?: {
  enabled?: boolean;
}): UseQueryResult<FeeConfig> {
  return useQuery<FeeConfig>({
    queryKey: queryKeys.party.feeConfig,
    queryFn: async (): Promise<FeeConfig> => {
      const res = await fetch("/api/party/fee-config", {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`fee-config ${res.status}`);
      const data = (await res.json()) as Partial<FeeConfig>;
      return {
        feeCc:
          typeof data.feeCc === "number" ? data.feeCc : DEFAULT_CONFIG.feeCc,
        ccUsdPrice:
          typeof data.ccUsdPrice === "number"
            ? data.ccUsdPrice
            : DEFAULT_CONFIG.ccUsdPrice,
        preapprovalTokens:
          data.preapprovalTokens ?? DEFAULT_CONFIG.preapprovalTokens,
      };
    },
    enabled: opts?.enabled ?? true,
    // Env-backed config tidak berubah saat runtime — cache lama OK.
    staleTime: 5 * 60_000,
    retry: 2,
  });
}
