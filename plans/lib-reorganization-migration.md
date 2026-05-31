# Lib Folder Reorganization - Migration Plan

## Overview
This document details the migration plan for reorganizing `apps/web/lib/` from 24 root-level files into 9 domain-specific subfolders.

**Total files to move:** 24  
**Total import updates needed:** ~191 references across the codebase

---

## Phase 1: File Moves

### 1.1 Auth Folder (`lib/auth/`)
| Old Path | New Path |
|----------|----------|
| `lib/auth-cookies.ts` | `lib/auth/auth-cookies.ts` |
| `lib/wallet-access.ts` | `lib/auth/wallet-access.ts` |
| `lib/wallet-session-cache.ts` | `lib/auth/wallet-session-cache.ts` |
| `lib/nest-proxy-cookie-jwt.ts` | `lib/auth/nest-proxy-cookie-jwt.ts` |
| `lib/nest-proxy-admin-access.ts` | `lib/auth/nest-proxy-admin-access.ts` |

### 1.2 Canton Folder (`lib/canton/`)
| Old Path | New Path |
|----------|----------|
| `lib/canton-party-id.ts` | `lib/canton/canton-party-id.ts` |
| `lib/cc-reward-logo.ts` | `lib/canton/cc-reward-logo.ts` |
| `lib/campaign-reward.ts` | `lib/canton/campaign-reward.ts` |

### 1.3 Quest Folder (`lib/quest/`)
| Old Path | New Path |
|----------|----------|
| `lib/quest-types.ts` | `lib/quest/quest-types.ts` |
| `lib/quest-media-url.ts` | `lib/quest/quest-media-url.ts` |
| `lib/quest-social-links.ts` | `lib/quest/quest-social-links.ts` |

### 1.4 UI Folder (`lib/ui/`)
| Old Path | New Path |
|----------|----------|
| `lib/ui-button-styles.ts` | `lib/ui/ui-button-styles.ts` |
| `lib/ui-tokens.ts` | `lib/ui/ui-tokens.ts` |

### 1.5 API Folder (`lib/api/`)
| Old Path | New Path |
|----------|----------|
| `lib/internal-api-url.ts` | `lib/api/internal-api-url.ts` |
| `lib/format-api-error.ts` | `lib/api/format-api-error.ts` |
| `lib/turnstile.ts` | `lib/api/turnstile.ts` |

### 1.6 Routing Folder (`lib/routing/`)
| Old Path | New Path |
|----------|----------|
| `lib/app-routes.ts` | `lib/routing/app-routes.ts` |
| `lib/slug.ts` | `lib/routing/slug.ts` |
| `lib/referral-ref.ts` | `lib/routing/referral-ref.ts` |

### 1.7 Config Folder (`lib/config/`)
| Old Path | New Path |
|----------|----------|
| `lib/site-config.ts` | `lib/config/site-config.ts` |

### 1.8 Marketing Folder (`lib/marketing/`)
| Old Path | New Path |
|----------|----------|
| `lib/landing-campaign-display.ts` | `lib/marketing/landing-campaign-display.ts` |
| `lib/mock-demo.ts` | `lib/marketing/mock-demo.ts` |

### 1.9 Utils Folder (`lib/utils/`)
| Old Path | New Path |
|----------|----------|
| `lib/utils.ts` | `lib/utils/utils.ts` |
| `lib/refetch-throttle.ts` | `lib/utils/refetch-throttle.ts` |

---

## Phase 2: Import Path Updates

### Import Path Mapping Table

| Old Import Path | New Import Path |
|-----------------|-----------------|
| `@/lib/auth-cookies` | `@/lib/auth/auth-cookies` |
| `@/lib/wallet-access` | `@/lib/auth/wallet-access` |
| `@/lib/wallet-session-cache` | `@/lib/auth/wallet-session-cache` |
| `@/lib/nest-proxy-cookie-jwt` | `@/lib/auth/nest-proxy-cookie-jwt` |
| `@/lib/nest-proxy-admin-access` | `@/lib/auth/nest-proxy-admin-access` |
| `@/lib/canton-party-id` | `@/lib/canton/canton-party-id` |
| `@/lib/cc-reward-logo` | `@/lib/canton/cc-reward-logo` |
| `@/lib/campaign-reward` | `@/lib/canton/campaign-reward` |
| `@/lib/quest-types` | `@/lib/quest/quest-types` |
| `@/lib/quest-media-url` | `@/lib/quest/quest-media-url` |
| `@/lib/quest-social-links` | `@/lib/quest/quest-social-links` |
| `@/lib/ui-button-styles` | `@/lib/ui/ui-button-styles` |
| `@/lib/ui-tokens` | `@/lib/ui/ui-tokens` |
| `@/lib/internal-api-url` | `@/lib/api/internal-api-url` |
| `@/lib/format-api-error` | `@/lib/api/format-api-error` |
| `@/lib/turnstile` | `@/lib/api/turnstile` |
| `@/lib/app-routes` | `@/lib/routing/app-routes` |
| `@/lib/slug` | `@/lib/routing/slug` |
| `@/lib/referral-ref` | `@/lib/routing/referral-ref` |
| `@/lib/site-config` | `@/lib/config/site-config` |
| `@/lib/landing-campaign-display` | `@/lib/marketing/landing-campaign-display` |
| `@/lib/mock-demo` | `@/lib/marketing/mock-demo` |
| `@/lib/utils` | `@/lib/utils/utils` |
| `@/lib/refetch-throttle` | `@/lib/utils/refetch-throttle` |

