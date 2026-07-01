# Canton Featured App Request — CanQuest Submission Answers

> **Tujuan dokumen:** Jawaban siap-tempel untuk formulir di
> https://canton.foundation/featured-app-request/
> Setiap field ditulis dalam Bahasa Inggris (sesuai bahasa form) dan sudah
> dioptimalkan agar **jelas, kredibel, dan akurat** terhadap kondisi nyata
> CanQuest. Tempelkan teks di dalam blok ` ``` ` langsung ke form.
>
> ⚠️ **Penting sebelum submit:**
> - Ganti nilai di dalam kurung siku `[...]` (ditandai 🟥) dengan data riil Anda.
> - Pertanyaan audit dijawab **jujur "No"** — form punya field khusus (field 34)
>   untuk rencana audit. Jujur di sini lebih kuat daripada berbohong yang akan
>   menjamin penolakan.

---

## FIELD 1 — Email *(Required)*
```
📍 Ganti dengan email resmi institusi/Anda — idealnya domain @canquest.cc
Contoh: ops@canquest.cc  atau  bangpateng@canquest.cc
```

## FIELD 3 — Name of applying institution *(Required)*
```
CanQuest
```
> Catatan: isi nama **brand produk** = `CanQuest`. Jika Canton meminta nama
> badan hukum, isi `NodeLab` (operator domain `nodelab.my.id`) atau nama PT/CV
> Anda jika sudah ada. Lihat 🟥 di bawah jika perlu.

## FIELD 4 — Summary of Company and Background *(Required)*
```
CanQuest is a Canton-native growth and quest platform built to bring real user
activity and recurring fee revenue into the Canton Network.

The team operates from Indonesia with a focus on onboarding crypto-native users
in Southeast Asia into Canton through a familiar quest-and-reward experience.
Instead of relying on airdrops or short-term incentives, CanQuest converts
external crypto users into genuine Canton participants: every user journey
involves locking Canton Coin (CC), completing verified activities, transacting
on-ledger, and paying claim fees.

CanQuest is mainnet-deployed and internally validated as a controlled pilot,
with the full product flow exercised by the core team using real CC and real
Canton party identities. We are now preparing for our first public user cohort
and seek Featured App status to align with the network's App Reward and
ecosystem-growth mechanisms.
```

## FIELD 5 — Name of the application *(Required)*
```
CanQuest
```

## FIELD 6 — URL of the applying institution *(Required)*
```
https://canquest.cc
```

## FIELD 7 — Product Website
```
https://app.canquest.cc
```

## FIELD 8 — Emails for Responsible Persons
```
📍 Ganti — contoh:
Primary: 🟥[nama Anda] <🟥email@canquest.cc>
Technical/Operations: 🟥[nama engineer] <🦁email@canquest.cc>
```

## FIELD 9 — Party ID for the Featured Application *(Required)*
> ⚠️ Ini **Party ID FA Anda sendiri** (bukan validator sponsor). FA wajib
> mengunci CC dari Party ID miliknya. Pilih party yang akan Anda gunakan untuk
> locking requirement, lalu minta sponsor SV memverifikasi.
```
🟥[Party ID FA CanQuest — tempelkan party yang akan dipakai untuk lock CC]
```
> **Referensi party CanQuest yang sudah ada di kode Anda (dari GROUNDING_CREATE_PREAPPROVAL.md):**
> - Validator/rewards: `canquest-validator-1::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb`
> - Fee/treasury:       `canquest-fee::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb`
> - Operator (sign DAML): `canquest-operator::1220...` (lihat AUTH_MODEL_DECISION.md)
>
> Konsultasikan dengan SV Sponsor mana yang dipakai sebagai **FA Locking PartyID**.
> Field 44 juga menanyakan ini — jaga konsistensi.

## FIELD 37 — Who is your Standalone SV Sponsor? *(Required, dropdown)*
```
🟥[Pilih salah satu — Anda WAJIB sudah punya kesepakatan dengan salah satu SV berikut:]
  - 5North
  - 7Ridge
  - Cumberland
  - Digital Asset
  - Foundation
  - Liberty City Ventures
  - MPCH
  - Orb-1
  - Proof Group
  - SBI Digital Asset
  - Tradeweb
