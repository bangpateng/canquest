# Components Folder Reorganization - Migration Plan

## Overview
This document details the migration plan for reorganizing `apps/web/components/`. The large `app/` folder (35 files) is split into 7 domain-specific subfolders, `brand/` is merged into `ui/`, and root-level provider files are consolidated.

**Total files to move:** 38  
**Total import updates needed:** ~51 references across the codebase

---

## Phase 1: File Moves

### 1.1 Shell (`components/app/shell/`)
| Old Path | New Path |
|----------|----------|
| `components/app/app-route-title.tsx` | `components/app/shell/app-route-title.tsx` |
| `components/app/app-shell.tsx` | `components/app/shell/app-shell.tsx` |
| `components/app/sign-out-button.tsx` | `components/app/shell/sign-out-button.tsx` |

### 1.2 Campaign (`components/app/campaign/`)
| Old Path | New Path |
|----------|----------|
| `components/app/campaign-draw-cc-claim.tsx` | `components/app/campaign/campaign-draw-cc-claim.tsx` |
| `components/app/campaign-fcfs-claim.tsx` | `components/app/campaign/campaign-fcfs-claim.tsx` |
| `components/app/campaign-fcfs-reward-card.tsx` | `components/app/campaign/campaign-fcfs-reward-card.tsx` |
| `components/app/campaign-invite-claim.tsx` | `components/app/campaign/campaign-invite-claim.tsx` |
| `components/app/campaign-quest-sidebar.tsx` | `components/app/campaign/campaign-quest-sidebar.tsx` |
| `components/app/campaign-quest-status-card.tsx` | `components/app/campaign/campaign-quest-status-card.tsx` |
| `components/app/campaign-social-links.tsx` | `components/app/campaign/campaign-social-links.tsx` |
| `components/app/cc-reward-logo.tsx` | `components/app/campaign/cc-reward-logo.tsx` |

### 1.3 Quest (`components/app/quest/`)
| Old Path | New Path |
|----------|----------|
| `components/app/quest-card.tsx` | `components/app/quest/quest-card.tsx` |
| `components/app/quest-referral-card.tsx` | `components/app/quest/quest-referral-card.tsx` |
| `components/app/quest-submit-section.tsx` | `components/app/quest/quest-submit-section.tsx` |
| `components/app/quest-task-panel.tsx` | `components/app/quest/quest-task-panel.tsx` |
| `components/app/quests-browser.tsx` | `components/app/quest/quests-browser.tsx` |
| `components/app/task-points-label.tsx` | `components/app/quest/task-points-label.tsx` |
| `components/app/demo-banner.tsx` | `components/app/quest/demo-banner.tsx` |

### 1.4 Wallet (`components/app/wallet/`)
| Old Path | New Path |
|----------|----------|
| `components/app/wallet-actions.tsx` | `components/app/wallet/wallet-actions.tsx` |
| `components/app/wallet-create-prompt.tsx` | `components/app/wallet/wallet-create-prompt.tsx` |
| `components/app/wallet-dashboard.tsx` | `components/app/wallet/wallet-dashboard.tsx` |
| `components/app/wallet-preapproval-banner.tsx` | `components/app/wallet/wallet-preapproval-banner.tsx` |
| `components/app/wallet-reconnect.tsx` | `components/app/wallet/wallet-reconnect.tsx` |
| `components/app/wallet-setup.tsx` | `components/app/wallet/wallet-setup.tsx` |
| `components/app/transaction-detail-content.tsx` | `components/app/wallet/transaction-detail-content.tsx` |
| `components/app/transaction-detail-modal.tsx` | `components/app/wallet/transaction-detail-modal.tsx` |
| `components/app/transaction-detail-view.tsx` | `components/app/wallet/transaction-detail-view.tsx` |
| `components/app/transactions-view.tsx` | `components/app/wallet/transactions-view.tsx` |
| `components/app/copy-field.tsx` | `components/app/wallet/copy-field.tsx` |

