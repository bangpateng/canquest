# Canton Network — Alur Transfer (Offer & Direct) berbasis CIP-0056

> Dokumentasi teknis alur transfer CC yang dipakai CanQuest (dApp di Canton MainNet).
> Bisa dijadikan referensi untuk membangun dApp Canton lain.
> Stack: Next.js (Vercel) + NestJS (VPS) + Splice Validator 0.6.8 + Keycloak (RS256).

---

## 1. Konsep Inti: 2 Mode Transfer

Canton Network (via CIP-0056 Token Standard) mendukung **2 mode transfer**, ditentukan oleh **status TransferPreapproval si penerima**:

| Mode | Kapan terjadi | Alur | Pengalaman Penerima |
|------|---------------|------|---------------------|
| **DIRECT** | Penerima sudah `TransferPreapproval ENABLED` | 1 langkah — CC langsung mendarat | Otomatis masuk wallet, butuh consent sebelumnya |
| **OFFER** (2-step) | Penerima BELUM enable preapproval | 2 langkah — buat offer → penerima accept/reject | Dapat notifikasi, harus accept manual |

**Kenapa 2 mode?** Canton menghormati consent penerima. CC tidak bisa dipaksa masuk ke wallet orang lain tanpa persetujuan (kecuali mereka sudah opt-in via preapproval).

---

## 2. Komponen yang Dipakai

### On-chain (Canton Daml contracts)
- **`TransferFactory`** — factory yang menentukan mode (direct vs offer). Dari package `splice-api-token-transfer-instruction-v1`.
- **`AmuletTransferInstruction`** — kalau mode "offer", kontrak ini dibuat dan pending di inbox penerima sampai di-accept/reject.
- **`AmuletRules`** — registry aturan (transfer preapproval, mining round).
- **`LockedAmulet`** — CC yang di-lock user (bisa jadi input funding transfer).

### API endpoint (Splice validator scan-proxy)
```
POST /api/validator/v0/scan-proxy/registry/transfer-instruction/v1/transfer-factory
```
Endpoint ini menerima `choiceArguments` (data transfer: sender, receiver, amount, input holdings) lalu return:
- `factoryId` — contract id TransferFactory yang aktif
- `transferKind` — **"direct"** atau **"offer"** ← ini penentu mode
- `choiceContextData` + `disclosedContracts` — context yang harus di-inject saat exercise choice

### API endpoint (Canton JSON Ledger API v2)
```
POST /v2/commands/submit-and-wait
```
Submit Daml command (exercise choice) ke ledger. Semua transfer, lock, unlock, preapproval lewat sini.

---

## 3. Alur DIRECT Transfer (Preapproval ON)

```
SENDER                                VALIDATOR/LEDGER                              RECEIVER
  │                                        │                                            │
  │ 1. POST /api/party/send-cc             │                                            │
  │    {recipientUsername, amount,         │                                            │
  │     clientNonce, memo?}                │                                            │
  │ ─────────────────────────────────────► │                                            │
  │                                        │                                            │
  │                 2. Query TransferFactory Registry (scan-proxy)                  │
  │                 POST .../transfer-factory                                         │
  │                 body: {choiceArguments: {transfer:{sender,receiver,amount,...}}} │
  │                 ← response: {transferKind: "direct", factoryId, choiceContext}   │
  │                                        │                                            │
  │                 3. Exercise TransferFactory_Transfer                              │
  │                 POST /v2/commands/submit-and-wait                                 │
  │                 choice: TransferFactory_Transfer                                  │
  │                 actAs: [senderPartyId]                                            │
  │                 ← updateId ("1220...")                                            │
  │                                        │                                            │
  │                                        │ 4. CC langsung masuk wallet receiver      │
  │                                        │    (preapproval = consent otomatis)       │
  │                                        │ ─────────────────────────────────────────►│
  │                                        │                                            │
  │ 5. Record TRANSFER_OUT (sender)        │                                            │
  │    Record TRANSFER_IN  (receiver)      │                                            │
  │    Align balance from chain            │                                            │
  │ ← 200 {transactionId, accepted:true}   │                                            │
  │                                        │                                            │
```

