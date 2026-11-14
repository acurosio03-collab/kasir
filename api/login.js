const { sql, send, method, body, newSession, checkPassword, hashPassword, pub, wrap, clientIp } = require('../lib/core');

const MAX_FAILS = 5;       // gagal berturut-turut
const WINDOW_MIN = 15;     // dalam rentang menit

module.exports = wrap(async (req, res) => {
  if (!method(req, res, 'POST')) return;
  const b = body(req);
  const email = String(b.email || '').trim().toLowerCase();
  const pw = String(b.password || '');
  if (!email || !pw || pw.length > 100 || email.length > 120) return send(res, 400, { error: 'Isi email dan password.' });

  // Pembatas percobaan login per email: 5 kali gagal dalam 15 menit -> tunggu dulu
  const fails = await sql()`select count(*)::int as n from login_attempts where email = ${email} and created_at > now() - (${WINDOW_MIN}::int * interval '1 minute')`;
  if (fails[0].n >= MAX_FAILS) {
    return send(res, 429, { error: `Terlalu banyak percobaan gagal. Coba lagi dalam ${WINDOW_MIN} menit.` });
  }

  const u = (await sql()`select * from users where email = ${email}`)[0];
  const ok = u ? checkPassword(pw, u.pass_hash) : (hashPassword(pw), false); // waktu proses tetap mirip
  if (!ok) {
    await sql()`insert into login_attempts (email, ip) values (${email}, ${clientIp(req)})`;
    return send(res, 401, { error: 'Email atau password salah.' });
  }
  await sql()`delete from login_attempts where email = ${email}`;
  send(res, 200, { token: newSession(u), ...pub(u) });
});
