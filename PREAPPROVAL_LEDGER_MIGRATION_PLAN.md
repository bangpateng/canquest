# TransferPreapproval — Migrasi ke Ledger API (Chunk 1)

**LAPORAN + DIFF** — Belum diapply.

---

## 1. Mekanisme Current (HS256 Splice REST)

### 1.1. createTransferPreapproval(username)

**File:** `splice-validator.service.ts` line 980-1029

**Endpoint:** `POST /api/validator/v0/wallet/transfer-preapproval`

**Auth:** HS256 JWT (`sub=username`, e.g., `canquest-reward-user`)

**Body:** `{}`

**Response:**
- `200 OK` → preapproval created
- `409 Conflict` → preapproval already exists
- `401/403` → auth failed (Keycloak mode menolak HS256)

**Problem:** Keycloak mode menolak HS256 → **GAGAL** (401 Unauthorized).

### 1.2. hasTransferPreapproval(partyId)

**File:** `splice-validator.service.ts` line 900-950

**Endpoint:** `GET /api/validator/v0/wallet/transfer-preapproval`

**Auth:** HS256 JWT (`sub=username`)

**Response:**
- `200 OK` → `{ transfer_preapproval: { contract: { payload: { expiresAt, provider, ... } } } }`
- `404 Not Found` → `{ error: "No TransferPreapproval found for party: ..." }`

**Problem:** Keycloak mode menolak HS256 → **GAGAL** (401 Unauthorized).

### 1.3. cancelTransferPreapprovalViaLedger(partyId)

**File:** `canton-ledger.service.ts` line 590-675

**Mekanisme:**
1. Query ACS (Active Contract Set) via Ledger API untuk cari `TransferPreapproval` contract milik `partyId`.
2. Exercise choice `TransferPreapproval_Cancel` via Ledger API (Keycloak client_credentials).
3. Auth: **Keycloak client_credentials** (operator) — **BUKAN HS256**.

**Pola ACS Query:**
```typescript
POST /v2/state/active-contracts
{
  "eventFormat": {
    "filtersByParty": {
      [partyId]: {
        "cumulative": [{
          "identifierFilter": {
            "WildcardFilter": { "value": { "includeCreatedEventBlob": false } }
          }
        }]
      }
    },
    "verbose": true
  },
  "activeAtOffset": offset
}
```

**Pola Exercise Choice:**
```typescript
exerciseChoice(
  preapprovalCid,
  preapprovalTemplateId,
  'TransferPreapproval_Cancel',
  {},
  [partyId]
)
```

**Auth:** Keycloak client_credentials (operator) — **BISA JALAN** di Keycloak mode.

---

## 2. Endpoint Toggle Preapproval

### 2.1. GET /party/preapproval/status

**File:** `party.controller.ts` line 1095-1112

**Alur:**
1. `splice.getTransferPreapproval(user.cantonPartyId)` (HS256)
2. Return `{ active: boolean, expiresAt, provider, message }`

**Problem:** HS256 → **GAGAL** di Keycloak mode.

### 2.2. POST /party/preapproval/enable

**File:** `party.controller.ts` line 1118-1153

**Alur:**
1. Cek existing via `splice.getTransferPreapproval(user.cantonPartyId)` (HS256)
2. Resolve wallet username via `splice.resolveWalletUsernameForParty(partyId)` (HS256)
3. `splice.createTransferPreapproval(walletUsername)` (HS256)

**Problem:** HS256 → **GAGAL** di Keycloak mode.

### 2.3. POST /party/preapproval/disable

**File:** `party.controller.ts` line 1160-1205

**Alur:**
1. Cek existing via `splice.getTransferPreapproval(user.cantonPartyId)` (HS256)
2. `splice.cancelTransferPreapproval(user.cantonPartyId)` (Admin API HS256)
3. Fallback: `ledger.cancelTransferPreapprovalViaLedger(partyId)` (Ledger API Keycloak) — **BISA JALAN**

**Problem:** Step 1-2 pakai HS256 → **GAGAL** di Keycloak mode. Fallback Ledger API **BISA JALAN**.

---

## 3. Cara Membuat TransferPreapproval via Ledger API

### 3.1. Referensi di Kode

**TIDAK ADA** referensi choice `TransferPreapproval_Create` atau sejenisnya di kode.

### 3.2. Analisis Splice/Canton Docs

**TransferPreapproval** adalah contract di template `Splice.AmuletRules:TransferPreapproval`.

**Cara membuat (berdasarkan pola Splice):**