---

## Phase 3: Files Requiring Import Updates

### 3.1 Middleware
- `apps/web/middleware.ts`
  - `@/lib/auth-cookies` → `@/lib/auth/auth-cookies`

### 3.2 App Routes (API)
- `apps/web/app/api/twitter/status/route.ts`
  - `@/lib/nest-proxy-cookie-jwt` → `@/lib/auth/nest-proxy-cookie-jwt`
- `apps/web/app/api/twitter/disconnect/route.ts`
  - `@/lib/nest-proxy-cookie-jwt` → `@/lib/auth/nest-proxy-cookie-jwt`
- `apps/web/app/api/twitter/connect/route.ts`
  - `@/lib/nest-proxy-cookie-jwt` → `@/lib/auth/nest-proxy-cookie-jwt`
  - `@/lib/turnstile` → `@/lib/api/turnstile`
- `apps/web/app/api/leaderboard/route.ts`
  - `@/lib/internal-api-url` → `@/lib/api/internal-api-url`
- `apps/web/app/api/avatars/[userId]/route.ts`
  - `@/lib/internal-api-url` → `@/lib/api/internal-api-url`
- `apps/web/app/api/admin/wallet-invites/[id]/route.ts`
  - `@/lib/nest-proxy-admin-access` → `@/lib/auth/nest-proxy-admin-access`
- `apps/web/app/api/admin/wallet-invites/route.ts`
  - `@/lib/nest-proxy-admin-access` → `@/lib/auth/nest-proxy-admin-access`
- `apps/web/app/api/auth/verify-otp/route.ts`
  - `@/lib/auth-cookies` → `@/lib/auth/auth-cookies`
  - `@/lib/internal-api-url` → `@/lib/api/internal-api-url`
- `apps/web/app/api/admin/users/[userId]/route.ts`
  - `@/lib/nest-proxy-admin-access` → `@/lib/auth/nest-proxy-admin-access`
- `apps/web/app/api/admin/earn-hub/route.ts`
  - `@/lib/nest-proxy-admin-access` → `@/lib/auth/nest-proxy-admin-access`
- `apps/web/app/api/admin/users/route.ts`
  - `@/lib/nest-proxy-admin-access` → `@/lib/auth/nest-proxy-admin-access`
- `apps/web/app/api/party/username/route.ts`
  - `@/lib/nest-proxy-cookie-jwt` → `@/lib/auth/nest-proxy-cookie-jwt`
- `apps/web/app/api/auth/register/route.ts`
  - `@/lib/auth-cookies` → `@/lib/auth/auth-cookies`
  - `@/lib/internal-api-url` → `@/lib/api/internal-api-url`
  - `@/lib/turnstile` → `@/lib/api/turnstile`
- `apps/web/app/api/spin/history/route.ts`
  - `@/lib/nest-proxy-cookie-jwt` → `@/lib/auth/nest-proxy-cookie-jwt`
- `apps/web/app/api/admin/earn-hub/ensure/route.ts`
  - `@/lib/nest-proxy-admin-access` → `@/lib/auth/nest-proxy-admin-access`
- `apps/web/app/api/auth/refresh/route.ts`
  - `@/lib/auth-cookies` → `@/lib/auth/auth-cookies`
  - `@/lib/internal-api-url` → `@/lib/api/internal-api-url`
- `apps/web/app/api/spin/execute/route.ts`
  - `@/lib/nest-proxy-cookie-jwt` → `@/lib/auth/nest-proxy-cookie-jwt`
- `apps/web/app/api/spin/state/route.ts`
  - `@/lib/nest-proxy-cookie-jwt` → `@/lib/auth/nest-proxy-cookie-jwt`
- `apps/web/app/api/referral/route.ts`
  - `@/lib/nest-proxy-cookie-jwt` → `@/lib/auth/nest-proxy-cookie-jwt`
- `apps/web/app/api/party/wallet-access/route.ts`
  - `@/lib/nest-proxy-cookie-jwt` → `@/lib/auth/nest-proxy-cookie-jwt`
- `apps/web/app/api/auth/session/route.ts`
  - `@/lib/auth-cookies` → `@/lib/auth/auth-cookies`
  - `@/lib/nest-proxy-cookie-jwt` → `@/lib/auth/nest-proxy-cookie-jwt`
- `apps/web/app/api/spin/items/route.ts`
  - `@/lib/nest-proxy-cookie-jwt` → `@/lib/auth/nest-proxy-cookie-jwt`
- `apps/web/app/api/config/public/route.ts`
  - `@/lib/cc-reward-logo` → `@/lib/canton/cc-reward-logo`
- `apps/web/app/api/admin/uploads/quest-asset/route.ts`
  - `@/lib/auth-cookies` → `@/lib/auth/auth-cookies`
  - `@/lib/internal-api-url` → `@/lib/api/internal-api-url`
