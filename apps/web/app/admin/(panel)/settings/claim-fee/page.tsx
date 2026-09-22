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
          Default on-chain fee (CC) per reward type. Dipakai hanya untuk campaign
          baru yang tidak mengisi fee sendiri — campaign lama tetap pakai fee
          kontraknya masing-masing.
        </p>
      </div>
      <AdminClaimFeePanel />
    </div>
  );
}
