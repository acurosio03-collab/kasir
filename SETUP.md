# KASIRPRO AI — Langganan Bulanan (Neon + Vercel)

Konsep: banyak pelanggan (toko), masing-masing bayar per periode. Sistem menerbitkan tagihan **otomatis**,
mengingatkan pelanggan, memperpanjang masa aktif saat Anda konfirmasi pembayaran, dan mengunci akun yang tidak bayar.
Pembayaran tetap manual lewat WhatsApp (tanpa payment gateway).

## Isi proyek

| File | Fungsi |
|---|---|
| `index.html` | Aplikasi kasir + halaman Akun & Langganan pelanggan |
| `admin.html` | Panel admin: ringkasan, pelanggan, tagihan, paket & harga |
| `api/register.js`, `api/login.js`, `api/me.js` | Daftar, masuk, status akun |
| `api/subscribe.js` | Pelanggan minta tagihan / ganti paket / berhenti berlangganan |
| `api/admin.js` | Semua aksi admin (dilindungi `ADMIN_KEY`) |
| `api/cron-billing.js` | Penagihan otomatis harian (dijalankan Vercel Cron) |
| `lib/core.js` | Logika bersama (status langganan, tagihan, pembayaran atomik) |
| `schema.sql` | Tabel database. Aman dijalankan ulang dan aman untuk database lama |
| `vercel.json` | Jadwal cron harian |

File yang dihapus karena sisa pengerjaan multiuser yang belum selesai dan tidak kompatibel:
`api/activate.js`, `api/cashiers.js`, `api/cashier-list.js`, `api/cashier-status.js`, `api/db-test.js`, `api/logout.js`, `api/products.js`, `lib/auth.js`, `lib/session.js`, `lib/db.js`.
Kode aktivasi lama (`activate`) diganti sistem tagihan.

## 1. Perbarui database Neon
1. Neon > **SQL Editor**, tempel seluruh isi `schema.sql`, klik **Run**.
2. Data pelanggan lama tetap utuh. Mereka otomatis diberi paket Bulanan dan tagihan otomatis menyala.
   Tabel `license_codes` tidak dihapus (hanya tidak dipakai lagi).

## 2. Upload ke GitHub (repo PRIVATE) dan deploy di Vercel
Ganti isi repo dengan isi folder ini (struktur `api/` dan `lib/` harus sama). Framework Preset: **Other**.

## 3. Environment Variables (Vercel > Settings > Environment Variables)

| Nama | Isi |
|---|---|
| `DATABASE_URL` | connection string dari Neon (`postgresql://...`) |
| `SESSION_SECRET` | teks acak panjang, mis. `openssl rand -hex 32` |
| `ADMIN_KEY` | kata sandi panel admin (min. 8 karakter, makin panjang makin baik) |
| `CRON_SECRET` | teks acak panjang (min. 16 karakter). **Baru, wajib.** Vercel otomatis memakainya saat memanggil cron |

Setelah menambah variabel, lakukan **Redeploy**.
Cron berjalan tiap hari pukul 02.00 WIB (`0 19 * * *` UTC). Paket Hobby Vercel mengizinkan cron satu kali per hari, cukup untuk sistem ini.
Cek di Vercel > **Settings > Cron Jobs** bahwa `/api/cron-billing` terdaftar. Tombol **Run** di sana bisa dipakai untuk uji manual.

## 4. Aturan langganan (sudah diprogram)

| Kondisi | Status | Kasir |
|---|---|---|
| Uji coba 14 hari | Uji coba | Terbuka |
| Sudah bayar, belum habis | Aktif | Terbuka |
| Lewat jatuh tempo, ≤ 3 hari | Jatuh tempo (toleransi) | **Masih terbuka**, ada banner peringatan |
| Lewat 3 hari | Berakhir | **Terkunci** sampai bayar |
| Diblokir admin | Diblokir | Terkunci |