### 1.5 Earn (`components/app/earn/`)
| Old Path | New Path |
|----------|----------|
| `components/app/earn-campaign-card.tsx` | `components/app/earn/earn-campaign-card.tsx` |
| `components/app/earn-campaign-row.tsx` | `components/app/earn/earn-campaign-row.tsx` |
| `components/app/earn-campaign-skeleton.tsx` | `components/app/earn/earn-campaign-skeleton.tsx` |
| `components/app/earn-campaigns-page.tsx` | `components/app/earn/earn-campaigns-page.tsx` |
| `components/app/earn-hub-page.tsx` | `components/app/earn/earn-hub-page.tsx` |
| `components/app/leaderboard-table.tsx` | `components/app/earn/leaderboard-table.tsx` |

### 1.6 Dashboard (`components/app/dashboard/`)
| Old Path | New Path |
|----------|----------|
| `components/app/dashboard-view.tsx` | `components/app/dashboard/dashboard-view.tsx` |

### 1.7 List (`components/app/list/`)
| Old Path | New Path |
|----------|----------|
| `components/app/list-pagination.tsx` | `components/app/list/list-pagination.tsx` |

### 1.8 Settings (unchanged location)
| Old Path | New Path |
|----------|----------|
| `components/app/settings/profile-avatar-section.tsx` | `components/app/settings/profile-avatar-section.tsx` |
| `components/app/settings/settings-account-panel.tsx` | `components/app/settings/settings-account-panel.tsx` |
| `components/app/settings/settings-twitter-panel.tsx` | `components/app/settings/settings-twitter-panel.tsx` |

### 1.9 Brand → UI Merge
| Old Path | New Path |
|----------|----------|
| `components/brand/canquest-logo.tsx` | `components/ui/canquest-logo.tsx` |

### 1.10 Providers Consolidation
| Old Path | New Path |
|----------|----------|
| `components/providers.tsx` | `components/providers/providers.tsx` |
| `components/theme-init-script.tsx` | `components/providers/theme-init-script.tsx` |

---

## Phase 2: Import Path Updates

### Import Path Mapping Table

| Old Import Path | New Import Path |
|-----------------|-----------------|
| `@/components/app/app-route-title` | `@/components/app/shell/app-route-title` |
| `@/components/app/app-shell` | `@/components/app/shell/app-shell` |
| `@/components/app/sign-out-button` | `@/components/app/shell/sign-out-button` |
| `@/components/app/campaign-draw-cc-claim` | `@/components/app/campaign/campaign-draw-cc-claim` |
| `@/components/app/campaign-fcfs-claim` | `@/components/app/campaign/campaign-fcfs-claim` |
| `@/components/app/campaign-fcfs-reward-card` | `@/components/app/campaign/campaign-fcfs-reward-card` |
| `@/components/app/campaign-invite-claim` | `@/components/app/campaign/campaign-invite-claim` |
| `@/components/app/campaign-quest-sidebar` | `@/components/app/campaign/campaign-quest-sidebar` |
| `@/components/app/campaign-quest-status-card` | `@/components/app/campaign/campaign-quest-status-card` |
| `@/components/app/campaign-social-links` | `@/components/app/campaign/campaign-social-links` |
| `@/components/app/cc-reward-logo` | `@/components/app/campaign/cc-reward-logo` |
| `@/components/app/quest-card` | `@/components/app/quest/quest-card` |
| `@/components/app/quest-referral-card` | `@/components/app/quest/quest-referral-card` |
| `@/components/app/quest-submit-section` | `@/components/app/quest/quest-submit-section` |
| `@/components/app/quest-task-panel` | `@/components/app/quest/quest-task-panel` |
| `@/components/app/quests-browser` | `@/components/app/quest/quests-browser` |
| `@/components/app/task-points-label` | `@/components/app/quest/task-points-label` |
| `@/components/app/demo-banner` | `@/components/app/quest/demo-banner` |
| `@/components/app/wallet-actions` | `@/components/app/wallet/wallet-actions` |
| `@/components/app/wallet-create-prompt` | `@/components/app/wallet/wallet-create-prompt` |
| `@/components/app/wallet-dashboard` | `@/components/app/wallet/wallet-dashboard` |
| `@/components/app/wallet-preapproval-banner` | `@/components/app/wallet/wallet-preapproval-banner` |
| `@/components/app/wallet-reconnect` | `@/components/app/wallet/wallet-reconnect` |
| `@/components/app/wallet-setup` | `@/components/app/wallet/wallet-setup` |
| `@/components/app/transaction-detail-content` | `@/components/app/wallet/transaction-detail-content` |
| `@/components/app/transaction-detail-modal` | `@/components/app/wallet/transaction-detail-modal` |
| `@/components/app/transaction-detail-view` | `@/components/app/wallet/transaction-detail-view` |
| `@/components/app/transactions-view` | `@/components/app/wallet/transactions-view` |
| `@/components/app/copy-field` | `@/components/app/wallet/copy-field` |
| `@/components/app/earn-campaign-card` | `@/components/app/earn/earn-campaign-card` |
| `@/components/app/earn-campaign-row` | `@/components/app/earn/earn-campaign-row` |
| `@/components/app/earn-campaign-skeleton` | `@/components/app/earn/earn-campaign-skeleton` |
| `@/components/app/earn-campaigns-page` | `@/components/app/earn/earn-campaigns-page` |
| `@/components/app/earn-hub-page` | `@/components/app/earn/earn-hub-page` |
| `@/components/app/leaderboard-table` | `@/components/app/earn/leaderboard-table` |
| `@/components/app/dashboard-view` | `@/components/app/dashboard/dashboard-view` |
| `@/components/app/list-pagination` | `@/components/app/list/list-pagination` |
| `@/components/brand/canquest-logo` | `@/components/ui/canquest-logo` |
| `@/components/providers` | `@/components/providers/providers` |
| `@/components/theme-init-script` | `@/components/providers/theme-init-script` |