**Hasil:** CC langsung masuk wallet penerima. Tidak ada langkah accept. Penerima lihat TRANSFER_IN di history + notifikasi.

---

## 4. Alur OFFER Transfer (Preapproval OFF) — 2-Step

### Step 1: Sender buat offer

```
SENDER                                VALIDATOR/LEDGER                              RECEIVER
  │                                        │                                            │
  │ 1. POST /api/party/send-cc             │                                            │
  │    {recipientUsername, amount,         │                                            │
  │     clientNonce, memo?}                │                                            │
  │ ─────────────────────────────────────► │                                            │
  │                                        │                                            │
  │                 2. Query TransferFactory Registry                                 │
  │                 ← response: {transferKind: "offer", factoryId, choiceContext}    │
  │                 ↑ KUNCI: "offer" artinya penerima TIDAK punya preapproval         │
  │                                        │                                            │
  │                 3. Exercise TransferFactory_Transfer                              │
  │                 → Membuat AmuletTransferInstruction (PENDING) di inbox receiver   │
  │                 ← updateId + transferInstructionCid                                │
  │                                        │                                            │
  │                                        │ 4. Offer muncul di inbox receiver          │
  │                                        │ ─────────────────────────────────────────►│
  │                                        │                                            │
  │ 5. Record TRANSFER_OUT status=PENDING  │                                            │
  │    (CC di-hold sebagai escrow)         │                                            │
  │ ← 200 {offerPending:true,              │                                            │
  │        offerContractId}                │                                            │
  │                                        │                                            │
```

**Hasil step 1:** CC sender di-hold. Penerima lihat offer di menu "Offers" (GET `/api/party/offers`).

### Step 2A: Receiver ACCEPT offer

```
RECEIVER                              VALIDATOR/LEDGER                                SENDER
  │                                        │                                            │
  │ 1. POST /api/party/offers/accept       │                                            │
  │    {contractId: transferInstructionCid}│                                            │
  │ ─────────────────────────────────────► │                                            │
  │                                        │                                            │
  │                 2. Exercise AmuletTransferInstruction_Accept                      │
  │                 POST /v2/commands/submit-and-wait                                 │
  │                 choice: AmuletTransferInstruction_Accept                          │
  │                 actAs: [receiverPartyId]                                          │
  │                 ← updateId                                                        │
  │                                        │                                            │
  │                                        │ 3. Canton consume input holdings sender    │
  │                                        │    LockedAmulet sender di-archive          │
  │                                        │    CC berpindah ke receiver                │
  │                                        │                                            │
  │ 4. Record TRANSFER_IN (receiver)       │                                            │
  │    Flip TRANSFER_OUT sender PENDING→COMPLETED                                     │
  │    Push notif ke sender "offer accepted"│                                           │
  │ ← 200 {accepted:true}                  │                                            │
  │                                        │                                            │
```

**Hasil:** CC resmi berpindah. Sender lihat status COMPLETED, receiver lihat TRANSFER_IN.

### Step 2B: Receiver REJECT offer

```
RECEIVER                              VALIDATOR/LEDGER                                SENDER
  │                                        │                                            │
  │ 1. POST /api/party/offers/reject       │                                            │
  │    {contractId: transferInstructionCid}│                                            │
  │ ─────────────────────────────────────► │                                            │
  │                                        │                                            │
  │                 2. Exercise AmuletTransferInstruction_Reject                      │
  │                 ← updateId                                                        │
  │                                        │                                            │
  │                                        │ 3. Canton kembalikan CC ke sender          │
  │                                        │    (input holdings unfreeze)               │
  │                                        │                                            │
  │ 4. Record OFFER_REJECTED (receiver)    │                                            │
  │    Flip TRANSFER_OUT sender PENDING→REJECTED                                      │
  │    Push notif ke sender "CC returned"  │                                            │
  │ ← 200 {rejected:true}                  │                                            │
  │                                        │                                            │
```

