# CanQuest — Canton Network Proposal

## Strategic Proposal for Canton Network Ecosystem Partners

Prepared for Canton Network Ecosystem Review
June 2026

---

## 1. Executive Summary

CanQuest is a production-ready, Canton-native growth platform built to bring **real user activity and recurring revenue into the Canton Network** — by helping **other Canton projects acquire verified, active users**.

The product is designed for the core gap in Canton's growth: institutional infrastructure exists, but ecosystem projects still need a practical way to reach real users without being drained by bots and farms. CanQuest closes that gap by making verification structural rather than heuristic.

For Canton, CanQuest is strategically relevant because it advances three priorities aligned with network growth:

- It increases **real on-chain CC activity** — every user journey involves locking CC, transacting, and claiming rewards.
- It converts **external crypto users into Canton participants** through a familiar quest experience.
- It creates a **usage-based business model tied directly to network activity**, not short-term incentives.

CanQuest is not positioned as another generic quest platform. It is a **growth layer for the Canton ecosystem** — and it is built on a clear premise: **the activity is the product, not the reward.**

---

## 2. Why This Matters Now

Canton is becoming a high-value settlement and institutional blockchain network, but broad ecosystem adoption still needs practical user-facing products. Institutional infrastructure alone does not automatically create retail participation, developer activity, or everyday CC usage.

The ecosystem needs a layer that can:

- onboard real users into Canton through a familiar experience;
- give users a practical reason to hold, move, and use CC;
- help Canton projects distribute rewards to **verified participants, not farms**;
- generate measurable transaction activity and recurring application revenue.

CanQuest addresses exactly this gap. It turns Canton Coin activity into a growth channel — for the network and for every project building on it.

---

## 3. Strategic Fit with Canton

Canton's public strategy centers on growing network utilization, institutional adoption, and a thriving application ecosystem. CanQuest aligns with that mandate at the **application and user-acquisition layer**.

Where Canton supports the network from the protocol, treasury, and validator side, CanQuest supports it from the **user-activity side**:

- Canton provides the rails; CanQuest puts real users on them.
- Canton provides the assets (CC); CanQuest gives users a reason to lock, move, and use them.
- Canton provides the primitives (parties, CIP-0056, `LockedAmulet`); CanQuest turns them into a product people actually use.

The strategic thesis is simple:

> **CanQuest can become the user-facing growth and distribution layer for Canton — while generating usage-based revenue from real, verified activity.**

---

## 4. Product Overview

CanQuest is a Canton-native growth platform. It provides a single surface for ecosystem projects to run campaigns and acquire **verified early users**, while users get **early access** to those partner projects through genuine activity. CC rewards are part of the experience — a bonus on top of access, not the reason to participate.

Core capabilities:

- Commitment-based access gating (lock CC, redeem points, or free — configurable per event)
- Daily quest hub with server-verified tasks (social, quizzes, check-ins, and on-chain activity such as sends, swaps, and locks)
- Partner campaign engine with six reward types (CC FCFS, CC raffle, waitlist FCFS, waitlist raffle, waitlist email, and combined CC + code draws)
- Canton wallet — balance, send and receive CC and tokens by @username or Canton party ID, incoming/outgoing transfer offers, transaction history with explorer links
- **Cantex swap (coming soon)** — swap CC for supported tokens (e.g. USDCX) directly via the Cantex decentralized exchange, on-network and non-custodial
- Leaderboard ranked by net points (weekly, monthly, all-time)
- Referral program — verified invite links that reward the referrer when the invitee verifies email and connects X
- Partner toolchain for campaign creation, reward inventory, winner draws, and on-chain distribution

To join a partner campaign, a user meets the access requirement set **per event** by the partner. Four modes are supported:

- **Lock CC** — commit CC non-custodially from their own Canton wallet (the Full access threshold is 30 CC, configurable per event). Returned in full at unlock.
- **Redeem points** — spend earned points from daily quest activity (the cost is configurable per event).
- **Lock CC *or* redeem points** — the default; either path works.
- **No gate** — a free event any verified user can join.

One Canton party = one verified identity. The commitment path requires real effort or capital, so farming becomes irrational.

---

## 5. Core Value Proposition

### For Canton Network
CanQuest drives **utility-based activity**. Every lock, quest, claim, and transfer moves CC on-chain for a genuine reason. A network cost applies while CC is locked — so **every CanQuest lock generates recurring revenue for the network** throughout the lock term.

### For Canton Projects (Partners)
CanQuest is a ready-made growth channel. A project defines its tasks and rewards; CanQuest delivers **verified, active Canton users** — not passive airdrop claimants. Projects can launch campaigns in days, not months, without building their own anti-bot or reward infrastructure.

### For Users
A familiar campaign experience whose real value is **early access** to ecosystem projects — often before they are widely known. Users complete genuine tasks, earn a verified standing, and unlock partner campaigns. CC rewards are a bonus on top, never the headline. Every action is recorded on-chain with full transparency.

