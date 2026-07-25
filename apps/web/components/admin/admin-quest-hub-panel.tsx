"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AdminQuestHubTasksPanel, type QuestHub } from "@/components/admin/admin-quest-hub-tasks-panel";

export function AdminQuestHubPanel({ initialHub }: { initialHub: QuestHub | null }) {
  const router = useRouter();
  const [hub, setHub] = useState<QuestHub | null>(initialHub);
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
      const data = (await res.json()) as QuestHub & { message?: string };
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
    <AdminQuestHubTasksPanel
      hub={hub}
      onEnsureHub={() => void ensureHub()}
      ensuring={ensuring}
      ensureError={ensureError}
    />
  );
}
