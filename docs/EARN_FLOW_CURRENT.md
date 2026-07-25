# Flow Menu "Earn" — Current State (Snapshot)

> Dokumentasi flow menu **Earn** dApp CanQuest **apa adanya** (status: 2026-07-25).
> Tidak ada perubahan/proposal di sini — murni pemetaan kode yang sedang berjalan.
> Tujuan: jadi referensi sebelum melakukan modifikasi.

---

## 0. ⚠️ Konvensi Penamaan yang Membingungkan

Ada **dua** hal bernama "earn" di dApp. Pahami dulu agar tidak salah sasaran:

| Menu UI | Route | Isi | `QuestKind` |
|---|---|---|---|
| **Earn** (icon ✨ Sparkles) | `/earn` | **Partner campaigns** (Quest Center) | `CAMPAIGN` |
| **Quest** (icon 🎁 Gift) | `/quests` | **CanQuest Earn hub** (daily/social, points) | `EARN_HUB` |

> Jebakan: file/komponen bernama `earn-hub-*` menopang menu **Quest** (`/quests`),
> BUKAN menu Earn. Definisi resmi di `apps/web/lib/routing/app-routes.ts:3-8`.

**Dokumen ini hanya membahas menu Earn = `/earn` = partner campaigns (`CAMPAIGN`).**

---

## 1. Arsitektur Tingkat Tinggi

```
Menu Earn (✨) → /earn
        │
        ▼
apps/web/app/(platform)/earn/                 ← Next.js App Router (Server + Client)
   • page.tsx              → daftar campaigns
   • [questId]/page.tsx    → detail campaign (Server Component)
   • layout.tsx            → pass-through
        │
        ▼  (BFF proxy di apps/web/app/api/**)
apps/api/src/quests/                           ← NestJS + Prisma
   • quests.controller.ts  → endpoint REST
   • quests.service.ts     → logic
   • earn/earn-public.controller.ts → detail publik (tanpa login)
        │
        ▼
PostgreSQL (apps/api/prisma/schema.prisma)
   Quest · QuestTask · QuestSubmission · QuestCompletion
   EarnEntry · WinnerDraw · InviteCode · User · AppSetting
```

**Stack**: Next.js (App Router) → BFF route handlers → NestJS → Prisma → PostgreSQL.
Interaksi on-chain via Canton ledger (validator party) + Twitter API untuk verifikasi sosial.

---

## 2. Navigasi & Akses Gate

| File | Lokasi | Fungsi |
|---|---|---|
| `apps/web/components/platform/platform-shell.tsx:31` | `navItems` | Definisi menu Earn: `{ href: ROUTES.campaignQuests, key: "earn", icon: Sparkles }`. Dipakai sidebar desktop (line 119) + bottom nav mobile (line 158). |
| `apps/web/lib/routing/app-routes.ts:9-18` | `ROUTES` | `campaignQuests = "/earn"`, `campaignQuest(id, slug)`, `earnHub = "/quests"`, `leaderboard`. |
| `apps/web/lib/auth/wallet-access.ts:8` | `WALLET_GATED_HREFS` | `["/earn"]` — user tanpa wallet di-redirect ke `/wallet?from=/earn`. |
| `apps/web/lib/i18n/messages/en.ts:6` | `nav.earn` | Label "Earn" (Turkish: `tr.ts`). |

**Alur akses**:
1. User klik menu Earn → cek `WALLET_GATED_HREFS`.
2. Bila **belum punya wallet** → link di-rewrite ke `/wallet?from=/earn` + opacity 50% + tooltip "locked".
3. Bila **punya wallet** → ke `/earn` → halaman dibungkus `WalletRequiredGate`.

---

## 3. Halaman Daftar Campaign (`/earn`)

**Rantai komponen**:
1. `apps/web/app/(platform)/earn/page.tsx` → `PlatformPage` + `Suspense` + `WalletRequiredGate` + `<EarnCampaignsPage />`.
2. `apps/web/components/app/earn/earn-campaigns-page.tsx:6` → render `<QuestsBrowser variant="earn" />`.
3. `apps/web/components/app/quest/quests-browser.tsx` — komponen inti (dipakai bersama menu Quest dgn `variant="default"`).

