# RUNBOOK — Deploy DAML v27 (hybrid: Fee AppPaymentRequest + Reward CIP-56)

> **Status:** Code siap (typecheck 0 error), **belum di-deploy**.
> **DAML:** `canquest-v27` v1.5.0 (revisi dari 1.4.0 yang cacat — drop field rewardAmount).
> **Tanggal code:** 2026-08-07
> **HEAD saat doc ditulis:** lihat `git log --oneline -1`

---

## ⚠️ BACA DULU — Premis v27 dikoreksi

v27 1.4.0 (handoff asli) salah asumsi AppPaymentRequest bawa reward+fee.
Verified vs docs resmi Splice (`docs.sync.global`): AppPaymentRequest adalah
flow **user-bayar** (`sender` = "the party that should pay"). Splice tidak punya
mekanisme native platform→user reward.

**v27 hybrid (1.5.0) yang BENAR:**
- Fee claim (user → treasury) = AppPaymentRequest (locked, anti-preapproval)
- Reward (platform → user) = CIP-56 TransferFactory_Transfer (unchanged dari v25)

Detail: lihat `HANDOFF_DAML_V27.md` section "KOREKSI PENTING".

---

## §0. Prasyarat (sebelum deploy)

### A. Service-account rights — KRITIS

v27 butuh actAs rights utk **lebih banyak party** dari v25. Cek service-account
(`service-account-validator-app-backend`) punya `CanActAsAnyParty`:

```bash
# Di VPS participant node
curl -s http://127.0.0.1:5003/api/validator/v0/admin/users/service-account-validator-app-backend \
  | jq '.rights'
```

Harus ada `CanActAsAnyParty` (atau minimal enumerate semua party di bawah).
Kalau belum, jalankan `docs/RUNBOOK_GRANT_ANY_PARTY_RIGHTS.md`.

**Party yang di-touch v27 (must have actAs):**
| Party | Env var | Dipakai di | Notes |
|---|---|---|---|
| admin/operator | `CANTON_OPERATOR_PARTY_ID` | semua DAML create/MarkAccepted/MarkSettled | signatory |
| user | (per-request) | Accept (sender), Collect | runtime |
| walletProvider | `CANTON_WALLET_PROVIDER_PARTY_ID` | Accept controller | = validator party |
| platformParty | `CANTON_APP_PROVIDER_PARTY_ID` | Collect, AppPaymentRequest.provider | = app provider |
| treasuryParty | `CANTON_FEE_RECIPIENT_PARTY_ID` | Collect, AppPaymentRequest receiver | fee recipient |

⚠️ **Collect butuh 4 party actAs**: `[admin, user, platformParty, treasuryParty]`.
Accept butuh 2: `[user, walletProvider]`. CanActAsAnyParty cover semua.

### B. Env vars (backfill `apps/api/.env`)

Tambah/isi party vars (lihat `env.example.txt` section "Canton Parties v27"):
```env
CANTON_OPERATOR_PARTY_ID="<party-id>"
CANTON_REWARD_PARTY_ID="<party-id>"
CANTON_FEE_RECIPIENT_PARTY_ID="<party-id>"
CANTON_DSO_PARTY_ID="<party-id>"
CANTON_APP_PROVIDER_PARTY_ID="<party-id>"
CANTON_WALLET_PROVIDER_PARTY_ID="<sama dgn validator party>"
# CANTON_DAML_PACKAGE_NAME di-set setelah DAR upload (§3)
```

### C. Reward wallet funded

Reward tetap CIP-56 (platform→user). Pastikan `CANTON_REWARD_PARTY_ID` wallet
punya cukup CC (cek via `splice.getUserBalance` atau Scan API). Funding via
`canton> transfer` CLI (lihat `docs/USDCX_REWARD_SETUP.md`).

---

## §1. Build DAR v27 (di VPS dev-machine yang punya `daml` CLI)

```bash
cd /var/www/canquest
git pull origin master
git log --oneline -3   # harus ada commit v27 hybrid

cd packages/daml
head -1 daml.yaml        # harus: sdk-version: 3.4.11
grep "name:\|version:" daml.yaml
# harus: name: canquest-v27, version: 1.5.0   ← BUKAN 1.4.0 (cacat)

daml build
ls -la .daml/dist/canquest-v27-*.dar
# harus ada: canquest-v27-1.5.0.dar (~700KB)
```

⚠️ Kalau `version: 1.4.0` → git pull belum sampai. v1.4.0 adalah DAR CACAT
(field rewardAmount ada). Harus 1.5.0.

---

## §2. Upload DAR ke participant node

```bash
# Upload DAR v27 1.5.0
curl -X POST http://127.0.0.1:5003/v2/dars \
  -H "Authorization: Bearer $LEDGER_TOKEN" \
  --data-binary @packages/daml/.daml/dist/canquest-v27-1.5.0.dar

# Verifikasi: list DAR, cari hash canquest-v27 1.5.0
curl -s http://127.0.0.1:5003/v2/dars \
  -H "Authorization: Bearer $LEDGER_TOKEN" | jq '.[] | select(.packageId | contains("canquest-v27"))'
```