---

## Phase 3: Files Requiring Import Updates

### 3.1 App Routes (Pages)
- `apps/web/app/layout.tsx`
  - `@/components/providers` → `@/components/providers/providers`
  - `@/components/theme-init-script` → `@/components/providers/theme-init-script`
- `apps/web/app/(app)/layout.tsx`
  - `@/components/app/app-shell` → `@/components/app/shell/app-shell`
- `apps/web/app/(app)/dashboard/page.tsx`
  - `@/components/app/dashboard-view` → `@/components/app/dashboard/dashboard-view`
- `apps/web/app/(app)/settings/page.tsx`
  - `@/components/app/sign-out-button` → `@/components/app/shell/sign-out-button`
- `apps/web/app/(app)/transactions/[id]/page.tsx`
  - `@/components/app/transaction-detail-view` → `@/components/app/wallet/transaction-detail-view`
- `apps/web/app/(app)/transactions/page.tsx`
  - `@/components/app/transactions-view` → `@/components/app/wallet/transactions-view`
- `apps/web/app/(platform)/wallet/page.tsx`
  - `@/components/app/wallet-setup` → `@/components/app/wallet/wallet-setup`
  - `@/components/app/wallet-dashboard` → `@/components/app/wallet/wallet-dashboard`
  - `@/components/app/wallet-reconnect` → `@/components/app/wallet/wallet-reconnect`
- `apps/web/app/(platform)/overview/page.tsx`
  - `@/components/app/dashboard-view` → `@/components/app/dashboard/dashboard-view`
- `apps/web/app/(platform)/leaderboard/page.tsx`
  - `@/components/app/leaderboard-table` → `@/components/app/earn/leaderboard-table`
- `apps/web/app/(platform)/quest/page.tsx`
  - `@/components/app/earn-hub-page` → `@/components/app/earn/earn-hub-page`
- `apps/web/app/(platform)/earn/page.tsx`
  - `@/components/app/earn-campaigns-page` → `@/components/app/earn/earn-campaigns-page`
- `apps/web/app/(platform)/earn/[questId]/page.tsx`
  - `@/components/app/campaign-social-links` → `@/components/app/campaign/campaign-social-links`
  - `@/components/app/quest-task-panel` → `@/components/app/quest/quest-task-panel`
  - `@/components/app/campaign-quest-sidebar` → `@/components/app/campaign/campaign-quest-sidebar`

### 3.2 Lib Hooks
- `apps/web/lib/hooks/use-transaction-detail.ts`
  - `@/components/app/transaction-detail-view` → `@/components/app/wallet/transaction-detail-view`

