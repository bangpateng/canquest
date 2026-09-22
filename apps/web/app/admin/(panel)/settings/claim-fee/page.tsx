import Link from "next/link";
import { AdminClaimFeePanel } from "@/components/admin/admin-claim-fee-panel";

export default function AdminClaimFeeSettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin"
          className="text-sm font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          ← Dashboard
        </Link>
        <h1 className="type-page-title mt-2">Claim fee defaults</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Default on-chain fee (CC) per reward type. Used only for new campaigns
          that don&apos;t set their own fee — older campaigns keep their existing
          contract fee.
        </p>
      </div>
      <AdminClaimFeePanel />
    </div>
  );
}
