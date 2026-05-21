import Link from 'next/link';
import { AdminUsersPanel } from '@/components/admin/admin-users-panel';

export default function AdminUsersPage() {
  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin"
          className="text-sm font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          ← Dashboard
        </Link>
        <h1 className="mt-2 font-[family-name:var(--font-space)] text-2xl font-semibold">
          Users
        </h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Delete test accounts from the database. Admin accounts cannot be removed.
        </p>
      </div>
      <AdminUsersPanel />
    </div>
  );
}