### For Canton as a Strategic Partner
A measurable, usage-tied contribution to ecosystem growth. CanQuest's revenue scales with real transaction volume, and its growth directly translates into more CC movement and more network income.

---

<!--FIG:campaign-->

## 6. Revenue Model

CanQuest has a durable, usage-based revenue model — all denominated in CC, all on-chain, all auditable. Specific amounts are configurable and not published publicly.

Revenue comes from real activity across the platform:

- **Campaign claims** — every reward claim settles CC on-chain, tied to genuine campaign participation.
- **Transfers** — everyday wallet sends and token transfers contribute recurring on-chain movement.
- **Locks** — a network cost applies while CC is locked, generating recurring revenue throughout the lock term.
- **Swaps (coming soon)** — on-network CC ↔ token swaps routed through the Cantex exchange.

CanQuest also participates in Canton's validator-side **App Reward** mechanism, earning CC proportional to genuine on-chain activity, and partners pay to host campaigns on the platform.

**Why the model is durable:** Revenue scales with **real transaction volume**, not incentives. Every campaign launched, every claim processed, and every wallet action generates measurable CC movement on the Canton ledger.

---

<!--FIG:workflow-->

## 7. Technical Differentiation

CanQuest's technical value is not the quest UI. The real differentiation is the **Canton-native infrastructure behind it** — using primitives that EVM chains cannot replicate.

### Non-Custodial CC Locking
Participation is gated by Canton's native `LockedAmulet` primitive. The user's CC never leaves their wallet, yet the network earns a holding cost while it is locked. This turns commitment into both a Sybil-resistant signal and a network revenue source.

### Cantex DEX Integration (coming soon)
Swaps will settle against the Cantex decentralized exchange using Canton transfer primitives, with quote preview, holding-cost-aware execution, automatic refund on timeout, and PendingDelivery tracking for any failed token delivery. Every swap moves CC on-network for a genuine reason.

### CIP-0056 Transfers
Reward payouts and wallet sends settle through Canton's standard transfer flow, with preapproval-based execution that respects receiver readiness.

### Party-Based Identity
Each user is a real Canton party. This is what makes Sybil resistance structural: a bot cannot farm a campaign by cheaply replicating wallets, because it cannot cheaply replicate locked CC across verified parties.

### Referral Loop
Verified invite links reward the referrer only when the invitee verifies their email **and** connects an X account — blocking self-referrals and email-alias farming. Referral points feed back into campaign entry and leaderboard rank.

### Retention Loop
The commitment paths are deliberately designed to keep users active. The **points path** draws from a balance earned through daily quests, pulling users back into ongoing activity — while CC keeps moving on-chain through repeated, genuine actions.

---

## 8. Why CanQuest Can Drive Adoption

CanQuest focuses on **utility-first adoption**.

Many onboarding strategies rely on campaigns, rewards, or temporary incentives. CanQuest is built around recurring, genuine actions:

- users lock CC because they want verified access;
- users complete quests because it earns them access and rank;
- users transact because the platform requires real on-chain activity;
- users return daily because points and leaderboards reward consistency.

This makes CanQuest activity **more durable than incentive-only growth** — and fundamentally different from farming.

CanQuest's initial geographic advantage is **Indonesia and Southeast Asia**, where crypto participation is high but Canton-specific access remains early. A Canton-native growth platform can become a practical entry point for these users.

---

## 9. Strategic Impact for Canton Network

CanQuest contributes to the Canton ecosystem in four direct ways.

### User Onboarding
A familiar entry point into Canton for crypto-native users — without forcing them to understand Canton internals first.

### CC Movement
Every campaign, lock, claim, transfer, and daily quest moves CC on-chain for a real reason — directly growing network utilization.

### Network Revenue
Because locked CC accrues a network cost, CanQuest user growth translates into recurring income for Canton itself.

### Application-Layer Distribution
CanQuest becomes a reusable growth and distribution layer that any Canton project can plug into to reach verified users.

---

## 10. Competitive Positioning

CanQuest is positioned at the intersection of three categories:

- a **quest and rewards platform**;
- a **Sybil-resistant user-acquisition channel**;
- a **Canton-native growth layer**.

Most quest platforms are generic, chain-agnostic, and farm-prone. Most user-acquisition tools rely on heuristic anti-bot checks. Most institutional Canton infrastructure is not designed for everyday user onboarding.

CanQuest combines these into one product:

- Canton-native `LockedAmulet` and CIP-0056 integration;
- structural Sybil resistance through party-based identity + commitment;
- a retention-driven activity loop tied to real on-chain volume;
- production-ready mainnet infrastructure.

This creates a clear strategic role: **CanQuest is not a quest platform with Canton support — it is a Canton growth engine that uses quests as the interface.**

---

## 11. Current Status

CanQuest is **mainnet-deployed and internally validated**.

Current readiness includes:

