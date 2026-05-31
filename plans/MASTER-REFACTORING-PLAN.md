# CanQuest Web Frontend - Master Refactoring Plan

## Executive Summary

This document consolidates the complete refactoring strategy for the `apps/web/` frontend application. The refactoring is divided into three sequential phases, each with its own detailed migration plan.

**Goal:** Transform a functional but disorganized codebase into a production-grade, modular structure without changing any business logic.

---

## Phase Overview

| Phase | Scope | Files Moved | Import Updates | Status |
|-------|-------|-------------|----------------|--------|
| **Phase 1** | `lib/` folder reorganization | 24 files | ~191 references | ✅ Planned |
| **Phase 2** | `components/` folder reorganization | 38 files | ~51 references | ✅ Planned |
| **Phase 3** | `app/` folder reorganization | 6 files | Minimal (URL-based) | ✅ Planned |

**Total Impact:** 68 files reorganized, ~242 import path updates

---

## Phase 1: Lib Folder Reorganization

### Objective
Reorganize 24 root-level utility files into 9 domain-specific subfolders.

### Target Structure
```
apps/web/lib/
├── auth/           # Authentication & session (5 files)
├── canton/         # Canton blockchain utilities (3 files)
├── quest/          # Quest types & media (3 files)
├── ui/             # UI styling & tokens (2 files)
├── api/            # API client helpers (3 files)
├── routing/        # Navigation & URLs (3 files)
├── config/         # App configuration (1 file)
├── marketing/      # Landing & campaigns (2 files)
├── utils/          # Generic utilities (2 files)
├── hooks/          # [UNCHANGED] React hooks
├── i18n/           # [UNCHANGED] Internationalization
├── server/         # [UNCHANGED] Server utilities
└── services/       # [UNCHANGED] API service layer
```

### Detailed Plan
See: [`plans/lib-reorganization-migration.md`](./lib-reorganization-migration.md)

### Key Import Path Changes
| Old Path | New Path |
|----------|----------|
| `@/lib/auth-cookies` | `@/lib/auth/auth-cookies` |
| `@/lib/wallet-access` | `@/lib/auth/wallet-access` |
| `@/lib/quest-types` | `@/lib/quest/quest-types` |
| `@/lib/utils` | `@/lib/utils/utils` |
| `@/lib/app-routes` | `@/lib/routing/app-routes` |
| ... and 19 more |

---

## Phase 2: Components Folder Reorganization

### Objective
Split the large `app/` components folder (35 files) into 7 domain-specific subfolders, merge `brand/` into `ui/`, and consolidate provider files.

### Target Structure
```
apps/web/components/
├── admin/          # [UNCHANGED] Admin panel (12 files)
├── app/
│   ├── shell/      # App shell & navigation (3 files)
│   ├── campaign/   # Campaign & rewards (8 files)
│   ├── quest/      # Quest components (7 files)
│   ├── wallet/     # Wallet & transactions (11 files)
│   ├── earn/       # Earn hub & cards (6 files)
│   ├── dashboard/  # Dashboard views (1 file)
│   ├── list/       # List components (1 file)
│   └── settings/   # [UNCHANGED] Settings panels (3 files)
├── auth/           # [UNCHANGED] Auth components (1 file)
├── cooperation/    # [UNCHANGED] Cooperation pages (3 files)
├── docs/           # [UNCHANGED] Documentation (3 files)
├── landing/        # [UNCHANGED] Landing sections (16 files)
├── platform/       # [UNCHANGED] Platform shell (11 files)
├── providers/      # [CONSOLIDATED] All providers (3 files)
└── ui/             # [EXPANDED] UI primitives + brand (7 files)
```

### Detailed Plan
See: [`plans/components-reorganization-migration.md`](./components-reorganization-migration.md)

### Key Import Path Changes
| Old Path | New Path |
|----------|----------|
| `@/components/app/app-shell` | `@/components/app/shell/app-shell` |
| `@/components/app/campaign-*` | `@/components/app/campaign/campaign-*` |
| `@/components/app/wallet-*` | `@/components/app/wallet/wallet-*` |
| `@/components/brand/canquest-logo` | `@/components/ui/canquest-logo` |
| `@/components/providers` | `@/components/providers/providers` |
| ... and 35 more |

---

## Phase 3: App Folder Reorganization

### Objective
Improve naming consistency across route groups and consolidate spin routes. The `(app)/` and `(platform)/` groups serve different purposes and are both retained.

### Changes Summary
| Change Type | Old Path | New Path |
|-------------|----------|----------|
| Rename | `(app)/quest/` | `(app)/quests/` |
| Rename | `(platform)/quest/` | `(platform)/quests/` |
| Rename | `(platform)/setting/` | `(platform)/settings/` |
| Consolidate | `(platform)/spin-daily/` | `(platform)/spin/daily/` |
| Consolidate | `(platform)/spin-reward/` | `(platform)/spin/reward/` |
| Consolidate | `admin/(panel)/quest/` | `admin/(panel)/quests/` |