**Behavior `QuestsBrowser variant="earn"`**:

- **2 fetch paralel** saat mount:
  - `GET /api/quests` → daftar semua campaign (`Quest[]`).
  - `GET /api/quests/my-progress` → `UserProgress` (completedQuestIds).
- **Filter tab** (line 29-33): `ACTIVE` / `COMING_SOON` / `ENDED` dengan badge count.
- **Search box**: filter by title, org, description, rewardPool, deadline, tags (case-insensitive).
- **Paginasi**: `EARN_PAGE_SIZE = 6` per halaman (`ListPagination`).
- **Hero header** khusus variant earn (line 248-262): badge "Campaign", judul "Earn Rewards".
- **Render grid** (`EarnCampaignCard`): 1 kolom mobile → 2 tablet → 3 desktop XL.
- **Loading**: `EarnCampaignSkeleton` ×6.
- **Error handling**:
  - HTTP 403 → "Please create your Canton wallet first" + tombol Create Wallet.
  - HTTP 429 → "Too many requests — wait a few seconds."
  - Timeout 30s → hint cek port 3001.
- **Empty state**: bila 0 campaign → CTA "Daily tasks" ke `/quests`.

---

## 4. Halaman Detail Campaign (`/earn/[questId]`)

**File**: `apps/web/app/(platform)/earn/[questId]/page.tsx` (Server Component).

**Alur**:
1. Parse `questId` dari URL (format `/earn/{id}` atau `/earn/{id}-{slug}`, split `-` ambil segmen pertama).
2. Ambil `CQ_ACCESS_COOKIE` dari `cookies()`.
3. **Fetch detail — dua jalur** (line 67):
   - **Authed** (ada token): `GET {apiBase}/quests/:id` dengan header `Authorization: Bearer {token}`.
   - **Guest** (tidak login): `GET {apiBase}/earn/public/:id` (publik, tanpa session).
4. Timeout 10s, `cache: "no-store"`.
5. Bila quest tidak ditemukan → `notFound()` (render `not-found.tsx`).
6. **Canonical redirect** (line 95-98): bila URL bukan `{id}-{slugify(title)}` → redirect ke canonical (SEO).

**Layout detail page**:
- **Back link** "← Back to Earn" ke `/earn`.
- **Hero header** (line 134-227):
  - Banner image (atau gradient strip jika tanpa banner) — overlay gradient.
  - **StatusPill** (ACTIVE/COMING_SOON/ENDED dengan animasi ping).
  - **TypePill** (label reward type dari `getRewardConfig`).
  - **ShareCampaign** (floating top-right).
  - Logo + org + title + description + `CampaignSocialLinks`.
- **Sidebar**: `CampaignQuestSidebar`.
- **Task panel section** (line 232-263):
  - **Authed** → `<CampaignEligibilityBadge>` + `<QuestTaskPanel>`.
  - **Guest** → prompt "Sign in / Sign up" dengan `?next={canonicalPath}` redirect balik.

---

## 5. Mengerjakan Task (`QuestTaskPanel` → `TaskRow`)

**File**: `apps/web/components/app/quest/quest-task-panel.tsx`.

### 5.1 Load Progress
- `GET /api/quests/:id/progress` (line 231) → response:
  - `completed`, `allTasksVerified`, `submissions[]`
  - `rewardStatus`, `rewardCc`, `cantonLedgerConfigured`, `ledger`
  - `campaignMeta` (FCFS slots, maxWinners, claim flags)
  - `sendProgress` (per-task `{required, today}` untuk task wallet-countable)
  - `todayVerifiedTaskIds[]` (untuk progress harian)
- **First-load spinner**, polling berikutnya **silent** (no flicker).
- **Polling 10s** untuk task wallet-countable (send/swap) yang belum selesai (line 334-370):
  - Pause saat tab hidden.
  - Refetch instan saat event `cc:new-tx` (tx masuk/keluar baru).

### 5.2 Tipe Task (dinormalisasi via `normalizeType`)
| Kategori | Type String |
|---|---|
| Sosial | `twitter_follow`, `twitter_retweet`, `telegram_channel`, `telegram_group`, `telegram_join` (alias), `discord_join` |
| Data | `submit_email`, `submit_party_id`, `submit_canton_address` |
| Quiz | `quiz_yes_no`, `quiz_choice` |
| Harian/Wallet (lebih dominan di EARN_HUB) | `daily_check_in`, `send_transaction`, `send_token`, `daily_swap`, `lock_cc`, `send_any_daily`, `send_to_user_daily`, `receive_external_daily`, `receive_internal_daily` |

