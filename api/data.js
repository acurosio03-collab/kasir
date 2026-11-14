const crypto = require('crypto');
const { sql, send, body, authUser, subState, wrap, httpError } = require('../lib/core');

/*
 * Data kasir per akun.
 *   GET  /api/data  -> seluruh data milik akun yang login (produk, transaksi, pengeluaran, pengaturan)
 *   POST /api/data  -> { ops: [...] } perubahan data
 *
 * ATURAN KEAMANAN
 *  - owner_id SELALU = id pengguna dari token sesi yang diverifikasi server (authUser).
 *    Field owner_id / user_id yang dikirim browser tidak pernah dibaca.
 *  - Setiap query membawa "owner_id = <id sesi>"; tidak ada query tanpa filter pemilik.
 *  - Akun diblokir: ditolak. Langganan berakhir: boleh baca (untuk backup), tidak boleh menulis.
 *  - Setiap operasi punya id unik (oid) sehingga pengiriman ulang tidak menggandakan perubahan.
 */

const MAX_OPS = 100;

const id64 = (v) => (typeof v === 'string' && /^[A-Za-z0-9_.\-]{1,64}$/.test(v) ? v : null);
const str = (v, max) => String(v == null ? '' : v).slice(0, max);
const num = (v) => { const n = Number(v); return Number.isFinite(n) && Math.abs(n) < 1e13 ? n : null; };
const bad = (m) => httpError(400, m);

function cleanProduct(v) {
  if (!v || typeof v !== 'object') throw bad('Produk tidak valid.');
  const id = id64(v.id), name = str(v.name, 120).trim();
  const buy = num(v.buy), price = num(v.price), stock0 = num(v.stock), min0 = num(v.min);
  const stock = stock0 === null ? null : Math.round(stock0), min = min0 === null ? null : Math.round(min0);
  if (!id || !name || buy === null || price === null || stock === null || min === null || buy < 0 || price < 0 || min < 0)
    throw bad('Data produk tidak valid.');
  return { id, name, sku: str(v.sku, 64), category: str(v.category, 60) || 'Umum', buy, price, stock, min, emoji: str(v.emoji, 8) || '📦' };
}

function cleanSale(v) {
  if (!v || typeof v !== 'object') throw bad('Transaksi tidak valid.');
  const id = id64(v.id);
  const date = new Date(v.date);
  if (!id || isNaN(date)) throw bad('Data transaksi tidak valid.');
  if (!Array.isArray(v.items) || v.items.length > 300) throw bad('Item transaksi tidak valid.');
  const items = v.items.map((i) => {
    const q = num(i && i.qty), p = num(i && i.price), b = num(i && i.buy);
    if (!i || q === null || p === null || b === null || q <= 0) throw bad('Item transaksi tidak valid.');
    return { id: str(i.id, 64), name: str(i.name, 120), price: p, buy: b, qty: q };
  });
  const f = {};
  for (const k of ['subtotal', 'discount', 'taxPct', 'tax', 'total', 'cash', 'change']) {
    f[k] = num(v[k]);
    if (f[k] === null) throw bad('Nilai transaksi tidak valid.');
  }
  const status = v.status === 'void' ? 'void' : 'ok';
  const uid = id64(v.uid) || crypto.randomBytes(8).toString('hex');
  const data = {
    id, uid, date: date.toISOString(), cashier: str(v.cashier, 60), customer: str(v.customer, 120), items, ...f,
    payment: str(v.payment, 30), status
  };
  if (v.voidAt && !isNaN(new Date(v.voidAt))) data.voidAt = new Date(v.voidAt).toISOString();
  return { id, uid, date: data.date, status, total: f.total, data };
}

function cleanExpense(v) {
  if (!v || typeof v !== 'object') throw bad('Pengeluaran tidak valid.');
  const id = id64(v.id), amount = num(v.amount);
  if (!id || amount === null || !/^\d{4}-\d{2}-\d{2}$/.test(String(v.date)) || isNaN(new Date(v.date))) throw bad('Data pengeluaran tidak valid.');
  return { id, date: String(v.date), category: str(v.category, 60) || 'Lainnya', note: str(v.note, 200), amount };
}

function cleanSettings(v) {
  if (!v || typeof v !== 'object') throw bad('Pengaturan tidak valid.');
  const tax = num(v.tax);
  return {
    business: str(v.business, 120), address: str(v.address, 200), phone: str(v.phone, 40),
    header: str(v.header, 300), footer: str(v.footer, 500), cashier: str(v.cashier, 60) || 'Kasir',
    tax: tax === null ? 0 : Math.min(100, Math.max(0, tax)), paper: v.paper === '58' ? '58' : '80', autoPrint: v.autoPrint === true
  };
}

