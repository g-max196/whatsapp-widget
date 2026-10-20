// 3.4: every call from a CRM widget to n8n carries "Authorization: Bearer <JWT>".
// The JWT (5 minutes) comes from the Zoho CRM function ofek_n8n_token, called through the widget SDK
// (ZOHO.CRM.FUNCTIONS.execute, REST API OAuth2) as the logged-in user — the widget never holds a secret.
// n8n checks it with the credential "ofek crm widgets: JWT". Widgets call n8nFetch(url, options) instead of fetch.
//  - one token is reused for 4 minutes (counted on this page's clock, not the token's exp);
//  - n8n answering 401/403 (auth refused, the workflow did not run) ⇒ one retry with a fresh token;
//  - no token (SDK missing, function error, or no answer within 8 s — a page that never ran
//    ZOHO.embeddedApp.init gets no answer at all) ⇒ the call goes out without the header and a warning is logged:
//    it works while n8n does not enforce, and fails visibly (401) once it does.
(function (root) {
  var TOKEN_FUNCTION = 'ofek_n8n_token';
  var CACHE_MS = 4 * 60 * 1000;
  var MINT_TIMEOUT_MS = 8000;
  var JWT_RE = /^[\w-]+\.[\w-]+\.[\w-]+$/;

  function parseTokenResponse(reply) {
    var r = reply;
    if (typeof r === 'string') r = JSON.parse(r);
    if (!r || String(r.code).toLowerCase() !== 'success' || !r.details) throw new Error('ofek_n8n_token: ' + ((r && r.message) || 'no reply'));
    var out = r.details.output;
    if (typeof out === 'string') out = JSON.parse(out);
    var token = out && out.token;
    if (typeof token !== 'string' || !JWT_RE.test(token)) throw new Error('ofek_n8n_token: no token in the reply');
    return token;
  }

  function create(deps) {
    var zoho = deps.zoho, fetchFn = deps.fetchFn, now = deps.now, log = deps.log, wait = deps.wait;
    var cached = null, cachedAt = 0, pending = null;

    function mint() {
      var z = zoho();
      if (!z || !z.CRM || !z.CRM.FUNCTIONS) return Promise.reject(new Error('ZOHO SDK not available'));
      var call = Promise.resolve(z.CRM.FUNCTIONS.execute(TOKEN_FUNCTION, { arguments: JSON.stringify({}) })).then(parseTokenResponse);
      var limit = wait(MINT_TIMEOUT_MS).then(function () { throw new Error('no answer within ' + MINT_TIMEOUT_MS + ' ms'); });
      return Promise.race([call, limit]);
    }

    function token(fresh) {
      if (!fresh && cached && now() - cachedAt < CACHE_MS) return Promise.resolve(cached);
      if (!pending) {
        pending = mint().then(function (t) { cached = t; cachedAt = now(); return t; })
          .catch(function (e) { cached = null; log('n8n auth: no token, calling without it — ' + e.message); return null; })
          .then(function (t) { pending = null; return t; });
      }
      return pending;
    }

    function send(url, options, t) {
      var o = Object.assign({}, options || {});
      o.headers = Object.assign({}, (options && options.headers) || {});
      if (t) o.headers.Authorization = 'Bearer ' + t;
      return fetchFn(url, o);
    }

    function n8nFetch(url, options) {
      return token(false).then(function (t) {
        return send(url, options, t).then(function (res) {
          if (res.status !== 401 && res.status !== 403) return res;
          return token(true).then(function (t2) { return send(url, options, t2); });
        });
      });
    }

    return { n8nFetch: n8nFetch, token: token };
  }

  var api = { create: create, parseTokenResponse: parseTokenResponse };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && root.fetch) {
    var browser = create({
      zoho: function () { return root.ZOHO; },
      fetchFn: function (u, o) { return root.fetch(u, o); },
      now: function () { return Date.now(); },
      log: function (m) { if (root.console) root.console.warn(m); },
      wait: function (ms) { return new Promise(function (r) { root.setTimeout(r, ms); }); },
    });
    root.n8nFetch = browser.n8nFetch;
  }
})(typeof window !== 'undefined' ? window : null);