### 5.3 UI Behavior per Task
- **Sequential lock** (line 210-217): hanya 1 task terbuka pada satu waktu (`firstOpenTaskIdx`); task lain = "Locked".
- **Wallet requirement**:
  - Campaign: semua task butuh wallet (`!hasRealWallet(partyId)` → `WalletCreatePromptModal`).
  - (Catatan: EARN_HUB hanya butuh wallet untuk party-id + task countable.)
- **Twitter**: task Twitter butuh `twitterUsername` ter-link → hint "Connect X in Settings".
- **Tombol status single-state** (campaign path, line 1082-1120): `Open/Start` → countdown → `Completed` (atau `Locked`/`Pending`/spinner).

### 5.4 Alur Submit per Tipe
- **Sosial (twitter/telegram/discord)**: klik Start → `openTaskTarget()` buka link eksternal → countdown (`TASK_COUNTDOWN_SEC`) → **auto-submit** proof ke `POST /quests/:id/tasks/:t/submit`.
- **Email/Party-ID**: isi input → submit manual (email butuh `@`, party-id butuh `::`).
- **Quiz yes/no & choice**: pilih jawaban → submit langsung (`submitQuizAnswer`).
- **Daily/Wallet-countable**: Start → set proof sentinel (`sent_tx`/`sent_token`/`swapped`/`locked_cc`/`checked_in`) → auto-submit → backend re-verifikasi aktivitas on-chain hari ini.

### 5.5 Decision Flow Setelah Semua Task `VERIFIED`
`QuestTaskPanel` menghitung flags (line 417-445) lalu menampilkan **salah satu** section klaim:

```
allDone = semua task VERIFIED
├─ requiresFcfsClaim && allDone && slots>0 && !ended  → CampaignFcfsClaimSection
├─ requiresPaidInviteClaim && questCompleted          → CampaignInviteClaimSection
├─ requiresDrawCcClaim && questCompleted              → CampaignDrawCcClaimSection
├─ rewardType=CC_AND_CODE_RAFFLE && questCompleted    → CampaignCcAndCodeRaffleClaimSection
└─ allDone && !requiresFcfsClaim && !ended            → QuestSubmitSection (classic)
```

---

## 6. Layer Backend (NestJS)

### 6.1 Controller — `apps/api/src/quests/quests.controller.ts`
| Method | Endpoint | Auth | Fungsi |
|---|---|---|---|
| `@Get()` | `/quests` | JWT + WalletRequired | List campaigns |
| `@Get('my-progress')` | `/quests/my-progress` | JWT + Wallet | Progress semua quest |
| `@Get('earn-hub')` | `/quests/earn-hub` | (publik) | Singleton EARN_HUB — *bukan Earn menu* |
| `@Get(':questId')` | `/quests/:id` | JWT | Detail authed |
| `@Get(':id/progress')` | `/quests/:id/progress` | JWT | Progress 1 quest |
| `@Get(':id/reward-status')` | `/quests/:id/reward-status` | JWT | Status winner/waitlist |
| `@Get(':id/eligibility')` | `/quests/:id/eligibility` | JWT | Cek gate akses (read-only) |
| `@Post(':id/tasks/:t/submit')` | `/quests/:id/tasks/:t/submit` | JWT | Submit 1 task |
| `@Post(':id/submit')` | `/quests/:id/submit` | JWT | Finalisasi classic |
| `@Post(':id/claim-fcfs')` | `/quests/:id/claim-fcfs` | JWT | Klaim FCFS |
| `@Post(':id/claim-invite')` | `/quests/:id/claim-invite` | JWT | Klaim invite code |
| `@Post(':id/claim-draw-cc')` | `/quests/:id/claim-draw-cc` | JWT | Klaim CC hasil draw |
| `@Post(':id/claim-cc-and-code-raffle')` | `/quests/:id/claim-cc-and-code-raffle` | JWT | Klaim raffle CC+code |

