const { sql, send, method, body, authUser, createInvoice, wrap, DAY } = require('../lib/core');

// Aksi langganan oleh pelanggan sendiri:
//   { action: 'invoice',   planId }  -> minta tagihan (berlangganan / perpanjang / ganti paket)
//   { action: 'autorenew', on }      -> hidupkan/matikan tagihan otomatis bulan berikutnya
//   { action: 'cancel_invoice' }     -> batalkan tagihan yang belum dibayar
// Perpanjangan masa aktif TIDAK terjadi di sini; hanya saat pembayaran dikonfirmasi admin.
module.exports = wrap(async (req, res) => {
  if (!method(req, res, 'POST')) return;
  const u = await authUser(req);
  if (!u) return send(res, 401, { error: 'Sesi berakhir, silakan masuk lagi.' });
  if (u.revoked) return send(res, 403, { error: 'Akun dinonaktifkan. Hubungi admin.' });

  const b = body(req);
  switch (b.action) {
    case 'invoice': {
      const planId = String(b.planId || '').slice(0, 10);
      const end = Math.max(new Date(u.paid_until || 0).getTime(), new Date(u.trial_ends_at).getTime());
      // Jatuh tempo = akhir masa aktif saat ini; kalau sudah lewat, 3 hari dari sekarang
      const dueMs = end > Date.now() ? end : Date.now() + 3 * DAY;
      const inv = await createInvoice(u.id, planId, 'customer', new Date(dueMs));
      await sql()`update users set plan_id = ${planId}, auto_renew = true where id = ${u.id}`;
      return send(res, 200, { ok: true, invoice: { no: inv.invoice_no, amount: inv.amount, planName: inv.plan_name } });
    }
    case 'autorenew': {
      if (typeof b.on !== 'boolean') return send(res, 400, { error: 'Data tidak valid.' });
      await sql()`update users set auto_renew = ${b.on} where id = ${u.id}`;
      if (!b.on) await sql()`update invoices set status = 'void', note = 'Dibatalkan pelanggan (berhenti berlangganan)' where user_id = ${u.id} and status = 'unpaid' and source = 'auto'`;
      return send(res, 200, { ok: true });
    }
    case 'cancel_invoice': {
      await sql()`update invoices set status = 'void', note = 'Dibatalkan pelanggan' where user_id = ${u.id} and status = 'unpaid'`;
      return send(res, 200, { ok: true });
    }
    default:
      return send(res, 400, { error: 'Aksi tidak dikenal.' });
  }
});
