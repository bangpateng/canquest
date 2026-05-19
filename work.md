# CANQUEST — ENTERPRISE WEB3 PLATFORM ARCHITECTURE

You are a world-class senior Web3 architect and product engineer specialized in:

* Canton Network
* DAML Smart Contracts
* Enterprise blockchain systems
* Next.js 15
* NestJS
* PostgreSQL
* Redis
* Web3 UX
* Secure infrastructure
* Scalable backend systems

Your task is to design and build a premium enterprise-grade Web3 platform named:

# CANQUEST

This project is NOT:

* a low-quality crypto website
* a generic dashboard
* a basic Web3 clone
* a casino-style crypto UI

This project MUST feel like:

* a premium enterprise Web3 platform
* institutional-grade infrastructure
* modern financial network application
* polished Web3 SaaS product
* scalable and secure ecosystem

The final result must feel comparable to:

* CCTools
* Vala Wallet
* Galxe
* Coinbase Wallet
* Rainbow Wallet
* Linear
* Notion
* modern enterprise SaaS products

---

# OFFICIAL DOCUMENTATION REQUIREMENT

All Canton and DAML logic MUST follow official documentation:

* https://docs.digitalasset.com/build/3.5/index.html
* https://docs.digitalasset.com/build/3.5/reference/app-dev/index.html
* https://docs.digitalasset.com/build/3.5/reference/app-dev/ledger-api/type-conversions/index.html
* https://docs.digitalasset.com/build/3.5/reference/smart-contracts/index.html

Never invent fake Canton architecture.
Never create fake DAML logic.
Always follow official ledger patterns.

---

# PROJECT OVERVIEW

CanQuest is:

* a Web3 quest platform
* reward ecosystem
* Canton identity platform
* wallet system
* leaderboard platform
* spin reward engine
* SocialFi infrastructure

Users:

* complete quests
* earn points
* use points in reward spins
* receive rewards
* send/receive CC tokens
* interact with Canton network identities

---

# DOMAIN STRUCTURE

## Landing Page

canquest.com

Purpose:

* branding
* onboarding
* featured campaigns
* project information

---

## Main Dapp

app.canquest.com

Purpose:

* dashboard
* quests
* wallet
* rewards
* transactions
* leaderboard

---

# UI / UX REQUIREMENTS

The UI must look:

* premium
* futuristic
* modern
* enterprise
* clean
* elegant
* high-end Web3

DO NOT:

* create cheap crypto UI
* use cluttered layouts
* use excessive neon
* use childish effects
* create casino-like visuals
* overload animations
* use outdated dashboard styles

The design must feel:

* expensive
* scalable
* trustworthy
* smooth
* polished

---

# DESIGN INSPIRATION

Main references:

* CCTools
* Vala Wallet
* Galxe
* Coinbase Wallet
* Rabby Wallet
* Linear
* Stripe Dashboard
* modern Apple UI
* premium DAO interfaces

---

# DESIGN SYSTEM

## Theme Style

Style:

* modern DAO dashboard
* enterprise blockchain app
* minimal futuristic
* soft glassmorphism
* premium card system
* elegant spacing
* large typography
* smooth interactions

---

# COLORS

## Background

* #ffffff
* #fffef7
* #f8f9fb

## Primary

* #d4ff3f
* #c7f227
* #eaff72

## Accent

* #111111
* #232323
* #666666

---

# TYPOGRAPHY

## Headings

* Space Grotesk

## Body

* Inter

Typography must feel:

* premium
* modern
* highly readable
* balanced
* spacious

---

# UI COMPONENT QUALITY

Every component must:

* feel premium
* have proper spacing
* have subtle hover effects
* have smooth transitions
* have responsive layouts
* support dark mode architecture
* support accessibility

Use:

* soft shadows
* rounded corners
* modern borders
* subtle gradients
* elegant hover states

---

# FRONTEND STACK

Frontend:

* Next.js 15 App Router
* TypeScript
* TailwindCSS
* shadcn/ui
* Framer Motion
* Zustand
* Tanstack Query
* Lucide React

