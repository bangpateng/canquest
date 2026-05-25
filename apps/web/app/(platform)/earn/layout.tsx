import { Suspense } from "react";
import { WalletRequiredGate } from "@/components/platform/wallet-required-gate";

export default function EarnLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <WalletRequiredGate>{children}</WalletRequiredGate>
    </Suspense>
  );
}
