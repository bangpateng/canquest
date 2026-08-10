import type { Metadata } from "next";
import { DocsLayout } from "@/components/docs/docs-layout";
import {
  DocsHeader,
  DocsPager,
  DocsSection,
  Lead,
  UL,
} from "@/components/docs/docs-primitives";
import { Callout } from "@/components/docs/callout";

export const metadata: Metadata = {
  title: "Verification & anti-sybil — CanQuest Docs",
  description:
    "How CanQuest keeps bots and multi-account farming out: invite-gated wallets, email OTP, server-verified tasks, and a commitment gate.",
  alternates: { canonical: "/docs/anti-sybil" },
};

export default function AntiSybilPage() {
  return (
    <DocsLayout>
      <DocsHeader
        title="Verification & anti-sybil"
        subtitle="How CanQuest keeps bots and multi-account farming out."
      />

      <DocsSection title="The controls">
        <UL>
          <li>
            <Lead>Invite-gated wallets</Lead> — creating a wallet needs a team
            invite code under a daily quota. One person, one Canton party ID.
          </li>
          <li>
            <Lead>Email OTP</Lead> — wallet creation confirms your email with a
            6-digit code.
          </li>
          <li>
            <Lead>Captcha</Lead> — Cloudflare Turnstile guards sensitive flows
            like password reset and Twitter connect.
          </li>
          <li>
            <Lead>Server-side decisions</Lead> — points, quest outcomes, and
            reward draws are decided on the server, never in the browser.
          </li>
          <li>
            <Lead>Server-verified social</Lead> — X follow/retweet tasks are
            checked via the Twitter API, not self-reported.
          </li>
          <li>
            <Lead>Referral anti-farm</Lead> — a referral only credits after the
            invitee verifies their email <em>and</em> connects an X account.
          </li>
        </UL>
        <Callout type="note" title="Not KYC">
          These controls raise the cost and friction of farming — they
          don&apos;t prove a single real-world human behind every account.
          CanQuest is not a KYC product.
        </Callout>
      </DocsSection>

      <DocsSection title="The commitment gate" className="border-b-0">
        <p>
          The strongest defense is economic. Joining high-value campaigns
          requires a <Lead>commitment</Lead> — locked CC, earned points, or
          both. Replicating that across many fake accounts is expensive, so
          farming at scale stops being worth it.
        </p>
      </DocsSection>

      <DocsPager currentSlug="anti-sybil" />
    </DocsLayout>
  );
}
