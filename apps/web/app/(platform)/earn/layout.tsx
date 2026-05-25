import { WalletRequiredGate } from "@/components/platform/wallet-required-gate";

/** Partner campaigns — wallet required before accessing Earn. */
export default function EarnLayout({ children }: { children: React.ReactNode }) {
  return <WalletRequiredGate>{children}</WalletRequiredGate>;
}