**Public controller** — `apps/api/src/earn/earn-public.controller.ts`:
- `@Get('earn/public/:campaignId')` dengan `@SkipThrottle()` → `quests.getQuest(campaignId)` (tanpa session, untuk guest).

### 6.2 Service — `apps/api/src/quests/quests.service.ts`
Method kunci (line number):
| Method | Line | Fungsi |
|---|---|---|
| `ensureEarnEntry` | 192 | Gate akses campaign (CC lock / points / none). 1 `EarnEntry` per user+quest. |
| `getQuestEligibility` | 309 | Cek eligibility read-only (dipakai FE badge). |
| `listQuests` | 791 | List campaign + filter status. |
| `getQuest` | 1026 | Detail campaign (authed & public). |
| `getUserAllProgress` | 1318 | Progress semua quest 1 user. |
| `submitQuestTask` | ~1390 | Submit/verify 1 task + gate entry. |
| `submitQuest` | 1808 | Finalisasi quest (classic path). |
| `getQuestRewardStatus` | 1988 | Status winner/waitlist/fcfs_claimable/fcfs_missed. |
| `claimFcfsReward` | 2349 | Klaim FCFS (reserve slot atomik + claim fee). |
| `claimDrawCcReward` | 2750 | Klaim CC hasil draw admin. |
| `claimInviteReward` | 3090 | Klaim invite code. |

### 6.3 Gate Akses (`ensureEarnEntry`, line 192-302)
4 mode (`EntryGateMode`):
| Mode | Syarat |
|---|---|
| `NONE` | Gratis — catat entry tanpa syarat. |
| `CC_OR_POINTS` | Bisa lewat dengan **lock CC** (`entryCcLock`) **atau** spend points (`entryCostPoints`). |
| `CC_ONLY` | Harus lock CC ≥ `entryCcLock`. |
| `POINTS_ONLY` | Harus spend `entryCostPoints` dari saldo net points. |

- Entry dicatat sekali per user+quest (`EarnEntry` unique `userId_questId`).
- Jalur points pakai **transaksi DB + re-check di dalam tx** (anti double-charge paralel).
- `getQuestEligibility` mencerminkan logika ini tanpa side-effect (untuk badge FE).

### 6.4 Finalisasi (`submitQuest`, line 1808-1985)
1. Cek `questCompletion` existing → idempoten (return existing bila sudah).
2. `areAllTasksVerified` → bila belum, return error.
3. Bila `requiresFcfsCcClaim` → tolak + arahkan ke tombol Claim.
4. Cek waktu `startsAt`/`endsAt`.
5. Hitung `rewardCc` (untuk `CC_ONLY`/`CC_AND_INVITE`).
6. Alokasi invite code (FCFS slot) jika `needsInvite && !requiresPaidInviteClaim` — pakai `reserveInviteCode` (lock anti TOCTOU race).
7. Record ke Canton ledger via `questLedger.recordQuestCompletion` (jika wallet + ledger configured) → dapat contract IDs.
8. Create `QuestCompletion` row.
9. Return `rewardStatus` + ledger proof.

---

## 7. Sistem Reward & Klaim (6 `RewardType`)

Didefinisikan di `apps/web/lib/quest/quest-types.ts:10-15` + config visual di `apps/web/lib/quest/quest-engine.ts:85-186`.

| `RewardType` | Label UI | Sifat | Alur Klaim |
|---|---|---|---|
| `INVITE_CODE_FCFS` | "CC FCFS" | Slot limit, first-come | `claim-fcfs` (fee) |
| `INVITE_CODE_RANDOM` | "CC Raffle" | Admin draw winners | `claim-draw-cc` |
| `WAITLIST_EMAIL` | "Waitlist" | Kumpul email | submit classic |
| `CC_ONLY` | "CC FCFS" | Claim dgn fee (default 3 CC) | `claim-fcfs` |
| `CC_MANUAL` | "CC Raffle" | Admin draw → pemenang claim | `claim-draw-cc` |
| `CC_AND_CODE_RAFFLE` | "CC + Code Raffle" (DUAL) | Bayar fee → dapat CC + kode | `claim-cc-and-code-raffle` |

