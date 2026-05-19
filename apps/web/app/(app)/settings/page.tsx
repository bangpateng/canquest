import { SettingsAccountPanel } from "@/components/app/settings/settings-account-panel";
import { SignOutButton } from "@/components/app/sign-out-button";

export default function SettingsPage() {
  return (
    <div className="mx-auto grid max-w-3xl gap-8 pb-8">
      <SettingsAccountPanel />

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--muted)]/30 p-6 md:p-8">
        <h3 className="font-[family-name:var(--font-space)] text-lg font-semibold">Sessions & alerts</h3>

        <ul className="mt-4 space-y-3 text-sm">
          <li className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
            <span>Email login alerts</span>
            <span className="text-xs font-medium text-canton-muted">Mock · enabled</span>
          </li>

          <li className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
            <span>Device fingerprint reminder</span>
            <span className="text-xs font-medium text-[var(--muted-foreground)]">Planned · JWT rotation Phase 6</span>
          </li>

          <li className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
            <span>Marketing digests</span>
            <span className="text-xs font-medium text-[var(--muted-foreground)]">Off</span>
          </li>
        </ul>
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 md:p-8">
        <h3 className="font-[family-name:var(--font-space)] text-lg font-semibold">Sign out</h3>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          End your session on this browser. You can sign in again anytime.
        </p>
        <div className="mt-6">
          <SignOutButton className="w-full shrink-0 sm:w-auto sm:min-w-[10rem]" />
        </div>
      </section>
    </div>
  );
}
