const { sql, send, method, body, signToken, checkPassword, hashPassword, pub, wrap, SESSION_DAYS } = require('../lib/core');

module.exports = wrap(async (req, res) => {
  if (!method(req, res, 'POST')) return;
  const b = body(req);
  const email = String(b.email || '').trim().toLowerCase();
  const pw = String(b.password || '');
  if (!email || !pw || pw.length > 100) return send(res, 400, { error: 'Isi email dan password.' });

  const rows = await sql()`select * from users where email = ${email}`;
  const u = rows[0];
  if (!u) { hashPassword(pw); return send(res, 401, { error: 'Email atau password salah.' }); }
  if (!checkPassword(pw, u.pass_hash)) return send(res, 401, { error: 'Email atau password salah.' });
  send(res, 200, { token: signToken({ uid: u.id, exp: Date.now() + SESSION_DAYS * 864e5 }), ...pub(u) });
});
if (u.is_active === false) {
  return send(res, 403, { error: 'Akun Kasir dinonaktifkan oleh Admin toko.' });
}