### 3.3 Components - Platform
- `apps/web/components/platform/setting-page-content.tsx`
  - `@/components/app/sign-out-button` → `@/components/app/shell/sign-out-button`
- `apps/web/components/platform/platform-shell.tsx`
  - `@/components/brand/canquest-logo` → `@/components/ui/canquest-logo`

### 3.4 Components - Landing
- `apps/web/components/landing/landing-quest-card.tsx`
  - `@/components/app/campaign-social-links` → `@/components/app/campaign/campaign-social-links`
- `apps/web/components/landing/canton-section.tsx`
  - `@/components/app/cc-reward-logo` → `@/components/app/campaign/cc-reward-logo`
- `apps/web/components/landing/landing-campaign-grid.tsx`
  - `@/components/app/campaign-social-links` → `@/components/app/campaign/campaign-social-links`
- `apps/web/components/landing/site-footer.tsx`
  - `@/components/brand/canquest-logo` → `@/components/ui/canquest-logo`
- `apps/web/components/landing/site-header.tsx`
  - `@/components/brand/canquest-logo` → `@/components/ui/canquest-logo`

### 3.5 Components - App Internal Cross-References

#### Shell
- `components/app/shell/app-shell.tsx` (was `app-shell.tsx`)
  - `@/components/app/app-route-title` → `@/components/app/shell/app-route-title`

#### Campaign
- `components/app/campaign/campaign-draw-cc-claim.tsx`
  - `@/components/app/campaign-fcfs-reward-card` → `@/components/app/campaign/campaign-fcfs-reward-card`
- `components/app/campaign/campaign-invite-claim.tsx`
  - `@/components/app/campaign-fcfs-reward-card` → `@/components/app/campaign/campaign-fcfs-reward-card`
- `components/app/campaign/campaign-fcfs-claim.tsx`
  - `@/components/app/campaign-fcfs-reward-card` → `@/components/app/campaign/campaign-fcfs-reward-card`
- `components/app/campaign/campaign-fcfs-reward-card.tsx`
  - `@/components/app/cc-reward-logo` → `@/components/app/campaign/cc-reward-logo`
- `components/app/campaign/campaign-quest-sidebar.tsx`
  - `@/components/app/cc-reward-logo` → `@/components/app/campaign/cc-reward-logo`

#### Quest
- `components/app/quest/quest-submit-section.tsx`
  - `@/components/app/campaign-fcfs-reward-card` → `@/components/app/campaign/campaign-fcfs-reward-card`
  - `@/components/app/campaign-quest-status-card` → `@/components/app/campaign/campaign-quest-status-card`
  - `@/components/app/cc-reward-logo` → `@/components/app/campaign/cc-reward-logo`
- `components/app/quest/quest-card.tsx`
  - `@/components/app/earn-campaign-card` → `@/components/app/earn/earn-campaign-card`
- `components/app/quest/quests-browser.tsx`
  - `@/components/app/earn-campaign-skeleton` → `@/components/app/earn/earn-campaign-skeleton`
  - `@/components/app/earn-campaign-card` → `@/components/app/earn/earn-campaign-card`
  - `@/components/app/quest-card` → `@/components/app/quest/quest-card`
  - `@/components/app/list-pagination` → `@/components/app/list/list-pagination`
- `components/app/quest/quest-task-panel.tsx`
  - `@/components/app/campaign-fcfs-claim` → `@/components/app/campaign/campaign-fcfs-claim`
  - `@/components/app/campaign-draw-cc-claim` → `@/components/app/campaign/campaign-draw-cc-claim`
  - `@/components/app/task-points-label` → `@/components/app/quest/task-points-label`
  - `@/components/app/campaign-invite-claim` → `@/components/app/campaign/campaign-invite-claim`
  - `@/components/app/quest-submit-section` → `@/components/app/quest/quest-submit-section`
  - `@/components/app/wallet-create-prompt` → `@/components/app/wallet/wallet-create-prompt`

#### Wallet
- `components/app/wallet/wallet-actions.tsx`
  - `@/components/app/copy-field` → `@/components/app/wallet/copy-field`
  - `@/components/app/transaction-detail-modal` → `@/components/app/wallet/transaction-detail-modal`