// Setiap pernyataan dibuka dengan "g": mencatat oid. Bila oid sudah pernah dicatat, g kosong dan perubahan dilewati.
function buildStatement(s, owner, op) {
  const oid = id64(op && op.oid);
  if (!oid) throw bad('Operasi tidak valid.');

  switch (op.t) {
    case 'product.put': {
      const p = cleanProduct(op.v);
      // Saat produk sudah ada, stok TIDAK ditimpa (stok hanya berubah lewat stock.adj / sale) agar aman dari dua perangkat.
      return s`with g as (insert into applied_ops (owner_id, oid) values (${owner}, ${oid}) on conflict do nothing returning 1)
        insert into products (owner_id, id, name, sku, category, buy, price, stock, min_stock, emoji, created_at)
        select ${owner}::int, ${p.id}::text, ${p.name}::text, ${p.sku}::text, ${p.category}::text, ${p.buy}::numeric, ${p.price}::numeric, ${p.stock}::int, ${p.min}::int, ${p.emoji}::text, clock_timestamp()
         where exists (select 1 from g)
        on conflict (owner_id, id) do update
          set name = excluded.name, sku = excluded.sku, category = excluded.category, buy = excluded.buy,
              price = excluded.price, min_stock = excluded.min_stock, emoji = excluded.emoji, updated_at = now()`;
    }
    case 'stock.adj': {
      const id = id64(op.id), d0 = num(op.delta), d = d0 === null ? null : Math.round(d0);
      if (!id || d === null) throw bad('Penyesuaian stok tidak valid.');
      return s`with g as (insert into applied_ops (owner_id, oid) values (${owner}, ${oid}) on conflict do nothing returning 1)
        update products set stock = stock + ${d}::int, updated_at = now()
         where owner_id = ${owner} and id = ${id} and exists (select 1 from g)`;
    }
    case 'product.del': {
      const id = id64(op.id);
      if (!id) throw bad('Produk tidak valid.');
      return s`with g as (insert into applied_ops (owner_id, oid) values (${owner}, ${oid}) on conflict do nothing returning 1)
        delete from products where owner_id = ${owner} and id = ${id} and exists (select 1 from g)`;
    }
    case 'sale.put': {
      const x = cleanSale(op.v);
      const j = JSON.stringify(x.data);
      // 1) transaksi yang sama (uid sama) -> diperbarui (mis. dibatalkan/void)
      // 2) id belum dipakai -> disisipkan
      // 3) id bentrok dengan transaksi LAIN (dua perangkat membuat nomor sama) -> disisipkan dengan akhiran, tidak menimpa
      return s`with g as (insert into applied_ops (owner_id, oid) values (${owner}, ${oid}) on conflict do nothing returning 1),
        upd as (
          update sales set sale_date = ${x.date}::timestamptz, status = ${x.status}::text, total = ${x.total}::numeric, data = ${j}::jsonb, updated_at = now()
           where owner_id = ${owner} and id = ${x.id} and sale_uid = ${x.uid} and exists (select 1 from g) returning 1
        ), ins as (
          insert into sales (owner_id, id, sale_uid, sale_date, status, total, data, created_at)
          select ${owner}::int, ${x.id}::text, ${x.uid}::text, ${x.date}::timestamptz, ${x.status}::text, ${x.total}::numeric, ${j}::jsonb, clock_timestamp()
           where exists (select 1 from g) and not exists (select 1 from upd)
             and not exists (select 1 from sales where owner_id = ${owner} and id = ${x.id})
          returning 1
        )
        insert into sales (owner_id, id, sale_uid, sale_date, status, total, data, created_at)
        select ${owner}::int, ${x.id + '-' + x.uid.slice(0, 4)}::text, ${x.uid}::text, ${x.date}::timestamptz, ${x.status}::text, ${x.total}::numeric,
               jsonb_set(${j}::jsonb, '{id}', to_jsonb(${x.id + '-' + x.uid.slice(0, 4)}::text)), clock_timestamp()
         where exists (select 1 from g) and not exists (select 1 from upd) and not exists (select 1 from ins)`;
    }
    case 'sale.del': {
      const id = id64(op.id);
      if (!id) throw bad('Transaksi tidak valid.');
      return s`with g as (insert into applied_ops (owner_id, oid) values (${owner}, ${oid}) on conflict do nothing returning 1)
        delete from sales where owner_id = ${owner} and id = ${id} and exists (select 1 from g)`;
    }
    case 'expense.put': {
      const e = cleanExpense(op.v);
      return s`with g as (insert into applied_ops (owner_id, oid) values (${owner}, ${oid}) on conflict do nothing returning 1)
        insert into expenses (owner_id, id, exp_date, category, note, amount, created_at)
        select ${owner}::int, ${e.id}::text, ${e.date}::text, ${e.category}::text, ${e.note}::text, ${e.amount}::numeric, clock_timestamp()
         where exists (select 1 from g)
        on conflict (owner_id, id) do update
          set exp_date = excluded.exp_date, category = excluded.category, note = excluded.note, amount = excluded.amount`;
    }
    case 'expense.del': {
      const id = id64(op.id);
      if (!id) throw bad('Pengeluaran tidak valid.');
      return s`with g as (insert into applied_ops (owner_id, oid) values (${owner}, ${oid}) on conflict do nothing returning 1)
        delete from expenses where owner_id = ${owner} and id = ${id} and exists (select 1 from g)`;
    }
    case 'settings.put': {
      const j = JSON.stringify(cleanSettings(op.v));
      return s`with g as (insert into applied_ops (owner_id, oid) values (${owner}, ${oid}) on conflict do nothing returning 1)
        insert into store_settings (owner_id, data) select ${owner}::int, ${j}::jsonb where exists (select 1 from g)
        on conflict (owner_id) do update set data = excluded.data, updated_at = now()`;
    }
    case 'clear': {
      // 'products' = semua produk; 'tx' = semua transaksi + pengeluaran; 'all' = ketiganya. Pengaturan toko tidak pernah ikut terhapus.
      if (op.what === 'products') {
        return s`with g as (insert into applied_ops (owner_id, oid) values (${owner}, ${oid}) on conflict do nothing returning 1)
          delete from products where owner_id = ${owner} and exists (select 1 from g)`;
      }
      if (op.what === 'all') {
        return s`with g as (insert into applied_ops (owner_id, oid) values (${owner}, ${oid}) on conflict do nothing returning 1),
          a as (delete from sales where owner_id = ${owner} and exists (select 1 from g) returning 1),
          b as (delete from expenses where owner_id = ${owner} and exists (select 1 from g) returning 1)
          delete from products where owner_id = ${owner} and exists (select 1 from g)`;
      }
      if (op.what === 'tx') {
        return s`with g as (insert into applied_ops (owner_id, oid) values (${owner}, ${oid}) on conflict do nothing returning 1),
          a as (delete from sales where owner_id = ${owner} and exists (select 1 from g) returning 1)
          delete from expenses where owner_id = ${owner} and exists (select 1 from g)`;
      }
      throw bad('Operasi clear tidak valid.');
    }
    default:
      throw bad('Jenis operasi tidak dikenal.');
  }
}

