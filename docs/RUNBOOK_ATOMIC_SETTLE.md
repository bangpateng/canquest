# Runbook — Fix Claim Reward Non-Atomic (fee + reward pisah)

> **Gejala:** Saat claim reward, fee dan reward terkirim sebagai **2 transaksi terpisah**
> (tidak atomic). Harusnya: keduanya dalam 1 transaction tree (DAML Settle choice).
>
> **Tanggal:** 2026-08-06
> **Repo state:** master, HEAD `d1e267a` (4 commit local belum di-push!)
> **DAML:** v23 (tetap, **TIDAK perlu v24**)

---

## TL;DR — 3 Langkah

```
1. DIAGNOSTIK   → kenapa non-atomic? (Skenario A atau B — lihat §1)
2. FIX          → sesuai hasil diagnostik (§2 atau §3)
3. VERIFIKASI   → test claim real, cek atomicity (§4)
```

**Tidak ada perubahan DAML.** Penyebab non-atomic ada di **config backend + deploy fix**,
bukan di kontrak. Jangan buat v24.

---

## §0. PENTING — Push commit lokal dulu

Repo lokal **ahead 4 commit** dari `origin/master`:

```
git push origin master
```

Tanpa ini, `git pull` di VPS 2 tidak akan ambil perubahan apapun. Cek dulu:
```bash
git log origin/master..HEAD --oneline   # harus KOSONG setelah push
```

---

## §1. DIAGNOSTIK — Kenapa Non-Atomic? (WAJIB jalan dulu)

Ada 2 skenario penyebab. **Jalankan diagnostik ini di VPS 2 sebelum fix apapun**,
karena solusinya beda.

### Diagnostik A — Cek config atomic di VPS 2

SSH ke VPS 2, lalu:
```bash
cd /var/www/canquest/apps/api

echo "=== 1. QUEST_ATOMIC_SETTLE (harus tidak ada = unset, atau tidak 'false') ==="
grep -i "QUEST_ATOMIC_SETTLE" .env || echo "(unset → default ikut isClaimSessionConfigured)"

echo ""
echo "=== 2. CLAIM_SESSION_LEDGER_ENABLED (harus tidak 'false') ==="
grep -i "CLAIM_SESSION_LEDGER_ENABLED" .env || echo "(unset → OK, default true)"

echo ""
echo "=== 3. CANTON_OPERATOR_PARTY_ID (harus ada value, tidak kosong) ==="
grep -i "CANTON_OPERATOR_PARTY_ID" .env || echo "(MISSING! → atomic OFF)"

echo ""
echo "=== 4. CANTON_REWARD_PARTY_ID (harus ada value) ==="
grep -i "CANTON_REWARD_PARTY_ID" .env || echo "(MISSING!)"
```

### Diagnostik B — Cek log claim terakhir

```bash
# Lihat log pm2 untuk keyword atomic
pm2 logs canquest-api --lines 500 --nostream | grep -iE \
  "useAtomicSettle|settleAndRecord|settleAtomic|collectClaimFee|non-atomic|Settle OK|Settle fail|context|meta|atomic"

# Atau journalctl kalau bukan pm2:
# journalctl -u canquest-api --since "1 hour ago" | grep -iE "settle|atomic"
```

### Interpretasi Hasil → Pilih Path

| Hasil Diagnostik | Skenario | Ke § |
|---|---|---|
| Log ada `settleAtomic` / `Settle OK` TAPI juga `collectClaimFee` | **B — Settle jalan tapi ada bug fallback** | §3 |
| Log ada `settleAtomic` lalu `Settle fail` / `Missing non-optional fields: Set(context, meta)` | **B — fix d060b9a belum deploy** | §3 |
| Log **tidak ada** `settleAtomic` sama sekali, hanya `collectClaimFee` | **A — atomic OFF (flag/party id)** | §2 |
| `CANTON_OPERATOR_PARTY_ID` kosong/missing | **A — atomic forced OFF** | §2 |

---

## §2. FIX SKENARIO A — Atomic OFF (config)

Penyebab: backend pakai path v21 (fee terpisah + reward terpisah) karena
`useAtomicSettle` return false. Logika (`quests.service.ts:706-710`):
```
useAtomicSettle = false  JIKA  QUEST_ATOMIC_SETTLE = "false"/"0"
                           ATAU isClaimSessionConfigured() = false
isClaimSessionConfigured() = false  JIKA  CLAIM_SESSION_LEDGER_ENABLED = "false"/"0"
                                       ATAU CANTON_OPERATOR_PARTY_ID kosong
```

### Fix A — Set env + redeploy

```bash
cd /var/www/canquest/apps/api

# Edit .env (pakai editor favorit: nano/vim)
nano .env
```

Pastikan:
```dotenv
# Atomic Settle WAJIB ON (jangan set false kecuali emergency kill-switch)
# Kalau baris ini tidak ada → biarkan kosong (default ON)
QUEST_ATOMIC_SETTLE=true

# Claim session ledger ON (default ON kalau unset)
CLAIM_SESSION_LEDGER_ENABLED=true

# WAJIB ada value — tanpa ini atomic OFF paksa
CANTON_OPERATOR_PARTY_ID=<party-id-operator-anda>
CANTON_REWARD_PARTY_ID=<party-id-reward-anda>
```

Cek value party id yang benar di `HANDOFF_DAML_V23.md` §6 (PARTY IDs production).

