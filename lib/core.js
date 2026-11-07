// Fungsi bersama untuk semua endpoint /api (Vercel Serverless Functions + Neon Postgres)
const crypto = require('crypto');

const TRIAL_DAYS = 14;    // lama uji coba gratis
const SESSION_DAYS = 30;  // lama sesi login
const GRACE_DAYS = 3;     // masa toleransi setelah jatuh tempo: kasir masih bisa dipakai, belum terkunci
const REMIND_DAYS = 7;    // tagihan berikutnya diterbitkan otomatis sekian hari sebelum masa aktif habis
const DAY = 864e5;

let _sql = null;
function sql() {
  if (!_sql) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL belum diatur di Vercel.');
    const { neon } = require('@neondatabase/serverless');
    _sql = neon(process.env.DATABASE_URL);
  }
  return _sql;
}

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error('SESSION_SECRET belum diatur di Vercel (minimal 16 karakter).');
  return s;
}

const b64u = (s) => Buffer.from(s).toString('base64url');

function signToken(payload) {
  const body = b64u(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return body + '.' + sig;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!p.exp || p.exp < Date.now()) return null;
    return p;
  } catch { return null; }
}

// Sidik singkat dari hash password: kalau password diganti/direset, semua sesi lama otomatis tidak berlaku.
const passTag = (hash) => crypto.createHash('sha256').update(String(hash)).digest('hex').slice(0, 12);

function newSession(u) {
  return signToken({ uid: u.id, pt: passTag(u.pass_hash), exp: Date.now() + SESSION_DAYS * DAY });
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 64);
  return salt.toString('hex') + ':' + h.toString('hex');
}

function checkPassword(pw, stored) {
  const [s, h] = String(stored || '').split(':');
  if (!s || !h) return false;
  const calc = crypto.scryptSync(pw, Buffer.from(s, 'hex'), 64);
  const hb = Buffer.from(h, 'hex');
  return hb.length === calc.length && crypto.timingSafeEqual(hb, calc);
}

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

function method(req, res, m) {
  if (req.method !== m) {
    res.setHeader('Allow', m);
    send(res, 405, { error: 'Metode tidak diizinkan.' });
    return false;
  }
  return true;
}

function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { /* abaikan */ } }
  return {};
}

const ms = (x) => (x ? new Date(x).getTime() : 0);

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/**
 * Status langganan, dihitung dari tanggal (satu-satunya sumber kebenaran).
 *  trial    : uji coba berjalan
 *  active   : sudah bayar & masih berlaku
 *  grace    : sudah lewat jatuh tempo tapi masih dalam masa toleransi (BELUM terkunci)
 *  expired  : lewat masa toleransi -> terkunci
 *  revoked  : diblokir admin -> terkunci
 */
function subState(u, now = Date.now()) {
  const paid = ms(u.paid_until), trial = ms(u.trial_ends_at);
  const end = Math.max(paid, trial);
  const graceEnd = end + GRACE_DAYS * DAY;
  let state;
  if (u.revoked) state = 'revoked';
  else if (paid > now) state = 'active';
  else if (!paid && trial > now) state = 'trial';
  else if (now <= graceEnd) state = 'grace';
  else state = 'expired';
  return { state, end, graceEnd, locked: state === 'revoked' || state === 'expired' };
}

function planPub(p) {
  return { id: p.id, name: p.name, days: p.days, price: p.price };
}

function invoicePub(i) {
  return {
    id: i.id, no: i.invoice_no, planId: i.plan_id, planName: i.plan_name, days: i.days,
    amount: i.amount, status: i.status, createdAt: ms(i.created_at), dueAt: ms(i.due_at),
    paidAt: ms(i.paid_at), paidMethod: i.paid_method || ''
  };
}

// Bentuk data akun yang dikirim ke aplikasi (waktu dalam epoch milidetik)
function pub(u) {
  const st = subState(u);
  return {
    user: { id: u.id, email: u.email, name: u.name, phone: u.phone },
    trialEnd: ms(u.trial_ends_at),
    paidUntil: ms(u.paid_until),
    revoked: !!u.revoked,
    planId: u.plan_id || 'M',
    autoRenew: u.auto_renew !== false,
    graceDays: GRACE_DAYS,
    remindDays: REMIND_DAYS,
    state: st.state,
    serverNow: Date.now()
  };
}