```
> 🔴 **KRITIS:** Form ini mengasumsikan Anda sudah punya SV Sponsor yang
> menyetujui. Jika belum ada, hubungi dulu salah satu operator SV di atas
> sebelum submit. Tanpa sponsor, aplikasi kemungkinan besar tidak diproses.

## FIELD 11 — URL for the public code repository (if available)
```
https://github.com/bangpateng/canquest
```

## FIELD 10 — Link to Brand Materials (optional)
```
https://canquest.cc/brand-kit
```
> (CanQuest punya halaman `brand-kit` di apps/web — verifikasi URL live sebelum tempel.)

## FIELD 12 — Demo Video 16:9 ratio (optional)
```
🟥[URL YouTube/Vimeo demo 16:9 — jika belum ada, kosongkan.]
```

---

## FIELD 15 — Provide a summary of what your application will do *(Required)*
```
CanQuest is a quest-and-reward / user-growth platform built natively on the
Canton Network. It gives Canton ecosystem projects a ready-made, Sybil-resistant
channel to acquire verified, active users, while giving end users a familiar way
to enter Canton and a practical reason to hold, lock, move, and use Canton Coin.

Core product surfaces:
- Commitment-based access gating — users unlock "Full access" by either locking
  CC non-custodially (entry at 30 CC, returned in full at unlock) or by burning
  5,000 earned points.
- Daily quest hub — server-verified tasks (X/Twitter follow & retweet, Telegram,
  Discord, quizzes, daily check-ins with streaks, and on-chain transaction
  detection).
- Partner campaign engine — projects define tasks and rewards; CanQuest delivers
  verified users. Reward types include on-chain CC payouts (FCFS and
  admin-drawn raffle), invite/access codes, and waitlist slots.
- Canton wallet — balance, send/receive, non-custodial lock/unlock of CC, and
  invite-gated wallet creation.
- Dashboard — transaction history with explorer integrity, leaderboard,
  referrals, and a full admin toolchain for campaign creation, reward inventory,
  winner draws, and on-chain distribution.

Every quest, claim, lock, and transfer settles on-ledger. The thesis is simple:
on CanQuest, the genuine activity is the product, not the reward.
```

## FIELD 16 — Describe the expected users of your application *(Required)*
```
CanQuest serves three distinct user groups:

1) End users — crypto-native retail participants, with an initial geographic
   focus on Indonesia and Southeast Asia, where crypto participation is high but
   Canton-specific access is still early. They use CanQuest to onboard into
   Canton through a familiar quest experience, hold and use CC, and earn verified
   access to partner rewards.

2) Canton ecosystem projects / partners — other Canton applications that need a
   growth channel. They use CanQuest as a campaign host to reach verified, active
   Canton users instead of passive airdrop claimants or bot farms. They can launch
   campaigns in days without building their own anti-bot or reward infrastructure.

3) The Canton Network itself — CanQuest is designed as a user-acquisition layer
   for the network: every user journey generates real CC movement (locks,
   transactions, claim fees) and recurring fee revenue.

Our "one Canton party = one verified identity" rule, combined with the
commitment requirement (locked CC or burned points), is what makes these users
bona fide rather than farmed.
```

## FIELD 17 — How will your application interact with the Canton Network and leverage Canton Coin and Activity Markets for application rewards? *(Required)*
```
CanQuest interacts with Canton Network across all three layers:

(A) Canton Coin (CC) utility:
- Non-custodial CC locking via Canton's native LockedAmulet primitive. Users
  commit CC (entry tier 30 CC) from their own wallet; CC never leaves their
  control, yet the network earns a holding fee throughout the lock term (7d /
  15d / 30d terms). Returned in full at unlock.
- Claim fees and reward payouts settle as real CC transfers using Canton's
  standard CIP-0056 transfer flow (createTransferPreapproval,
  preapproval-based execution, scan-proxy verification).
- Platform transfer fees on everyday wallet send/receive.

(B) Application Rewards:
- CanQuest participates in Canton's validator-side App Reward mechanism, earning
  CC proportional to genuine on-chain activity generated by users (locks, claims,
  transfers, on-chain quest tasks).

(C) Activity Markets / Activity Markers:
- The architecture includes a FeaturedAppActivityMarker integration (CIP-47
  style) to expose CanQuest's activity to the network's reward layer. This
  component is currently implemented behind a feature flag and is being enabled
  as part of the Featured App onboarding, so the network can observe and reward
  CanQuest's real activity. We are ready to coordinate the exact marker schema
  with the Canton team during onboarding.
```

## FIELD 18 — Describe how your application will interact with the ledger *(Required)*
```
CanQuest connects to the Canton ledger through both the JSON Ledger API (v2) and
the Splice Validator REST API, exposed via our public gateways
(api-ledger-canquest.nodelab.my.id and api-canquest.nodelab.my.id) secured with
TLS, and authenticated via Keycloak OIDC (client_credentials grant).