- `apps/web/app/api/admin/auth/logout/route.ts`
  - `@/lib/auth-cookies` → `@/lib/auth/auth-cookies`
- `apps/web/app/api/party/transactions/[id]/route.ts`
  - `@/lib/nest-proxy-cookie-jwt` → `@/lib/auth/nest-proxy-cookie-jwt`
- `apps/web/app/api/party/transactions/route.ts`
  - `@/lib/nest-proxy-cookie-jwt` → `@/lib/auth/nest-proxy-cookie-jwt`
- `apps/web/app/api/auth/logout/route.ts`
  - `@/lib/auth-cookies` → `@/lib/auth/auth-cookies`
- `apps/web/app/api/quests/[questId]/tasks/[taskId]/submit/route.ts`
  - `@/lib/nest-proxy-cookie-jwt` → `@/lib/auth/nest-proxy-cookie-jwt`
- `apps/web/app/api/admin/auth/login/route.ts`
  - `@/lib/auth-cookies` → `@/lib/auth/auth-cookies`
  - `@/lib/internal-api-url` → `@/lib/api/internal-api-url`
- `apps/web/app/api/party/send-cc/route.ts`
  - `@/lib/nest-proxy-cookie-jwt` → `@/lib/auth/nest-proxy-cookie-jwt`
- `apps/web/app/api/auth/login/route.ts`
  - `@/lib/auth-cookies` → `@/lib/auth/auth-cookies`
  - `@/lib/internal-api-url` → `@/lib/api/internal-api-url`
  - `@/lib/turnstile` → `@/lib/api/turnstile`
- `apps/web/app/api/admin/tasks/[taskId]/route.ts`
  - `@/lib/nest-proxy-admin-access` → `@/lib/auth/nest-proxy-admin-access`
- `apps/web/app/api/quests/[questId]/submit/route.ts`
  - `@/lib/nest-proxy-cookie-jwt` → `@/lib/auth/nest-proxy-cookie-jwt`
- `apps/web/app/api/quests/[questId]/route.ts`
  - `@/lib/nest-proxy-cookie-jwt` → `@/lib/auth/nest-proxy-cookie-jwt`
- `apps/web/app/api/party/preapproval-status/route.ts`
  - `@/lib/nest-proxy-cookie-jwt` → `@/lib/auth/nest-proxy-cookie-jwt`
- `apps/web/app/api/quests/[questId]/reward-status/route.ts`
  - `@/lib/nest-proxy-cookie-jwt` → `@/lib/auth/nest-proxy-cookie-jwt`
- `apps/web/app/api/party/claim-reward/route.ts`
  - `@/lib/nest-proxy-cookie-jwt` → `@/lib/auth/nest-proxy-cookie-jwt`
- `apps/web/app/api/party/allocate/route.ts`
  - `@/lib/nest-proxy-cookie-jwt` → `@/lib/auth/nest-proxy-cookie-jwt`
- `apps/web/app/api/quests/[questId]/progress/route.ts`
  - `@/lib/nest-proxy-cookie-jwt` → `@/lib/auth/nest-proxy-cookie-jwt`
- `apps/web/app/api/party/notifications/seen/route.ts`
  - `@/lib/nest-proxy-cookie-jwt` → `@/lib/auth/nest-proxy-cookie-jwt`
- `apps/web/app/api/party/notifications/route.ts`
  - `@/lib/nest-proxy-cookie-jwt` → `@/lib/auth/nest-proxy-cookie-jwt`
- `apps/web/app/api/party/canton-binding/route.ts`
  - `@/lib/nest-proxy-cookie-jwt` → `@/lib/auth/nest-proxy-cookie-jwt`
- `apps/web/app/api/admin/quests/[questId]/winners/route.ts`
  - `@/lib/nest-proxy-admin-access` → `@/lib/auth/nest-proxy-admin-access`
- `apps/web/app/api/me/route.ts`
  - `@/lib/nest-proxy-cookie-jwt` → `@/lib/auth/nest-proxy-cookie-jwt`
- `apps/web/app/api/quests/[questId]/claim-invite/route.ts`
  - `@/lib/nest-proxy-cookie-jwt` → `@/lib/auth/nest-proxy-cookie-jwt`
- `apps/web/app/api/party/balance/route.ts`
  - `@/lib/nest-proxy-cookie-jwt` → `@/lib/auth/nest-proxy-cookie-jwt`
- `apps/web/app/api/party/ledger-status/route.ts`
  - `@/lib/nest-proxy-cookie-jwt` → `@/lib/auth/nest-proxy-cookie-jwt`
- `apps/web/app/api/admin/quests/[questId]/tasks/route.ts`
  - `@/lib/nest-proxy-admin-access` → `@/lib/auth/nest-proxy-admin-access`
- `apps/web/app/api/admin/quests/[questId]/route.ts`
  - `@/lib/nest-proxy-admin-access` → `@/lib/auth/nest-proxy-admin-access`
- `apps/web/app/api/me/avatar/route.ts`
  - `@/lib/nest-proxy-cookie-jwt` → `@/lib/auth/nest-proxy-cookie-jwt`
- `apps/web/app/api/quests/[questId]/claim-fcfs/route.ts`
  - `@/lib/nest-proxy-cookie-jwt` → `@/lib/auth/nest-proxy-cookie-jwt`
