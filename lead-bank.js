// The "בנק לידים" panel on the CRM sales home dashboard (decision 2026-10-29-lead-bank; replaces the "זמין" button).
// A rep sees the bank (CEO-owned open leads and sales deals, best priority first) and takes a record for themself.
// Contract (WF19 bank webhook, workflows-src/wf19-lead-bank):
//   POST /webhook/lead-bank, Authorization: Bearer <JWT> (n8nFetch from n8n-auth.js)
//   {} ⇒ 200 {ok, me:{name, open, snoozed, cap_open, cap_snoozed, can_take_leads, reason}, counts:{leads, deals, snoozed}, items:[…]}
//   {"take": {"module": "Leads"|"Deals", "id": "…"}} ⇒ 200 {ok, module, id[, already]} · 409 {ok:false, error} (caps, taken, snoozed)
//   401 no user in the token · 403 not an active rep (the panel hides for good) · 503 Zoho failed
// The server decides every take on a fresh read; the caps shown here are only information.
// No polling: the list is read on load, when the panel opens and after each take (each read costs ~6 Zoho calls).
// Load after n8n-auth.js; the page holds <span id="leadBank" hidden></span> in its header.
(function (root) {
  var URL = 'https://n8n.srv1254786.hstgr.cloud/webhook/lead-bank';

  var NOTES = {
    auth: 'אין הזדהות מול השרת',
    network: 'אין חיבור — נסו שוב',
    server: 'השרת לא הצליח לקרוא את הבנק — נסו שוב',
    'bad-reply': 'תשובה לא צפויה מהשרת',
  };

  // the header button for a state (pure)
  function view(s) {
    if (!s || !s.visible) return { hidden: true };
    var me = s.me;
    return {
      hidden: false,
      text: me ? 'בנק לידים · ' + me.open + '/' + me.cap_open : 'בנק לידים',
      blocked: !!(me && !me.can_take_leads),
      note: s.error ? (NOTES[s.error] || NOTES.network) : '',
    };
  }

  function create(deps) {
    var fetchFn = deps.fetchFn, url = deps.url || URL, render = deps.render, openRecord = deps.openRecord || function () {};
    var s = { visible: false, open: false, loading: false, error: null, me: null, counts: null, items: [], taking: null, message: null };
    var stopped = false, seq = 0;

    function show(patch) { Object.assign(s, patch); render(s); }

    function post(body) {
      return fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (res) {
          return res.json().then(function (b) { return { status: res.status, body: b }; }, function () { return { status: res.status, body: null }; });
        }, function () { return { status: 0, body: null }; });
    }

    function refresh() {
      if (stopped) return Promise.resolve();
      var my = ++seq;
      show({ loading: true });
      return post({}).then(function (r) {
        if (my !== seq) return;               // a newer read was sent
        if (r.status === 403) { stopped = true; show({ visible: false, loading: false }); return; }
        if (r.status === 401) { show({ visible: true, loading: false, error: 'auth' }); return; }
        if (r.status === 0) { show({ visible: true, loading: false, error: 'network' }); return; }
        var b = r.body;
        if (r.status !== 200 || !b || !b.ok || !b.me || !Array.isArray(b.items)) {
          show({ visible: true, loading: false, error: r.status === 200 ? 'bad-reply' : 'server' });
          return;
        }
        show({ visible: true, loading: false, error: null, me: b.me, counts: b.counts || null, items: b.items });
      });
    }

    function toggle() {
      if (stopped) return Promise.resolve();
      var opening = !s.open;
      show({ open: opening, message: opening ? null : s.message });
      return opening ? refresh() : Promise.resolve();
    }

    function take(item) {
      if (stopped || s.taking || !item) return Promise.resolve();
      show({ taking: item.id, message: null });
      return post({ take: { module: item.module, id: item.id } }).then(function (r) {
        var b = r.body || {};
        if (r.status === 200 && b.ok) {
          show({ taking: null, message: { ok: true, text: (item.module === 'Deals' ? 'העסקה' : 'הליד') + ' "' + item.name + '" עבר אלייך' } });
          openRecord(item.module, item.id);
          return refresh();
        }
        var text = r.status === 0 ? NOTES.network : r.status === 401 ? NOTES.auth : (b.error || NOTES.server);
        show({ taking: null, message: { ok: false, text: text } });
        if (r.status === 409) return refresh(); // taken by someone else / caps changed: show the current bank
      });
    }

    return { start: refresh, refresh: refresh, toggle: toggle, take: take, state: function () { return s; } };
  }

  var api = { create: create, view: view, URL: URL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  if (root && root.document) {
    var esc = function (t) { var d = root.document.createElement('div'); d.textContent = t == null ? '' : String(t); return d.innerHTML; };
    var date = function (iso) { var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' }); };
    var mount = function () {
      var host = root.document.getElementById('leadBank');
      if (!host || typeof root.n8nFetch !== 'function') return;
      var style = root.document.createElement('style');
      style.textContent =
        '.bank-btn{display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:12px;font-weight:600;padding-block:3px;padding-inline:10px;' +
        'border-radius:999px;border:1.5px solid #25d366;background:#e9f9ef;color:#075e54;cursor:pointer}' +
        '.bank-btn.blocked{border-color:#e67e22;background:#fdf2e9;color:#a04000}' +
        '.bank-note{font-size:10px;color:#c0392b;margin-inline-start:6px}' +
        '.bank-panel{position:fixed;inset-inline:0;inset-block:44px 0;background:#fff;z-index:10;padding:8px 12px;overflow-y:auto;border-top:1px solid #eee}' +
        '.bank-me{font-size:12px;color:#333;margin-block-end:6px}.bank-me b{color:#075e54}' +
        '.bank-reason{font-size:12px;color:#a04000;background:#fdf2e9;border-radius:6px;padding:6px 8px;margin-block-end:6px}' +
        '.bank-msg{font-size:12px;border-radius:6px;padding:6px 8px;margin-block-end:6px}.bank-msg.ok{background:#e9f9ef;color:#075e54}.bank-msg.err{background:#fdecea;color:#c0392b}' +
        '.bank-item{display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid #eee;border-radius:6px;background:#f8f9fa;margin-block-end:4px}' +
        '.bank-body{flex:1;min-width:0}.bank-name{font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
        '.bank-name a{color:#075e54;text-decoration:none}.bank-meta{font-size:11px;color:#777;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
        '.bank-tag{font-size:10px;background:#2196F3;color:#fff;border-radius:4px;padding:0 4px;margin-inline-end:4px}' +
        '.bank-take{font:inherit;font-size:12px;font-weight:600;border:none;border-radius:6px;background:#25d366;color:#fff;padding:4px 10px;cursor:pointer;flex-shrink:0}' +
        '.bank-take[disabled]{background:#bbb;cursor:default}.bank-empty{font-size:12px;color:#999;text-align:center;padding:20px}';
      root.document.head.appendChild(style);
      host.innerHTML = '<button type="button" class="bank-btn" aria-expanded="false">🏦 <span class="txt"></span></button><span class="bank-note" aria-live="polite"></span>';
      var btn = host.querySelector('button'), txt = host.querySelector('.txt'), note = host.querySelector('.bank-note');
      var panel = root.document.createElement('div');
      panel.className = 'bank-panel'; panel.hidden = true;
      root.document.body.appendChild(panel);
      var openRecord = function (module, id) {
        try { root.ZOHO.CRM.UI.Record.open({ Entity: module, RecordID: id }); }
        catch (e) { root.open('https://crm.zoho.com/crm/tab/' + module + '/' + id, '_blank'); }
      };
      var c;
      var drawPanel = function (st) {
        panel.hidden = !st.open;
        if (!st.open) return;
        var me = st.me, h = '';
        if (me) {
          h += '<div class="bank-me"><bdi>' + esc(me.name || '') + '</bdi>: <b>' + me.open + '</b> לידים פתוחים מתוך ' + me.cap_open +
            ' · <b>' + me.snoozed + '</b> בנודניק מתוך ' + me.cap_snoozed + '</div>';
          if (!me.can_take_leads) h += '<div class="bank-reason">' + esc(me.reason) + '. אפשר עדיין לקחת עסקאות.</div>';
        }
        if (st.message) h += '<div class="bank-msg ' + (st.message.ok ? 'ok' : 'err') + '">' + esc(st.message.text) + '</div>';
        if (st.loading && !st.items.length) h += '<div class="bank-empty">טוען…</div>';
        else if (!st.items.length) h += '<div class="bank-empty">הבנק ריק</div>';
        st.items.forEach(function (it, i) {
          var blocked = it.module === 'Leads' && me && !me.can_take_leads;
          var meta = [it.category, it.source, it.status, it.created ? 'נכנס ' + date(it.created) : ''].filter(Boolean).join(' · ');
          h += '<div class="bank-item"><div class="bank-body"><div class="bank-name">' + (it.module === 'Deals' ? '<span class="bank-tag">עסקה</span>' : '') +
            '<a href="javascript:void(0)" data-open="' + i + '">' + esc(it.name) + '</a></div><div class="bank-meta">' + esc(meta) + ' · עדיפות ' + esc(it.priority) + '</div></div>' +
            '<button type="button" class="bank-take" data-take="' + i + '"' + (blocked || st.taking ? ' disabled' : '') + '>' + (st.taking === it.id ? '…' : 'קח') + '</button></div>';
        });
        if (st.counts && st.counts.snoozed) h += '<div class="bank-empty">' + st.counts.snoozed + ' לידים בבנק נמצאים בנודניק ולא מוצגים</div>';
        panel.innerHTML = h;
      };
      panel.addEventListener('click', function (e) {
        var t = e.target.closest('[data-take],[data-open]');
        if (!t) return;
        var items = c.state().items;
        if (t.hasAttribute('data-take')) c.take(items[Number(t.getAttribute('data-take'))]);
        else { var it = items[Number(t.getAttribute('data-open'))]; if (it) openRecord(it.module, it.id); }
      });
      c = create({
        fetchFn: function (u, o) { return root.n8nFetch(u, o); },
        openRecord: openRecord,
        render: function (st) {
          var v = view(st);
          host.hidden = v.hidden;
          if (v.hidden) { panel.hidden = true; return; }
          btn.className = 'bank-btn' + (v.blocked ? ' blocked' : '');
          btn.setAttribute('aria-expanded', String(!!st.open));
          txt.textContent = v.text;
          note.textContent = v.note;
          drawPanel(st);
        },
      });
      btn.addEventListener('click', function () { c.toggle(); });
      // the token (n8n-auth.js) needs the CRM SDK: the dashboard publishes its embeddedApp.init promise as dashReady
      Promise.resolve(root.dashReady).then(function () { c.start(); }, function () { c.start(); });
    };
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', mount);
    else mount();
  }
})(typeof window !== 'undefined' ? window : null);
