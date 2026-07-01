# CanQuest — Product Positioning

> Canonical positioning statement. This doc is the single source of truth for
> how CanQuest should be described — on the landing page, in partner pitches,
> and in the Canton Featured App application. It aligns copy with the vision
> already stated in [`CANQUEST_PROPOSAL.md`](./CANQUEST_PROPOSAL.md).

## One-line positioning

**CanQuest is a growth layer for Canton ecosystem projects — connecting them
with verified early users. Not a farming platform.**

## Two-sided value

CanQuest exists for **both** sides of the ecosystem. Neither side is the
"customer" alone.

### For partner projects (the Canton ecosystem)

CanQuest is a ready-made growth channel. A partner defines its campaign tasks
and rewards; CanQuest delivers **verified, active early users** — not passive
airdrop claimants, not bot farms. Structural anti-sybil (one human → one
Canton wallet → one account) means every participant is a real person who
actually engaged with the project. That is the product partners pay for in
attention and rewards.

### For users

A familiar campaign experience whose **real value is early access** to
ecosystem projects — often before those projects are widely known. Users
complete genuine tasks (follow, join, transact), earn a verified standing,
and unlock partner campaigns. CC rewards are part of the experience, but they
are **a bonus, not the reason to participate** (see below).

## What CanQuest is NOT

- **Not a farming platform.** The activity is the product, not the reward.
  CanQuest is deliberately structured so that multi-account farming and
  bot-driven claiming are costly, slow, and detected — because partner growth
  only counts when it is real.
- **Not an airdrop-claim machine.** There is no "click once, receive token"
  loop. Every reward sits behind verified activity.
- **Not a "earn CC" platform.** CC is the native unit of the Canton Network
  and the medium of the lock mechanic, but CanQuest's purpose is ecosystem
  growth — not token speculation or yield.

## CC reward is a bonus, not the point

This is the most important framing distinction. When the platform is
described as "earn CC", it attracts the wrong audience (farmers, churners)
and misrepresents the value to partners (who want real users, not reward
seekers). The honest hierarchy of value is:

1. **Early access** to partner projects — the primary user benefit.
2. **Verified standing** — proof of genuine participation that carries across
   the ecosystem.
3. **CC rewards** — a bonus on top, never the headline.

> Landing-page guidance: do **not** lead with "earn CC" or "CC rewards" in
> the hero. The hero leads with the two-sided value (partner growth + early
> access). The "CC is a bonus" framing belongs in product docs and partner
> materials, not the marketing headline.

## The mechanism stays flexible

How a user earns access to a partner campaign is **configurable per event**
by the partner/admin — it is not a single global rule:

- **Lock CC** on-chain (non-custodial; the classic Canton commitment).
- **Redeem points** earned from daily verified activity.
- **Lock CC *or* redeem points** (default — either path works).
- **No gate** (free event, anyone verified can join).

This flexibility (`EntryGateMode`: `CC_OR_POINTS` | `CC_ONLY` |
`POINTS_ONLY` | `NONE`) lets each partner calibrate the signal strength they
need — a flagship launch may require a CC lock; a lighter campaign may be
points-only or free. See [`EARN_PRODUCT_SPEC.md`](./EARN_PRODUCT_SPEC.md)
for the technical spec and the per-event admin configuration.

The mechanism is **how** access is earned. It is not the value proposition.

## Alignment with related docs

| Document | Role |
|---|---|
| [`CANQUEST_PROPOSAL.md`](./CANQUEST_PROPOSAL.md) | Deep vision: "growth layer for Canton", "activity is the product, not the reward". This positioning doc distills it into copy-ready statements. |
| [`EARN_PRODUCT_SPEC.md`](./EARN_PRODUCT_SPEC.md) | Technical spec of the Earn mechanism (task types, gates, redemption). |
| [`CANTON_FEATURED_APP_FORM_ANSWERS.md`](./CANTON_FEATURED_APP_FORM_ANSWERS.md) | Canton Foundation application — must reflect this positioning. |
