// End-to-end test: loads the unpacked extension into local Chrome, opens the
// real WhatsApp Web page (QR screen, no login needed), then swaps the wa-js
// send/check functions for fakes so a full run can be exercised safely.
//   node test/e2e.js        (needs puppeteer-core on NODE_PATH, and Chrome)
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const EXT = path.resolve(__dirname, '..');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = process.env.OUT_DIR || __dirname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1; };
const ok = (m) => console.log('ok  ', m);

(async () => {
  // short path: Chrome's cache storage breaks on long Windows paths and WhatsApp Web then shows a database error
  const profile = path.join(process.env.LOCALAPPDATA || require('os').tmpdir(), 'wab-e2e-profile'); fs.rmSync(profile, { recursive: true, force: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, userDataDir: profile, pipe: true,
    enableExtensions: [EXT],   // Chrome 137+ ignores --load-extension; puppeteer installs it over CDP instead
    args: ['--no-sandbox', '--disable-gpu', '--window-size=1400,900']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36');
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));
  page.on('console', (m) => { const t = m.text(); if (/wab|WAB|extension/i.test(t) && !/Permissions-Policy/.test(t)) console.log('[console]', t.slice(0, 200)); });
  await page.goto('https://web.whatsapp.com/', { waitUntil: 'domcontentloaded', timeout: 90000 });

  // 1. extension injected?
  let st = null;
  for (let i = 0; i < 40; i++) {
    try {
      st = await page.evaluate(() => {
        const host = document.getElementById('wab-host');
        return { host: !!host, launch: !!(host && host.shadowRoot && host.shadowRoot.getElementById('launch')), wpp: !!window.WPP, ready: !!(window.WPP && window.WPP.isReady), bridge: !!window.__wabBridgeLoaded };
      });
    } catch (e) { st = { navigating: true }; }  // WhatsApp Web reloads itself once on first load
    if (st.host && st.launch && st.wpp && st.ready && st.bridge) break;
    await sleep(1000);
  }
  console.log('inject state', st);
  if (!(st.host && st.launch && st.wpp && st.ready && st.bridge)) { fail('extension did not inject / wa-js not ready'); await browser.close(); return; }
  ok('panel + bridge + wa-js injected on live WhatsApp Web');

  const sh = async (fn, ...a) => {
    for (let i = 0; ; i++) {
      try { return await page.evaluate((src, args) => (new Function('$', 'args', 'return (' + src + ')($, ...args)'))((id) => document.getElementById('wab-host').shadowRoot.getElementById(id), args), fn.toString(), a); }
      catch (e) { if (i >= 8) throw e; await sleep(1000); }   // page reloaded / host briefly missing
    }
  };
  // Let WhatsApp Web settle (a fresh profile reloads itself once or twice on first load).
  let stableFor = 0;
  for (let i = 0; i < 60 && stableFor < 8; i++) {
    let present = false; try { present = await page.evaluate(() => !!document.getElementById('wab-host') && !!window.__wabBridgeLoaded); } catch {}
    stableFor = present ? stableFor + 1 : 0; await sleep(1000);
  }
  console.log('page settled; bridge present for', stableFor, 's');

  // Panel should report "not connected" at the QR screen
  await sleep(3500);
  const badge0 = await sh(($) => $('waBadge').textContent);
  console.log('badge before login:', badge0);
  if (!/not connected/.test(badge0)) fail('expected "not connected" badge at QR screen');
  else ok('badge shows not connected at QR screen');

  // 2. fake the WhatsApp side (MAIN world)
  await page.evaluate(() => {
    window.__sent = []; window.__checked = [];
    // wa-js namespaces are frozen module objects: replace window.WPP with a writable copy
    const W = window.WPP; window.WPP = { ...W, conn: { ...W.conn }, contact: { ...W.contact }, chat: { ...W.chat } };
    WPP.conn.isAuthenticated = () => true;
    WPP.conn.isMainReady = () => true;
    WPP.conn.getMyUserId = () => ({ user: '919999999999', _serialized: '919999999999@c.us', toString() { return '919999999999@c.us'; } });
    WPP.contact.queryExists = async (id) => { window.__checked.push(id); return id.startsWith('919000000000') ? null : { wid: { _serialized: id } }; };
    WPP.chat.sendTextMessage = async (id, text, opts) => { window.__sent.push({ id: String(id), text, opts }); return { id: 'true_' + id + '_' + Date.now() }; };
    // delivery ticks: 919876543210 read (3), everything else delivered (2); only Rahul replies
    WPP.chat.getMessageById = async (id) => ({ ack: String(id).includes('919876543210') ? 3 : 2 });
    WPP.chat.getMessages = async (chatId) => String(chatId).startsWith('919876543210') ? [{ id: { fromMe: false }, t: Math.floor(Date.now() / 1000) + 5, body: 'Thanks, interested!' }] : [];
    WPP.chat.sendFileMessage = async (id, data, opts) => { window.__sent.push({ id: String(id), file: opts, len: data.length }); return { id: 'f' + Date.now() }; };
    WPP.contact.list = async () => [{ id: { server: 'c.us', user: '919811111111' }, name: 'Saved One' }, { id: { server: 'g.us', user: '1' }, name: 'group' }];
  });
  let badge = '';
  for (let i = 0; i < 10; i++) { await sleep(1000); badge = await sh(($) => $('waBadge').textContent); if (/connected/.test(badge) && !/not/.test(badge)) break; }
  console.log('badge after fake login:', badge);
  if (!/\+919999999999 connected/.test(badge)) fail('badge did not show the connected number'); else ok('connected number shown in header');

  // 3. open the panel and drive the UI through the shadow DOM
  await sh(($) => $('launch').click());
  await sleep(400);
  const open = await sh(($) => $('panel').classList.contains('open'));
  if (!open) fail('panel did not open'); else ok('panel opens from the launcher button');

  await sh(($, v) => { const ta = $('paste'); ta.value = v; ta.dispatchEvent(new Event('input')); },
    'Name\tMobile\tCity\nRahul\t9876543210\tPune\nEmma\t+44 7700 900123\tLeeds\nDead\t9000000000\tX\nBad\tabc\tY\nDup\t98765 43210\tZ');
  await sleep(600);
  const summary = await sh(($) => $('contactSummary').textContent);
  console.log('summary:', summary);
  if (!/3 numbers will be messaged/.test(summary) || !/1 invalid/.test(summary) || !/1 duplicates/.test(summary)) fail('contact parsing summary wrong');
  else ok('pasted Excel columns parsed: 3 valid, 1 invalid, 1 duplicate');
  const phoneCol = await sh(($) => $('phoneCol').value);
  if (phoneCol !== 'Mobile') fail('phone column not auto-detected: ' + phoneCol); else ok('phone column auto-detected (Mobile)');

  await sh(($, v) => { const ta = $('template'); ta.value = v; ta.dispatchEvent(new Event('input')); }, 'Hi {{name|there}} from {{city}}');
  await sleep(300);
  const pv = await sh(($) => $('msgPreview').textContent);
  if (!/Hi Rahul from Pune/.test(pv)) fail('preview wrong: ' + pv); else ok('live preview renders merge fields');

  for (const [k, v] of [['delayMin', 2], ['delayMax', 2], ['batchSize', 2], ['batchPause', 1]]) await sh(($, k, v) => { $(k).value = v; $(k).dispatchEvent(new Event('change')); }, k, v);
  const startDisabled = await sh(($) => $('start').disabled);
  if (startDisabled) fail('start button still disabled'); else ok('start button enabled when connected + contacts + message');

  // 4. run it
  await sh(($) => $('start').click());
  let status = '';
  for (let i = 0; i < 40; i++) { await sleep(1000); status = await sh(($) => $('eta').textContent); if (/Finished/.test(status)) break; }
  console.log('run status:', status);
  const counts = await sh(($) => ({ sent: $('nSent').textContent, failed: $('nFailed').textContent, skipped: $('nSkipped').textContent, pending: $('nPending').textContent }));
  console.log('counts:', counts);
  const sent = await page.evaluate(() => window.__sent);
  const checked = await page.evaluate(() => window.__checked);
  console.log('fake sends:', JSON.stringify(sent));
  console.log('fake checks:', JSON.stringify(checked));
  if (!/Finished/.test(status)) fail('run did not finish');
  if (counts.sent !== '2' || counts.failed !== '1' || counts.skipped !== '2' || counts.pending !== '') fail('counts wrong: ' + JSON.stringify(counts));
  else ok('run finished: 2 sent, 1 failed (not on WhatsApp), 2 skipped');
  if (sent.length !== 2 || sent[0].text !== 'Hi Rahul from Pune' || sent[1].text !== 'Hi Emma from Leeds') fail('rendered messages wrong');
  else ok('each message personalised with the row values');
  if (sent.length < 2 || sent[0].id !== '919876543210@c.us' || sent[1].id !== '447700900123@c.us') fail('chat ids wrong: ' + sent.map((s) => s.id));
  else ok('sent to normalised international numbers (unsaved numbers, createChat)');
  if (!sent.every((s) => s.opts && s.opts.createChat)) fail('createChat not set');
  const logTxt = await sh(($) => $('log').textContent);
  if (!/Batch done/.test(logTxt)) fail('batch pause not logged'); else ok('batch pause applied after 2 messages');

  // analytics: refresh delivery + replies
  await sh(($) => $('refreshStats').click());
  await sleep(2500);
  const an = await sh(($) => ({ delivered: $('nDelivered').textContent, read: $('nRead').textContent, replied: $('nReplied').textContent, log: $('log').textContent }));
  console.log('analytics:', an.delivered, an.read, an.replied);
  if (an.delivered !== '2' || an.read !== '1' || an.replied !== '1' || !/replied: Thanks, interested/.test(an.log)) fail('analytics wrong: ' + JSON.stringify(an));
  else ok('analytics: 2 delivered, 1 read, 1 replied (from ticks + chat history)');

  // 5. attachment path + test send to self
  await page.evaluate(() => {
    const host = document.getElementById('wab-host').shadowRoot;
    const input = host.getElementById('attach');
    const f = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13])], 'promo.png', { type: 'image/png' });
    const dt = new DataTransfer(); dt.items.add(f); input.files = dt.files; input.dispatchEvent(new Event('change'));
  });
  await sleep(500);
  await sh(($) => $('testSend').click());
  await sleep(1500);
  const testInfo = await sh(($) => $('testInfo').textContent);
  const last = (await page.evaluate(() => window.__sent)).pop();
  console.log('test send:', testInfo, JSON.stringify(last));
  if (!/sent to \+919999999999/.test(testInfo) || !last || !last.file || last.file.type !== 'image' || last.file.caption !== 'Hi Rahul from Pune' || last.id !== '919999999999@c.us') fail('test send with attachment wrong');
  else ok('attachment sent as image with caption to own number');

  // 6. persisted run state survives a reload
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(6000);
  const after = await sh(($) => ({ items: $('nSent').textContent, log: $('log').children.length, eta: $('eta').textContent }));
  console.log('after reload:', after);
  if (after.items !== '2' || after.log < 3) fail('run state not persisted across reload'); else ok('run history persists across reload');

  // 7. my contacts (fake list again after reload)
  await page.evaluate(() => { const W = window.WPP; window.WPP = { ...W, contact: { ...W.contact } }; WPP.contact.list = async () => [{ id: { server: 'c.us', user: '919811111111' }, name: 'Saved One' }, { id: { server: 'g.us', user: '1' }, name: 'group' }]; });
  await sh(($) => $('launch').click()); await sleep(300);
  await sh(($) => { $('loadMine').click(); }); await sleep(1500);
  const mine = await sh(($) => $('contactSummary').textContent);
  if (!/1 numbers will be messaged/.test(mine)) fail('load my contacts failed: ' + mine); else ok('load my WhatsApp contacts works (groups filtered out)');

  await sh(($) => { $('paste').value = 'Rahul: 98765 43210\n9123456789 Emma'; $('paste').dispatchEvent(new Event('input')); $('template').value = 'Hi {{name}}'; $('template').dispatchEvent(new Event('input')); });
  await sleep(600);
  await page.screenshot({ path: path.join(OUT, 'e2e-panel.png') });
  await browser.close();
  console.log(process.exitCode ? 'E2E: FAILURES' : 'E2E: all passed');
})().catch((e) => { console.error('E2E ERROR', e); process.exit(1); });