- `components/app/wallet/wallet-dashboard.tsx`
  - `@/components/app/copy-field` → `@/components/app/wallet/copy-field`
  - `@/components/app/wallet-actions` → `@/components/app/wallet/wallet-actions`
  - `@/components/app/wallet-preapproval-banner` → `@/components/app/wallet/wallet-preapproval-banner`
  - `@/components/app/transactions-view` → `@/components/app/wallet/transactions-view`
- `components/app/wallet/transaction-detail-modal.tsx`
  - `@/components/app/transaction-detail-content` → `@/components/app/wallet/transaction-detail-content`
- `components/app/wallet/transaction-detail-content.tsx`
  - `@/components/app/transaction-detail-view` → `@/components/app/wallet/transaction-detail-view`
- `components/app/wallet/transaction-detail-view.tsx`
  - `@/components/app/transaction-detail-content` → `@/components/app/wallet/transaction-detail-content`
- `components/app/wallet/transactions-view.tsx`
  - `@/components/app/list-pagination` → `@/components/app/list/list-pagination`

#### Earn
- `components/app/earn/earn-campaign-card.tsx`
  - `@/components/app/cc-reward-logo` → `@/components/app/campaign/cc-reward-logo`
- `components/app/earn/earn-campaigns-page.tsx`
  - `@/components/app/quests-browser` → `@/components/app/quest/quests-browser`
- `components/app/earn/earn-hub-page.tsx`
  - `@/components/app/quest-referral-card` → `@/components/app/quest/quest-referral-card`
  - `@/components/app/quest-task-panel` → `@/components/app/quest/quest-task-panel`
- `components/app/earn/leaderboard-table.tsx`
  - `@/components/app/list-pagination` → `@/components/app/list/list-pagination`

#### Dashboard
- `components/app/dashboard/dashboard-view.tsx`
  - `@/components/app/list-pagination` → `@/components/app/list/list-pagination`

### 3.6 Components - Providers Internal
- `components/providers/providers.tsx` (was `providers.tsx`)
  - `@/components/providers/theme-provider` → unchanged (already in providers/)
- `components/providers/theme-init-script.tsx` (was `theme-init-script.tsx`)
  - `@/components/providers/theme-provider` → unchanged (already in providers/)

### 3.7 Components - Brand → UI Internal
- `components/ui/canquest-logo.tsx` (was `brand/canquest-logo.tsx`)
  - `@/components/providers/theme-provider` → unchanged

---

## Phase 4: Execution Order

To minimize breaking changes during migration, execute in this order:

1. **Create new subfolder structure** inside `components/app/` (shell, campaign, quest, wallet, earn, dashboard, list)
2. **Move files** into new subfolders
3. **Move `brand/canquest-logo.tsx`** to `ui/canquest-logo.tsx`
4. **Move root provider files** into `providers/` folder
5. **Update internal cross-references** within `components/app/` subfolders first
6. **Update imports in `components/landing/`** and `components/platform/`
7. **Update imports in `lib/hooks/`**
8. **Update imports in `app/` routes** (pages and layouts)
9. **Update `app/layout.tsx`** for provider imports
10. **Run TypeScript compiler** to verify no broken imports
11. **Run tests** to verify functionality
12. **Delete empty `brand/` folder**

---

## Phase 5: Verification Checklist

- [ ] All 38 files moved to correct locations
- [ ] All import paths updated (~51 references)
- [ ] TypeScript compilation passes (`npm run build` or `tsc --noEmit`)
- [ ] No ESLint errors related to imports
- [ ] Application starts without errors
- [ ] All existing functionality works (login, quests, wallet, admin, landing)
- [ ] Empty `brand/` folder removed
- [ ] No circular dependencies introduced

---

## Notes

- The `admin/`, `auth/`, `cooperation/`, `docs/`, `landing/`, `platform/`, and `ui/` folders remain structurally unchanged
- `settings/` subfolder inside `app/` stays at the same location
- Path alias `@/*` is used consistently throughout
- No logic changes - only file moves and import path updates
- This plan is designed to be executed AFTER the `lib/` reorganization is complete