1. **Via AmuletRules choice** (kemungkinan besar):
   - Choice: `AmuletRules_CreateTransferPreapproval` atau `AmuletRules_AddTransferPreapproval`
   - Signatory: `provider` (validator/operator)
   - Observer: `receiver` (user party)
   - Disclosed contracts: `AmuletRules` contract (dari registry/scan)

2. **Via Wallet API** (current, HS256):
   - Endpoint: `POST /api/validator/v0/wallet/transfer-preapproval`
   - Auth: HS256 JWT (`sub=username`)
   - Backend: Splice Wallet API exercise choice atas nama user

**Problem:** Kita **TIDAK tahu** choice mana yang benar tanpa:
- Melihat DAML source code `Splice.AmuletRules` template
- Atau test via Ledger API (trial-error)

### 3.3. Strategi Migrasi

**Opsi A (Recommended):** Query registry/scan untuk `AmuletRules` contract, lalu exercise choice `AmuletRules_CreateTransferPreapproval` (atau sejenisnya) dengan disclosed contracts.

**Opsi B (Fallback):** Jika choice tidak ditemukan, gunakan Ledger API `POST /v2/create` untuk create contract langsung (tapi ini butuh signatory validator + observer user, kemungkinan ditolak).

**Opsi C (Pragmatic):** Untuk sementara, **SKIP** create via Ledger API. User aktifkan preapproval via Splice Wallet UI (manual). Backend hanya support:
- **Check** preapproval via Ledger API (query ACS)
- **Cancel** preapproval via Ledger API (exercise `TransferPreapproval_Cancel`)

**Rekomendasi:** **Opsi C** untuk Chunk 1 (pragmatic). Chunk 2 nanti kita cari choice yang benar via DAML source atau test.

---

## 4. DIFF — Migrasi Preapproval ke Ledger API

### 4.1. hasTransferPreapproval() — Versi Ledger API

**File:** `canton-ledger.service.ts`

**Tambah method baru:**

```typescript
/**
 * Check if a party has an active TransferPreapproval via Ledger API.
 * Query ACS for TransferPreapproval contract where receiver = partyId.
 */
async hasTransferPreapprovalViaLedger(partyId: string): Promise<boolean> {
  if (!this.isConfigured) return false;

  let offset: number | string = 0;
  try {
    const end = (await this.ledgerEnd()) as { offset?: number | string };
    offset = end?.offset ?? 0;
  } catch { offset = 0; }

  let allContracts: unknown[] = [];
  try {
    const res = await fetch(`${this.baseUrl}/v2/state/active-contracts`, {
      method: 'POST',
      headers: await this.authHeaders(),
      body: JSON.stringify({
        eventFormat: {
          filtersByParty: {
            [partyId]: {
              cumulative: [{
                identifierFilter: {
                  WildcardFilter: { value: { includeCreatedEventBlob: false } },
                },
              }],
            },
          },
          verbose: true,
        },
        activeAtOffset: offset,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) {
      allContracts = (await res.json()) as unknown[];
    } else {
      const text = await res.text();
      this.logger.warn(`hasTransferPreapproval ACS query failed HTTP ${res.status}: ${text.slice(0, 200)}`);
      return false;
    }
  } catch (err) {
    this.logger.warn(`hasTransferPreapproval ACS query error: ${String(err)}`);
    return false;
  }

  for (const entry of allContracts) {
    if (!entry || typeof entry !== 'object') continue;
    const wrapper = entry as Record<string, unknown>;
    const active = wrapper.contractEntry as Record<string, unknown> | undefined;
    const jsActive = active?.JsActiveContract as Record<string, unknown> | undefined;
    const ev = (jsActive?.createdEvent ?? wrapper) as Record<string, unknown>;
    const tplId = typeof ev.templateId === 'string' ? ev.templateId : '';
    if (!tplId.includes('TransferPreapproval')) continue;
    const args = (ev.createArgument as Record<string, unknown> | undefined) ?? {};
    const receiver = typeof args.receiver === 'string' ? args.receiver : '';
    if (receiver === partyId) {
      return true;
    }
  }

  return false;
}
```

### 4.2. getTransferPreapprovalViaLedger() — Versi Ledger API

**File:** `canton-ledger.service.ts`

**Tambah method baru:**

