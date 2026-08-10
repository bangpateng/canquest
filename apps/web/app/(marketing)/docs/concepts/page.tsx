import type { Metadata } from "next";
import { DocsLayout } from "@/components/docs/docs-layout";
import {
  DocsHeader,
  DocsLink,
  DocsPager,
  DocsSection,
  DocsTable,
  Lead,
  UL,
} from "@/components/docs/docs-primitives";
import { Callout } from "@/components/docs/callout";
import { InlineCode } from "@/components/docs/code-block";

export const metadata: Metadata = {
  title: "Core concepts — CanQuest Docs",
  description:
    "The building blocks of CanQuest: CC (Amulet), USDCx, locked amulets, transfer preapproval, and party-based identity on Canton.",
  alternates: { canonical: "/docs/concepts" },
};

export default function ConceptsPage() {
  return (
    <DocsLayout>
      <DocsHeader
        title="Core concepts"
        subtitle="The building blocks of CanQuest: CC, USDCx, locked amulets, transfer preapproval, and party-based identity on Canton."
      />

      <DocsSection title="Party ID (your on-chain identity)">
        <p>
          On Canton, your identity is a <Lead>party ID</Lead> — a string like{" "}
          <InlineCode>alice::1220…</InlineCode>. One verified human gets one
          party ID. It is the address you send to and receive CC and tokens at.
        </p>
        <p>
          CanQuest uses a <Lead>custodial</Lead> model: the CanQuest operator
          submits on-chain actions on your behalf. You keep control of your
          balances; you do not need to manage keys or sign raw Canton
          transactions yourself.
        </p>
      </DocsSection>

      <DocsSection title="CC (Amulet)">
        <p>
          <Lead>CC</Lead> is the native unit of Canton Network (the on-chain
          instrument is the <Lead>Amulet</Lead>). It is the workhorse of the
          whole platform:
        </p>
        <UL>
          <li>Sent and received P2P in the Wallet.</li>
          <li>Locked for a term to reach &ldquo;Full access&rdquo;.</li>
          <li>Used to pay quest claim fees.</li>
          <li>Distributed as quest and campaign rewards.</li>
        </UL>
        <p>
          Your CC balance is shown in USD at the live amulet price. Read it in{" "}
          <DocsLink slug="wallet">Wallet</DocsLink>.
        </p>
      </DocsSection>

      <DocsSection title="USDCx & tokens">
        <p>
          <Lead>USDCx</Lead> is a non-CC token you can hold, send P2P, and swap
          against CC through the OneSwap exchange. Token transfers move via the
          same Canton token standard (CIP-56) as CC.
        </p>
        <DocsTable
          head={["Token", "Send P2P", "Swap", "Status"]}
          rows={[
            ["CC (Amulet)", "Yes", "Yes (vs USDCx)", "Live"],
            ["USDCx", "Yes", "Yes (vs CC)", "Live"],
            ["CBTC", "Visible", "—", "Coming soon"],
          ]}
        />
        <Callout type="info" title="Where tokens come from">
          Token metadata (symbol, instrument id, admin) is resolved from the
          OneSwap registry. As OneSwap lists more pairs, more tokens become
          transferable and swappable in CanQuest.
        </Callout>
      </DocsSection>

      <DocsSection title="Locked amulets">
        <p>
          A <Lead>LockedAmulet</Lead> is CC you have locked for a chosen term.
          Locking proves intent and promotes your account to{" "}
          <Lead>Full access</Lead> — the tier that unlocks partner campaigns in
          Earn.
        </p>
        <UL>
          <li>Your CC stays in your own wallet; it does not move to a custodian.</li>
          <li>Pick a term (e.g. 7, 15, or 30 days — options come from the server).</li>
          <li>When the term ends, unlock and your CC returns in full. A small network cost applies while locked.</li>
        </UL>
        <p>
          Locks also drive lock-based eligibility: some campaigns require a
          minimum locked amount instead of (or alongside) points.
        </p>
      </DocsSection>

      <DocsSection title="Transfer preapproval">
        <p>
          <Lead>Transfer preapproval</Lead> is an on-chain authorization
          (Canton CIP-56) that lets incoming CC transfers land in your wallet
          <em> directly</em>, instead of arriving as an offer you must manually
          accept.
        </p>
        <UL>
          <li>Toggle it per token from <DocsLink slug="wallet">Wallet</DocsLink>.</li>
          <li>Enabling pre-pays a small one-time network burn (around 1.5 CC).</li>
          <li>Toggling has a 7-day cooldown.</li>
        </UL>
        <Callout type="warning" title="Why a burn?">
          The burn is a Canton network cost for creating the preapproval
          contract, not a CanQuest fee. It is paid once when you enable.
        </Callout>
      </DocsSection>

      <DocsSection title="Featured App Right (FAR)" className="border-b-0">
        <p>
          The <Lead>Featured App Right (FAR)</Lead> is an optional Canton
          mechanism that lets a featured app submit certain actions on behalf
          of its users more efficiently.
        </p>
        <p>
          CanQuest&apos;s code is <Lead>FAR-ready</Lead>, but FAR is{" "}
          <em>off by default</em> today. All transfers currently use the direct
          token-standard path. Switching FAR on is an internal, behind-the-scenes
          change that does not affect how you use the app — you do not need to
          do anything.
        </p>
      </DocsSection>

      <DocsPager currentSlug="concepts" />
    </DocsLayout>
  );
}
