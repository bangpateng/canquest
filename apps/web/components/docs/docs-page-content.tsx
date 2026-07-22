import type { ReactNode } from "react";
import Link from "next/link";
import { DocsMobileNav, DocsSidebar } from "@/components/docs/docs-sidebar";
import { LaunchAppButton } from "@/components/landing/launch-app-button";
import { LandingShell } from "@/components/landing/landing-shell";
import { cn } from "@/lib/utils/utils";

/** A top-level docs section with an <h2> heading. */
function DocsSection({
  id,
  title,
  children,
  className,
}: {
  id: string;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={cn(
        "scroll-mt-24 border-b border-[var(--border)] py-10 last:border-b-0 md:py-12",
        className,
      )}
    >
      <h2 className="text-lg font-bold tracking-tight text-[var(--foreground)] sm:text-xl">
        {title}
      </h2>
      <div className="mt-4 space-y-4 text-sm leading-relaxed text-[var(--muted-foreground)]">
        {children}
      </div>
    </section>
  );
}

/** Small helper for inline menu/path references. */
function PathLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-canton underline-offset-2 hover:underline">
      {children}
    </Link>
  );
}

function UL({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-1.5 pl-5">{children}</ul>;
}

export function DocsPageContent() {
  return (
    <div className="border-b border-[var(--border)]">
      <LandingShell className="py-10 pb-16 md:py-12">
        <div className="flex items-start gap-8 xl:gap-12">
          <DocsSidebar />

          <div className="min-w-0 flex-1">
            <header className="mb-8 max-w-2xl">
              <p className="type-eyebrow-brand">Documentation</p>
              <h1 className="type-display mt-3 text-2xl font-bold tracking-tight sm:text-3xl">
                CanQuest user guide
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-[var(--muted-foreground)] sm:text-base">
                Everything the dapp can do today — every menu, every action. Verified against the
                live code, not a roadmap.
              </p>
            </header>

            <DocsMobileNav />

            <DocsSection id="introduction" title="What is CanQuest">
              <p>
                <strong className="font-medium text-[var(--foreground)]">CanQuest</strong> is a
                Canton-native quest and wallet platform. One verified human gets one Canton wallet,
                earns points from real activity, and joins partner campaigns for CC and early-access
                rewards.
              </p>
              <p>The dapp has six menus:</p>
              <UL>
                <li><strong className="font-medium text-[var(--foreground)]">Overview</strong> — your dashboard.</li>
                <li><strong className="font-medium text-[var(--foreground)]">Earn</strong> — partner campaigns (CC, invite codes, waitlist slots).</li>
                <li><strong className="font-medium text-[var(--foreground)]">Quests</strong> — daily and on-chain tasks that earn points.</li>
                <li><strong className="font-medium text-[var(--foreground)]">Wallet</strong> — your Canton party ID: balances, send, receive, swap, lock.</li>
                <li><strong className="font-medium text-[var(--foreground)]">Leaderboard</strong> — rank by points.</li>
                <li><strong className="font-medium text-[var(--foreground)]">Settings</strong> — profile, wallet password, one-step transfer, X connection.</li>
              </UL>
            </DocsSection>

            <DocsSection id="getting-started" title="Getting started">
              <ol className="list-decimal space-y-3 pl-5">
                <li>
                  <strong className="font-medium text-[var(--foreground)]">Sign up with Google</strong> —
                  click <em>Launch App</em>, then <em>Continue with Google</em>. You can enter a
                  friend&apos;s referral code during sign-up. (Existing email-and-password accounts
                  can still sign in and reset their password.)
                </li>
                <li>
                  <strong className="font-medium text-[var(--foreground)]">Create your wallet</strong> —
                  open <PathLink href="/wallet">Wallet</PathLink> and enter a team invite code, then
                  confirm with the email OTP. One wallet per account. Earn, sending, swapping, and
                  locking all need a wallet first.
                </li>
                <li>
                  <strong className="font-medium text-[var(--foreground)]">Earn points</strong> —
                  complete daily tasks in <PathLink href="/quests">Quests</PathLink> (check-in,
                  social, quizzes, and on-chain actions).
                </li>
                <li>
                  <strong className="font-medium text-[var(--foreground)]">Join partner campaigns</strong> —
                  in <PathLink href="/earn">Earn</PathLink>, complete a campaign&apos;s social tasks,
                  then claim your reward. Some campaigns require a CC lock or points to join.
                </li>
              </ol>
              <div className="pt-2">
                <LaunchAppButton size="lg" className="rounded-full" />
              </div>
            </DocsSection>

            <DocsSection id="verification" title="Verification & anti-sybil">
              <p>
                Rewards only mean something if participants are real. Several layers keep bots and
                multi-account farming out:
              </p>
              <UL>
                <li><strong className="font-medium text-[var(--foreground)]">Google sign-up</strong> — new accounts register through Google.</li>
                <li><strong className="font-medium text-[var(--foreground)]">One wallet per person</strong> — wallet creation needs a team invite code under a daily quota, so one human gets one on-chain party ID.</li>
                <li><strong className="font-medium text-[var(--foreground)]">Email OTP</strong> — wallet creation confirms your email with a 6-digit code.</li>
                <li><strong className="font-medium text-[var(--foreground)]">Captcha</strong> — Cloudflare Turnstile guards reset-password and Twitter-connect flows.</li>
                <li><strong className="font-medium text-[var(--foreground)]">Server-verified tasks</strong> — points and reward draws are decided on the server with audit trails; the browser never controls the outcome.</li>
                <li><strong className="font-medium text-[var(--foreground)]">Referral anti-farm</strong> — referral rewards require a verified email <em>and</em> a connected X account, and block self-referrals and email-alias farming.</li>
              </UL>
            </DocsSection>

            <DocsSection id="cc-lock" title="CC Lock & Earn access">
              <p>
                Locking CC is how you prove intent and reach{" "}
                <strong className="font-medium text-[var(--foreground)]">Full access</strong> — the
                tier that unlocks partner campaigns in Earn.
              </p>
              <UL>
                <li>Lock <strong className="font-medium text-[var(--foreground)]">30 CC</strong> from your own wallet. Your CC never leaves your wallet.</li>
                <li>Your account is promoted to <strong className="font-medium text-[var(--foreground)]">Full access</strong> on-chain instantly — no manual approval.</li>
                <li>Pick a lock term (e.g. 7, 15, or 30 days — options come from the server).</li>
                <li>When the term ends, unlock and your <strong className="font-medium text-[var(--foreground)]">CC returns in full</strong>. A small network holding fee applies while locked.</li>
              </UL>
              <p>
                You manage locks from the <PathLink href="/wallet">Wallet</PathLink> menu. Some
                partner campaigns accept <em>points</em> instead of a lock — or are free — set per
                campaign.
              </p>
            </DocsSection>

            <DocsSection id="wallet" title="Wallet">
              <p>
                Your Canton party ID, in one place. Six actions are available:{" "}
                <strong className="font-medium text-[var(--foreground)]">Send, Receive, Offers, Swap, Lock, Activity</strong>.
              </p>

              <p><strong className="font-medium text-[var(--foreground)]">Balances</strong></p>
              <UL>
                <li>Total balance shown in USD, summing CC and token values at live prices.</li>
                <li>CC (Amulet) is always shown; <strong className="font-medium text-[var(--foreground)]">USDCx</strong> is active; <strong className="font-medium text-[var(--foreground)]">CBTC</strong> is listed as <em>Coming soon</em>.</li>
              </UL>

              <p><strong className="font-medium text-[var(--foreground)]">Send</strong></p>
              <UL>
                <li>Pick a token, enter an amount (a <em>MAX</em> button fills it), and an optional memo.</li>
                <li>Recipient can be an <strong className="font-medium text-[var(--foreground)]">@username</strong> or a raw Canton party ID (<code className="rounded bg-[var(--muted)] px-1">alice::1220…</code>).</li>
                <li>CC sends settle instantly (preapproval path); token sends create an offer the recipient must accept. A platform fee is shown before you confirm.</li>
              </UL>

              <p><strong className="font-medium text-[var(--foreground)]">Receive</strong></p>
              <UL>
                <li>A QR code and copyable Canton party ID. Share either to receive CC or tokens.</li>
              </UL>

              <p><strong className="font-medium text-[var(--foreground)]">Swap</strong></p>
              <UL>
                <li>Swap <strong className="font-medium text-[var(--foreground)]">CC ↔ USDCX</strong> through the Cantex exchange, with a live quote showing the rate, price impact, and fees before you confirm. More pairs are coming.</li>
              </UL>

              <p><strong className="font-medium text-[var(--foreground)]">Lock</strong></p>
              <UL>
                <li>Lock 30 CC to reach Full access (see <Link href="#cc-lock" className="text-canton underline-offset-2 hover:underline">CC Lock</Link>). Active locks show a countdown; unlock once the term expires. Your CC returns in full.</li>
              </UL>

              <p><strong className="font-medium text-[var(--foreground)]">Offers</strong></p>
              <UL>
                <li><strong className="font-medium text-[var(--foreground)]">Incoming</strong> — pending transfers to you. Accept or reject each one.</li>
                <li><strong className="font-medium text-[var(--foreground)]">Sent</strong> — outgoing transfers you can cancel (withdraw) to return funds to your wallet.</li>
              </UL>

              <p><strong className="font-medium text-[var(--foreground)]">Activity</strong></p>
              <UL>
                <li>Full transaction history (sends, receives, locks, unlocks, swaps, offers, rewards), paginated, with links to the Canton explorer for each on-chain action.</li>
              </UL>
            </DocsSection>

            <DocsSection id="earn" title="Earn (partner campaigns)">
              <p>
                Partner campaigns under <PathLink href="/earn">Earn</PathLink>. Requires a wallet.
                Browse campaigns by status (Active, Coming soon, Ended), open one to read its rules,
                then complete the social tasks and claim your reward.
              </p>
              <p><strong className="font-medium text-[var(--foreground)]">Tasks</strong> — social only: follow on X, retweet, join Telegram or Discord. Tasks unlock one at a time.</p>
              <p><strong className="font-medium text-[var(--foreground)]">Six reward types</strong> (the reward type and its claim fee are set per campaign):</p>
              <UL>
                <li><strong className="font-medium text-[var(--foreground)]">CC FCFS</strong> — first-come-first-served CC. Pay a 3 CC claim fee, receive CC from the pool.</li>
                <li><strong className="font-medium text-[var(--foreground)]">CC Raffle</strong> — admin-drawn winners claim CC. 3 CC fee.</li>
                <li><strong className="font-medium text-[var(--foreground)]">Waitlist FCFS</strong> — first-come invite/access codes. 2 CC fee to reveal.</li>
                <li><strong className="font-medium text-[var(--foreground)]">Waitlist Raffle</strong> — drawn invite/access codes. 2 CC fee to reveal.</li>
                <li><strong className="font-medium text-[var(--foreground)]">Waitlist Email</strong> — submit your email for a raffle spot. Free to enter.</li>
                <li><strong className="font-medium text-[var(--foreground)]">CC + Code Raffle</strong> — drawn winners get CC and a code together. 5 CC fee.</li>
              </UL>
              <p><strong className="font-medium text-[var(--foreground)]">Joining a campaign</strong> — each campaign sets its own gate: free, a CC lock, points, or either a CC lock or points.</p>
            </DocsSection>

            <DocsSection id="quests" title="Quests & points">
              <p>
                The <PathLink href="/quests">Quests</PathLink> hub is where you earn points from
                recurring activity. Tasks unlock one at a time; several reset every 24 hours so you
                can earn again.
              </p>
              <p><strong className="font-medium text-[var(--foreground)]">Task types</strong></p>
              <UL>
                <li><strong className="font-medium text-[var(--foreground)]">Daily check-in</strong> — tap once a day for points (resets every 24h).</li>
                <li><strong className="font-medium text-[var(--foreground)]">Social</strong> — follow/retweet on X, join Telegram or Discord (one-time).</li>
                <li><strong className="font-medium text-[var(--foreground)]">Quizzes</strong> — Yes/No or A/B/C/D (correct answer earns points).</li>
                <li><strong className="font-medium text-[var(--foreground)]">On-chain tasks</strong> — send CC, send USDCx, or swap CC↔USDCx a set number of times in 24h (repeatable); or lock CC at a given tier (one-time per tier).</li>
              </UL>
              <p>
                Points are spendable: some partner campaigns cost points to join. Your remaining
                balance also drives your leaderboard rank.
              </p>
              <p><strong className="font-medium text-[var(--foreground)]">Invite friends</strong></p>
              <UL>
                <li>The referral card on the Quests hub shows your invite link and code.</li>
                <li>You earn <strong className="font-medium text-[var(--foreground)]">points per verified signup</strong> — the friend must verify their email and connect X.</li>
                <li>Self-referrals and email-alias farming are blocked automatically.</li>
              </UL>
            </DocsSection>

            <DocsSection id="leaderboard" title="Leaderboard">
              <p>
                <PathLink href="/leaderboard">Leaderboard</PathLink> ranks every verified user by
                points — the same points you earn from tasks and spend on campaigns.
              </p>
              <UL>
                <li>Three periods: <strong className="font-medium text-[var(--foreground)]">Weekly, Monthly, All time</strong>.</li>
                <li>Rank is by net points (earned minus spent on campaign entries).</li>
                <li>Top three get crown and medal badges; your own row is highlighted with a <em>You</em> tag.</li>
              </UL>
            </DocsSection>

            <DocsSection id="settings" title="Settings">
              <p>
                <PathLink href="/settings">Settings</PathLink> has four panels plus sign-out.
              </p>
              <p><strong className="font-medium text-[var(--foreground)]">Profile</strong> — read-only: email, display name, X handle, Canton username, and party ID.</p>
              <p><strong className="font-medium text-[var(--foreground)]">Wallet password</strong> — an optional extra password that protects Send, Swap, Lock, and Unlock. Set, change, or remove it here.</p>
              <p><strong className="font-medium text-[var(--foreground)]">One-step transfer</strong> — toggle CC preapproval (CIP-56) so incoming CC arrives instantly instead of as an offer you must accept. Per-token; CC is live, USDCx/CBTC coming soon.</p>
              <p><strong className="font-medium text-[var(--foreground)]">X (Twitter)</strong> — connect your handle for quest and campaign verification. Once linked, it is permanent.</p>
              <p><strong className="font-medium text-[var(--foreground)]">Sign out</strong> at the bottom.</p>
            </DocsSection>

            <DocsSection id="fees" title="Fees & rewards">
              <p>
                Fees are denominated in CC and settled on-chain. They keep the network and platform
                running, and they make farming irrational.
              </p>
              <UL>
                <li><strong className="font-medium text-[var(--foreground)]">Transfer fee</strong> — a small CC fee on each CC or token send, paid to the CanQuest fee account.</li>
                <li><strong className="font-medium text-[var(--foreground)]">Claim fees</strong> — CC campaigns charge a claim fee (3 CC for CC rewards, 2 CC for code reveals, 5 CC for combined CC+code; waitlist-email is free).</li>
                <li><strong className="font-medium text-[var(--foreground)]">Holding fee</strong> — a small network fee while your CC is locked.</li>
                <li><strong className="font-medium text-[var(--foreground)]">Swap fees</strong> — a network fee (to the Cantex trading account) and an optional platform fee on each swap, shown in the quote before you confirm.</li>
              </UL>
              <p>
                All fees and rewards are recorded on-chain and visible in your activity history with
                explorer links.
              </p>
            </DocsSection>

            <DocsSection id="coming-soon" title="Coming soon" className="border-b-0">
              <p>Live features that are still rolling out:</p>
              <UL>
                <li><strong className="font-medium text-[var(--foreground)]">More swap pairs</strong> — CBTC and other tokens beyond CC↔USDCX.</li>
                <li><strong className="font-medium text-[var(--foreground)]">One-step transfer for USDCx and CBTC</strong> — currently CC only.</li>
                <li><strong className="font-medium text-[var(--foreground)]">Daily check-in streaks</strong> — consecutive-day bonuses (today it&apos;s a flat per-day reward).</li>
              </UL>
              <p className="pt-4 text-xs">
                Questions or partnership inquiries? Use the{" "}
                <Link href="/cooperation#partner-form" className="text-canton underline-offset-2 hover:underline">
                  partnership form
                </Link>{" "}
                — submissions go straight to our team.
              </p>
            </DocsSection>
          </div>
        </div>
      </LandingShell>
    </div>
  );
}