```typescript
/**
 * Get TransferPreapproval details for a party via Ledger API.
 * Returns { expiresAt, provider } or null if not found.
 */
async getTransferPreapprovalViaLedger(
  partyId: string,
): Promise<{ expiresAt?: string; provider?: string } | null> {
  if (!this.isConfigured) return null;

  let offset: number | string = 0;
  try {
    const end = (await this.ledgerEnd()) as { offset?: number | string };
    offset = end?.offset ?? 0;
  } catch { offset = 0; }

  let allContracts: unknown[] = [];
  try {
    const res = await fetch(`${this.baseUrl}/v2/state/active-contracts`, {
      method: 'POST',
      headers: await this.authHeaders(),
      body: JSON.stringify({
        eventFormat: {
          filtersByParty: {
            [partyId]: {
              cumulative: [{
                identifierFilter: {
                  WildcardFilter: { value: { includeCreatedEventBlob: false } },
                },
              }],
            },
          },
          verbose: true,
        },
        activeAtOffset: offset,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) {
      allContracts = (await res.json()) as unknown[];
    } else {
      const text = await res.text();
      this.logger.warn(`getTransferPreapproval ACS query failed HTTP ${res.status}: ${text.slice(0, 200)}`);
      return null;
    }
  } catch (err) {
    this.logger.warn(`getTransferPreapproval ACS query error: ${String(err)}`);
    return null;
  }

  for (const entry of allContracts) {
    if (!entry || typeof entry !== 'object') continue;
    const wrapper = entry as Record<string, unknown>;
    const active = wrapper.contractEntry as Record<string, unknown> | undefined;
    const jsActive = active?.JsActiveContract as Record<string, unknown> | undefined;
    const ev = (jsActive?.createdEvent ?? wrapper) as Record<string, unknown>;
    const tplId = typeof ev.templateId === 'string' ? ev.templateId : '';
    if (!tplId.includes('TransferPreapproval')) continue;
    const args = (ev.createArgument as Record<string, unknown> | undefined) ?? {};
    const receiver = typeof args.receiver === 'string' ? args.receiver : '';
    if (receiver === partyId) {
      return {
        expiresAt: typeof args.expiresAt === 'string' ? args.expiresAt : undefined,
        provider: typeof args.provider === 'string' ? args.provider : undefined,
      };
    }
  }

  return null;
}
```

### 4.3. Wire Endpoint Enable/Disable ke Ledger API

**File:** `party.controller.ts`

**DIFF 1: GET /party/preapproval/status**

```diff
------- SEARCH
    const preapproval = await this.splice.getTransferPreapproval(user.cantonPartyId);

    return {
      active: preapproval !== null,
      expiresAt: preapproval?.expiresAt ?? null,
      provider: preapproval?.provider ?? null,
      message: preapproval
        ? 'Preapproval active — incoming CC transfers arrive directly without manual accept.'
        : 'Preapproval inactive — incoming CC transfers will appear as offers that you must accept manually.',
    };
=======
    const preapproval = await this.ledger.getTransferPreapprovalViaLedger(user.cantonPartyId);

    return {
      active: preapproval !== null,
      expiresAt: preapproval?.expiresAt ?? null,
      provider: preapproval?.provider ?? null,
      message: preapproval
        ? 'Preapproval active — incoming CC transfers arrive directly without manual accept.'
        : 'Preapproval inactive — incoming CC transfers will appear as offers that you must accept manually.',
    };
+++++++ REPLACE
```

**DIFF 2: POST /party/preapproval/enable**

```diff
------- SEARCH
    // Check if already active
    const existing = await this.splice.getTransferPreapproval(user.cantonPartyId);
    if (existing) {
      return {
        ok: true,
        alreadyActive: true,
        expiresAt: existing.expiresAt,
        message: 'Preapproval is already active.',
      };
    }

    // Resolve Splice wallet username
    const walletUsername =
      (await this.splice.resolveWalletUsernameForParty(user.cantonPartyId)) ?? user.username;

    const result = await this.splice.createTransferPreapproval(walletUsername);

    if (!result.ok) {
      throw new BadRequestException(
        result.detail ?? 'Failed to create preapproval. Try again or create via Splice Wallet UI.',
      );
    }

    return {
      ok: true,
      alreadyActive: false,
      message: 'Preapproval enabled — incoming CC transfers will now arrive directly.',
    };
=======
    // Check if already active
    const existing = await this.ledger.getTransferPreapprovalViaLedger(user.cantonPartyId);
    if (existing) {
      return {
        ok: true,
        alreadyActive: true,
        expiresAt: existing.expiresAt,
        message: 'Preapproval is already active.',
      };
    }

    // TODO: Create TransferPreapproval via Ledger API (choice belum diketahui).
    // Untuk sementara, user harus aktifkan via Splice Wallet UI.
    throw new BadRequestException(
      'Preapproval creation via Ledger API is not yet implemented. ' +
      'Please enable preapproval via Splice Wallet UI: ' +
      (this.splice.walletUiUrl ?? 'http://localhost:8080'),
    );
+++++++ REPLACE
```