- `apps/web/app/api/party/fee-config/route.ts`
  - `@/lib/nest-proxy-cookie-jwt` → `@/lib/auth/nest-proxy-cookie-jwt`
- `apps/web/app/api/quests/route.ts`
  - `@/lib/nest-proxy-cookie-jwt` → `@/lib/auth/nest-proxy-cookie-jwt`
- `apps/web/app/api/party/ensure-preapproval/route.ts`
  - `@/lib/nest-proxy-cookie-jwt` → `@/lib/auth/nest-proxy-cookie-jwt`
- `apps/web/app/api/admin/quests/[questId]/participants/route.ts`
  - `@/lib/nest-proxy-admin-access` → `@/lib/auth/nest-proxy-admin-access`
- `apps/web/app/api/quests/[questId]/claim-draw-cc/route.ts`
  - `@/lib/nest-proxy-cookie-jwt` → `@/lib/auth/nest-proxy-cookie-jwt`
- `apps/web/app/api/quests/leaderboard/route.ts`
  - `@/lib/nest-proxy-cookie-jwt` → `@/lib/auth/nest-proxy-cookie-jwt`
- `apps/web/app/api/quests/my-progress/route.ts`
  - `@/lib/nest-proxy-cookie-jwt` → `@/lib/auth/nest-proxy-cookie-jwt`
- `apps/web/app/api/quests/earn-hub/route.ts`
  - `@/lib/nest-proxy-cookie-jwt` → `@/lib/auth/nest-proxy-cookie-jwt`
- `apps/web/app/api/admin/quests/route.ts`
  - `@/lib/nest-proxy-admin-access` → `@/lib/auth/nest-proxy-admin-access`
- `apps/web/app/api/admin/quests/[questId]/invite-codes/route.ts`
  - `@/lib/nest-proxy-admin-access` → `@/lib/auth/nest-proxy-admin-access`
- `apps/web/app/api/admin/quests/[questId]/invite-codes/[codeId]/route.ts`
  - `@/lib/nest-proxy-admin-access` → `@/lib/auth/nest-proxy-admin-access`
- `apps/web/app/api/admin/quests/[questId]/distribute-rewards/route.ts`
  - `@/lib/nest-proxy-admin-access` → `@/lib/auth/nest-proxy-admin-access`
- `apps/web/app/api/admin/quests/[questId]/draw-winners/route.ts`
  - `@/lib/nest-proxy-admin-access` → `@/lib/auth/nest-proxy-admin-access`
- `apps/web/app/api/quests/dashboard-stats/route.ts`
  - `@/lib/nest-proxy-cookie-jwt` → `@/lib/auth/nest-proxy-cookie-jwt`
- `apps/web/app/api/admin/quests/[questId]/export/route.ts`
  - `@/lib/nest-proxy-admin-access` → `@/lib/auth/nest-proxy-admin-access`
- `apps/web/app/api/quests/activity/route.ts`
  - `@/lib/nest-proxy-cookie-jwt` → `@/lib/auth/nest-proxy-cookie-jwt`
- `apps/web/app/api/admin/stats/route.ts`
  - `@/lib/nest-proxy-admin-access` → `@/lib/auth/nest-proxy-admin-access`

### 3.3 App Routes (Pages)
- `apps/web/app/(auth)/register/page.tsx`
  - `@/lib/referral-ref` → `@/lib/routing/referral-ref`
  - `@/lib/format-api-error` → `@/lib/api/format-api-error`
  - `@/lib/utils` → `@/lib/utils/utils`
- `apps/web/app/(auth)/login/page.tsx`
  - `@/lib/format-api-error` → `@/lib/api/format-api-error`
  - `@/lib/utils` → `@/lib/utils/utils`
- `apps/web/app/(app)/layout.tsx`
  - `@/lib/auth-cookies` → `@/lib/auth/auth-cookies`
- `apps/web/app/(platform)/wallet/page.tsx`
  - `@/lib/wallet-session-cache` → `@/lib/auth/wallet-session-cache`
- `apps/web/app/(platform)/earn/[questId]/not-found.tsx`
  - `@/lib/app-routes` → `@/lib/routing/app-routes`
  - `@/lib/utils` → `@/lib/utils/utils`
- `apps/web/app/(platform)/earn/[questId]/page.tsx`
  - `@/lib/app-routes` → `@/lib/routing/app-routes`
  - `@/lib/auth-cookies` → `@/lib/auth/auth-cookies`
  - `@/lib/internal-api-url` → `@/lib/api/internal-api-url`
  - `@/lib/quest-media-url` → `@/lib/quest/quest-media-url`
  - `@/lib/slug` → `@/lib/routing/slug`
  - `@/lib/quest-types` → `@/lib/quest/quest-types`
  - `@/lib/ui-tokens` → `@/lib/ui/ui-tokens`
  - `@/lib/utils` → `@/lib/utils/utils`
- `apps/web/app/admin/login/page.tsx`
  - `@/lib/auth-cookies` → `@/lib/auth/auth-cookies`
- `apps/web/app/admin/(panel)/page.tsx`
  - `@/lib/auth-cookies` → `@/lib/auth/auth-cookies`
  - `@/lib/internal-api-url` → `@/lib/api/internal-api-url`
