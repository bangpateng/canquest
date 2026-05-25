"use client";

import { useCallback, useEffect, useState } from "react";

import type { TransactionDetail } from "@/components/app/transaction-detail-view";

export function useTransactionDetail(transactionId: string | null) {
  const [detail, setDetail] = useState<TransactionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!transactionId) {
      setDetail(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/party/transactions/${encodeURIComponent(transactionId)}`,
        { credentials: "include", cache: "no-store" },
      );
      if (!res.ok) {
        setError(res.status === 404 ? "Transaction not found." : "Could not load transaction.");
        setDetail(null);
        return;
      }
      setDetail((await res.json()) as TransactionDetail);
    } catch {
      setError("Could not load transaction.");
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [transactionId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { detail, loading, error, reload: load };
}
