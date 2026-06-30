import Link from 'next/link';
import { AdminMaintenancePanel } from '@/components/admin/admin-maintenance-panel';

export default function AdminMaintenanceSettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin"
          className="text-sm font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          ← Dashboard
        </Link>
        <h1 className="type-page-title mt-2">Maintenance mode</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Aktifkan untuk menghentikan sementara semua aktivitas pengguna (mis.
          saat pembaruan). Admin panel tetap dapat diakses untuk pemulihan.
        </p>
      </div>
      <AdminMaintenancePanel />
    </div>
  );
}
