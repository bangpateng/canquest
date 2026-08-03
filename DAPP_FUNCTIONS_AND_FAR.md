# CanQuest DApp — Fungsi per Menu & Status FAR (untuk Canton AI)

> **Tujuan:** Gambaran lengkap fungsi dapp CanQuest saat ini + status Featured App
> Right (FAR) / WalletUserProxy, sebagai bahan untuk merancang DAML baru
> (canquest-v22) dan bertanya ke AI Dokumentasi Canton.
>
> **Konteks:** DAML lama (canquest-v21) sudah dead code, ledger bersih (FRESH
> START verified). Sekarang merancang DAML baru sesuai fungsi dapp NYATA.

---

## 1. Stack & Custody Model

| Komponen | Detail |
|---|---|
| Frontend | Next.js 14 (Vercel), route group `(platform)` untuk user, `admin/(panel)` untuk admin |
| Backend | NestJS (VPS 2 `/var/www/canquest`), custodial operator mode |
| Ledger | Canton participant node (VPS 1 `ledger.canquestlabs.com`) |
| Validator app | Splice validator (`validator.canquestlabs.com`) |
| Auth | Keycloak sendiri (`auth.canquestlabs.com`), client_credentials, scope `daml_ledger_api` |
| Database | Supabase (Postgres) |
| Swap | OneSwap (DEX eksternal Canton, via `@oneswap/sdk`) |

**Custody:** CUSTODIAL penuh. Backend (operator party `canquest-operator`) submit
hampir semua command onchain atas nama user. User party = observer-only (tidak
self-submit command). Token: `validator-app-backend` punya `CanActAsAnyParty`.

**Party onchain:**
- `canquest-operator::1220...` (operator, signer DAML)
- `canquest-validator` (DSO/validator admin)
- Reward wallet party (`CANTON_REWARD_PARTY_ID`)
- Fee/treasury party (`CANTON_FEE_RECIPIENT_PARTY_ID`)
- Lock holder (`CANTON_LOCK_HOLDER_PARTY`)
- App provider (`CANTON_APP_PROVIDER_PARTY_ID`) — untuk FAR
- User parties (dinamis, alokasi via Splice validator saat onboarding)
- OneSwap deposit party (dinamis, dari `createSwap`)

---

## 2. Menu Dapp (Frontend) — Fungsi Nyata per Menu

Struktur route: `apps/web/app/(platform)/`. Semua endpoint lewat JWT user.

### 📊 Overview (`/overview`)
Dashboard ringkasan: saldo CC, token non-CC, quest aktif, leaderboard snapshot.
**Onchain:** query balance (`queryAmuletHoldings` + `queryTokenHoldingsByInterface`).
No DAML.

### 💼 Wallet (`/wallet`)
Menu utama wallet. Sub-fungsi:

**2.1 Send CC** (`POST /party/send-cc`)
- Transfer CC (Amulet) user→user, dengan platform fee.
- Onchain: `TransferFactory_Transfer` (CIP-56) ATAU `WalletUserProxy_TransferFactory_Transfer` (bila FAR aktif).
- Fee: `TransferFactory_Transfer` CC → treasury party.
- Atomicity saat ini: **2 command terpisah** (transfer + fee) — bisa gagal partial.

**2.2 Send Token (USDCx)** (`POST /party/send-token`)
- Transfer USDCx (token non-CC) P2P, dengan fee CC.
- Onchain: `TransferFactory_Transfer` dengan `instrumentId + instrumentAdmin` (resolve dari OneSwap `listTokens`).
- Pre-check: `getTokenBalanceOnChain` (saldo onchain 1 instrument).
- Token lain (CBTC): "coming soon" via OneSwap registry.

**2.3 Swap (OneSwap)** (`POST /party/swap`)
- Swap CC ↔ USDCx via DEX eksternal.
- Model: custodial deposit-then-return. 1 onchain call: `TransferFactory_Transfer` input user → OneSwap depositParty.
- Quote: `oneswap.getQuote`. Eksekusi: `oneswap.createSwap` + `waitForSwap`.

**2.4 Lock CC** (`POST /party/lock`)
- Kunci CC untuk jangka N detik (Earn tiers / loyalty), kembali utuh di `expiresAt`.
- Onchain: `AmuletRules_Transfer` (self-lock) → create `LockedAmulet`.
- Terms: configurable via `LOCK_TERM_OPTIONS` (mis. `7d:604800,15d:1296000,30d:2592000`).

**2.5 Unlock CC** (`POST /party/unlock`)
- Buka LockedAmulet setelah jatuh tempo.
- Onchain: `LockedAmulet_OwnerExpireLockV2`.

