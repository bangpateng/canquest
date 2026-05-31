# App Folder Reorganization - Migration Plan

## Overview
This document details the reorganization of `apps/web/app/`. The `(app)/` and `(platform)/` route groups serve different purposes with different layouts and are both retained. Changes focus on naming consistency and spin route consolidation.

**Total files to move/rename:** 6  
**Total import updates needed:** Minimal (route-based, not import-based)

---

## Phase 1: Naming Consistency Changes

### 1.1 Pluralize Route Segments
| Old Path | New Path | Rationale |
|----------|----------|-----------|
| `app/(app)/quest/` | `app/(app)/quests/` | Plural for consistency with other routes |
| `app/(platform)/quest/` | `app/(platform)/quests/` | Plural for consistency |
| `app/(platform)/setting/` | `app/(platform)/settings/` | Plural for consistency with `(app)/settings/` |
| `app/admin/(panel)/quest/` | `app/admin/(panel)/quests/` | Plural for consistency (note: `quests/` already exists here) |

### 1.2 Consolidate Spin Routes
| Old Path | New Path | Rationale |
|----------|----------|-----------|
| `app/(platform)/spin-daily/page.tsx` | `app/(platform)/spin/daily/page.tsx` | Group under `spin/` parent |
| `app/(platform)/spin-reward/page.tsx` | `app/(platform)/spin/reward/page.tsx` | Group under `spin/` parent |

---

## Phase 2: URL Impact Analysis

### Routes That Change
| Old URL | New URL |
|---------|---------|
| `/quest` | `/quests` |
| `/quest/[id]` | `/quests/[id]` |
| `/setting` | `/settings` |
| `/spin-daily` | `/spin/daily` |
| `/spin-reward` | `/spin/reward` |

### Routes That Stay the Same
- All `(marketing)/` routes
- All `(auth)/` routes
- All `admin/` routes (except `quest/` → `quests/` consolidation)
- All `api/` routes
- `/dashboard`, `/earn`, `/leaderboard`, `/transactions`, `/wallet`

---

## Phase 3: Files Requiring Updates

### 3.1 Navigation Links (ROUTES constant)
- `apps/web/lib/routing/app-routes.ts` (after lib reorganization)
  - Update route paths for quest, setting, spin-daily, spin-reward

### 3.2 Redirect/Link References
Search for hardcoded links to:
- `/quest` → `/quests`
- `/setting` → `/settings`
- `/spin-daily` → `/spin/daily`
- `/spin-reward` → `/spin/reward`

### 3.3 Middleware (if route matching)
- `apps/web/middleware.ts` - Check if any route patterns need updating

---

## Phase 4: Final Structure

```
apps/web/app/
├── layout.tsx
├── globals.css
├── icon.png
├── apple-icon.png
│
├── (marketing)/
│   ├── layout.tsx
│   ├── page.tsx
│   ├── cooperation/
│   │   └── page.tsx
│   └── docs/
│       └── page.tsx
│
├── (auth)/
│   ├── layout.tsx
│   ├── login/
│   │   └── page.tsx
│   └── register/
│       └── page.tsx
│
├── (app)/
│   ├── layout.tsx
│   ├── dashboard/
│   │   └── page.tsx
│   ├── earn/
│   │   └── [questId]/
│   │       └── page.tsx
│   ├── leaderboard/
│   │   └── page.tsx
│   ├── quests/                    # RENAMED from quest/
│   │   └── [questId]/
│   │       └── page.tsx
│   ├── settings/
│   │   └── page.tsx
│   ├── spin/
│   │   └── page.tsx
│   ├── transactions/
│   │   ├── page.tsx
│   │   └── [id]/
│   │       └── page.tsx
│   └── wallet/
│       └── page.tsx
│
├── (platform)/
│   ├── layout.tsx
│   ├── overview/
│   │   └── page.tsx
│   ├── earn/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   └── [questId]/
│   │       ├── page.tsx
│   │       └── not-found.tsx
│   ├── leaderboard/
│   │   └── page.tsx
│   ├── quests/                    # RENAMED from quest/
│   │   └── page.tsx
│   ├── settings/                  # RENAMED from setting/
│   │   └── page.tsx
│   ├── spin/                      # CONSOLIDATED
│   │   ├── daily/
│   │   │   └── page.tsx
│   │   └── reward/
│   │       └── page.tsx
│   └── wallet/
│       └── page.tsx
│
├── admin/
│   ├── layout.tsx
│   ├── login/
│   │   └── page.tsx
│   └── (panel)/
│       ├── layout.tsx
│       ├── page.tsx
│       ├── earn/
│       │   ├── page.tsx
│       │   └── new/
│       │       └── page.tsx
│       ├── quests/                # CONSOLIDATED (was quest/ + quests/)
│       │   ├── page.tsx
│       │   ├── [questId]/
│       │   │   ├── page.tsx
│       │   │   └── winners/
│       │   │       └── page.tsx
│       │   └── new/
│       │       └── page.tsx
│       ├── users/
│       │   └── page.tsx
│       └── wallet-invites/
│           └── page.tsx
│
└── api/
    └── [unchanged - well organized]
```

---

## Phase 5: Execution Order

1. **Rename `(app)/quest/`** → `(app)/quests/`
2. **Rename `(platform)/quest/`** → `(platform)/quests/`
3. **Rename `(platform)/setting/`** → `(platform)/settings/`
4. **Consolidate admin `quest/`** into existing `quests/` folder
5. **Create `(platform)/spin/`** folder
6. **Move `spin-daily/page.tsx`** → `spin/daily/page.tsx`
7. **Move `spin-reward/page.tsx`** → `spin/reward/page.tsx`
8. **Update ROUTES constant** in `lib/routing/app-routes.ts`
9. **Search and update** any hardcoded URL references
10. **Test all affected routes** in browser

---

## Phase 6: Verification Checklist

- [ ] All route folders renamed/moved correctly
- [ ] ROUTES constant updated with new paths
- [ ] No 404 errors on renamed routes
- [ ] Navigation links work correctly
- [ ] No hardcoded old URLs remaining
- [ ] TypeScript compilation passes
- [ ] All existing functionality works

---

## Notes

- The `(app)/` and `(platform)/` groups are intentionally separate with different layouts
- API routes are already well-organized and require no changes
- This plan should be executed AFTER lib/ and components/ reorganizations
- URL changes may affect bookmarks/SEO - consider adding redirects if needed