**Legacy mapping** (`quest-engine.ts:195-198`):
- `CC_AND_INVITE` → `CC_AND_CODE_RAFFLE`
- `INVITE_CODE` → `INVITE_CODE_RANDOM`

**Flags turunan** (dari `campaignMeta` / reward config):
- `requiresFcfsClaim` — FCFS-style, limited slots.
- `requiresDrawCcClaim` — raffle, admin draws.
- `requiresPaidInviteClaim` — invite code dgn biaya.

**Setelah klaim sukses** → `QuestSubmittedProof` menampilkan bukti: reward CC, ledger proof, redeem URL/instructions.

---

## 8. Data Model (`apps/api/prisma/schema.prisma`)

| Model | Lokasi | Fungsi |
|---|---|---|
| `User` | line ~57 | `earnPoints Int @default(0)` — lifetime points (dominan EARN_HUB). |
| `Quest` | line ~409+ | `questKind` (`CAMPAIGN`/`EARN_HUB`), `rewardType`, `rewardCc`, `maxWinners`, `startsAt`/`endsAt`, gate fields. |
| `QuestTask` | — | `type`, `target`, `points`, urutan. |
| `QuestSubmission` | — | 1 row per user+task, status `PENDING`/`VERIFIED`/`REJECTED`, `proof`, `verifiedAt`. |
| `QuestCompletion` | — | 1 row per user+quest (finalisasi), `rewardMicroCc`, ledger IDs. |
| `EarnEntry` | line ~113 | **Per-campaign gate**, unique `userId_questId`, `method` (`none`/`cc_lock`/`points`), `pointsSpent`. |
| `WinnerDraw` | — | Slot FCFS / pemenang raffle, unique `questId_userId`. |
| `InviteCode` | — | Pool kode (di-reserve atomik saat klaim). |
| `AppSetting` | line ~605 | Key-value store, simpan `earn_entry_cost_points` override. |

**Migrations terkait Earn**:
- `20260624180000_remove_spin_add_earn_entry`
- `20260722120000_earn_hub_singleton_unique`

---

## 9. Admin (Manage Campaigns)

| File | Fungsi |
|---|---|
| `apps/web/app/admin/(panel)/earn/page.tsx` | List campaign via `/api/admin/quests?kind=CAMPAIGN`. Badge "User menu: Earn". |
| `apps/web/app/admin/(panel)/earn/new/page.tsx` | Form baru: `<QuestForm questKind="CAMPAIGN" redirectBase="/admin/earn" />`. |
| `apps/web/components/admin/admin-nav.tsx:16` | Nav admin: `/admin/earn` "Earn campaigns". |
| `apps/api/src/admin/admin.controller.ts` | Endpoint admin (create/update/draw winners). |
| `apps/api/src/admin/admin.service.ts:119-127` | Guard: EARN_HUB tidak boleh di-ops campaign-only. |

---

## 10. BFF Proxy (Next.js → NestJS)

`apps/web/app/api/quests/**/route.ts` — proxy dengan `nestWithAccessCookie` / `nestWithAdminAccessCookie`. Frontend tidak pernah langsung hit NestJS; selalu lewat BFF (cookie-based session).

---

## 11. Peta File Cepat (Cheat Sheet)

