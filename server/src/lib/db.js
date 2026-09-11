const path = require('path');
const fs = require('fs');
const Database = require('./sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

const db = new Database(path.join(DATA_DIR, 'wa-bulk.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'sender',   -- admin | sender
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  template TEXT NOT NULL,
  attachment_path TEXT,
  attachment_name TEXT,
  phone_column TEXT NOT NULL,
  columns TEXT NOT NULL,                 -- JSON array of column names
  status TEXT NOT NULL DEFAULT 'draft',  -- draft | scheduled | running | paused | completed | cancelled
  scheduled_at TEXT,                     -- ISO, null = start immediately when started
  delay_min INTEGER NOT NULL DEFAULT 20, -- seconds
  delay_max INTEGER NOT NULL DEFAULT 60,
  batch_size INTEGER NOT NULL DEFAULT 25,
  batch_pause INTEGER NOT NULL DEFAULT 300, -- seconds
  send_window_start TEXT,                -- "09:00" local time, optional
  send_window_end TEXT,                  -- "21:00"
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  finished_at TEXT,
  last_error TEXT
);
CREATE TABLE IF NOT EXISTS recipients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  data TEXT NOT NULL,                    -- JSON row from the sheet
  status TEXT NOT NULL DEFAULT 'pending',-- pending | sent | failed | skipped
  reason TEXT,
  rendered TEXT,
  sent_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_recipients_campaign_status ON recipients(campaign_id, status);
CREATE TABLE IF NOT EXISTS optouts (
  phone TEXT PRIMARY KEY,
  source TEXT,                           -- manual | keyword | import
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL,
  direction TEXT NOT NULL,               -- in | out
  body TEXT,
  has_media INTEGER NOT NULL DEFAULT 0,
  wa_id TEXT,
  campaign_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages(phone, created_at);
CREATE TABLE IF NOT EXISTS daily_counts (
  day TEXT PRIMARY KEY,                  -- YYYY-MM-DD
  count INTEGER NOT NULL DEFAULT 0
);
`);

const DEFAULT_SETTINGS = {
  daily_cap: '250',
  default_country_code: '91',
  optout_keywords: 'STOP,UNSUBSCRIBE,OPT OUT,OPTOUT,REMOVE,CANCEL',
  optout_reply: '',
  timezone: process.env.TZ || 'Asia/Kolkata',
  verify_numbers: '1'
};

const getSettingStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
const setSettingStmt = db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');

function getSetting(key) {
  const row = getSettingStmt.get(key);
  return row ? row.value : DEFAULT_SETTINGS[key];
}
function setSetting(key, value) {
  setSettingStmt.run(key, String(value));
}
function allSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const row of db.prepare('SELECT key, value FROM settings').all()) out[row.key] = row.value;
  return out;
}

function today() {
  // Day in the configured timezone, as YYYY-MM-DD
  const tz = getSetting('timezone');
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}
function sentToday() {
  const row = db.prepare('SELECT count FROM daily_counts WHERE day = ?').get(today());
  return row ? row.count : 0;
}
function bumpToday() {
  db.prepare('INSERT INTO daily_counts(day, count) VALUES(?, 1) ON CONFLICT(day) DO UPDATE SET count = count + 1').run(today());
}

module.exports = { db, DATA_DIR, getSetting, setSetting, allSettings, today, sentToday, bumpToday };
