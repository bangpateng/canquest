"use client";

import { MOCK_SPIN_TIERS } from "@/lib/mock-demo";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Sparkles } from "lucide-react";
import { useMemo, useState } from "react";

const OUTCOMES = [
  "Better luck next time — try another spin!",
  "You won: WL code **BUILDER-APR-442**",
  "+25 CC credited (mock)",
  "Spin ticket +1 deposited",
  "Rare: treasury fee waived on next transfer (demo)",
];

export function SpinDemo() {
  const [balance, setBalance] = useState(9847);
  const [cost] = useState(500);
  const [last, setLast] = useState<string | null>(
    "Last spin · WL code ALPHA-CRAFT-09 (preview)",
  );
  const [spinning, setSpinning] = useState(false);

  const canSpin = balance >= cost;

  const runSpin = () => {
    if (!canSpin || spinning) return;
    setSpinning(true);
    window.setTimeout(() => {
      setBalance((b) => b - cost);
      const msg = OUTCOMES[Math.floor(Math.random() * OUTCOMES.length)] ?? "";
      setLast(msg.replace(/\*\*(.*?)\*\*/g, "$1"));
      setSpinning(false);
    }, 900);
  };

  const wheelLabels = useMemo(
    () => ["Miss", "WL", "CC", "Rare", "Pts", "Miss"],
    [],
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr,280px]">
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 md:p-8">
        <div className="flex flex-col items-center gap-6">
          <div
            className={cn(
              "relative flex h-52 w-52 items-center justify-center rounded-full border-4 border-[var(--border)] bg-[var(--muted)] shadow-[inset_0_0_36px_rgb(199_242_39_/_10%)]",
              spinning && "animate-pulse",
            )}
          >
            <div className="relative z-[1] flex h-[7.25rem] w-[7.25rem] flex-col justify-center rounded-full border-2 border-[var(--primary)]/25 bg-[var(--card)] p-3">
              <div className="grid grid-cols-3 gap-1 text-center text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                {wheelLabels.map((label, i) => (
                  <span
                    key={`${label}-${i}`}
                    className="flex items-center justify-center rounded-md bg-[var(--muted)] px-0.5 py-1"
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="flex w-full max-w-xs flex-col items-center gap-2 text-center">
            <p className="text-sm text-[var(--muted-foreground)]">
              Balance:{" "}
              <span className="font-semibold text-[var(--foreground)]">
                {balance.toLocaleString()} pts
              </span>
            </p>
            <p className="text-xs text-[var(--muted-foreground)]">
              Each spin costs {cost.toLocaleString()} pts (preview only).
            </p>
            <button
              type="button"
              disabled={!canSpin || spinning}
              onClick={runSpin}
              className={cn(buttonVariants({ size: "lg" }), "w-full gap-2")}
            >
              <Sparkles className="h-4 w-4" />
              {spinning ? "Spinning…" : "Spin now"}
            </button>
          </div>
          {last && (
            <p className="w-full rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 px-4 py-3 text-center text-sm text-[var(--foreground)]">
              {last}
            </p>
          )}
        </div>
      </div>
      <aside className="rounded-2xl border border-[var(--border)] bg-[var(--muted)]/30 p-6">
        <h3 className="font-[family-name:var(--font-space)] text-sm font-semibold">
          Probability table (example)
        </h3>
        <ul className="mt-4 space-y-3 text-sm">
          {MOCK_SPIN_TIERS.map((row) => (
            <li
              key={row.name}
              className="flex items-center justify-between border-b border-[var(--border)] pb-2 last:border-0"
            >
              <span className={row.color}>{row.name}</span>
              <span className="tabular-nums text-[var(--muted-foreground)]">
                {row.pct}
              </span>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
