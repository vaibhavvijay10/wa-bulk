// Runs in the page's MAIN world next to WhatsApp Web itself. It is the only
// place that touches the wa-js library (window.WPP). The panel (an isolated
// content script) talks to it with window.postMessage.
(function () {
  const NS = 'wab-bridge-v1';
  if (window.__wabBridgeLoaded) return;
  window.__wabBridgeLoaded = true;

  function reply(id, ok, payload) {
    window.postMessage({ ns: NS, dir: 'res', id, ok, result: ok ? payload : undefined, error: ok ? undefined : String(payload && payload.message || payload) }, '*');
  }
  function emit(name, data) {
    window.postMessage({ ns: NS, dir: 'event', name, data }, '*');
  }

  function serialWid(w) {
    if (!w) return null;
    if (typeof w === 'string') return w;
    if (w._serialized) return w._serialized;
    if (typeof w.toString === 'function') return w.toString();
    return String(w);
  }

  function status() {
    const WPP = window.WPP;
    if (!WPP) return { injected: false, ready: false, authenticated: false };
    let authenticated = false, mainReady = false, me = null, pushname = null;
    try { authenticated = !!WPP.conn.isAuthenticated(); } catch {}
    try { mainReady = !!WPP.conn.isMainReady(); } catch {}
    try { const w = WPP.conn.getMyUserId(); if (w) me = w.user || serialWid(w).replace(/@.*/, ''); } catch {}
    try { pushname = (WPP.whatsapp && WPP.whatsapp.UserPrefs && WPP.whatsapp.UserPrefs.getPushname && WPP.whatsapp.UserPrefs.getPushname()) || null; } catch {}
    return {
      injected: !!WPP.isInjected, ready: !!WPP.isReady, fullReady: !!WPP.isFullReady,
      authenticated, mainReady, me, pushname,
      waJsVersion: WPP.version, waVersion: (window.Debug && window.Debug.VERSION) || null
    };
  }

  async function checkNumber(phone) {
    const WPP = window.WPP;
    const r = await WPP.contact.queryExists(phone + '@c.us');
    if (!r || !r.wid) return { exists: false };
    return { exists: true, wid: serialWid(r.wid), lid: r.lid ? serialWid(r.lid) : null, biz: !!r.biz };
  }

  async function sendText(chatId, text, opts) {
    const WPP = window.WPP;
    const r = await WPP.chat.sendTextMessage(chatId, text, Object.assign({ createChat: true, waitForAck: false }, opts || {}));
    return { id: r && r.id, ack: r && r.ack };
  }

  async function sendFile(chatId, dataUrl, opts) {
    const WPP = window.WPP;
    const r = await WPP.chat.sendFileMessage(chatId, dataUrl, Object.assign({ createChat: true, waitForAck: false }, opts || {}));
    return { id: r && r.id, ack: r && r.ack };
  }

  async function listContacts() {
    const WPP = window.WPP;
    const list = await WPP.contact.list({ onlyMyContacts: true });
    return list.filter((c) => c && c.id && c.id.server === 'c.us' && c.id.user).map((c) => ({
      phone: c.id.user, name: c.name || c.pushname || c.verifiedName || '', isBusiness: !!c.isBusiness
    }));
  }

  const handlers = { status: async () => status(), checkNumber: (a) => checkNumber(a[0]), sendText: (a) => sendText(a[0], a[1], a[2]), sendFile: (a) => sendFile(a[0], a[1], a[2]), listContacts: () => listContacts() };

  window.addEventListener('message', async (ev) => {
    const m = ev.data;
    if (!m || m.ns !== NS || m.dir !== 'req' || ev.source !== window) return;
    const fn = handlers[m.cmd];
    if (!fn) return reply(m.id, false, 'unknown command ' + m.cmd);
    try { reply(m.id, true, await fn(m.args || [])); }
    catch (e) { reply(m.id, false, e); }
  });

  // Push readiness / login / incoming-message events to the panel.
  function hook() {
    const WPP = window.WPP;
    if (!WPP) return setTimeout(hook, 500);
    const loader = WPP.loader || WPP.webpack;
    if (loader && loader.onFullReady) loader.onFullReady(() => emit('ready', status()));
    const on = (name) => { try { WPP.on(name, () => emit(name, status())); } catch {} };
    on('conn.authenticated'); on('conn.logout'); on('conn.main_ready'); on('conn.require_auth');
    try {
      WPP.on('chat.new_message', (msg) => {
        try {
          if (!msg || msg.id?.fromMe) return;
          const from = msg.from || msg.id?.remote;
          if (!from || from.server !== 'c.us') return; // ignore groups/status/lids
          emit('incoming', { phone: from.user, body: msg.body || '', type: msg.type });
        } catch {}
      });
    } catch {}
    emit('bridge-loaded', status());
  }
  hook();
})();