**Hasil:** CC kembali ke sender. Keduanya dapat history row.

---

## 5. Preapproval — Opt-in untuk Direct Transfer

Agar bisa menerima transfer DIRECT (tanpa accept manual), penerima harus **enable TransferPreapproval**:

```
USER                                  VALIDATOR/LEDGER
  │                                        │
  │ POST /api/party/preapproval/enable     │
  │ ─────────────────────────────────────► │
  │                                        │
  │                 Exercise AmuletRules_CreateTransferPreapproval                    │
  │                 (burn fee ~1.5 CC, one-time)                                       │
  │                                        │
  │ ← 200 {active: true}                   │
  │                                        │
```

**Setelah aktif:** semua transfer masuk ke user ini akan DIRECT (mode 1 langkah).

**Cooldown:** CanQuest membatasi toggle preapproval 1× per 7 hari (mencegah churn yang burn fee berulang).

**Disable:** `POST /api/party/preapproval/disable` → archive TransferPreapproval → transfer masuk kembali jadi offer (2-step).

---

## 6. Detail Teknis Penting

### 6.1. TransferFactory Registry Call

Sebelum exercise `TransferFactory_Transfer`, WAJIB query registry untuk dapat:
- `factoryId` (contract id TransferFactory yang aktif saat ini)
- `transferKind` ("direct" / "offer" — menentukan mode)
- `choiceContextData` + `disclosedContracts` (context yang di-inject ke command)

```http
POST /api/validator/v0/scan-proxy/registry/transfer-instruction/v1/transfer-factory
Authorization: Bearer <ledger-jwt>
Content-Type: application/json

{
  "choiceArguments": {
    "expectedAdmin": "<DSO_PARTY_ID>",
    "transfer": {
      "sender": "<senderPartyId>",
      "receiver": "<receiverPartyId>",
      "amount": "0.5000000000",
      "inputUtxo": ["<inputHoldingCid1>", "<inputHoldingCid2>"],
      "meta": {
        "values": {
          "splice.lfdecentralizedtrust.org/reason": "<memo text>"
        }
      }
    },
    "transferFactoryRef": { ... }
  },
  "excludeDebugFields": true
}
```

### 6.2. choiceArguments untuk TransferFactory_Transfer

```json
{
  "transfer": {
    "sender": "username::1220...",
    "receiver": "username::1220...",
    "amount": "1.0000000000",
    "inputUtxo": ["00..."],
    "meta": {
      "values": {
        "splice.lfdecentralizedtrust.org/reason": "memo from sender"
      }
    }
  },
  "expectedAdmin": "wallet::1220...",
  "transferFactoryRef": {
    "factory": { "packageId": "...", "template": "..." }
  },
  "extraArgs": {
    "context": "<choiceContextData from registry>"
  }
}
```

### 6.3. Memo / Reason field

CIP-0056 mendefinisikan metadata key `splice.lfdecentralizedtrust.org/reason` untuk memo tag. Diletakkan di:
```json
"meta": { "values": { "splice.lfdecentralizedtrust.org/reason": "your memo" } }
```
Bisa dipakai untuk exchange deposit tag / memo user.

### 6.4. Idempotency (anti double-send)

Canton Ledger API mendukung dedup via `commandId`. Jika 2 submit dengan commandId sama, ledger hanya eksekusi 1x.

```ts
// commandId deterministik dari hash(sender + receiver + amount + nonce)
const commandId = `tf-${sha256(senderPartyId + receiverPartyId + amount + clientNonce)}`;
```

Frontend generate `clientNonce` (UUID) per klik Send. Double-click / browser retry dengan nonce sama → di-dedup jadi 1 transfer.

---

## 7. Auth yang Dipakai

| Komponen | Auth |
|----------|------|
| Browser → BFF (Next.js) | Cookie `cq_access` (JWT HS256) |
| BFF → NestJS API | Bearer JWT (dari cookie) |
| NestJS → Validator scan-proxy / Ledger API | Bearer JWT dari Keycloak `client_credentials`, scope `daml_ledger_api`, audience `https://canton.network.global`, algorithm **RS256** |