- `apps/web/app/admin/(panel)/layout.tsx`
  - `@/lib/auth-cookies` → `@/lib/auth/auth-cookies`
- `apps/web/app/admin/(panel)/earn/page.tsx`
  - `@/lib/utils` → `@/lib/utils/utils`
  - `@/lib/auth-cookies` → `@/lib/auth/auth-cookies`
  - `@/lib/internal-api-url` → `@/lib/api/internal-api-url`
- `apps/web/app/admin/(panel)/quest/page.tsx`
  - `@/lib/auth-cookies` → `@/lib/auth/auth-cookies`
  - `@/lib/internal-api-url` → `@/lib/api/internal-api-url`

### 3.4 Components - Auth
- `apps/web/components/auth/auth-card.tsx`
  - `@/lib/ui-tokens` → `@/lib/ui/ui-tokens`
  - `@/lib/utils` → `@/lib/utils/utils`

### 3.5 Components - App
- `apps/web/components/app/app-route-title.tsx`
  - `@/lib/app-routes` → `@/lib/routing/app-routes`
- `apps/web/components/app/campaign-fcfs-reward-card.tsx`
  - `@/lib/utils` → `@/lib/utils/utils`
- `apps/web/components/app/campaign-fcfs-claim.tsx`
  - `@/lib/campaign-reward` → `@/lib/canton/campaign-reward`
- `apps/web/components/app/campaign-draw-cc-claim.tsx`
  - `@/lib/campaign-reward` → `@/lib/canton/campaign-reward`
- `apps/web/components/app/app-shell.tsx`
  - `@/lib/app-routes` → `@/lib/routing/app-routes`
- `apps/web/components/app/campaign-quest-sidebar.tsx`
  - `@/lib/campaign-reward` → `@/lib/canton/campaign-reward`
  - `@/lib/cc-reward-logo` → `@/lib/canton/cc-reward-logo`
  - `@/lib/quest-types` → `@/lib/quest/quest-types`
  - `@/lib/utils` → `@/lib/utils/utils`
- `apps/web/components/app/campaign-invite-claim.tsx`
  - `@/lib/campaign-reward` → `@/lib/canton/campaign-reward`
- `apps/web/components/app/campaign-quest-status-card.tsx`
  - `@/lib/utils` → `@/lib/utils/utils`
- `apps/web/components/app/earn-campaign-card.tsx`
  - `@/lib/campaign-reward` → `@/lib/canton/campaign-reward`
  - `@/lib/app-routes` → `@/lib/routing/app-routes`
  - `@/lib/quest-types` → `@/lib/quest/quest-types`
  - `@/lib/utils` → `@/lib/utils/utils`
- `apps/web/components/app/dashboard-view.tsx`
  - `@/lib/utils` → `@/lib/utils/utils`
  - `@/lib/refetch-throttle` → `@/lib/utils/refetch-throttle`
  - `@/lib/wallet-session-cache` → `@/lib/auth/wallet-session-cache`
- `apps/web/components/app/copy-field.tsx`
  - `@/lib/ui-button-styles` → `@/lib/ui/ui-button-styles`
- `apps/web/components/app/earn-campaign-row.tsx`
  - `@/lib/app-routes` → `@/lib/routing/app-routes`
  - `@/lib/campaign-reward` → `@/lib/canton/campaign-reward`
  - `@/lib/quest-types` → `@/lib/quest/quest-types`
  - `@/lib/utils` → `@/lib/utils/utils`
- `apps/web/components/app/cc-reward-logo.tsx`
  - `@/lib/cc-reward-logo` → `@/lib/canton/cc-reward-logo`
  - `@/lib/utils` → `@/lib/utils/utils`
- `apps/web/components/app/campaign-social-links.tsx`
  - `@/lib/quest-social-links` → `@/lib/quest/quest-social-links`
  - `@/lib/utils` → `@/lib/utils/utils`
- `apps/web/components/app/earn-campaign-skeleton.tsx`
  - `@/lib/utils` → `@/lib/utils/utils`
- `apps/web/components/app/earn-hub-page.tsx`
  - `@/lib/app-routes` → `@/lib/routing/app-routes`
  - `@/lib/wallet-access` → `@/lib/auth/wallet-access`
  - `@/lib/quest-types` → `@/lib/quest/quest-types`
  - `@/lib/utils` → `@/lib/utils/utils`
- `apps/web/components/app/leaderboard-table.tsx`
  - `@/lib/ui-button-styles` → `@/lib/ui/ui-button-styles`
  - `@/lib/utils` → `@/lib/utils/utils`
- `apps/web/components/app/list-pagination.tsx`
  - `@/lib/ui-button-styles` → `@/lib/ui/ui-button-styles`
  - `@/lib/utils` → `@/lib/utils/utils`
- `apps/web/components/app/quest-card.tsx`
  - `@/lib/app-routes` → `@/lib/routing/app-routes`
  - `@/lib/quest-types` → `@/lib/quest/quest-types`
  - `@/lib/utils` → `@/lib/utils/utils`
- `apps/web/components/app/quest-referral-card.tsx`
  - `@/lib/utils` → `@/lib/utils/utils`
