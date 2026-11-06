const { send, method, pub, authUser, wrap } = require('../lib/core');

module.exports = wrap(async (req, res) => {
  if (!method(req, res, 'GET')) return;
  const u = await authUser(req);
  if (!u) return send(res, 401, { error: 'Sesi berakhir, silakan masuk lagi.' });
  send(res, 200, pub(u));
});
