# CanQuest Earn — Product spec (May 2026)

Dokumen ini mengunci keputusan produk dari founder sebelum implementasi.
**Quest** (kampanye partner) tetap seperti sekarang. **Earn** adalah menu baru di bawah Quest.

---

## 1. Navigasi

| Menu | Route | Isi |
|------|-------|-----|
| **Earn** | `/earn` | Kampanye partner (Quest Center) |
| **Quest** | `/quest` | Task harian CanQuest + poin + redeem |

Redirect: `/quests` → `/earn`, `/quest/:id` → `/earn/:id` (bookmark lama).

---

## 2. Task types (kelola dari Admin → quest **CanQuest Earn**)

Semua task: **tambah / edit / hapus / points / urutan / target** dari dashboard admin (satu quest hub `CanQuest Earn`).

| Task | Catatan |
|------|---------|
| `daily_check_in` | Streak milestone (lihat §3) |
| `twitter_follow` | Verifikasi via **twitterAPI.io** (bukan honor system jangka panjang) |
| `twitter_retweet` | Idem |
| `telegram_channel` | Target = link channel |
| `telegram_group` | Target = link group |
| `discord_join` | Target = invite link |
| `quiz_yes_no` | Jawaban benar → points; salah → 0 |
| `quiz_choice` | Pilihan A/B/C/D; `correctAnswer` di admin |
| Lainnya | Bisa ditambah sebagai type baru + admin label |

**Wallet wajib** sebelum submit task Earn atau redeem.

---

## 3. Daily check-in & streak

- User check-in sekali per hari (UTC atau timezone app — tentukan saat implement).
- **Milestone streak** (hari berturut-turut) memberi bonus points.
- Default milestone yang diminta: **1, 3, 5, 7, 14, 15, 30** hari  
  (catatan: input awal menyebut "2" — dianggap typo; semua milestone **editable di admin**).
- Admin mengatur: hari milestone + points per milestone + optional base points per check-in harian.

---

## 4. Poin Earn & redeem

- User mengumpulkan **Earn points** dari task terverifikasi + streak.
- Poin bisa **ditukar** (redeem) ke reward yang dikonfigurasi admin, contoh:
  - **CC** (kirim via Splice ke wallet user)
  - **Waitlist code** (atau kode dari pool)
  - **Lainnya** (label + payload custom — perlu definisi teknis per tipe)
- Semua opsi redeem: **tambah / edit / hapus / biaya points** di admin.

---

## 5. Admin

- **Tidak** menu admin terpisah — kelola di quest existing **"CanQuest Earn"** (`questKind = EARN_HUB`).
- Tab/section khusus di quest detail:
  - Tasks (sama seperti quest lain)
  - Streak config
  - Redemption catalog
- Quest kampanye partner tetap `CAMPAIGN` — tidak tampil di halaman `/earn` user.

---

## 6. Verifikasi sosial (Twitter)

- Target: integrasi **[twitterAPI.io](https://twitterapi.io)**.
- Env: `TWITTERAPI_IO_KEY` (dan endpoint yang dipakai).
- Flow (usulan):
  1. User connect / submit handle Twitter (sekali per akun).
  2. Saat submit task follow/retweet → backend cek API → `VERIFIED` atau `REJECTED` + pesan.
- Telegram / Discord: fase awal bisa tetap **klik + auto-verify**; verifikasi API opsional nanti.

---

## 7. Arsitektur teknis (usulan)

### Data model

- `Quest.questKind`: `CAMPAIGN` | `EARN_HUB`
- `User.earnPoints`: saldo poin (Int)
- `EarnStreakConfig`: linked ke earn quest — JSON milestones
- `EarnRedemptionOption`: type, costPoints, payload (cc amount, pool id, dll.)
- `EarnCheckInLog`: userId, date, streakCount
- `EarnRedemptionLog`: audit redeem

### API (usulan)

- `GET /earn` — hub: tasks, points, streak, redeem options
- `POST /earn/check-in`
- `POST /earn/redeem/:optionId`
- Task submit: reuse `POST /quests/:id/tasks/:taskId/submit` untuk earn quest id

### Web

- Halaman `/earn` + nav **Earn** → `/earn`; kampanye di `/quest`
- Gate: no wallet → arahkan ke `/wallet`
- Panel redeem + streak UI

### Fase implementasi

| Fase | Deliverable |
|------|-------------|
| **1** | Schema, seed CanQuest Earn, `/earn` + nav, wallet gate, task panel reuse, admin flag EARN_HUB |
| **2** | Check-in + streak + earn points credit |
| **3** | Redemption catalog admin + redeem CC / waitlist |
| **4** | twitterAPI.io untuk follow/retweet |
| **5** | Quiz yes/no UI polish; Telegram/Discord API opsional |

---

## 8. Yang tidak berubah

- Wallet send/receive + platform fee (sudah production-ready di TestNet).
- Quest DAML tetap **parked** (`QUEST_LEDGER_ENABLED=false`).
- Kampanye partner tetap di menu **Quest**.

---

## Resume phrase untuk agent

```
Lanjutkan Earn dari docs/EARN_PRODUCT_SPEC.md — cek fase terakhir di git/SESSION_HANDOFF, lalu lanjut fase berikutnya.
```
