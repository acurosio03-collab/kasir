# Pemasangan KASIRPRO AI (Neon + Vercel)

Isi folder ini:

| File | Fungsi |
|---|---|
| `index.html` | Aplikasi kasir (halaman utama) |
| `admin.html` | Panel admin: buat kode, lihat pelanggan, blokir, reset password |
| `api/*.js`, `lib/core.js` | Server (Vercel Serverless Functions) |
| `schema.sql` | Tabel database untuk Neon |
| `package.json` | Daftar paket (`@neondatabase/serverless`) |

## 1. Buat database di Neon
1. Daftar/masuk di neon.tech, buat **Project** baru (pilih region Singapore agar cepat).
2. Buka menu **SQL Editor**, tempel seluruh isi `schema.sql`, klik **Run**.
3. Di dashboard project, klik **Connect** dan salin **connection string** (diawali `postgresql://`). Simpan, jangan dibagikan.

## 2. Upload ke GitHub (repo PRIVATE)
Buat repo **private**, lalu upload semua isi folder ini (struktur folder `api/` dan `lib/` harus tetap sama).

## 3. Deploy di Vercel
1. **Add New > Project**, pilih repo tadi. Framework Preset: **Other**. Jangan ubah Build Command.
2. Buka **Settings > Environment Variables**, tambahkan tiga variabel:

| Nama | Isi |
|---|---|
| `DATABASE_URL` | connection string dari Neon |
| `SESSION_SECRET` | teks acak panjang, mis. hasil `openssl rand -hex 32` |
| `ADMIN_KEY` | kata sandi admin Anda (minimal 8 karakter, makin panjang makin baik) |

3. Klik **Deploy** (atau Redeploy kalau variabel ditambahkan setelah deploy pertama).

## 4. Cara memakai
- Pelanggan membuka alamat Vercel Anda, **Daftar** dengan nama toko, WhatsApp, email, dan password. Trial 14 hari mulai otomatis dan dihitung di server.
- Setelah trial habis aplikasi terkunci. Pelanggan memilih paket di halaman **Akun & Langganan**, chat WhatsApp ke Anda, dan membayar.
- Anda buka `https://alamat-anda.vercel.app/admin.html`, masukkan `ADMIN_KEY`, tab **Buat kode**, pilih paket, lalu kirim kodenya lewat tombol WhatsApp.
- Pelanggan memasukkan kode di **Akun & Langganan > Aktivasi kode**. Kode hanya bisa dipakai sekali dan langsung memperpanjang akunnya.
- Tab **Pelanggan** untuk menambah hari, memblokir akun, atau mereset password pelanggan yang lupa (kirim password baru lewat WhatsApp).

## Yang bisa disesuaikan
- **Harga & nama paket tampilan:** `SUB_CFG.plans` di `index.html`.
- **Nomor WhatsApp & info pembayaran:** `SUB_CFG.wa` dan `SUB_CFG.payInfo` di `index.html`.
- **Lama trial:** `TRIAL_DAYS` di `lib/core.js` (ubah juga `SUB_CFG.trialDays` di `index.html` untuk teks).
- **Batas pemakaian offline:** `SUB_CFG.offlineDays` (bawaan 7 hari).

## Catatan penting
- Data kasir (produk, transaksi, struk) tetap disimpan di browser tiap perangkat. Akun hanya mengatur langganan. Pelanggan yang ganti perangkat perlu memindahkan data lewat fitur backup.
- Satu orang masih bisa membuat akun baru dengan email dan nomor WhatsApp lain untuk trial baru. Nomor WhatsApp dibuat unik untuk mempersulit hal ini.
- Aplikasi memeriksa status ke server tiap 10 menit saat online. Saat offline, aplikasi tetap bisa dipakai sampai 7 hari sejak terakhir terverifikasi.
- `admin.html` bisa diakses publik tetapi semua aksinya butuh `ADMIN_KEY`. Jangan bagikan kunci itu. Ganti di Vercel kalau bocor.
- Belum ada pembatasan percobaan login berulang. Untuk skala besar, tambahkan rate limiting (mis. Vercel Firewall).
