import Link from "next/link";
import { AdminWalletInvitesPanel } from "@/components/admin/admin-wallet-invites-panel";

export default function AdminWalletInvitesPage() {
  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin"
          className="text-sm font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          ← Dashboard
        </Link>
        <h1 className="type-page-title mt-2">Wallet invite codes</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Generate one-time codes users must enter to create a Canton wallet. No daily limit —
          each code can only be used once.
        </p>
      </div>
      <AdminWalletInvitesPanel />
    </div>
  );
}
