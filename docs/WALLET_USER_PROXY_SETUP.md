# WalletUserProxy — Setup Guide (Canton MainNet)

> Panduan setup lengkap infrastruktur **WalletUserProxy** di CanQuest MainNet.
> Hasil: transfer via proxy choice (bukan `TransferFactory_Transfer` langsung),
> supaya CanQuest earn **CC app-rewards** saat FeaturedAppRight approve.
>
> Stack: Next.js (Vercel) + NestJS (VPS 2) + Canton 0.6.11 (VPS 1) + Keycloak RS256.
> DAR: `splice-util-featured-app-proxies-1.2.4`

---

## 0. Status saat ini (per 27 Juli 2026)

| FASE | Status | Catatan |
|------|--------|---------|
| 1. Upload DAR | ✅ DONE | packageId `88bcea6e...0865d` |
| 2. Create WalletUserProxy | ✅ DONE | contractId `00bd4bfc...0819c6c2d75`, duplikat di-archive |
| 3. ProxyCacheService | ✅ DONE | Live di VPS 2, cache query ACS |
| 4. executeProxyTransfer() | ✅ DONE | Code ready, auth verified di mainnet |
| 5. Test mainnet | ⏸️ BLOCKED | Menunggu **FeaturedAppRight** approve Canton Foundation |
| 6. Offers via proxy (FASE 5) | ✅ Code ready | Accept/Reject/Withdraw via `executeProxyOfferChoice`, route via flag |
| 7. Test FASE 5 | ⏸️ BLOCKED | Sama — butuh FAR |

**Flag status**: `USE_WALLET_PROXY="false"` (path lama tetap aktif, wallet aman).

---

## 1. Konteks & Arsitektur

### Apa itu WalletUserProxy?

`WalletUserProxy` adalah kontrak DAML (template `Splice.Util.FeaturedApp.WalletUserProxy:WalletUserProxy`)
yang memungkinkan **app provider** (CanQuest = `app-canquest::...`) menjadi "agen"
transfer atas nama user end. Setiap transfer via proxy choice:

1. User klik Send di wallet menu
2. Backend exercise `WalletUserProxy_TransferFactory_Transfer`
3. DAML internal tetap call `TransferFactory_Transfer` (event stream WSS tetap
   fire event sama → handler realtime tidak perlu diubah)
4. DAML auto-create `FeaturedAppActivityMarker` (untuk earn CC rewards)
5. CC transfer ke receiver seperti biasa

### Bedanya dengan path lama (sekarang dipakai)

| Aspek | Path lama (TransferFactory_Transfer langsung) | Path proxy |
|-------|-----------------------------------------------|------------|
| Choice | `TransferFactory_Transfer` | `WalletUserProxy_TransferFactory_Transfer` |
| Signatory controller | `sender` party | `user` party (via proxyArg.user) |
| Contract yg di-exercise | factoryId | WalletUserProxy contractId |
| Disclosed contracts | registry contracts | registry + WalletUserProxy + FeaturedAppRight |
| CC app-rewards | ❌ (perlu FeaturedAppActivityService marker manual) | ✅ (otomatis, kalau FeaturedAppRight ada) |

### Model autentikasi CanQuest (CUSTODIAL)

CanQuest wallet = **custodial**. Backend (admin token) submit transfer atas
nama user via `actAs:[userParty]`. Ini **cocok** dgn DAML proxy choice karena:

- Controller proxy choice = `user` party
- `actAs:[userParty]` = user authorize (meski token-nya admin)
- Backend user ledger (`fc334391-...`) punya `ParticipantAdmin` → bisa actAs
  party manapun

### Diagram alur

```
[USER klik Send di browser]
         ↓
Next.js BFF → NestJS /party/send-cc (cq_access cookie)
         ↓
PartyController.sendCc()
         ↓
   USE_WALLET_PROXY?
   ├── false → executeTransferFactoryTransfer() [PATH LAMA]
   └── true  → executeProxyTransfer()           [PATH PROXY]
                 ↓
              ProxyCacheService.getWalletUserProxyCid()
                 ↓
              exercise WalletUserProxy_TransferFactory_Transfer
                 ↓
              Canton ledger (VPS 1)
                 ↓
              DAML: TransferFactory_Transfer + FeaturedAppActivityMarker
                 ↓
              WSS /v2/updates → CantonUpdatesService (realtime)
                 ↓
              BalanceEventHandler + cc-inbound-sync → update balance DB
```

