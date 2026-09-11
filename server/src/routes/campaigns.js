const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const XLSX = require('xlsx');
const { db, DATA_DIR, getSetting } = require('../lib/db');
const { normalizePhone } = require('../lib/phone');
const { render, fields } = require('../lib/template');
const { requireAdmin } = require('../lib/auth');

const router = express.Router();
const UPLOADS = path.join(DATA_DIR, 'uploads');
const upload = multer({
  dest: UPLOADS,
  limits: { fileSize: 25 * 1024 * 1024 }
});

const CAMPAIGN_STATS = `
  (SELECT COUNT(*) FROM recipients r WHERE r.campaign_id = c.id) AS total,
  (SELECT COUNT(*) FROM recipients r WHERE r.campaign_id = c.id AND r.status = 'sent') AS sent,
  (SELECT COUNT(*) FROM recipients r WHERE r.campaign_id = c.id AND r.status = 'failed') AS failed,
  (SELECT COUNT(*) FROM recipients r WHERE r.campaign_id = c.id AND r.status = 'skipped') AS skipped,
  (SELECT COUNT(*) FROM recipients r WHERE r.campaign_id = c.id AND r.status = 'pending') AS pending`;

function parseSheet(filePath, originalName) {
  const wb = XLSX.readFile(filePath, { cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error('The file has no sheets.');
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
  if (!rows.length) throw new Error('The first sheet is empty (need a header row plus at least one contact).');
  const columns = Object.keys(rows[0]).map((c) => String(c).trim()).filter(Boolean);
  const clean = rows.map((r) => {
    const o = {};
    for (const [k, v] of Object.entries(r)) {
      const key = String(k).trim();
      if (!key) continue;
      o[key] = typeof v === 'number' && Number.isInteger(v) ? String(v) : (v === null || v === undefined ? '' : String(v).trim());
    }
    return o;
  });
  return { columns, rows: clean, filename: originalName };
}

function guessPhoneColumn(columns) {
  const pri = ['phone', 'mobile', 'whatsapp', 'number', 'contact', 'msisdn', 'tel', 'cell'];
  const lower = columns.map((c) => c.toLowerCase());
  for (const p of pri) {
    const i = lower.findIndex((c) => c.includes(p));
    if (i >= 0) return columns[i];
  }
  return columns[0];
}

router.get('/', (req, res) => {
  const campaigns = db.prepare(`SELECT c.*, u.username AS creator, ${CAMPAIGN_STATS}
    FROM campaigns c LEFT JOIN users u ON u.id = c.created_by ORDER BY c.id DESC`).all();
  res.render('campaigns', { campaigns });
});

router.get('/new', (req, res) => res.render('campaign_new', { error: null }));

router.post('/upload', upload.single('sheet'), (req, res) => {
  if (!req.file) return res.status(400).render('campaign_new', { error: 'Please choose an Excel or CSV file.' });
  let parsed;
  try {
    parsed = parseSheet(req.file.path, req.file.originalname);
  } catch (e) {
    fs.rmSync(req.file.path, { force: true });
    return res.status(400).render('campaign_new', { error: 'Could not read that file: ' + e.message });
  }
  fs.rmSync(req.file.path, { force: true });
  const id = crypto.randomBytes(8).toString('hex');
  fs.writeFileSync(path.join(UPLOADS, `sheet-${id}.json`), JSON.stringify(parsed));
  res.redirect(`/campaigns/compose/${id}`);
});

function loadSheet(id) {
  if (!/^[a-f0-9]{16}$/.test(id)) return null;
  const p = path.join(UPLOADS, `sheet-${id}.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

router.get('/compose/:id', (req, res) => {
  const sheet = loadSheet(req.params.id);
  if (!sheet) return res.status(404).render('error', { title: 'Upload expired', message: 'Please upload the sheet again.' });
  res.render('campaign_compose', {
    sheetId: req.params.id, sheet,
    phoneColumn: guessPhoneColumn(sheet.columns),
    preview: sheet.rows.slice(0, 5),
    defaults: { delay_min: 20, delay_max: 60, batch_size: 25, batch_pause: 300 },
    error: null
  });
});

// Live preview: render the template against the first few rows
router.post('/preview', (req, res) => {
  const sheet = loadSheet(req.body.sheetId || '');
  if (!sheet) return res.status(404).json({ error: 'upload expired' });
  const samples = sheet.rows.slice(0, 3).map((row) => ({
    phone: normalizePhone(row[req.body.phoneColumn], getSetting('default_country_code')),
    text: render(req.body.template || '', row)
  }));
  const unknown = fields(req.body.template || '').filter((f) => !sheet.columns.some((c) => c.toLowerCase() === f.toLowerCase()));
  res.json({ samples, unknown });
});

router.post('/create', upload.single('attachment'), (req, res) => {
  const sheet = loadSheet(req.body.sheetId || '');
  if (!sheet) return res.status(404).render('error', { title: 'Upload expired', message: 'Please upload the sheet again.' });
  const b = req.body;
  const name = (b.name || '').trim() || `Campaign ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
  const template = (b.template || '').trim();
  if (!template && !req.file) {
    return res.status(400).render('campaign_compose', {
      sheetId: b.sheetId, sheet, phoneColumn: b.phoneColumn, preview: sheet.rows.slice(0, 5),
      defaults: { delay_min: b.delay_min, delay_max: b.delay_max, batch_size: b.batch_size, batch_pause: b.batch_pause },
      error: 'Write a message or attach a file.'
    });
  }
  const num = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : d; };
  const delayMin = Math.max(3, num(b.delay_min, 20));
  const delayMax = Math.max(delayMin, num(b.delay_max, 60));

  let attachmentPath = null, attachmentName = null;
  if (req.file) {
    const ext = path.extname(req.file.originalname).toLowerCase().slice(0, 10);
    attachmentPath = path.join(UPLOADS, `att-${Date.now()}${ext}`);
    fs.renameSync(req.file.path, attachmentPath);
    attachmentName = req.file.originalname;
  }

  let status = 'draft';
  let scheduledAt = null;
  if (b.when === 'now') status = 'scheduled';
  else if (b.when === 'schedule' && b.scheduled_at) {
    // datetime-local has no zone; the form also sends the browser's UTC offset
    // (Date.getTimezoneOffset, e.g. -330 for IST) so UTC = local + offset.
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(b.scheduled_at);
    const offsetMin = parseInt(b.tz_offset, 10);
    if (m) {
      const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) + (Number.isFinite(offsetMin) ? offsetMin : 0) * 60000;
      scheduledAt = new Date(utc).toISOString();
      status = 'scheduled';
    }
  }

  const cc = getSetting('default_country_code');
  const optouts = new Set(db.prepare('SELECT phone FROM optouts').all().map((r) => r.phone));
  const insertCampaign = db.prepare(`INSERT INTO campaigns(name, template, attachment_path, attachment_name, phone_column, columns, status, scheduled_at,
    delay_min, delay_max, batch_size, batch_pause, send_window_start, send_window_end, created_by)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insertRec = db.prepare('INSERT INTO recipients(campaign_id, phone, data, status, reason) VALUES(?,?,?,?,?)');

  const stats = { total: 0, queued: 0, invalid: 0, duplicate: 0, optout: 0 };
  const tx = db.transaction(() => {
    const info = insertCampaign.run(name, template, attachmentPath, attachmentName, b.phoneColumn, JSON.stringify(sheet.columns), status, scheduledAt,
      delayMin, delayMax, num(b.batch_size, 25), num(b.batch_pause, 300), b.send_window_start || null, b.send_window_end || null, req.user.id);
    const cid = info.lastInsertRowid;
    const seen = new Set();
    for (const row of sheet.rows) {
      stats.total++;
      const phone = normalizePhone(row[b.phoneColumn], cc);
      const data = JSON.stringify(row);
      if (!phone) { stats.invalid++; insertRec.run(cid, String(row[b.phoneColumn] || ''), data, 'skipped', 'invalid number'); continue; }
      if (seen.has(phone)) { stats.duplicate++; insertRec.run(cid, phone, data, 'skipped', 'duplicate'); continue; }
      seen.add(phone);
      if (optouts.has(phone)) { stats.optout++; insertRec.run(cid, phone, data, 'skipped', 'opted out'); continue; }
      stats.queued++;
      insertRec.run(cid, phone, data, 'pending', null);
    }
    return cid;
  });
  const cid = tx();
  fs.rmSync(path.join(UPLOADS, `sheet-${b.sheetId}.json`), { force: true });
  res.flash(`Campaign created: ${stats.queued} queued, ${stats.duplicate} duplicates, ${stats.invalid} invalid, ${stats.optout} opted out.`);
  res.redirect(`/campaigns/${cid}`);
});

function loadCampaign(id) {
  return db.prepare(`SELECT c.*, u.username AS creator, ${CAMPAIGN_STATS} FROM campaigns c LEFT JOIN users u ON u.id = c.created_by WHERE c.id = ?`).get(id);
}

router.get('/:id(\\d+)', (req, res) => {
  const c = loadCampaign(req.params.id);
  if (!c) return res.status(404).render('error', { title: 'Not found', message: 'No such campaign.' });
  const filter = ['pending', 'sent', 'failed', 'skipped'].includes(req.query.status) ? req.query.status : null;
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const per = 100;
  const where = filter ? 'AND status = ?' : '';
  const args = filter ? [c.id, filter] : [c.id];
  const count = db.prepare(`SELECT COUNT(*) AS n FROM recipients WHERE campaign_id = ? ${where}`).get(...args).n;
  const recipients = db.prepare(`SELECT * FROM recipients WHERE campaign_id = ? ${where} ORDER BY id LIMIT ? OFFSET ?`).all(...args, per, (page - 1) * per)
    .map((r) => ({ ...r, row: JSON.parse(r.data) }));
  res.render('campaign', { c, recipients, filter, page, pages: Math.max(1, Math.ceil(count / per)), columns: JSON.parse(c.columns), sample: render(c.template, recipients[0]?.row || {}) });
});

router.get('/:id(\\d+)/stats.json', (req, res) => {
  const c = loadCampaign(req.params.id);
  if (!c) return res.status(404).json({});
  res.json({ status: c.status, total: c.total, sent: c.sent, failed: c.failed, skipped: c.skipped, pending: c.pending, last_error: c.last_error });
});

function setStatus(id, from, to, extra = '') {
  return db.prepare(`UPDATE campaigns SET status = ? ${extra} WHERE id = ? AND status IN (${from.map(() => '?').join(',')})`).run(to, id, ...from).changes;
}

router.post('/:id(\\d+)/start', (req, res) => {
  setStatus(req.params.id, ['draft', 'scheduled', 'paused'], 'running', ", scheduled_at = NULL, started_at = COALESCE(started_at, datetime('now'))");
  res.flash('Campaign started.');
  res.redirect(`/campaigns/${req.params.id}`);
});
router.post('/:id(\\d+)/pause', (req, res) => {
  setStatus(req.params.id, ['running', 'scheduled'], 'paused');
  res.flash('Campaign paused.');
  res.redirect(`/campaigns/${req.params.id}`);
});
router.post('/:id(\\d+)/cancel', (req, res) => {
  setStatus(req.params.id, ['draft', 'scheduled', 'running', 'paused'], 'cancelled', ", finished_at = datetime('now')");
  res.flash('Campaign cancelled. Pending contacts were not messaged.');
  res.redirect(`/campaigns/${req.params.id}`);
});
router.post('/:id(\\d+)/retry-failed', (req, res) => {
  const n = db.prepare("UPDATE recipients SET status = 'pending', reason = NULL WHERE campaign_id = ? AND status = 'failed' AND reason != 'not on WhatsApp'").run(req.params.id).changes;
  setStatus(req.params.id, ['completed', 'cancelled', 'paused', 'draft'], 'running', ", finished_at = NULL");
  res.flash(`${n} failed contacts re-queued.`);
  res.redirect(`/campaigns/${req.params.id}`);
});
router.post('/:id(\\d+)/delete', requireAdmin, (req, res) => {
  const c = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (c) {
    db.prepare('DELETE FROM campaigns WHERE id = ?').run(c.id);
    if (c.attachment_path) fs.rmSync(c.attachment_path, { force: true });
  }
  res.flash('Campaign deleted.');
  res.redirect('/campaigns');
});

// Export a report (sent / failed / skipped with reasons) as CSV
router.get('/:id(\\d+)/report.csv', (req, res) => {
  const c = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!c) return res.sendStatus(404);
  const cols = JSON.parse(c.columns);
  const recs = db.prepare('SELECT * FROM recipients WHERE campaign_id = ? ORDER BY id').all(c.id);
  const esc = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = [['phone', 'status', 'reason', 'sent_at', ...cols, 'message'].map(esc).join(',')];
  for (const r of recs) {
    const row = JSON.parse(r.data);
    lines.push([r.phone, r.status, r.reason, r.sent_at, ...cols.map((k) => row[k]), r.rendered].map(esc).join(','));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="campaign-${c.id}-report.csv"`);
  res.send('﻿' + lines.join('\r\n'));
});

module.exports = router;
