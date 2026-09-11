// WhatsApp client wrapper.
//
// Real mode drives a headless Chrome/Edge (puppeteer-core, the browser already
// on the machine) that opens WhatsApp Web, injects the wa-js library
// (@wppconnect/wa-js — the same one the Chrome extension uses) and calls it
// through page.evaluate. The login is kept in DATA_DIR/wa-session (a Chrome
// profile), so it survives restarts.
//
// Mock mode (WA_MOCK=1) simulates everything so the UI can be tried without a
// phone.
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');
const QRCode = require('qrcode');
const { db, DATA_DIR, getSetting } = require('./db');

const MOCK = process.env.WA_MOCK === '1';
const WA_JS = require.resolve('@wppconnect/wa-js');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const log = (...a) => console.log(new Date().toISOString(), '[wa]', ...a);

// Chrome profile that holds the WhatsApp login. On Windows, Chrome's cache
// storage breaks silently when the profile path is long (MAX_PATH), and
// WhatsApp Web then shows "A database error occurred" instead of a QR code.
// So: keep it under DATA_DIR when that is short enough, else use a short path.
function sessionDir() {
  const preferred = path.join(DATA_DIR, 'wa-session');
  if (process.platform !== 'win32' || preferred.length <= 90) return preferred;
  const short = path.join(process.env.LOCALAPPDATA || require('os').tmpdir(), 'wa-bulk', 'wa-session');
  if (!sessionDir.warned) { sessionDir.warned = true; log(`DATA_DIR path is long; keeping the WhatsApp session in ${short} instead`); }
  return short;
}