---

## 2. Konfigurasi Sistem (production)

```
Keycloak : https://auth.canquestlabs.com
Ledger   : https://ledger.canquestlabs.com (gateway publik, nginx)
Validator: https://validator.canquestlabs.com

VPS 1 (node): Docker containers
  - splice-validator-participant-1 : IP 172.18.0.6:7575 (JSON API, internal)
  - splice-validator-validator-1   : IP 172.18.0.7:5003 (Validator App)
  - splice-validator-nginx-1        : 127.0.0.1:80 (gateway)

VPS 2 (dapp) : NestJS API + apps/web
Database     : Supabase (Postgres)

Parties:
  app-canquest (provider)  : app-canquest::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb
  canquest-validator-1     : canquest-validator-1::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb
  canquest-reward-user     : canquest-reward-user::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb
  canquest-fee             : canquest-fee::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb
  DSO                      : DSO::1220b1431ef217342db44d516bb9befde802be7d8899637d290895fa58880f19accc

Ledger user (admin, Keycloak service-account):
  id            : fc334391-0f6a-456f-bb95-098b269e62b6
  username      : service-account-validator-app-backend
  client_id     : validator-app-backend
  rights        : ParticipantAdmin, CanReadAsAnyParty, CanActAs app-canquest (+ user parties)
```

---

## 3. FASE 1 — Upload DAR (one-time)

> File DAR: `/root/splice-node/dars/splice-util-featured-app-proxies-1.2.4.dar` (VPS 1)
> Status: ✅ SUDAH DIUPLOAD

### Command yang BERHASIL (jalankan di VPS 1)

```bash
KEYCLOAK_URL=https://auth.canquestlabs.com
LEDGER_URL=https://ledger.canquestlabs.com
DAR_PATH=/root/splice-node/dars/splice-util-featured-app-proxies-1.2.4.dar
YOUR_SECRET=<validator-app-backend client secret>

# 1. Mint token (client_credentials)
ADMIN_TOKEN=$(curl -s -X POST $KEYCLOAK_URL/realms/canton/protocol/openid-connect/token \
  -d "client_id=validator-app-backend" -d "client_secret=$YOUR_SECRET" \
  -d "grant_type=client_credentials" -d "scope=daml_ledger_api" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# 2. Upload — PENTING: --data-binary (BUKAN multipart -F)
curl -i -X POST "$LEDGER_URL/v2/dars" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/octet-stream" \
  --data-binary "@$DAR_PATH"
# Expected: HTTP/1.1 200 OK, body {}
```

### Ambil packageId (dari nama DALF utama, bukan query ledger)

```bash
python3 -c "
import zipfile, re
z = zipfile.ZipFile('$DAR_PATH')
main = [n for n in z.namelist()
        if n.endswith('.dalf')
        and 'daml-prim' not in n and 'daml-stdlib' not in n
        and 'splice-api' not in n
        and 'splice-util-featured-app-proxies-1.2.4-' in n][0]
fname = main.split('/')[-1].replace('.dalf','')
m = re.search(r'([0-9a-f]{64})$', fname)
print('packageId:', m.group(1))
print('templateId:', m.group(1) + ':Splice.Util.FeaturedApp.WalletUserProxy:WalletUserProxy')
"
```

**Output (SAAT INI):**
```
packageId : 88bcea6e9990bb2edb5301c042caa25c0594742665866f049f7bd67342d0865d
templateId: 88bcea6e...0865d:Splice.Util.FeaturedApp.WalletUserProxy:WalletUserProxy
```

---

## 4. FASE 2 — Create WalletUserProxy (one-time)

> Status: ✅ DONE — contractId `00bd4bfcc29ef7fa...0819c6c2d75`

### Command yang BERHASIL (jalankan di VPS 1)

