import { Lock, Server } from "lucide-react";

export function SecuritySection() {
  return (
    <section id="security" className="border-b border-[var(--border)] py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mb-10 max-w-2xl">
          <h2 className="font-[family-name:var(--font-space)] text-3xl font-semibold tracking-tight sm:text-4xl">
            Security-first operations
          </h2>
          <p className="mt-3 text-[var(--muted-foreground)]">
            Separate validator infrastructure from customer-facing surfaces. Rate
            limits, JWT rotation, device signals, and observability are first-class—not
            stretch goals.
          </p>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--primary)]/12">
              <Server className="h-5 w-5" />
            </div>
            <h3 className="mt-4 font-[family-name:var(--font-space)] text-lg font-semibold">
              Network isolation
            </h3>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">
              Validators and ledger API stay on dedicated metal. SSH tunnels for
              dev; production peers over private connectivity—never a public RPC
              spray.
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--primary)]/12">
              <Lock className="h-5 w-5" />
            </div>
            <h3 className="mt-4 font-[family-name:var(--font-space)] text-lg font-semibold">
              Abuse resistance
            </h3>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">
              Anti-sybil heuristics, captcha-ready APIs, replay protection on
              chain-adjacent actions, and structured audit trails for every
              sensitive decision.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
