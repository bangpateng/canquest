# HANDOFF DAML v31 — CanQuest (19 Agustus 2026)

> ⚠️ **CATATAN RENAME (19 Agt 2026, sore):** paket yang dipromosikan ke produksi
> diberi nama **`canquest-v29`** (bukan v31) — keputusan user agar penomoran
> produksi berurutan 28 → 29; iterasi workspace v29–v31 dikonsolidasikan ke
> satu paket v29 (isi kontrak identik dengan yang dijelaskan dokumen ini).
> DAR: `canquest-v29-1.0.0.dar` (test 120 transaksi hijau). Backend default
> `#canquest-v29`. Baca "v31" pada dokumen ini sebagai "paket hasil
> konsolidasi" (= v29 produksi).

> Dokumen ini dibuat untuk melanjutkan pekerjaan di chat/sesi baru.
> Baca file ini sampai selesai sebelum mengerjakan apa pun.
> Prompt pembuka untuk chat baru ada di bagian paling bawah.

## 1. Status saat ini

| Item | Status |
|---|---|
| Kontrak `Main.daml` v31 (9 template, FIX-13/14/15) | ✅ Selesai, teruji |
| Test suite `Test.daml` (120 transaksi, ±45 test negatif) | ✅ Hijau semua |
| Build DAR (`canquest-0.1.0.dar`) | ✅ Sukses |
| Sinkronisasi ke `packages/daml` (repo) | ❌ Langkah 1 (belum) |
| Penyesuaian backend (apps/api) | ✅ Langkah 2 (19 Agt 2026 — lihat §4a) |
| Smoke test mainnet (Settle/ExecuteTransfer asli) | ✅ SELESAI 19 Agt — run bersih tanpa error (updateId 1220a425f6a2: create→eligibility→ClaimSlot→Settle atomic reward=true→RecordTxId; lihat RUNBOOK §10) |
| Deploy VPS produksi | ✅ SELESAI 19-20 Agt — backend v29 live; cek SQL 20 Agt: 0 quest v28 aktif (jalur legacy tak terjangkau); go-live tinggal END campaign test + buat campaign asli |