**DIFF 3: POST /party/preapproval/disable**

```diff
------- SEARCH
    // Check if active
    const existing = await this.splice.getTransferPreapproval(user.cantonPartyId);
    if (!existing) {
      return {
        ok: true,
        wasActive: false,
        message: 'Preapproval is already inactive.',
      };
    }

    // Cancel via Splice admin API (falls back to Ledger API if 401)
    const result = await this.splice.cancelTransferPreapproval(user.cantonPartyId);
    if (!result.ok) {
      if (result.error === 'ADMIN_AUTH_FAILED') {
        // Admin API returns 401 on MainNet — use Ledger API to archive contract
        this.logger.log('Admin API 401, falling back to Ledger API to cancel preapproval');
        const ledgerResult = await this.ledger.cancelTransferPreapprovalViaLedger(
          user.cantonPartyId,
        );
        if (!ledgerResult.ok) {
          this.logger.warn(`Ledger API cancel also failed: ${ledgerResult.error ?? 'unknown'}`);
          throw new BadRequestException(
            `Failed to disable preapproval: ${ledgerResult.error ?? 'unknown'}`,
          );
        }
      } else {
        this.logger.warn(`Disable preapproval failed: ${result.error ?? 'unknown'}`);
        throw new BadRequestException(
          `Failed to disable preapproval: ${result.error ?? 'unknown'}`,
        );
      }
    }
=======
    // Check if active
    const existing = await this.ledger.getTransferPreapprovalViaLedger(user.cantonPartyId);
    if (!existing) {
      return {
        ok: true,
        wasActive: false,
        message: 'Preapproval is already inactive.',
      };
    }

    // Cancel via Ledger API (primary path, no HS256 fallback)
    const result = await this.ledger.cancelTransferPreapprovalViaLedger(user.cantonPartyId);
    if (!result.ok) {
      this.logger.warn(`Disable preapproval failed: ${result.error ?? 'unknown'}`);
      throw new BadRequestException(
        `Failed to disable preapproval: ${result.error ?? 'unknown'}`,
      );
    }
+++++++ REPLACE
```

---

## 5. Summary Chunk 1

### 5.1. Yang Dimigrasi

- ✅ **Check preapproval:** `hasTransferPreapprovalViaLedger()` + `getTransferPreapprovalViaLedger()` (Ledger API)
- ✅ **Cancel preapproval:** `cancelTransferPreapprovalViaLedger()` (sudah ada, jadikan primary path)
- ✅ **Wire endpoint:** `/party/preapproval/status` + `/party/preapproval/disable` → Ledger API

### 5.2. Yang BELUM Dimigrasi

- ⚠️ **Create preapproval:** `createTransferPreapproval()` via Ledger API — **BELUM** (choice belum diketahui)
- ⚠️ **Endpoint enable:** `/party/preapproval/enable` → throw error, user harus aktifkan via Splice Wallet UI

### 5.3. Default User Baru

**Rekomendasi:** **OFF** (tidak auto-buat preapproval saat onboarding).

**Alasan:**
- Saat ini de-facto sudah OFF (createPreapproval HS256 gagal di Keycloak mode).
- User aktifkan sendiri via Splice Wallet UI (manual).
- Sesuai framing toggle One-Step OFF = user kontrol penuh.

**Perubahan di onboarding:** **SKIP** `createTransferPreapproval()` di `setUsername()` (Chunk 2).

---

## 6. Next Steps (Manual)

1. **Review** diff 3 blok di atas.
2. **Konfirmasi** default user baru OFF (tidak auto-buat preapproval).
3. **Apply** diff ke `canton-ledger.service.ts` + `party.controller.ts`.
4. **Build:** `cd apps/api && npm run build`.
5. **Test:**
   - User yang sudah punya preapproval (via Splice Wallet UI) → `/party/preapproval/status` return `active: true`.
   - User disable preapproval → `/party/preapproval/disable` sukses (via Ledger API).
   - User enable preapproval → `/party/preapproval/enable` throw error (belum diimplementasi).
6. **Chunk 2:** Cari choice `AmuletRules_CreateTransferPreapproval` (atau sejenisnya) via DAML source atau test.

**CATATAN:** Diff ini **BELUM DIAPPLY** — user review dulu.
