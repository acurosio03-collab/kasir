const { sql, send, method, pub, planPub, invoicePub, authUser, wrap } = require('../lib/core');

// Status akun + paket + tagihan milik pelanggan yang sedang login.
module.exports = wrap(async (req, res) => {
  if (!method(req, res, 'GET')) return;
  const u = await authUser(req);
  if (!u) return send(res, 401, { error: 'Sesi berakhir, silakan masuk lagi.' });

  const [plans, invoices] = await Promise.all([
    sql()`select id, name, days, price from plans where active = true order by sort, days`,
    sql()`select * from invoices where user_id = ${u.id} order by created_at desc limit 12`
  ]);
  send(res, 200, { ...pub(u), plans: plans.map(planPub), invoices: invoices.map(invoicePub) });
});