Architecture:

* scalable
* modular
* reusable
* enterprise-ready

---

# BACKEND STACK

Backend:

* NestJS
* PostgreSQL
* Redis
* Prisma ORM
* BullMQ queues

Architecture:

* event-driven
* scalable
* secure
* service-oriented

---

# BLOCKCHAIN STACK

* Canton Network
* DAML Smart Contracts
* Canton Ledger API
* Participant integration
* Party ID management

---

# INFRASTRUCTURE

IMPORTANT:

The Canton validator node already runs on a dedicated VPS.

That VPS must ONLY run:

* validator
* participant
* sequencer
* mediator
* ledger API

NEVER host:

* frontend
* dashboard
* public API
* public database

Frontend and backend must run on separate infrastructure.

---

# LOCAL DEVELOPMENT FLOW

Development environment:

Local PC:

* frontend
* backend
* PostgreSQL
* Redis

Connected via SSH tunnel to remote Canton ledger API.

Example:
ssh -L 6865:localhost:6865 user@VPS_IP

Backend connects to:
localhost:6865

Never expose ledger API publicly.

---

# LANDING PAGE REQUIREMENTS

Domain:
canquest.com

Single-page premium landing page.

Sections:

1. Hero
2. Featured Campaigns
3. Features
4. Powered by Canton
5. Security
6. Footer

---

# HERO SECTION

Must include:

* animated Canton-inspired background
* floating quest cards
* modern gradients
* glowing particles
* launch app CTA
* smooth motion effects

Tagline:
"Quest • Earn • Build on Canton"

The hero section must feel:

* premium
* cinematic
* futuristic
* enterprise Web3

---

# FEATURED CAMPAIGNS

Display:

* project banners
* project logos
* reward information
* participants
* deadlines

Cards must feel:

* modern
* interactive
* clean
* high quality

---

# DAPP REQUIREMENTS

Domain:
app.canquest.com

---

# AUTHENTICATION SYSTEM

Users can:

* register
* login
* verify OTP

Register fields:

* email
* password
* invite code

OTP:

* use Resend API

After verification:

* create user
* create Party ID
* bind Canton identity

---

# PARTY ID SYSTEM

Users enter:

* username

Backend:

* validates
* creates Party ID
* binds user identity
* syncs with DAML contracts

All Party ID operations must follow Canton standards.

---

# DASHBOARD

Main navigation:

* Dashboard
* Quest
* Leaderboard
* Spin Reward
* Wallet
* Transactions
* Settings

Desktop:

* premium sidebar layout

Mobile:

* modern bottom navbar

---

# QUEST SYSTEM

Quest cards must include:

* uploaded banner
* project logo
* project description
* social media icons
* participants
* reward pool
* deadlines
* task count

Style:

* modern
* compact
* premium
* reward-focused

---

# TASK TYPES

Supported tasks:

* Twitter Follow
* Retweet
* Telegram Join
* Discord Join
* Submit Email
* Submit Canton Address
* Visit Website

Every task:

* has reward points
* has backend verification
* has DAML approval flow
* has configurable settings

Never trust frontend verification.

---

# QUEST FLOW

User:

* completes tasks
* submits verification

Backend:

* verifies actions
* executes DAML choices
* mints points
* updates leaderboard

---

# WINNER SYSTEM

Quest campaigns support:

* FCFS
* random winners
* manual selection

Rewards:

* WL codes
* downloadable files
* vouchers
* CC rewards
* NFTs

Randomness:

* backend generated
* cryptographically secure
* ledger recorded

Never generate randomness on frontend.

---

# LEADERBOARD

Types:

* weekly
* monthly
* all time

Leaderboard updates:

* realtime
* websocket powered
* cached using Redis

Points:

* increase from quests
* decrease from spin usage

---

# SPIN REWARD SYSTEM

Users spend points to spin rewards.

Possible rewards:

* WL
* CC
* NFT
* reward codes
* vouchers

Admin can configure:

* rarity
* inventory
* probabilities
* reward pools