```bash
PARTICIPANT="http://172.18.0.6:7575"  # langsung ke participant docker, BYPASS gateway nginx
APP_PARTY="app-canquest::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb"
TEMPLATE_ID="88bcea6e9990bb2edb5301c042caa25c0594742665866f049f7bd67342d0865d:Splice.Util.FeaturedApp.WalletUserProxy:WalletUserProxy"
REAL_USER="fc334391-0f6a-456f-bb95-098b269e62b6"  # UUID asli token (bukan @clients!)

# Re-mint token fresh (expired tiap 5 menit)
ADMIN_TOKEN=$(curl -s -X POST $KEYCLOAK_URL/realms/canton/protocol/openid-connect/token \
  -d "client_id=validator-app-backend" -d "client_secret=$YOUR_SECRET" \
  -d "grant_type=client_credentials" -d "scope=daml_ledger_api" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# CREATE via transaction-tree (untuk dapat contractId dari response)
curl -s -X POST "$PARTICIPANT/v2/commands/submit-and-wait-for-transaction-tree" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"commands\": [{
      \"CreateCommand\": {
        \"templateId\": \"$TEMPLATE_ID\",
        \"createArguments\": {
          \"provider\": \"$APP_PARTY\",
          \"providerWeight\": \"1.0\",
          \"userWeight\": \"0.0\",
          \"extraBeneficiaries\": [],
          \"optAllowList\": null
        }
      }
    }],
    \"userId\": \"$REAL_USER\",
    \"commandId\": \"create-wup-$(date +%s)\",
    \"actAs\": [\"$APP_PARTY\"],
    \"readAs\": [\"$APP_PARTY\"]
  }" | python3 -m json.tool
```

### Archive duplikat (kalau create 2x saat testing)

```bash
DUPLICATE_CID="00a41559..."  # contractId duplikat (yg akan di-archive)
KEEP_CID="00bd4bfcc29ef7fa..."  # yg dipertahankan (di-set di env)

ADMIN_TOKEN=$(curl -s -X POST $KEYCLOAK_URL/realms/canton/protocol/openid-connect/token \
  -d "client_id=validator-app-backend" -d "client_secret=$YOUR_SECRET" \
  -d "grant_type=client_credentials" -d "scope=daml_ledger_api" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

curl -X POST "$PARTICIPANT/v2/commands/submit-and-wait" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"commands\": [{
      \"ExerciseCommand\": {
        \"templateId\": \"$TEMPLATE_ID\",
        \"contractId\": \"$DUPLICATE_CID\",
        \"choice\": \"Archive\",
        \"choiceArgument\": {}
      }
    }],
    \"userId\": \"$REAL_USER\",
    \"commandId\": \"archive-wup-dup-$(date +%s)\",
    \"actAs\": [\"$APP_PARTY\"],
    \"readAs\": [\"$APP_PARTY\"]
  }"
```

---

## 5. FASE 3 — ProxyCacheService (code, sudah live)

> File: `apps/api/src/canton/proxy-cache.service.ts`
> Status: ✅ DONE — live di VPS 2

### Cara kerja

1. Saat boot, ProxyCacheService init (lazy load)
2. Saat `executeProxyTransfer()` dipanggil, cek cache:
   - Env override (`CANTON_PROXY_WUP_CID`) → langsung pakai (paling cepat)
   - Kalau cache basi (TTL 10 menit) / kosong → query ACS party app-canquest
3. Cache: `walletUserProxyCid` + `featuredAppRightCid`
4. Idiom query: `eventFormat` + `activeAtOffset` (sama dengan `queryAmuletHoldingsRaw`)

### Env vars (di `apps/api/.env` VPS 2)

```bash
# WalletUserProxy output FASE 1-2
CANTON_PROXY_PACKAGE_ID="88bcea6e9990bb2edb5301c042caa25c0594742665866f049f7bd67342d0865d"
CANTON_PROXY_WUP_CID="00bd4bfcc29ef7fa787632cbd2652f34ad49e5577161621679bb6a131fe491b1c5ca1212204bcd431b6987d070a011e0bb7111c40e9ca74de094411e6a23f348819c6c2d75"
CANTON_PROXY_CACHE_TTL_MS="600000"

# Optional: FeaturedAppRight cid (kosongkan = auto-query; set manual kalau tahu cid)
# CANTON_PROXY_FAR_CID=""

# Feature flag transfer path
USE_WALLET_PROXY="false"  # true = via proxy, false = path lama (AMAN)
```

---

## 6. FASE 4 — executeProxyTransfer() (code, sudah live)

> File: `apps/api/src/canton/canton-ledger.service.ts` (method `executeProxyTransfer`)
> File: `apps/api/src/party/party.controller.ts` (send-cc + send-token route)
> Status: ✅ DONE — code ready, auth verified di mainnet

