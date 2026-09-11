// Campaign sender loop. One campaign at a time (single linked number), with
// random delays, batch pauses, a daily cap, an optional send window, opt-out
// checks and number verification.
const { db, getSetting, sentToday, bumpToday } = require('./db');
const { wa } = require('./wa');
const { render } = require('./template');

const log = (...a) => console.log(new Date().toISOString(), '[worker]', ...a);
let running = false;
let currentCampaignId = null;
let nextActionAt = null;   // Date when the worker will next try to send (for the UI)
let batchCounter = 0;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function rand(min, max) { return Math.floor(min + Math.random() * (max - min + 1)); }

function localHHMM(tz) {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  } catch { return new Date().toTimeString().slice(0, 5); }
}

function inSendWindow(c) {
  if (!c.send_window_start || !c.send_window_end) return true;
  const now = localHHMM(getSetting('timezone'));
  if (c.send_window_start <= c.send_window_end) return now >= c.send_window_start && now < c.send_window_end;
  return now >= c.send_window_start || now < c.send_window_end; // window crossing midnight
}

function status() {
  return { running, currentCampaignId, nextActionAt, sentToday: sentToday(), dailyCap: Number(getSetting('daily_cap')) };
}

function promoteScheduled() {
  db.prepare(`UPDATE campaigns SET status = 'running', started_at = COALESCE(started_at, datetime('now'))
              WHERE status = 'scheduled' AND (scheduled_at IS NULL OR scheduled_at <= ?)`).run(new Date().toISOString());
}

async function tick() {
  promoteScheduled();
  const campaign = db.prepare("SELECT * FROM campaigns WHERE status = 'running' ORDER BY started_at ASC, id ASC LIMIT 1").get();
  if (!campaign) { currentCampaignId = null; nextActionAt = null; return 3000; }
  currentCampaignId = campaign.id;

  if (!wa.isReady()) { nextActionAt = null; return 5000; }

  const cap = Number(getSetting('daily_cap'));
  if (cap > 0 && sentToday() >= cap) { nextActionAt = null; return 60000; }
  if (!inSendWindow(campaign)) { nextActionAt = null; return 60000; }

  const rec = db.prepare("SELECT * FROM recipients WHERE campaign_id = ? AND status = 'pending' ORDER BY id ASC LIMIT 1").get(campaign.id);
  if (!rec) {
    db.prepare("UPDATE campaigns SET status = 'completed', finished_at = datetime('now') WHERE id = ?").run(campaign.id);
    log(`campaign ${campaign.id} completed`);
    batchCounter = 0;
    return 1000;
  }

  // Opt-out check (list may have grown since the campaign was created)
  if (db.prepare('SELECT 1 FROM optouts WHERE phone = ?').get(rec.phone)) {
    db.prepare("UPDATE recipients SET status = 'skipped', reason = 'opted out' WHERE id = ?").run(rec.id);
    return 200;
  }

  const row = JSON.parse(rec.data);
  const text = render(campaign.template, row);
  try {
    const chatId = await wa.resolveNumber(rec.phone);
    if (!chatId) {
      db.prepare("UPDATE recipients SET status = 'failed', reason = 'not on WhatsApp' WHERE id = ?").run(rec.id);
      return rand(2000, 5000);
    }
    let res;
    if (campaign.attachment_path) res = await wa.sendMedia(chatId, campaign.attachment_path, text, campaign.attachment_name);
    else res = await wa.sendText(chatId, text);
    db.prepare("UPDATE recipients SET status = 'sent', rendered = ?, sent_at = datetime('now'), reason = NULL WHERE id = ?").run(text, rec.id);
    db.prepare("INSERT INTO messages(phone, direction, body, has_media, wa_id, campaign_id) VALUES(?, 'out', ?, ?, ?, ?)")
      .run(rec.phone, text, campaign.attachment_path ? 1 : 0, res?.id || null, campaign.id);
    bumpToday();
    batchCounter++;
  } catch (e) {
    const msg = String(e.message || e).slice(0, 200);
    log(`send failed to ${rec.phone}: ${msg}`);
    db.prepare("UPDATE recipients SET status = 'failed', reason = ?, rendered = ? WHERE id = ?").run(msg, text, rec.id);
    db.prepare('UPDATE campaigns SET last_error = ? WHERE id = ?').run(msg, campaign.id);
    if (/session|closed|detached|disconnected|not ready/i.test(msg)) return 15000;
  }

  // Delay before the next message; longer pause at the end of each batch.
  let wait = rand(campaign.delay_min, campaign.delay_max) * 1000;
  if (campaign.batch_size > 0 && batchCounter >= campaign.batch_size) {
    batchCounter = 0;
    wait += campaign.batch_pause * 1000;
  }
  return wait;
}

async function loop() {
  running = true;
  while (running) {
    let wait = 3000;
    try { wait = await tick(); } catch (e) { log('tick error', e); wait = 5000; }
    nextActionAt = wait > 3000 ? new Date(Date.now() + wait).toISOString() : null;
    // Sleep in 1s slices so pause/cancel/new-campaign take effect quickly.
    const until = Date.now() + wait;
    const watching = currentCampaignId;
    while (running && Date.now() < until) {
      await sleep(Math.min(1000, until - Date.now()));
      if (watching) {
        const c = db.prepare('SELECT status FROM campaigns WHERE id = ?').get(watching);
        if (!c || c.status !== 'running') { batchCounter = 0; break; }
      }
    }
  }
}

function start() { if (!running) loop(); }
function stop() { running = false; }

module.exports = { start, stop, status };