**2.6 TransferPreapproval** (`POST /party/preapproval/enable|disable`)
- Enable direct transfer (skip offer/accept), provider pre-pay fee burn ~1.5 CC.
- Onchain: `AmuletRules_CreateTransferPreapproval`, `TransferPreapproval_Cancel`.

**2.7 Offer Inbox** (`POST /party/offers/accept|reject`, `/party/transfer-instruction/withdraw`)
- Terima/tolak incoming TransferInstruction; cancel outgoing.
- Onchain: `TransferInstruction_Accept/Reject/Withdraw` ATAU via proxy `WalletUserProxy_TransferInstruction_*`.
- Legacy: `TransferOffer_Accept/Reject` (Splice.Wallet.TransferOffer).

**2.8 Transaction History / Detail** (`GET /party/transactions/:id`)
- Detail transaksi + explorer link (cc.modo.link).
- Onchain: `fetchTransactionByUpdateId` (read-only).

**2.9 Balance / Prices** (`GET /party/balance`, `/party/prices`)
- Saldo CC + token non-CC, harga USD (dari scan-proxy amuletPrice).

### 🎯 Quests (`/quests`, `/quests/[questId]`)
Campaign quest, klaim reward. Endpoint claim:

**3.1 Claim FCFS** (`POST /quests/:id/claim-fcfs`)
- First-come-first-served slot. Onchain flow:
  1. `ClaimFcfsSlot` (DAML — reserve slot + create QuestClaim)
  2. `TransferFactory_Transfer` CC user→fee party (claim fee)
  3. `TransferFactory_Transfer` reward party→user (reward CC)
  4. `AtomicFeeAndReward` (DAML — receipt fee+reward)
- Atomicity: 4 command terpisah → bisa gagal partial.

**3.2 Claim Draw CC (Raffle)** (`POST /quests/:id/claim-draw-cc`)
- Pemenang raffle claim. Sama dengan FCFS tapi via `DrawRaffleWinner` (admin draw).

**3.3 Claim Invite (Code)** (`POST /quests/:id/claim-invite`)
- Klaim kode invite. Via `ClaimFcfsSlot`/`DrawRaffleWinner` + `RevealRewardCode` (reveal kode setelah fee).

**3.4 Claim CC + Code Raffle** (`POST /quests/:id/claim-cc-and-code-raffle`)
- Raffle gabungan: dapat CC + kode. Fee 5 CC. Via `DrawRaffleWinner` + `AtomicFeeAndReward` + `RevealRewardCode`.

**3.5 Submit Quest / Task** (`POST /quests/:id/submit`, `/tasks/:taskId/submit`)
- Submit bukti task. Bila auto-claim: enqueue CC reward via `ledgerQueue.enqueueCcReward`.

### 🏆 Earn (`/earn`, `/earn/[questId]`)
Hub quest + Earn tiers (lock-based loyalty). Read-only view campaign.
Onchain: sama dengan quests, plus lock-based tier eligibility (`lockedCcOf` query).

### 📈 Leaderboard (`/leaderboard`)
Ranking poin user. Pure DB (Postgres). No onchain.

### 📜 Activity (`/activity`, `/activity/[id]`)
Histori aktivitas user (transfer, claim, dll). DB + onchain update_id resolve.

### ⚙️ Settings (`/settings`)
Profil user, wallet party ID display. Read-only.

### 👑 Admin (`/admin/(panel)/...`)
- **Quests management**: create/update/delete campaign, draw winners, distribute rewards.
- **Earn hub**: manage featured earn campaigns.
- **Wallet invites**: generate CSPRNG invite codes (gate pembuatan wallet).
- **Users**: list/delete/ban, referral moderation (poin clawback).
- **Referrals**: lihat/kelola referral fraud.

Distribute rewards (`POST /admin/quests/:id/distribute-rewards`) = satu-satunya endpoint admin yang kirim CC onchain (`splice.sendReward`).

---

## 3. Status FAR (Featured App Right) & WalletUserProxy — SAAT INI

### 3.1 Konfigurasi (env)
```
USE_WALLET_PROXY         → off by default (true hanya kalau explicit "true"/"1")
CANTON_APP_PROVIDER_PARTY_ID → CHANGE_ME di testnet/production example
FEATURED_APP_MARKERS_ENABLED → false (default, MainNet only)
CANTON_FEATURED_APP_MARKER_TEMPLATE_ID → kosong (butuh full hash utk MainNet)
CANTON_PROXY_FAR_CID     → kosong (override manual, kalau ada)
```