### Strategi: feature flag (zero impact bila off)

```typescript
// party.controller.ts
const cip56Result = this.ledger.useWalletProxy
  ? await this.ledger.executeProxyTransfer({...})
  : await this.ledger.executeTransferFactoryTransfer({...});
```

`USE_WALLET_PROXY="false"` = path lama tetap jalan, tidak ada perubahan perilaku wallet.

### Payload proxy choice (DAML validated)

```json
{
  "cid": "<factoryId dari registry>",
  "proxyArg": {
    "user": "<userParty>",
    "choiceArg": {
      "expectedAdmin": "<DSO party atau instrumentAdmin>",
      "transfer": {
        "sender": "<userParty>",
        "receiver": "<receiverParty>",
        "amount": "0.5000000000",
        "instrumentId": { "admin": "<admin>", "id": "Amulet" },
        "lock": null,
        "requestedAt": "<ISO timestamp>",
        "executeBefore": "<ISO +24h>",
        "inputHoldingCids": [],
        "meta": { "values": { "splice.lfdecentralizedtrust.org/reason": "<desc>" } }
      },
      "extraArgs": {
        "context": "<registry.choiceContextData>",
        "meta": { "values": {} }
      }
    },
    "featuredAppRightCid": "<FeaturedAppRight cid — WAJIB valid>"
  }
}
```

---

## 7. BLOCKER: FeaturedAppRight

> Status: ⏸️ Menunggu approve Canton Foundation (tokenomics committee)

### Kenapa wajib?

DAML `WalletUserProxy_TransferFactory_Transfer` choice:
`featuredAppRightCid: ContractId FeaturedAppRight` — **REQUIRED field** (bukan Optional).

Tanpa FeaturedAppRight valid, DAML reject command di pre-processing.

### Cara cek FeaturedAppRight sudah approve

```bash
PARTICIPANT="http://172.18.0.6:7575"
APP_PARTY="app-canquest::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb"

ADMIN_TOKEN=$(curl -s -X POST $KEYCLOAK_URL/realms/canton/protocol/openid-connect/token \
  -d "client_id=validator-app-backend" -d "client_secret=$YOUR_SECRET" \
  -d "grant_type=client_credentials" -d "scope=daml_ledger_api" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

OFFSET=$(curl -s "$PARTICIPANT/v2/state/ledger-end" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | python3 -c "import sys,json; print(json.load(sys.stdin).get('offset',0))")

curl -s -X POST "$PARTICIPANT/v2/state/active-contracts" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"eventFormat\": {
      \"filtersByParty\": {
        \"$APP_PARTY\": {\"cumulative\": [{\"identifierFilter\": {\"WildcardFilter\": {\"value\": {\"includeCreatedEventBlob\": false}}}}]}
      },
      \"verbose\": true
    },
    \"activeAtOffset\": $OFFSET
  }" | python3 -c "
import sys, json
data = json.load(sys.stdin)
if isinstance(data, list):
    fars = [e for e in data if 'FeaturedAppRight' in json.dumps(e)]
    print(f'FeaturedAppRight aktif: {len(fars)}')
    for e in fars:
        ce = e.get('contractEntry',{}).get('JsActiveContract',{}).get('createdEvent', e)
        print(f\"  cid: {ce.get('contractId')}\")
    if not fars:
        print('→ FAR belum approve, USE_WALLET_PROXY tetap false')
"
```

### Begitu FAR approve → activate proxy

1. Cek log ProxyCacheService: `ProxyCache refreshed: WUP=... FAR=<cid>` (auto-detect)
2. Set `CANTON_PROXY_FAR_CID="<cid>"` di `.env` (optional, supaya skip query)
3. Flip `USE_WALLET_PROXY="true"`
4. `pm2 restart canquest-api --update-env`
5. Test 1 transfer kecil → log harus: `Proxy transfer OK: kind=direct`

---

## 8. Test hasil mainnet (per 27 Juli 2026)

### Tahap A — flag OFF (path lama) ✅