- **Tagihan otomatis:** 7 hari sebelum masa aktif habis (juga untuk akhir uji coba), sistem membuat tagihan paket yang dipakai pelanggan.
  Pelanggan melihat banner + tagihan di aplikasinya. Tidak pernah ada dua tagihan terbuka untuk satu pelanggan.
- **Bayar:** pelanggan tekan **Bayar via WhatsApp** (pesan sudah berisi no. tagihan dan jumlah) > Anda cek mutasi > di admin tekan **Konfirmasi bayar**.
  Masa aktif bertambah otomatis. Bayar lebih awal tidak menghanguskan sisa hari. Bayar saat sudah terkunci dihitung dari hari ini.
  Konfirmasi dua kali tidak akan menambah masa aktif dua kali.
- **Berhenti berlangganan:** pelanggan mematikan tagihan otomatis; tidak ada tagihan baru dan akun terkunci setelah masa aktif habis. Bisa dinyalakan lagi.
- **Harga:** ubah di admin > **Paket & harga**. Hanya berlaku untuk tagihan baru; tagihan yang sudah terbit tidak berubah.
- Tidak ada pemotongan otomatis dari rekening/kartu. "Otomatis" berarti tagihan, pengingat, perpanjangan, dan penguncian berjalan sendiri.

## 5. Rutinitas harian Anda
1. Buka `https://alamat-anda.vercel.app/admin.html`, masuk dengan `ADMIN_KEY`.
2. Tab **Ringkasan** > bagian "Perlu ditindak hari ini" menampilkan pelanggan yang segera habis, jatuh tempo, atau baru terkunci.
3. Tombol **Ingatkan WA** membuka WhatsApp dengan pesan pengingat siap kirim.
4. Setelah ada pembayaran masuk, **Konfirmasi bayar** (pilih metode dan catat referensi).

## 6. Pengujian dari HP Android
1. Buka alamat Vercel di Chrome > **Daftar** akun baru (WhatsApp unik) > pastikan badge "Uji coba: 14 hari lagi".
2. Di admin (bisa dari HP lain), tab **Pelanggan** > **+ Buat tagihan** untuk akun tadi > kirim lewat WhatsApp.
3. Di aplikasi pelanggan, buka **Akun & Langganan**, tekan **Periksa ulang**: tagihan muncul.
4. Admin tekan **Konfirmasi bayar**. Di aplikasi pelanggan tekan **Periksa ulang**: status berubah **Langganan aktif**.
5. Uji penguncian: di admin tekan **+ Hari** dengan angka negatif besar (mis. `-400`), lalu **Periksa ulang** di aplikasi. Status akan masuk toleransi lalu terkunci.
6. Uji pengingat otomatis: di Vercel > Cron Jobs tekan **Run** pada `/api/cron-billing`; pelanggan yang masa aktifnya ≤ 7 hari akan mendapat tagihan.

## Batasan yang perlu Anda ketahui
- **Data kasir (produk, transaksi, struk) masih tersimpan di browser tiap perangkat**, sama seperti sebelumnya. Server hanya mengatur akun dan langganan.
  Penguncian bekerja di aplikasi berdasarkan status dari server (dicek tiap 10 menit saat online, dan boleh offline maksimal 7 hari).
  Ini cukup untuk memastikan pelanggan yang tidak bayar terkunci, tetapi bukan perlindungan terhadap orang yang sengaja membongkar kode di browsernya sendiri.
  Memindahkan data kasir ke Neon (dan fitur multiuser Admin/Kasir) adalah tahap terpisah.
- Pembayaran dikonfirmasi manual oleh Anda. Jika nanti pelanggan banyak, tahap berikutnya adalah Midtrans/Xendit agar konfirmasi otomatis.
- Satu orang tetap bisa daftar lagi dengan email dan nomor WhatsApp lain untuk uji coba baru. Pendaftaran dibatasi 5 akun per jam per jaringan, dan login dibatasi 5 kali gagal per 15 menit per email.
- `admin.html` bisa dibuka publik tetapi semua aksinya butuh `ADMIN_KEY`. Ganti di Vercel jika bocor.