- `apps/web/components/app/quest-submit-section.tsx`
  - `@/lib/quest-types` → `@/lib/quest/quest-types`
  - `@/lib/campaign-reward` → `@/lib/canton/campaign-reward`
  - `@/lib/utils` → `@/lib/utils/utils`
- `apps/web/components/app/quest-task-panel.tsx`
  - `@/lib/quest-types` → `@/lib/quest/quest-types`
  - `@/lib/campaign-reward` → `@/lib/canton/campaign-reward`
  - `@/lib/utils` → `@/lib/utils/utils`
  - `@/lib/wallet-access` → `@/lib/auth/wallet-access`
- `apps/web/components/app/quests-browser.tsx`
  - `@/lib/quest-types` → `@/lib/quest/quest-types`
  - `@/lib/ui-button-styles` → `@/lib/ui/ui-button-styles`
  - `@/lib/ui-tokens` → `@/lib/ui/ui-tokens`
  - `@/lib/utils` → `@/lib/utils/utils`
  - `@/lib/app-routes` → `@/lib/routing/app-routes`
  - `@/lib/quest-media-url` → `@/lib/quest/quest-media-url`
- `apps/web/components/app/sign-out-button.tsx`
  - `@/lib/utils` → `@/lib/utils/utils`
  - `@/lib/wallet-session-cache` → `@/lib/auth/wallet-session-cache`
- `apps/web/components/app/settings/profile-avatar-section.tsx`
  - `@/lib/utils` → `@/lib/utils/utils`
  - `@/lib/format-api-error` → `@/lib/api/format-api-error`
- `apps/web/components/app/task-points-label.tsx`
  - `@/lib/utils` → `@/lib/utils/utils`
- `apps/web/components/app/settings/settings-account-panel.tsx`
  - `@/lib/canton-party-id` → `@/lib/canton/canton-party-id`
  - `@/lib/format-api-error` → `@/lib/api/format-api-error`
- `apps/web/components/app/transaction-detail-content.tsx`
  - `@/lib/utils` → `@/lib/utils/utils`
- `apps/web/components/app/settings/settings-twitter-panel.tsx`
  - `@/lib/format-api-error` → `@/lib/api/format-api-error`
  - `@/lib/utils` → `@/lib/utils/utils`
- `apps/web/components/app/transaction-detail-modal.tsx`
  - `@/lib/ui-button-styles` → `@/lib/ui/ui-button-styles`
- `apps/web/components/app/transactions-view.tsx`
  - `@/lib/utils` → `@/lib/utils/utils`
- `apps/web/components/app/wallet-actions.tsx`
  - `@/lib/ui-button-styles` → `@/lib/ui/ui-button-styles`
  - `@/lib/canton-party-id` → `@/lib/canton/canton-party-id`
  - `@/lib/utils` → `@/lib/utils/utils`
- `apps/web/components/app/wallet-create-prompt.tsx`
  - `@/lib/utils` → `@/lib/utils/utils`
- `apps/web/components/app/wallet-dashboard.tsx`
  - `@/lib/canton-party-id` → `@/lib/canton/canton-party-id`
  - `@/lib/wallet-session-cache` → `@/lib/auth/wallet-session-cache`
- `apps/web/components/app/wallet-preapproval-banner.tsx`
  - `@/lib/utils` → `@/lib/utils/utils`
  - `@/lib/format-api-error` → `@/lib/api/format-api-error`
- `apps/web/components/app/wallet-reconnect.tsx`
  - `@/lib/canton-party-id` → `@/lib/canton/canton-party-id`
  - `@/lib/utils` → `@/lib/utils/utils`
  - `@/lib/format-api-error` → `@/lib/api/format-api-error`
- `apps/web/components/app/wallet-setup.tsx`
  - `@/lib/canton-party-id` → `@/lib/canton/canton-party-id`
  - `@/lib/utils` → `@/lib/utils/utils`
  - `@/lib/ui-tokens` → `@/lib/ui/ui-tokens`
  - `@/lib/format-api-error` → `@/lib/api/format-api-error`

### 3.6 Components - Brand
- `apps/web/components/brand/canquest-logo.tsx`
  - `@/lib/utils` → `@/lib/utils/utils`

### 3.7 Components - Docs
- `apps/web/components/docs/docs-sidebar.tsx`
  - `@/lib/utils` → `@/lib/utils/utils`
- `apps/web/components/docs/docs-page-content.tsx`
  - `@/lib/app-routes` → `@/lib/routing/app-routes`
  - `@/lib/utils` → `@/lib/utils/utils`

### 3.8 Components - Cooperation
- `apps/web/components/cooperation/cooperation-sidebar.tsx`
  - `@/lib/utils` → `@/lib/utils/utils`
- `apps/web/components/cooperation/cooperation-page-content.tsx`
  - `@/lib/site-config` → `@/lib/config/site-config`
  - `@/lib/utils` → `@/lib/utils/utils`

### 3.9 Components - Landing
- `apps/web/components/landing/featured-campaigns.tsx`
  - `@/lib/quest-types` → `@/lib/quest/quest-types`
- `apps/web/components/landing/featured-quest-carousel-dynamic.tsx`
  - `@/lib/quest-types` → `@/lib/quest/quest-types`