**Lokasi file kerja terbaru (DI LUAR REPO):** `C:\Users\Bang Pateng\test\`
- `daml/Main.daml` — kontrak v31 (sumber kebenaran terbaru)
- `daml/Test.daml` — test suite lengkap
- `daml.yaml` — SDK 3.4.11 + 3 data-deps DAR v2 + `daml-script`
- `dars/` — `splice-api-token-transfer-instruction-v2-current.dar`, `splice-api-token-metadata-v1-current.dar`, `splice-api-featured-app-v2-1.0.0.dar`
- `.daml/dist/canquest-0.1.0.dar` — hasil build

**Repo produksi masih v28** (`packages/daml`, 4 DAR transfer-instruction-v1) — harus disinkronkan (Langkah 1).

## 2. Fakta teknis PENTING (jangan sampai salah asumsi di chat baru)

1. **Contract keys TIDAK dipakai dan TIDAK bisa dipakai.** SDK 3.x (compiler "Core to Daml-LF") menghapus dukungan contract keys sepenuhnya (terbukti lewat eksperimen lokal + forum Canton Network). Klaim "butuh Daml-LF 2.3/Canton 3.5" adalah MISINFORMASI. Konsekuensi: uniqueness `campaignId`/`claimId`/`lockId`/eligibility dijamin **off-chain di backend** (dedupe DB sebelum submit).
2. **Template Splice (`TransferFactory`, `Holding`, `FeaturedAppRight`) bersifat ENCAPSULATED** — hanya bisa dibuat dari package-nya sendiri. Konsekuensi: `Settle`/`ExecuteTransfer` tidak bisa di-exercise di `daml test` (parameternya butuh `ContractId TransferFactory`). Guard-nya sudah diverifikasi review kode; eksekusi nyata divalidasi lewat smoke test devnet (Langkah 3).
3. **API Daml Script SDK 3.4 berbeda dari SDK 2.x:** `allocateParty` (bukan `getParty`), `createCmd`/`exerciseCmd`/`archiveCmd` (model command), `queryContractId <party-pengamat> <cid>` (butuh party), `getTime`/`addRelTime`/`passTime`. `daml-script` harus ada di `dependencies` daml.yaml.
4. **Daml LF target valid di 3.4.11 hanya 2.x** (1.15 dan 2.3 tidak dikenal). Default saja, jangan set `--target`.
5. Import data-dep di Script: modul yang di-*stitch* transitif (mis. `Splice.Api.Token.HoldingV2`) tersembunyi — jangan di-import; hanya konstruksi record (`Transfer`, `Account`, `InstrumentId`, `ExtraArgs`, `Metadata`) yang aman lintas modul.

## 3. Perbaikan keamanan yang SUDAH diterapkan di v31

- **[FIX-13]** `claimFeeCc > 0.0` di `ensure` QuestCampaign + QuestClaimReceipt — menutup deadlock campaign fee-0 (dulu: bisa diklaim tapi Settle selalu gagal, receipt macet di PRE_SETTLE).
- **[FIX-14]** Whitelist `questKind` (CC_FCFS/CODE_FCFS/CC_RAFFLE/CODE_RAFFLE/CC_AND_CODE_RAFFLE/WAITLIST) dan `eligibilityType` (LOCK_CC/POINTS) di `ensure` — menutup lubang terbesar: dulu eligibilityType asing masuk cabang `_ -> pure ()` = klaim TANPA cek eligibility.
- **[FIX-15]** Assert di `Settle`: campaign dengan `rewardCc > 0` WAJIB menyertakan transfer reward on-chain (`rewardFactoryCid`/`rewardTransfer`/`rewardExtraArgs` != None).
- Sebelumnya (v30, sudah ada): FIX-8 (validasi receiver fee on-chain), FIX-9 (pin instrument), FIX-10 (kode rahasia tidak bocor via SecretRewardCode), FIX-11 (cross-check lockId), FIX-12 (hapus contract keys).

**Temuan tersisa (belum diubah, disetujui untuk didokumentasikan):**
- #4 `ForceUnlock` bisa dari status LOCKED langsung (kuasa admin darurat) — dokumentasikan atau tambah assert status.
- #5 Timestamp bertipe `Text` — WAJIB konsisten ISO-8601 Zuru (`YYYY-MM-DDTHH:MM:SSZ`) karena perbandingan leksikografik.
- #6 Dedupe off-chain (lihat Langkah 2).

## 4. ROADMAP

### 4a. Catatan eksekusi Langkah 2 (19 Agt 2026 — commit `feat(api): align backend with canquest-v29`)

1. **Codegen TIDAK dijalankan** — diverifikasi (grep seluruh apps/api + apps/web): backend tidak memakai binding TS hasil `daml codegen`; integrasi via Canton JSON API dengan template-ID string. Ekuivalen "codegen ulang" = update template ID/payload di `quest-ledger.service.ts` (dilakukan).
2. **eligibilityType "NONE" tidak sah di kontrak (FIX-14)** → di-map `NONE`→`POINTS` amount 0 saat create campaign; claim path (`resolveEligibilityCid`) kini SELALU membuat CampaignEligibility (auto-issue POINTS proof bila tanpa gate).
3. **CoinLock**: dibuat 2-step (`CoinLockProposal`→`AcceptLock`) di `quest-ledger.createCoinLock`, lazy saat claim LOCK_CC, lockId deterministik `lock:<questId>:<userId>`. Konstrain `durationDays ∈ {3,7,15}` → term asli dipetakan ke terdekat (produksi 30d→15d; `expiresAt` asli dipertahankan — guard kontrak tidak mencocokkan keduanya). **Saran masa depan**: samakan `LOCK_TERM_OPTIONS` dengan whitelist kontrak.
4. **Reward non-CC (USDCx) TIDAK lewat Settle on-chain**: Settle v31 mem-pin fee DAN reward ke satu pasangan instrument (Amulet/DSO) → campaign USDCx dibuat `rewardCc=0` di chain, delivery tetap jalur token terpisah (konsisten FIX-15: rewardCc=0 tidak wajib leg reward).
5. **TransferInstructionV2** (verifikasi dari source splice 0.6.12): `sender/receiver` = Account `{owner:<party>, provider:null, id:""}`; TANPA field `lock`; registry endpoint `/registry/transfer-instruction/v2/transfer-factory`; factory = ExternalPartyAmuletRules; Amulet mengimplementasikan Holding V1+V2 dan FAR V1+V2. `callTransferFactoryRegistry` sekarang menerima param `version` ('v1' default — jalur wallet/swap lama tidak berubah).
6. **Dedupe DB** (pengganti contract keys): unique baru — `Quest.ledgerCampaignId`, `WinnerDraw.claimId`, `CcLock.lockedAmuletCid` + kolom `CampaignEligibilityLedger.lockId/coinLockCid` (migration `20260819120000_v31_dedupe_constraints`, deploy via `prisma migrate deploy`). Pre-submit: admin skip bila quest sudah punya kontrak; claimId jalur invite jadi deterministik (tanpa `Date.now()`). "1 eligibility per user per campaign" sudah ada (`@@unique([questId,userId])`).
7. **Timestamp Zulu** detik-presisi (`YYYY-MM-DDTHH:MM:SSZ`) via helper `zulu()/toZulu()` untuk SEMUA field Text waktu on-chain (perbandingan leksikografik aman); field DAML `Time` (requestedAt/executeBefore) tetap RFC3339 ms.
8. **Env wajib tambahan utk create campaign**: `CANTON_REWARD_PARTY_ID`, `CANTON_FEE_RECIPIENT_PARTY_ID`, `CANTON_DSO_PARTY_ID` (field `trusted*`); opsional `CANTON_APP_PROVIDER_PARTY_ID` (FAR).
9. **claimFeeCc**: admin kini resolve default 2 (kode) / 3 (CC-token) bila null — sebelumnya `?? 0` yang ditolak ensure FIX-13.
10. Verifikasi: `npm run build` OK; jest 65/65 lulus. Lint: 0 error baru (68 error warisan `as any` lama — tidak disentuh).

### Langkah 1 — Promosikan v31 ke repo produksi
1. Salin `C:\Users\Bang Pateng\test\daml\Main.daml` dan `Test.daml` → `packages/daml/daml/`; pindahkan `Main.daml` v28 lama → `packages/daml/legacy/Main.v28.legacy.daml`.
2. `packages/daml/daml.yaml`: `name: canquest-v29`, dependencies `daml-prim`, `daml-stdlib`, `daml-script`, data-dependencies 3 DAR:
   `splice-api-token-transfer-instruction-v2-current.dar`, `splice-api-token-metadata-v1-current.dar`, `splice-api-featured-app-v2-1.0.0.dar` (hapus 4 DAR v1 lama dari daftar).
3. `scripts/fetch-daml-deps.sh`: ganti array `TARGETS` menjadi 3 nama file di atas (bundle splice-node yang sama, `SPLICE_VERSION` tetap 0.6.12).
4. Verifikasi di `packages/daml`: `daml test` (harus `test: ok, ±120 transactions`) dan `daml build` (DAR tercipta).
5. Commit dengan pesan ala: `feat(daml): promote canquest-v29 (security fixes FIX-13..15) + full test suite`.

### Langkah 2 — Penyesuaian backend (apps/api)
File terdampak (hasil survei): `apps/api/src/canton/quest-ledger.service.ts` (terikat `canquest-v28`/codegen lama), `apps/api/src/quests/quests.service.ts`, alur wallet (`username`/`inviteCode` → `userProfileRef`, registrasi 2-step baru: `WalletRegistrationProposal` → `Accept` oleh user).
1. Codegen ulang dari DAR v31 (`daml codegen`), sesuaikan import/usage.
2. Implement alur registrasi wallet 2-step dan field baru.
3. **WAJIB: dedupe DB** `campaignId`/`claimId`/`lockId` + "1 eligibility aktif per user per campaign" sebelum submit transaksi (pengganti contract keys). Cek dulu apakah sudah ada; kalau tidak, tambahkan (unique constraint + cek sebelum submit).
4. Konvensi timestamp ISO-8601 Zulu di semua endpoint yang menulis `lockedAt`/`createdAt`/dll.

### Langkah 3 — Smoke test devnet (menutup celah pengujian)
Deploy DAR v31 ke devnet (`docker-compose.dev.yml`, participant 0.6.12), lalu dengan `TransferFactory` asli:
- [ ] `ClaimSlot` → `Settle`: fee sampai ke treasury, reward sampai ke user, receipt SETTLED (`feePaid=True`, `rewardSent=True`).
- [ ] `Settle` dengan fee/reward salah amount → DITOLAK (validasi on-chain bekerja di ledger nyata).
- [ ] `PlatformTransfer.ExecuteTransfer` happy + cancel.
- [ ] `FeaturedAppRight_CreateActivityMarker` terbentuk (jika FAR dipakai).
- [ ] `RecordTxId`/`RevealCode`/`SecretRewardCode.Reveal` normal.

### Langkah 4 — Deploy produksi VPS
Ikuti runbook eksisting (`HANDOFF_7TRUST_DEPLOY.md`, `7LOCK_RUNBOOK_VPS1.md`, `scripts/daml-build-vps.sh`): build DAR di VPS (fetch DAR data-dep dulu) → upload ke participant → deploy backend. Hanya setelah Langkah 3 hijau.

## 5. Cara verifikasi cepat (perintah)

```bash
cd packages/daml          # (atau C:\Users\Bang Pateng\test saat ini)
daml test                 # harus: test: ok — 120 transactions
daml build                # harus: Created .daml/dist/<name>.dar
```

Catatan: `daml` CLI ada di `C:\Users\Bang Pateng\AppData\Roaming\daml\bin\daml.cmd`; SDK 3.4.11 & 2.10.6 terpasang lokal.

## 6. Prompt pembuka untuk chat baru (copy-paste)

```
Baca file HANDOFF_DAML_V31.md di root repo sampai selesai, lalu kerjakan
Langkah 1 persis seperti di roadmap (promosi kontrak v31 dari
C:\Users\Bang Pateng\test ke packages/daml + update daml.yaml +
scripts/fetch-daml-deps.sh + verifikasi daml test & daml build).
Jangan ubah Main.daml/Test.daml selain yang disebut. Setelah Langkah 1
hijau, laporkan hasilnya dulu sebelum lanjut Langkah 2.
```