function normPhone(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('0')) d = '62' + d.slice(1);
  return d;
}

function clientIp(req) {
  const f = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return (f || (req.socket && req.socket.remoteAddress) || '').slice(0, 64);
}

async function authUser(req) {
  const h = req.headers.authorization || '';
  const p = verifyToken(h.replace(/^Bearer\s+/i, ''));
  if (!p || !Number.isInteger(p.uid)) return null;
  const rows = await sql()`select * from users where id = ${p.uid}`;
  const u = rows[0];
  if (!u || p.pt !== passTag(u.pass_hash)) return null;
  return u;
}

function invoiceNo() {
  const d = new Date();
  const ym = String(d.getUTCFullYear()).slice(2) + String(d.getUTCMonth() + 1).padStart(2, '0');
  return `INV-${ym}-${String(crypto.randomInt(100000)).padStart(5, '0')}`;
}

/**
 * Terbitkan tagihan baru. Tagihan belum-bayar yang lama otomatis dibatalkan (void) dalam satu transaksi,
 * dan indeks unik di database menjamin tidak pernah ada dua tagihan terbuka untuk satu pelanggan.
 */
async function createInvoice(userId, planId, source, dueAt) {
  const s = sql();
  const plan = (await s`select * from plans where id = ${planId} and active = true`)[0];
  if (!plan) throw httpError(400, 'Paket tidak ditemukan atau tidak aktif.');
  const due = new Date(dueAt).toISOString();
  for (let i = 0; i < 5; i++) {
    const no = invoiceNo();
    try {
      const r = await s.transaction([
        s`update invoices set status = 'void', note = 'Digantikan tagihan baru' where user_id = ${userId} and status = 'unpaid'`,
        s`insert into invoices (invoice_no, user_id, plan_id, plan_name, days, amount, source, due_at)
          values (${no}, ${userId}, ${plan.id}, ${plan.name}, ${plan.days}, ${plan.price}, ${source}, ${due}::timestamptz)
          returning *`
      ]);
      return r[1][0];
    } catch (e) {
      if (e && e.code === '23505') {
        if (/invoice_no/.test(String(e.constraint || e.message))) continue; // nomor bentrok, coba nomor lain
        throw httpError(409, 'Tagihan sedang diproses, coba lagi sebentar.');
      }
      throw e;
    }
  }
  throw httpError(500, 'Gagal membuat nomor tagihan.');
}

/**
 * Tandai tagihan lunas DAN perpanjang masa aktif dalam SATU perintah atomik.
 * - Hanya tagihan berstatus 'unpaid' yang bisa dibayar, jadi klik ganda / dua admin tidak membuat masa aktif bertambah dua kali.
 * - Perpanjangan dimulai dari yang paling akhir di antara: akhir langganan saat ini, akhir uji coba, atau sekarang.
 *   Bayar lebih awal = hari bertambah di belakang sisa masa aktif (tidak ada hari yang hilang).
 */
async function settleInvoice(invoiceId, method, ref) {
  const r = await sql()`
    with inv as (
      update invoices
         set status = 'paid', paid_at = now(), paid_method = ${method}, paid_ref = ${ref}
       where id = ${invoiceId} and status = 'unpaid'
      returning id, user_id, days, plan_id
    ), upd as (
      update users u
         set paid_until = greatest(coalesce(u.paid_until, now()), u.trial_ends_at, now()) + (inv.days * interval '1 day'),
             plan_id = inv.plan_id
        from inv
       where u.id = inv.user_id
      returning u.id, u.paid_until
    )
    select (select count(*) from inv)::int as n, (select paid_until from upd limit 1) as paid_until`;
  return r[0] && r[0].n > 0 ? r[0] : null;
}

function wrap(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (e) {
      console.error(e);
      if (e && e.status) return send(res, e.status, { error: e.message });
      const msg = /belum diatur/.test(String(e && e.message)) ? e.message : 'Terjadi kesalahan di server.';
      send(res, 500, { error: msg });
    }
  };
}

module.exports = {
  TRIAL_DAYS, SESSION_DAYS, GRACE_DAYS, REMIND_DAYS, DAY,
  sql, signToken, verifyToken, newSession, hashPassword, checkPassword,
  send, method, body, pub, planPub, invoicePub, subState, ms, normPhone, clientIp,
  authUser, createInvoice, settleInvoice, httpError, wrap
};