Ledger interactions include:
- Party allocation — every verified user receives a real Canton Party ID via the
  party-allocate endpoint; the Party ID is the on-chain identity anchor and is
  unique per user (DB-level unique constraint to enforce one party = one account).
- DAML contracts — a lean DAML package (module Main, SDK 3.4.11, three templates:
  WalletRegistration, QuestCampaign, QuestClaim) anchors identity and enforces the
  anti-sybil claim engine (FCFS / raffle quota + campaign state machine:
  DRAFT/PAUSED/ACTIVE/ENDED/CLOSED) and the fee-before-reward claim receipt.
  The admin party is signatory; the user party is observer (Canton M3 model).
- ACS queries — read active contracts and user status from the ledger's Active
  Contract Set.
- CIP-0056 transfers — execute transfers with fee via the validator
  (executeTransferWithFee) and reward sends (executeTransferFactoryTransfer).
- LockedAmulet — create/observe/unlock non-custodial CC locks.
- Transaction indexing — read and surface update_ids; we resolve and link the
  explorer event_id format for users (transaction history with explorer integrity).
- Preapprovals — create and observe transfer preapprovals for receiver-ready
  settlement.

All CC movement uses Canton's native Token Standard; the DAML layer records
identity, campaign state, and fee/reward receipts, while the actual Amulet
movement is orchestrated by the backend through the Canton transfer factories.
```

## FIELD 19 — Describe the activities that your application will earn application rewards from *(Required)*
```
CanQuest earns rewards from genuine, on-ledger user activity, not from passive
holding or speculation. The reward-earning activities are:

1) CC locking — each non-custodial lock (LockedAmulet) is a real on-chain action
   that ties up CC and generates a holding fee for the network. Locks are the
   primary commitment signal and a sustained source of activity.

2) On-chain quest tasks — daily quests that require a real Canton transaction
   (detected and verified server-side), producing genuine ledger activity.

3) Reward claims — every partner-campaign claim settles an on-chain CC transfer
   (reward payout) plus a CC claim fee, both executed via CIP-0056.

4) Wallet transactions — everyday send/receive between verified Canton parties,
   each a real transfer.

5) Referral / verification loops — when referrals convert into a new verified
   party (party allocation + first lock or first on-chain action), new genuine
   activity is created on-ledger.

Crucially, every one of these activities is gated behind verified party identity
and a real commitment (locked CC or burned points), so the activity the network
rewards is bona fide and not farmed.
```

## FIELD 20 — Does this activity use Canton Coin or Activity Markers to generate rewards? *(Required)*
```
Both.

- Canton Coin: directly. Locks, claim fees, reward payouts, and transfer fees
  are all real CC movements on the Canton Token Standard. The App Reward
  mechanism earns CC proportional to this activity.

- Activity Markers: CanQuest's architecture includes a FeaturedAppActivityMarker
  integration (CIP-47-style) to publish the application's genuine activity to the
  network's reward layer. This is currently implemented behind a feature flag and
  will be enabled during Featured App onboarding so the network can observe and
  attribute CanQuest's activity. Integration plan: CanQuest emits a marker per
  qualifying on-chain action (lock created, quest on-chain task completed, claim
  settled) from the relevant party, scoped to the CanQuest validator, so the
  network rewards only verified, real activity. We will align the exact marker
  payload, frequency, and scoping with the Canton team during onboarding to
  comply fully with the Activity Markets specification.
```

## FIELD 21 — For the reward earning use case, provide estimates for each of the following *(Required)*
```
(For the primary use case: end-user onboarding + daily quest + partner-campaign
claims on Canton Mainnet. Conservative pre-launch pilot estimates.)

- Estimated number of users (first 3 months): 1,000–2,000 verified Canton parties
  (one party = one verified identity). Targeted at Indonesia / SE Asia.
- Estimated active users (daily): 200–400 (20% DAU/MAU of verified users).
- Estimated transactions per active user per day: 1–3
  (typical day = 1 on-chain quest task + occasional claim/transfer; lock/unlock
  events are bursty at term boundaries).
- Estimated daily transactions network-wide from the app: ~400–1,200 in steady
  state, scaling as the cohort grows.
- Estimated CC volume in play: with a 30 CC entry lock tier and 1,000+ locked
  users, ≥ 30,000 CC locked concurrently, plus per-claim fees (~2–3 CC) and
  reward payouts flowing through the platform.
