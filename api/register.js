const { sql, send, method, body, signToken, hashPassword, pub, wrap, normPhone, TRIAL_DAYS, SESSION_DAYS } = require('../lib/core');

module.exports = wrap(async (req, res) => {
  if (!method(req, res, 'POST')) return;
  const b = body(req);
  const email = String(b.email || '').trim().toLowerCase();
  const name = String(b.name || '').trim();
  const phone = normPhone(b.phone);
  const pw = String(b.password || '');

  if (name.length < 2 || name.length > 80) return send(res, 400, { error: 'Nama minimal 2 karakter.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 120) return send(res, 400, { error: 'Email tidak valid.' });
  if (!/^\d{9,15}$/.test(phone)) return send(res, 400, { error: 'Nomor WhatsApp tidak valid.' });
  if (pw.length < 8 || pw.length > 100) return send(res, 400, { error: 'Password minimal 8 karakter.' });

  try {
    const rows = await sql()`
      insert into users (email, name, phone, pass_hash, trial_ends_at)
      values (${email}, ${name}, ${phone}, ${hashPassword(pw)}, now() + (${TRIAL_DAYS}::int * interval '1 day'))
      returning *`;
    const u = rows[0];
    send(res, 200, { token: signToken({ uid: u.id, exp: Date.now() + SESSION_DAYS * 864e5 }), ...pub(u) });
  } catch (e) {
    if (e && e.code === '23505') {
      const which = String(e.constraint || e.detail || '');
      return send(res, 409, {
        error: /phone/.test(which)
          ? 'Nomor WhatsApp ini sudah terdaftar. Silakan masuk.'
          : 'Email ini sudah terdaftar. Silakan masuk.',
      });
    }
    throw e;
  }
});
