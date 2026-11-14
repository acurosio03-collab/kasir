const crypto = require('crypto');
const { sql, send, method, body, hashPassword, wrap, subState, ms, createInvoice, settleInvoice, DAY } = require('../lib/core');

function adminOk(req) {
  const key = process.env.ADMIN_KEY;
  if (!key || key.length < 8) throw new Error('ADMIN_KEY belum diatur di Vercel (minimal 8 karakter).');
  const given = String(req.headers['x-admin-key'] || '');
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(key).digest();
  return crypto.timingSafeEqual(a, b);
}

const int = (v, min, max) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

const METHODS = ['Transfer bank', 'QRIS', 'E-wallet', 'Tunai', 'Lainnya'];

async function loadUsers() {
  const rows = await sql()`
    select u.id, u.email, u.name, u.phone, u.created_at, u.trial_ends_at, u.paid_until, u.revoked,
           u.plan_id, u.auto_renew, p.name as plan_name, p.price as plan_price, p.days as plan_days,
           i.id as inv_id, i.invoice_no as inv_no, i.amount as inv_amount, i.due_at as inv_due
      from users u
      left join plans p on p.id = u.plan_id
      left join invoices i on i.user_id = u.id and i.status = 'unpaid'
     order by u.created_at desc
     limit 2000`;
  const now = Date.now();
  return rows.map((u) => {
    const st = subState(u, now);
    return {
      id: u.id, email: u.email, name: u.name, phone: u.phone, createdAt: ms(u.created_at),
      trialEnd: ms(u.trial_ends_at), paidUntil: ms(u.paid_until), revoked: u.revoked,
      planId: u.plan_id, planName: u.plan_name || '-', planPrice: u.plan_price || 0, planDays: u.plan_days || 30,
      autoRenew: u.auto_renew, state: st.state, end: st.end, graceEnd: st.graceEnd,
      daysLeft: Math.ceil((st.end - now) / DAY),
      openInvoice: u.inv_id ? { id: u.inv_id, no: u.inv_no, amount: u.inv_amount, dueAt: ms(u.inv_due) } : null
    };
  });
}