- Fee/revenue note: every locked CC accrues a network holding fee for the lock
  term, so CanQuest user growth directly translates into recurring network fee
  income, in addition to per-transaction claim/transfer fees.

These are deliberately conservative; we will share real telemetry with the
committee and our SV sponsor during onboarding.
```

## FIELD 22 — On a per user basis, what is your expected daily number of transactions *(Required)*
```
Expected: 1–3 on-ledger transactions per active user per day.

A typical active day for a verified user comprises:
- 1 on-chain quest task (server-verified Canton transaction) — daily.
- Occasional reward claim (on-chain CC transfer + fee) when the user completes a
  partner campaign — not every day.
- Occasional wallet send/transfer — not every day.

Lock and unlock events are episodic (at lock creation and at term expiry), so
they are bursty rather than daily, but each is a genuine on-chain transaction.
We design intentionally for modest per-user frequency to keep every transaction
bona fide and avoid artificially inflated activity.
```

## FIELD 23 — Under what conditions may a user generate multiple transactions per round/epoch? *(Required)*
```
A single user may legitimately generate multiple transactions per round/epoch
only when driven by genuine, distinct intent — never to inflate counts:

1) Multiple distinct campaign claims in the same period — if a user qualifies for
   and claims rewards in several partner campaigns, each claim is a separate,
   genuine reward payout + claim-fee transfer.
2) On-chain quest task plus a claim or transfer in the same day — completing a
   daily on-chain quest and then claiming a reward are two different real actions.
3) Lock/unlock lifecycle events — creating a lock, and later (at term) unlocking
   it, are independent genuine events that may fall in the same epoch for early
   adopters.
4) Wallet transfers — a user sending/receiving CC for a real purpose in addition
   to quest/claim activity.

Controls that prevent abuse: one Canton party per verified identity; a 24-hour
cooldown on daily check-in submissions; FCFS quota and raffle winner caps
enforced by DAML; and a per-campaign claim limit. A user cannot repeatedly
trigger the same transaction to farm rewards — each reward-earning action is
single-use and state-tracked on-ledger.
```

## FIELD 24 — How do you expect your transactions to scale as your customer base scales? (Linearly, Super Linear, Sub Linear) *(Required)*
```
Sub-linear to roughly linear, by design.

- Locks scale ~linearly with verified users (each user locks once per term), but
  because lock terms are multi-day (7/15/30d), the rate of new lock transactions
  grows more slowly than the user count (sub-linear on a daily basis).
- Daily on-chain quest tasks scale roughly linearly with DAU.
- Claims scale sub-linearly: they are capped by campaign inventory and quotas
  (FCFS slots, raffle winners), so doubling users does not double claims.
- Transfers scale roughly linearly with active wallets.

Overall, because the highest-frequency reward-earning actions (claims) are quota-
capped and locks are term-bounded, total daily transactions grow more slowly than
the user base — i.e., sub-linear to linear. This is intentional: we prioritize
genuine, fee-generating activity over raw transaction volume.
```

## FIELD 25 — What is your anticipated launch date on MainNet? *(Required)*
```
📍 Ganti dengan tanggal realistis Anda. Saran format:

CanQuest is already mainnet-deployed and internally validated as a controlled
pilot (real CC, real Canton party identities, full product flow exercised by the
core team). Anticipated PUBLIC launch (first open user cohort):
🟥 Q3 2026 — [sebut bulan, mis. "September 2026"], contingent on Featured App
onboarding completion and external DAML audit (see audit fields below).

We treat FA approval and the audit as the gating items; once those are in place
we can open registration within ~4–6 weeks.
```

## FIELD 26 — Who will be your first customers and what is the expected go-live dates? *(Required)*
```
First customers are of two kinds:

(A) End users (the onboarding cohort):
- Initial verified users from Indonesia / Southeast Asia crypto communities,
  acquired through the CanQuest quest experience and referral system.
- Go-live: concurrent with public launch (🟥 Q3 2026), starting with a controlled
  first cohort of ~1,000 verified parties and expanding as lock + claim activity
  is validated.

(B) Canton ecosystem projects (partners running campaigns):
- Early partner projects that need verified Canton user acquisition. CanQuest
  offers a campaign-hosting channel so partners can launch reward campaigns
  (CC payouts, invite codes, waitlist slots) targeted at verified users.
- Go-live: the partner campaign toolchain is already built and operational in
  the pilot; first external partner campaigns are expected within the first
  month of public launch.

