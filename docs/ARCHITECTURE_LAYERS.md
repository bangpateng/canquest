# Pembagian peran — CanQuest dApp

Dokumen ini memisahkan **infrastruktur Canton (wallet)** dan **reward aplikasi (quest / DAML)** supaya coding dan proposal ke Canton Network tetap rapi.

---

## Dua lapisan

| Fitur | Kategori | Tempat eksekusi (fase sekarang) |
|-------|----------|--------------------------------|
| **Create wallet**, **Send / Receive CC** | Core infrastructure | Canton participant + **Splice Validator API** (`CANTON_VALIDATOR_URL`) — identitas **Party** user |
| **Follow X, retweet, quiz, submit task**, **klaim poin / tiket / invite** | App reward / featured app | **Web2**: PostgreSQL (`Quest`, `QuestSubmission`, `QuestCompletion`) |
| Bukti quest on-chain + **Activity Markers** (CIP-47) | App reward (lanjutan) | **Nanti**: DAML CanQuest (`packages/daml`) + `FeaturedAppActivityMarker` |

---

## Mode dev saat ini (Web2 + wallet)

Di `apps/api/.env`:

```env
# Quest & task: database saja (tanpa kontrak DAML CanQuest)
QUEST_LEDGER_ENABLED=false

# Activity marker Splice: mati dulu (fase app reward Canton)
FEATURED_APP_MARKERS_ENABLED=false

# Submit quest boleh tanpa wallet (reward CC tetap butuh wallet + tunnel)
QUEST_SUBMIT_REQUIRES_WALLET=false
```

**Tetap aktif (tanpa flag di atas):**

- `POST /api/party/allocate` — buat wallet / party
- `GET /api/party/balance` — saldo CC
- `POST /api/party/send-cc` — kirim CC
- Inbound sync — terima CC
- Tunnel TestNet + `CANTON_VALIDATOR_*`

---

## Alur user (ringkas)

```
Register/login (Web2)
    → Buat wallet (Canton/Splice)     ← Core
    → Kerjakan task quest (DB)        ← App Web2
    → Submit quest (DB)               ← App Web2
    → Reward CC (Splice transfer)     ← Core (kalau quest reward CC & wallet ada)
```

---

## Kapan nyalakan lagi lapisan Canton “app reward”

| Flag | Fungsi |
|------|--------|
| `FEATURED_APP_MARKERS_ENABLED=true` | Marker aktivitas per task / quest selesai (featured app) |
| `QUEST_LEDGER_ENABLED=true` + `CANTON_DAML_PACKAGE_ID` | Kontrak `QuestParticipation`, `QuestTaskSubmission`, dll. |

Urutan disarankan: **Web2 stabil** → **wallet production-ready** → **markers** → **DAML audit trail**.

---

## File penting

| Lapisan | Path |
|---------|------|
| Wallet / CC | `apps/api/src/party/party.controller.ts`, `splice-validator.service.ts` |
| Quest Web2 | `apps/api/src/quests/quests.service.ts` |
| DAML (parkir) | `packages/daml/`, `quest-ledger.service.ts` |
| Activity markers (parkir) | `featured-app-activity.service.ts` |
| Reset data dev | `docs/DEV_DATA_RESET.md` |
