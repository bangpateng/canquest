import type { ReactNode } from 'react';

/** Root admin layout — no auth here so `/admin/login` works without app session. */
export default function AdminRootLayout({ children }: { children: ReactNode }) {
  return children;
}