- `apps/web/components/landing/landing-campaign-grid.tsx`
  - `@/lib/app-routes` → `@/lib/routing/app-routes`
  - `@/lib/landing-campaign-display` → `@/lib/marketing/landing-campaign-display`
  - `@/lib/quest-types` → `@/lib/quest/quest-types`
  - `@/lib/utils` → `@/lib/utils/utils`
- `apps/web/components/landing/hero.tsx`
  - `@/lib/utils` → `@/lib/utils/utils`
- `apps/web/components/landing/featured-quest-carousel.tsx`
  - `@/lib/quest-types` → `@/lib/quest/quest-types`
  - `@/lib/utils` → `@/lib/utils/utils`
- `apps/web/components/landing/landing-section.tsx`
  - `@/lib/utils` → `@/lib/utils/utils`
- `apps/web/components/landing/landing-quest-card.tsx`
  - `@/lib/app-routes` → `@/lib/routing/app-routes`
  - `@/lib/landing-campaign-display` → `@/lib/marketing/landing-campaign-display`
  - `@/lib/quest-types` → `@/lib/quest/quest-types`
  - `@/lib/utils` → `@/lib/utils/utils`
- `apps/web/components/landing/landing-shell.tsx`
  - `@/lib/utils` → `@/lib/utils/utils`
- `apps/web/components/landing/launch-app-button.tsx`
  - `@/lib/utils` → `@/lib/utils/utils`
- `apps/web/components/landing/section-header.tsx`
  - `@/lib/utils` → `@/lib/utils/utils`
- `apps/web/components/landing/site-header.tsx`
  - `@/lib/ui-button-styles` → `@/lib/ui/ui-button-styles`
  - `@/lib/utils` → `@/lib/utils/utils`
- `apps/web/components/landing/site-footer.tsx`
  - `@/lib/site-config` → `@/lib/config/site-config`

### 3.10 Components - Platform
- `apps/web/components/platform/auth-modal-opener.tsx`
  - `@/lib/referral-ref` → `@/lib/routing/referral-ref`
- `apps/web/components/platform/auth-modal.tsx`
  - `@/lib/format-api-error` → `@/lib/api/format-api-error`
  - `@/lib/referral-ref` → `@/lib/routing/referral-ref`
  - `@/lib/wallet-session-cache` → `@/lib/auth/wallet-session-cache`
  - `@/lib/ui-tokens` → `@/lib/ui/ui-tokens`
  - `@/lib/utils` → `@/lib/utils/utils`
- `apps/web/components/platform/platform-page.tsx`
  - `@/lib/utils` → `@/lib/utils/utils`
- `apps/web/components/platform/platform-route-title.tsx`
  - `@/lib/app-routes` → `@/lib/routing/app-routes`
- `apps/web/components/platform/wallet-required-gate.tsx`
  - `@/lib/utils` → `@/lib/utils/utils`
- `apps/web/components/platform/transaction-notifications.tsx`
  - `@/lib/ui-button-styles` → `@/lib/ui/ui-button-styles`
  - `@/lib/app-routes` → `@/lib/routing/app-routes`
  - `@/lib/utils` → `@/lib/utils/utils`
- `apps/web/components/platform/platform-toolbar.tsx`
  - `@/lib/ui-button-styles` → `@/lib/ui/ui-button-styles`
  - `@/lib/utils` → `@/lib/utils/utils`
- `apps/web/components/platform/platform-shell.tsx`
  - `@/lib/app-routes` → `@/lib/routing/app-routes`
  - `@/lib/wallet-access` → `@/lib/auth/wallet-access`
  - `@/lib/utils` → `@/lib/utils/utils`

### 3.11 Components - UI
- `apps/web/components/ui/button.tsx`
  - `@/lib/utils` → `@/lib/utils/utils`
- `apps/web/components/ui/input.tsx`
  - `@/lib/ui-tokens` → `@/lib/ui/ui-tokens`
  - `@/lib/utils` → `@/lib/utils/utils`
- `apps/web/components/ui/loading-spinner.tsx`
  - `@/lib/utils` → `@/lib/utils/utils`
- `apps/web/components/ui/password-input.tsx`
  - `@/lib/ui-tokens` → `@/lib/ui/ui-tokens`
  - `@/lib/utils` → `@/lib/utils/utils`
- `apps/web/components/ui/switch.tsx`
  - `@/lib/utils` → `@/lib/utils/utils`
- `apps/web/components/ui/typography.tsx`
  - `@/lib/utils` → `@/lib/utils/utils`

### 3.12 Components - Admin
- `apps/web/components/admin/admin-earn-hub-task-form.tsx`
  - `@/lib/quest-types` → `@/lib/quest/quest-types`
  - `@/lib/utils` → `@/lib/utils/utils`
- `apps/web/components/admin/admin-earn-hub-tasks-panel.tsx`
  - `@/lib/utils` → `@/lib/utils/utils`
  - `@/lib/quest-types` → `@/lib/quest/quest-types`
- `apps/web/components/admin/admin-login-form.tsx`
  - `@/lib/utils` → `@/lib/utils/utils`