// If the app was killed without a clean shutdown, a Chrome from the previous run
// may still hold the profile; a new launch would then hang. Close it first.
function killStaleBrowsers(dir) {
  try {
    const { execSync } = require('child_process');
    if (process.platform === 'win32') {
      const d = dir.replace(/'/g, "''");
      const ps = "Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'chrome.exe' -or $_.Name -eq 'msedge.exe') -and $_.CommandLine -and $_.CommandLine.Contains('" + d + "') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }";
      execSync('powershell -NoProfile -Command "' + ps + '"', { stdio: 'ignore', timeout: 20000, windowsHide: true });
    } else {
      execSync("pkill -f -- '" + dir.replace(/'/g, "'\''") + "' || true", { stdio: 'ignore', timeout: 10000 });
    }
  } catch {}
}

function findBrowser() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  const c = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    (process.env.LOCALAPPDATA || '') + '/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ];
  return c.find((p) => p && fs.existsSync(p)) || null;
}

class WA extends EventEmitter {
  constructor() {
    super();
    this.state = 'stopped'; // stopped | starting | qr | ready | disconnected
    this.qrDataUrl = null;
    this.info = null;      // { pushname, number }
    this.lastError = null;
    this.browser = null;
    this.page = null;
    this._starting = false;
  }

  async start() {
    if (MOCK) return this._startMock();
    if (this._starting || this.state === 'ready' || this.state === 'qr' || this.state === 'starting') return;
    this._starting = true;
    this.state = 'starting';
    this.lastError = null;
    try {
      const puppeteer = require('puppeteer-core');
      const executablePath = findBrowser();
      if (!executablePath) throw new Error('No Chrome/Edge found. Install Google Chrome or set PUPPETEER_EXECUTABLE_PATH.');
      killStaleBrowsers(sessionDir());
      this.browser = await puppeteer.launch({
        executablePath,
        headless: process.env.WA_HEADFUL === '1' ? false : true,
        userDataDir: sessionDir(),
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--window-size=1280,900', '--no-first-run', '--no-default-browser-check'],
        defaultViewport: { width: 1280, height: 900 }
      });
      // WhatsApp Web asks for persistent storage; without it Chrome shows "A database error occurred".
      await this.browser.defaultBrowserContext().overridePermissions('https://web.whatsapp.com', ['persistent-storage', 'notifications']);
      this.browser.on('disconnected', () => {
        if (this.state !== 'stopped') { this.state = 'disconnected'; this.lastError = 'Browser closed'; this.info = null; this.emit('disconnected'); }
        this.browser = null; this.page = null;
      });
      const pages = await this.browser.pages();
      this.page = pages[0] || await this.browser.newPage();
      const page = this.page;
      await page.setUserAgent(UA);
      await page.exposeFunction('__wabEvent', (name, data) => this._onEvent(name, data));
      page.on('load', () => this._inject().catch((e) => log('inject error', e.message)));
      await page.goto('https://web.whatsapp.com/', { waitUntil: 'domcontentloaded', timeout: 120000 });
      await this._inject();
    } catch (e) {
      this.lastError = String(e.message || e);
      this.state = 'disconnected';
      log('start failed:', this.lastError);
      try { if (this.browser) await this.browser.close(); } catch {}
      this.browser = null; this.page = null;
    } finally {
      this._starting = false;
    }
  }

  // Inject wa-js + event forwarding into the current document (WhatsApp Web
  // reloads itself now and then, so this runs on every 'load').
  async _inject() {
    const page = this.page;
    if (!page) return;
    const has = await page.evaluate(() => !!window.WPP).catch(() => false);
    if (!has) {
      await page.evaluate(fs.readFileSync(WA_JS, 'utf8'));
      await page.evaluate(() => {
        const send = (name, data) => { try { window.__wabEvent(name, data === undefined ? null : data); } catch {} };
        const st = () => { try { return { authenticated: WPP.conn.isAuthenticated(), mainReady: WPP.conn.isMainReady() }; } catch { return {}; } };
        WPP.on('conn.auth_code_change', (c) => send('qr', c ? c.fullCode : null));
        WPP.on('conn.authenticated', () => send('authenticated', st()));
        WPP.on('conn.main_ready', () => send('ready', st()));
        WPP.on('conn.logout', () => send('logout', null));
        WPP.on('conn.require_auth', () => send('require_auth', null));
        WPP.on('chat.new_message', (msg) => {
          try {
            if (!msg || (msg.id && msg.id.fromMe)) return;
            const from = msg.from || (msg.id && msg.id.remote);
            if (!from || from.server !== 'c.us') return; // ignore groups / status / lids
            send('message', { phone: from.user, body: msg.body || '', hasMedia: !!(msg.type && msg.type !== 'chat'), id: msg.id && msg.id._serialized });
          } catch {}
        });
        WPP.loader.onFullReady(() => send('fullready', st()));
      });
    }
    // Catch up with the current state (e.g. session already logged in).
    const st = await page.evaluate(async () => {
      const out = { authenticated: false, mainReady: false, qr: null };
      try { out.authenticated = WPP.conn.isAuthenticated(); out.mainReady = WPP.conn.isMainReady(); } catch {}
      if (!out.authenticated) { try { const c = await WPP.conn.getAuthCode(); out.qr = c ? c.fullCode : null; } catch {} }
      return out;
    }).catch(() => null);
    if (st) {
      if (st.authenticated && st.mainReady) await this._onEvent('ready', st);
      else if (st.qr) await this._onEvent('qr', st.qr);
    }
    // Belt and braces: poll the QR while nobody is logged in (the event can be missed on reloads).
    clearInterval(this._qrPoll);
    this._qrPoll = setInterval(async () => {
      if (!this.page || this.state === 'ready' || this.state === 'stopped') return clearInterval(this._qrPoll);
      const st2 = await this.page.evaluate(async () => {
        try { if (WPP.conn.isAuthenticated()) return { auth: true, mainReady: WPP.conn.isMainReady() }; const c = await WPP.conn.getAuthCode(); return { auth: false, qr: c ? c.fullCode : null }; } catch { return null; }
      }).catch(() => null);
      if (!st2) return;
      if (st2.auth && st2.mainReady) await this._onEvent('ready', { authenticated: true, mainReady: true });
      else if (!st2.auth && st2.qr && st2.qr !== this._lastQr) { this._lastQr = st2.qr; await this._onEvent('qr', st2.qr); }
    }, 4000);
  }

  async _onEvent(name, data) {
    try {
      if (name === 'qr') {
        if (!data) return;
        this._lastQr = data;
        this.state = 'qr';
        this.qrDataUrl = await QRCode.toDataURL(data, { margin: 1, width: 300 });
        this.emit('qr');
      } else if (name === 'authenticated') {
        this.qrDataUrl = null;
        if (this.state !== 'ready') this.state = 'starting';
      } else if (name === 'ready' || name === 'fullready') {
        if (this.state === 'ready') return;
        if (!data || !data.authenticated) {   // page loaded but nobody is logged in: show the QR
          const qr = await this.page.evaluate(async () => { try { const c = await WPP.conn.getAuthCode(); return c ? c.fullCode : null; } catch { return null; } }).catch(() => null);
          if (qr) await this._onEvent('qr', qr);
          return;
        }
        if (!data.mainReady) return;
        this.qrDataUrl = null;
        const me = await this.page.evaluate(() => {
          const w = WPP.conn.getMyUserId();
          let pushname = null;
          try { pushname = WPP.whatsapp.UserPrefs.getPushname(); } catch {}
          return { number: w ? w.user : null, pushname };
        }).catch(() => ({}));
        this.info = { pushname: me.pushname || 'WhatsApp', number: me.number };
        this.state = 'ready';
        log('ready as', this.info.number);
        this.emit('ready');
      } else if (name === 'logout' || name === 'require_auth') {
        if (this.state === 'ready') {
          this.state = 'disconnected'; this.info = null; this.lastError = 'Logged out from the phone. Click Connect and scan again.';
          this.emit('disconnected');
        }
      } else if (name === 'message') {
        this.recordIncoming(data.phone, data.body, data.hasMedia ? 1 : 0, data.id);
      }
    } catch (e) { log('event error', name, e.message); }
  }

  async logout() {
    if (MOCK) { this.state = 'stopped'; this.info = null; return; }
    try { if (this.page) await this.page.evaluate(() => WPP.conn.logout()); } catch {}
    await this.stop();
    fs.rmSync(sessionDir(), { recursive: true, force: true });
  }

  async stop() {
    if (MOCK) { this.state = 'stopped'; return; }
    this.state = 'stopped';
    clearInterval(this._qrPoll);
    try { if (this.browser) await this.browser.close(); } catch {}
    this.browser = null; this.page = null; this.info = null; this.qrDataUrl = null;
  }

  isReady() { return this.state === 'ready' && !!this.page; }

  _needReady() { if (!this.isReady()) throw new Error('WhatsApp is not connected'); }

  // Returns the WhatsApp chat id for a phone, or null if the number is not on WhatsApp.
  async resolveNumber(phone) {
    if (MOCK) return phone.endsWith('0000') ? null : phone + '@c.us';
    this._needReady();
    if (getSetting('verify_numbers') !== '1') return phone + '@c.us';
    return this.page.evaluate(async (p) => {
      const r = await WPP.contact.queryExists(p + '@c.us');
      if (!r || !r.wid) return null;
      return r.wid._serialized || r.wid.toString();
    }, phone);
  }

  async sendText(chatId, text) {
    if (MOCK) { await sleep(300); return { id: 'mock-' + Date.now() }; }
    this._needReady();
    return this.page.evaluate(async (id, t) => {
      const r = await WPP.chat.sendTextMessage(id, t, { createChat: true, waitForAck: false });
      return { id: r && r.id };
    }, chatId, text);
  }

  async sendMedia(chatId, filePath, caption, filename) {
    if (MOCK) { await sleep(300); return { id: 'mock-' + Date.now() }; }
    this._needReady();
    const mime = mimeOf(filename || filePath);
    const dataUrl = `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`;
    const type = /^image\//.test(mime) ? 'image' : /^video\//.test(mime) ? 'video' : /^audio\//.test(mime) ? 'audio' : 'document';
    return this.page.evaluate(async (id, data, opts) => {
      const r = await WPP.chat.sendFileMessage(id, data, Object.assign({ createChat: true, waitForAck: false }, opts));
      return { id: r && r.id };
    }, chatId, dataUrl, { type, caption: caption || undefined, filename: filename || path.basename(filePath), mimetype: mime });
  }

  // Shared by real + mock: store message, handle opt-out keywords.
  recordIncoming(phone, body, hasMedia, waId) {
    db.prepare('INSERT INTO messages(phone, direction, body, has_media, wa_id) VALUES(?, ?, ?, ?, ?)')
      .run(phone, 'in', body, hasMedia, waId || null);
    const keywords = (getSetting('optout_keywords') || '').split(',').map((k) => k.trim().toUpperCase()).filter(Boolean);
    const text = (body || '').trim().toUpperCase();
    if (keywords.some((k) => text === k || text.startsWith(k + ' ') || text.startsWith(k + '.'))) {
      db.prepare("INSERT OR IGNORE INTO optouts(phone, source, note) VALUES(?, 'keyword', ?)").run(phone, body.slice(0, 100));
      const reply = getSetting('optout_reply');
      if (reply && this.isReady()) {
        this.sendText(phone + '@c.us', reply).then(() => {
          db.prepare("INSERT INTO messages(phone, direction, body) VALUES(?, 'out', ?)").run(phone, reply);
        }).catch(() => {});
      }
    }
    this.emit('message', { phone, body });
  }

  async _startMock() {
    if (this.state === 'ready' || this.state === 'qr') return;
    this.state = 'starting';
    this.qrDataUrl = await QRCode.toDataURL('MOCK-QR-' + Date.now(), { margin: 1, width: 300 });
    this.state = 'qr';
    this.emit('qr');
    setTimeout(() => {
      this.state = 'ready';
      this.qrDataUrl = null;
      this.info = { pushname: 'Mock Business', number: '919999999999' };
      this.emit('ready');
    }, 4000);
  }
}

const MIMES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', mp4: 'video/mp4', mp3: 'audio/mpeg', ogg: 'audio/ogg', pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', txt: 'text/plain', zip: 'application/zip', csv: 'text/csv' };
function mimeOf(name) { return MIMES[path.extname(name || '').toLowerCase().slice(1)] || 'application/octet-stream'; }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

module.exports = { wa: new WA(), MOCK };
