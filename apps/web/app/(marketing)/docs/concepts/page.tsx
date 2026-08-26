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
import { InlineCode } from "@/components/docs/code-block";

export const metadata: Metadata = {
  title: "Core concepts — CanQuest Docs",
  description:
    "CC (Amulet), USDCx, locked amulets, transfer preapproval, and party-based identity on Canton.",
  alternates: { canonical: "/docs/concepts" },
};

export default function ConceptsPage() {
  return (
    <DocsLayout>
      <DocsHeader
        title="Core concepts"
        subtitle="The building blocks of CanQuest: CC, tokens, locks, preapproval, and party-based identity."
      />

      <DocsSection title="Party ID">
        <p>
          Your identity on Canton is a <Lead>party ID</Lead> — a string like{" "}
          <InlineCode>alice::1220…</InlineCode>. One verified account gets one.
          It&apos;s the address you send to and receive CC and tokens at.
        </p>
        <p>
          CanQuest is <Lead>non-custodial</Lead>: your Ed25519 private key is
          generated and encrypted in your browser and never leaves it. Every
          on-chain action — send, lock, swap, claim — is signed by you. During
          setup you save a <Lead>Backup Key</Lead> (64-character hex) that can
          restore your wallet and reset your passphrase on any device.
        </p>
      </DocsSection>

      <DocsSection title="CC (Amulet)">
        <p>
          <Lead>CC</Lead> is the native unit of Canton Network (the on-chain
          instrument is the <Lead>Amulet</Lead>). You send it, lock it, pay
          quest fees with it, and receive it as rewards. Your balance is shown
          in USD at the live amulet price.
        </p>
      </DocsSection>

      <DocsSection title="USDCx & tokens">
        <p>
          <Lead>USDCx</Lead> is a token you can hold, send P2P, and swap against
          CC via the OneSwap exchange.
        </p>
        <DocsTable
          head={["Token", "Send P2P", "Swap", "Status"]}
          rows={[
            ["CC (Amulet)", "Yes", "Yes (vs USDCx)", "Live"],
            ["USDCx", "Yes", "Yes (vs CC)", "Live"],
            ["CBTC", "Visible", "—", "Coming soon"],
          ]}
        />
      </DocsSection>

      <DocsSection title="Locked amulets">
        <p>
          A <Lead>LockedAmulet</Lead> is CC you&apos;ve locked for a chosen term
          to reach <Lead>Full access</Lead>, which unlocks partner campaigns.
        </p>
        <UL>
          <li>Your CC stays in your wallet — it doesn&apos;t move to a custodian.</li>
          <li>Pick a term (e.g. 7, 15, or 30 days — options come from the server).</li>
          <li>When the term ends, unlock and your CC returns in full. A small network cost applies while locked.</li>
        </UL>
      </DocsSection>

      <DocsSection title="Transfer preapproval" className="border-b-0">
        <p>
          <Lead>Transfer preapproval</Lead> lets incoming CC transfers land in
          your wallet directly, instead of arriving as an offer you must accept.
          Toggle it per token from{" "}
          <DocsLink slug="wallet">Wallet</DocsLink>. Enabling pre-pays a one-time
          network burn (around 1.5 CC), and toggling has a 7-day cooldown.
        </p>
      </DocsSection>

      <DocsPager currentSlug="concepts" />
    </DocsLayout>
  );
}
