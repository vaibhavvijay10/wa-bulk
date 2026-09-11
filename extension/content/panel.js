// WA Bulk Sender panel. Runs as an isolated content script on web.whatsapp.com,
// draws its UI inside a Shadow DOM (so WhatsApp's CSS can't touch it) and sends
// through the MAIN-world bridge (page/bridge.js -> wa-js).
(function () {
  if (window.__wabPanelLoaded) return;
  window.__wabPanelLoaded = true;
  const L = window.WABLib;
  const NS = 'wab-bridge-v1';

  // ---------------------------------------------------------------- bridge
  let seq = 0; const pending = new Map();
  const eventHandlers = [];
  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (!m || m.ns !== NS || ev.source !== window) return;
    if (m.dir === 'res') {
      const p = pending.get(m.id); if (!p) return;
      pending.delete(m.id);
      if (m.ok) p.resolve(m.result); else p.reject(new Error(m.error || 'bridge error'));
    } else if (m.dir === 'event') {
      for (const h of eventHandlers) { try { h(m.name, m.data); } catch {} }
    }
  });
  function bridge(cmd, args, timeout) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      window.postMessage({ ns: NS, dir: 'req', id, cmd, args: args || [] }, '*');
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('No answer from WhatsApp (' + cmd + '). Reload the page.')); } }, timeout || 120000);
    });
  }

  // ---------------------------------------------------------------- state
  const DEFAULTS = {
    cc: '91', template: '', delayMin: 10, delayMax: 25, batchSize: 25, batchPause: 120, verify: true, dailyCap: 300,
    optoutKeywords: 'STOP,UNSUBSCRIBE,OPT OUT,OPTOUT,REMOVE,CANCEL', autoOptout: true
  };
  const S = {
    settings: { ...DEFAULTS },
    optouts: [],                       // ['9198...']
    contacts: { columns: ['phone'], rows: [], phoneColumn: 'phone', source: '' },
    attachment: null,                  // { name, mime, dataUrl, kind }
    run: { status: 'idle', items: [], startedAt: null, finishedAt: null, log: [] },
    daily: { day: '', count: 0 },
    wa: { authenticated: false, mainReady: false, me: null, ready: false },
    open: false
  };
  let runToken = 0;   // increments on every start/stop so stale loops exit

  const today = () => new Date().toISOString().slice(0, 10);
  const store = {
    async load() {
      const d = await chrome.storage.local.get(['wab_settings', 'wab_optouts', 'wab_run', 'wab_daily', 'wab_contacts', 'wab_autoOpen']);
      if (d.wab_settings) S.settings = { ...DEFAULTS, ...d.wab_settings };
      if (d.wab_optouts) S.optouts = d.wab_optouts;
      if (d.wab_run) S.run = { ...S.run, ...d.wab_run, status: ['running', 'paused'].includes(d.wab_run.status) ? 'interrupted' : d.wab_run.status };
      if (d.wab_daily && d.wab_daily.day === today()) S.daily = d.wab_daily; else S.daily = { day: today(), count: 0 };
      if (d.wab_contacts) S.contacts = d.wab_contacts;
      if (d.wab_autoOpen) { S.open = true; chrome.storage.local.remove('wab_autoOpen'); }
    },
    settings() { chrome.storage.local.set({ wab_settings: S.settings }); },
    optouts() { chrome.storage.local.set({ wab_optouts: S.optouts }); },
    contacts() { chrome.storage.local.set({ wab_contacts: S.contacts }); },
    daily() { chrome.storage.local.set({ wab_daily: S.daily }); },
    run: (() => { let t = null; return () => { clearTimeout(t); t = setTimeout(() => chrome.storage.local.set({ wab_run: { ...S.run, log: S.run.log.slice(-300) } }), 300); }; })()
  };

  // ---------------------------------------------------------------- UI
  const CSS = `
    :host{all:initial}
    *{box-sizing:border-box}
    .launch{position:fixed;left:14px;bottom:14px;z-index:2147483000;background:#25d366;color:#fff;border:0;border-radius:999px;padding:10px 16px;font:600 13px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.25);cursor:pointer;display:flex;gap:8px;align-items:center}
    .launch:hover{background:#1ebe5a}
    .launch .dot{width:8px;height:8px;border-radius:50%;background:#ff5252}
    .launch .dot.on{background:#0b5f55}
    .panel{position:fixed;top:0;right:0;height:100vh;width:460px;max-width:100vw;z-index:2147483001;background:#f4f6f8;color:#1c2430;font:13px/1.45 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;box-shadow:-6px 0 24px rgba(0,0,0,.25);display:flex;flex-direction:column;transform:translateX(105%);transition:transform .2s}
    .panel.open{transform:none}
    .hd{background:#12332e;color:#fff;padding:12px 14px;display:flex;align-items:center;gap:10px}
    .hd b{font-size:15px;flex:1}
    .hd .x{background:transparent;border:0;color:#fff;font-size:20px;cursor:pointer;line-height:1}
    .badge{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:600;background:#e9edf1;color:#4a5562}
    .badge.on{background:#d9f5e3;color:#176b3a}.badge.off{background:#fde2de;color:#8b2a1f}
    .body{flex:1;overflow-y:auto;padding:12px}
    .card{background:#fff;border:1px solid #e3e8ee;border-radius:10px;padding:12px 14px;margin-bottom:12px}
    .card h2{font-size:14px;margin:0 0 10px;display:flex;align-items:center;gap:8px}
    .card h2 .n{background:#128c7e;color:#fff;border-radius:50%;width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;font-size:11px}
    label{display:block;font-weight:600;font-size:12px;margin:10px 0 4px}
    label small{font-weight:400;color:#6b7683}
    input[type=text],input[type=number],select,textarea{width:100%;padding:7px 9px;border:1px solid #cfd6de;border-radius:8px;font:inherit;background:#fff;color:#1c2430}
    textarea{min-height:90px;resize:vertical;font-family:inherit}
    input[type=file]{font:inherit;font-size:12px}
    .row{display:flex;gap:8px}.row>*{flex:1;min-width:0}
    .btn{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:8px;border:1px solid #128c7e;background:#128c7e;color:#fff;font:inherit;font-weight:600;cursor:pointer;line-height:1.2}
    .btn:hover{background:#0b5f55}.btn:disabled{opacity:.45;cursor:not-allowed}
    .btn.sec{background:#fff;color:#1c2430;border-color:#cfd6de}.btn.sec:hover{background:#f0f3f6}
    .btn.danger{background:#fff;color:#c0392b;border-color:#e6b3ad}.btn.danger:hover{background:#fdf1ef}
    .btn.big{padding:10px 16px;font-size:14px}
    .btn.sm{padding:4px 8px;font-size:11px}
    .actions{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:8px}
    .tabs{display:flex;gap:4px;border-bottom:1px solid #e3e8ee;margin-bottom:8px}
    .tabs button{background:transparent;border:0;border-bottom:2px solid transparent;padding:6px 10px;font:inherit;font-weight:600;color:#6b7683;cursor:pointer}
    .tabs button.on{color:#0b5f55;border-bottom-color:#128c7e}
    .tab{display:none}.tab.on{display:block}
    .muted{color:#6b7683}.help{color:#6b7683;font-size:11.5px;margin-top:4px}
    .ok{color:#176b3a}.bad{color:#8b2a1f}
    .mono{font-family:ui-monospace,Consolas,monospace;font-size:11.5px}
    .chips{display:flex;gap:5px;flex-wrap:wrap;margin:4px 0 6px}
    .chip{background:#e8f7ef;color:#0b5f55;border:1px solid #bfe7cf;border-radius:999px;padding:2px 9px;font-size:11.5px;cursor:pointer;font-family:ui-monospace,Consolas,monospace}
    .chip:hover{background:#d9f5e3}
    .bubble{background:#dcf8c6;border-radius:8px;padding:8px 10px;white-space:pre-wrap;word-break:break-word;margin-top:6px;font-size:12.5px}
    .bubble .meta{color:#6b7683;font-size:11px;margin-top:4px}
    table{width:100%;border-collapse:collapse;font-size:11.5px}
    th,td{text-align:left;padding:4px 6px;border-bottom:1px solid #e3e8ee;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    th{color:#6b7683;font-weight:600;font-size:11px;text-transform:uppercase}
    .tbl{overflow-x:auto;margin-top:6px}
    .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:8px 0}
    .stat{background:#f4f6f8;border-radius:8px;padding:6px 8px;text-align:center}
    .stat .v{font-size:18px;font-weight:700}.stat .l{font-size:10.5px;color:#6b7683;text-transform:uppercase}
    .bar{height:8px;background:#e9edf1;border-radius:999px;overflow:hidden;display:flex}
    .bar i{display:block;height:100%}.bar .s{background:#25d366}.bar .f{background:#e57368}.bar .k{background:#b39ddb}
    .log{background:#fff;border:1px solid #e3e8ee;border-radius:8px;max-height:220px;overflow-y:auto;padding:6px 8px;font-family:ui-monospace,Consolas,monospace;font-size:11px;margin-top:8px}
    .log div{padding:1px 0;border-bottom:1px dashed #eef1f4}
    .log .sent{color:#176b3a}.log .failed{color:#8b2a1f}.log .skipped{color:#5b3a7a}.log .info{color:#6b7683}
    .warn{background:#fff3cd;border:1px solid #f1dd94;color:#7a5a00;padding:8px 10px;border-radius:8px;margin-bottom:10px;font-size:12px}
    .err{background:#fde2de;border:1px solid #f3b7ae;color:#8b2a1f;padding:8px 10px;border-radius:8px;margin-bottom:10px;font-size:12px}
    .note{background:#e8f7ef;border:1px solid #bfe7cf;color:#176b3a;padding:8px 10px;border-radius:8px;margin-bottom:10px;font-size:12px}
    .ft{padding:8px 14px;border-top:1px solid #e3e8ee;background:#fff;font-size:11px;color:#6b7683;display:flex;justify-content:space-between;align-items:center}
    .ft a{color:#0b5f55;cursor:pointer;text-decoration:underline}
    details summary{cursor:pointer;font-weight:600;font-size:12.5px}
  `;

  const HTML = `
  <button class="launch" id="launch"><span class="dot" id="dot"></span> WA Bulk</button>
  <div class="panel" id="panel">
    <div class="hd"><b>WA Bulk Sender</b><span class="badge off" id="waBadge">not connected</span><button class="x" id="close" title="Close">×</button></div>
    <div class="body">
      <div id="connectBox" class="warn">Scan the QR code on this page with your phone (WhatsApp → Linked devices → Link a device). The panel unlocks once WhatsApp Web is connected.</div>
      <div id="resumeBox" class="note" style="display:none"></div>

      <div class="card">
        <h2><span class="n">1</span> Contacts <span class="muted" id="contactCount" style="font-weight:400;margin-left:auto"></span></h2>
        <div class="tabs"><button data-tab="paste" class="on">Paste list</button><button data-tab="excel">Excel / CSV</button><button data-tab="mine">My WhatsApp contacts</button></div>
        <div class="tab on" data-tab="paste">
          <textarea id="paste" placeholder="Paste numbers here, one per line. Names are optional:
9876543210, Rahul
+44 7700 900123, Emma
…or copy whole columns straight from Excel (with a header row)."></textarea>
          <div class="help">Numbers do not need to be saved in your phone. Numbers without a country code get the default code below.</div>
        </div>
        <div class="tab" data-tab="excel">
          <input type="file" id="sheet" accept=".xlsx,.xls,.csv,.xlsm,.ods,.txt">
          <div class="help">Row 1 must be the headers. One column holds the phone number; every other column becomes a merge field like <span class="mono">{{name}}</span>.</div>
        </div>
        <div class="tab" data-tab="mine">
          <div class="actions"><button class="btn sec" id="loadMine">Load my saved contacts</button><button class="btn sec" id="dlMine" disabled>Download as CSV</button></div>
          <div class="help">Loads the contacts saved on this WhatsApp account (name + number) so you can message all of them, or export them.</div>
        </div>
        <div class="row">
          <div><label>Default country code</label><input type="text" id="cc" value="91"></div>
          <div><label>Phone column</label><select id="phoneCol"></select></div>
        </div>
        <div class="tbl" id="preview"></div>
        <div class="help" id="contactSummary"></div>
      </div>

      <div class="card">
        <h2><span class="n">2</span> Message</h2>
        <div class="chips" id="chips"></div>
        <textarea id="template" placeholder="{{Hi|Hello}} {{name|there}}, …"></textarea>
        <div class="help"><span class="mono">{{name}}</span> inserts a column, <span class="mono">{{name|there}}</span> uses “there” when the cell is empty, <span class="mono">{{Hi|Hello|Hey}}</span> picks one at random so messages are not identical. *bold* _italic_ work like in WhatsApp.</div>
        <label>Attachment <small>(optional: image, PDF, video, document — the text becomes the caption)</small></label>
        <div class="row"><input type="file" id="attach" accept="image/*,video/mp4,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip"><button class="btn sec sm" id="attachClear" style="flex:0;display:none">Remove</button></div>
        <div class="help" id="attachInfo"></div>
        <div id="msgPreview"></div>
        <div class="actions"><button class="btn sec sm" id="testSend" disabled>Send a test to my own number</button><span class="muted" id="testInfo"></span></div>
      </div>

      <div class="card">
        <h2><span class="n">3</span> Sending speed</h2>
        <div class="row">
          <div><label>Min delay <small>(sec)</small></label><input type="number" id="delayMin" min="2"></div>
          <div><label>Max delay <small>(sec)</small></label><input type="number" id="delayMax" min="2"></div>
          <div><label>Batch size</label><input type="number" id="batchSize" min="0"></div>
          <div><label>Batch pause <small>(sec)</small></label><input type="number" id="batchPause" min="0"></div>
        </div>
        <div class="row">
          <div><label>Daily limit <small>(0 = none)</small></label><input type="number" id="dailyCap" min="0"></div>
          <div><label>&nbsp;</label><label style="font-weight:400;margin:0"><input type="checkbox" id="verify"> Check number is on WhatsApp first</label></div>
        </div>
        <div class="help">A random wait between min and max before each message, plus a longer pause after every batch. Slow and varied is what keeps a number from being blocked. Sent today: <b id="sentToday">0</b>.</div>
      </div>

      <div class="card">
        <h2><span class="n">4</span> Send</h2>
        <div id="readyLine" class="muted"></div>
        <div class="actions">
          <button class="btn big" id="start" disabled>▶ Start sending</button>
          <button class="btn sec" id="pause" style="display:none">⏸ Pause</button>
          <button class="btn" id="resume" style="display:none">▶ Resume</button>
          <button class="btn danger" id="stop" style="display:none">■ Stop</button>
        </div>
        <div id="runBox" style="display:none">
          <div class="stats">
            <div class="stat"><div class="v" id="nSent">0</div><div class="l">Sent</div></div>
            <div class="stat"><div class="v" id="nFailed">0</div><div class="l">Failed</div></div>
            <div class="stat"><div class="v" id="nSkipped">0</div><div class="l">Skipped</div></div>
            <div class="stat"><div class="v" id="nPending">0</div><div class="l">Pending</div></div>
          </div>
          <div class="bar"><i class="s" id="bS"></i><i class="f" id="bF"></i><i class="k" id="bK"></i></div>
          <div class="help" id="eta"></div>
          <div class="log" id="log"></div>
          <div class="actions"><button class="btn sec sm" id="report">⬇ Download report (CSV)</button><button class="btn sec sm" id="retry" style="display:none">↻ Retry failed</button><button class="btn sec sm" id="clearRun">Clear</button></div>
        </div>
      </div>

      <div class="card">
        <details><summary>Unsubscribe list <span class="muted" id="optCount"></span></summary>
          <label>Numbers that must never be messaged <small>(one per line)</small></label>
          <textarea id="optouts" style="min-height:70px"></textarea>
          <label style="font-weight:400"><input type="checkbox" id="autoOptout"> Add people automatically when they reply with one of these words:</label>
          <input type="text" id="optKeywords">
          <div class="actions"><button class="btn sec sm" id="saveOpt">Save</button></div>
        </details>
      </div>

      <div class="card">
        <details><summary>Keeping your number safe</summary>
          <ul class="help" style="padding-left:16px;margin:6px 0">
            <li>Warm up a new number: use it normally for a week before bulk sending. Start with 50–100 a day and raise slowly.</li>
            <li>Stay under a few hundred messages a day per number. Keep the delays; do not set them to 1 second.</li>
            <li>Personalise with <span class="mono">{{name}}</span> and rotate wording with <span class="mono">{{a|b|c}}</span> so no two messages are identical.</li>
            <li>People who do not know you report spam; reports are what get numbers banned. Honour STOP replies.</li>
            <li>Do not use a number you cannot afford to lose. WhatsApp does not officially permit automation.</li>
          </ul>
        </details>
      </div>
    </div>
    <div class="ft"><span id="ftInfo">WA Bulk Sender</span><a id="reload">Reload WhatsApp</a></div>
  </div>`;

  const host = document.createElement('div');
  host.id = 'wab-host';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style'); style.textContent = CSS;
  const wrap = document.createElement('div'); wrap.innerHTML = HTML;
  shadow.append(style, wrap);
  (document.body || document.documentElement).appendChild(host);
  // WhatsApp Web occasionally rebuilds <body>; put the panel back if it disappears.
  new MutationObserver(() => { if (!host.isConnected && document.body) document.body.appendChild(host); }).observe(document.documentElement, { childList: true, subtree: false });
  setInterval(() => { if (!host.isConnected && document.body) document.body.appendChild(host); }, 2000);
  const $ = (id) => shadow.getElementById(id);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------------------------------------------------------------- helpers
  function setOpen(v) { S.open = v; $('panel').classList.toggle('open', v); }
  function logLine(cls, text) {
    const line = { t: new Date().toISOString(), cls, text };
    S.run.log.push(line); if (S.run.log.length > 1000) S.run.log.shift();
    const el = $('log'); const d = document.createElement('div'); d.className = cls;
    d.textContent = line.t.slice(11, 19) + '  ' + text; el.appendChild(d);
    while (el.children.length > 300) el.removeChild(el.firstChild);
    el.scrollTop = el.scrollHeight;
  }
  function renderLog() {
    const el = $('log'); el.innerHTML = '';
    for (const line of S.run.log.slice(-300)) { const d = document.createElement('div'); d.className = line.cls; d.textContent = line.t.slice(11, 19) + '  ' + line.text; el.appendChild(d); }
    el.scrollTop = el.scrollHeight;
  }
  function counts() {
    const c = { sent: 0, failed: 0, skipped: 0, pending: 0, total: S.run.items.length };
    for (const it of S.run.items) c[it.status] = (c[it.status] || 0) + 1;
    return c;
  }
  function download(name, text, mime) {
    const blob = new Blob([text], { type: mime || 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; a.style.display = 'none';
    document.body.appendChild(a); a.click(); setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 2000);
  }
  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
  function fileKind(mime, name) {
    if (/^image\//.test(mime)) return 'image';
    if (/^video\//.test(mime)) return 'video';
    if (/^audio\//.test(mime)) return 'audio';
    return 'document';
  }

  // ---------------------------------------------------------------- contacts
  let parseTimer = null;
  function setContacts(columns, rows, phoneColumn, source) {
    S.contacts = { columns, rows, phoneColumn: phoneColumn || L.guessPhoneColumn(columns, rows, S.settings.cc), source };
    store.contacts();
    renderContacts();
  }
  function renderContacts() {
    const c = S.contacts;
    const sel = $('phoneCol'); sel.innerHTML = '';
    for (const col of c.columns) { const o = document.createElement('option'); o.value = col; o.textContent = col; if (col === c.phoneColumn) o.selected = true; sel.appendChild(o); }
    const q = L.buildQueue(c.rows, c.phoneColumn, S.settings.cc, S.optouts);
    const inv = q.skipped.filter((s) => s.reason === 'invalid number').length, dup = q.skipped.filter((s) => s.reason === 'duplicate').length, un = q.skipped.filter((s) => s.reason === 'unsubscribed').length;
    $('contactCount').textContent = c.rows.length ? `${q.queue.length} ready` : '';
    $('contactSummary').innerHTML = c.rows.length
      ? `<b>${q.queue.length}</b> numbers will be messaged${c.source ? ' (' + esc(c.source) + ')' : ''}. ` + [inv ? `<span class="bad">${inv} invalid</span>` : '', dup ? `${dup} duplicates` : '', un ? `${un} unsubscribed` : ''].filter(Boolean).join(', ')
      : '';
    // preview table (first 4 rows)
    const pv = $('preview');
    if (!c.rows.length) { pv.innerHTML = ''; }
    else {
      const cols = c.columns.slice(0, 5);
      pv.innerHTML = '<table><tr>' + cols.map((k) => `<th>${esc(k)}${k === c.phoneColumn ? ' 📱' : ''}</th>`).join('') + '</tr>' +
        c.rows.slice(0, 4).map((r) => '<tr>' + cols.map((k) => { const v = r[k]; const bad = k === c.phoneColumn && !L.normalizePhone(v, S.settings.cc); return `<td class="${bad ? 'bad' : ''}" title="${esc(v)}">${esc(v)}</td>`; }).join('') + '</tr>').join('') +
        (c.rows.length > 4 ? `<tr><td colspan="${cols.length}" class="muted">… ${c.rows.length - 4} more</td></tr>` : '') + '</table>';
    }
    // merge-field chips
    const chips = $('chips'); chips.innerHTML = '';
    for (const col of c.columns) if (col !== c.phoneColumn) { const s = document.createElement('span'); s.className = 'chip'; s.textContent = `{{${col}}}`; s.onclick = () => insertAtCursor($('template'), `{{${col}}}`); chips.appendChild(s); }
    const sp = document.createElement('span'); sp.className = 'chip'; sp.textContent = '{{Hi|Hello|Hey}}'; sp.title = 'One option is picked at random per message'; sp.onclick = () => insertAtCursor($('template'), '{{Hi|Hello|Hey}}'); chips.appendChild(sp);
    renderMessagePreview(); renderReady();
  }
  function insertAtCursor(ta, text) {
    const s = ta.selectionStart || 0, e = ta.selectionEnd || 0;
    ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
    ta.focus(); ta.selectionStart = ta.selectionEnd = s + text.length;
    ta.dispatchEvent(new Event('input'));
  }
  $('paste').addEventListener('input', () => {
    clearTimeout(parseTimer);
    parseTimer = setTimeout(() => { const p = L.parsePaste($('paste').value, S.settings.cc); setContacts(p.columns, p.rows, p.phoneColumn, 'pasted list'); }, 250);
  });
  $('sheet').addEventListener('change', async () => {
    const f = $('sheet').files[0]; if (!f) return;
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
      if (!rows.length) throw new Error('first sheet is empty (need a header row plus contacts)');
      const c = L.cleanSheetRows(rows);
      setContacts(c.columns, c.rows, null, f.name);
    } catch (e) { alert('Could not read that file: ' + e.message); }
  });
  $('phoneCol').addEventListener('change', () => { S.contacts.phoneColumn = $('phoneCol').value; store.contacts(); renderContacts(); });
  $('cc').addEventListener('input', () => { S.settings.cc = $('cc').value.replace(/\D/g, ''); store.settings(); renderContacts(); });
  $('loadMine').addEventListener('click', async () => {
    $('loadMine').disabled = true; $('loadMine').textContent = 'Loading…';
    try {
      const list = await bridge('listContacts', [], 60000);
      setContacts(['phone', 'name'], list.map((c) => ({ phone: c.phone, name: c.name })), 'phone', 'my WhatsApp contacts');
      $('dlMine').disabled = !list.length;
    } catch (e) { alert('Could not load contacts: ' + e.message); }
    $('loadMine').disabled = false; $('loadMine').textContent = 'Load my saved contacts';
  });
  $('dlMine').addEventListener('click', () => download('whatsapp-contacts.csv', L.toCSV(['name'], S.contacts.rows.map((r) => ({ phone: r.phone, status: '', row: r })))));
  shadow.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
    shadow.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
    shadow.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x.dataset.tab === b.dataset.tab));
  }));

  // ---------------------------------------------------------------- message
  function renderMessagePreview() {
    const tpl = $('template').value;
    const q = L.buildQueue(S.contacts.rows, S.contacts.phoneColumn, S.settings.cc, S.optouts).queue;
    const box = $('msgPreview');
    if (!tpl.trim() && !S.attachment) { box.innerHTML = ''; return; }
    const first = q[0];
    const text = L.render(tpl, first ? first.row : {});
    const unknown = L.fields(tpl).filter((f) => !S.contacts.columns.some((c) => c.toLowerCase() === f.toLowerCase()));
    box.innerHTML = `<div class="bubble">${S.attachment ? '📎 ' + esc(S.attachment.name) + '\n' : ''}${esc(text) || '<span class="muted">(empty)</span>'}<div class="meta">Preview for ${first ? '+' + first.phone : 'the first contact'}</div></div>` +
      (unknown.length ? `<div class="help bad">Not a column in your list (will be blank): ${esc(unknown.join(', '))}</div>` : '');
  }
  $('template').addEventListener('input', () => { S.settings.template = $('template').value; store.settings(); renderMessagePreview(); renderReady(); });
  $('attach').addEventListener('change', () => {
    const f = $('attach').files[0]; if (!f) return;
    if (f.size > 60 * 1024 * 1024) { alert('File is too large (max 60 MB).'); $('attach').value = ''; return; }
    const fr = new FileReader();
    fr.onload = () => { S.attachment = { name: f.name, mime: f.type || 'application/octet-stream', dataUrl: fr.result, kind: fileKind(f.type, f.name) }; renderAttach(); };
    fr.readAsDataURL(f);
  });
  $('attachClear').addEventListener('click', () => { S.attachment = null; $('attach').value = ''; renderAttach(); });
  function renderAttach() {
    $('attachInfo').textContent = S.attachment ? `${S.attachment.name} (${S.attachment.kind}, ${Math.round(S.attachment.dataUrl.length * 0.75 / 1024)} KB)` : '';
    $('attachClear').style.display = S.attachment ? '' : 'none';
    renderMessagePreview(); renderReady();
  }
  $('testSend').addEventListener('click', async () => {
    if (!S.wa.me) return;
    const q = L.buildQueue(S.contacts.rows, S.contacts.phoneColumn, S.settings.cc, S.optouts).queue;
    const text = L.render($('template').value, q[0] ? q[0].row : {});
    $('testSend').disabled = true; $('testInfo').textContent = 'sending…';
    try { await sendOne(S.wa.me + '@c.us', text); $('testInfo').textContent = 'sent to +' + S.wa.me + ' ✓'; }
    catch (e) { $('testInfo').textContent = 'failed: ' + e.message; }
    $('testSend').disabled = false;
  });

  // ---------------------------------------------------------------- settings
  const NUM = ['delayMin', 'delayMax', 'batchSize', 'batchPause', 'dailyCap'];
  function renderSettings() {
    for (const k of NUM) $(k).value = S.settings[k];
    $('verify').checked = !!S.settings.verify;
    $('cc').value = S.settings.cc;
    $('template').value = S.settings.template || '';
    $('optouts').value = S.optouts.join('\n');
    $('optKeywords').value = S.settings.optoutKeywords;
    $('autoOptout').checked = !!S.settings.autoOptout;
    $('optCount').textContent = S.optouts.length ? `(${S.optouts.length})` : '';
    $('sentToday').textContent = S.daily.count;
  }
  for (const k of NUM) $(k).addEventListener('change', () => {
    let v = parseInt($(k).value, 10); if (!Number.isFinite(v) || v < 0) v = DEFAULTS[k];
    if (k === 'delayMin' && v < 2) v = 2;
    if (k === 'delayMax' && v < S.settings.delayMin) v = S.settings.delayMin;
    S.settings[k] = v; $(k).value = v; store.settings();
  });
  $('verify').addEventListener('change', () => { S.settings.verify = $('verify').checked; store.settings(); });
  $('saveOpt').addEventListener('click', () => {
    S.optouts = [...new Set($('optouts').value.split(/[\s,;]+/).map((p) => L.normalizePhone(p, S.settings.cc)).filter(Boolean))];
    S.settings.optoutKeywords = $('optKeywords').value; S.settings.autoOptout = $('autoOptout').checked;
    store.optouts(); store.settings(); renderSettings(); renderContacts();
  });
  function addOptout(phone, why) {
    if (S.optouts.includes(phone)) return;
    S.optouts.push(phone); store.optouts(); renderSettings();
    logLine('info', `+${phone} added to unsubscribe list (${why})`);
  }

  // ---------------------------------------------------------------- sending
  async function sendOne(chatId, text) {
    if (S.attachment) {
      const a = S.attachment;
      return bridge('sendFile', [chatId, a.dataUrl, { type: a.kind, caption: text || undefined, filename: a.name, mimetype: a.mime }], 180000);
    }
    return bridge('sendText', [chatId, text], 60000);
  }
  function renderReady() {
    const q = L.buildQueue(S.contacts.rows, S.contacts.phoneColumn, S.settings.cc, S.optouts).queue;
    const hasMsg = !!($('template').value.trim() || S.attachment);
    const running = ['running', 'paused'].includes(S.run.status);
    const connected = S.wa.authenticated && S.wa.mainReady;
    let line = '';
    if (!connected) line = 'Waiting for WhatsApp Web to connect…';
    else if (!q.length) line = 'Add contacts in step 1.';
    else if (!hasMsg) line = 'Write a message (or attach a file) in step 2.';
    else line = `Ready: ${q.length} messages from +${S.wa.me}.`;
    $('readyLine').textContent = running ? '' : line;
    $('start').disabled = running || !connected || !q.length || !hasMsg;
    $('testSend').disabled = !connected || !hasMsg;
    $('start').style.display = running ? 'none' : '';
    $('pause').style.display = S.run.status === 'running' ? '' : 'none';
    $('resume').style.display = S.run.status === 'paused' ? '' : 'none';
    $('stop').style.display = running ? '' : 'none';
    $('runBox').style.display = S.run.items.length ? '' : 'none';
    $('retry').style.display = !running && S.run.items.some((i) => i.status === 'failed' && i.reason !== 'not on WhatsApp') ? '' : 'none';
    renderProgress();
  }
  function renderProgress() {
    const c = counts();
    $('nSent').textContent = c.sent; $('nFailed').textContent = c.failed; $('nSkipped').textContent = c.skipped; $('nPending').textContent = c.pending;
    const pct = (n) => (c.total ? (n / c.total * 100) + '%' : '0%');
    $('bS').style.width = pct(c.sent); $('bF').style.width = pct(c.failed); $('bK').style.width = pct(c.skipped);
    const avg = (S.settings.delayMin + S.settings.delayMax) / 2 + (S.settings.batchSize ? S.settings.batchPause / S.settings.batchSize : 0);
    const mins = Math.round(c.pending * avg / 60);
    $('eta').textContent = S.run.status === 'running' ? `About ${mins} min remaining at the current pace.` : S.run.status === 'done' ? 'Finished.' : S.run.status === 'stopped' ? 'Stopped.' : S.run.status === 'paused' ? 'Paused.' : S.run.status === 'interrupted' ? 'Interrupted (page was reloaded).' : '';
    $('sentToday').textContent = S.daily.count;
  }

  function startRun() {
    const q = L.buildQueue(S.contacts.rows, S.contacts.phoneColumn, S.settings.cc, S.optouts);
    if (!q.queue.length) return;
    S.run = { status: 'running', items: [...q.queue, ...q.skipped], startedAt: new Date().toISOString(), finishedAt: null, log: [], columns: S.contacts.columns, phoneColumn: S.contacts.phoneColumn, template: $('template').value, attachmentName: S.attachment ? S.attachment.name : null };
    $('log').innerHTML = '';
    logLine('info', `Started: ${q.queue.length} to send, ${q.skipped.length} skipped (invalid/duplicate/unsubscribed).`);
    store.run(); renderReady();
    loop(++runToken);
  }
  function resumeRun() {
    if (!S.run.items.some((i) => i.status === 'pending')) return;
    S.run.status = 'running'; logLine('info', 'Resumed.'); store.run(); renderReady();
    loop(++runToken);
  }
  async function loop(token) {
    let inBatch = 0;
    const alive = () => token === runToken && S.run.status === 'running';
    while (alive()) {
      const item = S.run.items.find((i) => i.status === 'pending');
      if (!item) { finish('done'); break; }
      if (S.settings.dailyCap > 0 && S.daily.day === today() && S.daily.count >= S.settings.dailyCap) {
        logLine('info', `Daily limit of ${S.settings.dailyCap} reached. Pausing — resume tomorrow or raise the limit in step 3.`);
        S.run.status = 'paused'; store.run(); renderReady(); break;
      }
      if (S.daily.day !== today()) { S.daily = { day: today(), count: 0 }; store.daily(); }
      if (!(S.wa.authenticated && S.wa.mainReady)) { logLine('info', 'WhatsApp is not connected. Waiting…'); await waitWhile(token, 5000); continue; }
      if (S.optouts.includes(item.phone)) { item.status = 'skipped'; item.reason = 'unsubscribed'; logLine('skipped', `+${item.phone} skipped: unsubscribed`); store.run(); renderProgress(); continue; }
      const text = L.render(S.run.template, item.row);
      item.rendered = text;
      try {
        let chatId = item.phone + '@c.us';
        if (S.settings.verify) {
          const r = await bridge('checkNumber', [item.phone], 30000);
          if (!r.exists) { item.status = 'failed'; item.reason = 'not on WhatsApp'; logLine('failed', `+${item.phone}: not on WhatsApp`); store.run(); renderProgress(); await waitWhile(token, L.rand(1500, 3500)); continue; }
          chatId = r.wid || chatId;
        }
        await sendOne(chatId, text);
        item.status = 'sent'; item.reason = null; item.sentAt = new Date().toISOString();
        S.daily.count++; store.daily();
        inBatch++;
        logLine('sent', `+${item.phone} sent${item.row && item.row.name ? ' (' + item.row.name + ')' : ''}`);
      } catch (e) {
        item.status = 'failed'; item.reason = String(e.message || e).slice(0, 160);
        logLine('failed', `+${item.phone} failed: ${item.reason}`);
      }
      store.run(); renderProgress();
      if (!S.run.items.some((i) => i.status === 'pending')) { finish('done'); break; }
      let wait = L.rand(S.settings.delayMin, S.settings.delayMax) * 1000;
      if (S.settings.batchSize > 0 && inBatch >= S.settings.batchSize) { inBatch = 0; wait += S.settings.batchPause * 1000; logLine('info', `Batch done — pausing ${S.settings.batchPause}s.`); }
      await waitWhile(token, wait);
    }
  }
  async function waitWhile(token, ms) {
    const until = Date.now() + ms;
    while (Date.now() < until && token === runToken && S.run.status === 'running') await sleep(Math.min(500, until - Date.now()));
  }
  function finish(status) {
    S.run.status = status; S.run.finishedAt = new Date().toISOString();
    const c = counts();
    logLine('info', `${status === 'done' ? 'Finished' : 'Stopped'}: ${c.sent} sent, ${c.failed} failed, ${c.skipped} skipped.`);
    store.run(); renderReady();
  }
  $('start').addEventListener('click', () => {
    const q = L.buildQueue(S.contacts.rows, S.contacts.phoneColumn, S.settings.cc, S.optouts).queue;
    if (!confirm(`Send to ${q.length} numbers from +${S.wa.me}?\n\nKeep this tab open while it runs.`)) return;
    startRun();
  });
  $('pause').addEventListener('click', () => { S.run.status = 'paused'; runToken++; logLine('info', 'Paused.'); store.run(); renderReady(); });
  $('resume').addEventListener('click', resumeRun);
  $('stop').addEventListener('click', () => { if (!confirm('Stop sending? Pending numbers will not be messaged.')) return; runToken++; finish('stopped'); });
  $('retry').addEventListener('click', () => {
    let n = 0; for (const it of S.run.items) if (it.status === 'failed' && it.reason !== 'not on WhatsApp') { it.status = 'pending'; it.reason = null; n++; }
    logLine('info', `${n} failed numbers re-queued.`); resumeRun();
  });
  $('report').addEventListener('click', () => download(`wa-bulk-report-${(S.run.startedAt || '').slice(0, 16).replace(/[:T]/g, '-')}.csv`, L.toCSV(S.run.columns || S.contacts.columns, S.run.items)));
  $('clearRun').addEventListener('click', () => { if (['running', 'paused'].includes(S.run.status) && !confirm('A run is in progress. Clear it?')) return; runToken++; S.run = { status: 'idle', items: [], startedAt: null, finishedAt: null, log: [] }; $('log').innerHTML = ''; $('resumeBox').style.display = 'none'; store.run(); renderReady(); });
  $('reload').addEventListener('click', () => location.reload());

  // ---------------------------------------------------------------- WA status
  function applyStatus(st) {
    if (!st) return;
    S.wa = { authenticated: !!st.authenticated, mainReady: !!st.mainReady, me: st.me || S.wa.me, ready: !!st.ready };
    const on = S.wa.authenticated && S.wa.mainReady;
    $('waBadge').textContent = on ? '+' + (S.wa.me || '…') + ' connected' : (S.wa.authenticated ? 'loading chats…' : 'not connected');
    $('waBadge').className = 'badge ' + (on ? 'on' : 'off');
    $('dot').className = 'dot' + (on ? ' on' : '');
    $('connectBox').style.display = on ? 'none' : '';
    $('ftInfo').textContent = 'WA Bulk Sender' + (st.waVersion ? ' · WhatsApp Web ' + st.waVersion : '');
    renderReady();
  }
  eventHandlers.push((name, data) => {
    if (name === 'incoming') {
      if (!S.settings.autoOptout || !data || !data.phone) return;
      const kws = S.settings.optoutKeywords.split(',').map((k) => k.trim().toUpperCase()).filter(Boolean);
      const t = String(data.body || '').trim().toUpperCase();
      if (kws.some((k) => t === k || t.startsWith(k + ' ') || t.startsWith(k + '.'))) addOptout(data.phone, 'replied "' + String(data.body).slice(0, 20) + '"');
      return;
    }
    applyStatus(data);
  });
  async function pollStatus() {
    try { applyStatus(await bridge('status', [], 5000)); } catch { /* bridge not loaded yet */ }
  }

  // ---------------------------------------------------------------- wiring
  $('launch').addEventListener('click', () => setOpen(!S.open));
  $('close').addEventListener('click', () => setOpen(false));
  chrome.runtime.onMessage.addListener((m) => { if (m && m.type === 'wab:toggle') setOpen(!S.open); });

  (async () => {
    await store.load();
    renderSettings();
    renderContacts();
    renderAttach();
    if (S.run.items.length) {
      renderLog();
      const pend = S.run.items.filter((i) => i.status === 'pending').length;
      if (S.run.status === 'interrupted' && pend) {
        $('resumeBox').style.display = '';
        $('resumeBox').innerHTML = `A previous run was interrupted with ${pend} numbers still pending. <a id="resumeLink" style="cursor:pointer;text-decoration:underline">Resume it</a> or clear it in step 4.${S.run.attachmentName ? ' (Re-attach ' + esc(S.run.attachmentName) + ' first if it had a file.)' : ''}`;
        $('resumeLink').addEventListener('click', () => { $('resumeBox').style.display = 'none'; resumeRun(); });
      }
    }
    renderReady();
    setOpen(S.open);
    pollStatus(); setInterval(pollStatus, 3000);
  })();
})();