module.exports = wrap(async (req, res) => {
  if (!method(req, res, 'POST')) return;
  if (!adminOk(req)) return send(res, 401, { error: 'Kunci admin salah.' });
  const b = body(req);

  switch (b.action) {
    case 'ping':
      return send(res, 200, { ok: true });

    case 'overview': {
      const users = await loadUsers();
      const c = { trial: 0, active: 0, grace: 0, expired: 0, revoked: 0 };
      let mrr = 0, due7 = 0;
      for (const u of users) {
        c[u.state]++;
        if (u.state === 'active') mrr += Math.round(u.planPrice / (u.planDays / 30));
        if ((u.state === 'active' || u.state === 'trial') && u.daysLeft <= 7 && !u.revoked) due7++;
      }
      const inv = (await sql()`
        select count(*) filter (where status = 'unpaid')::int as unpaid_n,
               coalesce(sum(amount) filter (where status = 'unpaid'), 0)::bigint as unpaid_sum,
               coalesce(sum(amount) filter (where status = 'paid' and paid_at >= date_trunc('month', now())), 0)::bigint as paid_month
          from invoices`)[0];
      return send(res, 200, {
        total: users.length, counts: c, mrr, due7,
        unpaidCount: inv.unpaid_n, unpaidSum: Number(inv.unpaid_sum), paidThisMonth: Number(inv.paid_month)
      });
    }

    case 'users':
      return send(res, 200, { users: await loadUsers() });

    case 'invoices': {
      const f = ['unpaid', 'paid', 'void'].includes(b.status) ? b.status : null;
      const rows = await sql()`
        select i.*, u.name as user_name, u.email as user_email, u.phone as user_phone
          from invoices i join users u on u.id = i.user_id
         where (${f}::text is null or i.status = ${f})
         order by i.created_at desc limit 300`;
      return send(res, 200, {
        invoices: rows.map((i) => ({
          id: i.id, no: i.invoice_no, userId: i.user_id, userName: i.user_name, userEmail: i.user_email, userPhone: i.user_phone,
          planName: i.plan_name, days: i.days, amount: i.amount, status: i.status, source: i.source,
          createdAt: ms(i.created_at), dueAt: ms(i.due_at), paidAt: ms(i.paid_at), paidMethod: i.paid_method || '',
          paidRef: i.paid_ref || '', note: i.note
        }))
      });
    }

    case 'confirm': {
      const id = int(b.invoiceId, 1, 2147483647);
      const m = METHODS.includes(b.method) ? b.method : 'Transfer bank';
      const ref = String(b.ref || '').slice(0, 100);
      if (!id) return send(res, 400, { error: 'Data tidak valid.' });
      const r = await settleInvoice(id, m, ref);
      if (!r) return send(res, 409, { error: 'Tagihan tidak ditemukan atau sudah dibayar/dibatalkan.' });
      return send(res, 200, { ok: true, paidUntil: ms(r.paid_until) });
    }

    case 'void': {
      const id = int(b.invoiceId, 1, 2147483647);
      if (!id) return send(res, 400, { error: 'Data tidak valid.' });
      const r = await sql()`update invoices set status = 'void', note = 'Dibatalkan admin' where id = ${id} and status = 'unpaid' returning id`;
      return r.length ? send(res, 200, { ok: true }) : send(res, 404, { error: 'Tagihan tidak ditemukan atau sudah diproses.' });
    }

    case 'invoice_create': {
      const uid = int(b.userId, 1, 2147483647);
      if (!uid) return send(res, 400, { error: 'Data tidak valid.' });
      const u = (await sql()`select * from users where id = ${uid}`)[0];
      if (!u) return send(res, 404, { error: 'Pelanggan tidak ditemukan.' });
      const planId = String(b.planId || u.plan_id).slice(0, 10);
      const st = subState(u);
      const inv = await createInvoice(u.id, planId, 'admin', new Date(Math.max(st.end, Date.now())));
      await sql()`update users set plan_id = ${planId} where id = ${u.id}`;
      return send(res, 200, { ok: true, invoice: { id: inv.id, no: inv.invoice_no, amount: inv.amount } });
    }

    case 'extend': {
      const id = int(b.userId, 1, 2147483647), days = int(b.days, -3650, 3650);
      if (!id || !days) return send(res, 400, { error: 'Data tidak valid.' });
      const r = await sql()`update users set paid_until = greatest(coalesce(paid_until, now()), trial_ends_at, now()) + (${days}::int * interval '1 day') where id = ${id} returning id`;
      return r.length ? send(res, 200, { ok: true }) : send(res, 404, { error: 'Pengguna tidak ditemukan.' });
    }

    case 'autorenew': {
      const id = int(b.userId, 1, 2147483647);
      if (!id || typeof b.on !== 'boolean') return send(res, 400, { error: 'Data tidak valid.' });
      const r = await sql()`update users set auto_renew = ${b.on} where id = ${id} returning id`;
      return r.length ? send(res, 200, { ok: true }) : send(res, 404, { error: 'Pengguna tidak ditemukan.' });
    }

    case 'revoke': {
      const id = int(b.userId, 1, 2147483647);
      if (!id) return send(res, 400, { error: 'Data tidak valid.' });
      const r = await sql()`update users set revoked = ${!!b.revoked} where id = ${id} returning id`;
      return r.length ? send(res, 200, { ok: true }) : send(res, 404, { error: 'Pengguna tidak ditemukan.' });
    }

    case 'resetpw': {
      const id = int(b.userId, 1, 2147483647), pw = String(b.password || '');
      if (!id || pw.length < 8 || pw.length > 100) return send(res, 400, { error: 'Password baru minimal 8 karakter.' });
      const r = await sql()`update users set pass_hash = ${hashPassword(pw)} where id = ${id} returning id`;
      return r.length ? send(res, 200, { ok: true }) : send(res, 404, { error: 'Pengguna tidak ditemukan.' });
    }

    case 'plans': {
      const rows = await sql()`select id, name, days, price, sort, active from plans order by sort, days`;
      return send(res, 200, { plans: rows });
    }

    case 'plan_save': {
      const id = String(b.id || '').trim().toUpperCase();
      const name = String(b.name || '').trim().slice(0, 30);
      const days = int(b.days, 1, 3650), price = int(b.price, 0, 100000000);
      if (!/^[A-Z0-9]{1,6}$/.test(id) || !name || !days || price === null) return send(res, 400, { error: 'Kode (huruf/angka), nama, hari, dan harga wajib valid.' });
      await sql()`
        insert into plans (id, name, days, price, sort, active)
        values (${id}, ${name}, ${days}, ${price}, ${days}, ${b.active !== false})
        on conflict (id) do update set name = excluded.name, days = excluded.days, price = excluded.price, sort = excluded.sort, active = excluded.active`;
      return send(res, 200, { ok: true });
    }

    default:
      return send(res, 400, { error: 'Aksi tidak dikenal.' });
  }
});