```
[CantonLedgerService] TransferFactory_Transfer (CIP-0056): karel → canquests 0.2 Amulet kind=offer
[CantonUpdatesService] WS message received ... choices=[{"choice":"TransferFactory_Transfer"}]
[CantonLedgerService] TransferFactory_Transfer OK: kind=offer
[BalanceEventHandlerService] CcBalance +0.200000 CC → @canquests (realtime WSS)
```
**Wallet 100% normal** (send → offer → accept → balance sync realtime).

### Tahap B — flag ON (path proxy) ✅ auth, ⏸️ FAR block

```
[ProxyCacheService] ProxyCache refreshed: WUP=00bd4bfcc29ef7fa… FAR=none (transfer tanpa reward)
[CantonLedgerService] WalletUserProxy_TransferFactory_Transfer: user=karel → receiver=canquests amount=0.1 Amulet
[CantonLedgerService] failed 400: COMMAND_PREPROCESSING_FAILED
  "Missing non-optional fields: Set(expectedAdmin, extraArgs)"
```
**Auth lewat** (no 403). Hanya payload perlu fix (sudah dikerjakan, commit `b66039c`).

---

## 9. Rollback plan

Kalau proxy path error di mainnet:

```bash
# Rollback instant — balik ke path lama
nano apps/api/.env      # USE_WALLET_PROXY="true" → "false"
pm2 restart canquest-api --update-env
```

Wallet langsung normal. Tidak ada data migration / DB rollback. ProxyCacheService
tetap jalan di background (cuma ga dipakai).

---

## 10. Gotchas (semua yg dipelajari)

| Masalah | Solusi |
|---------|--------|
| Upload DAR multipart `-F` → 400 INVALID_DAR | Pakai `--data-binary` + `Content-Type: application/octet-stream` |
| Query gateway `/v1/query`, `/v2/contracts/list` → 404 | Gateway nginx limit. Pakai participant langsung `172.18.0.6:7575` |
| `validator-app-backend@clients` USER_NOT_FOUND | Canton resolve token via UUID `sub`, bukan `@clients`. Pakai UUID asli `fc334391-...` |
| Create WalletUserProxy 403 PERMISSION_DENIED | Butuh `actAs:[app-canquest]` + userId = UUID asli. Bukan string `ledger-api-user` |
| `submit-and-wait` flat tidak return contractId | Pakai `submit-and-wait-for-transaction-tree` → return contractId dari tree |
| Token expired 5 menit | Re-mint tiap sesi |
| Docker port 7575 tidak dipublished ke host | Akses via docker network IP `172.18.0.6:7575` |
| packageId hash tidak valid untuk TemplateFilter | Canton 0.6.11 expect package NAME, bukan hash. Pakai WildcardFilter |
| proxyArg missing `expectedAdmin` + `extraArgs` | choiceArg = root level TransferFactory_Transfer arg, bukan hanya `transfer` |
| `featuredAppRightCid` wajib (bukan optional) | WalletUserProxy_TransferFactory_Transfer butuh FAR valid. Tunggu approve Canton Foundation |
| Duplikat WalletUserProxy (create 2x) | Archive salah satu via choice `Archive` |

---

## 11. Referensi

- [DAML WalletUserProxy reference](https://docs.canton.network/sdks-tools/api-reference/splice-daml/splice-util-featured-app-proxies/splice-util-featuredapp-walletuserproxy)
- [Canton Module 4: Featured App Activity Marker](https://docs.canton.network/appdev/modules/m4-featured-app-activity-marker)
- [CIP-0056 Transfer Offer Flow (internal doc)](./CANTON_TRANSFER_OFFER_FLOW.md)
- [Auth Model Decision (internal doc)](./AUTH_MODEL_DECISION.md)

### Files di repo (CanQuest)

| File | Fungsi |
|------|--------|
| `apps/api/src/canton/proxy-cache.service.ts` | Cache contractId WUP + FAR (FASE 3) |
| `apps/api/src/canton/canton-ledger.service.ts` | `executeProxyTransfer()` (FASE 4) |
| `apps/api/src/party/party.controller.ts` | Route send-cc/send-token via flag |
| `apps/api/src/canton/canton.module.ts` | Register ProxyCacheService |
| `apps/api/env.example.txt` | Env vars schema (di-gitignore, set manual) |

### Commits

- `8f241ae` feat(proxy): WalletUserProxy transfer path + ProxyCacheService (feature flag)
- `b66039c` fix(proxy): pindah expectedAdmin+extraArgs ke choiceArg level