async function snapshot(owner) {
  const s = sql();
  const [prods, sales, exps, set] = await Promise.all([
    s`select id, name, sku, category, buy::float8 as buy, price::float8 as price, stock, min_stock as min, emoji from products where owner_id = ${owner} order by created_at, id`,
    s`select data from sales where owner_id = ${owner} order by sale_date, created_at, id`,
    s`select id, exp_date as date, category, note, amount::float8 as amount from expenses where owner_id = ${owner} order by created_at, id`,
    s`select data from store_settings where owner_id = ${owner}`
  ]);
  const js = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
  return {
    owner,
    products: prods.map((p) => ({ id: p.id, name: p.name, sku: p.sku, category: p.category, buy: Number(p.buy), price: Number(p.price), stock: Number(p.stock), min: Number(p.min), emoji: p.emoji })),
    sales: sales.map((r) => js(r.data)),
    expenses: exps.map((e) => ({ id: e.id, date: e.date, category: e.category, note: e.note, amount: Number(e.amount) })),
    settings: set[0] ? js(set[0].data) : null,
    empty: !(prods.length || sales.length || exps.length || set.length)
  };
}

module.exports = wrap(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return send(res, 405, { error: 'Metode tidak diizinkan.' });
  }
  const u = await authUser(req);
  if (!u) return send(res, 401, { error: 'Sesi berakhir, silakan masuk lagi.' });
  if (u.revoked) return send(res, 403, { error: 'Akun dinonaktifkan. Hubungi admin.' });
  const owner = u.id; // satu-satunya sumber owner_id

  if (req.method === 'GET') return send(res, 200, { ...(await snapshot(owner)), serverNow: Date.now() });

  if (subState(u).locked) return send(res, 402, { error: 'Langganan berakhir. Perpanjang untuk menyimpan perubahan.', locked: true });

  const b = body(req);
  if (!Array.isArray(b.ops) || b.ops.length === 0 || b.ops.length > MAX_OPS) return send(res, 400, { error: 'Daftar operasi tidak valid.' });
  const s = sql();
  const stmts = b.ops.map((op) => buildStatement(s, owner, op)); // validasi semua dulu sebelum menulis apa pun
  await s.transaction(stmts);
  send(res, 200, { ok: true, applied: stmts.length });
});