We will share specific partner names with the committee and our SV sponsor under
NDA during onboarding.
```

## FIELD 27 — How would not having FA status change your operating plans? *(Required)*
```
Featured App status is structurally important to CanQuest, not optional. Without
it, our operating plan changes materially:

1) App Rewards — we would be unable to participate in Canton's validator-side
   App Reward mechanism. This removes a core, usage-aligned revenue stream and
   weakens the sustainability model (revenue would rely only on claim/transfer
   fees and partner hosting).

2) Activity Markets / Activity Markers — we could not publish our genuine
   activity to the network's reward layer, so the network could not observe or
   attribute CanQuest's real activity. This breaks the strategic alignment that
   makes CanQuest a growth layer for Canton.

3) Visibility & trust — FA status is the signal ecosystem projects and users use
   to identify a bona fide Canton application. Without it, partner acquisition
   and user trust are significantly harder, slowing the public launch.

4) Plan adjustment if not approved — we would continue operating the mainnet
   pilot and complete the external DAML audit, but would scale back the public
   launch, focus on a smaller pilot cohort, and deprioritize the Activity Marker
   layer until FA status is granted. The result is far less CC movement and fee
   revenue for the network — exactly the outcome FA status is designed to enable.
```

## FIELD 28 — Controls / Audit / Characterization *(Required — three sub-questions)*

### 28a — Does your application have any controls to prevent non-bona fide transactions? (describe)
```
Yes — CanQuest is designed around structural, not heuristic, Sybil resistance:

- One Canton Party = one verified identity. Party IDs are unique per user at the
  database level (unique constraint on cantonPartyId). A bot cannot cheaply
  replicate wallets to farm a campaign.
- Commitment gating. To reach "Full access" a user must either lock CC
  non-custodially (LockedAmulet, ≥30 CC, capital at risk) or burn 5,000 earned
  points (real effort). Either path makes farming irrational.
- DAML-enforced claim engine. Campaign quotas (FCFS slots, raffle winner caps)
  and the campaign state machine (DRAFT/PAUSED/ACTIVE/ENDED/CLOSED) are enforced
  on-ledger and cannot be bypassed from the client.
- Fee-before-reward ordering. Each QuestClaim enforces that the CC claim fee is
  sent before the reward, recorded on-ledger.
- Server-side verification of off-chain tasks (X/Twitter via API, Telegram,
  Discord, quizzes) and 24-hour cooldown on daily check-ins to prevent replay.
- Cloudflare Turnstile + OTP email verification at registration; admin key
  separation from user JWTs; bcrypt-hashed admin credentials.
- Anti-sybil monitoring and a pre-launch "reset user activity" routine to start
  the public cohort from a clean state.

Together these ensure that every transaction CanQuest generates is tied to a
verified party performing a genuine, single-use action.
```

### 28b — Is your application smart contract audited? *(Required — Yes/No)*
```
🟥 No
```
> ✅ Jawab **No**. Jujur di sini = kredibel. Anda punya field 34 khusus untuk
> menjelaskan rencana audit. Field 33 (siapa auditor) bisa dikosongkan / ditulis
> "N/A — not yet audited" jika form memaksa.

### 28c — Which best characterizes your Application? *(Required — Asset Issuer / Non-Issuer)*
```
🟥 Non-Issuer
```
> CanQuest **tidak menerbitkan asset baru**. CC adalah Canton Coin native
> (diterbitkan jaringan). CanQuest hanya menggerakkan/mengunci/membayar CC →
> **Non-Issuer**.

---

## FIELD 40 — Upload Logo (optional)
```
📁 Siapkan file logo CanQuest (svg/jpg/png/gif, max 2MB, rasio kotak/square ideal).
   Upload langsung di form.
```

## FIELD 44 — What Locking PartyIDs will you be using? *(Required)*
> ⚠️ Harus konsisten dengan Field 9. Ini Party ID yang akan dipakai memenuhi
> FA locking requirement (mengunci CC).
```
🟥[Locking PartyID CanQuest — tempel party yang akan dipakai untuk lock CC]

Contoh format (gunakan party Anda yang sebenarnya, bukan placeholder):
canquest-validator-1::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb

(atau party FA khusus yang Anda alokasikan untuk locking — konfirmasi dengan SV Sponsor)
```

## FIELD 47 — Will you need support in sourcing $CC for the FA locking requirement?
```
🟥[Pilih jujur:]
- "Yes — we would welcome guidance/support in sourcing CC to meet the FA locking
   requirement, and are happy to coordinate with our SV sponsor and the Canton
   team."   ← jika BUTUH bantuan sourcing CC
