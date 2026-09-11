const express = require('express');
const multer = require('multer');
const fs = require('fs');
const XLSX = require('xlsx');
const { db, DATA_DIR, getSetting } = require('../lib/db');
const { normalizePhone } = require('../lib/phone');
const router = express.Router();
const upload = multer({ dest: DATA_DIR + '/uploads', limits: { fileSize: 10 * 1024 * 1024 } });

router.get('/', (req, res) => {
  const q = (req.query.q || '').replace(/\D/g, '');
  const rows = q
    ? db.prepare('SELECT * FROM optouts WHERE phone LIKE ? ORDER BY created_at DESC LIMIT 500').all('%' + q + '%')
    : db.prepare('SELECT * FROM optouts ORDER BY created_at DESC LIMIT 500').all();
  const total = db.prepare('SELECT COUNT(*) AS n FROM optouts').get().n;
  res.render('optouts', { rows, total, q });
});

router.post('/add', (req, res) => {
  const cc = getSetting('default_country_code');
  const phones = String(req.body.phones || '').split(/[\s,;]+/).map((p) => normalizePhone(p, cc)).filter(Boolean);
  const ins = db.prepare("INSERT OR IGNORE INTO optouts(phone, source, note) VALUES(?, 'manual', ?)");
  let n = 0;
  for (const p of phones) n += ins.run(p, (req.body.note || '').slice(0, 200)).changes;
  res.flash(`${n} number(s) added to the opt-out list.`);
  res.redirect('/optouts');
});

router.post('/import', upload.single('sheet'), (req, res) => {
  if (!req.file) return res.redirect('/optouts');
  const cc = getSetting('default_country_code');
  let n = 0;
  try {
    const wb = XLSX.readFile(req.file.path);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    const ins = db.prepare("INSERT OR IGNORE INTO optouts(phone, source, note) VALUES(?, 'import', ?)");
    for (const r of rows) for (const cell of r) {
      const p = normalizePhone(cell, cc);
      if (p) n += ins.run(p, req.file.originalname.slice(0, 100)).changes;
    }
  } catch (e) {
    res.flash('Import failed: ' + e.message);
  } finally {
    fs.rmSync(req.file.path, { force: true });
  }
  res.flash(`${n} number(s) imported to the opt-out list.`);
  res.redirect('/optouts');
});

router.post('/remove', (req, res) => {
  db.prepare('DELETE FROM optouts WHERE phone = ?').run(String(req.body.phone || ''));
  res.redirect('/optouts');
});

router.get('/export.csv', (req, res) => {
  const rows = db.prepare('SELECT * FROM optouts ORDER BY created_at').all();
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="optouts.csv"');
  res.send('phone,source,note,created_at\r\n' + rows.map((r) => [r.phone, r.source, JSON.stringify(r.note || ''), r.created_at].join(',')).join('\r\n'));
});

module.exports = router;
