# KASIRPRO AI — Kasir UMKM dengan Langganan Bulanan

Aplikasi kasir berbasis HTML, CSS, dan JavaScript dengan akun pelanggan, uji coba 14 hari, dan langganan bulanan
(tagihan otomatis, perpanjangan, masa toleransi, penguncian). Backend: Vercel Serverless + Neon PostgreSQL.

Cara memasang dan mengoperasikan: lihat **SETUP.md**.

Data kasir tersimpan per akun di Neon (isolasi owner_id), routing hash `#/halaman`, dan antrean offline. Fitur kasir (tidak berubah): dashboard, POS, produk & stok, transaksi, laporan, pengeluaran, struk 58/80 mm, ekspor CSV, backup JSON, PWA.

Dibuat untuk konsep GERDY HENDRAMAN.