### Detailed Plan
See: [`plans/app-reorganization-migration.md`](./app-reorganization-migration.md)

### URL Changes
| Old URL | New URL |
|---------|---------|
| `/quest` | `/quests` |
| `/setting` | `/settings` |
| `/spin-daily` | `/spin/daily` |
| `/spin-reward` | `/spin/reward` |

---

## Execution Strategy

### Recommended Order
1. **Phase 1 (lib/)** - Execute first as it has the most import updates
2. **Phase 2 (components/)** - Execute second, builds on lib/ changes
3. **Phase 3 (app/)** - Execute last, minimal import changes

### Per-Phase Workflow
For each phase:
1. Create new folder structure (empty folders)
2. Move files to new locations
3. Update import paths in affected files
4. Run TypeScript compiler (`npm run build` or `tsc --noEmit`)
5. Run tests to verify functionality
6. Delete empty old folders
7. Commit changes with descriptive message

### Verification After Each Phase
- [ ] TypeScript compilation passes
- [ ] No ESLint import errors
- [ ] Application starts without errors
- [ ] All existing functionality works
- [ ] No circular dependencies introduced

---

## Risk Mitigation

### Low-Risk Changes
- File moves within same folder (no import changes)
- Renaming empty folders
- Creating new folder structure

### Medium-Risk Changes
- Import path updates (191 in lib/, 51 in components/)
- URL route changes (may affect bookmarks)

### Mitigation Strategies
1. **Execute in small batches** - Commit after each subfolder migration
2. **Use TypeScript compiler** - Catch broken imports immediately
3. **Test critical paths** - Login, quest submission, wallet operations
4. **Consider redirects** - For renamed URLs if SEO is a concern

---

## Success Criteria

The refactoring is complete when:
- [ ] All 68 files are in their new locations
- [ ] All ~242 import paths are updated correctly
- [ ] TypeScript compilation passes with zero errors
- [ ] Application runs without runtime errors
- [ ] All existing features work as before (zero logic changes)
- [ ] Code is more navigable and maintainable

---

## Appendix: File Inventory

### Phase 1: Lib Files (24 total)
**auth/** (5): auth-cookies, wallet-access, wallet-session-cache, nest-proxy-cookie-jwt, nest-proxy-admin-access  
**canton/** (3): canton-party-id, cc-reward-logo, campaign-reward  
**quest/** (3): quest-types, quest-media-url, quest-social-links  
**ui/** (2): ui-button-styles, ui-tokens  
**api/** (3): internal-api-url, format-api-error, turnstile  
**routing/** (3): app-routes, slug, referral-ref  
**config/** (1): site-config  
**marketing/** (2): landing-campaign-display, mock-demo  
**utils/** (2): utils, refetch-throttle

### Phase 2: Component Files (38 total)
**app/shell/** (3): app-route-title, app-shell, sign-out-button  
**app/campaign/** (8): campaign-draw-cc-claim, campaign-fcfs-claim, campaign-fcfs-reward-card, campaign-invite-claim, campaign-quest-sidebar, campaign-quest-status-card, campaign-social-links, cc-reward-logo  
**app/quest/** (7): quest-card, quest-referral-card, quest-submit-section, quest-task-panel, quests-browser, task-points-label, demo-banner  
**app/wallet/** (11): wallet-actions, wallet-create-prompt, wallet-dashboard, wallet-preapproval-banner, wallet-reconnect, wallet-setup, transaction-detail-content, transaction-detail-modal, transaction-detail-view, transactions-view, copy-field  
**app/earn/** (6): earn-campaign-card, earn-campaign-row, earn-campaign-skeleton, earn-campaigns-page, earn-hub-page, leaderboard-table  
**app/dashboard/** (1): dashboard-view  
**app/list/** (1): list-pagination  
**ui/** (+1): canquest-logo (from brand/)  
**providers/** (+2): providers, theme-init-script (from root)

### Phase 3: App Routes (6 total)
- (app)/quest/ → (app)/quests/
- (platform)/quest/ → (platform)/quests/
- (platform)/setting/ → (platform)/settings/
- (platform)/spin-daily/ → (platform)/spin/daily/
- (platform)/spin-reward/ → (platform)/spin/reward/
- admin/(panel)/quest/ → admin/(panel)/quests/ (consolidate)

---

## Next Steps

1. **Review this plan** - Ensure all stakeholders approve the proposed changes
2. **Create feature branch** - `git checkout -b refactor/codebase-cleanup`
3. **Execute Phase 1** - Follow `lib-reorganization-migration.md`
4. **Execute Phase 2** - Follow `components-reorganization-migration.md`
5. **Execute Phase 3** - Follow `app-reorganization-migration.md`
6. **Final verification** - Run full test suite and manual QA
7. **Merge to main** - After approval

---

*Document generated: 2026-05-31*  
*Project: CanQuest Web Frontend*  
*Status: Ready for Implementation*
