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
  title: "Wallet — CC, tokens & swap — CanQuest Docs",
  description:
    "Everything in the Wallet menu: balances, send CC and USDCx, swap via OneSwap, lock and unlock CC, transfer preapproval, the offer inbox, and transaction history.",
  alternates: { canonical: "/docs/wallet" },
};

export default function WalletPage() {
  return (
    <DocsLayout>
      <DocsHeader
        title="Wallet — CC, tokens & swap"
        subtitle="Your Canton party ID in one place: balances, send, receive, swap, lock, offers, and full transaction history."
      />

      <DocsSection title="Balances">
        <p>
          Your total balance is shown in USD, summing CC and token values at
          live prices. <Lead>CC (Amulet)</Lead> is always shown;{" "}
          <Lead>USDCx</Lead> is active; <Lead>CBTC</Lead> is listed as{" "}
          <em>Coming soon</em>.
        </p>
        <Callout type="note" title="Prices">
          CC is priced at the live amulet price from the Canton scan proxy;
          token prices come from the OneSwap registry.
        </Callout>
      </DocsSection>

      <DocsSection title="Send CC">
        <p>
          Send CC to any other CanQuest user or raw Canton party. You see any
          applicable network cost before you confirm.
        </p>
        <UL>
          <li>Pick CC, enter an amount (a <em>MAX</em> button fills it), and an optional memo.</li>
          <li>
            Recipient can be an <InlineCode>@username</InlineCode> or a raw
            Canton party ID (<InlineCode>alice::1220…</InlineCode>).
          </li>
          <li>
            CC sends settle instantly when transfer preapproval is enabled;
            otherwise they arrive as an offer the recipient must accept.
          </li>
        </UL>
        <Callout type="note" title="Platform fee">
          CC sends carry a small platform fee (current default{" "}
          <strong>0.02 CC</strong>). The exact fee is shown in the review step
          before you sign. It is a configurable default, subject to change.
        </Callout>
      </DocsSection>

      <DocsSection title="Send token (USDCx)">
        <p>
          Send a non-CC token P2P, with the platform fee paid in CC. Today this
          means <Lead>USDCx</Lead>.
        </p>
        <UL>
          <li>The recipient and your CC fee-balance are pre-checked.</li>
          <li>Token sends create an offer the recipient must accept (they do not land directly).</li>
          <li>Other tokens (CBTC) are listed but not sendable yet.</li>
        </UL>
      </DocsSection>

      <DocsSection title="Swap (OneSwap)">
        <p>
          Swap <Lead>CC ↔ USDCx</Lead> through the OneSwap exchange. You get a
          live quote showing the rate and price impact before you confirm.
        </p>
        <DocsTable
          head={["Setting", "Default", "Notes"]}
          rows={[
            ["Pair", "CC ↔ USDCx", "More pairs coming (CBTC, …)"],
            ["Slippage tolerance", "2%", "Rejected beyond this at execution"],
            ["Max price impact", "5%", "Swaps above this are blocked"],
            ["Minimum CC leg", "10 CC", "Below this, quote is rejected"],
            ["Minimum token leg", "2.5", "Below this, quote is rejected"],
          ]}
        />
        <Callout type="tip" title="No platform fee on swaps">
          CanQuest doesn&apos;t add its own fee on swaps — you only pay the
          native OneSwap fees. The platform fee applies to Send, not swap.
        </Callout>
      </DocsSection>

      <DocsSection title="Lock CC">
        <p>
          Lock CC from your wallet to reach <Lead>Full access</Lead> and unlock
          partner campaigns. Your CC stays in your wallet and returns in full
          at the end of the term. Pick a term — options come from the server
          (typically <InlineCode>7d</InlineCode>, <InlineCode>15d</InlineCode>,{" "}
          <InlineCode>30d</InlineCode>). A small network cost applies while locked.
        </p>
      </DocsSection>

      <DocsSection title="Unlock CC">
        <p>
          Once a lock&apos;s term has expired, unlock it to return the CC to
          your spendable balance. You can&apos;t unlock before the term ends.
        </p>
      </DocsSection>

      <DocsSection title="Transfer preapproval">
        <p>
          Toggle <Lead>one-step transfer</Lead> so incoming CC arrives
          instantly instead of as an offer you must accept.
        </p>
        <UL>
          <li>Per-token. CC is live; USDCx/CBTC are coming soon.</li>
          <li>
            Valid for 90 days and renews on re-enable — enabling is signed in
            your browser like every other on-chain action.
          </li>
          <li>Turn it off and on any time from Settings.</li>
        </UL>
        <Callout type="warning" title="Trade-off">
          With preapproval <em>off</em>, incoming CC is safer from unwanted
          transfers (you accept each one) but slower. With it <em>on</em>,
          transfers land instantly but anyone who knows your party ID can push
          CC to you. Most users enable it for convenience.
        </Callout>
      </DocsSection>

      <DocsSection title="Signing & security">
        <p>
          Every on-chain action is signed with the key held in your browser.
          You enter your <Lead>passphrase</Lead> once per session — after that,
          transactions only need your confirmation. The wallet{" "}
          <Lead>auto-locks after 10 minutes</Lead> of inactivity, and you can
          lock it any time from Settings → Wallet Keys.
        </p>
        <UL>
          <li>Keys are generated and encrypted in your browser — never sent to any server.</li>
          <li>
            Forgot your passphrase? Restore with your Backup Key (64-char hex)
            and set a new one — Settings → Wallet Keys.
          </li>
          <li>
            Lost both passphrase and Backup Key? The wallet is unrecoverable —
            no one, including CanQuest, can restore it.
          </li>
        </UL>
      </DocsSection>

      <DocsSection title="Offer inbox">
        <p>
          Pending transfers that need your action live in the{" "}
          <Lead>Offers</Lead> tab.
        </p>
        <UL>
          <li><Lead>Incoming</Lead> — pending transfers to you. Accept or reject each one.</li>
          <li><Lead>Sent</Lead> — outgoing transfers you can cancel (withdraw) to return funds to your wallet.</li>
        </UL>
      </DocsSection>

      <DocsSection title="Transaction history" className="border-b-0">
        <p>
          Full history — sends, receives, locks, unlocks, swaps, offers, and
          rewards — with a link to the Canton explorer for each on-chain
          action. Tap any transaction for its detail.
        </p>
      </DocsSection>

      <DocsPager currentSlug="wallet" />
    </DocsLayout>
  );
}
