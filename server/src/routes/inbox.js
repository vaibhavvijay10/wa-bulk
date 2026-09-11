const express = require('express');
const { db } = require('../lib/db');
const { wa, MOCK } = require('../lib/wa');
const router = express.Router();

router.get('/', (req, res) => {
  // One row per phone, latest message first
  const threads = db.prepare(`
    SELECT m.phone, m.body, m.direction, m.created_at,
      (SELECT COUNT(*) FROM messages x WHERE x.phone = m.phone AND x.direction = 'in') AS inbound,
      (SELECT 1 FROM optouts o WHERE o.phone = m.phone) AS opted_out
    FROM messages m
    WHERE m.id = (SELECT MAX(id) FROM messages y WHERE y.phone = m.phone)
      AND EXISTS (SELECT 1 FROM messages z WHERE z.phone = m.phone AND z.direction = 'in')
    ORDER BY m.id DESC LIMIT 200`).all();
  res.render('inbox', { threads, thread: null, messages: [] });
});

router.get('/:phone(\\d+)', (req, res) => {
  const phone = req.params.phone;
  const threads = db.prepare(`
    SELECT m.phone, m.body, m.direction, m.created_at,
      (SELECT 1 FROM optouts o WHERE o.phone = m.phone) AS opted_out
    FROM messages m
    WHERE m.id = (SELECT MAX(id) FROM messages y WHERE y.phone = m.phone)
      AND EXISTS (SELECT 1 FROM messages z WHERE z.phone = m.phone AND z.direction = 'in')
    ORDER BY m.id DESC LIMIT 200`).all();
  const messages = db.prepare('SELECT * FROM messages WHERE phone = ? ORDER BY id ASC LIMIT 500').all(phone);
  const optedOut = !!db.prepare('SELECT 1 FROM optouts WHERE phone = ?').get(phone);
  res.render('inbox', { threads, thread: phone, messages, optedOut });
});

router.post('/:phone(\\d+)/reply', async (req, res) => {
  const phone = req.params.phone;
  const text = (req.body.text || '').trim();
  if (!text) return res.redirect(`/inbox/${phone}`);
  if (!wa.isReady()) { res.flash('WhatsApp is not connected.'); return res.redirect(`/inbox/${phone}`); }
  try {
    const r = await wa.sendText(phone + '@c.us', text);
    db.prepare("INSERT INTO messages(phone, direction, body, wa_id) VALUES(?, 'out', ?, ?)").run(phone, text, r?.id || null);
  } catch (e) {
    res.flash('Send failed: ' + e.message);
  }
  res.redirect(`/inbox/${phone}`);
});

// Mock-only helper so you can test the inbox without a phone
if (MOCK) {
  router.post('/mock-incoming', (req, res) => {
    const phone = String(req.body.phone || '').replace(/\D/g, '') || '919876543210';
    wa.recordIncoming(phone, req.body.body || 'Hello', 0, 'mock-in-' + Date.now());
    res.redirect(`/inbox/${phone}`);
  });
}

module.exports = router;
