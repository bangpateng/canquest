import type { Metadata } from "next";
import { DocsLayout } from "@/components/docs/docs-layout";
import {
  DocsHeader,
  DocsPager,
  DocsSection,
  Lead,
  OL,
  PathLink,
} from "@/components/docs/docs-primitives";
import { Callout } from "@/components/docs/callout";
import { LaunchAppButton } from "@/components/landing/launch-app-button";

export const metadata: Metadata = {
  title: "Getting started — CanQuest Docs",
  description:
    "Sign up, create your Canton wallet, and earn your first points in a few minutes.",
  alternates: { canonical: "/docs/getting-started" },
};

export default function GettingStartedPage() {
  return (
    <DocsLayout>
      <DocsHeader
        title="Getting started"
        subtitle="Sign up, create your Canton wallet, and earn your first points in a few minutes."
      />

      <DocsSection title="Create your account" className="border-b-0">
        <OL>
          <li>
            <Lead>Launch the app</Lead> — click <em>Launch App</em> on the
            homepage. You can sign up with <Lead>Google</Lead> (recommended for
            new accounts) or use email and password.
          </li>
          <li>
            <Lead>Sign up</Lead> — choose <em>Continue with Google</em>. If a
            friend invited you, enter their <Lead>referral code</Lead> during
            sign-up so they get credited once you verify.
          </li>
          <li>
            <Lead>Verify your email</Lead> — new accounts confirm via a 6-digit
            email code (OTP). Existing email-and-password accounts can still
            sign in and reset their password.
          </li>
        </OL>
        <Callout type="tip" title="Referral rewards">
          A referral only credits after the invited friend <em>both</em> verifies
          their email <em>and</em> connects an X (Twitter) account. Self-referrals
          and email-alias farming are blocked automatically. See{" "}
          <PathLink href="/docs/anti-sybil">Verification &amp; anti-sybil</PathLink>.
        </Callout>
      </DocsSection>

      <DocsSection title="Create your wallet">
        <p>
          Almost everything in CanQuest — Earn, sending, swapping, locking, and
          claiming rewards — needs a Canton wallet first.
        </p>
        <OL>
          <li>
            Open <PathLink href="/wallet">Wallet</PathLink> from the app menu.
          </li>
          <li>
            Enter a <Lead>team invite code</Lead>. Wallet creation is
            invite-gated under a daily quota, so one human gets one on-chain
            party ID.
          </li>
          <li>
            <Lead>Create your key — in your browser.</Lead> During setup you
            write down a <Lead>Backup Key</Lead> (64-character hex) and verify
            it by retyping, then choose a <Lead>passphrase</Lead>. The private
            key is encrypted locally and never sent to any server.
          </li>
          <li>
            Your Canton party ID is created and shown in Wallet and Settings.
            Every on-chain action from now on asks for your signature.
          </li>
        </OL>
        <Callout type="warning" title="Save your Backup Key">
          The Backup Key is the only way to restore your wallet or reset your
          passphrase — on this device or a new one. Write it offline and keep
          it private. If you lose both the passphrase and the Backup Key, the
          wallet cannot be recovered by anyone, including CanQuest.
        </Callout>
        <Callout type="note" title="One wallet per person">
          A party ID is your on-chain identity on Canton. It cannot be reset or
          multiplied — protect your account. Don&apos;t share your invite code
          publicly; it is meant for genuine one-time use.
        </Callout>
      </DocsSection>

      <DocsSection title="Earn points & join campaigns">
        <OL>
          <li>
            <Lead>Earn points</Lead> — complete daily tasks in{" "}
            <PathLink href="/quests">Quests</PathLink>: check-in, social
            (follow/retweet on X, join Telegram/Discord), quizzes, and on-chain
            actions (send CC, send USDCx, swap, lock).
          </li>
          <li>
            <Lead>Reach Full access</Lead> — lock CC from your Wallet to unlock
            partner campaigns in Earn. Your CC never leaves your wallet and
            returns in full at the end of the term.
          </li>
          <li>
            <Lead>Join partner campaigns</Lead> — in{" "}
            <PathLink href="/earn">Earn</PathLink>, complete a campaign&apos;s
            social tasks, then claim your reward. Some campaigns accept points
            instead of a lock — or are free — set per campaign.
          </li>
        </OL>
        <div className="pt-1">
          <LaunchAppButton size="lg" className="rounded-full" />
        </div>
      </DocsSection>

      <DocsPager currentSlug="getting-started" />
    </DocsLayout>
  );
}
