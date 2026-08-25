# Cara Menjalankan Mockup CanQuest

File mockup:
- `mockup-dapp.html` (1 file, ±197 KB, self-contained) — seluruh alur app
- `mockup-wallet.html` — khusus menu **Wallet** versi terkini (hero balance,
  aksi Send/Receive/Offers/Swap/Lock/Activity, daftar token CC/USDCx/CBTC,
  plus semua modal interaktif). Responsif: di layar HP modal otomatis kompak
  (judul tetap di atas, konten scroll, tombol selalu terlihat di bawah).

Semua cara di bawah juga berlaku untuk `mockup-wallet.html` (ganti nama file).

## Cara tercepat (tanpa instalasi apa pun)
1. Buka **File Explorer** → masuk folder proyek
2. **Double-click** file `mockup-dapp.html`
3. Otomatis terbuka di browser default (Chrome/Edge/Firefox)

Itu saja. Tidak butuh server, tidak butuh VS Code, tidak butuh instalasi.
Setiap perubahan yang Anda simpan → tekan **F5** atau **Ctrl+R** di browser untuk refresh.

---

## Cara pakai VS Code (recommended untuk edit + preview berdampingan)

### Setup sekali
1. Buka VS Code → buka folder proyek ini (`File → Open Folder`)
2. Install ekstensi **Live Server** (oleh Ritwick Dey):
   - Klik ikon Extensions (Ctrl+Shift+X) → cari "Live Server" → Install

### Jalankan
1. Di panel kiri (Explorer), **klik kanan** file `mockup-dapp.html`
2. Pilih **"Open with Live Server"**
3. Browser otomatis terbuka di `http://127.0.0.1:5500/mockup-dapp.html`
4. Setiap kali Anda simpan file (Ctrl+S) → browser **auto-refresh** sendiri

### Keuntungan pakai Live Server
- Auto-refresh setiap simpan (tidak perlu tekan F5 manual)
- URL konsisten (tidak `file:///...` yang kadang bikin masalah di beberapa fitur)
- Bisa buka di banyak device di jaringan lokal (untuk test di HP)

---

## Cara alternatif: Python (tanpa VS Code)
Kalau Anda punya Python terinstall:
```
cd "C:\Users\Bang Pateng\Documents\can"
python -m http.server 5500
```
Lalu buka browser ke `http://localhost:5500/mockup-dapp.html`

---

## Cara test di HP / mobile view
### Opsi A: DevTools Chrome
1. Buka mockup di Chrome
2. Tekan **F12** (buka DevTools)
3. Klik ikon **device toolbar** (Ctrl+Shift+M) — panel mobile muncul
4. Pilih device (iPhone, Pixel, dll) atau atur lebar manual

### Opsi B: HP asli di WiFi yang sama
1. Jalankan dengan Live Server (dapat URL seperti `http://192.168.1.5:5500/...`)
2. Buka URL itu di browser HP (harus WiFi yang sama dengan PC)

---

## Daftar halaman & cara akses
Gunakan sidebar/bottom-nav untuk navigasi, atau ketik URL langsung:

| Halaman | URL hash |
|---|---|
| Overview | `#/overview` |
| Earn (grid campaign) | `#/earn` |
| Detail campaign | `#/earn/quest?id=NAMACAMPAIGN` |
| Quests (daily tasks) | `#/quests` |
| Wallet | `#/wallet` |
| Create wallet | `#/wallet/setup` |
| Leaderboard | `#/leaderboard` |
| Settings | `#/settings` |
| Activity | `#/activity` |

### Preview cepat reward reveal (tanpa klik task)
Tambah `&claim=1` ke URL detail:
- `#/earn/quest?id=novapay&claim=1` → modal CC reward
- `#/earn/quest?id=aqualend&claim=1` → modal USDCx reward
- `#/earn/quest?id=cryptogate&claim=1` → modal USDCx + Code
- `#/earn/quest?id=glint&claim=1` → modal Code FCFS

### Daftar campaign (untuk ganti `id=` di URL)
novapay, glint, mintx, pulsenet, orbitfi, zenithx,
aqualend, swiftswap, raffleusd, cryptogate, ccraffle, coderaffle

---

## Cara edit mockup
Buka `mockup-dapp.html` di editor apa pun (VS Code, Notepad++, dll).

### Yang sering diedit:
- **Warna brand** → cari `:root` di bagian `<style>` (line ~60)
  - `--canton-rgb: 90 217 138;` = warna hijau utama (RGB)
  - `--background: #07080d;` = warna latar
  - `--primary-strong: #72e8a4;` = hijau terang
- **Data campaign** → cari `const CAMPAIGNS = [` (sekitar line 1475)
  - Tambah/edit/hapus campaign di situ
  - Field: `id, org, title, desc, banner, type, rewardPerWinnerCc/Usdcx, claimFee, slots, dll`
- **Tipe reward** → cari `const TYPE_CONFIG = {` (sekitar line 1605)
  - Warna ikon, label per tipe
- **Teks/profile** → cari "Aria Rahman" / "@aria_canton" dan ganti

### Setelah edit:
- **Live Server**: simpan (Ctrl+S) → browser auto-refresh
- **Double-click biasa**: simpan → tekan F5 di browser

---

## Kalau ada error
Mockup punya error display otomatis: kalau ada JS error, kotak merah muncul di
pojok kiri bawah dengan pesan error. Itu membantu Anda debug saat edit.

Kalau bingung pesan error-nya, salin teks error-nya dan kirim ke saya.
