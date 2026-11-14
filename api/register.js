const {
  sql, send, method, body, newSession, hashPassword, pub, wrap, normPhone, TRIAL_DAYS, clientIp
} = require('../lib/core');

// Pendaftaran terbuka: setiap pendaftar adalah PELANGGAN baru (satu toko) dengan uji coba gratis.
module.exports = wrap(async (req, res) => {
  if (!method(req, res, 'POST')) return;

  const b = body(req);
  const email = String(b.email || '').trim().toLowerCase();
  const name = String(b.name || '').trim();
  const phone = normPhone(b.phone);
  const pw = String(b.password || '');

  if (name.length < 2 || name.length > 80)
    return send(res, 400, { error: 'Nama minimal 2 karakter.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 120)
    return send(res, 400, { error: 'Email tidak valid.' });
  if (!/^\d{9,15}$/.test(phone))
    return send(res, 400, { error: 'Nomor WhatsApp tidak valid.' });
  if (pw.length < 8 || pw.length > 100)
    return send(res, 400, { error: 'Password minimal 8 karakter.' });

  // Batasi pendaftaran massal dari satu alamat IP (maks. 5 akun baru per jam)
  const ip = clientIp(req);
  if (ip) {
    const r = await sql()`select count(*)::int as n from login_attempts where ip = ${ip} and email like 'register:%' and created_at > now() - interval '1 hour'`;
    if (r[0].n >= 5) return send(res, 429, { error: 'Terlalu banyak pendaftaran dari jaringan ini. Coba lagi nanti.' });
    await sql()`insert into login_attempts (email, ip) values (${'register:' + email}, ${ip})`;
  }

  try {
    const rows = await sql()`
      insert into users (email, name, phone, pass_hash, trial_ends_at, plan_id, auto_renew)
      values (${email}, ${name}, ${phone}, ${hashPassword(pw)}, now() + (${TRIAL_DAYS}::int * interval '1 day'), 'M', true)
      returning *`;
    const u = rows[0];
    send(res, 200, { token: newSession(u), ...pub(u) });
  } catch (e) {
    if (e && e.code === '23505') return send(res, 409, { error: 'Email atau nomor WhatsApp sudah terdaftar.' });
    throw e;
  }
});
