import type { ReactNode } from 'react';

import { cookies } from 'next/headers';

import { redirect } from 'next/navigation';

import { jwtVerify } from 'jose';

import { AppShell } from '@/components/app/shell/app-shell';

import { CQ_ACCESS_COOKIE } from '@/lib/auth/auth-cookies';

export default async function DappLayout({ children }: { children: ReactNode }) {
  const jar = await cookies();
  const token = jar.get(CQ_ACCESS_COOKIE)?.value;
  const secret = process.env.JWT_ACCESS_SECRET;

  if (!token || !secret) {
    redirect('/?auth=login');
  }

  try {
    await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ['HS256'] });
  } catch {
    redirect('/?auth=login');
  }

  return <AppShell>{children}</AppShell>;
}
