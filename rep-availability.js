// Stage 9: the "זמין" button on the CRM home dashboards.
// A sales rep marks themself available / unavailable; WF13 assigns new leads round robin among available reps.
// Contract (S3, WF16 toggle, docs/progress/S3-intake-gate.md §WF16 interface):
//   POST /webhook/rep-availability, Authorization: Bearer <JWT> (n8nFetch from n8n-auth.js)
//   {} ⇒ read · {"available": true|false} ⇒ set the caller's own row (identity = the token's crm_uid)
//   200 {ok, available, display_name} · 401 no user in the token · 403 not an active rep · 400 bad body
// Hidden until go-live: ENABLED stays false until Efi approves the button (0.2) and S3's toggle is live;
// "?availability=on" in the page URL turns it on for a test before that. A 403 hides the button for good
// (the user is not a rep), so the same file can be loaded by every dashboard.
// Load after n8n-auth.js; the page holds <span id="repAvailability" hidden></span> in its header.
(function (root) {
  var ENABLED = true;    // Efi approved the button (INPUT 0.2, 20/10); a user who is not an active rep gets 403 and sees nothing
  var URL = 'https://n8n.srv1254786.hstgr.cloud/webhook/rep-availability';
  var POLL_MS = 60 * 1000;   // the scheduled reset (end of shift, 06:00) must show without a reload

  var NOTES = {
    auth: 'אין הזדהות מול השרת',
    network: 'אין חיבור — נסה שוב',
    rejected: 'השינוי לא נשמר',
    'bad-reply': 'תשובה לא צפויה מהשרת',
  };

  function isEnabled(flag, search) {
    if (flag) return true;
    return /(^|[?&])availability=on(&|$)/.test(search || '');
  }

  // what the button shows for a state (pure; the DOM part only applies it)
  function view(s) {
    if (!s || !s.visible) return { hidden: true };
    var known = s.available === true || s.available === false;
    return {
      hidden: false,
      text: !known ? 'זמינות' : s.available ? 'זמין' : 'לא זמין',
      checked: s.available === true,
      disabled: !known || !!s.pending,
      cls: !known ? 'unknown' : s.available ? 'on' : 'off',
      note: s.error ? (NOTES[s.error] || NOTES.network) : '',
      title: s.name || '',
    };
  }

  function create(deps) {
    var fetchFn = deps.fetchFn, url = deps.url || URL, render = deps.render, enabled = !!deps.enabled;
    var s = { visible: false, available: null, pending: false, error: null, name: '' };
    var stopped = !enabled;
    var seq = 0, lastSet = 0;     // a read sent before the last click must not undo it

    function show(patch) { Object.assign(s, patch); render(s); }

    function post(body) {
      return fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (res) {
          if (res.status !== 200) return { status: res.status };
          return res.json().then(function (b) { return { status: 200, body: b }; }, function () { return { status: 200, body: null }; });
        }, function () { return { status: 0 }; });
    }

    function stateFrom(r) {
      var b = r.body;
      if (b && b.ok && typeof b.available === 'boolean') return { available: b.available, name: b.display_name || s.name, error: null };
      return null;
    }

    function refresh() {
      if (stopped || s.pending) return Promise.resolve();
      var my = ++seq;
      return post({}).then(function (r) {
        if (my < lastSet) return;              // a click happened after this read was sent
        if (r.status === 403) { stopped = true; show({ visible: false, error: null }); return; }
        if (r.status === 401) { show({ visible: true, available: null, error: 'auth' }); return; }
        if (r.status === 0) { show({ visible: true, error: 'network' }); return; }
        var st = r.status === 200 && stateFrom(r);
        if (!st) { show({ visible: true, available: null, error: 'bad-reply' }); return; }
        show(Object.assign({ visible: true }, st));
      });
    }

    function toggle() {
      if (stopped || s.pending || (s.available !== true && s.available !== false)) return Promise.resolve();
      lastSet = ++seq;
      var want = !s.available;
      show({ pending: true, error: null });
      return post({ available: want }).then(function (r) {
        var st = r.status === 200 && stateFrom(r);
        if (st) { show(Object.assign({ pending: false }, st)); return; }
        show({ pending: false, error: r.status === 0 ? 'network' : r.status === 401 ? 'auth' : st === null ? 'bad-reply' : 'rejected' });
      });
    }

    function start() {
      if (stopped) return Promise.resolve();
      return refresh();
    }

    return { start: start, refresh: refresh, toggle: toggle, state: function () { return s; } };
  }

  var api = { create: create, view: view, isEnabled: isEnabled, ENABLED: ENABLED };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  if (root && root.document) {
    var mount = function () {
      var host = root.document.getElementById('repAvailability');
      if (!host || !isEnabled(ENABLED, root.location && root.location.search) || typeof root.n8nFetch !== 'function') return;
      var style = root.document.createElement('style');
      style.textContent =
        '.avail{display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:12px;font-weight:600;' +
        'padding-block:3px;padding-inline:8px 10px;border-radius:999px;border:1.5px solid #ccc;background:#fff;color:#666;cursor:pointer}' +
        '.avail .dot{inline-size:8px;block-size:8px;border-radius:50%;background:#bbb}' +
        '.avail.on{border-color:#25d366;color:#075e54;background:#e9f9ef}.avail.on .dot{background:#25d366}' +
        '.avail[disabled]{opacity:.6;cursor:default}' +
        '.avail-note{font-size:10px;color:#c0392b;margin-inline-start:6px}';
      root.document.head.appendChild(style);
      host.innerHTML = '<button type="button" class="avail" role="switch" aria-checked="false"><span class="dot"></span><span class="txt"></span></button><span class="avail-note" aria-live="polite"></span>';
      var btn = host.querySelector('button'), txt = host.querySelector('.txt'), note = host.querySelector('.avail-note');
      var c = create({
        fetchFn: function (u, o) { return root.n8nFetch(u, o); },
        enabled: true,
        render: function (st) {
          var v = view(st);
          host.hidden = v.hidden;
          if (v.hidden) return;
          btn.className = 'avail ' + v.cls;
          btn.disabled = v.disabled;
          btn.setAttribute('aria-checked', String(v.checked));
          btn.title = v.title;
          txt.textContent = v.text;
          note.textContent = v.note;
        },
      });
      btn.addEventListener('click', function () { c.toggle(); });
      c.start();
      root.setInterval(function () { c.refresh(); }, POLL_MS);
    };
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', mount);
    else mount();
  }
})(typeof window !== 'undefined' ? window : null);
