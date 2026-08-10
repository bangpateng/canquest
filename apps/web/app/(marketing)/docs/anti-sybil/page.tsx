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
    "How CanQuest keeps bots and multi-account farming out: invite-gated wallets, email OTP, server-verified tasks, and an economically-irrational commitment gate.",
  alternates: { canonical: "/docs/anti-sybil" },
};

export default function AntiSybilPage() {
  return (
    <DocsLayout>
      <DocsHeader
        title="Verification & anti-sybil"
        subtitle="How CanQuest keeps bots and multi-account farming out — through structural controls, not heuristics."
      />

      <DocsSection title="Why this matters">
        <p>
          Rewards only mean something if participants are real. A quest platform
          that pays out to bot farms has no value for users or partners.
          CanQuest is designed so that replicating a verified identity is
          costly, and farming is economically irrational.
        </p>
        <Callout type="note" title="Structural, not KYC">
          CanQuest is <em>not</em> an identity-verification (KYC) product. The
          controls below raise the cost and friction of sybil attacks; they do
          not prove a single real-world human behind every account. We avoid
          overclaiming &ldquo;KYC-grade identity.&rdquo;
        </Callout>
      </DocsSection>

      <DocsSection title="The layers">
        <UL>
          <li>
            <Lead>Invite-gated wallets</Lead> — creating a Canton wallet
            requires a team invite code under a daily quota. One human gets one
            on-chain party ID.
          </li>
          <li>
            <Lead>Email OTP</Lead> — wallet creation confirms your email with a
            6-digit code.
          </li>
          <li>
            <Lead>Account sign-up</Lead> — new accounts register through Google,
            with a captcha (Cloudflare Turnstile) on sensitive flows like
            password reset and Twitter connect.
          </li>
          <li>
            <Lead>Server-verified tasks</Lead> — points, quest outcomes, and
            reward draws are decided on the server with audit trails. The
            browser never controls the outcome.
          </li>
          <li>
            <Lead>Server-verified social</Lead> — X (Twitter) follow/retweet
            tasks are verified server-side via the Twitter API, not on the
            honor system.
          </li>
          <li>
            <Lead>Referral anti-farm</Lead> — a referral only credits after the
            invitee verifies their email <em>and</em> connects an X account.
            Self-referrals and email-alias farming are blocked.
          </li>
        </UL>
      </DocsSection>

      <DocsSection title="The commitment gate" className="border-b-0">
        <p>
          The strongest defense is economic. Joining high-value partner
          campaigns requires a <Lead>commitment</Lead>: locked CC, earned
          points, or both. Because locked CC is costly to replicate across many
          fake parties, and points require genuine server-verified activity,
          farming at scale stops being profitable.
        </p>
        <p>
          Each campaign sets its own gate — see the entry-gate modes on the{" "}
          <a
            href="/docs/quests"
            className="text-canton underline-offset-2 hover:underline"
          >
            Quests
          </a>{" "}
          page.
        </p>
      </DocsSection>

      <DocsPager currentSlug="anti-sybil" />
    </DocsLayout>
  );
}