- `apps/web/components/admin/admin-users-panel.tsx`
  - `@/lib/utils` → `@/lib/utils/utils`
  - `@/lib/ui-tokens` → `@/lib/ui/ui-tokens`
- `apps/web/components/admin/admin-wallet-invites-panel.tsx`
  - `@/lib/ui-tokens` → `@/lib/ui/ui-tokens`
  - `@/lib/utils` → `@/lib/utils/utils`
- `apps/web/components/admin/quest-detail.tsx`
  - `@/lib/ui-button-styles` → `@/lib/ui/ui-button-styles`
  - `@/lib/utils` → `@/lib/utils/utils`
  - `@/lib/quest-types` → `@/lib/quest/quest-types`
- `apps/web/components/admin/quest-form.tsx`
  - `@/lib/utils` → `@/lib/utils/utils`
  - `@/lib/quest-types` → `@/lib/quest/quest-types`
  - `@/lib/quest-social-links` → `@/lib/quest/quest-social-links`
- `apps/web/components/admin/quest-social-links-editor.tsx`
  - `@/lib/utils` → `@/lib/utils/utils`
  - `@/lib/quest-social-links` → `@/lib/quest/quest-social-links`
- `apps/web/components/admin/admin-nav.tsx`
  - `@/lib/utils` → `@/lib/utils/utils`
- `apps/web/components/admin/winners-panel.tsx`
  - `@/lib/ui-button-styles` → `@/lib/ui/ui-button-styles`
  - `@/lib/utils` → `@/lib/utils/utils`

### 3.13 Lib Internal References
- `apps/web/lib/app-routes.ts` → `apps/web/lib/routing/app-routes.ts`
  - `@/lib/slug` → `@/lib/routing/slug`
- `apps/web/lib/campaign-reward.ts` → `apps/web/lib/canton/campaign-reward.ts`
  - `@/lib/quest-types` → `@/lib/quest/quest-types`
- `apps/web/lib/cc-reward-logo.ts` → `apps/web/lib/canton/cc-reward-logo.ts`
  - `@/lib/quest-types` → `@/lib/quest/quest-types`
- `apps/web/lib/landing-campaign-display.ts` → `apps/web/lib/marketing/landing-campaign-display.ts`
  - `@/lib/campaign-reward` → `@/lib/canton/campaign-reward`
  - `@/lib/quest-types` → `@/lib/quest/quest-types`
- `apps/web/lib/nest-proxy-admin-access.ts` → `apps/web/lib/auth/nest-proxy-admin-access.ts`
  - `@/lib/auth-cookies` → `@/lib/auth/auth-cookies`
  - `@/lib/internal-api-url` → `@/lib/api/internal-api-url`
- `apps/web/lib/nest-proxy-cookie-jwt.ts` → `apps/web/lib/auth/nest-proxy-cookie-jwt.ts`
  - `@/lib/auth-cookies` → `@/lib/auth/auth-cookies`
  - `@/lib/internal-api-url` → `@/lib/api/internal-api-url`
- `apps/web/lib/quest-types.ts` → `apps/web/lib/quest/quest-types.ts`
  - `@/lib/campaign-reward` → `@/lib/canton/campaign-reward`
  - `@/lib/quest-social-links` → `@/lib/quest/quest-social-links`
- `apps/web/lib/ui-button-styles.ts` → `apps/web/lib/ui/ui-button-styles.ts`
  - `@/lib/utils` → `@/lib/utils/utils`
- `apps/web/lib/ui-tokens.ts` → `apps/web/lib/ui/ui-tokens.ts`
  - `@/lib/utils` → `@/lib/utils/utils`
- `apps/web/lib/hooks/use-wallet-access.ts`
  - `@/lib/wallet-access` → `@/lib/auth/wallet-access`
- `apps/web/lib/server/featured-quests.ts`
  - `@/lib/internal-api-url` → `@/lib/api/internal-api-url`
  - `@/lib/quest-types` → `@/lib/quest/quest-types`
  - `@/lib/quest-media-url` → `@/lib/quest/quest-media-url`
- `apps/web/lib/services/api/quests.ts`
  - `@/lib/quest-types` → `@/lib/quest/quest-types`

---

## Phase 4: Execution Order

To minimize breaking changes during migration, execute in this order:

1. **Create new folder structure** (empty folders)
2. **Move files** (all 24 files to new locations)
3. **Update imports in lib/ internal files first** (files that import other lib files)
4. **Update imports in components/** (alphabetically by subfolder)
5. **Update imports in app/ routes** (API routes first, then pages)
6. **Update middleware.ts**
7. **Run TypeScript compiler** to verify no broken imports
8. **Run tests** to verify functionality

---

## Phase 5: Verification Checklist

- [ ] All 24 files moved to correct locations
- [ ] All import paths updated (191 references)
- [ ] TypeScript compilation passes (`npm run build` or `tsc --noEmit`)
- [ ] No ESLint errors related to imports
- [ ] Application starts without errors
- [ ] All existing functionality works (login, quests, wallet, admin)
- [ ] No circular dependencies introduced

---

## Notes

- The `hooks/`, `i18n/`, `server/`, and `services/` folders remain unchanged
- Path alias `@/*` is used consistently throughout
- No logic changes - only file moves and import path updates