Catat **packageId hash** (string 64-char hex, format `<hash>` tanpa `#`).

---

## §3. Set env override package name

```env
# Di apps/api/.env
CANTON_DAML_PACKAGE_NAME="#<hash-dari-§2>"
```

Backend `quest-ledger.service.ts` `damlPackageRef` getter akan pakai ini utk
semua templateId CanQuest (Main:QuestCampaign, Main:QuestPaymentRequest, dll).

⚠️ **Splice templates** (AppPaymentRequest, AcceptedAppPayment) pakai literal
packageId `#splice-wallet-payments:...` — TIDAK lewat override ini (sudah bawaan
participant node).

---

## §4. Restart backend & smoke test

```bash
cd /var/www/canquest/apps/api
pm2 restart canquest-api   # atau service manager Anda

# Cek log boot — pastikan tidak ada party placeholder warning
pm2 logs canquest-api --lines 30 | grep -i "placeholder\|error\|CANTON_"
```

### Smoke test (manual via API, 1 quest test):

1. **FCFS CC claim** (reward > 0):
   - POST claim → cek log: harus ada `executeClaimPayoutV27` + `AppPaymentRequest created`
     + `AppPaymentRequest_Accept OK` + `AcceptedAppPayment_Collect` + `reward CIP-56 OK`
   - DB: `winnerDraw.distributed=true`, `claimFeeLedgerTxId` terisi (collectTxId),
     `ledgerTxId` terisi (rewardTxId), `claimSessionContractId` = QuestPaymentRequest cid.
   - User balance: reward CC naik (cek Scan/wallet).

2. **Code claim** (reward = 0, fee-only):
   - POST claim → log: `executeClaimPayoutV27` + `Code claim fee` flow (step 1-7, no step 8 reward).
   - DB: `winnerDraw.inviteCode` terisi, `claimFeeLedgerTxId` terisi.
   - User dapat invite code (return value).

3. **Raffle CC claim** (reward > 0): sama FCFS tapi via DrawWinner.

4. **CC+Code raffle** (reward > 0 + code): gabungan — fee AppPaymentRequest + reward CIP-56 + code DB.

---

## §5. Rollback (kalau gagal)

v27 tidak bisa "rollback ke v25" tanpa redeploy code (v25 settleAtomic dihapus).
Rollback path:

1. **Code rollback:** `git revert <commit-v27>` + redeploy backend (v25 settleAtomic kembali).
2. **DAR:** DAR v25 masih ada di participant (tidak dihapus saat upload v27). Backend
   override `CANTON_DAML_PACKAGE_NAME` kembali ke hash v25.
3. **DB:** `winnerDraw` rows yang sudah SETTLED di v27 tidak compatibel v25
   (`claimSessionContractId` berisi QuestPaymentRequest cid, bukan receipt cid).
   Tapi karena v25 tidak baca `claimSessionContractId` utk flow aktif (cuma audit),
   tidak ada data corruption — hanya audit trail beda.

⚠️ **Test v27 di 1 quest dulu** sebelum full rollout. Kalau Accept/Collect gagal
(runtime party rights / scan-proxy / holdings issue), fee flow gagal = user tidak
bisa claim. Minta user test FCFS dulu, cek log, baru buka quest lain.

---

## §6. Troubleshooting

### `AppPaymentRequest_Accept failed`
- Cek user punya Amulet holdings cukup utk cover fee (+ decay buffer).
- Cek `CANTON_WALLET_PROVIDER_PARTY_ID` = validator party.
- Cek service-account actAs `[user, walletProvider]` (CanActAsAnyParty).
- Cek scan-proxy reachable: `curl http://127.0.0.1:5003/.../amulet-rules`.

### `AcceptedAppPayment_Collect failed`
- Cek actAs 4 party: `[admin, user, platformParty, treasuryParty]`.
- Cek `CANTON_APP_PROVIDER_PARTY_ID` + `CANTON_FEE_RECIPIENT_PARTY_ID` terisi.

### `Reward CIP-56 fail` (fee OK tapi reward gagal)
- Tidak fatal — fee sudah committed. Reward bisa retry via queue (JOB_DISTRIBUTE_REWARD).
- Cek reward wallet balance (funded?).
- Cek user punya TransferPreapproval (kalau tidak, reward jadi pending offer —
  user harus accept manual di wallet inbox).

### `WRONGLY_TYPED_CONTRACT`
- Biasanya `CANTON_DAML_PACKAGE_NAME` salah hash. Verifikasi §2/§3.

---

## §7. Yang TIDAK di-test di sini (butuh live node)

Code di sini hanya di-typecheck (0 error). Live test Canton (Accept/Collect
funds movement) **harus** di VPS. Yang tidak bisa diverifikasi dari code:
- Scan-proxy amulet-rules/openMiningRound reachable di runtime.
- Service-account CanActAsAnyParty aktif (runtime participant state).
- User holdings cukup utk Accept.
- 4-party Collect actAs resolve sukses.

Jalankan §4 smoke test utk verifikasi end-to-end.
