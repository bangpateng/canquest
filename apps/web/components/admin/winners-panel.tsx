"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ChevronLeft,
  CheckCircle2,
  Clock,
  Loader2,
  Send,
  Shuffle,
  Ticket,
  UserCheck,
  Plus,
  Trash2,
} from "lucide-react";
import { underlineTabClass } from "@/lib/ui-button-styles";
import { cn } from "@/lib/utils";

interface Participant {
  userId: string;
  email: string;
  username: string | null;
  displayName: string | null;
  cantonPartyId: string | null;
  completedAt: string;
  rewardMicroCc: string;
  isWinner: boolean;
}

interface Winner {
  drawId: string;
  userId: string;
  email: string;
  username: string | null;
  displayName: string | null;
  cantonPartyId: string | null;
  ccAmount: number;
  inviteCode: string | null;
  distributed: boolean;
  ledgerTxId: string | null;
  drawnAt: string;
  distributedAt: string | null;
}

interface InviteCode {
  id: string;
  code: string;
  assigned: boolean;
  assignedTo: { email: string; username: string | null } | null;
}

type Tab = "participants" | "winners" | "codes";

export function WinnersPanel({ questId }: { questId: string }) {
  const [tab, setTab] = useState<Tab>("participants");
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [winners, setWinners] = useState<Winner[]>([]);
  const [codes, setCodes] = useState<InviteCode[]>([]);
  const [loading, setLoading] = useState(true);

  const [drawCount, setDrawCount] = useState("1");
  const [drawing, setDrawing] = useState(false);
  const [distributing, setDistributing] = useState<string | "all" | null>(null);

  const [codesInput, setCodesInput] = useState("");
  const [generateCount, setGenerateCount] = useState("5");
  const [codePrefix, setCodePrefix] = useState("CQ");
  const [addingCodes, setAddingCodes] = useState(false);
  const [deletingCodeId, setDeletingCodeId] = useState<string | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);

  const [questTitle, setQuestTitle] = useState("");
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`/api/admin/quests/${questId}`).then((r) => r.json()),
      fetch(`/api/admin/quests/${questId}/participants`).then((r) => r.json()),
      fetch(`/api/admin/quests/${questId}/winners`).then((r) => r.json()),
      fetch(`/api/admin/quests/${questId}/invite-codes`).then((r) => r.json()),
    ])
      .then(([quest, p, w, c]: [{ title: string }, Participant[], Winner[], InviteCode[]]) => {
        setQuestTitle(quest.title ?? "");
        setParticipants(Array.isArray(p) ? p : []);
        setWinners(Array.isArray(w) ? w : []);
        setCodes(Array.isArray(c) ? c : []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [questId]);

  async function handleDrawRandom() {
    setDrawing(true);
    setMessage(null);
    const res = await fetch(`/api/admin/quests/${questId}/draw-winners`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count: Number(drawCount) }),
    });
    const data = (await res.json()) as { added: number; winners: Winner[] };
    if (res.ok) {
      setWinners((prev) => [...prev, ...data.winners]);
      setParticipants((prev) =>
        prev.map((p) =>
          data.winners.some((w) => w.userId === p.userId)
            ? { ...p, isWinner: true }
            : p,
        ),
      );
      setTab("winners");
      setMessage({ type: "ok", text: `${data.added} winner(s) selected.` });
    } else {
      setMessage({ type: "err", text: "Failed to draw winners" });
    }
    setDrawing(false);
  }

  async function handleDrawManual(userId: string) {
    setDrawing(true);
    setMessage(null);
    const res = await fetch(`/api/admin/quests/${questId}/draw-winners`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userIds: [userId] }),
    });
    const data = (await res.json()) as { added: number; winners: Winner[] };
    if (res.ok && data.added > 0) {
      setWinners((prev) => [...prev, ...data.winners]);
      setParticipants((prev) =>
        prev.map((p) => (p.userId === userId ? { ...p, isWinner: true } : p)),
      );
      setMessage({ type: "ok", text: "Winner selected." });
    }
    setDrawing(false);
  }

  async function handleDistribute(drawId: string | "all") {
    setDistributing(drawId);
    setMessage(null);
    const body =
      drawId === "all" ? {} : { drawIds: [drawId] };
    const res = await fetch(
      `/api/admin/quests/${questId}/distribute-rewards`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const data = (await res.json()) as {
      distributed: number;
      results: { email: string; ccSent: boolean; ccAmount: number }[];
    };
    if (res.ok) {
      setWinners((prev) =>
        prev.map((w) =>
          drawId === "all" || w.drawId === drawId
            ? { ...w, distributed: true, distributedAt: new Date().toISOString() }
            : w,
        ),
      );
      setMessage({
        type: "ok",
        text: `${data.distributed} reward(s) distributed.`,
      });
    } else {
      setMessage({ type: "err", text: "Distribution failed" });
    }
    setDistributing(null);
  }

  async function handleAddCodes(e: React.FormEvent) {
    e.preventDefault();
    setAddingCodes(true);
    setMessage(null);
    const body =
      codesInput.trim()
        ? { codes: codesInput.split(/[\n,]+/).map((c) => c.trim()).filter(Boolean) }
        : { generateCount: Number(generateCount), prefix: codePrefix };

    const res = await fetch(`/api/admin/quests/${questId}/invite-codes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { created: number; skipped: number };
    if (res.ok) {
      setMessage({ type: "ok", text: `${data.created} code(s) added.` });
      const fresh = await fetch(`/api/admin/quests/${questId}/invite-codes`).then((r) => r.json()) as InviteCode[];
      setCodes(fresh);
      setCodesInput("");
    } else {
      setMessage({ type: "err", text: "Failed to add codes" });
    }
    setAddingCodes(false);
  }

  async function refreshCodes() {
    const fresh = await fetch(`/api/admin/quests/${questId}/invite-codes`).then((r) =>
      r.json(),
    ) as InviteCode[];
    setCodes(Array.isArray(fresh) ? fresh : []);
  }

  async function handleDeleteCode(code: InviteCode) {
    if (code.assigned) {
      setMessage({
        type: "err",
        text: "Assigned codes cannot be deleted. Only available codes can be removed.",
      });
      return;
    }
    if (!confirm(`Delete code "${code.code}"?`)) return;

    setDeletingCodeId(code.id);
    setMessage(null);
    const res = await fetch(`/api/admin/quests/${questId}/invite-codes/${code.id}`, {
      method: "DELETE",
    });
    const data = (await res.json()) as { message?: string };
    if (res.ok) {
      setCodes((prev) => prev.filter((c) => c.id !== code.id));
      setMessage({ type: "ok", text: `Deleted ${code.code}.` });
    } else {
      setMessage({
        type: "err",
        text: data.message ?? "Failed to delete code",
      });
    }
    setDeletingCodeId(null);
  }

  async function handleDeleteAllAvailable() {
    const available = codes.filter((c) => !c.assigned).length;
    if (available === 0) {
      setMessage({ type: "err", text: "No available codes to delete." });
      return;
    }
    if (
      !confirm(
        `Delete all ${available} available code(s)? Assigned codes will be kept.`,
      )
    ) {
      return;
    }

    setDeletingAll(true);
    setMessage(null);
    const res = await fetch(`/api/admin/quests/${questId}/invite-codes`, {
      method: "DELETE",
    });
    const data = (await res.json()) as {
      deleted?: number;
      skippedAssigned?: number;
      message?: string;
    };
    if (res.ok) {
      await refreshCodes();
      const kept =
        data.skippedAssigned && data.skippedAssigned > 0
          ? ` ${data.skippedAssigned} assigned code(s) kept.`
          : "";
      setMessage({
        type: "ok",
        text: `Deleted ${data.deleted ?? 0} code(s).${kept}`,
      });
    } else {
      setMessage({
        type: "err",
        text: data.message ?? "Failed to delete codes",
      });
    }
    setDeletingAll(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--muted-foreground)]" />
      </div>
    );
  }

  const undistributed = winners.filter((w) => !w.distributed);
  const availableCodes = codes.filter((c) => !c.assigned).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href={`/admin/quests/${questId}`} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="type-section-title">
            Winners & Rewards
          </h1>
          <p className="text-sm text-[var(--muted-foreground)]">{questTitle}</p>
        </div>
      </div>

      {message && (
        <div className={cn(
          "rounded-xl px-4 py-3 text-sm font-medium",
          message.type === "ok"
            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            : "bg-red-500/10 text-red-600 dark:text-red-400",
        )}>
          {message.text}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b border-[var(--border)]">
        {([
          { id: "participants", label: `Participants (${participants.length})` },
          { id: "winners", label: `Winners (${winners.length})` },
          { id: "codes", label: `Invite Codes (${codes.length})` },
        ] as const).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={underlineTabClass(tab === t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Participants tab */}
      {tab === "participants" && (
        <div className="space-y-4">
          {/* Random draw control */}
          <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
            <div>
              <label className="mb-1 block text-xs font-medium">Draw N random winners</label>
              <input
                type="number"
                min="1"
                value={drawCount}
                onChange={(e) => setDrawCount(e.target.value)}
                className="w-24 rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 px-3 py-2 text-sm outline-none focus-visible:ring-2"
              />
            </div>
            <button
              type="button"
              disabled={drawing || participants.filter((p) => !p.isWinner).length === 0}
              onClick={() => void handleDrawRandom()}
              className="inline-flex items-center gap-2 rounded-full bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)] shadow-[0_0_16px_rgb(var(--canton-rgb)/0.18)] disabled:opacity-60"
            >
              {drawing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shuffle className="h-4 w-4" />}
              Random draw
            </button>
          </div>

          {participants.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">
              No participants have completed this quest yet.
            </p>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-[var(--border)]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--muted)]/50 text-left">
                    <th className="px-4 py-3 font-semibold">User</th>
                    <th className="px-4 py-3 font-semibold">Party ID</th>
                    <th className="px-4 py-3 font-semibold">Completed</th>
                    <th className="px-4 py-3 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {participants.map((p, i) => (
                    <tr key={p.userId} className={i % 2 === 0 ? "bg-[var(--card)]" : "bg-[var(--muted)]/20"}>
                      <td className="px-4 py-3">
                        <p className="font-medium">{p.displayName ?? p.username ?? p.email}</p>
                        <p className="text-xs text-[var(--muted-foreground)]">{p.email}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs text-[var(--muted-foreground)]">
                          {p.cantonPartyId ? `${p.cantonPartyId.split("::")[0]}::…` : "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--muted-foreground)]">
                        {new Date(p.completedAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        {p.isWinner ? (
                          <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Winner
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={drawing}
                            onClick={() => void handleDrawManual(p.userId)}
                            className="flex items-center gap-1 rounded-lg border border-[var(--border)] px-3 py-1 text-xs font-semibold hover:bg-[var(--muted)] disabled:opacity-50"
                          >
                            <UserCheck className="h-3.5 w-3.5" />
                            Select
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Winners tab */}
      {tab === "winners" && (
        <div className="space-y-4">
          {undistributed.length > 0 && (
            <div className="flex items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
              <p className="text-sm font-medium">
                {undistributed.length} winner(s) pending reward distribution
              </p>
              <button
                type="button"
                disabled={distributing !== null}
                onClick={() => void handleDistribute("all")}
                className="inline-flex items-center gap-2 rounded-full bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)] shadow-[0_0_16px_rgb(var(--canton-rgb)/0.18)] disabled:opacity-60"
              >
                {distributing === "all" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Distribute all
              </button>
            </div>
          )}

          {winners.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">
              No winners selected yet. Go to Participants tab to draw winners.
            </p>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-[var(--border)]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--muted)]/50 text-left">
                    <th className="px-4 py-3 font-semibold">Winner</th>
                    <th className="px-4 py-3 font-semibold">CC</th>
                    <th className="px-4 py-3 font-semibold">Invite Code</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {winners.map((w, i) => (
                    <tr key={w.drawId} className={i % 2 === 0 ? "bg-[var(--card)]" : "bg-[var(--muted)]/20"}>
                      <td className="px-4 py-3">
                        <p className="font-medium">{w.displayName ?? w.username ?? w.email}</p>
                        <p className="text-xs text-[var(--muted-foreground)]">{w.email}</p>
                        {w.cantonPartyId && (
                          <p className="font-mono text-[10px] text-[var(--muted-foreground)]">
                            {w.cantonPartyId.split("::")[0]}::…
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 font-semibold tabular-nums">
                        {w.ccAmount > 0 ? `${w.ccAmount} CC` : "—"}
                      </td>
                      <td className="px-4 py-3">
                        {w.inviteCode ? (
                          <span className="font-mono text-xs">{w.inviteCode}</span>
                        ) : (
                          <span className="text-xs text-[var(--muted-foreground)]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {w.distributed ? (
                          <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Sent
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-xs font-semibold text-orange-400 dark:text-orange-400">
                            <Clock className="h-3.5 w-3.5" />
                            Pending
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {!w.distributed && (
                          <button
                            type="button"
                            disabled={distributing !== null}
                            onClick={() => void handleDistribute(w.drawId)}
                            className="flex items-center gap-1 rounded-lg border border-[var(--border)] px-3 py-1 text-xs font-semibold hover:bg-[var(--muted)] disabled:opacity-50"
                          >
                            {distributing === w.drawId ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Send className="h-3.5 w-3.5" />
                            )}
                            Send
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Invite Codes tab */}
      {tab === "codes" && (
        <div className="space-y-5">
          {/* Add codes */}
          <form onSubmit={(e) => void handleAddCodes(e)} className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 space-y-4">
            <h3 className="type-subsection-title">Add invite codes</h3>
            <div className="space-y-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium">
                  Paste codes (one per line or comma-separated)
                </label>
                <textarea
                  rows={4}
                  value={codesInput}
                  onChange={(e) => setCodesInput(e.target.value)}
                  placeholder="CODE-ABCD1&#10;CODE-EFGH2&#10;CODE-IJKL3"
                  className="w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 px-3 py-2.5 font-mono text-sm outline-none focus-visible:ring-2"
                />
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-[var(--muted-foreground)]">— or —</span>
              </div>
              <div className="flex flex-wrap gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium">Auto-generate count</label>
                  <input type="number" min="1" max="500" value={generateCount} onChange={(e) => setGenerateCount(e.target.value)} className="w-24 rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 px-3 py-2 text-sm outline-none" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">Prefix</label>
                  <input value={codePrefix} onChange={(e) => setCodePrefix(e.target.value.toUpperCase())} maxLength={6} className="w-24 rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 px-3 py-2 text-sm font-mono outline-none" />
                </div>
              </div>
            </div>
            <button
              type="submit"
              disabled={addingCodes}
              className="inline-flex items-center gap-2 rounded-full bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)] shadow-[0_0_16px_rgb(var(--canton-rgb)/0.18)] disabled:opacity-60"
            >
              {addingCodes ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add codes
            </button>
          </form>

          {/* Code list */}
          {codes.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--muted-foreground)]">No invite codes yet.</p>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-[var(--border)]">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--muted)]/50 px-4 py-2.5">
                <p className="text-xs font-semibold text-[var(--muted-foreground)]">
                  {availableCodes} available · {codes.filter((c) => c.assigned).length} assigned
                </p>
                {availableCodes > 0 && (
                  <button
                    type="button"
                    disabled={deletingAll || deletingCodeId !== null}
                    onClick={() => void handleDeleteAllAvailable()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-[11px] font-semibold text-red-700 transition-colors hover:bg-red-500/15 disabled:opacity-50 dark:text-red-300"
                  >
                    {deletingAll ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                    Delete all available
                  </button>
                )}
              </div>
              <div className="divide-y divide-[var(--border)]">
                {codes.map((code) => (
                  <div key={code.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="flex min-w-0 items-center gap-3">
                      <Ticket className={cn("h-4 w-4 shrink-0", code.assigned ? "text-[var(--muted-foreground)]" : "text-[var(--primary)]")} />
                      <span className="truncate font-mono text-sm">{code.code}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {code.assigned ? (
                        <span className="text-xs text-[var(--muted-foreground)]">
                          → {code.assignedTo?.email ?? "assigned"}
                        </span>
                      ) : (
                        <>
                          <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-700 dark:text-emerald-300">
                            Available
                          </span>
                          <button
                            type="button"
                            disabled={deletingCodeId !== null || deletingAll}
                            onClick={() => void handleDeleteCode(code)}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted-foreground)] transition-colors hover:bg-red-500/10 hover:text-red-600 disabled:opacity-40 dark:hover:text-red-400"
                            aria-label={`Delete ${code.code}`}
                          >
                            {deletingCodeId === code.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