- "No — we have sufficient CC allocated to meet the FA locking requirement."  ← jika SUDAH PUNYA CC
```

## FIELD 33 — Who audited your smart contract and where can we find the audit report?
```
N/A — the CanQuest DAML package has not yet been formally audited by an external
party. We have completed multiple internal security reviews (including an
AI-assisted mainnet-readiness review of the DAML contracts), and an external DAML
audit is scheduled as our first post-approval milestone. Details in the next field.
```

## FIELD 34 — If your FA is not audited, what are your plans to get it audited in the future? *(Required)*
```
We have a concrete plan to complete a formal external DAML audit:

1) Scope — the audit will cover the lean DAML package (module Main, SDK 3.4.11,
   three templates: WalletRegistration, QuestCampaign, QuestClaim), including the
   anti-sybil claim engine, the campaign state machine, the fee-before-reward
   receipt logic, and the admin-signatory / user-observer access model.

2) Timeline — external DAML audit is our first milestone after FA onboarding
   approval, targeted to begin immediately and complete within ~4–6 weeks, before
   the public user cohort opens.

3) Auditor selection — we will engage a reputable third-party firm with Canton /
   DAML expertise (candidates under evaluation). We welcome the committee's or our
   SV sponsor's recommended auditors.

4) Internal groundwork already done — multiple internal security reviews are
   complete, covering: anti-sybil unique-party enforcement, atomic reward payout
   to prevent double-spend, admin key separation, admin token verification,
  one-wallet-per-account, safer deploy scripts, and throttled token refresh. These
   reviews have already produced hardening commits in our repository.

5) Transparency — the audit report will be published and shared with the Canton
   committee and our SV sponsor; any findings will be remediated before public
   launch. Public launch is gated on audit completion.
```

## FIELD 29 — Additional Notes for the Committee's consideration
```
- Strategic alignment: CanQuest is not a generic quest platform with Canton
  support — it is a Canton growth engine that uses quests as the interface. Every
  user journey moves CC on-ledger for a genuine reason and generates recurring
  network fee income (via LockedAmulet holding fees, claim fees, and transfer
  fees).

- Status: mainnet-deployed and internally validated (real CC, real parties, full
  flow). We are ready for the Featured App onboarding and will treat the external
  DAML audit and Activity Marker alignment as immediate next steps.

- Differentiation: structural Sybil resistance (one verified party = one identity,
  plus commitment gating) means the activity the network rewards is genuine —
  addressing a real gap in Canton ecosystem growth.

- We are happy to provide a live walkthrough of the pilot, share telemetry, and
  coordinate marker schema and locking-party specifics with the Canton team and
  our SV sponsor during onboarding.

Public code: https://github.com/bangpateng/canquest
Proposal (detailed): available on request (CANQUEST Proposal, June 2026).
```

## FIELD 35 — Consent *(Required — checkbox)*
```
✅ Tick: "I agree to receive communications from the Canton Foundation"
```

---

## ✅ Checklist Pra-Submit (isi 🟥 dulu!)

Sebelum klik Submit, pastikan semua berikut sudah Anda isi/putuskan:

- [ ] **Email resmi** (Field 1, 8) — pakai domain @canquest.cc bila ada.
- [ ] **SV Sponsor sudah dipilih & sudah ada kesepakatan** (Field 37) — *KRITIS*.
      Tanpa sponsor, aplikasi sulit diproses.
- [ ] **Party ID FA** yang dipakai untuk locking (Field 9 & 44) — konsisten &
      sudah diverifikasi. Konfirmasi dengan SV Sponsor.
- [ ] **Launch date** realistis (Field 25, 26) — usul Q3 2026, ganti bulan pasti.
- [ ] **CC sourcing** (Field 47) — putuskan Butuh / Tidak butuh bantuan.
- [ ] **Audit** → jawab "No" (Field 28b), isi rencana audit (Field 34).
- [ ] **Characterization** → "Non-Issuer" (Field 28c).
- [ ] **Logo** siap upload (Field 40).
- [ ] **Demo video** 16:9 opsional (Field 12) — boost peluang kalau ada.
- [ ] **Consent** dicentang (Field 35).

> Setelah submit, Anda akan dapat balasan email dari Canton Foundation
> (biasanya via SV Sponsor + committee review). Simpan submission ID bila ada.