```
NAVIGATION & GATE
  apps/web/components/platform/platform-shell.tsx:31       menu Earn
  apps/web/lib/routing/app-routes.ts:9-18                  route constants
    (ROUTES.questHub = "/quests" — path tetap, identifier direname)
  apps/web/lib/auth/wallet-access.ts:8                     wallet gate
  apps/web/lib/i18n/messages/en.ts:6                       label

EARN MENU (USER)
  apps/web/app/(platform)/earn/page.tsx                    daftar campaign
  apps/web/app/(platform)/earn/[questId]/page.tsx          detail campaign
  apps/web/app/(platform)/earn/[questId]/not-found.tsx     404
  apps/web/components/app/earn/earn-campaigns-page.tsx     wrapper
  apps/web/components/app/earn/earn-campaign-card.tsx      card list
  apps/web/components/app/earn/earn-campaign-skeleton.tsx  loading
  apps/web/components/app/earn/share-campaign.tsx          tombol share
  apps/web/components/app/earn/cc-usd-value.tsx            helper CC→USD

QUEST MENU (USER) — folder dipisah dari Earn
  apps/web/app/(platform)/quests/page.tsx                  entry → QuestHubPage
  apps/web/components/app/quest/quest-hub-page.tsx         halaman Quest hub
  apps/web/components/app/quest/quests-browser.tsx         list + filter (shared)
  apps/web/components/app/quest/quest-task-panel.tsx       task + klaim (shared)
  apps/web/components/app/quest/quest-card.tsx             bridge variant
  apps/web/components/app/quest/quest-referral-card.tsx    referral
  apps/web/components/app/quest/quest-submit-section.tsx   submit classic
  apps/web/components/app/quest/task-brand-icon.tsx        ikon task
  apps/web/components/app/quest/task-points-label.tsx      label points

LEADERBOARD (terpisah dari Earn)
  apps/web/components/app/leaderboard/leaderboard-table.tsx

QUEST ENGINE (dipakai Earn + Quest)
  apps/web/lib/quest/quest-types.ts                       tipe & label (identifier: questHub*)
  apps/web/lib/quest/quest-engine.ts                      reward config
  apps/web/lib/canton/campaign-reward.ts                  reward meta

CAMPAIGN CLAIM SECTIONS
  apps/web/components/app/campaign/campaign-fcfs-claim.tsx
  apps/web/components/app/campaign/campaign-draw-cc-claim.tsx
  apps/web/components/app/campaign/campaign-cc-and-code-raffle-claim.tsx
  apps/web/components/app/campaign/campaign-invite-claim.tsx
  apps/web/components/app/campaign/campaign-quest-sidebar.tsx
  apps/web/components/app/campaign/campaign-eligibility-badge.tsx

BACKEND (NestJS)
  apps/api/src/earn/earn-public.controller.ts              detail publik
  apps/api/src/quests/quests.controller.ts                 endpoint REST
  apps/api/src/quests/quests.service.ts                   logic inti
  apps/api/src/quests/quest-reward-config.ts              reward config
  apps/api/src/canton/quest-ledger.service.ts             on-chain ledger

ADMIN
  apps/web/app/admin/(panel)/earn/page.tsx                 list admin (Earn campaigns)
  apps/web/app/admin/(panel)/earn/new/page.tsx             form baru
  apps/web/app/admin/(panel)/quests/page.tsx               admin Quest hub
  apps/web/components/admin/admin-quest-hub-panel.tsx      panel Quest hub (renamed)
  apps/web/components/admin/admin-quest-hub-tasks-panel.tsx tasks list (renamed)
  apps/web/components/admin/admin-quest-hub-task-form.tsx  task form (renamed)
  apps/api/src/admin/admin.controller.ts                   endpoint admin
  apps/api/src/admin/admin.service.ts                      logic admin

REFACTOR NOTE (branch refactor/separate-earn-quests)
  Folder dipisah: earn/ = menu Earn (CAMPAIGN), quest/ = menu Quest (EARN_HUB).
  Identifier FE earnHub*/EarnHub* → questHub*/QuestHub*.
  TETAP (kontrak stabil): DB enum QuestKind.EARN_HUB, route path /quests/earn-hub
  & /admin/earn-hub, field backend earnHubConfigured/earnHubCompleted,
  string literal "EARN_HUB" di discriminated union TS.

DATA
  apps/api/prisma/schema.prisma                            data model
  apps/api/prisma/migrations/                              skema migration
```

---

## 12. Endpoint Sequence (Happy Path User)

```
1. GET  /api/quests                              → list campaign
2. GET  /api/quests/my-progress                  → progress user
3. (klik campaign) GET /earn/public/:id atau /quests/:id → detail
4. GET  /quests/:id/progress                     → submissions + meta
5. GET  /quests/:id/eligibility                  → badge eligible
6. POST /quests/:id/tasks/:t/submit  (× N)       → verifikasi tiap task
7. POST /quests/:id/submit  ATAU  /claim-*       → finalisasi/klaim reward
8. GET  /quests/:id/reward-status                → status akhir
```

---

Dokumen ini adalah snapshot kondisi kode per 2026-07-25. Saat ingin mengubah,
sebutkan bagian mana yang ingin dimodifikasi agar bisa ditelusuri ke file yang tepat.
