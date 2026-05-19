import { QuestsBrowser } from "@/components/app/quests-browser";

export default function QuestsPage() {
  return (
    <div className="space-y-6">
      <div className="max-w-3xl">
        <p className="text-sm font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
          Programs
        </p>
        <h2 className="mt-1 font-[family-name:var(--font-space)] text-2xl font-semibold tracking-tight">
          Earn CC on verified tasks
        </h2>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          Complete tasks to earn CC rewards. Each submission is verified and recorded
          on the Canton ledger as Proof of Execution.
        </p>
      </div>
      <QuestsBrowser />
    </div>
  );
}