- mainnet deployment (not a testnet);
- full product flow exercised by the core team with real CC and real party identities;
- wallet creation, CC locking, daily quests, and on-chain reward claims;
- partner campaign creation and reward distribution (six reward types);
- Cantex DEX swap (CC ↔ USDCX) — coming soon, with more pairs rolling out progressively;
- transaction history verifiable through the Modo API explorer;
- referral program, leaderboard, and transfer offers live;
- multiple internal security reviews completed.

**Pre-public-launch.** CanQuest currently runs as a controlled mainnet pilot. The Canton ecosystem support requested here is specifically to fund and de-risk the **first public user cohort** and the initial partner campaigns.

### Product demonstrations

The following short videos show the platform in action. Each is 1–2 minutes, focused on one flow.

- **CC Lock & Full Access** — locking CC (or redeeming points) and reaching Full access.
  `LINK: <paste your video link here>`
- **Reward Claim** — claiming an on-chain CC reward or invite code.
  `LINK: <paste your video link here>`
- **Transaction History** — on-chain integrity with CantonScan explorer links.
  `LINK: <paste your video link here>`
- **Quest & Earn Hub** — daily task completion and campaign participation.
  `LINK: <paste your video link here>`
- **Wallet & Dashboard** — balance, send/receive/lock, and activity overview.
  `LINK: <paste your video link here>`

---

## 12. Go-To-Market Strategy

### Phase 1: Canton User Activation (Months 0–3)
Activate the first cohort of CC holders, run the first partner campaigns, and validate unit economics on mainnet.
- Wallet onboarding; CC lock and quest activity; first partner campaigns.

### Phase 2: Southeast Asia Expansion (Months 3–9)
Scale community acquisition in Indonesia and Southeast Asia, and expand the partner campaign pipeline.
- Localized onboarding; partner integrations; community growth.

### Phase 3: Ecosystem Distribution Layer (Months 9–18)
Position CanQuest as the default verified-growth infrastructure for Canton, with self-serve partner tooling and deeper integrations.
- Self-serve campaigns; API/embedded integrations; ecosystem partnerships.

---

## 13. Key Metrics to Track

CanQuest should be evaluated by usage, revenue, and Canton ecosystem impact.

- Commitments created (CC locks + points redeemed)
- Total CC locked (non-custodial)
- Active Canton parties
- On-chain CC transfer volume
- Claim revenue (CC)
- Partner campaigns hosted
- Monthly active verified users
- Repeat transaction rate

These metrics directly reflect **Canton Network utilization** — the outcomes the ecosystem wants to grow.

---

## 14. Risk and Mitigation

### Technical Complexity
Canton transactions involve party authorization, preapproval, and ledger-level settlement.
**Mitigation:** Canton-aware backend logic, on-ledger reward settlement, preapproval checks, and production configuration. Multiple internal security reviews completed; an external audit is planned as Milestone 1.

### User Onboarding Friction
Canton-specific concepts can be difficult for new users.
**Mitigation:** CanQuest hides complexity behind familiar quest and wallet flows, with guided onboarding and status indicators. Users never interact with raw Canton internals.

### Reward-System Abuse
Reward products are inherently exposed to farming and exploitation attempts.
**Mitigation:** Access is gated behind verified activity (CC lock, points redeem, or a per-event setting), identity is one Canton party per verified human, and reward settlement is enforced on-ledger. This makes farming economically irrational — the structural core of CanQuest's design.

### Regulatory and Operational Requirements
Reward and fee products require careful operational controls.
**Mitigation:** Invite-gated onboarding, user moderation with session revocation, full on-ledger audit trails, CantonScan transparency, and admin-managed compliance controls.

---

## 15. Investment Thesis

CanQuest is a practical way to increase Canton usage from the application layer — while directly serving the growth of every other Canton project.

The product is already mainnet-deployed, has a clear usage-based model, and targets users who need real transaction utility. It helps Canton expand the ecosystem beyond institutional infrastructure by supporting a user-facing product that drives **activity, volume, and recurring network revenue**.

The strongest case for supporting CanQuest is not that it is a quest platform. The strongest case is that CanQuest is a **monetized Canton growth engine**.

- It turns external users into **active Canton users**.
- It turns quests and rewards into **verified on-chain activity**.
- It turns CC locks into **recurring revenue for the network**.
- It turns every partner campaign into **ecosystem growth**.

---

## 16. Proposed Strategic Partnership

CanQuest is open to closer involvement with Canton — to strengthen production operations and scale verified activity across the ecosystem.

Potential areas of collaboration:

- Canton Ecosystem Directory listing and visibility;
- technical and network advisory support;
- partner introductions for pilot campaigns;
- co-marketing for Canton user acquisition.

The objective is to make CanQuest one of the practical user-growth gateways into Canton Network activity.

---

## 17. References

- Canton Network — official site: https://www.canton.network/
- Canton Network — Build on Canton: https://canton.network/build
- Canton Foundation — Grants Program: https://canton.foundation/grants-program/
- Canton Ecosystem Directory: https://www.cantonecosystem.com/
- Canton Network — Developer Resources: https://www.canton.network/developer-resources

---

*Prepared June 2026. Revised July 2026.*
