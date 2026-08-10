import type { Metadata } from "next";
import { DocsLayout } from "@/components/docs/docs-layout";
import {
  DocsHeader,
  DocsLink,
  DocsPager,
  DocsSection,
  Lead,
} from "@/components/docs/docs-primitives";

export const metadata: Metadata = {
  title: "FAQ — CanQuest Docs",
  description:
    "Common questions about CanQuest: is it an airdrop/farming platform, swap status, where to see transactions, and regional focus.",
  alternates: { canonical: "/docs/faq" },
};

export default function FaqPage() {
  return (
    <DocsLayout>
      <DocsHeader
        title="FAQ"
        subtitle="Common questions about CanQuest, answered against the live product."
      />

      <DocsSection title="Is CanQuest an airdrop or farming platform?">
        <p>
          No. The point is early access to ecosystem projects and a verified
          on-chain standing — CC rewards come with that, but they&apos;re not
          the main thing.
        </p>
      </DocsSection>

      <DocsSection title="Is the swap live?">
        <p>
          Yes, for <Lead>CC ↔ USDCx</Lead> through the OneSwap exchange. More
          pairs (such as CBTC) are coming. The swap is in beta — quotes show
          the rate and price impact before you confirm, and there are sensible
          minimums and impact guards. See{" "}
          <DocsLink slug="wallet">Wallet</DocsLink> for the details.
        </p>
      </DocsSection>

      <DocsSection title="Where can I see my transactions on-chain?">
        <p>
          Open <Lead>Activity</Lead> in the app for your full history. Each
          transaction has a link to the Canton explorer for the underlying
          on-chain update.
        </p>
      </DocsSection>

      <DocsSection title="Can I have more than one wallet?">
        <p>
          No — by design, one verified human gets one Canton party ID. Wallet
          creation is invite-gated under a daily quota to keep the identity
          layer honest. See{" "}
          <DocsLink slug="anti-sybil">Verification &amp; anti-sybil</DocsLink>.
        </p>
      </DocsSection>

      <DocsSection title="Does CanQuest do KYC / identity verification?">
        <p>
          No. CanQuest uses <Lead>structural</Lead> anti-sybil controls
          (invite-gated wallets, email OTP, server-verified tasks, commitment
          gating) to make farming costly. It is not a KYC product and does not
          prove a single real-world human behind every account.
        </p>
      </DocsSection>

      <DocsSection title="What happens to my CC when I lock it?">
        <p>
          It stays in your own wallet as a <Lead>LockedAmulet</Lead> and is
          returned in full when the term ends. A small network cost applies
          while it is locked. Locking promotes your account to Full access,
          which unlocks partner campaigns.
        </p>
      </DocsSection>

      <DocsSection title="What regions is CanQuest for?" className="border-b-0">
        <p>
          CanQuest is Canton-native and globally accessible, with a focus on
          Indonesia and Southeast Asia. Anyone with a verified wallet can
          participate.
        </p>
      </DocsSection>

      <DocsPager currentSlug="faq" />
    </DocsLayout>
  );
}
