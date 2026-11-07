-- KASIRPRO AI — skema langganan bulanan
-- Aman dijalankan berulang kali dan aman untuk database lama (data pelanggan lama tetap utuh).
-- Neon: SQL Editor > paste seluruh isi file > Run

-- ========== Tabel pelanggan ==========
create table if not exists users (
  id            serial primary key,
  email         text not null,
  name          text not null,
  phone         text not null,
  pass_hash     text not null,
  created_at    timestamptz not null default now(),
  trial_ends_at timestamptz not null,
  paid_until    timestamptz,
  revoked       boolean not null default false,
  constraint users_email_key unique (email),
  constraint users_phone_key unique (phone)
);

-- Kolom baru untuk langganan (diabaikan bila sudah ada)
alter table users add column if not exists plan_id    text    not null default 'M';
alter table users add column if not exists auto_renew boolean not null default true;

-- ========== Paket ==========
create table if not exists plans (
  id         text primary key,
  name       text not null,
  days       int  not null check (days > 0),
  price      int  not null check (price >= 0),
  sort       int  not null default 0,
  active     boolean not null default true
);

insert into plans (id, name, days, price, sort) values
  ('M', 'Bulanan',  30,  49000, 1),
  ('Q', '3 Bulan',  90, 129000, 2),
  ('Y', 'Tahunan', 365, 449000, 3)
on conflict (id) do nothing;

-- ========== Tagihan ==========
-- Setiap tagihan = satu periode langganan. Harga & jumlah hari disalin saat tagihan dibuat
-- supaya perubahan harga paket tidak mengubah tagihan yang sudah terbit.
create table if not exists invoices (
  id           serial primary key,
  invoice_no   text not null unique,
  user_id      int  not null references users(id) on delete cascade,
  plan_id      text not null,
  plan_name    text not null,
  days         int  not null check (days > 0),
  amount       int  not null check (amount >= 0),
  status       text not null default 'unpaid' check (status in ('unpaid','paid','void')),
  source       text not null default 'auto'   check (source in ('auto','customer','admin')),
  created_at   timestamptz not null default now(),
  due_at       timestamptz not null,
  paid_at      timestamptz,
  paid_method  text,
  paid_ref     text,
  note         text not null default ''
);

-- Maksimal SATU tagihan belum bayar per pelanggan (mencegah tagihan ganda dari cron / klik berulang)
create unique index if not exists invoices_one_open_per_user on invoices (user_id) where status = 'unpaid';
create index if not exists invoices_user_idx   on invoices (user_id, created_at desc);
create index if not exists invoices_status_idx on invoices (status, due_at);

-- ========== Pembatas percobaan login ==========
create table if not exists login_attempts (
  id         bigserial primary key,
  email      text not null,
  ip         text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists login_attempts_email_idx on login_attempts (email, created_at desc);

-- ========== Tabel lama ==========
-- license_codes (kode aktivasi sekali beli) tidak lagi dipakai oleh aplikasi.
-- Tabelnya sengaja TIDAK dihapus agar riwayat lama tetap tersimpan.
create table if not exists license_codes (
  code       text primary key,
  plan       text not null,
  days       int  not null check (days > 0),
  note       text not null default '',
  created_at timestamptz not null default now(),
  used_by    int references users(id) on delete set null,
  used_at    timestamptz
);
