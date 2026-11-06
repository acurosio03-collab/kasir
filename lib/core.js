// Fungsi bersama untuk semua endpoint /api (Vercel Serverless Functions + Neon Postgres)
const crypto = require('crypto');

const TRIAL_DAYS = 14;
const SESSION_DAYS = 30;

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

// Bentuk data akun yang dikirim ke aplikasi (waktu dalam epoch milidetik)
function pub(u) {
  return {
    user: {
      id: u.id,
      email: u.email,
      name: u.name,
      phone: u.phone
    },
    role: u.role || 'admin',
    ownerId: u.owner_id || u.id,
    isActive: u.is_active !== false,
    trialEnd: ms(u.trial_ends_at),
    paidUntil: ms(u.paid_until),
    revoked: !!u.revoked,
    serverNow: Date.now()
  };
  }

function normPhone(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('0')) d = '62' + d.slice(1);
  return d;
}

async function authUser(req) {
  const h = req.headers.authorization || '';
  const p = verifyToken(h.replace(/^Bearer\s+/i, ''));
  if (!p) return null;
  const rows = await sql()`select * from users where id = ${p.uid}`;
  return rows[0] || null;
}

function wrap(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (e) {
      console.error(e);
      const msg = /belum diatur/.test(String(e && e.message)) ? e.message : 'Terjadi kesalahan di server.';
      send(res, 500, { error: msg });
    }
  };
}

module.exports = {
  TRIAL_DAYS, SESSION_DAYS, sql, signToken, verifyToken, hashPassword, checkPassword,
  send, method, body, pub, normPhone, authUser, wrap,
};
