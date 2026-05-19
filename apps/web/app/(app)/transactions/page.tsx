import { MOCK_TRANSACTIONS } from "@/lib/mock-demo";
import { cn } from "@/lib/utils";

export default function TransactionsPage() {
  return (
    <div className="space-y-6">
      <div className="max-w-2xl">
        <p className="text-sm font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
          History
        </p>
        <h2 className="mt-1 font-[family-name:var(--font-space)] text-2xl font-semibold tracking-tight">
          Movement log
        </h2>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          Sample rows emulate indexer output: statuses, counterparties, and fee
          line items.
        </p>
      </div>
      <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[var(--border)] bg-[var(--muted)]/50 text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
              <tr>
                <th className="whitespace-nowrap px-4 py-3 font-medium">Ref</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">Type</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">Amount</th>
                <th className="hidden whitespace-nowrap px-4 py-3 font-medium md:table-cell">
                  Counterparty
                </th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">Fee</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">Status</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {MOCK_TRANSACTIONS.map((tx) => (
                <tr
                  key={tx.id}
                  className="border-t border-[var(--border)] transition-colors hover:bg-[var(--muted)]/40"
                >
                  <td className="px-4 py-3 font-mono text-xs text-[var(--muted-foreground)]">
                    {tx.id}
                  </td>
                  <td className="px-4 py-3 font-medium">{tx.type}</td>
                  <td className="px-4 py-3 tabular-nums">{tx.amount}</td>
                  <td className="hidden max-w-[10rem] truncate px-4 py-3 font-mono text-xs text-[var(--muted-foreground)] md:table-cell">
                    {tx.counterparty}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-[var(--muted-foreground)]">
                    {tx.fee}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs font-semibold",
                        tx.status === "Settled"
                          ? "bg-canton-subtle text-canton-muted border border-canton-muted"
                          : "bg-amber-500/15 text-amber-800 dark:text-amber-300",
                      )}
                    >
                      {tx.status}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-[var(--muted-foreground)]">
                    {tx.time}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
