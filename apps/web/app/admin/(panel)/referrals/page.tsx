import Link from 'next/link';
import { AdminReferralAuditPanel } from '@/components/admin/admin-referral-audit-panel';

export default function AdminReferralsPage() {
  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin"
          className="text-sm font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          ← Dashboard
        </Link>
        <h1 className="type-page-title mt-2">Referral audit</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Spot and clean up referral fraud. Flagged referrals used email domains
          outside the allowed webmail list (Gmail, Yahoo, Outlook, etc.). Remove
          them to claw back the points they earned the referrer.
        </p>
      </div>
      <AdminReferralAuditPanel />
    </div>
  );
}