### 3.2 Implementasi (sudah ada, feature-flagged)

Backend sudah punya 2 path transfer, di-switch via `USE_WALLET_PROXY`:

| Path | Choice | When |
|---|---|---|
| **Direct CIP-56** | `TransferFactory_Transfer` | `USE_WALLET_PROXY=false` (default saat ini) |
| **Proxy + FAR** | `WalletUserProxy_TransferFactory_Transfer` | `USE_WALLET_PROXY=true` + FAR approved |
| **Proxy batch (fallback)** | `WalletUserProxy_BatchTransfer` | `USE_WALLET_PROXY=true` tapi FAR kosong |

Logic (`canton-ledger.service.ts:681`):
```ts
get useWalletProxy(): boolean {
  return v === 'true' || v === '1';  // off by default
}
```

Offer proxy (`useWalletProxyForOffers`) = `true` HANYA kalau `USE_WALLET_PROXY on` DAN
FAR contract ada di ACS. Tidak ada fallback batch untuk offer (FAR wajib).

### 3.3 FAR readiness — SUDAH SIAP kode, tinggal approve

**Yang sudah ada:**
- `ProxyCacheService` — query ACS, cache WalletUserProxy + FeaturedAppRight contractId + blob (TTL 10m)
- `executeProxyTransfer` — exercise `WalletUserProxy_TransferFactory_Transfer` dengan disclosed FAR
- `executeProxyBatchTransfer` — fallback tanpa FAR
- `executeProxyOfferChoice` — Accept/Reject/Withdraw offer via proxy
- `FeaturedAppActivityService` — create `FeaturedAppActivityMarker` (activityType: wallet_created, quest_completed, cc_transfer, task_verified)

**Yang belum (blok FAR aktif):**
- Canton Foundation belum approve FeaturedAppRight untuk app provider party Anda
- `CANTON_APP_PROVIDER_PARTY_ID` belum di-set di production env
- `FEATURED_APP_MARKERS_ENABLED=false`

Jadi: **FAR ready di kode, off di production**. Switch on = set env + approve FAR.

---

## 4. DAML Sebenarnya Dipakai Backend Hari Ini

DAML lama (`canquest-v21`) **dead code** — backend panggil tapi DAR tidak pernah ter-deploy, semua gagal diam-diam. Yang BENAR-BENAR jalan hari ini:

### Yang di token standard (Splice, BUKAN DAML Anda):
- CIP-56: `TransferFactory_Transfer`, `TransferInstruction_Accept/Reject/Withdraw`
- `AmuletRules_CreateTransferPreapproval`, `TransferPreapproval_Cancel`
- `AmuletRules_Transfer` (lock), `LockedAmulet_OwnerExpireLockV2` (unlock)
- `WalletUserProxy_*` (proxy path, saat FAR on)
- `FeaturedAppActivityMarker` create

### Yang DAML Anda (target baru v22) — harus own:
- **Anti-sybil quest campaign** (kuota FCFS, raffle draw oleh admin)
- **State machine campaign** (DRAFT/ACTIVE/PAUSED/ENDED/CLOSED)
- **Claim receipt** (idempotency per (campaignId, userAddress), ordering fee-before-reward)
- **Wallet identity anchor** (opsional, on-chain record user registration)

---

## 5. Pertanyaan untuk Canton AI (siap tempel)

