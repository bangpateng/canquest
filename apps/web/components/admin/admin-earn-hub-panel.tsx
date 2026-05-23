"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AdminEarnHubTasksPanel, type EarnHubQuest } from "@/components/admin/admin-earn-hub-tasks-panel";

export function AdminEarnHubPanel({ initialHub }: { initialHub: EarnHubQuest | null }) {
  const router = useRouter();
  const [hub, setHub] = useState<EarnHubQuest | null>(initialHub);
  const [ensuring, setEnsuring] = useState(false);
  const [ensureError, setEnsureError] = useState<string | null>(null);

  useEffect(() => {
    setHub(initialHub);
  }, [initialHub]);

  async function ensureHub() {
    setEnsuring(true);
    setEnsureError(null);
    try {
      const res = await fetch("/api/admin/earn-hub/ensure", { method: "POST" });
      const data = (await res.json()) as EarnHubQuest & { message?: string };
      if (!res.ok) {
        setEnsureError(data.message ?? "Failed to create hub");
        return;
      }
      setHub(data);
      router.refresh();
    } catch {
      setEnsureError("Network error");
    } finally {
      setEnsuring(false);
    }
  }

  return (
    <AdminEarnHubTasksPanel
      hub={hub}
      onEnsureHub={() => void ensureHub()}
      ensuring={ensuring}
      ensureError={ensureError}
    />
  );
}
