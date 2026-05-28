import type { ReactNode } from "react";
import { Suspense } from "react";
import { SiteFooter } from "@/components/landing/site-footer";
import { SiteHeader } from "@/components/landing/site-header";
import { AuthProvider } from "@/components/platform/auth-context";
import { AuthModal } from "@/components/platform/auth-modal";
import { AuthModalOpener } from "@/components/platform/auth-modal-opener";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <SiteHeader />
      <main className="flex flex-col">{children}</main>
      <SiteFooter />
      <AuthModal />
      <Suspense fallback={null}>
        <AuthModalOpener />
      </Suspense>
    </AuthProvider>
  );
}
