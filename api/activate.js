const { sql, send, method, body, pub, authUser, wrap } = require('../lib/core');

module.exports = wrap(async (req, res) => {
  if (!method(req, res, 'POST')) return;
  const u = await authUser(req);
  if (!u) return send(res, 401, { error: 'Sesi berakhir, silakan masuk lagi.' });
  if (u.revoked) return send(res, 403, { error: 'Akun dinonaktifkan. Hubungi admin.' });

  const code = String(body(req).code || '').trim().toUpperCase();
  if (!/^KP-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) {
    return send(res, 400, { error: 'Format kode tidak valid. Contoh: KP-AB12-CD34-EF56' });
  }

  // Satu perintah atomik: tandai kode terpakai + perpanjang masa aktif akun.
  // Perpanjangan dimulai dari yang paling akhir di antara: akhir langganan saat ini, akhir trial, atau sekarang.
  const done = await sql()`
    with c as (
      update license_codes set used_by = ${u.id}, used_at = now()
      where code = ${code} and used_by is null
      returning days
    )
    update users
    set paid_until = greatest(coalesce(paid_until, now()), trial_ends_at, now()) + ((select days from c) * interval '1 day')
    where id = ${u.id} and exists (select 1 from c)
    returning id`;

  if (!done.length) {
    const r = await sql()`select used_by from license_codes where code = ${code}`;
    if (!r.length) return send(res, 404, { error: 'Kode tidak ditemukan.' });
    return send(res, 409, { error: 'Kode ini sudah pernah dipakai.' });
  }
  const fresh = (await sql()`select * from users where id = ${u.id}`)[0];
  send(res, 200, pub(fresh));
});
