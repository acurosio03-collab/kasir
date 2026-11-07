const crypto = require('crypto');
const { sql, send, createInvoice, wrap, REMIND_DAYS, GRACE_DAYS } = require('../lib/core');

// Penagihan otomatis harian (dijalankan Vercel Cron, lihat vercel.json).
// Vercel mengirim header "Authorization: Bearer <CRON_SECRET>" bila variabel CRON_SECRET diatur.
function cronOk(req) {
  const key = process.env.CRON_SECRET;
  if (!key || key.length < 16) throw new Error('CRON_SECRET belum diatur di Vercel (minimal 16 karakter).');
  const given = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(key).digest();
  return crypto.timingSafeEqual(a, b);
}

module.exports = wrap(async (req, res) => {
  if (!cronOk(req)) return send(res, 401, { error: 'Tidak diizinkan.' });

  // 1) Terbitkan tagihan perpanjangan untuk pelanggan yang:
  //    - auto_renew menyala dan tidak diblokir
  //    - masa aktifnya habis dalam REMIND_DAYS hari ke depan (atau sudah lewat tapi belum ditagih)
  //    - belum punya tagihan terbuka
  //    - belum terlalu lama menunggak (di luar masa toleransi + 30 hari dianggap berhenti)
  const due = await sql()`
    select u.id, u.plan_id, greatest(coalesce(u.paid_until, u.trial_ends_at), u.trial_ends_at) as end_at
      from users u
     where u.auto_renew = true
       and u.revoked = false
       and greatest(coalesce(u.paid_until, u.trial_ends_at), u.trial_ends_at) <= now() + (${REMIND_DAYS}::int * interval '1 day')
       and greatest(coalesce(u.paid_until, u.trial_ends_at), u.trial_ends_at) > now() - (${GRACE_DAYS + 30}::int * interval '1 day')
       and not exists (select 1 from invoices i where i.user_id = u.id and i.status = 'unpaid')
       and exists (select 1 from plans p where p.id = u.plan_id and p.active = true)`;

  let created = 0, failed = 0;
  for (const u of due) {
    try {
      const endMs = new Date(u.end_at).getTime();
      await createInvoice(u.id, u.plan_id, 'auto', new Date(Math.max(endMs, Date.now())));
      created++;
    } catch (e) {
      failed++;
      console.error('cron-billing gagal untuk user', u.id, e && e.message);
    }
  }

  // 2) Tagihan yang sudah lewat masa toleransi tapi tidak dibayar: dibatalkan agar daftar tagihan tetap bersih.
  //    (Akun terkunci sendiri berdasarkan tanggal, bukan berdasarkan status tagihan.)
  const stale = await sql()`
    update invoices set status = 'void', note = 'Kedaluwarsa (tidak dibayar)'
     where status = 'unpaid' and source = 'auto'
       and due_at < now() - (${GRACE_DAYS + 30}::int * interval '1 day')
    returning id`;

  send(res, 200, { ok: true, candidates: due.length, created, failed, voided: stale.length });
});
