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
          Spot and clean up referral fraud. Referrals are flagged when the
          invited email is from a non-webmail domain <strong>or</strong> a Gmail
          alias (dots/plus tricks). Normal Gmail/Yahoo/Outlook are not flagged.
          Remove them to claw back the points they earned the referrer.
        </p>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
          <strong>Going forward:</strong> a referral reward now requires the
          invited user to verify their email <strong>and</strong> connect an X
          (Twitter) account — closing the farming loophole.
        </p>
      </div>
      <AdminReferralAuditPanel />
    </div>
  );
}
