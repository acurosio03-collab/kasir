
const { sql, send, method, body, authUser, wrap } = require('../lib/core');

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
    return send(res, 403, { error: 'Akses khusus Admin.' });
  }

  const b = body(req);
  const cashierId = Number(b.cashierId);

  if (!Number.isInteger(cashierId) || cashierId <= 0) {
    return send(res, 400, { error: 'ID Kasir tidak valid.' });
  }

  if (typeof b.isActive !== 'boolean') {
    return send(res, 400, { error: 'Status akun tidak valid.' });
  }

  const rows = await sql()`
    UPDATE users
    SET is_active = ${b.isActive}
    WHERE id = ${cashierId}
      AND owner_id = ${admin.id}
      AND role = 'kasir'
    RETURNING id, name, email, is_active
  `;

  if (!rows.length) {
    return send(res, 404, { error: 'Akun Kasir tidak ditemukan.' });
  }

  return send(res, 200, {
    message: 'Status akun Kasir berhasil diperbarui.',
    cashier: rows[0]
  });
});
    
