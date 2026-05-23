import { SettingsAccountPanel } from "@/components/app/settings/settings-account-panel";
import { SignOutButton } from "@/components/app/sign-out-button";

export default function SettingsPage() {
  return (
    <div className="mx-auto grid max-w-3xl gap-8 pb-8">
      <SettingsAccountPanel />

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--muted)]/30 p-6 md:p-8">
        <h3 className="type-section-title">Sessions</h3>

        <ul className="mt-4 space-y-3 text-sm">
          <li className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
            <span>Email login alerts</span>
            <span className="text-xs font-medium text-[var(--muted-foreground)]">Enabled</span>
          </li>
          <li className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
            <span>Marketing digests</span>
            <span className="text-xs font-medium text-[var(--muted-foreground)]">Off</span>
          </li>
        </ul>
      </section>

      <div className="flex justify-center pb-4 pt-2">
        <SignOutButton variant="link" />
      </div>
    </div>
  );
}