> ⚠️ Validator Splice 0.6.8 **wajib RS256**. Jangan pakai `hs-256-unsafe` mode (ditolak).
> Jalankan validator dengan flag `-a` (auth enabled): `./start.sh -a -s ... -o ... -p ... -m 4 -w`

---

## 8. Alur Data di App Layer (PostgreSQL)

Saat transfer terjadi, app catat di tabel `CcTransaction`:

| Field | DIRECT | OFFER-create | OFFER-accept | OFFER-reject |
|-------|--------|--------------|--------------|--------------|
| Sender row type | TRANSFER_OUT | TRANSFER_OUT | (PENDING→COMPLETED) | (PENDING→REJECTED) |
| Sender status | COMPLETED | PENDING | flipped | flipped |
| Receiver row type | TRANSFER_IN | — | TRANSFER_IN | OFFER_REJECTED |
| `ledgerTxId` | Canton update_id | Canton update_id | Canton update_id | Canton update_id |
| `cantonUpdateId` | same | same | same | same |

`ledgerTxId` = `cantonUpdateId` = Canton `update_id` (format `1220...`). Dipakai untuk link explorer (Modo: `https://cc.modo.link/mainnet/event/<id>%3A0`).

---

## 9. Diagram Alur Lengkap (Ringkas)

```
┌─────────┐   send-cc    ┌─────────┐  registry  ┌──────────┐
│  Sender  │─────────────►│ Backend │ ─────────► │ Scan-proxy│
│ Browser  │              │ (Nest)  │            │  (Canton) │
└─────────┘              └────┬────┘            └──────────┘
                              │ exercise choice
                              ▼
                     ┌────────────────┐
                     │  Ledger API v2 │
                     │ submit-and-wait │
                     └────────┬───────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
        transferKind      transferKind    transferKind
         = "direct"        = "offer"      = "offer"
              │               │               │
              ▼               ▼               │
     CC masuk wallet    Offer pending         │
     receiver           di inbox receiver     │
                                              ▼
                                    ┌────────────────┐
                                    │ Receiver klik  │
                                    │ accept/reject  │
                                    └───────┬────────┘
                                            │
                                    accept: CC pindah
                                    reject: CC kembali
```

---

## 10. Hal yang Sering Bikin Bingung (Gotchas)

1. **`transferKind` menentukan semuanya.** Query registry DULU sebelum exercise choice. Response `transferKind` = "direct"/"offer" menentukan apakah perlu step accept.
2. **Offer = escrow on-chain.** CC sender di-hold (bukan di wallet sender lagi) sampai receiver accept/reject. Bukan phantom record di DB.
3. **Accept offer meng-consume input holdings sender.** Kalau sender pakai LockedAmulet sebagai input funding, LockedAmulet itu di-archive saat offer di-accept. Row `CcLock` sender perlu di-reconcile (cleanup stale row).
4. **`updateId` nested di `transactionTree.updateId`, BUKAN root.** Response `submit-and-wait` punya `transactionTree.updateId` — itu Canton update_id asli untuk explorer link.
5. **Preapproval burn fee ~1.5 CC (one-time).** Enable lalu disable lalu enable = burn fee berkali-kali. Cooldown 7 hari mengurangi ini.
6. **Auth RS256 wajib di 0.6.8.** Token dari Keycloak harus RS256, audience `https://canton.network.global`, scope `daml_ledger_api`.

---

## 11. Referensi

- **CIP-0056 Token Standard** — `token-standard/splice-api-token-transfer-instruction-v1`
- **Splice docs** — https://docs.canton.network/integrations/wallet/guidance
- **TransferFactory Registry OpenAPI** — `token-standard/splice-api-token-transfer-instruction-v1/openapi/transfer-instruction-v1.yaml` (di repo canton-network/splice)
- **JSON Ledger API** — https://docs.canton.network/reference/json-api-reference
- **Validator API** — https://docs.canton.network/sdks-tools/api-reference/splice-validator-api
