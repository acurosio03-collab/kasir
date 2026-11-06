
const {
  sql, send, method, body, authUser,
  hashPassword, normPhone, wrap
} = require('../lib/core');

module.exports = wrap(async (req, res) => {
  if (!method(req, res, 'POST')) return;

  const admin = await authUser(req);

  if (!admin) {
    return send(res, 401, { error: 'Silakan login kembali.' });
  }

  if (
    admin.role !== 'admin' ||
    Number(admin.owner_id) !== Number(admin.id)
  ) {
    return send(res, 403, {
      error: 'Hanya Admin toko yang boleh membuat akun Kasir.'
    });
  }

  const b = body(req);
  const name = String(b.name || '').trim();
  const email = String(b.email || '').trim().toLowerCase();
  const phone = normPhone(b.phone);
  const password = String(b.password || '');

  if (name.length < 2 || name.length > 80) {
    return send(res, 400, { error: 'Nama minimal 2 karakter.' });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return send(res, 400, { error: 'Email tidak valid.' });
  }

  if (!/^\d{9,15}$/.test(phone)) {
    return send(res, 400, { error: 'Nomor WhatsApp tidak valid.' });
  }

  if (password.length < 8 || password.length > 100) {
    return send(res, 400, { error: 'Password minimal 8 karakter.' });
  }

  try {
    const rows = await sql()`
      INSERT INTO users
        (email, name, phone, pass_hash, trial_ends_at,
         role, owner_id, is_active)
      VALUES (
        ${email},
        ${name},
        ${phone},
        ${hashPassword(password)},
        now() + interval '14 days',
        'kasir',
        ${admin.id},
        TRUE
      )
      RETURNING id, email, name, phone, role, owner_id, is_active
    `;

    return send(res, 201, {
      message: 'Akun Kasir berhasil dibuat.',
      cashier: rows[0]
    });

  } catch (e) {
    if (e && e.code === '23505') {
      return send(res, 409, {
        error: 'Email atau nomor WhatsApp sudah digunakan.'
      });
    }
    throw e;
  }
});
                           