Lalu rebuild + restart:
```bash
cd /var/www/canquest
git pull origin master          # pastikan latest
cd apps/api
npm run build
pm2 restart canquest-api --update-env
```

→ Lanjut ke **§4 Verifikasi**.

---

## §3. FIX SKENARIO B — Settle Gagal (context/meta)

Penyebab: atomic path aktif, tapi Settle choice gagal dengan error:
```
Missing non-optional fields: Set(context, meta)
```
Ini karena backend kirim `ExtraArgs` dengan `context`/`meta` null/kosong.
**Fix sudah ada di commit `d060b9a`** (helper `safeContext` default `{values:{}}`).

### Fix B — Deploy commit d060b9a

```bash
cd /var/www/canquest
git pull origin master          # ambil d060b9a + semua commit sampai HEAD
git log --oneline -3            # VERIFIKASI: d060b9a harus ADA di history
# Harus muncul: ... d060b9a fix(api): settleAtomic — ExtraArgs context/meta non-optional default

cd apps/api
npm run build                   # NestJS build (prisma generate + nest build)
pm2 restart canquest-api --update-env
```

### Verifikasi fix d060b9a sudah load

```bash
pm2 logs canquest-api --lines 30 --nostream | grep -iE "settle|atomic|context"
grep -n "safeContext" src/canton/quest-ledger.service.ts   # harus nemu line ~758
```

→ Lanjut ke **§4 Verifikasi**.

### ⚠️ Jika Settle MASIH gagal setelah d060b9a

Kemungkinan error berikutnya (prioritas investigasi):
1. **`extraArgs.meta` shape salah** — DAML minta `{values: {}}`, bukan `{}`. Cek
   `quest-ledger.service.ts:708,741,762,765` sudah pakai `meta: { values: {} }`.
2. **TransferFactory_Transfer arg `expectedAdmin` mismatch** — baca `Main.daml:289,302`.
3. **Disclosed contracts kurang** — Settle butuh FAR/WalletUserProxy disclosed.
   Lihat `canton-ledger.service.ts:891-897`.

Jika error baru muncul, **capture full log** (`pm2 logs --lines 500 --nostream`),
paste ke chat ZCode untuk debug.

---

## §4. VERIFIKASI — Atomicity Real

### Test 1 — Claim reward baru (CC)

Lakukan claim real di web/app (quest CC FCFS yang masih ada slot).

### Test 2 — Cek atomicity di log

```bash
pm2 logs canquest-api --lines 200 --nostream | grep -iE \
  "settleAtomic|Settle OK|Settle fail|collectClaimFee|non-atomic"
```

**PASS jika:**
- ✅ Ada `Settle OK` (atau `settleAtomic OK`)
- ✅ **TIDAK ada** `collectClaimFee` di claim yang sama
- ✅ **TIDAK ada** `Settle fail`

**FAIL jika** masih ada `collectClaimFee` → kembali ke §1 Diagnostik (mungkin Skenario A).

### Test 3 — Cek di Canton Ledger (1 tx tree = atomic)

Cari transaction tree dari claim tadi. Fee transfer + reward transfer harus
jadi **child nodes** dari 1 root transaction (bukan 2 root tx terpisah).

```bash
# Lihat updateId di log, lalu query transaction tree
# (sesuaikan command dengan setup Ledger API Anda)
```

---

## §5. ROLLBACK (kalau parah)

Atomic path bikin claim gagal total? Emergency kill-switch:

```bash
cd /var/www/canquest/apps/api
# Set atomic OFF → fallback ke path v21 (non-atomic tapi jalan)
# Tambah/ubah di .env:
echo "QUEST_ATOMIC_SETTLE=false" >> .env
pm2 restart canquest-api --update-env
```

Setelah stabil, investigasi root cause lalu balik ke `true`.

---

## §6. CATATAN TEKNIS

### Kenapa TIDAK perlu DAML v24?
- Penyebab non-atomic = **config backend + fix context/meta**, bukan kontrak DAML.
- DAML v23 sudah 7/7 PASS + live di participant node.
- "Field shadowing" di RecordTxId (`feeTxId` arg vs field) **bukan compile error**
  di SDK 3.4.11 — terbukti v23 sudah compile & live.

### Mismatch DAML SDK (FYI, bukan blocker)
- `daml.yaml`: `sdk-version: 3.4.11`
- `apps/api/package.json` script `daml:build`: docker image
  `digitalasset/daml-sdk:3.3.0-snapshot.20250930.0`
- **Catatan:** kalau nanti butuh rebuild DAML, image docker harus update ke 3.4.11
  atau daml build bisa warning/error version mismatch. Sekarang tidak relevan karena
  tidak ada rebuild DAML.

### 4 commit lokal belum di-push
```
d1e267a docs(7lock)
6e10070 docs(7trust)
2fc2b8d docs(7trust)
e0968c3 docs(handoff)
```
Push dulu sebelum `git pull` di VPS (lihat §0).

---

## Checklist Eksekusi

- [ ] `git push origin master` (push 4 commit lokal)
- [ ] SSH VPS 2, jalankan **§1 Diagnostik A**
- [ ] Jalankan **§1 Diagnostik B** (grep log)
- [ ] Tentukan skenario → ke §2 atau §3
- [ ] Fix sesuai skenario
- [ ] **§4 Verifikasi**: test claim real + cek `Settle OK` + tidak ada `collectClaimFee`
- [ ] Kalau gagal: capture log, kembali ke §1 atau paste ke chat ZCode