```
I'm designing NEW DAML contracts (canquest-v22) for my Canton Network dapp.
Replacing dead DAML (v21 never deployed). Ledger is clean (FRESH START verified,
0 active contracts). Here's the FULL picture of what my dapp does today.

STACK: validator-app mode, CUSTODIAL operator pattern (backend operator party
submits all commands; user parties are observer-only). Splice token standard
(CIP-56) owns all CC/token movement. My DAML should own anti-sybil quest logic
+ receipt, NOT CC movement.

DAPP FUNCTIONS (menu by menu):
- Wallet: Send CC, Send Token (USDCx), Swap (OneSwap DEX), Lock/Unlock CC,
  TransferPreapproval, Offer Inbox (accept/reject/withdraw), Tx History
- Quests: Claim FCFS, Claim Draw CC (raffle), Claim Invite (code),
  Claim CC+Code Raffle, Submit Quest/Task
- Earn: hub + lock-based loyalty tiers
- Admin: create/draw/distribute quest campaigns, wallet invites, user mgmt

FAR / WALLETUSERPROXY STATUS:
- Code READY (ProxyCacheService, executeProxyTransfer, executeProxyBatchTransfer,
  executeProxyOfferChoice, FeaturedAppActivityService)
- Feature-flagged OFF in production (USE_WALLET_PROXY=false default)
- Switch path: USE_WALLET_PROXY=true + Canton Foundation approves FeaturedAppRight
  for CANTON_APP_PROVIDER_PARTY_ID
- Currently all transfers use direct CIP-56 (TransferFactory_Transfer), not proxy

ATOMICITY REQUIREMENT (quest reward claim):
Each claim = 4 onchain actions that MUST be atomic:
  1. ClaimSlot/DrawWinner (DAML — reserve slot, anti-sybil)
  2. TransferFactory_Transfer fee: user→treasury (CIP-56, controller=user)
  3. TransferFactory_Transfer reward: rewardParty→user (CIP-56, controller=rewardParty)
  4. Settle receipt (DAML — record feeTxId+rewardTxId)
Today these are 4 SEPARATE commands → can fail partial. I need atomicity.

VERIFIED CONSTRAINT (from earlier Canton AI answer):
- Nested exercise of TransferFactory_Transfer INSIDE my DAML choice is NOT
  possible in custodial mode: controller of TransferFactory_Transfer = transfer.sender
  (user/rewardParty), not operator. Operator cannot exercise user's choice.
- So DAML choice cannot atomically trigger both CIP-56 transfers.

QUESTIONS:

1. ATOMICITY via single command multi-leg:
   Can I submit ONE /v2/commands/submit with commands:[Exercise Settle, Exercise
   TransferFactory_Transfer fee, Exercise TransferFactory_Transfer reward] and
   have all three land in one atomic transaction tree?
   - What actAs is required? [operator, user, rewardParty] — my service-account
     token has CanActAsAnyParty, can it actAs all three in one command?
   - Is there a Canton primitive that confirms multi-leg atomicity at command
     level, or only at DAML transaction-tree level?

2. FAR + atomicity:
   If I switch to WalletUserProxy path (FAR approved), does it CHANGE the
   atomicity story? Can WalletUserProxy_TransferFactory_Transfer be nested in
   my DAML choice (since controller is now appProvider via proxy, not raw user)?
   Or still must be command-level composition?

3. Recommended DAML boundary for v22:
   Given custodial + CIP-56-direct (FAR off) now, but FAR-ready:
   - Should DAML v22 include FAR/proxy-aware choices, or stay FAR-agnostic
     (just receipt + anti-sybil, transfer path decided by backend)?
   - If FAR-agnostic: is there migration risk later when FAR switches on?

4. Template set for v22:
   Proposed 3 templates:
   - WalletRegistration (identity anchor, create-only)
   - QuestCampaign (quota + state machine, choices: Activate/Pause/ClaimSlot/
     DrawWinner/Close, contract key optional)
   - QuestClaimReceipt (idempotency key (operator,campaignId,userAddress),
     choices: Settle (receipt), RevealCode, Expire)
   Is this right for my function set? Anything missing for lock/unlock, swap,
   send-cc/send-token (which currently have NO DAML — pure CIP-56)?

5. Should lock/unlock CC, swap, send-cc/send-token have ANY DAML contract?
   Today they're pure CIP-56 (AmuletRules_Transfer, LockedAmulet, TransferFactory).
   Is there business value in wrapping them in my DAML, or should they stay
   pure token-standard (DAML only for quest logic)?

6. Idempotency for send-cc / send-token (not just quest claims):
   Today: deterministic commandId from SHA256(sender|receiver|amount|clientNonce).
   Should this move to DAML contract key, or stay command-level commandId dedup?

Please recommend a concrete DAML v22 architecture: templates, choices,
controllers, contract keys, and where atomicity should live (DAML vs command-level).
Address FAR-readiness: should v22 be FAR-agnostic or FAR-aware from day 1?
```

---

## 6. Ringkasan Keputusan yang Perlu Dibuat (setelah jawaban Canton AI)

| # | Keputusan | Opsi |
|---|---|---|
| 1 | Atomicity path | Single-command multi-leg (rekomendasi) vs DAML nested (tidak bisa) vs 2 command terpisah (non-atomic) |
| 2 | FAR di v22 | FAR-agnostic (backend switch) vs FAR-aware DAML choices |
| 3 | Template set | 3 (WalletReg + Campaign + ClaimReceipt) vs lebih (lock/swap/send wrappers) |
| 4 | DAML boundary | Quest-only (recommended) vs wrap semua onchain action |
| 5 | Idempotency | commandId dedup (backend) vs contract key (DAML) untuk send/claim |
| 6 | WalletRegistration | Sertakan (on-chain identity) vs skip (party alloc saja) — Anda pilih SERTAKAN |
