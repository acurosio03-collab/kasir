-- Jalankan sekali di Neon: SQL Editor > paste > Run

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

create table if not exists license_codes (
  code       text primary key,
  plan       text not null,
  days       int  not null check (days > 0),
  note       text not null default '',
  created_at timestamptz not null default now(),
  used_by    int references users(id) on delete set null,
  used_at    timestamptz
);

create index if not exists license_codes_created_idx on license_codes (created_at desc);
