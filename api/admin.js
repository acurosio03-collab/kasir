const crypto = require('crypto');
const { sql, send, method, body, hashPassword, wrap } = require('../lib/core');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  const g = () => Array.from({ length: 4 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
  return `KP-${g()}-${g()}-${g()}`;
}

function adminOk(req) {
  const key = process.env.ADMIN_KEY;
  if (!key || key.length < 8) throw new Error('ADMIN_KEY belum diatur di Vercel (minimal 8 karakter).');
  const given = String(req.headers['x-admin-key'] || '');
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(key).digest();
  return crypto.timingSafeEqual(a, b);
}

const int = (v, min, max) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

module.exports = wrap(async (req, res) => {
  if (!method(req, res, 'POST')) return;
  if (!adminOk(req)) return send(res, 401, { error: 'Kunci admin salah.' });
  const b = body(req);

  switch (b.action) {
    case 'gen': {
      const days = int(b.days, 1, 3650);
      const count = int(b.count, 1, 50);
      if (!days || !count) return send(res, 400, { error: 'Hari (1-3650) dan jumlah (1-50) tidak valid.' });
      const plan = String(b.plan || 'Manual').slice(0, 30);
      const note = String(b.note || '').slice(0, 100);
      const codes = [];
      while (codes.length < count) {
        const code = newCode();
        const r = await sql()`insert into license_codes (code, plan, days, note) values (${code}, ${plan}, ${days}, ${note}) on conflict do nothing returning code`;
        if (r.length) codes.push(code);
      }
      return send(res, 200, { codes, plan, days });
    }
    case 'users': {
      const rows = await sql()`select id, email, name, phone, created_at, trial_ends_at, paid_until, revoked from users order by created_at desc limit 500`;
      return send(res, 200, { users: rows });
    }
    case 'codes': {
      const rows = await sql()`select c.code, c.plan, c.days, c.created_at, c.used_at, c.note, u.email as used_by_email from license_codes c left join users u on u.id = c.used_by order by c.created_at desc limit 200`;
      return send(res, 200, { codes: rows });
    }
    case 'extend': {
      const id = int(b.userId, 1, 2147483647), days = int(b.days, -3650, 3650);
      if (!id || !days) return send(res, 400, { error: 'Data tidak valid.' });
      const r = await sql()`update users set paid_until = greatest(coalesce(paid_until, now()), trial_ends_at, now()) + (${days}::int * interval '1 day') where id = ${id} returning id`;
      return r.length ? send(res, 200, { ok: true }) : send(res, 404, { error: 'Pengguna tidak ditemukan.' });
    }
    case 'revoke': {
      const id = int(b.userId, 1, 2147483647);
      if (!id) return send(res, 400, { error: 'Data tidak valid.' });
      const r = await sql()`update users set revoked = ${!!b.revoked} where id = ${id} returning id`;
      return r.length ? send(res, 200, { ok: true }) : send(res, 404, { error: 'Pengguna tidak ditemukan.' });
    }
    case 'resetpw': {
      const id = int(b.userId, 1, 2147483647), pw = String(b.password || '');
      if (!id || pw.length < 8 || pw.length > 100) return send(res, 400, { error: 'Password baru minimal 8 karakter.' });
      const r = await sql()`update users set pass_hash = ${hashPassword(pw)} where id = ${id} returning id`;
      return r.length ? send(res, 200, { ok: true }) : send(res, 404, { error: 'Pengguna tidak ditemukan.' });
    }
    default:
      return send(res, 400, { error: 'Aksi tidak dikenal.' });
  }
});
