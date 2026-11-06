
const { sql, send, method, authUser, wrap } = require('../lib/core');

module.exports = wrap(async (req, res) => {
  if (!method(req, res, 'GET')) return;

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

  const rows = await sql()`
    SELECT id, name, email, phone, role, is_active, created_at
    FROM users
    WHERE owner_id = ${admin.id}
      AND role = 'kasir'
    ORDER BY created_at DESC
  `;

  return send(res, 200, { cashiers: rows });
});
    
