# Panduan Deploy DAML Contract ke VPS

**Package:** `canquest-v4` v1.0.0 | **SDK:** 3.4.11  
**Templates:** 9 (UserAccount, WalletRegistration, QuestCampaign, QuestClaim, DailyCheckIn, SpinExecution, SpinCcReward, ReferralReward, CcTransactionLog)

---

## Prasyarat

- VPS sudah punya DAML SDK 3.4.11 terinstall
- SSH tunnel ke Canton JSON API aktif di port 7575
- `apps/api/.env` sudah dikonfigurasi dengan benar

### Install DAML SDK (jika belum ada)

```bash
curl -sSL https://get.daml.com/ | sh -s 3.4.11
source ~/.bashrc   # atau logout + login ulang
daml version       # verifikasi: harus tampil 3.4.11
```

---

## Langkah Deploy

### 1. Pull kode terbaru ke VPS

```bash
cd /path/to/canquest
git pull origin main
```

### 2. Build + Test DAML contract

```bash
# Build saja (tanpa upload)
bash scripts/daml-build-vps.sh

# ATAU build + upload sekaligus (jika tunnel sudah aktif)
bash scripts/daml-build-vps.sh --upload
```

Output yang diharapkan:
```
[OK] BUILD SUCCESS
[OK] ALL TESTS PASSED
[OK] Package ID: <64-char hex>
```

### 3. Upload DAR ke Canton ledger (jika tidak pakai --upload)

Pastikan SSH tunnel aktif dulu:
```bash
# Di terminal terpisah (atau gunakan screen/tmux)
ssh -N -L 7575:<DOCKER_IP>:7575 user@VPS1_IP
```

Lalu upload:
```bash
cd apps/api
node scripts/upload-daml-dar.cjs
```

Output sukses:
```
Upload OK: 200
Add to apps/api/.env:
CANTON_DAML_PACKAGE_NAME=canquest-v4
CANTON_DAML_PACKAGE_ID=<package-id>
```

### 4. Update `.env` di VPS

```bash
nano apps/api/.env
```

Tambahkan/update baris berikut:
```env
CANTON_DAML_PACKAGE_NAME=canquest-v4
CANTON_DAML_PACKAGE_ID=<package-id-dari-step-3>
QUEST_LEDGER_ENABLED=true
CLAIM_SESSION_LEDGER_ENABLED=true
```

### 5. Restart API

```bash
pm2 restart canquest-api
pm2 logs canquest-api --lines 50
```

Cek log — tidak boleh ada error `DAML` atau `Canton`:
```
[OK] Canton JSON API reachable
[OK] UserAccount created: @username
```

### 6. Verifikasi package ter-deploy

```bash
cd apps/api
node scripts/verify-daml-package.cjs
```

---

## Troubleshooting

### Build gagal: `daml: command not found`
```bash
export PATH="$HOME/.daml/bin:$PATH"
# Atau tambahkan ke ~/.bashrc
```

### Test gagal: `submitMustFail` tidak sesuai
Pastikan file `packages/daml/daml/Main.daml` sudah yang terbaru (9 templates).

### Upload gagal: `connection refused port 7575`
SSH tunnel belum aktif. Jalankan:
```bash
ssh -N -L 7575:<DOCKER_IP>:7575 user@VPS1_IP &
curl http://127.0.0.1:7575/livez   # harus HTTP 200
```

### Upload gagal: `401 Unauthorized`
Cek `CANTON_SPLICE_SECRET` di `.env`. Untuk testnet biasanya `unsafe`.

### API error: `DAML package not found`
Package ID di `.env` tidak cocok dengan yang ter-deploy. Jalankan ulang:
```bash
cd packages/daml
~/.daml/bin/daml damlc inspect-dar .daml/dist/canquest-v4-1.0.0.dar | grep -oE '[0-9a-f]{64}' | head -1
```
Salin hasilnya ke `CANTON_DAML_PACKAGE_ID` di `.env`.

---

## Ringkasan File yang Diubah (canquest-v4 baru)

| File | Perubahan |
|------|-----------|
| `packages/daml/daml/Main.daml` | +2 template baru: `ReferralReward`, `CcTransactionLog`; QuestCampaign support `CC_AND_CODE_RAFFLE` & `WAITLIST`; QuestClaim +`RevealRewardCode` choice |
| `packages/daml/daml/Test.daml` | 14 test sections, 55+ test cases |
| `packages/daml/daml.yaml` | Komentar diupdate |
| `apps/api/src/canton/quest-ledger.service.ts` | +`ReferralReward`/`CcTransactionLog` di TPL map; +`revealRewardCode()`, `recordReferralReward()`, `recordCcTransactionLog()`, `settleCcTransactionLog()`, `mapRewardTypeToQuestKind()` |
| `scripts/daml-build-vps.sh` | +flag `--upload` untuk auto-upload setelah build |

---

## Mapping RewardType → questKind DAML

| Backend `RewardType` | DAML `questKind` | Claim Flow |
|---------------------|-----------------|------------|
| `CC_ONLY` (dengan maxWinners) | `CC_FCFS` | ClaimFcfsSlot → ConfirmFeePaid → ConfirmRewardSent |
| `CC_ONLY` (tanpa maxWinners) | `CC_RAFFLE` | DrawRaffleWinner → ConfirmFeePaid → ConfirmRewardSent |
| `CC_MANUAL` | `CC_RAFFLE` | DrawRaffleWinner → ConfirmFeePaid → ConfirmRewardSent |
| `CC_AND_INVITE` | `CC_FCFS` | ClaimFcfsSlot → ConfirmRewardSent |
| `INVITE_CODE_FCFS` | `CODE_FCFS` | ClaimFcfsSlot → ConfirmFeePaid → RevealRewardCode |
| `INVITE_CODE_RANDOM` / `INVITE_CODE` | `CODE_RAFFLE` | DrawRaffleWinner → ConfirmFeePaid → RevealRewardCode |
| `CC_AND_CODE_RAFFLE` | `CC_AND_CODE_RAFFLE` | DrawRaffleWinner → ConfirmFeePaid → ConfirmRewardSent + RevealRewardCode |
| `WAITLIST_EMAIL` | `WAITLIST` | DrawRaffleWinner → ConfirmRewardSent (fee=0) |
