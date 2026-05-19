import Link from "next/link";

export function CantonSection() {
  return (
    <section
      id="canton"
      className="border-b border-[var(--border)] bg-[var(--muted)]/50 py-20"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 sm:flex-row sm:items-center sm:px-6">
        <div className="flex-1 space-y-4">
          <h2 className="font-[family-name:var(--font-space)] text-3xl font-semibold tracking-tight sm:text-4xl">
            Powered by Canton
          </h2>
          <p className="text-[var(--muted-foreground)]">
            CanQuest aligns with Digital Asset ledger patterns and DAML module
            boundaries. Smart contracts evolve in lockstep with official SDK
            guidance—no fictional “custom L2” narratives.
          </p>
          <ul className="space-y-2 text-sm text-[var(--muted-foreground)]">
            <li>• Participant-managed parties and Ledger API workflows</li>
            <li>• Event-driven backends; heavy ledger work never blocks HTTP</li>
            <li>• Dedicated indexer projects app state off the hot path</li>
          </ul>
        </div>
        <div className="glass-card flex flex-1 flex-col gap-3 rounded-2xl p-8">
          <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
            Official references
          </p>
          <Link
            className="text-sm font-medium text-[var(--foreground)] underline-offset-4 hover:underline"
            href="https://docs.digitalasset.com/build/3.5/index.html"
            target="_blank"
            rel="noreferrer"
          >
            Digital Asset build docs (3.5)
          </Link>
          <Link
            className="text-sm font-medium text-[var(--foreground)] underline-offset-4 hover:underline"
            href="https://docs.digitalasset.com/build/3.5/reference/app-dev/index.html"
            target="_blank"
            rel="noreferrer"
          >
            Application development reference
          </Link>
          <Link
            className="text-sm font-medium text-[var(--foreground)] underline-offset-4 hover:underline"
            href="https://docs.digitalasset.com/build/3.5/reference/smart-contracts/index.html"
            target="_blank"
            rel="noreferrer"
          >
            Smart contracts reference
          </Link>
        </div>
      </div>
    </section>
  );
}