Example:

* Not Win = 90%
* WL = 5%
* CC = 3%
* Rare = 1.5%
* Legendary = 0.5%

All spins:

* recorded
* auditable
* secure

---

# WALLET SYSTEM

Users have:

* Party ID
* Canton wallet identity

Features:

* send CC
* receive CC
* transaction history
* fee tracking
* activity logs

Transfer fee:
3 CC

Fee destination:
master treasury Party ID

---

# PREAPPROVAL & UTXO

Settings:

* enable UTXO
* enable preapproval

Purpose:

* faster settlement
* smoother UX
* less manual approval

---

# ADMIN DASHBOARD

OWNER ONLY.

No public access.

Features:

* create/edit/delete quests
* reward management
* spin configuration
* user moderation
* freeze/ban users
* treasury management
* analytics
* audit logs
* suspicious activity monitoring

---

# SECURITY REQUIREMENTS

Authentication:

* JWT rotation
* refresh tokens
* device fingerprinting
* session management

API:

* rate limiting
* anti spam
* captcha
* WAF ready

Blockchain:

* replay protection
* nonce validation
* transaction verification
* multisig treasury
* ledger validation

Anti abuse:

* anti sybil
* anti multi-account
* IP heuristics
* behavior analysis

Monitoring:

* Prometheus
* Grafana
* Sentry
* audit logs

---

# EVENT-DRIVEN ARCHITECTURE

Use:

* BullMQ
* Redis queues
* async workers

Never execute heavy ledger actions synchronously.

Flow:
API
→ Queue
→ Worker
→ Ledger API
→ DAML

---

# LEDGER INDEXER

Create a dedicated ledger indexer service.

Purpose:

* read ledger events
* sync to PostgreSQL
* cache data
* optimize frontend queries

Never query ledger directly from frontend repeatedly.

---

# DATABASE ARCHITECTURE

Separate:

1. App database
2. Ledger database

App database:

* users
* sessions
* quests
* rewards
* analytics
* notifications

Ledger database:

* Canton/DAML only

---

# STORAGE ARCHITECTURE

Use:

* Cloudflare R2
  or
* S3 compatible storage

Store:

* banners
* reward files
* uploads

Never store production files directly on VPS disk.

---

# OBSERVABILITY

Implement:

* structured logging
* error tracking
* metrics
* health checks
* audit trails

Use:

* Pino
* Sentry
* Prometheus
* Grafana

---

# DAML CONTRACT MODULES

/User
/Quest
/Reward
/Wallet
/Admin
/Audit

Suggested contracts:

* UserAccount
* PartyBinding
* QuestCampaign
* QuestTask
* QuestCompletion
* RewardPool
* SpinReward
* TransferRequest
* TreasuryFee
* AdminPermission
* AuditLog

---

# CI/CD

Use:

* GitHub Actions
* staging deployment
* testnet deployment
* production deployment

Environment separation:

* local
* devnet
* staging
* testnet
* mainnet

---

# DEVELOPMENT PHASES

Phase 1:

* project architecture
* UI system
* auth system
* Party ID

Phase 2:

* quest engine
* verification APIs

Phase 3:

* DAML integration
* point rewards

Phase 4:

* wallet & transfer system

Phase 5:

* spin reward system

Phase 6:

* security hardening
* observability

Phase 7:

* staging & beta invite

Phase 8:

* mainnet launch

---

# DEVELOPMENT RULES

Always:

* explain architecture before coding
* use TypeScript
* use modular architecture
* follow clean code principles
* use reusable components
* separate business logic
* use environment variables
* never hardcode secrets

Priority:

1. Security
2. Scalability
3. UX
4. Performance

Generate:

* full folder structure
* frontend architecture
* backend architecture
* DAML contracts
* API routes
* Prisma schema
* Docker setup
* CI/CD examples
* security middleware
* reusable UI components
* premium dashboard layouts
* responsive mobile UI
* admin dashboard architecture
* observability setup
* queue system
* ledger indexer
* caching strategy
* monitoring setup
